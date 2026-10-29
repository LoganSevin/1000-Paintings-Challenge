#!/usr/bin/env python3
"""Fetch Houma parcels (city limits + every parish parcel whose site address point has a Houma ZIP 70360/70363/70364) from the Terrebonne Parish Assessor public map.
Sources:
  geometry/centroids: https://gis.tpcg.org/server/rest/services/Assessor/Assessors_Map/FeatureServer/0 (Parcels)
  city limit polygon: .../FeatureServer/18 (Houma City Limit)
  address points (ZIPCODE): .../FeatureServer/26 (parcels intersecting Houma-ZIP points)
  owner/address/values: https://terrebonnemaps.azurewebsites.net/Search/ExportToCsvWithExtraData (the map's own Export feature)
Polite: batches, sleeps between requests, single connection. Usage: python3 scripts/fetch_houma_parcels.py data/houma-parcels  (cache: export_cache.json in cwd, resumable)
"""
import csv, io, json, sys, time, datetime, re, http.cookiejar, urllib.request, urllib.parse
FS = "https://gis.tpcg.org/server/rest/services/Assessor/Assessors_Map/FeatureServer"
MAP = "https://terrebonnemaps.azurewebsites.net"
UA = {"User-Agent": "logan7in.art Houma tab data cache (one-off, polite)"}
cj = http.cookiejar.CookieJar(); op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
def req(url, data=None, tries=4):
    for i in range(tries):
        try:
            r = urllib.request.Request(url, data=urllib.parse.urlencode(data, doseq=True).encode() if data else None, headers=UA)
            return op.open(r, timeout=90).read().decode("utf-8", "replace")
        except Exception as e:
            print("retry", i, e, file=sys.stderr); time.sleep(5 * (i + 1))
    raise RuntimeError("failed " + url)
def q(layer, **p):
    p.setdefault("f", "json"); return json.loads(req(f"{FS}/{layer}/query", p))
city = q(18, where="1=1", outFields="OBJECTID", returnGeometry="true")["features"][0]["geometry"]
geo = json.dumps({"rings": city["rings"], "spatialReference": {"wkid": 102682}})
ids = sorted(q(0, geometry=geo, geometryType="esriGeometryPolygon", spatialRel="esriSpatialRelIntersects", returnIdsOnly="true")["objectIds"])
city_ids = set(ids); zipof = {}
for z in (70360, 70363, 70364):
    pts = []; off = 0
    while True:
        d = q(26, where=f"ZIPCODE={z}", outFields="OBJECTID", returnGeometry="true", resultOffset=off, resultRecordCount=2000, orderByFields="OBJECTID")
        f = d.get("features", []); pts += [[x["geometry"]["x"], x["geometry"]["y"]] for x in f if x.get("geometry")]
        off += len(f); time.sleep(0.7)
        if len(f) < 2000 and not d.get("exceededTransferLimit"): break
    for i in range(0, len(pts), 1000):
        g = json.dumps({"points": pts[i:i+1000], "spatialReference": {"wkid": 102682}})
        for o in q(0, geometry=g, geometryType="esriGeometryMultipoint", spatialRel="esriSpatialRelIntersects", returnIdsOnly="true").get("objectIds") or []:
            zipof.setdefault(o, z)
        time.sleep(0.7)
ids = sorted(city_ids | set(zipof))
print("parcels: city", len(city_ids), "houma-zip", len(zipof), "union", len(ids), file=sys.stderr)
recs = {}
for i in range(0, len(ids), 500):
    d = q(0, objectIds=",".join(map(str, ids[i:i+500])), outFields="OBJECTID,ACCT_NUMBER,Latitude,Longitude,Shape__Area", returnGeometry="false")
    for f in d["features"]:
        a = f["attributes"]
        if a["ACCT_NUMBER"]:
            r = recs.setdefault(a["ACCT_NUMBER"].strip(), dict(a, inCity=False, zip=None))
            r["inCity"] = r["inCity"] or a["OBJECTID"] in city_ids; r["zip"] = r["zip"] or zipof.get(a["OBJECTID"])
    time.sleep(1)
print("accounts:", len(recs), file=sys.stderr)
req(MAP + "/")  # session cookie
import os
CACHE = "export_cache.json"; cache = json.load(open(CACHE)) if os.path.exists(CACHE) else {}
skipped = []
def export(ids):
    try:
        txt = req(MAP + "/Search/ExportToCsvWithExtraData", {"parcels": ",".join(ids), "fieldList": "1,5,6,4"}, tries=2 if len(ids) > 1 else 3)
    except RuntimeError:
        time.sleep(3)
        if len(ids) == 1: skipped.append(ids[0]); return
        h = len(ids) // 2; export(ids[:h]); export(ids[h:]); return
    for row in csv.DictReader(io.StringIO(txt.lstrip("\ufeff"))): cache[row["Parcel#"].strip()] = row
    time.sleep(1.5)
todo = [a for a in recs if a not in cache]; B = 200
for i in range(0, len(todo), B):
    export(todo[i:i+B]); json.dump(cache, open(CACHE, "w"))
    print(f"{min(i+B,len(todo))}/{len(todo)} skipped={len(skipped)}", file=sys.stderr)
out = []
for pid, row in cache.items():
        if pid not in recs: continue
        a = recs[pid]
        mail = re.sub(r"\s*\n\s*", ", ", row.get("Mailing", "").strip())
        site = re.sub(r"\s+", " ", row.get("PhysAddress", "")).strip()
        m = re.match(r"^\s*([\d\-A-Z]*\d[\dA-Z\-]*(?:\s+1/2)?)\s+(.*)$", site)
        street = re.sub(r"^(#\S+|UNIT \S+|APT \S+)\s+", "", (m.group(2) if m else site)).strip()
        num = lambda k: (lambda v: v if v is not None and v >= 0 else None)(float(row[k]) if (row.get(k) or "").strip() else None)
        out.append({"id": pid, "owner": re.sub(r"\s+", " ", row["Name"]).strip(), "site": site, "street": street, "mail": mail,
            "subdiv": row.get("Subdivision", "").strip(), "book": row.get("Book", "").strip(), "page": row.get("Page", "").strip(),
            "assessed": num("Assmt."), "land": num("Land Assmt."), "bldg": num("Building Assmt."), "sqft": num("Sqft"),
            "acres": round(a["Shape__Area"] / 43560, 3) if a.get("Shape__Area") else None,
            "lat": round(a["Latitude"], 6) if a.get("Latitude") else None, "lon": round(a["Longitude"], 6) if a.get("Longitude") else None,
            "zip": str(a["zip"]) if a.get("zip") else None, "city": "HOUMA" if a.get("inCity") else "HOUMA AREA"})
print("skipped (server error):", skipped, file=sys.stderr)
meta = {"fetched": datetime.date.today().isoformat(), "area": "Houma city limits (FeatureServer/18) + parish parcels with a Houma-ZIP (70360/70363/70364) address point (FeatureServer/26)",
        "sources": [FS + "/0", FS + "/18", FS + "/26", MAP + "/Search/ExportToCsvWithExtraData"],
        "note": "Public Terrebonne Parish Assessor data, informational only, provided as-is (see site disclaimer). Acres computed from parcel polygon area (ft^2/43560); sqft = building living area. Assessed values in USD (Louisiana assessed, not market).",
        "count": len(out), "skipped_server_errors": skipped}
# Write as small shards (data/houma-parcels/meta.json + part-N.json) so each file stays well under 1 MB.
import math, glob
outdir = sys.argv[1]; os.makedirs(outdir, exist_ok=True)
for f in glob.glob(f"{outdir}/part-*.json"): os.remove(f)
F = ["id", "owner", "site", "street", "mail", "subdiv", "book", "page", "assessed", "land", "bldg", "sqft", "acres", "lat", "lon", "zip", "city"]
rows = [[p[k] for k in F] for p in out]; n = max(1, math.ceil(len(rows) / 2500)); sz = math.ceil(len(rows) / n)
for i in range(n):
    json.dump({"fields": F, "rows": rows[i * sz:(i + 1) * sz]}, open(f"{outdir}/part-{i}.json", "w"), separators=(",", ":"))
meta.update(parts=n, fields=F); json.dump(meta, open(f"{outdir}/meta.json", "w"), indent=1)
print("wrote", len(out), file=sys.stderr)
