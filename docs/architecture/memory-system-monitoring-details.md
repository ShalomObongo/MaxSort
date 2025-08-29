# Memory & system monitoring details

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
