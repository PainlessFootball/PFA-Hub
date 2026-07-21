// Storage adapter: uses Firebase (shared, real-time) when configured,
// otherwise falls back to this browser's local storage.
import { firebaseConfig } from "./firebase-config.js";

export const firebaseReady = Boolean(firebaseConfig && firebaseConfig.apiKey);

let db = null;
let fs = null; // firestore module functions

async function ensureDb() {
  if (!firebaseReady || db) return db;
  const { initializeApp } = await import("firebase/app");
  fs = await import("firebase/firestore");
  db = fs.getFirestore(initializeApp(firebaseConfig));
  return db;
}

const localGet = (k) => {
  try {
    return JSON.parse(localStorage.getItem(k) || "null");
  } catch {
    return null;
  }
};
const localSet = (k, v) => localStorage.setItem(k, JSON.stringify(v));

// ── Chat ──
export function watchChat(cb) {
  if (!firebaseReady) {
    cb(localGet("pfa-chat") || []);
    return () => {};
  }
  let unsub = () => {};
  ensureDb().then(() => {
    const q = fs.query(fs.collection(db, "chat"), fs.orderBy("ts"), fs.limitToLast(200));
    unsub = fs.onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
  });
  return () => unsub();
}

export async function sendChat(msg) {
  if (!firebaseReady) {
    const entry = { ...msg, id: `local-${Date.now()}-${Math.random().toString(36).slice(2)}` };
    const c = (localGet("pfa-chat") || []).concat(entry).slice(-200);
    localSet("pfa-chat", c);
    return c;
  }
  await ensureDb();
  await fs.addDoc(fs.collection(db, "chat"), msg);
  return null;
}

export async function removeChatMessage(id) {
  if (!firebaseReady) {
    const c = (localGet("pfa-chat") || []).filter((m) => m.id !== id);
    localSet("pfa-chat", c);
    return c;
  }
  await ensureDb();
  await fs.deleteDoc(fs.doc(db, "chat", id));
  return null;
}

// ── News ──
export function watchNews(cb) {
  if (!firebaseReady) {
    cb(localGet("pfa-news") || []);
    return () => {};
  }
  let unsub = () => {};
  ensureDb().then(() => {
    const q = fs.query(fs.collection(db, "news"), fs.orderBy("ts", "desc"), fs.limit(50));
    unsub = fs.onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
  });
  return () => unsub();
}

export async function postNewsItem(item) {
  if (!firebaseReady) {
    const n = [item].concat(localGet("pfa-news") || []).slice(0, 50);
    localSet("pfa-news", n);
    return n;
  }
  await ensureDb();
  await fs.addDoc(fs.collection(db, "news"), item);
  return null;
}

export async function removeNewsItem(id) {
  if (!firebaseReady) {
    const n = (localGet("pfa-news") || []).filter((x) => x.id !== id);
    localSet("pfa-news", n);
    return n;
  }
  await ensureDb();
  await fs.deleteDoc(fs.doc(db, "news", id));
  return null;
}

// ── Coach name (always local to the device) ──
export const getCoachName = () => localGet("pfa-coach-name") || "";
export const setCoachNameStored = (n) => localSet("pfa-coach-name", n);
