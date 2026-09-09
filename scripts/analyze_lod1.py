"""
Analyze LOD1 / generated stills with xAI vision API.
Resumes from data/lod1-analyses.json — safe to interrupt and rerun.

Fills any generated image missing a real title + description (not just new files).
Also writes gallery/generated-meta/N.json sidecars for Spellforge / Transfer
(images stay in gallery/generated/; JSON meta is separate).
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import httpx

GALLERY = Path(__file__).resolve().parent.parent
GENERATED = GALLERY / "generated"
GENERATED_META = GALLERY / "generated-meta"
LOD1_ANALYSES_PATH = GALLERY / "data" / "lod1-analyses.json"
IMAGE_EXTS = (".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp")

sys.path.insert(0, str(Path(__file__).resolve().parent))
from analyze import DEFAULT_MAX_SIZE, DEFAULT_MODEL, get_api_key  # noqa: E402

PROMPT = """Upscaled artwork / generated still from a painting challenge studio.
Study the image carefully. Describe ONLY what is actually visible.
Match subject_type to the image:
- painting or scene: a finished artwork, landscape, surreal scene
- object: a single physical item
- character_sheet: multiple posed views of one character
- sprite_sheet: a grid of repeated poses
- portrait: a person/face focus
Do NOT invent a character sheet unless that layout is clearly visible.
Return ONLY JSON:
{"title":"max 6 words","description":"2 accurate sentences of what is visible","style":"category","medium":"guess","mood":"1-3 words","subject_type":"painting|object|character_sheet|sprite_sheet|scene|portrait|other","tags":["up to 6 tags"],"colors":["up to 4 colors"],"prompt":"one concrete generation prompt 40-90 words, no 4k/masterpiece/hashtags"}"""


def load_lod1_analyses() -> dict:
    if LOD1_ANALYSES_PATH.exists():
        try:
            data = json.loads(LOD1_ANALYSES_PATH.read_text(encoding="utf-8"))
            return data if isinstance(data, dict) else {}
        except json.JSONDecodeError:
            return {}
    return {}


def save_lod1_analyses(data: dict) -> None:
    payload = json.dumps(data, indent=2, ensure_ascii=False)
    tmp = LOD1_ANALYSES_PATH.with_suffix(".json.tmp")
    for attempt in range(8):
        try:
            tmp.write_text(payload, encoding="utf-8")
            tmp.replace(LOD1_ANALYSES_PATH)
            return
        except (PermissionError, OSError):
            if attempt == 7:
                raise
            time.sleep(0.5 * (attempt + 1))


def generated_image_path(number: int) -> Path | None:
    for ext in IMAGE_EXTS:
        path = GENERATED / f"{number}{ext}"
        if path.is_file() and path.stat().st_size > 64:
            return path
    return None


def write_generated_sidecar(number: int, result: dict) -> None:
    """Keep generated-meta/N.json in sync so Spellforge can read without huge lod1 reload."""
    try:
        GENERATED_META.mkdir(parents=True, exist_ok=True)
        path = GENERATED_META / f"{number}.json"
        slim = {
            "number": number,
            "title": result.get("title") or "",
            "description": result.get("description") or "",
            "prompt": result.get("prompt") or "",
            "style": result.get("style") or "",
            "mood": result.get("mood") or "",
            "medium": result.get("medium") or "",
            "tags": result.get("tags") or [],
            "colors": result.get("colors") or [],
            "subject_type": result.get("subject_type") or "",
            "kind": result.get("kind") or "generated",
            "analyzed_at": result.get("analyzed_at") or "",
        }
        path.write_text(json.dumps(slim, indent=2, ensure_ascii=False), encoding="utf-8")
    except OSError:
        pass


def analysis_is_complete(entry: object, number: int) -> bool:
    """True when we have a usable title + description (not a placeholder)."""
    if not isinstance(entry, dict):
        return False
    desc = str(entry.get("description") or "").strip()
    title = str(entry.get("title") or "").strip()
    if len(desc) < 12:
        return False
    if not title:
        return False
    tlow = title.lower().strip()
    placeholders = {
        f"generated {number}",
        f"generated #{number}",
        f"gen g#{number}",
        f"phone g#{number}",
        f"generated {number}.jpg",
        "generated",
        "untitled",
    }
    if tlow in placeholders or tlow.startswith("generated #"):
        return False
    return True


def list_generated_nums() -> list[int]:
    nums: set[int] = set()
    if not GENERATED.is_dir():
        return []
    for path in GENERATED.iterdir():
        if not path.is_file():
            continue
        if path.suffix.lower() not in IMAGE_EXTS:
            continue
        if not path.stem.isdigit():
            continue
        if path.stat().st_size <= 64:
            continue
        nums.add(int(path.stem))
    return sorted(nums)


def pending_nums(analyses: dict, all_nums: list[int], *, force: bool) -> list[int]:
    if force:
        return list(all_nums)
    out = []
    for n in all_nums:
        entry = analyses.get(str(n))
        if entry is None:
            entry = analyses.get(n)
        # Prefer richer sidecar if lod1 is empty/weak
        if not analysis_is_complete(entry, n):
            side = GENERATED_META / f"{n}.json"
            if not side.is_file():
                side = GENERATED / f"{n}.json"  # legacy co-located path
            if side.is_file():
                try:
                    side_data = json.loads(side.read_text(encoding="utf-8"))
                    if analysis_is_complete(side_data, n):
                        # Hydrate lod1 from sidecar without re-calling the API
                        analyses[str(n)] = side_data
                        continue
                except (OSError, json.JSONDecodeError):
                    pass
            out.append(n)
    return out


def analyze_lod1_one(
    client: httpx.Client,
    api_key: str,
    number: int,
    model: str,
    max_size: int,
    max_retries: int = 6,
) -> dict:
    path = generated_image_path(number)
    if path is None:
        raise FileNotFoundError(f"No image for generated #{number}")

    from analyze import API_URL, extract_text, image_to_data_url, parse_json_response

    payload = {
        "model": model,
        "input": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_image",
                        "image_url": image_to_data_url(path, max_size),
                        "detail": "low",
                    },
                    {"type": "input_text", "text": PROMPT},
                ],
            }
        ],
        "store": False,
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    last_err = None
    for attempt in range(max_retries):
        try:
            resp = client.post(
                API_URL,
                headers=headers,
                json=payload,
                timeout=90.0,
            )
            if resp.status_code in (403, 429, 500, 502, 503, 504):
                wait = min(120, 5 * (2**attempt))
                print(
                    f"  RETRY #{number}: HTTP {resp.status_code}, "
                    f"waiting {wait}s ({attempt + 1}/{max_retries})",
                    file=sys.stderr,
                )
                time.sleep(wait)
                continue
            resp.raise_for_status()
            text = extract_text(resp.json())
            if not text:
                raise ValueError("Empty API response")
            result = parse_json_response(text)
            if not str(result.get("description") or "").strip():
                raise ValueError("API returned empty description")
            if not str(result.get("title") or "").strip():
                result["title"] = f"Still #{number}"
            result["number"] = number
            result["analyzed_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            result["kind"] = "generated"
            result["source_file"] = path.name
            return result
        except httpx.HTTPStatusError as e:
            last_err = e
            if e.response.status_code in (403, 429, 500, 502, 503, 504) and attempt < max_retries - 1:
                wait = min(120, 5 * (2**attempt))
                print(
                    f"  RETRY #{number}: HTTP {e.response.status_code}, "
                    f"waiting {wait}s ({attempt + 1}/{max_retries})",
                    file=sys.stderr,
                )
                time.sleep(wait)
                continue
            raise
        except httpx.TransportError as e:
            last_err = e
            if attempt < max_retries - 1:
                wait = min(60, 3 * (2**attempt))
                time.sleep(wait)
                continue
            raise
        except (json.JSONDecodeError, ValueError) as e:
            last_err = e
            if attempt < max_retries - 1:
                time.sleep(2 * (attempt + 1))
                continue
            raise
    raise last_err or RuntimeError(f"Failed generated #{number} after {max_retries} attempts")


def main():
    parser = argparse.ArgumentParser(
        description="Fill missing titles/descriptions for generated/ stills"
    )
    parser.add_argument("--start", type=int, default=0, help="Min number (0 = all)")
    parser.add_argument("--end", type=int, default=0, help="Max number (0 = all)")
    parser.add_argument("--workers", type=int, default=3)
    parser.add_argument("--delay", type=float, default=0.8, help="Seconds between saves")
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-analyze every image (even if description exists)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Only process this many pending images (0 = all)",
    )
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--max-size", type=int, default=DEFAULT_MAX_SIZE)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="List how many need analysis, then exit",
    )
    args = parser.parse_args()

    api_key = get_api_key()
    analyses = load_lod1_analyses()
    all_nums = list_generated_nums()
    if args.start:
        all_nums = [n for n in all_nums if n >= args.start]
    if args.end:
        all_nums = [n for n in all_nums if n <= args.end]

    if args.force:
        import shutil

        if analyses and LOD1_ANALYSES_PATH.is_file():
            backup = LOD1_ANALYSES_PATH.with_suffix(".json.pre-refresh.bak")
            shutil.copy2(LOD1_ANALYSES_PATH, backup)
            print(f"Backed up analyses to {backup.name}")

    # Hydrate complete sidecars into lod1 first
    pending = pending_nums(analyses, all_nums, force=args.force)
    if not args.force:
        # Persist any sidecar hydrations
        save_lod1_analyses(analyses)
        pending = pending_nums(analyses, all_nums, force=False)

    if args.limit and args.limit > 0:
        pending = pending[: args.limit]

    complete = len(all_nums) - len(pending_nums(analyses, all_nums, force=False))
    print(
        f"Generated images in range: {len(all_nums)} | "
        f"already complete: ~{complete} | pending: {len(pending)}"
    )
    if args.dry_run:
        print("Dry run — sample pending:", pending[:30])
        return

    if not pending:
        print("All generated stills already have titles + descriptions.")
        return

    print(
        f"Analyzing {len(pending)} stills | model={args.model} | "
        f"workers={args.workers} | delay={args.delay}s | max_size={args.max_size}px"
    )
    t_start = time.time()
    done = 0
    errors = 0
    limits = httpx.Limits(max_connections=args.workers + 2)
    with httpx.Client(limits=limits) as client:
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            futures = {
                pool.submit(
                    analyze_lod1_one, client, api_key, n, args.model, args.max_size
                ): n
                for n in pending
            }
            for future in as_completed(futures):
                num = futures[future]
                try:
                    result = future.result()
                    analyses[str(num)] = result
                    write_generated_sidecar(num, result)
                    done += 1
                    title = result.get("title", "?")
                    print(f"  [{done}/{len(pending)}] #{num}: {title}")
                except Exception as e:
                    errors += 1
                    print(f"  ERROR #{num}: {e}", file=sys.stderr)
                if args.delay > 0:
                    time.sleep(args.delay)
                if done % 5 == 0 or done + errors == len(pending):
                    save_lod1_analyses(analyses)

    save_lod1_analyses(analyses)
    total_min = (time.time() - t_start) / 60
    print(f"Finished. {done} analyzed, {errors} errors in {total_min:.1f} min.")
    print(f"Saved to {LOD1_ANALYSES_PATH}")
    still = pending_nums(load_lod1_analyses(), list_generated_nums(), force=False)
    print(f"Still missing after this run: {len(still)}")


if __name__ == "__main__":
    main()
