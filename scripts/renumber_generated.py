#!/usr/bin/env python3
"""Delete empty generated images and renumber remaining files to 1..N with no gaps."""
from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from pathlib import Path

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".avif"}

SCRIPT_DIR = Path(__file__).resolve().parent
GALLERY = SCRIPT_DIR.parent
GENERATED_DIR = GALLERY / "generated"
ANALYSES_PATH = GALLERY / "data" / "lod1-analyses.json"
MANIFEST_PATH = GALLERY / "data" / "lod1-manifest.json"
MAP_PATH = GALLERY / "data" / "lod1-renumber-map.json"
TEMP_PREFIX = "__renumber_tmp_"
GENERATED_URL_RE = re.compile(r"/generated/(\d+)(\.\w+)", re.I)


def list_numeric_images(folder: Path) -> list[tuple[int, Path]]:
    items: list[tuple[int, Path]] = []
    for entry in folder.iterdir():
        if not entry.is_file():
            continue
        if entry.suffix.lower() not in IMAGE_EXTENSIONS:
            continue
        if entry.name.startswith(TEMP_PREFIX):
            continue
        if not entry.stem.isdigit():
            continue
        items.append((int(entry.stem), entry))
    items.sort(key=lambda x: x[0])
    return items


def delete_empty_files(dry_run: bool) -> list[int]:
    removed: list[int] = []
    for num, path in list_numeric_images(GENERATED_DIR):
        if path.stat().st_size > 0:
            continue
        removed.append(num)
        if dry_run:
            print(f"  would delete empty: {path.name}")
        else:
            path.unlink()
            print(f"  deleted empty: {path.name}")
    return removed


def build_mapping(valid_items: list[tuple[int, Path]]) -> dict[int, int]:
    return {old: new for new, (old, _path) in enumerate(valid_items, start=1)}


def save_mapping(mapping: dict[int, int], dry_run: bool) -> None:
    payload = {str(old): new for old, new in mapping.items()}
    if dry_run:
        print(f"  would save mapping ({len(mapping)} entries)")
        return
    MAP_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def load_mapping_from_analyses() -> dict[int, int]:
    if not ANALYSES_PATH.is_file():
        return {}
    raw = json.loads(ANALYSES_PATH.read_text(encoding="utf-8"))
    old_nums = sorted(int(k) for k in raw.keys())
    return {old: new for new, old in enumerate(old_nums, start=1)}


def renumber_files(valid_items: list[tuple[int, Path]], dry_run: bool) -> list[tuple[Path, Path]]:
    mapping = build_mapping(valid_items)
    save_mapping(mapping, dry_run)
    total = len(valid_items)
    pad = len(str(total))
    final_moves: list[tuple[Path, Path]] = []

    for old, path in valid_items:
        new = mapping[old]
        ext = path.suffix.lower()
        final = GENERATED_DIR / f"{new}{ext}"
        final_moves.append((path, final))

    if dry_run:
        print("Dry run — first 8 renames:")
        for src, final in final_moves[:8]:
            print(f"  {src.name} -> {final.name}")
        if total > 8:
            print(f"  … and {total - 8} more")
        return final_moves

    temp_moves: list[tuple[Path, Path]] = []
    for old, path in valid_items:
        new = mapping[old]
        tmp = GENERATED_DIR / f"{TEMP_PREFIX}{new:0{pad}d}{path.suffix.lower()}"
        if tmp.exists():
            print(f"Abort: temp file already exists: {tmp.name}", file=sys.stderr)
            raise SystemExit(1)
        temp_moves.append((path, tmp))

    for src, tmp in temp_moves:
        if src.resolve() != tmp.resolve():
            src.rename(tmp)

    for (_src, tmp), (_orig, final) in zip(temp_moves, final_moves):
        if tmp.resolve() == final.resolve():
            continue
        if final.exists():
            print(f"Abort: target already exists: {final.name}", file=sys.stderr)
            raise SystemExit(1)
        tmp.rename(final)

    print(f"Renamed {total} files to 1{final_moves[0][1].suffix} … {total}{final_moves[-1][1].suffix}")
    return final_moves


def remap_analyses(mapping: dict[int, int], dry_run: bool) -> int:
    if not ANALYSES_PATH.is_file():
        return 0
    raw = json.loads(ANALYSES_PATH.read_text(encoding="utf-8"))
    remapped: dict = {}
    moved = 0
    for key, entry in raw.items():
        try:
            old = int(key)
        except ValueError:
            old = int(entry.get("number", key))
        new = mapping.get(old)
        if new is None:
            continue
        if isinstance(entry, dict):
            entry = dict(entry)
            entry["number"] = new
        remapped[str(new)] = entry
        if old != new:
            moved += 1
    if dry_run:
        print(f"  would remap {len(remapped)} analyses ({moved} numbers change)")
        return len(remapped)
    backup = ANALYSES_PATH.with_suffix(".json.pre-renumber.bak")
    shutil.copy2(ANALYSES_PATH, backup)
    ANALYSES_PATH.write_text(
        json.dumps(remapped, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    print(f"Wrote analyses: {ANALYSES_PATH} ({len(remapped)} entries, backup {backup.name})")
    return len(remapped)


def write_manifest(count: int, dry_run: bool) -> None:
    items = [
        {"num": n, "name": f"{n}.jpg", "url": f"/generated/{n}.jpg"}
        for n in range(1, count + 1)
    ]
    payload = {"version": 1, "count": count, "items": items}
    if dry_run:
        print(f"  would write manifest with {count} items")
        return
    MANIFEST_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"Wrote manifest: {MANIFEST_PATH} ({count} items)")


def remap_url(url: str, mapping: dict[int, int]) -> str:
    def repl(match: re.Match[str]) -> str:
        old = int(match.group(1))
        new = mapping.get(old)
        if new is None:
            return match.group(0)
        return f"/generated/{new}{match.group(2)}"

    return GENERATED_URL_RE.sub(repl, url)


def remap_json_value(value, mapping: dict[int, int]):
    if isinstance(value, str):
        if "/generated/" in value:
            return remap_url(value, mapping)
        return value
    if isinstance(value, list):
        return [remap_json_value(v, mapping) for v in value]
    if isinstance(value, dict):
        return {k: remap_json_value(v, mapping) for k, v in value.items()}
    return value


def update_studio_json_refs(mapping: dict[int, int], dry_run: bool) -> int:
    updated_files = 0
    for folder_name in ("characters", "objects", "rooms"):
        root = GALLERY / folder_name
        if not root.is_dir():
            continue
        for meta_path in root.rglob("*.json"):
            try:
                data = json.loads(meta_path.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                continue
            new_data = remap_json_value(data, mapping)
            if new_data == data:
                continue
            updated_files += 1
            if dry_run:
                print(f"  would update refs in {meta_path.relative_to(GALLERY)}")
            else:
                meta_path.write_text(
                    json.dumps(new_data, indent=2, ensure_ascii=False) + "\n",
                    encoding="utf-8",
                )
                print(f"Updated refs: {meta_path.relative_to(GALLERY)}")
    return updated_files


def finalize_temp_files(dry_run: bool) -> list[tuple[int, Path]] | None:
    temps = sorted(
        GENERATED_DIR.glob(f"{TEMP_PREFIX}*"),
        key=lambda p: int(p.stem.replace(TEMP_PREFIX, "")),
    )
    if not temps:
        return None
    print(f"Finalizing {len(temps)} temp files from interrupted run")
    items: list[tuple[int, Path]] = []
    for tmp in temps:
        num = int(tmp.stem.replace(TEMP_PREFIX, ""))
        final = GENERATED_DIR / f"{num}{tmp.suffix.lower()}"
        items.append((num, final))
        if dry_run:
            print(f"  {tmp.name} -> {final.name}")
            continue
        if final.exists():
            print(f"Abort: target already exists: {final.name}", file=sys.stderr)
            raise SystemExit(1)
        tmp.rename(final)
    if not dry_run:
        print(f"Finalized {len(temps)} files to 1.jpg … {len(temps)}.jpg")
    return items


def compact_generated(dry_run: bool = False) -> int:
    if not GENERATED_DIR.is_dir():
        print(f"Missing folder: {GENERATED_DIR}", file=sys.stderr)
        return 1

    print(f"Scanning {GENERATED_DIR}")
    mapping: dict[int, int] | None = None
    temps = list(GENERATED_DIR.glob(f"{TEMP_PREFIX}*"))

    if temps:
        if dry_run:
            finalize_temp_files(dry_run=True)
            mapping = load_mapping_from_analyses()
            count = len(temps)
        else:
            finalized = finalize_temp_files(dry_run=False) or []
            count = len(finalized)
            mapping = load_mapping_from_analyses()
    else:
        removed = delete_empty_files(dry_run)
        print(f"Empty files: {len(removed)}")
        valid_items = [(n, p) for n, p in list_numeric_images(GENERATED_DIR) if p.stat().st_size > 0]
        if not valid_items:
            print("No valid images remain.")
            return 1
        mapping = build_mapping(valid_items)
        gaps = sum(1 for new, (old, _) in enumerate(valid_items, start=1) if old != new)
        print(f"Valid images: {len(valid_items)} | renames needed: {gaps}")
        renumber_files(valid_items, dry_run)
        count = len(valid_items)

    if not mapping:
        print("Could not build old→new mapping.", file=sys.stderr)
        return 1

    remap_analyses(mapping, dry_run)
    write_manifest(count, dry_run)
    refs = update_studio_json_refs(mapping, dry_run)
    print(f"Studio JSON files updated: {refs}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Show planned changes only")
    args = parser.parse_args()
    return compact_generated(dry_run=args.dry_run)


if __name__ == "__main__":
    raise SystemExit(main())