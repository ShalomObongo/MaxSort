# Packaging & distribution (macOS specifics)

### Build & signing
- Use `electron-builder` for DMG and notarized packages.  
- Sign main app, helper executables, and any included sidecars.  
- For Python sidecar (if present), build a universal2 binary and sign it and linked dylibs.

### Notarization
- Notarize final DMG/App using Apple notarization; ensure all binaries are signed. Watch out for third-party dylib validation issues with PyInstaller-bundled binaries.

### Auto-update
- Validate update artifacts with signed releases. Provide an opt-in automatic update flow.

### Developer tip
- MVP: avoid including Python sidecar initially to simplify notarization. Add sidecar only when absolutely necessary.
