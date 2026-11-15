# FileForge — Organize Smarter. Find Faster.

FileForge is a Windows 10/11 desktop file management system built with Electron, React, TypeScript, Tailwind CSS, Node.js, and SQLite. It scans real directories using background worker threads, detects byte-identical duplicates with streaming SHA-256 hashing, organizes files using multi-signal classification, analyzes storage consumption, and enforces safe, reversible cleanup.

## Key Capabilities

- **Main Dashboard**: Real-time summary of scanned storage, file/folder counts, exact duplicate savings, largest files, recent files, and visual category distribution.
- **File Explorer**: Browse local directories, search, sort by name/size/type/date, filter by extension, inspect metadata, preview text/code/images/PDF/audio/video, rename safely, and open files in their default OS application.
- **Smart File Organizer**: Classifies files using magic-byte header inspection, MIME types, extensions, and filename/metadata heuristics across 8 categories (`Documents`, `Images`, `Videos`, `Audio`, `Archives`, `Applications`, `Code`, `Other files`), with a full dry-run diff preview and 1-click Undo.
- **SHA-256 Duplicate Detection**: Three-stage pipeline (exact byte size filter → 4KB head/tail partial hash → full 64KB streaming SHA-256 in Node.js `worker_threads`). Never flags duplicates by similar filenames alone.
- **Storage Analyzer**: Large file surfacing, recursive folder size breakdown, file-type distribution, aged/stale file detection, and redundant clutter flagging (duplicates, zero-byte files, `.tmp`/`.bak`/`.log`, `Thumbs.db`).
- **Safe Cleanup & Undo**: Explicit approval preview for every destructive action, protected system directory guardrails (`C:\Windows`, `C:\Program Files`, `/etc`, `/usr`), OS Recycle Bin integration (`shell.trashItem` on Windows), and SQLite-backed operation journaling for undo.

## Architecture & Security

- **Electron Security**: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, and strict `contextBridge` IPC in `electron/preload.ts`.
- **Streaming & Workers**: `server/hashWorker.ts` runs hashing in `worker_threads` with `64KB` read streams so large files never load into RAM.
- **SQLite Indexing**: Uses Node.js built-in `node:sqlite` (`DatabaseSync`) in `server/db.ts` for scan history and undoable operation logs.

## Local Development & Running

### Prerequisites
- Node.js **v22.13+** (required for built-in `node:sqlite`)
- Windows 10 or Windows 11 (for native Electron Windows build)

### 1. Install Dependencies
```bash
npm install
```

### 2. Run Web / Full-Stack Preview Mode
```bash
npm run dev
```
Opens the Express + Vite server at `http://localhost:3000`.

### 3. Install Electron & Build Tools (Windows Desktop)
```bash
npm install -D electron electron-builder
```

### 4. Launch Desktop App in Development
```bash
# Terminal 1: Start Vite dev server
npm run dev

# Terminal 2: Compile Electron main/preload & launch Electron
npm run electron:compile && set VITE_DEV_SERVER_URL=http://localhost:3000 && npx electron dist-electron/electron/main.js
```

## Production Windows Build (.exe Installer & Portable)

Build the optimized React bundle, compile the Electron main process, and package the Windows 10/11 NSIS installer + Portable `.exe`:

```bash
npm run build:win
```

Output artifacts are written to `release/`:
- `release/FileForge-Setup-<version>-x64.exe` (Windows NSIS Installer)
- `release/FileForge-Portable-<version>-x64.exe` (Standalone Portable Executable)
