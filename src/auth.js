// Firebase Authentication + Firestore user-profile helpers.
// Spec: PFA-Hub-Auth-Spec.md (Jim, 2026-08-05).
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
} from "firebase/auth";
import { getFirestore, doc, setDoc, getDoc, serverTimestamp } from "firebase/firestore";
import { app } from "./firebase-config.js";

export const auth = getAuth(app);
export const db = getFirestore(app);

// Seed admins — auto-promoted to "admin" the first time they log in.
// Everyone else defaults to "user".
const SEED_ADMINS = ["jdshort99@gmail.com", "painlessfootball@gmail.com"];

// Create (first login) or fetch (every login after) the Firestore profile
// that backs role/approval status. Firebase Auth has no concept of roles —
// this doc is the source of truth for everything past "who is this person."
export async function ensureUserProfile(firebaseUser) {
  const ref = doc(db, "users", firebaseUser.uid);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    const role = SEED_ADMINS.includes(firebaseUser.email) ? "admin" : "user";
    const displayName = firebaseUser.displayName || firebaseUser.email.split("@")[0];
    await setDoc(ref, {
      email: firebaseUser.email,
      displayName,
      role,
      approved: true,
      createdAt: serverTimestamp(),
    });
    return { uid: firebaseUser.uid, email: firebaseUser.email, displayName, role, approved: true };
  }

  return { uid: firebaseUser.uid, ...snap.data() };
}

export async function registerUser(email, password, displayName) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  // Sync the name onto the Firebase Auth account too, not just Firestore —
  // otherwise firebaseUser.displayName stays blank on every future login.
  if (displayName) {
    await updateProfile(cred.user, { displayName });
  }
  return ensureUserProfile({ ...cred.user, displayName });
}

export async function loginUser(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return ensureUserProfile(cred.user);
}

export async function logoutUser() {
  await signOut(auth);
}

// Fires once on load with the current session (or null), then again on
// every sign-in/sign-out. Resolves straight to a full profile (or null) so
// callers never see a bare Firebase Auth user.
export function onAuthChange(callback) {
  return onAuthStateChanged(auth, async (firebaseUser) => {
    if (!firebaseUser) {
      callback(null);
      return;
    }
    const profile = await ensureUserProfile(firebaseUser);
    callback(profile);
  });
}
