# Overview / Vision
A macOS Electron desktop application that integrates with locally running Ollama models to analyze, rename, and reorganize files in directories. The app should operate in an *agentic* way, with a main agent orchestrating lightweight sub-agents (e.g., `llama3.2:1b`). It must monitor system memory constantly to avoid overload, dynamically throttling sub-agent concurrency. Users can configure which models serve as main and sub-agents, set directory rules, and preview/approve changes before application.

**Rationale / Trade-offs:**
- Chose **Electron** for cross-platform GUI ease + macOS support.  
- Local Ollama API ensures **privacy** and offline capability.  
- Lightweight sub-agents allow **parallelization** but must be memory-throttled.  
- User control over models → balances flexibility vs complexity.  
