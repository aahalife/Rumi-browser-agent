"""Summarize one or more eval logs as a markdown table: python -m harness.report dom.jsonl [screenshot.jsonl ...]"""

import json
import sys
from collections import defaultdict
from statistics import mean


def summarize(path: str) -> dict[str, dict]:
    rows = defaultdict(list)
    for line in open(path):
        e = json.loads(line)
        rows[e["task"]].append(e)
    out = {}
    for task, runs in rows.items():
        stats = [r["stats"] for r in runs if r.get("stats")]
        out[task] = {
            "runs": len(runs),
            "passed": sum(1 for r in runs if r["passed"]),
            "actions": mean(s.get("actions", 0) for s in stats) if stats else 0,
            "llm_calls": mean(s.get("llm_calls", 0) for s in stats) if stats else 0,
            "tokens_in": mean(s.get("tokens_in", 0) for s in stats) if stats else 0,
            "tokens_out": mean(s.get("tokens_out", 0) for s in stats) if stats else 0,
            "seconds": mean(r.get("elapsed_s", 0) for r in runs),
        }
    return out


def table(label: str, summary: dict[str, dict]) -> str:
    lines = [
        f"**{label}**",
        "",
        "| Task | Pass | Actions | Model calls | Tokens in | Tokens out | Seconds |",
        "|---|---|---|---|---|---|---|",
    ]
    for task, s in summary.items():
        lines.append(
            f"| {task} | {s['passed']}/{s['runs']} | {s['actions']:.1f} | {s['llm_calls']:.1f} | "
            f"{s['tokens_in']:,.0f} | {s['tokens_out']:,.0f} | {s['seconds']:.0f} |"
        )
    total_runs = sum(s["runs"] for s in summary.values())
    total_pass = sum(s["passed"] for s in summary.values())
    lines.append(f"| **All** | **{total_pass}/{total_runs}** | | | {sum(s['tokens_in'] for s in summary.values()):,.0f} | {sum(s['tokens_out'] for s in summary.values()):,.0f} | {sum(s['seconds'] for s in summary.values()):.0f} |")
    return "\n".join(lines)


if __name__ == "__main__":
    for path in sys.argv[1:]:
        print(table(path, summarize(path)))
        print()
