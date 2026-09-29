import asyncio
import base64
import json
import os
import time
from collections.abc import Callable
from pathlib import Path

import httpx
import websockets
from playwright.async_api import Browser, Page, Playwright, async_playwright

BRIDGE_JS = (Path(__file__).parent.parent.parent / "shared" / "agent-bridge.js").read_text()


class FakePhone:
    """Plays the iOS app's role: a mobile browser plus the agent WebSocket client."""

    def __init__(self, base_url: str | None = None, demo_key: str | None = None, headed: bool = False):
        self.base_url = (base_url or os.environ.get("BACKEND_URL", "http://localhost:8000")).rstrip("/")
        self.demo_key = demo_key or os.environ.get("DEMO_API_KEY", "change-me")
        self.headed = headed
        self.session_id: str | None = None
        self.transcript: list[dict] = []
        self._pw: Playwright | None = None
        self._browser: Browser | None = None
        self.page: Page | None = None
        self._ws = None
        self.device_token: str | None = None  # the phone's saved sign-in, issued after a manual login

    async def __aenter__(self):
        self._pw = await async_playwright().start()
        self._browser = await self._pw.chromium.launch(headless=not self.headed)
        context = await self._browser.new_context(
            viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True
        )
        await context.add_init_script(BRIDGE_JS)
        self.page = await context.new_page()
        await self.page.goto(f"{self.base_url}/portal/login")
        return self

    async def __aexit__(self, *exc):
        if self._ws:
            await self._ws.close()
        if self._browser:
            await self._browser.close()
        if self._pw:
            await self._pw.stop()

    async def login(self, username: str, password: str) -> None:
        await self.page.goto(f"{self.base_url}/portal/login")
        await self.page.get_by_label("Username").fill(username)
        await self.page.get_by_label("Password").fill(password)
        await self.page.get_by_role("button", name="Sign in").click()
        await self.page.wait_for_url("**/portal/home", timeout=10000)
        # Like the iOS app: right after a manual sign-in, ask for a device token and keep it outside the page.
        self.device_token = await self.page.evaluate(
            """async () => {
                const r = await fetch('/portal/api/auth/device-token', {method: 'POST', credentials: 'include',
                    headers: {'content-type': 'application/json'}, body: JSON.stringify({label: 'Harness phone'})});
                return r.ok ? (await r.json()).token : null;
            }"""
        )

    async def restore_session(self) -> None:
        if not self.device_token:
            raise RuntimeError("No saved sign-in on this phone. Ask the patient to sign in.")
        async with httpx.AsyncClient() as http:
            r = await http.post(f"{self.base_url}/portal/api/auth/device-login", json={"token": self.device_token})
        if r.status_code != 200:
            self.device_token = None
            raise RuntimeError("The saved sign-in on this phone is no longer valid. Ask the patient to sign in.")
        code = r.json()["code"]
        await self.page.goto(f"{self.base_url}/portal/api/auth/device-login/complete?code={code}&next=/portal/home")

    async def logout_silently(self) -> None:
        await self.page.context.clear_cookies()

    async def goto(self, path: str) -> None:
        await self.page.goto(f"{self.base_url}{path}")
        await self.settle()

    async def settle(self) -> None:
        await self.page.evaluate("() => window.agentBridge.waitForSettle({quietMs: 500, timeoutMs: 5000})")

    async def snapshot(self) -> dict:
        return await self.page.evaluate("() => window.agentBridge.snapshot()")

    async def screenshot_b64(self) -> str:
        png = await self.page.screenshot(type="jpeg", quality=60, scale="css")
        return base64.b64encode(png).decode()

    async def connect(self) -> str:
        async with httpx.AsyncClient() as http:
            r = await http.post(f"{self.base_url}/agent/sessions", headers={"X-Demo-Key": self.demo_key})
            r.raise_for_status()
            self.session_id = r.json()["session_id"]
        ws_url = self.base_url.replace("http://", "ws://").replace("https://", "wss://")
        self._ws = await websockets.connect(f"{ws_url}/agent/ws?session_id={self.session_id}", max_size=16 * 1024 * 1024)
        return self.session_id

    async def _send(self, msg: dict) -> None:
        await self._ws.send(json.dumps(msg))

    async def do_action(self, action: str, args: dict) -> tuple[bool, str | None]:
        page = self.page
        try:
            if action == "click":
                await page.evaluate("(r) => window.agentBridge.click(r)", args["ref"])
            elif action == "type_text":
                await page.evaluate(
                    "([r, t, c]) => window.agentBridge.typeText(r, t, c)",
                    [args["ref"], args["text"], args.get("clear", True)],
                )
            elif action == "select_option":
                await page.evaluate("([r, o]) => window.agentBridge.selectOption(r, o)", [args["ref"], args["option"]])
            elif action == "scroll":
                await page.evaluate("(a) => window.agentBridge.scroll(a)", args)
            elif action == "go_back":
                await page.go_back()
            elif action == "navigate":
                await page.goto(f"{self.base_url}{args['path']}")
            elif action == "wait":
                await asyncio.sleep(min(int(args.get("ms", 500)), 3000) / 1000)
            elif action == "restore_session":
                await self.restore_session()
            else:
                return False, f"unknown action {action}"
            await self.settle()
            return True, None
        except Exception as exc:  # noqa: BLE001 - report every failure to the agent
            msg = str(exc).split("\n")[0]
            return False, msg

    async def run_task(
        self,
        text: str,
        confirm: Callable[[str], tuple[bool, str | None]] | None = None,
        on_event: Callable[[dict], None] | None = None,
        timeout: float = 600,
    ) -> dict:
        """Send one task and pump messages until the agent is done or waits for the patient."""
        if self._ws is None:
            await self.connect()
        await self._send({"type": "user_message", "text": text})
        self.transcript.append({"role": "patient", "text": text})
        outcome = {"state": "unknown", "summary": None, "question": None, "error": None, "steps": 0, "confirms": []}
        agent_text = ""
        active = False  # becomes true at the first non-idle status; a stale idle status from a previous task is ignored
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            raw = await asyncio.wait_for(self._ws.recv(), timeout=deadline - time.monotonic())
            msg = json.loads(raw)
            if on_event:
                on_event(msg)
            t = msg["type"]
            if t == "request_observation":
                await self._send({"type": "observation", "id": msg["id"], "observation": await self.snapshot()})
            elif t == "action_request":
                ok, err = await self.do_action(msg["action"], msg["args"])
                await self._send({"type": "action_result", "id": msg["id"], "ok": ok, "error": err, "observation": await self.snapshot()})
            elif t == "request_screenshot":
                await self._send({"type": "screenshot", "id": msg["id"], "jpeg_base64": await self.screenshot_b64()})
            elif t == "confirm_request":
                allowed, reason = confirm(msg["summary"]) if confirm else (True, None)
                outcome["confirms"].append({"summary": msg["summary"], "allowed": allowed})
                self.transcript.append({"role": "confirm", "text": msg["summary"], "allowed": allowed})
                await self._send({"type": "confirm_response", "id": msg["id"], "allowed": allowed, "reason": reason})
            elif t == "agent_message":
                if msg["delta"]:
                    agent_text += msg["text"]
                else:
                    if agent_text.strip():
                        self.transcript.append({"role": "agent", "text": agent_text.strip()})
                        agent_text = ""
                    self.transcript.append({"role": "agent", "text": msg["text"]})
            elif t == "status":
                outcome["steps"] = max(outcome["steps"], msg["step"])
                if msg["state"] != "idle":
                    active = True
                elif active:
                    # Only a stop ends with a bare idle status; done/error return before their idle.
                    outcome["state"] = "stopped"
                    return outcome
                if msg["state"] == "waiting_for_user" and outcome.get("_asked"):
                    outcome["state"] = "waiting_for_user"
                    return outcome
            elif t == "done":
                if agent_text.strip():
                    self.transcript.append({"role": "agent", "text": agent_text.strip()})
                outcome.update(state="done", summary=msg["summary"])
                self.transcript.append({"role": "agent", "text": msg["summary"]})
                return outcome
            elif t == "error":
                outcome.update(state="error", error=msg["message"])
                self.transcript.append({"role": "error", "text": msg["message"]})
                if msg["fatal"]:
                    return outcome
            # An ask_user or step-limit message is a non-delta agent_message followed by waiting_for_user.
            if t == "agent_message" and not msg["delta"]:
                outcome["_asked"] = True
                outcome["question"] = msg["text"]
        outcome["state"] = "timeout"
        return outcome

    async def stop(self) -> None:
        await self._send({"type": "stop"})

    async def trace(self) -> list[dict]:
        async with httpx.AsyncClient() as http:
            r = await http.get(f"{self.base_url}/agent/traces/{self.session_id}", headers={"X-Demo-Key": self.demo_key})
            r.raise_for_status()
            return r.json()


def trace_stats(events: list[dict]) -> dict:
    llm = [e for e in events if e["type"] == "llm"]
    usage = {}
    for e in llm:
        for k, v in (e.get("usage") or {}).items():
            usage[k] = usage.get(k, 0) + v
    return {
        "llm_calls": len(llm),
        "tokens_in": usage.get("input_tokens", 0) + usage.get("cache_read_input_tokens", 0) + usage.get("cache_creation_input_tokens", 0),
        "tokens_out": usage.get("output_tokens", 0),
        "llm_latency_ms": sum(e.get("latency_ms", 0) for e in llm),
        "actions": sum(1 for e in events if e["type"] == "action"),
    }
