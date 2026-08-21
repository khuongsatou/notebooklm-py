"""Cookie-sync route for browser-extension auth handoff.

This route intentionally lives outside the ``/v1`` loopback-Host guard because
the Chrome extension needs to call it through the public HTTPS origin. It is
still bearer-gated and writes only the filtered NotebookLM storage cookies.
"""

from __future__ import annotations

import hmac
import json
import os
import secrets
import shutil
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from fastapi import APIRouter, Header, HTTPException, Request

from ... import auth
from ..._auth.browser_capture import filter_storage_state_cookies_by_domain_policy
from ...auth import cookie_names_from_storage, extract_cookies_from_storage, missing_cookies_hint
from ...io import atomic_write_json
from ...paths import get_storage_path
from .._auth import SERVER_TOKEN_ENV

router = APIRouter(prefix="/sync", tags=["sync"])

COOKIE_SYNC_TOKEN_ENV = "NOTEBOOKLM_COOKIE_SYNC_TOKEN"
COOKIE_SYNC_SOURCE = "drive-down-cookies"
COOKIE_SYNC_SOURCE_URL = "https://notebooklm.google.com/"
COOKIE_SYNC_CHALLENGE_TTL_SECONDS = 120
COOKIE_SYNC_CAPTURE_MAX_AGE_SECONDS = 300


@router.get("/challenge")
async def cookie_sync_challenge(
    request: Request,
    authorization: str | None = Header(None),
) -> dict[str, Any]:
    """Issue a short-lived, single-use challenge for a local cookie upload."""
    _require_sync_token(authorization)
    now = time.monotonic()
    challenges = _challenge_store(request)
    for nonce, expires_at in list(challenges.items()):
        if expires_at <= now:
            challenges.pop(nonce, None)
    nonce = secrets.token_urlsafe(32)
    challenges[nonce] = now + COOKIE_SYNC_CHALLENGE_TTL_SECONDS
    return {
        "ok": True,
        "challenge": nonce,
        "expires_in": COOKIE_SYNC_CHALLENGE_TTL_SECONDS,
    }


@router.get("/status")
async def cookie_sync_status(authorization: str | None = Header(None)) -> dict[str, Any]:
    """Authenticated handshake used by the browser extension and web UI."""
    _require_sync_token(authorization)
    storage_path = get_storage_path()
    cookie_count = 0
    if storage_path.exists():
        try:
            storage_state = json.loads(storage_path.read_text(encoding="utf-8"))
            cookies = storage_state.get("cookies", []) if isinstance(storage_state, dict) else []
            cookie_count = len(cookies) if isinstance(cookies, list) else 0
        except (OSError, ValueError):
            cookie_count = 0
    return {
        "ok": True,
        "status": "ready",
        "profile_ready": storage_path.exists(),
        "cookie_count": cookie_count,
    }


@router.get("/connected")
async def cookie_sync_connected(
    request: Request,
    authorization: str | None = Header(None),
) -> dict[str, Any]:
    """Verify whether the synced NotebookLM storage can authenticate live."""
    _require_sync_token(authorization)
    storage_path = get_storage_path()
    if not storage_path.exists():
        return {
            "ok": True,
            "status": "missing",
            "connected": False,
            "profile_ready": False,
            "cookie_count": 0,
            "notebook_count": None,
            "error": "storage_state.json is not present on the VPS.",
        }

    try:
        storage_state = json.loads(storage_path.read_text(encoding="utf-8"))
        cookies = storage_state.get("cookies", []) if isinstance(storage_state, dict) else []
        cookie_count = len(cookies) if isinstance(cookies, list) else 0
    except (OSError, ValueError):
        return {
            "ok": True,
            "status": "invalid",
            "connected": False,
            "profile_ready": True,
            "cookie_count": 0,
            "notebook_count": None,
            "error": "storage_state.json cannot be read as valid JSON.",
        }

    reloaded, reload_error, notebook_count = await _reload_lifespan_client(request)
    return {
        "ok": True,
        "status": "connected" if reloaded else "auth_failed",
        "connected": reloaded,
        "profile_ready": True,
        "cookie_count": cookie_count,
        "notebook_count": notebook_count,
        "error": reload_error,
    }


@router.post("/cookies")
async def import_cookies(
    payload: dict[str, Any],
    request: Request,
    authorization: str | None = Header(None),
) -> dict[str, Any]:
    """Import extension-exported browser cookies into ``storage_state.json``."""
    _require_sync_token(authorization)
    _validate_cookie_payload_metadata(payload)
    _consume_challenge(request, payload.get("challenge"))
    storage_path = get_storage_path()
    imported, backup_path = _import_cookie_payload(payload, storage_path)
    reloaded, reload_error, notebook_count = await _reload_lifespan_client(request)
    if not reloaded:
        _restore_previous_storage(storage_path, backup_path)
        raise HTTPException(
            status_code=401,
            detail=(
                "Local Chrome cookies were received but failed live NotebookLM "
                f"authentication: {reload_error or 'authentication verification failed'}"
            ),
        )
    persisted_count = len(imported.get("cookies", []))
    return {
        "ok": True,
        "status": "ok",
        "sync_id": uuid.uuid4().hex,
        "source": COOKIE_SYNC_SOURCE,
        "received_count": len(payload["cookies"]),
        "persisted_count": persisted_count,
        "cookie_count": persisted_count,
        "client_reloaded": True,
        "auth_verified": True,
        "notebook_count": notebook_count,
        "restart_required": False,
    }


@router.delete("/cookies")
async def clear_cookies(
    request: Request,
    authorization: str | None = Header(None),
) -> dict[str, Any]:
    """Clear persisted NotebookLM cookies and close the active auth client."""
    _require_sync_token(authorization)
    storage_path = get_storage_path()
    backup_path = storage_path.with_name(storage_path.name + ".bak")
    storage_deleted = storage_path.exists()
    backup_deleted = backup_path.exists()
    storage_path.unlink(missing_ok=True)
    backup_path.unlink(missing_ok=True)
    client_closed, close_error = await _clear_lifespan_client(request)
    return {
        "ok": True,
        "status": "cleared",
        "storage_deleted": storage_deleted,
        "backup_deleted": backup_deleted,
        "client_closed": client_closed,
        "client_close_error": close_error,
    }


def _challenge_store(request: Request) -> dict[str, float]:
    store = getattr(request.app.state, "cookie_sync_challenges", None)
    if not isinstance(store, dict):
        store = {}
        request.app.state.cookie_sync_challenges = store
    return store


def _consume_challenge(request: Request, challenge: Any) -> None:
    if not isinstance(challenge, str) or not challenge:
        raise HTTPException(status_code=400, detail="A cookie-sync challenge is required.")
    expires_at = _challenge_store(request).pop(challenge, None)
    if expires_at is None or expires_at <= time.monotonic():
        raise HTTPException(status_code=400, detail="Cookie-sync challenge is invalid or expired.")


def _validate_cookie_payload_metadata(payload: Any) -> None:
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Cookie-sync payload must be a JSON object.")
    if payload.get("source") != COOKIE_SYNC_SOURCE:
        raise HTTPException(status_code=400, detail="Cookie-sync source is not trusted.")
    if not _is_trusted_source_url(payload.get("source_url")):
        raise HTTPException(
            status_code=400, detail="Cookies must come from NotebookLM local Chrome."
        )
    cookies = payload.get("cookies")
    if not isinstance(cookies, list) or not cookies:
        raise HTTPException(status_code=400, detail="Cookie-sync payload contains no cookies.")
    captured_at = payload.get("captured_at")
    if not isinstance(captured_at, str):
        raise HTTPException(status_code=400, detail="Cookie capture timestamp is required.")
    try:
        captured = datetime.fromisoformat(captured_at.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(
            status_code=400, detail="Cookie capture timestamp is invalid."
        ) from None
    if captured.tzinfo is None:
        raise HTTPException(
            status_code=400, detail="Cookie capture timestamp must include timezone."
        )
    age = (datetime.now(timezone.utc) - captured.astimezone(timezone.utc)).total_seconds()
    if age < -30 or age > COOKIE_SYNC_CAPTURE_MAX_AGE_SECONDS:
        raise HTTPException(status_code=400, detail="Cookie capture is stale or from the future.")


def _is_trusted_source_url(source_url: Any) -> bool:
    if not isinstance(source_url, str) or not source_url:
        return False
    try:
        parsed = urlparse(source_url)
    except ValueError:
        return False
    if parsed.scheme != "https":
        return False
    if parsed.hostname != "notebooklm.google.com":
        return False
    if parsed.username is not None or parsed.password is not None:
        return False
    if parsed.query or parsed.fragment:
        return False
    return parsed.path in ("", "/")


def _configured_sync_token() -> str | None:
    """Return the cookie-sync bearer token, falling back to the REST token."""
    token = os.environ.get(COOKIE_SYNC_TOKEN_ENV) or os.environ.get(SERVER_TOKEN_ENV)
    if token is None:
        return None
    token = token.strip()
    return token or None


def _require_sync_token(authorization: str | None) -> None:
    configured = _configured_sync_token()
    presented = _extract_bearer(authorization)
    if configured is None or presented is None or not hmac.compare_digest(configured, presented):
        raise HTTPException(status_code=401, detail="Invalid or missing bearer token")


def _extract_bearer(authorization: str | None) -> str | None:
    if not authorization:
        return None
    prefix = "bearer "
    if authorization[: len(prefix)].lower() != prefix:
        return None
    return authorization[len(prefix) :].strip() or None


def _import_cookie_payload(
    payload: dict[str, Any], storage_path: Path
) -> tuple[dict[str, Any], Path | None]:
    storage_state = _coerce_cookie_json_to_storage_state(payload)
    filtered_state = filter_storage_state_cookies_by_domain_policy(
        storage_state,
        include_domains=set(),
        include_optional=False,
    )
    cookie_names = cookie_names_from_storage(filtered_state)
    try:
        extracted_cookies = extract_cookies_from_storage(filtered_state)
    except ValueError as exc:
        hint = missing_cookies_hint(cookie_names)
        raise HTTPException(status_code=400, detail=f"{exc}\n\n{hint}") from None

    empty_required = sorted(
        name
        for name in auth.MINIMUM_REQUIRED_COOKIES
        if not isinstance(extracted_cookies.get(name), str) or not extracted_cookies[name]
    )
    if empty_required:
        raise HTTPException(
            status_code=400,
            detail="Required cookies must have non-empty string values: "
            + ", ".join(empty_required),
        )

    storage_path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    backup_path = _backup_existing_storage(storage_path)
    atomic_write_json(storage_path, filtered_state)
    return filtered_state, backup_path


def _coerce_cookie_json_to_storage_state(payload: Any) -> dict[str, Any]:
    if isinstance(payload, dict) and isinstance(payload.get("cookies"), list):
        return {
            "cookies": [_normalize_imported_cookie(cookie) for cookie in payload["cookies"]],
            "origins": [],
        }
    if isinstance(payload, list):
        return {
            "cookies": [_normalize_imported_cookie(cookie) for cookie in payload],
            "origins": [],
        }
    raise HTTPException(
        status_code=400,
        detail=(
            "Cookie JSON must be either a storage_state object with a 'cookies' "
            "list or a bare list of cookie objects."
        ),
    )


def _normalize_imported_cookie(cookie: Any) -> dict[str, Any]:
    if not isinstance(cookie, dict):
        raise HTTPException(status_code=400, detail="Each cookie must be a JSON object.")

    normalized = dict(cookie)
    if "expires" not in normalized:
        normalized["expires"] = normalized.pop("expirationDate", -1)
    normalized.setdefault("path", "/")
    normalized.setdefault("httpOnly", False)
    name = normalized.get("name")
    if isinstance(name, str) and name.startswith(("__Secure-", "__Host-")):
        normalized["secure"] = True
    else:
        normalized.setdefault("secure", False)
    normalized.setdefault("sameSite", "None")
    return normalized


def _backup_existing_storage(storage_path: Path) -> Path | None:
    if not storage_path.exists():
        return None
    backup_path = storage_path.with_name(storage_path.name + ".bak")
    shutil.copy2(storage_path, backup_path)
    backup_path.chmod(0o600)
    return backup_path


def _restore_previous_storage(storage_path: Path, backup_path: Path | None) -> None:
    if backup_path is not None and backup_path.exists():
        shutil.copy2(backup_path, storage_path)
        storage_path.chmod(0o600)
    else:
        storage_path.unlink(missing_ok=True)


async def _reload_lifespan_client(request: Request) -> tuple[bool, str | None, int | None]:
    """Replace the lifespan-bound client after storage was rewritten.

    Tests inject a fake client with no ``close`` method; production uses the real
    ``NotebookLMClient`` and can be swapped without restarting the container.
    """
    state = getattr(request.app.state, "notebooklm", None)
    if state is None:
        return False, "lifespan state is not available", None
    old_client = getattr(state, "client", None)
    new_client: Any = None
    try:
        from ...client import NotebookLMClient

        context = NotebookLMClient.from_storage()
        new_client = await context.__aenter__()
        notebooks = await new_client.notebooks.list()
        state.client = new_client
        if old_client is not None and hasattr(old_client, "close"):
            await old_client.close(drain=False)
        return True, None, len(notebooks)
    except Exception as exc:  # pragma: no cover - depends on live auth/network
        if new_client is not None:
            try:
                await new_client.close(drain=False)
            except Exception:
                pass
        return False, str(exc), None


async def _clear_lifespan_client(request: Request) -> tuple[bool, str | None]:
    """Close and detach the active client so stale cookies cannot keep working."""
    state = getattr(request.app.state, "notebooklm", None)
    old_client = getattr(state, "client", None)
    if state is not None:
        state.client = None
    if old_client is None or not hasattr(old_client, "close"):
        return False, None
    try:
        await old_client.close(drain=False)
        return True, None
    except Exception as exc:  # pragma: no cover - defensive close path
        return False, str(exc)
