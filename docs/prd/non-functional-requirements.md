# Non-Functional Requirements

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
