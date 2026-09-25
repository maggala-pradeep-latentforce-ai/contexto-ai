// Contexto AI - Offscreen Document Controller
import { MSG, MAX_RESULTS } from "../shared/constants.js";
import { openDB, saveClip, getAllClips, deleteClip, clearAllClips, getClipCount } from "../shared/db.js";
import { stripSensitive, isSensitive, isSensitiveKey, encryptText, decryptText } from "../shared/security.js";
import { embed, cosineSim } from "./embed-engine.js";

// Initialise DB
openDB()
  .then(() => {
    chrome.runtime.sendMessage({ type: MSG.OFFSCREEN_READY }).catch(() => {});
  })
  .catch(console.error);

// ── Task due-time notifications ─────────────────────────────────────────────
// Runs here (not in background) because this is where the actual clip data
// lives. background/index.js periodically re-creates this document via a
// chrome.alarms wakeup in case Chrome tore it down for being idle, so this
// check keeps running even if the side panel is closed.
function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

// A recurring task with recurDays set only actually applies on those
// weekdays (0=Sunday..6=Saturday) — no recurDays (or empty) means every day,
// same as the original all-days-recurring behavior.
function taskAppliesToday(c) {
  if (!c.recurring) return true;
  if (!Array.isArray(c.recurDays) || !c.recurDays.length) return true;
  return c.recurDays.indexOf(new Date().getDay()) !== -1;
}

// Only tasks with an explicit dueTime get a push notification — a date-only
// deadline ("buy milk today") is already surfaced prominently in the side
// panel (sorted to the top, overdue badge), which is enough; there's no
// specific moment to alert about without a time. Recurring tasks reuse
// today's date so "read books at 10pm" fires every day at 10pm, checked
// against the device's actual clock (Date.now()) — not the LLM's idea of time.
function taskNotifyTimestamp(c) {
  if (!c.dueTime) return null;
  const datePart = c.recurring ? todayStr() : c.dueDate;
  if (!datePart) return null;
  return new Date(datePart + 'T' + c.dueTime + ':00').getTime();
}

async function checkDueNotifications() {
  const clips = await getAllClips();
  const now = Date.now();
  const today = todayStr();
  for (const c of clips) {
    if (c.type !== 'task') continue;
    if (!taskAppliesToday(c)) continue;
    const doneToday = c.recurring ? (c.recurringDone === today) : !!c.done;
    if (doneToday) continue;
    const notifyTs = taskNotifyTimestamp(c);
    if (notifyTs === null || notifyTs > now) continue;
    if (c.notifiedAt === today) continue; // already notified for this occurrence
    console.log('[Contexto] Firing notification for task:', c.content, 'due:', new Date(notifyTs));
    chrome.notifications.create('task-' + c.id + '-' + today, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('public/icons/icon128.png'),
      title: 'Task due',
      message: c.content,
    }, (notificationId) => {
      if (chrome.runtime.lastError) {
        console.error('[Contexto] Notification failed:', chrome.runtime.lastError.message);
      } else {
        console.log('[Contexto] Notification created:', notificationId);
      }
    });
    c.notifiedAt = today;
    await saveClip(c);
  }
}
setInterval(() => { checkDueNotifications().catch(console.error); }, 30000);

// ── Auto-archive stale items ─────────────────────────────────────────────────
// Clutter control: auto-captured clips nobody acted on eventually stop being
// useful, and a completed one-off task has done its job — both quietly move
// to "Archived" (filterable, reversible, never deleted outright) instead of
// piling up in the main feed forever. Runs on load and every 30 minutes,
// which is plenty for a background-tidiness job — no need for it to be
// instant.
const ARCHIVE_CLIP_MS = 21 * 24 * 60 * 60 * 1000; // 21 days
const ARCHIVE_TASK_DONE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days after completion
async function runAutoArchive() {
  const clips = await getAllClips();
  const now = Date.now();
  for (const c of clips) {
    if (c.archived) continue;
    let shouldArchive = false;
    if (c.type === 'text' && (now - c.createdAt) > ARCHIVE_CLIP_MS) shouldArchive = true;
    if (c.type === 'task' && !c.recurring && c.done && c.completedAt && (now - c.completedAt) > ARCHIVE_TASK_DONE_MS) shouldArchive = true;
    if (!shouldArchive) continue;
    c.archived = true;
    c.archivedAt = now;
    await saveClip(c);
  }
}
runAutoArchive().catch(console.error);
setInterval(() => { runAutoArchive().catch(console.error); }, 30 * 60 * 1000);

async function handleSetArchived(data) {
  const clips = await getAllClips();
  const clip = clips.find((c) => c.id === data.id);
  if (!clip) throw new Error('Item not found');
  clip.archived = !!data.archived;
  clip.archivedAt = clip.archived ? Date.now() : null;
  await saveClip(clip);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // Only handle messages explicitly relayed from the background SW
  if (!message._relay) return false;
  const { type, data } = message;

  if (type === MSG.EMBED_AND_SAVE) {
    handleEmbedAndSave(data)
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (type === MSG.SEARCH_CLIPS) {
    handleSearch(data.query)
      .then(sendResponse)
      .catch(() => sendResponse({ results: [] }));
    return true;
  }
  if (type === MSG.GET_ALL_CLIPS) {
    getAllClips()
      .then(decryptClipsForDisplay)
      .then((clips) => sendResponse({ clips }))
      .catch(() => sendResponse({ clips: [] }));
    return true;
  }
  if (type === MSG.DELETE_CLIP) {
    deleteClip(data.id)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (type === MSG.CLEAR_ALL) {
    clearAllClips()
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (type === MSG.ADD_NOTE) {
    handleAddNote(data)
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (type === MSG.ADD_TASK) {
    handleAddTask(data)
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (type === MSG.TOGGLE_TASK) {
    handleToggleTask(data)
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (type === MSG.RESCHEDULE_TASK) {
    handleRescheduleTask(data)
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (type === MSG.SET_ARCHIVED) {
    handleSetArchived(data)
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (type === MSG.EXPORT_DATA) {
    handleExportData()
      .then((items) => sendResponse({ ok: true, items }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (type === MSG.IMPORT_DATA) {
    handleImportData(data.items)
      .then((count) => sendResponse({ ok: true, count }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (type === MSG.QUERY_NOTES) {
    handleQueryNotes(data.query)
      .then(sendResponse)
      .catch(() => sendResponse({ answer: null, results: [] }));
    return true;
  }
  if (type === MSG.GET_COUNT) {
    getClipCount()
      .then((count) => sendResponse({ count }))
      .catch(() => sendResponse({ count: 0 }));
    return true;
  }
});

// Pulls a normalized "key" (fact label) out of "<label>: <value>" content,
// e.g. "wifi password: hunter2" -> "wifi password". Lets saved facts be
// looked up directly by label instead of relying purely on fuzzy similarity.
function extractKey(text) {
  // Require whitespace after the colon so "https://..." URLs (no space) don't
  // get misread as a "https" key — real facts are written "label: value".
  const m = /^([a-zA-Z0-9 _/-]{2,40}):\s+(\S.*)$/s.exec(String(text || "").trim());
  return m ? m[1].trim().toLowerCase() : null;
}

// ── Auto-categorization ──────────────────────────────────────────────────────
// Pure local keyword/domain heuristics — zero cost, zero latency, works
// identically with or without an LLM key configured, so every item gets
// organized from the first save regardless of setup. Domain checks run
// first (a URL is a much stronger signal than word-matching body text),
// then content keywords, in a fixed priority order so overlapping matches
// (e.g. "buy tickets" mentions both shopping and travel words) resolve
// predictably. Returns null when nothing matches confidently — those items
// just show no category badge and are outside the category filter's scope.
const CATEGORIES = {
  shopping: { label: 'Shopping', icon: '🛒' },
  travel:   { label: 'Travel',   icon: '✈️' },
  finance:  { label: 'Finance',  icon: '💰' },
  work:     { label: 'Work',     icon: '💼' },
  health:   { label: 'Health',   icon: '🩺' },
  learning: { label: 'Learning', icon: '📚' },
  personal: { label: 'Personal', icon: '🏠' },
};
const CATEGORY_DOMAIN_RULES = [
  [/amazon\.|ebay\.|etsy\.|walmart\.|target\.com|aliexpress|shopify|shop\./i, 'shopping'],
  [/booking\.com|airbnb|expedia|kayak\.com|delta\.com|united\.com|southwest\.com|airlines|makemytrip|skyscanner/i, 'travel'],
  [/paypal\.|chase\.com|bankofamerica|wellsfargo|stripe\.com|venmo|revolut|coinbase/i, 'finance'],
  [/github\.|gitlab\.|jira\.|atlassian|slack\.com|notion\.so|linkedin\.com|zoom\.us/i, 'work'],
];
const CATEGORY_KEYWORD_RULES = [
  [/\b(order|cart|checkout|price|discount|coupon|shipping|purchase|buy)\b/i, 'shopping'],
  [/\b(flight|hotel|booking|itinerary|passport|reservation|boarding|trip|vacation)\b/i, 'travel'],
  [/\b(invoice|payment|bank account|routing number|tax|salary|budget|expense|paid \$|\$\d)/i, 'finance'],
  [/\b(meeting|deadline|project|client|standup|sprint|colleague|manager|office|report due)\b/i, 'work'],
  [/\b(doctor|appointment|prescription|medicine|pharmacy|dentist|clinic|hospital|workout|gym)\b/i, 'health'],
  [/\b(course|tutorial|lecture|homework|assignment|read this article|study for)\b/i, 'learning'],
  [/\b(mom|dad|birthday|anniversary|call (him|her|them)|family dinner)\b/i, 'personal'],
];
function categorize(content, domain) {
  const text = String(content || '');
  const d = String(domain || '');
  for (const [re, cat] of CATEGORY_DOMAIN_RULES) if (re.test(d)) return cat;
  for (const [re, cat] of CATEGORY_KEYWORD_RULES) if (re.test(text)) return cat;
  return null;
}

// A sensitive note/clip is encrypted at rest and never sent to the LLM as
// plaintext — see background/index.js's "answer_local" path, which answers
// queries about these directly from local storage instead. The vector stays
// computed from the real plaintext since it never leaves the device (the
// sidepanel strips vectors before any AI_QUERY message goes to background).
async function maybeEncrypt(content, key) {
  if (!isSensitive(content) && !isSensitiveKey(key)) {
    return { content, sensitive: false };
  }
  return { content: await encryptText(content), sensitive: true };
}

async function handleEmbedAndSave(data) {
  const clean    = stripSensitive(data.content || "");
  const vector   = embed(clean);
  const key      = extractKey(clean);
  const category = categorize(clean, data.domain);
  const { content, sensitive } = await maybeEncrypt(clean, key);
  // Re-copying/re-saving something already stored (verbatim, non-sensitive)
  // just bumps the existing card to the top instead of piling up a fresh
  // duplicate — sensitive items are skipped since ciphertext can't be
  // string-compared without decrypting every candidate.
  if (!sensitive) {
    const clips = await getAllClips();
    const dup = clips.find((c) => !c.sensitive && c.type === data.type && c.content === clean && c.id !== data.id);
    if (dup) {
      dup.createdAt = data.createdAt || Date.now();
      dup.category = category;
      dup.archived = false;
      dup.archivedAt = null;
      await saveClip(dup);
      return;
    }
  }
  await saveClip({ ...data, content, vector, key, sensitive, category });
}

// See background/index.js's rankClips() for why: a structured "key" match
// (e.g. query "wifi password" vs key "wifi password") is a stronger, more
// reliable signal than fuzzy n-gram cosine similarity alone.
function keyOverlap(query, key) {
  if (!key) return 0;
  const qWords = query.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2);
  if (!qWords.length) return 0;
  const hits = qWords.filter((w) => key.includes(w)).length;
  return hits / qWords.length;
}

function scoreClip(qvec, query, c) {
  let score = c.vector ? cosineSim(qvec, c.vector) : 0;
  const overlap = keyOverlap(query, c.key);
  if (overlap > 0) score = Math.max(score, 0.5 + overlap * 0.5);
  return score;
}

// Sensitive clips are stored as an encrypted blob — decrypt back to
// plaintext before anything outside this file (sidepanel) sees them. The
// sidepanel is trusted (it's the user's own extension page) and needs real
// content to render/copy; it's the one responsible for masking the display
// and withholding the real value when it later talks to background/the LLM.
async function decryptClipsForDisplay(clips) {
  return Promise.all(clips.map(async (c) => {
    if (!c.sensitive) return c;
    try { return { ...c, content: await decryptText(c.content) }; }
    catch { return { ...c, content: '[could not decrypt]' }; }
  }));
}

async function handleSearch(query) {
  const clips = await decryptClipsForDisplay(await getAllClips());
  if (!query || query.trim().length === 0) return { results: clips.slice(0, MAX_RESULTS) };
  const q = query.trim();
  const qvec = embed(q);
  const scored = clips
    .map((c) => ({ ...c, _score: scoreClip(qvec, q, c) }))
    .sort((a, b) => b._score - a._score);
  return { results: scored.slice(0, MAX_RESULTS) };
}

async function handleAddNote(data) {
  // Notes are saved verbatim — user explicitly chose to store this content
  const content = (data.content || '').trim();
  if (!content) throw new Error('Empty note');
  const vector   = embed(content);
  const key      = extractKey(content);
  const category = categorize(content, null);
  const { content: stored, sensitive } = await maybeEncrypt(content, key);
  const clips = await getAllClips();
  const isEdit = !!data.id && clips.some((c) => c.id === data.id);
  if (!sensitive && !isEdit) {
    const dup = clips.find((c) => !c.sensitive && c.type === 'note' && c.content === content);
    if (dup) {
      dup.createdAt = data.createdAt || Date.now();
      dup.category = category;
      dup.archived = false;
      dup.archivedAt = null;
      await saveClip(dup);
      return;
    }
  }
  await saveClip({
    id:        data.id || crypto.randomUUID(),
    type:      'note',
    content:   stored,
    url:       '',
    title:     'Manual Note',
    favicon:   '',
    domain:    'note',
    createdAt: data.createdAt || Date.now(),
    vector,
    key,
    sensitive,
    category,
  });
}

async function handleAddTask(data) {
  const text = (data.text || '').trim();
  if (!text) throw new Error('Empty task');
  await saveClip({
    id:         data.id || crypto.randomUUID(),
    type:       'task',
    content:    text,
    url:        '',
    title:      'Task',
    favicon:    '',
    domain:     'task',
    createdAt:  data.createdAt || Date.now(),
    vector:     embed(text),
    key:        null,
    category:   categorize(text, null),
    dueDate:    data.dueDate || null,
    dueTime:    data.dueTime || null,
    recurring:  !!data.recurring,
    recurDays:  (Array.isArray(data.recurDays) && data.recurDays.length) ? data.recurDays : null,
    priority:   data.priority || null,
    done:       false,
    recurringDone: null,
    notifiedAt: null,
  });
}

// One-off tasks flip a permanent `done` flag. Recurring (daily) tasks
// instead track the last date they were completed — `recurringDone` holds a
// "YYYY-MM-DD" string, so the UI can tell "done today" apart from "done
// yesterday but not reset yet" without a separate cron/reset job.
async function handleToggleTask(data) {
  const clips = await getAllClips();
  const clip = clips.find((c) => c.id === data.id);
  if (!clip) throw new Error('Task not found');
  if (clip.recurring) {
    clip.recurringDone = clip.recurringDone === data.day ? null : data.day;
  } else {
    clip.done = !clip.done;
    clip.completedAt = clip.done ? Date.now() : null;
  }
  await saveClip(clip);
}

// Updates just the schedule fields, leaving content/vector/key untouched —
// this is what a natural-language "push this to tomorrow" edit resolves to.
// Clears notifiedAt so the new schedule can notify again.
async function handleRescheduleTask(data) {
  const clips = await getAllClips();
  const clip = clips.find((c) => c.id === data.id);
  if (!clip) throw new Error('Task not found');
  clip.dueDate = data.dueDate || null;
  clip.dueTime = data.dueTime || null;
  clip.recurring = !!data.recurring;
  clip.recurDays = (Array.isArray(data.recurDays) && data.recurDays.length) ? data.recurDays : null;
  clip.notifiedAt = null;
  await saveClip(clip);
}

// Plain-text backup — sensitive items are decrypted for export so the file
// is actually usable for a restore/migration; the settings UI warns the
// user about this before the download starts. vector/key are left out
// since both are cheaply recomputed from content on import.
async function handleExportData() {
  const clips = await decryptClipsForDisplay(await getAllClips());
  return clips.map((c) => ({
    id: c.id, type: c.type, content: c.content, url: c.url || '', title: c.title || '',
    favicon: c.favicon || '', domain: c.domain || '', createdAt: c.createdAt,
    dueDate: c.dueDate || null, dueTime: c.dueTime || null, recurring: !!c.recurring, recurDays: c.recurDays || null,
    priority: c.priority || null, done: !!c.done, recurringDone: c.recurringDone || null, category: c.category || null,
    completedAt: c.completedAt || null, archived: !!c.archived, archivedAt: c.archivedAt || null,
  }));
}

// Reuses the same save paths a normal add would use (so encryption, vector
// and key all get recomputed fresh from the imported plaintext rather than
// trusted from the file) — the only difference is the id is preserved when
// present, so re-importing the same backup upserts instead of duplicating.
async function handleImportData(items) {
  let count = 0;
  for (const item of items || []) {
    if (!item || typeof item.content !== 'string' || !item.content.trim()) continue;
    try {
      if (item.type === 'task') {
        await handleAddTask({
          id: item.id, text: item.content, createdAt: item.createdAt,
          dueDate: item.dueDate, dueTime: item.dueTime, recurring: item.recurring, recurDays: item.recurDays, priority: item.priority,
        });
        if (item.done || item.recurringDone || item.archived) {
          const clips = await getAllClips();
          const saved = clips.find((c) => c.id === item.id);
          if (saved) {
            saved.done = !!item.done;
            saved.recurringDone = item.recurringDone || null;
            saved.completedAt = item.completedAt || null;
            saved.archived = !!item.archived;
            saved.archivedAt = item.archivedAt || null;
            await saveClip(saved);
          }
        }
      } else if (item.type === 'note') {
        await handleAddNote({ id: item.id, content: item.content, createdAt: item.createdAt });
      } else {
        await handleEmbedAndSave({
          id: item.id, type: item.type, content: item.content, url: item.url, title: item.title,
          favicon: item.favicon, domain: item.domain, createdAt: item.createdAt,
        });
        if (item.archived) {
          const clips = await getAllClips();
          const saved = clips.find((c) => c.id === item.id);
          if (saved) { saved.archived = true; saved.archivedAt = item.archivedAt || Date.now(); await saveClip(saved); }
        }
      }
      count++;
    } catch (_) { /* skip malformed entries, keep importing the rest */ }
  }
  return count;
}

async function handleQueryNotes(query) {
  if (!query || !query.trim()) return { answer: null, results: [] };
  const clips = await decryptClipsForDisplay(await getAllClips());
  if (!clips.length) return { answer: null, results: [] };

  const q = query.trim();
  const qvec = embed(q);
  const scored = clips
    .map((c) => ({ ...c, _score: scoreClip(qvec, q, c) }))
    .sort((a, b) => b._score - a._score)
    .slice(0, 10);

  // Best match as the answer if score is meaningful
  const best = scored[0];
  const answer = (best && best._score > 0.3) ? best.content : null;

  return { answer, results: scored };
}
