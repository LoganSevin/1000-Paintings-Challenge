"""
Analyze paintings with xAI vision API.
Resumes from data/analyses.json — safe to interrupt and rerun.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from io import BytesIO
from pathlib import Path

import httpx
from PIL import Image

GALLERY = Path(__file__).resolve().parent.parent
PAINTINGS = GALLERY.parent / "1000 Paintings Challenge"
ANALYSES_PATH = GALLERY / "data" / "analyses.json"
AUTH_PATH = Path.home() / ".grok" / "auth.json"

API_URL = "https://api.x.ai/v1/responses"
DEFAULT_MODEL = "grok-4.20-0309-non-reasoning"
DEFAULT_WORKERS = 10
DEFAULT_MAX_SIZE = 512

# Refresh slightly before expiry so Conceptualizer / generate don't hit mid-request 401s
_OAUTH_REFRESH_SKEW_SEC = 120
_OAUTH_TOKEN_URL = "https://auth.x.ai/oauth2/token"

PROMPT = """Artwork photo from a daily painting challenge. Return ONLY JSON:
{"title":"max 6 words","description":"2 sentences","style":"category","medium":"guess","mood":"1-3 words","tags":["up to 6 tags"],"colors":["up to 4 colors"]}"""


def _looks_like_api_key(key: str) -> bool:
    """Console API keys look like xai-… ; OAuth access tokens are JWTs (eyJ…)."""
    k = str(key or "").strip()
    if not k:
        return False
    if k.startswith("xai-") or k.startswith("xai_"):
        return True
    # Some keys are long hex without JWT dots
    if k.startswith("eyJ"):
        return False
    if k.count(".") >= 2 and len(k) > 200:
        return False  # JWT-shaped
    return len(k) >= 20


def _looks_like_oauth_jwt(key: str) -> bool:
    k = str(key or "").strip()
    return k.startswith("eyJ") and k.count(".") >= 2


def _jwt_exp_unix(token: str) -> float | None:
    try:
        parts = token.split(".")
        if len(parts) < 2:
            return None
        pad = "=" * ((4 - len(parts[1]) % 4) % 4)
        payload = json.loads(base64.urlsafe_b64decode(parts[1] + pad))
        exp = payload.get("exp")
        return float(exp) if exp is not None else None
    except Exception:
        return None


def _clean_key_string(raw: str) -> str:
    k = str(raw or "").strip().strip('"').strip("'")
    if k.lower().startswith("bearer "):
        k = k[7:].strip()
    # Allow "XAI_API_KEY=xai-..." lines
    if "=" in k and k.upper().split("=", 1)[0].strip() in (
        "XAI_API_KEY",
        "XAI_KEY",
        "GROK_API_KEY",
        "API_KEY",
    ):
        k = k.split("=", 1)[1].strip().strip('"').strip("'")
    return k.strip()


def _read_key_file(path: Path) -> str:
    try:
        if not path.is_file():
            return ""
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            return _clean_key_string(line)
        return ""
    except OSError:
        return ""


def bootstrap_xai_api_key_env() -> str:
    """
    If XAI_API_KEY is unset, load from portable key files into os.environ.
    Returns a short source label or ''.
    """
    existing = _clean_key_string(
        os.environ.get("XAI_API_KEY")
        or os.environ.get("XAI_KEY")
        or os.environ.get("GROK_API_KEY")
        or ""
    )
    if existing:
        os.environ["XAI_API_KEY"] = existing
        return "environment"

    for path in (
        GALLERY / "data" / "xai-api-key.txt",
        GALLERY / ".xai-api-key",
        Path.home() / ".grok" / "api-key.txt",
        Path.home() / ".config" / "grok" / "api-key.txt",
    ):
        file_key = _read_key_file(path)
        if file_key:
            os.environ["XAI_API_KEY"] = file_key
            return str(path)
    return ""


def _iter_auth_entries() -> list[tuple[str, dict]]:
    if not AUTH_PATH.is_file():
        return []
    try:
        data = json.loads(AUTH_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    out = []
    if isinstance(data, dict):
        for k, v in data.items():
            if isinstance(v, dict):
                out.append((str(k), v))
    return out


def _save_auth_entry(entry_key: str, entry: dict) -> None:
    try:
        data = {}
        if AUTH_PATH.is_file():
            data = json.loads(AUTH_PATH.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            data = {}
        data[entry_key] = entry
        AUTH_PATH.parent.mkdir(parents=True, exist_ok=True)
        AUTH_PATH.write_text(json.dumps(data, indent=2), encoding="utf-8")
    except OSError:
        pass


def _refresh_oauth_entry(entry_key: str, entry: dict) -> str:
    """Refresh OIDC access token via auth.x.ai; returns new access token or ''."""
    refresh = str(entry.get("refresh_token") or "").strip()
    if not refresh:
        return ""
    client_id = str(
        entry.get("oidc_client_id")
        or entry.get("client_id")
        or os.environ.get("XAI_OIDC_CLIENT_ID")
        or ""
    ).strip()
    # Fall back to issuer key fragment from auth.json map key
    if not client_id and "::" in entry_key:
        client_id = entry_key.split("::", 1)[-1].strip()
    if not client_id:
        return ""

    try:
        with httpx.Client(timeout=20.0) as client:
            resp = client.post(
                _OAUTH_TOKEN_URL,
                data={
                    "grant_type": "refresh_token",
                    "refresh_token": refresh,
                    "client_id": client_id,
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
            if resp.status_code >= 400:
                return ""
            payload = resp.json()
    except Exception:
        return ""

    access = str(payload.get("access_token") or "").strip()
    if not access:
        return ""
    entry = dict(entry)
    entry["key"] = access
    if payload.get("refresh_token"):
        entry["refresh_token"] = payload["refresh_token"]
    # expires_in seconds
    try:
        expires_in = int(payload.get("expires_in") or 0)
    except (TypeError, ValueError):
        expires_in = 0
    if expires_in > 0:
        from datetime import datetime, timezone, timedelta

        entry["expires_at"] = (
            datetime.now(timezone.utc) + timedelta(seconds=expires_in)
        ).isoformat().replace("+00:00", "Z")
    _save_auth_entry(entry_key, entry)
    return access


def _oauth_needs_refresh(token: str, entry: dict) -> bool:
    exp = _jwt_exp_unix(token)
    if exp is None:
        # Fall back to expires_at field
        raw = str(entry.get("expires_at") or "").strip()
        if not raw:
            return False
        try:
            from datetime import datetime, timezone

            # Handle trailing Z and fractional seconds
            cleaned = raw.replace("Z", "+00:00")
            dt = datetime.fromisoformat(cleaned)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            exp = dt.timestamp()
        except Exception:
            return False
    return exp <= (time.time() + _OAUTH_REFRESH_SKEW_SEC)


def get_api_key(*, allow_oauth: bool = True, force_refresh: bool = False) -> str:
    """
    Resolve credentials for xAI inference (Conceptualizer, Animate, etc.).

    Prefer a real console API key (XAI_API_KEY / xai-…) over Grok CLI OAuth JWTs.
    OAuth tokens are machine/session-bound and often fail on other computers with:
      \"The OAuth2 access token could not be validated.\"
    """
    # Ensure file-based keys are loaded into the environment first
    bootstrap_xai_api_key_env()

    # 1) Explicit env API key (best for multi-machine / servers)
    env_key = _clean_key_string(
        os.environ.get("XAI_API_KEY")
        or os.environ.get("XAI_KEY")
        or os.environ.get("GROK_API_KEY")
        or ""
    )
    if env_key:
        return env_key

    # 2) Portable project-local key file (do not commit)
    for path in (
        GALLERY / "data" / "xai-api-key.txt",
        GALLERY / ".xai-api-key",
        Path.home() / ".grok" / "api-key.txt",
        Path.home() / ".config" / "grok" / "api-key.txt",
    ):
        file_key = _read_key_file(path)
        if not file_key:
            continue
        if _looks_like_api_key(file_key) or not _looks_like_oauth_jwt(file_key):
            os.environ["XAI_API_KEY"] = file_key
            return file_key

    # 3) Prefer any xai- key stored inside auth.json (rare but valid)
    entries = _iter_auth_entries()
    for _ek, entry in entries:
        k = _clean_key_string(entry.get("key") or entry.get("api_key") or "")
        if k and _looks_like_api_key(k):
            return k

    if not allow_oauth:
        raise ValueError(
            "No API key. Set XAI_API_KEY or put your console key in "
            "gallery/data/xai-api-key.txt (from https://console.x.ai → API Keys), "
            "then restart start_server.bat."
        )

    # 4) Grok CLI OAuth session — refresh if near expiry / forced
    for entry_key, entry in entries:
        k = _clean_key_string(entry.get("key") or "")
        if not k:
            continue
        if force_refresh or _oauth_needs_refresh(k, entry):
            refreshed = _refresh_oauth_entry(entry_key, entry)
            if refreshed:
                return refreshed
            # Refresh failed — still try the existing token
        if k:
            return k

    # Same wording as legacy server so UI paths stay consistent
    raise ValueError(
        "No API key. Set XAI_API_KEY or authenticate with Grok CLI (grok).\n"
        "Easiest on a new computer: create a key at https://console.x.ai/team/default/api-keys "
        "and save it as gallery/data/xai-api-key.txt, then run start_server.bat again."
    )


def friendly_xai_auth_error(exc: BaseException | str) -> str:
    msg = str(exc or "")
    low = msg.lower()
    if (
        "oauth2" in low
        or "access token" in low
        or "could not be validated" in low
        or "can not be validated" in low
        or "cannot be validated" in low
        or "unauthenticated" in low
        or "401" in low
    ):
        return (
            "xAI rejected the login token (OAuth). On this computer, use a real API key "
            "instead of relying on another PC's Grok login:\n"
            "1) Open https://console.x.ai → API Keys → Create key\n"
            "2) Set environment variable XAI_API_KEY=xai-…  OR  save the key in "
            "gallery/data/xai-api-key.txt\n"
            "3) Restart start_server.bat and hard-refresh the browser\n"
            "Optional: run `grok login` on this machine to refresh the CLI session.\n"
            f"(Original: {msg[:240]})"
        )
    return msg


def load_analyses() -> dict:
    if ANALYSES_PATH.exists():
        return json.loads(ANALYSES_PATH.read_text(encoding="utf-8"))
    return {}


def save_analyses(data: dict) -> None:
    payload = json.dumps(data, indent=2, ensure_ascii=False)
    tmp = ANALYSES_PATH.with_suffix(".json.tmp")
    for attempt in range(8):
        try:
            tmp.write_text(payload, encoding="utf-8")
            tmp.replace(ANALYSES_PATH)
            return
        except PermissionError:
            if attempt == 7:
                raise
            time.sleep(0.5 * (attempt + 1))
        except OSError:
            if attempt == 7:
                raise
            time.sleep(0.5 * (attempt + 1))


def image_to_data_url(path: Path, max_size: int) -> str:
    img = Image.open(path)
    img.thumbnail((max_size, max_size))
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    buf = BytesIO()
    img.save(buf, format="JPEG", quality=82, optimize=True)
    b64 = base64.standard_b64encode(buf.getvalue()).decode("ascii")
    return f"data:image/jpeg;base64,{b64}"


def parse_json_response(text: str) -> dict:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    return json.loads(text)


def extract_text(body: dict) -> str:
    for item in body.get("output", []):
        if item.get("type") == "message":
            for block in item.get("content", []):
                if block.get("type") in ("output_text", "text"):
                    return block.get("text", "")
    if "choices" in body:
        return body["choices"][0]["message"]["content"]
    return ""


def analyze_one(
    client: httpx.Client,
    api_key: str,
    number: int,
    model: str,
    max_size: int,
) -> dict:
    path = PAINTINGS / f"{number}.jpg"
    if not path.exists():
        raise FileNotFoundError(path)

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

    resp = client.post(
        API_URL,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=90.0,
    )
    resp.raise_for_status()
    text = extract_text(resp.json())
    if not text:
        raise ValueError("Empty API response")

    result = parse_json_response(text)
    result["number"] = number
    result["analyzed_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    return result


def main():
    parser = argparse.ArgumentParser(description="AI-analyze paintings")
    parser.add_argument("--start", type=int, default=1)
    parser.add_argument("--end", type=int, default=1000)
    parser.add_argument("--workers", type=int, default=DEFAULT_WORKERS)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--max-size", type=int, default=DEFAULT_MAX_SIZE,
                        help="Max image dimension in pixels (default 512)")
    args = parser.parse_args()

    api_key = get_api_key()
    analyses = load_analyses()

    pending = [
        n for n in range(args.start, args.end + 1)
        if str(n) not in analyses and n not in analyses
    ]
    if not pending:
        print("All paintings in range already analyzed.")
        return

    print(
        f"Analyzing {len(pending)} paintings | model={args.model} | "
        f"workers={args.workers} | max_size={args.max_size}px"
    )
    t_start = time.time()
    done = 0
    errors = 0

    limits = httpx.Limits(max_connections=args.workers + 2)
    with httpx.Client(limits=limits) as client:
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            futures = {
                pool.submit(
                    analyze_one, client, api_key, n, args.model, args.max_size
                ): n
                for n in pending
            }
            for future in as_completed(futures):
                num = futures[future]
                try:
                    result = future.result()
                    analyses[str(num)] = result
                    done += 1
                    elapsed = time.time() - t_start
                    rate = done / elapsed if elapsed > 0 else 0
                    eta_min = (len(pending) - done) / rate / 60 if rate > 0 else 0
                    title = result.get("title", "?")
                    print(
                        f"  [{done}/{len(pending)}] #{num}: {title} "
                        f"({rate:.1f}/s, ~{eta_min:.0f}m left)"
                    )
                except Exception as e:
                    errors += 1
                    print(f"  ERROR #{num}: {e}", file=sys.stderr)

                if done % 10 == 0 or done == len(pending):
                    save_analyses(analyses)

    save_analyses(analyses)
    total_min = (time.time() - t_start) / 60
    print(f"Finished. {done} analyzed, {errors} errors in {total_min:.1f} min.")
    print(f"Saved to {ANALYSES_PATH}")


if __name__ == "__main__":
    main()