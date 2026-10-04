"""
Push description JSON to GitHub so Netlify updates https://logan7in.art
without a full image deploy. Called at the end of analyze scripts.

Each description publish is an 8-character code. Its still titles and
descriptions are filed in data/codes.json for the Codes tab.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

GALLERY = Path(__file__).resolve().parent.parent
CODES_JSON = GALLERY / "data" / "codes.json"
CODES_MD = GALLERY / "CODES.md"
PATHS = [
    "data/analyses.json",
    "data/lod1-analyses.json",
    "data/lod1-manifest.json",
    "data/sketch-analyses.json",
    "data/phone-upload-analyses.json",
    "generated-meta",
]
META_NAME = re.compile(r"^generated-meta/(\d+)\.json$")
SEED = {
    "1b9cfd4f": {
        "outcome": "Cameos opens with no key wall.",
        "href": "#cameos",
    },
    "3c87f1e7": {
        "outcome": "Grok generates a new Cameos short from the uploaded reference, in the Eve voice.",
        "href": "#cameos",
    },
}


def run(args: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        args,
        cwd=str(GALLERY),
        text=True,
        capture_output=True,
    )


def read_blobs(rev: str, paths: list[str]) -> dict[str, bytes]:
    if not paths:
        return {}
    spec = "".join(f"{rev}:{path}\n" for path in paths).encode()
    proc = subprocess.run(
        ["git", "cat-file", "--batch"],
        cwd=str(GALLERY),
        input=spec,
        capture_output=True,
    )
    if proc.returncode != 0:
        return {}
    out = proc.stdout
    found: dict[str, bytes] = {}
    index = 0
    for path in paths:
        newline = out.find(b"\n", index)
        if newline < 0:
            break
        header = out[index:newline].decode("utf-8", "replace")
        index = newline + 1
        if header.endswith(" missing"):
            continue
        parts = header.split()
        if len(parts) < 3:
            continue
        try:
            size = int(parts[2])
        except ValueError:
            continue
        found[path] = out[index : index + size]
        index += size
        if index < len(out) and out[index : index + 1] == b"\n":
            index += 1
    return found


def stills_from_commit(rev: str) -> list[dict]:
    listed = run(["git", "diff-tree", "--no-commit-id", "--name-only", "-r", rev])
    paths = []
    for line in (listed.stdout or "").splitlines():
        name = line.strip().replace("\\", "/")
        if META_NAME.match(name):
            paths.append(name)
    blobs = read_blobs(rev, paths)
    stills = []
    for path in paths:
        raw = blobs.get(path)
        if not raw:
            continue
        try:
            data = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            continue
        if not isinstance(data, dict):
            continue
        match = META_NAME.match(path)
        stills.append(
            {
                "number": int(match.group(1)) if match else 0,
                "title": str(data.get("title") or "").strip(),
                "description": str(data.get("description") or "").strip(),
            }
        )
    stills.sort(key=lambda row: row["number"])
    return stills


def outcome_for(stills: list[dict]) -> str:
    count = len(stills)
    if count == 1:
        still = stills[0]
        title = f", {still['title']}" if still.get("title") else ""
        return f"Description for generated still #{still['number']}{title}."
    numbers = [row["number"] for row in stills]
    if numbers[-1] - numbers[0] + 1 == count:
        span = f"#{numbers[0]}–#{numbers[-1]}"
    else:
        span = f"from #{numbers[0]} to #{numbers[-1]}"
    return f"Descriptions for {count} generated stills, {span}."


def load_book() -> dict:
    if not CODES_JSON.is_file():
        return {}
    try:
        data = json.loads(CODES_JSON.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def color_note(code: str) -> str:
    if re.fullmatch(r"[0-9a-f]{8}", code):
        return f" `#{code[:6]}` at alpha `{code[6:]}`."
    return ""


def write_codes_md(book: dict) -> None:
    existing = CODES_MD.read_text(encoding="utf-8") if CODES_MD.is_file() else ""
    head, _sep, _rest = existing.partition("## Occupied")
    if not head.strip():
        head = (
            "# Reference codes\n\n"
            "An 8-character code is the reference point for one solution. "
            "Decisions look up the code and read the outcome that already succeeded.\n\n"
        )
    rows = ["| Code | Outcome |", "| --- | --- |"]
    for code, row in book.items():
        if not isinstance(row, dict):
            continue
        outcome = str(row.get("outcome") or "").replace("|", "/")
        rows.append(f"| `{code}` | {outcome}{color_note(code)} |")
    tail = (
        "\nThe statement for `3c87f1e7` is [CAMEOS.md](CAMEOS.md). "
        "Each description publish files its commit code here. "
        "The Codes tab keeps that publish’s still titles and descriptions. "
        "The lookup tab is `#codes`.\n"
    )
    CODES_MD.write_text(
        head.rstrip() + "\n\n## Occupied\n\n" + "\n".join(rows) + "\n" + tail,
        encoding="utf-8",
    )


def save_book(book: dict) -> None:
    CODES_JSON.parent.mkdir(parents=True, exist_ok=True)
    CODES_JSON.write_text(
        json.dumps(book, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    write_codes_md(book)


def apply_stills(book: dict, stills: list[dict]) -> None:
    """Copy newer titles and descriptions onto stills already filed under other codes."""
    by_number: dict[int, dict] = {}
    for row in stills:
        if not isinstance(row, dict):
            continue
        try:
            by_number[int(row["number"])] = row
        except (KeyError, TypeError, ValueError):
            continue
    for record in book.values():
        if not isinstance(record, dict):
            continue
        rows = record.get("stills")
        if not isinstance(rows, list):
            continue
        for row in rows:
            if not isinstance(row, dict):
                continue
            try:
                number = int(row.get("number"))
            except (TypeError, ValueError):
                continue
            fresh = by_number.get(number)
            if not fresh:
                continue
            title = str(fresh.get("title") or "").strip()
            description = str(fresh.get("description") or "").strip()
            if title:
                row["title"] = title
            if description:
                row["description"] = description


def file_description_commit(rev: str, *, refresh_others: bool = True) -> str:
    """File one description publish under the first 8 characters of its hash."""
    stills = stills_from_commit(rev)
    if not stills:
        return ""
    code = rev.strip().lower()[:8]
    record = {
        "outcome": outcome_for(stills),
        "href": "#codes",
        "kind": "descriptions",
        "stills": stills,
    }
    book = load_book()
    fresh: dict = {}
    for key, seed in SEED.items():
        current = book.get(key)
        fresh[key] = current if isinstance(current, dict) else dict(seed)
    fresh[code] = record
    for key, value in book.items():
        if key not in fresh:
            fresh[key] = value
    if refresh_others:
        apply_stills(fresh, stills)
    save_book(fresh)
    return code


def file_all_description_publishes() -> list[str]:
    listed = run(["git", "log", "--pretty=%H", "--grep=Auto-publish descriptions"])
    revs = [line.strip() for line in (listed.stdout or "").splitlines() if line.strip()]
    revs.reverse()
    filed = []
    last = len(revs) - 1
    for index, rev in enumerate(revs):
        code = file_description_commit(rev, refresh_others=index == last)
        if code:
            filed.append(code)
    return filed


def commit_codes(code: str) -> int:
    add = run(["git", "add", "--", "data/codes.json", "CODES.md"])
    if add.returncode != 0:
        print(add.stderr or add.stdout or "git add codes failed", file=sys.stderr)
        return add.returncode
    status = run(["git", "status", "--porcelain", "--", "data/codes.json", "CODES.md"])
    if not (status.stdout or "").strip():
        print(f"Codes already have {code}.")
        return 0
    message = f"File description publish {code} in Codes [deploy]"
    commit = run(["git", "commit", "-m", message])
    if commit.returncode != 0:
        err = (commit.stderr or commit.stdout or "").strip()
        if "nothing to commit" in err.lower():
            return 0
        print(err or "git commit failed", file=sys.stderr)
        return commit.returncode
    push = run(["git", "push", "origin", "HEAD:main"])
    if push.returncode != 0:
        print(push.stderr or push.stdout or "git push failed", file=sys.stderr)
        return push.returncode
    print(f"Filed {code} in Codes.")
    return 0


def main() -> int:
    add = run(["git", "add", "--"] + PATHS)
    if add.returncode != 0:
        print(add.stderr or add.stdout or "git add failed", file=sys.stderr)
        return add.returncode

    status = run(["git", "status", "--porcelain", "--"] + PATHS)
    if not (status.stdout or "").strip():
        print("Descriptions already match git — nothing to publish.")
        return 0

    message = "Auto-publish descriptions to logan7in.art [deploy]"
    commit = run(["git", "commit", "-m", message])
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

    rev = (run(["git", "rev-parse", "HEAD"]).stdout or "").strip()
    code = file_description_commit(rev) if rev else ""
    if code:
        filed = commit_codes(code)
        if filed != 0:
            print(
                f"Descriptions published as {code}, and Codes still needs that file.",
                file=sys.stderr,
            )
            return filed
    print("Published descriptions. https://logan7in.art will update after the Netlify build.")
    return 0


if __name__ == "__main__":
    if "--file-existing" in sys.argv:
        codes = file_all_description_publishes()
        print("Filed " + (", ".join(codes) if codes else "none"))
        raise SystemExit(0)
    raise SystemExit(main())
