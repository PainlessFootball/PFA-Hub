import { useState, useRef, useEffect } from "react";
import { logoutUser } from "./auth.js";

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

export default function UserMenu({ currentUser, onOpenSettings }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const initials = getInitials(currentUser.displayName || currentUser.email);
  const avatarUrl = currentUser.avatarUrl || null;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: 36,
          height: 36,
          borderRadius: "50%",
          border: `2px solid ${C.gold}`,
          background: C.panelHi,
          cursor: "pointer",
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 0,
        }}
      >
        {avatarUrl ? (
          <img src={avatarUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <span style={{ color: C.gold, fontWeight: 800, fontSize: 13, fontFamily: "'Barlow Condensed', sans-serif" }}>
            {initials}
          </span>
        )}
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            background: C.panel,
            border: `1px solid ${C.line}`,
            borderRadius: 8,
            minWidth: 200,
            boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
            zIndex: 1000,
            overflow: "hidden",
          }}
        >
          <div style={{ padding: "14px 16px", borderBottom: `1px solid ${C.line}`, background: C.ink }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: C.chalk }}>
              {currentUser.displayName || currentUser.email}
            </div>
            <div style={{ fontSize: 10, color: C.gold, fontWeight: 700, textTransform: "uppercase", marginTop: 3 }}>
              {currentUser.role}
            </div>
          </div>

          <MenuItem
            icon="⚙️"
            label="Profile & Settings"
            onClick={() => {
              setOpen(false);
              onOpenSettings();
            }}
          />
          <div style={{ borderTop: `1px solid ${C.line}` }} />
          <MenuItem icon="🚪" label="Sign Out" onClick={logoutUser} danger />
        </div>
      )}
    </div>
  );
}

function MenuItem({ icon, label, onClick, danger }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "100%",
        padding: "11px 16px",
        background: hover ? "rgba(255,255,255,0.04)" : "transparent",
        border: "none",
        color: danger ? C.ember : C.chalk,
        fontSize: 13,
        fontWeight: 500,
        cursor: "pointer",
        textAlign: "left",
      }}
    >
      <span>{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function getInitials(str) {
  if (!str) return "?";
  const parts = str.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
