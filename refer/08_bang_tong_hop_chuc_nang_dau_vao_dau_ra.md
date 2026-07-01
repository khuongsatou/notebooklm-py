# 08. Bảng tổng hợp chức năng, đầu vào và đầu ra

## Public Python API

| Nhóm | Chức năng | Method | Đầu vào bắt buộc | Đầu vào tùy chọn | Đầu ra | Prompt/instruction |
| --- | --- | --- | --- | --- | --- | --- |
| Notebooks | List | `notebooks.list()` | Không | Không | `list[Notebook]` | Không |
| Notebooks | Create | `notebooks.create(title)` | `title` | Không | `Notebook` | Không |
| Notebooks | Get | `notebooks.get(notebook_id)` | `notebook_id` | Không | `Notebook` | Không |
| Notebooks | Rename | `notebooks.rename(notebook_id, new_title)` | id, title | Không | `Notebook`/status | Không |
| Notebooks | Delete | `notebooks.delete(notebook_id)` | `notebook_id` | Không | `None` | Không |
| Notebooks | Summary | `notebooks.get_summary(notebook_id)` | id | Không | `str` | Không |
| Notebooks | Suggested prompts | `notebooks.suggest_prompts()` | `notebook_id` | `source_ids`, `mode`, `query` | `list[PromptSuggestion]` | `query` steer |
| Sources | List | `sources.list(notebook_id)` | id | `strict` | `list[Source]` | Không |
| Sources | Add URL/YouTube | `sources.add_url()` | notebook id, URL | `wait`, `wait_timeout` | `Source` | URL là nội dung nguồn |
| Sources | Add text | `sources.add_text()` | id, title, content | `wait`, `idempotent=False` | `Source` | `content` là nguồn |
| Sources | Add file | `sources.add_file()` | id, file path | mime, title, wait, progress | `Source` | File content |
| Sources | Add Drive | `sources.add_drive()` | id, file id, title | mime, wait | `Source` | Drive file |
| Sources | Fulltext | `sources.get_fulltext()` | id, source id | format text/markdown | `SourceFulltext` | Không |
| Sources | Guide | `sources.get_guide()` | id, source id | Không | `SourceGuide` | Không |
| Chat | Ask | `chat.ask()` | notebook id, question | source ids, conversation id | `AskResult` | `question` |
| Chat | Configure | `chat.configure()` | notebook id | goal, response length, custom prompt | config result | `custom_prompt` |
| Chat | History | `chat.get_history()` | notebook id | limit, conversation id | history | Không |
| Chat | Save answer | `chat.save_answer_as_note()` | notebook id, ask result | title | `Note` | Answer có citations |
| Artifacts | Generate audio | `artifacts.generate_audio()` | notebook id | source ids, language, instructions, format, length | `GenerationStatus` | `instructions` |
| Artifacts | Generate video | `artifacts.generate_video()` | notebook id | source ids, language, instructions, format, style, style prompt | `GenerationStatus` | `instructions`, `style_prompt` |
| Artifacts | Generate report | `artifacts.generate_report()` | notebook id | format, custom prompt, extra instructions | `GenerationStatus` | `custom_prompt`, `extra_instructions` |
| Artifacts | Generate quiz | `artifacts.generate_quiz()` | notebook id | instructions, quantity, difficulty | `GenerationStatus` | `instructions` |
| Artifacts | Generate flashcards | `artifacts.generate_flashcards()` | notebook id | instructions, quantity, difficulty | `GenerationStatus` | `instructions` |
| Artifacts | Generate infographic | `artifacts.generate_infographic()` | notebook id | language, instructions, orientation, detail, style | `GenerationStatus` | `instructions` |
| Artifacts | Generate slide deck | `artifacts.generate_slide_deck()` | notebook id | language, instructions, format, length | `GenerationStatus` | `instructions` |
| Artifacts | Revise slide | `artifacts.revise_slide()` | notebook id, artifact id, slide index, prompt | Không | `GenerationStatus` | `prompt` |
| Artifacts | Data table | `artifacts.generate_data_table()` | notebook id | language, instructions | `GenerationStatus` | `instructions` |
| Artifacts | Poll/wait | `poll_status`, `wait_for_completion` | task id | interval/timeout/callback | status/artifact | Không |
| Artifacts | Download | `download_*` | notebook id, output path | artifact id, format | file | Không |
| Research | Start | `research.start()` | notebook id, query | source, mode | `ResearchStart` | `query` |
| Research | Poll/wait | `poll`, `wait_for_completion` | notebook id | task id, timeout | `ResearchTask` | Không |
| Research | Import | `import_sources()` | notebook id, task id, sources | verify/backoff | imported list | Không |
| Notes | CRUD | `notes.create/list/get/update/delete` | notebook/note ids | title/content | `Note`/`None` | content |
| Mind maps | Generate/list/get | `mind_maps.generate/list/get` | notebook id, kind | source ids, instructions, language, wait | `MindMap` | `instructions` |
| Labels | Generate/create/mutate | `labels.*` | notebook id | scope/name/emoji/source ids | `Label`/list | AI label generate không có custom prompt |
| Sharing | Share ops | `sharing.*` | notebook id | email, permission, public, view level | `ShareStatus` | welcome message |
| Settings | Language/limits/tier | `settings.*` | language for set | Không | str/limits/tier | language code |

## Artifact options quick map

| Artifact | Enum/options | Giá trị chính |
| --- | --- | --- |
| Audio | `AudioFormat` | deep dive, brief, critique, debate |
| Audio | `AudioLength` | short, default, long |
| Video | `VideoFormat` | explainer, brief, cinematic |
| Video | `VideoStyle` | auto, custom, classic, whiteboard, kawaii, anime, watercolor, retro print, heritage, paper craft |
| Quiz/flashcards | `QuizQuantity` | fewer, standard, more alias standard |
| Quiz/flashcards | `QuizDifficulty` | easy, medium, hard |
| Infographic | `InfographicOrientation` | landscape, portrait, square |
| Infographic | `InfographicDetail` | concise, standard, detailed |
| Infographic | `InfographicStyle` | auto, sketch note, professional, bento grid, editorial, instructional, bricks, clay, anime, kawaii, scientific |
| Slide deck | `SlideDeckFormat` | detailed deck, presenter slides |
| Slide deck | `SlideDeckLength` | default, short |
| Report | `ReportFormat` | briefing doc, study guide, blog post, custom |
| Mind map | `MindMapKind` | note-backed, interactive |

## Trạng thái và lỗi thường gặp

| Domain | Trạng thái/lỗi | Ý nghĩa |
| --- | --- | --- |
| Source | `READY` | Có thể query/generate |
| Source | `PROCESSING/PREPARING` | Cần wait |
| Source | `ERROR` | Có thể terminal hoặc transient với media/unclassified |
| Artifact | `pending` | Đang queue |
| Artifact | `in_progress` | Đang tạo |
| Artifact | `completed` | Có thể tải |
| Artifact | `failed` | Có thể retry |
| Research | `in_progress` | Đang chạy |
| Research | `completed` | Có sources/report |
| Research | `failed` | Kết thúc lỗi |
| Get missing | `*NotFoundError` | Public `get()` raise; `get_or_none()` trả `None` |
| Decode drift | `UnknownRPCMethodError`/`DecodingError` | Google đổi response shape |
| Auth | `AuthError` | Cần refresh/login lại |
| Rate limit | `RateLimitError` | Có thể có `retry_after` |

