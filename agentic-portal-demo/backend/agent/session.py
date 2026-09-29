import asyncio
import uuid
from collections.abc import Callable

from fastapi import WebSocket
from pydantic import BaseModel

from .llm import LLMClient
from .loop import AgentLoop
from .protocol import (
    ActionRequest,
    ActionResult,
    AgentMessage,
    ConfirmRequest,
    ConfirmResponse,
    ErrorMessage,
    Observation,
    RequestObservation,
    RequestScreenshot,
    Status,
    StopMessage,
    UserMessage,
    client_message_adapter,
)
from .settings import AgentSettings
from .tracing import Tracer


class Session:
    def __init__(self, session_id: str, settings: AgentSettings, llm: LLMClient | None = None):
        self.id = session_id
        self.settings = settings
        self.ws: WebSocket | None = None
        self.pending: dict[str, asyncio.Future] = {}
        self.task: asyncio.Task | None = None
        self.tracer = Tracer(settings.traces_dir, session_id)
        self.loop = AgentLoop(self, llm or LLMClient(settings), self.tracer, settings)

    @property
    def busy(self) -> bool:
        return self.task is not None and not self.task.done()

    async def send(self, msg: BaseModel) -> None:
        if self.ws is None:
            return
        try:
            await self.ws.send_text(msg.model_dump_json())
        except RuntimeError:
            self.ws = None

    async def _request(self, make: Callable[[str], BaseModel], timeout: float):
        request_id = uuid.uuid4().hex
        future = asyncio.get_running_loop().create_future()
        self.pending[request_id] = future
        try:
            await self.send(make(request_id))
            return await asyncio.wait_for(future, timeout)
        finally:
            self.pending.pop(request_id, None)

    async def request_observation(self) -> Observation:
        msg = await self._request(lambda i: RequestObservation(id=i), self.settings.action_timeout_seconds)
        return msg.observation

    async def execute_action(self, action: str, args: dict, highlight_ref: int | None) -> ActionResult:
        return await self._request(
            lambda i: ActionRequest(id=i, action=action, args=args, highlight_ref=highlight_ref),
            self.settings.action_timeout_seconds,
        )

    async def request_screenshot(self) -> str:
        msg = await self._request(lambda i: RequestScreenshot(id=i), self.settings.action_timeout_seconds)
        return msg.jpeg_base64

    async def request_confirm(self, summary: str) -> ConfirmResponse:
        return await self._request(lambda i: ConfirmRequest(id=i, summary=summary), self.settings.confirm_timeout_seconds)

    async def handle(self, raw: dict) -> None:
        msg = client_message_adapter.validate_python(raw)
        if isinstance(msg, UserMessage):
            if self.busy:
                self.loop.queue_user_message(msg.text)
            else:
                self.task = asyncio.create_task(self._run(msg.text))
            return
        if isinstance(msg, StopMessage):
            if self.busy:
                self.task.cancel()
            return
        future = self.pending.get(msg.id)
        if future is not None and not future.done():
            future.set_result(msg)

    async def _run(self, text: str) -> None:
        try:
            await self.loop.run_turn(text)
        except asyncio.CancelledError:
            await self.send(AgentMessage(text="Stopped.", delta=False))
            await self.send(Status(state="idle", step=self.loop.step, max_steps=self.settings.max_steps))
        except Exception as exc:  # noqa: BLE001 - recover without exposing provider payloads
            self.tracer.write("error", category=type(exc).__name__)
            self.loop._close_dangling_tool_use("The operation failed. Ask the patient before trying again.")
            await self.send(ErrorMessage(message="The assistant couldn’t complete this request. Check the connection and try again; review the portal before repeating a change.", fatal=True))
            await self.send(Status(state="idle", step=self.loop.step, max_steps=self.settings.max_steps))
