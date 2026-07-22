"""Research routes for starting, polling, and cancelling discovery runs."""

from __future__ import annotations

from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel

from ..._app import research as core
from ..._app.serialize import to_jsonable
from ...client import NotebookLMClient
from .._context import get_client

__all__ = ["router"]

router = APIRouter(prefix="/notebooks/{notebook_id}/research", tags=["research"])

ClientDep = Annotated[NotebookLMClient, Depends(get_client)]


class ResearchStart(BaseModel):
    """Request body for starting a research run."""

    query: str
    source: Literal["web", "drive"] = "web"
    mode: Literal["fast", "deep"] = "fast"


@router.post("", status_code=201)
async def start_research(
    notebook_id: str, body: ResearchStart, client: ClientDep
) -> dict[str, Any]:
    """Start a research run and return the task identifiers."""
    result = await client.research.start(notebook_id, body.query, body.source, body.mode)
    return to_jsonable(result)


@router.get("/status")
async def research_status(
    notebook_id: str,
    client: ClientDep,
    task_id: str | None = Query(default=None),
) -> dict[str, Any]:
    """Poll research status once."""
    result = await core.poll_and_classify(client, notebook_id, task_id)
    return {
        "notebook_id": notebook_id,
        "task_id": result.task_id,
        "kind": result.kind,
        "status": result.status,
        "query": result.query,
        "sources": result.sources,
        "summary": result.summary,
        "report": result.report,
        "raw": result.public_dict,
    }


@router.delete("/{task_id}", status_code=204)
async def cancel_research(notebook_id: str, task_id: str, client: ClientDep) -> Response:
    """Cancel a research run."""
    await core.cancel_research(client, notebook_id, task_id)
    return Response(status_code=204)
