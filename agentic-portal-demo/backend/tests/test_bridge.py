"""Runs shared/agent-bridge.js inside a real Chromium against the built portal."""

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
BRIDGE = (ROOT / "shared" / "agent-bridge.js").read_text()

if not (ROOT / "portal" / "dist" / "index.html").exists():
    pytest.skip("portal not built (run npm run build in /portal)", allow_module_level=True)


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def server():
    port = _free_port()
    data_dir = Path(__file__).parent / ".data" / "bridge"
    env = {**os.environ, "DATA_DIR": str(data_dir), "TRACES_DIR": str(data_dir / "traces"), "RESEED": "1", "JWT_SECRET": "test-secret"}
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
    else:
        proc.kill()
        raise RuntimeError("backend did not start")
    yield base
    proc.terminate()
    proc.wait(timeout=10)


@pytest.fixture(scope="module")
def page(server):
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        context = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
        context.add_init_script(BRIDGE)
        page = context.new_page()
        page.goto(f"{server}/portal/login")
        page.wait_for_selector("text=Sign in")
        yield page
        browser.close()


def snapshot(page):
    return page.evaluate("() => window.agentBridge.snapshot()")


def by_name(obs, name):
    return next(e for e in obs["elements"] if e["name"] == name)


def test_login_page_snapshot_has_semantic_elements(page):
    obs = snapshot(page)
    assert obs["url"].startswith("/portal/login")
    assert obs["title"]
    names = {e["name"] for e in obs["elements"]}
    assert {"Username", "Password", "Sign in"} <= names
    pw = by_name(obs, "Password")
    assert pw["type"] == "password" and "value" not in pw
    assert "# " in obs["text"] or "## " in obs["text"]
    refs = [e["ref"] for e in obs["elements"]]
    assert refs == list(range(1, len(refs) + 1))


def test_type_text_refuses_password_fields(page):
    obs = snapshot(page)
    ref = by_name(obs, "Password")["ref"]
    with pytest.raises(Exception, match="refused"):
        page.evaluate("(r) => window.agentBridge.typeText(r, 'x', true)", ref)


def test_type_text_updates_react_controlled_input(page):
    obs = snapshot(page)
    ref = by_name(obs, "Username")["ref"]
    page.evaluate("(r) => window.agentBridge.typeText(r, 'demo', true)", ref)
    assert page.get_by_label("Username").input_value() == "demo"
    assert by_name(snapshot(page), "Username")["value"] == "demo"


def test_stale_ref_error_and_click_navigates(page):
    page.get_by_label("Password").fill("demo123")
    obs = snapshot(page)
    ref = by_name(obs, "Sign in")["ref"]
    page.evaluate("(r) => window.agentBridge.click(r)", ref)
    page.evaluate("() => window.agentBridge.waitForSettle({quietMs: 300, timeoutMs: 5000})")
    page.wait_for_url("**/portal/home")
    with pytest.raises(Exception, match="stale ref"):
        page.evaluate("(r) => window.agentBridge.click(r)", 999)
    obs = snapshot(page)
    assert "Welcome, Priya" in obs["text"]
    assert any("Dr. Anil Rao" in ln for ln in obs["text"].splitlines())


def test_select_option_and_settle_on_cancel_page(page, server):
    page.goto(f"{server}/portal/visits")
    page.wait_for_selector("text=Upcoming")
    obs = snapshot(page)
    cancel_refs = [e for e in obs["elements"] if e["name"] == "Cancel"]
    assert cancel_refs, obs["elements"]
    assert "Dr. Anil Rao" in cancel_refs[0]["context"] and "Cancel" not in cancel_refs[0]["context"]
    assert "Details" not in cancel_refs[0]["context"]
    assert "\n" in cancel_refs[0]["context"], "context must be line separated for the approval sheet"
    assert "Dr. Sarah Goldberg" in cancel_refs[1]["context"]
    page.evaluate("(r) => window.agentBridge.click(r)", cancel_refs[0]["ref"])
    page.evaluate("() => window.agentBridge.waitForSettle({})")
    obs = snapshot(page)
    select = next(e for e in obs["elements"] if e["tag"] == "select")
    assert "Scheduling conflict" in select["options"]
    result = page.evaluate("([r, o]) => window.agentBridge.selectOption(r, o)", [select["ref"], "scheduling conflict"])
    assert result["value"] == "Scheduling conflict"
    assert next(e for e in snapshot(page)["elements"] if e["tag"] == "select")["value"] == "Scheduling conflict"
    assert any(e["name"] == "Cancel appointment" for e in obs["elements"])


def test_scroll_and_highlight(page, server):
    page.goto(f"{server}/portal/visits?tab=past")
    page.wait_for_selector("text=Past")
    before = snapshot(page)["scroll"]["y"]
    res = page.evaluate("() => window.agentBridge.scroll({direction: 'down'})")
    assert res["ok"]
    assert res["scroll"]["y"] >= before
    ref = snapshot(page)["elements"][0]["ref"]
    assert page.evaluate("(r) => window.agentBridge.highlight(r, 50)", ref)["ok"]
    assert page.evaluate("() => document.querySelectorAll('[data-agent-overlay]').length") == 0
