# -*- coding: utf-8 -*-
"""Fetch real Houma, LA geometry for the Houma tab's 3D world (free public sources only).

Terrebonne Parish GIS (gis.tpcg.org Assessors_Map FeatureServer):
  0  Parcel polygons (ANACCT joins data/houma-parcels rows by "id")
  18 Houma city limits (sets the world extent)
  27 StreetCenterline (real road geometry, names, ROAD_CLASS)
  28 Structures (building footprints, ANACCT)
  29 Waterbodies
OpenStreetMap (0.6 map API, tiled): waterways/water areas (Bayou Terrebonne, GIWW, Bayou Black...),
bridges, wetlands, parks, and point-of-interest tags (churches, government, schools) used for land use.

Output: data/houma-gis/*.json, every file < 1 MB. Coordinates are local meters in the same
equirectangular frame js/houma.js uses (origin 29.59007223,-90.72057; +x east, +y south),
stored as integer decimeters, delta-encoded per ring: [x0,y0,dx1,dy1,...].
"""
from __future__ import annotations
import json, math, re, sys, time, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "houma-gis"
O_LAT, O_LON = 29.59007223, -90.72057
FS = "https://gis.tpcg.org/server/rest/services/Assessor/Assessors_Map/FeatureServer"
UA = {"User-Agent": "1000-paintings-houma-map/2.0"}
CHUNK = 900_000


def xy(lon, lat):
    return ((lon - O_LON) * 111320.0 * math.cos(math.radians(O_LAT)), (O_LAT - lat) * 110540.0)


def get(url, data=None, tries=5):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers=UA)
            with urllib.request.urlopen(req, timeout=180) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:  # noqa
            print("retry", i, url[:120], e, file=sys.stderr); time.sleep(3 + i * 4)
    raise RuntimeError(url)


def dp(pts, tol):
    if len(pts) < 3: return pts
    a, b = pts[0], pts[-1]; dx, dy = b[0] - a[0], b[1] - a[1]; L = math.hypot(dx, dy)
    best, bi = -1, 0
    for i in range(1, len(pts) - 1):
        p = pts[i]
        d = abs(dy * (p[0] - a[0]) - dx * (p[1] - a[1])) / L if L > 1e-9 else math.hypot(p[0] - a[0], p[1] - a[1])
        if d > best: best, bi = d, i
    if best <= tol: return [a, b]
    return dp(pts[: bi + 1], tol)[:-1] + dp(pts[bi:], tol)


def enc(pts, closed):
    if closed and len(pts) > 2 and pts[0] == pts[-1]: pts = pts[:-1]
    q = [(round(x * 10), round(y * 10)) for x, y in pts]
    out, px, py = [], 0, 0
    for i, (x, y) in enumerate(q):
        if i and x == px and y == py: continue
        out += [x, y] if not out else [x - px, y - py]; px, py = x, y
    return out


def ring_area(r):
    return abs(sum(r[i][0] * r[i - 1][1] - r[i - 1][0] * r[i][1] for i in range(len(r)))) / 2


CACHE = Path("/tmp/houma-gis-cache")


def layer(lid, fields, env, extra=""):
    CACHE.mkdir(exist_ok=True); cf = CACHE / f"layer{lid}-gh.json"
    if cf.exists(): return json.loads(cf.read_text())
    feats = _layer(lid, fields, env)
    cf.write_text(json.dumps(feats)); return feats


def _layer(lid, fields, env):
    base = f"{FS}/{lid}/query"
    q = dict(where="1=1", geometry=env, geometryType="esriGeometryEnvelope", inSR="4326", spatialRel="esriSpatialRelIntersects", f="json")
    ids = get(base + "?" + urllib.parse.urlencode({**q, "returnIdsOnly": "true"}))["objectIds"] or []
    ids.sort(); pages = [ids[i:i + 500] for i in range(0, len(ids), 500)]
    def one(pg):
        body = urllib.parse.urlencode(dict(objectIds=",".join(map(str, pg)), outFields=fields, outSR="4326", geometryPrecision="7", returnGeometry="true", f="json")).encode()
        return get(base, data=body).get("features", [])
    feats = []
    with ThreadPoolExecutor(6) as ex:
        for r in ex.map(one, pages): feats += r
    print("layer", lid, len(feats), file=sys.stderr)
    return feats


def write_parts(name, rows, fields):
    parts, cur, size = [], [], 0
    for r in rows:
        s = len(json.dumps(r, separators=(",", ":"))) + 1
        if cur and size + s > CHUNK: parts.append(cur); cur, size = [], 0
        cur.append(r); size += s
    if cur: parts.append(cur)
    for i, p in enumerate(parts):
        (OUT / f"{name}-{i}.json").write_text(json.dumps({"fields": fields, "rows": p}, separators=(",", ":")))
    return len(parts)


def osm_api(bbox, name="osm-gh"):
    """OSM 0.6 map API in small tiles (free; Overpass mirrors are often overloaded). Returns Overpass-like elements."""
    import xml.etree.ElementTree as ET
    CACHE.mkdir(exist_ok=True); cf = CACHE / f"{name}.json"
    if cf.exists(): return json.loads(cf.read_text())
    s, w, n, e = bbox; step = 0.02; nodes, ways, rels = {}, {}, {}
    lat = s
    while lat < n:
        lon = w
        while lon < e:
            url = f"https://api.openstreetmap.org/api/0.6/map?bbox={lon:.4f},{lat:.4f},{min(e, lon + step):.4f},{min(n, lat + step):.4f}"
            for k in range(6):
                try:
                    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=180) as r: xml = r.read()
                    break
                except Exception as ex: print("osm retry", url, ex, file=sys.stderr); time.sleep(5)
            else: raise RuntimeError(url)
            root = ET.fromstring(xml)
            for nd in root.findall("node"):
                tags = {t.attrib["k"]: t.attrib["v"] for t in nd.findall("tag")}
                nodes[nd.attrib["id"]] = (float(nd.attrib["lon"]), float(nd.attrib["lat"]), tags)
            for wy in root.findall("way"):
                ways[wy.attrib["id"]] = ([x.attrib["ref"] for x in wy.findall("nd")], {t.attrib["k"]: t.attrib["v"] for t in wy.findall("tag")})
            for rl in root.findall("relation"):
                rels[rl.attrib["id"]] = ([(m.attrib["ref"], m.attrib.get("role")) for m in rl.findall("member") if m.attrib["type"] == "way"], {t.attrib["k"]: t.attrib["v"] for t in rl.findall("tag")})
            print("osm tile", lat, lon, len(nodes), len(ways), file=sys.stderr); time.sleep(1)
            lon += step
        lat += step
    def wgeom(refs): return [{"lon": nodes[r][0], "lat": nodes[r][1]} for r in refs if r in nodes]
    els = []
    for nid, (lo, la, tags) in nodes.items():
        if tags: els.append({"type": "node", "lon": lo, "lat": la, "tags": tags})
    for wid, (refs, tags) in ways.items():
        if tags: els.append({"type": "way", "geometry": wgeom(refs), "tags": tags})
    for rid, (mem, tags) in rels.items():
        if tags.get("natural") == "water" or tags.get("waterway"):
            els.append({"type": "relation", "tags": tags, "members": [{"role": ro, "geometry": wgeom(ways[r][0])} for r, ro in mem if r in ways]})
    for el in els:
        if el["type"] == "way" and el["geometry"]:
            el["bounds"] = {"minlon": min(g["lon"] for g in el["geometry"]), "maxlon": max(g["lon"] for g in el["geometry"]), "minlat": min(g["lat"] for g in el["geometry"]), "maxlat": max(g["lat"] for g in el["geometry"])}
    cf.write_text(json.dumps({"elements": els})); return {"elements": els}


LANDMARKS = [  # key, regex on OSM name, preferred tag test
    ("tunnel", r"Houma Tunnel|Tunnel", lambda t: t.get("tunnel") in ("yes", "building_passage") and t.get("highway")),
    ("mall", r"^Southland Mall$", lambda t: t.get("shop") == "mall"),
    ("hospital", r"Terrebonne General", None),
    ("college", r"Fletcher", None),
    ("courthouse", r"Courthouse", lambda t: t.get("amenity") == "courthouse"),
    ("cathedral", r"St\.? Francis de Sales|Saint Francis de Sales", None),
    ("airport", r"Houma.Terrebonne Airport|Houma-Terrebonne", lambda t: t.get("aeroway") == "aerodrome"),
    ("plaza", r"Shopping Center|Strip Mall|Plaza|Marketplace", lambda t: t.get("shop") == "mall" or t.get("landuse") == "retail"),
    ("walmart", r"Walmart", None),
    ("sams", r"Sam's Club", None),
    ("target", r"^Target$", None),
    ("lowes", r"Lowe's", None),
    ("hobby", r"Home Depot", None),
]
MAJOR = re.compile(r"^(motorway|trunk|primary|secondary|tertiary)(_link)?$")


def wanted(t):
    return bool(re.match(r"river|canal|stream|drain|ditch", t.get("waterway", "")) or t.get("natural") in ("water", "wetland") or (t.get("bridge") == "yes" and t.get("highway"))
                or re.match(r"park|pitch|playground|golf_course|sports_centre", t.get("leisure", "")) or re.match(r"cemetery|grass|recreation_ground|forest|meadow|industrial|commercial|retail", t.get("landuse", ""))
                or re.match(r"place_of_worship|townhall|courthouse|police|fire_station|school|library|hospital|post_office|college", t.get("amenity", "")) or t.get("office") == "government")


GH = (-90.86, 29.50, -90.58, 29.68)  # greater Houma: city, Bayou Cane, Bayou Blue, Gray edge, Mechanicville, Ashland, Bourg edge, airport


def hw_of(cls, lanes, oneway):
    base = {"motorway": 7.6, "trunk": 7.6, "primary": 7.2, "secondary": 6.0, "tertiary": 4.6, "motorway_link": 3.6, "trunk_link": 3.6, "primary_link": 3.4, "secondary_link": 3.2, "tertiary_link": 3.0}
    if lanes: return max(2.6, lanes * 1.75 + 0.6)
    h = base.get(cls, 3.5)
    return h / 2 + 1 if oneway and not cls.endswith("link") else h


def main():
    from shapely.geometry import LineString, Polygon, Point
    from shapely.strtree import STRtree
    from shapely.ops import unary_union
    OUT.mkdir(parents=True, exist_ok=True)
    W, S_, E, N = GH
    env = f"{W},{S_},{E},{N}"
    x0, y1 = xy(W, S_); x1, y0 = xy(E, N)
    bounds = [math.floor(x0), math.floor(y0), math.ceil(x1), math.ceil(y1)]
    city = []
    for f in get(f"{FS}/18/query?" + urllib.parse.urlencode(dict(where="1=1", outSR="4326", geometryPrecision="6", f="json")))["features"]:
        for r in f["geometry"]["rings"]:
            p = dp([xy(*c) for c in r], 3.0)
            if len(p) > 3: city.append(enc(p, True))
    osm = osm_api((S_, W, N, E))
    els = osm["elements"]
    # ---------------- roads: OSM majors (split at shared nodes so the route graph keeps its junctions) + parish centerlines not duplicating them
    hwy = [e for e in els if e["type"] == "way" and MAJOR.match(e.get("tags", {}).get("highway", "")) and len(e.get("geometry", [])) > 1]
    use = {}
    for e in els:
        if e["type"] == "way" and e.get("tags", {}).get("highway") and len(e.get("geometry", [])) > 1:
            for g in e["geometry"]: k = (g["lon"], g["lat"]); use[k] = use.get(k, 0) + 1
    roads, major_lines = [], []
    for e in hwy:
        t = e["tags"]; cls = t["highway"]; g = e["geometry"]
        lanes = int(re.match(r"\d+", t.get("lanes", "0") or "0").group(0)) if re.match(r"\d+", t.get("lanes", "") or "") else 0
        one = 1 if t.get("oneway") in ("yes", "1", "true") else 0
        lvl = int(t.get("layer", "1") or 1) if t.get("bridge") not in (None, "no") else (-1 if t.get("tunnel") in ("yes",) else 0)
        nm = t.get("name", ""); ref = t.get("ref", "")
        cut = [0] + [i for i in range(1, len(g) - 1) if use.get((g[i]["lon"], g[i]["lat"]), 0) > 1] + [len(g) - 1]
        full = [xy(q["lon"], q["lat"]) for q in g]
        major_lines.append((LineString(full), hw_of(cls, lanes, one)))
        for a, b in zip(cut, cut[1:]):
            pts = dp(full[a:b + 1], 0.5)
            if len(pts) >= 2: roads.append([nm, cls, enc(pts, False), 1, lanes, one, lvl, ref])
    mbuf = unary_union([ln.buffer(h + 6) for ln, h in major_lines])
    kept = dropped = 0
    for f in layer(27, "FULL_NAME,ROAD_CLASS", env):
        g = f.get("geometry")
        if not g: continue
        at = f["attributes"]
        for pth in g["paths"]:
            ln = LineString([xy(*c) for c in pth])
            if ln.length < 1: continue
            if ln.intersection(mbuf).length > 0.6 * ln.length: dropped += 1; continue
            p = dp(list(ln.coords), 0.6)
            kept += 1; roads.append([(at.get("FULL_NAME") or "").strip(), int(at.get("ROAD_CLASS") or 0), enc(p, False), 0, 0, 0, 0, ""])
    print("parish roads kept", kept, "dropped as OSM duplicates", dropped, file=sys.stderr)
    # road polygons for building clipping (same half-widths the renderer uses + curb)
    PHW = {1: 7, 2: 7, 3: 5, 4: 3.5, 5: 3, 0: 2.3}
    rpolys = [ln.buffer(h + 0.8, cap_style=2) for ln, h in major_lines]
    for r in roads:
        if r[3] == 0:
            q = dec_py(r[2]); rpolys.append(LineString(q).buffer(PHW.get(r[1], 2.3) + 0.8, cap_style=2))
    rtree = STRtree(rpolys)
    # ---------------- OSM buildings (type / levels / height / roof) for matching
    ob = []
    for e in els:
        t = e.get("tags", {})
        if e["type"] == "way" and t.get("building") and len(e.get("geometry", [])) > 3:
            pts = [xy(q["lon"], q["lat"]) for q in e["geometry"]]
            try: pg = Polygon(pts).buffer(0)
            except Exception: continue
            if pg.is_empty or pg.area < 8: continue
            lv = t.get("building:levels"); ht = t.get("height")
            try: lv = float(lv) if lv else 0
            except ValueError: lv = 0
            try: ht = float(re.match(r"[\d.]+", ht).group(0)) if ht else 0
            except Exception: ht = 0
            ob.append((pg, t.get("building"), lv, ht, t.get("roof:shape", ""), t.get("roof:material", ""), t.get("name", "")))
    otree = STRtree([o[0] for o in ob]) if ob else None
    # ---------------- parcels
    lots = []
    for f in layer(0, "ANACCT", env):
        g = f.get("geometry"); a = f["attributes"].get("ANACCT")
        if not g: continue
        rings = [dp([xy(*c) for c in r], 0.25) for r in g["rings"]]
        rings = [r for r in rings if len(r) >= 4 and ring_area(r) > 4]
        if not rings: continue
        rings.sort(key=ring_area, reverse=True)
        lots.append([int(a) if a else 0, enc(rings[0], True)])
    # ---------------- structures: clip off any part inside a road, attach OSM attributes
    bl, clipped, moved, used_o = [], 0, 0, set()
    def emit(acct, pg, attrs):
        nonlocal clipped
        hits = [rpolys[i] for i in rtree.query(pg)]
        hits = [h for h in hits if h.intersects(pg)]
        if hits:
            pg2 = pg.difference(unary_union(hits))
            if pg2.is_empty: return
            if pg2.geom_type != "Polygon": pg2 = max(pg2.geoms, key=lambda z: z.area)
            if pg2.area < 0.5 * pg.area or pg2.area < 8: return
            pg = pg2.simplify(0.15); clipped += 1
        ring = list(pg.exterior.coords)
        if len(ring) >= 4: bl.append([acct, enc(ring, True)] + attrs)
    for f in layer(28, "ANACCT", env):
        g = f.get("geometry"); a = f["attributes"].get("ANACCT")
        if not g: continue
        for r in g["rings"]:
            p = dp([xy(*c) for c in r], 0.2)
            if len(p) < 4 or ring_area(p) <= 6: continue
            try: pg = Polygon(p).buffer(0)
            except Exception: continue
            if pg.is_empty: continue
            if pg.geom_type != "Polygon": pg = max(pg.geoms, key=lambda z: z.area)
            attrs = ["", 0, 0, ""]
            if otree is not None:
                c = pg.representative_point()
                for i in otree.query(c):
                    o = ob[i]
                    if o[0].contains(c):
                        used_o.add(int(i)); attrs = [o[1] if o[1] != "yes" else "", round(o[2] * 10) / 10, round(o[3]), (o[4][:6] + ("|" + o[5][:6] if o[5] else "")) if (o[4] or o[5]) else ""]
                        if o[6]: attrs.append(o[6])
                        break
            emit(int(a) if a else 0, pg, attrs)
    extra = 0
    for i, o in enumerate(ob):  # OSM-only buildings (no parish structure under them)
        if i in used_o: continue
        if otree is not None and any(True for _ in []): pass
        emit(0, o[0] if o[0].geom_type == "Polygon" else max(o[0].geoms, key=lambda z: z.area), [o[1] if o[1] != "yes" else "", o[2], o[3], o[4]] + ([o[6]] if o[6] else [])); extra += 1
    print("buildings", len(bl), "clipped at roads", clipped, "osm-only", extra, file=sys.stderr)
    # spatial ordering so each part file is a compact area
    key = lambda r: (r[1][1] // 20000, r[1][0] // 20000)
    lots.sort(key=key); bl.sort(key=key)
    # ---------------- water / bridges / green / poi
    wb = []
    for f in layer(29, "NAME,TYPE", env):
        g = f.get("geometry")
        if not g: continue
        for r in g["rings"]:
            p = dp([xy(*c) for c in r], 1.0)
            if len(p) >= 4: wb.append([f["attributes"].get("NAME") or "", "area", 0, enc(p, True)])
    water, bridges, green, poi = list(wb), [], [], []
    def geom(el):
        if el["type"] == "way" and el.get("geometry"): return [[xy(g["lon"], g["lat"]) for g in el["geometry"]]]
        if el["type"] == "relation":
            return [[xy(g["lon"], g["lat"]) for g in mbr["geometry"]] for mbr in el.get("members", []) if mbr.get("role") == "outer" and mbr.get("geometry")]
        return []
    def center(el):
        if el["type"] == "node": return xy(el["lon"], el["lat"])
        pts = [q for ring in geom(el) for q in ring]
        if not pts: return None
        return (sum(q[0] for q in pts) / len(pts), sum(q[1] for q in pts) / len(pts))
    for el in els:
        t = el.get("tags", {}); nm = t.get("name", "")
        if not wanted(t): continue
        if t.get("amenity") or t.get("office") == "government":
            c = center(el)
            if c: poi.append([t.get("amenity") or "government", nm, round(c[0], 1), round(c[1], 1)])
            continue
        for pts in geom(el):
            if len(pts) < 2: continue
            closed = len(pts) > 3 and pts[0] == pts[-1]
            if t.get("waterway"):
                wv = t["waterway"]; w = {"river": 40, "canal": 30, "stream": 10, "drain": 6, "ditch": 3}.get(wv, 6)
                if "Intracoastal" in nm: w = 90
                elif "Navigation" in nm: w = 70
                elif "Terrebonne" in nm: w = 22
                water.append([nm, wv, w, enc(dp(pts, 1.0), False)])
            elif t.get("natural") == "water":
                if closed: water.append([nm, "area", 0, enc(dp(pts, 1.0), True)])
            elif t.get("bridge") == "yes":
                bridges.append([nm, t.get("highway", ""), enc(dp(pts, 0.5), False)])
            elif closed:
                k = t.get("natural") or t.get("leisure") or t.get("landuse")
                green.append([k, nm, enc(dp(pts, 1.0), True)])
    # ---------------- landmarks (positions from OSM)
    marks, seen = [], set()
    for key_, rx, test in LANDMARKS:
        best = None
        for el in els:
            t = el.get("tags", {}); nm = t.get("name", "")
            if not nm or not re.search(rx, nm, re.I): continue
            if test and not test(t): continue
            if key_ == "plaza" and (t.get("highway") or t.get("amenity") or "Southland Mall" == nm): continue
            if t.get("highway") and key_ != "tunnel": continue
            rings = geom(el); c = center(el)
            if not c: continue
            area = max((ring_area(r) for r in rings if len(r) > 3), default=0)
            score = area + (1e9 if key_ == "tunnel" and t.get("tunnel") else 0)
            cand = (score, nm, c, rings, t)
            if key_ == "plaza":
                if (nm, round(c[0] / 50)) in seen: continue
                seen.add((nm, round(c[0] / 50)))
                if area > 800 or el["type"] == "node": marks.append([key_, nm, round(c[0], 1), round(c[1], 1), enc(dp(rings[0], 1.0), True) if rings else []])
                continue
            if not best or cand[0] > best[0]: best = cand
        if best:
            _, nm, c, rings, t = best
            ring = enc(dp(rings[0], 0.5), key_ != "tunnel") if rings and len(rings[0]) > 1 else []
            marks.append([key_, nm, round(c[0], 1), round(c[1], 1), ring])
            print("landmark", key_, nm, [round(v) for v in c], file=sys.stderr)
        else: print("landmark MISSING", key_, rx, file=sys.stderr)
    # not in OSM: placed on their parish assessor parcels (Terrebonne Parish Consolidated Government property)
    lot_by = {r[0]: r[1] for r in lots}
    for key_, nm, acct in (("auditorium", "Houma Municipal Auditorium", 41975), ("civic", "Houma-Terrebonne Civic Center", 43587)):
        if acct in lot_by:
            ring = dec_py(lot_by[acct]); c = (sum(q[0] for q in ring) / len(ring), sum(q[1] for q in ring) / len(ring))
            marks.append([key_, nm, round(c[0], 1), round(c[1], 1), lot_by[acct]]); print("landmark", key_, nm, [round(v) for v in c], "(parcel)", file=sys.stderr)
    aero = []
    for el in els:
        t = el.get("tags", {})
        if t.get("aeroway") in ("runway", "taxiway", "apron", "helipad") and el["type"] == "way" and el.get("geometry"):
            pts = [xy(q["lon"], q["lat"]) for q in el["geometry"]]
            w = float(re.match(r"[\d.]+", t.get("width", "0")).group(0)) if re.match(r"[\d.]+", t.get("width", "") or "") else (45 if t["aeroway"] == "runway" else 18)
            aero.append([t["aeroway"], t.get("ref", ""), round(w, 1), enc(dp(pts, 0.5), pts[0] == pts[-1] and len(pts) > 3)])
    meta = {
        "fetched": time.strftime("%Y-%m-%d"), "origin": [O_LAT, O_LON], "units": "decimeters, delta-encoded rings [x0,y0,dx,dy...]; +x east, +y south",
        "bounds": bounds, "city": city, "area": "greater Houma " + env,
        "sources": [f"{FS}/0", f"{FS}/18", f"{FS}/27", f"{FS}/28", f"{FS}/29", "OpenStreetMap contributors (ODbL), api.openstreetmap.org"],
        "parts": {"lots": write_parts("lots", lots, ["acct", "ring"]), "bldg": write_parts("bldg", bl, ["acct", "ring", "type", "levels", "height", "roof", "name"])},
        "counts": {"lots": len(lots), "bldg": len(bl), "roads": len(roads), "osm_roads": sum(1 for r in roads if r[3]), "water": len(water), "bridges": len(bridges), "green": len(green), "poi": len(poi), "landmarks": len(marks), "clipped": clipped},
    }
    for old in OUT.glob("*-*.json"):
        nm_, i_ = old.stem.rsplit("-", 1)
        if nm_ in meta["parts"] and int(i_) >= meta["parts"][nm_]: old.unlink()
    (OUT / "roads.json").write_text(json.dumps({"fields": ["name", "cls", "line", "src", "lanes", "oneway", "lvl", "ref"], "rows": roads}, separators=(",", ":")))
    (OUT / "water.json").write_text(json.dumps({"water": water, "bridges": bridges, "green": green, "poi": poi}, separators=(",", ":")))
    (OUT / "landmarks.json").write_text(json.dumps({"marks": marks, "aero": aero}, separators=(",", ":")))
    (OUT / "meta.json").write_text(json.dumps(meta, separators=(",", ":")))
    print(json.dumps(meta["counts"]), meta["parts"], bounds)


def dec_py(a):
    out, x, y = [], 0, 0
    for i in range(0, len(a), 2):
        x += a[i]; y += a[i + 1]; out.append((x / 10, y / 10))
    return out


if __name__ == "__main__":
    main()
