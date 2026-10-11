import { getStore } from "@netlify/blobs";
import { jsonResponse, corsPreflight } from "./_lib.mjs";

// Who is at the console right now, and each person's own last still.
// The corner window keeps one shared still. This store keeps one per visitor.
const STORE = "server-people";
const ROSTER_KEY = "roster";
const TTL_MS = 90000;
const MAX_PEOPLE = 36;
const SID_RE = /^[A-Za-z0-9._-]{8,80}$/;
const MAX_IMAGE_BYTES = 670000;

function noStore(body, status = 200) {
  const res = jsonResponse(body, status);
  const headers = new Headers(res.headers);
  headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  return new Response(res.body, { status: res.status, headers });
}

function stillKey(sid) {
  return "still-" + sid;
}

function guestName(sid) {
  const tail = String(sid || "").replace(/[^A-Za-z0-9]/g, "").slice(-4);
  return "Guest " + (tail || "0000");
}

function cleanName(raw, sid) {
  const name = String(raw || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 24)
    .trim();
  return name || guestName(sid);
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

async function readRoster(store) {
  try {
    const raw = await store.get(ROSTER_KEY, { type: "json" });
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    return raw;
  } catch (e) {
    return {};
  }
}

function toPeople(roster) {
  return Object.entries(roster)
    .map(([sid, info]) => ({
      sid,
      name: info.name,
      seen: info.seen,
      stillAt: info.stillAt || 0,
    }))
    .sort((a, b) => b.seen - a.seen || a.name.localeCompare(b.name));
}

async function prune(roster, store) {
  const now = Date.now();
  const entries = Object.entries(roster).filter(([sid, info]) => {
    if (!SID_RE.test(sid) || !info || typeof info !== "object") return false;
    const seen = parseInt(info.seen, 10) || 0;
    return seen && now - seen <= TTL_MS;
  });
  entries.sort((a, b) => (parseInt(b[1].seen, 10) || 0) - (parseInt(a[1].seen, 10) || 0));
  const kept = entries.slice(0, MAX_PEOPLE);
  const keepSet = new Set(kept.map((entry) => entry[0]));
  const next = {};
  for (const [sid, info] of kept) {
    next[sid] = {
      name: cleanName(info.name, sid),
      seen: parseInt(info.seen, 10) || now,
      stillAt: parseInt(info.stillAt, 10) || 0,
      type: String(info.type || ""),
    };
  }
  for (const sid of Object.keys(roster)) {
    if (keepSet.has(sid)) continue;
    try {
      await store.delete(stillKey(sid));
    } catch (e) {}
  }
  return next;
}

async function readBytes(store, sid) {
  try {
    const data = await store.get(stillKey(sid), { type: "arrayBuffer" });
    if (!data) return null;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    return null;
  } catch (e) {
    return null;
  }
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
    const sid = String(url.searchParams.get("sid") || "");
    if (!SID_RE.test(sid)) return noStore({ ok: false, error: "Unknown person" }, 400);
    const roster = await prune(await readRoster(store), store);
    const info = roster[sid];
    const bytes = info && info.type ? await readBytes(store, sid) : null;
    if (!info || !info.type || !bytes || bytes.length < 16) {
      return noStore({ ok: false, error: "No still" }, 404);
    }
    return new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": info.type || "image/jpeg",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  if (request.method === "GET") {
    const roster = await prune(await readRoster(store), store);
    try {
      await store.setJSON(ROSTER_KEY, roster);
    } catch (e) {}
    return noStore({ ok: true, people: toPeople(roster) });
  }

  if (request.method !== "POST") {
    return noStore({ ok: false, error: "Method not allowed" }, 405);
  }

  const body = await readBody(request);
  if (!body || typeof body !== "object") {
    return noStore({ ok: false, error: "Invalid JSON" }, 400);
  }
  const sid = String(body.sid || "");
  if (!SID_RE.test(sid)) return noStore({ ok: false, error: "Unknown person" }, 400);

  let roster = await prune(await readRoster(store), store);

  if (body.leave === true) {
    delete roster[sid];
    try {
      await store.delete(stillKey(sid));
      await store.setJSON(ROSTER_KEY, roster);
    } catch (e) {
      return noStore({ ok: false, error: "Store failed" }, 500);
    }
    return noStore({ ok: true, people: toPeople(roster) });
  }

  const image = body.image ? decodeImage(body.image) : null;
  if (body.image && !image) {
    return noStore({ ok: false, error: "Image required" }, 400);
  }

  const prev = roster[sid] || {};
  const nextInfo = {
    name: cleanName(body.name, sid),
    seen: Date.now(),
    stillAt: parseInt(prev.stillAt, 10) || 0,
    type: String(prev.type || ""),
  };
  if (image) {
    nextInfo.stillAt = Date.now();
    nextInfo.type = image.type;
  }
  roster[sid] = nextInfo;
  roster = await prune(roster, store);

  try {
    if (image) await store.set(stillKey(sid), image.bytes);
    await store.setJSON(ROSTER_KEY, roster);
  } catch (e) {
    return noStore({ ok: false, error: "Store failed" }, 500);
  }

  return noStore({ ok: true, people: toPeople(roster) });
}
