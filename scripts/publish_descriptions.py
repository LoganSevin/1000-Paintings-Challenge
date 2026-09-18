"""
Push description JSON to GitHub so Netlify updates https://logan7in.art
without a full image deploy. Called at the end of analyze scripts.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

GALLERY = Path(__file__).resolve().parent.parent
PATHS = [
    "data/analyses.json",
    "data/lod1-analyses.json",
    "data/lod1-manifest.json",
    "data/sketch-analyses.json",
    "data/phone-upload-analyses.json",
    "generated-meta",
]


def run(args: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        args,
        cwd=str(GALLERY),
        text=True,
        capture_output=True,
    )


def main() -> int:
    add = run(["git", "add", "--"] + PATHS)
    if add.returncode != 0:
        print(add.stderr or add.stdout or "git add failed", file=sys.stderr)
        return add.returncode

    st = run(["git", "status", "--porcelain", "--"] + PATHS)
    if not (st.stdout or "").strip():
        print("Descriptions already match git — nothing to publish.")
        return 0

    msg = "Auto-publish descriptions to logan7in.art"
    commit = run(["git", "commit", "-m", msg])
    if commit.returncode != 0:
        err = (commit.stderr or commit.stdout or "").strip()
        if "nothing to commit" in err.lower():
            print("Nothing to commit.")
            return 0
        print(err or "git commit failed", file=sys.stderr)
        return commit.returncode

    push = run(["git", "push", "origin", "HEAD:main"])
    if push.returncode != 0:
        print(push.stderr or push.stdout or "git push failed", file=sys.stderr)
        print("Descriptions saved locally but did not reach Netlify.", file=sys.stderr)
        return push.returncode

    print("Published descriptions. https://logan7in.art will update after the Netlify build.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
