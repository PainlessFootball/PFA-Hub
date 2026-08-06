import { useState, useEffect } from "react";

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
};

const ALLOWED_COUNTRIES = ["US", "CA", "MX"]; // United States, Canada, Mexico

const wrapStyle = {
  minHeight: "100vh",
  width: "100%",
  background: C.ink,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontFamily: "'Barlow Condensed', sans-serif",
};

export default function AgeGate({ onPass }) {
  const [ageChecked, setAgeChecked] = useState(false);
  const [termsChecked, setTerms] = useState(false);
  const [geoBlocked, setGeoBlocked] = useState(false);
  const [geoChecked, setGeoChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("https://ipapi.co/json/")
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (!ALLOWED_COUNTRIES.includes(data.country_code)) setGeoBlocked(true);
        setGeoChecked(true);
      })
      .catch(() => {
        // Fail open on network error — don't block VPN/proxy users on a
        // lookup that couldn't complete.
        if (!cancelled) setGeoChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!geoChecked) return null; // brief loading beat, avoids a flash of the gate itself

  if (geoBlocked) {
    return (
      <div style={wrapStyle}>
        <div style={{ textAlign: "center", maxWidth: 440, padding: "0 20px" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🌎</div>
          <h2 style={{ color: C.gold, fontSize: 22, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 12px" }}>
            Not Available in Your Region
          </h2>
          <p style={{ color: C.slate, fontSize: 14, lineHeight: 1.7, fontFamily: "'Barlow', sans-serif" }}>
            PFA Hub is currently only available to residents of the United States, Canada, and Mexico. We're sorry
            for the inconvenience.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={wrapStyle}>
      <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 8, padding: "32px 40px", maxWidth: 440, width: "100%", margin: "0 20px" }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🏈</div>
          <h2 style={{ color: C.gold, fontSize: 20, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", margin: 0 }}>
            Before You Enter
          </h2>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16, fontFamily: "'Barlow', sans-serif" }}>
          <label style={{ display: "flex", gap: 12, cursor: "pointer", fontSize: 14, color: C.chalk, lineHeight: 1.5 }}>
            <input
              type="checkbox"
              checked={ageChecked}
              onChange={(e) => setAgeChecked(e.target.checked)}
              style={{ width: 18, height: 18, marginTop: 2, accentColor: C.gold, flexShrink: 0 }}
            />
            <span>
              I confirm that I am <strong>18 years of age or older</strong>. This site is not intended for use by
              minors.
            </span>
          </label>

          <label style={{ display: "flex", gap: 12, cursor: "pointer", fontSize: 14, color: C.chalk, lineHeight: 1.5 }}>
            <input
              type="checkbox"
              checked={termsChecked}
              onChange={(e) => setTerms(e.target.checked)}
              style={{ width: 18, height: 18, marginTop: 2, accentColor: C.gold, flexShrink: 0 }}
            />
            <span>
              I have read and agree to the{" "}
              <a href="/terms" target="_blank" rel="noopener noreferrer" style={{ color: C.gold }}>
                Terms of Service
              </a>
              ,{" "}
              <a href="/privacy" target="_blank" rel="noopener noreferrer" style={{ color: C.gold }}>
                Privacy Policy
              </a>
              , and{" "}
              <a href="/aup" target="_blank" rel="noopener noreferrer" style={{ color: C.gold }}>
                Acceptable Use Policy
              </a>
              .
            </span>
          </label>
        </div>

        <button
          onClick={() => {
            if (ageChecked && termsChecked) {
              sessionStorage.setItem("pfa_gate_passed", "1");
              onPass();
            }
          }}
          disabled={!ageChecked || !termsChecked}
          style={{
            marginTop: 24,
            width: "100%",
            padding: "12px 0",
            background: C.gold,
            color: "#0d0f12",
            border: "none",
            borderRadius: 4,
            fontWeight: 700,
            fontSize: 14,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            cursor: !ageChecked || !termsChecked ? "not-allowed" : "pointer",
            opacity: !ageChecked || !termsChecked ? 0.4 : 1,
          }}
        >
          Enter PFA Hub
        </button>

        <p style={{ fontSize: 11, color: C.slate, textAlign: "center", marginTop: 16, fontFamily: "'Barlow', sans-serif" }}>
          PFA Hub is a private fantasy football community. No real money wagering occurs on this platform.
        </p>
      </div>
    </div>
  );
}
