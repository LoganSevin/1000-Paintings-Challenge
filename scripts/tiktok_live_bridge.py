"""
Bridge a real TikTok LIVE room into the gallery Live tab.

POST /api/tiktok-live/connect  { unique_id }
POST /api/tiktok-live/disconnect
GET  /api/tiktok-live/status
GET  /api/tiktok-live/events?after=N
"""
from __future__ import annotations

import os
import threading
import time
from collections import deque
from pathlib import Path
from urllib.parse import parse_qs, urlparse

_LOCK = threading.RLock()
_EVENTS: deque = deque(maxlen=500)
_SEQ = 0
_THREAD: threading.Thread | None = None
_CLIENT = None
_STATE = {
    "connected": False,
    "connecting": False,
    "unique_id": "",
    "room_id": "",
    "viewers": 0,
    "likes": 0,
    "error": "",
    "has_key": False,
}


def _gallery_root() -> Path:
    return Path(__file__).resolve().parent.parent


def _load_sign_key() -> str:
    env = (
        os.environ.get("SIGN_API_KEY")
        or os.environ.get("TIKTOK_LIVE_API_KEY")
        or os.environ.get("EULERSTREAM_API_KEY")
        or ""
    ).strip()
    if env:
        return env
    for rel in ("data/tiktok-live-key.txt", ".tiktok-live-key"):
        path = _gallery_root() / rel
        if not path.is_file():
            continue
        try:
            for line in path.read_text(encoding="utf-8").splitlines():
                line = line.strip().strip('"')
                if line and not line.startswith("#"):
                    return line
        except OSError:
            continue
    return ""


def _apply_sign_key() -> bool:
    key = _load_sign_key()
    if not key:
        return False
    try:
        from TikTokLive.client.web.web_settings import WebDefaults

        WebDefaults.tiktok_sign_api_key = key
        return True
    except Exception:
        os.environ.setdefault("SIGN_API_KEY", key)
        return True


def _norm_unique(raw: str) -> str:
    uid = str(raw or "").strip()
    uid = uid.replace("https://www.tiktok.com/@", "")
    uid = uid.replace("https://tiktok.com/@", "")
    uid = uid.replace("http://www.tiktok.com/@", "")
    uid = uid.split("?")[0].split("/")[0].strip().lstrip("@")
    return uid[:64]


def _push(kind: str, payload: dict | None = None) -> None:
    global _SEQ
    row = {"kind": kind, "t": time.time()}
    if payload:
        row.update(payload)
    with _LOCK:
        _SEQ += 1
        row["id"] = _SEQ
        _EVENTS.append(row)


def _user_name(event) -> str:
    user = getattr(event, "user", None)
    if user is None:
        return "viewer"
    return str(
        getattr(user, "nickname", None)
        or getattr(user, "unique_id", None)
        or getattr(user, "uniqueId", None)
        or "viewer"
    )[:32]


def _user_unique(event) -> str:
    user = getattr(event, "user", None)
    if user is None:
        return ""
    return str(getattr(user, "unique_id", None) or getattr(user, "uniqueId", None) or "")[:32]


def snapshot() -> dict:
    with _LOCK:
        return dict(_STATE)


def events_after(after: int) -> list[dict]:
    with _LOCK:
        return [dict(ev) for ev in _EVENTS if int(ev.get("id") or 0) > after]


def _worker(unique_id: str) -> None:
    global _CLIENT
    try:
        from TikTokLive import TikTokLiveClient
        from TikTokLive.client.errors import UserOfflineError
        from TikTokLive.events import (
            CommentEvent,
            ConnectEvent,
            DisconnectEvent,
            FollowEvent,
            GiftEvent,
            LikeEvent,
            LiveEndEvent,
        )
    except ImportError:
        with _LOCK:
            _STATE["connecting"] = False
            _STATE["connected"] = False
            _STATE["error"] = "TikTokLive is not installed. Run: pip install TikTokLive"
        _push("error", {"error": _STATE["error"]})
        return

    has_key = _apply_sign_key()
    with _LOCK:
        _STATE["has_key"] = has_key
        _STATE["error"] = ""
        _STATE["unique_id"] = unique_id

    client = TikTokLiveClient(unique_id=unique_id)
    _CLIENT = client

    @client.on(ConnectEvent)
    async def on_connect(event):
        with _LOCK:
            _STATE["connected"] = True
            _STATE["connecting"] = False
            _STATE["room_id"] = str(getattr(client, "room_id", "") or "")
            _STATE["error"] = ""
        _push(
            "connect",
            {"unique_id": unique_id, "room_id": _STATE["room_id"]},
        )

    @client.on(DisconnectEvent)
    async def on_disconnect(event):
        with _LOCK:
            _STATE["connected"] = False
            _STATE["connecting"] = False
        _push("disconnect", {"unique_id": unique_id})

    @client.on(LiveEndEvent)
    async def on_live_end(event):
        with _LOCK:
            _STATE["connected"] = False
            _STATE["error"] = "The live ended."
        _push("end", {"unique_id": unique_id})

    @client.on(CommentEvent)
    async def on_comment(event):
        text = str(getattr(event, "comment", None) or getattr(event, "content", None) or "").strip()
        if not text:
            return
        _push(
            "comment",
            {
                "user": _user_name(event),
                "unique_id": _user_unique(event),
                "text": text[:240],
            },
        )

    @client.on(GiftEvent)
    async def on_gift(event):
        if bool(getattr(event, "streaking", False)):
            return
        gift = getattr(event, "gift", None)
        name = str(
            getattr(gift, "name", None) or getattr(gift, "gift_name", None) or "gift"
        )[:40]
        coins = int(getattr(gift, "diamond_count", None) or getattr(event, "repeat_count", 1) or 1)
        _push(
            "gift",
            {
                "user": _user_name(event),
                "unique_id": _user_unique(event),
                "name": name,
                "coins": coins,
            },
        )

    @client.on(FollowEvent)
    async def on_follow(event):
        _push("follow", {"user": _user_name(event), "unique_id": _user_unique(event)})

    @client.on(LikeEvent)
    async def on_like(event):
        total = int(getattr(event, "total", None) or getattr(event, "count", 0) or 0)
        with _LOCK:
            if total:
                _STATE["likes"] = total
        viewers = int(getattr(event, "total_viewers", None) or 0)
        if viewers:
            with _LOCK:
                _STATE["viewers"] = viewers

    try:
        client.run(fetch_live_check=True, fetch_room_info=True)
    except UserOfflineError:
        err = f"@{unique_id} is not live right now. Start the TikTok LIVE, then connect."
        with _LOCK:
            _STATE["error"] = err
            _STATE["connected"] = False
            _STATE["connecting"] = False
        _push("error", {"error": err})
    except Exception as exc:
        msg = str(exc)[:400]
        if "sign" in msg.lower() or "api key" in msg.lower() or "401" in msg:
            msg = (
                msg
                + " Put an EulerStream / TikTokLive sign key in data/tiktok-live-key.txt "
                "(or env SIGN_API_KEY)."
            )
        with _LOCK:
            _STATE["error"] = msg
            _STATE["connected"] = False
            _STATE["connecting"] = False
        _push("error", {"error": msg})
    finally:
        _CLIENT = None
        with _LOCK:
            _STATE["connected"] = False
            _STATE["connecting"] = False


def connect(unique_id: str) -> dict:
    global _THREAD
    uid = _norm_unique(unique_id)
    if not uid:
        return {"ok": False, "error": "Enter a TikTok @username."}
    with _LOCK:
        if _STATE["connecting"] or _STATE["connected"]:
            if _STATE["unique_id"] == uid:
                return {"ok": True, "status": snapshot()}
            return {"ok": False, "error": "Already connected. Disconnect first."}
        _STATE["connecting"] = True
        _STATE["unique_id"] = uid
        _STATE["error"] = ""
        _EVENTS.clear()
    _THREAD = threading.Thread(target=_worker, args=(uid,), name="tiktok-live", daemon=True)
    _THREAD.start()
    _push("connecting", {"unique_id": uid})
    return {"ok": True, "status": snapshot()}


def disconnect() -> dict:
    client = _CLIENT
    if client is not None:
        loop = getattr(client, "_asyncio_loop", None)
        try:
            import asyncio

            if loop is not None and loop.is_running():
                fut = asyncio.run_coroutine_threadsafe(
                    client.disconnect(close_client=True), loop
                )
                fut.result(timeout=8)
        except Exception:
            try:
                client.cancel()
            except Exception:
                pass
    with _LOCK:
        _STATE["connecting"] = False
        _STATE["connected"] = False
    _push("disconnect", {})
    return {"ok": True, "status": snapshot()}


def status_payload(after: int = 0) -> dict:
    st = snapshot()
    evs = events_after(after)
    last = after
    if evs:
        last = int(evs[-1]["id"])
    return {
        "ok": True,
        "connected": bool(st.get("connected")),
        "connecting": bool(st.get("connecting")),
        "unique_id": st.get("unique_id") or "",
        "room_id": st.get("room_id") or "",
        "viewers": int(st.get("viewers") or 0),
        "likes": int(st.get("likes") or 0),
        "error": st.get("error") or "",
        "has_key": bool(st.get("has_key")),
        "after": last,
        "events": evs,
    }


def handle_get(handler) -> bool:
    path = urlparse(handler.path).path.rstrip("/")
    q = parse_qs(urlparse(handler.path).query)
    if path in ("/api/tiktok-live/status", "/api/tiktok-live/events"):
        try:
            after = int((q.get("after") or ["0"])[0] or 0)
        except ValueError:
            after = 0
        handler._json(status_payload(after))
        return True
    return False


def handle_post(handler) -> bool:
    path = urlparse(handler.path).path.rstrip("/")
    if path == "/api/tiktok-live/connect":
        try:
            body = handler._read_json() or {}
        except Exception:
            handler._json({"ok": False, "error": "Invalid JSON"}, 400)
            return True
        uid = body.get("unique_id") or body.get("username") or body.get("handle") or ""
        handler._json(connect(str(uid)))
        return True
    if path == "/api/tiktok-live/disconnect":
        handler._json(disconnect())
        return True
    return False
