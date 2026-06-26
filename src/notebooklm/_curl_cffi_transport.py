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
``httpx.Timeout`` is collapsed to a single read window; gzip handling assumes
``aiter_content``/``content`` yield already-decoded bytes (true for libcurl's
auto-decompress — verify against real gzip'd RPC before production).
"""

from __future__ import annotations

import os
from typing import TYPE_CHECKING, Any

import httpx

if TYPE_CHECKING:
    from collections.abc import AsyncIterator, Mapping

DEFAULT_IMPERSONATE = "chrome"

# Headers that must not survive onto a Response rebuilt from already-decoded
# bytes — same rationale as ``_streaming_post._STRIP_HEADERS_ON_REBUFFER``.
_STRIP_HEADERS = frozenset({"content-encoding", "content-length"})


def _to_read_timeout(timeout: Any) -> float | None:
    """Collapse an httpx.Timeout (or float/None) to a single read-window float."""
    if timeout is None or isinstance(timeout, (int, float)):
        return timeout
    # httpx.Timeout — the read (inactivity) slot is what matters for RPC.
    return timeout.read if timeout.read is not None else timeout.connect


def _strip(headers: Mapping[str, str]) -> dict[str, str]:
    return {k: v for k, v in headers.items() if k.lower() not in _STRIP_HEADERS}


async def _materialize(content: Any) -> bytes | None:
    """Collapse an httpx-style request body (bytes / sync- or async-iterable) to bytes.

    ponytail: buffers the whole body — fine for the PoC's small test files; a
    production version would stream into curl_cffi's upload API instead.
    """
    if content is None or isinstance(content, (bytes, bytearray)):
        return bytes(content) if content is not None else None
    if isinstance(content, str):
        return content.encode()
    buf = bytearray()
    if hasattr(content, "__aiter__"):
        async for chunk in content:
            buf.extend(chunk)
        return bytes(buf)
    if hasattr(content, "__iter__"):
        for chunk in content:
            buf.extend(chunk)
        return bytes(buf)
    return content


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

        try:
            self._cm = self._client._session.stream(self._method, self._url, **self._kwargs)
            curl_resp = await self._cm.__aenter__()
        except RequestsError as exc:  # transport failure -> httpx.RequestError for the mapper
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
        cookies: httpx.Cookies | None = None,
        timeout: Any = None,
        follow_redirects: bool = True,
        limits: Any = None,  # noqa: ARG002 — accepted for httpx parity; curl_cffi pools internally
        impersonate: str | None = None,
    ) -> None:
        from curl_cffi.requests import AsyncSession

        # Keep httpx.Cookies as the authoritative in-memory jar (the auth layer
        # depends on it); hand curl_cffi the underlying stdlib CookieJar.
        self.cookies: httpx.Cookies = cookies if cookies is not None else httpx.Cookies()
        self._follow_redirects = follow_redirects
        self._read_timeout = _to_read_timeout(timeout)
        self._session: Any = AsyncSession(
            headers=dict(headers) if headers else None,
            cookies=self.cookies.jar,
            impersonate=impersonate
            or os.environ.get("NOTEBOOKLM_IMPERSONATE", DEFAULT_IMPERSONATE),  # type: ignore[arg-type]
        )

    def _sync_cookies_back(self) -> None:
        """Merge server Set-Cookie (rotated PSIDTS etc.) back into the httpx jar."""
        for cookie in self._session.cookies.jar:
            self.cookies.jar.set_cookie(cookie)

    async def get(self, url: str, **kwargs: Any) -> httpx.Response:
        from curl_cffi.requests import RequestsError

        try:
            r = await self._session.get(
                url,
                allow_redirects=self._follow_redirects,
                timeout=self._read_timeout,
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
        try:
            r = await self._session.post(
                url,
                headers=dict(headers) if headers else None,
                data=body,
                allow_redirects=self._follow_redirects,
                timeout=self._read_timeout,
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
            request=httpx.Request("POST", url),
        )

    def stream(self, method: str, url: str, **kwargs: Any) -> _StreamCtx:
        stream_kwargs: dict[str, Any] = {
            "allow_redirects": self._follow_redirects,
            "timeout": _to_read_timeout(kwargs.pop("timeout", None)) or self._read_timeout,
        }
        # Map httpx's stream kwargs onto curl_cffi's: body content + headers.
        if "content" in kwargs:
            stream_kwargs["data"] = kwargs.pop("content")
        if kwargs.get("headers"):
            stream_kwargs["headers"] = dict(kwargs.pop("headers"))
        stream_kwargs.update(kwargs)
        return _StreamCtx(self, method, url, stream_kwargs)

    async def aclose(self) -> None:
        await self._session.close()

    async def __aenter__(self) -> CurlCffiAsyncClient:
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.aclose()


def make_curl_cffi_factory(impersonate: str | None = None) -> Any:
    """Return an ``async_client_factory`` that builds :class:`CurlCffiAsyncClient`."""

    def factory(**kwargs: Any) -> CurlCffiAsyncClient:
        return CurlCffiAsyncClient(impersonate=impersonate, **kwargs)

    return factory
