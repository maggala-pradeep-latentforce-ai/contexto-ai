// Contexto - Sensitive data stripping layer

const SENSITIVE_RE = [
  /credit.{0,10}card|cvv|ssn/gi,
  /password\s*[:=]\s*\S+/gi,
  /passwd\s*[:=]\s*\S+/gi,
  /secret\s*[:=]\s*\S+/gi,
  /-----BEGIN [A-Z ]+ PRIVATE KEY-----[\s\S]+?-----END [A-Z ]+ PRIVATE KEY-----/g,
  /Bearer\s+[A-Za-z0-9\-._~+\/]+=*/gi,
  /AKIA[0-9A-Z]{16}/g,
  /sk-[A-Za-z0-9]{32,}/g,
  /ghp_[A-Za-z0-9]{36}/g,
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,
];

export function stripSensitive(text) {
  let out = String(text);
  for (const re of SENSITIVE_RE) { re.lastIndex = 0; out = out.replace(re, '[REDACTED]'); }
  return out;
}

export function isSensitive(text) {
  return SENSITIVE_RE.some((re) => { re.lastIndex = 0; return re.test(text); });
}

// ── Sensitive-note encryption ────────────────────────────────────────────────
// stripSensitive() above is destructive redaction for auto-captured clips —
// the original value is thrown away. Notes are different: the user
// deliberately saved a real password/API key to retrieve it later, so it has
// to stay recoverable. This encrypts it at rest instead, using a device-local
// AES-GCM key, so it survives in IndexedDB, but never leaves this device as
// plaintext — including never being sent to the LLM when answering a query
// about it (see the "answer_local" path in main/llm.js).
//
// Honest limitation: the key lives in localStorage next to the data it
// protects. This stops someone from reading a raw exported IndexedDB file in
// isolation, but not someone with full access to this unlocked machine —
// there's no separate master password / vault-unlock step.
const SENSITIVE_KEY_WORDS = [
  'password', 'passwd', 'pin', 'api key', 'apikey', 'secret', 'token',
  'credential', 'private key', 'passphrase', 'ssn', 'credit card', 'cvv',
];

export function isSensitiveKey(key) {
  if (!key) return false;
  const k = key.toLowerCase();
  return SENSITIVE_KEY_WORDS.some((w) => k.includes(w));
}

let _deviceKeyPromise = null;
function getOrCreateDeviceKey() {
  if (_deviceKeyPromise) return _deviceKeyPromise;
  _deviceKeyPromise = (async () => {
    let b64 = null;
    try { b64 = localStorage.getItem('ctx_device_key'); } catch { /* ignore */ }
    if (b64) {
      const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
    }
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', key));
    try { localStorage.setItem('ctx_device_key', btoa(String.fromCharCode(...raw))); } catch { /* ignore */ }
    return key;
  })();
  return _deviceKeyPromise;
}

export async function encryptText(text) {
  const key = await getOrCreateDeviceKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text));
  return JSON.stringify({
    iv: btoa(String.fromCharCode(...iv)),
    data: btoa(String.fromCharCode(...new Uint8Array(cipher))),
  });
}

export async function decryptText(blob) {
  const key = await getOrCreateDeviceKey();
  const { iv, data } = JSON.parse(blob);
  const ivBytes = Uint8Array.from(atob(iv), (c) => c.charCodeAt(0));
  const dataBytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivBytes }, key, dataBytes);
  return new TextDecoder().decode(plain);
}
