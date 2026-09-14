# -*- coding: utf-8 -*-
"""Download OpenStreetMap geometry for Houma, LA and write a compact game mesh."""
from __future__ import annotations

import json
import math
import urllib.parse
import urllib.request
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "data" / "houma-osm.json"
ORIGIN_LAT = 29.59007223
ORIGIN_LON = -90.72057
BBOX = "29.582,-90.736,29.598,-90.705"
QUERY = f"""
[out:json][timeout:60];
(
  way["highway"]({BBOX});
  way["waterway"]({BBOX});
  way["natural"="water"]({BBOX});
  way["amenity"="parking"]({BBOX});
  way["building"]({BBOX});
);
out geom;
"""
OVERPASS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]


def ll_to_xy(lat: float, lon: float) -> tuple[float, float]:
    x = (lon - ORIGIN_LON) * 111320.0 * math.cos(math.radians(ORIGIN_LAT))
    y = (ORIGIN_LAT - lat) * 110540.0
    return (round(x, 1), round(y, 1))


def simplify(pts: list[list[float]], min_dist: float = 6.0) -> list[list[float]]:
    if len(pts) < 3:
        return pts
    out = [pts[0]]
    for p in pts[1:-1]:
        q = out[-1]
        if (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 >= min_dist * min_dist:
            out.append(p)
    out.append(pts[-1])
    return out


def classify(tags: dict) -> str | None:
    if tags.get("highway"):
        h = tags["highway"]
        if h in ("footway", "path", "steps", "cycleway", "pedestrian"):
            return None
        return "road"
    if tags.get("waterway") or tags.get("natural") == "water" or tags.get("water"):
        return "water"
    if tags.get("amenity") == "parking":
        return "parking"
    if "building" in tags:
        return "building"
    return None


def height_for(tags: dict, kind: str) -> float:
    if kind != "building":
        return 0
    b = str(tags.get("building") or "")
    if b in ("apartments", "commercial", "retail", "industrial", "warehouse", "school", "church", "cathedral"):
        return 14.0
    if b in ("yes", "house", "detached", "residential", "garage", "shed"):
        return 6.5
    return 8.0


def fetch_osm_xml() -> str:
    bbox = "-90.736,29.582,-90.705,29.598"
    url = "https://api.openstreetmap.org/api/0.6/map?bbox=" + bbox
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "1000-paintings-houma-map/1.0 (local studio)"},
    )
    print("fetching OSM map API", url)
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read().decode("utf-8")


def parse_osm_xml(xml: str) -> list[dict]:
    import xml.etree.ElementTree as ET

    root = ET.fromstring(xml)
    nodes = {}
    for n in root.findall("node"):
        nid = n.attrib["id"]
        nodes[nid] = ll_to_xy(float(n.attrib["lat"]), float(n.attrib["lon"]))
    features = []
    for w in root.findall("way"):
        tags = {t.attrib["k"]: t.attrib["v"] for t in w.findall("tag")}
        kind = classify(tags)
        if not kind:
            continue
        pts = []
        for nd in w.findall("nd"):
            p = nodes.get(nd.attrib["ref"])
            if p:
                pts.append([p[0], p[1]])
        pts = simplify(pts)
        if len(pts) < 2:
            continue
        name = tags.get("name") or ""
        ref = tags.get("ref") or ""
        feat = {"k": kind, "p": pts, "n": name or ref, "r": ref}
        if kind == "road":
            feat["h"] = tags.get("highway")
        if kind == "building":
            feat["z"] = height_for(tags, kind)
        features.append(feat)
    return features


def main() -> None:
    xml = fetch_osm_xml()
    features = parse_osm_xml(xml)
    lim = 2200
    clipped = []
    for f in features:
        pts = [p for p in f["p"] if abs(p[0]) <= lim and abs(p[1]) <= lim]
        if len(pts) < 2:
            continue
        f = dict(f)
        f["p"] = pts
        clipped.append(f)
    features = clipped
    payload = {
        "origin": [ORIGIN_LAT, ORIGIN_LON],
        "units": "meters",
        "features": features,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    counts = {}
    for f in features:
        counts[f["k"]] = counts.get(f["k"], 0) + 1
    print("wrote", OUT, "bytes", OUT.stat().st_size, "counts", counts)


if __name__ == "__main__":
    main()
