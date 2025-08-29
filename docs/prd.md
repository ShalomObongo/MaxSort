# Product Requirements Document (PRD)
**Project**: macOS Electron App with Ollama Local Agents for File Organization

---

## 1. Overview / Vision
A macOS Electron desktop application that integrates with locally running Ollama models to analyze, rename, and reorganize files in directories. The app should operate in an *agentic* way, with a main agent orchestrating lightweight sub-agents (e.g., `llama3.2:1b`). It must monitor system memory constantly to avoid overload, dynamically throttling sub-agent concurrency. Users can configure which models serve as main and sub-agents, set directory rules, and preview/approve changes before application.

**Rationale / Trade-offs:**
- Chose **Electron** for cross-platform GUI ease + macOS support.  
- Local Ollama API ensures **privacy** and offline capability.  
- Lightweight sub-agents allow **parallelization** but must be memory-throttled.  
- User control over models → balances flexibility vs complexity.  

---

## 2. Goals & Non-Goals

**Goals**
1. Enable users to **analyze, rename, and reorganize directories** using Ollama local models.  
2. Provide an **agentic system** with a configurable main agent + lightweight sub-agents.  
3. Implement **real-time memory monitoring** to prevent overload, with dynamic throttling of sub-agents.  
4. Deliver a **user-friendly macOS app** (Electron-based) with previews, undo, and confidence scores for renames.  
5. Ensure **privacy-first operation** (no data leaves local machine).  

**Non-Goals**
1. Not aiming for **cloud-based file management** (local-only in v1).  
2. Not a full **file backup/sync solution** (focus is organization, not redundancy).  
3. Not initially targeting **cross-platform builds** (Windows/Linux may come later).  
4. No advanced **semantic search across files** in MVP (could be a v2+ feature).  

---

## 3. User Stories & Personas

**Persona 1: The Organized Student (primary)**  
- Wants lecture PDFs renamed by topic/date.  
- Story: *As a student, I want the app to automatically rename lecture files so I can find material easily.*  

**Persona 2: The Creative Professional**  
- Works with thousands of photos/media files.  
- Story: *As a creative professional, I want the app to reorganize photos into project-based folders.*  

**Persona 3: The Knowledge Worker**  
- Manages client docs with confusing filenames.  
- Story: *As a professional, I want preview + confidence scores so I can trust rename accuracy.*  

**Persona 4: The Power User (secondary)**  
- Tech-savvy, wants full agent/memory control.  
- Story: *As a power user, I want to configure main/sub agents and concurrency settings.*  

---

## 4. Functional Requirements

**Core Features (MVP)**  
1. Directory selection with include/exclude patterns.  
2. File analysis & rename suggestions (main agent orchestrates, sub-agents summarize/classify).  
3. Reorganization with preview/dry-run + undo.  
4. Agent management (select main/sub agent, set concurrency, light mode).  
5. Memory monitoring with safety factor, auto-throttling.  
6. Electron UI with directory picker, rename preview, logs/history, system health panel.  

**Post-MVP (v1 → v2)**  
- Batch actions with thresholds.  
- Rename templates (regex, metadata rules).  
- Scheduling & automation.  
- Model management (list, pull).  
- User profiles for resource settings.  
- Plugin system for domain-specific tasks.  

**Architecture Note**  
- **Backend** = Electron main process (Node.js). Handles file I/O, memory monitoring, task orchestration.  
- **Ollama Daemon** (`localhost:11434`) handles inference.  
- **SQLite/LevelDB** for metadata, history, and settings.  
- **Optional Python Sidecar (future)**: Only added if Node ecosystem insufficient. Built as universal2 binary, launched on-demand, communicates via stdio or sockets, signed/notarized with app.  

---

## 5. Non-Functional Requirements

**Performance**  
- 1,000 files processed under 5 minutes (MacBook Air M1, 8GB).  
- ≤ 75% memory consumption, graceful throttling.  
- UI response <200ms.  

**Security & Privacy**  
- Fully local operations.  
- No cloud calls unless explicit export.  
- macOS sandboxing & signing compliance.  

**Usability**  
- Drag-and-drop directories.  
- Rename previews + undo for every batch.  
- Confidence scores shown clearly.  
- Preconfigured profiles to reduce complexity.  

**Reliability**  
- Crash recovery with saved state.  
- Full rename log for rollback.  
- Tested on Intel + Apple Silicon Macs.  

**Extensibility**  
- Modular agent management layer.  
- Prepared for optional Python sidecar.  
- Roadmap includes multi-platform support.  

---

## 6. Success Metrics

**User Adoption & Satisfaction**  
- ≥ 60% of installs → active job run within first week.  
- ≥ 70% rename acceptance rate.  
- Undo rate <15%.  
- ≥ 4.2/5 feedback score.  

**Performance Metrics**  
- 1,000 files in <5 min (baseline hardware).  
- Memory usage ≤ 75% of available RAM.  
- 95% UI interactions <200ms latency.  

**Reliability Metrics**  
- ≥ 99% crash-free sessions.  
- 100% file ops logged & reversible.  
- ≥ 95% successful crash recovery.  

---

## 7. Risks & Mitigations

- **Electron overhead** → Keep renderer light, push work to Node workers.  
- **Rename accuracy** → Confidence scores, explanations, dry-run, undo.  
- **System resource spikes** → Adaptive polling, throttling, ≥2GB reserved.  
- **Agent overhead** → Light mode option, user profiles.  
- **Packaging complexity (Python)** → MVP stays Node-only; if added, Python is sidecar (on-demand, signed/notarized).  
- **Scope creep (cloud/search)** → Clearly communicate local-only MVP scope.  
- **Cross-platform gap** → Abstract design, plan for future porting.  

---

## 8. Milestones / Roadmap

**MVP (0.1 → 1.0)**  
- Directory picker & scanner  
- Ollama detection, model selection  
- Single-file rename preview + undo  
- Basic agent manager (main/sub-agent selection)  
- Memory monitoring & concurrency cap  
- Minimal UI with logs/history  

**v1 (~3–6 months)**  
- Batch renaming + reorganization rules  
- Confidence thresholds (auto-accept)  
- Undo/redo stack  
- Custom rename templates  
- System health dashboard  
- Preconfigured profiles (Conservative/Balanced/Aggressive)  

**v2 (~6–12 months)**  
- Scheduling & automation  
- Plugin system (domain-specific)  
- Multi-user profiles  
- GPU/Metal acceleration awareness  
- Optional Python sidecar for advanced parsing  
- Roadmap exploration for Windows/Linux ports  
- Semantic search (stretch goal)  

---

**End of PRD**
