import { getStore } from "@netlify/blobs";
import { jsonResponse, corsPreflight } from "./_lib.mjs";

const TAB_RE = /^[a-z0-9-]{1,40}$/;
const ID_RE = /^[A-Za-z0-9._-]{8,80}$/;
const PRESENCE_TTL_MS = 45000;
const OPENS_KEY = "tab-opens-v2";
const PRESENCE_PREFIX = "p/";

function noStore(body) {
  const res = jsonResponse(body);
  const headers = new Headers(res.headers);
  headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
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

async function loadLive(store, now) {
  const live = {};
  let blobs = [];
  try {
    const listed = await store.list({ prefix: PRESENCE_PREFIX });
    blobs = listed && listed.blobs ? listed.blobs : [];
  } catch (e) {
    return live;
  }
  const expired = [];
  await Promise.all(
    blobs.slice(0, 400).map(async (blob) => {
      try {
        const info = await store.get(blob.key, { type: "json" });
        const seen = parseInt(info && info.seen, 10) || 0;
        const tab = String((info && info.tab) || "").toLowerCase();
        if (!seen || now - seen > PRESENCE_TTL_MS) {
          expired.push(blob.key);
          return;
        }
        if (!TAB_RE.test(tab)) return;
        live[tab] = (live[tab] || 0) + 1;
      } catch (e) {}
    })
  );
  expired.slice(0, 40).forEach((key) => {
    store.delete(key).catch(() => {});
  });
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
  let opens = {};
  if (request.method === "POST") {
    let body = {};
    try {
      body = await request.json();
    } catch (e) {
      body = {};
    }
    const tab = String(body.tab || "").toLowerCase();
    const id = String(body.id || "").trim();
    if (TAB_RE.test(tab) && ID_RE.test(id)) {
      await store.setJSON(PRESENCE_PREFIX + id, { tab, seen: now });
    }
    if (TAB_RE.test(tab) && body.bump) {
      opens = await bumpOpens(store, tab);
    } else {
      opens = await loadOpens(store);
    }
  } else {
    opens = await loadOpens(store);
  }
  const live = await loadLive(store, now);
  return noStore({ ok: true, counts: payload(opens, live) });
}
