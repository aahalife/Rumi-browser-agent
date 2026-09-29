from agent.observation import confirm_summary, render_observation
from agent.protocol import Element, Observation

REVIEW = Observation(
    url="/portal/schedule?step=review",
    title="Schedule an Appointment – CarePortal",
    elements=[
        Element(ref=1, role="button", name="Open menu", tag="button"),
        Element(ref=2, role="textbox", name="Reason for visit (comments)", tag="textarea", value=""),
        Element(ref=3, role="button", name="Schedule", tag="button"),
        Element(ref=4, role="button", name="Back", tag="button"),
    ],
    text="\n".join([
        "Riverside Health", "CarePortal", "# Schedule an Appointment", "1", "2", "3", "4", "5",
        "## Review and schedule", "Follow-up visit", "Dr. Anil Rao, Family Medicine", "Wed, Sep 30, 12:00 PM",
        "Riverside Main Campus", "Reason for visit (comments)", "Schedule", "Back", "Home", "Visits",
    ]),
)


def test_confirm_summary_keeps_only_the_review_details():
    summary = confirm_summary(REVIEW, REVIEW.elements[2])
    assert summary == (
        'Press "Schedule"\n\n'
        "Follow-up visit · Dr. Anil Rao, Family Medicine · Wed, Sep 30, 12:00 PM · Riverside Main Campus · Home · Visits"
    )


def test_confirm_summary_without_observation():
    assert confirm_summary(None, REVIEW.elements[2]) == 'Press "Schedule"'


def test_render_marks_state_and_offscreen():
    obs = Observation(
        url="/x", title="t",
        elements=[
            Element(ref=1, role="button", name="Afternoon", tag="button", pressed=True),
            Element(ref=2, role="combobox", name="Reason", tag="select", options=["A", "B"], value="A", inViewport=False),
            Element(ref=3, role="textbox", name="Password", tag="input", type="password", disabled=True),
        ],
        text="# T",
    )
    text = render_observation(obs)
    assert '[1] button "Afternoon" (pressed)' in text
    assert '[2] combobox "Reason" value="A" options: A | B (offscreen)' in text
    assert '[3] textbox "Password" type=password (disabled)' in text
    assert "## Page text" in text
    assert "## Page text" not in render_observation(obs, minimal=True)


def test_confirm_summary_prefers_the_elements_card():
    cancel = Element(ref=7, role="link", name="Cancel", tag="a",
                     context="Mon, Oct 12\n2:00 PM\nDr. Sarah Goldberg\nCardiology\nRiverside Northside Clinic")
    assert confirm_summary(REVIEW, cancel) == 'Press "Cancel"\n\nMon, Oct 12\n2:00 PM\nDr. Sarah Goldberg\nCardiology\nRiverside Northside Clinic'
    assert '· in: Mon, Oct 12 / 2:00 PM / Dr. Sarah Goldberg' in render_observation(Observation(url="/x", elements=[cancel], text=""))
