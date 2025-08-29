# Executive summary
This document defines a pragmatic, production-ready architecture for a macOS Electron desktop app that orchestrates local Ollama models to analyze, rename, and reorganize files while protecting system resources. Key decisions:

- Local-first design: Electron main (Node.js) acts as the backend; Ollama daemon handles inference.
- Agent manager: main agent + multiple sub-agents with concurrency and memory safety controls.
- Heavy work offloaded to workers; renderer kept minimal for responsiveness.
- Optional Python sidecar for advanced parsing (PDF/image) added only when necessary.
- Persistence via local SQLite; packaging via `electron-builder` for macOS notarization.
