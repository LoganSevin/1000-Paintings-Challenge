import { getStore } from "@netlify/blobs";
import { jsonResponse, corsPreflight } from "./_lib.mjs";

const ID_RE = /^[A-Za-z0-9._-]{8,80}$/;
const MAX_IDS = 25000;

function parseState(raw) {
  if (raw == null || raw === "") return { ids: [] };
  if (typeof raw === "number") return { ids: [] };
  if (typeof raw === "object" && !Array.isArray(raw)) {
    const ids = Array.isArray(raw.ids) ? raw.ids.map(String).filter((id) => ID_RE.test(id)) : [];
    return { ids };
  }
  const text = String(raw).trim();
  if (!text) return { ids: [] };
  if (text.startsWith("{")) {
    try {
      return parseState(JSON.parse(text));
    } catch (e) {
      return { ids: [] };
    }
  }
  return { ids: [] };
}

export default async function handler(request) {
  if (request.method === "OPTIONS") return corsPreflight();
  const store = getStore({ name: "gallery-meta", consistency: "strong" });
  let state = { ids: [] };
  try {
    state = parseState(await store.get("checkins"));
  } catch (e) {
    state = { ids: [] };
  }
  if (request.method === "POST") {
    let body = {};
    try {
      body = await request.json();
    } catch (e) {
      body = {};
    }
    const id = String(body.id || "").trim();
    if (ID_RE.test(id) && !state.ids.includes(id) && state.ids.length < MAX_IDS) {
      state.ids.push(id);
      await store.setJSON("checkins", { ids: state.ids });
    }
  }
  return jsonResponse({ ok: true, count: state.ids.length });
}
