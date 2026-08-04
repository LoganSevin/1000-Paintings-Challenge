#!/usr/bin/env python3
"""Print gallery sales stats and optionally mark pending orders completed."""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

GALLERY = Path(__file__).resolve().parent.parent
ORDERS_PATH = GALLERY / "data" / "gallery-orders.json"


def load_orders() -> list:
    if not ORDERS_PATH.is_file():
        return []
    data = json.loads(ORDERS_PATH.read_text(encoding="utf-8"))
    return data if isinstance(data, list) else []


def save_orders(orders: list) -> None:
    ORDERS_PATH.write_text(json.dumps(orders, indent=2, ensure_ascii=False), encoding="utf-8")


def compute_stats(orders: list) -> dict:
    pieces = revenue = completed = pending = 0
    for order in orders:
        status = str(order.get("status") or "pending").lower()
        count = len(order.get("items") or [])
        total = float(order.get("total") or 0)
        if status == "completed":
            completed += 1
            pieces += count
            revenue += total
        elif status == "pending":
            pending += 1
    return {
        "pieces_sold": pieces,
        "orders_completed": completed,
        "revenue_raised": round(revenue, 2),
        "pending_orders": pending,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Gallery sales bookkeeping report")
    parser.add_argument("--complete-pending", action="store_true", help="Mark all pending orders completed")
    parser.add_argument("--complete", metavar="ORDER_ID", help="Mark one order completed by id")
    args = parser.parse_args()

    orders = load_orders()
    changed = False
    if args.complete_pending:
        for order in orders:
            if str(order.get("status") or "").lower() != "completed":
                order["status"] = "completed"
                order["completed_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                changed = True
    elif args.complete:
        for order in orders:
            if str(order.get("id")) == args.complete:
                order["status"] = "completed"
                order["completed_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                changed = True
                break
        else:
            print(f"Order not found: {args.complete}")
            return 1

    if changed:
        save_orders(orders)

    stats = compute_stats(orders)
    print(f"Pieces sold:      {stats['pieces_sold']}")
    print(f"Orders completed: {stats['orders_completed']}")
    print(f"Revenue raised:   ${stats['revenue_raised']:.0f}")
    print(f"Pending orders:   {stats['pending_orders']}")
    print(f"Log file:         {ORDERS_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())