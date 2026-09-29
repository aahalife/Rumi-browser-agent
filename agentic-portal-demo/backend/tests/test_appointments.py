def test_upcoming_and_past_lists(priya):
    upcoming = priya.get("/portal/api/appointments?status=upcoming").json()
    past = priya.get("/portal/api/appointments?status=past").json()
    assert [a["provider"]["name"] for a in upcoming] == ["Dr. Anil Rao", "Dr. Sarah Goldberg"]
    assert len(past) == 6
    assert all(a["status"] == "completed" for a in past)


def test_other_patient_cannot_see_appointment(client):
    client.post("/portal/api/auth/login", json={"username": "demo2", "password": "demo123"})
    assert client.get("/portal/api/appointments/1").status_code == 404


def test_scheduling_lookups(priya):
    reasons = priya.get("/portal/api/scheduling/reasons").json()
    assert [r["label"] for r in reasons] == [
        "Follow-up visit", "Annual physical", "New problem", "Sick visit",
    ]
    fm = priya.get("/portal/api/scheduling/providers?reason=annual_physical").json()
    assert {p["specialty"] for p in fm} == {"Family Medicine"}
    everyone = priya.get("/portal/api/scheduling/providers?reason=follow_up").json()
    assert len(everyone) == 6
    assert len(priya.get("/portal/api/scheduling/locations").json()) == 2


def test_book_then_409_then_cancel(priya):
    slots = priya.get("/portal/api/scheduling/slots?provider_id=1&location_id=1&days=30").json()
    assert slots, "seed should leave open slots for Dr. Rao at Main Campus"
    slot = slots[0]

    r = priya.post("/portal/api/appointments", json={"slot_id": slot["id"], "reason": "follow_up"})
    assert r.status_code == 201
    booked = r.json()
    assert booked["provider"]["name"] == "Dr. Anil Rao"
    assert booked["visit_type"] == "Follow-up visit"

    again = priya.post("/portal/api/appointments", json={"slot_id": slot["id"], "reason": "follow_up"})
    assert again.status_code == 409

    remaining = priya.get("/portal/api/scheduling/slots?provider_id=1&location_id=1&days=30").json()
    assert slot["id"] not in {s["id"] for s in remaining}

    r = priya.post(
        f"/portal/api/appointments/{booked['id']}/cancel",
        json={"reason": "Scheduling conflict", "comments": "trip"},
    )
    assert r.status_code == 200
    assert r.json()["status"] == "canceled"
    assert r.json()["cancel_reason"] == "Scheduling conflict"

    reopened = priya.get("/portal/api/scheduling/slots?provider_id=1&location_id=1&days=30").json()
    assert slot["id"] in {s["id"] for s in reopened}

    assert priya.post(
        f"/portal/api/appointments/{booked['id']}/cancel", json={"reason": "Other"}
    ).status_code == 409


def test_any_provider_slots_filtered_by_reason(priya):
    slots = priya.get(
        "/portal/api/scheduling/slots?provider_id=any&location_id=2&reason=annual_physical&days=30"
    ).json()
    assert slots
    assert {s["provider"]["specialty"] for s in slots} == {"Family Medicine"}
    assert all(s["location_id"] == 2 for s in slots)
