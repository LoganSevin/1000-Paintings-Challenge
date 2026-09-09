#!/usr/bin/env python3
"""
Render gallery/sketches/json/N.json → sketches/N.png (viewable sketches).

Prefers edge art from the original source image; falls back to stroking the
saved Bézier curves when the source file is missing.

Usage (from gallery/):
  python scripts/render_sketch_pngs.py
  python scripts/render_sketch_pngs.py --max-side 720 --skip-existing
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFilter, ImageOps
except ImportError:
    print("Pillow required: pip install Pillow", file=sys.stderr)
    sys.exit(1)

GALLERY = Path(__file__).resolve().parent.parent
SKETCHES = GALLERY / "sketches"
SKETCHES_JSON = SKETCHES / "json"

# ((1-t)^3*a + 3*t*(1-t)^2*b + 3*t^2*(1-t)*c + t^3*d, same for y)
_BEZ_RE = re.compile(
    r"\(\s*"
    r"\(1 - t\)\^3\*(?P<x0>-?[\d.]+)\s*\+\s*"
    r"3\*t\*\(1 - t\)\^2\*(?P<x1>-?[\d.]+)\s*\+\s*"
    r"3\*t\^2\*\(1 - t\)\*(?P<x2>-?[\d.]+)\s*\+\s*"
    r"t\^3\*(?P<x3>-?[\d.]+)\s*,\s*"
    r"\(1 - t\)\^3\*(?P<y0>-?[\d.]+)\s*\+\s*"
    r"3\*t\*\(1 - t\)\^2\*(?P<y1>-?[\d.]+)\s*\+\s*"
    r"3\*t\^2\*\(1 - t\)\*(?P<y2>-?[\d.]+)\s*\+\s*"
    r"t\^3\*(?P<y3>-?[\d.]+)\s*"
    r"\)\s*\)?",
    re.I,
)


def resolve_source(source_url: str) -> Path | None:
    if not source_url:
        return None
    u = source_url.strip().replace("\\", "/")
    if u.startswith("/"):
        u = u[1:]
    p = GALLERY / u
    if p.is_file():
        return p
    # try common alternates
    stem = p.with_suffix("")
    for ext in (".jpg", ".jpeg", ".png", ".webp"):
        alt = Path(str(stem) + ext)
        if alt.is_file():
            return alt
    return None


def edge_sketch_from_image(src: Path, max_side: int) -> Image.Image:
    im = Image.open(src).convert("RGB")
    w0, h0 = im.size
    long = max(w0, h0)
    if long > max_side:
        s = max_side / long
        im = im.resize(
            (max(1, int(round(w0 * s))), max(1, int(round(h0 * s)))),
            Image.Resampling.LANCZOS,
        )
    gray = ImageOps.grayscale(im)
    edges = gray.filter(ImageFilter.FIND_EDGES)
    edges = edges.filter(ImageFilter.SMOOTH)
    # strong black lines on white
    thr = 28
    bw = edges.point(lambda p: 0 if p > thr else 255)
    # slight thicken via min-filter (darken)
    bw = bw.filter(ImageFilter.MinFilter(3))
    return bw.convert("RGB")


def sample_bezier(x0, y0, x1, y1, x2, y2, x3, y3, steps: int = 24):
    pts = []
    for i in range(steps + 1):
        t = i / steps
        u = 1.0 - t
        b0, b1, b2, b3 = u * u * u, 3 * t * u * u, 3 * t * t * u, t * t * t
        x = b0 * x0 + b1 * x1 + b2 * x2 + b3 * x3
        y = b0 * y0 + b1 * y1 + b2 * y2 + b3 * y3
        pts.append((x, y))
    return pts


def render_curves(data: dict, max_side: int) -> Image.Image | None:
    curves = data.get("curves") or []
    if not curves:
        return None
    w = int(data.get("width") or 360)
    h = int(data.get("height") or 270)
    scale = 1.0
    long = max(w, h)
    if long > 0 and long < max_side:
        scale = max_side / long
    out_w = max(1, int(round(w * scale)))
    out_h = max(1, int(round(h * scale)))
    # math Y-up → image Y-down
    img = Image.new("RGB", (out_w, out_h), (255, 255, 255))
    draw = ImageDraw.Draw(img)
    for expr in curves:
        m = _BEZ_RE.search(str(expr))
        if not m:
            continue
        g = {k: float(v) for k, v in m.groupdict().items()}
        pts = sample_bezier(
            g["x0"], g["y0"], g["x1"], g["y1"], g["x2"], g["y2"], g["x3"], g["y3"]
        )
        screen = []
        for x, y in pts:
            sx = x * scale
            sy = (h - 1 - y) * scale
            screen.append((sx, sy))
        if len(screen) >= 2:
            draw.line(screen, fill=(20, 20, 20), width=max(1, int(round(1.2 * scale))))
    return img


def process_one(json_path: Path, max_side: int, skip_existing: bool) -> str:
    try:
        num = int(json_path.stem)
    except ValueError:
        return "skip"
    png_path = SKETCHES / f"{num}.png"
    if skip_existing and png_path.is_file():
        return "exists"

    try:
        data = json.loads(json_path.read_text(encoding="utf-8"))
    except Exception as e:
        return f"err-json:{e}"

    if not isinstance(data, dict):
        return "err-json"

    img = None
    method = ""
    src = resolve_source(str(data.get("source_url") or ""))
    if src is not None:
        try:
            img = edge_sketch_from_image(src, max_side)
            method = "source"
        except Exception:
            img = None

    if img is None:
        try:
            img = render_curves(data, max_side)
            method = "curves"
        except Exception as e:
            return f"err-render:{e}"

    if img is None:
        return "empty"

    img.save(png_path, format="PNG", optimize=True)
    data["preview_url"] = f"/sketches/{num}.png"
    try:
        json_path.write_text(
            json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8"
        )
    except Exception:
        pass
    return method


def main() -> int:
    ap = argparse.ArgumentParser(description="Render sketch JSON → PNG")
    ap.add_argument("--max-side", type=int, default=720, help="Long edge of PNG")
    ap.add_argument(
        "--skip-existing",
        action="store_true",
        help="Skip when N.png already exists",
    )
    ap.add_argument("--limit", type=int, default=0, help="Only first N files (debug)")
    args = ap.parse_args()

    json_dirs = []
    if SKETCHES_JSON.is_dir():
        json_dirs.append(SKETCHES_JSON)
    # legacy flat layout
    if SKETCHES.is_dir():
        json_dirs.append(SKETCHES)
    seen: set[str] = set()
    files: list[Path] = []
    for folder in json_dirs:
        for p in folder.glob("*.json"):
            if p.stem in seen:
                continue
            seen.add(p.stem)
            files.append(p)
    files = sorted(
        files,
        key=lambda p: int(p.stem) if p.stem.isdigit() else 10**12,
    )
    if args.limit > 0:
        files = files[: args.limit]

    print(f"[png] {len(files)} sketch JSON files → PNG (max_side={args.max_side})")
    t0 = time.time()
    counts = {"source": 0, "curves": 0, "exists": 0, "empty": 0, "err": 0}
    for i, jp in enumerate(files, 1):
        status = process_one(jp, args.max_side, args.skip_existing)
        if status in counts:
            counts[status] += 1
        elif status.startswith("err"):
            counts["err"] += 1
        if i % 100 == 0 or i == len(files):
            elapsed = time.time() - t0
            rate = i / elapsed if elapsed > 0 else 0
            eta = (len(files) - i) / rate if rate > 0 else 0
            print(
                f"[png] {i}/{len(files)} · source={counts['source']} "
                f"curves={counts['curves']} empty={counts['empty']} "
                f"err={counts['err']} · {rate:.1f}/s · ETA {eta/60:.1f} min"
            )
    print(
        f"[png] Done. source={counts['source']} curves={counts['curves']} "
        f"exists={counts['exists']} empty={counts['empty']} err={counts['err']} "
        f"folder={SKETCHES}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
