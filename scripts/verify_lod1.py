#!/usr/bin/env python3
"""Spot-check stored LOD1 analyses against fresh vision API results."""
from __future__ import annotations

import argparse
import json
import random
import sys
from pathlib import Path

import httpx

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))
from analyze import DEFAULT_MAX_SIZE, DEFAULT_MODEL, get_api_key  # noqa: E402
from analyze_lod1 import analyze_lod1_one, load_lod1_analyses  # noqa: E402


def token_sim(a: str, b: str) -> float:
    aw = set(a.lower().split())
    bw = set(b.lower().split())
    if not aw or not bw:
        return 0.0
    return len(aw & bw) / len(aw | bw)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sample", type=int, default=30, help="Random sample size")
    parser.add_argument("--nums", type=str, default="", help="Comma-separated numbers")
    parser.add_argument("--threshold", type=float, default=0.12, help="Title sim below = suspect")
    args = parser.parse_args()

    stored = load_lod1_analyses()
    if args.nums.strip():
        nums = [int(x.strip()) for x in args.nums.split(",") if x.strip()]
    else:
        pool = sorted(int(k) for k in stored)
        nums = sorted(random.sample(pool, min(args.sample, len(pool))))

    api_key = get_api_key()
    suspects: list[dict] = []
    with httpx.Client() as client:
        for num in nums:
            entry = stored.get(str(num)) or stored.get(num)
            if not entry:
                print(f"#{num}: missing stored analysis")
                continue
            fresh = analyze_lod1_one(
                client, api_key, num, DEFAULT_MODEL, DEFAULT_MAX_SIZE
            )
            ts = token_sim(entry.get("title", ""), fresh.get("title", ""))
            ds = token_sim(
                str(entry.get("description", ""))[:160],
                str(fresh.get("description", ""))[:160],
            )
            status = "ok" if ts >= args.threshold or ds >= 0.18 else "SUSPECT"
            print(
                f"#{num} [{status}] title_sim={ts:.2f} desc_sim={ds:.2f}\n"
                f"  stored: {entry.get('title')}\n"
                f"  fresh:  {fresh.get('title')}"
            )
            if status == "SUSPECT":
                suspects.append(
                    {
                        "num": num,
                        "title_sim": ts,
                        "desc_sim": ds,
                        "stored_title": entry.get("title"),
                        "fresh_title": fresh.get("title"),
                    }
                )

    print(f"\nChecked {len(nums)} | suspects {len(suspects)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())