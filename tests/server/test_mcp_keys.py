"""Authenticated MCP account portal API coverage."""

from __future__ import annotations

from fastapi.testclient import TestClient

from notebooklm.mcp._managed_keys import ManagedKeyStore
from notebooklm.mcp._usage import McpUsageStore


def test_mcp_config_is_safe_and_manifest_driven(
    authed_client: TestClient,
    monkeypatch,
) -> None:
    monkeypatch.setenv("NOTEBOOKLM_MCP_PUBLIC_URL", "https://mcp.example.test")

    response = authed_client.get("/v1/mcp/config")

    assert response.status_code == 200
    body = response.json()
    assert body["endpoint"] == "https://mcp.example.test/mcp"
    assert body["transport"] == "streamable-http"
    assert body["auth"]["header"] == "Authorization"
    assert "internal" not in str(body).lower()
    assert "secret" not in str(body).lower()


def test_mcp_key_create_list_authenticate_and_revoke(
    authed_client: TestClient,
    monkeypatch,
    tmp_path,
) -> None:
    store_path = tmp_path / "managed-keys.json"
    monkeypatch.setenv("NOTEBOOKLM_MCP_KEY_STORE", str(store_path))

    created = authed_client.post("/v1/mcp/keys", json={"name": "Cursor"})
    assert created.status_code == 201
    issued = created.json()
    secret = issued["apiKey"]
    key_id = issued["key"]["id"]
    assert secret.startswith("nlm_mcp_")

    listed = authed_client.get("/v1/mcp/keys")
    assert listed.status_code == 200
    assert listed.json()["keys"][0]["id"] == key_id
    assert "apiKey" not in listed.text
    assert secret not in store_path.read_text(encoding="utf-8")

    store = ManagedKeyStore(store_path)
    assert store.authenticate(secret)["id"] == key_id

    revoked = authed_client.delete(f"/v1/mcp/keys/{key_id}")
    assert revoked.status_code == 200
    assert revoked.json()["key"]["status"] == "revoked"
    assert store.authenticate(secret) is None


def test_mcp_key_routes_require_dashboard_or_server_auth(raw_client: TestClient) -> None:
    headers = {"Host": "127.0.0.1"}
    assert raw_client.get("/v1/mcp/config", headers=headers).status_code == 401
    assert raw_client.get("/v1/mcp/keys", headers=headers).status_code == 401
    assert raw_client.get("/v1/mcp/usage", headers=headers).status_code == 401
    assert (
        raw_client.post("/v1/mcp/keys", json={"name": "Denied"}, headers=headers).status_code == 401
    )


def test_mcp_usage_dashboard_and_period_validation(
    authed_client: TestClient,
    monkeypatch,
    tmp_path,
) -> None:
    usage_path = tmp_path / "mcp-usage.json"
    monkeypatch.setenv("NOTEBOOKLM_MCP_USAGE_STORE", str(usage_path))
    store = McpUsageStore(usage_path)
    reservation = store.reserve_create(tool="note_create", key_id="key-1", key_prefix="safe")
    store.record_result(
        tool="note_create", operation="create", success=True, reservation_id=reservation
    )
    store.record_result(tool="artifact_download", operation="download", success=True)

    response = authed_client.get("/v1/mcp/usage?period=7d")
    assert response.status_code == 200
    body = response.json()
    assert body["summary"]["createRequested"] == 1
    assert body["summary"]["createSuccess"] == 1
    assert body["summary"]["downloadSuccess"] == 1
    assert body["summary"]["dailyLimit"] == 100
    assert body["recent"][0]["tool"] == "artifact_download"

    invalid = authed_client.get("/v1/mcp/usage?period=year")
    assert invalid.status_code == 422
