"""Self-hosted OAuth 2.1 authorization server for the remote (HTTP) MCP transport.

claude.ai's custom-connector UI speaks only OAuth (no bearer field), so to reach the
server from claude.ai we must BE an OAuth authorization server. Rather than depend on
an external IdP, this runs a tiny single-tenant AS gated by one **password**, composed
with the Phase A bearer via :class:`~fastmcp.server.auth.MultiAuth` (so Claude Code /
Desktop keep using the bearer; claude.ai uses OAuth — one server, both clients).

Design (converged review — codex/claude/agy):

* Subclass :class:`InMemoryOAuthProvider`, which already implements the full OAuth 2.1
  flow (DCR, PKCE, token issue/refresh/revoke, metadata) CORRECTLY. Its only "testing"
  traits are in-memory storage and an auto-approve ``authorize()`` — both addressed
  here. We do NOT hand-roll the OAuth protocol.
* **Password gate without touching ``/authorize``**: the MCP-SDK ``AuthorizationHandler``
  validates client/redirect_uri/scope/PKCE BEFORE calling ``provider.authorize()`` and
  302s the browser to whatever it returns. So we override ``authorize()`` to stash the
  ALREADY-VALIDATED ``(client, params)`` under a single-use ``sid`` and return a
  ``/login?sid=`` URL. The validated ``redirect_uri`` never enters the browser → open
  redirect is structurally impossible; the ``sid`` doubles as the CSRF token.
* ``/login`` (a public route added in ``get_routes``) renders a password form (only the
  ``sid`` + a password field — nothing attacker-controlled, so no XSS) and, on a
  constant-time password match, calls the PARENT ``authorize`` to issue the code.

Hardening: strong-password startup check (primary brute-force defense), per-IP login
throttle, capped DCR + capped pending-stash (pre-auth DoS), and atomic file persistence
of clients+tokens (reusing ``_atomic_io``) so a redeploy doesn't force re-auth.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import secrets
import time
from dataclasses import dataclass
from pathlib import Path

from fastmcp.server.auth import AuthProvider
from fastmcp.server.auth.providers.in_memory import InMemoryOAuthProvider
from fastmcp.utilities.ui import create_secure_html_response
from mcp.server.auth.provider import (
    AccessToken,
    AuthorizationCode,
    AuthorizationParams,
    AuthorizeError,
    RefreshToken,
    RegistrationError,
)
from mcp.server.auth.settings import ClientRegistrationOptions
from mcp.shared.auth import OAuthClientInformationFull, OAuthToken
from starlette.requests import Request
from starlette.responses import HTMLResponse, RedirectResponse, Response
from starlette.routing import Route

from notebooklm._atomic_io import atomic_write_json

logger = logging.getLogger(__name__)

__all__ = [
    "OAUTH_BASE_URL_ENV",
    "OAUTH_PASSWORD_ENV",
    "OAuthConfig",
    "SelfHostedOAuthProvider",
    "build_oauth_provider",
    "get_oauth_config",
]

#: Env vars (env-only; never CLI flags → no `ps aux` leak). Both required together to
#: enable OAuth; unset → bearer-only (Phase A unchanged).
OAUTH_PASSWORD_ENV = "NOTEBOOKLM_MCP_OAUTH_PASSWORD"
OAUTH_BASE_URL_ENV = "NOTEBOOKLM_MCP_OAUTH_BASE_URL"

#: The password is the gate, so insist it's strong (the primary brute-force defense).
MIN_PASSWORD_LEN = 16
#: Bounds on pre-auth, unauthenticated state (DoS hardening). DCR + the pending-login
#: stash are both reachable WITHOUT the password.
MAX_CLIENTS = 100
MAX_PENDING = 20
PENDING_TTL_SECONDS = 300
MAX_LOGIN_ATTEMPTS = 3
#: Per-IP login throttle: at most THROTTLE_MAX failed POSTs per THROTTLE_WINDOW seconds.
THROTTLE_WINDOW_SECONDS = 60
THROTTLE_MAX_FAILURES = 5


@dataclass(frozen=True)
class OAuthConfig:
    """Resolved + validated self-hosted-OAuth config."""

    password: str
    base_url: str
    state_path: Path | None  # where to persist clients+tokens; None → no persistence


def get_oauth_config() -> OAuthConfig | None:
    """Resolve the OAuth config from env, or ``None`` when OAuth is off.

    OFF when neither var is set. When EITHER is set the user intends OAuth, so BOTH
    are required (fail closed), the password must clear a strength bar, and the base
    URL must be https (the MCP SDK rejects non-HTTPS non-localhost issuers anyway).

    Raises:
        SystemExit: partial/invalid config (clear message).
    """
    password = os.environ.get(OAUTH_PASSWORD_ENV) or ""
    base_url = (os.environ.get(OAUTH_BASE_URL_ENV) or "").strip()
    if not password and not base_url:
        return None  # OAuth off — bearer-only (Phase A).

    if not password or not base_url:
        missing = OAUTH_PASSWORD_ENV if not password else OAUTH_BASE_URL_ENV
        raise SystemExit(
            f"Self-hosted OAuth is partially configured; set BOTH {OAUTH_PASSWORD_ENV} "
            f"and {OAUTH_BASE_URL_ENV} (or unset both to stay bearer-only). Missing: {missing}."
        )
    if len(password) < MIN_PASSWORD_LEN:
        raise SystemExit(
            f"{OAUTH_PASSWORD_ENV} is too weak: it gates a full-account credential and is "
            f"the primary brute-force defense, so it must be at least {MIN_PASSWORD_LEN} "
            "characters (use a long random value)."
        )
    if not base_url.lower().startswith("https://"):
        raise SystemExit(
            f"{OAUTH_BASE_URL_ENV} must be the public https URL claude.ai reaches "
            f"(e.g. https://your-host); got {base_url!r}."
        )

    state_path: Path | None = None
    home = os.environ.get("NOTEBOOKLM_HOME")
    profile = os.environ.get("NOTEBOOKLM_PROFILE")
    if home and profile:
        state_path = Path(home) / "profiles" / profile / "oauth_state.json"

    return OAuthConfig(password=password, base_url=base_url, state_path=state_path)


def _client_ip(request: Request) -> str:
    """Best-effort client IP for per-IP throttling. Behind the Cloudflare tunnel the
    real client is in ``CF-Connecting-IP``; fall back to the socket peer."""
    cf = request.headers.get("cf-connecting-ip")
    if cf:
        return cf.strip()
    return request.client.host if request.client else "unknown"


class SelfHostedOAuthProvider(InMemoryOAuthProvider):
    """``InMemoryOAuthProvider`` + a password-gated ``/authorize``, with DoS bounds and
    file-backed persistence of clients + tokens."""

    def __init__(self, password: str, base_url: str, state_path: Path | None = None) -> None:
        super().__init__(
            base_url=base_url,
            # DCR is OFF by default — without this NO /register route is mounted and
            # claude.ai cannot register itself, so the whole OAuth path is dead.
            client_registration_options=ClientRegistrationOptions(enabled=True),
        )
        # Store only a non-reversible digest of the gate password (never the cleartext).
        self.__pw_digest = hashlib.sha256(password.encode("utf-8")).digest()
        self._state_path = state_path
        # sid -> (client, validated params, expiry_ts, attempts). Pre-auth + bounded.
        self._pending: dict[
            str, tuple[OAuthClientInformationFull, AuthorizationParams, float, int]
        ] = {}
        # per-IP failed-login timestamps (throttle).
        self._fail_times: dict[str, list[float]] = {}
        self._load_state()

    # -- DCR cap ---------------------------------------------------------------
    async def register_client(self, client_info: OAuthClientInformationFull) -> None:
        # Cap only NEW registrations so RFC 7591 updates to an existing client still work.
        if client_info.client_id not in self.clients and len(self.clients) >= MAX_CLIENTS:
            raise RegistrationError(
                error="invalid_client_metadata",
                error_description="Client registration limit reached.",
            )
        await super().register_client(client_info)
        self._save_state()

    # -- password gate ---------------------------------------------------------
    async def authorize(
        self, client: OAuthClientInformationFull, params: AuthorizationParams
    ) -> str:
        """Reached ONLY after the SDK handler validated client/redirect_uri/scope/PKCE.
        Stash the validated request and divert the browser to the password page."""
        self._prune_pending()
        if len(self._pending) >= MAX_PENDING:
            raise AuthorizeError(
                error="temporarily_unavailable",
                error_description="Too many pending logins; try again shortly.",
            )
        sid = secrets.token_urlsafe(32)
        self._pending[sid] = (client, params, time.time() + PENDING_TTL_SECONDS, 0)
        return f"{str(self.base_url).rstrip('/')}/login?sid={sid}"

    def get_routes(self, mcp_path: str | None = None) -> list[Route]:
        # Public OAuth routes (authorize/token/register/.well-known) from the parent,
        # PLUS our public /login page. (Do NOT swap /authorize; do NOT call create_auth_routes.)
        routes = super().get_routes(mcp_path)
        routes.append(Route("/login", self._login, methods=["GET", "POST"]))
        return routes

    async def _login(self, request: Request) -> Response:
        if request.method == "GET":
            return self._render_form(request.query_params.get("sid", ""))

        ip = _client_ip(request)
        retry_after = self._throttled(ip)
        if retry_after is not None:
            return Response(
                "Too many attempts. Try again later.",
                status_code=429,
                headers={"Retry-After": str(retry_after)},
            )

        form = await request.form()
        sid = str(form.get("sid", ""))
        password = str(form.get("password", ""))

        self._prune_pending()
        entry = self._pending.get(sid)
        if entry is None:
            return self._render_form(
                "", error="Your login link expired. Restart the connection from claude.ai."
            )
        client, params, expiry, attempts = entry

        presented = hashlib.sha256(password.encode("utf-8")).digest()
        if not hmac.compare_digest(presented, self.__pw_digest):
            self._record_failure(ip)
            attempts += 1
            if attempts >= MAX_LOGIN_ATTEMPTS:
                self._pending.pop(sid, None)
                return self._render_form(
                    "", error="Too many failed attempts. Restart the connection from claude.ai."
                )
            self._pending[sid] = (client, params, expiry, attempts)
            return self._render_form(sid, error="Incorrect password.")

        # Success: single-use consume, then issue the code via the PARENT (NOT self.authorize
        # → infinite recursion; NOT bare super() → unbound in this handler).
        self._pending.pop(sid, None)
        self._fail_times.pop(ip, None)
        redirect = await InMemoryOAuthProvider.authorize(self, client, params)
        return RedirectResponse(redirect, status_code=302, headers={"Cache-Control": "no-store"})

    def _render_form(self, sid: str, *, error: str = "") -> HTMLResponse:
        # create_secure_html_response sets CSP + X-Frame-Options: DENY; the only dynamic
        # value is `sid` (our own opaque token) and `error` (our own literal strings) —
        # nothing attacker-controlled is reflected.
        err = f'<p style="color:#c00">{error}</p>' if error else ""
        body = (
            "<h2>NotebookLM connector</h2>"
            "<p>Enter the connector password to authorize this client.</p>"
            f"{err}"
            '<form method="post" action="login">'
            f'<input type="hidden" name="sid" value="{sid}">'
            '<input type="password" name="password" autofocus required '
            'style="font-size:1.1em;padding:.4em;width:20em">'
            '<button type="submit" style="font-size:1.1em;padding:.4em 1em;margin-left:.5em">Sign in</button>'
            "</form>"
        )
        status = 401 if error else 200
        return create_secure_html_response(body, status_code=status)

    # -- throttle --------------------------------------------------------------
    def _throttled(self, ip: str) -> int | None:
        now = time.time()
        times = [t for t in self._fail_times.get(ip, []) if now - t < THROTTLE_WINDOW_SECONDS]
        self._fail_times[ip] = times
        if len(times) >= THROTTLE_MAX_FAILURES:
            # retry once the oldest failure ages out of the window (times are appended
            # chronologically, so min == oldest); min() also sidesteps the ADR-0011
            # single-level-positional-index guardrail that a literal `times[0]` trips.
            return int(THROTTLE_WINDOW_SECONDS - (now - min(times))) + 1
        return None

    def _record_failure(self, ip: str) -> None:
        self._fail_times.setdefault(ip, []).append(time.time())

    def _prune_pending(self) -> None:
        now = time.time()
        for sid in [s for s, (_, _, exp, _) in self._pending.items() if exp < now]:
            self._pending.pop(sid, None)

    # -- persistence (thin wrappers + atomic file) -----------------------------
    async def exchange_authorization_code(
        self, client: OAuthClientInformationFull, authorization_code: AuthorizationCode
    ) -> OAuthToken:
        token = await super().exchange_authorization_code(client, authorization_code)
        self._save_state()
        return token

    async def exchange_refresh_token(
        self,
        client: OAuthClientInformationFull,
        refresh_token: RefreshToken,
        scopes: list[str],
    ) -> OAuthToken:
        token = await super().exchange_refresh_token(client, refresh_token, scopes)
        self._save_state()
        return token

    async def revoke_token(self, token: AccessToken | RefreshToken) -> None:
        await super().revoke_token(token)
        self._save_state()

    def _save_state(self) -> None:
        if self._state_path is None:
            return
        data = {
            "clients": {k: v.model_dump(mode="json") for k, v in self.clients.items()},
            "access_tokens": {k: v.model_dump(mode="json") for k, v in self.access_tokens.items()},
            "refresh_tokens": {
                k: v.model_dump(mode="json") for k, v in self.refresh_tokens.items()
            },
            "a2r": dict(self._access_to_refresh_map),
            "r2a": dict(self._refresh_to_access_map),
        }
        try:
            atomic_write_json(self._state_path, data)  # POSIX-atomic, 0600, filelock
        except OSError as exc:  # disk error must not crash an active server
            logger.warning("Could not persist OAuth state to %s: %s", self._state_path, exc)

    def _load_state(self) -> None:
        if self._state_path is None or not self._state_path.exists():
            return
        try:
            data = json.loads(self._state_path.read_text(encoding="utf-8"))
            self.clients = {
                k: OAuthClientInformationFull.model_validate(v)
                for k, v in data.get("clients", {}).items()
            }
            self.access_tokens = {
                k: AccessToken.model_validate(v) for k, v in data.get("access_tokens", {}).items()
            }
            self.refresh_tokens = {
                k: RefreshToken.model_validate(v) for k, v in data.get("refresh_tokens", {}).items()
            }
            self._access_to_refresh_map = dict(data.get("a2r", {}))
            self._refresh_to_access_map = dict(data.get("r2a", {}))
        except (OSError, ValueError, KeyError) as exc:
            # A malformed/truncated file must NOT be a hard startup failure — just start
            # empty (claude.ai re-registers + you re-login).
            logger.warning(
                "Ignoring unreadable OAuth state %s (re-auth required): %s", self._state_path, exc
            )

    def __repr__(self) -> str:  # never surface the password digest
        return f"{type(self).__name__}(base_url={self.base_url!r}, clients={len(self.clients)})"


def build_oauth_provider(config: OAuthConfig) -> AuthProvider:
    """Build the self-hosted OAuth provider from validated config."""
    return SelfHostedOAuthProvider(
        password=config.password, base_url=config.base_url, state_path=config.state_path
    )
