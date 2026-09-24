import { getStore } from "@netlify/blobs";
import { jsonResponse, corsPreflight } from "./_lib.mjs";

const TAB_RE = /^[a-z0-9-]{1,40}$/;
const SID_RE = /^[A-Za-z0-9._-]{8,80}$/;
const PRESENCE_KEY = "presence";
const TTL_MS = 25000;
const MAX_SIDS = 800;

function noStore(body, status = 200) {
  const res = jsonResponse(body, status);
  const headers = new Headers(res.headers);
  headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  return new Response(res.body, { status: res.status, headers });
}

function normalizeTab(raw) {
  const tab = String(raw || "")
    .toLowerCase()
    .replace(/^#/, "")
    .split("?")[0]
    .trim();
  if (tab === "0-z" || tab === "zeroz" || tab === "0z") return "az";
  if (tab === "kjv" || tab === "scripture") return "bible";
  if (tab === "rooms") return "places";
  if (!tab || tab === "subscribe") return "gallery";
  return tab;
}

function prune(map, now) {
  const out = {};
  if (!map || typeof map !== "object") return out;
  const entries = Object.entries(map);
  // Prefer freshest if the map grew huge.
  entries.sort((a, b) => (parseInt(b[1] && b[1].ts, 10) || 0) - (parseInt(a[1] && a[1].ts, 10) || 0));
  for (const [sid, info] of entries) {
    if (!SID_RE.test(sid)) continue;
    if (!info || typeof info !== "object") continue;
    const ts = parseInt(info.ts, 10) || 0;
    const tab = normalizeTab(info.tab);
    if (!ts || now - ts > TTL_MS) continue;
    if (!TAB_RE.test(tab)) continue;
    out[sid] = { tab, ts };
    if (Object.keys(out).length >= MAX_SIDS) break;
  }
  return out;
}

function countsOf(map) {
  const counts = {};
  for (const info of Object.values(map || {})) {
    const tab = info && info.tab;
    if (!TAB_RE.test(tab)) continue;
    counts[tab] = (counts[tab] || 0) + 1;
  }
  return counts;
}

async function loadMap(store) {
  try {
    const raw = await store.get(PRESENCE_KEY, { type: "json" });
    if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw;
  } catch (e) {}
  return {};
}

async function readBody(request) {
  const ct = (request.headers.get("content-type") || "").toLowerCase();
  if (ct.includes("application/json")) {
    try {
      return await request.json();
    } catch (e) {
      return {};
    }
  }
  try {
    const text = await request.text();
    if (!text) return {};
    return JSON.parse(text);
  } catch (e) {
    return {};
  }
}

export default async function handler(request) {
  if (request.method === "OPTIONS") return corsPreflight();

  const store = getStore({ name: "tab-presence", consistency: "strong" });
  const now = Date.now();

  if (request.method === "GET") {
    const map = prune(await loadMap(store), now);
    return noStore({ ok: true, counts: countsOf(map) });
  }

  if (request.method !== "POST") {
    return noStore({ ok: false, error: "Method not allowed" }, 405);
  }

  const body = await readBody(request);
  const sid = String(body.sid || "").trim();
  if (!SID_RE.test(sid)) {
    return noStore({ ok: false, error: "Invalid sid" }, 400);
  }

  // Read-modify-write. Low traffic: last writer wins after prune+merge.
  let map = prune(await loadMap(store), now);

  if (body.leave) {
    if (map[sid]) delete map[sid];
  } else {
    const tab = normalizeTab(body.tab);
    if (!TAB_RE.test(tab)) {
      return noStore({ ok: false, error: "Invalid tab" }, 400);
    }
    map[sid] = { tab, ts: now };
  }

  map = prune(map, now);
  try {
    await store.setJSON(PRESENCE_KEY, map);
  } catch (e) {
    return noStore({ ok: false, error: "Store failed" }, 500);
  }

  return noStore({ ok: true, counts: countsOf(map) });
}
