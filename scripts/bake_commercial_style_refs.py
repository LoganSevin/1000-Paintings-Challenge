#!/usr/bin/env python3
"""
Bake Art Style reference thumbs from REAL gallery paintings (quality crops only).

No stick-figure / crayon scenes. Each style gets a cover-cropped still from
paintings/ plus a thin caption bar. Used only as UI examples — generation
does not soft-light these into the model reference.
"""
from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps

GALLERY = Path(__file__).resolve().parents[1]
STYLES_JSON = GALLERY / "data" / "commercial-art-styles.json"
PAINTINGS = GALLERY / "paintings"
OUT_DIR = GALLERY / "assets" / "commercial-style-refs"
SIZE = 400

# Curated seeds that exist in paintings/ 1–1000 (composition quality, not crayon).
SEED_BY_ID = {
    "impressionism": 570,
    "expressionism": 359,
    "abstract": 166,
    "abstract-expressionism": 359,
    "surrealism": 1000,
    "cubism": 166,
    "pop-art": 997,
    "street-art": 19,
    "art-deco": 938,
    "art-nouveau": 938,
    "minimalism": 493,
    "brutalism": 680,
    "photorealism": 172,
    "watercolor": 999,
    "oil-painting": 828,
    "acrylic": 359,
    "ink-line": 257,
    "charcoal": 680,
    "digital-paint": 1000,
    "3d-render": 493,
    "pixel-art": 257,
    "anime": 257,
    "comic-book": 257,
    "noir": 680,
    "neon-noir": 680,
    "golden-hour": 265,
    "baroque": 828,
    "renaissance": 172,
    "ukiyo-e": 938,
    "bauhaus": 166,
    "vaporwave": 997,
    "brutalist-poster": 19,
    "pastel-soft": 999,
    "high-fashion": 80,
    "product-hero": 493,
}


def painting_path(num: int) -> Path | None:
    for ext in (".jpg", ".jpeg", ".png", ".webp"):
        p = PAINTINGS / f"{num}{ext}"
        if p.exists():
            return p
    return None


def cover(img: Image.Image, size: int = SIZE) -> Image.Image:
    return ImageOps.fit(img.convert("RGB"), (size, size), method=Image.Resampling.LANCZOS)


def label_bar(img: Image.Image, name: str) -> Image.Image:
    out = img.convert("RGBA")
    w, h = out.size
    bar_h = 34
    # Soft gradient bar (not a hard kid-label)
    bar = Image.new("RGBA", (w, bar_h), (0, 0, 0, 0))
    d = ImageDraw.Draw(bar)
    for y in range(bar_h):
        a = int(40 + (y / max(1, bar_h - 1)) * 150)
        d.line([(0, y), (w, y)], fill=(8, 10, 14, a))
    out.paste(bar, (0, h - bar_h), bar)
    d2 = ImageDraw.Draw(out)
    try:
        font = ImageFont.truetype("arial.ttf", 15)
    except Exception:
        try:
            font = ImageFont.truetype("C:/Windows/Fonts/segoeui.ttf", 15)
        except Exception:
            font = ImageFont.load_default()
    text = (name or "")[:32]
    d2.text((10, h - 24), text, fill=(245, 248, 252, 255), font=font)
    return out.convert("RGB")


def main():
    data = json.loads(STYLES_JSON.read_text(encoding="utf-8"))
    styles = data.get("styles") or []
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    fallback = next((n for n in range(1, 1001) if painting_path(n)), 1)

    for s in styles:
        sid = s["id"]
        num = SEED_BY_ID.get(sid) or s.get("paintingNum") or fallback
        try:
            num = int(num)
        except (TypeError, ValueError):
            num = fallback
        path = painting_path(num) or painting_path(fallback)
        if not path:
            print(f"  SKIP {sid} — no paintings")
            continue
        img = cover(Image.open(path))
        img = label_bar(img, s.get("name") or sid)
        out = OUT_DIR / f"{sid}.jpg"
        img.save(out, "JPEG", quality=92, optimize=True)
        rel = f"assets/commercial-style-refs/{sid}.jpg"
        s["refUrl"] = rel
        s["paintingNum"] = num
        s["templatePainting"] = num
        s["refBaked"] = True
        s["refMode"] = "gallery-crop"
        print(f"  {sid:24s} <- painting #{num}")

    data["styles"] = styles
    data["version"] = max(5, int(data.get("version") or 1) + 1)
    STYLES_JSON.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote gallery-crop style refs → {OUT_DIR}")


if __name__ == "__main__":
    main()
