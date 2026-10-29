import { getStore } from "@netlify/blobs";
import { jsonResponse, corsPreflight } from "./_lib.mjs";

// Sims online: each player's lot + sim look, and who is standing on which lot.
// Free: Netlify Blobs (Cloudflare: the same getStore shim the worker uses).
//
//   POST {op:"publish", sid, key, name, lot, sim, glb?}  owner saves their lot
//   GET  ?op=lot&sid=<hostSid> | ?op=lot&lot=<lotId>     read a lot (read-only)
//   POST {op:"pos", sid, lot, name, sim, x, z, rot, pose, say?}  heartbeat on a lot
//   GET  ?op=pos&lot=<lotId>                             everyone on that lot
//
// `key` is a private random string kept in the owner's browser. The public lot
// id is a hash of it, so nobody else can overwrite a lot (visitors are read-only).
const STORE = "sims-online";
const SID_RE = /^[A-Za-z0-9._-]{8,80}$/;
const LOT_RE = /^[a-f0-9]{20}$/;
const KEY_RE = /^[A-Za-z0-9_-]{20,80}$/;
const MAX_LOT_BYTES = 120000;
const MAX_GLB_CHARS = 160000; // ~120 KB binary; bigger custom meshes fall back to the default body
const POS_TTL_MS = 15000;
const POS_MIN_MS = 350;
const SAY_MIN_MS = 1500;
const MAX_SAY = 140;
const MAX_ON_LOT = 24;
const SID_TTL_MS = 10 * 60 * 1000;
const N = 24;

function noStore(body, status = 200) {
  const res = jsonResponse(body, status);
  const headers = new Headers(res.headers);
  headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  return new Response(res.body, { status: res.status, headers });
}
const COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;
const color = (c, d) => (COLOR_RE.test(String(c || "")) ? String(c) : d);
const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
function cleanText(raw, max) {
  return String(raw || "")
    .replace(/<[^>]*>/g, "")
    .replace(/[<>]/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}
function cleanSim(s) {
  s = s && typeof s === "object" ? s : {};
  return {
    name: cleanText(s.name, 24) || "Sim",
    skin: color(s.skin, "#e8b48f"), hair: color(s.hair, "#1b1410"), top: color(s.top, "#c9a227"), bottom: color(s.bottom, "#2b2724"),
    hairStyle: ["short", "long", "bun", "bald"].includes(s.hairStyle) ? s.hairStyle : "short",
    height: num(s.height, 0.8, 1.2, 1), build: num(s.build, 0.75, 1.4, 1),
  };
}
function cleanLot(l) {
  l = l && typeof l === "object" ? l : {};
  const walls = {}, floors = {}, objects = [];
  for (const [k, w] of Object.entries(l.walls || {}).slice(0, 3000)) {
    const m = /^([hv]):(\d{1,2}):(\d{1,2})$/.exec(k);
    if (!m || +m[2] > N || +m[3] > N || !w) continue;
    walls[k] = { t: ["wall", "door", "window"].includes(w.t) ? w.t : "wall", c: color(w.c, "#e8e0d2") };
  }
  for (const [k, c] of Object.entries(l.floors || {}).slice(0, N * N)) {
    const m = /^(\d{1,2}),(\d{1,2})$/.exec(k);
    if (m && +m[1] < N && +m[2] < N) floors[k] = color(c, "#b89970");
  }
  for (const o of (Array.isArray(l.objects) ? l.objects : []).slice(0, 400)) {
    if (!o || !/^[a-z]{2,10}$/.test(String(o.type))) continue; // custom imports stay local
    objects.push({ id: cleanText(o.id, 20) || "o", type: o.type, x: num(o.x, 0, N - 1, 0) | 0, z: num(o.z, 0, N - 1, 0) | 0, rot: num(o.rot, 0, 3, 0) | 0, on: o.on !== false });
  }
  return { walls, floors, objects };
}
async function lotIdOf(key) {
  const data = new TextEncoder().encode("sims-lot:" + key);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return Array.from(hash.slice(0, 10), (b) => b.toString(16).padStart(2, "0")).join("");
}
async function readJSON(store, key, fallback) {
  try { const v = await store.get(key, { type: "json" }); return v == null ? fallback : v; } catch (e) { return fallback; }
}
async function readBody(request) {
  try { const t = await request.text(); if (!t || t.length > MAX_LOT_BYTES + MAX_GLB_CHARS + 4000) return null; return JSON.parse(t); } catch (e) { return null; }
}
function prunePos(map, now) {
  const out = {};
  const rows = Object.entries(map && typeof map === "object" ? map : {})
    .filter(([sid, p]) => SID_RE.test(sid) && p && now - (p.ts || 0) < POS_TTL_MS)
    .sort((a, b) => b[1].ts - a[1].ts)
    .slice(0, MAX_ON_LOT);
  for (const [sid, p] of rows) out[sid] = p;
  return out;
}

export default async function handler(request) {
  if (request.method === "OPTIONS") return corsPreflight();
  const store = getStore({ name: STORE, consistency: "strong" });
  const url = new URL(request.url);
  const now = Date.now();

  if (request.method === "GET") {
    const op = url.searchParams.get("op");
    let lot = String(url.searchParams.get("lot") || "");
    if (!LOT_RE.test(lot)) {
      const sid = String(url.searchParams.get("sid") || "");
      if (!SID_RE.test(sid)) return noStore({ ok: false, error: "lot or sid required" }, 400);
      const idx = await readJSON(store, "sid-index", {});
      const hit = idx[sid];
      if (!hit || now - hit.ts > SID_TTL_MS) return noStore({ ok: false, error: "That player hasn't shared a lot yet" }, 404);
      lot = hit.lot;
    }
    if (op === "pos") return noStore({ ok: true, lot, now, people: prunePos(await readJSON(store, "pos-" + lot, {}), now) });
    const data = await readJSON(store, "lot-" + lot, null);
    if (!data) return noStore({ ok: false, error: "No lot" }, 404);
    return noStore({ ...data, ok: true, lotId: lot });
  }
  if (request.method !== "POST") return noStore({ ok: false, error: "Method not allowed" }, 405);

  const body = await readBody(request);
  if (!body || typeof body !== "object") return noStore({ ok: false, error: "Invalid JSON or too large" }, 400);
  const sid = String(body.sid || "");
  if (!SID_RE.test(sid)) return noStore({ ok: false, error: "Invalid sid" }, 400);

  if (body.op === "publish") {
    const key = String(body.key || "");
    if (!KEY_RE.test(key)) return noStore({ ok: false, error: "Invalid key" }, 400);
    const lot = await lotIdOf(key);
    const prev = await readJSON(store, "lot-" + lot, null);
    if (prev && now - (prev.updatedAt || 0) < 2000) return noStore({ ok: false, error: "Slow down", lot }, 429);
    const record = { name: cleanText(body.name, 32) || "guest", owner: sid, sim: cleanSim(body.sim), lot: cleanLot(body.lot), updatedAt: now };
    const glb = typeof body.glb === "string" && body.glb.length <= MAX_GLB_CHARS && /^[A-Za-z0-9+/=]+$/.test(body.glb) ? body.glb : null;
    if (glb) record.glb = glb;
    if (JSON.stringify(record).length > MAX_LOT_BYTES + MAX_GLB_CHARS) return noStore({ ok: false, error: "Lot too large" }, 413);
    const idx = await readJSON(store, "sid-index", {});
    const nextIdx = {};
    for (const [s, v] of Object.entries(idx)) if (v && now - v.ts < SID_TTL_MS && v.lot !== lot) nextIdx[s] = v;
    nextIdx[sid] = { lot, ts: now };
    try { await store.setJSON("lot-" + lot, record); await store.setJSON("sid-index", nextIdx); }
    catch (e) { return noStore({ ok: false, error: "Store failed" }, 500); }
    return noStore({ ok: true, lot, glb: !!glb, glbDropped: !!body.glb && !glb });
  }

  if (body.op === "pos") {
    const lot = String(body.lot || "");
    if (!LOT_RE.test(lot)) return noStore({ ok: false, error: "Invalid lot" }, 400);
    let map = prunePos(await readJSON(store, "pos-" + lot, {}), now);
    const prev = map[sid];
    if (prev && now - prev.ts < POS_MIN_MS) return noStore({ ok: false, error: "Slow down", people: map, now }, 429);
    let say = prev && prev.say ? prev.say : null;
    const text = cleanText(body.say, MAX_SAY);
    if (text) {
      if (prev && prev.say && now - prev.say.ts < SAY_MIN_MS) return noStore({ ok: false, error: "Slow down", people: map, now }, 429);
      say = { text, ts: now };
    }
    if (say && now - say.ts > 8000) say = null;
    map[sid] = {
      name: cleanText(body.name, 32) || "guest", sim: cleanSim(body.sim),
      x: num(body.x, -1, N, 0), z: num(body.z, -1, N, 0), rot: num(body.rot, -10, 10, 0),
      pose: ["walk", "stand", "sit", "lie", "paint", "shower"].includes(body.pose) ? body.pose : "stand",
      host: body.host === true, ts: now, say,
    };
    if (body.leave === true) delete map[sid];
    map = prunePos(map, now);
    try { await store.setJSON("pos-" + lot, map); } catch (e) { return noStore({ ok: false, error: "Store failed" }, 500); }
    return noStore({ ok: true, now, people: map });
  }
  return noStore({ ok: false, error: "Unknown op" }, 400);
}
