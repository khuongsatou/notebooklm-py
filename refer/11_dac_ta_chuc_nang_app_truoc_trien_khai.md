# 11. Đặc tả chức năng app trước khi triển khai

## Mục tiêu app

App nên là giao diện quản lý NotebookLM theo hướng operational tool: người dùng xem notebook, thêm nguồn, hỏi chat, tạo artifact, theo dõi job, tải/export kết quả và quản lý chia sẻ trong một nơi. Logic backend có thể gọi Python API, REST server, hoặc shell CLI, nhưng UX nên bám theo typed domain đã phân tích.

## Vai trò người dùng

| Vai trò | Nhu cầu chính | Chức năng ưu tiên |
| --- | --- | --- |
| Researcher | Thu thập nguồn, hỏi đáp, trích xuất insight | Notebook, source, chat, research, fulltext, notes |
| Content creator | Tạo audio/video/report/quiz/slide | Generate, artifact library, download/export |
| Knowledge manager | Tổ chức nguồn và chia sẻ | Labels, metadata, sharing, notes |
| Agent/power user | Tự động hóa, debug auth, profile | JSON status, auth health, profile, logs |

## Module app đề xuất

| Module | Màn hình | Chức năng sẽ có | Độ ưu tiên |
| --- | --- | --- | --- |
| Auth & Profile | Onboarding, Profile settings | login/check/refresh/logout, profile switch/list/create | P0 |
| Notebook Dashboard | Sidebar/list + detail | list/create/rename/delete/use/summary/metadata | P0 |
| Sources | Sources tab | add URL/text/file/Drive, list/filter label, get guide/fulltext, wait, refresh, delete, clean | P0 |
| Chat | Chat tab | ask, source filter, conversation history, configure persona/mode/length, save answer/history as note | P0 |
| Studio Generate | Generate panel | audio/video/report/quiz/flashcards/infographic/slide/data-table/mind-map | P0 |
| Artifact Library | Artifacts tab | list/get prompt/poll/wait/retry/rename/delete/download/export | P0 |
| Notes | Notes tab/editor | list/create/get/save/rename/delete, saved chat/history | P1 |
| Research | Research tab | start fast/deep, status/wait/cancel/import all/cited-only | P1 |
| Labels | Source labels panel | list/generate/create/rename/emoji/add/remove/delete, source filter | P1 |
| Sharing | Share modal | public link, view level, add/update/remove users | P1 |
| Settings | Global settings | language list/get/set, account limits/tier signal | P1 |
| Diagnostics | Admin/debug | auth check, doctor, logs, storage paths, raw metadata | P2 |
| Agent integrations | Advanced | skill/mcp install/status/show | P2 |

## Navigation đề xuất

```text
Header:
  Profile selector | Auth health | Global language | Active notebook

Left sidebar:
  Notebook list + create

Main notebook workspace:
  Overview
  Sources
  Chat
  Studio
  Artifacts
  Notes
  Research
  Sharing
  Settings
```

Không nên làm landing page marketing trong app. Màn hình đầu tiên nên là dashboard notebook hoặc auth onboarding nếu chưa đăng nhập.

## Data model frontend

| Entity | Field cần có | Nguồn |
| --- | --- | --- |
| Profile | name, active, storage path, account email, auth status | `profile list`, `auth check`, path helpers |
| Notebook | id, title, created/updated/viewed, source count, summary | `notebooks.list/get/summary/metadata` |
| Source | id, title, url/type/status, labels, freshness, guide, char count | `sources.list/get/guide/fulltext/stale` |
| Label | id, name, emoji, source ids/count | `labels.list` |
| ChatTurn | question, answer, citations, conversation id, timestamp | `chat.get_history/turns` |
| Citation | source id/title, chunk id, cited text, char range, number | `AskResult.references` |
| Artifact | id, title, kind, status, created_at, url, prompt | `artifacts.list/get/get_prompt` |
| Job | task id, kind, status, progress message, started/updated, error | generate/poll/wait |
| Note | id, title, content, created_at | `notes.*` |
| ResearchTask | task id, query, mode, source, status, sources, report | `research.*` |
| ShareStatus | public, access, view level, users, share url | `sharing.get_status` |
| Settings | output language, account limits, tier | `settings.*` |

## Trạng thái UI cần chuẩn hóa

| State | Dùng cho | UI |
| --- | --- | --- |
| Idle | Form chưa chạy | Button enabled |
| Loading | Fetch/list/get | Spinner nhỏ tại vùng dữ liệu |
| Processing | Source/artifact/research đang xử lý | Status pill + progress row |
| Completed | Artifact/source/research xong | Action download/chat/generate enabled |
| Failed | Task/source lỗi | Error pill + retry/delete |
| Timeout | Wait quá hạn | Banner cho retry wait |
| Needs confirmation | Delete/regenerate all/clear conversation | Modal confirm |
| Auth required | Cookie invalid | Auth banner + login/refresh |
| Rate limited | 429 | Retry-after countdown |
| Schema drift | Decode/UnknownRPCMethodError | Debug detail, khuyến nghị update |

## Chức năng P0 chi tiết

### 1. Auth & Profile

| Chức năng | UI | Đầu vào | Đầu ra |
| --- | --- | --- | --- |
| Check auth | Health card | passive/test toggle | ok/error + cookie details |
| Login/import | Wizard | browser/cookie JSON/account | profile authenticated |
| Refresh | Button | verify toggle | refreshed status |
| Profile switch | Dropdown | profile name | active profile |

Yêu cầu UX: nếu auth fail, disable workspace actions và hiển thị nút login/refresh rõ ràng.

### 2. Notebook Dashboard

| Chức năng | UI | Đầu vào | Đầu ra |
| --- | --- | --- | --- |
| List notebooks | Sidebar table | search/sort/limit | notebooks |
| Create | Modal | title, set active checkbox | new notebook |
| Rename | Inline/edit dialog | title | updated notebook |
| Delete | Danger confirm | notebook id | removed, context clear nếu active |
| Summary | Overview card | include topics toggle | summary/topics |
| Metadata export | Button | JSON/text | downloaded/copied metadata |

### 3. Sources

| Chức năng | UI | Đầu vào | Đầu ra |
| --- | --- | --- | --- |
| Add source | Modal tabs URL/Text/File/Drive | content/path/file id/title/type | source row |
| Source list | Table | status/type/label/search filters | sources |
| Wait status | Row status | timeout/interval implicit | ready/error |
| Fulltext viewer | Drawer | output format | text/markdown |
| Guide | Drawer/card | source id | AI guide/keywords |
| Refresh/stale | Row action | source id | refreshed/freshness |
| Clean | Wizard | dry-run, confirm | candidates/deleted |

### 4. Chat

| Chức năng | UI | Đầu vào | Đầu ra |
| --- | --- | --- | --- |
| Ask | Chat composer | question, selected sources, timeout | answer + citations |
| New conversation | Button | confirm | cleared then new answer |
| Suggested prompts | Drawer/chips | mode/query/source ids | prompt suggestions |
| Configure | Settings panel | mode/persona/response length | chat config |
| History | Side panel | limit/show all | turns |
| Save to note | Button | title | note |

### 5. Studio Generate

| Artifact | UI controls bắt buộc | Advanced controls |
| --- | --- | --- |
| Audio | instructions, source multi-select, format, length | wait, timeout, retry |
| Video | instructions, format, style | custom style prompt, language |
| Cinematic video | instructions, source select | language |
| Report | format, prompt/append, source select | language |
| Quiz/flashcards | instructions, difficulty, quantity | wait/retry |
| Infographic | orientation, detail, style, instructions | language |
| Slide deck | format, length, instructions | language |
| Revise slide | artifact, slide index, prompt | wait/retry |
| Data table | table instructions | language |
| Mind map | kind, instructions | wait only for interactive |

### 6. Artifact Library

| Chức năng | UI | Đầu vào | Đầu ra |
| --- | --- | --- | --- |
| List/filter | Table/grid | type/status/search | artifacts |
| Poll/wait | Job row/detail | task/artifact id | status |
| Retry failed | Button | artifact id | new status |
| Rename/delete | Inline/modal | title/confirm | updated/deleted |
| Get prompt | Prompt panel | artifact id | prompt text |
| Download | Dialog | type, format, overwrite policy | file |
| Batch download | Dialog | selected/all, format | files |
| Export | Dialog | title, docs/sheets | Drive export result |

## Chức năng P1/P2

| Module | Chức năng | Ghi chú triển khai |
| --- | --- | --- |
| Notes | CRUD note, save history, search note | Có thể dùng editor Markdown đơn giản |
| Research | Start/wait/import/cancel | Nên hiển thị report + candidate sources trước khi import |
| Labels | Auto-label và manual label | `scope=all` bắt buộc confirm rõ vì wipe labels |
| Sharing | Public/user permissions | Email validation ở UI |
| Settings | Language/limits/tier | Nhấn mạnh language là global account setting |
| Diagnostics | Auth check/doctor/logs | Dành cho debug, không nên lộ quá nhiều ở flow chính |
| Integrations | MCP/skill install guide | Có thể là documentation screen thay vì action trực tiếp |

## Các confirmation gate bắt buộc

| Action | Vì sao cần confirm |
| --- | --- |
| Delete notebook | Mất notebook |
| Delete source | Mất nguồn khỏi notebook |
| Clean sources apply | Xóa nhiều nguồn tự động |
| `ask --new`/clear server conversation | Xóa turns không recover |
| `label generate --scope all` | Wipe/regenerate toàn bộ label id |
| Delete label | Xóa group, source trở thành unlabeled |
| Delete artifact/mind map | Artifact bị xóa hoặc mind map bị clear |
| Delete note | Soft-delete note |
| Auth logout/import overwrite | Có thể mất session hiện tại |
| Profile delete | Xóa auth/context profile |

## API strategy trước triển khai

| Cách gọi | Ưu | Nhược | Khuyến nghị |
| --- | --- | --- | --- |
| Gọi Python API trực tiếp | Typed, nhanh, không parse CLI | App phải là Python backend | Tốt nhất nếu build local web/electron có backend Python |
| Gọi REST server | HTTP rõ, phù hợp frontend | REST hiện chưa phủ toàn bộ CLI | Dùng cho MVP web nếu mở rộng route cần thiết |
| Gọi CLI subprocess | Phủ nhiều command nhất | Parse output, quản lý process/job khó hơn | Chỉ fallback cho command chưa có API/REST |
| Gọi MCP | Agent-friendly | Không tối ưu frontend app | Không dùng làm backend app chính |

Khuyến nghị: backend app dùng `NotebookLMClient` trực tiếp, tái sử dụng `_app` core khi cần flow nhiều bước. Nếu frontend tách riêng, tạo REST route nội bộ riêng bám theo các typed domain ở trên.

