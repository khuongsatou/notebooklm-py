"""Master-token login service (Click-free, per ADR-0015).

Bootstrap and refresh of headless master-token auth: obtain/persist the durable
``aas_et/`` master token, mint web cookies from it, and write them to the
profile's ``storage_state.json`` so the existing client runs unchanged.
"""

from __future__ import annotations

import asyncio
from pathlib import Path

from ....auth import (  # noqa: TID252 (package-relative; public boundary, not _auth.*)
    MasterTokenError,
    exchange_master_token,
    mint_cookies,
    persist_minted_jar,
    read_master_token,
    write_master_token,
)

_EMBEDDED_SETUP_URL = "https://accounts.google.com/EmbeddedSetup"


async def _verify(storage_path: Path) -> int:
    """Smoke-test the minted session: list notebooks. Returns the count."""
    from ....client import NotebookLMClient  # noqa: PLC0415 (avoid import cycle)

    async with NotebookLMClient.from_storage(path=str(storage_path)) as client:
        return len(await client.notebooks.list())


async def bootstrap(
    *,
    email: str,
    oauth_token: str,
    android_id: str,
    storage_path: Path,
    master_token_path: Path,
    verify: bool = True,
) -> int:
    """One-time: exchange the single-use ``oauth_token`` for a durable master
    token, persist it (0600), mint cookies, write ``storage_state.json``, and
    (optionally) verify by listing notebooks. Returns the notebook count (or -1
    when verify is False). Raises :class:`MasterTokenError` on rejection."""
    # exchange/write/persist are sync (network + locked file I/O) — off-thread so
    # they don't block the event loop the CLI runs them on.
    token = await asyncio.to_thread(exchange_master_token, email, oauth_token, android_id)
    await asyncio.to_thread(
        write_master_token,
        master_token_path,
        email=email,
        master_token=token,
        android_id=android_id,
    )
    jar = await mint_cookies(email, token, android_id)
    await asyncio.to_thread(persist_minted_jar, storage_path, jar, email=email)
    return await _verify(storage_path) if verify else -1


async def refresh(*, storage_path: Path, master_token_path: Path) -> None:
    """No-prompt re-mint from the stored master token (recovery / hand-run).
    Overwrites ``storage_state.json`` with a fresh session."""
    rec = await asyncio.to_thread(read_master_token, master_token_path)
    if rec is None:
        raise MasterTokenError(
            f"No master token at {master_token_path}. Run `notebooklm login --master-token` first."
        )
    jar = await mint_cookies(rec["email"], rec["master_token"], rec["android_id"])
    await asyncio.to_thread(persist_minted_jar, storage_path, jar, email=rec.get("email"))


def capture_oauth_token(
    *, browser: str = "chromium", cdp_url: str | None = None, timeout_s: float = 300.0
) -> str:
    """Directive B: open a *visible* browser at Google's EmbeddedSetup, let the
    user sign in, and scrape the single-use ``oauth_token`` cookie. No unattended
    headless Google login (anti-bot) — the user completes auth interactively.

    Requires the ``[browser]`` extra. Attaches to a running Chrome via ``cdp_url``
    when given, else launches a headed Playwright browser."""
    try:
        from playwright.sync_api import sync_playwright  # noqa: PLC0415
    except ImportError as exc:  # pragma: no cover - import guard
        raise MasterTokenError(
            "Browser-assisted oauth_token capture needs the [browser] extra "
            "(pip install 'notebooklm-py[browser]'), or pass --oauth-token manually."
        ) from exc

    with sync_playwright() as p:
        # Track what WE created so teardown never closes the user's own browser/
        # context (CDP adopts the user's live session) and always runs on error.
        owns_browser = owns_context = False
        if cdp_url:
            browser_obj = p.chromium.connect_over_cdp(cdp_url)
            if browser_obj.contexts:
                context = browser_obj.contexts[0]
            else:
                context = browser_obj.new_context()
                owns_context = True
        else:
            # Respect --browser: "chromium" is the bundled build; "chrome"/"msedge"
            # are system Chromium channels (the documented macOS-15-crash workaround).
            # channel=None selects the bundled Chromium.
            channel = browser if browser and browser != "chromium" else None
            browser_obj = p.chromium.launch(headless=False, channel=channel)
            owns_browser = True
            context = browser_obj.new_context()
            owns_context = True
        page = context.new_page()
        try:
            page.goto(_EMBEDDED_SETUP_URL)
            # Poll the context's cookie jar for oauth_token until present/timeout.
            deadline = page.evaluate("Date.now()") + timeout_s * 1000
            token = ""
            while page.evaluate("Date.now()") < deadline:
                for c in context.cookies():
                    if c.get("name") == "oauth_token" and c.get("value"):
                        token = c["value"]
                        break
                if token:
                    break
                page.wait_for_timeout(1000)
        finally:
            page.close()  # always close the page WE created
            if owns_context:
                context.close()
            if owns_browser:
                browser_obj.close()
    if not token:
        raise MasterTokenError(
            "Did not observe an oauth_token cookie. Complete Google sign-in at "
            "accounts.google.com/EmbeddedSetup, then retry (or pass --oauth-token)."
        )
    return token
