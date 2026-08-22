"""Public, credential-free bridge for the local Chrome Profile 185 login flow."""

from __future__ import annotations

import json
import secrets
import time
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse

from .._auth import require_auth

router = APIRouter(tags=["profile-login"])

DRIVE_DOWN_COOKIES_EXTENSION_ID = "cclelndahbckbenkjhflpdbgdldlbecc"
PROFILE_LOGIN_TTL_SECONDS = 300
PROFILE_LOGIN_MAX_TRANSACTIONS = 64


def _transactions(request: Request) -> dict[str, dict[str, Any]]:
    transactions = getattr(request.app.state, "profile_login_transactions", None)
    if not isinstance(transactions, dict):
        transactions = {}
        request.app.state.profile_login_transactions = transactions
    return transactions


def _iso_timestamp(timestamp: float) -> str:
    return datetime.fromtimestamp(timestamp, tz=timezone.utc).isoformat()


def _prune_transactions(request: Request, *, now: float | None = None) -> None:
    current = time.time() if now is None else now
    transactions = _transactions(request)
    expired = [
        login_id
        for login_id, transaction in transactions.items()
        if float(transaction.get("expires_at", 0)) <= current
    ]
    for login_id in expired:
        transactions.pop(login_id, None)
    if len(transactions) < PROFILE_LOGIN_MAX_TRANSACTIONS:
        return
    oldest = sorted(
        transactions,
        key=lambda login_id: float(transactions[login_id].get("created_at", 0)),
    )
    for login_id in oldest[: len(transactions) - PROFILE_LOGIN_MAX_TRANSACTIONS + 1]:
        transactions.pop(login_id, None)


def _transaction_payload(transaction: dict[str, Any]) -> dict[str, Any]:
    return {
        "ok": True,
        "login_id": transaction["login_id"],
        "status": transaction["status"],
        "connected": transaction["status"] == "connected",
        "created_at": _iso_timestamp(float(transaction["created_at"])),
        "expires_at": _iso_timestamp(float(transaction["expires_at"])),
        "cookie_count": transaction.get("cookie_count"),
        "notebook_count": transaction.get("notebook_count"),
        "error": transaction.get("error"),
    }


def _update_transaction(request: Request, login_id: str | None, **changes: Any) -> None:
    if login_id is None:
        return
    transactions = _transactions(request)
    transaction = transactions.get(login_id)
    if transaction is None or float(transaction.get("expires_at", 0)) <= time.time():
        return
    transaction.update(changes)


def mark_profile_login_syncing(request: Request, login_id: str | None) -> None:
    """Mark a server-issued browser login transaction as receiving cookies."""
    _update_transaction(request, login_id, status="syncing", error=None)


def complete_profile_login(
    request: Request,
    login_id: str | None,
    *,
    cookie_count: int,
    notebook_count: int | None,
) -> None:
    """Complete a server-issued transaction after live NotebookLM verification."""
    _update_transaction(
        request,
        login_id,
        status="connected",
        cookie_count=cookie_count,
        notebook_count=notebook_count,
        error=None,
        completed_at=time.time(),
    )


def fail_profile_login(request: Request, login_id: str | None, error: str) -> None:
    """Expose a safe failure state to the authenticated dashboard poller."""
    _update_transaction(request, login_id, status="error", error=error)


def clear_profile_login_transactions(request: Request) -> None:
    """Discard short-lived login transactions when the synced profile is cleared."""
    _transactions(request).clear()


def _profile_login_id(value: str | None) -> str:
    if not value:
        raise HTTPException(status_code=400, detail="Profile login correlation ID is required.")
    try:
        parsed = uuid.UUID(value)
    except ValueError:
        raise HTTPException(
            status_code=400, detail="Profile login correlation ID is invalid."
        ) from None
    if parsed.version != 4 or str(parsed) != value.strip().lower():
        raise HTTPException(status_code=400, detail="Profile login correlation ID is invalid.")
    return str(parsed)


@router.post("/auth/profile-login/start", dependencies=[Depends(require_auth)])
async def start_profile_login(request: Request) -> dict[str, Any]:
    """Create a one-time Profile 185 login transaction for the hosted dashboard."""
    now = time.time()
    _prune_transactions(request, now=now)
    login_id = str(uuid.uuid4())
    transaction = {
        "login_id": login_id,
        "status": "waiting_for_extension",
        "created_at": now,
        "expires_at": now + PROFILE_LOGIN_TTL_SECONDS,
        "cookie_count": None,
        "notebook_count": None,
        "error": None,
    }
    _transactions(request)[login_id] = transaction
    return {
        **_transaction_payload(transaction),
        "bridge_url": (f"/profile-login?notebooklm_profile_login=1&profile_login_id={login_id}"),
    }


@router.get("/auth/profile-login/status", dependencies=[Depends(require_auth)])
async def profile_login_status(
    request: Request,
    profile_login_id: str | None = None,
) -> dict[str, Any]:
    """Poll a server-issued Profile 185 login transaction without sync credentials."""
    login_id = _profile_login_id(profile_login_id)
    transaction = _transactions(request).get(login_id)
    if transaction is None:
        raise HTTPException(status_code=404, detail="Profile login transaction was not found.")
    if float(transaction.get("expires_at", 0)) <= time.time():
        _transactions(request).pop(login_id, None)
        return {
            **_transaction_payload({**transaction, "status": "expired"}),
            "connected": False,
            "error": "Profile login transaction expired.",
        }
    return _transaction_payload(transaction)


@router.get("/profile-login", response_class=HTMLResponse, include_in_schema=False)
async def profile_login_bridge(profile_login_id: str | None = None) -> HTMLResponse:
    """Render the extension bridge without requiring the dashboard password.

    The correlation UUID grants no access and carries no credential. The
    extension owns the cookie-sync bearer and the server independently verifies
    the uploaded NotebookLM session before the page reports success.
    """
    login_id = _profile_login_id(profile_login_id)
    nonce = secrets.token_urlsafe(18)
    script = _bridge_script(login_id)
    document = f"""<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>NotebookLM login · Profile 185</title>
  <style nonce="{nonce}">
    :root {{ color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }}
    * {{ box-sizing: border-box; }}
    body {{ margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; background: #191919; color: #f5f5f5; }}
    main {{ width: min(520px, 100%); display: grid; gap: 18px; padding: 28px; border: 1px solid #3a3a3a; border-radius: 18px; background: #262626; box-shadow: 0 28px 90px #0009; }}
    .mark {{ width: 54px; height: 54px; display: grid; place-items: center; border-radius: 15px; font-size: 25px; background: linear-gradient(135deg,#e56a4a,#ee8d6a); }}
    .kicker {{ color: #f5a081; font-size: 12px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }}
    h1 {{ margin: 7px 0 8px; font-size: 30px; }}
    p {{ margin: 0; color: #b8b8b8; line-height: 1.6; }}
    .status {{ display: flex; justify-content: space-between; gap: 12px; padding: 10px 12px; border: 1px solid #4a4a4a; border-radius: 12px; color: #d4d4d4; }}
    .status[data-state="verified"] {{ border-color: #22c55e88; color: #86efac; }}
    .status[data-state="error"] {{ border-color: #ef444488; color: #fca5a5; }}
    .actions {{ display: flex; flex-wrap: wrap; gap: 10px; }}
    button {{ min-height: 40px; padding: 0 14px; border: 1px solid #555; border-radius: 10px; background: #333; color: #fff; cursor: pointer; font: inherit; font-weight: 700; }}
    button.primary {{ border-color: #e56a4a; background: linear-gradient(135deg,#e56a4a,#ee8d6a); }}
    button[hidden] {{ display: none; }}
    small {{ color: #858585; text-align: center; }}
  </style>
</head>
<body>
  <main aria-label="Chrome Profile 185 NotebookLM login">
    <span class="mark" aria-hidden="true">N</span>
    <div><span class="kicker">Chrome Profile 185</span><h1>NotebookLM login</h1><p id="message">Đang kiểm tra extension…</p></div>
    <div id="status" class="status" data-state="checking"><span>Extension + VPS</span><strong id="state">checking</strong></div>
    <div class="actions"><button id="retry" class="primary" hidden>Thử lại</button><button id="close">Đóng trang</button></div>
    <small>Không chứa token · Cookie được lọc, rollback khi lỗi và xác minh live</small>
  </main>
  <script nonce="{nonce}">{script}</script>
</body>
</html>"""
    return HTMLResponse(
        document,
        headers={
            "Cache-Control": "no-store",
            "Content-Security-Policy": (
                "default-src 'none'; "
                f"script-src 'nonce-{nonce}'; style-src 'nonce-{nonce}'; "
                "base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
            ),
            "Referrer-Policy": "no-referrer",
            "X-Content-Type-Options": "nosniff",
        },
    )


def _bridge_script(login_id: str) -> str:
    extension_id = json.dumps(DRIVE_DOWN_COOKIES_EXTENSION_ID)
    correlation_id = json.dumps(login_id)
    return rf"""
const extensionId = {extension_id};
const profileLoginId = {correlation_id};
const message = document.getElementById('message');
const status = document.getElementById('status');
const state = document.getElementById('state');
const retry = document.getElementById('retry');
let stopped = false;

function render(nextState, text, detail = nextState) {{
  status.dataset.state = nextState;
  state.textContent = detail;
  message.textContent = text;
  retry.hidden = nextState !== 'error';
}}

function request(type, extra = {{}}) {{
  return new Promise((resolve, reject) => {{
    const runtime = globalThis.chrome?.runtime;
    if (!runtime?.sendMessage) return reject(new Error('Drive Down Cookies extension was not detected.'));
    runtime.sendMessage(extensionId, {{ target: 'drive-down-cookies', type, ...extra }}, (response) => {{
      const runtimeError = runtime.lastError?.message;
      if (runtimeError) return reject(new Error(runtimeError));
      if (!response?.ok) return reject(new Error(response?.error || 'Extension did not respond.'));
      resolve(response);
    }});
  }});
}}

async function attempt() {{
  if (stopped) return;
  try {{
    render('checking', 'Đang đồng bộ phiên NotebookLM từ Profile 185…');
    const result = await request('sync-now', {{ profile_login_id: profileLoginId }});
    if (result.client_reloaded !== true || result.auth_verified !== true || typeof result.persisted_count !== 'number') {{
      throw new Error('VPS đã nhận cookie nhưng chưa xác minh được phiên NotebookLM.');
    }}
    stopped = true;
    render('verified', 'Đăng nhập đã được xác minh trên VPS. Bạn có thể quay lại ứng dụng desktop.', `${{result.persisted_count}} cookies verified`);
  }} catch (error) {{
    const detail = error instanceof Error ? error.message : 'Không thể đồng bộ NotebookLM.';
    if (/extension|correlation|mã cũ|reload/i.test(detail)) {{
      stopped = true;
      render('error', `${{detail}} Reload Drive Down Cookies trong Profile 185 rồi thử lại.`);
      return;
    }}
    render('waiting', /sign-in|accounts\.google\.com|re-authenticate/i.test(detail)
      ? 'Hãy hoàn tất đăng nhập Google trong tab NotebookLM vừa mở. Trang này sẽ tự kiểm tra lại.'
      : `${{detail}} Đang thử lại…`);
    setTimeout(attempt, 3000);
  }}
}}

async function start() {{
  stopped = false;
  try {{
    const result = await request('connect');
    if (result.capabilities?.profile_login_correlation !== true) {{
      throw new Error('Drive Down Cookies đang chạy mã cũ.');
    }}
    await attempt();
  }} catch (error) {{
    stopped = true;
    const detail = error instanceof Error ? error.message : 'Không thể kết nối extension.';
    render('error', `${{detail}} Reload Drive Down Cookies trong Profile 185 rồi thử lại.`);
  }}
}}

retry.addEventListener('click', start);
document.getElementById('close').addEventListener('click', () => window.close());
start();
"""


__all__ = [
    "DRIVE_DOWN_COOKIES_EXTENSION_ID",
    "PROFILE_LOGIN_MAX_TRANSACTIONS",
    "PROFILE_LOGIN_TTL_SECONDS",
    "clear_profile_login_transactions",
    "complete_profile_login",
    "fail_profile_login",
    "mark_profile_login_syncing",
    "router",
]
