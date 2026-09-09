#!/usr/bin/env python3
"""
Build sketch-native prompt/description meta for every sketch.

Source painting/generated text is used for subject content, but rewritten so
descriptions clearly describe LINE SKETCHES (not the colored originals).
Also writes inverted (white-on-black) description/prompt fields.

Writes:
  gallery/sketches-meta/N.json
  gallery/data/sketch-analyses.json

Usage (from gallery/):
  python scripts/build_sketch_meta.py
"""
from __future__ import annotations

import json
import re
import sys
import time
from pathlib import Path

GALLERY = Path(__file__).resolve().parent.parent
SKETCHES = GALLERY / "sketches"
SKETCHES_JSON = SKETCHES / "json"
SKETCHES_META = GALLERY / "sketches-meta"
OUT_BULK = GALLERY / "data" / "sketch-analyses.json"

# Color / medium language to neutralize when describing monochrome sketches
_COLOR_RE = re.compile(
    r"\b("
    r"reds?|blues?|greens?|yellows?|oranges?|purples?|pinks?|cyans?|magentas?|"
    r"turquoises?|violets?|indigos?|golds?|golden|silvers?|bronzes?|crimsons?|"
    r"scarlets?|azures?|teals?|nav(?:y|ies)|maroons?|beiges?|tans?|browns?|"
    r"ochres?|umbers?|siennas?|lavenders?|roses?|corals?|peaches?|mints?|"
    r"olives?|limes?|aquas?|fuchsias?|burgund(?:y|ies)|ivory|cream|sepia|"
    r"polychrome|multicolou?r(?:ed)?|colou?rful|vivid colou?rs?|"
    r"pastel|neon|iridescent|rainbow|spectrum|"
    r"turquoise|cerulean|ultramarine|cobalt|emerald|jade|amber|saffron|"
    r"chartreuse|mauve|lilac|periwinkle|burgundy|wine|rust|copper|"
    r"charcoal gray|charcoal grey|slate gray|slate grey"
    r")\b",
    re.I,
)
_COLOR_PHRASE_RE = re.compile(
    r"\b(?:shades?|tones?|hues?|tints?|palette|colors?|colours?)\s+of\s+"
    r"[^.;,]+|"
    r"\bin\s+(?:shades?|tones?|hues?)\s+of\s+[^.;,]+|"
    r"\b(?:soft|deep|bright|pale|dark|light|vivid|muted|rich)\s+"
    r"(?:red|blue|green|yellow|orange|purple|pink|cyan|magenta|brown|gold|"
    r"turquoise|violet|teal|navy|maroon|lavender|coral|peach)\b",
    re.I,
)
_PAINT_MEDIUM_RE = re.compile(
    r"\b("
    r"acrylic(?:s)?|oil(?:s)?|watercolor|watercolou?r|gouache|pastel(?:s)?|"
    r"digital painting|oil painting|acrylic painting|"
    r"impasto|glazing|pigment(?:s)?|brushwork|brushstrokes?"
    r")\b",
    re.I,
)
_CANVAS_RE = re.compile(r"\bcanvas\b", re.I)
_SPACE_RE = re.compile(r"[ \t]{2,}")
_PUNCT_SPACE_RE = re.compile(r"\s+([,.;:])")


def load_json(path: Path):
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def load_painting_analyses() -> dict:
    data = load_json(GALLERY / "data" / "analyses.json") or {}
    return data if isinstance(data, dict) else {}


def load_lod1() -> dict:
    data = load_json(GALLERY / "data" / "lod1-analyses.json") or {}
    return data if isinstance(data, dict) else {}


def load_generated_meta(num: int) -> dict | None:
    for base in (GALLERY / "generated-meta", GALLERY / "generated"):
        p = base / f"{num}.json"
        d = load_json(p)
        if isinstance(d, dict) and (
            d.get("description") or d.get("prompt") or d.get("title")
        ):
            return d
    return None


def pick_source_analysis(
    collection: str, source_num: int, paintings: dict, lod1: dict
) -> dict | None:
    if not source_num:
        return None
    key = str(source_num)
    if collection == "paintings":
        a = paintings.get(key) or paintings.get(source_num)
        return a if isinstance(a, dict) else None
    if collection == "generated":
        a = lod1.get(key) or lod1.get(source_num)
        if isinstance(a, dict) and (a.get("description") or a.get("prompt")):
            return a
        return load_generated_meta(source_num)
    return None


def parse_source_from_sketch(data: dict) -> tuple[str, int]:
    meta = data.get("meta") if isinstance(data.get("meta"), dict) else {}
    col = str(meta.get("collection") or "").strip().lower()
    num = meta.get("source_num")
    try:
        num = int(num) if num is not None else 0
    except (TypeError, ValueError):
        num = 0
    if not col or not num:
        su = str(data.get("source_url") or "")
        m = re.search(r"/(paintings|generated)/(\d+)", su, re.I)
        if m:
            col = m.group(1).lower()
            num = int(m.group(2))
    return col, num


def neutralize_color_language(text: str) -> str:
    """Strip color/paint-medium language so text fits monochrome line art."""
    if not text:
        return ""
    s = text
    # Drop whole color lists first
    s = _COLOR_PHRASE_RE.sub("", s)
    s = re.sub(
        r"\b(?:in\s+)?(?:soft|deep|bright|pale|dark|light|vivid|muted|rich|warm|cool)\s+"
        r"(?:reds?|blues?|greens?|yellows?|oranges?|purples?|pinks?|browns?|golds?|"
        r"turquoise|violets?|teals?|lavenders?)\b",
        "",
        s,
        flags=re.I,
    )
    s = _COLOR_RE.sub("", s)
    s = _PAINT_MEDIUM_RE.sub("", s)
    s = _CANVAS_RE.sub("page", s)
    s = re.sub(r"\b(?:this\s+)?abstract\s+painting\b", "abstract composition", s, flags=re.I)
    s = re.sub(r"\bpainting\b", "composition", s, flags=re.I)
    s = re.sub(r"\bdigital\s+composition\b", "composition", s, flags=re.I)
    s = re.sub(r"\bbrushstrokes?\b", "strokes", s, flags=re.I)
    # Clean empty list debris: "forms , , and  that"
    s = re.sub(r"\s*,\s*,+", ", ", s)
    s = re.sub(r"\s+and\s+and\b", " and ", s, flags=re.I)
    s = re.sub(r",\s*and\s*,", ",", s)
    s = re.sub(r"\bforms\s+,\s*", "forms ", s, flags=re.I)
    s = re.sub(r"\s+,\s+", ", ", s)
    s = re.sub(r",\s*\.", ".", s)
    s = re.sub(r"\s+\.", ".", s)
    s = _PUNCT_SPACE_RE.sub(r"\1", s)
    s = _SPACE_RE.sub(" ", s)
    return s.strip(" ,;.")


def subject_core(src_title: str, src_desc: str, src_prompt: str, origin: str) -> str:
    """Subject content from source, decolored, for sketch framing."""
    raw = src_desc or src_prompt or src_title or f"the subject of {origin}"
    core = neutralize_color_language(raw)
    if len(core) < 12:
        core = neutralize_color_language(src_title) or f"forms from {origin}"
    return core


def build_sketch_record(
    sketch_num: int,
    data: dict,
    source: dict | None,
    collection: str,
    source_num: int,
) -> dict:
    """Sketch-native title/description/prompt (+ inverted chalk variants)."""
    src_title = str((source or {}).get("title") or "").strip()
    src_desc = str((source or {}).get("description") or "").strip()
    src_prompt = str((source or {}).get("prompt") or "").strip()
    src_style = str((source or {}).get("style") or "").strip()
    src_mood = str((source or {}).get("mood") or "").strip()
    src_medium = str((source or {}).get("medium") or "").strip()
    src_tags = (source or {}).get("tags") if isinstance((source or {}).get("tags"), list) else []

    if collection == "paintings" and source_num:
        origin = f"painting #{source_num}"
    elif collection == "generated" and source_num:
        origin = f"generated still #{source_num}"
    else:
        origin = f"source image for sketch #{sketch_num}"

    subject = subject_core(src_title, src_desc, src_prompt, origin)
    title_base = neutralize_color_language(src_title) if src_title else ""
    if title_base:
        title = f"Line sketch: {title_base}"
    else:
        title = f"Line sketch of {origin}"

    # DESCRIPTION: what THIS sketch is (not the colored painting)
    description = (
        f"Black-and-white ink line sketch on white paper — pure contour and edge "
        f"drawing with no color fills. Edge-traced line art of: {subject}"
    )
    if collection and source_num:
        description += f" (derived from {origin})."
    else:
        description += "."

    # PROMPT: generation weight for this sketch look
    prompt = (
        "Black and white ink line sketch, pure line art on blank white paper, "
        "no color, no grayscale fills, no shading blocks, expressive black contour "
        f"lines only, sketch of: {subject}"
    )

    # INVERTED: white chalk on black
    inverted_description = (
        f"Inverted chalk line sketch — white contour lines on solid black ground, "
        f"no color. Monochrome reverse of the line art: {subject}"
    )
    if collection and source_num:
        inverted_description += f" (from {origin})."
    else:
        inverted_description += "."

    inverted_prompt = (
        "White chalk line drawing on pure black background, inverted monochrome "
        "sketch, white contours only, no color, no gray fills, high-contrast "
        f"negative line art of: {subject}"
    )
    inverted_title = (
        f"Inverted sketch: {title_base}" if title_base else f"Inverted sketch of {origin}"
    )

    tags = ["line sketch", "black and white", "ink drawing", "monochrome", "contour"]
    for t in src_tags:
        s = neutralize_color_language(str(t).strip())
        if not s:
            continue
        # drop pure color tag leftovers
        if s.lower() in ("tonal", "color", "colour", "colors", "colours"):
            continue
        if s.lower() not in {x.lower() for x in tags}:
            tags.append(s)
        if len(tags) >= 10:
            break

    style = neutralize_color_language(src_style) if src_style else "line sketch"
    if style.lower() in ("", "tonal"):
        style = "line sketch"
    mood = neutralize_color_language(src_mood) if src_mood else "graphic"

    return {
        "number": sketch_num,
        "title": title[:120],
        "description": description,
        "prompt": prompt,
        "inverted_title": inverted_title[:120],
        "inverted_description": inverted_description,
        "inverted_prompt": inverted_prompt,
        "source_description": src_desc,
        "source_prompt": src_prompt,
        "source_title": src_title,
        "style": style[:80] if style else "line sketch",
        "mood": mood[:80] if mood else "graphic",
        "medium": "ink line sketch",
        "inverted_medium": "white chalk on black",
        "source_medium": src_medium,
        "tags": tags[:10],
        "colors": ["black", "white"],
        "subject_type": "sketch",
        "kind": "sketch",
        "source_collection": collection or "",
        "source_num": source_num or None,
        "source_url": data.get("source_url") or "",
        "image_url": f"/sketches/{sketch_num}.png",
        "inverted_image_url": f"/sketches-inverted/{sketch_num}.png",
        "curve_count": data.get("curve_count") or len(data.get("curves") or []),
        "built_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }


def main() -> int:
    paintings = load_painting_analyses()
    lod1 = load_lod1()
    SKETCHES_META.mkdir(parents=True, exist_ok=True)
    (GALLERY / "data").mkdir(parents=True, exist_ok=True)

    files = sorted(
        SKETCHES_JSON.glob("*.json") if SKETCHES_JSON.is_dir() else [],
        key=lambda p: int(p.stem) if p.stem.isdigit() else 10**9,
    )
    if not files:
        files = sorted(
            [p for p in SKETCHES.glob("*.json") if p.is_file()],
            key=lambda p: int(p.stem) if p.stem.isdigit() else 10**9,
        )

    bulk: dict[str, dict] = {}
    with_source = 0
    without = 0
    t0 = time.time()

    for i, path in enumerate(files, 1):
        if not path.stem.isdigit():
            continue
        num = int(path.stem)
        data = load_json(path)
        if not isinstance(data, dict):
            continue
        png = SKETCHES / f"{num}.png"
        if not png.is_file():
            continue

        col, src_num = parse_source_from_sketch(data)
        source = pick_source_analysis(col, src_num, paintings, lod1)
        if source:
            with_source += 1
        else:
            without += 1

        rec = build_sketch_record(num, data, source, col, src_num)
        meta_path = SKETCHES_META / f"{num}.json"
        meta_path.write_text(
            json.dumps(rec, indent=2, ensure_ascii=False), encoding="utf-8"
        )
        bulk[str(num)] = {
            "title": rec["title"],
            "description": rec["description"],
            "prompt": rec["prompt"],
            "inverted_title": rec["inverted_title"],
            "inverted_description": rec["inverted_description"],
            "inverted_prompt": rec["inverted_prompt"],
            "source_description": rec.get("source_description") or "",
            "source_prompt": rec.get("source_prompt") or "",
            "source_title": rec.get("source_title") or "",
            "style": rec["style"],
            "mood": rec["mood"],
            "medium": rec["medium"],
            "inverted_medium": rec.get("inverted_medium") or "white chalk on black",
            "tags": rec["tags"],
            "colors": rec["colors"],
            "subject_type": "sketch",
            "kind": "sketch",
            "source_collection": rec.get("source_collection") or "",
            "source_num": rec.get("source_num"),
            "source_url": rec.get("source_url") or "",
            "image_url": rec["image_url"],
            "inverted_image_url": rec.get("inverted_image_url") or "",
        }
        if i % 500 == 0 or i == len(files):
            print(
                f"[meta] {i}/{len(files)} · with_source={with_source} bare={without}",
                flush=True,
            )

    OUT_BULK.write_text(
        json.dumps(bulk, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(
        f"[meta] Done. {len(bulk)} sketches · source hits={with_source} bare={without} "
        f"in {time.time()-t0:.1f}s → {SKETCHES_META.name}/ + {OUT_BULK.relative_to(GALLERY)}",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
