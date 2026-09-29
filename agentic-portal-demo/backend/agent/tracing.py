import json
import time
from pathlib import Path


class Tracer:
    def __init__(self, traces_dir: Path, session_id: str):
        traces_dir.mkdir(parents=True, exist_ok=True)
        self.path = traces_dir / f"{session_id}.jsonl"

    def write(self, event_type: str, **data) -> None:
        record = {"ts": round(time.time(), 3), "type": event_type, **data}
        with self.path.open("a") as f:
            f.write(json.dumps(record, default=str) + "\n")

    def read(self) -> list[dict]:
        if not self.path.exists():
            return []
        return [json.loads(line) for line in self.path.read_text().splitlines() if line.strip()]
