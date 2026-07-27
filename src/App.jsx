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
const PFA_MARK = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAMcAAADICAYAAABcU/UTAACXHklEQVR42uz9d7xuV1Xvj7/HnHOVp+x6ak56JwmBQIAQEBIQEUFUhES9FmxEvyAqFhRFzzmCFK9eRWxEEO5FKYlSFC5KMaGGkgDpPTlJTi+7PW2tNcv4/bGeE4IioD+Q5HLG6/Xk7J39tFXGnGOMz2d8BhyxI3bEjtgRO2JH7IgdsSN2xI7YETtiR+yIHbEjdsSO2BE7YkfsiB2xI3bEjtgRO2JH7IgdsSN2xI7YETtiD0K77LLLrKrKkTNxxI7Yl0y2bt1qDv+ydauaI6fkiH3b2wMdYaj1Oaori+1vKkec5Ih9GzvGVgegqtnrXnH5Hz7vx9584Dmvv+aOt+5YfVY+dYvLVO2RM3XEvm1MVe8Po6q1tTNe+rN/csXFj3mVPu5Rf5X6v3a7Puxvd+lvffbgX6kONrZepOZILnLEvm12C4B/eddHn/8bP/y6Pc866Vf16cf/qj/vaW9X2bZH+aPdYcObR/r97ztw7b/sXv2e+197xRXuyBn8FiSER07BN/8cX3DBVvvRj24PqrrwZ69457YbP3bLL95z6x6EgvXHLnDKRd/x+Q8c/fDTPnuo348NTZZJfv4W3zznlPgnv3zWuleIyHDrFep+76kSVI+c0CP2/0AIddFFF92fN3zyI1c/9TUvesMXL37Er+h3H/WzzbNPeJH+9AW/s/p3b/zXXwF4w+fv+57z3zM8JH8Z1P35Ws3rV/Wkt1f6kquWP3nLYPDUw+9z0WV6pOx7xB66dsXWL4VBqjr7xt9/x+suecrvVM8+8ef1Ozf/TPPcM39VX/KcV9/wocuvfBTABdPnv/WmvY+/8L0Hd2R/E5W/HNf82Uro/81Yn/mPB6q333rof6nq/P2foXok1DpiD53wSVXlItrdQlWzy9/0gR/51YtfcffFD/9lfeqmnw7fffyL9MfOf7m+9lfe/FeqOgtw7rlvyFRV3nC1ZgB3VwfP+MEPHbpq3TtV+fPVwJ+vBv50VU9661BffMWenVfsXf0xVe0eTti3Hknaj+QcD+LwyVx44Tbz0Y9uDwAY+PBlH/uBK9/3+Z/be8fSM3befh/qDP25WU565LE3P/L8017+Y7/8ve8iwYtf/Lri9a//pfpLSfeFbH+KBFVd/IWr9v7Jx5YWfvz6XQGiemIykry94OQuT91cXfmz55R/c6zrvjUe/iKXqdWLwBiJR/KSI87xLbXLLrvMfvjDy+bSS3/OT52ke+X7rn7cVf/8hW03X3P7dwwPVHZ1acXPr1vIFo/pDR/xmIf9+U/+ynP+aHbL7IGtF2x12z+6PbYv0xIu9yIXR0CuULVPEQmlhb+5e/CiN183euVn1xbnVw9UyTo0NkHn5jru8bMrPO909/nvPLn3mhM7nQ+JyMo0KbFXXHaRXAhRRI64yRHn+OYn12xDZPs2YLsC+oC/nfSG177zgkP3HnrhrV+47zGH9q7hK6/OOdlw9Czrj575x0t++6LfPf3Rp18L8OJnvLh4/T+/vu71Sl7z+5f+8D56/9/6sx+73O3ZN7/w/KPfG7QFAC/ehrJdkmp12m9dvfJH/7Kj871fXClJoUokGwne9Uojj98MT940ufeRi8WffP+p9rOZzH4yfPm3l61bkW3bpr8AHHGaI87xX3aE9ryYSy+9Rn7u5x6TgPujF2OFGFJx/Wdv/b73v+Njz9294+DjmiV/4j133IuIxeaOmYUeJ56+5YOnnHX0H75g+w9/KDaJrVu35tu3b/eAaq1n/+GfvOsPP/25e57OCZs5/Qe+j45NdPz+Dz7l4Vt+/9zF7scAXnfbbcUvnXZaXQDv3jN69j/e0fz2lfvy8+5cy/FVA6I1PmSEZB5/whwnZfuqM9Z3PvzdJ7lrH7sxvqVw83f4+ABPbhMVc8kbnm0vueRczoU0dXQ9sssccY4HHLeiCtu2bZOzzjpLNty4Qa7kSrZvb8Od+59pQKMu7r97/7Gf/fTNJw0PjX7qus/ecd7dN9+zTqKxK4dWCVWq5xbmCtdNfsNx8589/2mP3f4jv/DMK0XEwwVu69YLzfbt2xtVLd79D594wcc+eeurr79p1F9aIZx64XHm2Gc8QU3WQUTtujJUZ2zI/urZx868VkT2trvIlcL2pwRV7Vx27/DZf3/D+Dc+t889cl+2aCfLY8TitYpK0nzjhhmOy4cckw1Wzz+uMzhuTt81l4f3f8+J8/sg31WIHGy+wgm56DK1Z25AzroQvRGUbbBt2+Gd5v7/6BHnePCv7Gzbtk22bdvG5ZdfLgA33nijAJx101l6OQCXc/nlZypsP3xRv64L2+kVjIfVcbGJT7jin6868fbr79jgh81TmpGcc+u197Ln3n2gDlCipOSsMwtHzdKfyd76yCeeevkLtz3/n1JQADn33EvcNddc6gGu+vh13/UvH/rCr1x7w/5n7Ng5RvJetKa0Jz7hGBaf/EiSFnTLIgSJrp9bTl8vd5574sJvPaKQywAuuELdR58iASAHLr314HP+9kZ51n0r+kP3xHX9qvYY40k+BRLJKHmuyvoOnL7eccYGSxkO3tjP0sePn5c9D9+SDx6zYeFacDfNduzeQZX+C/fOVmHrNi4663KBiwA4c8OVctaBC/XGi9DtIumIczzIj9A6g7OOalK76b3l7rxzb+n9ZMFWHL+0tPKIQwdWnrCyd7z+9ut3lAf379tQlr0TTLAc3HuQ3ffsJ9RaZXkuRacsil5BrRMWN84tH33cpr/ozNr3br30Fz/nq8gbLnlDduk113DNNZd65wyHDi2f+oY3/NPvfeHzu56za29TrA6aWHT6JoiREAzHnX8sD3vOhdTeMB7VzM70WVlei26ma4/qKI/aIh962gmLvzYrcp0Cl0xLvpc+RnwO/N7V95595V39RywH/4u3rdqzm9jpSNGlbhI0k6RRfAgJfGNtbtxR67psns1YLAJxef+EkHbPd9zKxnkzOWqeuLGnt23oyzULRnaUTnf3xC+fIDKZPbpoYH0Cmm5ufAhK0P+3t5KH4s5hgBLoAr3hkJkd198zt3vXzt6hQytmMFizJM38RDpC6ibVOcFsdEaOAXdyM/ZnrB4alssHl2U0GJhYReujSvKCRiE0NVVV0UxSJOHVJtef6bnuTJf+Yo86TXbMre/e8djvePhbLnjuY95z9DFHjVKbkbitWy8z27df3AAcOLBy7nvf+7Gf/Pgnb/35e++ZuNVBoOhmsTvbt8vLY8QAIXHcE07j+Gc9hWQKYlKaxkOMuCJPq5NAmYs5eUHjOVv6l164pfOmnsg1AFtvuCHf/qeVculjvAGibjVvufGFGz98h/7QF/bq9674coMIj6zKecYeQl1BDMGrSYSkqAeVwmYF3cyQWSG3YLXGxZoieTomxH6paV1p07rZjPU96m7G7U7S3daY+yxpn4awRNSB0TDpl2WzoZ/H047qrD1iU3c3sFMewruHPEQcQkREVXXzb//Eq/+4GoQtNnMz1rp5I9miFTfnjMU3nqbxhCa2P9eBalJTVw115fGNJ8WYrM3EWifWWjAWREESaJtwi1WQQH+my7qj55tuv7xiHOqrTzn9uF2X/NYPf0BEdnzpe11o4aP3F4ia8fhJb37rB3/6+pt2/Mitt64W47HQNCQlis1Eypkuo2FNVhRMRg3HPv5Etnz3k8mLOVQTUZUQIyoGVaPDSZ080R69MMOWzqh++Kby7U87Zu6tHZF/fWCSfZFuk78XiXr/OdvXv/jt4++6cy07RbL8BOB7lkJx4lIDURwRQ4xCikqKkRRiQiUAihVjwRhEgiQj0uZnkCiMkDlDWRh6GXSsoeOU0kHHQieDZnSQ0xe4/eJzNz7jSZs7d21VNQ/FEMs9hJxY1/YeOn7nTft/2C8ZEEgpkVIiRvVKCiC0TpQMRgvrrFhrcS5jttPHzThc7owaoYoVPvhJE6pJiL4uunlYt2mx3rhl/VUzs+VVMU1uG0/GB57wjPMGT/++J+8WKzUJfu63f4TXvfh1xSf2LqmINEBQ1fmbb779cZ/8xM1bL3nRnz5y7+5Rb8++VYwr4qZjNtrl5YERMaQgjFbGOJeTuS4T63BZicsty0vLzM3NoimRWUsSg09Iv1fYIMrO1SretUZxh7qf/Ke7dv/QW27ff+sZ68s/P3XefXCBzk4RafevrVe4l3z3yZnIxhHIuwEKgbfdfsfGd1yV1puNnY0z3e6jV0fxmfsH6bRdg8YOa+naMpvJ+utz7yxVgKZJNEHR5NFQA3ic00qgQnTghQO1b69NUhEFTRGMQrAy7M6fevSdhzYDd910+UMzfH9IOMfhpPuu23cfVeZF7alc3cRkDDYvCjPf62V5p8jyMqMoM0ymVKFaJcXdvqkPheRXjGWcl1J35zuxM9NZXdw0d8Pm4zbd/uhzT7v3+Ecev986O0rxKyxuf3n/T9kl517Cpddc6n9pimqr6uPe/vYPPenVr/67n73hxt0Pu/fug4wnDf3Znp+ZmXO1D/bg3kOIy5hbnGM8qqknDarKZLSMtV1CCmgyLC4uMqkrUlI6mUMQDi0dwvU6ZGVJJ3O2o+j+ncsh5lnnrbeGc9bvGv/1WYuOjdnaO/5l7+jKp2/qXt+x8qk/3s4DoA61tZKee4rsB/YL3CRwJfC/DOB1T+/ueuGYa3ZOzrppz8HH71pjw0rl80ljZiqVdepkoxh3nJtZn48aWGtg2CRGPjL2UDcBP4moKpAwpaCSeyDVk/iQbth6SDjH8vKyAeLywaWTCnGF29iJT/nR78i6vS61D18YHBp+ZG04uNdP0lLekXrjhvWT0x592u5HXnDqPmC5O9OZTCbVA9CKf2+XXXaZBeyej++RT3zkE3r5TZfHL8M3DP5vrn0jqrpw1VXXPf/DH77maS984f/6jpXlNHfHbbuIKVMIKtaKy4psXNWIUax1pGhYW15D8pzZxT7D1QFJC0QVJZJQUoq4zJIwjCcT8iKnvzhLAJICRmlikuhMZi3aLI/1jrHKrStG5vv9H35YsD98xY77Rq/5wo7PPfaYdYdO6efv35jnHwL25taon/r9A8t26aLLrFz+8YqLL74VuBV41+Hj7VoYBe0B6/bht3z+vsFROw55t39Qlwn6aswGa+VYiz0dI+dUwfQnCa4+FOQT+1QiyTij+XR5O+Ic3yxb2L0gAAf2HThBgnDSw4613/+zT39T1sl+F1jOSjcJdfxqb2HP5RLzhGcUZnHTo2V2cUncCWekG298T7r00ksDoBdffPGXOUO3VzIaTuY/8pFPH/fJj14/V3bMWXXjXvD8H3v1SYf2D+ZDKjl4aIkYky87xuU5IlKIrxJrqwMiifUbFvFJGa1WSBJS46lMpJgpiTGnqSPOGJoQGY/XWFiYo64jzXCEyzIwAsYwHo7xdUMx20PEEUC662YFX+NjYlCFeMVde1MyqTc/17nww5MB883oucfMuLXT54rw7vv2fSHz9T/2MnPLyVvmVzfT3Q/cJyLh3923F2x1XHiWGe9ZVhEZAyPg3n93QoHcwdhrDvSAArC/8Zm9f3dLVVxQRY8z0gM486KL9IhzfJPsRm4EYGX/qsvF0VT13Vkn2yoiu78E1d0f16avgGnEa7g0XvPPXwEKbHu1NwAn3nT97Y+8846dm6699pbOoT0rm379xX98xqiO5+3dvcK+vctABzEF3ic1bhw7vcLGELOYPEYDRVmSQkCjx9qc1eUBAaHIS/KiYNJEqiqSiSBGiUbxIZEVffqdkvF4CBj669aRRCFENCWKbgdXFCQSToXYeGptIHNtPcFXtpeCbbJc9w7HaVfVqAGXHUqz4peYyfnOo+fK7zyql7NlEJDRYH8YTz77e1ddvWPjXH/1uIW54VnrF246zhU3AzszkUn4GtckApMA07zrflzxJVft29ctC8bVkFSaeYDt246EVd802/O+PQowXh1LkRn27z70eWD31q1bzfbt29U4k1yWUY+rw2XeYtfNN9u1MXmSSc965saTekPw6Zgm6alra6NHLi0P5+/budv++oteWTRj3w+xXCfCbAoZK0tDlpZGDCeeWpMal6WymME30YgBJYhx4nq9LmurYwQItWfoB4Bl/YZ1DIcNddWQ57YFDFHEQG4dsfYkUbKswFoHKTCpRhgRFIEYMc5QjUakLIfSETTRhAZxlmiB2D43OEv0DdFX2EJkQzWxJhlCL2fsxzqmYZh39bO7lzRKIrkMp37j7EzxvTOZY6ae0D24hvnCdbETmn3ShNWf+uAHxkevWxeO6nUPzjvzmY64m1xm7/VpcHCh6Q7ni43h7OPmql5eTnzweE1svUHzbWfht35+ORijVBqxxI0C6Da0xWKPOMc33G695lZFwDc+B2jiZGhyo+pVVLX441/80xdYP37YG3/xVcc4OD3EcGI1ntiqmkgY1dI0tYy9MgqOQ+RMjCVMi56aEtUwUTfgHBGKiKiIRWxuZbbomAC2aSZgChBPr59TV56VQwOME/Iix9iMalJhRVldXiXhyDsFMXrqukaikne62MwyrEeIy0iqxBiomxpSRq8s8E3E1zVWCjr9PnWLYpJEqQZr5P0OyQlqMhIRfMAWDl90iRrRwpAEJAzQTMTlHYIm6c7kaO6giaSVNR30snhwWGmzNiBmE4xfzfrWbjGdzhY9dA9m6U5MSuSpflbmazqilA4tjdFSXCyuym552ttfe0M3pKve/kMv+YsLt12Z5OFP0T+4cW2P0YYqgRp7lGn9+MjO8U3EOJLNLaGKXVHFWVNrS9FQYObzH/78NllaXVzIxlhNJAMmM6i1JDVEp0hvjioYXfGROhON4tXlOUZVPAFbIt1uaWOttg4NM3MzDAaRGBJqta0lkxCTcK7EE1GUGCI2MyRVRAUVQ0oJpa3e5J2C7myf5ZUBk6pBJ4mZ+VkiGeNxjRpLkWd0sj61rxlXI6wRnLGgilFleWUZm1tm5mdoUoSYEAMmQagnmE5JZg2SErWAmoQPigkKFlIMqIEYPaQK20tCPXR5XZHZBF2DH9caTKEm1ozqVQ2poch70kyWJU2WZaazgCXKyoEd7UFqOpuiPHu9zx4HvOmjXFkBLHTMfhMDdRK8muOsQNSHJqnxoSIelkIVbEqpr6qU/W6aZhUCQ+MoV2zWiWVRhF6n1JlOSSfP6c2U2LLF+bQZQRhI4aIYScZJsrGeWE3eWIspciPEQGwCzjiIAauGWAcIASMZoonYRIar4xaoI7Jh03qiV6pxTWd2lv7cPLOz8+RFwXhUU1WJ0XjUOpU1OJPjq4CvPQaLMyAkBmtLECO9mS7FTA9FaIInGSg7HUyWo8YwrmuSRpp6TDAK3Q7RQPIeCQGbIlmEzGRoaDCjVfLY0I0TiuESolDZLuIUlw+oukMqarQoJWgyVb3fRDexWUq2k8RIGos4pa6G1CtLGJNjjCO3neA0j3kmqw/M8eYKlkxq8CQCcmqdHrpdig8lZb0Zo3ZBEBY3LhyuKunBe5dsUuN8xDYxGo1BUgik4JlMamyeYdVhPeQS6JmaXCskGawYitxgkxImAV81iAHRaToqQrfTQ4CisDhn0SSIMXS7JVluOXjgIJoEax2jwZjB6oDRoCY0kSLPSQHqakLRyej1e6go3ic0WYza9neF8aQBaRdlBOrQsLq2RkqJvCxAhKQJU+R4ZxiFimiV5BQcjJsxdapJzjDWCmyDzR1NUVA7SzSWaB1JwGmg9DViOmR5h9wvU/g1eowpy5xcLTNFgeoIzUBUiXHAhBqVRAoNs/310u3O2OSbFsvYvl0BFp2smBSTqjJq0rEPsXvsIecch1eeBUlylE+BjUdv2HvYOfbuWLMgJmCIIggJUUUSmBiI3rexOImQauZmHLMayGPAxgB1hcUimpFlsGlTD4kBXykxNqQwREMg1J4UPdYIkKZOZDFaIICzBoOgQYmhRiRSlDmIJ8szmjoyGIxBEtYmUE9UTxDIXMbiwjzJJBAhIpgiY3HjBiTPUWA0XCP4GmNt65wL823OkQI+VOTdHFcWgJJlBp8idQKTlQDUQYl5F3UOmEAYYNTRDQErAecsUmbUkzU6WKwow3qJFAMZhuNmNyHWoRLBCYO1JYajVYzLvuxizTszsKoREdbqaOFGe8Q5vsnouF/1662xW7yvdcPmxcMlXHbfs9uJWiEZQrJtlxIJq2CSYohkzpAZoRTFLx3EhTF5arB+wmy3S+ksDgUfWd6/jDMFvq7p5IncJowWaBCyDHr9DmVZMhmPmVLTMbmjOzNHXnZQo2CVEBOjwQTnlMWFDtNUgbJbMrc4jwqoRKxGYogcWFme5ilKmEwgJZJG4mCJnIpev8RmDk2BqqlQTYhRxsMBeI8Vaek0IUBTUxpLSaDn1+hUy+QmUtaH6FT7sY2ndj3GROowArGEuqEKNWJqAmPW/IRoFEkRI0o0YdpAmJjt9rGZI2ng36YT85kOM41JBIZNhL3rsiPO8U2yDTduEIDrr7tpXWHKMkWt5td3Dxz+++rOyqbQpswxWkja7hySkBTJxSIoLjO4LEe9RxS6RUavyKjWxuA9mXiMWGZn5kkpYEwkK8BYg2BAAkWZM5mMqOsGZyyuAJeDUWH/3hXGoxrjhPUbFsmyDGNymtqwtLRGSmDIGK1V7N+7ApohmjH0yjhFNmxYDxiaEFAEEYuzlnGIjKIiWU5SZbC2ijGKXz4IMdCdn8GWOVEDEFokXT1BWsBxkjmqvKCWxMQ5GmdIFtSAzerWQaMyWwpFNSZTh0Yls5bcClYjDWPuHe8hETBqyEwP5xxIQL/EVFGAmcKOMpOiCIx8Ejqd4nBh5YhzfIPtSq4EYO/de109rDFQ94+aWzr89+WDS05jFEUIyXC4hqWqFMYQxxV+XOEnnqZqaRll5kh+hNMGCQFRT8cJ2sBwbRXRCpMyqmHDcHUAEhCFydqElNwUcRQyWwCGeuIRlOCHBB9ZXh5R+xqva+S5pQoF6zb3mZnLgAwjBcYWqBRkNqdXOELVIFEo8g7F7AyTumYynjC7YRNWQJJnoh66Jb7MWYkQsISk+KSE4AnNBJsbTFEwiQ2RhEdJIiQ/wdocNSW1cSRpMM0+iEOCwlAtjTG4KGzOOhDGhFjRxTJjekiySIokSRxa3c3aYAlQ1H05M2Eu14kzmlSVsY92nIXukZ3jm2Rn3XSWAuzft7+o1iag4jefvHnl8N8Prqy6pGpB8GpIhxex1CaOooksy4BE0oS1Qu4UqRpMUEwCp0qv7KBBMY1ncaaPmYZZ87MZcz0zDSmEbmmY6eRoNDR1IAbQKMwv5GzYOI+oMBpUFEl46pNPZOOGBarKUI0D40mNiqIaCWEEeDIxVMMBo7oiyzMmgzXEe9TCpKnJQkUdLRvzwKZOpMkcEz+hu2kOMkVChUsjRDxoRKshLlQUQJEC1g8R9W0xoVpDUoVLiqtrXMwpbEHjxwyqZRIVKpFVozTGY1ToFV3yme40fEpszBcoyh7iaBm4/8YKtC5sy/+fJLUHJswecY5vXs4BQDXyvWYY0EjYfNzmweG/Hzq4liVNRkXxSSSqIBoxJEQTGiN5kZFlFpMsYTIhRaXISlJsWNzQp+McywcOYVCsVWLyZCqYlBGjEn2NS4JGxYq22EnISEmgDoQQMFExOFQthe3S6zlecMmzWX/0HCbrMKmVplHEGBY3zGJsIqQJ4+SxvR79+VkqP8ITqZNSdrt0+n1iVDqp4X+c2uW7j+nTaKTILUggao1pBhidEK0lL3NIDSYFHJGONBSpAYSYFGsjMlkjiwOSrWmyPqGx9J1h1jpsUJSaYbXSVujEsNassn+yFzIFY8htiYhB7RRE5d8ymVOTW5JqIiAmRFkA2PYQbKx7UDmHqsq/jU0v53JFoG96izJRNGgExof/Xo8rqzEJtOzVoIJoAk2AJRNLGK/h6wpUMDisBmysydQwWhvjfYW1jtxaRGG4NsSYROEy6kmAVJMZodvt4auK0WhEr98j+Qmzc465+R4rB0fsuucQVSWMBgPOecwpnHrKsTz5iSfRzxRf56CWuk5Uk4g1PZx0yCVRGKWuazAFM/OLkBVMJjUpGup6zLNOtJyzvsvD5nrMdYRRsoQYwBjiXJ+BK0gWQhq1+EJWMBFhYAsmLifhsTZgxBBtTp1n4AypOUCjBwk24lUpndItLGItSqKwGck4CBkmCmphZ72HSiusZLgE8d/R/LtNZlFFCRrd2JgNU+f48grkQyAHeVA5h4ioiKjyZScuGWfommKLHSlGTQKqwyXeyeooSySLgmLwrZ+gRhEEG8FGyG1OZgwptOTbIi8RtaRJg9FIniesVljxFFnG/HyOUOHUMDfTI5eGOBqTidLLhHq8hkSh35uFKCzMz3D8qet42FkbufBpJ/KCn/kuUlKe8dRH8l3nb2JuLtAtxpS5Z7C6xrjxeCAoBKCpPZISRiPVaEBHx5w+U/P0YwuefvwcLjlO7WdcdFTJmaVynPUUoUbDmDzVlM0yLjb0M0NHGuzkAHlYI9MGGytoVtE4RrXGhIYiNBRpQm6VJozx1DQ20YiCRmadY9a5dmewigE6KcOIa4seKWCSwr9vgfHOComWtD4J8ViAbVdeaQCm80n0oaCd5R4sO4aI6NKdu44b3b60IM+Qa5WtRtieAGIT5b2/966TbZ3Ic6u0LFABtKomGW1fOUmERgUFrAqokkTJkzCJNRHBSoZgaUKFwWIxiIFuv8t4pSZ5iNawNjgAdLB0WTp4ELSHqKPXLTFuhubgGnmWsf++ZaqgnP2I43jhS7+Lo47eRCc3zM/NELxnYa7Hy373ufzs8oB77rqXP/qzD3HHrkhvtk89GuKwqFiyTsawmZA7KHXAj5y1wNnruvRNRqa0TVAYXnDsIj+4xfO2uya87Y67sWUJviEzNTEriKlBUkWvKyT1NCmhUpNZj3gLNiOyBtUS3W4XnzyinkSiSYFxCohTgm9YoqZyAWKidI5jZo7itr07wdTEmJDDLcZfbiFzJiUNpDxnzaczAS5sL7TZLpL0wIGZL3hfPnrLlgOHr/2RneNrAH29hfVzS393/fu/+Mr3P1fYnqYNSACl8/ooUyudrFDAw0VtKBWNI6k5zGDwattS6LRsZVAIiTJrY3KbEmE8pnCmDaMkYlJisjYAEUIAiYlOVrIw3yf5Ib3M0uvkuNTQDGuGK2t0i4xullOWBWWZc+fty1z+lo8T6gmzC10a79tYX5Vut8Ngacz//rtr2LGngaLLcBhJmpFESSmQOeh1uiQMTTHLp3ZX3DNsCLFthpIWsEdF+OC+/fzjgYNIPyfZSOokqo6lMhMaN6aySu16VOpJpkIyA1lBMDUma7DW4/KKFA7hwwiXlE6MbM4dBQkniYaGQfSgbWWuInDHyh6SjVgcXTuDadllcN99D7yW0aEkjXhrWfXp2LbqeILbLpIuu233hr/affBjjdifBbjmQczve7A4hwLkC/metGOYrfvg8M17P7Pz/IsvvjhO1UaKsByOdTX0XK4mM3oB+6fOEbIWdmurSUEtSZQoICLYpBiZhlc+YdXisMx2O2hqsLQgl8aESGBhXRehJkwC1XhEboXklZluxmxZoL4taa5bKHECpIZ+NxH8kI9/eCd/+Mp/YOfOvYgYohjy3HHLbbv4lZe+lU9+Zh8hOIxkmMwhGjCiJCeMm8D+wRpOhJnMcUvo8sYb9nJwXNFxDqRF4T954ABv3nE3EyoKGrLkyWWKcusEhwdfEwf7yWhAwWkNYQWshzTCakJ0Bh8LoiQCDZUJDLzHpUjHw3HFetabLllK5EmwIRKiBw2Uec5Cd34KAgI7v+xaxtyhIp46RUZR7UWqdvtTTqxunUxOeseOez/8uXF9ztGLM/cdyTm+zlxjunss2fXlofKq1ZnR733i/975sVseISLp9iuv6w9v259mNKMUgybldE5vkXPvHaqGqYZSxBAx9+vzqQGMIVUNRgM4g6iysrIPFZBkiU1Nih5SIMsNRhXxMBlVGIkQYLS2ho8jYtPgkjJYW2YwGBLrhsWFLvOzHfIS7rlnF/v2rJAVjpWlVYL3iLN0+4sU5QxGE/NzOfmMIeoEyZWAp7FQdEuiTVRGGQ0GHN/vsGm2x77JmNUQcCJUocGIp4wTxK/R1RWK0SEW/ZhO1VDERMdBL4csebJmQBbHFAky77FhjNZDCpsoXaBMkQ6JTDy1r0EgmMB+v8REaowGju7Ns+D6GFWMMYz8iN3jXcQp7+q+L/eO5ExCSHgNrHk6l4vEQ6oPf/2Nd//LJwOPOLS6cvCYvHMjwF2XX56OOMfX3Dq2ioik2TPWN1Vc0+yDq/PujXe978C1O09vujaEHWuuH3NyO90kDr8uJaeoQQ6TxFvnsKn9SUVbzpMkXLeLzQQjEWeFTi4QEnmeMz/XQWNk+eABSpdBDPQLZV3fUUpGnDSUuWXjYhdpKprhhPnZgn7HsX/nXsbDASZNOOvskzjnnDO46mO38LJfeyN//qd/z2w/55TjNkJd0bOWpd37WNl3EGNnCFoikjMzM0suwtqo4uBoglPl8ZvmuHn1EK+5/uP82Y0f57bhCmds2siJxuCjJznBZ4LMlIxFMX2HMRWZTnAKYHG5I6TEOEZMDtiEKwTT7MeEVSTVdK2jR04hgtWEJVIlT0yJwjn2VysshxEmszhx9LIOmjyQiPy7nsHkjKgYZbUaES2nLGv1ay+7+oaPXL5n+ZQoGi3sB24DuPHGGx+0ifmDJ97bCmyH3gnr3jvIwyOk0mDffe+xk+Plw93zj7pl/gASa8G4TB7oHCYZh6pRFJHWOby2oJ2qaXEqVcRa/HhEVItV0zJcMwfOIwJOwNEmmBp8G37FiEXJ1KA4nFGQqs1TVOj3LOOJ0FQBK446erZsWeSdb/0X3vGWq6hHltu++CnWVtbomgUKDWS2S79bUHuD+Aw7JV2NmopRaMhqz0ynYL5juWVwgC/uuJWRHRGqMW+6+eM8evMpVJNVkg04CykoQROJiCSPJRG8R40j4QBLEsHmgAUXFEIgkBFFMTaw6kd4BWOEPoaOLdgblCARkqfRiDe0JfKgLPbnqYZrJAJJlZ1f2jmksEZf8InbMUYZ1yPdl8WjX7Pz0P98y479iOAX836WWzeyIiPaTs50xDm+lm3fprCdejJ5j9k887vsaFwzSMpf3nUMn1k+Zt3ApbGKGFeOvmyZ0mAzca1ok4GkhqTSBmliEVLLhMXgk6c3v8h4eZUsJWKoKa3gG8/QVzjtE0Kg1+9STyBWkXGq6HTniMMR1aAh75f0ypJRkzh4cC9JCzKTgwqdvuHaq25j191jMolEDcy6ks986AYwPWZdD/VjxCpzyZL5QLfuYlMkNhPKrEcMQ0wW8fkSnzy4A8lHZKp0Cseu5hA77lphmEVKSqz3WFGq6BFtQ6LolTwD74ckFULlmcl62NSgk900WcZICuj0cGlArDylyzHJk1SpNDEIieQiLiZms5zlCKuhbpF9F9k72o9KmtIk07+tPIKkJhBxmfI3N96t+4bDYPLCGVVjVTim19+fgK0XXnjEOf4zdvBZx+ya/797B2bHrr6xOfFgk+oP3q1dcok4VLJ9AMsst4CGnQ6dUEFVp3mHQxOIjSQEFWnRbxHCZIgkQB1aV+SaIQp5b4bYKKmOlM6SbIPWECtl6Pfj8i6aLHFctUlpNkeQGtRTNZ6ZXheTPLtuuIuZ7kZqv4zTRD8vGNftKtzXBqlrhqEidQsWfcPJQ0uVVQykoMsSMruHwi0jcS/d0lCFpgU2U4GViOaBxdRQNoFRUGyhlFnCp4CPqQUVkzLAEElEGzBmgoYKkzmcFcoEpjpESkNEZrDiINQkG/ECIaX7FxVvDZoizgE1FORU1CRaccTWOb48t44p7hOrR/vk2TfwIi7LUEiIlcmIU49f97aWOHflg1oF8UGTcwiil3GRfeTJJx9sJqM/m6UUl9RH8cZIbi1CgaHAHQQ4c/q63Dgjoq1gdJvdE1JLXJ/+b4SEqiJYXF5gJCNqotPt0uuVUHtcU2N0TGkyVg+uoiTKbgnS0O8XLM6U2LohCw29rMY0S5iqprSeU07YSBrvJ2PC5vlZ0ugQM2HAvI4xpmHd7CxlquikJWwacNp85JzxHTzuwBd57PKneYT9MGeXH+HM8l2cWH6ILfkX2GR2sej3cQKRdXFItA0pixipESDLAkXpoRng/AiNETER4yJVqsAGxEKna8GsIW5M5bokzck1YkKDsyWYSBUGJAuFy8mNxaaEKCRNrDbjtlPQAZpY391AqfmUgZBI6vWo+tFtoLt1qySFCHvFgoqouJZ14JKCmrTOopu6zZVtsLBNjzjH15WQq2y44ExBRPfvu/fPlhf1hhmVvFCCpaWNO4SC7CAP8A5x0sLpqtOVTIiYqXPo/YViIaEpEX0D4ikEmvGIajik43KoKgpr6RQOJwmjnuCHWAnEyYTB0hIdayA2LMz06GVtTuK8srZ3D6WUaO1hskbWjCkQ1i9uIA4rWDlE34/pxFWOqQ5y0j3X8fCluzi5OsjGapmHuxt5mPski7IbZ5WuCn0L1lVYatY5YUM6yExYY0Y9qUqMG0EsSOaIInScIY8Bk2qsTXTSiG5cpfATimgoNTHrV8nTmJTG+HKG1J1DnWCsYgw03iOhoSMwZxMd0zaOaQoEnwiZcN9kF6M4uH9ch2rihKMnX3aTB0n7W+qyIGJwYglRfDYza06e67/z+4972N6tqubBDpG7B9POwUcJV/OG7Em3//zu65/77h+ye8bvKT536NRQ18HhJIlBYRlgS2dBAYqiiNVwooJMKSdpWrESnEw1olshV2wQwniMwWHEkGl7YymRzGWkBEmbVlM6BJyANRlaNYgrURp6ecbqoTWiz+nlOainnkSKfAaNHl8v4/KCcnaW0fIKvQgMh6zr5mxaKHH33MdM8JRO6UnCNZGNuZCFQGa6rPo+mTFEBnQKIVQTRIX1zYhKGgbGENwMHQ14rYlO8RqofURiAmfwmrBphIjQaI5V0KQ4rQghkGd529w18WSqqDiaFJhowAuoxjYU1UQXZbbbZ/9agw+JmMZTVLzlr0lKyqnfkx4IWAWN+0UMzlhi0tSEqAvrZ7JH9fjCeuN+TX7uUsulP+e3H3GOr8/2/slVm7q/9Pg4K3KQBA+//AduWlZ9+tpvf/Ivy/fvfEZ17e6IWtV8OhhyarZ0EUG17b5GMQQVEtrmHQIJbeX5osEKFDN96tEEE2qSSNtfgWUymaB5gTgBG5mZnWW8VBNV6JSCcxnjSUXjHeIiSWvWrVvP8tKIUK2RFYYtp57Mzh07aVZXkCjkMo+RfcxWSxR7PGVqyFzGbGEoJ2vkzQgZNPQ7HTJdItkJe7TDsIAsOryLTBBglqBt8bSTj9AYqAN4daiJxDyBBjxCjEqdd0jR4NIQMQEbLSlacmOI1jJpanxsgVLjlJQSM70Oa+MJyUDlW9wHA5PQoK5iXXA4v469HGilT0gYje0PD3COJqUDWSaMqxRsYfPHberxvcfMv/c5ZfMzZx5z5iEBkq5teNv1O2Z+9BGPuOtIWPUfVXBbIhrLN939y6s//Q/X3vnif3rZ6jV7zwdYENlx3O8/8ZnZqx73Gvs/TtNJ38h4WK0+8PW9smwEiYezCw5jHQ/gLqoI4hzYlnZerw4gKMlDv98ns0qcjLAYnBM6GUgVWDuwjAmx3UlixNcTYtPS2XvWk+NZ2ru/7UOPNabyrOzeRamBTlA6BvJ0kOMXlfW6SjlcIkMpJVAWrQPiwJlA9DWZUzbbvWzuHsRakFTiRHA2EPMGa6Bfe7pxGbIKyRzqIVNL5qEboNc09KKnGxtmWaLHkMyDjTWOSJYaMj+h0EiRCc4FmtDgVal9QyaRjkktM8AKzdQ5RKYhXJ5A4jSMTQhRC5e1HU9n3SS0efvSxDQcu7GT//zpR933irNPfMFvn3LKD5x5zJmHbhwMvvOXP3njtpd95s6bkrL1gfShIzvHv7FtLbyBe8Tim1b//paf2XR791X7P/H+we0/+g8f2vDzT36VOLmGyMsm900+eNOWz/zl6OCBxKeBc8+Fa6Df6/tDZimKxiwawbT8NgIGkdZhBMHXNcbmONOKnqkqYoXG18SkiLEYA9ZAParIyVpCiijdXofGN4CSuYyQKorCYUKGjiCbU2Y3rGd035AwrMht2b66WqGvDT1fUkhGLmA0Ik3N+NCQOSBqopt3wEwIahDTY3PtmYTEilOEhqLxVGmClwxcg6ZI4buUcYi3iVEtZAgm1kQStSQEj2jFKOQ4MUAipAZnIkkTWUoYidRJMHQwZkoPMYozSiFKiIox0lYDk7KkQ2Ict9tDSqARS0ikBCAXcRGXczlro+WlZx21nqevm/urFx977KtE5L676/pRb7nl3u2/cNUd33WPK8snmXjXq88751d/fFr+FZEjzvHvco3t25NeplZ+xNxx70du+uW1137urfKBnb2Z2+IP7rv+Xc+88xf+8T29H3/cqzrHdq7QFT3/xo/dOMNbYGF5IQHMrJubGCNBtOVTmXZcBEksSmgFF1QwtP3lMSmaZ3Q6HfxgQjWqMDZHDCSNmNj2nFvryMocPxySqoRRIQKdxQLjPaPVEcn2sC7HNhXN2gD1NV0g+Zqsl5g/egF75350ZUiXgFhDMoFifo58UmHGI3I7XTabEb3SMq7nQeGockJQj+LphA3Muc3cku5iJYOQZjBeiGmMzROzRUXlIyGWELJWSkczvMy1gnZxhEjAaCv8kGh742Nqk7KOCWQ2Y9gEGlqsA4VMwOUZdiK4BLlJrEZp53C0hHuyFHQyvZZnTtHunz/5mBuOmln4ridtXv/hF6vOvuGefa/7/z5xxwuumUjnwGqVvveYzL/knFN/yYgcvEzV3j9b5IhzfAUHuVjiVraa4y484227//Hak8JqeMXqp3Y35rpOyU23/fDadcs/cMvv//N2e1T+mjTxy6oqF198MQCbtqyb3Cw2KGCTIJKIIgTNQMI0cVRMEmqJYDM0Rpp6ggmRzLgWXbZtcBbGI5x1hKZiUo3oz3QIDURvENNQLe8nJ6eQDB8qnAkUHsYHl5ntzBObBh0m1p9zHOf9zPey+7f+gmppD+IajOQkIoWT+6trwUSKXoYfFzS1JXc53o0J1tOLJU4jJ2x8PCdtPI+dt13Kku5FAVc2qHWkGPGxQDUHItYEMhQTDTauYU1EDSQviOY4LN57ogmk6a6gGkh1ohMFYyMjWqFotbBWV/gEC6ZLp6lZ9SNwh5NxTyE+qgJbkcOA3sWnnnoHcMd77t31nJ/67B2v/OCSP3P38hjQ5pyNs/nztsy+/Jy5ufdtVTUXP0gd40FVyt3O9nTFBVvdlh945Cvdj57+xvL4+dwQQ4pErthR9P/6tldf/7z//QbTy0Hgoun00rmjNk6sk0ZFEERFIwkIYqfyNwLGElB66+bb7TvE1omc4DVhCktntk+sG4wInZmSIne0M2OFJC2a3ilz1s3P4nxAfMXcQs66xT5dn+hHSzYZk3w7EelRz3oKj3v6k+g9/HhYnWBGkX5VMTsZI3sPUlQ1uZlqXdVKqAzdbsFsuUoh+3CsUsgyi+5kTtpwFv2y4OSF4yhDoPAVzg/pqqcTYLaZZcH3mQ2BmRToJ88MQ+bsMjNmiUImFCS6Gil0TMeOKKUmSxWFtuojloTLKnLTUFJT2ogkxRmDsbCia+yMK62ggrbDzW2KzJo6RRRu4nAXp5TG8Ae33/ua190z+Pu33rd65u6VQSSluGWukz93Y/4PP3fqsa9+KIxCe1Ah5BdeuS1edvFZ9qgXPuGl9x5oHp394dWPjsOQoi2Y7FgNnUP+kk+c9Uc3y2flT67Yv1UAjjlx88hgvBUhCEh7u7WVHUkIBlWDOGW4MmzTdjXUQen0O4S1CdEHlutlsrxoVUZWh4AjcxmTcYXLDb2OwY9GTJp23JozhjQYEtIE1Ui+0GPjfI8Np55BmOnwqGc9EZvnnPnrP8WOhS5pZUg9Oki+czfZPfuwRsjM4dkJA7p2gk2JTEp8/nhM3mFBchb6T6KTLZBC5OyFc+lEy8HhEnvq2zhYL+OsYNMq2AkZibqax2BpCMTUQ1VJGKSoSb6ByBQx0vbznRAkkJKQpHWITE1L74+wrpOzv2lYDTVj49vZidMOwMzChiylm788q9afu/qm179p7/AXbt29nKzYmKnFFc7+0IZsz8sfccqv/860Oe3Bbg8q55gOxVQRWVbVn9kr9nPx9z5ls5hkLNbYQVR33cqvX6365+cKAbZz1neePIokL7QCym0MoYQkJCxOFUUxsS1o1VZwIpio+KpCYkuEKGc6SDD48Zi8LPBJyZyjHlUgOWXXYaoxTZXYfNQ6JqMKP67J8ehcwaN/5rmc8/1PpbthjqzjSKr4esIxjzqTE/78lSRg17U3csdv/Db2znuQrB1ME4xgnKXfzwi+RumwOHcWG2a/AzF9rA147zEG1nWPZvNJxzEarfHZXe/jU/uuQDJHIw4f5ojREo3DaySRt2MPrMNpIKWEMYpN4JNgSBhSOx8kRZx4Jpqj6kgkgkkklxhWSic4jjMlXxwdIkw1wVShJ5HNXa+gXPK0c82lIvGmqjrtmf989S/sSKg4i0aM10Z/5KSFeMlJG18sIndfoeqeIhKOOMd/3kGSXqFORL442jV6SWfiXr//Dz6cemTSqJeezebs6z5xnvCkTwAyMzMzjlG9iCC0YJ+KEMSS1IJ62rBWWzG32RniWkUKDSkTsjJD6xo/meC0ZddWPmA04RtPZh0SAr6qccYiVqgGaxifKGIkpERvnLjjzW9j9IUvcNaPP4eN5z+C3GUEFA2JycED7HvXu1m+7L10b7oZLXt4DZAMTg3NMgxiZG79AtYl4uo/UU3uJVt3IRRbMMa0ih9MOLC6g3v33MDupeuYtRAimOAwEXwMONtgYySmSLINDRanoAFScEQ7IVqPJIuhbSEOMWIcxBSJYlCbMDHSiDA0EXGRpRioDg++SoAk5vKGo3qTBHDUad9r4Rp/x2Dwg02RRRl7I6ompZi+9+T15sUnrv/ImQuz/3C1Xp09RsQ/FHaOBw99ZOtWcxkXtfSop0jACfmW7vr+tvMJ33cSPjUixDhb9nvxhsEzAd7AJQ6YqOBbNoO0FHVp61QRgcNaVgoZhnqwRgiBmMC4DJMbXFSsb7lXxhpM9GTaSvs4Ufp51pb2SfS7Jan20ESMUWZnS2ga/M59LL//03z0F7Zx90c/RZYViFisdez78Ec58LuvpHfddVjj8Joo5nvtsMwIqWvoLJZga0SnvCn9IunAW4jj6zFTkvHBtdv47O1v59aDV9DoATpEOrFmJg5ZZ1aYtav0ZUKfiq5JaDKQ2h3CuIAxDS4achRr2mE6xkUkb+WAMIqTQB4TXQyzIpSaUFOxLw2INoIJTJmbbOh6NnXaYGq2mBWAnaPmUa7XtaopptSwrqy55OQNnDM3c5cBHiOPaR1DVS667DL7YFZC/JY7h6qaq899Qybbt6eLuTyqqhncufK0e9589ZU7t35w6/Xff6nG6w4YIzmCpCI60oHxJoCKwrjCJSAgdjofo2XpRkyLG4i0DwxEyJyj1+9iMIThhGY0wrickCKd+TmsKllIYBK9uS6mmhCHk1b7ygn1aNzq8Foh5QbT7eOcweWCzSOT5f1IUDKgPrSEEyHr9NDkGNuSNRy+5xg7EGMwomQmMtftYrFETfiQY2JJ3hwgLX8UP9mFmoxBtUSVDiHGYMUiYkAManO87RJMgZeCiZ2hTjlWHFZzJOUkLCmLUwJhhlNLpg6bLDY5nLQlYJWAmIg3CU9inemypZmjb8t2hdGEGgENHNPzzJWdAF/qlN09qq1XBfFIFpgQzcs+9wV+8lOfesGrbrrhE1fs3f1jqpobEb384oujyDbZesUV7khY9QCSIQqXX3y5mda4k6puuvXX//HxN//su14ar9n1+P49tdHlSVogGgsY8pYk3XjioZGZTpMh+ojNJWktSNSpJI+SxOIxbaOTKopBjKJ1YMwQKwaTMkyhpBDavo5Dqxg1LZ/KB8LaGrlkxBSxuUADqQmIdUhumZnt4ZeXyJumFVv2NfPHrWPu6KO45i/+luv/9xt56h+8nP5jz6E58WS47z5CntFbXMTXI5CImITGjJWVNfozc4yWDoFkzC2U1KlHGu+miv+Aq84nDO/DxADkiLFYBTFgxTBJnhwhxYSGhFXBajOlYDpMA8Y6ajxJAhqElCzGZJAUywRjPZpKGnEYIkGE5eTpJMuYABrbBUiFzFSypRzS72zcCbBUrynAgaq2jbZ0aCNCleDGUc2Nk5oPVfrE9Xfc88THzd3+h1s//bn/dcZc/yM/fsYZ12x/yvbE1q1mK1Om7oNEjcT9N+8ScuWF26x8VMK0tBGHdy+fs+MV//wjN1946bNm7/FnNTuWprUUjUILW6sqQZUEolUirYSSAqhuB4W59TNhabiM0O4cRgRV8FNZpSlvFxHFxim6haC+aQFAcrxvtWrVpHan0YQzjqhtzD0Zjcmiw1iHdSApMjl4iDwmMldiRWn8iPnzzmf3lZ/h9j99I+tSxdW/sZ2Tt2+lOO+xDO6+jzwlqvvubXsrxJBii0RnuaDeMzPbw7iMxrfQmtgI8Q4mO+8mjQ1bXMn+ukG70GhDVIOPCZdqQoLClphYEUwEJvjkwBusjQRtKSiJSDS0u0CqsdI+SBlJmApGKykJXhqkTIzHdbvQTLXg15WejUWDzYq7AD53gGSAoY/Ok8C0zzNisHlJQtg/buIBCnvbIb/pqGL02octremPXPnJv3vqutn3v+Dss9+xHWD7di66TO1lF5G+1ZI97r8zfJK2rh1UtXfw8mvPO/TBm37nnu970yM27s8Ww741PBqcOKutoqxt6TutLE1LurUEhdiEnNyyVE0iwLqj1996aMehx7RPNCgBoxYvBjWCasJIO5ZMklD2OjQhgI+oVyIBkyLRWDr9DrZq2sHzYnC5QS1QTXtCMkPmLEzGYBzOKSkkNERMt0O9Yy93ffDT5FVDIxF3z0Hu3voaOs61Is9ZS7yPJMQIaMTlhrLTa2NcY4hBGa5MsMbSXZxldVgRfaLIbdtdmFU0RhEStQpNBMUSJbWNSdKOXWtih6gOkYSRMC22pvvPg5MW70km0YQMb3KS8ZRRGSDMZCVbfI97mzWiSV/Sxk2RY7qNWcghd+VOgM7yHjXAIKqJOg1jARUlapvAi4gVUdSgu4JP9zXebLadH/vi7ff92PM+8JGXPe2YzX/4kw8/8z0iMpAp7+5b2Sno/rt2DBFJqjqz968/+9y7XnD5L9pP7ntU/64Brg4kUm2wxmKsqmqrOmWmlzK1+kgqGFCDqq7W0yTuowBs2bLxC7fLrT+aBDHT5LvdOQwJwco0BpNWPSOMJ4QUcBSkJpL3LDE4VCO+aSAEHA4fA1mvRKMlaQ0mEKtAMDmZKiYTevN9mgMrSFJsXcF1N2NiQ2ehR8dmjIZrFHftbL9QlqEL8/jRgDQcQAYxJUwuVNUYIxmhjnR6PWbn5vEBBssjjO1RGSXQtPUiV+I0kSff4hZGaaRBkhA1YhEkGNx05Q82MtGIUYOL4NTQjYlaLA2WRiwiATGK1YjiMFbwMbA2WqExDWE67UpFEacc3x3TQTVjZg+0XLcE7E+aJjZTNU41pVYTRuQwT/r+9n9rENfppAOTKh6kcPd6+4gv3r3//3xqaXDDX99w26t/9qxT3z69Z75lom/uv8MxAO55341Pu/1X3/+H3c+sPjK7Zi/WgyPHWAeiBYCVlniuIohJJCNE54jOkDKLz8XM9uYhHw24IbJ4yostd7w+zK5buAMjSEAwcn94FdQSEFxqxRcwCYMhqlLOdgmD2IpNk2FNQhpDamrCFBUvS0tTVVAlMizkSr8zSzw0Qo1gvac+sNLKYjptmb4xYabH4BVMBHPUJhhXpOGQ0Z595A4yk7dpkwphOKHfzUkhtflNm5W1M0Z8RScpGnJUA7mOWcxg6CNGW3HnlGpyKoJaMlMAQpSIySKoR1OOS62gQksiTGAmGAEnGSEmnI3MhkBSx8BAoYGhKMuzymjiSbWCSahGuiZwYn+EGk2F27IH4KS7FuQaYEPwq2d3OrLisixOebtBW432KEowbWOtSBugGSdWtAVWd6K8d616+A5/6O9u2L/7Re++886fB274VjnIN905Dh/U3f943c5qOPnDSU87M887dUsTwkZj7bzNzBxl3redvDQzeSYzuZVOjumaQC61zezQWrNKZg7kBbtj0lvdF+74KNfCL/7on/pf2v56InKPyQxSKRhBp1t6xOBVKA+zFNpqJcYosWlAFCuGOJlgjCPZHJMipsyRQolVDSJtZUpCK5w8GUOuZHlGqjwmKTETZrZsIq6NYWmI0UB9cEQSixVast9UzKEMFkIgddruE3yrZCLR4ExitpsTfKSqA2Wvg852GY9rrBMyEapgiASsSwgRDbRiB5pRWEMToFEhZpaxWiam5ZLZplVYSU6Ipi11K54sBULKyIJDbUVlE51gKGLDOmvZFZVDUVAsYtrxcevzAUd3GlSziNu8BHDZRRd5AX7AyktmN8+8uVlXnIixGxs1631icRLD3FjpTHwoJ8G7OiWpNMS6aXwdQxUiQ0lpxdriQFNP9pqOnRQxjr+Vecd/W85x4vc94hbglm8so7c9catLy4fyMqcetDCVVQMSiYep60jbMiuKaMKqQUMgicEksFaQoksYT1omr3W0GHKLBNvcUuYlcXXcjlt2gut28JVvc5wYGOzaS46jYxSX5VhTgK8xETi0QiZKsTjLytLqlJ4ROdzkLoWhIZA1bbEgxkRdB4peO6fc5ELLfmz75EVce1xJ2v6SosA3npAimgJGS5zShnfq0aSMVVAt8cGTq8FqThBHBIwNJCZ4m7ABZkJkKDmzw0SQmjuCAzWIsSjKcd2KdbknMZtmxIxa6kgb6f7Mkx99APjIN+L6/vG3S7VKUdm2dZuwvSUZUjp04jtADhjWMMPJ0K3sW8ncJGYupDw5X2plug7Tjz7OhqZZTGujo8fD4WdP+9mnfmDbtm2yfft2Lddp1V/ohZW9K04yh6TYhhYKUaUdvCIyxUFaRqyIpdPrUK+MyQRSrDCimOhoRhMMQiam1Xby7WBKpUXjkleGB5foWouY1A7MDIqmSJMJjVYUaunkOXFUYa1FNbG6ukw20ydXJQ7WkNwSVEAMdT3EaAdTQJE7ytku+w8cwmUOyIkx4DBkaQI2MRlPyPOcnnUMG08miiSlYw1GAz4K1iq+SUw0B6OY1FAmBa2R5FHx1Cah4vCZwSZHt3JMOmOWyoKVRnBSUfsMUtn2WhrDyd2aTBTcIuO0rjlMrLr5E5+Y2bFRfroiHV2Q3RKSv61aaw6M18bDXUuTpoFINkpb+sdod2ZG1y0uMhsX9OT59Wnz5lZsXkT0/rJuO6H2W7Zz/Leik4fzjy9e+FcXzMyXz/UbyqdBOpFRg5nUEqoaP65EBw1+XEmogqTGC42amCAIpLohO20TxQ8+6inn/86zrwREVfNX/sgfXPH5D37hfNPNkqRgLK16xkYz5igZtkJsUyEZnfKwkjFIMkgMBKOUvTnCaExKHpsp4nIkRExVoZKRTccth9GEXC1JlZn1fVKIyFqFSwmJ7STZ0oCaDBz05vvEg0tkGnG5wziHVmPmUZqTOpz9x+fRKRMSBMkL1oYTio5FTURQqiowqhR1GXWsCHgqAo0Y6mgY1h51Bh8iVUxUUQgIHhgbwadIip4Q2wUD9aTU3uCqgQE5tThC8mRNh2GxwjAJMuqy1wz49EipQx8kMutGvPToO/TU+YFkxWOve85jP3uuiEQjRn/pnb/06x/Y/9k/2DtcxUZHikltIuZqVVyhmc21sJYy65CVBVmWk7miKUw+ELW7U4x3Pu3Y8y77zae/4F3fdjiHSKst5U5d+DX+9qZnrVZ7pwriCTOtTLXFWKFtTG6p5ocVRULbglb19vtM960dd7jwkZVZ/YqL/+cn87w4P6WYWti4fSevljblnoYwU3qJRmnHyONazpQmmuFKG06pwZpWYECSkkyOElpMQtP94RApMVwa0O3kJFHURMpuiY49SWPbTyJKnEza9g1rCU1CfU1uDaoBkRbI9ASKsouYtgjQ6XWRzOJ9Q5JAXrRkSJF27khmHD40mGjoZBmr4xEpN0QTUcnahoykFB4KDA2OSlpd9KCRaEpqNYhEVAIpTZBkGGc1M8NZ1qd24OZub2miICagkjiqGLCpHCebY3M78xljigAQU5x77Ud//5Jbb70hqHaF5Oy0CdMhelh5oX3UwFDa208ocG4G77d83xnf+5hHn/KId/EgKOP+t9NHdGtbdTjh1d//x+NnHh/FasidS9iMZHOwBepyksvAOTWGaEnB4L2h8paJFyZFPLRqh0tLGzFwEWeaUAd809zem+sTYzo8jwtEaGjVzkW+1GB0/+wUgc78DFjXIsoYRA0WcKMJMhiTfESskmcO8RGpGjKEvJ+ROSjUEAcVEmuMFYyxqMaWs+UMWRDSqAZRehsXiFPqhxGDQZGY0NyiZUGI7cSmucU+RadgsFYTKiizVnDOABZDJpZq0NB1nXYATwJnc3IM/Sh0ashiJIsNOZ6UWsnTDp6O93SixWnEUqMmUAsEU9KNPebiELENYxTigJUYUXEY0yLkRxcNfRPVWsFker3q/ffvzKpdOkXtqoMRhKEnjD2+DmiMVlGLYLFYMhwZDkdOptJUzXnHPZqfftizX/vMU5542datW92DQQnxv9U5ZLukyy66zM5s6Hxk7tln/1p+4jFOQkhEVGNCYzsVdRQmDEItk4SNZc/ZjZuy3sknZP1HPyzjkccf3HeC+9fdw6VrUDjzzLbpad2Jc6vzG2aITZyWclt4PCRDVINOF68pooioYBKMllaIvu29trMdnCiuqbHWQla2+5dzZGWXqNMZGT4xWR6TOUeeteLLWQRbN+jaqJW1KQvy7hyowYqQYVjbc5Cctl86Jp1WqSKFg3oyxjeRzGZthWs8YabjKAshhYYss1PFj0jQmplZi0oDeCyBMleciWTUdLIxma0xLpKcx+QJNR7LGOc8xnhsaMgEOjGwqJZezKmzSMwdo15kqVcyNpb9VGBjO4fDJY4ragqF3JQQJzshsnUrBth9886bf/nY9ad+7uFHP8qeevxp2aaNW7LZ2b4zVm2MQ4lhhZjWiDok6ISglTZhlLZ0N+bfe9QT3nXxOd/3myEF2bZtW/y2C6sALr784riVreb4F5z3J59+3htOdavNC40T4kyOznawiz1d2LKAzJcHoknX1CHc6on3BquH4sbO5KTvevSdp5x7/E1ipEKRs7adFbkYnvOTz7zrf33+L1dJOst0ErlI6xi1GLr3TzlIqCiuHanZ1rI0ocbQrCyT25y816VJCZsSBZY4rmnGk7ZzLy8wPiJ1TRxPSMaRFZbMZKTxGC+pRedXRwQZkecOk0mLSVTtd0iAM6ZtvcUQq0i3zHFOIAWaOuBsQixTYDIirmh3DisQWnJlaCo0KFnRpQ6eANR5htdIDECaqj4qOFGCsTRGiBFycSQXqZtIiA2qNdYkKmPJfZfF0LA3BdZwYNqQspMFji9HJKDoHIXoySP4NBdeeIHZtk3Se7bzOt2tb/v9a//4cQfDofmYWOy48libZQ+LRh+z2gw3HxgeYKlalsFkzDhWspSG9nFzZ3/25U//9Z/+nfhS2bq1Vdv/tiUebtNtuk22C29/wW/seNvndmW93pKd797aWLO/nu2tnvqIde2SCGPJTY1/QMHiZV8eqV100UVtP8Hpx94YQ7ixyIsnoERUbEsyFyrNUKnavmdk2qwTsdqCfbbj8HUkUweqBAlIU5MV5RRqD9g8hxRbtzPgMov6iImKWmmJRSIURU6oJuTiWmTfNyQ7ZYsZJXiPMQIGxLTgZKwTlK1sZiS1DUq5MGkC2C7G1TS+xuUOn6DnSlaHI/JuifYs46bGJiVFpSslk9qjmRJEkZTIRDC1QdSBqRE1+GTpjiKaGcZZ20E5O4mUJlLFijKusWwdlc8R9Siw3lUclU1UHa4e9g6cfMJz7oW/48ILL0xPecpHWwmSLXIAeP+XbjCD15gBfSDfvby7ONhUc1Uz3jISf/qBydrZpS1eLyKrD6AYffuycqcdfyIiQ+BVX6PCZYHjlm9aPva26+9avOeGu/t33bAz33Pvfftfd83M/wV06wUXOLEyfsXzXrV7bWbE8mA1iTPWkkCFJjkwbfIphyfaiE7z6oSzDp8CNnMQAzIZY02GrwPkQrluFr86xGIwVdXyXLtdMA0SI1I3RK9kpcMVHfyk1YHqd7J23t6kbsccOEexuMBobUCiHT1ASLgiow4RjYmiU0wJflPJmuTJcwvSoY4NMuWK2czgtZmizQZnDCE2iK1xOagXAkoUJcaIMVCqJ/kKk+XYJGTJ0BHDQCLRQsgsrs4JpqIuhPvGTUsepAUaj81qFvIY8w6OGK45ff1z72zr29v06uvvfsqdK1dckMxCNTv38Hv7/UfvmOM79jzy+PP2ipgJ6PK/ubTXA/9y+JfLLrvoQadC8g1zjsPN9V/Pc6+88kpz+cWXt4Loh0tOuSXUofexv/3n2VSWp68tjZ639659j93+vFd1wmo9T3Bz0tAVjwuV0vO9sO07ePv2T8lPvOF3/zHXC69Mb8vfdnDPTfvQVdq+QG3R8gZLVEN2mFMqrVCyimCBZm2IMW3nXuYcNrXdhCIB1JJCwFohswbaAhRNNUacwRnBmhZZjyEx8GtYJ/RmeoS6mvaStFhGEghETJ5hfVuFI8b2OQnE5og6jNSE6OmUlqQNTRCQvJ27YRPRKC4XQnKgFk0JNYorC8bhECeccDGT4Qq37fsISNmymoziVTGmIKkghTAqlAolM4ZaE+NMiBaMZPiq4lD0UzabIM5zdr6GTWieF1QjtweIb77ygoILqQ8MPv0H85sPPWY8WWVtuJuVtY+s3MefrF13nx3+n4+eMCnc+qo/e9qH57onfcSE4q6UHr72pDN+eKA0QOLiiy+Pb7ia7LTBVr3wwm3xwTBE030jd4P/BGCTAD79fz89+4G//adzwsHmqNnZ+bNe9ZxX/sjg4MpJk0FtTHRTBFhJlRBCgjRVFzMuWrGu28ueoUPdIj3Z/XPAXZ++693//MYP/zRicmnpVaJArQaPJZtuGmY6P1C0RcyNs6SoSJPIZrqkqBA9EFEfaUYTsswimSNMmlaUWtr3sZ0SkzyhbhBDG8JET700ad8fcGWOWCWNK/xkgp3OoFIUTRmhaejN5TgDmup2yEwGdVOTTEH0gdiM6ZWOJngqH5FM0bqmbiJ5p0OsGlSFMnQ4YcMz2ZNdB7s/gjVCiGBFSGpQyfBJqSUSxGCS0q0jWMeaUdQpc8OGpYlnNdnDAC6zNvCwcogPiKaCme7x90xDoOqncLzzX5mVg7GpajQlCrHMi2O+7TaEIHdzcO3qJ+49lG/Ns26yZt2uv7/6nMtDCl/I7eY9Fzx629WL8pjVVuJvO6rItm3Itm2oCA9N4uFhUpiqXgCcAoy/ytPtcGW4/p4b7zl1+eDyuvHq6LhHnvfo881EmAwm+JCQM0xbQlNJSMt0JwkqXlSm/aJRbPApzq/vr7/7lrt/S1Xf2owan/fyvXObFtfqeml93VRYVVxhUOOocHSlJcNL0gfscdKSCK1DmprJ6hpZnpPE0p3pUg3HHPe081h3wrH4aowzFmvzlk2bApoUaxMihixzbb9I8G0SPKUI2yIjs5Ywntzf8iokOmLQeUu+6WS0hJAszjlSM4HCgG9Acoo5hwsNaMJoIo3HlJ2cfCExayA2iRAiKSkzM6fT6x+LHryKTNvJsKIREWiCR02L8bTdkgkslFpjomNoYWZomJl4bomeIZ02PyNwSmeV9aZRjHGL3Z/wZ5/00o7qPz0nxliENNh8w93bN0UO5CmZlNRoSu0q1LYLoEoiJTVirGAwxpljszz7lbLoo34zd++44uPv/tzjbzl6w9M+9tjjX3GZiDSAbt/+Ze0ODy2E/AHO8VLgR4GTp5SQ/+jzvuSQAUIK6nIXAJMSZro9fDnxpP2glgIy/cqqqBGRGKO6zB3WIav37ti37tqPX29vvOo27rr2Lnbffg+icHRZscWskbSZrtxTFjvtJyYViIHM5SiRFCMuz0hNzXf8ygs48znPpL/lKExmENN2GN4vY6nT4Qdy+Lvpl9hGAtrKZd7/un93UmwLjrbsbuFLX858iX/Pl5bP+yGb6Q6I6pdK1C1pn5vuejPX3/EmVLoESTSpHdssybQt4AgVkbFLxFQTkqPOlYVDhjgZc7lpuDqWGI2kVPPCzTu5oFNB3uM7znpPs2XD0w5B2gAmpRQzMV++visPOI4HXPzDNUNVVWNsavm4o+xgfB/X7v91Vle7DNbKSd+edE3Myld9Yv87P/vn38Whhyx95AEOMg/8FfBDX5Vm9aVcQzgs3fRNsD137+Hj7/kkn3zXpxnedhsnFisYfAu+qd7/sZICmuctah4astxCshAaDAkLzGxax5Ne+Ruc9qzvvN9RH5SmLUHg9lv/D9ff8dcE28FrRNWTUHxQoghitKW9+ETjYGAMjRjmB5EDYYU3hYy90UJsmM+HbD16D1tcSHknNx0578rvPv9j/wK8ehoi/1fxsgSYfcvX/cOVt7z8nkAoa4Zlsiw6Ztf3upuOmSsedujouce//OGbnvzP/93U9W9IzjF1DCsiKyGEf7LWXvQf3fDTA3T/ZlH5L7v2dPXWf8vfUoWjTjyKi1/yPC543gW8/3WXseOdl1PSYhpoms7tEO5flw0IEZt1UB9bIosmjMtYvuMe7vvXT3DaM5/6gAVRv8Jao/+VE/iNLAW2d50xpGTIrOC8oYwFjdZMHNMUGDxCJ+SUdQNlYJTmyZqD7LENh2KGJEWTcmrpWZ8lEkhITuc3nv0O4NjpwabplfgvHIQkULNp4RGf/OEn/NMDSLgFqpUF1u9Yuv6kSVyuH5DXPiRLuaqqEmP8qrvSl6lpyzfEMb/snQ6/v0wdR5Oy6dgN/OQfvoirztzEJ/7gL4jDIcY+gE5i2h2jnU7sCFWDIJjMYg3gE9ZkbUL7Zccg32ou51fhPkRyG4CAzxOrqUUD1SRyb6hVSblhOQMXE5UxmOWG3I25y4OPEUNCsZzRrelbZZSQzC6wOP+Uu4GXTg/Wtv/+l47btNlXesHewXVve++tP7UE8OHXXpOmZd1908dDnz4iDxLViAc6irEGTS0v6Yk//Ty+87d+AXGt4nqb9yuipm1qmoozoIJoJIUKZ7IWFnHwIDu8r2qFKl1SS7hMCWMhs6btaBSLYsF7NAWaLKF5zvq+Ms4CO0MOmpE00CtGnN6tiIi6DC3sUdedsPD9ZwAntbnV/1+rQds2jzljU//sx/7cY64Jl5x7dbj8MpKqiupWc5leZlW3fkskpBzfBtYCZ+0Amsf8xA+yunMXn/2zt7Sgn7YVLDMdnCYptiPSpB0L5YdDbGZQmz0oZ0j8x4mdw8cMMQ7nI90kVBqpjCE4i8HQqzyzdWANSz4GO1lil4H9UrZFcHWcUq5xQlYTVcP8XCcj5pdlWfbkaQFCvwFb5TQs4/nA+6aVDJXDQwe/lZvvg+ZafoWHTitChx/of/jcrysUF9tWi57wouez+VFntVq50qLlKi2a3k6lVdQIeVFirG1pJrWfVqEeGpZI4CAaJXUcgyxSZanFayYV4huiNVgTcEHpDCwuS+yKMGiVQiAZHtupmbWoETWEueqkjc8vgUfJNzZ8FOApqvqwaf76oLgvHyzOIV/pcb9aYfvQaf/Ov3teSvp13biH+0k6c7Oc8xPPxRVtn4Zoiw7qNGxKh7sGQ9smm0Tub5n9L2RiLYKd2n/bLWz6c0rTkcX6DX6AlURmAgZPprFt0yWRBU8n1hTqqbPEoW7OKHeEbmLkRuwMFlWHirJoJ5zXGxKNpv5sZoer1adO3XJJFzh+GpfKV17noPGrMYRR+jrvwQisA577YErczINk19gF3A7cCdwVQ7wLuLaaTAbL+5Y5uGsp7bxjN81qk02Gk5Bi2gXsDiEuA3uNkebrDXlE2t3jrGc/nXWnnkjy4QHFZJ3O82h5vd7XqIFitgvTVtf/9IopghiDmPbfdgub/mzMFMuQb+DD3H8cXhNWBDtOzFUZeaWEFJFeQaGWfh0wCuIimh9iKTbcLb0W+AmRM2fHrO8EghgSmW5Y98QRcGr7ISZ95bWgVSauwxV2/9JfGx4wTPPrsGeq6ryIxAeDhq77FjuF0LJvfx34HNCpB3UoZorJx97xsV/4/AeuedGhvSupM9M1xz3yOE4464S/PeP8097d6XduADLn7Mbbbr7nJffuPHDho889tV5cnCuB7GvuUQh5t8MJT348e6+/CZdP5/9pe2OJatuNaFoFrclw3BIUM/ufXtPGe/ZS791/PwBorAWUGFM7HMdB7/gu4sAkw2FNQdWI2OmJktYxNaa2aErbAqwIYtrpsUorOleWR5Plsy2CbxwJQygSUSJVEJIDCO2gzaTM2gkTn9FpIjeFkj3Rgq3ABx47P27zLWPsaFgtPfacrdcAv5ZSUmOM/SrVw7S6Onjf7r0feNiWjT9/OpRfKzexUyd6LHAeLSHxv1gX/38rIVfwd4jkdwCIE975yr/9zU+/43MvrlZDPnfarJ72uJP++fizT3jN4575uI9Cu+B+9lO3P+Udf3fFb9948/4nHjpUlY98+IYvXvp/fvE+4NkPcLyvHI/HiLGWY897NJ/+y7/hMM+qRczbtl1V00IG05WeB+Q+X88upTEi1nLPe9/Prje8dRpCKca2Xy7Pc3opEhYiZ732XMoOpGgJXiCzxLSCLS1qLONRjUiGZJaqHgFCSp4mBjy0k2DVE0WxbgNnnPVKnJRYbafVNiheE85lhCYiJlJ1LV4LUjOmmxwaLHfGiDcRgnJcEXl4d4JXq0Kikx2/vGHmsZtoqefpPzi/CYxJKe4+ZvOPX7K0/848pcmbjSmfxtcGC3W6sD1XVT/4rXaMB021yvuss3XrVrNt27bsHdv+7n9+8T3XvHj+6DlO/P6TPvM9P/l9r113wvw/iki0Fj743s88+eOfvu03X/nK93zPgYOetUFNrCXuuLt5+Fv++sN/85MveNpRwGO+moMcDo1mt2yiMz9HHE1aj9MvPaMdozZlu+YdYhqiMfynw+EwGLJ6z724zFCUBalqsElaCVIDRkqalSVQ6GQlVhKN92RZQzNJRMlw6lBtqAcjRBqCJiaTGoyljhNM4TCNJ+EY1Hexf8+/EMIhVAPaVC1zGEiNxwSojKKZbydfdWfJVjwH68gNmUJWgU88ce4gG0plEEVnCmOO6j/z7cD/ANQY81VPgjH2kyKyH8Drtj8mpad8rdc8wHGeA7xCRO77VqodPjicIyWTZWby6te8Oj3MnPTG+66578c2P+yYzzzmR5/wF+c/7by/O8zxv/baO89+21s++Kt/+TdXPP+OOwfEoKhkEavG9Qtd88Z97uodj/zJF3Ab8Jjpif0qoRVkvQ6d+TkGgyHGtvmAklqelQgGAykSq4aUmXaWOf+56qU1FptlmNzhen2CqSFE2oJMGxq5mTm8GZMFQ15mhJEnz3LUV0SjFKXDNw2xDrhODhLIZ8CTKG2fOkRShFBFDF123vsWQlKyvCRFxUclSoQ8ER2o7WDCKsY1SJNTx4rbbcXuNAvi6Vt47EJNUKPORWKz7sApR72wCxzzNQ5eAL1h5y8+7l9vefIrjp9/7Z85+CDGfAp40jTxtl/ttcD6aWL+J9/q0OpBsHOYCPTe9Io3vWbnzTufeuoTH/a8H/jN5/6riCwD7Nq1a/2b33Tlr7/8d9750wf3N+uXBpUWzqoaa2Jo7Pxil6ws3MG9A264bvUn9uxe+tujtix+XXdw1i3Je300Ki2fve3xaFPBtjplpuBvpJUq/c9iHa1IiWIVquVVMEI+28dQEFdW2zvFe7KsDSljCHSKDJWasp+TiaOqK6JCOdshRkiVJ+VCMIa6ifd3GbpeBl5owhjEtTNIUk2e5SQMVRgjRjB1IGsyYukoavAGrjeBRhqoMx7RXeK4nqdWExfnus6PNr93rnfmqbSE0v8gPGq5A8PJLbo0fNtJNq9fft/qTz//9r29P/2us6/6qDHuCZDM16gBpanzXKyqfyki9f/TWrlfR73M79+1/4y18doXfu1vfvNlIqK8DFS1fPnL3/z8X3nJ/3nZXTsGx48GNeIyv3nLgju0b9WoGMQKRdZlNBxhjWHpkMn27xs8oXWOr30Xx6ohTCow9v4dQaYJsdHDvNIWBzGqaIj/ac6himC7JZhpH7kIcTwhipLLlEWbpJ274bSt9FqLtRmN9yRxmCCkVJNSAIk0TU3pMkrXZ2U4INqGTBU/VVDPbEHtYztL0MpU3sfhpCBqQCQQC0UnivOR/XHI7U0XckuWai5cHCKiijF2NLQr5xzzklXgaV+tzKqaELHsX/4HacYrSccx2fzWY11u/ucnbnv68hNOe1/tTLf7NXbeKQ2ZRwIXThPzw6Xeb8tSbr7x6I1feNG2F71TRNQaeNvb/vVZP/78P/rgx6+886+uv+7g8eNxSDZ3mlmXLe071OKnppXuH40izcSRoqE3p8wvlCdyf03nq6R+QDMeU62uYYxM1QwfiCkeVko8XCQ9PJniP7mIRXAhYmM7Hz0CsYlQNVhjENH2Js4yjFjEWXxMrK40iBpitUanm+F9g9ZDysXvYv6YJ2Ndw9KBPZjckxfaIvrqibFpPzS1gtbtoShiBO8TPgRwQsigm0Gg5kb17HYWJgXndCrO7o5p1OhM14nG7o0nbn7+CnDC9Cb9itiGiCHEAUuD/4tqNE5yJ94lP0o6rq5Y2L/6vu7XudFGoAt837Scm75VZd0HBQjovTcAt99+7ykv/c2/fdsb/+ZT777+uuUn7TswCmJUXe7M3Lo5idGDKUgaOfq4dSyuX2SwOlA/Ccz14+R3tj/zc8efsGnyVfMN7u8QYXRghfHSGsbZloEq/9Z/7leBa6V8/iunK7M0YgjWYeb6zJ1wNNotcN0+tihwrsCiTOqG1LSDZjKx9EqHGENW9mlCxFiH6RxP56gfJO+dhFfFzZQk8WiKaAxkKmTOEDXiCjtVRU9IDFhf03WQW2knQsWMVMFIG65PXRoEqyOeNDdhJrOoODMZR07Y8IMfAJ7x1ZKtFtsQVkdXsza5DpG2s1I1mcyK0Iju2vfm6XmXr+eeVOD7gBO+vRNy0CzL3K/+6l++8KW/+fZX3nnr0kLdJMSGWMx0XFmWjP5/7X13nBXV+f7znnNmbt1GR0EFFAtYQQVRF1Q0Kpaou8ZYEpNYYmKLJcYk3r2aaKyJMdZoNHaXGI1dURcS7KggxU6TzvZbZ+ac8/7+mHspfgHBny3xPp+dz+7n7u7cuTPnPW9/3u482ha1ghwJrQuQ0sWSBW2w1gGTg1136R2ceebYd/YcvV1vADWfVfMjRLjI5775HqzWQESWhq0wCKsblZjDwsRQq5QFZWO3nfA9BhwyHjVDhwAiZBsURKVZ6AwJBkWA+LAeCMiHEG7I1yvCkLIFwCRgrUUVWwi3L4TbB142A2EkIlLAswbWAgYuAgsYYyAlwfeLITkdCIEUJQZJhpIu2IaRK0UBFjsFvFeMAIYwKJrHjj08ZK3DSjGE6TNv5y0v/wjAXhvcTEtTUdozz5K2WTgiAQMflnUpFwPqKvwbndnXUZfc87OiuuXE4QAAhwC48etyzL9O4SgvXvP6q+/eOnjw4O2S1TmM3jNmtS4IwEoVjYVZwlIJOSSjtq4W7a0ZVCdjqOuRQL/+tbTrLgPQo0fVcACJUh6CNpx6JPiexowpcwAnDrAOqzjWjuaGphTz6mb0TagfKV9C9dAhqB465LMVzAbUulyHCUMArAagZaloXMN1XdiAYI0HV0iwFfD8ADLiQMPAFS4yWQ8GhGjAsJzDWxpolxGAPezdw0eNY5ENYHpXxRT7m90gZXL/DS/OkJ5UcxutzDxshJDSlsZbEwGWGUIq+EEeS9vvQ11yz1Ku6DPXBgM4mZlvJyLv26o5EnuM2n67PUZtb0rr4fOYek7p2LA9hVXNUZj10my8O30RtpIJAN3hLMCyvqESE8Oq9cCwZPF5Sn5W1VNtaCUI2ogQccnfIQUnptBtPchIApmch0g8nEprS+24FhLWahgyYBel/njAsIWRoW9CIkCr0ngr44LJYKCbw7jeeXha2WjMyHwuMX/U0MumAfjFxnzMjsz0HOTiJLg0vccKMFcBZMAoggShtftZ5L2FiEe22IicIAjAjgD2A/D019FH/k0pPCyH8D6TZ6JcYBjW7zHWKDr8TIOWS73WXqDx1C3PIZMxCEo8x6I0qoBLRYfhTCJe64S8/mDNBha+AEm5wQMkACp/X98hVz0uaxhkHXiFIuJVLoSQsEYiX/QBDnMrFqUxzLDwfQ1jLXwKoCISSgFC+ZjmMxarCIQNcGAPDwnHQEvNVYkEkRU3bVZ1wBDADtyIe0vJ6G6ne8Vtn+jRp7dgoQOwYlf0goO6kEBPKWSKH6A982LpVvLGOOYugOO+vkDqNwPi/xhbn2GuhFUdBCHo/3QDrlcCjWUism/c/SxmTp4N4yaR5UhY4MShjJbNJ1rHrv11l8KVl1MxW0DUccO5HyTgaQ0rGI4jw9Fx1sBVAgoEBQEYG0bGBEP4FjbnISd9zBAKGg4GRwz26FFAwOCISyLIx5eM3v6vfwfsiaVHY9e/qREAMzPm1j0xbse3j9KFfR6sqdvCIbdoA9vKhjtKzyokXV/cdq9hFCjcCz9TQBjAAcy8Q2k+oPg2CsdXsa5YKknBS9NEPHUp75n7BJIDrEAChiPhkEkqFT5tUHt/fSU/ZdmMJRz4Jh8690HI1K4kQUhAcziazAt8GGthrYFwGDYQ4GK4YUciEvMDi/eDKjgscVSPLHpHGD6Era6KkpCJS/olD9zCWh5V+sBi/YFqwEL+k4i6gCaz5zaPH2e9/a9zY4MkuTkCF41A1ELDRpSA5jkyV1jauRHuW9kx72+MOeTbrDm+HIngMDuN1fXc9y5/atK1Q4ptdExkrt3fnwdtNTJClaY6AaIUlqSypUbrW6Jfp54tjTI2QLY7C+UoWGOhlAoJ4KyBcgQk2dB0IwnBGgoWLBlFCjDdOMgENRgRzWK3HkX4VthkFJKDATMOHT7nTgBHCSETWG+RYdhxb4OMNR+d1rj4pRHbEV1qZ80K3FFb//28CI76kaCh3fEaV7quKxKRqBBmcLaQ2/ZnydjgX5aUPW/MfiClPJ6Za8rTZSvC8Tm1Q/mplTPZQpAB0AZjUk3AD5w9h13dOXTI4rpCNx0ul9j9vU9QsBpMAk6ZaJq/YEEoNTit99jwR8GnGx61z2ALGLKI1SVgS4M/vUweEgQlwomGIAvt+bAakG4AoRhKB+hQBm/oakTcLCb0zYAcZpbWJuM1vvB7pwE4xgbHb3CNhNcthD9LOPmHtq9WK55b9Frj0OHD4fO0XZ09tr72ztrE9+uDwvA3mCPv5fL9/laNHw8bP3LyTQD+hbB3h7Dhfo/ye+8CYJ+vOhn4jW6Txbpa3EqO+BpO+JocWOWDieBnswWeOmU2L16w8oek1KVjx44V/Y48crk7aq/L0HMzSuY7+GAsxc5eN4wFBIVDbeSnTvZ5iWfWcJQ2fKxzw1yTenhtGmJjQ/Z4KwDDQOCFiWtyFVTUAQuCYQEiCekCVhRhCNC+hTJ5TPcVFogoGvqtwLaJbvgsbCIhlcn3azlop38/Ykz2KCmcLTboiIfXrYu5ZY/kOnJdyUjrwD5y8nOtr+y7PY18M+AWqF0H/WZ6/U5v7lFjrhl54J7v/XjkyIsWMqcUES0H8OhG2qll4fnxfzM1zxdhTn92VIvgEyi6xoOTALS11mdmLaX8pLsrh389+uag55//0Pnk45Vq91E99xMCT6z82c+4ecoU2f+61N2L35p2Sq+Vy0fUeDm7r4L4j6pDqxRwwmLychpw1c4eStymfzCdL0AXi6t7QqxdlYSkUmJRxVVIFRTGflEm9QhnpxOsLdV0yRgEuYhGFfJkIaUCpIKXLZam4DK0tZCkwiFAxQJkXEBIAesxHBboiHqY5NVieHUeB9V0wpBlB5o46JffrMf+5wPTScrkCZ+xaEO9bG0m2ue7P+2et9Wh+WzH9fFIfssq+/Hz2bePOJR2e2L6rFkPuMOG9bbA2MIHH3REttnmrFJVbloDeBzAjwDUfUY0rPz6vsy8CxFN/6rCut8E4dAA7gAwv3Q9/+dDm8BI6UjfL/p9pv3z9R9mVmZcY4DagVW83dgdbuzRu8d0Zs5JKT9svuuZPe657830gmU6bgksWdv5c+VZTzz66jOHHD7quZZUiyKiQutdzWdkPln8WmThXOqJPHYrKvwnXg2PxKr6BXDYMUprPbuNK1lna0FCYN6jT+Dj+/8BoRRIMpxIDDpXhIRBVEnIaoHtztsWjG641oUTVTAcQEpC0YQl7UIK+MUC3OqhiA/4AYxhCCERFDR8XUQ0pmBgEHgBSLgoUwGriAzF3HPhFw2iTjtek1G0JzXOrGmFEgYeG9u7LiFj/i7X7NL/2lmel90FwB7YmKy0QBHApdV7fpgJOl+aj8L8Hdyo3UyYmhfYPvpg2TKx1tI225y1JvGexeoK343ZOA2AHgCOATD926A5eI0PfhMRvbOhP66vr1cHOvX/WDmrrUc246HXDj3Rd+fe3x/TuM8D5b/53SV3Nkx7dd61nyzx4nX9+qO7s51YCzt3Xla+0DLrJmbeu7Fx4sppp57q9Dr52NcXHfq9P/VatvycnC7ozalLbRs4mK2SsEIDZGEJEBz2eBux1ty0jfMzAHQvWowVL70OIRVIWSgnAlvw4DAjQgynjwPdFcBwKxQnYbUDwwEMheUexaKPWDwOMgXkl86EqhkB6UShtQ8WAjIqw5/ZwpEOMsUgrOYQBtJK5LsNLAxUMkCnMJipa3Bo1Qpsp7pRsMIkkiwCr9cbfWTqOuBxKDfyXYQ9FRvK0pVugugP4FQAcGrHALVjAMCqcCGfsUqGhPiiLIfDmfkGIlr+VWiPb4rPUcPMipkjpe+KmeW0adOckNyLq4/qM+Epb5E+goVrh9ZvG9T/ZK/Gc/92/gOpU2+NKyXw+0vvPXf6263NC5blY8m6am5fuQLa90AE2Z3NmelvLxty/fX/Om/ixEbz+PvvMzNT4vH7023bbzsrykJKq82OhS5s7XshTy7s6vqqtfzhjTV7w+ftVlcBiRhUPAqlojDGwkkmoerqIBJJkOuAAoma6h6IJByQEAisA19LuE4ENT1qYNjAsIR0XBSX/RNtC/4NwQKuq8BGQ8GB4CjAEtFoBCwZhgIEwgNVKYh4AUq0Yo5fjcHxPA6KdiCwhh2loXQP9HL3/9XIIbt3MXf3ElDf2YQPWvb5TFhpaAA2JU+o9PqGj429mbL09zsiLGX/Vjnkhog0AE1EuvQzjxw5UgNtVX9quPbeFW93jO/oLNjNd928sMN3tv/uwacdMXEH2+D+/m+n55suvvtXL72y+LpZHy1jJ5GEFxSJTQApFCAM+m/RV65oLfIbr39y/jtvzalPT5mi37z1VlVH1Fk4aP8Lc5v1h+sxopzHcK8DmwW6xHqIVUIieFNzHCWKmlwB1piQ8p8AgoQJTMh6Yjl87mRhTcg+aIwHa3xEHAlrgEIugLAKDkVRyGr4nW9B2Y+ghAJrA13QsAwUPQ9ekA9n+2mGoxOQOoKI1HChke+qQswG2KNqAQgGlomrYiQTYuDVY7b66wupFAugancAI0oXLzdyB5AAJISkMMsvAcjVr2/42BQvrvy3P/yqfI5vZCh3DdZ25+aTH7ilbXrnYd25Igbsvnl29LEjvzvhrAlPApBzY4/6V132wO9efmXB5fPntwWxWAx+QVMum4dSEQQmHDEciTogQfzB7Da+996Xr2Zmd+Rpp5nmhgY58PLfPJ3bY+SVKh6X8GF66jx28rtRpcNhL6uegQXwOQj+ypOdAmKI6jhENAIYhvEDwGiwDUCuQnt3EX5eQJBAPCahpIVfzMEGHrT2QxmiUneiJBj2YaARqXZghQeVNJBRWWJOAQI/gPEEpDZwWQKqCv2SbUhID9rCxOJaGH+r1w8Y+uavmZnSaViE7Phy43yB9QYU1/HiZ/1+k9bqWJTaoL/s0K74hgoGmFn87Yw7blz08orjslkfA3fv3z7m+FFH7nPS2EnACIeZ5RXp+2984YUPf71sebfu2bvG8YtFslrDdWKIRAm9etfB+BqLFy4FCYiC55kZ0zt3/8ufHz1LSrIddQeIFtSr7EN3XrFi552mJyAlM8yAoBs7eVlEDcNS6JeG3z7H7WIKw8SsoLMetPaAiAI5Trg1mwCkDWKugIhYSJIoZHzkcgVEIhKJmgQMMYrFIiKxKAw4bJU1AiZLEEUF+A5M3gX5DAsNP+KDkkXE4nmQZVi/CiK+DImaLkArG3UCcmzvQpUadjZAJrzdPBDAhI1fF+vjzVrXi2RRmsC4vn/a6GglEAVw4hdERfpfJRzURE3kxiL89zPuvHJuyyc/KeSLGLBP/wWHnfvdg/b+3t4tAATztMifrnrkziefmHXGwqXdVkWjKpcLSRIsLAx7oe0e6FLm2EHgF9B3UK3o9gP71NPvnnnPw89udtptpwUfjNiWhhJ1ew3fPb5z0BYr3SCAtNZuF3RimJ+DMqLMJLWJPkdZNixUzAUxQdrSMhECVjB8yxARCb+YgxIaUoWzAJUbQSQWQaADZLoyIBCUFJDKAUmBQlCEZgEVE7DCB8kArshDSR/wDaTHUJZBpKGtizxlEaleBmLNDoyNqbhIil1/MW7oI6/Onp0qV8sfW4oIfYaDzABrQHeDdTegu4Ggm2G7YY1XALAAwArAtgJYYU3QBXQKmA6CNRkAC8u/A7ASwDIA3kbe3PLvD2bmAV92vdU3iki6qbFJpEVa33X67b/5+LmF5xXyAQbsM+DdhksmHLvF9kNmljRL9Q1/fPyef/3rnQntXQXtKCXz2RwYAaLJBKqrqtC2sg2ZziyE48CNJpDLZuBGFLo7PcEmMK1L41vc+cf/nAXgotPevFVzqr+gc86Ys+C3l14g7r3vrsi8BcYlxk75TuRY4f1EbBWn1efShsaWugjDOj3r+QiHiREMFIgk3Fg1rO9DOArtSzrQq3cVyBCkJShHwTCjo30llEOoqUogWyzAwMLXApAR+ORBCgnFBAEDJo2AIhCRLJyqJTCkIQOy8aRQ0MOa99ux5ZbmZshhw5oC5iYXwJFrZKzFhgKMdmkzbMe/YBwDWAPJgjggKxPS9TBkqh1y+a9jEBYoKiGB/Ad/Gi87n/5TRNlkAftcFdvtuttRXJFAtA+XQvnnAjhnI+LkZcd8MIBDAdz6ZWqPb4zmYGZKT0z7915091mfvLLksmI+j/5jek0/8erjjlxDMPrdccuzj/7j4dcntHUXjRBQnu9RJOYiUZVAsZBHoVgEwwl3WZIo6jy22qY/IlEH2e4sMt0FQASIODygXMxL6bRtYVZbXp7+e+aQg29z+/SROvBNDB5GFDsw0POhIbGptDwAIFhC+EHIWCgBJxaBkWH+wbUW0jeIRS06OjqhfQdkLWprJYg9kCQoV6HciJhIxiCjEgW/CBiGMASHBYqFACRCx54jPhApQiGKYj6OiOpETHVCBdZUR6xErteHvWL7nHlJyheDB08TJfNkHwA7ffYHJMB6QNeL4I6VECs6oQrdsN5ywJsrTPt8Gcm9eDymH37uxIkTlxPF5hHF5iW2Td/mF4sn6szHGSdzz2+WPzNmEMX6fkxEc4loIYB7AHRjdYvsxth0Dcwc/zKpQ78RwlHIFBwi4knXPf6DpVOX/jGzMo/eo/tMPv/+cw/pM6DPBy2pFsXMW99/53NT7r/39foVKzzPcYyw0IjGHRgKIJUDAYXuziwsC2i2JWZ2hcBnGM2wxvGqq+Jy622p5bxf7396yXcNvTxm06y1tDdcd86SUaOnuJEqaTXrGpvD6HwH+nkaBnKTtQeBwELAEodjx40FCwuZjMCTBM0GQeAjGiUo8mH8IlwlEVL6aggFFIoevKIHqUomXsCQARCxFo7tRELlEWUP1s+AKQdGEQF7SERaodAKFYCrhKEYqlsTPcces8vW165oamqgESNG6NJlHgKgCutnMiwRXgPc/SZscRlYRUCiCra7D2xHDSjqggWx8YUX6108+7BtJ17MzMSzUi5zs6yun/Vwd3J8I5x4vofTPmnpa5cOY26W06bd6gB4G8DrGykY5V1qXwAjvkyn/GsXDmusjFXFWqfeNXnc7Bc+uqO7NS/67dXvsQvuO+8IIlra3NwsJ2OyBbDEUe4NA7eoXdB3s7pIV8aHciIci0XhZT1k2jMQ7MBRDhh5bDmkJxzXgYTAooXLkS8qU1dVFxm2XY+X7n/gN0eMGzcuy7w6g0FE3JBK8RZEheijD5ywbKed55K2ysDaniaH0fl2VGldctA3xYPkUFApLIm3xQDSAn5QhJYMkgRTAKJCAOxBKAnfZwAuvKKGX/CgJIMU4PserLZwIwq+KYCVgVGAlAGgLZSNwNUSrh+F4hySaj5ixkcsALsUFbY44hejhzS/Ew6DabaliGAfbASFatmqMp1vwupOIFaEibdBx1vB8W5YzQwmK2sSEX8l5hrb+TIRMebMMUSNhlP7qJ4jm58NYodOEK7VtcETd0xGA42Y+7wtaa97NkEtl6lDf/Bl1lt97cIhpCgAGP36I6/emVmWkf3G9Lnv3LvPbiSi7uaGZtnY2GjS6bQlonzjSeP+ctf9Z44aO3bQX4cP24y0FrR8abeNuknrui6M9RBoHw45WLm4GzZgOIqgpNI961y5+4j41DvvPvtwIsqkUinx6RtL6bTlhgbZi2iRPO+sH3cM3ykPT5MlywPQjSF+cZO9jnLXLUkCRWXYEssMCmwYYpXh4C+dK0K5IQWpF/jwPA8RJwpBoTOuhIAuGMA4IGsQr3ZR1BYQCppdBIYQYcB29ITMJtGDW1FXLCKRJ9035gj4/a/ZY9Tke7jZSqJ0GJgOd929ETKnb2A9hEM4rd/KfteMsGvcMEj7UKqTrRMYJSy5sbj0C8mHc87+45K7TnqOmYkaJ5rw3k7R3AwZ3+3ml03PA8aoiB6wxwt7302NE02pt2xSyZnfFDKFw5h5UNks/28Qjk29yOIjlzenM8syW/bbs++NZ9x2xklEFDAzNU5sXIvMi1MsiGjZZZcdd+pPflK/7yEHDX1zwOY9ha9ZZPJ5XderGltsORA6APxcGN0xlPB79qlTe+3T76k/33z0wUTUnkqlRDqdtuvyeyY2NKClvl71bzhssnfwd87Wg7YhLgQWZLkHe5t8wxgAkws2DFsohPV6roBVChoCARFkJAGZ6IViAGhtkYg7iEQkpJKIRCLo7OpAPpdFTVU1OCAgYBjrIxJhBEUPkg1irg+SPtzaNvRMzEF10IWIj6BfklU2n3h4RzP3V9zCCg2wzCA0NZUnM33/Mxdj+beFOaT891lKF9bXgCFNBpRISBlQfGnB9muM7Pz4MT2GX7SQeR2bTyMMM0Rk2E2zu7IHjGJH7NM19ahflIY0LwPw8Boh289atxZAbwDfK72P+EYLBzOTlNJs5Kop7xA9cq3ZXn137d10ys2n/byk6nld6pLSZFOplLC2QR522Kj/XHHVSXv++Cd7Xjx61IDlfXv1UsuX5uzixSvYjUo4cc25fNbWJMjdf9zmD1595Y8OJ+qbDRNe6xCMkJuBGxsbzeSxY+00jHC2uvqS21vH7PNbtfmWMpxkYzdZ8i3CSdvWCJBxwsIKpQBXwpCBsGFlbrbQic72TkhJsNbCWA1fa2S786hOVCEiIsgXCpCuBysNtBeHKUjEhAtlfVgb+rI1tBAJ0w3lwdTF4HQXE//J7d/xfRpHGmPD8n4iYkqnLTNvXUqqfQYXiAAAY7tfhetI4kBZIY1xa6EQi3qeqbuhWHfi8PhO909kNsSplChpp3UkRWGZG2SvcVctYnfoSMuJXTOz/zIsfN76KQBZbEQP7RpmYCMz9yo55uIbKRxEVLYddyxduMaG6moYBiEXMr5z5oSbTr/lnHS5V2NDdmS4sCeahoYGSUTmhJPGX3Hj9SeNP3zCNvftuEMfoQNJQvRgx6mj3j2iYuy+/a+74oqTjyMKBWtd52ZmQSBm5tjUp5/fJ51O28frJzADYvADt/zuk113ugqxOtAO2wcwBgg0YMyqg40JS0TWPCyDjUHdtltDViWh2a6aRmsKBlwI1w5JRuB1IULd6Ld5EoZ9lMswWBho64djoVVpGiwYEj7Iz6Lg5aCERURH4eQUav0O1BVyEJpMIgaZ5fjMoN+Jxwwn8jkVjughAn887Yqa3IwLBwD6HLDtWSL5Wd+z0gCMBbq09M/QJrrYiQjhxOPS+D0eL2LrQ6LDnjyrdotT2rk5zGtSOm03vFYmmpaWelU1+o7lSgw+D4W2PpyCyOW82QDmrfm+GziAcLbLTgBOLK/Br9ME2lCpxwkIhx4e8DlO026tfVsIcRURPbcptTOpVEql02kdjbp4ZGLLQfc3v3H1h++17+goyozae+A5117zk79ZhlifNiq/FzNH7jvvyn+2L1xSv8t3Dzhh3+MPf/Sp66+PHHz22QGYvxfMnHO7s+MOsdJD26T8UNv7H+KjR57CB7c/AJsvkTkTQbKHWB/GvlcNQlVvwPpFWBCCIIp8XiNZRTA2FAgTWFihkevy4DgBVNQHIw8EDoLAIClWIGa6IXxY14XwEF/YGR85od/Yf89khmhqSiGdTtuOV08YlOix1T+cwb/oD1lXCyC2CR/lMX/lC4/xgmv3kpG+D8945c5JI0+jgFvqFcZOMbSJobw11g4BwSjAuRrAmM+5FO8DcAYRdX9R5NPqCxa0DxHW22+SBFtrpRCiB9ZufdsopNNp3dzcLBsbG+3Bh415NhJxnj3751ef3Nm2YsbVV//kLSAlmJvWKRglTWKZueeDv77mgRWvzxyfW9qG2eAHZk9+7QfDxu7ZzMwE3yhnxx1u8d77aETkuRf39YICkxQkGMiTiwVOFEUlIMuanlezIxIsIokkjB9AE8ESQVK5Q0RCC8CJCHR05pCQMUg3ALFGPEphcaK0EIrQ3VZArNqitjZAYHxYQ0CQgENdiMrliPgepIVVEiJgt7NbbH5Cv7H/nlnazTmdTttl7/ypb1JNeVTFMjuhayqs1dbKgdNU3ch/AboGUHbDFqLt6/be/z3qc8Ad4Ut3oaWlXtG4KfpzWhtc8k1sqbNzOoCXsekVnlEA7V90Uvu/Z3bwZ+5CoKamFKXT6TWK2VICWLeKb2lpUePGjdPMPPCB8//QvPSlt0Z1tXWYiBulwDNiy3G7+ePPO/WkAdtt+VD5f57FTontt6KJfefPODgANAHKAJiBGrwhalFww/iiJQJYhDaGsCDDcFwX0apESI8DAUGAtB5ifTQO+uMgeKqApIhCSQ3fsxBE8IxEIbCIJsL0A3Me1suCpQL5GtrzkaRlcCkD1rARAeGT212Q/Y+t/c6CZzgFgaZwqsLSpc8mapf+9d/RZHE35Lu09jMCQjKS1cszrfmf9tj7tcc25V6v4UMw/kdBX9ziZPkF+DDmi7AbU6mUAmDT67F9S5rGMPPW95192UNLX3prt2xnV5Do1csxbODni1YaJYYctHvxwAt/fFSvAQOeXjB1amyLvfcudBhT6+13+IN9XnvlIM8aTYKUsA4+cKrxWrIGWUdCCA2CDMvcqTQmjRkUMCA0BIfCoXQRyX5FHHDNEFT1FTA5H9owmB1Ih5D3NTwfiCdjYD8DY7rA7IF9wOGViHAGSvsgQ1ZKFj5inhft+b3qAxY9ytPgYARrgMSHT1+vBvZ94+FodfbQoCOrofIKbgQcEDssiGpq0NHRv6luxA2/A5ok0ABgGH+Zz2hd5i02rkx+QxrEfJF5jy9MDZUmMJlvgsSn0+n1qvnmhgbZ2Nho2jOZne78yUXNy1+dua1fLGonEnHyXV2I1iYQTyZEoT1v5z/3avRptrdbY/YhorktqZSqI+r8YMmSE+0xJz3Y/7U39itYY6CM3Nr4kH6AV6tq0BGVcODDCIbQThh7EBYSMqzs5dJ2K8K8BxlCrjMLSQTXVehoL8AKieoaQsS10LobXs6H40QgWUPZJZC2E65hsIWRgqWWbreWm51YfcDHj7WkoGgkAuYmQUQm+/a710YTnYfq7m4tXamKnoISGkJ6pD3BvFKjrqbQlJtxcs19O9/5y9OIAm5ukOUcxVeyS4cCZ/8nNcd/A1pSKTUundbvvPnO6KlX397c+dacAb4OrFuVFLHqKnQuWwEVcSBIIMgFkELYqlhSJIZt0VLzwOLxs2kiN6VSoHTadjLXeWMnPNT75ZfH+zoIWApHMvCJk8QryZ5YGVNQYAgWsCBIyyWykVJIXgCu8VHVr4ADfj8ITrVGTBloE6CQN5BOBMKRsCYApIZfkNC5AhxegqpoO+AHgCGjJEufo1056nN8jwkLn+QWKBoHzSkISsNmZp58Tlx2XcN+FjbISd8UEYvEAFkASw9kJWyhipmFcaqjKlvc/J6ZPf922l5bUIFDUniLbym+LYyHSKVSYlw6rWdNfXuXl6646YGOt94dEFg2kaqYICWQae+AIgF4GsbzUdO3BhQniHzRZN5+f9hmrWfH04BFUxNzc7OsJeqITH7i2JV77/tExI05pI0xYAz0s6jPtGJA0YNlBUOALLUy2PKQHCaQkSATJvSk0hAqQHdHGMaNJSWiUYYgDSUJbBQkupGIz0PMbQUFAYSBUQ7LgJPLC2rgMT0mLHySb4WDsTAMEJrKjHR6J+EYKaFhmTkSUSDKwTJgvWqwTcCIAgWFgtLZnE7G5504fOUJze/856a6MCeREhXh+B9GOfHX0vyvrSdd8Zd/tM2Yu6UFDAQkM4MDDfJNqdaDSv9jES1aGxeQVYMH/HvvvvtkVoUIGxttSyqlaok6+rz46HGL6sc+6CR7SDJaW7LoozMY196G7TM5SCPDHnRpQByOcGYK54CEgzklLBmIKCGvfbAksPVhEUAXNPJdLnTeQ0wuhtKdcI0FAgQiBhnImtnZeP1BtQd/+Dw3Q058vsGWRhpyqYFJVO1434+6cj2uhktSCiYgZlkKwEbhZathfAlyDZzaAOC8LLYXTZWzcMLg2JMPzZl0UU+i9Nc2WakiHF+BxiAinv7s9MSMvzxwh/fhkiGetkYoIWt71yHIe7A5L2RHdBSEkhAkUFjUatyiVs4ug2ePvvriM9kygQjNzc0uScnj0mnNqZQiouyAZ5uPXzam/ia31wAljB9YMFfbHEZnl2P3zg7EtIHmcum5BRPDSANbGshpvQKKXV2o6xsBGwvIGIgUIH2QuwxxNQ/S74TSBFgOZBKO51VNXd7vpO/02P/JGWG4thmNEyeaBbNfGPbRk1fst2pfaLaydpe7Lsz6W50votJIVRC+H2UIhhvLwCKHcJ/wYUVAQkLmu/M64a4cv0V81h0rp15Z9XVOV6oIx5eIOek0gYBnUpddRMvz+/pSFBK9kpIAZFa0w4UMC3WMgYg6iPWqA+ULpiouZY+D9pg17JKzjhg+fNCyyfX1koh4yG1//867O+5y2zsL3qmjdFq31NcrIrKbtzz0s3mHfud3eovtHWU0gdhG4WOX4krs29mKATkfhgSMBCQLUChrpZHLBAeAEAXA9RBoQq49Diks4pgPx7SDPFgZMIuYcrJe9T8jE+47aODONyzilnqF2WBqbDQrPpi0a3zKpU/SK3+pB4CmphRRIwynWFTtcse1nWKPEw25mYgLMj4ZIAdHWZiMA52Lh6Q6tgOKtCx2wSRqOo5wnKknhFL27TOv/uc/8A6pFAOEoQfWzxFDBgQuRMy1VpOVULYUrCMJwQ6oEKC4dLmJJarlZkccPOnI2/4wfuSOQz8GgMlTplhIiV7GH7Ld+++fUv3dH7y44IYbxo+bMkU3A5J3PNkZcs+Nv+067vifd2y/m3YsBBmrSQQY5Hdh38xi7NjZjWggoEVIugDLYeEGLJzqBNi6MNqCaSWk8xGU9yGcwAM8aAEW2k1SNw+9KnlIV4MQh+e5pV5h3BRLadi2p69oUI+c+2yvRf/Zsra4zAGApnSaQQKUhm1JQfXc4boHinq/I30Zb41EC5KhNEPB+ALWAAQNEo41MBztxTLrJR/Rbt1jofOS5opw/I8hnU7b1CWXiKN+d84De51y1NE9d9p2sQqUkp41kgnxqjhqaqsgYdlpy+u6aFJu9d1xtx991YVHJomWgYBpi6fFmwCGEHB69Oitizk9cMY7u0Rvuf3pd39xzsUNzKA3bws+OPDASP8rL7xR/+zsI1p3GbVIKkdBF40li1qbx56ZldirYyX6FgsAMwwpQEtIN4tsWyv83JawvoFrVyIulkB6OcA3RjisDNWuKNSMbqgZ/94vQcT2oQZJ46ZoMGPZAz/+beS1vzUnFs3qDc+yY2W/0lxDfv/e0wZ/+PRvLx6XVpqv3zpStUv6xS47fnwu6PNJpBpKB76JVFmoSBHah3WgRKS6pygGm19TtdszR/fa9e7FJfLPinD8rwoIrKUR3z3g8cN/d8HYLQ/Z99naAX2kNAxoYYrdeRvLFalu24Gq56H7/ObYP6dOIaI8M9PTv7u+6e2z/3w2AQwp4UZjvQSzAsivnj1DDnzo4d8vPOX05hzzgKHPPON9sPXWkc1+/r2n7E3Xj+s6eMIU1WuAFCZvrSUrpY9tvBXYv3U5du3Moc7TICvAUkEFHqS3CMougirmwDlrKQCEo6S2m7+0xB15QPWYSf9oSVmFFCQ1TjRtzAOX3db4UN/3Hr9UrPyQrSDNBLLgvqt4t9+8w91q/j9+n3nilD/Q2Qs9boHqO/zC6RlxVH3R3/KVaI2SxgQMDY5Vx4WHvvPyZtvvxXZ69AIQlafEfSt9jm8VmpubZSl6FZn6139ceNuEn+VvGnwY/2Xz/fjuQ07zn7v2jpMhy9Eqdl+/8Z7bHtnvBL5rxPgHS6+JFSef9rAHsKekKUplAyDwEjU8/4enzlv+9swxADCtNP9yKXOi41fX3JAZOsIw4uxBBr5KcEAJLqqevEhsxtM235Y7nxnCelo1B5McNs9J1k+ogJ8Gm8drTO7ZUVd/8NQ91QAwbdqpTnlP65z+4EHLbzr4E3NBnItnIMidQzZ3DmxwPrjtF+7bqVToI3zyp8Hb8KWO4Wv6cPu9R/4txSzKHDmvPvVqdW7Gkbfrt0eynjbKK8w47p4FU6/cDAC4GfL/DLiq4H88rJtaXfM/57lXRz14wq/euuuoM+a+/uikAwCgAXCZuerFK/468b7RR/P9W+1jHtxrwnMl4XCWn/bz5/MAe1IZjwQXleQiEBRkjBeNPzT45P77T0EsGr4XQBCEFbdPbMgefPxcrtuSfcD4Km4KTo31RC23992c8w/XcTAF1jxNRv8Llp9XHDw34OPW58cfU1bufOsIp3QNsWXPXZ7q+MNubM4GF89EkD+bOHc2OHsubPE8cNu5zvKWVFj98PHlmw0NrkgyX4giX1nLmbsOe2Q5czK1htXQ9eYhJ3bObDxo1T1qqVeVlfJtFRBmam5oKGuR2qUdhUFlzcLM4l8XXPG3O3c9nP82YG//oa3344fGHPF6WeO0/fzcV3MAe8KxRZLskWCPJHsgnQe4dftdecmVf7yPmetKAuIAwLLOwuCuC6+6NbvrGLZujC0iHFDc7+7ZP8jeV+PrZ2H5WTC/kOTcpO3vXNqS2qq8ULm0kNva5gxvv/+HU/2mgVz4Kbj4c5jCWcSFs8G5c8DZc2C9UDg6+NZQyyy6fLOh9ooY88Vk+FcI+NpaXn7PkS+0M9cwg0p9HqX7AiprnAq+YbxVXxVKcXtTyoF0AuhM1adUY2OjvvWoMy6SsxeeTEExgOsIYgYL6ZZ9NCuQRFkvcKk6HRZEJCUEJ9992/LVK76/8N339lj67oen0A7bTG5hqH61sbmIuKd1PNXyUOfd918WeWnqnvHly5yqoAhUKVjXRT5b8w4nR1+cHPPUk0Aa3Nzg0riJPjPL9qk3/Ny/9Qe/69s+s8bPFjU5QjFZgTXo5lY/VOYPiwtXL/JSCT07QlFbp9cneGq/ZTcf8DB+ygchTZZbUgpjYcPuvXTFv/g2C8dakaxUSjShCUiTSRNBWtO/JlGF1hXdIupIhhAgqVb1mRCb+KrxUQgz3eEXg2AJQkhuXax73n3n1p3z5r645Kbbr+x/+o8vARHY8wXtP+ZFOM6L3Q89eVT26qsPMPPfTlZpN9+R6PVar3Hz7wQeAzMEGkHUONFfvvzDrTtuP/4PtUtfPdosnYuAYNgh9ekaPVojwsIESozZUwLPAG4ECCRgCUZbowCX3QGQTvItAIoAn8c2mW9roq8iHJ8hIGmkwQA1H3OMbGi+5bxJ6Zuj9uU3Ts28+xGEcA3kqtskJDi25ipirEmXEeYuQKSIfa6ZMgnik0UXLZj2Vn3XzHfPp12GvwxjwEce6dJRB/4TwD/husBRAYAlYZ/EbacqotsCCAcrJv7iR7G/n9iUXDZzoJ/NWXKImDisR6HVb06fmq1DTBTr2Cx03iMRsHFBPmsVIzfTZ0/WWxz+sz5HX3YTTqGSIq0IRkU4NmRqAYyJE01YR0Knvfdoy4zZ9/8zHZk5t1fQnSuXwBMzu7yGtbKWL7NqxTIkg4SQrOe+q3sumj+6e86cf39yyeWXRy658GYiWjoNI5wROxRo4pw5pqEFhKoRhMY3LU28LXi3pWWrPrP/kq5+456TVG4JAgsNl9RaBtSaUrnm9/A6qBhRoSkYGYQgv9JGkjVuV+/Rswpjzj6z/64HT+YGSJpIZj0TOyuoCMc6nHWAyDK2O3zsTSvmLXrlg5vvv/nj6dN6r5IhIqc0jHlV9J/X+G8Gg0ulIWQtKSGV8Qu26pXJEh9/8Nv8rLePXnbPfX/uf/qpt/KcXPhf58OhN98MAIlFd5zZWPfyL6+Mr5yxVVDwOJBgCFKr8hb8KTtqDVkpjzC0EMKt6uMCQEY7VNtnhMjp2jvkTx66sD9ReygYMKikLyrCsckaBAA3N0saNODtBcwH63sfGI/nmgHAErEsi8HqDZz/j5CsGpFmLSQgpJCwK5bomokP7VCY/d4tC79/8unVxx57SfX+ez9DRMGCd/5TF3/x8uvi7//jpHhukdAWhhRJgIlXnW9txrP1/kwgJaMRAHC3ObqwPKLOGFL/w5txCiHs2U6bypOuCMfnF5LGRtPc3Cy3JOoA0Lxq2VuW6xpGsPbEcFrrdQECrAGRUMzWOHOmi5p3393FvD3jsQUjd35q6SX7/TPywA8uqisu3TrIFdh3YClsG1zrxKsspw3M7gxJ5EgYQVEAGHLgDxeC+WYGqCmVovXxSVVQEY5NQqnPnEBEVAoPUam3YV2CUV6pqz2PNb2QUh85SApituxZmvYfqp7++iF13686BLWtMEVYcsIBsGvOQOJPq4ZPh6jKc9JpFfGvUNbEAIAvuUQ0IQ2kQwaSylPdeFQSPp+lQcJIzuplqe069MbaWoOJSsZQ2GNa8lEAhMTSYJAAhBKCyBjjtXUEVhCXpjyvfc7ywi/7N7z2MCT61A9l4fD9fHx1RA6WKg5GRTi+dBiz3t3XhiYNNFtrGJaJ2IJgEU6csiUjiyFCwbEMQEijXMcS09pOz+poGDPAlsAa1vpsEbCl8h/SmuZUSeMIISS8UDiaKo+sIhxfVTQr8JnWYVBZEEACRTZW7zxKmC23EUE4eoAJZZaCNV331YYXCwKL0jl4DY3B4VgMYgI0G6kh1FajhR40RmgTCsiagVgW4RMlCcFWJ1CRjopwfAURrNXSoLX59G8YBCsEfDbWGzhUFK/4w1vF8391c2bIcGK2ZGEskSgJg10V6aLytEFZSuoJXjvvHVpgMAW20ViVbN9i3/czh173x/wBV7zr9B8sTMCl867tfwhBxNrGAGDixImVytqKQ/7lKozyd8MmcEKB4DDMGjIcGrbGr+4lg+NPnLHVwfUHEY1tXX7f46923fznP9e8NrWGg4ImEhIc0ius1iEURrO4tPOXNUZodlnrMcX6DxJtA+ofi3z/znPq6mhenvlPhSUnPRLvvGY3XcxaOCTKw1qZASkIgoMEENKzVVDRHF/NDWMK1tyqLQBLgjWz7Nh9r2X6gvMOI6LWaaee6vQ9/rC7zVXX7NPZePxM03szFbBlpnIgqkTTUyr/WNvxJpiArWMg7IBROjPilMvnn3HnMXV1NG/WrGY3TrRQ7Perk/LbjF8uFQkGrCgPLCOwFAJsTbzytCrC8ZVqEAI8KnvJAKyQbKy2+eG7eonTfnzSNj3jn7SkUmrkbbcFXF+vhuy188yt7v3rmMzpp1xf3HkPodkSh0mPVZoDwq4yiyyIdZFNPFYr8tsfudDf/xfH1B1z8a9HEgXMKTF8eKM/bdqtTlVVZLbe6bAfmIE7WhX263G5QooIgA5DuRXVURGOrwqWmT1Rdj9IAmw19R8kg++deOOgExsnTTv1VGdcOsxA05QpOhzkQpmtLr/sHHFR+ujc4Y2LTbxKajYWRJZQpgclaAtrfIbsPVhmR5z+YtfRt+7Xe2zjY5yCCNtVwzzFyJGnBcwp0XPMj57Nb3XAL0XPvhKWrSABwWBBEmRtBAAmT55d8Tkq+ArUBrPbftxxM4sA58m1XeSYDMV4bsOP/lMi0qZ1EaAxM7WU/Lssc/+Pf/jzh9q22ZHbAV4pXJNviHPuXOjgp+BseqRpe+Kay5lZAWEZy3quhThVr5hZdNz7gye5Kcb5C6ALF8AEv+vDbZNvvBQAuCVV8SsrmuMrcsytzRMIIGUlG+rca59szZ+vP52IDKdS6yz/JiIeB+jmhgaZJFo65N5bjg0uOP+n3bvvu8KSK9DBNuInpTf0mBXFUWcf03PC+RcTkebmZkmNjeusgyIiRtNYCyJg+Pd/Xuw3arHjKhFGjRnlgRcVVPBVaQ7R3tDwggfFHqTXtc2uvPCaW38CAFxqu92Ic1BziWp//tKlg+Yec9Lz3RP21O03/qpl3pLu7UNt0bDRVPzl922dcs+B+euH+94vob3f9+f2KX+5KHy/Zll5chV8FcJBrQ3HPFoEbLFmc1545kW3wFHghga5qXyyLfUhiQEzRzpmzjlqKXMCAKbdWmYY2YTram6QACHz9G+b+NotONPUw3ZOvemnGzLLKqjgi0U0irYjj76zSIqXHvujtzuZezAgPi/RMn+KzIA/J7kBg4lTUMzsrLjt0Mf4jwO4+9WbjwiFr0KYUMGXD0LExbyDDr59/p5jC92vvLk9EBJVfxHm2v/3OUrXsZA51nnDrpPaJ1229/+PwFVQwSbsziBOpcRHF1181vSzLpgAAFz/zeJ3Kmuwle9OrVo59faq8LUKMVsFX9HiK4Vs8U2dWcGoCEMFX+8CFN9sIS5XWlVQQWVnrqCCCiqooIIKKqigggoqqKCCCiqooIIKKqigggoqqKCCCiqooIIKKqigggoqqKCCCiqooIIKKqigggoqqKCCCiqooIIKKqigggoqqKCCCiqooIIKKqigggoqqKCCCiqooIIKKqigggoq+G/G/wMOOip8IFxrzwAAAABJRU5ErkJggg==";
const NFL_MARK = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAJcAAADICAYAAADlR3NbAABsvUlEQVR42u1dd3xUxdp+3plztqR3SOgdQieIDQkoivLZdWO7dg2Wa+91s3bsV68F7HptWcAuKgiJCogSOgGkt/SQXnb3zLzfH5tggAAJRSyZ329FcXffszPPvL0AbWuvy+VySQC48L7XXeff/dpMAcDlypRtO9O2DmwxE1wuycxhA1yPrI054T5+6t1vz0cbwNrWga6U9EkmAJx31+Q3zaNvZQxMt4Zc+HhJcfGmpAbQUdsuta1Wr/RJQWC5J31xetzYeywMnhCgYdcE5JE382m3vPJZA/rMtp1qW61abrdbAEDm1z/Edxx/3yqk/FuLlGstGn4dY8gEK/TYW/mO56bcb0hCegN3a1u7L9G2BbuqWUy5uf2JmSPe+W7FzPzCyj4CSjMgwQxhCFFTXaMzv1/y8LUPvZs8efKEgNvtNtp2rg1c+1w0fILh9aapkZc/fd+snI2DlOUPMJH8HXwgYQps2lSkZize+N3sOQv6ejweq5Hbta02cDXLsZCSbiJncuC8e994YOn64jvrKsssYUoTzLu8F0LYiFavze/w+IfzZzFzX48HcGW2WZBNV9tmNKwswNj84bPWY299c9/UWSseLikstoTNNHgXYDXhccRaBzYWV0d+/eOSXvlL7n9vxfpoA/kLGPC0bWgb59rhczCzPR7r5SlZ973+2a+PbNu0NSDtptwzsBrgJaWp6mus+Su2jet82v2viJzJASBNuN3ctq9t4AJSUtJNkTM58PLU7Aee+3DuI+t/22DJELupW+TDYpAQBim/lbfdd033s92vErzK4yHdBrB/sFhkZsoCjF8+fNZyv/7l/a9O+eXhtavXBWSow9C6dc5RIhKWv96qrseIrkec0mnbwqlLTjoppNyVmSlzvV7+xxpH/1RgERELAJc/9N59X/+89pH8TVsDMsTeamD9DjCAlbZsNqcx/rj+eR8+cvEYh8PxW/qkSebkCRMCbeD6Byy3e7bh8YyxmDkk5ZInb1+3rdxTUVxiSYdpaH2ATIYIbCkLJI1h/bvmHTOkwwn/vf2iVUhJN3nBJIuI/lFc7B+jFzAzpaRPMoPAqow/6/bX56xcV+SpKC21hN04cGA1+CjIkIYgrRYu35A0bUZu1lP/m3mbyJkcICL+p+lh/wjO5Xa7hcfj0QDw6GtfnfjaZz8/vamwchD76yxhGsa+rML921jWWkF0SozHyGG9nvngkYsnElFxqtttZGVkqH8CF/u7g4tS0icZOZMnBJjZMeHRDx+e/uPy27cUV4CgFISQ4EN3xkRgXR9Q4XHxxrDusSsuPPPoc685/dhVjGDKjtebpv7WYjH1bxoXc7tnGwA4Z/KEwPtfzOs14pInP5uSvfL2LduKLCG0BtEhBVajlBQOm1FVXmplL1jT/4V3Zi25ZmLmdcxs93rTVDCl52+YtsNMbvdso/GHkSszU3jT/vo3KSgCcwnwKma2jZ3wwmXrthb+Z2NBpQPKHxCmYTL/8RKJCFrXByimXTsa0CN+5kkjet1z/1X/twAA/k6isilHpgvuffO6qU9e+bLfYgCQzKz/ij/S7Wbh8aQR4FWSgFc/mXP569Pm3rl8Q1HfmooKCFNokBCHA1i/A4ygAwELhsNIigv1d0mMu2/uW7dNIqKqxoPJzHT9JffflZkpvWlpDEAzc+hNT0+7lKLH3MOJMc5vb734+InXnTNytl8BSHUbyMpQ+NP/SCa3O0t6PGM0AG0Q8NAbXx/xyfdL78orqz1nW14xAG0JQ0jmP4d+SURgZsWWkvbQCHRpH7HxhBF9Xnr5rrQ3iWg78Ffa/waf4egMiWyPZZPAvx58e8zcRRvf7Nw5qSthcHqADJvRs3M7dG0fPfHW84//zympyflAMDTS/a6x+s8mLt1ut8jN7U+N7FcScP8LXw3/Yfm623LX551fVF4H9tVawmYI5j+nu4UIrJVWYDKiIiMxoHvCpuOG9375setOfX0HyADhdjMyMsB/Nm7WIP4YgAaA2YvXjXzmrW/vmbd80/jSbSU45qi+FlHKtQxAsT9AtpBwkRQXWtqrc/ykh6499YWjB/UobPyRLlcmHU6W/TugvAC8quHW2J//KOuCtz/7+eTC7RWuovI6oX11TFJoEkL+0SKQGjkTWLPGTsRJQDTHPYnA2lIammRUTBS6JUbm90yKeS7z6QlvOUxR4rO48TRlpsuFtMN40ZlZUJqX0AAqh03io1nrkx7677vXVdfr+9ZsKwVbPk2WwrFH9BWN4ArqA1oraEh7aBjinVQytF+3zMvOPGbqheOGztrxIwFKdbvlaEB7MjL4kLFuZnJ5vaJoxQrKDvqoNBD0+n707eJur3/x09jKat/NmworkvOLy4FAPUgKRYLkH4UpIjABrBRrBLEk4Q8App3IZmt4j4BmBnx1ICkUiAkgsQeQKUAYTocT3ZOiqnt1affNiCF9n73nktQlRFTbhG9IV6YL3jSXBg7lZWdyuzMoKwsiO9uj0PAj7abA4+/MOP7XZZtun7d43ai87dWh/toaJpuppSRp1foxckRf7ADXzuyaFRiG3RmK9pF2dGwfN3vUiF5fpZ8y8o1+feLL6/1Wk0+kGumTLqTEvLwdN6rRYdkauZ2RkUEeD5CeniQnT56gGsEEAHaDkF9U0/nxD2Ydu2jpmgvXbSkam1fhd/jq6gAroMhmgKh5znAoAAWG1kozAAMasIWHQRLBFBrdOrZDRUXFhoLtVesSYsJliN2sjI8O0zV1gZGL1hTEAxrQVrMuRgr+Q2vNDEtLMu1IjItAUnzkymF9O/5wfErPKeedfMQsQdQ0nkAp6ZOM7mOjdfKKFQxkwOMhvT+SofHf8/OT5OTJHzCQveOgHTaJHxatHfrm5/OP/3X55vFbC0qOL66sh/bXA1JYQgiDmSEEQdXtAVw7gUyzgqUkTDtFRIRBsH/rsQO6Ffbt3eXdI/t3+dZ1/KAtkqh2t1+SGvSdpTb5q+yEXAaA1KLkHbuaveNfPE3RCrsE6i0OmTLr1yHeWasHlhQVnbWpqHLE9ip/dHllDThQDwihhCAC0SG3ABseWGutNRgGhImI8BCEhRh1neMjt5h2I+vko/pVfDdnxbvP3nmxGNan3VYi2m4CWLC+uM/tT39818bC8gsdBv2aX1RqllT6RlDw7tBeFH9mZs2WJUAGGU4HusRHIj4qdGXHxLiv+neOnJFx3VlzQ+xGdZ1/N0kpkBoES+ou+7/jiBrOYU9nIAAo5pA3Pvu107zcDeMKthVesnJz0dCCCr+orakFLD+TIfWul7pF4NrNulEaEFJCA1GxURDK5+vfPbGisqb+Y9e44XW1VTWfXHz68QV9u0bVE1FBKzlX2M+ryuPueOYN29Benf/168qNXW2GecqK9dtiLbJRxfaKhtvOigz5h3GphtMPcilhyJCQEMRE2Ct6dYpd0LtD3BcnpR6XefaoLmVEVL/r57w/Lur/zrT5GQuWbDyXbAZ6dYy9+9f37px453PTBrz62bxlhfnFWtjMfV4MIgLAQW4WUIA0pBkSghCpkdgupkRA/zA4ufvaAZ1ilxWVVPz0/N3nS4cp1jVRY1p6Bu0XbyxwvDttbvvoyNCzPpg+zxkZ4jhv1abiSJZ2e2VZefAMhFAkBYjQrPrRKnDtsjQRoANKQwgDloYMDUNYiB3KX4/uHWIR6rSVr1ifP3Nwrw7o3iEeifERCHPa1cNvffvqEb07xp0+Zth5BSVlnF9SSRu3FYuVGwp0UnzUMJKy+5qN+WxzhlF1bT1QXwtIATBbwjAIwQwZ+sP0KUBrpQAyRXRUOOLCjIWdOye9cPu/xmSfnTpgYxNuIVzuTAOVW6T3udvqmDnu7DvfuvKXxWuuKw8Ynbsn2DeMH5Ny/NPXnbJRMQQzhw2/6Il5OSu3JAvBmluRPLADaIo1mCWYCNJASHgYoAKIdEru0TmB1mwq+q5dTERln27t0L1DAsKcZvWjb377Vr3PxwAwYmC32NOOG3TR5vxSrN5YiKVrtqJ/z6SxFdW+qPXbimHYQlBTVw9VWxs0xVlbwpCN+7/XS30g4GoqJrjRCGDFDAETAQUwQGFhCEos2vEklrJAIEijIerCCCq6YOj6ekBZgM0EtLZICAhBkpnBf3D8k4iglbLAwoiKikD3xOhfhw3s/Nxr91yQSUQNiEoxgZyA3QB8TYTJs+9+e/zHs5Y+vWxd8VB/TR3GHNXr8+9euuFmItqAVLeRCiA722Nd7n73yfdnLr3DX1utSJDc/2dt1P9Yg1iCIeAPACGhENIAEXacgaUsNNqvRAQpJTjIscDM0NXVwZ02DUBzgCSREEIGz6jlZ3DA4NrjFxMF0wGUDroKdgIkUQP73YH9HbEnQYJAQvPhdeU0BprtUTFGhxjnyoE9O3o+feaqqURkNfp2XC4X0tJIvfP53NT3Zy69zoT67RrXqCmfz1587oxffrt/4/oCRCTE4Ih+Sc98/8pNtzdoywIej87MzJQul0u/PX3+kQ+89HX21s0FUtiNg+YyaQST1qyCG737/jcRgwz6/QyEFBIMOtAzOGTg+ksvzRZb2ujYsT0G9unwvPeRiyaGhYUVACCXK1MkJ6/g3Nz+lOlN0/e+8MnDH85acd/GjYUwnSaiQ6TyQ8ryvCLVvlM7PuWYfk/+7+FL7jvmfrcxGtC7WM/EzCL53IdWrdxQ1FOQ0tyMa+Kvug4auCjInRiHWHQdSjqNYtB0hBndEkKLjz+636Vv3HvB9IAOBpSzMzJUg7KjGy3h9OO7HaeE7ZIlqzcfs2Zzce+KqnpA+y2hgdRjB+rP/zMhJdxuX/77o+9k9Aub8bA+7eZXPpk6a9mZgrRicItFY0Ps95CDcX/pHDRwsdYgKXFIU1eCuemHhM4OYJkOo3e39p9PdrvuOza553Kkug3O2pGlQJLA3p+3xp41ooNFRBVNDiD6miemDP512bpb120pPq2iug5QKtCta2Jg/DF9Xrmoe5cHvl3xra8p50p1zzayPWOs8Te+dOWcFdterygpDQhDmNzC5zUME5blP6RbzswwTBNaKbRWZDcFl9jfQ2F/AN07xfOQ3h0q2G9BHALeFaRjoXNiDA/v17mCfQePDhFB+1UgJCzS6N+z/VsrP77njGOTey5PTXUbyPY05Lu7BQC+7onMx+984s0NR1z42Kq0O16b/N/M2Sc7bBJEVDbpHlfWso/vOf2yM445Y0jfTltICnPDxuKQHxetP7XEYQv1eILRhka61/cvZgC44JSUWochFJipJfyYmSEFqXFH9V7HzPoQIksb0tBH9Ou0wGEa1TgAEIv9RLaSzjDERIRMHdy700RbeKTWCoFDcIOUtIcgItTx1ZEDuj7siIzUWnHgoADLUlZoVJQ5om/7t3Mz77tCp7oNV2amzG5wJrpcmZI5g6597MNnp/y09u616/LDFyxe337ajyuufuyNGdP7nfvQjJufnXq83SAEFOM/t5/z+aIPrh7gOnHY/JEjeqx+87Hzjzz99OElcANNQ2RpaWkaABbmbv7UX19bDsMwwOB9WoWKER8dXnnxKcecGxMZ5mNL76KiHzTdk0JDHOK6c0bdmhAbvgEQIIL+48ClNexOO5K7Jn170xlHvhsX6RCslHGwg9qsGabDhu4d42e8eOd57yREOw8KHa2UZdhDjOSusW/+9MZtl/utcySyM1Rj9kdqqtvwFq2g6WvWGOFh9o/OGdXrppNHD/mqV++OVZIZeVsLsWhV3tj3v17wferVz3+TOXNuh2DQOq7y44lXHf/ja7ccObxHjwp3g5W4y68Kui1udYkO7aIZSu9Tk2QNJewO7hAfNc910pDV7eMifyGbnZlhHWRrWYMktY8J3TDBddyPndrFZAmbnbXeP05p7M+th6UpMcpZm5Y6bNaQIb0LE6NDlucXmgPAWuEgFdoSEaAUJUQ4604Y1nsmgNKOceE5W/PLUsBq/+lotgxHqNGvc+wXOe/deaXmVAOc2TR3ihq51/jeHgvALwB+CXWYL/z0W36HR573XpO7sfDaDXkVscV5hdbM7ZXjCrbXLrsy473rX3P/66MdAWZm8tDuMT5mNHIc6tI+xr58xSaQzbZX3Ya1EmEhDkrp23kqEdWdf/dr09bnV6XWVfuJDqI+ojVr6XCIXp3bfb66PkAj+nf9dPWW0huKCqsEmWbr9a993pldXgwE2LSha2LUr/83duBGIrIG9Ez81HA4GhC++4tawKN2fyHA0kCndhFLb/zXCauIiIf06TTN5nSwVrp5OrTvm8kBRf27xRfMmvzvOzS7RWbm9Y2ZHQRASAIfc8XT94688sVPr3/qo4c+/GbhMQ5ToqY+gKGd47ZNe/baB6Y+e93A1JTeT3Tt0dnQ9XXW0nWF0RsKSm+12wx2ZWYG21nugbsSESPYxLdu7Zair8nhBGtWjbZLg1W64yUImjTQPtpZfv15o2bA7RbnHp8yPS7SXkmKIWjn9wPQhH2I2WboEEGTpZAQGcKjU/pkAuCnbzl7QUJUyBoIA2C2mvnMXgsAxN5EEoQpIIzgiwxBwhSstBkTFyuG9O04hYg0M9NZxw+d1qVdFEGxSdIUoCafkTahlUaL6JCx47NaaTMyJkYM7J44VTTQueS0oz/tnhhNUDBFc3QsvXc9qz7AXbp3kqcf2//8+MjI1a7M/tSYH+V2u8k0pL78of+9mLu54tGfFq46Y/K0nx+4/9XP5wy8YOKXrrsmH29IAgNI7pqQP+uVa++5aHzKmMH9u1cN79c+990HrjjFf+/9InnFin0n9q2PFkSkVq/ZshamCQaYtYbWRExSMMSOl2ISbA8VfTrFzx/Uq+MWeHKN804atqZnUvRStjmkYtrp/UyG0BrEe6jDZGZoJmIydvqchhAs7UZSbPi62y4+fjGQbhJRZZ8ucd8KR4jQDGNnOlJoBdJ7EevNg4uBiDCHBR1YBa22QVtbwGoz2NoMpTfGhpvL7zh/7NcAMHp0hjwjdfCK2HD7lzCNzVDWRrDaDGVtIag8XV+3OjYmvK5Z7ZOB8FCHAluroNQ2sN4CVpuJ1WYovTE6VK684pzUzxnA6IwMeWT/LmvioxzTYDc360Y6Wm3+nU5YbYNrZredZUtZoTEx8pj+Sc9PvPns7PT0SebOGbYZ0FqjrKI2skOMc2NUmKkClsa63zbj1+Ub/m/m/N++73fuI9Mff2fG2BCHicDQSeaj156W9dEzV6W+9eC/Tu7QIaLEjZanGxER7GEhTjCDNXNoqBMdEiI2O01aExXm2BYdZt8cHWbfHO60beicGLW5Z8eEVzRALpcLFoO6JsW/3LFd9OZwp21D43ujwxzbnCb9lpQQsc3pdIB3qfRlZraZJuKjQraEmFgdHe7IjwqzbYkOs2+OCrVtiI2N2DywV/v/EVGty5VIYKaTj+k/dUC3dptDHeaG6HBHkE64Y1u409jUOTFqS1RUONhqvgdCc/lc0AGtenXvEDj+iJ5XTLr3wg+BVCMl/ULKmZyn4OpPaKbeTgiCfuBBAQ/gcvUnr3emACYHPstaeOJ/Mud6Z89ZFk6m2BH4bKTTtUuiGjWk6zXvPXTZWwyXTEkfK1pHxysBr3/WL7mpz3zww7TpWYuiYIidAqxE0DoADOjXcfWyD+89lojK3W43NQIhWNxBGgDZDMG+gDLufn7KyG3b627LWrBqRGmlP6GuohwwbejauT2G92n36tSnJlx79dWTzMmTg30gGvtPtEgZaWgyhwFXPkxhkfejvtoXGhZuG9qv45cfPHjubZ07dVpz9aQF5qT0FNUEjM3obzsquGnC5MnitQkTAus3bOt7yaMfv5CzcuvYutpajaaxS2Y2heChA3os9Ew45d6Tj06ekZ4+yZw0KV03XsgGOjucv8wsm17W6dPXmOPH9/Yxs+Oqh9+f8lnWsvGl28s1SSG5hU5UZktTRESIPnXUoA/ef+Syy4hINS0b2tNmNlY3hzltuDTj3au+ylr2wsa8UicZ+F2VbUpHMYWFOnDKyP4fZT5x1aVE5G9Kp2m19C4bS0TEoXYDNzw99VLvt7+8tG7r9lASzA0e9R3efW0pKyou1jj9mD7j3334sumpqbON7OwxVtMAADPLUIepaptEog0CpvyYk/Ra5q8TlqzdcvO2kqoIrqn2kd1pP+noPj9/898bxqR5vYFkl4ubU973uFwuyZmZ1N/18Ecr1xedQ0IprbQgMumYwd2qxh7Z59SHrzn1Bw2XZM7ca2p5cB/ShIRX3T/p65O+nZv7yc9L14cAiknsru0zM5MwqWtCRN2pxw++8a0HLnq9ui6wY5/3tN9NJJ3+dv6KUY+89t2keYvW9rUsP5NpUqNXt6XJgtCWYmdYJPXuHDvz/itPcrtOGDa3+ZDGjkenYOiMw0695ZXnF68tvXLbxk0sHSb0HlI1GuhoR2iE6NEhJvueK0948F/jjvyhhXRCz7njtScXrCm6bvO6jRAOk3dPCSEFCJnSN2nBr/+756jRGRmU7WlIjHO7BXk8+vTrnxu3eFP5a0mxIZtiw0M/v+myUz4+/dg+m+uaAC1zRs7RL0+d41m8ctuJkISRAzvf9MXz1/43LS2NvF5vi/PaGy8FM4ede+dr+VO/mh9mhNpZMQiaFfst2bFzO+uCccNffe6WM28IqpHB37unfbCbAtdM9L7u/Tbn8rxtxYLsUmMv8UoCa+2zqFP3LjS0Z/wbnz0z4WYiqsaeDJHg3yPEbvDdL31x0+vTfnp0c1FlKHRAiV1qFVrkoWcGhGFQXXWFtWxN/tj7Xvz8u6s875wRZMW7i9hgmizxyx/NHnDSDS8v/+anlVdu27zZEg7bHoH1Ox0p6murrJXr81PdL3317QX3vn5OkB3v3sQ22MyD8P43c/qOv+mVpV/8sOK6zes3WsJh4+ZyjdiyKCIiFMP6dXmIiBSydnyRgMej3/xyfvsV2yq+2rShoNO8xRtGZi3a8OSEjLd+S73y+W+e/eD74+1m8CvTTkyZN/uVG04e1Lu9+9Rjen+S/dotLxARZ2ZmtsoH1PQB84rL6yFl0MRnBghSOkzeuq3IePXjH/497sZXvl61bssg5p3TkBv32+3OoKUrNw0fPeG/370xZc6VefnFJB0GYx+BcAYJ4bBhy8bN1lc/rLhy/M2vLn/iza8GgoibaxzszsggAEhNf+7VyZ/nPL95c2Go4IAmor1mdOw7tkjBtDn2+UWnHt3pwctG33/12SMfbWxF9PsNAlIvfT5ydX7ByoKSmvZgyxJStLLJByuuD1D7rp3FnReNfPTWC0+4fzc6DLiufyn05w15K7YUVXWG9ltCymbpEKA1pOjdKWbJ6k88wyktjdHAZRpF7w0TM1Nn5Ky7S9fXnpBXUW+rrqoF6uqAkBAkxUdgdErvr5+/59yr2oWF5fNeuWnr4vCpqW4j16jJLy6rjRPE3DRvjYhYByzLHhJpjjuq+0+fPXvN2LQ0r7VTbwlXpuRMl33c9S/+lJWzaajfVx0QhmxVNTkFz9bSARhHDuu27ee37xxAhIqgL66BgzXoh0dd+sTDi9aX3+8rL/EJu2nbU9Jg62KLzCAhJBlSW/46VFX75gFAbv9ihsslg2ESEED84YtXmhFhjlAK+LQ0Wl/aRSQkGZKV34ftFbVzASA3t5hdDXTcDAIRZ750vREV4QyDv14bhtwjHa2Z7U4Hjhrc/fNgTpZrx//zZro0Ut3Gi3elZa+fes/4Z249a8CE04+4PSW587eduiVBECFvS6GV+c2C8Sem/3e5Z/KXlwFgl9ttA9xif0ezuN3Bz9322LlDLS2daKj02E10SkGKlaUVzyEi3/romcLlypRwZUqXK1OmFq0gIqqt9wXmWqwsEg0QbWWAmokgnXbNzIsAVMPlFY3ghcslU09NZADo0y2xSLAFMg2jpSnmooVPoUGGTIoNW3vLxcf/6nK5pDfNC3i9yutNU0Skk11uW2J4eEliXNTnIiSMGhMGWxs0ZZKiXXTIpoevOXUO3G7hhRfeBjoeIt3z5BvsACo6xUdPM8PCSe2BTjCSYFFibJgvbeywzwAQZ7q4yRu4sSjBr4DTRg9b88xtac+syLz35NsuP2nsqJQe06MTYg1LWViycHXU+zNXvPVZ1sITvR6PPzOzP+13CGp0lgCAuQvXpdidzlBobdEuoWsiAitlxEbYjVFDO3/EzFRXlhgsAvamKa83TRWPhmBmGtyr8wcxESEGKyX2J9bISgmH0y56d233ERFZyVghiYjhTVPwelV2bn92u93i/DFHTIkLt1WzYkEtJCRaduZgcjjQKSHiWyKq8nq92iCvSn/0/WuvePTjx5g5Jtfr8RMRde8QNzXEaRJr3eq4JQOabHZKigufSUQV8Hwppder/v1U5pWXPPThRGaOX/vNiz4ion5d2k0Lc9qItZZ79PpLm+icEL72/0YOXLjDzG4YcXf6TS/3GXfTq18dc8XTl733xbzRIY7glJV6v8LNrlHfz3395vG3Xjj6ugF9u2wJi28vnMJ6u9+AzvPhcsnG4PP+LM/LLzMz05wl6zoWl5SBDEPw7qxLk2FHRIi59LSjjlxHRMj1evw3PDMtteeZnreueeKjo3I9Hj8R4dKxw1YYQi8jwyQwWqv/MUGIUBsVjxrcLxuAzPV6/I++8XV86oQXPr80490rjSlpyuPx6J91YXFURMhPsNmpMaJwwOAiAthSiI0IUT07tfsUAAo3FLY745ZXPv9w+sKXp8xYfM+YCc/PfvyVT7oC0EP6dfkpKtRWTBCCWqGfNNKJDneqzu1jPw3u8QLDde8bU//3xfzXp81ccudxVz6bfd9/PuxBgB7Wr/3P0WFmAUEEi5x3196UIzQUTrv9IykEI9XdAEIXmFkuW5/30rdz14yfv3zzW+43Z8zuevI92Ve437mGmdsTAL9KNx+4evwrb9537rHjRyW/evHZKbf1jourdCcn8wHpXV6vNgWx026crQIWSOx+BsxglhKxUaFf9+sXX8XM4a67Xn/k0xk5Weu3br/si+8Xzzv91lfdzOwYPrxHxcjB3QuZBHErn4sBzaaNuybGrE4/56itDpuhLrjv7ctf+eTnpT8tXHfap7OWvj7+5pc/37ChsL1nzBgrItThtdttLc6r23dpGaA1k+jZKW7Tli8f6up+9evxX/28+t2fF6+PVdrPYFbQZHTr0r7muKE9b5v21FWTksbe8eZvhdWXk+WzQC0LjhOgtSbRJSk6v+Dbx5Jufipz9JQfVj60paD8OH9dtQZBQ5HRqWN83YhB3e6e8vgVLw4+1/PfpVvKryPLp0C/B7KJAO1XVrukdvRw+kkXpp99XKZ79mzDM2aManD12FP+9cTP24rKB26vqpOBqhoFu0NGR0YguVt8Sc8u7a756JFLpvoCB7dy3s0sPES8aOWGLmfc8eYvm7cUxQpD0C7KPLQ/oNontZc3p40a1LdPQvTT72Q9tWx1wYiK0mIt7CZrf4CiYuNFcs/2P91zxQm3LVy2KfaFKfO+Li0qsoRhGNxCjLHWliM0wvj3OUfe/9TN41476fq33v15+ZZxVVXVIGKLmaUUNjp6WM/txw1IPPvB9NM29zv/qdyN67eYYg99+lul0DODpWFDl8QY79l3vpYx8X+zPpmT81us5oBFQhBJaQib0Bs25Yd+Pmflq8dc/uTUtDGDl4U5THBLYtZNbpEwbOgcHzHlcve7977+xYLp67eWHOevr7GEYQgSQTpbthY5Z8xf+5/RVz/7xTmpg1ZGhdrBWtEuX8aQ0hDKX9Grd/TXANAIrIZ3+Jd9fP/Q/9x6xojBPTt8IENChZAcKCsp9s+Znxv3yXcLpoy9/qU5381fORxwixtu+I/9YDRpy/V6CQB/PHPpSVX1Oj6oUu+ibwEMJtE5ISKvorZm7M2Peqf/tHDtiIry0oBw2AQDUthtorysNDBv6fqR1z304XcVNTU9E2OcRWDIlhbfNeSIyfhIR0VcZJhvyIX/XT5j/ppxVVWVLAQYRAZJQZoD1k+/rop5acq87/49MfO67u0jNkEasiG54MA4FzPDbrOhXXTotqIKX4f6uloISbv5lBp6HTDIECMG98BvG7aivKIWwhAt4qLMzKZpUmJM2LaSKn+H2uoakKCdONIOOkozWIiUQT2wcUs+SsuqIQy5IyVEELGqD9BJowYWf/vSDd2IqKZpRCFoIxGY2X7ExU8sXJC7pR9YqfjYSOkPKFSUVQHCxNije1fMePnGLhkZGVUZGRkH3mkm6JnH+Bv/+830eb+dQKw0dsmfJwBaa3RqH8MVtQGq3F4BskkNEjtvZKOLKKBlZGwkQmzE+UUVRLLFqi4ziELsRiUR2Wqq/Q6S3GyvjeDZagqLjERchA0btxRDSNEsf2wV5yIi+Px+bC6s6FBfV6tIUPPOSgYJQwoSWv/ya64ur6oDSdHiXG8iIssKYHNhRYfammpNknhXYP3uGRFCSOicnJW6tLymgQ43SdliS4SGYeX6vEwAtUhJN5sCY3RqhgTA/7r/nVFr8iv7wQr47SHhcljfzg9cdupRY/r26lQQGh4GrXQGgGpPbi4dKLDcbreA16t/ylnfYcX6gpHw14Oa+30ASApsySulyopKLewNTtFdNzLojJLCLrmivEK3Elg7mFetz4qoqfM7hAkGNd/EhRlEhuDqigq1cVMhyBAtErxGCw8+eM9p7wWcDfWTQjrt2L/6N4IgZiaxDw9z8JLsiQ5rht1monunuGoi4pT0ScjJ+f3/Zyf0ZyLCgtz1N1VUVDNIyi7tIvLev/GkF+J69650v5bZf+M23z1vu//1XyJSjeGPA1meLAgA1j0vTzs1v6zOAUOqhqBwsz9QmAYAFvvaxoZLHSwY3Y89JwRZxT59VwwiKSQ1kRAHx88V/L3UnKu5OZ/HgRRW7qnCulV0mGFIgSG9uxAApDSVTJmZEt409d43P4+q9unxqKu1wqOj5Oih3V6M6927MtnltnmuTtv+TsbFdzQWwx5omyhmJldCLjNzaF5JxT1WXT325SwKVkI3c2DNfCwYPTqgCkHaQ0Jhs8/V0rX/9W/BsiytA4FDVCnQVOBr1v5W0GHAZkj07ZrgxC7oWj+zTDCzmDpjkWt7ZT2DhOjVIbJw0v3/ehlwixWZGQGACa5MebA6LY8enSG9Xq8af+N/Lyso93dkVhbv596ret+hq/zZObpxwNx6v8HFloXY2CjRpVOiYH8AdIgAxpaFqMgI6tY1qcV0SEDW1tZgY37JtwBQNjO68UAoJ5h/JXLX5Z1eV15B4bExclifDs8RUWWqGyKoWzV4qA9CYzVmFqNHQ+eVlCRvKqx4tLasXAlDyP34HkhBGDE8WfAh7BlFAAsQuneMq5YE/x8OLiJoYoluidFLRyR3+kyajqC/6xAwLWKJjnFhK48b0m2qYXOgRXSEEPX19ZiY8dHioN9yBTcEqwUAXPrgG8fll9cnAtAd45zFrz1w8WTALbIzMg76bxg+YYL0eDz6Ks8H963ZWhZJhuBWt39qCJdHhDp9pxzd56awEHswPfwQ3GfNzIbN1OecMPTx+OjwUlaM5pzUhwxcWrM2wkI5KTbqsyP7d306PCqc9pYnfwCsWYmQEI6Pjfj6tDEDn4iKiYC2dMv3tM6306Z44QUBWLmx9Oya6nrTERkhenZMeIaIylJTIQ52C063e7aRM3ly4PrHPzjrx6VbXYHaagUpWl9xBdZEEu3jolZlpP/f/9rFRKwlEiAc3OLYoO9Li8SYUP+TN539XFJc5HxpczBrqD8EXA0BYdEu0kkjh/WcftslY3/tEGWvJM1S7Gfx5N7oxEU6aVif7l+fO3rYwk6xjlIwJO0j65M1q9DQUDw5+cbjASDV3fA7vV6teVtISXn1KSpgcYTT2HpKn86TAabsrIPLtdzMwuMZY9369Ptxn2Qtf7q6ptYUkmh/6vC1gjYdDgzsmfgtEW3v3aXdDLLZoTUOKriYoYTNyV06xH4PoH5g305fOUPsxFrTH8S5WEOYlBQX9tsdl4xdASDQq0vC1+QIYaUP5k0K0kmMCdn49C2piwBgQM9OX9jCwqHUPtikZm1zOBBiM0YAQJ+kJHK5MiUATn8o64iKGl83Qxp01IDO86+/7tQyIO2gci232y08wYql6F9WFX1XUFLZnYIe5v26zGQp2T4mBOOPGuhlZho1uNfHCVEhTEqJg6XrBjMxNEWEh9ARfbp9REQ84bThM9tHh5SThhD7sT9ib2IegAKz9fsLFiv220JDMLRvh++JqJKI9DHDen4UHx1GsJQiwGr6GQLUvjaAdqPDFmv4pc2u+3ZpN5MoqoyI9BH9Or0XEWIEoFkT74UOAYGAhbVbioIFqjmAt2gFAcD2quoLt1fWi7AIR82Afp0eY2ZyuVwH8fazyAIEM4emP/rB978u2zSUdcBiIfbpI2StmZW2mr60Un4mqTrGRyy95IwRK4hGy7uvPCknMSZsDWuhtVb+XT/Deu/OoAY6amc6OoCA0u2inMU3ukbNBtxi5NB+G3t2jJnHwlBKKT8rtTsd3g8nqtYakHYpTAONfS8IgFZsRDgM1TEhamLQuZhBd1w0dq73u0VlhcVV0TCbekgIWqlgG29TNus5Ya3BwiaFzWxCh6B9fqNTx3Y4bdSAKR89zuRyZ5g3XXjCrB5nPJhbWh05mHWgabh3ZzogWEpjxdo82YCtxoM3u556fw9igb6dYzc9e8PZCzHBIi8Ojnhxu92iQWTr5BXiwQ2FNUN9dbUBYdv3vCFDEhyOUBKG3WjqKtZaITQsEin9On1JRHU9T77BTkQ1lzz49jdbtgdu9NVVo9HnTAhq3ipQj3qfD83NkCQiOJ0OIsMmpTR+d0mzBhlODO2TuKhL57htPU++wb72G/hT+nby/lZQf0pRfqEhbcGq62AaCiHgq4UVCMDagyAxmlHqoAOae3VPrLObuHX5gnVbRHREFARbpJlBUhhQFQ9cdeomXNX4GU/x+Jv+eyYktaeAjzVrEiSlDgT8Qwd2ckaGRTyX/cvqWBK/O0mDVTmau3dJ8EWGOO5ctHjdejMqNEpZlkUMDUGk/FV1F548YuZFIPZ6gn0RjhnS/ca1X+e0h7YYjXT8/sDAvh1s7ePjnv3+55UJkMwBS+Hn5RsDAFCxeblA9ou+l94f1UVplUpCc0JMxPN1vgCNHp2xo/nIgaxJkyaZEyZMCDBzzJl3vv7Kl98vSlOs9b6AFSxQ0So8MkoeO6iLV2r9dnmdL8I0TYJiFbAs7tIxkQZ17TwTAC6a/kLAQy/QwJ7fPeon25z8rflsGgZBkrR8fh0T4ajyaXHNj0s2nFZVXqkaS74abpc2DZOOGNh11sCu7d5etq6g3pSGCbDSzBwaEk49erSbr5kpAwh46EW+yTX2m7Jafd7SFYIddoOIWNTXW+ywibJePTqkf5a9/Jy8bYWKzN07JDYfuGatbXYn2sdGfP/0dafc7hp/9NJm+PiOSpFdy8waE81DHSaOvuzpjxas2ppWUVHBJKTgXUIPBqQe1L9b7pM3n/rA8cP6ftb08y200BHqMDDyyufey1m19aLS0nItTUmWT4kxR/ddNevVm1OI0nyAVz35zjd33z955uPRTlH5zu2XdDv55AHbsZfS+5aulPRJZs7kCYGtW3Njr3n6hxmzczYMra0qV7SXFOzmHPJOh638rDGDPvA+duUNgf14IrsBnH77G69+PnvJ+f5AIKKBszet3wQrpUNDw3RK345Tf37njvP3J60o3CFxwr9fuXrewjUTC8uroxoS9yjoBdpX4JqE8PnqadO27Sfe/sp3S0Ze+fzlzGwA6Wayy22DyyWbHggRscuVKZHqNpDssjGAe1/+ZFz3sx4qnDn/t/PKyysJcmdgNYar/KzkguUbBl5019ufXvHw+08zcxgDOPmG/9iDXvKd1w46PU+2M4CHX5s+uu+5j237du6qf5WUlhEMIbVmgiDkFZW1BxAAvAwAH323KIoMB7eLjfh23Lj+lampbuNAgNVQKUM5kycEnn7vu9NHXZf5/VdzcofWVJYF0HJgBXecIOrqfDGfZq/+d7/zn5j14fQFxwEAkl02t3u2sWvOPjfMNESyywYAr38+54TuZz320xc/rZ7g8/sjG1KnaVe9DlKK6poaIztn3XnJaY8VPjD5i3FBMm5b6h7opLrdRrLLbQOABbkbEwdf9OQ3Py3Lm1xYUh4tBGjPIbu9pNwQoLRfISw6Sh6RnPTFrFduOoeIAs0zl2ANncNm4IJ733r4k9lLbiuvqnMSaYsAg/fhlNX1AY5NTJIDukTN+PiRC69p3779+r3QgcNm8GUZ77ozZyy6fXtFbRhBWSTIaOwiowNatWsfF3j73vPPPCV14HfMHDrovEe+W7Ot6uizRvW+4MPHr/pof6e1ut1u4cnNJXiDMx1veW7aM1Nm5Px7a2FwAu3+zh1qEJGWsDmMnolRNSNTevzrg4cv/7Q+oHaTDo3/HeIwcd69b577U87a/63dtt3Oyt9QdbV3OqxhMYQRFe6sc5049Jm33f96IKAYzdVIut1u8ZDHo+9/aVrqd79unDJ/8do4sAoIc/dqoxan3AQT06SsrirXWb+sPa3PuY8sfP3Tn8cAjF2HgbvdGYRkly1p3F1vfDLnt/vLyysdgrTGPoDVcKOEcNhkaVFBIHvB2hPPue/DZa9M++mMRn/RzpwrTSAl3eh0yj0ve7NXZ2wvrQgTpDSIft9QBkCsAiwc7337SxcA/EVOni7aXpkSYueS08YM/QEMysx06dZzKpf0eDxaeL3q+Q9nnTAq/T8L35g2799btxVpCj7HfndnZgbIEAZbPvXbum2h38xd+8mF97/9MjObaWnenfYhIyODmNnhuuu1t6fP+c27Zt1WG9hSJPYOrB0cjGAI0rq8vMrpnZV7/zGXP/M+Mzvc7oyduFCq2214PB6+3PPerZM/XzR9/sLVcUKwag5YrfZzMQNCGoJ1wNpWUjPg65+XSIDYk+ulYGFmsMzK4/Hot568PcZicUV5Xr6SpsGtCc4yM4RpmIDyL1idF5JfWJYMgHO9XgqKgCAdr9er5r5zf7hiurZ0y1YlbcZu3ZAZgJBSbC8tx5bCsuEA09JlSwZV1mujc0LUqotOSskDuURLcrTczMGSrgZQmcKr/vP+rJSjr3j2vYcnT//6x5w1/auqKy1hswkcjK7MjGCelsMM5BWVqw3bSjoB0N6iFeR2u0VjiyZPbn8CoFatL+hcUFSmhN3W6p5lDAhpSlVeXGpV1tYdBcD0eBqyOFxBOtX5+QSAK2rqepRU1DjJpAATWnSBWrQZBDApLbu3D6+c+nj6agBIH9tdeDwe7fF4NKWlCZcrU172fyPKO8ZHzJEOh9zP4CqT0ma3dhHVl55+7PsAEF1WJoiIm9I5un+n6m6J0bOMkJC90RGARml5zYkA8ZIVW4ZGxsSL/t3bf6cBQmryXqrAG/QZuKSHSHu9aUrCq256MnPI0Vc8++HT7834Zf6yTf8qLau0CVKa9lCUe0ChL8uSUVGh8qgBXd8gIpXeJ4k8Ho/2pqUpImJXMiQRBQb27vRGWESo1Gr/vOhKaTbDQ40eHePfJaKqlElJkojQUDLIKSnpAIAjB3V5LSHSAQ4o46CWlmnNmu0OJMVFzAGwtculbsfkCcMDmTMXdZj43vd9gvWLEwUR1XdOivnccDia9bG0gHtptjnQLjr01+5J0Vu7pLodkydMCMyev7z9E+981y9IZ6YgIn+Pzu0+NZ3OoD9uT3dCWXpraU1s9uJV3TZtKogP1NXWJXdL/IwAdl3fn38HklvA7RbBgeagIJjHWAZ5VX0997rzhS+vHH7xxOnvfjZ3wU/LNp+/Jb9UKOVXJAUfih7ywYC9ENGhsuS8UUfNTUlPNydPnhBg5vjbXp55CjNHez1p/pT0dPOUkQOyo0KMMgJaVW3VqHtBaxkTZuNB3RI/TXW7jZwJEwKGAJ95++snffDZvHaTJwwP9Dz5BvsdF520JiLUtpwMG9DChr/GvrkWQSsLkVFR1DUpbmqDKKm/43nvqbc+M+Vpm93e6erH3n9s8j0XPk5ESOmb+OUPOeseyatSBsnWtTpkpTksKoQ6tIue2uCMrL/3hWmnXPHIx08qGD0vyXj3yXfcFz9ENBlHDOg6ffqcFf4tFdpGcvfsyGBFOumaeiv8P+9l/1/X7knnblu01nr4+tOWwuWSXq8XSHUbDQmB3OBs1SF2idXbrI6TvV+cPnXm4v4plzx2aV5xVWh5VQ1Y+UFEljClwXxw2nPuIfCl2eYQ7WPDs4cMSSwiAHc/k9nz2Cuf/WxDfnXy3F8WL/Z+9cu9af83Yvo5kydvHXL+w79sLbadBLZ0a0QjM2sybCIixL70uL7d1j147WnWnDmLEyZOnf9hds664xeu2rzyjuen3fnUzWd/SfSib/TVz05fk1cxgP31LcoeaMHUMrC2NLp0aFc99ZkLu6f06VPruueNJ3/8de31hdsrAWUhNDwcY0b0zDnvpOTTLjslNb/X2RkLVm0uTSG2WqwHEIF1QHNSYmz9ized3fPsk1NKL3rgnYmz56+6Ob80SMcZGoYxw3suOWlkr9NvSztxc/J5D/+0bF3xsaQDqrl8++B3Mvr3TtocGhbmqC0vn778k4cu3zVcs2ZzRTfPpMx4my3E9Wvu+uQ6nx5ZWeMPK66oCQ64EhSclgYI/gMGOmilVXh0tOzfOeaUeW/fMePCB97595yF6x7fvLXICVYBSNNM7tUJyd3aX+OdePnkwec9evbagqoptZXlFrUm64JhsWE3BveIu3/Jh/c/evVD75//9c+rHigorU5WdTUBGKbZPiYcxwzr8fLUiVfdfO4tr/X+fum6xeWl5SSMJs7ZPViLRgseQMN0yHYxzs9JhSQffeXzLy7/LW9QdWW5EqZBkJJqaqr1lz+sSFm2tuinW56fevu61VteWldQ9aZVH+BWZI9qGDaZGBs6q3dHu9H77Ie+KKjwn1RVXKKEzSCYBtXV1uiv5+QOXrKm4IcrHn3/bl95zUurt1YcG6j1A82n/xJJ4LdNhV1CQ+uQ3DWm5BXv7NHPfZAlBvfucJTfEsP7nJWR5HTaj1y1MR/SDEFtdQ2g/ABgkSFBdkOCIQ+sErZVSjZDSBFqo7X/vfXM8hOue+GbnJX5YyvKtkPYpAakCdY6N3cdbyutfnXEJU+NffPBiz654MH3K9aUlYWRQdySPhYN9ZHUMTEBd18ybvnbUaEvemcv+Xd5ZS2ILSVshglWuqColL+bq647+qrnj33yhlPv/uWeDQsrTNsI5oDelwGz79IyrbXDGSJ6doyZUl5RO25raXU4LP9OHVUomIqsWJgy1AY++dgBK35YtG5AcXE5C1O2qJKOtdY2h1P07BA9raa2fvSmopoYWL6dO7cQAZoVk5ROg3DKcQOWzVu2YWB+/nYWtj3TYWaGUoiLj6XI8BDkFVfA57dAQkD5/IC/HrCbgEZASBIgCDAOyzDvBg5OQ5I7Vkhh2HNytzrAlhKGEDt3SyRoSykIUw5P7lBbXVuvVq0vCG9pKR8RQfv86NOzAzokRJf/kLM+yrJ8TJJ2asHUQCcAMs1uHaMCSXFR9XMWrgkXZvN0Wj2ehQgwTAf8tbUgg/aCWNasWQjDDmKr1YUaBMCw7ZsOBYdbCjJsEKxaRocIHLA0lGaYRuPsQiYSRAR5uCem7c7BCAhYIFNoItHs0M/goFWtOaAFTAOtThilhobHlgYMoWiv1V2s2WIBIpDcM2NsnVhs8HX5fbVaBHuair1GMQQxa/9+WVGMltHhBjrQAdYtpcMMYUoB02ii/AcHFvKfcG4bgZlsBph5j9Nkg39PQth2eGSotRtORCCb5H0bKCSE2RhLbhkdo+XsWoiW9p/AAZSNHEo6zPiDNKeDg6+WWtoHOpK5pZ9vLZ2/zZy/tvXnWy2suEbbwM+2tRMiWsJV9wkuZgZbB14g2bb+Ros1yBAHCC5mOB02JMVHVrW2a13b+juCikGC4LeUY0tBuX1f+usewSWIoHwB9OzVEe97rhrpEJUbt9XUCGdoaBvI/qErr6zMHBDdI/DVr4sfcb/+/Q2V27cHyBDmAelcUumK3n17V7Ztb5uyBYCf/d/M+pZkRrTIWqzTAQPghto/prbXP/PlcmeawVkA3CLctOhNNpudAeLk5BXBJh1tr3/kKzqpjFvTnMXYX/7IzJQzYcJ+fT4FABITFbVgfNxst9sIT0o6YFM1JTpa004j8EAL0tONwy1nUgBg7Nidno3dboGkJJlzsL4/L69Fe31Y/FzNezqIgYM/NH3XNcbjsQ7RV/PwyZMD+DOsyZN33tsgEP7yhlOrwdVYdVI3b15XNWfOpZWbN2vYbAK6ZXuhtdZxcXGiundvb1xaWi43TA7bjY7bLZCRQWUffHC+LTS0p1VXp3ULZf1Ocp9Z28LDRW1R0fLYLVs+QUYGiEjze+9FFG/ZcpOurxeCiDXz4XDk6aiwMFHlcCyJv/HGT3n2bIPGjLEqP/roWFtY2Nj6ykqlD2BmuACUIyJC1gqRFTN+fDYzC2rN6L4/nHN5vQKA8m3Y0Cvk008z9PLlMJzOFje+18wgmw2VPXsqEOVmZWWJXW9pI+D4hhs61L/11v+sZcvAraCx03cBsCwL5UlJKnby5DgAFQCw4ZNPokOWL39IVFaChcDhQJaldXAvOnb8BMCnebffbgNgFdx779huzBk1SsE4AOe1pTXCnE6UJSZOBJCdM3y4/CM54n6LRR0I+ItLSgJl5eVK1NXJVrRtVj6lpBUaejZr/VjG3m8S1VRWBnyFhSC7nfenlQ8TsfT7yYiIqG0izmHV1qrtJSX1XFkpEYyV/+H4ImZLG4ahw8PLAUAVFjIABAoKaooCgUBZUO0wD8DpGSCbzbRMs/ovIRZ3bIwQRIZhQggBw2gNuMx6Zh1WVZVceMcdAzKAZRl7EI0NdAQJIWGaTPvTJ4qICSCSO/fRJq2Dz28YkoUIVtr+8R5vIsMwyDB2Fn2mKUgIM1j2eUDgAtntJpnmYUlQEIdhQwEptayqstcuW3YGAZzl8Yh9fuZAaf7V1sF65sP42w9Pyo0QFPD7Edi27UxmdhQ3zkltW3+rdbjyuWSN1pCVlcO2P/xwjzRAwe1uA1cbuHZiudZ+dYlhBkkZCKms5KoFC85hgHK+/HJ3k7uuDgDUAaf7EIGb7wKt/oypRALQfJDaaDIRiz/Q/XBwwMUsIgzDgFIGM1ut3QwWQtbV1pJ/69azwExf5OTsfvihoSJUShtrDRDtHxCINPv9SgoRBfl7ZYE0DBFCZONAoBFk+3OYem8v3s+camZ2Sp+PeH8vb4Mhw8yW9PvJ0jrkrwGutDTNAEV16vRLRVLSUyFdu1ZGS2kIv5800GJzjgBRD2ijtLT/9jfeSPYAmhsnw2dkBGvvoqOrVb9+nzo7dUJoIGBov99qMcAayt2cfr+M7NxZGr16vY+BA32NgbKYyy6rsnr3/tQRH49wZkNbVuuGYTLDBoi9vcxW6pFKButMncOHL1P9+vkjhHDC7yduxb4CgCZiKEXhRE6rWzcrbPDgxQCQ0r27/lODa0eIfMyY6g7Tp98Z/cILAwPHHPO8vXPnqjAhhGpFVQGEUM6qKrPq66/PZGZC0KEKIuKG1/aOb711VtS11x5jGzbs0/YdOhgUCID3BbDgjGiOdDql/cgjlznvvvuSLtOm/YuIahufPyotbXuPefPOirrggmNFcvLU0OhobWMm3VKASan9RFv9wJY9vQJKlbQGFF27drWYmbr98MOntpdfHmSceOJkR6dOdU6thWph8w0NsEMpsoeH14mhQ9+gW24Z3PH99zMZIPJ61Z+bc/0OMsxOTTViTj99c9fvvrsl6emnB9kGD/4ozDT3pN/sji8pZU11Naz8/HPIbmfKzt7tc5lKydh7752XtGzZWeYNN1xvJiRUCMviPYrhILBghIeTHjHi2g4//DAk5rrr3stsJoySaVky9tln53ZctOjckHHjjjXCw5c7mMF78WIzERtKQcbGliU8+GDyitrabkW1td1X1NZ2a3yZo0b1WlFb2y3m5ptvi46LYw4EWsxxiYjZsih+5MjVSZ99NqHDvfcODT3uuK/DbTbe174yEdssi+2DB2+NvemmkZ3mzbsq6corc91KtbpJyWEFFwMYk51tMTPNPfJIp/Osszb6+/efH+p0EumWBRoJED6ttb2oqM/2V14ZzGiIKTaVwoDKdLmku6rKiLrttpf95eW/hBoG7bXTilIQsbHo/NBDXiLS7Hbb0rD7FIg0QLHbLRZobbZ/552ffWFhefaGatmWPH/cccdZaYAaA1hpgGp89Z4+3Z8GqMQnnvjGFxtbKYND3rk10sHtdosNo0Y5HFddtdo4++ylzpAQsc/WQVqrcLtd1Pp8n0Tff//CDZ07O9jtFp7DFAQ/YFcEEbFt0CCL3W4h6upCW1W5zAxtmiy2b3dW//DD6QQwPJ7drnia16tGp6aCXS7JSrUsqqA1Kr7/PrrBf7bHzAryePR6QGe6XFIwm6263iUlBIDcwX1s7EFKTIRMl0uSzVZEnTv/GGKzUWtnI3k8Hl3ap49it1twZWVIS/eVAQifz8aAKI2LOyypNgfdz0Uej8Z+mLwkBPnq6thav/4MZnbs6YYXZ2czeb2qNeydTbPF708L6iP71bAuI/i5HS8CuHt0tOBAgBz9+081IiMZSu3/vgrRqn1tCGcd9pSdw14US4CosSygqCjF//nnPaip1fgXXimTJlkEcMI993xdk5BQT0oZkJIhBHa8iH7/9zYn6iFYzCDDUPaiIhR/8805ANCsQ/UvtoiIOTXVQFjYdiMh4ftQrZWqqvLrmhq141Vbq3R1tdJ1dX/LiirjT/EUUor62lpg9eozmflxEKm/xe4mJDARqa133jkluq7uVLO2VsomVqNiljF2OwrbtQvDqlXA6NFAdnYbuA62aKxTikPy8wdXz53bJxxYzntJw/nLcK8Gv1KHiRM/spYtK46orATkTkyZ7RERFOvzbcNnnwEZGQoeTxu4DrZohJRWSEmJUTVlypnMvCJnwoQ/NGvyEItIH4CvWyJK28TioTgAw5DVZWVkrFlzLjmdj6C+PvB32WRmpob08N1XcBwf02EKLv8jwMXMpAyDeeHChK0ffBDb8eyzS3cdSfJXVu4BKPzD1p/GBiaAAswqNBBIVO+8M5aZKWv0aIm21Qaug2Q1UqC6Gv78/POIiIuzs9v6grWB66DJD1GnFFNJyXHVmZntXYDmw1NPePDEfTN18W3gOhzYYiZLCO2orIwr/fTTVAIYaWl/afd1cx09/ingMv50hyEEc10dqw0bXMw8BaNH/yVvOgcbMgtMnhy9OisL4YmJQHU1wsPCsHnLlsoBXq+/DVx/vGiU1T4fidLSk7BiRSRlZ29ngLx/JWClphr0ww/W+osvvjJ0wYLnuKLCqjIMA8yKhJBS67MBfMuApL+xFfnnEznMpA3DCikrC8t78cVxAIDU1D+n1bh5s2iYKSm44bUgJcVEdrYqeOml7vKXX57dvnp1CJeVRXBRUYhVXByui4pCuKjIwD9g/Tn1GSGAmhqqX7XqXBgGvH9Cq5GIGNdfX0PB/HbV8KcenpMTEE4nV7755ut606ZQFRKiWEpWhsEwDEsZBrNh/CP0rj/lDWIiWeP3s1FUNIYDgSgiKl+QkmKiuQqhw6NPgQMBY32fPgMX22z1NgB+ANJmk8Lvt2w9eowL2bhxTBmRImbZoNijYfz2P8ZaPHzgapx03ryFRRaRFVleHlnw73+fzMwfrznllD8FlyVmUlICZWVR/rKyJXYjuIV2ANAaMAzQhg0o11qTEP9oJ/DhA5fDwVxXB5KSdutnEMzxIn9ZmeD169OI6KPlf0ITfk/BwHpmTUT/+Okkf/wGCAHt8yFq7FiyJySQ9u9hViKRqFWKsXXrsdW5uYn9AeuvMmiB2sbeHDaFXjuIwLGxuYiNXeXcAxNoEI3aVlqaUPXuu6MIbUMW2sC1b12LbVKC6+q22nv0mO4wzeYHcjNDGAZb5eXsW7kyjZnFX7IVUhu4/nA7Hlxfb0SNGzeVIiMtWFbzyr0QRo3PR74tW05CYWF8ow+g7djawLXHpbQGAeHhV101vy42tsBkNprVj7WGklKFFhSElbzxxokN4GrTZ9rAtQ/pSGSSzWaJpKQvQx0OQOtmfVhkGMwVFahZuPAc2GyAUm2ysQ1c+xaNsCyEpKRMsyIiGEo1+ywshKyur4feuvUE9vnsSin/n0UuslKq2RezahsheHhNZg0itHvssTn+hIRthtayuYptYiYlhBVWUBBa+eGHY8myKuSfoIiUAERGRMioyMgdr8b/DrfbJSvF/3SAHU4PPSPo3a43u3b90ly7dkKZZe3ufGQGTBOqtFSUvvhiP+F0CtaHzyvBRGxYFiEhoVIPHHiJrqnxgZlAxJpICmZlJCaeEDpz5u01lZWKTFP+U63cwx5bJCJdPHFiZn1OzjWcny/IZmuuA7GotyxYFRXnweksU7W1h9VoJACw2fxdZsz4DIFAc1buNxvHjUuOzM4eX6G1j4gMDn6uUWFsC1z/ESsTkHF33rlwvde7wVFQ0M0XzC4QuwBQ1GoNWVY2SIaHU3VlJWCzHV6OwEzs9Ybj/fdrUVRESEgIPsz69QI5Obru3nuvLSooWBSdmxvjNwwIABYgw4lQpbX5ZwHA3tKu6QAvwuEFFzO6A4KIKjaff/53YtWqCb7melAxA4YBXVFhaxSTfwpR07GjIq9XNYTgGx9IscslQ447bvPWhx66A3l5l9SWlSkODjLQBrMQQBH+JBzsUKZd/ylSbpiZSv7zH69//vyreMsWkN3eLHi40cr8ky/yepXb7RYdH3zwTQBvAgD8/uYOVh/mfTfg9QqsWAH077/7G8rKmCZMCPxlwfUFoIYHW3nPWf/RR1vtW7Z0DgQ3/S/tLPV4PDrT5ZLw7p6g7QqK/sPGtTg11aDsbGvt4MEXRlZWTtxeWxtg8fusagZ0KJGoZV4G4CQ3sF/dCf8cnMvlEiRl/eYLLvjauXLltdv9fvV3SFlJ+4Mb3LZ4ZWczhIBWqh8XFLTXRDCaSAqNYANZBRT/Vf1cTa6yC9Aa4WPHTuWYGIv2FGtsWwdLz1JwOGDv399VYVnMUiq/ENz4soRQfiEYQvj/DuDSABB12WU/1nXqVGhobfDfrOPLn21xTQ0FVq+2hJTEzEQNKdgNadjBPw+wIPnPkTpMxAvS000AlrN3788jIiJASlltEDi0e+5bv14LKQ+Z5f2n0WtSyso0EWnnccd9XBsRwdqyjDbReEgsRAEAFd99d1RkYmKXer9fHSqP9J+ny03QXyRjLr0023I45oQHe82rNjgc5OX1EgDU//xzkp05RAVbDPy9wQUAWampBACOLl2mmsEwUJveddBN2DQAQMmrr1b6SkshDOPvLxYBYPTo0ZoBChkxYnogPLyalBJtiv2hWdFpaWm6rg4sxCHTPf5cXW48Hp0BUPzjj6/2xcQscwR9XW3gOvh6F6mqqn6HWqc9aOBit1ugQVk8kJWRmirYssiRlJTpDAkBlGqr+jkElmLd/PlV9GcGFzMTu1zSMXkykcejtd1eIw70gUeP1kTEkaec8kVteHgdMcs2q/HgcCt2uw0AkplDUF0dbwVHxvz5xGJjM1zyetWAkBA/T5nS3bZp09E1dXXMYt+pogwQ+3fPWCaPRzMgom6/fZ2Ki1sUEvzxbVbjfpxPRHy8mJ2aamQCkoiYPB6Lgm0t+oV16TK8qr6eSRy6tN79ji0SEZfPnRtT/+qrI6my8paNd9yRgpKS8OpAgIWUe821IgAQQpFp8uzUVOnJzt5J9OWkpEjOyeHNnTtPNdavP7quvl7zP7zvQqvORgjR0EHaBwCQEkWZmYlyw4bTfF9+2XXdMcdcEsjNZel0Eg5hVm+rwdUw2YLrS0r6ll199ey6mTPbUSCAOqWgDUNLKcXePAgMkMXMjvLycA4EBBFZ7HLJplNMvzj1VDU8J4fLxo//pGjJkqf11q0mScn4i/dH/SOWIAK0rmbmaKSn99xcU+PSv/7atey++04LLS93yLo6qOpqaJvtkGfztp5z9e9PALQEOtgKC9uVVFUFRHi4gJSCmMW+XFPELPyGoYw5c/puHT58aun3399PJ5ywIhOQjQM3HwqKRomrr95WMnnynLD8/JE1warsNu61d3EiqywLqrz8nDWDBrlCy8s7UVkZDK1R5/ejXEoFIRhOpyStDymymA/AumOtA34hGIAAs2wVVxFCVvt8mnNzz6y98865RbfckppmmqoJd0NWaioRkd/Ws+c00+nE4SzK+BMoUC3aWwLID8AoK+vCK1d22l5YqCuVUpWAxXY7k5SSiIxDDSwww+Gwk9irD40IlqVQWFTRnM61/43MmCGlFBVEqnLhwgj/p59m5V155Qv89df2xlmLOxyqo0Z97Y+JqSXLEviHOVQdiYnEAJHT6WupCKOgosWW3a6FaQoikgCMg6JS5AT/qPFZe5RQ1JCWLwWXiZjwEM1a72btMzNgCOQVl+Otr34CAHgOLtuEACSHhnLZli2svN4bNt17b49Ga7FhYhnFXXvtb7pdu0XO4LSvfwz7Yrdb9Pd4LDJNDixb1s1fV9fiPhnU2En6IId1GrCFH3J+qwsoDTTDmJTSWoSFYd7SDR+J5F6dBPzWbs/NwX9YfpiICHeeBQAp+UmyqUzlhsLWA1ITtCZht3NNba325ebutBtZqamChGBbt25TnOHhxP+QUn52uSR5PBrMtD4l5Rnrk09clXV1iqT8Y3XOXbwUOWUzNTPLgtLKwfU1tRBi92xh1gyHzcR5Y4eFC7+vfp6w2cF69zZGQgry1dRi+bptZzOzyCmbqbPi4wkAlNamI6jAawYUM1sNcUDeDy5GJISAzbbT348ePVqDGeEXX/ylLyqqRij1txeNDAjyelVZdna3/FNPXSKWLLm1oqpK/0HFtcxEzMwWa624vn4HQbfbLeD16kWL1sTU1PtPYMvHoGb8pEQCHOC42IhvRHL3xEW20BDWqpmSLoLUKsCrN5ekPP3ed13Q4C5gZhJEJf7o6DWRiYlmOJGMltKQPh9Ba4LWASZSTHRAJe0NIpKiTj99rdWhw5KGWOPfWjSSaer8xx8fXXr11bOsWbP6VzNbJOWh6U0WzD3VTKRZawtak1lfT1GGYYsICZH2Hj3sO6RIUAjy89Pm/juvtNZOQijmnXVuQQQELOqeFEtnnzh0nhg1qOcnseF2gtZiN9HIgJBCl2yvts1ftul/IQ4TLxcXMwDY27VbnPDFF8PaX3DBMDr77LvQtevbRt++JTI0VMeEhpphliWNQIDY57MQbDm5X2DLSUkx2OejkN69pzgjIjQs65CAq8GQOGx+NHa5JACUvPrqWPvnn88O/PZb10ohFAlhHDRgEaHhDBQAS/v9yrAs4fT5RExoqGGLiAiIAQM224844i11+eXXR1977bnsdgu43cj2eJQuL4/OWbP12vqqapAk2YydpmBzcESIbeYRvTsXGJeccfSvkz79af22vNLuBNa8a0iIIDkQULMXbzzmonteO+W1tLTpE9InmUQIEFE1gEUNL3B5ecz2e+9N9G3deqZ/06aBIZY1xqyrSwgUFUEFAqizLCgpNUnJIAIJIfflIU5ZsMAiIi6fMeOz4h9/fJrLy00yjIPmUOXMTLkiLU2Sx+Nf2bWrdbjQlVVURABQO3t2nLF+PVt2e0AAtoMAKGaASWutlSKTWdqFkKZhgJKS4HM682Tv3puV3f5px6Skjx3PP19KRFWYNev3M0ifZEpBgTG3vf7gb5tK48kgxbyzz5EAsFIcFhVB4aEhLxJRrUFEFf9388sTnZGRk+oqyzXt0kKGGRCmFKVFpXpmzvo3Z85bOm7s0YOWut2zjYyMMcqb5hLxRUU0OjsbFBW1HcB2ACtgs4F9vpiKV145Sf3ww0CzrOz4wJYt/SOrqsJVWRm0UqiurQVsNmYgwIZhULN7Q8yAxNixW7YnJs4N27hxZHWw7u+AlVsGiNLSFABVu359l8Jx46IDWjMOYY7TPrFgswXIZiPaXx8kERhgaK3ATFBKOgCy2+1CRkWhUsois2vX9QHT/Cxk3Li1SXfd9RWFh9ehujr4+f/8B5yaaiAhgZGczGnob3g9af6n3vn2uue8P98cqKm2hN00dnNFEJiZZIcYZ8FLV5/yc8+XQIbb7RZXXjnkvaPTt961rVp2a457MUDSIN68paT9fzLnzWTmE4hoGTDb8HjHWE0Vc2RkUM6XX8ovcnIUEW0H8BGIPoIQYMvqXnX99UnVRJfUzZnTJUSIE/SmTTKM2VZfVQXfnkRm0KEayLvxxmm8dOlIrqkBHYR4K9ntXD1p0kkVH354Uum5514ZKCqK8hGxOJx5bszUKjFIBDBrJgqmJyklTGYR7nQaAcOAiovTKiRkuW3QoBUhHTp8EnHJJT+FDRyYD6WA2bOBu+8Okk1NNTKys3VGMCPBAgCXO9Pm9aT50x/638Cn3s/OKCrcbpHdaNbHxZqVLSzM6JAQ/mLPIT2LUlPdhpGVBeHxHFN33BVPPVVS7X/FX1Ol0EykXEMIIq2+mLU43nX3mzOZ+XgiWpGePsmcPDlY8k2/W4u6Cdik1+Nhl1JMROsBrAfwExwO8IIFnUs+/niwWLLkqJri4vEyLExixozdN3D0aM3Z2eQ7++wvC77//nFavdqGPZT8t+Q4GKA1I0aESdOcVvnYYyfobdtQ5fNBmSZEKwJuJVu3Hp5wlBCA1ooBsN8PhxBSaI3QyEhRHxYGKypqq1LqYzlq1IbOvXp9gZtuKmwY4g488QQamAdlud002uNRBDBlZ1sA4AlWvxPRaOn1pPmveuiD/t/+umpmUUlFvDCgg+7J3aWLtlgkxToLM1+55b9x7SpENqCNrKwMRRkQP2Tc/tag8x6+c9mqqi5CNvclDBZCEms15dsFCSNLK2c///bXY2++bPxSANLtdrMn6PjciSgAayelOTeXsoqKKCs7W9OAAZsBbAbwhQgLu09VVUkQ7dZDgTwenQlIV2rqeu7cOSf0t99G1AS799molbqXO3jX9fpAIJpXrTqhtKaGhd2u2G6XojXfxczx55xT1XBQh9RHwMEB6wylFAOS6+tFmM0mhRAwO3RAldYbzYEDC6RpvhN93nmbIs4/fxYR+bBsWfALbr55h6jLSE5majwnz+5ucbfbbRCRZRCsR97+9tZn35t9V9H2qgSCUozdlXgQQQcsKywq2jx1ZPLzcUSVbrfb8Hg8lkFE7HK5BBH5rnvsgwtKqqyf8/MLWRjNWL/MgBSSNKs5v66O31ZQNvv+V7589tmbz3zU4/EAqamGe/RovSvImoJkNwstN5dy1q8Xw3NyAhS0Yppd8UHRaOXdeOP7Ebm5x4jCQqNOa1hEClIiGI1quTgzLUtVG4Zf2u02BmRLQdrQ6VCFlJdHbjrrrJtpypTnOTXVQMPNP1hWHRFpECm2LJZEhrQsiggLE7VEQN++cISF/VgfHv6Ns1+/+YnPPPML2e1V8PuBTz8FLrgAswEDqalBX2FGxg5Rt8dL53aLL7/Mlx6PJ8DM7c67793bX/bOu72ouAzCIN0ssIJOcCWdoebgHvFzXrzj/Kf/+9Uqw+PxWGg8DK/Xq+DKlJMf+Nf85C5RD5FhI6201ayA4IbQkQG9cWtRzH8/+uGRU258+ad3pv3QG9nZlsfj0Uh1G+6GGOG+/Fjk9arhOTmBfY3nHZOdrQBge3r66/WXXprBXbu+Kbp0KYuIipIRzNJuWYIDAW7oR7rPnqT1WhMHA+6tPnsthKypqpIhS5c+l/fccxMoO9tqyPI88KU1c329EpZlCwkEZHRkpGGLiakUQ4askEce+bzziisu6PbKK70TFy0a1W369Mein332eyKqcvv9YnZqqsGZmZIBGgNYY7KzLfJ4NO3F8ezKzJRIdRsej0cvzJkceGjS52ceffkzs7/8ccXtmzduCQhTMKP5vh1E0DqgkRAduu3W88ZeQ0SWe/TvUmfXE5AA1LjrX8z6PmdDqqqvCZAhzT0GKQmsA4ohbaJTuwjfqJRebz5z+1lPt4+KWt/4FpcrU3i9Lh1UdQ7ikhI8f35k3gcfnEpbt/6fWr16SG1xcb/Qmhr4qqrg79SJ2//73z2i77hjQ0MOmm4Qi8ID6DX9+3cK5OVtQH29bIgstEq8MpE2/X6YSUnb/SNGjOjr9W7goKNxv/xws1NTjTHZ2da2CRMuilq8+H+FFRUrbYMGbRJO5yeJw4Z9ghtvLCeiwC66o4DLBWRm7hVAzUVERmdkyWzPGIVg3SKeeX9G9zc/m397SXnttQVFZQC0JQxp7OnshSBWtb5Az369bJedNODM+9NP/axRHDYLLrfbLXJz+1NmpivhuPTnZ8xduL4/a79Fcs9EGma9KbaUtIWGoWdSdM3Q5M5vjR858IXLx6es8VsNn0t1G66E/pyZ6WrVRjQrmdxuCY+Hd0xZNU2ACNvuu+9YY/Xqk9SaNeN0ZOSRoePGdd8buKz8/PVcV2fsD7gAQBNpp98vjAEDNrZ77bWxT3zxxYaMZsR/i0NgRFzsdieJ3r2HxF5xxdcAAJ9vx3sWpKSYKd27azTVm1qqa7rdIgsQ2R6PatQRw5x23PWfacd/9O2vZxVX1l9RUuUL0bXVWpgGeC8qhhDEqs5vJXVMMq86fXjGk7ec47nrm+8Mz5gx1q7Q2O0hPB6Pnr98efubn/lm1s9LN/VjyxcQpmHuLRGQCKyVVrC0YY+IREyoUX3kwB6L+nSOfeaJG8/6jojqfnctuA0k5LLL5YI36Gfabz9VltstR3s8eieOERIC/uSTAStef/23XWdJN4JrXXJy5/rNm9cjEGAyDHAwLaX1UgywopgNffzxi7rMmDGM/X46WL233IDISE0VaFAJWvO9brdb5PbvT16vFw09whQAhNglauqtDtc9+sH/LVuz7dJN22uP2VJQBlg+EMEiQcbetkEQsaqttxK7dDTPGTPgoZfuTHMzXBLYvV1Us7c1MzNTpqWlqerCwvYXPvnpzJnz1/WvrSyzhM2Qu8aTmjVLldLQkDBtiAx1oFNsaEG3rkmZw/p0+iIj/eRfiWjXBDEBuMjtvo6A0drjIW6Yx9iqQ8p0uaTL68Xe5ka7AZEB8KbjjmvvLynZEp6XJ+vq61HLrCGlhhCyNRYoA9quNaywsI39tm/vcaA56cxM8HoFtfjSBavx3e7ZMgtZyP6do+14EFMAX/+8uvuPOWvOWLwm76R1mwuPzSupCS+rqASUX5NpMgXHKNNezhWstWK/kn2Te+LicYPd91958kOjUt3GD9kei/cg1LA3gDFzwsj0F25fua7gju3by0ACFglh7DOdmcBBP7EisBC2kFCEhpiItouNcQkxOYnRoTNGDOyae+/lJ8+xGaSVak5ZSTXS0y+kxMQ8BqAzglZPiwDXVBQ2e4AZGVR5xBFHBN5//4T6lStP8xUWHuWorkZlXR2UYWhIiZa0EWJAO5iFFRPzW9/8/D6HsuCBmYkyMsjVvz+tn1kmciZPULsG8m0yOFM0oLnL/ZO+6zJv4Yre5bXWWTWVlSdtq/Ab1TV1gN8HCFjCkAIg0ZKz1AFlGc4ws1Oss+Ca84679r5LT/7UYrcA9iyeaV+s1RMUObjmiQ9v/XTWsjuLKuraqbqagLBJ2ZxDbc8ikxVYS7Ag4XBCECMpLhI1NdXLxoxI9pVsr/z0hGOGbE7pEbvklOMGrgRAgsjPuznr3UZCQn8OXoAD1t8aTsSGwsceG2fNn39RzYoV4+2FhbGqqgp1zGApg1kJwXTuPYMrKmpN38LC3gcTXG43i9xcLxUlr6DsLADZnp10mgYRZ+bk5GBzhXHa/75ZEBrmNM7YkFfWZXN+cXdFtpi8wu1gInBdLSCFElIARIJbwJ2Jgp53trSMjIpC/17tZj51wxm3HDuk53Kkuo1dn6dV4NphWYzOkNnZHuuVzJnJr36a89DWgopzSsvKALAlpJDc8hxvgKBZs2aAEFCAzS6Dk2FNtI+PQl11hT8yLKRkYM8kvfS3bf87bXSKr3+3mHU2W8T3V54xzEdEpbsY09LlciE5eQV7WqnkZmZmSlewMceOHqW8bVtcwX33jRGVlbfWLFkyyFlWFlJVWQkfoChYMUNNK8sPNrgyMzNlmhcNetLOegwzx16Q8aF9SJeoE5dtKu22ZWvhELvTecT8JWt0ZERExyqfQvn2iuBGWwFAa0U2I5gkJkjqFuqUQZcha20pMhxhlBTtqDsmpc8D0x6/9Bm/Cjpam1qF+w2u33Xw2Ua2Z4zlMAUueej99O9+XHZ7YbmvV11lJWDIgJAkuZUxueA5aU0QzMzMgQAgjWBfLkuBQkIRHuoE6QCiwx2BDjGhZTAd3/btGLcoKbHdTw+lj10uier0LpxtdFaG9jQz6mWvlyjYHJeoMaIQGgr+6qt+Za++evz2TZtuCCkq6mMVFKA+EIAPUMI0AQQf/IDAxUzuDJAnK0M05QQCwPa6uh73v/hVezvxZZmzFtmjQuwn55VVR/kD2oRhQ1V5ZRBENhPw+xUEsTAkNZysCKZEcCvOA8wMzQELEKaMjgzhnl0SPp5w9jHPXHXmyAVwuaQ7ObnFl7h1oZOgmAQAzcyOG5+e8nzWr6svW1dQZa+tqgLYUkJKAoH2pfjv8cYEd4OJCFprzYoZxBIMAcUwwsNBrNE+LgIBn2/ViH6d8qLjE94+78Q+s085ctC2JmJSuFyZ1FqOxsyEtDTRtI6SmR31r756VPG3317qX7lyTHhNTZfaoqJGsem3C2FYUVHr+hYUtBhcbrdbZGVBZDcBFDPT21/+nPrG5790qq+pvqyy1ndUWY0VUlFdD8WAqq0GpECwFIqUkEIQEWlmEEEE0yFaueeNGQ0ampWSwnQgMSYCQwd0XnnSkb0evvm8MR9qAKlut5HdAm613+D6nYv9Tqi4uLLvXS9+eul385afXq2M5PLyCkAFghXVgkBE8mC02SIiJgAqODqPELAIpl2ACJGR4ZDaX57Su2NJr+4dPzhz7ODp/zei988B/bvozMx0Ia2Vbg92u0VWVpYY0yS0w8xR1U89dVnFzJknWRs2HCuKiiJQU4PaqKjVfbdv77svcLlcmdLbROQxs+PR12YMmb3wt1O25RdeWFlv9dxea6G+tr5B8Q5asRT0L0nmvU+9aMXBMwOalQZAUtrsiI9wqITYyKnp546aef25x75PRLVIdRvu0Rna4yGN/QHufj+fyyWapD4bd7342eXzlm64du2m/MGlNUr4fT7A8gFCWkQACZLgg+OqD3I5rQFibSmGkAYUIywyAjFhBoeFhX3Wv0fCt9e5UmeekNJrrd75YqjWBJsbuVmW10tjGsVmSAj4xx+Tit577zq5ZMk5Zdu3h/RatqxLc+AKOjBHi2zPmB0xtxc//K7fN79uuGbN5oITi7bX9KupV/DV1QLKYkihSAiiYI46HaREVBZEwcvJWoCFEKYNESFOxEeHbDl6UPc5fXt2eN592fHzGy9l8CLsvx/ygG+A2+0WX+YnyZyGtBu7KfDK1J+GTfl+6Qnrt5WMr6mqHl1cFYBPaXB9LQBWEMRSChFk50IAfECZvNSQOSAIrCytobUBewjspkT3pGhfXKTj3TNGDZ760HWnf1tZU99043RrMxoa04jQkKoCADI0FKWTJ4+IuuiiX5t+HzMTjc6QjbqUw27iUvc7FyxbvfXytZsKR1VYwu6rrg56EwiWCCZqigMF0w71goL9XnTA0hDCREBBhoXBaTMQFWKUJEWH/9CjW8e3P3j04p9MQWVBZ5VbZGb2J5frwC3xg5lx2RBH/P3A7Cbhvue/6Lc2vyjth8UbuxqCzyqvtSJrfAp1FZWAaQC+eg0pNAV1tQbLBoJbqYzu7vBjxcyAUhL2EHRsF4XuidELjhrQdeLEG8+Y2rhxrsxMub9RAg6OwhPNOW1TU91Goz7FzF0uz3jvtNnzVlxa5sfwqpo6cMD3O6CC3Hy/zkI0GEXMFNRymcEBi4OGUbAsIDo2Guyv0f26tKuMjIr8pFuHdl+mjRk69/gjuxU02WHhdrvh2Y/Q1R8Brp38M55cL6EJ0CSABRs2RM2Zv/n/pv+8skuIQf/6cel6I9Tp7FVeG0BpeTUADgKjrg5gxbCZQMPUVUGCEDQrqZVAY9YctIAMU8bFRKJLu6hfjxzc/bmX7jzX25CKcsAbm+lyyTSvVzWAVQcxxR2uefyjW+YuXjthc1FNWEVlFaAtRVJgXx7xPYk1BrRWO2ZZCfgtwOEgkgZYM4QU6NguFnXVlZVdO7YrbB8bsqpzYuKsod3if7ry3GPXGkTl6ncFULrgOnj+wj8CXM0HTHO5qd8mzGlDvd/CzJ9XnfhS5g/O/NLyLt06J541a94yHR7qSFEkozbnl4KEAUtpWPX1gLYQTKcBN3TToSB6uKWiQgf1M0PGR0egX5f4nDPHDn3uwatOfr+6zg/AJZkz92ujmZkozSvgTVPMTLc84504d+mm9OXriyJrK8oBKQJCiha7a6gxhEPEOqA0JJkIKECasIWGAFrBbhK6JsUjr6hkcVSYs/SEEQPFloLiaSccM2Sz64QBK3p3ilsniVHrU7v5BQ8VoP5QcO3u08mSnqys3bzN1PBquPKd3v5ucewHX/wYmtK70xWfZy9lS6n+FmPI9op6h08BdeUVgCRAK4tMI9i3glqgrwQbXGgdsAAyROdO7dG1XeR715xz9MRLxh+5wuLfQ18t/VmNii8BeO6jLNebn8y5e+3WsmG1lRWAISwppdQt8ogHnZesOej+I0MAhIioCATqq7l3tw4+aGtRx/bxub06Rq+du3jd9OfuuVgck9xhCRHpPRR1kts9WwKjdUYGmP7AouLD3u8qMzNTvrRiBWXn5jK8AFwAmhnIxMw0be66+LxNm0/5+pffuksrcMHCtXlxmszoguJyQCtA+TWk1IJI7ItDNEYLtC+ghc1h9OnW3pc6rOfjr9xz3lNEVAtXpsS+LCVmQoPCvmFDYfsrJn70+OoNRZflFZcDrFoUvdjxHJo1ApaANIW0OxDllIiOCt+cGBOytFvXDnO7tAubeWf6aZvCgBJqzkHscsnG/XMnX0dAlj6Y+tNfElx7EqVABjy5aZSanNxsXI2ZaUtpadLkzF+Om/XzsqMLq3xjq6pqk7dX1sOy/ICyFBkSFORmtI8ogWK/JUOjonFEv8Sld1544lWnjh7463Fut5GVkaGau+2NcVcB4LrHP7rky3mrHsgvqe7pqyq3hM3cN7iD7nDFSgtAkOlwoGNcOBJiI3O7d4j9Pik6dPrTt587I8RuWHV+tZufEVlA9mhod0YGPEFl9U/X5uCv06mvgQM0J1YFAMVs3vLc1BFLV2y8dOWWkuNrFfWoqKgGAj6QIdW+nLk7UoUsyCGDeuCYAR2vfPmeC99s8F/vlP7TaAkys/OiB99+++sfVqSVV9UBbFlib4mVDaDSWlsIWBI2J0WGO5AUF75uULd2s04bPeKdi8YP+UUQBZp8A6WkTzJOTcxTGRkZ3Pisf4Uj+0u3gWRmysjIkh7PyzsZC8XFHP7oO9Mu+eqnZSeVVdWdXlpZB/bVMRmGJgG5N72MAK39FoWHh9KxKb2emv7CdW4iqmvkVI361dTpCxLve+3L/20srju+vqJMCVPQnnLNd+JUPr8wwyKpU0I4OrWP/rxzu+hn333okoVEVLWT0p15YImUbeA6yJzNleYVRUUrqNG/ZAjgmse9xy1fl3frb5sKz8wrrQasei0Mib2lCwkiVgFLR8bEy2F92n0/65Ub/o+IfI1Fou99/fNJz3/4w8c5S9dHQcAScs/5bTtA5bcIdofo360dwkKcnpsvHvv9ZScP+dHXkGaXmuo2Eq7vz5muQ2/FtYHrwJBGqe4M2ZCVqU0CJr4369ipsxbdvWpDwaml26sAYksYYo+ZtUQEHQj4pSPM1rdL7PfPnnrEGeMuGVfjfuWL8R/MWPzJmjVbbMImFe+lrQARWPstRabd6NW1PdpFhz55x+Vjp5x57MBfdRPHZWuSINvA9SdaTQPFpgAu97w9avWmsjcXrM7rUVNZATKExh5Lpwha6YDhCDW7JoR+ddbowZOnzFoybcPGAiltUus9KO2NcU+tIBLbJaBvl9gvJ5wz8qnLTz3ih7qADharXN+f/+pi7x8Prp2iBh4CgulCzpNueOnq3DVbn9pWWmOD5Q+QIUzsIRGcldbStIkwpx0VFdUQwfTG5jmeIGi/pSBN2bNDzKbLzhz57OPXn/pCTX0AAKSbmVuba9YGrr8UJwtyjCdf+3rQ69MXPJVXVndS9fbtSphij24LDmY8kZBijykvBNa6PqBjkxKN1CGdv3v0iuPO7devXxUA4crMpL87p/rHg6vRyhw+YbKRM3lCgJltZ9w++env5+beUFNbz9IU0PuR6AhmxSxk3+5JGDm0x4TX7jv/LSIKNG3U8k9b/+iJFA2ikgHwuXe+dvmC1Xlvbly7WUunnXRL6wKIoJWyyLAbSbHhyx646sT7rjl39Bc7fHP/4HmR/+iJFNnZHmZmykV/25THLsmZ+Lhn49ay+rPyNxdqaTf2naod7IllCcNhDO3dYenTN44/4aL/O2YxUt0Gb8xizz98EGnbLJ2G1Si+ZszPvfSBV795++efVygZZhda74GDBYtILGnajdHDey6b8fJlJxBFFKdPmmROnvDPFINtnGsPKyfnS50+aZJ58xmnLHx70vObVm0rP2vrxnyWNqMZBZ4ArZQw7caxQ7st//zpK8fa7RHFLlemfG/ipVbbbrZxrmZXSvokM2fyhMBnsxdddt+r3761fMU6JR2GaKrkE0NBGHJov45LZ7/0rxMiIjqUHEhG6991ibYt2IWDTZ4QSEmfZJ4xZujb5x7f/7LEDglS+bUVTAIFACjNRB3aRa0+e3S3sRERHUpcrjZgta1WrGSX2wYA/3fTf6+OPP4exuB0Sx5xncbAq1Vy2hP8SVbOaQCQPmmS2bZbbat1i5lS0ieZzCzOvX3STJHyb6Yh1/hDRt6q0+587XIgGGxu26i2tb8IIwCC+Tf7sIseX0NH3MJn3vbq/9qA1aZzHQx7h12uTCLq7Tt2QIdbjx/eveCTpydc43K55OjR0G37s/f1/2Dtl9ECN91JAAAAAElFTkSuQmCC";
const NFL_TROPHY = "data:image/png;base64,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";
const XFL_MARK = "data:image/png;base64,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";
const XFL_TROPHY = "data:image/png;base64,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";

const USFL_MARK = "data:image/png;base64,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";
const USFL_TROPHY = "data:image/png;base64,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";

// Maps each tier key to its league mark data URI. Add marks here as artwork
// arrives — other tiers fall back to showing the tier key as text.
// --- SEC / Big Ten / SWAC artwork (base64 PNG, palette-quantized) ---------
const SEC_MARK = "data:image/png;base64,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";
const SEC_TROPHY = "data:image/png;base64,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";
const OKKY_MARK = "data:image/png;base64,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";
const HOGS_MARK = "data:image/png;base64,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";
const TEN_MARK = "data:image/png;base64,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";
const TEN_TROPHY = "data:image/png;base64,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";
const SWAC_MARK = "data:image/png;base64,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";
const SWAC_TROPHY = "data:image/png;base64,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";
const INDIANA_MARK = "data:image/png;base64,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";
const SEVEN_MARK = "data:image/png;base64,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";

const TIER_LOGOS = {
  NFL: NFL_MARK,
  XFL: XFL_MARK,
  USFL: USFL_MARK,
  SEC: SEC_MARK,
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

const WK_COLS_3 = [[112, "Week 15"], [224, "Week 16"], [336, "Week 17"],
                   [560, "Week 17"], [672, "Week 16"], [784, "Week 15"]];

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

function GHeader({ banners, logo, logoSrc, cols }) {
  return (
    <div style={{ position: "relative", width: GRID_W, height: banners ? 46 : 24 }}>
      {logo && <GSlot x={448} y={0} w={100} h={46} label={logo} src={logoSrc} />}
      {(cols || WK_COLS).map(([x, t]) => (
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
            <GHeader banners={s.banners} logo={s.logo} logoSrc={s.logoSrc || data.logoSrc} cols={s.cols} />
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
    <div style={{ marginTop: 18, paddingTop: 14, borderTop: `1px dashed ${C.line}` }}>
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
                ? <img src={g.logo} alt="" style={{ height: 46, display: "block", margin: "0 auto 3px", objectFit: "contain" }} />
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
                    border: `1px solid ${C.line}`, borderTop: "none", boxSizing: "border-box",
                    color: win === g.left[0] ? C.turf : C.slate, fontWeight: win === g.left[0] ? 700 : 400,
                  }}>{g.left[1]}</div>
                </div>
                <div style={{
                  width: w, minHeight: BH * 2, display: "flex", alignItems: "center",
                  justifyContent: "center", textAlign: "center", fontSize: g.name.length <= 40 ? 11 : 10,
                  fontWeight: 700, lineHeight: 1.15, color: C.gold, padding: "2px 5px",
                  background: "rgba(255,255,255,0.03)", border: `1px solid ${C.line}`, boxSizing: "border-box",
                }}>{g.name}</div>
                <div style={{ width: BW }}>
                  <Bar team={g.right[0]} w={BW} />
                  <div style={{
                    height: BH, lineHeight: `${BH}px`, fontSize: 11, textAlign: "center",
                    fontFamily: "'IBM Plex Mono', monospace", background: "rgba(255,255,255,0.03)",
                    border: `1px solid ${C.line}`, borderTop: "none", boxSizing: "border-box",
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
const NFL_2025_PLAYOFFS = {
  sections: [
    {
      banners: BR_BANNERS, h: 418, paths: BR_MAIN_PATHS, logo: "NFL", logoSrc: NFL_MARK,
      slots: [[448, 16, 100, 150, "Trophy", NFL_TROPHY], [448, 250, 100, 100, "PFA", PFA_MARK]],
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
      banners: BR_BANNERS, h: 418, paths: BR_MAIN_PATHS, logo: "NFL", logoSrc: NFL_MARK,
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

const XFL_BANNERS = [[0, 436, "XFL", "#CFE0C3"], [560, 436, "Championship", "#CFE0C3"]];
const XFL_CONSO_BANNERS = [[0, 436, "XFL", "#CFE0C3"], [560, 436, "Consolation", "#CFE0C3"]];

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

// --- SEC: 16 teams but only THREE rounds (weeks 15-17, no week 14) ----------
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

const SEC_MAIN_PATHS = [
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
const SEC_PLACE_PATHS = [
  "M324 114 L330 114 L330 133 L336 133", "M324 152 L330 152 L330 133 L336 133",
  "M672 114 L666 114 L666 133 L660 133", "M672 152 L666 152 L666 133 L660 133",
  "M436 57 L448 57", "M560 57 L548 57",
  "M436 133 L448 133", "M560 133 L548 133",
  "M436 228 L448 228", "M560 228 L548 228",
];

// --- 2025 SEC, ranks 1-8 (championship half) --------------------------------
const SEC_2025_PLAYOFFS = {
  colors: SEC_CLR,
  logoSrc: SEC_MARK,
  sections: [
    {
      banners: SEC_BANNERS, cols: WK_COLS_3, h: 200, paths: SEC_MAIN_PATHS, logo: "SEC",
      slots: [[448, 0, 100, 52, "Trophy", SEC_TROPHY], [448, 114, 100, 57, "PFA", PFA_MARK]],
      champion: { y: 76, label: "Champion", team: "South Carolina", sub: "SEC 2025" },
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
      cols: WK_COLS_3, h: 258, paths: SEC_PLACE_PATHS,
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
      banners: SEC_CONSO_BANNERS, cols: WK_COLS_3, h: 200, paths: SEC_MAIN_PATHS, logo: "SEC",
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
      cols: WK_COLS_3, h: 300, paths: SEC_PLACE_PATHS,
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

const GRID_BRACKETS = {
  NFL: { playoffs: NFL_2025_PLAYOFFS, consolation: NFL_2025_CONSOLATION },
  USFL: { playoffs: USFL_2025_PLAYOFFS, consolation: USFL_2025_CONSOLATION },
  XFL: { playoffs: XFL_2025_PLAYOFFS, consolation: XFL_2025_CONSOLATION },
  SEC: { playoffs: SEC_2025_PLAYOFFS, consolation: SEC_2025_CONSOLATION, bowls: SEC_2025_BOWLS },
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
