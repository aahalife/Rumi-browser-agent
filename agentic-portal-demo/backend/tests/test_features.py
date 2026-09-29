def test_me_has_profile_and_badges(priya):
    me = priya.get("/portal/api/me").json()
    assert me["pcp"]["name"] == "Dr. Anil Rao"
    assert me["insurance"]["payer"] == "Blue Shield PPO"
    assert me["unread_messages"] == 1
    assert me["new_results"] == 1


def test_messages_list_read_send_reply(priya):
    convs = priya.get("/portal/api/messages").json()
    assert [c["subject"] for c in convs] == [
        "Refill sent to your pharmacy", "Your visit summary is ready", "Lipid panel results", "Hand eczema follow-up",
    ]
    lipid = next(c for c in convs if c["subject"] == "Lipid panel results")
    assert lipid["unread"] and lipid["with"] == "Dr. Sarah Goldberg's office"

    detail = priya.get(f"/portal/api/messages/{lipid['id']}").json()
    assert detail["messages"][0]["sender"] == "office"
    assert priya.get("/portal/api/me").json()["unread_messages"] == 0

    recipients = priya.get("/portal/api/messages/recipients").json()
    rao = next(r for r in recipients if r["name"].startswith("Dr. Anil Rao"))
    r = priya.post("/portal/api/messages", json={"recipient_id": rao["id"], "subject": "Running late", "body": "I will be 10 minutes late on Monday."})
    assert r.status_code == 201
    conv = r.json()
    assert conv["messages"][0]["sender"] == "patient" and conv["with"] == "Dr. Anil Rao's office"

    r = priya.post(f"/portal/api/messages/{conv['id']}/reply", json={"body": "Thanks!"})
    assert r.status_code == 201 and r.json()["message_count"] == 2
    assert priya.get("/portal/api/messages").json()[0]["subject"] == "Running late"
    assert priya.get("/portal/api/me").json()["emergency_contact"].startswith("Rohit Sharma")


def test_other_patient_cannot_read_thread(client):
    client.post("/portal/api/auth/login", json={"username": "demo2", "password": "demo123"})
    assert client.get("/portal/api/messages/1").status_code == 404


def test_results_list_and_detail_marks_reviewed(priya):
    panels = priya.get("/portal/api/results").json()
    assert [p["name"] for p in panels][:3] == ["Hemoglobin A1c", "Complete blood count (CBC)", "Vitamin D, 25-hydroxy"]
    a1c = panels[0]
    assert a1c["abnormal_count"] == 1 and a1c["reviewed"] is False
    detail = priya.get(f"/portal/api/results/{a1c['id']}").json()
    assert detail["results"][0]["value"] == "5.9" and detail["results"][0]["flag"] == "H"
    assert priya.get("/portal/api/me").json()["new_results"] == 0


def test_medications_and_refill(priya):
    meds = priya.get("/portal/api/medications").json()
    lisinopril = next(m for m in meds if m["name"].startswith("Lisinopril"))
    assert lisinopril["pending_refill"] is None and lisinopril["prescriber"]["name"] == "Dr. Anil Rao"
    pharmacies = priya.get("/portal/api/pharmacies").json()
    northside = next(p for p in pharmacies if p["name"] == "Northside Drugs")

    r = priya.post(f"/portal/api/medications/{lisinopril['id']}/refill", json={"pharmacy_id": northside["id"]})
    assert r.status_code == 201 and r.json()["status"] == "requested"
    again = priya.post(f"/portal/api/medications/{lisinopril['id']}/refill", json={"pharmacy_id": northside["id"]})
    assert again.status_code == 409
    assert priya.get(f"/portal/api/medications/{lisinopril['id']}").json()["pending_refill"]["pharmacy"]["name"] == "Northside Drugs"


def test_checkin_flow(priya):
    upcoming = priya.get("/portal/api/appointments?status=upcoming").json()
    rao, goldberg = upcoming
    assert rao["checkin_status"] == "available"
    assert goldberg["checkin_status"] == "not_available"
    assert priya.put(f"/portal/api/appointments/{goldberg['id']}/checkin/personal_info", json={"confirmed": True}).status_code == 409

    base = f"/portal/api/appointments/{rao['id']}/checkin"
    state = priya.get(base).json()
    assert state["status"] == "available" and len(state["questions"]) == 4

    assert priya.post(f"{base}/complete").status_code == 409
    assert priya.put(f"{base}/personal_info", json={"confirmed": True, "phone": "(555) 010-9999"}).status_code == 200
    assert priya.get("/portal/api/me").json()["phone"] == "(555) 010-9999"
    assert priya.put(f"{base}/insurance", json={"confirmed": True}).status_code == 200
    assert priya.put(f"{base}/allergies", json={"confirmed": True}).status_code == 200
    assert priya.put(f"{base}/medications", json={"confirmed": True}).status_code == 200
    assert priya.put(f"{base}/questionnaire", json={"answers": {"reason": "follow-up"}}).status_code == 422
    answers = {"reason": "Follow-up on A1c", "new_symptoms": "No", "tobacco": "No", "falls": "No"}
    assert priya.put(f"{base}/questionnaire", json={"answers": answers}).status_code == 200
    assert priya.post(f"{base}/complete").status_code == 422
    assert priya.put(f"{base}/consent", json={"agreed": True, "signature": "P Sharma"}).status_code == 422
    assert priya.put(f"{base}/consent", json={"agreed": True, "signature": "priya sharma"}).status_code == 200

    done = priya.post(f"{base}/complete")
    assert done.status_code == 200 and done.json()["status"] == "complete"
    assert priya.get(f"/portal/api/appointments/{rao['id']}").json()["checkin_status"] == "complete"
    assert priya.put(f"{base}/allergies", json={"confirmed": True}).status_code == 409


def test_health_summary_and_care_team(priya):
    summary = priya.get("/portal/api/health-summary").json()
    assert summary["allergies"][0]["substance"] == "Penicillin"
    assert summary["immunizations"][0]["name"].startswith(("Influenza", "COVID"))
    assert {p["name"] for p in summary["problems"]} >= {"Hypertension", "Prediabetes", "High cholesterol"}
    assert len(summary["immunizations"]) == 8 and len(summary["allergies"]) == 2
    team = priya.get("/portal/api/care-team").json()
    assert team[0]["name"] == "Dr. Anil Rao" and team[0]["role"] == "Primary care provider"
    assert {m["specialty"] for m in team} == {"Family Medicine", "Cardiology", "Dermatology"}
