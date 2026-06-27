"""CLI tests for `notebooklm login --master-token[-refresh]` (service mocked)."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

from click.testing import CliRunner

import notebooklm.cli.services.login.master_token as mt_service
from notebooklm.notebooklm_cli import cli


def test_master_token_refresh_calls_service(tmp_path, monkeypatch):
    monkeypatch.setenv("NOTEBOOKLM_HOME", str(tmp_path))
    with patch.object(mt_service, "refresh", new=AsyncMock()) as ref:
        result = CliRunner().invoke(cli, ["login", "--master-token-refresh"])
    assert result.exit_code == 0, result.output
    assert ref.called
    assert "Re-minted" in result.output


def test_master_token_requires_account(tmp_path, monkeypatch):
    monkeypatch.setenv("NOTEBOOKLM_HOME", str(tmp_path))
    result = CliRunner().invoke(cli, ["login", "--master-token"])
    assert result.exit_code == 1
    assert "--account" in result.output


def test_master_token_bootstrap_calls_service(tmp_path, monkeypatch):
    monkeypatch.setenv("NOTEBOOKLM_HOME", str(tmp_path))
    with patch.object(mt_service, "bootstrap", new=AsyncMock(return_value=7)) as boot:
        result = CliRunner().invoke(
            cli,
            ["login", "--master-token", "--account", "e@x.com", "--oauth-token", "TOK"],
        )
    assert result.exit_code == 0, result.output
    assert boot.called
    assert boot.call_args.kwargs["oauth_token"] == "TOK"
    assert "7 notebooks" in result.output


def test_master_token_bootstrap_browser_capture_when_no_oauth(tmp_path, monkeypatch):
    monkeypatch.setenv("NOTEBOOKLM_HOME", str(tmp_path))
    with (
        patch.object(mt_service, "capture_oauth_token", return_value="CAPTOK") as cap,
        patch.object(mt_service, "bootstrap", new=AsyncMock(return_value=3)) as boot,
    ):
        result = CliRunner().invoke(cli, ["login", "--master-token", "--account", "e@x.com"])
    assert result.exit_code == 0, result.output
    assert cap.called
    assert boot.call_args.kwargs["oauth_token"] == "CAPTOK"
