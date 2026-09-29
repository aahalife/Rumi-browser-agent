from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import get_db
from .deps import current_patient
from .models import Location, Patient, Provider, Slot
from .schemas import LocationOut, ProviderOut, SlotOut
from .seed import VISIT_REASONS, providers_for_reason

router = APIRouter(prefix="/scheduling")


def _reason_or_422(reason: str | None):
    if reason is None:
        return None
    if not any(r["id"] == reason for r in VISIT_REASONS):
        raise HTTPException(422, "Unknown visit reason")
    return reason


@router.get("/reasons")
def reasons(_: Patient = Depends(current_patient)):
    return VISIT_REASONS


@router.get("/providers", response_model=list[ProviderOut])
def providers(
    reason: str | None = Query(default=None),
    _: Patient = Depends(current_patient),
    db: Session = Depends(get_db),
):
    all_providers = list(db.scalars(select(Provider).order_by(Provider.id)))
    reason = _reason_or_422(reason)
    return all_providers if reason is None else providers_for_reason(reason, all_providers)


@router.get("/locations", response_model=list[LocationOut])
def locations(_: Patient = Depends(current_patient), db: Session = Depends(get_db)):
    return list(db.scalars(select(Location).order_by(Location.id)))


@router.get("/slots", response_model=list[SlotOut])
def slots(
    provider_id: str = Query(default="any"),
    location_id: int = Query(),
    date: date | None = Query(default=None),
    from_date: date | None = Query(default=None, alias="from"),
    days: int = Query(default=14, ge=1, le=31),
    reason: str | None = Query(default=None),
    _: Patient = Depends(current_patient),
    db: Session = Depends(get_db),
):
    if date is not None:
        start, end = date, date + timedelta(days=1)
    else:
        start = from_date or datetime.now().date()
        end = start + timedelta(days=days)

    q = (
        select(Slot)
        .where(
            Slot.location_id == location_id,
            Slot.status == "open",
            Slot.start >= datetime.combine(start, datetime.min.time()),
            Slot.start < datetime.combine(end, datetime.min.time()),
            Slot.start > datetime.now(),
        )
        .order_by(Slot.start, Slot.provider_id)
    )
    if provider_id != "any":
        try:
            q = q.where(Slot.provider_id == int(provider_id))
        except ValueError:
            raise HTTPException(422, "provider_id must be an integer or 'any'")
    else:
        reason = _reason_or_422(reason)
        if reason is not None:
            allowed = providers_for_reason(reason, list(db.scalars(select(Provider))))
            q = q.where(Slot.provider_id.in_([p.id for p in allowed]))
    return [SlotOut.from_model(s) for s in db.scalars(q)]
