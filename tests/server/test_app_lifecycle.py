"""U1: app scaffold, lifespan, healthz, and the disabled schema surface."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import pytest
from fastapi.testclient import TestClient

from notebooklm.server import app as app_module
from notebooklm.server.app import create_app

from .conftest import TEST_TOKEN
from .fakes import FakeClient


def test_healthz_is_public_and_minimal() -> None:
    """GET /healthz (outside /v1, no token) returns exactly {"ok": true}."""
    app = create_app(client_factory=_factory(FakeClient()))
    with TestClient(app) as client:
        resp = client.get("/healthz")
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}


def test_lifespan_opens_exactly_one_client_and_closes_it() -> None:
    """The lifespan opens the client once on startup and closes it on shutdown."""
    fake = FakeClient()
    opens = 0
    closed = False

    @asynccontextmanager
    async def factory() -> AsyncIterator[FakeClient]:
        nonlocal opens, closed
        opens += 1
        try:
            yield fake
        finally:
            closed = True

    app = create_app(client_factory=factory)
    with TestClient(app) as client:
        assert client.get("/healthz").status_code == 200
        assert opens == 1
        assert closed is False
    # Context exit shuts the lifespan down.
    assert opens == 1
    assert closed is True


def test_docs_and_openapi_are_disabled() -> None:
    """The unauthenticated schema UI is off (no tokenless surface)."""
    app = create_app(client_factory=_factory(FakeClient()))
    with TestClient(app) as client:
        assert client.get("/docs").status_code == 404
        assert client.get("/redoc").status_code == 404
        assert client.get("/openapi.json").status_code == 404


def test_expired_startup_auth_keeps_sync_recovery_routes_alive(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FailingManager:
        async def __aenter__(self):
            raise ValueError("Authentication expired")

        async def __aexit__(self, *_args):
            return None

    monkeypatch.setattr(app_module, "_default_factory", lambda: FailingManager())
    app = create_app()
    headers = {"Authorization": f"Bearer {TEST_TOKEN}", "Host": "127.0.0.1"}

    with TestClient(app, raise_server_exceptions=False) as client:
        assert client.get("/healthz").status_code == 200
        challenge = client.get("/sync/challenge", headers=headers)
        notebooks = client.get("/v1/notebooks", headers=headers)

    assert challenge.status_code == 200
    assert challenge.json()["ok"] is True
    assert notebooks.status_code == 401
    assert notebooks.json()["error"]["category"] == "auth"


def _factory(client: FakeClient):  # type: ignore[no-untyped-def]
    @asynccontextmanager
    async def factory() -> AsyncIterator[FakeClient]:
        yield client

    return factory
