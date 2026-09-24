import { DB } from "./constants.js";

// Contexto - IndexedDB Storage Layer
const DB_NAME = DB.NAME;
const DB_VERSION = DB.VERSION;
const STORE_CLIPS = DB.STORE;

let _db = null;

export function openDB() {
  return new Promise((resolve, reject) => {
    if (_db) return resolve(_db);
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      let store;
      if (!db.objectStoreNames.contains(STORE_CLIPS)) {
        store = db.createObjectStore(STORE_CLIPS, { keyPath: "id" });
        store.createIndex("createdAt", "createdAt", { unique: false });
        store.createIndex("type", "type", { unique: false });
      } else {
        store = e.target.transaction.objectStore(STORE_CLIPS);
      }
      // "key" holds the normalized label of a structured fact (e.g. "wifi password"
      // out of "wifi password: hunter2"), so queries can look facts up directly
      // instead of relying purely on fuzzy embedding similarity.
      if (!store.indexNames.contains("key")) {
        store.createIndex("key", "key", { unique: false });
      }
    };
    req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

export async function saveClip(clip) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CLIPS, "readwrite");
    tx.objectStore(STORE_CLIPS).put(clip);
    tx.oncomplete = () => resolve(clip);
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAllClips() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CLIPS, "readonly");
    const req = tx.objectStore(STORE_CLIPS).index("createdAt").getAll();
    req.onsuccess = () => resolve((req.result || []).reverse());
    req.onerror = () => reject(req.error);
  });
}

export async function deleteClip(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CLIPS, "readwrite");
    tx.objectStore(STORE_CLIPS).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearAllClips() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CLIPS, "readwrite");
    tx.objectStore(STORE_CLIPS).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Direct structured lookup — e.g. key "wifi password" instead of scanning
// every clip's embedding. Falls back to callers doing fuzzy search themselves.
export async function getClipsByKey(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CLIPS, "readonly");
    const req = tx.objectStore(STORE_CLIPS).index("key").getAll(key);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function getClipCount() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CLIPS, "readonly");
    const req = tx.objectStore(STORE_CLIPS).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
