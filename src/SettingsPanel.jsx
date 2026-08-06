import { useState } from "react";
import { db, auth, uploadAvatar, deleteAccount } from "./auth.js";
import { doc, updateDoc } from "firebase/firestore";
import { updatePassword, reauthenticateWithCredential, EmailAuthProvider } from "firebase/auth";
import TwoFASetup from "./TwoFASetup.jsx";

// Same palette as App.jsx's own `C` — duplicated here rather than imported
// since App.jsx has no exports of its own to pull from.
const C = {
  ink: "#0B1220",
  line: "#243450",
  chalk: "#EDE8DA",
  slate: "#8494AC",
  gold: "#E8A33D",
  ember: "#D4604C",
};

const labelStyle = {
  display: "block",
  fontSize: 11,
  fontWeight: 700,
  textTransform: "uppercase",
  color: C.slate,
  letterSpacing: "0.05em",
  marginBottom: 6,
};

const inputStyle = {
  width: "100%",
  padding: "10px 14px",
  background: C.ink,
  border: `1px solid ${C.line}`,
  borderRadius: 4,
  color: C.chalk,
  fontSize: 14,
  outline: "none",
  boxSizing: "border-box",
};

const btnStyle = {
  padding: "12px 0",
  background: C.gold,
  color: "#0d0f12",
  border: "none",
  borderRadius: 4,
  fontWeight: 700,
  fontSize: 13,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  cursor: "pointer",
};

export default function SettingsPanel({ currentUser, onUpdate, onAccountDeleted }) {
  const [tab, setTab] = useState("profile");
  const [displayName, setName] = useState(currentUser.displayName || "");
  const [avatarFile, setAvatar] = useState(null);
  const [avatarPreview, setPreview] = useState(currentUser.avatarUrl || null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");

  const [deleting, setDeleting] = useState(false);

  async function saveProfile(e) {
    e.preventDefault();
    setSaving(true);
    setMsg("");
    try {
      let avatarUrl = currentUser.avatarUrl || null;
      if (avatarFile) {
        avatarUrl = await uploadAvatar(avatarFile, currentUser.uid);
      }
      await updateDoc(doc(db, "users", currentUser.uid), { displayName, avatarUrl });
      onUpdate({ ...currentUser, displayName, avatarUrl });
      setMsg("Profile updated.");
    } catch (err) {
      setMsg("Error: " + err.message);
    } finally {
      setSaving(false);
    }
  }

  async function changePassword(e) {
    e.preventDefault();
    if (newPw !== confirmPw) {
      setMsg("Passwords do not match.");
      return;
    }
    if (newPw.length < 8) {
      setMsg("Password must be at least 8 characters.");
      return;
    }
    setSaving(true);
    setMsg("");
    try {
      const credential = EmailAuthProvider.credential(currentUser.email, currentPw);
      await reauthenticateWithCredential(auth.currentUser, credential);
      await updatePassword(auth.currentUser, newPw);
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
      setMsg("Password changed successfully.");
    } catch (err) {
      setMsg("Error: " + err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteAccount() {
    if (!window.confirm("This permanently deletes your account and cannot be undone. Continue?")) return;
    setDeleting(true);
    setMsg("");
    try {
      await deleteAccount();
      onAccountDeleted?.();
    } catch (err) {
      setMsg("Error: " + err.message);
      setDeleting(false);
    }
  }

  function handleAvatarSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    setAvatar(file);
    setPreview(URL.createObjectURL(file));
  }

  const initials = getInitials(displayName || currentUser.email);

  return (
    <div style={{ maxWidth: 560 }}>
      <h2 style={{ fontSize: 22, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 20, fontFamily: "'Barlow Condensed', sans-serif" }}>
        Settings
      </h2>

      <div style={{ display: "flex", gap: 0, marginBottom: 24, border: `1px solid ${C.line}`, borderRadius: 6, overflow: "hidden", width: "fit-content" }}>
        {["Profile", "Security"].map((t) => (
          <button
            key={t}
            onClick={() => {
              setTab(t.toLowerCase());
              setMsg("");
            }}
            style={{
              padding: "8px 20px",
              fontSize: 12,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              border: "none",
              cursor: "pointer",
              background: tab === t.toLowerCase() ? C.gold : "transparent",
              color: tab === t.toLowerCase() ? "#0d0f12" : C.slate,
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {msg && (
        <div
          style={{
            padding: "10px 14px",
            borderRadius: 4,
            marginBottom: 16,
            fontSize: 13,
            background: msg.startsWith("Error") ? "rgba(212,96,76,0.1)" : "rgba(87,180,120,0.1)",
            color: msg.startsWith("Error") ? C.ember : "#57B478",
            border: `1px solid ${msg.startsWith("Error") ? "rgba(212,96,76,0.3)" : "rgba(87,180,120,0.3)"}`,
          }}
        >
          {msg}
        </div>
      )}

      {tab === "profile" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
          <form onSubmit={saveProfile} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
              <div
                style={{
                  width: 80,
                  height: 80,
                  borderRadius: "50%",
                  border: `2px solid ${C.gold}`,
                  overflow: "hidden",
                  background: C.ink,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                {avatarPreview ? (
                  <img src={avatarPreview} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                  <span style={{ fontSize: 28, fontWeight: 800, color: C.gold, fontFamily: "'Barlow Condensed', sans-serif" }}>
                    {initials}
                  </span>
                )}
              </div>
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: C.slate, marginBottom: 6 }}>
                  Profile Photo
                </label>
                <input type="file" accept="image/*" onChange={handleAvatarSelect} style={{ fontSize: 12, color: C.slate }} />
                <p style={{ fontSize: 11, color: C.slate, marginTop: 4, opacity: 0.7 }}>
                  JPG, PNG or GIF. Max 2MB. Your initials show if no photo is set.
                </p>
              </div>
            </div>

            <div>
              <label style={labelStyle}>Display Name</label>
              <input
                value={displayName}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name as it appears in chat and standings"
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>Email Address</label>
              <input value={currentUser.email} readOnly style={{ ...inputStyle, opacity: 0.5, cursor: "not-allowed" }} />
            </div>

            <button type="submit" disabled={saving} style={{ ...btnStyle, opacity: saving ? 0.7 : 1 }}>
              {saving ? "Saving…" : "Save Profile"}
            </button>
          </form>

          <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: 24 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8, color: C.ember }}>
              Delete Account
            </h3>
            <p style={{ color: C.slate, fontSize: 13, marginBottom: 14, lineHeight: 1.6 }}>
              Permanently deletes your account and sign-in. This cannot be undone.
            </p>
            <button
              onClick={handleDeleteAccount}
              disabled={deleting}
              style={{
                padding: "10px 20px",
                background: "transparent",
                border: `1px solid rgba(212,96,76,0.5)`,
                color: C.ember,
                borderRadius: 4,
                fontWeight: 700,
                fontSize: 12,
                textTransform: "uppercase",
                cursor: deleting ? "default" : "pointer",
                opacity: deleting ? 0.6 : 1,
              }}
            >
              {deleting ? "Deleting…" : "Delete My Account"}
            </button>
          </div>
        </div>
      )}

      {tab === "security" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
          <div>
            <h3 style={{ fontSize: 14, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 16, color: C.chalk }}>
              Change Password
            </h3>
            <form onSubmit={changePassword} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <label style={labelStyle}>Current Password</label>
                <input type="password" value={currentPw} onChange={(e) => setCurrentPw(e.target.value)} required style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>New Password (min 8 characters)</label>
                <input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} required minLength={8} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Confirm New Password</label>
                <input type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} required style={inputStyle} />
              </div>
              <button type="submit" disabled={saving} style={{ ...btnStyle, marginTop: 4, opacity: saving ? 0.7 : 1 }}>
                {saving ? "Updating…" : "Update Password"}
              </button>
            </form>
          </div>

          <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: 24 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8, color: C.chalk }}>
              Two-Factor Authentication
            </h3>
            <p style={{ color: C.slate, fontSize: 13, marginBottom: 16, lineHeight: 1.6 }}>
              Use Authy or any TOTP authenticator app for extra account security. Once enabled you'll enter a
              6-digit code once per browser session.
            </p>
            <TwoFASetup currentUser={currentUser} onUpdate={onUpdate} />
          </div>
        </div>
      )}
    </div>
  );
}

function getInitials(str) {
  if (!str) return "?";
  const parts = str.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
