import { useState } from "react";
import { authenticator } from "otplib";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "./auth.js";

// Same palette as App.jsx's own `C` — duplicated here rather than imported
// since App.jsx has no exports of its own to pull from.
const C = {
  ink: "#0B1220",
  line: "#243450",
  chalk: "#EDE8DA",
  slate: "#8494AC",
  gold: "#E8A33D",
  turf: "#57B478",
  ember: "#D4604C",
};

export default function TwoFASetup({ currentUser, onUpdate }) {
  const [phase, setPhase] = useState(currentUser.twoFAEnabled ? "active" : "idle");
  const [secret, setSecret] = useState("");
  const [qrUrl, setQrUrl] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function startSetup() {
    const newSecret = authenticator.generateSecret();
    const otpUrl = authenticator.keyuri(currentUser.email, "PFA Hub", newSecret);
    const qr = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(otpUrl)}`;
    setSecret(newSecret);
    setQrUrl(qr);
    setCode("");
    setError("");
    setPhase("setup");
  }

  async function verifyAndEnable() {
    setError("");
    const valid = authenticator.verify({ token: code.replace(/\s/g, ""), secret });
    if (!valid) {
      setError("Invalid code. Please try again.");
      return;
    }
    setLoading(true);
    try {
      // NOTE: stored as plaintext for v1, per the spec — Firestore rules
      // restrict this doc to the owning user + admins, but a Cloud Function
      // to encrypt it at rest is flagged as future hardening, not done here.
      await updateDoc(doc(db, "users", currentUser.uid), {
        twoFAEnabled: true,
        twoFASecret: secret,
      });
      onUpdate({ ...currentUser, twoFAEnabled: true, twoFASecret: secret });
      setPhase("active");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function disable2FA() {
    if (!window.confirm("Disable two-factor authentication?")) return;
    await updateDoc(doc(db, "users", currentUser.uid), {
      twoFAEnabled: false,
      twoFASecret: null,
    });
    onUpdate({ ...currentUser, twoFAEnabled: false, twoFASecret: null });
    setPhase("idle");
  }

  if (phase === "active") {
    return (
      <div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 16,
            padding: "10px 14px",
            background: "rgba(87,180,120,0.1)",
            border: `1px solid rgba(87,180,120,0.3)`,
            borderRadius: 6,
          }}
        >
          <span style={{ fontSize: 18 }}>🔒</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.turf }}>2FA Active</div>
            <div style={{ fontSize: 11, color: C.slate }}>Your account is protected with an authenticator app</div>
          </div>
        </div>
        <button
          onClick={disable2FA}
          style={{
            padding: "8px 16px",
            background: "transparent",
            border: `1px solid rgba(212,96,76,0.5)`,
            color: C.ember,
            borderRadius: 4,
            fontSize: 11,
            fontWeight: 700,
            textTransform: "uppercase",
            cursor: "pointer",
          }}
        >
          Disable 2FA
        </button>
      </div>
    );
  }

  if (phase === "setup") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <p style={{ fontSize: 13, color: C.slate, lineHeight: 1.6, margin: 0 }}>
          Scan this QR code with <strong style={{ color: C.chalk }}>Authy</strong> or any authenticator app, then
          enter the 6-digit code to confirm.
        </p>
        <div style={{ background: "white", padding: 12, borderRadius: 8, display: "inline-block", border: `3px solid ${C.gold}` }}>
          <img src={qrUrl} alt="2FA QR Code" style={{ display: "block", width: 180, height: 180 }} />
        </div>
        <div>
          <label style={{ display: "block", fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: C.slate, marginBottom: 6 }}>
            6-Digit Code
          </label>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="000 000"
            maxLength={6}
            style={{
              width: "100%",
              padding: "12px 14px",
              background: C.ink,
              border: `1px solid ${C.gold}`,
              borderRadius: 4,
              color: C.gold,
              fontSize: 24,
              fontWeight: 700,
              letterSpacing: "0.2em",
              textAlign: "center",
              outline: "none",
              boxSizing: "border-box",
            }}
          />
        </div>
        {error && <div style={{ color: C.ember, fontSize: 12 }}>{error}</div>}
        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={verifyAndEnable}
            disabled={loading || code.length < 6}
            style={{
              flex: 1,
              padding: "11px 0",
              background: C.gold,
              color: "#0d0f12",
              border: "none",
              borderRadius: 4,
              fontWeight: 700,
              fontSize: 13,
              textTransform: "uppercase",
              cursor: "pointer",
              opacity: loading || code.length < 6 ? 0.5 : 1,
            }}
          >
            {loading ? "Verifying…" : "Enable 2FA"}
          </button>
          <button
            onClick={() => setPhase("idle")}
            style={{
              padding: "11px 20px",
              background: "transparent",
              border: `1px solid ${C.line}`,
              color: C.slate,
              borderRadius: 4,
              fontWeight: 700,
              fontSize: 13,
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={startSetup}
      style={{
        padding: "10px 20px",
        background: "transparent",
        border: `1px solid ${C.line}`,
        color: C.chalk,
        borderRadius: 4,
        fontWeight: 700,
        fontSize: 13,
        textTransform: "uppercase",
        cursor: "pointer",
      }}
    >
      Set Up Two-Factor Authentication
    </button>
  );
}
