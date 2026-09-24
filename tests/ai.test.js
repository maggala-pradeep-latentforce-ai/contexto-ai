// Integration tests — AI layer, orchestrator, settings, message routing
const fs   = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log('  PASS:', msg); passed++; }
  else       { console.error('  FAIL:', msg); failed++; }
}
const read = (rel) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

// ── 1. Background: full AI orchestrator ──────────────────────────────────────
console.log('\n[Background orchestrator]');
const bg = read('src/background/index.js');
assert(bg.includes('AI_QUERY'),            'handles AI_QUERY message');
assert(bg.includes('SAVE_CONFIG'),         'handles SAVE_CONFIG');
assert(bg.includes('GET_CONFIG'),          'handles GET_CONFIG');
assert(bg.includes('orchestrate'),         'defines orchestrate()');
assert(bg.includes('callLLM'),             'defines callLLM()');
assert(bg.includes('loadConfig'),          'defines loadConfig()');
assert(bg.includes('saveConfig'),          'defines saveConfig()');
assert(bg.includes('ctx_api_key'),         'uses ctx_api_key storage key');
assert(bg.includes('QUERY_NOTES') || bg.includes('OFFSCREEN_MSGS'), 'routes offscreen msgs');
assert(!bg.includes('cdn.jsdelivr'),       'no CDN references');

// ── 2. Background: LLM fetch is in SW (not offscreen) ────────────────────────
console.log('\n[LLM fetch location]');
assert(bg.includes("fetch(proxyUrl"),       'fetch() called in background SW');
assert(bg.includes('Authorization'),        'sets Authorization header');
assert(bg.includes('Bearer'),              'uses Bearer token auth');
assert(bg.includes('NO_API_KEY'),          'guards against missing API key');

// ── 3. Constants: all message types present ───────────────────────────────────
console.log('\n[Message constants]');
const constants = read('src/shared/constants.js');
['AI_QUERY','SAVE_CONFIG','GET_CONFIG','ADD_NOTE','QUERY_NOTES',
 'NEW_CLIP','SEARCH_CLIPS','GET_ALL_CLIPS','DELETE_CLIP','CLEAR_ALL'
].forEach(function(t) {
  assert(constants.includes(t), 'constants has ' + t);
});

// ── 4. Manifest: host_permissions for proxy ───────────────────────────────────
console.log('\n[Manifest host_permissions]');
const manifest = JSON.parse(read('manifest.json'));
assert(Array.isArray(manifest.host_permissions),       'host_permissions is array');
assert(manifest.host_permissions.length > 0,           'host_permissions is not empty');
assert(manifest.host_permissions.some(function(h){ return h.includes('openai'); }),
       'includes openai.com');

// ── 5. Side panel: settings panel present ────────────────────────────────────
console.log('\n[Settings panel]');
const html = read('src/sidepanel/index.html');
assert(html.includes('settingsView'),       'has settings view div');
assert(html.includes('settingsBtn'),        'has settings button');
assert(html.includes('backBtn'),            'has back button');
assert(html.includes('apiKeyInput'),        'has API key input');
assert(html.includes('proxyInput'),         'has proxy URL input');
assert(html.includes('modelSelect'),        'has model selector');
assert(html.includes('saveSettingsBtn'),    'has save settings button');
assert(html.includes('aiStatus'),           'has AI status bar');

// ── 6. Side panel JS: AI flow ────────────────────────────────────────────────
console.log('\n[Side panel AI flow]');
const js = read('src/sidepanel/index.js');
assert(js.includes('AI_QUERY'),            'sends AI_QUERY');
assert(js.includes('SAVE_CONFIG'),         'sends SAVE_CONFIG');
assert(js.includes('GET_CONFIG'),          'loads config on init');
assert(js.includes('showAiStatus'),        'shows AI loading state');
assert(js.includes('hideAiStatus'),        'hides AI loading state');
assert(js.includes('renderAiAnswer'),      'renders AI answer card');
assert(js.includes('hasApiKey'),           'gates submit on API key');
assert(js.includes('showSettings'),        'can navigate to settings');

// ── 7. CSS: all new UI elements styled ───────────────────────────────────────
console.log('\n[CSS completeness]');
const css = read('src/sidepanel/index.css');
assert(css.includes('.send-btn'),          'send button styled');
assert(css.includes('.ai-status'),         'AI status bar styled');
assert(css.includes('.ai-dot'),            'AI pulse dot styled');
assert(css.includes('.settings-body'),     'settings body styled');
assert(css.includes('.answer-card'),       'answer card styled');
assert(css.includes('.answer-body'),       'answer body styled');
assert(css.includes('.hint-warn'),         'hint-warn color defined');
assert(css.includes('.save-settings-btn'), 'save settings button styled');

// ── 8. Intent classifier still works ─────────────────────────────────────────
console.log('\n[Intent classifier]');
const { classifyIntent } = require(path.resolve(__dirname, '../src/shared/intent.js'));
var queries = [
  ['what is my api key?',     'query'],
  ['find my password',        'query'],
  ['my key is abc123',        'save'],
  ['remember: pin is 1234',   'save'],
];
queries.forEach(function(t) {
  var r = classifyIntent(t[0]);
  assert(r.intent === t[1], 'intent("'+t[0]+'") = '+t[1]+' (got '+r.intent+')');
});

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n═══════════════════════════════════════════');
console.log('Results:', passed, 'passed,', failed, 'failed');
if (failed > 0) process.exit(1);
