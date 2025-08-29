# Storage schema (suggested SQLite tables)

- `files` (`id INTEGER PRIMARY KEY, path TEXT UNIQUE, sha256 TEXT, size INTEGER, mtime INTEGER, last_scanned_at INTEGER`)  
- `suggestions` (`id INTEGER PRIMARY KEY, file_id INTEGER, suggested_name TEXT, confidence REAL, reason TEXT, agent_model TEXT, timestamp INTEGER`)  
- `jobs` (`id INTEGER PRIMARY KEY, type TEXT, status TEXT, created_at INTEGER, completed_at INTEGER`)  
- `operations` (`id INTEGER PRIMARY KEY, job_id INTEGER, file_id INTEGER, op_type TEXT, status TEXT, before_path TEXT, after_path TEXT, timestamp INTEGER`)  
- `settings` (`key TEXT PRIMARY KEY, value TEXT`)

**Notes**: Use WAL mode; keep long texts (reason) stored but consider external file cache for very long model outputs to avoid DB bloat.
