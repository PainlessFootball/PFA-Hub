// Storage adapter: uses Firebase (shared, real-time) when configured,
// otherwise falls back to this browser's local storage.
import { app, firebaseConfig } from "./firebase-config.js";

export const firebaseReady = Boolean(firebaseConfig && firebaseConfig.apiKey);

let db = null;
let fs = null; // firestore module functions

// Firebase itself is now initialized once, in firebase-config.js (auth.js
// needs that same initialized `app` too) — this just hands Firestore the
// shared instance instead of calling initializeApp a second time, which
// throws ("Firebase App named '[DEFAULT]' already exists").
async function ensureDb() {
  if (!firebaseReady || db) return db;
  fs = await import("firebase/firestore");
  db = fs.getFirestore(app);
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
    const entry = { ...item, id: `local-${Date.now()}-${Math.random().toString(36).slice(2)}` };
    const n = [entry].concat(localGet("pfa-news") || []).slice(0, 50);
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

export async function pinNewsItem(id, pinned) {
  if (!firebaseReady) {
    const n = (localGet("pfa-news") || []).map((x) => (x.id === id ? { ...x, pinned } : x));
    localSet("pfa-news", n);
    return n;
  }
  await ensureDb();
  await fs.updateDoc(fs.doc(db, "news", id), { pinned });
  return null;
}

// ── Coach name (always local to the device) ──
export const getCoachName = () => localGet("pfa-coach-name") || "";
export const setCoachNameStored = (n) => localSet("pfa-coach-name", n);

// ── Applications (Apply-to-Team) ──
export function watchApplications(cb) {
  if (!firebaseReady) {
    cb(localGet("pfa-applications") || []);
    return () => {};
  }
  let unsub = () => {};
  ensureDb().then(() => {
    const q = fs.query(fs.collection(db, "applications"), fs.orderBy("ts"));
    unsub = fs.onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
  });
  return () => unsub();
}

export async function submitApplication(app) {
  if (!firebaseReady) {
    const entry = { ...app, id: `local-${Date.now()}-${Math.random().toString(36).slice(2)}` };
    const a = (localGet("pfa-applications") || []).concat(entry);
    localSet("pfa-applications", a);
    return a;
  }
  await ensureDb();
  await fs.addDoc(fs.collection(db, "applications"), app);
  return null;
}

export async function removeApplication(id) {
  if (!firebaseReady) {
    const a = (localGet("pfa-applications") || []).filter((x) => x.id !== id);
    localSet("pfa-applications", a);
    return a;
  }
  await ensureDb();
  await fs.deleteDoc(fs.doc(db, "applications", id));
  return null;
}

// ── Promotion Window (global, commissioner-controlled on/off switch) ──
export function watchPromotionWindow(cb) {
  if (!firebaseReady) {
    cb(Boolean(localGet("pfa-promotion-window")));
    return () => {};
  }
  let unsub = () => {};
  ensureDb().then(() => {
    unsub = fs.onSnapshot(fs.doc(db, "settings", "promotionWindow"), (snap) => {
      cb(snap.exists() ? Boolean(snap.data().open) : false);
    });
  });
  return () => unsub();
}

export async function setPromotionWindow(isOpen) {
  if (!firebaseReady) {
    localSet("pfa-promotion-window", isOpen);
    return isOpen;
  }
  await ensureDb();
  await fs.setDoc(fs.doc(db, "settings", "promotionWindow"), { open: isOpen });
  return null;
}

// ── Weekly Results (Weekly Awards tab's cache) ──
// One doc per {tierKey, year, week}, doc ID built directly from those three
// so a lookup is a single getDoc, never a query. Written once per league-week,
// ever — App.jsx checks here before ever hitting Sleeper.
function weeklyResultKey(tierKey, year, week) {
  return `${tierKey}_${year}_${week}`;
}

export async function getWeeklyResult(tierKey, year, week) {
  const key = weeklyResultKey(tierKey, year, week);
  if (!firebaseReady) {
    return (localGet("pfa-weekly-results") || {})[key] || null;
  }
  await ensureDb();
  const snap = await fs.getDoc(fs.doc(db, "weeklyResults", key));
  return snap.exists() ? snap.data() : null;
}

export async function setWeeklyResult(tierKey, year, week, data) {
  const key = weeklyResultKey(tierKey, year, week);
  if (!firebaseReady) {
    const all = localGet("pfa-weekly-results") || {};
    all[key] = data;
    localSet("pfa-weekly-results", all);
    return data;
  }
  await ensureDb();
  await fs.setDoc(fs.doc(db, "weeklyResults", key), data);
  return null;
}

// ── 300 Club (live, auto-detected) ──
// Doc ID is deterministic from the find itself (tier/year/week/roster), so
// the SAME score getting detected twice — once via the Weekly Awards lazy
// fetch, once via the existing current-week fetch in loadLeague — just
// overwrites the same doc rather than duplicating an entry.
function club300Key(tierKey, year, week, rosterId) {
  return `${tierKey}_${year}_${week}_${rosterId}`;
}

export async function addClub300Entry(tierKey, year, week, rosterId, entry) {
  const key = club300Key(tierKey, year, week, rosterId);
  if (!firebaseReady) {
    const all = localGet("pfa-club300-live") || {};
    all[key] = entry;
    localSet("pfa-club300-live", all);
    return Object.values(all); // local fallback only; Firebase updates via watchClub300Live's snapshot
  }
  await ensureDb();
  await fs.setDoc(fs.doc(db, "club300Live", key), entry);
  return null;
}

export function watchClub300Live(cb) {
  if (!firebaseReady) {
    cb(Object.values(localGet("pfa-club300-live") || {}));
    return () => {};
  }
  let unsub = () => {};
  ensureDb().then(() => {
    unsub = fs.onSnapshot(fs.collection(db, "club300Live"), (snap) => cb(snap.docs.map((d) => d.data())));
  });
  return () => unsub();
}
