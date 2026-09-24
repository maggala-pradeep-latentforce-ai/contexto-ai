// Contexto AI - Desktop LLM orchestrator (main process)
// Ported from src/background/index.js — same multi-provider client and the
// same "rank by relevance, not recency" retrieval fix. Kept in one place so
// the two apps don't silently drift apart; if you fix a bug in one, check
// the other file with the same name in ../../src/background/index.js.

const DEFAULT_PROXY = 'https://api.openai.com/v1/chat/completions';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const GEMINI_URL     = 'https://generativelanguage.googleapis.com/v1beta/models/';

function detectProvider(model, proxyUrl) {
  if (proxyUrl && proxyUrl !== DEFAULT_PROXY) return 'openai';
  if (/^claude/i.test(model)) return 'anthropic';
  if (/^gemini/i.test(model)) return 'google';
  return 'openai';
}

async function callLLM(messages, opts, config) {
  const apiKey   = config.apiKey;
  const proxyUrl = config.proxyUrl || DEFAULT_PROXY;
  const model    = config.model    || 'gpt-4o-mini';
  if (!apiKey) throw new Error('NO_API_KEY');

  const maxTokens   = (opts && opts.maxTokens)   || 512;
  const temperature = (opts && opts.temperature) != null ? opts.temperature : 0.2;
  const provider    = detectProvider(model, proxyUrl);

  if (provider === 'anthropic') return callAnthropic(messages, { model, apiKey, maxTokens, temperature });
  if (provider === 'google')    return callGemini(messages, { model, apiKey, maxTokens, temperature });

  const res = await fetch(proxyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => String(res.status));
    throw new Error('LLM_HTTP_' + res.status + ' [openai @ ' + proxyUrl + ', model=' + model + ']: ' + txt.slice(0, 200));
  }
  const json = await res.json();
  const text = json.choices?.[0]?.message?.content;
  if (!text) throw new Error('LLM_EMPTY_RESPONSE');
  return text.trim();
}

async function callAnthropic(messages, { model, apiKey, maxTokens, temperature }) {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const turns  = messages.filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));

  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, system: system || undefined, messages: turns, max_tokens: maxTokens, temperature }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => String(res.status));
    throw new Error('LLM_HTTP_' + res.status + ' [anthropic @ ' + ANTHROPIC_URL + ', model=' + model + ']: ' + txt.slice(0, 200));
  }
  const json = await res.json();
  const text = json.content?.[0]?.text;
  if (!text) throw new Error('LLM_EMPTY_RESPONSE');
  return text.trim();
}

async function callGemini(messages, { model, apiKey, maxTokens, temperature }) {
  const system   = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const contents = messages.filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));

  const url = GEMINI_URL + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(apiKey);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents,
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      generationConfig:  { maxOutputTokens: maxTokens, temperature },
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => String(res.status));
    throw new Error('LLM_HTTP_' + res.status + ' [google @ ' + GEMINI_URL + model + ':generateContent, model=' + model + ']: ' + txt.slice(0, 200));
  }
  const json = await res.json();
  const parts = json.candidates?.[0]?.content?.parts;
  const text = parts && parts.map((p) => p.text || '').join('');
  if (!text) throw new Error('LLM_EMPTY_RESPONSE');
  return text.trim();
}

// ── Local n-gram ranking (mirrors renderer/embed-engine.js) ──────────────────
function hashEmbed(text, dim) {
  dim = dim || 256;
  const vec = new Float32Array(dim);
  const words = text.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/ +/).filter(Boolean);
  for (const w of words) {
    for (let n = 1; n <= Math.min(w.length, 4); n++) {
      for (let i = 0; i <= w.length - n; i++) {
        let h = 2166136261;
        for (let c = 0; c < n; c++) { h ^= w.charCodeAt(i + c); h = Math.imul(h, 16777619) >>> 0; }
        vec[h % dim] += 1 / n;
      }
    }
  }
  let norm = 0;
  for (let i = 0; i < dim; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) + 1e-10;
  for (let i = 0; i < dim; i++) vec[i] /= norm;
  return vec;
}

function keyOverlap(query, key) {
  if (!key) return 0;
  const qWords = query.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2);
  if (!qWords.length) return 0;
  const hits = qWords.filter((w) => key.includes(w)).length;
  return hits / qWords.length;
}

// Distinct from keyOverlap() above (which measures how much of the QUERY's
// words are covered by the key, used for ranking/boosting scores). This
// checks the reverse — does the KEY's every word show up in the query — a
// much better "the user is directly asking about exactly this fact" signal.
// keyOverlap alone is too easily diluted by ordinary phrasing ("what is my
// wifi password" only gets ~0.67 overlap because "what"/"is"/"my" don't
// appear in the key "wifi password", even though this IS a direct ask).
function keyFullyContainedInQuery(query, key) {
  if (!key) return false;
  const qLower = query.toLowerCase();
  const keyWords = key.toLowerCase().split(/\s+/).filter(Boolean);
  return keyWords.length > 0 && keyWords.every((w) => qLower.includes(w));
}

function rankClips(query, clips) {
  if (!clips || !clips.length) return [];
  const qvec = hashEmbed(query);
  return clips
    .map((c) => {
      const cvec = c.vector ? c.vector : hashEmbed(c.content || '');
      let dot = 0, ma = 0, mb = 0;
      for (let i = 0; i < qvec.length; i++) { dot += qvec[i]*cvec[i]; ma += qvec[i]*qvec[i]; mb += cvec[i]*cvec[i]; }
      let score = dot / (Math.sqrt(ma) * Math.sqrt(mb) + 1e-10);
      const overlap = keyOverlap(query, c.key);
      if (overlap > 0) score = Math.max(score, 0.5 + overlap * 0.5);
      return { ...c, _score: score };
    })
    .sort((a, b) => b._score - a._score)
    .slice(0, 10);
}

// ── Date/time awareness — an LLM has no idea what "today" actually is (its
// training cutoff isn't now, and it has no clock), so anything date-relative
// ("what did I copy today", "what's today's date") has to be told explicitly,
// straight from the OS clock. ─────────────────────────────────────────────
function formatNow() {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return new Date().toLocaleString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  }) + ' (' + tz + ')';
}
function formatClipDate(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

// "today" / "yesterday" / "this week" is a DATE filter, not a text-similarity
// match — a note like "coffee 50" shares almost no words with a query like
// "what did I spend today", so relevance-scored retrieval alone would (and
// did) drop it below the threshold and miss it entirely, even though it's
// exactly what the user meant. Detect that case and pull by date instead.
function detectDateRange(query) {
  const q = query.toLowerCase();
  const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };
  const now = new Date();

  const daysAgo = q.match(/\b(\d+)\s+days?\s+(ago|back)\b/);
  if (daysAgo) {
    const d = new Date(now); d.setDate(d.getDate() - parseInt(daysAgo[1], 10));
    return { start: startOfDay(d), end: startOfDay(d) + 86400000 };
  }
  if (/\btoday\b/.test(q)) {
    return { start: startOfDay(now), end: startOfDay(now) + 86400000 };
  }
  if (/\byesterday\b/.test(q)) {
    const y = new Date(now); y.setDate(y.getDate() - 1);
    return { start: startOfDay(y), end: startOfDay(y) + 86400000 };
  }
  if (/\blast week\b/.test(q)) {
    const day = now.getDay();
    const thisMonday = new Date(now); thisMonday.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
    const lastMonday = new Date(thisMonday); lastMonday.setDate(thisMonday.getDate() - 7);
    return { start: startOfDay(lastMonday), end: startOfDay(thisMonday) };
  }
  if (/\bthis week\b/.test(q)) {
    const day = now.getDay(); // 0 = Sunday
    const monday = new Date(now); monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
    return { start: startOfDay(monday), end: startOfDay(now) + 86400000 };
  }
  if (/\blast month\b/.test(q)) {
    const firstThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const firstLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return { start: firstLastMonth.getTime(), end: firstThisMonth.getTime() };
  }
  if (/\bthis month\b/.test(q)) {
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    return { start: first.getTime(), end: startOfDay(now) + 86400000 };
  }
  return null;
}

// ── Orchestrator ──────────────────────────────────────────────────────────────
async function orchestrate(userInput, allClips, config) {
  const input = userInput.trim();

  const intentReply = await callLLM([
    {
      role: 'system',
      content:
        'You are an intent classifier for a personal clipboard+notes app. ' +
        'Reply with exactly one word: ' +
        '"save" if the user is storing/stating brand-new information, ' +
        '"edit" if the user wants to change/update/correct a previously saved note or clip to a new value, ' +
        '"delete" if the user wants to remove/delete/forget a previously saved note or clip, ' +
        'or "query" if the user is searching/asking about something. ' +
        'Examples: "delete my wifi password" -> delete. "forget the note about the server ip" -> delete. ' +
        '"change my wifi password to xyz789" -> edit. "update the server ip to 10.0.0.5" -> edit. ' +
        'No other words.',
    },
    { role: 'user', content: input },
  ], { maxTokens: 5, temperature: 0 }, config);

  const intentWord = intentReply.toLowerCase();
  const intent = intentWord.includes('delete') ? 'delete'
    : intentWord.includes('edit') ? 'edit'
    : intentWord.includes('save') ? 'save' : 'query';

  if (intent === 'save') {
    const fact = await callLLM([
      {
        role: 'system',
        content:
          'Extract the key fact the user wants to remember. ' +
          'Return ONLY the clean fact. Preserve all values exactly as given. ' +
          'Example: "my wifi password is abc123" -> "wifi password: abc123"',
      },
      { role: 'user', content: input },
    ], { maxTokens: 150, temperature: 0 }, config);

    return { action: 'save', content: fact || input, intent };
  }

  if (intent === 'delete') {
    const matches = rankClips(input, allClips)
      .filter((c) => c._score > 0.05)
      .slice(0, 3)
      .map((c) => ({ id: c.id, content: c.content, domain: c.domain, type: c.type, createdAt: c.createdAt, sensitive: c.sensitive }));
    return { action: 'delete', intent, matches };
  }

  if (intent === 'edit') {
    const matches = rankClips(input, allClips)
      .filter((c) => c._score > 0.05)
      .slice(0, 3)
      .map((c) => ({ id: c.id, content: c.content, domain: c.domain, type: c.type, createdAt: c.createdAt, sensitive: c.sensitive }));

    if (!matches.length) return { action: 'edit', intent, matches: [] };

    const newContent = await callLLM([
      {
        role: 'system',
        content:
          'The user wants to update a previously saved note or clip with a new value. ' +
          'Extract ONLY the corrected/updated text they want saved now, in the same ' +
          '"label: value" style if the original was structured that way. ' +
          'Return ONLY the new text, no commentary. ' +
          'Example: "change my wifi password to xyz789" -> "wifi password: xyz789"',
      },
      { role: 'user', content: input },
    ], { maxTokens: 150, temperature: 0 }, config);

    return { action: 'edit', intent, matches, newContent: newContent || input };
  }

  const dateRange = detectDateRange(input);
  let context;
  if (dateRange) {
    context = allClips
      .filter((c) => c.createdAt >= dateRange.start && c.createdAt < dateRange.end)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 25)
      .map((c) => ({ ...c, _score: 1 }));
  } else {
    const ranked = rankClips(input, allClips).filter((c) => c._score > 0.05);
    context = ranked.slice(0, 8);
  }

  // A sensitive item never has its real value in `content` here — the
  // renderer withholds it and sends a placeholder instead (see its
  // llmQuery payload). If the strongest match is a near-exact label match on
  // a sensitive item, answer directly from local storage instead of asking
  // the LLM at all — it never sees the real value either way, but this skips
  // sending it a masked placeholder question and lets the renderer just show
  // the real answer from its own already-decrypted copy.
  const topSensitive = context.find((c) => c.sensitive && keyFullyContainedInQuery(input, c.key));
  if (topSensitive) {
    return { action: 'answer_local', intent, matchId: topSensitive.id };
  }

  const contextBlock = context.length
    ? context.map((c, i) => '[' + (i+1) + '] (' + (c.domain || c.type || 'note') + ', saved ' + formatClipDate(c.createdAt) + '): ' + (c.content || '').slice(0, 300)).join('\n')
    : '(no relevant local data found)';

  const answer = await callLLM([
    {
      role: 'system',
      content:
        'You are a personal AI assistant for a privacy-first clipboard app. ' +
        'The current date and time is: ' + formatNow() + '. ' +
        'Each saved item below shows when it was saved — use that plus the current ' +
        'date/time above to answer anything date- or time-relative (e.g. "today", ' +
        '"this week", "how long ago"). ' +
        'Answer using ONLY the provided local context. ' +
        'If the question asks for a list or "all" of something, list every matching ' +
        'item, one per line — do not just pick one. Otherwise answer directly and concisely. ' +
        'If not found, say: "I could not find that in your saved notes. Try saving it first." ' +
        'Never fabricate information.',
    },
    { role: 'user', content: 'My saved context:\n' + contextBlock + '\n\nQuestion: ' + input },
  ], { maxTokens: 400, temperature: 0.1 }, config);

  return {
    action: 'answer',
    answer,
    intent,
    context: context.map((c) => ({
      id: c.id, content: c.content, domain: c.domain, type: c.type,
      createdAt: c.createdAt, favicon: c.favicon, score: c._score,
    })),
  };
}

module.exports = { orchestrate, callLLM, detectProvider };
