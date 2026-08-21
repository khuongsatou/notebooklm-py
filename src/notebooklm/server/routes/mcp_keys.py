"""Authenticated MCP config and managed API-key routes."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from ...mcp._integration import public_mcp_config
from ...mcp._managed_keys import ManagedKeyStore, ManagedKeyStoreError
from ...mcp._usage import McpUsageStore

__all__ = ["router"]

router = APIRouter(prefix="/mcp", tags=["mcp"])


class CreateMcpKeyBody(BaseModel):
    """Human-readable label for a new one-time secret."""

    name: str = Field(min_length=1, max_length=80)


def _store() -> ManagedKeyStore:
    return ManagedKeyStore.for_profile()


def _storage_error(exc: ManagedKeyStoreError) -> HTTPException:
    if str(exc) == "mcp_key_not_found":
        return HTTPException(status_code=404, detail="MCP API key not found")
    return HTTPException(status_code=500, detail="MCP API key store is unavailable")


@router.get("/config")
async def get_mcp_config() -> dict[str, object]:
    """Return the public manifest projection used by setup snippets."""
    return public_mcp_config()


@router.get("/keys")
async def list_mcp_keys() -> dict[str, object]:
    """List safe key metadata; hashes and secrets never leave storage."""
    try:
        keys = _store().list()
    except ManagedKeyStoreError as exc:
        raise _storage_error(exc) from exc
    return {"ok": True, "keys": keys}


@router.post("/keys", status_code=status.HTTP_201_CREATED)
async def create_mcp_key(body: CreateMcpKeyBody) -> dict[str, object]:
    """Issue a 256-bit managed key; ``apiKey`` is returned exactly once."""
    if not body.name.strip():
        raise HTTPException(status_code=422, detail="MCP API key name cannot be blank")
    try:
        issued = _store().create(name=body.name, created_by="NotebookLM Pro dashboard")
    except ManagedKeyStoreError as exc:
        raise _storage_error(exc) from exc
    return {"ok": True, **issued}


@router.delete("/keys/{key_id}")
async def revoke_mcp_key(key_id: str) -> dict[str, object]:
    """Revoke a managed key; the MCP gateway rejects its next request."""
    try:
        key = _store().revoke(key_id)
    except ManagedKeyStoreError as exc:
        raise _storage_error(exc) from exc
    return {"ok": True, "key": key}


@router.get("/usage")
async def get_mcp_usage(period: str = "7d") -> dict[str, object]:
    """Return secret-free gateway telemetry for the MCP account dashboard."""
    try:
        return McpUsageStore.for_profile().summary(period)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail="MCP usage store is unavailable") from exc
