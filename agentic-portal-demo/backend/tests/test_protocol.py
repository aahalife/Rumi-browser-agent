import json

import pytest

from agent import protocol as p

OBS = p.Observation(
    url="/portal/home",
    title="Home",
    viewport=p.Size(width=390, height=664),
    scroll=p.Point(x=0, y=120),
    pageHeight=1400,
    elements=[
        p.Element(ref=1, role="button", name="Schedule an Appointment", tag="button"),
        p.Element(ref=2, role="combobox", name="Reason", tag="select", options=["A", "B"], value="A"),
        p.Element(ref=3, role="textbox", name="Password", tag="input", type="password"),
    ],
    text="# Home\nWelcome, Priya",
    dialogs=[],
)

CLIENT_MESSAGES = [
    p.UserMessage(text="hi"),
    p.ObservationMessage(id="1", observation=OBS),
    p.ActionResult(id="2", ok=False, error="stale ref", observation=OBS),
    p.ScreenshotMessage(id="3", jpeg_base64="abc"),
    p.ConfirmResponse(id="4", allowed=False, reason="wrong slot"),
    p.StopMessage(),
]

SERVER_MESSAGES = [
    p.RequestObservation(id="1"),
    p.ActionRequest(id="2", action="click", args={"ref": 1, "consequential": True}, highlight_ref=1),
    p.RequestScreenshot(id="3"),
    p.ConfirmRequest(id="4", summary="Schedule visit"),
    p.AgentMessage(text="hello", delta=True),
    p.Status(state="acting", step=4, max_steps=30),
    p.Done(summary="done"),
    p.ErrorMessage(message="boom", fatal=True),
]


@pytest.mark.parametrize("msg", CLIENT_MESSAGES, ids=lambda m: m.type)
def test_client_message_round_trip(msg):
    wire = json.loads(msg.model_dump_json())
    parsed = p.client_message_adapter.validate_python(wire)
    assert parsed == msg
    assert json.loads(parsed.model_dump_json()) == wire


@pytest.mark.parametrize("msg", SERVER_MESSAGES, ids=lambda m: m.type)
def test_server_message_round_trip(msg):
    wire = json.loads(msg.model_dump_json())
    parsed = p.server_message_adapter.validate_python(wire)
    assert parsed == msg


def test_observation_ignores_extra_fields_from_bridge():
    raw = OBS.model_dump()
    raw["elements"][0]["bbox"] = [0, 0, 10, 10]
    raw["future_field"] = 1
    parsed = p.Observation.model_validate(raw)
    assert parsed.elements[0].name == "Schedule an Appointment"


def test_unknown_type_rejected():
    with pytest.raises(Exception):
        p.client_message_adapter.validate_python({"type": "nope"})
