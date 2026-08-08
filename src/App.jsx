import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  firebaseReady,
  watchChat,
  sendChat,
  watchNews,
  postNewsItem,
  removeNewsItem,
  pinNewsItem,
  removeChatMessage,
  getCoachName,
  setCoachNameStored,
  watchApplications,
  submitApplication,
  watchPromotionWindow,
  setPromotionWindow,
  getWeeklyResult,
  setWeeklyResult,
  addClub300Entry,
  watchClub300Live,
  getTournamentSeeds,
  setTournamentSeeds,
} from "./storage.js";
import { onAuthChange, logoutUser } from "./auth.js";
import LandingPage from "./LandingPage.jsx";
import AdminPanel from "./AdminPanel.jsx";
import AgeGate from "./AgeGate.jsx";
import UserMenu from "./UserMenu.jsx";
import SettingsPanel from "./SettingsPanel.jsx";
import Footer from "./Footer.jsx";
import { authenticator } from "otplib";

// ─────────────────────────────────────────────────────────────
// PAINLESS FOOTBALL ALLIANCE — fan hub
// Live standings/matchups: Sleeper public API
// News + chat: Firebase (see src/firebase-config.js)
// Alliance data (coaching points, records): sheet feed / sampled below
// ─────────────────────────────────────────────────────────────

// League IDs by season. Sleeper issues new league IDs every year, so this is
// the one place to update each summer when the new season's leagues spin up.
// Add earlier seasons here once their IDs are on hand (same shape, one object
// per year) — once a couple of years are in here, a season picker can be
// added to each league's page.
const LEAGUE_HISTORY = {
  2026: {
    NFL: "1316582839847759872",
    USFL: "1316586636028448768",
    XFL: "1316588494914613248",
    SEC: "1316594738958192640",
    "BIG XII": "1317152669235703808",
    ACC: "1317191636379254784",
    TEN: "1317530523035242496",
    SUN: "1317557888784306176",
    SOCO: "1317559700799131648",
    IVY: "1317562012057735168",
    SWAC: "1317574770207789056",
    GLIAC: "1317895570131546112",
    FLHS: "1317921468134232064",
  },
  2025: {
    NFL: "1183970228651790336",
    USFL: "1183250954676449280",
    XFL: "1183572636871495680",
    SEC: "1183802251227922432",
    "BIG XII": "1184161478922457088",
    ACC: "1184163927158579200",
    TEN: "1184162494998659072",
    SUN: "1184163547609038848",
    SOCO: "1185042556622708736",
    IVY: "1185069556594888704",
    SWAC: "1185069998871359488",
    GLIAC: "1185070363708993536",
    FLHS: "1185070724967948288",
  },
  2024: {
    NFL: "1054233793608933376",
    USFL: "1054426792259362816",
    XFL: "1054428330381987840",
    SEC: "1054432690960711680",
    "BIG XII": "1054438496422801408",
    ACC: "1054445165114535936",
    TEN: "1054436923411935232",
    SUN: "1054214327244279808",
    SOCO: "1054447353786179584",
    IVY: "1054448671129014272",
    SWAC: "1054449565149085696",
    GLIAC: "1054450442576519168",
    FLHS: "1054451264907468800",
  },
  2023: {
    NFL: "919396554954412032",
    USFL: "919396344941445120",
    XFL: "919396513015590912",
    SEC: "919396198996353024",
    "BIG XII": "919396044612464640",
    ACC: "919395900932354048",
    TEN: "919395714210394112",
    SUN: "919395393438310400",
    SOCO: "919395035123122176",
    IVY: "919394484612435968",
    SWAC: "919392917653901312",
    GLIAC: "919392125446373376",
    FLHS: "919369950941241344",
    // Pioneer: "919371831558131712" — folded league, year unconfirmed
  },
  // 2022: { ... },
};

const CURRENT_SEASON = 2026;
const NFL_LEAGUE_ID = LEAGUE_HISTORY[CURRENT_SEASON].NFL;

// Years available in the Standings page's season picker — driven straight off
// LEAGUE_HISTORY, so adding a new year there (e.g. 2022, or next year's IDs
// each summer) automatically shows up as a new button with no other changes.
// PFA's playoff format is a Full Classification Bracket (a.k.a. Consolation/
// Placement bracket, related to the Monrad system): winners keep playing
// winners, losers keep playing losers, splitting further each round, until
// every team has a confirmed 1st-through-last rank — never single elimination.
// The Championship and Consolation groups each run this as their own
// separate tournament within the tier.
const SHOW_BRACKETS = true;

const SEASON_OPTIONS = Object.keys(LEAGUE_HISTORY)
  .map(Number)
  .sort((a, b) => b - a);

// Weekly Awards' week picker — regular-season weeks only (1-18), same range
// her sheets use elsewhere; playoff weeks aren't in scope for this feature.
const WEEK_OPTIONS = Array.from({ length: 18 }, (_, i) => i + 1);

// Confirmed final placements (1st through last), transcribed directly from
// Lainey's real playoff-sheet PDFs/screenshots — NOT computed from Sleeper
// data, since Sleeper's own bracket data for this custom full-cascade format
// is unconfirmed (see the console-log check added earlier). Team names here
// are exactly as they appeared that season, since that's what needs to match
// against that season's own fetched standings rows (team display names can
// change between seasons). Add more seasons/tiers here as they're confirmed.
const HISTORICAL_FINAL_ORDER = {
  2025: {
    SUN: [
      "GA State", "Little Rock", "Arlington", "AK State", "S Miss", "App State", "S Alabama", "JMU",
      "GA Southern", "Troy", "Marshall", "ULM", "Texas State", "Old Dominion", "Louisiana", "Carolina",
    ],
    SOCO: [
      "Belmont", "Mercer", "Carolina", "Jax State", "Austin Peay", "Tenn State", "Citadel", "Elon",
      "VMI", "Chattanooga", "Nicholls", "Martin", "E Tenn", "Murray State", "Samford", "Tenn Tech",
    ],
    ACC: [
      "Virginia Tech", "Duke", "Louisville", "Syracuse", "N Carolina", "Notre Dame", "Clemson", "Virginia",
      "SMU", "GA Tech", "Wake Forest", "Pittsburgh", "Florida St", "Miami", "NC State", "Boston College",
    ],
    "BIG XII": [
      "OSU", "S Dakota", "Cincinnati", "N Iowa", "Houston", "BYU", "Iowa State", "Denver",
      "Baylor", "TCU", "Kansas", "N Colorado", "W Virginia", "UCF", "Kansas State", "Texas Tech",
    ],
    NFL: [
      "Tennessee", "LA Rams", "Detroit", "Baltimore", "San Francisco", "Pittsburgh", "Green Bay", "LA Chargers",
      "NY Jets", "Philadelphia", "Miami", "Seattle", "New England", "Arizona", "New Orleans", "Jacksonville",
      "Cincinnati", "Atlanta", "NY Giants", "Indianapolis", "Minnesota", "Las Vegas", "Chicago", "Buffalo",
      "Carolina", "Kansas City", "Dallas", "Houston", "Tampa Bay", "Cleveland", "Washington", "Denver",
    ],
    USFL: [
      "Memphis", "San Antonio", "Washington", "Denver", "Philadelphia", "Los Angeles", "Pittsburgh", "Birmingham",
      "Boston", "New Jersey", "Detroit", "Oklahoma", "Orlando", "Houston", "Michigan", "Jacksonville",
      "Tampa Bay", "Chicago", "Arizona", "Oakland",
    ],
    XFL: [
      "Birmingham", "DC", "Seattle", "Boston", "LAX", "Memphis", "Orlando", "Brooklyn",
      "Tampa Bay", "Dallas", "Omaha", "St Louis", "Houston", "LAW", "Atlanta", "San Francisco",
      "New York", "New Jersey", "Chicago", "Las Vegas",
    ],
    SEC: [
      "South Carolina", "Ole Miss", "Kentucky", "Arkansas", "Texas A&M", "Oklahoma", "Miss State", "Missouri",
      "Florida", "Georgia", "Tennessee", "Vanderbilt", "Alabama", "Auburn", "Texas", "LSU",
    ],
    TEN: [
      "Northwestern", "UCLA", "Washington", "Ohio State", "Cal", "Indiana", "Penn State", "Oregon",
      "Purdue", "Michigan", "Wisconsin", "Illinois", "Maryland", "Utah", "USC", "Rutgers",
    ],
    IVY: [
      "Brown", "Colgate", "Lehigh", "Penn", "Bucknell", "Dartmouth", "Georgetown", "Cornell",
      "Columbia", "Yale", "Holy Cross", "MIT", "Harvard", "Fordham", "Lafayette", "Princeton",
    ],
    GLIAC: [
      "JCU", "Parkside", "Wayne State", "Baldwin", "N Michigan", "Muskingum", "Davenport", "Heidelberg",
      "Mount Union", "Northwood", "Ohio N", "Purdue NW", "Capital", "Ferris State", "Wilmington", "Lake Superior",
    ],
    FLHS: [
      "Western", "Coral Springs", "Boca Raton", "Palmetto", "Miami Beach", "Miami Dade", "West Broward", "Dr Krop",
      "Taravella", "West Boca", "Southwest", "Deerfield", "Coral Glades", "Cypress Bay", "Stoneman", "Miami Senior",
    ],
    SWAC: [
      "Morgan St", "Miss Valley", "Jackson St", "PVAM", "Bethune", "Southern U", "Alcorn", "Florida A&M",
      "Grambling", "SC St", "Alabama A&M", "NC Central", "Alabama St", "Pine Bluff", "TX Southern", "Norfolk St",
    ],
  },
};

// Loose match for confirmed-historical team names against that season's own
// fetched Sleeper rows — case/whitespace-insensitive, and tries a "starts
// with" match too since PDF shorthand ("LA Rams") vs a season's actual
// Sleeper display name ("LA Rams" or "Los Angeles Rams") can vary slightly.
const findRowByName = (rows, name) => {
  if (!rows || !name) return null;
  const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const target = norm(name);
  return (
    rows.find((r) => norm(r.team) === target) ||
    rows.find((r) => norm(r.team).startsWith(target) || target.startsWith(norm(r.team))) ||
    null
  );
};

// Confirmed Round 1 (Week 14) results — the one round we can show with full
// confidence without any bracket-geometry guesswork, since each game is a
// single box directly off the source bracket sheet. Deliberately stops at
// Round 1: later rounds require knowing exactly which box in NFLBracket a
// team lands in, which isn't safe to guess without live-testing the render.


const HISTORICAL_ROUND1 = {
  2025: {
    NFL: {
      playoffs: [
        ["San Francisco", 169.40, "Arizona", 156.40],
        ["LA Rams", 181.80, "Philadelphia", 157.55],
        ["Green Bay", 206.15, "Seattle", 145.05],
        ["Detroit", 126.85, "New Orleans", 123.75],
        ["Tennessee", 200.40, "New England", 165.55],
        ["LA Chargers", 234.35, "Miami", 113.60],
        ["Baltimore", 211.60, "NY Jets", 195.40],
        ["Pittsburgh", 171.80, "Jacksonville", 160.00],
      ],
      consolation: [
        ["Atlanta", 132.50, "Dallas", 126.40],
        ["Chicago", 158.35, "Washington", 129.45],
        ["NY Giants", 148.05, "Carolina", 144.85],
        ["Minnesota", 116.10, "Tampa Bay", 109.75],
        ["Las Vegas", 154.65, "Houston", 109.90],
        ["Cincinnati", 189.95, "Denver", 68.20],
        ["Buffalo", 216.15, "Cleveland", 134.50],
        ["Indianapolis", 141.50, "Kansas City", 135.10],
      ],
    },
    // USFL/XFL are 10-team fields — seeds 1-6 bye through Week 14, so only
    // seeds 7-10 actually play a Round 1 game (2 games per group). The other
    // 6 teams per group just don't have a Round 1 box; they still appear in
    // the final order.
    USFL: {
      playoffs: [
        ["Philadelphia", 240.10, "New Jersey", 194.05],
        ["Washington", 266.40, "Birmingham", 214.20],
      ],
      consolation: [
        ["Houston", 197.90, "Arizona", 133.80],
        ["Detroit", 202.25, "Tampa Bay", 189.80],
      ],
    },
    XFL: {
      playoffs: [
        ["Memphis", 246.50, "Tampa Bay", 125.75],
        ["Seattle", 238.85, "Orlando", 200.15],
      ],
      consolation: [
        ["New Jersey", 158.20, "Chicago", 127.25],
        ["Omaha", 199.35, "Atlanta", 177.15],
      ],
    },
  },
};

const SLEEPER = "https://api.sleeper.app/v1";

// Live coach-tag feed — her admin sheet's Master_Coaches tab, published via
// File > Share > Publish to web > that tab > CSV. Sleeper's API only ever
// returns her raw account name on every roster she owns, so a coach holding
// several teams (the int1/l2/etc. tags in CAREER_STATS) is indistinguishable
// from Sleeper alone. Her sheet's "coach" column already carries the correct
// tag per team, so we read that live instead of asking her to resend a CSV
// every time a tag changes. If this fetch fails (network, or the sheet gets
// unpublished), we fall back to Sleeper's bare name — same behavior as
// before this feed existed, never a hard failure.
const COACH_SHEET_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vSCHiIhEQSvPXRS1anXfhB4PPw6caQ4HEMaRCld1Mi28r0uWtFn5sQyCz-KQElyh738EOBZiLBVHQsc/pub?gid=211173018&single=true&output=csv";

// Minimal RFC4180 CSV parser: handles quoted fields containing commas and
// embedded newlines (her "notes" column has both). Returns row arrays; does
// not assume every row is the same length, since the sheet mixes league
// headers, column headers, coach rows, and blank/summary rows.
function parseCSVRows(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// Every real coach row — in any of the 13 league blocks — carries a roster
// number in a fixed column (index 26) and a tier-block header row directly
// above it whose column 0 is EXACTLY that tier's key ("NFL", "FLHS", etc,
// same strings as TIERS). That's the only reliable structure here — no
// name-matching, no URL-parsing needed for row/tier detection.
//
// REAL BUG FOUND 2026-08-04, been there since this feed was first built:
// the sheet's "roster link" column (index 27) is NOT `.../roster/{numeric
// leagueId}/{rosterId}` like a real Sleeper URL — it's `.../roster/{team or
// league NAME}/{rosterId}`, e.g. ".../roster/New Orleans Saints/12". The
// old code regexed `/\/roster\/(\d+)\/(\d+)/` out of that link expecting a
// numeric leagueId; that pattern can never match a name, so it silently
// returned null on literally every row, every tier, every fetch — the
// entire coachTagsByRosterKey/liveStatsByName system has been returning
// EMPTY since 2026-08-02 without ever throwing or logging anything.
// Confirmed systematic (checked all 13 tiers' first rows, all broken the
// same way), not a one-off typo — this is just how her formula builds the
// link. FIX: don't parse the link at all. The roster NUMBER is already sitting
// in column 26 as a plain integer — use that directly — and key every map
// by TIER instead of leagueId, which is actually an improvement on top of
// the fix: leagueId changes every season (Sleeper reissues them yearly),
// tier keys never do, so this stops needing a re-check every year the old
// keying scheme never would have survived even if it HAD worked.
//
// Returns FOUR maps from ONE pass over the same rows (one fetch serves all):
//  - tagByRosterKey: `${tierKey}:${rosterId}` -> her tagged coach name
//  - rosterLinkByTeamName: lowercased team name -> full roster URL. This is
//    a FALLBACK only — see where it's consumed in TeamProfileModal. Most
//    roster links are computed live from the current season's already-live
//    leagueId + rosterId (see openTeamProfile), which self-updates every
//    season since Sleeper assigns a new league ID each year and the site
//    re-discovers it live. This sheet-derived map only matters for the one
//    path that opens a team profile WITHOUT live roster data attached (the
//    300 Club's historical high-score list, which only ever has a team
//    name) — and even then it beats a hardcoded table, since her sheet gets
//    republished with the new season's links same as everything else here.
//  - liveStatsByName: lowercased tagged coach name -> { promotionScore,
//    currentCP }, columns 9 and 21 (`PromotionScore` / `coaching Pts` in her
//    header row — CURRENT SEASON, distinct from CAREER_STATS's static
//    "Career CP"). Keyed by the exact tagged name (e.g. "pwnrangr int1"),
//    same format as CAREER_STATS's own keys, so allCoachesTable's existing
//    lowerName lookup matches directly with no extra resolution needed.
//    `#DIV/0!`/`#N/A`/blank (unplayed season, every coach preseason) parse
//    to null via parseFloat — the same defensive-parse pattern used
//    throughout this file for her live sheet feeds.
//  - teamNameByRosterKey: `${tierKey}:${rosterId}` -> team name, populated
//    for EVERY row with a team name, including unowned rosters (status
//    "available"/"retired"/etc, no coach). Sleeper itself has no team name
//    for a roster nobody's claimed — this is the only source for one, used
//    as a fallback in buildStandings so an open team shows its real name
//    ("Boca Raton Wolverines") instead of a bare "—" placeholder.
//
// SHEET_TIER_ALIASES — confirmed 2026-08-05 via direct row checks against
// the live sheet: the Master_Coaches sheet's own tier-block labels don't
// always match TIERS' canonical keys. Big Ten's block is headed "BIG10"
// (not "TEN"), Big 12's is "BIG12" (not "BIG XII"), Sun Belt's is "Sun
// Belt" (not "SUN"). Without this, a mismatched block's currentTier never
// gets set, so every row under it is silently skipped — exactly the bug
// that hit Big Ten's open teams (Big 12/Sun Belt had the same latent
// issue, just no current vacancy to expose it). Separate from
// CONF_TO_TIER_KEY below, which aliases a DIFFERENT source's (old
// 300-Club/export data) own different abbreviations.
const SHEET_TIER_ALIASES = { BIG10: "TEN", BIG12: "BIG XII", "Sun Belt": "SUN" };

function parseSheetLookups(csvText) {
  const rows = parseCSVRows(csvText);
  const tagByRosterKey = {};
  const rosterLinkByTeamName = {};
  const liveStatsByName = {};
  const teamNameByRosterKey = {};
  const tierKeySet = new Set(TIERS.map((t) => t.key));
  let currentTier = null;
  for (const row of rows) {
    const rawCol0 = (row[0] || "").trim();
    const col0 = SHEET_TIER_ALIASES[rawCol0] || rawCol0;
    if (tierKeySet.has(col0)) {
      currentTier = col0;
      continue;
    }
    const coach = (row[0] || "").trim();
    const team = (row[1] || "").trim();
    const rosterId = (row[26] || "").trim();
    const rosterLink = row[27] || "";
    if (!currentTier || !rosterId || !rosterLink) continue;
    const key = `${currentTier}:${rosterId}`;
    if (coach) tagByRosterKey[key] = coach;
    if (team && team !== "#N/A") {
      rosterLinkByTeamName[team.toLowerCase()] = rosterLink.trim();
      teamNameByRosterKey[key] = team;
    }
    if (coach) {
      const promotionScore = parseFloat(row[9]);
      const currentCP = parseFloat(row[21]);
      liveStatsByName[coach.toLowerCase()] = {
        promotionScore: Number.isFinite(promotionScore) ? promotionScore : null,
        currentCP: Number.isFinite(currentCP) ? currentCP : null,
      };
    }
  }
  return { tagByRosterKey, rosterLinkByTeamName, liveStatsByName, teamNameByRosterKey };
}

// Career stats from the Admin tab (columns AM:BA), keyed by coach name
// (lowercased). Each name maps to an ARRAY — coaches who've held more than
// one team over their career (across the leagues currently tracked) get a
// separate entry per league, e.g. PwnRangr has both an NFL entry (New
// Orleans Saints) and an XFL entry (Seattle Dragons), with genuinely
// different records. The Coach Profile popup below always matches against
// whichever team the coach currently holds — never a different league's
// numbers — and shows a "no stats on file" note if there's no entry for
// their current team specifically.
const CAREER_STATS = {
  "89redrocket": [{ "tierKey": "SWAC", "team": "—", "stats": { "Career CP": "147.84", "Career Avg CP": "36.96", "Record": "13-21", "Win %": "38.2%", "Total Points": "6325.45", "Avg Pts / Season": "180.92", "Alliance High Score": "0", "Alliance Low Score": "4", "League High Score": "0", "League Low Score": "4", "Best Manager": "-1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "acubes21": [{ "tierKey": "SOCO", "team": "Belmont Bruins", "stats": { "Career CP": "716.17", "Career Avg CP": "179.04", "Record": "44-24", "Win %": "64.7%", "Total Points": "15466.85", "Avg Pts / Season": "221.28", "Alliance High Score": "0", "Alliance Low Score": "1", "League High Score": "8", "League Low Score": "1", "Best Manager": "6", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "3" } }],
  "ahdi": [{ "tierKey": "ACC", "team": "Notre Dame Fighting Irish", "stats": { "Career CP": "149.10", "Career Avg CP": "37.28", "Record": "8-9", "Win %": "47.1%", "Total Points": "3803.75", "Avg Pts / Season": "105.66", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "0", "League Low Score": "0", "Best Manager": "0", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "alexfinnis": [{ "tierKey": "SEC", "team": "Missouri Tigers", "stats": { "Career CP": "730.85", "Career Avg CP": "182.71", "Record": "38-30", "Win %": "55.9%", "Total Points": "14359.25", "Avg Pts / Season": "214.45", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "5", "League Low Score": "0", "Best Manager": "1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "2" } }],
  "alexwilson20": [{ "tierKey": "ACC", "team": "Pittsburgh Panthers", "stats": { "Career CP": "279.00", "Career Avg CP": "69.75", "Record": "22-29", "Win %": "43.1%", "Total Points": "10235.60", "Avg Pts / Season": "193.38", "Alliance High Score": "0", "Alliance Low Score": "21", "League High Score": "16", "League Low Score": "21", "Best Manager": "-2", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "allaccess1": [{ "tierKey": "FLHS", "team": "—", "stats": { "Career CP": "237.02", "Career Avg CP": "59.25", "Record": "20-14", "Win %": "58.8%", "Total Points": "7304.90", "Avg Pts / Season": "209.27", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "4", "League Low Score": "0", "Best Manager": "5", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "alphaone": [{ "tierKey": "USFL", "team": "Jacksonville Bulls", "stats": { "Career CP": "39.89", "Career Avg CP": "19.95", "Record": "5-12", "Win %": "29.4%", "Total Points": "2620.15", "Avg Pts / Season": "72.78", "Alliance High Score": "0", "Alliance Low Score": "2", "League High Score": "0", "League Low Score": "2", "Best Manager": "1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "amkm324": [{ "tierKey": "NFL", "team": "Green Bay Packers", "stats": { "Career CP": "933.29", "Career Avg CP": "233.32", "Record": "44-24", "Win %": "64.7%", "Total Points": "13706.40", "Avg Pts / Season": "196.05", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "3", "League Low Score": "0", "Best Manager": "-2", "Conference Wins": "0", "Division Wins": "2", "Playoff Wins": "4" } }],
  "antimisanthrope": [{ "tierKey": "SUN", "team": "ULM Warhawks", "stats": { "Career CP": "101.99", "Career Avg CP": "25.50", "Record": "13-21", "Win %": "38.2%", "Total Points": "6025.65", "Avg Pts / Season": "172.50", "Alliance High Score": "0", "Alliance Low Score": "2", "League High Score": "0", "League Low Score": "2", "Best Manager": "-3", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "arvot": [{ "tierKey": "SWAC", "team": "Alabama A&M Bulldogs", "stats": { "Career CP": "77.86", "Career Avg CP": "19.46", "Record": "8-9", "Win %": "47.1%", "Total Points": "3565.25", "Avg Pts / Season": "99.03", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "0", "League Low Score": "0", "Best Manager": "-1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "asqxct": [{ "tierKey": "XFL", "team": "Memphis Maniax", "stats": { "Career CP": "642.53", "Career Avg CP": "160.63", "Record": "35-33", "Win %": "51.5%", "Total Points": "13116.35", "Avg Pts / Season": "187.12", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "3", "League Low Score": "0", "Best Manager": "1", "Conference Wins": "2", "Division Wins": "2", "Playoff Wins": "1" } }],
  "austin3x": [{ "tierKey": "SUN", "team": "Arlington Mavericks", "stats": { "Career CP": "173.79", "Career Avg CP": "43.45", "Record": "10-7", "Win %": "58.8%", "Total Points": "3592.50", "Avg Pts / Season": "99.79", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "2", "League Low Score": "0", "Best Manager": "3", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "1" } }],
  "available": [{ "tierKey": "GLIAC", "team": "—", "stats": { "Career CP": "0.00", "Career Avg CP": "0.00", "Record": "—", "Win %": "—", "Total Points": "—", "Avg Pts / Season": "—", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "0", "League Low Score": "0", "Best Manager": "0", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "aziv49": [{ "tierKey": "NFL", "team": "San Francisco 49ers", "stats": { "Career CP": "1020.78", "Career Avg CP": "255.20", "Record": "50-18", "Win %": "73.5%", "Total Points": "13423.10", "Avg Pts / Season": "192.17", "Alliance High Score": "2", "Alliance Low Score": "0", "League High Score": "1", "League Low Score": "0", "Best Manager": "3", "Conference Wins": "3", "Division Wins": "3", "Playoff Wins": "5" } }],
  "aziv49 int": [{ "tierKey": "ACC", "team": "Clemson Tigers", "stats": { "Career CP": "325.79", "Career Avg CP": "81.45", "Record": "18-16", "Win %": "52.9%", "Total Points": "7562.85", "Avg Pts / Season": "216.50", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "4", "League Low Score": "0", "Best Manager": "0", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "babba10101": [{ "tierKey": "IVY", "team": "Penn Quakers", "stats": { "Career CP": "655.40", "Career Avg CP": "163.85", "Record": "39-29", "Win %": "57.4%", "Total Points": "14686.30", "Avg Pts / Season": "210.13", "Alliance High Score": "1", "Alliance Low Score": "3", "League High Score": "2", "League Low Score": "3", "Best Manager": "8", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "2" } }],
  "bbclives": [{ "tierKey": "ACC", "team": "Miami Hurricanes", "stats": { "Career CP": "422.28", "Career Avg CP": "105.57", "Record": "28-40", "Win %": "41.2%", "Total Points": "13260.65", "Avg Pts / Season": "189.77", "Alliance High Score": "0", "Alliance Low Score": "4", "League High Score": "0", "League Low Score": "4", "Best Manager": "1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "bblew52": [{ "tierKey": "SEC", "team": "Georgia Bulldogs", "stats": { "Career CP": "681.30", "Career Avg CP": "170.32", "Record": "33-35", "Win %": "48.5%", "Total Points": "14132.75", "Avg Pts / Season": "201.86", "Alliance High Score": "1", "Alliance Low Score": "0", "League High Score": "1", "League Low Score": "0", "Best Manager": "10", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "2" } }],
  "beardmantv": [{ "tierKey": "SEC", "team": "Auburn Tigers", "stats": { "Career CP": "547.81", "Career Avg CP": "136.95", "Record": "34-34", "Win %": "50.0%", "Total Points": "14220.20", "Avg Pts / Season": "203.52", "Alliance High Score": "0", "Alliance Low Score": "5", "League High Score": "2", "League Low Score": "5", "Best Manager": "-3", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "1" } }],
  "beaster303": [{ "tierKey": "USFL", "team": "Michigan Panthers", "stats": { "Career CP": "306.02", "Career Avg CP": "76.51", "Record": "28-40", "Win %": "41.2%", "Total Points": "12838.70", "Avg Pts / Season": "183.75", "Alliance High Score": "0", "Alliance Low Score": "1", "League High Score": "5", "League Low Score": "1", "Best Manager": "-2", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "beaverius": [{ "tierKey": "SUN", "team": "Louisiana Ragin' Cajuns", "stats": { "Career CP": "346.32", "Career Avg CP": "86.58", "Record": "28-40", "Win %": "41.2%", "Total Points": "12763.65", "Avg Pts / Season": "182.32", "Alliance High Score": "0", "Alliance Low Score": "6", "League High Score": "2", "League Low Score": "6", "Best Manager": "1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "2" } }],
  "benchedballers": [{ "tierKey": "NFL", "team": "Indianapolis Colts", "stats": { "Career CP": "809.54", "Career Avg CP": "202.38", "Record": "43-25", "Win %": "63.2%", "Total Points": "12852.80", "Avg Pts / Season": "184.22", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "3", "League Low Score": "0", "Best Manager": "1", "Conference Wins": "1", "Division Wins": "1", "Playoff Wins": "4" } }],
  "biggypoppa": [{ "tierKey": "BIG XII", "team": "Texas Tech", "stats": { "Career CP": "412.25", "Career Avg CP": "103.06", "Record": "27-41", "Win %": "39.7%", "Total Points": "13090.10", "Avg Pts / Season": "187.31", "Alliance High Score": "0", "Alliance Low Score": "6", "League High Score": "0", "League Low Score": "6", "Best Manager": "0", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "bigpapajohn1311": [{ "tierKey": "SEC", "team": "Arkansas Razorbacks", "stats": { "Career CP": "211.62", "Career Avg CP": "52.90", "Record": "16-18", "Win %": "47.1%", "Total Points": "6988.05", "Avg Pts / Season": "199.69", "Alliance High Score": "0", "Alliance Low Score": "2", "League High Score": "2", "League Low Score": "2", "Best Manager": "-2", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "1" } }, { "tierKey": "TEN", "team": "Arkansas Razorbacks", "stats": { "Career CP": "211.62", "Career Avg CP": "52.90", "Record": "—", "Win %": "—", "Total Points": "—", "Avg Pts / Season": "199.69", "Alliance High Score": "0", "Alliance Low Score": "2", "League High Score": "2", "League Low Score": "2", "Best Manager": "-2", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "1" } }],
  "bjf35": [{ "tierKey": "TEN", "team": "MARYLAND TERPS", "stats": { "Career CP": "414.36", "Career Avg CP": "103.59", "Record": "27-41", "Win %": "39.7%", "Total Points": "11744.95", "Avg Pts / Season": "168.15", "Alliance High Score": "0", "Alliance Low Score": "1", "League High Score": "1", "League Low Score": "1", "Best Manager": "-3", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "boonedoggaf": [{ "tierKey": "SUN", "team": "Georgia Southern Eagles", "stats": { "Career CP": "449.90", "Career Avg CP": "112.47", "Record": "31-37", "Win %": "45.6%", "Total Points": "13380.65", "Avg Pts / Season": "191.44", "Alliance High Score": "1", "Alliance Low Score": "3", "League High Score": "1", "League Low Score": "3", "Best Manager": "-5", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "booshay": [{ "tierKey": "NFL", "team": "Tampa Bay Buccaneers", "stats": { "Career CP": "451.94", "Career Avg CP": "112.99", "Record": "27-41", "Win %": "39.7%", "Total Points": "9815.65", "Avg Pts / Season": "140.24", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "1", "League Low Score": "0", "Best Manager": "6", "Conference Wins": "1", "Division Wins": "1", "Playoff Wins": "0" } }],
  "booyamclovin": [{ "tierKey": "TEN", "team": "Oregon Ducks", "stats": { "Career CP": "485.40", "Career Avg CP": "121.35", "Record": "30-38", "Win %": "44.1%", "Total Points": "13960.75", "Avg Pts / Season": "199.57", "Alliance High Score": "0", "Alliance Low Score": "3", "League High Score": "1", "League Low Score": "3", "Best Manager": "3", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "1" } }],
  "bradlevo": [{ "tierKey": "XFL", "team": "Chicago Enforcers", "stats": { "Career CP": "774.14", "Career Avg CP": "193.54", "Record": "49-19", "Win %": "72.1%", "Total Points": "15126.39", "Avg Pts / Season": "216.25", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "8", "League Low Score": "0", "Best Manager": "2", "Conference Wins": "1", "Division Wins": "1", "Playoff Wins": "5" } }, { "tierKey": "SOCO", "team": "Jax State Gamecocks", "stats": { "Career CP": "774.14", "Career Avg CP": "193.54", "Record": "49-19", "Win %": "72.1%", "Total Points": "15126.39", "Avg Pts / Season": "216.25", "Alliance High Score": "0", "Alliance Low Score": "16", "League High Score": "24", "League Low Score": "16", "Best Manager": "2", "Conference Wins": "1", "Division Wins": "1", "Playoff Wins": "5" } }],
  "broncozzz": [{ "tierKey": "BIG XII", "team": "Kansas JAYhawks", "stats": { "Career CP": "447.59", "Career Avg CP": "111.90", "Record": "27-41", "Win %": "39.7%", "Total Points": "13170.75", "Avg Pts / Season": "188.13", "Alliance High Score": "0", "Alliance Low Score": "2", "League High Score": "1", "League Low Score": "2", "Best Manager": "-4", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "butterfield": [{ "tierKey": "BIG XII", "team": "Cincinnati Bearcats", "stats": { "Career CP": "255.77", "Career Avg CP": "63.94", "Record": "19-15", "Win %": "55.9%", "Total Points": "6946.45", "Avg Pts / Season": "198.26", "Alliance High Score": "0", "Alliance Low Score": "1", "League High Score": "2", "League Low Score": "1", "Best Manager": "0", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "1" } }, { "tierKey": "SOCO", "team": "Tennessee St Tigers", "stats": { "Career CP": "240.20", "Career Avg CP": "60.05", "Record": "19-15", "Win %": "55.9%", "Total Points": "6908.25", "Avg Pts / Season": "197.20", "Alliance High Score": "0", "Alliance Low Score": "1", "League High Score": "1", "League Low Score": "1", "Best Manager": "3", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "calvins22": [{ "tierKey": "NFL", "team": "Arizona Cardinals", "stats": { "Career CP": "869.74", "Career Avg CP": "217.44", "Record": "41-27", "Win %": "60.3%", "Total Points": "12775.20", "Avg Pts / Season": "183.12", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "4", "League Low Score": "0", "Best Manager": "0", "Conference Wins": "0", "Division Wins": "1", "Playoff Wins": "0" } }],
  "casualconsensus int": [{ "tierKey": "TEN", "team": "Illinois Fighting Illini", "stats": { "Career CP": "92.24", "Career Avg CP": "23.06", "Record": "15-19", "Win %": "44.1%", "Total Points": "6386.05", "Avg Pts / Season": "182.85", "Alliance High Score": "0", "Alliance Low Score": "4", "League High Score": "1", "League Low Score": "4", "Best Manager": "-7", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "catinthehat2": [{ "tierKey": "XFL", "team": "Brooklyn Bolts", "stats": { "Career CP": "588.41", "Career Avg CP": "147.10", "Record": "37-31", "Win %": "54.4%", "Total Points": "13800.65", "Avg Pts / Season": "197.37", "Alliance High Score": "0", "Alliance Low Score": "1", "League High Score": "1", "League Low Score": "1", "Best Manager": "3", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "chivoski": [{ "tierKey": "SUN", "team": "Carolina Chanticleers", "stats": { "Career CP": "237.72", "Career Avg CP": "59.43", "Record": "19-32", "Win %": "37.3%", "Total Points": "8812.35", "Avg Pts / Season": "170.01", "Alliance High Score": "0", "Alliance Low Score": "21", "League High Score": "17", "League Low Score": "21", "Best Manager": "-7", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "chorn16": [{ "tierKey": "TEN", "team": "Michigan Wolverines", "stats": { "Career CP": "208.56", "Career Avg CP": "52.14", "Record": "18-16", "Win %": "52.9%", "Total Points": "6932.60", "Avg Pts / Season": "198.43", "Alliance High Score": "0", "Alliance Low Score": "3", "League High Score": "0", "League Low Score": "3", "Best Manager": "-2", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "chrisevans": [{ "tierKey": "IVY", "team": "MIT Engineers", "stats": { "Career CP": "385.16", "Career Avg CP": "96.29", "Record": "28-40", "Win %": "41.2%", "Total Points": "13834.20", "Avg Pts / Season": "197.92", "Alliance High Score": "0", "Alliance Low Score": "2", "League High Score": "1", "League Low Score": "2", "Best Manager": "-2", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "chuckiv": [{ "tierKey": "NFL", "team": "Dallas Cowboys", "stats": { "Career CP": "821.05", "Career Avg CP": "205.26", "Record": "39-29", "Win %": "57.4%", "Total Points": "11403.20", "Avg Pts / Season": "162.95", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "0", "League Low Score": "0", "Best Manager": "3", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "3" } }],
  "coopdaddy510": [{ "tierKey": "BIG XII", "team": "Northern Iowa Panthers", "stats": { "Career CP": "546.90", "Career Avg CP": "136.73", "Record": "31-20", "Win %": "60.8%", "Total Points": "10839.05", "Avg Pts / Season": "204.62", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "1", "League Low Score": "0", "Best Manager": "1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "4" } }],
  "cozzin": [{ "tierKey": "SOCO", "team": "Tenn Tech Eagles", "stats": { "Career CP": "273.98", "Career Avg CP": "68.50", "Record": "21-30", "Win %": "41.2%", "Total Points": "9456.40", "Avg Pts / Season": "178.78", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "1", "League Low Score": "0", "Best Manager": "-1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "1" } }],
  "crb2121": [{ "tierKey": "SUN", "team": "South Alabama Jaguars", "stats": { "Career CP": "283.44", "Career Avg CP": "70.86", "Record": "21-13", "Win %": "61.8%", "Total Points": "7521.25", "Avg Pts / Season": "214.83", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "3", "League Low Score": "0", "Best Manager": "4", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "cre8t1v3": [{ "tierKey": "XFL", "team": "Los Angeles Wildcats", "stats": { "Career CP": "604.49", "Career Avg CP": "151.12", "Record": "34-32", "Win %": "51.5%", "Total Points": "13575.49", "Avg Pts / Season": "202.67", "Alliance High Score": "0", "Alliance Low Score": "3", "League High Score": "7", "League Low Score": "3", "Best Manager": "-1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "2" } }],
  "cre8t1v3 int": [{ "tierKey": "BIG XII", "team": "North Colorado Bears", "stats": { "Career CP": "604.49", "Career Avg CP": "151.12", "Record": "34-32", "Win %": "51.5%", "Total Points": "13575.49", "Avg Pts / Season": "202.67", "Alliance High Score": "0", "Alliance Low Score": "3", "League High Score": "7", "League Low Score": "3", "Best Manager": "-1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "2" } }],
  "cspeese22": [{ "tierKey": "NFL", "team": "Carolina Panthers", "stats": { "Career CP": "421.61", "Career Avg CP": "105.40", "Record": "27-24", "Win %": "52.9%", "Total Points": "11191.20", "Avg Pts / Season": "211.12", "Alliance High Score": "1", "Alliance Low Score": "5", "League High Score": "7", "League Low Score": "5", "Best Manager": "6", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "2" } }],
  "curlyz28": [{ "tierKey": "USFL", "team": "Philadelphia Stars", "stats": { "Career CP": "782.99", "Career Avg CP": "195.75", "Record": "37-31", "Win %": "54.4%", "Total Points": "13709.05", "Avg Pts / Season": "195.90", "Alliance High Score": "0", "Alliance Low Score": "2", "League High Score": "1", "League Low Score": "2", "Best Manager": "-2", "Conference Wins": "1", "Division Wins": "1", "Playoff Wins": "2" } }],
  "dabouse": [{ "tierKey": "IVY", "team": "Princeton Tigers", "stats": { "Career CP": "92.71", "Career Avg CP": "23.18", "Record": "7-10", "Win %": "41.2%", "Total Points": "3200.40", "Avg Pts / Season": "88.90", "Alliance High Score": "0", "Alliance Low Score": "4", "League High Score": "0", "League Low Score": "4", "Best Manager": "-1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "daniel7696": [{ "tierKey": "IVY", "team": "Fordham Rams", "stats": { "Career CP": "240.45", "Career Avg CP": "60.11", "Record": "22-34", "Win %": "39.3%", "Total Points": "12329.00", "Avg Pts / Season": "176.55", "Alliance High Score": "1", "Alliance Low Score": "28", "League High Score": "17", "League Low Score": "28", "Best Manager": "-5", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "db091391": [{ "tierKey": "SEC", "team": "Vanderbilt Commodores", "stats": { "Career CP": "668.02", "Career Avg CP": "167.00", "Record": "37-31", "Win %": "54.4%", "Total Points": "14621.55", "Avg Pts / Season": "209.07", "Alliance High Score": "0", "Alliance Low Score": "1", "League High Score": "3", "League Low Score": "1", "Best Manager": "1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "4" } }],
  "dbgiants": [{ "tierKey": "SOCO", "team": "Murray State Racers", "stats": { "Career CP": "188.03", "Career Avg CP": "47.01", "Record": "22-29", "Win %": "43.1%", "Total Points": "9395.45", "Avg Pts / Season": "177.76", "Alliance High Score": "0", "Alliance Low Score": "5", "League High Score": "0", "League Low Score": "5", "Best Manager": "-1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "diego777": [{ "tierKey": "NFL", "team": "Pittsburgh Steelers", "stats": { "Career CP": "847.38", "Career Avg CP": "211.85", "Record": "44-24", "Win %": "64.7%", "Total Points": "13959.70", "Avg Pts / Season": "200.01", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "2", "League Low Score": "0", "Best Manager": "0", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "4" } }],
  "dilly314": [{ "tierKey": "IVY", "team": "Georgetown Hoyas", "stats": { "Career CP": "699.04", "Career Avg CP": "174.76", "Record": "40-28", "Win %": "58.8%", "Total Points": "14803.20", "Avg Pts / Season": "211.76", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "5", "League Low Score": "0", "Best Manager": "8", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "3" } }],
  "dirtybyrd30": [{ "tierKey": "USFL", "team": "Chicago Blitz", "stats": { "Career CP": "811.22", "Career Avg CP": "202.80", "Record": "50-18", "Win %": "73.5%", "Total Points": "16752.30", "Avg Pts / Season": "239.39", "Alliance High Score": "2", "Alliance Low Score": "1", "League High Score": "12", "League Low Score": "1", "Best Manager": "2", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "4" } }, { "tierKey": "XFL", "team": "Dallas Renegades", "stats": { "Career CP": "136.58", "Career Avg CP": "34.15", "Record": "9-8", "Win %": "52.9%", "Total Points": "3572.95", "Avg Pts / Season": "99.25", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "1", "League Low Score": "0", "Best Manager": "-1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }, { "tierKey": "SWAC", "team": "Jackson State Tigers", "stats": { "Career CP": "811.22", "Career Avg CP": "202.80", "Record": "50-18", "Win %": "73.5%", "Total Points": "16752.30", "Avg Pts / Season": "239.39", "Alliance High Score": "2", "Alliance Low Score": "1", "League High Score": "12", "League Low Score": "1", "Best Manager": "2", "Conference Wins": "1", "Division Wins": "0", "Playoff Wins": "4" } }],
  "djmooremvp": [{ "tierKey": "GLIAC", "team": "Purdue NW Pride", "stats": { "Career CP": "257.08", "Career Avg CP": "64.27", "Record": "19-32", "Win %": "37.3%", "Total Points": "9621.60", "Avg Pts / Season": "181.42", "Alliance High Score": "0", "Alliance Low Score": "8", "League High Score": "1", "League Low Score": "8", "Best Manager": "5", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "1" } }],
  "dleggett": [{ "tierKey": "BIG XII", "team": "West Virgnia Mountaineers", "stats": { "Career CP": "576.83", "Career Avg CP": "144.21", "Record": "36-32", "Win %": "52.9%", "Total Points": "13445.55", "Avg Pts / Season": "192.40", "Alliance High Score": "0", "Alliance Low Score": "1", "League High Score": "3", "League Low Score": "1", "Best Manager": "5", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "2" } }],
  "dommez": [{ "tierKey": "SUN", "team": "Old Dominion Monarchs", "stats": { "Career CP": "35.70", "Career Avg CP": "8.92", "Record": "5-12", "Win %": "29.4%", "Total Points": "3068.70", "Avg Pts / Season": "85.24", "Alliance High Score": "0", "Alliance Low Score": "1", "League High Score": "0", "League Low Score": "1", "Best Manager": "-1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "donotatme": [{ "tierKey": "NFL", "team": "New York Giants", "stats": { "Career CP": "676.00", "Career Avg CP": "169.00", "Record": "32-35", "Win %": "47.8%", "Total Points": "10946.25", "Avg Pts / Season": "156.18", "Alliance High Score": "0", "Alliance Low Score": "4", "League High Score": "0", "League Low Score": "4", "Best Manager": "-3", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "2" } }],
  "doryb88": [{ "tierKey": "XFL", "team": "New Jersey Hitmen", "stats": { "Career CP": "470.48", "Career Avg CP": "117.62", "Record": "28-40", "Win %": "41.2%", "Total Points": "12548.44", "Avg Pts / Season": "179.62", "Alliance High Score": "0", "Alliance Low Score": "6", "League High Score": "1", "League Low Score": "6", "Best Manager": "0", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "1" } }],
  "drewm1603": [{ "tierKey": "NFL", "team": "Los Angeles Rams", "stats": { "Career CP": "901.62", "Career Avg CP": "225.40", "Record": "41-27", "Win %": "60.3%", "Total Points": "11384.30", "Avg Pts / Season": "162.67", "Alliance High Score": "0", "Alliance Low Score": "1", "League High Score": "4", "League Low Score": "1", "Best Manager": "-1", "Conference Wins": "2", "Division Wins": "0", "Playoff Wins": "4" } }],
  "drewm1603 int": [{ "tierKey": "SEC", "team": "Florida Gators", "stats": { "Career CP": "144.94", "Career Avg CP": "36.23", "Record": "11-6", "Win %": "64.7%", "Total Points": "3484.30", "Avg Pts / Season": "96.79", "Alliance High Score": "0", "Alliance Low Score": "1", "League High Score": "2", "League Low Score": "1", "Best Manager": "0", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "drunkfootball": [{ "tierKey": "BIG XII", "team": "South Dakota State", "stats": { "Career CP": "663.84", "Career Avg CP": "165.96", "Record": "36-32", "Win %": "52.9%", "Total Points": "14435.40", "Avg Pts / Season": "206.12", "Alliance High Score": "1", "Alliance Low Score": "1", "League High Score": "7", "League Low Score": "1", "Best Manager": "-3", "Conference Wins": "1", "Division Wins": "1", "Playoff Wins": "4" } }],
  "dylan3380": [{ "tierKey": "ACC", "team": "Florida State Seminoles", "stats": { "Career CP": "654.12", "Career Avg CP": "163.53", "Record": "40-28", "Win %": "58.8%", "Total Points": "14854.10", "Avg Pts / Season": "212.56", "Alliance High Score": "1", "Alliance Low Score": "2", "League High Score": "6", "League Low Score": "2", "Best Manager": "-3", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "3" } }],
  "edinburghfins": [{ "tierKey": "SOCO", "team": "Samford Bulldogs", "stats": { "Career CP": "126.43", "Career Avg CP": "31.61", "Record": "18-16", "Win %": "52.9%", "Total Points": "7323.80", "Avg Pts / Season": "209.87", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "1", "League Low Score": "0", "Best Manager": "2", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "edixon2": [{ "tierKey": "TEN", "team": "THE Ohio State Buckeyes", "stats": { "Career CP": "257.50", "Career Avg CP": "64.38", "Record": "15-19", "Win %": "44.1%", "Total Points": "7150.74", "Avg Pts / Season": "204.60", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "2", "League Low Score": "0", "Best Manager": "2", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "1" } }],
  "edixon2 l": [{ "tierKey": "GLIAC", "team": "Baldwin Yellow Jackets", "stats": { "Career CP": "257.50", "Career Avg CP": "64.38", "Record": "15-19", "Win %": "44.1%", "Total Points": "7150.74", "Avg Pts / Season": "204.60", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "2", "League Low Score": "0", "Best Manager": "2", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "1" } }],
  "evanthomas536": [{ "tierKey": "GLIAC", "team": "Northwood Timberwolves", "stats": { "Career CP": "301.69", "Career Avg CP": "75.42", "Record": "26-42", "Win %": "38.2%", "Total Points": "12723.65", "Avg Pts / Season": "182.04", "Alliance High Score": "0", "Alliance Low Score": "14", "League High Score": "1", "League Low Score": "14", "Best Manager": "-5", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "fantasytren": [{ "tierKey": "SOCO", "team": "Mercer Bears", "stats": { "Career CP": "425.79", "Career Avg CP": "106.45", "Record": "28-40", "Win %": "41.2%", "Total Points": "13441.30", "Avg Pts / Season": "192.07", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "1", "League Low Score": "0", "Best Manager": "3", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "2" } }],
  "fecato": [{ "tierKey": "GLIAC", "team": "Mount Union Raiders", "stats": { "Career CP": "421.76", "Career Avg CP": "105.44", "Record": "27-41", "Win %": "39.7%", "Total Points": "13097.90", "Avg Pts / Season": "196.07", "Alliance High Score": "0", "Alliance Low Score": "4", "League High Score": "1", "League Low Score": "4", "Best Manager": "2", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "2" } }],
  "fin3": [{ "tierKey": "USFL", "team": "Pittsburgh Maulers", "stats": { "Career CP": "829.08", "Career Avg CP": "207.27", "Record": "44-24", "Win %": "64.7%", "Total Points": "14349.70", "Avg Pts / Season": "205.20", "Alliance High Score": "0", "Alliance Low Score": "1", "League High Score": "5", "League Low Score": "1", "Best Manager": "8", "Conference Wins": "0", "Division Wins": "1", "Playoff Wins": "1" } }],
  "finnbar3": [{ "tierKey": "NFL", "team": "Detroit Lions", "stats": { "Career CP": "789.86", "Career Avg CP": "197.47", "Record": "41-27", "Win %": "60.3%", "Total Points": "13207.14", "Avg Pts / Season": "188.61", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "7", "League Low Score": "0", "Best Manager": "1", "Conference Wins": "1", "Division Wins": "1", "Playoff Wins": "3" } }],
  "firephool": [{ "tierKey": "NFL", "team": "Washington Commanders", "stats": { "Career CP": "611.91", "Career Avg CP": "152.98", "Record": "32-36", "Win %": "47.1%", "Total Points": "13655.50", "Avg Pts / Season": "195.32", "Alliance High Score": "15", "Alliance Low Score": "4", "League High Score": "3", "League Low Score": "4", "Best Manager": "2", "Conference Wins": "1", "Division Wins": "0", "Playoff Wins": "5" } }],
  "foggybuckets": [{ "tierKey": "NFL", "team": "New York Jets", "stats": { "Career CP": "930.99", "Career Avg CP": "232.75", "Record": "49-19", "Win %": "72.1%", "Total Points": "13614.70", "Avg Pts / Season": "194.61", "Alliance High Score": "2", "Alliance Low Score": "0", "League High Score": "9", "League Low Score": "0", "Best Manager": "4", "Conference Wins": "2", "Division Wins": "1", "Playoff Wins": "5" } }],
  "folta21": [{ "tierKey": "USFL", "team": "Detroit Drive", "stats": { "Career CP": "251.95", "Career Avg CP": "62.99", "Record": "19-15", "Win %": "55.9%", "Total Points": "6859.65", "Avg Pts / Season": "196.55", "Alliance High Score": "0", "Alliance Low Score": "1", "League High Score": "1", "League Low Score": "1", "Best Manager": "-3", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }, { "tierKey": "SWAC", "team": "S.C. State Bulldogs", "stats": { "Career CP": "220.17", "Career Avg CP": "55.04", "Record": "20-14", "Win %": "58.8%", "Total Points": "7185.25", "Avg Pts / Season": "205.59", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "1", "League Low Score": "0", "Best Manager": "-1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "folta21 int": [{ "tierKey": "SEC", "team": "Texas A & M Aggies", "stats": { "Career CP": "174.86", "Career Avg CP": "43.72", "Record": "11-6", "Win %": "64.7%", "Total Points": "3748.95", "Avg Pts / Season": "104.14", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "1", "League Low Score": "0", "Best Manager": "0", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "garcia925": [{ "tierKey": "IVY", "team": "Lehigh Mountain Hawks", "stats": { "Career CP": "513.09", "Career Avg CP": "128.27", "Record": "39-29", "Win %": "57.4%", "Total Points": "14901.05", "Avg Pts / Season": "213.14", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "6", "League Low Score": "0", "Best Manager": "0", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "1" } }],
  "garmstrong2002": [{ "tierKey": "SEC", "team": "Tennessee Volunteers", "stats": { "Career CP": "528.49", "Career Avg CP": "132.12", "Record": "29-39", "Win %": "42.6%", "Total Points": "12881.85", "Avg Pts / Season": "193.85", "Alliance High Score": "0", "Alliance Low Score": "4", "League High Score": "1", "League Low Score": "4", "Best Manager": "2", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "garrettbff": [{ "tierKey": "XFL", "team": "Atlanta Legends", "stats": { "Career CP": "434.65", "Career Avg CP": "108.66", "Record": "31-37", "Win %": "45.6%", "Total Points": "12664.95", "Avg Pts / Season": "181.35", "Alliance High Score": "0", "Alliance Low Score": "12", "League High Score": "1", "League Low Score": "12", "Best Manager": "0", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "garrettbff int": [{ "tierKey": "BIG XII", "team": "BYU Cougars", "stats": { "Career CP": "434.65", "Career Avg CP": "108.66", "Record": "31-37", "Win %": "45.6%", "Total Points": "12664.95", "Avg Pts / Season": "181.35", "Alliance High Score": "0", "Alliance Low Score": "12", "League High Score": "1", "League Low Score": "12", "Best Manager": "0", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "gavdjedi": [{ "tierKey": "IVY", "team": "Lafayette Leopards", "stats": { "Career CP": "223.27", "Career Avg CP": "55.82", "Record": "26-42", "Win %": "38.2%", "Total Points": "13151.75", "Avg Pts / Season": "187.97", "Alliance High Score": "0", "Alliance Low Score": "5", "League High Score": "0", "League Low Score": "5", "Best Manager": "2", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "germybeast": [{ "tierKey": "USFL", "team": "Boston Breakers", "stats": { "Career CP": "780.91", "Career Avg CP": "195.23", "Record": "39-29", "Win %": "57.4%", "Total Points": "13965.05", "Avg Pts / Season": "199.86", "Alliance High Score": "0", "Alliance Low Score": "17", "League High Score": "20", "League Low Score": "17", "Best Manager": "6", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "1" } }],
  "glang727": [{ "tierKey": "SWAC", "team": "Grambling State Tigers", "stats": { "Career CP": "518.22", "Career Avg CP": "129.55", "Record": "36-32", "Win %": "52.9%", "Total Points": "14586.85", "Avg Pts / Season": "208.48", "Alliance High Score": "2", "Alliance Low Score": "0", "League High Score": "1", "League Low Score": "0", "Best Manager": "1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "4" } }],
  "greek11 l": [{ "tierKey": "GLIAC", "team": "Heidelberg StudentPrinces", "stats": { "Career CP": "152.13", "Career Avg CP": "38.03", "Record": "16-18", "Win %": "47.1%", "Total Points": "6565.40", "Avg Pts / Season": "187.76", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "0", "League Low Score": "0", "Best Manager": "-4", "Conference Wins": "1", "Division Wins": "0", "Playoff Wins": "0" } }],
  "harold2576": [{ "tierKey": "GLIAC", "team": "Davenport Panthers", "stats": { "Career CP": "532.67", "Career Avg CP": "133.17", "Record": "37-14", "Win %": "72.5%", "Total Points": "11581.30", "Avg Pts / Season": "218.69", "Alliance High Score": "0", "Alliance Low Score": "1", "League High Score": "12", "League Low Score": "1", "Best Manager": "3", "Conference Wins": "1", "Division Wins": "0", "Playoff Wins": "3" } }],
  "harvey28": [{ "tierKey": "NFL", "team": "Tennessee Titans", "stats": { "Career CP": "811.43", "Career Avg CP": "202.86", "Record": "44-24", "Win %": "64.7%", "Total Points": "12632.05", "Avg Pts / Season": "181.75", "Alliance High Score": "0", "Alliance Low Score": "8", "League High Score": "3", "League Low Score": "8", "Best Manager": "2", "Conference Wins": "2", "Division Wins": "1", "Playoff Wins": "9" } }, { "tierKey": "XFL", "team": "—", "stats": { "Career CP": "26.80", "Career Avg CP": "6.70", "Record": "—", "Win %": "—", "Total Points": "—", "Avg Pts / Season": "145.68", "Alliance High Score": "0", "Alliance Low Score": "1", "League High Score": "0", "League Low Score": "1", "Best Manager": "-6", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "huibuh": [{ "tierKey": "NFL", "team": "Oakland Raiders", "stats": { "Career CP": "946.61", "Career Avg CP": "236.65", "Record": "41-27", "Win %": "60.3%", "Total Points": "12614.50", "Avg Pts / Season": "180.23", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "11", "League Low Score": "0", "Best Manager": "5", "Conference Wins": "3", "Division Wins": "3", "Playoff Wins": "6" } }],
  "illustrious_fox_1": [{ "tierKey": "TEN", "team": "—", "stats": { "Career CP": "744.41", "Career Avg CP": "186.10", "Record": "—", "Win %": "—", "Total Points": "—", "Avg Pts / Season": "212.54", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "5", "League Low Score": "0", "Best Manager": "0", "Conference Wins": "1", "Division Wins": "1", "Playoff Wins": "2" } }],
  "iloveolave": [{ "tierKey": "SWAC", "team": "Princeton Tigers", "stats": { "Career CP": "92.71", "Career Avg CP": "23.18", "Record": "—", "Win %": "—", "Total Points": "—", "Avg Pts / Season": "88.90", "Alliance High Score": "0", "Alliance Low Score": "4", "League High Score": "0", "League Low Score": "4", "Best Manager": "-1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "jamie04": [{ "tierKey": "BIG XII", "team": "Houston Cougars", "stats": { "Career CP": "248.88", "Career Avg CP": "62.22", "Record": "20-14", "Win %": "58.8%", "Total Points": "7230.95", "Avg Pts / Season": "206.71", "Alliance High Score": "0", "Alliance Low Score": "1", "League High Score": "3", "League Low Score": "1", "Best Manager": "3", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "3" } }, { "tierKey": "SOCO", "team": "Tennessee Martin Skyhawks", "stats": { "Career CP": "258.19", "Career Avg CP": "64.55", "Record": "18-16", "Win %": "52.9%", "Total Points": "7330.60", "Avg Pts / Season": "209.47", "Alliance High Score": "0", "Alliance Low Score": "1", "League High Score": "3", "League Low Score": "1", "Best Manager": "1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "3" } }],
  "jaquise": [{ "tierKey": "SOCO", "team": "Austin Peay Governors", "stats": { "Career CP": "566.33", "Career Avg CP": "141.58", "Record": "40-28", "Win %": "58.8%", "Total Points": "15087.00", "Avg Pts / Season": "215.64", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "8", "League Low Score": "0", "Best Manager": "4", "Conference Wins": "1", "Division Wins": "1", "Playoff Wins": "0" } }],
  "jay21177": [{ "tierKey": "IVY", "team": "Yale Bulldogs", "stats": { "Career CP": "499.67", "Career Avg CP": "124.92", "Record": "27-41", "Win %": "39.7%", "Total Points": "13596.25", "Avg Pts / Season": "194.64", "Alliance High Score": "0", "Alliance Low Score": "5", "League High Score": "1", "League Low Score": "5", "Best Manager": "-2", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "2" } }],
  "jjbinc int": [{ "tierKey": "SOCO", "team": "VMI Keydets", "stats": { "Career CP": "182.33", "Career Avg CP": "45.58", "Record": "16-18", "Win %": "47.1%", "Total Points": "6624.60", "Avg Pts / Season": "189.62", "Alliance High Score": "1", "Alliance Low Score": "6", "League High Score": "2", "League Low Score": "6", "Best Manager": "-2", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }, { "tierKey": "GLIAC", "team": "Lake Superior Lakers", "stats": { "Career CP": "102.13", "Career Avg CP": "25.53", "Record": "12-22", "Win %": "35.3%", "Total Points": "6631.95", "Avg Pts / Season": "190.08", "Alliance High Score": "1", "Alliance Low Score": "19", "League High Score": "17", "League Low Score": "19", "Best Manager": "-5", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "jjbinc l": [{ "tierKey": "FLHS", "team": "—", "stats": { "Career CP": "263.08", "Career Avg CP": "65.77", "Record": "—", "Win %": "—", "Total Points": "—", "Avg Pts / Season": "204.26", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "3", "League Low Score": "0", "Best Manager": "1", "Conference Wins": "1", "Division Wins": "2", "Playoff Wins": "1" } }],
  "jmullen175": [{ "tierKey": "ACC", "team": "—", "stats": { "Career CP": "106.56", "Career Avg CP": "26.64", "Record": "9-8", "Win %": "52.9%", "Total Points": "3413.95", "Avg Pts / Season": "94.83", "Alliance High Score": "0", "Alliance Low Score": "2", "League High Score": "1", "League Low Score": "2", "Best Manager": "0", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "johnjohn882": [{ "tierKey": "ACC", "team": "Boston College Eagles", "stats": { "Career CP": "430.91", "Career Avg CP": "107.73", "Record": "28-40", "Win %": "41.2%", "Total Points": "12651.30", "Avg Pts / Season": "180.73", "Alliance High Score": "0", "Alliance Low Score": "10", "League High Score": "3", "League Low Score": "10", "Best Manager": "-7", "Conference Wins": "1", "Division Wins": "1", "Playoff Wins": "0" } }],
  "johnzy4": [{ "tierKey": "SOCO", "team": "Chatanooga Mocs", "stats": { "Career CP": "161.77", "Career Avg CP": "40.44", "Record": "—", "Win %": "—", "Total Points": "—", "Avg Pts / Season": "188.53", "Alliance High Score": "1", "Alliance Low Score": "1", "League High Score": "6", "League Low Score": "6", "Best Manager": "-14", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "1" } }],
  "jorgeortiz11": [{ "tierKey": "NFL", "team": "Kansas City Chiefs", "stats": { "Career CP": "274.90", "Career Avg CP": "68.73", "Record": "18-16", "Win %": "52.9%", "Total Points": "7336.45", "Avg Pts / Season": "209.77", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "4", "League Low Score": "0", "Best Manager": "0", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "3" } }],
  "josssock": [{ "tierKey": "NFL", "team": "New England Patriots", "stats": { "Career CP": "962.18", "Career Avg CP": "240.55", "Record": "47-21", "Win %": "69.1%", "Total Points": "12802.65", "Avg Pts / Season": "182.78", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "9", "League Low Score": "0", "Best Manager": "-1", "Conference Wins": "0", "Division Wins": "2", "Playoff Wins": "5" } }],
  "justin_white": [{ "tierKey": "SWAC", "team": "—", "stats": { "Career CP": "0.00", "Career Avg CP": "0.00", "Record": "—", "Win %": "—", "Total Points": "—", "Avg Pts / Season": "—", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "0", "League Low Score": "0", "Best Manager": "0", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "juugking": [{ "tierKey": "BIG XII", "team": "Iowa State Cyclones", "stats": { "Career CP": "800.43", "Career Avg CP": "200.11", "Record": "44-24", "Win %": "64.7%", "Total Points": "15379.80", "Avg Pts / Season": "219.60", "Alliance High Score": "1", "Alliance Low Score": "1", "League High Score": "11", "League Low Score": "1", "Best Manager": "4", "Conference Wins": "1", "Division Wins": "0", "Playoff Wins": "4" } }],
  "jvl007": [{ "tierKey": "IVY", "team": "Cornell Big Red", "stats": { "Career CP": "491.79", "Career Avg CP": "122.95", "Record": "34-34", "Win %": "50.0%", "Total Points": "13980.55", "Avg Pts / Season": "200.03", "Alliance High Score": "0", "Alliance Low Score": "5", "League High Score": "2", "League Low Score": "5", "Best Manager": "-6", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "3" } }],
  "jweadon": [{ "tierKey": "SEC", "team": "Texas Longhorns", "stats": { "Career CP": "447.91", "Career Avg CP": "111.98", "Record": "30-38", "Win %": "44.1%", "Total Points": "13377.80", "Avg Pts / Season": "191.43", "Alliance High Score": "0", "Alliance Low Score": "9", "League High Score": "5", "League Low Score": "9", "Best Manager": "0", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "1" } }],
  "jwilmot": [{ "tierKey": "NFL", "team": "Miami Dolphins", "stats": { "Career CP": "719.22", "Career Avg CP": "179.80", "Record": "36-32", "Win %": "52.9%", "Total Points": "11108.70", "Avg Pts / Season": "158.88", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "1", "League Low Score": "0", "Best Manager": "2", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "kendoll92": [{ "tierKey": "SUN", "team": "Georgia State Panthers", "stats": { "Career CP": "800.43", "Career Avg CP": "200.11", "Record": "44-24", "Win %": "64.7%", "Total Points": "15379.80", "Avg Pts / Season": "219.60", "Alliance High Score": "1", "Alliance Low Score": "1", "League High Score": "11", "League Low Score": "1", "Best Manager": "4", "Conference Wins": "1", "Division Wins": "0", "Playoff Wins": "4" } }],
  "kisser22": [{ "tierKey": "SUN", "team": "Texas State Bobcats", "stats": { "Career CP": "13.85", "Career Avg CP": "3.46", "Record": "4-13", "Win %": "23.5%", "Total Points": "2837.10", "Avg Pts / Season": "78.81", "Alliance High Score": "0", "Alliance Low Score": "3", "League High Score": "0", "League Low Score": "3", "Best Manager": "-5", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "klowntown": [{ "tierKey": "FLHS", "team": "West Boca Raton Bulls", "stats": { "Career CP": "338.43", "Career Avg CP": "84.61", "Record": "30-38", "Win %": "44.1%", "Total Points": "12579.00", "Avg Pts / Season": "180.00", "Alliance High Score": "0", "Alliance Low Score": "4", "League High Score": "0", "League Low Score": "4", "Best Manager": "0", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "1" } }],
  "koala530": [{ "tierKey": "SEC", "team": "Miss State Bulldogs", "stats": { "Career CP": "153.04", "Career Avg CP": "38.26", "Record": "12-5", "Win %": "70.6%", "Total Points": "3813.55", "Avg Pts / Season": "105.93", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "2", "League Low Score": "0", "Best Manager": "1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "1" } }, { "tierKey": "FLHS", "team": "Miss State Bulldogs", "stats": { "Career CP": "153.04", "Career Avg CP": "38.26", "Record": "—", "Win %": "—", "Total Points": "—", "Avg Pts / Season": "105.93", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "2", "League Low Score": "0", "Best Manager": "1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "1" } }],
  "kshooter15": [{ "tierKey": "GLIAC", "team": "Ferris State Bulldogs", "stats": { "Career CP": "491.89", "Career Avg CP": "122.97", "Record": "37-31", "Win %": "54.4%", "Total Points": "14133.70", "Avg Pts / Season": "210.81", "Alliance High Score": "1", "Alliance Low Score": "0", "League High Score": "3", "League Low Score": "0", "Best Manager": "2", "Conference Wins": "1", "Division Wins": "1", "Playoff Wins": "0" } }],
  "landlords": [{ "tierKey": "XFL", "team": "Boston Brawlers", "stats": { "Career CP": "672.50", "Career Avg CP": "168.12", "Record": "36-32", "Win %": "52.9%", "Total Points": "13368.90", "Avg Pts / Season": "191.21", "Alliance High Score": "0", "Alliance Low Score": "1", "League High Score": "2", "League Low Score": "1", "Best Manager": "-1", "Conference Wins": "1", "Division Wins": "1", "Playoff Wins": "1" } }],
  "landshark18": [{ "tierKey": "NFL", "team": "Baltimore Ravens", "stats": { "Career CP": "893.38", "Career Avg CP": "223.34", "Record": "37-28", "Win %": "56.9%", "Total Points": "11712.80", "Avg Pts / Season": "167.17", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "5", "League Low Score": "0", "Best Manager": "5", "Conference Wins": "1", "Division Wins": "3", "Playoff Wins": "3" } }],
  "leorapoli": [{ "tierKey": "XFL", "team": "—", "stats": { "Career CP": "65.25", "Career Avg CP": "16.31", "Record": "—", "Win %": "—", "Total Points": "—", "Avg Pts / Season": "96.31", "Alliance High Score": "0", "Alliance Low Score": "1", "League High Score": "2", "League Low Score": "1", "Best Manager": "1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }, { "tierKey": "FLHS", "team": "—", "stats": { "Career CP": "65.25", "Career Avg CP": "16.31", "Record": "—", "Win %": "—", "Total Points": "—", "Avg Pts / Season": "96.31", "Alliance High Score": "0", "Alliance Low Score": "1", "League High Score": "2", "League Low Score": "1", "Best Manager": "1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "lightning77": [{ "tierKey": "USFL", "team": "Tampa Bay Bandits", "stats": { "Career CP": "335.57", "Career Avg CP": "83.89", "Record": "24-44", "Win %": "35.3%", "Total Points": "9651.50", "Avg Pts / Season": "137.58", "Alliance High Score": "0", "Alliance Low Score": "3", "League High Score": "0", "League Low Score": "3", "Best Manager": "1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "mambasdisciples": [{ "tierKey": "SWAC", "team": "PVAMU Panthers", "stats": { "Career CP": "622.60", "Career Avg CP": "155.65", "Record": "44-24", "Win %": "64.7%", "Total Points": "15924.90", "Avg Pts / Season": "227.26", "Alliance High Score": "1", "Alliance Low Score": "0", "League High Score": "7", "League Low Score": "0", "Best Manager": "-4", "Conference Wins": "1", "Division Wins": "1", "Playoff Wins": "4" } }],
  "mattbanks3x": [{ "tierKey": "USFL", "team": "San Antonio Gunslingers", "stats": { "Career CP": "930.46", "Career Avg CP": "232.62", "Record": "46-22", "Win %": "67.6%", "Total Points": "15080.85", "Avg Pts / Season": "215.29", "Alliance High Score": "1", "Alliance Low Score": "0", "League High Score": "11", "League Low Score": "0", "Best Manager": "1", "Conference Wins": "1", "Division Wins": "1", "Playoff Wins": "2" } }],
  "mbulls": [{ "tierKey": "FLHS", "team": "Miami Senior Stingrays", "stats": { "Career CP": "317.37", "Career Avg CP": "79.34", "Record": "29-39", "Win %": "42.6%", "Total Points": "13149.40", "Avg Pts / Season": "188.12", "Alliance High Score": "0", "Alliance Low Score": "8", "League High Score": "0", "League Low Score": "8", "Best Manager": "-1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "3" } }],
  "mchostetler1": [{ "tierKey": "USFL", "team": "Washington Federals", "stats": { "Career CP": "563.24", "Career Avg CP": "140.81", "Record": "35-33", "Win %": "51.5%", "Total Points": "13833.85", "Avg Pts / Season": "197.78", "Alliance High Score": "1", "Alliance Low Score": "1", "League High Score": "3", "League Low Score": "1", "Best Manager": "4", "Conference Wins": "0", "Division Wins": "1", "Playoff Wins": "1" } }],
  "michaeltomlin": [{ "tierKey": "TEN", "team": "Penn St. Nittany Lions", "stats": { "Career CP": "531.25", "Career Avg CP": "132.81", "Record": "29-22", "Win %": "56.9%", "Total Points": "10616.75", "Avg Pts / Season": "200.65", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "3", "League Low Score": "0", "Best Manager": "12", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "1" } }],
  "mightykidsmeal": [{ "tierKey": "BIG XII", "team": "Kansas State Wildcats", "stats": { "Career CP": "619.97", "Career Avg CP": "154.99", "Record": "37-31", "Win %": "54.4%", "Total Points": "14310.30", "Avg Pts / Season": "204.73", "Alliance High Score": "0", "Alliance Low Score": "2", "League High Score": "2", "League Low Score": "2", "Best Manager": "1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "mintystoob": [{ "tierKey": "SOCO", "team": "Elon Phoenix", "stats": { "Career CP": "183.90", "Career Avg CP": "45.98", "Record": "13-21", "Win %": "38.2%", "Total Points": "6959.10", "Avg Pts / Season": "198.62", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "3", "League Low Score": "0", "Best Manager": "1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "mlporter2001": [{ "tierKey": "IVY", "team": "Holy Cross Crusaders", "stats": { "Career CP": "130.50", "Career Avg CP": "32.63", "Record": "13-21", "Win %": "38.2%", "Total Points": "6605.90", "Avg Pts / Season": "188.71", "Alliance High Score": "0", "Alliance Low Score": "2", "League High Score": "0", "League Low Score": "2", "Best Manager": "-1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "motty": [{ "tierKey": "XFL", "team": "Tampa Bay Vipers", "stats": { "Career CP": "673.49", "Career Avg CP": "168.37", "Record": "39-29", "Win %": "57.4%", "Total Points": "13426.55", "Avg Pts / Season": "192.28", "Alliance High Score": "0", "Alliance Low Score": "3", "League High Score": "3", "League Low Score": "3", "Best Manager": "2", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "2" } }],
  "mrcoolbuns": [{ "tierKey": "USFL", "team": "New Jersey Generals", "stats": { "Career CP": "775.06", "Career Avg CP": "193.76", "Record": "41-27", "Win %": "60.3%", "Total Points": "14470.20", "Avg Pts / Season": "215.22", "Alliance High Score": "1", "Alliance Low Score": "0", "League High Score": "13", "League Low Score": "0", "Best Manager": "0", "Conference Wins": "1", "Division Wins": "1", "Playoff Wins": "4" } }],
  "mrhawke19": [{ "tierKey": "USFL", "team": "Orlando Renegades", "stats": { "Career CP": "758.73", "Career Avg CP": "189.68", "Record": "34-34", "Win %": "50.0%", "Total Points": "13750.85", "Avg Pts / Season": "196.80", "Alliance High Score": "0", "Alliance Low Score": "3", "League High Score": "1", "League Low Score": "3", "Best Manager": "4", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "1" } }],
  "mvpmalik2": [{ "tierKey": "NFL", "team": "Cleveland Browns 20", "stats": { "Career CP": "301.86", "Career Avg CP": "75.47", "Record": "27-41", "Win %": "39.7%", "Total Points": "11895.55", "Avg Pts / Season": "179.30", "Alliance High Score": "1", "Alliance Low Score": "0", "League High Score": "2", "League Low Score": "0", "Best Manager": "-4", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "3" } }],
  "nblu82": [{ "tierKey": "SWAC", "team": "SouthernU Jaguars", "stats": { "Career CP": "339.09", "Career Avg CP": "84.77", "Record": "25-43", "Win %": "36.8%", "Total Points": "12559.85", "Avg Pts / Season": "179.77", "Alliance High Score": "0", "Alliance Low Score": "14", "League High Score": "1", "League Low Score": "14", "Best Manager": "-2", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "nbowers12": [{ "tierKey": "ACC", "team": "SMU Mustangs", "stats": { "Career CP": "113.25", "Career Avg CP": "28.31", "Record": "10-7", "Win %": "58.8%", "Total Points": "3310.00", "Avg Pts / Season": "91.94", "Alliance High Score": "0", "Alliance Low Score": "1", "League High Score": "0", "League Low Score": "1", "Best Manager": "-2", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "newkbomb": [{ "tierKey": "USFL", "team": "Denver Gold", "stats": { "Career CP": "847.02", "Career Avg CP": "211.75", "Record": "46-22", "Win %": "67.6%", "Total Points": "14940.95", "Avg Pts / Season": "213.91", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "1", "League Low Score": "0", "Best Manager": "-1", "Conference Wins": "0", "Division Wins": "1", "Playoff Wins": "2" } }, { "tierKey": "XFL", "team": "Orlando Rage", "stats": { "Career CP": "803.46", "Career Avg CP": "200.86", "Record": "45-23", "Win %": "66.2%", "Total Points": "14759.70", "Avg Pts / Season": "211.39", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "2", "League Low Score": "0", "Best Manager": "-2", "Conference Wins": "1", "Division Wins": "1", "Playoff Wins": "1" } }],
  "noga2003": [{ "tierKey": "USFL", "team": "Houston Gamblers", "stats": { "Career CP": "808.16", "Career Avg CP": "202.04", "Record": "38-30", "Win %": "55.9%", "Total Points": "14066.20", "Avg Pts / Season": "201.34", "Alliance High Score": "1", "Alliance Low Score": "0", "League High Score": "4", "League Low Score": "0", "Best Manager": "3", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "4" } }, { "tierKey": "XFL", "team": "Birmingham Thunderbolts", "stats": { "Career CP": "808.16", "Career Avg CP": "202.04", "Record": "38-30", "Win %": "55.9%", "Total Points": "14066.20", "Avg Pts / Season": "201.34", "Alliance High Score": "1", "Alliance Low Score": "0", "League High Score": "4", "League Low Score": "0", "Best Manager": "3", "Conference Wins": "1", "Division Wins": "0", "Playoff Wins": "4" } }],
  "olavegarden18": [{ "tierKey": "NFL", "team": "Cincinnati Bengals", "stats": { "Career CP": "778.90", "Career Avg CP": "194.73", "Record": "37-31", "Win %": "54.4%", "Total Points": "11324.50", "Avg Pts / Season": "162.01", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "1", "League Low Score": "0", "Best Manager": "4", "Conference Wins": "1", "Division Wins": "0", "Playoff Wins": "2" } }],
  "oschmini": [{ "tierKey": "NFL", "team": "Seattle Seahawks", "stats": { "Career CP": "625.84", "Career Avg CP": "156.46", "Record": "33-35", "Win %": "48.5%", "Total Points": "10302.05", "Avg Pts / Season": "147.04", "Alliance High Score": "0", "Alliance Low Score": "2", "League High Score": "0", "League Low Score": "2", "Best Manager": "-2", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "papared": [{ "tierKey": "TEN", "team": "Utah Utes", "stats": { "Career CP": "285.23", "Career Avg CP": "71.31", "Record": "26-42", "Win %": "38.2%", "Total Points": "12972.35", "Avg Pts / Season": "185.33", "Alliance High Score": "0", "Alliance Low Score": "7", "League High Score": "3", "League Low Score": "7", "Best Manager": "-2", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "patty5": [{ "tierKey": "ACC", "team": "Syracuse Orange", "stats": { "Career CP": "147.35", "Career Avg CP": "36.84", "Record": "9-8", "Win %": "52.9%", "Total Points": "3475.60", "Avg Pts / Season": "96.54", "Alliance High Score": "0", "Alliance Low Score": "1", "League High Score": "1", "League Low Score": "1", "Best Manager": "-1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "1" } }],
  "pauly102 l": [{ "tierKey": "GLIAC", "team": "Wilmington Quakers", "stats": { "Career CP": "91.06", "Career Avg CP": "22.77", "Record": "11-23", "Win %": "32.4%", "Total Points": "6510.75", "Avg Pts / Season": "185.94", "Alliance High Score": "0", "Alliance Low Score": "4", "League High Score": "3", "League Low Score": "4", "Best Manager": "-1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "pigskinftw": [{ "tierKey": "BIG XII", "team": "UCF Knights", "stats": { "Career CP": "416.12", "Career Avg CP": "104.03", "Record": "26-25", "Win %": "51.0%", "Total Points": "10167.60", "Avg Pts / Season": "191.84", "Alliance High Score": "0", "Alliance Low Score": "3", "League High Score": "3", "League Low Score": "3", "Best Manager": "6", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "proctordoctor": [{ "tierKey": "GLIAC", "team": "Capital Comets", "stats": { "Career CP": "291.63", "Career Avg CP": "72.91", "Record": "20-31", "Win %": "39.2%", "Total Points": "9475.75", "Avg Pts / Season": "178.84", "Alliance High Score": "0", "Alliance Low Score": "6", "League High Score": "0", "League Low Score": "6", "Best Manager": "-7", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "putinsbalenciagas": [{ "tierKey": "NFL", "team": "Chicago Bears", "stats": { "Career CP": "603.87", "Career Avg CP": "150.97", "Record": "27-41", "Win %": "39.7%", "Total Points": "9927.29", "Avg Pts / Season": "141.94", "Alliance High Score": "0", "Alliance Low Score": "1", "League High Score": "0", "League Low Score": "1", "Best Manager": "1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "1" } }],
  "pwnrangr l6": [{ "tierKey": "ACC", "team": "Louisville Cardinals", "stats": { "Career CP": "409.93", "Career Avg CP": "102.48", "Record": "21-13", "Win %": "61.8%", "Total Points": "7733.25", "Avg Pts / Season": "221.20", "Alliance High Score": "1", "Alliance Low Score": "0", "League High Score": "3", "League Low Score": "0", "Best Manager": "4", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "2" } }],
  "pwnrangr l5": [{ "tierKey": "TEN", "team": "Indiana Hoosiers", "stats": { "Career CP": "302.75", "Career Avg CP": "75.69", "Record": "20-14", "Win %": "58.8%", "Total Points": "7109.60", "Avg Pts / Season": "203.20", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "3", "League Low Score": "0", "Best Manager": "2", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "pwnrangr": [{ "tierKey": "NFL", "team": "New Orleans Saints", "stats": { "Career CP": "675.00", "Career Avg CP": "168.75", "Record": "37-31", "Win %": "54.4%", "Total Points": "11964.85", "Avg Pts / Season": "171.33", "Alliance High Score": "0", "Alliance Low Score": "1", "League High Score": "0", "League Low Score": "1", "Best Manager": "1", "Conference Wins": "0", "Division Wins": "2", "Playoff Wins": "1" } }],
  "pwnrangr l8": [{ "tierKey": "XFL", "team": "Seattle Dragons", "stats": { "Career CP": "650.44", "Career Avg CP": "162.61", "Record": "36-32", "Win %": "52.9%", "Total Points": "12855.10", "Avg Pts / Season": "184.04", "Alliance High Score": "0", "Alliance Low Score": "1", "League High Score": "0", "League Low Score": "1", "Best Manager": "1", "Conference Wins": "1", "Division Wins": "1", "Playoff Wins": "0" } }],
  "pwnrangr int4": [{ "tierKey": "BIG XII", "team": "TCU Horned Frogs", "stats": { "Career CP": "523.45", "Career Avg CP": "130.86", "Record": "36-32", "Win %": "52.9%", "Total Points": "13543.85", "Avg Pts / Season": "194.04", "Alliance High Score": "1", "Alliance Low Score": "5", "League High Score": "2", "League Low Score": "5", "Best Manager": "-9", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "3" } }],
  "pwnrangr int5": [{ "tierKey": "SUN", "team": "Marshall Thundering Herd", "stats": { "Career CP": "56.05", "Career Avg CP": "14.01", "Record": "8-26", "Win %": "23.5%", "Total Points": "5601.74", "Avg Pts / Season": "160.08", "Alliance High Score": "0", "Alliance Low Score": "8", "League High Score": "0", "League Low Score": "8", "Best Manager": "2", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "pwnrangr int1": [{ "tierKey": "USFL", "team": "Oakland Invaders", "stats": { "Career CP": "0.00", "Career Avg CP": "0.00", "Record": "7-10", "Win %": "41.2%", "Total Points": "3467.15", "Avg Pts / Season": "96.31", "Alliance High Score": "0", "Alliance Low Score": "1", "League High Score": "2", "League Low Score": "1", "Best Manager": "1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "pwnrangr l4": [{ "tierKey": "SOCO", "team": "VMI Keydets", "stats": { "Career CP": "182.33", "Career Avg CP": "45.58", "Record": "16-18", "Win %": "47.1%", "Total Points": "6624.60", "Avg Pts / Season": "189.62", "Alliance High Score": "1", "Alliance Low Score": "6", "League High Score": "2", "League Low Score": "6", "Best Manager": "-2", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "pwnrangr l1": [{ "tierKey": "FLHS", "team": "Miami Beach Hi Tides", "stats": { "Career CP": "649.97", "Career Avg CP": "162.49", "Record": "46-22", "Win %": "67.6%", "Total Points": "15579.45", "Avg Pts / Season": "222.65", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "10", "League Low Score": "0", "Best Manager": "2", "Conference Wins": "1", "Division Wins": "1", "Playoff Wins": "5" } }],
  "pwnrangr l7": [{ "tierKey": "SEC", "team": "Kentucky Wildcats", "stats": { "Career CP": "605.08", "Career Avg CP": "151.27", "Record": "33-18", "Win %": "64.7%", "Total Points": "11449.15", "Avg Pts / Season": "216.01", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "3", "League Low Score": "0", "Best Manager": "-1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "3" } }],
  "pwnrangr l2": [{ "tierKey": "SWAC", "team": "Alcorn State Braves", "stats": { "Career CP": "217.06", "Career Avg CP": "54.27", "Record": "20-31", "Win %": "39.2%", "Total Points": "9144.95", "Avg Pts / Season": "172.37", "Alliance High Score": "0", "Alliance Low Score": "7", "League High Score": "0", "League Low Score": "7", "Best Manager": "-4", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "pwnrangr l3": [{ "tierKey": "IVY", "team": "Harvard Crimson", "stats": { "Career CP": "60.54", "Career Avg CP": "15.13", "Record": "7-10", "Win %": "41.2%", "Total Points": "3625.95", "Avg Pts / Season": "100.72", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "1", "League Low Score": "0", "Best Manager": "-2", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "quincidental": [{ "tierKey": "SUN", "team": "USM Golden Eagles", "stats": { "Career CP": "381.14", "Career Avg CP": "95.28", "Record": "25-26", "Win %": "49.0%", "Total Points": "10784.75", "Avg Pts / Season": "203.84", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "2", "League Low Score": "0", "Best Manager": "8", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "ravenger": [{ "tierKey": "SOCO", "team": "E Tenn Buccaneers", "stats": { "Career CP": "514.57", "Career Avg CP": "128.64", "Record": "31-37", "Win %": "45.6%", "Total Points": "11269.90", "Avg Pts / Season": "160.79", "Alliance High Score": "0", "Alliance Low Score": "1", "League High Score": "2", "League Low Score": "1", "Best Manager": "2", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "recki20": [{ "tierKey": "GLIAC", "team": "JCU Blue Streaks", "stats": { "Career CP": "227.22", "Career Avg CP": "56.80", "Record": "23-28", "Win %": "45.1%", "Total Points": "10007.80", "Avg Pts / Season": "188.93", "Alliance High Score": "0", "Alliance Low Score": "4", "League High Score": "1", "League Low Score": "4", "Best Manager": "7", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "redphoenix437": [{ "tierKey": "USFL", "team": "Los Angeles Express", "stats": { "Career CP": "933.99", "Career Avg CP": "233.50", "Record": "45-23", "Win %": "66.2%", "Total Points": "14315.00", "Avg Pts / Season": "204.47", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "3", "League Low Score": "0", "Best Manager": "1", "Conference Wins": "1", "Division Wins": "1", "Playoff Wins": "8" } }],
  "rflores29": [{ "tierKey": "SWAC", "team": "Morgan State Bears", "stats": { "Career CP": "203.43", "Career Avg CP": "50.86", "Record": "15-19", "Win %": "44.1%", "Total Points": "6939.00", "Avg Pts / Season": "198.38", "Alliance High Score": "0", "Alliance Low Score": "18", "League High Score": "18", "League Low Score": "18", "Best Manager": "0", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }, { "tierKey": "GLIAC", "team": "Muskingum Fighting Muskies", "stats": { "Career CP": "203.43", "Career Avg CP": "50.86", "Record": "—", "Win %": "—", "Total Points": "—", "Avg Pts / Season": "198.38", "Alliance High Score": "0", "Alliance Low Score": "2", "League High Score": "2", "League Low Score": "2", "Best Manager": "0", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "rhhniner": [{ "tierKey": "TEN", "team": "Cal Golden Bears", "stats": { "Career CP": "533.70", "Career Avg CP": "133.42", "Record": "35-33", "Win %": "51.5%", "Total Points": "13972.89", "Avg Pts / Season": "199.54", "Alliance High Score": "0", "Alliance Low Score": "1", "League High Score": "7", "League Low Score": "1", "Best Manager": "6", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "rifelife520": [{ "tierKey": "ACC", "team": "NC State Wolfpack", "stats": { "Career CP": "2.26", "Career Avg CP": "1.13", "Record": "4-13", "Win %": "23.5%", "Total Points": "2839.35", "Avg Pts / Season": "78.87", "Alliance High Score": "0", "Alliance Low Score": "3", "League High Score": "0", "League Low Score": "3", "Best Manager": "-5", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "rifelife520 int": [{ "tierKey": "SEC", "team": "Oklahoma Sooners 🏆", "stats": { "Career CP": "818.44", "Career Avg CP": "204.61", "Record": "46-22", "Win %": "67.6%", "Total Points": "15533.85", "Avg Pts / Season": "221.87", "Alliance High Score": "2", "Alliance Low Score": "0", "League High Score": "10", "League Low Score": "0", "Best Manager": "3", "Conference Wins": "1", "Division Wins": "1", "Playoff Wins": "3" } }],
  "rifelife520 int1": [{ "tierKey": "USFL", "team": "Oklahoma Outlaws", "stats": { "Career CP": "0.00", "Career Avg CP": "—", "Record": "0-0", "Win %": "—", "Total Points": "0.00", "Avg Pts / Season": "—", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "0", "League Low Score": "0", "Best Manager": "0", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "rifelife520 int2": [{ "tierKey": "XFL", "team": "Los Angeles Xtreme", "stats": { "Career CP": "0.00", "Career Avg CP": "—", "Record": "0-0", "Win %": "—", "Total Points": "0.00", "Avg Pts / Season": "—", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "0", "League Low Score": "0", "Best Manager": "0", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "rifelife520 l": [{ "tierKey": "SUN", "team": "App State Mountaineers", "stats": { "Career CP": "330.25", "Career Avg CP": "82.56", "Record": "23-11", "Win %": "67.6%", "Total Points": "7901.05", "Avg Pts / Season": "225.88", "Alliance High Score": "1", "Alliance Low Score": "1", "League High Score": "4", "League Low Score": "1", "Best Manager": "-1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "1" } }, { "tierKey": "IVY", "team": "Colgate Raiders", "stats": { "Career CP": "330.85", "Career Avg CP": "82.71", "Record": "25-9", "Win %": "73.5%", "Total Points": "7867.15", "Avg Pts / Season": "224.82", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "2", "League Low Score": "0", "Best Manager": "2", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "2" } }],
  "roedshow502": [{ "tierKey": "TEN", "team": "USC Trojans", "stats": { "Career CP": "388.87", "Career Avg CP": "97.22", "Record": "24-27", "Win %": "47.1%", "Total Points": "10363.85", "Avg Pts / Season": "196.04", "Alliance High Score": "0", "Alliance Low Score": "2", "League High Score": "3", "League Low Score": "2", "Best Manager": "-1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "2" } }, { "tierKey": "SUN", "team": "Little Rock Trojans", "stats": { "Career CP": "584.98", "Career Avg CP": "146.25", "Record": "31-20", "Win %": "60.8%", "Total Points": "11175.15", "Avg Pts / Season": "211.06", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "5", "League Low Score": "0", "Best Manager": "7", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "4" } }],
  "rydel439": [{ "tierKey": "TEN", "team": "—", "stats": { "Career CP": "201.17", "Career Avg CP": "50.29", "Record": "—", "Win %": "—", "Total Points": "—", "Avg Pts / Season": "180.71", "Alliance High Score": "0", "Alliance Low Score": "3", "League High Score": "0", "League Low Score": "3", "Best Manager": "0", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "sammykins13": [{ "tierKey": "BIG XII", "team": "Denver Pioneers", "stats": { "Career CP": "206.96", "Career Avg CP": "51.74", "Record": "17-17", "Win %": "50.0%", "Total Points": "6385.95", "Avg Pts / Season": "182.61", "Alliance High Score": "0", "Alliance Low Score": "1", "League High Score": "2", "League Low Score": "1", "Best Manager": "0", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }, { "tierKey": "FLHS", "team": "Dr Krop Lightning", "stats": { "Career CP": "198.69", "Career Avg CP": "49.67", "Record": "16-18", "Win %": "47.1%", "Total Points": "6577.35", "Avg Pts / Season": "187.93", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "1", "League Low Score": "0", "Best Manager": "5", "Conference Wins": "0", "Division Wins": "1", "Playoff Wins": "0" } }],
  "samwow123": [{ "tierKey": "SEC", "team": "South Carolina Gamecocks", "stats": { "Career CP": "850.75", "Career Avg CP": "212.69", "Record": "49-19", "Win %": "72.1%", "Total Points": "16522.40", "Avg Pts / Season": "236.26", "Alliance High Score": "3", "Alliance Low Score": "0", "League High Score": "7", "League Low Score": "0", "Best Manager": "-5", "Conference Wins": "1", "Division Wins": "0", "Playoff Wins": "5" } }],
  "samwow123 l": [{ "tierKey": "TEN", "team": "Northwestern Wildcats", "stats": { "Career CP": "456.55", "Career Avg CP": "114.14", "Record": "27-7", "Win %": "79.4%", "Total Points": "8170.25", "Avg Pts / Season": "233.63", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "6", "League Low Score": "0", "Best Manager": "3", "Conference Wins": "1", "Division Wins": "0", "Playoff Wins": "5" } }],
  "sb428": [{ "tierKey": "SWAC", "team": "Bethune-Cookman Wildcats", "stats": { "Career CP": "623.17", "Career Avg CP": "155.79", "Record": "43-25", "Win %": "63.2%", "Total Points": "15528.80", "Avg Pts / Season": "221.99", "Alliance High Score": "1", "Alliance Low Score": "0", "League High Score": "7", "League Low Score": "0", "Best Manager": "4", "Conference Wins": "1", "Division Wins": "1", "Playoff Wins": "2" } }],
  "schmacky": [{ "tierKey": "SUN", "team": "James Madison Dukes", "stats": { "Career CP": "116.92", "Career Avg CP": "29.23", "Record": "6-11", "Win %": "35.3%", "Total Points": "3467.65", "Avg Pts / Season": "96.32", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "1", "League Low Score": "0", "Best Manager": "1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "seanhowe92": [{ "tierKey": "XFL", "team": "San Francisco Demons", "stats": { "Career CP": "178.68", "Career Avg CP": "44.67", "Record": "15-19", "Win %": "44.1%", "Total Points": "6447.95", "Avg Pts / Season": "184.61", "Alliance High Score": "0", "Alliance Low Score": "19", "League High Score": "17", "League Low Score": "19", "Best Manager": "-4", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "1" } }],
  "shubhay": [{ "tierKey": "NFL", "team": "Houston Texans", "stats": { "Career CP": "472.46", "Career Avg CP": "118.11", "Record": "33-35", "Win %": "48.5%", "Total Points": "11424.54", "Avg Pts / Season": "163.31", "Alliance High Score": "0", "Alliance Low Score": "2", "League High Score": "2", "League Low Score": "2", "Best Manager": "-8", "Conference Wins": "1", "Division Wins": "1", "Playoff Wins": "0" } }],
  "spacebarracecar": [{ "tierKey": "USFL", "team": "Memphis Showboats", "stats": { "Career CP": "401.66", "Career Avg CP": "100.42", "Record": "23-11", "Win %": "67.6%", "Total Points": "7798.95", "Avg Pts / Season": "223.60", "Alliance High Score": "1", "Alliance Low Score": "0", "League High Score": "5", "League Low Score": "0", "Best Manager": "-1", "Conference Wins": "1", "Division Wins": "0", "Playoff Wins": "6" } }, { "tierKey": "SOCO", "team": "The Citadel Bulldogs", "stats": { "Career CP": "314.57", "Career Avg CP": "78.64", "Record": "21-13", "Win %": "61.8%", "Total Points": "7822.95", "Avg Pts / Season": "224.26", "Alliance High Score": "1", "Alliance Low Score": "0", "League High Score": "5", "League Low Score": "0", "Best Manager": "-1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "2" } }],
  "spano15": [{ "tierKey": "IVY", "team": "Dartmouth Big Green", "stats": { "Career CP": "538.23", "Career Avg CP": "134.56", "Record": "35-33", "Win %": "51.5%", "Total Points": "13593.30", "Avg Pts / Season": "194.27", "Alliance High Score": "0", "Alliance Low Score": "3", "League High Score": "1", "League Low Score": "3", "Best Manager": "-3", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "springfieldatom5": [{ "tierKey": "SWAC", "team": "Norfolk State Spartans", "stats": { "Career CP": "123.73", "Career Avg CP": "30.93", "Record": "11-6", "Win %": "64.7%", "Total Points": "3296.75", "Avg Pts / Season": "91.58", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "1", "League Low Score": "0", "Best Manager": "0", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }, { "tierKey": "FLHS", "team": "Norfolk State Spartans", "stats": { "Career CP": "123.73", "Career Avg CP": "30.93", "Record": "—", "Win %": "—", "Total Points": "—", "Avg Pts / Season": "91.58", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "1", "League Low Score": "0", "Best Manager": "0", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "srcav": [{ "tierKey": "TEN", "team": "Purdue Boilermakes", "stats": { "Career CP": "653.43", "Career Avg CP": "163.36", "Record": "35-33", "Win %": "51.5%", "Total Points": "14464.95", "Avg Pts / Season": "206.99", "Alliance High Score": "0", "Alliance Low Score": "3", "League High Score": "4", "League Low Score": "3", "Best Manager": "1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "2" } }],
  "ssutton1": [{ "tierKey": "NFL", "team": "Buffalo Bills", "stats": { "Career CP": "790.24", "Career Avg CP": "197.56", "Record": "39-29", "Win %": "57.4%", "Total Points": "11337.25", "Avg Pts / Season": "161.93", "Alliance High Score": "0", "Alliance Low Score": "1", "League High Score": "1", "League Low Score": "1", "Best Manager": "0", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "1" } }],
  "stokescity": [{ "tierKey": "IVY", "team": "Bucknell Bison", "stats": { "Career CP": "505.87", "Career Avg CP": "126.47", "Record": "37-14", "Win %": "72.5%", "Total Points": "12349.60", "Avg Pts / Season": "233.23", "Alliance High Score": "1", "Alliance Low Score": "0", "League High Score": "12", "League Low Score": "0", "Best Manager": "-2", "Conference Wins": "1", "Division Wins": "1", "Playoff Wins": "4" } }, { "tierKey": "FLHS", "team": "Western Wildcats", "stats": { "Career CP": "505.87", "Career Avg CP": "126.47", "Record": "37-14", "Win %": "72.5%", "Total Points": "12349.60", "Avg Pts / Season": "233.23", "Alliance High Score": "1", "Alliance Low Score": "0", "League High Score": "12", "League Low Score": "0", "Best Manager": "-2", "Conference Wins": "1", "Division Wins": "2", "Playoff Wins": "4" } }],
  "svelter": [{ "tierKey": "FLHS", "team": "Coral Glades Jaguars", "stats": { "Career CP": "311.52", "Career Avg CP": "77.88", "Record": "31-37", "Win %": "45.6%", "Total Points": "12872.74", "Avg Pts / Season": "184.02", "Alliance High Score": "0", "Alliance Low Score": "5", "League High Score": "0", "League Low Score": "5", "Best Manager": "-2", "Conference Wins": "1", "Division Wins": "1", "Playoff Wins": "1" } }],
  "tallandflat": [{ "tierKey": "IVY", "team": "Columbia Lions", "stats": { "Career CP": "443.36", "Career Avg CP": "110.84", "Record": "28-40", "Win %": "41.2%", "Total Points": "13919.85", "Avg Pts / Season": "199.30", "Alliance High Score": "0", "Alliance Low Score": "1", "League High Score": "2", "League Low Score": "1", "Best Manager": "-1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "taunto": [{ "tierKey": "SEC", "team": "Alabama Crimson Tide", "stats": { "Career CP": "41.61", "Career Avg CP": "10.40", "Record": "6-11", "Win %": "35.3%", "Total Points": "3047.30", "Avg Pts / Season": "84.65", "Alliance High Score": "0", "Alliance Low Score": "2", "League High Score": "0", "League Low Score": "2", "Best Manager": "0", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }, { "tierKey": "SOCO", "team": "—", "stats": { "Career CP": "191.19", "Career Avg CP": "47.80", "Record": "12-5", "Win %": "70.6%", "Total Points": "3994.15", "Avg Pts / Season": "110.95", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "3", "League Low Score": "0", "Best Manager": "1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "1" } }],
  "thebadalec": [{ "tierKey": "ACC", "team": "North Carolina Tar Heels", "stats": { "Career CP": "745.32", "Career Avg CP": "186.33", "Record": "39-29", "Win %": "57.4%", "Total Points": "14931.65", "Avg Pts / Season": "213.37", "Alliance High Score": "0", "Alliance Low Score": "2", "League High Score": "3", "League Low Score": "2", "Best Manager": "0", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "2" } }],
  "thecolburnator01": [{ "tierKey": "TEN", "team": "—", "stats": { "Career CP": "749.05", "Career Avg CP": "187.26", "Record": "—", "Win %": "—", "Total Points": "—", "Avg Pts / Season": "220.34", "Alliance High Score": "1", "Alliance Low Score": "1", "League High Score": "4", "League Low Score": "1", "Best Manager": "3", "Conference Wins": "1", "Division Wins": "1", "Playoff Wins": "6" } }],
  "thewoat100": [{ "tierKey": "GLIAC", "team": "Wayne State Warriors", "stats": { "Career CP": "621.41", "Career Avg CP": "155.35", "Record": "42-26", "Win %": "61.8%", "Total Points": "14226.75", "Avg Pts / Season": "213.12", "Alliance High Score": "0", "Alliance Low Score": "2", "League High Score": "5", "League Low Score": "2", "Best Manager": "-1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "1" } }],
  "timc13": [{ "tierKey": "FLHS", "team": "Coral Springs Colts", "stats": { "Career CP": "585.10", "Career Avg CP": "146.28", "Record": "43-25", "Win %": "63.2%", "Total Points": "14147.95", "Avg Pts / Season": "201.70", "Alliance High Score": "2", "Alliance Low Score": "0", "League High Score": "8", "League Low Score": "0", "Best Manager": "0", "Conference Wins": "2", "Division Wins": "3", "Playoff Wins": "7" } }],
  "tobistresenteam": [{ "tierKey": "NFL", "team": "Minnesota Vikings", "stats": { "Career CP": "874.27", "Career Avg CP": "218.57", "Record": "41-27", "Win %": "60.3%", "Total Points": "11699.20", "Avg Pts / Season": "167.44", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "1", "League Low Score": "0", "Best Manager": "0", "Conference Wins": "2", "Division Wins": "1", "Playoff Wins": "3" } }],
  "tomjohnmike": [{ "tierKey": "ACC", "team": "Duke Blue Devils", "stats": { "Career CP": "667.82", "Career Avg CP": "166.96", "Record": "41-27", "Win %": "60.3%", "Total Points": "14980.35", "Avg Pts / Season": "213.86", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "4", "League Low Score": "0", "Best Manager": "0", "Conference Wins": "1", "Division Wins": "0", "Playoff Wins": "2" } }],
  "treetwig": [{ "tierKey": "SUN", "team": "Troy Trojans", "stats": { "Career CP": "461.13", "Career Avg CP": "115.28", "Record": "26-25", "Win %": "51.0%", "Total Points": "11146.15", "Avg Pts / Season": "210.33", "Alliance High Score": "2", "Alliance Low Score": "0", "League High Score": "3", "League Low Score": "0", "Best Manager": "7", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "1" } }, { "tierKey": "SWAC", "team": "Pine Bluff Golden Lions", "stats": { "Career CP": "31.12", "Career Avg CP": "7.78", "Record": "5-12", "Win %": "29.4%", "Total Points": "3037.50", "Avg Pts / Season": "84.38", "Alliance High Score": "0", "Alliance Low Score": "1", "League High Score": "0", "League Low Score": "1", "Best Manager": "-1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "trizzytr3": [{ "tierKey": "USFL", "team": "Arizona Wranglers", "stats": { "Career CP": "491.74", "Career Avg CP": "122.94", "Record": "29-39", "Win %": "42.6%", "Total Points": "11944.40", "Avg Pts / Season": "171.03", "Alliance High Score": "0", "Alliance Low Score": "3", "League High Score": "0", "League Low Score": "3", "Best Manager": "1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "tylerwt003": [{ "tierKey": "ACC", "team": "Virginia Tech Hokies", "stats": { "Career CP": "756.22", "Career Avg CP": "189.06", "Record": "42-26", "Win %": "61.8%", "Total Points": "15652.45", "Avg Pts / Season": "223.65", "Alliance High Score": "1", "Alliance Low Score": "0", "League High Score": "11", "League Low Score": "0", "Best Manager": "7", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "3" } }],
  "vberry8": [{ "tierKey": "FLHS", "team": "Stoneman Douglas Eagles", "stats": { "Career CP": "82.29", "Career Avg CP": "20.57", "Record": "15-36", "Win %": "29.4%", "Total Points": "8996.90", "Avg Pts / Season": "169.74", "Alliance High Score": "0", "Alliance Low Score": "8", "League High Score": "1", "League Low Score": "8", "Best Manager": "-9", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "veramic": [{ "tierKey": "SOCO", "team": "Nicholls State Colonels", "stats": { "Career CP": "276.66", "Career Avg CP": "69.17", "Record": "23-45", "Win %": "33.8%", "Total Points": "12471.85", "Avg Pts / Season": "178.42", "Alliance High Score": "0", "Alliance Low Score": "4", "League High Score": "0", "League Low Score": "4", "Best Manager": "-3", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "vikezfann": [{ "tierKey": "XFL", "team": "St. Louis Battlehawks", "stats": { "Career CP": "786.32", "Career Avg CP": "196.58", "Record": "40-28", "Win %": "58.8%", "Total Points": "13237.35", "Avg Pts / Season": "189.45", "Alliance High Score": "0", "Alliance Low Score": "1", "League High Score": "0", "League Low Score": "1", "Best Manager": "14", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "1" } }],
  "warboys86": [{ "tierKey": "TEN", "team": "Rutgers Scarlet Knights", "stats": { "Career CP": "432.40", "Career Avg CP": "108.10", "Record": "33-35", "Win %": "48.5%", "Total Points": "13625.60", "Avg Pts / Season": "194.86", "Alliance High Score": "0", "Alliance Low Score": "4", "League High Score": "4", "League Low Score": "4", "Best Manager": "1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "wdh76": [{ "tierKey": "NFL", "team": "Denver Broncos", "stats": { "Career CP": "568.69", "Career Avg CP": "142.17", "Record": "32-19", "Win %": "62.7%", "Total Points": "11462.45", "Avg Pts / Season": "216.07", "Alliance High Score": "4", "Alliance Low Score": "0", "League High Score": "17", "League Low Score": "0", "Best Manager": "3", "Conference Wins": "1", "Division Wins": "1", "Playoff Wins": "1" } }],
  "wearyiungs": [{ "tierKey": "FLHS", "team": "West Broward Bobcats", "stats": { "Career CP": "110.39", "Career Avg CP": "55.19", "Record": "11-6", "Win %": "64.7%", "Total Points": "3249.40", "Avg Pts / Season": "90.26", "Alliance High Score": "0", "Alliance Low Score": "1", "League High Score": "1", "League Low Score": "1", "Best Manager": "0", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "wereallyouthere": [{ "tierKey": "NFL", "team": "Los Angeles Chargers", "stats": { "Career CP": "860.38", "Career Avg CP": "215.10", "Record": "37-31", "Win %": "54.4%", "Total Points": "11717.15", "Avg Pts / Season": "167.51", "Alliance High Score": "1", "Alliance Low Score": "1", "League High Score": "2", "League Low Score": "1", "Best Manager": "3", "Conference Wins": "1", "Division Wins": "1", "Playoff Wins": "2" } }],
  "willstephenssr": [{ "tierKey": "SWAC", "team": "Alabama State Hornets", "stats": { "Career CP": "288.68", "Career Avg CP": "72.17", "Record": "20-31", "Win %": "39.2%", "Total Points": "10083.70", "Avg Pts / Season": "190.54", "Alliance High Score": "2", "Alliance Low Score": "5", "League High Score": "4", "League Low Score": "5", "Best Manager": "2", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "willywonga33": [{ "tierKey": "GLIAC", "team": "Northern Ohio Polar Bears", "stats": { "Career CP": "214.79", "Career Avg CP": "53.70", "Record": "—", "Win %": "—", "Total Points": "—", "Avg Pts / Season": "190.78", "Alliance High Score": "0", "Alliance Low Score": "4", "League High Score": "0", "League Low Score": "4", "Best Manager": "1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "1" } }],
  "wonks": [{ "tierKey": "XFL", "team": "Omaha Mammoths", "stats": { "Career CP": "751.52", "Career Avg CP": "187.88", "Record": "39-29", "Win %": "57.4%", "Total Points": "15139.35", "Avg Pts / Season": "216.49", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "4", "League Low Score": "0", "Best Manager": "2", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "3" } }],
  "wonks l": [{ "tierKey": "ACC", "team": "Virginia Cavaliers", "stats": { "Career CP": "176.17", "Career Avg CP": "44.04", "Record": "13-21", "Win %": "38.2%", "Total Points": "6828.50", "Avg Pts / Season": "194.86", "Alliance High Score": "0", "Alliance Low Score": "4", "League High Score": "0", "League Low Score": "4", "Best Manager": "-2", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "wynnguy": [{ "tierKey": "IVY", "team": "Brown Bears", "stats": { "Career CP": "968.43", "Career Avg CP": "242.11", "Record": "56-12", "Win %": "82.4%", "Total Points": "16666.75", "Avg Pts / Season": "238.24", "Alliance High Score": "1", "Alliance Low Score": "0", "League High Score": "14", "League Low Score": "0", "Best Manager": "2", "Conference Wins": "2", "Division Wins": "1", "Playoff Wins": "7" } }],
  "yinyangkitties": [{ "tierKey": "NFL", "team": "Atlanta Falcons", "stats": { "Career CP": "355.35", "Career Avg CP": "88.84", "Record": "22-29", "Win %": "43.1%", "Total Points": "8965.09", "Avg Pts / Season": "169.76", "Alliance High Score": "0", "Alliance Low Score": "2", "League High Score": "1", "League Low Score": "2", "Best Manager": "0", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "yinyangkitties l": [{ "tierKey": "GLIAC", "team": "N Michigan Wildcats", "stats": { "Career CP": "285.41", "Career Avg CP": "71.35", "Record": "21-13", "Win %": "61.8%", "Total Points": "7233.60", "Avg Pts / Season": "206.58", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "2", "League Low Score": "0", "Best Manager": "2", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "1" } }],
  "z1856z": [{ "tierKey": "XFL", "team": "DC Defenders", "stats": { "Career CP": "779.08", "Career Avg CP": "194.77", "Record": "44-24", "Win %": "64.7%", "Total Points": "15019.65", "Avg Pts / Season": "214.51", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "10", "League Low Score": "0", "Best Manager": "-3", "Conference Wins": "1", "Division Wins": "1", "Playoff Wins": "5" } }],
  "z1856z l": [{ "tierKey": "SWAC", "team": "Mississippi Valley Delta Devils", "stats": { "Career CP": "238.07", "Career Avg CP": "59.52", "Record": "22-12", "Win %": "64.7%", "Total Points": "7664.85", "Avg Pts / Season": "218.73", "Alliance High Score": "0", "Alliance Low Score": "1", "League High Score": "5", "League Low Score": "1", "Best Manager": "0", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "2" } }],
  "zach2326": [{ "tierKey": "USFL", "team": "Birmingham Stallions", "stats": { "Career CP": "765.54", "Career Avg CP": "191.39", "Record": "41-26", "Win %": "61.2%", "Total Points": "13959.45", "Avg Pts / Season": "199.38", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "6", "League Low Score": "0", "Best Manager": "4", "Conference Wins": "1", "Division Wins": "1", "Playoff Wins": "3" } }],
  "zcal": [{ "tierKey": "NFL", "team": "Jacksonville Jaguars", "stats": { "Career CP": "654.19", "Career Avg CP": "163.55", "Record": "33-35", "Win %": "48.5%", "Total Points": "11144.19", "Avg Pts / Season": "159.35", "Alliance High Score": "0", "Alliance Low Score": "2", "League High Score": "2", "League Low Score": "2", "Best Manager": "2", "Conference Wins": "0", "Division Wins": "1", "Playoff Wins": "2" } }],
  "zero00": [{ "tierKey": "NFL", "team": "Philadelphia Eagles", "stats": { "Career CP": "764.92", "Career Avg CP": "191.23", "Record": "32-36", "Win %": "47.1%", "Total Points": "12888.95", "Avg Pts / Season": "184.64", "Alliance High Score": "0", "Alliance Low Score": "3", "League High Score": "4", "League Low Score": "3", "Best Manager": "3", "Conference Wins": "1", "Division Wins": "2", "Playoff Wins": "3" } }, { "tierKey": "XFL", "team": "New York Guardians", "stats": { "Career CP": "381.33", "Career Avg CP": "95.33", "Record": "24-44", "Win %": "35.3%", "Total Points": "12702.25", "Avg Pts / Season": "181.77", "Alliance High Score": "0", "Alliance Low Score": "4", "League High Score": "0", "League Low Score": "4", "Best Manager": "1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }, { "tierKey": "BIG XII", "team": "OSU", "stats": { "Career CP": "0.00", "Career Avg CP": "—", "Record": "0-0", "Win %": "—", "Total Points": "0.00", "Avg Pts / Season": "—", "Alliance High Score": "0", "Alliance Low Score": "16", "League High Score": "16", "League Low Score": "16", "Best Manager": "0", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "zero00 int": [{ "tierKey": "SEC", "team": "Ole Miss Rebels", "stats": { "Career CP": "550.57", "Career Avg CP": "137.64", "Record": "29-5", "Win %": "85.3%", "Total Points": "7925.50", "Avg Pts / Season": "226.82", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "6", "League Low Score": "0", "Best Manager": "1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "5" } }],
  "zero00 l": [{ "tierKey": "ACC", "team": "GeorgiaTech YellowJackets", "stats": { "Career CP": "311.24", "Career Avg CP": "77.81", "Record": "14-20", "Win %": "41.2%", "Total Points": "7202.05", "Avg Pts / Season": "206.21", "Alliance High Score": "0", "Alliance Low Score": "1", "League High Score": "1", "League Low Score": "1", "Best Manager": "1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "3" } }],
  "ziplocbaggins": [{ "tierKey": "SEC", "team": "LSU Tigers", "stats": { "Career CP": "884.87", "Career Avg CP": "221.22", "Record": "46-22", "Win %": "67.6%", "Total Points": "14605.20", "Avg Pts / Season": "208.94", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "2", "League Low Score": "0", "Best Manager": "-1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "7" } }],
  "ziplocbaggins l": [{ "tierKey": "BIG XII", "team": "Baylor Bears", "stats": { "Career CP": "780.47", "Career Avg CP": "195.12", "Record": "46-22", "Win %": "67.6%", "Total Points": "14347.90", "Avg Pts / Season": "205.37", "Alliance High Score": "0", "Alliance Low Score": "1", "League High Score": "2", "League Low Score": "1", "Best Manager": "-1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "7" } }],
};

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
  { key: "NFL", name: "National Football League", tier: 1, size: 32 },
  { key: "USFL", name: "United States Football League", tier: 2, size: 20 },
  { key: "XFL", name: "XFL", tier: 3, size: 20 },
  { key: "SEC", name: "Southeastern Conference", tier: 4, size: 16 },
  { key: "BIG XII", name: "Big 12 Conference", tier: 5, size: 16 },
  { key: "ACC", name: "Atlantic Coast Conference", tier: 6, size: 16 },
  { key: "TEN", name: "Big Ten Conference", tier: 7, size: 16 },
  { key: "SUN", name: "Sun Belt Conference", tier: 8, size: 16 },
  { key: "SOCO", name: "Southern Conference", tier: 9, size: 16 },
  { key: "IVY", name: "Ivy League", tier: 10, size: 16 },
  { key: "SWAC", name: "Southwestern Athletic", tier: 11, size: 16 },
  { key: "GLIAC", name: "Great Lakes Intercollegiate", tier: 12, size: 16 },
  { key: "FLHS", name: "Florida High School", tier: 13, size: 16 },
];

// Some historical records (300 Club, older exports) abbreviate conferences
// slightly differently than the site's TIERS keys — map the ones that differ.
const CONF_TO_TIER_KEY = { XII: "BIG XII", FHS: "FLHS" };

// NFL division numbers as configured in Sleeper -> real conference/division
// names. Confirmed directly by Lainey.
const NFL_DIVISIONS = {
  1: "AFC East", 2: "AFC West", 3: "AFC North", 4: "AFC South",
  5: "NFC East", 6: "NFC West", 7: "NFC North", 8: "NFC South",
};
const nflConferenceFor = (divisionNum) => (divisionNum && divisionNum <= 4 ? "AFC" : "NFC");

// FLHS's 4 districts (no conference split) -> Sleeper division numbers.
// Confirmed directly by Lainey.
const FLHS_DISTRICTS = { 1: "District 13", 2: "District 14", 3: "District 15", 4: "District 16" };

// USFL/XFL's 4 divisions (both leagues use the same names). Confirmed
// directly by Lainey.
const USFL_XFL_DIVISIONS = { 1: "North", 2: "South", 3: "East", 4: "West" };

// Real conference names for the 5 two-conference leagues (Sleeper division
// number -> name). Confirmed directly by Lainey.
const TWO_CONF_NAMES = {
  SUN: { 1: "East", 2: "West" },
  SOCO: { 1: "North", 2: "South" },
  IVY: { 1: "Ivy", 2: "Patriot" },
  SWAC: { 1: "East", 2: "West" },
  GLIAC: { 1: "GLIAC", 2: "Ohio Valley" },
};

// Looks up a division's real name for any tier that has one on file.
const divisionNameFor = (tKey, divNum) => {
  if (tKey === "NFL") return NFL_DIVISIONS[divNum];
  if (tKey === "FLHS") return FLHS_DISTRICTS[divNum];
  if (tKey === "USFL" || tKey === "XFL") return USFL_XFL_DIVISIONS[divNum];
  return null;
};

// Playoff format per tier, per the Rules doc. "top8-cascade": straight
// top-8 by record, no conferences, but everyone plays through Week 17 —
// same "winners and losers both keep playing" idea as the others, just
// without a play-in or division wrinkle — SEC/Big 12/ACC/Big Ten.
// "conference-division": NFL-style, 4 division winners + 4 wildcards per
// conference. "division-only": same idea as conference-division but a
// single group (no conference split) — FLHS's 4 districts.
// "conference-top4": top 4 teams from each of 2 conferences, no
// guaranteed division winners — Sun Belt/SoCo/Ivy/SWAC/GLIAC. "division-
// playin": USFL/XFL's unusual 10-team field — 4 division winners (seeds
// 1-4) get a bye, seeds 5-10 are wildcards, and a Week 14 play-in (7v10,
// 8v9 — one week earlier than every other tier's Week 15 start) trims it
// to 8 before the main bracket begins.
const PLAYOFF_FORMAT = {
  NFL: "conference-division",
  SEC: "top8-cascade", "BIG XII": "top8-cascade", ACC: "top8-cascade", TEN: "top8-cascade",
  FLHS: "division-only",
  SUN: "conference-top4", SOCO: "conference-top4", IVY: "conference-top4",
  SWAC: "conference-top4", GLIAC: "conference-top4",
  USFL: "division-playin", XFL: "division-playin",
};

// Standard fixed single-elimination bracket pairings.
// 8-seed: round 1 = (1v8, 4v5, 3v6, 2v7). 4-seed: round 1 = (1v4, 2v3).
const BRACKET_PAIRS_R1 = [[1, 8], [4, 5], [3, 6], [2, 7]];
const BRACKET_PAIRS_R1_4 = [[1, 4], [2, 3]];

// Final-standing rank -> draft pick number, confirmed directly from the
// playoff PDFs for each league size (worst record picks first, but the
// middle of the order isn't strictly linear — these are the real mappings,
// not a guess). Index 0 = rank 1 (Championship winner).
const DRAFT_PICKS_16 = [16, 15, 9, 10, 11, 12, 13, 14, 3, 4, 5, 6, 7, 8, 2, 1];
const DRAFT_PICKS_20 = [20, 19, 11, 12, 13, 14, 15, 16, 17, 18, 3, 4, 5, 6, 7, 8, 9, 10, 2, 1];
const DRAFT_PICKS_32 = [32, 31, 29, 30, 25, 26, 27, 28, 17, 18, 19, 20, 21, 22, 23, 24, 9, 10, 11, 12, 13, 14, 15, 16, 3, 4, 5, 6, 7, 8, 2, 1];

// Turns 1/2/3/etc into "1st"/"2nd"/"3rd"/etc.
function ordinal(n) {
  const suffixes = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (suffixes[(v - 20) % 10] || suffixes[v] || suffixes[0]);
}

// Builds the reference rows shown beside a bracket: one per final place,
// carrying that place's coaching points plus whether it can still take a
// promotion. Draft picks used to live here too; they now read off the
// bracket's place cells. When there is no CP to show (shouldn't happen for
// any of the 13 tiers now, kept as a safety net), consecutive places that
// would render identically collapse into a band ("22nd - 31st") instead of
// repeating.
function placementInfoRows(size, tKeyForCP) {
  const hasCP = !!tKeyForCP && (size === 16 || !!CP_BY_PLACE[tKeyForCP]);
  const rows = [];
  for (let place = 1; place <= size; place++) {
    const fired = place === size;
    rows.push({
      place,
      label: ordinal(place),
      cp: hasCP ? cpForPlace(tKeyForCP, place) : undefined,
      fired,
      ineligible: !fired && !promotionEligible(size, place),
    });
  }
  if (hasCP) return rows;
  const bands = [];
  for (const r of rows) {
    const last = bands[bands.length - 1];
    if (last && last.fired === r.fired && last.ineligible === r.ineligible) {
      last.to = r.place;
      last.label = `${ordinal(last.from)} \u2013 ${ordinal(r.place)}`;
    } else {
      bands.push({ ...r, from: r.place, to: r.place });
    }
  }
  return bands;
}

// Coaching points by final place, for the 10 sixteen-team leagues. Places
// 1-8 (the Championship group) step down by 5 each; there's then an extra
// -10 jump into rank 9 (top of Consolation) before resuming a -5 step to
// rank 10 — confirmed against both the SEC and FLHS tables exactly, so
// this isn't a straight linear scale across 1-10. Places 11-16 are
// identical, fixed values in every 16-team league regardless of which one
// it is. Champion CP steps down 5 per league, SEC (140) through FLHS (95)
// — a league that used to sit between GLIAC and FLHS has since folded,
// which is why FLHS isn't one more step down at 90.
const CP_OFFSETS_1_10 = [0, 5, 10, 15, 20, 25, 30, 35, 45, 50]; // subtracted from each league's champion CP
const CP_TAIL_16 = [20, 10, 0, -5, -10, -15]; // ranks 11-16
const CHAMPION_CP_16 = {
  SEC: 140, "BIG XII": 135, ACC: 130, TEN: 125, SUN: 120,
  SOCO: 115, IVY: 110, SWAC: 105, GLIAC: 100, FLHS: 95,
};

// Coaching points by final place for NFL (32), USFL (20) and XFL (20) —
// supplied directly from her Rules-page table, place 1 through last, index
// 0 = place 1. NOT a formula like the 16-team scale above: NFL has two
// extra -10 jumps (place 17, place 28) beyond the base -5 step, and
// USFL/XFL both have an irregular drop across places 13-16 lining up with
// where promotion eligibility ends — real, deliberate, not "cleaned up",
// same principle as the non-monotonic DRAFT_PICKS_* tables.
const CP_BY_PLACE_NFL = [
  155, 150, 145, 140, 135, 130, 125, 120, 115, 110, 105, 100, 95, 90, 85, 80,
  70, 65, 60, 55, 50, 45, 40, 35, 30, 25, 20, 10, 0, -5, -10, -15,
];
const CP_BY_PLACE_USFL = [
  150, 145, 140, 135, 130, 125, 120, 115, 110, 105, 95, 90, 80, 50, 25, 10,
  5, 0, -5, -10,
];
const CP_BY_PLACE_XFL = [
  145, 140, 135, 130, 125, 120, 115, 110, 105, 100, 90, 85, 75, 50, 25, 10,
  5, 0, -5, -10,
];
const CP_BY_PLACE = { NFL: CP_BY_PLACE_NFL, USFL: CP_BY_PLACE_USFL, XFL: CP_BY_PLACE_XFL };

const cpForPlace = (tKey, place) =>
  CP_BY_PLACE[tKey]
    ? CP_BY_PLACE[tKey][place - 1]
    : place <= 10
    ? CHAMPION_CP_16[tKey] - CP_OFFSETS_1_10[place - 1]
    : CP_TAIL_16[place - 11];

// Ineligible for a promotion or demotion: the last 5 places in a 16-team
// league, the last 7 in a 20-team league, the last 11 in the 32-team NFL --
// straight off the Rules page, so the panel and the rules cannot drift.
// Confirmed for 16 by both CP tables (ranks 12-16 read "ineligible").
const promotionEligible = (size, place) =>
  size >= 32 ? place <= size - 11 : size >= 20 ? place <= size - 7 : place <= size - 5;

// Compact reference box meant to sit beside a bracket rather than as a
// paragraph underneath it. One box for the whole tier -- it used to be split
// per bracket half and headed "Draft Order".
function PlacementInfoPanel({ rows, title }) {
  return (
    <div className="shrink-0 rounded-sm p-3 text-xs" style={{ background: C.panel, border: `1px solid ${C.line}`, minWidth: "12rem" }}>
      <div className="uppercase tracking-wider mb-2" style={{ color: C.slate, fontSize: "0.65rem", letterSpacing: "0.08em" }}>
        {title}
      </div>
      <div>
        {rows.map((r) => (
          <div
            key={r.label}
            className="flex items-baseline justify-between gap-2"
            style={{ padding: "1px 0", color: r.fired ? C.ember : r.ineligible ? C.slate : C.chalk }}
          >
            <span>{r.label}</span>
            <span className="whitespace-nowrap">
              {r.cp !== undefined && (
                <span style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{r.cp} CP</span>
              )}
              {(r.fired || r.ineligible) && (
                <span style={{ fontSize: "0.55rem", letterSpacing: "0.04em", marginLeft: r.cp !== undefined ? 4 : 0 }}>
                  {r.fired ? "FIRED" : "inelig."}
                </span>
              )}
              {r.cp === undefined && !r.fired && !r.ineligible && (
                <span style={{ fontSize: "0.55rem", letterSpacing: "0.04em" }}>eligible</span>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

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

const RULES_SECTIONS = [
  {
    id: "general",
    title: "General Rules",
    items: [
      "All leagues share the same roster, waivers, draft, and scoring settings, and use only NFL players.",
      "A coach may only have one team of record at a time — qualified veteran coaches may also take on Interim or Legacy coaching jobs.",
      "All coaches must attempt to set a competitive lineup of starting, healthy players.",
      "Insulting and disrespectful behavior will not be tolerated. Keep chats to friendly football talk and avoid incendiary subjects.",
    ],
  },
  {
    id: "trades",
    title: "Trades",
    items: [
      "Trades will not be pushed through early — a 24-hour trade review is in effect (midnight to midnight the day after the trade; can take up to 48 hours to fully complete).",
      "There's a trade \"speed limit\" and a deadline to get a player rostered by game day. Players who've already played are locked until Wednesday regardless of when the trade was accepted.",
      "Trades can be reversed at the league/commissioner/president's discretion — you're the head coach, not the owner, and the AD/GM/owner can overrule you (rare, but done to keep leagues competitive).",
      "Renting/borrowing players is prohibited — a player can't be traded back to their original team within the same season.",
      "The trade deadline is Week 13.",
    ],
  },
  {
    id: "changing-teams",
    title: "Changing Teams & Promotion",
    items: [
      "Jobs go to the coach with the highest Promotion Score who correctly applies by the deadline.",
      "Coaches may move only once per offseason (promotion or demotion), and can't move within their current conference — except to/from the NFL.",
      "Qualified coaches may move up OR down the tiers.",
      "Coaches inactive for three consecutive weeks during the regular season are subject to termination — if you know you'll be busy, just let the Alliance know ahead of time.",
    ],
  },
  {
    id: "promoted",
    title: "What Gets You Promoted",
    items: [
      "Scoring points, league high score, wins, winning streaks, best manager, being frugal with your FAAB, winning playoff games, and winning your league.",
      "Coaching points accumulate season by season, so long-term success is rewarded over any one great season.",
      "Coaching score = (Place + Wins + Points + FAAB + Performance Bonuses + League Difficulty) × Pts/Max. See the Coaches Scoring System tab for the complete list of bonus points and penalties.",
      "You must qualify for a promotion — the last-11-placed NFL teams, the last-7-placed teams in 20-team leagues, and the last-5-placed teams in 16-team leagues are all ineligible for a coaching move up or down. That turns one game in the consolation bracket into a win-for-promotion scenario.",
    ],
  },
  {
    id: "x-points",
    title: "X Points",
    intro: "X Points are performance bonuses that feed into your Coaching Points. They can go negative too — beware a losing streak or the worst-manager tag.",
    rows: [
      { value: "3", label: "League weekly high score" },
      { value: "-3", label: "League weekly low score" },
      { value: "5", label: "Alliance weekly high score" },
      { value: "-5", label: "Alliance weekly low score" },
      { value: "3", label: "League weekly best manager" },
      { value: "-3", label: "League weekly worst manager" },
      { value: "1", label: "Per game, 4-7 wins in a row" },
      { value: "2", label: "Per game, 8-11 wins in a row" },
      { value: "3", label: "Per game, 12+ wins in a row" },
      { value: "5", label: "Per game, 16+ wins in a row" },
      { value: "-1", label: "Per game, 4-7 losses in a row in a single season" },
      { value: "-2", label: "Per game, 8-11 losses in a row in a single season" },
      { value: "-3", label: "Per game, 12-15 losses in a row in a single season" },
      { value: "-5", label: "Per game, 16+ losses in a row in a single season" },
      { value: "1", label: "Every win over 10 in a regular season" },
      { value: "-1", label: "Every loss over 10 in a regular season" },
      { value: "5", label: "Most points in conference in regular season" },
      { value: "-5", label: "Least points in conference in regular season" },
      { value: "15", label: "Most points in Alliance in regular season" },
      { value: "-15", label: "Least points in Alliance in regular season" },
      { value: "5", label: "Division/district winner" },
      { value: "7", label: "8-team conference winner" },
      { value: "10", label: "16-team conference winner" },
      { value: "5, 7, 9…", label: "Consecutive division/district champion" },
      { value: "7, 9, 11…", label: "Consecutive 8-team conference winner" },
      { value: "10, 13, 16…", label: "Consecutive 16-team conference champion" },
      { value: "25, 35, 45…", label: "Consecutive league champion" },
      { value: "3", label: "Playoff win" },
      { value: "50", label: "Undefeated season (including playoffs)" },
      { value: "10", label: "Breaking an Alliance record" },
    ],
  },
  {
    id: "fired",
    title: "What Gets You Fired",
    items: [
      "\"Fired\" means unassigned from your team, not removed from the league — your team becomes available for other coaches to take.",
      "A coach fired after the regular season is still in the Alliance; the team is managed by an interim coach until reassigned.",
      "Finishing last place in a league's consolation bracket triggers this.",
      "Fired coaches may reapply to their old team — if no one else takes it, they get it back. Fired coaches may not apply to a team in a higher tier.",
      "A conference representative can appeal to the Commissioner's Council on a fired coach's behalf if there are extenuating circumstances.",
    ],
  },
  {
    id: "penalties",
    title: "Penalties",
    intro: "Penalties for recurring infractions will increase, and may also include FAAB or draft pick deductions on top of the coaching-score hit.",
    rows: [
      { value: "-1", label: "Not tagging the next player in a draft" },
      { value: "-2", label: "Delay of game" },
      { value: "-5", label: "Unsportsmanlike conduct" },
      { value: "-5", label: "Uniform violation (team name or logo), enforced each week" },
      { value: "-10", label: "Mishandling a player transaction, accidental or otherwise (first offense)" },
      { value: "-15", label: "Mishandling a player transaction, accidental or otherwise (second offense)" },
      { value: "-25", label: "Deliberate tanking or incomplete lineup" },
      { value: "-25", label: "Repick/replace a player during draft" },
      { value: "-50", label: "Backing out of a trade (even if a mistake)" },
      { value: "-100", label: "Accepting a new team and backing out" },
      { value: "-X", label: "Rules infractions can be any amount proportional to the infraction" },
    ],
  },
  {
    id: "penalties-playoffs",
    title: "Playoffs",
    items: [
      "Playoffs are run via spreadsheet (see the pinned link in your league chat). Tiebreakers: W-L, then Points For, then Pts/Max.",
      "NFL: each conference sends its four division winners and four wildcard teams from any division in that conference — one division could send every team.",
      "Leagues without conferences (SEC, Big 12, ACC, Big Ten) send their top 8 teams.",
      "Leagues with two conferences (Sun Belt, SoCo, Ivy, SWAC, GLIAC) send an equal number of teams per conference.",
      "High School (FLHS) sends district winners plus the next-best teams from any division/district — one division could send every team.",
      "Draft order is based on final standings after playoffs and consolation brackets — tanking isn't the best option, winners get the better picks.",
    ],
  },
  {
    id: "team-management",
    title: "Team Management",
    items: [
      "FAAB is based on the actual NFL salary cap and matches that number each season. It resets at the start of the Sleeper/league season in March, and unused FAAB does not carry over.",
      "Waivers are active for the entire offseason except during the fantasy draft, and begin again the first available Wednesday after the draft ends.",
      "Only rookies may be placed on the Taxi squad, and players can't return to Taxi once activated to the roster or IR. The Taxi squad locks at the start of the NFL season's first game.",
      "Roster management is your responsibility — mismanaging a transaction (drafting, dropping, or trading the wrong player) carries heavy penalties if a correction is even allowed.",
    ],
  },
  {
    id: "coach-types",
    title: "Coach Types & Contracts",
    items: [
      "Orphan Teams: managed by the Alliance until a replacement is found, then offered to the best-qualified coach during the offseason coaching-change period.",
      "Interim Coaches: step in when a coach unexpectedly \"retires\" mid-season. A coach taking over an inactive team after the NFL season has already begun is specifically called an Interim Coach. Their mission is to keep the team and league competitive and leave behind a team someone else will want next season. No trade privileges, but add/drop and waivers are allowed.",
      "One Year Contract: offered to veteran coaches taking a team before the season starts, instead of adding a rookie coach. Full trade and add/drop privileges, plus a small coaching-point bonus based on the team's final performance.",
      "Playoff Contract: keeps the job as long as the team stays in the playoffs — offered to temporary coaches who excel, or as an incentive for legacy coaches to stay on top or step aside. Full trade and add/drop privileges.",
      "Legacy Teams: \"permanent\" positions meant to add stability to lower-tier leagues, decided case by case (popular teams/conferences are in demand). Full trade privileges, but no coaching bonuses accrue toward promotion — it's a separate project, purely for team pride and league competition. Coaching stats for promotion are only ever determined by a coach's actual Team of Record. As leagues fill and stabilize, even legacy coaches will eventually have to retire and pass the torch to another coach.",
    ],
  },
  {
    id: "special",
    title: "High School & Week 18",
    items: [
      "The winner of the High School league may change their team's name and mascot to their high school of choice.",
      "Relegated coaches in High School's lowest conference can be fired and replaced by a new player, but may go to the back of the waiting list for another team.",
      "Week 18 is rivalry week — arrange a matchup with a buddy if you want. Week 18 stats do NOT count toward your coaching score.",
    ],
  },
  {
    id: "org",
    title: "League Organization & Voting",
    items: [
      "President: elected by league representatives, can be voted out by a majority of them. Holds commissioner powers over all leagues and enforces league/player compliance.",
      "Vice Presidents: the President selects at least two. They share the administrative workload and have full Presidential commissioner powers, ready to run every facet of the Alliance if the President becomes unavailable.",
      "Representative: elected by (or a volunteer from) each league. Can be removed by the President, a league majority, or a majority of representatives. Elects the President, negotiates rule changes during a designated offseason period, enforces league rules, manages inactive teams, and keeps a day-to-day eye on trades and behavior.",
      "Voting power: President (8 votes), Vice President (4 votes), Representative (2 votes), Coach (1 vote).",
    ],
  },
];

// Everything below is transcribed from her Sleeper scoring/roster/league
// settings export (2026-08-03 CSV). Three deliberate omissions, all to
// avoid duplicating RULES_SECTIONS above rather than any data gap:
//  - Team DEF and Special Teams DEF are both entirely "off" in the export
//    (every single line item) — real, not a parsing miss, confirmed by
//    counting: 0 of 40 Team DEF rows and 0 of 6 Special Teams DEF rows have
//    a Points value. Omitted as whole sections; nothing there to show.
//  - "Bonus" (100-199yd Rush Game, etc.) is a defined category with all 14
//    line items present but zero of them have a Points value set either —
//    also omitted, also confirmed by count, not an oversight.
//  - Trade deadline (Week 13) and the general trade-review window are
//    already stated in the "Trades" section above — not repeated here.
const SETTINGS_SCORING_SECTIONS = [
  {
    id: "settings-passing",
    title: "Passing",
    rows: [
      { value: "0.05", label: "Passing Yards", note: "1 pt per 20 yds" },
      { value: "5", label: "Passing TD" },
      { value: "2", label: "2pt Conversion" },
      { value: "-1.25", label: "Pass Intercepted" },
    ],
  },
  {
    id: "settings-rushing",
    title: "Rushing",
    rows: [
      { value: "0.1", label: "Rushing Yards", note: "1 pt per 10 yds" },
      { value: "6", label: "Rushing TD" },
      { value: "2", label: "2pt Conversion" },
    ],
  },
  {
    id: "settings-receiving",
    title: "Receiving",
    rows: [
      { value: "1", label: "Reception" },
      { value: "0.1", label: "Receiving Yards", note: "1 pt per 10 yds" },
      { value: "6", label: "Receiving TD" },
      { value: "2", label: "2pt Conversion" },
    ],
  },
  {
    id: "settings-kicking",
    title: "Kicking",
    rows: [
      { value: "1", label: "FG Made 50+" },
      { value: "0.1", label: "Points per FG Yard", note: "1 pt per 10 yds — longer FGs score more" },
      { value: "1", label: "PAT Made" },
      { value: "-5", label: "FG Missed 0-19" },
      { value: "-4", label: "FG Missed 20-29" },
      { value: "-3", label: "FG Missed 30-39" },
      { value: "-2", label: "FG Missed 40-49" },
      { value: "-1", label: "FG Missed 50+" },
      { value: "-3", label: "PAT Missed" },
    ],
  },
  {
    id: "settings-st-player",
    title: "Special Teams Player",
    intro: "Return specialists, not the DEF/ST unit itself.",
    rows: [
      { value: "6", label: "TD" },
      { value: "3", label: "Forced Fumble" },
      { value: "3", label: "Recovery" },
      { value: "1", label: "Solo Tackle" },
      { value: "0.1", label: "Punt Return Yds", note: "1 pt per 10 yds" },
      { value: "0.1", label: "Kick Return Yds", note: "1 pt per 10 yds" },
    ],
  },
  {
    id: "settings-misc",
    title: "Misc",
    rows: [
      { value: "-1", label: "Fumble" },
      { value: "-2", label: "Fumble Lost" },
      { value: "6", label: "Fumble Recovery TD" },
    ],
  },
  {
    id: "settings-idp",
    title: "IDP",
    rows: [
      { value: "6", label: "IDP TD" },
      { value: "7", label: "Sack" },
      { value: "0.5", label: "Hit on QB" },
      { value: "4", label: "Tackle for a Loss" },
      { value: "3", label: "Blocked Punt/PAT/FG" },
      { value: "7", label: "INT" },
      { value: "0.1", label: "INT Return Yds", note: "1 pt per 10 yds" },
      { value: "3", label: "Fumble Recovery" },
      { value: "0.1", label: "Fumble Return Yds", note: "1 pt per 10 yds" },
      { value: "3", label: "Forced Fumble" },
      { value: "3", label: "Safety" },
      { value: "0.5", label: "Assisted Tackle" },
      { value: "1", label: "Solo Tackle" },
      { value: "4", label: "Pass Defended" },
    ],
  },
];

// Starting lineup composition, spelled out once rather than as 20 separate
// roster-slot rows (the CSV lists QB/RB1/RB2/.../DB3 as individual rows
// since that's how a roster export enumerates seats, not because each
// needs its own line on a rules page).
const SETTINGS_ROSTER = {
  starters: [
    "QB", "2 RB", "3 WR", "TE", "W/R/T FLEX", "K", "2 IDP FLEX", "3 DL", "3 LB", "3 DB",
  ],
  bench: 20,
  ir: 6,
  taxi: 8,
};

const SETTINGS_LEAGUE_SECTIONS = [
  {
    id: "settings-waivers",
    title: "FAAB & Waivers",
    items: [
      "FAAB budget: $256 — matches the NFL salary cap and resets each season (Feb/Mar).",
      "Waivers are active the entire offseason. Minimum bid $1.",
      "Clears Wednesday 3am EDT and processes at 11am EDT. Players stay on waivers after their game until then.",
      "A dropped player waits 1 day on waivers before anyone can claim them.",
      "Weekly schedule: Monday free agency \u00b7 Tuesday locked \u00b7 Wednesday\u2013Saturday waivers (Saturday also FA) \u00b7 Sunday free agency.",
    ],
  },
  {
    id: "settings-draft",
    title: "Draft",
    items: ["Draft pick trading is allowed.", "Roster moves are allowed pre-draft."],
  },
  {
    id: "settings-playoffs-start",
    title: "Playoffs Start",
    items: ["NFL, USFL, XFL: Week 14.", "All sixteen-team leagues: Week 15."],
  },
  {
    id: "settings-ir",
    title: "IR Eligibility",
    items: [
      "A player may go on IR for: COVID-19, Out, Suspended, NA, DNR/Holdout/Opt-out, or Doubtful status.",
    ],
  },
  {
    id: "settings-taxi",
    title: "Taxi Squad",
    items: [
      "Only rookies may be placed on the Taxi Squad.",
      "Eligibility length depends on tier: NFL 4 years \u00b7 USFL/XFL 3 years \u00b7 all sixteen-team leagues 2 years.",
      "The Taxi Squad locks at the start of the first regular season game.",
    ],
  },
];

const CLUB_300 = [
  { coach: "Harvey28", team: "Carolina Chanticleers", conf: "SUN", pts: 388.1, week: 15, year: 2022 },
  { coach: "mchostetler1", team: "Florida Gators", conf: "SEC", pts: 384.85, week: 2, year: 2024 },
  { coach: "ChicagoOnTop", team: "Los Angeles Xtreme", conf: "XFL", pts: 362.05, week: 4, year: 2023 },
  { coach: "Sb428", team: "Bethune-Cookman Wildcats", conf: "SWAC", pts: 361.6, week: 9, year: 2024 },
  { coach: "samwow123", team: "Austin Peay Governors", conf: "SOCO", pts: 361.05, week: 4, year: 2022 },
  { coach: "DirtyByrd30", team: "Jackson State Tigers", conf: "SWAC", pts: 352.0, week: 7, year: 2025 },
  { coach: "RifeLife520", team: "Oklahoma Sooners", conf: "SEC", pts: 348.35, week: 8, year: 2023 },
  { coach: "DrunkFootball", team: "South Dakota State Jackrabbits", conf: "XII", pts: 347.2, week: 4, year: 2025 },
  { coach: "FoggyBuckets", team: "Pittsburgh Maulers", conf: "USFL", pts: 344.8, week: 1, year: 2023 },
  { coach: "OlaveGarden18", team: "Morgan State Bears", conf: "SWAC", pts: 344.35, week: 12, year: 2024 },
  { coach: "beardmantv", team: "Auburn Tigers", conf: "SEC", pts: 342.45, week: 2, year: 2022 },
  { coach: "DirtyByrd30", team: "Jackson State Tigers", conf: "SWAC", pts: 342.1, week: 4, year: 2025 },
  { coach: "CrazyKirt", team: "UCLA Bruins", conf: "TEN", pts: 339.95, week: 12, year: 2024 },
  { coach: "PwnRangr", team: "West Carolina Catamounts", conf: "SOCO", pts: 339.1, week: 7, year: 2025 },
  { coach: "RedPhoenix437", team: "Los Angeles Express", conf: "USFL", pts: 338.05, week: 7, year: 2025 },
  { coach: "Wynnguy", team: "Brown Bears", conf: "IVY", pts: 336.25, week: 8, year: 2023 },
  { coach: "RifeLife520", team: "App State Mountaineers", conf: "SUN", pts: 335.9, week: 13, year: 2024 },
  { coach: "vvJuice", team: "WI Parkside Rangers", conf: "GLIAC", pts: 333.25, week: 3, year: 2023 },
  { coach: "Broncos8804", team: "Coral Springs Colts", conf: "FLHS", pts: 332.8, week: 12, year: 2025 },
  { coach: "ahdi", team: "Chattanooga Mocs", conf: "SOCO", pts: 330.95, week: 17, year: 2024 },
  { coach: "CrazyKirt", team: "UCLA Bruins", conf: "TEN", pts: 329.85, week: 13, year: 2024 },
  { coach: "Edixon2", team: "Baldwin Yellow Jackets", conf: "GLIAC", pts: 328.9, week: 8, year: 2023 },
  { coach: "mattbanks3x", team: "San Antonio Gunslingers", conf: "USFL", pts: 328.65, week: 15, year: 2025 },
  { coach: "cre8t1v3", team: "The Citadel Bulldogs", conf: "SOCO", pts: 328.15, week: 4, year: 2023 },
  { coach: "PwnRangr", team: "Louisville Cardinals", conf: "ACC", pts: 328.0, week: 14, year: 2024 },
  { coach: "ColBow", team: "Cypress Bay Lightning", conf: "FLHS", pts: 327.45, week: 4, year: 2023 },
  { coach: "JuugKing", team: "Georgia State Panthers", conf: "SUN", pts: 327.4, week: 15, year: 2025 },
  { coach: "zeheros", team: "Georgia Tech Yellowjackets", conf: "ACC", pts: 326.6, week: 14, year: 2022 },
  { coach: "Roedshow502", team: "Little Rock Trojans", conf: "SUN", pts: 326.6, week: 9, year: 2024 },
  { coach: "mattbanks3x", team: "San Antonio Gunslingers", conf: "USFL", pts: 325.75, week: 3, year: 2023 },
  { coach: "MambasDisciples", team: "PVAMU Panthers", conf: "SWAC", pts: 325.6, week: 17, year: 2023 },
  { coach: "Noga2003", team: "Memphis Showboats", conf: "USFL", pts: 325.4, week: 16, year: 2024 },
  { coach: "MrCoolBuns", team: "Seattle Dragons", conf: "XFL", pts: 324.2, week: 5, year: 2024 },
  { coach: "crb2121", team: "South Alabama Jaguars", conf: "SUN", pts: 324.2, week: 7, year: 2025 },
  { coach: "Dylan3380", team: "Florida State Seminoles", conf: "ACC", pts: 323.05, week: 4, year: 2025 },
  { coach: "MambasDisciples", team: "PVAMU Panthers", conf: "SWAC", pts: 323.0, week: 12, year: 2023 },
  { coach: "koala530", team: "Boca Raton Wolverines", conf: "FLHS", pts: 322.85, week: 4, year: 2025 },
  { coach: "Sb428", team: "Bethune-Cookman Wildcats", conf: "SWAC", pts: 322.8, week: 4, year: 2023 },
  { coach: "dark-sarcasm9", team: "Old Dominion Monarchs", conf: "SUN", pts: 321.95, week: 4, year: 2022 },
  { coach: "Dylan3380", team: "Florida State Seminoles", conf: "ACC", pts: 321.8, week: 10, year: 2024 },
  { coach: "z1856z", team: "DC Defenders", conf: "XFL", pts: 321.5, week: 12, year: 2025 },
  { coach: "Motty", team: "Tampa Bay Bandits", conf: "USFL", pts: 320.85, week: 14, year: 2022 },
  { coach: "Jaquise", team: "Austin Peay Governors", conf: "SOCO", pts: 320.85, week: 5, year: 2024 },
  { coach: "Broncos8804", team: "Coral Springs Colts", conf: "FLHS", pts: 320.65, week: 2, year: 2025 },
  { coach: "WillStephensSr", team: "Alabama State Hornets", conf: "SWAC", pts: 320.45, week: 8, year: 2023 },
  { coach: "TheWOAT100", team: "Wayne State Warriors", conf: "GLIAC", pts: 319.7, week: 8, year: 2023 },
  { coach: "Wynnguy", team: "Brown Bears", conf: "IVY", pts: 318.55, week: 12, year: 2022 },
  { coach: "NunYaBizNezz", team: "Lake Superior Lakers", conf: "GLIAC", pts: 318.0, week: 9, year: 2023 },
  { coach: "srcav", team: "Purdue Boilermakers", conf: "TEN", pts: 318.0, week: 15, year: 2025 },
  { coach: "GarrettBFF", team: "Atlanta Legends", conf: "XFL", pts: 317.85, week: 10, year: 2024 },
  { coach: "JuugKing", team: "Georgia State Panthers", conf: "SUN", pts: 317.45, week: 2, year: 2024 },
  { coach: "MambasDisciples", team: "PVAMU Panthers", conf: "SWAC", pts: 317.25, week: 8, year: 2023 },
  { coach: "Landshark18", team: "Baltimore Ravens", conf: "NFL", pts: 316.65, week: 3, year: 2023 },
  { coach: "DLeggett", team: "West Virginia Mountaineers", conf: "XII", pts: 316.5, week: 8, year: 2022 },
  { coach: "FoggyBuckets", team: "Alabama State Hornets", conf: "SWAC", pts: 316.35, week: 15, year: 2022 },
  { coach: "TimeforTua", team: "Northwood Timberwolves", conf: "GLIAC", pts: 316.2, week: 15, year: 2024 },
  { coach: "SVerfin", team: "Butler Bulldogs", conf: "PION", pts: 315.9, week: 15, year: 2022 },
  { coach: "spicyftbaltakes", team: "TCU Horned Frogs", conf: "XII", pts: 315.15, week: 16, year: 2022 },
  { coach: "evanthomas536", team: "Southern U Jaguars", conf: "SWAC", pts: 314.65, week: 2, year: 2022 },
  { coach: "BBlew52", team: "Georgia Bulldogs", conf: "SEC", pts: 314.2, week: 13, year: 2025 },
  { coach: "Harold2576", team: "Davenport Panthers", conf: "GLIAC", pts: 313.65, week: 13, year: 2024 },
  { coach: "runhaags", team: "Arkansas State Red Wolves", conf: "SUN", pts: 313.5, week: 17, year: 2024 },
  { coach: "acubes21", team: "Belmont Bruins", conf: "SOCO", pts: 313.3, week: 16, year: 2024 },
  { coach: "Goobravich", team: "Northern Colorado Bears", conf: "XII", pts: 312.95, week: 5, year: 2024 },
  { coach: "Dilly314", team: "Georgetown Hoyas", conf: "IVY", pts: 312.75, week: 17, year: 2024 },
  { coach: "StokesCity", team: "Western Wildcats", conf: "FLHS", pts: 312.5, week: 15, year: 2024 },
  { coach: "TuaLegitTuaQuit99", team: "Capital Comets", conf: "GLIAC", pts: 312.45, week: 11, year: 2024 },
  { coach: "Calvins22", team: "Tennessee Volunteers", conf: "SEC", pts: 312.4, week: 12, year: 2024 },
  { coach: "Vikesfan", team: "St Louis Battlehawks", conf: "XFL", pts: 312.3, week: 2, year: 2022 },
  { coach: "zradams17", team: "Kentucky Wildcats", conf: "SEC", pts: 312.2, week: 3, year: 2022 },
  { coach: "MrCoolBuns", team: "Seattle Dragons", conf: "XFL", pts: 312.2, week: 7, year: 2022 },
  { coach: "PwnRangr", team: "Miami Beach Hi-Tides", conf: "FLHS", pts: 312.2, week: 17, year: 2023 },
  { coach: "CrazyKirt", team: "UCLA Bruins", conf: "TEN", pts: 312.15, week: 16, year: 2023 },
  { coach: "PwnRangr", team: "Kentucky Wildcats", conf: "SEC", pts: 311.9, week: 12, year: 2025 },
  { coach: "DirtyByrd30", team: "Jackson State Tigers", conf: "SWAC", pts: 311.65, week: 2, year: 2022 },
  { coach: "zero00", team: "New Jersey Generals", conf: "USFL", pts: 311.6, week: 12, year: 2025 },
  { coach: "g8trb8", team: "Denver Broncos", conf: "NFL", pts: 311.2, week: 16, year: 2024 },
  { coach: "StokesCity", team: "Western Wildcats", conf: "FLHS", pts: 310.8, week: 7, year: 2025 },
  { coach: "amkm324", team: "Louisville Cardinals", conf: "ACC", pts: 310.65, week: 11, year: 2022 },
  { coach: "JJBInc", team: "Palmetto Panthers", conf: "FLHS", pts: 310.35, week: 12, year: 2022 },
  { coach: "cspeece", team: "James Madison Dukes", conf: "SUN", pts: 310.0, week: 10, year: 2025 },
  { coach: "samwow123", team: "South Carolina Gamecocks", conf: "SEC", pts: 309.65, week: 11, year: 2025 },
  { coach: "DirtyByrd30", team: "Jackson State Tigers", conf: "SWAC", pts: 309.6, week: 2, year: 2025 },
  { coach: "DirtyByrd30", team: "Jackson State Tigers", conf: "SWAC", pts: 309.3, week: 15, year: 2025 },
  { coach: "Fin3", team: "Alabama Crimson Tide", conf: "SEC", pts: 309.25, week: 13, year: 2024 },
  { coach: "db091391", team: "Boston College Eagles", conf: "ACC", pts: 308.9, week: 6, year: 2024 },
  { coach: "PwnRangr", team: "Kentucky Wildcats", conf: "SEC", pts: 308.8, week: 11, year: 2023 },
  { coach: "fantasyTren", team: "Mercer Bears", conf: "SOCO", pts: 308.8, week: 12, year: 2025 },
  { coach: "MambasDisciples", team: "PVAMU Panthers", conf: "SWAC", pts: 308.6, week: 15, year: 2023 },
  { coach: "teej1007", team: "James Madison Dukes", conf: "SUN", pts: 308.4, week: 10, year: 2025 },
  { coach: "Jay21177", team: "Washington Huskies", conf: "TEN", pts: 308.35, week: 2, year: 2024 },
  { coach: "TylerWT003", team: "Virginia Tech Hokies", conf: "ACC", pts: 308.35, week: 4, year: 2025 },
  { coach: "CrazyKirt", team: "UCLA Bruins", conf: "TEN", pts: 308.3, week: 17, year: 2024 },
  { coach: "samwow123", team: "South Carolina Gamecocks", conf: "SEC", pts: 308.25, week: 10, year: 2024 },
  { coach: "TheColburnator01", team: "Bucknell Bison", conf: "IVY", pts: 308.2, week: 11, year: 2023 },
  { coach: "treetwig", team: "Little Rock Trojans", conf: "SUN", pts: 307.9, week: 9, year: 2023 },
  { coach: "spicyftbaltakes", team: "TCU Horned Frogs", conf: "XII", pts: 307.85, week: 6, year: 2022 },
  { coach: "DirtyByrd30", team: "Jackson State Tigers", conf: "SWAC", pts: 307.85, week: 13, year: 2024 },
  { coach: "CrazyKirt", team: "UCLA Bruins", conf: "TEN", pts: 307.75, week: 10, year: 2024 },
  { coach: "FoggyBuckets", team: "Alabama State Hornets", conf: "SWAC", pts: 307.7, week: 3, year: 2023 },
  { coach: "ZiplocBaggins", team: "Baylor Bears", conf: "XII", pts: 307.6, week: 15, year: 2022 },
  { coach: "Brandonaut", team: "Syracuse Orange", conf: "ACC", pts: 307.15, week: 2, year: 2022 },
  { coach: "ColBow", team: "Cypress Bay Lightning", conf: "FLHS", pts: 306.95, week: 9, year: 2022 },
  { coach: "Wynnguy", team: "Brown Bears", conf: "IVY", pts: 306.8, week: 4, year: 2025 },
  { coach: "treetwig", team: "Pine Bluff Golden Lions", conf: "SWAC", pts: 306.65, week: 15, year: 2023 },
  { coach: "catinthehat2", team: "St Francis Red Flash", conf: "PION", pts: 306.4, week: 6, year: 2023 },
  { coach: "WillStephensSr", team: "Alabama State Hornets", conf: "SWAC", pts: 306.35, week: 2, year: 2022 },
  { coach: "heavyd1017", team: "Miss State Bulldogs", conf: "SEC", pts: 306.35, week: 5, year: 2022 },
  { coach: "beardmantv", team: "Auburn Tigers", conf: "SEC", pts: 306.25, week: 6, year: 2023 },
  { coach: "Wynnguy", team: "Brown Bears", conf: "IVY", pts: 305.95, week: 15, year: 2025 },
  { coach: "SpacebarRacecar", team: "The Citadel Bulldogs", conf: "SOCO", pts: 305.75, week: 3, year: 2022 },
  { coach: "Firephool", team: "Oklahoma State Cowboys", conf: "XII", pts: 305.6, week: 14, year: 2022 },
  { coach: "2neufbettix", team: "New York Guardians", conf: "XFL", pts: 305.6, week: 5, year: 2024 },
  { coach: "KShooter15", team: "Ferris State Bulldogs", conf: "GLIAC", pts: 305.15, week: 8, year: 2022 },
  { coach: "Brandonaut", team: "Syracuse Orange", conf: "ACC", pts: 305.0, week: 10, year: 2024 },
  { coach: "Harvey28", team: "Carolina Chanticleers", conf: "SUN", pts: 304.9, week: 8, year: 2023 },
  { coach: "RifeLife520", team: "Oklahoma Sooners", conf: "SEC", pts: 304.8, week: 9, year: 2022 },
  { coach: "babba10101", team: "Penn Quakers", conf: "IVY", pts: 304.8, week: 15, year: 2022 },
  { coach: "MambasDisciples", team: "PVAMU Panthers", conf: "SWAC", pts: 304.65, week: 8, year: 2024 },
  { coach: "ravenger", team: "Kansas City Chiefs", conf: "NFL", pts: 304.1, week: 6, year: 2023 },
  { coach: "SpacebarRacecar", team: "The Citadel Bulldogs", conf: "SOCO", pts: 304.0, week: 9, year: 2022 },
  { coach: "Jaquise", team: "Austin Peay Governors", conf: "SOCO", pts: 303.9, week: 11, year: 2024 },
  { coach: "z1856z", team: "Mississippi Valley Delta Devils", conf: "SWAC", pts: 303.9, week: 12, year: 2025 },
  { coach: "alexfinnis", team: "Missouri Tigers", conf: "SEC", pts: 303.8, week: 9, year: 2024 },
  { coach: "Coopdaddy510", team: "Arizona Wildcats", conf: "PAC 12", pts: 303.65, week: 15, year: 2022 },
  { coach: "beardmantv", team: "Auburn Tigers", conf: "SEC", pts: 303.65, week: 8, year: 2024 },
  { coach: "TheColburnator01", team: "Bucknell Bison", conf: "IVY", pts: 303.5, week: 8, year: 2024 },
  { coach: "wdh76", team: "Iowa State Cyclones", conf: "XII", pts: 303.05, week: 6, year: 2023 },
  { coach: "DirtyByrd30", team: "Jackson State Tigers", conf: "SWAC", pts: 302.95, week: 6, year: 2025 },
  { coach: "TylerWT003", team: "Virginia Tech Hokies", conf: "ACC", pts: 302.6, week: 3, year: 2025 },
  { coach: "TylerWT003", team: "Virginia Tech Hokies", conf: "ACC", pts: 302.6, week: 7, year: 2025 },
  { coach: "PwnRangr", team: "Miami Beach Hi-Tides", conf: "FLHS", pts: 302.3, week: 6, year: 2025 },
  { coach: "Newkbomb", team: "Orlando Rage", conf: "XFL", pts: 302.25, week: 2, year: 2025 },
  { coach: "RFlores29", team: "Muskingum Fighting Muskies", conf: "GLIAC", pts: 302.0, week: 17, year: 2024 },
  { coach: "AZiv49", team: "Clemson Tigers", conf: "ACC", pts: 301.95, week: 8, year: 2025 },
  { coach: "Firephool", team: "Oklahoma State Cowboys", conf: "XII", pts: 301.9, week: 15, year: 2025 },
  { coach: "beardmantv", team: "Auburn Tigers", conf: "SEC", pts: 301.8, week: 1, year: 2023 },
  { coach: "cschaller", team: "Notre Dame Fighting Irish", conf: "ACC", pts: 301.8, week: 6, year: 2023 },
  { coach: "JJBInc", team: "Lake Superior Lakers", conf: "GLIAC", pts: 301.7, week: 17, year: 2024 },
  { coach: "glang727", team: "Grambling State Tigers", conf: "SWAC", pts: 301.6, week: 16, year: 2023 },
  { coach: "TheColburnator01", team: "Bucknell Bison", conf: "IVY", pts: 301.45, week: 5, year: 2023 },
  { coach: "Jorgeortiz11", team: "JCU Blue Streaks", conf: "GLIAC", pts: 300.95, week: 15, year: 2025 },
  { coach: "JuugKing", team: "Georgia State Panthers", conf: "SUN", pts: 300.9, week: 5, year: 2023 },
  { coach: "MrCoolBuns", team: "Seattle Dragons", conf: "XFL", pts: 300.75, week: 10, year: 2023 },
  { coach: "NunYaBizNezz", team: "Palmetto Panthers", conf: "FLHS", pts: 300.65, week: 1, year: 2023 },
  { coach: "babba10101", team: "Penn Quakers", conf: "IVY", pts: 300.6, week: 8, year: 2025 },
  { coach: "MambasDisciples", team: "PVAMU Panthers", conf: "SWAC", pts: 300.55, week: 14, year: 2023 },
  { coach: "cspeese22", team: "Ohio Northern Polar Bears", conf: "GLIAC", pts: 300.45, week: 16, year: 2023 },
  { coach: "samwow123", team: "Austin Peay Governors", conf: "SOCO", pts: 300.35, week: 15, year: 2022 },
  { coach: "Vastettler", team: "Muskingum Fighting Muskies", conf: "GLIAC", pts: 300.35, week: 2, year: 2023 },
  { coach: "TomJohnMike", team: "Duke Blue Devils", conf: "ACC", pts: 300.35, week: 9, year: 2025 },
  { coach: "hockeydoug", team: "Houston Cougars", conf: "XII", pts: 300.25, week: 17, year: 2024 },
  { coach: "jaquise", team: "Austin Peay Governors", conf: "SOCO", pts: 300.1, week: 6, year: 2022 },
  { coach: "finnbar3", team: "Detroit Drive", conf: "USFL", pts: 300.05, week: 3, year: 2023 },
];

// Leaderboards derived directly from CLUB_300 itself, so they can never
// drift out of sync with the list players actually see. Kept as a plain
// function (not a module-level constant) since the 300 Club tab now merges
// this static list with live-detected entries — the merge has to happen
// inside the component (useMemo, keyed on club300Live) where that state lives.
function tally(arr, keyFn) {
  const counts = {};
  arr.forEach((item) => {
    const k = keyFn(item);
    counts[k] = (counts[k] || 0) + 1;
  });
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

// Weekly Awards' "Bench Points" category — total roster points minus
// starter points, i.e. what got left on the bench. Sleeper's matchup
// response already carries both pieces (players_points has every rostered
// player, starters lists which of them were active), so this needs no
// lineup optimizer, no roster_positions fetch, no position-eligibility
// logic. Floors at 0 rather than going negative on a bye-week/partial-data
// response where players_points might not fully cover starters.
function benchPointsFor(t) {
  const pp = t.players_points || {};
  const total = Object.values(pp).reduce((s, v) => s + (v || 0), 0);
  const started = typeof t.points === "number" ? t.points : 0;
  return Math.max(0, total - started);
}

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

// Win % as three digits, no percent sign — ".750" not "75.0%". `n` comes in
// as a percentage (e.g. 75.0, matching how CAREER_STATS's "Win %" strings
// already read once the % is stripped). Rounds, doesn't truncate, so it
// matches what the raw percentage would round to at one decimal.
const winPctLabel = (n) => {
  const frac = n / 100;
  const thousandths = Math.round(frac * 1000);
  if (thousandths >= 1000) return "1.000";
  if (thousandths <= 0) return ".000";
  return `.${thousandths.toString().padStart(3, "0")}`;
};

const ago = (ts) => {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
};

// ── Conference Strength — Troy's original spreadsheet metric, rebuilt.
// Two comparison pools: the 10-tier "Alliance" (everything below the pro
// tiers), and USFL+XFL compared only against each other. NFL has no pool to
// compare against, so it gets no score. All inputs are season-total points,
// already present in standingsCache — nothing new to fetch.
const ALLIANCE_POOL = ["SEC", "BIG XII", "ACC", "TEN", "SUN", "SOCO", "IVY", "SWAC", "GLIAC", "FLHS"];
const PRO_POOL = ["USFL", "XFL"];

const median = (arr) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const average = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

// ── Logo: the nav shield. Uses the same PFA_MARK file as the brackets
// (public/art/pfa-mark.png) rather than a second copy of the same art, so
// there is only ever one PFA shield to keep up to date. The drawn SVG shield
// below is the fallback if that file is ever missing.
// PFA_MARK is declared further down the file, which is fine: this only reads
// it at render time, long after the module has finished evaluating.
function Logo({ size = 52 }) {
  const [imgOk, setImgOk] = useState(true);
  if (imgOk) {
    return (
      <img
        src={PFA_MARK}
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

// ── Avatar: a coach's Sleeper profile photo, with an initials fallback for
// coaches without one set, or if the image fails to load ──
function Avatar({ name, avatar, size = 36 }) {
  const [broken, setBroken] = useState(false);
  const initial = (name || "?").trim().charAt(0).toUpperCase() || "?";
  if (avatar && !broken) {
    return (
      <img
        src={`https://sleepercdn.com/avatars/thumbs/${avatar}`}
        alt={name}
        onError={() => setBroken(true)}
        style={{ width: size, height: size, borderRadius: "9999px", objectFit: "cover", border: `1px solid ${C.line}`, flexShrink: 0 }}
      />
    );
  }
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "9999px",
        background: C.panelHi,
        border: `1px solid ${C.line}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'Barlow Condensed', sans-serif",
        fontWeight: 700,
        color: C.gold,
        fontSize: Math.round(size * 0.42),
        flexShrink: 0,
      }}
    >
      {initial}
    </div>
  );
}

// A team's brand-color crest, for contexts with no coach to show an Avatar
// for (an open team). Same circular badge as Avatar's own no-image
// fallback, just keyed by team+tier instead of a Sleeper avatar URL. Only
// 7 of the 13 tiers have their own color palette (NFL/USFL/XFL/SEC/BIG
// XII/TEN/SWAC — same ones GBox already draws from); the other 6 fall back
// to the same generic slate GBox itself uses for an unlisted team, so this
// never looks broken, just less colorful for those leagues. The lookup
// lives INSIDE the function body on purpose, not as a module-level const —
// TEAM_CLR/USFL_CLR/etc. are declared much later in the file, and a
// top-level const built from them here would hit the exact module-load
// TDZ this file has been bitten by before. A function body only runs when
// called (i.e. at render time, after the whole module has already loaded),
// so referencing them here is safe regardless of declaration order.
//
// 2026-08-04: real per-team logo art (TEAM_ART, defined near FLHS_CLR)
// takes priority over the color crest whenever a team has an entry — same
// TDZ-safe function-body-only reference as the color maps above. Tracks
// the FAILED src rather than a boolean (same pattern as GSlot/TierMark/
// BowlLogo) so switching teams/tiers retries automatically instead of
// staying broken. Falls back to the color crest on missing art OR a load
// error, so an incomplete art set for a tier never looks worse than before.
function TeamMark({ team, tierKey, size = 38 }) {
  const [failedSrc, setFailedSrc] = useState(null);
  const artMap = TEAM_ART[tierKey];
  const artSrc = artMap ? artMap[normTeamKey(team)] : null;
  if (artSrc && artSrc !== failedSrc) {
    return (
      <img
        src={artSrc}
        alt={team}
        onError={() => setFailedSrc(artSrc)}
        style={{
          width: size,
          height: size,
          objectFit: "contain",
          borderRadius: 4,
          flexShrink: 0,
        }}
      />
    );
  }
  const clrMap =
    tierKey === "NFL" ? TEAM_CLR :
    tierKey === "USFL" ? USFL_CLR :
    tierKey === "XFL" ? XFL_CLR :
    tierKey === "SEC" ? SEC_CLR :
    tierKey === "BIG XII" ? XII_CLR :
    tierKey === "TEN" ? TEN_CLR :
    tierKey === "SWAC" ? SWAC_CLR :
    null;
  const clr = (clrMap && clrMap[team]) || ["#2A3550", C.chalk];
  const initial = (team || "?").trim().charAt(0).toUpperCase() || "?";
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 4,
        background: clr[0],
        color: clr[1],
        border: `1px solid ${C.line}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'Barlow Condensed', sans-serif",
        fontWeight: 700,
        fontSize: Math.round(size * 0.42),
        flexShrink: 0,
      }}
    >
      {initial}
    </div>
  );
}

// ── Trophies: coach, award, league, year — empty until the real list is
// provided, keyed by coach name (lowercased). One entry per win, so a coach
// who won a league three times gets three entries and three icons, same
// idea as wearing multiple rings. Only two categories for now (novelty
// awards excluded per Lainey); anything else falls back to a plain star.
//   "harvey28": [{ award: "League Champion", league: "NFL", year: 2023 }, ...]
const COACH_TROPHIES = {
  josssock: [{ award: "League Champion", league: "NFL", year: 2023 }],
  aziv49: [{ award: "League Champion", league: "SEC", year: 2022 }],
  harvey28: [
    { award: "League Champion", league: "NFL", year: 2025 },
    { award: "League Champion", league: "Sun Belt", year: 2022 },
  ],
  huibuh: [{ award: "League Champion", league: "NFL", year: 2024 }],
  foggybuckets: [{ award: "League Champion", league: "SWAC", year: 2022 }],
  firephool: [{ award: "League Champion", league: "Big XII", year: 2025 }],
  mvpmalik2: [{ award: "League Champion", league: "GLIAC", year: 2024 }],
  spacebarracecar: [{ award: "League Champion", league: "USFL", year: 2025 }],
  redphoenix437: [
    { award: "League Champion", league: "USFL", year: 2022 },
    { award: "League Champion", league: "USFL", year: 2023 },
  ],
  noga2003: [{ award: "League Champion", league: "XFL", year: 2025 }],
  z1856z: [{ award: "League Champion", league: "XFL", year: 2023 }],
  tylerwt003: [{ award: "League Champion", league: "ACC", year: 2025 }],
  "wonks l": [{ award: "League Champion", league: "ACC", year: 2022 }],
  juugking: [{ award: "League Champion", league: "Sun Belt", year: 2025 }],
  acubes21: [{ award: "League Champion", league: "SoCon", year: 2025 }],
  jamie04: [
    { award: "League Champion", league: "SoCon", year: 2024 },
    { award: "Coach of the Year", league: "SoCon", year: 2024 },
  ],
  bradlevo: [{ award: "League Champion", league: "SoCon", year: 2023 }],
  dylan3380: [{ award: "League Champion", league: "SoCon", year: 2022 }],
  jorgeortiz11: [{ award: "League Champion", league: "GLIAC", year: 2025 }],
  stokescity: [{ award: "League Champion", league: "FLHS", year: 2025 }],
  mbulls: [{ award: "League Champion", league: "FLHS", year: 2022 }],
  pwnrangr: [
    { award: "League Champion", league: "FLHS", year: 2023 },
    { award: "League Champion", league: "Big Ten", year: 2022 },
    { award: "Coach of the Year", league: "Big Ten", year: 2022 },
  ],
  glang727: [{ award: "League Champion", league: "SWAC", year: 2023 }],
  harold2576: [{ award: "League Champion", league: "GLIAC", year: 2023 }],
  dilly314: [{ award: "League Champion", league: "Ivy League", year: 2024 }],
  wynnguy: [
    { award: "Coach of the Year", league: "Ivy League", year: 2025 },
    { award: "League Champion", league: "Ivy League", year: 2022 },
    { award: "League Champion", league: "Ivy League", year: 2025 },
  ],
  ziplocbaggins: [
    { award: "League Champion", league: "Big XII", year: 2024 },
    { award: "League Champion", league: "Big XII", year: 2023 },
  ],
  garmstrong2002: [{ award: "League Champion", league: "GLIAC", year: 2022 }],
  zero00: [
    { award: "League Champion", league: "SEC", year: 2024 },
    { award: "Coach of the Year", league: "SEC", year: 2024 },
    { award: "League Champion", league: "ACC", year: 2023 },
    { award: "League Champion", league: "USFL", year: 2024 },
    { award: "League Champion", league: "ACC", year: 2024 },
    { award: "Coach of the Year", league: "ACC", year: 2025 },
  ],
  samwow123: [
    { award: "League Champion", league: "SEC", year: 2025 },
    { award: "League Champion", league: "Big Ten", year: 2025 },
  ],
  rifelife520: [{ award: "League Champion", league: "SEC", year: 2023 }],
  mambasdisciples: [{ award: "League Champion", league: "SWAC", year: 2024 }],
  finnbar3: [{ award: "Coach of the Year", league: "NFL", year: 2024 }],
  wdh76: [{ award: "Coach of the Year", league: "Big XII", year: 2023 }],
  mrcoolbuns: [{ award: "Coach of the Year", league: "XFL", year: 2023 }],
  austin3x: [{ award: "Coach of the Year", league: "Sun Belt", year: 2025 }],
};

// Original, generic badge shapes — not a recreation of any real trophy —
// just enough to visually distinguish the two award categories.
function TrophyIcon({ award, size = 14 }) {
  const isChampion = award === "League Champion";
  const color = isChampion ? "#E8A33D" : "#8494AC";
  return isChampion ? (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-label="League Champion">
      <path d="M7 3h10v3a5 5 0 01-5 5 5 5 0 01-5-5V3z" fill={color} />
      <path d="M4 4h3v2a3 3 0 01-3 3 2 2 0 01-2-2V6a2 2 0 012-2z" fill={color} opacity="0.7" />
      <path d="M20 4h-3v2a3 3 0 003 3 2 2 0 002-2V6a2 2 0 00-2-2z" fill={color} opacity="0.7" />
      <rect x="10.5" y="10" width="3" height="4" fill={color} />
      <rect x="8" y="14" width="8" height="2" rx="0.5" fill={color} />
      <rect x="9" y="16.5" width="6" height="2" rx="0.5" fill={color} />
    </svg>
  ) : (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-label="Coach of the Year">
      <circle cx="12" cy="9" r="6" fill={color} />
      <circle cx="12" cy="9" r="3" fill="#0B1220" opacity="0.25" />
      <path d="M9 14.5L7 21l5-2.5 5 2.5-2-6.5" fill={color} />
    </svg>
  );
}

function TrophyBadges({ name, size = 14 }) {
  const trophies = COACH_TROPHIES[(name || "").toLowerCase()];
  if (!trophies || !trophies.length) return null;
  return (
    <span className="inline-flex items-center gap-0.5 align-middle ml-1.5" title={trophies.map((t) => `${t.award} — ${t.league} ${t.year}`).join(", ")}>
      {trophies.map((t, i) => (
        <TrophyIcon key={i} award={t.award} size={size} />
      ))}
    </span>
  );
}

// ── Coach Profile popup: current team + conference are always shown (from
// the same Sleeper data as the directory); career stats show once CAREER_
// STATS has an entry for this coach, otherwise a plain "not in yet" note.
function CoachProfileModal({ coach, onClose }) {
  if (!coach) return null;
  const entries = CAREER_STATS[coach.name.toLowerCase()] || [];
  // Only ever show the entry for the league this coach is CURRENTLY in —
  // a coach who's held multiple teams over their career has genuinely
  // different records per league, and showing the wrong one would be
  // actively misleading, not just imprecise.
  const match = entries.find((e) => e.tierKey === coach.tierKey);
  const stats = match ? match.stats : null;
  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(11,18,32,0.75)" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-sm p-5"
        style={{ background: C.panel, border: `1px solid ${C.line}` }}
      >
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <Avatar name={coach.name} avatar={coach.avatar} size={52} />
            <div>
              <div className="text-lg font-semibold leading-tight">
                {coach.name}
                <TrophyBadges name={coach.name} size={15} />
              </div>
              <div className="text-xs" style={{ color: C.slate }}>{coach.team || "—"}</div>
              {coach.tierKey && (
                <div className="text-xs uppercase tracking-wider mt-0.5" style={{ color: C.gold }}>
                  {coach.tierName || coach.tierKey}
                </div>
              )}
            </div>
          </div>
          <button onClick={onClose} className="text-xs uppercase tracking-wider" style={{ color: C.slate }}>
            close
          </button>
        </div>

        {stats ? (
          <div className="grid grid-cols-2 gap-2 text-sm">
            {Object.entries(stats).map(([label, value]) => (
              <div key={label} className="px-2.5 py-2 rounded-sm" style={{ background: C.ink, border: `1px solid ${C.line}` }}>
                <div className="text-xs uppercase tracking-wider" style={{ color: C.slate }}>{label}</div>
                <div style={{ fontFamily: "'IBM Plex Mono', monospace", color: C.gold, fontWeight: 600 }}>{value}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-xs leading-relaxed" style={{ color: C.slate }}>
            No career stats on file for this coach yet.
          </div>
        )}
      </div>
    </div>
  );
}

// ── Team Profile popup: Max Total Points comes straight from the same
// standings data already on the page. Roster is a link out to the real
// Sleeper roster page — TeamProfileModal builds this live from the row's
// leagueId+rosterId when available, falls back to the sheet-derived map,
// and only reaches this static table as a last resort (see there for why).
// Draft picks are computed live from Sleeper's traded-picks data.

// LAST-RESORT roster-link table, keyed by lowercased team name — only
// consulted if BOTH the live leagueId+rosterId AND the sheet-derived map
// come up empty (e.g. the sheet fetch itself failed). These league IDs are
// 2026's; Sleeper assigns a new one every season, so this table will drift
// out of date on its own next season — that's fine, it's not the primary
// path anymore and doesn't need annual upkeep. Left in as a same-season
// safety net, not something to keep current going forward.
const ROSTER_LINKS = {
  // ---- NFL (1316582839847759872) ----
  "baltimore ravens": "https://sleeper.com/roster/1316582839847759872/12",
  "new england patriots": "https://sleeper.com/roster/1316582839847759872/3",
  "san francisco 49ers": "https://sleeper.com/roster/1316582839847759872/14",
  "green bay packers": "https://sleeper.com/roster/1316582839847759872/6",
  "los angeles rams": "https://sleeper.com/roster/1316582839847759872/32",
  "tennessee titans": "https://sleeper.com/roster/1316582839847759872/28",
  "cincinnati bengals": "https://sleeper.com/roster/1316582839847759872/7",
  "detroit lions": "https://sleeper.com/roster/1316582839847759872/27",
  "miami dolphins": "https://sleeper.com/roster/1316582839847759872/16",
  "los angeles chargers": "https://sleeper.com/roster/1316582839847759872/18",
  "arizona cardinals": "https://sleeper.com/roster/1316582839847759872/15",
  "new york jets": "https://sleeper.com/roster/1316582839847759872/26",
  "pittsburgh steelers": "https://sleeper.com/roster/1316582839847759872/10",
  "indianapolis colts": "https://sleeper.com/roster/1316582839847759872/20",
  "philadelphia eagles": "https://sleeper.com/roster/1316582839847759872/29",
  "oakland raiders": "https://sleeper.com/roster/1316582839847759872/2",
  "dallas cowboys": "https://sleeper.com/roster/1316582839847759872/9",
  "jacksonville jaguars": "https://sleeper.com/roster/1316582839847759872/4",
  "seattle seahawks": "https://sleeper.com/roster/1316582839847759872/11",
  "new orleans saints": "https://sleeper.com/roster/1316582839847759872/17",
  "buffalo bills": "https://sleeper.com/roster/1316582839847759872/24",
  "minnesota vikings": "https://sleeper.com/roster/1316582839847759872/31",
  "new york giants": "https://sleeper.com/roster/1316582839847759872/22",
  "chicago bears": "https://sleeper.com/roster/1316582839847759872/5",
  "atlanta falcons": "https://sleeper.com/roster/1316582839847759872/30",
  "tampa bay buccaneers": "https://sleeper.com/roster/1316582839847759872/8",
  "houston texans": "https://sleeper.com/roster/1316582839847759872/13",
  "washington commanders": "https://sleeper.com/roster/1316582839847759872/1",
  "carolina panthers": "https://sleeper.com/roster/1316582839847759872/21",
  "cleveland browns": "https://sleeper.com/roster/1316582839847759872/19",
  "kansas city chiefs": "https://sleeper.com/roster/1316582839847759872/25",
  "denver broncos": "https://sleeper.com/roster/1316582839847759872/23",

  // ---- USFL (1316586636028448768) — 2 slots unfilled in source (skipped) ----
  "san antonio gunslingers": "https://sleeper.com/roster/1316586636028448768/20",
  "pittsburgh maulers": "https://sleeper.com/roster/1316586636028448768/6",
  "birmingham stallions": "https://sleeper.com/roster/1316586636028448768/14",
  "denver gold": "https://sleeper.com/roster/1316586636028448768/17",
  "los angeles express": "https://sleeper.com/roster/1316586636028448768/3",
  "washington federals": "https://sleeper.com/roster/1316586636028448768/10",
  "boston breakers": "https://sleeper.com/roster/1316586636028448768/1",
  "new jersey generals": "https://sleeper.com/roster/1316586636028448768/19",
  "michigan panthers": "https://sleeper.com/roster/1316586636028448768/12",
  "philadelphia stars": "https://sleeper.com/roster/1316586636028448768/16",
  "oklahoma outlaws": "https://sleeper.com/roster/1316586636028448768/7",
  "detroit drive": "https://sleeper.com/roster/1316586636028448768/9",
  "chicago blitz": "https://sleeper.com/roster/1316586636028448768/18",
  "orlando renegades": "https://sleeper.com/roster/1316586636028448768/5",
  "arizona wranglers": "https://sleeper.com/roster/1316586636028448768/11",
  "tampa bay bandits": "https://sleeper.com/roster/1316586636028448768/2",
  "houston gamblers": "https://sleeper.com/roster/1316586636028448768/8",
  "oakland invaders": "https://sleeper.com/roster/1316586636028448768/13",

  // ---- XFL (1316588494914613248) — 2 slots unfilled in source (skipped) ----
  "dc defenders": "https://sleeper.com/roster/1316588494914613248/7",
  "birmingham thunderbolts": "https://sleeper.com/roster/1316588494914613248/4",
  "orlando rage": "https://sleeper.com/roster/1316588494914613248/17",
  "seattle dragons": "https://sleeper.com/roster/1316588494914613248/15",
  "tampa bay vipers": "https://sleeper.com/roster/1316588494914613248/9",
  "boston brawlers": "https://sleeper.com/roster/1316588494914613248/6",
  "brooklyn bolts": "https://sleeper.com/roster/1316588494914613248/12",
  "los angeles xtreme": "https://sleeper.com/roster/1316588494914613248/8",
  "memphis maniax": "https://sleeper.com/roster/1316588494914613248/5",
  "los angeles wildcats": "https://sleeper.com/roster/1316588494914613248/18",
  "dallas renegades": "https://sleeper.com/roster/1316588494914613248/2",
  "omaha mammoths": "https://sleeper.com/roster/1316588494914613248/20",
  "st. louis battlehawks": "https://sleeper.com/roster/1316588494914613248/14",
  "atlanta legends": "https://sleeper.com/roster/1316588494914613248/19",
  "new york guardians": "https://sleeper.com/roster/1316588494914613248/3",
  "san francisco demons": "https://sleeper.com/roster/1316588494914613248/1",
  "chicago enforcers": "https://sleeper.com/roster/1316588494914613248/11",
  "new jersey hitmen": "https://sleeper.com/roster/1316588494914613248/16",

  // ---- SEC (1316594738958192640) — all 16 present ----
  "south carolina gamecocks": "https://sleeper.com/roster/1316594738958192640/8",
  "ole miss rebels": "https://sleeper.com/roster/1316594738958192640/7",
  "kentucky wildcats": "https://sleeper.com/roster/1316594738958192640/11",
  "florida gators": "https://sleeper.com/roster/1316594738958192640/10",
  "arkansas razorbacks": "https://sleeper.com/roster/1316594738958192640/3",
  "texas a & m aggies": "https://sleeper.com/roster/1316594738958192640/6",
  "oklahoma sooners": "https://sleeper.com/roster/1316594738958192640/12",
  "miss state bulldogs": "https://sleeper.com/roster/1316594738958192640/2",
  "georgia bulldogs": "https://sleeper.com/roster/1316594738958192640/16",
  "missouri tigers": "https://sleeper.com/roster/1316594738958192640/13",
  "alabama crimson tide": "https://sleeper.com/roster/1316594738958192640/15",
  "tennessee volunteers": "https://sleeper.com/roster/1316594738958192640/4",
  "vanderbilt commodores": "https://sleeper.com/roster/1316594738958192640/14",
  "auburn tigers": "https://sleeper.com/roster/1316594738958192640/5",
  "lsu tigers": "https://sleeper.com/roster/1316594738958192640/9",
  "texas longhorns": "https://sleeper.com/roster/1316594738958192640/1",

  // ---- BIG XII (1317152669235703808) ----
  "north colorado bears": "https://sleeper.com/roster/1317152669235703808/18",
  "iowa state cyclones": "https://sleeper.com/roster/1317152669235703808/15",
  "south dakota state": "https://sleeper.com/roster/1317152669235703808/16",
  "houston cougars": "https://sleeper.com/roster/1317152669235703808/6",
  "cincinnati bearcats": "https://sleeper.com/roster/1317152669235703808/3",
  "osu": "https://sleeper.com/roster/1317152669235703808/1",
  "baylor bears": "https://sleeper.com/roster/1317152669235703808/4",
  "arizona wildcats": "https://sleeper.com/roster/1317152669235703808/8",
  "denver pioneers": "https://sleeper.com/roster/1317152669235703808/13",
  "kansas jayhawks": "https://sleeper.com/roster/1317152669235703808/2",
  "west virgnia mountaineers": "https://sleeper.com/roster/1317152669235703808/14",
  "byu cougars": "https://sleeper.com/roster/1317152669235703808/12",
  "kansas state wildcats": "https://sleeper.com/roster/1317152669235703808/5",
  "tcu horned frogs": "https://sleeper.com/roster/1317152669235703808/9",
  "ucf knights": "https://sleeper.com/roster/1317152669235703808/10",
  "texas tech": "https://sleeper.com/roster/1317152669235703808/7",

  // ---- ACC (1317191636379254784) — all 16 present ----
  "virginia tech hokies": "https://sleeper.com/roster/1317191636379254784/2",
  "duke blue devils": "https://sleeper.com/roster/1317191636379254784/16",
  "louisville cardinals": "https://sleeper.com/roster/1317191636379254784/5",
  "smu mustangs": "https://sleeper.com/roster/1317191636379254784/14",
  "florida state seminoles": "https://sleeper.com/roster/1317191636379254784/13",
  "north carolina tar heels": "https://sleeper.com/roster/1317191636379254784/11",
  "syracuse orange": "https://sleeper.com/roster/1317191636379254784/15",
  "wake forest": "https://sleeper.com/roster/1317191636379254784/9",
  "clemson tigers": "https://sleeper.com/roster/1317191636379254784/8",
  "notre dame fighting irish": "https://sleeper.com/roster/1317191636379254784/10",
  "pittsburgh panthers": "https://sleeper.com/roster/1317191636379254784/1",
  "virginia cavaliers": "https://sleeper.com/roster/1317191636379254784/6",
  "boston college eagles": "https://sleeper.com/roster/1317191636379254784/3",
  "miami hurricanes": "https://sleeper.com/roster/1317191636379254784/12",
  "nc state wolfpack": "https://sleeper.com/roster/1317191636379254784/4",
  "georgiatech yellowjackets": "https://sleeper.com/roster/1317191636379254784/7",

  // ---- BIG TEN (1317530523035242496) — 4 slots unfilled in source (skipped) ----
  "the ohio state buckeyes": "https://sleeper.com/roster/1317530523035242496/4",
  "northwestern wildcats": "https://sleeper.com/roster/1317530523035242496/13",
  "indiana hoosiers": "https://sleeper.com/roster/1317530523035242496/11",
  "cal golden bears": "https://sleeper.com/roster/1317530523035242496/6",
  "penn st. nittany lions": "https://sleeper.com/roster/1317530523035242496/15",
  "michigan wolverines": "https://sleeper.com/roster/1317530523035242496/2",
  "purdue boilermakes": "https://sleeper.com/roster/1317530523035242496/12",
  "utah utes": "https://sleeper.com/roster/1317530523035242496/3",
  "oregon ducks": "https://sleeper.com/roster/1317530523035242496/8",
  "illinois fighting illini": "https://sleeper.com/roster/1317530523035242496/9",
  "maryland terps": "https://sleeper.com/roster/1317530523035242496/10",
  "rutgers scarlet knights": "https://sleeper.com/roster/1317530523035242496/14",
  "usc trojans": "https://sleeper.com/roster/1317530523035242496/5",

  // ---- SUN BELT (1317557888784306176) — corrected ID; 1 slot unfilled ----
  "georgia state panthers": "https://sleeper.com/roster/1317557888784306176/7",
  "little rock trojans": "https://sleeper.com/roster/1317557888784306176/8",
  "app state mountaineers": "https://sleeper.com/roster/1317557888784306176/12",
  "usm golden eagles": "https://sleeper.com/roster/1317557888784306176/3",
  "south alabama jaguars": "https://sleeper.com/roster/1317557888784306176/10",
  "arlington mavericks": "https://sleeper.com/roster/1317557888784306176/11",
  "troy trojans": "https://sleeper.com/roster/1317557888784306176/2",
  "georgia southern eagles": "https://sleeper.com/roster/1317557888784306176/13",
  "ulm warhawks": "https://sleeper.com/roster/1317557888784306176/15",
  "louisiana ragin' cajuns": "https://sleeper.com/roster/1317557888784306176/14",
  "james madison dukes": "https://sleeper.com/roster/1317557888784306176/16",
  "old dominion monarchs": "https://sleeper.com/roster/1317557888784306176/4",
  "marshall thundering herd": "https://sleeper.com/roster/1317557888784306176/5",
  "texas state bobcats": "https://sleeper.com/roster/1317557888784306176/9",
  "carolina chanticleers": "https://sleeper.com/roster/1317557888784306176/1",

  // ---- SOCO (1317559700799131648) — corrected ID; 2 slots unfilled ----
  "austin peay governors": "https://sleeper.com/roster/1317559700799131648/4",
  "west carolina catamounts": "https://sleeper.com/roster/1317559700799131648/8",
  "belmont bruins": "https://sleeper.com/roster/1317559700799131648/14",
  "mercer bears": "https://sleeper.com/roster/1317559700799131648/3",
  "e tenn buccaneers": "https://sleeper.com/roster/1317559700799131648/5",
  "tennessee st tigers": "https://sleeper.com/roster/1317559700799131648/7",
  "the citadel bulldogs": "https://sleeper.com/roster/1317559700799131648/16",
  "vmi keydets": "https://sleeper.com/roster/1317559700799131648/15",
  "elon phoenix": "https://sleeper.com/roster/1317559700799131648/11",
  "tennessee martin skyhawks": "https://sleeper.com/roster/1317559700799131648/9",
  "samford bulldogs": "https://sleeper.com/roster/1317559700799131648/13",
  "nicholls state colonels": "https://sleeper.com/roster/1317559700799131648/2",
  "murray state racers": "https://sleeper.com/roster/1317559700799131648/6",
  "tenn tech eagles": "https://sleeper.com/roster/1317559700799131648/12",

  // ---- IVY (1317562012057735168) — corrected ID; 2 slots unfilled ----
  "brown bears": "https://sleeper.com/roster/1317562012057735168/12",
  "colgate raiders": "https://sleeper.com/roster/1317562012057735168/11",
  "lehigh mountain hawks": "https://sleeper.com/roster/1317562012057735168/15",
  "bucknell bison": "https://sleeper.com/roster/1317562012057735168/16",
  "dartmouth big green": "https://sleeper.com/roster/1317562012057735168/3",
  "penn quakers": "https://sleeper.com/roster/1317562012057735168/8",
  "georgetown hoyas": "https://sleeper.com/roster/1317562012057735168/7",
  "holy cross crusaders": "https://sleeper.com/roster/1317562012057735168/13",
  "columbia lions": "https://sleeper.com/roster/1317562012057735168/14",
  "cornell university bears": "https://sleeper.com/roster/1317562012057735168/6",
  "harvard crimson": "https://sleeper.com/roster/1317562012057735168/2",
  "mit engineers": "https://sleeper.com/roster/1317562012057735168/10",
  "lafayette leopards": "https://sleeper.com/roster/1317562012057735168/4",
  "fordham rams": "https://sleeper.com/roster/1317562012057735168/1",

  // ---- SWAC (1317574770207789056) — corrected ID; 6 slots unfilled ----
  // NOTE: "PFA VP" is an odd team name (roster 16) — kept as-is since it may
  // be a real Sleeper display name, but worth a sanity check.
  "pfa vp": "https://sleeper.com/roster/1317574770207789056/16",
  "mississippi valley devils": "https://sleeper.com/roster/1317574770207789056/12",
  "bethune-cookman wildcats": "https://sleeper.com/roster/1317574770207789056/10",
  "grambling state tigers": "https://sleeper.com/roster/1317574770207789056/5",
  "s.c. state bulldogs": "https://sleeper.com/roster/1317574770207789056/8",
  "southernu jaguars": "https://sleeper.com/roster/1317574770207789056/2",
  "alabama a&m bulldogs": "https://sleeper.com/roster/1317574770207789056/7",
  "alcorn state braves": "https://sleeper.com/roster/1317574770207789056/9",
  "pine bluff golden lions": "https://sleeper.com/roster/1317574770207789056/11",
  "alabama state hornets": "https://sleeper.com/roster/1317574770207789056/3",

  // ---- GLIAC (1317895570131546112) — corrected ID; 5 slots unfilled ----
  "davenport panthers": "https://sleeper.com/roster/1317895570131546112/3",
  "wayne state warriors": "https://sleeper.com/roster/1317895570131546112/13",
  "n michigan wildcats": "https://sleeper.com/roster/1317895570131546112/9",
  "jcu blue streaks": "https://sleeper.com/roster/1317895570131546112/8",
  "northwood timberwolves": "https://sleeper.com/roster/1317895570131546112/5",
  "ferris state bulldogs": "https://sleeper.com/roster/1317895570131546112/12",
  "baldwin yellow jackets": "https://sleeper.com/roster/1317895570131546112/4",
  "mount union raiders": "https://sleeper.com/roster/1317895570131546112/16",
  "wilmington quakers": "https://sleeper.com/roster/1317895570131546112/10",
  "lake superior lakers": "https://sleeper.com/roster/1317895570131546112/1",
  "purdue nw pride": "https://sleeper.com/roster/1317895570131546112/14",

  // ---- FLHS (1317921468134232064) — now complete (was broken/missing before) ----
  "western wildcats": "https://sleeper.com/roster/1317921468134232064/7",
  "west broward bobcats": "https://sleeper.com/roster/1317921468134232064/6",
  "west boca raton bulls": "https://sleeper.com/roster/1317921468134232064/2",
  "dr krop lightning": "https://sleeper.com/roster/1317921468134232064/15",
  "coral glades jaguars": "https://sleeper.com/roster/1317921468134232064/9",
  "stoneman douglas eagles": "https://sleeper.com/roster/1317921468134232064/5",
  "miami senior stingrays": "https://sleeper.com/roster/1317921468134232064/8",
};

function TeamProfileModal({ team, onClose, draftPicks, draftPicksLoading, sheetRosterLinks }) {
  if (!team) return null;
  // Three tiers, in order: (1) computed live from THIS season's leagueId +
  // rosterId — both already fetched live from Sleeper wherever this modal
  // is opened from a real Standings/Coaches/Directory row, so this needs no
  // maintenance at all and re-points itself every season automatically,
  // since Sleeper assigns a new league ID each year and the site
  // re-discovers it live (see the leagueMap discovery effect). (2) the
  // sheet-derived fallback, for the one path that opens this modal WITHOUT
  // live roster data — the 300 Club's historical high-score list, which
  // only ever has a team name. (3) the static ROSTER_LINKS table below, in
  // case the sheet fetch itself failed.
  const rosterLink =
    (team.leagueId && team.rosterId && `https://sleeper.com/roster/${team.leagueId}/${team.rosterId}`) ||
    sheetRosterLinks[(team.team || "").toLowerCase()] ||
    ROSTER_LINKS[(team.team || "").toLowerCase()];

  // "—" is the site-wide placeholder for an unassigned team (same check the
  // Open Teams list on Standings uses). Anything else — a real coach name,
  // OR unknown (the 300 Club's historical entries carry no live coach data
  // at all) — is treated as NOT available. Visual only for now, no click
  // action: the real apply flow already exists (Standings' Open Teams
  // list, `applyToTeam`) and this button isn't wired to it yet on purpose.
  const isAvailable = team.coach === "—";

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(11,18,32,0.75)" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-sm p-5"
        style={{ background: C.panel, border: `1px solid ${C.line}`, maxHeight: "85vh", overflowY: "auto" }}
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="text-lg font-semibold leading-tight">{team.team}</div>
            {team.tierKey && (
              <div className="text-xs uppercase tracking-wider mt-0.5" style={{ color: C.gold }}>{team.tierName}</div>
            )}
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              disabled={!isAvailable}
              title={isAvailable ? "Applications aren't open yet" : "This team isn't available"}
              className="text-xs uppercase tracking-wider px-2.5 py-1 rounded-sm"
              style={{
                background: isAvailable ? C.turf : "transparent",
                color: isAvailable ? C.ink : C.slate,
                border: `1px solid ${isAvailable ? C.turf : C.line}`,
                fontWeight: 600,
                cursor: isAvailable ? "pointer" : "default",
              }}
            >
              Apply
            </button>
            <button onClick={onClose} className="text-xs uppercase tracking-wider" style={{ color: C.slate }}>
              close
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 mb-4">
          <div className="px-2.5 py-2 rounded-sm" style={{ background: C.ink, border: `1px solid ${C.line}` }}>
            <div className="text-xs uppercase tracking-wider" style={{ color: C.slate }}>Max Total Points</div>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", color: C.gold, fontWeight: 600 }}>
              {typeof team.maxPts === "number" ? fmt(team.maxPts) : "—"}
            </div>
          </div>
          <a
            href={rosterLink || undefined}
            target="_blank"
            rel="noopener noreferrer"
            className="px-2.5 py-2 rounded-sm flex flex-col justify-center"
            style={{
              background: C.ink,
              border: `1px solid ${C.line}`,
              opacity: rosterLink ? 1 : 0.5,
              pointerEvents: rosterLink ? "auto" : "none",
            }}
          >
            <div className="text-xs uppercase tracking-wider" style={{ color: C.slate }}>Roster</div>
            <div style={{ color: C.gold, fontWeight: 600 }}>{rosterLink ? "View on Sleeper ↗" : "Link not set"}</div>
          </a>
        </div>

        <div className="text-xs uppercase tracking-wider mb-2" style={{ color: C.slate }}>Draft Picks</div>
        {!team.rosterId || !team.leagueId ? (
          <div className="text-xs mb-4" style={{ color: C.slate }}>Not available for this team.</div>
        ) : draftPicksLoading ? (
          <div className="text-xs mb-4" style={{ color: C.slate }}>Loading draft picks…</div>
        ) : !draftPicks || draftPicks.length === 0 ? (
          <div className="text-xs mb-4" style={{ color: C.slate }}>No picks on file.</div>
        ) : (
          <div className="flex flex-wrap gap-1.5 mb-4">
            {draftPicks.map((p, i) => (
              <span
                key={i}
                className="text-xs px-2 py-1 rounded-sm"
                style={{ background: C.ink, border: `1px solid ${C.line}`, fontFamily: "'IBM Plex Mono', monospace" }}
              >
                {p.season} R{p.round}{p.viaTrade ? " *" : ""}
              </span>
            ))}
          </div>
        )}
        {draftPicks && draftPicks.some((p) => p.viaTrade) && (
          <div className="text-xs mb-4" style={{ color: C.slate }}>* acquired via trade</div>
        )}

        <div className="pt-3 text-xs" style={{ borderTop: `1px solid ${C.line}`, color: C.slate }}>
          Team history — coming soon.
        </div>
      </div>
    </div>
  );
}

// ── Visual bracket system: real connected tournament-tree diagrams (SVG),
// using each coach's real Sleeper avatar next to the team name to save
// room — there's no real "team logo" data source, so this is the closest
// legitimate visual identifier available rather than a fabricated logo.
// Later rounds show "Winner of Match N" placeholders until real games are
// played; this only builds the seeding/shape, not live progression.
const BOX_W = 168;
const BOX_H = 40;

function BracketBox({ x, y, entry, seed, highlight }) {
  const [broken, setBroken] = useState(false);
  const isPlaceholder = typeof entry === "string";
  const name = isPlaceholder ? entry : entry ? entry.team : "—";
  const avatar = !isPlaceholder && entry ? entry.avatar : null;
  const initial = (!isPlaceholder && entry ? entry.coach : name || "?").trim().charAt(0).toUpperCase() || "?";
  const label = name.length > 20 ? name.slice(0, 19) + "…" : name;

  // Championship games auto-highlight gold; the fired/last-place game is
  // flagged explicitly by whichever parent bracket knows it's the last one.
  const mode = highlight || (entry === "Championship" ? "champion" : null);
  const boxStroke = mode === "champion" ? C.gold : mode === "fired" ? C.ember : C.line;
  const boxFill = mode === "champion" ? "rgba(232,163,61,0.14)" : mode === "fired" ? "rgba(212,96,76,0.14)" : C.panel;

  return (
    <g>
      <rect x={x} y={y} width={BOX_W} height={BOX_H} rx="4" fill={boxFill} stroke={boxStroke} strokeWidth={mode ? "2" : "1"} />
      {!isPlaceholder && (
        avatar && !broken ? (
          <image
            href={`https://sleepercdn.com/avatars/thumbs/${avatar}`}
            x={x + 5} y={y + (BOX_H - 28) / 2} width={28} height={28}
            clipPath="inset(0% round 14px)"
            onError={() => setBroken(true)}
          />
        ) : (
          <>
            <circle cx={x + 19} cy={y + BOX_H / 2} r={14} fill={C.panelHi} stroke={C.line} />
            <text x={x + 19} y={y + BOX_H / 2 + 4} textAnchor="middle" fontSize="11" fontWeight="700" fill={C.gold}>{initial}</text>
          </>
        )
      )}
      {seed && (
        <text x={x + (isPlaceholder ? 8 : 40)} y={y + BOX_H / 2 - 3} fontSize="9" fill={C.slate} fontFamily="'IBM Plex Mono', monospace">
          #{seed}
        </text>
      )}
      <text
        x={x + (isPlaceholder ? 8 : 40)}
        y={y + BOX_H / 2 + (seed ? 11 : 4)}
        fontSize="10.5"
        fill={isPlaceholder ? (mode ? boxStroke : C.slate) : C.chalk}
        fontFamily="'Barlow', sans-serif"
        fontStyle={isPlaceholder ? "italic" : "normal"}
      >
        {label}
      </text>
    </g>
  );
}

// Right-angle "elbow" connector between two box edges.
function elbowPath(x1, y1, x2, y2) {
  const midX = (x1 + x2) / 2;
  return `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`;
}

function Connector({ d }) {
  return <path d={d} fill="none" stroke={C.line} strokeWidth="1.5" />;
}

// ---------------------------------------------------------------------------
// PFA playoff bracket, built as a fixed grid rather than hand-computed SVG
// coordinates. The bracket sheet IS a spreadsheet — fixed columns (one per
// week), fixed rows — so a grid maps onto it 1:1 and can't drift or overlap
// the way free-floating coordinate math did.
//
// Layout contract (shared by EVERY section so columns always line up):
//   column x: 0 112 224 336 | 448 (centre) | 560 672 784 896   width 100, gap 12
//   NFC weeks 14-17 run left->right; AFC weeks 14-17 run right->left;
//   the two conferences meet only in the centre column (week 17).
//   row unit 19px: a team box is a 19px colour bar (name) + 19px score cell.
//
// The whole 996px-wide block auto-scales down to whatever width it's given, so
// the full bracket is always visible without horizontal scrolling.
//
// Every number is transcribed from the real playoff sheets. Nothing inferred.
// ---------------------------------------------------------------------------

const TEAM_CLR = {
  "San Francisco": ["#AA0000", "#B3995D"], Arizona: ["#97233F", "#000000"],
  Philadelphia: ["#004C54", "#A5ACAF"], "LA Rams": ["#003594", "#FFD100"],
  "Green Bay": ["#203731", "#FFB612"], Seattle: ["#002244", "#69BE28"],
  "New Orleans": ["#D3BC8D", "#101820"], Detroit: ["#0076B6", "#B0B7BC"],
  "New England": ["#002244", "#C60C30"], Tennessee: ["#0C2340", "#4B92DB"],
  "LA Chargers": ["#0080C6", "#FFC20E"], Miami: ["#008E97", "#FC4C02"],
  Baltimore: ["#241773", "#9E7C0C"], "NY Jets": ["#125740", "#000000"],
  Jacksonville: ["#006778", "#D7A22A"], Pittsburgh: ["#101820", "#FFB612"],
  Dallas: ["#041E42", "#869397"], Atlanta: ["#A71930", "#101820"],
  Chicago: ["#0B162A", "#C83803"], Washington: ["#5A1414", "#FFB612"],
  Minnesota: ["#4F2683", "#FFC62F"], "Tampa Bay": ["#D50A0A", "#FF7900"],
  "NY Giants": ["#0B2265", "#A71930"], Carolina: ["#0085CA", "#101820"],
  Cincinnati: ["#FB4F14", "#101820"], Denver: ["#FB4F14", "#002244"],
  "Las Vegas": ["#101820", "#A5ACAF"], Houston: ["#03202F", "#A71930"],
  Indianapolis: ["#002C5F", "#A2AAAD"], "Kansas City": ["#E31837", "#FFB81C"],
  Buffalo: ["#00338D", "#C60C30"], Cleveland: ["#311D00", "#FF3C00"],
};

const BW = 100, BH = 19, GRID_W = 996, HEADER_GAP = 8;
// Bracket outlines and connectors read too dark against the ink background.
// They get their own line colour rather than the app-wide C.line, which is
// also used by panels, tables and the season picker and should not change.
const BR_LINE = "#46608A";

// ── Artwork ────────────────────────────────────────────────────────────────
// Every league mark, trophy and novelty logo lives in public/art/ and is
// referenced here by path. To swap a piece of art, replace the PNG in
// public/art/ with one of the same filename — no change to this file.
// Each path must match a real file exactly (lowercase, hyphens); if one is
// missing the image degrades to its dashed placeholder rather than breaking.
const PFA_MARK = "/art/pfa-mark.png";
const CLUB_300_MARK = "/art/club-300-mark.png";
const NFL_MARK = "/art/nfl-mark.png";
const NFL_TROPHY = "/art/nfl-trophy.png";
const XFL_MARK = "/art/xfl-mark.png";
const XFL_TROPHY = "/art/xfl-trophy.png";

const USFL_MARK = "/art/usfl-mark.png";
const USFL_TROPHY = "/art/usfl-trophy.png";

// --- Tournament artwork ----------------------------------------------------
// The cross-tier 20-team Tournament (see TOURNEY_* below) is a themed annual
// event, not a fixed tier — a future season may reuse this theme or bring a
// whole new one. Every theme's art lives in its own subfolder under
// public/art/tournament/, so switching or adding a theme is just a new
// subfolder plus flipping TOURNAMENT_THEME below; nothing else in this file
// changes. TOURNAMENT_NAME is the display name shown in the banner/nav — also
// theme-specific, not hardcoded into any component.
const TOURNAMENT_THEME = "fall-iday-madness";
const TOURNAMENT_NAME = "Fall-iday Madness";
const tourneyArt = (filename) => `/art/tournament/${TOURNAMENT_THEME}/${filename}`;
const TOURNEY_TROPHY = tourneyArt("trophy.png");
const TOURNEY_MASCOT_LEFT = tourneyArt("mascot-left.png"); // pumpkin
const TOURNEY_MASCOT_RIGHT = tourneyArt("mascot-right.png"); // turkey
const TOURNEY_DECOR_TOP_LEFT = tourneyArt("decor-top-left.png"); // leaf, flanks PFA mark
const TOURNEY_DECOR_TOP_RIGHT = tourneyArt("decor-top-right.png"); // leaf, flanks PFA mark
const TOURNEY_DECOR_BOTTOM_LEFT = tourneyArt("decor-bottom-left.png"); // corner leaf
const TOURNEY_DECOR_BOTTOM_RIGHT = tourneyArt("decor-bottom-right.png"); // corner leaf
const TOURNEY_DECOR_CENTER = tourneyArt("decor-center.png"); // leaf cluster below the Win row

// --- SEC / Big Ten / SWAC artwork -----------------------------------------
const SEC_MARK = "/art/sec-mark.png";
const SEC_TROPHY = "/art/sec-trophy.png";
const OKKY_MARK = "/art/okky-mark.png";
const HOGS_MARK = "/art/hogs-mark.png";
const TEN_MARK = "/art/ten-mark.png";
const TEN_TROPHY = "/art/ten-trophy.png";
const SWAC_MARK = "/art/swac-mark.png";
const SWAC_TROPHY = "/art/swac-trophy.png";
const INDIANA_MARK = "/art/indiana-mark.png";
const SEVEN_MARK = "/art/seven-mark.png";

const XII_MARK = "/art/xii-mark.png";
const XII_TROPHY = "/art/xii-trophy.png";

const ACC_MARK = "/art/acc-mark.png";
const ACC_TROPHY = "/art/acc-trophy.png";

const SOCO_MARK = "/art/soco-mark.png";
const SOCO_TROPHY = "/art/soco-trophy.png";

const SUN_MARK = "/art/sun-mark.png";
const SUN_TROPHY = "/art/sun-trophy.png";

const IVY_MARK = "/art/ivy-mark.png";
const IVY_TROPHY = "/art/ivy-trophy.png";

const GLIAC_MARK = "/art/gliac-mark.png";
const GLIAC_TROPHY = "/art/gliac-trophy.png";

const FLHS_MARK = "/art/flhs-mark.png";
const FLHS_TROPHY = "/art/flhs-trophy.png";

// Maps each tier key to its league mark. Tiers with no mark fall back to
// showing the tier key as text.
const TIER_LOGOS = {
  NFL: NFL_MARK,
  XFL: XFL_MARK,
  USFL: USFL_MARK,
  SEC: SEC_MARK,
  TEN: TEN_MARK,
  SWAC: SWAC_MARK,
  "BIG XII": XII_MARK,
  ACC: ACC_MARK,
  SOCO: SOCO_MARK,
  SUN: SUN_MARK,
  IVY: IVY_MARK,
  GLIAC: GLIAC_MARK,
  FLHS: FLHS_MARK,
};

// A league mark, used beside the Standings heading and in the Directory
// league bands. Falls back to the tier key as text if the tier has no mark or
// the file is missing. Sizes are maxima — the art keeps its own aspect ratio
// and is never stretched or upscaled past its natural size.
function TierMark({ tierKey, maxW = 40, maxH = 40 }) {
  const [failedSrc, setFailedSrc] = useState(null);
  const src = TIER_LOGOS[tierKey];
  if (!src || failedSrc === src) return tierKey;
  return (
    <img src={src} alt={tierKey} onError={() => setFailedSrc(src)}
         style={{ maxWidth: maxW, maxHeight: maxH, objectFit: "contain" }} />
  );
}

// The 300 Club's own mark, beside its page title — same treatment as a
// league logo. The source is a square image with its own silver border
// baked in, so it's shown whole via objectFit:contain (never cropped) and
// falls back to "300" as text if the file is missing, same graceful
// degradation as TierMark.
function Club300Mark({ maxW = 40, maxH = 40 }) {
  const [failed, setFailed] = useState(false);
  if (failed) return "300";
  return (
    <img src={CLUB_300_MARK} alt="The 300 Club" onError={() => setFailed(true)}
         style={{ maxWidth: maxW, maxHeight: maxH, objectFit: "contain" }} />
  );
}

// A Directory league band — the same shape as a bracket banner: mark on the
// left, conference name centred, tier key on the right. Sits above that
// league's block of coach cards.
function DirBand({ tier, count, strength }) {
  return (
    <div className="flex items-center gap-2.5 px-3 mb-2.5"
         style={{ background: C.panelHi, borderRadius: 3, height: 46 }}>
      <div style={{ width: 56, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "flex-start" }}>
        <TierMark tierKey={tier.key} maxW={56} maxH={38} />
      </div>
      <div className="flex-1 min-w-0 text-center">
        <div className="uppercase truncate" style={{
          fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700,
          fontSize: 15, letterSpacing: "0.15em", lineHeight: "15px", color: C.chalk,
        }}>{tier.name}</div>
        <div style={{ fontSize: 9.5, fontStyle: "italic", lineHeight: "13px", color: C.slate }}>
          Tier {tier.tier} · {count} {count === 1 ? "coach" : "coaches"}
        </div>
      </div>
      <div className="text-right" style={{
        fontFamily: strength ? "'IBM Plex Mono', monospace" : "'Barlow Condensed', sans-serif",
        fontWeight: 700, fontSize: strength ? 14 : 13, letterSpacing: "0.12em", color: C.gold,
        width: 56, flexShrink: 0,
      }}
        title={strength ? "Conference Strength - higher means tougher competition" : undefined}
      >
        {strength ? `${strength.score >= 0 ? "+" : ""}${strength.score.toFixed(1)}` : tier.key}
      </div>
    </div>
  );
}

function GBox({ x, y, team, score, win, colors }) {
  const clr = (colors && colors[team]) || TEAM_CLR[team] || ["#2A3550", C.chalk];
  // Two teams of one matchup are stacked 38px apart (see r3Stack/brStack) and
  // used to render with zero gap between them -- one continuous colour block
  // with no visual break between team A's box and team B's below it.
  // Shrinking each row 2px keeps the pair's total footprint 4px under the
  // 38px slot the next box starts at, opening a small gap between the two
  // teams without moving a single x/y coordinate anywhere else in the file.
  const rowH = BH - 2;
  return (
    <div style={{ position: "absolute", left: x, top: y, width: BW }}>
      <div style={{
        height: rowH, lineHeight: `${rowH}px`, fontSize: 11, fontWeight: 700, padding: "0 3px",
        background: clr[0], color: clr[1], whiteSpace: "nowrap", overflow: "hidden",
        textOverflow: "ellipsis", boxSizing: "border-box", textAlign: "center",
      }}>{team}</div>
      {score != null && (
        <div style={{
          height: rowH, lineHeight: `${rowH}px`, fontSize: 11, fontFamily: "'IBM Plex Mono', monospace",
          background: "rgba(255,255,255,0.03)", boxSizing: "border-box", textAlign: "center",
          border: `1px solid ${BR_LINE}`, borderTop: "none",
          color: win ? C.turf : C.slate, fontWeight: win ? 700 : 400,
        }}>{score}</div>
      )}
    </div>
  );
}

// A placement game's centre column: one box carrying both the place label and
// the draft pick it awards. The pick used to float on its own row above the
// winner bar and the label used to widen for long names -- but the cell sits
// between the two week-17 score boxes, so widening it to 210px made it span
// 393-603 and run straight through both of them. It now stays BW wide, steps
// its face down by label length and grows DOWNWARD instead. A label past 40
// characters is a novelty bowl name rather than a "3rd place" label, so it
// also gets a taller floor (BH*3), real padding and looser leading -- at the
// ordinary BH*2 the wrapped text sat hard against the box edges.
function GPlace({ x, y, pick, text }) {
  const len = (text || "").length;
  const long = len > 40;
  const fs = long ? 8 : len > 22 ? 9 : 11;
  return (
    <div style={{
      position: "absolute", left: x, top: y, width: BW, minHeight: long ? BH * 3 : BH * 2,
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      padding: long ? 5 : "2px 3px", textAlign: "center", boxSizing: "border-box",
      background: "rgba(255,255,255,0.03)", border: `1px solid ${BR_LINE}`,
    }}>
      <div style={{ fontSize: fs, lineHeight: long ? 1.3 : 1.15, fontWeight: 700, color: C.chalk }}>{text}</div>
      {pick && (
        <div style={{
          fontSize: 9, lineHeight: 1.2, fontStyle: "italic", color: C.slate, marginTop: 1,
        }}>{pick}</div>
      )}
    </div>
  );
}

// One game of a multi-week points series: running total on top, which game
// it is, then that week's score. The winning side's final total is flagged.
function GSeries({ x, y, cum, label, score, win }) {
  return (
    <div style={{ position: "absolute", left: x, top: y, width: BW }}>
      <div style={{
        height: BH, lineHeight: `${BH}px`, fontSize: 11, textAlign: "center",
        fontFamily: "'IBM Plex Mono', monospace",
        color: win ? C.turf : C.slate, fontWeight: win ? 700 : 400,
      }}>{cum}</div>
      <div style={{
        height: BH, lineHeight: `${BH}px`, fontSize: 11, fontWeight: 700, textAlign: "center",
        color: C.slate, background: C.panelHi, border: `1px solid ${BR_LINE}`, boxSizing: "border-box",
      }}>{label}</div>
      <div style={{
        height: BH, lineHeight: `${BH}px`, fontSize: 11, textAlign: "center",
        fontFamily: "'IBM Plex Mono', monospace", color: C.slate,
        background: "rgba(255,255,255,0.03)", border: `1px solid ${BR_LINE}`,
        borderTop: "none", boxSizing: "border-box",
      }}>{score}</div>
    </div>
  );
}

function GPaths({ h, d }) {
  return (
    <svg width={GRID_W} height={h} style={{ position: "absolute", left: 0, top: 0 }} aria-hidden="true">
      <g fill="none" stroke={BR_LINE} strokeWidth="1">
        {d.map((p, i) => <path key={i} d={p} />)}
      </g>
    </svg>
  );
}

const WK_COLS = [[0, "Week 14"], [112, "Week 15"], [224, "Week 16"], [336, "Week 17"],
                 [560, "Week 17"], [672, "Week 16"], [784, "Week 15"], [896, "Week 14"]];

const WK_COLS_3 = [[112, "Week 15"], [224, "Week 16"], [336, "Week 17"],
                   [560, "Week 17"], [672, "Week 16"], [784, "Week 15"]];

// Dashed placeholder for artwork that isn't in the app yet (league marks,
// trophies). Keeps the space reserved so real images drop straight in.
function GSlot({ x, y, w, h, label, src }) {
  // Track the src that failed rather than a boolean, so switching tiers (which
  // reuses this component instance with a new src) retries automatically.
  const [failedSrc, setFailedSrc] = useState(null);
  const showImg = Boolean(src) && failedSrc !== src;
  return (
    <div style={{
      position: "absolute", left: x, top: y, width: w, height: h, display: "flex",
      alignItems: "center", justifyContent: "center", textAlign: "center",
      border: showImg ? "none" : `1px dashed ${BR_LINE}`, borderRadius: 4,
      fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase",
      color: C.slate, lineHeight: 1.3, padding: "0 4px", boxSizing: "border-box",
    }}>
      {showImg
        ? <img src={src} alt={label} onError={() => setFailedSrc(src)}
               style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
        : label}
    </div>
  );
}

function GHeader({ banners, logo, logoSrc, cols }) {
  return (
    <div style={{
      position: "relative", width: GRID_W,
      height: banners ? (banners.some((b) => b[4]) ? 58 : 46) : 24,
    }}>
      {logo && <GSlot x={448} y={0} w={100} h={46} label={logo} src={logoSrc} />}
      {(cols || WK_COLS).map(([x, t]) => (
        <div key={x} style={{
          position: "absolute", left: x, top: 0, width: BW, height: 20, lineHeight: "20px",
          textAlign: "center", fontSize: 10, letterSpacing: "0.12em", color: C.slate,
          textTransform: "uppercase",
        }}>{t}</div>
      ))}
      {banners && banners.map(([x, w, t, bg, sub2, fg]) => (
        <div key={x} style={{
          position: "absolute", left: x, top: 24, width: w, height: sub2 ? 34 : 22,
          display: "flex", flexDirection: "column", justifyContent: "center",
          textAlign: "center", color: fg || "#fff", background: bg, borderRadius: 3,
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.15em", lineHeight: "14px" }}>{t}</div>
          {sub2 && (
            <div style={{ fontSize: 9, fontStyle: "italic", opacity: 0.85, lineHeight: "12px" }}>{sub2}</div>
          )}
        </div>
      ))}
    </div>
  );
}

// Renders one group (championship half or consolation half) as a stack of
// sections, all sharing the column grid above. Scales to fit its container.
function GridBracket({ data }) {
  const wrapRef = useRef(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const w = el.clientWidth;
      if (w > 0) setScale(Math.min(1, w / GRID_W));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const hdrH = (s) => (s.banners ? (s.banners.some((b) => b[4]) ? 58 : 46) : 24);
  const innerH = data.sections.reduce((a, s) => a + hdrH(s) + HEADER_GAP + s.h + 24, 0);

  return (
    <div ref={wrapRef} style={{ width: "100%", overflow: "hidden", height: innerH * scale }}>
      <div style={{ width: GRID_W, transformOrigin: "top left", transform: `scale(${scale})` }}>
        {data.sections.map((s, si) => (
          <div key={si}>
            <GHeader banners={s.banners} logo={s.logo} logoSrc={s.logoSrc || data.logoSrc} cols={s.cols} />
            <div style={{ position: "relative", width: GRID_W, height: s.h, marginTop: HEADER_GAP }}>
              <GPaths h={s.h} d={s.paths} />
              {(s.slots || []).map((sl, i) => <GSlot key={`s${i}`} x={sl[0]} y={sl[1]} w={sl[2]} h={sl[3]} label={sl[4]} src={sl[5]} />)}
              {s.boxes.map((b, i) => <GBox key={i} x={b[0]} y={b[1]} team={b[2]} score={b[3]} win={b[4]} colors={data.colors} />)}
              {(s.winners || []).map((b, i) => (
                <div key={`w${i}`} style={{ position: "absolute", left: b[0], top: b[1], width: BW }}>
                  <GBox x={0} y={0} team={b[2]} colors={data.colors} />
                </div>
              ))}
              {(s.series || []).map((v, i) => <GSeries key={`v${i}`} x={v[0]} y={v[1]} cum={v[2]} label={v[3]} score={v[4]} win={v[5]} />)}
              {(s.places || []).map((p, i) => <GPlace key={`p${i}`} x={p[0]} y={p[1]} pick={p[2]} text={p[3]} />)}
              {s.champion && (
                <>
                  <div style={{
                    position: "absolute", left: 448, top: s.champion.y - 22, width: BW, textAlign: "center",
                    fontSize: 10, fontWeight: 700, letterSpacing: "0.15em", color: C.gold, textTransform: "uppercase",
                  }}>{s.champion.label}</div>
                  {/* GBox is position:absolute, so it contributes no height --
                      this wrapper used to collapse to its own 4px border and the
                      champion's name was invisible in every league. It now has an
                      explicit height, and sits 2px out on each side so the gold
                      ring surrounds the BW-wide bar instead of widening it. */}
                  <div style={{
                    position: "absolute", left: 448 - 2, top: s.champion.y - 2, width: BW + 4,
                    height: BH + (s.champion.sub ? BH : 0) + 4,
                    border: `2px solid ${C.gold}`, borderRadius: 3, overflow: "hidden",
                    boxSizing: "border-box",
                  }}>
                    <GBox x={0} y={0} team={s.champion.team} colors={data.colors} />
                    {s.champion.sub && (
                      <div style={{
                        position: "absolute", left: 0, top: BH, width: BW,
                        height: BH, lineHeight: `${BH}px`, fontSize: 10, textAlign: "center",
                        background: "rgba(232,163,61,0.12)", color: C.gold, fontWeight: 700,
                      }}>{s.champion.sub}</div>
                    )}
                  </div>
                </>
              )}
              {s.footer && (
                <div style={{
                  position: "absolute", left: s.footer[0], top: s.footer[1], width: s.footer[2],
                  padding: "5px 0", textAlign: "center", background: C.gold, borderRadius: 3,
                }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: C.ink }}>{s.footer[3]}</div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#7A3B00" }}>{s.footer[4]}</div>
                </div>
              )}
            </div>
            <div style={{ height: 24 }} />
          </div>
        ))}
      </div>
    </div>
  );
}


// A week-18 bowl logo. Collapses to the same 6px spacer an unillustrated bowl
// uses if the file is missing, so the bar below it never shifts.
function BowlLogo({ src }) {
  const [failedSrc, setFailedSrc] = useState(null);
  if (failedSrc === src) return <div style={{ height: 6 }} />;
  return (
    <img src={src} alt="" onError={() => setFailedSrc(src)}
         style={{ height: 46, display: "block", margin: "0 auto 3px", objectFit: "contain" }} />
  );
}

// Week-18 novelty/exhibition games. These sit OUTSIDE the bracket: they don't
// affect placements, coaching points or draft order, so this is presentation
// only and nothing here feeds the standings maths. The winner bar is derived
// from the two scores rather than stored, so a bowl with no result yet (or a
// tie) renders as unplayed instead of declaring a false winner.
function GBowls({ data }) {
  if (!data || !data.games || !data.games.length) return null;
  const cellW = (n) => (n.length <= 16 ? 120 : n.length <= 40 ? 170 : 210);
  const clr = (t) => (data.colors && data.colors[t]) || TEAM_CLR[t] || ["#2A3550", C.chalk];
  const Bar = ({ team, w }) => {
    const c = clr(team);
    return (
      <div style={{
        width: w, height: BH, lineHeight: `${BH}px`, fontSize: 11, fontWeight: 700,
        background: c[0], color: c[1], textAlign: "center", whiteSpace: "nowrap",
        overflow: "hidden", textOverflow: "ellipsis", boxSizing: "border-box", padding: "0 3px",
      }}>{team}</div>
    );
  };
  return (
    <div style={{ marginTop: 18, paddingTop: 14, borderTop: `1px dashed ${BR_LINE}` }}>
      <div style={{
        textAlign: "center", fontSize: 10, letterSpacing: "0.15em", textTransform: "uppercase",
        color: C.slate, marginBottom: 12,
      }}>{data.header || "Week 18"}</div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20 }}>
        {data.games.map((g, i) => {
          const w = cellW(g.name);
          const ls = parseFloat(g.left[1]), rs = parseFloat(g.right[1]);
          const played = ls !== rs;
          const win = played ? (ls > rs ? g.left[0] : g.right[0]) : null;
          return (
            <div key={i} style={{ textAlign: "center" }}>
              {g.logo
                ? <BowlLogo src={g.logo} />
                : <div style={{ height: 6 }} />}
              {win
                ? <div style={{ width: w, margin: "0 auto" }}><Bar team={win} w={w} /></div>
                : <div style={{ height: BH }} />}
              <div style={{ display: "flex", justifyContent: "center", alignItems: "flex-start" }}>
                <div style={{ width: BW }}>
                  <Bar team={g.left[0]} w={BW} />
                  <div style={{
                    height: BH, lineHeight: `${BH}px`, fontSize: 11, textAlign: "center",
                    fontFamily: "'IBM Plex Mono', monospace", background: "rgba(255,255,255,0.03)",
                    border: `1px solid ${BR_LINE}`, borderTop: "none", boxSizing: "border-box",
                    color: win === g.left[0] ? C.turf : C.slate, fontWeight: win === g.left[0] ? 700 : 400,
                  }}>{g.left[1]}</div>
                </div>
                <div style={{
                  width: w, minHeight: BH * 2, display: "flex", alignItems: "center",
                  justifyContent: "center", textAlign: "center", fontSize: g.name.length <= 40 ? 11 : 10,
                  fontWeight: 700, lineHeight: 1.15, color: C.gold, padding: "2px 5px",
                  background: "rgba(255,255,255,0.03)", border: `1px solid ${BR_LINE}`, boxSizing: "border-box",
                }}>{g.name}</div>
                <div style={{ width: BW }}>
                  <Bar team={g.right[0]} w={BW} />
                  <div style={{
                    height: BH, lineHeight: `${BH}px`, fontSize: 11, textAlign: "center",
                    fontFamily: "'IBM Plex Mono', monospace", background: "rgba(255,255,255,0.03)",
                    border: `1px solid ${BR_LINE}`, borderTop: "none", boxSizing: "border-box",
                    color: win === g.right[0] ? C.turf : C.slate, fontWeight: win === g.right[0] ? 700 : 400,
                  }}>{g.right[1]}</div>
                </div>
              </div>
              {!played && (
                <div style={{ fontSize: 9, color: C.slate, marginTop: 3 }}>no result recorded</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// --- shared geometry: both halves use the identical bracket shape -----------
const BR_BANNERS = [[0, 436, "NFC", "#1B3E8C"], [560, 436, "AFC", "#B22234"]];

const BR_MAIN_PATHS = [
  "M100 38 L106 38 L106 95 L112 95", "M100 152 L106 152 L106 95 L112 95",
  "M100 266 L106 266 L106 323 L112 323", "M100 380 L106 380 L106 323 L112 323",
  "M212 95 L218 95 L218 209 L224 209", "M212 323 L218 323 L218 209 L224 209",
  "M324 209 L336 209", "M436 209 L448 209",
  "M896 38 L890 38 L890 95 L884 95", "M896 152 L890 152 L890 95 L884 95",
  "M896 266 L890 266 L890 323 L884 323", "M896 380 L890 380 L890 323 L884 323",
  "M784 95 L778 95 L778 209 L772 209", "M784 323 L778 323 L778 209 L772 209",
  "M672 209 L660 209", "M560 209 L548 209",
];

// week 15 -> week 16 feeders inside the 8-team placement bracket (identical
// in both halves; only which box wins differs, and that's in the paths below)
const BR_W15_FEEDERS = [
  "M212 329 L218 329 L218 386 L224 386", "M212 367 L218 367 L218 386 L224 386",
  "M212 443 L218 443 L218 424 L224 424", "M212 481 L218 481 L218 424 L224 424",
  "M884 329 L878 329 L878 386 L872 386", "M884 367 L878 367 L878 386 L872 386",
  "M884 443 L878 443 L878 424 L872 424", "M884 481 L878 481 L878 424 L872 424",
];

// --- 2025 NFL, ranks 1-16 (championship half) ------------------------------
// ===========================================================================
// BR TEMPLATE — the NFL-shape bracket (8 seeds/conference, 4 real rounds to
// a champion, plus a full mirrored losers' ladder down to 15th/16th place).
// Verified byte-for-byte against BOTH real 2025 halves before being written:
// every routing rule (who plays whom at every tier) was checked participant-
// by-participant against NFL_2025_PLAYOFFS/CONSOLATION's own hand-authored
// boxes. Box positions below are a FIXED layout — confirmed identical
// between both real 2025 halves — not computed per season, exactly like
// R3_MAIN_PATHS/R3_SEED_SLOTS.
//
// `conf` shape (one conference, e.g. NFC), each game a [team,score,team,score]:
//   r1:     [g1,g2,g3,g4]  wild card: seed(1v8),(4v5),(3v6),(2v7)
//   r2:     [g5,g6]        divisional: winner(g1)vwinner(g2), winner(g3)vwinner(g4)
//   r3:     g7             conf championship: winner(g5) v winner(g6)
//   lr1:    [g8,g9]        losers' wild card: loser(g1)vloser(g2), loser(g3)vloser(g4)
//   lr2w:   g10            winner(g8) v winner(g9)  -> feeds 9th place
//   lr2l:   g11            loser(g8)  v loser(g9)   -> feeds 13th place
//   r2lose: g12            loser(g5)  v loser(g6)   -> feeds 5th/7th place
// `o` (one half) = { east: conf, west: conf, champ,third,fifth,seventh,
//   ninth,eleventh,thirteenth,fifteenth (8 cross-conference games),
//   banners, brMainPaths, ladderPaths, logo, logoSrc, champSlots, ladderH,
//   places, footer, and EITHER championSub (renders a trophy box) OR
//   topWinnerY/topPick/topLabel (renders a plain rank label, e.g. "17th
//   place" for the consolation half — a rank isn't a trophy) }.
// ===========================================================================
// A game only counts as PLAYED when both scores parse as numbers AND one is
// strictly higher. Without this, a blank game (2026 brackets), a 0.00-0.00 and
// a genuine tie all fall through `>` as false and silently flag the SECOND
// team as the winner — which would have shown a green winning score in every
// empty pairing and named a blank team champion.
// MUST be declared here, before brWinner/brLoser/brSplit below — those are
// called by brChampHalf, which NFL_2025_PLAYOFFS invokes immediately at
// module load (not deferred to render), so a later declaration throws
// "Cannot access before initialization" the instant the module evaluates,
// blanking the entire page before React ever mounts. esbuild's syntax check
// does not catch this; only running the module does.
const r3Num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
const r3Played = (sa, sb) => { const a = r3Num(sa), b = r3Num(sb); return a !== null && b !== null && a !== b; };
const r3Won = (sa, sb) => r3Played(sa, sb) && r3Num(sa) > r3Num(sb);

const brBlank = ["", "", "", ""];
const brWinner = (g) => (r3Played(g[1], g[3]) ? (r3Won(g[1], g[3]) ? g[0] : g[2]) : "");
const brLoser  = (g) => (r3Played(g[1], g[3]) ? (r3Won(g[1], g[3]) ? g[2] : g[0]) : "");
function brSplit(x1, y1, x2, y2, g) {
  const [a, sa, b, sb] = g;
  const played = r3Played(sa, sb);
  const aw = r3Won(sa, sb);
  return [[x1, y1, a, sa, played && aw ? 1 : 0], [x2, y2, b, sb, played && !aw ? 1 : 0]];
}
const brStack = (x, y, g) => brSplit(x, y, x, y + 38, g);

const BR_R1_Y = [0, 38, 114, 152, 228, 266, 342, 380];
const BR_R2_Y = [57, 95, 285, 323];
const BR_R3_Y = [171, 209];
const BR_FINAL_Y = 190;

// One conference's own R1->R2->R3 ladder (14 boxes). The finalist itself
// (feeding the cross-conference final) is built separately in brChampHalf.
function brMainSide(conf, side) {
  const [x0, x1, x2] = side === "east" ? [0, 112, 224] : [896, 784, 672];
  return [
    ...brStack(x0, BR_R1_Y[0], conf.r1[0]), ...brStack(x0, BR_R1_Y[2], conf.r1[1]),
    ...brStack(x0, BR_R1_Y[4], conf.r1[2]), ...brStack(x0, BR_R1_Y[6], conf.r1[3]),
    ...brStack(x1, BR_R2_Y[0], conf.r2[0]), ...brStack(x1, BR_R2_Y[2], conf.r2[1]),
    ...brStack(x2, BR_R3_Y[0], conf.r3),
  ];
}

// One conference's own placement ladder (20 boxes, feeds 5th/7th/9th/11th/
//13th/15th). 3rd place needs no within-conference game — only one candidate
// per side already exists (the conf-championship loser) — so it isn't built
// here; it's a cross-conference game assembled directly in brChampHalf.
function brLadderSide(conf, side) {
  const [x0, x1] = side === "east" ? [112, 224] : [784, 672];
  return [
    ...brSplit(x1, 150, x1, 188, conf.r2lose),
    ...brSplit(x0, 310, x0, 348, conf.lr1[0]), ...brSplit(x0, 424, x0, 462, conf.lr1[1]),
    ...brSplit(x1, 367, x1, 405, conf.lr2w), ...brSplit(x1, 560, x1, 598, conf.lr2l),
  ];
}

function brChampHalf(o) {
  const eastMain = brMainSide(o.east, "east");
  const westMain = brMainSide(o.west, "west");
  const finalists = brSplit(336, BR_FINAL_Y, 560, BR_FINAL_Y, o.champ);
  const eastLadder = brLadderSide(o.east, "east");
  const westLadder = brLadderSide(o.west, "west");
  const boxes = [
    ...eastMain, ...westMain, ...finalists,
  ];
  const ladderBoxes = [
    ...brSplit(336, 33, 560, 33, o.third), ...eastLadder, ...westLadder,
    ...brSplit(336, 143, 560, 143, o.fifth), ...brSplit(336, 229, 560, 229, o.seventh),
    ...brSplit(336, 367, 560, 367, o.ninth), ...brSplit(336, 438, 560, 438, o.eleventh),
    ...brSplit(336, 559, 560, 559, o.thirteenth), ...brSplit(336, 630, 560, 630, o.fifteenth),
  ];
  const section1 = {
    banners: o.banners, h: 418, paths: o.brMainPaths, logo: o.logo, logoSrc: o.logoSrc,
    slots: o.champSlots, boxes,
  };
  if (o.championSub !== undefined) {
    section1.champion = { y: BR_FINAL_Y, label: "Champion", team: brWinner(o.champ), sub: o.championSub };
  } else {
    section1.winners = [[448, o.topWinnerY ?? 171, brWinner(o.champ)]];
    section1.places = [[448, (o.topWinnerY ?? 171) + 19, o.topPick, o.topLabel]];
  }
  return {
    sections: [
      section1,
      {
        h: o.ladderH, paths: o.ladderPaths, boxes: ladderBoxes,
        winners: [
          [448, 14, brWinner(o.third)], [448, 124, brWinner(o.fifth)], [448, 210, brWinner(o.seventh)],
          [448, 348, brWinner(o.ninth)], [448, 419, brWinner(o.eleventh)],
          [448, 540, brWinner(o.thirteenth)], [448, 611, brWinner(o.fifteenth)],
        ],
        places: o.places, footer: o.footer,
      },
    ],
  };
}

const NFL_2025_PLAYOFFS = brChampHalf({
  east: {
    r1: [["San Francisco", "169.40", "Arizona", "156.40"], ["Philadelphia", "157.55", "LA Rams", "181.80"],
         ["Green Bay", "206.15", "Seattle", "145.05"], ["New Orleans", "123.75", "Detroit", "126.85"]],
    r2: [["San Francisco", "145.05", "LA Rams", "207.30"], ["Green Bay", "187.75", "Detroit", "220.50"]],
    r3: ["LA Rams", "275.75", "Detroit", "109.15"],
    lr1: [["Arizona", "215.15", "Philadelphia", "258.40"], ["Seattle", "176.60", "New Orleans", "130.50"]],
    lr2w: ["Philadelphia", "181.50", "Seattle", "157.70"],
    lr2l: ["Arizona", "180.05", "New Orleans", "146.90"],
    r2lose: ["San Francisco", "242.20", "Green Bay", "227.95"],
  },
  west: {
    r1: [["New England", "165.55", "Tennessee", "200.40"], ["LA Chargers", "234.35", "Miami", "113.60"],
         ["Baltimore", "211.60", "NY Jets", "148.05"], ["Jacksonville", "160.00", "Pittsburgh", "171.80"]],
    r2: [["Tennessee", "219.85", "LA Chargers", "132.40"], ["Baltimore", "231.70", "Pittsburgh", "116.80"]],
    r3: ["Tennessee", "236.90", "Baltimore", "197.10"],
    lr1: [["New England", "146.90", "Miami", "186.75"], ["NY Jets", "227.40", "Jacksonville", "101.00"]],
    lr2w: ["Miami", "178.80", "NY Jets", "204.70"],
    lr2l: ["New England", "184.60", "Jacksonville", "106.80"],
    r2lose: ["LA Chargers", "154.35", "Pittsburgh", "187.80"],
  },
  champ: ["LA Rams", "178.40", "Tennessee", "210.60"],
  third: ["Detroit", "144.60", "Baltimore", "102.80"],
  fifth: ["San Francisco", "204.35", "Pittsburgh", "175.15"],
  seventh: ["Green Bay", "192.40", "LA Chargers", "146.20"],
  ninth: ["Philadelphia", "129.65", "NY Jets", "194.80"],
  eleventh: ["Seattle", "123.80", "Miami", "173.45"],
  thirteenth: ["Arizona", "138.35", "New England", "197.20"],
  fifteenth: ["New Orleans", "140.70", "Jacksonville", "109.60"],
  banners: BR_BANNERS, brMainPaths: BR_MAIN_PATHS, logo: "NFL", logoSrc: NFL_MARK,
  championSub: "PainBowl IV",
  champSlots: [[448, 16, 100, 150, "Trophy", NFL_TROPHY], [448, 250, 100, 100, "PFA", PFA_MARK]],
  ladderH: 690,
  ladderPaths: [
    "M324 169 L330 169 L330 162 L336 162", "M324 207 L330 207 L330 248 L336 248",
    "M672 207 L666 207 L666 162 L660 162", "M672 169 L666 169 L666 248 L660 248",
    ...BR_W15_FEEDERS,
    "M324 386 L336 386", "M324 424 L330 424 L330 457 L336 457",
    "M672 386 L666 386 L666 457 L660 457", "M672 424 L666 424 L666 386 L660 386",
    "M324 579 L330 579 L330 578 L336 578", "M324 617 L330 617 L330 649 L336 649",
    "M672 579 L666 579 L666 578 L660 578", "M672 617 L666 617 L666 649 L660 649",
  ],
  places: [
    [448, 33, "29th pick", "3rd place"], [448, 143, "25th pick", "5th place"],
    [448, 229, "27th pick", "7th place"], [448, 367, "17th pick", "9th place"],
    [448, 438, "19th pick", "11th place"], [448, 559, "21st pick", "13th place"],
    [448, 630, "23rd pick", "15th place"],
  ],
});

// --- 2025 NFL, ranks 17-32 (consolation half) ------------------------------
// Same bracket shape one tier down: the 17th-place game is this half's
// championship, and the Relegation Bowl at the bottom fires the last coach.
const NFL_2025_CONSOLATION = brChampHalf({
  east: {
    r1: [["Dallas", "126.40", "Atlanta", "132.50"], ["Chicago", "158.35", "Washington", "129.45"],
         ["Minnesota", "116.10", "Tampa Bay", "109.75"], ["NY Giants", "195.40", "Carolina", "144.85"]],
    r2: [["Atlanta", "171.15", "Chicago", "95.85"], ["Minnesota", "167.35", "NY Giants", "212.40"]],
    r3: ["Atlanta", "171.75", "NY Giants", "143.05"],
    lr1: [["Dallas", "165.85", "Washington", "143.60"], ["Tampa Bay", "125.15", "Carolina", "142.00"]],
    lr2w: ["Dallas", "177.90", "Carolina", "179.60"],
    lr2l: ["Washington", "121.90", "Tampa Bay", "129.35"],
    r2lose: ["Chicago", "105.90", "Minnesota", "147.05"],
  },
  west: {
    r1: [["Cincinnati", "189.95", "Denver", "68.20"], ["Las Vegas", "154.65", "Houston", "109.90"],
         ["Indianapolis", "141.50", "Kansas City", "135.10"], ["Buffalo", "216.15", "Cleveland", "134.50"]],
    r2: [["Cincinnati", "189.45", "Las Vegas", "157.00"], ["Indianapolis", "158.70", "Buffalo", "139.90"]],
    r3: ["Cincinnati", "180.95", "Indianapolis", "126.25"],
    lr1: [["Denver", "96.05", "Houston", "100.90"], ["Kansas City", "136.10", "Cleveland", "106.70"]],
    lr2w: ["Houston", "84.30", "Kansas City", "143.80"],
    lr2l: ["Denver", "90.15", "Cleveland", "109.70"],
    r2lose: ["Las Vegas", "117.60", "Buffalo", "82.35"],
  },
  champ: ["Atlanta", "108.65", "Cincinnati", "175.90"],
  third: ["NY Giants", "203.80", "Indianapolis", "174.75"],
  fifth: ["Minnesota", "204.70", "Las Vegas", "169.10"],
  seventh: ["Chicago", "157.60", "Buffalo", "155.00"],
  ninth: ["Carolina", "146.55", "Kansas City", "118.40"],
  eleventh: ["Dallas", "171.60", "Houston", "92.20"],
  thirteenth: ["Tampa Bay", "132.10", "Cleveland", "94.40"],
  fifteenth: ["Washington", "153.00", "Denver", "63.50"],
  banners: BR_BANNERS, brMainPaths: BR_MAIN_PATHS, logo: "NFL", logoSrc: NFL_MARK,
  topWinnerY: 171, topPick: "9th pick", topLabel: "17th place",
  champSlots: [[448, 30, 100, 110, "PFA", PFA_MARK]],
  ladderH: 730,
  ladderPaths: [
    "M324 169 L330 169 L330 248 L336 248", "M324 207 L330 207 L330 162 L336 162",
    "M672 169 L666 169 L666 162 L660 162", "M672 207 L666 207 L666 248 L660 248",
    ...BR_W15_FEEDERS,
    "M324 424 L330 424 L330 386 L336 386", "M324 386 L330 386 L330 457 L336 457",
    "M672 424 L666 424 L666 386 L660 386", "M672 386 L666 386 L666 457 L660 457",
    "M324 617 L330 617 L330 578 L336 578", "M324 579 L330 579 L330 649 L336 649",
    "M672 617 L666 617 L666 578 L660 578", "M672 579 L666 579 L666 649 L660 649",
  ],
  places: [
    [448, 33, "11th pick", "19th place"], [448, 143, "13th pick", "21st place"],
    [448, 229, "15th pick", "23rd place"], [448, 367, "3rd pick", "25th place"],
    [448, 438, "5th pick", "27th place"], [448, 559, "7th pick", "29th place"],
    [448, 630, "2nd pick", "31st place"],
  ],
  footer: [336, 680, 324, "Relegation Bowl", "LAST PLACE COACH IS FIRED"],
});

// --- 2025 USFL, 20 teams -----------------------------------------------------
// Unusual shape vs the NFL: only ONE game per half in week 14 (a play-in);
// three teams per half bye straight into week 15, so their boxes have no
// feeder line. The two week-14 losers then play a THREE-WEEK series (weeks
// 15-17) for 9th, decided on combined points — the running total sits above
// each game. USFL city names collide with NFL ones, so colours are scoped
// to this league via `colors`.
const USFL_CLR = {
  "New Jersey": ["#C8102E", "#FFFFFF"], Philadelphia: ["#E8541F", "#FFD100"],
  "San Antonio": ["#6AA76A", "#12305F"], Washington: ["#5B8FC9", "#12305F"],
  Birmingham: ["#BFB3A0", "#C8102E"], Boston: ["#1F4EBD", "#FFFFFF"],
  Memphis: ["#F5CE7E", "#12305F"], Pittsburgh: ["#101820", "#F5C400"],
  Denver: ["#101820", "#D4AF37"], "Los Angeles": ["#B3C1E0", "#12305F"],
  Arizona: ["#E03C31", "#FFFFFF"], Houston: ["#101820", "#E03C31"],
  Michigan: ["#7C2529", "#9FC5E8"], "Tampa Bay": ["#E03C31", "#FFFFFF"],
  Detroit: ["#4A90D9", "#FFB612"], Oklahoma: ["#101820", "#E03C31"],
  Jacksonville: ["#B8B8B8", "#FFFFFF"], Oakland: ["#2B6CB0", "#D4AF37"],
  Chicago: ["#A0A0A0", "#E03C31"], Orlando: ["#D93B27", "#12305F"],
};

const USFL_BANNERS = [[0, 436, "United States Football League", "#4F8A4F"],
                     [560, 436, "Championship", "#4F8A4F"]];
const USFL_CONSO_BANNERS = [[0, 436, "United States Football League", "#4F8A4F"],
                            [560, 436, "Consolation", "#4F8A4F"]];

// One play-in feeding slot 2 of week 15's upper game, three byes, then the
// usual converge to week 16 and cross in week 17. Same on both halves.
const USFL_MAIN_PATHS = [
  "M100 38 L106 38 L106 57 L112 57", "M100 76 L106 76 L106 57 L112 57",
  "M212 19 L218 19 L218 38 L224 38", "M212 57 L218 57 L218 38 L224 38",
  "M212 209 L218 209 L218 228 L224 228", "M212 247 L218 247 L218 228 L224 228",
  "M324 38 L330 38 L330 133 L336 133", "M324 228 L330 228 L330 133 L336 133",
  "M436 133 L448 133",
  "M896 38 L890 38 L890 57 L884 57", "M896 76 L890 76 L890 57 L884 57",
  "M784 19 L778 19 L778 38 L772 38", "M784 57 L778 57 L778 38 L772 38",
  "M784 209 L778 209 L778 228 L772 228", "M784 247 L778 247 L778 228 L772 228",
  "M672 38 L666 38 L666 133 L660 133", "M672 228 L666 228 L666 133 L660 133",
  "M560 133 L548 133",
];

const USFL_2025_PLAYOFFS = {
  colors: USFL_CLR,
  logoSrc: USFL_MARK,
  sections: [
    {
      banners: USFL_BANNERS, h: 280, paths: USFL_MAIN_PATHS, logo: "USFL",
      slots: [[448, 4, 100, 84, "Trophy", USFL_TROPHY], [448, 176, 100, 96, "PFA", PFA_MARK]],
      champion: { y: 114, label: "Champion", team: "Memphis", sub: "1st place" },
      boxes: [
        [0, 19, "New Jersey", "194.05"], [0, 57, "Philadelphia", "240.10", 1],
        [112, 0, "San Antonio", "328.65", 1], [112, 38, "Philadelphia", "233.10"],
        [112, 190, "Washington", "266.40", 1], [112, 228, "Birmingham", "214.20"],
        [224, 19, "San Antonio", "261.60", 1], [224, 209, "Washington", "190.90"],
        [336, 114, "San Antonio", "208.50"],
        [560, 114, "Memphis", "228.30", 1],
        [672, 19, "Memphis", "222.05", 1], [672, 209, "Denver", "181.60"],
        [784, 0, "Pittsburgh", "174.95"], [784, 38, "Memphis", "231.75", 1],
        [784, 190, "Denver", "291.85", 1], [784, 228, "Los Angeles", "240.45"],
        [896, 19, "Boston", "227.90"], [896, 57, "Memphis", "246.50", 1],
      ],
    },
    {
      h: 420,
      paths: [
        "M324 169 L330 169 L330 162 L336 162", "M324 207 L330 207 L330 248 L336 248",
        "M672 207 L666 207 L666 162 L660 162", "M672 169 L666 169 L666 248 L660 248",
      ],
      boxes: [
        [336, 33, "Washington", "192.40", 1], [560, 33, "Denver", "168.40"],
        [224, 150, "Philadelphia", "218.20", 1], [224, 188, "Birmingham", "177.65"],
        [672, 150, "Pittsburgh", "179.30"], [672, 188, "Los Angeles", "268.65", 1],
        [336, 143, "Philadelphia", "273.25", 1], [560, 143, "Los Angeles", "243.10"],
        [336, 229, "Birmingham", "154.00"], [560, 229, "Pittsburgh", "165.10", 1],
        [112, 360, "New Jersey", "195.00"], [784, 360, "Boston", "180.60"],
      ],
      series: [
        [224, 341, "435.70", "Gm 2/3", "240.70"], [336, 341, "580.85", "Gm 3/3", "145.15"],
        [560, 341, "620.70", "Gm 3/3", "255.30", 1], [672, 341, "365.40", "Gm 2/3", "184.80"],
      ],
      winners: [
        [448, 14, "Washington"], [448, 124, "Philadelphia"],
        [448, 210, "Pittsburgh"], [448, 341, "Boston"],
      ],
      places: [
        [448, 33, "11th pick", "3rd place"], [448, 143, "13th pick", "5th place"],
        [448, 229, "15th pick", "7th place"], [448, 360, "17th pick", "9th place"],
      ],
    },
  ],
};

const USFL_2025_CONSOLATION = {
  colors: USFL_CLR,
  logoSrc: USFL_MARK,
  sections: [
    {
      banners: USFL_CONSO_BANNERS, h: 280, paths: USFL_MAIN_PATHS, logo: "USFL",
      slots: [[448, 4, 100, 70, "PFA", PFA_MARK]],
      winners: [[448, 95, "Detroit"]],
      places: [[448, 114, "3rd pick", "11th place"]],
      boxes: [
        [0, 19, "Arizona", "133.80"], [0, 57, "Houston", "197.90", 1],
        [112, 0, "Michigan", "166.00"], [112, 38, "Houston", "205.05", 1],
        [112, 190, "Tampa Bay", "189.80"], [112, 228, "Detroit", "202.25", 1],
        [224, 19, "Houston", "160.15"], [224, 209, "Detroit", "241.35", 1],
        [336, 114, "Detroit", "254.05", 1],
        [560, 114, "Oklahoma", "149.45"],
        [672, 19, "Oklahoma", "232.15", 1], [672, 209, "Orlando", "215.05"],
        [784, 0, "Oklahoma", "172.65", 1], [784, 38, "Jacksonville", "97.70"],
        [784, 190, "Chicago", "84.40"], [784, 228, "Orlando", "173.70", 1],
        [896, 19, "Jacksonville", "118.95", 1], [896, 57, "Oakland", "70.80"],
      ],
    },
    {
      h: 470,
      paths: [
        "M324 169 L330 169 L330 162 L336 162", "M324 207 L330 207 L330 248 L336 248",
        "M672 169 L666 169 L666 162 L660 162", "M672 207 L666 207 L666 248 L660 248",
      ],
      boxes: [
        [336, 33, "Houston", "117.50"], [560, 33, "Orlando", "166.00", 1],
        [224, 150, "Michigan", "204.50", 1], [224, 188, "Tampa Bay", "160.35"],
        [672, 150, "Jacksonville", "125.65", 1], [672, 188, "Chicago", "85.50"],
        [336, 143, "Michigan", "196.00", 1], [560, 143, "Jacksonville", "142.80"],
        [336, 229, "Tampa Bay", "130.70", 1], [560, 229, "Chicago", "106.20"],
        [112, 360, "Arizona", "115.20"], [784, 360, "Oakland", "72.60"],
      ],
      series: [
        [224, 341, "231.90", "Gm 2/3", "116.70"], [336, 341, "391.85", "Gm 3/3", "159.95", 1],
        [560, 341, "275.80", "Gm 3/3", "80.80"], [672, 341, "195.00", "Gm 2/3", "122.40"],
      ],
      winners: [
        [448, 14, "Orlando"], [448, 124, "Michigan"],
        [448, 210, "Tampa Bay"], [448, 341, "Arizona"],
      ],
      places: [
        [448, 33, "5th pick", "13th place"], [448, 143, "7th pick", "15th place"],
        [448, 229, "9th pick", "17th place"], [448, 360, "2nd pick", "19th place"],
      ],
      footer: [112, 420, 772, "Relegation Bowl", "LAST PLACE COACH IS FIRED"],
    },
  ],
};


// --- 2025 XFL, 20 teams ------------------------------------------------------
// Same shape as the USFL: one play-in per half in week 14, three byes into
// week 15, and a three-week points series for 9th/19th. Reuses
// USFL_MAIN_PATHS wholesale. Colours are scoped per league because XFL city
// names collide with both the NFL and USFL.
const XFL_CLR = {
  "Tampa Bay": ["#7FA86A", "#F5D76E"], Memphis: ["#6B2737", "#FFFFFF"],
  DC: ["#B02A2A", "#FFFFFF"], Seattle: ["#3E8E5A", "#F5A03C"],
  Orlando: ["#D93B27", "#F5D76E"], Dallas: ["#6BA5D7", "#12305F"],
  Birmingham: ["#E8B84B", "#12305F"], Brooklyn: ["#101820", "#E8B84B"],
  LAX: ["#1F3A6E", "#FFFFFF"], Boston: ["#101820", "#E03C31"],
  "New Jersey": ["#A8B4C4", "#12305F"], Chicago: ["#2B4FA8", "#FFFFFF"],
  LAW: ["#F5A03C", "#C8102E"], Omaha: ["#E8791F", "#FFFFFF"],
  Atlanta: ["#4B2569", "#D8C9A3"], "St Louis": ["#1F3A6E", "#FFFFFF"],
  "Las Vegas": ["#7C1F1F", "#FFFFFF"], "New York": ["#101820", "#FFFFFF"],
  "San Francisco": ["#E03C31", "#FFFFFF"], Houston: ["#12233A", "#E03C31"],
};

const XFL_BANNERS = [[0, 436, "XFL", "#CFE0C3", undefined, "#000"], [560, 436, "Championship", "#CFE0C3", undefined, "#000"]];
const XFL_CONSO_BANNERS = [[0, 436, "XFL", "#CFE0C3", undefined, "#000"], [560, 436, "Consolation", "#CFE0C3", undefined, "#000"]];

const XFL_2025_PLAYOFFS = {
  colors: XFL_CLR,
  logoSrc: XFL_MARK,
  sections: [
    {
      banners: XFL_BANNERS, h: 280, paths: USFL_MAIN_PATHS, logo: "XFL",
      slots: [[448, 4, 100, 84, "Trophy", XFL_TROPHY], [448, 176, 100, 96, "PFA", PFA_MARK]],
      champion: { y: 114, label: "Champion", team: "Birmingham", sub: "1st place" },
      boxes: [
        [0, 19, "Tampa Bay", "125.75"], [0, 57, "Memphis", "246.50", 1],
        [112, 0, "DC", "263.05", 1], [112, 38, "Memphis", "240.30"],
        [112, 190, "Seattle", "238.85", 1], [112, 228, "Orlando", "200.15"],
        [224, 19, "DC", "260.60", 1], [224, 209, "Seattle", "226.60"],
        [336, 114, "DC", "168.05"],
        [560, 114, "Birmingham", "199.80", 1],
        [672, 19, "Birmingham", "168.70", 1], [672, 209, "Boston", "147.00"],
        [784, 0, "Brooklyn", "217.00"], [784, 38, "Birmingham", "225.75", 1],
        [784, 190, "LAX", "205.00"], [784, 228, "Boston", "210.00", 1],
        [896, 19, "Dallas", "210.15"], [896, 57, "Birmingham", "217.25", 1],
      ],
    },
    {
      h: 420,
      paths: [
        "M324 169 L330 169 L330 162 L336 162", "M324 207 L330 207 L330 248 L336 248",
        "M672 207 L666 207 L666 162 L660 162", "M672 169 L666 169 L666 248 L660 248",
      ],
      boxes: [
        [336, 33, "Seattle", "173.10", 1], [560, 33, "Boston", "111.00"],
        [224, 150, "Memphis", "240.65", 1], [224, 188, "Orlando", "166.55"],
        [672, 150, "Brooklyn", "226.05"], [672, 188, "LAX", "231.80", 1],
        [336, 143, "Memphis", "205.10"], [560, 143, "LAX", "286.60", 1],
        [336, 229, "Orlando", "182.30", 1], [560, 229, "Brooklyn", "180.95"],
        [112, 360, "Tampa Bay", "206.50"], [784, 360, "Dallas", "180.00"],
      ],
      series: [
        [224, 341, "358.60", "Gm 2/3", "152.10"], [336, 341, "572.50", "Gm 3/3", "213.90", 1],
        [560, 341, "565.80", "Gm 3/3", "194.20"], [672, 341, "371.60", "Gm 2/3", "191.60"],
      ],
      winners: [
        [448, 14, "Seattle"], [448, 124, "LAX"], [448, 210, "Orlando"], [448, 341, "Tampa Bay"],
      ],
      places: [
        [448, 33, "11th pick", "3rd place"], [448, 143, "13th pick", "5th place"],
        [448, 229, "15th pick", "7th place"], [448, 360, "17th pick", "9th place"],
      ],
    },
  ],
};

const XFL_2025_CONSOLATION = {
  colors: XFL_CLR,
  logoSrc: XFL_MARK,
  sections: [
    {
      banners: XFL_CONSO_BANNERS, h: 280, paths: USFL_MAIN_PATHS, logo: "XFL",
      slots: [[448, 4, 100, 70, "PFA", PFA_MARK]],
      winners: [[448, 95, "Omaha"]],
      places: [[448, 114, "3rd pick", "11th place"]],
      boxes: [
        [0, 19, "New Jersey", "158.20", 1], [0, 57, "Chicago", "127.25"],
        [112, 0, "LAW", "205.30", 1], [112, 38, "New Jersey", "166.40"],
        [112, 190, "Omaha", "199.35", 1], [112, 228, "Atlanta", "177.15"],
        [224, 19, "LAW", "175.15"], [224, 209, "Omaha", "236.10", 1],
        [336, 114, "Omaha", "214.35", 1],
        [560, 114, "St Louis", "197.10"],
        [672, 19, "St Louis", "182.95", 1], [672, 209, "Houston", "117.00"],
        [784, 0, "New York", "185.95"], [784, 38, "St Louis", "211.65", 1],
        [784, 190, "San Francisco", "127.90"], [784, 228, "Houston", "145.70", 1],
        [896, 19, "St Louis", "169.60", 1], [896, 57, "Las Vegas", "160.85"],
      ],
    },
    {
      h: 470,
      paths: [
        "M324 207 L330 207 L330 162 L336 162", "M324 169 L330 169 L330 248 L336 248",
        "M672 207 L666 207 L666 162 L660 162", "M672 169 L666 169 L666 248 L660 248",
      ],
      boxes: [
        [336, 33, "LAW", "163.10"], [560, 33, "Houston", "185.30", 1],
        [224, 150, "New Jersey", "141.60"], [224, 188, "Atlanta", "210.90", 1],
        [672, 150, "New York", "211.65"], [672, 188, "San Francisco", "213.60", 1],
        [336, 143, "Atlanta", "206.20", 1], [560, 143, "San Francisco", "159.20"],
        [336, 229, "New Jersey", "172.05"], [560, 229, "New York", "181.55", 1],
        [112, 360, "Chicago", "172.95"], [784, 360, "Las Vegas", "171.10"],
      ],
      series: [
        [224, 341, "323.60", "Gm 2/3", "150.65"], [336, 341, "459.10", "Gm 3/3", "135.50", 1],
        [560, 341, "428.95", "Gm 3/3", "142.00"], [672, 341, "286.95", "Gm 2/3", "115.85"],
      ],
      winners: [
        [448, 14, "Houston"], [448, 124, "Atlanta"], [448, 210, "New York"], [448, 341, "Chicago"],
      ],
      places: [
        [448, 33, "5th pick", "13th place"], [448, 143, "7th pick", "15th place"],
        [448, 229, "9th pick", "17th place"], [448, 360, "2nd pick", "19th place"],
      ],
      footer: [112, 420, 772, "Relegation Bowl", "LAST PLACE COACH IS FIRED"],
    },
  ],
};

// Tiers with a fully transcribed 2025 bracket. Adding a tier or season from
// here on is a data-only change — no layout code to touch.

// --- 3-round geometry: 16 teams, weeks 15-17, no week 14 -------------------
// Shared by SEC, Big Ten and SWAC.
// Narrower than the NFL shape, so it gets its own geometry. The centre column
// stays at x=448 and the week-14 columns (0 / 896) simply go unused, which
// keeps the champion box, league mark and placement labels on their existing
// anchors. Confirmed with Lainey: the 5th- and 13th-place brackets are the
// week-15 LOSERS, who have no week-15 game of their own and enter at week 16.
const SEC_BANNERS = [[112, 324, "South Eastern Conference", "#12467F"], [560, 324, "Championship", "#12467F"]];
const SEC_CONSO_BANNERS = [[112, 324, "South Eastern Conference", "#12467F"], [560, 324, "Consolation", "#12467F"]];

const SEC_CLR = {
  "South Carolina": ["#73000A", "#FFFFFF"], "Miss State": ["#5D1725", "#FFFFFF"],
  "Arkansas": ["#9D2235", "#FFFFFF"], "Oklahoma": ["#841617", "#FDF4E3"],
  "Kentucky": ["#0033A0", "#FFFFFF"], "Missouri": ["#F1B82D", "#231F20"],
  "Ole Miss": ["#14213D", "#CE1126"], "Texas A&M": ["#FFFFFF", "#500000"],
  "Florida": ["#0021A5", "#FA4616"], "Texas": ["#FFFFFF", "#BF5700"],
  "Tennessee": ["#FF8200", "#4B4B4B"], "Auburn": ["#0C2340", "#E87722"],
  "Georgia": ["#BA0C2F", "#101010"], "LSU": ["#461D7C", "#FDD023"],
  "Vanderbilt": ["#0A0A0A", "#CFAE70"], "Alabama": ["#9E1B32", "#FFFFFF"],
};

const R3_MAIN_PATHS = [
  "M212 19 L218 19 L218 38 L224 38", "M212 57 L218 57 L218 38 L224 38",
  "M212 133 L218 133 L218 152 L224 152", "M212 171 L218 171 L218 152 L224 152",
  "M324 38 L330 38 L330 95 L336 95", "M324 152 L330 152 L330 95 L336 95",
  "M436 95 L448 95",
  "M784 19 L778 19 L778 38 L772 38", "M784 57 L778 57 L778 38 L772 38",
  "M784 133 L778 133 L778 152 L772 152", "M784 171 L778 171 L778 152 L772 152",
  "M672 38 L666 38 L666 95 L660 95", "M672 152 L666 152 L666 95 L660 95",
  "M560 95 L548 95",
];

// placement section: the 5th/13th-place bracket's week-16 feeders, plus the
// short runs from each week-17 box into the centre placement label
const R3_PLACE_PATHS = [
  "M324 114 L330 114 L330 133 L336 133", "M324 152 L330 152 L330 133 L336 133",
  "M672 114 L666 114 L666 133 L660 133", "M672 152 L666 152 L666 133 L660 133",
  "M436 57 L448 57", "M560 57 L548 57",
  "M436 133 L448 133", "M560 133 L548 133",
  "M436 228 L448 228", "M560 228 L548 228",
];

// ===========================================================================
// R3 BRACKET TEMPLATE (16 teams, 3 rounds, weeks 15-17)
// ---------------------------------------------------------------------------
// SEC, TEN, SWAC and BIG XII were each verified to use the SAME 30 box
// coordinate pairs, in the SAME order, in BOTH halves. R3 geometry was never
// a per-tier choice, so it must not be hand-typed again -- these builders
// emit it. A new R3 tier is DATA ONLY.
//
// Games are written in bracket order as [teamA, scoreA, teamB, scoreB] and
// the WINNER IS DERIVED from the two scores, so a win flag can no longer
// disagree with the numbers printed beside it (the Big Ten 9th-place bug).
// ===========================================================================

const r3Winner = (g) => (r3Played(g[1], g[3]) ? (r3Won(g[1], g[3]) ? g[0] : g[2]) : "");
const r3Loser = (g) => (r3Played(g[1], g[3]) ? (r3Won(g[1], g[3]) ? g[2] : g[0]) : "");

// one game as two boxes at arbitrary positions
function r3Split(x1, y1, x2, y2, g) {
  const [a, sa, b, sb] = g;
  const played = r3Played(sa, sb);
  const aw = r3Won(sa, sb);
  // Unplayed: neither side is flagged, so no false green winner.
  return [[x1, y1, a, sa, played && aw ? 1 : 0], [x2, y2, b, sb, played && !aw ? 1 : 0]];
}
// one game as two stacked boxes
const r3Stack = (x, y, g) => r3Split(x, y, x, y + 38, g);

const R3_CHAMP_PICKS = [["9th pick", "3rd place"], ["11th pick", "5th place"], ["13th pick", "7th place"]];
const R3_CONSO_PICKS = [["5th pick", "11th place"], ["7th pick", "13th place"], ["2nd pick", "15th place"]];

function r3MainBoxes({ wk15, semis, final }) {
  const [g1, g2, g3, g4] = wk15;
  return [
    ...r3Stack(112, 0, g1), ...r3Stack(112, 114, g2),
    ...r3Split(224, 19, 224, 133, semis[0]),
    ...r3Split(336, 76, 560, 76, final),
    ...r3Split(672, 19, 672, 133, semis[1]),
    ...r3Stack(784, 0, g3), ...r3Stack(784, 114, g4),
  ];
}

// The 5th/13th-place sub-bracket: the four week-15 LOSERS enter at week 16,
// so they have no week-15 game of their own.
function r3PlaceSection({ upper, mid, lower, picks, footer }) {
  const s = {
    cols: WK_COLS_3, h: footer ? 300 : 258, paths: R3_PLACE_PATHS,
    boxes: [
      ...r3Split(336, 38, 560, 38, upper),
      ...r3Stack(224, 95, mid.leftQual),
      ...r3Split(336, 114, 560, 114, mid.final),
      ...r3Stack(672, 95, mid.rightQual),
      ...r3Split(336, 209, 560, 209, lower),
    ],
    winners: [[448, 19, r3Winner(upper)], [448, 95, r3Winner(mid.final)], [448, 190, r3Winner(lower)]],
    places: [[448, 38, ...picks[0]], [448, 114, ...picks[1]], [448, 209, ...picks[2]]],
  };
  if (footer) s.footer = footer;
  return s;
}

// ===========================================================================
// LIVE-SEEDED R3 BRACKETS (current season)
// The 2025 brackets are static data — the scores were transcribed by hand. A
// current-season bracket cannot be, because the seeds move every time a game
// is played, so it is BUILT AT RENDER TIME from the live standings and filled
// in as results arrive. Same geometry, same template, empty games.
// ===========================================================================

// Grid slot order is [left-top, left-bottom, right-top, right-bottom]. The
// pairings themselves are BRACKET_PAIRS_R1; what this fixes is which HALF each
// sits in, so the 1 and 2 seeds are in opposite halves and can only meet in
// the final. Confirmed against Lainey's sheets 2026-08-01.
const R3_SEED_SLOTS = [[1, 8], [4, 5], [2, 7], [3, 6]];

const r3Blank = ["", "", "", ""];

// Live standings carry full team names ("South Carolina Gamecocks"); the
// bracket's colour maps and 100px boxes use a short form that is often an
// ABBREVIATION, not a prefix — "N Colorado", "GA Tech", "W Virginia", "Penn
// State" vs "Penn St. Nittany Lions". So compare normalised TOKENS: upper-case,
// punctuation stripped, a leading "THE" dropped ("THE Ohio State Buckeyes"),
// run-together caps split ("GeorgiaTech" -> "Georgia Tech"), and the usual
// abbreviations expanded. A colour key matches when its tokens are a prefix of
// the team's tokens; the longest such key wins.
// Unmatched names are NOT an error — they fall back to the full name, which
// still renders, just wider and in the default colour.
const R3_TOKEN_EXPAND = {
  N: "NORTH", S: "SOUTH", E: "EAST", W: "WEST",
  GA: "GEORGIA", ST: "STATE", MISS: "MISSISSIPPI", CAL: "CALIFORNIA",
  TENN: "TENNESSEE",
};
function r3Tokens(v) {
  const split = String(v || "").replace(/([a-z])([A-Z])/g, "$1 $2");   // GeorgiaTech
  return split.toUpperCase().replace(/&/g, " AND ").replace(/[^A-Z0-9 ]/g, " ")
    .split(/\s+/).filter((t) => t && t !== "THE")
    .map((t) => R3_TOKEN_EXPAND[t] || t);
}
function r3ShortName(full, colors, aliases) {
  if (aliases && aliases[full]) return aliases[full];
  const ft = r3Tokens(full);
  let best = "";
  Object.keys(colors || {}).forEach((k) => {
    const kt = r3Tokens(k);
    if (kt.length && kt.every((t, i) => ft[i] === t) && k.length > best.length) best = k;
  });
  return best || full;
}

// seeds: the tier's 8 ranked rows for this half, index 0 = the 1 seed.
function r3LiveHalf(cfg, seeds, half) {
  const name = (n) => {
    const row = seeds[n - 1];
    return row ? r3ShortName(row.team, cfg.colors, cfg.aliases) : "";
  };
  const o = {
    colors: cfg.colors, logoSrc: cfg.logoSrc, logo: cfg.logo,
    banners: half === "playoffs" ? cfg.banners : cfg.consoBanners,
    trophy: cfg.trophy,
    wk15: R3_SEED_SLOTS.map(([a, b]) => [name(a), "", name(b), ""]),
    semis: [r3Blank, r3Blank],
    final: r3Blank,
    third: r3Blank, seventh: r3Blank,
    eleventh: r3Blank, fifteenth: r3Blank,
    fifth: { leftQual: r3Blank, rightQual: r3Blank, final: r3Blank },
    thirteenth: { leftQual: r3Blank, rightQual: r3Blank, final: r3Blank },
  };
  if (half === "playoffs") return r3ChampHalf(o);
  o.footer = [336, 258, 324, "Relegation Bowl", "LAST PLACE COACH IS FIRED"];
  return r3ConsoHalf(o);
}

// ── conference-top4 tiers (SUN/SOCO/IVY/SWAC/GLIAC) ───────────────────────
// Unlike the merged 1-8 seed list above, each side of THIS bracket already IS
// one whole conference — they are separate brackets that only meet at the
// final, exactly the mirrored-halves rule the 2025 sheets were built on.
// Confirmed structurally from SUN's own 2025 data before writing this: its
// wk15 left-column pair (GA State v JMU, then App State v Arlington) both
// feed the SAME wk16 semis[0] slot, so they must be one conference's own
// 1v4-and-2v3 mini-bracket, not a cross-conference seed list. Which
// conference sits left is `east` (computeBracket's division-1 group) —
// confirmed against every 2025 banner's own sub-line, where banners[0]
// (left) always names the same conference as `east`.
function r3ConfWk15(eastRows, westRows, cfg) {
  const nm = (rows, n) => {
    const row = rows[n - 1];
    return row ? r3ShortName(row.team, cfg.colors, cfg.aliases) : "";
  };
  return [
    [nm(eastRows, 1), "", nm(eastRows, 4), ""],   // left-top:     east 1 v 4
    [nm(eastRows, 2), "", nm(eastRows, 3), ""],   // left-bottom:  east 2 v 3
    [nm(westRows, 1), "", nm(westRows, 4), ""],   // right-top:    west 1 v 4
    [nm(westRows, 2), "", nm(westRows, 3), ""],   // right-bottom: west 2 v 3
  ];
}
function r3LiveHalfConf(cfg, group, half) {
  const o = {
    colors: cfg.colors, logoSrc: cfg.logoSrc, logo: cfg.logo,
    banners: half === "playoffs" ? cfg.banners : cfg.consoBanners,
    trophy: cfg.trophy,
    wk15: r3ConfWk15(group.east || [], group.west || [], cfg),
    semis: [r3Blank, r3Blank],
    final: r3Blank,
    third: r3Blank, seventh: r3Blank,
    eleventh: r3Blank, fifteenth: r3Blank,
    fifth: { leftQual: r3Blank, rightQual: r3Blank, final: r3Blank },
    thirteenth: { leftQual: r3Blank, rightQual: r3Blank, final: r3Blank },
  };
  if (half === "playoffs") return r3ChampHalf(o);
  o.footer = [336, 258, 324, "Relegation Bowl", "LAST PLACE COACH IS FIRED"];
  return r3ConsoHalf(o);
}

// Returns { playoffs, consolation } for a live-seeded tier, or null.
// Branches on which shape computeBracket returned for this format: a flat
// 1-8 `playoffSeeds` list (top8-cascade) or an `{east, west}` `playoffGroup`
// (conference-top4). Unsupported formats (FLHS, NFL, USFL/XFL) return null
// and fall through to the old seeding-only renderer, unchanged.
function buildR3Live(tierKey, bracket) {
  const cfg = R3_LIVE[tierKey];
  if (!cfg || !bracket) return null;
  if (bracket.playoffSeeds && bracket.playoffSeeds.length > 0) {
    return {
      playoffs: r3LiveHalf(cfg, bracket.playoffSeeds, "playoffs"),
      consolation: r3LiveHalf(cfg, bracket.consolationSeeds || [], "consolation"),
    };
  }
  if (bracket.playoffGroup && (bracket.playoffGroup.east?.length || bracket.playoffGroup.west?.length)) {
    return {
      playoffs: r3LiveHalfConf(cfg, bracket.playoffGroup, "playoffs"),
      consolation: r3LiveHalfConf(cfg, bracket.consolationGroup || { east: [], west: [] }, "consolation"),
    };
  }
  return null;
}

// ranks 1-8
function r3ChampHalf(o) {
  return {
    colors: o.colors, logoSrc: o.logoSrc,
    sections: [
      {
        banners: o.banners, cols: WK_COLS_3, h: 200, paths: R3_MAIN_PATHS, logo: o.logo,
        slots: [[448, 0, 100, 52, "Trophy", o.trophy], [448, 114, 100, 57, "PFA", PFA_MARK]],
        champion: { y: 76, label: o.championLabel || "Champion", team: r3Winner(o.final) },
        boxes: r3MainBoxes(o),
      },
      r3PlaceSection({ upper: o.third, mid: o.fifth, lower: o.seventh, picks: R3_CHAMP_PICKS }),
    ],
  };
}

// ranks 9-16
function r3ConsoHalf(o) {
  return {
    colors: o.colors, logoSrc: o.logoSrc,
    sections: [
      {
        banners: o.banners, cols: WK_COLS_3, h: 200, paths: R3_MAIN_PATHS, logo: o.logo,
        slots: [[448, 0, 100, 50, "PFA", PFA_MARK]],
        winners: [[448, 57, r3Winner(o.final)]],
        places: [[448, 76, "3rd pick", "9th place"]],
        boxes: r3MainBoxes(o),
      },
      r3PlaceSection({
        upper: o.eleventh, mid: o.thirteenth, lower: o.fifteenth,
        picks: R3_CONSO_PICKS, footer: o.footer,
      }),
    ],
  };
}

// --- 2025 SEC, ranks 1-8 (championship half) --------------------------------
const SEC_2025_PLAYOFFS = {
  colors: SEC_CLR,
  logoSrc: SEC_MARK,
  sections: [
    {
      banners: SEC_BANNERS, cols: WK_COLS_3, h: 200, paths: R3_MAIN_PATHS, logo: "SEC",
      slots: [[448, 0, 100, 52, "Trophy", SEC_TROPHY], [448, 114, 100, 57, "PFA", PFA_MARK]],
      champion: { y: 76, label: "Champion", team: "South Carolina" },
      boxes: [
        [112, 0, "South Carolina", "240.65", 1], [112, 38, "Miss State", "227.60"],
        [112, 114, "Arkansas", "236.60", 1], [112, 152, "Oklahoma", "231.75"],
        [224, 19, "South Carolina", "255.30", 1], [224, 133, "Arkansas", "168.00"],
        [336, 76, "South Carolina", "242.30", 1],
        [560, 76, "Ole Miss", "191.55"],
        [672, 19, "Kentucky", "240.40"], [672, 133, "Ole Miss", "248.60", 1],
        [784, 0, "Kentucky", "234.05", 1], [784, 38, "Missouri", "188.85"],
        [784, 114, "Ole Miss", "263.00", 1], [784, 152, "Texas A&M", "231.80"],
      ],
    },
    {
      cols: WK_COLS_3, h: 258, paths: R3_PLACE_PATHS,
      boxes: [
        [336, 38, "Arkansas", "213.70"], [560, 38, "Kentucky", "233.60", 1],
        [224, 95, "Miss State", "202.10"], [224, 133, "Oklahoma", "216.55", 1],
        [336, 114, "Oklahoma", "174.90"],
        [560, 114, "Texas A&M", "237.90", 1],
        [672, 95, "Missouri", "218.65"], [672, 133, "Texas A&M", "304.85", 1],
        [336, 209, "Miss State", "222.55", 1], [560, 209, "Missouri", "202.15"],
      ],
      winners: [[448, 19, "Kentucky"], [448, 95, "Texas A&M"], [448, 190, "Miss State"]],
      places: [
        [448, 38, "9th pick", "3rd place"], [448, 114, "11th pick", "5th place"],
        [448, 209, "13th pick", "7th place"],
      ],
    },
  ],
};

// --- 2025 SEC, ranks 9-16 (consolation half) --------------------------------
const SEC_2025_CONSOLATION = {
  colors: SEC_CLR,
  logoSrc: SEC_MARK,
  sections: [
    {
      banners: SEC_CONSO_BANNERS, cols: WK_COLS_3, h: 200, paths: R3_MAIN_PATHS, logo: "SEC",
      slots: [[448, 0, 100, 50, "PFA", PFA_MARK]],
      winners: [[448, 57, "Florida"]],
      places: [[448, 76, "3rd pick", "9th place"]],
      boxes: [
        [112, 0, "Florida", "164.50", 1], [112, 38, "Texas", "150.95"],
        [112, 114, "Tennessee", "211.20", 1], [112, 152, "Auburn", "177.05"],
        [224, 19, "Florida", "235.10", 1], [224, 133, "Tennessee", "167.90"],
        [336, 76, "Florida", "185.95", 1],
        [560, 76, "Georgia", "158.40"],
        [672, 19, "Georgia", "266.25", 1], [672, 133, "Vanderbilt", "214.30"],
        [784, 0, "Georgia", "221.20", 1], [784, 38, "LSU", "152.40"],
        [784, 114, "Vanderbilt", "233.05", 1], [784, 152, "Alabama", "221.05"],
      ],
    },
    {
      cols: WK_COLS_3, h: 300, paths: R3_PLACE_PATHS,
      boxes: [
        [336, 38, "Tennessee", "204.70", 1], [560, 38, "Vanderbilt", "188.30"],
        [224, 95, "Texas", "136.30"], [224, 133, "Auburn", "172.15", 1],
        [336, 114, "Auburn", "175.10"],
        [560, 114, "Alabama", "179.30", 1],
        [672, 95, "LSU", "133.70"], [672, 133, "Alabama", "145.25", 1],
        [336, 209, "Texas", "175.85", 1], [560, 209, "LSU", "119.90"],
      ],
      winners: [[448, 19, "Tennessee"], [448, 95, "Alabama"], [448, 190, "Texas"]],
      places: [
        [448, 38, "5th pick", "11th place"], [448, 114, "7th pick", "13th place"],
        [448, 209, "2nd pick", "15th place"],
      ],
      footer: [336, 258, 324, "Relegation Bowl", "LAST PLACE COACH IS FIRED"],
    },
  ],
};

// Week 18 exhibitions — outside the bracket, no effect on placements or CP.
const SEC_2025_BOWLS = {
  header: "Week 18 \u2014 Rivalry Week",
  colors: SEC_CLR,
  games: [
    { name: "OKKY Bowl", logo: OKKY_MARK, left: ["Oklahoma", "194.75"], right: ["Kentucky", "162.30"] },
    { name: "Cocks n Hogs Bowl", logo: HOGS_MARK, left: ["South Carolina", "198.30"], right: ["Arkansas", "133.75"] },
  ],
};


// --- 2025 Big Ten ----------------------------------------------------------
const TEN_BANNERS = [[112, 324, "BIG10 Conference", "#4F9BD9"], [560, 324, "Championship", "#4F9BD9"]];
const TEN_CONSO_BANNERS = [[112, 324, "BIG10 Conference", "#4F9BD9"], [560, 324, "Consolation", "#4F9BD9"]];

const TEN_CLR = {
  "Northwestern": ["#4E2A84", "#FFFFFF"], "Oregon": ["#154733", "#FEE123"],
  "Cal": ["#041E42", "#FDB515"], "Washington": ["#4B2E83", "#E8E3D3"],
  "Indiana": ["#990000", "#EEEDEB"], "Ohio State": ["#BB0000", "#FFFFFF"],
  "UCLA": ["#2D68C4", "#FFFFFF"], "Penn State": ["#041E42", "#FFFFFF"],
  "Purdue": ["#0A0A0A", "#CEB888"], "Wisconsin": ["#C5050C", "#FFFFFF"],
  "Utah": ["#CC0000", "#FFFFFF"], "Rutgers": ["#CC0033", "#FFFFFF"],
  "Michigan": ["#00274C", "#FFCB05"], "Maryland": ["#E03A3E", "#FFD520"],
  "Illinois": ["#E84A27", "#FFFFFF"], "USC": ["#990000", "#FFC72C"],
};

const TEN_2025_PLAYOFFS = {
  colors: TEN_CLR,
  logoSrc: TEN_MARK,
  sections: [
    {
      banners: TEN_BANNERS, cols: WK_COLS_3, h: 200, paths: R3_MAIN_PATHS, logo: "B1G",
      slots: [[448, 0, 100, 52, "Trophy", TEN_TROPHY], [448, 114, 100, 57, "PFA", PFA_MARK]],
      champion: { y: 76, label: "Champion", team: "Northwestern" },
      boxes: [
        [112, 0, "Northwestern", "233.00", 1], [112, 38, "Oregon", "145.30"],
        [112, 114, "Cal", "204.25"], [112, 152, "Washington", "213.95", 1],
        [224, 19, "Northwestern", "273.20", 1], [224, 133, "Washington", "162.50"],
        [336, 76, "Northwestern", "218.80", 1],
        [560, 76, "UCLA", "131.55"],
        [672, 19, "Ohio State", "202.70"], [672, 133, "UCLA", "237.70", 1],
        [784, 0, "Indiana", "215.85"], [784, 38, "Ohio State", "236.35", 1],
        [784, 114, "UCLA", "248.10", 1], [784, 152, "Penn State", "154.85"],
      ],
    },
    {
      cols: WK_COLS_3, h: 258, paths: R3_PLACE_PATHS,
      boxes: [
        [336, 38, "Washington", "237.60", 1], [560, 38, "Ohio State", "173.95"],
        [224, 95, "Oregon", "217.90"], [224, 133, "Cal", "281.40", 1],
        [336, 114, "Cal", "233.70", 1],
        [560, 114, "Indiana", "185.55"],
        [672, 95, "Indiana", "184.00", 1], [672, 133, "Penn State", "177.75"],
        [336, 209, "Oregon", "188.65"], [560, 209, "Penn State", "198.05", 1],
      ],
      winners: [[448, 19, "Washington"], [448, 95, "Cal"], [448, 190, "Penn State"]],
      places: [
        [448, 38, "9th pick", "3rd place"], [448, 114, "11th pick", "5th place"],
        [448, 209, "13th pick", "7th place"],
      ],
    },
  ],
};

// NOTE: the 9th-place winner bar printed on Lainey's sheet said Michigan, but the
// scores are Purdue 238.80 to Michigan 224.05. She confirmed the sheet was wrong
// and Purdue took 9th, so the scores stand here.
const TEN_2025_CONSOLATION = {
  colors: TEN_CLR,
  logoSrc: TEN_MARK,
  sections: [
    {
      banners: TEN_CONSO_BANNERS, cols: WK_COLS_3, h: 200, paths: R3_MAIN_PATHS, logo: "B1G",
      slots: [[448, 0, 100, 50, "PFA", PFA_MARK]],
      winners: [[448, 57, "Purdue"]],
      places: [[448, 76, "3rd pick", "9th place"]],
      boxes: [
        [112, 0, "Utah", "153.30"], [112, 38, "Wisconsin", "182.80", 1],
        [112, 114, "Purdue", "318.00", 1], [112, 152, "Rutgers", "248.40"],
        [224, 19, "Wisconsin", "181.65"], [224, 133, "Purdue", "219.45", 1],
        [336, 76, "Purdue", "238.80", 1],
        [560, 76, "Michigan", "224.05"],
        [672, 19, "Michigan", "193.55", 1], [672, 133, "Illinois", "179.05"],
        [784, 0, "Michigan", "216.40", 1], [784, 38, "Maryland", "214.70"],
        [784, 114, "Illinois", "184.65", 1], [784, 152, "USC", "160.65"],
      ],
    },
    {
      cols: WK_COLS_3, h: 300, paths: R3_PLACE_PATHS,
      boxes: [
        [336, 38, "Wisconsin", "156.60", 1], [560, 38, "Illinois", "153.20"],
        [224, 95, "Utah", "196.30", 1], [224, 133, "Rutgers", "108.60"],
        [336, 114, "Utah", "182.95"],
        [560, 114, "Maryland", "203.40", 1],
        [672, 95, "Maryland", "212.55", 1], [672, 133, "USC", "201.45"],
        [336, 209, "Rutgers", "169.80"], [560, 209, "USC", "208.50", 1],
      ],
      winners: [[448, 19, "Wisconsin"], [448, 95, "Maryland"], [448, 190, "USC"]],
      places: [
        [448, 38, "5th pick", "11th place"], [448, 114, "7th pick", "13th place"],
        [448, 209, "2nd pick", "15th place"],
      ],
      footer: [336, 258, 324, "Relegation Bowl", "LAST PLACE COACH IS FIRED"],
    },
  ],
};

const TEN_2025_BOWLS = {
  header: "Week 18",
  colors: TEN_CLR,
  games: [
    { name: "Indiana Bowl", logo: INDIANA_MARK, left: ["Purdue", "191.35"], right: ["Indiana", "191.80"] },
  ],
};


// --- 2025 SWAC -------------------------------------------------------------
// Two differences from SEC / Big Ten: East and West division banners, and the
// 7th-place game carries a novelty name ("7-11 Seven Days A Week 7th Place
// Super Savings Bowl") instead of the usual label. That bowl is NOT a week-18
// exhibition -- it is the 7th-place game itself, so it stays inside the bracket
// and its result sets the 7/8 placements normally.
const SWAC_BANNERS = [
  [112, 324, "Southwest Athletic Conference", "#111", "The SWAC Pack"],
  [560, 324, "Championship", "#C8102E"],
];
const SWAC_CONSO_BANNERS = [[112, 324, "", "#111"], [560, 324, "Consolation", "#C8102E"]];
const SWAC_BOWL_NAME = "7-11 Seven Days A Week 7th Place Super Savings Bowl";

const SWAC_CLR = {
  "Jackson St": ["#123B63", "#FFFFFF"], "Florida A&M": ["#F58220", "#154734"],
  "Miss Valley": ["#1B4D2E", "#D2262C"], "Bethune": ["#7B2132", "#F0B323"],
  "Morgan St": ["#12395B", "#F0A526"], "Alcorn": ["#4B2E83", "#F0B323"],
  "PVAM": ["#6B3FA0", "#FFFFFF"], "Southern U": ["#6BAAE8", "#C8A620"],
  "Alabama A&M": ["#6E1E2B", "#FFFFFF"], "Alabama St": ["#0A0A0A", "#C9A200"],
  "SC St": ["#7B2635", "#6F9BD1"], "Norfolk St": ["#046A38", "#F0B323"],
  "Grambling": ["#E3B23C", "#231F20"], "Pine Bluff": ["#C9A227", "#231F20"],
  "TX Southern": ["#C4C6C8", "#5B0E2D"], "NC Central": ["#862633", "#C4C6C8"],
};

const SWAC_2025_PLAYOFFS = {
  colors: SWAC_CLR,
  logoSrc: SWAC_MARK,
  sections: [
    {
      banners: SWAC_BANNERS, cols: WK_COLS_3, h: 200, paths: R3_MAIN_PATHS, logo: "SWAC",
      slots: [[448, 0, 100, 52, "Trophy", SWAC_TROPHY], [448, 114, 100, 57, "PFA", PFA_MARK]],
      champion: { y: 76, label: "Champion", team: "Morgan St" },
      boxes: [
        [112, 0, "Jackson St", "309.30", 1], [112, 38, "Florida A&M", "278.85"],
        [112, 114, "Miss Valley", "249.25", 1], [112, 152, "Bethune", "166.85"],
        [224, 19, "Jackson St", "227.00"], [224, 133, "Miss Valley", "253.30", 1],
        [336, 76, "Miss Valley", "200.90"],
        [560, 76, "Morgan St", "207.65", 1],
        [672, 19, "Morgan St", "234.15", 1], [672, 133, "PVAM", "219.30"],
        [784, 0, "Morgan St", "220.85", 1], [784, 38, "Alcorn", "164.80"],
        [784, 114, "PVAM", "298.30", 1], [784, 152, "Southern U", "142.45"],
      ],
    },
    {
      cols: WK_COLS_3, h: 282, paths: R3_PLACE_PATHS,
      slots: [[468, 154, 60, 34, "7-11", SEVEN_MARK]],
      boxes: [
        [336, 38, "Jackson St", "265.80", 1], [560, 38, "PVAM", "164.25"],
        [224, 95, "Florida A&M", "162.65"], [224, 133, "Bethune", "247.45", 1],
        [336, 114, "Bethune", "191.70", 1],
        [560, 114, "Southern U", "158.55"],
        [672, 95, "Alcorn", "161.40"], [672, 133, "Southern U", "211.00", 1],
        [336, 209, "Florida A&M", "169.25"], [560, 209, "Alcorn", "238.85", 1],
      ],
      winners: [[448, 19, "Jackson St"], [448, 95, "Bethune"], [448, 190, "Alcorn"]],
      places: [
        [448, 38, "9th pick", "3rd place"], [448, 114, "11th pick", "5th place"],
        [448, 209, "", SWAC_BOWL_NAME],
      ],
    },
  ],
};

const SWAC_2025_CONSOLATION = {
  colors: SWAC_CLR,
  logoSrc: SWAC_MARK,
  sections: [
    {
      banners: SWAC_CONSO_BANNERS, cols: WK_COLS_3, h: 200, paths: R3_MAIN_PATHS, logo: "SWAC",
      slots: [[448, 0, 100, 50, "PFA", PFA_MARK]],
      winners: [[448, 57, "Grambling"]],
      places: [[448, 76, "3rd pick", "9th place"]],
      boxes: [
        [112, 0, "Alabama A&M", "197.90", 1], [112, 38, "Alabama St", "179.75"],
        [112, 114, "SC St", "234.00", 1], [112, 152, "Norfolk St", "209.85"],
        [224, 19, "Alabama A&M", "201.65"], [224, 133, "SC St", "218.30", 1],
        [336, 76, "SC St", "199.50"],
        [560, 76, "Grambling", "208.60", 1],
        [672, 19, "Grambling", "210.25", 1], [672, 133, "NC Central", "199.65"],
        [784, 0, "Grambling", "270.05", 1], [784, 38, "Pine Bluff", "176.70"],
        [784, 114, "TX Southern", "148.90"], [784, 152, "NC Central", "167.70", 1],
      ],
    },
    {
      cols: WK_COLS_3, h: 300, paths: R3_PLACE_PATHS,
      boxes: [
        [336, 38, "Alabama A&M", "246.20", 1], [560, 38, "NC Central", "139.90"],
        [224, 95, "Alabama St", "182.95", 1], [224, 133, "Norfolk St", "166.80"],
        [336, 114, "Alabama St", "170.60", 1],
        [560, 114, "Pine Bluff", "154.40"],
        [672, 95, "Pine Bluff", "213.20", 1], [672, 133, "TX Southern", "190.80"],
        [336, 209, "Norfolk St", "113.30"], [560, 209, "TX Southern", "227.70", 1],
      ],
      winners: [[448, 19, "Alabama A&M"], [448, 95, "Alabama St"], [448, 190, "TX Southern"]],
      places: [
        [448, 38, "5th pick", "11th place"], [448, 114, "7th pick", "13th place"],
        [448, 209, "2nd pick", "15th place"],
      ],
      footer: [336, 258, 324, "Relegation Bowl", "LAST PLACE COACH IS FIRED"],
    },
  ],
};


// --- 2025 Big XII ----------------------------------------------------------
const XII_BANNERS = [[112, 324, "Big XII Conference", "#E8593C"], [560, 324, "Championship", "#E8593C"]];
const XII_CONSO_BANNERS = [[112, 324, "", "#E8593C"], [560, 324, "Consolation", "#E8593C"]];

const XII_CLR = {
  "Iowa State": ["#9E1B32", "#F1BE48"], "OSU": ["#FF7300", "#0A0A0A"],
  "Cincinnati": ["#E00122", "#0A0A0A"], "Houston": ["#FFFFFF", "#C8102E"],
  "S Dakota": ["#FFD100", "#003DA5"], "BYU": ["#002E5D", "#FFFFFF"],
  "Denver": ["#7A1F2B", "#F0B323"], "N Iowa": ["#4B116F", "#FFCC00"],
  "Kansas State": ["#512888", "#FFFFFF"], "N Colorado": ["#003B5C", "#FFC72C"],
  "Baylor": ["#154734", "#FFB81C"], "W Virginia": ["#002855", "#EAAA00"],
  "Kansas": ["#0051BA", "#E8000D"], "Texas Tech": ["#0A0A0A", "#CC0000"],
  "UCF": ["#0A0A0A", "#BA9B37"], "TCU": ["#4D1979", "#FFFFFF"],
};

const XII_2025_PLAYOFFS = {
  colors: XII_CLR,
  logoSrc: XII_MARK,
  sections: [
    {
      banners: XII_BANNERS, cols: WK_COLS_3, h: 200, paths: R3_MAIN_PATHS, logo: "XII",
      slots: [[448, 0, 100, 52, "Trophy", XII_TROPHY], [448, 114, 100, 57, "PFA", PFA_MARK]],
      champion: { y: 76, label: "Champion", team: "OSU" },
      boxes: [
        [112, 0, "Iowa State", "260.95"], [112, 38, "OSU", "301.90", 1],
        [112, 114, "Cincinnati", "223.25", 1], [112, 152, "Houston", "188.00"],
        [224, 19, "OSU", "260.35", 1], [224, 133, "Cincinnati", "234.40"],
        [336, 76, "OSU", "226.10", 1],
        [560, 76, "S Dakota", "164.00"],
        [672, 19, "S Dakota", "266.00", 1], [672, 133, "N Iowa", "165.75"],
        [784, 0, "S Dakota", "238.25", 1], [784, 38, "BYU", "223.70"],
        [784, 114, "Denver", "162.35"], [784, 152, "N Iowa", "184.30", 1],
      ],
    },
    {
      cols: WK_COLS_3, h: 258, paths: R3_PLACE_PATHS,
      boxes: [
        [336, 38, "Cincinnati", "245.25", 1], [560, 38, "N Iowa", "210.70"],
        [224, 95, "Iowa State", "205.55"], [224, 133, "Houston", "243.40", 1],
        [336, 114, "Houston", "227.10", 1],
        [560, 114, "BYU", "181.65"],
        [672, 95, "BYU", "262.70", 1], [672, 133, "Denver", "163.05"],
        [336, 209, "Iowa State", "205.20", 1], [560, 209, "Denver", "130.20"],
      ],
      winners: [[448, 19, "Cincinnati"], [448, 95, "Houston"], [448, 190, "Iowa State"]],
      places: [
        [448, 38, "9th pick", "3rd place"], [448, 114, "11th pick", "5th place"],
        [448, 209, "13th pick", "7th place"],
      ],
    },
  ],
};

// --- 2025 Big XII, ranks 9-16 (consolation half) ----------------------------
const XII_2025_CONSOLATION = {
  colors: XII_CLR,
  logoSrc: XII_MARK,
  sections: [
    {
      banners: XII_CONSO_BANNERS, cols: WK_COLS_3, h: 200, paths: R3_MAIN_PATHS, logo: "XII",
      slots: [[448, 0, 100, 50, "PFA", PFA_MARK]],
      winners: [[448, 57, "Baylor"]],
      places: [[448, 76, "3rd pick", "9th place"]],
      boxes: [
        [112, 0, "Kansas State", "207.10"], [112, 38, "N Colorado", "211.35", 1],
        [112, 114, "Baylor", "193.95", 1], [112, 152, "W Virginia", "168.25"],
        [224, 19, "N Colorado", "138.50"], [224, 133, "Baylor", "154.45", 1],
        [336, 76, "Baylor", "242.05", 1],
        [560, 76, "TCU", "200.55"],
        [672, 19, "Kansas", "174.15"], [672, 133, "TCU", "183.50", 1],
        [784, 0, "Kansas", "223.40", 1], [784, 38, "Texas Tech", "135.55"],
        [784, 114, "UCF", "206.90"], [784, 152, "TCU", "214.70", 1],
      ],
    },
    {
      cols: WK_COLS_3, h: 300, paths: R3_PLACE_PATHS,
      boxes: [
        [336, 38, "N Colorado", "118.50"], [560, 38, "Kansas", "221.95", 1],
        [224, 95, "Kansas State", "163.05"], [224, 133, "W Virginia", "225.85", 1],
        [336, 114, "W Virginia", "156.50", 1],
        [560, 114, "UCF", "128.80"],
        [672, 95, "Texas Tech", "162.80"], [672, 133, "UCF", "210.90", 1],
        [336, 209, "Kansas State", "234.40", 1], [560, 209, "Texas Tech", "177.70"],
      ],
      winners: [[448, 19, "Kansas"], [448, 95, "W Virginia"], [448, 190, "Kansas State"]],
      places: [
        [448, 38, "5th pick", "11th place"], [448, 114, "7th pick", "13th place"],
        [448, 209, "2nd pick", "15th place"],
      ],
      footer: [336, 258, 324, "Relegation Bowl", "LAST PLACE COACH IS FIRED"],
    },
  ],
};

// --- 2025 ACC ---------------------------------------------------------------
// First tier built on the R3 template: data only, no coordinates.
//
// Artwork: ACC_MARK and ACC_TROPHY are cut from the originals (logo off solid
// #013CA6, trophy off #F7F7F7) with the background flood-filled from the
// border and edge pixels un-premultiplied, so there is no white fringe. Both
// constants live up beside the other tier marks ABOVE TIER_LOGOS -- they must
// stay there, since TIER_LOGOS references ACC_MARK at module init and const
// is not hoisted.
const ACC_BANNERS = [[112, 324, "Atlantic Coast Conference", "#013CA6"], [560, 324, "Championship", "#013CA6"]];
const ACC_CONSO_BANNERS = [[112, 324, "", "#013CA6"], [560, 324, "Consolation", "#013CA6"]];

const ACC_CLR = {
  "Duke": ["#012169", "#FFFFFF"], "Notre Dame": ["#0C2340", "#C99700"],
  "Syracuse": ["#F76900", "#000E54"], "Virginia": ["#232D4B", "#F84C1E"],
  "Virginia Tech": ["#630031", "#CF4420"], "N Carolina": ["#7BAFD4", "#FFFFFF"],
  "Louisville": ["#AD0000", "#FFFFFF"], "Clemson": ["#F56600", "#522D80"],
  "Florida St": ["#782F40", "#CEB888"], "GA Tech": ["#B3A369", "#003057"],
  "Pittsburgh": ["#003594", "#FFB81C"], "Boston College": ["#98002E", "#BC9B6A"],
  "Wake Forest": ["#9E7E38", "#000000"], "NC State": ["#CC0000", "#FFFFFF"],
  "SMU": ["#C8102E", "#FFFFFF"], "Miami": ["#005030", "#F47321"],
};

// The ACC championship game has no proper name (like SEC / TEN / BIG XII).
const ACC_2025_PLAYOFFS = r3ChampHalf({
  colors: ACC_CLR, logo: "ACC", logoSrc: ACC_MARK, trophy: ACC_TROPHY,
  banners: ACC_BANNERS,
  wk15: [
    ["Duke", "325.20", "Notre Dame", "271.30"],
    ["Syracuse", "152.10", "Virginia", "134.95"],
    ["Virginia Tech", "228.40", "N Carolina", "189.80"],
    ["Louisville", "227.35", "Clemson", "189.45"],
  ],
  semis: [
    ["Duke", "266.40", "Syracuse", "162.60"],
    ["Virginia Tech", "338.30", "Louisville", "234.10"],
  ],
  final: ["Duke", "210.85", "Virginia Tech", "239.65"],
  third: ["Syracuse", "168.75", "Louisville", "199.50"],
  fifth: {
    leftQual: ["Notre Dame", "299.60", "Virginia", "218.25"],
    rightQual: ["N Carolina", "219.15", "Clemson", "185.45"],
    final: ["Notre Dame", "252.75", "N Carolina", "253.40"],
  },
  seventh: ["Virginia", "142.90", "Clemson", "209.30"],
});

const ACC_2025_CONSOLATION = r3ConsoHalf({
  colors: ACC_CLR, logo: "ACC", logoSrc: ACC_MARK,
  banners: ACC_CONSO_BANNERS,
  wk15: [
    ["Florida St", "242.65", "GA Tech", "252.55"],
    ["Pittsburgh", "257.80", "Boston College", "214.95"],
    ["Wake Forest", "201.05", "NC State", "105.40"],
    ["SMU", "254.40", "Miami", "228.85"],
  ],
  semis: [
    ["GA Tech", "234.55", "Pittsburgh", "164.25"],
    ["Wake Forest", "165.25", "SMU", "169.75"],
  ],
  final: ["GA Tech", "151.90", "SMU", "165.95"],
  eleventh: ["Pittsburgh", "160.15", "Wake Forest", "214.00"],
  thirteenth: {
    leftQual: ["Florida St", "248.25", "Boston College", "156.60"],
    rightQual: ["NC State", "164.40", "Miami", "219.40"],
    final: ["Florida St", "264.35", "Miami", "163.10"],
  },
  fifteenth: ["Boston College", "198.15", "NC State", "201.10"],
  footer: [336, 258, 324, "Relegation Bowl", "LAST PLACE COACH IS FIRED"],
});

// --- 2025 SoCon (SOCO) ------------------------------------------------------
// R3 template, data only. First tier with NAMED divisions: North/South ride
// as the optional 5th banner element (the italic sub-line), which grows
// GHeader to 58px. SWAC has divisions too but conveys them by banner colour
// alone. Consolation follows the house style -- left banner title blank like
// SWAC/BIG XII/ACC -- while keeping both division sub-lines.
const SOCO_BANNERS = [
  [112, 324, "Southern Conference", "#C93927", "North"],
  [560, 324, "Championship", "#020C84", "South"],
];
const SOCO_CONSO_BANNERS = [
  [112, 324, "", "#C93927", "North"],
  [560, 324, "Consolation", "#020C84", "South"],
];

const SOCO_CLR = {
  "Tenn State": ["#00539B", "#FFFFFF"], "Mercer": ["#F76800", "#0A0A0A"],
  "Jax State": ["#CC0000", "#FFFFFF"], "Elon": ["#73000A", "#B59A57"],
  "Austin Peay": ["#C8102E", "#FFFFFF"], "Belmont": ["#CE1141", "#041E42"],
  "Carolina": ["#492C88", "#FFC72C"], "Citadel": ["#003087", "#FFFFFF"],
  "E Tenn": ["#041E42", "#FFC72C"], "VMI": ["#C69214", "#FFFFFF"],
  "Martin": ["#002D62", "#FF6E00"], "Samford": ["#002469", "#FFFFFF"],
  "Chattanooga": ["#C99700", "#041E42"], "Murray State": ["#002144", "#FDCA1F"],
  "Nicholls": ["#C8102E", "#FFFFFF"], "Tenn Tech": ["#4E2A84", "#FFC423"],
};

// No proper championship-game name, and no week-18 bowls on the SoCon sheets.
const SOCO_2025_PLAYOFFS = r3ChampHalf({
  colors: SOCO_CLR, logo: "SoCon", logoSrc: SOCO_MARK, trophy: SOCO_TROPHY,
  banners: SOCO_BANNERS,
  wk15: [
    ["Tenn State", "138.75", "Mercer", "196.20"],
    ["Jax State", "238.80", "Elon", "197.05"],
    ["Austin Peay", "203.75", "Belmont", "260.70"],
    ["Carolina", "277.75", "Citadel", "243.15"],
  ],
  semis: [
    ["Mercer", "238.35", "Jax State", "176.10"],
    ["Belmont", "275.35", "Carolina", "275.15"],
  ],
  final: ["Mercer", "165.65", "Belmont", "250.30"],
  third: ["Jax State", "170.50", "Carolina", "207.90"],
  fifth: {
    leftQual: ["Tenn State", "237.30", "Elon", "216.95"],
    rightQual: ["Austin Peay", "202.45", "Citadel", "193.10"],
    final: ["Tenn State", "178.25", "Austin Peay", "195.75"],
  },
  seventh: ["Elon", "215.30", "Citadel", "258.60"],
});

const SOCO_2025_CONSOLATION = r3ConsoHalf({
  colors: SOCO_CLR, logo: "SoCon", logoSrc: SOCO_MARK,
  banners: SOCO_CONSO_BANNERS,
  wk15: [
    ["E Tenn", "133.20", "VMI", "197.90"],
    ["Martin", "286.75", "Samford", "185.10"],
    ["Chattanooga", "257.00", "Murray State", "141.20"],
    ["Nicholls", "180.30", "Tenn Tech", "148.75"],
  ],
  semis: [
    ["VMI", "252.80", "Martin", "219.60"],
    ["Chattanooga", "233.80", "Nicholls", "199.50"],
  ],
  final: ["VMI", "229.70", "Chattanooga", "168.20"],
  eleventh: ["Martin", "146.20", "Nicholls", "182.20"],
  thirteenth: {
    leftQual: ["E Tenn", "213.20", "Samford", "130.45"],
    rightQual: ["Murray State", "207.40", "Tenn Tech", "128.95"],
    final: ["E Tenn", "219.85", "Murray State", "153.55"],
  },
  fifteenth: ["Samford", "192.10", "Tenn Tech", "140.70"],
  footer: [336, 258, 324, "Relegation Bowl", "LAST PLACE COACH IS FIRED"],
});

// --- 2025 Sun Belt (SUN) ----------------------------------------------------
// R3 template, data only. East/West divisions ride as the banner sub-line,
// same treatment Lainey approved for SoCon. The gold banner needs DARK text,
// so it uses the optional 6th banner element (`fg`) exactly like XFL's light
// mint banner -- white on #F2BF46 is unreadable.
// NOTE: "Carolina" here is COASTAL Carolina (teal); in SOCO the same short
// name is WESTERN Carolina (purple). Colours are scoped per league, so both
// are correct -- do not "fix" one to match the other.
const SUN_BANNERS = [
  [112, 324, "Sun Belt Conference", "#F2BF46", "East", "#000"],
  [560, 324, "Championship", "#4193D3", "West"],
];
const SUN_CONSO_BANNERS = [
  [112, 324, "", "#F2BF46", "East", "#000"],
  [560, 324, "Consolation", "#4193D3", "West"],
];

const SUN_CLR = {
  "GA State": ["#0039A6", "#FFFFFF"], "JMU": ["#450084", "#CBB677"],
  "App State": ["#0A0A0A", "#FFCC00"], "Arlington": ["#F58025", "#0064B1"],
  "Little Rock": ["#7C2529", "#CBB677"], "S Miss": ["#0A0A0A", "#FFAB00"],
  "S Alabama": ["#FFFFFF", "#00205B"], "AK State": ["#CC092F", "#FFFFFF"],
  "GA Southern": ["#041E42", "#FFFFFF"], "Carolina": ["#006F71", "#B3A369"],
  "Old Dominion": ["#003057", "#FFFFFF"], "Marshall": ["#00B140", "#FFFFFF"],
  "Troy": ["#8A2432", "#FFFFFF"], "Texas State": ["#501214", "#AC9155"],
  "Louisiana": ["#CE181E", "#FFFFFF"], "ULM": ["#840029", "#FDBB30"],
};

// No proper championship-game name, and no week-18 bowls on the Sun Belt sheets.
const SUN_2025_PLAYOFFS = r3ChampHalf({
  colors: SUN_CLR, logo: "Sun Belt", logoSrc: SUN_MARK, trophy: SUN_TROPHY,
  banners: SUN_BANNERS,
  wk15: [
    ["GA State", "327.40", "JMU", "175.20"],
    ["App State", "191.75", "Arlington", "224.15"],
    ["Little Rock", "226.10", "S Miss", "161.25"],
    ["S Alabama", "220.70", "AK State", "241.45"],
  ],
  semis: [
    ["GA State", "279.70", "Arlington", "173.55"],
    ["Little Rock", "264.00", "AK State", "219.75"],
  ],
  final: ["GA State", "295.00", "Little Rock", "224.60"],
  third: ["Arlington", "182.10", "AK State", "181.60"],
  fifth: {
    leftQual: ["JMU", "218.00", "App State", "230.90"],
    rightQual: ["S Miss", "220.35", "S Alabama", "192.55"],
    final: ["App State", "222.00", "S Miss", "225.85"],
  },
  seventh: ["JMU", "167.15", "S Alabama", "210.85"],
});

const SUN_2025_CONSOLATION = r3ConsoHalf({
  colors: SUN_CLR, logo: "Sun Belt", logoSrc: SUN_MARK,
  banners: SUN_CONSO_BANNERS,
  wk15: [
    ["GA Southern", "213.70", "Carolina", "133.90"],
    ["Old Dominion", "167.00", "Marshall", "178.20"],
    ["Troy", "238.60", "Texas State", "184.75"],
    ["Louisiana", "133.70", "ULM", "183.95"],
  ],
  semis: [
    ["GA Southern", "174.75", "Marshall", "157.90"],
    ["Troy", "197.00", "ULM", "127.60"],
  ],
  final: ["GA Southern", "212.40", "Troy", "199.85"],
  eleventh: ["Marshall", "235.20", "ULM", "93.90"],
  thirteenth: {
    leftQual: ["Carolina", "89.70", "Old Dominion", "160.15"],
    rightQual: ["Texas State", "240.75", "Louisiana", "160.50"],
    final: ["Old Dominion", "174.30", "Texas State", "185.55"],
  },
  fifteenth: ["Carolina", "97.50", "Louisiana", "144.00"],
  footer: [336, 258, 324, "Relegation Bowl", "LAST PLACE COACH IS FIRED"],
});

// --- 2025 IVY ---------------------------------------------------------------
// A two-CONFERENCE tier rather than two divisions: the Ivy League and the
// Patriot Conference. They ride in the banner sub-lines exactly like SoCo's
// North/South and the Sun Belt's East/West, so the header keeps the house
// two-row shape instead of the sheet's third row.
const IVY_BANNERS = [
  [112, 324, "The Ivy League", "#22543F", "Ivy"],
  [560, 324, "Championship", "#1D356B", "Patriot"],
];
const IVY_CONSO_BANNERS = [
  [112, 324, "", "#22543F", "Ivy"],
  [560, 324, "Consolation", "#1D356B", "Patriot"],
];

// Fordham is a white bar with maroon text -- its real brand pairing, and it
// keeps Fordham distinguishable from Lafayette, whose maroon is nearly
// identical and which it plays head-to-head in the 13th-place sub-bracket.
const IVY_CLR = {
  "Brown": ["#4E3629", "#FFFFFF"], "Cornell": ["#B31B1B", "#FFFFFF"],
  "Dartmouth": ["#00693E", "#FFFFFF"], "Penn": ["#011F5B", "#FFFFFF"],
  "Princeton": ["#E77500", "#000000"], "Yale": ["#00356B", "#FFFFFF"],
  "Harvard": ["#A51C30", "#FFFFFF"], "Columbia": ["#9BCBEB", "#012169"],
  "Lehigh": ["#653819", "#FFFFFF"], "Georgetown": ["#041E42", "#FFFFFF"],
  "Colgate": ["#821019", "#FFFFFF"], "Bucknell": ["#E87722", "#000000"],
  "MIT": ["#A31F34", "#FFFFFF"], "Fordham": ["#FFFFFF", "#900028"],
  "Lafayette": ["#910029", "#FFFFFF"], "Holy Cross": ["#602D89", "#FFFFFF"],
};

// No championship-game name and no week-18 bowls on the Ivy sheets.
const IVY_2025_PLAYOFFS = r3ChampHalf({
  colors: IVY_CLR, logo: "IVY", logoSrc: IVY_MARK, trophy: IVY_TROPHY,
  banners: IVY_BANNERS,
  wk15: [
    ["Brown", "305.95", "Cornell", "256.20"],
    ["Dartmouth", "172.55", "Penn", "227.25"],
    ["Lehigh", "221.90", "Georgetown", "209.40"],
    ["Colgate", "222.85", "Bucknell", "220.40"],
  ],
  semis: [
    ["Brown", "241.25", "Penn", "231.10"],
    ["Lehigh", "200.90", "Colgate", "231.50"],
  ],
  final: ["Brown", "265.50", "Colgate", "236.40"],
  third: ["Penn", "164.35", "Lehigh", "222.10"],
  fifth: {
    leftQual: ["Cornell", "136.50", "Dartmouth", "184.80"],
    rightQual: ["Georgetown", "224.05", "Bucknell", "262.80"],
    final: ["Dartmouth", "153.75", "Bucknell", "225.45"],
  },
  seventh: ["Cornell", "133.20", "Georgetown", "231.70"],
});

const IVY_2025_CONSOLATION = r3ConsoHalf({
  colors: IVY_CLR, logo: "IVY", logoSrc: IVY_MARK,
  banners: IVY_CONSO_BANNERS,
  wk15: [
    ["Princeton", "174.85", "Yale", "228.55"],
    ["Holy Cross", "247.70", "Harvard", "243.35"],
    ["MIT", "194.95", "Fordham", "164.60"],
    ["Columbia", "177.30", "Lafayette", "163.15"],
  ],
  semis: [
    ["Yale", "238.15", "Holy Cross", "169.00"],
    ["MIT", "157.60", "Columbia", "224.25"],
  ],
  final: ["Yale", "163.25", "Columbia", "243.20"],
  eleventh: ["Holy Cross", "231.25", "MIT", "145.30"],
  thirteenth: {
    leftQual: ["Princeton", "189.80", "Harvard", "260.80"],
    // Confirmed by Lainey 2026-07-30: Fordham 169.00 def. Lafayette 168.45.
    rightQual: ["Fordham", "169.00", "Lafayette", "168.45"],
    final: ["Harvard", "216.30", "Fordham", "162.25"],
  },
  fifteenth: ["Princeton", "155.20", "Lafayette", "182.80"],
  footer: [336, 258, 324, "Relegation Bowl", "LAST PLACE COACH IS FIRED"],
});

// --- 2025 GLIAC --------------------------------------------------------------
// Divisions are the real ones: all eight Ohio Athletic schools on the left,
// all eight Great Lakes schools on the right. The gold Ohio Athletic banner
// needs the `fg` override -- white on #F9DA78 is unreadable, same problem as
// the Sun Belt gold and the XFL mint.
const GLIAC_BANNERS = [
  [112, 324, "GLIAC", "#F9DA78", "Ohio Athletic", "#1B3A5C"],
  [560, 324, "Championship", "#678DC2", "Great Lakes"],
];
const GLIAC_CONSO_BANNERS = [
  [112, 324, "", "#F9DA78", "Ohio Athletic", "#1B3A5C"],
  [560, 324, "Consolation", "#678DC2", "Great Lakes"],
];

// Colour notes for the pairs that would otherwise be ambiguous:
//   Capital / Mount Union   -- both purple AND they meet in week 15, so
//                              Capital is pushed much deeper than Mount Union
//   Wayne State / N Michigan -- both green and stacked adjacent in week 15,
//                              separated by gold vs old-gold text
//   Muskingum is black/magenta (its real colours), not the red on the sheet.
const GLIAC_CLR = {
  "Heidelberg": ["#F4691F", "#000000"], "JCU": ["#003865", "#FDB515"],
  "Muskingum": ["#000000", "#E0218A"], "Baldwin": ["#FDB913", "#4F2C1D"],
  "Wilmington": ["#006747", "#FFFFFF"], "Ohio N": ["#F47920", "#000000"],
  "Capital": ["#3D1152", "#FFFFFF"], "Mount Union": ["#6E2B8B", "#FFFFFF"],
  "Davenport": ["#C8102E", "#FFFFFF"], "Parkside": ["#00573F", "#FFFFFF"],
  "Wayne State": ["#0C5449", "#FFCB05"], "N Michigan": ["#285C4D", "#B4975A"],
  "Ferris State": ["#C8102E", "#FFC72C"], "Purdue NW": ["#000000", "#B1946C"],
  "Northwood": ["#7EA6D8", "#0A2240"], "Lake Superior": ["#FDB913", "#003F87"],
  // Added 2026-08-01: she confirmed Morgan State genuinely plays in GLIAC now.
  // SWAC keeps its own "Morgan St" key (2025 championship data is historical
  // and untouched) — colours are scoped per league, so both can coexist.
  // Real brand colours per Morgan State's own toolkit (morgan.edu/toolkit).
  "Morgan State": ["#1B4383", "#F47937"],
};

// No championship-game name and no week-18 bowls on the GLIAC sheets.
const GLIAC_2025_PLAYOFFS = r3ChampHalf({
  colors: GLIAC_CLR, logo: "GLIAC", logoSrc: GLIAC_MARK, trophy: GLIAC_TROPHY,
  banners: GLIAC_BANNERS,
  wk15: [
    ["Heidelberg", "171.20", "JCU", "300.95"],
    ["Muskingum", "202.55", "Baldwin", "229.50"],
    ["Davenport", "229.25", "Parkside", "285.90"],
    ["Wayne State", "206.50", "N Michigan", "175.40"],
  ],
  semis: [
    ["JCU", "216.80", "Baldwin", "150.45"],
    ["Parkside", "277.70", "Wayne State", "254.25"],
  ],
  final: ["JCU", "251.85", "Parkside", "248.35"],
  third: ["Baldwin", "166.50", "Wayne State", "273.90"],
  fifth: {
    leftQual: ["Heidelberg", "192.20", "Muskingum", "199.25"],
    rightQual: ["Davenport", "205.40", "N Michigan", "235.45"],
    final: ["Muskingum", "131.70", "N Michigan", "222.70"],
  },
  seventh: ["Heidelberg", "152.55", "Davenport", "251.50"],
});

const GLIAC_2025_CONSOLATION = r3ConsoHalf({
  colors: GLIAC_CLR, logo: "GLIAC", logoSrc: GLIAC_MARK,
  banners: GLIAC_CONSO_BANNERS,
  wk15: [
    ["Wilmington", "181.05", "Ohio N", "186.70"],
    ["Capital", "207.10", "Mount Union", "224.15"],
    ["Ferris State", "173.15", "Purdue NW", "242.15"],
    ["Northwood", "240.90", "Lake Superior", "160.35"],
  ],
  semis: [
    ["Ohio N", "133.60", "Mount Union", "168.65"],
    ["Purdue NW", "209.55", "Northwood", "222.50"],
  ],
  final: ["Mount Union", "207.00", "Northwood", "182.50"],
  eleventh: ["Ohio N", "171.10", "Purdue NW", "130.35"],
  thirteenth: {
    leftQual: ["Wilmington", "158.35", "Capital", "243.95"],
    rightQual: ["Ferris State", "254.80", "Lake Superior", "225.45"],
    final: ["Capital", "203.85", "Ferris State", "193.40"],
  },
  fifteenth: ["Wilmington", "172.30", "Lake Superior", "153.75"],
  footer: [336, 258, 324, "Relegation Bowl", "LAST PLACE COACH IS FIRED"],
});

// --- 2025 FLHS ---------------------------------------------------------------
// The only tier with NO divisions at all: her sheet's third header row is an
// empty orange band, so there are no sub-lines and the header sits at 46px
// rather than 58px. The spelled-out "Florida High School Athletic Association
// District 8A Region 4" is far too long for a 324px banner, so the left title
// is the short form and the mark carries the full name.
const FLHS_BANNERS = [
  [112, 324, "FHSAA District 8A Region 4", "#489A81"],
  [560, 324, "Championship", "#489A81"],
];
const FLHS_CONSO_BANNERS = [
  [112, 324, "", "#489A81"],
  [560, 324, "Consolation", "#489A81"],
];

// These are Florida high schools, so her sheet IS the authoritative palette --
// unlike the college tiers there is no better "real brand" source to prefer.
// Four teams carry WHITE bars and are told apart by text colour alone
// (Western khaki, Coral Springs green, Palmetto light blue, Taravella blue).
const FLHS_CLR = {
  "Western": ["#FFFFFF", "#C2B465"], "Miami Beach": ["#EA3323", "#FFFFFF"],
  "Dr Krop": ["#3A3891", "#A4ADAF"], "Boca Raton": ["#000000", "#F0D84F"],
  "Coral Springs": ["#FFFFFF", "#48752C"], "West Broward": ["#87ADD0", "#FFFFFF"],
  "Palmetto": ["#FFFFFF", "#7CA6D7"], "Miami Dade": ["#355FD2", "#FFFFFF"],
  "Taravella": ["#FFFFFF", "#2854C5"], "Miami Senior": ["#2E2A73", "#EECB45"],
  "Southwest": ["#D9D9D9", "#592478"], "Coral Glades": ["#3F8E8E", "#FFFFFF"],
  "Deerfield": ["#000000", "#F19E38"], "Stoneman": ["#691817", "#E19A3D"],
  "West Boca": ["#321D70", "#F9DA78"], "Cypress Bay": ["#25528F", "#B89230"],
};

// Real per-team logo art, 2026-08-04 — a NEW category, separate from the
// 32-asset league-mark pipeline and from FLHS_CLR just above. FLHS_CLR is
// keyed by the SHORT names used in the 2025 historical bracket sheets
// ("Southwest", "Dr Krop"); TEAM_ART is keyed by each team's CURRENT full
// name as it appears in live data ("Coral Gables Cavaliers", "Dr. Krop
// Lightning") — two different namespaces for two different eras, on
// purpose. Looked up through normTeamKey (lowercase, alphanumeric only) so
// small punctuation drift between this list and a live Sleeper display
// name — a period, a hyphen, a stray space — doesn't silently miss.
// Structured per-tier (TEAM_ART[tierKey][normalizedTeam]) so any other
// tier can grow its own set later without touching this one; only FLHS
// exists so far. All 16 FLHS teams are populated even though only the
// open ones render anywhere today (Directory's open-team cards, via
// TeamMark) — banking the rest now means a future coach-card or team-
// modal image slot is a display change only, no new art pass required.
// Southwest Eagles was renamed Coral Gables Cavaliers 2026-08-04 (team
// name/logo only, roster otherwise unchanged) — only the CURRENT name
// appears here; the old name stays in FLHS_CLR/HISTORICAL_FINAL_ORDER
// untouched, since those describe the 2025 season under its old name.
//
// Folder-per-league layout, requested 2026-08-04 so up to 232 team files
// across 13 leagues don't pile up flat in public/art/ next to the 32
// single-per-tier league marks. Each league gets its own folder named
// EXACTLY "<tier key> team logos" — she uploads that literal folder
// ("FLHS team logos", eventually "BIG XII team logos", etc.). teamArtPath
// builds the path from the tier key so every entry stays in sync with
// that convention automatically, and %-encodes the spaces since a literal
// space in a src path is technically invalid even though most browsers
// tolerate it unencoded. The PNG filenames themselves are unchanged from
// what already went out flat — only the folder they sit in is new, so
// nothing needs re-naming, just moving into the new folder.
const teamArtPath = (tierKey, filename) =>
  `/art/${tierKey} team logos/${filename}`.replace(/ /g, "%20");
const normTeamKey = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const TEAM_ART = {
  FLHS: {
    [normTeamKey("Western Wildcats")]: teamArtPath("FLHS", "flhs-team-western-wildcats.png"),
    [normTeamKey("Coral Springs Colts")]: teamArtPath("FLHS", "flhs-team-coral-springs-colts.png"),
    [normTeamKey("Boca Raton Wolverines")]: teamArtPath("FLHS", "flhs-team-boca-raton-wolverines.png"),
    [normTeamKey("Palmetto Panthers")]: teamArtPath("FLHS", "flhs-team-palmetto-panthers.png"),
    [normTeamKey("West Broward Bobcats")]: teamArtPath("FLHS", "flhs-team-west-broward-bobcats.png"),
    [normTeamKey("Miami Dade Buccaneers")]: teamArtPath("FLHS", "flhs-team-miami-dade-buccaneers.png"),
    [normTeamKey("Miami Beach Hi Tides")]: teamArtPath("FLHS", "flhs-team-miami-beach-hi-tides.png"),
    [normTeamKey("Taravella Trojans")]: teamArtPath("FLHS", "flhs-team-taravella-trojans.png"),
    [normTeamKey("West Boca Raton Bulls")]: teamArtPath("FLHS", "flhs-team-west-boca-bulls.png"),
    [normTeamKey("Dr. Krop Lightning")]: teamArtPath("FLHS", "flhs-team-dr-krop-lightning.png"),
    [normTeamKey("Coral Gables Cavaliers")]: teamArtPath("FLHS", "flhs-team-coral-gables-cavaliers.png"),
    [normTeamKey("Deerfield Beach Bucks")]: teamArtPath("FLHS", "flhs-team-deerfield-beach-bucks.png"),
    [normTeamKey("Coral Glades Jaguars")]: teamArtPath("FLHS", "flhs-team-coral-glades-jaguars.png"),
    [normTeamKey("Cypress Bay Lightning")]: teamArtPath("FLHS", "flhs-team-cypress-bay-lightning.png"),
    [normTeamKey("Stoneman Douglas Eagles")]: teamArtPath("FLHS", "flhs-team-stoneman-douglas-eagles.png"),
    [normTeamKey("Miami Senior Stingrays")]: teamArtPath("FLHS", "flhs-team-miami-senior-stingrays.png"),
  },
  GLIAC: {
    [normTeamKey("Baldwin Yellow Jackets")]: teamArtPath("GLIAC", "gliac-team-baldwin-yellow-jackets.png"),
    [normTeamKey("Purdue NW Pride")]: teamArtPath("GLIAC", "gliac-team-purdue-nw-pride.png"),
    [normTeamKey("N Michigan Wildcats")]: teamArtPath("GLIAC", "gliac-team-n-michigan-wildcats.png"),
    [normTeamKey("Mount Union Raiders")]: teamArtPath("GLIAC", "gliac-team-mount-union-raiders.png"),
    [normTeamKey("Wilmington Quakers")]: teamArtPath("GLIAC", "gliac-team-wilmington-quakers.png"),
    [normTeamKey("Davenport Panthers")]: teamArtPath("GLIAC", "gliac-team-davenport-panthers.png"),
    [normTeamKey("Wayne State Warriors")]: teamArtPath("GLIAC", "gliac-team-wayne-state-warriors.png"),
    [normTeamKey("WI Parkside Rangers")]: teamArtPath("GLIAC", "gliac-team-wi-parkside-rangers.png"),
    [normTeamKey("Lake Superior Lakers")]: teamArtPath("GLIAC", "gliac-team-lake-superior-lakers.png"),
    [normTeamKey("Capital Comets")]: teamArtPath("GLIAC", "gliac-team-capital-comets.png"),
    [normTeamKey("Northwood Timberwolves")]: teamArtPath("GLIAC", "gliac-team-northwood-timberwolves.png"),
    [normTeamKey("Heidelberg StudentPrinces")]: teamArtPath("GLIAC", "gliac-team-heidelberg-studentprinces.png"),
    [normTeamKey("Ohio Northern Polar Bears")]: teamArtPath("GLIAC", "gliac-team-ohio-northern-polar-bears.png"),
    [normTeamKey("Ferris State Bulldogs")]: teamArtPath("GLIAC", "gliac-team-ferris-state-bulldogs.png"),
    [normTeamKey("Muskingum Fighting Muskies")]: teamArtPath("GLIAC", "gliac-team-muskingum-fighting-muskies.png"),
    [normTeamKey("JCU Blue Streaks")]: teamArtPath("GLIAC", "gliac-team-jcu-blue-streaks.png"),
  },
  SWAC: {
    [normTeamKey("Norfolk State Spartans")]: teamArtPath("SWAC", "swac-team-norfolk-state-spartans.png"),
    [normTeamKey("Texas Southern Tigers")]: teamArtPath("SWAC", "swac-team-texas-southern-tigers.png"),
    [normTeamKey("Jackson State Tigers")]: teamArtPath("SWAC", "swac-team-jackson-state-tigers.png"),
    [normTeamKey("Morgan State Bears")]: teamArtPath("SWAC", "swac-team-morgan-state-bears.png"),
    [normTeamKey("South Carolina State Bulldogs")]: teamArtPath("SWAC", "swac-team-south-carolina-state-bulldogs.png"),
    [normTeamKey("Grambling State Tigers")]: teamArtPath("SWAC", "swac-team-grambling-state-tigers.png"),
    [normTeamKey("Alabama State Hornets")]: teamArtPath("SWAC", "swac-team-alabama-state-hornets.png"),
    [normTeamKey("Bethune-Cookman Wildcats")]: teamArtPath("SWAC", "swac-team-bethune-cookman-wildcats.png"),
    [normTeamKey("Pine Bluff Golden Lions")]: teamArtPath("SWAC", "swac-team-arkansas-pine-bluff-golden-lions.png"),
    [normTeamKey("Alabama A&M Bulldogs")]: teamArtPath("SWAC", "swac-team-alabama-am-bulldogs.png"),
    [normTeamKey("Mississippi Valley Delta Devils")]: teamArtPath("SWAC", "swac-team-mississippi-valley-state-delta-devils.png"),
    [normTeamKey("NC Central Eagles")]: teamArtPath("SWAC", "swac-team-nc-central-eagles.png"),
    [normTeamKey("Florida A&M Rattlers")]: teamArtPath("SWAC", "swac-team-florida-am-rattlers.png"),
    [normTeamKey("Southern U Jaguars")]: teamArtPath("SWAC", "swac-team-southern-u-jaguars.png"),
    [normTeamKey("PVAMU Panthers")]: teamArtPath("SWAC", "swac-team-prairie-view-am-panthers.png"),
    [normTeamKey("Alcorn State Braves")]: teamArtPath("SWAC", "swac-team-alcorn-state-braves.png"),
  },
  IVY: {
    [normTeamKey("Georgetown Hoyas")]: teamArtPath("IVY", "ivy-team-georgetown-hoyas.png"),
    [normTeamKey("Brown Bears")]: teamArtPath("IVY", "ivy-team-brown-bears.png"),
    [normTeamKey("Harvard Crimson")]: teamArtPath("IVY", "ivy-team-harvard-crimson.png"),
    [normTeamKey("Lafayette Leopards")]: teamArtPath("IVY", "ivy-team-lafayette-leopards.png"),
    [normTeamKey("Yale Bulldogs")]: teamArtPath("IVY", "ivy-team-yale-bulldogs.png"),
    [normTeamKey("Colgate Raiders")]: teamArtPath("IVY", "ivy-team-colgate-raiders.png"),
    [normTeamKey("Lehigh Mountain Hawks")]: teamArtPath("IVY", "ivy-team-lehigh-mountain-hawks.png"),
    [normTeamKey("Bucknell Bison")]: teamArtPath("IVY", "ivy-team-bucknell-bison.png"),
    [normTeamKey("Penn Quakers")]: teamArtPath("IVY", "ivy-team-penn-quakers.png"),
    [normTeamKey("Columbia Lions")]: teamArtPath("IVY", "ivy-team-columbia-lions.png"),
    [normTeamKey("Cornell Big Red")]: teamArtPath("IVY", "ivy-team-cornell-big-red.png"),
    [normTeamKey("Fordham Rams")]: teamArtPath("IVY", "ivy-team-fordham-rams.png"),
    [normTeamKey("Princeton Tigers")]: teamArtPath("IVY", "ivy-team-princeton-tigers.png"),
    [normTeamKey("MIT Engineers")]: teamArtPath("IVY", "ivy-team-mit-engineers.png"),
    [normTeamKey("Dartmouth Big Green")]: teamArtPath("IVY", "ivy-team-dartmouth-big-green.png"),
    [normTeamKey("Holy Cross Crusaders")]: teamArtPath("IVY", "ivy-team-holy-cross-crusaders.png"),
  },
  SOCO: {
    [normTeamKey("Belmont Bruins")]: teamArtPath("SOCO", "soco-team-belmont-bruins.png"),
    [normTeamKey("Mercer Bears")]: teamArtPath("SOCO", "soco-team-mercer-bears.png"),
    [normTeamKey("West Carolina Catamounts")]: teamArtPath("SOCO", "soco-team-western-carolina-catamounts.png"),
    [normTeamKey("Jacksonville State Gamecocks")]: teamArtPath("SOCO", "soco-team-jacksonville-state-gamecocks.png"),
    [normTeamKey("Austin Peay Governors")]: teamArtPath("SOCO", "soco-team-austin-peay-governors.png"),
    [normTeamKey("Tennessee State Tigers")]: teamArtPath("SOCO", "soco-team-tennessee-state-tigers.png"),
    [normTeamKey("The Citadel Bulldogs")]: teamArtPath("SOCO", "soco-team-citadel-bulldogs.png"),
    [normTeamKey("Elon Phoenix")]: teamArtPath("SOCO", "soco-team-elon-phoenix.png"),
    [normTeamKey("VMI Keydets")]: teamArtPath("SOCO", "soco-team-vmi-keydets.png"),
    [normTeamKey("Chattanooga Mocs")]: teamArtPath("SOCO", "soco-team-chattanooga-mocs.png"),
    [normTeamKey("Nicholls State Colonels")]: teamArtPath("SOCO", "soco-team-nicholls-state-colonels.png"),
    [normTeamKey("Tennessee Martin Skyhawks")]: teamArtPath("SOCO", "soco-team-tennessee-martin-skyhawks.png"),
    [normTeamKey("East Tennessee State Buccaneers")]: teamArtPath("SOCO", "soco-team-east-tennessee-buccaneers.png"),
    [normTeamKey("Murray State Racers")]: teamArtPath("SOCO", "soco-team-murray-state-racers.png"),
    [normTeamKey("Samford Bulldogs")]: teamArtPath("SOCO", "soco-team-samford-bulldogs.png"),
    [normTeamKey("Tennessee Tech Golden Eagles")]: teamArtPath("SOCO", "soco-team-tennessee-tech-golden-eagles.png"),
  },
  SUN: {
    [normTeamKey("Georgia State Panthers")]: teamArtPath("SUN", "sun-team-georgia-state-panthers.png"),
    [normTeamKey("Little Rock Trojans")]: teamArtPath("SUN", "sun-team-little-rock-trojans.png"),
    [normTeamKey("Arlington Mavericks")]: teamArtPath("SUN", "sun-team-arlington-mavericks.png"),
    [normTeamKey("Arkansas State Red Wolves")]: teamArtPath("SUN", "sun-team-arkansas-state-red-wolves.png"),
    [normTeamKey("Southern Miss Golden Eagles")]: teamArtPath("SUN", "sun-team-southern-miss-golden-eagles.png"),
    [normTeamKey("South Alabama Jaguars")]: teamArtPath("SUN", "sun-team-south-alabama-jaguars.png"),
    [normTeamKey("James Madison Dukes")]: teamArtPath("SUN", "sun-team-james-madison-dukes.png"),
    [normTeamKey("Georgia Southern Eagles")]: teamArtPath("SUN", "sun-team-georgia-southern-eagles.png"),
    [normTeamKey("Troy Trojans")]: teamArtPath("SUN", "sun-team-troy-trojans.png"),
    [normTeamKey("Marshall Thundering Herd")]: teamArtPath("SUN", "sun-team-marshall-thundering-herd.png"),
    [normTeamKey("ULM Warhawks")]: teamArtPath("SUN", "sun-team-louisiana-monroe-warhawks.png"),
    [normTeamKey("Texas State Bobcats")]: teamArtPath("SUN", "sun-team-texas-state-bobcats.png"),
    [normTeamKey("Old Dominion Monarchs")]: teamArtPath("SUN", "sun-team-old-dominion-monarchs.png"),
    [normTeamKey("Louisiana Ragin Cajuns")]: teamArtPath("SUN", "sun-team-louisiana-ragin-cajuns.png"),
    [normTeamKey("Carolina Chanticleers")]: teamArtPath("SUN", "sun-team-carolina-chanticleers.png"),
    [normTeamKey("App State Mountaineers")]: teamArtPath("SUN", "sun-team-app-state-mountaineers.png"),
  },
  TEN: {
    [normTeamKey("Northwestern Wildcats")]: teamArtPath("TEN", "ten-team-northwestern-wildcats.png"),
    [normTeamKey("UCLA Bruins")]: teamArtPath("TEN", "ten-team-ucla-bruins.png"),
    [normTeamKey("Washington Huskies")]: teamArtPath("TEN", "ten-team-washington-huskies.png"),
    [normTeamKey("Ohio State Buckeyes")]: teamArtPath("TEN", "ten-team-ohio-state-buckeyes.png"),
    [normTeamKey("California Golden Bears")]: teamArtPath("TEN", "ten-team-california-golden-bears.png"),
    [normTeamKey("Indiana Hoosiers")]: teamArtPath("TEN", "ten-team-indiana-hoosiers.png"),
    [normTeamKey("Penn State Nittany Lions")]: teamArtPath("TEN", "ten-team-penn-state-nittany-lions.png"),
    [normTeamKey("Oregon Ducks")]: teamArtPath("TEN", "ten-team-oregon-ducks.png"),
    [normTeamKey("Purdue Boilermakers")]: teamArtPath("TEN", "ten-team-purdue-boilermakers.png"),
    [normTeamKey("Michigan Wolverines")]: teamArtPath("TEN", "ten-team-michigan-wolverines.png"),
    [normTeamKey("Wisconsin Badgers")]: teamArtPath("TEN", "ten-team-wisconsin-badgers.png"),
    [normTeamKey("Illinois Illini")]: teamArtPath("TEN", "ten-team-illinois-illini.png"),
    [normTeamKey("Maryland Terrapins")]: teamArtPath("TEN", "ten-team-maryland-terrapins.png"),
    [normTeamKey("USC Trojans")]: teamArtPath("TEN", "ten-team-usc-trojans.png"),
    [normTeamKey("Rutgers Scarlet Knights")]: teamArtPath("TEN", "ten-team-rutgers-scarlet-knights.png"),
    [normTeamKey("Utah Utes")]: teamArtPath("TEN", "ten-team-utah-utes.png"),
  },
  ACC: {
    [normTeamKey("Virginia Tech Hokies")]: teamArtPath("ACC", "acc-team-virginia-tech-hokies.png"),
    [normTeamKey("Duke Blue Devils")]: teamArtPath("ACC", "acc-team-duke-blue-devils.png"),
    [normTeamKey("Louisville Cardinals")]: teamArtPath("ACC", "acc-team-louisville-cardinals.png"),
    [normTeamKey("Syracuse Orange")]: teamArtPath("ACC", "acc-team-syracuse-orange.png"),
    [normTeamKey("North Carolina Tarheels")]: teamArtPath("ACC", "acc-team-north-carolina-tarheels.png"),
    [normTeamKey("Notre Dame Fighting Irish")]: teamArtPath("ACC", "acc-team-notre-dame-fighting-irish.png"),
    [normTeamKey("Clemson Tigers")]: teamArtPath("ACC", "acc-team-clemson-tigers.png"),
    [normTeamKey("Virginia Cavaliers")]: teamArtPath("ACC", "acc-team-virginia-cavaliers.png"),
    [normTeamKey("SMU Mustangs")]: teamArtPath("ACC", "acc-team-smu-mustangs.png"),
    [normTeamKey("Georgia Tech Yellowjackets")]: teamArtPath("ACC", "acc-team-georgia-tech-yellowjackets.png"),
    [normTeamKey("Wake Forest Demon Deacons")]: teamArtPath("ACC", "acc-team-wake-forest-demon-deacons.png"),
    [normTeamKey("Pittsburgh Panthers")]: teamArtPath("ACC", "acc-team-pittsburgh-panthers.png"),
    [normTeamKey("Florida State Seminoles")]: teamArtPath("ACC", "acc-team-florida-state-seminoles.png"),
    [normTeamKey("Miami Hurricanes")]: teamArtPath("ACC", "acc-team-miami-hurricanes.png"),
    [normTeamKey("NC State Wolfpack")]: teamArtPath("ACC", "acc-team-nc-state-wolfpack.png"),
    [normTeamKey("Boston College Eagles")]: teamArtPath("ACC", "acc-team-boston-college-eagles.png"),
  },
  "BIG XII": {
    [normTeamKey("Oklahoma State Cowboys")]: teamArtPath("BIG XII", "xii-team-oklahoma-state-cowboys.png"),
    [normTeamKey("South Dakota State Jackrabbits")]: teamArtPath("BIG XII", "xii-team-south-dakota-state-jackrabbits.png"),
    [normTeamKey("Cincinnati Bearcats")]: teamArtPath("BIG XII", "xii-team-cincinnati-bearcats.png"),
    [normTeamKey("Houston Cougars")]: teamArtPath("BIG XII", "xii-team-houston-cougars.png"),
    [normTeamKey("BYU Cougars")]: teamArtPath("BIG XII", "xii-team-byu-cougars.png"),
    [normTeamKey("Iowa State Cyclones")]: teamArtPath("BIG XII", "xii-team-iowa-state-cyclones.png"),
    [normTeamKey("Denver Pioneers")]: teamArtPath("BIG XII", "xii-team-denver-pioneers.png"),
    [normTeamKey("Baylor Bears")]: teamArtPath("BIG XII", "xii-team-baylor-bears.png"),
    [normTeamKey("TCU Horned Frogs")]: teamArtPath("BIG XII", "xii-team-tcu-horned-frogs.png"),
    [normTeamKey("Kansas Jayhawks")]: teamArtPath("BIG XII", "xii-team-kansas-jayhawks.png"),
    [normTeamKey("Northern Colorado Bears")]: teamArtPath("BIG XII", "xii-team-northern-colorado-bears.png"),
    [normTeamKey("West Virginia Mountaineers")]: teamArtPath("BIG XII", "xii-team-west-virginia-mountaineers.png"),
    [normTeamKey("UCF Knights")]: teamArtPath("BIG XII", "xii-team-ucf-knights.png"),
    [normTeamKey("Kansas State Wildcats")]: teamArtPath("BIG XII", "xii-team-kansas-state-wildcats.png"),
    [normTeamKey("Texas Tech Red Raiders")]: teamArtPath("BIG XII", "xii-team-texas-tech-red-raiders.png"),
    [normTeamKey("Northern Iowa Panthers")]: teamArtPath("BIG XII", "xii-team-northern-iowa-panthers.png"),
    // "Arizona" was a data artifact in her spreadsheet, corrected
    // 2026-08-07 — this slot's real team is Northern Iowa Panthers (see
    // XII_CLR/aliases above). Logo resent and added 2026-08-07, closing
    // out BIG XII's TEAM_ART at a genuine 16/16. Oklahoma Sooners is
    // still correctly unused (a different real-world school than this
    // tier's "OSU" = Oklahoma State).
  },
  // SEC (10th tier, 2026-08-07). All 16 arrived as clean transparent
  // PNGs, no cutout needed. Names cross-checked against CAREER_STATS
  // before finalizing keys (not filename-derived) — same lesson as every
  // prior tier, a wrong key fails silently. She also sent an "OSU"
  // wordmark (Oklahoma State's branding) that isn't one of this tier's 16
  // real teams — this tier's real Oklahoma team is "Oklahoma Sooners"
  // (OK_201_copy_2.png, the crimson interlocking OU mark), not Oklahoma
  // State — not used, same pattern as the BIG XII batch's unused extras
  // above.
  SEC: {
    [normTeamKey("Alabama Crimson Tide")]: teamArtPath("SEC", "sec-team-alabama-crimson-tide.png"),
    [normTeamKey("Arkansas Razorbacks")]: teamArtPath("SEC", "sec-team-arkansas-razorbacks.png"),
    [normTeamKey("Auburn Tigers")]: teamArtPath("SEC", "sec-team-auburn-tigers.png"),
    [normTeamKey("Florida Gators")]: teamArtPath("SEC", "sec-team-florida-gators.png"),
    [normTeamKey("Georgia Bulldogs")]: teamArtPath("SEC", "sec-team-georgia-bulldogs.png"),
    [normTeamKey("Kentucky Wildcats")]: teamArtPath("SEC", "sec-team-kentucky-wildcats.png"),
    [normTeamKey("LSU Tigers")]: teamArtPath("SEC", "sec-team-lsu-tigers.png"),
    [normTeamKey("Miss State Bulldogs")]: teamArtPath("SEC", "sec-team-miss-state-bulldogs.png"),
    [normTeamKey("Missouri Tigers")]: teamArtPath("SEC", "sec-team-missouri-tigers.png"),
    [normTeamKey("Oklahoma Sooners")]: teamArtPath("SEC", "sec-team-oklahoma-sooners.png"),
    [normTeamKey("Ole Miss Rebels")]: teamArtPath("SEC", "sec-team-ole-miss-rebels.png"),
    [normTeamKey("South Carolina Gamecocks")]: teamArtPath("SEC", "sec-team-south-carolina-gamecocks.png"),
    [normTeamKey("Tennessee Volunteers")]: teamArtPath("SEC", "sec-team-tennessee-volunteers.png"),
    [normTeamKey("Texas A&M Aggies")]: teamArtPath("SEC", "sec-team-texas-am-aggies.png"),
    [normTeamKey("Texas Longhorns")]: teamArtPath("SEC", "sec-team-texas-longhorns.png"),
    [normTeamKey("Vanderbilt Commodores")]: teamArtPath("SEC", "sec-team-vanderbilt-commodores.png"),
  },
  // XFL (2026-08-07, first batch — 18 of this tier's 20 teams). 15 of 18
  // sources arrived as clean transparent PNGs needing only a crop; Boston
  // Brawlers, Omaha Mammoths, and Brooklyn Bolts arrived on solid white
  // backgrounds and needed a standard border-flood cutout; Chicago
  // Enforcers had a partial-alpha white halo baked into its source export,
  // cleared with a de-halo pass. Birmingham Thunderbolts and San Francisco
  // Demons landed clean the same day, completing the tier at 20/20. 18 of
  // 20 names cross-checked directly against CAREER_STATS/CLUB_300 live
  // data; Las Vegas Outlaws and Houston Roughnecks had no live data to
  // check against but she confirmed 2026-08-07 both are real teams in the
  // league — all 20 XFL names now confirmed.
  XFL: {
    [normTeamKey("Tampa Bay Vipers")]: teamArtPath("XFL", "xfl-team-tampa-bay-vipers.png"),
    [normTeamKey("Memphis Maniax")]: teamArtPath("XFL", "xfl-team-memphis-maniax.png"),
    [normTeamKey("DC Defenders")]: teamArtPath("XFL", "xfl-team-dc-defenders.png"),
    [normTeamKey("Dallas Renegades")]: teamArtPath("XFL", "xfl-team-dallas-renegades.png"),
    [normTeamKey("St Louis Battlehawks")]: teamArtPath("XFL", "xfl-team-st-louis-battlehawks.png"),
    [normTeamKey("Los Angeles Wildcats")]: teamArtPath("XFL", "xfl-team-los-angeles-wildcats.png"),
    [normTeamKey("Las Vegas Outlaws")]: teamArtPath("XFL", "xfl-team-las-vegas-outlaws.png"),
    [normTeamKey("Omaha Mammoths")]: teamArtPath("XFL", "xfl-team-omaha-mammoths.png"),
    [normTeamKey("Chicago Enforcers")]: teamArtPath("XFL", "xfl-team-chicago-enforcers.png"),
    [normTeamKey("Orlando Rage")]: teamArtPath("XFL", "xfl-team-orlando-rage.png"),
    [normTeamKey("Los Angeles Xtreme")]: teamArtPath("XFL", "xfl-team-los-angeles-xtreme.png"),
    [normTeamKey("New York Guardians")]: teamArtPath("XFL", "xfl-team-new-york-guardians.png"),
    [normTeamKey("Boston Brawlers")]: teamArtPath("XFL", "xfl-team-boston-brawlers.png"),
    [normTeamKey("Atlanta Legends")]: teamArtPath("XFL", "xfl-team-atlanta-legends.png"),
    [normTeamKey("Seattle Dragons")]: teamArtPath("XFL", "xfl-team-seattle-dragons.png"),
    [normTeamKey("Brooklyn Bolts")]: teamArtPath("XFL", "xfl-team-brooklyn-bolts.png"),
    [normTeamKey("New Jersey Hitmen")]: teamArtPath("XFL", "xfl-team-new-jersey-hitmen.png"),
    [normTeamKey("Houston Roughnecks")]: teamArtPath("XFL", "xfl-team-houston-roughnecks.png"),
    [normTeamKey("Birmingham Thunderbolts")]: teamArtPath("XFL", "xfl-team-birmingham-thunderbolts.png"),
    [normTeamKey("San Francisco Demons")]: teamArtPath("XFL", "xfl-team-san-francisco-demons.png"),
  },
  // USFL (2026-08-07, complete in one batch — 20/20). All 20 names
  // confirmed directly against CAREER_STATS, zero unconfirmed — first
  // tier this session with no naming flags at all. "Detroit Drive" is a
  // genuine live team name (folta21, confirmed in CAREER_STATS/CLUB_300)
  // — no real historical USFL team was ever based in Detroit, so this
  // slot reuses an Arena Football League mark, same "borrow a real mark
  // from elsewhere" pattern as SEC/BIG XII's cross-conference fills.
  // 10 of 20 sources were already clean transparent PNGs; the other 10
  // (jpgs, mostly) needed the standard border-flood cutout — all came
  // out clean, including two badge-style marks (Denver Gold, Michigan
  // Panthers) where the flood-fill correctly stopped at a closed ring/
  // oval and left the enclosed background-color "plate" intact as part
  // of the design, same as XFL's Boston Brawlers. Two files ran over the
  // usual ~30KB flat-logo weight — Birmingham Stallions (31KB) and New
  // Jersey Generals (50KB) — both are genuinely gradient-rich (8000+
  // unique colors each) and fail the quantization gate's max-drift check
  // at every tested color depth (256 colors still drifts up to 143-183 on
  // a few pixels), so both are stored at full color depth un-quantized,
  // same exception already made for PFA_MARK/USFL_MARK/SUN_TROPHY.
  USFL: {
    [normTeamKey("Los Angeles Express")]: teamArtPath("USFL", "usfl-team-los-angeles-express.png"),
    [normTeamKey("Birmingham Stallions")]: teamArtPath("USFL", "usfl-team-birmingham-stallions.png"),
    [normTeamKey("Michigan Panthers")]: teamArtPath("USFL", "usfl-team-michigan-panthers.png"),
    [normTeamKey("Memphis Showboats")]: teamArtPath("USFL", "usfl-team-memphis-showboats.png"),
    [normTeamKey("Boston Breakers")]: teamArtPath("USFL", "usfl-team-boston-breakers.png"),
    [normTeamKey("Detroit Drive")]: teamArtPath("USFL", "usfl-team-detroit-drive.png"),
    [normTeamKey("Houston Gamblers")]: teamArtPath("USFL", "usfl-team-houston-gamblers.png"),
    [normTeamKey("Chicago Blitz")]: teamArtPath("USFL", "usfl-team-chicago-blitz.png"),
    [normTeamKey("Jacksonville Bulls")]: teamArtPath("USFL", "usfl-team-jacksonville-bulls.png"),
    [normTeamKey("Denver Gold")]: teamArtPath("USFL", "usfl-team-denver-gold.png"),
    [normTeamKey("Arizona Wranglers")]: teamArtPath("USFL", "usfl-team-arizona-wranglers.png"),
    [normTeamKey("Pittsburgh Maulers")]: teamArtPath("USFL", "usfl-team-pittsburgh-maulers.png"),
    [normTeamKey("San Antonio Gunslingers")]: teamArtPath("USFL", "usfl-team-san-antonio-gunslingers.png"),
    [normTeamKey("Oklahoma Outlaws")]: teamArtPath("USFL", "usfl-team-oklahoma-outlaws.png"),
    [normTeamKey("Orlando Renegades")]: teamArtPath("USFL", "usfl-team-orlando-renegades.png"),
    [normTeamKey("Tampa Bay Bandits")]: teamArtPath("USFL", "usfl-team-tampa-bay-bandits.png"),
    [normTeamKey("Washington Federals")]: teamArtPath("USFL", "usfl-team-washington-federals.png"),
    [normTeamKey("Philadelphia Stars")]: teamArtPath("USFL", "usfl-team-philadelphia-stars.png"),
    [normTeamKey("New Jersey Generals")]: teamArtPath("USFL", "usfl-team-new-jersey-generals.png"),
    [normTeamKey("Oakland Invaders")]: teamArtPath("USFL", "usfl-team-oakland-invaders.png"),
  },
  // NFL (13th and final tier) — COMPLETE 32/32, shipped across three
  // batches, all 2026-08-07. All 32 confirmed directly against
  // CAREER_STATS full names, zero unconfirmed; all 32 sources arrived
  // as clean transparent PNGs EXCEPT Washington Commanders (a JPEG on
  // white, needed a standard border-flood cutout + de-halo pass — its
  // source has the logo's yellow spike tips touching the image's top
  // edge, so the border-ring background estimate mixed in a few logo
  // pixels; median-of-ring was still robust enough to land on true
  // white and the cutout came out clean). Cleveland's real name is
  // "Cleveland Browns" — the CAREER_STATS entry has a stray "20" suffix
  // ("Cleveland Browns 20", already a documented pre-existing alias in
  // R3_LIVE for the bracket colour matcher) which is NOT part of the
  // real team name, so the TEAM_ART key correctly omits it. "Oakland
  // Raiders" is CAREER_STATS' real live team name (old city, current
  // Sleeper roster) — same team the bracket colour matcher already
  // aliases "Oakland Raiders"->"Las Vegas" for; the TEAM_ART key follows
  // the live full name, not the current city. Baltimore Ravens, Atlanta
  // Falcons, Tampa Bay Buccaneers, and Washington Commanders are all
  // gradient-rich/detailed and failed the quantization gate even at 256
  // colors — stored at full RGBA depth, same exception class as
  // PFA_MARK/USFL_MARK/Birmingham Stallions/New Jersey Generals.
  // **THIS COMPLETES TEAM_ART FOR ALL 13 TIERS — 232/232 real per-team
  // slots the project ever needed are now filled (every tier's real
  // roster size, not the 13x20 theoretical max).**
  NFL: {
    [normTeamKey("Green Bay Packers")]: teamArtPath("NFL", "nfl-team-green-bay-packers.png"),
    [normTeamKey("Cleveland Browns")]: teamArtPath("NFL", "nfl-team-cleveland-browns.png"),
    [normTeamKey("Baltimore Ravens")]: teamArtPath("NFL", "nfl-team-baltimore-ravens.png"),
    [normTeamKey("Detroit Lions")]: teamArtPath("NFL", "nfl-team-detroit-lions.png"),
    [normTeamKey("Dallas Cowboys")]: teamArtPath("NFL", "nfl-team-dallas-cowboys.png"),
    [normTeamKey("Arizona Cardinals")]: teamArtPath("NFL", "nfl-team-arizona-cardinals.png"),
    [normTeamKey("Denver Broncos")]: teamArtPath("NFL", "nfl-team-denver-broncos.png"),
    [normTeamKey("Indianapolis Colts")]: teamArtPath("NFL", "nfl-team-indianapolis-colts.png"),
    [normTeamKey("Houston Texans")]: teamArtPath("NFL", "nfl-team-houston-texans.png"),
    [normTeamKey("Cincinnati Bengals")]: teamArtPath("NFL", "nfl-team-cincinnati-bengals.png"),
    [normTeamKey("Atlanta Falcons")]: teamArtPath("NFL", "nfl-team-atlanta-falcons.png"),
    [normTeamKey("Carolina Panthers")]: teamArtPath("NFL", "nfl-team-carolina-panthers.png"),
    [normTeamKey("Jacksonville Jaguars")]: teamArtPath("NFL", "nfl-team-jacksonville-jaguars.png"),
    [normTeamKey("Buffalo Bills")]: teamArtPath("NFL", "nfl-team-buffalo-bills.png"),
    [normTeamKey("Chicago Bears")]: teamArtPath("NFL", "nfl-team-chicago-bears.png"),
    [normTeamKey("Oakland Raiders")]: teamArtPath("NFL", "nfl-team-oakland-raiders.png"),
    [normTeamKey("New Orleans Saints")]: teamArtPath("NFL", "nfl-team-new-orleans-saints.png"),
    [normTeamKey("New York Giants")]: teamArtPath("NFL", "nfl-team-new-york-giants.png"),
    [normTeamKey("Los Angeles Chargers")]: teamArtPath("NFL", "nfl-team-los-angeles-chargers.png"),
    [normTeamKey("Los Angeles Rams")]: teamArtPath("NFL", "nfl-team-los-angeles-rams.png"),
    [normTeamKey("Miami Dolphins")]: teamArtPath("NFL", "nfl-team-miami-dolphins.png"),
    [normTeamKey("New England Patriots")]: teamArtPath("NFL", "nfl-team-new-england-patriots.png"),
    [normTeamKey("Kansas City Chiefs")]: teamArtPath("NFL", "nfl-team-kansas-city-chiefs.png"),
    [normTeamKey("Minnesota Vikings")]: teamArtPath("NFL", "nfl-team-minnesota-vikings.png"),
    [normTeamKey("Pittsburgh Steelers")]: teamArtPath("NFL", "nfl-team-pittsburgh-steelers.png"),
    [normTeamKey("San Francisco 49ers")]: teamArtPath("NFL", "nfl-team-san-francisco-49ers.png"),
    [normTeamKey("Seattle Seahawks")]: teamArtPath("NFL", "nfl-team-seattle-seahawks.png"),
    [normTeamKey("Tennessee Titans")]: teamArtPath("NFL", "nfl-team-tennessee-titans.png"),
    [normTeamKey("New York Jets")]: teamArtPath("NFL", "nfl-team-new-york-jets.png"),
    [normTeamKey("Philadelphia Eagles")]: teamArtPath("NFL", "nfl-team-philadelphia-eagles.png"),
    [normTeamKey("Tampa Bay Buccaneers")]: teamArtPath("NFL", "nfl-team-tampa-bay-buccaneers.png"),
    [normTeamKey("Washington Commanders")]: teamArtPath("NFL", "nfl-team-washington-commanders.png"),
  },
};

// No championship-game name and no week-18 bowls on the FLHS sheets.
const FLHS_2025_PLAYOFFS = r3ChampHalf({
  colors: FLHS_CLR, logo: "FHSAA", logoSrc: FLHS_MARK, trophy: FLHS_TROPHY,
  banners: FLHS_BANNERS,
  wk15: [
    ["Western", "250.10", "Miami Beach", "217.95"],
    ["Dr Krop", "205.10", "Boca Raton", "235.65"],
    ["Coral Springs", "226.00", "West Broward", "188.75"],
    ["Palmetto", "193.80", "Miami Dade", "154.75"],
  ],
  semis: [
    // 1.70 apart -- the closest game in the tier, and it decides the final.
    ["Western", "243.00", "Boca Raton", "241.30"],
    ["Coral Springs", "237.35", "Palmetto", "165.10"],
  ],
  final: ["Western", "268.55", "Coral Springs", "189.10"],
  third: ["Boca Raton", "209.00", "Palmetto", "135.80"],
  fifth: {
    leftQual: ["Miami Beach", "262.30", "Dr Krop", "175.10"],
    rightQual: ["West Broward", "184.95", "Miami Dade", "295.05"],
    final: ["Miami Beach", "222.65", "Miami Dade", "154.00"],
  },
  seventh: ["Dr Krop", "205.75", "West Broward", "212.55"],
});

const FLHS_2025_CONSOLATION = r3ConsoHalf({
  colors: FLHS_CLR, logo: "FHSAA", logoSrc: FLHS_MARK,
  banners: FLHS_CONSO_BANNERS,
  wk15: [
    ["Taravella", "193.05", "Miami Senior", "187.25"],
    ["Southwest", "266.75", "Coral Glades", "127.70"],
    ["Deerfield", "164.70", "Stoneman", "157.25"],
    ["West Boca", "243.20", "Cypress Bay", "212.10"],
  ],
  semis: [
    ["Taravella", "241.65", "Southwest", "232.20"],
    // Deerfield's 85.25 is genuinely the lowest score in the tier.
    ["Deerfield", "85.25", "West Boca", "193.70"],
  ],
  final: ["Taravella", "176.70", "West Boca", "155.30"],
  eleventh: ["Southwest", "175.30", "Deerfield", "101.20"],
  thirteenth: {
    leftQual: ["Miami Senior", "186.20", "Coral Glades", "202.00"],
    rightQual: ["Stoneman", "137.45", "Cypress Bay", "158.10"],
    final: ["Coral Glades", "162.20", "Cypress Bay", "159.80"],
  },
  fifteenth: ["Miami Senior", "143.85", "Stoneman", "192.20"],
  footer: [336, 258, 324, "Relegation Bowl", "LAST PLACE COACH IS FIRED"],
});

// Which tiers render a live R3 bracket. SEC first as the test run; the others
// need their own short-name check before being added.
const R3_LIVE = {
  SEC: {
    colors: SEC_CLR, logoSrc: SEC_MARK, trophy: SEC_TROPHY, logo: "SEC",
    banners: SEC_BANNERS, consoBanners: SEC_CONSO_BANNERS,
  },
  TEN: {
    colors: TEN_CLR, logoSrc: TEN_MARK, trophy: TEN_TROPHY, logo: "BIG10",
    banners: TEN_BANNERS, consoBanners: TEN_CONSO_BANNERS,
  },
  "BIG XII": {
    colors: XII_CLR, logoSrc: XII_MARK, trophy: XII_TROPHY, logo: "BIG XII",
    banners: XII_BANNERS, consoBanners: XII_CONSO_BANNERS,
    // "West Virgnia Mountaineers" is misspelled in the source data; without
    // this it renders as the full misspelled name in the default colour.
    // "Arizona" was a data artifact in her spreadsheet — this slot's real
    // team is Northern Iowa Panthers (corrected by her 2026-08-07,
    // XII_CLR key renamed "Arizona"->"N Iowa" to match). Alias kept
    // explicit rather than relying on token matching, since this tier
    // also has "Iowa State" and a token-based match risks colliding
    // with it.
    aliases: { "West Virgnia Mountaineers": "W Virginia", "Northern Iowa Panthers": "N Iowa" },
  },
  ACC: {
    colors: ACC_CLR, logoSrc: ACC_MARK, trophy: ACC_TROPHY, logo: "ACC",
    banners: ACC_BANNERS, consoBanners: ACC_CONSO_BANNERS,
  },
  SUN: {
    colors: SUN_CLR, logoSrc: SUN_MARK, trophy: SUN_TROPHY, logo: "Sun Belt",
    banners: SUN_BANNERS, consoBanners: SUN_CONSO_BANNERS,
    aliases: { "James Madison Dukes": "JMU", "USM Golden Eagles": "S Miss" },
  },
  SOCO: {
    colors: SOCO_CLR, logoSrc: SOCO_MARK, trophy: SOCO_TROPHY, logo: "SoCon",
    banners: SOCO_BANNERS, consoBanners: SOCO_CONSO_BANNERS,
    // "Chatanooga" is a live misspelling of Chattanooga (missing a "t") — not
    // something to silently "fix" in their data, just cover it here so the
    // bracket still renders that team's real colour rather than the default.
    aliases: { "Chatanooga Mocs": "Chattanooga", "Tennessee Martin Skyhawks": "Martin" },
  },
  IVY: {
    colors: IVY_CLR, logoSrc: IVY_MARK, trophy: IVY_TROPHY, logo: "Ivy",
    banners: IVY_BANNERS, consoBanners: IVY_CONSO_BANNERS,
  },
  SWAC: {
    colors: SWAC_CLR, logoSrc: SWAC_MARK, trophy: SWAC_TROPHY, logo: "SWAC",
    banners: SWAC_BANNERS, consoBanners: SWAC_CONSO_BANNERS,
    aliases: { "S.C. State Bulldogs": "SC St" },
    // "Princeton Tigers" appears in SWAC's live data — Princeton is an Ivy
    // school with no SWAC colour key. Same class as the known Arkansas/Big
    // Ten and Morgan State/GLIAC cross-tier errors; NOT guessed at here.
  },
  GLIAC: {
    colors: GLIAC_CLR, logoSrc: GLIAC_MARK, trophy: GLIAC_TROPHY, logo: "GLIAC",
    banners: GLIAC_BANNERS, consoBanners: GLIAC_CONSO_BANNERS,
    // Live name has its words reversed ("Northern Ohio" vs the real "Ohio
    // Northern") but is unambiguously the same school (Polar Bears is Ohio
    // Northern's actual mascot).
    aliases: { "Northern Ohio Polar Bears": "Ohio N" },
    // "Morgan State Bears" appears in GLIAC's live data — Morgan State is a
    // SWAC school with no GLIAC colour key. NOT guessed at here.
  },
  // FLHS is "division-only" (same flat playoffSeeds shape as top8-cascade —
  // it just derives its 8 seeds from 4 real districts first). Confirmed it
  // genuinely HAS districts (FLHS_DISTRICTS: 13/14/15/16) before wiring this
  // in — the 2025 static bracket's missing division sub-lines were a DISPLAY
  // choice, not an absence of the underlying division field, so this needed
  // checking rather than assuming.
  FLHS: {
    colors: FLHS_CLR, logoSrc: FLHS_MARK, trophy: FLHS_TROPHY, logo: "FLHS",
    banners: FLHS_BANNERS, consoBanners: FLHS_CONSO_BANNERS,
    // "Miss State Bulldogs" / "Norfolk State Spartans" appear in FLHS's live
    // data — same secondary-tier-record pattern as Arkansas/Princeton/Morgan
    // State (a coach's other, non-FLHS team, carried in CAREER_STATS). Not
    // Florida schools, correctly has no FLHS colour key, nothing to add.
  },
};

// ===========================================================================
// LIVE-SEEDED BR BRACKETS (current season) — same idea as R3_LIVE, but for
// the bigger NFL-shape template. Only round 1 (the 8 real seeds/conference)
// is known before games are played; everything downstream is blank, exactly
// like R3_LIVE's flat tiers.
// ===========================================================================

// Fixed draft-pick/place labels for this bracket shape — same every season,
// tied to final rank, not to any particular team, so they're shared
// constants rather than per-season data (same idea as R3_CHAMP_PICKS).
const BR_CHAMP_PLACES = [
  [448, 33, "29th pick", "3rd place"], [448, 143, "25th pick", "5th place"],
  [448, 229, "27th pick", "7th place"], [448, 367, "17th pick", "9th place"],
  [448, 438, "19th pick", "11th place"], [448, 559, "21st pick", "13th place"],
  [448, 630, "23rd pick", "15th place"],
];
const BR_CONSO_PLACES = [
  [448, 33, "11th pick", "19th place"], [448, 143, "13th pick", "21st place"],
  [448, 229, "15th pick", "23rd place"], [448, 367, "3rd pick", "25th place"],
  [448, 438, "5th pick", "27th place"], [448, 559, "7th pick", "29th place"],
  [448, 630, "2nd pick", "31st place"],
];
// One canonical connector-elbow direction for the placement ladder. The real
// 2025 halves use DIFFERENT elbow directions from each other at points where
// it happened to look tidier for that season's particular winner — proven
// cosmetic-only (GBox positions never depend on it), and with no winner yet
// to hand-tune around, every live/future season uses this one consistent set.
const BR_LADDER_PATHS_LIVE = [
  "M324 169 L330 169 L330 162 L336 162", "M324 207 L330 207 L330 248 L336 248",
  "M672 207 L666 207 L666 162 L660 162", "M672 169 L666 169 L666 248 L660 248",
  ...BR_W15_FEEDERS,
  "M324 386 L330 386 L330 457 L336 457", "M324 424 L330 424 L330 386 L336 386",
  "M672 386 L666 386 L666 457 L660 457", "M672 424 L666 424 L666 386 L660 386",
  "M324 579 L330 579 L330 649 L336 649", "M324 617 L330 617 L330 578 L336 578",
  "M672 579 L666 579 L666 649 L660 649", "M672 617 L666 617 L666 578 L660 578",
];

const BR_LIVE = {
  NFL: {
    colors: TEAM_CLR, logoSrc: NFL_MARK, trophy: NFL_TROPHY, logo: "NFL",
    banners: BR_BANNERS,
    // Real live team names are full ("Los Angeles Rams", "New York Jets");
    // the bracket's short forms ("LA Rams", "NY Jets") aren't a prefix of
    // those, so — same as GLIAC's Ohio Northern — they need an explicit
    // alias rather than the token-expansion trick used for N/S/E/W/etc.
    // "Oakland Raiders" and "Cleveland Browns 20" are two more live team
    // names that don't match any TEAM_CLR key at all (a roster naming
    // choice, and a stray Sleeper suffix); aliased to their real franchise/
    // city so they still render sensibly instead of falling back full-width.
    aliases: {
      "Los Angeles Rams": "LA Rams", "Los Angeles Chargers": "LA Chargers",
      "New York Jets": "NY Jets", "New York Giants": "NY Giants",
      "Oakland Raiders": "Las Vegas", "Cleveland Browns 20": "Cleveland",
    },
  },
};

// One conference's round-1 seeds (up to 8, index 0 = the conference's own
// #1 seed) placed via BRACKET_PAIRS_R1 — the SAME pairing convention the
// pre-existing live NFLBracket component already uses. Everything past
// round 1 is blank; nobody has played yet.
function brLiveConf(cfg, seeds) {
  const nm = (n) => {
    const row = seeds[n - 1];
    return row ? r3ShortName(row.team, cfg.colors, cfg.aliases) : "";
  };
  return {
    r1: BRACKET_PAIRS_R1.map(([a, b]) => [nm(a), "", nm(b), ""]),
    r2: [brBlank, brBlank], r3: brBlank,
    lr1: [brBlank, brBlank], lr2w: brBlank, lr2l: brBlank, r2lose: brBlank,
  };
}

function brLiveHalf(cfg, group, half) {
  const o = {
    east: brLiveConf(cfg, group.east || []), west: brLiveConf(cfg, group.west || []),
    champ: brBlank, third: brBlank, fifth: brBlank, seventh: brBlank,
    ninth: brBlank, eleventh: brBlank, thirteenth: brBlank, fifteenth: brBlank,
    banners: cfg.banners, brMainPaths: BR_MAIN_PATHS, logo: cfg.logo, logoSrc: cfg.logoSrc,
    ladderPaths: BR_LADDER_PATHS_LIVE,
  };
  if (half === "playoffs") {
    o.championSub = "";   // no championship-game nickname known yet — renders no sub-line
    o.champSlots = [[448, 16, 100, 150, "Trophy", cfg.trophy], [448, 250, 100, 100, "PFA", PFA_MARK]];
    o.ladderH = 690;
    o.places = BR_CHAMP_PLACES;
  } else {
    o.topWinnerY = 171; o.topPick = "9th pick"; o.topLabel = "17th place";
    o.champSlots = [[448, 30, 100, 110, "PFA", PFA_MARK]];
    o.ladderH = 730;
    o.places = BR_CONSO_PLACES;
    o.footer = [336, 680, 324, "Relegation Bowl", "LAST PLACE COACH IS FIRED"];
  }
  return brChampHalf(o);
}

// Returns { playoffs, consolation } for a live-seeded BR-shape tier, or null.
function buildBRLive(tierKey, bracket) {
  const cfg = BR_LIVE[tierKey];
  if (!cfg || !bracket || !bracket.playoffGroup) return null;
  const { east, west } = bracket.playoffGroup;
  if (!((east && east.length) || (west && west.length))) return null;
  return {
    playoffs: brLiveHalf(cfg, bracket.playoffGroup, "playoffs"),
    consolation: brLiveHalf(cfg, bracket.consolationGroup || { east: [], west: [] }, "consolation"),
  };
}

// ===========================================================================
// LIVE-SEEDED USFL/XFL BRACKETS (current season) — the third bracket shape:
// 20 teams/tier, one play-in game per half in week 14, three byes per half
// straight into week 15, reducing to a single half-finalist by week 16, with
// the two week-14 losers separately playing a three-week points series for
// 9th/19th. Reverse-engineered from the real 2025 USFL_2025_PLAYOFFS geometry
// (paths traced back to their source boxes, not assumed from adjacency) and
// verified to reproduce it byte-for-byte before being used here — same
// confidence bar as brChampHalf. Reuses the SAME BRACKET_PAIRS_R1 seeding
// convention as every other tier: seeds 1-6 bye to week 15 (seed1 v playin
// winner, seed4 v seed5, mirrored seed2 v playin winner, seed3 v seed6);
// seeds 7-10 play the two week-14 play-ins (8v9, 7v10) — the same slot
// assignment the pre-existing USFLXFLBracket seeding-only renderer already
// uses. Only round 1 is known before games are played; everything from week
// 16 on (semifinals, final, 3rd/5th/7th/9th place games, the 9th/19th
// series) is blank until Sleeper results arrive.
// ===========================================================================

// One game as two boxes, stacked 38px apart at the same column (r3Stack) or
// at two arbitrary positions (r3Split) — reusing the shared win-derivation
// helpers so an unplayed game never flags a false winner.
function usflXflMainBoxes(o) {
  return [
    ...r3Stack(0, 19, o.playInLeft),
    ...r3Stack(112, 0, o.byeTop),
    ...r3Stack(112, 190, o.byeBot),
    ...r3Split(224, 19, 224, 209, o.semiLeft),
    ...r3Split(336, 114, 560, 114, o.final),
    ...r3Split(672, 19, 672, 209, o.semiRight),
    ...r3Stack(784, 0, o.byeTopR),
    ...r3Stack(784, 190, o.byeBotR),
    ...r3Stack(896, 19, o.playInRight),
  ];
}

// Fixed draft-pick/place labels — same every season, tied to final rank not
// to any particular team (same idea as R3_CHAMP_PICKS/BR_CHAMP_PLACES).
const USFLXFL_CHAMP_PLACES = [
  [448, 33, "11th pick", "3rd place"], [448, 143, "13th pick", "5th place"],
  [448, 229, "15th pick", "7th place"], [448, 360, "17th pick", "9th place"],
];
const USFLXFL_CONSO_PLACES = [
  [448, 33, "5th pick", "13th place"], [448, 143, "7th pick", "15th place"],
  [448, 229, "9th pick", "17th place"], [448, 360, "2nd pick", "19th place"],
];
// The real 2025 USFL/XFL consolation halves use slightly different elbow
// directions from each other (purely cosmetic, same finding as the NFL
// ladder) — one canonical direction for every live/future season, same
// principle as BR_LADDER_PATHS_LIVE.
const USFLXFL_PLACE_PATHS_LIVE = [
  "M324 169 L330 169 L330 162 L336 162", "M324 207 L330 207 L330 248 L336 248",
  "M672 207 L666 207 L666 162 L660 162", "M672 169 L666 169 L666 248 L660 248",
];

// Section 2: 3rd/5th/7th place games (13th/15th/17th one tier down) plus the
// two week-14 play-in losers' three-week series for 9th (19th). Entirely
// blank until Sleeper results arrive — none of it is knowable at round 1 —
// but keeps the real 2025 geometry (paths, slot positions) so the empty
// bracket still shows its true shape rather than a placeholder box.
function usflXflPlaceSection(half) {
  const blank = ["", "", "", ""];
  const s = {
    h: half === "playoffs" ? 420 : 470,
    paths: USFLXFL_PLACE_PATHS_LIVE,
    boxes: [
      ...r3Split(336, 33, 560, 33, blank),
      ...r3Stack(224, 150, blank),
      ...r3Stack(672, 150, blank),
      ...r3Split(336, 143, 560, 143, blank),
      ...r3Split(336, 229, 560, 229, blank),
      ...r3Split(112, 360, 784, 360, blank),
    ],
    series: [
      [224, 341, "", "", ""], [336, 341, "", "", ""],
      [560, 341, "", "", ""], [672, 341, "", "", ""],
    ],
    winners: [[448, 14, ""], [448, 124, ""], [448, 210, ""], [448, 341, ""]],
    places: half === "playoffs" ? USFLXFL_CHAMP_PLACES : USFLXFL_CONSO_PLACES,
  };
  if (half !== "playoffs") s.footer = [112, 420, 772, "Relegation Bowl", "LAST PLACE COACH IS FIRED"];
  return s;
}

function usflXflChampHalf(o) {
  return {
    colors: o.colors, logoSrc: o.logoSrc,
    sections: [
      {
        banners: o.banners, h: 280, paths: USFL_MAIN_PATHS, logo: o.logo,
        slots: [[448, 4, 100, 84, "Trophy", o.trophy], [448, 176, 100, 96, "PFA", PFA_MARK]],
        champion: { y: 114, label: "Champion", team: r3Winner(o.final), sub: "1st place" },
        boxes: usflXflMainBoxes(o),
      },
      usflXflPlaceSection("playoffs"),
    ],
  };
}

function usflXflConsHalf(o) {
  return {
    colors: o.colors, logoSrc: o.logoSrc,
    sections: [
      {
        banners: o.banners, h: 280, paths: USFL_MAIN_PATHS, logo: o.logo,
        slots: [[448, 4, 100, 70, "PFA", PFA_MARK]],
        winners: [[448, 95, r3Winner(o.final)]],
        places: [[448, 114, "3rd pick", "11th place"]],
        boxes: usflXflMainBoxes(o),
      },
      usflXflPlaceSection("consolation"),
    ],
  };
}

// seeds: the tier's flat 1-10 ranked rows (index 0 = seed 1). Unlike R3/BR,
// "division-playin" returns a single flat array — the half split (which
// seeds sit left vs right) is baked into the slotting below, not a live
// division field.
function usflXflLiveHalf(cfg, seeds, half) {
  const name = (n) => {
    const row = seeds[n - 1];
    return row ? r3ShortName(row.team, cfg.colors, cfg.aliases) : "";
  };
  const blank = ["", "", "", ""];
  const o = {
    colors: cfg.colors, logoSrc: cfg.logoSrc, logo: cfg.logo, trophy: cfg.trophy,
    banners: half === "playoffs" ? cfg.banners : cfg.consoBanners,
    playInLeft: [name(8), "", name(9), ""],
    byeTop: [name(1), "", "", ""],
    byeBot: [name(4), "", name(5), ""],
    semiLeft: blank,
    final: blank,
    semiRight: blank,
    byeTopR: [name(2), "", "", ""],
    byeBotR: [name(3), "", name(6), ""],
    playInRight: [name(7), "", name(10), ""],
  };
  return half === "playoffs" ? usflXflChampHalf(o) : usflXflConsHalf(o);
}

const USFLXFL_LIVE = {
  USFL: {
    colors: USFL_CLR, logoSrc: USFL_MARK, trophy: USFL_TROPHY, logo: "USFL",
    banners: USFL_BANNERS, consoBanners: USFL_CONSO_BANNERS,
    // Audited 2026-08-05 against her live 2026 Sleeper names: all 20 are
    // "City + Mascot" (real historical USFL franchise names), and every
    // city prefix matches a USFL_CLR key exactly. 0 aliases needed.
  },
  XFL: {
    colors: XFL_CLR, logoSrc: XFL_MARK, trophy: XFL_TROPHY, logo: "XFL",
    banners: XFL_BANNERS, consoBanners: XFL_CONSO_BANNERS,
    // Audited 2026-08-05. XFL_CLR uses LAX/LAW (not "Los Angeles") because
    // this tier has two different LA franchises (2001 Xtreme, 2020
    // Wildcats) — neither live name's tokens prefix-match its 3-letter
    // code, so both need an explicit alias below. Every other live name
    // matched an XFL_CLR key directly, including "St. Louis Battlehawks"
    // (works because the tokenizer's ST->STATE expansion applies
    // identically to both the live name and the "St Louis" key, so it
    // cancels out).
    aliases: { "Los Angeles Xtreme": "LAX", "Los Angeles Wildcats": "LAW" },
  },
};

// Returns { playoffs, consolation } for USFL/XFL's live-seeded bracket, or
// null.
function buildUSFLXFLLive(tierKey, bracket) {
  const cfg = USFLXFL_LIVE[tierKey];
  if (!cfg || !bracket || !bracket.seeds || !bracket.seeds.length) return null;
  return {
    playoffs: usflXflLiveHalf(cfg, bracket.seeds, "playoffs"),
    consolation: usflXflLiveHalf(cfg, bracket.consolation || [], "consolation"),
  };
}

// ===========================================================================
// TOURNAMENT — cross-tier 20-team single-elimination bracket (this year's
// theme: "Fall-iday Madness", see TOURNAMENT_THEME above). Unlike every
// other bracket in this file, this one isn't scoped to a single tier: its 20
// seeds are pulled from the TOP 20 teams across ALL 13 tiers by W-L then
// points scored. Seeds lock in ONCE at the Week7->Week8 rollover (a frozen
// snapshot in Firestore, see tournamentSeeds below) and stay fixed for the
// rest of the event -- unlike R3_LIVE/BR_LIVE, which harmlessly reseed
// themselves every render, a real single-elimination bracket can't do that
// once games start.
//
// Shape (confirmed against her corrected template 2026-08-07): seeds 1-12
// get a bye straight to the Round of 16 (Week 9). Seeds 13-20 play 4 Week-8
// play-in games; from Week 9 on it's a clean power-of-2 single-elim tree
// (16 -> 8 -> 4 -> 2 -> 1). Week 13 has no game -- it's a dedicated results
// column (Champion/2nd/QF-loser/Win, trophy + team art), the same idea as
// the R3 brackets' "week 18" centre space, just given its own explicit week
// label here since every other column in this bracket IS a real matchup
// week.
// ===========================================================================

// One shared lookup for every tier's colour map + live-name aliases --
// R3_LIVE/BR_LIVE/USFLXFL_LIVE between them already cover all 13 tiers, this
// just flattens those three registries into one tierKey-keyed table so a
// cross-tier feature doesn't need its own 13-entry duplicate.
const TIER_COLOR_CFG = { ...R3_LIVE, NFL: BR_LIVE.NFL, USFL: USFLXFL_LIVE.USFL, XFL: USFLXFL_LIVE.XFL };

// Fixed bracket topology -- WHICH seeds share a play-in game and which bye
// meets which play-in winner is permanent tournament structure (confirmed
// against her corrected seeding 2026-08-07), not something that changes
// season to season; only who HOLDS each seed number changes each year.
const TOURNEY_PLAYIN = [
  { key: "L1", seeds: [13, 20] },
  { key: "L2", seeds: [16, 17] },
  { key: "R1", seeds: [14, 19] },
  { key: "R2", seeds: [15, 18] },
];
const TOURNEY_R16 = [
  { key: "LA", a: { seed: 1 }, b: { playin: "L1" } },
  { key: "LB", a: { seed: 8 }, b: { seed: 9 } },
  { key: "LC", a: { seed: 4 }, b: { playin: "L2" } },
  { key: "LD", a: { seed: 5 }, b: { seed: 12 } },
  { key: "RA", a: { seed: 2 }, b: { playin: "R1" } },
  { key: "RB", a: { seed: 7 }, b: { seed: 10 } },
  { key: "RC", a: { seed: 3 }, b: { playin: "R2" } },
  { key: "RD", a: { seed: 6 }, b: { seed: 11 } },
];
const TOURNEY_QF = [
  { key: "LQ1", a: "LA", b: "LB" }, { key: "LQ2", a: "LC", b: "LD" },
  { key: "RQ1", a: "RA", b: "RB" }, { key: "RQ2", a: "RC", b: "RD" },
];
const TOURNEY_SF = [{ key: "LSF", a: "LQ1", b: "LQ2" }, { key: "RSF", a: "RQ1", b: "RQ2" }];
const TOURNEY_FINAL = { key: "FINAL", a: "LSF", b: "RSF" };

// Cross-tier seeding: flattens every tier's already-fetched standingsCache
// rows into one list, ranked by W-L then points scored (her stated rule),
// and takes the top 20. Skips unowned rosters -- an open coaching job can't
// hold a tournament seed. Requires every tier's standings to already be
// cached (the bulk-discovery effect does this for the whole site already,
// not something this feature needs to trigger itself).
function computeTourneySeeds(standingsCache, leagueMap) {
  const rows = [];
  TIERS.forEach((t) => {
    const leagueId = leagueMap[t.key];
    const tierRows = leagueId && standingsCache[leagueId];
    if (!tierRows) return;
    tierRows.forEach((r) => {
      if (!r.userId || !r.rosterId) return;
      rows.push({
        tierKey: t.key, rosterId: r.rosterId, coach: r.coach, team: r.team,
        w: r.w, l: r.l, pts: r.pts,
      });
    });
  });
  rows.sort((a, b) => b.w - a.w || b.pts - a.pts);
  return rows.slice(0, 20).map((r, i) => ({ ...r, seed: i + 1 }));
}

// One game between two team-refs at a given week. `countsAsWin=false` is
// used for the semifinal and final -- per the confirmed CP formula, the
// semifinal win is NOT separately worth +2 for either finalist; their SF win
// plus final result are bundled into one flat number instead (see
// tourneyCPTable). `scores` is { [week]: { [rosterId]: points } }, built
// only from weeks actually fetched -- a missing entry means "not known yet",
// not zero, so an unplayed/unfetched game correctly stays unresolved rather
// than silently picking a false winner (same r3Played-style safety as every
// other bracket in this file).
function tourneyPlay(a, b, week, scores, countsAsWin = true) {
  if (!a || !b) return { a, b, winner: null, loser: null, played: false };
  const wk = scores[week] || {};
  const sa = wk[a.rosterId], sb = wk[b.rosterId];
  if (typeof sa !== "number" || typeof sb !== "number" || sa === sb) {
    return { a, b, scoreA: sa, scoreB: sb, winner: null, loser: null, played: false };
  }
  const aWon = sa > sb;
  const winnerBase = aWon ? a : b, loserBase = aWon ? b : a;
  return {
    a, b, scoreA: sa, scoreB: sb, played: true,
    winner: { ...winnerBase, wins: winnerBase.wins + (countsAsWin ? 1 : 0) },
    loser: { ...loserBase },
  };
}

// Resolves as much of the bracket as `scores` currently allows -- exactly
// the "build only what's knowable, leave the rest blank" principle every
// live bracket in this file follows. `seeds` is the frozen 20-entry list
// (index 0 = seed 1). Returns a flat map of every named game -> its
// {a,b,winner,loser,played} result.
function resolveTourneyBracket(seeds, scores) {
  if (!seeds || seeds.length < 20) return {};
  const bySeed = (n) => { const t = seeds[n - 1]; return t ? { ...t, wins: 0 } : null; };
  const games = {};
  TOURNEY_PLAYIN.forEach((g) => {
    games[g.key] = tourneyPlay(bySeed(g.seeds[0]), bySeed(g.seeds[1]), 8, scores);
  });
  const entrant = (ref) => (ref.seed ? bySeed(ref.seed) : (games[ref.playin] || {}).winner || null);
  TOURNEY_R16.forEach((g) => { games[g.key] = tourneyPlay(entrant(g.a), entrant(g.b), 9, scores); });
  const byGame = (key) => (games[key] || {}).winner || null;
  TOURNEY_QF.forEach((g) => { games[g.key] = tourneyPlay(byGame(g.a), byGame(g.b), 10, scores); });
  TOURNEY_SF.forEach((g) => { games[g.key] = tourneyPlay(byGame(g.a), byGame(g.b), 11, scores, false); });
  games[TOURNEY_FINAL.key] = tourneyPlay(byGame(TOURNEY_FINAL.a), byGame(TOURNEY_FINAL.b), 12, scores, false);
  return games;
}

// CP per the formula confirmed against her exact numbers 2026-08-07 (every
// play-in/R16/QF win is +2 and stacks; a QF loss adds a flat +5 on top of
// whatever was already banked; the semifinal winner/loser's CP is a flat
// 20/10 replacing what the SF win + final result would otherwise total).
// Returns { [rosterId]: { team, coach, tierKey, cp, result } } for every
// team whose tournament run has actually ended (played and lost, or won the
// final) -- a team still alive simply has no entry yet.
function tourneyCPTable(games) {
  const cp = {};
  const set = (team, amount, result) => {
    if (!team) return;
    cp[team.rosterId] = { team: team.team, coach: team.coach, tierKey: team.tierKey, cp: amount, result };
  };
  TOURNEY_PLAYIN.forEach((g) => { const r = games[g.key]; if (r && r.played) set(r.loser, 0, "Play-in loss"); });
  TOURNEY_R16.forEach((g) => { const r = games[g.key]; if (r && r.played) set(r.loser, 2 * r.loser.wins, "Round of 16 loss"); });
  TOURNEY_QF.forEach((g) => { const r = games[g.key]; if (r && r.played) set(r.loser, 2 * r.loser.wins + 5, "Quarterfinal loss"); });
  TOURNEY_SF.forEach((g) => { const r = games[g.key]; if (r && r.played) set(r.loser, 2 * r.loser.wins, "Semifinal loss"); });
  const fin = games[TOURNEY_FINAL.key];
  if (fin && fin.played) {
    set(fin.winner, 2 * fin.winner.wins + 20, "Champion");
    set(fin.loser, 2 * fin.loser.wins + 10, "2nd place");
  }
  return cp;
}

// ===========================================================================
// TOURNAMENT bracket geometry & rendering -- see the data-layer block near
// GRID_BRACKETS (computeTourneySeeds/resolveTourneyBracket/tourneyCPTable)
// for the seeding/results/CP logic this renders. Needs its own width and
// column x-positions -- one column wider per half than any existing shape
// (the extra Week-8 play-in column) -- so it can't reuse GRID_W/GridBracket
// directly, though it reuses GBox for every team box so styling stays
// identical to the rest of the site. The Week9-Week12 portion (Round of 16
// -> Final) is geometrically identical to BR's own R1->R2->R3->Final shape
// (brMainSide's proven layout: BR_R1_Y/BR_R2_Y/BR_R3_Y/BR_FINAL_Y, reused
// as-is below) -- TOURNEY_MAIN_PATHS is BR_MAIN_PATHS with every
// x-coordinate shifted +112 to make room for the extra play-in column at
// x=0, re-derived programmatically rather than hand-retyped to avoid
// exactly the kind of connector-fidelity bug documented elsewhere in this
// file. TOURNEY_PLAYIN_PATHS (Week8->Week9) is new geometry -- no other
// bracket shape has a play-in round feeding a full power-of-2 tree -- built
// in the same 6px-stub elbow style as every other connector here.
// ===========================================================================
const TOURNEY_GRID_W = 1220;
const TOURNEY_H = 460;
const tourneyMirrorX = (x) => TOURNEY_GRID_W - x;

const TOURNEY_MAIN_PATHS = [
  "M212 38 L218 38 L218 95 L224 95", "M212 152 L218 152 L218 95 L224 95",
  "M212 266 L218 266 L218 323 L224 323", "M212 380 L218 380 L218 323 L224 323",
  "M324 95 L330 95 L330 209 L336 209", "M324 323 L330 323 L330 209 L336 209",
  "M436 209 L448 209", "M548 209 L560 209",
  "M1008 38 L1002 38 L1002 95 L996 95", "M1008 152 L1002 152 L1002 95 L996 95",
  "M1008 266 L1002 266 L1002 323 L996 323", "M1008 380 L1002 380 L1002 323 L996 323",
  "M896 95 L890 95 L890 209 L884 209", "M896 323 L890 323 L890 209 L884 209",
  "M784 209 L772 209", "M672 209 L660 209",
];
const TOURNEY_PLAYIN_PATHS = [
  "M100 19 L106 19 L106 38 L112 38", "M100 57 L106 57 L106 38 L112 38",
  "M100 247 L106 247 L106 266 L112 266", "M100 285 L106 285 L106 266 L112 266",
  "M1120 19 L1114 19 L1114 38 L1108 38", "M1120 57 L1114 57 L1114 38 L1108 38",
  "M1120 247 L1114 247 L1114 266 L1108 266", "M1120 285 L1114 285 L1114 266 L1108 266",
];

// One team box for the tournament bracket -- thin wrapper around the shared
// GBox so every box looks identical to the rest of the site, but resolves
// its own colour from that team's HOME tier (tournament seeds span all 13
// tiers, so there's no single per-tier colour map the way every other
// bracket has). `g` is a resolved game slot ({a,b,winner,scoreA,scoreB,...})
// from resolveTourneyBracket, or null if that game doesn't apply to this box.
function tourneyColorsMap(seeds) {
  const map = {};
  (seeds || []).forEach((s) => {
    const cfg = TIER_COLOR_CFG[s.tierKey];
    if (!cfg) return;
    const name = r3ShortName(s.team, cfg.colors, cfg.aliases);
    if (cfg.colors && cfg.colors[name]) map[name] = cfg.colors[name];
  });
  return map;
}
function tourneyName(team) {
  if (!team) return "";
  const cfg = TIER_COLOR_CFG[team.tierKey];
  return cfg ? r3ShortName(team.team, cfg.colors, cfg.aliases) : team.team;
}
// Renders one game's two teams as a stacked GBox pair, resolving names/
// scores/win-flag from a resolveTourneyBracket game slot. `y` is the pair's
// TOP box position -- the bottom box sits at y+38, matching brStack.
function TourneyPair({ x, y, g, colors }) {
  if (!g) return null;
  const played = g.played;
  return (
    <>
      <GBox x={x} y={y} team={tourneyName(g.a)} score={played ? g.scoreA : g.a ? "" : ""} win={played && g.winner && g.a && g.winner.rosterId === g.a.rosterId ? 1 : 0} colors={colors} />
      <GBox x={x} y={y + 38} team={tourneyName(g.b)} score={played ? g.scoreB : g.b ? "" : ""} win={played && g.winner && g.b && g.winner.rosterId === g.b.rosterId ? 1 : 0} colors={colors} />
    </>
  );
}
// A single-entrant slot (a team waiting on its next game, or a bye that
// hasn't played yet) -- just the name, no score/win flag to show.
function TourneySolo({ x, y, team, colors }) {
  return <GBox x={x} y={y} team={tourneyName(team)} colors={colors} />;
}

// data: { seeds (frozen 20), games (resolveTourneyBracket result), cp
// (tourneyCPTable result) }. Renders the full 11-column bracket: Week8
// play-in through Week12 final, mirrored, with Week13's results column
// (trophy/PFA mark/decor art + Champion/2nd/QF-loser/Win) in the centre.
function TournamentBracket({ data }) {
  const wrapRef = useRef(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => { const w = el.clientWidth; if (w > 0) setScale(Math.min(1, w / TOURNEY_GRID_W)); };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (!data || !data.seeds || data.seeds.length < 20) {
    return (
      <div style={{ padding: 20, textAlign: "center", color: C.slate, fontSize: 13 }}>
        Seeds for this year's Tournament haven't been set yet -- they lock in once Week 8 begins.
      </div>
    );
  }
  const { seeds, games, cp } = data;
  const colors = tourneyColorsMap(seeds);
  const bySeed = (n) => seeds[n - 1];
  const g = (key) => games[key];
  const X = TOURNEY_X;

  const cpRow = (label, value, bg, fg) => (
    <div style={{
      width: 130, display: "flex", justifyContent: "space-between", padding: "4px 8px",
      borderRadius: 3, fontSize: 12, fontWeight: 700, background: bg, color: fg,
    }}>
      <span>{label}</span><span>{value}</span>
    </div>
  );

  return (
    <div ref={wrapRef} style={{ width: "100%", overflow: "hidden", height: TOURNEY_H * scale }}>
      <div style={{ width: TOURNEY_GRID_W, transformOrigin: "top left", transform: `scale(${scale})` }}>
        <div style={{ position: "relative", width: TOURNEY_GRID_W, height: TOURNEY_H }}>
          <GPaths h={TOURNEY_H} d={[...TOURNEY_PLAYIN_PATHS, ...TOURNEY_MAIN_PATHS]} />

          {/* --- LEFT half --- */}
          <TourneyPair x={X.playin} y={19} g={g("L1")} colors={colors} />
          <TourneyPair x={X.playin} y={247} g={g("L2")} colors={colors} />
          <TourneySolo x={X.r16} y={0} team={bySeed(1)} colors={colors} />
          <TourneySolo x={X.r16} y={38} team={(g("L1") || {}).winner} colors={colors} />
          <TourneyPair x={X.r16} y={114} g={g("LB")} colors={colors} />
          <TourneySolo x={X.r16} y={228} team={bySeed(4)} colors={colors} />
          <TourneySolo x={X.r16} y={266} team={(g("L2") || {}).winner} colors={colors} />
          <TourneyPair x={X.r16} y={342} g={g("LD")} colors={colors} />
          <TourneySolo x={X.qf} y={57} team={(g("LA") || {}).winner} colors={colors} />
          <TourneySolo x={X.qf} y={95} team={(g("LB") || {}).winner} colors={colors} />
          <TourneySolo x={X.qf} y={285} team={(g("LC") || {}).winner} colors={colors} />
          <TourneySolo x={X.qf} y={323} team={(g("LD") || {}).winner} colors={colors} />
          <TourneySolo x={X.sf} y={171} team={(g("LQ1") || {}).winner} colors={colors} />
          <TourneySolo x={X.sf} y={209} team={(g("LQ2") || {}).winner} colors={colors} />
          <TourneySolo x={X.finalEntrant} y={190} team={(g("LSF") || {}).winner} colors={colors} />

          {/* --- RIGHT half (mirrored) --- */}
          <TourneyPair x={tourneyMirrorX(X.playin) - BW} y={19} g={g("R1")} colors={colors} />
          <TourneyPair x={tourneyMirrorX(X.playin) - BW} y={247} g={g("R2")} colors={colors} />
          <TourneySolo x={tourneyMirrorX(X.r16) - BW} y={0} team={bySeed(2)} colors={colors} />
          <TourneySolo x={tourneyMirrorX(X.r16) - BW} y={38} team={(g("R1") || {}).winner} colors={colors} />
          <TourneyPair x={tourneyMirrorX(X.r16) - BW} y={114} g={g("RB")} colors={colors} />
          <TourneySolo x={tourneyMirrorX(X.r16) - BW} y={228} team={bySeed(3)} colors={colors} />
          <TourneySolo x={tourneyMirrorX(X.r16) - BW} y={266} team={(g("R2") || {}).winner} colors={colors} />
          <TourneyPair x={tourneyMirrorX(X.r16) - BW} y={342} g={g("RD")} colors={colors} />
          <TourneySolo x={tourneyMirrorX(X.qf) - BW} y={57} team={(g("RA") || {}).winner} colors={colors} />
          <TourneySolo x={tourneyMirrorX(X.qf) - BW} y={95} team={(g("RB") || {}).winner} colors={colors} />
          <TourneySolo x={tourneyMirrorX(X.qf) - BW} y={285} team={(g("RC") || {}).winner} colors={colors} />
          <TourneySolo x={tourneyMirrorX(X.qf) - BW} y={323} team={(g("RD") || {}).winner} colors={colors} />
          <TourneySolo x={tourneyMirrorX(X.sf) - BW} y={171} team={(g("RQ1") || {}).winner} colors={colors} />
          <TourneySolo x={tourneyMirrorX(X.sf) - BW} y={209} team={(g("RQ2") || {}).winner} colors={colors} />
          <TourneySolo x={tourneyMirrorX(X.finalEntrant) - BW} y={190} team={(g("RSF") || {}).winner} colors={colors} />

          {/* --- Mascots either side of the play-in columns --- */}
          <GSlot x={X.playin} y={140} w={BW} h={70} label="" src={TOURNEY_MASCOT_LEFT} />
          <GSlot x={tourneyMirrorX(X.playin) - BW} y={140} w={BW} h={70} label="" src={TOURNEY_MASCOT_RIGHT} />
          {/* --- Corner leaves, bottom of the play-in columns --- */}
          <GSlot x={X.playin} y={330} w={BW} h={70} label="" src={TOURNEY_DECOR_BOTTOM_LEFT} />
          <GSlot x={tourneyMirrorX(X.playin) - BW} y={330} w={BW} h={70} label="" src={TOURNEY_DECOR_BOTTOM_RIGHT} />

          {/* --- Week 13: no game, results only --- */}
          <GSlot x={X.finalEntrant} y={0} w={BW} h={40} label="" src={TOURNEY_DECOR_TOP_LEFT} />
          <GSlot x={X.center} y={0} w={BW} h={50} label="PFA" src={PFA_MARK} />
          <GSlot x={tourneyMirrorX(X.finalEntrant) - BW} y={0} w={BW} h={40} label="" src={TOURNEY_DECOR_TOP_RIGHT} />
          <GSlot x={X.center} y={55} w={BW} h={70} label="Trophy" src={TOURNEY_TROPHY} />
          <div style={{ position: "absolute", left: X.center, top: 190, display: "flex", flexDirection: "column", gap: 4 }}>
            {cpRow("Champion", `${(cp[(g("FINAL") || {}).winner && g("FINAL").winner.rosterId] || {}).cp ?? 20} CP`, C.gold, C.ink)}
            {cpRow("2nd", `${(cp[(g("FINAL") || {}).loser && g("FINAL").loser.rosterId] || {}).cp ?? 10} CP`, "#B4B2A9", "#2C2C2A")}
            {cpRow("QF loser", "5 CP", "#D9711C", "#2A1200")}
            {cpRow("Win", "2 CP", C.turf, "#0E3A1B")}
          </div>
          <GSlot x={X.center} y={330} w={BW} h={90} label="" src={TOURNEY_DECOR_CENTER} />
        </div>
      </div>
    </div>
  );
}

const GRID_BRACKETS = {
  NFL: { playoffs: NFL_2025_PLAYOFFS, consolation: NFL_2025_CONSOLATION },
  USFL: { playoffs: USFL_2025_PLAYOFFS, consolation: USFL_2025_CONSOLATION },
  XFL: { playoffs: XFL_2025_PLAYOFFS, consolation: XFL_2025_CONSOLATION },
  SEC: { playoffs: SEC_2025_PLAYOFFS, consolation: SEC_2025_CONSOLATION, bowls: SEC_2025_BOWLS },
  TEN: { playoffs: TEN_2025_PLAYOFFS, consolation: TEN_2025_CONSOLATION, bowls: TEN_2025_BOWLS },

  SWAC: { playoffs: SWAC_2025_PLAYOFFS, consolation: SWAC_2025_CONSOLATION },
  "BIG XII": { playoffs: XII_2025_PLAYOFFS, consolation: XII_2025_CONSOLATION },
  ACC: { playoffs: ACC_2025_PLAYOFFS, consolation: ACC_2025_CONSOLATION },
  SOCO: { playoffs: SOCO_2025_PLAYOFFS, consolation: SOCO_2025_CONSOLATION },
  SUN: { playoffs: SUN_2025_PLAYOFFS, consolation: SUN_2025_CONSOLATION },
  IVY: { playoffs: IVY_2025_PLAYOFFS, consolation: IVY_2025_CONSOLATION },
  GLIAC: { playoffs: GLIAC_2025_PLAYOFFS, consolation: GLIAC_2025_CONSOLATION },
  FLHS: { playoffs: FLHS_2025_PLAYOFFS, consolation: FLHS_2025_CONSOLATION },
};

// A from-scratch "completed bracket" visual for confirmed historical results —
// deliberately NOT reusing NFLBracket/USFLXFLBracket's internal geometry,
// since those components' box-to-box wiring can't be safely verified without
// live-rendering it. This one owns its own layout instead: Round 1 games on
// the left (real teams, real scores, winner bolded), confirmed final rank
// order on the right, with a line connecting each team from its Round 1 box
// to wherever it actually landed. Whoever crosses over the most on the way
// down lost ground; whoever climbs shows the real story of the bracket.
function CompletedBracketFlow({ round1, finalOrder, startRank, rows, fired }) {
  const rowGap = 6, gameGap = 20;
  const leftX = 0;
  const rightX = 420;
  const width = rightX + BOX_W;

  const left = [];
  let y = 0;
  round1.forEach(([a, pa, b, pb]) => {
    left.push({ name: a, pts: pa, y, won: pa > pb });
    y += BOX_H + rowGap;
    left.push({ name: b, pts: pb, y, won: pb > pa });
    y += BOX_H + gameGap;
  });
  const leftHeight = y - gameGap;

  const right = finalOrder.map((name, i) => ({ name, rank: startRank + i, y: i * (BOX_H + rowGap) }));
  const rightHeight = right.length ? right[right.length - 1].y + BOX_H : 0;
  const height = Math.max(leftHeight, rightHeight);
  const leftOffset = (height - leftHeight) / 2;
  const rightOffset = (height - rightHeight) / 2;

  const byName = {};
  right.forEach((r) => { byName[r.name] = r; });

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" style={{ minWidth: `${width * 0.7}px`, height: "auto" }}>
        {left.map((entry, i) => {
          const target = byName[entry.name];
          if (!target) return null;
          return (
            <Connector
              key={`c-${i}`}
              d={elbowPath(leftX + BOX_W, entry.y + leftOffset + BOX_H / 2, rightX, target.y + rightOffset + BOX_H / 2)}
            />
          );
        })}
        {left.map((entry, i) => (
          <g key={`l-${i}`}>
            <BracketBox x={leftX} y={entry.y + leftOffset} entry={findRowByName(rows, entry.name) || entry.name} />
            <text
              x={leftX + BOX_W - 6}
              y={entry.y + leftOffset + BOX_H / 2 + 4}
              textAnchor="end"
              fontSize="9.5"
              fontFamily="'IBM Plex Mono', monospace"
              fontWeight={entry.won ? 700 : 400}
              fill={entry.won ? C.turf : C.slate}
            >
              {entry.pts.toFixed(1)}
            </text>
          </g>
        ))}
        {right.map((entry) => {
          const isFirst = entry.rank === startRank;
          const isLast = fired && entry.rank === startRank + right.length - 1;
          return (
            <g key={`r-${entry.rank}`}>
              <BracketBox
                x={rightX}
                y={entry.y + rightOffset}
                seed={entry.rank}
                entry={findRowByName(rows, entry.name) || entry.name}
                highlight={isFirst ? "champion" : isLast ? "fired" : undefined}
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// Simple left-to-right single-elimination tree: Round 1 -> (Semifinal) ->
// Final. Used for top8/conference-division sub-brackets and division-only.
function TreeBracket({ seeds, finalLabel = "Championship" }) {
  const size = seeds.length <= 4 ? 4 : 8;
  const pairs = size === 4 ? BRACKET_PAIRS_R1_4 : BRACKET_PAIRS_R1;
  const colGap = 70;
  const rowGap = 26;
  const r1X = 0;
  const r2X = r1X + BOX_W + colGap;
  const r3X = r2X + BOX_W + colGap;
  const r1Ys = pairs.map((_, i) => i * (BOX_H * 2 + rowGap * 2));
  const r2Ys = [];
  for (let i = 0; i < r1Ys.length; i += 2) {
    r2Ys.push((r1Ys[i] + r1Ys[i + 1]) / 2);
  }
  const r3Y = r2Ys.length > 1 ? (r2Ys[0] + r2Ys[r2Ys.length - 1]) / 2 : r2Ys[0];
  const width = size === 4 ? r2X + BOX_W : r3X + BOX_W;
  const height = r1Ys[r1Ys.length - 1] + BOX_H;

  const lines = [];
  pairs.forEach(([a, b], i) => {
    const y = r1Ys[i];
    lines.push(<Connector key={`r1-${i}`} d={elbowPath(r1X + BOX_W, y + BOX_H / 2, r2X, r2Ys[Math.floor(i / 2)] + BOX_H / 2)} />);
    // both matches in a pair feed the same r2 slot — draw both halves
  });
  if (size === 8) {
    r2Ys.forEach((y, i) => {
      lines.push(<Connector key={`r2-${i}`} d={elbowPath(r2X + BOX_W, y + BOX_H / 2, r3X, r3Y + BOX_H / 2)} />);
    });
  }

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" style={{ minWidth: `${width * 0.75}px`, height: "auto" }}>
      {lines}
      {pairs.map(([a, b], i) => (
        <g key={i}>
          <BracketBox x={r1X} y={r1Ys[i]} seed={a} entry={seeds[a - 1]} />
          <BracketBox x={r1X} y={r1Ys[i] + BOX_H + rowGap} seed={b} entry={seeds[b - 1]} />
        </g>
      ))}
      {r2Ys.map((y, i) => (
        <BracketBox key={i} x={r2X} y={y} entry={size === 4 ? (r2Ys.length === 1 ? finalLabel : "Winner, Match " + (i * 2 + 1)) : `Winner, Match ${i + 1}`} />
      ))}
      {size === 8 && <BracketBox x={r3X} y={r3Y} entry={finalLabel} />}
    </svg>
  );
}

// Mirrored two-conference "everybody plays for placement" bracket (Sun
// Belt, SoCo, Ivy, SWAC, GLIAC): East reads left-to-right, West reads
// right-to-left. Each conference plays 2 Round-1 games (1v4, 2v3) —
// winners meet in that conference's final, losers meet in that
// conference's placement semi. The two conferences then cross over at
// center for 4 placement games cascading down the page.
function MirroredPlacementBracket({ east, west, eastName, westName, labels, fired }) {
  const colGap = 46;
  const eR1X = 0;
  const eFinalX = eR1X + BOX_W + colGap;
  const centerX = eFinalX + BOX_W + colGap;
  const wFinalX = centerX + BOX_W + colGap;
  const wR1X = wFinalX + BOX_W + colGap;
  const width = wR1X + BOX_W;

  const withinGameGap = 8;
  const gameGap = 70;
  const placementGap = 100;
  const s1Y = 0;
  const s4Y = s1Y + BOX_H + withinGameGap;
  const s2Y = s4Y + BOX_H + gameGap;
  const s3Y = s2Y + BOX_H + withinGameGap;
  const g1Mid = (s1Y + s4Y) / 2 + BOX_H / 2;
  const g2Mid = (s2Y + s3Y) / 2 + BOX_H / 2;
  const finalY = (g1Mid + g2Mid) / 2 - BOX_H / 2;
  const thirdY = finalY + BOX_H + placementGap;
  const loserSemiY = thirdY + BOX_H + placementGap;
  const seventhY = loserSemiY + BOX_H + placementGap;
  const height = seventhY + BOX_H + (fired ? 24 : 0);

  // A game's two seeds join at a single point, which then sends one line to
  // the conference final (winner path) and one to the placement semi
  // (loser path) — the same visual idea as a standard bracket "elbow", just
  // with two destinations since we don't yet know who wins. destX is the
  // actual x to connect into (differs for East, which reads left-to-right,
  // vs West, which reads right-to-left).
  const gameConnectors = (seedTopY, seedBotY, joinX, joinMid, destX) => (
    <>
      <Connector d={`M ${joinX} ${seedTopY + BOX_H / 2} L ${joinX} ${seedBotY + BOX_H / 2}`} />
      <Connector d={elbowPath(joinX, joinMid, destX, finalY + BOX_H / 2)} />
      <Connector d={elbowPath(joinX, joinMid, destX, loserSemiY + BOX_H / 2)} />
    </>
  );

  return (
    <div className="space-y-1 overflow-x-auto">
      <div className="flex justify-between text-xs uppercase mb-1" style={{ color: C.slate }}>
        <span>{eastName}</span>
        <span>{westName}</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" style={{ minWidth: `${width * 0.68}px`, height: "auto" }}>
        {/* East: two Round 1 games, each joining then branching to final (win) and loser-semi (lose) */}
        {gameConnectors(s1Y, s4Y, eR1X + BOX_W, g1Mid, eFinalX)}
        {gameConnectors(s2Y, s3Y, eR1X + BOX_W, g2Mid, eFinalX)}
        {/* West mirrored — R1 boxes' output edge is their LEFT side, connecting back to West's final on their left */}
        {gameConnectors(s1Y, s4Y, wR1X, g1Mid, wFinalX + BOX_W)}
        {gameConnectors(s2Y, s3Y, wR1X, g2Mid, wFinalX + BOX_W)}
        {/* Finals -> Championship / 3rd place */}
        <Connector d={elbowPath(eFinalX + BOX_W, finalY + BOX_H / 2, centerX, finalY + BOX_H / 2)} />
        <Connector d={elbowPath(wFinalX, finalY + BOX_H / 2, centerX + BOX_W, finalY + BOX_H / 2)} />
        <Connector d={elbowPath(eFinalX + BOX_W / 2, finalY + BOX_H, eFinalX + BOX_W / 2, thirdY + BOX_H / 2)} />
        <Connector d={elbowPath(eFinalX + BOX_W / 2, thirdY + BOX_H / 2, centerX, thirdY + BOX_H / 2)} />
        <Connector d={elbowPath(wFinalX + BOX_W / 2, finalY + BOX_H, wFinalX + BOX_W / 2, thirdY + BOX_H / 2)} />
        <Connector d={elbowPath(wFinalX + BOX_W / 2, thirdY + BOX_H / 2, centerX + BOX_W, thirdY + BOX_H / 2)} />
        {/* Placement semis -> 5th / 7th place */}
        <Connector d={elbowPath(eFinalX + BOX_W, loserSemiY + BOX_H / 2, centerX, loserSemiY + BOX_H / 2)} />
        <Connector d={elbowPath(wFinalX, loserSemiY + BOX_H / 2, centerX + BOX_W, loserSemiY + BOX_H / 2)} />
        <Connector d={elbowPath(eFinalX + BOX_W / 2, loserSemiY + BOX_H, eFinalX + BOX_W / 2, seventhY + BOX_H / 2)} />
        <Connector d={elbowPath(eFinalX + BOX_W / 2, seventhY + BOX_H / 2, centerX, seventhY + BOX_H / 2)} />
        <Connector d={elbowPath(wFinalX + BOX_W / 2, loserSemiY + BOX_H, wFinalX + BOX_W / 2, seventhY + BOX_H / 2)} />
        <Connector d={elbowPath(wFinalX + BOX_W / 2, seventhY + BOX_H / 2, centerX + BOX_W, seventhY + BOX_H / 2)} />

        <BracketBox x={eR1X} y={s1Y} seed={1} entry={east[0]} />
        <BracketBox x={eR1X} y={s4Y} seed={4} entry={east[3]} />
        <BracketBox x={eR1X} y={s2Y} seed={2} entry={east[1]} />
        <BracketBox x={eR1X} y={s3Y} seed={3} entry={east[2]} />
        <BracketBox x={eFinalX} y={finalY} entry="Winner, East final" />
        <BracketBox x={eFinalX} y={loserSemiY} entry="Loser, East semi" />

        <BracketBox x={wR1X} y={s1Y} seed={1} entry={west[0]} />
        <BracketBox x={wR1X} y={s4Y} seed={4} entry={west[3]} />
        <BracketBox x={wR1X} y={s2Y} seed={2} entry={west[1]} />
        <BracketBox x={wR1X} y={s3Y} seed={3} entry={west[2]} />
        <BracketBox x={wFinalX} y={finalY} entry="Winner, West final" />
        <BracketBox x={wFinalX} y={loserSemiY} entry="Loser, West semi" />

        <BracketBox x={centerX} y={finalY} entry={labels[0]} />
        <BracketBox x={centerX} y={thirdY} entry={labels[1]} />
        <BracketBox x={centerX} y={loserSemiY} entry={labels[2]} />
        <BracketBox x={centerX} y={seventhY} entry={labels[3]} highlight={fired ? "fired" : undefined} />
        {fired && (
          <text x={centerX + BOX_W / 2} y={seventhY + BOX_H + 16} textAnchor="middle" fontSize="10" fontWeight="700" fill={C.ember}>
            Toilet Bowl · Loser is FIRED
          </text>
        )}
      </svg>
    </div>
  );
}

// Full NFL-style bracket: 8 seeds per conference means 3 real rounds
// (Wild Card, Divisional, Conference Championship) instead of SWAC's 2, and
// because Round 1 has 4 games instead of 2, the losers' side becomes its
// own genuine mini-tournament (not a single flat placement game) before
// crossing conferences. Every round has exactly 4 games per conference —
// nothing is eliminated, everyone keeps playing toward a final rank.
function NFLBracket({ east, west, eastName, westName, rankLabels, fired }) {
  const pairs = BRACKET_PAIRS_R1; // [[1,8],[4,5],[3,6],[2,7]]
  const colGap = 44;
  const eR1X = 0;
  const eR2X = eR1X + BOX_W + colGap;
  const eR3X = eR2X + BOX_W + colGap;
  const centerX = eR3X + BOX_W + colGap;
  const wR3X = centerX + BOX_W + colGap;
  const wR2X = wR3X + BOX_W + colGap;
  const wR1X = wR2X + BOX_W + colGap;
  const width = wR1X + BOX_W;

  const gap = 8, gameGap = 40, semiGap = 80, gap3 = 90, bigGap = 140, dropGap = 70;

  // R1 (Week 14): 8 boxes in game order — seed1,8 (Ga) / seed4,5 (Gb) / seed3,6 (Gc) / seed2,7 (Gd)
  const y0 = 0, y1 = y0 + BOX_H + gap;
  const y2 = y1 + BOX_H + gameGap, y3 = y2 + BOX_H + gap;
  const y4 = y3 + BOX_H + semiGap, y5 = y4 + BOX_H + gap;
  const y6 = y5 + BOX_H + gameGap, y7 = y6 + BOX_H + gap;
  const r1Ys = [y0, y1, y2, y3, y4, y5, y6, y7];
  const gaMid = (y0 + y1) / 2 + BOX_H / 2;
  const gbMid = (y2 + y3) / 2 + BOX_H / 2;
  const gcMid = (y4 + y5) / 2 + BOX_H / 2;
  const gdMid = (y6 + y7) / 2 + BOX_H / 2;

  // R2 winners' path (Week 15): SemiA from Ga+Gb winners, SemiB from Gc+Gd winners
  const semiAY = (gaMid + gbMid) / 2 - BOX_H / 2;
  const semiBY = (gcMid + gdMid) / 2 - BOX_H / 2;
  // R3 winners' path (Week 16): Conference Championship (from Semi winners) + the
  // "conference runner-up" game (Semi losers), which is what actually feeds 3rd place
  const semiMidUpper = (semiAY + semiBY) / 2 + BOX_H / 2;
  const confChampY = semiMidUpper - BOX_H - gap3;
  const confMidY = semiMidUpper + gap3;

  // R2 losers' path (Week 15): the 4 Round-1 losers form their OWN 2 games —
  // positioned in a separate lower section since they share the same R1 boxes
  const lowerStart = Math.max(y7, confMidY) + bigGap;
  const lSemiAY = lowerStart;
  const lSemiBY = lSemiAY + BOX_H + gameGap;
  const semiMidLower = (lSemiAY + lSemiBY) / 2 + BOX_H / 2;
  const confLowerWY = semiMidLower - BOX_H - gap3;
  const confLowerLY = semiMidLower + gap3;

  const height = confLowerLY + BOX_H + dropGap + BOX_H;

  // Each R3 box's winner crosses conferences directly; its loser drops down
  // slightly then crosses too — same "direct + drop" idea as the SWAC bracket,
  // just done 4 times (Championship/3rd, 5th/7th, 9th/11th, 13th/15th).
  const crossY = [
    confChampY, confChampY + BOX_H + dropGap,
    confMidY, confMidY + BOX_H + dropGap,
    confLowerWY, confLowerWY + BOX_H + dropGap,
    confLowerLY, confLowerLY + BOX_H + dropGap,
  ];

  const seedBoxesFor = (teamRows, x) =>
    pairs.flatMap(([a, b], i) => [
      <BracketBox key={`${x}-${a}`} x={x} y={r1Ys[i * 2]} seed={a} entry={teamRows[a - 1]} />,
      <BracketBox key={`${x}-${b}`} x={x} y={r1Ys[i * 2 + 1]} seed={b} entry={teamRows[b - 1]} />,
    ]);

  // A Round-1 game's two seeds join at one point, then branch to its two
  // eventual destinations — the winner's slot and the loser's slot.
  const r1Connectors = (topY, botY, joinX, destWinX, destWinY, destLoseX, destLoseY) => {
    const mid = (topY + botY) / 2 + BOX_H / 2;
    return (
      <>
        <Connector d={`M ${joinX} ${topY + BOX_H / 2} L ${joinX} ${botY + BOX_H / 2}`} />
        <Connector d={elbowPath(joinX, mid, destWinX, destWinY + BOX_H / 2)} />
        <Connector d={elbowPath(joinX, mid, destLoseX, destLoseY + BOX_H / 2)} />
      </>
    );
  };
  // A single box (R2 or R3 slot) branches to its two next destinations.
  const boxConnectors = (srcX, srcY, destAX, destAY, destBX, destBY) => (
    <>
      <Connector d={elbowPath(srcX, srcY + BOX_H / 2, destAX, destAY + BOX_H / 2)} />
      <Connector d={elbowPath(srcX, srcY + BOX_H / 2, destBX, destBY + BOX_H / 2)} />
    </>
  );

  const oneSide = (teamRows, r1X, r2X, r3X, mirrored) => {
    const r1Out = mirrored ? r1X : r1X + BOX_W;
    const r2In = mirrored ? r2X + BOX_W : r2X;
    const r2Out = mirrored ? r2X : r2X + BOX_W;
    const r3In = mirrored ? r3X + BOX_W : r3X;
    const r3Out = mirrored ? r3X : r3X + BOX_W;
    const centerIn = mirrored ? centerX + BOX_W : centerX;
    return (
      <>
        {r1Connectors(y0, y1, r1Out, r2In, semiAY, r2In, lSemiAY)}
        {r1Connectors(y2, y3, r1Out, r2In, semiAY, r2In, lSemiAY)}
        {r1Connectors(y4, y5, r1Out, r2In, semiBY, r2In, lSemiBY)}
        {r1Connectors(y6, y7, r1Out, r2In, semiBY, r2In, lSemiBY)}
        {boxConnectors(r2Out, semiAY, r3In, confChampY, r3In, confMidY)}
        {boxConnectors(r2Out, semiBY, r3In, confChampY, r3In, confMidY)}
        {boxConnectors(r2Out, lSemiAY, r3In, confLowerWY, r3In, confLowerLY)}
        {boxConnectors(r2Out, lSemiBY, r3In, confLowerWY, r3In, confLowerLY)}
        {boxConnectors(r3Out, confChampY, centerIn, crossY[0], centerIn, crossY[1])}
        {boxConnectors(r3Out, confMidY, centerIn, crossY[2], centerIn, crossY[3])}
        {boxConnectors(r3Out, confLowerWY, centerIn, crossY[4], centerIn, crossY[5])}
        {boxConnectors(r3Out, confLowerLY, centerIn, crossY[6], centerIn, crossY[7])}
        {seedBoxesFor(teamRows, r1X)}
        <BracketBox x={r2X} y={semiAY} entry="Winner, Game 1" />
        <BracketBox x={r2X} y={semiBY} entry="Winner, Game 3" />
        <BracketBox x={r2X} y={lSemiAY} entry="Loser, Game 1" />
        <BracketBox x={r2X} y={lSemiBY} entry="Loser, Game 3" />
        <BracketBox x={r3X} y={confChampY} entry="Conference Champion" />
        <BracketBox x={r3X} y={confMidY} entry="Conference Runner-up" />
        <BracketBox x={r3X} y={confLowerWY} entry="Winner, Placement Semi" />
        <BracketBox x={r3X} y={confLowerLY} entry="Loser, Placement Semi" />
      </>
    );
  };

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" style={{ minWidth: `${width * 0.6}px`, height: "auto" }}>
        {oneSide(east, eR1X, eR2X, eR3X, false)}
        {oneSide(west, wR1X, wR2X, wR3X, true)}
        {rankLabels.map((label, i) => (
          <BracketBox key={label} x={centerX} y={crossY[i]} entry={label} highlight={fired && i === rankLabels.length - 1 ? "fired" : undefined} />
        ))}
        {fired && (
          <text x={centerX + BOX_W / 2} y={crossY[rankLabels.length - 1] + BOX_H + 16} textAnchor="middle" fontSize="10" fontWeight="700" fill={C.ember}>
            Toilet Bowl · Loser is FIRED
          </text>
        )}
      </svg>
      <div className="flex justify-between text-xs uppercase mt-1" style={{ color: C.slate }}>
        <span>{eastName}</span>
        <span>{westName}</span>
      </div>
    </div>
  );
}

// USFL/XFL's 10-team bracket: seeds 1-6 get a Week 14 bye, seeds 7-10 play
// a Week 14 play-in (7v10, 8v9) first. The play-in winners then fill the
// #7/#8 slots in a Round of 8 (Week 15), which cascades exactly like one
// side of the NFL bracket (winners AND losers both keep playing) — except
// since there's no second conference to cross with, each combining game
// directly decides its placement pair (Championship/3rd, 5th/7th), no
// extra "cross" step needed. The two Week 14 play-in LOSERS separately
// play each other for 9th place — the source PDF's notation for that game
// was ambiguous, so this is a stated assumption, not a certainty.
function USFLXFLBracket({ seeds, rankLabels, fired }) {
  const pairs = BRACKET_PAIRS_R1; // [[1,8],[4,5],[3,6],[2,7]] — "8"/"7" here are play-in winner slots
  const colGap = 44;
  const playInX = 0;
  const r1X = playInX + BOX_W + colGap;
  const r2X = r1X + BOX_W + colGap;
  const r3X = r2X + BOX_W + colGap;
  const width = r3X + BOX_W;

  const gap = 8, gameGap = 40, semiGap = 80, gap3 = 90;

  const y0 = 0, y1 = y0 + BOX_H + gap; // seed1, playin(8v9)-winner
  const y2 = y1 + BOX_H + gameGap, y3 = y2 + BOX_H + gap; // seed4, seed5
  const y4 = y3 + BOX_H + semiGap, y5 = y4 + BOX_H + gap; // seed3, seed6
  const y6 = y5 + BOX_H + gameGap, y7 = y6 + BOX_H + gap; // seed2, playin(7v10)-winner
  const r1Ys = [y0, y1, y2, y3, y4, y5, y6, y7];
  const gaMid = (y0 + y1) / 2 + BOX_H / 2;
  const gbMid = (y2 + y3) / 2 + BOX_H / 2;
  const gcMid = (y4 + y5) / 2 + BOX_H / 2;
  const gdMid = (y6 + y7) / 2 + BOX_H / 2;

  const semiAY = (gaMid + gbMid) / 2 - BOX_H / 2;
  const semiBY = (gcMid + gdMid) / 2 - BOX_H / 2;
  const semiMidUpper = (semiAY + semiBY) / 2 + BOX_H / 2;
  const champY = semiMidUpper - BOX_H - gap3;
  const thirdY = semiMidUpper + gap3;

  const lowerStart = Math.max(y7, thirdY) + 120;
  const lSemiAY = lowerStart;
  const lSemiBY = lSemiAY + BOX_H + gameGap;
  const semiMidLower = (lSemiAY + lSemiBY) / 2 + BOX_H / 2;
  const fifthY = semiMidLower - BOX_H - gap3;
  const seventhY = semiMidLower + gap3;

  // Play-in games, positioned to align roughly with the Round-of-8 slots
  // they feed into, plus the separate 9th-place game from the two losers.
  const playinAY = y1; // feeds "seed 8" slot — loser goes toward 9th place
  const playinBY = y7; // feeds "seed 7" slot — loser goes toward 9th place
  const ninthY = seventhY + BOX_H + 120;

  const height = ninthY + BOX_H;

  const r1Connectors = (topY, botY, joinX, destX, destWinY, destLoseY) => {
    const mid = (topY + botY) / 2 + BOX_H / 2;
    return (
      <>
        <Connector d={`M ${joinX} ${topY + BOX_H / 2} L ${joinX} ${botY + BOX_H / 2}`} />
        <Connector d={elbowPath(joinX, mid, destX, destWinY + BOX_H / 2)} />
        <Connector d={elbowPath(joinX, mid, destX, destLoseY + BOX_H / 2)} />
      </>
    );
  };
  const boxConnectors = (srcX, srcY, destX, destWinY, destLoseY) => (
    <>
      <Connector d={elbowPath(srcX, srcY + BOX_H / 2, destX, destWinY + BOX_H / 2)} />
      <Connector d={elbowPath(srcX, srcY + BOX_H / 2, destX, destLoseY + BOX_H / 2)} />
    </>
  );

  const roundOf8 = [
    seeds[0], "Winner, #8 vs #9",
    seeds[3], seeds[4],
    seeds[2], seeds[5],
    seeds[1], "Winner, #7 vs #10",
  ];

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" style={{ minWidth: `${width * 0.72}px`, height: "auto" }}>
        {/* play-in (Week 14) */}
        <Connector d={`M ${playInX + BOX_W} ${playinAY + BOX_H / 2} L ${r1X} ${y1 + BOX_H / 2}`} />
        <Connector d={`M ${playInX + BOX_W} ${playinBY + BOX_H / 2} L ${r1X} ${y7 + BOX_H / 2}`} />
        <BracketBox x={playInX} y={playinAY} seed={8} entry={seeds[7]} />
        <BracketBox x={playInX} y={playinAY + BOX_H + gap} seed={9} entry={seeds[8]} />
        <BracketBox x={playInX} y={playinBY} seed={7} entry={seeds[6]} />
        <BracketBox x={playInX} y={playinBY + BOX_H + gap} seed={10} entry={seeds[9]} />
        {/* the two play-in losers cross for 9th place */}
        <Connector d={elbowPath(playInX + BOX_W, playinAY + BOX_H + gap + BOX_H / 2, r3X, ninthY + BOX_H / 2)} />
        <Connector d={elbowPath(playInX + BOX_W, playinBY + BOX_H + gap + BOX_H / 2, r3X, ninthY + BOX_H / 2)} />
        <BracketBox x={r3X} y={ninthY} entry={rankLabels[4]} highlight={fired ? "fired" : undefined} />

        {/* Round of 8 (Week 15) -> Semis/Loser-semis (Week 16) */}
        {r1Connectors(y0, y1, r1X + BOX_W, r2X, semiAY, lSemiAY)}
        {r1Connectors(y2, y3, r1X + BOX_W, r2X, semiAY, lSemiAY)}
        {r1Connectors(y4, y5, r1X + BOX_W, r2X, semiBY, lSemiBY)}
        {r1Connectors(y6, y7, r1X + BOX_W, r2X, semiBY, lSemiBY)}
        {pairs.map(([a, b], i) => (
          <g key={i}>
            <BracketBox x={r1X} y={r1Ys[i * 2]} entry={roundOf8[i * 2]} />
            <BracketBox x={r1X} y={r1Ys[i * 2 + 1]} entry={roundOf8[i * 2 + 1]} />
          </g>
        ))}

        {/* Semis/Loser-semis -> Final placements (Week 17) */}
        {boxConnectors(r2X + BOX_W, semiAY, r3X, champY, thirdY)}
        {boxConnectors(r2X + BOX_W, semiBY, r3X, champY, thirdY)}
        {boxConnectors(r2X + BOX_W, lSemiAY, r3X, fifthY, seventhY)}
        {boxConnectors(r2X + BOX_W, lSemiBY, r3X, fifthY, seventhY)}
        <BracketBox x={r2X} y={semiAY} entry="Winner, Game 1" />
        <BracketBox x={r2X} y={semiBY} entry="Winner, Game 3" />
        <BracketBox x={r2X} y={lSemiAY} entry="Loser, Game 1" />
        <BracketBox x={r2X} y={lSemiBY} entry="Loser, Game 3" />

        <BracketBox x={r3X} y={champY} entry={rankLabels[0]} />
        <BracketBox x={r3X} y={thirdY} entry={rankLabels[1]} />
        <BracketBox x={r3X} y={fifthY} entry={rankLabels[2]} />
        <BracketBox x={r3X} y={seventhY} entry={rankLabels[3]} />
      </svg>
      <p className="text-xs mt-1" style={{ color: C.slate }}>
        {rankLabels[4]} is unique to this format: the two Week 14 play-in losers play three straight weeks (Gm 1/3, 2/3, 3/3),
        and whoever's combined score across all three is higher takes it.
      </p>
      {fired && <p className="text-xs mt-1" style={{ color: C.ember }}>{rankLabels[4]} loser is fired.</p>}
    </div>
  );
}

// SEC/Big 12/ACC/Big Ten: a clean 8-seed field, no conferences and no
// play-in — but everyone still plays through Week 17, same cascade as one
// side of the USFL/XFL bracket, just without that Week 14 layer.
function SingleBracket8({ seeds, rankLabels, fired }) {
  const colGap = 44;
  const leftR1X = 0;
  const leftR2X = leftR1X + BOX_W + colGap;
  const centerX = leftR2X + BOX_W + colGap;
  const rightR2X = centerX + BOX_W + colGap;
  const rightR1X = rightR2X + BOX_W + colGap;
  const width = rightR1X + BOX_W;

  const gap = 8, gameGap = 40, gap3 = 90, sectionGap = 120;

  const y0 = 0, y1 = y0 + BOX_H + gap;
  const y2 = y1 + BOX_H + gameGap, y3 = y2 + BOX_H + gap;
  const gaMid = (y0 + y1) / 2 + BOX_H / 2;
  const gbMid = (y2 + y3) / 2 + BOX_H / 2;
  const semiY = (gaMid + gbMid) / 2 - BOX_H / 2;

  const champY = semiY;
  const thirdY = semiY + BOX_H + gap3;
  const lSemiY = thirdY + BOX_H + sectionGap;
  const fifthY = lSemiY;
  const seventhY = lSemiY + BOX_H + gap3;

  const height = seventhY + BOX_H;

  const r1Connectors = (topY, botY, joinX, destX, destWinY, destLoseY) => {
    const mid = (topY + botY) / 2 + BOX_H / 2;
    return (
      <>
        <Connector d={`M ${joinX} ${topY + BOX_H / 2} L ${joinX} ${botY + BOX_H / 2}`} />
        <Connector d={elbowPath(joinX, mid, destX, destWinY + BOX_H / 2)} />
        <Connector d={elbowPath(joinX, mid, destX, destLoseY + BOX_H / 2)} />
      </>
    );
  };
  const boxConnectors = (srcX, srcY, destX, destWinY, destLoseY) => (
    <>
      <Connector d={elbowPath(srcX, srcY + BOX_H / 2, destX, destWinY + BOX_H / 2)} />
      <Connector d={elbowPath(srcX, srcY + BOX_H / 2, destX, destLoseY + BOX_H / 2)} />
    </>
  );

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" style={{ minWidth: `${width * 0.68}px`, height: "auto" }}>
        {/* left half: seed1v8, seed4v5 — reads left to right */}
        {r1Connectors(y0, y1, leftR1X + BOX_W, leftR2X, semiY, lSemiY)}
        {r1Connectors(y2, y3, leftR1X + BOX_W, leftR2X, semiY, lSemiY)}
        <BracketBox x={leftR1X} y={y0} seed={1} entry={seeds[0]} />
        <BracketBox x={leftR1X} y={y1} seed={8} entry={seeds[7]} />
        <BracketBox x={leftR1X} y={y2} seed={4} entry={seeds[3]} />
        <BracketBox x={leftR1X} y={y3} seed={5} entry={seeds[4]} />
        {boxConnectors(leftR2X + BOX_W, semiY, centerX, champY, thirdY)}
        {boxConnectors(leftR2X + BOX_W, lSemiY, centerX, fifthY, seventhY)}
        <BracketBox x={leftR2X} y={semiY} entry="Winner, Game 1" />
        <BracketBox x={leftR2X} y={lSemiY} entry="Loser, Game 1" />

        {/* right half: seed3v6, seed2v7 — reads right to left, mirrored */}
        {r1Connectors(y0, y1, rightR1X, rightR2X + BOX_W, semiY, lSemiY)}
        {r1Connectors(y2, y3, rightR1X, rightR2X + BOX_W, semiY, lSemiY)}
        <BracketBox x={rightR1X} y={y0} seed={3} entry={seeds[2]} />
        <BracketBox x={rightR1X} y={y1} seed={6} entry={seeds[5]} />
        <BracketBox x={rightR1X} y={y2} seed={2} entry={seeds[1]} />
        <BracketBox x={rightR1X} y={y3} seed={7} entry={seeds[6]} />
        {boxConnectors(rightR2X, semiY, centerX + BOX_W, champY, thirdY)}
        {boxConnectors(rightR2X, lSemiY, centerX + BOX_W, fifthY, seventhY)}
        <BracketBox x={rightR2X} y={semiY} entry="Winner, Game 3" />
        <BracketBox x={rightR2X} y={lSemiY} entry="Loser, Game 3" />

        {/* center: where both halves cross for the final placements */}
        <BracketBox x={centerX} y={champY} entry={rankLabels[0]} />
        <BracketBox x={centerX} y={thirdY} entry={rankLabels[1]} />
        <BracketBox x={centerX} y={fifthY} entry={rankLabels[2]} />
        <BracketBox x={centerX} y={seventhY} entry={rankLabels[3]} highlight={fired ? "fired" : undefined} />
      </svg>
    </div>
  );
}

export default function App() {
  const [mode, setMode] = useState("loading");
  const [view, setView] = useState("home");
  const [tierKey, setTierKey] = useState("NFL");
  const [dirQuery, setDirQuery] = useState("");
  const [club300Query, setClub300Query] = useState("");
  const [openRuleSections, setOpenRuleSections] = useState({ general: true });
  const [selectedCoach, setSelectedCoach] = useState(null);
  const [selectedTeam, setSelectedTeam] = useState(null);
  const [draftDataCache, setDraftDataCache] = useState({});
  const [draftDataLoading, setDraftDataLoading] = useState({});
  const [nflState, setNflState] = useState(null);
  const [leagueMap, setLeagueMap] = useState(LEAGUE_HISTORY[CURRENT_SEASON]);
  const [standingsSeason, setStandingsSeason] = useState(CURRENT_SEASON);
  const [standingsCache, setStandingsCache] = useState({});
  const [matchupsCache, setMatchupsCache] = useState({});
  // Sleeper's own bracket data (real round-by-round winner/loser), keyed by
  // league ID — separate from standingsCache because it comes from a
  // different pair of endpoints and isn't always present (see loadBracketResults).
  const [bracketResultsCache, setBracketResultsCache] = useState({});
  const [tierLoading, setTierLoading] = useState(false);

  // Weekly Awards — one weeklyResultsCache entry per {tierKey, year, week}
  // (see getWeeklyResultCached below), and club300Live holds the auto-
  // detected 300+ games that get merged with the static CLUB_300 list for
  // display. weeklyAwardsWeek defaults to nflState's current week once that
  // resolves (see the effect near the initial load below).
  const [weeklyResultsCache, setWeeklyResultsCache] = useState({});
  const [club300Live, setClub300Live] = useState([]);
  const [weeklyAwardsSeason, setWeeklyAwardsSeason] = useState(CURRENT_SEASON);
  const [weeklyAwardsWeek, setWeeklyAwardsWeek] = useState(null);
  const [weeklyAwardsLoading, setWeeklyAwardsLoading] = useState(false);
  // Flattened {tierKey, a, b} pairs across all 13 tiers for the selected
  // week — what weeklyAwards (below) crowns a winner from.
  const [weeklyAwardsPairs, setWeeklyAwardsPairs] = useState([]);

  // TOURNAMENT — this year's frozen 20-seed snapshot (null until it's been
  // read from Firestore, or written for the first time once Week 8 starts),
  // and the per-(week, rosterId) score cache used to resolve games as real
  // weeks complete. Scoped to CURRENT_SEASON only — a past year's tournament
  // isn't browsable the way Standings' season picker is, since it was a
  // one-off live event, not a stored historical bracket.
  const [tourneySeeds, setTourneySeedsState] = useState(null);
  const [tourneySeedsChecked, setTourneySeedsChecked] = useState(false);
  const [tourneyScores, setTourneyScores] = useState({});

  const [news, setNews] = useState(SEED_NEWS);
  const [chat, setChat] = useState([]);
  const [coachName, setCoachName] = useState(getCoachName());
  const [nameInput, setNameInput] = useState("");
  const [msgInput, setMsgInput] = useState("");
  const [commish, setCommish] = useState(false);
  const [newsTitle, setNewsTitle] = useState("");
  const [newsBody, setNewsBody] = useState("");
  const [newsTag, setNewsTag] = useState("NEWS");
  const [applications, setApplications] = useState([]);
  const [promotionWindowOpen, setPromotionWindowOpen] = useState(false);
  const chatEndRef = useRef(null);
  const bulkLoadedRef = useRef(false);
  const [coachTagsByRosterKey, setCoachTagsByRosterKey] = useState({});
  const [sheetRosterLinks, setSheetRosterLinks] = useState({});
  const [liveCoachStats, setLiveCoachStats] = useState({});
  const [sheetTeamNames, setSheetTeamNames] = useState({});

  // Auth — undefined currentUser means "still checking", not "logged out",
  // so the loading screen and the landing page never flash into each other.
  const [currentUser, setCurrentUser] = useState(undefined);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    const unsub = onAuthChange((profile) => {
      setCurrentUser(profile);
      setAuthReady(true);
    });
    return unsub;
  }, []);

  // Age gate — sessionStorage so it re-asks each browser session, same
  // pattern AgeGate.jsx itself uses to record a pass.
  const [gatePassed, setGatePassed] = useState(() => sessionStorage.getItem("pfa_gate_passed") === "1");

  // 2FA — this is a UI-level gate only. Firebase itself already considers
  // the person signed in the instant loginUser() resolves (that's a
  // separate listener from this component's own render), so this can't be
  // enforced at the data layer without a Cloud Function issuing custom
  // claims — flagged to Lainey as a known limitation, not fixed here.
  // Verified once per browser session per uid, mirroring the age gate.
  const [twoFAVerified, setTwoFAVerified] = useState(false);
  useEffect(() => {
    if (currentUser?.twoFAEnabled) {
      setTwoFAVerified(sessionStorage.getItem(`pfa_2fa_ok_${currentUser.uid}`) === "1");
    } else {
      setTwoFAVerified(false);
    }
  }, [currentUser?.uid, currentUser?.twoFAEnabled]);

  const [twoFACode, setTwoFACode] = useState("");
  const [twoFAGateError, setTwoFAGateError] = useState("");

  function verifyTwoFAGate() {
    setTwoFAGateError("");
    const valid = authenticator.verify({ token: twoFACode.replace(/\s/g, ""), secret: currentUser.twoFASecret });
    if (!valid) {
      setTwoFAGateError("Invalid code. Please try again.");
      return;
    }
    sessionStorage.setItem(`pfa_2fa_ok_${currentUser.uid}`, "1");
    setTwoFAVerified(true);
    setTwoFACode("");
  }

  // Passed to SettingsPanel — if 2FA was just turned ON in this same
  // authenticated session, the person already proved code possession to
  // get there, so don't immediately re-demand it via the gate above.
  function handleProfileUpdate(updated) {
    if (updated.twoFAEnabled && !currentUser?.twoFAEnabled) {
      sessionStorage.setItem(`pfa_2fa_ok_${updated.uid}`, "1");
      setTwoFAVerified(true);
    }
    if (updated.twoFAEnabled === false) {
      sessionStorage.removeItem(`pfa_2fa_ok_${updated.uid}`);
    }
    setCurrentUser(updated);
  }

  function handleAccountDeleted() {
    setView("home");
    // currentUser will flip to null on its own once onAuthChange's listener
    // observes the deletion — no need to set it here.
  }

  const j = (url) => fetch(url).then((r) => (r.ok ? r.json() : Promise.reject(new Error(url))));

  // buildStandings is only ever called from inside loadLeague, which is
  // wrapped in useCallback([]) below (frozen once at mount, on purpose — it
  // shouldn't refetch every league every time some unrelated state changes).
  // The bug: buildStandings used to read coachTagsByRosterKey/sheetTeamNames
  // directly, which meant it permanently saw the {} they held on that first
  // render — not a timing race, a hard freeze, since useCallback([]) never
  // re-runs its factory. These refs stay in sync with the real state via the
  // effects right below, and .current is read live at CALL time regardless
  // of when the enclosing closure was created — refs, unlike the state
  // values themselves, aren't captured-by-value at closure creation.
  const coachTagsByRosterKeyRef = useRef({});
  const sheetTeamNamesRef = useRef({});
  useEffect(() => {
    coachTagsByRosterKeyRef.current = coachTagsByRosterKey;
  }, [coachTagsByRosterKey]);
  useEffect(() => {
    sheetTeamNamesRef.current = sheetTeamNames;
  }, [sheetTeamNames]);

  // Same ref-mirror pattern as the two above, same reason: getWeeklyResultCached
  // is a useCallback([]) below (frozen once, so it doesn't reconstruct — and
  // therefore doesn't re-trigger every effect that calls it — on every cache
  // update) but still needs to read the LATEST cache to avoid re-fetching a
  // week that only just landed.
  const weeklyResultsCacheRef = useRef({});
  useEffect(() => {
    weeklyResultsCacheRef.current = weeklyResultsCache;
  }, [weeklyResultsCache]);

  // Live sheet feed — fetched once on load, parsed once for both the
  // coach-tag map and the roster-link fallback map (same rows, one fetch).
  // Failure just leaves all three maps empty: coach names fall back to
  // Sleeper's raw name, roster links fall back further to the static
  // ROSTER_LINKS table below, and Promotion Score/Season CP just render "—"
  // on the Coaches tab (unchanged from before this feed existed either way).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(COACH_SHEET_CSV_URL);
        if (!res.ok) {
          // Was previously a silent `return;` with zero console output — a
          // real blind spot (a bad status here looked identical to a
          // network-level failure from the outside). Kept permanently now
          // that it's fixed, not just for this investigation.
          console.warn("PFA live feed failed: Master_Coaches sheet returned a non-OK response.", res.status, res.statusText);
          return;
        }
        const text = await res.text();
        if (cancelled) return;
        const { tagByRosterKey, rosterLinkByTeamName, liveStatsByName, teamNameByRosterKey } = parseSheetLookups(text);
        setCoachTagsByRosterKey(tagByRosterKey);
        setSheetRosterLinks(rosterLinkByTeamName);
        setLiveCoachStats(liveStatsByName);
        setSheetTeamNames(teamNameByRosterKey);
      } catch (e) {
        // Sheet unreachable — Directory/Coaches/roster links proceed on
        // their non-sheet fallbacks, same as before this feed existed.
        // Logged (not surfaced to her) so a dev-tools check can tell this
        // feed apart from the League Difficulty one below. Most likely
        // cause if this fires: the browser blocked the request (CORS) —
        // the published-CSV link still works if opened directly.
        console.warn("PFA live feed failed: coach tags / roster links (Master_Coaches sheet).", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Self-heals already-cached standings once the sheet feed arrives.
  // CONFIRMED 2026-08-05 via the debug logs above: the sheet fetch DOES
  // succeed (183 team names, 188 tags parsed), it just consistently
  // resolves after Sleeper's users+rosters calls already finished and
  // buildStandings already cached "—" for every open roster — every
  // tier, every time, not intermittent. The refs above fix this for any
  // FUTURE buildStandings call, but standingsCache is only ever computed
  // ONCE per leagueId (guarded by `!standingsCache[id]`), so anything
  // already cached before the sheet arrived stays wrong forever without
  // this. Deliberately NOT fixed by delaying Sleeper's load until the
  // sheet resolves — that would slow down the whole site's initial load
  // for the sake of a handful of vacant rosters. Patch in place instead.
  useEffect(() => {
    if (Object.keys(sheetTeamNames).length === 0 && Object.keys(coachTagsByRosterKey).length === 0) return;
    setStandingsCache((cache) => {
      let changed = false;
      const next = { ...cache };
      Object.entries(leagueMap).forEach(([tKey, id]) => {
        const rows = next[id];
        if (!rows) return;
        let rowsChanged = false;
        const patchedRows = rows.map((r) => {
          const sheetKey = `${tKey}:${r.rosterId}`;
          const betterTeam = r.team === "—" ? sheetTeamNames[sheetKey] : null;
          const betterCoach = r.coach === "—" ? coachTagsByRosterKey[sheetKey] : null;
          if (!betterTeam && !betterCoach) return r;
          rowsChanged = true;
          return { ...r, ...(betterTeam ? { team: betterTeam } : {}), ...(betterCoach ? { coach: betterCoach } : {}) };
        });
        if (rowsChanged) {
          next[id] = patchedRows;
          changed = true;
        }
      });
      return changed ? next : cache;
    });
  }, [sheetTeamNames, coachTagsByRosterKey, leagueMap]);

  // `tierKeyArg` (added 2026-08-04 alongside the roster-link bug fix) keys
  // both sheet lookups below — see parseSheetLookups' comment for why tier
  // beats leagueId as a key. Every caller of buildStandings now supplies it.
  // `isCurrentSeason` (added 2026-08-06, same bug class as that roster-link
  // fix): the live coach-tag sheet only ever reflects who's coaching each
  // roster slot RIGHT NOW — it has no concept of past seasons. Applying it
  // to a historical league's rows silently swapped in today's coach for
  // that tier+roster-id seat, even though the team/points shown were
  // correctly that season's own — exactly what she caught in the Weekly
  // Awards screenshots. For any non-current season, skip the tag and fall
  // straight to Sleeper's own `display_name` for that historical roster.
  const buildStandings = (users, rosters, leagueId, tierKeyArg, isCurrentSeason = true) => {
    const byOwner = {};
    users.forEach((u) => (byOwner[u.user_id] = u));
    const rows = rosters.map((r) => {
      const u = byOwner[r.owner_id] || {};
      const s = r.settings || {};
      const sheetKey = tierKeyArg ? `${tierKeyArg}:${r.roster_id}` : null;
      const tagged = isCurrentSeason && sheetKey ? coachTagsByRosterKeyRef.current[sheetKey] : null;
      return {
        coach: tagged || u.display_name || "—",
        // Sheet-derived team name is a fallback for an UNOWNED roster only
        // (Sleeper has no team name to give us there at all) — a real
        // owner's own `metadata.team_name`/`display_name` always wins first.
        // Same current-season guard as `coach` above, and for the same
        // reason: an unowned CURRENT roster can fall back to the sheet's
        // team name, but a past season's unowned roster has no such thing
        // to fall back to (the sheet doesn't know about past seasons).
        team:
          (u.metadata && u.metadata.team_name) ||
          u.display_name ||
          (isCurrentSeason && sheetKey && sheetTeamNamesRef.current[sheetKey]) ||
          "—",
        w: s.wins || 0,
        l: s.losses || 0,
        pts: (s.fpts || 0) + (s.fpts_decimal || 0) / 100,
        maxPts: (s.ppts || 0) + (s.ppts_decimal || 0) / 100,
        rosterId: r.roster_id,
        userId: u.user_id || null,
        avatar: u.avatar || null,
        playerIds: r.players || [],
        division: (r.settings && r.settings.division) || null,
      };
    });
    rows.sort((a, b) => b.w - a.w || b.pts - a.pts);
    return rows.map((r, i) => ({ ...r, place: i + 1 }));
  };

  // Pure pairs-builder, factored out of loadLeague so the Weekly Awards lazy
  // fetch (getWeeklyResultCached, below) can build the exact same shape from
  // its own matchup fetch without duplicating this logic. Adds `points`
  // (alias of the existing `live` field, for callers that don't care about
  // the "still updating" connotation) and `benchPoints` on each side.
  const buildPairsWithBench = (m, rows) => {
    const byMatch = {};
    m.forEach((t) => {
      if (!t.matchup_id) return;
      (byMatch[t.matchup_id] = byMatch[t.matchup_id] || []).push(t);
    });
    const nameByRoster = {};
    rows.forEach((r) => (nameByRoster[r.rosterId] = r));
    const side = (t) => ({
      ...nameByRoster[t.roster_id],
      live: t.points || 0,
      points: t.points || 0,
      benchPoints: benchPointsFor(t),
    });
    return Object.values(byMatch)
      .filter((p) => p.length === 2)
      .map(([a, b]) => ({ a: side(a), b: side(b) }));
  };

  // 300 Club auto-detection, shared by loadLeague's current-week fetch AND
  // the Weekly Awards lazy fetch — one detection pass feeds both features.
  // Safe to call repeatedly on the SAME league-week (e.g. once live mid-week
  // via loadLeague, again later once the week is final): the Firestore doc
  // ID is deterministic per {tier,year,week,roster}, so a later call with a
  // higher final score just overwrites the earlier partial one, never
  // duplicates an entry.
  const detect300 = (pairs, tierKeyArg, year, week) => {
    pairs.forEach(({ a, b }) => {
      [a, b].forEach((s) => {
        if (s.points >= 300 && s.rosterId != null) {
          const entry = { coach: s.coach || "—", team: s.team || "—", conf: tierKeyArg, pts: s.points, week, year };
          addClub300Entry(tierKeyArg, year, week, s.rosterId, entry).then((local) => {
            if (local) setClub300Live(local);
          });
        }
      });
    });
  };

  const loadLeague = useCallback(async (leagueId, week, tKey, isCurrentSeason = true) => {
    const [users, rosters] = await Promise.all([
      j(`${SLEEPER}/league/${leagueId}/users`),
      j(`${SLEEPER}/league/${leagueId}/rosters`),
    ]);
    const rows = buildStandings(users, rosters, leagueId, tKey, isCurrentSeason);
    setStandingsCache((c) => ({ ...c, [leagueId]: rows }));
    if (week) {
      try {
        const m = await j(`${SLEEPER}/league/${leagueId}/matchups/${week}`);
        const pairs = buildPairsWithBench(m, rows);
        setMatchupsCache((c) => ({ ...c, [leagueId]: pairs }));
        // Current-week scores are still moving, so this never writes to the
        // permanent weeklyResults Firestore cache (that's the Weekly Awards
        // lazy fetch's job, and only once a week is confirmed final) — just
        // the 300 Club check, which is safe to re-run on partial data.
        detect300(pairs, tKey, CURRENT_SEASON, week);
      } catch (e) {}
    }
  }, []);

  // Lazy, cache-first fetch for one tier's one week — the Weekly Awards tab
  // calls this once per tier (up to 13 calls) whenever the selected
  // season/week changes. A COMPLETED week (any past season, or a past week
  // of the current season) is permanently cached in Firestore since its
  // numbers never change once the games are over — every visit after the
  // first reads that cached copy instead of re-hitting Sleeper. The CURRENT
  // in-progress week is deliberately never written to that permanent cache:
  // its numbers are still moving, so every visit re-fetches fresh rather
  // than freezing a partial score as if it were final. Either way, the
  // in-memory weeklyResultsCache still short-circuits repeat calls within
  // the same visit.
  const getWeeklyResultCached = useCallback(
    async (tierKeyArg, leagueId, year, week) => {
      const cacheKey = `${tierKeyArg}_${year}_${week}`;
      if (weeklyResultsCacheRef.current[cacheKey]) return weeklyResultsCacheRef.current[cacheKey];

      const isCompleted = year < CURRENT_SEASON || (year === CURRENT_SEASON && nflState && week < nflState.week);

      if (isCompleted) {
        try {
          const stored = await getWeeklyResult(tierKeyArg, year, week);
          if (stored) {
            setWeeklyResultsCache((c) => ({ ...c, [cacheKey]: stored }));
            return stored;
          }
        } catch (e) {}
      }

      try {
        const [users, rosters] = await Promise.all([
          j(`${SLEEPER}/league/${leagueId}/users`),
          j(`${SLEEPER}/league/${leagueId}/rosters`),
        ]);
        const rows = buildStandings(users, rosters, leagueId, tierKeyArg, year === CURRENT_SEASON);
        const m = await j(`${SLEEPER}/league/${leagueId}/matchups/${week}`);
        const pairs = buildPairsWithBench(m, rows);
        // Only auto-detect for the CURRENT season. Every past season is
        // already fully covered by the hand-typed CLUB_300 array, so
        // re-running this on a historical week (which happens any time
        // Weekly Awards browses a past season/week) was writing a SECOND,
        // separate club300Live entry for a game already recorded — a real
        // duplicate-causing bug found from her screenshots 2026-08-07, not
        // a hypothetical. The historical coach name from a past-season fetch
        // is also unreliable anyway (buildStandings intentionally skips the
        // sheet-tag override for non-current seasons), so there's no
        // upside to detecting here even setting the duplication aside.
        if (year === CURRENT_SEASON) detect300(pairs, tierKeyArg, year, week);
        const result = { tierKey: tierKeyArg, year, week, pairs };
        setWeeklyResultsCache((c) => ({ ...c, [cacheKey]: result }));
        if (isCompleted) setWeeklyResult(tierKeyArg, year, week, result).catch(() => {});
        return result;
      } catch (e) {
        return null;
      }
    },
    [nflState]
  );

  // Sleeper's own playoff bracket — this is the actual round-by-round
  // winner/loser data (roster IDs, not just seeding), separate from the
  // standings fetch above. Whether this lines up cleanly with our custom
  // full-cascade-to-last-place format is untested against real data as of
  // this write — see the note where this is consumed in computeBracket.
  const loadBracketResults = useCallback(async (leagueId) => {
    try {
      const [winners, losers] = await Promise.all([
        j(`${SLEEPER}/league/${leagueId}/winners_bracket`),
        j(`${SLEEPER}/league/${leagueId}/losers_bracket`),
      ]);
      setBracketResultsCache((c) => ({ ...c, [leagueId]: { winners: winners || [], losers: losers || [] } }));
      // TEMPORARY — remove once we've confirmed this data looks right. Open
      // the browser console on the Standings page to check what Sleeper
      // actually has for a given league before the real-results rendering
      // gets wired in.
      console.log(`[bracket check] league ${leagueId}:`, { winners, losers });
    } catch (e) {
      setBracketResultsCache((c) => ({ ...c, [leagueId]: { winners: [], losers: [] } }));
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
        await loadLeague(NFL_LEAGUE_ID, st.week || 1, "NFL");
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
            if (!cancelled) setLeagueMap((prev) => ({ ...map, ...prev }));
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

  // real-time chat + news + applications + promotion window subscriptions
  useEffect(() => {
    const unsubChat = watchChat((msgs) => setChat(msgs));
    const unsubNews = watchNews((items) => {
      if (items && items.length) setNews(items);
    });
    const unsubApps = watchApplications((apps) => setApplications(apps));
    const unsubPromo = watchPromotionWindow((open) => setPromotionWindowOpen(open));
    const unsubClub300 = watchClub300Live((entries) => setClub300Live(entries));
    return () => {
      unsubChat();
      unsubNews();
      unsubApps();
      unsubPromo();
      unsubClub300();
    };
  }, []);

  useEffect(() => {
    if (chatEndRef.current) chatEndRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [chat.length]);

  useEffect(() => {
    const seasonMap = standingsSeason === CURRENT_SEASON ? leagueMap : LEAGUE_HISTORY[standingsSeason] || {};
    const id = seasonMap[tierKey];
    if (mode === "live" && id && !standingsCache[id]) {
      setTierLoading(true);
      // Only fetch live week-by-week matchups for the current season — a
      // past season's league is already finished, so there's no "this week"
      // to show; just pull its final standings.
      const week = standingsSeason === CURRENT_SEASON ? nflState && nflState.week : undefined;
      loadLeague(id, week, tierKey, standingsSeason === CURRENT_SEASON).finally(() => setTierLoading(false));
    }
  }, [tierKey, mode, standingsSeason, leagueMap, standingsCache, loadLeague, nflState]);

  // once discovery has filled in leagueMap, fetch standings for every connected
  // league (not just the one being viewed) so the homepage Hot Seat report can
  // show a last-place coach from all 13 tiers, not just whichever is selected
  useEffect(() => {
    if (mode !== "live" || bulkLoadedRef.current) return;
    if (Object.keys(leagueMap).length <= 1) return;
    bulkLoadedRef.current = true;
    Object.entries(leagueMap).forEach(([tKey, id]) => {
      if (id && !standingsCache[id]) loadLeague(id, undefined, tKey);
    });
  }, [mode, leagueMap, standingsCache, loadLeague]);

  // TOURNAMENT — seeds lock in ONCE at the Week7->Week8 rollover, so this
  // reads any existing frozen snapshot from Firestore first; only if none
  // exists yet AND Week 8 has actually started does it compute one from
  // current standings and write it. Gated on view === "tournament" (not
  // bulk discovery's every-page-load pattern) since freezing only needs to
  // happen once all season and isn't needed for anyone who never opens the
  // tab — same reasoning as the weeklyAwards fetch below. A slight race if
  // two people load the tab in the same moment right as Week 8 begins is
  // fine and self-resolves: whoever's browser computes it writes the same
  // deterministic list from the same standings, same relaxed-consistency
  // approach already used for weeklyResults/club300Live.
  useEffect(() => {
    if (view !== "tournament" || mode !== "live" || tourneySeedsChecked) return;
    let cancelled = false;
    (async () => {
      try {
        const stored = await getTournamentSeeds(CURRENT_SEASON);
        if (cancelled) return;
        if (stored && stored.length === 20) {
          setTourneySeedsState(stored);
          setTourneySeedsChecked(true);
          return;
        }
      } catch (e) {}
      if (nflState && nflState.week >= 8 && Object.keys(leagueMap).length >= 13) {
        const computed = computeTourneySeeds(standingsCache, leagueMap);
        if (computed.length === 20) {
          setTourneySeedsState(computed);
          setTourneySeedsChecked(true);
          setTournamentSeeds(CURRENT_SEASON, computed).catch(() => {});
          return;
        }
      }
      // Not ready yet (before Week 8, or standings still loading) — leave
      // tourneySeedsChecked false so this retries on the next relevant
      // render instead of getting stuck believing there's nothing to show.
    })();
    return () => { cancelled = true; };
  }, [view, mode, tourneySeedsChecked, nflState, leagueMap, standingsCache]);

  // Once seeds are frozen, resolve as much of the bracket as real results
  // allow — one round at a time, since which tiers matter for Week 9+
  // depends on WHO won the previous round, not just which week it is.
  // Refetches (cheaply, via getWeeklyResultCached's own cache) whenever the
  // live week advances while she's on the tab.
  useEffect(() => {
    if (view !== "tournament" || !tourneySeeds || !nflState) return;
    let cancelled = false;
    (async () => {
      const scores = {};
      const fetchTeamsWeek = async (teams, week) => {
        const tiers = [...new Set(teams.filter(Boolean).map((t) => t.tierKey))];
        const weekMap = {};
        await Promise.all(tiers.map(async (tierKey) => {
          const leagueId = leagueMap[tierKey];
          if (!leagueId) return;
          const result = await getWeeklyResultCached(tierKey, leagueId, CURRENT_SEASON, week).catch(() => null);
          if (!result) return;
          result.pairs.forEach(({ a, b }) => { weekMap[a.rosterId] = a.points; weekMap[b.rosterId] = b.points; });
        }));
        scores[week] = weekMap;
      };
      const isPast = (wk) => nflState.week > wk;
      if (isPast(8)) {
        const playinTeams = TOURNEY_PLAYIN.flatMap((g) => g.seeds.map((n) => tourneySeeds[n - 1]));
        await fetchTeamsWeek(playinTeams, 8);
      }
      if (cancelled) return;
      let games = resolveTourneyBracket(tourneySeeds, scores);
      if (isPast(9)) {
        const r16Teams = TOURNEY_R16.flatMap((g) => {
          const ent = (ref) => (ref.seed ? tourneySeeds[ref.seed - 1] : (games[ref.playin] || {}).winner);
          return [ent(g.a), ent(g.b)];
        });
        await fetchTeamsWeek(r16Teams, 9);
      }
      if (cancelled) return;
      games = resolveTourneyBracket(tourneySeeds, scores);
      if (isPast(10)) {
        const qfTeams = TOURNEY_QF.flatMap((g) => [(games[g.a] || {}).winner, (games[g.b] || {}).winner]);
        await fetchTeamsWeek(qfTeams, 10);
      }
      if (cancelled) return;
      games = resolveTourneyBracket(tourneySeeds, scores);
      if (isPast(11)) {
        const sfTeams = TOURNEY_SF.flatMap((g) => [(games[g.a] || {}).winner, (games[g.b] || {}).winner]);
        await fetchTeamsWeek(sfTeams, 11);
      }
      if (cancelled) return;
      games = resolveTourneyBracket(tourneySeeds, scores);
      if (isPast(12)) {
        const finTeams = [(games[TOURNEY_FINAL.a] || {}).winner, (games[TOURNEY_FINAL.b] || {}).winner];
        await fetchTeamsWeek(finTeams, 12);
      }
      if (!cancelled) setTourneyScores(scores);
    })();
    return () => { cancelled = true; };
  }, [view, tourneySeeds, nflState, leagueMap, getWeeklyResultCached]);

  const tourneyGames = useMemo(() => resolveTourneyBracket(tourneySeeds, tourneyScores), [tourneySeeds, tourneyScores]);
  const tourneyCP = useMemo(() => tourneyCPTable(tourneyGames), [tourneyGames]);

  // Weekly Awards week picker defaults to the current live week once it's
  // known — only set once (guarded by weeklyAwardsWeek == null) so it never
  // overrides a week she's already browsing to.
  useEffect(() => {
    if (nflState && weeklyAwardsWeek == null) setWeeklyAwardsWeek(nflState.week);
  }, [nflState, weeklyAwardsWeek]);

  // Fetches (cache-first, see getWeeklyResultCached) every tier's result for
  // the selected Weekly Awards season/week, then flattens all 13 tiers' pairs
  // into one alliance-wide list for weeklyAwards (below) to crown a winner
  // from. Guarded on view === "weeklyawards" so switching seasons/weeks on a
  // tab she isn't looking at never fires 13 fetches for nothing.
  useEffect(() => {
    if (view !== "weeklyawards" || weeklyAwardsWeek == null) return;
    let cancelled = false;
    setWeeklyAwardsLoading(true);
    const seasonMap = weeklyAwardsSeason === CURRENT_SEASON ? leagueMap : LEAGUE_HISTORY[weeklyAwardsSeason] || {};
    Promise.all(
      TIERS.map((t) => {
        const id = seasonMap[t.key];
        if (!id) return null;
        return getWeeklyResultCached(t.key, id, weeklyAwardsSeason, weeklyAwardsWeek).catch(() => null);
      })
    ).then((results) => {
      if (cancelled) return;
      const flat = [];
      results.forEach((r, i) => {
        if (!r) return;
        r.pairs.forEach((p) => flat.push({ tierKey: TIERS[i].key, ...p }));
      });
      setWeeklyAwardsPairs(flat);
      setWeeklyAwardsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [view, weeklyAwardsSeason, weeklyAwardsWeek, leagueMap, getWeeklyResultCached]);

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
    // No `id` here on purpose — matches sendMsg's pattern. If we set one,
    // it rides along as a plain data field on the Firestore doc and
    // clobbers the real `d.id` in watchNews's `{ id: d.id, ...d.data() }`
    // (object spread: a later duplicate key wins), which breaks delete AND
    // pin for every news item posted while Firebase is live.
    const item = { tag: newsTag, title, body, ts: Date.now() };
    setNewsTitle("");
    setNewsBody("");
    const local = await postNewsItem(item);
    if (local) setNews(local);
  };

  const deleteNews = async (id) => {
    const local = await removeNewsItem(id);
    if (local) setNews(local.length ? local : SEED_NEWS);
  };

  // Toggles a news item's pinned flag. Shared/persisted the same way delete
  // is — updateDoc on Firebase, direct array rewrite on the local fallback
  // — so a pin sticks for every viewer, not just this browser.
  const pinNews = async (id, pinned) => {
    const local = await pinNewsItem(id, pinned);
    if (local) setNews(local.length ? local : SEED_NEWS);
  };

  // Pinned news items float to the top of the feed, each group keeping its
  // own order (newest-first, same as watchNews/postNewsItem already give us).
  const pinnedFirstNews = useMemo(() => {
    const pinned = news.filter((n) => n.pinned);
    const rest = news.filter((n) => !n.pinned);
    return { list: [...pinned, ...rest], pinnedCount: pinned.length };
  }, [news]);

  const deleteChatMsg = async (id) => {
    const local = await removeChatMessage(id);
    if (local) setChat(local);
  };

  // ── Apply-to-Team ──
  // Ranks applicants by live Promotion Score (the same stat now shown on
  // the Coaches tab), not Career CP — matches what the Rules page actually
  // says ("Jobs go to the coach with the highest Promotion Score"). No
  // fallback to Career CP: the transfer period runs weeks 19-20-ish, after
  // week 18 ends the fantasy season, by which point every coach has real
  // season stats — nulls here mean a genuinely unlisted name, not "too
  // early in the season," so they sort last rather than substituting a
  // different stat.
  const promotionPointsFor = (name) => {
    const live = liveCoachStats[(name || "").toLowerCase()];
    return live && live.promotionScore !== null ? live.promotionScore : null;
  };

  // Eligibility per the Rules page: the last 5/16, 7/20, or 11/32-placed
  // teams can't move up or down (`promotionEligible`, already used by the
  // bracket sidebar — same rule, not a new one). Reads the applicant's
  // CURRENT team's place in HISTORICAL_FINAL_ORDER[CURRENT_SEASON], the
  // just-finished season's finish order — populated the same way every
  // prior season's was, once that season's bracket gets transcribed after
  // it ends. Returns null (unknown — NOT "eligible") whenever that data
  // isn't in yet, which is simply the normal state right up until a season
  // actually finishes; the transfer period itself runs weeks 19-20-ish,
  // after week 18 ends the season, so the data's always in by the time
  // this is checked for real.
  const applicantEligibility = (coachName) => {
    const dirEntry = coachDirectory.find((c) => c.name.toLowerCase() === (coachName || "").toLowerCase());
    if (!dirEntry) return null;
    const order = HISTORICAL_FINAL_ORDER[CURRENT_SEASON] && HISTORICAL_FINAL_ORDER[CURRENT_SEASON][dirEntry.tierKey];
    if (!order) return null;
    const place = order.indexOf(dirEntry.team) + 1;
    if (place <= 0) return null;
    const tier = TIERS.find((t) => t.key === dirEntry.tierKey);
    if (!tier) return null;
    return promotionEligible(tier.size, place);
  };

  // Computes playoff seeding from final regular-season standings, per the
  // Rules doc's format for each tier. Returns null for tiers whose format
  // isn't confirmed yet (see PLAYOFF_FORMAT above) — the bracket section
  // just doesn't render for those rather than guessing.
  const computeBracket = (tKey) => {
    const format = PLAYOFF_FORMAT[tKey];
    if (!format) return null;
    const seasonMap = standingsSeason === CURRENT_SEASON ? leagueMap : LEAGUE_HISTORY[standingsSeason] || {};
    const id = seasonMap[tKey];
    const rows = id ? standingsCache[id] : null;
    if (!rows || !rows.length) return null;

    const sortByRecord = (arr) => [...arr].sort((a, b) => b.w - a.w || b.pts - a.pts);

    if (format === "top8-cascade") {
      const ranked = sortByRecord(rows.filter((r) => r.coach !== "—"));
      return {
        format,
        playoffSeeds: ranked.slice(0, 8),
        consolationSeeds: ranked.slice(8, 16),
      };
    }

    if (format === "conference-division") {
      const active = rows.filter((r) => r.coach !== "—" && r.division);
      const confSeeds = {};
      const confConsolation = {};
      ["AFC", "NFC"].forEach((confName) => {
        const confRows = active.filter((r) => nflConferenceFor(r.division) === confName);
        const byDivision = {};
        confRows.forEach((r) => {
          (byDivision[r.division] = byDivision[r.division] || []).push(r);
        });
        const divisionWinners = Object.values(byDivision).map((teams) => sortByRecord(teams)[0]);
        const winnersSeeded = sortByRecord(divisionWinners).map((r) => ({ ...r, divisionName: divisionNameFor(tKey, r.division) }));
        const winnerRosterIds = new Set(winnersSeeded.map((r) => r.rosterId));
        const nonWinners = sortByRecord(confRows.filter((r) => !winnerRosterIds.has(r.rosterId)));
        const wildcards = nonWinners.slice(0, 4);
        const wildcardRosterIds = new Set(wildcards.map((r) => r.rosterId));
        const consolation = nonWinners.filter((r) => !wildcardRosterIds.has(r.rosterId)).slice(0, 8);
        confSeeds[confName] = [...winnersSeeded, ...wildcards];
        confConsolation[confName] = consolation;
      });
      return {
        format,
        eastName: "NFC",
        westName: "AFC",
        playoffGroup: { east: confSeeds.NFC, west: confSeeds.AFC },
        consolationGroup: { east: confConsolation.NFC, west: confConsolation.AFC },
      };
    }

    if (format === "division-only") {
      const active = rows.filter((r) => r.coach !== "—" && r.division);
      const byDivision = {};
      active.forEach((r) => {
        (byDivision[r.division] = byDivision[r.division] || []).push(r);
      });
      const divisionWinners = Object.values(byDivision).map((teams) => sortByRecord(teams)[0]);
      const winnersSeeded = sortByRecord(divisionWinners).map((r) => ({ ...r, divisionName: divisionNameFor(tKey, r.division) }));
      const winnerRosterIds = new Set(winnersSeeded.map((r) => r.rosterId));
      const remaining = sortByRecord(active.filter((r) => !winnerRosterIds.has(r.rosterId)));
      const wildcards = remaining.slice(0, 4);
      return {
        format,
        playoffSeeds: [...winnersSeeded, ...wildcards],
        consolationSeeds: remaining.slice(4, 12),
      };
    }

    if (format === "conference-top4") {
      const active = rows.filter((r) => r.coach !== "—" && r.division);
      const divisions = [...new Set(active.map((r) => r.division))].sort((a, b) => a - b);
      const names = TWO_CONF_NAMES[tKey] || {};
      const [confA, confB] = divisions;
      const eastName = names[confA] || `Conference ${confA}`;
      const westName = names[confB] || `Conference ${confB}`;
      const eastAll = sortByRecord(active.filter((r) => r.division === confA));
      const westAll = sortByRecord(active.filter((r) => r.division === confB));
      return {
        format,
        eastName,
        westName,
        // Playoff group = each conference's top 4 (produces final ranks 1-8).
        // Consolation group = each conference's next 4 (produces ranks 9-16).
        playoffGroup: { east: eastAll.slice(0, 4), west: westAll.slice(0, 4) },
        consolationGroup: { east: eastAll.slice(4, 8), west: westAll.slice(4, 8) },
      };
    }

    if (format === "division-playin") {
      const active = rows.filter((r) => r.coach !== "—" && r.division);
      const byDivision = {};
      active.forEach((r) => {
        (byDivision[r.division] = byDivision[r.division] || []).push(r);
      });
      const divisionWinners = Object.values(byDivision).map((teams) => sortByRecord(teams)[0]);
      const winnersSeeded = sortByRecord(divisionWinners).map((r) => ({ ...r, divisionName: divisionNameFor(tKey, r.division) })); // seeds 1-4, all byes
      const winnerRosterIds = new Set(winnersSeeded.map((r) => r.rosterId));
      const remaining = sortByRecord(active.filter((r) => !winnerRosterIds.has(r.rosterId)));
      const wildcards = remaining.slice(0, 6); // seeds 5-10
      const consolation = remaining.slice(6, 16); // seeds 11-20
      return {
        format,
        seeds: [...winnersSeeded, ...wildcards], // index 0-9 = seed 1-10
        consolation,
      };
    }

    return null;
  };

  const applicantsForTeam = (tKey, team) =>
    applications
      .filter((a) => a.tierKey === tKey && a.team === team)
      .slice()
      .sort((a, b) => {
        const pa = promotionPointsFor(a.coachName);
        const pb = promotionPointsFor(b.coachName);
        if (pa === null && pb === null) return 0;
        if (pa === null) return 1;
        if (pb === null) return -1;
        return pb - pa;
      });

  const applyToTeam = async (tKey, team) => {
    let name = coachName;
    if (!name) {
      const entered = window.prompt("Enter your coach name to apply:");
      if (!entered) return;
      name = entered.trim().slice(0, 24);
      if (!name) return;
      setCoachName(name);
      setCoachNameStored(name);
    }
    const already = applications.some(
      (a) => a.tierKey === tKey && a.team === team && a.coachName.toLowerCase() === name.toLowerCase()
    );
    if (already) return;
    const app = { tierKey: tKey, team, coachName: name, ts: Date.now() };
    const local = await submitApplication(app);
    if (local) setApplications(local);
  };

  const togglePromotionWindow = async () => {
    const next = !promotionWindowOpen;
    setPromotionWindowOpen(next); // optimistic; live mode reconciles via onSnapshot moments later
    await setPromotionWindow(next);
  };

  const tier = TIERS.find((t) => t.key === tierKey);
  // The Standings page can look at any season in SEASON_OPTIONS; every other
  // page (Coaches, Directory, homepage Hot Seat, Conference Strength) always
  // uses leagueMap, i.e. the current season — only what's shown here shifts.
  const seasonLeagueMap = standingsSeason === CURRENT_SEASON ? leagueMap : LEAGUE_HISTORY[standingsSeason] || {};
  const leagueId = seasonLeagueMap[tierKey];
  const liveRows = leagueId ? standingsCache[leagueId] : null;
  const demoRows = tierKey === "NFL" ? DEMO_NFL.map((r) => ({ ...r, maxPts: null })) : null;
  const rows = mode === "live" ? liveRows : demoRows;
  const pairs = mode === "live" && leagueId ? matchupsCache[leagueId] : null;
  const bracket = mode === "live" ? computeBracket(tierKey) : null;
  // Declared AFTER `bracket` on purpose — it reads it. (See the TDZ note: a
  // const that reads another const must sit below it.)
  const liveGrid = buildR3Live(tierKey, bracket) || buildBRLive(tierKey, bracket) || buildUSFLXFLLive(tierKey, bracket);

  // One reference panel for the whole tier, computed here and rendered in the
  // left column under the tier ladder. Only the ten 16-team leagues have a CP
  // table; the others show promotion eligibility alone, so the heading follows
  // whatever the box can actually show.
  const placementPanel = !bracket
    ? null
    : {
        rows: placementInfoRows(tier.size, tierKey),
        title: "Coaching Points",
      };

  // Fetch Sleeper's real bracket results for whichever tier/season is on
  // screen, so computeBracket can fill in actual winners instead of only
  // seeding (see the "top8-cascade" / "division-only" branches above).
  useEffect(() => {
    if (mode !== "live" || !leagueId) return;
    if (!PLAYOFF_FORMAT[tierKey]) return;
    if (bracketResultsCache[leagueId]) return;
    loadBracketResults(leagueId);
  }, [mode, tierKey, leagueId, bracketResultsCache, loadBracketResults]);

  // Groups the current tier's standings to match its real Sleeper
  // conference/division structure — NFL gets conference > division nesting,
  // USFL/XFL/FLHS get their 4 divisions/districts, the 5 two-conference
  // leagues get their 2 conferences. Leagues without a confirmed conference
  // structure (SEC, Big 12, ACC, Big Ten) return null and keep the single
  // flat table, same as before.
  const groupStandings = (tKey, allRows) => {
    if (!allRows || !allRows.length) return null;
    const byRecord = (arr) => [...arr].sort((a, b) => b.w - a.w || b.pts - a.pts);
    const withDiv = allRows.filter((r) => r.division);
    if (!withDiv.length) return null;

    if (tKey === "NFL") {
      const groups = ["AFC", "NFC"].map((confName) => {
        // Rank within the conference first (seed 1-16), THEN split into
        // divisions for display — so the # column reflects conference
        // standing, not the whole 32-team league.
        const confRows = byRecord(withDiv.filter((r) => nflConferenceFor(r.division) === confName)).map((r, i) => ({ ...r, place: i + 1 }));
        const byDiv = {};
        confRows.forEach((r) => (byDiv[r.division] = byDiv[r.division] || []).push(r));
        const divisions = Object.keys(byDiv)
          .sort((a, b) => a - b)
          .map((d) => ({ name: NFL_DIVISIONS[d] || `Division ${d}`, rows: byDiv[d] }));
        return { name: confName, divisions };
      });
      return { type: "nested", groups };
    }

    let names = null;
    if (tKey === "FLHS") names = FLHS_DISTRICTS;
    else if (tKey === "USFL" || tKey === "XFL") names = USFL_XFL_DIVISIONS;
    else if (TWO_CONF_NAMES[tKey]) names = TWO_CONF_NAMES[tKey];
    if (!names) return null;

    const byDiv = {};
    withDiv.forEach((r) => (byDiv[r.division] = byDiv[r.division] || []).push(r));
    const groups = Object.keys(byDiv)
      .sort((a, b) => a - b)
      .map((d) => {
        let groupRows = byRecord(byDiv[d]);
        // Tiers 8-12 (Sun Belt/SoCo/Ivy/SWAC/GLIAC): seed 1-8 within each
        // conference, not the whole 16-team league.
        if (TWO_CONF_NAMES[tKey]) groupRows = groupRows.map((r, i) => ({ ...r, place: i + 1 }));
        return { name: names[d] || `Group ${d}`, rows: groupRows };
      });
    return groups.length ? { type: "flat", groups } : null;
  };

  const standingsGroups = mode === "live" ? groupStandings(tierKey, rows) : null;
  const overallLastRosterId = rows && rows.length ? rows[rows.length - 1].rosterId : null;

  // Colors the standings "#" column to show who's actually clinched a
  // playoff spot and how: green for a spot that's automatic regardless of
  // overall record (a division/conference winner), gold for a spot earned
  // by ranking rather than a guarantee. Only applies to tiers with a
  // confirmed format — everything else keeps the plain slate numbering.
  const seedColors = useMemo(() => {
    const colors = {};
    if (mode !== "live" || !rows || !rows.length) return colors;
    const byRecord = (arr) => [...arr].sort((a, b) => b.w - a.w || b.pts - a.pts);
    const format = PLAYOFF_FORMAT[tierKey];
    const active = rows.filter((r) => r.coach !== "—");

    if (format === "top8-cascade") {
      byRecord(active).forEach((r, i) => {
        if (i === 0) colors[r.rosterId] = "green";
        else if (i < 8) colors[r.rosterId] = "gold";
      });
    } else if (format === "conference-top4") {
      const withDiv = active.filter((r) => r.division);
      const divisions = [...new Set(withDiv.map((r) => r.division))];
      divisions.forEach((d) => {
        byRecord(withDiv.filter((r) => r.division === d)).forEach((r, i) => {
          if (i === 0) colors[r.rosterId] = "green";
          else if (i < 4) colors[r.rosterId] = "gold";
        });
      });
    } else if (format === "division-only") {
      const withDiv = active.filter((r) => r.division);
      const byDivision = {};
      withDiv.forEach((r) => (byDivision[r.division] = byDivision[r.division] || []).push(r));
      const divisionWinners = Object.values(byDivision).map((teams) => byRecord(teams)[0]);
      divisionWinners.forEach((r) => (colors[r.rosterId] = "green"));
      const winnerIds = new Set(divisionWinners.map((r) => r.rosterId));
      byRecord(withDiv.filter((r) => !winnerIds.has(r.rosterId)))
        .slice(0, 4)
        .forEach((r) => (colors[r.rosterId] = "gold"));
    } else if (format === "conference-division") {
      const withDiv = active.filter((r) => r.division);
      const byDivision = {};
      withDiv.forEach((r) => (byDivision[r.division] = byDivision[r.division] || []).push(r));
      const divisionWinners = Object.values(byDivision).map((teams) => byRecord(teams)[0]);
      divisionWinners.forEach((r) => (colors[r.rosterId] = "green"));
      const winnerIds = new Set(divisionWinners.map((r) => r.rosterId));
      ["AFC", "NFC"].forEach((confName) => {
        const confNonWinners = withDiv.filter((r) => nflConferenceFor(r.division) === confName && !winnerIds.has(r.rosterId));
        byRecord(confNonWinners).slice(0, 4).forEach((r) => (colors[r.rosterId] = "gold"));
      });
    } else if (format === "division-playin") {
      const withDiv = active.filter((r) => r.division);
      const byDivision = {};
      withDiv.forEach((r) => (byDivision[r.division] = byDivision[r.division] || []).push(r));
      const divisionWinners = Object.values(byDivision).map((teams) => byRecord(teams)[0]);
      divisionWinners.forEach((r) => (colors[r.rosterId] = "green"));
      const winnerIds = new Set(divisionWinners.map((r) => r.rosterId));
      byRecord(withDiv.filter((r) => !winnerIds.has(r.rosterId)))
        .slice(0, 6)
        .forEach((r) => (colors[r.rosterId] = "gold"));
    }
    return colors;
  }, [mode, rows, tierKey]);

  const renderStandingsRows = (tableRows) =>
    tableRows.map((r, i) => {
      const isLast = standingsGroups ? r.rosterId === overallLastRosterId : i >= tableRows.length - 1;
      const seedColor = seedColors[r.rosterId];
      const placeColor = seedColor === "green" ? C.turf : seedColor === "gold" ? C.gold : C.slate;
      return (
        <tr
          key={r.coach + i}
          style={{
            background: isLast ? "rgba(212,96,76,0.10)" : i % 2 ? "rgba(255,255,255,0.02)" : "transparent",
            borderTop: `1px solid ${C.line}`,
          }}
        >
          <td className="px-3 py-2" style={{ color: placeColor, fontWeight: seedColor ? 700 : 400 }}>{r.place}</td>
          <td className="px-3 py-2 whitespace-nowrap" style={{ fontFamily: "'Barlow', sans-serif", fontWeight: 600 }}>
            <button type="button" onClick={() => openCoachProfile(r.coach)} style={{ color: "inherit" }}>
              {r.coach}
              <TrophyBadges name={r.coach} size={12} />
            </button>
            {isLast && (
              <span className="ml-2 px-1.5 py-0.5 text-xs uppercase tracking-wider rounded-sm" style={{ background: "rgba(212,96,76,0.2)", color: C.ember }}>
                hot seat
              </span>
            )}
          </td>
          <td className="px-3 py-2 whitespace-nowrap" style={{ fontFamily: "'Barlow', sans-serif", color: C.slate }}>
            <button type="button" onClick={() => openTeamProfile(r, tierKey)} style={{ color: "inherit" }}>
              {r.team}
            </button>
          </td>
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
    });

  const StandingsTable = ({ tableRows }) => (
    <div className="overflow-x-auto rounded-sm" style={{ border: `1px solid ${C.line}` }}>
      <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: C.panel, color: C.slate }}>
            {["#", "Coach", "Team", "W–L", "PF", mode === "live" ? "Max PF" : "CP"].map((h, i) => th(h, i))}
          </tr>
        </thead>
        <tbody style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{renderStandingsRows(tableRows)}</tbody>
      </table>
    </div>
  );

  const hotSeatFor = (tKey) => {
    if (mode === "live") {
      const id = leagueMap[tKey];
      const tRows = id ? standingsCache[id] : null;
      return tRows && tRows.length ? tRows[tRows.length - 1] : null;
    }
    return tKey === "NFL" ? DEMO_NFL[DEMO_NFL.length - 1] : null;
  };

  // ── Coach directory: every coach currently rostered across all connected
  // leagues, built entirely from data already fetched for standings — no
  // separate roster of "232 coaches" needs to be maintained by hand.
  const coachDirectory = useMemo(() => {
    const list = [];
    if (mode === "live") {
      TIERS.forEach((t) => {
        const id = leagueMap[t.key];
        const tRows = id ? standingsCache[id] : null;
        if (!tRows) return;
        tRows.forEach((r) => {
          if (!r.coach || r.coach === "—") return;
          list.push({
            userId: r.userId,
            name: r.coach,
            avatar: r.avatar,
            team: r.team,
            tierKey: t.key,
            tierName: t.name,
            w: r.w,
            l: r.l,
            maxPts: r.maxPts,
            playerIds: r.playerIds,
            rosterId: r.rosterId,
          });
        });
      });
    } else {
      DEMO_NFL.forEach((r) => {
        list.push({
          userId: null,
          name: r.coach,
          avatar: null,
          team: r.team,
          tierKey: "NFL",
          tierName: "National Football League",
          w: r.w,
          l: r.l,
        });
      });
    }
    return list;
  }, [mode, leagueMap, standingsCache]);

  const [coachSort, setCoachSort] = useState({ key: "cp", dir: "desc" });

  // Every coach with career data on file, resolved to whichever team they
  // currently hold (same rule as the profile popup) — never a mix-and-match
  // of a different league's numbers.
  const allCoachesTable = useMemo(() => {
    return Object.entries(CAREER_STATS).map(([lowerName, entries]) => {
      const dirEntry = coachDirectory.find((c) => c.name.toLowerCase() === lowerName);
      const match = dirEntry ? entries.find((e) => e.tierKey === dirEntry.tierKey) : null;
      const chosen = match || entries[0];
      const s = chosen.stats;
      const parseNum = (v) => {
        const n = parseFloat(String(v).replace("%", ""));
        return Number.isFinite(n) ? n : -Infinity;
      };
      const [wStr, lStr] = (s["Record"] || "").split("-");
      const live = liveCoachStats[lowerName];
      return {
        name: dirEntry ? dirEntry.name : lowerName,
        team: chosen.team,
        tierKey: chosen.tierKey,
        cp: parseNum(s["Career CP"]),
        promotionScore: live && live.promotionScore !== null ? live.promotionScore : -Infinity,
        currentCP: live && live.currentCP !== null ? live.currentCP : -Infinity,
        wins: parseNum(wStr),
        losses: parseNum(lStr),
        winPct: parseNum(s["Win %"]),
        totalPts: parseNum(s["Total Points"]),
        record: s["Record"],
        maxPts: match ? dirEntry.maxPts : undefined,
        rosterId: match ? dirEntry.rosterId : undefined,
      };
    });
  }, [coachDirectory, liveCoachStats]);

  const sortedCoachesTable = useMemo(() => {
    const arr = [...allCoachesTable];
    const { key, dir } = coachSort;
    arr.sort((a, b) => {
      let av = a[key];
      let bv = b[key];
      if (typeof av === "string") {
        av = av.toLowerCase();
        bv = bv.toLowerCase();
        return dir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return dir === "asc" ? av - bv : bv - av;
    });
    return arr;
  }, [allCoachesTable, coachSort]);

  const toggleCoachSort = (key) => {
    setCoachSort((prev) => (prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }));
  };

  const findCoachAvatar = (name) => {
    const hit = coachDirectory.find((c) => c.name.toLowerCase() === (name || "").toLowerCase());
    return hit ? hit.avatar : null;
  };

  const openCoachProfile = (name) => {
    const hit = coachDirectory.find((c) => c.name.toLowerCase() === (name || "").toLowerCase());
    setSelectedCoach(hit || { name, avatar: null, team: null, tierKey: null, tierName: null });
  };

  // Draft-pick ownership (including trades) is fetched lazily per league,
  // the first time someone opens a team profile in that league — not on
  // every page load, and not for leagues nobody's looked at yet.
  const ensureDraftDataLoaded = useCallback(async (leagueId) => {
    if (!leagueId || draftDataCache[leagueId] || draftDataLoading[leagueId]) return;
    setDraftDataLoading((prev) => ({ ...prev, [leagueId]: true }));
    try {
      const [tradedPicks, drafts] = await Promise.all([
        j(`${SLEEPER}/league/${leagueId}/traded_picks`),
        j(`${SLEEPER}/league/${leagueId}/drafts`),
      ]);
      const rounds = (drafts && drafts[0] && drafts[0].settings && drafts[0].settings.rounds) || 4;
      setDraftDataCache((prev) => ({ ...prev, [leagueId]: { tradedPicks: tradedPicks || [], rounds } }));
    } catch (e) {
      setDraftDataCache((prev) => ({ ...prev, [leagueId]: { tradedPicks: [], rounds: 4 } }));
    } finally {
      setDraftDataLoading((prev) => ({ ...prev, [leagueId]: false }));
    }
  }, [draftDataCache, draftDataLoading]);

  // Which picks a roster currently owns for the next 3 seasons, accounting
  // for trades — a pick traded away drops off this roster's list, and a
  // pick acquired from another roster is added (flagged "via trade").
  const ownedPicksFor = (leagueId, rosterId) => {
    const data = draftDataCache[leagueId];
    if (!data || !rosterId) return null;
    const { tradedPicks, rounds } = data;
    const startSeason = nflState ? parseInt(nflState.season, 10) : new Date().getFullYear();
    const picks = [];
    for (let yearOffset = 0; yearOffset < 3; yearOffset++) {
      const season = String(startSeason + yearOffset);
      for (let round = 1; round <= rounds; round++) {
        const tradedAway = tradedPicks.find(
          (p) => String(p.season) === season && p.round === round && p.roster_id === rosterId && p.owner_id !== rosterId
        );
        if (!tradedAway) picks.push({ season, round, viaTrade: false });
      }
      tradedPicks
        .filter((p) => String(p.season) === season && p.owner_id === rosterId && p.roster_id !== rosterId)
        .forEach((p) => picks.push({ season, round: p.round, viaTrade: true }));
    }
    picks.sort((a, b) => (a.season === b.season ? a.round - b.round : a.season.localeCompare(b.season)));
    return picks;
  };

  const openTeamProfile = (row, tKey) => {
    const t = TIERS.find((x) => x.key === tKey);
    const leagueId = leagueMap[tKey];
    setSelectedTeam({
      team: row.team,
      tierKey: tKey,
      tierName: t ? t.name : tKey,
      maxPts: row.maxPts,
      rosterId: row.rosterId,
      leagueId,
      // row.coach covers Standings ("—" for an open team, a real name
      // otherwise) and the Open Teams list (always "—"). The Coaches tab's
      // rows don't carry a .coach field at all — every row there already IS
      // a coach, under .name instead — so fall back to that. The 300 Club's
      // synthetic row has neither; team.coach stays undefined there, which
      // the modal treats as NOT available (never claim availability we
      // don't actually know).
      coach: row.coach ?? row.name,
    });
    if (mode === "live" && leagueId && row.rosterId) ensureDraftDataLoaded(leagueId);
  };

  const filteredDirectory = useMemo(() => {
    const q = dirQuery.trim().toLowerCase();
    if (!q) return coachDirectory;
    return coachDirectory.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.team.toLowerCase().includes(q) ||
        c.tierKey.toLowerCase().includes(q) ||
        c.tierName.toLowerCase().includes(q)
    );
  }, [coachDirectory, dirQuery]);

  // Teams with no coach — the exact inverse of coachDirectory's own filter
  // (`r.coach === "—"` kept here, dropped there), same live rows, same
  // fetch. `coach: "—"` is set explicitly on each entry so openTeamProfile's
  // `row.coach ?? row.name` resolves correctly when a card opens the modal.
  const openTeamsDirectory = useMemo(() => {
    const list = [];
    if (mode === "live") {
      TIERS.forEach((t) => {
        const id = leagueMap[t.key];
        const tRows = id ? standingsCache[id] : null;
        if (!tRows) return;
        tRows.forEach((r) => {
          if (r.coach !== "—") return;
          list.push({ coach: "—", team: r.team, tierKey: t.key, tierName: t.name, maxPts: r.maxPts, rosterId: r.rosterId });
        });
      });
    }
    return list;
  }, [mode, leagueMap, standingsCache]);

  const filteredOpenTeams = useMemo(() => {
    const q = dirQuery.trim().toLowerCase();
    if (!q) return openTeamsDirectory;
    return openTeamsDirectory.filter(
      (t) => t.team.toLowerCase().includes(q) || t.tierKey.toLowerCase().includes(q) || t.tierName.toLowerCase().includes(q)
    );
  }, [openTeamsDirectory, dirQuery]);

  // ── Directory grouping ───────────────────────────────────────────────────
  // Coaches who hold more than one team carry a tag on the end of the name
  // ("pwnrangr l3", "rifelife520 int2"). Each tagged name is a SEPARATE coach,
  // never merged with its base name — the tag is only split out so the sort
  // keeps one person's teams together and so the tag can render as a badge.
  const dirGroups = useMemo(() => {
    const splitTag = (name) => {
      const m = /^(.*?)\s+((?:int|l)\d*)$/i.exec(name || "");
      return m ? { base: m[1], tag: m[2].toLowerCase() } : { base: name || "", tag: "" };
    };
    // Sort on base name, then tag letters, then tag number as a NUMBER so a
    // future "l10" lands after "l2" instead of before it.
    const sortKey = (c) => {
      const { base, tag } = splitTag(c.name);
      const digits = tag.replace(/\D/g, "");
      return [base.toLowerCase(), tag.replace(/\d/g, ""), digits ? parseInt(digits, 10) : -1];
    };
    const cmp = (a, b) => {
      const ka = sortKey(a), kb = sortKey(b);
      return ka[0].localeCompare(kb[0]) || ka[1].localeCompare(kb[1]) || ka[2] - kb[2];
    };
    const byTier = new Map();
    filteredDirectory.forEach((c) => {
      if (!byTier.has(c.tierKey)) byTier.set(c.tierKey, []);
      byTier.get(c.tierKey).push(c);
    });
    const openByTier = new Map();
    filteredOpenTeams.forEach((t) => {
      if (!openByTier.has(t.tierKey)) openByTier.set(t.tierKey, []);
      openByTier.get(t.tierKey).push(t);
    });
    // Ladder order (tier 1 down to 13), same as Standings — not alphabetical.
    // A tier appears if it has coaches OR open teams (or both); drops out
    // only when it has neither after filtering.
    return TIERS.filter((t) => byTier.has(t.key) || openByTier.has(t.key)).map((t) => ({
      tier: t,
      coaches: (byTier.get(t.key) || []).sort(cmp).map((c) => ({ ...c, ...splitTag(c.name) })),
      openTeams: (openByTier.get(t.key) || []).sort((a, b) => a.team.localeCompare(b.team)),
    }));
  }, [filteredDirectory, filteredOpenTeams]);

  // ── Conference Strength — our JS port of her "League Difficulty" sheet
  // formula (confirmed cell-by-cell against the sheet's real formulas and a
  // real season's roster CSV, 2026-08-05), rebuilt entirely from data
  // already in standingsCache — no separate fetch needed. Two pools: the
  // 10-tier "Alliance," and USFL+XFL compared only against each other. NFL
  // has no pool, so it isn't scored. Scores hover near zero until real games
  // are played — that's expected during the off-season, not a bug.
  //
  // maxPts (below) is Sleeper's own `settings.ppts`/`ppts_decimal` — its
  // built-in season-total "potential points" (optimal-lineup) figure per
  // roster, already parsed in buildStandings. Confirmed byte-for-byte
  // against her sheet's own MaxPts/pts-per-max columns on a real season's
  // roster dump — no lineup-optimizer or player-level data needed.
  const conferenceStrength = useMemo(() => {
    if (mode !== "live") return {};

    const baseStats = (tKey) => {
      const id = leagueMap[tKey];
      const tRows = id ? standingsCache[id] : null;
      if (!tRows || tRows.length < 2) return null;
      const scores = tRows.map((r) => r.pts || 0);
      const teamMax = Math.max(...scores);
      const teamMin = Math.min(...scores);
      const maxPts = tRows.map((r) => r.maxPts || 0);
      const ptsPerMax = tRows.map((r, i) => (maxPts[i] ? scores[i] / maxPts[i] : 0));
      return {
        teamMax,
        teamMin,
        d: teamMax - teamMin,
        leagueMedian: median(scores),
        // "L Av Max*Pts/Max" / "L Med Max*Pts/Max" in her sheet — the
        // average (or median) of each team's Max Points, times the average
        // (or median) of each team's Pts/Max ratio, computed within this
        // tier only. Multiplied together as a single per-tier stat, same as
        // her Admin!Q120*Admin!R120 cell.
        avgMaxPM: average(maxPts) * average(ptsPerMax),
        medMaxPM: median(maxPts) * median(ptsPerMax),
      };
    };

    const scorePool = (poolKeys) => {
      const stats = {};
      poolKeys.forEach((k) => {
        const s = baseStats(k);
        if (s) stats[k] = s;
      });
      const keys = Object.keys(stats);
      if (keys.length < 2) return {};

      const poolMedianD = median(keys.map((k) => stats[k].d));
      const poolAvgOfAvgMaxPM = average(keys.map((k) => stats[k].avgMaxPM));
      const poolMedianOfMedMaxPM = median(keys.map((k) => stats[k].medMaxPM));
      const poolMedianOfMax = median(keys.map((k) => stats[k].teamMax));
      // Her sheet's $K$43 is "Av16 Med Tot Pts" — the AVERAGE of the pool's
      // per-tier medians, not the median of them.
      const poolAvgOfMedians = average(keys.map((k) => stats[k].leagueMedian));
      const poolMedianOfMin = median(keys.map((k) => stats[k].teamMin));

      const out = {};
      keys.forEach((k) => {
        const s = stats[k];
        const score =
          ((s.d - poolMedianD) / -10 / 10 +
            (s.avgMaxPM - poolAvgOfAvgMaxPM) / 100 +
            (s.medMaxPM - poolMedianOfMedMaxPM) / 20 +
            (s.teamMax - poolMedianOfMax) / 100 +
            (s.leagueMedian - poolAvgOfMedians) / 20 +
            (s.teamMin - poolMedianOfMin) / 100) /
          2; // her sheet sums all six bonus terms, then halves the total
        out[k] = { score, poolSize: keys.length };
      });
      return out;
    };

    return { ...scorePool(ALLIANCE_POOL), ...scorePool(PRO_POOL) };
  }, [mode, leagueMap, standingsCache]);

  // The 7 Weekly Awards categories, crowned across ALL 13 tiers combined
  // ("Alliance" High/Low, not per-tier) from weeklyAwardsPairs. Bench Points
  // is the confirmed 2026-08-06 substitute for a true weekly Pts-vs-Max —
  // see the project notes for why a real lineup-optimizer version isn't
  // built here.
  const weeklyAwards = useMemo(() => {
    if (!weeklyAwardsPairs.length) return null;
    const sides = [];
    weeklyAwardsPairs.forEach((p) => {
      sides.push({ ...p.a, tierKey: p.tierKey });
      sides.push({ ...p.b, tierKey: p.tierKey });
    });
    const bestOf = (cmp) => sides.reduce((best, s) => (!best || cmp(s, best) ? s : best), null);
    const highScore = bestOf((s, b) => s.points > b.points);
    const lowScore = bestOf((s, b) => s.points < b.points);
    const bestBench = bestOf((s, b) => s.benchPoints < b.benchPoints);
    const worstBench = bestOf((s, b) => s.benchPoints > b.benchPoints);

    let closest = null,
      blowout = null,
      highLoss = null;
    weeklyAwardsPairs.forEach((p) => {
      const margin = Math.abs(p.a.points - p.b.points);
      const loserPts = Math.min(p.a.points, p.b.points);
      const info = { ...p, margin, loserPts };
      if (!closest || margin < closest.margin) closest = info;
      if (!blowout || margin > blowout.margin) blowout = info;
      if (!highLoss || loserPts > highLoss.loserPts) highLoss = info;
    });

    return { highScore, lowScore, bestBench, worstBench, closest, blowout, highLoss };
  }, [weeklyAwardsPairs]);

  // Per-league breakdown of the same week's data: one High Score winner and
  // one Least Bench Points winner PER TIER, instead of one Alliance-wide
  // winner across all 13. Requested 2026-08-06 to sit below the existing
  // Alliance award cards, styled like the 300 Club's row list. Reuses
  // weeklyAwardsPairs (already fetched for the Alliance awards above) —
  // no new fetch needed, just grouped by tierKey instead of flattened.
  const leagueWeeklyAwards = useMemo(() => {
    const byTier = {};
    weeklyAwardsPairs.forEach((p) => {
      (byTier[p.tierKey] = byTier[p.tierKey] || []).push(p.a, p.b);
    });
    const out = [];
    TIERS.forEach((t) => {
      const sides = byTier[t.key];
      if (!sides || !sides.length) return;
      const highScore = sides.reduce((best, s) => (!best || s.points > best.points ? s : best), null);
      const leastBench = sides.reduce((best, s) => (!best || s.benchPoints < best.benchPoints ? s : best), null);
      out.push({ tierKey: t.key, highScore, leastBench });
    });
    return out;
  }, [weeklyAwardsPairs]);
  const leagueHighScoresSorted = useMemo(
    () => [...leagueWeeklyAwards].sort((a, b) => b.highScore.points - a.highScore.points),
    [leagueWeeklyAwards]
  );
  const leagueLeastBenchSorted = useMemo(
    () => [...leagueWeeklyAwards].sort((a, b) => a.leastBench.benchPoints - b.leastBench.benchPoints),
    [leagueWeeklyAwards]
  );

  // 300 Club: static CLUB_300 merged with live-detected entries, sorted
  // highest score first. Two defensive filters, both needed because of
  // the detect300 bug fixed just above (it used to fire on every past
  // week Weekly Awards browsed, not just the current season):
  // 1. Drop any club300Live entry whose year isn't CURRENT_SEASON. A
  //    past-season live entry is always a leftover from before the fix —
  //    it can never be created again going forward, and even where it
  //    exists it's unreliable (buildStandings' non-current-season
  //    fallback shows Sleeper's CURRENT account name/metadata, not who
  //    actually held the roster that season, so the team name often
  //    doesn't match TEAM_ART at all — found from her screenshot
  //    2026-08-07: a stray past-season entry with a mismatched team name
  //    showed no logo, and wasn't even a duplicate of anything in
  //    CLUB_300, so the tier+week+year+points dedup below couldn't have
  //    caught it). Historical years belong to the curated static array
  //    only now.
  // 2. Dedupe what's left by (tier, week, year, points) — still needed
  //    for the current season, where a live entry could theoretically
  //    collide with something hand-typed into CLUB_300 later. The
  //    fingerprint doesn't include coach/team name on purpose, since
  //    those could differ; tier+week+year+points is the reliable game
  //    identity, and CLUB_300 (spread first) always wins a collision.
  // CLUB_300 happens to already be hand-authored in descending order,
  // but that's not something to rely on, so this still ends with an
  // explicit sort. Kept as a useMemo (not a module constant) since
  // club300Live changes at runtime.
  const club300All = useMemo(() => {
    const currentLive = club300Live.filter((r) => r.year === CURRENT_SEASON);
    const merged = currentLive.length ? [...CLUB_300, ...currentLive] : CLUB_300;
    const seen = new Set();
    const deduped = [];
    merged.forEach((r) => {
      const tierKey = CONF_TO_TIER_KEY[r.conf] || r.conf;
      const key = `${tierKey}|${r.week}|${r.year}|${r.pts.toFixed(2)}`;
      if (seen.has(key)) return;
      seen.add(key);
      deduped.push(r);
    });
    return deduped.sort((a, b) => b.pts - a.pts);
  }, [club300Live]);
  const club300TopCoaches = useMemo(() => tally(club300All, (r) => r.coach).slice(0, 10), [club300All]);
  const club300TopTeams = useMemo(() => tally(club300All, (r) => r.team).slice(0, 8), [club300All]);
  const club300ByConf = useMemo(() => tally(club300All, (r) => r.conf), [club300All]);

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

  // Weekly Awards card, single-side categories (High/Low Score, Best/Worst
  // Bench Points). `valueKey` picks which field the big number reads from;
  // defaults to the raw score.
  const AwardCard = ({ label, side, valueKey = "points", valueColor = C.gold, cp }) => {
    if (!side) return null;
    return (
      <div className="px-3.5 py-3 rounded-sm" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="text-xs uppercase tracking-widest" style={{ color: C.slate, letterSpacing: "0.15em" }}>
            {label}
          </div>
          {cp !== undefined && (
            <span
              className="text-xs shrink-0"
              style={{ fontFamily: "'IBM Plex Mono', monospace", color: cp >= 0 ? C.turf : C.ember }}
            >
              {cp >= 0 ? "+" : ""}
              {cp} CP
            </span>
          )}
        </div>
        <div
          className="text-3xl leading-none mb-2"
          style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, color: valueColor }}
        >
          {fmt(side[valueKey])}
        </div>
        <div className="flex items-center gap-2">
          <TeamMark team={side.team} tierKey={side.tierKey} size={30} />
          <div className="min-w-0">
            <button
              type="button"
              onClick={() => openCoachProfile(side.coach)}
              className="text-sm font-semibold truncate block"
              style={{ color: "inherit" }}
            >
              {side.coach || "—"}
            </button>
            <button
              type="button"
              onClick={() => openTeamProfile(side, side.tierKey)}
              className="text-xs truncate block"
              style={{ color: C.slate }}
            >
              {side.team || "—"} · {side.tierKey}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // Weekly Awards card, pair categories (Closest Margin, Biggest Blowout,
  // Highest-Scoring Loss). Always shows the higher scorer first; `markLoser`
  // adds (W)/(L) tags for the one category where who lost is the point.
  const AwardPairCard = ({ label, pair, value, markLoser = false }) => {
    if (!pair) return null;
    const aWon = pair.a.points >= pair.b.points;
    const winner = aWon ? pair.a : pair.b;
    const loser = aWon ? pair.b : pair.a;
    return (
      <div className="px-3.5 py-3 rounded-sm" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
        <div className="text-xs uppercase tracking-widest mb-2" style={{ color: C.slate, letterSpacing: "0.15em" }}>
          {label}
        </div>
        <div
          className="text-3xl leading-none mb-2"
          style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, color: C.gold }}
        >
          {fmt(value)}
        </div>
        <div className="space-y-1">
          {[winner, loser].map((s, i) => (
            <div key={i} className="flex items-center justify-between text-xs gap-2">
              <button
                type="button"
                onClick={() => openTeamProfile(s, pair.tierKey)}
                className="truncate"
                style={{ color: i === 0 ? C.chalk : C.slate }}
              >
                {s.coach || "—"}
                {markLoser ? (i === 0 ? " (W)" : " (L)") : ""}
              </button>
              <span
                className="shrink-0"
                style={{ fontFamily: "'IBM Plex Mono', monospace", color: i === 0 ? C.chalk : C.slate }}
              >
                {fmt(s.points)}
              </span>
            </div>
          ))}
        </div>
        <div className="text-xs mt-2" style={{ color: C.slate }}>
          {pair.tierKey}
        </div>
      </div>
    );
  };

  // Per-league Weekly Awards row — same visual treatment as a 300 Club row
  // (score badge, TeamMark, coach/team buttons), one row per tier instead
  // of one flat ranked list. `valueKey`/`valueColor` pick which field the
  // score badge reads and what color it renders in, same pattern as
  // AwardCard above.
  const LeagueAwardRow = ({ side, tierKey, valueKey = "points", valueColor = C.turf }) => (
    <div className="flex items-center gap-3 px-3 py-2 rounded-sm" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
      <span className="text-xl leading-none w-20 shrink-0" style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, color: valueColor }}>
        {fmt(side[valueKey])}
      </span>
      <TeamMark team={side.team} tierKey={tierKey} size={38} />
      <div className="min-w-0 flex-1">
        <button type="button" onClick={() => openCoachProfile(side.coach)} className="text-sm font-semibold truncate block" style={{ color: "inherit" }}>
          {side.coach || "—"}
        </button>
        <div className="text-xs truncate" style={{ color: C.slate }}>
          <button type="button" onClick={() => openTeamProfile(side, tierKey)} style={{ color: "inherit" }}>
            {side.team || "—"}
          </button>{" "}
          · {tierKey}
        </div>
      </div>
    </div>
  );

  // Age gate — outermost, ahead of everything else, including the auth
  // loading check below. Has nothing to do with Firebase and shouldn't wait
  // on it.
  if (!gatePassed) {
    return <AgeGate onPass={() => setGatePassed(true)} />;
  }

  // Auth render gate — order matters: still-checking, then logged-out, then
  // the several logged-in-but-not-fully-in states (rejected / unverified /
  // pending admin review / banned), then a same-session 2FA check, and only
  // then the real app below.
  if (!authReady) {
    return (
      <div
        className="min-h-screen w-full flex items-center justify-center"
        style={{ background: C.ink, color: C.gold, fontFamily: "'Barlow Condensed', sans-serif", fontSize: 18, letterSpacing: "0.1em" }}
      >
        LOADING…
      </div>
    );
  }

  if (!currentUser) {
    return <LandingPage onAuth={setCurrentUser} />;
  }

  if (!currentUser.approved) {
    let gateMsg, gateColor;
    if (currentUser.rejected) {
      gateMsg = "Your application was not approved. Contact an admin if you believe this is a mistake.";
      gateColor = C.ember;
    } else if (currentUser.everApproved) {
      // Was approved before, isn't now — this is a ban, not new-user onboarding.
      gateMsg = "Your account has been suspended. Contact an admin.";
      gateColor = C.ember;
    } else if (currentUser.pendingApproval) {
      gateMsg = "Your email has been verified. Your account is pending review by an admin — you'll get access once it's approved.";
      gateColor = C.gold;
    } else {
      gateMsg = `We've sent a verification link to ${currentUser.email}. Click it, then sign back in to continue.`;
      gateColor = C.gold;
    }
    return (
      <div
        className="min-h-screen w-full flex items-center justify-center text-center px-6"
        style={{ background: C.ink, fontFamily: "'Barlow Condensed', sans-serif", fontSize: 18 }}
      >
        <div style={{ maxWidth: 440 }}>
          <div style={{ color: gateColor, marginBottom: 20 }}>{gateMsg}</div>
          <button
            onClick={logoutUser}
            className="px-3 py-1.5 text-xs font-bold uppercase rounded-sm"
            style={{ background: "transparent", border: `1px solid ${C.line}`, color: C.slate, cursor: "pointer" }}
          >
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  if (currentUser.twoFAEnabled && !twoFAVerified) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center px-6" style={{ background: C.ink, fontFamily: "'Barlow', sans-serif" }}>
        <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 8, padding: "32px 36px", maxWidth: 380, width: "100%" }}>
          <h2
            className="text-lg uppercase text-center"
            style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, letterSpacing: "0.06em", color: C.gold, margin: "0 0 16px" }}
          >
            Two-Factor Code
          </h2>
          <p className="text-xs text-center" style={{ color: C.slate, lineHeight: 1.6, marginBottom: 18 }}>
            Enter the 6-digit code from your authenticator app.
          </p>
          <input
            value={twoFACode}
            onChange={(e) => setTwoFACode(e.target.value)}
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
              marginBottom: 12,
            }}
          />
          {twoFAGateError && <div className="text-xs text-center mb-3" style={{ color: C.ember }}>{twoFAGateError}</div>}
          <button
            onClick={verifyTwoFAGate}
            disabled={twoFACode.replace(/\s/g, "").length < 6}
            className="w-full py-2.5 text-sm font-bold uppercase tracking-wider"
            style={{
              background: C.gold,
              color: C.ink,
              border: "none",
              borderRadius: 4,
              cursor: "pointer",
              opacity: twoFACode.replace(/\s/g, "").length < 6 ? 0.5 : 1,
              marginBottom: 10,
            }}
          >
            Verify
          </button>
          <button
            onClick={logoutUser}
            className="w-full py-2 text-xs font-bold uppercase"
            style={{ background: "transparent", border: `1px solid ${C.line}`, color: C.slate, borderRadius: 4, cursor: "pointer" }}
          >
            Sign Out
          </button>
        </div>
      </div>
    );
  }

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
            <div className="flex items-center gap-3">
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
              <UserMenu currentUser={currentUser} onOpenSettings={() => setView("settings")} />
            </div>
          </div>
          <nav className="mt-4 flex overflow-x-auto">
            <Tab id="home">Home</Tab>
            <Tab id="standings">Standings</Tab>
            <Tab id="coaches">Coaches</Tab>
            <Tab id="directory">Directory</Tab>
            <Tab id="pyramid">Rules</Tab>
            <Tab id="300club">300 Club</Tab>
            <Tab id="weeklyawards">Weekly Awards</Tab>
            <Tab id="tournament">Tournament</Tab>
            {currentUser.role === "admin" && <Tab id="admin">Admin</Tab>}
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
                  {pinnedFirstNews.list.map((n, i) => (
                    <div key={n.id}>
                      {i === pinnedFirstNews.pinnedCount && pinnedFirstNews.pinnedCount > 0 && (
                        <div
                          className="text-[10px] uppercase tracking-widest pb-2 mb-2"
                          style={{ color: C.slate, borderBottom: `1px solid ${C.line}` }}
                        >
                          rest of the news
                        </div>
                      )}
                      <article
                        className="p-3.5 rounded-sm"
                        style={{
                          background: n.pinned ? C.panelHi : C.panel,
                          border: `1px solid ${C.line}`,
                          borderLeft: n.pinned ? `3px solid ${C.gold}` : `1px solid ${C.line}`,
                        }}
                      >
                        <div className="flex items-center gap-2 text-xs mb-1.5">
                          {n.pinned && <span title="Pinned">📌</span>}
                          <span className="uppercase tracking-wider font-semibold" style={{ color: tagColor(n.tag) }}>{n.tag}</span>
                          <span style={{ color: C.slate, fontFamily: "'IBM Plex Mono', monospace" }}>{ago(n.ts)} ago</span>
                          {commish && (
                            <span className="ml-auto flex items-center gap-2 text-xs">
                              <button onClick={() => pinNews(n.id, !n.pinned)} style={{ color: C.gold }}>
                                {n.pinned ? "unpin" : "pin"}
                              </button>
                              <button onClick={() => deleteNews(n.id)} style={{ color: C.ember }}>
                                delete
                              </button>
                            </span>
                          )}
                        </div>
                        <h3 className="text-base font-semibold leading-snug">{n.title}</h3>
                        {n.body && <p className="mt-1 text-sm leading-relaxed" style={{ color: C.slate }}>{n.body}</p>}
                      </article>
                    </div>
                  ))}
                </div>
              </section>

              <section className="lg:w-96 shrink-0 flex flex-col" style={{ minHeight: "24rem" }}>
                <div className="flex items-baseline justify-between mb-3">
                  <h2 className="text-2xl uppercase leading-none" style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700 }}>
                    The Clubhouse
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
                      <div key={m.id || i} className="flex items-start gap-2">
                        <Avatar name={m.name} avatar={findCoachAvatar(m.name)} size={24} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline gap-2 text-xs">
                            <button
                              type="button"
                              onClick={() => openCoachProfile(m.name)}
                              className="font-semibold"
                              style={{ color: m.name === coachName ? C.gold : C.chalk }}
                            >
                              {m.name}
                              <TrophyBadges name={m.name} size={11} />
                            </button>
                            <span style={{ color: C.slate, fontFamily: "'IBM Plex Mono', monospace" }}>{ago(m.ts)}</span>
                            {commish && (
                              <button onClick={() => deleteChatMsg(m.id)} className="ml-auto text-xs" style={{ color: C.ember }}>
                                delete
                              </button>
                            )}
                          </div>
                          <div className="text-sm leading-snug mt-0.5">{m.text}</div>
                        </div>
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

            <div className="mt-6">
              <div className="flex items-baseline justify-between mb-1">
                <h2 className="text-2xl uppercase leading-none" style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700 }}>
                  The Hot Seat
                </h2>
                <button onClick={() => setView("standings")} className="text-xs uppercase tracking-wider" style={{ color: C.gold }}>
                  Full standings →
                </button>
              </div>
              <div className="mb-3 text-xs" style={{ color: C.slate }}>
                Last place in every league, right now. Sleep with one eye open.
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
                {TIERS.map((t) => {
                  const seat = hotSeatFor(t.key);
                  const connected = Boolean(leagueMap[t.key]);
                  return (
                    <button
                      key={t.key}
                      onClick={() => {
                        setTierKey(t.key);
                        setView("standings");
                      }}
                      className="text-left px-3 py-2.5 rounded-sm transition-colors"
                      style={{
                        background: "rgba(212,96,76,0.07)",
                        border: `1px solid ${seat ? "rgba(212,96,76,0.35)" : C.line}`,
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <span
                          className="text-xs uppercase tracking-wider"
                          style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 600, color: C.slate, letterSpacing: "0.06em" }}
                        >
                          {t.key}
                        </span>
                        {seat && <span className="text-xs" style={{ color: C.ember }}>●</span>}
                      </div>
                      {seat ? (
                        <>
                          <div className="mt-1 text-sm font-semibold truncate">{seat.coach}</div>
                          <div className="text-xs truncate" style={{ color: C.slate }}>{seat.team}</div>
                          <div className="mt-1 text-xs" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                            <span style={{ color: C.turf }}>{seat.w}</span>
                            <span style={{ color: C.slate }}>–</span>
                            <span style={{ color: C.ember }}>{seat.l}</span>
                          </div>
                        </>
                      ) : (
                        <div className="mt-1 text-xs" style={{ color: C.slate }}>
                          {mode === "live" ? (connected ? "Loading…" : "Not connected") : "Live only"}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {view === "standings" && (
          <div className="flex flex-col lg:flex-row gap-6">
            <aside className="lg:w-56 shrink-0">
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
                      <span className="ml-auto flex items-center gap-1.5">
                        {conferenceStrength[t.key] && (
                          <span
                            className="text-xs"
                            style={{ fontFamily: "'IBM Plex Mono', monospace", color: active ? C.ink : C.gold }}
                            title="Conference Strength - higher means tougher competition"
                          >
                            {conferenceStrength[t.key].score >= 0 ? "+" : ""}
                            {conferenceStrength[t.key].score.toFixed(1)}
                          </span>
                        )}
                        {connected && <span className="text-xs" style={{ color: active ? C.ink : C.turf }}>●</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="hidden lg:block mt-3 text-xs leading-relaxed" style={{ color: C.slate }}>
                Tier 1 earns the most coaching points. Finish last anywhere and you're fired. Final playoff bracket placement
                sets both next season's draft order and each team's coaching points for the season — see the breakdown
                below.
              </div>
              {SHOW_BRACKETS && placementPanel && (
                <div className="hidden lg:block mt-4">
                  <PlacementInfoPanel rows={placementPanel.rows} title={placementPanel.title} />
                </div>
              )}
            </aside>

            <section className="flex-1 min-w-0">
              <div className="flex items-baseline justify-between mb-1 gap-2 flex-wrap">
                <div className="flex items-center gap-3 min-w-0">
                  {/* League logo slot — shows real artwork when the tier has a mark in TIER_LOGOS. */}
                  <div
                    className="shrink-0 flex items-center justify-center overflow-hidden"
                    style={{
                      width: 46, height: 46, border: `1px solid ${C.line}`, borderRadius: 4,
                      background: C.panel, fontFamily: "'Barlow Condensed', sans-serif",
                      fontWeight: 700, fontSize: 17, letterSpacing: "0.04em", color: C.chalk,
                    }}
                  >
                    <TierMark tierKey={tier.key} />
                  </div>
                  <h2 className="text-3xl uppercase leading-none truncate" style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700 }}>
                    {tier.name}
                  </h2>
                </div>
                <span className="text-xs uppercase tracking-widest" style={{ color: C.slate }}>Tier {tier.tier} of 13</span>
              </div>

              {mode === "live" && (
                <div className="flex items-center gap-3 mb-3 flex-wrap">
                  <div className="flex gap-1">
                    {SEASON_OPTIONS.map((yr) => {
                      const active = yr === standingsSeason;
                      return (
                        <button
                          key={yr}
                          onClick={() => setStandingsSeason(yr)}
                          className="px-2.5 py-1 text-xs tracking-wider rounded-sm transition-colors"
                          style={{
                            fontFamily: "'IBM Plex Mono', monospace",
                            background: active ? C.gold : "transparent",
                            color: active ? C.ink : C.slate,
                            border: `1px solid ${active ? C.gold : C.line}`,
                          }}
                        >
                          {yr}
                        </button>
                      );
                    })}
                  </div>
                  {standingsSeason !== CURRENT_SEASON && (
                    <span className="text-xs" style={{ color: C.slate }}>
                      Viewing final {standingsSeason} standings — read-only, no live scoring.
                    </span>
                  )}
                </div>
              )}

              {rows ? (
                standingsGroups && standingsGroups.type === "nested" ? (
                  <div className="space-y-6">
                    {standingsGroups.groups.map((conf) => (
                      <div key={conf.name}>
                        <div className="text-sm font-semibold mb-2" style={{ color: C.gold }}>{conf.name}</div>
                        <div className="grid md:grid-cols-2 gap-4">
                          {conf.divisions.map((div) => (
                            <div key={div.name}>
                              <div className="text-xs uppercase tracking-wider mb-1.5" style={{ color: C.slate }}>{div.name}</div>
                              <StandingsTable tableRows={div.rows} />
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : standingsGroups && standingsGroups.type === "flat" ? (
                  <div className={`grid gap-4 ${standingsGroups.groups.length > 1 ? "md:grid-cols-2" : ""}`}>
                    {standingsGroups.groups.map((g) => (
                      <div key={g.name}>
                        <div className="text-sm font-semibold mb-1.5" style={{ color: C.gold }}>{g.name}</div>
                        <StandingsTable tableRows={g.rows} />
                      </div>
                    ))}
                  </div>
                ) : (
                  <StandingsTable tableRows={rows} />
                )
              ) : tierLoading ? (
                <div className="py-16 text-center text-sm" style={{ color: C.slate }}>Loading {tier.key} from Sleeper…</div>
              ) : (
                <div className="py-14 px-6 text-center rounded-sm" style={{ border: `1px dashed ${C.line}`, color: C.slate }}>
                  <div className="text-2xl uppercase mb-1" style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 600, color: C.chalk }}>
                    {tier.name}
                  </div>
                  <div className="text-sm max-w-md mx-auto">
                    {standingsSeason === CURRENT_SEASON ? (
                      <>
                        This tier hasn't been matched to its Sleeper league yet. It connects automatically when the league name
                        contains "{tier.key}" — or add its league ID to the leagueMap in src/App.jsx.
                      </>
                    ) : (
                      <>No {standingsSeason} league ID on file for this tier yet — add it to LEAGUE_HISTORY[{standingsSeason}] in src/App.jsx.</>
                    )}
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

              {SHOW_BRACKETS && standingsSeason !== CURRENT_SEASON && HISTORICAL_FINAL_ORDER[standingsSeason] && HISTORICAL_FINAL_ORDER[standingsSeason][tierKey] && (() => {
                const order = HISTORICAL_FINAL_ORDER[standingsSeason][tierKey];
                const half = Math.floor(order.length / 2);
                const groups = [
                  { label: "Playoffs", key: "playoffs", finalOrder: order.slice(0, half), startRank: 1 },
                  { label: "Consolation", key: "consolation", finalOrder: order.slice(half), startRank: half + 1, fired: true },
                ];
                const r1 = HISTORICAL_ROUND1[standingsSeason] && HISTORICAL_ROUND1[standingsSeason][tierKey];
                return (
                  <div className="mt-6 space-y-8">
                    <div>
                      <div className="text-xs uppercase tracking-widest mb-2" style={{ color: C.slate, letterSpacing: "0.2em" }}>
                        Completed Bracket — {standingsSeason}
                      </div>
                      <p className="text-xs" style={{ color: C.slate }}>
                        The real {standingsSeason} results, transcribed from the playoff sheets — Round 1 on the
                        left, confirmed final order on the right. Byes don't get a Round 1 box but still land in
                        their real final spot.
                      </p>
                    </div>
                    {groups.map((g) => (
                      <div key={g.key}>
                        <div className="text-sm font-semibold mb-2" style={{ color: C.gold }}>
                          {g.label} {g.key === "playoffs" ? `— ranks 1–${half}` : `— ranks ${half + 1}–${order.length}`}
                        </div>
                        {standingsSeason === 2025 && GRID_BRACKETS[tierKey] ? (
                          <>
                            <GridBracket data={GRID_BRACKETS[tierKey][g.key]} />
                            {g.key === "consolation" && GRID_BRACKETS[tierKey].bowls && (
                              <GBowls data={GRID_BRACKETS[tierKey].bowls} />
                            )}
                          </>
                        ) : r1 && r1[g.key] ? (
                          <CompletedBracketFlow
                            round1={r1[g.key]}
                            finalOrder={g.finalOrder}
                            startRank={g.startRank}
                            rows={rows}
                            fired={g.fired}
                          />
                        ) : (
                          <ol className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-sm" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                            {g.finalOrder.map((name, i) => {
                              const place = g.startRank + i;
                              const row = findRowByName(rows, name);
                              const isLast = g.fired && i === g.finalOrder.length - 1;
                              return (
                                <li key={place} className="flex items-center gap-2 px-2 py-1 rounded-sm" style={{ background: isLast ? "rgba(196,74,58,0.12)" : "transparent" }}>
                                  <span className="w-8 shrink-0 text-right" style={{ color: isLast ? C.ember : C.gold, fontWeight: 700 }}>{place}.</span>
                                  {row && row.avatar && <img src={row.avatar} alt="" className="w-5 h-5 rounded-sm shrink-0" />}
                                  <span className="truncate" style={{ fontWeight: 600 }}>{(row && row.team) || name}</span>
                                  {isLast && <span className="text-xs ml-auto shrink-0" style={{ color: C.ember, fontWeight: 700 }}>FIRED</span>}
                                </li>
                              );
                            })}
                          </ol>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })()}

              {SHOW_BRACKETS && liveGrid && !(HISTORICAL_FINAL_ORDER[standingsSeason] && HISTORICAL_FINAL_ORDER[standingsSeason][tierKey]) && (
                <div className="mt-6 space-y-8">
                  <div>
                    <div className="text-xs uppercase tracking-widest mb-2" style={{ color: C.slate, letterSpacing: "0.2em" }}>
                      Playoff Bracket — {standingsSeason}
                    </div>
                    <p className="text-xs" style={{ color: C.slate }}>
                      Seeded from the current standings and re-seeded as results come in — scores fill in
                      once the playoff weeks are played.
                    </p>
                  </div>
                  <div>
                    <div className="text-sm font-semibold mb-2" style={{ color: C.gold }}>Championship — ranks 1–{tier.size / 2}</div>
                    <GridBracket data={liveGrid.playoffs} />
                  </div>
                  <div>
                    <div className="text-sm font-semibold mb-2" style={{ color: C.gold }}>Consolation — ranks {tier.size / 2 + 1}–{tier.size}</div>
                    <GridBracket data={liveGrid.consolation} />
                  </div>
                </div>
              )}

              {SHOW_BRACKETS && bracket && !liveGrid && !(HISTORICAL_FINAL_ORDER[standingsSeason] && HISTORICAL_FINAL_ORDER[standingsSeason][tierKey]) && (
                <div className="mt-6">
                  <div className="text-xs uppercase tracking-widest mb-2" style={{ color: C.slate, letterSpacing: "0.2em" }}>
                    Playoff Bracket
                  </div>
                  <p className="text-xs mb-3" style={{ color: C.slate }}>
                    Based on final regular-season standings. Round-by-round results fill in as playoff weeks are played.
                  </p>

                  {bracket.format === "division-playin" ? (
                    <div className="space-y-8">
                      <div>
                        <div className="text-sm font-semibold mb-2" style={{ color: C.gold }}>Championship — ranks 1–10</div>
                        <USFLXFLBracket
                          seeds={bracket.seeds}
                          rankLabels={["Championship", "3rd Place", "5th Place", "7th Place", "9th Place"]}
                        />
                      </div>
                      {bracket.consolation && bracket.consolation.length > 0 && (
                        <div>
                          <div className="text-sm font-semibold mb-2" style={{ color: C.gold }}>Consolation — ranks 11–20</div>
                          <USFLXFLBracket
                            seeds={bracket.consolation}
                            rankLabels={["11th Place", "13th Place", "15th Place", "17th Place", "19th Place"]}
                            fired
                          />
                        </div>
                      )}
                    </div>
                  ) : bracket.format === "conference-top4" ? (
                    <div className="space-y-8">
                      <div>
                        <div className="text-sm font-semibold mb-2" style={{ color: C.gold }}>Playoffs — ranks 1–8</div>
                        <MirroredPlacementBracket
                          east={bracket.playoffGroup.east}
                          west={bracket.playoffGroup.west}
                          eastName={bracket.eastName}
                          westName={bracket.westName}
                          labels={["Championship", "3rd Place", "5th Place", "7th Place"]}
                        />
                      </div>
                      <div>
                        <div className="text-sm font-semibold mb-2" style={{ color: C.gold }}>Consolation — ranks 9–16</div>
                        <MirroredPlacementBracket
                          east={bracket.consolationGroup.east}
                          west={bracket.consolationGroup.west}
                          eastName={bracket.eastName}
                          westName={bracket.westName}
                          labels={["9th Place", "11th Place", "13th Place", "15th Place"]}
                          fired
                        />
                      </div>
                    </div>
                  ) : bracket.format === "conference-division" ? (
                    <div className="space-y-8">
                      <div>
                        <div className="text-sm font-semibold mb-2" style={{ color: C.gold }}>Playoffs</div>
                        <NFLBracket
                          east={bracket.playoffGroup.east}
                          west={bracket.playoffGroup.west}
                          eastName={bracket.eastName}
                          westName={bracket.westName}
                          rankLabels={["Championship", "3rd Place", "5th Place", "7th Place", "9th Place", "11th Place", "13th Place", "15th Place"]}
                        />
                      </div>
                      <div>
                        <div className="text-sm font-semibold mb-2" style={{ color: C.gold }}>Consolation</div>
                        <NFLBracket
                          east={bracket.consolationGroup.east}
                          west={bracket.consolationGroup.west}
                          eastName={bracket.eastName}
                          westName={bracket.westName}
                          rankLabels={["17th Place", "19th Place", "21st Place", "23rd Place", "25th Place", "27th Place", "29th Place", "31st Place"]}
                          fired
                        />
                      </div>
                    </div>
                  ) : bracket.format === "top8-cascade" || bracket.format === "division-only" ? (
                    <div className="space-y-8">
                      <div>
                        <div className="text-sm font-semibold mb-2" style={{ color: C.gold }}>Championship — ranks 1–8</div>
                        <SingleBracket8
                          seeds={bracket.playoffSeeds}
                          rankLabels={["Championship", "3rd Place", "5th Place", "7th Place"]}
                        />
                      </div>
                      <div>
                        <div className="text-sm font-semibold mb-2" style={{ color: C.gold }}>Consolation — ranks 9–16</div>
                        <SingleBracket8
                          seeds={bracket.consolationSeeds}
                          rankLabels={["9th Place", "11th Place", "13th Place", "15th Place"]}
                          fired
                        />
                      </div>
                    </div>
                  ) : null}
                </div>
              )}

              {rows && rows.some((r) => r.coach === "—") && (
                <div className="mt-6">
                  <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
                    <div className="text-xs uppercase tracking-widest" style={{ color: C.slate, letterSpacing: "0.2em" }}>
                      Open Teams
                    </div>
                    {commish && (
                      <button
                        onClick={togglePromotionWindow}
                        className="px-2.5 py-1 text-xs uppercase tracking-wider rounded-sm"
                        style={{
                          color: promotionWindowOpen ? C.ink : C.slate,
                          background: promotionWindowOpen ? C.turf : "transparent",
                          border: `1px solid ${promotionWindowOpen ? C.turf : C.line}`,
                        }}
                      >
                        Promotion window: {promotionWindowOpen ? "open" : "closed"}
                      </button>
                    )}
                  </div>
                  {!promotionWindowOpen && (
                    <div className="mb-2 text-xs" style={{ color: C.slate }}>
                      {commish
                        ? "Applications are hidden from coaches until you open the promotion window."
                        : "Applications aren't open yet — check back once the promotion window opens."}
                    </div>
                  )}
                  <div className="space-y-2">
                    {rows
                      .filter((r) => r.coach === "—")
                      .map((r) => {
                        const teamApps = applicantsForTeam(tierKey, r.team);
                        const alreadyApplied =
                          coachName && teamApps.some((a) => a.coachName.toLowerCase() === coachName.toLowerCase());
                        return (
                          <div key={r.team} className="p-3 rounded-sm" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
                            <div className="flex items-center justify-between gap-2">
                              <button type="button" onClick={() => openTeamProfile(r, tierKey)} className="font-semibold text-sm" style={{ color: "inherit" }}>
                                {r.team}
                              </button>
                              {promotionWindowOpen && (
                                <button
                                  disabled={alreadyApplied}
                                  onClick={() => applyToTeam(tierKey, r.team)}
                                  className="px-3 py-1 text-xs uppercase tracking-wider rounded-sm shrink-0"
                                  style={{
                                    background: alreadyApplied ? "transparent" : C.gold,
                                    color: alreadyApplied ? C.turf : C.ink,
                                    border: `1px solid ${alreadyApplied ? C.turf : C.gold}`,
                                    fontWeight: 600,
                                  }}
                                >
                                  {alreadyApplied ? "Applied ✓" : "Apply"}
                                </button>
                              )}
                            </div>
                            {commish && (
                              <div className="mt-2 pt-2" style={{ borderTop: `1px solid ${C.line}` }}>
                                {teamApps.length === 0 ? (
                                  <span className="text-xs" style={{ color: C.slate }}>No applicants yet.</span>
                                ) : (
                                  <ol className="space-y-1 text-xs">
                                    {teamApps.map((a, i) => {
                                      const pts = promotionPointsFor(a.coachName);
                                      const eligible = applicantEligibility(a.coachName);
                                      return (
                                        <li key={a.id || i} className="flex items-center justify-between gap-2">
                                          <button
                                            type="button"
                                            onClick={() => openCoachProfile(a.coachName)}
                                            style={{ color: C.chalk }}
                                          >
                                            {i + 1}. {a.coachName}
                                          </button>
                                          <span className="flex items-center gap-2 shrink-0">
                                            {eligible === false && (
                                              <span
                                                className="px-1.5 py-0.5 text-xs uppercase tracking-wider rounded-sm"
                                                style={{ background: "rgba(212,96,76,0.15)", color: C.ember }}
                                              >
                                                Ineligible
                                              </span>
                                            )}
                                            <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: C.gold }}>
                                              {pts === null ? "—" : fmt(pts)} PS
                                            </span>
                                          </span>
                                        </li>
                                      );
                                    })}
                                  </ol>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}
            </section>
          </div>
        )}

        {view === "coaches" && (
          <section>
            <div className="flex items-baseline justify-between mb-1 gap-2 flex-wrap">
              <h2 className="text-3xl uppercase leading-none" style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700 }}>
                Coaches
              </h2>
              <span className="text-xs uppercase tracking-widest" style={{ color: C.slate }}>{allCoachesTable.length} on file</span>
            </div>
            <p className="text-sm mb-4" style={{ color: C.slate }}>
              Every coach with career data on file, resolved to their current team. Coaching points are earned by team
              performance, weighted by tier, and accrue season over season — never spent, only built on. Click any column to sort.
            </p>
            <div className="overflow-x-auto rounded-sm" style={{ border: `1px solid ${C.line}` }}>
              <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: C.panel, color: C.slate }}>
                    {[
                      { key: "name", label: "Coach", right: false },
                      { key: "team", label: "Team", right: false },
                      { key: "tierKey", label: "Tier", right: false },
                      { key: "promotionScore", label: "Promotion Score", right: true },
                      { key: "currentCP", label: "Season CP", right: true },
                      { key: "cp", label: "Career CP", right: true },
                      { key: "wins", label: "W–L", right: true },
                      { key: "winPct", label: "Win %", right: true },
                      { key: "totalPts", label: "Career PF", right: true },
                    ].map((col) => (
                      <th
                        key={col.key}
                        onClick={() => toggleCoachSort(col.key)}
                        className="px-3 py-2 text-xs uppercase tracking-wider whitespace-nowrap cursor-pointer select-none text-center"
                        style={{ fontWeight: 500, color: coachSort.key === col.key ? C.gold : C.slate }}
                      >
                        {col.label}{coachSort.key === col.key ? (coachSort.dir === "asc" ? " ▲" : " ▼") : ""}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                  {sortedCoachesTable.map((r, i) => (
                    <tr key={r.name + i} style={{ background: i % 2 ? "rgba(255,255,255,0.02)" : "transparent", borderTop: `1px solid ${C.line}` }}>
                      <td className="px-3 py-2 whitespace-nowrap text-center" style={{ fontFamily: "'Barlow', sans-serif", fontWeight: 600 }}>
                        <button type="button" onClick={() => openCoachProfile(r.name)} style={{ color: "inherit" }}>
                          {r.name}
                          <TrophyBadges name={r.name} size={12} />
                        </button>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-center" style={{ fontFamily: "'Barlow', sans-serif", color: C.slate }}>
                        <button type="button" onClick={() => openTeamProfile(r, r.tierKey)} style={{ color: "inherit" }}>
                          {r.team}
                        </button>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap uppercase text-xs text-center" style={{ color: C.gold }}>{r.tierKey}</td>
                      <td
                        className="px-3 py-2 text-center"
                        style={{ color: r.promotionScore === -Infinity ? C.chalk : r.promotionScore > 0 ? C.turf : r.promotionScore < 0 ? C.ember : C.slate }}
                      >
                        {r.promotionScore === -Infinity ? "—" : `${r.promotionScore >= 0 ? "+" : ""}${fmt(r.promotionScore)}`}
                      </td>
                      <td
                        className="px-3 py-2 text-center"
                        style={{ color: r.currentCP === -Infinity ? C.chalk : r.currentCP > 0 ? C.turf : r.currentCP < 0 ? C.ember : C.slate }}
                      >
                        {r.currentCP === -Infinity ? "—" : `${r.currentCP >= 0 ? "+" : ""}${fmt(r.currentCP)}`}
                      </td>
                      <td className="px-3 py-2 text-center" style={{ color: C.gold, fontWeight: 600 }}>
                        {r.cp === -Infinity ? "—" : fmt(r.cp)}
                      </td>
                      <td className="px-3 py-2 text-center whitespace-nowrap">
                        {r.record === "—" || !r.record ? (
                          "—"
                        ) : (
                          <>
                            <span style={{ color: C.turf }}>{r.wins}</span>
                            <span style={{ color: C.slate }}>–</span>
                            <span style={{ color: C.ember }}>{r.losses}</span>
                          </>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center">{r.winPct === -Infinity ? "—" : winPctLabel(r.winPct)}</td>
                      <td className="px-3 py-2 text-center">{r.totalPts === -Infinity ? "—" : fmt(r.totalPts)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs" style={{ color: C.slate }}>
              Static snapshot from the Admin tab export — refreshes whenever a new export is provided, not automatically.
            </p>
          </section>
        )}

        {view === "directory" && (
          <section>
            <div className="flex items-baseline justify-between mb-1 gap-2 flex-wrap">
              <h2 className="text-3xl uppercase leading-none" style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700 }}>
                Directory
              </h2>
              <span className="text-xs uppercase tracking-widest" style={{ color: C.slate }}>
                {coachDirectory.length} in the Alliance
              </span>
            </div>
            <p className="text-sm mb-4" style={{ color: C.slate }}>
              Look up any coach by name, team, or conference. Full career records and titles land here once the Alliance sheet
              feed is connected — for now this shows who's currently coaching where.
            </p>
            <input
              value={dirQuery}
              onChange={(e) => setDirQuery(e.target.value)}
              placeholder="Search by coach, team, or conference…"
              className="w-full px-3 py-2 text-sm rounded-sm outline-none mb-4"
              style={{ background: C.panel, border: `1px solid ${C.line}`, color: C.chalk }}
            />
            {mode !== "live" && (
              <div className="mb-4 text-xs" style={{ color: C.slate }}>
                Directory populates from live Sleeper data — currently showing sample NFL coaches only.
              </div>
            )}
            {dirGroups.map((g) => (
              <div key={g.tier.key} className="mb-6">
                <DirBand tier={g.tier} count={g.coaches.length} strength={conferenceStrength[g.tier.key]} />
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                  {g.coaches.map((c, i) => (
                    <button
                      type="button"
                      key={(c.userId || c.name) + i}
                      onClick={() => openCoachProfile(c.name)}
                      className="flex items-center gap-2.5 px-3 py-2.5 rounded-sm text-left transition-colors"
                      style={{ background: C.panel, border: `1px solid ${C.line}` }}
                    >
                      <Avatar name={c.name} avatar={c.avatar} size={38} />
                      <div className="min-w-0">
                        <div className="text-sm font-semibold truncate">
                          {c.base}
                          {c.tag && (
                            <span className="uppercase" style={{
                              fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", color: C.gold,
                              border: `1px solid ${C.goldDim}`, borderRadius: 2,
                              padding: "0 3px", marginLeft: 5, verticalAlign: 1,
                            }}>{c.tag}</span>
                          )}
                          <TrophyBadges name={c.name} size={12} />
                        </div>
                        <div className="text-xs truncate" style={{ color: C.slate }}>{c.team}</div>
                      </div>
                    </button>
                  ))}
                  {g.openTeams.map((t, i) => (
                    <button
                      type="button"
                      key={t.team + i}
                      onClick={() => openTeamProfile(t, t.tierKey)}
                      className="flex items-center gap-2.5 px-3 py-2.5 rounded-sm text-left transition-colors"
                      style={{ background: C.panel, border: `1px solid ${C.turf}` }}
                    >
                      <TeamMark team={t.team} tierKey={t.tierKey} size={38} />
                      <div className="min-w-0">
                        <div className="text-sm font-semibold uppercase tracking-wider" style={{ color: C.turf }}>Apply</div>
                        <div className="text-xs truncate" style={{ color: C.slate }}>{t.team}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {dirGroups.length === 0 && (
              <div className="py-10 text-center text-sm" style={{ color: C.slate }}>
                Nothing matches that search.
              </div>
            )}
          </section>
        )}

        {view === "pyramid" && (
          <div className="flex flex-col lg:flex-row gap-8 items-start">
          <section className="max-w-2xl">
            <h2 className="text-3xl uppercase mb-3" style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700 }}>
              Rules
            </h2>
            <div className="space-y-3 text-sm leading-relaxed">
              <p>
                The Alliance is thirteen dynasty leagues in ranked tiers, from the NFL down to Florida High School. All leagues
                share the same roster, waivers, draft, and scoring settings, and use only NFL players.
              </p>
              <p>
                Your team's performance earns you a <span style={{ color: C.gold }}>coaching score</span>. Leagues are weighted so
                coaches in higher tiers earn more coaching points than coaches in lower tiers, and points accumulate season over
                season — long-term success is rewarded over any one great year.
              </p>
              <p>
                You'll use that coaching score to compete against other coaches to promote into higher leagues or more desirable
                teams. Coaches who finish last or underperform may be <span style={{ color: C.ember }}>fired</span> — unassigned,
                not removed. Your team becomes available for other coaches to take, and you'll have to go look for an opportunity
                with another team, possibly in a lower tier.
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
                    minWidth: "13rem",
                  }}
                >
                  <span className="text-xs w-5 text-right" style={{ fontFamily: "'IBM Plex Mono', monospace", color: C.slate }}>{t.tier}</span>
                  <span className="uppercase text-sm" style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 600, letterSpacing: "0.08em", color: t.tier === 1 ? C.gold : C.chalk }}>
                    {t.name}
                  </span>
                  <span className="ml-auto text-xs shrink-0" style={{ fontFamily: "'IBM Plex Mono', monospace", color: C.slate }}>
                    {t.size} roster
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs" style={{ color: C.slate }}>
              232 teams total. Every roster carries a 20-man bench and an 8-player taxi squad — eligibility varies by
              tier, see Taxi Squad in Settings.
            </p>

            <div className="mt-8 space-y-2">
              {RULES_SECTIONS.map((sec) => {
                const open = Boolean(openRuleSections[sec.id]);
                return (
                  <div key={sec.id} className="rounded-sm overflow-hidden" style={{ border: `1px solid ${C.line}` }}>
                    <button
                      type="button"
                      onClick={() => setOpenRuleSections((prev) => ({ ...prev, [sec.id]: !prev[sec.id] }))}
                      className="w-full flex items-center justify-between px-3 py-2.5 text-left"
                      style={{ background: C.panel }}
                    >
                      <span className="uppercase text-sm" style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 600, letterSpacing: "0.06em" }}>
                        {sec.title}
                      </span>
                      <span className="text-xs" style={{ color: C.gold }}>{open ? "−" : "+"}</span>
                    </button>
                    {open && (
                      <div className="px-4 py-3" style={{ background: C.ink }}>
                        {sec.intro && (
                          <p className="text-xs mb-3" style={{ color: C.slate }}>{sec.intro}</p>
                        )}
                        {sec.items && (
                          <ul className="space-y-2 text-sm leading-relaxed list-disc pl-4">
                            {sec.items.map((item, i) => (
                              <li key={i} style={{ color: C.chalk }}>{item}</li>
                            ))}
                          </ul>
                        )}
                        {sec.rows && (
                          <div className="space-y-1">
                            {sec.rows.map((row, i) => (
                              <div key={i} className="flex items-center gap-3 py-1" style={{ borderTop: i > 0 ? `1px solid ${C.line}` : "none" }}>
                                <span
                                  className="text-xs shrink-0 px-2 py-0.5 rounded-sm text-right"
                                  style={{
                                    minWidth: "4.5rem",
                                    fontFamily: "'IBM Plex Mono', monospace",
                                    fontWeight: 600,
                                    color: row.value.trim().startsWith("-") ? C.ember : C.turf,
                                    background: row.value.trim().startsWith("-") ? "rgba(212,96,76,0.1)" : "rgba(87,180,120,0.1)",
                                  }}
                                >
                                  {row.value}
                                </span>
                                <span className="text-sm" style={{ color: C.chalk }}>{row.label}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="mt-8 pt-4 text-xs" style={{ borderTop: `1px solid ${C.line}`, color: C.slate }}>
              <div>Alliance creator: <span style={{ color: C.chalk, fontWeight: 600 }}>PwnRangr</span></div>
              <div className="mt-1">Contributors: Davidsstone, Deevel, Gavdjedi, Vastettler</div>
            </div>
          </section>

          <section className="flex-1 min-w-0">
            <h2 className="text-3xl uppercase mb-3" style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700 }}>
              Settings
            </h2>
            <p className="text-sm mb-5" style={{ color: C.slate }}>
              Every league runs the same roster, scoring, and league settings — pulled directly from the Alliance's
              Sleeper configuration.
            </p>

            <div className="rounded-sm p-3.5 mb-6" style={{ border: `1px solid ${C.line}`, background: C.panel }}>
              <div
                className="uppercase text-sm mb-2"
                style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 600, letterSpacing: "0.06em" }}
              >
                Roster
              </div>
              <p className="text-sm leading-relaxed" style={{ color: C.chalk }}>
                {SETTINGS_ROSTER.starters.length} starters — {SETTINGS_ROSTER.starters.join(", ")}
              </p>
              <p className="text-xs mt-2" style={{ color: C.slate }}>
                Plus a {SETTINGS_ROSTER.bench}-man bench, {SETTINGS_ROSTER.ir}-man IR, and {SETTINGS_ROSTER.taxi}-man
                taxi squad (eligibility below).
              </p>
            </div>

            <div
              className="uppercase text-sm mb-2"
              style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 600, letterSpacing: "0.06em" }}
            >
              Scoring
            </div>
            <div className="space-y-2 mb-6">
              {SETTINGS_SCORING_SECTIONS.map((sec) => {
                const open = Boolean(openRuleSections[sec.id]);
                return (
                  <div key={sec.id} className="rounded-sm overflow-hidden" style={{ border: `1px solid ${C.line}` }}>
                    <button
                      type="button"
                      onClick={() => setOpenRuleSections((prev) => ({ ...prev, [sec.id]: !prev[sec.id] }))}
                      className="w-full flex items-center justify-between px-3 py-2.5 text-left"
                      style={{ background: C.panel }}
                    >
                      <span className="uppercase text-sm" style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 600, letterSpacing: "0.06em" }}>
                        {sec.title}
                      </span>
                      <span className="text-xs" style={{ color: C.gold }}>{open ? "\u2212" : "+"}</span>
                    </button>
                    {open && (
                      <div className="px-4 py-3" style={{ background: C.ink }}>
                        {sec.intro && <p className="text-xs mb-3" style={{ color: C.slate }}>{sec.intro}</p>}
                        <div className="space-y-1">
                          {sec.rows.map((row, i) => (
                            <div key={i} className="flex items-center gap-3 py-1" style={{ borderTop: i > 0 ? `1px solid ${C.line}` : "none" }}>
                              <span
                                className="text-xs shrink-0 px-2 py-0.5 rounded-sm text-right"
                                style={{
                                  minWidth: "3.5rem",
                                  fontFamily: "'IBM Plex Mono', monospace",
                                  fontWeight: 600,
                                  color: row.value.trim().startsWith("-") ? C.ember : C.turf,
                                  background: row.value.trim().startsWith("-") ? "rgba(212,96,76,0.1)" : "rgba(87,180,120,0.1)",
                                }}
                              >
                                {row.value}
                              </span>
                              <span className="text-sm" style={{ color: C.chalk }}>
                                {row.label}
                                {row.note && <span style={{ color: C.slate }}> \u2014 {row.note}</span>}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div
              className="uppercase text-sm mb-2"
              style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 600, letterSpacing: "0.06em" }}
            >
              League Settings
            </div>
            <div className="space-y-2">
              {SETTINGS_LEAGUE_SECTIONS.map((sec) => {
                const open = Boolean(openRuleSections[sec.id]);
                return (
                  <div key={sec.id} className="rounded-sm overflow-hidden" style={{ border: `1px solid ${C.line}` }}>
                    <button
                      type="button"
                      onClick={() => setOpenRuleSections((prev) => ({ ...prev, [sec.id]: !prev[sec.id] }))}
                      className="w-full flex items-center justify-between px-3 py-2.5 text-left"
                      style={{ background: C.panel }}
                    >
                      <span className="uppercase text-sm" style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 600, letterSpacing: "0.06em" }}>
                        {sec.title}
                      </span>
                      <span className="text-xs" style={{ color: C.gold }}>{open ? "\u2212" : "+"}</span>
                    </button>
                    {open && (
                      <div className="px-4 py-3" style={{ background: C.ink }}>
                        <ul className="space-y-2 text-sm leading-relaxed list-disc pl-4">
                          {sec.items.map((item, i) => (
                            <li key={i} style={{ color: C.chalk }}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
          </div>
        )}

        {view === "300club" && (
          <div className="flex flex-col lg:flex-row gap-6">
            <section className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-1">
                <div
                  className="shrink-0 flex items-center justify-center overflow-hidden"
                  style={{
                    width: 46, height: 46, border: `1px solid ${C.line}`, borderRadius: 4,
                    background: C.panel,
                  }}
                >
                  <Club300Mark />
                </div>
                <h2 className="text-3xl uppercase leading-none" style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700 }}>
                  The 300 Club
                </h2>
              </div>
              <p className="text-sm mb-4" style={{ color: C.slate }}>
                300+ points in a single game. Immortality, in decimals. {club300All.length} games and counting.
              </p>
              <input
                value={club300Query}
                onChange={(e) => setClub300Query(e.target.value)}
                placeholder="Search by coach or team…"
                className="w-full px-3 py-2 text-sm rounded-sm outline-none mb-3"
                style={{ background: C.panel, border: `1px solid ${C.line}`, color: C.chalk }}
              />
              <div className="space-y-1.5 overflow-y-auto" style={{ maxHeight: "42rem" }}>
                {club300All.filter((r) => {
                  const q = club300Query.trim().toLowerCase();
                  if (!q) return true;
                  return r.coach.toLowerCase().includes(q) || r.team.toLowerCase().includes(q);
                }).map((r, i) => (
                  <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-sm" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
                    <span className="text-xl leading-none w-20 shrink-0" style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, color: C.gold }}>
                      {fmt(r.pts)}
                    </span>
                    <TeamMark team={r.team} tierKey={CONF_TO_TIER_KEY[r.conf] || r.conf} size={38} />
                    <div className="min-w-0 flex-1">
                      <button type="button" onClick={() => openCoachProfile(r.coach)} className="text-sm font-semibold truncate block" style={{ color: "inherit" }}>
                        {r.coach}
                        <TrophyBadges name={r.coach} size={11} />
                      </button>
                      <div className="text-xs truncate" style={{ color: C.slate }}>
                        <button
                          type="button"
                          onClick={() => openTeamProfile({ team: r.team, maxPts: undefined, playerIds: [] }, CONF_TO_TIER_KEY[r.conf] || r.conf)}
                          style={{ color: "inherit" }}
                        >
                          {r.team}
                        </button>{" "}
                        · {r.conf} · Wk {r.week}, {r.year}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <aside className="lg:w-72 shrink-0 space-y-6">
              <div>
                <div className="text-xs uppercase tracking-widest mb-2" style={{ color: C.slate, letterSpacing: "0.2em" }}>
                  MVP · Most Appearances
                </div>
                <div className="space-y-1">
                  {club300TopCoaches.map(([name, count]) => (
                    <button
                      type="button"
                      key={name}
                      onClick={() => openCoachProfile(name)}
                      className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-sm text-sm text-left"
                      style={{ background: C.panel, border: `1px solid ${C.line}` }}
                    >
                      <span className="truncate">
                        {name}
                        <TrophyBadges name={name} size={11} />
                      </span>
                      <span className="shrink-0 ml-2" style={{ fontFamily: "'IBM Plex Mono', monospace", color: C.gold }}>{count}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-xs uppercase tracking-widest mb-2" style={{ color: C.slate, letterSpacing: "0.2em" }}>
                  Most 300pt Teams
                </div>
                <div className="space-y-1">
                  {club300TopTeams.map(([name, count]) => (
                    <div key={name} className="flex items-center justify-between px-2.5 py-1.5 rounded-sm text-sm" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
                      <span className="truncate" style={{ color: C.chalk }}>{name}</span>
                      <span className="shrink-0 ml-2" style={{ fontFamily: "'IBM Plex Mono', monospace", color: C.gold }}>{count}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-xs uppercase tracking-widest mb-2" style={{ color: C.slate, letterSpacing: "0.2em" }}>
                  By Conference
                </div>
                <div className="space-y-1">
                  {club300ByConf.map(([conf, count]) => {
                    const max = club300ByConf[0][1];
                    return (
                      <div key={conf} className="flex items-center gap-2 text-xs">
                        <span className="w-12 shrink-0 uppercase" style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 600, color: C.slate }}>{conf}</span>
                        <div className="flex-1 rounded-sm overflow-hidden" style={{ background: C.ink, height: "0.9rem" }}>
                          <div style={{ width: `${(count / max) * 100}%`, background: C.gold, height: "100%" }} />
                        </div>
                        <span className="w-5 text-right shrink-0" style={{ fontFamily: "'IBM Plex Mono', monospace", color: C.chalk }}>{count}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </aside>
          </div>
        )}

        {view === "weeklyawards" && (
          <div>
            <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
              <h2 className="text-3xl uppercase leading-none" style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700 }}>
                Weekly Awards
              </h2>
              {weeklyAwardsWeek != null && (
                <span className="text-xs uppercase tracking-widest" style={{ color: C.slate, letterSpacing: "0.2em" }}>
                  {weeklyAwardsSeason} · Week {weeklyAwardsWeek}
                </span>
              )}
            </div>
            <p className="text-sm mb-4" style={{ color: C.slate }}>
              The Alliance's best, worst, and closest — one week at a time, across all 13 tiers.
            </p>

            {mode === "live" && (
              <div className="mb-4">
                <div className="flex gap-1 mb-2 flex-wrap">
                  {SEASON_OPTIONS.map((yr) => {
                    const active = yr === weeklyAwardsSeason;
                    return (
                      <button
                        key={yr}
                        onClick={() => setWeeklyAwardsSeason(yr)}
                        className="px-2.5 py-1 text-xs tracking-wider rounded-sm transition-colors"
                        style={{
                          fontFamily: "'IBM Plex Mono', monospace",
                          background: active ? C.gold : "transparent",
                          color: active ? C.ink : C.slate,
                          border: `1px solid ${active ? C.gold : C.line}`,
                        }}
                      >
                        {yr}
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-center gap-1 flex-wrap">
                  <span className="text-xs uppercase tracking-widest mr-1" style={{ color: C.slate, letterSpacing: "0.15em" }}>
                    Week
                  </span>
                  {WEEK_OPTIONS.map((wk) => {
                    const active = wk === weeklyAwardsWeek;
                    const future = weeklyAwardsSeason === CURRENT_SEASON && nflState && wk > nflState.week;
                    return (
                      <button
                        key={wk}
                        disabled={future}
                        onClick={() => setWeeklyAwardsWeek(wk)}
                        className="w-7 h-7 text-xs rounded-sm transition-colors"
                        style={{
                          fontFamily: "'IBM Plex Mono', monospace",
                          background: active ? C.gold : "transparent",
                          color: future ? C.line : active ? C.ink : C.slate,
                          border: `1px solid ${active ? C.gold : C.line}`,
                          cursor: future ? "default" : "pointer",
                        }}
                      >
                        {wk}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {mode !== "live" ? (
              <div className="text-sm" style={{ color: C.slate }}>
                Weekly Awards need a live connection — check back once the site's connected to Sleeper.
              </div>
            ) : weeklyAwardsLoading ? (
              <div className="text-sm" style={{ color: C.slate }}>
                Loading every tier's week {weeklyAwardsWeek}…
              </div>
            ) : !weeklyAwards ? (
              <div className="text-sm" style={{ color: C.slate }}>
                No games found for week {weeklyAwardsWeek}, {weeklyAwardsSeason} yet.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <AwardCard label="Alliance High Score" side={weeklyAwards.highScore} valueColor={C.turf} cp={5} />
                <AwardCard label="Alliance Low Score" side={weeklyAwards.lowScore} valueColor={C.ember} cp={-5} />
                <AwardCard label="Least Bench Points" side={weeklyAwards.bestBench} valueKey="benchPoints" valueColor={C.turf} cp={5} />
                <AwardCard label="Most Bench Points" side={weeklyAwards.worstBench} valueKey="benchPoints" valueColor={C.ember} cp={-5} />
                <AwardPairCard label="Closest Margin" pair={weeklyAwards.closest} value={weeklyAwards.closest.margin} />
                <AwardPairCard label="Biggest Blowout" pair={weeklyAwards.blowout} value={weeklyAwards.blowout.margin} />
                <AwardPairCard label="Highest-Scoring Loss" pair={weeklyAwards.highLoss} value={weeklyAwards.highLoss.loserPts} markLoser />
              </div>
            )}

            {mode === "live" && !weeklyAwardsLoading && leagueWeeklyAwards.length > 0 && (
              <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div>
                  <div className="text-xs uppercase tracking-widest mb-2" style={{ color: C.slate, letterSpacing: "0.2em" }}>
                    By League — High Score
                  </div>
                  <div className="space-y-1.5">
                    {leagueHighScoresSorted.map(({ tierKey, highScore }) => (
                      <LeagueAwardRow key={tierKey} side={highScore} tierKey={tierKey} valueKey="points" valueColor={C.turf} />
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-widest mb-2" style={{ color: C.slate, letterSpacing: "0.2em" }}>
                    By League — Least Bench Points
                  </div>
                  <div className="space-y-1.5">
                    {leagueLeastBenchSorted.map(({ tierKey, leastBench }) => (
                      <LeagueAwardRow key={tierKey} side={leastBench} tierKey={tierKey} valueKey="benchPoints" valueColor={C.turf} />
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {view === "tournament" && (
          <div>
            <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
              <h2 className="text-3xl uppercase leading-none" style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700 }}>
                {TOURNAMENT_NAME}
              </h2>
              {nflState && (
                <span className="text-xs uppercase tracking-widest" style={{ color: C.slate, letterSpacing: "0.2em" }}>
                  {CURRENT_SEASON} · Week {nflState.week}
                </span>
              )}
            </div>
            <p className="text-sm mb-4" style={{ color: C.slate }}>
              The top 20 teams across every tier, seeded by record then points, in a single-elimination
              knockout — Week 8 through Week 12.
            </p>

            {mode !== "live" ? (
              <div className="text-sm" style={{ color: C.slate }}>
                The Tournament needs a live connection — check back once the site's connected to Sleeper.
              </div>
            ) : !tourneySeeds ? (
              <div className="text-sm" style={{ color: C.slate }}>
                {nflState && nflState.week >= 8
                  ? "Setting the bracket…"
                  : `Seeds lock in once Week 8 begins — check back then.`}
              </div>
            ) : (
              <>
                <div className="rounded-sm overflow-hidden mb-6" style={{ background: C.panel, border: `1px solid ${C.line}`, padding: 16 }}>
                  <TournamentBracket data={{ seeds: tourneySeeds, games: tourneyGames, cp: tourneyCP }} />
                </div>
                <div>
                  <div className="text-xs uppercase tracking-widest mb-2" style={{ color: C.slate, letterSpacing: "0.2em" }}>
                    Seeds
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                    {tourneySeeds.map((s) => (
                      <div key={s.seed} className="flex items-center gap-2 px-2 py-1.5 rounded-sm text-xs" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
                        <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: C.gold, width: 18 }}>{s.seed}</span>
                        <span className="truncate" style={{ color: C.chalk }}>{s.team}</span>
                        <span className="ml-auto shrink-0 uppercase" style={{ color: C.slate, fontSize: 10 }}>{s.tierKey}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {view === "settings" && (
          <SettingsPanel currentUser={currentUser} onUpdate={handleProfileUpdate} onAccountDeleted={handleAccountDeleted} />
        )}

        {view === "admin" && currentUser.role === "admin" && <AdminPanel currentUser={currentUser} />}
      </main>

      <Footer />

      <CoachProfileModal coach={selectedCoach} onClose={() => setSelectedCoach(null)} />
      <TeamProfileModal
        team={selectedTeam}
        onClose={() => setSelectedTeam(null)}
        draftPicks={selectedTeam ? ownedPicksFor(selectedTeam.leagueId, selectedTeam.rosterId) : null}
        draftPicksLoading={selectedTeam ? Boolean(draftDataLoading[selectedTeam.leagueId]) : false}
        sheetRosterLinks={sheetRosterLinks}
      />
    </div>
  );
}
