"""MCP cookie-recovery wiring.

The client runtime already knows how to call ``NOTEBOOKLM_REFRESH_CMD`` when an
RPC discovers that Google auth has expired. MCP adds one operator-friendly layer:
if no refresh command is configured, point it at this checkout's recovery script
so long-running MCP connectors can repair cookies without surfacing a raw
``notebooklm login`` error to the user.

This module is transport-neutral for MCP purposes: no click/rich/fastmcp imports.
"""

from __future__ import annotations

import asyncio
import logging
import os
import shlex
import sys
from pathlib import Path

logger = logging.getLogger(__name__)

AUTO_RECOVERY_ENV = "NOTEBOOKLM_MCP_AUTO_COOKIE_RECOVERY"
RECOVERY_SCRIPT_ENV = "NOTEBOOKLM_MCP_RECOVERY_SCRIPT"
REFRESH_CMD_ENV = "NOTEBOOKLM_REFRESH_CMD"


def _truthy(value: str | None, *, default: bool) -> bool:
    if value is None:
        return default
    return value.strip().lower() not in {"0", "false", "no", "off", "disable", "disabled"}


def _default_recovery_script() -> Path | None:
    candidates = [
        Path(__file__).resolve().parents[3] / "scripts" / "notebooklm_mcp_auth_recover.py",
        Path("/src/scripts/notebooklm_mcp_auth_recover.py"),
    ]
    for script in candidates:
        if script.exists():
            return script
    return None


def resolve_recovery_script() -> Path | None:
    """Return the configured/default recovery script path, if available."""
    raw = os.environ.get(RECOVERY_SCRIPT_ENV)
    if raw and raw.strip():
        return Path(raw).expanduser().resolve()
    return _default_recovery_script()


def build_recovery_command(*, profile: str | None = None) -> str | None:
    """Build a safe argv-string for ``NOTEBOOKLM_REFRESH_CMD``.

    The auth refresh subprocess parses this with ``shlex.split`` by default, so
    every path/argument is shell-quoted even though shell mode is not used.
    """
    script = resolve_recovery_script()
    if script is None or not script.exists():
        return None
    command = [
        sys.executable,
        str(script),
        "--json",
    ]
    if profile:
        command.extend(["--profile", profile])
    return shlex.join(command)


def configure_refresh_cmd(*, profile: str | None = None) -> bool:
    """Install the MCP recovery script as ``NOTEBOOKLM_REFRESH_CMD`` when safe.

    Returns ``True`` if this call set the env var, ``False`` when recovery is
    disabled, already configured by the operator, or the script is unavailable.
    """
    if not _truthy(os.environ.get(AUTO_RECOVERY_ENV), default=True):
        logger.info("MCP cookie auto-recovery disabled via %s", AUTO_RECOVERY_ENV)
        return False
    if os.environ.get(REFRESH_CMD_ENV):
        logger.info("Using operator-provided %s for MCP cookie recovery", REFRESH_CMD_ENV)
        return False
    command = build_recovery_command(profile=profile)
    if command is None:
        logger.info("MCP recovery script not found; %s was not configured", REFRESH_CMD_ENV)
        return False
    os.environ[REFRESH_CMD_ENV] = command
    logger.info("Configured MCP cookie recovery via %s", REFRESH_CMD_ENV)
    return True


async def run_recovery_once(*, profile: str | None = None, timeout: float = 180.0) -> bool:
    """Run the recovery script once, returning whether it exited successfully."""
    if not _truthy(os.environ.get(AUTO_RECOVERY_ENV), default=True):
        return False
    command = build_recovery_command(profile=profile)
    if command is None:
        return False
    argv = shlex.split(command)
    env = dict(os.environ)
    env.pop("NOTEBOOKLM_AUTH_JSON", None)
    logger.info("Running MCP cookie recovery script")
    try:
        process = await asyncio.create_subprocess_exec(
            *argv,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )
        stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=timeout)
    except Exception as exc:
        logger.warning("MCP cookie recovery script failed to run: %s", exc)
        return False
    if process.returncode == 0:
        logger.info("MCP cookie recovery script completed successfully")
        return True
    detail = (stderr or stdout).decode("utf-8", "replace").strip()
    logger.warning("MCP cookie recovery script exited %s: %s", process.returncode, detail[:700])
    return False


__all__ = [
    "AUTO_RECOVERY_ENV",
    "RECOVERY_SCRIPT_ENV",
    "REFRESH_CMD_ENV",
    "build_recovery_command",
    "configure_refresh_cmd",
    "resolve_recovery_script",
    "run_recovery_once",
]
