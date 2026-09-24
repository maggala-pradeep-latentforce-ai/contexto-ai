// Contexto AI - Side Panel Controller (AI-powered)

var MSG = {
  SEARCH_CLIPS:  "SEARCH_CLIPS",
  GET_ALL_CLIPS: "GET_ALL_CLIPS",
  DELETE_CLIP:   "DELETE_CLIP",
  CLEAR_ALL:     "CLEAR_ALL",
  CLIP_SAVED:    "CLIP_SAVED",
  ADD_NOTE:      "ADD_NOTE",
  EMBED_AND_SAVE:"EMBED_AND_SAVE",
  AI_QUERY:      "AI_QUERY",
  SAVE_CONFIG:   "SAVE_CONFIG",
  GET_CONFIG:    "GET_CONFIG",
};

var allClips = [], activeFilter = "all", searchQuery = "", searchTimer;
var searchInput, clearSearch, clipsList, emptyState, clipCount;
var clearBtn, settingsBtn, backBtn, saveSettingsBtn;
var noteInput, saveNoteBtn, composerHint, aiStatus, aiStatusText;
var apiKeyInput, proxyInput, modelSelect, toggleApiKey, settingsStatus;
var mainView, settingsView;
var themeBtn, themeIconMoon, themeIconSun;
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
  if (!hasApiKey) {
    composerHint.textContent = "Add your API key in Settings to enable AI";
    composerHint.className = "composer-hint hint-warn";
    return;
  }
  var text = noteInput ? noteInput.value.trim() : "";
  if (!text) { composerHint.textContent = ""; composerHint.className = "composer-hint"; return; }
  // Quick local pre-check for hint only
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
      } else if (result.action === "delete") {
        handleDeleteAction(result.matches);
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
    clipsList.innerHTML = '<div class="spinner"></div>';
    send({ type: MSG.SEARCH_CLIPS, data: { query: searchQuery } }).then(function (r) {
      render(applyFilter((r && r.results) ? r.results : []), searchQuery);
    }).catch(function () { render(applyFilter(allClips), ""); });
  } else { render(applyFilter(allClips), ""); }
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
      if(action==="open")   window.open(content,"_blank");
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
