import re

CONSEQUENTIAL_NAME = re.compile(r"(schedule|book|confirm|cancel appointment|submit|\bsend\b|request refill|finish check|\bsign\b(?! in)|sign out|log out)", re.I)

ACTION_TOOLS = {"click", "type_text", "select_option", "scroll", "go_back", "navigate", "wait", "restore_session"}


def _tool(name: str, description: str, properties: dict, required: list[str]) -> dict:
    return {
        "name": name,
        "description": description,
        "input_schema": {"type": "object", "properties": properties, "required": required},
    }


TOOLS = [
    _tool(
        "click",
        "Click an element by its [ref] from the latest observation. Set consequential=true for anything that books, cancels, schedules, confirms, or submits.",
        {
            "ref": {"type": "integer"},
            "consequential": {"type": "boolean", "description": "true if this click books, cancels, or submits something"},
        },
        ["ref", "consequential"],
    ),
    _tool(
        "type_text",
        "Type text into a text field by [ref]. Refused for password fields.",
        {
            "ref": {"type": "integer"},
            "text": {"type": "string"},
            "clear": {"type": "boolean", "description": "clear the field first (default true)"},
        },
        ["ref", "text"],
    ),
    _tool(
        "select_option",
        "Choose an option in a <select> element by [ref]. Match by visible label or value.",
        {"ref": {"type": "integer"}, "option": {"type": "string"}},
        ["ref", "option"],
    ),
    _tool(
        "scroll",
        "Scroll the page up or down, or scroll a [ref] into view.",
        {
            "direction": {"type": "string", "enum": ["up", "down"]},
            "ref": {"type": "integer"},
        },
        [],
    ),
    _tool("go_back", "Browser back.", {}, []),
    _tool(
        "navigate",
        "Go directly to a portal path such as /portal/home, /portal/visits, or /portal/schedule. Only /portal/ paths are allowed.",
        {"path": {"type": "string"}},
        ["path"],
    ),
    _tool("wait", "Wait up to 3000 ms for the page to update.", {"ms": {"type": "integer", "maximum": 3000}}, ["ms"]),
    _tool("get_screenshot", "Get a screenshot of the current page when the text observation is not enough.", {}, []),
    _tool(
        "restore_session",
        "Only when the page is the CarePortal sign-in page: ask the patient's phone to sign them back in with its saved device sign-in. No password is involved. If it fails, use ask_user to ask the patient to sign in.",
        {},
        [],
    ),
    _tool(
        "ask_user",
        "Ask the patient a question and stop until they reply. Use when the request is ambiguous or you need them to sign in.",
        {"question": {"type": "string"}},
        ["question"],
    ),
    _tool("finish", "End the task with a one-to-two sentence summary for the patient.", {"summary": {"type": "string"}}, ["summary"]),
]

TOOL_NAMES = {t["name"] for t in TOOLS}


def needs_confirmation(args: dict, element_name: str | None, element_role: str | None = "button") -> bool:
    if args.get("consequential"):
        return True
    # Links only navigate (e.g. "Schedule an Appointment" opens the wizard); buttons act.
    if element_role not in (None, "button"):
        return False
    return bool(element_name and CONSEQUENTIAL_NAME.search(element_name))


def validate_navigate_path(path: str) -> str | None:
    if "://" in path or path.startswith("//"):
        return "navigate takes a path, not a full URL"
    if not (path == "/portal" or path.startswith("/portal/")):
        return "navigate is limited to paths under /portal/ on the portal origin"
    return None
