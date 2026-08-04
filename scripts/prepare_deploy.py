"""Copy paintings into gallery/paintings/ for static hosting."""
import shutil
from pathlib import Path

GALLERY = Path(__file__).resolve().parent.parent
SRC = GALLERY.parent / "1000 Paintings Challenge"
DST = GALLERY / "paintings"


def main():
    if not SRC.is_dir():
        raise SystemExit(f"Source not found: {SRC}")

    DST.mkdir(parents=True, exist_ok=True)
    copied = skipped = 0

    for n in range(1, 1001):
        src = SRC / f"{n}.jpg"
        dst = DST / f"{n}.jpg"
        if not src.exists():
            print(f"  missing: {src.name}")
            continue
        if dst.exists() and dst.stat().st_size == src.stat().st_size:
            skipped += 1
            continue
        shutil.copy2(src, dst)
        copied += 1

    total = len(list(DST.glob("*.jpg")))
    print(f"Ready for deploy: {total} images in {DST}")
    print(f"  copied: {copied}, skipped (unchanged): {skipped}")
    print(f"\nDeploy the entire folder:\n  {GALLERY}")


if __name__ == "__main__":
    main()