from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import get_db
from .deps import current_patient
from .models import Conversation, Message, Patient, Provider
from .schemas import ProviderOut

router = APIRouter(prefix="/messages")


class MessageOut(BaseModel):
    id: int
    sender: str
    sender_name: str
    body: str
    sent_at: datetime


class ConversationOut(BaseModel):
    id: int
    subject: str
    with_: str = Field(alias="with")
    provider: ProviderOut
    last_message_at: datetime
    last_preview: str
    unread: bool
    message_count: int
    messages: list[MessageOut] | None = None

    model_config = {"populate_by_name": True}


def office_name(p: Provider) -> str:
    return f"{p.name}'s office"


def _out(c: Conversation, patient: Patient, full: bool) -> ConversationOut:
    last = c.messages[-1] if c.messages else None
    return ConversationOut(
        id=c.id,
        subject=c.subject,
        with_=office_name(c.provider),
        provider=ProviderOut.model_validate(c.provider, from_attributes=True),
        last_message_at=c.last_message_at,
        last_preview=(last.body[:90] if last else ""),
        unread=c.unread,
        message_count=len(c.messages),
        messages=[
            MessageOut(
                id=m.id,
                sender=m.sender,
                sender_name=f"{patient.first_name} {patient.last_name}" if m.sender == "patient" else office_name(c.provider),
                body=m.body,
                sent_at=m.sent_at,
            )
            for m in c.messages
        ] if full else None,
    )


def _own(db: Session, patient: Patient, conversation_id: int) -> Conversation:
    conv = db.get(Conversation, conversation_id)
    if conv is None or conv.patient_id != patient.id:
        raise HTTPException(404, "Conversation not found")
    return conv


@router.get("", response_model=list[ConversationOut], response_model_by_alias=True)
def list_conversations(patient: Patient = Depends(current_patient), db: Session = Depends(get_db)):
    q = select(Conversation).where(Conversation.patient_id == patient.id).order_by(Conversation.last_message_at.desc())
    return [_out(c, patient, full=False) for c in db.scalars(q)]


@router.get("/recipients")
def recipients(_: Patient = Depends(current_patient), db: Session = Depends(get_db)):
    return [
        {"id": p.id, "name": office_name(p), "specialty": p.specialty}
        for p in db.scalars(select(Provider).order_by(Provider.id))
    ]


@router.get("/{conversation_id}", response_model=ConversationOut, response_model_by_alias=True)
def get_conversation(conversation_id: int, patient: Patient = Depends(current_patient), db: Session = Depends(get_db)):
    conv = _own(db, patient, conversation_id)
    if conv.unread:
        conv.unread = False
        db.commit()
    return _out(conv, patient, full=True)


class NewConversation(BaseModel):
    recipient_id: int
    subject: str = Field(min_length=1, max_length=128)
    body: str = Field(min_length=1, max_length=4000)


@router.post("", response_model=ConversationOut, response_model_by_alias=True, status_code=201)
def send_message(body: NewConversation, patient: Patient = Depends(current_patient), db: Session = Depends(get_db)):
    provider = db.get(Provider, body.recipient_id)
    if provider is None:
        raise HTTPException(404, "Recipient not found")
    conv = Conversation(patient_id=patient.id, provider_id=provider.id, subject=body.subject.strip(), unread=False)
    db.add(conv)
    db.flush()
    db.add(Message(conversation_id=conv.id, sender="patient", body=body.body.strip(), sent_at=datetime.now()))
    conv.last_message_at = datetime.now()
    db.commit()
    db.refresh(conv)
    return _out(conv, patient, full=True)


class Reply(BaseModel):
    body: str = Field(min_length=1, max_length=4000)


@router.post("/{conversation_id}/reply", response_model=ConversationOut, response_model_by_alias=True, status_code=201)
def reply(conversation_id: int, body: Reply, patient: Patient = Depends(current_patient), db: Session = Depends(get_db)):
    conv = _own(db, patient, conversation_id)
    db.add(Message(conversation_id=conv.id, sender="patient", body=body.body.strip(), sent_at=datetime.now()))
    conv.last_message_at = datetime.now()
    conv.unread = False
    db.commit()
    db.refresh(conv)
    return _out(conv, patient, full=True)
