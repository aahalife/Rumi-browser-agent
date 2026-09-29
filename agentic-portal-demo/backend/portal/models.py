from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base

# Bump when tables or columns change: the app drops and reseeds an older database on start.
SCHEMA_VERSION = "4"


class Meta(Base):
    __tablename__ = "meta"

    key: Mapped[str] = mapped_column(String(32), primary_key=True)
    value: Mapped[str] = mapped_column(String(64))


class Patient(Base):
    __tablename__ = "patients"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True)
    password_hash: Mapped[str] = mapped_column(String(256))
    first_name: Mapped[str] = mapped_column(String(64))
    last_name: Mapped[str] = mapped_column(String(64))
    date_of_birth: Mapped[str] = mapped_column(String(10))
    mrn: Mapped[str] = mapped_column(String(16))
    address: Mapped[str] = mapped_column(String(128), default="")
    phone: Mapped[str] = mapped_column(String(32), default="")
    email: Mapped[str] = mapped_column(String(128), default="")
    insurance_payer: Mapped[str] = mapped_column(String(64), default="")
    insurance_member_id: Mapped[str] = mapped_column(String(32), default="")
    emergency_contact: Mapped[str] = mapped_column(String(128), default="")
    pcp_id: Mapped[int | None] = mapped_column(ForeignKey("providers.id"), nullable=True)

    pcp: Mapped["Provider | None"] = relationship()


class Provider(Base):
    __tablename__ = "providers"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(64))
    specialty: Mapped[str] = mapped_column(String(64))
    initials: Mapped[str] = mapped_column(String(4))


class Location(Base):
    __tablename__ = "locations"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(64))
    address: Mapped[str] = mapped_column(String(128))


class Slot(Base):
    __tablename__ = "slots"

    id: Mapped[int] = mapped_column(primary_key=True)
    provider_id: Mapped[int] = mapped_column(ForeignKey("providers.id"))
    location_id: Mapped[int] = mapped_column(ForeignKey("locations.id"))
    start: Mapped[datetime] = mapped_column(DateTime, index=True)
    # open | blocked | booked
    status: Mapped[str] = mapped_column(String(16), default="open")

    provider: Mapped[Provider] = relationship()
    location: Mapped[Location] = relationship()


class Appointment(Base):
    __tablename__ = "appointments"

    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"))
    provider_id: Mapped[int] = mapped_column(ForeignKey("providers.id"))
    location_id: Mapped[int] = mapped_column(ForeignKey("locations.id"))
    slot_id: Mapped[int | None] = mapped_column(ForeignKey("slots.id"), nullable=True)
    start: Mapped[datetime] = mapped_column(DateTime, index=True)
    visit_type: Mapped[str] = mapped_column(String(64))
    comments: Mapped[str] = mapped_column(Text, default="")
    notes: Mapped[str] = mapped_column(Text, default="")
    # scheduled | canceled | completed
    status: Mapped[str] = mapped_column(String(16), default="scheduled")
    cancel_reason: Mapped[str | None] = mapped_column(String(64), nullable=True)
    cancel_comments: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)

    provider: Mapped[Provider] = relationship()
    location: Mapped[Location] = relationship()
    checkin: Mapped["CheckIn | None"] = relationship(back_populates="appointment", uselist=False)


class CheckIn(Base):
    __tablename__ = "checkins"

    id: Mapped[int] = mapped_column(primary_key=True)
    appointment_id: Mapped[int] = mapped_column(ForeignKey("appointments.id"), unique=True)
    # in_progress | complete
    status: Mapped[str] = mapped_column(String(16), default="in_progress")
    # JSON: {"steps": {"personal_info": true, ...}, "answers": {...}, "signature": "..."}
    data: Mapped[str] = mapped_column(Text, default="{}")
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    appointment: Mapped[Appointment] = relationship(back_populates="checkin")


class RevokedToken(Base):
    __tablename__ = "revoked_tokens"

    jti: Mapped[str] = mapped_column(String(64), primary_key=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime)


class Conversation(Base):
    __tablename__ = "conversations"

    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"))
    provider_id: Mapped[int] = mapped_column(ForeignKey("providers.id"))
    subject: Mapped[str] = mapped_column(String(128))
    last_message_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    unread: Mapped[bool] = mapped_column(Boolean, default=False)

    provider: Mapped[Provider] = relationship()
    messages: Mapped[list["Message"]] = relationship(back_populates="conversation", order_by="Message.sent_at")


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    conversation_id: Mapped[int] = mapped_column(ForeignKey("conversations.id"))
    # patient | office
    sender: Mapped[str] = mapped_column(String(16))
    body: Mapped[str] = mapped_column(Text)
    sent_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)

    conversation: Mapped[Conversation] = relationship(back_populates="messages")


class LabPanel(Base):
    __tablename__ = "lab_panels"

    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"))
    provider_id: Mapped[int] = mapped_column(ForeignKey("providers.id"))
    name: Mapped[str] = mapped_column(String(64))
    collected_at: Mapped[datetime] = mapped_column(DateTime)
    notes: Mapped[str] = mapped_column(Text, default="")
    reviewed: Mapped[bool] = mapped_column(Boolean, default=True)

    provider: Mapped[Provider] = relationship()
    results: Mapped[list["LabResult"]] = relationship(back_populates="panel", order_by="LabResult.id")


class LabResult(Base):
    __tablename__ = "lab_results"

    id: Mapped[int] = mapped_column(primary_key=True)
    panel_id: Mapped[int] = mapped_column(ForeignKey("lab_panels.id"))
    name: Mapped[str] = mapped_column(String(64))
    value: Mapped[str] = mapped_column(String(32))
    unit: Mapped[str] = mapped_column(String(16), default="")
    reference_range: Mapped[str] = mapped_column(String(32), default="")
    # H | L | None
    flag: Mapped[str | None] = mapped_column(String(2), nullable=True)

    panel: Mapped[LabPanel] = relationship(back_populates="results")


class Pharmacy(Base):
    __tablename__ = "pharmacies"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(64))
    address: Mapped[str] = mapped_column(String(128))


class Medication(Base):
    __tablename__ = "medications"

    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"))
    prescriber_id: Mapped[int] = mapped_column(ForeignKey("providers.id"))
    pharmacy_id: Mapped[int] = mapped_column(ForeignKey("pharmacies.id"))
    name: Mapped[str] = mapped_column(String(96))
    instructions: Mapped[str] = mapped_column(String(160))
    refills_left: Mapped[int] = mapped_column(Integer, default=0)
    last_filled: Mapped[date] = mapped_column(Date)

    prescriber: Mapped[Provider] = relationship()
    pharmacy: Mapped[Pharmacy] = relationship()
    refill_requests: Mapped[list["RefillRequest"]] = relationship(back_populates="medication", order_by="RefillRequest.id")


class RefillRequest(Base):
    __tablename__ = "refill_requests"

    id: Mapped[int] = mapped_column(primary_key=True)
    medication_id: Mapped[int] = mapped_column(ForeignKey("medications.id"))
    pharmacy_id: Mapped[int] = mapped_column(ForeignKey("pharmacies.id"))
    comments: Mapped[str] = mapped_column(Text, default="")
    # requested | sent | denied
    status: Mapped[str] = mapped_column(String(16), default="requested")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)

    medication: Mapped[Medication] = relationship(back_populates="refill_requests")
    pharmacy: Mapped[Pharmacy] = relationship()


class Allergy(Base):
    __tablename__ = "allergies"

    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"))
    substance: Mapped[str] = mapped_column(String(64))
    reaction: Mapped[str] = mapped_column(String(64))
    severity: Mapped[str] = mapped_column(String(16))


class Immunization(Base):
    __tablename__ = "immunizations"

    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"))
    name: Mapped[str] = mapped_column(String(64))
    given_on: Mapped[date] = mapped_column(Date)


class Problem(Base):
    __tablename__ = "problems"

    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"))
    name: Mapped[str] = mapped_column(String(64))
    since: Mapped[date] = mapped_column(Date)


class DeviceToken(Base):
    """A long-lived 'remember this device' credential. The phone keeps the secret; we keep its hash."""

    __tablename__ = "device_tokens"

    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("patients.id"))
    token_hash: Mapped[str] = mapped_column(String(64))
    label: Mapped[str] = mapped_column(String(64), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)
