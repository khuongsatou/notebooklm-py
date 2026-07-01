# 01. Tổng quan kiến trúc NotebookLM Pro

## Mục tiêu hệ thống

Repo này là thư viện Python không chính thức để tự động hóa Google NotebookLM qua các API nội bộ. Hệ thống cung cấp ba bề mặt sử dụng chính:

| Bề mặt | Thư mục | Vai trò | Đầu vào chính | Đầu ra chính |
| --- | --- | --- | --- | --- |
| Python API | `src/notebooklm/client.py` và các module `_*.py` | Tích hợp trong ứng dụng async Python | `AuthTokens`, `notebook_id`, `source_id`, prompt, option | Dataclass typed như `Notebook`, `Source`, `AskResult`, `Artifact` |
| CLI | `src/notebooklm/cli/` | Tự động hóa qua terminal, script, CI | Click args/options, stdin, file path | Text, JSON envelope, exit code |
| MCP | `src/notebooklm/mcp/` | Công cụ cho agent/LLM client | Tool arguments | Dict JSON-like hoặc lỗi MCP |
| REST | `src/notebooklm/server/` | Server HTTP single-tenant | JSON body, path param, multipart upload | HTTP JSON, pending job, file download |

## Sơ đồ phân lớp

```text
----------------+   +----------------+   +----------------+
| CLI / Click    |   | MCP / FastMCP   |   | REST / FastAPI |
+----------------+   +----------------+   +----------------+
          \                  |                  /
           \                 |                 /
            +----------------+----------------+
                             |
                             v
              src/notebooklm/_app/
      Logic trung lập: validate, resolve, plan, wait, render trạng thái
                             |
                             v
              NotebookLMClient + feature APIs
     notebooks, sources, artifacts, chat, notes, mind_maps,
     research, settings, sharing, labels
                             |
                             v
              Runtime + RpcExecutor + Middleware
     lifecycle, auth refresh, retry, semaphore, drain, metrics
                             |
                             v
              RPC encoder/decoder + HTTP transport
```

## Điểm thiết kế cốt lõi

| Chủ đề | Cách làm trong repo | Điểm hay |
| --- | --- | --- |
| Composition root | `NotebookLMClient.__init__` giao toàn bộ wiring cho `_assemble_client()` | Một nơi duy nhất nối runtime, API, uploader, note service, polling; tránh test factory và production bị lệch |
| App layer trung lập | `_app/*` không import Click/FastMCP/FastAPI | CLI, MCP, REST dùng chung rule validate/resolve/wait; giảm bug khác nhau giữa các adapter |
| Feature API hẹp | Mỗi API nhận `RpcCaller` hoặc collaborator thật sự cần | Không truyền object quá rộng; dễ test và ít coupling |
| RPC pipeline thống nhất | Hầu hết RPC đi qua `RpcExecutor.rpc_call()` | Cùng auth, retry, metrics, idempotency, decode drift handling |
| Chat pipeline riêng | `ChatAPI.ask()` dùng endpoint streamed `GenerateFreeFormStreamed` | Phù hợp streaming chat, parser riêng cho citations/conversation |
| Upload/download tách riêng | File upload dùng Scotty resumable upload; media download dùng `httpx.AsyncClient` riêng | Không ép non-RPC HTTP vào batchexecute, kiểm soát cookie và trusted host tốt hơn |
| Loop affinity | Client bind với event loop khi open | Tránh lock/semaphore/httpx pool bị dùng nhầm loop và treo khó debug |
| Idempotency policy | `_idempotency.py` và `_idempotency_policy.py` | Phân biệt read, set-state, create có probe, non-idempotent; tránh retry gây nhân đôi side effect |

## Các domain chức năng

| Domain | Module chính | Chức năng |
| --- | --- | --- |
| Notebook | `_notebooks.py` | List/create/get/delete/rename, summary, metadata, prompt suggestions |
| Source | `_sources.py`, `_source/*` | Add URL/YouTube/text/file/Drive, list/get/delete/rename/refresh, fulltext, guide, wait |
| Chat | `_chat/api.py`, `_chat/wire.py` | Ask, conversation history, configure persona/goal/length, save answer as note |
| Artifact | `_artifacts.py`, `_artifact/*` | Generate/list/poll/download/delete/rename/export audio, video, report, quiz, flashcards, infographic, slide deck, data table, mind map |
| Research | `_research.py`, `_app/source_research.py` | Web/Drive fast/deep research, poll, wait, import sources |
| Notes | `_notes.py`, `_note_service.py` | List/create/update/delete notes, note rows shared with mind maps |
| Mind maps | `_mind_maps_api.py`, `_mind_map.py` | Unified API cho note-backed và interactive studio mind map |
| Labels | `_labels.py`, `_label/params.py` | AI/group labels, manual labels, membership source |
| Sharing | `_sharing.py` | Public link, view level, add/update/remove users |
| Settings | `_settings.py` | Output language, account limits, tier signal |

## Luồng request chuẩn

```text
Người dùng / agent
  -> CLI/MCP/REST/Python API
  -> optional _app plan/validation/resolve
  -> client.<feature>.<method>()
  -> RpcExecutor hoặc custom flow
  -> RuntimeTransport.perform_authed_post()
  -> Middleware chain
  -> Kernel.post()
  -> Google NotebookLM internal API
  -> decoder/parser
  -> typed result / JSON envelope / file output
```

## Ranh giới quan trọng

| Ranh giới | Quy tắc |
| --- | --- |
| `_app/` | Không phụ thuộc framework vận chuyển; chỉ dùng exception public và dataclass kế hoạch/kết quả |
| `cli/` | Chỉ render, parse option, gọi app/client; chịu trách nhiệm exit code |
| `mcp/` | Tool mỏng, có confirm preview cho destructive action |
| `server/` | Single-tenant, bearer auth, tắt docs/openapi public, route mỏng |
| `rpc/` | Nguồn sự thật cho method ID, encode/decode, safe index |
| `_types/` | Dataclass/enum typed cho kết quả public |

