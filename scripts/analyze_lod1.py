"""
Analyze LOD1 / generated upscales with xAI vision API.
Resumes from data/lod1-analyses.json — safe to interrupt and rerun.
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
LOD1_ANALYSES_PATH = GALLERY / "data" / "lod1-analyses.json"

# Reuse painting analyzer helpers
sys.path.insert(0, str(Path(__file__).resolve().parent))
from analyze import DEFAULT_MAX_SIZE, DEFAULT_MODEL, get_api_key  # noqa: E402

PROMPT = """Upscaled artwork from overhead projector stasis. Study the image carefully.
Describe ONLY what is actually visible. Match the subject_type to the image:
- painting or scene: a single finished artwork, landscape, surreal scene, or portrait
- object: a single physical item (vehicle, artifact, prop, insect display, etc.)
- character_sheet: multiple posed views of one character on a reference/turnaround sheet
- sprite_sheet: a grid of repeated character poses or game sprites
Do NOT call something a character sheet or sprite sheet unless those layouts are clearly visible.
Return ONLY JSON:
{"title":"max 6 words","description":"2 accurate sentences","style":"category","medium":"guess","mood":"1-3 words","subject_type":"painting|object|character_sheet|sprite_sheet|scene|portrait|other","tags":["up to 6 tags"],"colors":["up to 4 colors"]}"""


def load_lod1_analyses() -> dict:
    if LOD1_ANALYSES_PATH.exists():
        return json.loads(LOD1_ANALYSES_PATH.read_text(encoding="utf-8"))
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


def analyze_lod1_one(
    client: httpx.Client,
    api_key: str,
    number: int,
    model: str,
    max_size: int,
    max_retries: int = 6,
) -> dict:
    path = GENERATED / f"{number}.jpg"
    if not path.exists():
        raise FileNotFoundError(path)
    if path.stat().st_size == 0:
        raise ValueError(f"Empty image file: {path}")

    # analyze.analyze_one is hardcoded to PAINTINGS path — inline the call here
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
                    f"  RETRY LOD1 #{number}: HTTP {resp.status_code}, "
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
            result["number"] = number
            result["analyzed_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            result["kind"] = "lod1"
            return result
        except httpx.HTTPStatusError as e:
            last_err = e
            if e.response.status_code in (403, 429, 500, 502, 503, 504) and attempt < max_retries - 1:
                wait = min(120, 5 * (2**attempt))
                print(
                    f"  RETRY LOD1 #{number}: HTTP {e.response.status_code}, "
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
    raise last_err or RuntimeError(f"Failed LOD1 #{number} after {max_retries} attempts")


def list_generated_nums() -> list[int]:
    nums = []
    for path in GENERATED.glob("*.jpg"):
        try:
            if path.stat().st_size <= 0:
                continue
            nums.append(int(path.stem))
        except ValueError:
            continue
    return sorted(nums)


def main():
    parser = argparse.ArgumentParser(description="AI-analyze LOD1 generated images")
    parser.add_argument("--start", type=int, default=0, help="Min LOD1 number (0 = all)")
    parser.add_argument("--end", type=int, default=0, help="Max LOD1 number (0 = all)")
    parser.add_argument("--workers", type=int, default=2)
    parser.add_argument("--delay", type=float, default=1.5, help="Seconds between completions")
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-analyze all images (refresh titles/descriptions from current files)",
    )
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--max-size", type=int, default=DEFAULT_MAX_SIZE)
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
        pending = list(all_nums)
    else:
        pending = [n for n in all_nums if str(n) not in analyses and n not in analyses]
    if not pending:
        print("All LOD1s in range already analyzed.")
        return

    print(
        f"Analyzing {len(pending)} LOD1s | model={args.model} | "
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
                    done += 1
                    title = result.get("title", "?")
                    print(f"  [{done}/{len(pending)}] LOD1 #{num}: {title}")
                except Exception as e:
                    errors += 1
                    print(f"  ERROR LOD1 #{num}: {e}", file=sys.stderr)
                if args.delay > 0:
                    time.sleep(args.delay)
                if done % 10 == 0 or done + errors == len(pending):
                    save_lod1_analyses(analyses)

    save_lod1_analyses(analyses)
    total_min = (time.time() - t_start) / 60
    print(f"Finished. {done} analyzed, {errors} errors in {total_min:.1f} min.")
    print(f"Saved to {LOD1_ANALYSES_PATH}")


if __name__ == "__main__":
    main()