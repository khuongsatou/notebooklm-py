"""Persistent managed API keys shared by the REST portal and MCP gateway."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from filelock import FileLock

from ..io import atomic_write_json
from ..paths import get_profile_dir

__all__ = [
    "KEY_PREFIX",
    "MCP_KEY_STORE_ENV",
    "ManagedKeyStore",
    "ManagedKeyStoreError",
    "get_managed_key_store_path",
]

KEY_PREFIX = "nlm_mcp_"
MCP_KEY_STORE_ENV = "NOTEBOOKLM_MCP_KEY_STORE"
_LAST_USED_WRITE_INTERVAL = timedelta(seconds=60)


class ManagedKeyStoreError(RuntimeError):
    """Stable error code raised by managed-key storage operations."""


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _parse_iso(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _key_hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _key_preview(value: str) -> str:
    return f"{value[:15]}…{value[-4:]}"


def _normalize_name(value: str) -> str:
    return " ".join(value.strip().split())[:80] or "MCP API key"


def _public_record(record: dict[str, Any]) -> dict[str, Any]:
    revoked_at = str(record.get("revokedAt") or "")
    return {
        "id": str(record.get("id") or ""),
        "name": str(record.get("name") or ""),
        "prefix": str(record.get("prefix") or ""),
        "status": "revoked" if revoked_at else "active",
        "createdAt": str(record.get("createdAt") or ""),
        "createdBy": str(record.get("createdBy") or ""),
        "lastUsedAt": str(record.get("lastUsedAt") or ""),
        "revokedAt": revoked_at,
        "legacy": False,
    }


def get_managed_key_store_path(profile: str | None = None) -> Path:
    """Resolve the shared store, honoring an explicit deployment override."""
    configured = os.environ.get(MCP_KEY_STORE_ENV, "").strip()
    if configured:
        return Path(configured).expanduser().resolve()
    return get_profile_dir(profile=profile, create=True) / "mcp_api_keys.json"


class ManagedKeyStore:
    """Issue, list, revoke and authenticate one-time MCP API key secrets."""

    def __init__(self, path: Path) -> None:
        self.path = path.expanduser().resolve()
        parent_created = not self.path.parent.exists()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if parent_created and sys.platform != "win32":
            self.path.parent.chmod(0o700)
        self.lock_path = self.path.with_suffix(self.path.suffix + ".lock")

    @classmethod
    def for_profile(cls, profile: str | None = None) -> ManagedKeyStore:
        return cls(get_managed_key_store_path(profile))

    def _read_unlocked(self) -> list[dict[str, Any]]:
        try:
            payload = json.loads(self.path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return []
        except (json.JSONDecodeError, OSError) as exc:
            raise ManagedKeyStoreError("mcp_key_store_unavailable") from exc
        keys = payload.get("keys") if isinstance(payload, dict) else None
        if not isinstance(keys, list) or not all(isinstance(item, dict) for item in keys):
            raise ManagedKeyStoreError("mcp_key_store_corrupt")
        return keys

    def _write_unlocked(self, keys: list[dict[str, Any]]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        atomic_write_json(self.path, {"version": 1, "keys": keys}, mode=0o600)

    def list(self) -> list[dict[str, Any]]:
        with FileLock(str(self.lock_path), timeout=10):
            records = [_public_record(record) for record in self._read_unlocked()]
        return sorted(records, key=lambda record: record["createdAt"], reverse=True)

    def create(self, *, name: str, created_by: str = "dashboard") -> dict[str, Any]:
        api_key = f"{KEY_PREFIX}{secrets.token_urlsafe(32)}"
        record = {
            "id": str(uuid.uuid4()),
            "name": _normalize_name(name),
            "prefix": _key_preview(api_key),
            "keyHash": _key_hash(api_key),
            "createdAt": _iso(_now()),
            "createdBy": created_by.strip()[:120],
            "lastUsedAt": "",
            "revokedAt": "",
        }
        with FileLock(str(self.lock_path), timeout=10):
            keys = self._read_unlocked()
            keys.append(record)
            self._write_unlocked(keys)
        return {"apiKey": api_key, "key": _public_record(record)}

    def revoke(self, key_id: str) -> dict[str, Any]:
        target = key_id.strip()
        if not target:
            raise ManagedKeyStoreError("mcp_key_not_found")
        with FileLock(str(self.lock_path), timeout=10):
            keys = self._read_unlocked()
            record = next((item for item in keys if item.get("id") == target), None)
            if record is None:
                raise ManagedKeyStoreError("mcp_key_not_found")
            if not record.get("revokedAt"):
                record["revokedAt"] = _iso(_now())
                self._write_unlocked(keys)
            return _public_record(record)

    def authenticate(self, api_key: str) -> dict[str, Any] | None:
        """Validate a secret and update its coarse last-used timestamp."""
        supplied = api_key.strip()
        if not supplied:
            return None
        return self.authenticate_hash(_key_hash(supplied))

    def authenticate_hash(self, supplied_hash: str) -> dict[str, Any] | None:
        """Validate an already-hashed secret without retaining its cleartext."""
        matched: dict[str, Any] | None = None
        now = _now()
        with FileLock(str(self.lock_path), timeout=10):
            keys = self._read_unlocked()
            for record in keys:
                digest = str(record.get("keyHash") or "")
                equal = bool(digest) and hmac.compare_digest(digest, supplied_hash)
                if equal and not record.get("revokedAt"):
                    matched = record
            if matched is None:
                return None
            last_used = _parse_iso(matched.get("lastUsedAt"))
            if last_used is None or now - last_used >= _LAST_USED_WRITE_INTERVAL:
                matched["lastUsedAt"] = _iso(now)
                self._write_unlocked(keys)
            return _public_record(matched)
