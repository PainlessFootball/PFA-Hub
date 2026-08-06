// Firebase Authentication + Firestore user-profile helpers.
// Spec: PFA-Hub-Auth-Spec.md (Jim, 2026-08-05) v1.1 + PFA-Hub-Auth-Spec-2.md v1.2.
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
  sendEmailVerification,
  sendPasswordResetEmail,
  deleteUser,
} from "firebase/auth";
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from "firebase/firestore";
import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { app } from "./firebase-config.js";

export const auth = getAuth(app);
export const db = getFirestore(app);
const storage = getStorage(app);

// Seed admins — auto-promoted to "admin" the first time they log in, and
// skip both the email-verification and admin-approval gates entirely.
// Everyone else defaults to "user", unapproved, pending both gates.
const SEED_ADMINS = ["jdshort99@gmail.com", "painlessfootball@gmail.com"];

// Create (first login) or fetch (every login after) the Firestore profile
// that backs role/approval status. Firebase Auth has no concept of roles —
// this doc is the source of truth for everything past "who is this person."
//
// `everApproved` tracks whether an admin has EVER approved this account —
// kept separate from `approved` itself — so a later ban (approved: false on
// an already-onboarded user) can be told apart from a brand-new signup still
// waiting on its first review. Without it, banning someone would silently
// re-enter them into the Approvals queue the next time they tried to log in.
export async function ensureUserProfile(firebaseUser) {
  const userRef = doc(db, "users", firebaseUser.uid);
  const snap = await getDoc(userRef);
  const isSeedAdmin = SEED_ADMINS.includes(firebaseUser.email);

  if (!snap.exists()) {
    const displayName = firebaseUser.displayName || firebaseUser.email.split("@")[0];
    const profile = {
      email: firebaseUser.email,
      displayName,
      role: isSeedAdmin ? "admin" : "user",
      approved: isSeedAdmin,
      pendingApproval: false,
      everApproved: isSeedAdmin,
      rejected: false,
      twoFAEnabled: false,
      twoFASecret: null,
      avatarUrl: null,
      createdAt: serverTimestamp(),
    };
    await setDoc(userRef, profile);
    return { uid: firebaseUser.uid, ...profile, emailVerified: firebaseUser.emailVerified };
  }

  const data = snap.data();
  const patch = {};

  // Safety net: a seed admin should never be stuck unapproved/non-admin,
  // even if their doc predates this field set or was hand-edited.
  if (isSeedAdmin && (!data.approved || data.role !== "admin" || !data.everApproved)) {
    patch.approved = true;
    patch.role = "admin";
    patch.everApproved = true;
  }

  // Sync pendingApproval once Firebase confirms the verification link was
  // clicked — this is the only place that transition can be observed here,
  // since clicking the link happens outside the app. Only for accounts that
  // have NEVER been approved before and aren't rejected, so a banned
  // returning user doesn't get funneled back into the Approvals queue.
  if (
    firebaseUser.emailVerified &&
    !data.approved &&
    !data.pendingApproval &&
    !data.everApproved &&
    !data.rejected
  ) {
    patch.pendingApproval = true;
  }

  if (Object.keys(patch).length > 0) {
    await updateDoc(userRef, patch);
    Object.assign(data, patch);
  }

  return { uid: firebaseUser.uid, ...data, emailVerified: firebaseUser.emailVerified };
}

export async function registerUser(email, password, displayName) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  // Sync the name onto the Firebase Auth account too, not just Firestore —
  // otherwise firebaseUser.displayName stays blank on every future login.
  if (displayName) {
    await updateProfile(cred.user, { displayName });
  }
  await sendEmailVerification(cred.user);
  return ensureUserProfile({ ...cred.user, displayName, emailVerified: cred.user.emailVerified });
}

export async function loginUser(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return ensureUserProfile(cred.user);
}

export async function logoutUser() {
  await signOut(auth);
}

// Always resolves — never rejects with "user not found" — so the UI can
// show the same "check your email" message regardless of whether the
// address is actually registered. Prevents account enumeration via the
// reset form (some Firebase projects already suppress this server-side;
// this catch covers projects that don't).
export async function resetPassword(email) {
  try {
    await sendPasswordResetEmail(auth, email);
  } catch (err) {
    if (err.code !== "auth/user-not-found") throw err;
  }
}

// Self-service account deletion only — Firebase's client SDK can only delete
// the CURRENTLY signed-in user, never an arbitrary other uid. (Admin
// "Reject" in AdminPanel uses a soft `rejected` flag instead, for the same
// reason — see AdminPanel.jsx.)
export async function deleteAccount() {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("No signed-in user.");
  await deleteDoc(doc(db, "users", uid));
  await deleteUser(auth.currentUser);
}

export async function uploadAvatar(file, uid) {
  if (file.size > 2 * 1024 * 1024) throw new Error("Image must be under 2MB.");
  if (!file.type.startsWith("image/")) throw new Error("File must be an image.");
  const storageRef = ref(storage, `avatars/${uid}`);
  await uploadBytes(storageRef, file);
  return getDownloadURL(storageRef);
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
