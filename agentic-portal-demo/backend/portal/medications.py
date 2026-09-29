from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import get_db
from .deps import current_patient
from .models import Medication, Patient, Pharmacy, RefillRequest
from .schemas import ProviderOut

router = APIRouter()


class PharmacyOut(BaseModel):
    id: int
    name: str
    address: str


class RefillOut(BaseModel):
    id: int
    pharmacy: PharmacyOut
    status: str
    comments: str
    created_at: datetime


class MedicationOut(BaseModel):
    id: int
    name: str
    instructions: str
    prescriber: ProviderOut
    pharmacy: PharmacyOut
    refills_left: int
    last_filled: date
    pending_refill: RefillOut | None


def _refill_out(r: RefillRequest) -> RefillOut:
    return RefillOut(
        id=r.id,
        pharmacy=PharmacyOut.model_validate(r.pharmacy, from_attributes=True),
        status=r.status,
        comments=r.comments,
        created_at=r.created_at,
    )


def _out(m: Medication) -> MedicationOut:
    pending = next((r for r in m.refill_requests if r.status == "requested"), None)
    return MedicationOut(
        id=m.id,
        name=m.name,
        instructions=m.instructions,
        prescriber=ProviderOut.model_validate(m.prescriber, from_attributes=True),
        pharmacy=PharmacyOut.model_validate(m.pharmacy, from_attributes=True),
        refills_left=m.refills_left,
        last_filled=m.last_filled,
        pending_refill=_refill_out(pending) if pending else None,
    )


def _own(db: Session, patient: Patient, medication_id: int) -> Medication:
    med = db.get(Medication, medication_id)
    if med is None or med.patient_id != patient.id:
        raise HTTPException(404, "Medication not found")
    return med


@router.get("/medications", response_model=list[MedicationOut])
def list_medications(patient: Patient = Depends(current_patient), db: Session = Depends(get_db)):
    q = select(Medication).where(Medication.patient_id == patient.id).order_by(Medication.name)
    return [_out(m) for m in db.scalars(q)]


@router.get("/medications/{medication_id}", response_model=MedicationOut)
def get_medication(medication_id: int, patient: Patient = Depends(current_patient), db: Session = Depends(get_db)):
    return _out(_own(db, patient, medication_id))


@router.get("/pharmacies", response_model=list[PharmacyOut])
def pharmacies(_: Patient = Depends(current_patient), db: Session = Depends(get_db)):
    return list(db.scalars(select(Pharmacy).order_by(Pharmacy.id)))


class RefillBody(BaseModel):
    pharmacy_id: int
    comments: str = ""


@router.post("/medications/{medication_id}/refill", response_model=RefillOut, status_code=201)
def request_refill(
    medication_id: int,
    body: RefillBody,
    patient: Patient = Depends(current_patient),
    db: Session = Depends(get_db),
):
    med = _own(db, patient, medication_id)
    if any(r.status == "requested" for r in med.refill_requests):
        raise HTTPException(409, "A refill request for this medication is already pending.")
    pharmacy = db.get(Pharmacy, body.pharmacy_id)
    if pharmacy is None:
        raise HTTPException(404, "Pharmacy not found")
    req = RefillRequest(medication_id=med.id, pharmacy_id=pharmacy.id, comments=body.comments.strip())
    db.add(req)
    db.commit()
    db.refresh(req)
    return _refill_out(req)
