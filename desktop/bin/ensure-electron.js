#!/usr/bin/env node
// Runs on every `npm install` (package.json's "postinstall").
//
// Why this exists: electron-builder refuses to build if "electron" lives in
// "dependencies" (it would wastefully try to bundle the npm package's own
// files inside the app, which already embeds the real Electron binary
// separately) — so it has to stay in "devDependencies". But npm/npx
// consumers installing this package do NOT get devDependencies, so
// require('electron') would fail for them at runtime with no obvious fix.
// This script closes that gap: if Electron isn't resolvable after install,
// it installs it on demand. For local development (where devDependencies
// are already present) this is a fast no-op.
const { execSync } = require('child_process');
const path = require('path');

try {
  require.resolve('electron');
  process.exit(0); // already available — local dev, or already installed once
} catch (_) {
  // not found — fall through and install it below
}

console.log('[Contexto AI] Installing the Electron runtime (one-time, ~100MB)...');
try {
  execSync('npm install electron@^30.0.0 --no-save --no-audit --no-fund', {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit',
  });
} catch (err) {
  console.error('[Contexto AI] Automatic Electron install failed. Run manually: npm install electron');
  // Don't fail the parent `npm install` over this — leave a clear message instead.
  process.exit(0);
}
