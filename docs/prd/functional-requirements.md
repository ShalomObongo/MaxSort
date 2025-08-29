# Functional Requirements

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
