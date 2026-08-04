"""Rename saved-fallout compass tiles to 1.png, 2.png, … per cardinal folder."""
from __future__ import annotations

import sys
from pathlib import Path

GALLERY = Path(__file__).resolve().parent.parent
FALLOUT_SAVE_ROOT = GALLERY / "saved-fallout"
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".avif"}

FALLOUT_COMPASS_DIRS = {
    "n": "north",
    "ne": "northeast",
    "e": "east",
    "se": "southeast",
    "s": "south",
    "sw": "southwest",
    "w": "west",
    "nw": "northwest",
}


def rename_folder(folder: Path) -> int:
    if not folder.is_dir():
        return 0
    files = sorted(
        (
            f
            for f in folder.iterdir()
            if f.is_file() and f.suffix.lower() in IMAGE_EXTENSIONS
        ),
        key=lambda p: (p.stat().st_mtime, p.name.lower()),
    )
    if not files:
        return 0
    temps: list[Path] = []
    for i, src in enumerate(files):
        temp = folder / f"__fallout_ren_{i:06d}{src.suffix.lower()}"
        src.rename(temp)
        temps.append(temp)
    for i, temp in enumerate(temps, start=1):
        dest = folder / f"{i}{temp.suffix.lower()}"
        temp.rename(dest)
    return len(temps)


def main() -> int:
    total = 0
    seen: set[str] = set()
    for label in FALLOUT_COMPASS_DIRS.values():
        folder = FALLOUT_SAVE_ROOT / label
        seen.add(label)
        n = rename_folder(folder)
        if n:
            print(f"{label}: renamed {n} files → 1…{n}")
        total += n
    if FALLOUT_SAVE_ROOT.is_dir():
        for sub in sorted(FALLOUT_SAVE_ROOT.iterdir()):
            if sub.is_dir() and sub.name not in seen:
                n = rename_folder(sub)
                if n:
                    print(f"{sub.name}: renamed {n} files → 1…{n}")
                total += n
    print(f"Done — {total} fallout files renumbered.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())