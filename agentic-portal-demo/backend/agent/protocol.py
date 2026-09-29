from typing import Annotated, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter


class Element(BaseModel):
    model_config = ConfigDict(extra="ignore")

    ref: int
    role: str = "generic"
    name: str = ""
    tag: str = ""
    type: str | None = None
    value: str | None = None
    checked: bool | None = None
    pressed: bool | None = None
    selected: bool | None = None
    disabled: bool = False
    inViewport: bool = True
    options: list[str] | None = None
    href: str | None = None
    context: str | None = None


class Size(BaseModel):
    width: int
    height: int


class Point(BaseModel):
    x: int
    y: int


class Observation(BaseModel):
    model_config = ConfigDict(extra="ignore")

    url: str
    title: str = ""
    viewport: Size = Size(width=0, height=0)
    scroll: Point = Point(x=0, y=0)
    pageHeight: int = 0
    elements: list[Element] = []
    text: str = ""
    dialogs: list[str] = []


# ---- client -> server ----


class UserMessage(BaseModel):
    type: Literal["user_message"] = "user_message"
    text: str


class ObservationMessage(BaseModel):
    type: Literal["observation"] = "observation"
    id: str
    observation: Observation


class ActionResult(BaseModel):
    type: Literal["action_result"] = "action_result"
    id: str
    ok: bool
    error: str | None = None
    observation: Observation | None = None


class ScreenshotMessage(BaseModel):
    type: Literal["screenshot"] = "screenshot"
    id: str
    jpeg_base64: str


class ConfirmResponse(BaseModel):
    type: Literal["confirm_response"] = "confirm_response"
    id: str
    allowed: bool
    reason: str | None = None


class StopMessage(BaseModel):
    type: Literal["stop"] = "stop"


ClientMessage = Annotated[
    Union[UserMessage, ObservationMessage, ActionResult, ScreenshotMessage, ConfirmResponse, StopMessage],
    Field(discriminator="type"),
]
client_message_adapter: TypeAdapter[ClientMessage] = TypeAdapter(ClientMessage)


# ---- server -> client ----


class RequestObservation(BaseModel):
    type: Literal["request_observation"] = "request_observation"
    id: str


class ActionRequest(BaseModel):
    type: Literal["action_request"] = "action_request"
    id: str
    action: str
    args: dict = {}
    highlight_ref: int | None = None


class RequestScreenshot(BaseModel):
    type: Literal["request_screenshot"] = "request_screenshot"
    id: str


class ConfirmRequest(BaseModel):
    type: Literal["confirm_request"] = "confirm_request"
    id: str
    summary: str


class AgentMessage(BaseModel):
    type: Literal["agent_message"] = "agent_message"
    text: str
    delta: bool = False


class Status(BaseModel):
    type: Literal["status"] = "status"
    state: Literal["thinking", "acting", "waiting_for_user", "idle"]
    step: int = 0
    max_steps: int = 0


class Done(BaseModel):
    type: Literal["done"] = "done"
    summary: str


class ErrorMessage(BaseModel):
    type: Literal["error"] = "error"
    message: str
    fatal: bool = False


ServerMessage = Annotated[
    Union[RequestObservation, ActionRequest, RequestScreenshot, ConfirmRequest, AgentMessage, Status, Done, ErrorMessage],
    Field(discriminator="type"),
]
server_message_adapter: TypeAdapter[ServerMessage] = TypeAdapter(ServerMessage)
