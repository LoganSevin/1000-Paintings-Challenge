import { getStore } from "@netlify/blobs";
import { jsonResponse, corsPreflight } from "./_lib.mjs";

// Sims online: each player's lot + sim look, and who is standing on which lot.
// Free: Netlify Blobs (Cloudflare: the same getStore shim the worker uses).
//
//   POST {op:"publish", sid, key, name, lot, sim, glb?}  owner saves their lot
//   GET  ?op=lot&sid=<hostSid> | ?op=lot&lot=<lotId>     read a lot (read-only)
//   POST {op:"pos", sid, lot, name, sim, x, z, rot, pose, say?}  heartbeat on a lot
//   GET  ?op=pos&lot=<lotId>                             everyone on that lot
//   GET  ?op=list                                        recently shared lots (neighborhood)
//   POST {op:"trade", act, sid, key, name, ...}          player-to-player trades of Sims items / § coins
//        act: list | offer{to,toName,give,want} | counter{id,rev,give,want} | accept{id,rev} | confirm{id,rev} | cancel{id}
//        Offer → counter… → accept (whoever's turn it is) → both confirm → "done". Each browser applies a done trade once.
//        Coins/items are game-only (stored in each player's Sims save). The first key a sid trades with is pinned (hash).
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
const TRADE_TTL_MS = 30 * 60 * 1000;
const TRADE_MIN_MS = 800;
const MAX_OPEN_TRADES = 5;
const ITEM_RE = /^[a-z][a-z0-9_]{1,30}$/;
function cleanGive(g) {
  g = g && typeof g === "object" ? g : {}; const items = {};
  for (const [k, v] of Object.entries(g.items && typeof g.items === "object" ? g.items : {}).slice(0, 12)) { const n = Math.floor(Number(v)); if (ITEM_RE.test(k) && n >= 1 && n <= 999) items[k] = n; }
  return { items, coins: Math.floor(num(g.coins, 0, 100000, 0)) };
}
async function keyHash(key) { const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("sims-trade:" + key))); return Array.from(h.slice(0, 12), (b) => b.toString(16).padStart(2, "0")).join(""); }

function noStore(body, status = 200) {
  const res = jsonResponse(body, status);
  const headers = new Headers(res.headers);
  headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  return new Response(res.body, { status: res.status, headers });
}
const SURF_RE = /^[a-z]{2,12}:\d{1,9}:#[0-9a-fA-F]{3,6}$/;
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
const TOK_RE = /^[a-z]{2,12}$/;
const tok = (v, d) => (TOK_RE.test(String(v || "")) ? String(v) : d);
function cleanSim(s) {
  s = s && typeof s === "object" ? s : {};
  return {
    name: cleanText(s.name, 24) || "Sim",
    skin: color(s.skin, "#e8b48f"), hair: color(s.hair, "#1b1410"), top: color(s.top, "#c9a227"), bottom: color(s.bottom, "#2b2724"),
    hairStyle: tok(s.hairStyle, "short"),
    height: num(s.height, 0.8, 1.2, 1), build: num(s.build, 0.75, 1.4, 1),
    // v2 procedural look: short lowercase tokens + colors only
    outfit: tok(s.outfit, "tee"), bottomStyle: tok(s.bottomStyle, "pants"), pattern: tok(s.pattern, "solid"), pat2: color(s.pat2, "#e8e0d2"),
    shoes: color(s.shoes, "#1d1a18"), eyes: color(s.eyes, "#3a2a1a"), brows: tok(s.brows, "flat"), mouth: tok(s.mouth, "smile"),
    accColor: color(s.accColor, "#c9a227"), acc: (Array.isArray(s.acc) ? s.acc : []).filter((a) => TOK_RE.test(String(a))).slice(0, 6),
    ...cleanShape(s),
  };
}
// sculptable body: morph sliders (15 known keys, -1..1.6) + compressed sculpt deltas (base64 with z1:/r1: prefix)
const MORPH_KEYS = ["weight", "muscle", "chest", "hips", "shoulders", "belly", "faceW", "jaw", "chin", "cheeks", "nose", "lips", "eyes", "ears", "head"];
const SCULPT_RE = /^[zr]1:[A-Za-z0-9+/=]{4,120000}$/;
function cleanShape(s) {
  const out = {};
  if (s.morph && typeof s.morph === "object") { const m = {}; for (const k of MORPH_KEYS) { const v = Number(s.morph[k]); if (Number.isFinite(v) && v !== 0) m[k] = Math.round(Math.max(-1, Math.min(1.6, v)) * 1000) / 1000; } if (Object.keys(m).length) out.morph = m; }
  if (typeof s.sculpt === "string" && s.sculpt.length <= 120003 && SCULPT_RE.test(s.sculpt)) out.sculpt = s.sculpt;
  return out;
}
function cleanLot(l) {
  l = l && typeof l === "object" ? l : {};
  const walls = {}, floors = {}, objects = [];
  for (const [k, w] of Object.entries(l.walls || {}).slice(0, 3000)) {
    const m = /^([hv]):(\d{1,2}):(\d{1,2})$/.exec(k);
    if (!m || +m[2] > N || +m[3] > N || !w) continue;
    walls[k] = { t: ["wall", "door", "window"].includes(w.t) ? w.t : "wall", c: color(w.c, "#e8e0d2") };
    if (/^[a-z]{2,12}:\d{1,9}$/.test(String(w.p || ""))) walls[k].p = String(w.p);
  }
  for (const [k, c] of Object.entries(l.floors || {}).slice(0, N * N)) {
    const m = /^(\d{1,2}),(\d{1,2})$/.exec(k);
    if (m && +m[1] < N && +m[2] < N) floors[k] = SURF_RE.test(String(c || "")) ? String(c) : color(c, "#b89970");
  }
  for (const o of (Array.isArray(l.objects) ? l.objects : []).slice(0, 400)) {
    if (!o || !(/^[a-z]{2,10}$/.test(String(o.type)) || /^gen:[a-z]{2,14}:\d{1,10}$/.test(String(o.type)))) continue; // custom imports stay local
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
  try { const t = await request.text(); if (!t || t.length > MAX_LOT_BYTES + MAX_GLB_CHARS + 124000) return null; return JSON.parse(t); } catch (e) { return null; }
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
    if (op !== "list" && !LOT_RE.test(lot)) {
      const sid = String(url.searchParams.get("sid") || "");
      if (!SID_RE.test(sid)) return noStore({ ok: false, error: "lot or sid required" }, 400);
      const idx = await readJSON(store, "sid-index", {});
      const hit = idx[sid];
      if (!hit || now - hit.ts > SID_TTL_MS) return noStore({ ok: false, error: "That player hasn't shared a lot yet" }, 404);
      lot = hit.lot;
    }
    if (op === "list") {
      // recently shared lots for the streamed neighborhood (no custom meshes)
      const idx = await readJSON(store, "sid-index", {});
      const seen = new Set(), rows = [];
      for (const [s, v] of Object.entries(idx).sort((a, b) => (b[1].ts || 0) - (a[1].ts || 0))) {
        if (!v || now - v.ts > SID_TTL_MS || seen.has(v.lot) || !LOT_RE.test(v.lot)) continue;
        seen.add(v.lot); if (rows.length >= 12) break;
        const d = await readJSON(store, "lot-" + v.lot, null);
        if (d) rows.push({ lotId: v.lot, sid: s, name: d.name, sim: d.sim, lot: d.lot, updatedAt: d.updatedAt });
      }
      return noStore({ ok: true, now, lots: rows });
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
    if (JSON.stringify(record).length > MAX_LOT_BYTES + MAX_GLB_CHARS + 120100) return noStore({ ok: false, error: "Lot too large" }, 413);
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
      name: cleanText(body.name, 32) || "guest", sim: (({ sculpt, ...rest }) => rest)(cleanSim(body.sim)), // sculpts ride on publish, not presence pings
      x: num(body.x, -1, N, 0), z: num(body.z, -1, N, 0), rot: num(body.rot, -10, 10, 0),
      pose: ["walk", "stand", "sit", "lie", "paint", "shower"].includes(body.pose) ? body.pose : "stand",
      host: body.host === true, ts: now, say,
    };
    if (body.leave === true) delete map[sid];
    map = prunePos(map, now);
    try { await store.setJSON("pos-" + lot, map); } catch (e) { return noStore({ ok: false, error: "Store failed" }, 500); }
    return noStore({ ok: true, now, people: map });
  }
  if (body.op === "trade") return trade(store, body, sid, now);
  return noStore({ ok: false, error: "Unknown op" }, 400);
}

async function trade(store, body, sid, now) {
  const key = String(body.key || ""), act = String(body.act || "");
  if (!KEY_RE.test(key)) return noStore({ ok: false, error: "Invalid key" }, 400);
  // trust-on-first-use: a sid is bound to the first owner key that trades with it
  const kh = await keyHash(key), pin = await readJSON(store, "tkey-" + sid, null);
  if (pin && pin.h !== kh) return noStore({ ok: false, error: "That player id belongs to another browser" }, 403);
  const rate = await readJSON(store, "trate-" + sid, 0);
  if (now - (Number(rate) || 0) < TRADE_MIN_MS) return noStore({ ok: false, error: "Slow down" }, 429);
  const all = (await readJSON(store, "trades", [])).filter((t) => t && now - (t.ts || 0) < TRADE_TTL_MS);
  const mineOf = () => all.filter((t) => t.a === sid || t.b === sid);
  const reply = (extra) => noStore({ ok: true, now, trades: mineOf(), ...(extra || {}) });
  const fail = (error, status = 400) => noStore({ ok: false, error, now, trades: mineOf() }, status);
  const saveAll = async () => { await store.setJSON("trades", all.slice(-300)); await store.setJSON("trate-" + sid, now); if (!pin) await store.setJSON("tkey-" + sid, { h: kh, ts: now }); };
  if (act === "list") return reply();
  const name = cleanText(body.name, 32) || "guest";
  try {
    if (act === "offer") {
      const to = String(body.to || "");
      if (!SID_RE.test(to) || to === sid) return fail("Pick another player to trade with");
      if (mineOf().filter((t) => t.status === "open" || t.status === "accepted").length >= MAX_OPEN_TRADES) return fail("Too many open trades", 429);
      const give = cleanGive(body.give), want = cleanGive(body.want);
      if (!Object.keys(give.items).length && !give.coins && !Object.keys(want.items).length && !want.coins) return fail("Empty trade");
      const id = "t" + now.toString(36) + Math.floor(Math.random() * 1e6).toString(36);
      all.push({ id, a: sid, b: to, aName: name, bName: cleanText(body.toName, 32) || "neighbor", aGives: give, bGives: want, rev: 1, turn: "b", status: "open", conf: { a: false, b: false }, ts: now });
      await saveAll(); return reply({ id });
    }
    const t = all.find((x) => x.id === String(body.id || ""));
    if (!t || (t.a !== sid && t.b !== sid)) return fail("No such trade", 404);
    const side = t.a === sid ? "a" : "b";
    if (side === "a") t.aName = name; else t.bName = name;
    if (act === "cancel") { if (t.status === "done") return fail("Already done"); t.status = "cancelled"; t.ts = now; await saveAll(); return reply(); }
    if (Number(body.rev) !== t.rev) return fail("The offer changed — take another look", 409);
    if (act === "counter") {
      if (t.status !== "open" || t.turn !== side) return fail("Not your move");
      const give = cleanGive(body.give), want = cleanGive(body.want);
      if (side === "a") { t.aGives = give; t.bGives = want; } else { t.bGives = give; t.aGives = want; }
      t.rev++; t.turn = side === "a" ? "b" : "a"; t.conf = { a: false, b: false }; t.ts = now; await saveAll(); return reply();
    }
    if (act === "accept") { if (t.status !== "open" || t.turn !== side) return fail("Not your move"); t.status = "accepted"; t.conf = { a: false, b: false }; t.ts = now; await saveAll(); return reply(); }
    if (act === "confirm") {
      if (t.status !== "accepted") return fail("Accept first");
      t.conf[side] = true; if (t.conf.a && t.conf.b) t.status = "done"; t.ts = now; await saveAll(); return reply();
    }
  } catch (e) { return noStore({ ok: false, error: "Store failed" }, 500); }
  return fail("Unknown trade action");
}
