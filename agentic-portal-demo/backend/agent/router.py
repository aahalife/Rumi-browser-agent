import uuid

from fastapi import APIRouter, Depends, Header, HTTPException, WebSocket, WebSocketDisconnect

from .session import Session
from .settings import settings
from .tracing import Tracer

router = APIRouter(prefix="/agent")
SESSIONS: dict[str, Session] = {}


def require_demo_key(x_demo_key: str = Header(default="")):
    if x_demo_key != settings.demo_api_key:
        raise HTTPException(401, "Bad demo key")


@router.post("/sessions")
def create_session(_: None = Depends(require_demo_key)):
    session_id = uuid.uuid4().hex
    SESSIONS[session_id] = Session(session_id, settings)
    return {"session_id": session_id}


@router.get("/traces/{session_id}")
def get_trace(session_id: str, _: None = Depends(require_demo_key)):
    if not session_id.isalnum():
        raise HTTPException(404, "No such trace")
    events = Tracer(settings.traces_dir, session_id).read()
    if not events:
        raise HTTPException(404, "No such trace")
    return events


@router.websocket("/ws")
async def agent_ws(websocket: WebSocket, session_id: str):
    session = SESSIONS.get(session_id)
    await websocket.accept()
    if session is None:
        # Accept first so the close code reaches the client; closing before accept is an HTTP 403.
        await websocket.close(code=4004, reason="unknown session")
        return
    session.ws = websocket
    try:
        while True:
            await session.handle(await websocket.receive_json())
    except WebSocketDisconnect:
        pass
    finally:
        if session.ws is websocket:
            session.ws = None
