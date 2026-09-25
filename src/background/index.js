// Contexto AI - Background Service Worker (MV3)
// Operator-controlled: API key lives in chrome.storage.local, set via settings panel.
// Routes: content script -> offscreen (embed+save), sidepanel -> offscreen (DB ops),
//         sidepanel -> AI_QUERY (fetch LLM via this SW, since fetch is allowed here).

const MSG = {
  NEW_CLIP:        'NEW_CLIP',
  EMBED_AND_SAVE:  'EMBED_AND_SAVE',
  SEARCH_CLIPS:    'SEARCH_CLIPS',
  GET_ALL_CLIPS:   'GET_ALL_CLIPS',
  DELETE_CLIP:     'DELETE_CLIP',
  CLEAR_ALL:       'CLEAR_ALL',
  GET_COUNT:       'GET_COUNT',
  CLIP_SAVED:      'CLIP_SAVED',
  OFFSCREEN_READY: 'OFFSCREEN_READY',
  OPEN_SIDE_PANEL: 'OPEN_SIDE_PANEL',
  ADD_NOTE:        'ADD_NOTE',
  ADD_TASK:        'ADD_TASK',
  TOGGLE_TASK:     'TOGGLE_TASK',
  RESCHEDULE_TASK: 'RESCHEDULE_TASK',
  SET_ARCHIVED:    'SET_ARCHIVED',
  EXPORT_DATA:     'EXPORT_DATA',
  IMPORT_DATA:     'IMPORT_DATA',
  QUERY_NOTES:     'QUERY_NOTES',
  AI_QUERY:        'AI_QUERY',
  SAVE_CONFIG:     'SAVE_CONFIG',
  GET_CONFIG:      'GET_CONFIG',
};

// Messages relayed to offscreen doc (IndexedDB lives there)
const OFFSCREEN_MSGS = new Set([
  MSG.EMBED_AND_SAVE,
  MSG.SEARCH_CLIPS,
  MSG.GET_ALL_CLIPS,
  MSG.DELETE_CLIP,
  MSG.CLEAR_ALL,
  MSG.GET_COUNT,
  MSG.ADD_NOTE,
  MSG.ADD_TASK,
  MSG.TOGGLE_TASK,
  MSG.RESCHEDULE_TASK,
  MSG.SET_ARCHIVED,
  MSG.EXPORT_DATA,
  MSG.IMPORT_DATA,
  MSG.QUERY_NOTES,
]);

const DEFAULT_PROXY = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_MODEL = 'gpt-4o-mini';

let offscreenCreating = false;

// ── Offscreen lifecycle ───────────────────────────────────────────────────────
async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  if (offscreenCreating) {
    await new Promise((r) => setTimeout(r, 300));
    return ensureOffscreen();
  }
  offscreenCreating = true;
  try {
    await chrome.offscreen.createDocument({
      url: 'src/offscreen/index.html',
      reasons: ['WORKERS'],
      justification: 'Local embedding pipeline + IndexedDB operations',
    });
  } finally {
    offscreenCreating = false;
  }
}

// ── Config helpers ────────────────────────────────────────────────────────────
function loadConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['ctx_api_key', 'ctx_proxy_url', 'ctx_model'], (r) => {
      resolve({
        apiKey:   r.ctx_api_key   || '',
        proxyUrl: r.ctx_proxy_url || DEFAULT_PROXY,
        model:    r.ctx_model     || DEFAULT_MODEL,
      });
    });
  });
}

function saveConfig(cfg) {
  return new Promise((resolve) => {
    chrome.storage.local.set({
      ctx_api_key:   cfg.apiKey   || '',
      ctx_proxy_url: cfg.proxyUrl || DEFAULT_PROXY,
      ctx_model:     cfg.model    || DEFAULT_MODEL,
    }, resolve);
  });
}

// ── Multi-provider LLM call (lives in SW — fetch is reliable here) ───────────
// Provider is inferred from the model id so the settings UI stays a single
// field — no separate "provider" dropdown to keep in sync. EXCEPT: if the
// operator has pointed Proxy URL at something other than the OpenAI default,
// that's an explicit choice to route everything through their own gateway
// (e.g. LatentStack, OpenRouter — any OpenAI-compatible proxy that can front
// arbitrary underlying models), so it always wins over guessing from the
// model name — a model id like "bedrock/claude-sonnet-4-6" must still go to
// the custom proxy, not straight to Anthropic's API.
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const GEMINI_URL     = 'https://generativelanguage.googleapis.com/v1beta/models/';

function detectProvider(model, proxyUrl) {
  if (proxyUrl && proxyUrl !== DEFAULT_PROXY) return 'openai';
  if (/^claude/i.test(model)) return 'anthropic';
  if (/^gemini/i.test(model)) return 'google';
  return 'openai';
}

async function callLLM(messages, opts) {
  const { apiKey, proxyUrl, model } = await loadConfig();
  if (!apiKey) throw new Error('NO_API_KEY');

  const maxTokens   = (opts && opts.maxTokens)   || 512;
  const temperature = (opts && opts.temperature) != null ? opts.temperature : 0.2;
  const provider    = detectProvider(model, proxyUrl);

  if (provider === 'anthropic') return callAnthropic(messages, { model, apiKey, maxTokens, temperature });
  if (provider === 'google')    return callGemini(messages, { model, apiKey, maxTokens, temperature });

  // OpenAI-compatible (default) — respects the operator-configured proxy URL
  const res = await fetch(proxyUrl, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': 'Bearer ' + apiKey,
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens:  maxTokens,
      temperature,
    }),
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
  const turns  = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));

  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      system: system || undefined,
      messages: turns,
      max_tokens: maxTokens,
      temperature,
    }),
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
  const contents = messages
    .filter((m) => m.role !== 'system')
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

// ── Local n-gram ranking (mirrors embed-engine logic) ────────────────────────
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

// How much of the query's meaningful words appear in a clip's structured
// "key" label (e.g. query "what is my wifi password" vs key "wifi password").
// A strong label match is a much more reliable signal than fuzzy n-gram
// similarity, so it's used to guarantee exact-fact lookups surface reliably.
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
      for (let i = 0; i < qvec.length; i++) { dot+=qvec[i]*cvec[i]; ma+=qvec[i]*qvec[i]; mb+=cvec[i]*cvec[i]; }
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

  // "2 days ago/back" — most specific, check first.
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
async function orchestrate(userInput, allClips) {
  const input = userInput.trim();

  // 1. Classify intent
  const intentReply = await callLLM([
    {
      role: 'system',
      content:
        'You are an intent classifier for a personal clipboard+notes+tasks app. ' +
        'Reply with exactly one word: ' +
        '"task" if the user wants to add a to-do / reminder / action item — something ' +
        'to DO (by a deadline, or repeating daily), not information to remember, ' +
        '"save" if the user is storing/stating brand-new information to remember later, ' +
        '"edit" if the user wants to change/update/correct a previously saved note or clip to a new value, ' +
        '"delete" if the user wants to remove/delete/forget a previously saved note or clip, ' +
        'or "query" if the user is searching/asking about something. ' +
        'Examples: "remind me to call mom tomorrow" -> task. "todo: submit report by friday" -> task. ' +
        '"every morning I should stretch" -> task. "I need to buy milk" -> task. ' +
        '"my wifi password is hunter2" -> save (a fact, not an action). ' +
        '"delete my wifi password" -> delete. "forget the note about the server ip" -> delete. ' +
        '"change my wifi password to xyz789" -> edit. "update the server ip to 10.0.0.5" -> edit. ' +
        'No other words.',
    },
    { role: 'user', content: input },
  ], { maxTokens: 5, temperature: 0 });

  const intentWord = intentReply.toLowerCase();
  const intent = intentWord.includes('task') ? 'task'
    : intentWord.includes('delete') ? 'delete'
    : intentWord.includes('edit') ? 'edit'
    : intentWord.includes('save') ? 'save' : 'query';

  if (intent === 'task') {
    // Resolve relative dates/times ("tomorrow", "10pm") against the real
    // current date — the LLM has no clock of its own, see formatNow(). One
    // message can describe several tasks (a numbered list, "and", etc.), so
    // this always extracts a LIST, even for a single task.
    const raw = await callLLM([
      {
        role: 'system',
        content:
          'Extract ALL to-do tasks from the user\'s message — there may be more than one ' +
          '(e.g. a numbered or bulleted list, or several sentences). Today is: ' + formatNow() + '. ' +
          'Reply with ONLY a JSON object, no commentary, no markdown fences: ' +
          '{"tasks": [{"text": "<clean task description, no dates/times in it>", ' +
          '"dueDate": "<YYYY-MM-DD, or null if no specific deadline>", ' +
          '"dueTime": "<HH:MM in 24-hour time, or null if no specific time>", ' +
          '"recurring": <true only if THIS task repeats — judge each task independently, ' +
          'a "daily tasks" heading does not automatically make every item recurring if one sounds one-time>, ' +
          '"recurDays": <if recurring and the message names specific days (e.g. "every Monday and Wednesday", ' +
          '"on weekdays", "Tue and Thu"), an array of weekday numbers 0=Sunday..6=Saturday it repeats on; ' +
          'if recurring but no specific days are named (e.g. "every day", "daily"), use null to mean every day; ' +
          'if not recurring, use null>, ' +
          '"priority": "<high, medium, or null — high only for words like urgent/asap/important/critical, ' +
          'medium only if mildly emphasized, null for ordinary tasks — most tasks should be null>}]}. ' +
          'Resolve relative dates ("tomorrow", "next friday") and times ("10pm", "at 9") into real values using today\'s date/time above. ' +
          'Example: "remind me to call mom tomorrow at 3pm" -> ' +
          '{"tasks":[{"text":"call mom","dueDate":"<tomorrow\'s date>","dueTime":"15:00","recurring":false,"recurDays":null,"priority":null}]}. ' +
          'Example: "urgent: submit the report today, also every morning I should stretch, and gym every Monday and Thursday" -> ' +
          '{"tasks":[{"text":"submit the report","dueDate":"<today\'s date>","dueTime":null,"recurring":false,"recurDays":null,"priority":"high"},' +
          '{"text":"stretch","dueDate":null,"dueTime":null,"recurring":true,"recurDays":null,"priority":null},' +
          '{"text":"gym","dueDate":null,"dueTime":null,"recurring":true,"recurDays":[1,4],"priority":null}]}.',
      },
      { role: 'user', content: input },
    ], { maxTokens: 400, temperature: 0 });

    let tasks = null;
    try {
      const m = raw.match(/\{[\s\S]*\}/);
      const parsed = m ? JSON.parse(m[0]) : null;
      if (parsed && Array.isArray(parsed.tasks) && parsed.tasks.length) tasks = parsed.tasks;
    } catch { tasks = null; }

    if (!tasks) tasks = [{ text: input, dueDate: null, dueTime: null, recurring: false, recurDays: null, priority: null }];

    return {
      action: 'task',
      intent,
      tasks: tasks.map((t) => ({
        text: (t && t.text) || input,
        dueDate: (t && t.dueDate) || null,
        dueTime: (t && t.dueTime) || null,
        recurring: !!(t && t.recurring),
        recurDays: (t && Array.isArray(t.recurDays) && t.recurDays.length) ? t.recurDays.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6) : null,
        priority: (t && (t.priority === 'high' || t.priority === 'medium')) ? t.priority : null,
      })),
    };
  }

  if (intent === 'save') {
    // 2a. Extract clean fact
    const fact = await callLLM([
      {
        role: 'system',
        content:
          'Extract the key fact the user wants to remember. ' +
          'Return ONLY the clean fact. Preserve all values exactly as given. ' +
          'Example: "my wifi password is abc123" -> "wifi password: abc123"',
      },
      { role: 'user', content: input },
    ], { maxTokens: 150, temperature: 0 });

    return { action: 'save', content: fact || input, intent };
  }

  if (intent === 'delete') {
    // Find the best-matching saved item(s) — never delete outright, the UI
    // asks for confirmation before actually removing anything.
    const matches = rankClips(input, allClips)
      .filter((c) => c._score > 0.05)
      .slice(0, 3)
      .map((c) => ({ id: c.id, content: c.content, domain: c.domain, type: c.type, createdAt: c.createdAt, sensitive: c.sensitive }));
    return { action: 'delete', intent, matches };
  }

  if (intent === 'edit') {
    // Same idea as delete — find the best match, work out what it should
    // become, but never overwrite outright; the UI confirms old vs new first.
    const matches = rankClips(input, allClips)
      .filter((c) => c._score > 0.05)
      .slice(0, 3)
      .map((c) => ({
        id: c.id, content: c.content, domain: c.domain, type: c.type, createdAt: c.createdAt, sensitive: c.sensitive,
        dueDate: c.dueDate, dueTime: c.dueTime, recurring: c.recurring, recurDays: c.recurDays,
      }));

    if (!matches.length) return { action: 'edit', intent, matches: [] };

    const top = matches[0];

    // Editing a TASK means rescheduling it ("push this to tomorrow", "make
    // it stop repeating") — a structured {dueDate,dueTime,recurring} change,
    // not a text rewrite. Give the model the task's CURRENT schedule so it
    // can carry over whatever the user didn't mention (e.g. "push to
    // tomorrow" should keep the existing time), same date-resolution
    // approach as task creation — resolved against the real current date.
    if (top.type === 'task') {
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const currentDays = Array.isArray(top.recurDays) && top.recurDays.length
        ? top.recurDays.map((d) => dayNames[d]).join(', ')
        : (top.recurring ? 'every day' : 'n/a');
      const raw = await callLLM([
        {
          role: 'system',
          content:
            'The user wants to reschedule an existing task. Today is: ' + formatNow() + '. ' +
            'The task currently has: dueDate=' + (top.dueDate || 'none') + ', dueTime=' + (top.dueTime || 'none') +
            ', recurring=' + top.recurring + ', repeats on: ' + currentDays + '. ' +
            'Reply with ONLY a JSON object, no commentary: ' +
            '{"dueDate": "<YYYY-MM-DD, or null for no deadline>", "dueTime": "<HH:MM 24-hour, or null>", ' +
            '"recurring": <true|false>, "recurDays": <array of weekday numbers 0=Sunday..6=Saturday if the user ' +
            'names specific days, null if it should repeat every day or is not recurring>}. ' +
            'Keep any field the user does not mention unchanged from the current values above — ' +
            'this is a partial edit, not a full replacement. Only include recurDays if the user is actually ' +
            'changing which days it repeats on. ' +
            'Example: current dueTime=22:00. User says "push this to tomorrow" -> dueDate becomes tomorrow\'s date, dueTime stays 22:00. ' +
            'Example: user says "only do this on Mondays and Fridays now" -> recurring becomes true, recurDays becomes [1,5].',
        },
        { role: 'user', content: input },
      ], { maxTokens: 150, temperature: 0 });

      let sched = null;
      try { const m = raw.match(/\{[\s\S]*\}/); sched = m ? JSON.parse(m[0]) : null; } catch { sched = null; }

      return {
        action: 'reschedule',
        intent,
        matches,
        dueDate: sched && 'dueDate' in sched ? sched.dueDate : top.dueDate,
        dueTime: sched && 'dueTime' in sched ? sched.dueTime : top.dueTime,
        recurring: sched ? !!sched.recurring : top.recurring,
        recurDays: sched && 'recurDays' in sched
          ? ((Array.isArray(sched.recurDays) && sched.recurDays.length) ? sched.recurDays.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6) : null)
          : top.recurDays,
      };
    }

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
    ], { maxTokens: 150, temperature: 0 });

    return { action: 'edit', intent, matches, newContent: newContent || input };
  }

  // 2b. Retrieve relevant local context. A date phrase ("today", "this week")
  // means pull EVERYTHING from that range regardless of text similarity —
  // otherwise fall back to semantic ranking (cosine similarity over n-gram
  // hash embeddings), NOT just the most recent items, since relevance to the
  // query is what actually makes this "intelligent" retrieval.
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
  // sidepanel withholds it and sends a placeholder instead (see its
  // AI_QUERY payload). If the strongest match is a near-exact label match on
  // a sensitive item, answer directly from local storage instead of asking
  // the LLM at all — it never sees the real value either way, but this skips
  // sending it a masked placeholder question and lets the sidepanel just
  // show the real answer from its own already-decrypted copy.
  const topSensitive = context.find((c) => c.sensitive && keyFullyContainedInQuery(input, c.key));
  if (topSensitive) {
    return { action: 'answer_local', intent, matchId: topSensitive.id };
  }

  const contextBlock = context.length
    ? context
        .map((c, i) => '[' + (i+1) + '] (' + (c.domain || c.type || 'note') + ', saved ' + formatClipDate(c.createdAt) + '): ' + (c.content || '').slice(0, 300))
        .join('\n')
    : '(no relevant local data found)';

  // 3. Answer using context
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
    {
      role: 'user',
      content: 'My saved context:\n' + contextBlock + '\n\nQuestion: ' + input,
    },
  ], { maxTokens: 400, temperature: 0.1 });

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

// ── Side panel ────────────────────────────────────────────────────────────────
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

// ── Keep task due-time notifications running ──────────────────────────────────
// The actual check lives in offscreen/index.js (that's where the clip data
// is). Chrome can tear the offscreen document down when idle, and this
// service worker itself can go dormant too — chrome.alarms wakes this SW
// back up on a schedule even after that, and ensureOffscreen() recreates the
// document if it's gone, so the notification check keeps running even with
// the side panel closed.
chrome.alarms.create('task-notify-tick', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'task-notify-tick') ensureOffscreen().catch(() => {});
});

// ── Message routing ───────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const { type } = message;

  // ── Config ops (handled directly in SW) ──
  if (type === MSG.SAVE_CONFIG) {
    saveConfig(message.data || {}).then(() => sendResponse({ ok: true })).catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (type === MSG.GET_CONFIG) {
    loadConfig().then((cfg) => sendResponse({ ok: true, config: cfg })).catch(() => sendResponse({ ok: false, config: {} }));
    return true;
  }

  // ── AI query (orchestrated in SW — fetch works reliably here) ──
  if (type === MSG.AI_QUERY) {
    const { input, clips } = message.data || {};
    orchestrate(input || '', clips || [])
      .then((result) => sendResponse({ ok: true, result }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  // ── Clipboard capture from content script ──
  if (type === MSG.NEW_CLIP) {
    handleNewClip(message.data);
    return false;
  }

  // ── Open side panel ──
  if (type === MSG.OPEN_SIDE_PANEL) {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (tab) chrome.sidePanel.open({ windowId: tab.windowId });
    });
    return false;
  }

  // ── Relay to offscreen doc ──
  if (OFFSCREEN_MSGS.has(type)) {
    ensureOffscreen().then(() => {
      chrome.runtime.sendMessage(
        Object.assign({}, message, { _relay: true }),
        (response) => {
          if (chrome.runtime.lastError) {
            ensureOffscreen().then(() => {
              chrome.runtime.sendMessage(
                Object.assign({}, message, { _relay: true }),
                (r2) => sendResponse(r2 || { ok: false, error: 'Offscreen unavailable' })
              );
            }).catch(() => sendResponse({ ok: false, error: 'Offscreen unavailable' }));
            return;
          }
          sendResponse(response);
        }
      );
    }).catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});

// ── New clip handler ──────────────────────────────────────────────────────────
async function handleNewClip(data) {
  try {
    await ensureOffscreen();
    chrome.runtime.sendMessage({ type: MSG.EMBED_AND_SAVE, data, _relay: true }, () => {
      chrome.runtime.sendMessage({ type: MSG.CLIP_SAVED }).catch(() => {});
    });
  } catch (err) {
    console.error('[Contexto] handleNewClip:', err);
  }
}
