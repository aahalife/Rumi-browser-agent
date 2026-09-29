import time
from pathlib import Path

from agent.llm import LLMResult, ToolCall
from agent.router import SESSIONS
from agent.session import Session
from agent.settings import AgentSettings

OBS = {
    "url": "/portal/home", "title": "Home", "viewport": {"width": 390, "height": 664}, "scroll": {"x": 0, "y": 0},
    "pageHeight": 900, "text": "# Home\nWelcome, Priya\nDr. Anil Rao, Family Medicine",
    "elements": [{"ref": 1, "role": "button", "name": "Cancel appointment", "tag": "button", "inViewport": True}],
    "dialogs": [],
}


class ScriptedLLM:
    def __init__(self, script):
        self.script = script

    async def complete(self, system, messages, tools, on_text=None):
        call = self.script.pop(0)
        return LLMResult(text="", tool_calls=[call], content_blocks=[{"type": "tool_use", "id": call.id, "name": call.name, "input": call.input}],
                         stop_reason="tool_use", usage={}, latency_ms=1, model="fake")


def _session(script):
    settings = AgentSettings(traces_dir=Path(__file__).parent / ".data" / "traces", demo_api_key="test-demo-key")
    session = Session("wsTest1", settings, llm=ScriptedLLM(script))
    SESSIONS[session.id] = session
    return session


def _drain_until(ws, wanted_type):
    seen = []
    while True:
        msg = ws.receive_json()
        seen.append(msg)
        if msg["type"] == wanted_type:
            return msg, seen
        if msg["type"] == "error" or (msg["type"] == "status" and msg["state"] == "idle"):
            raise AssertionError(f"did not see {wanted_type}; got {seen}")


def test_session_requires_demo_key(client):
    assert client.post("/agent/sessions").status_code == 401
    r = client.post("/agent/sessions", headers={"X-Demo-Key": "test-demo-key"})
    assert r.status_code == 200 and r.json()["session_id"]


def test_full_round_trip_with_confirmation_over_websocket(client):
    session = _session([
        ToolCall("t1", "click", {"ref": 1, "consequential": False}),
        ToolCall("t2", "finish", {"summary": "Canceled it."}),
    ])
    with client.websocket_connect(f"/agent/ws?session_id={session.id}") as ws:
        ws.send_json({"type": "user_message", "text": "cancel my visit"})
        req, _ = _drain_until(ws, "request_observation")
        ws.send_json({"type": "observation", "id": req["id"], "observation": OBS})

        confirm, seen = _drain_until(ws, "confirm_request")
        assert 'Press "Cancel appointment"' in confirm["summary"]
        assert any(m["type"] == "status" and m["state"] == "waiting_for_user" for m in seen)
        ws.send_json({"type": "confirm_response", "id": confirm["id"], "allowed": True})

        action, _ = _drain_until(ws, "action_request")
        assert action["action"] == "click" and action["highlight_ref"] == 1
        ws.send_json({"type": "action_result", "id": action["id"], "ok": True, "observation": {**OBS, "url": "/portal/visits/1/cancel"}})

        done, seen = _drain_until(ws, "done")
        assert done["summary"] == "Canceled it."
        idle = ws.receive_json()
        assert idle["type"] == "status" and idle["state"] == "idle"

    trace = client.get(f"/agent/traces/{session.id}", headers={"X-Demo-Key": "test-demo-key"}).json()
    types = [e["type"] for e in trace]
    assert "confirm_request" in types and "action" in types and "done" in types
    assert client.get(f"/agent/traces/{session.id}").status_code == 401


def test_stop_over_websocket_cancels_task(client):
    session = _session([ToolCall("t1", "click", {"ref": 1, "consequential": False})])
    plain = {**OBS, "elements": [{"ref": 1, "role": "button", "name": "Visits", "tag": "button", "inViewport": True}]}
    with client.websocket_connect(f"/agent/ws?session_id={session.id}") as ws:
        ws.send_json({"type": "user_message", "text": "go"})
        req, _ = _drain_until(ws, "request_observation")
        ws.send_json({"type": "observation", "id": req["id"], "observation": plain})
        action, _ = _drain_until(ws, "action_request")
        started = time.monotonic()
        ws.send_json({"type": "stop"})
        seen = []
        while True:
            msg = ws.receive_json()
            seen.append(msg)
            if msg["type"] == "status" and msg["state"] == "idle":
                break
        assert time.monotonic() - started < 1.0, "stop must take effect within one second"
        assert any(m["type"] == "agent_message" and m["text"] == "Stopped." for m in seen)
        assert not session.busy


def test_unknown_session_is_closed(client):
    import pytest
    from starlette.websockets import WebSocketDisconnect

    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/agent/ws?session_id=nope") as ws:
            ws.receive_json()
