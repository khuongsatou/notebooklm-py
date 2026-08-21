"""Bearer-token/dashboard-session authentication for the ``/v1`` router.

Every ``/v1`` request must carry either a valid machine bearer token or a signed
dashboard session cookie, and must address the server over a loopback ``Host``
literal. Two distinct guards:

* **Bearer/session authentication (401).** A request with neither a matching bearer
  nor a valid signed dashboard cookie is rejected before any upstream client call.
  The machine token remains required at startup so automation stays fail-closed.
* **Loopback Host (403).** Even bound to loopback and behind a token, a
  DNS-rebinding attack lets a malicious web page resolve its own hostname to
  ``127.0.0.1`` and drive the account. Rejecting any ``Host`` that is not a
  loopback literal (``127.0.0.1`` / ``[::1]`` / ``localhost``) closes that hole.

The token and the ``Authorization`` header value are NEVER logged (honor the
#1517/#1518 redaction discipline).

This module imports NO ``click`` / ``rich`` / ``cli``.
"""

from __future__ import annotations

import hashlib
import hmac
import ipaddress
import os
import time

from fastapi import HTTPException, Request

__all__ = [
    "SERVER_TOKEN_ENV",
    "DASHBOARD_PASSWORD_ENV",
    "DASHBOARD_SESSION_COOKIE",
    "create_dashboard_session",
    "dashboard_session_is_valid",
    "get_dashboard_password",
    "get_configured_token",
    "require_loopback_host",
    "require_auth",
]

#: Env var carrying the bearer token the server validates every request against.
SERVER_TOKEN_ENV = "NOTEBOOKLM_SERVER_TOKEN"
DASHBOARD_PASSWORD_ENV = "NOTEBOOKLM_DASHBOARD_PASSWORD"
DASHBOARD_SESSION_SECRET_ENV = "NOTEBOOKLM_DASHBOARD_SESSION_SECRET"
DASHBOARD_SESSION_COOKIE = "notebooklm_dashboard_session"
DASHBOARD_SESSION_TTL_SECONDS = 365 * 24 * 60 * 60

#: Hostnames always treated as loopback even though they are not numeric IP
#: literals. An empty host is intentionally absent — it must be rejected.
_LOOPBACK_HOSTNAMES = frozenset({"localhost"})

_BEARER_PREFIX = "bearer "


def get_configured_token() -> str | None:
    """Return the configured server token, or ``None`` when unset/empty.

    Read live from the environment so a test can set it per case. An empty or
    whitespace-only value is treated as *unset* (fail closed).
    """
    token = os.environ.get(SERVER_TOKEN_ENV)
    if token is None:
        return None
    token = token.strip()
    return token or None


def get_dashboard_password() -> str | None:
    """Return the configured dashboard password, or ``None`` when disabled."""
    password = os.environ.get(DASHBOARD_PASSWORD_ENV)
    if password is None:
        return None
    return password if password else None


def _dashboard_session_secret() -> str | None:
    """Return the dedicated session secret, falling back to the REST token."""
    configured = os.environ.get(DASHBOARD_SESSION_SECRET_ENV, "").strip()
    return configured or get_configured_token()


def create_dashboard_session(*, now: int | None = None) -> str:
    """Create a signed, time-limited dashboard session value."""
    secret = _dashboard_session_secret()
    if secret is None:
        raise RuntimeError("Dashboard session secret is not configured")
    expires_at = (int(time.time()) if now is None else now) + DASHBOARD_SESSION_TTL_SECONDS
    payload = str(expires_at)
    signature = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return f"{payload}.{signature}"


def dashboard_session_is_valid(value: str | None, *, now: int | None = None) -> bool:
    """Validate the HMAC and expiry of a dashboard session cookie."""
    secret = _dashboard_session_secret()
    if secret is None or not value:
        return False
    try:
        payload, presented_signature = value.split(".", 1)
        expires_at = int(payload)
    except (TypeError, ValueError):
        return False
    expected_signature = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
    current_time = int(time.time()) if now is None else now
    return expires_at >= current_time and hmac.compare_digest(
        presented_signature, expected_signature
    )


def _host_is_loopback(host_header: str) -> bool:
    """Return whether the ``Host`` header addresses a loopback literal.

    Strips an optional ``:port`` suffix. Accepts ``localhost``, an IPv4/IPv6
    loopback literal (``127.0.0.1``, ``::1``), and the bracketed IPv6 form
    (``[::1]``). Anything else (a public DNS name, ``0.0.0.0``, an empty host)
    is rejected.
    """
    host = host_header.strip()
    if not host:
        return False
    # Bracketed IPv6 form: "[::1]" or "[::1]:8000".
    if host.startswith("["):
        end = host.find("]")
        if end == -1:
            return False
        candidate = host[1:end]
        # Anything after "]" must be empty or a ":port" suffix — reject
        # trailing garbage like "[::1]evil.com".
        rest = host[end + 1 :]
        if rest and not (rest.startswith(":") and rest[1:].isdigit()):
            return False
    else:
        # Split off a trailing :port only when there is a single colon (an
        # unbracketed bare IPv6 literal has several and is not a valid Host with
        # a port anyway).
        candidate = host.rsplit(":", 1)[0] if host.count(":") == 1 else host
    candidate = candidate.strip()
    # Host hostnames are case-insensitive (RFC 3986/7230).
    if candidate.lower() in _LOOPBACK_HOSTNAMES:
        return True
    try:
        return ipaddress.ip_address(candidate).is_loopback
    except ValueError:
        return False


def _extract_bearer(authorization: str | None) -> str | None:
    """Return the token from an ``Authorization: Bearer <token>`` header, or None."""
    if not authorization:
        return None
    if authorization[: len(_BEARER_PREFIX)].lower() != _BEARER_PREFIX:
        return None
    return authorization[len(_BEARER_PREFIX) :].strip() or None


async def require_auth(request: Request) -> None:
    """Enforce loopback Host plus a machine bearer or dashboard session.

    Raises:
        HTTPException: ``403`` if the ``Host`` is not a loopback literal
            (DNS-rebinding guard, checked first); ``401`` if the bearer token is
            missing/empty/mismatched or no token is configured.
    """
    await require_loopback_host(request)

    configured = get_configured_token()
    presented = _extract_bearer(request.headers.get("authorization"))
    bearer_valid = (
        configured is not None
        and presented is not None
        and hmac.compare_digest(presented, configured)
    )
    session_valid = dashboard_session_is_valid(request.cookies.get(DASHBOARD_SESSION_COOKIE))
    if not bearer_valid and not session_valid:
        raise HTTPException(status_code=401, detail="Authentication required")


async def require_loopback_host(request: Request) -> None:
    """Reject requests that did not arrive through the trusted loopback proxy."""
    if not _host_is_loopback(request.headers.get("host", "")):
        raise HTTPException(status_code=403, detail="Host not allowed")
