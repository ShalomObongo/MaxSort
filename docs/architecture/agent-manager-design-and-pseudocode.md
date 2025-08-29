# Agent Manager — design and pseudocode

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
