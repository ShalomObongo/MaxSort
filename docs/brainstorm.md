# Brainstorm Document  
**Topic**: macOS Electron app with Ollama local agents for directory/file organization

---

## 1. Core Objective
Build a macOS Electron desktop app that uses Ollama-hosted local models (user-selectable main agent + lightweight sub-agents such as `llama3.2:1b`) to analyze, rename, and reorganize files in selected directories while actively monitoring memory and capping concurrent sub-agents to avoid overload.

---

## 2. High-Level Architecture
1. Electron UI (Renderer + Main)
2. Local Ollama daemon (via localhost API)
3. Agent Manager (spawns, monitors, throttles agents)
4. Memory & Resource Monitor (macOS native system calls)
5. Task Queue & Planner
6. Policy & User Config Store
7. Local DB / Cache (SQLite/LevelDB)

---

## 3. Key Features
### MVP
- Directory picker & scanner
- Detect Ollama install
- Model selector (main + sub-agents)
- Single-file analysis → suggested rename
- Concurrency cap & memory dashboard

### v1
- Full directory reorganization rules
- Batch-run with undo/redo
- Auto-throttling based on memory
- Per-model memory-cost estimation

### v2
- GPU/Metal awareness
- Plugin system
- Multi-user profiles & scheduling

---

## 4. Concurrency & Memory Strategy
- Estimate per-model memory footprint
- Slot calculation:  
  `max_concurrent = (available_memory - os_reserved) / (avg_model_mem * safety_factor)`
- Poll memory every 500–1000ms
- Gracefully abort agents when memory low
- Ephemeral vs pooled models
- User-set safety profiles (aggressive/balanced/conservative)

---

## 5. Ollama Integration
- Prefer Ollama HTTP API (`localhost:11434`)
- CLI fallback with `ollama run`
- Query model list with `ollama list` / `/models`
- Require user-installed Ollama initially (avoid bundling)

---

## 6. File Analysis & Rename Strategy
- Pipeline: extract metadata → summarize → propose new name → compare with existing
- Agents:
  - Main agent: orchestrator & validator
  - Sub-agents: lightweight summarizers/classifiers
- Show reasoning for each rename
- Preview/dry-run by default

---

## 7. UX Flow
1. Setup (detect Ollama, show system health)
2. Directory selector
3. Policy & model settings
4. Scan & Preview
5. Batch Actions
6. History & Undo
7. Advanced (rules, scheduling)

---

## 8. Tech Stack
- Electron + React/TypeScript
- Node workers for heavy tasks
- SQLite/LevelDB for metadata
- Native macOS memory APIs (`sysctl`, `vm_stat`)
- `electron-builder` for packaging

---

## 9. Risks & Mitigations
- Memory overload → safety factor, auto-kill
- Wrong renames → dry-run, undo
- Ollama bundling complexity → prefer user install
- Electron bloat → move heavy tasks off renderer

---

## 10. Implementation Plan (MVP)
- Sprint 0: Setup repo, detect Ollama
- Sprint 1: Single-file analyze + UI preview
- Sprint 2: Agent manager + concurrency cap
- Sprint 3: Batch preview, DB, packaging
- Sprint 4: QA, profiling, privacy review

---

## 11. Default Parameters
- OS reserved: 2 GB
- Safety factor: 1.5
- Poll interval: 1000 ms
- Default concurrency: min(2, computed_slots)
- Default sub-agent: `llama3.2:1b`

---

## 12. Next Steps
- Create PRD from brainstorm
- Draft architecture doc
- Prototype Electron + Ollama integration (single-file rename)
