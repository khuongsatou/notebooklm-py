"""Persistent MCP tool telemetry and cross-process daily creation quota."""

from __future__ import annotations

import json
import os
import sys
import time
import uuid
from collections.abc import Callable
from datetime import date, datetime, timedelta, timezone
from datetime import time as datetime_time
from pathlib import Path
from typing import Any, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from filelock import FileLock

from ..io import atomic_write_json
from ..paths import get_profile_dir
from ._integration import mcp_usage_config

__all__ = [
    "MCP_USAGE_STORE_ENV",
    "McpQuotaExceeded",
    "McpUsageMiddleware",
    "McpUsageStore",
    "get_mcp_usage_store_path",
]

MCP_USAGE_STORE_ENV = "NOTEBOOKLM_MCP_USAGE_STORE"
_RESERVATION_TTL = timedelta(hours=2)
_PERIOD_DAYS = {"today": 1, "7d": 7, "30d": 30}


def _iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _parse_iso(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def get_mcp_usage_store_path(profile: str | None = None) -> Path:
    configured = os.environ.get(MCP_USAGE_STORE_ENV, "").strip()
    if configured:
        return Path(configured).expanduser().resolve()
    return get_profile_dir(profile=profile, create=True) / "mcp_usage.json"


class McpQuotaExceeded(RuntimeError):
    """Raised before dispatch when the daily successful-create quota is full."""

    def __init__(self, snapshot: dict[str, Any]) -> None:
        self.snapshot = snapshot
        super().__init__(
            "mcp_quota_exceeded: daily creation limit "
            f"{snapshot['dailyLimit']} reached; reset at {snapshot['dailyResetAt']}"
        )


class McpUsageStore:
    """Store secret-free tool events and quota reservations in one locked JSON file."""

    def __init__(
        self,
        path: Path,
        *,
        now: Callable[[], datetime] | None = None,
        config: dict[str, Any] | None = None,
    ) -> None:
        self.path = path.expanduser().resolve()
        parent_created = not self.path.parent.exists()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if parent_created and sys.platform != "win32":
            self.path.parent.chmod(0o700)
        self.lock_path = self.path.with_suffix(self.path.suffix + ".lock")
        self._now = now or (lambda: datetime.now(timezone.utc))
        self.config = config or mcp_usage_config()
        try:
            self.timezone = ZoneInfo(str(self.config["timezone"]))
        except ZoneInfoNotFoundError as exc:
            raise RuntimeError("MCP usage timezone is invalid") from exc

    @classmethod
    def for_profile(cls, profile: str | None = None) -> McpUsageStore:
        return cls(get_mcp_usage_store_path(profile))

    def _read_unlocked(self) -> dict[str, Any]:
        try:
            payload = json.loads(self.path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return {"version": 1, "events": [], "reservations": []}
        except (json.JSONDecodeError, OSError) as exc:
            raise RuntimeError("mcp_usage_store_unavailable") from exc
        if not isinstance(payload, dict):
            raise RuntimeError("mcp_usage_store_corrupt")
        events = payload.get("events", [])
        reservations = payload.get("reservations", [])
        if not isinstance(events, list) or not isinstance(reservations, list):
            raise RuntimeError("mcp_usage_store_corrupt")
        return {"version": 1, "events": events, "reservations": reservations}

    def _write_unlocked(self, payload: dict[str, Any]) -> None:
        atomic_write_json(self.path, payload, mode=0o600)

    def _date_key(self, value: datetime) -> str:
        return value.astimezone(self.timezone).date().isoformat()

    def _prune(self, payload: dict[str, Any], now: datetime) -> None:
        cutoff = now - timedelta(days=int(self.config["retention_days"]))
        payload["events"] = [
            item
            for item in payload["events"]
            if (_parse_iso(item.get("createdAt")) or now) >= cutoff
        ]
        reservation_cutoff = now - _RESERVATION_TTL
        payload["reservations"] = [
            item
            for item in payload["reservations"]
            if (_parse_iso(item.get("createdAt")) or datetime.min.replace(tzinfo=timezone.utc))
            >= reservation_cutoff
        ]

    def _quota_snapshot(
        self, payload: dict[str, Any], now: datetime, *, include_reservations: bool = True
    ) -> dict[str, Any]:
        today = self._date_key(now)
        used = sum(
            1
            for item in payload["events"]
            if item.get("dateKey") == today
            and item.get("operation") == "create"
            and item.get("status") == "success"
        )
        reserved = (
            sum(1 for item in payload["reservations"] if item.get("dateKey") == today)
            if include_reservations
            else 0
        )
        limit = int(self.config["daily_create_limit"])
        local_now = now.astimezone(self.timezone)
        next_day = local_now.date() + timedelta(days=1)
        reset = datetime.combine(next_day, datetime_time.min, tzinfo=self.timezone)
        return {
            "dailyLimit": limit,
            "dailyUsed": used,
            "dailyReserved": reserved,
            "dailyRemaining": max(0, limit - used - reserved),
            "dailyResetAt": _iso(reset),
        }

    def reserve_create(self, *, tool: str, key_id: str, key_prefix: str) -> str:
        """Atomically reserve a successful-create slot before tool dispatch."""
        now = self._now()
        with FileLock(str(self.lock_path), timeout=10):
            payload = self._read_unlocked()
            self._prune(payload, now)
            quota = self._quota_snapshot(payload, now)
            if quota["dailyRemaining"] <= 0:
                payload["events"].append(
                    self._event(
                        now=now,
                        tool=tool,
                        operation="create",
                        status="failed",
                        key_id=key_id,
                        key_prefix=key_prefix,
                        latency_ms=0,
                        error_code="mcp_quota_exceeded",
                    )
                )
                self._write_unlocked(payload)
                raise McpQuotaExceeded(quota)
            reservation_id = str(uuid.uuid4())
            payload["reservations"].append(
                {
                    "id": reservation_id,
                    "tool": tool,
                    "keyId": key_id,
                    "keyPrefix": key_prefix,
                    "dateKey": self._date_key(now),
                    "createdAt": _iso(now),
                }
            )
            self._write_unlocked(payload)
            return reservation_id

    def record_result(
        self,
        *,
        tool: str,
        operation: Literal["create", "download", "other"],
        success: bool,
        key_id: str = "",
        key_prefix: str = "",
        latency_ms: int = 0,
        error_code: str = "",
        reservation_id: str = "",
    ) -> None:
        now = self._now()
        with FileLock(str(self.lock_path), timeout=10):
            payload = self._read_unlocked()
            self._prune(payload, now)
            if reservation_id:
                payload["reservations"] = [
                    item for item in payload["reservations"] if item.get("id") != reservation_id
                ]
            payload["events"].append(
                self._event(
                    now=now,
                    tool=tool,
                    operation=operation,
                    status="success" if success else "failed",
                    key_id=key_id,
                    key_prefix=key_prefix,
                    latency_ms=max(0, int(latency_ms)),
                    error_code=error_code,
                )
            )
            self._write_unlocked(payload)

    def _event(
        self,
        *,
        now: datetime,
        tool: str,
        operation: str,
        status: str,
        key_id: str,
        key_prefix: str,
        latency_ms: int,
        error_code: str,
    ) -> dict[str, Any]:
        return {
            "id": str(uuid.uuid4()),
            "tool": tool[:100],
            "operation": operation,
            "status": status,
            "keyId": key_id[:120],
            "keyPrefix": key_prefix[:40],
            "latencyMs": latency_ms,
            "errorCode": error_code[:100],
            "createdAt": _iso(now),
            "dateKey": self._date_key(now),
        }

    def summary(self, period: str = "7d") -> dict[str, Any]:
        if period not in _PERIOD_DAYS:
            raise ValueError("period must be one of: today, 7d, 30d")
        now = self._now()
        today = now.astimezone(self.timezone).date()
        first_day = today - timedelta(days=_PERIOD_DAYS[period] - 1)
        with FileLock(str(self.lock_path), timeout=10):
            payload = self._read_unlocked()
            before = (len(payload["events"]), len(payload["reservations"]))
            self._prune(payload, now)
            if before != (len(payload["events"]), len(payload["reservations"])):
                self._write_unlocked(payload)
            quota = self._quota_snapshot(payload, now)
            events = [
                item
                for item in payload["events"]
                if first_day <= self._event_date(item, today) <= today
            ]

        create_events = [item for item in events if item.get("operation") == "create"]
        download_events = [item for item in events if item.get("operation") == "download"]
        series = []
        for offset in range(_PERIOD_DAYS[period]):
            day = first_day + timedelta(days=offset)
            day_key = day.isoformat()
            day_create = [item for item in create_events if item.get("dateKey") == day_key]
            series.append(
                {
                    "date": day_key,
                    "createRequested": len(day_create),
                    "createSuccess": sum(item.get("status") == "success" for item in day_create),
                    "createFailed": sum(item.get("status") == "failed" for item in day_create),
                    "downloadSuccess": sum(
                        item.get("dateKey") == day_key and item.get("status") == "success"
                        for item in download_events
                    ),
                }
            )
        recent = sorted(events, key=lambda item: str(item.get("createdAt")), reverse=True)[:20]
        return {
            "ok": True,
            "period": {
                "name": period,
                "from": first_day.isoformat(),
                "to": today.isoformat(),
                "timeZone": str(self.config["timezone"]),
            },
            "summary": {
                "createRequested": len(create_events),
                "createSuccess": sum(item.get("status") == "success" for item in create_events),
                "createFailed": sum(item.get("status") == "failed" for item in create_events),
                "downloadSuccess": sum(item.get("status") == "success" for item in download_events),
                **quota,
            },
            "series": series,
            "recent": recent,
        }

    @staticmethod
    def _event_date(item: dict[str, Any], fallback: date) -> date:
        try:
            return date.fromisoformat(str(item.get("dateKey")))
        except (TypeError, ValueError):
            return fallback


def _safe_identity() -> tuple[str, str]:
    try:
        from fastmcp.server.dependencies import get_access_token

        token = get_access_token()
    except RuntimeError:
        token = None
    if token is None:
        return "local", "local"
    claims = getattr(token, "claims", {}) or {}
    return str(claims.get("key_id") or token.client_id), str(claims.get("key_prefix") or "")


def _result_succeeded(result: Any) -> bool:
    structured = getattr(result, "structured_content", None)
    if not isinstance(structured, dict):
        return True
    if structured.get("ok") is False:
        return False
    return str(structured.get("status") or "").lower() not in {"error", "failed", "failure"}


try:
    from fastmcp.server.middleware import CallNext, Middleware, MiddlewareContext
    from fastmcp.tools.base import ToolResult
    from mcp import McpError
    from mcp.types import CallToolRequestParams, ErrorData

    class McpUsageMiddleware(Middleware):
        """Record real tool results and enforce the manifest's create quota."""

        def __init__(self, store: McpUsageStore) -> None:
            self.store = store

        async def on_call_tool(
            self,
            context: MiddlewareContext[CallToolRequestParams],
            call_next: CallNext[CallToolRequestParams, ToolResult],
        ) -> ToolResult:
            tool = context.message.name
            create_tools = self.store.config["create_tools"]
            download_tools = self.store.config["download_tools"]
            operation: Literal["create", "download", "other"] = (
                "create"
                if tool in create_tools
                else "download"
                if tool in download_tools
                else "other"
            )
            key_id, key_prefix = _safe_identity()
            reservation_id = ""
            if operation == "create":
                try:
                    reservation_id = self.store.reserve_create(
                        tool=tool, key_id=key_id, key_prefix=key_prefix
                    )
                except McpQuotaExceeded as exc:
                    raise McpError(ErrorData(code=-32029, message=str(exc))) from exc

            started = time.monotonic()
            try:
                result = await call_next(context)
            except BaseException as exc:
                self.store.record_result(
                    tool=tool,
                    operation=operation,
                    success=False,
                    key_id=key_id,
                    key_prefix=key_prefix,
                    latency_ms=round((time.monotonic() - started) * 1000),
                    error_code=type(exc).__name__,
                    reservation_id=reservation_id,
                )
                raise
            success = _result_succeeded(result)
            self.store.record_result(
                tool=tool,
                operation=operation,
                success=success,
                key_id=key_id,
                key_prefix=key_prefix,
                latency_ms=round((time.monotonic() - started) * 1000),
                error_code="" if success else "tool_result_failed",
                reservation_id=reservation_id,
            )
            return result

except ImportError:  # pragma: no cover - optional mcp extra is not installed
    McpUsageMiddleware = None  # type: ignore[assignment,misc]
