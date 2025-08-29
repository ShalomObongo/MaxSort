# IPC, APIs & contracts

### Renderer ↔ Main (IPC channels)
- `scan-request` `{ rootPath, include, exclude, options }` → main starts scanning.  
- `scan-progress` `{ fileCount, currentFile, percent }` ← main to renderer.  
- `preview-update` `{ fileId, suggestedName, confidence, reason }` ← main to renderer.  
- `apply-batch` `{ batchId, fileIds }` → main returns `{ success, failures }`.  
- `settings-update` `{ profiles, concurrency, reservedMemory }` → main persists settings.  
- `system-health-request` → `system-health-response` `{ freeMem, totalMem, cpuLoad, agentCount }`.

**Security**: Validate and sanitize all IPC payloads. Do not allow renderer to request arbitrary FS paths without user consent.

### Main → Ollama (local HTTP)
- `GET /models` — list available models.  
- `POST /run` — run a model with prompt and params. Prefer streaming API if available to support progressive preview and cancellation.  
- **Timeouts/Cancellation**: implement request-level timeouts and cancellation via Ollama's abort mechanisms or by closing the stream.

### Main ↔ Python sidecar (if used)
- Use Unix Domain Socket (UDS) or stdio protocol (length-prefixed JSON).  
- Contract example for PDF analysis:
```json
{ "id": 42, "method": "analyze_pdf", "params": { "path": "/Users/sh", "maxPages": 5 } }
```
