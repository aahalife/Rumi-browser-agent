from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import appointments, auth, checkin, health, medications, messages, results, scheduling
from .db import get_db
from .deps import current_patient
from .models import Conversation, LabPanel, Patient

router = APIRouter(prefix="/portal/api")
router.include_router(auth.router)
router.include_router(appointments.router)
router.include_router(scheduling.router)
router.include_router(messages.router)
router.include_router(results.router)
router.include_router(medications.router)
router.include_router(checkin.router)
router.include_router(health.router)


@router.get("/me")
def me(patient: Patient = Depends(current_patient), db: Session = Depends(get_db)):
    unread = db.scalar(select(func.count()).select_from(Conversation).where(
        Conversation.patient_id == patient.id, Conversation.unread.is_(True)))
    new_results = db.scalar(select(func.count()).select_from(LabPanel).where(
        LabPanel.patient_id == patient.id, LabPanel.reviewed.is_(False)))
    return {
        "id": patient.id,
        "username": patient.username,
        "first_name": patient.first_name,
        "last_name": patient.last_name,
        "date_of_birth": patient.date_of_birth,
        "mrn": patient.mrn,
        "address": patient.address,
        "phone": patient.phone,
        "email": patient.email,
        "insurance": {"payer": patient.insurance_payer, "member_id": patient.insurance_member_id},
        "emergency_contact": patient.emergency_contact,
        "pcp": {"id": patient.pcp.id, "name": patient.pcp.name, "specialty": patient.pcp.specialty} if patient.pcp else None,
        "unread_messages": unread,
        "new_results": new_results,
    }


@router.get("/cancel-reasons")
def cancel_reasons(_: Patient = Depends(current_patient)):
    return appointments.CANCEL_REASONS
