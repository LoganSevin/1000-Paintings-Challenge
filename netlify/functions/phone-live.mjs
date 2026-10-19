import { getStore } from "@netlify/blobs";
import { jsonResponse, corsPreflight } from "./_lib.mjs";

// One live camera picture for every open page. The phone that went live
// replaces the frame; other screens only read it. Audio is never stored.
const STORE = "phone-live";
const FRAME_KEY = "frame";
const META_KEY = "meta";
const TTL_MS = 4500;
const MAX_IMAGE_BYTES = 180000;
const PUB_RE = /^[A-Za-z0-9]{16,40}$/;

function noStore(body, status = 200) {
  const res = jsonResponse(body, status);
  const headers = new Headers(res.headers);
  headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  return new Response(res.body, { status: res.status, headers });
}

function b64ToBytes(b64) {
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(b64, "base64"));
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function decodeJpeg(input) {
  const s = String(input || "").trim();
  const m = s.match(/^data:image\/jpeg;base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!m) return null;
  const b64 = m[1].replace(/\s/g, "");
  if (!b64 || b64.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 8) return null;
  let bytes;
  try {
    bytes = b64ToBytes(b64);
  } catch (e) {
    return null;
  }
  if (!bytes || bytes.length < 16 || bytes.length > MAX_IMAGE_BYTES) return null;
  if (!(bytes[0] === 0xff && bytes[1] === 0xd8)) return null;
  return bytes;
}

function publisherOf(body) {
  const id = String((body && body.publisher) || "");
  return PUB_RE.test(id) ? id : "";
}

async function readMeta(store) {
  try {
    const meta = await store.get(META_KEY, { type: "json" });
    if (!meta || typeof meta !== "object") return null;
    const at = parseInt(meta.at, 10) || 0;
    const publisher = PUB_RE.test(meta.publisher || "") ? meta.publisher : "";
    return { at, publisher, on: !!meta.on };
  } catch (e) {
    return null;
  }
}

function isFresh(meta, now) {
  return !!(meta && meta.on && meta.publisher && meta.at && now - meta.at < TTL_MS);
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
  const now = Date.now();

  if (request.method === "GET" && url.searchParams.get("frame") === "1") {
    const meta = await readMeta(store);
    if (!isFresh(meta, now)) return noStore({ ok: false, error: "Off" }, 404);
    let data;
    try {
      data = await store.get(FRAME_KEY, { type: "arrayBuffer" });
    } catch (e) {
      data = null;
    }
    let bytes = null;
    if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
    else if (ArrayBuffer.isView(data)) bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    if (!bytes || bytes.length < 16) return noStore({ ok: false, error: "Off" }, 404);
    return new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  if (request.method === "GET") {
    const meta = await readMeta(store);
    const live = isFresh(meta, now);
    return noStore({ ok: true, live, at: live ? meta.at : 0 });
  }

  if (request.method !== "POST") return noStore({ ok: false, error: "Method not allowed" }, 405);

  const body = await readBody(request);
  if (!body || typeof body !== "object") return noStore({ ok: false, error: "Invalid JSON" }, 400);
  const publisher = publisherOf(body);
  if (!publisher) return noStore({ ok: false, error: "Publisher required" }, 400);

  const meta = await readMeta(store);
  const held = isFresh(meta, now) && meta.publisher !== publisher;
  if (held) return noStore({ ok: false, error: "busy" }, 409);

  if (body.off) {
    try {
      await store.delete(FRAME_KEY);
      await store.setJSON(META_KEY, { at: now, publisher, on: false });
    } catch (e) {
      return noStore({ ok: false, error: "Store failed" }, 500);
    }
    return noStore({ ok: true, live: false, at: 0 });
  }

  const bytes = decodeJpeg(body.image);
  if (!bytes) return noStore({ ok: false, error: "Image required" }, 400);
  try {
    await store.set(FRAME_KEY, bytes);
    await store.setJSON(META_KEY, { at: now, publisher, on: true });
  } catch (e) {
    return noStore({ ok: false, error: "Store failed" }, 500);
  }
  return noStore({ ok: true, live: true, at: now });
}
