import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  firebaseReady,
  watchChat,
  sendChat,
  watchNews,
  postNewsItem,
  removeNewsItem,
  removeChatMessage,
  getCoachName,
  setCoachNameStored,
  watchApplications,
  submitApplication,
  watchPromotionWindow,
  setPromotionWindow,
} from "./storage.js";

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

// Confirmed final placements (1st through last), transcribed directly from
// Lainey's real playoff-sheet PDFs/screenshots — NOT computed from Sleeper
// data, since Sleeper's own bracket data for this custom full-cascade format
// is unconfirmed (see the console-log check added earlier). Team names here
// are exactly as they appeared that season, since that's what needs to match
// against that season's own fetched standings rows (team display names can
// change between seasons). Add more seasons/tiers here as they're confirmed.
const HISTORICAL_FINAL_ORDER = {
  2025: {
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
  "beardmantv": [{ "tierKey": "SEC", "team": "Auburn TIGERS", "stats": { "Career CP": "547.81", "Career Avg CP": "136.95", "Record": "34-34", "Win %": "50.0%", "Total Points": "14220.20", "Avg Pts / Season": "203.52", "Alliance High Score": "0", "Alliance Low Score": "5", "League High Score": "2", "League Low Score": "5", "Best Manager": "-3", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "1" } }],
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
  "coopdaddy510": [{ "tierKey": "BIG XII", "team": "Arizona Wildcats", "stats": { "Career CP": "546.90", "Career Avg CP": "136.73", "Record": "31-20", "Win %": "60.8%", "Total Points": "10839.05", "Avg Pts / Season": "204.62", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "1", "League Low Score": "0", "Best Manager": "1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "4" } }],
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
  "dirtybyrd30": [{ "tierKey": "USFL", "team": "Chicago Blitz", "stats": { "Career CP": "811.22", "Career Avg CP": "202.80", "Record": "50-18", "Win %": "73.5%", "Total Points": "16752.30", "Avg Pts / Season": "239.39", "Alliance High Score": "2", "Alliance Low Score": "1", "League High Score": "12", "League Low Score": "1", "Best Manager": "2", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "4" } }, { "tierKey": "XFL", "team": "Dallas Renegades", "stats": { "Career CP": "136.58", "Career Avg CP": "34.15", "Record": "9-8", "Win %": "52.9%", "Total Points": "3572.95", "Avg Pts / Season": "99.25", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "1", "League Low Score": "0", "Best Manager": "-1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }, { "tierKey": "SWAC", "team": "Jackston State Tigers", "stats": { "Career CP": "811.22", "Career Avg CP": "202.80", "Record": "50-18", "Win %": "73.5%", "Total Points": "16752.30", "Avg Pts / Season": "239.39", "Alliance High Score": "2", "Alliance Low Score": "1", "League High Score": "12", "League Low Score": "1", "Best Manager": "2", "Conference Wins": "1", "Division Wins": "0", "Playoff Wins": "4" } }],
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
  "greek11 l": [{ "tierKey": "GLIAC", "team": "HeidelBurg StudentPrinces", "stats": { "Career CP": "152.13", "Career Avg CP": "38.03", "Record": "16-18", "Win %": "47.1%", "Total Points": "6565.40", "Avg Pts / Season": "187.76", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "0", "League Low Score": "0", "Best Manager": "-4", "Conference Wins": "1", "Division Wins": "0", "Playoff Wins": "0" } }],
  "harold2576": [{ "tierKey": "GLIAC", "team": "Davenport Panthers", "stats": { "Career CP": "532.67", "Career Avg CP": "133.17", "Record": "37-14", "Win %": "72.5%", "Total Points": "11581.30", "Avg Pts / Season": "218.69", "Alliance High Score": "0", "Alliance Low Score": "1", "League High Score": "12", "League Low Score": "1", "Best Manager": "3", "Conference Wins": "1", "Division Wins": "0", "Playoff Wins": "3" } }],
  "harvey28": [{ "tierKey": "NFL", "team": "Tennessee Titans", "stats": { "Career CP": "811.43", "Career Avg CP": "202.86", "Record": "44-24", "Win %": "64.7%", "Total Points": "12632.05", "Avg Pts / Season": "181.75", "Alliance High Score": "0", "Alliance Low Score": "8", "League High Score": "3", "League Low Score": "8", "Best Manager": "2", "Conference Wins": "2", "Division Wins": "1", "Playoff Wins": "9" } }, { "tierKey": "XFL", "team": "—", "stats": { "Career CP": "26.80", "Career Avg CP": "6.70", "Record": "—", "Win %": "—", "Total Points": "—", "Avg Pts / Season": "145.68", "Alliance High Score": "0", "Alliance Low Score": "1", "League High Score": "0", "League Low Score": "1", "Best Manager": "-6", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "huibuh": [{ "tierKey": "NFL", "team": "Oakland Raiders", "stats": { "Career CP": "946.61", "Career Avg CP": "236.65", "Record": "41-27", "Win %": "60.3%", "Total Points": "12614.50", "Avg Pts / Season": "180.23", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "11", "League Low Score": "0", "Best Manager": "5", "Conference Wins": "3", "Division Wins": "3", "Playoff Wins": "6" } }],
  "illustrious_fox_1": [{ "tierKey": "TEN", "team": "—", "stats": { "Career CP": "744.41", "Career Avg CP": "186.10", "Record": "—", "Win %": "—", "Total Points": "—", "Avg Pts / Season": "212.54", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "5", "League Low Score": "0", "Best Manager": "0", "Conference Wins": "1", "Division Wins": "1", "Playoff Wins": "2" } }],
  "iloveolave": [{ "tierKey": "SWAC", "team": "Princeton Tigers", "stats": { "Career CP": "92.71", "Career Avg CP": "23.18", "Record": "—", "Win %": "—", "Total Points": "—", "Avg Pts / Season": "88.90", "Alliance High Score": "0", "Alliance Low Score": "4", "League High Score": "0", "League Low Score": "4", "Best Manager": "-1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "jamie04": [{ "tierKey": "BIG XII", "team": "Houston Cougars", "stats": { "Career CP": "248.88", "Career Avg CP": "62.22", "Record": "20-14", "Win %": "58.8%", "Total Points": "7230.95", "Avg Pts / Season": "206.71", "Alliance High Score": "0", "Alliance Low Score": "1", "League High Score": "3", "League Low Score": "1", "Best Manager": "3", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "3" } }, { "tierKey": "SOCO", "team": "Tennessee Martin Skyhawks", "stats": { "Career CP": "258.19", "Career Avg CP": "64.55", "Record": "18-16", "Win %": "52.9%", "Total Points": "7330.60", "Avg Pts / Season": "209.47", "Alliance High Score": "0", "Alliance Low Score": "1", "League High Score": "3", "League Low Score": "1", "Best Manager": "1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "3" } }],
  "jaquise": [{ "tierKey": "SOCO", "team": "Austin Peay Governors", "stats": { "Career CP": "566.33", "Career Avg CP": "141.58", "Record": "40-28", "Win %": "58.8%", "Total Points": "15087.00", "Avg Pts / Season": "215.64", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "8", "League Low Score": "0", "Best Manager": "4", "Conference Wins": "1", "Division Wins": "1", "Playoff Wins": "0" } }],
  "jay21177": [{ "tierKey": "IVY", "team": "Yale bulldogs", "stats": { "Career CP": "499.67", "Career Avg CP": "124.92", "Record": "27-41", "Win %": "39.7%", "Total Points": "13596.25", "Avg Pts / Season": "194.64", "Alliance High Score": "0", "Alliance Low Score": "5", "League High Score": "1", "League Low Score": "5", "Best Manager": "-2", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "2" } }],
  "jjbinc int": [{ "tierKey": "SOCO", "team": "VMI Keydets", "stats": { "Career CP": "182.33", "Career Avg CP": "45.58", "Record": "16-18", "Win %": "47.1%", "Total Points": "6624.60", "Avg Pts / Season": "189.62", "Alliance High Score": "1", "Alliance Low Score": "6", "League High Score": "2", "League Low Score": "6", "Best Manager": "-2", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }, { "tierKey": "GLIAC", "team": "Lake Superior Lakers", "stats": { "Career CP": "102.13", "Career Avg CP": "25.53", "Record": "12-22", "Win %": "35.3%", "Total Points": "6631.95", "Avg Pts / Season": "190.08", "Alliance High Score": "1", "Alliance Low Score": "19", "League High Score": "17", "League Low Score": "19", "Best Manager": "-5", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "jjbinc l": [{ "tierKey": "FLHS", "team": "—", "stats": { "Career CP": "263.08", "Career Avg CP": "65.77", "Record": "—", "Win %": "—", "Total Points": "—", "Avg Pts / Season": "204.26", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "3", "League Low Score": "0", "Best Manager": "1", "Conference Wins": "1", "Division Wins": "2", "Playoff Wins": "1" } }],
  "jmullen175": [{ "tierKey": "ACC", "team": "—", "stats": { "Career CP": "106.56", "Career Avg CP": "26.64", "Record": "9-8", "Win %": "52.9%", "Total Points": "3413.95", "Avg Pts / Season": "94.83", "Alliance High Score": "0", "Alliance Low Score": "2", "League High Score": "1", "League Low Score": "2", "Best Manager": "0", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "johnjohn882": [{ "tierKey": "ACC", "team": "Boston College Eagles", "stats": { "Career CP": "430.91", "Career Avg CP": "107.73", "Record": "28-40", "Win %": "41.2%", "Total Points": "12651.30", "Avg Pts / Season": "180.73", "Alliance High Score": "0", "Alliance Low Score": "10", "League High Score": "3", "League Low Score": "10", "Best Manager": "-7", "Conference Wins": "1", "Division Wins": "1", "Playoff Wins": "0" } }],
  "johnzy4": [{ "tierKey": "SOCO", "team": "Chatanooga Mocs", "stats": { "Career CP": "161.77", "Career Avg CP": "40.44", "Record": "—", "Win %": "—", "Total Points": "—", "Avg Pts / Season": "188.53", "Alliance High Score": "1", "Alliance Low Score": "1", "League High Score": "6", "League Low Score": "6", "Best Manager": "-14", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "1" } }],
  "jorgeortiz11": [{ "tierKey": "NFL", "team": "Kansas City Chiefs", "stats": { "Career CP": "274.90", "Career Avg CP": "68.73", "Record": "18-16", "Win %": "52.9%", "Total Points": "7336.45", "Avg Pts / Season": "209.77", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "4", "League Low Score": "0", "Best Manager": "0", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "3" } }],
  "josssock": [{ "tierKey": "NFL", "team": "New England Patriots", "stats": { "Career CP": "962.18", "Career Avg CP": "240.55", "Record": "47-21", "Win %": "69.1%", "Total Points": "12802.65", "Avg Pts / Season": "182.78", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "9", "League Low Score": "0", "Best Manager": "-1", "Conference Wins": "0", "Division Wins": "2", "Playoff Wins": "5" } }],
  "justin_white": [{ "tierKey": "SWAC", "team": "—", "stats": { "Career CP": "0.00", "Career Avg CP": "0.00", "Record": "—", "Win %": "—", "Total Points": "—", "Avg Pts / Season": "—", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "0", "League Low Score": "0", "Best Manager": "0", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "juugking": [{ "tierKey": "BIG XII", "team": "Iowa State Cyclones", "stats": { "Career CP": "800.43", "Career Avg CP": "200.11", "Record": "44-24", "Win %": "64.7%", "Total Points": "15379.80", "Avg Pts / Season": "219.60", "Alliance High Score": "1", "Alliance Low Score": "1", "League High Score": "11", "League Low Score": "1", "Best Manager": "4", "Conference Wins": "1", "Division Wins": "0", "Playoff Wins": "4" } }],
  "jvl007": [{ "tierKey": "IVY", "team": "Cornell University Bears", "stats": { "Career CP": "491.79", "Career Avg CP": "122.95", "Record": "34-34", "Win %": "50.0%", "Total Points": "13980.55", "Avg Pts / Season": "200.03", "Alliance High Score": "0", "Alliance Low Score": "5", "League High Score": "2", "League Low Score": "5", "Best Manager": "-6", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "3" } }],
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
  "mambasdisciples": [{ "tierKey": "SWAC", "team": "PVAM Panthers", "stats": { "Career CP": "622.60", "Career Avg CP": "155.65", "Record": "44-24", "Win %": "64.7%", "Total Points": "15924.90", "Avg Pts / Season": "227.26", "Alliance High Score": "1", "Alliance Low Score": "0", "League High Score": "7", "League Low Score": "0", "Best Manager": "-4", "Conference Wins": "1", "Division Wins": "1", "Playoff Wins": "4" } }],
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
  "pwnranger l4": [{ "tierKey": "ACC", "team": "Louisville Cardinals", "stats": { "Career CP": "409.93", "Career Avg CP": "102.48", "Record": "21-13", "Win %": "61.8%", "Total Points": "7733.25", "Avg Pts / Season": "221.20", "Alliance High Score": "1", "Alliance Low Score": "0", "League High Score": "3", "League Low Score": "0", "Best Manager": "4", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "2" } }],
  "pwnranger l5": [{ "tierKey": "TEN", "team": "Indiana Hoosiers", "stats": { "Career CP": "302.75", "Career Avg CP": "75.69", "Record": "20-14", "Win %": "58.8%", "Total Points": "7109.60", "Avg Pts / Season": "203.20", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "3", "League Low Score": "0", "Best Manager": "2", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "pwnrangr": [{ "tierKey": "NFL", "team": "New Orleans Saints", "stats": { "Career CP": "675.00", "Career Avg CP": "168.75", "Record": "37-31", "Win %": "54.4%", "Total Points": "11964.85", "Avg Pts / Season": "171.33", "Alliance High Score": "0", "Alliance Low Score": "1", "League High Score": "0", "League Low Score": "1", "Best Manager": "1", "Conference Wins": "0", "Division Wins": "2", "Playoff Wins": "1" } }, { "tierKey": "XFL", "team": "Seattle Dragons", "stats": { "Career CP": "650.44", "Career Avg CP": "162.61", "Record": "36-32", "Win %": "52.9%", "Total Points": "12855.10", "Avg Pts / Season": "184.04", "Alliance High Score": "0", "Alliance Low Score": "1", "League High Score": "0", "League Low Score": "1", "Best Manager": "1", "Conference Wins": "1", "Division Wins": "1", "Playoff Wins": "0" } }],
  "pwnrangr int3": [{ "tierKey": "BIG XII", "team": "TCU Horned Frogs", "stats": { "Career CP": "523.45", "Career Avg CP": "130.86", "Record": "36-32", "Win %": "52.9%", "Total Points": "13543.85", "Avg Pts / Season": "194.04", "Alliance High Score": "1", "Alliance Low Score": "5", "League High Score": "2", "League Low Score": "5", "Best Manager": "-9", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "3" } }],
  "pwnrangr int7": [{ "tierKey": "SUN", "team": "Marshall Thundering Herd", "stats": { "Career CP": "56.05", "Career Avg CP": "14.01", "Record": "8-26", "Win %": "23.5%", "Total Points": "5601.74", "Avg Pts / Season": "160.08", "Alliance High Score": "0", "Alliance Low Score": "8", "League High Score": "0", "League Low Score": "8", "Best Manager": "2", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "pwnrangr l2": [{ "tierKey": "USFL", "team": "Oakland Invaders", "stats": { "Career CP": "650.44", "Career Avg CP": "162.61", "Record": "36-32", "Win %": "52.9%", "Total Points": "12855.10", "Avg Pts / Season": "184.04", "Alliance High Score": "0", "Alliance Low Score": "1", "League High Score": "0", "League Low Score": "1", "Best Manager": "1", "Conference Wins": "1", "Division Wins": "1", "Playoff Wins": "0" } }],
  "pwnrangr l3": [{ "tierKey": "SEC", "team": "Kentucky Wildcats", "stats": { "Career CP": "605.08", "Career Avg CP": "151.27", "Record": "33-18", "Win %": "64.7%", "Total Points": "11449.15", "Avg Pts / Season": "216.01", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "3", "League Low Score": "0", "Best Manager": "-1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "3" } }],
  "pwnrangr l5": [{ "tierKey": "SWAC", "team": "Alcorn State Braves", "stats": { "Career CP": "217.06", "Career Avg CP": "54.27", "Record": "20-31", "Win %": "39.2%", "Total Points": "9144.95", "Avg Pts / Season": "172.37", "Alliance High Score": "0", "Alliance Low Score": "7", "League High Score": "0", "League Low Score": "7", "Best Manager": "-4", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "pwnrangr l6": [{ "tierKey": "IVY", "team": "Harvard Crimson", "stats": { "Career CP": "60.54", "Career Avg CP": "15.13", "Record": "7-10", "Win %": "41.2%", "Total Points": "3625.95", "Avg Pts / Season": "100.72", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "1", "League Low Score": "0", "Best Manager": "-2", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "quincidental": [{ "tierKey": "SUN", "team": "USM Golden Eagles", "stats": { "Career CP": "381.14", "Career Avg CP": "95.28", "Record": "25-26", "Win %": "49.0%", "Total Points": "10784.75", "Avg Pts / Season": "203.84", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "2", "League Low Score": "0", "Best Manager": "8", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "ravenger": [{ "tierKey": "SOCO", "team": "E Tenn Buccaneers", "stats": { "Career CP": "514.57", "Career Avg CP": "128.64", "Record": "31-37", "Win %": "45.6%", "Total Points": "11269.90", "Avg Pts / Season": "160.79", "Alliance High Score": "0", "Alliance Low Score": "1", "League High Score": "2", "League Low Score": "1", "Best Manager": "2", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "recki20": [{ "tierKey": "GLIAC", "team": "JCU Blue Streaks", "stats": { "Career CP": "227.22", "Career Avg CP": "56.80", "Record": "23-28", "Win %": "45.1%", "Total Points": "10007.80", "Avg Pts / Season": "188.93", "Alliance High Score": "0", "Alliance Low Score": "4", "League High Score": "1", "League Low Score": "4", "Best Manager": "7", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
  "redphoenix437": [{ "tierKey": "USFL", "team": "Los Angeles Express", "stats": { "Career CP": "933.99", "Career Avg CP": "233.50", "Record": "45-23", "Win %": "66.2%", "Total Points": "14315.00", "Avg Pts / Season": "204.47", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "3", "League Low Score": "0", "Best Manager": "1", "Conference Wins": "1", "Division Wins": "1", "Playoff Wins": "8" } }],
  "rflores29": [{ "tierKey": "SWAC", "team": "Morgan State Bears", "stats": { "Career CP": "203.43", "Career Avg CP": "50.86", "Record": "15-19", "Win %": "44.1%", "Total Points": "6939.00", "Avg Pts / Season": "198.38", "Alliance High Score": "0", "Alliance Low Score": "18", "League High Score": "18", "League Low Score": "18", "Best Manager": "0", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }, { "tierKey": "GLIAC", "team": "Morgan State Bears", "stats": { "Career CP": "203.43", "Career Avg CP": "50.86", "Record": "—", "Win %": "—", "Total Points": "—", "Avg Pts / Season": "198.38", "Alliance High Score": "0", "Alliance Low Score": "2", "League High Score": "2", "League Low Score": "2", "Best Manager": "0", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" } }],
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
  "z1856z l": [{ "tierKey": "SWAC", "team": "Mississippi Valley Devils", "stats": { "Career CP": "238.07", "Career Avg CP": "59.52", "Record": "22-12", "Win %": "64.7%", "Total Points": "7664.85", "Avg Pts / Season": "218.73", "Alliance High Score": "0", "Alliance Low Score": "1", "League High Score": "5", "League Low Score": "1", "Best Manager": "0", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "2" } }],
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

// Builds the "which placement game sets which draft pick (and CP, for
// 16-team leagues)" data — one row per rankLabel, each representing a game
// that decides two consecutive final ranks (its winner and its loser).
// Each outcome carries its own ineligible/fired status so the panel can
// show it directly rather than as a separate blanket note.
function placementInfoRows(rankLabels, pickTable, startRank, tKeyForCP) {
  const totalTeams = pickTable.length;
  const buildOutcome = (rank) => {
    const pick = pickTable[rank - 1];
    if (pick === undefined) return null;
    const entry = { pick, fired: rank === totalTeams };
    if (tKeyForCP) {
      entry.cp = cpForPlace16(tKeyForCP, rank);
      entry.ineligible = !entry.fired && !promotionEligible16(rank);
    }
    return entry;
  };
  return rankLabels.map((label, i) => {
    const winRank = startRank + i * 2;
    const loseRank = winRank + 1;
    return { label, win: buildOutcome(winRank), lose: buildOutcome(loseRank) };
  });
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
const cpForPlace16 = (tKey, place) =>
  place <= 10 ? CHAMPION_CP_16[tKey] - CP_OFFSETS_1_10[place - 1] : CP_TAIL_16[place - 11];

// Last 5 places in a 16-team league are ineligible for promotion, per the
// Rules doc — confirmed again by both CP tables (ranks 12-16 both show
// "ineligible for promotion").
const promotionEligible16 = (place) => place <= 11;

// Compact reference panel meant to sit beside a bracket rather than as a
// paragraph underneath it.
function PlacementInfoPanel({ rows }) {
  const hasCP = rows.some((r) => r.win && r.win.cp !== undefined);
  const outcomeLine = (entry) => {
    if (!entry) return null;
    const status = entry.fired ? "FIRED" : entry.ineligible ? "INELIGIBLE" : null;
    return (
      <div style={{ color: status ? C.ember : C.slate, fontFamily: "'IBM Plex Mono', monospace" }}>
        {ordinal(entry.pick)} pick{entry.cp !== undefined ? ` · ${entry.cp} CP` : ""}{status ? ` - ${status}` : ""}
      </div>
    );
  };
  return (
    <div className="shrink-0 rounded-sm p-3 text-xs" style={{ background: C.panel, border: `1px solid ${C.line}`, minWidth: "12rem" }}>
      <div className="uppercase tracking-wider mb-2" style={{ color: C.slate, fontSize: "0.65rem", letterSpacing: "0.08em" }}>
        Draft Order{hasCP ? " & Coaching Points" : ""}
      </div>
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.label}>
            <div className="font-semibold mb-0.5" style={{ color: C.chalk }}>{r.label}</div>
            {outcomeLine(r.win)}
            {outcomeLine(r.lose)}
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

const CLUB_300 = [
  { coach: "Harvey28", team: "Carolina Chanticleers", conf: "SUN", pts: 388.1, week: 15, year: 2022 },
  { coach: "mchostetler1", team: "Florida Gators", conf: "SEC", pts: 384.85, week: 2, year: 2024 },
  { coach: "ChicagoOnTop", team: "Los Angeles Xtreme", conf: "XFL", pts: 362.05, week: 4, year: 2023 },
  { coach: "Sb428", team: "Bethune-Cookman Wildcats", conf: "SWAC", pts: 361.6, week: 9, year: 2024 },
  { coach: "samwow123", team: "Austin Peay Governors", conf: "SOCO", pts: 361.05, week: 4, year: 2022 },
  { coach: "DirtyByrd30", team: "Jackson State Tigers", conf: "SWAC", pts: 352.0, week: 7, year: 2025 },
  { coach: "RifeLife520", team: "Oklahoma Sooners", conf: "SEC", pts: 348.35, week: 8, year: 2023 },
  { coach: "DrunkFootball", team: "South Dakota State", conf: "XII", pts: 347.2, week: 4, year: 2025 },
  { coach: "FoggyBuckets", team: "Pittsburgh Maulers", conf: "USFL", pts: 344.8, week: 1, year: 2023 },
  { coach: "OlaveGarden18", team: "Morgan State Bears", conf: "SWAC", pts: 344.35, week: 12, year: 2024 },
  { coach: "beardmantv", team: "Auburn Tigers", conf: "SEC", pts: 342.45, week: 2, year: 2022 },
  { coach: "DirtyByrd30", team: "Jackston State Tigers", conf: "SWAC", pts: 342.1, week: 4, year: 2025 },
  { coach: "CrazyKirt", team: "UCLA Bruins", conf: "TEN", pts: 339.95, week: 12, year: 2024 },
  { coach: "PwnRangr", team: "West Carolina Catamounts", conf: "SOCO", pts: 339.1, week: 7, year: 2025 },
  { coach: "RedPhoenix437", team: "Los Angeles Express", conf: "USFL", pts: 338.05, week: 7, year: 2025 },
  { coach: "Wynnguy", team: "Brown Bears", conf: "IVY", pts: 336.25, week: 8, year: 2023 },
  { coach: "RifeLife520", team: "App State Mountaineers", conf: "IVY", pts: 335.9, week: 13, year: 2024 },
  { coach: "vvJuice", team: "WI Parkside Rangers", conf: "GLIAC", pts: 333.25, week: 3, year: 2023 },
  { coach: "Broncos8804", team: "Coral Springs Colts", conf: "FLHS", pts: 332.8, week: 12, year: 2025 },
  { coach: "ahdi", team: "Chattanooga Mocs", conf: "SOCO", pts: 330.95, week: 17, year: 2024 },
  { coach: "CrazyKirt", team: "UCLA Bruins", conf: "TEN", pts: 329.85, week: 13, year: 2024 },
  { coach: "Edixon2", team: "Baldwin Yellow Jackets", conf: "GLIAC", pts: 328.9, week: 8, year: 2023 },
  { coach: "mattbanks3x", team: "San Antonio Gunslingers", conf: "USFL", pts: 328.65, week: 15, year: 2025 },
  { coach: "cre8t1v3", team: "Citadel Bulldogs", conf: "SOCO", pts: 328.15, week: 4, year: 2023 },
  { coach: "PwnRangr", team: "Louisville Cardinals", conf: "ACC", pts: 328.0, week: 14, year: 2024 },
  { coach: "ColBow", team: "Cypress Bay Lightning", conf: "FLHS", pts: 327.45, week: 4, year: 2023 },
  { coach: "JuugKing", team: "Georgia State Panthers", conf: "SUN", pts: 327.4, week: 15, year: 2025 },
  { coach: "zeheros", team: "Georgia Tech Yellowjackets", conf: "ACC", pts: 326.6, week: 14, year: 2022 },
  { coach: "Roedshow502", team: "Little Rock Trojans", conf: "SUN", pts: 326.6, week: 9, year: 2024 },
  { coach: "mattbanks3x", team: "San Antonio Gunslingers", conf: "USFL", pts: 325.75, week: 3, year: 2023 },
  { coach: "MambasDisciples", team: "PVAM Panthers", conf: "SWAC", pts: 325.6, week: 17, year: 2023 },
  { coach: "Noga2003", team: "Memphis Showboats", conf: "USFL", pts: 325.4, week: 16, year: 2024 },
  { coach: "MrCoolBuns", team: "Seattle Dragons", conf: "XFL", pts: 324.2, week: 5, year: 2024 },
  { coach: "crb2121", team: "South Alabama Jaguars", conf: "SUN", pts: 324.2, week: 7, year: 2025 },
  { coach: "Dylan3380", team: "Florida State Seminoles", conf: "ACC", pts: 323.05, week: 4, year: 2025 },
  { coach: "MambasDisciples", team: "PVAM Panthers", conf: "SWAC", pts: 323.0, week: 12, year: 2023 },
  { coach: "koala530", team: "Boca Raton Wolverines", conf: "FLHS", pts: 322.85, week: 4, year: 2025 },
  { coach: "Sb428", team: "Bethune-Cookman Wildcats", conf: "SWAC", pts: 322.8, week: 4, year: 2023 },
  { coach: "dark-sarcasm9", team: "Old Dominion Monarchs", conf: "SUN", pts: 321.95, week: 4, year: 2022 },
  { coach: "Dylan3380", team: "Florida State Seminoles", conf: "SUN", pts: 321.8, week: 10, year: 2024 },
  { coach: "z1856z", team: "DC Defenders", conf: "XFL", pts: 321.5, week: 12, year: 2025 },
  { coach: "Motty", team: "Tampa Bay Bandits", conf: "XFL", pts: 320.85, week: 14, year: 2022 },
  { coach: "Jaquise", team: "Austin Peay Governors", conf: "SOCO", pts: 320.85, week: 5, year: 2024 },
  { coach: "Broncos8804", team: "Coral Springs Colts", conf: "FLHS", pts: 320.65, week: 2, year: 2025 },
  { coach: "WillStephensSr", team: "Alabama State Hornets", conf: "SWAC", pts: 320.45, week: 8, year: 2023 },
  { coach: "TheWOAT100", team: "Wayne State Warriors", conf: "GLIAC", pts: 319.7, week: 8, year: 2023 },
  { coach: "Wynnguy", team: "Brown Bears", conf: "IVY", pts: 318.55, week: 12, year: 2022 },
  { coach: "NunYaBizNezz", team: "Lake Superior Lakers", conf: "GLIAC", pts: 318.0, week: 9, year: 2023 },
  { coach: "srcav", team: "Purdue Boilermakers", conf: "TEN", pts: 318.0, week: 15, year: 2025 },
  { coach: "GarrettBFF", team: "Atlanta Legends", conf: "XFL", pts: 317.85, week: 10, year: 2024 },
  { coach: "JuugKing", team: "Georgia State Panthers", conf: "SUN", pts: 317.45, week: 2, year: 2024 },
  { coach: "MambasDisciples", team: "PVAM Panthers", conf: "SWAC", pts: 317.25, week: 8, year: 2023 },
  { coach: "Landshark18", team: "Baltimore Ravens", conf: "NFL", pts: 316.65, week: 3, year: 2023 },
  { coach: "DLeggett", team: "West Virginia Cavaliers", conf: "XII", pts: 316.5, week: 8, year: 2022 },
  { coach: "FoggyBuckets", team: "Alabama State Hornets", conf: "SWAC", pts: 316.35, week: 15, year: 2022 },
  { coach: "TimeforTua", team: "Northwood Timberwolves", conf: "GLIAC", pts: 316.2, week: 15, year: 2024 },
  { coach: "SVerfin", team: "Butler Bulldogs", conf: "PION", pts: 315.9, week: 15, year: 2022 },
  { coach: "spicyftbaltakes", team: "TCU Horned Frogs", conf: "XII", pts: 315.15, week: 16, year: 2022 },
  { coach: "evanthomas536", team: "Southern U Jaguars", conf: "SWAC", pts: 314.65, week: 2, year: 2022 },
  { coach: "BBlew52", team: "Georgia Bulldogs", conf: "SEC", pts: 314.2, week: 13, year: 2025 },
  { coach: "Harold2576", team: "Davenport Panthers", conf: "GLIAC", pts: 313.65, week: 13, year: 2024 },
  { coach: "runhaags", team: "Arkansas State Red Wolves", conf: "SUN", pts: 313.5, week: 17, year: 2024 },
  { coach: "acubes21", team: "Belmont Bruins", conf: "USFL", pts: 313.3, week: 16, year: 2024 },
  { coach: "Goobravich", team: "Northern Colorado Bears", conf: "XII", pts: 312.95, week: 5, year: 2024 },
  { coach: "Dilly314", team: "Georgetown Hoyas", conf: "IVY", pts: 312.75, week: 17, year: 2024 },
  { coach: "StokesCity", team: "Western Wildcats", conf: "FLHS", pts: 312.5, week: 15, year: 2024 },
  { coach: "TuaLegitTuaQuit99", team: "Capitol Comets", conf: "GLIAC", pts: 312.45, week: 11, year: 2024 },
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
  { coach: "amkm324", team: "Louisville Cardinals", conf: "SEC", pts: 310.65, week: 11, year: 2022 },
  { coach: "JJBInc", team: "Palmetto Panthers", conf: "FLHS", pts: 310.35, week: 12, year: 2022 },
  { coach: "cspeece", team: "JMU Dukes", conf: "GLIAC", pts: 310.0, week: 10, year: 2025 },
  { coach: "samwow123", team: "South Carolina Gamecocks", conf: "SEC", pts: 309.65, week: 11, year: 2025 },
  { coach: "DirtyByrd30", team: "Jackson State Tigers", conf: "SWAC", pts: 309.6, week: 2, year: 2025 },
  { coach: "DirtyByrd30", team: "Jackson State Tigers", conf: "SWAC", pts: 309.3, week: 15, year: 2025 },
  { coach: "Fin3", team: "Alabama Crimson Tide", conf: "SEC", pts: 309.25, week: 13, year: 2024 },
  { coach: "db091391", team: "Boston College Eagles", conf: "ACC", pts: 308.9, week: 6, year: 2024 },
  { coach: "PwnRangr", team: "Kentucky Wildcats", conf: "SEC", pts: 308.8, week: 11, year: 2023 },
  { coach: "fantasyTren", team: "Mercer Bears", conf: "SOCO", pts: 308.8, week: 12, year: 2025 },
  { coach: "MambasDisciples", team: "PVAM Panthers", conf: "SWAC", pts: 308.6, week: 15, year: 2023 },
  { coach: "teej1007", team: "JMU Dukes", conf: "SUN", pts: 308.4, week: 10, year: 2025 },
  { coach: "Jay21177", team: "Washington Huskies", conf: "TEN", pts: 308.35, week: 2, year: 2024 },
  { coach: "TylerWT003", team: "Virginia Tech Hokies", conf: "ACC", pts: 308.35, week: 4, year: 2025 },
  { coach: "CrazyKirt", team: "UCLA Bruins", conf: "SOCO", pts: 308.3, week: 17, year: 2024 },
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
  { coach: "treetwig", team: "AK Pine Bluff Lions", conf: "SWAC", pts: 306.65, week: 15, year: 2023 },
  { coach: "catinthehat2", team: "St Francis Red Flash", conf: "PION", pts: 306.4, week: 6, year: 2023 },
  { coach: "WillStephensSr", team: "Alabama State Hornets", conf: "SWAC", pts: 306.35, week: 2, year: 2022 },
  { coach: "heavyd1017", team: "Mississippi State", conf: "SEC", pts: 306.35, week: 5, year: 2022 },
  { coach: "beardmantv", team: "Auburn Tigers", conf: "SEC", pts: 306.25, week: 6, year: 2023 },
  { coach: "Wynnguy", team: "Brown Bears", conf: "IVY", pts: 305.95, week: 15, year: 2025 },
  { coach: "SpacebarRacecar", team: "Citadel Bulldogs", conf: "SOCO", pts: 305.75, week: 3, year: 2022 },
  { coach: "Firephool", team: "Oklahoma State Cowboys", conf: "XII", pts: 305.6, week: 14, year: 2022 },
  { coach: "2neufbettix", team: "New York Guardians", conf: "XFL", pts: 305.6, week: 5, year: 2024 },
  { coach: "KShooter15", team: "Ferris State Bulldogs", conf: "GLIAC", pts: 305.15, week: 8, year: 2022 },
  { coach: "Brandonaut", team: "Syracuse Orange", conf: "ACC", pts: 305.0, week: 10, year: 2024 },
  { coach: "Harvey28", team: "Carolina Chanticleers", conf: "SUN", pts: 304.9, week: 8, year: 2023 },
  { coach: "RifeLife520", team: "Oklahoma Sooners", conf: "SEC", pts: 304.8, week: 9, year: 2022 },
  { coach: "babba10101", team: "Penn Quakers", conf: "IVY", pts: 304.8, week: 15, year: 2022 },
  { coach: "MambasDisciples", team: "PVAM Panthers", conf: "SWAC", pts: 304.65, week: 8, year: 2024 },
  { coach: "ravenger", team: "Kansas City Chiefs", conf: "NFL", pts: 304.1, week: 6, year: 2023 },
  { coach: "SpacebarRacecar", team: "Citadel Bulldogs", conf: "SOCO", pts: 304.0, week: 9, year: 2022 },
  { coach: "Jaquise", team: "Austin Peay Governors", conf: "SOCO", pts: 303.9, week: 11, year: 2024 },
  { coach: "z1856z", team: "Mississippi Valley Delta Devils", conf: "SWAC", pts: 303.9, week: 12, year: 2025 },
  { coach: "alexfinnis", team: "Missouri Tigers", conf: "SEC", pts: 303.8, week: 9, year: 2024 },
  { coach: "Coopdaddy510", team: "Arizona Wildcats", conf: "XII", pts: 303.65, week: 15, year: 2022 },
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
  { coach: "Firephool", team: "OSU Cowboys", conf: "XII", pts: 301.9, week: 15, year: 2025 },
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
  { coach: "MambasDisciples", team: "PVAM Panthers", conf: "SWAC", pts: 300.55, week: 14, year: 2023 },
  { coach: "cspeese22", team: "Ohio Northern Polar Bears", conf: "GLIAC", pts: 300.45, week: 16, year: 2023 },
  { coach: "samwow123", team: "Austin Peay Governors", conf: "SOCO", pts: 300.35, week: 15, year: 2022 },
  { coach: "Vastettler", team: "Muskingum Fighting Muskies", conf: "GLIAC", pts: 300.35, week: 2, year: 2023 },
  { coach: "TomJohnMike", team: "Duke Blue Devils", conf: "ACC", pts: 300.35, week: 9, year: 2025 },
  { coach: "hockeydoug", team: "Houston Cougars", conf: "XII", pts: 300.25, week: 17, year: 2024 },
  { coach: "jaquise", team: "Austin Peay Governors", conf: "SOCO", pts: 300.1, week: 6, year: 2022 },
  { coach: "finnbar3", team: "Detroit Drive", conf: "USFL", pts: 300.05, week: 3, year: 2023 },
];

// Leaderboards derived directly from CLUB_300 itself, so they can never
// drift out of sync with the list players actually see.
function tally(arr, keyFn) {
  const counts = {};
  arr.forEach((item) => {
    const k = keyFn(item);
    counts[k] = (counts[k] || 0) + 1;
  });
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}
const CLUB_300_TOP_COACHES = tally(CLUB_300, (r) => r.coach).slice(0, 10);
const CLUB_300_TOP_TEAMS = tally(CLUB_300, (r) => r.team).slice(0, 8);
const CLUB_300_BY_CONF = tally(CLUB_300, (r) => r.conf);

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
// Sleeper roster page (once ROSTER_LINKS has an entry — see below) rather
// than an in-app player list, keeping room for team history, etc. later.
// Draft picks are computed live from Sleeper's traded-picks data.

// Roster links from the roster-link export, keyed by lowercased team name
// (lookup below lowercases team.team before checking this map). Covers all
// 13 tiers. A few open items:
//  - "North Colorado Bears" (Big XII) and "THE Ohio State Buckeyes" (Big Ten)
//    had links pointing into the wrong tier in the source sheet — omitted
//    until the real roster numbers are confirmed.
//  - Unfilled roster slots (open coaching jobs) have no entry, so the popup
//    just omits the link for those, same as before.
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
  // NOTE: "North Colorado Bears" in the source sheet links into the XFL
  // league instead (1316588494914613248/18, which is actually the Los
  // Angeles Wildcats' slot) — a copy/paste error. Left out below; let me
  // know the real roster number and I'll add it.
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
  // NOTE: "THE Ohio State Buckeyes" in the source sheet links into the FLHS
  // league instead (1317921468134232064/4, an unfilled FLHS slot) — a
  // copy/paste error. Left out below; let me know the real roster number
  // and I'll add it.
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

function TeamProfileModal({ team, onClose, draftPicks, draftPicksLoading }) {
  if (!team) return null;
  const rosterLink = ROSTER_LINKS[(team.team || "").toLowerCase()];

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
          <button onClick={onClose} className="text-xs uppercase tracking-wider" style={{ color: C.slate }}>
            close
          </button>
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
  "San Francisco": ["#AA0000", "#B3995D"], Arizona: ["#97233F", "#FFFFFF"],
  Philadelphia: ["#004C54", "#FFFFFF"], "LA Rams": ["#003594", "#FFD100"],
  "Green Bay": ["#203731", "#FFB612"], Seattle: ["#002244", "#69BE28"],
  "New Orleans": ["#D3BC8D", "#101820"], Detroit: ["#0076B6", "#FFFFFF"],
  "New England": ["#B0B7BC", "#002244"], Tennessee: ["#0C2340", "#4B92DB"],
  "LA Chargers": ["#0080C6", "#FFC20E"], Miami: ["#008E97", "#FFFFFF"],
  Baltimore: ["#241773", "#9E7C0C"], "NY Jets": ["#125740", "#FFFFFF"],
  Jacksonville: ["#006778", "#D7A22A"], Pittsburgh: ["#101820", "#FFB612"],
  Dallas: ["#041E42", "#FFFFFF"], Atlanta: ["#A71930", "#101820"],
  Chicago: ["#0B162A", "#C83803"], Washington: ["#5A1414", "#FFB612"],
  Minnesota: ["#4F2683", "#FFC62F"], "Tampa Bay": ["#D50A0A", "#FFFFFF"],
  "NY Giants": ["#0B2265", "#FFFFFF"], Carolina: ["#0085CA", "#FFFFFF"],
  Cincinnati: ["#FB4F14", "#101820"], Denver: ["#002244", "#FB4F14"],
  "Las Vegas": ["#101820", "#A5ACAF"], Houston: ["#03202F", "#A71930"],
  Indianapolis: ["#002C5F", "#FFFFFF"], "Kansas City": ["#E31837", "#FFB81C"],
  Buffalo: ["#00338D", "#FFFFFF"], Cleveland: ["#311D00", "#FF3C00"],
};

const BW = 100, BH = 19, GRID_W = 996;

// PFA shield, embedded as a data URI so the logo travels inside App.jsx —
// no public/ folder and no second file to upload. Swap this string if the
// artwork ever changes.
const PFA_MARK = "data:image/png;base64,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";
const XFL_MARK = "data:image/png;base64,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";

// Maps each tier key to its league mark data URI. Add marks here as artwork
// arrives — other tiers fall back to showing the tier key as text.
const TIER_LOGOS = {
  XFL: XFL_MARK,
};


function GBox({ x, y, team, score, win, colors }) {
  const clr = (colors && colors[team]) || TEAM_CLR[team] || ["#2A3550", C.chalk];
  return (
    <div style={{ position: "absolute", left: x, top: y, width: BW }}>
      <div style={{
        height: BH, lineHeight: `${BH}px`, fontSize: 11, fontWeight: 700, padding: "0 3px",
        background: clr[0], color: clr[1], whiteSpace: "nowrap", overflow: "hidden",
        textOverflow: "ellipsis", boxSizing: "border-box", textAlign: "center",
      }}>{team}</div>
      {score != null && (
        <div style={{
          height: BH, lineHeight: `${BH}px`, fontSize: 11, fontFamily: "'IBM Plex Mono', monospace",
          background: "rgba(255,255,255,0.03)", boxSizing: "border-box", textAlign: "center",
          border: `1px solid ${C.line}`, borderTop: "none",
          color: win ? C.turf : C.slate, fontWeight: win ? 700 : 400,
        }}>{score}</div>
      )}
    </div>
  );
}

// A placement game's centre column: draft-pick note, winner bar, place label.
function GPlace({ x, y, pick, text }) {
  return (
    <>
      {pick && (
        <div style={{
          position: "absolute", left: x, top: y - 33, width: BW, height: 14, lineHeight: "14px",
          textAlign: "center", fontSize: 10, fontStyle: "italic", color: C.slate,
        }}>{pick}</div>
      )}
      <div style={{
        position: "absolute", left: x, top: y, width: BW, height: BH * 2, lineHeight: `${BH * 2}px`,
        textAlign: "center", fontSize: 11, fontWeight: 700, color: C.chalk,
        background: "rgba(255,255,255,0.03)", border: `1px solid ${C.line}`, boxSizing: "border-box",
      }}>{text}</div>
    </>
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
        color: C.slate, background: C.panelHi, border: `1px solid ${C.line}`, boxSizing: "border-box",
      }}>{label}</div>
      <div style={{
        height: BH, lineHeight: `${BH}px`, fontSize: 11, textAlign: "center",
        fontFamily: "'IBM Plex Mono', monospace", color: C.slate,
        background: "rgba(255,255,255,0.03)", border: `1px solid ${C.line}`,
        borderTop: "none", boxSizing: "border-box",
      }}>{score}</div>
    </div>
  );
}

function GPaths({ h, d }) {
  return (
    <svg width={GRID_W} height={h} style={{ position: "absolute", left: 0, top: 0 }} aria-hidden="true">
      <g fill="none" stroke={C.line} strokeWidth="1">
        {d.map((p, i) => <path key={i} d={p} />)}
      </g>
    </svg>
  );
}

const WK_COLS = [[0, "Week 14"], [112, "Week 15"], [224, "Week 16"], [336, "Week 17"],
                 [560, "Week 17"], [672, "Week 16"], [784, "Week 15"], [896, "Week 14"]];

// Dashed placeholder for artwork that isn't in the app yet (league marks,
// trophies). Keeps the space reserved so real images drop straight in.
function GSlot({ x, y, w, h, label, src }) {
  return (
    <div style={{
      position: "absolute", left: x, top: y, width: w, height: h, display: "flex",
      alignItems: "center", justifyContent: "center", textAlign: "center",
      border: src ? "none" : `1px dashed ${C.line}`, borderRadius: 4,
      fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase",
      color: C.slate, lineHeight: 1.3, padding: "0 4px", boxSizing: "border-box",
    }}>
      {src
        ? <img src={src} alt={label} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
        : label}
    </div>
  );
}

function GHeader({ banners, logo, logoSrc }) {
  return (
    <div style={{ position: "relative", width: GRID_W, height: banners ? 46 : 24 }}>
      {logo && <GSlot x={448} y={0} w={100} h={46} label={logo} src={logoSrc} />}
      {WK_COLS.map(([x, t]) => (
        <div key={x} style={{
          position: "absolute", left: x, top: 0, width: BW, height: 20, lineHeight: "20px",
          textAlign: "center", fontSize: 10, letterSpacing: "0.12em", color: C.slate,
          textTransform: "uppercase",
        }}>{t}</div>
      ))}
      {banners && banners.map(([x, w, t, bg]) => (
        <div key={t} style={{
          position: "absolute", left: x, top: 24, width: w, height: 22, lineHeight: "22px",
          textAlign: "center", fontSize: 11, fontWeight: 700, letterSpacing: "0.15em",
          color: "#fff", background: bg, borderRadius: 3,
        }}>{t}</div>
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

  const innerH = data.sections.reduce((a, s) => a + (s.banners ? 46 : 24) + s.h + 24, 0);

  return (
    <div ref={wrapRef} style={{ width: "100%", overflow: "hidden", height: innerH * scale }}>
      <div style={{ width: GRID_W, transformOrigin: "top left", transform: `scale(${scale})` }}>
        {data.sections.map((s, si) => (
          <div key={si}>
            <GHeader banners={s.banners} logo={s.logo} logoSrc={data.logoSrc} />
            <div style={{ position: "relative", width: GRID_W, height: s.h }}>
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
                  <div style={{
                    position: "absolute", left: 448, top: s.champion.y, width: BW,
                    border: `2px solid ${C.gold}`, borderRadius: 3, overflow: "hidden",
                  }}>
                    <GBox x={0} y={0} team={s.champion.team} colors={data.colors} />
                    <div style={{
                      height: BH, lineHeight: `${BH}px`, fontSize: 10, textAlign: "center",
                      background: "rgba(232,163,61,0.12)", color: C.gold, fontWeight: 700,
                    }}>{s.champion.sub}</div>
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
const NFL_2025_PLAYOFFS = {
  sections: [
    {
      banners: BR_BANNERS, h: 418, paths: BR_MAIN_PATHS, logo: "NFL",
      slots: [[448, 16, 100, 150, "Trophy"], [448, 250, 100, 100, "PFA", PFA_MARK]],
      champion: { y: 190, label: "Champion", team: "Tennessee", sub: "PainBowl IV" },
      boxes: [
        [0, 0, "San Francisco", "169.40", 1], [0, 38, "Arizona", "156.40"],
        [0, 114, "Philadelphia", "157.55"], [0, 152, "LA Rams", "181.80", 1],
        [0, 228, "Green Bay", "206.15", 1], [0, 266, "Seattle", "145.05"],
        [0, 342, "New Orleans", "123.75"], [0, 380, "Detroit", "126.85", 1],
        [112, 57, "San Francisco", "145.05"], [112, 95, "LA Rams", "207.30", 1],
        [112, 285, "Green Bay", "187.75"], [112, 323, "Detroit", "220.50", 1],
        [224, 171, "LA Rams", "275.75", 1], [224, 209, "Detroit", "109.15"],
        [336, 190, "LA Rams", "178.40"],
        [560, 190, "Tennessee", "210.60", 1],
        [672, 171, "Tennessee", "236.90", 1], [672, 209, "Baltimore", "197.10"],
        [784, 57, "Tennessee", "219.85", 1], [784, 95, "LA Chargers", "132.40"],
        [784, 285, "Baltimore", "231.70", 1], [784, 323, "Pittsburgh", "116.80"],
        [896, 0, "New England", "165.55"], [896, 38, "Tennessee", "200.40", 1],
        [896, 114, "LA Chargers", "234.35", 1], [896, 152, "Miami", "113.60"],
        [896, 228, "Baltimore", "211.60", 1], [896, 266, "NY Jets", "148.05"],
        [896, 342, "Jacksonville", "160.00"], [896, 380, "Pittsburgh", "171.80", 1],
      ],
    },
    {
      h: 690,
      paths: [
        "M324 169 L330 169 L330 162 L336 162", "M324 207 L330 207 L330 248 L336 248",
        "M672 207 L666 207 L666 162 L660 162", "M672 169 L666 169 L666 248 L660 248",
        ...BR_W15_FEEDERS,
        "M324 386 L336 386", "M324 424 L330 424 L330 457 L336 457",
        "M672 386 L666 386 L666 457 L660 457", "M672 424 L666 424 L666 386 L660 386",
        "M324 579 L336 578", "M324 617 L330 617 L330 649 L336 649",
        "M672 579 L660 578", "M672 617 L666 617 L666 649 L660 649",
      ],
      boxes: [
        [336, 33, "Detroit", "144.60", 1], [560, 33, "Baltimore", "102.80"],
        [224, 150, "San Francisco", "242.20", 1], [224, 188, "Green Bay", "227.95"],
        [672, 150, "LA Chargers", "154.35"], [672, 188, "Pittsburgh", "187.80", 1],
        [336, 143, "San Francisco", "204.35", 1], [560, 143, "Pittsburgh", "175.15"],
        [336, 229, "Green Bay", "192.40", 1], [560, 229, "LA Chargers", "146.20"],
        [112, 310, "Arizona", "215.15"], [112, 348, "Philadelphia", "258.40", 1],
        [112, 424, "Seattle", "176.60", 1], [112, 462, "New Orleans", "130.50"],
        [784, 310, "New England", "146.90"], [784, 348, "Miami", "186.75", 1],
        [784, 424, "NY Jets", "227.40", 1], [784, 462, "Jacksonville", "101.00"],
        [224, 367, "Philadelphia", "181.50", 1], [224, 405, "Seattle", "157.70"],
        [672, 367, "Miami", "178.80"], [672, 405, "NY Jets", "204.70", 1],
        [336, 367, "Philadelphia", "129.65"], [560, 367, "NY Jets", "194.80", 1],
        [336, 438, "Seattle", "123.80"], [560, 438, "Miami", "173.45", 1],
        [224, 560, "Arizona", "180.05", 1], [224, 598, "New Orleans", "146.90"],
        [672, 560, "New England", "184.60", 1], [672, 598, "Jacksonville", "106.80"],
        [336, 559, "Arizona", "138.35"], [560, 559, "New England", "197.20", 1],
        [336, 630, "New Orleans", "140.70", 1], [560, 630, "Jacksonville", "109.60"],
      ],
      winners: [
        [448, 14, "Detroit"], [448, 124, "San Francisco"], [448, 210, "Green Bay"],
        [448, 348, "NY Jets"], [448, 419, "Miami"],
        [448, 540, "New England"], [448, 611, "New Orleans"],
      ],
      places: [
        [448, 33, "29th pick", "3rd place"], [448, 143, "25th pick", "5th place"],
        [448, 229, "27th pick", "7th place"], [448, 367, "17th pick", "9th place"],
        [448, 438, "19th pick", "11th place"], [448, 559, "21st pick", "13th place"],
        [448, 630, "23rd pick", "15th place"],
      ],
    },
  ],
};

// --- 2025 NFL, ranks 17-32 (consolation half) ------------------------------
// Same bracket shape one tier down: the 17th-place game is this half's
// championship, and the Relegation Bowl at the bottom fires the last coach.
const NFL_2025_CONSOLATION = {
  sections: [
    {
      banners: BR_BANNERS, h: 418, paths: BR_MAIN_PATHS, logo: "NFL",
      slots: [[448, 30, 100, 110, "PFA", PFA_MARK]],
      winners: [[448, 171, "Cincinnati"]],
      places: [[448, 190, "9th pick", "17th place"]],
      boxes: [
        [0, 0, "Dallas", "126.40"], [0, 38, "Atlanta", "132.50", 1],
        [0, 114, "Chicago", "158.35", 1], [0, 152, "Washington", "129.45"],
        [0, 228, "Minnesota", "116.10", 1], [0, 266, "Tampa Bay", "109.75"],
        [0, 342, "NY Giants", "195.40", 1], [0, 380, "Carolina", "144.85"],
        [112, 57, "Atlanta", "171.15", 1], [112, 95, "Chicago", "95.85"],
        [112, 285, "Minnesota", "167.35"], [112, 323, "NY Giants", "212.40", 1],
        [224, 171, "Atlanta", "171.75", 1], [224, 209, "NY Giants", "143.05"],
        [336, 190, "Atlanta", "108.65"],
        [560, 190, "Cincinnati", "175.90", 1],
        [672, 171, "Cincinnati", "180.95", 1], [672, 209, "Indianapolis", "126.25"],
        [784, 57, "Cincinnati", "189.45", 1], [784, 95, "Las Vegas", "157.00"],
        [784, 285, "Indianapolis", "158.70", 1], [784, 323, "Buffalo", "139.90"],
        [896, 0, "Cincinnati", "189.95", 1], [896, 38, "Denver", "68.20"],
        [896, 114, "Las Vegas", "154.65", 1], [896, 152, "Houston", "109.90"],
        [896, 228, "Indianapolis", "141.50", 1], [896, 266, "Kansas City", "135.10"],
        [896, 342, "Buffalo", "216.15", 1], [896, 380, "Cleveland", "134.50"],
      ],
    },
    {
      h: 730,
      paths: [
        // 21st/23rd: NFC winner is the LOWER box here, so these cross the
        // opposite way from the championship half's 5th/7th games.
        "M324 169 L330 169 L330 248 L336 248", "M324 207 L330 207 L330 162 L336 162",
        "M672 169 L666 169 L666 162 L660 162", "M672 207 L666 207 L666 248 L660 248",
        ...BR_W15_FEEDERS,
        "M324 424 L330 424 L330 386 L336 386", "M324 386 L330 386 L330 457 L336 457",
        "M672 424 L666 424 L666 386 L660 386", "M672 386 L666 386 L666 457 L660 457",
        "M324 617 L330 617 L330 578 L336 578", "M324 579 L330 579 L330 649 L336 649",
        "M672 617 L666 617 L666 578 L660 578", "M672 579 L666 579 L666 649 L660 649",
      ],
      boxes: [
        [336, 33, "NY Giants", "203.80", 1], [560, 33, "Indianapolis", "174.75"],
        [224, 150, "Chicago", "105.90"], [224, 188, "Minnesota", "147.05", 1],
        [672, 150, "Las Vegas", "117.60", 1], [672, 188, "Buffalo", "82.35"],
        [336, 143, "Minnesota", "204.70", 1], [560, 143, "Las Vegas", "169.10"],
        [336, 229, "Chicago", "157.60", 1], [560, 229, "Buffalo", "155.00"],
        [112, 310, "Dallas", "165.85", 1], [112, 348, "Washington", "143.60"],
        [112, 424, "Tampa Bay", "125.15"], [112, 462, "Carolina", "142.00", 1],
        [784, 310, "Denver", "96.05"], [784, 348, "Houston", "100.90", 1],
        [784, 424, "Kansas City", "136.10", 1], [784, 462, "Cleveland", "106.70"],
        [224, 367, "Dallas", "177.90"], [224, 405, "Carolina", "179.60", 1],
        [672, 367, "Houston", "84.30"], [672, 405, "Kansas City", "143.80", 1],
        [336, 367, "Carolina", "146.55", 1], [560, 367, "Kansas City", "118.40"],
        [336, 438, "Dallas", "171.60", 1], [560, 438, "Houston", "92.20"],
        [224, 560, "Washington", "121.90"], [224, 598, "Tampa Bay", "129.35", 1],
        [672, 560, "Denver", "90.15"], [672, 598, "Cleveland", "109.70", 1],
        [336, 559, "Tampa Bay", "132.10", 1], [560, 559, "Cleveland", "94.40"],
        [336, 630, "Washington", "153.00", 1], [560, 630, "Denver", "63.50"],
      ],
      winners: [
        [448, 14, "NY Giants"], [448, 124, "Minnesota"], [448, 210, "Chicago"],
        [448, 348, "Carolina"], [448, 419, "Dallas"],
        [448, 540, "Tampa Bay"], [448, 611, "Washington"],
      ],
      places: [
        [448, 33, "11th pick", "19th place"], [448, 143, "13th pick", "21st place"],
        [448, 229, "15th pick", "23rd place"], [448, 367, "3rd pick", "25th place"],
        [448, 438, "5th pick", "27th place"], [448, 559, "7th pick", "29th place"],
        [448, 630, "2nd pick", "31st place"],
      ],
      footer: [336, 680, 324, "Relegation Bowl", "LAST PLACE COACH IS FIRED"],
    },
  ],
};

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
  sections: [
    {
      banners: USFL_BANNERS, h: 280, paths: USFL_MAIN_PATHS, logo: "USFL",
      slots: [[448, 4, 100, 84, "Trophy"], [448, 176, 100, 96, "PFA", PFA_MARK]],
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

const XFL_BANNERS = [[0, 436, "XFL", "#CFE0C3"], [560, 436, "Championship", "#CFE0C3"]];
const XFL_CONSO_BANNERS = [[0, 436, "XFL", "#CFE0C3"], [560, 436, "Consolation", "#CFE0C3"]];

const XFL_2025_PLAYOFFS = {
  colors: XFL_CLR,
  logoSrc: XFL_MARK,
  sections: [
    {
      banners: XFL_BANNERS, h: 280, paths: USFL_MAIN_PATHS, logo: "XFL",
      slots: [[448, 4, 100, 84, "Trophy"], [448, 176, 100, 96, "PFA", PFA_MARK]],
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
const GRID_BRACKETS = {
  NFL: { playoffs: NFL_2025_PLAYOFFS, consolation: NFL_2025_CONSOLATION },
  USFL: { playoffs: USFL_2025_PLAYOFFS, consolation: USFL_2025_CONSOLATION },
  XFL: { playoffs: XFL_2025_PLAYOFFS, consolation: XFL_2025_CONSOLATION },
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
        userId: u.user_id || null,
        avatar: u.avatar || null,
        playerIds: r.players || [],
        division: (r.settings && r.settings.division) || null,
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
    return () => {
      unsubChat();
      unsubNews();
      unsubApps();
      unsubPromo();
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
      loadLeague(id, week).finally(() => setTierLoading(false));
    }
  }, [tierKey, mode, standingsSeason, leagueMap, standingsCache, loadLeague, nflState]);

  // once discovery has filled in leagueMap, fetch standings for every connected
  // league (not just the one being viewed) so the homepage Hot Seat report can
  // show a last-place coach from all 13 tiers, not just whichever is selected
  useEffect(() => {
    if (mode !== "live" || bulkLoadedRef.current) return;
    if (Object.keys(leagueMap).length <= 1) return;
    bulkLoadedRef.current = true;
    Object.values(leagueMap).forEach((id) => {
      if (id && !standingsCache[id]) loadLeague(id);
    });
  }, [mode, leagueMap, standingsCache, loadLeague]);

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

  const deleteChatMsg = async (id) => {
    const local = await removeChatMessage(id);
    if (local) setChat(local);
  };

  // ── Apply-to-Team ──
  const promotionPointsFor = (name) => {
    const entries = CAREER_STATS[(name || "").toLowerCase()] || [];
    if (!entries.length) return null;
    const dirEntry = coachDirectory.find((c) => c.name.toLowerCase() === (name || "").toLowerCase());
    const match = dirEntry ? entries.find((e) => e.tierKey === dirEntry.tierKey) : null;
    const stats = (match || entries[0]).stats;
    const n = parseFloat(stats["Career CP"]);
    return Number.isFinite(n) ? n : null;
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

  // Draft-order panels, computed once here instead of inline next to each
  // bracket — moved to the left column (under the tier ladder) to give the
  // brackets themselves more room.
  const placementPanels = !bracket
    ? null
    : bracket.format === "division-playin"
    ? {
        playoffs: placementInfoRows(["Championship", "3rd Place", "5th Place", "7th Place", "9th Place"], DRAFT_PICKS_20, 1),
        consolation:
          bracket.consolation && bracket.consolation.length > 0
            ? placementInfoRows(["11th Place", "13th Place", "15th Place", "17th Place", "19th Place"], DRAFT_PICKS_20, 11)
            : null,
      }
    : bracket.format === "conference-top4"
    ? {
        playoffs: placementInfoRows(["Championship", "3rd Place", "5th Place", "7th Place"], DRAFT_PICKS_16, 1, tierKey),
        consolation: placementInfoRows(["9th Place", "11th Place", "13th Place", "15th Place"], DRAFT_PICKS_16, 9, tierKey),
      }
    : bracket.format === "conference-division"
    ? {
        playoffs: placementInfoRows(["Championship", "3rd Place", "5th Place", "7th Place", "9th Place", "11th Place", "13th Place", "15th Place"], DRAFT_PICKS_32, 1),
        consolation: placementInfoRows(["17th Place", "19th Place", "21st Place", "23rd Place", "25th Place", "27th Place", "29th Place", "31st Place"], DRAFT_PICKS_32, 17),
      }
    : bracket.format === "top8-cascade" || bracket.format === "division-only"
    ? {
        playoffs: placementInfoRows(["Championship", "3rd Place", "5th Place", "7th Place"], DRAFT_PICKS_16, 1, tierKey),
        consolation: placementInfoRows(["9th Place", "11th Place", "13th Place", "15th Place"], DRAFT_PICKS_16, 9, tierKey),
      }
    : null;

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
      return {
        name: dirEntry ? dirEntry.name : lowerName,
        team: chosen.team,
        tierKey: chosen.tierKey,
        cp: parseNum(s["Career CP"]),
        wins: parseNum(wStr),
        losses: parseNum(lStr),
        winPct: parseNum(s["Win %"]),
        totalPts: parseNum(s["Total Points"]),
        record: s["Record"],
        maxPts: match ? dirEntry.maxPts : undefined,
        rosterId: match ? dirEntry.rosterId : undefined,
      };
    });
  }, [coachDirectory]);

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

  // ── Conference Strength — Troy's original spreadsheet metric, rebuilt from
  // season-total points already in standingsCache. Two pools: the 10-tier
  // "Alliance," and USFL+XFL compared only against each other. NFL has no
  // pool, so it isn't scored. Scores hover near zero until real games are
  // played — that's expected during the off-season, not a bug.
  const conferenceStrength = useMemo(() => {
    if (mode !== "live") return {};

    const baseStats = (tKey) => {
      const id = leagueMap[tKey];
      const tRows = id ? standingsCache[id] : null;
      if (!tRows || tRows.length < 2) return null;
      const scores = tRows.map((r) => r.pts || 0);
      const teamMax = Math.max(...scores);
      const teamMin = Math.min(...scores);
      return {
        teamMax,
        teamMin,
        d: teamMax - teamMin,
        leagueAvg: average(scores),
        leagueMedian: median(scores),
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
      const poolAvgOfAvgs = average(keys.map((k) => stats[k].leagueAvg));
      const poolMedianOfMedians = median(keys.map((k) => stats[k].leagueMedian));
      const poolMedianOfMax = median(keys.map((k) => stats[k].teamMax));
      const poolMedianOfMin = median(keys.map((k) => stats[k].teamMin));

      const out = {};
      keys.forEach((k) => {
        const s = stats[k];
        const score =
          (s.d - poolMedianD) / -10 / 10 +
          (s.leagueAvg - poolAvgOfAvgs) / 100 +
          (s.leagueMedian - poolMedianOfMedians) / 20 +
          (s.teamMax - poolMedianOfMax) / 100 +
          (s.leagueMedian - poolMedianOfMedians) / 20 +
          (s.teamMin - poolMedianOfMin) / 20;
        out[k] = { score, poolSize: keys.length };
      });
      return out;
    };

    return { ...scorePool(ALLIANCE_POOL), ...scorePool(PRO_POOL) };
  }, [mode, leagueMap, standingsCache]);

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
            <Tab id="coaches">Coaches</Tab>
            <Tab id="directory">Directory</Tab>
            <Tab id="pyramid">Rules</Tab>
            <Tab id="300club">300 Club</Tab>
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
              {SHOW_BRACKETS && placementPanels && (
                <div className="hidden lg:block mt-4 space-y-4">
                  <div className="text-xs uppercase tracking-widest" style={{ color: C.slate, letterSpacing: "0.2em" }}>
                    Draft Order
                  </div>
                  {placementPanels.playoffs && <PlacementInfoPanel rows={placementPanels.playoffs} />}
                  {placementPanels.consolation && <PlacementInfoPanel rows={placementPanels.consolation} />}
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
                    {TIER_LOGOS[tier.key]
                      ? <img src={TIER_LOGOS[tier.key]} alt={tier.key} style={{ maxWidth: 40, maxHeight: 40, objectFit: "contain" }} />
                      : tier.key}
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
                          <GridBracket data={GRID_BRACKETS[tierKey][g.key]} />
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

              {SHOW_BRACKETS && bracket && !(HISTORICAL_FINAL_ORDER[standingsSeason] && HISTORICAL_FINAL_ORDER[standingsSeason][tierKey]) && (
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
                                      return (
                                        <li key={a.id || i} className="flex items-center justify-between">
                                          <button
                                            type="button"
                                            onClick={() => openCoachProfile(a.coachName)}
                                            style={{ color: C.chalk }}
                                          >
                                            {i + 1}. {a.coachName}
                                          </button>
                                          <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: C.gold }}>
                                            {pts === null ? "—" : fmt(pts)} CP
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
                      { key: "cp", label: "CP", right: true },
                      { key: "wins", label: "W–L", right: true },
                      { key: "winPct", label: "Win %", right: true },
                      { key: "totalPts", label: "Career PF", right: true },
                    ].map((col) => (
                      <th
                        key={col.key}
                        onClick={() => toggleCoachSort(col.key)}
                        className={`px-3 py-2 text-xs uppercase tracking-wider whitespace-nowrap cursor-pointer select-none ${col.right ? "text-right" : "text-left"}`}
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
                      <td className="px-3 py-2 whitespace-nowrap" style={{ fontFamily: "'Barlow', sans-serif", fontWeight: 600 }}>
                        <button type="button" onClick={() => openCoachProfile(r.name)} style={{ color: "inherit" }}>
                          {r.name}
                          <TrophyBadges name={r.name} size={12} />
                        </button>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap" style={{ fontFamily: "'Barlow', sans-serif", color: C.slate }}>
                        <button type="button" onClick={() => openTeamProfile(r, r.tierKey)} style={{ color: "inherit" }}>
                          {r.team}
                        </button>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap uppercase text-xs" style={{ color: C.gold }}>{r.tierKey}</td>
                      <td className="px-3 py-2 text-right" style={{ color: C.gold, fontWeight: 600 }}>
                        {r.cp === -Infinity ? "—" : fmt(r.cp)}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
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
                      <td className="px-3 py-2 text-right">{r.winPct === -Infinity ? "—" : `${r.winPct.toFixed(1)}%`}</td>
                      <td className="px-3 py-2 text-right">{r.totalPts === -Infinity ? "—" : fmt(r.totalPts)}</td>
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
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              {filteredDirectory.map((c, i) => (
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
                      {c.name}
                      <TrophyBadges name={c.name} size={12} />
                    </div>
                    <div className="text-xs truncate" style={{ color: C.slate }}>{c.team}</div>
                    <div className="text-xs uppercase tracking-wider" style={{ color: C.gold }}>{c.tierKey}</div>
                  </div>
                </button>
              ))}
              {filteredDirectory.length === 0 && (
                <div className="col-span-full py-10 text-center text-sm" style={{ color: C.slate }}>
                  No coaches match that search.
                </div>
              )}
            </div>
          </section>
        )}

        {view === "pyramid" && (
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
              232 teams total. Every roster carries a 20-man bench and an 8-player taxi squad (2-year eligibility).
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
        )}

        {view === "300club" && (
          <div className="flex flex-col lg:flex-row gap-6">
            <section className="flex-1 min-w-0">
              <h2 className="text-3xl uppercase mb-1" style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700 }}>
                The 300 Club
              </h2>
              <p className="text-sm mb-4" style={{ color: C.slate }}>
                300+ points in a single game. Immortality, in decimals. {CLUB_300.length} games and counting.
              </p>
              <input
                value={club300Query}
                onChange={(e) => setClub300Query(e.target.value)}
                placeholder="Search by coach or team…"
                className="w-full px-3 py-2 text-sm rounded-sm outline-none mb-3"
                style={{ background: C.panel, border: `1px solid ${C.line}`, color: C.chalk }}
              />
              <div className="space-y-1.5 overflow-y-auto" style={{ maxHeight: "42rem" }}>
                {CLUB_300.filter((r) => {
                  const q = club300Query.trim().toLowerCase();
                  if (!q) return true;
                  return r.coach.toLowerCase().includes(q) || r.team.toLowerCase().includes(q);
                }).map((r, i) => (
                  <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-sm" style={{ background: C.panel, border: `1px solid ${C.line}` }}>
                    <span className="text-xl leading-none w-20 shrink-0" style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, color: C.gold }}>
                      {fmt(r.pts)}
                    </span>
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
                  {CLUB_300_TOP_COACHES.map(([name, count]) => (
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
                  {CLUB_300_TOP_TEAMS.map(([name, count]) => (
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
                  {CLUB_300_BY_CONF.map(([conf, count]) => {
                    const max = CLUB_300_BY_CONF[0][1];
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
      </main>

      <footer className="px-4 sm:px-6 py-4 text-xs" style={{ borderTop: `1px solid ${C.line}`, color: C.slate }}>
        <div className="max-w-6xl mx-auto flex justify-between flex-wrap gap-2">
          <span>Painless Football Alliance</span>
          <span style={{ fontFamily: "'IBM Plex Mono', monospace" }}>sleeper api · firebase · alliance sheet</span>
        </div>
      </footer>

      <CoachProfileModal coach={selectedCoach} onClose={() => setSelectedCoach(null)} />
      <TeamProfileModal
        team={selectedTeam}
        onClose={() => setSelectedTeam(null)}
        draftPicks={selectedTeam ? ownedPicksFor(selectedTeam.leagueId, selectedTeam.rosterId) : null}
        draftPicksLoading={selectedTeam ? Boolean(draftDataLoading[selectedTeam.leagueId]) : false}
      />
    </div>
  );
}
