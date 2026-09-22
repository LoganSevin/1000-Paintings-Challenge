import { getStore } from "@netlify/blobs";
import { jsonResponse, corsPreflight } from "./_lib.mjs";

const TAB_RE = /^[a-z0-9-]{1,40}$/;

function readCounts(raw) {
  if (raw == null || raw === "") return {};
  let data = raw;
  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text) return {};
    if (text.startsWith("{")) {
      try {
        data = JSON.parse(text);
      } catch (e) {
        return {};
      }
    } else {
      return {};
    }
  }
  if (typeof data !== "object" || data == null) return {};
  if (data.counts && typeof data.counts === "object") {
    const out = {};
    for (const [key, value] of Object.entries(data.counts)) {
      if (TAB_RE.test(key)) out[key] = parseInt(value, 10) || 0;
    }
    return out;
  }
  return {};
}

export default async function handler(request) {
  if (request.method === "OPTIONS") return corsPreflight();
  const store = getStore({ name: "gallery-meta", consistency: "strong" });
  let counts = {};
  try {
    counts = readCounts(await store.get("checkins"));
  } catch (e) {
    counts = {};
  }
  if (request.method === "POST") {
    let body = {};
    try {
      body = await request.json();
    } catch (e) {
      body = {};
    }
    const tab = String(body.tab || "").toLowerCase();
    if (TAB_RE.test(tab)) {
      counts[tab] = (parseInt(counts[tab], 10) || 0) + 1;
      await store.setJSON("checkins", { counts });
    }
  }
  return jsonResponse({ ok: true, counts });
}
