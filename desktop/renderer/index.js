// Contexto AI - Desktop Renderer Controller
// Same UI/UX as the Chrome extension's side panel, but talks directly to
// IndexedDB + the embedding engine (no offscreen-doc relay needed — a
// standalone window already has full DOM access) and to the main process
// only for the privileged LLM fetch and window controls.

import { openDB, saveClip, getAllClips, deleteClip, clearAllClips } from "./db.js";
import { embed, cosineSim } from "./embed-engine.js";
import { stripSensitive, isSensitive, isSensitiveKey, encryptText, decryptText } from "./security.js";

var allClips = [], activeFilter = "all", activeCategory = "all", searchQuery = "", searchTimer;
// Kept in sync with src/offscreen/index.js's CATEGORIES — only used here for
// display labels/icons, the actual categorization happens at save time.
var CATEGORIES = {
  shopping: { label: "Shopping", icon: "🛒" },
  travel:   { label: "Travel",   icon: "✈️" },
  finance:  { label: "Finance",  icon: "💰" },
  work:     { label: "Work",     icon: "💼" },
  health:   { label: "Health",   icon: "🩺" },
  learning: { label: "Learning", icon: "📚" },
  personal: { label: "Personal", icon: "🏠" },
};
var selectMode = false, selectedIds = new Set(), lastRenderedClips = [];
var searchInput, clearSearch, clipsList, emptyState, clipCount, categoryFilter, archivedPill;
var clearBtn, settingsBtn, backBtn, saveSettingsBtn, hideBtn;
var noteInput, saveNoteBtn, composerHint, aiStatus, aiStatusText;
var apiKeyInput, proxyInput, modelSelect, toggleApiKey, settingsStatus;
var mainView, settingsView;
var themeBtn, themeIconMoon, themeIconSun;
var quickTaskBtn, quickTaskForm, qtText, qtDate, qtTime, qtPriority, qtRecurring, qtDays, qtCancel, qtSave;
var qtSelectedDays = [];
var exportBtn, importBtn, importFile;
var streakBadge, onboardTip, onboardTipText, onboardSkip, onboardNext;
var cmdkBtn, cmdkOverlay, cmdkInput, cmdkList;
var selectModeBtn, bulkBar, bulkCount, bulkSelectAll, bulkAddTasks, bulkExport, bulkDelete, bulkCancel;
var hasApiKey = false;
var lastClipText = "", lastClipTs = 0;

function todayStr() {
  var d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
}

var WEEKDAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// A recurring task with recurDays set only actually applies on those
// weekdays (0=Sunday..6=Saturday) — no recurDays (or empty) means every day,
// same as the original all-days-recurring behavior.
function taskAppliesToday(c) {
  if (!c.recurring) return true;
  if (!Array.isArray(c.recurDays) || !c.recurDays.length) return true;
  return c.recurDays.indexOf(new Date().getDay()) !== -1;
}

// ── Proactive suggestions ────────────────────────────────────────────────────
// A cheap local heuristic (no LLM call) that flags auto-captured clips that
// read like a task/reminder, so the app can offer a one-tap "Add as task"
// instead of the user having to notice and retype it themselves.
var TASK_LIKE_RE = /\b(remind(er)?\b|meeting|deadline|due (by|on|date)|submit by|appointment|follow[- ]?up|todo|to-do|schedule[d]?|by (tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b|\b\d{1,2}(:\d{2})?\s?(am|pm)\b/i;
function looksLikeTaskContent(text) {
  return !!text && text.length <= 300 && TASK_LIKE_RE.test(text);
}
function getDismissedSuggestions() {
  try { return JSON.parse(localStorage.getItem("ctx_dismissed_suggest") || "[]"); } catch (_) { return []; }
}
function dismissSuggestion(id) {
  var arr = getDismissedSuggestions();
  if (arr.indexOf(id) === -1) {
    arr.push(id);
    try { localStorage.setItem("ctx_dismissed_suggest", JSON.stringify(arr.slice(-200))); } catch (_) {}
  }
}

document.addEventListener("DOMContentLoaded", function () {
  mainView      = document.getElementById("mainView");
  settingsView  = document.getElementById("settingsView");
  searchInput   = document.getElementById("searchInput");
  clearSearch   = document.getElementById("clearSearch");
  clipsList     = document.getElementById("clipsList");
  emptyState    = document.getElementById("emptyState");
  clipCount     = document.getElementById("clipCount");
  categoryFilter = document.getElementById("categoryFilter");
  archivedPill  = document.getElementById("archivedPill");
  clearBtn      = document.getElementById("clearBtn");
  settingsBtn   = document.getElementById("settingsBtn");
  backBtn       = document.getElementById("backBtn");
  saveSettingsBtn = document.getElementById("saveSettingsBtn");
  hideBtn       = document.getElementById("hideBtn");
  noteInput     = document.getElementById("noteInput");
  saveNoteBtn   = document.getElementById("saveNoteBtn");
  composerHint  = document.getElementById("composerHint");
  aiStatus      = document.getElementById("aiStatus");
  aiStatusText  = document.getElementById("aiStatusText");
  apiKeyInput   = document.getElementById("apiKeyInput");
  proxyInput    = document.getElementById("proxyInput");
  modelSelect   = document.getElementById("modelSelect");
  toggleApiKey  = document.getElementById("toggleApiKey");
  settingsStatus= document.getElementById("settingsStatus");
  themeBtn      = document.getElementById("themeBtn");
  themeIconMoon = document.getElementById("themeIconMoon");
  themeIconSun  = document.getElementById("themeIconSun");
  quickTaskBtn  = document.getElementById("quickTaskBtn");
  quickTaskForm = document.getElementById("quickTaskForm");
  qtText        = document.getElementById("qtText");
  qtDate        = document.getElementById("qtDate");
  qtTime        = document.getElementById("qtTime");
  qtPriority    = document.getElementById("qtPriority");
  qtRecurring   = document.getElementById("qtRecurring");
  qtDays        = document.getElementById("qtDays");
  qtCancel      = document.getElementById("qtCancel");
  qtSave        = document.getElementById("qtSave");
  exportBtn     = document.getElementById("exportBtn");
  importBtn     = document.getElementById("importBtn");
  importFile    = document.getElementById("importFile");
  streakBadge   = document.getElementById("streakBadge");
  onboardTip    = document.getElementById("onboardTip");
  onboardTipText= document.getElementById("onboardTipText");
  onboardSkip   = document.getElementById("onboardSkip");
  onboardNext   = document.getElementById("onboardNext");
  cmdkBtn       = document.getElementById("cmdkBtn");
  cmdkOverlay   = document.getElementById("cmdkOverlay");
  cmdkInput     = document.getElementById("cmdkInput");
  cmdkList      = document.getElementById("cmdkList");
  selectModeBtn = document.getElementById("selectModeBtn");
  bulkBar       = document.getElementById("bulkBar");
  bulkCount     = document.getElementById("bulkCount");
  bulkSelectAll = document.getElementById("bulkSelectAll");
  bulkAddTasks  = document.getElementById("bulkAddTasks");
  bulkExport    = document.getElementById("bulkExport");
  bulkDelete    = document.getElementById("bulkDelete");
  bulkCancel    = document.getElementById("bulkCancel");

  var logoImg = document.getElementById("logoImg");
  if (logoImg) logoImg.addEventListener("error", function () { logoImg.style.display = "none"; });

  initTheme();
  initDataActions();
  initOnboarding();
  initCommandPalette();
  initSelectMode();
  init();
});

// ── Onboarding (shown once) ──────────────────────────────────────────────────
var ONBOARD_STEPS = [
  "Type naturally in the box above — save a note, ask a question, or write “remind me to call mom tomorrow” to add a task.",
  "Use the + Task button for a quick manual task with a due date and priority — no AI needed.",
  "Everything stays only on this machine. Back it up any time from Settings → Your Data.",
];
var onboardStep = 0;
function initOnboarding() {
  var done = false;
  try { done = localStorage.getItem("ctx_onboarded") === "1"; } catch (_) {}
  if (done) return;
  onboardStep = 0;
  renderOnboardStep();
  onboardTip.style.display = "flex";
  onboardNext.addEventListener("click", function () {
    onboardStep++;
    if (onboardStep >= ONBOARD_STEPS.length) { finishOnboarding(); return; }
    renderOnboardStep();
  });
  onboardSkip.addEventListener("click", finishOnboarding);
}
function renderOnboardStep() {
  onboardTipText.textContent = ONBOARD_STEPS[onboardStep];
  onboardNext.textContent = onboardStep === ONBOARD_STEPS.length - 1 ? "Got it" : "Next";
}
function finishOnboarding() {
  onboardTip.style.display = "none";
  try { localStorage.setItem("ctx_onboarded", "1"); } catch (_) {}
}

// ── Streak & celebration ─────────────────────────────────────────────────────
// A day "counts" only if there was at least one task actually due that day
// (dated or recurring) — an empty task list shouldn't rack up a free streak.
// Checked once per loadClips() so it re-evaluates any time the task list
// changes, but only ever celebrates/increments the first time a given day's
// tasks flip to "all done" (guarded by ctx_streak_last_date).
function checkStreak() {
  if (!streakBadge) return;
  var today = todayStr();
  var last = "";
  try { last = localStorage.getItem("ctx_streak_last_date") || ""; } catch (_) {}
  var streak = 0;
  try { streak = parseInt(localStorage.getItem("ctx_streak_count") || "0", 10) || 0; } catch (_) {}

  if (last && last !== today) {
    var y = new Date(Date.now() - 86400000);
    var yStr = y.getFullYear() + "-" + String(y.getMonth()+1).padStart(2,"0") + "-" + String(y.getDate()).padStart(2,"0");
    if (last !== yStr) { streak = 0; try { localStorage.setItem("ctx_streak_count", "0"); } catch (_) {} }
  }
  renderStreakBadge(streak);
  if (last === today) return;

  var relevant = allClips.filter(function (c) { return c.type === "task" && ((c.recurring && taskAppliesToday(c)) || c.dueDate === today); });
  if (!relevant.length) return;
  var allDone = relevant.every(function (c) { return c.recurring ? c.recurringDone === today : !!c.done; });
  if (!allDone) return;

  var yesterday = new Date(Date.now() - 86400000);
  var yesterdayStr = yesterday.getFullYear() + "-" + String(yesterday.getMonth()+1).padStart(2,"0") + "-" + String(yesterday.getDate()).padStart(2,"0");
  streak = (last === yesterdayStr) ? streak + 1 : 1;
  try {
    localStorage.setItem("ctx_streak_count", String(streak));
    localStorage.setItem("ctx_streak_last_date", today);
  } catch (_) {}
  renderStreakBadge(streak);
  celebrate();
}
function renderStreakBadge(streak) {
  if (!streakBadge) return;
  if (streak > 0) { streakBadge.textContent = "🔥 " + streak; streakBadge.style.display = ""; }
  else streakBadge.style.display = "none";
}

function celebrate() {
  showToast("🎉 All tasks done — streak keeps going!", "success");
  spawnConfetti();
  playCelebrationChime();
}
function spawnConfetti() {
  var colors = ["#6c74e8", "#4cd97b", "#ffb648", "#ff6b6b", "#4fd1ff"];
  var container = document.createElement("div");
  container.className = "confetti-burst";
  for (var i = 0; i < 26; i++) {
    var p = document.createElement("span");
    p.className = "confetti-piece";
    p.style.left = (Math.random() * 100) + "%";
    p.style.background = colors[i % colors.length];
    p.style.animationDelay = (Math.random() * 0.25) + "s";
    p.style.transform = "rotate(" + (Math.random() * 360) + "deg)";
    container.appendChild(p);
  }
  document.body.appendChild(container);
  setTimeout(function () { container.remove(); }, 2000);
}
function playCelebrationChime() {
  try {
    var Ctx = window.AudioContext || window.webkitAudioContext;
    var ctx = new Ctx();
    [523.25, 659.25, 783.99].forEach(function (freq, i) {
      var osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = "sine"; osc.frequency.value = freq;
      var t = ctx.currentTime + i * 0.11;
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.16, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(t); osc.stop(t + 0.35);
    });
  } catch (_) {}
}

// ── Backup export/import ─────────────────────────────────────────────────────
function clipToExportItem(c) {
  return {
    id: c.id, type: c.type, content: c.content, url: c.url || "", title: c.title || "",
    favicon: c.favicon || "", domain: c.domain || "", createdAt: c.createdAt,
    dueDate: c.dueDate || null, dueTime: c.dueTime || null, recurring: !!c.recurring, recurDays: c.recurDays || null,
    priority: c.priority || null, done: !!c.done, recurringDone: c.recurringDone || null, category: c.category || null,
    completedAt: c.completedAt || null, archived: !!c.archived, archivedAt: c.archivedAt || null,
  };
}
function downloadBackup(items) {
  var blob = new Blob([JSON.stringify({ app: "contexto-ai", exportedAt: Date.now(), items: items }, null, 2)], { type: "application/json" });
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url;
  a.download = "contexto-backup-" + todayStr() + ".json";
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
function initDataActions() {
  exportBtn.addEventListener("click", function () {
    var items = allClips.map(clipToExportItem);
    downloadBackup(items);
    showToast(items.length + " item(s) exported", "success");
  });
  importBtn.addEventListener("click", function () { importFile.click(); });
  importFile.addEventListener("change", function () {
    var file = importFile.files && importFile.files[0];
    importFile.value = "";
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var parsed;
      try { parsed = JSON.parse(String(reader.result)); } catch (_) { showToast("Not a valid backup file", "error"); return; }
      var items = Array.isArray(parsed) ? parsed : parsed.items;
      if (!Array.isArray(items)) { showToast("Not a valid backup file", "error"); return; }
      if (!confirm("Import " + items.length + " item(s) from this backup?")) return;
      importItems(items).then(function (count) {
        showToast(count + " item(s) imported", "success"); loadClips();
      }).catch(function () { showToast("Import failed", "error"); });
    };
    reader.readAsText(file);
  });
}

// Reuses the same save paths a normal add would use (so encryption, vector
// and key all get recomputed fresh from the imported plaintext rather than
// trusted from the file) — the only difference is the id is preserved when
// present, so re-importing the same backup upserts instead of duplicating.
function importItems(items) {
  var count = 0;
  return items.reduce(function (chain, item) {
    return chain.then(function () {
      if (!item || typeof item.content !== "string" || !item.content.trim()) return;
      if (item.type === "task") {
        return saveClip({
          id: item.id || cryptoRandomId(), type: "task", content: item.content,
          url: "", title: "Task", favicon: "", domain: "task",
          createdAt: item.createdAt || Date.now(), vector: embed(item.content), key: null,
          category: categorize(item.content, null),
          dueDate: item.dueDate || null, dueTime: item.dueTime || null, recurring: !!item.recurring,
          recurDays: (Array.isArray(item.recurDays) && item.recurDays.length) ? item.recurDays : null,
          priority: item.priority || null, done: !!item.done, recurringDone: item.recurringDone || null,
          completedAt: item.completedAt || null, archived: !!item.archived, archivedAt: item.archivedAt || null,
          notifiedAt: null,
        }).then(function () { count++; });
      }
      if (item.type === "note") {
        var key1 = extractKey(item.content);
        return maybeEncrypt(item.content, key1).then(function (r) {
          return saveClip({
            id: item.id || cryptoRandomId(), type: "note", content: r.content,
            url: "", title: "Manual Note", favicon: "", domain: "note",
            createdAt: item.createdAt || Date.now(), vector: embed(item.content), key: key1, sensitive: r.sensitive,
            category: categorize(item.content, null),
            archived: !!item.archived, archivedAt: item.archivedAt || null,
          });
        }).then(function () { count++; });
      }
      var clean = stripSensitive(item.content);
      var key2 = extractKey(clean);
      return maybeEncrypt(clean, key2).then(function (r) {
        return saveClip({
          id: item.id || cryptoRandomId(), type: item.type, content: r.content,
          url: item.url || "", title: item.title || "", favicon: item.favicon || "",
          domain: item.domain || "", createdAt: item.createdAt || Date.now(),
          vector: embed(clean), key: key2, sensitive: r.sensitive,
          category: categorize(clean, item.domain),
          archived: !!item.archived, archivedAt: item.archivedAt || null,
        });
      }).then(function () { count++; });
    }).catch(function () { /* skip malformed entries, keep importing the rest */ });
  }, Promise.resolve()).then(function () { return count; });
}

// ── Theme (light default, dark opt-in) ──────────────────────────────────────
function applyTheme(theme) {
  if (theme === "dark") document.documentElement.setAttribute("data-theme", "dark");
  else document.documentElement.removeAttribute("data-theme");
  if (themeIconMoon) themeIconMoon.style.display = theme === "dark" ? "none" : "";
  if (themeIconSun)  themeIconSun.style.display  = theme === "dark" ? "" : "none";
}
function initTheme() {
  var saved = "light";
  try { saved = localStorage.getItem("ctx_theme") || "light"; } catch (_) {}
  applyTheme(saved);
  if (themeBtn) {
    themeBtn.addEventListener("click", function () {
      var next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
      applyTheme(next);
      try { localStorage.setItem("ctx_theme", next); } catch (_) {}
    });
  }
}

function init() {
  openDB().catch(function (e) { console.error("[Contexto]", e); });
  loadConfig();
  loadClips();
  setInterval(checkDueNotifications, 30000);
  setInterval(runAutoArchive, 30 * 60 * 1000);
  setTimeout(runAutoArchive, 5000);
  setTimeout(fireTestNotification, 4000);

  noteInput.addEventListener("input", function () {
    noteInput.style.height = "auto";
    noteInput.style.height = Math.min(noteInput.scrollHeight, 120) + "px";
    updateHint();
  });
  noteInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
  });
  saveNoteBtn.addEventListener("click", handleSubmit);

  searchInput.addEventListener("input", function () {
    searchQuery = searchInput.value.trim();
    clearSearch.style.display = searchQuery ? "flex" : "none";
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderFiltered, 180);
  });
  clearSearch.addEventListener("click", function () {
    searchInput.value = ""; searchQuery = "";
    clearSearch.style.display = "none";
    renderFiltered(); searchInput.focus();
  });

  document.querySelectorAll(".pill").forEach(function (p) {
    p.addEventListener("click", function () {
      document.querySelectorAll(".pill").forEach(function (x) { x.classList.remove("active"); });
      p.classList.add("active"); activeFilter = p.dataset.filter; renderFiltered();
    });
  });
  categoryFilter.addEventListener("change", function () {
    activeCategory = categoryFilter.value;
    renderFiltered();
  });

  clearBtn.addEventListener("click", confirmClearAll);
  settingsBtn.addEventListener("click", showSettings);
  backBtn.addEventListener("click", hideSettings);
  saveSettingsBtn.addEventListener("click", doSaveSettings);
  toggleApiKey.addEventListener("click", function () {
    apiKeyInput.type = apiKeyInput.type === "password" ? "text" : "password";
  });

  hideBtn.addEventListener("click", function () { window.contexto.hidePanel(); });

  // Manual quick-add task — bypasses AI entirely, works identically with or
  // without an API key configured, and never gets misclassified.
  quickTaskBtn.addEventListener("click", function () {
    var opening = quickTaskForm.style.display === "none";
    quickTaskForm.style.display = opening ? "block" : "none";
    if (opening) {
      qtText.value = ""; qtDate.value = ""; qtTime.value = ""; qtPriority.value = ""; qtRecurring.checked = false;
      qtSelectedDays = [];
      qtDays.style.display = "none";
      qtDays.querySelectorAll(".qt-day").forEach(function (b) { b.classList.remove("active"); });
      qtText.focus();
    }
  });
  qtRecurring.addEventListener("change", function () {
    qtDays.style.display = qtRecurring.checked ? "flex" : "none";
  });
  qtDays.querySelectorAll(".qt-day").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var d = parseInt(btn.dataset.day, 10);
      var i = qtSelectedDays.indexOf(d);
      if (i === -1) qtSelectedDays.push(d); else qtSelectedDays.splice(i, 1);
      btn.classList.toggle("active", i === -1);
    });
  });
  qtCancel.addEventListener("click", function () { quickTaskForm.style.display = "none"; });
  qtSave.addEventListener("click", function () {
    var text = qtText.value.trim();
    if (!text) { qtText.focus(); return; }
    saveClip({
      id: cryptoRandomId(), type: "task", content: text,
      url: "", title: "Task", favicon: "", domain: "task",
      createdAt: Date.now(), vector: embed(text), key: null,
      category: categorize(text, null),
      dueDate: qtDate.value || null, dueTime: qtTime.value || null, recurring: qtRecurring.checked,
      recurDays: (qtRecurring.checked && qtSelectedDays.length) ? qtSelectedDays.slice() : null,
      priority: qtPriority.value || null,
      done: false, recurringDone: null, notifiedAt: null,
    }).then(function () { showToast("Task added!", "success"); quickTaskForm.style.display = "none"; loadClips(); })
      .catch(function () { showToast("Couldn't add task", "error"); });
  });

  // Onboarding example chips — fill the composer so the user can see (and
  // edit) the pattern before sending it, rather than guessing what to type.
  document.querySelectorAll(".example-chip").forEach(function (chip) {
    chip.addEventListener("click", function () {
      noteInput.value = chip.dataset.example;
      noteInput.dispatchEvent(new Event("input"));
      noteInput.focus();
    });
  });

  // OS-wide clipboard capture, pushed from the main process
  window.contexto.onClipboardText(function (payload) {
    handleClipboardCapture(payload.text, payload.createdAt);
  });
}

// A sensitive note/clip is encrypted at rest and never sent to the LLM as
// plaintext — see main/llm.js's "answer_local" path, which answers queries
// about these directly from local storage instead. The vector stays computed
// from the real plaintext since it never leaves the device (the AI_QUERY
// payload strips it, and separately masks sensitive content).
async function maybeEncrypt(content, key) {
  if (!isSensitive(content) && !isSensitiveKey(key)) return { content: content, sensitive: false };
  return { content: await encryptText(content), sensitive: true };
}

// Re-saving a note whose content already exists verbatim (non-sensitive)
// bumps the existing card to the top instead of piling up a duplicate.
function saveNoteWithDedup(content, createdAt) {
  var key = extractKey(content);
  var category = categorize(content, null);
  return maybeEncrypt(content, key).then(function (r) {
    if (!r.sensitive) {
      var dup = allClips.find(function (c) { return !c.sensitive && c.type === "note" && c.content === content; });
      if (dup) {
        dup.createdAt = createdAt || Date.now(); dup.category = category; dup.archived = false; dup.archivedAt = null;
        return saveClip(dup);
      }
    }
    return saveClip({
      id: cryptoRandomId(), type: "note", content: r.content,
      url: "", title: "Manual Note", favicon: "", domain: "note",
      createdAt: createdAt || Date.now(), vector: embed(content), key: key, sensitive: r.sensitive, category: category,
    });
  });
}

// ── Clipboard capture (no browser DOM/favicon context available here) ───────
function handleClipboardCapture(text, createdAt) {
  if (!text || text.length < 2) return;
  var now = createdAt || Date.now();
  if (text === lastClipText && now - lastClipTs < 1500) return;
  lastClipText = text; lastClipTs = now;

  var clean = stripSensitive(text);
  var key = extractKey(clean);
  var category = categorize(clean, "Clipboard");
  maybeEncrypt(clean, key).then(function (r) {
    // Re-copying something already stored (verbatim, non-sensitive) just
    // bumps the existing card to the top instead of piling up a duplicate.
    if (!r.sensitive) {
      var dup = allClips.find(function (c) { return !c.sensitive && c.type === "text" && c.content === clean; });
      if (dup) {
        dup.createdAt = now; dup.category = category; dup.archived = false; dup.archivedAt = null;
        return saveClip(dup);
      }
    }
    return saveClip({
      id: cryptoRandomId(), type: "text", content: r.content,
      url: "", title: "", favicon: "", domain: "Clipboard",
      createdAt: now, vector: embed(clean), key: key, sensitive: r.sensitive, category: category,
    });
  }).then(function () { loadClips(); }).catch(function (e) { console.error("[Contexto]", e); });
}

function cryptoRandomId() {
  return (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
}

// Pulls a normalized "key" out of "<label>: <value>" content — see
// src/offscreen/index.js for the extension's identical implementation.
function extractKey(text) {
  var m = /^([a-zA-Z0-9 _/-]{2,40}):\s+(\S.*)$/s.exec(String(text || "").trim());
  return m ? m[1].trim().toLowerCase() : null;
}
// ── Auto-categorization ──────────────────────────────────────────────────────
// Pure local keyword/domain heuristics — see src/offscreen/index.js for the
// extension's identical implementation (keep both in sync if you change one).
var CATEGORY_DOMAIN_RULES = [
  [/amazon\.|ebay\.|etsy\.|walmart\.|target\.com|aliexpress|shopify|shop\./i, "shopping"],
  [/booking\.com|airbnb|expedia|kayak\.com|delta\.com|united\.com|southwest\.com|airlines|makemytrip|skyscanner/i, "travel"],
  [/paypal\.|chase\.com|bankofamerica|wellsfargo|stripe\.com|venmo|revolut|coinbase/i, "finance"],
  [/github\.|gitlab\.|jira\.|atlassian|slack\.com|notion\.so|linkedin\.com|zoom\.us/i, "work"],
];
var CATEGORY_KEYWORD_RULES = [
  [/\b(order|cart|checkout|price|discount|coupon|shipping|purchase|buy)\b/i, "shopping"],
  [/\b(flight|hotel|booking|itinerary|passport|reservation|boarding|trip|vacation)\b/i, "travel"],
  [/\b(invoice|payment|bank account|routing number|tax|salary|budget|expense|paid \$|\$\d)/i, "finance"],
  [/\b(meeting|deadline|project|client|standup|sprint|colleague|manager|office|report due)\b/i, "work"],
  [/\b(doctor|appointment|prescription|medicine|pharmacy|dentist|clinic|hospital|workout|gym)\b/i, "health"],
  [/\b(course|tutorial|lecture|homework|assignment|read this article|study for)\b/i, "learning"],
  [/\b(mom|dad|birthday|anniversary|call (him|her|them)|family dinner)\b/i, "personal"],
];
function categorize(content, domain) {
  var text = String(content || "");
  var d = String(domain || "");
  for (var i = 0; i < CATEGORY_DOMAIN_RULES.length; i++) if (CATEGORY_DOMAIN_RULES[i][0].test(d)) return CATEGORY_DOMAIN_RULES[i][1];
  for (var j = 0; j < CATEGORY_KEYWORD_RULES.length; j++) if (CATEGORY_KEYWORD_RULES[j][0].test(text)) return CATEGORY_KEYWORD_RULES[j][1];
  return null;
}

function keyOverlap(query, key) {
  if (!key) return 0;
  var qWords = query.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(function (w) { return w.length > 2; });
  if (!qWords.length) return 0;
  var hits = qWords.filter(function (w) { return key.includes(w); }).length;
  return hits / qWords.length;
}

// ── Config ────────────────────────────────────────────────────────────────────
function loadConfig() {
  window.contexto.getConfig().then(function (cfg) {
    hasApiKey = !!(cfg.apiKey && cfg.apiKey.length > 0);
    if (apiKeyInput) apiKeyInput.value = cfg.apiKey || "";
    if (proxyInput)  proxyInput.value  = cfg.proxyUrl || "";
    if (modelSelect) modelSelect.value = cfg.model || "";
    updateHint();
  }).catch(function(){});
}

function doSaveSettings() {
  var cfg = {
    apiKey:   apiKeyInput.value.trim(),
    proxyUrl: proxyInput.value.trim() || "https://api.openai.com/v1/chat/completions",
    model:    modelSelect.value.trim(),
  };
  window.contexto.saveConfig(cfg).then(function () {
    hasApiKey = !!(cfg.apiKey);
    settingsStatus.textContent = "Saved!";
    settingsStatus.style.color = "var(--green)";
    setTimeout(function () { settingsStatus.textContent = ""; }, 2000);
    updateHint();
  }).catch(function () {
    settingsStatus.textContent = "Save failed";
    settingsStatus.style.color = "var(--red)";
  });
}

function showSettings() {
  mainView.style.display = "none";
  settingsView.style.display = "flex";
  settingsView.style.flexDirection = "column";
  settingsView.style.height = "100%";
  loadConfig();
}

function hideSettings() {
  settingsView.style.display = "none";
  mainView.style.display = "flex";
  mainView.style.flexDirection = "column";
  mainView.style.height = "100%";
}

// ── Composer hint ──────────────────────────────────────────────────────────────
function updateHint() {
  if (!composerHint) return;
  var text = noteInput ? noteInput.value.trim() : "";
  if (!hasApiKey) {
    if (!text) {
      composerHint.textContent = "No AI key set — Enter still saves a note or searches locally. Add a key in Settings for smarter answers, tasks, edits & deletes.";
      composerHint.className = "composer-hint hint-warn";
      return;
    }
    var localIntent = classifyIntentLocal(text);
    composerHint.textContent = localIntent === "query" ? "Enter will search your data locally" : "Enter will save this as a note";
    composerHint.className = "composer-hint " + (localIntent === "query" ? "hint-query" : "hint-save");
    return;
  }
  if (!text) { composerHint.textContent = ""; composerHint.className = "composer-hint"; return; }
  var looksLikeDelete = /^(delete|remove|forget)\b/i.test(text);
  var looksLikeEdit = !looksLikeDelete &&
    /^(change|update|correct|edit|fix|push|move|snooze|postpone|reschedule|delay)\b/i.test(text);
  var looksLikeTask = !looksLikeDelete && !looksLikeEdit &&
    /^(remind me|todo|to-do|to do)\b|\bi need to\b|\bi have to\b|^(add|create)\s+(a\s+)?task\b/i.test(text);
  var looksLikeQuery = !looksLikeDelete && !looksLikeEdit && !looksLikeTask &&
    /\?$|^(what|find|show|get|where|how|who|when|tell me)/i.test(text);
  composerHint.textContent = looksLikeDelete ? "AI will find and confirm before deleting"
    : looksLikeEdit ? "AI will find and confirm before updating/rescheduling"
    : looksLikeTask ? "AI will add this as a task"
    : looksLikeQuery ? "AI will search your data" : "AI will save as a note";
  composerHint.className = "composer-hint " + (looksLikeDelete || looksLikeEdit ? "hint-warn" : looksLikeTask ? "hint-task" : looksLikeQuery ? "hint-query" : "hint-save");
}

// ── No-API-key fallback ──────────────────────────────────────────────────────
// The AI layer (natural-language save/query/delete/edit/task) needs an LLM,
// but basic clipboard use shouldn't be gated behind getting an API key first
// — that's real friction for someone who just wants to try the app. Without
// a key, "save" and "search" still work, using this local regex classifier
// instead of an LLM call. Structured task extraction (dates/times/recurring)
// genuinely needs an LLM to parse reliably, so without a key that's covered
// by the manual "+ Task" quick-add form instead.
var QUERY_PATTERNS_LOCAL = [
  /^what\s+(is|are|was|were|the)\b/i,
  /^(find|search|show|get|tell me|give me|look up|where is|where are)\b/i,
  /^(do you|can you|could you)\s+(find|show|remember|recall|tell)\b/i,
  /^(how|why|when|who|which|where)\b/i,
  /\?$/,
];
var SAVE_PATTERNS_LOCAL = [
  /\b(remember|save|store|note|keep|record)\s+(this|that|it|my|the)\b/i,
  /\bmy\s+\w+\s+(is|are|=)\s+\S/i,
  /\b(password|passwd|pin|api[\s_-]?key|token|secret|key|credential|login|username|email|address|phone|ssn|dob|birthday)\s*(is|:|\=)\s*\S/i,
  /^(note:|save:|remember:)/i,
  /\b(don'?t forget|keep in mind|store this)\b/i,
];
function classifyIntentLocal(text) {
  var t = text.trim();
  for (var i = 0; i < SAVE_PATTERNS_LOCAL.length; i++) if (SAVE_PATTERNS_LOCAL[i].test(t)) return "save";
  for (var j = 0; j < QUERY_PATTERNS_LOCAL.length; j++) if (QUERY_PATTERNS_LOCAL[j].test(t)) return "query";
  if (/[:=]/.test(t)) return "save";
  if (t.split(/\s+/).length <= 4) return "query";
  return "save";
}

function handleLocalSubmit(text) {
  var intent = classifyIntentLocal(text);
  noteInput.value = ""; noteInput.style.height = "auto";
  composerHint.textContent = ""; composerHint.className = "composer-hint";
  if (intent === "query") {
    searchInput.value = text; searchQuery = text;
    clearSearch.style.display = "flex";
    document.querySelectorAll(".pill").forEach(function (p) { p.classList.remove("active"); });
    document.querySelector('.pill[data-filter="all"]').classList.add("active");
    activeFilter = "all";
    renderFiltered();
    showToast("Searching locally — add an API key in Settings for AI answers", "success");
  } else {
    saveNoteWithDedup(text).then(function () { showToast("Saved!", "success"); loadClips(); })
      .catch(function () { showToast("Save failed", "error"); });
  }
}

// ── Submit ────────────────────────────────────────────────────────────────────
function handleSubmit() {
  var text = noteInput.value.trim();
  if (!text) { noteInput.focus(); return; }

  if (!hasApiKey) {
    handleLocalSubmit(text);
    return;
  }

  saveNoteBtn.disabled = true;
  noteInput.disabled   = true;
  showAiStatus("AI is thinking…");

  // Sensitive items never get their real value sent, even to our own main
  // process — the orchestrator answers those via "answer_local" instead,
  // which just points back at this same in-memory (already-decrypted) copy.
  window.contexto.llmQuery({
    input: text,
    clips: allClips.map(function (c) {
      return {
        id: c.id, domain: c.domain, type: c.type, createdAt: c.createdAt, favicon: c.favicon, key: c.key,
        sensitive: c.sensitive,
        content: c.sensitive ? "[sensitive value hidden]" : c.content,
      };
    }),
  }).then(function (r) {
    saveNoteBtn.disabled = false;
    noteInput.disabled   = false;
    hideAiStatus();

    if (!r || !r.ok) {
      showToast(r && r.error ? r.error : "AI request failed", "error");
      return;
    }

    var result = r.result;
    noteInput.value = ""; noteInput.style.height = "auto";
    composerHint.textContent = ""; composerHint.className = "composer-hint";

    if (result.action === "save") {
      saveNoteWithDedup(result.content).then(function () { showToast("Saved!", "success"); loadClips(); })
        .catch(function () { showToast("Save failed", "error"); });
    } else if (result.action === "task") {
      // One message can describe several tasks — add them all, one save
      // per task so each gets its own card, then a single summary toast.
      var tasksToAdd = result.tasks || [];
      Promise.all(tasksToAdd.map(function (t) {
        return saveClip({
          id: cryptoRandomId(), type: "task", content: t.text,
          url: "", title: "Task", favicon: "", domain: "task",
          createdAt: Date.now(), vector: embed(t.text), key: null,
          category: categorize(t.text, null),
          dueDate: t.dueDate || null, dueTime: t.dueTime || null, recurring: !!t.recurring,
          recurDays: t.recurDays || null,
          priority: t.priority || null,
          done: false, recurringDone: null, notifiedAt: null,
        });
      })).then(function () {
        showToast(tasksToAdd.length === 1 ? "Task added!" : tasksToAdd.length + " tasks added!", "success");
        loadClips();
      }).catch(function () { showToast("Couldn't add task", "error"); });
    } else if (result.action === "delete") {
      handleDeleteAction(result.matches);
    } else if (result.action === "reschedule") {
      handleRescheduleAction(result.matches, result.dueDate, result.dueTime, result.recurring, result.recurDays);
    } else if (result.action === "edit") {
      handleEditAction(result.matches, result.newContent);
    } else if (result.action === "answer_local") {
      handleLocalAnswer(text, result.matchId);
    } else {
      renderAiAnswer(text, result.answer, result.context);
    }
  }).catch(function (e) {
    saveNoteBtn.disabled = false;
    noteInput.disabled   = false;
    hideAiStatus();
    showToast("Error: " + (e.message || "unknown"), "error");
  });
}

// Answers a sensitive-note query straight from our own already-decrypted
// in-memory copy — main process matched it by label only, it never saw (and
// still doesn't see) the real value. Nothing sent to the LLM for this turn.
function handleLocalAnswer(query, matchId) {
  var match = allClips.filter(function (c) { return c.id === matchId; })[0];
  if (!match) { showToast("Couldn't find that note", "error"); return; }
  renderAiAnswer(query, match.content, [match]);
}

// Never delete outright from a natural-language request — always confirm
// against the actual matched content first, same as the "Clear all" button.
// Looks up the real local copy by id (main process only ever saw a masked
// placeholder for sensitive items, so its own `matches[].content` can't be
// trusted for the preview — ours can, it's already decrypted in memory).
function handleDeleteAction(matches) {
  if (!matches || !matches.length) {
    showToast("Couldn't find a matching note or clip to delete", "error");
    return;
  }
  var top = matches[0];
  var real = allClips.filter(function (c) { return c.id === top.id; })[0];
  var content = real ? real.content : top.content;
  var preview = (content || "").slice(0, 80);
  if (content && content.length > 80) preview += "…";
  if (confirm("Delete this " + (top.type === "note" ? "note" : "clip") + "?\n\n“" + preview + "”")) {
    doDelete(top.id);
  } else {
    showToast("Cancelled");
  }
}

// Same confirm-first pattern as delete — shows old vs new before touching anything.
function handleEditAction(matches, newContent) {
  if (!matches || !matches.length) {
    showToast("Couldn't find a matching note or clip to update", "error");
    return;
  }
  var top = matches[0];
  var real = allClips.filter(function (c) { return c.id === top.id; })[0];
  var oldPreview = ((real ? real.content : top.content) || "").slice(0, 60);
  var newPreview = (newContent || "").slice(0, 60);
  if (confirm(
    "Update this " + (top.type === "note" ? "note" : "clip") + "?\n\n" +
    "From:\n“" + oldPreview + "”\n\n" +
    "To:\n“" + newPreview + "”"
  )) {
    doEdit(top.id, newContent);
  } else {
    showToast("Cancelled");
  }
}

// "(Mon, Wed, Fri)", "(daily)", or "" for a one-off task.
function formatRecurLabel(recurring, recurDays) {
  if (!recurring) return "";
  if (Array.isArray(recurDays) && recurDays.length) {
    return " (" + recurDays.slice().sort().map(function (d) { return WEEKDAY_ABBR[d]; }).join(", ") + ")";
  }
  return " (daily)";
}

function handleRescheduleAction(matches, dueDate, dueTime, recurring, recurDays) {
  if (!matches || !matches.length) {
    showToast("Couldn't find a matching task to reschedule", "error");
    return;
  }
  var top = matches[0];
  var real = allClips.filter(function (c) { return c.id === top.id; })[0];
  if (!real) { showToast("Task not found", "error"); return; }
  var oldWhen = formatDue(real.dueDate, real.dueTime) || "no schedule";
  var newWhen = formatDue(dueDate, dueTime) || "no schedule";
  if (confirm(
    "Reschedule this task?\n\n" +
    "“" + (real.content || "").slice(0, 60) + "”\n\n" +
    "From: " + oldWhen + "\n" +
    "To: " + newWhen + formatRecurLabel(recurring, recurDays)
  )) {
    doReschedule(top.id, dueDate, dueTime, recurring, recurDays);
  } else {
    showToast("Cancelled");
  }
}

function showAiStatus(msg) {
  aiStatusText.textContent = msg || "AI thinking…";
  aiStatus.style.display = "flex";
}
function hideAiStatus() { aiStatus.style.display = "none"; }

// ── AI Answer render ──────────────────────────────────────────────────────────
function renderAiAnswer(query, answer, context) {
  emptyState.style.display = "none";
  var isMissing = !answer || answer.toLowerCase().includes("could not find");
  var html =
    '<div class="answer-card' + (isMissing ? " answer-none" : "") + '">' +
    '<div class="answer-header">' +
    '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8h.01M12 12v4"/></svg>' +
    'AI answer for: <span class="answer-query">' + esc(query) + '</span></div>' +
    '<div class="answer-body">' + esc(answer || "No answer found.") + '</div>' +
    '<div class="answer-actions">' +
    '<button class="act-btn" id="copyAnswerBtn">Copy</button>' +
    '<button class="act-btn" id="backToAllBtn">Back to all</button>' +
    '</div></div>';

  var related = (context && context.length) ? context : [];
  html += '<div class="results-divider">' + (related.length ? "Most relevant to your question" : "Your saved data") + '</div>';
  html += (related.length ? related : allClips.slice(0, 5)).map(function (c) { return cardHTML(c, query); }).join("");
  clipsList.innerHTML = html;

  document.getElementById("copyAnswerBtn").addEventListener("click", function () {
    window.contexto.writeClipboard(answer || "");
    showToast("Copied!", "success");
  });
  document.getElementById("backToAllBtn").addEventListener("click", function () {
    renderFiltered();
  });
  bindCardActions();
}

// ── Data ──────────────────────────────────────────────────────────────────────
// Sensitive clips are stored as an encrypted blob — decrypted back to
// plaintext here so the rest of the app (search, masking, copy) just deals
// with real content in memory. The card renderer is what actually withholds
// the value from the on-screen display and from the AI_QUERY payload.
function decryptClipsForDisplay(clips) {
  return Promise.all(clips.map(function (c) {
    if (!c.sensitive) return c;
    return decryptText(c.content)
      .then(function (plain) { return Object.assign({}, c, { content: plain }); })
      .catch(function () { return Object.assign({}, c, { content: "[could not decrypt]" }); });
  }));
}

function loadClips() {
  getAllClips().then(decryptClipsForDisplay).then(function (clips) {
    allClips = clips || [];
    updateCount(); renderCategoryOptions(); updateArchivedPillVisibility(); renderFiltered(); updateDueBadge(); checkStreak();
  }).catch(function (e) { console.error("[Contexto]", e); });
}

// The Archived pill only shows up once something has actually been
// archived — an empty pill in a fresh install would just be confusing.
function updateArchivedPillVisibility() {
  if (!archivedPill) return;
  var hasArchived = allClips.some(function (c) { return c.archived; });
  archivedPill.style.display = (hasArchived || activeFilter === "archived") ? "" : "none";
}

// Only lists categories that actually have at least one item — a fixed
// 7-option dropdown before anything is categorized would just be noise.
function renderCategoryOptions() {
  if (!categoryFilter) return;
  var present = {};
  allClips.forEach(function (c) { if (c.category) present[c.category] = true; });
  var keys = Object.keys(present);
  if (!keys.length && activeCategory === "all") {
    categoryFilter.style.display = "none";
    return;
  }
  categoryFilter.style.display = "";
  var current = categoryFilter.value || activeCategory;
  categoryFilter.innerHTML = '<option value="all">All categories</option>' + keys.map(function (k) {
    var meta = CATEGORIES[k] || { label: k, icon: "" };
    return '<option value="' + k + '">' + meta.icon + " " + meta.label + '</option>';
  }).join("");
  categoryFilter.value = keys.indexOf(current) !== -1 || current === "all" ? current : "all";
  if (categoryFilter.value !== activeCategory) activeCategory = categoryFilter.value;
}

function updateCount() {
  var n = allClips.length;
  clipCount.textContent = n === 1 ? "1 item" : n + " items";
}

// ── Render ────────────────────────────────────────────────────────────────────
function renderFiltered() {
  if (searchQuery.length > 0) {
    var qvec = embed(searchQuery);
    var scored = allClips
      .map(function (c) {
        var score = c.vector ? cosineSim(qvec, c.vector) : 0;
        var overlap = keyOverlap(searchQuery, c.key);
        if (overlap > 0) score = Math.max(score, 0.5 + overlap * 0.5);
        return Object.assign({}, c, { _score: score });
      })
      .sort(function (a, b) { return b._score - a._score; });
    render(applyFilter(scored), searchQuery);
  } else {
    render(applyFilter(allClips), "");
  }
}

function applyFilter(clips) {
  var start = new Date(); start.setHours(0,0,0,0);
  if (activeFilter === "archived") return clips.filter(function (c) { return c.archived; });
  var out = clips.filter(function (c) {
    if (c.archived) return false;
    if (activeCategory !== "all" && c.category !== activeCategory) return false;
    if (activeFilter === "task")  return c.type === "task";
    if (activeFilter === "note")  return c.type === "note";
    if (activeFilter === "text")  return c.type !== "note" && c.type !== "task" && !isUrl(c.content);
    if (activeFilter === "link")  return isUrl(c.content);
    if (activeFilter === "today") return c.createdAt >= start.getTime();
    return true;
  });
  if (activeFilter === "task") out.sort(taskComparator);
  return out;
}

// null if there's no dueDate at all (recurring habits, or a task with only a
// dueTime and no day) — those sort/compare as "no real deadline" rather than
// being pinned to a specific moment.
function taskDueTimestamp(c) {
  if (!c.dueDate) return null;
  return new Date(c.dueDate + "T" + (c.dueTime || "23:59") + ":00").getTime();
}

// Only tasks with an explicit dueTime get a push notification — a date-only
// deadline ("buy milk today") is already surfaced prominently in the list
// (sorted to the top, overdue badge), which is enough; there's no specific
// moment to alert about without a time. Recurring tasks reuse today's date
// so "read books at 10pm" fires every day at 10pm, checked against the
// device's actual clock (Date.now()) — not the LLM's idea of time.
function taskNotifyTimestamp(c) {
  if (!c.dueTime) return null;
  var datePart = c.recurring ? todayStr() : c.dueDate;
  if (!datePart) return null;
  return new Date(datePart + "T" + c.dueTime + ":00").getTime();
}

// Fires once, ~4s after every launch — a fast, on-demand way to tell whether
// OS notifications work at all on this machine, without waiting for a real
// task's due time or digging through DevTools. If this never shows up (no
// banner) — but you DO hear the chime — that confirms it's specifically a
// macOS notification-permission problem, not a bug in the due-time logic —
// check System Settings → Notifications for "Electron" (dev mode) or
// "Contexto AI" (packaged build).
function fireTestNotification() {
  console.log("[Contexto] Attempting test notification — Notification.permission =", typeof Notification !== "undefined" ? Notification.permission : "(Notification API unavailable)");
  playChime();
  try {
    var n = new Notification("Contexto AI", { body: "Notifications are working! Task reminders will look like this." });
    n.onerror = function (err) { console.error("[Contexto] Test notification error:", err); };
    n.onshow = function () { console.log("[Contexto] Test notification shown."); };
    n.onclick = function () { console.log("[Contexto] Test notification clicked."); };
  } catch (e) {
    console.error("[Contexto] Test notification threw:", e);
  }
}

// A short synthesized chime — doesn't touch the OS Notification system at
// all, so it works regardless of macOS notification-permission state. This
// is the reliable half of the due-task alert; the launcher's pulsing badge
// (see updateDueBadge) is the reliable visual half.
function playChime() {
  try {
    var Ctx = window.AudioContext || window.webkitAudioContext;
    var ctx = new Ctx();
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.5);
  } catch (e) {
    console.error("[Contexto] Chime failed:", e);
  }
}

// Pushes how many tasks are currently due-and-unfinished to the launcher
// window, which pulses/badges regardless of whether the panel is open.
function updateDueBadge() {
  var now = Date.now();
  var today = todayStr();
  var count = allClips.filter(function (c) {
    if (c.type !== "task") return false;
    if (c.recurring && !taskAppliesToday(c)) return false;
    var doneToday = c.recurring ? (c.recurringDone === today) : !!c.done;
    if (doneToday) return false;
    var dueTs = taskDueTimestamp(c);
    return dueTs !== null && dueTs <= now;
  }).length;
  window.contexto.setDueCount(count);
  updateTrayTasks();
}

// Pushes today's/overdue tasks (top 5) down to the tray dropdown, so what's
// due is visible at a glance without opening the panel at all. Folded into
// updateDueBadge() (rather than called separately) so every existing call
// site that already keeps the launcher badge fresh keeps the tray fresh too.
function updateTrayTasks() {
  if (!window.contexto.setTrayTasks) return;
  var today = todayStr();
  var now = Date.now();
  var items = allClips.filter(function (c) {
    if (c.type !== "task") return false;
    if (c.recurring && !taskAppliesToday(c)) return false;
    var doneToday = c.recurring ? (c.recurringDone === today) : !!c.done;
    if (doneToday) return false;
    return c.recurring || c.dueDate === today || (c.dueDate && c.dueDate < today);
  }).sort(taskComparator).slice(0, 5).map(function (c) {
    var dueTs = taskDueTimestamp(c);
    var overdue = !c.recurring && dueTs !== null && dueTs < now;
    var recurLabel = (Array.isArray(c.recurDays) && c.recurDays.length)
      ? c.recurDays.slice().sort().map(function (d) { return WEEKDAY_ABBR[d]; }).join(",")
      : "Daily";
    var when = c.recurring ? (recurLabel + (c.dueTime ? " " + formatTime(c.dueTime) : "")) : formatDue(c.dueDate, c.dueTime);
    return { label: c.content.slice(0, 40) + (when ? " — " + when : ""), overdue: overdue };
  });
  window.contexto.setTrayTasks(items);
}

function checkDueNotifications() {
  var now = Date.now();
  var today = todayStr();
  var changed = false;
  allClips.forEach(function (c) {
    if (c.type !== "task") return;
    if (c.recurring && !taskAppliesToday(c)) return;
    var doneToday = c.recurring ? (c.recurringDone === today) : !!c.done;
    if (doneToday) return;
    var notifyTs = taskNotifyTimestamp(c);
    if (notifyTs === null || notifyTs > now) return;
    if (c.notifiedAt === today) return; // already notified for this occurrence
    console.log("[Contexto] Firing notification for task:", c.content, "due:", new Date(notifyTs));
    playChime();
    try {
      var n = new Notification("Task due", { body: c.content });
      n.onerror = function (err) { console.error("[Contexto] Notification error:", err); };
      n.onshow = function () { console.log("[Contexto] Notification shown for:", c.content); };
    } catch (e) {
      console.error("[Contexto] Notification threw:", e);
    }
    // Guaranteed visible when the panel happens to be open, regardless of
    // whether macOS actually let the OS-level notification through.
    showToast("🔔 " + c.content, "success");
    c.notifiedAt = today;
    changed = true;
    saveClip(c).catch(function () {});
  });
  if (changed) renderFiltered();
  updateDueBadge();
}

// Clutter control: auto-captured clips nobody acted on eventually stop
// being useful, and a completed one-off task has done its job — both
// quietly move to "Archived" (filterable, reversible, never deleted
// outright) instead of piling up in the main feed forever.
var ARCHIVE_CLIP_MS = 21 * 24 * 60 * 60 * 1000; // 21 days
var ARCHIVE_TASK_DONE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days after completion
function runAutoArchive() {
  var now = Date.now();
  var changed = false;
  allClips.forEach(function (c) {
    if (c.archived) return;
    var shouldArchive = false;
    if (c.type === "text" && (now - c.createdAt) > ARCHIVE_CLIP_MS) shouldArchive = true;
    if (c.type === "task" && !c.recurring && c.done && c.completedAt && (now - c.completedAt) > ARCHIVE_TASK_DONE_MS) shouldArchive = true;
    if (!shouldArchive) return;
    c.archived = true;
    c.archivedAt = now;
    changed = true;
    saveClip(c).catch(function () {});
  });
  if (changed) { renderFiltered(); updateArchivedPillVisibility(); }
}

// Unchecked tasks first, then by due date+time (soonest/overdue first,
// no-date tasks — including recurring habits — sink to the end), then newest first.
function taskComparator(a, b) {
  var aDone = a.recurring ? (a.recurringDone === todayStr()) : !!a.done;
  var bDone = b.recurring ? (b.recurringDone === todayStr()) : !!b.done;
  if (aDone !== bDone) return aDone ? 1 : -1;
  var aKey = taskDueTimestamp(a); aKey = aKey === null ? Infinity : aKey;
  var bKey = taskDueTimestamp(b); bKey = bKey === null ? Infinity : bKey;
  if (aKey !== bKey) return aKey - bKey;
  var aP = a.priority === "high" ? 0 : a.priority === "medium" ? 1 : 2;
  var bP = b.priority === "high" ? 0 : b.priority === "medium" ? 1 : 2;
  if (aP !== bP) return aP - bP;
  return b.createdAt - a.createdAt;
}

function isUrl(t) { return /^https?:\/\//i.test(t || ""); }
function esc(s) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
function hl(text, q) {
  if (!q) return esc(text);
  try {
    var eq = q.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
    return esc(text).replace(new RegExp("("+eq+")","gi"),"<mark>$1</mark>");
  } catch(_) { return esc(text); }
}
function relTime(t) {
  if (!t) return "";
  var d = Date.now()-t;
  if (d<60000)    return "just now";
  if (d<3600000)  return Math.floor(d/60000)+"m ago";
  if (d<86400000) return Math.floor(d/3600000)+"h ago";
  return new Date(t).toLocaleDateString(undefined,{month:"short",day:"numeric"});
}

// "10:00 PM" from "22:00" — 24h storage, 12h display.
function formatTime(hhmm) {
  var parts = hhmm.split(":"); var h = parseInt(parts[0], 10);
  var ampm = h >= 12 ? "PM" : "AM";
  var h12 = h % 12; if (h12 === 0) h12 = 12;
  return h12 + ":" + parts[1] + " " + ampm;
}

// "Sep 26", "Today at 10:00 PM", "Tomorrow", "10:00 PM" (time-only, no day —
// e.g. a recurring habit), or "Sep 20 (overdue)" — never a bare ISO date,
// since scanning a list of tasks for what's due when is the whole point.
function formatDue(dueDateStr, dueTimeStr) {
  var timeLabel = dueTimeStr ? formatTime(dueTimeStr) : "";
  if (!dueDateStr) return timeLabel;
  var d = new Date(dueDateStr + "T00:00:00");
  var today = new Date(); today.setHours(0,0,0,0);
  var diffDays = Math.round((d.getTime() - today.getTime()) / 86400000);
  var dayLabel = diffDays === 0 ? "Today" : diffDays === 1 ? "Tomorrow" : d.toLocaleDateString(undefined,{month:"short",day:"numeric"});
  return dayLabel + (timeLabel ? " at " + timeLabel : "") + (diffDays < 0 ? " (overdue)" : "");
}

function categoryBadgeHTML(c) {
  var meta = c.category && CATEGORIES[c.category];
  if (!meta) return "";
  return '<span class="badge badge-category">' + meta.icon + " " + esc(meta.label) + '</span>';
}

function archivedStripHTML(c) {
  if (!c.archived) return "";
  return '<div class="archived-strip"><span>📦 Archived' + (c.archivedAt ? " " + relTime(c.archivedAt) : "") + '</span>'
    + '<button class="ts-btn" data-action="unarchive" data-id="' + esc(c.id) + '">Unarchive</button></div>';
}

function taskCardHTML(c) {
  var doneToday = c.recurring ? (c.recurringDone === todayStr()) : !!c.done;
  var dueTs = taskDueTimestamp(c);
  var overdue = !c.recurring && dueTs !== null && !doneToday && dueTs < Date.now();
  var recurLabel = (Array.isArray(c.recurDays) && c.recurDays.length)
    ? c.recurDays.slice().sort().map(function (d) { return WEEKDAY_ABBR[d]; }).join(",")
    : "Daily";
  var badge = c.recurring
    ? '<span class="task-badge task-recurring">↻ ' + esc(recurLabel) + (c.dueTime ? " at " + esc(formatTime(c.dueTime)) : "") + '</span>'
    : (c.dueDate || c.dueTime) ? '<span class="task-badge' + (overdue ? " task-overdue" : "") + '">' + esc(formatDue(c.dueDate, c.dueTime)) + '</span>' : "";
  var priorityBadge = c.priority === "high"
    ? '<span class="task-badge task-priority-high">● High</span>'
    : c.priority === "medium" ? '<span class="task-badge task-priority-medium">● Medium</span>' : "";
  var checkSvg = doneToday
    ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
    : "";
  var selectBox = selectMode
    ? '<div class="card-select' + (selectedIds.has(c.id) ? " checked" : "") + '"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div>'
    : "";
  return '<div class="clip-card is-task' + (doneToday ? " is-done" : "") + (overdue ? " is-overdue" : "") + (c.priority === "high" ? " is-priority-high" : "") + (selectMode && selectedIds.has(c.id) ? " is-selected" : "") + '" data-id="' + esc(c.id) + '" data-content="' + esc(c.content) + '">'
    + selectBox
    + '<div class="task-row">'
    + '<button class="task-check" data-action="toggle" data-id="' + esc(c.id) + '" title="' + (doneToday ? "Mark not done" : "Mark done") + '">' + checkSvg + '</button>'
    + '<div class="task-body"><div class="task-text">' + esc(c.content) + '</div>'
    + (badge || priorityBadge || c.category ? '<div class="task-meta">' + priorityBadge + badge + categoryBadgeHTML(c) + '</div>' : '')
    + archivedStripHTML(c)
    + '</div>'
    + '<button class="act-btn danger" data-action="delete" data-id="' + esc(c.id) + '" data-content=""><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg></button>'
    + '</div></div>';
}

function cardHTML(c, q) {
  if (c.type === "task") return taskCardHTML(c);
  var isNote=c.type==="note", link=!isNote&&isUrl(c.content);
  var preview=(c.content||"").replace(/\r?\n/g," ").slice(0,280);
  // Encrypted at rest and never sent to the LLM — masked here too by default.
  // The real value (already decrypted in memory) is still what Copy uses and
  // what the delete/edit confirm dialogs show, since those are purely local.
  var maskedBody = c.sensitive
    ? '<span class="lock-icon">🔒</span> ' + esc(c.key || "sensitive") + ": " + "•".repeat(Math.min(24, Math.max(8, preview.length)))
    : null;
  var fav=(c.favicon&&!isNote)
    ?'<img class="fav" src="'+esc(c.favicon)+'">'
    :'<div class="fav-dot'+(isNote?" fav-note":"")+'"></div>';
  var bc=isNote?"badge-note":(link?"badge-link":"badge-text");
  var bl=isNote?"Note":(link?"Link":"Clip");
  var domain=isNote?"Personal note":esc(c.domain||"Clipboard");
  var openBtn=link
    ?'<button class="act-btn" data-action="open" data-content="'+esc(c.content)+'"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>Open</button>'
    :"";
  var copyBtn='<button class="act-btn" data-action="copy" data-content="'+esc(c.content)+'"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>Copy</button>';
  var delBtn='<button class="act-btn danger" data-action="delete" data-id="'+esc(c.id)+'" data-content=""><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg></button>';
  var suggestTask = !isNote && !c.sensitive && looksLikeTaskContent(c.content) && getDismissedSuggestions().indexOf(c.id) === -1;
  var suggestStrip = suggestTask
    ? '<div class="task-suggest"><span>Looks like a task</span><div class="ts-actions">'
      + '<button class="ts-btn" data-action="suggest-task" data-id="'+esc(c.id)+'" data-content="'+esc(c.content)+'">+ Add as task</button>'
      + '<button class="ts-dismiss" data-action="dismiss-suggest" data-id="'+esc(c.id)+'" title="Dismiss">&#10005;</button>'
      + '</div></div>'
    : "";
  var selectBox = selectMode
    ? '<div class="card-select' + (selectedIds.has(c.id) ? " checked" : "") + '"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div>'
    : "";
  return '<div class="clip-card'+(isNote?" is-note":"")+(selectMode && selectedIds.has(c.id) ? " is-selected" : "")+'" data-id="'+esc(c.id)+'" data-content="'+esc(c.content)+'">'
    + selectBox
    +'<div class="card-meta">'+fav+'<span class="domain">'+domain+'</span><span class="ts">'+relTime(c.createdAt)+'</span></div>'
    +'<div class="card-body'+(link?" is-link":"")+'">'+(maskedBody || hl(preview,q))+'</div>'
    + suggestStrip
    + archivedStripHTML(c)
    +'<div class="card-foot"><span class="badge '+bc+'">'+bl+'</span>'
    + categoryBadgeHTML(c)
    +'<div class="card-actions">'+openBtn+copyBtn+delBtn+'</div></div></div>';
}

// "3 done · 2 overdue · 4 upcoming" — a quick at-a-glance status shown above
// the list whenever the Tasks filter is active, always over the FULL task
// set (not whatever a search happens to match), so it reads as a stable
// daily summary rather than something that jumps around while typing.
function taskSummaryHTML() {
  var tasks = allClips.filter(function (c) { return c.type === "task"; });
  if (!tasks.length) return "";
  var today = todayStr();
  var done = 0, overdue = 0, upcoming = 0;
  tasks.forEach(function (c) {
    if (c.recurring && !taskAppliesToday(c)) return; // not scheduled today — irrelevant to today's summary
    var doneToday = c.recurring ? (c.recurringDone === today) : !!c.done;
    if (doneToday) { done++; return; }
    var dueTs = taskDueTimestamp(c);
    if (!c.recurring && dueTs !== null && dueTs < Date.now()) overdue++;
    else upcoming++;
  });
  var rescheduleBtn = overdue > 0
    ? '<button class="ts-reschedule-all" data-action="reschedule-overdue">Reschedule to today</button>'
    : "";
  return '<div class="task-summary">'
    + '<span class="ts-item ts-done">' + done + ' done</span>'
    + '<span class="ts-sep">·</span>'
    + '<span class="ts-item ts-overdue">' + overdue + ' overdue</span>'
    + '<span class="ts-sep">·</span>'
    + '<span class="ts-item ts-upcoming">' + upcoming + ' upcoming</span>'
    + rescheduleBtn
    + '</div>';
}

function render(clips, q) {
  lastRenderedClips = clips;
  var summary = activeFilter === "task" ? taskSummaryHTML() : "";
  if (!clips.length) { clipsList.innerHTML = summary; emptyState.style.display = summary ? "none" : "flex"; updateBulkBar(); return; }
  emptyState.style.display="none";
  clipsList.innerHTML=summary + clips.map(function(c){return cardHTML(c,q);}).join("");
  bindCardActions();
  updateBulkBar();
}

function bindCardActions() {
  clipsList.querySelectorAll("img.fav").forEach(function(img){
    img.addEventListener("error", function(){ img.style.display = "none"; });
  });
  if (selectMode) {
    clipsList.querySelectorAll(".clip-card").forEach(function (el) {
      el.addEventListener("click", function (e) {
        e.stopPropagation();
        toggleSelect(el.dataset.id);
      });
    });
    return;
  }
  clipsList.querySelectorAll("[data-action]").forEach(function(btn){
    btn.addEventListener("click",function(e){
      e.stopPropagation();
      var action=btn.dataset.action,id=btn.dataset.id,content=btn.dataset.content;
      if(action==="copy")   doCopy(content,btn);
      if(action==="delete") doDelete(id);
      if(action==="open")   window.contexto.openExternal(content);
      if(action==="toggle") doToggleTask(id);
      if(action==="suggest-task")   doSuggestTask(id,content);
      if(action==="dismiss-suggest") doDismissSuggest(id);
      if(action==="reschedule-overdue") doRescheduleOverdue();
      if(action==="unarchive") doUnarchive(id);
    });
  });
  clipsList.querySelectorAll(".clip-card").forEach(function(el){
    el.addEventListener("click",function(e){
      if(e.target.closest("[data-action]")) return;
      if(el.classList.contains("is-task")) return; // tap the checkbox instead
      doCopy(el.dataset.content);
    });
  });
}

// Converts an auto-captured clip into a real task, then removes the
// original clip so the same content isn't sitting in two places at once.
function doSuggestTask(id, content) {
  saveClip({
    id: cryptoRandomId(), type: "task", content: content,
    url: "", title: "Task", favicon: "", domain: "task",
    createdAt: Date.now(), vector: embed(content), key: null,
    category: categorize(content, null),
    dueDate: null, dueTime: null, recurring: false, priority: null,
    done: false, recurringDone: null, notifiedAt: null,
  }).then(function () { return deleteClip(id); })
    .then(function () { showToast("Added as task", "success"); loadClips(); })
    .catch(function () { showToast("Couldn't add task", "error"); });
}
function doDismissSuggest(id) {
  dismissSuggestion(id);
  renderFiltered();
}

function doCopy(text,btn) {
  window.contexto.writeClipboard(text);
  showToast("Copied!","success");
  if(btn){var o=btn.innerHTML;btn.innerHTML="&#10003; Done";setTimeout(function(){btn.innerHTML=o;},1400);}
}

function doDelete(id) {
  deleteClip(id).then(function(){
    allClips=allClips.filter(function(c){return c.id!==id;});
    updateCount(); renderFiltered(); updateDueBadge(); showToast("Deleted");
  }).catch(function(){showToast("Delete failed","error");});
}

function doToggleTask(id) {
  var task = allClips.filter(function(c){ return c.id === id; })[0];
  if (!task) { showToast("Task not found", "error"); return; }
  if (task.recurring) {
    task.recurringDone = task.recurringDone === todayStr() ? null : todayStr();
  } else {
    task.done = !task.done;
    task.completedAt = task.done ? Date.now() : null;
  }
  saveClip(task).then(function(){ renderFiltered(); updateDueBadge(); })
    .catch(function(){ showToast("Couldn't update task", "error"); });
}

function doUnarchive(id) {
  var item = allClips.filter(function (c) { return c.id === id; })[0];
  if (!item) { showToast("Item not found", "error"); return; }
  item.archived = false;
  item.archivedAt = null;
  saveClip(item).then(function () { showToast("Unarchived", "success"); loadClips(); })
    .catch(function () { showToast("Couldn't unarchive", "error"); });
}

// Bulk-friendly version of a single reschedule — pushes every currently
// overdue (non-recurring) task's date to today in one confirm, for when
// things have piled up instead of clicking through them one by one.
function doRescheduleOverdue() {
  var today = todayStr();
  var now = Date.now();
  var overdueTasks = allClips.filter(function (c) {
    if (c.type !== "task" || c.recurring || c.done) return false;
    var dueTs = taskDueTimestamp(c);
    return dueTs !== null && dueTs < now;
  });
  if (!overdueTasks.length) { showToast("No overdue tasks"); return; }
  if (!confirm("Reschedule " + overdueTasks.length + " overdue task(s) to today?")) return;
  Promise.all(overdueTasks.map(function (c) {
    var updated = Object.assign({}, c, { dueDate: today, recurring: false, recurDays: null, notifiedAt: null });
    return saveClip(updated);
  })).then(function () {
    showToast(overdueTasks.length + " task(s) rescheduled to today", "success");
    loadClips();
  });
}

// Upserts by id (IndexedDB .put() on the "id" keyPath), so the existing
// record is overwritten in place rather than duplicated. Notes stay verbatim
// (no stripSensitive) — same as how they're first saved — since routing an
// edited password note through stripSensitive would silently redact it.
// Auto-captured clips DO get stripSensitive, matching how they're first
// captured off the OS clipboard.
function doEdit(id, newContent) {
  var existing = allClips.filter(function (c) { return c.id === id; })[0];
  if (!existing) { showToast("Item not found", "error"); return; }
  var clean = existing.type === "note" ? newContent : stripSensitive(newContent);
  var key = extractKey(clean);
  maybeEncrypt(clean, key).then(function (r) {
    var updated = Object.assign({}, existing, { content: r.content, vector: embed(clean), key: key, sensitive: r.sensitive, category: categorize(clean, existing.domain) });
    return saveClip(updated);
  }).then(function () { showToast("Updated!", "success"); loadClips(); })
    .catch(function () { showToast("Update failed", "error"); });
}

function doReschedule(id, dueDate, dueTime, recurring, recurDays) {
  var existing = allClips.filter(function (c) { return c.id === id; })[0];
  if (!existing) { showToast("Task not found", "error"); return; }
  var updated = Object.assign({}, existing, {
    dueDate: dueDate || null, dueTime: dueTime || null, recurring: !!recurring,
    recurDays: (Array.isArray(recurDays) && recurDays.length) ? recurDays : null, notifiedAt: null,
  });
  saveClip(updated).then(function () {
    showToast("Rescheduled!", "success"); loadClips(); updateDueBadge();
  }).catch(function () { showToast("Reschedule failed", "error"); });
}

function confirmClearAll() {
  if(!allClips.length){showToast("Nothing to clear");return;}
  if(!confirm("Delete all "+allClips.length+" items? This cannot be undone.")) return;
  clearAllClips().then(function(){
    allClips=[];updateCount();renderFiltered();showToast("All cleared");
  });
}

function showToast(text,type) {
  var toast=document.getElementById("toast");
  toast.textContent=text;
  toast.className="toast show"+(type?" "+type:"");
  clearTimeout(toast._t);
  toast._t=setTimeout(function(){toast.className="toast";},2200);
}

// ── Command palette (Ctrl/Cmd+K) ─────────────────────────────────────────────
function setFilter(name) {
  document.querySelectorAll(".pill").forEach(function (p) { p.classList.remove("active"); });
  var pill = document.querySelector('.pill[data-filter="' + name + '"]');
  if (pill) pill.classList.add("active");
  activeFilter = name;
  renderFiltered();
}
function cmdkActions() {
  return [
    { label: "Add a task", hint: "+ Task", run: function () {
      if (quickTaskForm.style.display === "none") quickTaskBtn.click();
      qtText.focus();
    } },
    { label: "Focus composer (new note / task)", hint: "Enter", run: function () { hideSettings(); noteInput.focus(); } },
    { label: "Focus search", hint: "/", run: function () { hideSettings(); searchInput.focus(); } },
    { label: "Show all items", hint: "Filter", run: function () { hideSettings(); setFilter("all"); } },
    { label: "Show tasks", hint: "Filter", run: function () { hideSettings(); setFilter("task"); } },
    { label: "Show notes", hint: "Filter", run: function () { hideSettings(); setFilter("note"); } },
    { label: "Toggle dark / light theme", hint: "Theme", run: function () { themeBtn.click(); } },
    { label: "Open settings", hint: "Settings", run: function () { showSettings(); } },
    { label: "Export backup", hint: "Your Data", run: function () { showSettings(); setTimeout(function () { exportBtn.click(); }, 50); } },
    { label: "Import backup", hint: "Your Data", run: function () { showSettings(); setTimeout(function () { importBtn.click(); }, 50); } },
    { label: "Clear all items", hint: "Danger", run: function () { hideSettings(); confirmClearAll(); } },
    { label: "Minimize panel", hint: "⇧⌘K", run: function () { window.contexto.hidePanel(); } },
  ];
}
var cmdkSelected = 0, cmdkFiltered = [];
function initCommandPalette() {
  cmdkBtn.addEventListener("click", openPalette);
  document.addEventListener("keydown", function (e) {
    var meta = e.metaKey || e.ctrlKey;
    if (meta && !e.shiftKey && e.key.toLowerCase() === "k") { e.preventDefault(); openPalette(); return; }
    if (e.key === "Escape" && cmdkOverlay.style.display !== "none") { closePalette(); }
  });
  cmdkOverlay.addEventListener("click", function (e) { if (e.target === cmdkOverlay) closePalette(); });
  cmdkInput.addEventListener("input", function () { cmdkSelected = 0; renderPalette(cmdkInput.value); });
  cmdkInput.addEventListener("keydown", function (e) {
    if (e.key === "ArrowDown") { e.preventDefault(); cmdkSelected = Math.min(cmdkSelected + 1, cmdkFiltered.length - 1); renderPalette(cmdkInput.value); }
    else if (e.key === "ArrowUp") { e.preventDefault(); cmdkSelected = Math.max(cmdkSelected - 1, 0); renderPalette(cmdkInput.value); }
    else if (e.key === "Enter") { e.preventDefault(); runSelectedPaletteAction(); }
  });
}
function openPalette() {
  cmdkSelected = 0;
  cmdkInput.value = "";
  cmdkOverlay.style.display = "flex";
  renderPalette("");
  setTimeout(function () { cmdkInput.focus(); }, 0);
}
function closePalette() { cmdkOverlay.style.display = "none"; }
function renderPalette(query) {
  var q = (query || "").toLowerCase();
  cmdkFiltered = cmdkActions().filter(function (a) { return a.label.toLowerCase().indexOf(q) !== -1; });
  if (!cmdkFiltered.length) { cmdkList.innerHTML = '<div class="cmdk-empty">No matching commands</div>'; return; }
  cmdkList.innerHTML = cmdkFiltered.map(function (a, i) {
    return '<div class="cmdk-item' + (i === cmdkSelected ? " active" : "") + '" data-idx="' + i + '">'
      + '<span>' + esc(a.label) + '</span><span class="cmdk-hint">' + esc(a.hint || "") + '</span></div>';
  }).join("");
  cmdkList.querySelectorAll(".cmdk-item").forEach(function (el) {
    el.addEventListener("click", function () { cmdkSelected = parseInt(el.dataset.idx, 10); runSelectedPaletteAction(); });
  });
}
function runSelectedPaletteAction() {
  var action = cmdkFiltered[cmdkSelected];
  closePalette();
  if (action) action.run();
}

// ── Bulk select ───────────────────────────────────────────────────────────────
function initSelectMode() {
  selectModeBtn.addEventListener("click", function () {
    selectMode = !selectMode;
    if (!selectMode) selectedIds.clear();
    selectModeBtn.classList.toggle("active", selectMode);
    renderFiltered();
  });
  bulkCancel.addEventListener("click", function () {
    selectMode = false;
    selectedIds.clear();
    selectModeBtn.classList.remove("active");
    renderFiltered();
  });
  bulkSelectAll.addEventListener("click", function () {
    var allSelected = lastRenderedClips.length > 0 && lastRenderedClips.every(function (c) { return selectedIds.has(c.id); });
    if (allSelected) selectedIds.clear();
    else lastRenderedClips.forEach(function (c) { selectedIds.add(c.id); });
    renderFiltered();
  });
  bulkDelete.addEventListener("click", function () {
    if (!selectedIds.size) { showToast("Nothing selected"); return; }
    var ids = Array.from(selectedIds);
    if (!confirm("Delete " + ids.length + " item(s)? This cannot be undone.")) return;
    Promise.all(ids.map(function (id) { return deleteClip(id); })).then(function () {
      selectedIds.clear();
      showToast(ids.length + " item(s) deleted", "success");
      loadClips();
    });
  });
  bulkExport.addEventListener("click", function () {
    if (!selectedIds.size) { showToast("Nothing selected"); return; }
    var items = allClips.filter(function (c) { return selectedIds.has(c.id); }).map(clipToExportItem);
    downloadBackup(items);
    showToast(items.length + " item(s) exported", "success");
  });
  bulkAddTasks.addEventListener("click", function () {
    var targets = lastRenderedClips.filter(function (c) { return selectedIds.has(c.id) && c.type !== "task" && c.type !== "note"; });
    if (!targets.length) { showToast("Select some clips (not notes/tasks) first", "error"); return; }
    Promise.all(targets.map(function (c) {
      return saveClip({
        id: cryptoRandomId(), type: "task", content: c.content,
        url: "", title: "Task", favicon: "", domain: "task",
        createdAt: Date.now(), vector: embed(c.content), key: null,
        category: categorize(c.content, null),
        dueDate: null, dueTime: null, recurring: false, priority: null,
        done: false, recurringDone: null, notifiedAt: null,
      }).then(function () { return deleteClip(c.id); });
    })).then(function () {
      selectedIds.clear();
      showToast(targets.length + " item(s) added as tasks", "success");
      loadClips();
    });
  });
}
function toggleSelect(id) {
  if (!id) return;
  if (selectedIds.has(id)) selectedIds.delete(id); else selectedIds.add(id);
  renderFiltered();
}
function updateBulkBar() {
  if (!bulkBar) return;
  bulkBar.style.display = selectMode ? "flex" : "none";
  bulkCount.textContent = selectedIds.size + " selected";
  clipsList.classList.toggle("select-mode", selectMode);
}
