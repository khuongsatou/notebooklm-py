# 10. Phân tích câu lệnh `notebooklm` CLI chi tiết

## Cấu trúc chung

```bash
notebooklm [-p PROFILE] [--storage PATH] [-v|--quiet] <command> [OPTIONS] [ARGS]
```

| Thành phần | Ý nghĩa | Gợi ý khi đưa vào app |
| --- | --- | --- |
| `-p, --profile` | Chọn profile auth/account | Dropdown tài khoản/profile ở header hoặc settings |
| `--storage` | Dùng file `storage_state.json` riêng | Advanced setting, không nên để ở flow chính |
| `-v, --verbose` | Tăng log | Debug panel/log viewer |
| `--quiet` | Tắt status text | Không cần trong app, thay bằng toast/status bar |
| `--json` ở từng lệnh | Output máy đọc | API nội bộ của app nên dùng JSON/typed data mặc định |
| `-n, --notebook` | Chọn notebook target | App nên có active notebook context rõ ràng |
| `--prompt-file` hoặc `-` | Đọc prompt từ file/stdin | App nên có text area lớn + import prompt từ file |

## Nhóm session, auth, profile

| Lệnh | Chức năng | Đầu vào | Đầu ra | Destructive | Màn hình app tương ứng |
| --- | --- | --- | --- | --- | --- |
| `login` | Đăng nhập bằng browser/cookie/master token | browser, account, storage/profile | Auth storage | Có thể ghi đè session | Onboarding/Auth settings |
| `auth check` | Kiểm tra cookie/storage/token | `--test`, `--passive`, `--json` | Health report | Không | Auth health card |
| `auth inspect` | Xem account trong browser cookie store | browser/profile | Danh sách account | Không | Account import wizard |
| `auth import-cookies` | Import cookie JSON | file/stdin, include domains | Storage state mới | Có ghi file auth | Auth import modal |
| `auth refresh` | Xoay/refresh cookie | optional browser cookies, verify | Storage state cập nhật | Có ghi file auth | Refresh session action |
| `auth logout` | Xóa cookie/profile cache | confirm | Auth cleared | Có | Logout confirm dialog |
| `profile list` | Liệt kê profile | Không | Profiles | Không | Profile manager |
| `profile create` | Tạo profile | name | Profile mới | Không | Profile manager |
| `profile switch` | Đổi active profile | name | Active profile | Không | Profile switcher |
| `profile rename` | Đổi tên profile | old/new | Profile renamed | Có thể ảnh hưởng context | Profile manager |
| `profile delete` | Xóa profile | name | Deleted | Có | Delete profile confirm |
| `status` | Xem active notebook/conversation/path | `--paths`, `--json` | Context report | Không | Status/settings panel |
| `clear` | Xóa active context | Không | Context cleared | Có nhẹ | Clear active notebook action |
| `doctor` | Kiểm tra môi trường | `--fix`, `--json` | Diagnostics | `--fix` có mutate | Diagnostics screen |
| `completion` | In script completion shell | shell | Script | Không | Không cần trong app |

## Nhóm notebook

| Lệnh | Chức năng | Đầu vào | Đầu ra | Màn hình app |
| --- | --- | --- | --- | --- |
| `list` | Liệt kê notebook | limit/no-truncate/json | Notebook list | Dashboard/sidebar |
| `create <title>` | Tạo notebook | title, `--use` | Notebook mới | New notebook dialog |
| `use <id>` | Set active notebook | id/prefix, force | Active context | Click notebook trong sidebar |
| `delete -n <id>` | Xóa notebook | notebook id, `-y` | Deleted/context cleared | Notebook settings danger zone |
| `rename <title>` | Đổi tên notebook hiện tại | title | Notebook renamed | Inline title edit |
| `summary` | Lấy AI summary | `--topics` | Summary/topics | Overview tab |
| `metadata` | Export metadata + sources | notebook id | Metadata JSON/text | Notebook metadata/export panel |

## Nhóm chat

| Lệnh | Chức năng | Đầu vào | Đầu ra | Trạng thái app cần có |
| --- | --- | --- | --- | --- |
| `ask <question>` | Hỏi notebook | question, source filter, conversation id, timeout | Answer + citations | Loading stream/pending answer |
| `ask --new` | Xóa conversation hiện tại rồi hỏi mới | question + confirm | New conversation answer | Confirm destructive |
| `ask --save-as-note` | Hỏi và lưu answer thành note | question, note title | Answer + saved note | Sau answer hiện nút Save to note |
| `suggest-prompts` | Gợi ý prompt | mode, query, source filter | Prompt suggestions | Prompt suggestion drawer |
| `configure` | Set chat mode/persona/length | mode/persona/response length | Config result | Chat settings panel |
| `history` | Xem lịch sử conversation | limit, show all, no truncate | Turns | Conversation history panel |
| `history --clear` | Xóa local cache | Không | Cache cleared | Clear local cache action |
| `history --save` | Lưu history thành note | title | Note | Save conversation button |

## Nhóm source

| Lệnh | Chức năng | Đầu vào | Đầu ra | Màn hình app |
| --- | --- | --- | --- | --- |
| `source list` | Liệt kê nguồn | label filter, limit | Source list | Sources tab |
| `source add <content>` | Thêm URL/file/text | content, title, type, timeout | Source | Add source modal |
| `source add-drive` | Thêm Google Drive source | file id, title, mime type | Source | Add Drive modal |
| `source add-research` | Tạo nguồn từ research | query, mode, from, import all | Research + imported sources | Research/import wizard |
| `source get` | Xem metadata source | source id | Source detail | Source detail drawer |
| `source fulltext` | Lấy indexed fulltext | source id, format, output path | Text/Markdown | Source content viewer/export |
| `source guide` | Lấy AI guide/summary/keyword | source id | SourceGuide | Source guide card |
| `source stale` | Kiểm tra nguồn stale | source id | fresh/stale | Refresh indicator |
| `source wait` | Chờ xử lý source | source id, timeout/interval | Ready/error/timeout | Processing status |
| `source clean` | Dọn duplicate/error/access-blocked | dry-run/yes | Candidate/deleted | Cleanup wizard |
| `source rename` | Đổi tên source | source id, title | Source renamed | Inline edit |
| `source refresh` | Refresh source | source id | Source refreshed | Refresh button |
| `source delete` | Xóa source | source id, confirm | Deleted | Delete source confirm |
| `source delete-by-title` | Xóa theo title exact | title, confirm | Deleted | Có thể không cần UI chính |

## Nhóm label

| Lệnh | Chức năng | Đầu vào | Đầu ra | Màn hình app |
| --- | --- | --- | --- | --- |
| `label list` | Liệt kê label | notebook id | Labels | Source label sidebar |
| `label sources <id|name>` | Xem source trong label | label ref | Sources | Filtered source view |
| `label generate` | AI group sources | scope all/unlabeled, confirm nếu all | Labels | Auto-label action |
| `label create` | Tạo label thủ công | name, emoji | Label | New label dialog |
| `label rename` | Đổi tên label | ref, new name | Label | Inline edit |
| `label emoji` | Set emoji | ref, emoji | Label | Emoji picker |
| `label add` | Add sources vào label | label ref, source ids | Label | Multi-select assign |
| `label remove` | Remove sources khỏi label | label ref, source ids | Label | Multi-select unassign |
| `label delete` | Xóa label | refs, confirm | Deleted | Delete label confirm |

## Nhóm research

| Lệnh | Chức năng | Đầu vào | Đầu ra | Màn hình app |
| --- | --- | --- | --- | --- |
| `research status` | Xem task research active | notebook id | Task/status/sources/report | Research panel |
| `research wait` | Chờ task hoàn thành | timeout/interval/import all/cited only | Completed/imported/timeout | Research progress |
| `research cancel <run_id>` | Hủy task | run id | Cancel result | Cancel button |

## Nhóm generate

| Lệnh | Prompt | Option riêng | Đầu ra | Màn hình app |
| --- | --- | --- | --- | --- |
| `generate audio` | description/instructions | format, length, language | task id/status | Studio create audio |
| `generate video` | description/instructions | format, style, style prompt, language | task id/status | Studio create video |
| `generate cinematic-video` | description | language | task id/status | Studio create cinematic |
| `generate slide-deck` | description | format, length, language | task id/status | Studio create slides |
| `generate revise-slide` | revision prompt | artifact id, slide index | task id/status | Slide editor action |
| `generate quiz` | description | difficulty, quantity | task id/status | Studio create quiz |
| `generate flashcards` | description | difficulty, quantity | task id/status | Studio create flashcards |
| `generate infographic` | description | orientation, detail, style, language | task id/status | Studio create infographic |
| `generate data-table` | description | language | task id/status | Studio create table |
| `generate mind-map` | instructions | kind interactive/note-backed | mind map result | Studio create mind map |
| `generate report` | description/custom prompt | format, append, language | task id/status | Studio create report |

Uniform flags cần đưa vào app:

| CLI flag | App control |
| --- | --- |
| `-s, --source` repeatable | Source multi-select |
| `--wait/--no-wait` | Background job vs wait modal |
| `--timeout`, `--interval` | Advanced polling settings, có default ẩn |
| `--retry` | Auto retry toggle/number |
| `--prompt-file` | Import prompt file hoặc paste text |
| `--language` | Language selector |

## Nhóm artifact và download

| Lệnh | Chức năng | Đầu vào | Đầu ra | Màn hình app |
| --- | --- | --- | --- | --- |
| `artifact list` | List artifact | type, limit | Artifacts | Studio library |
| `artifact get` | Detail artifact | artifact id | Artifact | Detail drawer |
| `artifact get-prompt` | Xem prompt đã tạo artifact | artifact id | Prompt text | Prompt inspector |
| `artifact rename` | Đổi tên | id, title | Artifact | Inline edit |
| `artifact delete` | Xóa/clear artifact | id, confirm | Deleted/cleared | Delete confirm |
| `artifact export` | Export Drive Docs/Sheets | id, title, type | Export result | Export dialog |
| `artifact poll` | Check generation task | task id | Status | Job status endpoint |
| `artifact wait` | Chờ artifact completed | artifact id, timeout | Status | Job detail |
| `artifact retry` | Retry artifact failed | id, wait | Status | Retry failed button |
| `artifact suggestions` | Gợi ý report/artifact | none | Suggestions | Studio suggestions |
| `download audio/video/...` | Tải artifact | selection + path/format | File | Download/export actions |

Download selection flags nên chuyển thành UI:

| CLI flag | UI |
| --- | --- |
| `--all` | Batch download selected/all |
| `--latest`, `--earliest` | Sort + quick pick |
| `--name` | Search/fuzzy match |
| `--dry-run` | Preview file list |
| `--force`, `--no-clobber` | Overwrite policy |
| `--format` | Format select theo artifact |

## Nhóm notes, share, language, skill, mcp, agent

| Nhóm | Lệnh | Có nên đưa vào app chính? | Ghi chú |
| --- | --- | --- | --- |
| Notes | `note list/create/get/save/rename/delete` | Có | Notes tab/editor |
| Share | `share status/public/view-level/add/update/remove` | Có | Share settings modal |
| Language | `language list/get/set` | Có | Global settings, chú thích ảnh hưởng toàn account |
| Skill | `skill install/status/uninstall/show` | Không bắt buộc | Dev/agent integration, để advanced page nếu cần |
| MCP | `mcp install` | Không bắt buộc | Dev setup page |
| Agent | `agent show` | Không cần user app | Có thể để docs/help |
| Completion | `completion` | Không cần | CLI-only |

