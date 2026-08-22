"""Cookie-sync receiver tests."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from uuid import uuid4

from notebooklm.server.routes import cookie_sync

from .conftest import TEST_TOKEN


def _auth_headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {TEST_TOKEN}"}


def _server_auth_headers() -> dict[str, str]:
    return {**_auth_headers(), "Host": "127.0.0.1"}


def _valid_payload(source_url: str = "https://notebooklm.google.com/") -> dict[str, object]:
    return {
        "source": "drive-down-cookies",
        "scope": "current",
        "source_url": source_url,
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "cookies": [
            {
                "domain": ".google.com",
                "name": "SID",
                "value": "sid-value",
                "path": "/",
                "secure": True,
                "expirationDate": 1820000000,
            },
            {
                "domain": ".google.com",
                "name": "__Secure-1PSIDTS",
                "value": "psidts-value",
                "path": "/",
                "secure": True,
                "expirationDate": 1820000000,
            },
            {
                "domain": ".google.com",
                "name": "OSID",
                "value": "osid-value",
                "path": "/",
                "secure": True,
                "expirationDate": 1820000000,
            },
        ],
    }


def _payload_with_challenge(
    raw_client, source_url: str = "https://notebooklm.google.com/"
) -> dict[str, object]:
    challenge = raw_client.get("/sync/challenge", headers=_auth_headers())
    assert challenge.status_code == 200
    payload = _valid_payload(source_url)
    payload["challenge"] = challenge.json()["challenge"]
    return payload


def test_cookie_sync_requires_bearer(raw_client) -> None:
    resp = raw_client.post("/sync/cookies", json=_valid_payload())
    assert resp.status_code == 401


def test_cookie_sync_status_requires_bearer(raw_client) -> None:
    resp = raw_client.get("/sync/status")
    assert resp.status_code == 401


def test_cookie_sync_clear_requires_bearer(raw_client) -> None:
    resp = raw_client.delete("/sync/cookies")
    assert resp.status_code == 401


def test_cookie_sync_challenge_requires_bearer(raw_client) -> None:
    resp = raw_client.get("/sync/challenge")
    assert resp.status_code == 401


def test_cookie_sync_connected_requires_bearer(raw_client) -> None:
    resp = raw_client.get("/sync/connected")
    assert resp.status_code == 401


def test_cookie_sync_status_reports_ready(raw_client, monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("NOTEBOOKLM_HOME", str(tmp_path))
    monkeypatch.setenv("NOTEBOOKLM_PROFILE", "server")

    resp = raw_client.get("/sync/status", headers=_auth_headers())

    assert resp.status_code == 200
    assert resp.json() == {
        "ok": True,
        "status": "ready",
        "profile_ready": False,
        "cookie_count": 0,
    }


def test_cookie_sync_connected_reports_missing_storage(raw_client, monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("NOTEBOOKLM_HOME", str(tmp_path))
    monkeypatch.setenv("NOTEBOOKLM_PROFILE", "server")

    resp = raw_client.get("/sync/connected", headers=_auth_headers())

    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    assert body["connected"] is False
    assert body["status"] == "missing"
    assert body["profile_ready"] is False


def test_cookie_sync_connected_verifies_live_auth(raw_client, monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("NOTEBOOKLM_HOME", str(tmp_path))
    monkeypatch.setenv("NOTEBOOKLM_PROFILE", "server")
    storage_path = tmp_path / "profiles" / "server" / "storage_state.json"
    storage_path.parent.mkdir(parents=True)
    storage_path.write_text(
        json.dumps({"cookies": [{"name": "SID"}], "origins": []}), encoding="utf-8"
    )

    async def _verified(_request):
        return True, None, 4

    monkeypatch.setattr(cookie_sync, "_reload_lifespan_client", _verified)

    resp = raw_client.get("/sync/connected", headers=_auth_headers())

    assert resp.status_code == 200
    body = resp.json()
    assert body["connected"] is True
    assert body["status"] == "connected"
    assert body["cookie_count"] == 1
    assert body["notebook_count"] == 4


def test_cookie_sync_imports_cookie_json(raw_client, monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("NOTEBOOKLM_HOME", str(tmp_path))
    monkeypatch.setenv("NOTEBOOKLM_PROFILE", "server")

    async def _verified(_request):
        return True, None, 2

    monkeypatch.setattr(cookie_sync, "_reload_lifespan_client", _verified)
    payload = _payload_with_challenge(raw_client)
    resp = raw_client.post("/sync/cookies", json=payload, headers=_auth_headers())

    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    assert body["cookie_count"] == 3
    assert body["received_count"] == 3
    assert body["persisted_count"] == 3
    assert body["client_reloaded"] is True
    assert body["auth_verified"] is True
    assert body["notebook_count"] == 2
    assert body["restart_required"] is False

    storage_path = tmp_path / "profiles" / "server" / "storage_state.json"
    saved = json.loads(storage_path.read_text(encoding="utf-8"))
    names = {cookie["name"] for cookie in saved["cookies"]}
    assert {"SID", "__Secure-1PSIDTS", "OSID"} <= names


def test_cookie_sync_correlates_the_current_profile_login(
    raw_client, monkeypatch, tmp_path
) -> None:
    monkeypatch.setenv("NOTEBOOKLM_HOME", str(tmp_path))
    monkeypatch.setenv("NOTEBOOKLM_PROFILE", "server")
    profile_login_id = str(uuid4())

    async def _verified(_request):
        return True, None, 3

    monkeypatch.setattr(cookie_sync, "_reload_lifespan_client", _verified)
    payload = _payload_with_challenge(raw_client)
    payload["profile_login_id"] = profile_login_id
    imported = raw_client.post("/sync/cookies", json=payload, headers=_auth_headers())

    assert imported.status_code == 200
    assert imported.json()["profile_login_id"] == profile_login_id
    matched = raw_client.get(
        "/sync/connected",
        params={"profile_login_id": profile_login_id},
        headers=_auth_headers(),
    )
    assert matched.status_code == 200
    assert matched.json()["connected"] is True
    assert matched.json()["profile_login_matched"] is True

    mismatched = raw_client.get(
        "/sync/connected",
        params={"profile_login_id": str(uuid4())},
        headers=_auth_headers(),
    )
    assert mismatched.status_code == 200
    assert mismatched.json()["connected"] is False
    assert mismatched.json()["status"] == "waiting_for_profile_login"
    assert mismatched.json()["profile_login_matched"] is False


def test_cookie_sync_completes_hosted_profile_login_transaction(
    raw_client, monkeypatch, tmp_path
) -> None:
    monkeypatch.setenv("NOTEBOOKLM_HOME", str(tmp_path))
    monkeypatch.setenv("NOTEBOOKLM_PROFILE", "server")

    async def _verified(_request):
        return True, None, 6

    monkeypatch.setattr(cookie_sync, "_reload_lifespan_client", _verified)
    started = raw_client.post(
        "/auth/profile-login/start",
        headers=_server_auth_headers(),
    )
    assert started.status_code == 200
    login_id = started.json()["login_id"]
    payload = _payload_with_challenge(raw_client)
    payload["profile_login_id"] = login_id

    imported = raw_client.post("/sync/cookies", json=payload, headers=_auth_headers())
    status = raw_client.get(
        "/auth/profile-login/status",
        params={"profile_login_id": login_id},
        headers=_server_auth_headers(),
    )

    assert imported.status_code == 200
    assert status.status_code == 200
    assert status.json()["connected"] is True
    assert status.json()["status"] == "connected"
    assert status.json()["cookie_count"] == 3
    assert status.json()["notebook_count"] == 6


def test_cookie_sync_rejects_invalid_profile_login_correlation(raw_client) -> None:
    payload = _payload_with_challenge(raw_client)
    payload["profile_login_id"] = "not-a-uuid"
    response = raw_client.post("/sync/cookies", json=payload, headers=_auth_headers())

    assert response.status_code == 400
    assert "correlation ID is invalid" in response.json()["error"]["message"]


def test_cookie_sync_rejects_incomplete_cookie_set(raw_client, monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("NOTEBOOKLM_HOME", str(tmp_path))
    monkeypatch.setenv("NOTEBOOKLM_PROFILE", "server")
    payload = _valid_payload()
    payload["cookies"] = [
        cookie for cookie in payload["cookies"] if cookie["name"] != "__Secure-1PSIDTS"
    ]

    payload["challenge"] = _payload_with_challenge(raw_client)["challenge"]
    resp = raw_client.post("/sync/cookies", json=payload, headers=_auth_headers())

    assert resp.status_code == 400
    assert "__Secure-1PSIDTS" in resp.json()["error"]["message"]


def test_cookie_sync_rejects_missing_challenge(raw_client) -> None:
    resp = raw_client.post("/sync/cookies", json=_valid_payload(), headers=_auth_headers())
    assert resp.status_code == 400
    assert "challenge" in resp.json()["error"]["message"].lower()


def test_cookie_sync_accepts_current_notebook_source(raw_client, monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("NOTEBOOKLM_HOME", str(tmp_path))
    monkeypatch.setenv("NOTEBOOKLM_PROFILE", "server")

    async def _verified(_request):
        return True, None, 1

    monkeypatch.setattr(cookie_sync, "_reload_lifespan_client", _verified)
    payload = _payload_with_challenge(raw_client, "https://notebook.google.com/")
    resp = raw_client.post("/sync/cookies", json=payload, headers=_auth_headers())

    assert resp.status_code == 200
    assert resp.json()["auth_verified"] is True


def test_cookie_sync_rejects_source_url_bypass(raw_client) -> None:
    payload = _valid_payload("https://notebooklm.google.com.evil.example/")
    resp = raw_client.post("/sync/cookies", json=payload, headers=_auth_headers())

    assert resp.status_code == 400
    assert "NotebookLM local Chrome" in resp.json()["error"]["message"]


def test_cookie_sync_clear_removes_storage_and_backup(raw_client, monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("NOTEBOOKLM_HOME", str(tmp_path))
    monkeypatch.setenv("NOTEBOOKLM_PROFILE", "server")
    storage_path = tmp_path / "profiles" / "server" / "storage_state.json"
    backup_path = storage_path.with_name(storage_path.name + ".bak")
    storage_path.parent.mkdir(parents=True)
    storage_path.write_text(json.dumps({"cookies": [{"name": "old"}]}), encoding="utf-8")
    backup_path.write_text(json.dumps({"cookies": [{"name": "backup"}]}), encoding="utf-8")

    class _ClosableClient:
        def __init__(self) -> None:
            self.closed = False

        async def close(self, *, drain: bool = True) -> None:
            del drain
            self.closed = True

    closable = _ClosableClient()
    raw_client.app.state.notebooklm.client = closable  # type: ignore[attr-defined]

    resp = raw_client.delete("/sync/cookies", headers=_auth_headers())

    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    assert body["status"] == "cleared"
    assert body["storage_deleted"] is True
    assert body["backup_deleted"] is True
    assert body["client_closed"] is True
    assert body["client_close_error"] is None
    assert closable.closed is True
    assert not storage_path.exists()
    assert not backup_path.exists()


def test_cookie_sync_import_reload_works_after_clear(raw_client, monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("NOTEBOOKLM_HOME", str(tmp_path))
    monkeypatch.setenv("NOTEBOOKLM_PROFILE", "server")
    raw_client.delete("/sync/cookies", headers=_auth_headers())

    async def _verified(_request):
        return True, None, 1

    monkeypatch.setattr(cookie_sync, "_reload_lifespan_client", _verified)
    resp = raw_client.post(
        "/sync/cookies",
        json=_payload_with_challenge(raw_client),
        headers=_auth_headers(),
    )

    assert resp.status_code == 200
    assert resp.json()["auth_verified"] is True


def test_cookie_sync_rejects_replayed_challenge(raw_client, monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("NOTEBOOKLM_HOME", str(tmp_path))
    monkeypatch.setenv("NOTEBOOKLM_PROFILE", "server")

    async def _verified(_request):
        return True, None, 0

    monkeypatch.setattr(cookie_sync, "_reload_lifespan_client", _verified)
    payload = _payload_with_challenge(raw_client)
    first = raw_client.post("/sync/cookies", json=payload, headers=_auth_headers())
    second = raw_client.post("/sync/cookies", json=payload, headers=_auth_headers())

    assert first.status_code == 200
    assert second.status_code == 400
    assert "invalid or expired" in second.json()["error"]["message"]


def test_cookie_sync_rolls_back_when_live_auth_fails(raw_client, monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("NOTEBOOKLM_HOME", str(tmp_path))
    monkeypatch.setenv("NOTEBOOKLM_PROFILE", "server")
    storage_path = tmp_path / "profiles" / "server" / "storage_state.json"
    storage_path.parent.mkdir(parents=True)
    previous = {"cookies": [{"name": "previous", "value": "kept"}], "origins": []}
    storage_path.write_text(json.dumps(previous), encoding="utf-8")

    async def _rejected(_request):
        return False, "Authentication expired", None

    monkeypatch.setattr(cookie_sync, "_reload_lifespan_client", _rejected)
    response = raw_client.post(
        "/sync/cookies",
        json=_payload_with_challenge(raw_client),
        headers=_auth_headers(),
    )

    assert response.status_code == 401
    assert "failed live NotebookLM authentication" in response.json()["error"]["message"]
    assert json.loads(storage_path.read_text(encoding="utf-8")) == previous
