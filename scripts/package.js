#!/usr/bin/env node
// scripts/package.js — creates contexto-ai.zip ready for distribution or Chrome Web Store
const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT  = path.join(ROOT, 'contexto-ai.zip');

// Files/dirs to include
const INCLUDE = [
  'manifest.json',
  'public',
  'src',
  'README.md',
];

// Remove old zip
if (fs.existsSync(OUT)) fs.unlinkSync(OUT);

const files = INCLUDE.join(' ');
execSync(`zip -r "${OUT}" ${files}`, { cwd: ROOT, stdio: 'inherit' });

const size = (fs.statSync(OUT).size / 1024).toFixed(1);
console.log(`\nPackaged: ${OUT} (${size} KB)`);
console.log('Upload to: chrome://extensions > Pack extension, or Chrome Web Store dashboard');
