import argparse
import asyncio
import json
import sys
import time

from .client import FakePhone, trace_stats


def _ask_confirm(summary: str) -> tuple[bool, str | None]:
    print(f"\n[confirm] {summary}")
    answer = input("Allow? [y/N] ").strip().lower()
    if answer == "y":
        return True, None
    return False, input("Reason (optional): ").strip() or None


async def main() -> int:
    ap = argparse.ArgumentParser(description="Run one agent task through the fake phone.")
    ap.add_argument("--task", required=True)
    ap.add_argument("--login", default="demo:demo123", help="username:password, or 'none' to skip login")
    ap.add_argument("--auto-confirm", action="store_true")
    ap.add_argument("--base-url", default=None)
    ap.add_argument("--headed", action="store_true")
    ap.add_argument("--verbose", action="store_true", help="print every protocol message")
    ap.add_argument("--stop-after", type=float, default=None, help="send stop after N seconds (for testing stop)")
    args = ap.parse_args()

    def on_event(msg: dict) -> None:
        t = msg["type"]
        if args.verbose:
            print(f"  <- {json.dumps(msg)[:300]}")
        elif t == "action_request":
            print(f"  action: {msg['action']} {json.dumps(msg['args'])}")
        elif t == "status":
            print(f"  status: {msg['state']} (step {msg['step']}/{msg['max_steps']})")

    started = time.monotonic()
    async with FakePhone(base_url=args.base_url, headed=args.headed) as phone:
        if args.login != "none":
            user, pw = args.login.split(":", 1)
            await phone.login(user, pw)
            print(f"logged in as {user}")
        await phone.connect()
        print(f"session {phone.session_id}")
        confirm = (lambda s: (True, None)) if args.auto_confirm else _ask_confirm
        task = asyncio.create_task(phone.run_task(args.task, confirm=confirm, on_event=on_event))
        if args.stop_after:
            await asyncio.sleep(args.stop_after)
            print("sending stop")
            await phone.stop()
        outcome = await task
        print("\n--- transcript ---")
        for line in phone.transcript:
            print(f"[{line['role']}] {line['text']}")
        print("\n--- outcome ---")
        print(json.dumps({k: v for k, v in outcome.items() if not k.startswith("_")}, indent=2))
        try:
            print("stats:", json.dumps(trace_stats(await phone.trace())))
        except Exception as exc:  # noqa: BLE001
            print(f"(no trace: {exc})")
        print(f"elapsed: {time.monotonic() - started:.1f}s")
    return 0 if outcome["state"] in ("done", "waiting_for_user") else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
