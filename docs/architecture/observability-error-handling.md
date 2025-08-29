# Observability & error handling

- Centralized rotating log file with levels: DEBUG/INFO/WARN/ERROR.  
- Per-job telemetry recording: duration, memory usage snapshot, success/failure cause.  
- UI error paths show clear remediation steps (reduce concurrency, use smaller model).  
- Crash recovery: detect incomplete jobs on startup, mark them failed or resume safely if possible; provide a recovery UI to review and rollback.
