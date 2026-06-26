# Investigation: curl_cffi as an httpx replacement / alternative

**Status:** investigation only — no code changed in `src/`. "Just in case" feasibility study.
**Date:** 2026-06-26 · **Branch:** `investigate/curl-cffi`
**curl_cffi latest:** 0.15.0 (PyPI) · **httpx today:** the sole transport.

## 1. Why consider it

`curl_cffi` is a Python binding over `curl-impersonate` that can mimic real browser
**TLS / JA3 / HTTP-2 fingerprints** (`impersonate="chrome"`, etc.). httpx cannot — its
TLS/HTTP-2 fingerprint is identifiably non-browser.

Relevance to this project: our entire value rests on driving Google's internal
`batchexecute` from a non-browser client. Auth is already the most fragile surface
(SAPISIDHASH origin-binding, PSIDTS rotation, migration-cohort forks). If Google ever
adds TLS/JA3 fingerprint gating to the auth or RPC endpoints, **no amount of
header/cookie work in httpx fixes it** — the block happens at the TLS handshake.
curl_cffi is the standard escape hatch. This is insurance against a failure mode we
can't otherwise mitigate, not a current bug.

## 2. curl_cffi capabilities (verified against 0.15 docs)

| Need | curl_cffi | httpx parity |
|------|-----------|--------------|
| Async client | `curl_cffi.requests.AsyncSession` | ≈ `AsyncClient` |
| Streaming POST | `AsyncSession.stream("POST", url, …)` async ctx mgr | ✅ same shape |
| Response | `.status_code .headers .content .text .json() .url .raise_for_status() .cookies` | ✅ near-identical |
| Async body iter | `aiter_content()` / `aiter_lines()` | ⚠️ httpx is `aiter_bytes()` (rename only) |
| Cookies | `Cookies` accepts `CookieJar \| dict \| list`; **class is copied from httpx (BSD)** | ⚠️ not `httpx.Cookies`, but both wrap `http.cookiejar` |
| Exceptions | `RequestException` base → `HTTPError`, `Timeout`, `ConnectionError`, …; carry `code` + `response` | ⚠️ not `httpx.HTTPStatusError`/`RequestError` |
| Constructor | `timeout, headers, cookies, proxies, verify, allow_redirects, impersonate` | ✅ superset |

Bottom line: **API-similar, not drop-in.** The three gaps — Response type, Cookies type,
exception types — are exactly what an adapter absorbs.

## 3. How deeply is httpx wired in

- **326 references across 41 files.** Top symbols: `Cookies` (51), `AsyncClient` (42),
  `HTTPStatusError` (28), `Timeout` (23), `RequestError` (22), `Response` (19), `HTTPError` (13).
- httpx is not just a transport here — it's the **type vocabulary** for cookies, responses,
  and errors threaded through the auth layer and the error mapper. A literal find-replace is
  off the table.

### The one seam that matters

`_kernel.py` already injects the client factory:

```python
async_client_factory: Callable[..., httpx.AsyncClient] = httpx.AsyncClient
...
self._http_client = self._async_client_factory(
    headers={…}, cookies=cookies, timeout=http_timeout,
    follow_redirects=True, limits=limits.to_httpx_limits(),
)
```

This DI point exists for tests but is exactly where an alternate backend slots in.

### The *actual* surface the main RPC client uses

Despite 326 references, the **kernel's live client** is touched in only a handful of ways:

- constructor kwargs: `headers, cookies, timeout, follow_redirects, limits`
- `.cookies` (snapshot + `capture_cookie_snapshot`)
- `.get(url)` → response with `.url .text .raise_for_status()` (homepage token scrape, `_auth/session.py`)
- `.stream("POST", …)` — **only** via `_streaming_post.stream_post_with_size_cap`
- `.aclose()`

Everything else (`Cookies`, `Response`, exception types) lives **downstream of those calls**,
not on the client object. And critically:

- **`_streaming_post.py` already rebuilds a fresh `httpx.Response` from raw bytes.** An adapter
  can stream curl_cffi bytes straight into that existing reconstruction → downstream sees a real
  `httpx.Response`, unchanged.
- **`_transport_errors.raise_mapped_post_error`** is the single chokepoint that does
  `isinstance(exc, httpx.HTTPStatusError | httpx.RequestError)`. Exception translation happens here.

The four *other* `httpx.AsyncClient(...)` sites (`_artifact/downloads.py`, `_auth/account.py`,
`_auth/refresh.py`) are **independent short-lived clients** for downloads / token fetch — out of
scope for a first cut; they can adopt the factory later if impersonation must cover them too.

## 4. Options

**A. Full replacement (rip out httpx).** ❌ Rejected. 326 refs, httpx-typed cookies/responses/errors
everywhere, and httpx is a clean well-maintained dep. All cost, the only benefit (impersonation)
is achievable without it.

**B. Pluggable backend behind `async_client_factory` + an httpx-compat adapter.** ✅ Recommended.
Keep httpx as the default and as the type vocabulary. Add an opt-in `CurlCffiClient` adapter that
quacks like the *small* slice of `httpx.AsyncClient` the kernel uses, returns `httpx.Response`,
and raises httpx exception types. Selected via config/env (e.g. `NOTEBOOKLM_TRANSPORT=curl_cffi`,
`impersonate=chrome`). curl_cffi stays an **optional extra**, never a hard dep.

**C. Do nothing, keep this doc.** Reasonable until there's evidence of TLS gating. The seam already
exists, so adoption stays cheap later. This study *is* the insurance.

## 5. Adapter design (sketch — not built)

New optional module `src/notebooklm/_transport/curl_cffi_client.py`, wired as the factory:

```python
# pip install "notebooklm-py[impersonate]"  -> curl_cffi
from curl_cffi.requests import AsyncSession, RequestException
import httpx

class CurlCffiAsyncClient:
    """httpx.AsyncClient-shaped adapter over curl_cffi for TLS impersonation.

    Implements ONLY the surface the kernel uses: .cookies, .get, .stream, .aclose.
    Returns httpx.Response and raises httpx exceptions so all downstream code
    (error mapper, token scraper, _streaming_post) is untouched.
    """
    def __init__(self, *, headers, cookies, timeout, follow_redirects, limits,
                 impersonate="chrome"):
        self._session = AsyncSession(
            headers=dict(headers),
            cookies=cookies.jar,          # httpx.Cookies -> http.cookiejar -> curl_cffi
            timeout=_to_seconds(timeout),
            allow_redirects=follow_redirects,
            impersonate=impersonate,
        )
        self.cookies = cookies            # keep the httpx.Cookies the auth layer expects

    async def get(self, url, **kw):
        try:
            r = await self._session.get(url, **_xlate(kw))
        except RequestException as e:
            raise _to_httpx_error(e) from e
        return _to_httpx_response(r)      # build httpx.Response from curl_cffi Response

    def stream(self, method, url, **kw):
        return _CurlCffiStream(self._session, method, url, kw, self.cookies)
        # __aenter__ -> session.stream(...); yields an object exposing
        # .raise_for_status()/.aiter_bytes()/.headers/.status_code so
        # stream_post_with_size_cap works verbatim

    async def aclose(self):
        await self._session.close()
```

Cookie strategy: **keep `httpx.Cookies` as the in-memory representation** (the whole auth layer
depends on it) and hand curl_cffi the underlying `http.cookiejar` via `.jar`. After each
request, sync server-set cookies back into the httpx jar so PSIDTS rotation / snapshotting keep
working. This is the fiddliest part and the #1 thing the PoC must prove.

## 6. Risks / unknowns (rank-ordered for the PoC to retire)

1. **Cookie round-tripping.** Server `Set-Cookie` must land back in the `httpx.Cookies` jar so
   PSIDTS rotation, `capture_cookie_snapshot`, and disk persistence are unaffected. *Highest risk.*
2. **Streaming + size cap parity.** `stream_post_with_size_cap` aborts mid-stream past a byte cap;
   confirm curl_cffi's async chunk iterator honors early `break`/close without leaking the curl handle.
3. **Exception fidelity.** Map curl_cffi errors → the httpx types the mapper switches on
   (429 → rate-limited, 5xx → server error, transport → request error), incl. `.response` access.
4. **Native wheels.** curl_cffi ships compiled wheels (libcurl-impersonate). Fine on common
   platforms; verify CI matrix + that it stays an **optional extra** so the base install is pure-Python.
5. **Timeout semantics.** httpx's 4-slot `Timeout` (connect/read/write/pool) vs curl_cffi's
   simpler model — the per-request read-timeout widening in `Kernel.post` needs an equivalent.
6. **`follow_redirects` + redirect revalidation.** Downloads use `event_hooks` for host
   revalidation (#1521); not needed for cut 1 (downloads keep httpx), but note if extended.

## 7. Recommendation

Adopt **Option B's seam, lazily**: don't build the backend now, but treat this as the blueprint.
Concrete next step *if/when* we want it (or to de-risk pre-emptively): a **throwaway PoC** that

1. adds `curl_cffi` as an optional `[impersonate]` extra,
2. implements `CurlCffiAsyncClient` (the ~150-line adapter above),
3. injects it via `async_client_factory` in one `from_storage` path,
4. runs **one live e2e** (`notebooklm ask`) end-to-end, asserting cookie round-trip + a successful
   RPC, and diffing the JA3 against a real Chrome.

If that single e2e passes, Option B is proven and can graduate to a config-gated feature. If it
fails, it fails cheaply on the cookie/streaming axis — exactly the unknowns in §6.

**Until then: no production code, httpx stays the only transport.** The factory seam means this
decision stays reversible and cheap.

## 8. PoC — BUILT & PROVEN (2026-06-26)

The throwaway PoC from §7 is implemented on this branch and verified.

**Files:**
- `src/notebooklm/_curl_cffi_transport.py` — `CurlCffiAsyncClient` adapter (~180 lines).
- `src/notebooklm/_runtime/init.py` — env-gated factory selection in `_resolve_async_client_factory`.
- `pyproject.toml` — optional `[impersonate]` extra (`curl_cffi>=0.7,<1`), excluded from `all`.
- `tests/unit/test_curl_cffi_transport_poc.py` — hermetic proof (4 tests, `importorskip`).

**Proven (4/4 hermetic tests, local stdlib server):**
- `.get()` returns a real `httpx.Response` (`.text`/`.url`/`.raise_for_status()`).
- **Cookie round-trip (the §6 #1 risk): RETIRED.** Server `Set-Cookie` lands in the authoritative
  `httpx.Cookies` jar *and* is re-sent on the next request — the PSIDTS-rotation path works.
- `stream_post_with_size_cap` runs verbatim over the adapter's `.stream()` → `httpx.Response`.
- A 5xx flows through `raise_mapped_post_error` → `TransportServerError` (exception fidelity).
- `NOTEBOOKLM_TRANSPORT=curl_cffi` selects the adapter; **default (unset) stays `httpx.AsyncClient`**
  (40 existing transport/init/streaming tests still pass).

**Value prop proven live** (`https://tls.peet.ws/api/all`):

| transport | JA3 hash | ALPN |
|-----------|----------|------|
| `CurlCffiAsyncClient(impersonate="chrome")` | `62259838dcb050c90b6dcdf9c2744988` | HTTP/2 |
| plain `httpx.AsyncClient` | `37f7d09ced1a845dc48872abc1a29d7b` | — |

Distinct, browser-shaped fingerprint vs httpx's identifiable one. curl_cffi 0.15.0, Python 3.14.

**LIVE against Google (2026-06-26, real authenticated account):**
- `notebooklm list` (LIST_NOTEBOOKS) via `NOTEBOOKLM_TRANSPORT=curl_cffi` → identical real notebooks
  vs the httpx baseline.
- `client.chat.ask(...)` (GENERATE_CHAT_RESPONSE) → real cited answer returned. The live client's
  transport was confirmed as `CurlCffiAsyncClient` (not a silent httpx fallback). This exercises the
  **streaming POST path end-to-end** and proves **gzip'd RPC responses decode correctly**
  (§6 #2 RETIRED) and that **SAPISIDHASH / cookie auth works through curl_cffi** (§6 #1 fully retired live).

**Still NOT done (out of PoC scope):** timeout 4-slot fidelity (§6 #5); the 3 secondary
`httpx.AsyncClient` sites (downloads/account/refresh); a CI matrix for the native wheels.
Run `pytest tests/unit/test_curl_cffi_transport_poc.py` after
`uv sync --extra dev --extra impersonate` to reproduce the hermetic suite.

**Recommendation stands:** Option B is now de-risked on its hardest axis (cookies) and its premise
(impersonation) is confirmed. Promote to a config-gated feature only when there's a reason to
(evidence of TLS gating, or a decision to harden pre-emptively).

## 9. Full e2e sweep under curl_cffi (2026-06-26)

Ran `tests/e2e` (171 tests) with `NOTEBOOKLM_TRANSPORT=curl_cffi`. Result: **one real gap (upload),
now fixed; everything else green.**

**Real gap found & FIXED — file upload (all 9 `test_file_upload`):** the upload is a 2-leg flow —
register-source RPC (main kernel client → curl_cffi) + file POST to `/upload/_/` via a SEPARATE
client in `_source/upload.py`. That secondary factory was NOT routed through curl_cffi, so the
upload leg stayed on httpx; Google's upload endpoint 500s on the mixed curl_cffi-session +
httpx-upload flow (passes on all-httpx baseline). Fix (this branch):
- `_curl_cffi_transport.py`: added `.post()` (buffers bytes / sync- / async-iterable bodies via
  `_materialize`), the async-context-manager protocol (`__aenter__`/`__aexit__`), and a module
  `_materialize` helper.
- `_source/upload.py::_client_factory`: route the upload leg through curl_cffi when the env opt-in
  is set, so the whole flow shares one transport/fingerprint.
- Result: **9/9 upload tests pass** under curl_cffi (verified solo AND in-suite). Hermetic adapter
  unit suite still 4/4.

**Two NON-curl_cffi flakes (no fix warranted):** `test_generate_mind_map` and
`test_fast_research_import_count_matches` failed under full-suite load but **pass solo on BOTH
curl_cffi and httpx** — pre-existing e2e flakiness (shared-notebook contention / deep-research
nondeterminism) that the suite's `rerunfailures` normally absorbs. Not transport bugs.

**Operational lesson (cost the run a contaminated pass):** never run e2e tests concurrently against
the same account — two processes rotating PSIDTS in the shared `storage_state.json` invalidate each
other's CSRF token → a `CREATE_NOTEBOOK HTTP 401` storm (36 failed / 59 errored, all bogus). Run e2e
strictly serially, sole-access.

## 10. Fingerprint consistency + timeout fidelity (2026-06-26)

Closed the two follow-ups from §9:

- **Full fingerprint consistency.** Added a shared `resolve_transport_factory()` (single source of
  truth for the env opt-in) now used by every authenticated-Google client — main RPC kernel, upload,
  `_auth/account.py`, `_auth/refresh.py` — so the whole API surface shares one TLS fingerprint.
  `_artifact/downloads.py` is the deliberate exception: it stays on httpx for the #1521 redirect-host
  SSRF event-hook (which curl_cffi's internal redirect handling can't replicate) and targets a CDN
  host, not the authenticated surface. The adapter gained per-request `follow_redirects`/`timeout`
  kwarg translation and raw-`CookieJar` acceptance so the secondary clients work verbatim; cookies are
  now **copied** (matching `httpx.AsyncClient`) so a caller's jar isn't mutated.
- **4-slot timeout fidelity.** `_to_curl_timeout` maps `httpx.Timeout` → curl_cffi's `(connect, read)`
  tuple (write/pool have no libcurl equivalent, so they fold into the total) instead of collapsing to
  a single window. A sentinel in `_timeout_for` preserves an explicit `timeout=0`/`None`.

Polished (code-simplifier → Claude + Codex review → ultrathink): the one Important finding (timeout
sentinel) and the cookie-copy/test-mark suggestions were applied; re-verified live (`auth check`,
upload) + hermetic suite (8 tests).

## 11. Closing the last two gaps (2026-06-26)

- **Native-wheel CI matrix.** Added a dedicated `impersonate` job to `.github/workflows/test.yml`
  (ubuntu/macos/windows, mirroring the `mcp`/`server` jobs) that installs `--extra impersonate` and
  runs the curl_cffi hermetic suite — proving the native wheels resolve on every OS and the adapter
  behaves cross-platform. (The canonical install omits the extra, so the suite is otherwise skipped
  via `importorskip`.)
- **Streaming-upload buffering — won't-fix, by design.** curl_cffi's async `data=` accepts only
  `bytes`/`str`/`BytesIO`/`dict`, never a generator, so a streamed upload body *must* be buffered for
  the impersonate transport. This is a curl_cffi API limitation, not a client buffer we can stream
  around; it is bounded by NotebookLM's per-source upload size limit, and the default httpx transport
  still streams. Documented at `_materialize`; no arbitrary cap added (would risk rejecting valid
  uploads). Only genuinely open item now: nothing blocking — the transport is feature-complete for
  the authenticated API surface.

**Config:** `NOTEBOOKLM_TRANSPORT=curl_cffi` enables the transport; `NOTEBOOKLM_IMPERSONATE`
overrides the impersonation target (default `chrome`; any curl_cffi target, e.g. `safari`,
`chrome131`). Both documented in `docs/installation.md`'s extras matrix.
