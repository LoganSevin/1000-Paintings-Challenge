"""Generate manifest.json listing all paintings 1-1000."""
import json
from pathlib import Path

GALLERY = Path(__file__).resolve().parent.parent
PAINTINGS = GALLERY.parent / "1000 Paintings Challenge"
MANIFEST = GALLERY / "data" / "manifest.json"


def main():
    items = []
    for n in range(1, 1001):
        path = PAINTINGS / f"{n}.jpg"
        if path.exists():
            items.append({
                "number": n,
                "filename": f"{n}.jpg",
                "size_bytes": path.stat().st_size,
            })
    MANIFEST.write_text(json.dumps(items, indent=2), encoding="utf-8")
    print(f"Wrote {len(items)} entries to {MANIFEST}")


if __name__ == "__main__":
    main()