import asyncio
import json
from typing import Protocol

from .llm import LLMClient
from .observation import confirm_summary, find_element, render_observation
from .prompts import SYSTEM_PROMPT
from .protocol import (
    ActionResult,
    AgentMessage,
    ConfirmResponse,
    Done,
    ErrorMessage,
    Observation,
    Status,
)
from .settings import AgentSettings
from .tools import ACTION_TOOLS, TOOLS, needs_confirmation, validate_navigate_path
from .tracing import Tracer


class Client(Protocol):
    async def send(self, msg) -> None: ...
    async def request_observation(self) -> Observation: ...
    async def execute_action(self, action: str, args: dict, highlight_ref: int | None) -> ActionResult: ...
    async def request_screenshot(self) -> str: ...
    async def request_confirm(self, summary: str) -> ConfirmResponse: ...


def _image_block(jpeg_base64: str) -> dict:
    return {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": jpeg_base64}}


class AgentLoop:
    def __init__(self, client: Client, llm: LLMClient, tracer: Tracer, settings: AgentSettings):
        self.client = client
        self.llm = llm
        self.tracer = tracer
        self.settings = settings
        # Each entry is an Anthropic message plus bookkeeping. Entries flagged obs=True
        # carry a full observation; only the newest one is sent in full (see messages()).
        self.entries: list[dict] = []
        self.queued_user: list[str] = []
        self.step_lines: list[str] = []
        self.step = 0
        self.last_obs: Observation | None = None

    def queue_user_message(self, text: str) -> None:
        self.queued_user.append(text)

    def messages(self) -> list[dict]:
        obs_indexes = [i for i, e in enumerate(self.entries) if e.get("obs")]
        keep = set(obs_indexes[-max(1, self.settings.keep_observations):])
        out: list[dict] = []
        for i, e in enumerate(self.entries):
            content = e["content"] if not e.get("obs") or i in keep else e["compact"]
            if out and out[-1]["role"] == e["role"] == "user":
                out[-1]["content"] = out[-1]["content"] + content
            else:
                out.append({"role": e["role"], "content": list(content)})
        return out

    async def _status(self, state: str, step: int) -> None:
        await self.client.send(Status(state=state, step=step, max_steps=self.settings.max_steps))

    def _observe(self, obs: Observation | None) -> None:
        if obs is not None:
            self.last_obs = obs
            self.tracer.write("observation", url=obs.url, title=obs.title, text=render_observation(obs))

    def _append_user_text(self, text: str) -> None:
        self.entries.append({"role": "user", "content": [{"type": "text", "text": text}]})

    def _inject_queued(self) -> None:
        for text in self.queued_user:
            self._append_user_text(f"Patient says: {text}")
            self.tracer.write("user_message", text=text, queued=True)
        self.queued_user.clear()

    def _append_tool_result(self, tool_use_id: str, content: list[dict], compact: str | None = None) -> None:
        block = {"type": "tool_result", "tool_use_id": tool_use_id, "content": content}
        entry = {"role": "user", "content": [block]}
        if compact is not None:
            entry["obs"] = True
            entry["compact"] = [{"type": "tool_result", "tool_use_id": tool_use_id, "content": compact}]
        self.entries.append(entry)

    async def run_turn(self, text: str) -> None:
        self.tracer.write("user_message", text=text)
        await self._status("thinking", self.step)
        obs = await self.client.request_observation()
        self._observe(obs)
        screenshot_mode = self.settings.perception_mode == "screenshot"
        content = [{"type": "text", "text": f"Patient: {text}"}, {"type": "text", "text": render_observation(obs, minimal=screenshot_mode)}]
        if screenshot_mode:
            jpeg = await self._screenshot()
            if jpeg:
                content.append(_image_block(jpeg))
        self.entries.append(
            {
                "role": "user",
                "content": content,
                "compact": [{"type": "text", "text": f"Patient: {text}"}, {"type": "text", "text": "(observation omitted)"}],
                "obs": True,
            }
        )
        try:
            await self._run_steps()
        except asyncio.CancelledError:
            self._close_dangling_tool_use("Stopped by the patient.")
            self.tracer.write("stopped")
            raise

    def _close_dangling_tool_use(self, text: str) -> None:
        if not self.entries or self.entries[-1]["role"] != "assistant":
            return
        for block in self.entries[-1]["content"]:
            if block.get("type") == "tool_use":
                self._append_tool_result(block["id"], [{"type": "text", "text": text}])

    async def _run_steps(self) -> None:
        failures = 0
        timeouts = 0
        nudges = 0
        for step in range(1, self.settings.max_steps + 1):
            self.step += 1
            await self._status("thinking", step)
            self._inject_queued()

            async def on_text(delta: str) -> None:
                await self.client.send(AgentMessage(text=delta, delta=True))

            try:
                result = await asyncio.wait_for(
                    self.llm.complete(SYSTEM_PROMPT, self.messages(), TOOLS, on_text=on_text),
                    timeout=self.settings.llm_timeout_seconds + 5,
                )
            except TimeoutError:
                timeouts += 1
                self.tracer.write("llm_timeout", count=timeouts)
                if timeouts >= 2:
                    await self.client.send(ErrorMessage(message="The assistant timed out twice in a row. Please try again.", fatal=True))
                    await self._status("idle", step)
                    return
                continue
            timeouts = 0
            self.tracer.write(
                "llm",
                model=result.model,
                usage=result.usage,
                latency_ms=result.latency_ms,
                stop_reason=result.stop_reason,
                text=result.text,
                tool_calls=[{"name": t.name, "input": t.input} for t in result.tool_calls],
            )
            self.entries.append({"role": "assistant", "content": result.content_blocks})

            if result.stop_reason == "refusal":
                await self.client.send(ErrorMessage(message="The assistant declined to continue this request.", fatal=True))
                await self._status("idle", step)
                return
            if not result.tool_calls:
                nudges += 1
                if nudges > 2:
                    await self.client.send(Done(summary=result.text or "Done."))
                    await self._status("idle", step)
                    return
                self._append_user_text("Continue by calling a tool. Call finish when the task is complete, or ask_user if you need the patient.")
                continue

            call = result.tool_calls[0]
            for extra in result.tool_calls[1:]:
                self._append_tool_result(extra.id, [{"type": "text", "text": "Ignored: only one tool call per step is executed."}])
            name, args = call.name, call.input

            if name == "finish":
                summary = str(args.get("summary", ""))
                self._append_tool_result(call.id, [{"type": "text", "text": "Task finished."}])
                self.tracer.write("done", summary=summary)
                await self.client.send(Done(summary=summary))
                await self._status("idle", step)
                return

            if name == "ask_user":
                question = str(args.get("question", ""))
                self._append_tool_result(call.id, [{"type": "text", "text": "Question shown to the patient. Their reply will follow."}])
                self.tracer.write("ask_user", question=question)
                await self.client.send(AgentMessage(text=question, delta=False))
                await self._status("waiting_for_user", step)
                return

            if name == "get_screenshot":
                await self._status("acting", step)
                jpeg = await self._screenshot()
                content = [{"type": "text", "text": render_observation(self.last_obs, minimal=True) if self.last_obs else "Screenshot:"}]
                if jpeg:
                    content.append(_image_block(jpeg))
                self._append_tool_result(call.id, content, compact=f"step {self.step}: screenshot taken")
                continue

            error = self._validate(name, args)
            if error:
                failures += 1
                self._append_tool_result(call.id, [{"type": "text", "text": f"Error: {error}"}])
                self.tracer.write("action_rejected", action=name, args=args, error=error)
                continue

            element = find_element(self.last_obs, args.get("ref"))
            if name == "click" and needs_confirmation(args, element.name if element else None, element.role if element else None):
                summary = confirm_summary(self.last_obs, element)
                await self._status("waiting_for_user", step)
                self.tracer.write("confirm_request", summary=summary)
                try:
                    decision = await self.client.request_confirm(summary)
                except TimeoutError:
                    decision = ConfirmResponse(id="", allowed=False, reason="No answer from the patient.")
                self.tracer.write("confirm_response", allowed=decision.allowed, reason=decision.reason)
                if not decision.allowed:
                    text = "The patient declined this action."
                    if decision.reason:
                        text += f" Reason: {decision.reason}"
                    self._append_tool_result(call.id, [{"type": "text", "text": text}])
                    continue

            await self._status("acting", step)
            self.tracer.write("action", action=name, args=args)
            try:
                action_result = await self.client.execute_action(name, args, args.get("ref") if name in ("click", "type_text", "select_option") else None)
            except TimeoutError:
                timeouts += 1
                failures += 1
                self.tracer.write("action_timeout", count=timeouts)
                if timeouts >= 2:
                    await self.client.send(ErrorMessage(message="The phone did not respond twice in a row. Stopping.", fatal=True))
                    await self._status("idle", step)
                    return
                self._append_tool_result(call.id, [{"type": "text", "text": "Error: the action timed out. The page may still be loading; try again."}])
                continue
            timeouts = 0
            self._observe(action_result.observation)
            self.tracer.write("action_result", ok=action_result.ok, error=action_result.error)

            if action_result.ok:
                failures = 0
                status_line = "Action succeeded."
            else:
                failures += 1
                status_line = f"Action failed: {action_result.error}"

            obs = action_result.observation or self.last_obs
            screenshot_mode = self.settings.perception_mode == "screenshot"
            content = [{"type": "text", "text": f"{status_line}\n\n{render_observation(obs, minimal=screenshot_mode) if obs else '(no observation)'}"}]
            if screenshot_mode or failures >= 2:
                jpeg = await self._screenshot()
                if jpeg:
                    content.append(_image_block(jpeg))
            target = f' "{element.name}"' if element else ""
            line = f"step {self.step}: {name} {json.dumps(args)}{target} -> {'ok' if action_result.ok else 'failed: ' + (action_result.error or '')} ({obs.url if obs else '?'})"
            self.step_lines.append(line)
            excerpt = " ".join((obs.text if obs else "").split())[:240]
            self._append_tool_result(call.id, content, compact=f"{line}\npage excerpt: {excerpt}")
            if self._looping():
                self._append_user_text(
                    "You have repeated the same navigation several times without progress. Stop and think: "
                    "write down what you know, then either take a different action, or use ask_user / finish."
                )
                self.tracer.write("loop_guard", recent=self.step_lines[-4:])

        # Step limit reached.
        recent = "\n".join(self.step_lines[-5:])
        summary = f"I stopped after {self.settings.max_steps} steps without finishing. Recent progress:\n{recent}\n\nHow would you like to proceed?"
        self.tracer.write("max_steps", summary=summary)
        await self.client.send(AgentMessage(text=summary, delta=False))
        await self._status("waiting_for_user", self.settings.max_steps)

    def _looping(self) -> bool:
        recent = self.step_lines[-4:]
        if len(recent) < 4:
            return False
        actions = {ln.split(": ", 1)[1].split(" ", 1)[0] for ln in recent}
        urls = {ln.rsplit("(", 1)[-1] for ln in recent}
        return actions == {"navigate"} and len(urls) <= 2

    async def _screenshot(self) -> str | None:
        try:
            jpeg = await self.client.request_screenshot()
        except TimeoutError:
            self.tracer.write("screenshot_timeout")
            return None
        self.tracer.write("screenshot", bytes=len(jpeg))
        return jpeg

    def _validate(self, name: str, args: dict) -> str | None:
        if name not in ACTION_TOOLS:
            return f"unknown tool {name}"
        if name == "navigate":
            return validate_navigate_path(str(args.get("path", "")))
        if name == "wait":
            args["ms"] = max(0, min(int(args.get("ms", 500)), 3000))
        if name in ("click", "type_text", "select_option"):
            ref = args.get("ref")
            if self.last_obs is not None and find_element(self.last_obs, ref) is None:
                return f"ref {ref} is not in the latest observation; use a ref from the current page"
        if name == "type_text":
            el = find_element(self.last_obs, args.get("ref"))
            if el is not None and el.type == "password":
                return "refused: the assistant never types into password fields. Ask the patient to sign in."
        return None
