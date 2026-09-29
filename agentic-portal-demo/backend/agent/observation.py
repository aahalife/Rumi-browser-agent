from .protocol import Element, Observation


def _element_line(e: Element) -> str:
    parts = [f"[{e.ref}] {e.role} \"{e.name}\""]
    if e.type and e.type not in ("text", "submit", "button"):
        parts.append(f"type={e.type}")
    if e.value:
        parts.append(f"value=\"{e.value[:80]}\"")
    if e.options:
        parts.append("options: " + " | ".join(e.options[:20]))
    flags = []
    if e.checked:
        flags.append("checked")
    if e.pressed:
        flags.append("pressed")
    if e.selected:
        flags.append("selected")
    if e.disabled:
        flags.append("disabled")
    if not e.inViewport:
        flags.append("offscreen")
    if flags:
        parts.append("(" + ", ".join(flags) + ")")
    if e.context and len(e.name) <= 24:
        parts.append("· in: " + " / ".join(e.context.splitlines())[:90])
    return " ".join(parts)


def render_observation(obs: Observation, minimal: bool = False) -> str:
    lines = [
        '<observation untrusted="true">',
        f"URL: {obs.url}",
        f"Title: {obs.title}",
        f"Viewport {obs.viewport.width}x{obs.viewport.height}, scrolled {obs.scroll.y}/{obs.pageHeight}",
    ]
    if obs.dialogs:
        lines.append("")
        lines.append("## Open dialog")
        lines.extend(obs.dialogs)
    lines.append("")
    lines.append("## Elements")
    if obs.elements:
        lines.extend(_element_line(e) for e in obs.elements)
    else:
        lines.append("(none)")
    if not minimal:
        lines.append("")
        lines.append("## Page text")
        lines.append(obs.text or "(empty)")
    lines.append("</observation>")
    return "\n".join(lines)


def find_element(obs: Observation | None, ref: int | None) -> Element | None:
    if obs is None or ref is None:
        return None
    return next((e for e in obs.elements if e.ref == ref), None)


def confirm_summary(obs: Observation | None, element: Element | None) -> str:
    action = f'Press "{element.name}"' if element else "Perform this action"
    if element is not None and element.context:
        return f"{action}\n\n{element.context}"
    if obs is None:
        return action
    # The page text after the last heading is usually the review or cancel summary.
    # Drop control labels (button/link/field names) and bare numbers such as wizard step dots.
    control_names = {e.name for e in obs.elements if e.name}
    body = [ln.strip() for ln in obs.text.splitlines() if ln.strip()]
    last_heading = max((i for i, ln in enumerate(body) if ln.startswith("#")), default=-1)
    detail_lines = [
        ln for ln in body[last_heading + 1 :]
        if not ln.startswith("#") and ln not in control_names and not ln.isdigit()
    ]
    detail = " · ".join(detail_lines[:6])
    if detail:
        return f"{action}\n\n{detail[:400]}"
    return f"{action} on {obs.title or obs.url}"
