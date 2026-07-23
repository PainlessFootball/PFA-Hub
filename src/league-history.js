// LEAGUE_HISTORY additions — Sleeper league IDs by season, 2023-2026
// From Painless_Football_Alliance_-_league_IDs.pdf
//
// Your app already has LEAGUE_HISTORY[2026] — merge these in as the 2025,
// 2024, and 2023 entries (and 2026, if it's useful to double check against
// what you already have). I've kept the tier keys matching your nav/tier
// naming; rename if your existing LEAGUE_HISTORY object uses different keys.
//
// One open question: "Pioneer" only had a single ID in the export
// (919371831558131712), with no year column indicated — this is presumably
// the folded league mentioned as having sat between GLIAC and FLHS before it
// folded. I've guessed it belongs under 2023 (the oldest year in this table)
// since that's the most likely last season it existed, but you should
// confirm — it could be earlier than 2023 and just carried forward as a
// reference ID.

const LEAGUE_HISTORY_ADDITIONS = {
  2026: {
    NFL: "1316582839847759872",
    USFL: "1316586636028448768",
    XFL: "1316588494914613248",
    SEC: "1316594738958192640",
    "BIG XII": "1317152669235703808",
    ACC: "1317191636379254784",
    TEN: "1317530523035242496",
    "Sun Belt": "1317557888784306176",
    SoCo: "1317559700799131648",
    Ivy: "1317562012057735168",
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
    "Sun Belt": "1184163547609038848",
    SoCo: "1185042556622708736",
    Ivy: "1185069556594888704",
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
    "Sun Belt": "1054214327244279808",
    SoCo: "1054447353786179584",
    Ivy: "1054448671129014272",
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
    "Sun Belt": "919395393438310400",
    SoCo: "919395035123122176",
    Ivy: "919394484612435968",
    SWAC: "919392917653901312",
    GLIAC: "919392125446373376",
    FLHS: "919369950941241344",
    // Pioneer: "919371831558131712" — folded league, year unconfirmed (see note above)
  },
};

export default LEAGUE_HISTORY_ADDITIONS;
