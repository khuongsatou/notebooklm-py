"""REST route modules for the single-tenant server.

Each module exposes a ``router`` (a FastAPI ``APIRouter``) the application
factory mounts under ``/v1``. The modules are thin adapters over the
transport-neutral ``_app`` cores and the public client namespaces; they import
NO ``click`` / ``rich`` / ``cli``.
"""

from __future__ import annotations

from . import (
    artifacts,
    chat,
    cookie_sync,
    dashboard_auth,
    labels,
    mcp_keys,
    notebooks,
    notes,
    profile_login,
    research,
    settings,
    share,
    sources,
)

__all__ = [
    "artifacts",
    "chat",
    "cookie_sync",
    "dashboard_auth",
    "labels",
    "mcp_keys",
    "notebooks",
    "notes",
    "profile_login",
    "research",
    "settings",
    "share",
    "sources",
]
