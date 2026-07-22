"""Label routes for notebook source grouping."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel

from ..._app import labels as core
from ..._app.serialize import to_jsonable
from ...client import NotebookLMClient
from .._context import get_client

__all__ = ["router"]

router = APIRouter(prefix="/notebooks/{notebook_id}/labels", tags=["labels"])

ClientDep = Annotated[NotebookLMClient, Depends(get_client)]


class LabelCreate(BaseModel):
    """Request body for creating a label."""

    name: str
    emoji: str = ""


class LabelRename(BaseModel):
    """Request body for renaming a label."""

    name: str


class LabelEmoji(BaseModel):
    """Request body for changing a label emoji."""

    emoji: str


class LabelSources(BaseModel):
    """Request body for adding/removing label members."""

    source_ids: list[str]


class LabelGenerate(BaseModel):
    """Request body for AI label generation."""

    scope: str = "unlabeled"


@router.get("")
async def list_labels(notebook_id: str, client: ClientDep) -> dict[str, Any]:
    """List all labels in a notebook."""
    labels = await client.labels.list(notebook_id)
    return {"notebook_id": notebook_id, "labels": to_jsonable(labels)}


@router.post("", status_code=201)
async def create_label(notebook_id: str, body: LabelCreate, client: ClientDep) -> dict[str, Any]:
    """Create a label."""
    label = await core.execute_label_create(client, notebook_id, body.name, body.emoji)
    return to_jsonable(label)


@router.post("/generate")
async def generate_labels(
    notebook_id: str, body: LabelGenerate, client: ClientDep
) -> dict[str, Any]:
    """Generate labels for notebook sources."""
    result = await core.execute_label_generate(client, notebook_id, body.scope)
    return {
        "notebook_id": notebook_id,
        "scope": result.scope,
        "labels": to_jsonable(result.labels),
        "count": len(result.labels),
    }


@router.get("/{label_id}/sources")
async def label_sources(notebook_id: str, label_id: str, client: ClientDep) -> dict[str, Any]:
    """Expand one label to its source objects."""
    sources = await core.execute_label_sources(client, notebook_id, label_id)
    return {"notebook_id": notebook_id, "label_id": label_id, "sources": to_jsonable(sources)}


@router.patch("/{label_id}")
async def rename_label(
    notebook_id: str, label_id: str, body: LabelRename, client: ClientDep
) -> dict[str, Any]:
    """Rename a label."""
    label = await core.execute_label_rename(client, notebook_id, label_id, body.name)
    return to_jsonable(label)


@router.patch("/{label_id}/emoji")
async def set_label_emoji(
    notebook_id: str, label_id: str, body: LabelEmoji, client: ClientDep
) -> dict[str, Any]:
    """Set a label emoji."""
    label = await core.execute_label_set_emoji(client, notebook_id, label_id, body.emoji)
    return to_jsonable(label)


@router.post("/{label_id}/sources")
async def add_label_sources(
    notebook_id: str, label_id: str, body: LabelSources, client: ClientDep
) -> dict[str, Any]:
    """Add sources to a label."""
    result = await core.execute_label_add_sources(client, notebook_id, label_id, body.source_ids)
    return {"label": to_jsonable(result.label), "source_ids": result.source_ids}


@router.delete("/{label_id}/sources")
async def remove_label_sources(
    notebook_id: str, label_id: str, body: LabelSources, client: ClientDep
) -> dict[str, Any]:
    """Remove sources from a label."""
    result = await core.execute_label_remove_sources(client, notebook_id, label_id, body.source_ids)
    return {"label": to_jsonable(result.label), "source_ids": result.source_ids}


@router.delete("/{label_id}", status_code=204)
async def delete_label(notebook_id: str, label_id: str, client: ClientDep) -> Response:
    """Delete one label."""
    await core.execute_label_delete(client, notebook_id, [label_id])
    return Response(status_code=204)
