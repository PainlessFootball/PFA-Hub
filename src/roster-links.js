// ROSTER_LINKS — team name -> Sleeper roster URL
// Built from Painless_Football_Alliance_-_Sheet141.pdf (roster link export),
// with league IDs corrected against Painless_Football_Alliance_-_league_IDs.pdf
//
// IMPORTANT FIX: cross-checking the roster export against the official league
// ID table revealed the roster PDF's league-ID headers for Sun Belt, SoCo,
// Ivy, SWAC, and GLIAC were each shifted one tier off (almost certainly a
// page-break artifact from the PDF export) — the team names and roster
// numbers were right, but attached to the WRONG league's ID. All six
// (Sun Belt, SoCo, Ivy, SWAC, GLIAC, and FLHS) are corrected below using the
// authoritative 2026 IDs. This also resolved FLHS, whose links were
// completely broken in the roster export — it's now filled in.
//
// REMAINING OPEN ITEMS (see chat message):
// 1. "North Colorado Bears" (Big XII) — in the source export this links into
//    the XFL league instead (roster 18, which is actually the Los Angeles
//    Wildcats' slot). Left out; need the real Big XII roster number.
// 2. "THE Ohio State Buckeyes" (Big Ten) — in the source export this links
//    into the FLHS league instead (roster 4, an unfilled FLHS slot). Left
//    out; need the real Big Ten roster number.
// 3. Blank cells (#N/A team name, or #N/A link) were skipped — these look
//    like unfilled roster slots, not typos.

const ROSTER_LINKS = {
  // ---- NFL (1316582839847759872) ----
  "Baltimore Ravens": "https://sleeper.com/roster/1316582839847759872/12",
  "New England Patriots": "https://sleeper.com/roster/1316582839847759872/3",
  "San Francisco 49ers": "https://sleeper.com/roster/1316582839847759872/14",
  "Green Bay Packers": "https://sleeper.com/roster/1316582839847759872/6",
  "Los Angeles Rams": "https://sleeper.com/roster/1316582839847759872/32",
  "Tennessee Titans": "https://sleeper.com/roster/1316582839847759872/28",
  "Cincinnati Bengals": "https://sleeper.com/roster/1316582839847759872/7",
  "Detroit Lions": "https://sleeper.com/roster/1316582839847759872/27",
  "Miami Dolphins": "https://sleeper.com/roster/1316582839847759872/16",
  "Los Angeles Chargers": "https://sleeper.com/roster/1316582839847759872/18",
  "Arizona Cardinals": "https://sleeper.com/roster/1316582839847759872/15",
  "New York Jets": "https://sleeper.com/roster/1316582839847759872/26",
  "Pittsburgh Steelers": "https://sleeper.com/roster/1316582839847759872/10",
  "Indianapolis Colts": "https://sleeper.com/roster/1316582839847759872/20",
  "Philadelphia Eagles": "https://sleeper.com/roster/1316582839847759872/29",
  "Oakland Raiders": "https://sleeper.com/roster/1316582839847759872/2",
  "Dallas Cowboys": "https://sleeper.com/roster/1316582839847759872/9",
  "Jacksonville Jaguars": "https://sleeper.com/roster/1316582839847759872/4",
  "Seattle Seahawks": "https://sleeper.com/roster/1316582839847759872/11",
  "New Orleans Saints": "https://sleeper.com/roster/1316582839847759872/17",
  "Buffalo Bills": "https://sleeper.com/roster/1316582839847759872/24",
  "Minnesota Vikings": "https://sleeper.com/roster/1316582839847759872/31",
  "New York Giants": "https://sleeper.com/roster/1316582839847759872/22",
  "Chicago Bears": "https://sleeper.com/roster/1316582839847759872/5",
  "Atlanta Falcons": "https://sleeper.com/roster/1316582839847759872/30",
  "Tampa Bay Buccaneers": "https://sleeper.com/roster/1316582839847759872/8",
  "Houston Texans": "https://sleeper.com/roster/1316582839847759872/13",
  "Washington Commanders": "https://sleeper.com/roster/1316582839847759872/1",
  "Carolina Panthers": "https://sleeper.com/roster/1316582839847759872/21",
  "Cleveland Browns": "https://sleeper.com/roster/1316582839847759872/19",
  "Kansas City Chiefs": "https://sleeper.com/roster/1316582839847759872/25",
  "Denver Broncos": "https://sleeper.com/roster/1316582839847759872/23",

  // ---- USFL (1316586636028448768) — 2 slots unfilled in source (skipped) ----
  "San Antonio Gunslingers": "https://sleeper.com/roster/1316586636028448768/20",
  "Pittsburgh Maulers": "https://sleeper.com/roster/1316586636028448768/6",
  "Birmingham Stallions": "https://sleeper.com/roster/1316586636028448768/14",
  "Denver Gold": "https://sleeper.com/roster/1316586636028448768/17",
  "Los Angeles Express": "https://sleeper.com/roster/1316586636028448768/3",
  "Washington Federals": "https://sleeper.com/roster/1316586636028448768/10",
  "Boston Breakers": "https://sleeper.com/roster/1316586636028448768/1",
  "New Jersey Generals": "https://sleeper.com/roster/1316586636028448768/19",
  "Michigan Panthers": "https://sleeper.com/roster/1316586636028448768/12",
  "Philadelphia Stars": "https://sleeper.com/roster/1316586636028448768/16",
  "Oklahoma Outlaws": "https://sleeper.com/roster/1316586636028448768/7",
  "Detroit Drive": "https://sleeper.com/roster/1316586636028448768/9",
  "Chicago Blitz": "https://sleeper.com/roster/1316586636028448768/18",
  "Orlando Renegades": "https://sleeper.com/roster/1316586636028448768/5",
  "Arizona Wranglers": "https://sleeper.com/roster/1316586636028448768/11",
  "Tampa Bay Bandits": "https://sleeper.com/roster/1316586636028448768/2",
  "Houston Gamblers": "https://sleeper.com/roster/1316586636028448768/8",
  "Oakland Invaders": "https://sleeper.com/roster/1316586636028448768/13",

  // ---- XFL (1316588494914613248) — 2 slots unfilled in source (skipped) ----
  "DC Defenders": "https://sleeper.com/roster/1316588494914613248/7",
  "Birmingham Thunderbolts": "https://sleeper.com/roster/1316588494914613248/4",
  "Orlando Rage": "https://sleeper.com/roster/1316588494914613248/17",
  "Seattle Dragons": "https://sleeper.com/roster/1316588494914613248/15",
  "Tampa Bay Vipers": "https://sleeper.com/roster/1316588494914613248/9",
  "Boston Brawlers": "https://sleeper.com/roster/1316588494914613248/6",
  "Brooklyn Bolts": "https://sleeper.com/roster/1316588494914613248/12",
  "Los Angeles Xtreme": "https://sleeper.com/roster/1316588494914613248/8",
  "Memphis Maniax": "https://sleeper.com/roster/1316588494914613248/5",
  "Los Angeles Wildcats": "https://sleeper.com/roster/1316588494914613248/18",
  "Dallas Renegades": "https://sleeper.com/roster/1316588494914613248/2",
  "Omaha Mammoths": "https://sleeper.com/roster/1316588494914613248/20",
  "St. Louis Battlehawks": "https://sleeper.com/roster/1316588494914613248/14",
  "Atlanta Legends": "https://sleeper.com/roster/1316588494914613248/19",
  "New York Guardians": "https://sleeper.com/roster/1316588494914613248/3",
  "San Francisco Demons": "https://sleeper.com/roster/1316588494914613248/1",
  "Chicago Enforcers": "https://sleeper.com/roster/1316588494914613248/11",
  "New Jersey Hitmen": "https://sleeper.com/roster/1316588494914613248/16",

  // ---- SEC (1316594738958192640) — all 16 present ----
  "South Carolina Gamecocks": "https://sleeper.com/roster/1316594738958192640/8",
  "Ole Miss Rebels": "https://sleeper.com/roster/1316594738958192640/7",
  "Kentucky Wildcats": "https://sleeper.com/roster/1316594738958192640/11",
  "Florida Gators": "https://sleeper.com/roster/1316594738958192640/10",
  "Arkansas Razorbacks": "https://sleeper.com/roster/1316594738958192640/3",
  "Texas A & M Aggies": "https://sleeper.com/roster/1316594738958192640/6",
  "Oklahoma Sooners": "https://sleeper.com/roster/1316594738958192640/12",
  "Miss State Bulldogs": "https://sleeper.com/roster/1316594738958192640/2",
  "Georgia Bulldogs": "https://sleeper.com/roster/1316594738958192640/16",
  "Missouri Tigers": "https://sleeper.com/roster/1316594738958192640/13",
  "Alabama Crimson Tide": "https://sleeper.com/roster/1316594738958192640/15",
  "Tennessee Volunteers": "https://sleeper.com/roster/1316594738958192640/4",
  "Vanderbilt Commodores": "https://sleeper.com/roster/1316594738958192640/14",
  "Auburn TIGERS": "https://sleeper.com/roster/1316594738958192640/5",
  "LSU Tigers": "https://sleeper.com/roster/1316594738958192640/9",
  "Texas Longhorns": "https://sleeper.com/roster/1316594738958192640/1",

  // ---- BIG XII (1317152669235703808) ----
  // NOTE: "North Colorado Bears" in the source sheet links into the XFL
  // league instead (1316588494914613248/18, which is actually the Los
  // Angeles Wildcats' slot) — a copy/paste error. Left out below; let me
  // know the real roster number and I'll add it.
  "Iowa State Cyclones": "https://sleeper.com/roster/1317152669235703808/15",
  "South Dakota State": "https://sleeper.com/roster/1317152669235703808/16",
  "Houston Cougars": "https://sleeper.com/roster/1317152669235703808/6",
  "Cincinnati Bearcats": "https://sleeper.com/roster/1317152669235703808/3",
  "OSU": "https://sleeper.com/roster/1317152669235703808/1",
  "Baylor Bears": "https://sleeper.com/roster/1317152669235703808/4",
  "Arizona Wildcats": "https://sleeper.com/roster/1317152669235703808/8",
  "Denver Pioneers": "https://sleeper.com/roster/1317152669235703808/13",
  "Kansas JAYhawks": "https://sleeper.com/roster/1317152669235703808/2",
  "West Virgnia Mountaineers": "https://sleeper.com/roster/1317152669235703808/14",
  "BYU Cougars": "https://sleeper.com/roster/1317152669235703808/12",
  "Kansas State Wildcats": "https://sleeper.com/roster/1317152669235703808/5",
  "TCU Horned Frogs": "https://sleeper.com/roster/1317152669235703808/9",
  "UCF Knights": "https://sleeper.com/roster/1317152669235703808/10",
  "Texas Tech": "https://sleeper.com/roster/1317152669235703808/7",

  // ---- ACC (1317191636379254784) — all 16 present ----
  "Virginia Tech Hokies": "https://sleeper.com/roster/1317191636379254784/2",
  "Duke Blue Devils": "https://sleeper.com/roster/1317191636379254784/16",
  "Louisville Cardinals": "https://sleeper.com/roster/1317191636379254784/5",
  "SMU Mustangs": "https://sleeper.com/roster/1317191636379254784/14",
  "Florida State Seminoles": "https://sleeper.com/roster/1317191636379254784/13",
  "North Carolina Tar Heels": "https://sleeper.com/roster/1317191636379254784/11",
  "Syracuse Orange": "https://sleeper.com/roster/1317191636379254784/15",
  "Wake Forest": "https://sleeper.com/roster/1317191636379254784/9",
  "Clemson Tigers": "https://sleeper.com/roster/1317191636379254784/8",
  "Notre Dame Fighting Irish": "https://sleeper.com/roster/1317191636379254784/10",
  "Pittsburgh Panthers": "https://sleeper.com/roster/1317191636379254784/1",
  "Virginia Cavaliers": "https://sleeper.com/roster/1317191636379254784/6",
  "Boston College Eagles": "https://sleeper.com/roster/1317191636379254784/3",
  "Miami Hurricanes": "https://sleeper.com/roster/1317191636379254784/12",
  "NC State Wolfpack": "https://sleeper.com/roster/1317191636379254784/4",
  "GeorgiaTech YellowJackets": "https://sleeper.com/roster/1317191636379254784/7",

  // ---- BIG TEN (1317530523035242496) — 4 slots unfilled in source (skipped) ----
  // NOTE: "THE Ohio State Buckeyes" in the source sheet links into the FLHS
  // league instead (1317921468134232064/4, an unfilled FLHS slot) — a
  // copy/paste error. Left out below; let me know the real roster number
  // and I'll add it.
  "Northwestern Wildcats": "https://sleeper.com/roster/1317530523035242496/13",
  "Indiana Hoosiers": "https://sleeper.com/roster/1317530523035242496/11",
  "Cal Golden Bears": "https://sleeper.com/roster/1317530523035242496/6",
  "Penn St. Nittany Lions": "https://sleeper.com/roster/1317530523035242496/15",
  "Michigan Wolverines": "https://sleeper.com/roster/1317530523035242496/2",
  "Purdue Boilermakes": "https://sleeper.com/roster/1317530523035242496/12",
  "Utah Utes": "https://sleeper.com/roster/1317530523035242496/3",
  "Oregon Ducks": "https://sleeper.com/roster/1317530523035242496/8",
  "Illinois Fighting Illini": "https://sleeper.com/roster/1317530523035242496/9",
  "MARYLAND TERPS": "https://sleeper.com/roster/1317530523035242496/10",
  "Rutgers Scarlet Knights": "https://sleeper.com/roster/1317530523035242496/14",
  "USC Trojans": "https://sleeper.com/roster/1317530523035242496/5",

  // ---- SUN BELT (1317557888784306176) — corrected ID; 1 slot unfilled ----
  "Georgia State Panthers": "https://sleeper.com/roster/1317557888784306176/7",
  "Little Rock Trojans": "https://sleeper.com/roster/1317557888784306176/8",
  "App State Mountaineers": "https://sleeper.com/roster/1317557888784306176/12",
  "USM Golden Eagles": "https://sleeper.com/roster/1317557888784306176/3",
  "South Alabama Jaguars": "https://sleeper.com/roster/1317557888784306176/10",
  "Arlington Mavericks": "https://sleeper.com/roster/1317557888784306176/11",
  "Troy Trojans": "https://sleeper.com/roster/1317557888784306176/2",
  "Georgia Southern Eagles": "https://sleeper.com/roster/1317557888784306176/13",
  "ULM Warhawks": "https://sleeper.com/roster/1317557888784306176/15",
  "Louisiana Ragin' Cajuns": "https://sleeper.com/roster/1317557888784306176/14",
  "James Madison Dukes": "https://sleeper.com/roster/1317557888784306176/16",
  "Old Dominion Monarchs": "https://sleeper.com/roster/1317557888784306176/4",
  "Marshall Thundering Herd": "https://sleeper.com/roster/1317557888784306176/5",
  "Texas State Bobcats": "https://sleeper.com/roster/1317557888784306176/9",
  "Carolina Chanticleers": "https://sleeper.com/roster/1317557888784306176/1",

  // ---- SOCO (1317559700799131648) — corrected ID; 2 slots unfilled ----
  "Austin Peay Governors": "https://sleeper.com/roster/1317559700799131648/4",
  "West Carolina Catamounts": "https://sleeper.com/roster/1317559700799131648/8",
  "Belmont Bruins": "https://sleeper.com/roster/1317559700799131648/14",
  "Mercer Bears": "https://sleeper.com/roster/1317559700799131648/3",
  "E Tenn Buccaneers": "https://sleeper.com/roster/1317559700799131648/5",
  "Tennessee St Tigers": "https://sleeper.com/roster/1317559700799131648/7",
  "The Citadel Bulldogs": "https://sleeper.com/roster/1317559700799131648/16",
  "VMI Keydets": "https://sleeper.com/roster/1317559700799131648/15",
  "Elon Phoenix": "https://sleeper.com/roster/1317559700799131648/11",
  "Tennessee Martin Skyhawks": "https://sleeper.com/roster/1317559700799131648/9",
  "Samford Bulldogs": "https://sleeper.com/roster/1317559700799131648/13",
  "Nicholls State Colonels": "https://sleeper.com/roster/1317559700799131648/2",
  "Murray State Racers": "https://sleeper.com/roster/1317559700799131648/6",
  "Tenn Tech Eagles": "https://sleeper.com/roster/1317559700799131648/12",

  // ---- IVY (1317562012057735168) — corrected ID; 2 slots unfilled ----
  "Brown Bears": "https://sleeper.com/roster/1317562012057735168/12",
  "Colgate Raiders": "https://sleeper.com/roster/1317562012057735168/11",
  "Lehigh Mountain Hawks": "https://sleeper.com/roster/1317562012057735168/15",
  "Bucknell Bison": "https://sleeper.com/roster/1317562012057735168/16",
  "Dartmouth Big Green": "https://sleeper.com/roster/1317562012057735168/3",
  "Penn Quakers": "https://sleeper.com/roster/1317562012057735168/8",
  "Georgetown Hoyas": "https://sleeper.com/roster/1317562012057735168/7",
  "Holy Cross Crusaders": "https://sleeper.com/roster/1317562012057735168/13",
  "Columbia Lions": "https://sleeper.com/roster/1317562012057735168/14",
  "Cornell University Bears": "https://sleeper.com/roster/1317562012057735168/6",
  "Harvard Crimson": "https://sleeper.com/roster/1317562012057735168/2",
  "MIT Engineers": "https://sleeper.com/roster/1317562012057735168/10",
  "Lafayette Leopards": "https://sleeper.com/roster/1317562012057735168/4",
  "Fordham Rams": "https://sleeper.com/roster/1317562012057735168/1",

  // ---- SWAC (1317574770207789056) — corrected ID; 6 slots unfilled ----
  // NOTE: "PFA VP" is an odd team name (roster 16) — kept as-is since it may
  // be a real Sleeper display name, but worth a sanity check.
  "PFA VP": "https://sleeper.com/roster/1317574770207789056/16",
  "Mississippi Valley Devils": "https://sleeper.com/roster/1317574770207789056/12",
  "Bethune-Cookman Wildcats": "https://sleeper.com/roster/1317574770207789056/10",
  "Grambling State Tigers": "https://sleeper.com/roster/1317574770207789056/5",
  "S.C. State Bulldogs": "https://sleeper.com/roster/1317574770207789056/8",
  "SouthernU Jaguars": "https://sleeper.com/roster/1317574770207789056/2",
  "Alabama A&M Bulldogs": "https://sleeper.com/roster/1317574770207789056/7",
  "Alcorn State Braves": "https://sleeper.com/roster/1317574770207789056/9",
  "Pine Bluff Golden Lions": "https://sleeper.com/roster/1317574770207789056/11",
  "Alabama State Hornets": "https://sleeper.com/roster/1317574770207789056/3",

  // ---- GLIAC (1317895570131546112) — corrected ID; 5 slots unfilled ----
  "Davenport Panthers": "https://sleeper.com/roster/1317895570131546112/3",
  "Wayne State Warriors": "https://sleeper.com/roster/1317895570131546112/13",
  "N Michigan Wildcats": "https://sleeper.com/roster/1317895570131546112/9",
  "JCU Blue Streaks": "https://sleeper.com/roster/1317895570131546112/8",
  "Northwood Timberwolves": "https://sleeper.com/roster/1317895570131546112/5",
  "Ferris State Bulldogs": "https://sleeper.com/roster/1317895570131546112/12",
  "Baldwin Yellow Jackets": "https://sleeper.com/roster/1317895570131546112/4",
  "Mount Union Raiders": "https://sleeper.com/roster/1317895570131546112/16",
  "Wilmington Quakers": "https://sleeper.com/roster/1317895570131546112/10",
  "Lake Superior Lakers": "https://sleeper.com/roster/1317895570131546112/1",
  "Purdue NW Pride": "https://sleeper.com/roster/1317895570131546112/14",

  // ---- FLHS (1317921468134232064) — now complete (was broken/missing before) ----
  "Western Wildcats": "https://sleeper.com/roster/1317921468134232064/7",
  "West Broward Bobcats": "https://sleeper.com/roster/1317921468134232064/6",
  "West Boca Raton Bulls": "https://sleeper.com/roster/1317921468134232064/2",
  "Dr Krop Lightning": "https://sleeper.com/roster/1317921468134232064/15",
  "Coral Glades Jaguars": "https://sleeper.com/roster/1317921468134232064/9",
  "Stoneman Douglas Eagles": "https://sleeper.com/roster/1317921468134232064/5",
  "Miami Senior Stingrays": "https://sleeper.com/roster/1317921468134232064/8",
};

export default ROSTER_LINKS;
