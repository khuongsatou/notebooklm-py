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

pytestmark = pytest.mark.asyncio


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
        httpd.shutdown()


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
