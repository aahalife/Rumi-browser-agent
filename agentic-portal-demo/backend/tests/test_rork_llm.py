import json

import httpx
import pytest

from agent.rork_llm import gateway_messages, complete
from agent.settings import AgentSettings


def test_translates_tools_and_screenshot_without_losing_ids():
    messages = [
        {"role": "assistant", "content": [{"type": "tool_use", "id": "call1", "name": "get_screenshot", "input": {}}]},
        {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "call1", "content": [
            {"type": "text", "text": "Portal snapshot"},
            {"type": "image", "source": {"media_type": "image/jpeg", "data": "image-data"}}
        ]}]},
    ]
    output = gateway_messages("system", messages)
    assert output[1]["tool_calls"][0]["id"] == "call1"
    assert output[2] == {"role": "tool", "tool_call_id": "call1", "content": "Portal snapshot"}
    assert output[3]["content"][0]["image_url"]["url"] == "data:image/jpeg;base64,image-data"


@pytest.mark.asyncio
async def test_stream_assembles_fragmented_arguments_and_usage(monkeypatch):
    events = [
        {"choices": [{"delta": {"content": "I will read the page."}}]},
        {"choices": [{"delta": {"tool_calls": [{"index": 0, "id": "c1", "function": {"name": "click", "arguments": '{"ref":'}}]}}]},
        {"choices": [{"delta": {"tool_calls": [{"index": 0, "function": {"arguments": '12}'}}]}, "finish_reason": "tool_calls"}]},
        {"choices": [], "usage": {"prompt_tokens": 100, "completion_tokens": 30}},
    ]
    captured = {}
    def handler(request):
        captured.update(json.loads(request.content))
        return httpx.Response(200, text="".join("data: " + json.dumps(e) + "\n\n" for e in events) + "data: [DONE]\n\n")
    original = httpx.AsyncClient
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: original(transport=httpx.MockTransport(handler), **kw))
    settings = AgentSettings(expo_public_toolkit_url="https://example.test", expo_public_rork_toolkit_secret_key="test-only")
    deltas = []
    async def on_text(text):
        deltas.append(text)
    result = await complete(settings, "System", [{"role": "user", "content": "Read portal"}], [], on_text)
    assert result.tool_calls[0].input == {"ref": 12}
    assert result.tool_calls[0].id == "c1"
    assert result.usage == {"input_tokens": 100, "output_tokens": 30}
    assert result.stop_reason == "tool_use"
    assert deltas == ["I will read the page."]
    assert captured["model"] == "anthropic/claude-sonnet-5.5"


@pytest.mark.asyncio
async def test_incomplete_stream_never_returns_action(monkeypatch):
    original = httpx.AsyncClient
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: original(transport=httpx.MockTransport(
        lambda request: httpx.Response(200, text='data: {"choices":[{"delta":{"content":"partial"}}]}\n\n')), **kw))
    settings = AgentSettings(expo_public_toolkit_url="https://example.test", expo_public_rork_toolkit_secret_key="test-only")
    with pytest.raises(RuntimeError, match="incomplete"):
        await complete(settings, "System", [], [])
