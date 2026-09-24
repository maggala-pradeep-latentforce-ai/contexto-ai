// Contexto AI - Desktop Renderer Controller
// Same UI/UX as the Chrome extension's side panel, but talks directly to
// IndexedDB + the embedding engine (no offscreen-doc relay needed — a
// standalone window already has full DOM access) and to the main process
// only for the privileged LLM fetch and window controls.

import { openDB, saveClip, getAllClips, deleteClip, clearAllClips } from "./db.js";
import { embed, cosineSim } from "./embed-engine.js";
import { stripSensitive, isSensitive, isSensitiveKey, encryptText, decryptText } from "./security.js";

var allClips = [], activeFilter = "all", searchQuery = "", searchTimer;
var searchInput, clearSearch, clipsList, emptyState, clipCount;
var clearBtn, settingsBtn, backBtn, saveSettingsBtn, hideBtn;
var noteInput, saveNoteBtn, composerHint, aiStatus, aiStatusText;
var apiKeyInput, proxyInput, modelSelect, toggleApiKey, settingsStatus;
var mainView, settingsView;
var themeBtn, themeIconMoon, themeIconSun;
var hasApiKey = false;
var lastClipText = "", lastClipTs = 0;

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

  var logoImg = document.getElementById("logoImg");
  if (logoImg) logoImg.addEventListener("error", function () { logoImg.style.display = "none"; });

  initTheme();
  init();
});

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

  clearBtn.addEventListener("click", confirmClearAll);
  settingsBtn.addEventListener("click", showSettings);
  backBtn.addEventListener("click", hideSettings);
  saveSettingsBtn.addEventListener("click", doSaveSettings);
  toggleApiKey.addEventListener("click", function () {
    apiKeyInput.type = apiKeyInput.type === "password" ? "text" : "password";
  });

  hideBtn.addEventListener("click", function () { window.contexto.hidePanel(); });

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

// ── Clipboard capture (no browser DOM/favicon context available here) ───────
function handleClipboardCapture(text, createdAt) {
  if (!text || text.length < 2) return;
  var now = createdAt || Date.now();
  if (text === lastClipText && now - lastClipTs < 1500) return;
  lastClipText = text; lastClipTs = now;

  var clean = stripSensitive(text);
  var key = extractKey(clean);
  maybeEncrypt(clean, key).then(function (r) {
    return saveClip({
      id: cryptoRandomId(), type: "text", content: r.content,
      url: "", title: "", favicon: "", domain: "Clipboard",
      createdAt: now, vector: embed(clean), key: key, sensitive: r.sensitive,
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
  if (!hasApiKey) {
    composerHint.textContent = "Add your API key in Settings to enable AI";
    composerHint.className = "composer-hint hint-warn";
    return;
  }
  var text = noteInput ? noteInput.value.trim() : "";
  if (!text) { composerHint.textContent = ""; composerHint.className = "composer-hint"; return; }
  var looksLikeDelete = /^(delete|remove|forget)\b/i.test(text);
  var looksLikeEdit = !looksLikeDelete && /^(change|update|correct|edit|fix)\b/i.test(text);
  var looksLikeQuery = !looksLikeDelete && !looksLikeEdit && /\?$|^(what|find|show|get|where|how|who|when|tell me|remind me)/i.test(text);
  composerHint.textContent = looksLikeDelete ? "AI will find and confirm before deleting"
    : looksLikeEdit ? "AI will find and confirm before updating"
    : looksLikeQuery ? "AI will search your data" : "AI will save as a note";
  composerHint.className = "composer-hint " + (looksLikeDelete || looksLikeEdit ? "hint-warn" : looksLikeQuery ? "hint-query" : "hint-save");
}

// ── Submit ────────────────────────────────────────────────────────────────────
function handleSubmit() {
  var text = noteInput.value.trim();
  if (!text) { noteInput.focus(); return; }

  if (!hasApiKey) {
    showToast("Add your API key in Settings first", "error");
    showSettings();
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
      var content = result.content;
      var key = extractKey(content);
      maybeEncrypt(content, key).then(function (r2) {
        return saveClip({
          id: cryptoRandomId(), type: "note", content: r2.content,
          url: "", title: "Manual Note", favicon: "", domain: "note",
          createdAt: Date.now(), vector: embed(content), key: key, sensitive: r2.sensitive,
        });
      }).then(function () { showToast("Saved!", "success"); loadClips(); })
        .catch(function () { showToast("Save failed", "error"); });
    } else if (result.action === "delete") {
      handleDeleteAction(result.matches);
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
    updateCount(); renderFiltered();
  }).catch(function (e) { console.error("[Contexto]", e); });
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
  return clips.filter(function (c) {
    if (activeFilter === "note")  return c.type === "note";
    if (activeFilter === "text")  return c.type !== "note" && !isUrl(c.content);
    if (activeFilter === "link")  return isUrl(c.content);
    if (activeFilter === "today") return c.createdAt >= start.getTime();
    return true;
  });
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

function cardHTML(c, q) {
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
  return '<div class="clip-card'+(isNote?" is-note":"")+'" data-content="'+esc(c.content)+'">'
    +'<div class="card-meta">'+fav+'<span class="domain">'+domain+'</span><span class="ts">'+relTime(c.createdAt)+'</span></div>'
    +'<div class="card-body'+(link?" is-link":"")+'">'+(maskedBody || hl(preview,q))+'</div>'
    +'<div class="card-foot"><span class="badge '+bc+'">'+bl+'</span>'
    +'<div class="card-actions">'+openBtn+copyBtn+delBtn+'</div></div></div>';
}

function render(clips, q) {
  if (!clips.length) { clipsList.innerHTML=""; emptyState.style.display="flex"; return; }
  emptyState.style.display="none";
  clipsList.innerHTML=clips.map(function(c){return cardHTML(c,q);}).join("");
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
      if(action==="open")   window.contexto.openExternal(content);
    });
  });
  clipsList.querySelectorAll(".clip-card").forEach(function(el){
    el.addEventListener("click",function(e){
      if(e.target.closest("[data-action]")) return;
      doCopy(el.dataset.content);
    });
  });
}

function doCopy(text,btn) {
  window.contexto.writeClipboard(text);
  showToast("Copied!","success");
  if(btn){var o=btn.innerHTML;btn.innerHTML="&#10003; Done";setTimeout(function(){btn.innerHTML=o;},1400);}
}

function doDelete(id) {
  deleteClip(id).then(function(){
    allClips=allClips.filter(function(c){return c.id!==id;});
    updateCount(); renderFiltered(); showToast("Deleted");
  }).catch(function(){showToast("Delete failed","error");});
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
    var updated = Object.assign({}, existing, { content: r.content, vector: embed(clean), key: key, sensitive: r.sensitive });
    return saveClip(updated);
  }).then(function () { showToast("Updated!", "success"); loadClips(); })
    .catch(function () { showToast("Update failed", "error"); });
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
