import os
import sys
from pathlib import Path

os.environ.setdefault("DATA_DIR", str(Path(__file__).parent / ".data"))
os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("DEMO_API_KEY", "test-demo-key")
os.environ.setdefault("TRACES_DIR", str(Path(__file__).parent / ".data" / "traces"))
sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest
from fastapi.testclient import TestClient

from app.main import app
from portal.db import Base, SessionLocal, engine
from portal.seed import seed


@pytest.fixture(autouse=True)
def fresh_db():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        seed(db)
    yield


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture
def priya(client):
    r = client.post("/portal/api/auth/login", json={"username": "demo", "password": "demo123"})
    assert r.status_code == 200
    return client
