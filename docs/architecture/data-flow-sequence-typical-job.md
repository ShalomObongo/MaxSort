# Data flow & sequence (typical job: directory reorg)

1. **User action**: selects a directory in UI → `scan-request` IPC sent to Main.
2. **Scanning**: Main spawns a worker to walk the directory and extract metadata (path, size, mtime, snippet, EXIF).
3. **DB write**: Worker streams metadata; Main writes records to SQLite (or batches writes).
4. **Task generation**: Main enqueues per-file `analyze` tasks into Task Queue.
5. **Agent assignment**: Agent Manager checks available slots and dispatches tasks to sub-agents using Ollama run calls.
6. **Inference**: Ollama runs model(s) and returns summaries/classifications and optional explainability text.
7. **Preview**: Main computes confidence score, stores suggestion, and emits `preview-update` IPC to Renderer.
8. **User decision**: User approves/edits suggestions; main enqueues `apply-rename` job.
9. **Transactional rename**: `apply-rename` writes an operations entry (journal), performs filesystem rename, updates DB.
10. **Undo**: If user requests undo, main replays reverse transaction from operations log to restore previous state.
