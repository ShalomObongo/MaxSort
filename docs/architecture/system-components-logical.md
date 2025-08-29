# System components (logical)

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
