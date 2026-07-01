# 05. Artifact generation, polling, download và export pipeline

## Tổng quan artifact

Artifact là nội dung AI-generated trong NotebookLM Studio: audio, video, report, quiz, flashcards, infographic, slide deck, data table, mind map. Public facade là `ArtifactsAPI`; logic chia thành service nhỏ:

| Service | File | Vai trò |
| --- | --- | --- |
| Generation | `_artifact/generation.py` | Build payload và kickoff `CREATE_ARTIFACT` |
| Payloads | `_artifact/payloads.py` | Shape request cho từng loại artifact |
| Listing | `_artifact/listing.py` | List/get/filter artifact, merge mind map |
| Polling | `_artifact/polling.py` | Poll task/artifact status có leader/follower registry |
| Downloads | `_artifact/downloads.py` | Tải media/file/structured content |
| Formatters | `_artifact/formatters.py` | Convert quiz/flashcards/report/table sang JSON/Markdown/HTML/CSV |

## Generate function table

| Chức năng | Method | Đầu vào prompt/options | RPC/pipeline | Đầu ra |
| --- | --- | --- | --- | --- |
| Audio | `generate_audio()` | `instructions`, `language`, `AudioFormat`, `AudioLength` | `build_audio_artifact_params` -> `CREATE_ARTIFACT` | `GenerationStatus` |
| Video | `generate_video()` | `instructions`, `language`, `VideoFormat`, `VideoStyle`, `style_prompt` | Validate custom style -> `CREATE_ARTIFACT` | `GenerationStatus` |
| Cinematic video | `generate_cinematic_video()` | `instructions`, `language` | Video format cinematic | `GenerationStatus` |
| Report | `generate_report()` | `ReportFormat`, `custom_prompt`, `extra_instructions`, `language` | Static/custom report config -> `CREATE_ARTIFACT` | `GenerationStatus` |
| Study guide | `generate_study_guide()` | `extra_instructions` | Wrapper report format `STUDY_GUIDE` | `GenerationStatus` |
| Quiz | `generate_quiz()` | `instructions`, `quantity`, `difficulty` | Type 4 variant quiz | `GenerationStatus` |
| Flashcards | `generate_flashcards()` | `instructions`, `quantity`, `difficulty` | Type 4 variant flashcards | `GenerationStatus` |
| Infographic | `generate_infographic()` | `instructions`, orientation/detail/style/language | Type 7 | `GenerationStatus` |
| Slide deck | `generate_slide_deck()` | `instructions`, format/length/language | Type 8 | `GenerationStatus` |
| Revise slide | `revise_slide()` | `artifact_id`, `slide_index`, `prompt` | `REVISE_SLIDE`/derive artifact | `GenerationStatus` |
| Retry failed | `retry_failed()` | `artifact_id` | `RETRY_ARTIFACT` | `GenerationStatus` |
| Data table | `generate_data_table()` | `instructions`, `language` | Type 9 | `GenerationStatus` |
| Note-backed mind map | `generate_mind_map()` | `instructions`, `language` | `GENERATE_MIND_MAP` -> `CREATE_NOTE` persist | `MindMapResult` |

## Prompt và option mapping

| Artifact | Prompt field | Option nổi bật |
| --- | --- | --- |
| Audio | `instructions` trong audio config | format: deep-dive/brief/critique/debate; length: short/default/long |
| Video | `instructions`; `style_prompt` nếu custom style | format: explainer/brief/cinematic; style: auto/classic/whiteboard/... |
| Report | `custom_prompt` nếu custom; built-in prompt + `extra_instructions` nếu format có sẵn | briefing doc/study guide/blog post/custom |
| Quiz | `instructions` | quantity fewer/standard/more; difficulty easy/medium/hard |
| Flashcards | `instructions` | quantity/difficulty; variant khác quiz |
| Infographic | `instructions` | orientation landscape/portrait/square; detail; style |
| Slide deck | `instructions` | detailed deck/presenter slides; default/short |
| Revise slide | `prompt` | slide index |
| Data table | `instructions` | natural language structure |
| Interactive mind map | `instructions` | prompt nằm ở type-4 variant-4 options slot |

## Report prompt mặc định

| Format | Prompt mặc định |
| --- | --- |
| Briefing Doc | Tạo briefing toàn diện gồm executive summary, phân tích theme, quote quan trọng và actionable insights |
| Study Guide | Tạo study guide gồm key concepts, câu hỏi ngắn, essay prompts, glossary |
| Blog Post | Viết bài blog dễ đọc, có introduction, section rõ ràng, conclusion/takeaways |
| Custom | Dùng `custom_prompt` của caller |

## Polling pipeline

```text
GenerationStatus(task_id)
  -> artifacts.poll_status(notebook_id, task_id)
  -> list/get artifacts
  -> map status code:
       1 -> in_progress
       2 -> pending
       3 -> completed
       4 -> failed
  -> wait_for_completion() backoff đến complete/fail/timeout
```

Điểm hay:

| Điểm | Ý nghĩa |
| --- | --- |
| Poll registry leader/follower | Nhiều caller chờ cùng task không spam poll |
| Drain hook cho polls | Khi close client, poll task được cancel trước khi drain |
| `max_not_found` và window | Chịu được khoảng trễ server chưa list artifact vừa tạo |
| `on_status_change` callback | CLI/UI có thể render trạng thái không cần tự poll |

## Download/export table

| Chức năng | Method | Đầu vào | Pipeline | Đầu ra |
| --- | --- | --- | --- | --- |
| Audio | `download_audio()` | output path, optional artifact id | List/select -> trusted media URL -> streaming download | MP3/MP4 file |
| Video | `download_video()` | output path | Streaming media download | MP4 |
| Infographic | `download_infographic()` | output path | Download image URL | PNG |
| Slide deck | `download_slide_deck(output_format)` | `pdf`/`pptx` | PDF URL hoặc export path | PDF/PPTX |
| Report | `download_report()` | output path | Get artifact content -> write markdown | Markdown |
| Quiz | `download_quiz(format)` | `json`/`markdown`/`html` | Get interactive content -> formatter | JSON/MD/HTML |
| Flashcards | `download_flashcards(format)` | `json`/`markdown`/`html` | Formatter | JSON/MD/HTML |
| Mind map | `download_mind_map()` | artifact id optional | Note-backed JSON hoặc interactive tree | JSON |
| Data table | `download_data_table()` | output path | Parse table rows | CSV |
| Export report | `export_report()` | title/export type | `EXPORT_ARTIFACT` to Drive | export result |
| Export data table | `export_data_table()` | title | Drive export | export result |

## Download safety

| Safety | Cách làm |
| --- | --- |
| Trusted host | `_artifact/_download_client.py`, `_redirect_guard.py` kiểm tra host redirect |
| Cookie source | Load cookies từ storage state riêng cho media download |
| HTML rejection | `_reject_html_download` tránh lưu trang lỗi HTML thành media |
| Empty rejection | `_reject_empty_download` tránh file 0 byte |
| Producer/writer split | Streaming download và ghi file tách để kiểm soát lỗi |

## Điểm hay

| Điểm | Vì sao tốt |
| --- | --- |
| Payload builders riêng | Wire shape phức tạp nằm một nơi, facade mỏng |
| Artifact type public là string enum | Che giấu type code/variant nội bộ |
| Mind map unified | Note-backed và interactive đều hiện qua `ArtifactType.MIND_MAP`/`client.mind_maps` |
| Report template customization | Có thể dùng built-in prompt rồi append instruction |
| Structured exports ngoài web UI | Quiz/flashcards/mind-map/table có JSON/Markdown/CSV |

