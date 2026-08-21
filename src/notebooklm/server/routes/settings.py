"""Settings routes for desktop-safe local configuration."""

from __future__ import annotations

import asyncio
import os
import subprocess
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
from ..._logging import scrub_secrets
from ...io import atomic_update_json
from ...paths import get_config_path, get_home_dir

__all__ = ["router"]

router = APIRouter(prefix="/settings", tags=["settings"])
SERVER_NAME = "notebooklm-server"
LOGIN_COMMAND = ("notebooklm", "login")
LOGIN_TIMEOUT_SECONDS = 330
LOGIN_OUTPUT_LIMIT = 12_000


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


def _clip_output(value: str) -> str:
    scrubbed = scrub_secrets(value or "")
    if len(scrubbed) <= LOGIN_OUTPUT_LIMIT:
        return scrubbed
    return scrubbed[:LOGIN_OUTPUT_LIMIT] + "\n...[output truncated]"


def _run_login_command() -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env.pop("NOTEBOOKLM_AUTH_JSON", None)
    return subprocess.run(
        LOGIN_COMMAND,
        check=False,
        capture_output=True,
        env=env,
        text=True,
        timeout=LOGIN_TIMEOUT_SECONDS,
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


@router.post("/login")
async def run_login() -> dict[str, Any]:
    """Run ``notebooklm login`` in the server environment.

    This is a single-tenant operator action for the hosted web UI. The command is
    bounded so a browser-login prompt cannot hold the HTTP worker forever.
    """
    try:
        result = await asyncio.to_thread(_run_login_command)
    except subprocess.TimeoutExpired as exc:
        stdout = (
            exc.stdout.decode("utf-8", "replace") if isinstance(exc.stdout, bytes) else exc.stdout
        )
        stderr = (
            exc.stderr.decode("utf-8", "replace") if isinstance(exc.stderr, bytes) else exc.stderr
        )
        return {
            "ok": False,
            "status": "timeout",
            "command": " ".join(LOGIN_COMMAND),
            "returncode": None,
            "timed_out": True,
            "timeout_seconds": LOGIN_TIMEOUT_SECONDS,
            "stdout": _clip_output(stdout or ""),
            "stderr": _clip_output(stderr or ""),
        }
    except OSError as exc:
        return {
            "ok": False,
            "status": "failed_to_start",
            "command": " ".join(LOGIN_COMMAND),
            "returncode": None,
            "timed_out": False,
            "stdout": "",
            "stderr": _clip_output(str(exc)),
        }

    return {
        "ok": result.returncode == 0,
        "status": "ok" if result.returncode == 0 else "failed",
        "command": " ".join(LOGIN_COMMAND),
        "returncode": result.returncode,
        "timed_out": False,
        "timeout_seconds": LOGIN_TIMEOUT_SECONDS,
        "stdout": _clip_output(result.stdout),
        "stderr": _clip_output(result.stderr),
    }
