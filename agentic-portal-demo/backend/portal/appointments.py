from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import get_db
from .deps import current_patient
from .models import Appointment, Patient, Slot
from .schemas import AppointmentOut
from .seed import VISIT_REASONS

router = APIRouter()

CANCEL_REASONS = ["Feeling better", "Scheduling conflict", "Transportation", "Other"]


def _get_own(db: Session, patient: Patient, appointment_id: int) -> Appointment:
    appt = db.get(Appointment, appointment_id)
    if appt is None or appt.patient_id != patient.id:
        raise HTTPException(404, "Appointment not found")
    return appt


@router.get("/appointments", response_model=list[AppointmentOut])
def list_appointments(
    status: str = Query(default="upcoming", pattern="^(upcoming|past)$"),
    patient: Patient = Depends(current_patient),
    db: Session = Depends(get_db),
):
    now = datetime.now()
    q = select(Appointment).where(Appointment.patient_id == patient.id)
    if status == "upcoming":
        q = q.where(Appointment.status == "scheduled", Appointment.start >= now)
        q = q.order_by(Appointment.start.asc())
    else:
        q = q.where((Appointment.status != "scheduled") | (Appointment.start < now))
        q = q.order_by(Appointment.start.desc())
    return [AppointmentOut.from_model(a) for a in db.scalars(q)]


@router.get("/appointments/{appointment_id}", response_model=AppointmentOut)
def get_appointment(
    appointment_id: int,
    patient: Patient = Depends(current_patient),
    db: Session = Depends(get_db),
):
    return AppointmentOut.from_model(_get_own(db, patient, appointment_id))


class CancelBody(BaseModel):
    reason: str
    comments: str = ""


@router.post("/appointments/{appointment_id}/cancel", response_model=AppointmentOut)
def cancel_appointment(
    appointment_id: int,
    body: CancelBody,
    patient: Patient = Depends(current_patient),
    db: Session = Depends(get_db),
):
    appt = _get_own(db, patient, appointment_id)
    if appt.status != "scheduled":
        raise HTTPException(409, "This appointment is not scheduled")
    if body.reason not in CANCEL_REASONS:
        raise HTTPException(422, "Unknown cancel reason")
    appt.status = "canceled"
    appt.cancel_reason = body.reason
    appt.cancel_comments = body.comments
    if appt.slot_id is not None:
        slot = db.get(Slot, appt.slot_id)
        slot.status = "open"
    db.commit()
    db.refresh(appt)
    return AppointmentOut.from_model(appt)


class BookBody(BaseModel):
    slot_id: int
    reason: str
    comments: str = ""


@router.post("/appointments", response_model=AppointmentOut, status_code=201)
def book_appointment(
    body: BookBody,
    patient: Patient = Depends(current_patient),
    db: Session = Depends(get_db),
):
    reason = next((r for r in VISIT_REASONS if r["id"] == body.reason), None)
    if reason is None:
        raise HTTPException(422, "Unknown visit reason")
    slot = db.get(Slot, body.slot_id)
    if slot is None:
        raise HTTPException(404, "Slot not found")
    if slot.status != "open":
        raise HTTPException(409, "That time is no longer available. Please choose another time.")
    slot.status = "booked"
    appt = Appointment(
        patient_id=patient.id,
        provider_id=slot.provider_id,
        location_id=slot.location_id,
        slot_id=slot.id,
        start=slot.start,
        visit_type=reason["label"],
        comments=body.comments,
        status="scheduled",
    )
    db.add(appt)
    db.commit()
    db.refresh(appt)
    return AppointmentOut.from_model(appt)
