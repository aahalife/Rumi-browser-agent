from datetime import date

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import get_db
from .deps import current_patient
from .models import Allergy, Appointment, Immunization, Patient, Problem

router = APIRouter()


class AllergyOut(BaseModel):
    substance: str
    reaction: str
    severity: str


class ImmunizationOut(BaseModel):
    name: str
    given_on: date


class ProblemOut(BaseModel):
    name: str
    since: date


class CareTeamMember(BaseModel):
    id: int
    name: str
    specialty: str
    role: str
    location: str
    initials: str


def care_team(db: Session, patient: Patient) -> list[CareTeamMember]:
    members: list[CareTeamMember] = []
    seen: set[int] = set()
    appts = list(db.scalars(
        select(Appointment).where(Appointment.patient_id == patient.id).order_by(Appointment.start.desc())
    ))

    def latest_location(provider_id: int) -> str:
        return next((a.location.name for a in appts if a.provider_id == provider_id), "")

    if patient.pcp is not None:
        members.append(CareTeamMember(
            id=patient.pcp.id, name=patient.pcp.name, specialty=patient.pcp.specialty,
            role="Primary care provider", location=latest_location(patient.pcp.id) or "Riverside Main Campus",
            initials=patient.pcp.initials,
        ))
        seen.add(patient.pcp.id)
    for a in appts:
        if a.provider_id in seen:
            continue
        seen.add(a.provider_id)
        members.append(CareTeamMember(
            id=a.provider.id, name=a.provider.name, specialty=a.provider.specialty,
            role=a.provider.specialty, location=a.location.name, initials=a.provider.initials,
        ))
    return members


@router.get("/care-team", response_model=list[CareTeamMember])
def get_care_team(patient: Patient = Depends(current_patient), db: Session = Depends(get_db)):
    return care_team(db, patient)


@router.get("/health-summary")
def health_summary(patient: Patient = Depends(current_patient), db: Session = Depends(get_db)):
    return {
        "allergies": [AllergyOut.model_validate(a, from_attributes=True) for a in db.scalars(
            select(Allergy).where(Allergy.patient_id == patient.id).order_by(Allergy.substance))],
        "immunizations": [ImmunizationOut.model_validate(i, from_attributes=True) for i in db.scalars(
            select(Immunization).where(Immunization.patient_id == patient.id).order_by(Immunization.given_on.desc()))],
        "problems": [ProblemOut.model_validate(p, from_attributes=True) for p in db.scalars(
            select(Problem).where(Problem.patient_id == patient.id).order_by(Problem.since.desc()))],
        "care_team": care_team(db, patient),
    }
