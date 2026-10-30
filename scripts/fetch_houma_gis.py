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
    CACHE.mkdir(exist_ok=True); cf = CACHE / f"layer{lid}.json"
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


def osm_api(bbox):
    """OSM 0.6 map API in small tiles (free; Overpass mirrors are often overloaded). Returns Overpass-like elements."""
    import xml.etree.ElementTree as ET
    CACHE.mkdir(exist_ok=True); cf = CACHE / "osm.json"
    if cf.exists(): return json.loads(cf.read_text())
    s, w, n, e = bbox; step = 0.02; nodes, ways, rels = {}, {}, {}
    lat = s
    while lat < n:
        lon = w
        while lon < e:
            url = f"https://api.openstreetmap.org/api/0.6/map?bbox={lon:.4f},{lat:.4f},{min(e, lon + step):.4f},{min(n, lat + step):.4f}"
            for k in range(4):
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


def wanted(t):
    return bool(re.match(r"river|canal|stream|drain|ditch", t.get("waterway", "")) or t.get("natural") in ("water", "wetland") or (t.get("bridge") == "yes" and t.get("highway"))
                or re.match(r"park|pitch|playground|golf_course|sports_centre", t.get("leisure", "")) or re.match(r"cemetery|grass|recreation_ground|forest|meadow|industrial|commercial|retail", t.get("landuse", ""))
                or re.match(r"place_of_worship|townhall|courthouse|police|fire_station|school|library|hospital|post_office|college", t.get("amenity", "")) or t.get("office") == "government")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    ext = get(f"{FS}/18/query?where=1%3D1&returnExtentOnly=true&outSR=4326&f=json")["extent"]
    m = 0.004
    W, S_, E, N = ext["xmin"] - m, ext["ymin"] - m, ext["xmax"] + m, ext["ymax"] + m
    env = f"{W},{S_},{E},{N}"
    x0, y1 = xy(W, S_); x1, y0 = xy(E, N)
    bounds = [math.floor(x0), math.floor(y0), math.ceil(x1), math.ceil(y1)]
    # city limits
    city = []
    for f in get(f"{FS}/18/query?" + urllib.parse.urlencode(dict(where="1=1", outSR="4326", geometryPrecision="6", f="json")))["features"]:
        for r in f["geometry"]["rings"]:
            p = dp([xy(*c) for c in r], 3.0)
            if len(p) > 3: city.append(enc(p, True))
    # parcels
    lots = []
    for f in layer(0, "ANACCT", env):
        g = f.get("geometry"); a = f["attributes"].get("ANACCT")
        if not g: continue
        rings = [dp([xy(*c) for c in r], 0.25) for r in g["rings"]]
        rings = [r for r in rings if len(r) >= 4 and ring_area(r) > 4]
        if not rings: continue
        rings.sort(key=ring_area, reverse=True)
        lots.append([int(a) if a else 0, enc(rings[0], True)])
    # structures
    bl = []
    for f in layer(28, "ANACCT", env):
        g = f.get("geometry"); a = f["attributes"].get("ANACCT")
        if not g: continue
        for r in g["rings"]:
            p = dp([xy(*c) for c in r], 0.2)
            if len(p) >= 4 and ring_area(p) > 6: bl.append([int(a) if a else 0, enc(p, True)])
    # streets
    roads = []
    for f in layer(27, "FULL_NAME,ROAD_CLASS", env):
        g = f.get("geometry")
        if not g: continue
        at = f["attributes"]
        for pth in g["paths"]:
            p = dp([xy(*c) for c in pth], 0.6)
            if len(p) >= 2: roads.append([(at.get("FULL_NAME") or "").strip(), int(at.get("ROAD_CLASS") or 0), enc(p, False)])
    wb = []
    for f in layer(29, "NAME,TYPE", env):
        g = f.get("geometry")
        if not g: continue
        for r in g["rings"]:
            p = dp([xy(*c) for c in r], 1.0)
            if len(p) >= 4: wb.append([f["attributes"].get("NAME") or "", "area", 0, enc(p, True)])
    # OSM
    osm = osm_api((S_, W, N, E)); osm["elements"] = [el for el in osm["elements"] if wanted(el.get("tags", {}))]
    water, bridges, green, poi = list(wb), [], [], []
    def geom(el):
        if el["type"] == "way" and el.get("geometry"): return [[xy(g["lon"], g["lat"]) for g in el["geometry"]]]
        if el["type"] == "relation":
            return [[xy(g["lon"], g["lat"]) for g in mbr["geometry"]] for mbr in el.get("members", []) if mbr.get("role") == "outer" and mbr.get("geometry")]
        return []
    for el in osm["elements"]:
        t = el.get("tags", {}); nm = t.get("name", "")
        if t.get("amenity") or t.get("office") == "government":
            kind = t.get("amenity") or "government"
            if el["type"] == "node": c = xy(el["lon"], el["lat"])
            else:
                b = el.get("bounds")
                if not b: continue
                c = xy((b["minlon"] + b["maxlon"]) / 2, (b["minlat"] + b["maxlat"]) / 2)
            poi.append([kind, nm, round(c[0], 1), round(c[1], 1)]); continue
        for pts in geom(el):
            if len(pts) < 2: continue
            closed = len(pts) > 3 and pts[0] == pts[-1]
            if t.get("waterway"):
                wv = t["waterway"]; w = {"river": 40, "canal": 30, "stream": 10, "drain": 6, "ditch": 3}.get(wv, 6)
                if "Intracoastal" in nm: w = 90
                elif "Terrebonne" in nm: w = 22
                water.append([nm, wv, w, enc(dp(pts, 1.0), False)])
            elif t.get("natural") == "water":
                if closed: water.append([nm, "area", 0, enc(dp(pts, 1.0), True)])
            elif t.get("bridge") == "yes":
                bridges.append([nm, t.get("highway", ""), enc(dp(pts, 0.5), False)])
            elif closed:
                k = t.get("natural") or t.get("leisure") or t.get("landuse")
                green.append([k, nm, enc(dp(pts, 1.0), True)])
    meta = {
        "fetched": time.strftime("%Y-%m-%d"), "origin": [O_LAT, O_LON], "units": "decimeters, delta-encoded rings [x0,y0,dx,dy...]; +x east, +y south",
        "bounds": bounds, "city": city,
        "sources": [f"{FS}/0", f"{FS}/18", f"{FS}/27", f"{FS}/28", f"{FS}/29", "OpenStreetMap contributors (ODbL), api.openstreetmap.org"],
        "parts": {"lots": write_parts("lots", lots, ["acct", "ring"]), "bldg": write_parts("bldg", bl, ["acct", "ring"])},
        "counts": {"lots": len(lots), "bldg": len(bl), "roads": len(roads), "water": len(water), "bridges": len(bridges), "green": len(green), "poi": len(poi)},
    }
    (OUT / "roads.json").write_text(json.dumps({"fields": ["name", "cls", "line"], "rows": roads}, separators=(",", ":")))
    (OUT / "water.json").write_text(json.dumps({"water": water, "bridges": bridges, "green": green, "poi": poi}, separators=(",", ":")))
    (OUT / "meta.json").write_text(json.dumps(meta, separators=(",", ":")))
    print(json.dumps(meta["counts"]), meta["parts"], bounds)


if __name__ == "__main__":
    main()
