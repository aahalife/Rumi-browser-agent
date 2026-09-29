import asyncio
from pathlib import Path

import pytest

from agent.llm import LLMResult, ToolCall
from agent.loop import AgentLoop
from agent.protocol import ActionResult, ConfirmResponse, Element, Observation, Point, Size
from agent.settings import AgentSettings
from agent.tracing import Tracer


def obs(url="/portal/home", elements=None, text="# Home\nWelcome, Priya"):
    return Observation(
        url=url, title="Home", viewport=Size(width=390, height=664), scroll=Point(x=0, y=0), pageHeight=800,
        elements=elements or [
            Element(ref=1, role="button", name="Visits", tag="button"),
            Element(ref=2, role="button", name="Schedule", tag="button"),
            Element(ref=3, role="textbox", name="Password", tag="input", type="password"),
        ],
        text=text,
    )


def tool(name, **args):
    return ToolCall(id=f"tu_{name}_{id(args)}", name=name, input=args)


class FakeLLM:
    def __init__(self, script):
        self.script = list(script)
        self.calls = []

    async def complete(self, system, messages, tools, on_text=None):
        self.calls.append(messages)
        item = self.script.pop(0) if self.script else tool("finish", summary="out of script")
        if item == "hang":
            await asyncio.sleep(3600)
        if callable(item):
            item = item(messages)
        calls = item if isinstance(item, list) else [item]
        blocks = [{"type": "tool_use", "id": c.id, "name": c.name, "input": c.input} for c in calls]
        if on_text:
            await on_text("thinking aloud ")
        return LLMResult(text="thinking aloud ", tool_calls=calls, content_blocks=blocks, stop_reason="tool_use",
                         usage={"input_tokens": 10, "output_tokens": 5}, latency_ms=1, model="fake")


class FakeClient:
    def __init__(self, allow=True, action_error=None, hang_actions=False):
        self.sent = []
        self.actions = []
        self.confirms = []
        self.allow = allow
        self.action_error = action_error
        self.hang_actions = hang_actions
        self.screenshots = 0

    async def send(self, msg):
        self.sent.append(msg)

    async def request_observation(self):
        return obs()

    async def execute_action(self, action, args, highlight_ref):
        self.actions.append((action, args, highlight_ref))
        if self.hang_actions:
            await asyncio.sleep(3600)
        if self.action_error:
            return ActionResult(id="x", ok=False, error=self.action_error, observation=obs())
        url = args.get("path") if action == "navigate" else f"/portal/after/{len(self.actions)}"
        return ActionResult(id="x", ok=True, observation=obs(url=url))

    async def request_screenshot(self):
        self.screenshots += 1
        return "ZmFrZQ=="

    async def request_confirm(self, summary):
        self.confirms.append(summary)
        return ConfirmResponse(id="c", allowed=self.allow, reason=None if self.allow else "not that one")

    def types(self):
        return [m.type for m in self.sent]


def make_loop(client, llm, **overrides):
    settings = AgentSettings(traces_dir=Path(__file__).parent / ".data" / "traces", **overrides)
    return AgentLoop(client, llm, Tracer(settings.traces_dir, "test"), settings)


async def test_finish_sends_done():
    client = FakeClient()
    loop = make_loop(client, FakeLLM([tool("finish", summary="Your next visit is with Dr. Rao.")]))
    await loop.run_turn("When is my next appointment?")
    done = next(m for m in client.sent if m.type == "done")
    assert done.summary == "Your next visit is with Dr. Rao."
    assert client.sent[-1].type == "status" and client.sent[-1].state == "idle"
    assert any(m.type == "agent_message" and m.delta for m in client.sent)


async def test_click_executes_and_history_alternates():
    client = FakeClient()
    loop = make_loop(client, FakeLLM([tool("click", ref=1, consequential=False), tool("finish", summary="ok")]))
    await loop.run_turn("go to visits")
    assert client.actions == [("click", {"ref": 1, "consequential": False}, 1)]
    roles = [m["role"] for m in loop.messages()]
    assert roles == ["user", "assistant", "user", "assistant", "user"]


async def test_gate_fires_on_button_name_and_decline_is_reported():
    client = FakeClient(allow=False)
    seen = {}

    def second(messages):
        seen["last_tool_result"] = messages[-1]["content"][0]["content"][0]["text"]
        return tool("finish", summary="declined")

    loop = make_loop(client, FakeLLM([tool("click", ref=2, consequential=False), second]))
    await loop.run_turn("book it")
    assert client.confirms and 'Press "Schedule"' in client.confirms[0]
    assert client.actions == []
    assert "declined" in seen["last_tool_result"] and "not that one" in seen["last_tool_result"]


async def test_gate_fires_on_consequential_flag():
    client = FakeClient(allow=True)
    loop = make_loop(client, FakeLLM([tool("click", ref=1, consequential=True), tool("finish", summary="ok")]))
    await loop.run_turn("do it")
    assert len(client.confirms) == 1
    assert len(client.actions) == 1
    assert "waiting_for_user" in [m.state for m in client.sent if m.type == "status"]


async def test_password_field_refused_and_navigate_restricted():
    client = FakeClient()
    results = []

    def capture(messages):
        results.append(messages[-1]["content"][0]["content"][0]["text"])
        return tool("navigate", path="https://evil.example/portal/x") if len(results) == 1 else tool("finish", summary="")

    loop = make_loop(client, FakeLLM([tool("type_text", ref=3, text="hunter2"), capture, capture]))
    await loop.run_turn("log me in")
    assert client.actions == []
    assert "password" in results[0]
    assert "navigate" in results[1]


async def test_ask_user_pauses_and_reply_continues():
    client = FakeClient()
    llm = FakeLLM([tool("ask_user", question="Which one?"), tool("finish", summary="done")])
    loop = make_loop(client, llm)
    await loop.run_turn("cancel my appointment")
    assert client.sent[-1].state == "waiting_for_user"
    assert any(m.type == "agent_message" and m.text == "Which one?" for m in client.sent)
    await loop.run_turn("the second one")
    messages = llm.calls[-1]
    assert messages[-1]["role"] == "user"
    assert "Patient: the second one" in str(messages[-1]["content"])
    assert client.sent[-1].state == "idle"


async def test_compaction_keeps_only_latest_observation():
    client = FakeClient()
    llm = FakeLLM([tool("click", ref=1, consequential=False)] * 3 + [tool("finish", summary="x")])
    loop = make_loop(client, llm, keep_observations=1)
    await loop.run_turn("navigate around")
    text = str(llm.calls[-1])
    assert text.count("<observation") == 1
    assert "step 1: click" in text and "step 2: click" in text
    assert "page excerpt: # Home Welcome, Priya" in text


async def test_compaction_default_keeps_recent_window():
    client = FakeClient()
    llm = FakeLLM([tool("click", ref=1, consequential=False)] * 5 + [tool("finish", summary="x")])
    loop = make_loop(client, llm)  # keep_observations defaults to 3
    await loop.run_turn("navigate around")
    assert str(llm.calls[-1]).count("<observation") == 3


async def test_navigate_loop_guard_nudges_model():
    client = FakeClient()
    nav = [tool("navigate", path="/portal/visits"), tool("navigate", path="/portal/schedule")] * 2
    llm = FakeLLM(nav + [tool("finish", summary="x")])
    loop = make_loop(client, llm)
    await loop.run_turn("move it")
    assert "repeated the same navigation" in str(llm.calls[-1])


async def test_two_failures_attach_screenshot():
    client = FakeClient(action_error="stale ref 1")
    loop = make_loop(client, FakeLLM([tool("click", ref=1, consequential=False)] * 2 + [tool("finish", summary="x")]))
    await loop.run_turn("x")
    assert client.screenshots == 1
    # entries: ..., assistant(click #2), user(tool_result + image), assistant(finish), user(tool_result)
    blocks = loop.entries[-3]["content"][0]["content"]
    assert any(b.get("type") == "image" for b in blocks)


async def test_screenshot_mode_sends_image_every_step_with_minimal_text():
    client = FakeClient()
    llm = FakeLLM([tool("click", ref=1, consequential=False), tool("finish", summary="x")])
    loop = make_loop(client, llm, perception_mode="screenshot")
    await loop.run_turn("look")
    assert client.screenshots == 2  # first observation + one action result
    first_call = llm.calls[0][0]["content"]
    assert any(b.get("type") == "image" for b in first_call)
    assert "## Page text" not in str(first_call)


async def test_max_steps_asks_how_to_proceed():
    client = FakeClient()
    loop = make_loop(client, FakeLLM([tool("click", ref=1, consequential=False)] * 10), max_steps=3)
    await loop.run_turn("loop forever")
    assert len(client.actions) == 3
    assert client.sent[-1].state == "waiting_for_user"
    assert "stopped after 3 steps" in client.sent[-2].text


async def test_queued_user_message_is_injected():
    client = FakeClient()
    llm = FakeLLM([tool("click", ref=1, consequential=False), tool("finish", summary="x")])
    loop = make_loop(client, llm)
    loop.queue_user_message("actually, afternoon please")
    await loop.run_turn("book")
    assert "Patient says: actually, afternoon please" in str(llm.calls[0])


async def test_stop_during_action_cancels_quickly_and_closes_history():
    client = FakeClient(hang_actions=True)
    loop = make_loop(client, FakeLLM([tool("click", ref=1, consequential=False)]))
    task = asyncio.create_task(loop.run_turn("x"))
    await asyncio.sleep(0.05)
    assert client.actions, "action should be in flight"
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await asyncio.wait_for(task, timeout=1)
    roles = [m["role"] for m in loop.messages()]
    assert roles[-1] == "user"
    assert "Stopped by the patient" in str(loop.messages()[-1]["content"])


async def test_stop_during_llm_call_leaves_history_consistent():
    client = FakeClient()
    loop = make_loop(client, FakeLLM([tool("click", ref=1, consequential=False), "hang"]))
    task = asyncio.create_task(loop.run_turn("x"))
    await asyncio.sleep(0.05)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await asyncio.wait_for(task, timeout=1)
    roles = [m["role"] for m in loop.messages()]
    assert roles == ["user", "assistant", "user"]


async def test_restore_session_is_forwarded_to_the_phone():
    client = FakeClient()
    loop = make_loop(client, FakeLLM([tool("restore_session"), tool("finish", summary="signed in")]))
    await loop.run_turn("book something")
    assert client.actions[0][0] == "restore_session"
    assert client.confirms == []
