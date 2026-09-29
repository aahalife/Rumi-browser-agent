from agent.tools import needs_confirmation, validate_navigate_path


def test_gate_fires_on_action_buttons_not_navigation_links():
    assert needs_confirmation({}, "Schedule", "button")
    assert needs_confirmation({}, "Cancel appointment", "button")
    assert needs_confirmation({}, "Submit request", "button")
    assert not needs_confirmation({}, "Schedule an Appointment", "link")
    assert not needs_confirmation({}, "Cancel", "link")
    assert not needs_confirmation({}, "Cancel", "button")  # opens the cancel form, does not cancel
    assert needs_confirmation({"consequential": True}, "Anything", "link")
    assert needs_confirmation({}, "Send", "button")
    assert needs_confirmation({}, "Request refill", "button")
    assert needs_confirmation({}, "Sign and continue", "button")
    assert needs_confirmation({}, "Finish check-in", "button")
    assert not needs_confirmation({}, "Sign in", "button")
    assert not needs_confirmation({}, "Continue", "button")
    assert not needs_confirmation({}, "New message", "link")
    assert needs_confirmation({}, "Log out", "button")
    assert needs_confirmation({}, "Sign out of this device", "button")


def test_navigate_paths():
    assert validate_navigate_path("/portal/home") is None
    assert validate_navigate_path("/portal") is None
    assert validate_navigate_path("/admin") is not None
    assert validate_navigate_path("https://evil.example/portal/") is not None
    assert validate_navigate_path("//evil.example/portal/") is not None


def test_restore_session_is_an_action_tool():
    from agent.tools import ACTION_TOOLS, TOOL_NAMES
    assert "restore_session" in ACTION_TOOLS and "restore_session" in TOOL_NAMES
