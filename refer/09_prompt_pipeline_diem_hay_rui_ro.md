# 09. Prompt pipeline, điểm hay và rủi ro cần chú ý

## Các loại prompt trong repo

| Loại prompt | Nguồn vào | Module | Gửi tới đâu | Đầu ra |
| --- | --- | --- | --- | --- |
| Chat question | `chat.ask(question)` hoặc CLI `ask` | `_chat/wire.py` | Streamed chat endpoint | `AskResult.answer` + citations |
| Persona/custom chat | `chat.configure(custom_prompt)` | `_chat/api.py` | Conversation/config RPC | Config mode/persona |
| Prompt suggestions | `notebooks.suggest_prompts(query, mode)` | `_notebook_payloads.py` | `SUGGEST_PROMPTS` | title + ready-to-send prompt |
| Artifact instructions | `generate_* instructions` | `_artifact/payloads.py` | `CREATE_ARTIFACT` | `GenerationStatus` |
| Video style prompt | `style_prompt` khi `VideoStyle.CUSTOM` | `_artifact/generation.py` | Video config slot | Custom visual style |
| Report custom prompt | `custom_prompt` | `_artifact/payloads.py` | Report config prompt | Report artifact |
| Report extra instructions | `extra_instructions` | `_artifact/payloads.py` | Append vào built-in prompt | Report artifact |
| Slide revision prompt | `revise_slide(prompt)` | `_artifact/payloads.py` | `REVISE_SLIDE` | New/revised slide task |
| Research query | `research.start(query)` | `_research.py` | Research RPC | Research task/report/sources |
| Source text content | `sources.add_text(content)` | `_source/add.py` | `ADD_SOURCE` text source | Source row |
| Mind map instructions | `mind_maps.generate(instructions)` | `_mind_maps_api.py`/artifact payloads | Note-backed hoặc interactive backend | MindMap |

## Prompt flow theo nhóm

### Chat

```text
Người dùng nhập câu hỏi
  -> CLI resolve_prompt()/API argument
  -> ChatAPI.ask()
  -> build_streaming_chat_request(question)
  -> NotebookLM grounded answer
  -> parse citations
  -> optional save_answer_as_note()
```

Điểm hay: câu trả lời được grounding bằng source ids, citations được parse thành `ChatReference` và có thể lưu lại thành note có hover anchors.

### Artifact generation

```text
instructions/custom_prompt/options
  -> _app.generate_plans nếu đi qua CLI/MCP/REST
  -> ArtifactGenerationService
  -> build_<type>_artifact_params()
  -> CREATE_ARTIFACT
  -> wait_for_completion()
  -> download/export
```

Điểm hay: prompt ngắn/dài đều đi qua cùng payload builder; CLI có `--prompt-file` để tránh giới hạn shell và giữ prompt dài sạch hơn.

### Research

```text
query
  -> research.start(source, mode)
  -> Google DiscoverSources pipeline
  -> poll task
  -> report + candidate sources
  -> optional cited-only import
```

Điểm hay: research là một pipeline hoàn chỉnh, biến query thành nguồn NotebookLM, không chỉ trả text.

## Điểm hay nổi bật toàn repo

| Điểm hay | Tác dụng thực tế |
| --- | --- |
| Layered architecture rõ | Dễ mở thêm adapter hoặc domain mà không phá core |
| `_app` trung lập | Một rule validate/confirm/wait dùng cho nhiều bề mặt |
| Typed dataclass/enum | Caller không phải đọc raw nested list |
| Row adapters | Vị trí wire magic nằm trong adapter thay vì rải khắp code |
| Safe decode | Google đổi schema thì lỗi có method id/source/path |
| Idempotency registry | Retry không vô tình tạo trùng source/note/label |
| Auth refresh single-flight | Nhiều request cùng lỗi auth không refresh loạn |
| Runtime drain | Close client không bỏ mặc operation đang chạy |
| Polling registry | Nhiều waiter cùng artifact không nhân poll |
| Upload/download tách RPC | Mỗi kiểu HTTP có timeout/cookie/safety đúng |
| MCP destructive preview | Agent khó xóa nhầm khi chưa confirm |
| REST khóa schema public | Server giữ account credentials không lộ API surface |
| CLI JSON mode | Agent/script có envelope ổn định để parse |

## Rủi ro/khu vực cần chú ý

| Rủi ro | Vì sao | Cách repo giảm thiểu |
| --- | --- | --- |
| Google internal API đổi shape | API undocumented, id/slot có thể đổi | `safe_index`, row adapters, RPC override, decode drift errors |
| Auth/cookie stale | NotebookLM dùng cookie Google phức tạp | refresh, keepalive, storage save, auth check |
| Rate limit | Nhiều source/generate/research dễ bị throttle | retry 429, retry-after, semaphore RPC/upload |
| Non-idempotent retry | Re-POST create/mutate có thể tạo duplicate | idempotency policy + probe wrappers |
| Cross-loop reuse | Async primitives bind loop | lifecycle loop guard, reset semaphore/locks khi reopen |
| Concurrent chat follow-up | Hai follow-up cùng history gây ghost/lost lineage | per-conversation/per-notebook locks |
| File upload lớn | FD/disk/network pressure | upload semaphore, validation, server upload cap |
| Download redirect nguy hiểm | Media URL có thể redirect | trusted-host redirect guard |
| REST exposure | Single-tenant server giữ credential | bearer auth, loopback host, disable docs/openapi |
| MCP destructive action | Agent có thể gọi nhầm delete | `confirm=true` required, preview first |

## Gợi ý mở rộng an toàn

| Muốn thêm | Nên làm |
| --- | --- |
| Thêm CLI command | Tạo logic trung lập trong `_app/` nếu có validate/wait/multi-step, CLI chỉ parse/render |
| Thêm MCP tool | Reuse `_app` hoặc client API, resolve name/id, thêm confirm nếu destructive |
| Thêm REST route | Reuse `_app`, gắn auth dependency, không mở public schema |
| Thêm artifact type | Thêm enum/type mapping, payload builder, parser/listing/download/format nếu cần |
| Thêm RPC mới | Thêm `RPCMethod`, payload builder riêng, row adapter nếu response positional |
| Thêm prompt option | Validate ở app/generation service trước khi encode, normalize prompt rỗng về `None` nếu server không cần blank |
| Thêm retry | Xác định idempotency trước; nếu create có side effect, dùng probe thay vì bật retry |

