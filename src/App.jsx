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
  // 2025: { NFL: "...", USFL: "...", ... },
  // 2024: { ... },
  // 2023: { ... },
  // 2022: { ... },
};

const CURRENT_SEASON = 2026;
const NFL_LEAGUE_ID = LEAGUE_HISTORY[CURRENT_SEASON].NFL;

// Link to the Alliance's separate playoff-bracket spreadsheet (shared by all
// tiers for now). If per-league tab links are wanted later, add each tier's
// `#gid=...` fragment here instead of the bare sheet URL.
const PLAYOFF_BRACKET_URL =
  "https://docs.google.com/spreadsheets/d/1DatK9-R9w230r-DpPuFBCvMI0xhQaqn8mKj7DzQuOU8/edit?usp=sharing";
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

// Playoff format per tier, per the Rules doc. "top8": straight top-8 by
// record, no conferences. "conference-division": NFL-style, 4 division
// winners + 4 wildcards per conference. "division-only": same idea as
// conference-division but a single group (no conference split) — FLHS's 4
// districts. "conference-top4": top 4 teams from each of 2 conferences, no
// guaranteed division winners — Sun Belt/SoCo/Ivy/SWAC/GLIAC. "division-
// playin": USFL/XFL's unusual 10-team field — 4 division winners (seeds
// 1-4) get a bye, seeds 5-10 are wildcards, and a Week 14 play-in (7v10,
// 8v9 — one week earlier than every other tier's Week 15 start) trims it
// to 8 before the main bracket begins.
const PLAYOFF_FORMAT = {
  NFL: "conference-division",
  SEC: "top8", "BIG XII": "top8", ACC: "top8", TEN: "top8",
  FLHS: "division-only",
  SUN: "conference-top4", SOCO: "conference-top4", IVY: "conference-top4",
  SWAC: "conference-top4", GLIAC: "conference-top4",
  USFL: "division-playin", XFL: "division-playin",
};

// Standard fixed single-elimination bracket pairings.
// 8-seed: round 1 = (1v8, 4v5, 3v6, 2v7). 4-seed: round 1 = (1v4, 2v3).
const BRACKET_PAIRS_R1 = [[1, 8], [4, 5], [3, 6], [2, 7]];
const BRACKET_PAIRS_R1_4 = [[1, 4], [2, 3]];

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
const COACH_TROPHIES = {};

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

// Roster links from the Admin tab (column AB), keyed by team name. Empty
// until that export is provided — the popup just omits the link until then.
const ROSTER_LINKS = {};

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

function BracketBox({ x, y, entry, seed }) {
  const [broken, setBroken] = useState(false);
  const isPlaceholder = typeof entry === "string";
  const name = isPlaceholder ? entry : entry ? entry.team : "—";
  const avatar = !isPlaceholder && entry ? entry.avatar : null;
  const initial = (!isPlaceholder && entry ? entry.coach : name || "?").trim().charAt(0).toUpperCase() || "?";
  const label = name.length > 20 ? name.slice(0, 19) + "…" : name;

  return (
    <g>
      <rect x={x} y={y} width={BOX_W} height={BOX_H} rx="4" fill={C.panel} stroke={C.line} />
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
        fill={isPlaceholder ? C.slate : C.chalk}
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

// Simple left-to-right single-elimination tree: Round 1 -> (Semifinal) ->
// Final. Used for top8/conference-division sub-brackets and division-only.
function TreeBracket({ seeds }) {
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
        <BracketBox key={i} x={r2X} y={y} entry={size === 4 ? "Winner, Match " + (i * 2 + 1) : `Winner, Match ${i + 1}`} />
      ))}
      {size === 8 && <BracketBox x={r3X} y={r3Y} entry="Semifinal winner" />}
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
  const height = seventhY + BOX_H;

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
        <BracketBox x={centerX} y={seventhY} entry={labels[3]} />
      </svg>
      {fired && <p className="text-xs" style={{ color: C.ember }}>{labels[3]} loser is fired.</p>}
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
          <BracketBox key={label} x={centerX} y={crossY[i]} entry={label} />
        ))}
      </svg>
      <div className="flex justify-between text-xs uppercase mt-1" style={{ color: C.slate }}>
        <span>{eastName}</span>
        <span>{westName}</span>
      </div>
      {fired && <p className="text-xs mt-1" style={{ color: C.ember }}>{rankLabels[rankLabels.length - 1]} loser is fired.</p>}
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
    const id = leagueMap[tierKey];
    if (mode === "live" && id && !standingsCache[id]) {
      setTierLoading(true);
      loadLeague(id, nflState && nflState.week).finally(() => setTierLoading(false));
    }
  }, [tierKey, mode, leagueMap, standingsCache, loadLeague, nflState]);

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
    const id = leagueMap[tKey];
    const rows = id ? standingsCache[id] : null;
    if (!rows || !rows.length) return null;

    const sortByRecord = (arr) => [...arr].sort((a, b) => b.w - a.w || b.pts - a.pts);

    if (format === "top8") {
      const ranked = sortByRecord(rows.filter((r) => r.coach !== "—"));
      return {
        format,
        brackets: [
          { name: "Playoffs", seeds: ranked.slice(0, 8) },
          { name: "Consolation", seeds: ranked.slice(8, 16) },
        ],
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
        brackets: [
          { name: "Playoffs", seeds: [...winnersSeeded, ...wildcards] },
          { name: "Consolation", seeds: remaining.slice(4, 12) },
        ],
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
      const consolation = remaining.slice(6, 14);
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
  const leagueId = leagueMap[tierKey];
  const liveRows = leagueId ? standingsCache[leagueId] : null;
  const demoRows = tierKey === "NFL" ? DEMO_NFL.map((r) => ({ ...r, maxPts: null })) : null;
  const rows = mode === "live" ? liveRows : demoRows;
  const pairs = mode === "live" && leagueId ? matchupsCache[leagueId] : null;
  const bracket = mode === "live" ? computeBracket(tierKey) : null;

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
        const confRows = withDiv.filter((r) => nflConferenceFor(r.division) === confName);
        const byDiv = {};
        confRows.forEach((r) => (byDiv[r.division] = byDiv[r.division] || []).push(r));
        const divisions = Object.keys(byDiv)
          .sort((a, b) => a - b)
          .map((d) => ({ name: NFL_DIVISIONS[d] || `Division ${d}`, rows: byRecord(byDiv[d]) }));
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
      .map((d) => ({ name: names[d] || `Group ${d}`, rows: byRecord(byDiv[d]) }));
    return groups.length ? { type: "flat", groups } : null;
  };

  const standingsGroups = mode === "live" ? groupStandings(tierKey, rows) : null;
  const overallLastRosterId = rows && rows.length ? rows[rows.length - 1].rosterId : null;

  const renderStandingsRows = (tableRows) =>
    tableRows.map((r, i) => {
      const isLast = standingsGroups ? r.rosterId === overallLastRosterId : i >= tableRows.length - 1;
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
                      <span className="ml-auto flex items-center gap-1.5">
                        {conferenceStrength[t.key] && (
                          <span
                            className="text-xs"
                            style={{ fontFamily: "'IBM Plex Mono', monospace", color: active ? C.ink : C.gold }}
                            title="Conference Strength — higher means tougher competition relative to its comparison pool"
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
                Tier 1 pays the most coaching points. Finish last anywhere and you're fired. The number next to each tier is its
                Conference Strength score — positive means tougher than its comparison pool, negative means easier. NFL stands
                alone with nothing to compare against, so it isn't scored. Expect scores near zero until games are actually played.
              </div>
            </aside>

            <section className="flex-1 min-w-0">
              <div className="flex items-baseline justify-between mb-3 gap-2 flex-wrap">
                <h2 className="text-3xl uppercase leading-none" style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700 }}>
                  {tier.name}
                </h2>
                <div className="flex items-center gap-3">
                  <span className="text-xs uppercase tracking-widest" style={{ color: C.slate }}>Tier {tier.tier} of 13</span>
                  <a
                    href={PLAYOFF_BRACKET_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs uppercase tracking-wider"
                    style={{ color: C.gold }}
                  >
                    Playoff bracket ↗
                  </a>
                </div>
              </div>

              {conferenceStrength[tierKey] ? (
                <div className="mb-4 text-xs" style={{ color: C.slate }}>
                  Conference Strength:{" "}
                  <span style={{ color: C.gold, fontWeight: 600 }}>
                    {conferenceStrength[tierKey].score >= 0 ? "+" : ""}
                    {conferenceStrength[tierKey].score.toFixed(1)}
                  </span>{" "}
                  against its {conferenceStrength[tierKey].poolSize}-league comparison pool. Positive means this tier's currently
                  playing tougher; negative means easier. Expect it to sit near zero until real games are on the board.
                </div>
              ) : (
                tierKey === "NFL" && (
                  <div className="mb-4 text-xs" style={{ color: C.slate }}>
                    NFL is the only league in its tier — nothing to compare it against, so it doesn't get a Conference Strength
                    score.
                  </div>
                )
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

              {bracket && (
                <div className="mt-6">
                  <div className="text-xs uppercase tracking-widest mb-2" style={{ color: C.slate, letterSpacing: "0.2em" }}>
                    Playoff Bracket
                  </div>
                  <p className="text-xs mb-3" style={{ color: C.slate }}>
                    Based on final regular-season standings. Round-by-round results fill in as playoff weeks are played.
                  </p>

                  {bracket.format === "division-playin" ? (
                    <div className="space-y-4 overflow-x-auto">
                      {(() => {
                        const colGap = 60;
                        const playInX = 0;
                        const r8X = playInX + BOX_W + colGap;
                        const semiX = r8X + BOX_W + colGap;
                        const finalX = semiX + BOX_W + colGap;
                        const width = finalX + BOX_W;
                        const rowH = BOX_H + 8;
                        const groupGap = 46;
                        const r8Ys = [0, 2 * rowH + groupGap, 4 * rowH + 2 * groupGap, 6 * rowH + 3 * groupGap];
                        const r8Mids = r8Ys.map((y) => y + rowH / 2 + BOX_H / 2);
                        const semiYs = [(r8Mids[0] + r8Mids[1]) / 2 - BOX_H / 2, (r8Mids[2] + r8Mids[3]) / 2 - BOX_H / 2];
                        const finalY = (semiYs[0] + semiYs[1]) / 2;
                        const height = r8Ys[3] + rowH + BOX_H;
                        return (
                          <svg viewBox={`0 0 ${width} ${height}`} width="100%" style={{ minWidth: `${width * 0.75}px`, height: "auto" }}>
                            <Connector d={`M ${playInX + BOX_W} ${0 + BOX_H / 2} L ${playInX + BOX_W} ${rowH + BOX_H / 2}`} />
                            <Connector d={elbowPath(playInX + BOX_W, rowH / 2 + BOX_H / 2, r8X, r8Mids[0])} />
                            <Connector d={`M ${playInX + BOX_W} ${r8Ys[3] + BOX_H / 2} L ${playInX + BOX_W} ${r8Ys[3] + rowH + BOX_H / 2}`} />
                            <Connector d={elbowPath(playInX + BOX_W, r8Ys[3] + rowH / 2 + BOX_H / 2, r8X, r8Mids[3])} />
                            <BracketBox x={playInX} y={0} seed={7} entry={bracket.seeds[6]} />
                            <BracketBox x={playInX} y={rowH} seed={10} entry={bracket.seeds[9]} />
                            <BracketBox x={playInX} y={r8Ys[3]} seed={8} entry={bracket.seeds[7]} />
                            <BracketBox x={playInX} y={r8Ys[3] + rowH} seed={9} entry={bracket.seeds[8]} />

                            <Connector d={elbowPath(r8X + BOX_W, r8Mids[0], semiX, semiYs[0] + BOX_H / 2)} />
                            <Connector d={elbowPath(r8X + BOX_W, r8Mids[1], semiX, semiYs[0] + BOX_H / 2)} />
                            <Connector d={elbowPath(r8X + BOX_W, r8Mids[2], semiX, semiYs[1] + BOX_H / 2)} />
                            <Connector d={elbowPath(r8X + BOX_W, r8Mids[3], semiX, semiYs[1] + BOX_H / 2)} />
                            <BracketBox x={r8X} y={r8Ys[0]} seed={1} entry={bracket.seeds[0]} />
                            <BracketBox x={r8X} y={r8Ys[0] + rowH} entry="Winner, #8 vs #9" />
                            <BracketBox x={r8X} y={r8Ys[1]} seed={4} entry={bracket.seeds[3]} />
                            <BracketBox x={r8X} y={r8Ys[1] + rowH} seed={5} entry={bracket.seeds[4]} />
                            <BracketBox x={r8X} y={r8Ys[2]} seed={3} entry={bracket.seeds[2]} />
                            <BracketBox x={r8X} y={r8Ys[2] + rowH} seed={6} entry={bracket.seeds[5]} />
                            <BracketBox x={r8X} y={r8Ys[3]} seed={2} entry={bracket.seeds[1]} />
                            <BracketBox x={r8X} y={r8Ys[3] + rowH} entry="Winner, #7 vs #10" />

                            <Connector d={elbowPath(semiX + BOX_W, semiYs[0] + BOX_H / 2, finalX, finalY + BOX_H / 2)} />
                            <Connector d={elbowPath(semiX + BOX_W, semiYs[1] + BOX_H / 2, finalX, finalY + BOX_H / 2)} />
                            <BracketBox x={semiX} y={semiYs[0]} entry="Winner, Quarterfinal A" />
                            <BracketBox x={semiX} y={semiYs[1]} entry="Winner, Quarterfinal B" />
                            <BracketBox x={finalX} y={finalY} entry="League Champion" />
                          </svg>
                        );
                      })()}
                      <div className="flex gap-8 text-xs uppercase" style={{ color: C.slate }}>
                        <span>Play-In · Wk 14</span>
                        <span style={{ marginLeft: "5.5rem" }}>Round of 8 · Wk 15</span>
                      </div>
                      {bracket.consolation && bracket.consolation.length > 0 && (
                        <div>
                          <div className="text-sm font-semibold mb-2" style={{ color: C.gold }}>Consolation</div>
                          <div style={{ minWidth: "30rem" }}>
                            <TreeBracket seeds={bracket.consolation} />
                          </div>
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
                  ) : (
                    <div className={`grid gap-6 ${bracket.brackets.length > 1 ? "sm:grid-cols-2" : ""}`}>
                      {bracket.brackets.map((b) => (
                        <div key={b.name} className="overflow-x-auto">
                          <div className="text-sm font-semibold mb-2" style={{ color: C.gold }}>{b.name}</div>
                          <div style={{ minWidth: b.seeds.length <= 4 ? "20rem" : "30rem" }}>
                            <TreeBracket seeds={b.seeds} />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
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
