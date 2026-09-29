from fastapi import Cookie, Depends, HTTPException
from sqlalchemy.orm import Session

from .auth import decode_token
from .db import get_db
from .models import Patient


def current_patient(
    access_token: str | None = Cookie(default=None),
    db: Session = Depends(get_db),
) -> Patient:
    payload = decode_token(access_token, "access") if access_token else None
    if payload is None:
        raise HTTPException(401, "Not signed in")
    patient = db.get(Patient, int(payload["sub"]))
    if patient is None:
        raise HTTPException(401, "Not signed in")
    return patient
