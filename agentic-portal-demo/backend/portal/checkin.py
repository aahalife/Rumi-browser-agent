import json
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .db import get_db
from .deps import current_patient
from .checkin_status import checkin_status
from .models import Appointment, CheckIn, Patient

router = APIRouter(prefix="/appointments/{appointment_id}/checkin")

STEPS = ["personal_info", "insurance", "allergies", "medications", "questionnaire", "consent"]
COPAY = "25.00"

QUESTIONS = [
    {"id": "reason", "label": "In a few words, what would you like to discuss at this visit?", "type": "text"},
    {"id": "new_symptoms", "label": "Any new symptoms since your last visit?", "type": "yes_no"},
    {"id": "tobacco", "label": "Do you currently use tobacco?", "type": "yes_no"},
    {"id": "falls", "label": "Have you fallen in the past 6 months?", "type": "yes_no"},
]


def _own_appt(db: Session, patient: Patient, appointment_id: int) -> Appointment:
    appt = db.get(Appointment, appointment_id)
    if appt is None or appt.patient_id != patient.id:
        raise HTTPException(404, "Appointment not found")
    return appt


def _state(appt: Appointment) -> dict:
    data = json.loads(appt.checkin.data) if appt.checkin else {}
    steps = data.get("steps", {})
    return {
        "appointment_id": appt.id,
        "status": checkin_status(appt),
        "steps": {s: bool(steps.get(s)) for s in STEPS},
        "answers": data.get("answers", {}),
        "signature": data.get("signature"),
        "questions": QUESTIONS,
        "copay": COPAY,
        "completed_at": appt.checkin.completed_at if appt.checkin else None,
    }


@router.get("")
def get_checkin(appointment_id: int, patient: Patient = Depends(current_patient), db: Session = Depends(get_db)):
    return _state(_own_appt(db, patient, appointment_id))


class StepBody(BaseModel):
    confirmed: bool = True
    address: str | None = None
    phone: str | None = None
    email: str | None = None
    insurance_payer: str | None = None
    insurance_member_id: str | None = None
    answers: dict[str, str] | None = None
    agreed: bool | None = None
    signature: str | None = None


@router.put("/{step}")
def save_step(
    appointment_id: int,
    step: str,
    body: StepBody,
    patient: Patient = Depends(current_patient),
    db: Session = Depends(get_db),
):
    if step not in STEPS:
        raise HTTPException(404, "Unknown step")
    appt = _own_appt(db, patient, appointment_id)
    status = checkin_status(appt)
    if status == "not_available":
        raise HTTPException(409, "eCheck-in is not open for this visit.")
    if status == "complete":
        raise HTTPException(409, "eCheck-in is already complete.")
    if appt.checkin is None:
        appt.checkin = CheckIn(appointment_id=appt.id, status="in_progress", data="{}")
        db.add(appt.checkin)
    data = json.loads(appt.checkin.data or "{}")
    data.setdefault("steps", {})
    data.setdefault("answers", {})

    if step == "personal_info":
        for field in ("address", "phone", "email"):
            value = getattr(body, field)
            if value is not None and value.strip():
                setattr(patient, field, value.strip())
    elif step == "insurance":
        if body.insurance_payer:
            patient.insurance_payer = body.insurance_payer.strip()
        if body.insurance_member_id:
            patient.insurance_member_id = body.insurance_member_id.strip()
    elif step == "questionnaire":
        answers = body.answers or {}
        missing = [q["id"] for q in QUESTIONS if not str(answers.get(q["id"], "")).strip()]
        if missing:
            raise HTTPException(422, f"Please answer every question ({', '.join(missing)}).")
        data["answers"] = {q["id"]: str(answers[q["id"]]).strip() for q in QUESTIONS}
    elif step == "consent":
        expected = f"{patient.first_name} {patient.last_name}".lower()
        if not body.agreed:
            raise HTTPException(422, "Please check the box to agree to the consent.")
        if (body.signature or "").strip().lower() != expected:
            raise HTTPException(422, f"Please type your full name exactly as {patient.first_name} {patient.last_name}.")
        data["signature"] = body.signature.strip()
    elif not body.confirmed:
        raise HTTPException(422, "Please confirm this step.")

    data["steps"][step] = True
    appt.checkin.data = json.dumps(data)
    db.commit()
    db.refresh(appt)
    return _state(appt)


@router.post("/complete")
def complete(appointment_id: int, patient: Patient = Depends(current_patient), db: Session = Depends(get_db)):
    appt = _own_appt(db, patient, appointment_id)
    if appt.checkin is None:
        raise HTTPException(409, "Start eCheck-in first.")
    if appt.checkin.status == "complete":
        raise HTTPException(409, "eCheck-in is already complete.")
    data = json.loads(appt.checkin.data or "{}")
    missing = [s for s in STEPS if not data.get("steps", {}).get(s)]
    if missing:
        raise HTTPException(422, f"These steps are not done yet: {', '.join(missing)}.")
    appt.checkin.status = "complete"
    appt.checkin.completed_at = datetime.now()
    db.commit()
    db.refresh(appt)
    return _state(appt)
