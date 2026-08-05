import { useState } from "react";
import { loginUser, registerUser } from "./auth.js";

// Same palette as App.jsx's own `C` — duplicated here rather than imported
// since App.jsx has no exports of its own to pull from.
const C = {
  ink: "#0B1220",
  panel: "#131E31",
  panelHi: "#1A2942",
  line: "#243450",
  chalk: "#EDE8DA",
  slate: "#8494AC",
  gold: "#E8A33D",
  ember: "#D4604C",
};

const inputStyle = {
  padding: "10px 12px",
  background: C.panelHi,
  border: `1px solid ${C.line}`,
  color: C.chalk,
  borderRadius: 4,
  fontSize: 14,
  outline: "none",
};

export default function LandingPage({ onAuth }) {
  const [mode, setMode] = useState("login"); // "login" | "register"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [logoOk, setLogoOk] = useState(true);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const profile =
        mode === "login" ? await loginUser(email, password) : await registerUser(email, password, name);
      onAuth(profile);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="min-h-screen w-full flex flex-col items-center justify-center px-4"
      style={{ background: C.ink, fontFamily: "'Barlow', sans-serif" }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800&family=Barlow:wght@400;500;600&display=swap');
      `}</style>

      {logoOk && (
        <img
          src="/art/pfa-mark.png"
          alt="PFA"
          style={{ height: 72, width: "auto", marginBottom: 20 }}
          onError={() => setLogoOk(false)}
        />
      )}
      <h1
        className="text-3xl sm:text-4xl uppercase text-center"
        style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, letterSpacing: "0.04em", color: C.chalk, margin: 0 }}
      >
        Painless <span style={{ color: C.gold }}>Football</span> Alliance
      </h1>
      <p className="mt-2 mb-8 text-sm tracking-widest uppercase" style={{ color: C.slate, letterSpacing: "0.2em" }}>
        A game of decimals
      </p>

      <div
        className="w-full"
        style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 8, padding: "32px 36px", maxWidth: 400 }}
      >
        <div className="flex mb-7 overflow-hidden" style={{ border: `1px solid ${C.line}`, borderRadius: 6 }}>
          {["login", "register"].map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m);
                setError("");
              }}
              className="flex-1 py-2.5 text-xs font-semibold uppercase tracking-wider"
              style={{
                border: "none",
                cursor: "pointer",
                background: mode === m ? C.gold : "transparent",
                color: mode === m ? C.ink : C.slate,
              }}
            >
              {m === "login" ? "Sign In" : "Register"}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
          {mode === "register" && (
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Display Name"
              required
              style={inputStyle}
            />
          )}
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            required
            style={inputStyle}
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            required
            style={inputStyle}
          />

          {error && (
            <div className="text-xs" style={{ color: C.ember }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-1 py-2.5 text-sm font-bold uppercase tracking-wider"
            style={{
              background: C.gold,
              color: C.ink,
              border: "none",
              borderRadius: 4,
              cursor: loading ? "default" : "pointer",
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? "…" : mode === "login" ? "Sign In" : "Create Account"}
          </button>
        </form>
      </div>
    </div>
  );
}
