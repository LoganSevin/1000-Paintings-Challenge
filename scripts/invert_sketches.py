#!/usr/bin/env python3
"""
Create inverted copies of every sketch PNG (black↔white).

Also writes data/sketch-manifest.json so the Gallery tab can list sketches
even when the API is an older server build.

Usage (from gallery/):
  python scripts/invert_sketches.py
  python scripts/invert_sketches.py --skip-existing
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

try:
    from PIL import Image, ImageOps
except ImportError:
    print("Pillow required: pip install Pillow", file=sys.stderr)
    sys.exit(1)

GALLERY = Path(__file__).resolve().parent.parent
SRC = GALLERY / "sketches"
DEST = GALLERY / "sketches-inverted"
MANIFEST = GALLERY / "data" / "sketch-manifest.json"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-existing", action="store_true")
    args = ap.parse_args()

    DEST.mkdir(parents=True, exist_ok=True)
    (GALLERY / "data").mkdir(parents=True, exist_ok=True)

    files = sorted(
        [p for p in SRC.glob("*.png") if p.stem.isdigit()],
        key=lambda p: int(p.stem),
    )
    # skip helper previews
    files = [p for p in files if not p.name.startswith("_")]

    print(f"[invert] {len(files)} sketches → {DEST}", flush=True)
    items = []
    t0 = time.time()
    done = 0
    skipped = 0
    for i, src in enumerate(files, 1):
        n = int(src.stem)
        out = DEST / f"{n}.png"
        items.append({"num": n, "name": f"{n}.png", "url": f"/sketches/{n}.png"})
        if args.skip_existing and out.is_file() and out.stat().st_size > 64:
            skipped += 1
        else:
            try:
                im = Image.open(src).convert("RGB")
                inv = ImageOps.invert(im)
                inv.save(out, format="PNG", optimize=True)
                done += 1
            except Exception as exc:
                print(f"  ERR {src.name}: {exc}", flush=True)
        if i % 500 == 0 or i == len(files):
            rate = i / max(0.001, time.time() - t0)
            print(
                f"[invert] {i}/{len(files)} · wrote={done} skip={skipped} · {rate:.1f}/s",
                flush=True,
            )

    MANIFEST.write_text(
        json.dumps({"items": items, "count": len(items)}, separators=(",", ":")),
        encoding="utf-8",
    )
    print(
        f"[invert] Done. inverted={done} skipped={skipped} "
        f"manifest={MANIFEST} ({len(items)} items) in {time.time()-t0:.1f}s",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
