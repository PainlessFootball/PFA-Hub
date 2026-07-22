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

// Career stats from the Admin tab (columns AM:BA) — empty until that export
// is provided. Keyed by coach name (lowercased) once populated, e.g.:
//   "harvey28": { careerCP: 1020.78, careerW: 50, careerL: 18, titles: 1, ... }
// The Coach Profile popup below checks this and shows a "pending" note for
// any coach not yet in here, rather than guessing at numbers.
const CAREER_STATS = {
  "aziv49": { "Career CP": "1020.78", "Career Avg CP": "255.20", "Record": "50-18", "Win %": "73.5%", "Total Points": "13423.10", "Avg Pts / Season": "192.17", "Alliance High Score": "2", "Alliance Low Score": "0", "League High Score": "1", "League Low Score": "0", "Best Manager": "3", "Conference Wins": "3", "Division Wins": "3", "Playoff Wins": "5" },
  "ahdi": { "Career CP": "149.10", "Career Avg CP": "37.28", "Record": "8-9", "Win %": "47.1%", "Total Points": "3803.75", "Avg Pts / Season": "105.66", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "0", "League Low Score": "0", "Best Manager": "0", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" },
  "alexwilson20": { "Career CP": "279.00", "Career Avg CP": "69.75", "Record": "22-29", "Win %": "43.1%", "Total Points": "10235.60", "Avg Pts / Season": "193.38", "Alliance High Score": "0", "Alliance Low Score": "21", "League High Score": "16", "League Low Score": "21", "Best Manager": "-2", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" },
  "alphaone": { "Career CP": "39.89", "Career Avg CP": "19.95", "Record": "5-12", "Win %": "29.4%", "Total Points": "2620.15", "Avg Pts / Season": "72.78", "Alliance High Score": "0", "Alliance Low Score": "2", "League High Score": "0", "League Low Score": "2", "Best Manager": "1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" },
  "arvot": { "Career CP": "77.86", "Career Avg CP": "19.46", "Record": "8-9", "Win %": "47.1%", "Total Points": "3565.25", "Avg Pts / Season": "99.03", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "0", "League Low Score": "0", "Best Manager": "-1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" },
  "asqxct": { "Career CP": "642.53", "Career Avg CP": "160.63", "Record": "35-33", "Win %": "51.5%", "Total Points": "13116.35", "Avg Pts / Season": "187.12", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "3", "League Low Score": "0", "Best Manager": "1", "Conference Wins": "2", "Division Wins": "2", "Playoff Wins": "1" },
  "aziv49 int": { "Career CP": "325.79", "Career Avg CP": "81.45", "Record": "18-16", "Win %": "52.9%", "Total Points": "7562.85", "Avg Pts / Season": "216.50", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "4", "League Low Score": "0", "Best Manager": "0", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" },
  "bblew52": { "Career CP": "681.30", "Career Avg CP": "170.32", "Record": "33-35", "Win %": "48.5%", "Total Points": "14132.75", "Avg Pts / Season": "201.86", "Alliance High Score": "1", "Alliance Low Score": "0", "League High Score": "1", "League Low Score": "0", "Best Manager": "10", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "2" },
  "bjf35": { "Career CP": "414.36", "Career Avg CP": "103.59", "Record": "27-41", "Win %": "39.7%", "Total Points": "11744.95", "Avg Pts / Season": "168.15", "Alliance High Score": "0", "Alliance Low Score": "1", "League High Score": "1", "League Low Score": "1", "Best Manager": "-3", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" },
  "bbclives": { "Career CP": "422.28", "Career Avg CP": "105.57", "Record": "28-40", "Win %": "41.2%", "Total Points": "13260.65", "Avg Pts / Season": "189.77", "Alliance High Score": "0", "Alliance Low Score": "4", "League High Score": "0", "League Low Score": "4", "Best Manager": "1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" },
  "benchedballers": { "Career CP": "809.54", "Career Avg CP": "202.38", "Record": "43-25", "Win %": "63.2%", "Total Points": "12852.80", "Avg Pts / Season": "184.22", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "3", "League Low Score": "0", "Best Manager": "1", "Conference Wins": "1", "Division Wins": "1", "Playoff Wins": "4" },
  "biggypoppa": { "Career CP": "412.25", "Career Avg CP": "103.06", "Record": "27-41", "Win %": "39.7%", "Total Points": "13090.10", "Avg Pts / Season": "187.31", "Alliance High Score": "0", "Alliance Low Score": "6", "League High Score": "0", "League Low Score": "6", "Best Manager": "0", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" },
  "bigpapajohn1311": { "Career CP": "211.62", "Career Avg CP": "52.90", "Record": "16-18", "Win %": "47.1%", "Total Points": "6988.05", "Avg Pts / Season": "199.69", "Alliance High Score": "0", "Alliance Low Score": "2", "League High Score": "2", "League Low Score": "2", "Best Manager": "-2", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "1" },
  "booyamclovin": { "Career CP": "485.40", "Career Avg CP": "121.35", "Record": "30-38", "Win %": "44.1%", "Total Points": "13960.75", "Avg Pts / Season": "199.57", "Alliance High Score": "0", "Alliance Low Score": "3", "League High Score": "1", "League Low Score": "3", "Best Manager": "3", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "1" },
  "broncozzz": { "Career CP": "447.59", "Career Avg CP": "111.90", "Record": "27-41", "Win %": "39.7%", "Total Points": "13170.75", "Avg Pts / Season": "188.13", "Alliance High Score": "0", "Alliance Low Score": "2", "League High Score": "1", "League Low Score": "2", "Best Manager": "-4", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" },
  "butterfield": { "Career CP": "255.77", "Career Avg CP": "63.94", "Record": "19-15", "Win %": "55.9%", "Total Points": "6946.45", "Avg Pts / Season": "198.26", "Alliance High Score": "0", "Alliance Low Score": "1", "League High Score": "2", "League Low Score": "1", "Best Manager": "0", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "1" },
  "chorn16": { "Career CP": "208.56", "Career Avg CP": "52.14", "Record": "18-16", "Win %": "52.9%", "Total Points": "6932.60", "Avg Pts / Season": "198.43", "Alliance High Score": "0", "Alliance Low Score": "3", "League High Score": "0", "League Low Score": "3", "Best Manager": "-2", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" },
  "calvins22": { "Career CP": "869.74", "Career Avg CP": "217.44", "Record": "41-27", "Win %": "60.3%", "Total Points": "12775.20", "Avg Pts / Season": "183.12", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "4", "League Low Score": "0", "Best Manager": "0", "Conference Wins": "0", "Division Wins": "1", "Playoff Wins": "0" },
  "casualconsensus int": { "Career CP": "92.24", "Career Avg CP": "23.06", "Record": "15-19", "Win %": "44.1%", "Total Points": "6386.05", "Avg Pts / Season": "182.85", "Alliance High Score": "0", "Alliance Low Score": "4", "League High Score": "1", "League Low Score": "4", "Best Manager": "-7", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" },
  "chivoski": { "Career CP": "237.72", "Career Avg CP": "59.43", "Record": "19-32", "Win %": "37.3%", "Total Points": "8812.35", "Avg Pts / Season": "170.01", "Alliance High Score": "0", "Alliance Low Score": "21", "League High Score": "17", "League Low Score": "21", "Best Manager": "-7", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" },
  "chrisevans": { "Career CP": "385.16", "Career Avg CP": "96.29", "Record": "28-40", "Win %": "41.2%", "Total Points": "13834.20", "Avg Pts / Season": "197.92", "Alliance High Score": "0", "Alliance Low Score": "2", "League High Score": "1", "League Low Score": "2", "Best Manager": "-2", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" },
  "chuckiv": { "Career CP": "821.05", "Career Avg CP": "205.26", "Record": "39-29", "Win %": "57.4%", "Total Points": "11403.20", "Avg Pts / Season": "162.95", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "0", "League Low Score": "0", "Best Manager": "3", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "3" },
  "coopdaddy510": { "Career CP": "546.90", "Career Avg CP": "136.73", "Record": "31-20", "Win %": "60.8%", "Total Points": "10839.05", "Avg Pts / Season": "204.62", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "1", "League Low Score": "0", "Best Manager": "1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "4" },
  "curlyz28": { "Career CP": "782.99", "Career Avg CP": "195.75", "Record": "37-31", "Win %": "54.4%", "Total Points": "13709.05", "Avg Pts / Season": "195.90", "Alliance High Score": "0", "Alliance Low Score": "2", "League High Score": "1", "League Low Score": "2", "Best Manager": "-2", "Conference Wins": "1", "Division Wins": "1", "Playoff Wins": "2" },
  "dbgiants": { "Career CP": "188.03", "Career Avg CP": "47.01", "Record": "22-29", "Win %": "43.1%", "Total Points": "9395.45", "Avg Pts / Season": "177.76", "Alliance High Score": "0", "Alliance Low Score": "5", "League High Score": "0", "League Low Score": "5", "Best Manager": "-1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" },
  "djmooremvp": { "Career CP": "257.08", "Career Avg CP": "64.27", "Record": "19-32", "Win %": "37.3%", "Total Points": "9621.60", "Avg Pts / Season": "181.42", "Alliance High Score": "0", "Alliance Low Score": "8", "League High Score": "1", "League Low Score": "8", "Best Manager": "5", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "1" },
  "dleggett": { "Career CP": "576.83", "Career Avg CP": "144.21", "Record": "36-32", "Win %": "52.9%", "Total Points": "13445.55", "Avg Pts / Season": "192.40", "Alliance High Score": "0", "Alliance Low Score": "1", "League High Score": "3", "League Low Score": "1", "Best Manager": "5", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "2" },
  "dabouse": { "Career CP": "92.71", "Career Avg CP": "23.18", "Record": "7-10", "Win %": "41.2%", "Total Points": "3200.40", "Avg Pts / Season": "88.90", "Alliance High Score": "0", "Alliance Low Score": "4", "League High Score": "0", "League Low Score": "4", "Best Manager": "-1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" },
  "daniel7696": { "Career CP": "240.45", "Career Avg CP": "60.11", "Record": "22-34", "Win %": "39.3%", "Total Points": "12329.00", "Avg Pts / Season": "176.55", "Alliance High Score": "1", "Alliance Low Score": "28", "League High Score": "17", "League Low Score": "28", "Best Manager": "-5", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" },
  "diego777": { "Career CP": "847.38", "Career Avg CP": "211.85", "Record": "44-24", "Win %": "64.7%", "Total Points": "13959.70", "Avg Pts / Season": "200.01", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "2", "League Low Score": "0", "Best Manager": "0", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "4" },
  "dilly314": { "Career CP": "699.04", "Career Avg CP": "174.76", "Record": "40-28", "Win %": "58.8%", "Total Points": "14803.20", "Avg Pts / Season": "211.76", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "5", "League Low Score": "0", "Best Manager": "8", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "3" },
  "dirtybyrd30": { "Career CP": "811.22", "Career Avg CP": "202.80", "Record": "50-18", "Win %": "73.5%", "Total Points": "16752.30", "Avg Pts / Season": "239.39", "Alliance High Score": "2", "Alliance Low Score": "1", "League High Score": "12", "League Low Score": "1", "Best Manager": "2", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "4" },
  "donotatme": { "Career CP": "676.00", "Career Avg CP": "169.00", "Record": "32-35", "Win %": "47.8%", "Total Points": "10946.25", "Avg Pts / Season": "156.18", "Alliance High Score": "0", "Alliance Low Score": "4", "League High Score": "0", "League Low Score": "4", "Best Manager": "-3", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "2" },
  "doryb88": { "Career CP": "470.48", "Career Avg CP": "117.62", "Record": "28-40", "Win %": "41.2%", "Total Points": "12548.44", "Avg Pts / Season": "179.62", "Alliance High Score": "0", "Alliance Low Score": "6", "League High Score": "1", "League Low Score": "6", "Best Manager": "0", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "1" },
  "drewm1603": { "Career CP": "901.62", "Career Avg CP": "225.40", "Record": "41-27", "Win %": "60.3%", "Total Points": "11384.30", "Avg Pts / Season": "162.67", "Alliance High Score": "0", "Alliance Low Score": "1", "League High Score": "4", "League Low Score": "1", "Best Manager": "-1", "Conference Wins": "2", "Division Wins": "0", "Playoff Wins": "4" },
  "drewm1603 int": { "Career CP": "144.94", "Career Avg CP": "36.23", "Record": "11-6", "Win %": "64.7%", "Total Points": "3484.30", "Avg Pts / Season": "96.79", "Alliance High Score": "0", "Alliance Low Score": "1", "League High Score": "2", "League Low Score": "1", "Best Manager": "0", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" },
  "drunkfootball": { "Career CP": "663.84", "Career Avg CP": "165.96", "Record": "36-32", "Win %": "52.9%", "Total Points": "14435.40", "Avg Pts / Season": "206.12", "Alliance High Score": "1", "Alliance Low Score": "1", "League High Score": "7", "League Low Score": "1", "Best Manager": "-3", "Conference Wins": "1", "Division Wins": "1", "Playoff Wins": "4" },
  "dylan3380": { "Career CP": "654.12", "Career Avg CP": "163.53", "Record": "40-28", "Win %": "58.8%", "Total Points": "14854.10", "Avg Pts / Season": "212.56", "Alliance High Score": "1", "Alliance Low Score": "2", "League High Score": "6", "League Low Score": "2", "Best Manager": "-3", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "3" },
  "edinburghfins": { "Career CP": "126.43", "Career Avg CP": "31.61", "Record": "18-16", "Win %": "52.9%", "Total Points": "7323.80", "Avg Pts / Season": "209.87", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "1", "League Low Score": "0", "Best Manager": "2", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" },
  "edixon2": { "Career CP": "257.50", "Career Avg CP": "64.38", "Record": "15-19", "Win %": "44.1%", "Total Points": "7150.74", "Avg Pts / Season": "204.60", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "2", "League Low Score": "0", "Best Manager": "2", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "1" },
  "edixon2 l": { "Career CP": "257.50", "Career Avg CP": "64.38", "Record": "15-19", "Win %": "44.1%", "Total Points": "7150.74", "Avg Pts / Season": "204.60", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "2", "League Low Score": "0", "Best Manager": "2", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "1" },
  "fecato": { "Career CP": "421.76", "Career Avg CP": "105.44", "Record": "27-41", "Win %": "39.7%", "Total Points": "13097.90", "Avg Pts / Season": "196.07", "Alliance High Score": "0", "Alliance Low Score": "4", "League High Score": "1", "League Low Score": "4", "Best Manager": "2", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "2" },
  "fin3": { "Career CP": "829.08", "Career Avg CP": "207.27", "Record": "44-24", "Win %": "64.7%", "Total Points": "14349.70", "Avg Pts / Season": "205.20", "Alliance High Score": "0", "Alliance Low Score": "1", "League High Score": "5", "League Low Score": "1", "Best Manager": "8", "Conference Wins": "0", "Division Wins": "1", "Playoff Wins": "1" },
  "firephool": { "Career CP": "611.91", "Career Avg CP": "152.98", "Record": "32-36", "Win %": "47.1%", "Total Points": "13655.50", "Avg Pts / Season": "195.32", "Alliance High Score": "15", "Alliance Low Score": "4", "League High Score": "3", "League Low Score": "4", "Best Manager": "2", "Conference Wins": "1", "Division Wins": "0", "Playoff Wins": "5" },
  "foggybuckets": { "Career CP": "930.99", "Career Avg CP": "232.75", "Record": "49-19", "Win %": "72.1%", "Total Points": "13614.70", "Avg Pts / Season": "194.61", "Alliance High Score": "2", "Alliance Low Score": "0", "League High Score": "9", "League Low Score": "0", "Best Manager": "4", "Conference Wins": "2", "Division Wins": "1", "Playoff Wins": "5" },
  "folta21": { "Career CP": "251.95", "Career Avg CP": "62.99", "Record": "19-15", "Win %": "55.9%", "Total Points": "6859.65", "Avg Pts / Season": "196.55", "Alliance High Score": "0", "Alliance Low Score": "1", "League High Score": "1", "League Low Score": "1", "Best Manager": "-3", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" },
  "folta21 int": { "Career CP": "174.86", "Career Avg CP": "43.72", "Record": "11-6", "Win %": "64.7%", "Total Points": "3748.95", "Avg Pts / Season": "104.14", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "1", "League Low Score": "0", "Best Manager": "0", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" },
  "garrettbff": { "Career CP": "434.65", "Career Avg CP": "108.66", "Record": "31-37", "Win %": "45.6%", "Total Points": "12664.95", "Avg Pts / Season": "181.35", "Alliance High Score": "0", "Alliance Low Score": "12", "League High Score": "1", "League Low Score": "12", "Best Manager": "0", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" },
  "garrettbff int": { "Career CP": "434.65", "Career Avg CP": "108.66", "Record": "31-37", "Win %": "45.6%", "Total Points": "12664.95", "Avg Pts / Season": "181.35", "Alliance High Score": "0", "Alliance Low Score": "12", "League High Score": "1", "League Low Score": "12", "Best Manager": "0", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" },
  "germybeast": { "Career CP": "780.91", "Career Avg CP": "195.23", "Record": "39-29", "Win %": "57.4%", "Total Points": "13965.05", "Avg Pts / Season": "199.86", "Alliance High Score": "0", "Alliance Low Score": "17", "League High Score": "20", "League Low Score": "17", "Best Manager": "6", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "1" },
  "greek11 l": { "Career CP": "152.13", "Career Avg CP": "38.03", "Record": "16-18", "Win %": "47.1%", "Total Points": "6565.40", "Avg Pts / Season": "187.76", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "0", "League Low Score": "0", "Best Manager": "-4", "Conference Wins": "1", "Division Wins": "0", "Playoff Wins": "0" },
  "harold2576": { "Career CP": "532.67", "Career Avg CP": "133.17", "Record": "37-14", "Win %": "72.5%", "Total Points": "11581.30", "Avg Pts / Season": "218.69", "Alliance High Score": "0", "Alliance Low Score": "1", "League High Score": "12", "League Low Score": "1", "Best Manager": "3", "Conference Wins": "1", "Division Wins": "0", "Playoff Wins": "3" },
  "harvey28": { "Career CP": "811.43", "Career Avg CP": "202.86", "Record": "44-24", "Win %": "64.7%", "Total Points": "12632.05", "Avg Pts / Season": "181.75", "Alliance High Score": "0", "Alliance Low Score": "8", "League High Score": "3", "League Low Score": "8", "Best Manager": "2", "Conference Wins": "2", "Division Wins": "1", "Playoff Wins": "9" },
  "jjbinc int": { "Career CP": "182.33", "Career Avg CP": "45.58", "Record": "16-18", "Win %": "47.1%", "Total Points": "6624.60", "Avg Pts / Season": "189.62", "Alliance High Score": "1", "Alliance Low Score": "6", "League High Score": "2", "League Low Score": "6", "Best Manager": "-2", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" },
  "jvl007": { "Career CP": "491.79", "Career Avg CP": "122.95", "Record": "34-34", "Win %": "50.0%", "Total Points": "13980.55", "Avg Pts / Season": "200.03", "Alliance High Score": "0", "Alliance Low Score": "5", "League High Score": "2", "League Low Score": "5", "Best Manager": "-6", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "3" },
  "jwilmot": { "Career CP": "719.22", "Career Avg CP": "179.80", "Record": "36-32", "Win %": "52.9%", "Total Points": "11108.70", "Avg Pts / Season": "158.88", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "1", "League Low Score": "0", "Best Manager": "2", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" },
  "jaquise": { "Career CP": "566.33", "Career Avg CP": "141.58", "Record": "40-28", "Win %": "58.8%", "Total Points": "15087.00", "Avg Pts / Season": "215.64", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "8", "League Low Score": "0", "Best Manager": "4", "Conference Wins": "1", "Division Wins": "1", "Playoff Wins": "0" },
  "johnjohn882": { "Career CP": "430.91", "Career Avg CP": "107.73", "Record": "28-40", "Win %": "41.2%", "Total Points": "12651.30", "Avg Pts / Season": "180.73", "Alliance High Score": "0", "Alliance Low Score": "10", "League High Score": "3", "League Low Score": "10", "Best Manager": "-7", "Conference Wins": "1", "Division Wins": "1", "Playoff Wins": "0" },
  "johnzy4": { "Career CP": "161.77", "Career Avg CP": "40.44", "Record": "21-30", "Win %": "41.2%", "Total Points": "9942.35", "Avg Pts / Season": "188.53", "Alliance High Score": "1", "Alliance Low Score": "1", "League High Score": "6", "League Low Score": "6", "Best Manager": "-13", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "1" },
  "jorgeortiz11": { "Career CP": "274.90", "Career Avg CP": "68.73", "Record": "18-16", "Win %": "52.9%", "Total Points": "7336.45", "Avg Pts / Season": "209.77", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "4", "League Low Score": "0", "Best Manager": "0", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "3" },
  "josssock": { "Career CP": "962.18", "Career Avg CP": "240.55", "Record": "47-21", "Win %": "69.1%", "Total Points": "12802.65", "Avg Pts / Season": "182.78", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "9", "League Low Score": "0", "Best Manager": "-1", "Conference Wins": "0", "Division Wins": "2", "Playoff Wins": "5" },
  "juugking": { "Career CP": "800.43", "Career Avg CP": "200.11", "Record": "44-24", "Win %": "64.7%", "Total Points": "15379.80", "Avg Pts / Season": "219.60", "Alliance High Score": "1", "Alliance Low Score": "1", "League High Score": "11", "League Low Score": "1", "Best Manager": "4", "Conference Wins": "1", "Division Wins": "0", "Playoff Wins": "4" },
  "jweadon": { "Career CP": "447.91", "Career Avg CP": "111.98", "Record": "30-38", "Win %": "44.1%", "Total Points": "13377.80", "Avg Pts / Season": "191.43", "Alliance High Score": "0", "Alliance Low Score": "9", "League High Score": "5", "League Low Score": "9", "Best Manager": "0", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "1" },
  "kshooter15": { "Career CP": "491.89", "Career Avg CP": "122.97", "Record": "37-31", "Win %": "54.4%", "Total Points": "14133.70", "Avg Pts / Season": "210.81", "Alliance High Score": "1", "Alliance Low Score": "0", "League High Score": "3", "League Low Score": "0", "Best Manager": "2", "Conference Wins": "1", "Division Wins": "1", "Playoff Wins": "0" },
  "kendoll92": { "Career CP": "800.43", "Career Avg CP": "200.11", "Record": "44-24", "Win %": "64.7%", "Total Points": "15379.80", "Avg Pts / Season": "219.60", "Alliance High Score": "1", "Alliance Low Score": "1", "League High Score": "11", "League Low Score": "1", "Best Manager": "4", "Conference Wins": "1", "Division Wins": "0", "Playoff Wins": "4" },
  "kisser22": { "Career CP": "13.85", "Career Avg CP": "3.46", "Record": "4-13", "Win %": "23.5%", "Total Points": "2837.10", "Avg Pts / Season": "78.81", "Alliance High Score": "0", "Alliance Low Score": "3", "League High Score": "0", "League Low Score": "3", "Best Manager": "-5", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" },
  "klowntown": { "Career CP": "338.43", "Career Avg CP": "84.61", "Record": "30-38", "Win %": "44.1%", "Total Points": "12579.00", "Avg Pts / Season": "180.00", "Alliance High Score": "0", "Alliance Low Score": "4", "League High Score": "0", "League Low Score": "4", "Best Manager": "0", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "1" },
  "landlords": { "Career CP": "672.50", "Career Avg CP": "168.12", "Record": "36-32", "Win %": "52.9%", "Total Points": "13368.90", "Avg Pts / Season": "191.21", "Alliance High Score": "0", "Alliance Low Score": "1", "League High Score": "2", "League Low Score": "1", "Best Manager": "-1", "Conference Wins": "1", "Division Wins": "1", "Playoff Wins": "1" },
  "landshark18": { "Career CP": "893.38", "Career Avg CP": "223.34", "Record": "37-28", "Win %": "56.9%", "Total Points": "11712.80", "Avg Pts / Season": "167.17", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "5", "League Low Score": "0", "Best Manager": "5", "Conference Wins": "1", "Division Wins": "3", "Playoff Wins": "3" },
  "lightning77": { "Career CP": "335.57", "Career Avg CP": "83.89", "Record": "24-44", "Win %": "35.3%", "Total Points": "9651.50", "Avg Pts / Season": "137.58", "Alliance High Score": "0", "Alliance Low Score": "3", "League High Score": "0", "League Low Score": "3", "Best Manager": "1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" },
  "mbulls": { "Career CP": "317.37", "Career Avg CP": "79.34", "Record": "29-39", "Win %": "42.6%", "Total Points": "13149.40", "Avg Pts / Season": "188.12", "Alliance High Score": "0", "Alliance Low Score": "8", "League High Score": "0", "League Low Score": "8", "Best Manager": "-1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "3" },
  "mvpmalik2": { "Career CP": "301.86", "Career Avg CP": "75.47", "Record": "27-41", "Win %": "39.7%", "Total Points": "11895.55", "Avg Pts / Season": "179.30", "Alliance High Score": "1", "Alliance Low Score": "0", "League High Score": "2", "League Low Score": "0", "Best Manager": "-4", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "3" },
  "mambasdisciples": { "Career CP": "622.60", "Career Avg CP": "155.65", "Record": "44-24", "Win %": "64.7%", "Total Points": "15924.90", "Avg Pts / Season": "227.26", "Alliance High Score": "1", "Alliance Low Score": "0", "League High Score": "7", "League Low Score": "0", "Best Manager": "-4", "Conference Wins": "1", "Division Wins": "1", "Playoff Wins": "4" },
  "michaeltomlin": { "Career CP": "531.25", "Career Avg CP": "132.81", "Record": "29-22", "Win %": "56.9%", "Total Points": "10616.75", "Avg Pts / Season": "200.65", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "3", "League Low Score": "0", "Best Manager": "12", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "1" },
  "mintystoob": { "Career CP": "183.90", "Career Avg CP": "45.98", "Record": "13-21", "Win %": "38.2%", "Total Points": "6959.10", "Avg Pts / Season": "198.62", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "3", "League Low Score": "0", "Best Manager": "1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" },
  "motty": { "Career CP": "673.49", "Career Avg CP": "168.37", "Record": "39-29", "Win %": "57.4%", "Total Points": "13426.55", "Avg Pts / Season": "192.28", "Alliance High Score": "0", "Alliance Low Score": "3", "League High Score": "3", "League Low Score": "3", "Best Manager": "2", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "2" },
  "mrcoolbuns": { "Career CP": "775.06", "Career Avg CP": "193.76", "Record": "41-27", "Win %": "60.3%", "Total Points": "14470.20", "Avg Pts / Season": "215.22", "Alliance High Score": "1", "Alliance Low Score": "0", "League High Score": "13", "League Low Score": "0", "Best Manager": "0", "Conference Wins": "1", "Division Wins": "1", "Playoff Wins": "4" },
  "mrhawke19": { "Career CP": "758.73", "Career Avg CP": "189.68", "Record": "34-34", "Win %": "50.0%", "Total Points": "13750.85", "Avg Pts / Season": "196.80", "Alliance High Score": "0", "Alliance Low Score": "3", "League High Score": "1", "League Low Score": "3", "Best Manager": "4", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "1" },
  "newkbomb": { "Career CP": "847.02", "Career Avg CP": "211.75", "Record": "46-22", "Win %": "67.6%", "Total Points": "14940.95", "Avg Pts / Season": "213.91", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "1", "League Low Score": "0", "Best Manager": "-1", "Conference Wins": "0", "Division Wins": "1", "Playoff Wins": "2" },
  "noga2003": { "Career CP": "808.16", "Career Avg CP": "202.04", "Record": "38-30", "Win %": "55.9%", "Total Points": "14066.20", "Avg Pts / Season": "201.34", "Alliance High Score": "1", "Alliance Low Score": "0", "League High Score": "4", "League Low Score": "0", "Best Manager": "3", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "4" },
  "olavegarden18": { "Career CP": "778.90", "Career Avg CP": "194.73", "Record": "37-31", "Win %": "54.4%", "Total Points": "11324.50", "Avg Pts / Season": "162.01", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "1", "League Low Score": "0", "Best Manager": "4", "Conference Wins": "1", "Division Wins": "0", "Playoff Wins": "2" },
  "oschmini": { "Career CP": "625.84", "Career Avg CP": "156.46", "Record": "33-35", "Win %": "48.5%", "Total Points": "10302.05", "Avg Pts / Season": "147.04", "Alliance High Score": "0", "Alliance Low Score": "2", "League High Score": "0", "League Low Score": "2", "Best Manager": "-2", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" },
  "papared": { "Career CP": "285.23", "Career Avg CP": "71.31", "Record": "26-42", "Win %": "38.2%", "Total Points": "12972.35", "Avg Pts / Season": "185.33", "Alliance High Score": "0", "Alliance Low Score": "7", "League High Score": "3", "League Low Score": "7", "Best Manager": "-2", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" },
  "pigskinftw": { "Career CP": "416.12", "Career Avg CP": "104.03", "Record": "26-25", "Win %": "51.0%", "Total Points": "10167.60", "Avg Pts / Season": "191.84", "Alliance High Score": "0", "Alliance Low Score": "3", "League High Score": "3", "League Low Score": "3", "Best Manager": "6", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" },
  "proctordoctor": { "Career CP": "291.63", "Career Avg CP": "72.91", "Record": "20-31", "Win %": "39.2%", "Total Points": "9475.75", "Avg Pts / Season": "178.84", "Alliance High Score": "0", "Alliance Low Score": "6", "League High Score": "0", "League Low Score": "6", "Best Manager": "-7", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" },
  "pwnranger l4": { "Career CP": "409.93", "Career Avg CP": "102.48", "Record": "21-13", "Win %": "61.8%", "Total Points": "7733.25", "Avg Pts / Season": "221.20", "Alliance High Score": "1", "Alliance Low Score": "0", "League High Score": "3", "League Low Score": "0", "Best Manager": "4", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "2" },
  "pwnranger l5": { "Career CP": "302.75", "Career Avg CP": "75.69", "Record": "20-14", "Win %": "58.8%", "Total Points": "7109.60", "Avg Pts / Season": "203.20", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "3", "League Low Score": "0", "Best Manager": "2", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" },
  "pwnrangr": { "Career CP": "675.00", "Career Avg CP": "168.75", "Record": "37-31", "Win %": "54.4%", "Total Points": "11964.85", "Avg Pts / Season": "171.33", "Alliance High Score": "0", "Alliance Low Score": "1", "League High Score": "0", "League Low Score": "1", "Best Manager": "1", "Conference Wins": "0", "Division Wins": "2", "Playoff Wins": "1" },
  "pwnrangr l2": { "Career CP": "650.44", "Career Avg CP": "162.61", "Record": "36-32", "Win %": "52.9%", "Total Points": "12855.10", "Avg Pts / Season": "184.04", "Alliance High Score": "0", "Alliance Low Score": "1", "League High Score": "0", "League Low Score": "1", "Best Manager": "1", "Conference Wins": "1", "Division Wins": "1", "Playoff Wins": "0" },
  "pwnrangr l3": { "Career CP": "605.08", "Career Avg CP": "151.27", "Record": "33-18", "Win %": "64.7%", "Total Points": "11449.15", "Avg Pts / Season": "216.01", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "3", "League Low Score": "0", "Best Manager": "-1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "3" },
  "pwnrangr l5": { "Career CP": "217.06", "Career Avg CP": "54.27", "Record": "20-31", "Win %": "39.2%", "Total Points": "9144.95", "Avg Pts / Season": "172.37", "Alliance High Score": "0", "Alliance Low Score": "7", "League High Score": "0", "League Low Score": "7", "Best Manager": "-4", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" },
  "pwnrangr l6": { "Career CP": "60.54", "Career Avg CP": "15.13", "Record": "7-10", "Win %": "41.2%", "Total Points": "3625.95", "Avg Pts / Season": "100.72", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "1", "League Low Score": "0", "Best Manager": "-2", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" },
  "pwnrangr int3": { "Career CP": "523.45", "Career Avg CP": "130.86", "Record": "36-32", "Win %": "52.9%", "Total Points": "13543.85", "Avg Pts / Season": "194.04", "Alliance High Score": "1", "Alliance Low Score": "5", "League High Score": "2", "League Low Score": "5", "Best Manager": "-9", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "3" },
  "pwnrangr int7": { "Career CP": "56.05", "Career Avg CP": "14.01", "Record": "8-26", "Win %": "23.5%", "Total Points": "5601.74", "Avg Pts / Season": "160.08", "Alliance High Score": "0", "Alliance Low Score": "8", "League High Score": "0", "League Low Score": "8", "Best Manager": "2", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" },
  "quincidental": { "Career CP": "381.14", "Career Avg CP": "95.28", "Record": "25-26", "Win %": "49.0%", "Total Points": "10784.75", "Avg Pts / Season": "203.84", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "2", "League Low Score": "0", "Best Manager": "8", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" },
  "recki20": { "Career CP": "227.22", "Career Avg CP": "56.80", "Record": "23-28", "Win %": "45.1%", "Total Points": "10007.80", "Avg Pts / Season": "188.93", "Alliance High Score": "0", "Alliance Low Score": "4", "League High Score": "1", "League Low Score": "4", "Best Manager": "7", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" },
  "redphoenix437": { "Career CP": "933.99", "Career Avg CP": "233.50", "Record": "45-23", "Win %": "66.2%", "Total Points": "14315.00", "Avg Pts / Season": "204.47", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "3", "League Low Score": "0", "Best Manager": "1", "Conference Wins": "1", "Division Wins": "1", "Playoff Wins": "8" },
  "rhhniner": { "Career CP": "533.70", "Career Avg CP": "133.42", "Record": "35-33", "Win %": "51.5%", "Total Points": "13972.89", "Avg Pts / Season": "199.54", "Alliance High Score": "0", "Alliance Low Score": "1", "League High Score": "7", "League Low Score": "1", "Best Manager": "6", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" },
  "rifelife520": { "Career CP": "2.26", "Career Avg CP": "1.13", "Record": "4-13", "Win %": "23.5%", "Total Points": "2839.35", "Avg Pts / Season": "78.87", "Alliance High Score": "0", "Alliance Low Score": "3", "League High Score": "0", "League Low Score": "3", "Best Manager": "-5", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" },
  "rifelife520 l": { "Career CP": "330.25", "Career Avg CP": "82.56", "Record": "23-11", "Win %": "67.6%", "Total Points": "7901.05", "Avg Pts / Season": "225.88", "Alliance High Score": "1", "Alliance Low Score": "1", "League High Score": "4", "League Low Score": "1", "Best Manager": "-1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "1" },
  "rifelife520 int": { "Career CP": "818.44", "Career Avg CP": "204.61", "Record": "46-22", "Win %": "67.6%", "Total Points": "15533.85", "Avg Pts / Season": "221.87", "Alliance High Score": "2", "Alliance Low Score": "0", "League High Score": "10", "League Low Score": "0", "Best Manager": "3", "Conference Wins": "1", "Division Wins": "1", "Playoff Wins": "3" },
  "rifelife520 int1": { "Career CP": "0.00", "Career Avg CP": "#DIV/0!", "Record": "0-0", "Win %": "#DIV/0!", "Total Points": "0.00", "Avg Pts / Season": "#DIV/0!", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "0", "League Low Score": "0", "Best Manager": "0", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" },
  "rifelife520 int2": { "Career CP": "0.00", "Career Avg CP": "#DIV/0!", "Record": "0-0", "Win %": "#DIV/0!", "Total Points": "0.00", "Avg Pts / Season": "#DIV/0!", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "0", "League Low Score": "0", "Best Manager": "0", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" },
  "rifelife520 int3": { "Career CP": "818.44", "Career Avg CP": "204.61", "Record": "46-22", "Win %": "67.6%", "Total Points": "15533.85", "Avg Pts / Season": "221.87", "Alliance High Score": "2", "Alliance Low Score": "0", "League High Score": "10", "League Low Score": "0", "Best Manager": "4", "Conference Wins": "1", "Division Wins": "1", "Playoff Wins": "3" },
  "rifelife520 int4": { "Career CP": "2.26", "Career Avg CP": "1.13", "Record": "4-13", "Win %": "23.5%", "Total Points": "2839.35", "Avg Pts / Season": "78.87", "Alliance High Score": "0", "Alliance Low Score": "3", "League High Score": "0", "League Low Score": "3", "Best Manager": "-10", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" },
  "roedshow502": { "Career CP": "388.87", "Career Avg CP": "97.22", "Record": "24-27", "Win %": "47.1%", "Total Points": "10363.85", "Avg Pts / Season": "196.04", "Alliance High Score": "0", "Alliance Low Score": "2", "League High Score": "3", "League Low Score": "2", "Best Manager": "-1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "2" },
  "schmacky": { "Career CP": "116.92", "Career Avg CP": "29.23", "Record": "6-11", "Win %": "35.3%", "Total Points": "3467.65", "Avg Pts / Season": "96.32", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "1", "League Low Score": "0", "Best Manager": "1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" },
  "sb428": { "Career CP": "623.17", "Career Avg CP": "155.79", "Record": "43-25", "Win %": "63.2%", "Total Points": "15528.80", "Avg Pts / Season": "221.99", "Alliance High Score": "1", "Alliance Low Score": "0", "League High Score": "7", "League Low Score": "0", "Best Manager": "4", "Conference Wins": "1", "Division Wins": "1", "Playoff Wins": "2" },
  "seanhowe92": { "Career CP": "178.68", "Career Avg CP": "44.67", "Record": "15-19", "Win %": "44.1%", "Total Points": "6447.95", "Avg Pts / Season": "184.61", "Alliance High Score": "0", "Alliance Low Score": "19", "League High Score": "17", "League Low Score": "19", "Best Manager": "-4", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "1" },
  "shubhay": { "Career CP": "472.46", "Career Avg CP": "118.11", "Record": "33-35", "Win %": "48.5%", "Total Points": "11424.54", "Avg Pts / Season": "163.31", "Alliance High Score": "0", "Alliance Low Score": "2", "League High Score": "2", "League Low Score": "2", "Best Manager": "-8", "Conference Wins": "1", "Division Wins": "1", "Playoff Wins": "0" },
  "spacebarracecar": { "Career CP": "401.66", "Career Avg CP": "100.42", "Record": "23-11", "Win %": "67.6%", "Total Points": "7798.95", "Avg Pts / Season": "223.60", "Alliance High Score": "1", "Alliance Low Score": "0", "League High Score": "5", "League Low Score": "0", "Best Manager": "-1", "Conference Wins": "1", "Division Wins": "0", "Playoff Wins": "6" },
  "spano15": { "Career CP": "538.23", "Career Avg CP": "134.56", "Record": "35-33", "Win %": "51.5%", "Total Points": "13593.30", "Avg Pts / Season": "194.27", "Alliance High Score": "0", "Alliance Low Score": "3", "League High Score": "1", "League Low Score": "3", "Best Manager": "-3", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" },
  "springfieldatom5": { "Career CP": "123.73", "Career Avg CP": "30.93", "Record": "11-6", "Win %": "64.7%", "Total Points": "3296.75", "Avg Pts / Season": "91.58", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "1", "League Low Score": "0", "Best Manager": "0", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" },
  "ssutton1": { "Career CP": "790.24", "Career Avg CP": "197.56", "Record": "39-29", "Win %": "57.4%", "Total Points": "11337.25", "Avg Pts / Season": "161.93", "Alliance High Score": "0", "Alliance Low Score": "1", "League High Score": "1", "League Low Score": "1", "Best Manager": "0", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "1" },
  "stokescity": { "Career CP": "505.87", "Career Avg CP": "126.47", "Record": "37-14", "Win %": "72.5%", "Total Points": "12349.60", "Avg Pts / Season": "233.23", "Alliance High Score": "1", "Alliance Low Score": "0", "League High Score": "12", "League Low Score": "0", "Best Manager": "-2", "Conference Wins": "1", "Division Wins": "1", "Playoff Wins": "4" },
  "taunto": { "Career CP": "41.61", "Career Avg CP": "10.40", "Record": "6-11", "Win %": "35.3%", "Total Points": "3047.30", "Avg Pts / Season": "84.65", "Alliance High Score": "0", "Alliance Low Score": "2", "League High Score": "0", "League Low Score": "2", "Best Manager": "0", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" },
  "thebadalec": { "Career CP": "745.32", "Career Avg CP": "186.33", "Record": "39-29", "Win %": "57.4%", "Total Points": "14931.65", "Avg Pts / Season": "213.37", "Alliance High Score": "0", "Alliance Low Score": "2", "League High Score": "3", "League Low Score": "2", "Best Manager": "0", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "2" },
  "thewoat100": { "Career CP": "621.41", "Career Avg CP": "155.35", "Record": "42-26", "Win %": "61.8%", "Total Points": "14226.75", "Avg Pts / Season": "213.12", "Alliance High Score": "0", "Alliance Low Score": "2", "League High Score": "5", "League Low Score": "2", "Best Manager": "-1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "1" },
  "timc13": { "Career CP": "585.10", "Career Avg CP": "146.28", "Record": "43-25", "Win %": "63.2%", "Total Points": "14147.95", "Avg Pts / Season": "201.70", "Alliance High Score": "2", "Alliance Low Score": "0", "League High Score": "8", "League Low Score": "0", "Best Manager": "0", "Conference Wins": "2", "Division Wins": "3", "Playoff Wins": "7" },
  "tobistresenteam": { "Career CP": "874.27", "Career Avg CP": "218.57", "Record": "41-27", "Win %": "60.3%", "Total Points": "11699.20", "Avg Pts / Season": "167.44", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "1", "League Low Score": "0", "Best Manager": "0", "Conference Wins": "2", "Division Wins": "1", "Playoff Wins": "3" },
  "tomjohnmike": { "Career CP": "667.82", "Career Avg CP": "166.96", "Record": "41-27", "Win %": "60.3%", "Total Points": "14980.35", "Avg Pts / Season": "213.86", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "4", "League Low Score": "0", "Best Manager": "0", "Conference Wins": "1", "Division Wins": "0", "Playoff Wins": "2" },
  "trizzytr3": { "Career CP": "491.74", "Career Avg CP": "122.94", "Record": "29-39", "Win %": "42.6%", "Total Points": "11944.40", "Avg Pts / Season": "171.03", "Alliance High Score": "0", "Alliance Low Score": "3", "League High Score": "0", "League Low Score": "3", "Best Manager": "1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" },
  "tylerwt003": { "Career CP": "756.22", "Career Avg CP": "189.06", "Record": "42-26", "Win %": "61.8%", "Total Points": "15652.45", "Avg Pts / Season": "223.65", "Alliance High Score": "1", "Alliance Low Score": "0", "League High Score": "11", "League Low Score": "0", "Best Manager": "7", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "3" },
  "vberry8": { "Career CP": "82.29", "Career Avg CP": "20.57", "Record": "15-36", "Win %": "29.4%", "Total Points": "8996.90", "Avg Pts / Season": "169.74", "Alliance High Score": "0", "Alliance Low Score": "8", "League High Score": "1", "League Low Score": "8", "Best Manager": "-9", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" },
  "veramic": { "Career CP": "276.66", "Career Avg CP": "69.17", "Record": "23-45", "Win %": "33.8%", "Total Points": "12471.85", "Avg Pts / Season": "178.42", "Alliance High Score": "0", "Alliance Low Score": "4", "League High Score": "0", "League Low Score": "4", "Best Manager": "-3", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" },
  "vikezfann": { "Career CP": "786.32", "Career Avg CP": "196.58", "Record": "40-28", "Win %": "58.8%", "Total Points": "13237.35", "Avg Pts / Season": "189.45", "Alliance High Score": "0", "Alliance Low Score": "1", "League High Score": "0", "League Low Score": "1", "Best Manager": "14", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "1" },
  "warboys86": { "Career CP": "432.40", "Career Avg CP": "108.10", "Record": "33-35", "Win %": "48.5%", "Total Points": "13625.60", "Avg Pts / Season": "194.86", "Alliance High Score": "0", "Alliance Low Score": "4", "League High Score": "4", "League Low Score": "4", "Best Manager": "1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" },
  "wereallyouthere": { "Career CP": "860.38", "Career Avg CP": "215.10", "Record": "37-31", "Win %": "54.4%", "Total Points": "11717.15", "Avg Pts / Season": "167.51", "Alliance High Score": "1", "Alliance Low Score": "1", "League High Score": "2", "League Low Score": "1", "Best Manager": "3", "Conference Wins": "1", "Division Wins": "1", "Playoff Wins": "2" },
  "willstephenssr": { "Career CP": "288.68", "Career Avg CP": "72.17", "Record": "20-31", "Win %": "39.2%", "Total Points": "10083.70", "Avg Pts / Season": "190.54", "Alliance High Score": "2", "Alliance Low Score": "5", "League High Score": "4", "League Low Score": "5", "Best Manager": "2", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" },
  "wonks": { "Career CP": "751.52", "Career Avg CP": "187.88", "Record": "39-29", "Win %": "57.4%", "Total Points": "15139.35", "Avg Pts / Season": "216.49", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "4", "League Low Score": "0", "Best Manager": "2", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "3" },
  "wonks l": { "Career CP": "176.17", "Career Avg CP": "44.04", "Record": "13-21", "Win %": "38.2%", "Total Points": "6828.50", "Avg Pts / Season": "194.86", "Alliance High Score": "0", "Alliance Low Score": "4", "League High Score": "0", "League Low Score": "4", "Best Manager": "-2", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" },
  "wynnguy": { "Career CP": "968.43", "Career Avg CP": "242.11", "Record": "56-12", "Win %": "82.4%", "Total Points": "16666.75", "Avg Pts / Season": "238.24", "Alliance High Score": "1", "Alliance Low Score": "0", "League High Score": "14", "League Low Score": "0", "Best Manager": "2", "Conference Wins": "2", "Division Wins": "1", "Playoff Wins": "7" },
  "yinyangkitties": { "Career CP": "355.35", "Career Avg CP": "88.84", "Record": "22-29", "Win %": "43.1%", "Total Points": "8965.09", "Avg Pts / Season": "169.76", "Alliance High Score": "0", "Alliance Low Score": "2", "League High Score": "1", "League Low Score": "2", "Best Manager": "0", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" },
  "yinyangkitties l": { "Career CP": "285.41", "Career Avg CP": "71.35", "Record": "21-13", "Win %": "61.8%", "Total Points": "7233.60", "Avg Pts / Season": "206.58", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "2", "League Low Score": "0", "Best Manager": "2", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "1" },
  "zach2326": { "Career CP": "765.54", "Career Avg CP": "191.39", "Record": "41-26", "Win %": "61.2%", "Total Points": "13959.45", "Avg Pts / Season": "199.38", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "6", "League Low Score": "0", "Best Manager": "4", "Conference Wins": "1", "Division Wins": "1", "Playoff Wins": "3" },
  "ziplocbaggins": { "Career CP": "884.87", "Career Avg CP": "221.22", "Record": "46-22", "Win %": "67.6%", "Total Points": "14605.20", "Avg Pts / Season": "208.94", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "2", "League Low Score": "0", "Best Manager": "-1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "7" },
  "ziplocbaggins l": { "Career CP": "780.47", "Career Avg CP": "195.12", "Record": "46-22", "Win %": "67.6%", "Total Points": "14347.90", "Avg Pts / Season": "205.37", "Alliance High Score": "0", "Alliance Low Score": "1", "League High Score": "2", "League Low Score": "1", "Best Manager": "-1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "7" },
  "acubes21": { "Career CP": "716.17", "Career Avg CP": "179.04", "Record": "44-24", "Win %": "64.7%", "Total Points": "15466.85", "Avg Pts / Season": "221.28", "Alliance High Score": "0", "Alliance Low Score": "1", "League High Score": "8", "League Low Score": "1", "Best Manager": "6", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "3" },
  "alexfinnis": { "Career CP": "730.85", "Career Avg CP": "182.71", "Record": "38-30", "Win %": "55.9%", "Total Points": "14359.25", "Avg Pts / Season": "214.45", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "5", "League Low Score": "0", "Best Manager": "1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "2" },
  "amkm324": { "Career CP": "933.29", "Career Avg CP": "233.32", "Record": "44-24", "Win %": "64.7%", "Total Points": "13706.40", "Avg Pts / Season": "196.05", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "3", "League Low Score": "0", "Best Manager": "-2", "Conference Wins": "0", "Division Wins": "2", "Playoff Wins": "4" },
  "antimisanthrope": { "Career CP": "101.99", "Career Avg CP": "25.50", "Record": "13-21", "Win %": "38.2%", "Total Points": "6025.65", "Avg Pts / Season": "172.50", "Alliance High Score": "0", "Alliance Low Score": "2", "League High Score": "0", "League Low Score": "2", "Best Manager": "-3", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" },
  "arveatz21": { "Career CP": "237.72", "Career Avg CP": "59.43", "Record": "19-32", "Win %": "37.3%", "Total Points": "8812.35", "Avg Pts / Season": "170.01", "Alliance High Score": "0", "Alliance Low Score": "5", "League High Score": "1", "League Low Score": "5", "Best Manager": "-11", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" },
  "austin3x": { "Career CP": "173.79", "Career Avg CP": "43.45", "Record": "10-7", "Win %": "58.8%", "Total Points": "3592.50", "Avg Pts / Season": "99.79", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "2", "League Low Score": "0", "Best Manager": "3", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "1" },
  "babba10101": { "Career CP": "655.40", "Career Avg CP": "163.85", "Record": "39-29", "Win %": "57.4%", "Total Points": "14686.30", "Avg Pts / Season": "210.13", "Alliance High Score": "1", "Alliance Low Score": "3", "League High Score": "2", "League Low Score": "3", "Best Manager": "8", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "2" },
  "beardmantv": { "Career CP": "547.81", "Career Avg CP": "136.95", "Record": "34-34", "Win %": "50.0%", "Total Points": "14220.20", "Avg Pts / Season": "203.52", "Alliance High Score": "0", "Alliance Low Score": "5", "League High Score": "2", "League Low Score": "5", "Best Manager": "-3", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "1" },
  "beaster303": { "Career CP": "306.02", "Career Avg CP": "76.51", "Record": "28-40", "Win %": "41.2%", "Total Points": "12838.70", "Avg Pts / Season": "183.75", "Alliance High Score": "0", "Alliance Low Score": "1", "League High Score": "5", "League Low Score": "1", "Best Manager": "-2", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" },
  "beaverius": { "Career CP": "346.32", "Career Avg CP": "86.58", "Record": "28-40", "Win %": "41.2%", "Total Points": "12763.65", "Avg Pts / Season": "182.32", "Alliance High Score": "0", "Alliance Low Score": "6", "League High Score": "2", "League Low Score": "6", "Best Manager": "1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "2" },
  "boonedoggaf": { "Career CP": "449.90", "Career Avg CP": "112.47", "Record": "31-37", "Win %": "45.6%", "Total Points": "13380.65", "Avg Pts / Season": "191.44", "Alliance High Score": "1", "Alliance Low Score": "3", "League High Score": "1", "League Low Score": "3", "Best Manager": "-5", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" },
  "booshay": { "Career CP": "451.94", "Career Avg CP": "112.99", "Record": "27-41", "Win %": "39.7%", "Total Points": "9815.65", "Avg Pts / Season": "140.24", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "1", "League Low Score": "0", "Best Manager": "6", "Conference Wins": "1", "Division Wins": "1", "Playoff Wins": "0" },
  "bradlevo": { "Career CP": "774.14", "Career Avg CP": "193.54", "Record": "49-19", "Win %": "72.1%", "Total Points": "15126.39", "Avg Pts / Season": "216.25", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "8", "League Low Score": "0", "Best Manager": "2", "Conference Wins": "1", "Division Wins": "1", "Playoff Wins": "5" },
  "catinthehat2": { "Career CP": "588.41", "Career Avg CP": "147.10", "Record": "37-31", "Win %": "54.4%", "Total Points": "13800.65", "Avg Pts / Season": "197.37", "Alliance High Score": "0", "Alliance Low Score": "1", "League High Score": "1", "League Low Score": "1", "Best Manager": "3", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" },
  "cozzin": { "Career CP": "273.98", "Career Avg CP": "68.50", "Record": "21-30", "Win %": "41.2%", "Total Points": "9456.40", "Avg Pts / Season": "178.78", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "1", "League Low Score": "0", "Best Manager": "-1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "1" },
  "crb2121": { "Career CP": "283.44", "Career Avg CP": "70.86", "Record": "21-13", "Win %": "61.8%", "Total Points": "7521.25", "Avg Pts / Season": "214.83", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "3", "League Low Score": "0", "Best Manager": "4", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" },
  "cre8t1v3": { "Career CP": "604.49", "Career Avg CP": "151.12", "Record": "34-32", "Win %": "51.5%", "Total Points": "13575.49", "Avg Pts / Season": "202.67", "Alliance High Score": "0", "Alliance Low Score": "3", "League High Score": "7", "League Low Score": "3", "Best Manager": "-1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "2" },
  "cre8t1v3 int": { "Career CP": "604.49", "Career Avg CP": "151.12", "Record": "34-32", "Win %": "51.5%", "Total Points": "13575.49", "Avg Pts / Season": "202.67", "Alliance High Score": "0", "Alliance Low Score": "3", "League High Score": "7", "League Low Score": "3", "Best Manager": "-1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "2" },
  "cspeese22": { "Career CP": "421.61", "Career Avg CP": "105.40", "Record": "27-24", "Win %": "52.9%", "Total Points": "11191.20", "Avg Pts / Season": "211.12", "Alliance High Score": "1", "Alliance Low Score": "5", "League High Score": "7", "League Low Score": "5", "Best Manager": "6", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "2" },
  "db091391": { "Career CP": "668.02", "Career Avg CP": "167.00", "Record": "37-31", "Win %": "54.4%", "Total Points": "14621.55", "Avg Pts / Season": "209.07", "Alliance High Score": "0", "Alliance Low Score": "1", "League High Score": "3", "League Low Score": "1", "Best Manager": "1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "4" },
  "dommez": { "Career CP": "35.70", "Career Avg CP": "8.92", "Record": "5-12", "Win %": "29.4%", "Total Points": "3068.70", "Avg Pts / Season": "85.24", "Alliance High Score": "0", "Alliance Low Score": "1", "League High Score": "0", "League Low Score": "1", "Best Manager": "-1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" },
  "evanthomas536": { "Career CP": "301.69", "Career Avg CP": "75.42", "Record": "26-42", "Win %": "38.2%", "Total Points": "12723.65", "Avg Pts / Season": "182.04", "Alliance High Score": "0", "Alliance Low Score": "14", "League High Score": "1", "League Low Score": "14", "Best Manager": "-5", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" },
  "fantasytren": { "Career CP": "425.79", "Career Avg CP": "106.45", "Record": "28-40", "Win %": "41.2%", "Total Points": "13441.30", "Avg Pts / Season": "192.07", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "1", "League Low Score": "0", "Best Manager": "3", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "2" },
  "finnbar3": { "Career CP": "789.86", "Career Avg CP": "197.47", "Record": "41-27", "Win %": "60.3%", "Total Points": "13207.14", "Avg Pts / Season": "188.61", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "7", "League Low Score": "0", "Best Manager": "1", "Conference Wins": "1", "Division Wins": "1", "Playoff Wins": "3" },
  "garcia925": { "Career CP": "513.09", "Career Avg CP": "128.27", "Record": "39-29", "Win %": "57.4%", "Total Points": "14901.05", "Avg Pts / Season": "213.14", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "6", "League Low Score": "0", "Best Manager": "0", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "1" },
  "garmstrong2002": { "Career CP": "528.49", "Career Avg CP": "132.12", "Record": "29-39", "Win %": "42.6%", "Total Points": "12881.85", "Avg Pts / Season": "193.85", "Alliance High Score": "0", "Alliance Low Score": "4", "League High Score": "1", "League Low Score": "4", "Best Manager": "2", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" },
  "gavdjedi": { "Career CP": "223.27", "Career Avg CP": "55.82", "Record": "26-42", "Win %": "38.2%", "Total Points": "13151.75", "Avg Pts / Season": "187.97", "Alliance High Score": "0", "Alliance Low Score": "5", "League High Score": "0", "League Low Score": "5", "Best Manager": "2", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" },
  "glang727": { "Career CP": "518.22", "Career Avg CP": "129.55", "Record": "36-32", "Win %": "52.9%", "Total Points": "14586.85", "Avg Pts / Season": "208.48", "Alliance High Score": "2", "Alliance Low Score": "0", "League High Score": "1", "League Low Score": "0", "Best Manager": "1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "4" },
  "huibuh": { "Career CP": "946.61", "Career Avg CP": "236.65", "Record": "41-27", "Win %": "60.3%", "Total Points": "12614.50", "Avg Pts / Season": "180.23", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "11", "League Low Score": "0", "Best Manager": "5", "Conference Wins": "3", "Division Wins": "3", "Playoff Wins": "6" },
  "jamie04": { "Career CP": "248.88", "Career Avg CP": "62.22", "Record": "20-14", "Win %": "58.8%", "Total Points": "7230.95", "Avg Pts / Season": "206.71", "Alliance High Score": "0", "Alliance Low Score": "1", "League High Score": "3", "League Low Score": "1", "Best Manager": "3", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "3" },
  "jay21177": { "Career CP": "499.67", "Career Avg CP": "124.92", "Record": "27-41", "Win %": "39.7%", "Total Points": "13596.25", "Avg Pts / Season": "194.64", "Alliance High Score": "0", "Alliance Low Score": "5", "League High Score": "1", "League Low Score": "5", "Best Manager": "-2", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "2" },
  "kingigor31": { "Career CP": "208.56", "Career Avg CP": "52.14", "Record": "18-16", "Win %": "52.9%", "Total Points": "6932.60", "Avg Pts / Season": "198.43", "Alliance High Score": "0", "Alliance Low Score": "3", "League High Score": "0", "League Low Score": "3", "Best Manager": "-2", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" },
  "koala530": { "Career CP": "153.04", "Career Avg CP": "38.26", "Record": "12-5", "Win %": "70.6%", "Total Points": "3813.55", "Avg Pts / Season": "105.93", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "2", "League Low Score": "0", "Best Manager": "1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "1" },
  "mattbanks3x": { "Career CP": "930.46", "Career Avg CP": "232.62", "Record": "46-22", "Win %": "67.6%", "Total Points": "15080.85", "Avg Pts / Season": "215.29", "Alliance High Score": "1", "Alliance Low Score": "0", "League High Score": "11", "League Low Score": "0", "Best Manager": "1", "Conference Wins": "1", "Division Wins": "1", "Playoff Wins": "2" },
  "mchostetler1": { "Career CP": "563.24", "Career Avg CP": "140.81", "Record": "35-33", "Win %": "51.5%", "Total Points": "13833.85", "Avg Pts / Season": "197.78", "Alliance High Score": "1", "Alliance Low Score": "1", "League High Score": "3", "League Low Score": "1", "Best Manager": "4", "Conference Wins": "0", "Division Wins": "1", "Playoff Wins": "1" },
  "mightykidsmeal": { "Career CP": "619.97", "Career Avg CP": "154.99", "Record": "37-31", "Win %": "54.4%", "Total Points": "14310.30", "Avg Pts / Season": "204.73", "Alliance High Score": "0", "Alliance Low Score": "2", "League High Score": "2", "League Low Score": "2", "Best Manager": "1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" },
  "mlporter2001": { "Career CP": "130.50", "Career Avg CP": "32.63", "Record": "13-21", "Win %": "38.2%", "Total Points": "6605.90", "Avg Pts / Season": "188.71", "Alliance High Score": "0", "Alliance Low Score": "2", "League High Score": "0", "League Low Score": "2", "Best Manager": "-1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" },
  "nblu82": { "Career CP": "339.09", "Career Avg CP": "84.77", "Record": "25-43", "Win %": "36.8%", "Total Points": "12559.85", "Avg Pts / Season": "179.77", "Alliance High Score": "0", "Alliance Low Score": "14", "League High Score": "1", "League Low Score": "14", "Best Manager": "-2", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" },
  "nbowers12": { "Career CP": "113.25", "Career Avg CP": "28.31", "Record": "10-7", "Win %": "58.8%", "Total Points": "3310.00", "Avg Pts / Season": "91.94", "Alliance High Score": "0", "Alliance Low Score": "1", "League High Score": "0", "League Low Score": "1", "Best Manager": "-2", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" },
  "patty5": { "Career CP": "147.35", "Career Avg CP": "36.84", "Record": "9-8", "Win %": "52.9%", "Total Points": "3475.60", "Avg Pts / Season": "96.54", "Alliance High Score": "0", "Alliance Low Score": "1", "League High Score": "1", "League Low Score": "1", "Best Manager": "-1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "1" },
  "pauly102 l": { "Career CP": "91.06", "Career Avg CP": "22.77", "Record": "11-23", "Win %": "32.4%", "Total Points": "6510.75", "Avg Pts / Season": "185.94", "Alliance High Score": "0", "Alliance Low Score": "4", "League High Score": "3", "League Low Score": "4", "Best Manager": "-1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" },
  "putinsbalenciagas": { "Career CP": "603.87", "Career Avg CP": "150.97", "Record": "27-41", "Win %": "39.7%", "Total Points": "9927.29", "Avg Pts / Season": "141.94", "Alliance High Score": "0", "Alliance Low Score": "1", "League High Score": "0", "League Low Score": "1", "Best Manager": "1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "1" },
  "ravenger": { "Career CP": "514.57", "Career Avg CP": "128.64", "Record": "31-37", "Win %": "45.6%", "Total Points": "11269.90", "Avg Pts / Season": "160.79", "Alliance High Score": "0", "Alliance Low Score": "1", "League High Score": "2", "League Low Score": "1", "Best Manager": "2", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" },
  "sammykins13": { "Career CP": "206.96", "Career Avg CP": "51.74", "Record": "17-17", "Win %": "50.0%", "Total Points": "6385.95", "Avg Pts / Season": "182.61", "Alliance High Score": "0", "Alliance Low Score": "1", "League High Score": "2", "League Low Score": "1", "Best Manager": "0", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" },
  "samwow123": { "Career CP": "850.75", "Career Avg CP": "212.69", "Record": "49-19", "Win %": "72.1%", "Total Points": "16522.40", "Avg Pts / Season": "236.26", "Alliance High Score": "3", "Alliance Low Score": "0", "League High Score": "7", "League Low Score": "0", "Best Manager": "-5", "Conference Wins": "1", "Division Wins": "0", "Playoff Wins": "5" },
  "samwow123 l": { "Career CP": "456.55", "Career Avg CP": "114.14", "Record": "27-7", "Win %": "79.4%", "Total Points": "8170.25", "Avg Pts / Season": "233.63", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "6", "League Low Score": "0", "Best Manager": "3", "Conference Wins": "1", "Division Wins": "0", "Playoff Wins": "5" },
  "srcav": { "Career CP": "653.43", "Career Avg CP": "163.36", "Record": "35-33", "Win %": "51.5%", "Total Points": "14464.95", "Avg Pts / Season": "206.99", "Alliance High Score": "0", "Alliance Low Score": "3", "League High Score": "4", "League Low Score": "3", "Best Manager": "1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "2" },
  "svelter": { "Career CP": "311.52", "Career Avg CP": "77.88", "Record": "31-37", "Win %": "45.6%", "Total Points": "12872.74", "Avg Pts / Season": "184.02", "Alliance High Score": "0", "Alliance Low Score": "5", "League High Score": "0", "League Low Score": "5", "Best Manager": "-2", "Conference Wins": "1", "Division Wins": "1", "Playoff Wins": "1" },
  "tallandflat": { "Career CP": "443.36", "Career Avg CP": "110.84", "Record": "28-40", "Win %": "41.2%", "Total Points": "13919.85", "Avg Pts / Season": "199.30", "Alliance High Score": "0", "Alliance Low Score": "1", "League High Score": "2", "League Low Score": "1", "Best Manager": "-1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" },
  "treetwig": { "Career CP": "461.13", "Career Avg CP": "115.28", "Record": "26-25", "Win %": "51.0%", "Total Points": "11146.15", "Avg Pts / Season": "210.33", "Alliance High Score": "2", "Alliance Low Score": "0", "League High Score": "3", "League Low Score": "0", "Best Manager": "7", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "1" },
  "wdh76": { "Career CP": "568.69", "Career Avg CP": "142.17", "Record": "32-19", "Win %": "62.7%", "Total Points": "11462.45", "Avg Pts / Season": "216.07", "Alliance High Score": "4", "Alliance Low Score": "0", "League High Score": "17", "League Low Score": "0", "Best Manager": "3", "Conference Wins": "1", "Division Wins": "1", "Playoff Wins": "1" },
  "wearyiungs": { "Career CP": "110.39", "Career Avg CP": "55.19", "Record": "11-6", "Win %": "64.7%", "Total Points": "3249.40", "Avg Pts / Season": "90.26", "Alliance High Score": "0", "Alliance Low Score": "1", "League High Score": "1", "League Low Score": "1", "Best Manager": "0", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "0" },
  "willywonga33": { "Career CP": "214.79", "Career Avg CP": "53.70", "Record": "18-16", "Win %": "52.9%", "Total Points": "6651.30", "Avg Pts / Season": "190.78", "Alliance High Score": "0", "Alliance Low Score": "4", "League High Score": "0", "League Low Score": "4", "Best Manager": "1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "1" },
  "z1856z": { "Career CP": "779.08", "Career Avg CP": "194.77", "Record": "44-24", "Win %": "64.7%", "Total Points": "15019.65", "Avg Pts / Season": "214.51", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "10", "League Low Score": "0", "Best Manager": "-3", "Conference Wins": "1", "Division Wins": "1", "Playoff Wins": "5" },
  "z1856z l": { "Career CP": "238.07", "Career Avg CP": "59.52", "Record": "22-12", "Win %": "64.7%", "Total Points": "7664.85", "Avg Pts / Season": "218.73", "Alliance High Score": "0", "Alliance Low Score": "1", "League High Score": "5", "League Low Score": "1", "Best Manager": "0", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "2" },
  "zcal": { "Career CP": "654.19", "Career Avg CP": "163.55", "Record": "33-35", "Win %": "48.5%", "Total Points": "11144.19", "Avg Pts / Season": "159.35", "Alliance High Score": "0", "Alliance Low Score": "2", "League High Score": "2", "League Low Score": "2", "Best Manager": "2", "Conference Wins": "0", "Division Wins": "1", "Playoff Wins": "2" },
  "zero00": { "Career CP": "764.92", "Career Avg CP": "191.23", "Record": "32-36", "Win %": "47.1%", "Total Points": "12888.95", "Avg Pts / Season": "184.64", "Alliance High Score": "0", "Alliance Low Score": "3", "League High Score": "4", "League Low Score": "3", "Best Manager": "3", "Conference Wins": "1", "Division Wins": "2", "Playoff Wins": "3" },
  "zero00 l": { "Career CP": "311.24", "Career Avg CP": "77.81", "Record": "14-20", "Win %": "41.2%", "Total Points": "7202.05", "Avg Pts / Season": "206.21", "Alliance High Score": "0", "Alliance Low Score": "1", "League High Score": "1", "League Low Score": "1", "Best Manager": "1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "3" },
  "zero00 int": { "Career CP": "550.57", "Career Avg CP": "137.64", "Record": "29-5", "Win %": "85.3%", "Total Points": "7925.50", "Avg Pts / Season": "226.82", "Alliance High Score": "0", "Alliance Low Score": "0", "League High Score": "6", "League Low Score": "0", "Best Manager": "1", "Conference Wins": "0", "Division Wins": "0", "Playoff Wins": "5" },
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

// ── Coach Profile popup: current team + conference are always shown (from
// the same Sleeper data as the directory); career stats show once CAREER_
// STATS has an entry for this coach, otherwise a plain "not in yet" note.
function CoachProfileModal({ coach, onClose }) {
  if (!coach) return null;
  const stats = CAREER_STATS[coach.name.toLowerCase()];
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
              <div className="text-lg font-semibold leading-tight">{coach.name}</div>
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
// standings data already on the page. Roster resolves player IDs against
// Sleeper's players dictionary (fetched lazily — see ensurePlayersLoaded).
const POSITION_ORDER = ["QB", "RB", "WR", "TE", "K", "DEF"];

function TeamProfileModal({ team, onClose, playersDict, playersLoading }) {
  if (!team) return null;

  const players = (team.playerIds || []).map((pid) => {
    const p = playersDict ? playersDict[pid] : null;
    return {
      id: pid,
      name: p ? p.full_name || `${p.first_name || ""} ${p.last_name || ""}`.trim() : pid,
      position: p ? p.position || "—" : "—",
      nflTeam: p ? p.team || "FA" : "",
    };
  });
  players.sort((a, b) => {
    const ia = POSITION_ORDER.indexOf(a.position);
    const ib = POSITION_ORDER.indexOf(b.position);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });

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

        <div className="px-2.5 py-2 rounded-sm mb-4" style={{ background: C.ink, border: `1px solid ${C.line}` }}>
          <div className="text-xs uppercase tracking-wider" style={{ color: C.slate }}>Max Total Points</div>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", color: C.gold, fontWeight: 600 }}>
            {typeof team.maxPts === "number" ? fmt(team.maxPts) : "—"}
          </div>
        </div>

        <div className="text-xs uppercase tracking-wider mb-2" style={{ color: C.slate }}>Roster</div>
        {playersLoading ? (
          <div className="text-xs" style={{ color: C.slate }}>Loading roster…</div>
        ) : players.length === 0 ? (
          <div className="text-xs" style={{ color: C.slate }}>No roster data available.</div>
        ) : (
          <div className="space-y-1">
            {players.map((p) => (
              <div key={p.id} className="flex items-center justify-between text-sm px-2 py-1 rounded-sm" style={{ background: C.ink }}>
                <span className="truncate">{p.name}</span>
                <span className="text-xs shrink-0 ml-2" style={{ color: C.slate, fontFamily: "'IBM Plex Mono', monospace" }}>
                  {p.position}{p.nflTeam ? ` · ${p.nflTeam}` : ""}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 text-xs" style={{ color: C.slate }}>
          Draft picks aren't shown yet — still deciding the right shape for that with Lainey.
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [mode, setMode] = useState("loading");
  const [view, setView] = useState("home");
  const [tierKey, setTierKey] = useState("NFL");
  const [dirQuery, setDirQuery] = useState("");
  const [selectedCoach, setSelectedCoach] = useState(null);
  const [selectedTeam, setSelectedTeam] = useState(null);
  const [playersDict, setPlayersDict] = useState(null);
  const [playersLoading, setPlayersLoading] = useState(false);
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
    const stats = CAREER_STATS[(name || "").toLowerCase()];
    if (!stats) return null;
    const n = parseFloat(stats["Career CP"]);
    return Number.isFinite(n) ? n : null;
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

  const findCoachAvatar = (name) => {
    const hit = coachDirectory.find((c) => c.name.toLowerCase() === (name || "").toLowerCase());
    return hit ? hit.avatar : null;
  };

  const openCoachProfile = (name) => {
    const hit = coachDirectory.find((c) => c.name.toLowerCase() === (name || "").toLowerCase());
    setSelectedCoach(hit || { name, avatar: null, team: null, tierKey: null, tierName: null });
  };

  // Sleeper's full player dictionary is a large, mostly-static file — fetch
  // it once, lazily, the first time someone actually opens a team roster,
  // rather than on every page load. Kept in memory only (not localStorage)
  // since it's sizeable and this avoids any storage-quota surprises.
  const ensurePlayersLoaded = useCallback(async () => {
    if (playersDict || playersLoading) return;
    setPlayersLoading(true);
    try {
      const data = await j(`${SLEEPER}/players/nfl`);
      setPlayersDict(data);
    } catch (e) {
      setPlayersDict({});
    } finally {
      setPlayersLoading(false);
    }
  }, [playersDict, playersLoading]);

  const openTeamProfile = (row, tKey) => {
    const t = TIERS.find((x) => x.key === tKey);
    setSelectedTeam({
      team: row.team,
      tierKey: tKey,
      tierName: t ? t.name : tKey,
      maxPts: row.maxPts,
      playerIds: row.playerIds || [],
    });
    if (mode === "live") ensurePlayersLoaded();
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
            <Tab id="coaches">Top Coaches</Tab>
            <Tab id="directory">Directory</Tab>
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
                              <button type="button" onClick={() => openCoachProfile(r.coach)} style={{ color: "inherit" }}>
                                {r.coach}
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
            <h2 className="text-3xl uppercase mb-1" style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700 }}>
              Career Coaching Points
            </h2>
            <p className="text-sm mb-4" style={{ color: C.slate }}>
              The all-time ladder. Coaching points are earned by team performance, weighted by tier, and accrue season over season — never spent, only built on. Your total is your qualification the next time a job opens up.
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
                      <td className="px-3 py-2 whitespace-nowrap" style={{ fontFamily: "'Barlow', sans-serif", fontWeight: 600 }}>
                        <button type="button" onClick={() => openCoachProfile(r.coach)} style={{ color: "inherit" }}>
                          {r.coach}
                        </button>
                      </td>
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
                    <div className="text-sm font-semibold truncate">{c.name}</div>
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
          <section className="grid md:grid-cols-2 gap-8">
            <div>
              <h2 className="text-3xl uppercase mb-3" style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700 }}>
                The Pyramid
              </h2>
              <div className="space-y-3 text-sm leading-relaxed">
                <p>
                  Thirteen dynasty leagues stacked in ranked tiers, from the NFL down to Florida High School. Every league shares the
                  same rosters, scoring, and NFL players — the difference is the stakes.
                </p>
                <p>
                  Your team's performance earns you <span style={{ color: C.gold }}>coaching points</span>. Higher tiers pay more. You
                  never spend them — they accrue season over season, rewarding sustained success over one great year. Your total is
                  your qualification for the job.
                </p>
                <p>
                  When a team opens up, applications are blind — nobody knows who else is applying. The team hires whoever's most
                  qualified: highest coaching points gets it, and leaves behind a promotion-worthy team, now needing a new coach.
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

      <CoachProfileModal coach={selectedCoach} onClose={() => setSelectedCoach(null)} />
      <TeamProfileModal
        team={selectedTeam}
        onClose={() => setSelectedTeam(null)}
        playersDict={playersDict}
        playersLoading={playersLoading}
      />
    </div>
  );
}
