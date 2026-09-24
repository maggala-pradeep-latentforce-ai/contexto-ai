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
  const clean  = stripSensitive(data.content || "");
  const vector = embed(clean);
  const key    = extractKey(clean);
  const { content, sensitive } = await maybeEncrypt(clean, key);
  await saveClip({ ...data, content, vector, key, sensitive });
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
  const vector = embed(content);
  const key    = extractKey(content);
  const { content: stored, sensitive } = await maybeEncrypt(content, key);
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
  });
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
