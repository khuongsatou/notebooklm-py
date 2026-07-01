# 04. Chat, prompt và save-to-note flow

## Chat ask pipeline

```text
client.chat.ask(notebook_id, question, source_ids, conversation_id)
  -> assert đúng event loop
  -> nếu source_ids None: lấy toàn bộ source id từ notebook
  -> chọn lock:
       conversation_id có sẵn -> lock theo conversation
       conversation_id None -> lock theo notebook
  -> build streamed chat request
  -> RuntimeTransport.perform_authed_post()
  -> parse streaming chunks
  -> nếu conversation mới: gọi GET_LAST_CONVERSATION_ID
  -> trả AskResult(answer, references, conversation_id, ...)
```

## Đầu vào/đầu ra chính

| Method | Đầu vào | Prompt nằm ở đâu | Đầu ra |
| --- | --- | --- | --- |
| `ask()` | `notebook_id`, `question`, `source_ids`, `conversation_id` | `question` ở `params[1]` của streamed chat | `AskResult` gồm answer, references, conversation id |
| `get_conversation_turns()` | `notebook_id`, `conversation_id`, `limit` | Không có prompt mới | `list[ConversationTurn]` |
| `get_history()` | notebook/conversation/limit | Không có prompt mới | Text/history typed |
| `delete_conversation()` | notebook + conversation id | Không có | `None` |
| `configure()` | `goal`, `response_length`, `custom_prompt` | `custom_prompt` là persona/instruction | Config result |
| `set_mode()` | `ChatMode` | Mode chuyển thành config | Config result |
| `save_answer_as_note()` | `AskResult`, title | Answer có citation markers | `Note` |

## Streamed chat request

Builder: `src/notebooklm/_chat/wire.py::build_streaming_chat_request`.

Payload logic:

| Slot | Nội dung |
| --- | --- |
| 0 | `sources_array`, mỗi source id bọc depth 2 |
| 1 | `question` |
| 2 | `conversation_history` |
| 3 | Static config `[2, None, [1], [1]]` |
| 4 | `conversation_id` hoặc `None` |
| 5 | `None` |
| 6 | `None` |
| 7 | `notebook_id`, bắt buộc để server persist conversation |
| 8 | `1` |

URL endpoint không phải batchexecute RPC, mà là:

```text
LabsTailwindOrchestrationService/GenerateFreeFormStreamed
```

## Parser response

| Bước | Chi tiết |
| --- | --- |
| Strip anti-XSSI | Dùng chung `strip_anti_xssi()` |
| Scan line/chunk | Hỗ trợ cả byte-count stream và JSON line trực tiếp |
| Chọn answer | Ưu tiên chunk được đánh dấu answer; fallback longest unmarked text |
| Parse citation | Đọc source id, chunk id, cited text, char range |
| Number citations | Giữ raw ordinal nếu có; chỉ fill dense cho ref chưa đánh số |
| Fail mode | Không có chunk parseable -> `ChatResponseParseError`; có chunk nhưng answer rỗng -> trả answer rỗng |

## Conversation handling

| Tình huống | Cách xử lý |
| --- | --- |
| `conversation_id=None` | Server dùng conversation hiện tại của notebook hoặc tạo mới |
| New conversation | Streaming response không trả id thật; sau ask gọi `GET_LAST_CONVERSATION_ID` |
| Follow-up | Truyền conversation id thật vào slot 4 |
| Concurrent follow-up cùng conversation | Lock theo conversation id để không mất lineage |
| Concurrent ask không conversation id | Lock theo notebook id đến khi có id thật |

Điểm hay: repo ghi rõ stream-returned id không phải conversation id thật. Đây là một bug class thực tế: dùng nhầm id này sẽ tạo ghost turn server không ghi nhận.

## Save chat answer as note

Flow:

```text
AskResult(answer có [N], references)
  -> strip citation markers khỏi text hiển thị
  -> map [N] sang ChatReference
  -> build source_passages và rich_content
  -> CREATE_NOTE
  -> parse SavedChatNoteRow/NoteRow
  -> Note
```

| Thành phần | Vai trò |
| --- | --- |
| `_strip_citation_markers()` | Xóa marker `[N]`, đồng thời lưu vị trí anchor trong clean text |
| `_resolve_reference()` | Match citation number với reference; tránh fallback sai khi có hole |
| `_build_source_passage_descriptor()` | Tạo descriptor source passage cho NotebookLM UI hover citation |
| `build_save_chat_as_note_params()` | Tạo payload `CREATE_NOTE` 7 phần tử |

## Prompt/instruction trong chat

| Loại prompt | Nơi dùng | Ý nghĩa |
| --- | --- | --- |
| `question` | `ask()` | Câu hỏi trực tiếp gửi NotebookLM |
| `custom_prompt` | `configure()` | Persona/system-like instruction cho chat |
| `goal` | `configure()` | Mục tiêu chat, map qua `ChatGoal` |
| `response_length` | `configure()` | Điều khiển độ dài câu trả lời |
| `prompt suggestions query` | `notebooks.suggest_prompts()` | Steer để server gợi ý prompt |

## Điểm hay

| Điểm | Vì sao tốt |
| --- | --- |
| Parser phân biệt zero parseable và empty answer | Không coi answer rỗng là wire drift |
| Citation marker không reindex sai | Tránh note hover citation trỏ nhầm nguồn |
| Lock yếu bằng `WeakValueDictionary` | Không phình map lock theo số conversation |
| Chat có timeout dài riêng | Notebook share/source lớn có thể chậm gửi byte đầu tiên |
| Save-to-note giữ citation rich | Note trong NotebookLM UI vẫn có anchor giống web |

