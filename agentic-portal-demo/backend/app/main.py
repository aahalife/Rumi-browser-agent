import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse, RedirectResponse

from agent.router import router as agent_router
from portal.router import router as portal_router
from portal.seed import ensure_database
from portal.settings import settings as portal_settings

PORTAL_DIST = Path(os.environ.get("PORTAL_DIST", Path(__file__).parent.parent.parent / "portal" / "dist"))


@asynccontextmanager
async def lifespan(_: FastAPI):
    ensure_database(reseed=portal_settings.reseed)
    yield


app = FastAPI(title="CarePortal demo", lifespan=lifespan)
app.include_router(portal_router)
app.include_router(agent_router)


@app.middleware("http")
async def no_store_api_responses(request, call_next):
    # WKWebView caches JSON GETs that carry no cache headers, so the WebView
    # would show a stale appointment list after a booking or cancel.
    response = await call_next(request)
    if request.url.path.startswith("/portal/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/")
def root():
    return RedirectResponse("/portal/")


@app.get("/healthz")
def healthz():
    return {"ok": True}


@app.get("/portal")
@app.get("/portal/{path:path}")
def portal_spa(path: str = ""):
    candidate = (PORTAL_DIST / path).resolve()
    if path and candidate.is_file() and PORTAL_DIST.resolve() in candidate.parents:
        return FileResponse(candidate)
    index = PORTAL_DIST / "index.html"
    if not index.exists():
        return {"error": "portal not built; run `npm run build` in /portal"}
    return FileResponse(index, headers={"Cache-Control": "no-store"})
