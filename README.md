# Contexto AI — Privacy-First AI Clipboard

> Enterprise-grade AI clipboard assistant. Every user's data stays **100% on their device**. You control the AI through your own API key and proxy.

Two apps live in this repo: the **Chrome extension** (below) and a
**desktop app** (`desktop/`) — a slide-out panel docked to the screen edge,
summoned with a global hotkey, that captures copies from anywhere on your
machine, not just the browser. See [`desktop/README.md`](desktop/README.md).

---

## For end users

### Install
1. Download and unzip the extension
2. Open Chrome → `chrome://extensions`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** → select the `contexto` folder
5. Click the Contexto AI icon in your toolbar

### First-time setup
1. Open the side panel (click the toolbar icon)
2. Click **⚙ Settings** (top-right gear icon)
3. Paste your API key → select model → click **Save Settings**

### Usage

| What you type | What happens |
|---|---|
| `what is my wifi password?` | AI searches your saved notes and answers |
| `my wifi password is hunter2` | AI extracts the fact and saves it as a note |
| `find my github token` | AI retrieves your saved token |
| `remember: server ip is 10.0.0.1` | Saved verbatim as a note |
| Copy text on any webpage | Automatically captured to your clipboard history |

- **Enter** — submit
- **Shift+Enter** — new line in composer
- Click any card to copy it instantly
- Search bar — full-text semantic search across all clips and notes

---

## For operators (you)

### Architecture

```
User device (100% local)          Your infrastructure
┌─────────────────────────┐       ┌─────────────────────┐
│  IndexedDB              │       │  Your Proxy / API   │
│  (clips + notes)        │       │  - Rate limiting    │
│         │               │       │  - Per-user billing │
│  Background SW          │──────▶│  - Usage logging    │
│  (orchestrator)         │       │  - Auth layer       │
│         │               │       └──────────┬──────────┘
│  Side Panel UI          │                  │
└─────────────────────────┘       ┌──────────▼──────────┐
                                  │  OpenAI / Anthropic │
                                  │  (GPT-4o-mini etc)  │
                                  └─────────────────────┘
```

### What hits your proxy
- Only **query + top-8 relevant context snippets**, ranked by embedding similarity to the query (text only, no vectors, no metadata)
- ~2 LLM calls per user query: intent classification (~5 tokens) + RAG answer (~400 tokens)
- Saves: ~2 LLM calls: intent classification + fact extraction

### What never leaves the user's device
- Full clipboard history
- All saved notes
- Vector embeddings
- Browsing context (URLs, page titles, favicons)

### Deploying your proxy

The proxy URL field only applies to OpenAI models — point customers to your proxy in Settings and it receives standard OpenAI-compatible requests:

```js
// Example proxy (Node/Express)
app.post('/v1/chat/completions', authenticate, rateLimit, async (req, res) => {
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + process.env.OPENAI_KEY,
                'Content-Type': 'application/json' },
    body: JSON.stringify(req.body)
  });
  res.json(await resp.json());
});
```

Claude and Gemini models call their official APIs directly with the user's key (`api.anthropic.com` / `generativelanguage.googleapis.com`) — the background service worker (`src/background/index.js`) detects the provider from the model id and builds the correct request/response shape for each.

### Supported models (configurable in Settings)
- `gpt-4o-mini` — default, fast, cheap (~$0.002/1K queries)
- `gpt-4o` — smarter, higher cost
- `gpt-3.5-turbo` — cheapest
- `claude-haiku-20240307` — Anthropic, fast
- `claude-3-5-haiku-20241022` — Anthropic, latest Haiku
- `gemini-2.0-flash` — Google, fast, cheap
- `gemini-1.5-pro` — Google, smarter

---

## Project structure

```
contexto/
├── manifest.json                  MV3 manifest
├── package.json                   Dev tooling
├── public/icons/                  Extension icons
├── src/
│   ├── background/index.js        Service Worker — multi-provider LLM client, RAG orchestrator, message router
│   ├── content/index.js           Clipboard capture (injected on all pages)
│   ├── offscreen/
│   │   ├── index.html             Hidden document (ES modules + IndexedDB)
│   │   ├── index.js               DB operations + embedding handler
│   │   └── embed-engine.js        Local n-gram FNV hash embedder (no network)
│   ├── shared/
│   │   ├── constants.js           Message type constants
│   │   ├── db.js                  IndexedDB CRUD layer
│   │   ├── security.js            Sensitive data stripping (for auto-captures)
│   │   └── intent.js              Local regex intent classifier
│   └── sidepanel/
│       ├── index.html             Side panel UI
│       ├── index.css              Dark theme styles
│       └── index.js               UI controller
└── tests/
    ├── embedder.test.js           CSP + embedding + storage tests (24 assertions)
    └── ai.test.js                 AI layer + settings + routing tests (55 assertions)
```

---

## Running tests

```bash
node tests/embedder.test.js   # 24 tests
node tests/ai.test.js         # 55 tests
```

All 79 tests should pass with zero failures.

---

## Security model

| Threat | Mitigation |
|---|---|
| Sensitive data in auto-captures | Regex redaction before embed+store |
| User notes with secrets | Stored verbatim (user explicitly saves) |
| API key exposure | Stored in `chrome.storage.local`, never in source |
| XSS via clip content | All content HTML-escaped before render |
| Data exfiltration | Zero outbound calls except LLM proxy queries |
| Stale Chrome module cache | `embed-engine.js` naming forces fresh load |

