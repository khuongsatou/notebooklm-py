"""Per-request access to the lifespan-bound client.

The server binds exactly one :class:`~notebooklm.client.NotebookLMClient` for the
process lifetime via the FastMCP lifespan (one client, bound to the server's
event loop, satisfying the ADR-0004 loop-affinity contract). Tools reach it
through the request context. Keeping this in one place means the tool modules
never touch FastMCP internals directly.

This module imports NO ``click`` / ``rich`` / ``cli``.
"""

from __future__ import annotations

from collections.abc import Callable
from contextlib import AbstractAsyncContextManager, AsyncExitStack
from dataclasses import dataclass
from typing import TYPE_CHECKING, cast

from fastmcp import Context

from ..exceptions import AuthError
from ._recovery import run_recovery_once

if TYPE_CHECKING:
    from starlette.requests import Request

    from ..client import NotebookLMClient
    from ._filelink import FileTransferConfig

__all__ = [
    "AppState",
    "client_status",
    "ensure_client",
    "get_client",
    "get_client_from_app",
    "get_file_transfer",
    "recover_and_reopen_client",
]

ClientFactory = Callable[[], AbstractAsyncContextManager["NotebookLMClient"]]


@dataclass
class AppState:
    """Lifespan state: the single long-lived client bound to the server loop.

    ``file_transfer`` is the optional remote file-transfer config (signer +
    validated public base URL); ``None`` on stdio and on an http deployment
    without a public URL (ADR-0024).
    """

    client: NotebookLMClient | None = None
    file_transfer: FileTransferConfig | None = None
    client_factory: ClientFactory | None = None
    exit_stack: AsyncExitStack | None = None
    client_error: str | None = None
    profile: str | None = None
    recovery_attempted: bool = False

    async def _close_client(self) -> None:
        if self.client is None:
            return
        client = self.client
        self.client = None
        close = getattr(client, "close", None)
        if close is not None:
            await close()

    async def _open_client(self) -> NotebookLMClient:
        if self.client_factory is None or self.exit_stack is None:
            raise AuthError("NotebookLM client is not available for this MCP request.")
        self.client = await self.exit_stack.enter_async_context(self.client_factory())
        self.client_error = None
        return self.client

    async def ensure_client(self) -> NotebookLMClient:
        """Return a live client, retrying the lifespan factory if auth recovered."""
        if self.client is not None:
            return self.client
        try:
            return await self._open_client()
        except Exception as exc:
            if not self.recovery_attempted:
                self.recovery_attempted = True
                recovered = await run_recovery_once(profile=self.profile)
                if recovered:
                    try:
                        return await self._open_client()
                    except Exception as retry_exc:
                        self.client_error = str(retry_exc)
                        raise AuthError(
                            "NotebookLM authentication recovery ran, but the refreshed "
                            "cookies still could not open a live MCP client."
                        ) from retry_exc
            self.client_error = str(exc)
            raise AuthError(
                "NotebookLM authentication is not available. MCP tried automatic "
                "cookie recovery when configured; run `notebooklm login` on the "
                "server host if the session is fully expired."
            ) from exc

    async def recover_and_reopen_client(self) -> NotebookLMClient:
        """Force cookie recovery, close any stale client, and reopen from storage."""
        self.recovery_attempted = True
        await self._close_client()
        recovered = await run_recovery_once(profile=self.profile)
        if not recovered:
            self.client_error = "MCP cookie recovery did not complete successfully."
            raise AuthError(
                "NotebookLM authentication recovery could not prove a live session. "
                "Run `notebooklm login` on the server host, then retry MCP."
            )
        try:
            return await self._open_client()
        except Exception as exc:
            self.client_error = str(exc)
            raise AuthError(
                "NotebookLM authentication recovery ran, but the refreshed cookies "
                "still could not open a live MCP client."
            ) from exc


def _app_state(ctx: Context) -> AppState:
    """Return the lifespan-bound :class:`AppState` for the current tool call.

    Raises:
        RuntimeError: If called outside an active MCP request context (the
            lifespan binding is always present during a real tool invocation).
    """
    request_context = ctx.request_context
    if request_context is None:  # pragma: no cover - always set during a tool call
        raise RuntimeError("no active MCP request context")
    return cast("AppState", request_context.lifespan_context)


def get_client(ctx: Context) -> NotebookLMClient:
    """Return the lifespan-bound client for the current tool call.

    Raises:
        RuntimeError: If called outside an active MCP request context (the
            lifespan binding is always present during a real tool invocation).
    """
    state = _app_state(ctx)
    if state.client is None:
        raise AuthError(
            "NotebookLM authentication is not available. Call auth_relogin or run "
            "`notebooklm login` on the server host."
        )
    return state.client


async def ensure_client(ctx: Context) -> NotebookLMClient:
    """Return the lifespan client, retrying construction when the server is degraded."""
    return await _app_state(ctx).ensure_client()


async def recover_and_reopen_client(ctx: Context) -> NotebookLMClient:
    """Force recovery and replace the lifespan client for the current MCP server."""
    return await _app_state(ctx).recover_and_reopen_client()


def get_file_transfer(ctx: Context) -> FileTransferConfig | None:
    """Return the file-transfer config bound at lifespan, or ``None`` if unset.

    ``None`` means the deployment has no signed-URL side-channel (stdio, or http
    without a public URL), so the file tools fall back to / reject the path-based
    behavior. Mirrors :func:`get_client`.
    """
    return _app_state(ctx).file_transfer


def client_status(ctx: Context) -> tuple[bool, str | None]:
    """Return whether the lifespan client is ready and the last startup error."""
    state = _app_state(ctx)
    return state.client is not None, state.client_error


def get_client_from_app(request: Request) -> NotebookLMClient:
    """Return the lifespan-bound client from a bare Starlette ``Request``.

    The ``/files/*`` custom routes receive a Starlette :class:`Request`, not an
    MCP :class:`Context`, so they cannot use :func:`get_client`. FastMCP sets
    itself on ``request.app.state.fastmcp_server`` and stores the lifespan result
    (our :class:`AppState`) on ``._lifespan_result``, guarded by
    ``._lifespan_result_set``. Both are FastMCP **private** attributes — a
    regression test pins this access path so a FastMCP upgrade that changes either
    fails loudly.

    Raises:
        RuntimeError: the lifespan has not bound the client yet (the route then
            returns 500 rather than crashing).
    """
    server = request.app.state.fastmcp_server
    if not getattr(server, "_lifespan_result_set", False):
        raise RuntimeError("MCP lifespan client is not bound")
    state = cast("AppState", server._lifespan_result)
    if state.client is None:
        raise AuthError(
            "NotebookLM authentication is not available. Call auth_relogin or run "
            "`notebooklm login` on the server host."
        )
    return state.client
