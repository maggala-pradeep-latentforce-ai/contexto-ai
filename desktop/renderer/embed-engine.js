// v2 - CDN import removed, local-only embedder
// Contexto AI - Embedding Engine
// Local-only: n-gram FNV hash embedder. Zero network. No CSP issues.

import { EMBED_DIM } from "./constants.js";

/** Local character n-gram FNV hash embedder (no network, instant). */
export function localEmbed(text, dim = EMBED_DIM) {
  const vec = new Float32Array(dim);
  const words = text.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/ +/).filter(Boolean);
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
  return Array.from(vec);
}

// NOTE: Dynamic import() of CDN URLs is blocked by MV3 CSP ("script-src 'self'").
// The local n-gram embedder is the only option without a bundled build step.

/** No-op stub — kept so offscreen/index.js import does not break. */
export function tryLoadNeuralModel() {}

/** Embed text using the local n-gram embedder (synchronous). */
export function embed(text) {
  return localEmbed(text);
}

/** Cosine similarity between two equal-length vectors. */
export function cosineSim(a, b) {
  let dot = 0, ma = 0, mb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]*b[i]; ma += a[i]*a[i]; mb += b[i]*b[i]; }
  return dot / (Math.sqrt(ma) * Math.sqrt(mb) + 1e-10);
}
