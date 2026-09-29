"""Test-only access to the portal database. The harness may read it; the agent never may."""

from datetime import datetime, timedelta

from sqlalchemy import select

from portal.db import Base, SessionLocal, engine
from portal.models import Appointment, CheckIn, Conversation, Medication, Patient, Provider, RefillRequest, Slot
from portal.seed import seed


def reseed() -> None:
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        seed(db)


def appointments(username: str, status: str | None = None) -> list[dict]:
    with SessionLocal() as db:
        patient = db.scalar(select(Patient).where(Patient.username == username))
        q = select(Appointment).where(Appointment.patient_id == patient.id).order_by(Appointment.start)
        if status:
            q = q.where(Appointment.status == status)
        return [
            {
                "id": a.id,
                "start": a.start,
                "provider": a.provider.name,
                "specialty": a.provider.specialty,
                "location_id": a.location_id,
                "location": a.location.name,
                "visit_type": a.visit_type,
                "status": a.status,
                "cancel_reason": a.cancel_reason,
            }
            for a in db.scalars(q)
        ]


def earliest_open_slot(location_id: int, specialty: str | None = None) -> datetime | None:
    with SessionLocal() as db:
        q = (
            select(Slot)
            .join(Provider)
            .where(Slot.location_id == location_id, Slot.status == "open", Slot.start > datetime.now())
            .order_by(Slot.start)
        )
        if specialty:
            q = q.where(Provider.specialty == specialty)
        slot = db.scalar(q.limit(1))
        return slot.start if slot else None


def next_week_range(today: datetime | None = None) -> tuple[datetime, datetime]:
    today = today or datetime.now()
    monday = (today - timedelta(days=today.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    start = monday + timedelta(days=7)
    return start, start + timedelta(days=5)


def _patient(db, username: str) -> Patient:
    return db.scalar(select(Patient).where(Patient.username == username))


def conversations(username: str) -> list[dict]:
    with SessionLocal() as db:
        patient = _patient(db, username)
        q = select(Conversation).where(Conversation.patient_id == patient.id).order_by(Conversation.id)
        return [
            {
                "id": c.id,
                "subject": c.subject,
                "provider": c.provider.name,
                "messages": [{"sender": m.sender, "body": m.body} for m in c.messages],
            }
            for c in db.scalars(q)
        ]


def refill_requests(username: str) -> list[dict]:
    with SessionLocal() as db:
        patient = _patient(db, username)
        q = select(RefillRequest).join(Medication).where(Medication.patient_id == patient.id).order_by(RefillRequest.id)
        return [
            {"id": r.id, "medication": r.medication.name, "pharmacy": r.pharmacy.name, "status": r.status, "comments": r.comments}
            for r in db.scalars(q)
        ]


def checkin_for(username: str, provider_name: str) -> dict | None:
    with SessionLocal() as db:
        patient = _patient(db, username)
        q = (
            select(CheckIn).join(Appointment).join(Provider)
            .where(Appointment.patient_id == patient.id, Provider.name == provider_name, Appointment.status == "scheduled")
        )
        c = db.scalar(q)
        return {"status": c.status, "data": c.data} if c else None


def write_fingerprint(username: str) -> tuple:
    """Everything a task could change. Equal before and after means the agent made no writes."""
    appts = tuple((a["id"], a["status"]) for a in appointments(username))
    msgs = tuple((c["id"], len(c["messages"])) for c in conversations(username))
    refills = tuple(r["id"] for r in refill_requests(username))
    with SessionLocal() as db:
        checkins = tuple(db.scalars(select(CheckIn.id, CheckIn.status).join(Appointment).join(Patient).where(Patient.username == username)))
    return appts, msgs, refills, checkins
