import { getStore } from "@netlify/blobs";
import { jsonResponse, corsPreflight } from "./_lib.mjs";

const TAB_RE = /^[a-z0-9-]{1,40}$/;
const ID_RE = /^[A-Za-z0-9._-]{8,80}$/;
const PRESENCE_TTL_MS = 25000;
const MAX_PRESENCE = 4000;

function parseState(raw) {
  const state = { opens: {}, presence: {} };
  if (raw == null || raw === "") return state;
  let data = raw;
  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text) return state;
    if (!text.startsWith("{")) return state;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return state;
    }
  }
  if (typeof data !== "object" || data == null) return state;
  const opensSrc =
    data.opens && typeof data.opens === "object"
      ? data.opens
      : data.counts && typeof data.counts === "object"
        ? data.counts
        : {};
  for (const [key, value] of Object.entries(opensSrc)) {
    if (!TAB_RE.test(key)) continue;
    if (value && typeof value === "object") {
      state.opens[key] = parseInt(value.opens, 10) || 0;
    } else {
      state.opens[key] = parseInt(value, 10) || 0;
    }
  }
  if (data.presence && typeof data.presence === "object") {
    for (const [id, info] of Object.entries(data.presence)) {
      if (!ID_RE.test(id) || !info || typeof info !== "object") continue;
      const tab = String(info.tab || "").toLowerCase();
      const seen = parseInt(info.seen, 10) || 0;
      if (TAB_RE.test(tab) && seen) state.presence[id] = { tab, seen };
    }
  }
  return state;
}

function prune(state, now) {
  const cutoff = now - PRESENCE_TTL_MS;
  const next = {};
  for (const [id, info] of Object.entries(state.presence || {})) {
    if (info && info.seen >= cutoff) next[id] = info;
  }
  state.presence = next;
  return state;
}

function payload(state) {
  const live = {};
  for (const info of Object.values(state.presence || {})) {
    if (!info || !info.tab) continue;
    live[info.tab] = (live[info.tab] || 0) + 1;
  }
  const tabs = new Set([...Object.keys(state.opens || {}), ...Object.keys(live)]);
  const counts = {};
  for (const tab of tabs) {
    counts[tab] = {
      opens: parseInt(state.opens[tab], 10) || 0,
      live: parseInt(live[tab], 10) || 0,
    };
  }
  return counts;
}

export default async function handler(request) {
  if (request.method === "OPTIONS") return corsPreflight();
  const store = getStore({ name: "gallery-meta", consistency: "strong" });
  const now = Date.now();
  let state = { opens: {}, presence: {} };
  try {
    state = prune(parseState(await store.get("checkins")), now);
  } catch (e) {
    state = { opens: {}, presence: {} };
  }
  let dirty = true;
  if (request.method === "POST") {
    let body = {};
    try {
      body = await request.json();
    } catch (e) {
      body = {};
    }
    const tab = String(body.tab || "").toLowerCase();
    const id = String(body.id || "").trim();
    if (TAB_RE.test(tab)) {
      if (body.bump) state.opens[tab] = (parseInt(state.opens[tab], 10) || 0) + 1;
      if (ID_RE.test(id)) {
        state.presence[id] = { tab, seen: now };
        const ids = Object.keys(state.presence);
        if (ids.length > MAX_PRESENCE) {
          ids
            .sort((a, b) => (state.presence[a].seen || 0) - (state.presence[b].seen || 0))
            .slice(0, ids.length - MAX_PRESENCE)
            .forEach((old) => {
              delete state.presence[old];
            });
        }
      }
    }
  }
  if (dirty) await store.setJSON("checkins", state);
  return jsonResponse({ ok: true, counts: payload(state) });
}
