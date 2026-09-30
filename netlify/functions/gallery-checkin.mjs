import { getStore } from "@netlify/blobs";
import { jsonResponse, corsPreflight } from "./_lib.mjs";

const TAB_RE = /^[a-z0-9-]{1,40}$/;
const ID_RE = /^[A-Za-z0-9._-]{8,80}$/;
// Clients refresh their checkin presence at most every 60s (visible tabs only),
// so entries live a little longer than that.
const PRESENCE_TTL_MS = 90000;
const OPENS_KEY = "tab-opens-v2";
// One aggregate record { id: { tab, seen } } instead of one blob per visitor,
// so a GET is two blob reads instead of list + N reads.
const PRESENCE_KEY = "presence-v2";
const MAX_IDS = 800;

function noStore(body) {
  const res = jsonResponse(body);
  const headers = new Headers(res.headers);
  headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  return new Response(res.body, { status: res.status, headers });
}

// GET payload is identical for every visitor (tab open totals + live counts),
// so let Netlify's CDN answer repeat GETs for 10s without invoking the function.
function edgeCached(body) {
  const res = jsonResponse(body);
  const headers = new Headers(res.headers);
  headers.set("Cache-Control", "public, max-age=0, must-revalidate");
  headers.set("Netlify-CDN-Cache-Control", "public, s-maxage=10, stale-while-revalidate=20");
  return new Response(res.body, { status: res.status, headers });
}

function normalizeOpens(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  const src =
    raw.opens && typeof raw.opens === "object"
      ? raw.opens
      : raw.counts && typeof raw.counts === "object"
        ? raw.counts
        : raw;
  for (const [key, value] of Object.entries(src)) {
    if (!TAB_RE.test(key)) continue;
    if (value && typeof value === "object") out[key] = parseInt(value.opens, 10) || 0;
    else out[key] = parseInt(value, 10) || 0;
  }
  return out;
}

async function loadOpens(store) {
  // Fresh key (tab-opens-v2): do not migrate legacy checkins / checkins-opens,
  // so deploy resets all open counts to 0.
  try {
    const current = await store.get(OPENS_KEY, { type: "json" });
    if (current && typeof current === "object") return normalizeOpens(current);
  } catch (e) {}
  return {};
}

async function bumpOpens(store, tab) {
  // @netlify/blobs@8 setJSON returns void and has no onlyIfMatch.
  // The old CAS loop treated a missing `modified` flag as failure and
  // re-read/wrote +1 up to 8 times, then +1 again in the fallback (~+9
  // opens per single tab open). One read-modify-write keeps the tally sane.
  const opens = await loadOpens(store);
  opens[tab] = (opens[tab] || 0) + 1;
  await store.setJSON(OPENS_KEY, opens);
  return opens;
}

function prunePresence(map, now) {
  const out = {};
  if (!map || typeof map !== "object" || Array.isArray(map)) return out;
  const entries = Object.entries(map).sort(
    (a, b) => (parseInt(b[1] && b[1].seen, 10) || 0) - (parseInt(a[1] && a[1].seen, 10) || 0)
  );
  for (const [id, info] of entries) {
    if (!ID_RE.test(id) || !info || typeof info !== "object") continue;
    const seen = parseInt(info.seen, 10) || 0;
    const tab = String(info.tab || "").toLowerCase();
    if (!seen || now - seen > PRESENCE_TTL_MS || !TAB_RE.test(tab)) continue;
    out[id] = { tab, seen };
    if (Object.keys(out).length >= MAX_IDS) break;
  }
  return out;
}

async function loadPresence(store, now) {
  try {
    return prunePresence(await store.get(PRESENCE_KEY, { type: "json" }), now);
  } catch (e) {
    return {};
  }
}

function liveCounts(map) {
  const live = {};
  for (const info of Object.values(map || {})) {
    live[info.tab] = (live[info.tab] || 0) + 1;
  }
  return live;
}

function payload(opens, live) {
  const counts = {};
  const tabs = new Set([...Object.keys(opens || {}), ...Object.keys(live || {})]);
  for (const tab of tabs) {
    counts[tab] = {
      opens: parseInt(opens[tab], 10) || 0,
      live: parseInt(live[tab], 10) || 0,
    };
  }
  return counts;
}

export default async function handler(request) {
  if (request.method === "OPTIONS") return corsPreflight();
  const store = getStore({ name: "gallery-meta", consistency: "strong" });
  const now = Date.now();
  if (request.method !== "POST") {
    const [opens, presence] = await Promise.all([loadOpens(store), loadPresence(store, now)]);
    return edgeCached({ ok: true, counts: payload(opens, liveCounts(presence)) });
  }
  let body = {};
  try {
    body = await request.json();
  } catch (e) {
    body = {};
  }
  const tab = String(body.tab || "").toLowerCase();
  const id = String(body.id || "").trim();
  // Read-modify-write, like presence.mjs. Low traffic: last writer wins.
  let presence = await loadPresence(store, now);
  if (TAB_RE.test(tab) && ID_RE.test(id)) {
    presence[id] = { tab, seen: now };
    presence = prunePresence(presence, now);
    try {
      await store.setJSON(PRESENCE_KEY, presence);
    } catch (e) {}
  }
  const opens = TAB_RE.test(tab) && body.bump ? await bumpOpens(store, tab) : await loadOpens(store);
  return noStore({ ok: true, counts: payload(opens, liveCounts(presence)) });
}
