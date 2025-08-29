# Acceptance criteria (architecture handoff)

- Agent Manager enforces concurrency based on measured/estimated model memory and respects safety floor (e.g., 2GB reserved).  
- Ollama client module centralizes all model calls with retry, timeout and cancellation support.  
- Rename operations are transactional (journaling) and fully undoable.  
- App runs on Intel and Apple Silicon with documented memory profiles for tested models (e.g., `llama3.2:1b`).
