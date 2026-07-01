# 07. CLI, MCP và REST adapter flow

## CLI

Entry point: `src/notebooklm/notebooklm_cli.py`.

```text
notebooklm <command>
  -> Click root group
  -> profile/storage/logging setup
  -> command module trong cli/*_cmd.py
  -> cli.auth_runtime.with_client()
  -> NotebookLMClient.from_storage()
  -> _app core hoặc client feature API
  -> renderer text/JSON + exit code
```

| Nhóm lệnh | Module | Chức năng chính |
| --- | --- | --- |
| Top-level notebook/session/chat | `notebook_cmd.py`, `session_cmd.py`, `chat_cmd.py` | login, auth check, use/status, create/list/delete, ask, suggest prompts |
| Source | `source_cmd.py`, `_source_render.py` | add/list/get/fulltext/guide/wait/clean/research |
| Generate/download/artifact | `generate_cmd.py`, `download_cmd.py`, `artifact_cmd.py` | tạo, poll, tải, đổi tên/xóa/export |
| Note | `note_cmd.py` | CRUD note |
| Label | `label_cmd.py` | label list/generate/create/membership |
| Share | `share_cmd.py` | public link, permission |
| Research | `research_cmd.py` | status/cancel/wait |
| Language/profile/skill/mcp/agent/doctor | các module tương ứng | cấu hình, skill install, health |

## CLI input/output contract

| Input | Cách xử lý |
| --- | --- |
| `--storage`, `--profile` | Resolve auth source/profile |
| `--json` | Byte-stable JSON success/error envelope |
| `--prompt-file` | Đọc prompt/query từ file hoặc stdin |
| `-` stdin | Dùng cho ask/source text/prompt |
| partial id | Resolve qua list và unique prefix |
| destructive action | Text mode hỏi confirm; JSON mode yêu cầu `--yes` hoặc auto yes tùy command |

| Output | Ghi chú |
| --- | --- |
| Text rich/plain | Dành cho người dùng terminal |
| JSON | Dành cho agent/script |
| Exit code 0 | Thành công |
| Exit code 1 | User/app error |
| Exit code 2 | System/unexpected error |
| Exit code 130 | SIGINT |

## MCP

Entry point: `src/notebooklm/mcp/server.py`.

```text
FastMCP server
  -> lifespan mở 1 NotebookLMClient theo profile
  -> register tool modules
  -> tool nhận notebook/source/artifact name hoặc id
  -> resolve id/prefix
  -> _app core hoặc client feature API
  -> dict JSON-like
```

| Tool domain | Module | Chức năng |
| --- | --- | --- |
| notebooks | `mcp/tools/notebooks.py` | list/create/get/delete/rename/metadata |
| sources | `mcp/tools/sources.py` | list/get content/describe/add/wait/delete/rename |
| chat | `mcp/tools/chat.py` | ask/history/configure |
| notes | `mcp/tools/notes.py` | note CRUD |
| artifacts | `mcp/tools/artifacts.py` | list/generate/poll/download/rename/delete |
| research | `mcp/tools/research.py` | start/status/wait/cancel/import |
| sharing | `mcp/tools/sharing.py` | share status/mutate |
| meta | `mcp/tools/meta.py` | auth/account/help metadata |

## MCP design notes

| Điểm | Ý nghĩa |
| --- | --- |
| Một client trong lifespan | Đúng loop-affinity và reuse cookie/connection |
| Tools nhận name hoặc id | Agent có thể dùng tên thân thiện, resolver xử lý prefix |
| Destructive confirm | Không confirm thì trả `needs_confirmation` preview |
| File transfer config optional | HTTP transport có thể dùng signed file URLs; stdio dùng path local |
| Error `CODE: message` | Dễ đọc trong MCP client/agent |

## REST

Entry point: `src/notebooklm/server/app.py`.

```text
FastAPI app
  -> lifespan mở 1 NotebookLMClient
  -> /healthz public
  -> /v1 auth-gated bằng bearer token + loopback host
  -> route module
  -> _app core hoặc client feature API
  -> JSON response hoặc file download
```

| Route domain | Module | Chức năng |
| --- | --- | --- |
| notebooks | `server/routes/notebooks.py` | list/get/create/delete |
| sources | `server/routes/sources.py` | list/get/add-url/add-text/add-file/delete |
| chat | `server/routes/chat.py` | ask |
| notes | `server/routes/notes.py` | list/get/create/update/delete |
| artifacts | `server/routes/artifacts.py` | list/generate/poll/download |
| share | `server/routes/share.py` | status/public/user/view level |

## REST safety

| Safety | Cách làm |
| --- | --- |
| Tắt `/docs`, `/redoc`, `/openapi.json` | Không lộ schema unauthenticated |
| `/healthz` tối giản | Chỉ trả `{"ok": true}`, không lộ account/version |
| `/v1` auth-gated | Bearer token + loopback host |
| Upload cap bằng Content-Length | Reject trước khi parse body lớn |
| Pending registry | Generate/download async có registry thay vì block route quá lâu |

## Adapter comparison

| Tiêu chí | CLI | MCP | REST |
| --- | --- | --- | --- |
| Đối tượng | Người dùng terminal, script | Agent/LLM tool client | Local automation HTTP |
| Auth | Storage/profile/env auth | Profile trong lifespan | Storage default trong lifespan |
| Output | Text/JSON/exit code | Tool result dict | HTTP JSON/status |
| Destructive guard | Prompt/`--yes` | `confirm=true` preview | HTTP status/error |
| File handling | Local path | Path hoặc signed route | Multipart/download route |
| Logic chung | `_app` + client | `_app` + client | `_app` + client |

