# Risks & Mitigations

- **Electron overhead** → Keep renderer light, push work to Node workers.  
- **Rename accuracy** → Confidence scores, explanations, dry-run, undo.  
- **System resource spikes** → Adaptive polling, throttling, ≥2GB reserved.  
- **Agent overhead** → Light mode option, user profiles.  
- **Packaging complexity (Python)** → MVP stays Node-only; if added, Python is sidecar (on-demand, signed/notarized).  
- **Scope creep (cloud/search)** → Clearly communicate local-only MVP scope.  
- **Cross-platform gap** → Abstract design, plan for future porting.  
