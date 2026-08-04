"""
Gallery + Spellforge API server.
Serves static files and proxies xAI video generation (API key stays on server).

Recovered from __pycache__/app_server.cpython-314.pyc
(original source ~5046 lines / 188203 bytes, compiled 2026-07-10).
Bytecode bootstrap below restores full server logic; character-storage
overrides at the end are editable source.
"""
from __future__ import annotations

import base64
import csv
import importlib.machinery
import json
import os
import re
import shutil
import threading
import time
import uuid
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import httpx

_IMPL_PYC = Path(__file__).resolve().parent / "__pycache__" / "app_server_impl.cpython-314.pyc"
if not _IMPL_PYC.is_file():
    _legacy = Path(__file__).resolve().parent / "__pycache__" / "app_server.cpython-314.pyc"
    if _legacy.is_file() and _legacy.stat().st_size > 100_000:
        _IMPL_PYC = _legacy
if _IMPL_PYC.is_file():
    _loader = importlib.machinery.SourcelessFileLoader(__name__, str(_IMPL_PYC))
    _code = _loader.get_code(__name__)
    if _code is not None:
        _g = globals()
        _g.setdefault("__file__", str(Path(__file__).resolve()))
        # Prevent bytecode tail `if __name__ == "__main__": main()` from running
        # before editable overrides below are applied.
        _real_name = __name__
        _g["__name__"] = "app_server_impl"
        exec(_code, _g, _g)  # noqa: S102 — restore full server from archived bytecode
        _g["__name__"] = _real_name
else:
    raise RuntimeError(
        "Missing archived bytecode for recovery. Expected "
        f"{_IMPL_PYC} (copy from recovered/app_server.cpython-314.pyc)."
    )


# --- Studio entity storage + gallery asset APIs (source overrides) ---

# Load portable xAI key + replace bytecode get_api_key ASAP (Conceptualizer etc.)
try:
    from analyze import (  # noqa: PLC0415
        bootstrap_xai_api_key_env,
        friendly_xai_auth_error as _gallery_friendly_xai_auth_error,
        get_api_key as _gallery_get_api_key,
    )

    _auth_src = bootstrap_xai_api_key_env()
    globals()["get_api_key"] = _gallery_get_api_key
    globals()["friendly_xai_auth_error"] = _gallery_friendly_xai_auth_error
    try:
        _k = _gallery_get_api_key()
        _kind = (
            "console API key"
            if str(_k).startswith("xai-")
            else ("OAuth session" if str(_k).startswith("eyJ") else "credential")
        )
        print(
            f"[gallery] xAI auth: OK ({_kind}"
            + (f" via {_auth_src}" if _auth_src else "")
            + ")",
            flush=True,
        )
    except Exception as _auth_err:
        print(
            "[gallery] xAI auth: MISSING — Conceptualizer/generate will fail.\n"
            "  Fix: create a key at https://console.x.ai/team/default/api-keys\n"
            "  Save it as: gallery/data/xai-api-key.txt  (one line, starts with xai-)\n"
            "  Or set env XAI_API_KEY, or run: grok login\n"
            f"  ({_auth_err})",
            flush=True,
        )
except Exception as _boot_err:
    print(f"[gallery] xAI auth bootstrap skipped: {_boot_err}", flush=True)

MAX_CHARACTER_PREVIEW_BYTES = 48 * 1024  # ~48 KB JPEG thumbnail cap
MAX_STUDIO_ITERATION_BYTES = 512 * 1024  # cap per numbered iteration image
_STUDIO_META_FILES = ("character.json", "object.json", "room.json")


def slugify_entity_name(name):
    text = re.sub(r"[^a-zA-Z0-9_-]+", "-", str(name or "").strip().lower())
    text = re.sub(r"-+", "-", text).strip("-")
    return (text[:80] or "untitled")


def _public_url(path):
    rel = gallery_rel_url(path)
    if not rel:
        return ""
    return rel if str(rel).startswith("/") else f"/{rel}"


def find_entity_folder(root, entity_id):
    if not entity_id:
        return None
    direct = root / entity_id
    if direct.is_dir():
        return direct
    if not root.is_dir():
        return None
    for folder in root.iterdir():
        if not folder.is_dir():
            continue
        for meta_name in _STUDIO_META_FILES:
            meta = folder / meta_name
            if not meta.is_file():
                continue
            try:
                data = json.loads(meta.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                continue
            if str(data.get("id") or "") == str(entity_id):
                return folder
    return None


def allocate_entity_folder(root, entity_id, name):
    existing = find_entity_folder(root, entity_id)
    if existing:
        return existing, str(entity_id or existing.name)
    slug = slugify_entity_name(name)
    folder = root / slug
    if folder.exists():
        slug = f"{slug}-{str(uuid.uuid4())[:6]}"
        folder = root / slug
    return folder, slug


def next_iteration_index(folder):
    max_n = 0
    if not folder.is_dir():
        return 1
    for entry in folder.iterdir():
        if not entry.is_file():
            continue
        if entry.suffix.lower() not in IMAGE_EXTENSIONS:
            continue
        if entry.stem.isdigit():
            max_n = max(max_n, int(entry.stem))
    return max_n + 1


def _decode_preview_b64(preview_b64):
    text = str(preview_b64 or "").strip()
    if text.startswith("data:"):
        text = text.split(",", 1)[-1]
    if not text:
        return None
    return base64.b64decode(text, validate=True)


def _read_image_bytes_from_url(url):
    rel = _character_media_rel(url)
    if not rel:
        return None
    try:
        path = local_path_from_asset_url(rel)
        if path and path.is_file():
            return path.read_bytes()
    except OSError:
        pass
    return None


def save_numbered_iteration(folder, preview_b64=None, image_url=None, max_bytes=MAX_STUDIO_ITERATION_BYTES):
    raw = _decode_preview_b64(preview_b64)
    if not raw and image_url:
        raw = _read_image_bytes_from_url(image_url)
    if not raw:
        return None, None
    if max_bytes and len(raw) > max_bytes:
        raise ValueError(f"Image too large ({len(raw) // 1024} KB). Try a smaller preview.")
    version = next_iteration_index(folder)
    ext = ".jpg" if raw[:3] == b"\xff\xd8\xff" else ".png"
    dest = folder / f"{version}{ext}"
    dest.write_bytes(raw)
    return version, _public_url(dest)


def latest_numbered_image(folder):
    best_n = 0
    best_url = ""
    if not folder.is_dir():
        return 0, ""
    for entry in folder.iterdir():
        if not entry.is_file():
            continue
        if entry.suffix.lower() not in IMAGE_EXTENSIONS:
            continue
        if not entry.stem.isdigit():
            continue
        n = int(entry.stem)
        if n >= best_n:
            best_n = n
            best_url = _public_url(entry)
    if best_url:
        return best_n, best_url
    for legacy in ("preview.jpg", "preview.png"):
        legacy_path = folder / legacy
        if legacy_path.is_file():
            return 1, _public_url(legacy_path)
    return 0, ""


def _hydrate_studio_record(record, folder, collection):
    if not record:
        return record
    out = dict(record)
    version, preview_url = latest_numbered_image(folder)
    if version:
        out["version"] = version
    if preview_url:
        out["preview_url"] = preview_url
        if not out.get("image_url") or str(out.get("image_url", "")).startswith("/generated/"):
            out["image_url"] = preview_url
    out["collection"] = collection
    return out


def _write_json_record(folder, filename, record):
    (folder / filename).write_text(
        json.dumps(record, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )


def scan_entity_collection(root, meta_filename, collection_id):
    if not root.is_dir():
        return []
    items = []
    for folder in sorted(root.iterdir(), key=lambda p: p.name.lower()):
        if not folder.is_dir():
            continue
        meta = folder / meta_filename
        title = folder.name.replace("-", " ").title()
        entity_id = folder.name
        saved_at = folder.stat().st_mtime
        remote_url = ""
        if meta.is_file():
            try:
                data = json.loads(meta.read_text(encoding="utf-8"))
                title = str(data.get("name") or title)
                entity_id = str(data.get("id") or entity_id)
                saved_at = float(data.get("saved_at") or saved_at)
                remote_url = _character_media_rel(data.get("image_url") or data.get("sheet_url") or "")
            except (json.JSONDecodeError, OSError):
                pass
        found_numeric = False
        for entry in folder.iterdir():
            if not entry.is_file():
                continue
            if entry.suffix.lower() not in IMAGE_EXTENSIONS:
                continue
            if not entry.stem.isdigit():
                continue
            found_numeric = True
            ver = int(entry.stem)
            items.append(
                {
                    "id": f"{collection_id}/{entity_id}/{ver}",
                    "collection": collection_id,
                    "entity_id": entity_id,
                    "entity_name": title,
                    "version": ver,
                    "url": _public_url(entry),
                    "title": title,
                    "subtitle": f"#{ver}",
                    "saved_at": entry.stat().st_mtime,
                }
            )
        if not found_numeric:
            ver, url = latest_numbered_image(folder)
            if not url and remote_url:
                ver, url = 1, remote_url
            if url:
                items.append(
                    {
                        "id": f"{collection_id}/{entity_id}/{ver or 1}",
                        "collection": collection_id,
                        "entity_id": entity_id,
                        "entity_name": title,
                        "version": ver or 1,
                        "url": url,
                        "title": title,
                        "subtitle": f"#{ver or 1}",
                        "saved_at": saved_at,
                    }
                )
    items.sort(key=lambda x: (-x["saved_at"], -x["version"]))
    return items


def scan_acquired_gallery_items(folder_id, label_prefix=""):
    target = resolve_acquired_folder(folder_id)
    if not target:
        return []
    items = []
    for idx, file_row in enumerate(scan_image_files(target), start=1):
        name = file_row.get("name") or f"{idx}"
        stem = Path(name).stem
        ver = int(stem) if stem.isdigit() else idx
        items.append(
            {
                "id": f"{folder_id}/{ver}",
                "collection": folder_id.split("/")[0],
                "folder_id": folder_id,
                "entity_name": label_prefix or folder_id,
                "version": ver,
                "url": file_row.get("url") or "",
                "title": label_prefix or name,
                "subtitle": f"#{ver}",
                "saved_at": file_row.get("mtime") or 0,
            }
        )
    items.sort(key=lambda x: (-x["saved_at"], -x["version"]))
    return items


def scan_fallout_gallery_items():
    """Scan compass subfolders under saved-fallout/ (not the root — tiles live in subdirs)."""
    items = []
    scanned_ids: set[str] = set()

    def _scan_folder(folder_id: str, label: str) -> None:
        if not folder_id or folder_id in scanned_ids:
            return
        scanned_ids.add(folder_id)
        for row in scan_acquired_gallery_items(folder_id, label_prefix=label):
            ver = row.get("version") or 0
            row["collection"] = "fallout"
            row["title"] = f"{label} #{ver}" if label else row.get("title") or f"Fallout #{ver}"
            row["entity_name"] = label or "Fallout"
            items.append(row)

    try:
        index = acquired_folder_index()
    except Exception:
        index = {"folders": []}

    for folder_info in index.get("folders") or []:
        fid = str(folder_info.get("id") or "")
        if fid != "saved-fallout" and not fid.startswith("saved-fallout/"):
            continue
        children = folder_info.get("children") or []
        if children:
            for child in children:
                child_id = str(child.get("id") or "")
                if not child_id.startswith("saved-fallout/"):
                    continue
                child_label = str(child.get("label") or child_id.rsplit("/", 1)[-1])
                _scan_folder(child_id, child_label)
        elif fid.startswith("saved-fallout/"):
            _scan_folder(fid, str(folder_info.get("label") or fid.rsplit("/", 1)[-1]))

    if not items and FALLOUT_SAVE_ROOT.is_dir():
        seen_dirs: set[str] = set()
        for _compass, label in FALLOUT_COMPASS_DIRS.items():
            _scan_folder(f"saved-fallout/{label}", label)
            seen_dirs.add(label)
        for sub in sorted(FALLOUT_SAVE_ROOT.iterdir()):
            if sub.is_dir() and sub.name not in seen_dirs:
                _scan_folder(f"saved-fallout/{sub.name}", sub.name)

    items.sort(key=lambda x: (-x["saved_at"], -x["version"]))
    return items


def _scan_phone_upload_gallery_items() -> list:
    """Phone uploads for Gallery tab + generators (with analysis / G# when promoted)."""
    folder = GALLERY / "phone-uploads"
    if not folder.is_dir():
        return []
    items = []
    try:
        entries = [p for p in folder.iterdir() if p.is_file()]
    except OSError:
        return []
    image_exts = {
        ".jpg",
        ".jpeg",
        ".png",
        ".webp",
        ".gif",
        ".bmp",
        ".heic",
        ".heif",
        ".tif",
        ".tiff",
    }
    for entry in sorted(entries, key=lambda p: p.stat().st_mtime, reverse=True):
        if entry.suffix.lower() not in image_exts:
            continue
        try:
            st = entry.stat()
            rel = entry.relative_to(GALLERY).as_posix()
        except Exception:
            continue
        name = entry.name
        a = None
        gen = None
        try:
            a = _phone_upload_analysis_for(name) if "_phone_upload_analysis_for" in globals() else None
            gen = _phone_generated_mapping(name) if "_phone_generated_mapping" in globals() else None
        except Exception:
            a = None
            gen = None
        # Prefer promoted generated URL so generators use the same path as LOD1s
        url = "/" + rel
        gen_num = None
        if gen and gen.get("url"):
            url = gen["url"]
            try:
                gen_num = int(gen.get("num"))
            except (TypeError, ValueError):
                gen_num = None
        title = (a or {}).get("title") or name
        items.append(
            {
                "id": f"phone-uploads/{name}",
                "collection": "phone-uploads",
                "entity_name": title,
                "version": gen_num or int(st.st_mtime),
                "number": gen_num,
                "url": url,
                "phone_url": "/" + rel,
                "title": title,
                "subtitle": f"G#{gen_num}" if gen_num else "Phone",
                "description": (a or {}).get("description") or "",
                "prompt": (a or {}).get("prompt") or "",
                "saved_at": st.st_mtime,
                "source": "phone-upload",
                "name": name,
            }
        )
    return items


def gallery_assets_payload(collection):
    key = str(collection or "").strip().lower()
    if key == "generated":
        rows = scan_lod1_manifest_items()
        items = [
            {
                "id": f"generated/{row['num']}",
                "collection": "generated",
                "entity_name": f"G#{row['num']}",
                "version": row["num"],
                "url": row["url"],
                "title": f"Generated #{row['num']}",
                "subtitle": f"G#{row['num']}",
                "saved_at": 0,
            }
            for row in rows
        ]
        items.sort(key=lambda x: -x["version"])
        return {"items": items, "count": len(items)}
    if key == "characters":
        items = scan_entity_collection(CHARACTERS_DIR, "character.json", "characters")
        return {"items": items, "count": len(items)}
    if key == "objects":
        items = scan_entity_collection(OBJECTS_DIR, "object.json", "objects")
        return {"items": items, "count": len(items)}
    if key in ("places", "rooms"):
        items = scan_entity_collection(ROOMS_DIR, "room.json", "places")
        return {"items": items, "count": len(items)}
    if key == "stasis":
        items = scan_acquired_gallery_items("saved-stasis", label_prefix="Stasis")
        return {"items": items, "count": len(items)}
    if key == "fallout":
        items = scan_fallout_gallery_items()
        return {"items": items, "count": len(items)}
    if key in ("phone-uploads", "phone", "from-phone", "uploads"):
        items = _scan_phone_upload_gallery_items()
        return {"items": items, "count": len(items)}
    return {"error": f"Unknown collection: {collection}", "items": [], "count": 0}


def _disk_space_hint(path):
    """Free-space hint for storage errors; shows MB when under 1 GB."""
    try:
        anchor = path.anchor
        if not anchor:
            anchor = path.drive or "C:\\"
        usage = shutil.disk_usage(anchor)
        total_gb = usage.total // (1024 ** 3)
        free_bytes = usage.free
        if free_bytes < 1024 ** 3:
            free_mb = free_bytes / (1024 ** 2)
            if free_mb < 1:
                return f" (~{max(1, int(round(free_mb * 1024)))} KB free on {total_gb} GB drive)"
            return f" (~{free_mb:.1f} MB free on {total_gb} GB drive)"
        free_gb = free_bytes / (1024 ** 3)
        return f" (~{free_gb:.1f} GB free on {total_gb} GB drive)"
    except OSError:
        return ""


def _character_spell_numbers(spells):
    """Extract painting numbers only — drop full spell objects."""
    nums = []
    seen = set()
    for item in spells or []:
        n = None
        if isinstance(item, int):
            n = item
        elif isinstance(item, float) and item == int(item):
            n = int(item)
        elif isinstance(item, str) and item.strip().isdigit():
            n = int(item.strip())
        elif isinstance(item, dict):
            raw = item.get("paintingNum") or item.get("painting_num") or item.get("number")
            if raw is None and item.get("url"):
                m = re.search(r"/generated/(\d+)\.", str(item.get("url")), re.I)
                if m:
                    raw = m.group(1)
            if raw is not None:
                try:
                    n = int(raw)
                except (TypeError, ValueError):
                    n = None
        if n is not None and n not in seen:
            seen.add(n)
            nums.append(n)
        if len(nums) >= MAX_CHARACTER_SPELLS:
            break
    return nums


def _character_media_rel(url):
    """Store gallery media paths as relative URLs only."""
    text = str(url or "").strip()
    if not text:
        return ""
    if text.startswith("/"):
        return text
    parsed = urlparse(text)
    if parsed.path and parsed.path.startswith("/"):
        return parsed.path
    try:
        p = Path(text)
        if p.is_absolute():
            rel = gallery_rel_url(p)
            if rel:
                return rel
    except (OSError, ValueError):
        pass
    return text


def _hydrate_character_for_api(record):
    """Expand compact on-disk spell numbers for the gallery client."""
    if not record:
        return record
    out = dict(record)
    spells = out.get("spells") or []
    if spells and isinstance(spells[0], int):
        out["spells"] = [{"paintingNum": n} for n in spells]
    sheet = out.get("sheet_url") or ""
    if sheet and not out.get("image_url"):
        out["image_url"] = sheet
    return out


def save_character_record(body):
    name = str(body.get("name") or "").strip()
    if not name:
        raise ValueError("Character name required to save.")

    ensure_characters_dir()
    entity_id = re.sub(r"[^a-zA-Z0-9_-]", "", str(body.get("id") or "").strip())
    folder, entity_id = allocate_entity_folder(CHARACTERS_DIR, entity_id, name)
    sheet_url = _character_media_rel(body.get("sheet_url") or body.get("image_url") or "")

    record = {
        "id": entity_id,
        "name": name,
        "prompt": str(body.get("prompt") or "").strip(),
        "archetype": str(body.get("archetype") or "human"),
        "sliders": body.get("sliders") or {},
        "colors": body.get("colors") or {},
        "spells": _character_spell_numbers(body.get("spells")),
        "spell_palette": (body.get("spell_palette") or [])[:6],
        "pattern": str(body.get("pattern") or "solid"),
        "aura_style": str(body.get("aura_style") or "none"),
        "shirt_pattern": str(body.get("shirt_pattern") or "solid"),
        "art_style": str(body.get("art_style") or "stencil"),
        "views": body.get("views") or {},
        "sheet_url": sheet_url,
        "frame_count": max(4, min(16, int(body.get("frame_count") or 8))),
        "pan_rows": max(1, min(5, int(body.get("pan_rows") or 3))),
        "continuity_id": str(body.get("continuity_id") or entity_id),
        "saved_at": time.time(),
    }

    try:
        folder.mkdir(parents=True, exist_ok=True)
        _write_json_record(folder, "character.json", record)
    except OSError as e:
        _raise_character_storage_error("write", folder, e)

    try:
        version, preview_url = save_numbered_iteration(
            folder,
            preview_b64=body.get("preview_png"),
            image_url=sheet_url,
            max_bytes=MAX_CHARACTER_PREVIEW_BYTES,
        )
        if version:
            record["version"] = version
            record["preview_url"] = preview_url
    except ValueError:
        raise
    except OSError as e:
        record["preview_warning"] = (
            f"Saved character data but iteration image failed ({e})." + _disk_space_hint(folder)
        )
    except Exception:
        record["preview_warning"] = "Saved character data but iteration image was invalid."

    return _hydrate_character_for_api(_hydrate_studio_record(record, folder, "characters"))


def list_character_records():
    ensure_characters_dir()
    items = []
    for folder in sorted(CHARACTERS_DIR.iterdir(), key=lambda p: p.name.lower()):
        if not folder.is_dir():
            continue
        meta = folder / "character.json"
        if not meta.is_file():
            continue
        try:
            data = json.loads(meta.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        if not data.get("id"):
            data["id"] = folder.name
        items.append(_hydrate_character_for_api(_hydrate_studio_record(data, folder, "characters")))
    items.sort(key=lambda c: c.get("saved_at") or c.get("name") or "", reverse=True)
    return items


def save_object_record(body):
    name = str(body.get("name") or "").strip()
    if not name:
        raise ValueError("Object name required to save.")

    ensure_objects_dir()
    entity_id = re.sub(r"[^a-zA-Z0-9_-]", "", str(body.get("id") or "").strip())
    folder, entity_id = allocate_entity_folder(OBJECTS_DIR, entity_id, name)
    image_url = _character_media_rel(body.get("image_url") or "")

    record = {
        "id": entity_id,
        "kind": "object",
        "name": name,
        "prompt": str(body.get("prompt") or "").strip(),
        "category": str(body.get("category") or "object"),
        "material": str(body.get("material") or "mixed"),
        "scale": str(body.get("scale") or "handheld"),
        "colors": body.get("colors") or {},
        "spells": body.get("spells") or [],
        "spell_palette": (body.get("spell_palette") or [])[:8],
        "art_style": str(body.get("art_style") or "stencil"),
        "image_url": image_url,
        "continuity_id": str(body.get("continuity_id") or entity_id),
        "saved_at": time.time(),
    }

    folder.mkdir(parents=True, exist_ok=True)
    _write_json_record(folder, "object.json", record)

    version, preview_url = save_numbered_iteration(
        folder, preview_b64=body.get("preview_png"), image_url=image_url
    )
    if version:
        record["version"] = version
        record["preview_url"] = preview_url
        record["image_url"] = preview_url

    return _hydrate_studio_record(record, folder, "objects")


def list_object_records():
    ensure_objects_dir()
    items = []
    for folder in sorted(OBJECTS_DIR.iterdir(), key=lambda p: p.name.lower()):
        if not folder.is_dir():
            continue
        meta = folder / "object.json"
        if not meta.is_file():
            continue
        try:
            data = json.loads(meta.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        if not data.get("id"):
            data["id"] = folder.name
        items.append(_hydrate_studio_record(data, folder, "objects"))
    items.sort(key=lambda o: o.get("saved_at") or o.get("name") or "", reverse=True)
    return items


def save_room_record(body):
    name = str(body.get("name") or "").strip()
    if not name:
        raise ValueError("Room name required to save.")

    ensure_rooms_dir()
    entity_id = re.sub(r"[^a-zA-Z0-9_-]", "", str(body.get("id") or "").strip())
    folder, entity_id = allocate_entity_folder(ROOMS_DIR, entity_id, name)
    image_url = _character_media_rel(body.get("image_url") or "")

    record = {
        "id": entity_id,
        "kind": "room",
        "name": name,
        "prompt": str(body.get("prompt") or "").strip(),
        "mood": str(body.get("mood") or "neutral"),
        "lighting": str(body.get("lighting") or "natural"),
        "time_of_day": str(body.get("time_of_day") or "day"),
        "spells": body.get("spells") or [],
        "spell_palette": (body.get("spell_palette") or [])[:8],
        "art_style": str(body.get("art_style") or "painterly"),
        "image_url": image_url,
        "continuity_id": str(body.get("continuity_id") or entity_id),
        "saved_at": time.time(),
    }

    folder.mkdir(parents=True, exist_ok=True)
    _write_json_record(folder, "room.json", record)

    version, preview_url = save_numbered_iteration(
        folder, preview_b64=body.get("preview_png"), image_url=image_url
    )
    if version:
        record["version"] = version
        record["preview_url"] = preview_url
        record["image_url"] = preview_url

    return _hydrate_studio_record(record, folder, "places")


def list_room_records():
    ensure_rooms_dir()
    items = []
    for folder in sorted(ROOMS_DIR.iterdir(), key=lambda p: p.name.lower()):
        if not folder.is_dir():
            continue
        meta = folder / "room.json"
        if not meta.is_file():
            continue
        try:
            data = json.loads(meta.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        if not data.get("id"):
            data["id"] = folder.name
        items.append(_hydrate_studio_record(data, folder, "places"))
    items.sort(key=lambda r: r.get("saved_at") or r.get("name") or "", reverse=True)
    return items


# --- Live generated/ manifest (gallery tab) ---


def scan_lod1_manifest_items():
    """Scan generated/ for numeric image files — same shape as lod1-manifest.json items."""
    gen_dir = GENERATED_DIR
    exts = IMAGE_EXTENSIONS
    if not gen_dir.is_dir():
        return []
    items = []
    for entry in gen_dir.iterdir():
        if not entry.is_file():
            continue
        if entry.suffix.lower() not in exts:
            continue
        if not entry.stem.isdigit():
            continue
        items.append(
            {
                "num": int(entry.stem),
                "name": entry.name,
                "url": f"/generated/{entry.name}",
            }
        )
    items.sort(key=lambda x: x["num"])
    return items


def _lod1_manifest_api_payload():
    items = scan_lod1_manifest_items()
    return {"items": items, "count": len(items)}


# --- Resilient LOD1 analyses (repair truncated JSON on read) ---

_lod1_analyses_lock = threading.Lock()
_orig_load_lod1_analyses = load_lod1_analyses
_orig_save_lod1_analyses = save_lod1_analyses


def _salvage_lod1_json(text: str) -> dict:
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        for end in range(len(text), 1000, -1):
            try:
                return json.loads(text[:end])
            except json.JSONDecodeError:
                continue
    return {}


def load_lod1_analyses():
    path = GALLERY / "data" / "lod1-analyses.json"
    if not path.is_file():
        return {}
    text = path.read_text(encoding="utf-8").strip()
    if not text:
        return {}
    return _salvage_lod1_json(text)


def save_lod1_analyses(data):
    path = GALLERY / "data" / "lod1-analyses.json"
    payload = json.dumps(data, indent=2, ensure_ascii=False)
    tmp = path.with_suffix(".json.tmp")
    for attempt in range(8):
        try:
            tmp.write_text(payload, encoding="utf-8")
            tmp.replace(path)
            return
        except (PermissionError, OSError):
            if attempt == 7:
                raise
            time.sleep(0.5 * (attempt + 1))


_orig_post_analyze_lod1 = AppHandler._post_analyze_lod1


def _post_analyze_lod1_locked(self):
    with _lod1_analyses_lock:
        return _orig_post_analyze_lod1(self)


AppHandler._post_analyze_lod1 = _post_analyze_lod1_locked


_orig_app_handler_do_get = AppHandler.do_GET


def _app_handler_do_get_with_lod1_manifest(self):
    parsed = urlparse(self.path)
    if parsed.path == "/api/lod1-manifest":
        return self._json(_lod1_manifest_api_payload())
    if parsed.path == "/api/lod1-analyses":
        return self._json(load_lod1_analyses())
    if parsed.path == "/api/gallery-assets":
        qs = parse_qs(parsed.query or "")
        collection = (qs.get("collection") or [""])[0]
        payload = gallery_assets_payload(collection)
        if payload.get("error"):
            return self._json(payload, 400)
        return self._json(payload)
    return _orig_app_handler_do_get(self)


AppHandler.do_GET = _app_handler_do_get_with_lod1_manifest


# --- Gallery shop order log + payment config ---

GALLERY_ORDERS_PATH = GALLERY / "data" / "gallery-orders.json"
PAYMENT_CONFIG_PATH = GALLERY / "data" / "payment-config.json"
CREATOR_PAYOUTS_PATH = GALLERY / "data" / "creator-payouts.json"
MARKET_SIM_PATH = GALLERY / "data" / "market-sim.json"

_PAYMENT_SECRET_KEYS = frozenset(
    {
        "card",
        "card_number",
        "cardnumber",
        "cvv",
        "cvc",
        "pin",
        "exp",
        "expiry",
        "ssn",
        "account_number",
        "routing",
        "routing_number",
        "password",
        "secret",
        "api_key",
        "token",
        "iban",
        "swift",
    }
)
_CARD_LIKE_RE = re.compile(r"\b(?:\d[ -]*?){13,19}\b")


def _strip_payment_secrets(obj):
    """Recursively drop credential-like keys/values. Never store cards in the repo."""
    if isinstance(obj, dict):
        out = {}
        for k, v in obj.items():
            kl = str(k).lower().replace("-", "_")
            if kl in _PAYMENT_SECRET_KEYS or "cvv" in kl or kl.endswith("_pin"):
                continue
            if isinstance(v, str) and _CARD_LIKE_RE.search(v.replace(" ", "")):
                continue
            out[k] = _strip_payment_secrets(v)
        return out
    if isinstance(obj, list):
        return [_strip_payment_secrets(x) for x in obj]
    return obj


def _load_payment_config() -> dict:
    defaults = {
        "cash_app": "Logan7in",
        "artist_name": "Logan Sevin",
        "author": "Logan Sevin",
        "business_name": "Logan Sevin — 1000 Paintings Challenge",
        "copyright_notice": "© Logan Sevin. All rights reserved.",
        "ownership_statement": "All artworks authored and owned by Logan Sevin. Studio tools assist; they are not the author.",
        "venmo": "",
        "paypal_me": "",
        "tip_presets_usd": [3, 5, 10, 25, 50],
        "tip_default_usd": 5,
        "tip_label": "Fans tip artist Logan Sevin on Cash App — post tip link on X (do not tip yourself)",
        "public_url": "https://1000-l7in.netlify.app/",
        "x_handle": "",
        "order_note_prefix": "Logan Sevin · 1000 Paintings Challenge",
        "monthly_revenue_goal_usd": 10000,
        "creator_payout": {
            "name": "Logan Sevin",
            "role": "Human artist, author, and owner of all gallery works",
            "cash_app": "Logan7in",
            "monthly_usd": 300,
            "note": "Monthly creator stipend for Logan Sevin. All art credited to Logan Sevin, not AI. Never store card numbers in the repo.",
            "credits_path": "https://console.x.ai/team/default/billing",
        },
        "prices_usd": {},
        "price_gauging": {
            "enabled": True,
            "max_premium_pct": 35,
            "max_discount_pct": 12,
            "marketing_hooks": True,
        },
    }
    if not PAYMENT_CONFIG_PATH.is_file():
        return defaults
    try:
        data = json.loads(PAYMENT_CONFIG_PATH.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return defaults
        data = _strip_payment_secrets(data)
        out = dict(defaults)
        for k, v in data.items():
            if k == "prices_usd" and isinstance(v, dict):
                out["prices_usd"] = v
            elif k == "creator_payout" and isinstance(v, dict):
                base = dict(defaults["creator_payout"])
                safe = {
                    kk: vv
                    for kk, vv in v.items()
                    if str(kk).lower().replace("-", "_") not in _PAYMENT_SECRET_KEYS
                }
                base.update(safe)
                out["creator_payout"] = base
            elif k == "price_gauging" and isinstance(v, dict):
                g = dict(defaults["price_gauging"])
                g.update(v)
                out["price_gauging"] = g
            else:
                out[k] = v
        return out
    except (OSError, json.JSONDecodeError):
        return defaults


def _load_creator_payouts() -> dict:
    if not CREATOR_PAYOUTS_PATH.is_file():
        return {"version": 1, "payee": "Logan Sevin", "monthly_usd": 300, "entries": []}
    try:
        data = json.loads(CREATOR_PAYOUTS_PATH.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return {"version": 1, "payee": "Logan Sevin", "monthly_usd": 300, "entries": []}
        if not isinstance(data.get("entries"), list):
            data["entries"] = []
        return data
    except (OSError, json.JSONDecodeError):
        return {"version": 1, "payee": "Logan Sevin", "monthly_usd": 300, "entries": []}


def _save_creator_payouts(data: dict) -> None:
    CREATOR_PAYOUTS_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(data, indent=2, ensure_ascii=False) + "\n"
    tmp = CREATOR_PAYOUTS_PATH.with_suffix(".json.tmp")
    tmp.write_text(payload, encoding="utf-8")
    tmp.replace(CREATOR_PAYOUTS_PATH)


def _creator_payout_summary() -> dict:
    cfg = _load_payment_config()
    cp = cfg.get("creator_payout") if isinstance(cfg.get("creator_payout"), dict) else {}
    ledger = _load_creator_payouts()
    entries = ledger.get("entries") or []
    month_key = time.strftime("%Y-%m", time.gmtime())
    paid_this_month = sum(
        float(e.get("amount") or 0)
        for e in entries
        if str(e.get("status") or "") == "paid"
        and str(e.get("period") or "").startswith(month_key)
    )
    monthly = float(cp.get("monthly_usd") or ledger.get("monthly_usd") or 300)
    sales = _gallery_sales_stats()
    goal = float(cfg.get("monthly_revenue_goal_usd") or 10000)
    month_sales = float(sales.get("month_sales_usd") or 0)
    return {
        "ok": True,
        "payee": cp.get("name") or ledger.get("payee") or "Logan Sevin",
        "cash_app": str(cp.get("cash_app") or cfg.get("cash_app") or "Logan7in").replace("$", ""),
        "monthly_usd": monthly,
        "monthly_stipend_usd": monthly,
        "paid_this_month_usd": round(paid_this_month, 2),
        "remaining_this_month_usd": round(max(0, monthly - paid_this_month), 2),
        "period": month_key,
        "entries": entries[-24:],
        "revenue_raised_all_time": sales.get("revenue_raised") or 0,
        "month_sales_usd": round(month_sales, 2),
        "monthly_revenue_goal_usd": goal,
        "config": {
            "monthly_revenue_goal_usd": goal,
            "creator_payout": {
                "name": cp.get("name") or "Logan Sevin",
                "cash_app": str(cp.get("cash_app") or cfg.get("cash_app") or "Logan7in").replace(
                    "$", ""
                ),
                "monthly_usd": monthly,
            },
        },
        "credits_path": cp.get("credits_path")
        or "https://console.x.ai/team/default/billing",
        "note": cp.get("note")
        or "Pay via Cash App only. Never store card numbers in the gallery.",
    }


def _load_gallery_orders():
    if not GALLERY_ORDERS_PATH.is_file():
        return []
    try:
        data = json.loads(GALLERY_ORDERS_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except json.JSONDecodeError:
        return []


def _save_gallery_orders(orders):
    payload = json.dumps(orders, indent=2, ensure_ascii=False)
    tmp = GALLERY_ORDERS_PATH.with_suffix(".json.tmp")
    for attempt in range(8):
        try:
            tmp.write_text(payload, encoding="utf-8")
            tmp.replace(GALLERY_ORDERS_PATH)
            return
        except (PermissionError, OSError):
            if attempt == 7:
                raise
            time.sleep(0.5 * (attempt + 1))


def _gallery_sales_stats(orders=None):
    rows = orders if orders is not None else _load_gallery_orders()
    pieces_sold = 0
    revenue_raised = 0.0
    month_sales = 0.0
    orders_completed = 0
    pending_orders = 0
    month_key = time.strftime("%Y-%m", time.gmtime())
    for order in rows:
        status = str(order.get("status") or "pending").lower()
        item_count = len(order.get("items") or [])
        total = float(order.get("total") or 0)
        if status == "completed":
            orders_completed += 1
            pieces_sold += item_count
            revenue_raised += total
            stamp = str(order.get("completed_at") or order.get("created_at") or "")
            if stamp.startswith(month_key):
                month_sales += total
        elif status == "pending":
            pending_orders += 1
    return {
        "pieces_sold": pieces_sold,
        "orders_completed": orders_completed,
        "revenue_raised": round(revenue_raised, 2),
        "month_sales_usd": round(month_sales, 2),
        "pending_orders": pending_orders,
    }


def _complete_gallery_order(order_id):
    orders = _load_gallery_orders()
    found = False
    for order in orders:
        if str(order.get("id")) != str(order_id):
            continue
        if str(order.get("status") or "").lower() != "completed":
            order["status"] = "completed"
            order["completed_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        found = True
        break
    if not found:
        return None
    _save_gallery_orders(orders)
    return _gallery_sales_stats(orders)


# --- Market desk: simulated sales volumetrics + price gauging + paper stocks ---

_MARKET_LOCK = threading.RLock()
_MARKET_QUOTE_CACHE = {"at": 0.0, "quotes": {}, "fetching": False}

_ART_COLLECTIONS = (
    ("paintings", "ART-PNT", "Paintings", 89.0, 1.15),
    ("generated", "ART-GEN", "Generated", 45.0, 1.05),
    ("commercial", "ART-COM", "Commercial", 55.0, 1.12),
    ("characters", "ART-CHR", "Characters", 35.0, 0.98),
    ("objects", "ART-OBJ", "Objects", 29.0, 0.95),
    ("places", "ART-PLC", "Places", 39.0, 1.0),
    ("videos", "ART-VID", "Videos", 29.0, 1.08),
    ("tabloid-print", "ART-TAB", "Tabloid print", 49.0, 1.1),
    ("custom", "ART-CST", "Custom", 35.0, 1.0),
)

_INDEX_SYMBOLS = (
    ("SPY", "S&P 500 ETF", 520.0, 0.12),
    ("QQQ", "Nasdaq-100 ETF", 450.0, 0.16),
    ("IWM", "Russell 2000 ETF", 200.0, 0.18),
    ("GLD", "Gold ETF", 190.0, 0.1),
    ("BTC-USD", "Bitcoin (paper)", 65000.0, 0.55),
    ("XAI-P", "xAI credits proxy", 12.0, 0.4),
)

_MARKETING_HOOKS = (
    "Hot demand — limited window",
    "Rising — collectors stacking",
    "Flash volume spike",
    "Scarcity premium active",
    "Social momentum bid",
    "Underpriced vs peer art",
    "Steady accumulation",
    "Cooling — value entry",
)


def _market_default_state() -> dict:
    symbols = {}
    for coll, sym, name, base, beta in _ART_COLLECTIONS:
        symbols[sym] = {
            "symbol": sym,
            "name": name,
            "kind": "art",
            "collection": coll,
            "base_price": base,
            "price": base,
            "open": base,
            "high": base,
            "low": base,
            "change_pct": 0.0,
            "volume_24h": 0,
            "heat": 42.0,
            "beta": beta,
            "spark": [base] * 24,
        }
    for sym, name, base, beta in _INDEX_SYMBOLS:
        symbols[sym] = {
            "symbol": sym,
            "name": name,
            "kind": "index",
            "collection": None,
            "base_price": base,
            "price": base,
            "open": base,
            "high": base,
            "low": base,
            "change_pct": 0.0,
            "volume_24h": 0,
            "heat": 50.0,
            "beta": beta,
            "spark": [base] * 24,
            "live_quote": False,
        }
    return {
        "version": 1,
        "note": "Paper market + simulated sales only. No payment credentials.",
        "paper_cash_usd": 10000.0,
        "positions": {},
        "trade_log": [],
        "sim_sales": [],
        "last_tick_at": 0.0,
        "sim_month_revenue_usd": 0.0,
        "sim_month_key": time.strftime("%Y-%m", time.gmtime()),
        "sim_pieces_sold": 0,
        "sim_orders": 0,
        "velocity_per_min": 0.0,
        "symbols": symbols,
    }


def _load_market_sim() -> dict:
    default = _market_default_state()
    if not MARKET_SIM_PATH.is_file():
        return default
    try:
        data = json.loads(MARKET_SIM_PATH.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return default
        data = _strip_payment_secrets(data)
        out = default
        for k in (
            "paper_cash_usd",
            "positions",
            "trade_log",
            "sim_sales",
            "last_tick_at",
            "sim_month_revenue_usd",
            "sim_month_key",
            "sim_pieces_sold",
            "sim_orders",
            "velocity_per_min",
        ):
            if k in data:
                out[k] = data[k]
        if isinstance(data.get("symbols"), dict):
            for sym, row in data["symbols"].items():
                if sym in out["symbols"] and isinstance(row, dict):
                    out["symbols"][sym].update(
                        {
                            kk: row[kk]
                            for kk in (
                                "price",
                                "open",
                                "high",
                                "low",
                                "change_pct",
                                "volume_24h",
                                "heat",
                                "spark",
                                "live_quote",
                            )
                            if kk in row
                        }
                    )
        return out
    except (OSError, json.JSONDecodeError):
        return default


def _save_market_sim(data: dict) -> None:
    clean = _strip_payment_secrets(data)
    MARKET_SIM_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(clean, indent=2, ensure_ascii=False) + "\n"
    tmp = MARKET_SIM_PATH.with_suffix(".json.tmp")
    tmp.write_text(payload, encoding="utf-8")
    tmp.replace(MARKET_SIM_PATH)


def _market_rng(seed_extra: float = 0.0) -> float:
    # Deterministic-ish pseudo random from time for smooth ticks without import random cost
    x = math.sin(time.time() * 12.9898 + seed_extra * 78.233) * 43758.5453
    return x - math.floor(x)


# math may already be available via bytecode; ensure import
import math  # noqa: E402


def _fetch_live_index_quotes() -> dict:
    """Optional free Yahoo chart quotes (no API key). Hard time-budget; never blocks desk."""
    now = time.time()
    if now - float(_MARKET_QUOTE_CACHE.get("at") or 0) < 60:
        return dict(_MARKET_QUOTE_CACHE.get("quotes") or {})
    # Skip live network if disabled or previous fetch still running
    if os.environ.get("GALLERY_MARKET_LIVE", "1") in ("0", "false", "no"):
        _MARKET_QUOTE_CACHE["at"] = now
        return {}
    if _MARKET_QUOTE_CACHE.get("fetching"):
        return dict(_MARKET_QUOTE_CACHE.get("quotes") or {})

    quotes_holder = {"quotes": dict(_MARKET_QUOTE_CACHE.get("quotes") or {})}

    def _work():
        quotes = {}
        tickers = ["SPY", "QQQ", "IWM", "GLD", "BTC-USD"]
        try:
            with httpx.Client(timeout=httpx.Timeout(1.5, connect=1.0)) as client:
                for t in tickers:
                    try:
                        url = (
                            "https://query1.finance.yahoo.com/v8/finance/chart/"
                            + t
                            + "?interval=1m&range=1d"
                        )
                        r = client.get(
                            url,
                            headers={"User-Agent": "Mozilla/5.0 GalleryMarketDesk/1.0"},
                        )
                        if r.status_code != 200:
                            continue
                        body = r.json()
                        result = (body.get("chart") or {}).get("result") or []
                        if not result:
                            continue
                        meta = result[0].get("meta") or {}
                        price = meta.get("regularMarketPrice") or meta.get("previousClose")
                        prev = meta.get("chartPreviousClose") or meta.get("previousClose")
                        if price is None:
                            continue
                        price = float(price)
                        prev = float(prev or price)
                        chg = ((price - prev) / prev * 100.0) if prev else 0.0
                        quotes[t] = {
                            "price": round(price, 4),
                            "change_pct": round(chg, 3),
                            "live_quote": True,
                        }
                    except Exception:
                        continue
        except Exception:
            pass
        quotes_holder["quotes"] = quotes
        _MARKET_QUOTE_CACHE["quotes"] = quotes
        _MARKET_QUOTE_CACHE["at"] = time.time()
        _MARKET_QUOTE_CACHE["fetching"] = False

    _MARKET_QUOTE_CACHE["fetching"] = True
    th = threading.Thread(target=_work, daemon=True)
    th.start()
    th.join(2.2)
    if th.is_alive():
        # Return last cache; background may still finish later
        return dict(_MARKET_QUOTE_CACHE.get("quotes") or {})
    return dict(quotes_holder.get("quotes") or {})


def _market_marketing_hook(heat: float, change_pct: float) -> str:
    if heat >= 78 and change_pct > 0.5:
        return _MARKETING_HOOKS[0]
    if change_pct >= 1.2:
        return _MARKETING_HOOKS[1]
    if heat >= 70:
        return _MARKETING_HOOKS[2]
    if heat >= 62:
        return _MARKETING_HOOKS[3]
    if change_pct >= 0.4:
        return _MARKETING_HOOKS[4]
    if change_pct <= -0.8:
        return _MARKETING_HOOKS[5]
    if heat < 35:
        return _MARKETING_HOOKS[7]
    return _MARKETING_HOOKS[6]


def _gauged_shop_price(base: float, heat: float, change_pct: float, gauging: dict) -> dict:
    if not gauging.get("enabled", True):
        return {
            "base_usd": round(base, 2),
            "gauged_usd": round(base, 2),
            "premium_pct": 0.0,
            "hook": "",
            "heat": round(heat, 1),
        }
    max_prem = float(gauging.get("max_premium_pct") or 35) / 100.0
    max_disc = float(gauging.get("max_discount_pct") or 12) / 100.0
    # Heat 0–100 → premium; negative momentum softens
    heat_factor = (heat - 50.0) / 50.0  # -1..+1
    mom_factor = max(-1.0, min(1.0, change_pct / 3.0))
    raw = 0.55 * heat_factor + 0.45 * mom_factor
    if raw >= 0:
        prem = min(max_prem, raw * max_prem)
    else:
        prem = max(-max_disc, raw * max_disc)
    gauged = max(1.0, base * (1.0 + prem))
    # Psychological marketing price: .99 / round
    if gauged >= 20:
        gauged = math.floor(gauged) - 0.01 if gauged - math.floor(gauged) < 0.5 else round(gauged)
        if isinstance(gauged, float) and gauged == math.floor(gauged):
            gauged = gauged - 0.01
    else:
        gauged = round(gauged, 2)
    return {
        "base_usd": round(base, 2),
        "gauged_usd": round(float(gauged), 2),
        "premium_pct": round(prem * 100.0, 2),
        "hook": _market_marketing_hook(heat, change_pct) if gauging.get("marketing_hooks", True) else "",
        "heat": round(heat, 1),
    }


def _ensure_market_month(state: dict) -> None:
    key = time.strftime("%Y-%m", time.gmtime())
    if str(state.get("sim_month_key") or "") != key:
        state["sim_month_key"] = key
        state["sim_month_revenue_usd"] = 0.0
        state["sim_pieces_sold"] = 0
        state["sim_orders"] = 0


def _emit_sim_sale(state: dict, collection: str, price: float, hook: str) -> dict:
    _ensure_market_month(state)
    sale = {
        "id": str(uuid.uuid4())[:8],
        "simulated": True,
        "collection": collection,
        "price_usd": round(price, 2),
        "hook": hook,
        "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "channel": "sim_volumetrics",
    }
    sales = list(state.get("sim_sales") or [])
    sales.append(sale)
    state["sim_sales"] = sales[-120:]
    state["sim_month_revenue_usd"] = round(
        float(state.get("sim_month_revenue_usd") or 0) + price, 2
    )
    state["sim_pieces_sold"] = int(state.get("sim_pieces_sold") or 0) + 1
    state["sim_orders"] = int(state.get("sim_orders") or 0) + 1
    return sale


def _market_tick(force_sales: int = 0) -> dict:
    with _MARKET_LOCK:
        state = _load_market_sim()
        _ensure_market_month(state)
        cfg = _load_payment_config()
        base_prices = cfg.get("prices_usd") if isinstance(cfg.get("prices_usd"), dict) else {}
        gauging = cfg.get("price_gauging") if isinstance(cfg.get("price_gauging"), dict) else {}
        # Live quotes are optional; never hold the lock while waiting on network
        now = time.time()
        last = float(state.get("last_tick_at") or 0)
        dt = max(0.5, min(30.0, now - last)) if last else 2.0
        symbols = state.get("symbols") or {}
        sales_this_tick = 0
        velocity = 0.0

        for i, (coll, sym, name, default_base, beta) in enumerate(_ART_COLLECTIONS):
            row = symbols.get(sym) or {}
            base = float(base_prices.get(coll) or row.get("base_price") or default_base)
            row["base_price"] = base
            row["collection"] = coll
            row["name"] = name
            row["kind"] = "art"
            row["beta"] = beta
            price = float(row.get("price") or base)
            heat = float(row.get("heat") or 42)
            # Mean-reverting heat + noise
            heat += (_market_rng(i + 1) - 0.48) * 8.0 * (dt / 2.0)
            heat = max(8.0, min(96.0, heat))
            # Price walk biased by heat
            drift = (heat - 50.0) / 5000.0 * beta
            shock = (_market_rng(i + 10.5) - 0.5) * 0.012 * beta
            price = max(base * 0.7, min(base * 1.55, price * (1.0 + drift + shock)))
            open_p = float(row.get("open") or price)
            if last and now - last > 3600 * 6:
                open_p = price
            high = max(float(row.get("high") or price), price)
            low = min(float(row.get("low") or price), price)
            chg = ((price - open_p) / open_p * 100.0) if open_p else 0.0
            vol = int(row.get("volume_24h") or 0)
            # Simulated unit volume
            unit_rate = (0.02 + heat / 400.0) * dt
            if _market_rng(i + 20) < min(0.85, unit_rate):
                units = 1 + int(_market_rng(i + 21) * 3)
                vol += units
                sales_this_tick += units
                for _ in range(units):
                    g = _gauged_shop_price(base, heat, chg, gauging)
                    _emit_sim_sale(state, coll, g["gauged_usd"], g["hook"])
                    heat = min(96.0, heat + 1.2)
            spark = list(row.get("spark") or [])
            spark.append(round(price, 2))
            spark = spark[-36:]
            row.update(
                {
                    "symbol": sym,
                    "price": round(price, 2),
                    "open": round(open_p, 2),
                    "high": round(high, 2),
                    "low": round(low, 2),
                    "change_pct": round(chg, 3),
                    "volume_24h": vol,
                    "heat": round(heat, 1),
                    "spark": spark,
                }
            )
            symbols[sym] = row

        for j, (sym, name, default_base, beta) in enumerate(_INDEX_SYMBOLS):
            row = symbols.get(sym) or {}
            row["name"] = name
            row["kind"] = "index"
            row["beta"] = beta
            # Prefer last live cache without blocking; pure sim walk otherwise
            live_q = (_MARKET_QUOTE_CACHE.get("quotes") or {}).get(sym)
            if live_q and live_q.get("live_quote"):
                price = float(live_q["price"])
                chg = float(live_q.get("change_pct") or 0)
                row["live_quote"] = True
                open_p = price / (1.0 + chg / 100.0) if chg != -100 else price
            else:
                row["live_quote"] = False
                price = float(row.get("price") or default_base)
                open_p = float(row.get("open") or price)
                shock = (_market_rng(j + 50) - 0.5) * 0.004 * beta
                price = max(0.01, price * (1.0 + shock))
                chg = ((price - open_p) / open_p * 100.0) if open_p else 0.0
            high = max(float(row.get("high") or price), price)
            low = min(float(row.get("low") or price), price)
            vol = int(row.get("volume_24h") or 0) + int(_market_rng(j + 60) * 50 * dt)
            spark = list(row.get("spark") or [])
            spark.append(round(price, 4 if price < 100 else 2))
            spark = spark[-36:]
            row.update(
                {
                    "symbol": sym,
                    "price": round(price, 4 if price < 50 else 2),
                    "open": round(open_p, 4 if open_p < 50 else 2),
                    "high": round(high, 4 if high < 50 else 2),
                    "low": round(low, 4 if low < 50 else 2),
                    "change_pct": round(chg, 3),
                    "volume_24h": vol,
                    "heat": round(50 + min(40, abs(chg) * 8), 1),
                    "spark": spark,
                    "base_price": float(row.get("base_price") or default_base),
                }
            )
            symbols[sym] = row

        # Forced sales burst for demos / marketing volume
        if force_sales > 0:
            for n in range(min(40, force_sales)):
                coll, sym, _, default_base, _ = _ART_COLLECTIONS[n % len(_ART_COLLECTIONS)]
                row = symbols.get(sym) or {}
                base = float(base_prices.get(coll) or row.get("base_price") or default_base)
                heat = float(row.get("heat") or 50)
                chg = float(row.get("change_pct") or 0)
                g = _gauged_shop_price(base, heat, chg, gauging)
                _emit_sim_sale(state, coll, g["gauged_usd"], g["hook"])
                sales_this_tick += 1
                row["heat"] = min(96.0, heat + 2.0)
                row["volume_24h"] = int(row.get("volume_24h") or 0) + 1
                symbols[sym] = row

        velocity = sales_this_tick / max(dt / 60.0, 0.01)
        state["velocity_per_min"] = round(
            0.65 * float(state.get("velocity_per_min") or 0) + 0.35 * velocity, 2
        )
        state["symbols"] = symbols
        state["last_tick_at"] = now
        _save_market_sim(state)
        # Kick off optional live quote refresh outside the critical path
        try:
            threading.Thread(target=_fetch_live_index_quotes, daemon=True).start()
        except Exception:
            pass
        return state


def _market_gauged_prices(state=None) -> dict:
    state = state or _load_market_sim()
    cfg = _load_payment_config()
    base_prices = cfg.get("prices_usd") if isinstance(cfg.get("prices_usd"), dict) else {}
    gauging = cfg.get("price_gauging") if isinstance(cfg.get("price_gauging"), dict) else {}
    symbols = state.get("symbols") or {}
    out = {}
    for coll, sym, _, default_base, _ in _ART_COLLECTIONS:
        row = symbols.get(sym) or {}
        base = float(base_prices.get(coll) or row.get("base_price") or default_base)
        heat = float(row.get("heat") or 42)
        chg = float(row.get("change_pct") or 0)
        g = _gauged_shop_price(base, heat, chg, gauging)
        g["symbol"] = sym
        g["collection"] = coll
        out[coll] = g
    return out


def _market_portfolio_value(state: dict) -> dict:
    cash = float(state.get("paper_cash_usd") or 0)
    positions = state.get("positions") if isinstance(state.get("positions"), dict) else {}
    symbols = state.get("symbols") or {}
    holdings = []
    equity = 0.0
    for sym, pos in positions.items():
        qty = float(pos.get("qty") or 0)
        if qty <= 0:
            continue
        px = float((symbols.get(sym) or {}).get("price") or 0)
        avg = float(pos.get("avg_cost") or 0)
        mkt = qty * px
        equity += mkt
        holdings.append(
            {
                "symbol": sym,
                "qty": qty,
                "avg_cost": round(avg, 4),
                "price": px,
                "market_value": round(mkt, 2),
                "pnl_usd": round(mkt - qty * avg, 2),
                "pnl_pct": round(((px - avg) / avg * 100.0) if avg else 0.0, 2),
            }
        )
    return {
        "paper_cash_usd": round(cash, 2),
        "equity_usd": round(equity, 2),
        "total_usd": round(cash + equity, 2),
        "holdings": holdings,
    }


def _market_snapshot(force_tick: bool = True, force_sales: int = 0) -> dict:
    state = _load_market_sim()
    now = time.time()
    last = float(state.get("last_tick_at") or 0)
    if force_sales > 0 or (force_tick and (not last or now - last >= 2.0)):
        state = _market_tick(force_sales=force_sales)
    real = _gallery_sales_stats()
    portfolio = _market_portfolio_value(state)
    gauged = _market_gauged_prices(state)
    goal = float((_load_payment_config()).get("monthly_revenue_goal_usd") or 10000)
    sim_rev = float(state.get("sim_month_revenue_usd") or 0)
    real_month = float(real.get("month_sales_usd") or 0)
    return {
        "ok": True,
        "simulated": True,
        "disclaimer": "Simulated sales + paper trading for volumetrics/marketing. Not real brokerage. No payment credentials stored.",
        "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "symbols": list((state.get("symbols") or {}).values()),
        "gauged_prices": gauged,
        "sim_sales": list(reversed(list(state.get("sim_sales") or [])[-40:])),
        "trade_log": list(reversed(list(state.get("trade_log") or [])[-30:])),
        "portfolio": portfolio,
        "volumetrics": {
            "sim_month_revenue_usd": sim_rev,
            "sim_pieces_sold": int(state.get("sim_pieces_sold") or 0),
            "sim_orders": int(state.get("sim_orders") or 0),
            "velocity_per_min": float(state.get("velocity_per_min") or 0),
            "real_month_sales_usd": real_month,
            "real_all_time_usd": float(real.get("revenue_raised") or 0),
            "monthly_goal_usd": goal,
            "sim_progress_pct": round(min(100.0, (sim_rev / goal) * 100.0) if goal else 0, 1),
            "combined_progress_pct": round(
                min(100.0, ((sim_rev + real_month) / goal) * 100.0) if goal else 0, 1
            ),
        },
        "security": {
            "stores_payment_credentials": False,
            "rails": ["cash_app_cashtag_only"],
            "note": "Never put card numbers, CVV, PIN, or bank logins in this repo.",
        },
    }


def _market_trade(body: dict) -> dict:
    symbol = str(body.get("symbol") or "").upper().strip()
    side = str(body.get("side") or "").lower().strip()
    try:
        qty = float(body.get("qty") or 0)
    except (TypeError, ValueError):
        qty = 0
    if side not in ("buy", "sell") or qty <= 0:
        return {"ok": False, "error": "Need side buy|sell and positive qty"}
    with _MARKET_LOCK:
        state = _market_tick(force_sales=0)
        symbols = state.get("symbols") or {}
        if symbol not in symbols:
            return {"ok": False, "error": "Unknown symbol"}
        px = float(symbols[symbol].get("price") or 0)
        if px <= 0:
            return {"ok": False, "error": "No price"}
        cash = float(state.get("paper_cash_usd") or 0)
        positions = dict(state.get("positions") or {})
        pos = dict(positions.get(symbol) or {"qty": 0, "avg_cost": 0})
        held = float(pos.get("qty") or 0)
        cost = qty * px
        if side == "buy":
            if cost > cash + 1e-9:
                return {"ok": False, "error": "Insufficient paper cash"}
            new_qty = held + qty
            avg = ((held * float(pos.get("avg_cost") or 0)) + cost) / new_qty if new_qty else 0
            pos = {"qty": round(new_qty, 6), "avg_cost": round(avg, 4)}
            cash -= cost
        else:
            if qty > held + 1e-9:
                return {"ok": False, "error": "Not enough shares"}
            new_qty = held - qty
            cash += cost
            if new_qty <= 1e-9:
                positions.pop(symbol, None)
                pos = None
            else:
                pos = {"qty": round(new_qty, 6), "avg_cost": float(pos.get("avg_cost") or 0)}
        if pos is not None:
            positions[symbol] = pos
        state["positions"] = positions
        state["paper_cash_usd"] = round(cash, 2)
        log = list(state.get("trade_log") or [])
        log.append(
            {
                "id": str(uuid.uuid4())[:8],
                "symbol": symbol,
                "side": side,
                "qty": qty,
                "price": px,
                "notional": round(cost, 2),
                "paper": True,
                "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }
        )
        state["trade_log"] = log[-100:]
        _save_market_sim(state)
        snap = _market_snapshot(force_tick=False)
        snap["ok"] = True
        snap["last_trade"] = log[-1]
        return snap


def _market_reset_paper() -> dict:
    with _MARKET_LOCK:
        state = _load_market_sim()
        state["paper_cash_usd"] = 10000.0
        state["positions"] = {}
        state["trade_log"] = []
        _save_market_sim(state)
    return _market_snapshot(force_tick=True)


_orig_app_handler_do_get_sales = AppHandler.do_GET


def _app_handler_do_get_with_sales_stats(self):
    parsed = urlparse(self.path)
    if parsed.path == "/api/gallery-sales-stats":
        real = _gallery_sales_stats()
        try:
            m = _load_market_sim()
            real["sim_month_revenue_usd"] = float(m.get("sim_month_revenue_usd") or 0)
            real["sim_pieces_sold"] = int(m.get("sim_pieces_sold") or 0)
            real["month_sales_usd_combined"] = round(
                float(real.get("month_sales_usd") or 0)
                + float(m.get("sim_month_revenue_usd") or 0),
                2,
            )
        except Exception:
            pass
        return self._json(real)
    if parsed.path in ("/api/payment-config", "/api/payment-config/"):
        return self._json(_load_payment_config())
    if parsed.path in ("/api/creator-payouts", "/api/creator-payouts/"):
        return self._json(_creator_payout_summary())
    if parsed.path in ("/api/market", "/api/market/"):
        return self._json(_market_snapshot(force_tick=True))
    if parsed.path in ("/api/market/prices", "/api/market/prices/"):
        state = _load_market_sim()
        now = time.time()
        if not state.get("last_tick_at") or now - float(state.get("last_tick_at") or 0) >= 2:
            state = _market_tick()
        return self._json({"ok": True, "gauged_prices": _market_gauged_prices(state)})
    return _orig_app_handler_do_get_sales(self)


AppHandler.do_GET = _app_handler_do_get_with_sales_stats


_orig_app_handler_do_post = AppHandler.do_POST


def _app_handler_do_post_with_gallery_orders(self):
    parsed = urlparse(self.path)
    if parsed.path in ("/api/market/tick", "/api/market/tick/"):
        try:
            body = self._read_json()
        except Exception:
            body = {}
        if not isinstance(body, dict):
            body = {}
        force_sales = int(body.get("force_sales") or body.get("burst") or 0)
        return self._json(_market_snapshot(force_tick=True, force_sales=force_sales))
    if parsed.path in ("/api/market/trade", "/api/market/trade/"):
        try:
            body = self._read_json()
        except Exception:
            return self._json({"ok": False, "error": "Invalid JSON"}, 400)
        if not isinstance(body, dict):
            return self._json({"ok": False, "error": "Invalid JSON"}, 400)
        result = _market_trade(body)
        code = 200 if result.get("ok") else 400
        return self._json(result, code)
    if parsed.path in ("/api/market/reset-paper", "/api/market/reset-paper/"):
        return self._json(_market_reset_paper())
    if parsed.path in ("/api/creator-payouts", "/api/creator-payouts/"):
        try:
            body = self._read_json()
        except Exception:
            return self._json({"ok": False, "error": "Invalid JSON"}, 400)
        # Record a monthly stipend payment (Cash App / manual). No cards ever stored.
        action = str(body.get("action") or "record").lower()
        if action != "record":
            return self._json({"ok": False, "error": "Unknown action"}, 400)
        amount = float(body.get("amount") or body.get("amount_usd") or 0)
        if amount <= 0:
            cfg = _load_payment_config()
            cp = cfg.get("creator_payout") if isinstance(cfg.get("creator_payout"), dict) else {}
            amount = float(cp.get("monthly_usd") or 300)
        period = str(body.get("period") or time.strftime("%Y-%m", time.gmtime()))
        entry = {
            "id": str(uuid.uuid4()),
            "amount": round(amount, 2),
            "period": period,
            "status": "paid",
            "method": str(body.get("method") or "cash_app"),
            "cashtag": str(body.get("cashtag") or "").replace("$", "") or None,
            "note": str(body.get("note") or "Monthly creator stipend")[:500],
            "paid_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        ledger = _load_creator_payouts()
        entries = list(ledger.get("entries") or [])
        entries.append(entry)
        ledger["entries"] = entries[-200:]
        _save_creator_payouts(ledger)
        return self._json({"ok": True, "entry": entry, "summary": _creator_payout_summary()})
    if parsed.path == "/api/gallery-orders/complete":
        try:
            body = self._read_json()
        except Exception:
            return self._json({"ok": False, "error": "Invalid JSON"}, 400)
        order_id = body.get("order_id") or body.get("id")
        if not order_id:
            return self._json({"ok": False, "error": "Missing order_id"}, 400)
        stats = _complete_gallery_order(order_id)
        if stats is None:
            return self._json({"ok": False, "error": "Order not found"}, 404)
        return self._json({"ok": True, "order_id": order_id, "stats": stats})
    if parsed.path == "/api/gallery-orders":
        try:
            body = self._read_json()
        except Exception:
            return self._json({"ok": False, "error": "Invalid JSON"}, 400)
        items = body.get("items") or []
        if not items:
            return self._json({"ok": False, "error": "Cart is empty"}, 400)
        entry = {
            "id": str(uuid.uuid4()),
            "items": items,
            "item_count": len(items),
            "total": body.get("total"),
            "cashtag": body.get("cashtag"),
            "payment_method": body.get("payment_method") or "cash_app",
            "order_type": body.get("order_type") or "sale",
            "created_at": body.get("created_at") or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "status": "pending",
        }
        orders = _load_gallery_orders()
        orders.append(entry)
        if len(orders) > 500:
            orders = orders[-500:]
        _save_gallery_orders(orders)
        return self._json({
            "ok": True,
            "order_id": entry["id"],
            "stats": _gallery_sales_stats(orders),
        })
    return _orig_app_handler_do_post(self)


AppHandler.do_POST = _app_handler_do_post_with_gallery_orders


# --- Pulse social feed ---

PULSE_POSTS_PATH = GALLERY / "data" / "pulse-posts.json"
PULSE_MEDIA_DIR = GALLERY / "data" / "pulse-media"
PULSE_GOOGLE_CONFIG_PATH = GALLERY / "data" / "pulse-google-config.json"
PULSE_ACCOUNTS_PATH = GALLERY / "data" / "pulse-accounts.json"
PULSE_ACCOUNTS_CSV_PATH = GALLERY / "data" / "pulse-accounts.csv"
PULSE_SESSIONS_PATH = GALLERY / "data" / "pulse-sessions.json"
MAX_PULSE_POSTS = 500
MAX_PULSE_IMAGE_BYTES = 2 * 1024 * 1024
PULSE_SESSION_TTL_SEC = 30 * 24 * 3600
_PULSE_USERNAME_RE = re.compile(r"^[a-zA-Z0-9_]{1,32}$")
_PULSE_CSV_FIELDS = (
    "timestamp",
    "event",
    "google_sub",
    "email",
    "name",
    "picture_url",
    "sign_in_count",
)


def _load_pulse_google_config():
    client_id = str(os.environ.get("PULSE_GOOGLE_CLIENT_ID") or "").strip()
    sheets_webhook_url = str(os.environ.get("PULSE_SHEETS_WEBHOOK_URL") or "").strip()
    if PULSE_GOOGLE_CONFIG_PATH.is_file():
        try:
            data = json.loads(PULSE_GOOGLE_CONFIG_PATH.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                client_id = str(data.get("client_id") or client_id).strip()
                sheets_webhook_url = str(
                    data.get("sheets_webhook_url") or sheets_webhook_url
                ).strip()
        except json.JSONDecodeError:
            pass
    placeholder = not client_id or client_id.startswith("YOUR_")
    return {
        "client_id": client_id,
        "sheets_webhook_url": sheets_webhook_url,
        "google_enabled": bool(client_id) and not placeholder,
    }


def _normalize_pulse_username(name):
    text = str(name or "").strip()
    if not _PULSE_USERNAME_RE.match(text):
        return None
    return text


def _load_pulse_sessions():
    if not PULSE_SESSIONS_PATH.is_file():
        return {}
    try:
        data = json.loads(PULSE_SESSIONS_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        return {}


def _save_pulse_sessions(sessions):
    payload = json.dumps(sessions, indent=2, ensure_ascii=False)
    tmp = PULSE_SESSIONS_PATH.with_suffix(".json.tmp")
    for attempt in range(8):
        try:
            tmp.write_text(payload, encoding="utf-8")
            tmp.replace(PULSE_SESSIONS_PATH)
            return
        except (PermissionError, OSError):
            if attempt == 7:
                raise
            time.sleep(0.5 * (attempt + 1))


def _prune_pulse_sessions(sessions):
    now = int(time.time())
    stale = [
        token
        for token, row in sessions.items()
        if int(row.get("expires_at") or 0) <= now
    ]
    for token in stale:
        sessions.pop(token, None)
    return sessions


def _get_pulse_session(session_token):
    token = str(session_token or "").strip()
    if not token:
        return None
    sessions = _prune_pulse_sessions(_load_pulse_sessions())
    row = sessions.get(token)
    if not row:
        _save_pulse_sessions(sessions)
        return None
    if int(row.get("expires_at") or 0) <= int(time.time()):
        sessions.pop(token, None)
        _save_pulse_sessions(sessions)
        return None
    return row


def _create_pulse_session(user):
    sessions = _prune_pulse_sessions(_load_pulse_sessions())
    token = uuid.uuid4().hex
    now = int(time.time())
    sessions[token] = {
        "sub": user["sub"],
        "email": user.get("email") or "",
        "name": user.get("name") or "",
        "picture": user.get("picture") or "",
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now)),
        "expires_at": now + PULSE_SESSION_TTL_SEC,
    }
    if len(sessions) > 2000:
        ordered = sorted(
            sessions.items(),
            key=lambda item: int(item[1].get("expires_at") or 0),
        )
        sessions = dict(ordered[-2000:])
    _save_pulse_sessions(sessions)
    return token, sessions[token]


def _revoke_pulse_session(session_token):
    token = str(session_token or "").strip()
    if not token:
        return
    sessions = _load_pulse_sessions()
    sessions.pop(token, None)
    _save_pulse_sessions(sessions)


def _verify_google_id_token(id_token, client_id):
    token = str(id_token or "").strip()
    if not token or not client_id:
        return None
    try:
        with httpx.Client(timeout=10.0) as client:
            resp = client.get(
                "https://oauth2.googleapis.com/tokeninfo",
                params={"id_token": token},
            )
        if resp.status_code != 200:
            return None
        data = resp.json()
    except httpx.HTTPError:
        return None
    aud = str(data.get("aud") or data.get("azp") or "")
    if aud != client_id:
        return None
    try:
        if int(data.get("exp") or 0) <= int(time.time()):
            return None
    except (TypeError, ValueError):
        return None
    if str(data.get("email_verified", "")).lower() not in ("true", "1"):
        return None
    sub = str(data.get("sub") or "").strip()
    email = str(data.get("email") or "").strip()
    if not sub or not email:
        return None
    name = str(data.get("name") or "").strip() or email.split("@")[0]
    return {
        "sub": sub,
        "email": email,
        "name": name[:80],
        "picture": str(data.get("picture") or "").strip(),
    }


def _load_pulse_accounts():
    if not PULSE_ACCOUNTS_PATH.is_file():
        return {}
    try:
        data = json.loads(PULSE_ACCOUNTS_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        return {}


def _save_pulse_accounts(accounts):
    payload = json.dumps(accounts, indent=2, ensure_ascii=False)
    tmp = PULSE_ACCOUNTS_PATH.with_suffix(".json.tmp")
    for attempt in range(8):
        try:
            tmp.write_text(payload, encoding="utf-8")
            tmp.replace(PULSE_ACCOUNTS_PATH)
            return
        except (PermissionError, OSError):
            if attempt == 7:
                raise
            time.sleep(0.5 * (attempt + 1))


def _append_pulse_accounts_csv(row):
    PULSE_ACCOUNTS_CSV_PATH.parent.mkdir(parents=True, exist_ok=True)
    write_header = not PULSE_ACCOUNTS_CSV_PATH.is_file()
    with PULSE_ACCOUNTS_CSV_PATH.open("a", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=_PULSE_CSV_FIELDS)
        if write_header:
            writer.writeheader()
        writer.writerow({field: row.get(field, "") for field in _PULSE_CSV_FIELDS})


def _push_pulse_account_to_sheets(config, row):
    url = str(config.get("sheets_webhook_url") or "").strip()
    if not url:
        return
    try:
        with httpx.Client(timeout=10.0) as client:
            client.post(url, json=row)
    except httpx.HTTPError:
        pass


def _register_pulse_google_user(user):
    accounts = _load_pulse_accounts()
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    existing = accounts.get(user["sub"])
    if existing:
        sign_in_count = int(existing.get("sign_in_count") or 0) + 1
        record = {
            **existing,
            "email": user.get("email") or existing.get("email"),
            "name": user.get("name") or existing.get("name"),
            "picture": user.get("picture") or existing.get("picture"),
            "last_seen": now,
            "sign_in_count": sign_in_count,
        }
    else:
        sign_in_count = 1
        record = {
            "sub": user["sub"],
            "email": user.get("email") or "",
            "name": user.get("name") or "",
            "picture": user.get("picture") or "",
            "first_seen": now,
            "last_seen": now,
            "sign_in_count": sign_in_count,
        }
    accounts[user["sub"]] = record
    _save_pulse_accounts(accounts)
    csv_row = {
        "timestamp": now,
        "event": "sign_in",
        "google_sub": record.get("sub"),
        "email": record.get("email"),
        "name": record.get("name"),
        "picture_url": record.get("picture"),
        "sign_in_count": sign_in_count,
    }
    _append_pulse_accounts_csv(csv_row)
    _push_pulse_account_to_sheets(_load_pulse_google_config(), csv_row)
    return record


def _pulse_actor_from_body(body):
    config = _load_pulse_google_config()
    session_token = body.get("session_token")
    if config.get("google_enabled"):
        user = _get_pulse_session(session_token)
        if not user:
            return None, "Sign in with Google to continue"
        return {
            "mode": "google",
            "sub": user["sub"],
            "username": user.get("name") or user.get("email") or "user",
            "email": user.get("email") or "",
            "picture": user.get("picture") or "",
        }, None
    username = _normalize_pulse_username(body.get("username"))
    if not username:
        return None, "Pick a display name first"
    return {"mode": "legacy", "sub": None, "username": username}, None


def _pulse_actor_key(actor):
    if actor.get("sub"):
        return f"sub:{actor['sub']}"
    return f"name:{actor.get('username')}"


def _pulse_post_owner_match(post, actor):
    if actor.get("sub") and post.get("user_sub"):
        return post.get("user_sub") == actor["sub"]
    return post.get("username") == actor.get("username")


def _pulse_google_auth(body):
    config = _load_pulse_google_config()
    if not config.get("google_enabled"):
        return None, "Google Sign-In is not configured on this server"
    user = _verify_google_id_token(body.get("credential"), config["client_id"])
    if not user:
        return None, "Google sign-in failed — try again"
    account = _register_pulse_google_user(user)
    session_token, session = _create_pulse_session(user)
    return {
        "ok": True,
        "session_token": session_token,
        "user": {
            "sub": session["sub"],
            "email": session.get("email"),
            "name": session.get("name"),
            "picture": session.get("picture"),
            "sign_in_count": account.get("sign_in_count"),
        },
    }, None


def _pulse_logout(body):
    _revoke_pulse_session(body.get("session_token"))
    return {"ok": True}, None


def _load_pulse_posts():
    if not PULSE_POSTS_PATH.is_file():
        return []
    try:
        data = json.loads(PULSE_POSTS_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except json.JSONDecodeError:
        return []


def _save_pulse_posts(posts):
    PULSE_MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(posts, indent=2, ensure_ascii=False)
    tmp = PULSE_POSTS_PATH.with_suffix(".json.tmp")
    for attempt in range(8):
        try:
            tmp.write_text(payload, encoding="utf-8")
            tmp.replace(PULSE_POSTS_PATH)
            return
        except (PermissionError, OSError):
            if attempt == 7:
                raise
            time.sleep(0.5 * (attempt + 1))


def _find_pulse_post(posts, post_id):
    for post in posts:
        if str(post.get("id")) == str(post_id):
            return post
    return None


def _save_pulse_image(image_base64):
    raw = _decode_preview_b64(image_base64)
    if not raw:
        return None
    if len(raw) > MAX_PULSE_IMAGE_BYTES:
        raise ValueError("Image too large (max 2 MB).")
    PULSE_MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    ext = ".jpg" if raw[:3] == b"\xff\xd8\xff" else ".png"
    name = f"{uuid.uuid4().hex}{ext}"
    dest = PULSE_MEDIA_DIR / name
    dest.write_bytes(raw)
    return f"/data/pulse-media/{name}"


def _resolve_pulse_painting(number):
    try:
        n = int(number)
    except (TypeError, ValueError):
        return None
    if n < 1:
        return None
    path = GALLERY / "paintings" / f"{n}.jpg"
    if path.is_file():
        return n
    return None


def _pulse_feed_payload():
    posts = _load_pulse_posts()
    posts.sort(key=lambda p: str(p.get("created_at") or ""), reverse=True)
    return {"ok": True, "posts": posts[:MAX_PULSE_POSTS]}


def _pulse_create_post(body):
    actor, err = _pulse_actor_from_body(body)
    if err:
        return None, err
    text = str(body.get("text") or "").strip()[:2000]
    painting_number = _resolve_pulse_painting(body.get("painting_number"))
    image_url = None
    if body.get("image_base64"):
        try:
            image_url = _save_pulse_image(body.get("image_base64"))
        except ValueError as exc:
            return None, str(exc)
        if not image_url:
            return None, "Invalid image data"
    if not text and not image_url and not painting_number:
        return None, "Post needs text, an image, or a painting number"
    entry = {
        "id": str(uuid.uuid4()),
        "username": actor.get("username"),
        "user_sub": actor.get("sub"),
        "user_picture": actor.get("picture") or "",
        "text": text,
        "image_url": image_url,
        "painting_number": painting_number,
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "likes": [],
        "comments": [],
    }
    posts = _load_pulse_posts()
    posts.append(entry)
    if len(posts) > MAX_PULSE_POSTS:
        posts = posts[-MAX_PULSE_POSTS:]
    _save_pulse_posts(posts)
    return entry, None


def _pulse_toggle_like(body):
    actor, err = _pulse_actor_from_body(body)
    if err:
        return None, err
    post_id = body.get("post_id")
    if not post_id:
        return None, "Missing post_id"
    posts = _load_pulse_posts()
    post = _find_pulse_post(posts, post_id)
    if not post:
        return None, "Post not found"
    likes = post.setdefault("likes", [])
    actor_key = _pulse_actor_key(actor)
    liked = False
    if actor_key in likes:
        likes.remove(actor_key)
    else:
        likes.append(actor_key)
        liked = True
    _save_pulse_posts(posts)
    return {"ok": True, "liked": liked, "like_count": len(likes)}, None


def _pulse_add_comment(body):
    actor, err = _pulse_actor_from_body(body)
    if err:
        return None, err
    post_id = body.get("post_id")
    text = str(body.get("text") or "").strip()[:500]
    if not post_id:
        return None, "Missing post_id"
    if not text:
        return None, "Comment cannot be empty"
    posts = _load_pulse_posts()
    post = _find_pulse_post(posts, post_id)
    if not post:
        return None, "Post not found"
    comment = {
        "id": str(uuid.uuid4()),
        "username": actor.get("username"),
        "user_sub": actor.get("sub"),
        "text": text,
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    comments = post.setdefault("comments", [])
    comments.append(comment)
    if len(comments) > 200:
        post["comments"] = comments[-200:]
    _save_pulse_posts(posts)
    return {
        "ok": True,
        "comment": comment,
        "comment_count": len(post["comments"]),
    }, None


def _pulse_delete_post(body):
    actor, err = _pulse_actor_from_body(body)
    if err:
        return None, err
    post_id = body.get("post_id")
    if not post_id:
        return None, "Missing post_id"
    posts = _load_pulse_posts()
    post = _find_pulse_post(posts, post_id)
    if not post:
        return None, "Post not found"
    if not _pulse_post_owner_match(post, actor):
        return None, "Only the author can delete this post"
    posts = [p for p in posts if str(p.get("id")) != str(post_id)]
    _save_pulse_posts(posts)
    return {"ok": True, "post_id": post_id}, None


_orig_app_handler_do_get_pulse = AppHandler.do_GET


def _app_handler_do_get_with_pulse(self):
    parsed = urlparse(self.path)
    if parsed.path == "/api/pulse/feed":
        return self._json(_pulse_feed_payload())
    if parsed.path == "/api/pulse/config":
        config = _load_pulse_google_config()
        return self._json({
            "ok": True,
            "google_enabled": config.get("google_enabled"),
            "client_id": config.get("client_id") if config.get("google_enabled") else "",
        })
    return _orig_app_handler_do_get_pulse(self)


AppHandler.do_GET = _app_handler_do_get_with_pulse


_orig_app_handler_do_post_pulse = AppHandler.do_POST


def _app_handler_do_post_with_pulse(self):
    parsed = urlparse(self.path)
    pulse_routes = {
        "/api/pulse/auth/google": _pulse_google_auth,
        "/api/pulse/auth/logout": _pulse_logout,
        "/api/pulse/posts": _pulse_create_post,
        "/api/pulse/posts/like": _pulse_toggle_like,
        "/api/pulse/posts/comment": _pulse_add_comment,
        "/api/pulse/posts/delete": _pulse_delete_post,
    }
    if parsed.path in pulse_routes:
        try:
            body = self._read_json()
        except Exception:
            return self._json({"ok": False, "error": "Invalid JSON"}, 400)
        result, err = pulse_routes[parsed.path](body)
        if err:
            status = 401 if parsed.path == "/api/pulse/auth/google" else 400
            return self._json({"ok": False, "error": err}, status)
        if parsed.path == "/api/pulse/posts":
            return self._json({"ok": True, "post": result})
        return self._json(result)
    return _orig_app_handler_do_post_pulse(self)


AppHandler.do_POST = _app_handler_do_post_with_pulse


# --- API spell chains ---

API_CHAINS_PATH = GALLERY / "data" / "api-chains.json"
MAX_API_CHAINS = 200


def _load_api_chains():
    if not API_CHAINS_PATH.is_file():
        return []
    try:
        data = json.loads(API_CHAINS_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except json.JSONDecodeError:
        return []


def _save_api_chains(chains):
    payload = json.dumps(chains, indent=2, ensure_ascii=False)
    tmp = API_CHAINS_PATH.with_suffix(".json.tmp")
    for attempt in range(8):
        try:
            tmp.write_text(payload, encoding="utf-8")
            tmp.replace(API_CHAINS_PATH)
            return
        except (PermissionError, OSError):
            if attempt == 7:
                raise
            time.sleep(0.5 * (attempt + 1))


def _slugify_api_chain(name):
    text = re.sub(r"[^a-zA-Z0-9]+", "-", str(name or "").strip().lower())
    text = re.sub(r"-+", "-", text).strip("-")
    return (text[:48] or "chain")


def _unique_api_slug(chains, base_slug, exclude_id=None):
    slug = base_slug
    taken = {
        str(c.get("slug"))
        for c in chains
        if str(c.get("id")) != str(exclude_id or "") and c.get("slug")
    }
    if slug not in taken:
        return slug
    for n in range(2, 100):
        candidate = f"{base_slug}-{n}"
        if candidate not in taken:
            return candidate
    return f"{base_slug}-{uuid.uuid4().hex[:6]}"


def _find_api_chain(chains, slug_or_id):
    key = str(slug_or_id or "")
    for chain in chains:
        if str(chain.get("slug")) == key or str(chain.get("id")) == key:
            return chain
    return None


def _fuse_chain_prompt(chain, body):
    steps = chain.get("steps") or []
    seed = str((body or {}).get("input") or (body or {}).get("prompt") or "").strip()
    lines = []
    if seed:
        lines.append(f"Seed input: {seed}")
    for step in steps:
        op = str(step.get("operation") or "fuse")
        title = str(step.get("title") or step.get("label") or "spell")
        desc = str(step.get("description") or "").strip()
        tags = step.get("tags") or []
        tag_text = ", ".join(str(t) for t in tags[:8])
        num = step.get("painting_num")
        prefix = f"#{num} " if num else ""
        if op == "ingest":
            lines.append(f"[ingest] {prefix}{title}. {desc}")
        elif op == "emit":
            lines.append(f"[emit] Finalize as {prefix}{title} — {tag_text}")
        elif op == "refine":
            lines.append(f"[refine] Polish through {prefix}{title} ({tag_text})")
        else:
            lines.append(f"[{op}] Blend {prefix}{title} — {tag_text}")
    lines.append("Output: fused vision prompt for downstream generation.")
    return "\n".join(lines)


def _api_chains_list_payload():
    chains = _load_api_chains()
    chains.sort(key=lambda c: str(c.get("created_at") or ""), reverse=True)
    return {"ok": True, "chains": chains[:MAX_API_CHAINS]}


def _api_chain_get(slug):
    chain = _find_api_chain(_load_api_chains(), slug)
    if not chain:
        return None, "Chain API not found"
    return chain, None


def _api_chain_save(body):
    name = str(body.get("name") or "Spell Chain").strip()[:80] or "Spell Chain"
    description = str(body.get("description") or "").strip()[:500]
    steps = body.get("steps") or []
    if not steps:
        return None, "Chain needs at least one spell step"
    if len(steps) > 24:
        return None, "Chain max is 24 steps"
    chains = _load_api_chains()
    chain_id = str(body.get("id") or "").strip()
    existing = _find_api_chain(chains, chain_id) if chain_id else None
    base_slug = _slugify_api_chain(body.get("slug") or name)
    slug = _unique_api_slug(chains, base_slug, existing.get("id") if existing else None)
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    entry = {
        "id": existing.get("id") if existing else str(uuid.uuid4()),
        "name": name,
        "slug": slug,
        "description": description,
        "method": "POST",
        "endpoint": f"/api/chains/{slug}/run",
        "steps": steps,
        "step_count": len(steps),
        "openapi": body.get("openapi") or {},
        "created_at": existing.get("created_at") if existing else now,
        "updated_at": now,
    }
    if existing:
        chains = [c for c in chains if str(c.get("id")) != str(existing.get("id"))]
    chains.append(entry)
    if len(chains) > MAX_API_CHAINS:
        chains = chains[-MAX_API_CHAINS:]
    _save_api_chains(chains)
    return entry, None


def _api_chain_remove(body):
    chain_id = body.get("id") or body.get("slug")
    if not chain_id:
        return None, "Missing id"
    chains = _load_api_chains()
    if not _find_api_chain(chains, chain_id):
        return None, "Chain API not found"
    chains = [
        c for c in chains
        if str(c.get("id")) != str(chain_id) and str(c.get("slug")) != str(chain_id)
    ]
    _save_api_chains(chains)
    return {"ok": True, "id": chain_id}, None


def _api_chain_run(slug, body):
    chain = _find_api_chain(_load_api_chains(), slug)
    if not chain:
        return None, "Chain API not found"
    fused = _fuse_chain_prompt(chain, body or {})
    override = str((body or {}).get("prompt") or "").strip()
    if override:
        fused = override + "\n\n" + fused
    return {
        "ok": True,
        "chain_id": chain.get("id"),
        "slug": chain.get("slug"),
        "name": chain.get("name"),
        "step_count": chain.get("step_count") or len(chain.get("steps") or []),
        "fused_prompt": fused,
        "steps": chain.get("steps") or [],
    }, None


def _parse_api_chain_path(path):
    if path == "/api/chains":
        return "list", None
    if path == "/api/chains/remove":
        return "remove", None
    match = re.match(r"^/api/chains/([^/]+)/run$", path)
    if match:
        return "run", match.group(1)
    match = re.match(r"^/api/chains/([^/]+)$", path)
    if match:
        return "get", match.group(1)
    return None, None


_orig_app_handler_do_get_chains = AppHandler.do_GET


def _app_handler_do_get_with_chains(self):
    parsed = urlparse(self.path)
    action, slug = _parse_api_chain_path(parsed.path)
    if action == "list":
        return self._json(_api_chains_list_payload())
    if action == "get" and slug:
        result, err = _api_chain_get(slug)
        if err:
            return self._json({"ok": False, "error": err}, 404)
        return self._json({"ok": True, "chain": result})
    return _orig_app_handler_do_get_chains(self)


AppHandler.do_GET = _app_handler_do_get_with_chains


_orig_app_handler_do_post_chains = AppHandler.do_POST


def _normalize_api_path(path: str) -> str:
    parsed = urlparse(path or "")
    clean = (parsed.path or "/").rstrip("/") or "/"
    return clean


def _post_analyze_image(self, parsed):
    if _normalize_api_path(parsed.path) != "/api/analyze-image":
        return None
    try:
        body = self._read_json()
    except Exception:
        return self._json({"ok": False, "error": "Invalid JSON"}, 400)
    image = str(body.get("image") or body.get("image_data") or "").strip()
    if not image:
        return self._json({"ok": False, "error": "Missing image"}, 400)
    mode = str(body.get("mode") or body.get("prompt_mode") or "import").strip().lower()
    extra = str(body.get("emphasis") or body.get("hint") or body.get("prompt") or "").strip()
    try:
        analysis = analyze_import_image(image, mode=mode, emphasis=extra)
        return self._json({"ok": True, "analysis": analysis, "mode": mode})
    except Exception as exc:
        return self._json({"ok": False, "error": str(exc)}, 500)


def _app_handler_do_post_with_chains(self):
    parsed = urlparse(self.path)
    analyze_resp = _post_analyze_image(self, parsed)
    if analyze_resp is not None:
        return analyze_resp
    action, slug = _parse_api_chain_path(parsed.path)
    if action in ("list", "get"):
        return _orig_app_handler_do_post_chains(self)
    try:
        body = self._read_json() if action in ("remove", "run") or parsed.path == "/api/chains" else {}
    except Exception:
        body = {}
    if parsed.path == "/api/chains":
        result, err = _api_chain_save(body)
        if err:
            return self._json({"ok": False, "error": err}, 400)
        return self._json({"ok": True, "chain": result})
    if action == "remove":
        result, err = _api_chain_remove(body)
        if err:
            return self._json({"ok": False, "error": err}, 404)
        return self._json(result)
    if action == "run" and slug:
        result, err = _api_chain_run(slug, body)
        if err:
            return self._json({"ok": False, "error": err}, 404)
        return self._json(result)
    return _orig_app_handler_do_post_chains(self)


AppHandler.do_POST = _app_handler_do_post_with_chains


# --- Cast import image analysis ---

IMPORT_IMAGE_ANALYSIS_PROMPT = """Imported reference image for spell casting. Study the image carefully.
Describe ONLY what is actually visible. Match subject_type to the image.
Return ONLY JSON:
{"title":"max 6 words","description":"2 accurate sentences","style":"category","medium":"guess","mood":"1-3 words","subject_type":"painting|object|character_sheet|sprite_sheet|scene|portrait|other","tags":["up to 6 tags"],"colors":["up to 4 colors"]}"""

GENERATION_PROMPT_FROM_IMAGE = """You write image-generation prompts from a reference photo or painting.
Study the image carefully. Describe ONLY what is visible — subject, composition, lighting, materials, color, style, atmosphere.
Write ONE dense, ready-to-paste generation prompt (not a caption). Prefer concrete visual language over vague adjectives. No camera model names, no "4k", no "masterpiece", no hashtags, no quotes around the whole prompt.
If the user adds emphasis, weave it in only where it fits what you see.
Return ONLY JSON:
{"prompt":"one paragraph generation prompt, 60-140 words","title":"max 6 words","style":"category","mood":"1-3 words","medium":"guess","tags":["up to 8 tags"],"colors":["up to 5 colors"]}"""

PHONE_UPLOAD_ANALYSIS_PROMPT = """Phone-uploaded photo for a local art gallery. Study the image carefully.
Describe ONLY what is actually visible. Also write a dense generation prompt (prompt-weight text) that could recreate this image's look for later casting / generation.
Return ONLY JSON:
{"title":"max 6 words","description":"2 accurate sentences of what is visible","prompt":"one paragraph generation prompt 50-120 words, concrete visual language, no 4k/masterpiece/hashtags","style":"category","medium":"guess","mood":"1-3 words","subject_type":"photo|painting|object|portrait|scene|other","tags":["up to 6 tags"],"colors":["up to 4 colors"]}"""


def _import_image_data_url(image_data: str, max_size: int = 768) -> str:
    text = str(image_data or "").strip()
    if not text:
        raise ValueError("Missing image data.")
    if text.startswith("data:image"):
        try:
            from analyze import DEFAULT_MAX_SIZE  # noqa: PLC0415

            header, b64 = text.split(",", 1)
            raw = base64.standard_b64decode(b64)
            from io import BytesIO  # noqa: PLC0415

            from PIL import Image  # noqa: PLC0415

            img = Image.open(BytesIO(raw))
            cap = max_size or DEFAULT_MAX_SIZE
            img.thumbnail((cap, cap))
            if img.mode not in ("RGB", "L"):
                img = img.convert("RGB")
            buf = BytesIO()
            img.save(buf, format="JPEG", quality=82, optimize=True)
            encoded = base64.standard_b64encode(buf.getvalue()).decode("ascii")
            return f"data:image/jpeg;base64,{encoded}"
        except Exception:
            return text
    if text.startswith("/") or text.startswith("http"):
        return text
    raise ValueError("Image must be a data URL from Cast import.")


def _xai_post_with_auth_retry(url: str, json_body: dict, *, timeout: float = 90.0):
    """POST to xAI with Bearer auth; refresh OAuth once on validation/401 failures."""
    from analyze import friendly_xai_auth_error, get_api_key  # noqa: PLC0415

    last_err: Exception | None = None
    for attempt in range(2):
        try:
            api_key = get_api_key(force_refresh=(attempt > 0))
        except Exception as exc:
            raise ValueError(friendly_xai_auth_error(exc)) from exc
        try:
            with httpx.Client() as client:
                resp = client.post(
                    url,
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json",
                    },
                    json=json_body,
                    timeout=timeout,
                )
                if resp.status_code in (401, 403):
                    body_txt = (resp.text or "")[:400]
                    if attempt == 0 and (
                        "oauth" in body_txt.lower()
                        or "token" in body_txt.lower()
                        or "unauthenticated" in body_txt.lower()
                    ):
                        # Force refresh on second attempt
                        try:
                            get_api_key(force_refresh=True)
                        except Exception:
                            pass
                        last_err = httpx.HTTPStatusError(
                            f"HTTP {resp.status_code}: {body_txt}",
                            request=resp.request,
                            response=resp,
                        )
                        continue
                    raise ValueError(friendly_xai_auth_error(body_txt or f"HTTP {resp.status_code}"))
                resp.raise_for_status()
                return resp
        except httpx.HTTPStatusError as exc:
            last_err = exc
            txt = ""
            try:
                txt = exc.response.text[:400]
            except Exception:
                txt = str(exc)
            if attempt == 0 and (
                "oauth" in txt.lower()
                or "token" in txt.lower()
                or "401" in txt
                or "unauthenticated" in txt.lower()
            ):
                try:
                    get_api_key(force_refresh=True)
                except Exception:
                    pass
                continue
            raise ValueError(friendly_xai_auth_error(txt or exc)) from exc
        except Exception as exc:
            raise ValueError(friendly_xai_auth_error(exc)) from exc
    if last_err:
        raise ValueError(friendly_xai_auth_error(last_err)) from last_err
    raise ValueError(friendly_xai_auth_error("xAI auth failed"))


def analyze_import_image(image_data: str, mode: str = "import", emphasis: str = "") -> dict:
    from analyze import API_URL, DEFAULT_MODEL, extract_text, parse_json_response  # noqa: PLC0415

    data_url = _import_image_data_url(image_data)
    mode_l = str(mode or "import").strip().lower()
    if mode_l in ("prompt", "generation", "generation_prompt", "gen_prompt"):
        text_prompt = GENERATION_PROMPT_FROM_IMAGE
        if emphasis:
            text_prompt += f"\nUser emphasis (weave in if it fits the image): {emphasis[:500]}"
    elif mode_l in ("phone", "phone_upload", "transfer", "phone-uploads"):
        text_prompt = PHONE_UPLOAD_ANALYSIS_PROMPT
        if emphasis:
            text_prompt += f"\nExtra note: {emphasis[:300]}"
    else:
        text_prompt = IMPORT_IMAGE_ANALYSIS_PROMPT
        if emphasis:
            text_prompt += f"\nExtra note: {emphasis[:300]}"

    resp = _xai_post_with_auth_retry(
        API_URL,
        {
            "model": DEFAULT_MODEL,
            "input": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "input_image",
                            "image_url": data_url,
                            "detail": "low",
                        },
                        {"type": "input_text", "text": text_prompt},
                    ],
                }
            ],
            "store": False,
        },
        timeout=90.0,
    )
    text = extract_text(resp.json())
    if not text:
        raise ValueError("Empty analysis response.")
    result = parse_json_response(text)
    result["analyzed_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    # Normalize: always expose a usable "prompt" field for the Prompt tab
    if not result.get("prompt"):
        parts = []
        if result.get("title"):
            parts.append(str(result["title"]))
        if result.get("description"):
            parts.append(str(result["description"]))
        meta = []
        if result.get("style"):
            meta.append(f"{result['style']} style")
        if result.get("mood"):
            meta.append(f"{result['mood']} mood")
        if result.get("medium"):
            meta.append(str(result["medium"]))
        if meta:
            parts.append(", ".join(meta))
        if result.get("tags"):
            parts.append(", ".join(str(t) for t in result["tags"][:8]))
        if result.get("colors"):
            parts.append("palette: " + ", ".join(str(c) for c in result["colors"][:5]))
        result["prompt"] = ". ".join(p for p in parts if p).replace("..", ".").strip()
    return result


_orig_app_handler_do_post_analyze_image = AppHandler.do_POST


def _app_handler_do_post_with_analyze_image(self):
    parsed = urlparse(self.path)
    analyze_resp = _post_analyze_image(self, parsed)
    if analyze_resp is not None:
        return analyze_resp
    return _orig_app_handler_do_post_analyze_image(self)


AppHandler.do_POST = _app_handler_do_post_with_analyze_image


# --- Remote media proxy (playback + MP4 export) + sequential saved-videos/ ---

# Mixed voice clips + 720p loops can exceed 96MB; allow large gallery saves.
_PROXY_MEDIA_MAX_BYTES = 256 * 1024 * 1024
SAVED_VIDEOS_DIR = GALLERY / "saved-videos"
VIDEO_EXTENSIONS = {".mp4", ".webm", ".mov", ".m4v"}


def _proxy_media_url_allowed(url: str) -> bool:
    parsed = urlparse(str(url or "").strip())
    if parsed.scheme not in ("http", "https"):
        return False
    host = (parsed.hostname or "").lower()
    if not host:
        return False
    if host in ("localhost", "127.0.0.1", "0.0.0.0", "::1"):
        return False
    if host.startswith("192.168.") or host.startswith("10.") or host.startswith("172."):
        return False
    return True


def _guess_video_content_type(url: str, content_type: str) -> str:
    content_type = (content_type or "application/octet-stream").split(";")[0].strip()
    if content_type in ("application/octet-stream", "binary/octet-stream", ""):
        lower = str(url).lower()
        if lower.endswith(".mp4") or ".mp4?" in lower:
            return "video/mp4"
        if lower.endswith(".webm") or ".webm?" in lower:
            return "video/webm"
        if lower.endswith(".mov") or ".mov?" in lower:
            return "video/quicktime"
    return content_type or "video/mp4"


def _proxy_media_fetch(url: str) -> tuple[bytes, str]:
    if not _proxy_media_url_allowed(url):
        raise ValueError("URL not allowed for proxy.")
    with httpx.Client(follow_redirects=True, timeout=120.0) as client:
        with client.stream("GET", url) as resp:
            resp.raise_for_status()
            content_type = _guess_video_content_type(
                url, resp.headers.get("content-type", "application/octet-stream")
            )
            chunks: list[bytes] = []
            total = 0
            for chunk in resp.iter_bytes():
                if not chunk:
                    continue
                total += len(chunk)
                if total > _PROXY_MEDIA_MAX_BYTES:
                    raise ValueError("Media file too large.")
                chunks.append(chunk)
            return b"".join(chunks), content_type


def _proxy_download_filename(url: str, content_type: str, preferred: str = "") -> str:
    """Human filename for downloads — never 'proxy-media'."""
    preferred = re.sub(r"[^A-Za-z0-9._-]+", "", str(preferred or "").strip())
    if preferred and "." in preferred:
        return preferred
    lower = str(url or "").lower()
    ct = (content_type or "").lower()
    if "webm" in ct or lower.endswith(".webm") or ".webm?" in lower:
        ext = ".webm"
    elif "quicktime" in ct or lower.endswith(".mov") or ".mov?" in lower:
        ext = ".mov"
    else:
        ext = ".mp4"
    if preferred:
        return preferred if preferred.endswith(ext) else preferred + ext
    return f"video{ext}"


def _respond_proxy_media(handler, url: str, filename: str = ""):
    try:
        data, content_type = _proxy_media_fetch(url)
    except Exception as exc:
        return handler._json({"ok": False, "error": str(exc)}, 502)
    fname = _proxy_download_filename(url, content_type, filename)
    handler.send_response(200)
    handler.send_header("Content-Type", content_type)
    handler.send_header("Content-Length", str(len(data)))
    handler.send_header("Cache-Control", "private, max-age=1800")
    # Avoid browser "Save as" naming the file proxy-media
    handler.send_header(
        "Content-Disposition", f'inline; filename="{fname}"; filename*=UTF-8\'\'{fname}'
    )
    handler.end_headers()
    handler.wfile.write(data)


def next_saved_video_index() -> int:
    """Next free integer name in saved-videos/ (1.mp4, 2.mp4, …)."""
    SAVED_VIDEOS_DIR.mkdir(parents=True, exist_ok=True)
    max_n = 0
    for entry in SAVED_VIDEOS_DIR.iterdir():
        if not entry.is_file():
            continue
        if entry.suffix.lower() not in VIDEO_EXTENSIONS:
            continue
        if entry.stem.isdigit():
            max_n = max(max_n, int(entry.stem))
    return max_n + 1


def scan_saved_videos() -> list[dict]:
    """List sequential clips in saved-videos/ like generated/ for stills."""
    if not SAVED_VIDEOS_DIR.is_dir():
        return []
    items = []
    for entry in SAVED_VIDEOS_DIR.iterdir():
        if not entry.is_file():
            continue
        if entry.suffix.lower() not in VIDEO_EXTENSIONS:
            continue
        if not entry.stem.isdigit():
            continue
        items.append(
            {
                "num": int(entry.stem),
                "name": entry.name,
                "url": f"/saved-videos/{entry.name}",
            }
        )
    items.sort(key=lambda x: x["num"])
    return items


def _write_saved_videos_manifest() -> None:
    """Keep data/saved-videos-manifest.json in sync with the folder (1..N)."""
    items = scan_saved_videos()
    path = GALLERY / "data" / "saved-videos-manifest.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps({"items": items, "count": len(items)}, indent=2) + "\n",
        encoding="utf-8",
    )


def _ext_for_video_content_type(content_type: str, url: str = "") -> str:
    ct = (content_type or "").lower()
    lower = str(url or "").lower()
    if "webm" in ct or lower.endswith(".webm"):
        return ".webm"
    if "quicktime" in ct or lower.endswith(".mov"):
        return ".mov"
    return ".mp4"


def _find_ffmpeg() -> str | None:
    """Locate ffmpeg for WebM→MP4 conversion (PATH or imageio-ffmpeg bundle)."""
    found = shutil.which("ffmpeg")
    if found:
        return found
    try:
        import imageio_ffmpeg  # type: ignore

        exe = imageio_ffmpeg.get_ffmpeg_exe()
        if exe and Path(exe).is_file():
            return str(exe)
    except Exception:
        pass
    return None


def _looks_like_mp4(data: bytes, content_type: str = "", source_url: str = "") -> bool:
    ct = (content_type or "").lower()
    lower = str(source_url or "").lower()
    if "mp4" in ct or lower.endswith(".mp4") or ".mp4?" in lower:
        return True
    # ISO BMFF / ftyp box
    if len(data) >= 12 and data[4:8] == b"ftyp":
        return True
    return False


def convert_video_bytes_to_mp4(data: bytes, content_type: str = "", source_url: str = "") -> tuple[bytes, str]:
    """
    Return (bytes, content_type). Prefer H.264 MP4 for saved-videos/.
    If already MP4, return as-is. If conversion is impossible, return original.
    """
    if not data:
        raise ValueError("Empty video data.")
    if _looks_like_mp4(data, content_type, source_url):
        return data, "video/mp4"

    ffmpeg = _find_ffmpeg()
    if not ffmpeg:
        # Cannot convert — caller may still save, but we prefer refusing webm→.mp4 rename
        return data, (content_type or "application/octet-stream")

    import subprocess
    import tempfile

    src_ext = _ext_for_video_content_type(content_type, source_url)
    if src_ext not in (".webm", ".mov", ".m4v", ".mp4", ".mkv"):
        src_ext = ".webm"

    with tempfile.TemporaryDirectory(prefix="gallery-vid-") as td:
        td_path = Path(td)
        inp = td_path / f"in{src_ext}"
        out = td_path / "out.mp4"
        inp.write_bytes(data)
        # Re-encode for broad player support (voice-mix WebM often needs this)
        cmd = [
            ffmpeg,
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(inp),
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "23",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "160k",
            "-movflags",
            "+faststart",
            str(out),
        ]
        try:
            subprocess.run(cmd, check=True, capture_output=True, timeout=600)
        except Exception as exc:
            # Last resort: try stream copy into mp4 (works for some inputs)
            cmd_copy = [
                ffmpeg,
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                str(inp),
                "-c",
                "copy",
                "-movflags",
                "+faststart",
                str(out),
            ]
            try:
                subprocess.run(cmd_copy, check=True, capture_output=True, timeout=300)
            except Exception:
                raise ValueError(
                    f"Could not convert video to MP4 ({exc}). "
                    "Install ffmpeg and restart start_server.bat, or save a remote MP4 source."
                ) from exc
        if not out.is_file() or out.stat().st_size < 32:
            raise ValueError("MP4 conversion produced an empty file.")
        return out.read_bytes(), "video/mp4"


def save_video_bytes(
    data: bytes,
    content_type: str = "video/mp4",
    source_url: str = "",
    *,
    force_mp4: bool = True,
) -> dict:
    """Write video bytes as the next sequential file in saved-videos/ (default: always .mp4)."""
    if not data:
        raise ValueError("Empty video data.")
    if len(data) > _PROXY_MEDIA_MAX_BYTES:
        raise ValueError(
            f"Video file too large ({len(data) // (1024 * 1024)} MB). "
            f"Max is {_PROXY_MEDIA_MAX_BYTES // (1024 * 1024)} MB."
        )

    converted_note = ""
    out_ct = content_type or "video/mp4"
    if force_mp4:
        try:
            data, out_ct = convert_video_bytes_to_mp4(data, content_type, source_url)
            if not _looks_like_mp4(data, out_ct, source_url) and force_mp4:
                raise ValueError(
                    "Video is not MP4 and ffmpeg is unavailable to convert it. "
                    "Install ffmpeg (or pip install imageio-ffmpeg), restart the server, and try again."
                )
            if "webm" in (content_type or "").lower() or str(source_url).lower().endswith(".webm"):
                converted_note = "converted_to_mp4"
        except ValueError:
            raise
        except Exception as exc:
            raise ValueError(f"MP4 conversion failed: {exc}") from exc

    SAVED_VIDEOS_DIR.mkdir(parents=True, exist_ok=True)
    num = next_saved_video_index()
    if force_mp4 and _looks_like_mp4(data, out_ct, source_url):
        ext = ".mp4"
        out_ct = "video/mp4"
    else:
        ext = _ext_for_video_content_type(out_ct, source_url)
    name = f"{num}{ext}"
    dest = SAVED_VIDEOS_DIR / name
    dest.write_bytes(data)
    _write_saved_videos_manifest()
    rel = f"saved-videos/{name}"
    result = {
        "ok": True,
        "num": num,
        "name": name,
        "path": rel,
        "dir": "saved-videos",
        "url": f"/{rel}",
        "content_type": out_ct,
        "bytes": len(data),
    }
    if converted_note:
        result["note"] = converted_note
    return result


def save_video_from_url(url: str, *, force_mp4: bool = True) -> dict:
    """
    Fetch a remote (or local gallery) video and store as saved-videos/N.mp4 (by default).
    """
    url = str(url or "").strip()
    if not url:
        raise ValueError("Missing video url.")
    if url.startswith("blob:") or url.startswith("blob%3A"):
        raise ValueError(
            "Cannot save a browser blob: URL from the server. "
            "Upload the file bytes (multipart) instead."
        )

    # Already a local sequential save
    m = re.search(r"/saved-videos/(\d+)\.([a-z0-9]+)$", url, re.I)
    if m:
        num = int(m.group(1))
        ext = m.group(2).lower()
        name = f"{num}.{ext}"
        if force_mp4 and ext != "mp4":
            local = SAVED_VIDEOS_DIR / name
            if local.is_file():
                data = local.read_bytes()
                return save_video_bytes(data, f"video/{ext}", str(local), force_mp4=True)
        return {
            "ok": True,
            "num": num,
            "name": name,
            "path": f"saved-videos/{name}",
            "dir": "saved-videos",
            "url": f"/saved-videos/{name}",
            "already_saved": True,
        }

    # Local gallery path
    parsed = urlparse(url)
    path_part = parsed.path if parsed.scheme else url
    if path_part.startswith("/"):
        local = (GALLERY / path_part.lstrip("/")).resolve()
        try:
            local.relative_to(GALLERY.resolve())
        except ValueError:
            local = None
        if local and local.is_file() and local.suffix.lower() in VIDEO_EXTENSIONS:
            data = local.read_bytes()
            return save_video_bytes(
                data,
                _guess_video_content_type(str(local), ""),
                str(local),
                force_mp4=force_mp4,
            )

    data, content_type = _proxy_media_fetch(url)
    return save_video_bytes(data, content_type, url, force_mp4=force_mp4)


def _video_payload_url(video) -> str:
    if not video:
        return ""
    if isinstance(video, str):
        return video.strip()
    if isinstance(video, dict):
        for key in ("url", "download_url", "uri", "href", "src"):
            val = video.get(key)
            if val:
                return str(val).strip()
    return ""


def auto_save_generated_video(video, *, force_mp4: bool = True):
    """
    Persist any generated video dict/url into gallery/saved-videos/N.mp4.
    Returns an updated video payload (dict) with local url + saved metadata.
    On failure, returns the original video unchanged.
    """
    try:
        remote = _video_payload_url(video)
        if not remote:
            return video
        if remote.startswith("blob:") or remote.startswith("data:"):
            return video
        # Already under saved-videos/
        if re.search(r"/saved-videos/\d+\.[a-z0-9]+", remote, re.I):
            if isinstance(video, dict):
                out = dict(video)
                out.setdefault("url", f"/saved-videos/{remote.rsplit('/', 1)[-1]}")
                out["already_saved"] = True
                return out
            return video

        saved = save_video_from_url(remote, force_mp4=force_mp4)
        local_url = str(saved.get("url") or "")
        if isinstance(video, dict):
            out = dict(video)
            out["remote_url"] = remote
            if local_url:
                out["url"] = local_url
                out["download_url"] = local_url
            out["saved"] = saved
            out["saved_video"] = saved
            return out
        return {
            "url": local_url or remote,
            "remote_url": remote,
            "saved": saved,
            "saved_video": saved,
        }
    except Exception as exc:
        # Never fail the generation job because of disk/proxy save issues
        if isinstance(video, dict):
            out = dict(video)
            out["save_error"] = str(exc)[:400]
            return out
        return video


# Auto-save every job video into saved-videos/ when status becomes done
try:
    _orig_update_job_fields_for_auto_save = _update_job_fields  # type: ignore[name-defined]
except NameError:
    _orig_update_job_fields_for_auto_save = None


if _orig_update_job_fields_for_auto_save is not None:

    def _maybe_autosave_fields(fields: dict) -> dict:
        if not isinstance(fields, dict):
            return fields
        status = fields.get("status")
        video = fields.get("video")
        if video is None:
            return fields
        if str(status or "").lower() not in (
            "done",
            "completed",
            "success",
            "succeeded",
        ):
            return fields
        already = False
        if isinstance(video, dict) and (
            video.get("saved") or video.get("already_saved") or video.get("saved_video")
        ):
            already = True
        url = _video_payload_url(video)
        if url and "/saved-videos/" in url:
            already = True
        if already:
            return fields
        out = dict(fields)
        video2 = auto_save_generated_video(video)
        out["video"] = video2
        if isinstance(video2, dict) and video2.get("saved"):
            out["saved_video"] = video2.get("saved")
        return out

    def _update_job_fields(job_id, *args, **kwargs):  # type: ignore[no-redef]
        # Support both _update_job_fields(id, status=..., video=...) and
        # _update_job_fields(id, {"status": ..., "video": ...}) from bytecode.
        if args and isinstance(args[0], dict) and not kwargs:
            fields = _maybe_autosave_fields(dict(args[0]))
            return _orig_update_job_fields_for_auto_save(job_id, fields)
        if kwargs:
            fields = _maybe_autosave_fields(dict(kwargs))
            return _orig_update_job_fields_for_auto_save(job_id, **fields)
        return _orig_update_job_fields_for_auto_save(job_id, *args, **kwargs)

    globals()["_update_job_fields"] = _update_job_fields


def _read_raw_body(handler, max_bytes: int | None = None) -> bytes:
    max_bytes = max_bytes or _PROXY_MEDIA_MAX_BYTES
    length = int(handler.headers.get("Content-Length") or 0)
    if length <= 0:
        return b""
    if length > max_bytes:
        raise ValueError(
            f"Upload too large ({length // (1024 * 1024)} MB). "
            f"Max is {max_bytes // (1024 * 1024)} MB."
        )
    return handler.rfile.read(length)


def _respond_save_video(handler):
    """
    Save clip to gallery/saved-videos/N.mp4.

    Accepts JSON {url}, JSON {video_base64}, multipart file, or raw video/* body.
    """
    try:
        ctype = (handler.headers.get("Content-Type") or "").lower()
        force_mp4 = True

        if "multipart/form-data" in ctype:
            import cgi

            environ = {
                "REQUEST_METHOD": "POST",
                "CONTENT_TYPE": handler.headers.get("Content-Type", ""),
                "CONTENT_LENGTH": handler.headers.get("Content-Length", "0"),
            }
            form = cgi.FieldStorage(
                fp=handler.rfile,
                headers=handler.headers,
                environ=environ,
                keep_blank_values=True,
            )
            fileitem = None
            if "file" in form:
                fileitem = form["file"]
            elif "video" in form:
                fileitem = form["video"]
            if fileitem is None or not getattr(fileitem, "file", None):
                return handler._json(
                    {"ok": False, "error": "multipart field 'file' (or 'video') required."},
                    400,
                )
            raw = fileitem.file.read()
            mime = getattr(fileitem, "type", None) or "application/octet-stream"
            fname = getattr(fileitem, "filename", "") or ""
            if "force_mp4" in form:
                force_mp4 = str(form.getvalue("force_mp4")).lower() not in ("0", "false", "no")
            result = save_video_bytes(raw, mime, fname, force_mp4=force_mp4)
            return handler._json(result, 200)

        if ctype.startswith("video/"):
            raw = _read_raw_body(handler)
            result = save_video_bytes(raw, ctype, "", force_mp4=True)
            return handler._json(result, 200)

        try:
            body = handler._read_json()
        except Exception as exc:
            return handler._json({"ok": False, "error": str(exc)}, 400)
        if not isinstance(body, dict):
            body = {}
        force_mp4 = body.get("force_mp4", True)
        if isinstance(force_mp4, str):
            force_mp4 = force_mp4.lower() not in ("0", "false", "no")
        url = str(body.get("url") or body.get("video_url") or "").strip()
        b64 = str(body.get("video_base64") or body.get("data") or "").strip()
        if b64:
            if len(b64) > _PROXY_MEDIA_MAX_BYTES * 2:
                return handler._json(
                    {
                        "ok": False,
                        "error": "Base64 upload too large — use multipart file upload instead.",
                    },
                    400,
                )
            if "," in b64 and b64.startswith("data:"):
                header, b64 = b64.split(",", 1)
                mime = header[5:].split(";")[0] if header.startswith("data:") else "video/mp4"
            else:
                mime = str(body.get("content_type") or "video/mp4")
            raw = base64.b64decode(b64, validate=False)
            result = save_video_bytes(raw, mime, "", force_mp4=bool(force_mp4))
        elif url:
            result = save_video_from_url(url, force_mp4=bool(force_mp4))
        else:
            return handler._json(
                {"ok": False, "error": "Provide url, video_base64, or multipart file."},
                400,
            )
        return handler._json(result, 200)
    except Exception as exc:
        return handler._json({"ok": False, "error": str(exc)}, 502)


_orig_app_handler_do_get_proxy_media = AppHandler.do_GET


def _app_handler_do_get_with_proxy_media(self):
    parsed = urlparse(self.path)
    if parsed.path == "/api/proxy-media":
        qs = parse_qs(parsed.query or "")
        url = (qs.get("url") or [""])[0]
        if not url:
            return self._json({"ok": False, "error": "Missing url parameter."}, 400)
        filename = (qs.get("filename") or qs.get("name") or [""])[0]
        return _respond_proxy_media(self, url, filename=filename)
    if parsed.path in ("/api/saved-videos", "/api/saved-videos/"):
        items = scan_saved_videos()
        return self._json({"ok": True, "items": items, "count": len(items), "dir": "saved-videos"})
    return _orig_app_handler_do_get_proxy_media(self)


AppHandler.do_GET = _app_handler_do_get_with_proxy_media


_orig_app_handler_do_post_save_video = AppHandler.do_POST


def _app_handler_do_post_with_save_video(self):
    parsed = urlparse(self.path)
    if parsed.path in ("/api/save-video", "/api/save-video/"):
        return _respond_save_video(self)
    if parsed.path in (
        "/api/save-generated-image",
        "/api/save-generated-image/",
        "/api/save-commercial-image",
        "/api/save-commercial-image/",
    ):
        return _respond_save_generated_image(self)
    return _orig_app_handler_do_post_save_video(self)


AppHandler.do_POST = _app_handler_do_post_with_save_video


_GENERATED_STILL_MAX_BYTES = 12 * 1024 * 1024


def _fetch_image_bytes(image_url: str) -> bytes | None:
    """Load image bytes from local gallery path or remote URL."""
    url = str(image_url or "").strip()
    if not url:
        return None
    if url.startswith("data:"):
        try:
            return _decode_preview_b64(url)
        except Exception:
            return None
    # Local gallery absolute/relative
    raw = _read_image_bytes_from_url(url)
    if raw:
        return raw
    parsed = urlparse(url)
    path_part = parsed.path if parsed.scheme else url
    if path_part.startswith("/"):
        local = (GALLERY / path_part.lstrip("/")).resolve()
        try:
            local.relative_to(GALLERY.resolve())
            if local.is_file() and local.suffix.lower() in IMAGE_EXTENSIONS:
                return local.read_bytes()
        except (ValueError, OSError):
            pass
    # Remote (xAI / CDN temporary URLs)
    if parsed.scheme in ("http", "https"):
        try:
            data, _ct = _proxy_media_fetch(url)
            if data and len(data) > 32:
                return data
        except Exception:
            pass
        try:
            with httpx.Client(timeout=60.0, follow_redirects=True) as client:
                r = client.get(url, headers={"User-Agent": "GallerySaveStill/1.0"})
                if r.status_code == 200 and r.content:
                    return r.content
        except Exception:
            pass
    return None


def save_generated_still(
    preview_b64: str | None = None,
    image_url: str | None = None,
    *,
    source: str = "commercial",
    description: str = "",
    meta: dict | None = None,
) -> dict:
    """
    Persist a still into gallery/generated/N.jpg so it shows in Gallery → Generated.
    Remote xAI URLs expire — always call this after Commercial (or any) generate.
    """
    raw = None
    if preview_b64:
        try:
            raw = _decode_preview_b64(preview_b64)
        except Exception as exc:
            raise ValueError(f"Invalid image_base64: {exc}") from exc
    if not raw and image_url:
        # Already a local generated file
        m = re.search(r"/generated/(\d+)\.([a-z0-9]+)$", str(image_url), re.I)
        if m:
            num = int(m.group(1))
            name = f"{num}.{m.group(2).lower()}"
            return {
                "ok": True,
                "num": num,
                "name": name,
                "path": f"generated/{name}",
                "dir": "generated",
                "url": f"/generated/{name}",
                "already_saved": True,
                "source": source,
            }
        raw = _fetch_image_bytes(image_url)
    if not raw:
        raise ValueError(
            "No image data to save. Provide image_base64 or a reachable image_url "
            "(temporary CDN links must be saved while still valid)."
        )
    if len(raw) > _GENERATED_STILL_MAX_BYTES:
        raise ValueError(f"Image too large ({len(raw) // 1024} KB).")

    GENERATED_DIR.mkdir(parents=True, exist_ok=True)
    num = next_generated_index()
    ext = ".jpg"
    if raw[:8] == b"\x89PNG\r\n\x1a\n":
        ext = ".png"
    elif raw[:3] == b"\xff\xd8\xff":
        ext = ".jpg"
    elif raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        ext = ".webp"
    name = f"{num}{ext}"
    dest = GENERATED_DIR / name
    dest.write_bytes(raw)

    record = {
        "ok": True,
        "num": num,
        "name": name,
        "path": f"generated/{name}",
        "dir": "generated",
        "url": f"/generated/{name}",
        "bytes": len(raw),
        "source": str(source or "commercial")[:64],
        "description": str(description or "")[:4000],
        "saved_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    if meta and isinstance(meta, dict):
        # strip secrets
        safe = {k: v for k, v in meta.items() if k not in ("api_key", "token", "password")}
        record["meta"] = safe
    try:
        (GENERATED_DIR / f"{num}.json").write_text(
            json.dumps(record, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    except OSError:
        pass
    try:
        if callable(globals().get("write_lod1_manifest")):
            write_lod1_manifest()
    except Exception:
        pass
    return record


def _respond_save_generated_image(self):
    try:
        body = self._read_json() or {}
    except Exception:
        return self._json({"ok": False, "error": "Invalid JSON body."}, 400)
    if not isinstance(body, dict):
        return self._json({"ok": False, "error": "Invalid JSON body."}, 400)
    try:
        result = save_generated_still(
            preview_b64=body.get("image_base64")
            or body.get("preview_b64")
            or body.get("preview_png"),
            image_url=body.get("image_url") or body.get("url"),
            source=str(body.get("source") or body.get("collection") or "commercial"),
            description=str(body.get("description") or body.get("stasis") or body.get("title") or ""),
            meta=body.get("meta") if isinstance(body.get("meta"), dict) else None,
        )
        return self._json(result, 200)
    except ValueError as e:
        return self._json({"ok": False, "error": str(e)}, 400)
    except OSError as e:
        return self._json({"ok": False, "error": f"Could not save image: {e}"}, 500)


# --- Game boss fusions: save singular wall-composite images ---
GAME_BOSSES_DIR = GALLERY / "saved-game-bosses"
_GAME_BOSS_MAX_BYTES = 8 * 1024 * 1024


def next_game_boss_index() -> int:
    best = 0
    if not GAME_BOSSES_DIR.is_dir():
        return 1
    for entry in GAME_BOSSES_DIR.iterdir():
        if not entry.is_file():
            continue
        if entry.suffix.lower() not in (".jpg", ".jpeg", ".png", ".webp"):
            continue
        stem = entry.stem
        # allow "12" or "12-meta" skip meta json
        if stem.isdigit():
            best = max(best, int(stem))
    return best + 1


def save_game_boss_image(
    preview_b64: str | None = None,
    image_url: str | None = None,
    *,
    source_paintings: list | None = None,
    description: str = "",
    meta: dict | None = None,
) -> dict:
    raw = _decode_preview_b64(preview_b64) if preview_b64 else None
    if not raw and image_url:
        raw = _read_image_bytes_from_url(image_url)
        if not raw:
            # try relative under gallery root
            try:
                rel = str(image_url or "").lstrip("/").replace("\\", "/")
                if ".." not in rel:
                    path = GALLERY / rel
                    if path.is_file():
                        raw = path.read_bytes()
            except OSError:
                raw = None
    if not raw:
        raise ValueError("No image data to save (need image_base64 or a local image_url).")
    if len(raw) > _GAME_BOSS_MAX_BYTES:
        raise ValueError(f"Boss image too large ({len(raw) // 1024} KB).")

    GAME_BOSSES_DIR.mkdir(parents=True, exist_ok=True)
    num = next_game_boss_index()
    ext = ".jpg" if raw[:3] == b"\xff\xd8\xff" else ".png"
    if raw[:8] == b"\x89PNG\r\n\x1a\n":
        ext = ".png"
    name = f"{num}{ext}"
    dest = GAME_BOSSES_DIR / name
    dest.write_bytes(raw)

    record = {
        "num": num,
        "name": name,
        "url": f"/saved-game-bosses/{name}",
        "source_paintings": list(source_paintings or [])[:12],
        "description": str(description or "")[:4000],
        "saved_at": time.time(),
    }
    if meta and isinstance(meta, dict):
        record["meta"] = meta
    try:
        (GAME_BOSSES_DIR / f"{num}.json").write_text(
            json.dumps(record, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    except OSError:
        pass
    return {"ok": True, **record, "path": f"saved-game-bosses/{name}", "dir": "saved-game-bosses"}


def _respond_save_game_boss(self):
    try:
        body = self._read_json() or {}
    except Exception:
        return self._json({"ok": False, "error": "Invalid JSON body."}, 400)
    try:
        result = save_game_boss_image(
            preview_b64=body.get("image_base64") or body.get("preview_png") or body.get("preview_b64"),
            image_url=body.get("image_url") or body.get("url"),
            source_paintings=body.get("source_paintings") or body.get("spells") or [],
            description=str(body.get("description") or body.get("stasis") or ""),
            meta=body.get("meta") if isinstance(body.get("meta"), dict) else None,
        )
        return self._json(result, 200)
    except ValueError as e:
        return self._json({"ok": False, "error": str(e)}, 400)
    except OSError as e:
        return self._json({"ok": False, "error": f"Could not save boss image: {e}"}, 500)


def _respond_list_game_bosses(self):
    items = []
    if GAME_BOSSES_DIR.is_dir():
        for entry in sorted(GAME_BOSSES_DIR.iterdir(), key=lambda p: p.name):
            if not entry.is_file():
                continue
            if entry.suffix.lower() not in (".jpg", ".jpeg", ".png", ".webp"):
                continue
            if not entry.stem.isdigit():
                continue
            n = int(entry.stem)
            meta_path = GAME_BOSSES_DIR / f"{n}.json"
            row = {
                "num": n,
                "name": entry.name,
                "url": f"/saved-game-bosses/{entry.name}",
            }
            if meta_path.is_file():
                try:
                    data = json.loads(meta_path.read_text(encoding="utf-8"))
                    if isinstance(data, dict):
                        row.update({k: data[k] for k in ("description", "source_paintings", "saved_at") if k in data})
                except (json.JSONDecodeError, OSError):
                    pass
            items.append(row)
    items.sort(key=lambda r: r.get("num") or 0, reverse=True)
    return self._json({"ok": True, "items": items, "count": len(items), "dir": "saved-game-bosses"})


_orig_app_handler_do_post_game_boss = AppHandler.do_POST


def _app_handler_do_post_with_game_boss(self):
    parsed = urlparse(self.path)
    if parsed.path in ("/api/save-game-boss", "/api/save-game-boss/"):
        return _respond_save_game_boss(self)
    return _orig_app_handler_do_post_game_boss(self)


AppHandler.do_POST = _app_handler_do_post_with_game_boss

_orig_app_handler_do_get_game_boss = AppHandler.do_GET


def _app_handler_do_get_with_game_boss(self):
    parsed = urlparse(self.path)
    if parsed.path in ("/api/game-bosses", "/api/game-bosses/"):
        return _respond_list_game_bosses(self)
    return _orig_app_handler_do_get_game_boss(self)


AppHandler.do_GET = _app_handler_do_get_with_game_boss

try:
    GAME_BOSSES_DIR.mkdir(parents=True, exist_ok=True)
except Exception:
    pass


# Prefer improved analyze.get_api_key (API key first, OAuth refresh) over any
# bytecode copy so Conceptualizer works on other machines with XAI_API_KEY.
try:
    from analyze import get_api_key as _gallery_get_api_key  # noqa: PLC0415
    from analyze import friendly_xai_auth_error as _gallery_friendly_xai_auth_error  # noqa: PLC0415

    globals()["get_api_key"] = _gallery_get_api_key
    globals()["friendly_xai_auth_error"] = _gallery_friendly_xai_auth_error
except Exception:
    pass


# --- xAI prepaid credits + weekly usage (Management API) ---
# Docs: https://docs.x.ai/developers/rest-api-reference/management/billing
# Needs a Management Key from https://console.x.ai/team/default/management-keys
# Env: XAI_MANAGEMENT_KEY (or XAI_MGMT_KEY), optional XAI_TEAM_ID
_XAI_MGMT_BASE = "https://management-api.x.ai"
_XAI_USAGE_CACHE: dict = {"ts": 0.0, "payload": None}
_XAI_USAGE_TTL_SEC = 45.0
_GROK_AUTH_PATH = Path.home() / ".grok" / "auth.json"


def _usd_cents_to_dollars(val) -> float | None:
    """xAI stores money as USD cents (string/int). Prepaid total is often negative = credit."""
    if val is None:
        return None
    if isinstance(val, dict):
        val = val.get("val")
    try:
        cents = int(str(val).strip())
    except (TypeError, ValueError):
        return None
    # Accounting: purchases negative, spend positive → remaining credit ≈ max(0, -total)
    if cents < 0:
        cents = -cents
    return cents / 100.0


def _load_xai_team_id() -> str:
    tid = (
        str(os.environ.get("XAI_TEAM_ID") or os.environ.get("XAI_TEAM") or "").strip()
    )
    if tid:
        return tid
    try:
        if _GROK_AUTH_PATH.is_file():
            data = json.loads(_GROK_AUTH_PATH.read_text(encoding="utf-8"))
            for entry in (data or {}).values():
                if isinstance(entry, dict) and entry.get("team_id"):
                    return str(entry["team_id"]).strip()
    except (OSError, json.JSONDecodeError, TypeError):
        pass
    return ""


def _load_xai_management_key() -> str:
    key = (
        str(
            os.environ.get("XAI_MANAGEMENT_KEY")
            or os.environ.get("XAI_MGMT_KEY")
            or os.environ.get("XAI_MANAGEMENT_API_KEY")
            or ""
        ).strip()
    )
    if key:
        return key
    # Optional file next to gallery (never commit secrets)
    for path in (
        GALLERY / "data" / "xai-management-key.txt",
        GALLERY / ".xai-management-key",
        Path.home() / ".grok" / "management-key.txt",
    ):
        try:
            if path.is_file():
                text = path.read_text(encoding="utf-8").strip()
                if text and not text.startswith("#"):
                    return text.splitlines()[0].strip()
        except OSError:
            pass
    return ""


def _week_bounds_local() -> tuple[str, str, str]:
    """Return (startTime, endTime, timezone) for current calendar week Mon–Sun local."""
    import datetime as _dt

    now = _dt.datetime.now().astimezone()
    # Monday as start of week
    start = (now - _dt.timedelta(days=now.weekday())).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    end = start + _dt.timedelta(days=7)
    tz_name = str(now.tzinfo) if now.tzinfo else "UTC"
    # Prefer IANA if available
    try:
        import time as _time

        tz_name = _time.tzname[0] or tz_name
    except Exception:
        pass
    # Use Etc/GMT offset fallback when not IANA — management API wants IANA
    try:
        # zoneinfo (3.9+)
        from zoneinfo import ZoneInfo  # type: ignore

        # keep system local via offset name if needed
        _ = ZoneInfo  # silence
    except Exception:
        pass
    # Safest portable default for API validation
    tz_iana = "UTC"
    try:
        # Windows often has local zone name; try to use offset as Etc/GMT
        offset = now.utcoffset()
        if offset is not None:
            hours = int(offset.total_seconds() // 3600)
            # Etc/GMT signs are inverted (Etc/GMT+5 = UTC-5)
            if hours == 0:
                tz_iana = "UTC"
            else:
                sign = "-" if hours > 0 else "+"
                tz_iana = f"Etc/GMT{sign}{abs(hours)}"
    except Exception:
        tz_iana = "UTC"

    fmt = "%Y-%m-%d %H:%M:%S"
    return start.strftime(fmt), end.strftime(fmt), tz_iana


def _fetch_xai_prepaid_balance(client: httpx.Client, headers: dict, team_id: str) -> dict:
    url = f"{_XAI_MGMT_BASE}/v1/billing/teams/{team_id}/prepaid/balance"
    r = client.get(url, headers=headers, timeout=20.0)
    if r.status_code >= 400:
        raise ValueError(f"prepaid/balance HTTP {r.status_code}: {r.text[:240]}")
    return r.json() if r.content else {}


def _fetch_xai_spending_limits(client: httpx.Client, headers: dict, team_id: str) -> dict:
    url = f"{_XAI_MGMT_BASE}/v1/billing/teams/{team_id}/postpaid/spending-limits"
    r = client.get(url, headers=headers, timeout=20.0)
    if r.status_code >= 400:
        return {}
    return r.json() if r.content else {}


def _fetch_xai_spend_usd(
    client: httpx.Client,
    headers: dict,
    team_id: str,
    start: str,
    end: str,
    tz: str,
) -> float | None:
    url = f"{_XAI_MGMT_BASE}/v1/billing/teams/{team_id}/usage"
    body = {
        "analyticsRequest": {
            "timeRange": {
                "startTime": start,
                "endTime": end,
                "timezone": tz,
            },
            "timeUnit": "TIME_UNIT_NONE",
            "values": [{"name": "usd", "aggregation": "AGGREGATION_SUM"}],
            "groupBy": [],
            "filters": [],
        }
    }
    r = client.post(url, headers=headers, json=body, timeout=25.0)
    if r.status_code >= 400:
        body["analyticsRequest"]["timeRange"]["timezone"] = "UTC"
        r = client.post(url, headers=headers, json=body, timeout=25.0)
        if r.status_code >= 400:
            return None
    data = r.json() if r.content else {}
    total = 0.0
    found = False
    for series in data.get("timeSeries") or []:
        for pt in series.get("dataPoints") or []:
            vals = pt.get("values") or []
            if vals:
                try:
                    total += float(vals[0])
                    found = True
                except (TypeError, ValueError):
                    pass
    return total if found else 0.0


def _fetch_xai_week_spend_usd(client: httpx.Client, headers: dict, team_id: str) -> float | None:
    start, end, tz = _week_bounds_local()
    return _fetch_xai_spend_usd(client, headers, team_id, start, end, tz)


def fetch_xai_usage_snapshot() -> dict:
    """Credits left + weekly spend/remaining for the HUD."""
    now = time.time()
    cached = _XAI_USAGE_CACHE.get("payload")
    if cached and (now - float(_XAI_USAGE_CACHE.get("ts") or 0)) < _XAI_USAGE_TTL_SEC:
        out = dict(cached)
        out["cached"] = True
        return out

    mgmt_key = _load_xai_management_key()
    team_id = _load_xai_team_id()
    if not mgmt_key:
        payload = {
            "ok": False,
            "error": "missing_management_key",
            "message": (
                "Set XAI_MANAGEMENT_KEY (Management Key from console.x.ai → Management Keys) "
                "or put the key in data/xai-management-key.txt, then restart the server."
            ),
            "credits_usd": None,
            "week_spent_usd": None,
            "week_remaining_usd": None,
            "week_limit_usd": None,
            "console_url": "https://console.x.ai/team/default/billing",
            "mgmt_keys_url": "https://console.x.ai/team/default/management-keys",
        }
        _XAI_USAGE_CACHE["ts"] = now
        _XAI_USAGE_CACHE["payload"] = payload
        return payload

    if not team_id:
        payload = {
            "ok": False,
            "error": "missing_team_id",
            "message": (
                "Set XAI_TEAM_ID to your team UUID (console.x.ai → Team settings), "
                "or sign in with grok so ~/.grok/auth.json has team_id."
            ),
            "credits_usd": None,
            "week_spent_usd": None,
            "week_remaining_usd": None,
            "week_limit_usd": None,
            "console_url": "https://console.x.ai/team/default/billing",
        }
        _XAI_USAGE_CACHE["ts"] = now
        _XAI_USAGE_CACHE["payload"] = payload
        return payload

    headers = {
        "Authorization": f"Bearer {mgmt_key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    try:
        with httpx.Client() as client:
            bal = _fetch_xai_prepaid_balance(client, headers, team_id)
            credits = _usd_cents_to_dollars((bal or {}).get("total"))
            limits = _fetch_xai_spending_limits(client, headers, team_id)
            soft = None
            try:
                sl = ((limits or {}).get("spendingLimits") or {}).get("effectiveSl") or (
                    (limits or {}).get("spendingLimits") or {}
                ).get("softSl")
                soft = _usd_cents_to_dollars(sl)
            except Exception:
                soft = None
            week_spent = _fetch_xai_week_spend_usd(client, headers, team_id)
            # Soft limit is monthly; treat a weekly share (~1/4.345 of month) as the weekly budget
            week_limit = None
            week_remaining = None
            if soft is not None and soft > 0:
                week_limit = float(soft) / 4.345
                if week_spent is not None:
                    week_remaining = max(0.0, week_limit - float(week_spent))
            elif credits is not None:
                # Prepaid-only: weekly “left” tracks remaining credits
                week_limit = credits
                week_remaining = credits
                if week_spent is not None and credits is not None:
                    # still show credits as remaining; week spent is informational
                    week_remaining = credits

            payload = {
                "ok": True,
                "credits_usd": credits,
                "week_spent_usd": week_spent,
                "week_remaining_usd": week_remaining,
                "week_limit_usd": week_limit,
                "month_soft_limit_usd": soft,
                "team_id": team_id,
                "console_url": "https://console.x.ai/team/default/billing",
                "fetched_at": now,
            }
    except Exception as e:
        msg = str(e)
        if "oauth2" in msg.lower() or "403" in msg:
            msg = (
                "Management API rejected the key (need a Management Key, not an OAuth/API key). "
                "Create one at console.x.ai → Management Keys. " + msg
            )
        payload = {
            "ok": False,
            "error": "fetch_failed",
            "message": msg[:500],
            "credits_usd": None,
            "week_spent_usd": None,
            "week_remaining_usd": None,
            "week_limit_usd": None,
            "console_url": "https://console.x.ai/team/default/billing",
            "mgmt_keys_url": "https://console.x.ai/team/default/management-keys",
        }

    _XAI_USAGE_CACHE["ts"] = now
    _XAI_USAGE_CACHE["payload"] = payload
    return payload


def _respond_xai_usage(self):
    try:
        force = False
        try:
            qs = parse_qs(urlparse(self.path).query or "")
            force = str((qs.get("refresh") or qs.get("force") or [""])[0]).lower() in (
                "1",
                "true",
                "yes",
            )
        except Exception:
            force = False
        if force:
            _XAI_USAGE_CACHE["ts"] = 0.0
            _XAI_USAGE_CACHE["payload"] = None
        data = fetch_xai_usage_snapshot()
        return self._json(data, 200 if data.get("ok") else 200)
    except Exception as e:
        return self._json({"ok": False, "error": "server_error", "message": str(e)[:300]}, 500)


def _respond_xai_auth_status(self):
    """Diagnose which credential the gallery server will use (no secret values)."""
    from analyze import (  # noqa: PLC0415
        AUTH_PATH,
        GALLERY,
        _looks_like_api_key,
        _looks_like_oauth_jwt,
        get_api_key,
        friendly_xai_auth_error,
    )

    info: dict = {
        "ok": False,
        "source": None,
        "kind": None,
        "hint": None,
        "auth_path": str(AUTH_PATH),
        "portable_key_path": str(GALLERY / "data" / "xai-api-key.txt"),
        "console_keys_url": "https://console.x.ai/team/default/api-keys",
    }
    try:
        if (os.environ.get("XAI_API_KEY") or "").strip():
            info["source"] = "env:XAI_API_KEY"
        key = get_api_key()
        if _looks_like_api_key(key):
            info["ok"] = True
            info["kind"] = "api_key"
            info["source"] = info["source"] or "api_key"
            info["hint"] = "Using a console API key — good for any computer."
        elif _looks_like_oauth_jwt(key):
            info["ok"] = True
            info["kind"] = "oauth_jwt"
            info["source"] = info["source"] or "grok_auth_json"
            info["hint"] = (
                "Using Grok CLI OAuth login. On another computer this often fails with "
                "\"OAuth2 access token could not be validated\". Prefer XAI_API_KEY=xai-… "
                "or gallery/data/xai-api-key.txt from console.x.ai."
            )
        else:
            info["ok"] = True
            info["kind"] = "unknown"
            info["source"] = info["source"] or "unknown"
            info["hint"] = "Credential loaded; if generates fail, set a console API key."
    except Exception as e:
        info["ok"] = False
        info["error"] = friendly_xai_auth_error(e)
        info["hint"] = info["error"]
    return self._json(info, 200)


_orig_app_handler_do_get_xai_usage = AppHandler.do_GET


def _app_handler_do_get_with_xai_usage(self):
    parsed = urlparse(self.path)
    if parsed.path in ("/api/xai-usage", "/api/xai-usage/", "/api/credits", "/api/credits/"):
        return _respond_xai_usage(self)
    if parsed.path in ("/api/xai-auth-status", "/api/xai-auth-status/"):
        return _respond_xai_auth_status(self)
    return _orig_app_handler_do_get_xai_usage(self)


AppHandler.do_GET = _app_handler_do_get_with_xai_usage


# --- Commercial brands: catalog + logo lookup (partnership / brand pieces) ---
COMMERCIAL_BRANDS_PATH = GALLERY / "data" / "commercial-brands.json"
COMMERCIAL_CUSTOM_PATH = GALLERY / "data" / "commercial-brands-custom.json"
COMMERCIAL_LOGO_CACHE = GALLERY / "data" / "commercial-logo-cache"
CATEGORIES_DEFAULT = (
    "fast-food",
    "restaurants",
    "automobiles",
    "gas-stations",
    "apparel",
    "jewelers",
    "banks",
    "online-banks",
    "online-shopping",
    "real-estate",
    "gym",
    "coffee",
    "retail",
    "hotel",
    "services",
    "tech",
    "beverages",
    "snacks",
    "airlines",
    "telecom",
    "beauty",
    "insurance",
    "cpg-food",
    "shipping",
    "sports",
    "toys",
    "media",
    "grocery",
    "payments",
    "custom",
)


def _slug_brand(name: str) -> str:
    text = re.sub(r"[^a-zA-Z0-9]+", "-", str(name or "").strip().lower()).strip("-")
    return (text[:64] or "brand")


def _load_commercial_brands() -> list:
    brands = []
    seen = set()
    for path in (COMMERCIAL_BRANDS_PATH, COMMERCIAL_CUSTOM_PATH):
        if not path.is_file():
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        rows = data.get("brands") if isinstance(data, dict) else data
        if not isinstance(rows, list):
            continue
        for row in rows:
            if not isinstance(row, dict):
                continue
            name = str(row.get("name") or "").strip()
            if not name:
                continue
            bid = str(row.get("id") or _slug_brand(name)).strip() or _slug_brand(name)
            if bid in seen:
                continue
            seen.add(bid)
            domain = str(row.get("domain") or "").strip().lower()
            domain = re.sub(r"^https?://", "", domain).split("/")[0]
            cat = str(row.get("category") or "custom").strip().lower() or "custom"
            products = row.get("products") if isinstance(row.get("products"), list) else []
            products = [str(p).strip() for p in products if str(p).strip()][:12]
            brands.append(
                {
                    "id": bid,
                    "name": name,
                    "domain": domain,
                    "category": cat,
                    "products": products,
                    "custom": path == COMMERCIAL_CUSTOM_PATH,
                    "logo_url": f"/api/commercial-logo?domain={domain}" if domain else f"/api/commercial-logo?name={bid}",
                }
            )
    brands.sort(
        key=lambda b: (
            str(b.get("category") or "").lower(),
            str(b.get("name") or "").lower(),
        )
    )
    return brands


def _save_custom_brand(body: dict) -> dict:
    name = str(body.get("name") or "").strip()
    if not name:
        raise ValueError("Business name is required.")
    domain = str(body.get("domain") or "").strip().lower()
    domain = re.sub(r"^https?://", "", domain).split("/")[0]
    category = str(body.get("category") or "custom").strip().lower() or "custom"
    if category not in CATEGORIES_DEFAULT:
        category = "custom"
    bid = str(body.get("id") or _slug_brand(name)).strip() or _slug_brand(name)

    # Resolve domain from name if missing
    if not domain:
        domain = _guess_domain_from_name(name) or ""

    custom = {"brands": []}
    if COMMERCIAL_CUSTOM_PATH.is_file():
        try:
            custom = json.loads(COMMERCIAL_CUSTOM_PATH.read_text(encoding="utf-8"))
            if not isinstance(custom, dict):
                custom = {"brands": []}
        except (OSError, json.JSONDecodeError):
            custom = {"brands": []}
    brands = custom.get("brands") if isinstance(custom.get("brands"), list) else []
    # replace same id
    brands = [b for b in brands if isinstance(b, dict) and str(b.get("id")) != bid]
    products_raw = body.get("products")
    products = []
    if isinstance(products_raw, list):
        products = [str(p).strip() for p in products_raw if str(p).strip()][:12]
    elif isinstance(products_raw, str) and products_raw.strip():
        products = [p.strip() for p in products_raw.split(",") if p.strip()][:12]
    row = {"id": bid, "name": name, "domain": domain, "category": category, "products": products}
    brands.append(row)
    custom = {"version": 1, "brands": brands}
    COMMERCIAL_CUSTOM_PATH.parent.mkdir(parents=True, exist_ok=True)
    COMMERCIAL_CUSTOM_PATH.write_text(
        json.dumps(custom, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return {
        "id": bid,
        "name": name,
        "domain": domain,
        "category": category,
        "products": products,
        "custom": True,
        "logo_url": f"/api/commercial-logo?domain={domain}" if domain else f"/api/commercial-logo?name={bid}",
    }


def _guess_domain_from_name(name: str) -> str:
    """Best-effort domain from known list or Clearbit-style suggest (no key)."""
    clean = re.sub(r"[^a-zA-Z0-9]+", "", str(name or "").lower())
    for b in _load_commercial_brands():
        n = re.sub(r"[^a-zA-Z0-9]+", "", str(b.get("name") or "").lower())
        if n == clean and b.get("domain"):
            return str(b["domain"])
    # Clearbit company suggest (public autocomplete; may fail)
    try:
        q = str(name or "").strip()
        if not q:
            return ""
        with httpx.Client(timeout=8.0, follow_redirects=True) as client:
            r = client.get(
                "https://autocomplete.clearbit.com/v1/companies/suggest",
                params={"query": q},
                headers={"User-Agent": "1000-paintings-gallery/1.0"},
            )
            if r.status_code < 400:
                rows = r.json()
                if isinstance(rows, list) and rows:
                    dom = str(rows[0].get("domain") or "").strip().lower()
                    if dom:
                        return dom
    except Exception:
        pass
    # Naive guess
    slug = re.sub(r"[^a-z0-9]+", "", str(name or "").lower())
    if len(slug) >= 3:
        return f"{slug}.com"
    return ""


def _fetch_logo_bytes(domain: str = "", name: str = "") -> tuple[bytes, str]:
    domain = re.sub(r"^https?://", "", str(domain or "").strip().lower()).split("/")[0]
    name = str(name or "").strip()
    if not domain and name:
        domain = _guess_domain_from_name(name)
    if not domain:
        raise ValueError("Need a domain or recognizable business name for logo lookup.")

    COMMERCIAL_LOGO_CACHE.mkdir(parents=True, exist_ok=True)
    cache_key = re.sub(r"[^a-z0-9.-]+", "-", domain)[:80]
    for ext, mime in ((".png", "image/png"), (".jpg", "image/jpeg"), (".ico", "image/x-icon"), (".webp", "image/webp")):
        cached = COMMERCIAL_LOGO_CACHE / f"{cache_key}{ext}"
        if cached.is_file() and cached.stat().st_size > 32:
            return cached.read_bytes(), mime

    candidates = [
        f"https://logo.clearbit.com/{domain}",
        f"https://www.google.com/s2/favicons?domain={domain}&sz=256",
        f"https://icons.duckduckgo.com/ip3/{domain}.ico",
    ]
    headers = {"User-Agent": "1000-paintings-gallery/1.0"}
    last_err = None
    with httpx.Client(timeout=12.0, follow_redirects=True) as client:
        for url in candidates:
            try:
                r = client.get(url, headers=headers)
                if r.status_code >= 400 or not r.content or len(r.content) < 40:
                    continue
                ctype = (r.headers.get("content-type") or "image/png").split(";")[0].strip()
                if "svg" in ctype:
                    continue
                data = r.content
                # pick extension
                ext = ".png"
                if "jpeg" in ctype or "jpg" in ctype:
                    ext = ".jpg"
                elif "webp" in ctype:
                    ext = ".webp"
                elif "icon" in ctype:
                    ext = ".ico"
                dest = COMMERCIAL_LOGO_CACHE / f"{cache_key}{ext}"
                try:
                    dest.write_bytes(data)
                except OSError:
                    pass
                return data, ctype if ctype.startswith("image/") else "image/png"
            except Exception as exc:
                last_err = exc
                continue
    raise ValueError(
        f"Could not fetch logo for {domain}."
        + (f" ({last_err})" if last_err else "")
    )


def _respond_commercial_brands_list(self):
    brands = _load_commercial_brands()
    cats = sorted({b.get("category") or "custom" for b in brands})
    return self._json(
        {
            "ok": True,
            "brands": brands,
            "count": len(brands),
            "categories": cats,
        }
    )


def _respond_commercial_logo(self):
    qs = parse_qs(urlparse(self.path).query or "")
    domain = (qs.get("domain") or [""])[0]
    name = (qs.get("name") or [""])[0]
    try:
        data, ctype = _fetch_logo_bytes(domain=domain, name=name)
    except Exception as exc:
        return self._json({"ok": False, "error": str(exc)[:300]}, 404)
    try:
        self.send_response(200)
        self.send_header("Content-Type", ctype or "image/png")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "public, max-age=86400")
        self.end_headers()
        self.wfile.write(data)
    except Exception:
        pass
    return True


def _respond_commercial_search(self):
    qs = parse_qs(urlparse(self.path).query or "")
    q = str((qs.get("q") or qs.get("name") or [""])[0]).strip()
    if not q:
        return self._json({"ok": False, "error": "Missing q"}, 400)
    results = []
    # Local catalog hits first
    ql = q.lower()
    for b in _load_commercial_brands():
        if ql in str(b.get("name") or "").lower() or ql in str(b.get("domain") or "").lower():
            results.append(b)
    # Clearbit suggest for new names
    try:
        with httpx.Client(timeout=8.0, follow_redirects=True) as client:
            r = client.get(
                "https://autocomplete.clearbit.com/v1/companies/suggest",
                params={"query": q},
                headers={"User-Agent": "1000-paintings-gallery/1.0"},
            )
            if r.status_code < 400:
                for row in r.json() or []:
                    if not isinstance(row, dict):
                        continue
                    name = str(row.get("name") or "").strip()
                    domain = str(row.get("domain") or "").strip().lower()
                    if not name or not domain:
                        continue
                    bid = _slug_brand(name)
                    if any(x.get("domain") == domain for x in results):
                        continue
                    results.append(
                        {
                            "id": bid,
                            "name": name,
                            "domain": domain,
                            "category": "custom",
                            "custom": False,
                            "suggested": True,
                            "logo_url": f"/api/commercial-logo?domain={domain}",
                        }
                    )
    except Exception:
        pass
    return self._json({"ok": True, "query": q, "results": results[:20]})


# Ensure folder exists on boot
try:
    SAVED_VIDEOS_DIR.mkdir(parents=True, exist_ok=True)
    if not (GALLERY / "data" / "saved-videos-manifest.json").is_file():
        _write_saved_videos_manifest()
except Exception:
    pass


# Allow in-page speaker/output selection (Chrome/Edge enumerate audiooutput + setSinkId).
_orig_app_handler_end_headers = AppHandler.end_headers


def _app_handler_end_headers_with_speaker_policy(self):
    self.send_header("Permissions-Policy", "speaker-selection=(self)")
    return _orig_app_handler_end_headers(self)


AppHandler.end_headers = _app_handler_end_headers_with_speaker_policy


# --- Animate-cast: still fidelity (image-to-life) + optional wait (no client poll) ---
#
# The recovered bytecode path builds cast_body WITHOUT reference_image and falls into
# "whisper" (text-only) when there is no cast/spells — so Conceptualizer/Viral stills
# were ignored and video looked like a different painting. We inject the still and
# run a summon-style image+prompt video job instead.

_orig_post_animate_cast = AppHandler._post_animate_cast
_orig_run_cast_job = run_cast_job
_TERMINAL_JOB_OK = frozenset({"done", "completed", "success", "succeeded"})
_TERMINAL_JOB_BAD = frozenset({"failed", "error", "expired"})


def _job_public_payload(job_id: str, job: dict | None) -> dict:
    """Shape a job dict like GET /api/jobs/{id} for a synchronous animate response."""
    job = job or {}
    created = job.get("created_at")
    elapsed_sec = None
    if created is not None:
        try:
            elapsed_sec = max(0, int(time.time() - float(created)))
        except (TypeError, ValueError):
            elapsed_sec = None
    return {
        "id": job_id,
        "job_id": job_id,
        "status": job.get("status"),
        "xai_status": job.get("xai_status"),
        "video": job.get("video"),
        "images": job.get("images"),
        "image": job.get("image"),
        "mode": job.get("mode"),
        "type": job.get("type"),
        "spells": job.get("spells"),
        "duration": job.get("duration"),
        "resolution": job.get("resolution"),
        "elapsed_sec": elapsed_sec,
        "error": job.get("error"),
    }


def _await_job_terminal(job_id: str) -> dict:
    """Block until the in-memory job reaches a terminal status (or timeout)."""
    max_sec = float(globals().get("VIDEO_JOB_POLL_MAX_SEC", 600) or 600)
    interval = float(globals().get("VIDEO_JOB_POLL_INTERVAL_SEC", 1.0) or 1.0)
    interval = max(0.35, min(interval, 1.5))
    deadline = time.time() + max_sec + 30.0
    last = {}
    while time.time() < deadline:
        with _jobs_lock:
            raw = _jobs.get(job_id)
            last = dict(raw) if raw else {}
        st = str(last.get("status") or "").lower()
        if st in _TERMINAL_JOB_OK or st in _TERMINAL_JOB_BAD:
            return last
        time.sleep(interval)
    return last


def _parse_data_url_image(data_url: str) -> tuple[bytes, str, str]:
    """Return (bytes, mime, filename) from a data:image/...;base64,... URL."""
    text = str(data_url or "").strip()
    if not text.startswith("data:") or ";base64," not in text:
        raise ValueError("Still reference must be a base64 data URL.")
    header, b64 = text.split(";base64,", 1)
    mime = header[5:] if header.startswith("data:") else "image/jpeg"
    if not mime.startswith("image/"):
        mime = "image/jpeg"
    raw = base64.b64decode(b64, validate=False)
    if not raw:
        raise ValueError("Empty still reference image.")
    ext = "png" if "png" in mime else "jpg"
    return raw, mime, f"still-ref.{ext}"


def _upload_data_url_as_xai_file(client, api_key: str, data_url: str) -> str:
    """Upload a data-URL still to xAI Files API; return file_id for video image-to-life."""
    import io

    raw, mime, filename = _parse_data_url_image(data_url)
    headers = {"Authorization": f"Bearer {api_key}"}
    files = {"file": (filename, io.BytesIO(raw), mime)}
    resp = api_request(client, "POST", API_FILES, headers=headers, files=files)
    if getattr(resp, "status_code", 500) >= 400:
        raise ValueError(api_error_message(resp) or "Still upload failed.")
    data = resp.json() if hasattr(resp, "json") else {}
    file_id = (data or {}).get("id") or (data or {}).get("file_id")
    if not file_id:
        raise ValueError("Still upload returned no file id.")
    return str(file_id)


def _execute_still_to_video_job(job_id: str, body: dict, ref: str) -> None:
    """
    Image-to-life: animate the attached still (same painting) via video API
    summon-style payload: prompt + image.file_id.
    """
    api_key = get_api_key()
    client = make_api_client()
    try:
        _update_job_fields(job_id, status="pending", xai_status="uploading still")
        data_url = str(ref or "").strip()
        if not data_url.startswith("data:image"):
            # Gallery-relative / http URL → inline data URL for upload
            data_url = resolve_reference_image_for_api(data_url, client)
        file_id = _upload_data_url_as_xai_file(client, api_key, data_url)

        # Prefer dense image-to-life prompt (includes original generation prompt from client)
        prompt = str(
            body.get("image_to_life_prompt")
            or body.get("prompt")
            or ""
        ).strip()
        gen_prompt = str(body.get("generation_prompt") or "").strip()
        gen_visual = str(body.get("generation_visual") or "").strip()
        if gen_prompt or gen_visual:
            lock_bits = [
                "SAME-ESQUE LOCK — this still was generated from the following; do not stray:",
            ]
            if gen_prompt:
                lock_bits.append("Generation prompt: " + gen_prompt[:900])
            if gen_visual:
                lock_bits.append("Visual grounding: " + gen_visual[:1200])
            lock_bits.append(
                "Animate the attached still only; preserve subjects, composition, palette, and that intent."
            )
            lock_block = "\n".join(lock_bits)
            if prompt:
                # Generation lock first so the model sees intent before motion notes
                if lock_block not in prompt:
                    prompt = lock_block + "\n\n" + prompt
            else:
                prompt = lock_block
        if not prompt:
            prompt = (
                "IMAGE-TO-LIFE: Animate this exact still. Preserve composition, subjects, "
                "palette, and brushwork. Fixed camera. Seamless loop; start equals end."
            )
        # Soft cap — keep under 8000 so image/video models don't reject oversize prompts
        _lim = int(globals().get("GEN_PROMPT_MAX_CHARS") or 8000)
        if len(prompt) > _lim:
            _cap_fn = globals().get("_cap_prompt_chars")
            if callable(_cap_fn):
                prompt = _cap_fn(prompt, _lim)
            else:
                prompt = prompt[: max(0, _lim - 1)].rstrip() + "…"
        try:
            duration = int(body.get("duration") or 10)
        except (TypeError, ValueError):
            duration = 10
        if duration not in (6, 10, 15):
            duration = 10
        aspect = str(body.get("aspect_ratio") or "16:9")
        resolution = str(body.get("resolution") or "720p")
        if resolution not in ("480p", "720p"):
            resolution = "720p"
        model = str(
            body.get("model")
            or globals().get("DEFAULT_MODEL")
            or "grok-imagine-video"
        )

        # Match build_payload summon shape: generations with image.file_id
        payload = {
            "model": model,
            "prompt": prompt,
            "image": {"file_id": file_id},
            "duration": duration,
            "aspect_ratio": aspect,
            "resolution": resolution,
        }

        _update_job_fields(
            job_id,
            status="pending",
            xai_status="connecting",
            mode="image_to_life",
            resolution=resolution,
            duration=duration,
        )
        request_id = start_xai_job(client, api_key, payload, False, job_id)
        _update_job_fields(job_id, request_id=request_id, xai_status="pending")

        max_sec = float(globals().get("VIDEO_JOB_POLL_MAX_SEC", 600) or 600)
        interval = float(globals().get("VIDEO_JOB_POLL_INTERVAL_SEC", 2.0) or 2.0)
        deadline = time.time() + max_sec
        while time.time() < deadline:
            data = poll_xai_job(client, api_key, request_id) or {}
            status = str(data.get("status") or "").lower()
            _update_job_fields(job_id, xai_status=status or data.get("xai_status"))
            if status == "done":
                video = auto_save_generated_video(data.get("video"))
                _update_job_fields(
                    job_id, status="done", video=video, xai_status="done"
                )
                return
            if status in ("failed", "expired", "error"):
                err = (
                    data.get("error")
                    or data.get("message")
                    or "Video generation failed."
                )
                if isinstance(err, dict):
                    err = err.get("message") or err.get("error") or str(err)
                _update_job_fields(
                    job_id,
                    status="failed",
                    error={"message": str(err)},
                    xai_status=status,
                )
                return
            time.sleep(max(0.8, interval))

        _update_job_fields(
            job_id,
            status="failed",
            error={
                "message": "Video generation timed out after 10 minutes waiting on xAI."
            },
            xai_status="timeout",
        )
    except Exception as exc:
        msg = str(exc)
        try:
            msg = friendly_network_error(exc) or msg
        except Exception:
            pass
        _update_job_fields(
            job_id,
            status="failed",
            error={"message": msg},
            xai_status="failed",
        )
    finally:
        try:
            client.close()
        except Exception:
            pass


def _run_cast_job_prefer_still(job_id, body):
    """If cast_body carries reference_image, animate that still; else default cast."""
    body = dict(body or {})
    ref = str(body.get("reference_image") or "").strip()
    if not ref:
        ref = str(body.get("image_url") or "").strip()
    if ref:
        _execute_still_to_video_job(job_id, body, ref)
        return
    return _orig_run_cast_job(job_id, body)


def _post_animate_cast_with_still_and_wait(self):
    """
    - Always forward reference_image into the job (image-to-life).
    - If body.wait / wait_for_result: hold HTTP until the job finishes.
    """
    orig_read = self._read_json
    try:
        body = orig_read()
    except Exception:
        self._read_json = orig_read
        return _orig_post_animate_cast(self)

    if not isinstance(body, dict):
        body = {}

    wait = bool(body.get("wait") or body.get("wait_for_result"))
    still_ref = str(body.get("reference_image") or "").strip()
    if not still_ref:
        still_ref = str(body.get("image_url") or "").strip()
    self._read_json = lambda: body

    real_thread = threading.Thread
    orig_json = self._json

    def _thread_factory(*t_args, **t_kwargs):
        # Restore immediately so concurrent requests keep a real Thread class.
        threading.Thread = real_thread  # type: ignore[misc]
        target = t_kwargs.get("target")
        args = t_kwargs.get("args") or ()
        tname = getattr(target, "__name__", "") if target is not None else ""
        if target is run_cast_job or target is _orig_run_cast_job or tname == "run_cast_job":
            job_id = args[0] if args else None
            cast_body = dict(args[1] if len(args) > 1 else {})
            if still_ref:
                # Prefer client data-URL still; keep URL as fallback for resolve
                if str(body.get("reference_image") or "").startswith("data:"):
                    cast_body["reference_image"] = body.get("reference_image")
                else:
                    cast_body["reference_image"] = still_ref
                if body.get("image_url"):
                    cast_body["image_url"] = body.get("image_url")
                # Dense prompt with original generation intent (client-built)
                life_prompt = str(body.get("image_to_life_prompt") or "").strip()
                if life_prompt:
                    cast_body["prompt"] = life_prompt[:12000]
                    cast_body["image_to_life_prompt"] = life_prompt[:12000]
                if body.get("generation_prompt"):
                    cast_body["generation_prompt"] = str(body.get("generation_prompt"))[:1200]
                if body.get("generation_visual"):
                    cast_body["generation_visual"] = str(body.get("generation_visual"))[:2500]
                # Avoid whisper text-only; image-to-life path uses summon-style API
                cast_body["mode"] = "image_to_life"
            t_kwargs = dict(t_kwargs)
            t_kwargs["target"] = _run_cast_job_prefer_still
            t_kwargs["args"] = (job_id, cast_body)
        return real_thread(*t_args, **t_kwargs)

    def _json_after_wait(data, status=200):
        if (
            wait
            and status == 202
            and isinstance(data, dict)
            and (data.get("job_id") or data.get("id"))
        ):
            job_id = str(data.get("job_id") or data.get("id"))
            job = _await_job_terminal(job_id)
            payload = _job_public_payload(job_id, job)
            st = str(payload.get("status") or "").lower()
            if st in _TERMINAL_JOB_OK:
                return orig_json(payload, 200)
            if st in _TERMINAL_JOB_BAD:
                err = payload.get("error")
                if isinstance(err, dict):
                    msg = err.get("message") or err.get("error") or str(err)
                else:
                    msg = err or "Video generation failed."
                payload = dict(payload)
                payload["error"] = str(msg)
                return orig_json(payload, 500)
            payload = dict(payload)
            payload["error"] = (
                "Video generation timed out waiting on the server. Try 480p / 6s."
            )
            return orig_json(payload, 504)
        return orig_json(data, status)

    try:
        # Always hook Thread so stills are not dropped (even without wait).
        threading.Thread = _thread_factory  # type: ignore[misc, assignment]
        if wait:
            self._json = _json_after_wait
        return _orig_post_animate_cast(self)
    finally:
        threading.Thread = real_thread  # type: ignore[misc]
        self._json = orig_json
        self._read_json = orig_read


AppHandler._post_animate_cast = _post_animate_cast_with_still_and_wait


# --- Street View / Maps property stills (optional GOOGLE_MAPS_API_KEY) ---
STREET_VIEW_CACHE = GALLERY / "data" / "street-view-cache"


def _google_maps_api_key() -> str:
    key = (
        str(os.environ.get("GOOGLE_MAPS_API_KEY") or os.environ.get("GOOGLE_API_KEY") or "").strip()
    )
    if key:
        return key
    for path in (
        GALLERY / "data" / "google-maps-api-key.txt",
        GALLERY / ".google-maps-api-key",
    ):
        try:
            if path.is_file():
                for line in path.read_text(encoding="utf-8").splitlines():
                    line = line.strip()
                    if line and not line.startswith("#"):
                        return line.strip().strip('"').strip("'")
        except OSError:
            pass
    return ""


def _geocode_address(address: str, api_key: str) -> dict:
    with httpx.Client(timeout=15.0, follow_redirects=True) as client:
        r = client.get(
            "https://maps.googleapis.com/maps/api/geocode/json",
            params={"address": address, "key": api_key},
        )
        r.raise_for_status()
        data = r.json()
    status = str(data.get("status") or "")
    if status != "OK" or not data.get("results"):
        raise ValueError(
            f"Geocode failed ({status or 'unknown'}): "
            f"{(data.get('error_message') or 'no results for that address')}"
        )
    top = data["results"][0]
    loc = (top.get("geometry") or {}).get("location") or {}
    return {
        "formatted_address": top.get("formatted_address") or address,
        "lat": loc.get("lat"),
        "lng": loc.get("lng"),
        "place_id": top.get("place_id") or "",
    }


def _fetch_street_view_bytes(
    *,
    address: str = "",
    lat: float | None = None,
    lng: float | None = None,
    heading: float = 0,
    pitch: float = 0,
    fov: float = 90,
    size: str = "1280x720",
) -> tuple[bytes, dict]:
    api_key = _google_maps_api_key()
    if not api_key:
        raise ValueError(
            "Google Maps API key missing. Create a key with Street View Static + Geocoding "
            "enabled at https://console.cloud.google.com/apis/credentials , then set "
            "GOOGLE_MAPS_API_KEY or put it in gallery/data/google-maps-api-key.txt and restart."
        )
    meta: dict = {"heading": heading, "pitch": pitch, "fov": fov, "size": size}
    location_param = ""
    if lat is not None and lng is not None:
        location_param = f"{lat},{lng}"
        meta["lat"] = lat
        meta["lng"] = lng
    elif address:
        geo = _geocode_address(address, api_key)
        meta.update(geo)
        location_param = f"{geo['lat']},{geo['lng']}"
        meta["address"] = geo.get("formatted_address") or address
    else:
        raise ValueError("Provide an address or lat/lng.")

    # Cache key
    cache_slug = re.sub(
        r"[^a-zA-Z0-9._-]+",
        "-",
        f"{location_param}_h{heading}_p{pitch}_f{fov}_{size}",
    )[:120]
    STREET_VIEW_CACHE.mkdir(parents=True, exist_ok=True)
    cache_path = STREET_VIEW_CACHE / f"{cache_slug}.jpg"
    meta_path = STREET_VIEW_CACHE / f"{cache_slug}.json"
    if cache_path.is_file() and cache_path.stat().st_size > 200:
        try:
            if meta_path.is_file():
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            pass
        return cache_path.read_bytes(), meta

    with httpx.Client(timeout=25.0, follow_redirects=True) as client:
        r = client.get(
            "https://maps.googleapis.com/maps/api/streetview",
            params={
                "size": size,
                "location": location_param,
                "heading": str(heading),
                "pitch": str(pitch),
                "fov": str(fov),
                "source": "outdoor",
                "return_error_code": "true",
                "key": api_key,
            },
        )
        if r.status_code >= 400:
            raise ValueError(
                f"Street View request failed ({r.status_code}): {(r.text or '')[:200]}"
            )
        ctype = (r.headers.get("content-type") or "").lower()
        if "json" in ctype or not r.content or len(r.content) < 200:
            raise ValueError(
                "No Street View imagery for that location (or API key missing Street View Static API)."
            )
        data = r.content
        try:
            cache_path.write_bytes(data)
            meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")
        except OSError:
            pass
        return data, meta


def _respond_street_view(self):
    """GET /api/street-view?address=... or lat=&lng= → JPEG Street View still."""
    qs = parse_qs(urlparse(self.path).query or "")
    address = str((qs.get("address") or qs.get("q") or [""])[0]).strip()
    try:
        lat = float((qs.get("lat") or [""])[0]) if (qs.get("lat") or [""])[0] else None
        lng = float((qs.get("lng") or [""])[0]) if (qs.get("lng") or [""])[0] else None
    except ValueError:
        lat, lng = None, None
    try:
        heading = float((qs.get("heading") or ["0"])[0])
        pitch = float((qs.get("pitch") or ["0"])[0])
        fov = float((qs.get("fov") or ["90"])[0])
    except ValueError:
        heading, pitch, fov = 0.0, 0.0, 90.0
    size = str((qs.get("size") or ["1280x720"])[0])
    try:
        data, meta = _fetch_street_view_bytes(
            address=address,
            lat=lat,
            lng=lng,
            heading=heading,
            pitch=pitch,
            fov=fov,
            size=size,
        )
    except Exception as exc:
        return self._json({"ok": False, "error": str(exc)[:500]}, 400)
    try:
        self.send_response(200)
        self.send_header("Content-Type", "image/jpeg")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "public, max-age=86400")
        if meta.get("formatted_address"):
            self.send_header(
                "X-Street-View-Address",
                str(meta["formatted_address"])[:200].encode("latin-1", "replace").decode("latin-1"),
            )
        self.end_headers()
        self.wfile.write(data)
    except Exception:
        pass
    return True


def _respond_street_view_meta(self):
    """GET /api/street-view-meta?address=... → geocode + image URL for the UI."""
    qs = parse_qs(urlparse(self.path).query or "")
    address = str((qs.get("address") or qs.get("q") or [""])[0]).strip()
    if not address:
        return self._json({"ok": False, "error": "Missing address"}, 400)
    try:
        heading = float((qs.get("heading") or ["0"])[0])
        pitch = float((qs.get("pitch") or ["0"])[0])
        fov = float((qs.get("fov") or ["90"])[0])
    except ValueError:
        heading, pitch, fov = 0.0, 0.0, 90.0
    try:
        data, meta = _fetch_street_view_bytes(
            address=address, heading=heading, pitch=pitch, fov=fov
        )
    except Exception as exc:
        return self._json({"ok": False, "error": str(exc)[:500]}, 400)
    # Persist a stable public path under cache for use as spell URL
    STREET_VIEW_CACHE.mkdir(parents=True, exist_ok=True)
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", (meta.get("formatted_address") or address).lower())[:80]
    stamp = str(int(time.time() * 1000))[-8:]
    name = f"{slug or 'property'}-{stamp}.jpg"
    dest = STREET_VIEW_CACHE / name
    try:
        dest.write_bytes(data)
    except OSError as e:
        return self._json({"ok": False, "error": f"Could not save still: {e}"}, 500)
    rel = f"/data/street-view-cache/{name}"
    return self._json(
        {
            "ok": True,
            "url": rel,
            "address": meta.get("formatted_address") or address,
            "lat": meta.get("lat"),
            "lng": meta.get("lng"),
            "place_id": meta.get("place_id") or "",
            "heading": heading,
            "pitch": pitch,
            "fov": fov,
            "label": "SV " + (meta.get("formatted_address") or address)[:40],
        }
    )


# --- Commercial routes LAST so they always win over bytecode "Unknown API route" ---
_orig_app_handler_do_get_commercial = AppHandler.do_GET


def _app_handler_do_get_with_commercial(self):
    parsed = urlparse(self.path)
    path = (parsed.path or "").rstrip("/") or "/"
    if path in ("/api/commercial-brands",):
        return _respond_commercial_brands_list(self)
    if path in ("/api/commercial-logo",):
        return _respond_commercial_logo(self)
    if path in ("/api/commercial-search",):
        return _respond_commercial_search(self)
    if path in ("/api/street-view",):
        return _respond_street_view(self)
    if path in ("/api/street-view-meta",):
        return _respond_street_view_meta(self)
    return _orig_app_handler_do_get_commercial(self)


AppHandler.do_GET = _app_handler_do_get_with_commercial

_orig_app_handler_do_post_commercial = AppHandler.do_POST


def _app_handler_do_post_with_commercial(self):
    parsed = urlparse(self.path)
    path = (parsed.path or "").rstrip("/") or "/"
    if path in ("/api/commercial-brands",):
        try:
            body = self._read_json() or {}
        except Exception:
            return self._json({"ok": False, "error": "Invalid JSON"}, 400)
        try:
            row = _save_custom_brand(body)
            return self._json({"ok": True, "brand": row})
        except ValueError as e:
            return self._json({"ok": False, "error": str(e)}, 400)
        except OSError as e:
            return self._json({"ok": False, "error": f"Could not save brand: {e}"}, 500)
    return _orig_app_handler_do_post_commercial(self)


AppHandler.do_POST = _app_handler_do_post_with_commercial

# --- Market desk routes FINAL — must wrap last so POST trade/tick never hit bytecode 404 ---
_orig_app_handler_do_get_market = AppHandler.do_GET


def _app_handler_do_get_with_market(self):
    path = _normalize_api_path(urlparse(self.path).path)
    if path == "/api/market":
        return self._json(_market_snapshot(force_tick=True))
    if path == "/api/market/prices":
        state = _load_market_sim()
        now = time.time()
        if not state.get("last_tick_at") or now - float(state.get("last_tick_at") or 0) >= 2:
            state = _market_tick()
        return self._json({"ok": True, "gauged_prices": _market_gauged_prices(state)})
    return _orig_app_handler_do_get_market(self)


AppHandler.do_GET = _app_handler_do_get_with_market

_orig_app_handler_do_post_market = AppHandler.do_POST


def _app_handler_do_post_with_market(self):
    path = _normalize_api_path(urlparse(self.path).path)
    if path == "/api/market/tick":
        try:
            body = self._read_json()
        except Exception:
            body = {}
        if not isinstance(body, dict):
            body = {}
        force_sales = int(body.get("force_sales") or body.get("burst") or 0)
        return self._json(_market_snapshot(force_tick=True, force_sales=force_sales))
    if path == "/api/market/trade":
        try:
            body = self._read_json()
        except Exception:
            return self._json({"ok": False, "error": "Invalid JSON"}, 400)
        if not isinstance(body, dict):
            return self._json({"ok": False, "error": "Invalid JSON"}, 400)
        result = _market_trade(body)
        code = 200 if result.get("ok") else 400
        return self._json(result, code)
    if path == "/api/market/reset-paper":
        return self._json(_market_reset_paper())
    return _orig_app_handler_do_post_market(self)


AppHandler.do_POST = _app_handler_do_post_with_market


# --- Real income: Cash App only (spendable). Never sim/paper money. ---
REAL_INCOME_PATH = GALLERY / "data" / "real-income.json"
_REAL_INCOME_LOCK = threading.RLock()

_REAL_SPEND_CATEGORIES = ("rent", "food", "gas", "bills", "credits", "other")


def _real_income_default() -> dict:
    return {
        "version": 1,
        "note": "REAL Cash App money only. Simulated Market funds cannot be spent here or in the real world.",
        "cash_app": "Logan7in",
        "budget_goals_usd": {
            "rent": 1200,
            "food": 400,
            "gas": 200,
            "bills": 300,
            "credits": 100,
            "other": 0,
        },
        "entries": [],
    }


def _load_real_income() -> dict:
    default = _real_income_default()
    if not REAL_INCOME_PATH.is_file():
        return default
    try:
        data = json.loads(REAL_INCOME_PATH.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return default
        data = _strip_payment_secrets(data)
        out = default
        if isinstance(data.get("budget_goals_usd"), dict):
            goals = dict(out["budget_goals_usd"])
            for k, v in data["budget_goals_usd"].items():
                try:
                    goals[str(k)] = max(0.0, float(v))
                except (TypeError, ValueError):
                    pass
            out["budget_goals_usd"] = goals
        if isinstance(data.get("entries"), list):
            out["entries"] = data["entries"][-500:]
        if data.get("cash_app"):
            out["cash_app"] = str(data["cash_app"]).replace("$", "")
        return out
    except (OSError, json.JSONDecodeError):
        return default


def _save_real_income(data: dict) -> None:
    clean = _strip_payment_secrets(data)
    REAL_INCOME_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(clean, indent=2, ensure_ascii=False) + "\n"
    tmp = REAL_INCOME_PATH.with_suffix(".json.tmp")
    tmp.write_text(payload, encoding="utf-8")
    tmp.replace(REAL_INCOME_PATH)


def _real_income_summary() -> dict:
    """Spendable money only: logged Cash App + completed gallery orders. No sim."""
    with _REAL_INCOME_LOCK:
        ledger = _load_real_income()
    cfg = _load_payment_config()
    cash = str(ledger.get("cash_app") or cfg.get("cash_app") or "Logan7in").replace("$", "")
    month_key = time.strftime("%Y-%m", time.gmtime())
    entries = list(ledger.get("entries") or [])

    income_logged = 0.0
    spent = {c: 0.0 for c in _REAL_SPEND_CATEGORIES}
    month_income = 0.0
    month_spent = 0.0
    for e in entries:
        kind = str(e.get("kind") or "")
        amt = float(e.get("amount_usd") or 0)
        stamp = str(e.get("at") or "")
        in_month = stamp.startswith(month_key)
        if kind == "income":
            income_logged += amt
            if in_month:
                month_income += amt
        elif kind == "spend":
            cat = str(e.get("category") or "other")
            if cat not in spent:
                cat = "other"
            spent[cat] += amt
            if in_month:
                month_spent += amt

    # Completed gallery shop orders (real Cash App sales you confirmed)
    shop = _gallery_sales_stats()
    shop_all = float(shop.get("revenue_raised") or 0)
    shop_month = float(shop.get("month_sales_usd") or 0)

    total_income_all = round(income_logged + shop_all, 2)
    total_income_month = round(month_income + shop_month, 2)
    total_spent_all = round(sum(spent.values()), 2)
    balance = round(total_income_all - total_spent_all, 2)
    goals = ledger.get("budget_goals_usd") or {}
    goal_rent = float(goals.get("rent") or 0)
    goal_food = float(goals.get("food") or 0)
    goal_gas = float(goals.get("gas") or 0)
    life_goal = float(cfg.get("monthly_revenue_goal_usd") or 10000)

    return {
        "ok": True,
        "real_only": True,
        "disclaimer": (
            "This is REAL money tracking only. Market desk simulated sales and paper trades "
            "cannot buy gas, food, or rent. Earn via art sales/tips on Cash App $%s, then "
            "transfer to your bank/debit and spend in the real world."
        )
        % cash,
        "cash_app": cash,
        "cash_app_url": "https://cash.app/$" + cash,
        "balance_usd": balance,
        "income": {
            "logged_cashapp_usd": round(income_logged, 2),
            "gallery_shop_completed_usd": shop_all,
            "total_all_time_usd": total_income_all,
            "month_logged_usd": round(month_income, 2),
            "month_shop_usd": shop_month,
            "month_total_usd": total_income_month,
            "month_key": month_key,
        },
        "spent": {
            "by_category_usd": {k: round(v, 2) for k, v in spent.items()},
            "month_total_usd": round(month_spent, 2),
            "all_time_usd": total_spent_all,
        },
        "budget_goals_usd": {k: float(goals.get(k) or 0) for k in _REAL_SPEND_CATEGORIES},
        "life_needs": {
            "rent": {
                "goal_usd": goal_rent,
                "spent_usd": round(spent.get("rent") or 0, 2),
                "remaining_usd": round(max(0, goal_rent - (spent.get("rent") or 0)), 2),
            },
            "food": {
                "goal_usd": goal_food,
                "spent_usd": round(spent.get("food") or 0, 2),
                "remaining_usd": round(max(0, goal_food - (spent.get("food") or 0)), 2),
            },
            "gas": {
                "goal_usd": goal_gas,
                "spent_usd": round(spent.get("gas") or 0, 2),
                "remaining_usd": round(max(0, goal_gas - (spent.get("gas") or 0)), 2),
            },
        },
        "monthly_revenue_goal_usd": life_goal,
        "month_progress_pct": round(
            min(100.0, (total_income_month / life_goal) * 100.0) if life_goal else 0, 1
        ),
        "how_to_spend_in_real_world": [
            "1. Customer buys art or tips → they send money to Cash App $" + cash,
            "2. Confirm payment in the Cash App app (real balance increases)",
            "3. Log it here (Income) or mark gallery cart “I’ve sent payment”",
            "4. In Cash App: Transfer to bank / use Cash App card for gas, food, rent",
            "5. Log spends below so rent/gas/food budgets stay honest",
            "Never use Market SIM or paper portfolio — those are practice only",
        ],
        "entries": list(reversed(entries[-40:])),
        "pending_orders": shop.get("pending_orders") or 0,
        "security": {
            "stores_cards": False,
            "stores_pins": False,
            "note": "Only public Cash App cashtag. No card numbers in this app.",
        },
    }


def _real_income_add(body: dict) -> dict:
    kind = str(body.get("kind") or "").lower().strip()
    if kind not in ("income", "spend"):
        return {"ok": False, "error": "kind must be income or spend"}
    try:
        amount = float(body.get("amount_usd") or body.get("amount") or 0)
    except (TypeError, ValueError):
        amount = 0
    if amount <= 0:
        return {"ok": False, "error": "amount_usd must be positive"}
    category = str(body.get("category") or ("sales" if kind == "income" else "other")).lower()
    if kind == "spend" and category not in _REAL_SPEND_CATEGORIES:
        category = "other"
    if kind == "income" and category not in (
        "sales",
        "tip",
        "commission",
        "print",
        "other",
        "cash_app",
    ):
        category = "cash_app"
    note = str(body.get("note") or "")[:300]
    entry = {
        "id": str(uuid.uuid4())[:10],
        "kind": kind,
        "amount_usd": round(amount, 2),
        "category": category,
        "note": note,
        "method": "cash_app",
        "real": True,
        "simulated": False,
        "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    with _REAL_INCOME_LOCK:
        ledger = _load_real_income()
        entries = list(ledger.get("entries") or [])
        entries.append(entry)
        ledger["entries"] = entries[-500:]
        _save_real_income(ledger)
    summary = _real_income_summary()
    summary["ok"] = True
    summary["last_entry"] = entry
    return summary


def _real_income_set_goals(body: dict) -> dict:
    goals_in = body.get("budget_goals_usd") if isinstance(body.get("budget_goals_usd"), dict) else body
    with _REAL_INCOME_LOCK:
        ledger = _load_real_income()
        goals = dict(ledger.get("budget_goals_usd") or {})
        for k in _REAL_SPEND_CATEGORIES:
            if k in goals_in:
                try:
                    goals[k] = max(0.0, float(goals_in[k]))
                except (TypeError, ValueError):
                    pass
        ledger["budget_goals_usd"] = goals
        _save_real_income(ledger)
    summary = _real_income_summary()
    summary["ok"] = True
    return summary


_orig_app_handler_do_get_real = AppHandler.do_GET


def _app_handler_do_get_with_real_income(self):
    path = _normalize_api_path(urlparse(self.path).path)
    if path in ("/api/real-income", "/api/real-income/summary"):
        return self._json(_real_income_summary())
    return _orig_app_handler_do_get_real(self)


AppHandler.do_GET = _app_handler_do_get_with_real_income

_orig_app_handler_do_post_real = AppHandler.do_POST


def _app_handler_do_post_with_real_income(self):
    path = _normalize_api_path(urlparse(self.path).path)
    if path == "/api/real-income":
        try:
            body = self._read_json()
        except Exception:
            return self._json({"ok": False, "error": "Invalid JSON"}, 400)
        if not isinstance(body, dict):
            return self._json({"ok": False, "error": "Invalid JSON"}, 400)
        action = str(body.get("action") or "add").lower()
        if action == "set_goals":
            result = _real_income_set_goals(body)
        else:
            result = _real_income_add(body)
        code = 200 if result.get("ok") else 400
        return self._json(result, code)
    return _orig_app_handler_do_post_real(self)


AppHandler.do_POST = _app_handler_do_post_with_real_income


# --- Match live: LAN scores + shared gem templates ---
MATCH_LIVE_PATH = GALLERY / "data" / "match-live.json"
_MATCH_LIVE_LOCK = threading.RLock()
_MATCH_PLAYER_STALE_SEC = 45.0


def _match_live_default() -> dict:
    return {
        "version": 1,
        "skins": {"version": 0, "gems": []},
        "players": {},
    }


def _load_match_live() -> dict:
    with _MATCH_LIVE_LOCK:
        if not MATCH_LIVE_PATH.is_file():
            return _match_live_default()
        try:
            data = json.loads(MATCH_LIVE_PATH.read_text(encoding="utf-8"))
            if not isinstance(data, dict):
                return _match_live_default()
            if not isinstance(data.get("players"), dict):
                data["players"] = {}
            if not isinstance(data.get("skins"), dict):
                data["skins"] = {"version": 0, "gems": []}
            return data
        except Exception:
            return _match_live_default()


def _save_match_live(data: dict) -> None:
    with _MATCH_LIVE_LOCK:
        MATCH_LIVE_PATH.parent.mkdir(parents=True, exist_ok=True)
        MATCH_LIVE_PATH.write_text(
            json.dumps(data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )


def _match_live_prune(data: dict) -> dict:
    import time as _time

    now = _time.time()
    players = data.get("players") or {}
    keep = {}
    for pid, p in players.items():
        if not isinstance(p, dict):
            continue
        ts = float(p.get("updatedAt") or 0)
        # keep recent players (online or recently left) for scoreboard history
        if now - ts <= 3600:
            age = now - ts
            row = dict(p)
            row["online"] = age <= _MATCH_PLAYER_STALE_SEC and bool(p.get("playing", True))
            row["idleSec"] = int(max(0, age))
            keep[str(pid)] = row
    data["players"] = keep
    return data


def _respond_match_live_get(self):
    data = _match_live_prune(_load_match_live())
    players = list((data.get("players") or {}).values())
    players.sort(key=lambda p: (-int(p.get("score") or 0), str(p.get("name") or "")))
    return self._json(
        {
            "ok": True,
            "skins": data.get("skins") or {"version": 0, "gems": []},
            "players": players,
            "serverTime": __import__("time").time(),
        }
    )


def _respond_match_live_post(self):
    import time as _time

    try:
        body = self._read_json()
    except Exception:
        return self._json({"ok": False, "error": "Invalid JSON"}, 400)
    if not isinstance(body, dict):
        return self._json({"ok": False, "error": "Invalid JSON"}, 400)

    action = str(body.get("action") or "presence").strip().lower()
    data = _load_match_live()
    now = _time.time()

    if action == "skins":
        skins = body.get("skins") or body
        gems = skins.get("gems") if isinstance(skins, dict) else None
        if not isinstance(gems, list) or not gems:
            return self._json({"ok": False, "error": "skins.gems required"}, 400)
        # Accept any version bump (or equal with force)
        ver = int(skins.get("version") or body.get("version") or int(now * 1000))
        cur = int((data.get("skins") or {}).get("version") or 0)
        force = bool(body.get("force"))
        if ver < cur and not force:
            return self._json(
                {
                    "ok": True,
                    "skipped": True,
                    "skins": data.get("skins"),
                    "message": "Server already has newer skins",
                }
            )
        # Cap payload size (6 gems of small meta)
        clean_gems = []
        for g in gems[:8]:
            if not isinstance(g, dict):
                continue
            clean_gems.append(
                {
                    "num": int(g.get("num") or 1),
                    "silhouette": int(g.get("silhouette") or 0) % 6,
                    "hue": float(g.get("hue") or 0) % 360,
                    "hues": [float(x) % 360 for x in (g.get("hues") or [])[:4]],
                    "sat": int(g.get("sat") or 72),
                    "lit": int(g.get("lit") or 52),
                    "seed": int(g.get("seed") or 0),
                    "title": str(g.get("title") or "")[:80],
                }
            )
        if not clean_gems:
            return self._json({"ok": False, "error": "No valid gems"}, 400)
        data["skins"] = {"version": max(ver, cur + 1), "gems": clean_gems, "updatedAt": now}
        _save_match_live(data)
        return self._json({"ok": True, "skins": data["skins"]})

    # presence heartbeat
    pid = str(body.get("id") or body.get("playerId") or "").strip()[:64]
    if not pid:
        return self._json({"ok": False, "error": "id required"}, 400)
    name = str(body.get("name") or "Player").strip()[:40] or "Player"
    try:
        score = int(body.get("score") or 0)
    except (TypeError, ValueError):
        score = 0
    playing = body.get("playing")
    if playing is None:
        playing = True
    players = data.setdefault("players", {})
    prev = players.get(pid) if isinstance(players.get(pid), dict) else {}
    players[pid] = {
        "id": pid,
        "name": name,
        "score": max(0, score),
        "playing": bool(playing),
        "updatedAt": now,
        "bestScore": max(int(prev.get("bestScore") or 0), max(0, score)),
    }
    data = _match_live_prune(data)
    _save_match_live(data)
    plist = list((data.get("players") or {}).values())
    plist.sort(key=lambda p: (-int(p.get("score") or 0), str(p.get("name") or "")))
    return self._json(
        {
            "ok": True,
            "player": players.get(pid),
            "players": plist,
            "skins": data.get("skins") or {"version": 0, "gems": []},
        }
    )


_orig_app_handler_do_get_match = AppHandler.do_GET


def _app_handler_do_get_with_match(self):
    path = _normalize_api_path(urlparse(self.path).path)
    if path in ("/api/match/live", "/api/match/live/"):
        return _respond_match_live_get(self)
    return _orig_app_handler_do_get_match(self)


AppHandler.do_GET = _app_handler_do_get_with_match

_orig_app_handler_do_post_match = AppHandler.do_POST


def _app_handler_do_post_with_match(self):
    path = _normalize_api_path(urlparse(self.path).path)
    if path in ("/api/match/live", "/api/match/live/"):
        return _respond_match_live_post(self)
    return _orig_app_handler_do_post_match(self)


AppHandler.do_POST = _app_handler_do_post_with_match

try:
    (GALLERY / "data").mkdir(parents=True, exist_ok=True)
except Exception:
    pass


# --- Sale art: Cash App QR watermark for X listings; clean file on sale ---
SALE_ART_SOLD_PATH = GALLERY / "data" / "sale-art-sold.json"
CASHAPP_QR_PATH = GALLERY / "assets" / "cashapp-logan7in-qr.png"
PAINTINGS_DIR = GALLERY / "paintings"
_SALE_ART_LOCK = threading.RLock()


def _load_sale_art_sold() -> dict:
    if not SALE_ART_SOLD_PATH.is_file():
        return {"version": 1, "sold": {}}
    try:
        data = json.loads(SALE_ART_SOLD_PATH.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return {"version": 1, "sold": {}}
        if not isinstance(data.get("sold"), dict):
            data["sold"] = {}
        return data
    except (OSError, json.JSONDecodeError):
        return {"version": 1, "sold": {}}


def _save_sale_art_sold(data: dict) -> None:
    SALE_ART_SOLD_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(data, indent=2, ensure_ascii=False) + "\n"
    tmp = SALE_ART_SOLD_PATH.with_suffix(".json.tmp")
    tmp.write_text(payload, encoding="utf-8")
    tmp.replace(SALE_ART_SOLD_PATH)


def _painting_file_for_num(num: int) -> Path | None:
    n = int(num)
    if n < 1:
        return None
    # Prefer exact filename from manifest-style paths
    for name in (f"{n}.jpg", f"{n}.jpeg", f"{n}.png", f"{n}.webp"):
        p = PAINTINGS_DIR / name
        if p.is_file():
            return p
    # Scan prefix match
    if PAINTINGS_DIR.is_dir():
        for p in PAINTINGS_DIR.iterdir():
            if p.is_file() and p.stem == str(n):
                return p
    return None


def _watermark_bytes(num: int) -> tuple[bytes, str] | None:
    """Return (jpeg_bytes, filename) with Cash App QR pinned bottom-right."""
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError:
        return None
    src = _painting_file_for_num(num)
    if not src or not src.is_file():
        return None
    if not CASHAPP_QR_PATH.is_file():
        return None
    try:
        base = Image.open(src).convert("RGBA")
        qr = Image.open(CASHAPP_QR_PATH).convert("RGBA")
    except OSError:
        return None
    w, h = base.size
    # QR ~16% of shorter side, min 72px
    side = max(72, int(min(w, h) * 0.16))
    qr = qr.resize((side, side), Image.Resampling.LANCZOS)
    margin = max(8, int(side * 0.1))
    # Soft white plate behind QR so it reads on dark art
    plate = Image.new("RGBA", (side + margin, side + margin), (255, 255, 255, 210))
    px = w - plate.width - margin // 2
    py = h - plate.height - margin // 2
    px = max(0, px)
    py = max(0, py)
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    layer.paste(plate, (px, py), plate)
    layer.paste(qr, (px + margin // 2, py + margin // 2), qr)
    # Tiny cashtag caption under QR plate if room
    try:
        draw = ImageDraw.Draw(layer)
        label = "$Logan7in"
        # default font
        tw = side
        draw.rectangle(
            [px, py + plate.height - 2, px + plate.width, py + plate.height + 16],
            fill=(0, 0, 0, 160),
        )
        draw.text((px + 4, py + plate.height), label, fill=(255, 255, 255, 240))
    except Exception:
        pass
    out = Image.alpha_composite(base, layer).convert("RGB")
    import io

    buf = io.BytesIO()
    out.save(buf, format="JPEG", quality=90, optimize=True)
    return buf.getvalue(), f"sale-qr-{num}.jpg"


def _clean_bytes(num: int) -> tuple[bytes, str, str] | None:
    """Original painting without QR watermark."""
    src = _painting_file_for_num(num)
    if not src or not src.is_file():
        return None
    try:
        data = src.read_bytes()
    except OSError:
        return None
    mime = "image/jpeg"
    if src.suffix.lower() == ".png":
        mime = "image/png"
    elif src.suffix.lower() == ".webp":
        mime = "image/webp"
    return data, mime, f"sold-clean-{num}{src.suffix.lower() or '.jpg'}"


def _sale_art_catalog(limit: int = 0) -> dict:
    sold = _load_sale_art_sold().get("sold") or {}
    for_sale = []
    if not PAINTINGS_DIR.is_dir():
        return {"ok": True, "for_sale": [], "sold_count": len(sold), "total": 0}
    nums = []
    for p in PAINTINGS_DIR.iterdir():
        if not p.is_file():
            continue
        try:
            n = int(p.stem)
        except ValueError:
            continue
        if n >= 1:
            nums.append(n)
    nums = sorted(set(nums))
    for n in nums:
        key = str(n)
        if key in sold:
            continue
        for_sale.append(
            {
                "number": n,
                "title": f"Painting #{n}",
                "watermarked_url": f"/api/sale-art/watermarked?n={n}",
                "clean_url": f"/api/sale-art/clean?n={n}",
                "price_usd": float(
                    (_load_payment_config().get("prices_usd") or {}).get("paintings") or 89
                ),
            }
        )
    total = len(nums)
    if limit and limit > 0:
        for_sale = for_sale[:limit]
    return {
        "ok": True,
        "for_sale": for_sale,
        "for_sale_count": len(for_sale) if not limit else len(nums) - len(sold),
        "listed": len(for_sale),
        "sold_count": len(sold),
        "total_paintings": total,
        "cash_app": "Logan7in",
        "qr_asset": "/assets/cashapp-logan7in-qr.png",
        "note": "Watermarked images are for X sale posts. On sale, deliver clean file (no QR).",
    }


def _sale_art_mark_sold(body: dict) -> dict:
    numbers = body.get("numbers") or body.get("painting_numbers") or []
    if body.get("number") is not None:
        numbers = list(numbers) + [body.get("number")]
    cleaned = []
    for x in numbers:
        try:
            n = int(x)
        except (TypeError, ValueError):
            continue
        if n >= 1:
            cleaned.append(n)
    # Also parse cart-style ids painting:12
    for it in body.get("items") or []:
        if not isinstance(it, dict):
            continue
        cid = str(it.get("id") or "")
        if cid.startswith("painting:"):
            try:
                cleaned.append(int(cid.split(":", 1)[1]))
            except ValueError:
                pass
        elif it.get("collection") == "paintings" and it.get("number") is not None:
            try:
                cleaned.append(int(it.get("number")))
            except (TypeError, ValueError):
                pass
    cleaned = sorted(set(cleaned))
    if not cleaned:
        return {"ok": False, "error": "No painting numbers to mark sold"}
    with _SALE_ART_LOCK:
        data = _load_sale_art_sold()
        sold = dict(data.get("sold") or {})
        downloads = []
        for n in cleaned:
            sold[str(n)] = {
                "sold_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "order_id": body.get("order_id"),
                "buyer_note": str(body.get("note") or "")[:200],
            }
            downloads.append(
                {
                    "number": n,
                    "clean_url": f"/api/sale-art/clean?n={n}",
                    "filename": f"sold-clean-{n}.jpg",
                }
            )
        data["sold"] = sold
        _save_sale_art_sold(data)
    return {
        "ok": True,
        "marked_sold": cleaned,
        "downloads": downloads,
        "sold_count": len(sold),
        "message": "QR watermark removed from sale listing. Download clean images for the buyer.",
    }


def _respond_image_bytes(handler, data: bytes, content_type: str, filename: str, disposition: str = "inline"):
    handler.send_response(200)
    handler.send_header("Content-Type", content_type)
    handler.send_header("Content-Length", str(len(data)))
    handler.send_header(
        "Content-Disposition",
        f'{disposition}; filename="{filename}"',
    )
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    handler.wfile.write(data)


_orig_app_handler_do_get_sale_art = AppHandler.do_GET


def _app_handler_do_get_with_sale_art(self):
    parsed = urlparse(self.path)
    path = _normalize_api_path(parsed.path)
    qs = parse_qs(parsed.query or "")
    if path == "/api/sale-art/catalog":
        try:
            lim = int((qs.get("limit") or ["0"])[0] or 0)
        except ValueError:
            lim = 0
        return self._json(_sale_art_catalog(limit=lim))
    if path == "/api/sale-art/watermarked":
        try:
            n = int((qs.get("n") or qs.get("number") or ["0"])[0])
        except ValueError:
            n = 0
        if n < 1:
            return self._json({"ok": False, "error": "Missing n"}, 400)
        sold = (_load_sale_art_sold().get("sold") or {}).get(str(n))
        if sold:
            return self._json(
                {
                    "ok": False,
                    "error": "Sold — QR listing removed. Use clean download.",
                    "sold": True,
                    "clean_url": f"/api/sale-art/clean?n={n}",
                },
                410,
            )
        result = _watermark_bytes(n)
        if not result:
            return self._json({"ok": False, "error": "Could not watermark (missing file or Pillow)"}, 404)
        data, filename = result
        return _respond_image_bytes(self, data, "image/jpeg", filename, "inline")
    if path == "/api/sale-art/clean":
        try:
            n = int((qs.get("n") or qs.get("number") or ["0"])[0])
        except ValueError:
            n = 0
        if n < 1:
            return self._json({"ok": False, "error": "Missing n"}, 400)
        result = _clean_bytes(n)
        if not result:
            return self._json({"ok": False, "error": "Painting not found"}, 404)
        data, mime, filename = result
        disp = "attachment" if (qs.get("download") or ["0"])[0] in ("1", "true", "yes") else "inline"
        return _respond_image_bytes(self, data, mime, filename, disp)
    return _orig_app_handler_do_get_sale_art(self)


AppHandler.do_GET = _app_handler_do_get_with_sale_art

_orig_app_handler_do_post_sale_art = AppHandler.do_POST


def _app_handler_do_post_with_sale_art(self):
    path = _normalize_api_path(urlparse(self.path).path)
    if path in ("/api/sale-art/sold", "/api/sale-art/mark-sold"):
        try:
            body = self._read_json()
        except Exception:
            return self._json({"ok": False, "error": "Invalid JSON"}, 400)
        if not isinstance(body, dict):
            return self._json({"ok": False, "error": "Invalid JSON"}, 400)
        result = _sale_art_mark_sold(body)
        code = 200 if result.get("ok") else 400
        return self._json(result, code)
    return _orig_app_handler_do_post_sale_art(self)


AppHandler.do_POST = _app_handler_do_post_with_sale_art

try:
    n_brands = len(_load_commercial_brands())
    print(f"[gallery] Commercial catalog: {n_brands} brands ready", flush=True)
except Exception as _co_err:
    print(f"[gallery] Commercial catalog bootstrap: {_co_err}", flush=True)

try:
    print("[gallery] Market desk routes: /api/market (SIM only — not spendable)", flush=True)
    print("[gallery] Real income routes: /api/real-income (Cash App — spendable)", flush=True)
    print("[gallery] Sale art: /api/sale-art/* (QR watermark for X; clean on sale)", flush=True)
except Exception:
    pass

# Match live must be outermost so later route wrappers cannot hide /api/match/live
_orig_app_handler_do_get_match_outer = AppHandler.do_GET


def _app_handler_do_get_with_match_outer(self):
    path = _normalize_api_path(urlparse(self.path).path)
    if path in ("/api/match/live", "/api/match/live/"):
        return _respond_match_live_get(self)
    return _orig_app_handler_do_get_match_outer(self)


AppHandler.do_GET = _app_handler_do_get_with_match_outer

_orig_app_handler_do_post_match_outer = AppHandler.do_POST


def _app_handler_do_post_with_match_outer(self):
    path = _normalize_api_path(urlparse(self.path).path)
    if path in ("/api/match/live", "/api/match/live/"):
        return _respond_match_live_post(self)
    return _orig_app_handler_do_post_match_outer(self)


AppHandler.do_POST = _app_handler_do_post_with_match_outer

try:
    print("[gallery] Match live: /api/match/live (LAN scores + shared gem skins)", flush=True)
except Exception:
    pass


# --- Transfer: PC ↔ phone photo portal ---
PHONE_UPLOADS_DIR = GALLERY / "phone-uploads"
TRANSFER_TO_PHONE_DIR = GALLERY / "transfer-to-phone"
PHONE_UPLOAD_ANALYSES_PATH = GALLERY / "data" / "phone-upload-analyses.json"
PHONE_UPLOAD_GENERATED_MAP_PATH = GALLERY / "data" / "phone-upload-generated.json"
_TRANSFER_LOCK = threading.RLock()
_PHONE_ANALYSES_LOCK = threading.RLock()
_PHONE_ANALYZE_PENDING: set[str] = set()
_PHONE_ANALYZE_FAILED: dict[str, str] = {}
_TRANSFER_MAX_BYTES = 40 * 1024 * 1024
_TRANSFER_IMAGE_EXTS = {
    ".jpg",
    ".jpeg",
    ".png",
    ".webp",
    ".gif",
    ".bmp",
    ".heic",
    ".heif",
    ".tif",
    ".tiff",
}
_TRANSFER_VIDEO_EXTS = {".mp4", ".webm", ".mov", ".m4v"}
_TRANSFER_EXTS = _TRANSFER_IMAGE_EXTS | _TRANSFER_VIDEO_EXTS


def _load_phone_upload_analyses() -> dict:
    if not PHONE_UPLOAD_ANALYSES_PATH.is_file():
        return {}
    try:
        data = json.loads(PHONE_UPLOAD_ANALYSES_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _save_phone_upload_analyses(data: dict) -> None:
    PHONE_UPLOAD_ANALYSES_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(data, indent=2, ensure_ascii=False) + "\n"
    tmp = PHONE_UPLOAD_ANALYSES_PATH.with_suffix(".json.tmp")
    for attempt in range(8):
        try:
            tmp.write_text(payload, encoding="utf-8")
            tmp.replace(PHONE_UPLOAD_ANALYSES_PATH)
            return
        except (PermissionError, OSError):
            if attempt == 7:
                raise
            time.sleep(0.35 * (attempt + 1))


def _phone_upload_analysis_for(name: str) -> dict | None:
    key = Path(str(name or "")).name
    if not key:
        return None
    with _PHONE_ANALYSES_LOCK:
        data = _load_phone_upload_analyses()
        row = data.get(key) or data.get(Path(key).stem)
        return row if isinstance(row, dict) else None


def _transfer_file_to_data_url(path: Path, max_size: int = 768) -> str:
    """JPEG data URL for vision analysis (phone uploads on disk)."""
    try:
        from analyze import image_to_data_url  # noqa: PLC0415

        return image_to_data_url(path, max_size)
    except Exception:
        raw = path.read_bytes()
        # last resort: raw base64 without resize
        ext = path.suffix.lower().lstrip(".") or "jpeg"
        if ext in ("jpg", "jpeg"):
            mime = "image/jpeg"
        elif ext == "png":
            mime = "image/png"
        elif ext == "webp":
            mime = "image/webp"
        else:
            mime = "image/jpeg"
        b64 = base64.standard_b64encode(raw).decode("ascii")
        return f"data:{mime};base64,{b64}"


def _load_phone_generated_map() -> dict:
    if not PHONE_UPLOAD_GENERATED_MAP_PATH.is_file():
        return {}
    try:
        data = json.loads(PHONE_UPLOAD_GENERATED_MAP_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _save_phone_generated_map(data: dict) -> None:
    PHONE_UPLOAD_GENERATED_MAP_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(data, indent=2, ensure_ascii=False) + "\n"
    tmp = PHONE_UPLOAD_GENERATED_MAP_PATH.with_suffix(".json.tmp")
    tmp.write_text(payload, encoding="utf-8")
    tmp.replace(PHONE_UPLOAD_GENERATED_MAP_PATH)


def _phone_generated_mapping(name: str) -> dict | None:
    key = Path(str(name or "")).name
    if not key:
        return None
    with _PHONE_ANALYSES_LOCK:
        row = _load_phone_generated_map().get(key)
        return row if isinstance(row, dict) else None


def _transfer_promote_to_generated(path: Path, name: str) -> dict | None:
    """
    Copy phone upload into gallery/generated/N.* so it joins LOD1s / Generated /
    Conceptualizer / Animate / supermarket / every acquired-folder pool.
    """
    key = Path(name).name
    if path.suffix.lower() not in _TRANSFER_IMAGE_EXTS:
        return None
    existing = _phone_generated_mapping(key)
    if existing and existing.get("num") is not None:
        gen_url = str(existing.get("url") or f"/generated/{existing['num']}.jpg")
        gen_path = (GALLERY / gen_url.lstrip("/")).resolve()
        try:
            if gen_path.is_file() and gen_path.relative_to(GALLERY.resolve()):
                return existing
        except (ValueError, OSError):
            pass
    try:
        raw = path.read_bytes()
    except OSError as exc:
        print(f"[gallery] Transfer: promote read failed {key}: {exc}", flush=True)
        return None
    if not raw:
        return None
    try:
        b64 = base64.standard_b64encode(raw).decode("ascii")
        record = save_generated_still(
            preview_b64=b64,
            source="phone-upload",
            description=f"Phone upload: {key}",
            meta={
                "phone_upload": key,
                "phone_url": "/" + path.relative_to(GALLERY).as_posix(),
            },
        )
    except Exception as exc:
        print(f"[gallery] Transfer: promote to generated failed {key}: {exc}", flush=True)
        return None
    mapping = {
        "num": record.get("num"),
        "name": record.get("name"),
        "url": record.get("url"),
        "phone_upload": key,
        "phone_url": "/" + path.relative_to(GALLERY).as_posix(),
        "promoted_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    with _PHONE_ANALYSES_LOCK:
        data = _load_phone_generated_map()
        data[key] = mapping
        _save_phone_generated_map(data)
    print(
        f"[gallery] Transfer: {key} → generated #{mapping.get('num')} (generator mix)",
        flush=True,
    )
    return mapping


def _transfer_write_lod1_analysis(num: int, analysis: dict) -> None:
    """Mirror phone description into lod1-analyses so Generated / spells can use it."""
    if not num or not isinstance(analysis, dict):
        return
    try:
        with _lod1_analyses_lock:
            data = load_lod1_analyses()
            if not isinstance(data, dict):
                data = {}
            row = dict(analysis)
            row["number"] = int(num)
            row["kind"] = "phone-upload"
            if not row.get("analyzed_at"):
                row["analyzed_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            data[str(int(num))] = row
            save_lod1_analyses(data)
    except Exception as exc:
        print(f"[gallery] Transfer: lod1 analysis write failed #{num}: {exc}", flush=True)


def _transfer_run_phone_analysis(path: Path, name: str, gen_num: int | None = None) -> None:
    """Background: describe phone upload + generation prompt (prompt weights)."""
    key = Path(name).name
    try:
        if not path.is_file():
            raise FileNotFoundError(str(path))
        if path.suffix.lower() in _TRANSFER_VIDEO_EXTS:
            return
        data_url = _transfer_file_to_data_url(path, 768)
        analysis = analyze_import_image(data_url, mode="phone")
        if not isinstance(analysis, dict):
            raise ValueError("Analysis did not return an object")
        # Ensure prompt-weight text exists
        if not str(analysis.get("prompt") or "").strip():
            parts = []
            if analysis.get("title"):
                parts.append(str(analysis["title"]))
            if analysis.get("description"):
                parts.append(str(analysis["description"]))
            meta = []
            if analysis.get("style"):
                meta.append(f"{analysis['style']} style")
            if analysis.get("mood"):
                meta.append(f"{analysis['mood']} mood")
            if analysis.get("medium"):
                meta.append(str(analysis["medium"]))
            if meta:
                parts.append(", ".join(meta))
            if analysis.get("tags"):
                parts.append(", ".join(str(t) for t in analysis["tags"][:8]))
            if analysis.get("colors"):
                parts.append("palette: " + ", ".join(str(c) for c in analysis["colors"][:5]))
            analysis["prompt"] = ". ".join(p for p in parts if p).replace("..", ".").strip()
        analysis["name"] = key
        analysis["url"] = "/" + path.relative_to(GALLERY).as_posix()
        analysis["kind"] = "phone-upload"
        analysis["analyzed_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        if gen_num is None:
            mapped = _phone_generated_mapping(key)
            if mapped and mapped.get("num") is not None:
                try:
                    gen_num = int(mapped["num"])
                except (TypeError, ValueError):
                    gen_num = None
        if gen_num is not None:
            analysis["generated_num"] = int(gen_num)
            analysis["generated_url"] = f"/generated/{int(gen_num)}.jpg"
            # Prefer existing generated file extension if present
            mapped = _phone_generated_mapping(key) or {}
            if mapped.get("url"):
                analysis["generated_url"] = mapped["url"]
        with _PHONE_ANALYSES_LOCK:
            data = _load_phone_upload_analyses()
            data[key] = analysis
            _save_phone_upload_analyses(data)
            _PHONE_ANALYZE_PENDING.discard(key)
            _PHONE_ANALYZE_FAILED.pop(key, None)
        # Sidecar next to image for easy tooling
        try:
            side = path.with_name(path.stem + ".analysis.json")
            side.write_text(json.dumps(analysis, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        except OSError:
            pass
        if gen_num is not None:
            _transfer_write_lod1_analysis(int(gen_num), analysis)
            # Keep generated/N.json description in sync when present
            try:
                meta_path = GENERATED_DIR / f"{int(gen_num)}.json"
                if meta_path.is_file():
                    meta = json.loads(meta_path.read_text(encoding="utf-8"))
                    if isinstance(meta, dict):
                        meta["description"] = analysis.get("description") or meta.get("description") or ""
                        meta["title"] = analysis.get("title") or meta.get("title") or ""
                        meta["prompt"] = analysis.get("prompt") or ""
                        meta["phone_upload"] = key
                        meta_path.write_text(
                            json.dumps(meta, indent=2, ensure_ascii=False) + "\n",
                            encoding="utf-8",
                        )
            except Exception:
                pass
        print(
            f"[gallery] Transfer: analyzed phone upload {key}"
            + (f" → G#{gen_num}" if gen_num is not None else ""),
            flush=True,
        )
    except Exception as exc:
        err = str(exc)[:240]
        with _PHONE_ANALYSES_LOCK:
            _PHONE_ANALYZE_PENDING.discard(key)
            _PHONE_ANALYZE_FAILED[key] = err
        print(f"[gallery] Transfer: analysis failed for {key}: {err}", flush=True)


def _transfer_queue_phone_analysis(
    path: Path, name: str, gen_num: int | None = None
) -> str:
    """Queue description + prompt-weight analysis for a phone upload image."""
    key = Path(name).name
    ext = path.suffix.lower()
    if ext in _TRANSFER_VIDEO_EXTS:
        return "skipped-video"
    if ext not in _TRANSFER_IMAGE_EXTS:
        return "skipped"
    with _PHONE_ANALYSES_LOCK:
        existing = _load_phone_upload_analyses().get(key)
        if isinstance(existing, dict) and (
            existing.get("description") or existing.get("prompt")
        ):
            # Still ensure lod1 mirror if we now have a generated number
            if gen_num is not None and not existing.get("generated_num"):
                existing = dict(existing)
                existing["generated_num"] = int(gen_num)
                data = _load_phone_upload_analyses()
                data[key] = existing
                _save_phone_upload_analyses(data)
                _transfer_write_lod1_analysis(int(gen_num), existing)
            return "ready"
        if key in _PHONE_ANALYZE_PENDING:
            return "analyzing"
        _PHONE_ANALYZE_PENDING.add(key)
        _PHONE_ANALYZE_FAILED.pop(key, None)
    t = threading.Thread(
        target=_transfer_run_phone_analysis,
        args=(path, key, gen_num),
        name=f"phone-analyze-{key[:40]}",
        daemon=True,
    )
    t.start()
    return "analyzing"


def _transfer_analysis_status(name: str) -> str:
    key = Path(str(name or "")).name
    if not key:
        return "none"
    with _PHONE_ANALYSES_LOCK:
        if key in _PHONE_ANALYZE_PENDING:
            return "analyzing"
        if key in _PHONE_ANALYZE_FAILED:
            return "failed"
        row = _load_phone_upload_analyses().get(key)
        if isinstance(row, dict) and (row.get("description") or row.get("prompt")):
            return "ready"
    return "none"


def _transfer_box_dir(box: str) -> Path | None:
    b = str(box or "").strip().lower().replace("_", "-")
    if b in ("phone-uploads", "from-phone", "uploads", "phone"):
        return PHONE_UPLOADS_DIR
    if b in ("to-phone", "transfer-to-phone", "outbox", "pc-to-phone"):
        return TRANSFER_TO_PHONE_DIR
    return None


def _transfer_safe_name(name: str) -> str:
    base = Path(str(name or "upload").replace("\\", "/")).name
    base = re.sub(r"[^\w.\- ()\[\]]+", "_", base).strip("._ ") or "upload"
    if len(base) > 120:
        stem = Path(base).stem[:80]
        suf = Path(base).suffix[:20]
        base = stem + suf
    return base


def _transfer_unique_path(folder: Path, name: str) -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    safe = _transfer_safe_name(name)
    dest = folder / safe
    if not dest.exists():
        return dest
    stem = dest.stem
    suf = dest.suffix
    for i in range(2, 500):
        cand = folder / f"{stem}_{i}{suf}"
        if not cand.exists():
            return cand
    return folder / f"{stem}_{uuid.uuid4().hex[:8]}{suf}"


def _transfer_list(box: str) -> list:
    folder = _transfer_box_dir(box)
    if folder is None:
        return []
    folder.mkdir(parents=True, exist_ok=True)
    items = []
    want_analysis = str(box or "").strip().lower() in (
        "phone-uploads",
        "from-phone",
        "uploads",
        "phone",
    )
    for entry in sorted(folder.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
        if not entry.is_file():
            continue
        ext = entry.suffix.lower()
        if ext not in _TRANSFER_EXTS:
            continue
        try:
            st = entry.stat()
            rel = entry.relative_to(GALLERY).as_posix()
        except Exception:
            continue
        row = {
            "name": entry.name,
            "url": "/" + rel,
            "size": st.st_size,
            "mtime": st.st_mtime,
            "kind": "video" if ext in _TRANSFER_VIDEO_EXTS else "image",
        }
        if want_analysis and ext in _TRANSFER_IMAGE_EXTS:
            # Ensure older phone photos are in generated/ for the generator mix
            mapped = _phone_generated_mapping(entry.name)
            if not mapped:
                mapped = _transfer_promote_to_generated(entry, entry.name)
            gen_num = None
            if mapped and mapped.get("num") is not None:
                try:
                    gen_num = int(mapped["num"])
                except (TypeError, ValueError):
                    gen_num = None
                row["generatedNum"] = gen_num
                row["generatedUrl"] = mapped.get("url")
                row["inGeneratorMix"] = True
            a = _phone_upload_analysis_for(entry.name)
            st_a = _transfer_analysis_status(entry.name)
            # Backfill: queue description for older uploads missing analysis
            if st_a == "none" and len(_PHONE_ANALYZE_PENDING) < 3:
                st_a = _transfer_queue_phone_analysis(entry, entry.name, gen_num)
            row["analysisStatus"] = st_a
            if a:
                row["analysis"] = {
                    "title": a.get("title") or "",
                    "description": a.get("description") or "",
                    "prompt": a.get("prompt") or "",
                    "style": a.get("style") or "",
                    "mood": a.get("mood") or "",
                    "medium": a.get("medium") or "",
                    "tags": a.get("tags") or [],
                    "colors": a.get("colors") or [],
                    "analyzed_at": a.get("analyzed_at") or "",
                    "generated_num": a.get("generated_num") or gen_num,
                    "generated_url": a.get("generated_url") or row.get("generatedUrl"),
                }
                row["title"] = a.get("title") or entry.name
                row["description"] = a.get("description") or ""
                row["prompt"] = a.get("prompt") or ""
            elif st_a == "failed":
                with _PHONE_ANALYSES_LOCK:
                    row["analysisError"] = _PHONE_ANALYZE_FAILED.get(entry.name) or "failed"
        items.append(row)
    return items[:200]


def _transfer_ip_score(ip: str) -> int:
    """Higher = better for phone-on-home-WiFi QR codes."""
    if not ip or ip.startswith("127.") or ip.startswith("169.254."):
        return -1000
    # VirtualBox / VMware host-only (common wrong QR target)
    if ip.startswith("192.168.56.") or ip.startswith("192.168.57.") or ip.startswith("192.168.59."):
        return -80
    if ip.startswith("192.168.64.") or ip.startswith("172.28.") or ip.startswith("172.29."):
        return -60  # often Hyper-V / WSL
    # Typical home Wi‑Fi LAN (phone on same router)
    if ip.startswith("192.168.0.") or ip.startswith("192.168.1."):
        return 100
    if ip.startswith("192.168."):
        return 80
    if ip.startswith("10.0.") or ip.startswith("10.1."):
        return 55
    # ZeroTier / corporate VPN — reachable only if phone is on that overlay
    if ip.startswith("10."):
        return 10
    if ip.startswith("172.16.") or ip.startswith("172.17.") or ip.startswith("172.18."):
        return 12  # docker / private
    return 5


def _transfer_preferred_ip_path() -> Path:
    return GALLERY / "data" / "transfer-preferred-lan-ip.txt"


def _transfer_load_preferred_ip() -> str:
    try:
        p = _transfer_preferred_ip_path()
        if p.is_file():
            text = p.read_text(encoding="utf-8-sig").strip()  # strip BOM from editors
            if not text:
                return ""
            raw = text.split()[0].strip().lstrip("\ufeff")
            if "://" in raw:
                raw = urlparse(raw).hostname or ""
            elif ":" in raw and raw.count(":") == 1:
                raw = raw.split(":")[0]
            return raw
    except Exception:
        pass
    return ""


def _transfer_save_preferred_ip(ip: str) -> None:
    ip = str(ip or "").strip().lstrip("\ufeff")
    if not ip or ip.startswith("127."):
        return
    # strip accidental URL / port
    if "://" in ip:
        try:
            ip = urlparse(ip).hostname or ""
        except Exception:
            return
    elif ":" in ip and ip.count(":") == 1:
        ip = ip.split(":")[0]
    if not ip or _transfer_ip_score(ip) < -500:
        return
    try:
        path = _transfer_preferred_ip_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes((ip + "\n").encode("ascii", "ignore"))
    except Exception:
        pass


def _transfer_enumerate_ipv4() -> list[str]:
    """All local IPv4 addresses (Windows multi-homed safe)."""
    import socket
    import subprocess

    found: list[str] = []

    def add(ip: str):
        ip = str(ip or "").strip()
        if not ip or ":" in ip:
            return
        if ip.startswith("127.") or ip.startswith("169.254."):
            return
        if ip not in found:
            found.append(ip)

    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect(("8.8.8.8", 80))
            add(s.getsockname()[0])
        finally:
            s.close()
    except Exception:
        pass

    try:
        hostname = socket.gethostname()
        for info in socket.getaddrinfo(hostname, None, socket.AF_INET):
            add(info[4][0])
    except Exception:
        pass

    # ipconfig catches Wi‑Fi / VirtualBox / VPN adapters getaddrinfo sometimes misses order
    try:
        out = subprocess.check_output(
            ["ipconfig"],
            text=True,
            errors="ignore",
            timeout=6,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        for m in re.finditer(r"IPv4 Address[.\s]*:\s*([\d.]+)", out, re.I):
            add(m.group(1))
    except Exception:
        pass

    return found


def _transfer_lan_urls(handler) -> list:
    host_hdr = ""
    try:
        host_hdr = (handler.headers.get("Host") or "").strip() if handler is not None else ""
    except Exception:
        host_hdr = ""
    port = "8765"
    host = host_hdr.split(":")[0].strip() if host_hdr else ""
    if ":" in host_hdr:
        port = host_hdr.split(":")[-1].strip() or port

    candidates: list[tuple[int, str]] = []

    def add(ip: str, bonus: int = 0):
        ip = str(ip or "").strip()
        if not ip:
            return
        score = _transfer_ip_score(ip) + bonus
        if score < -500:
            return
        u = f"http://{ip}:{port}"
        candidates.append((score, u))

    preferred = _transfer_load_preferred_ip()
    if preferred:
        add(preferred, bonus=500)

    # Prefer Host only when already on a real LAN IP (not VirtualBox / VPN)
    if host and host not in ("localhost", "127.0.0.1", "::1", "0.0.0.0"):
        hscore = _transfer_ip_score(host)
        if hscore >= 80:
            add(host, bonus=200)
        elif hscore >= 0:
            add(host, bonus=20)
        else:
            add(host, bonus=0)

    for ip in _transfer_enumerate_ipv4():
        add(ip, bonus=0)

    # Deduplicate keeping best score
    best: dict[str, int] = {}
    for score, u in candidates:
        best[u] = max(score, best.get(u, -9999))
    ordered = sorted(best.items(), key=lambda kv: (-kv[1], kv[0]))
    urls = [u for u, _s in ordered]
    # Never lead with host-only adapters if a home Wi‑Fi IP exists
    good = [u for u in urls if _transfer_ip_score(urlparse(u).hostname or "") >= 80]
    rest = [u for u in urls if u not in good]
    urls = good + rest
    if not urls:
        urls.append(f"http://127.0.0.1:{port}")
    return urls


def _respond_transfer_status(handler):
    try:
        PHONE_UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
        TRANSFER_TO_PHONE_DIR.mkdir(parents=True, exist_ok=True)
        lan = _transfer_lan_urls(handler)
        preferred = _transfer_load_preferred_ip()
        return handler._json(
            {
                "ok": True,
                "phoneUploadsDir": "phone-uploads",
                "toPhoneDir": "transfer-to-phone",
                "phoneUploadsCount": len(_transfer_list("phone-uploads")),
                "toPhoneCount": len(_transfer_list("to-phone")),
                "lanUrls": lan,
                "preferredLanIp": preferred,
                "bestLanUrl": lan[0] if lan else "",
            }
        )
    except Exception as exc:
        return handler._json({"ok": False, "error": f"status failed: {exc}"}, 500)


def _respond_transfer_prefer_lan(handler):
    """Remember which LAN IP to put in the QR (persists across restarts)."""
    try:
        body = handler._read_json()
    except Exception as exc:
        return handler._json({"ok": False, "error": str(exc)}, 400)
    if not isinstance(body, dict):
        return handler._json({"ok": False, "error": "Invalid JSON"}, 400)
    raw = str(body.get("ip") or body.get("url") or body.get("host") or "").strip()
    if not raw:
        return handler._json({"ok": False, "error": "ip required"}, 400)
    host = raw
    if "://" in raw:
        host = urlparse(raw).hostname or ""
    elif ":" in raw and not raw.count(":") > 1:
        host = raw.split(":")[0]
    if not host or _transfer_ip_score(host) < -500:
        return handler._json({"ok": False, "error": "Invalid or loopback IP"}, 400)
    _transfer_save_preferred_ip(host)
    return handler._json(
        {
            "ok": True,
            "preferredLanIp": host,
            "lanUrls": _transfer_lan_urls(handler),
            "bestLanUrl": ( _transfer_lan_urls(handler) or [""])[0],
        }
    )


def _respond_transfer_list(handler):
    qs = parse_qs(urlparse(handler.path).query or "")
    box = (qs.get("box") or ["phone-uploads"])[0]
    if _transfer_box_dir(box) is None:
        return handler._json({"ok": False, "error": "Unknown box"}, 400)
    items = _transfer_list(box)
    return handler._json({"ok": True, "box": box, "items": items, "count": len(items)})


def _respond_transfer_analyses(handler):
    """Phone-upload descriptions + prompt-weight text."""
    qs = parse_qs(urlparse(handler.path).query or "")
    name = (qs.get("name") or [""])[0].strip()
    with _PHONE_ANALYSES_LOCK:
        data = _load_phone_upload_analyses()
        pending = sorted(_PHONE_ANALYZE_PENDING)
        failed = dict(_PHONE_ANALYZE_FAILED)
    if name:
        key = Path(name).name
        row = data.get(key)
        return handler._json(
            {
                "ok": True,
                "name": key,
                "analysis": row if isinstance(row, dict) else None,
                "analysisStatus": _transfer_analysis_status(key),
                "error": failed.get(key),
            }
        )
    return handler._json(
        {
            "ok": True,
            "analyses": data,
            "count": len(data),
            "pending": pending,
            "failed": failed,
        }
    )


def _transfer_sync_phone_analyses_to_lod1() -> dict:
    """
    Ensure every promoted phone upload has analysis linked to its G# for Spellforge.
    Returns stats: {synced, queued, skipped}.
    """
    stats = {"synced": 0, "queued": 0, "skipped": 0, "items": 0}
    with _PHONE_ANALYSES_LOCK:
        mapping = dict(_load_phone_generated_map())
        analyses = dict(_load_phone_upload_analyses())
    for name, map_row in mapping.items():
        if not isinstance(map_row, dict):
            continue
        try:
            gen_num = int(map_row.get("num"))
        except (TypeError, ValueError):
            stats["skipped"] += 1
            continue
        gen_url = str(map_row.get("url") or f"/generated/{gen_num}.jpg")
        gen_path = (GALLERY / gen_url.lstrip("/\\")).resolve()
        try:
            gen_path.relative_to(GALLERY.resolve())
        except ValueError:
            stats["skipped"] += 1
            continue
        if not gen_path.is_file() or gen_path.stat().st_size < 64:
            stats["skipped"] += 1
            continue
        stats["items"] += 1
        a = analyses.get(name) if isinstance(analyses.get(name), dict) else None
        # Prefer phone analysis; else lod1 if already present
        if not a or not (a.get("description") or a.get("prompt") or a.get("title")):
            try:
                with _lod1_analyses_lock:
                    lod1 = load_lod1_analyses()
                    row = lod1.get(str(gen_num)) if isinstance(lod1, dict) else None
                    if isinstance(row, dict) and (row.get("description") or row.get("title")):
                        a = dict(row)
                        a["name"] = name
                        a["generated_num"] = gen_num
                        a["generated_url"] = gen_url
                        a["kind"] = "phone-upload"
                        with _PHONE_ANALYSES_LOCK:
                            data = _load_phone_upload_analyses()
                            data[name] = a
                            _save_phone_upload_analyses(data)
            except Exception:
                pass
        if a and (a.get("description") or a.get("prompt") or a.get("title")):
            a = dict(a)
            a["generated_num"] = gen_num
            a["generated_url"] = gen_url
            a["name"] = name
            a["kind"] = "phone-upload"
            a["url"] = map_row.get("phone_url") or a.get("url") or ""
            with _PHONE_ANALYSES_LOCK:
                data = _load_phone_upload_analyses()
                data[name] = a
                _save_phone_upload_analyses(data)
            _transfer_write_lod1_analysis(gen_num, a)
            stats["synced"] += 1
        else:
            # Queue vision analysis against real phone or generated file
            phone_path = PHONE_UPLOADS_DIR / name
            path = phone_path if phone_path.is_file() else gen_path
            st = _transfer_queue_phone_analysis(path, name, gen_num)
            if st == "analyzing":
                stats["queued"] += 1
            else:
                stats["skipped"] += 1
    return stats


def _respond_transfer_spell_assets(handler):
    """
    Phone uploads for Spellforge: real image URLs (generated/) + analysis text.
    Call this from the Spellforge client so equip tiles show image + description.
    """
    try:
        sync = _transfer_sync_phone_analyses_to_lod1()
    except Exception as exc:
        sync = {"error": str(exc)}
    items = []
    with _PHONE_ANALYSES_LOCK:
        mapping = dict(_load_phone_generated_map())
        analyses = dict(_load_phone_upload_analyses())
    try:
        with _lod1_analyses_lock:
            lod1 = load_lod1_analyses()
            if not isinstance(lod1, dict):
                lod1 = {}
    except Exception:
        lod1 = {}

    for name, map_row in mapping.items():
        if not isinstance(map_row, dict):
            continue
        try:
            gen_num = int(map_row.get("num"))
        except (TypeError, ValueError):
            continue
        gen_url = str(map_row.get("url") or f"/generated/{gen_num}.jpg")
        gen_path = GALLERY / gen_url.lstrip("/\\")
        if not gen_path.is_file() or gen_path.stat().st_size < 64:
            continue
        a = analyses.get(name) if isinstance(analyses.get(name), dict) else None
        if not a:
            a = lod1.get(str(gen_num)) if isinstance(lod1.get(str(gen_num)), dict) else None
        phone_url = str(map_row.get("phone_url") or f"/phone-uploads/{name}")
        # Prefer generated URL (Spellforge mix) but fall back to phone file
        display_url = gen_url if gen_path.is_file() else phone_url
        title = (a or {}).get("title") or Path(name).stem
        items.append(
            {
                "id": f"phone-g{gen_num}",
                "number": gen_num,
                "name": name,
                "url": display_url,
                "phoneUrl": phone_url,
                "generatedUrl": gen_url,
                "source": "phone-upload",
                "kind": "phone-upload",
                "title": title,
                "label": f"Phone · {title}",
                "analysis": {
                    "title": (a or {}).get("title") or title,
                    "description": (a or {}).get("description") or "",
                    "prompt": (a or {}).get("prompt") or "",
                    "style": (a or {}).get("style") or "",
                    "mood": (a or {}).get("mood") or "",
                    "medium": (a or {}).get("medium") or "",
                    "tags": (a or {}).get("tags") or [],
                    "colors": (a or {}).get("colors") or [],
                    "kind": "phone-upload",
                    "number": gen_num,
                    "name": name,
                    "analyzed_at": (a or {}).get("analyzed_at") or "",
                }
                if a
                else {
                    "title": title,
                    "description": "",
                    "prompt": "",
                    "kind": "phone-upload",
                    "number": gen_num,
                    "name": name,
                },
                "hasAnalysis": bool(
                    a and (a.get("description") or a.get("prompt") or a.get("title"))
                ),
            }
        )
    items.sort(key=lambda it: -(it.get("number") or 0))
    return handler._json(
        {
            "ok": True,
            "items": items,
            "count": len(items),
            "sync": sync,
        }
    )


def _respond_transfer_reanalyze(handler):
    """Re-queue description/prompt analysis for a phone-upload file."""
    try:
        body = handler._read_json()
    except Exception as exc:
        return handler._json({"ok": False, "error": str(exc)}, 400)
    if not isinstance(body, dict):
        return handler._json({"ok": False, "error": "Invalid JSON"}, 400)
    name = Path(str(body.get("name") or "")).name
    if not name:
        return handler._json({"ok": False, "error": "name required"}, 400)
    path = (PHONE_UPLOADS_DIR / name).resolve()
    try:
        path.relative_to(PHONE_UPLOADS_DIR.resolve())
    except ValueError:
        return handler._json({"ok": False, "error": "Invalid path"}, 400)
    if not path.is_file():
        return handler._json({"ok": False, "error": "File not found"}, 404)
    # Force re-run even if already ready
    with _PHONE_ANALYSES_LOCK:
        data = _load_phone_upload_analyses()
        if name in data:
            del data[name]
            _save_phone_upload_analyses(data)
        _PHONE_ANALYZE_PENDING.discard(name)
        _PHONE_ANALYZE_FAILED.pop(name, None)
    status = _transfer_queue_phone_analysis(path, name)
    return handler._json({"ok": True, "name": name, "analysisStatus": status})


def _parse_multipart_simple(body: bytes, content_type: str) -> dict:
    """Minimal multipart parser (Python 3.13+ removed cgi reliability)."""
    out = {"fields": {}, "files": []}
    m = re.search(r"boundary=([^;]+)", content_type or "", re.I)
    if not m or not body:
        return out
    boundary = m.group(1).strip().strip('"').encode("ascii", "ignore")
    if not boundary:
        return out
    parts = body.split(b"--" + boundary)
    for part in parts:
        if not part or part in (b"--\r\n", b"--", b"\r\n", b"--\r\n"):
            continue
        if part.startswith(b"--"):
            continue
        if part.startswith(b"\r\n"):
            part = part[2:]
        if part.endswith(b"\r\n"):
            part = part[:-2]
        if b"\r\n\r\n" not in part:
            continue
        head, data = part.split(b"\r\n\r\n", 1)
        if data.endswith(b"\r\n"):
            data = data[:-2]
        headers = {}
        for line in head.split(b"\r\n"):
            if b":" in line:
                k, v = line.split(b":", 1)
                headers[k.decode("latin-1", "ignore").lower()] = v.decode("latin-1", "ignore").strip()
        disp = headers.get("content-disposition", "")
        name_m = re.search(r'name="([^"]+)"', disp)
        fname_m = re.search(r'filename="([^"]*)"', disp)
        field_name = name_m.group(1) if name_m else ""
        if fname_m is not None:
            out["files"].append(
                {
                    "name": field_name,
                    "filename": fname_m.group(1) or "upload.jpg",
                    "content_type": headers.get("content-type", "application/octet-stream"),
                    "data": data,
                }
            )
        else:
            try:
                out["fields"][field_name] = data.decode("utf-8", "replace")
            except Exception:
                out["fields"][field_name] = ""
    return out


def _transfer_guess_ext(raw: bytes, mime: str, fname: str) -> str:
    """Pick a safe extension for phone uploads (iOS often omits/wrong names)."""
    suf = Path(fname or "").suffix.lower()
    if suf in _TRANSFER_EXTS:
        return suf
    m = (mime or "").lower()
    if "png" in m or raw[:8] == b"\x89PNG\r\n\x1a\n":
        return ".png"
    if "webp" in m or raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        return ".webp"
    if "gif" in m or raw[:6] in (b"GIF87a", b"GIF89a"):
        return ".gif"
    if "mp4" in m or "video" in m or raw[4:8] == b"ftyp":
        return ".mp4"
    if "heic" in m or "heif" in m:
        return ".heic"
    if "jpeg" in m or "jpg" in m or raw[:3] == b"\xff\xd8\xff":
        return ".jpg"
    return ".jpg"


def _respond_transfer_upload(handler):
    """Upload into phone-uploads or to-phone (multipart or JSON base64)."""
    try:
        return _respond_transfer_upload_inner(handler)
    except Exception as exc:
        try:
            return handler._json({"ok": False, "error": f"Upload failed: {exc}"}, 500)
        except Exception:
            return None


def _respond_transfer_upload_inner(handler):
    ctype = (handler.headers.get("Content-Type") or "").lower()
    try:
        length = int(handler.headers.get("Content-Length") or 0)
    except ValueError:
        length = 0
    if length > _TRANSFER_MAX_BYTES + 1024 * 256:
        return handler._json({"ok": False, "error": "File too large (40MB max)"}, 400)

    raw_body = handler.rfile.read(length) if length > 0 else b""
    box = "phone-uploads"
    folder = PHONE_UPLOADS_DIR
    raw = b""
    fname = "upload.jpg"
    mime = ""

    if "multipart/form-data" in ctype:
        parsed = _parse_multipart_simple(raw_body, ctype)
        box = str(parsed["fields"].get("box") or "phone-uploads")
        folder = _transfer_box_dir(box)
        if folder is None:
            return handler._json({"ok": False, "error": "Unknown box"}, 400)
        file_rec = None
        for fr in parsed["files"]:
            if fr.get("name") in ("file", "image", "photo", "upload", "") or fr.get("data"):
                file_rec = fr
                if fr.get("name") in ("file", "image", "photo", "upload"):
                    break
        if not file_rec or not file_rec.get("data"):
            # Fallback: cgi if available
            try:
                import cgi
                import io

                environ = {
                    "REQUEST_METHOD": "POST",
                    "CONTENT_TYPE": handler.headers.get("Content-Type", ""),
                    "CONTENT_LENGTH": str(len(raw_body)),
                }
                form = cgi.FieldStorage(
                    fp=io.BytesIO(raw_body),
                    headers=handler.headers,
                    environ=environ,
                    keep_blank_values=True,
                )
                box = str(form.getvalue("box") or box)
                folder = _transfer_box_dir(box) or folder
                for key in ("file", "image", "photo", "upload"):
                    if key in form and getattr(form[key], "file", None):
                        data = form[key].file.read()
                        fname = getattr(form[key], "filename", None) or "upload.jpg"
                        mime = getattr(form[key], "type", None) or ""
                        file_rec = {"filename": fname, "data": data, "content_type": mime}
                        break
            except Exception:
                pass
        if not file_rec or not file_rec.get("data"):
            return handler._json(
                {"ok": False, "error": "No file in upload (field name should be 'file')"},
                400,
            )
        raw = file_rec["data"]
        fname = file_rec.get("filename") or "upload.jpg"
        mime = (file_rec.get("content_type") or "").lower()
    elif ctype.startswith("image/") or ctype.startswith("video/"):
        box = "phone-uploads"
        folder = PHONE_UPLOADS_DIR
        raw = raw_body
        fname = "upload.bin"
        mime = ctype
    else:
        # JSON base64 (most reliable from mobile browsers)
        try:
            body = json.loads(raw_body.decode("utf-8") if raw_body else "{}")
        except Exception as exc:
            return handler._json({"ok": False, "error": f"Invalid body: {exc}"}, 400)
        if not isinstance(body, dict):
            return handler._json({"ok": False, "error": "Invalid JSON"}, 400)
        box = str(body.get("box") or "phone-uploads")
        folder = _transfer_box_dir(box)
        if folder is None:
            return handler._json({"ok": False, "error": "Unknown box"}, 400)
        b64 = str(body.get("image_base64") or body.get("data") or "").strip()
        fname = str(body.get("name") or body.get("filename") or "upload.jpg")
        if not b64:
            return handler._json({"ok": False, "error": "Provide multipart file or image_base64"}, 400)
        if "," in b64 and b64.startswith("data:"):
            header, b64 = b64.split(",", 1)
            if ":" in header and ";" in header:
                mime = header.split(":", 1)[1].split(";", 1)[0].strip().lower()
        try:
            raw = base64.b64decode(b64, validate=False)
        except Exception:
            return handler._json({"ok": False, "error": "Invalid base64"}, 400)

    if folder is None:
        return handler._json({"ok": False, "error": "Unknown box"}, 400)
    if not raw:
        return handler._json({"ok": False, "error": "Empty file"}, 400)
    if len(raw) > _TRANSFER_MAX_BYTES:
        return handler._json({"ok": False, "error": "File too large (40MB max)"}, 400)

    # Ensure filename has a real extension
    stem = Path(_transfer_safe_name(fname)).stem or "upload"
    ext = _transfer_guess_ext(raw, mime, fname)
    dest = _transfer_unique_path(folder, stem + ext)
    with _TRANSFER_LOCK:
        folder.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(raw)
    rel = dest.relative_to(GALLERY).as_posix()
    analysis_status = "skipped"
    generated_info = None
    # Phone uploads: enter generator mix (generated/) + AI description / prompt weights
    box_norm = str(box or "").strip().lower().replace("_", "-")
    if box_norm in ("phone-uploads", "from-phone", "uploads", "phone") and ext in _TRANSFER_IMAGE_EXTS:
        generated_info = _transfer_promote_to_generated(dest, dest.name)
        gen_num = None
        if generated_info and generated_info.get("num") is not None:
            try:
                gen_num = int(generated_info["num"])
            except (TypeError, ValueError):
                gen_num = None
        analysis_status = _transfer_queue_phone_analysis(dest, dest.name, gen_num)
    payload = {
        "ok": True,
        "name": dest.name,
        "url": "/" + rel,
        "box": box,
        "size": len(raw),
        "analysisStatus": analysis_status,
        "analysisQueued": analysis_status == "analyzing",
    }
    if generated_info:
        payload["generated"] = generated_info
        payload["generatedNum"] = generated_info.get("num")
        payload["generatedUrl"] = generated_info.get("url")
        payload["inGeneratorMix"] = True
    return handler._json(payload)


def _transfer_scan_image_folder(folder: Path, url_prefix: str, collection: str, limit: int = 500) -> list:
    """Scan a gallery folder of images for Transfer browse grid."""
    items = []
    if not folder.is_dir():
        return items
    exts = _TRANSFER_IMAGE_EXTS | _TRANSFER_VIDEO_EXTS
    files = []
    try:
        for p in folder.iterdir():
            if not p.is_file():
                continue
            if p.suffix.lower() not in exts:
                continue
            files.append(p)
    except OSError:
        return items

    def sort_key(p: Path):
        try:
            return (0, int(p.stem))
        except ValueError:
            return (1, p.stem.lower())

    # Newest first for generated/uploads; numeric for paintings
    if collection in ("paintings",):
        files.sort(key=sort_key)
    else:
        files.sort(key=lambda p: p.stat().st_mtime if p.is_file() else 0, reverse=True)

    for p in files[:limit]:
        try:
            rel = p.relative_to(GALLERY).as_posix()
            url = "/" + rel
        except Exception:
            url = f"{url_prefix.rstrip('/')}/{p.name}"
            if not url.startswith("/"):
                url = "/" + url
        title = p.stem
        try:
            n = int(p.stem)
            title = f"#{n}" if collection == "paintings" else f"G#{n}"
        except ValueError:
            title = p.name
        items.append(
            {
                "id": f"{collection}/{p.name}",
                "title": title,
                "url": url,
                "collection": collection,
                "name": p.name,
                "kind": "video" if p.suffix.lower() in _TRANSFER_VIDEO_EXTS else "image",
            }
        )
    return items


def _respond_transfer_catalog(handler):
    """Gallery-style catalog for bulk select + download on phone."""
    try:
        qs = parse_qs(urlparse(handler.path).query or "")
        coll = str((qs.get("collection") or ["paintings"])[0]).lower()
        items = []
        if coll in ("phone-uploads", "to-phone", "transfer-to-phone"):
            box = "to-phone" if coll in ("to-phone", "transfer-to-phone") else "phone-uploads"
            for it in _transfer_list(box):
                row = {
                    "id": f"{box}/{it['name']}",
                    "title": it.get("title") or it["name"],
                    "url": it["url"],
                    "collection": box,
                    "name": it["name"],
                    "kind": it.get("kind") or "image",
                }
                if it.get("description"):
                    row["description"] = it["description"]
                if it.get("prompt"):
                    row["prompt"] = it["prompt"]
                if it.get("analysis"):
                    row["analysis"] = it["analysis"]
                if it.get("analysisStatus"):
                    row["analysisStatus"] = it["analysisStatus"]
                items.append(row)
        elif coll in ("videos", "saved-videos"):
            try:
                vids = scan_saved_videos() if "scan_saved_videos" in globals() else []
            except Exception:
                vids = []
            if not vids:
                # Fallback: scan folder
                items = _transfer_scan_image_folder(
                    GALLERY / "saved-videos", "/saved-videos", "videos", limit=300
                )
            else:
                for v in vids[:300]:
                    url = v.get("url") or (f"/saved-videos/{v.get('name')}" if v.get("name") else "")
                    if not url:
                        continue
                    items.append(
                        {
                            "id": url,
                            "title": v.get("name") or url,
                            "url": url if str(url).startswith("/") else "/" + str(url).lstrip("/"),
                            "collection": "videos",
                            "name": v.get("name") or Path(str(url)).name,
                            "kind": "video",
                        }
                    )
        elif coll in ("paintings", "painting", "main"):
            items = _transfer_scan_image_folder(PAINTINGS_DIR, "/paintings", "paintings", limit=600)
        elif coll in ("generated", "lod1"):
            items = _transfer_scan_image_folder(GALLERY / "generated", "/generated", "generated", limit=500)
            # Also try gallery_assets if folder empty
            if not items:
                try:
                    payload = gallery_assets_payload("generated")
                    for it in (payload.get("items") or [])[:400]:
                        url = it.get("url") or ""
                        if not url:
                            continue
                        if not str(url).startswith("/"):
                            url = "/" + str(url).lstrip("/")
                        items.append(
                            {
                                "id": str(it.get("id") or url),
                                "title": it.get("title") or it.get("name") or "",
                                "url": url,
                                "collection": "generated",
                                "name": Path(urlparse(url).path).name,
                                "kind": "image",
                            }
                        )
                except Exception:
                    pass
        else:
            # unknown / all — paintings + a bit of each box
            items = _transfer_scan_image_folder(PAINTINGS_DIR, "/paintings", "paintings", limit=200)
            items.extend(
                _transfer_scan_image_folder(GALLERY / "generated", "/generated", "generated", limit=100)
            )
            for box in ("to-phone", "phone-uploads"):
                for it in _transfer_list(box)[:80]:
                    items.append(
                        {
                            "id": f"{box}/{it['name']}",
                            "title": it["name"],
                            "url": it["url"],
                            "collection": box,
                            "name": it["name"],
                            "kind": it.get("kind") or "image",
                        }
                    )
        return handler._json({"ok": True, "collection": coll, "items": items, "count": len(items)})
    except Exception as exc:
        return handler._json({"ok": False, "error": str(exc), "items": []}, 500)


def _respond_transfer_zip(handler):
    """Zip selected gallery/transfer files for bulk phone download."""
    import io
    import zipfile

    try:
        body = handler._read_json()
    except Exception as exc:
        return handler._json({"ok": False, "error": str(exc)}, 400)
    if not isinstance(body, dict):
        return handler._json({"ok": False, "error": "Invalid JSON"}, 400)
    urls = body.get("urls") or body.get("paths") or []
    if not isinstance(urls, list) or not urls:
        return handler._json({"ok": False, "error": "urls array required"}, 400)
    buf = io.BytesIO()
    added = 0
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for i, url in enumerate(urls[:80]):
            path_part = urlparse(str(url)).path if "://" in str(url) else str(url)
            path_part = path_part.split("?")[0]
            local = (GALLERY / path_part.lstrip("/\\")).resolve()
            try:
                local.relative_to(GALLERY.resolve())
            except ValueError:
                continue
            if not local.is_file():
                continue
            arc = f"{i+1:02d}_{local.name}"
            try:
                zf.write(local, arcname=arc)
                added += 1
            except Exception:
                continue
    if added < 1:
        return handler._json({"ok": False, "error": "No readable files to zip"}, 404)
    data = buf.getvalue()
    handler.send_response(200)
    handler.send_header("Content-Type", "application/zip")
    handler.send_header("Content-Length", str(len(data)))
    handler.send_header("Content-Disposition", 'attachment; filename="gallery-transfer.zip"')
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    handler.wfile.write(data)
    return None


def _respond_transfer_stage(handler):
    """Copy a gallery-relative path or fetch URL into transfer-to-phone."""
    try:
        body = handler._read_json()
    except Exception as exc:
        return handler._json({"ok": False, "error": str(exc)}, 400)
    if not isinstance(body, dict):
        return handler._json({"ok": False, "error": "Invalid JSON"}, 400)
    box = str(body.get("box") or "to-phone")
    folder = _transfer_box_dir(box)
    if folder is None:
        return handler._json({"ok": False, "error": "Unknown box"}, 400)
    url = str(body.get("url") or body.get("path") or "").strip()
    if not url:
        return handler._json({"ok": False, "error": "url required"}, 400)
    raw = None
    name = str(body.get("name") or Path(urlparse(url).path).name or "staged.jpg")
    # Local gallery path
    path_part = urlparse(url).path if "://" in url else url
    if path_part.startswith("/"):
        local = (GALLERY / path_part.lstrip("/")).resolve()
        try:
            local.relative_to(GALLERY.resolve())
            if local.is_file():
                raw = local.read_bytes()
                name = local.name
        except (ValueError, OSError):
            pass
    if raw is None and path_part and not path_part.startswith("http"):
        local = (GALLERY / path_part.lstrip("/\\")).resolve()
        try:
            local.relative_to(GALLERY.resolve())
            if local.is_file():
                raw = local.read_bytes()
                name = local.name
        except (ValueError, OSError):
            pass
    if raw is None and url.startswith("data:"):
        try:
            header, b64 = url.split(",", 1)
            raw = base64.b64decode(b64, validate=False)
        except Exception:
            return handler._json({"ok": False, "error": "Invalid data URL"}, 400)
    if raw is None and urlparse(url).scheme in ("http", "https"):
        try:
            with httpx.Client(timeout=60.0, follow_redirects=True) as client:
                r = client.get(url, headers={"User-Agent": "GalleryTransfer/1.0"})
                if r.status_code == 200 and r.content:
                    raw = r.content
        except Exception as exc:
            return handler._json({"ok": False, "error": f"Fetch failed: {exc}"}, 502)
    if not raw:
        return handler._json({"ok": False, "error": "Could not load source file"}, 404)
    if len(raw) > _TRANSFER_MAX_BYTES:
        return handler._json({"ok": False, "error": "File too large (40MB max)"}, 400)
    dest = _transfer_unique_path(folder, name)
    if dest.suffix.lower() not in _TRANSFER_EXTS:
        dest = dest.with_suffix(".jpg")
    with _TRANSFER_LOCK:
        dest.write_bytes(raw)
    rel = dest.relative_to(GALLERY).as_posix()
    return handler._json({"ok": True, "name": dest.name, "url": "/" + rel, "box": box})


def _respond_transfer_delete(handler):
    qs = parse_qs(urlparse(handler.path).query or "")
    box = (qs.get("box") or [""])[0]
    name = (qs.get("name") or [""])[0]
    folder = _transfer_box_dir(box)
    if folder is None:
        return handler._json({"ok": False, "error": "Unknown box"}, 400)
    safe = _transfer_safe_name(name)
    path = (folder / safe).resolve()
    try:
        path.relative_to(folder.resolve())
    except ValueError:
        return handler._json({"ok": False, "error": "Invalid path"}, 400)
    if not path.is_file():
        return handler._json({"ok": False, "error": "Not found"}, 404)
    try:
        path.unlink()
    except OSError as exc:
        return handler._json({"ok": False, "error": str(exc)}, 500)
    return handler._json({"ok": True, "deleted": safe})


_orig_app_handler_do_get_transfer = AppHandler.do_GET


def _app_handler_do_get_with_transfer(self):
    path = _normalize_api_path(urlparse(self.path).path)
    if path in ("/api/transfer/status", "/api/transfer/status/"):
        return _respond_transfer_status(self)
    if path in ("/api/transfer/list", "/api/transfer/list/"):
        return _respond_transfer_list(self)
    if path in ("/api/transfer/catalog", "/api/transfer/catalog/"):
        return _respond_transfer_catalog(self)
    if path in ("/api/transfer/analyses", "/api/transfer/analyses/"):
        return _respond_transfer_analyses(self)
    if path in ("/api/transfer/spell-assets", "/api/transfer/spell-assets/"):
        return _respond_transfer_spell_assets(self)
    return _orig_app_handler_do_get_transfer(self)


AppHandler.do_GET = _app_handler_do_get_with_transfer

_orig_app_handler_do_post_transfer = AppHandler.do_POST


def _app_handler_do_post_with_transfer(self):
    path = _normalize_api_path(urlparse(self.path).path)
    if path in ("/api/transfer/upload", "/api/transfer/upload/"):
        return _respond_transfer_upload(self)
    if path in ("/api/transfer/stage", "/api/transfer/stage/"):
        return _respond_transfer_stage(self)
    if path in ("/api/transfer/zip", "/api/transfer/zip/"):
        return _respond_transfer_zip(self)
    if path in ("/api/transfer/prefer-lan", "/api/transfer/prefer-lan/"):
        return _respond_transfer_prefer_lan(self)
    if path in ("/api/transfer/reanalyze", "/api/transfer/reanalyze/"):
        return _respond_transfer_reanalyze(self)
    return _orig_app_handler_do_post_transfer(self)


AppHandler.do_POST = _app_handler_do_post_with_transfer

# DELETE for transfer files (some SimpleHTTP stacks only have do_GET/POST)
_orig_app_handler_do_delete = getattr(AppHandler, "do_DELETE", None)


def _app_handler_do_delete_with_transfer(self):
    path = _normalize_api_path(urlparse(self.path).path)
    if path in ("/api/transfer/file", "/api/transfer/file/"):
        return _respond_transfer_delete(self)
    if _orig_app_handler_do_delete:
        return _orig_app_handler_do_delete(self)
    self.send_error(501, "Unsupported method ('DELETE')")
    return None


AppHandler.do_DELETE = _app_handler_do_delete_with_transfer

# Expose phone-uploads in acquired-images (Conceptualizer / Animate / Movie / etc.)
try:
    _orig_resolve_acquired_folder_phone = resolve_acquired_folder

    def resolve_acquired_folder(folder_id):  # noqa: F811 — override bytecode helper
        fid = str(folder_id or "").strip().lower().replace("_", "-")
        if fid in ("phone-uploads", "phone", "from-phone", "uploads"):
            PHONE_UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
            return PHONE_UPLOADS_DIR
        return _orig_resolve_acquired_folder_phone(folder_id)

    globals()["resolve_acquired_folder"] = resolve_acquired_folder

    _orig_acquired_folder_index_phone = acquired_folder_index

    def acquired_folder_index():  # noqa: F811
        idx = _orig_acquired_folder_index_phone()
        if not isinstance(idx, dict):
            idx = {"folders": []}
        folders = list(idx.get("folders") or [])
        if not any(
            str(f.get("id") or "").lower().replace("_", "-")
            in ("phone-uploads", "phone", "from-phone")
            for f in folders
            if isinstance(f, dict)
        ):
            folders.append(
                {
                    "id": "phone-uploads",
                    "label": "Phone uploads · gallery/phone-uploads (+ Generated mix)",
                    "path": "phone-uploads",
                }
            )
        idx["folders"] = folders
        return idx

    globals()["acquired_folder_index"] = acquired_folder_index
except Exception as _acq_phone_err:
    print(f"[gallery] Transfer acquired-folder hook: {_acq_phone_err}", flush=True)

try:
    PHONE_UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    TRANSFER_TO_PHONE_DIR.mkdir(parents=True, exist_ok=True)
    print(
        "[gallery] Transfer: /api/transfer/*  (phone-uploads → generated mix + analyses)",
        flush=True,
    )
    # Link existing phone analyses into lod1 so Spellforge can read them
    try:
        _sync_stats = _transfer_sync_phone_analyses_to_lod1()
        print(
            f"[gallery] Transfer spell sync: {_sync_stats.get('synced', 0)} analyses → "
            f"lod1, {_sync_stats.get('queued', 0)} queued",
            flush=True,
        )
    except Exception as _sync_err:
        print(f"[gallery] Transfer spell sync: {_sync_err}", flush=True)
except Exception as _tf_err:
    print(f"[gallery] Transfer bootstrap: {_tf_err}", flush=True)


# --- Fight: characters, maps, costume stills, LAN lobby ---
FIGHT_DIR = GALLERY / "fight-chars"
FIGHT_CHARS_PATH = GALLERY / "data" / "fight-characters.json"
FIGHT_MAPS_PATH = GALLERY / "data" / "fight-maps.json"
FIGHT_LIVE_PATH = GALLERY / "data" / "fight-live.json"
_FIGHT_LOCK = threading.RLock()


def _fight_load_json(path: Path, default):
    if not path.is_file():
        return default
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if data is not None else default
    except (OSError, json.JSONDecodeError):
        return default


def _fight_save_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    tmp.replace(path)


def _respond_fight_live_get(handler):
    with _FIGHT_LOCK:
        data = _fight_load_json(FIGHT_LIVE_PATH, {"players": [], "updated": 0})
    now = time.time()
    players = []
    for p in data.get("players") or []:
        if not isinstance(p, dict):
            continue
        if now - float(p.get("seen") or 0) > 20:
            continue
        players.append(p)
    return handler._json({"ok": True, "players": players, "count": len(players)})


def _respond_fight_live_post(handler):
    try:
        body = handler._read_json()
    except Exception as exc:
        return handler._json({"ok": False, "error": str(exc)}, 400)
    if not isinstance(body, dict):
        return handler._json({"ok": False, "error": "Invalid JSON"}, 400)
    pid = str(body.get("playerId") or uuid.uuid4().hex)[:48]
    name = str(body.get("name") or "Player")[:32]
    action = str(body.get("action") or "presence").lower()
    with _FIGHT_LOCK:
        data = _fight_load_json(FIGHT_LIVE_PATH, {"players": [], "updated": 0})
        players = [p for p in (data.get("players") or []) if isinstance(p, dict)]
        now = time.time()
        players = [p for p in players if now - float(p.get("seen") or 0) < 20]
        found = None
        for p in players:
            if p.get("playerId") == pid:
                found = p
                break
        row = {
            "playerId": pid,
            "name": name,
            "fighterId": str(body.get("fighterId") or "")[:48],
            "imgUrl": str(body.get("imgUrl") or "")[:300],
            "seen": now,
            "host": action == "host" or bool((found or {}).get("host")),
        }
        if action == "host":
            for p in players:
                p["host"] = False
            row["host"] = True
        if found:
            found.update(row)
        else:
            if len(players) >= 4:
                return handler._json({"ok": False, "error": "Lobby full (4)"}, 400)
            players.append(row)
        data = {"players": players, "updated": now}
        _fight_save_json(FIGHT_LIVE_PATH, data)
    return handler._json({"ok": True, "players": players, "count": len(players), "playerId": pid})


def _respond_fight_maps_get(handler):
    data = _fight_load_json(FIGHT_MAPS_PATH, {"maps": []})
    maps = data.get("maps") if isinstance(data, dict) else []
    return handler._json({"ok": True, "maps": maps if isinstance(maps, list) else []})


def _respond_fight_maps_post(handler):
    try:
        body = handler._read_json()
    except Exception as exc:
        return handler._json({"ok": False, "error": str(exc)}, 400)
    if not isinstance(body, dict):
        return handler._json({"ok": False, "error": "Invalid JSON"}, 400)
    mid = str(body.get("id") or uuid.uuid4().hex[:10])
    name = str(body.get("name") or "Map")[:48]
    plats = body.get("platforms") or []
    clean = []
    if isinstance(plats, list):
        for p in plats[:40]:
            if not isinstance(p, dict):
                continue
            try:
                clean.append(
                    {
                        "x": float(p.get("x") or 0),
                        "y": float(p.get("y") or 0),
                        "w": float(p.get("w") or 100),
                        "h": float(p.get("h") or 20),
                    }
                )
            except (TypeError, ValueError):
                continue
    row = {"id": mid, "name": name, "platforms": clean, "bg": body.get("bg") or {}}
    with _FIGHT_LOCK:
        data = _fight_load_json(FIGHT_MAPS_PATH, {"maps": []})
        maps = list(data.get("maps") or [])
        maps = [m for m in maps if isinstance(m, dict) and m.get("id") != mid]
        maps.append(row)
        data = {"maps": maps[-40:]}
        _fight_save_json(FIGHT_MAPS_PATH, data)
    return handler._json({"ok": True, "map": row})


def _respond_fight_character(handler):
    try:
        body = handler._read_json()
    except Exception as exc:
        return handler._json({"ok": False, "error": str(exc)}, 400)
    if not isinstance(body, dict):
        return handler._json({"ok": False, "error": "Invalid JSON"}, 400)
    name = str(body.get("name") or "Fighter")[:32]
    b64 = str(body.get("image_base64") or body.get("data") or "").strip()
    if not b64:
        return handler._json({"ok": False, "error": "image_base64 required"}, 400)
    if "," in b64 and b64.startswith("data:"):
        b64 = b64.split(",", 1)[1]
    try:
        raw = base64.b64decode(b64, validate=False)
    except Exception:
        return handler._json({"ok": False, "error": "Invalid base64"}, 400)
    if not raw or len(raw) > 12 * 1024 * 1024:
        return handler._json({"ok": False, "error": "Image empty or too large"}, 400)
    FIGHT_DIR.mkdir(parents=True, exist_ok=True)
    cid = uuid.uuid4().hex[:12]
    ext = ".jpg"
    if raw[:8] == b"\x89PNG\r\n\x1a\n":
        ext = ".png"
    elif raw[:4] == b"RIFF":
        ext = ".webp"
    fname = f"{cid}{ext}"
    dest = FIGHT_DIR / fname
    dest.write_bytes(raw)
    rel = f"/fight-chars/{fname}"
    row = {
        "id": cid,
        "name": name,
        "url": rel,
        "costume": str(body.get("costume") or "")[:500],
        "saved_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    with _FIGHT_LOCK:
        data = _fight_load_json(FIGHT_CHARS_PATH, {"characters": []})
        chars = list(data.get("characters") or [])
        chars.insert(0, row)
        data = {"characters": chars[:80]}
        _fight_save_json(FIGHT_CHARS_PATH, data)
    return handler._json({"ok": True, **row})


def _respond_fight_costume(handler):
    """
    Queue a fighter centerfold still via the same path as Ideal (stasis vision job).
    Client should poll /api/jobs/{id}. Prompt-first; reference image optional.
    """
    try:
        body = handler._read_json()
    except Exception as exc:
        return handler._json({"ok": False, "error": str(exc)}, 400)
    if not isinstance(body, dict):
        return handler._json({"ok": False, "error": "Invalid JSON"}, 400)
    prompt = str(body.get("prompt") or body.get("costume") or "").strip()
    if not prompt:
        return handler._json({"ok": False, "error": "prompt required"}, 400)
    name = str(body.get("name") or "").strip()[:48]
    job_id = str(body.get("job_id") or uuid.uuid4().hex)
    stasis = (
        "FIGHTING-GAME CHARACTER CENTERFOLD STILL. "
        "One potential arena fighter is the sole centerfold subject — full body preferred, "
        "standing fighting stance, clearly centered in frame, readable silhouette for a 2D fighter. "
        + (f"Identity vibe: {name}. " if name else "")
        + f"Costume / look: {prompt[:700]}. "
        "Dramatic lighting, bold colors, no text, no watermark, no crowd, single character only."
    )
    job_body = {
        "stasis": stasis,
        "prompt": f"Game-ready fighter centerfold still, {prompt[:400]}",
        "buzz_words": ["fighter", "centerfold", "full body", "fighting stance", "clear silhouette"],
        "spells": [],
        "mag_fresh": True,
        "spell_cast": False,
        "fresh_variation": True,
        "aspect_ratio": str(body.get("aspect_ratio") or "3:4"),
    }
    # Fire async if the job runner exists; client polls
    try:
        if callable(globals().get("run_stasis_vision_job")):
            t = threading.Thread(
                target=run_stasis_vision_job,
                args=(job_id, job_body),
                name=f"fight-costume-{job_id[:8]}",
                daemon=True,
            )
            t.start()
            return handler._json({"ok": True, "job_id": job_id, "status": "pending", "queued": True})
    except Exception as exc:
        return handler._json({"ok": False, "error": f"Could not queue fighter still: {exc}"}, 502)
    return handler._json(
        {
            "ok": False,
            "error": "Image generate pipeline not available — open Ideal tab or check xAI key",
        },
        503,
    )


_orig_app_handler_do_get_fight = AppHandler.do_GET


def _app_handler_do_get_with_fight(self):
    path = _normalize_api_path(urlparse(self.path).path)
    if path in ("/api/fight/live", "/api/fight/live/"):
        return _respond_fight_live_get(self)
    if path in ("/api/fight/maps", "/api/fight/maps/"):
        return _respond_fight_maps_get(self)
    return _orig_app_handler_do_get_fight(self)


AppHandler.do_GET = _app_handler_do_get_with_fight

_orig_app_handler_do_post_fight = AppHandler.do_POST


def _app_handler_do_post_with_fight(self):
    path = _normalize_api_path(urlparse(self.path).path)
    if path in ("/api/fight/live", "/api/fight/live/"):
        return _respond_fight_live_post(self)
    if path in ("/api/fight/maps", "/api/fight/maps/"):
        return _respond_fight_maps_post(self)
    if path in ("/api/fight/character", "/api/fight/character/"):
        return _respond_fight_character(self)
    if path in ("/api/fight/costume", "/api/fight/costume/"):
        return _respond_fight_costume(self)
    return _orig_app_handler_do_post_fight(self)


AppHandler.do_POST = _app_handler_do_post_with_fight

try:
    FIGHT_DIR.mkdir(parents=True, exist_ok=True)
    print("[gallery] Fight: /api/fight/*  (chars, maps, costume, LAN lobby)", flush=True)
except Exception as _ft_err:
    print(f"[gallery] Fight bootstrap: {_ft_err}", flush=True)


# --- Generation prompt hard cap (xAI max 8000 chars on FINAL prompt) ---
GEN_PROMPT_MAX_CHARS = 8000
# Leave room for "Create one original… / BUZZ WORDS…" framing around stasis body
GEN_STASIS_BODY_MAX = 7200


def _cap_prompt_chars(text, max_chars=None):
    """Fit prompt under max_chars (Unicode length), preferring newline/word breaks."""
    if max_chars is None:
        max_chars = GEN_PROMPT_MAX_CHARS
    try:
        max_chars = int(max_chars)
    except (TypeError, ValueError):
        max_chars = GEN_PROMPT_MAX_CHARS
    s = str(text or "").strip()
    if not s:
        return s
    # Also respect UTF-8 byte budget (some gateways count bytes)
    def too_long(t: str) -> bool:
        if len(t) > max_chars:
            return True
        try:
            return len(t.encode("utf-8")) > max_chars
        except Exception:
            return False

    if not too_long(s):
        return s
    # Binary-search a safe cut, then snap to newline/word
    lo, hi = 0, len(s)
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if too_long(s[:mid] + "…"):
            hi = mid - 1
        else:
            lo = mid
    cut = s[: max(0, lo)]
    nl = cut.rfind("\n")
    if nl > len(cut) * 0.55:
        cut = cut[:nl]
    else:
        sp = cut.rfind(" ")
        if sp > len(cut) * 0.7:
            cut = cut[:sp]
    out = cut.rstrip() + "…"
    # Final guarantee
    while too_long(out) and len(out) > 2:
        out = out[:-2] + "…"
    return out


_orig_build_stasis_vision_prompt = globals().get("build_stasis_vision_prompt")


def build_stasis_vision_prompt(*args, **kwargs):
    """Bytecode builder + hard ≤8000 cap so xAI never rejects the prompt."""
    # Pre-clamp stasis body (arg 0) so framing cannot push over the limit
    if args:
        args = list(args)
        if args[0] is not None:
            args[0] = _cap_prompt_chars(str(args[0]), GEN_STASIS_BODY_MAX)
        args = tuple(args)
    if kwargs.get("stasis") is not None:
        kwargs = dict(kwargs)
        kwargs["stasis"] = _cap_prompt_chars(
            str(kwargs.get("stasis") or ""), GEN_STASIS_BODY_MAX
        )

    if callable(_orig_build_stasis_vision_prompt):
        prompt = _orig_build_stasis_vision_prompt(*args, **kwargs)
    else:
        stasis = str(args[0] if args else kwargs.get("stasis") or "")
        buzz = args[1] if len(args) > 1 else kwargs.get("buzz_words")
        if isinstance(buzz, str):
            buzz = [b.strip() for b in buzz.split(",") if b.strip()]
        buzz_s = ", ".join(list(buzz or [])[:16]) or "rich painterly detail"
        prompt = (
            "Create one original fine-art painting that embodies this fused vision. "
            "Invent fresh imagery — not a photograph or collage of references.\n\n"
            "STASIS (locked fusion — the scene, mood, and narrative to paint):\n"
            f"{stasis.strip()}\n\n"
            f"BUZZ WORDS (weave these into texture, motifs, palette accents, and micro-detail): {buzz_s}\n\n"
            "The image should read clearly at thumbnail scale yet reward close viewing. "
            "Museum-quality, cohesive composition, expressive brushwork, 16:9 landscape."
        )
    # Stay a few chars under 8000 — xAI rejects anything over the max
    return _cap_prompt_chars(prompt, GEN_PROMPT_MAX_CHARS - 8)


globals()["build_stasis_vision_prompt"] = build_stasis_vision_prompt
globals()["GEN_PROMPT_MAX_CHARS"] = GEN_PROMPT_MAX_CHARS
globals()["GEN_STASIS_BODY_MAX"] = GEN_STASIS_BODY_MAX
globals()["_cap_prompt_chars"] = _cap_prompt_chars

# Clamp stasis fields before the job thread runs (covers all studio modes)
_orig_run_stasis_vision_job = globals().get("run_stasis_vision_job")


def run_stasis_vision_job(job_id, body, *rest, **kwargs):
    body = dict(body or {})
    for key in (
        "stasis",
        "prompt",
        "fused_prompt",
        "craft_hints",
        "image_to_life_prompt",
    ):
        if isinstance(body.get(key), str) and body[key].strip():
            body[key] = _cap_prompt_chars(body[key], GEN_STASIS_BODY_MAX)
    buzz = body.get("buzz_words") or body.get("tags")
    if isinstance(buzz, list) and len(buzz) > 16:
        body["buzz_words"] = buzz[:16]
    if not callable(_orig_run_stasis_vision_job):
        raise RuntimeError("run_stasis_vision_job not available")
    if rest or kwargs:
        return _orig_run_stasis_vision_job(job_id, body, *rest, **kwargs)
    return _orig_run_stasis_vision_job(job_id, body)


if callable(_orig_run_stasis_vision_job):
    globals()["run_stasis_vision_job"] = run_stasis_vision_job

_orig_truncate_prompt_text = globals().get("_truncate_prompt_text")


def _truncate_prompt_text(text, max_chars=None, *rest, **kwargs):
    if max_chars is None:
        max_chars = GEN_PROMPT_MAX_CHARS - 8
    if callable(_orig_truncate_prompt_text):
        try:
            return _cap_prompt_chars(
                _orig_truncate_prompt_text(text, max_chars, *rest, **kwargs),
                max_chars,
            )
        except TypeError:
            try:
                return _cap_prompt_chars(
                    _orig_truncate_prompt_text(text, max_chars), max_chars
                )
            except TypeError:
                return _cap_prompt_chars(
                    _orig_truncate_prompt_text(text), max_chars
                )
    return _cap_prompt_chars(text, max_chars)


if _orig_truncate_prompt_text is not None:
    globals()["_truncate_prompt_text"] = _truncate_prompt_text

print(
    f"[gallery] Prompt caps: body≤{GEN_STASIS_BODY_MAX}, final≤{GEN_PROMPT_MAX_CHARS} (xAI)",
    flush=True,
)


def main():
    """
    Cloud-safe entrypoint (Render/Railway/etc.):
    - Bind 0.0.0.0 and honor $PORT
    - Serve static files from gallery root (index.html, paintings/, js/, …)
    """
    global PORT
    gallery_root = Path(globals().get("GALLERY") or Path(__file__).resolve().parent.parent)
    if not (gallery_root / "index.html").is_file():
        raise SystemExit(
            f"[gallery] index.html not found under {gallery_root} — "
            "is the start command run from the repo root?"
        )
    pyc = Path(__file__).resolve().parent / "__pycache__" / "app_server_impl.cpython-314.pyc"
    if not pyc.is_file():
        # also accept any app_server_impl*.pyc
        alts = list((Path(__file__).resolve().parent / "__pycache__").glob("app_server_impl*.pyc"))
        if not alts:
            raise SystemExit(
                "[gallery] Missing scripts/__pycache__/app_server_impl*.pyc — "
                "this file is required to run the API. Commit it to GitHub "
                "(see .gitignore exceptions) and redeploy."
            )

    try:
        PORT = int(os.environ.get("PORT") or os.environ.get("GALLERY_PORT") or PORT or 8765)
    except (TypeError, ValueError):
        PORT = 8765
    globals()["PORT"] = PORT

    # Serve HTML/JS/paintings from gallery root, not scripts/
    os.chdir(gallery_root)
    print(f"[gallery] cwd={os.getcwd()}  PORT={PORT}  GALLERY={gallery_root}", flush=True)

    # Prefer explicit 0.0.0.0 so cloud load balancers can reach us
    server_cls = globals().get("ThreadedTCPServer")
    handler = globals().get("AppHandler")
    if server_cls is None or handler is None:
        raise SystemExit("[gallery] Server classes not loaded — bytecode bootstrap failed.")

    # Allow address reuse on quick restarts
    try:
        server_cls.allow_reuse_address = True
    except Exception:
        pass

    httpd = server_cls(("0.0.0.0", PORT), handler)
    print_fn = globals().get("print_startup_urls")
    if callable(print_fn):
        try:
            print_fn()
        except Exception as e:
            print(f"[gallery] startup urls: {e}", flush=True)
    print(f"[gallery] Listening on http://0.0.0.0:{PORT}/  (cloud-ready)", flush=True)
    print("Press Ctrl+C to stop.", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.", flush=True)


globals()["main"] = main


if __name__ == "__main__":
    main()