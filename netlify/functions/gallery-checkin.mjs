import { getStore } from "@netlify/blobs";
import { jsonResponse, corsPreflight } from "./_lib.mjs";

function readCount(raw) {
  if (raw == null || raw === "") return 0;
  if (typeof raw === "number") return parseInt(raw, 10) || 0;
  if (typeof raw === "object") {
    if (raw.count != null) return parseInt(raw.count, 10) || 0;
    if (Array.isArray(raw.ids)) return raw.ids.length;
    return 0;
  }
  const text = String(raw).trim();
  if (!text) return 0;
  if (text.startsWith("{")) {
    try {
      return readCount(JSON.parse(text));
    } catch (e) {
      return 0;
    }
  }
  return parseInt(text, 10) || 0;
}

export default async function handler(request) {
  if (request.method === "OPTIONS") return corsPreflight();
  const store = getStore({ name: "gallery-meta", consistency: "strong" });
  let count = 0;
  try {
    count = readCount(await store.get("checkins"));
  } catch (e) {
    count = 0;
  }
  if (request.method === "POST") {
    count += 1;
    await store.setJSON("checkins", { count });
  }
  return jsonResponse({ ok: true, count });
}
