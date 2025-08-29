# Testing strategy

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
