// Same palette as App.jsx's own `C` — duplicated here rather than imported
// since App.jsx has no exports of its own to pull from.
const C = {
  line: "#243450",
  slate: "#8494AC",
  gold: "#E8A33D",
};

export default function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="px-4 sm:px-6 py-4 text-xs" style={{ borderTop: `1px solid ${C.line}`, color: C.slate }}>
      <div className="max-w-6xl mx-auto flex flex-col gap-2">
        <div className="flex justify-between flex-wrap gap-2">
          <span>Painless Football Alliance</span>
          <span style={{ fontFamily: "'IBM Plex Mono', monospace" }}>sleeper api · firebase · alliance sheet</span>
        </div>
        <div className="flex items-center gap-4 flex-wrap pt-2" style={{ borderTop: `1px solid ${C.line}` }}>
          <span>© {year} Painless Football Alliance. All rights reserved.</span>
          <div className="flex-1" />
          <FooterLink href="/terms">Terms of Service</FooterLink>
          <FooterLink href="/privacy">Privacy Policy</FooterLink>
          <FooterLink href="/aup">Acceptable Use</FooterLink>
          <span style={{ color: C.line }}>|</span>
          <span>US, Canada &amp; Mexico residents · 18+ only</span>
        </div>
      </div>
    </footer>
  );
}

function FooterLink({ href, children }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      style={{ color: "inherit", textDecoration: "none" }}
      onMouseEnter={(e) => (e.currentTarget.style.color = C.gold)}
      onMouseLeave={(e) => (e.currentTarget.style.color = "inherit")}
    >
      {children}
    </a>
  );
}
