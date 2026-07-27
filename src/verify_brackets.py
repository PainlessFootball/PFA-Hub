import re, sys
src = open('App.jsx').read()

def arr(blob, key):
    m = re.search(key + r':\s*\[', blob)
    if not m: return ""
    i = m.end() - 1; d = 0
    for j in range(i, len(blob)):
        if blob[j] == '[': d += 1
        elif blob[j] == ']':
            d -= 1
            if d == 0: return blob[i:j+1]
    return ""

BOX = re.compile(r'\[(\d+),\s*(\d+),\s*"([^"]+)",\s*"([\d.]+)"(,\s*1)?\]')
# pick note may be empty (SWAC's bowl uses a logo instead) and the tuple may
# carry an optional 5th element, the custom cell width
PLC = re.compile(r'\[(\d+),\s*(\d+),\s*"([^"]*)",\s*"([^"]+)"(?:,\s*\d+)?\]')
WIN = re.compile(r'\[(\d+),\s*(\d+),\s*"([^"]+)"\]')
SWAC_NAME = re.search(r'const SWAC_BOWL_NAME = "([^"]+)"', src).group(1)
RANK = {"champion":1, "3rd place":3, "5th place":5, "7th place":7,
        "9th place":9, "11th place":11, "13th place":13, "15th place":15,
        # SWAC renames its 7th-place game; it still sets the 7/8 placements
        "7-11 Seven Days A Week 7th Place Super Savings Bowl":7}

TIERS = {
 "SEC": (["South Carolina","Ole Miss","Kentucky","Arkansas","Texas A&M","Oklahoma","Miss State","Missouri",
          "Florida","Georgia","Tennessee","Vanderbilt","Alabama","Auburn","Texas","LSU"]),
 "SWAC": (["Morgan St","Miss Valley","Jackson St","PVAM","Bethune","Southern U","Alcorn","Florida A&M",
           "Grambling","SC St","Alabama A&M","NC Central","Alabama St","Pine Bluff","TX Southern","Norfolk St"]),
 "TEN": (["Northwestern","UCLA","Washington","Ohio State","Cal","Indiana","Penn State","Oregon",
          "Purdue","Michigan","Wisconsin","Illinois","Maryland","Utah","USC","Rutgers"]),
}
fails = []
for tier, expected in TIERS.items():
    print(f"\n########## {tier} ##########")
    order = {}
    for half in ("PLAYOFFS", "CONSOLATION"):
        name = f"{tier}_2025_{half}"
        s = src.index(f"const {name} = {{")
        e = min([x for x in (src.find(f"const {tier}_2025_BOWLS", s),
                             src.find(f"const {tier}_2025_CONSOLATION", s+10),
                             src.find("const GRID_BRACKETS", s)) if x > s])
        blob = src[s:e]
        for si, sec in enumerate(re.split(r'\n    \{\n', blob)[1:]):
            bx = [(int(a),int(b),c,float(d),bool(f)) for a,b,c,d,f in BOX.findall(arr(sec,"boxes"))]
            col = {}
            for x,y,t,sc,w in bx: col.setdefault(x,[]).append((y,y+38,t))
            for x,items in sorted(col.items()):
                items.sort()
                for i in range(len(items)-1):
                    if items[i+1][0] < items[i][1]:
                        fails.append(f"{name} s{si} x={x}: {items[i][2]}/{items[i+1][2]} overlap")
            by = {(x,y):(t,sc,w) for x,y,t,sc,w in bx}
            games = [((x,y),(x,y+38)) for x,y,*_ in bx if (x,y+38) in by]
            for x in (224,672):
                ys = sorted(y for xx,y,*_ in bx if xx==x)
                if len(ys)==2 and ys[1]-ys[0]>38: games.append(((x,ys[0]),(x,ys[1])))
            bad=0
            for a,b in games:
                (ta,sa,wa),(tb,sb,wb) = by[a],by[b]
                hi = ta if sa>sb else tb
                if not ((wa and ta==hi) or (wb and tb==hi)):
                    fails.append(f"{name} s{si} flag: {ta} {sa} vs {tb} {sb}, higher={hi}"); bad+=1
            print(f"  {name} s{si}: {len(bx)} boxes, {len(games)} games, {bad} bad flags")
            winners = {int(y):t for _,y,t in WIN.findall(arr(sec,"winners"))}
            raw = arr(sec,'places').replace('SWAC_BOWL_NAME', '"' + SWAC_NAME + '"')
            entries = [(int(y),txt) for _,y,pk,txt in PLC.findall(raw)]
            cm = re.search(r'champion: \{ y: (\d+), label: "([^"]+)", team: "([^"]+)"', sec)
            if cm: entries.append((int(cm.group(1)), "champion"))
            for y, txt in entries:
                L,R = by.get((336,y)), by.get((560,y))
                if not L or not R: fails.append(f"{name} {txt}: missing wk17 box y={y}"); continue
                W,Lo = (L,R) if L[1]>R[1] else (R,L)
                stored = cm.group(3) if txt=="champion" else winners.get(y-19)
                if W[0] != stored: fails.append(f"{name} {txt}: scores say {W[0]}, bar says {stored}")
                r = RANK[txt]; order[r] = W[0]; order[r+1] = Lo[0]
    got = [order.get(i) for i in range(1,17)]
    ok = got == expected
    print(f"  derived 1-16: {', '.join(str(x) for x in got)}")
    if not ok:
        fails.append(f"{tier} final order mismatch")
        for i,(g,e2) in enumerate(zip(got,expected),1):
            if g!=e2: print(f"    #{i}: derived {g} != expected {e2}")
    print(f"  final order: {'MATCHES' if ok else 'MISMATCH'}")

print("\n" + ("ALL CHECKS PASS" if not fails else "FAILURES:\n" + "\n".join(fails)))
sys.exit(1 if fails else 0)
