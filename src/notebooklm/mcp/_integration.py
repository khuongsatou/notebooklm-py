"""Product manifest loader for the MCP account portal.

The public config is intentionally small and secret-free. Product labels, the
public endpoint, auth header and feature groups come from the packaged YAML
manifest; deployment environment variables may override only public origins.
"""

from __future__ import annotations

import copy
import os
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import yaml

__all__ = [
    "integration_manifest_path",
    "load_integration_manifest",
    "mcp_usage_config",
    "public_mcp_config",
]

_PUBLIC_URL_ENV = "NOTEBOOKLM_MCP_PUBLIC_URL"
_OAUTH_BASE_URL_ENV = "NOTEBOOKLM_MCP_OAUTH_BASE_URL"
_MANIFEST_BASE_URL_ENV = "NOTEBOOKLM_MCP_MANIFEST_BASE_URL"
_APP_BASE_URL_ENV = "NOTEBOOKLM_APP_BASE_URL"
_DAILY_CREATE_LIMIT_ENV = "NOTEBOOKLM_MCP_DAILY_CREATE_LIMIT"


def integration_manifest_path() -> Path:
    """Return the packaged product manifest path."""
    return Path(__file__).with_name("mcp-integration.manifest.yaml")


def _absolute_url(value: Any, field: str) -> str:
    url = str(value or "").strip().rstrip("/")
    parsed = urlsplit(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise RuntimeError(f"MCP integration manifest field {field} must be an absolute URL")
    return url


def load_integration_manifest() -> dict[str, Any]:
    """Load and validate the product MCP manifest.

    Public deployment origins may be changed without editing the package. The
    MCP origin is never inferred from the app origin: its dedicated environment
    variable wins, followed by the OAuth origin and finally the manifest value.
    """
    raw = yaml.safe_load(integration_manifest_path().read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise RuntimeError("MCP integration manifest must contain a mapping")
    manifest = copy.deepcopy(raw)
    product = manifest.get("product")
    endpoints = manifest.get("endpoints")
    mcp = manifest.get("mcp")
    if not isinstance(product, dict) or not product.get("name") or not product.get("slug"):
        raise RuntimeError("MCP integration manifest product is incomplete")
    if not isinstance(endpoints, dict) or not isinstance(mcp, dict):
        raise RuntimeError("MCP integration manifest endpoints/mcp sections are required")

    app_override = os.environ.get(_APP_BASE_URL_ENV, "").strip()
    if app_override:
        endpoints["app_base_url"] = app_override
    mcp_override = (
        os.environ.get(_MANIFEST_BASE_URL_ENV, "").strip()
        or os.environ.get(_PUBLIC_URL_ENV, "").strip()
        or os.environ.get(_OAUTH_BASE_URL_ENV, "").strip()
    )
    if mcp_override:
        endpoints["mcp_base_url"] = mcp_override

    for field in ("app_base_url", "auth_base_url", "api_base_url", "mcp_base_url"):
        endpoints[field] = _absolute_url(endpoints.get(field), f"endpoints.{field}")
    path = str(endpoints.get("mcp_path") or "").strip()
    if not path.startswith("/") or path.startswith("//"):
        raise RuntimeError("MCP integration manifest endpoints.mcp_path must start with one slash")
    endpoints["mcp_path"] = path
    return manifest


def public_mcp_config() -> dict[str, Any]:
    """Project the manifest into the safe dashboard/API response."""
    manifest = load_integration_manifest()
    product = manifest["product"]
    endpoints = manifest["endpoints"]
    mcp = manifest["mcp"]
    permissions = manifest.get("permissions") or {}
    auth = mcp.get("auth") or {}
    return {
        "ok": True,
        "product": {
            "name": product["name"],
            "slug": product["slug"],
            "description": product.get("description", ""),
        },
        "endpoint": f"{endpoints['mcp_base_url']}{endpoints['mcp_path']}",
        "endpoints": {
            "appBaseUrl": endpoints.get("app_base_url", ""),
            "authBaseUrl": endpoints.get("auth_base_url", ""),
            "apiBaseUrl": endpoints.get("api_base_url", ""),
            "mcpBaseUrl": endpoints.get("mcp_base_url", ""),
            "mediaBaseUrl": endpoints.get("media_base_url", ""),
            "docsBaseUrl": endpoints.get("docs_base_url", ""),
        },
        "transport": mcp.get("transport", "streamable-http"),
        "protocolVersion": mcp.get("protocol_version", "2025-03-26"),
        "auth": {
            "type": auth.get("type", "header"),
            "header": auth.get("header", "Authorization"),
            "valuePrefix": auth.get("value_prefix", "Bearer"),
        },
        "permissions": {
            "manageKey": permissions.get("manage_key", ""),
            "viewUsage": permissions.get("view_usage", ""),
            "callTools": permissions.get("call_tools", ""),
        },
        "features": manifest.get("features", []),
    }


def mcp_usage_config() -> dict[str, Any]:
    """Return validated, deployment-aware MCP telemetry settings."""
    manifest = load_integration_manifest()
    raw = manifest.get("usage")
    if not isinstance(raw, dict):
        raise RuntimeError("MCP integration manifest usage section is required")

    create_tools = raw.get("create_tools")
    download_tools = raw.get("download_tools")
    if not isinstance(create_tools, list) or not all(
        isinstance(item, str) for item in create_tools
    ):
        raise RuntimeError("MCP usage create_tools must be a list of tool names")
    if not isinstance(download_tools, list) or not all(
        isinstance(item, str) for item in download_tools
    ):
        raise RuntimeError("MCP usage download_tools must be a list of tool names")

    limit_value: Any = os.environ.get(_DAILY_CREATE_LIMIT_ENV, raw.get("daily_create_limit", 100))
    try:
        daily_limit = int(limit_value)
        retention_days = int(raw.get("retention_days", 90))
    except (TypeError, ValueError) as exc:
        raise RuntimeError("MCP usage limits must be integers") from exc
    if daily_limit < 1 or retention_days < 1:
        raise RuntimeError("MCP usage limits must be positive")

    return {
        "enabled": bool(raw.get("enabled", True)),
        "timezone": str(raw.get("timezone") or "UTC"),
        "retention_days": retention_days,
        "create_tools": frozenset(create_tools),
        "download_tools": frozenset(download_tools),
        "daily_create_limit": daily_limit,
    }
