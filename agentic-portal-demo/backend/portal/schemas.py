from datetime import datetime

from pydantic import BaseModel

from .checkin_status import checkin_status
from .models import Appointment, Slot


class ProviderOut(BaseModel):
    id: int
    name: str
    specialty: str
    initials: str


class LocationOut(BaseModel):
    id: int
    name: str
    address: str


class AppointmentOut(BaseModel):
    id: int
    start: datetime
    visit_type: str
    status: str
    provider: ProviderOut
    location: LocationOut
    comments: str
    notes: str
    cancel_reason: str | None = None
    cancel_comments: str | None = None
    checkin_status: str = "not_available"

    @classmethod
    def from_model(cls, a: Appointment) -> "AppointmentOut":
        return cls(
            checkin_status=checkin_status(a),
            id=a.id,
            start=a.start,
            visit_type=a.visit_type,
            status=a.status,
            provider=ProviderOut.model_validate(a.provider, from_attributes=True),
            location=LocationOut.model_validate(a.location, from_attributes=True),
            comments=a.comments,
            notes=a.notes,
            cancel_reason=a.cancel_reason,
            cancel_comments=a.cancel_comments,
        )


class SlotOut(BaseModel):
    id: int
    start: datetime
    provider: ProviderOut
    location_id: int

    @classmethod
    def from_model(cls, s: Slot) -> "SlotOut":
        return cls(
            id=s.id,
            start=s.start,
            provider=ProviderOut.model_validate(s.provider, from_attributes=True),
            location_id=s.location_id,
        )
