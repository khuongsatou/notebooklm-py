"""Tests for the optional WorkOS AuthKit OAuth path (``notebooklm.mcp._auth``).

Covers config resolution (off / partial-fail-closed / full), the email-allowlist
verifier (accept + every reject path), the ``build_authkit_provider`` wrap, the
``build_auth`` composition (bearer | authkit | MultiAuth | None), and that OAuth
discovery routes are served when OAuth is on. No network: the AuthKit provider is
built (JWKS is fetched lazily at verify time, not construction) and the allowlist
verifier is driven with a stub inner verifier.
"""

from __future__ import annotations

import pytest

pytest.importorskip("fastmcp")

from fastmcp.server.auth import AccessToken, MultiAuth, TokenVerifier  # noqa: E402

from notebooklm.mcp._auth import (  # noqa: E402
    ALLOWED_EMAILS_ENV,
    AUTHKIT_BASE_URL_ENV,
    AUTHKIT_CLIENT_ID_ENV,
    AUTHKIT_DOMAIN_ENV,
    AuthKitConfig,
    McpBearerAuthProvider,
    _EmailAllowlistVerifier,
    build_auth,
    build_authkit_provider,
    get_authkit_config,
)

_AUTHKIT_ENVS = (
    AUTHKIT_DOMAIN_ENV,
    AUTHKIT_BASE_URL_ENV,
    AUTHKIT_CLIENT_ID_ENV,
    ALLOWED_EMAILS_ENV,
)


@pytest.fixture
def _clear_authkit_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for k in _AUTHKIT_ENVS:
        monkeypatch.delenv(k, raising=False)


class _StubVerifier(TokenVerifier):
    """Inner verifier stand-in: returns a token with the given claims for any
    input, or None when ``claims is None``."""

    def __init__(self, claims: dict | None) -> None:
        super().__init__()
        self._claims = claims

    async def verify_token(self, token: str) -> AccessToken | None:
        if self._claims is None:
            return None
        return AccessToken(token="t", client_id="c", scopes=[], claims=self._claims)


# ---------------------------------------------------------------------------
# get_authkit_config
# ---------------------------------------------------------------------------


def test_config_off_when_unset(_clear_authkit_env: None) -> None:
    assert get_authkit_config() is None


@pytest.mark.parametrize("present", list(_AUTHKIT_ENVS))
def test_partial_config_fails_closed(
    _clear_authkit_env: None, monkeypatch: pytest.MonkeyPatch, present: str
) -> None:
    monkeypatch.setenv(present, "x@y.com" if present == ALLOWED_EMAILS_ENV else "val")
    with pytest.raises(SystemExit):
        get_authkit_config()


def test_full_config_casefolds_emails(
    _clear_authkit_env: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv(AUTHKIT_DOMAIN_ENV, "https://x.authkit.app")
    monkeypatch.setenv(AUTHKIT_BASE_URL_ENV, "https://host")
    monkeypatch.setenv(AUTHKIT_CLIENT_ID_ENV, "client_abc")
    monkeypatch.setenv(ALLOWED_EMAILS_ENV, " You@Example.com , other@x.com ")
    cfg = get_authkit_config()
    assert cfg is not None
    assert cfg.client_id == "client_abc"
    assert cfg.allowed_emails == frozenset({"you@example.com", "other@x.com"})


# ---------------------------------------------------------------------------
# _EmailAllowlistVerifier
# ---------------------------------------------------------------------------


@pytest.fixture
def _allow() -> frozenset[str]:
    return frozenset({"you@example.com"})


@pytest.mark.asyncio
@pytest.mark.parametrize("verified", [True, "true", "True", " TRUE "])
async def test_allowlist_accepts_verified_listed_email(
    _allow: frozenset[str], verified: object
) -> None:
    # email_verified may be a JSON boolean OR a string (WorkOS JWT templates render
    # variables as strings); both forms are accepted. Email match is case-insensitive.
    inner = _StubVerifier({"email": "You@Example.com", "email_verified": verified})
    v = _EmailAllowlistVerifier(inner, _allow)
    assert await v.verify_token("tok") is not None


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "claims",
    [
        {"email": "nope@x.com", "email_verified": True},  # not on allowlist
        {"email": "you@example.com", "email_verified": False},  # unverified (bool)
        {"email": "you@example.com", "email_verified": "false"},  # unverified (string)
        {"email": "you@example.com", "email_verified": 1},  # truthy non-bool → reject
        {"email": "you@example.com"},  # missing email_verified
        {"email_verified": True},  # missing email claim (JWT template not set)
        {"email": "   ", "email_verified": True},  # blank email
    ],
)
async def test_allowlist_rejects(_allow: frozenset[str], claims: dict) -> None:
    v = _EmailAllowlistVerifier(_StubVerifier(claims), _allow)
    assert await v.verify_token("tok") is None


@pytest.mark.asyncio
async def test_allowlist_passes_through_inner_none(_allow: frozenset[str]) -> None:
    v = _EmailAllowlistVerifier(_StubVerifier(None), _allow)
    assert await v.verify_token("tok") is None


def test_allowlist_repr_hides_nothing_sensitive(_allow: frozenset[str]) -> None:
    v = _EmailAllowlistVerifier(_StubVerifier({}), _allow)
    assert "you@example.com" not in repr(v)


# ---------------------------------------------------------------------------
# build_authkit_provider + build_auth composition
# ---------------------------------------------------------------------------


def _cfg() -> AuthKitConfig:
    return AuthKitConfig(
        domain="https://x.authkit.app/",  # trailing slash → must be stripped
        base_url="https://host",
        client_id="client_abc",
        allowed_emails=frozenset({"you@example.com"}),
    )


def test_build_authkit_wraps_token_verifier_in_allowlist() -> None:
    provider = build_authkit_provider(_cfg())
    # The default JWTVerifier was replaced by our allowlist wrapper (the wrap takes
    # effect because RemoteAuthProvider delegates to self.token_verifier at runtime).
    assert isinstance(provider.token_verifier, _EmailAllowlistVerifier)


@pytest.mark.asyncio
async def test_provider_verify_routes_through_allowlist_at_runtime() -> None:
    """Option-B guard: ``provider.verify_token`` must actually delegate to the
    allowlist wrapper at call time (not a verifier captured at construction). If a
    future fastmcp cached the original verifier, the allowlist would be silently
    bypassed while ``test_build_authkit_wraps_...`` still passed — this catches that.
    Drive the provider end-to-end with a stubbed inner and confirm the gate fires.
    """
    provider = build_authkit_provider(_cfg())
    wrapper = provider.token_verifier
    assert isinstance(wrapper, _EmailAllowlistVerifier)
    wrapper._inner = _StubVerifier({"email": "evil@x.com", "email_verified": True})
    assert await provider.verify_token("x") is None  # not allowlisted → rejected via wrapper
    wrapper._inner = _StubVerifier({"email": "you@example.com", "email_verified": True})
    assert await provider.verify_token("x") is not None  # allowlisted → admitted


def test_build_authkit_serves_oauth_discovery_routes() -> None:
    provider = build_authkit_provider(_cfg())
    paths = {getattr(r, "path", "") for r in provider.get_routes()}
    assert any(".well-known/oauth-protected-resource" in p for p in paths)


def test_protected_resource_metadata_advertises_scopes() -> None:
    """The wrapper's own scopes_supported is [] (it forwards no required_scopes);
    the provider must advertise the explicit scopes so a strict client requests
    `email` — else it could omit it and the access token lacks the email claim."""
    from starlette.applications import Starlette
    from starlette.testclient import TestClient

    provider = build_authkit_provider(_cfg())
    # No scope is ENFORCED (the email allowlist is the gate, not OAuth scopes).
    assert provider.token_verifier._inner.required_scopes == []
    app = Starlette(routes=provider.get_routes())
    with TestClient(app) as client:
        meta = client.get("/.well-known/oauth-protected-resource").json()
    assert "email" in meta["scopes_supported"]


def test_build_auth_matrix() -> None:
    authkit = build_authkit_provider(_cfg())
    # bearer + authkit → MultiAuth (claude.ai OAuth + Claude Code bearer)
    both = build_auth("tok", authkit)
    assert isinstance(both, MultiAuth)
    # oauth only
    assert build_auth(None, authkit) is authkit
    # bearer only
    assert isinstance(build_auth("tok", None), McpBearerAuthProvider)
    # neither
    assert build_auth(None, None) is None
