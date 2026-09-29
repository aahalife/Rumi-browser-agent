import hashlib
import hmac
import os
import secrets
import time
import uuid
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import APIRouter, Cookie, Depends, Header, HTTPException, Query, Response
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import get_db
from .models import DeviceToken, Patient, RevokedToken
from .settings import settings

router = APIRouter(prefix="/auth")

ACCESS_COOKIE = "access_token"
REFRESH_COOKIE = "refresh_token"
ACCESS_PATH = "/portal"
REFRESH_PATH = "/portal/api/auth"


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 100_000)
    return f"{salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    salt_hex, digest_hex = stored.split("$")
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), 100_000)
    return hmac.compare_digest(digest.hex(), digest_hex)


def _make_token(patient_id: int, kind: str, ttl_seconds: int) -> tuple[str, str, datetime]:
    now = datetime.now(timezone.utc)
    exp = now + timedelta(seconds=ttl_seconds)
    jti = uuid.uuid4().hex
    payload = {"sub": str(patient_id), "kind": kind, "jti": jti, "iat": now, "exp": exp}
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256"), jti, exp


def decode_token(token: str, kind: str) -> dict | None:
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError:
        return None
    if payload.get("kind") != kind:
        return None
    return payload


def _set_cookie(response: Response, name: str, value: str, path: str, max_age: int) -> None:
    response.set_cookie(
        name,
        value,
        max_age=max_age,
        path=path,
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
    )


def issue_cookies(response: Response, patient_id: int) -> None:
    access, _, _ = _make_token(patient_id, "access", settings.access_token_ttl_seconds)
    refresh, _, _ = _make_token(patient_id, "refresh", settings.refresh_token_ttl_seconds)
    _set_cookie(response, ACCESS_COOKIE, access, ACCESS_PATH, settings.access_token_ttl_seconds)
    _set_cookie(response, REFRESH_COOKIE, refresh, REFRESH_PATH, settings.refresh_token_ttl_seconds)


def clear_cookies(response: Response) -> None:
    response.delete_cookie(ACCESS_COOKIE, path=ACCESS_PATH)
    response.delete_cookie(REFRESH_COOKIE, path=REFRESH_PATH)


def _revoke(db: Session, payload: dict) -> None:
    exp = datetime.fromtimestamp(payload["exp"], tz=timezone.utc).replace(tzinfo=None)
    db.merge(RevokedToken(jti=payload["jti"], expires_at=exp))
    db.commit()


def _is_revoked(db: Session, jti: str) -> bool:
    return db.get(RevokedToken, jti) is not None


class LoginBody(BaseModel):
    username: str
    password: str


@router.post("/login")
def login(body: LoginBody, response: Response, db: Session = Depends(get_db)):
    patient = db.scalar(select(Patient).where(Patient.username == body.username))
    if patient is None or not verify_password(body.password, patient.password_hash):
        raise HTTPException(401, "Invalid username or password")
    issue_cookies(response, patient.id)
    return {"ok": True}


@router.post("/refresh")
def refresh(
    response: Response,
    refresh_token: str | None = Cookie(default=None),
    db: Session = Depends(get_db),
):
    payload = decode_token(refresh_token, "refresh") if refresh_token else None
    if payload is None or _is_revoked(db, payload["jti"]):
        clear_cookies(response)
        raise HTTPException(401, "Refresh token invalid")
    _revoke(db, payload)
    issue_cookies(response, int(payload["sub"]))
    return {"ok": True}


@router.post("/logout")
def logout(
    response: Response,
    refresh_token: str | None = Cookie(default=None),
    db: Session = Depends(get_db),
):
    payload = decode_token(refresh_token, "refresh") if refresh_token else None
    if payload is not None:
        _revoke(db, payload)
    clear_cookies(response)
    return {"ok": True}


# ---- Device sign-in: the phone keeps a long-lived token and can open a new session with it ----

DEVICE_TOKEN_DAYS = 90
_login_codes: dict[str, tuple[int, int, float]] = {}  # code -> (patient_id, token_id, expires_epoch)


def _current_patient_id(access_token: str | None) -> int:
    payload = decode_token(access_token, "access") if access_token else None
    if payload is None:
        raise HTTPException(401, "Not signed in")
    return int(payload["sub"])


def _device_label(user_agent: str) -> str:
    if "CarePortalAssistant" in user_agent:
        return "iPhone, CarePortal Assistant"
    if "iPhone" in user_agent:
        return "iPhone"
    if "Macintosh" in user_agent:
        return "Mac"
    return "Browser"


def _split_token(token: str) -> tuple[int, str] | None:
    try:
        token_id, secret = token.split(".", 1)
        return int(token_id), secret
    except ValueError:
        return None


def _lookup_device_token(db: Session, token: str) -> DeviceToken | None:
    parts = _split_token(token)
    if parts is None:
        return None
    token_id, secret = parts
    row = db.get(DeviceToken, token_id)
    if row is None or row.revoked or row.expires_at < datetime.now():
        return None
    if not hmac.compare_digest(row.token_hash, hashlib.sha256(secret.encode()).hexdigest()):
        return None
    return row


class DeviceTokenBody(BaseModel):
    label: str | None = None


@router.post("/device-token")
def create_device_token(
    body: DeviceTokenBody,
    access_token: str | None = Cookie(default=None),
    user_agent: str = Header(default=""),
    db: Session = Depends(get_db),
):
    """Called by the portal page right after a sign-in inside the app. Needs the fresh session."""
    patient_id = _current_patient_id(access_token)
    secret = secrets.token_urlsafe(32)
    row = DeviceToken(
        patient_id=patient_id,
        token_hash=hashlib.sha256(secret.encode()).hexdigest(),
        label=(body.label or _device_label(user_agent))[:64],
        expires_at=datetime.now() + timedelta(days=DEVICE_TOKEN_DAYS),
    )
    db.add(row)
    db.commit()
    return {"id": row.id, "token": f"{row.id}.{secret}", "expires_at": row.expires_at, "label": row.label}


class DeviceLoginBody(BaseModel):
    token: str


@router.post("/device-login")
def device_login(body: DeviceLoginBody, db: Session = Depends(get_db)):
    """Exchange the device token for a one-time code. The WebView then opens the complete URL."""
    row = _lookup_device_token(db, body.token)
    if row is None:
        raise HTTPException(401, "This phone's saved sign-in is no longer valid.")
    now = time.time()
    for code, (_, _, exp) in list(_login_codes.items()):
        if exp < now:
            _login_codes.pop(code, None)
    code = secrets.token_urlsafe(24)
    _login_codes[code] = (row.patient_id, row.id, now + 120)
    return {"code": code, "expires_in": 120}


@router.get("/device-login/complete")
def device_login_complete(
    code: str = Query(),
    next: str = Query(default="/portal/home"),
    db: Session = Depends(get_db),
):
    entry = _login_codes.pop(code, None)
    if entry is None or entry[2] < time.time():
        raise HTTPException(401, "Sign-in code expired. Please sign in.")
    patient_id, token_id, _ = entry
    row = db.get(DeviceToken, token_id)
    if row is None or row.revoked:
        raise HTTPException(401, "This phone's saved sign-in was revoked.")
    row.last_used_at = datetime.now()
    db.commit()
    if not next.startswith("/portal"):
        next = "/portal/home"
    response = RedirectResponse(next, status_code=303)
    issue_cookies(response, patient_id)
    return response


@router.post("/device-login/revoke")
def device_login_revoke(body: DeviceLoginBody, db: Session = Depends(get_db)):
    """'Forget this phone': the app revokes its own token; no session needed."""
    parts = _split_token(body.token)
    row = db.get(DeviceToken, parts[0]) if parts else None
    if row is not None and hmac.compare_digest(row.token_hash, hashlib.sha256(parts[1].encode()).hexdigest()):
        row.revoked = True
        db.commit()
    return {"ok": True}
