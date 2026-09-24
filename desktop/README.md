# Contexto AI — Desktop

A standalone Electron app version of Contexto AI: an AI clipboard panel that
lives on your desktop, summoned from anywhere with a global hotkey or a small
always-visible launcher button — not just inside a browser. It shares the
same storage/AI design as the Chrome extension (local IndexedDB, local
n-gram embeddings, multi-provider LLM client), ported to run outside the
browser sandbox. 100% local storage — nothing syncs anywhere; the only
network calls are to whichever LLM provider you configure, and only when you
ask a question.

The Chrome extension is unaffected — this is a separate, additional app, not
a replacement.

## Run it

**Without installing anything** (once published — see below):
```bash
npx contexto-ai
```

**From source:**
```bash
cd desktop
npm install
npm start
```

- A small circular **launcher button** sits in the bottom-right corner of your screen at all times — click it to open the panel, click again to minimize it back down. Drag it anywhere you like; it remembers where you leave it.
- **⇧⌘K** (Windows/Linux: Ctrl+Shift+K) and the tray icon both do the same open/minimize toggle, as backups.
- The panel itself is **fully movable and resizable** — drag its header to reposition it anywhere, drag any edge to resize. Both persist across restarts.
- Copy any text anywhere on your machine and it's picked up automatically (polled every ~800ms) — the same way the browser extension captures copies on web pages, but system-wide.

## What's different from the Chrome extension

| | Extension | Desktop |
|---|---|---|
| Capture scope | Text copied on web pages | Text copied **anywhere** on the OS |
| Storage | `chrome.storage` / extension IndexedDB | IndexedDB in the app's own window |
| LLM fetch | Background service worker | Electron main process |
| Opening it | Toolbar icon → side panel | Global hotkey or tray icon → slide-out panel |

Settings (API key, model, proxy URL) are **not** shared between the two —
each keeps its own local config, so you'll need to enter your key in both if
you use both.

## Two ways to share this with other people

**1. Publish to npm** — the right choice for developers/technical users who
have Node installed. They run one command, nothing to download manually:

```bash
cd desktop
npm login              # your own npm account — one-time
npm publish            # public by default; add --access public explicitly if npm ever asks
```

After that, anyone can run it with zero setup:
```bash
npx contexto-ai
```
`npx` downloads the (small, ~430KB) package on demand, which in turn pulls in
Electron as a normal dependency — no global install needed. Bumping the
version for updates: `npm version patch` (or `minor`/`major`) then
`npm publish` again.

The `bin/contexto-ai.js` script is what makes this work — it's the entry
point `npx`/the `contexto-ai` command actually runs; it spawns Electron
pointed at this app, since `main/index.js` only runs correctly *inside*
Electron's own runtime, not under plain Node.

**2. A packaged `.dmg`/`.exe`** — better for non-technical people who just
want to double-click and install, no terminal required:

```bash
npm run dist
```

Uses `electron-builder` (see `package.json`'s `build` field), producing
`desktop/dist/*.dmg` / `*.exe`. Unsigned builds trigger Gatekeeper/SmartScreen
warnings — code signing is a separate setup this repo doesn't include yet;
tell recipients to right-click → Open the first time.

## Project structure

```
desktop/
├── package.json
├── bin/
│   └── contexto-ai.js  npm/npx entry point — spawns Electron as a child process
├── main/
│   ├── index.js      Tray, global hotkey, launcher + panel windows, clipboard polling, on-disk config, IPC
│   ├── llm.js         Multi-provider LLM client + RAG orchestrator (ported from src/background/index.js)
│   └── preload.js      contextBridge — the only door between the renderer and Node/Electron
├── renderer/
│   ├── index.html / index.css / index.js   Main panel UI (adapted from src/sidepanel/*)
│   ├── launcher.html / launcher.js          The bottom-right launcher button
│   ├── db.js            IndexedDB layer (copied from src/shared/db.js)
│   ├── embed-engine.js   Local embedder (copied from src/offscreen/embed-engine.js)
│   ├── security.js        Sensitive-data redaction (copied from src/shared/security.js)
│   └── constants.js
└── build/               App/tray icons
```

`main/llm.js` and `renderer/{db,embed-engine,security}.js` are intentionally
copies, not shared imports — there's no build step linking the two apps
together. If you fix a bug in one, check the file with the same name on the
other side.
