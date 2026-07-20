import { useState, useEffect, useCallback, useRef } from "react";
import {
  firebaseReady,
  watchChat,
  sendChat,
  watchNews,
  postNewsItem,
  removeNewsItem,
  getCoachName,
  setCoachNameStored,
} from "./storage.js";

// ─────────────────────────────────────────────────────────────
// PAINLESS FOOTBALL ALLIANCE — fan hub
// Live standings/matchups: Sleeper public API
// News + chat: Firebase (see src/firebase-config.js)
// Alliance data (coaching points, records): sheet feed / sampled below
// ─────────────────────────────────────────────────────────────

const NFL_LEAGUE_ID = "1316582839847759872";
const SLEEPER = "https://api.sleeper.app/v1";

const C = {
  ink: "#0B1220",
  panel: "#131E31",
  panelHi: "#1A2942",
  line: "#243450",
  chalk: "#EDE8DA",
  slate: "#8494AC",
  gold: "#E8A33D",
  goldDim: "#8A6323",
  turf: "#57B478",
  ember: "#D4604C",
};

const TIERS = [
  { key: "NFL", name: "National Football League", tier: 1 },
  { key: "USFL", name: "United States Football League", tier: 2 },
  { key: "XFL", name: "XFL", tier: 3 },
  { key: "SEC", name: "Southeastern Conference", tier: 4 },
  { key: "BIG XII", name: "Big 12 Conference", tier: 5 },
  { key: "ACC", name: "Atlantic Coast Conference", tier: 6 },
  { key: "TEN", name: "Big Ten Conference", tier: 7 },
  { key: "SUN", name: "Sun Belt Conference", tier: 8 },
  { key: "SOCO", name: "Southern Conference", tier: 9 },
  { key: "IVY", name: "Ivy League", tier: 10 },
  { key: "SWAC", name: "Southwestern Athletic", tier: 11 },
  { key: "GLIAC", name: "Great Lakes Intercollegiate", tier: 12 },
  { key: "FLHS", name: "Florida High School", tier: 13 },
];

const DEMO_NFL = [
  { coach: "Harvey28", team: "Tennessee Titans", place: 1, w: 11, l: 6, pts: 3137.0, cp: 285.48 },
  { coach: "DrewM1603", team: "Los Angeles Rams", place: 2, w: 12, l: 5, pts: 3092.2, cp: 266.84 },
  { coach: "finnbar3", team: "Detroit Lions", place: 3, w: 11, l: 6, pts: 2732.25, cp: 234.93 },
  { coach: "Landshark18", team: "Baltimore Ravens", place: 4, w: 13, l: 4, pts: 3327.7, cp: 308.85 },
  { coach: "AZiv49", team: "San Francisco 49ers", place: 5, w: 14, l: 3, pts: 3218.9, cp: 275.0 },
  { coach: "Diego777", team: "Pittsburgh Steelers", place: 6, w: 10, l: 7, pts: 2877.3, cp: 219.15 },
  { coach: "amkm324", team: "Green Bay Packers", place: 7, w: 12, l: 5, pts: 3245.2, cp: 245.7 },
  { coach: "WeReallyOutHere", team: "Los Angeles Chargers", place: 8, w: 8, l: 9, pts: 2854.45, cp: 212.09 },
  { coach: "JWilmot", team: "Miami Dolphins", place: 9, w: 11, l: 6, pts: 2914.65, cp: 212.63 },
  { coach: "zero00", team: "Philadelphia Eagles", place: 10, w: 8, l: 9, pts: 3016.7, cp: 203.02 },
  { coach: "FoggyBuckets", team: "New York Jets", place: 11, w: 11, l: 6, pts: 2943.75, cp: 202.76 },
  { coach: "Oschmini", team: "Seattle Seahawks", place: 12, w: 9, l: 8, pts: 2699.85, cp: 173.05 },
  { coach: "Josssock", team: "New England Patriots", place: 13, w: 14, l: 3, pts: 3527.0, cp: 232.28 },
  { coach: "Calvins22", team: "Arizona Cardinals", place: 14, w: 8, l: 9, pts: 3155.05, cp: 184.92 },
  { coach: "PwnRangr", team: "New Orleans Saints", place: 15, w: 10, l: 7, pts: 2698.55, cp: 172.47 },
  { coach: "zCal", team: "Jacksonville Jaguars", place: 16, w: 8, l: 9, pts: 2318.2, cp: 155.17 },
  { coach: "OlaveGarden18", team: "Cincinnati Bengals", place: 17, w: 11, l: 6, pts: 2802.6, cp: 184.24 },
  { coach: "YinYangKitties", team: "Atlanta Falcons", place: 18, w: 6, l: 11, pts: 2283.99, cp: 114.96 },
  { coach: "DoNotAtMe", team: "New York Giants", place: 19, w: 8, l: 9, pts: 2660.55, cp: 126.49 },
  { coach: "BenchedBallers", team: "Indianapolis Colts", place: 20, w: 9, l: 8, pts: 2538.25, cp: 134.94 },
  { coach: "Tobistresenteam", team: "Minnesota Vikings", place: 21, w: 8, l: 9, pts: 2719.4, cp: 124.11 },
  { coach: "huibuh", team: "Oakland Raiders", place: 22, w: 7, l: 10, pts: 2854.7, cp: 122.86 },
  { coach: "putinsbalenciagas", team: "Chicago Bears", place: 23, w: 7, l: 10, pts: 2415.2, cp: 101.94 },
  { coach: "Ssutton1", team: "Buffalo Bills", place: 24, w: 7, l: 10, pts: 2681.3, cp: 95.39 },
  { coach: "Chuckiv", team: "Dallas Cowboys", place: 27, w: 9, l: 8, pts: 2628.5, cp: 111.23 },
  { coach: "Shubhay", team: "Houston Texans", place: 28, w: 4, l: 13, pts: 2129.05, cp: 39.22 },
  { coach: "booshay", team: "Tampa Bay Buccaneers", place: 29, w: 4, l: 13, pts: 2305.45, cp: 51.18 },
  { coach: "MVPMalik2", team: "Cleveland Browns", place: 30, w: 4, l: 13, pts: 2121.85, cp: 24.69 },
];

const DEMO_CAREER = [
  { coach: "AZiv49", team: "San Francisco 49ers", cp: 1020.78, w: 50, l: 18, pct: 0.735, pts: 13423.1 },
  { coach: "Wynnguy", team: "Brown Bears", cp: 968.43, w: 56, l: 12, pct: 0.824, pts: 16666.75 },
  { coach: "Josssock", team: "New England Patriots", cp: 962.18, w: 47, l: 21, pct: 0.691, pts: 12802.65 },
  { coach: "huibuh", team: "Oakland Raiders", cp: 946.61, w: 41, l: 27, pct: 0.603, pts: 12614.5 },
  { coach: "RedPhoenix437", team: "Los Angeles Express", cp: 933.99, w: 45, l: 23, pct: 0.662, pts: 14315.0 },
  { coach: "amkm324", team: "Green Bay Packers", cp: 933.29, w: 44, l: 24, pct: 0.647, pts: 13706.4 },
  { coach: "FoggyBuckets", team: "New York Jets", cp: 930.99, w: 49, l: 19, pct: 0.721, pts: 13614.7 },
  { coach: "mattbanks3x", team: "San Antonio Gunslingers", cp: 930.46, w: 46, l: 22, pct: 0.676, pts: 15080.85 },
  { coach: "DrewM1603", team: "Los Angeles Rams", cp: 901.62, w: 41, l: 27, pct: 0.603, pts: 11384.3 },
  { coach: "Landshark18", team: "Baltimore Ravens", cp: 893.38, w: 37, l: 28, pct: 0.569, pts: 11712.8 },
  { coach: "ZiplocBaggins", team: "LSU Tigers", cp: 884.87, w: 46, l: 22, pct: 0.676, pts: 14605.2 },
  { coach: "Tobistresenteam", team: "Minnesota Vikings", cp: 874.27, w: 41, l: 27, pct: 0.603, pts: 11699.2 },
  { coach: "Calvins22", team: "Arizona Cardinals", cp: 869.74, w: 41, l: 27, pct: 0.603, pts: 12775.2 },
  { coach: "WeReallyOutHere", team: "Los Angeles Chargers", cp: 860.38, w: 37, l: 31, pct: 0.544, pts: 11717.15 },
  { coach: "samwow123", team: "South Carolina Gamecocks", cp: 850.75, w: 49, l: 19, pct: 0.721, pts: 16522.4 },
  { coach: "Diego777", team: "Pittsburgh Steelers", cp: 847.38, w: 44, l: 24, pct: 0.647, pts: 13959.7 },
  { coach: "Newkbomb", team: "Denver Gold", cp: 847.02, w: 46, l: 22, pct: 0.676, pts: 14940.95 },
];

const DEMO_300 = [
  { coach: "Harvey28", team: "Carolina Chanticleers", conf: "SUN", pts: 388.1, week: 15, year: 2022 },
  { coach: "mchostetler1", team: "Florida Gators", conf: "SEC", pts: 384.85, week: 2, year: 2024 },
  { coach: "beardmantv", team: "Auburn Tigers", conf: "SEC", pts: 342.45, week: 2, year: 2022 },
  { coach: "evanthomas536", team: "Southern U Jaguars", conf: "SWAC", pts: 314.65, week: 2, year: 2022 },
];

const SEED_NEWS = [
  {
    id: "seed-1",
    tag: "ANNOUNCEMENT",
    title: "The 2026 season is underway",
    body: "All thirteen leagues have reset. Check your tier, check your roster, and remember: the coach below you wants your job.",
    ts: Date.now() - 86400000 * 2,
  },
  {
    id: "seed-2",
    tag: "COACHING CAROUSEL",
    title: "Open teams post after final standings",
    body: "Fired coaches: your severance is your career coaching points. Spend them wisely on the way back up.",
    ts: Date.now() - 86400000 * 5,
  },
];

const fmt = (n, d = 2) =>
  typeof n === "number" ? n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }) : "—";

const ago = (ts) => {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
};

// ── Logo: uses /pfa-logo.png from the public folder; SVG shield fallback ──
function Logo({ size = 52 }) {
  const [imgOk, setImgOk] = useState(true);
  if (imgOk) {
    return (
      <img
        src="/pfa-logo.png"
        alt="PFA"
        style={{ height: size, width: "auto" }}
        onError={() => setImgOk(false)}
      />
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 100 110" aria-label="PFA shield">
      <defs>
        <linearGradient id="pfaRainbow" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#E23B3B" />
          <stop offset="20%" stopColor="#F08A2C" />
          <stop offset="40%" stopColor="#F2C94C" />
          <stop offset="60%" stopColor="#4FA36B" />
          <stop offset="80%" stopColor="#3D7DD8" />
          <stop offset="100%" stopColor="#8B5CF6" />
        </linearGradient>
      </defs>
      <path d="M50 4 L92 16 C92 52 88 82 50 106 C12 82 8 52 8 16 Z" fill="url(#pfaRainbow)" stroke={C.chalk} strokeWidth="3.5" />
      <path d="M50 4 L92 16 C92 26 91.5 36 90 45 L10 45 C8.5 36 8 26 8 16 Z" fill="#101A2C" opacity="0.92" />
      {[32, 50, 68].map((x) => (
        <path
          key={x}
          transform={`translate(${x},27) scale(0.9)`}
          d="M0,-7 L2,-2 L7,-2 L3,1.5 L4.5,7 L0,3.5 L-4.5,7 L-3,1.5 L-7,-2 L-2,-2 Z"
          fill={C.chalk}
        />
      ))}
      <text
        x="50"
        y="82"
        textAnchor="middle"
        fill="#0B1220"
        stroke={C.chalk}
        strokeWidth="1"
        style={{ font: "800 34px 'Barlow Condensed', sans-serif", letterSpacing: "1px" }}
      >
        PFA
      </text>
    </svg>
  );
}

export default function App() {
  const [mode, setMode] = useState("loading");
  const [view, setView] = useState("home");
  const [tierKey, setTierKey] = useState("NFL");
  const [nflState, setNflState] = useState(null);
  const [leagueMap, setLeagueMap] = useState({ NFL: NFL_LEAGUE_ID });
  const [standingsCache, setStandingsCache] = useState({});
  const [matchupsCache, setMatchupsCache] = useState({});
  const [tierLoading, setTierLoading] = useState(false);

  const [news, setNews] = useState(SEED_NEWS);
  const [chat, setChat] = useState([]);
  const [coachName, setCoachName] = useState(getCoachName());
  const [nameInput, setNameInput] = useState("");
  const [msgInput, setMsgInput] = useState("");
  const [commish, setCommish] = useState(false);
  const [newsTitle, setNewsTitle] = useState("");
  const [newsBody, setNewsBody] = useState("");
  const [newsTag, setNewsTag] = useState("NEWS");
  const chatEndRef = useRef(null);

  const j = (url) => fetch(url).then((r) => (r.ok ? r.json() : Promise.reject(new Error(url))));

  const buildStandings = (users, rosters) => {
    const byOwner = {};
    users.forEach((u) => (byOwner[u.user_id] = u));
    const rows = rosters.map((r) => {
      const u = byOwner[r.owner_id] || {};
      const s = r.settings || {};
      return {
        coach: u.display_name || "—",
        team: (u.metadata && u.metadata.team_name) || u.display_name || "—",
        w: s.wins || 0,
        l: s.losses || 0,
        pts: (s.fpts || 0) + (s.fpts_decimal || 0) / 100,
        maxPts: (s.ppts || 0) + (s.ppts_decimal || 0) / 100,
        rosterId: r.roster_id,
      };
    });
    rows.sort((a, b) => b.w - a.w || b.pts - a.pts);
    return rows.map((r, i) => ({ ...r, place: i + 1 }));
  };

  const loadLeague = useCallback(async (leagueId, week) => {
    const [users, rosters] = await Promise.all([
      j(`${SLEEPER}/league/${leagueId}/users`),
      j(`${SLEEPER}/league/${leagueId}/rosters`),
    ]);
    const rows = buildStandings(users, rosters);
    setStandingsCache((c) => ({ ...c, [leagueId]: rows }));
    if (week) {
      try {
        const m = await j(`${SLEEPER}/league/${leagueId}/matchups/${week}`);
        const byMatch = {};
        m.forEach((t) => {
          if (!t.matchup_id) return;
          (byMatch[t.matchup_id] = byMatch[t.matchup_id] || []).push(t);
        });
        const nameByRoster = {};
        rows.forEach((r) => (nameByRoster[r.rosterId] = r));
        const pairs = Object.values(byMatch)
          .filter((p) => p.length === 2)
          .map(([a, b]) => ({
            a: { ...nameByRoster[a.roster_id], live: a.points || 0 },
            b: { ...nameByRoster[b.roster_id], live: b.points || 0 },
          }));
        setMatchupsCache((c) => ({ ...c, [leagueId]: pairs }));
      } catch (e) {}
    }
  }, []);

  // initial: live Sleeper + discovery of the other 12 leagues via the commissioner
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const st = await j(`${SLEEPER}/state/nfl`);
        if (cancelled) return;
        setNflState({ week: st.week || 1, season: st.season });
        await loadLeague(NFL_LEAGUE_ID, st.week || 1);
        setMode("live");
        try {
          const users = await j(`${SLEEPER}/league/${NFL_LEAGUE_ID}/users`);
          const owner = users.find((u) => u.is_owner);
          if (owner) {
            const all = await j(`${SLEEPER}/user/${owner.user_id}/leagues/nfl/${st.season}`);
            const map = { NFL: NFL_LEAGUE_ID };
            all.forEach((lg) => {
              const n = (lg.name || "").toUpperCase();
              TIERS.forEach((t) => {
                if (t.key !== "NFL" && (n.includes(t.key) || n.includes(t.name.toUpperCase()))) map[t.key] = lg.league_id;
              });
            });
            if (!cancelled) setLeagueMap(map);
          }
        } catch (e) {}
      } catch (e) {
        if (!cancelled) setMode("demo");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadLeague]);

  // real-time chat + news subscriptions
  useEffect(() => {
    const unsubChat = watchChat((msgs) => setChat(msgs));
    const unsubNews = watchNews((items) => {
      if (items && items.length) setNews(items);
    });
    return () => {
      unsubChat();
      unsubNews();
    };
  }, []);

  useEffect(() => {
    if (chatEndRef.current) chatEndRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [chat.length]);

  useEffect(() => {
    const id = leagueMap[tierKey];
    if (mode === "live" && id && !standingsCache[id]) {
      setTierLoading(true);
      loadLeague(id, nflState && nflState.week).finally(() => setTierLoading(false));
    }
  }, [tierKey, mode, leagueMap, standingsCache, loadLeague, nflState]);

  const saveName = () => {
    const nm = nameInput.trim().slice(0, 24);
    if (!nm) return;
    setCoachName(nm);
    setCoachNameStored(nm);
  };

  const sendMsg = async () => {
    const text = msgInput.trim().slice(0, 280);
    if (!text || !coachName) return;
    setMsgInput("");
    const msg = { name: coachName, text, ts: Date.now() };
    const local = await sendChat(msg);
    if (local) setChat(local); // local fallback only; Firebase updates via snapshot
  };

  const postNews = async () => {
    const title = newsTitle.trim().slice(0, 120);
    const body = newsBody.trim().slice(0, 600);
    if (!title) return;
    const item = { id: String(Date.now()), tag: newsTag, title, body, ts: Date.now() };
    setNewsTitle("");
    setNewsBody("");
    const local = await postNewsItem(item);
    if (local) setNews(local);
  };

  const deleteNews = async (id) => {
    const local = await removeNewsItem(id);
    if (local) setNews(local.length ? local : SEED_NEWS);
  };

  const tier = TIERS.find((t) => t.key === tierKey);
  const leagueId = leagueMap[tierKey];
  const liveRows = leagueId ? standingsCache[leagueId] : null;
  const demoRows = tierKey === "NFL" ? DEMO_NFL.map((r) => ({ ...r, maxPts: null })) : null;
  const rows = mode === "live" ? liveRows : demoRows;
  const pairs = mode === "live" && leagueId ? matchupsCache[leagueId] : null;
  const tagColor = (t) =>
    t === "BREAKING" ? C.ember : t === "ANNOUNCEMENT" ? C.gold : t === "COACHING CAROUSEL" ? C.turf : C.slate;

  const Tab = ({ id, children }) => (
    <button
      onClick={() => setView(id)}
      className="px-3 sm:px-4 py-2 text-sm tracking-widest uppercase transition-colors whitespace-nowrap"
      style={{
        fontFamily: "'Barlow Condensed', sans-serif",
        fontWeight: 600,
        letterSpacing: "0.12em",
        color: view === id ? C.ink : C.slate,
        background: view === id ? C.gold : "transparent",
        borderBottom: view === id ? "none" : `1px solid ${C.line}`,
      }}
    >
      {children}
    </button>
  );

  const th = (h, i, right = 3) => (
    <th
      key={h}
      className={`px-3 py-2 text-xs uppercase tracking-wider whitespace-nowrap ${i >= right ? "text-right" : "text-left"}`}
      style={{ fontWeight: 500 }}
    >
      {h}
    </th>
  );

  return (
    <div className="min-h-screen w-full" style={{ background: C.ink, color: C.chalk, fontFamily: "'Barlow', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700;800&family=Barlow:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
        ::-webkit-scrollbar { height: 6px; width: 8px; }
        ::-webkit-scrollbar-thumb { background: ${C.line}; border-radius: 3px; }
        input::placeholder, textarea::placeholder { color: ${C.slate}; opacity: 0.7; }
        @media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
      `}</style>

      <header className="px-4 sm:px-6 pt-4 pb-0" style={{ borderBottom: `1px solid ${C.line}` }}>
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <Logo size={52} />
              <div>
                <div
                  className="text-3xl sm:text-4xl leading-none uppercase"
                  style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, letterSpacing: "0.02em" }}
                >
                  Painless <span style={{ color: C.gold }}>Football</span> Alliance
                </div>
                <div className="mt-1 text-xs tracking-widest uppercase" style={{ color: C.slate, letterSpacing: "0.2em" }}>
                  A game of decimals · thirteen leagues · one ladder
                </div>
              </div>
            </div>
            <span
              className="px-2.5 py-1 text-xs uppercase tracking-wider rounded-sm"
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                background: mode === "live" ? "rgba(87,180,120,0.15)" : "rgba(232,163,61,0.12)",
                color: mode === "live" ? C.turf : C.gold,
                border: `1px solid ${mode === "live" ? C.turf : C.goldDim}`,
              }}
            >
              {mode === "loading"
                ? "Connecting…"
                : mode === "live"
                ? `● Live · ${nflState ? `${nflState.season} Wk ${nflState.week}` : ""}`
                : "Offline · sample data"}
            </span>
          </div>
          <nav className="mt-4 flex overflow-x-auto">
            <Tab id="home">Home</Tab>
            <Tab id="standings">Standings</Tab>
            <Tab id="coaches">Top Coaches</Tab>
            <Tab id="pyramid">The Pyramid</Tab>
            <div className="flex-1" style={{ borderBottom: `1px solid ${C.line}` }} />
          </nav>
        </div>
      </header>

      {!firebaseReady && (
        <div className="px-4 sm:px-6 py-2 text-xs" style={{ background: "rgba(232,163,61,0.08)", color: C.slate }}>
          <div className="max-w-6xl mx-auto">
            Chat and news are saved only on this device until Firebase is connected — see Step 5 of the setup walkthrough.
          </div>
        </div>
      )}

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        {view === "home" && (
          <div>
            <div className="mb-6">
              <div className="flex items-baseline justify-between mb-2">
                <div className="text-xs uppercase tracking-widest" style={{ color: C.slate, letterSpacing: "0.2em" }}>
                  Top coaches · career CP
                </div>
                <button onClick={() => setView("coaches")} className="text-xs uppercase tracking-wider" style={{ color: C.gold }}>
                  Full ladder →
                </button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
                {DEMO_CAREER.slice(0, 5).map((r, i) => (
                  <div
                    key={r.coach}
                    className="px-3 py-2.5 rounded-sm"
                    style={{
                      background: i === 0 ? "rgba(232,163,61,0.12)" : C.panel,
                      border: `1px solid ${i === 0 ? C.goldDim : C.line}`,
                    }}
                  >
                    <div className="flex items-baseline gap-2">
                      <span
                        className="text-xl leading-none"
                        style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800, color: i === 0 ? C.gold : C.slate }}
                      >
                        {i + 1}
                      </span>
                      <span className="text-sm font-semibold truncate">{r.coach}</span>
                    </div>
                    <div className="mt-1 text-xs truncate" style={{ color: C.slate }}>{r.team}</div>
                    <div className="mt-1 text-sm" style={{ fontFamily: "'IBM Plex Mono', monospace", color: C.gold }}>
                      {fmt(r.cp)} <span className="text-xs" style={{ color: C.slate }}>CP</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-col lg:flex-row gap-6">
              <section className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-2xl uppercase leading-none" style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700 }}>
                    Alliance News
                  </h2>
                  <button
                    onClick={() => setCommish(!commish)}
                    className="text-xs uppercase tracking-wider px-2.5 py-1 rounded-sm"
                    style={{
                      color: commish ? C.ink : C.slate,
                      background: commish ? C.gold : "transparent",
                      border: `1px solid ${commish ? C.gold : C.line}`,
                    }}
                  >
                    {commish ? "Commissioner mode on" : "Commissioner mode"}
                  </button>
                </div>

                {commish && (
                  <div className="mb-4 p-3 rounded-sm space-y-2" style={{ background: C.panel, border: `1px solid ${C.goldDim}` }}>
                    <div className="flex gap-2 flex-wrap">
                      {["NEWS", "BREAKING", "ANNOUNCEMENT", "COACHING CAROUSEL"].map((t) => (
                        <button
                          key={t}
                          onClick={() => setNewsTag(t)}
                          className="px-2 py-0.5 text-xs uppercase tracking-wider rounded-sm"
                          style={{
                            color: newsTag === t ? C.ink : tagColor(t),
                            background: newsTag === t ? tagColor(t) : "transparent",
                            border: `1px solid ${tagColor(t)}`,
                          }}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                    <input
                      value={newsTitle}
                      onChange={(e) => setNewsTitle(e.target.value)}
                      placeholder="Headline"
                      className="w-full px-3 py-2 text-sm rounded-sm outline-none"
                      style={{ background: C.ink, border: `1px solid ${C.line}`, color: C.chalk }}
                    />
                    <textarea
                      value={newsBody}
                      onChange={(e) => setNewsBody(e.target.value)}
                      placeholder="Story (optional)"
                      rows={3}
                      className="w-full px-3 py-2 text-sm rounded-sm outline-none resize-none"
                      style={{ background: C.ink, border: `1px solid ${C.line}`, color: C.chalk }}
                    />
                    <div className="flex items-center justify-end">
                      <button
                        onClick={postNews}
                        className="px-4 py-1.5 text-sm uppercase tracking-wider rounded-sm"
                        style={{ background: C.gold, color: C.ink, fontWeight: 600 }}
                      >
                        Post
                      </button>
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  {news.map((n) => (
                    <article key={n.id} className="p-3.5 rounded-sm" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
                      <div className="flex items-center gap-2 text-xs mb-1.5">
                        <span className="uppercase tracking-wider font-semibold" style={{ color: tagColor(n.tag) }}>{n.tag}</span>
                        <span style={{ color: C.slate, fontFamily: "'IBM Plex Mono', monospace" }}>{ago(n.ts)} ago</span>
                        {commish && (
                          <button onClick={() => deleteNews(n.id)} className="ml-auto text-xs" style={{ color: C.ember }}>
                            delete
                          </button>
                        )}
                      </div>
                      <h3 className="text-base font-semibold leading-snug">{n.title}</h3>
                      {n.body && <p className="mt-1 text-sm leading-relaxed" style={{ color: C.slate }}>{n.body}</p>}
                    </article>
                  ))}
                </div>
              </section>

              <section className="lg:w-96 shrink-0 flex flex-col" style={{ minHeight: "24rem" }}>
                <div className="flex items-baseline justify-between mb-3">
                  <h2 className="text-2xl uppercase leading-none" style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700 }}>
                    The Bullpen
                  </h2>
                  <span className="text-xs uppercase tracking-widest" style={{ color: C.slate }}>all 13 leagues</span>
                </div>
                <div className="flex-1 flex flex-col rounded-sm overflow-hidden" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
                  <div className="flex-1 overflow-y-auto p-3 space-y-2.5" style={{ maxHeight: "26rem", minHeight: "16rem" }}>
                    {chat.length === 0 && (
                      <div className="h-full flex items-center justify-center text-sm text-center px-6" style={{ color: C.slate }}>
                        Nobody's talking yet. Someone in FLHS probably thinks they could hang in the NFL — discuss.
                      </div>
                    )}
                    {chat.map((m, i) => (
                      <div key={m.id || i}>
                        <div className="flex items-baseline gap-2 text-xs">
                          <span className="font-semibold" style={{ color: m.name === coachName ? C.gold : C.chalk }}>{m.name}</span>
                          <span style={{ color: C.slate, fontFamily: "'IBM Plex Mono', monospace" }}>{ago(m.ts)}</span>
                        </div>
                        <div className="text-sm leading-snug mt-0.5">{m.text}</div>
                      </div>
                    ))}
                    <div ref={chatEndRef} />
                  </div>
                  <div className="p-2.5" style={{ borderTop: `1px solid ${C.line}` }}>
                    {coachName ? (
                      <div className="flex gap-2">
                        <input
                          value={msgInput}
                          onChange={(e) => setMsgInput(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && sendMsg()}
                          placeholder={`Talk your talk, ${coachName}`}
                          className="flex-1 px-3 py-2 text-sm rounded-sm outline-none min-w-0"
                          style={{ background: C.ink, border: `1px solid ${C.line}`, color: C.chalk }}
                        />
                        <button
                          onClick={sendMsg}
                          className="px-3.5 py-2 text-sm uppercase tracking-wider rounded-sm shrink-0"
                          style={{ background: C.gold, color: C.ink, fontWeight: 600 }}
                        >
                          Send
                        </button>
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <input
                          value={nameInput}
                          onChange={(e) => setNameInput(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && saveName()}
                          placeholder="Pick your coach name to enter"
                          className="flex-1 px-3 py-2 text-sm rounded-sm outline-none min-w-0"
                          style={{ background: C.ink, border: `1px solid ${C.line}`, color: C.chalk }}
                        />
                        <button
                          onClick={saveName}
                          className="px-3.5 py-2 text-sm uppercase tracking-wider rounded-sm shrink-0"
                          style={{ background: C.gold, color: C.ink, fontWeight: 600 }}
                        >
                          Enter
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </section>
            </div>
          </div>
        )}

        {view === "standings" && (
          <div className="flex flex-col lg:flex-row gap-6">
            <aside className="lg:w-56 shrink-0">
              <div className="text-xs uppercase tracking-widest mb-2" style={{ color: C.slate, letterSpacing: "0.2em" }}>
                The Ladder
              </div>
              <div className="flex lg:flex-col gap-1.5 overflow-x-auto pb-2 lg:pb-0">
                {TIERS.map((t) => {
                  const active = t.key === tierKey;
                  const connected = Boolean(leagueMap[t.key]);
                  return (
                    <button
                      key={t.key}
                      onClick={() => setTierKey(t.key)}
                      className="flex items-center gap-2 px-3 py-2 text-left shrink-0 transition-colors rounded-sm"
                      style={{
                        background: active ? C.gold : C.panel,
                        color: active ? C.ink : connected ? C.chalk : C.slate,
                        border: `1px solid ${active ? C.gold : C.line}`,
                        minWidth: "9.5rem",
                      }}
                    >
                      <span className="text-xs w-5 text-right" style={{ fontFamily: "'IBM Plex Mono', monospace", color: active ? C.ink : C.slate }}>
                        {t.tier}
                      </span>
                      <span className="uppercase text-base leading-none" style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 600, letterSpacing: "0.06em" }}>
                        {t.key}
                      </span>
                      {connected && <span className="ml-auto text-xs" style={{ color: active ? C.ink : C.turf }}>●</span>}
                    </button>
                  );
                })}
              </div>
              <div className="hidden lg:block mt-3 text-xs leading-relaxed" style={{ color: C.slate }}>
                Tier 1 pays the most coaching points. Finish last anywhere and you're fired.
              </div>
            </aside>

            <section className="flex-1 min-w-0">
              <div className="flex items-baseline justify-between mb-3 gap-2 flex-wrap">
                <h2 className="text-3xl uppercase leading-none" style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700 }}>
                  {tier.name}
                </h2>
                <span className="text-xs uppercase tracking-widest" style={{ color: C.slate }}>Tier {tier.tier} of 13</span>
              </div>

              {rows ? (
                <div className="overflow-x-auto rounded-sm" style={{ border: `1px solid ${C.line}` }}>
                  <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ background: C.panel, color: C.slate }}>
                        {["#", "Coach", "Team", "W–L", "PF", mode === "live" ? "Max PF" : "CP"].map((h, i) => th(h, i))}
                      </tr>
                    </thead>
                    <tbody style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                      {rows.map((r, i) => {
                        const isLast = i >= rows.length - 1;
                        return (
                          <tr
                            key={r.coach + i}
                            style={{
                              background: isLast ? "rgba(212,96,76,0.10)" : i % 2 ? "rgba(255,255,255,0.02)" : "transparent",
                              borderTop: `1px solid ${C.line}`,
                            }}
                          >
                            <td className="px-3 py-2" style={{ color: i < 3 ? C.gold : C.slate }}>{r.place}</td>
                            <td className="px-3 py-2 whitespace-nowrap" style={{ fontFamily: "'Barlow', sans-serif", fontWeight: 600 }}>
                              {r.coach}
                              {isLast && (
                                <span className="ml-2 px-1.5 py-0.5 text-xs uppercase tracking-wider rounded-sm" style={{ background: "rgba(212,96,76,0.2)", color: C.ember }}>
                                  hot seat
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap" style={{ fontFamily: "'Barlow', sans-serif", color: C.slate }}>{r.team}</td>
                            <td className="px-3 py-2 text-right whitespace-nowrap">
                              <span style={{ color: C.turf }}>{r.w}</span>
                              <span style={{ color: C.slate }}>–</span>
                              <span style={{ color: C.ember }}>{r.l}</span>
                            </td>
                            <td className="px-3 py-2 text-right">{fmt(r.pts)}</td>
                            <td className="px-3 py-2 text-right" style={{ color: C.gold }}>
                              {mode === "live" ? fmt(r.maxPts) : fmt(r.cp)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : tierLoading ? (
                <div className="py-16 text-center text-sm" style={{ color: C.slate }}>Loading {tier.key} from Sleeper…</div>
              ) : (
                <div className="py-14 px-6 text-center rounded-sm" style={{ border: `1px dashed ${C.line}`, color: C.slate }}>
                  <div className="text-2xl uppercase mb-1" style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 600, color: C.chalk }}>
                    {tier.name}
                  </div>
                  <div className="text-sm max-w-md mx-auto">
                    This tier hasn't been matched to its Sleeper league yet. It connects automatically when the league name
                    contains "{tier.key}" — or add its league ID to the leagueMap in src/App.jsx.
                  </div>
                </div>
              )}

              {pairs && pairs.length > 0 && (
                <div className="mt-6">
                  <div className="text-xs uppercase tracking-widest mb-2" style={{ color: C.slate, letterSpacing: "0.2em" }}>
                    Week {nflState && nflState.week} matchups
                  </div>
                  <div className="grid sm:grid-cols-2 gap-2">
                    {pairs.map((p, i) => (
                      <div key={i} className="flex items-center justify-between px-3 py-2 rounded-sm text-sm" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
                        <span className="truncate pr-2" style={{ fontWeight: 600 }}>{p.a.coach}</span>
                        <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: p.a.live >= p.b.live ? C.turf : C.slate }}>{fmt(p.a.live)}</span>
                        <span className="px-2 text-xs" style={{ color: C.slate }}>vs</span>
                        <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: p.b.live > p.a.live ? C.turf : C.slate }}>{fmt(p.b.live)}</span>
                        <span className="truncate pl-2 text-right" style={{ fontWeight: 600 }}>{p.b.coach}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
          </div>
        )}

        {view === "coaches" && (
          <section>
            <h2 className="text-3xl uppercase mb-1" style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700 }}>
              Career Coaching Points
            </h2>
            <p className="text-sm mb-4" style={{ color: C.slate }}>
              The all-time ladder. Coaching points are earned by team performance, weighted by tier — and spent to claim open teams.
            </p>
            <div className="overflow-x-auto rounded-sm" style={{ border: `1px solid ${C.line}` }}>
              <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: C.panel, color: C.slate }}>
                    {["#", "Coach", "Team", "CP", "W–L", "Win %", "Career PF"].map((h, i) => th(h, i))}
                  </tr>
                </thead>
                <tbody style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                  {DEMO_CAREER.map((r, i) => (
                    <tr key={r.coach} style={{ background: i % 2 ? "rgba(255,255,255,0.02)" : "transparent", borderTop: `1px solid ${C.line}` }}>
                      <td className="px-3 py-2" style={{ color: i < 3 ? C.gold : C.slate }}>{i + 1}</td>
                      <td className="px-3 py-2 whitespace-nowrap" style={{ fontFamily: "'Barlow', sans-serif", fontWeight: 600 }}>{r.coach}</td>
                      <td className="px-3 py-2 whitespace-nowrap" style={{ fontFamily: "'Barlow', sans-serif", color: C.slate }}>{r.team}</td>
                      <td className="px-3 py-2 text-right" style={{ color: C.gold, fontWeight: 600 }}>{fmt(r.cp)}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <span style={{ color: C.turf }}>{r.w}</span>
                        <span style={{ color: C.slate }}>–</span>
                        <span style={{ color: C.ember }}>{r.l}</span>
                      </td>
                      <td className="px-3 py-2 text-right">{r.pct.toFixed(3)}</td>
                      <td className="px-3 py-2 text-right">{fmt(r.pts)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs" style={{ color: C.slate }}>
              This table currently shows 2025 career data. Next step: it reads live from the Alliance sheet's published feed.
            </p>
          </section>
        )}

        {view === "pyramid" && (
          <section className="grid md:grid-cols-2 gap-8">
            <div>
              <h2 className="text-3xl uppercase mb-3" style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700 }}>
                How the Alliance works
              </h2>
              <div className="space-y-3 text-sm leading-relaxed">
                <p>
                  Thirteen dynasty leagues stacked in ranked tiers, from the NFL down to Florida High School. Every league shares the
                  same rosters, scoring, and NFL players — the difference is the stakes.
                </p>
                <p>
                  Your team's performance earns you a <span style={{ color: C.gold }}>coaching score</span>. Higher tiers pay more.
                  You spend those points competing against other coaches for open teams — climbing toward the NFL like a real coaching career.
                </p>
                <p>
                  Teams don't progress. <em>Coaches</em> do. Finish last or underperform and you're{" "}
                  <span style={{ color: C.ember }}>fired</span>: unassigned, your team open for the taking, your next job somewhere
                  further down the ladder.
                </p>
              </div>
              <div className="mt-5 flex flex-col items-start gap-1">
                {TIERS.map((t) => (
                  <div
                    key={t.key}
                    className="flex items-center gap-3 px-3 py-1 rounded-sm"
                    style={{
                      background: t.tier === 1 ? "rgba(232,163,61,0.14)" : C.panel,
                      border: `1px solid ${t.tier === 1 ? C.goldDim : C.line}`,
                      width: `${100 - (t.tier - 1) * 4.5}%`,
                      minWidth: "11rem",
                    }}
                  >
                    <span className="text-xs w-5 text-right" style={{ fontFamily: "'IBM Plex Mono', monospace", color: C.slate }}>{t.tier}</span>
                    <span className="uppercase text-sm" style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 600, letterSpacing: "0.08em", color: t.tier === 1 ? C.gold : C.chalk }}>
                      {t.name}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h3 className="text-2xl uppercase mb-3" style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700 }}>
                The 300 Club
              </h3>
              <p className="text-sm mb-3" style={{ color: C.slate }}>300+ points in a single game. Immortality, in decimals.</p>
              <div className="space-y-2">
                {DEMO_300.map((r, i) => (
                  <div key={i} className="flex items-center gap-3 px-3 py-2.5 rounded-sm" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
                    <span className="text-2xl leading-none" style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, color: C.gold }}>
                      {fmt(r.pts)}
                    </span>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold truncate">{r.coach}</div>
                      <div className="text-xs truncate" style={{ color: C.slate }}>{r.team} · {r.conf} · Wk {r.week}, {r.year}</div>
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-4 text-xs" style={{ color: C.slate }}>
                Trophy Room, weekly Hi/Lo, playoff brackets, rules, and the calendar all get pages like this — each one a feed from the sheet or from Sleeper.
              </p>
            </div>
          </section>
        )}
      </main>

      <footer className="px-4 sm:px-6 py-4 text-xs" style={{ borderTop: `1px solid ${C.line}`, color: C.slate }}>
        <div className="max-w-6xl mx-auto flex justify-between flex-wrap gap-2">
          <span>Painless Football Alliance</span>
          <span style={{ fontFamily: "'IBM Plex Mono', monospace" }}>sleeper api · firebase · alliance sheet</span>
        </div>
      </footer>
    </div>
  );
}
