"""Settings routes for desktop-safe local configuration."""

from __future__ import annotations

from importlib.metadata import PackageNotFoundError, version
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..._app.language import (
    SUPPORTED_LANGUAGES,
    LanguageConfigStore,
    is_supported_language,
    language_name,
)
from ...io import atomic_update_json
from ...paths import get_config_path, get_home_dir

__all__ = ["router"]

router = APIRouter(prefix="/settings", tags=["settings"])
SERVER_NAME = "notebooklm-server"


class LanguageUpdate(BaseModel):
    """Request body for setting output language."""

    code: str


def _package_version() -> str:
    try:
        return version("notebooklm-py")
    except PackageNotFoundError:
        return "0.0.0"


def _language_store() -> LanguageConfigStore:
    return LanguageConfigStore(
        config_path=get_config_path,
        ensure_home=get_home_dir,
        atomic_update=atomic_update_json,
    )


@router.get("")
async def get_settings() -> dict[str, Any]:
    """Return local desktop-safe settings state."""
    code = _language_store().get_language()
    return {
        "server": SERVER_NAME,
        "version": _package_version(),
        "language": code,
        "language_name": language_name(code) if code else None,
        "languages": SUPPORTED_LANGUAGES,
    }


@router.patch("/language")
async def set_language(body: LanguageUpdate) -> dict[str, Any]:
    """Persist the output language setting."""
    if not is_supported_language(body.code):
        expected = ", ".join(sorted(SUPPORTED_LANGUAGES)[:12])
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported language code {body.code!r}; examples: {expected}",
        )
    _language_store().set_language(body.code)
    return {"language": body.code, "language_name": language_name(body.code)}


@router.get("/update")
async def check_update() -> dict[str, Any]:
    """Return local update status.

    This route deliberately avoids network access or auto-update side effects.
    The desktop app can still expose a real button with a clear local result.
    """
    current = _package_version()
    return {
        "current_version": current,
        "latest_version": current,
        "update_available": False,
        "channel": "local",
        "message": "Local build is running; no remote update feed is configured.",
    }
