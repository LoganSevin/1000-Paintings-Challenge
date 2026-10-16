import { getStore } from "@netlify/blobs";
import { jsonResponse, corsPreflight } from "./_lib.mjs";

const KEY = "live";
const ROOM_W = 22;
const ROOM_H = 14;
const TTL_MS = 12000;
const MAX_PLAYERS = 12;
const MAX_HITS = 12;
const ID_RE = /^[a-z0-9-]{8,40}$/;
const ENEMY_RE = /^[a-z0-9-]{1,24}$/i;

function noStore(body, status = 200) {
  const res = jsonResponse(body, status);
  const headers = new Headers(res.headers);
  headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  return new Response(res.body, { status: res.status, headers });
}

function num(v, fallback, lo, hi) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

function cleanName(v) {
  return String(v || "")
    .replace(/<[^>]*>/g, "")
    .replace(/[\u0000-\u001F]/g, "")
    .trim()
    .slice(0, 32) || "guest";
}

function cleanSprite(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (let i = 0; i < list.length && out.length < 4; i++) {
    const s = String(list[i] || "");
    if (!/^data:image\/(?:png|jpeg);base64,[a-z0-9+/=]+$/i.test(s)) continue;
    if (s.length > 16000) continue;
    out.push(s);
  }
  return out;
}

function capFor(floor) {
  return Math.min(12, 3 + floor * 2);
}

function blank() {
  return { updated: 0, floor: 1, seq: 1, door: false, players: {}, enemies: [] };
}

async function load(store) {
  try {
    const raw = await store.get(KEY, { type: "json" });
    if (raw && typeof raw === "object" && raw.players) return raw;
  } catch (e) {}
  return blank();
}

function prunePlayers(state, now) {
  const entries = Object.entries(state.players || {});
  entries.sort((a, b) => (b[1].ts || 0) - (a[1].ts || 0));
  const next = {};
  for (const [id, p] of entries) {
    if (!ID_RE.test(id) || !p || now - (p.ts || 0) > TTL_MS) continue;
    next[id] = p;
    if (Object.keys(next).length >= MAX_PLAYERS) break;
  }
  state.players = next;
}

function nearest(e, players) {
  let best = null;
  let bestD = 1e9;
  const list = Object.values(players);
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (!p || p.hp <= 0) continue;
    const dx = p.x - e.x;
    const dy = p.y - e.y;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return { target: best, dist: Math.sqrt(bestD) };
}

function stepEnemies(state, dt) {
  const list = state.enemies || [];
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    const near = nearest(e, state.players);
    if (!near.target || near.dist < 0.45) continue;
    const spd = e.spd || 1.2;
    e.x += ((near.target.x - e.x) / near.dist) * spd * dt;
    e.y += ((near.target.y - e.y) / near.dist) * spd * dt;
    e.x = num(e.x, 2, 1.1, ROOM_W - 1.1);
    e.y = num(e.y, 2, 1.1, ROOM_H - 1.1);
  }
}

function spawnOne(state, edge) {
  const floor = state.floor || 1;
  const hp = 6 + floor * 4;
  let x = 1.6;
  let y = 2 + (state.seq % 9);
  if (edge === 1) x = ROOM_W - 1.6;
  if (edge === 2) {
    x = 3 + (state.seq % 14);
    y = 1.6;
  }
  if (edge === 3) {
    x = 3 + (state.seq % 14);
    y = ROOM_H - 1.6;
  }
  state.seq = (state.seq || 1) + 1;
  return {
    id: "f" + floor + "n" + state.seq,
    x: x,
    y: y,
    hp: hp,
    maxHp: hp,
    spd: Math.min(2.4, 1.15 + floor * 0.05),
  };
}

function fillEnemies(state) {
  state.enemies = Array.isArray(state.enemies) ? state.enemies : [];
  const cap = capFor(state.floor || 1);
  let guard = 0;
  while (state.enemies.length < cap && guard < cap) {
    state.enemies.push(spawnOne(state, state.enemies.length % 4));
    guard += 1;
  }
}

function applyHits(state, hits) {
  const killed = [];
  if (!Array.isArray(hits)) return killed;
  const byId = {};
  for (let i = 0; i < state.enemies.length; i++) byId[state.enemies[i].id] = state.enemies[i];
  const seen = {};
  for (let i = 0; i < hits.length && i < MAX_HITS; i++) {
    const hit = hits[i] || {};
    const id = String(hit.id || "");
    if (!ENEMY_RE.test(id) || seen[id]) continue;
    seen[id] = 1;
    const e = byId[id];
    if (!e) continue;
    e.hp -= num(hit.dmg, 1, 1, 80);
    if (e.hp <= 0) killed.push(id);
  }
  state.enemies = state.enemies.filter((e) => e.hp > 0);
  return killed;
}

function publicPlayer(p, includeSprite) {
  const out = {
    id: p.id,
    name: p.name,
    x: p.x,
    y: p.y,
    face: p.face,
    cycle: p.cycle,
    frame: p.frame,
    level: p.level,
    hp: p.hp,
    maxHp: p.maxHp,
    spriteRev: p.spriteRev || 0,
  };
  if (includeSprite && p.sprite && p.sprite.length) out.sprite = p.sprite;
  return out;
}

export default async function handler(request) {
  if (request.method === "OPTIONS") return corsPreflight();
  if (request.method !== "POST") return noStore({ ok: false, error: "POST required" }, 405);

  let body = {};
  try {
    body = await request.json();
  } catch (e) {
    return noStore({ ok: false, error: "Invalid JSON" }, 400);
  }

  const id = String(body.id || "");
  if (!ID_RE.test(id)) return noStore({ ok: false, error: "Invalid id" }, 400);

  const store = getStore({ name: "sprite-dungeon", consistency: "strong" });
  const now = Date.now();
  const state = await load(store);
  prunePlayers(state, now);

  const prev = state.players[id] || {};
  const known = body.known && typeof body.known === "object" ? body.known : {};
  let sprite = prev.sprite || [];
  let spriteRev = prev.spriteRev || 0;
  const nextRev = parseInt(body.spriteRev, 10) || 0;
  if (nextRev && nextRev !== spriteRev) {
    const packed = cleanSprite(body.sprite);
    if (packed.length) {
      sprite = packed;
      spriteRev = nextRev;
    }
  }

  state.players[id] = {
    id: id,
    name: cleanName(body.name),
    x: num(body.x, ROOM_W / 2, 1.1, ROOM_W - 1.1),
    y: num(body.y, ROOM_H / 2, 1.1, ROOM_H - 1.1),
    face: num(body.face, 1, -1, 1) < 0 ? -1 : 1,
    cycle: ["idle", "walk", "burst"].indexOf(body.cycle) >= 0 ? body.cycle : "idle",
    frame: num(body.frame, 0, 0, 5),
    level: num(body.level, 1, 1, 99),
    hp: num(body.hp, 30, 0, 999),
    maxHp: num(body.maxHp, 30, 1, 999),
    sprite: sprite,
    spriteRev: spriteRev,
    ts: now,
  };

  state.enemies = Array.isArray(state.enemies) ? state.enemies : [];
  const dt = state.updated ? Math.min(0.45, Math.max(0, (now - state.updated) / 1000)) : 0;
  stepEnemies(state, dt);
  const hadEnemies = state.enemies.length > 0;
  const killed = applyHits(state, body.hits);
  if (hadEnemies && state.enemies.length === 0) state.door = true;

  // A cleared room stays empty so the door can be used. Entering it opens the next floor.
  if (state.door && body.enter) {
    state.floor = num((state.floor || 1) + 1, 2, 1, 40);
    state.door = false;
    state.enemies = [];
    fillEnemies(state);
  } else if (!state.enemies.length && !state.door) {
    fillEnemies(state);
  }

  state.updated = now;
  try {
    await store.setJSON(KEY, state);
  } catch (e) {
    return noStore({ ok: false, error: "The dungeon did not save." }, 500);
  }

  const players = [];
  const ids = Object.keys(state.players);
  for (let i = 0; i < ids.length; i++) {
    if (ids[i] === id) continue;
    const p = state.players[ids[i]];
    const want = String(known[ids[i]] || "") !== String(p.spriteRev || 0);
    players.push(publicPlayer(p, want));
  }

  return noStore({
    ok: true,
    now: now,
    floor: state.floor || 1,
    roomW: ROOM_W,
    roomH: ROOM_H,
    players: players,
    enemies: state.enemies,
    killed: killed,
  });
}
