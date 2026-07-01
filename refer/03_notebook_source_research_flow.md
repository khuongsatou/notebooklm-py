# 03. Notebook, source và research flow

## Notebook API

| Chức năng | Method | Đầu vào | Pipeline | Đầu ra |
| --- | --- | --- | --- | --- |
| Liệt kê notebook | `client.notebooks.list()` | Không có | `LIST_NOTEBOOKS` -> parse row | `list[Notebook]` |
| Tạo notebook | `create(title)` | `title` | `CREATE_NOTEBOOK`, payload `[title, None, None, template_block]` | `Notebook` |
| Lấy notebook | `get(id)` | `notebook_id` | `GET_NOTEBOOK` -> row adapters | `Notebook`; missing raise `NotebookNotFoundError` |
| Lấy optional | `get_or_none(id)` | `notebook_id` | Như `get` nhưng miss -> `None` | `Notebook | None` |
| Xóa | `delete(id)` | `notebook_id` | `DELETE_NOTEBOOK` | `None` |
| Đổi tên | `rename(id, title)` | `notebook_id`, `new_title` | `RENAME_NOTEBOOK` | `Notebook`/status tùy app layer |
| Summary/description | `get_summary`, `get_description` | `notebook_id` | `SUMMARIZE` -> `_extract_summary`, `_extract_suggested_topics` | String hoặc `NotebookDescription` |
| Prompt suggestions | `suggest_prompts()` | `source_ids`, `mode`, `query` | `SUGGEST_PROMPTS` (`otmP3b`) | `list[PromptSuggestion]` |
| Metadata | `get_metadata()` | `notebook_id` | Notebook + sources + share URL | `NotebookMetadata` |

### Prompt suggestions

| Mode | Ý nghĩa surface |
| --- | --- |
| 1 | Audio Deep Dive |
| 2 | Audio Brief |
| 3 | Video Explainer |
| 4 | Chat questions mặc định |
| 5 | Audio Critique |
| 6 | Audio Debate |
| 7 | Chưa xác định |
| 8 | Quiz |
| 9 | Flashcards |
| 10 | Video Short |

Payload chính:

```text
[client_context, notebook_id, [[source_id], ...], mode, None, query]
```

Điểm hay: mode được validate trong range `1..10` trước khi gọi server, query rỗng được normalize về `None` để không gửi prompt trắng.

## Source API

| Chức năng | Method | Đầu vào | Pipeline | Đầu ra |
| --- | --- | --- | --- | --- |
| List | `sources.list(nb)` | `notebook_id`, `strict=False` | `GET_NOTEBOOK` hoặc lister row | `list[Source]` |
| Get | `sources.get(nb, src)` | `notebook_id`, `source_id` | list/find | `Source`; miss raise `SourceNotFoundError` |
| Wait ready | `wait_until_ready()` | `source_id`, timeout/backoff | Poll `get_or_none` đến READY/ERROR/timeout | `Source` ready |
| Wait registered | `wait_until_registered()` | `source_id` | Poll đến source xuất hiện và status hợp lệ | `Source` |
| Add URL | `add_url(nb, url, wait)` | URL/YouTube URL | Detect YouTube -> `ADD_SOURCE`, idempotent probe bằng URL | `Source` |
| Add text | `add_text(nb, title, content)` | title, content | `ADD_SOURCE` text payload | `Source` |
| Add file | `add_file(nb, path, mime_type)` | file path, title, progress callback | `ADD_SOURCE_FILE` register -> Scotty upload start/finalize -> optional rename/wait | `Source` |
| Add Drive | `add_drive(nb, file_id, title, mime_type)` | Drive id/title/mime | `ADD_SOURCE`, idempotent probe `/d/<file_id>` | `Source` |
| Delete | `delete(nb, src)` | `source_id` | `DELETE_SOURCE` | `None` |
| Rename | `rename(nb, src, title)` | `new_title` | `UPDATE_SOURCE` | `Source | None` |
| Refresh | `refresh(nb, src)` | `source_id` | `REFRESH_SOURCE` | `Source`/status |
| Freshness | `check_freshness(nb, src)` | `source_id` | `CHECK_SOURCE_FRESHNESS` | freshness info |
| Guide | `get_guide(nb, src)` | `source_id` | `GET_SOURCE_GUIDE` | `SourceGuide` |
| Fulltext | `get_fulltext(nb, src, format)` | `text` hoặc `markdown` | content renderer | `SourceFulltext` |

## Source add pipeline chi tiết

```text
URL/Text/Drive
  -> validate app/CLI/MCP flags
  -> SourceAddService
  -> build ADD_SOURCE params
  -> RpcExecutor
  -> optional wait_until_ready
```

```text
File
  -> validate path, size, supported type
  -> register file source qua ADD_SOURCE_FILE
  -> lấy source_id
  -> build Scotty resumable upload start request
  -> start upload bằng upload endpoint
  -> finalize upload
  -> optional wait/rename
```

Điểm hay:

| Điểm | Ý nghĩa |
| --- | --- |
| URL/Drive có probe idempotent | Nếu server đã commit nhưng client mất response, retry không tạo trùng |
| Text cố tình không idempotent | Tránh cam kết giả về dedupe khi không có key ổn định |
| Upload semaphore riêng | File upload có FD/network cost riêng, không tranh với RPC pool |
| Wait tách registered/ready | Rename/update chỉ cần registered; chat/generate cần ready |
| Fulltext/guide có dạng nhẹ | Agent có thể triage source trước khi kéo toàn bộ nội dung |

## Research API

| Chức năng | Method | Đầu vào | Pipeline | Đầu ra |
| --- | --- | --- | --- | --- |
| Start | `research.start(nb, query, source, mode)` | query, `source=web|drive`, `mode=fast|deep` | Validate -> `START_FAST_RESEARCH` hoặc `START_DEEP_RESEARCH` | `ResearchStart(task_id, report_id, query, mode)` |
| Poll | `research.poll(nb, task_id)` | optional task id | `POLL_RESEARCH` -> parser task model | `ResearchTask` |
| Wait | `wait_for_completion()` | task id, timeout, interval | Poll loop đến completed/failed/timeout | `ResearchTask` |
| Cancel | `cancel(nb, run_id)` | run/task id | `CANCEL_RESEARCH` | status |
| Import | `import_sources(nb, task_id, sources)` | selected sources | `IMPORT_RESEARCH` | imported source list |
| Import verify | `import_sources_with_verification()` | max elapsed/backoff | Import + baseline/list verification | imported + verified |

## `source add-research` app flow

```text
query
  -> validate flags (--import-all, --cited-only, --no-wait)
  -> research.start()
  -> nếu --no-wait: trả task id
  -> research.wait_for_completion(task_id)
  -> nếu completed và --import-all: import_sources()
  -> trả SourceAddResearchResult(outcome, sources, report, import_result)
```

| Outcome | Ý nghĩa |
| --- | --- |
| `started_no_wait` | Đã tạo task, không chờ |
| `completed` | Research hoàn thành, có thể có import result |
| `timeout` | Hết thời gian chờ |
| `failed` | Server báo lỗi |
| `no_research` | Không có task active |
| `unknown_status` | Status mới/chưa biết |

Điểm hay:

| Điểm | Ý nghĩa |
| --- | --- |
| Deep research dùng `report_id` cho poll/import | Tránh dùng slot task không ổn định |
| Ambiguous task raise lỗi | Không đoán nhầm task khi nhiều research chạy song song |
| `cited_only` dựa trên report URL extraction | Import nguồn thực sự được report cite |
| Importer injected vào `_app` | App layer không kéo dependency CLI/Rich |

