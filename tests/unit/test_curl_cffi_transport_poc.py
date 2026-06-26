"""PoC proof for the curl_cffi httpx-compat adapter (docs/notes/curl-cffi-investigation.md).

Drives ``CurlCffiAsyncClient`` against a local stdlib HTTP server to prove the
contract the transport kernel relies on, end-to-end, without Google auth:

* ``.get()`` returns a real ``httpx.Response`` (``.text``/``.url``/``.raise_for_status``);
* server ``Set-Cookie`` round-trips back into the authoritative ``httpx.Cookies`` jar
  AND is re-sent on the next request (the PSIDTS-rotation-critical path);
* ``stream_post_with_size_cap`` works verbatim over the adapter's ``.stream()``;
* a 5xx maps through ``raise_mapped_post_error`` to ``TransportServerError``;
* the ``NOTEBOOKLM_TRANSPORT=curl_cffi`` env seam selects the adapter.
"""

from __future__ import annotations

import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import httpx
import pytest

pytest.importorskip("curl_cffi", reason="requires the optional [impersonate] extra")

from notebooklm._curl_cffi_transport import CurlCffiAsyncClient  # noqa: E402
from notebooklm._streaming_post import stream_post_with_size_cap  # noqa: E402
from notebooklm._transport_errors import (  # noqa: E402
    TransportServerError,
    raise_mapped_post_error,
)

# No module-level asyncio mark: the project runs ``asyncio_mode = "auto"`` so async
# tests are collected automatically, and a blanket mark would wrongly tag the sync
# pure-logic tests below.


class _Handler(BaseHTTPRequestHandler):
    def log_message(self, *_a):  # silence test server
        pass

    def _seen_cookie(self) -> str:
        return self.headers.get("Cookie", "")

    def do_GET(self):  # noqa: N802
        if self.path == "/boom":
            self.send_response(500)
            self.end_headers()
            self.wfile.write(b"kaboom")
            return
        if self.path == "/redirect":
            self.send_response(302)
            self.send_header("Location", "/")
            self.end_headers()
            return
        body = f"token=ABC123 cookie_seen={self._seen_cookie()}".encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.send_header("Set-Cookie", "ROTATED=newval; Path=/")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):  # noqa: N802
        length = int(self.headers.get("Content-Length", 0))
        data = self.rfile.read(length)
        if self.path == "/boom":
            self.send_response(503)
            self.end_headers()
            self.wfile.write(b"unavailable")
            return
        body = b"echo:" + data
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


@pytest.fixture
def server():
    httpd = HTTPServer(("127.0.0.1", 0), _Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    host, port = httpd.server_address
    try:
        yield f"http://{host}:{port}"
    finally:
        # Fully tear down: stop the loop, join the thread, close the socket —
        # otherwise handles/threads leak across the per-test servers (flaky on Windows).
        httpd.shutdown()
        thread.join(timeout=5)
        httpd.server_close()


async def test_get_returns_httpx_response_and_round_trips_cookies(server):
    client = CurlCffiAsyncClient(headers={"X-Test": "1"}, cookies=httpx.Cookies())
    try:
        r1 = await client.get(f"{server}/")
        assert isinstance(r1, httpx.Response)
        assert r1.status_code == 200
        assert "token=ABC123" in r1.text
        assert str(r1.url).endswith("/")
        # Server's Set-Cookie landed in the authoritative httpx jar.
        assert client.cookies.get("ROTATED") == "newval"
        # ...and is re-sent on the next request (PSIDTS-rotation path).
        r2 = await client.get(f"{server}/")
        assert "ROTATED=newval" in r2.text
    finally:
        await client.aclose()


async def test_stream_post_with_size_cap_works_over_adapter(server):
    client = CurlCffiAsyncClient(cookies=httpx.Cookies())
    try:
        resp = await stream_post_with_size_cap(
            client, f"{server}/rpc", body=b"payload", headers={"Content-Type": "text/plain"}
        )
        assert isinstance(resp, httpx.Response)
        assert resp.status_code == 200
        assert resp.content == b"echo:payload"
    finally:
        await client.aclose()


async def test_server_error_maps_to_transport_server_error(server):
    import logging

    client = CurlCffiAsyncClient(cookies=httpx.Cookies())
    try:
        with pytest.raises(TransportServerError):
            try:
                await stream_post_with_size_cap(client, f"{server}/boom", body=b"x", headers=None)
            except httpx.HTTPStatusError as exc:
                raise_mapped_post_error(
                    log_label="poc", exc=exc, start=0.0, logger=logging.getLogger("poc")
                )
    finally:
        await client.aclose()


def test_to_curl_timeout_preserves_connect_and_read():
    """httpx.Timeout's connect+read map to curl_cffi's (connect, read) tuple."""
    from notebooklm._curl_cffi_transport import _to_curl_timeout

    assert _to_curl_timeout(None) is None
    assert _to_curl_timeout(30.0) == 30.0
    assert _to_curl_timeout(httpx.Timeout(connect=10.0, read=60.0, write=5.0, pool=5.0)) == (
        10.0,
        60.0,
    )
    # read-only Timeout collapses to the single read float.
    assert _to_curl_timeout(httpx.Timeout(None, read=45.0)) == 45.0


async def test_get_follows_real_redirect_with_per_request_kwargs_and_raw_jar(server):
    """Secondary auth clients pass a raw CookieJar + per-request follow_redirects/timeout.

    Hits a real 302 so a broken ``_redirects()`` translation (httpx
    ``follow_redirects`` -> curl ``allow_redirects``) actually fails the test.
    """
    from http.cookiejar import CookieJar

    client = CurlCffiAsyncClient(cookies=CookieJar())  # raw jar, not httpx.Cookies
    try:
        r = await client.get(
            f"{server}/redirect", follow_redirects=True, timeout=httpx.Timeout(5.0, read=10.0)
        )
        assert r.status_code == 200  # followed 302 -> / (200), not the raw redirect
        assert "token=ABC123" in r.text  # body of the final page
        assert str(r.url).endswith("/")  # final URL after the hop
        assert isinstance(client.cookies, httpx.Cookies)
        assert client.cookies.get("ROTATED") == "newval"
    finally:
        await client.aclose()


async def test_post_returns_httpx_response_and_echoes_body(server):
    """`.post()` buffers the body, returns an httpx.Response, preserves headers."""
    client = CurlCffiAsyncClient(cookies=httpx.Cookies())
    try:
        r = await client.post(f"{server}/rpc", headers={"X-T": "1"}, content=b"hello")
        assert isinstance(r, httpx.Response)
        assert r.status_code == 200
        assert r.content == b"echo:hello"
    finally:
        await client.aclose()


async def test_transport_error_maps_to_httpx_request_error():
    """A connection failure surfaces as httpx.RequestError (what the mapper expects)."""
    # 127.0.0.1:1 is almost certainly closed -> curl_cffi RequestsError -> httpx.RequestError.
    client = CurlCffiAsyncClient(cookies=httpx.Cookies(), timeout=2.0)
    try:
        with pytest.raises(httpx.RequestError):
            await client.get("http://127.0.0.1:1/")
        with pytest.raises(httpx.RequestError):
            await client.post("http://127.0.0.1:1/", content=b"x")
    finally:
        await client.aclose()


async def test_materialize_body_types():
    """_materialize handles bytes/str/None/async-iter/sync-iter/BytesIO and rejects the rest."""
    import io

    from notebooklm._curl_cffi_transport import _materialize

    async def agen():
        yield b"ab"
        yield b"cd"

    assert await _materialize(b"x") == b"x"
    assert await _materialize(None) is None
    assert await _materialize("hi") == b"hi"
    assert await _materialize(agen()) == b"abcd"
    assert await _materialize([b"a", b"b"]) == b"ab"
    assert await _materialize(io.BytesIO(b"zz")) == b"zz"
    with pytest.raises(TypeError):
        await _materialize(12345)


async def test_resolve_transport_factory_curl_and_unknown(monkeypatch):
    """resolve_transport_factory: curl_cffi when opted in, httpx default, raise on typo."""
    from notebooklm._curl_cffi_transport import resolve_transport_factory

    monkeypatch.delenv("NOTEBOOKLM_TRANSPORT", raising=False)
    assert resolve_transport_factory() is httpx.AsyncClient

    monkeypatch.setenv("NOTEBOOKLM_TRANSPORT", "curl_cffi")
    factory = resolve_transport_factory()
    inst = factory(cookies=httpx.Cookies())
    try:
        assert isinstance(inst, CurlCffiAsyncClient)
    finally:
        await inst.aclose()

    monkeypatch.setenv("NOTEBOOKLM_TRANSPORT", "curlcffi")  # typo
    with pytest.raises(ValueError, match="Unknown NOTEBOOKLM_TRANSPORT"):
        resolve_transport_factory()


async def test_timeout_for_honors_explicit_falsy_and_defaults_when_absent():
    """An explicit per-request timeout=0/None is preserved; only an absent one defaults."""
    client = CurlCffiAsyncClient(timeout=30.0)
    try:
        assert client._timeout_for({}) == 30.0  # absent -> session default
        assert client._timeout_for({"timeout": 0}) == 0  # explicit immediate, not default
        assert client._timeout_for({"timeout": None}) is None  # explicit no-timeout
    finally:
        await client.aclose()


async def test_caller_cookies_jar_is_not_mutated():
    """Adapter copies cookies (like httpx.AsyncClient) so the caller's jar is untouched."""
    caller = httpx.Cookies()
    caller.set("SID", "x", domain="example.com")
    client = CurlCffiAsyncClient(cookies=caller)
    try:
        assert client.cookies.jar is not caller.jar  # copied, not aliased
        assert client.cookies.get("SID") == "x"  # contents preserved
    finally:
        await client.aclose()


async def test_env_seam_selects_curl_cffi_factory(monkeypatch):
    from notebooklm._runtime.init import _resolve_async_client_factory

    monkeypatch.setenv("NOTEBOOKLM_TRANSPORT", "curl_cffi")
    factory = _resolve_async_client_factory(None)
    inst = factory(
        headers={}, cookies=httpx.Cookies(), timeout=None, follow_redirects=True, limits=None
    )
    try:
        assert isinstance(inst, CurlCffiAsyncClient)
    finally:
        await inst.aclose()
