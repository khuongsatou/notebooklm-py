#!/usr/bin/env python3
"""Check or repair a remote NotebookLM MCP/REST cookie-sync receiver.

The server-side receiver is the existing ``/sync/*`` API. This script performs
the operator side of the flow:

1. call ``/sync/connected`` to see whether the remote profile is live;
2. optionally upload a local ``storage_state.json`` through the challenge-gated
   ``/sync/cookies`` route; and
3. call ``/sync/connected`` again to verify the remote client reloaded.

Cookie values and bearer tokens are never printed.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen

DEFAULT_ENDPOINT = "https://notebooklm.1nutnhan.com/sync/cookies"
NOTEBOOKLM_SOURCE_URL = "https://notebooklm.google.com/"


@dataclass
class HttpResult:
    status_code: int
    body: dict[str, Any]


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Check and optionally upload local NotebookLM cookies to a remote receiver."
    )
    parser.add_argument(
        "--endpoint",
        default=os.environ.get("NOTEBOOKLM_COOKIE_SYNC_ENDPOINT", DEFAULT_ENDPOINT),
        help=f"Cookie sync endpoint. Default: {DEFAULT_ENDPOINT}",
    )
    parser.add_argument(
        "--token",
        default=os.environ.get("NOTEBOOKLM_COOKIE_SYNC_TOKEN")
        or os.environ.get("NOTEBOOKLM_SERVER_TOKEN"),
        help="Bearer token. Defaults to NOTEBOOKLM_COOKIE_SYNC_TOKEN/NOTEBOOKLM_SERVER_TOKEN.",
    )
    parser.add_argument(
        "--storage",
        default=os.environ.get("NOTEBOOKLM_REFRESH_STORAGE_PATH"),
        help="Local storage_state.json to upload.",
    )
    parser.add_argument(
        "--profile",
        default=os.environ.get("NOTEBOOKLM_PROFILE", "default"),
        help="Local profile name used when --storage is omitted.",
    )
    parser.add_argument(
        "--upload-local",
        action="store_true",
        help="Upload the local storage_state.json when the remote is not connected.",
    )
    parser.add_argument(
        "--force-upload",
        action="store_true",
        help="Upload local storage even if /sync/connected already reports connected.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Emit machine-readable output.",
    )
    return parser.parse_args(argv)


def _origin(endpoint: str) -> str:
    parsed = urlparse(endpoint)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError(f"Invalid endpoint: {endpoint!r}")
    return f"{parsed.scheme}://{parsed.netloc}"


def _storage_path(args: argparse.Namespace) -> Path:
    if args.storage:
        return Path(args.storage).expanduser()
    home = Path(os.environ.get("NOTEBOOKLM_HOME", "~/.notebooklm")).expanduser()
    return home / "profiles" / args.profile / "storage_state.json"


def _headers(token: str, *, json_body: bool = False) -> dict[str, str]:
    headers = {
        "Accept": "application/json",
        "Authorization": f"Bearer {token}",
    }
    if json_body:
        headers["Content-Type"] = "application/json"
    return headers


def _request_json(
    method: str,
    url: str,
    token: str,
    *,
    payload: dict[str, Any] | None = None,
) -> HttpResult:
    data = None
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
    request = Request(
        url, data=data, method=method, headers=_headers(token, json_body=data is not None)
    )
    try:
        with urlopen(request, timeout=45) as response:  # noqa: S310 - operator-supplied endpoint
            raw = response.read().decode("utf-8", "replace")
            body = json.loads(raw) if raw else {}
            if not isinstance(body, dict):
                body = {"ok": False, "error": "Response JSON was not an object."}
            return HttpResult(status_code=response.status, body=body)
    except HTTPError as exc:
        raw = exc.read().decode("utf-8", "replace")
        try:
            parsed = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            parsed = {"ok": False, "error": raw or str(exc)}
        if not isinstance(parsed, dict):
            parsed = {"ok": False, "error": str(parsed)}
        return HttpResult(status_code=exc.code, body=parsed)
    except (OSError, URLError) as exc:
        return HttpResult(status_code=0, body={"ok": False, "error": str(exc)})


def _public_body(body: dict[str, Any]) -> dict[str, Any]:
    """Drop fields that could carry operator-only diagnostics in future routes."""
    allowed = {
        "ok",
        "status",
        "connected",
        "profile_ready",
        "cookie_count",
        "notebook_count",
        "client_reloaded",
        "auth_verified",
        "persisted_count",
        "received_count",
        "restart_required",
        "storage_deleted",
        "backup_deleted",
        "client_closed",
        "error",
    }
    return {key: value for key, value in body.items() if key in allowed}


def _read_storage(path: Path) -> dict[str, Any]:
    loaded = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(loaded, dict) or not isinstance(loaded.get("cookies"), list):
        raise ValueError(f"{path} is not a Playwright storage_state object with cookies.")
    if not loaded["cookies"]:
        raise ValueError(f"{path} contains no cookies.")
    return loaded


def _upload_local(args: argparse.Namespace, token: str) -> HttpResult:
    storage_path = _storage_path(args)
    storage_state = _read_storage(storage_path)
    base = _origin(args.endpoint)
    challenge = _request_json("GET", urljoin(base, "/sync/challenge"), token)
    if challenge.status_code != 200 or not isinstance(challenge.body.get("challenge"), str):
        return challenge
    payload = {
        "source": "drive-down-cookies",
        "scope": "local-storage-state",
        "source_url": NOTEBOOKLM_SOURCE_URL,
        "captured_at": _utc_now_iso(),
        "challenge": challenge.body["challenge"],
        "cookies": storage_state["cookies"],
    }
    return _request_json("POST", args.endpoint, token, payload=payload)


def _utc_now_iso() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()


def _emit(report: dict[str, Any], *, json_output: bool) -> None:
    if json_output:
        print(json.dumps(report, indent=2))
        return
    print(f"Remote cookie sync: {report['status']}")
    first = report.get("initial")
    if first:
        print(f"- initial: {first.get('status')} connected={first.get('connected')}")
    upload = report.get("upload")
    if upload:
        print(f"- upload: status={upload.get('status')} persisted={upload.get('persisted_count')}")
    final = report.get("final")
    if final:
        print(f"- final: {final.get('status')} connected={final.get('connected')}")
    if report.get("message"):
        print(report["message"])


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    if not args.token:
        report = {
            "status": "error",
            "message": "Missing bearer token. Set NOTEBOOKLM_COOKIE_SYNC_TOKEN or pass --token.",
        }
        _emit(report, json_output=args.json)
        return 2

    base = _origin(args.endpoint)
    connected_url = urljoin(base, "/sync/connected")
    initial = _request_json("GET", connected_url, args.token)
    report: dict[str, Any] = {
        "status": "connected" if initial.body.get("connected") is True else "not_connected",
        "initial": _public_body(initial.body),
    }

    should_upload = args.force_upload or (
        args.upload_local and initial.body.get("connected") is not True
    )
    if should_upload:
        try:
            upload = _upload_local(args, args.token)
        except (OSError, ValueError, json.JSONDecodeError) as exc:
            report["status"] = "error"
            report["message"] = f"Local storage upload could not start: {exc}"
            _emit(report, json_output=args.json)
            return 1
        report["upload"] = _public_body(upload.body)
        final = _request_json("GET", connected_url, args.token)
        report["final"] = _public_body(final.body)
        report["status"] = "connected" if final.body.get("connected") is True else "not_connected"

    if report["status"] != "connected":
        report["message"] = (
            "Remote MCP is still not authenticated. Refresh local cookies first with "
            "scripts/notebooklm_mcp_auth_recover.py, then rerun with --upload-local, "
            "or use the Drive Down Cookies extension sync button."
        )

    _emit(report, json_output=args.json)
    return 0 if report["status"] == "connected" else 1


if __name__ == "__main__":
    sys.exit(main())
