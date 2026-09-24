#!/usr/bin/env node
// Launches the Electron app when installed as an npm package — this is what
// `npx contexto-ai` / the `contexto-ai` command actually runs. Needs its own
// file (rather than just pointing "bin" at main/index.js) because that file
// runs *inside* Electron's runtime; this one runs under plain Node and spawns
// Electron as a child process, the standard pattern for an npm-launchable
// Electron app.
const { spawn } = require('child_process');
const path = require('path');

let electronPath;
try {
  electronPath = require('electron');
} catch (err) {
  console.error('[Contexto AI] Could not find Electron. Try reinstalling: npm install contexto-ai');
  process.exit(1);
}

const appPath = path.join(__dirname, '..');
const child = spawn(electronPath, [appPath], { stdio: 'inherit' });
child.on('close', (code) => process.exit(code == null ? 0 : code));
child.on('error', (err) => {
  console.error('[Contexto AI] Failed to launch:', err.message);
  process.exit(1);
});
