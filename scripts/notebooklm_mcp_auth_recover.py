#!/usr/bin/env python3
"""Recover NotebookLM auth for MCP/long-running processes.

This helper is designed for two use cases:

* run manually when MCP reports ``notebooklm login`` / unauthenticated; and
* wire into ``NOTEBOOKLM_REFRESH_CMD`` so the client can re-extract cookies when
  an in-process refresh is no longer enough.

It never prints cookie values. It exits 0 only after ``auth check --test
--passive`` proves the stored cookies can fetch NotebookLM tokens.
"""

from __future__ import annotations

import argparse
import json
import os
import shlex
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

DEFAULT_BROWSER_COOKIES = "chrome::Profile 185"
NEEDS_LOGIN_EXIT = 10
REMOTE_SYNC_TOKEN_ENVS = ("NOTEBOOKLM_COOKIE_SYNC_TOKEN", "NOTEBOOKLM_SERVER_TOKEN")


@dataclass
class Step:
    name: str
    command: list[str]
    returncode: int
    ok: bool
    detail: str | None = None


@dataclass
class Report:
    status: str
    profile: str | None
    storage: str | None
    steps: list[Step] = field(default_factory=list)
    command: str | None = None
    message: str | None = None


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Check and recover NotebookLM cookies for MCP. Intended for manual "
            "repair or NOTEBOOKLM_REFRESH_CMD."
        )
    )
    parser.add_argument(
        "--profile",
        default=os.environ.get("NOTEBOOKLM_REFRESH_PROFILE")
        or os.environ.get("NOTEBOOKLM_PROFILE"),
        help="NotebookLM profile to repair (defaults to refresh/profile env).",
    )
    parser.add_argument(
        "--storage",
        default=os.environ.get("NOTEBOOKLM_REFRESH_STORAGE_PATH"),
        help="storage_state.json to repair (defaults to refresh env or profile path).",
    )
    parser.add_argument(
        "--browser-cookies",
        default=os.environ.get("NOTEBOOKLM_BROWSER_COOKIES", DEFAULT_BROWSER_COOKIES),
        help=(
            "Browser cookie selector for the hard recovery path. Default: "
            f"{DEFAULT_BROWSER_COOKIES!r}."
        ),
    )
    parser.add_argument(
        "--account",
        default=os.environ.get("NOTEBOOKLM_ACCOUNT"),
        help="Optional Google account email for login --browser-cookies.",
    )
    parser.add_argument(
        "--include-domains",
        action="append",
        default=[],
        help="Forwarded to login/auth refresh browser-cookie extraction. Repeatable.",
    )
    parser.add_argument(
        "--skip-browser-cookies",
        action="store_true",
        help="Only try the local keepalive refresh; do not read Chrome cookies.",
    )
    parser.add_argument(
        "--interactive-login",
        action="store_true",
        help="Run notebooklm login if browser-cookie recovery cannot prove auth.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Emit a machine-readable recovery report.",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Include command stderr/stdout snippets in text mode.",
    )
    parser.add_argument(
        "--remote-sync",
        choices=("auto", "always", "never"),
        default=os.environ.get("NOTEBOOKLM_MCP_REMOTE_COOKIE_SYNC", "auto"),
        help=(
            "Run notebooklm_mcp_remote_cookie_sync.py after local recovery. "
            "auto runs only when a sync token is configured."
        ),
    )
    return parser.parse_args(argv)


def _notebooklm_base(args: argparse.Namespace) -> list[str]:
    raw = os.environ.get("NOTEBOOKLM_CLI")
    base = shlex.split(raw) if raw else [sys.executable, "-m", "notebooklm"]
    if args.profile:
        base.extend(["--profile", args.profile])
    if args.storage:
        base.extend(["--storage", args.storage])
    return base


def _login_base(args: argparse.Namespace) -> list[str]:
    raw = os.environ.get("NOTEBOOKLM_CLI")
    base = shlex.split(raw) if raw else [sys.executable, "-m", "notebooklm"]
    if args.profile:
        base.extend(["--profile", args.profile])
    return base


def _storage_exists(args: argparse.Namespace) -> bool:
    if args.storage:
        return Path(args.storage).expanduser().exists()
    profile = args.profile or "default"
    home = Path(os.environ.get("NOTEBOOKLM_HOME", "~/.notebooklm")).expanduser()
    return (home / "profiles" / profile / "storage_state.json").exists()


def _run(command: list[str], *, interactive: bool = False) -> subprocess.CompletedProcess[str]:
    env = dict(os.environ)
    # Avoid handing inline auth JSON to a child that must rewrite storage_state.json.
    env.pop("NOTEBOOKLM_AUTH_JSON", None)
    if interactive:
        return subprocess.run(command, text=True, env=env, check=False)
    return subprocess.run(command, text=True, env=env, capture_output=True, check=False)


def _summarize_output(result: subprocess.CompletedProcess[str]) -> str | None:
    text = "\n".join(
        part.strip() for part in (result.stdout, result.stderr) if part and part.strip()
    )
    if not text:
        return None
    text = " ".join(text.split())
    return text[:700]


def _auth_check(args: argparse.Namespace, report: Report, name: str) -> dict[str, Any] | None:
    command = _notebooklm_base(args) + ["auth", "check", "--test", "--passive", "--json"]
    result = _run(command)
    parsed: dict[str, Any] | None = None
    if result.stdout:
        try:
            loaded = json.loads(result.stdout)
            parsed = loaded if isinstance(loaded, dict) else None
        except json.JSONDecodeError:
            parsed = None
    ok = result.returncode == 0 and parsed is not None and parsed.get("status") == "ok"
    checks = parsed.get("checks", {}) if parsed else {}
    ok = ok and checks.get("token_fetch") is True
    report.steps.append(
        Step(
            name=name,
            command=command,
            returncode=result.returncode,
            ok=ok,
            detail=_summarize_output(result),
        )
    )
    return parsed if ok else None


def _run_repair_step(
    report: Report, name: str, command: list[str], *, interactive: bool = False
) -> bool:
    result = _run(command, interactive=interactive)
    ok = result.returncode == 0
    report.steps.append(
        Step(
            name=name,
            command=command,
            returncode=result.returncode,
            ok=ok,
            detail=None if interactive else _summarize_output(result),
        )
    )
    return ok


def _include_domain_flags(args: argparse.Namespace) -> list[str]:
    flags: list[str] = []
    for value in args.include_domains:
        flags.extend(["--include-domains", value])
    return flags


def _keepalive_command(args: argparse.Namespace) -> list[str]:
    if not args.storage:
        return _notebooklm_base(args) + ["auth", "refresh", "--verify", "--quiet"]
    return [
        sys.executable,
        "-c",
        (
            "import asyncio, sys; "
            "from pathlib import Path; "
            "from notebooklm.auth import fetch_tokens_with_domains; "
            "profile = sys.argv[2] or None; "
            "asyncio.run(fetch_tokens_with_domains(Path(sys.argv[1]), profile))"
        ),
        args.storage,
        args.profile or "",
    ]


def _browser_cookie_repair(args: argparse.Namespace, report: Report) -> bool:
    command = (
        _login_base(args)
        + ["login", "--browser-cookies", args.browser_cookies]
        + _include_domain_flags(args)
    )
    if args.storage:
        command.extend(["--storage", args.storage])
        if args.account:
            command.extend(["--account", args.account])
        return _run_repair_step(report, "browser_cookie_login_storage", command)

    if _storage_exists(args):
        refresh_command = (
            _notebooklm_base(args)
            + [
                "auth",
                "refresh",
                "--browser-cookies",
                args.browser_cookies,
                "--verify",
                "--quiet",
            ]
            + _include_domain_flags(args)
        )
        return _run_repair_step(report, "browser_cookie_refresh", refresh_command)

    if args.account:
        command.extend(["--account", args.account])
    return _run_repair_step(report, "browser_cookie_login", command)


def _manual_login_command(args: argparse.Namespace) -> list[str]:
    command = _login_base(args) + ["login"]
    if args.storage:
        command.extend(["--storage", args.storage])
    return command


def _remote_sync_script() -> Path:
    return Path(__file__).resolve().with_name("notebooklm_mcp_remote_cookie_sync.py")


def _has_remote_sync_token() -> bool:
    return any(os.environ.get(name) for name in REMOTE_SYNC_TOKEN_ENVS)


def _maybe_sync_remote(args: argparse.Namespace, report: Report) -> bool:
    if args.remote_sync == "never":
        return True
    if args.remote_sync == "auto" and not _has_remote_sync_token():
        return True

    script = _remote_sync_script()
    command = [sys.executable, str(script), "--upload-local", "--json"]
    if args.storage:
        command.extend(["--storage", args.storage])
    elif args.profile:
        command.extend(["--profile", args.profile])

    if not script.exists():
        report.steps.append(
            Step(
                name="remote_cookie_sync",
                command=command,
                returncode=127,
                ok=False,
                detail="remote cookie sync script was not found",
            )
        )
        return args.remote_sync != "always"

    ok = _run_repair_step(report, "remote_cookie_sync", command)
    return ok or args.remote_sync != "always"


def _finish_recovered(args: argparse.Namespace, report: Report, message: str) -> int:
    if not _maybe_sync_remote(args, report):
        report.status = "remote_sync_failed"
        report.message = "Local cookies recovered, but remote cookie sync failed."
        _emit_report(report, json_output=args.json, verbose=args.verbose)
        return 11
    report.status = "recovered"
    report.message = message
    _emit_report(report, json_output=args.json, verbose=args.verbose)
    return 0


def _emit_report(report: Report, *, json_output: bool, verbose: bool) -> None:
    if json_output:
        print(
            json.dumps(
                {
                    "status": report.status,
                    "profile": report.profile,
                    "storage": report.storage,
                    "command": report.command,
                    "message": report.message,
                    "steps": [
                        {
                            "name": step.name,
                            "command": step.command,
                            "returncode": step.returncode,
                            "ok": step.ok,
                            "detail": step.detail,
                        }
                        for step in report.steps
                    ],
                },
                indent=2,
            )
        )
        return

    print(f"NotebookLM MCP auth recovery: {report.status}")
    if report.message:
        print(report.message)
    for step in report.steps:
        marker = "ok" if step.ok else "failed"
        print(f"- {step.name}: {marker} (exit {step.returncode})")
        if verbose and step.detail:
            print(f"  {step.detail}")
    if report.command:
        print(f"Run manually: {report.command}")


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    report = Report(status="unknown", profile=args.profile, storage=args.storage)

    if _auth_check(args, report, "initial_auth_check"):
        if not _maybe_sync_remote(args, report):
            report.status = "remote_sync_failed"
            report.message = "Stored cookies are valid, but remote cookie sync failed."
            _emit_report(report, json_output=args.json, verbose=args.verbose)
            return 11
        report.status = "ok"
        report.message = "Stored cookies are already valid."
        _emit_report(report, json_output=args.json, verbose=args.verbose)
        return 0

    keepalive = _keepalive_command(args)
    if _run_repair_step(report, "keepalive_refresh", keepalive) and _auth_check(
        args, report, "post_keepalive_auth_check"
    ):
        return _finish_recovered(
            args,
            report,
            "Recovered by rotating the existing stored cookies.",
        )

    if (
        not args.skip_browser_cookies
        and _browser_cookie_repair(args, report)
        and _auth_check(args, report, "post_browser_cookie_auth_check")
    ):
        return _finish_recovered(
            args,
            report,
            f"Recovered from browser cookies: {args.browser_cookies}",
        )

    manual = _manual_login_command(args)
    if args.interactive_login:
        if _run_repair_step(report, "interactive_login", manual, interactive=True) and _auth_check(
            args, report, "post_interactive_login_auth_check"
        ):
            return _finish_recovered(
                args,
                report,
                "Recovered by running interactive notebooklm login.",
            )

    report.status = "needs_login"
    report.command = shlex.join(manual)
    report.message = (
        "Automatic recovery could not prove a live NotebookLM session. Run the "
        "manual login command on the MCP host, then restart or retry MCP."
    )
    _emit_report(report, json_output=args.json, verbose=args.verbose)
    return NEEDS_LOGIN_EXIT


if __name__ == "__main__":
    sys.exit(main())
