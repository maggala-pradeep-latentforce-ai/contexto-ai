// Contexto AI - Desktop Main Process
// Owns: the small always-visible launcher button (bottom-right corner), the
// slide-out panel it opens, the tray icon + global hotkey as secondary
// access, OS-wide clipboard polling, on-disk config, and the privileged LLM
// fetch (kept here instead of the renderer — no page CSP to fight, one
// trusted place for keys).

const { app, BrowserWindow, Tray, Menu, globalShortcut, clipboard, ipcMain, screen, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { orchestrate } = require('./llm.js');

const PANEL_WIDTH_DEFAULT = 380;
const PANEL_MIN_WIDTH = 300;
const PANEL_MAX_WIDTH = 640;
const PANEL_MIN_HEIGHT = 320;
const LAUNCHER_BTN_SIZE = 52;
// The window is bigger than the button so a CSS drop-shadow has room to
// render without getting clipped at the window edge.
const LAUNCHER_PAD  = 14;
const LAUNCHER_SIZE = LAUNCHER_BTN_SIZE + LAUNCHER_PAD * 2;
const LAUNCHER_MARGIN = 20;
const HOTKEY = 'CommandOrControl+Shift+K';
const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');
const LAUNCHER_POS_PATH = path.join(app.getPath('userData'), 'launcher-pos.json');
const PANEL_BOUNDS_PATH = path.join(app.getPath('userData'), 'panel-bounds.json');
const CLIPBOARD_POLL_MS = 800;

let panel = null;
let launcher = null;
let tray = null;
let lastClipText = '';
// True once the user has actually dragged the panel — switches it from the
// "docked, slides in from the screen edge" default to a plain floating
// window that just shows/hides wherever it was left.
let panelMovedByUser = false;
// Set while WE move the window programmatically (the slide animation), so
// the 'moved' listener can tell that apart from a real user drag.
let suppressBoundsSave = false;

function loadLauncherPos() {
  try { return JSON.parse(fs.readFileSync(LAUNCHER_POS_PATH, 'utf8')); }
  catch { return null; }
}
function saveLauncherPos(x, y) {
  try {
    fs.mkdirSync(path.dirname(LAUNCHER_POS_PATH), { recursive: true });
    fs.writeFileSync(LAUNCHER_POS_PATH, JSON.stringify({ x, y }));
  } catch { /* non-critical */ }
}

// Returns null until the user has actually moved the panel — that's also
// used as the signal for whether to use the docked default or restore a
// freeform position (see panelMovedByUser).
function loadPanelBounds() {
  try { return JSON.parse(fs.readFileSync(PANEL_BOUNDS_PATH, 'utf8')); }
  catch { return null; }
}
function savePanelBounds(x, y, width, height) {
  try {
    fs.mkdirSync(path.dirname(PANEL_BOUNDS_PATH), { recursive: true });
    fs.writeFileSync(PANEL_BOUNDS_PATH, JSON.stringify({ x, y, width, height }));
  } catch { /* non-critical */ }
}

// ── Config (api key / proxy url / model) — plain JSON on disk, mirrors the
// extension's chrome.storage.local schema so behavior stays familiar ──────
function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { apiKey: '', proxyUrl: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini' };
  }
}
function saveConfig(cfg) {
  const clean = {
    apiKey:   cfg.apiKey   || '',
    proxyUrl: cfg.proxyUrl || 'https://api.openai.com/v1/chat/completions',
    model:    cfg.model    || 'gpt-4o-mini',
  };
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(clean, null, 2));
  return clean;
}

// ── Launcher — a small circular button pinned to the bottom-right corner,
// always visible. This is the primary, explicit open/minimize control the
// tray icon and hotkey are just backups for. ──────────────────────────────
function createLauncher() {
  const { x, y, width, height } = screen.getPrimaryDisplay().workArea;
  const saved = loadLauncherPos();
  const startX = saved ? saved.x : x + width  - LAUNCHER_SIZE - LAUNCHER_MARGIN;
  const startY = saved ? saved.y : y + height - LAUNCHER_SIZE - LAUNCHER_MARGIN;

  launcher = new BrowserWindow({
    width: LAUNCHER_SIZE,
    height: LAUNCHER_SIZE,
    x: startX,
    y: startY,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    // A transparent window's *native* shadow renders as a solid rounded-
    // rect silhouette on macOS instead of a soft shadow — that's the halo
    // artifact. The button draws its own CSS shadow instead.
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  launcher.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  launcher.loadFile(path.join(__dirname, '..', 'renderer', 'launcher.html'));
  launcher.once('ready-to-show', () => launcher.show());

  // Remember wherever the user drags it to.
  // Debounced — manual dragging fires many bounds updates per second.
  let savePosTimer = null;
  launcher.on('moved', () => {
    clearTimeout(savePosTimer);
    savePosTimer = setTimeout(() => {
      const b = launcher.getBounds();
      saveLauncherPos(b.x, b.y);
    }, 150);
  });
}

// ── Panel window — frameless, freely movable and resizable. Docked to the
// right edge with a slide-in animation by default; once the user drags it
// anywhere, it just remembers that spot and shows/hides there instead. ────
function createPanel() {
  const display = screen.getPrimaryDisplay();
  const { x, y, width, height } = display.workArea;
  const saved = loadPanelBounds();
  panelMovedByUser = !!saved;

  const panelWidth  = saved ? Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, saved.width))   : PANEL_WIDTH_DEFAULT;
  const panelHeight = saved ? Math.min(height, Math.max(PANEL_MIN_HEIGHT, saved.height))            : height;
  // Docked default starts just off-screen to the right; showPanel() slides it
  // in. A remembered custom position opens exactly where it was left.
  const startX = saved ? saved.x : x + width;
  const startY = saved ? saved.y : y;

  panel = new BrowserWindow({
    width: panelWidth,
    height: panelHeight,
    x: startX,
    y: startY,
    show: false,
    frame: false,
    resizable: true,
    minWidth: PANEL_MIN_WIDTH,
    maxWidth: PANEL_MAX_WIDTH,
    minHeight: PANEL_MIN_HEIGHT,
    maxHeight: height,
    movable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: true,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  panel.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  panel.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // Remember wherever it ends up — but only for real user action (dragging
  // the header, resizing an edge), not our own slide-in/out animation.
  let saveBoundsTimer = null;
  const persistBounds = () => {
    if (suppressBoundsSave) return;
    panelMovedByUser = true;
    clearTimeout(saveBoundsTimer);
    saveBoundsTimer = setTimeout(() => {
      const b = panel.getBounds();
      savePanelBounds(b.x, b.y, b.width, b.height);
    }, 200);
  };
  panel.on('moved', persistBounds);
  panel.on('resize', persistBounds);
}

// ── Slide animation — Electron has no native window-move tween, so this
// steps setBounds() over a handful of frames. Cheap and good enough for a
// ~200px, ~180ms slide. Only used for the docked default; a freely-moved
// panel just shows/hides in place (sliding it in from a screen edge that
// might be nowhere near where the user put it would look broken). ─────────
function animateX(win, from, to, ms, onDone) {
  suppressBoundsSave = true;
  const steps = 16;
  const dx = (to - from) / steps;
  let i = 0;
  const timer = setInterval(() => {
    i++;
    if (!win || win.isDestroyed()) { clearInterval(timer); suppressBoundsSave = false; return; }
    const b = win.getBounds();
    win.setBounds({ ...b, x: Math.round(from + dx * i) });
    if (i >= steps) {
      clearInterval(timer);
      suppressBoundsSave = false;
      if (onDone) onDone();
    }
  }, ms / steps);
}

function showPanel() {
  if (!panel) createPanel();
  if (panelMovedByUser) {
    panel.show();
    panel.focus();
    return;
  }
  const display = screen.getPrimaryDisplay();
  const { x, width } = display.workArea;
  const panelWidth = panel.getBounds().width;
  const target = x + width - panelWidth;
  const b = panel.getBounds();
  suppressBoundsSave = true;
  panel.setBounds({ ...b, x: x + width });
  panel.show();
  panel.focus();
  animateX(panel, x + width, target, 180);
}

function hidePanel() {
  if (!panel || !panel.isVisible()) return;
  if (panelMovedByUser) { panel.hide(); return; }
  const display = screen.getPrimaryDisplay();
  const { x, width } = display.workArea;
  const panelWidth = panel.getBounds().width;
  animateX(panel, x + width - panelWidth, x + width, 150, () => panel && panel.hide());
}

function togglePanel() {
  if (panel && panel.isVisible()) hidePanel();
  else showPanel();
}

// ── Tray icon — secondary access (Quit lives only here) ──────────────────────
function createTray() {
  tray = new Tray(path.join(__dirname, '..', 'build', 'tray.png'));
  tray.setToolTip('Contexto AI — ' + HOTKEY.replace('CommandOrControl', process.platform === 'darwin' ? 'Cmd' : 'Ctrl'));
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open / Minimize Contexto', click: togglePanel },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]));
  tray.on('click', togglePanel);
}

// ── OS-wide clipboard polling — Electron has no native clipboard-change
// event, so this polls readText() and diffs against the last value, same
// idea as the extension's "copy" listener but working across every app. ──
function startClipboardWatch() {
  setInterval(() => {
    let text;
    try { text = clipboard.readText(); } catch { return; }
    if (!text || text.length < 2 || text === lastClipText) return;
    lastClipText = text;
    if (panel && !panel.isDestroyed()) {
      panel.webContents.send('clipboard:new-text', { text, createdAt: Date.now() });
    }
  }, CLIPBOARD_POLL_MS);
}

// ── IPC ────────────────────────────────────────────────────────────────────
ipcMain.handle('config:get', () => loadConfig());
ipcMain.handle('config:save', (_e, cfg) => saveConfig(cfg));
ipcMain.handle('llm:query', async (_e, { input, clips }) => {
  try {
    const result = await orchestrate(input || '', clips || [], loadConfig());
    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
ipcMain.on('window:hide', () => hidePanel());
ipcMain.on('panel:toggle', () => togglePanel());
ipcMain.on('launcher:move-by', (_e, { dx, dy }) => {
  if (!launcher || launcher.isDestroyed()) return;
  const b = launcher.getBounds();
  launcher.setBounds({ ...b, x: Math.round(b.x + dx), y: Math.round(b.y + dy) });
});
ipcMain.on('shell:open-external', (_e, url) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) shell.openExternal(url);
});

// ── Lifecycle ────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) app.dock.hide(); // tray-only app
  createTray();
  createLauncher();
  createPanel();

  const hotkeyOk = globalShortcut.register(HOTKEY, togglePanel);
  if (!hotkeyOk) {
    console.error('[Contexto] Global shortcut ' + HOTKEY + ' is already taken by another app — use the launcher button or tray icon instead.');
  } else {
    console.log('[Contexto] Ready. Launcher button is bottom-right of your screen; ' + HOTKEY + ' also toggles the panel.');
  }

  // Open once on first launch so it's obvious the app is alive — after that
  // it stays minimized to just the launcher button until you click it.
  panel.webContents.once('did-finish-load', showPanel);

  startClipboardWatch();
});

app.on('window-all-closed', (e) => e.preventDefault()); // tray keeps the app alive
app.on('will-quit', () => globalShortcut.unregisterAll());
