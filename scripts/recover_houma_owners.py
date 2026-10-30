#!/usr/bin/env python3
"""Second-chance owner lookup for Houma parcel records the Assessor Export can't return (resumable).
Targets (computed from the fetch_houma_parcels.py cache dir):
  * accounts on parcel polygons whose Export/GetInfo calls error server-side ("ServiceChannel ... Faulted")
  * accounts only in the GIS account table (FeatureServer/38) with no Export row
  * parcel polygons with no account number
Alternate lookups (all public, the Assessor map's own search):
  1. Export retried one account at a time (transient faults)
  2. site address from GIS: FeatureServer/38 EC_Address (by account) and FeatureServer/26 address points inside the polygon
     -> /Search/SearchByField?field=2 (Physical Address search) -> result rows (Parcel#, address, owner Name)
  3. FeatureServer/28 building footprints inside a no-account polygon that carry an account number -> Export
Writes CACHE/recovered.json: key ("acct:<n>" or "oid:<objectid>") -> {acct, owner, site, how}; done keys are skipped on rerun.
Usage: python3 scripts/recover_houma_owners.py CACHE_DIR
"""
import signal, socket, csv, io, json, os, re, sys, time, html, http.cookiejar, urllib.request, urllib.parse
FS = "https://gis.tpcg.org/server/rest/services/Assessor/Assessors_Map/FeatureServer"
MAP = "https://terrebonnemaps.azurewebsites.net"
UA = {"User-Agent": "logan7in.art Houma tab data cache (polite, resumable)"}
CD = sys.argv[1]
socket.setdefaulttimeout(60)
class Hang(Exception): pass
def _alarm(*a): raise Hang()
signal.signal(signal.SIGALRM, _alarm)
cj = http.cookiejar.CookieJar(); op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
def log(*a): print(time.strftime("%H:%M:%S"), *a, file=sys.stderr, flush=True)
def req(url, data=None, tries=3):
    for i in range(tries):
        try:
            r = urllib.request.Request(url, data=urllib.parse.urlencode(data).encode() if data else None, headers=UA)
            return op.open(r, timeout=90).read().decode("utf-8", "replace")
        except Exception as e:
            log("retry", i, url[:90], str(e)[:60])
            if i + 1 < tries: time.sleep(5 * (i + 1))
    return None
def gq(layer, **p):
    p.setdefault("f", "json"); t = req(f"{FS}/{layer}/query", p); time.sleep(0.3)
    try: return json.loads(t) if t else {}
    except ValueError: return {}
J = lambda n, d=None: json.load(open(f"{CD}/{n}")) if os.path.exists(f"{CD}/{n}") else d
L0, L38 = J("layer0.json"), J("layer38.json"); cache, info = J("export_cache.json", {}), J("info_cache.json", {})
RF = f"{CD}/recovered.json"; rec = J("recovered.json", {})
GF = f"{CD}/recover_geo.json"; geo = J("recover_geo.json", {})  # key -> {"addr": [...], "bacct": [...]}
def save(): json.dump(rec, open(RF, "w")); json.dump(geo, open(GF, "w"))
has_owner = lambda a: bool((cache.get(a) or {}).get("Name") or (info.get(a) or {}).get("Primary Owner"))
poly_acct = {}
for a in L0:
    k = (a.get("ACCT_NUMBER") or "").strip()
    if k: poly_acct.setdefault(k, []).append(a["OBJECTID"])
tab = sorted({(a.get("sANACCT") or "").strip() for a in L38} - set(poly_acct) - {""})
targets = [("acct:" + a, a, poly_acct[a]) for a in sorted(poly_acct) if not has_owner(a)]
targets += [("acct:" + a, a, []) for a in tab if not has_owner(a)]
targets += [("oid:%d" % a["OBJECTID"], None, [a["OBJECTID"]]) for a in L0 if not (a.get("ACCT_NUMBER") or "").strip()]
log("targets", len(targets), "already done", sum(1 for t in targets if t[0] in rec))
req(MAP + "/")
def export_one(a):
    t = req(MAP + "/Search/ExportToCsvWithExtraData", {"parcels": a, "fieldList": "1,5,6,4"}, tries=1); time.sleep(1.0)
    if not t or t.lstrip().startswith("<"): return None
    for row in csv.DictReader(io.StringIO(t.lstrip("\ufeff"))):
        if row.get("Parcel#", "").strip() == a: return row
    return None
SC = f"{CD}/search_cache.json"; scache = J("search_cache.json", {})
def addr_search(s):
    if s in scache: return scache[s]
    t = req(MAP + "/Search/SearchByField?" + urllib.parse.urlencode({"value": s, "field": 2})); time.sleep(1.0); rows = []
    if t:
        m = re.search(r'id="oneresult">\s*([^<]+)<', t)
        if m: rows = [[m.group(1).strip(), s, None]]
        for tr in re.findall(r'<tr[^>]*data-id="([^"]+)"[^>]*>(.*?)</tr>', t, re.S):
            c = [re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", x))).strip() for x in re.findall(r"<td[^>]*>(.*?)</td>", tr[1], re.S)]
            rows.append([tr[0].strip(), c[1] if len(c) > 1 else "", c[2] if len(c) > 2 else ""])
    scache[s] = rows; json.dump(scache, open(SC, "w")); return rows
norm = lambda s: re.sub(r"[^A-Z0-9]", "", (s or "").upper())
def owner_of(acct):
    if has_owner(acct): return (cache.get(acct) or {}).get("Name") or info[acct]["Primary Owner"], cache.get(acct)
    row = export_one(acct)
    if row: cache[acct] = row; return row.get("Name", ""), row
    return None, None
def geoinfo(key, acct, oids):
    if key in geo: return geo[key]
    g = {"addr": [], "bacct": []}
    if acct:
        for f in gq(38, where=f"sANACCT='{acct}'", outFields="EC_Address", returnGeometry="false").get("features", []):
            v = (f["attributes"].get("EC_Address") or "").strip(); m = re.match(r"^(.*?)\s+(\d[\w\-/]*)$", v)
            if m: g["addr"].append(f"{m.group(2)} {m.group(1).upper()}")
    for o in oids[:3]:
        pf = gq(0, objectIds=str(o), returnGeometry="true", outFields="OBJECTID").get("features", [])
        if not pf or not pf[0].get("geometry"): continue
        gm = json.dumps({**pf[0]["geometry"], "spatialReference": {"wkid": 102682}})
        for f in gq(26, geometry=gm, geometryType="esriGeometryPolygon", spatialRel="esriSpatialRelIntersects", outFields="MUN_NO,DIR,STREET,DESIGNATIO", returnGeometry="false", resultRecordCount=20, method="post").get("features", []):
            a = f["attributes"]; s = " ".join(x for x in [a.get("MUN_NO"), a.get("DIR"), a.get("STREET"), a.get("DESIGNATIO")] if x and str(x).strip())
            if a.get("MUN_NO") and s not in g["addr"]: g["addr"].append(s.upper())
        if not acct:
            for f in gq(28, geometry=gm, geometryType="esriGeometryPolygon", spatialRel="esriSpatialRelContains" if False else "esriSpatialRelWithin", outFields="ACCT_NUM,ANACCT", returnGeometry="false", resultRecordCount=20).get("features", []):
                v = f["attributes"].get("ANACCT"); v = str(int(v)) if isinstance(v, (int, float)) else (str(v).strip() if v else "")
                if v and v not in g["bacct"]: g["bacct"].append(v)
    geo[key] = g; return g
n = 0
for key, acct, oids in targets:
    if key in rec: continue
    r = {"acct": acct, "owner": "", "site": "", "how": ""}
    signal.alarm(300)
    try:
        if acct:
            o, row = owner_of(acct)
            if o: r.update(owner=o, how="export retry", row=row)
        if not r["owner"]:
            g = geoinfo(key, acct, oids)
            if g["addr"] and not r["site"]: r["site"] = " / ".join(g["addr"][:3])
            for s in sorted(dict.fromkeys(g["addr"]), key=lambda a: -len(a))[:4]:
                rows = addr_search(s)
                hit = [x for x in rows if acct and x[0] == acct and x[2]]
                if hit: r.update(owner=hit[0][2], how=f"address search ({s})"); break
                if True:
                    ids = sorted({x[0] for x in rows if norm(x[1]) == norm(s) or len(rows) == 1})
                    if len(ids) == 1:
                        o, row = owner_of(ids[0])
                        o = o or next((x[2] for x in rows if x[0] == ids[0] and x[2]), "")
                        if o: r.update(owner=o, acct=ids[0], how=(f"account retired/erroring; site {s} now on account {ids[0]}" if acct else f"address point {s} -> account {ids[0]}"), row=row); break
            if not r["owner"] and not acct and g["bacct"]:
                for b in g["bacct"][:2]:
                    o, row = owner_of(b)
                    if o: r.update(owner=o, acct=b, how=f"building footprint -> account {b}", row=row); break
    except Hang:
        log("hang, skipping for now", key); continue
    finally: signal.alarm(0)
    rec[key] = r; n += 1
    save()
    if n % 20 == 0: log(n, key, r["how"] or "-", "recovered so far", sum(1 for v in rec.values() if v["owner"]))
save()  # export cache left untouched: recovered rows live in recovered.json
log("done", len(rec), "with owner", sum(1 for v in rec.values() if v["owner"]))
