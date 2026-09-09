#!/usr/bin/env python3
"""
Batch convert every painting (1–1000) and every generated still into
gallery/sketches/json/N.json + optional N.png (continuous numbering), 1:1 with sources.

Resume-safe: skips sources already recorded in existing sketch JSON meta.

Usage (from gallery/):
  python scripts/batch_sketches_all.py
  python scripts/batch_sketches_all.py --paintings-only
  python scripts/batch_sketches_all.py --generated-only
  python scripts/batch_sketches_all.py --max-width 400 --detail 6 --max-curves 600
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
import time
from pathlib import Path

try:
    from PIL import Image, ImageFilter, ImageOps
except ImportError:
    print("Pillow required: pip install Pillow", file=sys.stderr)
    sys.exit(1)

GALLERY = Path(__file__).resolve().parent.parent
PAINTINGS = GALLERY / "paintings"
GENERATED = GALLERY / "generated"
SKETCHES = GALLERY / "sketches"
SKETCHES_JSON = SKETCHES / "json"


def next_sketch_num() -> int:
    SKETCHES.mkdir(parents=True, exist_ok=True)
    SKETCHES_JSON.mkdir(parents=True, exist_ok=True)
    max_n = 0
    for folder in (SKETCHES, SKETCHES_JSON):
        if not folder.is_dir():
            continue
        for p in folder.iterdir():
            if not p.is_file():
                continue
            try:
                n = int(p.stem)
            except ValueError:
                m = re.match(r"^(\d+)", p.stem)
                n = int(m.group(1)) if m else 0
            if n > max_n:
                max_n = n
    return max_n + 1


def already_sketched_sources() -> set[str]:
    done: set[str] = set()
    folders = [SKETCHES_JSON]
    if SKETCHES.is_dir():
        folders.append(SKETCHES)  # legacy flat *.json
    for folder in folders:
        if not folder.is_dir():
            continue
        for p in folder.glob("*.json"):
            try:
                data = json.loads(p.read_text(encoding="utf-8"))
            except Exception:
                continue
            if not isinstance(data, dict):
                continue
            su = str(data.get("source_url") or "").strip()
            if su:
                done.add(su)
            # also key by collection/num if present
            meta = data.get("meta") if isinstance(data.get("meta"), dict) else {}
            col = meta.get("collection")
            num = meta.get("source_num")
            if col and num is not None:
                done.add(f"{col}/{num}")
    return done


def clamp(v, a, b):
    return max(a, min(b, v))


def rdp(points: list[tuple[float, float]], epsilon: float) -> list[tuple[float, float]]:
    if len(points) < 3:
        return list(points)
    eps2 = epsilon * epsilon

    def rec(pts: list[tuple[float, float]]) -> list[tuple[float, float]]:
        if len(pts) < 3:
            return list(pts)
        first, last = pts[0], pts[-1]
        dx, dy = last[0] - first[0], last[1] - first[1]
        len2 = dx * dx + dy * dy or 1.0
        max_d, idx = 0.0, 0
        for i in range(1, len(pts) - 1):
            t = ((pts[i][0] - first[0]) * dx + (pts[i][1] - first[1]) * dy) / len2
            t = clamp(t, 0.0, 1.0)
            px, py = first[0] + t * dx, first[1] + t * dy
            d = (pts[i][0] - px) ** 2 + (pts[i][1] - py) ** 2
            if d > max_d:
                max_d, idx = d, i
        if max_d > eps2:
            left = rec(pts[: idx + 1])
            right = rec(pts[idx:])
            return left[:-1] + right
        return [first, last]

    return rec(points)


def catmull_to_bezier(p0, p1, p2, p3):
    return {
        "p0": p1,
        "p1": (p1[0] + (p2[0] - p0[0]) / 6.0, p1[1] + (p2[1] - p0[1]) / 6.0),
        "p2": (p2[0] - (p3[0] - p1[0]) / 6.0, p2[1] - (p3[1] - p1[1]) / 6.0),
        "p3": p2,
    }


def fmt(n: float) -> str:
    return f"{round(n * 100) / 100:.2f}"


def bezier_to_expr(b: dict) -> str:
    def coord(a, c1, c2, d):
        return (
            f"(1 - t)^3*{fmt(a[0] if isinstance(a, tuple) else a)} + "
            f"3*t*(1 - t)^2*{fmt(c1[0] if isinstance(c1, tuple) else c1)} + "
            f"3*t^2*(1 - t)*{fmt(c2[0] if isinstance(c2, tuple) else c2)} + "
            f"t^3*{fmt(d[0] if isinstance(d, tuple) else d)}"
        )

    # fix: p0 etc are tuples (x,y)
    p0, p1, p2, p3 = b["p0"], b["p1"], b["p2"], b["p3"]

    def cx(a, c1, c2, d, i):
        return (
            f"(1 - t)^3*{fmt(a[i])} + "
            f"3*t*(1 - t)^2*{fmt(c1[i])} + "
            f"3*t^2*(1 - t)*{fmt(c2[i])} + "
            f"t^3*{fmt(d[i])}"
        )

    return f"({cx(p0, p1, p2, p3, 0)},{cx(p0, p1, p2, p3, 1)})"


def polyline_to_beziers(pts: list[tuple[float, float]]) -> list[dict]:
    if len(pts) < 2:
        return []
    if len(pts) == 2:
        a, b = pts[0], pts[1]
        return [
            {
                "p0": a,
                "p1": (a[0] + (b[0] - a[0]) / 3, a[1] + (b[1] - a[1]) / 3),
                "p2": (a[0] + 2 * (b[0] - a[0]) / 3, a[1] + 2 * (b[1] - a[1]) / 3),
                "p3": b,
            }
        ]
    ext = [pts[0]] + pts + [pts[-1]]
    out = []
    for i in range(len(ext) - 3):
        out.append(catmull_to_bezier(ext[i], ext[i + 1], ext[i + 2], ext[i + 3]))
    return out


def extract_contours(bin_map: list[list[int]], w: int, h: int, min_len: int):
    visited = [[False] * w for _ in range(h)]
    n8 = [
        (1, 0),
        (1, 1),
        (0, 1),
        (-1, 1),
        (-1, 0),
        (-1, -1),
        (0, -1),
        (1, -1),
    ]
    contours = []
    for y in range(1, h - 1):
        for x in range(1, w - 1):
            if not bin_map[y][x] or visited[y][x]:
                continue
            path = []
            cx, cy = x, y
            prev_dir = 0
            guard = 0
            while guard < w * h:
                guard += 1
                if cx < 1 or cy < 1 or cx >= w - 1 or cy >= h - 1:
                    break
                if not bin_map[cy][cx] or visited[cy][cx]:
                    break
                visited[cy][cx] = True
                path.append((float(cx), float(cy)))
                found = False
                for k in range(8):
                    d = (prev_dir + k) % 8
                    nx, ny = cx + n8[d][0], cy + n8[d][1]
                    if nx < 1 or ny < 1 or nx >= w - 1 or ny >= h - 1:
                        continue
                    if bin_map[ny][nx] and not visited[ny][nx]:
                        cx, cy, prev_dir = nx, ny, d
                        found = True
                        break
                if not found:
                    for k in range(8):
                        nx, ny = cx + n8[k][0], cy + n8[k][1]
                        if nx < 1 or ny < 1 or nx >= w - 1 or ny >= h - 1:
                            continue
                        if bin_map[ny][nx] and not visited[ny][nx]:
                            cx, cy, prev_dir = nx, ny, k
                            found = True
                            break
                if not found:
                    break
            if len(path) >= min_len:
                contours.append(path)
    contours.sort(key=len, reverse=True)
    return contours


def image_to_curves(
    path: Path,
    *,
    max_width: int = 400,
    detail: int = 6,
    max_curves: int = 500,
) -> tuple[list[str], int, int, int]:
    """Return (curve_exprs, width, height, contour_count)."""
    im = Image.open(path).convert("RGB")
    w0, h0 = im.size
    long = max(w0, h0)
    if long > max_width:
        s = max_width / long
        w = max(1, int(round(w0 * s)))
        h = max(1, int(round(h0 * s)))
        im = im.resize((w, h), Image.Resampling.BILINEAR)
    else:
        w, h = w0, h0

    gray = ImageOps.grayscale(im)
    # FIND_EDGES is fast and works well for batch
    edges = gray.filter(ImageFilter.FIND_EDGES)
    edges = edges.filter(ImageFilter.SMOOTH)
    # threshold — detail 1..10
    thr = int(clamp(210 - detail * 14, 40, 200))
    bw = edges.point(lambda p: 255 if p > thr else 0)
    pix = bw.load()
    bin_map = [[1 if pix[x, y] > 128 else 0 for x in range(w)] for y in range(h)]

    min_len = max(6, 14 - detail)
    contours = extract_contours(bin_map, w, h, min_len)
    eps = 0.5 + (11 - detail) * 0.25

    exprs: list[str] = []
    for path_pts in contours:
        if len(exprs) >= max_curves:
            break
        simplified = rdp(path_pts, eps)
        if len(simplified) < 2:
            continue
        if len(simplified) < 4 and len(path_pts) > 20:
            step = max(1, len(path_pts) // 24)
            simplified = path_pts[::step]
            if simplified[-1] != path_pts[-1]:
                simplified.append(path_pts[-1])
        # flip Y for math coords
        mapped = [(p[0], (h - 1) - p[1]) for p in simplified]
        for bez in polyline_to_beziers(mapped):
            if len(exprs) >= max_curves:
                break
            exprs.append(bezier_to_expr(bez))
    return exprs, w, h, len(contours)


def save_sketch(
    num: int,
    curves: list[str],
    *,
    title: str,
    source_url: str,
    collection: str,
    source_num: int,
    width: int,
    height: int,
    detail: int,
    max_curves: int,
    contour_count: int,
) -> Path:
    SKETCHES.mkdir(parents=True, exist_ok=True)
    SKETCHES_JSON.mkdir(parents=True, exist_ok=True)
    record = {
        "num": num,
        "title": title,
        "created": time.time(),
        "source_url": source_url,
        "width": width,
        "height": height,
        "curve_count": len(curves),
        "curves": curves,
        "meta": {
            "detail": detail,
            "max_curves": max_curves,
            "contour_count": contour_count,
            "source": "batch_sketches_all",
            "collection": collection,
            "source_num": source_num,
        },
        "preview_url": f"/sketches/{num}.png",
    }
    dest = SKETCHES_JSON / f"{num}.json"
    dest.write_text(json.dumps(record, indent=2, ensure_ascii=False), encoding="utf-8")
    return dest


def list_paintings() -> list[tuple[int, Path]]:
    out = []
    for n in range(1, 1001):
        p = PAINTINGS / f"{n}.jpg"
        if not p.is_file():
            for ext in (".jpeg", ".png", ".webp"):
                alt = PAINTINGS / f"{n}{ext}"
                if alt.is_file():
                    p = alt
                    break
            else:
                continue
        out.append((n, p))
    return out


def list_generated() -> list[tuple[int, Path]]:
    if not GENERATED.is_dir():
        return []
    found: dict[int, Path] = {}
    for p in GENERATED.iterdir():
        if not p.is_file():
            continue
        if p.suffix.lower() not in (".jpg", ".jpeg", ".png", ".webp", ".gif"):
            continue
        m = re.match(r"^(\d+)", p.stem)
        if not m:
            continue
        n = int(m.group(1))
        # prefer jpg over others if multiple
        if n not in found or p.suffix.lower() in (".jpg", ".jpeg"):
            found[n] = p
    return sorted(found.items(), key=lambda t: t[0])


def main() -> int:
    ap = argparse.ArgumentParser(description="Batch 1:1 image → sketches")
    ap.add_argument("--paintings-only", action="store_true")
    ap.add_argument("--generated-only", action="store_true")
    ap.add_argument("--max-width", type=int, default=400)
    ap.add_argument("--detail", type=int, default=6)
    ap.add_argument("--max-curves", type=int, default=500)
    ap.add_argument("--limit", type=int, default=0, help="Stop after N conversions (0=all)")
    args = ap.parse_args()

    jobs: list[tuple[str, int, Path, str]] = []
    # (collection, num, path, source_url)

    if not args.generated_only:
        for n, p in list_paintings():
            jobs.append(("paintings", n, p, f"/paintings/{p.name}"))
    if not args.paintings_only:
        for n, p in list_generated():
            jobs.append(("generated", n, p, f"/generated/{p.name}"))

    done = already_sketched_sources()
    pending = []
    for col, n, path, url in jobs:
        key_a = url
        key_b = f"{col}/{n}"
        if key_a in done or key_b in done:
            continue
        pending.append((col, n, path, url))

    print(f"[batch] Total sources: {len(jobs)}", flush=True)
    print(f"[batch] Already sketched: {len(jobs) - len(pending)}", flush=True)
    print(f"[batch] To convert: {len(pending)}", flush=True)
    print(
        f"[batch] Settings: max_width={args.max_width} detail={args.detail} max_curves={args.max_curves}",
        flush=True,
    )

    if not pending:
        print("[batch] Nothing to do.", flush=True)
        return 0

    next_num = next_sketch_num()
    converted = 0
    failed = 0
    t0 = time.time()

    for i, (col, n, path, url) in enumerate(pending, 1):
        if args.limit and converted >= args.limit:
            print(f"[batch] Hit --limit {args.limit}", flush=True)
            break
        label = f"{col}/{n}"
        try:
            curves, w, h, ccount = image_to_curves(
                path,
                max_width=args.max_width,
                detail=args.detail,
                max_curves=args.max_curves,
            )
            if not curves:
                # still save empty? skip empty to avoid useless files
                print(f"  [{i}/{len(pending)}] SKIP empty {label}", flush=True)
                failed += 1
                continue
            title = f"{'Painting' if col == 'paintings' else 'Generated'} #{n}"
            dest = save_sketch(
                next_num,
                curves,
                title=title,
                source_url=url,
                collection=col,
                source_num=n,
                width=w,
                height=h,
                detail=args.detail,
                max_curves=args.max_curves,
                contour_count=ccount,
            )
            print(
                f"  [{i}/{len(pending)}] OK {label} → sketches/{next_num}.json "
                f"({len(curves)} curves, {ccount} contours)",
                flush=True,
            )
            next_num += 1
            converted += 1
        except Exception as exc:
            failed += 1
            print(f"  [{i}/{len(pending)}] FAIL {label}: {exc}", flush=True)

        if i % 25 == 0:
            elapsed = time.time() - t0
            rate = converted / elapsed if elapsed > 0 else 0
            left = len(pending) - i
            eta = left / rate if rate > 0 else 0
            print(
                f"[batch] progress {i}/{len(pending)} · saved {converted} · "
                f"{rate:.2f}/s · ETA ~{eta/60:.1f} min",
                flush=True,
            )

    elapsed = time.time() - t0
    print(
        f"[batch] Done. converted={converted} failed/empty={failed} "
        f"elapsed={elapsed/60:.1f} min · folder={SKETCHES}",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
