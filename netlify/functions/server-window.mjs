import { getStore } from "@netlify/blobs";
import { jsonResponse, corsPreflight } from "./_lib.mjs";

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

async function onlineCount() {
  try {
    const raw = await getStore({ name: PRESENCE_STORE, consistency: "strong" }).get(PRESENCE_KEY, {
      type: "json",
    });
    if (!raw || typeof raw !== "object") return 0;
    const now = Date.now();
    let n = 0;
    for (const [sid, info] of Object.entries(raw)) {
      if (!SID_RE.test(sid) || !info || typeof info !== "object") continue;
      const ts = parseInt(info.ts, 10) || 0;
      if (!ts || now - ts > PRESENCE_TTL_MS) continue;
      n += 1;
    }
    return n;
  } catch (e) {
    return 0;
  }
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
  try {
    const data = await store.get(IMAGE_KEY, { type: "arrayBuffer" });
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
  const [online, meta] = await Promise.all([onlineCount(), readMeta(store)]);
  return { ok: true, online, last: lastPayload(meta) };
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

  const snap = await snapshot();
  snap.last = lastPayload(meta);
  return noStore(snap);
}
