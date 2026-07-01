# 02. Runtime, RPC, auth và middleware pipeline

## Pipeline RPC batchexecute

```text
Feature API
  -> RpcExecutor.rpc_call(method, params)
  -> resolve idempotency policy
  -> resolve RPC id override
  -> encode_rpc_request()
  -> build_url() + build_request_body()
  -> RuntimeTransport.perform_authed_post()
  -> Middleware chain
  -> Kernel.post()
  -> decode_response()
  -> typed parser ở feature API
```

## Thành phần runtime

| Thành phần | File | Trách nhiệm | Đầu vào | Đầu ra |
| --- | --- | --- | --- | --- |
| `NotebookLMClient` | `client.py` | Public async client, context manager, feature namespace | `AuthTokens`, timeout, limits, keepalive, retry config | Client đã open/close được, `.notebooks`, `.sources`, `.chat`, ... |
| `_assemble_client()` | `_client_assembly.py` | Nối toàn bộ collaborator và feature API | Constructor args | Gán `_collaborators`, `_rpc_executor`, APIs |
| `ClientComposed` | `_client_composed.py` | Holder cho transport, executor, chain, semaphore RPC | `max_concurrent_rpcs` | Semaphore/context quản lý fan-out |
| `RuntimeCollaborators` | `_runtime/init.py` | Bundle runtime: metrics, drain, reqid, auth, kernel, lifecycle, cookies | Auth/config | Các collaborator dùng chung |
| `RpcExecutor` | `_rpc_executor.py` | Encode, dispatch, decode, retry decode-time auth | `RPCMethod`, `params` | Raw decoded result hoặc exception typed |
| `RuntimeTransport` | `_runtime/transport.py` | Authed POST entrypoint và chain leaf | Build request closure, auth snapshot | `httpx.Response` |
| `Kernel` | `_kernel.py` | Sở hữu `httpx.AsyncClient`, post/close | URL, headers, body | HTTP response |

## Middleware chain

Theo `docs/architecture.md`, chain ADR-0009 có thứ tự:

| Thứ tự | Middleware | Vai trò |
| --- | --- | --- |
| 1 | Drain | Chặn operation mới khi đang close/drain, đếm in-flight |
| 2 | Metrics | Đo latency, success/failure, queue wait |
| 3 | Semaphore | Giới hạn concurrent RPC |
| 4 | Retry | Retry HTTP 429, 5xx, network theo backoff |
| 5 | AuthRefresh | Refresh cookie/token khi auth expired |
| 6 | ErrorInjection | Test seam cho lỗi synthetic |
| 7 | Tracing | Gắn log/context request |
| Leaf | RuntimeTransport.terminal | Fresh auth rebuild rồi `Kernel.post()` |

## Encode request

| Bước | File | Chi tiết |
| --- | --- | --- |
| Chọn method | `rpc/types.py` | `RPCMethod` chứa id obfuscated như `CREATE_ARTIFACT = "R7cb6c"` |
| Encode params | `rpc/encoder.py` | `params` được JSON compact rồi bọc `[[[rpc_id, json_params, None, "generic"]]]` |
| Body form | `rpc/encoder.py` | `f.req=<urlencoded json>&at=<csrf>&` |
| URL | `_rpc_executor.py` + `rpc/types.py` | Batchexecute URL, `rpcids`, `f.sid`, `hl`, `_reqid`, `authuser` |

## Decode response

| Bước | File | Chi tiết |
| --- | --- | --- |
| Strip anti-XSSI | `rpc/decoder.py` | Bỏ tiền tố `)]}'` |
| Parse chunk | `rpc/decoder.py` | Đọc format alternating byte count + JSON payload |
| Tìm RPC id | `collect_rpc_ids`, `extract_rpc_result` | Lọc `wrb.fr` frame đúng method |
| Parse lỗi | `RPCErrorCode`, gRPC status | Chuyển thành `AuthError`, `RateLimitError`, `ServerError`, `UnknownRPCMethodError`, ... |
| Drift signal | `safe_index`, `rpc_decode_errors` | Fail loud khi Google đổi shape |

## Auth và cookie lifecycle

| Chức năng | File | Ghi chú |
| --- | --- | --- |
| Load auth từ storage | `NotebookLMClient.from_storage()`, `auth.py`, `_auth/storage.py` | Canonical path cho CLI/API |
| Refresh auth | `_runtime/auth.py`, `_auth/refresh.py` | Single-flight refresh, mutation cùng `AuthTokens` object |
| Keepalive | `_auth/keepalive.py`, `_runtime/lifecycle.py` | Poke để cookie `__Secure-1PSIDTS` xoay trong session dài |
| Cookie save | `_cookie_persistence.py` | Ghi storage state khi close/refresh |
| Auth snapshot | `_request_types.py`, `_runtime/auth.py` | URL/body/header được build từ snapshot hiện tại |
| Fresh rebuild | `RuntimeTransport.refresh_request_for_current_auth()` | Rebuild envelope ngay trước POST để tránh stale auth khi retry |

## Idempotency và retry

| Loại operation | Cách xử lý |
| --- | --- |
| Read-only | Có thể retry nội bộ |
| Set-state idempotent | Có thể retry vì cùng trạng thái cuối |
| Create có probe | Disable retry ở RPC layer, wrapper tự probe rồi quyết định |
| Non-idempotent | Không retry tự động để tránh nhân đôi side effect |

Ví dụ:

| Flow | Policy thực tế |
| --- | --- |
| `sources.add_url` | `idempotent_create()` với probe qua `sources.list()` match URL |
| `sources.add_drive` | Probe source URL chứa `/d/<file_id>` |
| `sources.add_text` | Không idempotent vì title không unique và content không có key ổn định |
| `labels.add_sources` | Mỗi source id là một `UPDATE_LABEL`, non-atomic và non-idempotent retry |

## Điểm hay

| Điểm hay | Vì sao đáng giá |
| --- | --- |
| Fresh-auth rebuild tại terminal | Giải quyết race refresh 401 rồi 429 retry dùng envelope cũ |
| Loop affinity fail-fast | Lỗi cross-loop lộ sớm thay vì treo trong lock/httpx |
| Semaphore RPC riêng | Back-pressure rõ ràng trước khi pool connection bị nghẽn |
| Metrics callback | App ngoài có thể đẩy telemetry mà repo không phụ thuộc Prometheus/OpenTelemetry |
| `safe_index` có `method_id/source` | Khi schema Google đổi, log/lỗi chỉ đúng vị trí hỏng |
| Decode drift counter | Có chỉ số riêng cho wire/schema drift, không lẫn với network/server fault |

