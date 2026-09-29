"""Rork gateway adapter; retains the original agent loop's Anthropic block contract."""
import json
import time
from collections.abc import Awaitable, Callable

import httpx

from .llm import LLMResult, ToolCall
from .settings import AgentSettings


def _parts(blocks: str | list[dict]) -> list[dict]:
    if isinstance(blocks, str):
        return [{"type": "text", "text": blocks}]
    parts = []
    for block in blocks:
        if block.get("type") == "text":
            parts.append({"type": "text", "text": block["text"]})
        elif block.get("type") == "image":
            source = block["source"]
            parts.append({"type": "image_url", "image_url": {
                "url": f"data:{source['media_type']};base64,{source['data']}"}})
    return parts


def gateway_messages(system: str, messages: list[dict]) -> list[dict]:
    """Preserve tool IDs and move tool-result images to a following user message."""
    output = [{"role": "system", "content": system}]
    for message in messages:
        blocks = message["content"]
        if isinstance(blocks, str):
            output.append({"role": message["role"], "content": blocks})
            continue
        if message["role"] == "assistant":
            text = "".join(b["text"] for b in blocks if b.get("type") == "text")
            calls = [{"id": b["id"], "type": "function", "function": {
                "name": b["name"], "arguments": json.dumps(b.get("input", {}))}}
                for b in blocks if b.get("type") == "tool_use"]
            item = {"role": "assistant", "content": text or None}
            if calls:
                item["tool_calls"] = calls
            output.append(item)
        else:
            pending = []
            for block in blocks:
                if block.get("type") != "tool_result":
                    pending.extend(_parts([block]))
                    continue
                parts = _parts(block.get("content", ""))
                text = "\n".join(p["text"] for p in parts if p["type"] == "text")
                output.append({"role": "tool", "tool_call_id": block["tool_use_id"], "content": text})
                pending.extend(p for p in parts if p["type"] == "image_url")
            if pending:
                output.append({"role": "user", "content": pending})
    return output


async def complete(settings: AgentSettings, system: str, messages: list[dict], tools: list[dict],
                   on_text: Callable[[str], Awaitable[None]] | None = None) -> LLMResult:
    if not settings.expo_public_toolkit_url or not settings.expo_public_rork_toolkit_secret_key:
        raise RuntimeError("Configure Rork AI Cloud on the demo backend before starting the assistant.")
    start = time.monotonic()
    payload = {
        "model": settings.llm_model,
        "messages": gateway_messages(system, messages),
        "tools": [{"type": "function", "function": {"name": t["name"],
                   "description": t.get("description", ""), "parameters": t["input_schema"]}} for t in tools],
        "tool_choice": "auto", "max_tokens": 8192,
        "stream": True, "stream_options": {"include_usage": True},
    }
    endpoint = settings.expo_public_toolkit_url.rstrip("/") + "/v2/vercel/v1/chat/completions"
    headers = {"Authorization": f"Bearer {settings.expo_public_rork_toolkit_secret_key}"}
    text = ""
    calls: dict[int, dict] = {}
    usage = {}
    stop_reason = None
    finished = False
    async with httpx.AsyncClient(timeout=settings.llm_timeout_seconds) as client:
        async with client.stream("POST", endpoint, json=payload, headers=headers) as response:
            if response.status_code != 200:
                raise RuntimeError(f"The AI service could not complete the request (HTTP {response.status_code}).")
            async for line in response.aiter_lines():
                if not line.startswith("data:"):
                    continue
                raw = line[5:].strip()
                if raw == "[DONE]":
                    finished = True
                    break
                event = json.loads(raw)
                if event.get("error"):
                    raise RuntimeError("The AI service interrupted this response. Please try again.")
                if event.get("usage"):
                    u = event["usage"]
                    usage = {"input_tokens": u.get("prompt_tokens", 0), "output_tokens": u.get("completion_tokens", 0)}
                for choice in event.get("choices", []):
                    reason = choice.get("finish_reason")
                    if reason:
                        stop_reason = {"tool_calls": "tool_use", "stop": "end_turn", "content_filter": "refusal", "length": "max_tokens"}.get(reason, reason)
                    delta = choice.get("delta", {})
                    if delta.get("refusal"):
                        stop_reason = "refusal"
                    if delta.get("content"):
                        text += delta["content"]
                        if on_text:
                            await on_text(delta["content"])
                    for fragment in delta.get("tool_calls", []):
                        call = calls.setdefault(fragment["index"], {"id": "", "name": "", "arguments": ""})
                        if fragment.get("id"):
                            call["id"] = fragment["id"]
                        function = fragment.get("function", {})
                        call["name"] += function.get("name", "")
                        call["arguments"] += function.get("arguments", "")
    if not finished or stop_reason == "max_tokens":
        raise RuntimeError("The AI response was incomplete. No partial browser action was executed.")
    tool_calls = []
    for call in calls.values():
        args = json.loads(call["arguments"] or "{}")
        if not isinstance(args, dict) or not call["id"] or not call["name"]:
            raise RuntimeError("The AI returned an invalid browser action.")
        tool_calls.append(ToolCall(call["id"], call["name"], args))
    blocks = ([{"type": "text", "text": text}] if text else []) + [
        {"type": "tool_use", "id": t.id, "name": t.name, "input": t.input} for t in tool_calls]
    return LLMResult(text, tool_calls, blocks, stop_reason, usage,
                     int((time.monotonic() - start) * 1000), settings.llm_model)
