import { getStore } from "@netlify/blobs";
import { jsonResponse, corsPreflight } from "./_lib.mjs";
import { cleanName, cleanPrompt, isPid, pidOf, usersOf } from "./_online.mjs";

// One shared still for every open console. Presence (tab-presence / "presence")
// already heartbeats each viewport; this store only keeps the latest still.
const STORE = "server-window";
const IMAGE_KEY = "last-image";
const META_KEY = "last-meta";
const PRESENCE_STORE = "tab-presence";
const PRESENCE_KEY = "presence";
const PRESENCE_TTL_MS = 25000;
const SID_RE = /^[A-Za-z0-9._-]{8,80}$/;
// 670KB binary is ~893KB of base64, under the 900KB D1 chunk in blobs-d1.mjs.
const MAX_IMAGE_BYTES = 670000;
// Per-visitor last still (online-users.js "View last generated" / "Spell 1-3").
// One index record plus one image per visitor, capped; the oldest are dropped.
const USER_INDEX_KEY = "user-index";
const USER_IMAGE_PREFIX = "user/";
const USER_MAX = 40;

function noStore(body, status = 200) {
  const res = jsonResponse(body, status);
  const headers = new Headers(res.headers);
  headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  return new Response(res.body, { status: res.status, headers });
}

function cleanTab(raw) {
  const tab = String(raw || "")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 40);
  return tab || "gallery";
}

function b64ToBytes(b64) {
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(b64, "base64"));
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function decodeImage(input) {
  const s = String(input || "").trim();
  const m = s.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!m) return null;
  const b64 = m[2].replace(/\s/g, "");
  if (!b64 || b64.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 8) return null;
  let bytes;
  try {
    bytes = b64ToBytes(b64);
  } catch (e) {
    return null;
  }
  if (!bytes || bytes.length < 16 || bytes.length > MAX_IMAGE_BYTES) return null;
  const type = m[1].toLowerCase();
  if (type === "image/jpeg" && !(bytes[0] === 0xff && bytes[1] === 0xd8)) return null;
  if (type === "image/png" && bytes[0] !== 0x89) return null;
  if (type === "image/webp") {
    const tag = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
    if (tag !== "RIFF") return null;
  }
  return { bytes, type };
}

function cleanRemote(raw) {
  const s = String(raw || "").trim();
  if (!/^https:\/\//i.test(s) || s.length > 2000) return "";
  if (/^https:\/\/[^/\s]+\/.+\.(?:mp4|webm|mov)(?:\?|$)/i.test(s)) return "";
  return s;
}

async function onlineNow() {
  try {
    const raw = await getStore({ name: PRESENCE_STORE, consistency: "strong" }).get(PRESENCE_KEY, {
      type: "json",
    });
    if (!raw || typeof raw !== "object") return { online: 0, users: [] };
    const now = Date.now();
    let n = 0;
    const live = {};
    for (const [sid, info] of Object.entries(raw)) {
      if (!SID_RE.test(sid) || !info || typeof info !== "object") continue;
      const ts = parseInt(info.ts, 10) || 0;
      if (!ts || now - ts > PRESENCE_TTL_MS) continue;
      n += 1;
      live[sid] = info;
    }
    return { online: n, users: usersOf(live) };
  } catch (e) {
    return { online: 0, users: [] };
  }
}

async function readUserIndex(store) {
  try {
    const raw = await store.get(USER_INDEX_KEY, { type: "json" });
    if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw;
  } catch (e) {}
  return {};
}

function userLastPayload(entry, withPrompt) {
  if (!entry || !entry.at) return null;
  const last = { at: parseInt(entry.at, 10) || 0, tab: cleanTab(entry.tab), name: cleanName(entry.name) || "guest" };
  if (entry.type) last.image = true;
  else if (cleanRemote(entry.remote)) last.remote = cleanRemote(entry.remote);
  else return null;
  if (withPrompt && entry.prompt) last.prompt = cleanPrompt(entry.prompt);
  return last;
}

// Keep this visitor's still; drop the oldest visitors past USER_MAX.
async function saveUserStill(store, pid, image, remote, meta) {
  const index = await readUserIndex(store);
  const entry = {
    at: meta.at,
    tab: meta.tab,
    name: meta.name,
    type: image ? image.type : "",
    remote: image ? "" : remote,
    prompt: meta.prompt || "",
  };
  if (image) await store.set(USER_IMAGE_PREFIX + pid, image.bytes);
  else if (index[pid] && index[pid].type) await store.delete(USER_IMAGE_PREFIX + pid);
  index[pid] = entry;
  const ids = Object.keys(index).filter(isPid);
  ids.sort((a, b) => (parseInt(index[b].at, 10) || 0) - (parseInt(index[a].at, 10) || 0));
  const next = {};
  for (let i = 0; i < ids.length; i++) {
    if (i < USER_MAX) next[ids[i]] = index[ids[i]];
    else if (index[ids[i]] && index[ids[i]].type) {
      try {
        await store.delete(USER_IMAGE_PREFIX + ids[i]);
      } catch (e) {}
    }
  }
  await store.setJSON(USER_INDEX_KEY, next);
  return userLastPayload(entry, false);
}

async function readMeta(store) {
  try {
    const meta = await store.get(META_KEY, { type: "json" });
    if (!meta || typeof meta !== "object" || !meta.at) return null;
    return {
      at: parseInt(meta.at, 10) || 0,
      tab: cleanTab(meta.tab),
      type: String(meta.type || ""),
      remote: cleanRemote(meta.remote),
    };
  } catch (e) {
    return null;
  }
}

async function readBytes(store) {
  return readBytesAt(store, IMAGE_KEY);
}

async function readBytesAt(store, key) {
  try {
    const data = await store.get(key, { type: "arrayBuffer" });
    if (!data) return null;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    return null;
  } catch (e) {
    return null;
  }
}

function lastPayload(meta) {
  if (!meta || !meta.at) return null;
  if (!meta.type && !meta.remote) return null;
  const last = { at: meta.at, tab: meta.tab };
  if (meta.remote) last.remote = meta.remote;
  if (meta.type) last.image = true;
  return last;
}

async function snapshot() {
  const store = getStore({ name: STORE, consistency: "strong" });
  const [now, meta] = await Promise.all([onlineNow(), readMeta(store)]);
  return { ok: true, online: now.online, users: now.users, last: lastPayload(meta) };
}

async function readBody(request) {
  try {
    const text = await request.text();
    if (!text) return {};
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

export default async function handler(request) {
  if (request.method === "OPTIONS") return corsPreflight();

  const url = new URL(request.url);
  const store = getStore({ name: STORE, consistency: "strong" });

  const userId = url.searchParams.get("user");
  if (request.method === "GET" && userId != null) {
    if (!isPid(userId)) return noStore({ ok: false, error: "Invalid user" }, 400);
    const entry = (await readUserIndex(store))[userId];
    const last = userLastPayload(entry, true);
    if (url.searchParams.get("image") !== "1") {
      return noStore({ ok: true, last });
    }
    const bytes = last && last.image ? await readBytesAt(store, USER_IMAGE_PREFIX + userId) : null;
    if (!bytes || bytes.length < 16) return noStore({ ok: false, error: "No still" }, 404);
    // The page asks with &v=<at>, so one URL is always the same picture.
    return new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": entry.type || "image/jpeg",
        "Cache-Control": url.searchParams.get("v") ? "private, max-age=86400" : "no-store",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  if (request.method === "GET" && url.searchParams.get("image") === "1") {
    const [meta, bytes] = await Promise.all([readMeta(store), readBytes(store)]);
    if (!meta || !meta.type || !bytes || bytes.length < 16) {
      return noStore({ ok: false, error: "No still" }, 404);
    }
    return new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": meta.type || "image/jpeg",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  if (request.method === "GET") {
    return noStore(await snapshot());
  }

  if (request.method !== "POST") {
    return noStore({ ok: false, error: "Method not allowed" }, 405);
  }

  const body = await readBody(request);
  if (!body || typeof body !== "object") {
    return noStore({ ok: false, error: "Invalid JSON" }, 400);
  }

  const image = decodeImage(body.image);
  const remote = image ? "" : cleanRemote(body.remote);
  if (!image && !remote) {
    return noStore({ ok: false, error: "Image required" }, 400);
  }

  const meta = {
    at: Date.now(),
    tab: cleanTab(body.tab),
    type: image ? image.type : "",
    remote: remote || "",
  };

  try {
    if (image) await store.set(IMAGE_KEY, image.bytes);
    else await store.delete(IMAGE_KEY);
    await store.setJSON(META_KEY, meta);
  } catch (e) {
    return noStore({ ok: false, error: "Store failed" }, 500);
  }

  // Who generated it: the session (hashed, never echoed) and the name they
  // used at that moment. Older pages send neither and only update the window.
  let userLast = null;
  const sid = String(body.sid || "").trim();
  if (SID_RE.test(sid)) {
    try {
      userLast = await saveUserStill(store, await pidOf(sid), image, remote, {
        at: meta.at,
        tab: meta.tab,
        name: cleanName(body.name) || "guest",
        prompt: cleanPrompt(body.prompt),
      });
    } catch (e) {
      userLast = null;
    }
  }

  const snap = await snapshot();
  snap.last = lastPayload(meta);
  if (userLast) snap.user_last = userLast;
  return noStore(snap);
}
