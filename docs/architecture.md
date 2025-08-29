# Full-Stack Architecture Document
**Project**: macOS Electron App with Ollama Local Agents for File Organization  
**Author**: Winston — Architect  
**Date**: 2025-08-28

---

## Executive summary
This document defines a pragmatic, production-ready architecture for a macOS Electron desktop app that orchestrates local Ollama models to analyze, rename, and reorganize files while protecting system resources. Key decisions:

- Local-first design: Electron main (Node.js) acts as the backend; Ollama daemon handles inference.
- Agent manager: main agent + multiple sub-agents with concurrency and memory safety controls.
- Heavy work offloaded to workers; renderer kept minimal for responsiveness.
- Optional Python sidecar for advanced parsing (PDF/image) added only when necessary.
- Persistence via local SQLite; packaging via `electron-builder` for macOS notarization.

---

## Table of contents
1. Executive summary
2. System components (logical)
3. Data flow & sequence (typical job)
4. IPC, APIs & contracts
5. Agent Manager — design and pseudocode
6. Memory & system monitoring details
7. Storage schema (SQLite recommendation)
8. Packaging & distribution (macOS specifics)
9. Security, permissions & privacy
10. Observability & error handling
11. Testing strategy
12. Dev & repo layout
13. Acceptance criteria
14. Roadmap for architecture roll-out
15. Appendix: implementation hints & references

---

## 1. System components (logical)

### Renderer (Electron UI)
- React + TypeScript UI for directory picker, preview, policies, logs, and system health.  
- Lightweight — heavy work delegated to main or workers.  
- Communicates with main process via secure IPC channels (`ipcRenderer`).

### Main process (Electron / Node)
- Acts as the application backend. Responsibilities:
  - Task orchestration and job lifecycle management.
  - Agent Manager hosting and supervision.
  - Communication with Ollama daemon (HTTP) and optional sidecars.
  - System resource monitoring and enforcement of safety policies.
  - Persistence coordination (SQLite/LevelDB).
  - Expose sanitized IPC endpoints to renderer.

### Worker processes / Job runners
- Node worker threads or short-lived child processes for compute-heavy tasks:
  - File scanning and metadata extraction.
  - Binary file heuristics, hashing, thumbnailing.
  - File-type specific extraction (text, EXIF, embedded metadata).
- Workers report progress to main and are monitored for memory/CPU usage.

### Agent Manager
- Controls launching and supervising model invocations (sub-agents).
- Implements concurrency limits, model memory estimation, adaptive polling, and emergency eviction policies.
- Maintains prioritized task queues (interactive vs batch).

### Ollama Daemon (external process)
- Local LLM inference server (default `localhost:11434` HTTP API).
- Pulls and serves local models; performs inference runs (main agent orchestration & sub-agent invocations).

### Local persistence
- SQLite (recommended) for file metadata, suggestions, jobs, operations, and settings.
- WAL journaling for concurrent writes; large text blobs offloaded to file cache if necessary.

### Optional Python Sidecar (future)
- Launch-on-demand universal2 PyInstaller binary for Python-only workloads (PDF layout analysis, advanced image processing).
- Communicates over Unix Domain Socket (UDS) or stdio with JSON-RPC or length-prefixed messages.
- Not included in MVP; added only if Node ecosystem cannot meet needs.

### System Monitor
- Accurate macOS metrics collector using `vm_stat`/`sysctl` or a small native addon calling `host_statistics64`.
- Tracks free memory, per-PID RSS, CPU load, and optionally GPU/Metal usage.

### Installer / Updater
- `electron-builder` for building signed and notarized `.dmg` and updater feeds.
- Auto-update mechanism optional; must validate signatures.

---

## 2. Data flow & sequence (typical job: directory reorg)

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

---

## 3. IPC, APIs & contracts

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

---

## 4. Agent Manager — design and pseudocode

### Goals
- Maximize throughput while protecting system stability.  
- Dispatch interactive tasks preferentially to keep UI snappy.  
- Respect per-model memory costs and global safety floor.  
- Provide graceful cancellation and emergency eviction paths.

### Key concepts
- **Slot**: capacity to run one concurrent model invocation. Depends on model memory footprint.  
- **Safety floor**: reserved RAM (e.g., 2GB) for OS and app comfort.  
- **Safety factor**: multiplier (1.5–2.0) applied to per-model memory estimate.  
- **Priority queues**: interactive tasks > scheduled batch tasks > low-priority background tasks.

### Slot calculation
```
available_for_agents = max(0, free_memory - reserved_for_os)
slot_size = model_estimated_memory * safety_factor
max_slots = floor(available_for_agents / slot_size)
```

### Pseudocode (Node-style, simplified)
```js
class AgentManager {
  constructor({safetyFactor=1.5, osReserve=2*GB}) {
    this.safetyFactor = safetyFactor;
    this.osReserve = osReserve;
    this.slots = []; // active runs
    this.queue = new PriorityQueue();
    this.modelMemory = {}; // {modelName: bytes}
    setInterval(()=> this.pollSystem(), 1000);
  }

  async pollSystem() {
    const stats = await SystemMonitor.getStats();
    this.availableForAgents = Math.max(0, stats.freeMem - this.osReserve);
    this.recomputeMaxSlots();
    this.tryDispatch();
  }

  recomputeMaxSlots() {
    const avgModel = this.estimateAvgModelMemory();
    this.maxConcurrent = Math.max(1, Math.floor(this.availableForAgents / (avgModel * this.safetyFactor)));
  }

  enqueue(task) {
    this.queue.push(task);
    this.tryDispatch();
  }

  tryDispatch() {
    while (this.slots.length < this.maxConcurrent && !this.queue.isEmpty()) {
      const task = this.queue.pop();
      this.launch(task);
    }
  }

  async launch(task) {
    const run = OllamaClient.run(task.model, task.prompt, {timeout:task.timeout});
    this.slots.push(run);
    try {
      const res = await run.result();
      this.onSuccess(task, res);
    } catch (err) {
      this.onFailure(task, err);
    } finally {
      this.slots = this.slots.filter(r => r !== run);
      this.tryDispatch();
    }
  }

  emergencyEvict() {
    const victim = chooseVictim(this.slots);
    victim.abort();
  }
}
```

**Implementation notes**: Use per-task timeouts, exponential backoff for retries, and prefer stream-based responses for longer tasks.

---

## 5. Memory & system monitoring details

### Granularity & polling
- Default poll interval: **1000 ms**. Adaptive: **500 ms** when free memory < 20% or when many agents are active.  
- Use sliding windows to smooth spikes before evicting tasks.

### Metrics to collect
- **Free memory**: computed from `vm_stat` and conversions (more reliable than `os.freemem()` on macOS).  
- **Per-PID RSS**: to measure workers and sidecars.  
- **CPU load**: 1m/5m/15m load averages to avoid CPU saturation.  
- **GPU/Metal**: optional telemetry if Ollama uses GPU/Metal.

### Actions based on thresholds
- **Soft threshold** (e.g., free < safety floor + 1GB): stop dispatching new tasks.  
- **Hard threshold** (free < safety floor): pause or abort lowest-priority tasks, notify user.  
- **Critical threshold**: stop all agents, flush queue, show immediate alert.

### Implementation techniques
- Use `spawn('vm_stat')` or a small native addon calling `host_statistics64` for precise memory stats.  
- Track PID RSS by calling `ps` with appropriate flags or using a native API for performance.

---

## 6. Storage schema (suggested SQLite tables)

- `files` (`id INTEGER PRIMARY KEY, path TEXT UNIQUE, sha256 TEXT, size INTEGER, mtime INTEGER, last_scanned_at INTEGER`)  
- `suggestions` (`id INTEGER PRIMARY KEY, file_id INTEGER, suggested_name TEXT, confidence REAL, reason TEXT, agent_model TEXT, timestamp INTEGER`)  
- `jobs` (`id INTEGER PRIMARY KEY, type TEXT, status TEXT, created_at INTEGER, completed_at INTEGER`)  
- `operations` (`id INTEGER PRIMARY KEY, job_id INTEGER, file_id INTEGER, op_type TEXT, status TEXT, before_path TEXT, after_path TEXT, timestamp INTEGER`)  
- `settings` (`key TEXT PRIMARY KEY, value TEXT`)

**Notes**: Use WAL mode; keep long texts (reason) stored but consider external file cache for very long model outputs to avoid DB bloat.

---

## 7. Packaging & distribution (macOS specifics)

### Build & signing
- Use `electron-builder` for DMG and notarized packages.  
- Sign main app, helper executables, and any included sidecars.  
- For Python sidecar (if present), build a universal2 binary and sign it and linked dylibs.

### Notarization
- Notarize final DMG/App using Apple notarization; ensure all binaries are signed. Watch out for third-party dylib validation issues with PyInstaller-bundled binaries.

### Auto-update
- Validate update artifacts with signed releases. Provide an opt-in automatic update flow.

### Developer tip
- MVP: avoid including Python sidecar initially to simplify notarization. Add sidecar only when absolutely necessary.

---

## 8. Security, permissions & privacy

- **Filesystem access**: request access only to user-selected directories. Avoid full-disk access unless absolutely necessary and explain why to users.  
- **Network exposure**: bind Ollama communications to `localhost` only. Do not expose remote API unless user opts in.  
- **Sandbox/entitlements**: if distributing via Mac App Store, ensure entitlements match file access patterns.  
- **Data retention**: allow users to purge metadata cache & history; implement “forget all” option.  
- **Telemetry**: opt-in only, anonymized, and minimal if included.

---

## 9. Observability & error handling

- Centralized rotating log file with levels: DEBUG/INFO/WARN/ERROR.  
- Per-job telemetry recording: duration, memory usage snapshot, success/failure cause.  
- UI error paths show clear remediation steps (reduce concurrency, use smaller model).  
- Crash recovery: detect incomplete jobs on startup, mark them failed or resume safely if possible; provide a recovery UI to review and rollback.

---

## 10. Testing strategy

### Unit tests
- AgentManager logic, slot calculation, queue handling (mock SystemMonitor and Ollama).

### Integration tests
- Scanning → suggest → apply pipeline on synthetic datasets and on real small datasets. 

### Stress & fuzz tests
- Simulate many concurrent agent runs under low-memory conditions; verify throttling and emergency eviction behaviors.

### Multi-arch testing
- Run CI jobs on Intel (x64) and Apple Silicon (arm64) macOS runners to verify behavior and binary compatibility.

### Manual UAT
- Test with real user data: PDFs, images, code files, and mixed folders to iteratively tune rename heuristics and confidence thresholds.

---

## 11. Dev & repo layout (recommended)
```
/app
  /src
    /renderer   # React UI
    /main       # Electron main process
    /workers    # Node worker code
    /agents     # Agent manager, task queue
    /lib        # utils (fs, system-monitor, ollama-client)
  /native       # native addon sources (optional)
  /scripts      # build / packaging scripts
  /resources
  package.json
  electron-builder.yml
/tests
  /unit
  /integration
/docs
  architecture.md
  prd.md
```

---

## 12. Acceptance criteria (architecture handoff)

- Agent Manager enforces concurrency based on measured/estimated model memory and respects safety floor (e.g., 2GB reserved).  
- Ollama client module centralizes all model calls with retry, timeout and cancellation support.  
- Rename operations are transactional (journaling) and fully undoable.  
- App runs on Intel and Apple Silicon with documented memory profiles for tested models (e.g., `llama3.2:1b`).

---

## 13. Roadmap for architecture roll-out

- **Phase 1 (MVP)**: Node-only backend, basic agent manager, single-file rename, memory monitoring, packaging without sidecar.  
- **Phase 2 (v1)**: Batch renaming, rules engine, profiles, improved UI, extended tests.  
- **Phase 3 (v2)**: Optional Python sidecar for advanced parsing, GPU/Metal awareness, plugin system, cross-platform port planning.

---

## 14. Appendix: implementation hints & references

- **Ollama**: use local HTTP API (default: `localhost:11434`) and streaming endpoints when available.  
- **macOS memory**: `vm_stat` or `host_statistics64` provide more reliable memory stats than Node `os.freemem()`.  
- **Packaging**: `electron-builder` docs and Apple notarization guides for universal binaries.  
- **Python sidecar**: pack with PyInstaller as universal2; prefer launch-on-demand and UDS communication to avoid open loopback ports.

---

**End of Architecture Document**
