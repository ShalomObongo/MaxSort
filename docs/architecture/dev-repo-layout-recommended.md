# Dev & repo layout (recommended)
```
/app
  /src
    /renderer   # React UI
    /main       # Electron main process
    /workers    # Node worker code
    /agents     # Agent manager, task queue
    /lib        # utils (fs, system-monitor, ollama-client)
  /native       # native addon sources (optional)
  /scripts      # build / packaging scripts
  /resources
  package.json
  electron-builder.yml
/tests
  /unit
  /integration
/docs
  architecture.md
  prd.md
```
