import { Buffer } from "node:buffer";
import { getStore } from "@netlify/blobs";

export const TAB_BOX = "phone-uploads";
export const MAX_BYTES = 3.2 * 1024 * 1024;
export const MAX_ITEMS = 400;

export function safeName(name) {
  const cleaned = String(name || "upload.jpg")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 80);
  return cleaned || "upload.jpg";
}

export function fileUrl(id) {
  return "/api/transfer/file?id=" + encodeURIComponent(id);
}

export function decodeDataUrl(raw) {
  let mime = "image/jpeg";
  let b64 = String(raw || "").trim();
  if (!b64) return null;
  if (b64.startsWith("data:") && b64.includes(",")) {
    const header = b64.slice(0, b64.indexOf(","));
    b64 = b64.slice(b64.indexOf(",") + 1);
    const m = header.match(/data:([^;]+)/i);
    if (m) mime = m[1].trim().toLowerCase() || mime;
  }
  b64 = b64.replace(/\s+/g, "");
  if (!b64) return null;
  let buf;
  try {
    buf = Buffer.from(b64, "base64");
  } catch (e) {
    return null;
  }
  if (!buf || !buf.length) return null;
  return { buf, mime: sniffMime(buf, mime) };
}

export function sniffMime(buf, fallback) {
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
  if (buf[0] === 0x47 && buf[1] === 0x49) return "image/gif";
  if (buf.length > 12 && buf[0] === 0x52 && buf[8] === 0x57) return "image/webp";
  return fallback || "image/jpeg";
}

export function toListItem(row) {
  const id = String(row.id || "");
  return {
    id: id || row.name,
    name: row.name,
    title: row.title || row.name,
    url: row.url || fileUrl(id),
    phone_url: row.url || fileUrl(id),
    collection: TAB_BOX,
    source: "phone-upload",
    kind: "phone-upload",
    created: row.created,
    contentType: row.contentType,
    size: row.size,
    analysisStatus: "none",
    analysis: row.analysis || null,
  };
}

export function phoneStore() {
  return getStore({ name: "phone-uploads", consistency: "strong" });
}

export async function loadIndex(store) {
  try {
    const data = await store.get("index", { type: "json" });
    const items = data && Array.isArray(data.items) ? data.items : [];
    return items.filter((row) => row && row.id);
  } catch (e) {
    return [];
  }
}

export async function saveIndex(store, items) {
  const next = { items: items.slice(0, MAX_ITEMS) };
  for (let attempt = 0; attempt < 8; attempt++) {
    const meta = await store.getWithMetadata("index", { type: "json" });
    const options = meta && meta.etag ? { onlyIfMatch: meta.etag } : { onlyIfNew: true };
    const result = await store.setJSON("index", next, options);
    if (result && result.modified) return next.items;
  }
  await store.setJSON("index", next);
  return next.items;
}

export async function savePhoneImage(store, buf, mime, filename) {
  if (!buf || !buf.length) {
    const err = new Error("Empty photo");
    err.status = 400;
    throw err;
  }
  if (buf.length > MAX_BYTES) {
    const err = new Error("Image too large — try a screenshot or a smaller JPEG");
    err.status = 400;
    throw err;
  }
  const id = "ph-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  const name = safeName(filename || "upload.jpg");
  const type = sniffMime(buf, mime || "image/jpeg");
  await store.set("file/" + id, buf instanceof Uint8Array ? buf : new Uint8Array(buf), {
    metadata: { contentType: type, filename: name },
  });
  const item = {
    id,
    name,
    title: name.replace(/\.[^.]+$/, "") || name,
    created: Date.now(),
    contentType: type,
    size: buf.length,
    url: fileUrl(id),
  };
  const items = await loadIndex(store);
  items.unshift(item);
  await saveIndex(store, items);
  return {
    ok: true,
    name,
    id,
    url: fileUrl(id),
    box: TAB_BOX,
    size: buf.length,
    analysisStatus: "none",
    inGeneratorMix: true,
  };
}
