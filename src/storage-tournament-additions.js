// ─────────────────────────────────────────────────────────────
// ADD TO storage.js — Tournament frozen-seed snapshot
//
// These two functions are new exports App.jsx now imports (see the updated
// import block at the top of App.jsx). I don't have your live storage.js in
// this session, so I couldn't merge these in directly or verify them against
// your actual file the way the rest of this build was verified — please
// paste these in following the same pattern as your existing
// getWeeklyResult/setWeeklyResult functions (same db import, same style),
// then send storage.js back my way next session so I can run the same
// verification pass on it that App.jsx just went through.
//
// One doc per season in a new top-level collection: tournamentSeeds/{year}.
// Written ONCE per season (the frozen Week-7 snapshot) and read from then on
// — never overwritten. Shape: { seeds: [...], frozenAt: <server timestamp> }.
// ─────────────────────────────────────────────────────────────

// import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
// import { db } from "./firebase-config.js";  // match whatever your existing
//                                              // functions import this as

export async function getTournamentSeeds(year) {
  if (!firebaseReady) return null;
  try {
    const ref = doc(db, "tournamentSeeds", String(year));
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    const data = snap.data();
    return Array.isArray(data.seeds) ? data.seeds : null;
  } catch (e) {
    console.warn("getTournamentSeeds failed:", e);
    return null;
  }
}

export async function setTournamentSeeds(year, seeds) {
  if (!firebaseReady) return;
  try {
    const ref = doc(db, "tournamentSeeds", String(year));
    // Guard against clobbering a snapshot someone else's browser already
    // wrote a moment earlier — same relaxed-consistency approach as
    // weeklyResults/club300Live elsewhere in this file, but a plain
    // existence check first since this collection should only ever be
    // written once per season.
    const existing = await getDoc(ref);
    if (existing.exists()) return;
    await setDoc(ref, { seeds, frozenAt: serverTimestamp() });
  } catch (e) {
    console.warn("setTournamentSeeds failed:", e);
  }
}
