"""MCP gateway telemetry, period summaries, and daily quota coverage."""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import pytest

pytest.importorskip("fastmcp")

from fastmcp.server.middleware import MiddlewareContext  # noqa: E402
from fastmcp.tools.base import ToolResult  # noqa: E402
from mcp import McpError  # noqa: E402
from mcp.types import CallToolRequestParams  # noqa: E402

from notebooklm.mcp._usage import (  # noqa: E402
    McpQuotaExceeded,
    McpUsageMiddleware,
    McpUsageStore,
)


def _config(limit: int = 3, retention: int = 90) -> dict[str, object]:
    return {
        "enabled": True,
        "timezone": "Asia/Ho_Chi_Minh",
        "retention_days": retention,
        "create_tools": frozenset({"note_create"}),
        "download_tools": frozenset({"artifact_download"}),
        "daily_create_limit": limit,
    }


def test_summary_counts_create_download_and_daily_quota(tmp_path) -> None:
    now = datetime(2026, 8, 14, 7, tzinfo=timezone.utc)
    store = McpUsageStore(tmp_path / "usage.json", now=lambda: now, config=_config())

    first = store.reserve_create(tool="note_create", key_id="key-1", key_prefix="nlm…1234")
    store.record_result(tool="note_create", operation="create", success=True, reservation_id=first)
    second = store.reserve_create(tool="note_create", key_id="key-1", key_prefix="nlm…1234")
    store.record_result(
        tool="note_create",
        operation="create",
        success=False,
        error_code="ValidationError",
        reservation_id=second,
    )
    store.record_result(tool="artifact_download", operation="download", success=True)

    result = store.summary("today")
    assert result["summary"] == {
        "createRequested": 2,
        "createSuccess": 1,
        "createFailed": 1,
        "downloadSuccess": 1,
        "dailyLimit": 3,
        "dailyUsed": 1,
        "dailyReserved": 0,
        "dailyRemaining": 2,
        "dailyResetAt": "2026-08-14T17:00:00Z",
    }
    assert result["series"][0]["date"] == "2026-08-14"


def test_quota_reservations_prevent_concurrent_overrun_and_record_rejection(tmp_path) -> None:
    now = datetime(2026, 8, 14, 7, tzinfo=timezone.utc)
    store = McpUsageStore(tmp_path / "usage.json", now=lambda: now, config=_config(limit=1))
    reservation = store.reserve_create(tool="note_create", key_id="key-1", key_prefix="safe")

    with pytest.raises(McpQuotaExceeded) as caught:
        McpUsageStore(
            tmp_path / "usage.json", now=lambda: now, config=_config(limit=1)
        ).reserve_create(tool="note_create", key_id="key-2", key_prefix="safe")

    assert caught.value.snapshot["dailyRemaining"] == 0
    store.record_result(
        tool="note_create", operation="create", success=True, reservation_id=reservation
    )
    result = store.summary("today")
    assert result["summary"]["createRequested"] == 2
    assert result["summary"]["createFailed"] == 1
    assert result["summary"]["dailyUsed"] == 1


def test_quota_resets_on_next_local_day(tmp_path) -> None:
    current = [datetime(2026, 8, 14, 7, tzinfo=timezone.utc)]
    store = McpUsageStore(tmp_path / "usage.json", now=lambda: current[0], config=_config(limit=1))
    reservation = store.reserve_create(tool="note_create", key_id="key", key_prefix="safe")
    store.record_result(
        tool="note_create", operation="create", success=True, reservation_id=reservation
    )
    with pytest.raises(McpQuotaExceeded):
        store.reserve_create(tool="note_create", key_id="key", key_prefix="safe")

    current[0] += timedelta(days=1)
    assert store.reserve_create(tool="note_create", key_id="key", key_prefix="safe")


def test_store_retention_and_secret_free_schema(tmp_path) -> None:
    current = [datetime(2026, 8, 14, 7, tzinfo=timezone.utc)]
    path = tmp_path / "usage.json"
    store = McpUsageStore(path, now=lambda: current[0], config=_config(retention=2))
    store.record_result(tool="server_info", operation="other", success=True, key_id="managed:key")
    current[0] += timedelta(days=3)
    store.record_result(tool="server_info", operation="other", success=True, key_id="managed:key")

    payload = json.loads(path.read_text(encoding="utf-8"))
    assert len(payload["events"]) == 1
    serialized = json.dumps(payload)
    assert "arguments" not in serialized
    assert "prompt" not in serialized
    assert "nlm_mcp_live-secret" not in serialized
    assert path.stat().st_mode & 0o777 == 0o600


@pytest.mark.asyncio
async def test_middleware_records_results_and_blocks_dispatch_at_quota(tmp_path) -> None:
    now = datetime(2026, 8, 14, 7, tzinfo=timezone.utc)
    store = McpUsageStore(tmp_path / "usage.json", now=lambda: now, config=_config(limit=1))
    middleware = McpUsageMiddleware(store)
    context = MiddlewareContext(
        message=CallToolRequestParams(name="note_create", arguments={}),
        method="tools/call",
    )
    calls = 0

    async def call_next(_context):
        nonlocal calls
        calls += 1
        return ToolResult(structured_content={"note_id": "note-1"})

    await middleware.on_call_tool(context, call_next)
    with pytest.raises(McpError, match="mcp_quota_exceeded"):
        await middleware.on_call_tool(context, call_next)

    assert calls == 1
    assert store.summary("today")["summary"]["createSuccess"] == 1
