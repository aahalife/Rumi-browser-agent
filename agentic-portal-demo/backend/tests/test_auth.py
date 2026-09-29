import time

from portal.settings import settings


def cookie_names(response):
    return [c.split("=", 1)[0] for c in response.headers.get_list("set-cookie")]


def test_login_sets_httponly_cookies(client):
    r = client.post("/portal/api/auth/login", json={"username": "demo", "password": "demo123"})
    assert r.status_code == 200
    set_cookies = r.headers.get_list("set-cookie")
    assert len(set_cookies) == 2
    for c in set_cookies:
        assert "HttpOnly" in c and "SameSite=lax" in c.replace("Lax", "lax")
    access = next(c for c in set_cookies if c.startswith("access_token="))
    refresh = next(c for c in set_cookies if c.startswith("refresh_token="))
    assert "Path=/portal;" in access or access.endswith("Path=/portal")
    assert "Path=/portal/api/auth" in refresh


def test_bad_password_rejected(client):
    r = client.post("/portal/api/auth/login", json={"username": "demo", "password": "nope"})
    assert r.status_code == 401
    assert "set-cookie" not in r.headers


def test_me_requires_cookie(client):
    assert client.get("/portal/api/me").status_code == 401


def test_me_after_login(priya):
    r = priya.get("/portal/api/me")
    assert r.status_code == 200
    assert r.json()["first_name"] == "Priya"


def test_refresh_rotates_and_revokes_old(priya):
    old_refresh = priya.cookies["refresh_token"]
    old_access = priya.cookies["access_token"]
    r = priya.post("/portal/api/auth/refresh")
    assert r.status_code == 200
    assert priya.cookies["refresh_token"] != old_refresh
    assert priya.cookies["access_token"] != old_access

    priya.cookies.set("refresh_token", old_refresh, path="/portal/api/auth")
    r = priya.post("/portal/api/auth/refresh")
    assert r.status_code == 401


def test_logout_clears_and_revokes(priya):
    refresh = priya.cookies["refresh_token"]
    r = priya.post("/portal/api/auth/logout")
    assert r.status_code == 200
    assert "access_token" not in priya.cookies
    priya.cookies.set("refresh_token", refresh, path="/portal/api/auth")
    assert priya.post("/portal/api/auth/refresh").status_code == 401


def test_short_access_token_expires_and_refresh_recovers(client, monkeypatch):
    monkeypatch.setattr(settings, "access_token_ttl_seconds", 1)
    r = client.post("/portal/api/auth/login", json={"username": "demo", "password": "demo123"})
    assert r.status_code == 200
    assert client.get("/portal/api/me").status_code == 200
    time.sleep(1.5)
    assert client.get("/portal/api/me").status_code == 401
    assert client.post("/portal/api/auth/refresh").status_code == 200
    assert client.get("/portal/api/me").status_code == 200


def test_device_token_signs_in_again_after_logout(client):
    r = client.post("/portal/api/auth/login", json={"username": "demo", "password": "demo123"})
    assert r.status_code == 200
    issued = client.post("/portal/api/auth/device-token", json={}, headers={"User-Agent": "Mozilla/5.0 (iPhone) CarePortalAssistant/1.0"})
    assert issued.status_code == 200
    token = issued.json()["token"]
    assert issued.json()["label"] == "iPhone, CarePortal Assistant"

    client.post("/portal/api/auth/logout")
    assert client.get("/portal/api/me").status_code == 401

    code = client.post("/portal/api/auth/device-login", json={"token": token}).json()["code"]
    r = client.get(f"/portal/api/auth/device-login/complete?code={code}&next=/portal/visits", follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"] == "/portal/visits"
    assert client.get("/portal/api/me").json()["first_name"] == "Priya"
    # the one-time code is spent
    assert client.get(f"/portal/api/auth/device-login/complete?code={code}", follow_redirects=False).status_code == 401


def test_device_token_needs_session_and_can_be_revoked(client):
    assert client.post("/portal/api/auth/device-token", json={}).status_code == 401
    client.post("/portal/api/auth/login", json={"username": "demo", "password": "demo123"})
    token = client.post("/portal/api/auth/device-token", json={"label": "Test phone"}).json()["token"]
    assert client.post("/portal/api/auth/device-login", json={"token": "1.nope"}).status_code == 401
    assert client.post("/portal/api/auth/device-login", json={"token": "garbage"}).status_code == 401
    client.post("/portal/api/auth/device-login/revoke", json={"token": token})
    assert client.post("/portal/api/auth/device-login", json={"token": token}).status_code == 401
    assert client.get("/portal/api/auth/device-login/complete?code=bogus", follow_redirects=False).status_code == 401
