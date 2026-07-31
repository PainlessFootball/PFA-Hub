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
      "OSU", "S Dakota", "Cincinnati", "Arizona", "Houston", "BYU", "Iowa State", "Denver",
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
  "greek11 l": [{ "tierKey": "GLIAC", "team": "Heidelberg StudentPrinces", "stats": { "Career CP": "152.13", "Career Avg CP": "38.03", "Record": "16-18", "Win %": "47.1%", "Total Points": "6565.40", "Avg Pts / Season": "187.76", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "0", "League Low Score": "0", "Best Manager": "-4", "Conference Wins": "1", "Division Wins": "0", "Playoff Wins": "0" } }],
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

// Builds the reference rows shown beside a bracket: one per final place,
// carrying that place's coaching points (16-team leagues only, the others
// have no CP table yet) plus whether it can still take a promotion. Draft
// picks used to live here too; they now read off the bracket's place cells.
// When there is no CP to show, consecutive places that would render
// identically collapse into a band ("22nd - 31st") rather than repeating.
function placementInfoRows(size, tKeyForCP) {
  const hasCP = !!tKeyForCP && size === 16;
  const rows = [];
  for (let place = 1; place <= size; place++) {
    const fired = place === size;
    rows.push({
      place,
      label: ordinal(place),
      cp: hasCP ? cpForPlace16(tKeyForCP, place) : undefined,
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
const cpForPlace16 = (tKey, place) =>
  place <= 10 ? CHAMPION_CP_16[tKey] - CP_OFFSETS_1_10[place - 1] : CP_TAIL_16[place - 11];

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

const BW = 100, BH = 19, GRID_W = 996, HEADER_GAP = 8;
// Bracket outlines and connectors read too dark against the ink background.
// They get their own line colour rather than the app-wide C.line, which is
// also used by panels, tables and the season picker and should not change.
const BR_LINE = "#46608A";

// PFA shield, embedded as a data URI so the logo travels inside App.jsx —
// no public/ folder and no second file to upload. Swap this string if the
// artwork ever changes.
const PFA_MARK = "data:image/png;base64,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";
const NFL_MARK = "data:image/png;base64,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";
const NFL_TROPHY = "data:image/png;base64,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";
const XFL_MARK = "data:image/png;base64,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";
const XFL_TROPHY = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEsAAACgCAYAAABEzZGrAAA9wUlEQVR42t19e3xT9d3/+3tOkiY5aS5tQkOghdr9SluUS+oAhwqogLN2osNRqI/gJk43N6+76ejzPOVRd8GJU7fn0U1xj21xOkWxKqBcZYAz4U4LWmtbSANNm0t7kjTJOef3R74nnIa0tFx0e76vV15t05Oc73l/P9f353O+h+ArHJIkEEJYacOG97/V1HTsO3q9zmjNsyXGjc3/+44dO52hUMBeUVHxXHl5+d+Ux39V81V9VSeuq6tjCWEll8v1zR07dv7oD3949rpy59Sm6TNm6ndu2zblsssu696ze+flWzZ/ONXlcumdzikfEMJ2SpLAEMKKX8Wc2a9Cmr7xjW+obr75FsHlcs1rO97x0KOPPHJl4fhx8arFS7RbNn9g7e3tPabJ0k6fc9117/36V78O9oaC9xVeUnTq+9///pHRo+1RllUxW7Zskf7Pg8WyKuZ73/ue4HK5rgfw64cffOhr8XjM9IMf3EsOHdzPZWdne8omTjpy6mSn/aorr3KMHTt23TPPPDvj02NH+37+i5/1uN37uhYvXhypq6tj33jjjS8VMObLlCgAZMWKR+Fyue4F8GpjY+PklpaWUd++5WbRmmdT5RcU/sNktnx4330//JnJbGkGYK2oqHh46tSpzJat2779wgsv/grAv0uSkF1dXS3U1dWx/+fAooYZACS3e9+9AJ7x+bqyXnzxxXi5cyqWVN/GjBubv2LP7p1HggH/JKfz8uPBgP+L5ubmOADmnnt+IAJINNS/MrHteMd9L7zw4kdvvLWutLq6WqitrVX9nwFLkgSycuVjRJIEZsOG93/h83U9BUDYuGEDIpGIes4117Y6nVP+bdVvf/Ohw+FYOqGk7O69e/fGneWXP9rS0nLK5+tyl5c7yeKqReKWrduwc9u2BMfpJx3af2DH6tW/v6KmpibxZQF2scEiK1c+RmpqasSNGzf9HMBjAJi24x385i1bVWWlJXxFRcVThLCvAHgJwIG77lr+8UMPPqCurq5uCwb8a/bs+fgSANEbK78VA5DYvGVrzGrNPQYgNxQKvFdXV+esqalJfBkqyVxsqaqpqRFdLtddAGoAwGq1+Q7tP3AYAOt0Ok86nVNeXly16NsOh2OCyWx5GgABgNraWsbj8fyu6cjh/rbjHfGSkpKsObNnCXv37tVu3LBBe+nkSfFgwG9qaWlpXPPSi5dQlWT+JcGS46ENG97/ps/X9WsAaqvVRgA8vWXzhwazyQiT2fIQIWyotGziExNKyqJGo7kRgLTqyVUJAEzD2ld7SssmPh3q6TH7fF3MnGuuzQLArH+ncYzvZFfMWX45ggG/vb3j+NvPP/9CtsKR/OuEDrW1tczs2XNEl8v1tXA4XAfAQYF6ctVvf/O+wWD4ucFgOP7MM89+v7a29lsVFRU/1GhUb992W/WLdXV17KRJk8XNmz+QWFbFrFjx6IH9+/bfzqjVxmyDQTp06JDk9XoFtYpdUzxhwvjRDofW7/fn9fX1ldbU1KxlWZXqYsVgzMVQvRUrHpVcLle2z9f1WwBfs1pt8Pm6XOXl5Q87HI57AMDhcPyvJAnM9OnTbgewhY9G/waAWK25BAAIYaXp06cxhLCh0Q7HHzitlugMXKLcORWhUEjjcu+dxPPhpVZrLltUVNQPYMFDDz7wMDX47L+KGhIA8Pm67uej0QUARJ+vi/f5ur+zYcP7JgCVDocDAOrc7n0TrFZbr8/XlaWOdG0BIM2bN1eQv2jevLmCJAnEarX9t9Vq6+O0Ws2ca64jRqNRBDCzof4VPx+N3lVSUpJlNJrj+QWF/7Vhw/uXU8CYf2qwaDwlut37THw0ehen1YoAGD4ava+6uvrztraOuQCy3W73P1Y9uaoMwK8BjAGwt7JquVfOF1OoE1ZaufIxUl5e3gPgewA+HjcuXyoqKkoEg0EJwMO33LTghbbjHa+UlharAWS1tXX8WZIE7mLYL+ZCArVy5WOkrq6Oazve8QSn1Y6l3//mLTct+LMkCSQcjlR4PB7J6XT2ud37HvT5ur4JYC6A7QAkWQWVg3pTdXl5+V99vu5VVquNKZlQzEQiEQLg2ocefCDXd7Lr+wA+tdlyEQ5HJr285uXHa2pqxJUrH/vnBKu+fi1TU1MjAvgVp9XeDSABoJuPRu+lK8wCuNLr9ZJ58+fbAJRarTYGgMtqtb0pSQJRqqByOJ1ThLq6OrakpKTV5+uKzrnmOhaAAMDs8Xiuvuuu5WEA/1ZSUhIOhQJCe8fx77/x1rorZGfzTwVWXV0dW11dLW7Y8H6pzsDdzUejcQAqn6/70VtuWuChqlWq1+vGA4hYrbYin6+L9fm6GJ+v68Py8vL4xo2b2MG4KpmSKS8v/4SPRtePG5dPioqKEna7XQIwV5IEMn/+9XsArCwqKmIBZLW3tj9YU1MjNh05TP4ZbZYE4D84rVYFgOWj0X0tLS1/fv75F9QA4HbvywOgmnPNtRoAap+vm/X5usFHo7uTDqF7SHfP82GGSugXVqsN18yZDYfDQQDMlOO65ubm3+kM3CG7fbSk1+uuf+OtdVc2rH31ggWrzIWSqrq6uqkAbvX5ugUATKSP/0lNTU1i3Lh8SZIE4nRO+VijZuuLiooAAG7XJ1lu1yei72TXMQBoaWkZCizi9XYKADBubL7P5+uSTGYLS0OQr9ntDjshrFhdXR0bNzb/XmueDeFwxOA72fXc88+/kL1ixaPShTD2zAWUqp/w0SgBwEb6+A+rq6s/qKurY+fPvz5BCAtC2NCyO75bbbXmtrcd72A9Hg8DoH358u9+Sg35UGBJNTU1Yn39WgbAdJ+vWzIazQwAIb+gUF9WWjKZ2idNeXn5tnFj898xmwwAMAnAIkJYiX72qwOrtraWqa6uFt54a904nYG7OdLHyxf878q0B4C0YcP7a954a902AFx7a7u8ygcIYWOLqxaxFPBBx4YN76uqq6sFAFGrNZcBIHo8HgkA7Hb7JAAwGs2Exnn/aczJEeh3PlRXV6errq4W5RjwKwFr+vRpDABE+vhlALT07S3V1dU7ZTtB88OKNS+9tPTQ/gNXWa02a0d7q+z1PgGA0rKJw76Igwf2vwUAer2OlJZNREd7KwCUA8Bb6/4mSJJAysvLXePG5u/gOD2x5tlKANxCF4z9qsAi8+dfL0iSoAJQRaWK6AzckwCwYsWj5E8vPE8AYOOGDdUu916RunvG4/EAAExmyycA0HTk8FlzuT17PhYBIBDs2+XzdUcBsEajmeQXFCZKyybmSpLAbNm6Tdi4cRNDJWgVgEikj5d0Bu77NCMQvxKw6urqGADSy2tevhxACZ3gZ+PG5m+kxlTcsnVbQpIEncfjuZLjOObSyZOYtuMdEo25BACfUck6K1g1NTWiJAnk/vt/3BGP9Tdp1Cz0ep1w1VUzIxUVFa8Qwkp1dXXM/PnXCwAkp3PKRp2BawVAIn38jNWrfz+BEFY8H894zh9saWkhABCLC3MBQGfgoDNw/yvHTHL07Hbvy3c4HKNLJhQLnFYr+k52SV6vFw6H48SKFY92DMO4p8bKlY+xsnSpNVkAILlcbn193SuLXC6XinpUiaZNcU6r/SvNDNR6vW6h0nR8qWAVFRVJAGDNs03WGThE+vgYp9WulcW9qKhItkOXTCgpU5WWTQQAwevthN1uB4DPCGGjdA4jolRCocDf47F+hMMRdsvmD1i32339jh07y2pqagZIjtVq26gzcMRqtUkcp58BgMjq/KWBJUkCqa6uFlwu1xhOq50f6eMB4OP5868/VltbyxDCikuWVMmTaisvd66tqKg4ykejUADz6TmkI/J37mvvOC7I6hwIhqQ9u3eOB4Atmz9k5HM7nVMOcFptR3NzM9EZuAm1tbX56YB+GZIlf87JR6MGqobrlGIupy7Nzc1fALj74IH9taGeHk0w4Jc94WcjPSnNPVFUVPRpMODvpHYykQxavXlKtoKqIg9gs9Wai0gff4ndPrqUfp58aWBt3LhJ5qy+HunjEY/1C5xWuzlT2tLS0tJfXl4ebO843h4I9hEAxOFwwGS2tCrVeYSxXQxASygUQGnZxONmkxGBYGis8jgFg7FdvtZwODIv7X8XH6w1L70kAQAfjU6Jx/qh1mR9Om/e3IMAQIO/1LDbR7OSJBC7fXSxXq+TyUFJlqyzpDlDzbkpGPCjqKjos5sWfBsARikPUoQJfwcQp+e9XBmGfBlgkYa1rwqSJDCcVjvamJMDnYHbTwgrl6MGXPxddy2PU5W0hMMRmfcPG41m73lmH0dpjjmmoLAAN998cw4A3Ln8LklpBubNm/s5H42e6OrqBoBLnn/+Bb0chlx0sCQpaXLefHu9iY9G8+nbH2cSb5fLpdmw4X1bbW0t4/V2FoRCAZjMFmIyW05eddXMnpGEDRnG5wDg8Xh0h/YfQEVFxYkzppqsMMUANNH3RnGcfjQNQy4+WPJJOK02B0AOfftwmr2SJ2KxWm3XUcNsVnxNV3l5eVyhkiMZIo3+PZR10DUdOYz6ulcup2ZAUthWhs71oNlkQCgU0ABwnKuRHzFY8kmsVpuF02rVkT4+zmm1nw9if4IAxrhcrkco1y6PADXW55zY2u2ju01mSwKAiUpYniQJLAWTDDT2thYaxCIe679UGVR/KUGpz9eVY7XaoDNwPQBO0nxQUqoqgFwADU7nlF8BSAQDfgQDfgAI0ZxwxBOWz2HNs4UA8CazRU3/xZ45x5Skt+kMHOz20VBrsopoiHPxDbzOwMkXaKA/T86bN7dXaVQVIw5gmdu9r9ZoNJfLKhQM+P0jZRvSB6fVJuj3RUvLJooOhyNr48ZNauUxS5ZUyfPpktWd58NjhsPMXhCwOG2SieGjUaPP1wUAfkJYKVNU7HRO4QEsB/Aode2yvTnnlIO2LmHevLk8gH4AHqPRzE8oKcuiBRClZMuAeAH0cZwesp1VAHnx1TDSx2fz0SgifXww3WAqwIsAWAHgkVAocFyRB/ZeAHaWpS9VaWkxGTcuv9PpnBLN1KTrdE6JA0jQ8CGLOqoRn3DEfU179nyclOuubmJLqmUiU+5ICCuuWPGo2ufr+pXVanPQfwkUsP5z5q8lQZYuDSUcu2jOaQJAaCUo3cvGfCe7Yh3trTCZLee8OufcBBYKBRi9XnfW1MFqte0AkBsM+KebzBapqKhIHY/1By4E8W80msVQKJAd6eOzrNbcoRagPxyORL9KDl4KhyPopKxnJulyu/fpfL6uMLVtxG4fvWfJkqpNl02a/CL1bMJ5nD+LSo8ZgJqPRj8BIDMKUobFlX+NfulgGY1mhEIBBIJ92enB4MqVj8l2I5uPRu/w+bqvA2DwejsPAfhpc3NzbBDvOZIRBXAiGPDr31n/NnZu2/YNACoaAJMMwGoonR0417CFOQ817A8G/AiFAvo0z5OKhdqOd/Qf2n/A39LSkqAhQwJAe0lJydcugBYaALAmswW0K0cYIhvQyIYdgO9cw5bzkawABcAsl7vS3fuh/Qf6mo4c5oMBv2wb9YSwEQDRcy16yunWxo2bsvR6HQkG/KzH44FcFst0LAB9MODX0vm2f2lqKPNPpaXF3fStPLd7n1m2U2nRdpyGD6DxlVWSBB0A4XyLnk1Nxwxeb2e257TN7KPSlfKEcjizceOmIgB6r9cLk9nyxZdus6xWm4+6YXPb8Y5RaSspUTcuOBwOnuZuotFoXuB27zvq83U9VF1dLVCJPNeRbTSa5VolvF5vON0Gyvmfz9c9QZGEf5ZGUV88sBT8ts9oNIcBsO2t7eMHy+TdbnfY7XbLdk7t83Xl+3zdk8/XYNlsudmhUIBzOBzi9Bkz4XQ6uwdLznk+PIVKoK+ioqLlXKmh81lZn16v89HfyzJk8kwSVGfI6XQqV1LUGTjNuXpDeUHisX6r0WjWABApTxZKX7CamhoBAMLhyGVerxcAWsrLy4PnSA2NHCxCWIlG6BFrns1DJeZ6ZUEBABZXLZLt1CGT2SLS9iBYrTZwWq1xzuxZKlldR3J+mQZSa7KyqXpLlM34XLlg1H5KLpcrNxQKFCdpHfsnADBn9iz2S7NZGzduYmlS3ZRfUIhgwP/1DRvetwJI0bVer5fQeMbfdOQwURhixmq1Fcy55louLekdLkWTcsh6vY44HA6J2s4BNLXsQHy+rimUKoLD4fj7lx7By/mhz9d92GbLBQBzU9Ox6cpJKobf6/USr9crGY1mAHgQQOX06dPU53Lu+vq1hFJF+rR/ddDFkdKM+wwqVRFn+eW7AGDONdd+aQWLVPjQ1dX9j66ubng8HoRCgQoAkJtBaAsjSssmfu50OmG32xEKBQgAJwBitdrOacKyGkb6eLvX2wm32800HTkMAJ40CRSobZtNCccD1dXVbQCI0lxcdLDkcpfZZPi4o731OA32vilJgpY2gxC52cNoNHcAkBwOhyoY8MPn67oNwAYkG80wwniLyNlBV1f3uGDAD7vdrgLQazJb2gGgvqFepFVxyeVy5QeCfV+nJmDT+dir8/GG0uKqReyyO74bBbCLGurxb769fhYAUl+/lpEvqqCwoBOAP+XGo9Ew9YwFSYM//IInpWckSRJMZpOh1OPxgHo5z4oVj3bLDoh6RNJ2vMMZCgVM1F41KiX+Sw1K5dzKZLa8CoB4PB60t7bfDkB6Z/3bclhAbrlpgd9ktnxBjbAEQE+7lHPOwV4x1MF8PRYXxnm93nggGAKAw4Swcu+DrKqS72TXjcGAX/J6vUeXVN/mQrLmKX7pYMkxzPTp0zY5HI5TXq9XCoUClZIkjJY7hOV7aAryxx42Gs0wmS3gtNrn+Wg05vN1XznyrCFXNtpTw+EIQ9MbANhPVYzU1tYy9EaDvHA4cqPH4yF2u/318vLyOFXBL1+yAEi1tbWq+fOvD5nMlpftdjsJBvzZb769/jYKIiNXUNSarI/NJgOMRjN8vu56Tqv9oc7ANUuSwIyklC574Xisf1woFJDsdjspmVAMh8OxV1Yx2phCfL6ub4dCgTwAcYfDUX8+XjDFlLZtqmJ7TnxBcsaMlwDgzU+SwH+v2iEd3+9FyY2vpFbixI7bk5Ty5y2Yumy3RG0PmT592jNNRw7f7fF4DO2t7YskSXgSgCA3n4EWYemqbrVabavmOaes2bhxk7qmpmbYFLMcFrR3HC+gwawaQMRktrioaZD27PlYAiB1ejzzqa3a8eTvnjoiS1wmp7F3zQzYLinCmKv+ghM7bseYq/6SYi1undqEDYdE8r1qh3Re3bvHt1eT13cmVPf/4tV4bW3ti01HDi9zOBzBefPnV8+ff/27Gza8r5o///pEXV1dDs+HW8LhiDkUCkgVFRVyq1BJeXl5yxAXMuCiaESu27Fj576O9taxHo9HD2B/fUP9VEJY1NXVMdXV1aLL5ZqwY8fOnaFQIAfAEqP68F8BsLNGtwm2S4okWRXHXl03IpVUNa1fvNRoze0FEFVzRgHJAmgcAA8gDCCmMk/rp+8lAMQt+ZUiIaxITxYvLi5m7PbRfwwG/HcAMHd6PE9JkvDhypWPxWmLUM/zz79wFMB0AGLb8Q4RgJrTai8H0EJVZ0iwamtrSU1NjXTwwP6SgsICIRQKeExmyyUAPqLVJNU769+WkoC6f6jX63IAtBTZdW9VVtUIp+3b7gHf63K55IbdLABshG8FAFWx2a2N8yG1mjPqAGTH+ZBaBcCY6POtYbNYxPnkF6g5Y6oqAiCRCHwcpUDFAPR3BT4WTx14hKdcVVRlnmYGUPlYMzZ6PJ55+QWFxRs3blpaU1Pz/JqXXtRSCni7Xq+b1tHeKoV6eggAyZfsR31VtkXDsK8SgEsO7T9QSgNRlJZN3Jq0V6PJihWPCrcuXpzX3tq+iGYWz1dWLQ9/tP31XxWb3V/vbmuN0SKNkX6fBp5VOvq7DoCKpgWq7iC0AFj4utlsE6MiasvjqtLKhmfWr30hOCn3w5fR74upDFZVnA8RAETNGTWUkh2QWujMkQFXEQegxrb3Z08r+3n9Os/0jvZWo16v+/aGDe/X0TZscJx+M4CfmMwWEgj2Eb1eR7zeztmSJGhop8uQTADNGiQANwYD/lON777XZLfbTaVlE3cmc9FOQggrrV79+/tstlxbV1d39/33//g3H21/vabY7P5ZLNCGbNPg/kzoH5ijhqMEAMRsE8P0BsVfllY++xjZu2aGeuqy3fGm9YvvM1pzV1MJYuXJK6QMGS5G/lvSmSMqALv/YzU6ASwwmS2egvyxy5bd8d0PqLibfL6uXQBK9+z5WLLbR+No8xHiLL98ZnV19d/pPUDCYJUiQljpjbfWZR/af6ALwBaj0fyh2WTYtuyO7/5j/doXVJVVyxOrV/9+nF6v289xelNXV/ePllzj9cf50CuJPl9CYffS7aASIOXf8WwTo+kNir8trWz46d41M1TM1GW743vXzFCVVjY8HfJ1P0TFVKBAybd3yC8m7ZWqCkcCOhHAjJ8t010LQDQazWNiceG+N95a5wBAysvLg1arbY3VaosBOB4OR0ST2YKWlpYbMnBhmVSQjBubPxOAuiB/7N8LCgvmHTx48KQkCWTvsU5IkqDV63X/Y82zmQB8etVVM00AXpHifoHNYll6XWzaa8D16LUSoa8EBeo5GSjbJUVJWnfqst2JpvWL1aWVDb8DsFLNGVVUwkYUs0UCOlFnjhhnTytjAYgaNXtjpI//IY3JGJqfPW+3j/64o72V0JyyUpIERg5yB4ncAUDy+bqqASQ2bNjQ0d7a/tsnf/dUO70pNPHm2+uf5Tj9fE6rxbj8rM589d8Wx/mQJPQn98Bhs4adEsZVBquaqC1/Ka1suLdtUxVru6RIGHt13YDQgZw68Ag7atLjiRO77n1BzRnvjPOhuJozjpRKkQCQPUcKxRZvhADwlpYWz54///pjLpfL5vN1fQ7AsHHDhtSxJrOlvKamxr24ahHbsPZVIc0LMjU1NZIkCeann37uZEd7658BfOTxeI7dWPktN93AZwnPh1/mOL1KZ+Dapo/6wCfF/U6hXwCbxQ4rPKI2K64yWNUAXh1zxbNVe9fMYKcs3SnKjK7S4km2y1YKbZuq2DFXPLscwN/UnFEd50PxkZKpADC9rJUJhQJSKBQY3enx/NXlcl1SXl7eBWCn1WrbYTJbOgBIHo8HTUcOL1YShhloZKm+fu2POtpb1R6PZ9eS6tta6xvqO+kdadO7urr/S6NmVQACVxZ+HAK98Wm4QCklCsB6r+aO6r1rZjBKoM5IdwhhpYLr6sTj26uZvZ1XLwaw3jhGraYOb8Tje3NPMQDEQLBvssvlXuVyuTir1fZzADGj0RwBbfMGsFCSBPWWrdsEpdGlMZrocrlGd3V1/8zj8UQALKuve+U+t3tfxOVyjW5vbf8tgMJYXBDnXnZYFedDl0lxP0ZIV8tAbfRq7liYx/9OXN9+wxk1AiYTx/7i1gmYqPvfxLrdhQsjAd17OnNEfQ42DGrOiKnFo5mO9lbR6+282eVyr3I6pxxsbGwsDoUCxbQwKjgcjvEPP/TwN9P5Jlpil5qbm/+ro71VT3mxcQD+UV5e3r1jx85HAVwVCgWEisv2MwAMFKiRjARRW9QAPvRq7riZOfjDeG9QzEgQMoMwCmJvUCQ3lGyN7+28+qZIQPcuDQ1GDNj0slZMKCljggG/4PV23v3m2+tXNx05/GvKXqZWzuPx/ACAJCe7tbW1TMPaV0WXy1XQ1dV9m8fjEQHoPB7PJSaz5ZXa2tqqUChwVygUEG+d2kQASLFA27kApQLQ+Nqe4ory8vKwNreQlFY2iCNiHUorG0TT+FFkVOd/JD5qnXZrJKBzU8BG3PmyYEYr8gsK2aYjh8VD+w/cO3/+fLvH4+kAIN/+KwGY+9CDDzjle2tkW7Vjx86HOtpbNV6vN9589Bjxer1PG43macGAvyEY8KtundpEcscV4hwlSgVgz6Zm58L77/9xf2/7A8xgQJ2VoskueEo8ov4Rc8tNC8J7jhTeHAnovDh9r+DIirPXeFFaNpHZsvlD8eDBg78EMGrX7j2yURccDgdjMlvukHPW6upq8Y231l3W0d56j8fjEQPBkMZsMvqdTqeqo711HQDpzjle5I4rJLFAGzNCGyVQoJpb47Mrl93x3Whv+wNMdsFT4nnxWdXV1UJP+zq2smp5+7GA8wZKEbMjLX/H+RDuXhDFnGuuZTZv2SoByLJYLDjh6QSVMMloNFe5XC4zVXdp57Zt/0lpGBEAsdvteo/H80OPx0PybR4ZqDNSlWEAxQJobY3PvuHKqxd2rX5iEXs2oIBhbgn166fWSuvXvqCaW/FvnpsW37cjV9u5iGbpw75JW4z3Q4z3Y/okFjy5jBw6eBDjx4+T2traSTQSIcXFxSIhxNAfjeDH9/3oQ4vFOicUDNSYzBb2o492MmaTkfT19akMBgOmT4Z062ybJIS9EPqFkQScMlAn3W2TZ8+t+LfPe9rXsXNuXDEstIfNlFZWLU+cOvCI6sqrF/59z5HCSso4kHORsO/NPYWb5tslr9dLCsePw5GmZng8HgQDfqm94/jVALBn985nAejffPNN8DyfajiZPhnirbNtJNHnY0YIlEiB8rXGZ99QWbW8Zf3aF1Q5BQuGLZYjKgv99o87xFMHHlE5r/3p51fPuv0fY22BRQrAyWDgiPGBZKgU92NiUW5EUDHNR1v6bD3+ADo7O8VoJCJFI5ETu3btGt/b23vzp59+Gvu8tZXRarWMKEpYdNM4cutsGxJ9vtS5JEGCJEhgVMxwJKor5OueWT6v5nDbpip22k1PjEh/z4kp/Wj76+orr14Y/2j764uKze61ON2FPChgSqDkNIeoLV+EfN3aJTXN9paWFhgM2TAYOIxxjEYgGMLJk6cAAHl5o6JLv1N8auFMVcFg9mkICRMBMERtibbGZ8+78uqFO2SWYsR9HudKKZ/Yda96zBXPxk8deOQeAH8YDDAlUAqwUkZZZbAmEn0+1c//LP298d33PsnJyZEKx4+Ludx7tXa7Pc5x3Jil3yletHCmShT6B+/nGgQskS5KvDU++6Yrr174/rkCdV5gAcCpA4+oRk16PHHqwCP3AngmjQsbTKqUYEnhKJGyTQxD1JbtY654dtYZRYr1i+/ONjF/7A2Kgl4rsSMASwQAorYI7rbJN1dWLW+U5/tVlMJAGQr1qEmPPwvg4fSgNV2qMrCSRK+VmN6gKEhx/9VN6xdXA1CtfmKRfmpJiWr1E4su1Wul3wv9gjTCuUoAJKK2MO62yUsrq5Y30nkmzud6z3szmzFXPBunE3kyEtA9QQGLD6Z+6YPSt/IF3gUgsXCmKr63uTkx/1Lm52wWqw5HiTACLZCoRLGt8dl3V1Ytb5BNxvle6wXZ5WjMFc8mqIg/EgnonqeJd/xsXLcCKFCSjqMlqviJXfeqAVw9EqmixwKAGPJ1L7zy6oX/s3fNDNWFAOqCgSVzYb3tD7CjJj3+/dCJeL2S2kk36sOxnSFft5ZG72Q4UiX0CxKbldzBrTco/ltpZcPfmtYvVk9dtjtxga7xwj1pgHa3iL3tYP78RuHtt04/lm0co64MnYgnMp1HKVUK9iEV4Oq1kiocJZrhLhabxcr53j2llc9eMNW7GJKVAuypNRYsdO4RGw9OvjV0Ir6ZApUYAqgBTICSDqOv4QAlAlCFfN33jbni2f++GEBdcLCUXNhddy3v39Ts/BaAnURtUQn9QgIXfkjU+7K9QfHnpZUNvz++vVp1MYC6KGDJXFhv+wPMsju+y7+2p7hCivt3sVmsKhwlwhBSlclEsGc5XmKzWFVvUHy0tLLh18e3V6vGXl13MRbl4oElc2G97Q8w99//4+Bez+wbhX6hLdvEnI3aEdLUcCibKrJZrNAbFFeVVjY8ToEScBHHRd0/PbvgKbFtUxVbWbW850D3tVcK/cJJvVYaqkzPK+yaeohEX+6fDzSJix4DgL2e2cB5NKp95WABILq8SwgAOMftn8NmsdpwlAx1QcO1NTLgtmmW17Z/tP310ZVVyxM97evYf0mwjm+vJnvXzGBoSvQjKe7/i9AvmM4SNzFpgBBFKHHGsUK/IAK4rFC9detH21+/JKdggbB+7QuqfymwJEkgXZ+3MFOX7RZO7Lr3l1Lc//veoChQqSKDpSgYeEvucHh1RugXElLcX0wBu6yyanniYgF2UTbPP7HjdkKB+gOAlb1BUTjbxVPWIHoOjIhK6BcEKe7PL1Rv/fCj7a9fLrO6/9RgSZJA9r08k4y9uk48seveP0px/z0hX3c8nbYZwmi3plEsojKQHSKMYClgtkL11k0fbX/9Ckodqf4pwZKBmrpst3hi171/luL+u3uDYnyYUThDE+lNacaeTUuBBpVK2lYkADAXqre+f+rAI7MuNGAXZPvv2tpa5ruzj0onuQeJPfZSvRT3LxoBUIJeKzHhKPmH0Zp75WtbuwQAuHW2jQ35undkm5jpvUExoddKQ160gvwTidrCqDljGMBNoyY9/sE/DUWjBErvWfXqCIGSFDHT/fSCyMKZKum1rV0JAJVCv+DKNjGqcJQMKzInagsDQIzzIT2A9acOPDJf5ty+UrAUQDF6z6rXsk3MwhEABQAJyi48XVrZsGv1E4vY+3/xqkC7oElpZUNXOEquF/qFA9kmZtBeiwyUstz9rAXw9qkDj9x0IQBjzheoF7dOYPWeVa9nm5hbzgEodThK/lBa2XB/26YqdtbotpR9uv8Xr4qrn1jEllY2+HpOfDFP6BcOslnsSJpTmDgfEul83jh14JHvnC9g52SzmtYvZrJNjLTXM5v9Grf59WwTc9NwgYp2twJAImfMeFU4Sp4prWz48eonFrGzRreJ9K6NAUOWtr1rZuTljBm/ic1iL6MMhiqTVBH16Y15aPOwqAhwl46a9PhfztWGMecCVGllg/j6zoTqa9zmv+m10kiAkhRArSqtbPhx26YqduFMVUagqIQJq59YxE5dtvtkOEquE/qFA4NJmBKoDNco6syRl3va1y0fc8Wz8d72B1QXFSyqFuLeNTP08y9l3tFrpW9RwztcoEQK1GOllQ0/adtUxbJZqTs1Bh0yYKWVDafe/ES6TugX9p1NJdNa0gkAEgnoBADP97SveyC74Ck5rCAXXA3bNlWx4+auFfaumZGrzS1cp9dKV1KgVMMESqBA1ZRWNqyU26VHcv+MrJKrn1hku/lyspHNYqcI/UKCApdJBTN5X1FlnsYC+GVOwYLHTh14RBULtA1rHsMCa++aGaqpy3Yn9q6ZMVabW9io10qTek58kdDmFqqGaaOEnDHj2XCU3F9a2fD0+ZB0aYBtYrPYyTJbOgywUuyqyjxNBeDxnIIFjw4XMDICoEoANGpzCy+JdremJEqbWzgUSBKAhDa3UA3gZ6WVDb85setezdbPr0iRdPINl/PmzZWQ7EomS5ZUAUj1v2PJkqpU17AkCaT5ndtUpZUN8dVPLLLPv5T5INvETJSD0WGAlRGw3vYHVMEvTg0JGBkmUOUAGgHkUTsxHOMoAZBslxQxez2zn6isWv7IxWAC8vLyDFv/dM1n2SYmj6gtKVbjLGClwhcK2BM5BQseOZuEkSGAUtNbVWYDeBPJHdAEDK9NSZ50P3/Jwx/ouMIPAOyhjuAE/TmK/jQrEmfgdN8XB+A4XZhCGmDqAByi30Hod4wF8IQ99pJDivtZorYMCZbKnLy7NhH4eABgicDHj42a9Pgve9rXsfQWQWlYYCmAuhHAa3Si4jC9Z2pvUP6Sh9/VcYU9SN5pX04lU74HKIzkLmlKPY4ieZvegCul2+DJgMqlfJY+YBIABJ+vi1xqfIc5m1RlAEsJ2O9GTXr8od72BxhD/iopHTAyhOotBvC/isx/uGGGpM0tJN2mb5/UcYX9Pl+XgzIIuhTRHo0q9ztVFhlYTqsFH40K9KfcyUw4rTa1l40CRDm3pFupdMNpfAe54wrPCtYQgP33qEmP30PvsBgAGBkEqLsA/I8i0R12PKbNLUS7ZimUwCiBpI9wAADoDJzEabVMBqkkw5DcjMcNBZgSqAxgAUBCZ46oIgFd3Uet026fZnlNGnPVX1J3WhAKEgHAUqAeBPBkWpow7LFfuivpjTRZks7AJY1QH0/isdOtkvKm0ArQAJzeXVc50sBGpI9PHS9/RpY2n68LnR4PAsE+FNl1mP2NI4gEdIOCNQhgcZ05oo4EdG92xL+9qNj2iiCrJDm+vTrFl+9dM+M/kXyE8Vlp4EwS5Q7diHisH7G4ALpRfpK00+sQDkdS21/SDXyg1+vAcfohwZIBU4KkPE5WaT4ahe9klxQOR0goFEAw4MfsaWUpwDIBNQhYSsDW2S5beYu/Yz2TU7BAJAoVfArA/cjQvXe2sa1zHN7a4IXdbsf0GTNhs+WC58PwejtTx8gAKYfZZIBakwWdgTsDKKVE0edkAAACwT7o9Tpo1CwU25YjEOxT7kWKYMAPt9uNm+bbcXv1YiQCHw9XstIBe2DUpMdXr1/7goo0rV+si3a3/hHA0hHEUAOAuv8XrwIAxo8fD41GgzGO0XA6ncgvKJSlSgJAlJKkBGAo1Yz08eD5cJKHp9KaCaxYXJDC4Uigo73V7Ha7idzA6/GcwOonFg0J2CDAyftW9KvM08pzChY0q/60xX6H2+1ZGvCejEOnU5tNp90ufZgQpqft0DdrdPKGot+8Pw4Na19Nvd/T0wO73Y4Tnk4cPfZXGAycRIH7YuasWaM57WnxUUiSoAgnBqgdz4dTAIVCgQHGn7PlpkCXpWrL5g8TR499lgpM+/p65UQcAHB79eJhSRXtWiQhXzeM1lz9niNdTwC4mTz04AO/93g8P9i1ew9isTir0SQJBI1m8NYojmEAnQ5+vx89PT2npUGXNKYmkwkcw4AXRcRiMcRicRgMHMqdUzF9xkyUlhZDGeDS50xDGaLw0ShCPT0IBPsG2D6O08NqzQUfjQqH9h9gm44cxrbtH6WAMRiyodGoB8wrFArBaDSi4oZvAoC8MxJVa0U7ZyQCXkzGxnTeEgDMuvrKzvqG+mKyuGrRUwDudzgcgsfjYb1e78AvONuIRODx+xGJRFJgsawKGo06BXgsFqM/43Kfu+R0OmMzZ83ix43N34PkdgiFAMb7fF0MAJFKl+yN4zoD18pptRwfjY7ZuW2b5Ha7hSNNzSr5vGySeJA0GjWJRCKK6UVgMGQjL28UeJ4fUSrFcZwIgCmZUNxc31A/WeVwOGLy1piy6tntdgwbNJ0ODp0OJ0+egiAk5EkjFjuTiDQYOHAMgxOeTnL02F+z1r/TSMY4RufZ7fa3lt1xx1qr1Xa31WqbDEBlHfjRzxsbG7ds2fzhta1ftKEnuYmGSqfTpRZISLZ/kUhkIJmRk5MDi8UiX/wZC53pegY6ISNKyyb2A4irTGZLXAZHaacygCYbPEkRVpDTCe0o+P3+jCBlWDFZ4jStX7Q5W79oczYfPSY9/PDD/pKSkifp908BMPrggf2XPv37ZyacPHlqAgUEBkO2EqBBh8lkOhOg02mTBJ2OHUxbZOAoHmoAhEFyy6SU/ir1WQatZEIxzCYjMZuMrNlkVAFg6N8DjrVYLJBtnixdZ4CnWDmqpiIAoaWlBW7XJzkArqO5pAHAmJdffhktLS2SRqMWWFYlyZI7FFAsqxocqCQQDCIRlueTj0U1m4ypFwDwopiyXV6vF01HDjOgYcKAqwkEQwgEQzCbjLDb7XA4HJhQUiaNG5ff09R07L09u3fGAEwLBEPFADQ8zw+YlEWrhT9NDdMB4xhGacsYAJJOp5MAhJzOKY+73fuMAL7r83Vp7Ha7pNPpSDrbwbKqMwCTgczLGwXlQirMiWS25xEAB5xzZh83mS3fpNtMEVmDlNrBMQwCSYERAEAVDPj7PRk2wD/h6cQJTyeajx6TPB4PHA5HE4C36hvq3zWZLOHXXvvrIp+v+0m365M86hiIPCmNRgONRpPyhGdE5KKYYcEjMJktBgCXAch1OqdctXHjpgEgaDRqxGLx1E/5fdmwy9Kd7uVk4Ox2u1RaNhHTp0/rtFptdY2NjaMBTPJ6vQwA4qeOSv5eXhQlLhKB1+vtJYQVVQACshoqT8JxXNKV8jzZtv0jALgyz5h95TVud7jcObX1V0880eN0Oj+dUFKG/ILCMaFQQAoG/ESxaeGACSs9Ecdx4Hk+BSi1Q6TpyOGA270vH4DP7d632efrNgP4fwCyZfbhdGgzIMQhyvPIoY3ymswmI7xeL+P1eqU333xzBs/zXweQzXEcS59iN2BhBCGRnJtGAwRDEgCoTGYLoXfCn2HgZAkwJKNpkRdF8J5OfSwWmwgAR499lpq4xZIk3egqSgCIchLp9kOOwyxaLXhRJBqNRnK59+ruvPPOGwCIfr8/BkCv0WjUFBii0WiU/V0Sx3GkZEJxEEC/1+sdFUheFCmZUAyv1yvfUoxYLJZSL0FIEJZVmeicB0gfz/PyMSnzodFoUpKpMhrNOAMsuiqcIkhTRNiSRqORYrGYZDBwJBaLMQBS9wbSn0QQEohkcM06nQ6RSEQEQAyGbBKj8VgsFiORSEQXDAZ16TZIlqBYLEbSpcnr9XIAdIFgCIhECHQ6NB89prCXsTPsmkajlqhQkPRQQWkPU9JFaSGGMpNneMGzFDkYjUbD0p+ydEnJQFTte/yxlR+uXPlfrQZDtpTJNpU7pzLlzqmkr68XPT09ktfrhUajCel0unaTySSZTCbJ4XCIGo26A8BnGo1G6OvjJYvFcjKZxgwILlU0qB10pHvlWCyeCntkRzbUZ0GfE6QKhQJRauDJYKmNnLYMlQLJn4/F4sYNGzZMe/gnP22/++7vu1etWlWuJPWW3/k9LKm+7R8ul/vAkabm2yORiKrihm/GHv7JT/8K4FKfr6tAVmOr1SY5nVMO1devJX964Xn1qid/111f90reC3/6s2Q4/RiuQQPKwUYquxjm8TQ1S23phkAwJKXHTakJUGOsBG+IiWga331PA2Diwz/56T8AdKxatSofAJbf+b3YkurbPt6xY2djTc0vvwNAXXHDN8WHf/LTpsbGxoVNRw6bvV6vhOS2BHA4HAX1da9Y3W73KboYEzKpV8Z5n8cYLIZTGY1mOByOAXo+VEowFFDKFKPx3fdEh8Px9SXVt+1vOnJY7XA4jEuqb/M3NjbuXbVq1b06nW4MkNp2XGw6cji7Ye2rUaPRqA2FUl40ZjQa9QDGV9zwzYAi1iLpsWF6inK2VC0Wi53hdGKxGGRbazBkQxASyMsbhTnXXIstW7dBFQoF+k1mC0omFBMlYMNJOmUpU4YAsgHW6XTM+ncaJWf55ZNLyyb2FuSP/bDteEfec889dw+V6ATLqlR/e+PNLGf55a8uu+OOz25dvPiKSB9fGo/1S2pNFikpKTnc2Ng4etWqVXlerzdO1TN1W10sFpOoV8zYu8Fx3BkGXjlHv99/hlSyrAo6nQ59fb2w2+1YuvQO2GzJQrAK9FmD02fMhMPhwOYtWwcAlQ6CHH8NNYLBIBwOh3TPPT8gOgMnNR05rG86cnhXfUO997WGhu80vvve9SyrYgUhgcLxX/u6zsCZfL7uvK6ubhOlhEl+QSGA5snBgL8ZgB2nH4PMKD0ix3EZba0sXcmFjJ9htGWzIocX8pCpnnLnVNy04NsoKCxAqKcnDCUrGgoFkF9QiKVLC7Fn9040Hz0GObLX6XRJoGiaIhvGTNIXi8VRVlqCxUtuI9Y8G15raEDju+8RnU7384cfenhlfUP9M9fMuUbtcu+9FgCcTqd33Nh8y6rf/sbUsPZVyWg0DngOhk6nK6PMQpDa12AoFDLm5OQIGo0mDqCH1h85AOMxxKMeZFZEDmgtFgv8fj+ONDXDZDJBo9Gg3DkVc665FpdOnoRIHy9Xo3jZZhEldw0AN1Z+C3OuCeNo8xG43W60ftGWdNcGDtwg+q9Y7d6lS5duN+bkTHmtoWF047vvMTS2Mv7tjTf/02S23LN5y+aHlyxesrrx3feuphdnAyAZjUYi2wpFjCVoNGomEAxFAfxh3vz5P5g5a9YhTqv967x5czfSRNwLYPKSxUved7n3aqlqkXTNUMZt8rhixvTU79NnzERBYUGKzk7R231IJdL96UaT58PQqFnMnDULM2fNgu9kVwq4gPck/IpigjIPpH9zT//+mWvMJqP3SFOzfPFEp9OJkUhE/+KLLz4JYN2Nld/at2v3nulut3vfkurbnvN6vbcDKJbZUoUUsDSin3jnnXfOu+/HPzoQCPZdFgoFFq556aUCWsofBWCu1+slHMedfrpUJJKKyJUBck5OzoA6gQxQRrucpL+TW73V1tbOBPCRsgpDH44N+qRJWK25A4qYLS0taDpyGMpMPZ2dlNnLNDcssayK0EQ4ptGoNTSGCcdicS5TMVdJ+chqLgNpMHApj5bOfgBIpThyakN3+D4rQIqqUsJqzVXx0ejvbrlpwUMZ1TAcjqQAU5alkgXNXJSUlKCiomJAYbO94ziCAT/kRDoQDEmIRIg/GkUkEpHBJAoSUUNtEQsgOzKI06AqrCTtUpROXx8vUiMvjXGMZgAwcjQukwP5BYUwmwww5uQoWwaGFW8pirlJb6jX684AK1XlSD6qHWeWyFONGrBabbBabbhs0hkPaSI+X9eAwgM9DwkG/CwAeAZ5NqLX6x0sBWEoEATJLTsZWRPk0piyWn226vYIBlHarCEfFiRXg5UNHZmASx9Wqw1WABibn/HYwSYfGZj7DQlA+vHpnx3O59NtVIZ5BQFA5fV2hoMBv2AyW87pCUtDjcHASb8gZbE1o4T3ZP5/Jqk/V6CUQpABsCSlK+/eP+hEY/242GM4Fy0fN9xjR1TyytBjoXzPd7KLAQDG4XBIygcpKu1XLC6cId7nqvdDfW64C5J+3PkuJKfVDtqMIv+/qekYtmz+IMlnTSgpI7SCMaCBQ9kFczFHpguOxYXU63wkcSgVHAok2d42NR3Dyy+/lNrGmAmHI/12uz3RfPQYtmz+EB3tralSebp0natXSe+IGZQJyABQ+t/xWP8AgAeTrsGAOps0yb1e9XWv4De/+TX8ySfPJ2RvGAEQM5uMukAwhM1btsJscsPpdGJCSVkqMFV6RRmAs63OSKRqMCn6MoYMUNvxDmysewWbt2zFyZOnUgFxIBjyD0ik5bgmEAwh4D2J9e80wu12p1ICG+1aSZeYoQDL1LV3LkDF4gKSWc+FB8jn64LL5caWzR/A5d4Lr9cLZVuAklxU2Wy5AhS31ppNxlQKf8LTidYv3hzQczWhpAzWPFvG5rOhIuTB1O9iSdRgnYJyytbUdAx7du9M1R5OeDrR18enWgPkNGkAUxqP9UdB73pX9jzI5B6XLFXh6LHPcPTYZ6ndHuVqdSapywSk3EslS9VIQRpMupTGPpOdivTxaG9tRygUSOWzJzydqZoCx3Ewm4wpolBZCgOSXL38MDbVZZMmCwcPHhSVqYdMnCkpZINiIq1ftOFIU3OKG7JotTDb86DMy0xmy4DeUflC5VhJrclsnIfr6WTAY3FFw1tLS6qsl8pRvSdxMtSbYh7kBF9Owofi72OxONFoNPB6vYGUzZLjLKVUpZokMhB8Mi2Tyu6jUZw89hmONDUPYB7kRFhRrzvNtg6j0CCDn6lMJ1eZU397T6YWV654n6aNkltxKdsAMp2Her5M80hWd5zOKVFFfnhGunO2as7A8tJpzlumZyKRc4/XdIOUqpRsZwownS5FTCpBHKzfIhP4mYqsFJMoAKgIYeOLqxa1eb3eIqWhH1H3XxpjqpycbojaXCbmcrCFkL9T2VEoS326hMpzH6xYMcIyGPF6vUFlNWQFDbxEAJJ8Mp7nz5CqFA9/lotLV8dzmbSy50B+L1ldjg0AIlMpTEFzD0vVM5lFllWxsVhsO4B/AGAY+viWv1PA1LS5QkhSsjH09fEDJqYEj2MYcAwz6KTkslImKUr/O92ODAZcuiTzPJ96nYsWpLOwAKRIJBJnWZVao1EfAvCdLVu39QMAe+jQYSyuWsSuf6dxxxUzZnCJRHxmtL+fgVotRqNRMRaLkUQiQRiGAcuySXAIQVySoCEkBZ4gCGlgsBAEEZKU/D/DMKnfAUCSRDAKKWVZNvUZ+f/yz0gkArVanfoeQRBTL/ncLMsiHk+WuKL9SS+rEQSIDHOGzWJZFhqNBjzPQ61SwWAwwNfdLYZCQQEAq9XqWI1GvdNisVQ2NzefpBoosgBw6FCy++3QocObvn3LLe/7/T0F0f7+r4miyPT39xOWVSVYlpVYliUavZ5AnbQbvGJ1lGAlG80GgqUEimVVGcFKBzkSiSCRSEpUIpGAWq2GJIlpr9NAD1A92gGUrDKLZ4BFX9Lx4yfEHr+fjLJZmVg8zmi1Wr/FYvn3FStWfP+5557rxekNNQZ6PodjDOvxnBAAYHHVonler/eeQDB0A8/zGkWVNyFXhHmeZzKJtbI7T1afdLVTqpXs3ZS2aShOfjDvaNFqTzd7RCKpKpTieyWWVUkGAydXslWyfQsEQ66SCcWN02fMXHP//T9uVdDJmW+hA04/bko+qLa2tqTpyOEFXq/3W4Fg6HIotiWgdiJBgSKny+rx1HengzKY11ECdq5gKWM4ABLP8+jr40VBSEgAmEgkwuh0OphMJjkLiZeWTXzl0smT/nzLTQt2Kr8SGR5qMiiFTA2/pAwnHnrwgWKPxzPH6/XODQRDXwd9FrQyAFTYBxlwKQ0wJYhkMIOfCTAKlKT4jJQeTgAgHNVvfzR6uhSWlLpwyYTiLxwOh3v2tLLtNy767m5C2IPyB+fMnqWac8214mCPPD0r315bW8ts2fwhQx9NlZroR9tf1z33h9fKAEz2er2XAZgYCIYKAOTwPG8CbTA7M98a2LeZ6e8z8jsFaOkZQXqroyIciAHodDgcX5jMlg8K8sd+tHTZ0s9MJstxRZcOFlctYkvLJkrDecT7iIoTCuCkTGIqSYLK7d5n2bFjp62jvXWMx+MZjWS1uLj56DGB53kzx3E5ACxI3gaczfM84TjOwPO8KpNLpxKTiMViYY1GIwDo5TiOR7JKfLJkQrHK4XCQ/ILCsF6vax9tRPPMb9hOWvIrfQDaTSZLnxIceb1qa2vJihWPioSww35gyf8HuMzduUTTs9wAAAAASUVORK5CYII=";

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

const XII_MARK = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAMgAAAB5CAYAAAB8zm5OAAAc/UlEQVR42u1db2wb53l/XlLiyZRuiyhPa2KLtmK1c6s1cfthsloHVIe2aAgEmYMBqTy7kNMYwZAVSj/4y9aVYYENGPwhEbp0COzVQuzaNVBYNYzR6woUEupN9pe4bqbFcKXIpqu0Va1jijNpUcrx9oF8Tu+9fO/uPYpHUdH7AIZlS+L9e373/J7/oGk59cbNmcOallOBEU3LqZfz+Rbe96RI2ayiaTnVS7cnJlbDmpZTiabl1KX72iJ+48HD5WMAAOrc7Ut9zx3U2Q/Gr2OxTl3eaimbBRDXrk0XAAD27x+Msrr7n9/8Zvgv/vHb0bv33n/WDIX+EgBAVSLDenHlPAEAePudd7+vKpFh9oP14sp5Uir9bFfPY5c6Y50PCIBJfz+TyYQBAK5fv26m0+mSfBRSmkFSqVRoYGCA8MAAADB7cUKNDQ0BAoKn+2gsCCIMrYg6PaW0Xp2E1QNDoA8mik6AGYt15tMAJR5SnU5MipSgrEOx+CVIJB5w9U7Tcurde+8/CwDgBAh1ekoBAGi9Ogna8VQRAKBre6y7hXdQcmsGlOw8tF6dVAAAVg8Mlb8xmBgGgOGl+9rJw7fn4FnawrzUWSBrJ6ezgJG0TEo9wAAAgHQpmUwajE7prHUAAFi6rw13bGurAkTr1cmyvi9kgRgGmIUCmHv7LWPw8VinTjQtp8ZinTpNs2In0kooO299mFkoAIlGoRTvBRowbham4+/+thA590PDLx+UIsUJDLyfm704oep7PiFsHQAAULdRrwEAzHAYiGFA8dBR0AcTxQcPl4995sn+sxZAbtycOdyxre0kDRAzHF6zKoZRM2AAAMj7f/jJvqc/93veRaIvI0EjnWi35/+LK//zJ/GBTy57+Q48QNBgQECweg0AFkC6tse6Y7QFYf0Q5dxpC1W08D5YFDCsldEmJ4GNlPEcLRk5+2haBbfgjqgjzYKBpksigKClFO8F7XiqqBdXzn/20598AUyTWE46S7O6Xvm64vZhIoAxw2Ewd8SFQQPADy87BQIkcDYHELxYgYgT7QcMNGUSETMcBtB1MPf2g3Y8ZdGry/l8C0GKk0wmDSeaJXogp5MzC4XyBXGsjAhovKwNWpzR0Vfar12bLhiJBPl8cWWbBE+wIBgbez2/b9+3iKL8FNyiSDyr4BcMNFVCXfJjHUSEpVeallNtFoSlWZFTbwCo6roP7GRlWNCQeBxW4o87gqYW4NB0jf4/mbvxbwlEfUQ/QNgoMPB0dOn1fy8CAMz92792fOW11wwAAELfDJpmqdNTSuTCW3U/EVHQ8OiZF3AAAGjwkG/9x3Ln9w6viioCTxk+ilYI3/6jo6+04zX7paw8EACUM9BeQPBDk4IAA4/tsP7HxMRq+ODBVoPQkaR60qx6gcbJ2ogCxwk8AABOoWgRxUKlonk2rWi0AgYBMBrUY2OP5EdHP3A9Jzwf0XOZvTihPtj2p20YNRIFgQgQWKvQKDC4+R8rL75sC++iwSA0DUmn06WgaNZ6QeMFHNri+AEPD0A0iLTJSYj/6IIvIIkqNi1jY6/n6X8juFipB9jw7Q8AlgXwAwAnEPgBwkaAQYRe0f6HDSBONEs5d7opaYLXjRYFjwiAWCBZx6UARYMKACB7/d22joe/WwaAugIMAMAEIHMXJzoAAFDRUWiFp5VeVPF5APALgmYFgmh4F9mUzQcBKJf4HvyrltKNX/7f37A0q1Z61MzgcQIQGzDwC6RawOaoqD6UuhbFZ5WfB4DNAIJa9M+JXjkCZL3RLDr/0axvD/rc3M6Ppxz4uyyYnCwTT5Z6Hi9Fdvas1lPBvRSeVXyn66v1XjXDC5D1U0Ve6mx49+HS/O4nBr/4O8QBAEBLFb81TRIjRP/V7Tn7DfS4OZbzvJAF0HWuYjXDTRZOfqqUq1D5Hfxd4nDzI6dm+MekFPAxgBAAKKzyWcfeEQeykBU+d1rRvRTejjSVpmzcz29WQNisWwUQaPH1wUSx/FKfEXqpl+K9oA8myvRq8Iu/S6VSIdrPq6rmzVy5EkoCGA8eLh/r2NZ2Uh9MFFuvTjrSLDRTqweGoPvICJmbnV+m49pV5roJQVMLiLhvWdWh8ZLzeU7HID7efFVAZhTe9ThN6hdw9YJ64SIdpisz9vT1WqW63QBtuRNpk0Sj9uYlB71l/cl9+75FANJr/8+LstRCs0rxXuh8c7zq8+Zm55fxM9jiMScrsxkcOynB0V2nyovO3btJ9tFdyzQgePq2/Rsjiug58LLnrhbEKYzoRbNC2XmYm52vOnnr3329AEdGbICJZN+DUjbrGBWRoPlogoFQlNWtDAmDIrRO7QFo8/LRzELBF72i9Z7Vf27DFBXuPa8qkWFRmqVOTynQ1+t6UjbAUKiP/+ZuW+7OHbP16iSYLqFECZrNaRVoOgOCYOj2AINTgEKEXtF6gxFF1no4AgQzsbt3fGx06b42bHMIHZBJotFy9OTIiO+buqevtw36eqH7KSD4+yw1MylLZXNMJXA2HASOQAAAU1UdK7rXCwYuvcrOK6LPH89n946PjdJ6b7sutw/IZDLhj/f92QNUVKceEVruf3e86MYR13sD6FAnz6dhIzmuD1OKMADY++aWS3IDQpCyeGbcFE5JOBQnstLiBo5kMmkEQbNqlSp6xrE2CBweTaOBsxWtjpPis9fO3jMeCESAUA+r4JdeidwDYhjWdejFlfNfee01g04OCgGkUnSnV8Jfw24crh40q5HAQavD0gEQyB+4KZmI+GriWafw8hq8vAleu2g920YDwYlddC1kFZGcnVkoWNeG4V0jkSC+LAjKrp7HLi3d107iDVPOzbs+DKdo1kaIF3B44LENq6AUxspC6/5qBYWSdoJAclRuJxEso3FT/mYCgVf0CnQdTA96RQwDTFW1rpm8/4efAABUGux0YYDQMeFmoll1BQ4DntxLIyYdiDB3xK0ZSbRgxE3EzJsBXQOvVoyn8F6KvxmUv170ynomFL367NOf+z0veiVsQSgzJESzrJNtMM1qCJgoUHU/5RDgaILr/igovF96FQPwpFd01QdNr9wkJHICdBn36oEhR1NPDANINApkIWujMVKkBE2vyK0ZT7+NGAYAh17VDBCaZmEyRR9MFN3CaDaaJUVKE9OrfR70SsiCXLs2XdC0nEqbIzyIY7wco1lSpDSAXqHOEQ96xUavTADCSw76AghOsfBDszDqI2mWlGaiVyQahaWex0voNhAAkx5WURNAeDRrqefxkijNmpudX5ZAkRKE5ZibnV/G2isRKcV7IbKzZ1UvrpznVe7ypMXPSWE0K7KzZ9XcEVeIw8QTYhgA0Sgo506Dcu60Uor3Qg7AxNAkli0DNK4MQcrmplBseVEMwJZuID6jV/Q84LoBhE0aYteW24kRw1ibpn1rBiIAkAcwt0ejFnDw89jmFylbEwSR7HtgZstdlV0LWUWkP96LXtFVEurc7UuxJ/v1yoSZ9VsQXtJwqefx0qOqGvLKWtpQzLSx0mPoI7dmIHZ1Upk7nlqWINlaEjuRVsitmXK9F7Y3AFNwyrQI+62bs7XWPndQiF4J+SAONAsqNGvtAgRQTP+pAo6qArk1I8PDW1SsYR8VXaABweqO35ZoXu2VCL3yTbFqoVlC5g+l4rfMDSYCsSJzs/PLXRdOK7z5v9JqrVEdp1Ka7iMjJFCQBFBNzdIrjMZiMa7n7/s52HrWJPg1h7z+9npI7qURE8257S1TmSZCXws95tSt9iloxWGjgEGBGfspaKpj3aO9/YE+Ez9jemrRJ3ownCi9qsmC0NEsgMqYmjrO7zXDYSC3ZmDxzLgZhOJpx1PF2Im0LQJHDIM7TcTWiFUJMLCy8uLLgQIjdiKtxADKXXIL2XKS9s3xQC0Jy/mJYQRWdBn0dRDD8FV7tW4fhDZTSLPMQoG7iQr/+DWJBKlWAPmTPX29bW6JziqhOTHDj1defDkw64HgILdmIJSd5/evBEx3NksDmZOuseevzt2+FChAnGqzVl58GUrxXuuPNXNI1x2B4/kGq0Q3grih3UdGiLm3v7xVSCQDyzqHlXGVQYMjlJ23wGiGwzX3lnyUxBEIFV0zw2GbLuJYH724cr7PR/RqXRSLpVn6YKIIg4k1pDpM/ra9BV0eNl5o0FTLr/9Er+pqhOUwN3CqftNGuzAn4nMVRi30al0A2dXz2KU7C7/ljsu3naALcNx2j9DZ+CCiWnv6etsWn/+aryZ/YhhQCtBZRatJbs1s6MqJZpZSvNd13yUr9NLYhgCEGbD1QiW6NQoAntuGWOB4LejB/4+dSAeSQOw+MkJyVydNr7c1u4WoM6CGJIywSXA4C1ZcOAGB9pF5VMrvfpWaLQi9bZY66Fn670wmc2z//sGo06467HF3mx+LVCuoNl6MarmFGfH8tOOpwEphJDj8yYOHy8cQDE5Kzy4rqmX5UM0AoQ6mA5Q3VOHGUwDbskedAc4LmEepvAlc5/5ik33k1BuwCFB3f2RPX2/b4oEh02kaOL1DIihwfPBP35bg8CmfebL/LP1vestxPXdLhup1wul0unTwYKuRTCaNZDJp4MmlUmZI03JqJpMJa1pO1bScipPskHaZe/sta+H4Fq80YQUR+u0+MkLgy09XRbVocATllC+eGTfhv65IcPiU2YsT6uV8vgWtRDqdLsVinTrqXr32QoaCvpB0mthO/Nq16UIs1ql3bY91sxEIEaoVVOh36fmjNqA2ImLlZxKgFLvEf3Sh8Ex7+4dBHyfU6AtLJpMGL5dSPHQUzELBfexlpaBx8cx43RO7e/p62+gRP8QwwNzbzx37I8GxdSS0UQfOZDJhv1SrEVn24qGjVq4mKKdcgkMCxNPBRyfeD9Wy/AIo5wuC8kfMvf1QPHQUggKHcu6055ABKVvcgjiVrYhQraD9kc43x0kQfgeCQ4oESOBUK0h/JAhZ/fkkSHBIgPi2Ivg3S7W8yudpf2T155NNfZPnZueXC/+cMmmKKEUCREiSyaSRyWTCsVinjtlRfTBRXHn+ayCqUA/OjpvNOlpobnZ+ueuVryt4LdLvkACpCSSallN//MSnztH+SCne61mSbobDEMrOB+aPrBccsRNpxfKbJDgkQNYjaUJKtD+iHU9Z/ogb1aJL45sNHKE6dltK2cIAicU6dZZqoT/iRbXQaY+ceqOpxp1iAaQEhwTIuoWuvLTK5Ssbbr2UjC4LaZbpJHv6etuif58mUsUkQOoi165NF5LJpHHj5sxhLImnm6rcwBF0WUit0vrUEGBeR8rmlJZmOAlMGGpaTsWZW9bUboGdc+ivNONsq+4jI2QRQJaWSAtSOzimpjoKFXAsIjhEyjFwal5QZSH1BMnKiy8LDYmQIgFik7Gbv3h48GCrgV2HSK28HPNGlKPXGySik1SkSIAAQLnMJP2FL3yoaTm1Y1vbSQCArgunrYUoXj3izeh3uEnnm+MSJBIggmKaBCkWTa3I1SlPatXsfocrpaRyOxIkEiCOcrlQCCeTyZqoVZB+x+KZcTP30khgCUdszCrFeyVIJECcHfNn2ttt1IreNSdCrYLwO+Zm55eVc6cDz8rT3YsyqiUBwrcg+XzLnYXfjiE4RKJW+MYNwu/A0hAAsLLyQYOkeOio1EAJkGrrEYt16jtn73yVTgiKUquV578WCLWyxn3ixPcAW3tRuo+MEK8GMSlbCCBYTlILtQJdB/jy0xBUpx87lyro1l4aJDJHsoUBgrOwMplMGKBclEhTq8iFt1ypFe13LD1/tBgEOHj0rhGtvTRIeHO5pDhL9q+fj2paTh0bez0f5HFa6gkE/Nplup1+4+bM4Q6KWon0SuCOuXpTq/JKtrcUV5+Hau0NMiH5yD98h+SyWVNOdReTvucO6rTu0TsHmXG4GwOQTCYTRhBwgABQGUk6e3FCjQ0NWYOtaWrl1SsR9GRDkWamoEef2l4y1Jxg2UPiLjduzhze1fPYJW1y0lH36HGkyWTSaChAKge0TowFAg6qNgFg6b4GHdvWXv4iZez0ugF9MFHsrvNE9cUz42ZE8G1Nr2JY3b0bWp8aCiyyNXc8JRutBKRjW9vJpfvaSfjzJ+Dtd949D1DeAYKg6XvuoJ5Op0vpdHpdlmRd093v3nv/WTcgIBjwawsUzLJM1xtxeIR01pla4YQRP1QGlTX/L98xlx7dFVgGH0Gy/RsjigRHtbRenYTY1UnFtlR1MIEbA4YRNL+6PQfYvo3Aadh0dywPYa0CCwQA+yJM0RViSK2KL74Mf1znt/Xc7Pxy7Oy4EgJ/STqaigW1r4QGyeKho3KGFi+qhGsqsvMQKVwBEo1C5MJbirkjXn75UZumaODcvfc+AMDZQFewTUyshrHyFsERO5FW0CI4AgH37AkqZZDUaj3rzaoiWwFum2X7SKQwL1DUK2ZLceTUjKWDCBzteKpY6VI96xuQfn4Yd3/QLbGhLLUAp7IBlrdkUXRrKiYEg4ha8fIdog/EtjyyQUPr6BwJ/QLa6uKkT9b66soLhRiGtXxJVSLDsxcnrMa8QACC43nY1WqoOH6A4Eatgqi1mpudX45ceMu2NVZ0TbV1TZXNvaDr5TdUwOUoNEhK8d6GWpJaVng3G3BwMzBSfn3PJ54NzAfh0SuRgQq+KYyqBrIHMHYirfD2jLv5RWY4DMhtrZ+nncMGSfeRETI3mLCy+UHtSLRF7aCcfyLR6Ka1XFUWpgaaJQwQJ3pVV14Z0KqzxTPjZisAmHv7qxQcF0Kq01MKzfeJYQDy12boOWnEObit897sjr06PaXAYGJ49uLEKD04vW4AQXq1dF+z6JVZKNRlEAGd8wgiEacPJop7joxwFQyDAHMAy12n3lA2QjGbRaquNYClqULOdx1ZCb54W69OAgwmkGYJWxEhH2RiYjUMsLbmGemVnx0XNOev4rfUwpqNevvGf3N3ywChKSNThcKaf0fplKveiPolFI1GBlRXilUrvWKd9youG42WnU8AWAkgauVHso/uWu4CUKSqNl6046ki0rnWq5OAUQ+ykAXWb7Qpu49Kg1pplhBAksmkcTmfb1EXfuuPXlWiPQgCgLVEDr0MfivRGCkOFh7p3JERAABbHw4PPKHsfBk8AslnpFmR7Hu+aZYnQDKZTDiZTBo7Z+98FajoFYlGAVzAUYr3wuqBIQsILAi6A47ESPkI+UMO4MGaPi82g7V0pWzWdzRL2EkXpVeI1tUDQ9B9ZIRIIEgJDDx9vVCuNhBL/vJo1rqddF5y0KtFlESjNgolRUpQog8miiLgwAoN6/cqScPL+XxLzQDBLkBavKJXxDCgFO+VfoWUhlkTTOZ6rcigs+rIiMJTU2bNACkWvwQAAHSLLFnIeqLUVlEpRUrAsnpgSDjbjzQLa7O8GqlcAXLwYKuRyWTCttorgb7pzUivZB5kc9MskZwcS7NiQ0OOTMnTSccY8f79g9Gl+5qNXoEbvdrbvylvsmgexG3CiWhpRiT7nuv3/dR6Ob2MtloFQC7ea3p1YWI0C7PqFWb0gpFIEN8AwSZ4LE5c+fW9Vi96BboOJB7flA+HVm76BrNjSGMVENFdkfUu5ov4+Fksj8EEGuaccgAmS0PcgLXZAbV6YAgwmiVKs2AwMbxy6KvHIu3tHzr6Ll4f9qvbcw9RgdyWwAQ9YKEe4pR8om9c1XV5dEM2S0m4Y2+/C3hJNFpVsUwXc26mZO7c7Pzy9m+MeFpwWk/1wUSxa3us2y2r3uJGryrFiTZ6Zbo8oKC6AGsFAguCGIBCtwDTiuJsWta6IXmK2Mx941YDkZMw3XhmoQBwa8ayYF2n3lCwEgItEm2JnJLAm4lmVeoLz9JjgzwBcu3adAGHMrBDGNysR6NvlhMQuhayClv7ZQMBozRurcCbeXCC365JLpgMw7KsZqEAkVsz1re2nzut8MCzUcDxS7MArDFUZ52iWVyA4OCtt99515Y99yoOCyq8i0CI/+ZuW+7OHVMECOwDp0Egp4X4BxMXQA7g6Tr1hgKqCrkd8YYCRx9MFLefO62YIi8DXQd1ekrRBxNFmjGxNKsKIKlUKkTRq2GWp7uZrXrQK55VQGpUADAjjE9Q9eAkCBoOIB54kLrRwKEtThCgoWmWiL7aaJZp/uDalSsFTwsyMDBA/NKr9WTP52bnl3lg8LIKaBEkEJrc+jAvrxAzfWT7udOKGQ5Dbke8LqChaZbnQMAFqniRkLP7tVwUqGGIXIDUQq9Es+dsFSYAwPbsvML1FbaIVfCKgm32a3b0WdkXXXbeBhqepREBTOfu3SQPYArd9wrNgsHEsKblRmOxTj2VSoXS6XSJCxAmejUMUE5qYe+HW7iQR69Y68D6DJsRDE4KXev51vs6631+GwEaJ0uTi/daPo2Tlck+ums5trdfqKGPcGjWwJUrxNGCsMlBAAAzm4WQV/a8kpxCQESy74GZzdqsA9dnaCIw8GZ5uT1cXnck/TnsNJTAlK1CE6zzpTrwiGgzURMASRQ06NOwVoYGzOKBIc8SeCtg40GzuFGsWiaXWAOXK4oTYqzDRvsMXgMBqhSfUniesntRykbVo3mVt/ACLLbZyBVAiSZCG/n8uMcSAEwrXo/IuVI0i9eK2+JGryyF8XB4bCDaQEC4gcAWDuZkkJ2Ufqnn8VJkZ89qs3J8TyBSY3xQVn59r7Xr3nu2QlW0+iyI8L6JAKgRz7rqGBzA+JkBTdMsbMWlk4ZVFoQdDCeMxAa/YeiBEFwrwAGBVz0ST7zqonCCuHUOpdLPeD+3q+exS/W4bnqyDM/qW3rDTL+0XdPOnlV9Z48rkFgQOQHIyQI1CjhcwAgej0uzmFZcyyG5nM+3PNPe/uHb77z7fVWJDOPm2WbyDaom5eHkPwoIToPhfL2VqbH5PAX/byXy8BmXArdmEXYGLQ0uGlBuYBKldjSVo4eZ897mvJfbRuoXMQwoHjpaLpv/31929z130KJZhL2hS/e1RbwBbsWJjbIKIkDwCwIWAKj8fvdHsAqIq+fYdWB0AITeyjU29noeXn0V4NVXOZ/+KoyOftDOfn6x+CVIJB5UHQOPPTb2en509JX29VwLvQSpFgA5rcJwA06jqRob7jX39oN2PFV88HD52Gee7D9rAwjjfyzanO6Athz5AQOvQC4oAJQXQz6SHxhYC/fRCmgFJeq0A68RVgRBQwOVBqvItVzO51s+X1zZxlohP+BZD3CCBk0p3gva8VRRL66c/+ynP/kCzqImAGujfW7cnDncsa3tpLV9to4nxbtQNzCIWgW9uHKeBoLXPjp22Si+kTeT0gdJx9iqVpGFmPi7tVoety1kjQQN0qztr0//Uef3Dq/afBAA8d6PjQADCwQ3hWYftp83pRQxACGdo7POXuCpFTgiG8vWAxqnHpFMJhMm9aBXboDAJKIfn4EFg5ti4wpg0QcmJSAa1/lIft+PPySK8lOhF1KtwOFZm3qBBmkW+iE2gCC9AgDoeuXriutq5jpaBwSDiFWwgND5SD4NYAIhplTP5gePqCVn/RxRH8fN0vilZ0izPv6JPdsAqDwInT3HXXzcmDEm3ChAiDrRopaBvamxWKdO/aykSZtImGes856x9Zzb2/XKz2Au4iwAvIDV5U6gsXSOs9ukarNyZV40L3pGl+lURbFoekVuzazVTtVoHdgVvE5vDhy5Iv0EKWwA5fr16yaXMpsm0XIfdKzX0vComY1mPfGpHxAAAB69Qt+hntYhlUqFBgYGiASDlPXQNJ7e8CJpXqBxsjL3vztuhXsJAABmz+lf8uM7OIVW8cIc3wRSpKwTNBim9wKNaCCA1v+u7bFuQtOr9VgHTcupU1MdBYxiSOsgpdktjZeVefBw+Rih6RUPDNI6SNm8YpJU6lUyMDBAAMqbCnwDRtNy6o2bM4c1Lac6LVjH72UymbCfJexSpDSjlUE95ulyKpUKISbefufd7/8/soTISAdkJ7QAAAAASUVORK5CYII=";
const XII_TROPHY = "data:image/png;base64,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";

const ACC_MARK = "data:image/png;base64,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";
const ACC_TROPHY = "data:image/png;base64,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";

const SOCO_MARK = "data:image/png;base64,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";
const SOCO_TROPHY = "data:image/png;base64,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";

const SUN_MARK = "data:image/png;base64,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";
const SUN_TROPHY = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAFYAAABuCAYAAAC9f+Q3AABMB0lEQVR42uX9ebSl53XeB/7e4ZvOdM+db92aC1WYCjNIkRBIggRFcRRpSipKlhTZsi1aUtRxu+POkleiLiKJY6+4rcQdyZJouy3LjuwANiVZpAiOADhiKsxVqCrUXHeezny+6R36j++CihXJBhWTWkzf/+piLdx19nnf/e79PM9+tuDP+eexkyf1ux56yAN2y/vWFz/5yaPbF87/Z+Pe8N7+dvfmYac7m24PvHBeWGuJgtC3Z6YIpusmTmr/Jpqc/ez8bUeff99f/avLbSE6AI899ph+17veZf48P5f4c/7bErBBFPH3/uovvG/Y7f+X/fX1d+pRVyvj8WmBG+cgBKW3GGsRUqKAyAG1hLLeoDE7l7ZvOPjM/K1HfvvHf+HnPiWE6JzghHqYR5wA//83gX344YfVxz72MSeV8v/6Vz/50c995tN/Jb2y/J6km0bKlk4kwtfjRAjnRZFmwluL0gprLQhQQhKLAAfOo8mLUgwCKSaOHWTxxhu/fs+D7/rEe0780Bfx/vW/Zf8vH9jXP+hjjz0WP/qP/+V/vnHu0t/ZXlqKYolr6sB5jLLSilqSEEcRURihI00cBUReo4zFFCXDIqc/HJHlJUqF3lhvB0XhyygMbrjzjtHxe+99+Kd++W/+ohBi/OcR3O9qYE+ePKkfeugh87mHf/fez/zO//b3X/nGM+8KOpmfmmgYtNV5ORTNdoPZ+TmmZ2ZIaglSKUbkyFASOkm7VkcYi0SB9exsdbh88QrjXorwGh9q008zNX/okDjwlnv/9Zvf+Y7/6oGPvu/6yZMn5UMPPeT+LxfYEydOqEceecT+41/7tVu++Puf+czqC2cO1zLvmrUJkZVjkdQFC/unmZ+boZk0GeYp47KAMKBuDcqUyCBAKkFRGqySRCqgGTcIkGxv9rlyeYmdTo+43qAsrY1bk+rODzz4zEf/m7/5/n0TEzsPP/yw/G6dXP1duf4nHlanbz3tv/C7v3v7b/+jf/LIa089d7glojKs1YNBMWJqT4N9h+eohyG+EGSiJC3GKHLaPuKgVjTjABFqZKjojUtW8ozSwihNsd5Sn61xfO42Ll+8ytKVJaKwpkbDnfL0l778ZpmO/7H3/qeFEEN/8qQU34WTq74bt+LW2VvlJ37rE9H/8Eu//DsvP/PcvTUnyloYBZktOHhwlsM37sdjkBlEgSYbrXAwlNxUC5lTJSQWlziEyMGPibWlFQRo61FCYzyUpiTPx8zvWaDVbHF9aRmkkDorTNobHl9ZWTn29x75Xx6d/eCJ4rtxU8V3KwX86Fse+PHLV678K7KybCoVeFtw5NgN3HB4gVE6QgKRlaQ7WyzWNYvNFsFMDX3zIs0bjtCoN4mcIR0OGS4v4y6cJx1aekPYGpQE7TbDIsc5RZA06fUGnDt9nrm4xaDXM4t336Fveffb/refHHZ+wn/iE14I4b9nU8HrQX3ob//td3/+X33qfzbD1LXimvZFysFD+5hfnKbXG6B1hBCWzvY1bpqdpVVrUrv3Fm79yIPI/XMEMkA5j/AWVxbYLCO7dp2rT3wVe36ZSMesDAcEcYyRgvF4SDLR4MjxY/TOL9GO6/ry8y/aiQN7f+y377v/t4QQj36nKwX5nfof+5Mn5a2P3Oq991OXTp/7h71Obz4JImxeirm5OfYdWCRNhzihUUKytbzMVCPBNQwHP3I39//CRzFtkJsruLUrDNcuMdy8hsu2KWVGfvQox3/sY0THDoAoqEeKPEsREoQWDEdDkok60/tncKKkJhVXnnnej8+9+pcAvvjFL8rvyRy7etNN+ldO/YoNx8XHn3vi6z89Gg7LQAiVaCmO3nIU50uMK/BhgOmu03Apc3Pz7H/gfg596AG2tncYD1NSazFGYAqPc5Iid+SjknQ0YKTh4E03sXN9GTcY0x+OkEEISlOWntQXTE/WUSZDFZawNxI2Fnt++v998su//F/+0vLJkyf1E0884b5nTuzJkyflJz/5SbOxsbHnwrnzf627veOTIJLOlGJx3zxJElGaArzAFZZBp0+z3aKxd5q3/uA7yNMBRZGiA4GOJIXL8KHHypLc5RgytMjJ8hGpVhx597sxtTrzSYu82ydUAQWOsdWkpWfv4jwLE5Fs1YXduHZ9ZuObz58QUvrVT39afE+lgjNnzgjA//2/+3dvvnrlym2mMF46Lxv1iJnZCUqT4Z1DScWoPyAQkpmZNsfuv4thDMP+CO/BlA5rQAYBCI+XoEKFlwJnDc5ZNoc92DfHzPEbEYFCWtBCgpKMhxmh1LRbTZp1hdJWiO0u/urmg50dO/XJU6fKkydPyu+ZwD7yyCMC4AuPPhqvr675Whh4bywT7SZSO/IirQAVIRmPxtSiiIlWi4WbD9OlpMwEUsQIH5CNLNZK8lKQZo7+ICfNPN7HuMxh04xx3qOxf5ZeLLGhIk9TwiAk8SXaFAjvIIgoJDLIC9+7sn78n//qr9wIcLw6BN8bgT1x4oQHCEblmwKnxFgIp0Ip5icnQSqEdQjvcQJ84YmVQk0ExK0aZjhCKIm1gtIIkDAcpeS5wVqHCjRSKwwSJTXOW5wvcHsaBM2YlgzpZSmxcMxGGmxGZgpUUsd7RRwIl3Y3aleefTL6Tj5e34nAikceecT+g3/wD6bq9fpfdLkll0KFSUCjllCUBuFAK4nFU5qCJImIJ2voSCLLgiAKEEqSZikqlCA9DovxFussXnjSPEMqSa1Rx2uNbMTUtCa2ktwZpDFEUoLwDLMUHYfIQBOEgTDjgb96+hVf3a7vocACXLx4sZmV5pgXIL0XURjhvMdaAwIEAuFh6Mb0ypTCKoI4IkwCTGko8oJAa4q8wGOR0qOVBidxRhDoiCiM0TLElI4whwhFagvSPMd7cN6jdVjlZKUIGjUK74h1KPTrJfyJ77E69tnTp223282UEDjniaIIrXc/jPc4Z7HekkvNZq9gZWNIr1/grCfPc5x3ODylMQgsjgqLLQoLIsAax2A4ptPtgpeUwzEuTSnyHCc8EpAOrDVkpiD3BhEHeAmh9cTfehC+xwI7WloSwiMREocHUZ1WIQReSITQCA+lFYyMpNPJ6OyMiZIJojCkFidEOkR6idaKKAoRQhDFEc46wjBECUmr0abRnmSwtUPaHZI5j9YBOEsQSKyzlGWJwWEFCKUwxqDL72wr/x0LbLIDshSkGrwwaGWwtsRnDuc8WmpCK5iJ66xlXbbW1lk5cx0btSito0jHCGuIZYQUMc5JTGlxzgIl3mdICWVuMENL79wqWanYEiHtqIEnp5QlXkoQquJnCkuRO4YCMr5HA9tJUxweoRTSOmo6ZCKpEQiBco5QSpT1TLaaDMc56bDk5S98Hb85hHpE32b0ixFFOabICkbDnDwrMaUnlAGhgO1yhEw0w9PnWT9ziZXtLkWekUQh1jqsdVUT4iRlaasvxoL9LrBg37HAxuyyeM6hkSgLyjrqQVAFF4/GUQ81QVjj2mqX0caYp//gSxyeOUhSa2GVJKwnhEFMGCRIEeKcxHlNnhnmJ2ahl/P8Z75MMXJcXNlgqtXAG4MTEofAWo93oJQGJFJqnHFk2XeWxP3OAt1C4BFoD5EXBB4MDq2qNzkrLYnQzO7dz7nTF5haWSP9WkagY+76yIMgQ3r9HsJ6TGnxHvAK15C0Z+ZhaZtv/s6/Y7id8tLZK0S1Ju2JCYpyjAOkFXghEEJiS48pDNZ4pKzq2+/JwGakBC4isopcCMbe45xDCqqi3nm8sFgBU0nMwvwsp64tc5PQuM89w9ryOm/64NuZOzRH5hwehQIEEqxj+euvcPaLT2K6JeeubGC85ZY902hVko2zqjQTHucMSihK58gRZMbiJH9UoXzPndgEZOmQ1lIIGHu3W+AbpFKARwWKQChapuDgdBMVRVy4vkkxMAzzguVLl5m9cYFjN96IRjEejChzw9LFq2xdXsGngm63T8+m3Lx/Dy3tKcsxUjiEBSc9SLDeI4Wi8B4hBUKI7/jj9Z392qTAVxkBvMNai/UOKVVVp1pLrCQ60Hhnac42aUhY66b0Ly0xWQvZXupw6SsvooUnkHWEUQzGKV1rUUjiwLNvzyStZoKxFoVAKY2zgJB4C6a0aC2wxu52MALzvZtjE4RwCCHxzmOdBw9SCJyziN3cZ4qM3FTXVaPZ09DUwyY7/Q79cZ9BZxtCiJIIX+wgPLRaLVpJTFSrUQ8VMw2NyFIK61ClRekI7yXGOISXeC8od3O0tx7rS0pTfkc7hO8wS+sReJRQmNJU7ayuAmytI89zwmbMoQNHuHztKmGtRpxbDiQNOrLNWrdHFMYMtkeUecGBQ3to1DSD7hZH9h4gabbpbm4SjHrUp6eRcYz3JelgyHCQVxlZKYqyQAiF8+BFdZKDOOCPetpHvrdyrB9B4CXSK7wKSb1EYAmUJi9SEIof/a//NqkW3JGn1ITg65/7Evd94IMkC9O88LnHOHDoMM9+7rPYMOTDv/jz9LY22dlc4sCRGzn35ac4+ODbKTfW2by2wod+8a+xfPY8T//2w/Q7l4mCECk9Shus04xKi5IO7xRp9p09sf/J69gTJ04IAYxjL7IQykBUj4gA5xylsRjrMKVD64CJpM7y5Ss887WnSIQm0IouY9bLPrc+8Gb04RlckTMjY9Jen+3NTZI4QfiSs88+i+nssNhq8Y1HPsXo2jpPfurTdE9fYF7XMaVBK0ktDiiLFFWWtHSIBhKd8J1EYf5TBFacPHlSntjlzx555BHrATPoFcYW3pgC7w14gxBgjacsTcUQGMfvffYz2DjkTe9+O1vkXB9sEQSS7sYa3c4WCzfsZ8ekZFowxjIWnjyQjIXFJiGyUWOj36FvcoI4QiuFVdCXFuMr2VwgBbVA0IwUjTBE4ZCkAuASj8hvfYYTJ5T3Xvx5pwJxL+hTUD700ENeSIm3Nv7C739h6rNPfDb73Kf+5UKt54QuLRkGg8EBzlQPmXMCKRTvuv8B+oGHssQUJR/9kR8jDpuoVPLqF77KzQePk4gQISWtuI5NGojxiKAIOLz3GIXV3HnfO3jPj65gTYFyHo8gkx6hNKW1SGeZqsekSUC/P8Ba74YG8F7c+9c/ybO/+XEhpHR4jxCCkw88oB964gnL/wkJ6J/p23nggQf03BNP+H8rlf2hH/rFtu+8dvchYd+bkX9oc9A7lI3zUqH1bKPR8Jnnqctn2bdnipum5sjSjDDQaCmxeUFtzwwLhw5w7vwZQqU4dOQGtnZ2UNahRwWy3WC4s4mQin1Hb0SUhvWrV1jcd5CImNOrSxw5tA9ZlGyPe+jhkHCUkuHJnKEWKnyZEwcNVjZ2GHRHXgoteso9LevR1uTsjJrdf0Ts2XvDN6duvvEzP/xTP/yyECID9MMPP+z/rNqDbzew4gTIR8AKrfnxd73rr9eGnZ9s1+K3a6vQjRbR1ATtiWmmJqZBS86cOs2nvvQohxdnODY5zTjLiAKN9JZAKe5674M8/tWv8K4H383pl1/h6NEjCJOxvbbO1OwsnX6f1lSbXrfHTYePcOrZ57nvLW/h6Sce4/73fYjPf+6LvPnuO3nym0/zAw++m5dPfY18MCLwil4+ohkHuLxARS2uLa3T6/WIk5BQgvCWvMwhaCCas0TzUxw4uv/32zOLv/Fz//1Dj2INf1aVovp28/GrSrlf+Jn/4h3tnc7/vJ/e3/rIfccP3nDjMds4fNi1Dh3EJ00IA7rjHv3+SCxdXuLSyhLtRo2pMMHhkcKjhMQaQ73dZjQagfXk4xHeWdLxmNFwzGgwxOLw1lGOM7SUZMM+WnkG2QgZ1Vja2KDWSEh7PVr1Gjvrq/jS4r0kK0riIMALSW496zsdeoM+pbUMy8yNnXWu8N4Y64tR17mtq37GF7d0lpZPvOWGQzf8rf/i/7n087/0X63sHkDxnzywJzkpn+AJ572P+qcv/t21b37tV26v53e+8013mHD+gDtbNvVOaeTa+pbY6BRCi1DUa4kI6w0inXDh2jUSIZiKIpAeJQVKCATQvbpCrfDsXF0izB2DlXWGGxuwM0CPC4ZbO4xXt4lTw/blK9RMyeD6dYLCcuGlVwkLx2htjdB6rlx4DWcKlAzwLsB5SxhqSmPJPCx3Brikyd4jR4inZwRhLE3uZe6QRng5U4uEzka2VdPBTCjuvnju/Mfe/eD79FdefvEr9zgXfPzkSZ544gn/nyQV7F4FHnvssfC3/97f+TV38dpfOVSPue3+e0xWm1RDGYlRnrI9GBE25qjX5lB5zvbGJa5ur7B9eZ1uPqKN5WC9DoEn1ArhLMJ7wjDGuqrNFQJkILG2JFaKrMjxgYbSEylFvR4gfE4YSNJRSWok6IhWLaZIU5w1FfHoNJ4Ia3LiSGCFoJsbnj53hWBijna7yczsNHNzM7SDkOtrGzz97NM0R31uPjCH9QN/+54Zs//gkeCFlS5Xbfjf/fZXn/h/3VmWwbPemzciqBNvIKj+4WvX4j/8mZ/+R/mVq3/5SKth77j/ATlMmkKWQ/p5yQ4JB2+5m363z8unnma0ucxNNx5GhnDuyedxUUTa7TMfxSAtidZI4cFZhNbwOi8WBvTTlGPvuI/pm4/gw4CF9mRF9aQ95memyfo5uYFwMqRz+gpPf+ozTCYBpS2wtiIUrReUQpFmI1pxhBFwfZRx5voKC/MLaATtmWmubawwMTXFDbffxdzCHq48c4qrX/ka+6dijCqZnZ9097/5Hv/YmevqQir/zh889dX/xhSFFEI47/2fLRW8HlTvffSPPvYTvzG6vvSX97br5S33vkkFjZowwxHL3YJw9gDH77yXJ7/8GFfOvMSdt93A5GTE9MIkriiR4xwVBYx6A+oqQEhXpQEPWgqElBUYLiWh1oyzjMP33snk3j3M7VskCgIazTqHjhxgeXkZY2FhfoFmPSGyiteeOUUz0hhncAhiFWCMo8DhnSMONGVh2C4N46Lg+OFDNKOQcb9LrV6j1+ty/tw5Nta3eeCd7+DOe+/i+VMvEYsa/c5QnFtdE3fffZtZvXL1ncdvuj04u3L9S28z9+srXPEP8dC3f2JPgPq3Stm/9L73/bI/d+G/PTQ7ld949/FwHMYiUJr1y9do3/EAE4sHefif/i9Ma8tdd92OjzVjN2ZcZLiRo39phb6zbK2ssSduYGVBLQzB2SqwSmN81eZKJbGlpZbE6FaDUZnhjUULR72WkKcZ2sHkzBQb2YhyVBJZz2Si6KdjihJqMqAwjpG1GFMyUYspSsuVNGel0+FNx47hrWNzZ4dooslgMKRfGIZFiRCWD3zwA9x585386//xH+KLnBWXs2c6cu+4+zb7xefOBNG+/T/1zx999H/9+L33Bp88dar8tjqvEydOqEfAnvwbf/3dG6+efahVk/a2+24Py0CKEMkrZ68xccd9zM3W+K1/+Msc2DfNWx+8n1wZBtkAIRVRmJAEIQoB1iFthWz5CkgEwHkHeLytQHAhJLU4gjTDb3eYLAVxWlIvSurjkikbMBsowuE2U5kjyHLwDolDiKq4x1PNggmJFBJ2r6z3Hu8t3WGH4XiAw1LYHB9LAi1phTGtOOYzn/q3XLl6nZ/+73+Z7nQLMs/mRiqXN/ry/sMHXefFV3/pb/3037rhk8+dKv9Dnav600Rt3nv+25//uX86E3L43e//AaywEiSvXbjGwtHb2HvzLfyTv//f8Y43HeeGW46wsrZGoCsAO89SrDEEQpFtdym9YzwYUosinHdoVQVZCQUSPB6lJEophBL4UBHUI4g0mfLU6xFRGCADjZSeMFIIJHlpAE8jCjDGUpiK9jHOkTuLkIIo1Fjv6GQlY2OoxRFeOESoMFozGI0RXpAEAcU4pVWv8+zzz7CaDfixn/kZTn3jFGVh6PW35dEbDtrJemvh5WeevOU3/uYv/qtDTzzhn/hTujP5J3VVgPvBo8d/wQ1HD7zzvd9v65MTklLSWd1AT7S44/vv4V/++q9wz5veyv6jtzMe58wsHsDHk8ikTXNqD43JGaSWxKGiWY8ppcECuF32QCnwCu8dSoNSEu8tUnjCUKNDTZQENGuaoB4TtZsEjQCdxKBrFKFH10KiMEI6iLRCSbDS4iVIBVZ6jLVIqdBSghfU6hNIJfEInJUUI4vJDbkpaDQbBIGmPV3j5a9+ja9/4XFO/D/+Jv0yx5Ulz7x2Xh+792Yz2ZA/8Df+/q+97yEh3Ik/5XCqP55X//DqVX/ixInJpVde/M0H7/++2bfe9ya/fPmqxAmWN7d47w//KP/ot/8ZC8cO8Z73vpdaY4Lp+f3UFuZIptuYsqCR1IiUYtDdwvdHWKnY2OzQThp4Z9Ga3TpWIXSljAnCkEAHEGqKQNJoNpicbNJq1BCJJmolNCeaRPUYGUjSvMSLgCDQBKKSExlfVRcCiQOK0hBrjRSKgbGMs4JWvUaoFcZYcuMIG3WSRkISaxq1kCTW+MIxP7+XS1eXmZ5Z4J677uDlF0/hioxWqyGO33E7r547/8CPffhDf/CPX3ll++TJk/KP17fqj0Goek0Kq9a3f35xsvGTf+kv/rBZX1vRofNcvbbMoeN3cWF1hX6Z8iM/+qPY0Yju+jrXL1/m6qvPMrh+nvlaQO/yq4i0T9RqsnbxKv00p9cfMRHW8d4QBgIpJAKBExalNFEU4p1DRyEyDKi1ashEYrVBCEuZjmkkMcIYpBSgQ6wXOOuIlMBah/FiV+liKYwB66kFIYHSdMYZo8LQqiXU4xCpKkw2NwaTjQl8yXQzohUo5qenMbbk6K238tUnv8HxO+9iPBySdrbY2toQ973jficGo4mvfOUbV5fy9Bubm5vB5uam/dNSgTwF5mcf/NkJUZQ/es/tt1AUI/I0xZuCoiggiHjp3Fl++Ic/yubFK5z55jfYeO00ZusKsjdEpRKXe3KjKJVGqEpWJKVCeLXL87sK3fK2erAQgMcZB0JgsxI3zOh3OoxcTm3vNAv33sqxH7iPiTuO0Dh+kGwyJMszdBiggxAVhkit0bpqMoQArRWh1gjv8a7i1xSCWhwz6vcxeU4SxSQIpuKYOh7ZH6CzATbdohY7Bv1VfvD97+D5s2eYPXCIMI5BCU69cIoH3/pmHwr9XpivnzhzxvzxCkv9sSC77f76Wxbj6G/fd/uNlMrKWlgX51+9hG+2GUvJ4UP76K8sce6FV4hdgc9GlGVGMTKMBjnLq+v0ehnXL66ydP4SdSJ6RcFwNKKmBZYcrRVSgseAEBWljSId5xgP9YUmB+84xL0/+HZufutbURMT9H1JpiVTB/dz4KabKVVAfzykyHIS3cQLhbUlylbtshOW1EIgJR7oZBmFc0y2m3iqCiHSkptuP0IUC2anW9x1z510Oh0MGoViZXmDAzcc5uANh7j22gWyQUqsIjr9HnuOHpa1TPmvXH3hX39Fyv4J79WZ/91D9n94vPyge+v8xIQWpnRxFIl0lHFlaRvnA0SRMdvQLF8+hxKSdDzEY5lbWKTIcpr1GkIIep0OxThFeUmeFjhrEUruns3dfOg83oPyCu8kaT6m1kq46Y5j3PGWO7jvHW9HiIjPfvrLPPfM07i8TysO2bq2RpHBvQ+8leP33sbc/jmMLkBbpFIIJfE6ZFQISlMJlcuyAFcpYsaZJS1gMCrp9YeESYPJ2QWG45LByGB8gNAhoJloTXD2zKvk4z6T0y0m9+6hN0wJVcBzp1/xb77vzbWDwcQcwMYfO7H6j4AWxENAOwjcRCAJFIRK8eprF9HNNlop/M4Ww7rBFjnjTOBcRqRjRqMRuSmZbTUZbq/THfSIgphRt89M1AQdgq+oRbxCoMB5nBCMckPhHUkzZubIQWyScG25w7XNUyxtbVNrT3Pip99LLS6IvWZF9nn6qXPETcVE2GRi4QZUuMJws4vJHXkxJLeC4dgTaUGoFLnzhEqhA0VuJN3eGCEdHs9n/uDzTE20mGk1eenUGaJYU4qMMKzhEOioRq0W4yPBnmMH2VpbpsxLMez0vK0niw/edc+xf/bMY8//xMc/Lp745Cf/9HJrthb7mnS04whKx+b6Jh/+yR8hjDxROiQYGcrUMRyNKMqCzs42Z8+eYZyOefIbX2d7p8OevfsoraXdnmRqZhpjDNbb3WJdYA2V5Ccv2U5HDKVg4da72aLJs5d6vHpVcW2jiVM3IOODfO5Lr/G1r1zmic89x/WrI1I/y2vLbZ45o/jmmZLnr3ou9DWDuMnYW6Q3RB7qYYI3jjiIqEUxxhpIAqYW5xianOZMmwM3HKH0nv5wSFCLCeIYqUOsVBCEZIVhcmaSle0l5m7Yz/s++hEG3R6BFKwMOvb73nZf+R+jZhwgCeRbtXcEWrCztUnYaDAqMrY2lnjnDTdxfX2TcmTpbm0hY0FNV5KfUV4go4jFA/uxheHIkcM0A8loo1O9/sZTlh6LQLi8stbwjtV0xF/7uZ+jNbXIv/3dRwmjPVg1RSkmK9Hwds7VjR7vftsdLMwdYJx5ZHdMXihsCUI26BvH5toW+6dD4qBGYMZMJAFegDWWosjBCYR3COW47bbj3HzbMYwpcAryfXtYfu01+uMBcaEJoxBKR6gCBv2UPE25/fbbOHvhLO+6/a04AsZpQXdzSxw5eKP4Dwb2E+AfAmUy17beYRUMu0Mure2QfvqLHG5PMihS+oMBpc0Jphs06hMoZ5iaqDOTtCgLz9kXX2IyrjMwBec7myzUJtFxDekVaQ5eOoS2EEjWOiPe+uGPcNtb3sInf/WTtOoTKFEnLXJ6nU36aRcRFARxxpWVmLWup12bYNwfUQxC2hNzFLnj0PxRQu0Y7iwRNRdIs2Um6pCNR+Te4LSiyEoCJ5FpwTNf/TqtiXaFOXS3QQj2H7uRdNDDFAWlrCj73IKuJyxfX+XYscNcOHuFrZ0uQxkRZh6xM4KJ4RsgE0+c8P7xrxljPeU4Z2dzm6hWg6JEuICdbgdTlgT1Bh/5qZ/EbHdIe11qrTreSzqrW1w4fY6sn5KORlgkxlXFuvG2mka0higM6Q4GzB9c5EMffj+PfuazdDoDFmancTi6vR79UZd4QjE/O8Hk1Az79i1w47F9YD2hXOW1y1cwHprJJLWozXR7P9mgT276yDAmzzOCKCQb59W0IqIS5SHo7/TobPdYXl5jVIy56fgtvPvDH2Gru4UIQ0a5Y6rRoNvt8Htf/CwbOx2KlwpG/YxDx27k4O03c+X5Zynm99HrbQNw6tR/hKUtQeSFxYxyskGKExo/ypDtkMbsJEGQsHZplT/8J/8r5U6XA3sW6Pe7vLa2ThjVqStFXnpKLxnnliKCrDAY77AYkJJx4egXBT/0wXfT6W1x+dJlQDEajRmnPbqDLtMLdW664xDTc23qtZB+f4fTZ0ZM1BNQnrhe0OssgbP41RBXRExMHWI8uIATCucsbbkL9liL9w4pBXGgEU6AE0QywYeaixeu8au/+hvM33AAKRUNn2DGY2r1hD3hJKUPmD50lOzl1/j8F75MfXqK0hrSLGd1Y3U3cqf+Q4F9hLyYprSOfJSRjTL6Y0kNhd7bpjCG7c4OGli9eIHEei5ubxDVInxvjA0DxqFiNB5jvEU7iTFVXnV4rCuRKmCYGvYcPER7zyznXzvL6so6zdocpjR0+5scODLHbXcfJXMZWmvywjA3t499excJhKfb7XD8jpK1tS6by2OKIiVWM5QmR4YNBj2H1BJXlAgPUiucL6tmwRissRij6HfGBK2E4WhIu/A8+Ja30xv0aNeafP1r3+T8tVUe+KEPkTU0D7zn3Zz6xinsOKNRi8ELjDUMe+Ub1xV4YLszYOwsH/trP8WFz36BnbVVSiYR1oF37L3jVmb272E6iil8yZuTSb7wqT9k2BtggFIBXlNoTeQDNJpCKJQH43NuPn4j426P5ctX6O7s0KzNstNdJWk67rj3IAvzUywvLaHzHN1osra+RmfrOu2JJoFKCFXEsWMHicMOl17bRMZN4noLLxuEUY1IgDUDCueIvMTjqpRUCpwFY0qkFvjhiIYKKTeH/Ltf+xcEEuoLLWwYYfSQrzz1FHtvvIlXnnyWsHRsrF1nfWcDiSIbFwgn3wgeewKlJGVRVpCcgCtXL5GmQ6wpqUUxQkjKccpsfZK9h28giRuMemM20gGmphjn40oGb6E0BgNQ2qrE8pKicBBr5vfMMez0GPQzyrJkdeMqRmXsPTxPmu1AOWSmJtlTM2gzpJlo7jh+lLtuv5HZdoPAW0QxZnGuyYH9DUbpOu12Qr3RIAjreBHRXFhkmBW4spKQSqWRUlcKSA8eB64gz4ds9ja5un6dpbXrXD17hdWLa5TbQ6atZn9jkjPPvcDFV8+ihaA10cKYqogiVG/kxD6CUHNYX41k1oKI40dv4uXTFzHdlNEwZzzOyEvPeDDALK3Qsp5hlrGwdx8333oHT5xfoqk00kHqLcYYjGAX0HaUpYVayJ6Dh3nxuWfpjUvqjZgoytl7cB/z+/bQ6yyj9s7y1vuOs3XlEmsrWyjZ5uLZC6zVE5q1JrEucR6EFBzeP8Wos8Y426IwFhm0GGcp8cJeshdepsxNJeu01WiSkLKSkSIYF0Nuuvs23vGB96KUQmnNzkhSSxZYWrvI+uY27akWxw+/ic/803/BR3/4owzKnH/zyjmE8Cj9RiRGj4CZ8ohIVponBK+98BKD7oDpuMZgMMSUjqIwLM7vYWJ+gWA0RgYSlxt2NrbRKsAKRSkcu+OBVM5jjgBBYRxhkrDV71FkBjvMeN/bbieORzAxiYgdtqfodIc8deolTJHhkwaDvGDfDTczOTnB2so1jHA0mpMMxiU6ljSmBP3+NkFYJ5UNCjHAtqfQjUmK7hAlNNYbiqLAOlc19R4kAeWw4PwLZ6npgFqzQT+aZ2aqRmEa1KYEzz79JO7IPuYmp/jmV79Jz5WEUYR1nmaYvLEcWwmCBdY5hNSsrq/T2d4hnKjjFFgvCHzAs//uCTbtkKYUgOVKd4dG3GCq1iIzBqcEQoETDotHeAkI0iLj8N69pHnJ+tYmUjiyrGS2LShln3prD+OdhJfPnOfm2++kM8zIR10W9hyAqMnqVg+CGJk4Njo9kloLHwqmF1r0e1tE8RSDUUY6Lrm6ukXcnKDc7mKVRHiwpcFbi7UWB0QiYvPyOkvnr+NGGYGWmGQPrdZtpHLMh//iO3E1g7QlcRJxbWWZkS1IhCRQCuwbFMUpX0F8Fhg5w4HbbsHs9BjtjGhPLGCdpKxLVDai5mJUTaAouHlxgX53QDnI0ULjHGTeUqiKdgmExuEppCFBEfqQtU6fZGaRTz0Nx+bGfOD9h1jZHiGbDcr1dS5euEie5bgA8hI2twfMt9uMdrYpnGRhfo4kkiT1mI3VVWSgKbMhJX3QETaz1JoJq6Kg9CHeSQIh8M7hva8eM+uJowBdi9h/+80kzTo73YKdrTG1MGZl9QrHbplmsdViq7vF93/oAwxXN3nq818gdJ5Q2TcWWOuq6T+pFN5Yjh09RvfCJda2l2iHewhUSHdrjenDB/kL77ufXrrJ7FRMPWnxW7/5W1zfvMjUxCTGQ0KIdL7SDQiB8xCHCVcuX2PvoUN4B5mL6JkWL54dsWf/kHAmx6eGLDOUZY/pqSmmFvchmm1q7Sb1RkIpMrYvrRJEERMzs/S6ffIiRSeK7bUVGhMRmVak45KiM8R7KMocIXUFBAmJVILSOUot6bkCkxneec/t3H33nVw6fZXf/71vIhA8+9QLrC5PcrnZZDTISZIag93cDlAUb/DESnZpizxHalEBLYMBQk1QlE0wjsJZ+r0Nnn35eTrDNUJtqcctdBwR1xMMoKOAWOoKS/Oe0llQCu9henYG76uyx7oRfZkzO9Vg7vABXjn/VRLbYnHfIkWRYVxKFHpkCGGoKbC0pqeoy4i1XsbSZp+JQLB3316G2RpxU4OtkY0s49GYuPBU+E8lECmKAucs1ZivJDGQICmRfO5fPMxjv/sH6KSBUi3KwhIECWbcpFsIApXw4gsvkG32CIIIay31P6UqkH/Sb6SUFU2iFM1mk1bSwIxAlzHFaIwpt3ng3fdy8PAis7Nz3HjDce66+008+N73oKOIIAxotiaYSOoVBS0FpXc4BwJFHCaMR2O0imiKNj/24w+wcDhBlQHaBRw4tA/nCpzPUZGnyNaoqQFluo3JRvR3dugPeiSTsxgV452gUW9WHFYU7g53hAx6KTs7/WqKxlmkkoRhiPce4X01hS4EuXMEzRqNmSms95TjAcPBOnnag1Ix6gdgG3inueP2O5lfWKDIM5xzFMXwjZ1YV9UwaBUT6ajS/K8N0XICLy390QrelJx95kXq9QZrq6usWo/1hlE6qqa2m01UHGJSC6XAO48XVWUQas3S0ipb45T23AJXOzl70jo3HjvK+ZWLzE3vxdoRk3sa7F1skxiYnWyw/6Z7MMFhSgTd7eu8/OzjZGZA3JxkOLSIsaWw0B2NObznMMsXNhmXitlWDbM9QHiFlK7iKqTC+OrdSSPPTmedD/7Ah3jPB97D+XPnmW5M8vnPPsZLL19hKmgwodrkQ09qLfOLC6ydv7yraARrwjf4eFWKn8o6JC93RQ8SFUZ083Vy1yEIAl545iXKIiNKArw1OOGZaE8yPTuLChVJFDK5MMvF0+d2FS8VRWJLQxhH1OoNVKCpTTT53O99gzveNM999x/D9depRzXufcc7ePWVJ4jsNjqaY3L6BuoTN+MF9BqK8fYiqnmE9a5ks8ggCHFWMLtwgPbUHL3+ZWr1JkEG1XiXwtoCWxrELkaKFORZyt59i6x1Nvjdz/wBJQ5rYXnUwYee4XiLmXqKTppY59jc3qbf6RAqjfWWwRs9sd6FSFnRKKYsadTrLO4/yOXNVZzPEEFBVnqmDsyy/+A+wiSkMVGn1Z7i1VfOkHX6zLdazE1Ns5UNiesJB/YeZPW5U9XVcRWJOD87x4uvvMLUgbdSDIZ0N3tYU6c52cC5iPUOENzOtc0v0trbYGLqGAYIqAbiLIrZuQUO33qEF19+ieHODsqFuJFmqb+G8CVZfwtjxyhR6QtUGFSln5RI64ikJksNhw8e4fsffCcDkzKzZ47xaIh4Z8yv/0+/gS5KBqMrtOI9SKWYn9vDlVpcDQB6T5qO32AdK6vpFucdKlAYa/AuxktF4YdEsaAYGw7deIAPfuT9rG5voWuaen2CtbVVhnim5qbI0gwZaqbnZtjq7GCsw0mBDBWbW1u0VtYYdnvk4jTHDt3L2tJVOjszNOdaJInl+vorLM7cjckOsbV6hddOf5Xa5D7wjvFoi/bUfm49fDurY8POIMeMU5RReFdne/M63e019rQErjtCu2rEXgiJ3e0ChQflPK3mBKdfepUrl64Q1UKiIGCyPcM4CMjzkkTUyM0mW90xSVzn8S9/heXXzhHvGlK84eEOJaoywhiDDAPKwiB1nWZrmkD0gYCpqYDN1SVOPfsU0UQTnWounr/IsNtlot2kNx7QnmzT1hHnr68gvcZLgXUeIRWlKel1uuxbXIS6ZKe/wtZGn89++hn+7z/7E2ixTCpX2N5scnDvDaTXr7F07kv4iUUy61FecsutbyNzAU898wIKiXUK5xTpsGDp8jL1JKTdgOFG+frFx3qBVYDSUBR46fGy0nuNuwOKHcOodCzl11glp9aexkYCHRqs62OtYc/iIt2LZxl2ekgp+dNiq/99TOtjqOJpSgVl4EiAwhm20yFhOImTl5F6Cq0tRV6ycGgPSasOuSJxTXZWtgmVpjERI6Wjs7OBLUqCICBAV+NBUpFlQ+pTTWbn5ti6tkooKgD9loNvYmt9jenFGsPBGuPiAhPFHC4LmVyM0W2HLFQ1ER/F/M5nn0fFJd+3t8aXX7iCFFOMd1ap6QjfMIy3LuByV+V3V4JNMDLA2mrcVCLJTMZHf/wER44e5tKlCwRxBPU6pbd86bNfYLC8jXcNAq1Rcsxttx5l9cXn6V1eQglJqNQbhA1lxUU559BaE0QhaZYRlJqoHSODEC0MN7T2cen584xNTkJEqSU6UoyLDD9y1OKIIAh2Z2cdQgi0VHgEtSTh3JmzTE9Nk+eGpF6jnYQE44yaEBRFQL49xaCb0VIFuraXTTtHMFIIUxDKGl9/ZZOlrW0+9IPHKZa69DsRvrA0E03YquGNYbQ0oC4r25IsUJVEvzQoVRmpW+eoo3nlqVMsX79GJ+tTm2wzP7+H+T17qQc1bDjAWUtuHUGgWV/foNftEYYBQgjScfofC6zY7bwO4ISgsIZxkYNS1Jtt0m1LaQxBaBEanMnxShOpuJL4aE/uCiYm6tjSkZuqbtVaIxzfUr0IL1BCYkzJhbPnmJuYpZPlRCrh3CvXKIs+arrGoNOl1zNcvq64923fhxm3SXRAKxKkaUonNRyea+FG21y5PGJ7U3PL8UWuvtZnaWkNO95GljlaVB2WlRrjPKooKopGSpy1JDLk0itnmehu8yN/6ceZmJnm8S8/zj/7jX/BnukFWhIMlgIBieLgwYM8GQaVJkKrb2+AzktwQpAVBU5C0miR62HlX4XnnvvuRCUaHzYZFSUHFqcqdzcPMxMzPPONp1m6tkwQSpqNBqbY7Xy8QOBQeCKtWbp6ndkbG0RJi5vuehP1ZJ7rl0+Trq/QmhyRFo6vPNUnmZjmvQeO0O0ZilqlYLxpMeLqi9e4sDMiNQdZ38nwpy6gfZ/++nWG28vMJA5HpTkKrK6Mz5TBFx5VSXGw0jM5PYlG8OyXv0ZrqkVnc4u5iTliaiSqJLc5xjicFTzx+ONsbW0xUa8jgHxcvJEcK/BSVTP/COq1hDJL2dzaQfuYNM1o1yao1ScYmDFr6xsMszFb26soYykLQ1lYcBA36pDZygMrkLt5rjqx1juch6TR5MKli8j2BHP1fSwu3sLcvg+y0z1PzV7DFAVrndM89/Kr3H33cfTkNCOqwef+9hrCd/mBB97PP/+dlxnnkta+WdYvn2Hc3yAJHKBw0mOdA2vQIsJKqEB/jw4lxlXFe6/XZXX1OtaXFDqgOXEA5yyZK3HCIZxFyZC4luz6IDhAUNg3CMKUTuHLqvUUTqB1gMRhbFHpAFbXefT3HkViMEGA15JGGGMAEYUkUUSsQwh2JZUBuMLivcALjRfgHThR5XIbKrRJufDSY2wvbXLnWz5M2DiItS1Kf5W33nWEqzuXefLLX+HN73kHrcWDpJ0+l187y3924mOcfm2TK1e3WTzQ5vL1V7jyyjM0ZFkFTiict8hA42WOx+FVJdHVlSUYSirSbMzxe+9kfv8cKM84t3zxC0/hS0gi0LJyswijiDvvuoeXHvsGxbhbqR55g4GVSmEwlBb6wxShAmZnJlld2gRVokWNLM8oVEFrep727DST9SY6abC1uUPRH1UlW2EohMXb3ZtAdf0EDuUF1lXKGCMVzkGrFjLeOc+15z7N4rH7sbMHEc2bqVnJYjRgJqghxiWbV7c5f+pFPvj2t/H0V7t8/YnX0FGTl5//PJsXn2K+LtEqwJSVN4EzFiUDpJQEYYhxJTiPUCBEZVElEazvbOGmEqbmpploJTilqEcB7bA64UZUDcHS0nWyPCPZLUtrteSN5lhVsZqARdDZ6ZJlfQLhGecZSoWkwvLgX/wR9txwhO5wgDAlkQ0Q5iqnr75AGRQoJD50GFPibUWD+AroqpyNVABYpAfhPMVoiHSSrc3n6WbXmD74AHv330Ojfjdpoblw8SWyeJm0uc2s3Mf29WnOvHKNiIRzT36d7UtPs2cSYusrSdNuffq6uY/wVHlVShBgjCUKJF5U78aNR49BI8BnOecvX0M4T2ktmaPSrVlHHMdMTU3vmp/4ysziP55jX9cVVH+I3bY2LQ2dzhaU1dyAdYaQkHOPv8jzj7/AME+xaVZZ3oUaHQQMTY7UslpfYixaBH9sVEcglEA6ibQG4QReBqAEVoAb9ll75g/pXz5H4+g9TB+6jflwkv5ok/n5RfYm85x+ZYUs2+Dc6ccpl1/ipoUWhRGYcQZKgNrFgR3oQOK8R0qFx6GkRHqPdRYhNUEQcO38RVoTNSZnJmnJCE1VyYydQ+UlsvRQFpx99QxZOmYyrNratMjfWGBTabHCIpAMhKPWmKDZarCzfIHABRTakBaeS+cv4JTEhQqhA7Qo8E6jRAO8oCzBywBbKIJAVv26cwgkWgq8dUgnKKSuxkB3T5dG44ynNttkJ1snu/o8QhjqM3Psv+F2Dh/Zz4tPPcu5U68y2jnHjNpk/1yzmu2yleY2QBNZ0JEErfCumqiJwoAyLRHWoxAI6/GmpKY1yxeucX7UI6wnFEFE1JjE2BLlBRKFdQU5Fu89oXMEWmOkIKX4E+QafxIIs9sleOcpvSUIY9qTLbrSEOuEtBizeGgf9alpZCOhvW8PulUn0prJpEF3s8NXv/Q49biOQrG1uU6sFEJUnJP/Fgi8q5bd5dhw7CYLi9MeWU9YXNzLzTe+lZW1JYr8VY7eNIV0l5iZgvf+336Urz76b7j+SqcCsp1BS9BxiHB8y/FT4vG7+TAOQ5T3xOEYJSUagSs9hSk4cvNhDtx6CKEEL79whetrW+Ars54wDChKS5zUuPuee3jps1+shNPOYgv7Jwlh/gQ81oISGmcFXko6212WV5ewWJCCbFRw/PgdtPbOs9rboTEzBbWI1fVNCjQyTpg/eowizQmlZDLbQ2wdy+tdrKtgydf9YysXt10RtK+EyF6Bw7G6fI0FNUF30KNdn6W52KC3c5manuOm/QfpbZ5lc/Uc6ahDu9mqCGHnEFKgdxWQ1WxX9VV678nyoiqbdnNmaQ1xkFDYgv5oyPTCPFE94erFbfLL14nDGC8E3nuSWo3SWi5dvsQ4TRFJjHMO8205bOyeIOt9hUrZkuGwS9JuEdfrPPr5LzPyHgGoIKDebLC2vs733X8/ew8fxjtF3Jqi0awhrEGnGc5fQO3mOFFFdhcY2X1g8NXvS0fkQWrBytXTLF2/ygc++LOUJqLIJcdvuZtvfPYpPvWr/xP7F5s0tMSW5S5iZcFZQr0rLDGmqgRstarKGoMt80pfkFVuHFIIvHd01vv8q19/pNKYSYsTYeVmZx1OSIbpmLAZsLq0hC0NQRBQGkNhizfKeQVYrym8qRyIpKSeJHStYNzPCUQApaEQjloQEwoF3YKmrHH9/GXycUG/LKhPtIgTQWkNZWkwzhIqjfQCScWUSiCg+hKV1LvsKUgpiITAKUtzpkajPeBqZ5ViPWZ5ZYI333cjz/zhPki3kVbjlUVgiUSIlYK8LInjCOkszkNhLFZ5nHIIUyUirTWuLBmlGc5DIAJiVaPAsiXGOAvOGTIHuXWYsiAKA3S9Ru4sxkn8Lgf3BkRxIJzGy4jclQTWk40ySiy5rMTDwhl0HFD3oPAUpsQEktQ7upsbNGamaDbrJJFiopGQJzHZ2OClIAw0WFuVXQic99XjICRuFy8VWmKlY9TtML1nnrd8/5uI4iHvetdNHLz5CKFs8Orzlzl0+xEuP7fGsFdSn64h5G59KkXlkoQnDHRFc6uAUnmIA7wVlLvjpk4IvFAYa9EYEJV5ryVAYcEJrKz8uozzoDQqDKt/I7FKY98wukWBR2GtwZeW4WCM8B5b5ISRJrU5dlzgSwE1sFGECwRKSxo6qk5j6ShSx/pWRier6r0wDAm1pvTV9ZKqqielB+8dHrdbzjlsmVObiLjvwftRzRanXj7HejFiqTdgcf4wW92Mhb1HaJCycfY6g/42SSLQuxOPgfVIW3V9wldVQSE0JkzIipQelSGPCkO0A+sKkFUeLtzrs7dVC77rH4hEUY4LNq+tkqCRAqyt8vUbCaz33nuPQWuFLRzeClpJmyRsIsTuXFUcIqIIpwOslIycxTiBtoIzF69TGI/1ihSF05aoHJMYj9TsXvWK/5JSIr2rjCC0oCxLlJIcvGEft991M6LW5sXzO0zN3s7Syjpr42WCaI75fQf5wjMv0MRy9Pgxht1p1pavYEuPApQUaARKCXIjSK2nVxg6V65jX/9ina/MgYVHJwFKKkIhdmfRLK4oKg9aqarH1jvGRUlvMERJXb3A1UTl7nN877+XDvT/QQjjKwzLOYtWmscf/xpjIVBKkuc5mVKURYrP+lgnMNZTWIe0HukVxgd4GVJLWnjpyQOLHA04hGeX/0ZrXUl9hMT7EinB2JLpqTY33XozUU1Sb7T42nMXMdEtTE3eRUv1SRYFUa2F8QFZ4REu59Vryxzcu5fDR4+ydHkJX5SEQUhA1cx4ISm9ICthZzCkFIJASpQDVZRYWZmqay+IlEIKiREShEN6R7hbGSaBwnpPttNBIlFKgneuWa+X7Gz6I7ceEafOnPr3BugEIB9/4HE1xcLvBcq9P1BOtVUoCynEa90NlnZGZCj6ec64yMnzAlMaytJSWouXHkUMPgRZ7TdAWqQZoMoRKh8y16jRbCRUVr1VF6dFpaxO8xQdK+54y23MHZhjjCB3IWEUcfyWOWqNnEgr9s00ObjQxA1HTCWSyflpook2QtTQ9SYDk9Ld6REJiRZQWkfqYGgt/XGOk1ULGwlFYEE5UT1qsrr2pROUCApnKKylcI7MW0YWhg6G4yGm1yOWnslmS6QOxi6fv/fOY5ufevbz506cOKHOnDnjAdQDD5zUV68+YReax97XjOL/2pZpiCmY1qHInaVTFIyFRITVlgykR++ypVrtCnol1K2nISBWnkYoaISCyXrEzGSDyDtiAUlQOclLKXYfL8icIWrWuO3eOzl+z+2cuXiBLDNMtJvcevsB7rxrntQt8ba3384dd8yz/6BmPN7i2LEbmT2wh8IL1pc79Iqc6f17ECi6vT5SBiitEGFIbj1pUZAoTQNF6B2BFEjh0d4TAiGS0Auk91W+333gtNgVCiqItCD2nppWYrbVEMOslIjwyGhs3nvTvqNf+YPHHr1+EuQT4PVwWG0ICkxxIhQqCKwvXVEGuS7QQjIpQ6TxRK4SDntAI4h8NaZphEQqTdKMCUJNVEsQWiOURMqAKIkZRJLR+iYUFuEcHkleFBSlZViO2b/nAO2pGdY2e0RBg1Aq+jvrbNQzoniDUVfz6stLXG+tcuToPkwe8ekn/oACx7CXEkQhUTBJo5Ewbg0YmuuVV0FpK/tUAXUhiOMYn5eMrMFIgQs03lV53ZhKEWkljGUFbXq5Cx45h5CghSISkhgF0mGNRetaqZ2eUbh/+Us//xPv/cSv/87lMydOKAHwVz78VxY3L618Lh/1jg+zoZNFrma0RKHoWypNq9KkeY4SooLgEKgwQGiJCgMaMxNktiCq1wiSGLxHGYeMQrIiZ+vaCnVZaUpTY0mtrTQGRY6TnhxBIQS33H6MY0cPUIuaLOybRekCG1sW991CqxnSmtRsLKd0tw1ROybPMjrXd3j+yefZXt/k8pkzzDcatGsJpS0ZjcdEYYgtLUkcY8uC4XCMLcvKX1HaXYy4GvP3QlL4XcZj15lDCk/SSEBKiu6YmpDsOTbDxuYQIUKCKChzNwwGZe//8/TVy3/jVm4NBcAPHn/gQzotf19bQ1bkwmVj0Qx1xSSEMbn05EVBnuUYWyKUJqg1SRo1RKgJooik3qA0hnqzSRTH5EVOICobkUG/z8rlVUI8WpYMCsugsPggQOQlgZYEga7QJm0w5AQioV5v4J0haSUcu/lWmu0YHRnOnblAqznJ1NQsWytbrF2+TrHVIRYKLQIKC5kQjMqSrEyZnIiZbtVQMmI4KrDjYTVlbj0m8NXCCynxTu52ZwUSuQtzCoS0hFHAxOQkZlRg8pzJ/VN0ukO89QjlrPFgDGvdcef9pzpLL2uAzmo3mBRCRkrZuhMCHVOLIgIpCQNZTZsohWw0EFIQ6BAZKlQUVCAwADleQ0KOygrGeY4NQ2I8qiwZKE3hHaVw5MbTG+aIICTQk9jSoMqSiUBSD2Lq9QkatRgtoczGRJmhffUytW5Ao51w4817KF3B5pUVatuWBR3i97QJXYgpEi4NStZGKd43SI0hdJZZoagJUNrgwxwVgpG6qkzwOCsqZFxEOJWgpEZIjUBS2BIBRFGADwOUakLumKs3CaMQZ51Cq6JZq+3NWPwLp766G9h6/bCLTYE3HaSoCvp05LEKxqba+yIAhEEHAbUwJ1FVnvKy6qCCQKC0wCAwvrLYC13lzR2FAbOJ5Mp2BnGDOHTEgaN0lqCUhDIhCCKK0lCkY/LhmDQuEHiSMEA3DDu9bbqjALmhiZdr5Naz08lxhAQ1Sa21B+XqpJ0U5wVx2aeT9nEOYhdT9iUbgy3efM8RYj9DmWd4HVYzaaWtllE4gZOaPIoQQlX7E6TGuupUW1stqQi0RjTErvFvVcZamYlACZ9mcfNbdawZh8IrqpMoQGuJ2mVTkUHl++oseHDWMSwE/SDBW4ctLaFWSC0pTVl1WVGAsw7pQGpJIaHnNRsjR5DvEISaes1T2hLyLXCCvLCEUqAVZCUU5WjXsLykZ6uBYescWTEmK3sIpQiTFgQSKWLaQhDZIf3egPGoYNwfI4IxE4kjdCWjcR+jYi5sgyqKSu8gd+1OrEKqkCBIcNYQpK+rZxRKWpzfldGJanq9NJU9isfhnUVKSWkt2rfFdi+w3wqsIPXOlVhZ2YJopRAehPcoqRA4pK/MapTSCKWwWqIBk5eEUmG1onAat4sYGWUxHgQWKRSBk3iTUNgYnCEIPQmGIMqr4WEqkbLWAh1VXY03OaVyBEISKY8LoNUICOIaOhB4K8jSgjJ1lL0u/XRYoWUSZiY0zs0jigJdCMqwgdAQyIAorOExWBkS6mpXAl4ShqpqY61CqqCyV/GK0pXfIh4dvpK6BqpaSOQcu4QLykuCKBbfCmzpe9IJjXWaMPCE0mF2re2d85WQrHINx3qBKA2qtNUktwfjHVo4Qu92wRSQzmOsIA8gcY7AOryoZmu1TrAiwomQfLxNkXdRukQLgQ6gFcREYYBDIgJNqAWhiglURLudML9ngjBRbK9ssmNHZEpi6yFzMzOURpGNFWUZU/gmfVcyIfrgM5yARJQ4n6OFJASsMbjdcVBpMiQV6MKuvZQXDlTV6vrXaQCtq2Ow60HjrEdi0JQ41/+jwKqw8aZIaJQrHBjlvEcF+luUgnAWHVSzUVJVnLrG47zf5a8q9jUQ4JVHaYUzDucEeeCJjCIVAkcOsiD1MYeO3cLU3BHGO5uYosN4vEU+HjMeDVjJd6DI8WaM3h2eEG4Xclwtic47akJRDxvEjSmo1SgiTb09QRK1CMcJIkuoJQ3aOmT1mc8jTUEQxURRglGghES5kFIoUJX7shDVFde7e2qMr1ZkgdiV1Yldyhucr+LhvEdqhUTjXQCiOpH6roUTs6EyH9DCVptyBRWlsYuYeO8RYhdScx7vxa5bhkQpvSs739V/AlJVCm6EIAgULvBoodHVr5AochHhGnO4qX00WntIIk8YeqTdpYaUQcmcIEhpNiVJw1JrVFxZqCRJHFEYWLnWpd5e4NCdx9kZlnirWZzbw9cee46t5QHjtEA7gUrauF6GRu/6Keoq/QhQWuNEdRsrox6JkEH12Z0Hqb8lYPGvMx14SlHBndb5iuIREh0G1BpR4wQnlJ5aOPROsX3mLlMOLERaCFeVWNLt2tkJpI8qSkVV7CrOI8wuSmUrpyKlFVqpXfiqstUTgPV2d6GEBqlwIkAohcdS5Cm5BeMMkRVIKxAyIqq1CAJHVHck9YjJxYKJWUEUKOpBTKM1yUaeslxex7b3MV7cQ7YxwG8XDEoYjAvGWUleOoajtHI30oKAynxHaYkwgkCFpAiM22VuxS64ojTGVD42SE1pq//+uj9vEGiCXVNKoQVKKQqMqit8LsSJ5eM3/kOdbl//yyrtY/Ku0CJElxYbBdWIprNIJZAWhBdIVTUDCoGyEmMqvNILgapWF1UrJZwAJZEKYgSBVmgnENZhcSQyYEIFNLwhwxEogaZaDeUxeN+vVDLWk2YjapliPAATWnwYI/FEo4x6alBBSTTI0aWhcJZAWCLpCfE4UQWkQJNREGqBIkQrgQoChNc4b7Ae3O76lgoiNMigIlSF9CSi2vDkMDhn8HnFKBhb4qmw6k6ay3Q8tL1xtPDqSD2gF9Kdd0kRlLo+IaHwFZouRBQKolAQaHYhCTDW4kVa/ausWtPCepwMGRcGnVZFt3ECJytFTSQFaRCS+QAjMlxQQ0VTIFooVUerrPLlUhon5OsXrpqakQ4bVPkOKXHCUWiLCUqslqQahAYbKVygMWGJDRwukHgd413JRFRnHO9jc+cy2vbYTCM0AilyjHVEzhBIQ4nF+gBXCpQr8bu1OIVhbGy1GhCDFSXWlWAjQr27hkR4WrLh43DKxvXAxfOzv6gPL9yd4EtcOSQvuj6QeGmclRgfeYUsLUaWIoolMiyFUF4iKu2B0qFwu+OyUgjysqhc2kpDYTyZV0gtGLqSlV4XagpvBrhgwFp3iQElzdDRiEPCer3CUUNNGAUEcUStLqg3I9oTmompgCiCpBbRbE7QqVnUakFjqsHUVJvAK0ovqAF1YRj7EXZsGW/3UMUWdZsSy5yR22LcSakL6ReaLVQk0UmFg4yzFAgRMkJpjUAQ1urUvHJahl7qCB3WECrwSkkRqkRCXFHLPpRa1sLNPOVaKu/WS7r9q3g55aPFOy32aGDG0YS3UgBjV40PqWKEMqBEgciGWEqcchSu9MJVBlpOgNJNIu8JrKGpFNYr4nrE1X6X0VZBECofMlRu9VXGvRVSlbAtggo41oooDklqNcJ6QL2eUKsH1BsJjcmQ1lRIsxkRxpWhjhtZWNshi67x2ksvsTHo0x0MyXb6bF/bphgYijyj2NlEpF0ClePHCkvN+6Lubzhyo1ysBfTGQzzQjB0+idCqjncRKghQYbUaGx8q7yPyEpwJMV6xqXKMKa0pJYJQlJbVQsorBO1wU45e/JYDz/c98Ml9kdJzoelFU0l8k7CinY2GpdZqMtDJPd6W0hXFpJLqLg3WCS+VlBPaCbR0OAveWqQzCGcqigSBCiXbWc71cUlSrzHYOO+y8TUhzI5QzuyK0th1jBNY4TGigumqEggCpdHaIbVFiQBrJV5U7W4U6kpkJ2xVpY8tMnMIA4UtUMKCjFzq2l4l80zMH1ZlPEW7EQ2nXVaqrBAecMLiCXBEGO/wUnivtXDOm0K6l3Ole0UpYl+aC5LgbCc2hR10XhAi9lIlcixt71y5vnXzwg36sc/89XXx8Xs/HvzAkY772COP/OmLFD7+m5X46qWhvuPooeZikPheqcRUP70jjFTTl5kLjRbYnHw8hCKv5I27U9a5FEJOTVut63+BvPyZfOuSkaMNJ7OR0MWqjGQhIy1oRFIEIbjAoHRIrz+gMJaGDAikI64poiSkUQ+ZnwYdhiyvduh2oDcucFKgbABGEuvQ26xmvZjyebgQBBP7GDcjson6tnHqkbMbq38vSu04mQ1EutnxNBrQgOHaEBqNKs/PTorQN+zZzosjhqv26OxxeeHRv5H/h+yjfWUOJ8W39sVwUpw5cVzAI/DICTgBGxu/Jubm5vzDjzzidscT/P+ZBZn73noiuan94f8xLMzP6jSLRJbRSDeIbN/LvOsbDH0QeYrAEkiB8E5KKURN10iiiDAWSOUIY4gncxySjW5GZmqENiFxgUMllDbypQ3EwE/L1E/Rs9GwDMyTHdH/8qAZ//7X/t1fPfPtL9BCgOcTJz8heBx5Zu6M/98vALr11tP+oYfgJPAQn/gzLawRf+Qm9fAbXgK0sXFaPPHEQwbgPR/6zR9UuXugTMspsvzt2hZHYjeIWsrLwJW4oiCWnpos0eR47VBaElbrNlBCE5ZJRZ9rjQ4UWRAzUnUKFzLINGPrfEbt67lzjxXGfenRJ//zr7wuTXt9BcG3sUvG/5mD9N358eKBBz6hXg8wAu78wK/vFZaJ2cAvRN7fw3BQhEa9TTkzBeagVOKoKWpOyERqLVBSYoUjjcbVtnrnPKIQVurCef2cEUEudLxS2vD/OyrHzz35+Z/dqdxuHlaT93Zk58ike+SRP9v+mG/n5/8H6ucqiiz+IpsAAAAASUVORK5CYII=";

const IVY_MARK = "data:image/png;base64,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";
const IVY_TROPHY = "data:image/png;base64,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";

const GLIAC_MARK = "data:image/png;base64,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";
const GLIAC_TROPHY = "data:image/png;base64,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";

const FLHS_MARK = "data:image/png;base64,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";
const FLHS_TROPHY = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAFEAAABwCAYAAABmf5ylAABD5UlEQVR42u29ebxmZ1Xn+13PsPd+3/e8Z6ohlUqqKiEkZAACCQQCSBJQmRRQSDnSztpqi14U7W5tQ8BGUGwFERVnxIGUKBIkyhQCKFNCSMhEBpJKUqnxzO+w936Gdf/YJzFowHA79s3tvuefOp+q86mz93qfNf3Wb/0eeJR9KchlF19sAbjgAvefX3zhJb/1mp++9aq/f+/L7v+ZS6680j2anlkeTQ9z2cUX27379iWAH37FS581JwtvrMz4GbOnPZFTznoymNnf3zrd+K/P3vvCo5dddpm9+OKLs4jo/29E4JJLLjEAl156af7xlz51y6B32qXRND8+KAvWUszH7z5Tdp35BGZnB2KkuicPyle/+ILz3wVwmardK5L+TzaiXHLBBfbSq66KAK/5rhd+B2bu9aZ0JzXjqY5xan028yedxmPOOg+TNDG7YH1/C67f/vnMY5/0s1+/VQ5cotp9CCL5/ygjXnzxxXbfpuu+6ju+5/S+ad9gSvuSLIYUJZKTU/FMqFl4zGM57YxnUtKA09z6QoeL87aZ6R0qd+/6uW9e3PoOgCuvvNJddNFF8X/1u5j/txLHvn370pkXX1z8+Hf/4M9RmM/E2bmXTMWmlpB7PrtCHJoDziVmB57k1xhJg3XBDFqxzfo0TSdmhy7Xf/Kpe4789YrqyRdddFG85JJLjG6ezP8tT+JlF19m9+7bmwB+4Ht+4MLS5DfNFuW5LjSMTU5ejbXaYrJBUiD5Pq2bsNQEnvDkr2P3SSewETN928NXs7TFUKWUPNy63Za+v3zSQP/rY3ds+d3uVKq76CKJ/9sY8cGJ4/su/oltu3prr82e/xiqPhraSFYLKoVApqHQktoMOHLsAHcfWSGsT7ELlrPPP59zzr4Q7Q/ILiLioSwwgyJ5s9UuHtdjRzW4Ysv24lUnSHULqqIg8u8cK/+9jSiXXHKJvfTSSyPAL/3gz/yHVka/VJRp17gJGtTrIItJBGrb4J2lSgPWRse47dARNlaXSVohpUejMtUxx5/yWJ7+9S9g90m7aIOS3QCpelD1tB8n+cSdO22qFterhfiLz+rNvTnp/bHyORH0/1tGfHDieOuP/dhZKU7eGMzsi9ZtZJJytAEndgrJkwuh52AS4MDB21k6eISWCokZJaOaaOwAbxPUY9qZAU8+/0Ie/3XPZWZ+Hk0Nwc0yLx6GPuEH9vjFHaS8fmWR5afO37V4PYCqmn+PU/mIG1FVZe/evWbfvn3pzW9+fzm695pX2/Hh/2xcOUh1m3JW09BKowEXI871UG84srLBvQfvZL2e0BNQ9dRBcTnTmISYmmRKrDgaAjEGdp60m6c9dy97znwibdmnPzbM9BV1pVpx2R43b0NYm+S85bUvPXXwJhFJl1x5pXvNhRemR7JI/3c7if/jp/7z10fyr1jfe/J4Y4UISayzMWdiXMXEjHcDxnnCgQO3cnhtjIkWJxmXA7U11BEGSQg+klRRCqIogTm8mVBroJIBpz7tWTzpRS9m68wsOQhF4ShdRSiHyWht+7NDotafnOtteeVFO4urH/Tu+qgyoqIiClf8+l/v+PjK0UtzPPhD/bYmNnXM2VmRJNa21FGhLRAbOLh6Hwfu+RK5EQqXCbFEzRSnQmuADDa3WE1smAqbe2QCwRvQjLWCzY62rhns2sU5L/xunvj4c8AKjc9Utoc1SU0skjHqGkO75bjFX37hzplfFmMazVkeiRNpHykjvkZfYy4VUXvi4ju3z899Z12vx0mqSUlsppEUFJ9qKErWxoFb9t/Cyj2HKEkYUxABawLGWJwJCBafK4xaonF402LV4rTr8FQyHotRxZUlcW2F2274NOOjB1g88QTm57eQmxpJ65JS34zWj6bp5Kh3fsuFH736My+YWT36dxd/53duXAqGq67SR407iwhnP/XZ12zpzZ39mJ3bmN+5YMkN7dRgbEI0cMeBY6wevJsiN2AdKWW8dSCJ3LZEn3FaIDmQxWG0JGqLMRaxEdWWNXH0olDSQ23DGINByfSppxvMLxzPU170zZx5/teRjSfYRJlKDt1wrX78Y5fnw7febNuNyflfuOWWT20epPRoMKJ0OUXlmec/54Z2OjkzJckzM3Nm9wmLbNm2lbX1I9x7537qEZTFhAqw/YpBv08ICUjUGLw19DCEOGWKxYR1YshMTYGkGtTQJEitAStoIaScKMlUfoZ+aTi02hLSmN1PehJPf9F3403iuo9/gi/+08e1no4lC0k1n33zzTffuNm1/U9l7Ecal5PGVCanTKFjJscO8blj97JjfkiKDa22qCsZ5EimZNeOOfacvMD2+QGV8RQ9R3/gScuHSf0F1kdrMJqwLrPct95CXKU/s0iUklFd4+wUiT36ZR9kAygoQs37P3E3Mu5x+9XXc/j2N6DesrayRGl7uLJiWk+1H9rm0do7aw4xa96gQck+4UVZ2dhAFCwGl0bkbDDWsjjn+dZv+x6OP+VU5rZtRWa3wcKJvPin/5Dtp53PE5/1cr7++17HkXHkwmc8jV9+6xU84YnPpt+r+NVf/R3e+Ka/4Ru+6duoo/BfLnkrP3PJm1mXPiE0JAwz3tKM18kbS8z4HqqKBNDQhP0r99WP1Eu7Ryw5A9Y6PetJTwnZGHyYECiQpDg3AS2RkBARtMgggdMefwajtXU++Z4/5vkv/iY+/tlPcPDImIte9KNc8bd/wNpyw9HlMd968Ut54pPO5fobPsev/8Z/Y1onfvBHf4EQ1/jj3/1lbr1zhR85tkG/cNSjNdo64SSRW0WdoG5ATi0mQzRCIjXLy9Pmwc/+aDmJkjWRAq1LQtasRhPkgCbIucFog4rBJKVwwonHH8+RtWNsPc5x3nNfytOf820wPcof/rdvZHVpmb0veQEXnDbP9Tddz2oq+LM/fC1veMMvc+4Tz6QoPO94++t41Su/h4u+/qlMphusrR9j9dgaGUsSIRhPUkcikkVJGpA4xkK7Z8+e8Gg7iV1yUdQkV0NDMAU2tRhJiAomG7ItsQIYw/ys56STH8cHP/BuzjnvG6nzHJ+/8jJe/t0/yLbFbdz95tex+8wL2X7GufzMT3wXn/nMNeTQsqXX49a7vsRb33IJH/yHK5lKw2f+8bP80PeNuffQiLvuPoJLEZMzEYsxBTlHyBFioYoVzamp61MC7H/UGXEzKGqTJOBCBEnUWPoxQhEx2WBdIhnH6Ttn2XH88Sy6CU9/wWvw83s498wdPOubf4aV+27ixc/7Rg7+019wy3LNT//XN3Lgi9dw8lnP4aRTdlMuVBw4cpDXXvpq9jzuHGa1oGcL7rjzTlY2xpRSkElIUiRnsjNIqvCaySii2hze8sHAYR6dRrRFaKghAFXKBA1ka0hqEGewJjLUzEl7jsdUfc658Fu4/dYv4IvPsvvJL+fQdX/LOLfsfNo3om1gsDollH3KJ5yPSOaWG2/njMc9hTPOsOCG7L/ji5x34QVs3/0YvvjW38OlQOMctnVYbUmuj0+ZqA1RC0oRAqHlJh6l7gwEsY23DT43BC3IZBqBShSjEQ0Bu9Bj1+POxBU9JuMpZSVkmdDkCrEtiIfcUlRCddwsQSHRJ2OZnwm0oSJgyKkBZ7j6o3/DXDXkvvsOEVXR7GjFkk3A5pakgmSHzXWX2DRPH5RQ9FF3EovUBheFJmc1GigosTSQW5wRUhaGswN27nwMd3zpAKOD9zAdzGLUMDdsQUYM+31idCytrXHf8gp3HhmzMpoyrSPTZDGSMGLZMdfjp37mlwirKxw7tsbBu+6kSUMqGiBhUoHahqwFNidEVNUkYqqnD0qs+VFnxBRTMtqg0SLaZUWTHSk7kmlRqdi20ENmh7zvzf+J9vrP018YUPUK+v2SgYyYHRqq+V2ICseWVzm4oRxtI/etJPYfXmO5LlhbG/PGV343d95+HY6WW267lY3VNYyzZE1kVaxaJPVoJVGkgKoFteRcTQAuAS59NLnzxVzMPvYxDQSrIKkliCNEIVJTlSVZM8m0HD9v2bbzBJ7zH36WnJTKRqItwBeUrmC4MMdM4fCm4ZlFgakcagso5/nI37yLV/xfr+fME+d5xX/8OT7xocvZdepj+dRH3sEoJ5zJpGQRBZURgqMMJeSWLAmrgkltDXDTI9T2PmJGPMIRAXDtRrTGkhRUAlYyNjlc9iAJ55Tjt27j6L33cua5F9Gb3fHl/1GzzNoNf8+Grdh59jdiZAbdDFzaNPzpX7yf9aV13vSWN3PLbfsZzs3zyU9+nhtuuAdrB2gO2AyimWQtRgSRSKsKqlrkEqM6eVSOTK/iKgBKXzaBgBCRpGiCxlqmKDkHjMkc5jhuu/MO7rnzdnJKpNCSUyDWE972k9/Kr7zqu4ntFFFPji2aIgb44ze9kr+4/GO85qe/m7Mv+lau+6cPUmw9kcv3/SVjBpsv48hYMI5CPSIOUgY1JBFaTbQm1Y9KI97/5TOtqCObAlEBLchaI7oOZEIIHFkfUecBkzpjrEUBYz3XXv0xfvv9V7Hw3O/npPO+q+uxXYGxlo+94+d5/a+/nVd8xwv5mUt/j9954y/x1Od+E3/xW7/B3cfWEBeRrJgIKolkhCRTXGgQzWTA5HazjjCTznseGXd+xIx4ARcAsCr9gChZGkQSYje6ZiZbrAoxZo4duQfRhqOHvnT/XAaA2277DIN5y9Of8rSu5nSelWP3cO1vfwe/9rrX8/UvfDG/9weX8dbX/SwXvfCb+eQH3sWnPnMNrQwxKkiOIBEjGactijLyQi2OLAoIQVpEq9Gj8yResHkSdSlkjVTRYFEkV4haHJDEYp3h9us/jwiEjf2bB6N7jNm+49yznsBkukGernD7x36Ppbd9P/Gf/o693/cDvOVtv8/vvf4nOO/8p3LXzZ/gL//ir6iZoyJhNIAq2ABiyGox2VJFxWqLIyJAoWDz6iMaEx/BEqeLiZKmwUofiycDFsVri+Ye2SYswsb6iBs/fx1Pf8azufK9l3HRi/eiOVF4SzDC1R95D/d84J08Rg/y9Kc+ke3f9E5O3noK7/qNV/P0576AG/7xSn7ld96BKY7DC9S0WAOJgqwOly3ZgCQlm4jkTMyWMicU2JByCpNHY0zsjuLczGJrBJIEMBk1kQAYHDlacooMy1ne/ed/xqhtWD5yB5/48OWIsZzzjJfjjaE5tJ/Kt5zx7T9DfNlvc/fqKl/44O9ywYu+g3/4y3fyuv/xe2ixjVIF0RGSFUmCmEQVDUkyNnU9VLBC0oDJidw5NP38yGbnR2zGcsEFuKuuIp73hLN+tl0dvTHHELHqWrUUOTIs+2AjQsZ6R1tPaV3Lr7z1d6mXDpCaEc+9+D8SpsuMD9zAtl1PYP/+mxjtv5Fiy1a2Dvv81q+8gb/48K0MFvbgpCGrIaWAyUpWQcVSEJHsCTmAN2g0xJwRA2WMMRrcSp1+8O5jx/7gAnBXQXz0nMSrNsu86SgYA4YON/QdGQYlI6rYnAmxZdAb4mrDz77yexhsHXLaEx/PZ97zeu64/kruOjzi0x/5E/Lafex87BNYvutGfvanXsWf/+MR5hZOxJEIyaCpIWkiGEFFugJbBSGCaZCUEUk4EiYqKlFshsx08qBHfvShOE1qQ0lFti0mWUiKEUcmkhCyWFxsyDmwbdDjaIAf+/4f4kUXfzOv+I7vpdBVyihocSq3XHc1n/nYb/CpWw5zaNxjOPC4OKIRj80GJJPE4LJBtMWqoGoJgMOTxCHakggkW2JTQZaEUz9+pMCHfxcjuuiCSKaXDdEEghaIySTAqSIkMomoLW0S5lyfaHvse8cVfPzvPsSTn/4U8mTCsdvv4L6VKeNUMnQ9Znp96tzQqiHnLuMmCqxmjEwx6jreDhbJSkRQm0ki2Gy7rI2IVYPY8GjNzpsAhHPBJkvCgCZUIqIJUUMrQpkSIhVIIqWMicpsIcxuPYGNacuH3/9ZvBH6ZUVVzbNVDEEhxw2SOkQzipC0ICeDSMBIRHPGmALRdvO1HClHjChx80SKIJoTtL55VBrx/vgyNT5kjRQCVj3WKCkLOVqciYjJIBFVSJIQlJQAAmVl2NbbiubMgCkhd/5mRElGcDmSrSOrwWSHNYGcBSMeFY9TiArZZiQFvGYCkMm4ZBFRyapMs50+Ko14ARfwUf2onHrKWanQFp8bQRyGlqBCMpmcW1IyeIlYzQR1tGYCTUEWQ9KGRiM1mXVtMXkKdZ9gIhOtydFCjqgTyJ5sM5aAsRnNQpEc6ntIYViwngQYC6KAOoSarIbhsAoH11QeKWbYI2JEVZW9Z51lRCQOF4are+a2YKUgSUIxOCw51gy3DDhuex9ijfGeIiaCnUG0wJvAVIWUS7aXLb3SUQ5Kts320MJBr0Btn5SULCWa+8RUkmWKU0fMYBlx5OBB9h8ecfi2o9gkRDWYrAiNBimkTTHedvjAYRHRH/7h33Vvf/uP6P9sgvmfNuJll11mpdsjaX/jb//2uD957S8/Ph69t6trECQXZKmR4Ci8ctvyOuNRgy8tRiNBunKowNCSERGWysyMLxls6SOzwqDoU8xAMYRSZinsNowfYE2FEcjWYRgS4zJ3rdzDzsds4+idy6QYu7hsHKpeNLe4suIXXvumF377ec94z+Of/4zl+99h79696X+5ES+55BJz1k03yd69e9Ml7/iH7c+cWb7k3uuv/fbzTn3M4kcO3EvhKqO57qZuCMmCZsPBe49xdOmrx/VbHs4DlHTTMAHvoOyVpFYwVvmBveeheUw0liglkidkFWJSBsOeO+XU8//grtB73b6//ehb7vvQG35j7969zWWXXWZvvPFGvfTSS/O/uxEV5DUXXPAAD/sdv/pb37zx6Q//5m15vGc0XmN69JBGFVEJoALErrMgE5jifXfarEBWfUg/EgFDV0BbIzjpmAzGCGKFwlWUVUUbJ9icceUMriogBbbvmOcbnvMcPnLF9WAMOU8RtQgtmhLttObe/ddlt+uknYuLe95wynP/+95/uPBHX/28l73kI9Dxuy+86KIkX4OLf01GvPjii63s25e46qr4ul99y8nz99zzi0fvuO57p+trrIzaOLGllWil7yyhnXQZWgyBzWF6rkhqUQ1kOtBFH9R7PjB+U1BRRJWE6b4PSjIGEzNKQ5wkNIMhE92UatKNHmIaUg1PxgFtVlISshpim2jbwFPO2k1pktlYOqw6kTRcGJxTFbMf/uR7PvQnrYwvveCii+4E4bLL3vWwXdw9XNcFuPTSS9PVV7+3//7LrvzJ8qbrXp1jXBiNl3Q9JS3ASau4mYInnXgcq+sjDm+sUIeEx6Da4kWw1j5gsK82sxQVkG74bgzkbtSJUSA61GY0RzIG02Qam9AcIQttu0EMCeMsTWiZ1jWP3bWHp17wjZx2+pNxxuBNliTZhfF6HtelbF/of49zcy/+wvuufv1fffY/vGXv3r2tqlrg31zC/LeM2O3ebbruf/+xH3z5R9/+zkttrWeujxska0qito9ILVDYgLQNhQlsm59lpr/AkdEhVjZqQm464mYKDw8R2XzuLIKIollRhCxAaDrMMIETJbYJX7QEzaSUSWEJMmhWti8s8MRzz+P0ZzyXuRyxKmTfozBKL60z4+ZMz2bGG0upX1ULC1tO/NX/66J3fvv3XTD9ORH58P0u/tXW3dxXc919+/alS6+6Kv7E85/95KpX/fewcvgFxEjT2ORcMmta2ZKE14DPgdo6elbpEajbhiElfvsC+CmH72nImh4SAhG66a9IZ0VRQQSy7f4UMZ1NTcbairIqwGWm6xOCgtVMi6VtE956coA6JUrnOPvJz+TJF76QNFqj0QSFYRgthUuUPuFtZh6Fct4aN9XYbOTc23Zu2Zv90OHbDv3B8rr9xTPO3XafqgpfYbHoKxlR9u3bl3743HP7J+1c+C+pKF4tuS2nGyHVEsX6bCMlQyLT3NKKUuY+qlNMhu3GgPccaJVrDxzGFpboM02wSP4XwFHeNKLcHx83EwqKVe3QGQExGbGCkYQ3jkyC3P17BqRNxCA4K7RxgyZkqh5cfsXlXH/jF3n5y1/GYOsWBjFRhWXm8LieZ85GZtwM1lnaYlGiwR6RaZ5JlWwduB/o94oXtfe0rxGR3/1K9aR5qOwrgr7qBc/+hh0nHf8p169+oQxNmWuTaoPNgtGopAghBUz2xCBEM2YuB+atMtef41NHR3xsZYlTvuH5nPb8FzDNkRCUoPpQGf9BAVJALGq6bxUloSgGzQZyIuUarRs0AZrJMSMERCOlTaS0SttkGoSX/fdf5NTzTuet/+ONXP2Rv0faMV4C49zQT7IJ3jqyjyRJZGawpm/6skXCKKfsdYfM2d9Z2xh/dOnQofNV1Wyeyq9oRCOgpx2/5XEe+cC85QmpXo+FZHXe2JQCZjMWmXZMSpF+bOnnyCBDNZzjwLTlj266nfDYPXzDj/wgy6uH+MgVlxNjRHPAPAQOrPLPWVpEEUKXeBQkd7Q8ckZTJhuhVaXVLuapdkNSEYti8AWE6QYhwVrdsO9P/5hTnnERP/Ha1/KxT32ct/zh27jzvv14G6jTDI1WjB3U2qO1HQtjruoR5xqWqxl7SIzurw/H2Zn+BdPQvPclL3nJwBijqv/8Iuah4vqxtdHxNxw+TBunUSidL3viRLHSo8yGoUlYV+CMJVnY0h9Ab4YPfuFGPnTnPTznJ36EU5/zXP7msndz/SeuojCeJBBSR217yOLz/mdSxSjYjkmImu4sZhEcbGKUFjSC6U5qVoUsmJxxTpnUNY0GtPBI0/K6V7+Sj93+eX7+9/+InaedzK//5pv5uys+ypSW2BuiCvMEhq5PsJYmNxxuAqN2TC8jO2zPAOnd7/yLjfe+971BNkPMV42J8wNpbrnrMI87fofdVUIVobWRyiR6GXy2lN5TEPG+4NalNa66/jpOfuaz+N7v+04++MEr+PQHPoBLBbNbtmOtZUPAWWHgPcdosFZISR9wY91MyAoE3Sy4E6T7f0CUBBQuYzQgCkm0K8qNwZDJ4rHWM5kEFOmSeIyccNbjueYLV3PDjbfwLa/4Hp76ghfxrtf8Atd/7jPs/f5X8pSzn8qktMSRIWfDtiKzWEKhCTvN9OZnWTl8xL7nsj8dqWojIl85Jl6y+UpPOmF2PK439MB9B2VYDClsICfLQPvMWYOXlqGNjLLjg9fewMduuYmX/sJ/5pzv/17e/ua3ceW73k3f9yjmhhTzJVqU1NPMKScMeMoTtnQzZdPFjn/eDeu6lwxsmykZFI6Zvmf7TMm22YrjFioW5wrqGJjWNXWIOASRLr1n51CXEWdom0yN7ww5aSh7jpliwHiyztvf9Ho+fdON/PDv/z67n34ur33Df+HS3/llvrD/bgqfmJOWnjGYXJAQQoqY0ugH3/du7rn3ppHxxf2RR7/qjGVh6/yGeBeu33+QjTDWflFB4dgpI44TWKwG3HBszF9+/OPoSTv5obe/lduP3cebfurHOHrkbrY/9iRMUSK2JWZDmk4wNtPElti2DwQOkc088kAs6Zz6zD1DXvCEec7ZPeCZjxnyLefs4AmPneMbn3EivcIiAtaBteCd4K3BG8WkjLdKzkImYLyhHA7JITPNGeeF47bv5hNX/B2/8mu/zgnf9HJ+/Nd/jTuu/Qy/9tM/zBV/++fUaY3cg1FcJbkS5wyT8Yj3XPZn9Htzq5rzv7Lbl7vzJtds5uST69nPHWkPrU+KW+47wkknbaNHn4XCc++k4cpb7uCe9TEv/E8/zOJTnsbv/tZvkMMyx524g3Hd0NY1MzMVoRVynRj0Hcs5o2oIm1VWzoAVRJX8gEt33xw4ts69SbDWcXuoKQ+NGWVh21ok5s2aSEC9w6GIGIx1XVdkSkI23UExgZQy7XSEthEzU7GxfpTFnTvYWD7C2y79Kc573kv58T/6Q679sz/hLW99HZ/8p7/ju171izztKRdgQqK/c4GrP/FRbrjhGubntqyRV7kY2PdgdvCXodOb8HQZo1teWv/RpGkwnTbsOWmPCHDDvYf4u2u+iD9hkW989U+wlKa883+8kbXDhzjh1FNZXl6lnkaqqoczVfdibaQY9qmPrLJ9zkHpuWP/OsbIA7HQWcOgsqQM3hmOrkfW68TSONCEzOoksTZuObI0xVihcpaitJC63twUhqKy1HXm7Cc+jvn+kKs+dTO9uQVmT9zK+rFVrPMUvkeME2IG7yy9fo9bPvdZbrj2s5z/Hd/L+c9+Jp+5/D28/7I/JcUJJz3ubI7btcjb3nBpvu3WG8z8luP+6UsHj71vG9j9DyKHPmRiGbmtbchH6tIY9q+N9Kq7jopf3eCegwd43AsvZP7rns67L7+c/dddw/xxOygXF7n58zeTm4yp+oQmYI3gnSf3ys1fYzoqh5F/1TDPDxzf9Kzd3H7vlFRPqBTW25aqXyBJOHlryT1rGWeVYtDnyHrLnsfu5P3/cC1SFjgybrMMcsayST8EIxi1zG0Z0mw0uCox19uGGKWZThktB2Zm5lhfPcybfvonee7LL+abf/WX+MI7/4I/edtb+Pwnr+KbXvr9XPmxf6A/M6Rp/cpD8tQfqsQ5ePAgleVHnLgtitfRypLIoMeeF53D0ozn7//sXRy68wCLO7biTIX1StEzOHFUvYp+NYDUIij9/gJkZe2eg5x90pDjdm3lmuuPYK0h5c6Yg9IRouHeI2v0epbRJNImYXkjsDGONDlTeYf3lmrYZ2ZYsnVxyPpoyrHVKc5bfOEYj2uefPYZVAL/eM1t9Ac9Rk0kNIGZhRnmF/rMzc3TNlM0K3iLyTVlr6A3M+CGz1zNzTddz+O/5WU8/szHcfeVH+ajn3gfOvB5YL0Zp/byQ0vr/3jSBZj9+/+NkwiESk1tjKKitHVAH7uDI9Rc9+FrKI1lcNyA+eGAoudZOjqi1/eUCwZjPSELVnpUMwYphdgGskSCQk+73x1jt6+sCEfWG46sdfsQ9xyZ/DOouNndfGlpCqxtPtrBbm5ioHSGojRoDKQWHELpFW03MEBsAqbqRrRrR4/QHisoto0wrqBpG2KO1NFAk3AIC9tnkDjlvW9/Gxd+28U840e+iyt+5x0UmsgIZVGs/zNl5qqvWCc+kL691UlASJK1zS2tBuzUsXP7VpqUiW1DSoZm1FL1DK4sCe2UbKRjPdjuP4+TBlM4qrJifWPCoaXOnU87ZYGZsmCaAttnK9Y2avplj5xbKguTSUQ1Mh61NMYwKD0nDj3qDXMLFU3qs/W4iknjOGn3bm669V7ec8Vn8c4zmW72RRY0BVCIlPS3z9FMazZCwAHWZQaDGYgjoGBmcQG1hnZ5hTuu+RQ7zng8E01460VFEDdYe7g0kg5UMTqyBIpNnguqqLEkbyidpyh6iG1p4xTVRAoNiCVPEs4L1hjUVkhK+DaQUyarYTTtjOiLktmFPqSaNjSUlaXoGxbmKopeRaORwystYi0+Z1IQQszoNDPUkoXCYxvo9UqyBm658wBqBGsyoW1IgB9ULJx4Av3BkBmboOgznN+CTKdM1peop5nJyhqrSyPqWJMbYe3AMqurE1xZMR6Pu4lhtqAZ75pVgO3bv3zJ3H1FSE8Yd5zCrjOoV0aUswWaImKhKvqo2QQAssFbwUqBtT0wLX6uT1srdqYibRzFERg1FWnaBf0bbj7EoO8IIdPGyWbNopt7JooY6eIW4IwQteUGVYwI7pZVpIO1cd4gAr2hh6TYsk8TMwLEaQ1J8WVJyi3r9x2imi3x3tAkT2gmaDvBD+ax4thYOowKjJZXcVIxmazTLbJlYyXjC7P6tYGyaieKJ5Cw6kgh49wQ0xzGbx/Qjmo0WLZvP55REyCMmN1+AqtHlrBqyOKg19V0uewjzmMlYXzZZTQrjCcRs9m55E2D3c+avd+AADHrg+AyJXXTfkQhp7S5Btz9+9pN1zLZ6OKq8QVhOsFUSn/LItP1ljRex1hLThmLYlwPwuaHWM4gxmF6x7rfu75Zx3R4mxbZjwDOPPPLAYCvyAqrvBupRLJBjURKKzBbMjM/gwbbrd6SGK0fIa2tYtQzXTuGbZuOzra8ghNLbhJiPWoM3kUKnx4IvyKQFXQTkDXmn9sXkc228EEVUbcA0GkN6P0dz2Yp0zQZVVg7dIyVI8sIYKsSTRmtG+q1NcTUuNkZYgh4p4hYckrkNuKcR4zFG89wMMdgtiJM1zCgNgtBeyEOe6NuTPJvn0QBKGaG43ppHUMHyzvj2b6lx/67EkXZR9uGVBoK26MpEtoKpmlwMyWxFlCDlxpiopjpUSJkzZTePujX6JeBD/cbDzqX1gfhc94ISWGm57FiWBrVZO1cPak+gAKFDG0SLGByxJoEeNqQcHULRUPSAKKYMlOWc+S2ZhICOl3DiDAdt5RiaNqme3cJlI7pzMwJD8km+4ruPJ02G8ZmbDaUYlleWmXHNBODpV49Slm6TgDINpSzPTAO7ywrR49C7FFsXSS2SjIZ2+/RG/Rp2wmTiX3QaLTjFObNhk9VERUUpVc5ztpTsnvWM2catvSFWedAKiYIoenzgZs3+MKRQPmg+WYkM02gBnqDHrbn2RhFtG03QeQSjQZjMmQlpgkopDaRksX5iJJJtiU0Nd46FfGiYsbHu+XJw4qJ91dA/cJNmuCZkhFRLMrS0VXitAVvCdZQiSFpTR6BmB6j7CkHC9hgsFWJKEQitmgIBGKbGTXtA5/l/XHQyP3j086AZ582z1NOrxhUAVYD47qgyS1lz3PijMHYmjaXPHNXn9/+ZMMH76gpNwPTcjRMU8QL+GFFShYTJ7h+QVEMaKYTgvEYZ0jrq4RQ4L3gbMaowZsKyo6uHJsMheBcRMWNtv3Ya2r2XfTwE8tw2J9Oxy0iGYxFc8JXA6qhJ2gNvsLYPlYLptNEUSqVVVI1y3R1QjE9ijcO7JBwbJ22jZgi4l03NMuqbFko6ZWGew9NMSIYY3jmU4/njF2e/YfW+OKXJhw51jBuuvL1eWcVHNuYcsaOHs89XTmSLN//7Bnu2UjccqSbIgbnyLlLNEYrpGeZ80rTBrTNkBJ5NIayRKzB5a7CmN12HJO1ESHUtCGwODvLhBYvrqvsjYwvfc7Xx6/JnUkytRK7JUOXyZMpebqCLSx9O6DOfYzPhGjwlSXFSGbCdH2NouijTSaQaeIyg8rSr4T1qXBszXeJq1fyzPN2Um80tI1yZKXmeV93ArsWHB/4pyPceWAMKP3K8fjHlhw/65ktO3bXh28fs5Z7XHSao7Ql33Jenze8724UmJnrM1oedSSBMCVnSNngtcPP+ouLzC8usrY6Ym20hkiLjY7Voxt4p5TVDCknhsOqEzhyopUpqG21jh6+Pxnnh2VEzWHSzXyDSFbwBt+boZQKSTVxeZ3h7Ax27FgfHQPjsFJQ+Ui2QpIS0xoKB63xpAhlFupNPLGpA1+8fQXJka2Dkl27h+zYOeSv/+52ltcbFuYKtmytOGHRcdd9E+473LBlvsfO2YLHHuf50nJgcclxXt+xZ88cM/1DbEzajo0YDVkyISfE90ltwPiM1srGpMZTEGOL29SKEM04WmLM5Nhiy5KVSaQdN3irOBvoZbfaLYIi+/6tjmX75lGd1tOpMwZMJ+KTQ6TsV4yWlji2McYNIuOVMdHWaFkAHewlqhSpIcRELlqaHMjNiBgzyfoHanlV5dYvrTK7OGBEoFd6Pvjh/Wzd0uOiZ27liY+bZ89xFf/0+VX2H6hZ3ojcds8G2vM0Dirj+OJ9DYdbZdkPqaoCgCfu2s7Ad+WS9w4b1vC2xVi/mcwyMU1pQ2Dahq55KB0mC4JDRbE2I6Fh3LQYa9Qai/pi7WveHkhJJ9YmrHREoiIZ6o0WJUBIhAiOhvVjaxQ54JopsQ20ScGBI2JTwFqDSxmHknLqBkw80KBw7ReOsXN7xZfuWuHUXQP27Oyz/8AU7wxXf2GFEP7Zc04/eZ6tc46iKNiza8DhY4FpA+OREuJmO7ltG3izuZzZYsRQ9QusAzf0VHMFvfmKwcIc23cfx+zWOXxvQDEcUFUlrjePWEduLSYkjPUYUzGw5RrAkQv+9bjyKxoxOjs2QCVRvE0ESaQ0QYseJgXqjYY6RgrvKBd6uEFJshHrHMYWiDhi8kgTyc6QS9PtsDj/ZXSRhaFjYbZiYaHi2FipQ+a03UMOL02oqi7aDHqWp5+zjSc8bpEPfvIQ/b4lGmUUErPHHcfUWMaTMSAcXpuyEUC8QURwxmJ7PXq9gtmZkkF/iMZMGQIzPcuOrbMMqj7ttKENAUNi0CsZbFkka8C6glgUFAtm5WHTSO7399iapmcLkqi43LKRgayIVep6A4OQjKXX80zXBGcqPCNSSOShwUdImpHC4QsPpkBMwPov/9x27axYbxoW50pCI6ystxw9llndyMzOFjzt3AWOHUscW5ryqc8d5eQ98zz5rK38zjtvZNfJc8xv28nN19xHiF0VkdrQnSA6ZplWntxGJtMGZxMuB4x4KEvyWsNIamZmZtiy+3iCJuowws3O0/MZlyPe9XFOmC1mVx4KBvtKiUUBxOUGmylVRXOJazMFHukZ8tyAPO0g+YiQ6hpfGqqZGbwvCCHgZ2Zp8wbtsXUKrdjam2EynWKKbkBiOiCa+WGfwcBx8L4xRW/A4sBz3z2r7Dp+SFkpG2NhfaKMRplvff5jOHnPAu+6/IusjSN7z95NMbB88to77ifmPrBtqsbgyoKydLQbY1zISI5kLbG+JKeI9YqVGcI0EtIqVVFQ+CH9wlAvHUNzwnoRJxWIrD3sk3i/LsKsr+u+cTlnY8Co5CRZx4yWNroTWRicFTQppl9QzsxQb4yZO34nXpQwnbJjzzmsr60TdcoX7/0CVVkgvQpQ8uYw6ZRdM3zx7prP3bxG1R/xQ3vPZH5gueYLh3ncY+Z5zO45nnaGobKGwyvK0UMjVtciTz93yLe/7GTe+777uHP/EmIMmjY5ioA1Dl9Y4rQlCVifMNWANG1pmwnOCW3b4PtDpPLEpmU6iWhvlfmFreQGUjIkG1FT00wH6x0Mtl3/TSPe31tb32tLdUkkmuQjftRgUqIoS6brE0rXsL6W8WU3352sLqHGcPjeOzB2lqKwrN50O16h1SnL4ylnHT/P173wSdxwzb3MzfQ4tjTmzCefweHpnSD30tSZoyN46UvOZRyu48MfvY2rrz/E4x6zm8edeTKn7p5h1/ZttKng9b/2Smb7E37sp3+e47YOMSZiveOpZ5zOZ6/4PJhEvVZD1aOaAYklIVjEgEhNiglvBYktXiKuV2BnBzTtKv3hFprJlEAiBSsxRGQmPvyY+ACKMxjVNiyEQq3PrqMkFNWQVB9mrC3TVjHqgIxzoRsCt0pbe5QJSSuIDZNskJ5QuBbnjuP0s76OQf+v2LKtoK7H3Hyb5Vtf8u186AM/z4l75vnQlV/km170bTznmfNs3bKdc846mfktx3PwwAF6hXDF33+a1//mH7HzhFP43m9/Aa1N7DqhT2wNw4V5HrP7dEKjmMrTO34rKStpdaOLUrYl54ixFucNNkFrAlJ6HD2MEzLzUPRoQ3eCczs12XlQu/G1lDgKkKZnNrbqNbYq6BmLU0jSJ1cFGGFmZp5qboC6iiQDMp7kFCTjnVBswl8uN8z2+xhrMEnIocBaIaqwuG3A37znfezYsZuXveQiDt61St3UvPu9/8B5T38G3/bS57O4sIMD+w/isBw+tsKv/PafMz+7wCv2PoNPf+Fa+r0Bk5BogydrYtJOiWRKEagjOloH6aCvsj+kGpSIdHuG4meY6S3ifEHKiTjZII6OEdeOUYqiMek0R6axTjpd2uiwxH36sE/i3Naymc3aqLHkXGHsOrJ0lNmFAaNynZAAX6LTaVegmkQIYH3E2IqmHXWuvKlSHCOoEXpFx7zqG8fEWoyJ/MIv/Dfe8ua3su243bz7PX/N5Zd/lLWjB0hN5OY77uScs8/kN9/2R5x82hn8/bv/jF/8xZ9lqY4MFxagzmSntM7iij4uBWLKhJyJ0zEkRawniqXKBWoVMZ6qZ4jjKU22RBKl6fYAVcG4itR2LaOqErRoZnt59GXx7uEYsTwhx7mjpkkSCeo04ySQSOOATIVIp3bvQyQNN8HXHFHrEcnkUU3rLWVviGkaLDWSE9Z7yiIhxmO1ZjBTcvDIEV75kz/Cf/rxn+R5L3gBy8eOsbpyjNmF7Zx1+uls37bA5z71j/z8q36IT37meorZIcPhgNRkxGQcBmWCtdtRsWRVxFhIAWMVtQWSDU2sOzHfQqjrFpMUJOJtZNJYjE3g+phBj/bo6iaqrViXJoOTd4zhdi59CKLnVzTimWc+L6xf8+6GPKJIjsJlphlcgnq8QbmwhRimaG8BCKS8DtbhKJi2EWyBcz1gghRD3Ox81wpSoMYRjaAuk4IyHPRp2hH/5Rd+lt0nnMhZZz6BE47bwj133cT7//rPuOWWmzi4tEJRFAwXF7ES0ZQwplsUVwrQNfpGu4YodW2fweIKoa0h5BYbO5msGetJqQEsOSRIyvad86S2QXUWX/UYrd+Nc2iSLM4X4xe/4lvqN/z2J762xPK61702vvrlT21iY8BmjDMU2WF7Hr84j7iEiRExDVnASoV1PXzlSKuRYKA1iRAd/TYyXW/IWyyigk+gJBKmawcNeNdncaHHwaPL7P+HKwix42z3nKfXGzK7sB2jmURL8uCzoKboNlglExlgKkfSptPnFoHcMlmFwcw8vb4lTVts3xNHEacVgzmHrWZp24iIpawca0dXiGsz+NZQAj3jKKpqfP75r6rhpx+2EbUjHCkzXtqUYZxLEIfvWXoLfaZhgY2VNbybxc7MkKerhBSwruy2Oi30TMHc8SeydPhL1JMpJalbEQOSEyqddpvP1tLzFmIHWpSuoDc3wNhMmxXBYmgRbVFXoFJA7gjIIs0DJA6hxRhHiC1JwTqL9mcpwhRcpKocoZzFxZJmfBTfL6k1kjfGNGmdtfWSaiC0ow36/SHrcoDkrPrCUxRmwxj7ryh1X7V3vmTz78tBMXW9irK02vNKig2FN0yOHqXA4CpDmqxjpuuoZsbjMYXpYQYVdssca4fvIaQE3pMHJSmHDkEWQcV3qu1OwESyTcSg1PWYaT1lfWMDbQOaG9rUMG1b2qYm1tOudcsG1QqxFofttky9JURDohNlMqoUwwH0ZllZmdBKJNXTbi5eGMZLNXUbKIMyLB0mZJLpIRRM2xqsQZxQWFnVjrkhD9+dN9uW5IvJMLWIJkqfGU2UOkZUZggm0I4D1FPUGkQdizu20t8yh20rJstr1BtQ9ErCpKVen5K3ziPGkpPplnuyxXhPTobYtvT6Fbt2baUNifm5Re47eB8pBbZuPZ5hWVE3gSSZI4fv6ZixWCQZMLHjbVtD2yQSIIVjuGOOem3E5OhhsBXp6HpH48uBjbWELxxlz0AqmU43sEVFVSRMKYQ6olLgxDI3V61/NeGRhzTiWTddLLAPLzL1pof4iDqPw0PogQRcAHUTWpMxanE+UPQqRBx7Tpnj5pUNJAXiKNGGiC8cZCWnTJsFo7nbcMweyNRNw6m79/C93/4fuO76z7Awv40DB7/Ek845m+uv/QK7th7HCSefyNHlY7z9jy+jFTCS0WxJ2dKaDUqbINediJAY1o5MSNOabAYYbWjHE9Q5yIIrLSlHmrURtnS40pNCxpKJEmjbiLdRvXjCTG9tE5Bl39e6UWWyTstS8GLxUrDWNMyklt5AqOua3Fi8LdE2M9yySEwG6sB4ZUx/WJJTw2htQn+2ZLIxQGNGVTDJko1BxGOtknLEqmO8ts6tN3+O/XffzbGjh6mscPcddzEZrXHd0iGWx8eYrfr0fEGtDhGHMMUYhWBxUjKJHbc7YyhKoW0UcaarJ4s+kjryZ0Zw4oil4lCcrXAx0RhDM4pI2xLVkWzC1JPVB7DEqx6uETdNvmF0OlNZyhjVW0cTJ0hVUU/abnG7cLQh0l+YwQ/mOHbwLvxwhibNUvkh1bY+uT5IahssSsxK1m4XJWcQYwlNQ8LRJuWuew/yh/v+mmndMuz1qJuanJXZgaENJe6a2/AIFI42ToEeg56g6sgypSgKbJM6AKIyWC/EXONbqAWcySglRgUNDUV/gPVCngbaOEUKQVKPYdHnPhoCiTbWlM1k+Wve7bvxxk4LUcRNfSgxhdDzCWkivoi4Xp88mTBNLTPbtzEsKtaWj5JDj2ZcU8xYop8lrK0hVinE4kIgWNfVeGoxONpmwlOf9Hhmqh51COw4/nhuuvU2tm1ZYGV5g8eevAekRkxJ2R+wsXoEQqQJhtmBZ2ZukY9/6tMcXFpDQyQbodlU9dN6wnSlgWqOdn2EESG7tIkeGbIKTQgQFWMd3gmUA6wWiFW09pg4ZToOjNNXHg38m+5cqp9oYclBsKaiNELfe3r9IdX2WYbzW9lYqTl84E7EVqSiRdoxzcYc4+X9xOk6w+2LhA1oJZJJGAKgJIWmadh90unc+6UvctIJOzjt1McwW3pOPf1kbrn5Tr7uWeexvnqU+46scejgQc445TGMRhM0jNm6dZ5dJ53CJz/7OUKwxOixGpjGtmNUFENsVSExUntBWwvSw/mMi5FgHbEJ2MKTmhVaqTCVY3axZNxuYFNNTiJNk2nWJv/PjejRUVlAkyqis4irqGNgfTJmZu44jLSM1w+zMDNkVEOOEyjmkGaNen3E4kmPYdqMWDqyzHgqbCkFipI2JWwWrBnyt++7nFNP2MFV9+7nY5/6FFvmZvn7j3yEhdkFPvaJT2JcxEjFfQcPsXXLVhLC/IxlfXUKhWFpYwNMRbMJshK7+bPGlslkAxctvj+LLyPYiqYONKnGqkXJ5BywZYk1fVysma4oJ8zvwBpD3tTwmcZmrcMSH3q376sZUaTftDCkkDE9l8mxoRr2SJN1VpY8Bw+O6M8OyG1B3R6jGlQ0dU1Dd8PZ0n1LjFbGBElkHClGmrUDNG3CSScFNF5vOXJsGWvBYrklHUUdpLiEs7ZbuZWM854j60cQ0+np9IynyRbnIoWvqccNRw9tEEyNAg0GRolJM8aPLSKWwdBTZEiUSE8xdpbQTtAEKU6ISelt7zMoHUWsMcYYa5Vow+rXfBLPumm7Arpz8dTnt+NDFJKldJbRaiKOGsrhENvvMbBCO2rYWJ0gxQJtu0QSy3R9QmxbmhjJkindDKNwlPW25dMf+SvWN1qs7aZ9JgtYQxO7sYEopJSxqrQBVAxCQusIxnSL49lQU5NEyLmb6sYGrr3+HhaKrpgLARypQ6ttwhWZcZ3xtqA3P0fPNQRrWSxPYtIEbJ4gRjCFoWkybbDYMokzlsXZYv2ridO5h1IX2bt3b7r8Dy77Fkm3Pnt16Y5c2IHFeWy7xmg6IYwVJw1RM1pDVmE6Xce0keSFcQiQC9BAiEJR5Y42EGCpMTTNwxWK+5erxelf/PnlX3WCWjuqcW4bmrHgZ2aIoaEJibI2SN8SmjFpPIEEzWCKMYZmapnrebbND3FJaSXiqFI21j79GS/9T++4/G0/DC9/yErR/UuZghtvvFEvedV3bC2qjd+crKu6DGID3hpQZW64jYPVYcajdbJGYptIwRDqEXFqaUso5+fITWR0rMalyKTdQJOhjYmtwyHP/4YzO/VhhJQVcoMmIZMf2ELNpiJZwWlNToJ025DQCb90+hAOJGckeTQFFo+b4dbrDpMwNM0YmSiaLaotzpSktmbUjEkzszjfo6gsrpmgg0V8Xme6ts5ST+m1Hc3MlsamGLOvqx+a7r/mst6ecz70UPIvX2bEs846S/bu3Zv+8vd+7w2zMztO2H/3F9P6dGJtcIxiQmyJ8Yo2Sm9mwGhphdgEgp2hriMpK1o7XCqY1FMET8otVkpsERgtNfzN336eXmXJHSjWLX6jRBJJu4XHjsE5JRnF5IaUHUaVbAyGRFKhoBPWyEYQbfCS2b884eDhUTdHcT2SevK0pur7jnSXBZWSjfEUVwizfpGkCTtaxqRI0zYUOdOmjNIyPzNE/QxLB9b1I+/7yNtU9Um85jW16perO7l/6cZvecsbzhvMzH7f0trRdNtqNrdedy+7ti2ytjHu+Nh2hum0JuVOqmU0CmSzivEV1jtijKwfPYQtPJrGkA3GKTE5TK/H8jSQN8bElCnEoJI74bTcEoxBssFYQA1K6BbFTYvkSMChyW5u57ed1IvpYUzAWwUMpvI4MagmVDOuHBJSxJaeGAPeC6nN5KZi49gKQqDnI84WOF8x7G3HjRJ1MEzWGqTM5l5fxlOXwqnX/PUfXfKUSy/9OT3rrC+7HOxfxkTZMrf712dSz9w+GadDTZZrD9QcPnIf5EjtDUsrU9o2Mx5NCFmQpPhyQBOAFDdv/KJTR0oWK4acWmyIuCJx9jk7Ga8HNtbWyHhUZZNeMiRLgmyAiGbBMLNJ3Oy26jU7gsmYnNHcEe9FPVkcTh3qAhUFZnnCNHSITc7d6FSkoZybp1mdQqyxhUFcSdEbMmnWkTYxMBBNZJRGbDTQrrec+bRzWTHZ3nDfwTQ39K+67+b37JMzXnr1ZZddbPfu7a4ZdQ8+hZf9/ptfsW2w+Iyjh+5Jxwprm40DFL1ZVoIQ1w/hZjOxXqFtE00A5y3BOYxJWJNJCqburjUSA9LW3ea8CDFnnDWMxpHl6ZTVdSHFlpwT2E5b0RFI0aBiMc5hncXYiNKhz5GExERWj2iByS3JdLVcnVqsGFyRGfSFPDa0ucWMjxEmFckoYTSi15/D+kWaMMJWPaajEdYV9Bcqlg4t0V+bkCbrtDmz+4zHc/wpp7G+dFQ+mww7Dg9d+uz+31bV8/ft3av3u7VVVdm3bx8//p0/Plv2q3fLdGN4Zw4cGa3J+sH7WDpyiBhrkiptSMyefBJLxw52MitqIFpkUpObhjRpyWGMxiltaLEYMBlUSWLwTiirihAzbZ02JUw9BkE2xdnwHanSqYKJHfUtd3KqJkHGIZKwyXaClDGiMWOMYo0nth3SncThrcc6hzWC+AJJCVolN2Os0BHzp1PUKb7qkdoWipK4vEExU7H79NPJEVLdktvGLE1GaU+5cOJo7YbR8/7br34CcFdddVW2cKG79NLvSy98yfN/aXa45fkHwiQfjWLXlpc5unyQdjRlPNkA18n3LS2NkKZ7GEKN1oEUHSm2m2HCIGo6ORZjujpOMoaMc45BWXS39cQMRrBisFZRASee0nmcBVN0N6qJlU6fUxyIR5wg5K68IqCpJSbpxIiAEBMGi1pHTJuYo3H4HFAL3grOFVhrsDlgyh4SwIwm3W7MpKVfVWzdugWVgpSVaAuqfmItBGnGUftJnvUbv/uGfS952SuWVNXYj370j3XnztNON4PhH21sHDU33HnALC8dlUNH72Jj5Rjraxu0bUsmg6kgTChjJmoiZddtvzsoyXjjsBRYL4gZUBiD947KGqw4ysriXIkxttv6xuLLhC8MpS8pCoNzGSkspS1whaXwEV/28N5SFBbnC7xxFEYoLdheRVFU9IoCU5Y4oxg/pCiFwlqsMThPB7v5CucdpvRYW+CtwzqlcI7SCNYkegX0Zhfo+R6+nKe0CWsdtiiprJPWaja5LTfWDp/xnr//xDvOOOOGbm/219/+1r/aNtjxsiOHD6Y3/9Zr7WjSotbjY9OpOJr7XSpuavh30L4KnX5XzhiNkAuEuCnB4rGqYIQsCR8hitA5bepGBLmj2yUJmz+fuiVy0U4kzXQotVFFxcL9c2ERBItVpZGOuGmJpGw7TQiUhOCykK1BREk4fO5URKN4ULfZMtWb4hMVhWai7QyuJlGoRY0BM0GlQkxBkoavP/up8aInPNHtOmvxe5/3ba/+E/eOv/mrl4bWfmtTt7nXc/acs57J6uoyMdbEpqYOU8y0IWUlJ4+4iNUWckkmUhMQ7eFF0Wxw2m1RGZM7vrcESD2KKmGMIrGgtpbWtDjjqZBuL1A9agIeT5aM2KYTsBQh54gkELVEMTSasJpwRmiQbndOM5IzaixRIjb3kRRR8RhJZMqunjSZVhxZu00txaLZ4M2ULJ5opKMsG4PR1N32RqcKqmZKVKhczxw+upbDbRu/cuyeP/2wvPKVP3pExG2r67GmgEhM3bCoqWmbKaFZJ0wTOTe0ZEzMHSVEO4Wklu7OExcLsvGojinVUxjIOSDG4iThFQpf4NRhjDLVdcZ2llkU1UzOgnOZMkkX8EWwLuGxm8Ky067mFEuMBqM1SEHcPNkSS4wkgioTTfSTx5mWVnoUtAiOnD2WCa2UtDnTSqRMFlJJKVPCTIWvCowbUpaGojKbLXMmOUPQEise7yuM9bk37JkTTpLL5AXPf9aKjqZzbUy4tpFgFU0d3uaTIUrd1WIoQUByxKjQ0rEYnGa6rYped8PEZmWHWnyOtGJRHJ4p0TrKpLgErXRi+j1VGhWURKEtFotB8VG6D0AFcd3dLElNd7NGN4AlSSaLoVQlCjjT3XcQtQazKd6bM9kokju5lmQVo0pQjzMRQ4PVstMukUytRXefllVaSSCWpIIzDZlBJ1mIxxbrKnHA8Xtm7nUDCaPQr+ZNqDG2BIScum5ETUvOhqyKyaWqetRM6MUaQ0HMPYwGjSZSaMBmQ3QtVh2OhDqDB1wOJKkoVVHXUTcK9WAUsmipAU0Gpz0mvsVjKazHZcVLJMoA0YjHkGxB1ATicRrImjolJxEysZuPG6FQ0w3xgYaCqAYl4rJ2W1wZUkAaI2SpKbKgWQhmgpGISZYgCSGjFkybyWZCixBtw0xj1RBl6vO6g8mGZJ9tzJq0MtauC0QqLDlbRDxZQHMUS4vBIb7D5aqsZPGipsCnCV4sStXFEu2TLHjppJ1VdFO9VDrNwyzdgF0VjSVVqHHG4KxFEUy2WOnhmHab79mSjaUyXWKIGGycoZW2k2/RzYmeL3EIOZcYt6neJLa7TCICuU9i2mVxLXBa4GxDio7GGKo8IcksLYGSSKMWbxRRD6o4iV2xT0R8ZDyp73S2vPNlbVgYTNME0zhjbDC1OrEuiM2VkWyNN9bkojZFCAbft73cN1NRk31jCqmsmGBKcWYpRmOaNfG6YBpVUzIyZG+IatRsGOtmTI5jU5jStMYYScGoc8YSzIhktHCmEmNokmmoBDcxY0m2TMkYxYSYrekn22uzmUrfGjsyrYpBp9aqFeOjCUSjZNM4Z8jORKmNy41RZ4yzYppQGzWNaXNrrPaNQU0vNqZ2YowkU2aMkakkjFErRiXapNbg1BjB+GBt8BhvjKptS43jD//f4PbYItfBt/MAAAAASUVORK5CYII=";

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
// its face down by label length and grows DOWNWARD instead.
function GPlace({ x, y, pick, text }) {
  const len = (text || "").length;
  const fs = len > 40 ? 8 : len > 22 ? 9 : 11;
  return (
    <div style={{
      position: "absolute", left: x, top: y, width: BW, minHeight: BH * 2,
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      padding: "2px 3px", textAlign: "center", boxSizing: "border-box",
      background: "rgba(255,255,255,0.03)", border: `1px solid ${BR_LINE}`,
    }}>
      <div style={{ fontSize: fs, lineHeight: 1.15, fontWeight: 700, color: C.chalk }}>{text}</div>
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
  return (
    <div style={{
      position: "absolute", left: x, top: y, width: w, height: h, display: "flex",
      alignItems: "center", justifyContent: "center", textAlign: "center",
      border: src ? "none" : `1px dashed ${BR_LINE}`, borderRadius: 4,
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

const r3Won = (sa, sb) => parseFloat(sa) > parseFloat(sb);
const r3Winner = (g) => (r3Won(g[1], g[3]) ? g[0] : g[2]);
const r3Loser = (g) => (r3Won(g[1], g[3]) ? g[2] : g[0]);

// one game as two boxes at arbitrary positions
function r3Split(x1, y1, x2, y2, g) {
  const [a, sa, b, sb] = g;
  const aw = r3Won(sa, sb);
  return [[x1, y1, a, sa, aw ? 1 : 0], [x2, y2, b, sb, aw ? 0 : 1]];
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
      cols: WK_COLS_3, h: 258, paths: R3_PLACE_PATHS,
      slots: [[468, 172, 60, 34, "7-11", SEVEN_MARK]],
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
  "Denver": ["#7A1F2B", "#F0B323"], "Arizona": ["#E03A3E", "#0C234B"],
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
        [672, 19, "S Dakota", "266.00", 1], [672, 133, "Arizona", "165.75"],
        [784, 0, "S Dakota", "238.25", 1], [784, 38, "BYU", "223.70"],
        [784, 114, "Denver", "162.35"], [784, 152, "Arizona", "184.30", 1],
      ],
    },
    {
      cols: WK_COLS_3, h: 258, paths: R3_PLACE_PATHS,
      boxes: [
        [336, 38, "Cincinnati", "245.25", 1], [560, 38, "Arizona", "210.70"],
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

  // One reference panel for the whole tier, computed here and rendered in the
  // left column under the tier ladder. Only the ten 16-team leagues have a CP
  // table; the others show promotion eligibility alone, so the heading follows
  // whatever the box can actually show.
  const placementPanel = !bracket
    ? null
    : {
        rows: placementInfoRows(tier.size, tier.size === 16 ? tierKey : null),
        title: tier.size === 16 ? "Coaching Points" : "Promotion Eligibility",
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
