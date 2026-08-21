"""Password-backed browser sessions for the production dashboard."""

from __future__ import annotations

import hmac
import os

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel

from .._auth import (
    DASHBOARD_SESSION_COOKIE,
    DASHBOARD_SESSION_TTL_SECONDS,
    create_dashboard_session,
    dashboard_session_is_valid,
    get_dashboard_password,
    require_loopback_host,
)

router = APIRouter(prefix="/auth", dependencies=[Depends(require_loopback_host)])


class DashboardLoginRequest(BaseModel):
    password: str


def _secure_cookie() -> bool:
    return os.environ.get("NOTEBOOKLM_DEPLOY_ENV", "development").lower() == "production"


def _set_session_cookie(response: Response) -> None:
    """Write a durable dashboard checkpoint with a rolling expiry."""
    response.set_cookie(
        key=DASHBOARD_SESSION_COOKIE,
        value=create_dashboard_session(),
        max_age=DASHBOARD_SESSION_TTL_SECONDS,
        httponly=True,
        secure=_secure_cookie(),
        samesite="strict",
        path="/",
    )


@router.get("/session")
async def session(request: Request, response: Response) -> dict[str, bool]:
    """Validate and refresh the browser's durable dashboard checkpoint."""
    authenticated = dashboard_session_is_valid(request.cookies.get(DASHBOARD_SESSION_COOKIE))
    if authenticated:
        _set_session_cookie(response)
    return {"authenticated": authenticated}


@router.post("/login")
async def login(payload: DashboardLoginRequest, response: Response) -> dict[str, bool]:
    """Exchange the configured dashboard password for an HttpOnly session."""
    configured = get_dashboard_password()
    if configured is None:
        raise HTTPException(status_code=503, detail="Dashboard login is not configured")
    if not hmac.compare_digest(payload.password, configured):
        raise HTTPException(status_code=401, detail="Invalid dashboard password")
    _set_session_cookie(response)
    return {"ok": True, "authenticated": True}


@router.post("/logout")
async def logout(response: Response) -> dict[str, bool]:
    """Clear the dashboard session cookie."""
    response.delete_cookie(
        DASHBOARD_SESSION_COOKIE,
        path="/",
        secure=_secure_cookie(),
        httponly=True,
        samesite="strict",
    )
    return {"ok": True, "authenticated": False}
