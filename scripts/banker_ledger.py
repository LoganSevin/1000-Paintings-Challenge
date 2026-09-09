#!/usr/bin/env python3
"""
Sim-only supermarket bank: 50 women + 49 NPC men + Logan Sevin (male) = 100.
1:1 pairing. Fictional IINs (not real networks). Luhn check digit (mod 10).
PANs/CVVs encrypted at rest with a local HMAC+stream box.

These numbers are NOT real payment cards and cannot be used at real merchants.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import time
from pathlib import Path

GALLERY = Path(__file__).resolve().parent.parent
DATA = GALLERY / "data"
KEY_PATH = DATA / "banker.key"
VAULT_PATH = DATA / "banker-vault.json"

# Private fictional IINs — not Visa/MC/Amex/Discover issuer ranges.
IIN_CREDIT = "990001"
IIN_DEBIT = "990002"
BANK_NAME = "1000 Paintings Private Bank (SIM)"
PLAYER_ID = 100
PLAYER_FIRST = "Logan"
PLAYER_LAST = "Sevin"

FEMALE_FIRST = [
    "Amelia", "Aria", "Ava", "Bella", "Camille", "Chloe", "Daisy", "Elena", "Eliza", "Emma",
    "Fiona", "Freya", "Gia", "Grace", "Hannah", "Harper", "Isla", "Ivy", "Jade", "Jasmine",
    "Julia", "Keira", "Luna", "Maya", "Mia", "Naomi", "Nina", "Nora", "Olivia", "Paige",
    "Penelope", "Piper", "Quinn", "Ruby", "Sadie", "Sara", "Sienna", "Sofia", "Stella", "Tara",
    "Tessa", "Uma", "Violet", "Wendy", "Willa", "Wren", "Yara", "Yasmin", "Zoe", "Zora",
]
MALE_FIRST = [
    "Aaron", "Adrian", "Blake", "Caleb", "Carlos", "Daniel", "David", "Diego", "Eli", "Ethan",
    "Felix", "Gabriel", "Henry", "Hugo", "Ian", "Isaac", "Jack", "James", "Jonah", "Julian",
    "Kai", "Leo", "Liam", "Lucas", "Marco", "Mason", "Mateo", "Miles", "Nathan", "Nico",
    "Noah", "Oliver", "Oscar", "Owen", "Parker", "Peter", "Rafael", "Ryan", "Samuel", "Sebastian",
    "Theo", "Thomas", "Victor", "Vincent", "Wesley", "William", "Xavier", "Zachary", "Zane",
]
LAST_NAMES = [
    "Adler", "Alvarez", "Barrett", "Bennett", "Brooks", "Chen", "Clarke", "Cole", "Cruz", "Diaz",
    "Drake", "Ellis", "Everett", "Foster", "Frost", "Garcia", "Gibson", "Grant", "Hart", "Hayes",
    "Holt", "Huang", "Ibarra", "Ingram", "Irving", "Jensen", "Jones", "Kim", "Knight", "Lane",
    "Lawson", "Lopez", "Marsh", "Moore", "Nash", "Nguyen", "Ortiz", "Owens", "Patel", "Price",
    "Reed", "Rojas", "Santos", "Shaw", "Stone", "Torres", "Turner", "Underwood", "Vaughn", "Vega",
    "Walsh", "West", "Young", "Abbott", "Banks", "Blair", "Cobb", "Cross", "Dean", "Dunn",
    "Ford", "Glenn", "Gray", "Hill", "Ives", "Kerr", "Lang", "Lowe", "Moss", "Page",
    "Park", "Ross", "Shah", "Tate", "Voss", "Webb", "York", "Bell", "Day", "Fine",
    "Gold", "Hall", "Jung", "King", "Moon", "True", "Wood", "Boone", "Clay", "Dale",
    "Finn", "Grove", "Hahn", "Iver", "Keene", "Lynch", "Pike", "Rowe", "Sloan",
]


def luhn_checksum_mod10(number: str) -> int:
    """Luhn sum modulo 10 for a digit string (full PAN including check digit)."""
    digits = [int(c) for c in str(number) if c.isdigit()]
    total = 0
    # From the right: odd positions (1-based) are not doubled; even are doubled
    for i, d in enumerate(reversed(digits)):
        if i % 2 == 1:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return total % 10


def luhn_valid(number: str) -> bool:
    digits = "".join(c for c in str(number) if c.isdigit())
    if len(digits) < 2:
        return False
    return luhn_checksum_mod10(digits) == 0


def luhn_complete(payload: str) -> str:
    """Append the check digit that makes payload+d pass Luhn (mod 10 == 0)."""
    payload = "".join(c for c in payload if c.isdigit())
    for d in range(10):
        cand = payload + str(d)
        if luhn_valid(cand):
            return cand
    raise RuntimeError("Luhn complete failed")


def _hmac_digits(key: bytes, msg: str, n: int) -> str:
    digest = hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()
    # Map bytes to decimal digits
    acc = int.from_bytes(digest, "big")
    s = ""
    while len(s) < n:
        s += str(acc % 10)
        acc //= 10
        if acc == 0:
            acc = int.from_bytes(hashlib.sha256(digest + s.encode()).digest(), "big")
    return s[:n]


def load_or_create_key() -> bytes:
    DATA.mkdir(parents=True, exist_ok=True)
    if KEY_PATH.is_file() and KEY_PATH.stat().st_size >= 32:
        return KEY_PATH.read_bytes()[:32]
    key = os.urandom(32)
    KEY_PATH.write_bytes(key)
    try:
        os.chmod(KEY_PATH, 0o600)
    except OSError:
        pass
    return key


def encrypt_blob(plain: str, key: bytes) -> str:
    raw = plain.encode("utf-8")
    nonce = os.urandom(16)
    stream = b""
    i = 0
    while len(stream) < len(raw):
        stream += hashlib.sha256(key + nonce + i.to_bytes(8, "big")).digest()
        i += 1
    ct = bytes(a ^ b for a, b in zip(raw, stream[: len(raw)]))
    tag = hmac.new(key, nonce + ct, hashlib.sha256).digest()
    import base64

    return base64.urlsafe_b64encode(nonce + tag + ct).decode("ascii")


def decrypt_blob(token: str, key: bytes) -> str:
    import base64

    blob = base64.urlsafe_b64decode(token.encode("ascii"))
    nonce, tag, ct = blob[:16], blob[16:48], blob[48:]
    expect = hmac.new(key, nonce + ct, hashlib.sha256).digest()
    if not hmac.compare_digest(tag, expect):
        raise ValueError("vault MAC mismatch")
    stream = b""
    i = 0
    while len(stream) < len(ct):
        stream += hashlib.sha256(key + nonce + i.to_bytes(8, "big")).digest()
        i += 1
    raw = bytes(a ^ b for a, b in zip(ct, stream[: len(ct)]))
    return raw.decode("utf-8")


def _issue_card(key: bytes, *, person_id: int, kind: str, iin: str) -> dict:
    # 16-digit PAN: IIN(6) + account(9) + Luhn check(1)
    acct = _hmac_digits(key, f"pan|{kind}|{person_id}|{iin}", 9)
    pan = luhn_complete(iin + acct)
    assert len(pan) == 16
    assert luhn_valid(pan)
    exp_yy = 28 + (person_id % 4)  # 2028–2031
    exp_mm = 1 + ((person_id * (3 if kind == "credit" else 7)) % 12)
    cvv = _hmac_digits(key, f"cvv|{kind}|{person_id}|{pan}|{exp_mm:02d}{exp_yy}", 3)
    return {
        "iin": iin,
        "pan": pan,
        "last4": pan[-4:],
        "exp_mm": f"{exp_mm:02d}",
        "exp_yy": f"{exp_yy:02d}",
        "cvv": cvv,
        "brand": "Private SIM",
        "kind": kind,
        "luhn_ok": True,
        "luhn_mod10": 0,
    }


def _pair_map() -> dict[int, int]:
    """Male NPC 1–49 ↔ female 50–98; Logan 100 ↔ female 99."""
    pairs = {}
    for i in range(1, 50):
        female_id = 49 + i  # 50..98
        pairs[i] = female_id
        pairs[female_id] = i
    pairs[PLAYER_ID] = 99
    pairs[99] = PLAYER_ID
    return pairs


def _identity_for(pid: int) -> dict:
    if pid == PLAYER_ID:
        return {
            "id": PLAYER_ID,
            "first": PLAYER_FIRST,
            "last": PLAYER_LAST,
            "gender": "male",
            "is_player": True,
        }
    if 1 <= pid <= 49:
        return {
            "id": pid,
            "first": MALE_FIRST[pid - 1],
            "last": LAST_NAMES[pid - 1],
            "gender": "male",
            "is_player": False,
        }
    # 50–99 female
    fi = pid - 50
    return {
        "id": pid,
        "first": FEMALE_FIRST[fi],
        "last": LAST_NAMES[49 + fi],
        "gender": "female",
        "is_player": False,
    }


def allocate_cents(total_usd: float, n: int = 100) -> list[float]:
    cents = int(round(float(total_usd or 0) * 100))
    if n <= 0:
        return []
    base, rem = divmod(cents, n)
    out = []
    for i in range(n):
        out.append((base + (1 if i < rem else 0)) / 100.0)
    return out


def build_people(key: bytes) -> list[dict]:
    pairs = _pair_map()
    people = []
    for pid in range(1, 101):
        ident = _identity_for(pid)
        partner_id = pairs[pid]
        partner = _identity_for(partner_id)
        debit = _issue_card(key, person_id=pid, kind="debit", iin=IIN_DEBIT)
        credit = _issue_card(key, person_id=pid, kind="credit", iin=IIN_CREDIT)
        people.append(
            {
                **ident,
                "full_name": f"{ident['first']} {ident['last']}",
                "partner_id": partner_id,
                "partner_name": f"{partner['first']} {partner['last']}",
                "partner_gender": partner["gender"],
                "debit": debit,
                "credit": credit,
            }
        )
    return people


def encrypt_people(people: list[dict], key: bytes) -> list[dict]:
    out = []
    for p in people:
        row = dict(p)
        for kind in ("debit", "credit"):
            card = dict(row[kind])
            card["pan_enc"] = encrypt_blob(card.pop("pan"), key)
            card["cvv_enc"] = encrypt_blob(card.pop("cvv"), key)
            row[kind] = card
        out.append(row)
    return out


def decrypt_people(people: list[dict], key: bytes) -> list[dict]:
    out = []
    for p in people:
        row = dict(p)
        for kind in ("debit", "credit"):
            card = dict(row[kind])
            if "pan_enc" in card:
                card["pan"] = decrypt_blob(card["pan_enc"], key)
            if "cvv_enc" in card:
                card["cvv"] = decrypt_blob(card["cvv_enc"], key)
            card["luhn_ok"] = luhn_valid(card.get("pan") or "")
            card["luhn_mod10"] = luhn_checksum_mod10(card.get("pan") or "00")
            row[kind] = card
        out.append(row)
    return out


def apply_balances(people: list[dict], shares: list[float]) -> list[dict]:
    out = []
    for p in people:
        row = dict(p)
        idx = int(row["id"]) - 1
        share = float(shares[idx] if 0 <= idx < len(shares) else 0)
        debit = dict(row.get("debit") or {})
        credit = dict(row.get("credit") or {})
        debit["balance_usd"] = round(share, 2)
        debit["line_usd"] = round(share, 2)
        credit["balance_usd"] = 0.0  # unused credit
        credit["line_usd"] = round(max(share, 25.0), 2)
        credit["available_usd"] = credit["line_usd"]
        row["debit"] = debit
        row["credit"] = credit
        row["possession_usd"] = round(share, 2)
        out.append(row)
    return out


def save_vault(enc_people: list[dict], *, sim_revenue: float, shares: list[float]) -> dict:
    DATA.mkdir(parents=True, exist_ok=True)
    payload = {
        "version": 1,
        "simulated": True,
        "disclaimer": "SIMULATION ONLY. Fictional IINs. Not real bank cards. Not spendable.",
        "bank": BANK_NAME,
        "iin_credit": IIN_CREDIT,
        "iin_debit": IIN_DEBIT,
        "encryption": "HMAC-SHA256 + SHA256-counter XOR (local key data/banker.key)",
        "luhn": "ISO/IEC 7812 check digit; last digit chosen so Luhn sum ≡ 0 (mod 10)",
        "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "sim_month_revenue_usd": round(float(sim_revenue or 0), 2),
        "people_count": len(enc_people),
        "female_count": 50,
        "male_count": 50,
        "pairs": 50,
        "share_each_usd": shares[0] if shares else 0,
        "people": enc_people,
    }
    VAULT_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return payload


def load_vault() -> dict | None:
    if not VAULT_PATH.is_file():
        return None
    try:
        data = json.loads(VAULT_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def ensure_ledger(sim_revenue: float) -> dict:
    key = load_or_create_key()
    vault = load_vault()
    shares = allocate_cents(sim_revenue, 100)
    if vault and isinstance(vault.get("people"), list) and len(vault["people"]) == 100:
        people = decrypt_people(vault["people"], key)
        people = apply_balances(people, shares)
        enc = encrypt_people(people, key)
        return save_vault(enc, sim_revenue=sim_revenue, shares=shares)
    people = apply_balances(build_people(key), shares)
    enc = encrypt_people(people, key)
    return save_vault(enc, sim_revenue=sim_revenue, shares=shares)


def public_roster(vault: dict, key: bytes) -> list[dict]:
    people = decrypt_people(vault.get("people") or [], key)
    rows = []
    for p in people:
        rows.append(
            {
                "id": p["id"],
                "first": p["first"],
                "last": p["last"],
                "full_name": p["full_name"],
                "gender": p["gender"],
                "is_player": bool(p.get("is_player")),
                "partner_id": p["partner_id"],
                "partner_name": p["partner_name"],
                "partner_gender": p.get("partner_gender"),
                "possession_usd": p.get("possession_usd") or 0,
            }
        )
    rows.sort(key=lambda r: int(r["id"]))
    return rows


def banker_payload(sim_revenue: float, *, reveal_secrets: bool = True) -> dict:
    vault = ensure_ledger(sim_revenue)
    key = load_or_create_key()
    people = decrypt_people(vault.get("people") or [], key)
    shares = allocate_cents(sim_revenue, 100)
    people = apply_balances(people, shares)
    # persist updated balances (re-encrypt)
    save_vault(encrypt_people(people, key), sim_revenue=sim_revenue, shares=shares)
    out_people = []
    for p in people:
        debit = dict(p["debit"])
        credit = dict(p["credit"])
        if not reveal_secrets:
            debit.pop("pan", None)
            debit.pop("cvv", None)
            credit.pop("pan", None)
            credit.pop("cvv", None)
        debit.pop("pan_enc", None)
        debit.pop("cvv_enc", None)
        credit.pop("pan_enc", None)
        credit.pop("cvv_enc", None)
        out_people.append({**p, "debit": debit, "credit": credit})
    return {
        "ok": True,
        "simulated": True,
        "disclaimer": vault.get("disclaimer"),
        "bank": BANK_NAME,
        "iin_credit": IIN_CREDIT,
        "iin_debit": IIN_DEBIT,
        "encryption": vault.get("encryption"),
        "luhn": vault.get("luhn"),
        "updated_at": vault.get("updated_at"),
        "sim_month_revenue_usd": round(float(sim_revenue or 0), 2),
        "people_count": 100,
        "female_count": 50,
        "male_npc_count": 49,
        "player": {
            "id": PLAYER_ID,
            "full_name": f"{PLAYER_FIRST} {PLAYER_LAST}",
            "gender": "male",
        },
        "pairs": 50,
        "share_each_usd": shares[0] if shares else 0,
        "people": out_people,
        "roster": [
            {
                "id": p["id"],
                "first": p["first"],
                "last": p["last"],
                "full_name": p["full_name"],
                "gender": p["gender"],
                "is_player": bool(p.get("is_player")),
                "partner_id": p["partner_id"],
                "partner_name": p["partner_name"],
            }
            for p in out_people
        ],
    }


if __name__ == "__main__":
    # Self-check Luhn Wikipedia example 79927398713
    assert luhn_valid("79927398713"), "Wikipedia Luhn example failed"
    assert luhn_complete("7992739871") == "79927398713"
    p = banker_payload(12345.67)
    assert len(p["people"]) == 100
    males = sum(1 for x in p["people"] if x["gender"] == "male")
    females = sum(1 for x in p["people"] if x["gender"] == "female")
    assert males == 50 and females == 50
    for x in p["people"]:
        assert luhn_valid(x["debit"]["pan"])
        assert luhn_valid(x["credit"]["pan"])
        assert x["debit"]["pan"].startswith(IIN_DEBIT)
        assert x["credit"]["pan"].startswith(IIN_CREDIT)
        assert x["partner_id"]
    me = next(x for x in p["people"] if x["id"] == 100)
    assert me["full_name"] == "Logan Sevin"
    print("banker ok", me["full_name"], "share", me["possession_usd"], "pan last4", me["debit"]["last4"])
