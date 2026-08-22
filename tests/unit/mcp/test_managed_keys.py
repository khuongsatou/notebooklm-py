"""Managed MCP API key storage and manifest coverage."""

from __future__ import annotations

import json
import os
import stat

from notebooklm.mcp._integration import public_mcp_config
from notebooklm.mcp._managed_keys import KEY_PREFIX, ManagedKeyStore


def test_managed_key_is_one_time_hash_only_and_revocable(tmp_path) -> None:
    path = tmp_path / "mcp_api_keys.json"
    store = ManagedKeyStore(path)

    issued = store.create(name="  Claude   Desktop  ", created_by="tester")
    api_key = issued["apiKey"]

    assert api_key.startswith(KEY_PREFIX)
    assert len(api_key.removeprefix(KEY_PREFIX)) >= 43
    assert issued["key"]["name"] == "Claude Desktop"
    assert store.authenticate(api_key)["id"] == issued["key"]["id"]
    assert store.authenticate("wrong-key") is None

    persisted = path.read_text(encoding="utf-8")
    assert api_key not in persisted
    payload = json.loads(persisted)
    assert len(payload["keys"][0]["keyHash"]) == 64
    assert "keyHash" not in store.list()[0]
    if os.name != "nt":
        assert stat.S_IMODE(path.stat().st_mode) == 0o600

    revoked = store.revoke(issued["key"]["id"])
    assert revoked["status"] == "revoked"
    assert store.authenticate(api_key) is None


def test_public_manifest_config_uses_dedicated_mcp_origin(monkeypatch) -> None:
    monkeypatch.setenv("NOTEBOOKLM_APP_BASE_URL", "https://app.example.test")
    monkeypatch.setenv("NOTEBOOKLM_MCP_PUBLIC_URL", "https://mcp.example.test/")

    config = public_mcp_config()

    assert config["product"]["slug"] == "notebooklm-pro"
    assert config["endpoint"] == "https://mcp.example.test/mcp"
    assert config["auth"] == {
        "type": "header",
        "header": "Authorization",
        "valuePrefix": "Bearer",
    }
    assert config["endpoints"]["appBaseUrl"] == "https://app.example.test"
    assert config["permissions"]["callTools"] == "mcp-tools:call"
    assert sum(len(feature["tools"]) for feature in config["features"]) == 38
