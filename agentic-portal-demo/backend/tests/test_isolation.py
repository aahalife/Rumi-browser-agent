import ast
from pathlib import Path

AGENT_DIR = Path(__file__).parent.parent / "agent"
FORBIDDEN_PACKAGES = {"portal", "app", "harness", "sqlalchemy", "sqlite3"}


def _imports(tree: ast.AST):
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                yield alias.name
        elif isinstance(node, ast.ImportFrom):
            if node.level == 0 and node.module:
                yield node.module


def test_agent_never_imports_portal():
    offenders = []
    for path in AGENT_DIR.glob("*.py"):
        tree = ast.parse(path.read_text())
        for name in _imports(tree):
            if name.split(".")[0] in FORBIDDEN_PACKAGES:
                offenders.append(f"{path.name}: {name}")
    assert not offenders, f"agent package must stay isolated from the portal: {offenders}"


def test_agent_never_calls_portal_api():
    offenders = [p.name for p in AGENT_DIR.glob("*.py") if "/portal/api" in p.read_text()]
    assert not offenders, f"agent code references the portal API: {offenders}"
