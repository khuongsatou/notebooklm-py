"""Public Chrome Profile 185 login bridge tests."""

from __future__ import annotations

import re
from urllib.parse import parse_qs, urlparse
from uuid import uuid4

from notebooklm.server.routes import profile_login

from .conftest import TEST_TOKEN


def _auth_headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {TEST_TOKEN}", "Host": "127.0.0.1"}


def test_hosted_profile_login_start_requires_dashboard_or_bearer_auth(raw_client) -> None:
    response = raw_client.post(
        "/auth/profile-login/start",
        headers={"Host": "127.0.0.1"},
    )

    assert response.status_code == 401


def test_hosted_profile_login_start_accepts_dashboard_session(raw_client, monkeypatch) -> None:
    monkeypatch.setenv("NOTEBOOKLM_DASHBOARD_PASSWORD", "dashboard-secret")
    login = raw_client.post(
        "/auth/login",
        json={"password": "dashboard-secret"},
        headers={"Host": "127.0.0.1"},
    )
    assert login.status_code == 200

    started = raw_client.post(
        "/auth/profile-login/start",
        headers={"Host": "127.0.0.1"},
    )

    assert started.status_code == 200
    assert started.json()["status"] == "waiting_for_extension"


def test_hosted_profile_login_start_returns_pollable_server_transaction(raw_client) -> None:
    started = raw_client.post("/auth/profile-login/start", headers=_auth_headers())

    assert started.status_code == 200
    body = started.json()
    assert body["ok"] is True
    assert body["status"] == "waiting_for_extension"
    assert body["connected"] is False
    assert body["bridge_url"].startswith("/profile-login?")
    query = parse_qs(urlparse(body["bridge_url"]).query)
    assert query["profile_login_id"] == [body["login_id"]]
    assert query["notebooklm_profile_login"] == ["1"]

    status = raw_client.get(
        "/auth/profile-login/status",
        params={"profile_login_id": body["login_id"]},
        headers=_auth_headers(),
    )
    assert status.status_code == 200
    assert status.json()["status"] == "waiting_for_extension"
    assert status.json()["login_id"] == body["login_id"]


def test_hosted_profile_login_status_expires_server_transaction(raw_client, monkeypatch) -> None:
    now = 1_800_000_000.0
    monkeypatch.setattr(profile_login.time, "time", lambda: now)
    started = raw_client.post("/auth/profile-login/start", headers=_auth_headers()).json()
    monkeypatch.setattr(
        profile_login.time,
        "time",
        lambda: now + profile_login.PROFILE_LOGIN_TTL_SECONDS + 1,
    )

    status = raw_client.get(
        "/auth/profile-login/status",
        params={"profile_login_id": started["login_id"]},
        headers=_auth_headers(),
    )

    assert status.status_code == 200
    assert status.json()["status"] == "expired"
    assert status.json()["connected"] is False


def test_hosted_profile_login_status_rejects_unknown_transaction(raw_client) -> None:
    response = raw_client.get(
        "/auth/profile-login/status",
        params={"profile_login_id": str(uuid4())},
        headers=_auth_headers(),
    )

    assert response.status_code == 404


def test_profile_login_bridge_is_public_but_credential_free(raw_client, monkeypatch) -> None:
    monkeypatch.setenv("NOTEBOOKLM_DASHBOARD_PASSWORD", "dashboard-secret")
    login_id = str(uuid4())

    response = raw_client.get("/profile-login", params={"profile_login_id": login_id})

    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["referrer-policy"] == "no-referrer"
    assert "unsafe-inline" not in response.headers["content-security-policy"]
    assert login_id in response.text
    assert "cclelndahbckbenkjhflpdbgdldlbecc" in response.text
    assert "profile_login_correlation" in response.text
    assert "COOKIE_SYNC_TOKEN" not in response.text
    assert "dashboard-secret" not in response.text


def test_profile_login_bridge_uses_one_nonce_for_inline_code(raw_client) -> None:
    response = raw_client.get("/profile-login", params={"profile_login_id": str(uuid4())})

    assert response.status_code == 200
    nonces = re.findall(r'nonce="([^"]+)"', response.text)
    assert len(nonces) == 2
    assert len(set(nonces)) == 1
    assert f"script-src 'nonce-{nonces[0]}'" in response.headers["content-security-policy"]
    assert f"style-src 'nonce-{nonces[0]}'" in response.headers["content-security-policy"]


def test_profile_login_bridge_requires_a_v4_correlation_id(raw_client) -> None:
    missing = raw_client.get("/profile-login")
    invalid = raw_client.get("/profile-login", params={"profile_login_id": "not-a-uuid"})

    assert missing.status_code == 400
    assert "correlation ID is required" in missing.json()["error"]["message"]
    assert invalid.status_code == 400
    assert "correlation ID is invalid" in invalid.json()["error"]["message"]
