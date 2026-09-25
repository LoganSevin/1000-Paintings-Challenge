import { getStore } from "@netlify/blobs";
import { jsonResponse, corsPreflight } from "./_lib.mjs";

const TAB_BOX = "phone-uploads";
const MAX_BYTES = 4.5 * 1024 * 1024;
const MAX_ITEMS = 400;

function noStore(body, status = 200) {
  const res = jsonResponse(body, status);
  const headers = new Headers(res.headers);
  headers.set("Cache-Control", "no-store");
  return new Response(res.body, { status: res.status, headers });
}

function routeName(pathname) {
  const path = String(pathname || "").replace(/\/+$/, "");
  if (path.endsWith("/upload") || path.includes("/transfer/upload")) return "upload";
  if (path.endsWith("/file") || path.includes("/transfer/file")) return "file";
  if (path.endsWith("/list") || path.includes("/transfer/list")) return "list";
  if (path.includes("/catalog")) return "catalog";
  if (path.includes("/spell-assets")) return "spell-assets";
  if (path.includes("/status")) return "status";
  return "status";
}

function safeName(name) {
  const cleaned = String(name || "upload.jpg")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 80);
  return cleaned || "upload.jpg";
}

function decodeDataUrl(raw) {
  let mime = "image/jpeg";
  let b64 = String(raw || "").trim();
  if (!b64) return null;
  if (b64.startsWith("data:") && b64.includes(",")) {
    const header = b64.slice(0, b64.indexOf(","));
    b64 = b64.slice(b64.indexOf(",") + 1);
    const m = header.match(/data:([^;]+)/i);
    if (m) mime = m[1].trim().toLowerCase() || mime;
  }
  let buf;
  try {
    buf = Buffer.from(b64, "base64");
  } catch (e) {
    return null;
  }
  if (!buf || !buf.length) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8) mime = "image/jpeg";
  else if (buf[0] === 0x89 && buf[1] === 0x50) mime = "image/png";
  else if (buf[0] === 0x47 && buf[1] === 0x49) mime = "image/gif";
  else if (buf[0] === 0x52 && buf[8] === 0x57) mime = "image/webp";
  return { buf, mime };
}

function fileUrl(id) {
  return "/api/transfer/file?id=" + encodeURIComponent(id);
}

function toListItem(row) {
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

async function loadIndex(store) {
  try {
    const data = await store.get("index", { type: "json" });
    const items = data && Array.isArray(data.items) ? data.items : [];
    return items.filter((row) => row && row.id);
  } catch (e) {
    return [];
  }
}

async function saveIndex(store, items) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const meta = await store.getWithMetadata("index", { type: "json" });
    const next = { items: items.slice(0, MAX_ITEMS) };
    const options = meta && meta.etag ? { onlyIfMatch: meta.etag } : { onlyIfNew: true };
    const result = await store.setJSON("index", next, options);
    if (result && result.modified) return next.items;
    const latest = await loadIndex(store);
    const seen = new Set(latest.map((row) => row.id));
    items.forEach((row) => {
      if (row && row.id && !seen.has(row.id)) latest.unshift(row);
    });
    items = latest;
  }
  await store.setJSON("index", { items: items.slice(0, MAX_ITEMS) });
  return items.slice(0, MAX_ITEMS);
}

export default async function handler(request) {
  if (request.method === "OPTIONS") return corsPreflight();
  const url = new URL(request.url);
  const route = routeName(url.pathname);
  const store = getStore({ name: "phone-uploads", consistency: "strong" });

  if (route === "file") {
    const id = String(url.searchParams.get("id") || "").replace(/[^A-Za-z0-9._-]/g, "");
    if (!id) return noStore({ ok: false, error: "id required" }, 400);
    const meta = await store.getWithMetadata("file/" + id, { type: "arrayBuffer" });
    if (!meta || !meta.data) return noStore({ ok: false, error: "Not found" }, 404);
    const type =
      (meta.metadata && (meta.metadata.contentType || meta.metadata.contenttype)) || "image/jpeg";
    return new Response(meta.data, {
      status: 200,
      headers: {
        "Content-Type": String(type),
        "Cache-Control": "public, max-age=31536000, immutable",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  if (route === "status") {
    const items = await loadIndex(store);
    const origin = url.origin || "https://logan7in.art";
    return noStore({
      ok: true,
      public: true,
      phoneUploadsDir: "phone-uploads",
      phoneUploadsCount: items.length,
      toPhoneCount: 0,
      lanUrls: [origin],
      bestLanUrl: origin,
    });
  }

  if (route === "list" || route === "catalog" || route === "spell-assets") {
    const coll = String(url.searchParams.get("collection") || url.searchParams.get("box") || TAB_BOX)
      .toLowerCase()
      .replace(/_/g, "-");
    if (route === "catalog" && coll && coll !== TAB_BOX && coll !== "phone" && coll !== "from-phone") {
      return noStore({ ok: false, error: "static-catalog" }, 404);
    }
    const items = (await loadIndex(store)).map(toListItem);
    if (route === "spell-assets") {
      return noStore({
        ok: true,
        items: items.map((it, i) => ({
          number: 900000 + i,
          url: it.url,
          source: "phone-upload",
          title: it.title,
          name: it.name,
          analysis: it.analysis,
        })),
      });
    }
    return noStore({ ok: true, box: TAB_BOX, items, count: items.length });
  }

  if (route === "upload" && request.method === "POST") {
    let body = {};
    try {
      body = await request.json();
    } catch (e) {
      return noStore({ ok: false, error: "Invalid JSON" }, 400);
    }
    const decoded = decodeDataUrl(body.image_base64 || body.data || "");
    if (!decoded) return noStore({ ok: false, error: "Provide image_base64" }, 400);
    if (decoded.buf.length > MAX_BYTES) {
      return noStore({ ok: false, error: "Image too large — try a smaller photo" }, 400);
    }
    const id = "ph-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
    const name = safeName(body.name || body.filename || "upload.jpg");
    await store.set("file/" + id, decoded.buf, {
      metadata: { contentType: decoded.mime, name },
    });
    const item = {
      id,
      name,
      title: name.replace(/\.[^.]+$/, "") || name,
      created: Date.now(),
      contentType: decoded.mime,
      size: decoded.buf.length,
      url: fileUrl(id),
    };
    const items = await loadIndex(store);
    items.unshift(item);
    await saveIndex(store, items);
    return noStore({
      ok: true,
      name,
      id,
      url: fileUrl(id),
      box: TAB_BOX,
      size: decoded.buf.length,
      analysisStatus: "none",
      inGeneratorMix: true,
    });
  }

  return noStore({ ok: false, error: "Not found" }, 404);
}
