"""Builds src/data.json for the Vermont School District Builder.

Inputs (in raw/, see README for download commands):
  VT_School_Geo.json      VCGI town table (students, grand list, supervisory union, regions)
  schools_all.json        VCGI school points (public, independent, CTE)
  cousub/cb_2024_50_cousub_500k.shp   Census cartographic town boundaries (2024)
  acs_b17001.dat          ACS 2020-2024 5-year, poverty by age (town rows)
  acs_b19013.dat          ACS 2020-2024 5-year, median household income (town rows)

Usage: python3 prep/build_data.py raw src
"""
import json, math, sys, statistics
from collections import defaultdict
import shapefile
from shapely.geometry import shape, Point
import warnings; warnings.filterwarnings('ignore')
from shapely.ops import transform, unary_union
from pyproj import Transformer

RAW, OUT = sys.argv[1], sys.argv[2]

# ---------- regions defined in law ----------
# Act 170 of 2026 (H.955), Sec. 2: supervisory unions -> CESAs
CESA = {
    "Champlain Valley North": ["Franklin Northeast SU", "Franklin West SU", "Grand Isle SU", "Maple Run USD", "Milton SD", "Missisquoi Valley SD"],
    "Chittenden Central": ["Burlington SD", "Colchester SD", "Essex Westford ECUUSD", "South Burlington SD", "Winooski SD"],
    "Champlain Valley South": ["Addison Central SD", "Addison Northwest SD", "Champlain Valley SD", "Lincoln SD", "Mt. Abraham USD", "Mt. Mansfield UUSD"],
    "Southwest": ["Bennington Rutland SU", "Greater Rutland County SU", "Mill River UUSD", "Rutland City SD", "Rutland Northeast SU", "Slate Valley UUSD", "Southwest Vermont SU"],
    "Vermont Learning Collaborative": ["Mountain Views SU", "Springfield SD", "Two Rivers SU", "Windham Central SU", "Windham Northeast SU", "Windham Southeast SU", "Windham Southwest SU", "Windsor Southeast SU"],
    "Northeast": ["Caledonia Central SU", "Essex North SU", "Hartford SD", "Kingdom East SD", "North Country SU", "Orange East SU", "Orleans Central SU", "Rivendell Interstate SD", "SAU 70", "St. Johnsbury SD"],
    "Winooski Valley": ["Barre UUSD", "Central Vermont SU", "Harwood UUSD", "Lamoille North SU", "Lamoille South SU", "Montpelier Roxbury SD", "Orange Southwest UUSD", "Orleans Southwest SU", "Washington Central UUSD", "White River Valley SU"],
}
# Act 170, Sec. 14: merger committee groupings (school districts), translated to towns via SU plus town overrides
GROUPS = [
    ("Group 1: Addison", ["Addison Central SD", "Addison Northwest SD", "Lincoln SD", "Mt. Abraham USD"]),
    ("Group 2: Rutland", ["Rutland Northeast SU", "Rutland City SD", "Slate Valley UUSD", "Mill River UUSD", "Greater Rutland County SU"]),
    ("Group 3: Northshire–Mettawee", ["Bennington Rutland SU"]),
    ("Group 4: Southwest Vermont", ["Southwest Vermont SU"]),
    ("Group 5: Brattleboro–Deerfield Valley", ["Windham Southeast SU", "Windham Southwest SU"]),
    ("Group 6: West River–Bellows Falls", ["Windham Central SU", "Windham Northeast SU"]),
    ("Group 7: Springfield–Two Rivers", ["Two Rivers SU", "Springfield SD"]),
    ("Group 8: Hartford–Woodstock–Windsor", ["Hartford SD", "Windsor Southeast SU", "Mountain Views SU"]),
    ("Group 9: White River–Orange Southwest", ["White River Valley SU", "Orange Southwest UUSD", "Central Vermont SU"]),
    ("Group 10: Caledonia–Orange East", ["Caledonia Central SU", "Orange East SU"]),
    ("Group 11: St. Johnsbury–Essex North", ["Essex North SU", "Kingdom East SD", "St. Johnsbury SD"]),
    ("Group 12: North Country–Lake Region", ["North Country SU", "Orleans Central SU"]),
    ("Group 13: CVSD–Mount Mansfield", ["Mt. Mansfield UUSD", "Champlain Valley SD"]),
    ("Group 14: Essex Westford", ["Essex Westford ECUUSD"]),
    ("Group 15: Lamoille–Orleans Southwest", ["Lamoille North SU", "Lamoille South SU", "Orleans Southwest SU"]),
    ("Group 16: Missisquoi–Franklin Northeast", ["Franklin Northeast SU", "Missisquoi Valley SD"]),
    ("Group 17: St. Albans–Franklin West", ["Franklin West SU", "Maple Run USD"]),
    ("Group 18: Burlington–South Burlington–Winooski", ["Burlington SD", "South Burlington SD", "Winooski SD"]),
    ("Group 19: Islands–Colchester–Milton", ["Grand Isle SU", "Colchester SD", "Milton SD"]),
    ("Group 20: Barre–Montpelier–Mad River", ["Barre UUSD", "Harwood UUSD", "Montpelier Roxbury SD", "Washington Central UUSD"]),
    ("Not grouped: Rivendell (interstate)", ["Rivendell Interstate SD"]),
    ("Not grouped: SAU 70 (interstate)", ["SAU 70"]),
]
GROUP_TOWN_OVERRIDE = {  # school districts listed in a different group than the rest of their SU
    "Wells": "Group 3: Northshire–Mettawee", "Middletown Springs": "Group 3: Northshire–Mettawee",  # Wells Spring UUSD
    "Stratton": "Group 3: Northshire–Mettawee",
    "Northfield": "Group 20: Barre–Montpelier–Mad River", "Williamstown": "Group 20: Barre–Montpelier–Mad River",  # Paine Mountain
}

# House Education draft map (Rep. Conlon, presented 2/5/2026), as listed by school district in JFO's 3/11/2026
# analysis; translated to towns via SU plus overrides for SUs the draft splits. Numbers follow the draft (10 and 23 unused).
HOUSE_SU = {
    "Addison Central SD": 1, "Addison Northwest SD": 1, "Mt. Abraham USD": 1, "Lincoln SD": 1,
    "Rutland Northeast SU": 2, "Rutland City SD": 2, "Greater Rutland County SU": 3, "Slate Valley UUSD": 3,
    "Bennington Rutland SU": 4, "Mill River UUSD": 4, "Southwest Vermont SU": 5, "Windham Southeast SU": 6, "Windham Southwest SU": 6,
    "Windham Northeast SU": 7, "Windham Central SU": 7, "Two Rivers SU": 8, "Springfield SD": 8, "Windsor Southeast SU": 9, "Hartford SD": 9,
    "White River Valley SU": 11, "Orange Southwest UUSD": 11, "Orange East SU": 12, "Caledonia Central SU": 12,
    "Kingdom East SD": 13, "St. Johnsbury SD": 13, "Essex North SU": 14, "North Country SU": 14, "Mt. Mansfield UUSD": 15,
    "Champlain Valley SD": 16, "Essex Westford ECUUSD": 17, "Lamoille North SU": 18, "Lamoille South SU": 18,
    "Franklin Northeast SU": 19, "Missisquoi Valley SD": 19, "Maple Run USD": 20, "Franklin West SU": 20,
    "Burlington SD": 21, "Winooski SD": 21, "South Burlington SD": 22, "Grand Isle SU": 24, "Colchester SD": 24, "Milton SD": 24,
    "Washington Central UUSD": 25, "Montpelier Roxbury SD": 25, "Harwood UUSD": 26, "Barre UUSD": 27, "Central Vermont SU": 27,
    "Orleans Southwest SU": 28, "Orleans Central SU": 28, "Mountain Views SU": 29, "Rivendell Interstate SD": 90, "SAU 70": 91,
}
HOUSE_TOWN = {  # where the draft splits an SU
    "Proctor": 2, "West Rutland": 2,                  # Quarry Valley is listed under both 2 and 3; Poultney placed with Slate Valley (3)
    "Readsboro": 5, "Searsburg": 5, "Stamford": 5,    # Windham Southwest
    "Marlboro": 6,                                     # Windham Central
    "Thetford": 11,                                    # Orange East
    "Granville": 26, "Hancock": 26,                    # Granville-Hancock (White River Valley SU)
    "Cabot": 27, "Marshfield": 27, "Plainfield": 27,   # Cabot and Twinfield (Caledonia Central)
    "Roxbury": 27,                                     # Montpelier Roxbury listed under 25 and 27
    "Alburgh": 19,                                     # Grand Isle SU
}
HOUSE_NAMES = {1: "Addison", 2: "Rutland", 3: "Slate Valley–Poultney", 4: "Northshire–Mettawee–Mill River", 5: "Bennington", 6: "Brattleboro–Deerfield Valley",
    7: "Bellows Falls–West River", 8: "Springfield–Two Rivers", 9: "Hartford–Windsor", 11: "White River–Randolph", 12: "Bradford–Caledonia",
    13: "St. Johnsbury–Lyndon", 14: "North Country–Essex North", 15: "Mount Mansfield", 16: "Champlain Valley", 17: "Essex Westford", 18: "Lamoille",
    19: "Missisquoi–Franklin Northeast", 20: "St. Albans–Franklin West", 21: "Burlington–Winooski", 22: "South Burlington", 24: "Islands–Colchester–Milton",
    25: "Montpelier–Washington Central", 26: "Mad River–Granville-Hancock", 27: "Barre–Central Vermont", 28: "Lake Region–Hazen", 29: "Woodstock–Mountain Views",
    90: "Rivendell (interstate)", 91: "SAU 70 (interstate)"}

# ---------- towns ----------
vt = {f["properties"]["TOWNGEOID"]: f["properties"] for f in json.load(open(f"{RAW}/VT_School_Geo.json"))["features"]}

def acs(path):
    rows = open(path).read().strip().split("\n"); head = rows[0].split("|"); out = {}
    for r in rows[1:]:
        v = r.split("|"); out[v[0][-10:]] = dict(zip(head, v))
    return out
pov, inc = acs(f"{RAW}/acs_b17001.dat"), acs(f"{RAW}/acs_b19013.dat")
def num(x):
    try: return float(x)
    except Exception: return 0.0
BELOW = [f"B17001_E{i:03d}" for i in (5, 6, 7, 8, 9, 19, 20, 21, 22, 23)]  # ages 5-17 below poverty
ABOVE = [f"B17001_E{i:03d}" for i in (34, 35, 36, 37, 38, 48, 49, 50, 51, 52)]

proj = Transformer.from_crs("EPSG:4326", "EPSG:32145", always_xy=True).transform  # Vermont State Plane (m)
sf = shapefile.Reader(f"{RAW}/cousub/cb_2024_50_cousub_500k.shp")
geo = {}
for sr in sf.iterShapeRecords():
    rec = sr.record.as_dict()
    geo[rec["GEOID"]] = transform(proj, shape(sr.shape.__geo_interface__)).buffer(0)

# large lakes, subtracted from the drawn outlines only (town lines in the water still count for adjacency)
import glob
water = []
for wf in glob.glob(f"{RAW}/water/tl_2024_*_areawater.shp"):
    for ws in shapefile.Reader(wf).shapes():
        w = transform(proj, shape(ws.__geo_interface__)).buffer(0)
        if w.area > 3e6: water.append(w)
WATER = unary_union(water) if water else None
land = {k: (g.difference(WATER).buffer(0) if WATER is not None and g.intersects(WATER) else g) for k, g in geo.items()}

ids = sorted(geo, key=lambda g: (vt[g]["County"], vt[g]["TOWNNAMEMC"]))
U = []
for gid in ids:
    p, g = vt[gid], geo[gid]
    pr, ic = pov.get(gid, {}), inc.get(gid, {})
    below = sum(num(pr.get(k)) for k in BELOW); above = sum(num(pr.get(k)) for k in ABOVE)
    U.append(dict(
        id=gid, name=p["TOWNNAMEMC"], county=p["County"].title(), su=p["Supervisory_Union"],
        sba=p["School_Board_Association"], cte=p["CTE_Region"], gov=p["Governor_Proposed"], rpc=p["RPC"],
        st=int(p["Public_School_Students"] or 0), y14=int(p["Y14"] or 0),
        gl=round((p["Total_E_Ed_GL_Act73"] or 0) / 1000), glh=round((p["Home_E_Ed_GL_Act73"] or 0) / 1000),
        sqmi=round(land[gid].area / 2589988.11, 1), pop=int(p["TotalPopEst_2024"] or 0), k517=int(p["Census2020_5_17"] or 0),
        pb=int(below), pt=int(below + above), mhi=int(num(ic.get("B19013_E001"))),
    ))
idx = {u["id"]: i for i, u in enumerate(U)}
name_ix = {u["name"]: i for i, u in enumerate(U)}

# ---------- adjacency (shared border length, km) ----------
from shapely.strtree import STRtree
geoms = [geo[u["id"]] for u in U]
tree = STRtree(geoms)
nb = defaultdict(dict)
for i, g in enumerate(geoms):
    for j in tree.query(g.buffer(5)):
        j = int(j)
        if j <= i: continue
        L = g.buffer(5).intersection(geoms[j].buffer(5)).length / 2 / 1000  # ~shared border length
        if g.distance(geoms[j]) < 5 and L > 0.05:
            nb[i][j] = nb[j][i] = round(L, 2)
# water crossings (bridges and causeways in the Champlain Islands)
LINKS = [("Isle La Motte", "Alburgh"), ("Alburgh", "North Hero"), ("North Hero", "Grand Isle"), ("Grand Isle", "South Hero"),
         ("South Hero", "Milton"), ("South Hero", "Colchester"), ("Alburgh", "Swanton")]
links = []
for a, b in LINKS:
    i, j = name_ix[a], name_ix[b]
    if j not in nb[i]:
        nb[i][j] = nb[j][i] = 0.5; links.append([i, j])
# connectivity check
seen, st = {0}, [0]
while st:
    a = st.pop()
    for b in nb[a]:
        if b not in seen: seen.add(b); st.append(b)
assert len(seen) == len(U), [U[i]["name"] for i in range(len(U)) if i not in seen]

# ---------- schools ----------
SCH = []
for f in json.load(open(f"{RAW}/schools_all.json"))["features"]:
    p = f["properties"]
    if p.get("Status") == "CLOSED" or not f.get("geometry"): continue
    lon, lat = f["geometry"]["coordinates"][:2]
    x, y = proj(lon, lat); pt = Point(x, y)
    ti = next((i for i, g in enumerate(geoms) if g.contains(pt)), None)
    if ti is None: ti = name_ix.get((p.get("townMC") or "").strip())
    if ti is None: ti = min(range(len(geoms)), key=lambda i: geoms[i].distance(pt))
    acc = {"Public": "P", "Independent": "I", "CTE": "C"}[p["accessType"]]
    hs = int((p.get("Enrollment9_12") or 0) > 0 or "12" in (p.get("Grades") or "").split("-")[-1:])
    if acc == "C": hs = 0
    SCH.append(dict(t=ti, n=(p.get("Title") or p["School"]).strip(), a=acc, g=p.get("Grades") or "", e=int(p.get("Enrollment") or 0),
                    hs=hs, yb=int(p.get("yearBuilt") or 0), fci=p.get("fciCategory") or "", x=round(x / 1000, 2), y=round(y / 1000, 2),
                    note=(p.get("Notes") or "").strip()))

# ---------- simplified outlines for drawing (km, y up) ----------
def ring_pts(r, tol):
    from shapely.geometry import LineString
    c = list(LineString(r.coords).simplify(tol).coords)
    return [[round(x / 1000, 2), round(y / 1000, 2)] for x, y in c]
def outline(g, tol=120):
    polys = [g] if g.geom_type == "Polygon" else list(g.geoms)
    out = []
    for p in polys:
        if p.area < 2e5: continue
        out.append([ring_pts(p.exterior, tol)])
    return out
for i, u in enumerate(U):
    g = land[u["id"]]
    u["shape"] = outline(g)
    c = g.representative_point(); cc = g.centroid
    u["lx"], u["ly"] = round(c.x / 1000, 2), round(c.y / 1000, 2)
    u["x"], u["y"] = round(cc.x / 1000, 2), round(cc.y / 1000, 2)
    u["nb"] = [[j, L] for j, L in sorted(nb[i].items())]
    u["s"] = [k for k, s in enumerate(SCH) if s["t"] == i]

# ---------- shared borders between neighboring towns (drawn where districts differ) ----------
LAND = unary_union(list(land.values())).buffer(1)
def lines_of(g):
    if g.is_empty: return []
    if g.geom_type == "LineString": return [g]
    if g.geom_type == "MultiLineString": return list(g.geoms)
    if hasattr(g, "geoms"): return [x for p in g.geoms for x in lines_of(p)]
    return []
from shapely.ops import linemerge
EDGES = []
for i in range(len(U)):
    for j in nb[i]:
        if j <= i: continue
        b = geoms[i].boundary.intersection(geoms[j].buffer(3))
        b = b.intersection(LAND)
        ls = lines_of(b)
        if not ls: continue
        m = linemerge(ls) if len(ls) > 1 else ls[0]
        parts = [x.simplify(120) for x in lines_of(m) if x.length > 200]
        if not parts: continue
        EDGES.append([i, j, [[[round(x / 1000, 2), round(y / 1000, 2)] for x, y in q.coords] for q in parts]])

# ---------- presets ----------
def preset_from(fn, label, desc, order=None):
    keys = []
    for u in U:
        k = fn(u)
        if k not in keys: keys.append(k)
    keys = order or sorted(keys)
    return dict(name=label, desc=desc, names=keys, plan=[keys.index(fn(u)) for u in U])

su_of_cesa = {su: c for c, sus in CESA.items() for su in sus}
grp_of_su = {su: gname for gname, sus in GROUPS for su in sus}
assert set(su_of_cesa) == {u["su"] for u in U}, {u["su"] for u in U} - set(su_of_cesa)
assert set(grp_of_su) == {u["su"] for u in U}
for u in U:
    u["cesa"] = su_of_cesa[u["su"]]
    u["grp"] = GROUP_TOWN_OVERRIDE.get(u["name"], grp_of_su[u["su"]])

# Senate Education map, version 6 (3/23/2026): 12 new SUs from its district-builder link; the "grey area" keeps today's units
sys.path.insert(0, __file__.rsplit("/", 1)[0])
from vcgi_url import decode as vcgi_decode
_, SEN = vcgi_decode(open(__file__.rsplit("/", 1)[0] + "/senate_v6.url").read().strip(), f"{RAW}/VT_School_Geo.json")
sen_of = {g: name.replace("SU#", "New SU ") for name, gids in SEN for g in gids}
def senate(u):
    if u["id"] in sen_of: return sen_of[u["id"]]
    if u["su"] == "Caledonia Central SU": return "Grey area: Cabot–Twinfield"
    return "Grey area: " + u["su"]
sen_keys = [n.replace("SU#", "New SU ") for n, _ in SEN]
sen_keys += sorted({senate(u) for u in U} - set(sen_keys))
def house(u): return HOUSE_TOWN.get(u["name"], HOUSE_SU[u["su"]])
house_keys = sorted({house(u) for u in U})

presets = [
    preset_from(lambda u: u["su"], "Today: 52 supervisory unions and districts",
                "Each of Vermont's 52 supervisory unions and supervisory districts, with its member towns as listed by VCGI. These are the units the Act 73 and Act 170 debates set out to combine."),
    preset_from(lambda u: u["grp"], "Act 170 merger committee groupings (2026)",
                "The 20 school-district groupings that Act 170 of 2026, Sec. 14, gives facilitators as guidance for merger committees. Three Paine Mountain, Wells Spring and Stratton towns sit in a different group from the rest of their SU. Rivendell and SAU 70 are interstate and not grouped.",
                order=[g for g, _ in GROUPS]),
    dict(name="House Education draft map (February 2026)", names=[f"{HOUSE_NAMES[k]} (draft no. {k})" if k < 90 else HOUSE_NAMES[k] for k in house_keys],
         plan=[house_keys.index(house(u)) for u in U],
         desc="Rep. Conlon's first draft (presented February 5, 2026): 27 supervisory districts of about 2,000 to 4,000 students, plus the two interstate districts. Drawn from the school-district list in the Joint Fiscal Office's March 11 analysis; Poultney (Quarry Valley) and Roxbury (Montpelier Roxbury) are placed where that list is ambiguous. Numbers follow the draft, which skips 10 and 23."),
    dict(name="Senate Education map, version 6 (March 2026)", names=sen_keys, plan=[sen_keys.index(senate(u)) for u in U],
         desc="Sen. Bongartz's version 6 (March 23, 2026): 12 new supervisory unions from its district-builder link, with the \"grey area\" (most of Chittenden, Addison, Franklin and central Washington County) keeping today's units. These are supervisory units, which can contain several school districts."),
    preset_from(lambda u: u["cesa"], "Act 170 Cooperative Educational Service Areas",
                "The seven CESAs created in statute by Act 170 of 2026, Sec. 2. They share services; they are not school districts."),
    preset_from(lambda u: u["gov"], "Governor's proposal (January 2025)",
                "The five regions in the Governor's January 2025 education transformation proposal, as coded by VCGI."),
    preset_from(lambda u: u["sba"], "School Board Association regions",
                "The Vermont School Boards Association regions, one of the scenarios the Agency of Education mapped for the Redistricting Task Force."),
    preset_from(lambda u: u["cte"], "Career and technical center regions",
                "Towns grouped by the career and technical center that serves them. A 13-district CTE-based map was the one proposal the Task Force voted on in November 2025."),
    preset_from(lambda u: u["county"], "Counties", "Vermont's 14 counties."),
]

STATE = outline(unary_union(list(land.values())).buffer(50).buffer(-50), 150)
data = dict(state=STATE, 
    meta=dict(built="2026-10-27", studentsYear="2024–25", acs="ACS 2020–2024 5-year", glNote="Equalized education grand list (Act 73 basis), $ thousands", links=links),
    units=U, schools=SCH, presets=presets, edges=EDGES,
)
json.dump(data, open(f"{OUT}/data.json", "w"), separators=(",", ":"), ensure_ascii=False)
print("edges drawn", len(EDGES)); print("towns", len(U), "schools", len(SCH), "links", links, "edges", sum(len(u["nb"]) for u in U) // 2)
print("students", sum(u["st"] for u in U), "child pov", sum(u["pb"] for u in U) / sum(u["pt"] for u in U))
for p in presets: print(p["name"], len(p["names"]))
