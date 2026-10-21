import { getStore } from "@netlify/blobs";
import { jsonResponse, corsPreflight } from "./_lib.mjs";

// Persist a generated clip in the saved-videos blob store.
// The browser sends the remote https address. This function downloads it.
// There is no ffmpeg here: mp4 bytes stay .mp4, webm bytes stay .webm.
export const STORE_NAME = "saved-videos";
export const MAX_VIDEO_BYTES = 48 * 1024 * 1024;
export const SLICE_BYTES = 4 * 1024 * 1024;
export const FULL_MAX_BYTES = Math.floor(5.5 * 1024 * 1024);
// gallery/saved-videos on disk already contains 1.mp4 through 501.mp4.
export const NUMBER_FLOOR = 502;
const INDEX_KEY = "index";

let remoteFetch = null;

export function setRemoteFetchForTests(fn) {
  remoteFetch = typeof fn === "function" ? fn : null;
}

function fail(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function toU8(bytes) {
  if (!bytes) return null;
  if (bytes instanceof Uint8Array) return bytes;
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
  if (ArrayBuffer.isView(bytes)) {
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  return null;
}

export function sniffVideo(bytes) {
  const u = toU8(bytes);
  if (!u || u.length < 12) return "";
  if (u[0] === 0x1a && u[1] === 0x45 && u[2] === 0xdf && u[3] === 0xa3) return "webm";
  const n = Math.min(32, u.length);
  let head = "";
  for (let i = 0; i < n; i++) head += String.fromCharCode(u[i]);
  if (head.indexOf("ftyp") >= 0) return "mp4";
  return "";
}

function ipv4Parts(host) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const parts = [m[1], m[2], m[3], m[4]].map((n) => parseInt(n, 10));
  if (parts.some((n) => n > 255)) return null;
  return parts;
}

function privateIpv4(parts) {
  const a = parts[0];
  const b = parts[1];
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 255) return true;
  return false;
}

export function remoteUrlError(raw) {
  let u;
  try {
    u = new URL(String(raw || ""));
  } catch (e) {
    return "That video address cannot be saved.";
  }
  if (u.protocol !== "https:") return "That video address cannot be saved.";
  if (u.username || u.password) return "That video address cannot be saved.";
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    return "That video address cannot be saved.";
  }
  if (host === "metadata.google.internal" || host === "metadata.google") {
    return "That video address cannot be saved.";
  }
  if (host === "::1" || host === "0:0:0:0:0:0:0:1") return "That video address cannot be saved.";
  if (host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd")) {
    return "That video address cannot be saved.";
  }
  if (host.startsWith("::ffff:")) {
    const mapped = ipv4Parts(host.slice(7));
    if (mapped && privateIpv4(mapped)) return "That video address cannot be saved.";
  }
  const ip = ipv4Parts(host);
  if (ip && privateIpv4(ip)) return "That video address cannot be saved.";
  return "";
}

export function savedNameFromUrl(raw) {
  let path = String(raw || "").trim();
  if (!path) return "";
  try {
    if (/^[a-z][a-z0-9+.-]*:/i.test(path)) path = new URL(path).pathname;
  } catch (e) {
    return "";
  }
  const m = /\/saved-videos\/(\d+)\.(mp4|webm)$/i.exec(path);
  if (!m) return "";
  return m[1] + "." + m[2].toLowerCase();
}

export function planByteRange(total, header) {
  const size = total | 0;
  if (size <= 0) return { error: 416 };
  const raw = String(header || "").trim();
  if (!raw) {
    if (size <= FULL_MAX_BYTES) return { status: 200, start: 0, end: size - 1 };
    return { status: 206, start: 0, end: Math.min(SLICE_BYTES, size) - 1 };
  }
  const m = /bytes=(\d*)-(\d*)/i.exec(raw);
  if (!m) return { error: 416 };
  let start = m[1] === "" ? null : parseInt(m[1], 10);
  let end = m[2] === "" ? null : parseInt(m[2], 10);
  if (start == null && end != null) {
    if (end <= 0) return { error: 416 };
    start = Math.max(0, size - end);
    end = size - 1;
  } else if (start != null && (end == null || m[2] === "")) {
    if (start < 0 || start >= size) return { error: 416 };
    end = Math.min(size - 1, start + SLICE_BYTES - 1);
  } else if (start != null && end != null) {
    if (start < 0 || start > end || start >= size) return { error: 416 };
    end = Math.min(end, size - 1, start + SLICE_BYTES - 1);
  } else {
    return { error: 416 };
  }
  return { status: 206, start, end };
}

export function clipContentType(name) {
  return String(name || "").toLowerCase().endsWith(".webm") ? "video/webm" : "video/mp4";
}

async function readIndex(store) {
  try {
    const data = await store.get(INDEX_KEY, { type: "json" });
    if (!data || typeof data !== "object") return { next: 1, items: [] };
    return {
      next: Math.max(1, parseInt(data.next, 10) || 1),
      items: Array.isArray(data.items) ? data.items : [],
    };
  } catch (e) {
    return { next: 1, items: [] };
  }
}

function describeClip(num, name, bytes) {
  return {
    ok: true,
    num: num,
    name: name,
    path: "saved-videos/" + name,
    dir: "saved-videos",
    url: "/saved-videos/" + name,
    content_type: clipContentType(name),
    bytes: bytes,
  };
}

export async function listClips(store) {
  const index = await readIndex(store);
  return index.items
    .map(function (item) {
      const num = parseInt(item && item.num, 10) || 0;
      const name = String((item && item.name) || "");
      if (!num || !/^\d+\.(mp4|webm)$/i.test(name)) return null;
      return {
        num: num,
        name: name,
        bytes: item.bytes || 0,
        url: "/saved-videos/" + name,
        content_type: clipContentType(name),
      };
    })
    .filter(Boolean)
    .sort(function (a, b) {
      return a.num - b.num;
    });
}

export async function readClipBytes(store, name) {
  let data = null;
  try {
    data = await store.get("clip/" + name, { type: "arrayBuffer" });
  } catch (e) {
    data = null;
  }
  return toU8(data);
}

export async function storeClip(store, bytes, kind) {
  const u = toU8(bytes);
  if (!u || !u.length) throw fail("Empty video data.", 400);
  if (u.length > MAX_VIDEO_BYTES) throw fail("Video file is too large to save.", 413);
  if (kind !== "mp4" && kind !== "webm") throw fail("Not an mp4 or webm.", 415);
  const index = await readIndex(store);
  let num = Math.max(NUMBER_FLOOR, parseInt(index.next, 10) || 1);
  for (const item of index.items) {
    const n = parseInt(item && item.num, 10) || 0;
    if (n >= num) num = n + 1;
  }
  const name = num + (kind === "webm" ? ".webm" : ".mp4");
  await store.set("clip/" + name, u);
  const items = index.items.slice();
  items.push({ num: num, name: name, bytes: u.length, content_type: clipContentType(name) });
  const kept = items.length > 400 ? items.slice(items.length - 400) : items;
  await store.setJSON(INDEX_KEY, { next: num + 1, items: kept });
  return describeClip(num, name, u.length);
}

export async function readCappedBody(res) {
  const declared = parseInt(res.headers.get("content-length") || "", 10);
  if (Number.isFinite(declared) && declared > MAX_VIDEO_BYTES) {
    throw fail("Video file is too large to save.", 413);
  }
  if (!res.body || typeof res.body.getReader !== "function") {
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length > MAX_VIDEO_BYTES) throw fail("Video file is too large to save.", 413);
    return buf;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const step = await reader.read();
    if (step.done) break;
    total += step.value.byteLength;
    if (total > MAX_VIDEO_BYTES) {
      try {
        await reader.cancel();
      } catch (e) {}
      throw fail("Video file is too large to save.", 413);
    }
    chunks.push(step.value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export async function fetchRemoteVideo(url, fetchImpl) {
  const fetchFn = fetchImpl || remoteFetch || fetch;
  let current = String(url || "");
  for (let hop = 0; hop < 4; hop++) {
    const blocked = remoteUrlError(current);
    if (blocked) throw fail(blocked, 400);
    const init = { redirect: "manual" };
    if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
      init.signal = AbortSignal.timeout(85000);
    }
    const res = await fetchFn(current, init);
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) throw fail("The video host did not provide a redirect.", 502);
      current = new URL(loc, current).href;
      continue;
    }
    if (!res.ok) throw fail("The video host returned " + res.status + ".", 502);
    const bytes = await readCappedBody(res);
    const kind = sniffVideo(bytes);
    if (!kind) throw fail("That file is not an mp4 or webm.", 415);
    return { bytes, kind };
  }
  throw fail("The video host redirected too many times.", 502);
}

export default async function handler(request) {
  if (request.method === "OPTIONS") return corsPreflight();
  if (request.method === "GET") {
    const store = getStore({ name: STORE_NAME, consistency: "strong" });
    const items = await listClips(store);
    return jsonResponse({ ok: true, items: items });
  }
  if (request.method !== "POST") return jsonResponse({ ok: false, error: "POST required" }, 405);
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return jsonResponse({ ok: false, error: "Send the video address as JSON." }, 400);
  }
  const url = String((body && body.url) || "").trim();
  if (!url) return jsonResponse({ ok: false, error: "Missing video url." }, 400);
  if (/^(blob:|data:)/i.test(url)) {
    return jsonResponse({ ok: false, error: "Send an https video address." }, 400);
  }
  const store = getStore({ name: STORE_NAME, consistency: "strong" });
  const existingName = savedNameFromUrl(url);
  if (existingName) {
    const have = await readClipBytes(store, existingName);
    if (!have || have.length < 12) {
      return jsonResponse({ ok: false, error: "Saved video not found." }, 404);
    }
    const num = parseInt(existingName, 10);
    return jsonResponse({ ...describeClip(num, existingName, have.length), already_saved: true });
  }
  try {
    const got = await fetchRemoteVideo(url);
    const stored = await storeClip(store, got.bytes, got.kind);
    return jsonResponse(stored);
  } catch (e) {
    const status = e && e.status ? e.status : 502;
    return jsonResponse({ ok: false, error: (e && e.message) || "Save failed" }, status);
  }
}
