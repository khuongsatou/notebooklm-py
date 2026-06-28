"""Bearer-token auth for the remote (HTTP) MCP transport.

The stdio transport is local and unauthenticated (FastMCP skips auth for stdio).
The HTTP transport, once bound to a non-loopback interface, fronts a full-account
Google session and MUST require a bearer token — the fail-closed startup check
lives in :mod:`.__main__`, and this module supplies the verifier FastMCP runs on
every request.

Design — mirror the REST server's `server/_auth.py` posture, NOT
``fastmcp``'s ``StaticTokenVerifier``:

* ``StaticTokenVerifier``'s own source warns "Never use this in production —
  tokens are stored in plain text"; it pulls in ``authlib``/JOSE for what is a
  single string comparison; and its token dict requires a ``client_id`` key with
  no default (``{token: {}}`` raises ``KeyError`` on the first request).
* A ~25-line :class:`~fastmcp.server.auth.auth.TokenVerifier` subclass doing a
  constant-time :func:`hmac.compare_digest` on **SHA-256 digests** is the right
  tool: no extra dependency, a clean 401, and only a non-reversible digest of the
  token is retained (never the cleartext, so a ``vars()``/scope dump can't leak
  it) — honoring the #1517/#1518 redaction discipline, the way the REST server
  protects ``NOTEBOOKLM_SERVER_TOKEN``.

This module imports NO ``click`` / ``rich`` / ``cli``.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import os
from dataclasses import dataclass

from fastmcp.server.auth import AccessToken, AuthProvider, TokenVerifier

logger = logging.getLogger(__name__)

__all__ = [
    "ALLOWED_EMAILS_ENV",
    "AUTHKIT_BASE_URL_ENV",
    "AUTHKIT_CLIENT_ID_ENV",
    "AUTHKIT_DOMAIN_ENV",
    "MCP_TOKEN_ENV",
    "AuthKitConfig",
    "McpBearerAuthProvider",
    "build_auth",
    "build_auth_provider",
    "build_authkit_provider",
    "get_authkit_config",
    "get_configured_token",
]

#: Env var carrying the bearer token the HTTP transport validates every request
#: against. Env-only (never a CLI flag) so the value cannot leak via ``ps aux``.
MCP_TOKEN_ENV = "NOTEBOOKLM_MCP_TOKEN"

#: Optional WorkOS AuthKit OAuth (for claude.ai, whose connector UI is OAuth-only).
#: All four are env-only. When none are set, the server stays bearer-only (Phase A)
#: so Claude Code / Desktop are unaffected. When any are set, ALL of domain +
#: base_url + client_id + allowed-emails are required (partial config fails closed).
AUTHKIT_DOMAIN_ENV = "NOTEBOOKLM_MCP_AUTHKIT_DOMAIN"
AUTHKIT_BASE_URL_ENV = "NOTEBOOKLM_MCP_AUTHKIT_BASE_URL"
AUTHKIT_CLIENT_ID_ENV = "NOTEBOOKLM_MCP_AUTHKIT_CLIENT_ID"
ALLOWED_EMAILS_ENV = "NOTEBOOKLM_MCP_ALLOWED_EMAILS"

#: Synthetic client id stamped on a validated token. Single-tenant: there is one
#: token and one logical client, so this is a constant, not a lookup.
_CLIENT_ID = "notebooklm-mcp"


def get_configured_token() -> str | None:
    """Return the configured MCP bearer token, or ``None`` when unset/empty.

    Read live from the environment. An empty / whitespace-only value is treated
    as *unset* (fail closed) — same semantics as the REST server's token.
    """
    token = os.environ.get(MCP_TOKEN_ENV)
    if token is None:
        return None
    token = token.strip()
    return token or None


class McpBearerAuthProvider(TokenVerifier):
    """Gate the HTTP transport on a single bearer token (constant-time compare).

    FastMCP runs :meth:`verify_token` for every request via its
    ``RequireAuthMiddleware``; a ``None`` return is a 401. The instance holds only
    the **SHA-256 digest** of the configured token, never the cleartext — so
    ``vars(provider)`` / a scope dump cannot surface it — and verification hashes
    the presented token and compares digests in constant time.
    """

    def __init__(self, token: str) -> None:
        super().__init__()
        # Store only a digest of the configured token (its raw UTF-8 bytes hashed).
        # The digest is non-reversible and cannot be replayed as a token (verify
        # hashes the *presented* value), so no cleartext copy is retained anywhere.
        self.__digest = hashlib.sha256(token.encode("utf-8")).digest()

    async def verify_token(self, token: str) -> AccessToken | None:
        # Starlette latin-1-decodes the Authorization header, so ``token`` here is
        # the latin-1 view of the raw request bytes. ``.encode("latin-1")`` round-
        # trips that back to the EXACT bytes the client sent, which we hash and
        # compare against the configured token's UTF-8-byte digest — so an ASCII
        # token and a UTF-8-encoded non-ASCII token both verify correctly. A header
        # string outside latin-1 (cannot come from Starlette) simply fails to match.
        try:
            presented = token.encode("latin-1")
        except UnicodeEncodeError:
            return None
        if hmac.compare_digest(hashlib.sha256(presented).digest(), self.__digest):
            # Do NOT echo the live token into the AccessToken: FastMCP stores it on
            # the request scope (scope["user"]) and AccessToken's pydantic repr
            # would expose it in any scope/log dump. We never read the field, so
            # stamp an opaque constant instead.
            return AccessToken(token=_CLIENT_ID, client_id=_CLIENT_ID, scopes=[])
        return None

    def __repr__(self) -> str:  # never surface auth material
        return f"{type(self).__name__}(token=<redacted>)"


def build_auth_provider(token: str | None) -> McpBearerAuthProvider | None:
    """Return a provider for a non-empty ``token``, else ``None`` (no auth).

    The caller (``__main__`` on the http path) resolves the token and, when the
    bind is network-reachable, refuses to start without one; this helper only
    maps token→provider so ``create_server`` stays env-free.
    """
    return McpBearerAuthProvider(token) if token else None


# ---------------------------------------------------------------------------
# Optional WorkOS AuthKit OAuth (for claude.ai). Strictly additive: only active
# when configured; otherwise the bearer path above is unchanged.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class AuthKitConfig:
    """Resolved, validated WorkOS AuthKit config (all fields required when OAuth
    is on). ``allowed_emails`` is the case-folded set the identity allowlist
    admits."""

    domain: str
    base_url: str
    client_id: str
    allowed_emails: frozenset[str]


def _split_emails(raw: str) -> frozenset[str]:
    return frozenset(e.strip().casefold() for e in raw.split(",") if e.strip())


def get_authkit_config() -> AuthKitConfig | None:
    """Resolve the AuthKit config from env, or ``None`` when OAuth is off.

    OFF when none of the AuthKit env vars are set. When ANY is set the user
    intends OAuth, so ALL of domain + base_url + client_id + allowed-emails are
    required and a missing one raises (fail closed):

    * ``client_id`` missing → AuthKit's ``JWTVerifier`` would skip ``audience``
      validation → cross-project token replay. Mandatory.
    * allowed-emails missing → an OAuth endpoint to a full-account credential with
      no allowlist is world-open. Mandatory.

    Raises:
        SystemExit: partial/invalid config (names the offending env var).
    """
    domain = (os.environ.get(AUTHKIT_DOMAIN_ENV) or "").strip()
    base_url = (os.environ.get(AUTHKIT_BASE_URL_ENV) or "").strip()
    client_id = (os.environ.get(AUTHKIT_CLIENT_ID_ENV) or "").strip()
    allowed = _split_emails(os.environ.get(ALLOWED_EMAILS_ENV) or "")

    if not (domain or base_url or client_id or allowed):
        return None  # OAuth off — bearer-only (Phase A).

    missing = [
        name
        for name, val in (
            (AUTHKIT_DOMAIN_ENV, domain),
            (AUTHKIT_BASE_URL_ENV, base_url),
            (AUTHKIT_CLIENT_ID_ENV, client_id),
            (ALLOWED_EMAILS_ENV, allowed),
        )
        if not val
    ]
    if missing:
        raise SystemExit(
            "WorkOS AuthKit OAuth is partially configured; set ALL of "
            f"{', '.join(sorted(missing))} (or unset every AuthKit var to stay "
            "bearer-only). client_id is mandatory (audience validation / replay "
            "defense); allowed-emails is mandatory (the identity allowlist)."
        )
    return AuthKitConfig(
        domain=domain, base_url=base_url, client_id=client_id, allowed_emails=allowed
    )


class _EmailAllowlistVerifier(TokenVerifier):
    """Wrap an OAuth token verifier and admit only allowlisted, verified emails.

    Delegates verification to ``inner`` (AuthKit's local ``JWTVerifier`` — never a
    userinfo verifier, which would leak the bearer to WorkOS), then gates on the
    token's ``email`` claim. A non-match returns ``None`` (→ 401; a ``TokenVerifier``
    cannot signal 403, and 401 is the better choice — it does not reveal that
    WorkOS auth succeeded). The bearer path is NOT wrapped (its ``AccessToken`` has
    no email claim), so Claude Code is unaffected.
    """

    def __init__(self, inner: TokenVerifier, allowed_emails: frozenset[str]) -> None:
        super().__init__()
        self._inner = inner
        self._allowed = allowed_emails

    async def verify_token(self, token: str) -> AccessToken | None:
        result = await self._inner.verify_token(token)
        if result is None:
            return None
        claims = result.claims or {}
        email = claims.get("email")
        if not isinstance(email, str) or not email.strip():
            # The WorkOS access-token JWT carried no email claim — almost always a
            # missing JWT-template mapping. Reject loudly (never coerce to "").
            logger.warning(
                "OAuth token has no 'email' claim; rejecting. Configure the WorkOS "
                "access-token JWT template to include email + email_verified (see "
                "the remote-deployment docs)."
            )
            return None
        if claims.get("email_verified") is not True:
            logger.warning("OAuth token email is not verified; rejecting.")
            return None
        if email.strip().casefold() not in self._allowed:
            logger.warning("OAuth email not in NOTEBOOKLM_MCP_ALLOWED_EMAILS; rejecting.")
            return None
        return result

    def __repr__(self) -> str:
        return f"{type(self).__name__}(inner={type(self._inner).__name__})"


def build_authkit_provider(config: AuthKitConfig) -> AuthProvider:
    """Build a WorkOS ``AuthKitProvider`` whose token verifier is wrapped in the
    email allowlist.

    Let AuthKit build its own default ``JWTVerifier`` (correct jwks_uri / issuer /
    audience=client_id) and reassign ``token_verifier`` to the allowlist wrapper —
    ``RemoteAuthProvider.verify_token`` resolves ``self.token_verifier`` at call
    time, so this takes effect without duplicating the construction.
    """
    # Lazy import: AuthKitProvider pulls authlib/JWTVerifier (a deprecation warning
    # on import); keep it off the stdio / bearer-only path.
    from fastmcp.server.auth.providers.workos import AuthKitProvider

    provider = AuthKitProvider(
        authkit_domain=config.domain.rstrip("/"),  # avoid //oauth2/jwks (404)
        base_url=config.base_url,
        client_id=config.client_id,
        required_scopes=["openid"],  # NOT "email": that gates the scope STRING, not the claim
    )
    provider.token_verifier = _EmailAllowlistVerifier(
        provider.token_verifier, config.allowed_emails
    )
    return provider


def build_auth(token: str | None, authkit: AuthProvider | None) -> AuthProvider | None:
    """Compose the active auth provider for ``create_server(auth=...)``.

    * bearer + authkit → ``MultiAuth`` (claude.ai uses OAuth, Claude Code the
      bearer; the bearer is a verifier so a non-JWT bearer falls through locally).
    * one of them → that one. * neither → ``None`` (loopback dev).
    """
    bearer = McpBearerAuthProvider(token) if token else None
    if authkit and bearer:
        from fastmcp.server.auth import MultiAuth

        return MultiAuth(server=authkit, verifiers=[bearer])
    return authkit or bearer
