// Regression tests — Contexto AI extension
const fs   = require('fs');
const path = require('path');

let passed = 0, failed = 0;

function assert(cond, msg) {
  if (cond) { console.log('  PASS:', msg); passed++; }
  else       { console.error('  FAIL:', msg); failed++; }
}

const read = (rel) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

// ── 1. CSP: no CDN dynamic import ────────────────────────────────────────────
console.log('\n[CSP - no CDN import]');
const embedder = read('src/offscreen/embed-engine.js');
assert(!embedder.includes('cdn.jsdelivr.net'),            'no jsdelivr CDN URL');
assert(!embedder.includes('https://'),                    'no https:// URL at all');
assert(!/await\s+import\s*\(/.test(embedder),             'no dynamic await import()');
assert(!embedder.includes('export async function embed'), 'embed() is synchronous');
assert(embedder.includes('export function embed'),        'embed() is exported');

// ── 2. tryLoadNeuralModel is a no-op ─────────────────────────────────────────
console.log('\n[tryLoadNeuralModel stub]');
assert(embedder.includes('export function tryLoadNeuralModel'), 'stub exported');
assert(!embedder.includes('neuralPipeline'),                   'no neuralPipeline var');
assert(!embedder.includes('neuralLoading'),                    'no neuralLoading var');

// ── 3. offscreen: _relay guard + no tryLoadNeuralModel call ──────────────────
console.log('\n[offscreen relay guard]');
const offscreen = read('src/offscreen/index.js');
assert(offscreen.includes('_relay'),            'offscreen has _relay guard');
assert(!offscreen.includes('tryLoadNeuralModel'), 'offscreen does not call tryLoadNeuralModel');
assert(offscreen.includes('handleAddNote'),       'offscreen defines handleAddNote');
assert(offscreen.includes('ADD_NOTE'),            'offscreen handles ADD_NOTE');

// ── 4. background: ADD_NOTE in MSG + OFFSCREEN_MSGS + relay pattern ───────────
console.log('\n[background routing]');
const bg = read('src/background/index.js');
assert(bg.includes("ADD_NOTE") && bg.includes("'ADD_NOTE'"), 'background MSG has ADD_NOTE');
assert(bg.includes('OFFSCREEN_MSGS'),          'background uses OFFSCREEN_MSGS set');
assert(bg.includes('MSG.ADD_NOTE'),            'background routes ADD_NOTE');
assert(bg.includes('_relay: true'),            'background sets _relay flag on relay');

// ── 5. constants: ADD_NOTE defined ───────────────────────────────────────────
console.log('\n[constants]');
const constants = read('src/shared/constants.js');
assert(constants.includes('ADD_NOTE'), 'constants.js has ADD_NOTE');

// ── 6. sidepanel: note composer + Notes filter ───────────────────────────────
console.log('\n[sidepanel note feature]');
const html = read('src/sidepanel/index.html');
const js   = read('src/sidepanel/index.js');
assert(html.includes('noteInput'),            'HTML has noteInput');
assert(html.includes('saveNoteBtn'),          'HTML has saveNoteBtn');
assert(html.includes('data-filter="note"'),  'HTML has Notes filter pill');
assert(js.includes('ADD_NOTE'),              'JS sends ADD_NOTE');
assert(js.includes('handleSubmit') || js.includes('ADD_NOTE'), 'JS handles note saving');
assert(js.includes('badge-note'),            'JS renders note badge');
assert(!js.includes('_relay'),               'sidepanel does not set _relay (SW does it)');

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n─────────────────────────────────────────');
console.log('Results:', passed, 'passed,', failed, 'failed');
if (failed > 0) process.exit(1);
