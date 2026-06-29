"""CLI ↔ MCP adapter parity for artifact generation.

Both the CLI ``generate`` command and the MCP ``artifact_generate`` tool are thin
adapters over the *same* ``_app/generate`` core, but each plugs in its own
notebook/source resolvers. When those resolvers disagree, the two surfaces drift
apart even though every per-adapter unit test passes — which is exactly how #1652
shipped: the CLI resolved an omitted ``source_ids`` to ``None`` ("all sources")
while the MCP passthrough sent an empty list ("zero sources"), and the backend
refused the latter (``<kind> generation is unavailable``).

These tests drive both adapters against a mocked client for the same logical
inputs and assert the downstream ``client.artifacts.generate_*`` call is
equivalent. A mock can't enforce the backend contract, but it *can* pin that the
two adapters agree — which is the property that broke.
"""

from __future__ import annotations

import asyncio
import contextlib
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

pytest.importorskip("fastmcp")

from click.testing import CliRunner  # noqa: E402
from fastmcp import Client  # noqa: E402 - after importorskip guard

import notebooklm.auth as auth_module  # noqa: E402
from notebooklm._app import source_add as source_add_module  # noqa: E402
from notebooklm._types.artifacts import ArtifactStatus, ArtifactTypeCode  # noqa: E402
from notebooklm.cli import helpers as helpers_module  # noqa: E402
from notebooklm.cli.resolve import resolve_notebook_id, resolve_source_ids  # noqa: E402
from notebooklm.mcp._resolve import resolve_notebook  # noqa: E402
from notebooklm.mcp.server import create_server  # noqa: E402
from notebooklm.mcp.tools.artifacts import _passthrough_sources  # noqa: E402
from notebooklm.notebooklm_cli import cli  # noqa: E402
from notebooklm.types import Artifact, GenerationState  # noqa: E402

from .conftest import create_mock_client, inject_client  # noqa: E402

# UUID-shaped ids so BOTH adapters treat them as already-full (the MCP
# resolve_notebook skips the name lookup; the CLI resolve_source_ids skips the
# fuzzy client.sources.list match) — matching how MCP supplies full ids.
NB = "33333333-3333-3333-3333-333333333333"
SRC_A = "11111111-1111-1111-1111-111111111111"
SRC_B = "22222222-2222-2222-2222-222222222222"

#: (cli subcommand, MCP artifact_type, client method) for source-needing kinds.
_KINDS = [
    ("quiz", "quiz", "generate_quiz"),
    ("audio", "audio", "generate_audio"),
    ("flashcards", "flashcards", "generate_flashcards"),
]

_NAMESPACES = (
    "notebooks",
    "sources",
    "chat",
    "artifacts",
    "research",
    "notes",
    "sharing",
    "labels",
    "settings",
    "mind_maps",
)


@dataclass
class _FakeStatus:
    """Minimal generate() return the MCP serializer accepts."""

    task_id: str = "task-1"
    status: GenerationState = GenerationState.COMPLETED
    url: str | None = None
    error: str | None = None
    error_code: str | None = None
    metadata: dict[str, Any] | None = field(default=None)

    @property
    def is_complete(self) -> bool:
        return True


def _normalize_source_ids(value: Any) -> Any:
    """Compare source_ids by content, not container type (tuple vs list)."""
    return None if value is None else sorted(value)


def _normalized_call(call: Any) -> tuple[tuple, dict]:
    """A captured generate-* call as ``(args, kwargs)`` for cross-adapter comparison.

    Only ``source_ids`` is normalized (its container type differs: tuple vs list);
    EVERY other positional/keyword arg is compared verbatim, so a divergence in any
    default (language, audio_format, quantity, …) — not just source_ids — is caught.
    """
    kwargs = dict(call.kwargs)
    kwargs["source_ids"] = _normalize_source_ids(kwargs.get("source_ids"))
    return tuple(call.args), kwargs


def _drive_mcp(tool: str, args: dict[str, Any], setup: Any = None, *, suppress: bool = True) -> Any:
    """Drive an MCP ``tool`` against a fresh mocked client; return that client.

    ``setup(client)`` wires the downstream method(s) the tool reaches. ``suppress``
    swallows the call's exception so the sentinel-recorder e2e tests can capture a
    downstream call and abort; the generate tests pass ``suppress=False`` to run the
    full happy path (incl. return-serialization).
    """
    client = MagicMock()
    for ns in _NAMESPACES:
        setattr(client, ns, MagicMock())
    client.artifacts._list_for_download = None
    if setup is not None:
        setup(client)

    @contextlib.asynccontextmanager
    async def factory() -> Any:
        yield client

    async def run() -> None:
        async with Client(create_server(client_factory=factory)) as c:
            if suppress:
                with contextlib.suppress(Exception):
                    await c.call_tool(tool, args)
            else:
                await c.call_tool(tool, args)

    asyncio.run(run())
    return client


def _drive_cli(argv: list[str], setup: Any = None, *, check_exit: bool = False) -> Any:
    """Drive the CLI with ``argv`` against a fresh mocked client; return that client.

    ``setup(client)`` wires the downstream method(s) the command reaches.
    ``check_exit`` asserts a clean exit (the generate tests); the sentinel-recorder
    e2e tests leave it off because the sentinel aborts the command post-capture and
    they assert on the captured call instead.
    """
    client = create_mock_client()
    client.artifacts._list_for_download = None
    if setup is not None:
        setup(client)
    with (
        patch.object(helpers_module, "load_auth_from_storage", return_value={"SAPISID": "x"}),
        patch.object(
            auth_module, "fetch_tokens_with_domains", new_callable=AsyncMock
        ) as mock_fetch,
    ):
        mock_fetch.return_value = ("csrf", "session")
        result = CliRunner().invoke(cli, argv, obj=inject_client(client))
    if check_exit:
        assert result.exit_code == 0, result.output
    return client


def _mcp_generate_call(artifact_type: str, method: str, extra: dict[str, Any]) -> Any:
    """Drive the MCP ``artifact_generate`` tool; return the captured generate-method call."""
    client = _drive_mcp(
        "artifact_generate",
        {"notebook": NB, "artifact_type": artifact_type, **extra},
        setup=lambda c: setattr(c.artifacts, method, AsyncMock(return_value=_FakeStatus())),
        suppress=False,
    )
    return getattr(client.artifacts, method).await_args


def _cli_generate_call(cmd: str, method: str, extra_args: list[str]) -> Any:
    """Drive the CLI ``generate <cmd>``; return the captured generate-method call."""
    client = _drive_cli(
        ["generate", cmd, "-n", NB, *extra_args],
        setup=lambda c: setattr(
            c.artifacts,
            method,
            AsyncMock(return_value={"task_id": "task-1", "status": "processing"}),
        ),
        check_exit=True,
    )
    return getattr(client.artifacts, method).call_args


@pytest.mark.parametrize("cmd,artifact_type,method", _KINDS, ids=[k[0] for k in _KINDS])
def test_omitted_source_ids_parity(cmd: str, artifact_type: str, method: str) -> None:
    """Omitting sources: BOTH adapters must pass ``source_ids=None`` (= all sources).

    The #1652 regression: MCP sent an empty tuple (= zero sources, refused) while the
    CLI sent ``None``. This asserts they agree — and that the agreed value is ``None``.
    """
    mcp_call = _mcp_generate_call(artifact_type, method, {})
    cli_call = _cli_generate_call(cmd, method, [])

    mcp_src = _normalize_source_ids(mcp_call.kwargs.get("source_ids"))
    cli_src = _normalize_source_ids(cli_call.kwargs.get("source_ids"))
    assert cli_src is None, f"CLI {cmd} omitted-sources should resolve to None, got {cli_src!r}"
    assert mcp_src is None, f"MCP {cmd} omitted-sources should resolve to None, got {mcp_src!r}"
    # Full parity: notebook id (positional) AND every downstream kwarg agree, so a
    # divergence in any default — not just source_ids — fails here.
    assert _normalized_call(mcp_call) == _normalized_call(cli_call)
    assert mcp_call.args[0] == NB


def test_explicit_source_ids_parity() -> None:
    """With explicit (full) ids, both adapters pass the SAME ids downstream."""
    mcp_call = _mcp_generate_call("quiz", "generate_quiz", {"source_ids": [SRC_A, SRC_B]})
    cli_call = _cli_generate_call("quiz", "generate_quiz", ["-s", SRC_A, "-s", SRC_B])

    mcp_src = _normalize_source_ids(mcp_call.kwargs.get("source_ids"))
    cli_src = _normalize_source_ids(cli_call.kwargs.get("source_ids"))
    assert mcp_src == cli_src == sorted([SRC_A, SRC_B])
    # And full parity on the rest of the call too.
    assert _normalized_call(mcp_call) == _normalized_call(cli_call)


# ---------------------------------------------------------------------------
# Resolver parity — every CLI/MCP operation funnels notebook/source references
# through these shared resolvers, so pinning their agreement covers the
# divergence surface for ALL operations, not just generate.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("source_ids", [(), (SRC_A, SRC_B)], ids=["omitted", "full-ids"])
def test_source_resolver_parity(source_ids: tuple[str, ...]) -> None:
    """CLI ``resolve_source_ids`` and MCP ``_passthrough_sources`` must agree.

    Omitted ⇒ ``None`` ("all sources"), NOT an empty list ("zero sources"); full ids
    pass through identically. Neither path may hit ``client.sources.list``. This is
    the exact contract whose violation caused #1652.
    """
    client = MagicMock()
    cli_out = asyncio.run(resolve_source_ids(client, NB, source_ids))
    mcp_out = asyncio.run(_passthrough_sources(client, NB, source_ids))
    assert _normalize_source_ids(cli_out) == _normalize_source_ids(mcp_out)
    if not source_ids:
        assert cli_out is None and mcp_out is None
    client.sources.list.assert_not_called()


def test_notebook_resolver_parity_full_uuid() -> None:
    """CLI ``resolve_notebook_id`` and MCP ``resolve_notebook`` agree on a full UUID
    (fast-path: return it unchanged, no listing) — the shared entry every op uses."""
    client = MagicMock()
    cli_out = asyncio.run(resolve_notebook_id(client, NB))
    mcp_out = asyncio.run(resolve_notebook(client, NB))
    assert cli_out == mcp_out == NB
    client.notebooks.list.assert_not_called()


# ---------------------------------------------------------------------------
# End-to-end per-operation parity for the heavier shared-core ops
# (source_add, research, download). Each drives BOTH adapters and captures the
# shared downstream call via a recorder that raises a sentinel — so neither
# adapter's return-serialization runs (which is what made these brittle). We
# compare the captured call, not the (discarded) result.
# ---------------------------------------------------------------------------


class _Captured(Exception):
    """Raised by the recorder to short-circuit each adapter after the captured call."""


def _recorder() -> tuple[list[tuple[tuple, dict]], Any]:
    calls: list[tuple[tuple, dict]] = []

    async def fn(*args: Any, **kwargs: Any) -> Any:
        calls.append((args, kwargs))
        raise _Captured

    return calls, fn


def test_source_add_url_parity() -> None:
    """source_add(url): both adapters build the SAME SourceAddPlan + notebook id.

    Both run through ``_app.source_add.execute_source_add`` → module-level
    ``add_source(sources, notebook_id=…, plan=…)``; patching that one symbol
    captures both adapters' calls.
    """
    calls, fn = _recorder()
    with patch.object(source_add_module, "add_source", fn):
        _drive_mcp(
            "source_add", {"notebook": NB, "source_type": "url", "url": "https://example.com/a"}
        )
        _drive_cli(["source", "add", "https://example.com/a", "-n", NB])
    assert len(calls) == 2, f"expected MCP+CLI calls, got {calls!r}"
    mcp_kwargs, cli_kwargs = calls[0][1], calls[1][1]
    assert mcp_kwargs["notebook_id"] == cli_kwargs["notebook_id"] == NB
    assert mcp_kwargs["plan"] == cli_kwargs["plan"]


def test_research_start_parity() -> None:
    """research: MCP ``research_start`` and CLI ``source add-research`` both call
    ``client.research.start(nb_id, query, source, mode)`` with the same args/defaults."""
    calls_m, fn_m = _recorder()
    _drive_mcp(
        "research_start",
        {"notebook": NB, "query": "AI agents"},
        setup=lambda c: setattr(c.research, "start", fn_m),
    )
    calls_c, fn_c = _recorder()
    _drive_cli(
        ["source", "add-research", "AI agents", "-n", NB, "--no-wait"],
        setup=lambda c: setattr(c.research, "start", fn_c),
    )
    assert calls_m and calls_c, f"mcp={calls_m!r} cli={calls_c!r}"
    assert calls_m[0] == calls_c[0]  # (nb_id, query, source="web", mode="fast")


_AUDIO_ARTIFACT = Artifact(
    id="art1",
    title="Podcast",
    _artifact_type=ArtifactTypeCode.AUDIO.value,
    status=int(ArtifactStatus.COMPLETED),
    created_at=datetime(2024, 1, 1, tzinfo=timezone.utc),
)


def test_download_audio_parity(tmp_path: Any) -> None:
    """download: MCP ``artifact_download`` and CLI ``download audio`` resolve the same
    artifact and call ``client.artifacts.download_audio`` identically (via the shared
    ``execute_download``)."""
    out = str(tmp_path / "out.mp3")

    def setup(client: Any) -> None:
        client.artifacts._list_for_download = None
        client.artifacts.list = AsyncMock(return_value=[_AUDIO_ARTIFACT])

    calls_m, fn_m = _recorder()

    def setup_m(c: Any) -> None:
        setup(c)
        c.artifacts.download_audio = fn_m

    calls_c, fn_c = _recorder()

    def setup_c(c: Any) -> None:
        setup(c)
        c.artifacts.download_audio = fn_c

    _drive_mcp(
        "artifact_download", {"notebook": NB, "artifact_type": "audio", "path": out}, setup=setup_m
    )
    # OUTPUT_PATH is a positional arg on the CLI leaf (not -o).
    _drive_cli(["download", "audio", out, "-n", NB], setup=setup_c)
    assert calls_m and calls_c, f"mcp={calls_m!r} cli={calls_c!r}"
    assert calls_m[0] == calls_c[0]
