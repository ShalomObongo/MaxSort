# Appendix: implementation hints & references

- **Ollama**: use local HTTP API (default: `localhost:11434`) and streaming endpoints when available.  
- **macOS memory**: `vm_stat` or `host_statistics64` provide more reliable memory stats than Node `os.freemem()`.  
- **Packaging**: `electron-builder` docs and Apple notarization guides for universal binaries.  
- **Python sidecar**: pack with PyInstaller as universal2; prefer launch-on-demand and UDS communication to avoid open loopback ports.

---

**End of Architecture Document**
