// Contexto AI - Side Panel Controller (AI-powered)

var MSG = {
  SEARCH_CLIPS:  "SEARCH_CLIPS",
  GET_ALL_CLIPS: "GET_ALL_CLIPS",
  DELETE_CLIP:   "DELETE_CLIP",
  CLEAR_ALL:     "CLEAR_ALL",
  CLIP_SAVED:    "CLIP_SAVED",
  ADD_NOTE:      "ADD_NOTE",
  ADD_TASK:      "ADD_TASK",
  TOGGLE_TASK:   "TOGGLE_TASK",
  RESCHEDULE_TASK:"RESCHEDULE_TASK",
  EXPORT_DATA:   "EXPORT_DATA",
  IMPORT_DATA:   "IMPORT_DATA",
  EMBED_AND_SAVE:"EMBED_AND_SAVE",
  AI_QUERY:      "AI_QUERY",
  SAVE_CONFIG:   "SAVE_CONFIG",
  GET_CONFIG:    "GET_CONFIG",
};

function todayStr() {
  var d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
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

var allClips = [], activeFilter = "all", searchQuery = "", searchTimer;
var searchInput, clearSearch, clipsList, emptyState, clipCount;
var clearBtn, settingsBtn, backBtn, saveSettingsBtn;
var noteInput, saveNoteBtn, composerHint, aiStatus, aiStatusText;
var apiKeyInput, proxyInput, modelSelect, toggleApiKey, settingsStatus;
var mainView, settingsView;
var themeBtn, themeIconMoon, themeIconSun;
var quickTaskBtn, quickTaskForm, qtText, qtDate, qtTime, qtPriority, qtRecurring, qtCancel, qtSave;
var exportBtn, importBtn, importFile;
var streakBadge, onboardTip, onboardTipText, onboardSkip, onboardNext;
var cmdkBtn, cmdkOverlay, cmdkInput, cmdkList;
var hasApiKey = false;

document.addEventListener("DOMContentLoaded", function () {
  mainView      = document.getElementById("mainView");
  settingsView  = document.getElementById("settingsView");
  searchInput   = document.getElementById("searchInput");
  clearSearch   = document.getElementById("clearSearch");
  clipsList     = document.getElementById("clipsList");
  emptyState    = document.getElementById("emptyState");
  clipCount     = document.getElementById("clipCount");
  clearBtn      = document.getElementById("clearBtn");
  settingsBtn   = document.getElementById("settingsBtn");
  backBtn       = document.getElementById("backBtn");
  saveSettingsBtn = document.getElementById("saveSettingsBtn");
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
  var logoImg = document.getElementById("logoImg");
  if (logoImg) logoImg.addEventListener("error", function () { logoImg.style.display = "none"; });
  initTheme();
  initDataActions();
  initOnboarding();
  initCommandPalette();
  init();
});

// ── Onboarding (shown once) ──────────────────────────────────────────────────
var ONBOARD_STEPS = [
  "Type naturally in the box above — save a note, ask a question, or write “remind me to call mom tomorrow” to add a task.",
  "Use the + Task button for a quick manual task with a due date and priority — no AI needed.",
  "Everything stays only on this device. Back it up any time from Settings → Your Data.",
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

  var relevant = allClips.filter(function (c) { return c.type === "task" && (c.recurring || c.dueDate === today); });
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
function initDataActions() {
  exportBtn.addEventListener("click", function () {
    send({ type: MSG.EXPORT_DATA }).then(function (r) {
      if (!r || !r.ok) { showToast("Export failed", "error"); return; }
      var blob = new Blob([JSON.stringify({ app: "contexto-ai", exportedAt: Date.now(), items: r.items }, null, 2)], { type: "application/json" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "contexto-backup-" + todayStr() + ".json";
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast(r.items.length + " item(s) exported", "success");
    }).catch(function () { showToast("Export failed", "error"); });
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
      send({ type: MSG.IMPORT_DATA, data: { items: items } }).then(function (r) {
        if (r && r.ok) { showToast(r.count + " item(s) imported", "success"); loadClips(); }
        else showToast("Import failed", "error");
      }).catch(function () { showToast("Import failed", "error"); });
    };
    reader.readAsText(file);
  });
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

window.addEventListener("focus", function () { loadClips(); });
chrome.runtime.onMessage.addListener(function (m) {
  if (m.type === MSG.CLIP_SAVED) loadClips();
});

function init() {
  loadConfig();
  loadClips();

  // Composer
  noteInput.addEventListener("input", function () {
    noteInput.style.height = "auto";
    noteInput.style.height = Math.min(noteInput.scrollHeight, 120) + "px";
    updateHint();
  });
  noteInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
  });
  saveNoteBtn.addEventListener("click", handleSubmit);

  // Search
  searchInput.addEventListener("input", function () {
    searchQuery = searchInput.value.trim();
    clearSearch.style.display = searchQuery ? "flex" : "none";
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderFiltered, 220);
  });
  clearSearch.addEventListener("click", function () {
    searchInput.value = ""; searchQuery = "";
    clearSearch.style.display = "none";
    renderFiltered(); searchInput.focus();
  });

  // Pills
  document.querySelectorAll(".pill").forEach(function (p) {
    p.addEventListener("click", function () {
      document.querySelectorAll(".pill").forEach(function (x) { x.classList.remove("active"); });
      p.classList.add("active"); activeFilter = p.dataset.filter; renderFiltered();
    });
  });

  clearBtn.addEventListener("click", confirmClearAll);
  settingsBtn.addEventListener("click", showSettings);
  backBtn.addEventListener("click", hideSettings);
  saveSettingsBtn.addEventListener("click", doSaveSettings);
  toggleApiKey.addEventListener("click", function () {
    apiKeyInput.type = apiKeyInput.type === "password" ? "text" : "password";
  });

  // Manual quick-add task — bypasses AI entirely, works identically with or
  // without an API key configured, and never gets misclassified.
  quickTaskBtn.addEventListener("click", function () {
    var opening = quickTaskForm.style.display === "none";
    quickTaskForm.style.display = opening ? "block" : "none";
    if (opening) { qtText.value = ""; qtDate.value = ""; qtTime.value = ""; qtPriority.value = ""; qtRecurring.checked = false; qtText.focus(); }
  });
  qtCancel.addEventListener("click", function () { quickTaskForm.style.display = "none"; });
  qtSave.addEventListener("click", function () {
    var text = qtText.value.trim();
    if (!text) { qtText.focus(); return; }
    send({ type: MSG.ADD_TASK, data: {
      id: crypto.randomUUID(), text: text,
      dueDate: qtDate.value || null, dueTime: qtTime.value || null,
      priority: qtPriority.value || null,
      recurring: qtRecurring.checked, createdAt: Date.now(),
    }}).then(function (sr) {
      if (sr && sr.ok) { showToast("Task added!", "success"); quickTaskForm.style.display = "none"; loadClips(); }
      else showToast("Couldn't add task", "error");
    });
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
}

// ── Config ────────────────────────────────────────────────────────────────────
function loadConfig() {
  send({ type: MSG.GET_CONFIG }).then(function (r) {
    if (!r || !r.ok) return;
    var cfg = r.config;
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
  send({ type: MSG.SAVE_CONFIG, data: cfg }).then(function (r) {
    hasApiKey = !!(cfg.apiKey);
    settingsStatus.textContent = r && r.ok ? "Saved!" : "Save failed";
    settingsStatus.style.color = (r && r.ok) ? "var(--green)" : "var(--red)";
    setTimeout(function () { settingsStatus.textContent = ""; }, 2000);
    updateHint();
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
  // Quick local pre-check for hint only
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

// ── Submit ────────────────────────────────────────────────────────────────────
// ── No-API-key fallback ──────────────────────────────────────────────────────
// The AI layer (natural-language save/query/delete/edit/task) needs an LLM,
// but basic clipboard use shouldn't be gated behind getting an API key first
// — that's real friction for someone who just wants to try the app. Without
// a key, "save" and "search" still work, using this local regex classifier
// instead of an LLM call. Structured task extraction (dates/times/recurring)
// genuinely needs an LLM to parse reliably, so without a key that's covered
// by the manual "+ Task" quick-add form instead (see quickAddTask()).
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
    var note = { id: crypto.randomUUID(), content: text, createdAt: Date.now() };
    send({ type: MSG.ADD_NOTE, data: note }).then(function (sr) {
      if (sr && sr.ok) { showToast("Saved!", "success"); loadClips(); }
      else showToast("Save failed", "error");
    });
  }
}

function handleSubmit() {
  var text = noteInput.value.trim();
  if (!text) { noteInput.focus(); return; }

  if (!hasApiKey) {
    handleLocalSubmit(text);
    return;
  }

  saveNoteBtn.disabled = true;
  noteInput.disabled   = true;
  showAiStatus("AI is thinking\u2026");

  // Send to background orchestrator with current clips as context
  send({ type: MSG.AI_QUERY, data: {
      input: text,
      // Strip large vector arrays before sending — background re-ranks using its own embedder.
      // Sensitive items never get their real value sent, even to our own background
      // worker — background answers those via the "answer_local" path instead,
      // which just points back at this same in-memory (already-decrypted) copy.
      clips: allClips.map(function(c) {
        return {
          id:c.id, domain:c.domain, type:c.type, createdAt:c.createdAt, favicon:c.favicon, key:c.key,
          sensitive:c.sensitive,
          content: c.sensitive ? "[sensitive value hidden]" : c.content,
        };
      })
    } })
    .then(function (r) {
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
        // Save the extracted fact as a note
        var note = { id: crypto.randomUUID(), content: result.content, createdAt: Date.now() };
        send({ type: MSG.ADD_NOTE, data: note }).then(function (sr) {
          if (sr && sr.ok) { showToast("Saved!", "success"); loadClips(); }
          else showToast("Save failed", "error");
        });
      } else if (result.action === "task") {
        // One message can describe several tasks — add them all, one save
        // per task so each gets its own card, then a single summary toast.
        var tasksToAdd = result.tasks || [];
        Promise.all(tasksToAdd.map(function (t) {
          return send({ type: MSG.ADD_TASK, data: {
            id: crypto.randomUUID(), text: t.text, dueDate: t.dueDate, dueTime: t.dueTime,
            recurring: t.recurring, priority: t.priority, createdAt: Date.now(),
          }});
        })).then(function (results) {
          var ok = results.filter(function (r) { return r && r.ok; }).length;
          if (ok) showToast(ok === 1 ? "Task added!" : ok + " tasks added!", "success");
          if (ok < tasksToAdd.length) showToast((tasksToAdd.length - ok) + " task(s) failed", "error");
          loadClips();
        });
      } else if (result.action === "delete") {
        handleDeleteAction(result.matches);
      } else if (result.action === "reschedule") {
        handleRescheduleAction(result.matches, result.dueDate, result.dueTime, result.recurring);
      } else if (result.action === "edit") {
        handleEditAction(result.matches, result.newContent);
      } else if (result.action === "answer_local") {
        handleLocalAnswer(text, result.matchId);
      } else {
        // Show AI answer, plus the clips actually used as context
        renderAiAnswer(text, result.answer, result.context);
      }
    })
    .catch(function (e) {
      saveNoteBtn.disabled = false;
      noteInput.disabled   = false;
      hideAiStatus();
      showToast("Error: " + (e.message || "unknown"), "error");
    });
}

// Answers a sensitive-note query straight from our own already-decrypted
// in-memory copy — background matched it by label only, it never saw (and
// still doesn't see) the real value. Nothing sent to the LLM for this turn.
function handleLocalAnswer(query, matchId) {
  var match = allClips.filter(function (c) { return c.id === matchId; })[0];
  if (!match) { showToast("Couldn't find that note", "error"); return; }
  renderAiAnswer(query, match.content, [match]);
}

// Never delete outright from a natural-language request — always confirm
// against the actual matched content first, same as the "Clear all" button.
// Looks up the real local copy by id (background only ever saw a masked
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

function handleRescheduleAction(matches, dueDate, dueTime, recurring) {
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
    "To: " + newWhen + (recurring ? " (daily)" : "")
  )) {
    doReschedule(top.id, dueDate, dueTime, recurring);
  } else {
    showToast("Cancelled");
  }
}

function showAiStatus(msg) {
  aiStatusText.textContent = msg || "AI thinking\u2026";
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

  // Show the clips the AI actually used to answer — not just recent ones
  var related = (context && context.length) ? context : [];
  html += '<div class="results-divider">' + (related.length ? "Most relevant to your question" : "Your saved data") + '</div>';
  html += (related.length ? related : allClips.slice(0, 5)).map(function (c) { return cardHTML(c, query); }).join("");
  clipsList.innerHTML = html;

  document.getElementById("copyAnswerBtn").addEventListener("click", function () {
    navigator.clipboard.writeText(answer || "").then(function () { showToast("Copied!", "success"); });
  });
  document.getElementById("backToAllBtn").addEventListener("click", function () {
    renderFiltered();
  });
  bindCardActions();
}

// ── Data ──────────────────────────────────────────────────────────────────────
function send(data) {
  return new Promise(function (resolve, reject) {
    chrome.runtime.sendMessage(data, function (r) {
      if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
      resolve(r);
    });
  });
}

function loadClips() {
  send({ type: MSG.GET_ALL_CLIPS }).then(function (r) {
    allClips = (r && r.clips) ? r.clips : [];
    updateCount(); renderFiltered(); checkStreak();
  }).catch(function (e) { console.error("[Contexto]", e); });
}

function updateCount() {
  var n = allClips.length;
  clipCount.textContent = n === 1 ? "1 item" : n + " items";
}

// ── Render ────────────────────────────────────────────────────────────────────
function renderFiltered() {
  if (searchQuery.length > 0) {
    clipsList.innerHTML = '<div class="spinner"></div>';
    send({ type: MSG.SEARCH_CLIPS, data: { query: searchQuery } }).then(function (r) {
      render(applyFilter((r && r.results) ? r.results : []), searchQuery);
    }).catch(function () { render(applyFilter(allClips), ""); });
  } else { render(applyFilter(allClips), ""); }
}

function applyFilter(clips) {
  var start = new Date(); start.setHours(0,0,0,0);
  var out = clips.filter(function (c) {
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

function taskCardHTML(c) {
  var doneToday = c.recurring ? (c.recurringDone === todayStr()) : !!c.done;
  var dueTs = taskDueTimestamp(c);
  var overdue = !c.recurring && dueTs !== null && !doneToday && dueTs < Date.now();
  var badge = c.recurring
    ? '<span class="task-badge task-recurring">↻ Daily' + (c.dueTime ? " at " + esc(formatTime(c.dueTime)) : "") + '</span>'
    : (c.dueDate || c.dueTime) ? '<span class="task-badge' + (overdue ? " task-overdue" : "") + '">' + esc(formatDue(c.dueDate, c.dueTime)) + '</span>' : "";
  var priorityBadge = c.priority === "high"
    ? '<span class="task-badge task-priority-high">● High</span>'
    : c.priority === "medium" ? '<span class="task-badge task-priority-medium">● Medium</span>' : "";
  var checkSvg = doneToday
    ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
    : "";
  return '<div class="clip-card is-task' + (doneToday ? " is-done" : "") + (overdue ? " is-overdue" : "") + (c.priority === "high" ? " is-priority-high" : "") + '" data-content="' + esc(c.content) + '">'
    + '<div class="task-row">'
    + '<button class="task-check" data-action="toggle" data-id="' + esc(c.id) + '" title="' + (doneToday ? "Mark not done" : "Mark done") + '">' + checkSvg + '</button>'
    + '<div class="task-body"><div class="task-text">' + esc(c.content) + '</div>'
    + (badge || priorityBadge ? '<div class="task-meta">' + priorityBadge + badge + '</div>' : '')
    + '</div>'
    + '<button class="act-btn danger" data-action="delete" data-id="' + esc(c.id) + '" data-content=""><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg></button>'
    + '</div></div>';
}

function cardHTML(c, q) {
  if (c.type === "task") return taskCardHTML(c);
  var isNote=c.type==="note", link=!isNote&&isUrl(c.content);
  // Encrypted at rest and never sent to the LLM — masked here too by default.
  // The real value (already decrypted in memory) is still what Copy uses and
  // what the delete/edit confirm dialogs show, since those are purely local.
  var preview = (c.content||"").replace(/\r?\n/g," ").slice(0,280);
  var maskedBody = c.sensitive
    ? '<span class="lock-icon">🔒</span> ' + esc(c.key || "sensitive") + ": " + "•".repeat(Math.min(24, Math.max(8, preview.length)))
    : null;
  var fav=(c.favicon&&!isNote)
    ?'<img class="fav" src="'+esc(c.favicon)+'">'
    :'<div class="fav-dot'+(isNote?" fav-note":"")+'"></div>';
  var bc=isNote?"badge-note":(link?"badge-link":"badge-text");
  var bl=isNote?"Note":(link?"Link":"Clip");
  var domain=isNote?"Personal note":esc(c.domain||"unknown");
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
  return '<div class="clip-card'+(isNote?" is-note":"")+'" data-content="'+esc(c.content)+'">'
    +'<div class="card-meta">'+fav+'<span class="domain">'+domain+'</span><span class="ts">'+relTime(c.createdAt)+'</span></div>'
    +'<div class="card-body'+(link?" is-link":"")+'">'+(maskedBody || hl(preview,q))+'</div>'
    + suggestStrip
    +'<div class="card-foot"><span class="badge '+bc+'">'+bl+'</span>'
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
    var doneToday = c.recurring ? (c.recurringDone === today) : !!c.done;
    if (doneToday) { done++; return; }
    var dueTs = taskDueTimestamp(c);
    if (!c.recurring && dueTs !== null && dueTs < Date.now()) overdue++;
    else upcoming++;
  });
  return '<div class="task-summary">'
    + '<span class="ts-item ts-done">' + done + ' done</span>'
    + '<span class="ts-sep">·</span>'
    + '<span class="ts-item ts-overdue">' + overdue + ' overdue</span>'
    + '<span class="ts-sep">·</span>'
    + '<span class="ts-item ts-upcoming">' + upcoming + ' upcoming</span>'
    + '</div>';
}

function render(clips, q) {
  var summary = activeFilter === "task" ? taskSummaryHTML() : "";
  if (!clips.length) { clipsList.innerHTML = summary; emptyState.style.display = summary ? "none" : "flex"; return; }
  emptyState.style.display="none";
  clipsList.innerHTML=summary + clips.map(function(c){return cardHTML(c,q);}).join("");
  bindCardActions();
}

function bindCardActions() {
  clipsList.querySelectorAll("img.fav").forEach(function(img){
    img.addEventListener("error", function(){ img.style.display = "none"; });
  });
  clipsList.querySelectorAll("[data-action]").forEach(function(btn){
    btn.addEventListener("click",function(e){
      e.stopPropagation();
      var action=btn.dataset.action,id=btn.dataset.id,content=btn.dataset.content;
      if(action==="copy")   doCopy(content,btn);
      if(action==="delete") doDelete(id);
      if(action==="open")   window.open(content,"_blank");
      if(action==="toggle") doToggleTask(id);
      if(action==="suggest-task")   doSuggestTask(id,content);
      if(action==="dismiss-suggest") doDismissSuggest(id);
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
  send({ type: MSG.ADD_TASK, data: { id: crypto.randomUUID(), text: content, createdAt: Date.now() } }).then(function (r) {
    if (!r || !r.ok) { showToast("Couldn't add task", "error"); return Promise.reject(); }
    return send({ type: MSG.DELETE_CLIP, data: { id: id } });
  }).then(function () { showToast("Added as task", "success"); loadClips(); })
    .catch(function () {});
}
function doDismissSuggest(id) {
  dismissSuggestion(id);
  renderFiltered();
}

function doCopy(text,btn) {
  navigator.clipboard.writeText(text).then(function(){
    showToast("Copied!","success");
    if(btn){var o=btn.innerHTML;btn.innerHTML="&#10003; Done";setTimeout(function(){btn.innerHTML=o;},1400);}
  }).catch(function(){showToast("Copy failed","error");});
}

function doDelete(id) {
  send({type:MSG.DELETE_CLIP,data:{id:id}}).then(function(){
    allClips=allClips.filter(function(c){return c.id!==id;});
    updateCount(); renderFiltered(); showToast("Deleted");
  }).catch(function(){showToast("Delete failed","error");});
}

function doToggleTask(id) {
  send({type:MSG.TOGGLE_TASK, data:{id:id, day:todayStr()}}).then(function(r){
    if (!r || !r.ok) { showToast("Couldn't update task","error"); return; }
    loadClips();
  }).catch(function(){showToast("Couldn't update task","error");});
}

// Both paths upsert by id (IndexedDB .put() on the "id" keyPath), so the
// existing record is overwritten in place rather than duplicated. Notes go
// through ADD_NOTE to keep them verbatim (no sensitive-data stripping) —
// routing an edited password note through EMBED_AND_SAVE would silently
// redact it. Auto-captured clips go through EMBED_AND_SAVE so an edit still
// gets the same stripSensitive() pass a fresh capture would.
function doEdit(id, newContent) {
  var existing = allClips.filter(function (c) { return c.id === id; })[0];
  if (!existing) { showToast("Item not found", "error"); return; }
  var msg = existing.type === "note"
    ? { type: MSG.ADD_NOTE, data: { id: existing.id, content: newContent, createdAt: existing.createdAt } }
    : { type: MSG.EMBED_AND_SAVE, data: Object.assign({}, existing, { content: newContent }) };
  send(msg).then(function (r) {
    if (r && r.ok) { showToast("Updated!", "success"); loadClips(); }
    else showToast("Update failed", "error");
  }).catch(function () { showToast("Update failed", "error"); });
}

function doReschedule(id, dueDate, dueTime, recurring) {
  send({type: MSG.RESCHEDULE_TASK, data: {id: id, dueDate: dueDate, dueTime: dueTime, recurring: recurring}}).then(function (r) {
    if (r && r.ok) { showToast("Rescheduled!", "success"); loadClips(); }
    else showToast("Reschedule failed", "error");
  }).catch(function () { showToast("Reschedule failed", "error"); });
}

function confirmClearAll() {
  if(!allClips.length){showToast("Nothing to clear");return;}
  if(!confirm("Delete all "+allClips.length+" items? This cannot be undone.")) return;
  send({type:MSG.CLEAR_ALL}).then(function(){
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
  ];
}
var cmdkSelected = 0, cmdkFiltered = [];
function initCommandPalette() {
  cmdkBtn.addEventListener("click", openPalette);
  document.addEventListener("keydown", function (e) {
    var meta = e.metaKey || e.ctrlKey;
    if (meta && e.key.toLowerCase() === "k") { e.preventDefault(); openPalette(); return; }
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
