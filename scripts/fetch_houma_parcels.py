#!/usr/bin/env python3
"""Fetch every Terrebonne Parish Assessor account/parcel from the Assessor's public map, flagged by Houma city limits and site ZIP.
Sources (all public, no login):
  parcels/centroids/area: https://gis.tpcg.org/server/rest/services/Assessor/Assessors_Map/FeatureServer/0 (Parcel, 55,548 polygons)
  extra accounts:         .../FeatureServer/38 (sde.ASSESSOR.ParcelAttributes, account table incl. accounts with no polygon)
  city limit polygon:     .../FeatureServer/18 (Houma City Limit)
  site ZIPs:              .../FeatureServer/26 (Address points, ZIPCODE) intersected with parcels
  owner/address/values:   https://terrebonnemaps.azurewebsites.net/Search/ExportToCsvWithExtraData (the map's own Export)
  fallbacks for accounts the export errors on: /Search/GetInfo, /Search/GetDeeds, /Search/GetParcelTaxes (the map's parcel popup)
  property class + units: /Search/GetInfo (only for accounts with no polygon / not in GIS; 1 request per account)
Account numbers absent from GIS are discovered by asking the Export for unseen numbers 1..MAXPROBE (it returns rows only for real accounts).
Polite: one connection, 1-1.5 s between requests, batches of 200. Resumable: all responses cached as JSON in CACHE dir.
Usage: python3 scripts/fetch_houma_parcels.py data/houma-parcels [cache_dir]
"""
import csv, io, json, sys, os, time, datetime, re, math, glob, html, http.cookiejar, urllib.request, urllib.parse
FS = "https://gis.tpcg.org/server/rest/services/Assessor/Assessors_Map/FeatureServer"
MAP = "https://terrebonnemaps.azurewebsites.net"
UA = {"User-Agent": "logan7in.art Houma tab data cache (polite, resumable)"}
OUT = sys.argv[1]; CD = sys.argv[2] if len(sys.argv) > 2 else "houma_cache"; os.makedirs(CD, exist_ok=True)
HOUMA_ZIPS = {"70360", "70363", "70364"}; MAXPROBE = int(os.environ.get("MAXPROBE", "0"))  # e.g. MAXPROBE=76000 to discover accounts absent from GIS (slow)
cj = http.cookiejar.CookieJar(); op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
def log(*a): print(*a, file=sys.stderr, flush=True)
def req(url, data=None, tries=4):
    for i in range(tries):
        try:
            r = urllib.request.Request(url, data=urllib.parse.urlencode(data, doseq=True).encode() if data else None, headers=UA)
            return op.open(r, timeout=90).read().decode("utf-8", "replace")
        except Exception as e:
            log("retry", i, str(e)[:80]); time.sleep(4 * (i + 1) if i + 1 < tries else 0)
    raise RuntimeError("failed " + url)
def q(layer, **p):
    p.setdefault("f", "json"); return json.loads(req(f"{FS}/{layer}/query", p))
def cached(name, fn):
    f = f"{CD}/{name}.json"
    if os.path.exists(f): return json.load(open(f))
    v = fn(); json.dump(v, open(f, "w")); return v
def page_all(layer, fields, where="1=1"):
    out, off = [], 0
    while True:
        d = q(layer, where=where, outFields=fields, returnGeometry="false", resultOffset=off, resultRecordCount=2000, orderByFields="OBJECTID")
        f = [x["attributes"] for x in d.get("features", [])]; out += f; off += len(f); time.sleep(0.7)
        if not f: return out
# 1) GIS: parcels, account table, city membership, ZIP per parcel
parcels = cached("layer0", lambda: page_all(0, "OBJECTID,ACCT_NUMBER,Latitude,Longitude,Shape__Area"))
acct_tab = cached("layer38", lambda: page_all(38, "OBJECTID,sANACCT"))
def city_ids():
    c = q(18, where="1=1", outFields="OBJECTID", returnGeometry="true")["features"][0]["geometry"]
    g = json.dumps({"rings": c["rings"], "spatialReference": {"wkid": 102682}})
    return q(0, geometry=g, geometryType="esriGeometryPolygon", spatialRel="esriSpatialRelIntersects", returnIdsOnly="true")["objectIds"]
city = set(cached("city_oids", city_ids))
def zips():
    zs = [a["attributes"]["ZIPCODE"] for a in q(26, where="ZIPCODE IS NOT NULL", outFields="ZIPCODE", returnDistinctValues="true", returnGeometry="false")["features"]]
    res = {}
    for z in sorted(zs, key=lambda z: (str(z) not in HOUMA_ZIPS, z)):  # Houma ZIPs win ties, as before
        pts, off = [], 0
        while True:
            d = q(26, where=f"ZIPCODE={z}", outFields="OBJECTID", returnGeometry="true", resultOffset=off, resultRecordCount=2000, orderByFields="OBJECTID")
            f = d.get("features", []); pts += [[x["geometry"]["x"], x["geometry"]["y"]] for x in f if x.get("geometry")]; off += len(f); time.sleep(0.7)
            if not f: break
        for i in range(0, len(pts), 1000):
            g = json.dumps({"points": pts[i:i+1000], "spatialReference": {"wkid": 102682}})
            for o in q(0, geometry=g, geometryType="esriGeometryMultipoint", spatialRel="esriSpatialRelIntersects", returnIdsOnly="true").get("objectIds") or []:
                res.setdefault(str(o), str(z))
            time.sleep(0.7)
        log("zip", z, len(pts), "points; tagged", len(res))
    return res
zipof = cached("zip_oids", zips)
recs, noacct = {}, []
for a in parcels:
    acct = (a.get("ACCT_NUMBER") or "").strip(); o = a["OBJECTID"]
    if not acct: noacct.append(a); continue
    r = recs.setdefault(acct, {"oids": [], "inCity": False, "zip": None, "area": 0, "lat": a.get("Latitude"), "lon": a.get("Longitude")})
    r["oids"].append(o); r["inCity"] |= o in city; r["zip"] = r["zip"] or zipof.get(str(o)); r["area"] += a.get("Shape__Area") or 0
tab_only = sorted({(a.get("sANACCT") or "").strip() for a in acct_tab} - set(recs) - {""}, key=lambda s: int(s) if s.isdigit() else 0)
log("parcels", len(parcels), "accounts on polygons", len(recs), "table-only accounts", len(tab_only), "no-account polygons", len(noacct))
# 2) Export owner data (resumable cache), then probe unseen account numbers
req(MAP + "/")
EC = f"{CD}/export_cache.json"; cache = json.load(open(EC)) if os.path.exists(EC) else {}
SK = f"{CD}/export_failed.json"; failed = set(json.load(open(SK))) if os.path.exists(SK) else set()
PR = f"{CD}/probed.json"; probed = set(json.load(open(PR))) if os.path.exists(PR) else set()
def export(ids):
    try:
        txt = req(MAP + "/Search/ExportToCsvWithExtraData", {"parcels": ",".join(ids), "fieldList": "1,5,6,4"}, tries=1)
        if txt.lstrip().startswith("<"): raise RuntimeError("html error page")
    except RuntimeError:
        time.sleep(1.5)
        if len(ids) == 1: failed.add(ids[0]); return
        h = len(ids) // 2; export(ids[:h]); export(ids[h:]); return
    for row in csv.DictReader(io.StringIO(txt.lstrip("\ufeff"))): cache[row["Parcel#"].strip()] = row
    probed.update(ids); time.sleep(1.0)
def save():
    json.dump(cache, open(EC, "w")); json.dump(sorted(failed), open(SK, "w")); json.dump(sorted(probed), open(PR, "w"))
def run(todo, label):
    for i in range(0, len(todo), 25):  # small batches: one bad account makes the whole export 500, so we bisect
        export(todo[i:i+25]); save()
        if i % 1000 == 0 or i + 25 >= len(todo):
            log(f"{label} {min(i+25, len(todo))}/{len(todo)} rows={len(cache)} failed={len(failed)}")
known = set(recs) | set(tab_only)
run([a for a in sorted(known) if a not in cache and a not in failed and a not in probed], "export")
run([str(n) for n in range(1, MAXPROBE) if str(n) not in known and str(n) not in probed and str(n) not in failed and str(n) not in cache], "probe")
retry = sorted(failed & known); failed -= set(retry); probed -= set(retry); run(retry, "retry-failed")  # second chance, one pass
discovered = sorted(set(cache) - known, key=lambda s: int(s) if s.isdigit() else 0)
failed_known = sorted(failed & known, key=int)
log("discovered (not in GIS)", len(discovered), "failed", failed_known)
# 3) Per-account popup pages: property class/units for no-polygon accounts; fallbacks for export failures
IC = f"{CD}/info_cache.json"; info = json.load(open(IC)) if os.path.exists(IC) else {}
def txt(s): return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", s))).strip()
def getinfo(a):
    out = {}
    try:
        h = req(MAP + "/Search/GetInfo?parcelNumber=" + a, tries=2)
        for k, v in re.findall(r"<t[dh][^>]*>\s*(Primary Owner|Physical Addr|Mailing Addr|Subdivision|Assessed Value|Legal|Book|Page|Sale Date|Sales Price)\s*</t[dh]>\s*<t[dh][^>]*>(.*?)</t[dh]>", h, re.S):
            out[k] = txt(v)
        cls = []
        for row in re.findall(r"<tr[^>]*>(.*?)</tr>", h.split("Property Class", 1)[1] if "Property Class" in h else "", re.S):
            c = [txt(x) for x in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)]; c = [x for x in c if x]
            if len(c) >= 3 and re.match(r"^[\d,.]+$", c[-1]) and re.match(r"^[\d,.]+$", c[-2]): cls.append([c[0], c[-2], c[-1]])
        out["classes"] = cls
        if "An error has occurred" in h and not out.get("Primary Owner"): out["error"] = True
    except RuntimeError: out["error"] = True
    if a in failed:
        try:
            d = req(MAP + "/Search/GetDeeds?parcelNumber=" + a, tries=2)
            rows = [[txt(x) for x in re.findall(r"<td[^>]*>(.*?)</td>", r, re.S)] for r in re.findall(r"<tr[^>]*>(.*?)</tr>", d, re.S)]
            out["deeds"] = [r for r in rows if len(r) >= 4 and re.match(r"\d+/\d+/\d{4}", r[1])]
        except RuntimeError: pass
        try: out["taxes"] = json.loads(req(MAP + "/Search/GetParcelTaxes?parcelid=" + a, tries=2))
        except Exception: pass
    return out
need = [a for a in failed_known + tab_only + discovered if a not in info]
for i, a in enumerate(need):
    info[a] = getinfo(a); time.sleep(1.0)
    if i % 50 == 0 or i == len(need) - 1: json.dump(info, open(IC, "w")); log(f"info {i+1}/{len(need)}")
# GIS address-point text (EC_Address, layer 38) as a site-address fallback for accounts the assessor endpoints error on
def ec_addr():
    res = {}
    for i in range(0, len(failed_known), 100):
        ids = ",".join("'%s'" % a for a in failed_known[i:i+100])
        for f in q(38, where=f"sANACCT IN ({ids})", outFields="sANACCT,EC_Address", returnGeometry="false").get("features", []):
            a = f["attributes"]; v = (a.get("EC_Address") or "").strip()
            if v: res.setdefault(a["sANACCT"], []).append(v)
        time.sleep(0.7)
    return res
ecaddr = ec_addr()
# 4) Build records
def num(row, k):
    v = (row.get(k) or "").strip()
    try: v = float(v.replace(",", ""))
    except ValueError: return None
    return v if v >= 0 else None
UNIT_RE = re.compile(r"\b(UNIT|APT|STE|SUITE|BLDG|CONDO\w*)\b|#\s*\w+", re.I)
MH_RE = re.compile(r"\b(MOBILE|MANUFACTURED|M/H|TRAILER)\b", re.I)
def kind_of(site, subdiv, classes, legal):
    t = " ".join([site or "", subdiv or "", legal or ""] + [c[0] for c in classes])
    if MH_RE.search(t): return "mobile home"
    if re.search(r"CONDO|TOWNHOME|\bUNIT\b", t, re.I) or UNIT_RE.search(site or ""): return "condo/unit"
    if classes and all(re.search(r"MOVABLE|INVENTOR|BUSINESS|FURN|FIXTURE|MACHIN|EQUIP|VESSEL|BOAT|OIL|GAS|WELL|PIPE|LEASE", c[0], re.I) for c in classes): return "business/movable"
    return "real property"
def rec(pid, row, g, src):
    inf = info.get(pid, {}); classes = inf.get("classes", [])
    site = re.sub(r"\s+", " ", row.get("PhysAddress") or inf.get("Physical Addr", "")).strip()
    m = re.match(r"^\s*([\d\-A-Z]*\d[\dA-Z\-]*(?:\s+1/2)?)\s+(.*)$", site)
    street = re.sub(r"^(#\S+|UNIT \S+|APT \S+)\s+", "", (m.group(2) if m else site)).strip()
    mail = re.sub(r"\s*\n\s*", ", ", (row.get("Mailing") or inf.get("Mailing Addr", "")).strip())
    subdiv = (row.get("Subdivision") or inf.get("Subdivision", "")).strip()
    z = g.get("zip") if g else None
    if not z:  # no polygon: fall back to the site address ZIP is unknown; use nothing (mailing ZIP is not the site)
        z = None
    units = None
    if classes:
        u = [float(c[2].replace(",", "")) for c in classes if re.search(r"UNIT|APART|DWELL|CONDO|MOBILE", c[0], re.I)]
        units = sum(u) if u else None
    return {"id": pid, "owner": re.sub(r"\s+", " ", row.get("Name") or inf.get("Primary Owner", "")).strip(), "site": site, "street": street, "mail": mail,
        "subdiv": subdiv, "book": (row.get("Book") or inf.get("Book", "")).strip(), "page": (row.get("Page") or inf.get("Page", "")).strip(),
        "assessed": num(row, "Assmt.") if row else num({"a": inf.get("Assessed Value", "")}, "a"), "land": num(row, "Land Assmt."), "bldg": num(row, "Building Assmt."), "sqft": num(row, "Sqft"),
        "acres": round(g["area"] / 43560, 3) if g and g.get("area") else None,
        "lat": round(g["lat"], 6) if g and g.get("lat") else None, "lon": round(g["lon"], 6) if g and g.get("lon") else None,
        "zip": z, "city": "HOUMA" if g and g.get("inCity") else ("HOUMA AREA" if z in HOUMA_ZIPS else "PARISH"),
        "kind": kind_of(site, subdiv, classes, inf.get("Legal")), "cls": "; ".join(f"{c[0]} ({c[2]})" for c in classes) or None, "units": units, "src": src}
out = []
for pid, g in recs.items():
    if pid in cache: out.append(rec(pid, cache[pid], g, "export"))
    else:
        r = rec(pid, {}, g, "popup-fallback" if info.get(pid, {}).get("Primary Owner") else "gis-only (export & popup error)")
        inf = info.get(pid, {}); d = inf.get("deeds") or []; t = inf.get("taxes") or {}
        if not r["site"] and ecaddr.get(pid):
            parts = [re.match(r"^(.*?)\s+(\S+)$", x) for x in dict.fromkeys(ecaddr[pid])]
            r["site"] = " / ".join(f"{m.group(2)} {m.group(1).upper()}" if m else x for m, x in zip(parts, dict.fromkeys(ecaddr[pid])))
            r["street"] = (parts[0].group(1).upper() if parts[0] else r["site"])
        if not r["book"] and d: r["note"] = f"latest deed {d[0][1]} {d[0][2]}"
        if t.get("ParishTaxes") is not None: r["note"] = (r.get("note", "") + f"; est. parish tax ${t['ParishTaxes']}, homestead {t.get('Homestead')}").strip("; ")
        out.append(r)
for pid in tab_only:
    out.append(rec(pid, cache.get(pid, {}), None, "account table (no polygon)"))
for pid in discovered:
    out.append(rec(pid, cache[pid], None, "export (not in GIS)"))
for a in noacct:
    o = a["OBJECTID"]
    out.append({"id": f"OID-{o}", "owner": "", "site": "", "street": "", "mail": "", "subdiv": "", "book": "", "page": "", "assessed": None, "land": None, "bldg": None, "sqft": None,
        "acres": round(a["Shape__Area"] / 43560, 3) if a.get("Shape__Area") else None, "lat": round(a["Latitude"], 6) if a.get("Latitude") else None,
        "lon": round(a["Longitude"], 6) if a.get("Longitude") else None, "zip": zipof.get(str(o)),
        "city": "HOUMA" if o in city else ("HOUMA AREA" if zipof.get(str(o)) in HOUMA_ZIPS else "PARISH"), "kind": "no account #", "cls": None, "units": None, "src": "parcel polygon, no account number"})
# 5) Shard by scope so the table can lazy-load: city -> Houma ZIPs outside city -> rest of parish
F = ["id", "owner", "site", "street", "mail", "subdiv", "book", "page", "assessed", "land", "bldg", "sqft", "acres", "lat", "lon", "zip", "city", "kind", "cls", "units", "src", "note"]
os.makedirs(OUT, exist_ok=True)
for f in glob.glob(f"{OUT}/part-*.json"): os.remove(f)
groups = [("city", [p for p in out if p["city"] == "HOUMA"]), ("houma-zip", [p for p in out if p["city"] == "HOUMA AREA"]), ("parish", [p for p in out if p["city"] == "PARISH"])]
parts, n = [], 0
for gname, ps in groups:
    ps.sort(key=lambda p: (p["street"], p["site"]))
    for i in range(0, len(ps), 2000):
        rows = [[p.get(k) for k in F] for p in ps[i:i+2000]]
        fn = f"part-{n}.json"; json.dump({"fields": F, "rows": rows}, open(f"{OUT}/{fn}", "w"), separators=(",", ":"))
        assert os.path.getsize(f"{OUT}/{fn}") < 1_000_000, fn
        parts.append({"file": fn, "scope": gname, "rows": len(rows)}); n += 1
from collections import Counter
meta = {"fetched": datetime.date.today().isoformat(),
    "area": "All of Terrebonne Parish. city = inside Houma city limits (FeatureServer/18); houma-zip = outside city limits with a 70360/70363/70364 site address point; parish = everything else",
    "sources": [FS + "/0", FS + "/18", FS + "/26", FS + "/38", MAP + "/Search/ExportToCsvWithExtraData", MAP + "/Search/GetInfo", MAP + "/Search/GetDeeds", MAP + "/Search/GetParcelTaxes"],
    "note": "Public Terrebonne Parish Assessor data, informational only, provided as-is (see site disclaimer). Acres from parcel polygon area; sqft = building living area. Assessed values in USD (Louisiana assessed, not market). Assessor records list owners only; tenants are not public and are not included. Units only where the assessor lists them.",
    "count": len(out), "counts": {"scope": dict(Counter(p["city"] for p in out)), "kind": dict(Counter(p["kind"] for p in out)), "src": dict(Counter(p["src"] for p in out))},
    "export_failed": failed_known, "parts": len(parts), "partList": parts, "fields": F, "houmaZips": sorted(HOUMA_ZIPS),
    "zips": sorted({p["zip"] for p in out if p["zip"]})}
json.dump(meta, open(f"{OUT}/meta.json", "w"), indent=1)
log("wrote", len(out), json.dumps(meta["counts"]))
