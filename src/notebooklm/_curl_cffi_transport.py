"""PoC: an ``httpx.AsyncClient``-shaped adapter backed by ``curl_cffi``.

Lets the transport kernel speak to Google over a connection that impersonates a
real browser's TLS/JA3/HTTP-2 fingerprint (``curl_cffi``'s reason to exist),
while every downstream consumer keeps seeing ``httpx.Response`` objects and
``httpx`` exception types. See ``docs/notes/curl-cffi-investigation.md``.

Scope: implements ONLY the slice of ``httpx.AsyncClient`` the kernel uses —
``.cookies``, ``.get()``, ``.stream()``, ``.aclose()`` — selected at runtime via
``NOTEBOOKLM_TRANSPORT=curl_cffi`` (see ``_runtime/init._resolve_async_client_factory``).

ponytail: PoC, deliberately minimal. Known gaps (tracked in the investigation
doc §6): httpx ``limits`` ignored (curl_cffi pools internally); the 4-slot
``httpx.Timeout`` is folded to curl's ``(connect, read)`` model (write/pool have
no libcurl equivalent — see ``_to_curl_timeout``); gzip handling assumes
``aiter_content``/``content`` yield already-decoded bytes (true for libcurl's
auto-decompress — verify against real gzip'd RPC before production).
"""

from __future__ import annotations

import io
import os
from typing import TYPE_CHECKING, Any

import httpx

if TYPE_CHECKING:
    from collections.abc import AsyncIterator, Mapping
    from http.cookiejar import CookieJar

DEFAULT_IMPERSONATE = "chrome"

# Headers that must not survive onto a Response rebuilt from already-decoded
# bytes — same rationale as ``_streaming_post._STRIP_HEADERS_ON_REBUFFER``.
_STRIP_HEADERS = frozenset({"content-encoding", "content-length"})


def _to_curl_timeout(timeout: Any) -> float | tuple[float, float] | None:
    """Map an httpx.Timeout (or float/None) to curl_cffi's timeout model.

    curl_cffi takes a single total float or a ``(connect, read)`` tuple, which it
    applies as CONNECTTIMEOUT=connect and overall TIMEOUT=connect+read. httpx's
    4-slot Timeout (connect/read/write/pool) has no separate write/pool in
    libcurl, so those fold into the total — preserving the two slots curl can act
    on (connect + read) instead of collapsing everything to one window.
    """
    # ``bool`` is an ``int`` subclass — exclude it so a stray ``True``/``False``
    # isn't silently treated as a 1s/0s timeout.
    if timeout is None or (isinstance(timeout, (int, float)) and not isinstance(timeout, bool)):
        return timeout
    connect = getattr(timeout, "connect", None)
    read = getattr(timeout, "read", None)
    if connect is not None and read is not None:
        return (connect, read)
    return read if read is not None else connect


def _strip(headers: Mapping[str, str]) -> dict[str, str]:
    return {k: v for k, v in headers.items() if k.lower() not in _STRIP_HEADERS}


async def _materialize(content: Any) -> bytes | None:
    """Collapse an httpx-style request body (bytes / sync- or async-iterable) to bytes.

    curl_cffi's async ``data=`` accepts only ``bytes``/``str``/``BytesIO``/``dict``
    — never a (async) generator — so a streamed upload body must be buffered here.
    This is a curl_cffi API limitation, not a buffer we can stream around; it is
    bounded by NotebookLM's per-source upload size limit. For very large uploads,
    prefer the default httpx transport (which streams the body).
    """
    if content is None or isinstance(content, (bytes, bytearray)):
        return bytes(content) if content is not None else None
    if isinstance(content, str):
        return content.encode()
    if isinstance(content, io.IOBase):  # e.g. BytesIO — read it out
        return content.read()
    buf = bytearray()
    if hasattr(content, "__aiter__"):
        async for chunk in content:
            buf.extend(chunk)
        return bytes(buf)
    if hasattr(content, "__iter__"):
        for chunk in content:
            buf.extend(chunk)
        return bytes(buf)
    # Explicit contract: an unsupported body type would otherwise reach curl_cffi
    # and surface as a cryptic error. Fail clearly instead.
    raise TypeError(f"_materialize: unsupported content type {type(content).__name__!r}")


class _StreamedResponse:
    """Wraps a live curl_cffi streamed response in the shape ``stream_post_with_size_cap`` needs."""

    def __init__(self, curl_resp: Any, url: str) -> None:
        self._r = curl_resp
        self.status_code: int = curl_resp.status_code
        self.headers = curl_resp.headers
        # Downstream rebuilds httpx.Response(request=...); give it a real one.
        self.request = httpx.Request("POST", url)

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            resp = httpx.Response(
                status_code=self.status_code,
                headers=_strip(self.headers),
                request=self.request,
            )
            raise httpx.HTTPStatusError(
                f"Server error '{self.status_code}' for url '{self.request.url}'",
                request=self.request,
                response=resp,
            )

    async def aiter_bytes(self) -> AsyncIterator[bytes]:
        async for chunk in self._r.aiter_content():
            yield chunk


class _StreamCtx:
    """Async context manager mirroring ``httpx.AsyncClient.stream(...)``."""

    def __init__(self, client: CurlCffiAsyncClient, method: str, url: str, kwargs: dict[str, Any]):
        self._client = client
        self._method = method
        self._url = url
        self._kwargs = kwargs
        self._cm: Any = None

    async def __aenter__(self) -> _StreamedResponse:
        from curl_cffi.requests import RequestsError

        self._cm = self._client._curl.stream(self._method, self._url, **self._kwargs)
        try:
            curl_resp = await self._cm.__aenter__()
        except RequestsError as exc:  # transport failure -> httpx.RequestError for the mapper
            # __aexit__ is NOT auto-called when __aenter__ raises, so close the
            # curl stream handle ourselves before re-raising.
            try:
                await self._cm.__aexit__(type(exc), exc, exc.__traceback__)
            except Exception:  # noqa: BLE001 — cleanup must not mask the original error
                pass
            raise httpx.RequestError(
                str(exc), request=httpx.Request(self._method, self._url)
            ) from exc
        return _StreamedResponse(curl_resp, self._url)

    async def __aexit__(self, *exc: object) -> None:
        try:
            if self._cm is not None:
                await self._cm.__aexit__(*exc)
        finally:
            self._client._sync_cookies_back()


class CurlCffiAsyncClient:
    """Minimal ``httpx.AsyncClient`` look-alike backed by ``curl_cffi.AsyncSession``."""

    def __init__(
        self,
        *,
        headers: Mapping[str, str] | None = None,
        cookies: httpx.Cookies | CookieJar | None = None,
        timeout: Any = None,
        follow_redirects: bool = True,
        limits: Any = None,  # noqa: ARG002 — accepted for httpx parity; curl_cffi pools internally
        impersonate: str | None = None,
    ) -> None:
        from curl_cffi.requests import AsyncSession

        # Match httpx.AsyncClient's cookie semantics: copy the caller's cookies
        # into our own httpx.Cookies jar so server Set-Cookie (rotated PSIDTS etc.)
        # never mutates the caller's jar — the runtime re-syncs rotations via
        # ``auth.cookie_jar = client.cookies``. ``httpx.Cookies(...)`` copies an
        # httpx.Cookies, wraps a raw http.cookiejar.CookieJar, and accepts None.
        self.cookies = httpx.Cookies(cookies)
        self._follow_redirects = follow_redirects
        self._timeout = _to_curl_timeout(timeout)
        # ``Any`` so it satisfies curl_cffi's ``impersonate: Literal[...]`` param
        # whether or not curl_cffi's stubs are installed — avoids a `type: ignore`
        # that mypy flags as unused in the (no-impersonate-extra) CI type-check.
        impersonate_value: Any = impersonate or os.environ.get(
            "NOTEBOOKLM_IMPERSONATE", DEFAULT_IMPERSONATE
        )
        self._curl: Any = AsyncSession(
            headers=dict(headers) if headers else None,
            cookies=self.cookies.jar,
            impersonate=impersonate_value,
        )

    def _sync_cookies_back(self) -> None:
        """Merge server Set-Cookie (rotated PSIDTS etc.) back into the httpx jar."""
        for cookie in self._curl.cookies.jar:
            self.cookies.jar.set_cookie(cookie)

    def _redirects(self, kwargs: dict[str, Any]) -> bool:
        # httpx callers may pass ``follow_redirects`` per-request; curl_cffi uses
        # ``allow_redirects``. Translate so secondary auth clients work verbatim.
        return bool(kwargs.pop("follow_redirects", self._follow_redirects))

    def _timeout_for(self, kwargs: dict[str, Any]) -> Any:
        # Fall back to the session default ONLY when the caller omitted timeout;
        # an explicit ``timeout=0``/``None`` is honored (httpx treats those as
        # immediate / no-timeout, not "use default").
        if "timeout" not in kwargs:
            return self._timeout
        return _to_curl_timeout(kwargs.pop("timeout"))

    async def get(self, url: str, **kwargs: Any) -> httpx.Response:
        from curl_cffi.requests import RequestsError

        allow_redirects = self._redirects(kwargs)
        timeout = self._timeout_for(kwargs)
        try:
            r = await self._curl.get(
                url,
                allow_redirects=allow_redirects,
                timeout=timeout,
                **kwargs,
            )
        except RequestsError as exc:
            raise httpx.RequestError(str(exc), request=httpx.Request("GET", url)) from exc
        self._sync_cookies_back()
        # curl_cffi .content is already decoded; build a real httpx.Response so
        # callers get .text/.url/.raise_for_status() unchanged.
        return httpx.Response(
            status_code=r.status_code,
            headers=_strip(r.headers),
            content=r.content,
            request=httpx.Request("GET", r.url),
        )

    async def post(
        self,
        url: str,
        *,
        headers: Mapping[str, str] | None = None,
        content: Any = None,
        **kwargs: Any,
    ) -> httpx.Response:
        from curl_cffi.requests import RequestsError

        body = await _materialize(content)
        allow_redirects = self._redirects(kwargs)
        timeout = self._timeout_for(kwargs)
        try:
            r = await self._curl.post(
                url,
                headers=dict(headers) if headers else None,
                data=body,
                allow_redirects=allow_redirects,
                timeout=timeout,
                **kwargs,
            )
        except RequestsError as exc:
            raise httpx.RequestError(str(exc), request=httpx.Request("POST", url)) from exc
        self._sync_cookies_back()
        # Preserve response headers (e.g. ``x-goog-upload-url``); only strip the
        # decode-confusing ones, same as ``.get()``.
        return httpx.Response(
            status_code=r.status_code,
            headers=_strip(r.headers),
            content=r.content,
            # Use the final (post-redirect) URL, consistent with ``get()``.
            request=httpx.Request("POST", r.url),
        )

    def stream(self, method: str, url: str, **kwargs: Any) -> _StreamCtx:
        stream_kwargs: dict[str, Any] = {
            "allow_redirects": self._redirects(kwargs),
            "timeout": self._timeout_for(kwargs),
        }
        # Map httpx's stream kwargs onto curl_cffi's: body content + headers.
        # NOTE: ``content`` must be bytes here — curl_cffi's stream ``data=`` can't
        # consume a (async) generator. A streamed body goes through ``post()``
        # (which buffers via ``_materialize``); the kernel's RPC stream is bytes.
        if "content" in kwargs:
            stream_kwargs["data"] = kwargs.pop("content")
        if kwargs.get("headers"):
            stream_kwargs["headers"] = dict(kwargs.pop("headers"))
        stream_kwargs.update(kwargs)
        return _StreamCtx(self, method, url, stream_kwargs)

    async def aclose(self) -> None:
        await self._curl.close()

    async def __aenter__(self) -> CurlCffiAsyncClient:
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.aclose()


def make_curl_cffi_factory(impersonate: str | None = None) -> Any:
    """Return an ``async_client_factory`` that builds :class:`CurlCffiAsyncClient`."""

    def factory(**kwargs: Any) -> CurlCffiAsyncClient:
        return CurlCffiAsyncClient(impersonate=impersonate, **kwargs)

    return factory


def resolve_transport_factory() -> Any:
    """Pick the HTTP client factory for the current transport opt-in.

    The single source of truth for ``NOTEBOOKLM_TRANSPORT=curl_cffi``: returns the
    curl_cffi factory when set, else ``httpx.AsyncClient``. Used by every
    authenticated-Google client site (main RPC kernel, upload, account, refresh) so
    the whole API surface shares ONE TLS fingerprint.

    ``httpx.AsyncClient`` is resolved at CALL time (not bound as a default arg) so
    tests that ``patch("httpx.AsyncClient")`` still intercept the opt-out path.

    NOTE: importing this module does not import curl_cffi — that happens lazily only
    when the returned factory is actually called, so the opt-out path stays pure-httpx
    with no hard dependency.

    Deliberate exception: artifact downloads stay on httpx even under the opt-in. They
    target signed ``googleusercontent`` URLs (a CDN host, not the authenticated API
    surface) and rely on httpx response ``event_hooks`` for the #1521 redirect-host
    SSRF revalidation, which curl_cffi's internal redirect handling can't replicate
    without disabling redirects. Fingerprint cosmetics there aren't worth dropping the
    SSRF guard.
    """
    if os.environ.get("NOTEBOOKLM_TRANSPORT") == "curl_cffi":
        return make_curl_cffi_factory()
    return httpx.AsyncClient
