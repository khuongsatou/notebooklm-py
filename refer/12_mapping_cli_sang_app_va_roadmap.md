# 12. Mapping CLI sang app và roadmap triển khai

## Mapping nhóm lệnh sang module app

| CLI group | App module | Backend nên dùng | Ghi chú |
| --- | --- | --- | --- |
| `login`, `auth *`, `profile *`, `status`, `doctor` | Auth/Profile/Diagnostics | Auth helpers + profile paths; một số command có thể gọi CLI fallback | Cẩn thận credential, không log cookie |
| `list/create/use/delete/rename/summary/metadata` | Notebook Dashboard | `client.notebooks`, `_app.notebooks`, `_app.session` | `use` là local context, trong app có thể chỉ là active state |
| `source *` | Sources | `client.sources`, `_app.source_*` | Add file cần upload pipeline; clean/research nên dùng `_app` |
| `ask`, `history`, `configure`, `suggest-prompts` | Chat | `client.chat`, `client.notebooks.suggest_prompts`, `_app.chat` | Chat answer nên stream/progress nếu backend hỗ trợ |
| `generate *` | Studio Generate | `_app.generate_plans`, `_app.generate`, `client.artifacts` | Tạo job registry trong app |
| `artifact *` | Artifact Library | `client.artifacts`, `_app.artifacts`, `_app.download` | Download cần policy overwrite và file handling |
| `download *` | Download Center | `_app.download`, `client.artifacts.download_*` | UI cần preview và batch mode |
| `note *` | Notes | `client.notes`, `_app.notes` | Editor + save state |
| `label *` | Labels | `client.labels`, `_app.labels` | Name/id resolution + destructive gates |
| `research *` | Research | `client.research`, `_app.research`, `_app.source_research` | Import all/cited-only cần preview |
| `share *` | Sharing | `client.sharing`, `_app.sharing` | Email permission UX |
| `language *` | Settings | `client.settings`, `_app.language` | Global setting warning |
| `skill *`, `mcp *`, `agent *`, `completion` | Integrations/Docs | CLI/app helpers | Không cần MVP |

## Roadmap đề xuất

### Phase 0: Foundation

| Việc | Deliverable | Acceptance criteria |
| --- | --- | --- |
| Chọn backend strategy | Python API trực tiếp hoặc REST nội bộ | Không phụ thuộc parse text CLI cho flow chính |
| App state model | Profile, active notebook, jobs, auth state | Refresh/reload vẫn biết active notebook |
| Error envelope chuẩn | Map exception -> category/message/retriable | UI hiện lỗi nhất quán |
| Job registry | task id, kind, status, cancel/refresh | Generate không làm mất task khi chuyển tab |

### Phase 1: MVP nghiên cứu

| Module | Chức năng | Acceptance criteria |
| --- | --- | --- |
| Auth | auth check, refresh, login/import hướng dẫn | Không auth thì workspace bị khóa rõ |
| Notebook | list/create/open/rename/delete/summary | User tạo notebook và vào workspace được |
| Sources | add URL/text/file, list, wait, guide, fulltext, delete | Source ready thì chat/generate chọn được |
| Chat | ask, source filter, citations, history, save answer note | Answer có citation clickable về source |
| Artifacts | generate report/audio/quiz, poll, list, download | Tạo artifact, chờ completed, tải file |

### Phase 2: Studio đầy đủ

| Module | Chức năng | Acceptance criteria |
| --- | --- | --- |
| Generate all types | video, cinematic, slide, infographic, flashcards, data table, mind map | Mỗi type có form option đúng enum |
| Artifact management | get prompt, retry, rename, delete, export | Failed artifact retry được; prompt xem được |
| Download center | all/latest/name/dry-run/overwrite policy | Batch download có preview |
| Notes | full CRUD, save history | Note editor lưu/sửa/xóa ổn định |

### Phase 3: Organization và collaboration

| Module | Chức năng | Acceptance criteria |
| --- | --- | --- |
| Labels | AI generate, manual label, membership | Filter source theo label |
| Research | fast/deep, wait, import all, cited-only | Research report và source preview trước import |
| Sharing | public/view level/user permissions | Share status phản ánh sau update |
| Settings | language, account limits/tier | Language global warning rõ |

### Phase 4: Power user

| Module | Chức năng | Acceptance criteria |
| --- | --- | --- |
| Diagnostics | doctor, logs, paths, RPC debug hints | Debug auth/rate limit/schema drift được |
| Integrations | MCP/skill install guide | Copy command/config dễ dàng |
| Automation | saved workflows/presets | User chạy lại pipeline generate/import |

## Form spec cho các màn hình chính

### Add Source Modal

| Tab | Field | Validation | Backend |
| --- | --- | --- | --- |
| URL | URL, title optional, wait toggle | URL hợp lệ; internal URL cần advanced allow | `sources.add_url` |
| YouTube | YouTube URL, title optional | Phải là YouTube URL nếu chọn type YouTube | `sources.add_url` |
| Text | title, content | content không rỗng | `sources.add_text` |
| File | file picker, title, mime override | file tồn tại, supported, size policy | `sources.add_file` |
| Drive | file id, title, mime type | id/title không rỗng | `sources.add_drive` |
| Research | query, source, mode, import all/cited-only | deep chỉ web; cited-only cần import-all | `_app.source_research` |

### Chat Composer

| Field | Control | Note |
| --- | --- | --- |
| Question | Multi-line textarea | Có paste/import prompt |
| Source scope | Multi-select sources/labels | Default all ready sources |
| Conversation | Current/new/specific id | New cần confirm nếu xóa server history |
| Response config | Mode, persona, length | Persona giới hạn 10.000 chars theo CLI docs |
| Actions | Ask, save answer, copy, save as note | Save as note dùng citation-rich path nếu có refs |

### Generate Form

| Field | Control | Note |
| --- | --- | --- |
| Artifact type | Segmented/tabs | audio/video/report/... |
| Source scope | Multi-select | Disabled nếu source chưa ready |
| Instructions | Textarea | Cho import từ file |
| Language | Select | Chỉ hiện với type language-aware |
| Type options | Select/segmented | Theo enum từng artifact |
| Wait behavior | Background/wait | Background tạo job row |
| Retry | Numeric/toggle | Áp dụng rate limit retries |

### Artifact Detail

| Section | Data/action |
| --- | --- |
| Header | title, kind, status, created_at |
| Prompt | `get_prompt`, copy/reuse prompt |
| Preview | report/table/quiz/flashcard JSON/HTML nếu có thể |
| Actions | wait/poll/retry/download/export/rename/delete |
| Download | format, overwrite policy, path |

## Backend endpoint nội bộ đề xuất nếu làm app web

| Endpoint | Method | Body/query | Trả về |
| --- | --- | --- | --- |
| `/api/auth/status` | GET | passive/test | auth status |
| `/api/profiles` | GET/POST | name | profiles |
| `/api/notebooks` | GET/POST | title | notebooks |
| `/api/notebooks/{id}` | GET/PATCH/DELETE | title | notebook |
| `/api/notebooks/{id}/sources` | GET/POST | source payload | sources |
| `/api/notebooks/{id}/sources/{sid}` | GET/PATCH/DELETE | title | source |
| `/api/notebooks/{id}/chat/ask` | POST | question, source ids, conversation | answer |
| `/api/notebooks/{id}/chat/history` | GET | limit | turns |
| `/api/notebooks/{id}/generate` | POST | artifact type/options | job/status |
| `/api/notebooks/{id}/artifacts` | GET | type/status | artifacts |
| `/api/notebooks/{id}/artifacts/{aid}` | GET/PATCH/DELETE | title | artifact |
| `/api/jobs/{task_id}` | GET | none | status |
| `/api/notebooks/{id}/download` | POST | type/artifact/format/selection | file/job |
| `/api/notebooks/{id}/notes` | GET/POST | title/content | notes |
| `/api/notebooks/{id}/labels` | GET/POST/PATCH/DELETE | label ops | labels |
| `/api/notebooks/{id}/research` | GET/POST | query/mode/source | research task |
| `/api/notebooks/{id}/share` | GET/PATCH | share ops | share status |
| `/api/settings/language` | GET/PUT | code/local | language |

## Quy tắc triển khai quan trọng

| Quy tắc | Lý do |
| --- | --- |
| Không log cookie/token/storage JSON | Credential đầy đủ tài khoản |
| Không gọi destructive action nếu chưa có confirm | CLI đã có gate, app phải giữ tương đương |
| Không dùng source chưa ready cho chat/generate nếu có thể tránh | NotebookLM có thể trả answer kém hoặc lỗi |
| Không retry create non-idempotent bừa bãi | Có thể tạo duplicate |
| Không dùng client qua event loop khác | Repo có loop-affinity contract |
| Không expose REST/docs public khi giữ account credential | Security risk |
| Prompt rỗng nên normalize thành `None` ở backend | Giữ wire behavior ổn định |
| Job polling cần backoff và timeout | Tránh spam NotebookLM/rate limit |

## Checklist trước khi code

| Hạng mục | Xong? |
| --- | --- |
| Chọn framework frontend/backend |
| Quyết định Python API trực tiếp hay REST nội bộ |
| Thiết kế auth/profile storage an toàn |
| Thiết kế active notebook state |
| Thiết kế job registry cho generate/research/source wait |
| Thiết kế error category và retry UX |
| Thiết kế confirmation modal chuẩn |
| Chọn artifact types trong MVP |
| Chọn download file handling |
| Viết test cho destructive confirmation |
| Viết test cho source add/generate/chat happy path |

