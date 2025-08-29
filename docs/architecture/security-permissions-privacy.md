# Security, permissions & privacy

- **Filesystem access**: request access only to user-selected directories. Avoid full-disk access unless absolutely necessary and explain why to users.  
- **Network exposure**: bind Ollama communications to `localhost` only. Do not expose remote API unless user opts in.  
- **Sandbox/entitlements**: if distributing via Mac App Store, ensure entitlements match file access patterns.  
- **Data retention**: allow users to purge metadata cache & history; implement "forget all" option.  
- **Telemetry**: opt-in only, anonymized, and minimal if included.
