"""The portal frontend must survive a short-lived access token via silent refresh."""

import os
import socket
import subprocess
import sys
import time
from pathlib import Path

import httpx
import pytest

pytest.importorskip("playwright")
from playwright.sync_api import sync_playwright  # noqa: E402

ROOT = Path(__file__).parent.parent.parent
if not (ROOT / "portal" / "dist" / "index.html").exists():
    pytest.skip("portal not built", allow_module_level=True)

TTL = 2


@pytest.fixture(scope="module")
def server():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    data_dir = Path(__file__).parent / ".data" / "refresh"
    env = {
        **os.environ, "DATA_DIR": str(data_dir), "TRACES_DIR": str(data_dir / "traces"), "RESEED": "1",
        "JWT_SECRET": "test-secret", "ACCESS_TOKEN_TTL_SECONDS": str(TTL),
    }
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app.main:app", "--port", str(port)],
        cwd=Path(__file__).parent.parent, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    base = f"http://127.0.0.1:{port}"
    for _ in range(100):
        try:
            if httpx.get(f"{base}/healthz").status_code == 200:
                break
        except httpx.HTTPError:
            time.sleep(0.1)
    yield base
    proc.terminate()
    proc.wait(timeout=10)


def test_navigation_keeps_working_after_access_token_expires(server):
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_context(viewport={"width": 390, "height": 844}).new_page()
        statuses = []
        page.on("response", lambda r: statuses.append((r.url.split("/portal/api")[-1], r.status)) if "/portal/api/" in r.url else None)

        page.goto(f"{server}/portal/login")
        page.get_by_label("Username").fill("demo")
        page.get_by_label("Password").fill("demo123")
        page.get_by_role("button", name="Sign in").click()
        page.wait_for_url("**/portal/home")
        assert page.get_by_text("Welcome, Priya").is_visible()

        time.sleep(TTL + 1)  # access token is now expired; refresh token is still valid

        page.get_by_role("link", name="Visits").first.click()
        page.wait_for_url("**/portal/visits**")
        page.wait_for_selector("text=Dr. Anil Rao")
        assert "/portal/login" not in page.url
        assert any(path.startswith("/auth/refresh") and code == 200 for path, code in statuses), statuses
        assert any(path.startswith("/appointments") and code == 401 for path, code in statuses), "expected one 401 before refresh"
        assert any(path.startswith("/appointments") and code == 200 for path, code in statuses)

        time.sleep(TTL + 1)
        page.reload()
        page.wait_for_selector("text=Dr. Anil Rao")
        assert "/portal/login" not in page.url
        browser.close()
