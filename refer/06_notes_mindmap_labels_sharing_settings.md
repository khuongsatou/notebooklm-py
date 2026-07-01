# 06. Notes, mind maps, labels, sharing và settings

## Notes

| Chức năng | Method | Đầu vào | Pipeline | Đầu ra |
| --- | --- | --- | --- | --- |
| List notes | `notes.list(nb)` | `notebook_id` | `GET_NOTES_AND_MIND_MAPS` -> filter note rows | `list[Note]` |
| Get note | `notes.get(nb, note_id)` | note id | list/find | `Note`; miss raise `NoteNotFoundError` |
| Optional get | `get_or_none()` | note id | list/find | `Note | None` |
| Create | `create(nb, title, content)` | title/content | `CREATE_NOTE` | `Note` |
| Update | `update(nb, note_id, content, title)` | content/title | preflight exists -> `UPDATE_NOTE` | `None` |
| Delete | `delete(nb, note_id)` | note id | `DELETE_NOTE`, soft delete | `None` |
| List mind maps | `list_mind_maps(nb)` | notebook id | note service filter mind map rows | raw rows |
| Delete mind map | `delete_mind_map()` | mind map id | `DELETE_NOTE` | `None` |

Điểm hay: note rows và mind-map rows dùng chung backend `GET_NOTES_AND_MIND_MAPS`; repo tách `NoteService` làm primitive thấp, còn `NotesAPI` và `NoteBackedMindMapService` chỉ dùng đúng phần cần.

## Mind maps

Có hai backend:

| Loại | Backend | Generate | Rename/delete | Tree |
| --- | --- | --- | --- | --- |
| Note-backed | Notes collection | `GENERATE_MIND_MAP` rồi persist qua `CREATE_NOTE` | `UPDATE_NOTE`/`DELETE_NOTE` | JSON nằm trong note content |
| Interactive | Studio artifact | `CREATE_ARTIFACT` type 4 variant 4 | `RENAME_ARTIFACT`/`DELETE_ARTIFACT` | Lấy qua `GET_INTERACTIVE_HTML` leaf `[0][9][3]` |

| Method | Đầu vào | Pipeline | Đầu ra |
| --- | --- | --- | --- |
| `mind_maps.list_note_backed()` | notebook id | note rows only | `list[MindMap]` note-backed |
| `mind_maps.list()` | notebook id | note-backed + artifact list | `list[MindMap]` |
| `mind_maps.get()` | notebook id, map id | list/find | `MindMap` |
| `mind_maps.generate(kind=...)` | source ids, `instructions`, `language`, `wait` | Dispatch theo kind | `MindMap` |
| `mind_maps.rename()` | map id, title, optional kind | Dispatch đúng backend | `MindMap | None` |
| `mind_maps.delete()` | map id, optional kind | Dispatch đúng backend | `None` |
| `mind_maps.get_tree()` | map id, kind | Note content hoặc `GET_INTERACTIVE_HTML` | `dict` tree |

Điểm hay:

| Điểm | Ý nghĩa |
| --- | --- |
| Unified API | Caller không cần nhớ mind map nằm ở notes hay artifacts |
| `kind` optional | Có thể auto-discover, nhưng caller vẫn pin kind để tránh ambiguity |
| Interactive tree lazy | `list()` không fetch N cây riêng, tiết kiệm RPC |
| Drift loud | Nếu `[0][9]` đổi shape, raise `UnknownRPCMethodError`; chỉ tolerate leaf chưa populate |

## Labels

| Chức năng | Method | Đầu vào | Pipeline | Đầu ra |
| --- | --- | --- | --- | --- |
| List | `labels.list(nb)` | notebook id | `LIST_LABELS` | `list[Label]` |
| Get | `labels.get(nb, label_id)` | label id | list/find | `Label` |
| Expand sources | `labels.sources(nb, label_id)` | label id | get label + `sources.list()` join | `list[Source]` |
| AI generate | `labels.generate(scope)` | `scope=unlabeled|all` | `CREATE_LABEL` generate mode | full label set |
| Manual create | `labels.create(name, emoji)` | name/emoji | snapshot ids -> `CREATE_LABEL` -> id diff | new `Label` |
| Rename/emoji | `rename`, `set_emoji`, `update` | field | `UPDATE_LABEL` | `Label | None` |
| Add sources | `add_sources(label_id, source_ids)` | ids | Một `UPDATE_LABEL` mỗi source id | `Label | None` |
| Remove sources | `remove_sources()` | ids | `UPDATE_LABEL` | `Label | None` |
| Delete | `delete(label_ids)` | ids | `DELETE_LABEL` | `None` |

Điểm hay: `generate(scope="all")` được coi là destructive vì wipe/regenerate labels; CLI phải gate bằng confirm. Manual create trả label bằng id diff chứ không match name vì tên có thể trùng.

## Sharing

| Chức năng | Method | Đầu vào | Pipeline | Đầu ra |
| --- | --- | --- | --- | --- |
| Get status | `sharing.get_status(nb)` | notebook id | `GET_SHARE_STATUS` | `ShareStatus` |
| Set public | `set_public(nb, bool)` | public true/false | `SHARE_NOTEBOOK` rồi refetch | `ShareStatus` |
| View level | `set_view_level(nb, level)` | full notebook/chat only | `RENAME_NOTEBOOK` generic mutator rồi refetch | `ShareStatus` |
| Add user | `add_user(email, permission, notify, welcome_message)` | email/permission | `SHARE_NOTEBOOK` | `ShareStatus` |
| Update user | `update_user(email, permission)` | email/permission | wrapper `add_user(... notify=False)` | `ShareStatus` |
| Remove user | `remove_user(email)` | email | `SHARE_NOTEBOOK` remove permission | `ShareStatus` |

Điểm hay: API chặn assign `OWNER` và `_REMOVE` sai method trước khi gọi server.

## Settings

| Chức năng | Method | Đầu vào | Pipeline | Đầu ra |
| --- | --- | --- | --- | --- |
| Set output language | `settings.set_output_language(language)` | language code | `SET_USER_SETTINGS`, parse language leaf | `str | None` |
| Get output language | `get_output_language()` | none | `GET_USER_SETTINGS` | `str | None` |
| Account limits | `get_account_limits()` | none | `GET_USER_SETTINGS`, parse limits | `AccountLimits` |
| Account tier signal | `get_account_tier()` | none | `GET_USER_TIER` promotions endpoint | `AccountTier` |

Điểm hay: language extraction tách prefix bắt buộc và tail optional. Envelope drift thì raise, còn language unset thì trả `None`.

