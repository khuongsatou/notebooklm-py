"""Unit tests for MCP cookie-recovery wiring."""

from __future__ import annotations

import os
import shlex

from notebooklm.mcp import _recovery


def test_configure_refresh_cmd_sets_default_script(monkeypatch) -> None:
    monkeypatch.delenv(_recovery.REFRESH_CMD_ENV, raising=False)
    monkeypatch.delenv(_recovery.AUTO_RECOVERY_ENV, raising=False)
    monkeypatch.delenv(_recovery.RECOVERY_SCRIPT_ENV, raising=False)

    configured = _recovery.configure_refresh_cmd(profile="work")

    assert configured is True
    argv = shlex.split(os.environ[_recovery.REFRESH_CMD_ENV])
    assert argv[0]
    assert argv[1].endswith("notebooklm_mcp_auth_recover.py")
    assert "--json" in argv
    assert argv[-2:] == ["--profile", "work"]


def test_configure_refresh_cmd_respects_existing_operator_command(monkeypatch) -> None:
    monkeypatch.setenv(_recovery.REFRESH_CMD_ENV, "custom-refresh")

    configured = _recovery.configure_refresh_cmd(profile="work")

    assert configured is False
    assert os.environ[_recovery.REFRESH_CMD_ENV] == "custom-refresh"


def test_configure_refresh_cmd_can_be_disabled(monkeypatch) -> None:
    monkeypatch.delenv(_recovery.REFRESH_CMD_ENV, raising=False)
    monkeypatch.setenv(_recovery.AUTO_RECOVERY_ENV, "0")

    configured = _recovery.configure_refresh_cmd(profile="work")

    assert configured is False
    assert _recovery.REFRESH_CMD_ENV not in os.environ
