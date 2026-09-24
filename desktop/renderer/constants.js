// Contexto AI - shared constants (desktop renderer)
// Mirrors src/shared/constants.js — kept as a separate copy since the
// desktop app has no build step to share files with the extension.
export const DB = Object.freeze({
  NAME:    "contexto_desktop_db",
  VERSION: 2,
  STORE:   "clips",
});

export const EMBED_DIM = 256;
export const MAX_RESULTS = 50;
