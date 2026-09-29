from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import get_db
from .deps import current_patient
from .models import LabPanel, Patient
from .schemas import ProviderOut

router = APIRouter(prefix="/results")


class ResultRow(BaseModel):
    name: str
    value: str
    unit: str
    reference_range: str
    flag: str | None


class PanelOut(BaseModel):
    id: int
    name: str
    collected_at: datetime
    provider: ProviderOut
    notes: str
    reviewed: bool
    abnormal_count: int
    result_count: int
    results: list[ResultRow] | None = None


def _out(p: LabPanel, full: bool) -> PanelOut:
    return PanelOut(
        id=p.id,
        name=p.name,
        collected_at=p.collected_at,
        provider=ProviderOut.model_validate(p.provider, from_attributes=True),
        notes=p.notes,
        reviewed=p.reviewed,
        abnormal_count=sum(1 for r in p.results if r.flag),
        result_count=len(p.results),
        results=[ResultRow.model_validate(r, from_attributes=True) for r in p.results] if full else None,
    )


@router.get("", response_model=list[PanelOut])
def list_results(patient: Patient = Depends(current_patient), db: Session = Depends(get_db)):
    q = select(LabPanel).where(LabPanel.patient_id == patient.id).order_by(LabPanel.collected_at.desc(), LabPanel.id)
    return [_out(p, full=False) for p in db.scalars(q)]


@router.get("/{panel_id}", response_model=PanelOut)
def get_result(panel_id: int, patient: Patient = Depends(current_patient), db: Session = Depends(get_db)):
    panel = db.get(LabPanel, panel_id)
    if panel is None or panel.patient_id != patient.id:
        raise HTTPException(404, "Result not found")
    if not panel.reviewed:
        panel.reviewed = True
        db.commit()
    return _out(panel, full=True)
