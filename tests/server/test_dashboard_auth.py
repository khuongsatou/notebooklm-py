"""Dashboard password and HttpOnly session coverage."""

from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient

from notebooklm.server._auth import (
    DASHBOARD_PASSWORD_ENV,
    DASHBOARD_SESSION_COOKIE,
)


def test_dashboard_login_persists_until_logout(app: Any, monkeypatch: Any) -> None:
    monkeypatch.setenv(DASHBOARD_PASSWORD_ENV, "123")

    with TestClient(app, base_url="http://127.0.0.1") as client:
        assert client.get("/auth/session").json() == {"authenticated": False}
        assert client.post("/auth/login", json={"password": "wrong"}).status_code == 401

        login = client.post("/auth/login", json={"password": "123"})
        assert login.status_code == 200
        assert login.json() == {"ok": True, "authenticated": True}
        cookie_header = login.headers["set-cookie"]
        assert "HttpOnly" in cookie_header
        assert "SameSite=strict" in cookie_header
        assert DASHBOARD_SESSION_COOKIE in client.cookies

        assert client.get("/auth/session").json() == {"authenticated": True}
        refreshed = client.get("/auth/session")
        assert "Max-Age=31536000" in refreshed.headers["set-cookie"]
        assert client.get("/v1/status").status_code == 200

        logout = client.post("/auth/logout")
        assert logout.status_code == 200
        assert logout.json() == {"ok": True, "authenticated": False}
        assert client.get("/auth/session").json() == {"authenticated": False}
        assert client.get("/v1/status").status_code == 401


def test_dashboard_session_rejects_tampering(app: Any, monkeypatch: Any) -> None:
    monkeypatch.setenv(DASHBOARD_PASSWORD_ENV, "123")

    with TestClient(app, base_url="http://127.0.0.1") as client:
        assert client.post("/auth/login", json={"password": "123"}).status_code == 200
        value = client.cookies.get(DASHBOARD_SESSION_COOKIE)
        assert value
        client.cookies.set(DASHBOARD_SESSION_COOKIE, f"{value}tampered")
        assert client.get("/v1/status").status_code == 401


def test_production_session_cookie_is_secure(app: Any, monkeypatch: Any) -> None:
    monkeypatch.setenv(DASHBOARD_PASSWORD_ENV, "123")
    monkeypatch.setenv("NOTEBOOKLM_DEPLOY_ENV", "production")

    with TestClient(app, base_url="https://127.0.0.1") as client:
        login = client.post("/auth/login", json={"password": "123"})
        assert login.status_code == 200
        assert "Secure" in login.headers["set-cookie"]
