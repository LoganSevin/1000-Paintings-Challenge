// Sims life systems: real-time clock + sun, farming, fishing, inventory, market, player trading,
// and the right-click / long-press action menu (data-driven registry). Loaded by js/sims.js.
// Everything here lives in the Sims save only; the § currency is never site credits or real money.
import * as THREE0 from "three";
let T = THREE0, X = null; // THREE, host context from sims.js
const CH = 36, SW = 14.25, WATER_Y = -1.4;

// ---------------- items ----------------
export const CROPS = {
  tomato: { label: "Tomato", icon: "🍅", grow: 40, seed: 6, sell: 14, hunger: 10, color: "#d8402c" },
  corn: { label: "Corn", icon: "🌽", grow: 75, seed: 8, sell: 20, hunger: 12, color: "#e8c23a" },
  wheat: { label: "Wheat", icon: "🌾", grow: 30, seed: 4, sell: 9, hunger: 4, color: "#d9b45a" },
  pumpkin: { label: "Pumpkin", icon: "🎃", grow: 180, seed: 14, sell: 48, hunger: 14, color: "#e0782a" },
  berries: { label: "Berries", icon: "🫐", grow: 60, seed: 10, sell: 22, hunger: 8, color: "#5a3a9a" },
  carrot: { label: "Carrot", icon: "🥕", grow: 25, seed: 5, sell: 11, hunger: 9, color: "#ee7a22" },
  flower: { label: "Flowers", icon: "🌸", grow: 15, seed: 3, sell: 8, hunger: 0, color: "#e47aa8" },
}; // grow = real minutes of watered time
export const FISH = [
  // id, label, water kinds, times (dawn/day/dusk/night), seasons, rarity, base price
  ["minnow", "Minnow", "river canal lake", "*", "*", "common", 4], ["bluegill", "Bluegill", "lake canal", "dawn day dusk", "*", "common", 8],
  ["perch", "Yellow Perch", "lake river", "day dusk", "*", "common", 10], ["carp", "Carp", "canal lake river", "*", "*", "common", 9],
  ["catfish", "Catfish", "river canal", "dusk night", "*", "uncommon", 22], ["bass", "Largemouth Bass", "lake", "dawn dusk", "spring summer autumn", "uncommon", 26],
  ["trout", "Rainbow Trout", "river", "dawn day", "spring autumn winter", "uncommon", 28], ["pike", "Northern Pike", "lake river", "day", "autumn winter spring", "uncommon", 30],
  ["eel", "Eel", "canal river", "night", "summer autumn", "rare", 55], ["salmon", "Salmon", "river", "dawn dusk", "autumn", "rare", 70],
  ["koi", "Koi", "lake canal", "day", "spring summer", "rare", 80], ["sturgeon", "Sturgeon", "river lake", "night dawn", "winter spring", "rare", 95],
  ["goldfish", "Golden Carp", "canal", "dusk", "*", "legendary", 220], ["moonfish", "Moon Gar", "lake", "night", "winter autumn", "legendary", 260],
  ["gar", "Longnose Gar", "river canal", "day dusk", "summer", "uncommon", 24], ["crappie", "Crappie", "lake", "dawn night", "spring winter", "common", 12],
].map(([id, label, water, times, seasons, rarity, price]) => ({ id, label, water: water.split(" "), times: times === "*" ? null : times.split(" "), seasons: seasons === "*" ? null : seasons.split(" "), rarity, price }));
const FISH_BY = Object.fromEntries(FISH.map((f) => [f.id, f]));
const RARITY = { common: { w: 60, zone: 0.26, speed: 0.9 }, uncommon: { w: 25, zone: 0.19, speed: 1.25 }, rare: { w: 10, zone: 0.13, speed: 1.6 }, legendary: { w: 2.5, zone: 0.09, speed: 2.0 } };
export const DISHES = {
  grilled_fish: { label: "Grilled Fish", icon: "🐟", need: [["fish", 1]], hunger: 40, sell: 0 },
  fish_stew: { label: "Fish Stew", icon: "🍲", need: [["fish", 1], ["carrot", 1], ["tomato", 1]], hunger: 75, sell: 70 },
  veggie_stew: { label: "Veggie Stew", icon: "🥘", need: [["veg", 2]], hunger: 55, sell: 40 },
  salad: { label: "Garden Salad", icon: "🥗", need: [["tomato", 1], ["carrot", 1]], hunger: 35, sell: 32 },
  corn_bread: { label: "Corn Bread", icon: "🍞", need: [["corn", 1], ["wheat", 1]], hunger: 45, sell: 38 },
  pumpkin_pie: { label: "Pumpkin Pie", icon: "🥧", need: [["pumpkin", 1], ["wheat", 2]], hunger: 70, sell: 95 },
  berry_jam: { label: "Berry Jam Toast", icon: "🍓", need: [["berries", 1], ["wheat", 1]], hunger: 40, sell: 40 },
  bouquet: { label: "Bouquet", icon: "💐", need: [["flower", 3]], hunger: 0, fun: 25, sell: 40, craft: true },
};
const VEG = ["tomato", "carrot", "corn", "pumpkin"];
export function itemInfo(id) {
  if (CROPS[id]) return { ...CROPS[id], kind: "crop", price: CROPS[id].sell };
  if (id.startsWith("seed_") && CROPS[id.slice(5)]) { const c = CROPS[id.slice(5)]; return { label: c.label + " seeds", icon: "🌱", kind: "seed", price: c.seed }; }
  if (id.startsWith("fish_") && FISH_BY[id.slice(5)]) { const f = FISH_BY[id.slice(5)]; return { label: f.label, icon: "🐟", kind: "fish", rarity: f.rarity, price: f.price }; }
  if (id.startsWith("dish_") && DISHES[id.slice(5)]) { const d = DISHES[id.slice(5)]; const raw = d.need.reduce((s, [k, n]) => s + n * (k === "fish" ? 8 : k === "veg" ? 12 : (CROPS[k] ? CROPS[k].sell : 5)), 0); return { ...d, kind: "dish", price: d.sell || Math.round(raw * 1.6) }; }
  return null;
}
export const ALL_ITEMS = [...Object.keys(CROPS), ...Object.keys(CROPS).map((c) => "seed_" + c), ...FISH.map((f) => "fish_" + f.id), ...Object.keys(DISHES).map((d) => "dish_" + d)];

// ---------------- save data ----------------
function H() { return X.home(); }
function life() { const s = H(); if (!s) return null; s.life = s.life || {}; const L = s.life;
  L.coins = Number.isFinite(L.coins) ? L.coins : 120; L.inv = L.inv || { seed_tomato: 3, seed_carrot: 3, seed_flower: 2 }; L.crops = L.crops || {}; L.garden = L.garden || {};
  L.fishlog = L.fishlog || {}; L.trades = L.trades || []; if (L.realTime == null) L.realTime = true; return L; }
export const inv = () => life().inv;
function addItem(id, n) { const I = inv(); I[id] = Math.max(0, (I[id] || 0) + n); if (!I[id]) delete I[id]; }
function has(id, n) { return (inv()[id] || 0) >= n; }
function fmtCoins(n) { return "§" + Math.round(n).toLocaleString(); }

// ---------------- real clock + sun ----------------
const LAT = (() => { try { const z = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; const M = { "America/Chicago": 41.9, "America/New_York": 40.7, "America/Los_Angeles": 34.1, "America/Denver": 39.7, "America/Phoenix": 33.4, "Europe/London": 51.5, "Europe/Paris": 48.9, "Europe/Berlin": 52.5, "Asia/Tokyo": 35.7, "Australia/Sydney": -33.9, "Asia/Kolkata": 19.1, "America/Sao_Paulo": -23.5 }; return M[z] ?? 40; } catch (e) { return 40; } })();
function dayOfYear(d) { return Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 864e5); }
function isDST(d) { const j = new Date(d.getFullYear(), 0, 1).getTimezoneOffset(), u = new Date(d.getFullYear(), 6, 1).getTimezoneOffset(); return Math.max(j, u) !== d.getTimezoneOffset(); }
export function sunAt(d, hours) {
  const n = dayOfYear(d), rad = Math.PI / 180, lat = LAT * rad;
  const decl = 23.44 * rad * Math.sin((2 * Math.PI * (284 + n)) / 365);
  const B = (2 * Math.PI * (n - 81)) / 364, eot = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B); // minutes
  const noon = 12 + (isDST(d) ? 1 : 0) - eot / 60;
  const cosH0 = (Math.sin(-0.833 * rad) - Math.sin(lat) * Math.sin(decl)) / (Math.cos(lat) * Math.cos(decl));
  const H0 = Math.acos(Math.max(-1, Math.min(1, cosH0))) / rad / 15;
  const ha = (hours - noon) * 15 * rad;
  const sinEl = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha);
  const el = Math.asin(sinEl);
  const az = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat)); // 0 = south, + west
  return { elev: el / rad, az, sunrise: noon - H0, sunset: noon + H0, noon };
}
// time preview: when set, the displayed time of day (sun, moon, sky, lights, NPC routines) follows a chosen moment.
// Farming and other progress keep using Date.now(), so previewing never speeds anything up.
let previewFn = null;
export function setPreview(fn) { previewFn = fn; }
export function clockState(Sgame) {
  const L = life(), pv = previewFn && previewFn(), now = pv || new Date();
  const real = !!pv || !L || L.realTime || X.visiting();
  const hours = real ? now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600 : (((Sgame.minutes / 60) % 24) + 24) % 24;
  return { real, hours, date: now, sun: sunAt(now, hours), day: real ? dayOfYear(now) : Math.floor(Sgame.minutes / 1440) + 1 };
}
export function partOfDay(c) { const s = c.sun; if (c.hours > s.sunrise - 0.75 && c.hours < s.sunrise + 1.25) return "dawn"; if (c.hours > s.sunset - 1.25 && c.hours < s.sunset + 0.75) return "dusk"; return s.elev > 0 ? "day" : "night"; }
const hm = (h) => { h = ((h % 24) + 24) % 24; const H2 = Math.floor(h), M2 = Math.floor((h - H2) * 60); return ((H2 + 11) % 12 + 1) + ":" + String(M2).padStart(2, "0") + (H2 < 12 ? " AM" : " PM"); };
export function clockLabel(c) {
  { const cb = X && X.$ && X.$("sims-realtime"), L = life(); if (cb && L && cb.checked !== !!L.realTime) cb.checked = !!L.realTime; }
  const icon = c.sun.elev > 6 ? "☀" : c.sun.elev > -6 ? "🌅" : "☾";
  const d = c.real ? c.date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) + " · " : "Day " + c.day + " · ";
  return icon + " " + d + hm(c.hours) + (c.real ? "" : " (game)") + " · ↑" + hm(c.sun.sunrise) + " ↓" + hm(c.sun.sunset);
}
// sky colour from sun elevation (degrees)
const SKYK = [[-90, "#070b16"], [-14, "#0b1222"], [-6, "#232c52"], [-1.5, "#d07a5a"], [3, "#efa070"], [10, "#a8cdea"], [90, "#8ec2ec"]];
export function skyColor(el) { for (let i = 1; i < SKYK.length; i++) if (el <= SKYK[i][0]) { const [a, ca] = SKYK[i - 1], [b, cb] = SKYK[i]; return new T.Color(ca).lerp(new T.Color(cb), (el - a) / (b - a)); } return new T.Color(SKYK[SKYK.length - 1][1]); }

// ---------------- off-lot routing on the sidewalk grid ----------------
const cl = (v, a, b) => Math.max(a, Math.min(b, v));
function ringEntry(p) {
  const i = Math.round(p.x / CH), j = Math.round(p.z / CH), lx = p.x - i * CH, lz = p.z - j * CH;
  if (Math.abs(lx) >= SW || Math.abs(lz) >= SW) return { x: i * CH + cl(lx, -SW, SW), z: j * CH + cl(lz, -SW, SW) };
  return Math.abs(lx) > Math.abs(lz) ? { x: i * CH + Math.sign(lx) * SW, z: p.z } : { x: p.x, z: j * CH + Math.sign(lz || 1) * SW };
}
function nearCorner(e, toward) {
  const i = Math.round(e.x / CH), j = Math.round(e.z / CH); let best = null;
  const lx = e.x - i * CH, lz = e.z - j * CH, onZ = Math.abs(Math.abs(lz) - SW) < 0.05, onX = Math.abs(Math.abs(lx) - SW) < 0.05;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { if ((onZ && !onX && sz !== Math.sign(lz)) || (onX && !onZ && sx !== Math.sign(lx))) continue; const c = { x: i * CH + sx * SW, z: j * CH + sz * SW }; const d = Math.hypot(c.x - e.x, c.z - e.z) + 0.15 * Math.hypot(c.x - toward.x, c.z - toward.z); if (!best || d < best.d) best = { ...c, d }; }
  return { x: best.x, z: best.z };
}
export function route(from, to) {
  const e1 = ringEntry(from), e2 = ringEntry(to);
  const sameChunk = Math.round(e1.x / CH) === Math.round(e2.x / CH) && Math.round(e1.z / CH) === Math.round(e2.z / CH);
  const pts = [e1];
  if (!sameChunk || (Math.abs(e1.x - e2.x) > 0.5 && Math.abs(e1.z - e2.z) > 0.5)) { const c1 = nearCorner(e1, to), c2 = nearCorner(e2, from); pts.push(c1, { x: c2.x, z: c1.z }, c2); }
  pts.push(e2, { x: to.x, z: to.z });
  const out = []; for (const p of pts) { const q = out[out.length - 1]; if (!q || Math.hypot(q.x - p.x, q.z - p.z) > 0.2) out.push(p); }
  return out;
}

// ---------------- farming ----------------
const MIN = 60000, DRY = 60 * MIN, WILT = 90 * MIN;
export function plotTiles() {
  const s = X.S(), out = new Map(); if (X.visiting()) return out;
  for (const k in life().garden) out.set(k, { k, bed: false });
  for (const o of s.objects) if (o.type === "gardenbed") { const { W, D } = X.footprint(o); for (let i = 0; i < W; i++) for (let j = 0; j < D; j++) out.set((o.x + i) + "," + (o.z + j), { k: (o.x + i) + "," + (o.z + j), bed: true, objId: o.id }); }
  return out;
}
function growCrop(c, now) {
  if (c.dead) return c;
  const wetUntil = c.w + DRY, grow = CROPS[c.c].grow * MIN;
  if (c.g < grow) { c.g = Math.min(grow, c.g + Math.max(0, Math.min(now, wetUntil) - c.u)); if (c.g < grow && now - wetUntil > WILT) c.dead = true; }
  c.u = now; return c;
}
export function cropState(k) {
  const c = life().crops[k]; if (!c) return null; growCrop(c, Date.now());
  const grow = CROPS[c.c].grow * MIN, p = c.g / grow;
  return { crop: c.c, p, stage: c.dead ? -1 : p >= 1 ? 4 : Math.min(3, Math.floor(p * 4)), ripe: !c.dead && p >= 1, dead: !!c.dead, thirsty: !c.dead && p < 1 && Date.now() > c.w + DRY,
    wetLeft: Math.max(0, c.w + DRY - Date.now()), etaMin: Math.ceil((grow - c.g) / MIN) };
}
function plant(k, crop) { if (!has("seed_" + crop, 1)) return false; addItem("seed_" + crop, -1); const now = Date.now(); life().crops[k] = { c: crop, g: 0, u: now, w: now, t: now }; return true; }
function water(k) { const c = life().crops[k]; if (!c || c.dead) return false; growCrop(c, Date.now()); c.w = Date.now(); return true; }
function harvest(k) { const st = cropState(k); if (!st) return 0; if (st.dead) { delete life().crops[k]; return -1; }
  if (!st.ripe) return 0; const n = st.crop === "wheat" || st.crop === "berries" ? 3 : st.crop === "pumpkin" ? 1 : 2; addItem(st.crop, n); if (Math.random() < 0.5) addItem("seed_" + st.crop, 1); delete life().crops[k]; return n; }

let farmGroup = null, farmSig = "";
const fm = {}; const FM = (c, o) => fm[c + (o ? "e" : "")] || (fm[c + (o ? "e" : "")] = new T.MeshStandardMaterial({ color: c, roughness: 0.85, name: "Farm_" + c.slice(1), ...(o || {}) }));
const fg = {}; const FG = (k, f) => fg[k] || (fg[k] = f());
function cropMesh(st) {
  const g = new T.Group(); const s = st.stage, C = CROPS[st.crop];
  const leaf = FM(st.dead ? "#7a6a3a" : st.thirsty ? "#8aa040" : "#3f8a34"), stem = FM(st.dead ? "#6a5a30" : "#4a7a2a");
  const add = (geo, m, x, y, z, sx, sy, sz) => { const me = new T.Mesh(geo, m); me.position.set(x, y, z); if (sx) me.scale.set(sx, sy, sz); me.castShadow = true; g.add(me); return me; };
  const ICO = FG("ico", () => new T.IcosahedronGeometry(0.5, 0)), CYL = FG("cyl", () => new T.CylinderGeometry(0.5, 0.5, 1, 6)), SPH = FG("sph", () => new T.SphereGeometry(0.5, 10, 8)), CONE = FG("cone", () => new T.ConeGeometry(0.5, 1, 6));
  if (s === 0) { add(SPH, FM("#5a4330"), 0, 0.02, 0, 0.35, 0.08, 0.35); add(CONE, leaf, 0, 0.07, 0, 0.05, 0.08, 0.05); return g; }
  const h = st.dead ? 0.25 : [0, 0.18, 0.38, 0.6, 0.75][s] * (st.crop === "corn" ? 2 : st.crop === "wheat" ? 1.2 : st.crop === "flower" ? 0.8 : 1);
  const spots = s >= 2 && st.crop !== "pumpkin" ? [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]] : [[0, 0]];
  for (const [x, z] of spots) {
    if (st.crop === "wheat" || st.crop === "corn") { add(CYL, stem, x, h / 2, z, 0.04, h, 0.04); add(CONE, leaf, x, h * 0.55, z, 0.18, h * 0.6, 0.18);
      if (s >= 3) add(CYL, FM(C.color), x, h * 0.9, z, st.crop === "corn" ? 0.09 : 0.05, h * 0.28, st.crop === "corn" ? 0.09 : 0.05); }
    else if (st.crop === "carrot") { add(CONE, leaf, x, h / 2, z, 0.18, h, 0.18); if (s >= 3) add(CONE, FM(C.color), x, 0.03, z, 0.08, -0.12, 0.08); }
    else { add(ICO, leaf, x, h * 0.5, z, h * (spots.length > 1 ? 0.6 : 1.1), h * 0.8, h * (spots.length > 1 ? 0.6 : 1.1));
      if (s >= 3 && !st.dead) { const fr = st.crop === "pumpkin" ? [[0.15, 0.12, 0.1, 0.32]] : [[0.12, h * 0.6, 0.1, 0.09], [-0.1, h * 0.7, -0.08, 0.08], [0.02, h * 0.85, -0.12, 0.08]];
        for (const [fx, fy, fz, r] of fr) add(SPH, FM(s === 4 ? C.color : "#9ab04a"), x + fx, fy, z + fz, r * (s === 4 ? 1 : 0.7), r * (st.crop === "pumpkin" ? 0.8 : 1) * (s === 4 ? 1 : 0.7), r * (s === 4 ? 1 : 0.7)); } }
  }
  if (st.dead) g.rotation.z = 0.35;
  return g;
}
export function farmTick(force) {
  if (!farmGroup) { farmGroup = new T.Group(); farmGroup.name = "Garden"; X.lotGroup.add(farmGroup); }
  const plots = plotTiles(); const parts = [];
  for (const [k, p] of plots) { const st = cropState(k); parts.push(k + (p.bed ? "b" : "") + ":" + (st ? st.crop + st.stage + (st.thirsty ? "t" : "") : "-") + (st && st.wetLeft > 0 ? "w" : "")); }
  const sig = parts.join("|"); if (!force && sig === farmSig) return; farmSig = sig;
  for (const c of [...farmGroup.children]) farmGroup.remove(c);
  const SOIL = FG("soil", () => new T.BoxGeometry(0.96, 0.08, 0.96));
  for (const [k, p] of plots) {
    const [x, z] = k.split(",").map(Number), c = X.tileCenter(x, z), st = cropState(k), y = p.bed ? 0.42 : 0.02;
    if (!p.bed) { const soil = new T.Mesh(SOIL, FM(st && st.wetLeft > 0 ? "#3e2c1e" : "#6a4a32")); soil.position.set(c.x, 0.03, c.z); soil.receiveShadow = true; soil.userData.plot = k; farmGroup.add(soil); }
    if (st) { const m = cropMesh(st); m.position.set(c.x, y + 0.04, c.z); m.traverse((q) => (q.userData.plot = k)); farmGroup.add(m); }
  }
}
export const farmGroupRef = () => farmGroup;

// ---------------- fishing ----------------
export function waterKind(x, z) {
  const i = Math.round(x / CH), j = Math.round(z / CH), info = X.World.chunkInfo(i, j), lx = x - i * CH, lz = z - j * CH;
  if (info.lake && Math.hypot(lx - info.lake.x, lz - info.lake.z) < info.lake.R * 1.3 + 1) return "lake";
  if (info.canal && Math.abs(lz) < 4 && !(info.river && Math.abs(lx) < 6)) return "canal";
  return info.river ? "river" : info.canal ? "canal" : "lake";
}
// where to stand for a cast at water point w: walk back toward `from` until dry land; docks win on lakes
export function fishingSpot(w, from) {
  const i = Math.round(w.x / CH), j = Math.round(w.z / CH), info = X.World.chunkInfo(i, j);
  if (info.dock) { const dx = info.dock.x + i * CH, dz = info.dock.z + j * CH; if (Math.hypot(dx - w.x, dz - w.z) < 7) return { x: dx, z: dz, y: info.dock.y, face: { x: w.x, z: w.z }, kind: "lake", dock: true }; }
  const d = Math.hypot(from.x - w.x, from.z - w.z) || 1, ux = (from.x - w.x) / d, uz = (from.z - w.z) / d;
  for (let s = 0.5; s < 14; s += 0.5) { const x = w.x + ux * s, z = w.z + uz * s, zn = X.world.zoneAt(x, z);
    if (zn === "land" || zn === "path" || zn === "walk" || zn === "bank" && s > 2.5) { const h = X.World.heightAt(info, x - i * CH, z - j * CH); return { x, z, y: Math.max(-0.6, Math.min(0.4, h)), face: { x: w.x, z: w.z }, kind: waterKind(w.x, w.z) }; } }
  return null;
}
function rollFish(kind) {
  const c = X.clock(), part = partOfDay(c), season = X.World.seasonOf();
  const ok = FISH.filter((f) => f.water.includes(kind) && (!f.times || f.times.includes(part)) && (!f.seasons || f.seasons.includes(season)));
  const pool = ok.length ? ok : FISH.filter((f) => f.rarity === "common"); let r = Math.random() * pool.reduce((s, f) => s + RARITY[f.rarity].w, 0);
  for (const f of pool) { r -= RARITY[f.rarity].w; if (r <= 0) return f; } return pool[0];
}
let fishing = null;
export function castLine(sim, spot) {
  const rt = X.runtime.get(sim.id); if (!rt) return;
  endFishing(); rt.pose = "paint"; rt.holder.rotation.y = Math.atan2(spot.face.x - rt.holder.position.x, spot.face.z - rt.holder.position.z);
  const rod = new T.Group(); rod.name = "FishingRod"; rod.userData.noExport = true;
  const pole = new T.Mesh(FG("rod", () => new T.CylinderGeometry(0.012, 0.02, 2.2, 5)), FM("#5a3a22")); pole.position.set(-0.25, 1.55, 0.75); pole.rotation.x = 1.05; rod.add(pole);
  const dist = Math.hypot(spot.face.x - rt.holder.position.x, spot.face.z - rt.holder.position.z);
  const line = new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(-0.25, 2.1, 1.7), new T.Vector3(-0.25, WATER_Y - rt.holder.position.y + 0.02, Math.min(4, dist + 0.5))]), new T.LineBasicMaterial({ color: "#e8e4dc" })); rod.add(line);
  const bob = new T.Mesh(FG("bob", () => new T.SphereGeometry(0.07, 8, 6)), FM("#d8402c")); bob.position.set(-0.25, WATER_Y - rt.holder.position.y + 0.04, Math.min(4, dist + 0.5)); rod.add(bob);
  rt.holder.add(rod);
  X.thought(sim, "Fishing (" + spot.kind + ")…"); X.setStatus("Line cast in the " + spot.kind + ". Wait for a bite…");
  const f = rollFish(spot.kind);
  fishing = { sim, rt, rod, bob, spot, fish: f, timer: setTimeout(() => bite(), (X.reduceMotion ? 2500 : 2000 + Math.random() * 4000) / Math.max(1, Math.min(3, X.speed()))) };
}
function endFishing() { if (!fishing) return; clearTimeout(fishing.timer); if (fishing.raf) cancelAnimationFrame(fishing.raf); fishing.rt.holder.remove(fishing.rod); if (fishing.ui) fishing.ui.remove(); if (fishing.keys) document.removeEventListener("keydown", fishing.keys, true); fishing.rt.pose = "stand"; fishing = null; }
export const isFishing = () => !!fishing;
export function cancelFishing() { endFishing(); }
function bite() {
  if (!fishing) return; const F = fishing, R = RARITY[F.fish.rarity];
  X.sayLocal(F.sim.id, "!", 1500);
  const ui = document.createElement("div"); ui.className = "sims-fishgame"; ui.setAttribute("role", "dialog"); ui.setAttribute("aria-label", "Fishing minigame");
  const zoneW = R.zone, zoneX = 0.1 + Math.random() * (0.8 - zoneW);
  ui.innerHTML = '<p><b>Something is biting!</b> Reel in when the marker is in the green.</p><div class="sims-fishbar"><i style="left:' + (zoneX * 100) + "%;width:" + (zoneW * 100) + '%"></i><b></b></div><button type="button">Reel in!</button><span class="sims-small">Space / Enter / tap</span>';
  X.$("sims-stage").appendChild(ui); F.ui = ui;
  const marker = ui.querySelector(".sims-fishbar b"); let t0 = performance.now(), pos = 0;
  const spd = R.speed * (X.reduceMotion ? 0.45 : 1);
  const frame = () => { const t = (performance.now() - t0) / 1000; pos = Math.abs(((t * spd) % 2) - 1); pos = 1 - pos; marker.style.left = (pos * 100) + "%"; if (t > 7) return reel(true); F.raf = requestAnimationFrame(frame); };
  const reel = (timeout) => { if (!fishing || fishing !== F) return; const hit = !timeout && pos >= zoneX - 0.02 && pos <= zoneX + zoneW + 0.02; finishCatch(hit); };
  ui.querySelector("button").onclick = () => reel(false); ui.onpointerdown = (e) => { if (e.target.tagName !== "BUTTON") reel(false); };
  F.keys = (e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); e.stopPropagation(); reel(false); } }; document.addEventListener("keydown", F.keys, true);
  ui.querySelector("button").focus({ preventScroll: true });
  F.raf = requestAnimationFrame(frame);
}
function finishCatch(hit) {
  const F = fishing; if (!F) return; const f = F.fish, sim = F.sim;
  endFishing();
  if (!hit) { X.thought(sim, "It got away…"); X.sayLocal(sim.id, "Aw, it got away!", 3000); X.setStatus("The " + (f.rarity === "common" ? "fish" : f.rarity + " fish") + " got away. Right-click the water to cast again."); return; }
  const size = +(Math.random() * 0.8 + 0.6).toFixed(2), L = life(); addItem("fish_" + f.id, 1);
  const e = L.fishlog[f.id] || (L.fishlog[f.id] = { n: 0, best: 0, first: Date.now(), where: F.spot.kind }); e.n++; e.best = Math.max(e.best, size);
  sim.needs.fun = Math.min(100, sim.needs.fun + (f.rarity === "common" ? 8 : f.rarity === "uncommon" ? 14 : 25));
  X.sayLocal(sim.id, "Caught a " + f.label + "! (" + f.rarity + ")", 5000); X.thought(sim, "Caught " + f.label);
  X.setStatus("Caught a " + f.label + " — " + f.rarity + ", " + size + "× size. It's in the inventory.");
  X.save(); renderLife();
}
export function testFish(kind, force) { return { fish: rollFish(kind || "lake"), finish: force ? finishCatch(force === "hit") : undefined }; }

// ---------------- market stall + shop ----------------
export const STALL = { x: 8.5, z: 14.3, stand: { x: 8.5, z: 13.05 } };
let stall = null;
function buildStall() {
  const g = new T.Group(); g.name = "MarketStall"; g.userData.kind = "stall"; g.userData.noExport = true;
  const B = (w, h, d, c, x, y, z) => { const m = new T.Mesh(FG("b" + w + h + d, () => new T.BoxGeometry(w, h, d)), FM(c)); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; g.add(m); return m; };
  B(2.3, 0.9, 0.7, "#8a5a32", 0, 0.45, 0); B(2.4, 0.06, 0.8, "#b98a55", 0, 0.93, 0);
  for (const sx of [-1.1, 1.1]) for (const sz of [-0.3, 0.35]) B(0.08, 2.2, 0.08, "#6b4a2e", sx, 1.1, sz);
  for (let k = 0; k < 6; k++) { const s = B(0.4, 0.05, 1.1, k % 2 ? "#f2eee6" : "#c94a3a", -1.0 + k * 0.4, 2.25, 0.05); s.rotation.x = -0.25; }
  const crate = [["#d8402c", -0.75], ["#e8c23a", -0.25], ["#e0782a", 0.25], ["#5a3a9a", 0.75]];
  for (const [c, x] of crate) { B(0.42, 0.14, 0.36, "#9a7046", x, 1.03, -0.05); for (let k = 0; k < 4; k++) { const f = new T.Mesh(FG("fruit", () => new T.SphereGeometry(0.07, 8, 6)), FM(c)); f.position.set(x - 0.1 + (k % 2) * 0.2, 1.14, -0.12 + Math.floor(k / 2) * 0.14); g.add(f); } }
  const sign = B(1.2, 0.3, 0.04, "#2b2724", 0, 2.55, -0.32);
  const cv = document.createElement("canvas"); cv.width = 256; cv.height = 64; const cx = cv.getContext("2d"); cx.fillStyle = "#2b2724"; cx.fillRect(0, 0, 256, 64); cx.fillStyle = "#e0b04a"; cx.font = "bold 34px serif"; cx.textAlign = "center"; cx.fillText("MARKET", 128, 44);
  const tex = new T.CanvasTexture(cv); tex.colorSpace = T.SRGBColorSpace; sign.material = new T.MeshStandardMaterial({ map: tex, roughness: 0.6 }); sign.rotation.y = Math.PI;
  const vendor = X.buildSimModel({ ...X.G.randomSim(777), name: "Rosa" }); vendor.position.set(0, 0, 0.75); vendor.rotation.y = Math.PI; vendor.traverse((c) => (c.userData.vendor = true)); g.add(vendor);
  g.position.set(STALL.x, 0, STALL.z); g.rotation.y = Math.PI; g.traverse((c) => { c.userData.stall = true; });
  return g;
}
export function ensureStall() { if (!stall) { stall = buildStall(); X.scene.add(stall); } return stall; }
const dayFactor = (id) => { const d = new Date(); const h = X.G.hashStr(id + ":" + d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate()); return 0.8 + (h % 1000) / 1000 * 0.4; };
export const buyPrice = (id) => Math.max(1, Math.round(itemInfo(id).price * dayFactor(id) * (id.startsWith("seed_") ? 1 : 1.3)));
export const sellPrice = (id) => Math.max(1, Math.round(itemInfo(id).price * 0.7 * dayFactor(id)));
let atMarket = false;
export function nearMarket() { const s = X.selected(); const rt = s && X.runtime.get(s.id); if (!rt) return false; const p = rt.holder.position; return Math.hypot(p.x - STALL.stand.x, p.z - STALL.stand.z) < 2.5; }
export function goMarket(then) { const sim = X.selected(); if (!sim) return X.setStatus("Pick a sim first");
  X.command(sim, { world: { ...STALL.stand, y: 0, face: { x: STALL.x, z: STALL.z } }, job: { label: "Shop", dur: 1, pose: "stand", onDone: () => { atMarket = true; X.sayLocal(sim.id, "Hi Rosa!", 2500); openTab("market"); if (then) then(); } } }); }
function shopBuy(id, n = 1) { if (!nearMarket()) return X.setStatus("Walk to the market stall first."); const L = life(), p = buyPrice(id) * n; if (L.coins < p) return X.setStatus("Not enough § — sell something first."); L.coins -= p; addItem(id, n); X.save(); renderLife(); X.setStatus("Bought " + itemInfo(id).label + " for " + fmtCoins(p)); }
function shopSell(id, n = 1) { if (!nearMarket()) return X.setStatus("Walk to the market stall first."); if (!has(id, n)) return; const p = sellPrice(id) * n; addItem(id, -n); life().coins += p; X.save(); renderLife(); X.setStatus("Sold " + itemInfo(id).label + " for " + fmtCoins(p)); }

// ---------------- cooking + eating ----------------
function pickIng(kind, n, used) {
  const I = inv(); const pool = kind === "fish" ? Object.keys(I).filter((k) => k.startsWith("fish_")).sort((a, b) => itemInfo(a).price - itemInfo(b).price) : kind === "veg" ? VEG.filter((v) => I[v]) : [kind];
  const out = []; let need = n; for (const k of pool) { const have = (I[k] || 0) - (used[k] || 0); const take = Math.min(have, need); if (take > 0) { out.push([k, take]); used[k] = (used[k] || 0) + take; need -= take; } if (!need) break; }
  return need ? null : out;
}
export function recipeIngredients(dish) { const used = {}, all = []; for (const [k, n] of DISHES[dish].need) { const got = pickIng(k, n, used); if (!got) return null; all.push(...got); } return all; }
export function findStove() { const s = X.S(); return s.objects.find((o) => { const i = X.catInfo(o.type); return i && (i.cat === "stove" || i.cat === "grill" || o.type === "stove"); }); }
export function cook(dish) {
  if (X.visiting()) return X.setStatus("Cook at home — this lot isn't yours.");
  const sim = X.selected(), stove = findStove(); if (!sim) return; if (!stove) return X.setStatus("Buy a stove or grill first (Buy › Kitchen).");
  if (!recipeIngredients(dish)) return X.setStatus("Missing ingredients for " + DISHES[dish].label);
  X.command(sim, { objId: stove.id, job: { label: (DISHES[dish].craft ? "Making " : "Cooking ") + DISHES[dish].label, dur: 20, pose: "paint", onDone: (s) => {
    const ing = recipeIngredients(dish); if (!ing) { X.thought(s, "Missing ingredients"); return; } for (const [k, n] of ing) addItem(k, -n); addItem("dish_" + dish, 1);
    X.sayLocal(s.id, DISHES[dish].icon + " " + DISHES[dish].label + " ready!", 3500); s.needs.fun = Math.min(100, s.needs.fun + 4); X.save(); renderLife(); } } });
}
export function eat(id) {
  const sim = X.selected(), info = itemInfo(id); if (!sim || !info || !has(id, 1)) return;
  const hunger = info.kind === "dish" ? info.hunger : info.kind === "crop" ? info.hunger : 0, fun = info.fun || 0;
  if (!hunger && !fun) return X.setStatus(info.label + " isn't edible raw — cook it at the stove.");
  addItem(id, -1); X.save(); renderLife();
  X.command(sim, { here: true, job: { label: (hunger ? "Eating " : "Enjoying ") + info.label, dur: hunger ? 12 : 8, pose: "stand", onDone: (s) => { s.needs.hunger = Math.min(100, s.needs.hunger + hunger); s.needs.fun = Math.min(100, s.needs.fun + fun + (info.kind === "dish" ? 6 : 0)); X.sayLocal(s.id, "Yum!", 2000); } } });
}

// ---------------- garden jobs ----------------
const plotObj = (k) => { const p = plotTiles().get(k); return p && p.bed ? p.objId : null; };
function plotTarget(k, job) { const id = plotObj(k); const [x, z] = k.split(",").map(Number); return id ? { objId: id, job } : { tile: [x, z], job }; }
export function doPlant(k, crop) { const sim = X.selected(); if (!sim) return; if (!has("seed_" + crop, 1)) return X.setStatus("No " + CROPS[crop].label + " seeds — buy some at the market.");
  X.command(sim, plotTarget(k, { label: "Planting " + CROPS[crop].label, dur: 6, pose: "paint", onDone: (s) => { if (life().crops[k]) return; if (plant(k, crop)) { X.thought(s, "Planted " + CROPS[crop].label); farmTick(true); X.save(); renderLife(); } } })); }
export function doWater(k) { const sim = X.selected(); if (!sim) return; X.command(sim, plotTarget(k, { label: "Watering", dur: 4, pose: "paint", prop: "can", onDone: (s) => { if (water(k)) { X.thought(s, "Watered"); farmTick(true); X.save(); renderLife(); } } })); }
export function doHarvest(k) { const sim = X.selected(); if (!sim) return; X.command(sim, plotTarget(k, { label: "Harvesting", dur: 5, pose: "paint", onDone: (s) => { const n = harvest(k); X.thought(s, n > 0 ? "Harvested " + n : n < 0 ? "Cleared wilted plant" : "Not ripe yet"); if (n > 0) s.needs.fun = Math.min(100, s.needs.fun + 5); farmTick(true); X.save(); renderLife(); } })); }
export function tendGarden() {
  const sim = X.selected(); if (!sim) return; const list = [];
  for (const [k] of plotTiles()) { const st = cropState(k); if (!st) continue; if (st.ripe || st.dead) list.push(() => doHarvest(k)); else if (st.wetLeft < 15 * MIN) list.push(() => doWater(k)); }
  if (!list.length) return X.setStatus("Garden is all tended — nothing thirsty or ripe.");
  X.queue(sim, list); X.setStatus("Tending " + list.length + " plot(s)…");
}
export function plantAll(crop) { const sim = X.selected(); if (!sim) return; const list = []; let seeds = inv()["seed_" + crop] || 0;
  for (const [k] of plotTiles()) if (!life().crops[k] && seeds-- > 0) list.push(() => doPlant(k, crop)); if (!list.length) return X.setStatus("No empty plots (or no seeds)."); X.queue(sim, list); }
export function digPlots(a, b) { const L = life(); let n = 0; for (let x = Math.min(a[0], b[0]); x <= Math.max(a[0], b[0]); x++) for (let z = Math.min(a[1], b[1]); z <= Math.max(a[1], b[1]); z++) { if (!X.inLot(x, z) || X.occupied(x, z)) continue; L.garden[x + "," + z] = 1; n++; } farmTick(true); X.save(); return n; }
export function removePlot(k) { const L = life(); if (!L.garden[k]) return false; delete L.garden[k]; delete L.crops[k]; farmTick(true); X.save(); return true; }

// ---------------- Life panel: inventory · garden · market · trade · fish log ----------------
let panel = null, tab = "inv";
export function openTab(t) { tab = t; renderLife(); if (panel) panel.scrollIntoView({ block: "nearest", behavior: X.reduceMotion ? "auto" : "smooth" }); }
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const btn = (txt, on, dis) => { const b = el("button", "", txt); b.type = "button"; b.onclick = on; if (dis) b.disabled = true; return b; };
export function mountPanel() {
  const live = document.querySelector('#panel-sims .sims-pane[data-pane="live"]'); if (!live || panel) return;
  panel = el("div", "sims-life"); panel.id = "sims-life"; const anchor = live.querySelector(".sims-online"); live.insertBefore(panel, anchor);
  // real-time toggle in the overlay
  const ov = document.querySelector("#sims-stage .sims-overlay");
  if (ov && !X.$("sims-realtime")) { const lab = el("label", "sims-rt"); const cb = document.createElement("input"); cb.type = "checkbox"; cb.id = "sims-realtime"; lab.append(cb, document.createTextNode(" Real time")); ov.insertBefore(lab, ov.children[1]);
    cb.onchange = () => { const L = life(); L.realTime = cb.checked; if (!cb.checked) { const c = X.clock(); X.S().minutes = Math.floor((X.S().minutes || 0) / 1440) * 1440 + c.hours * 60; } X.save(); X.setStatus(cb.checked ? "Clock follows your device time." : "Game clock: speed buttons now fast-forward the day too."); }; }
  renderLife();
}
export function renderLife() {
  if (!panel) return; const L = life(); if (!L) return; const cb = X.$("sims-realtime"); if (cb) cb.checked = !!L.realTime;
  panel.textContent = "";
  const head = el("div", "sims-life-head"); head.append(el("h4", "", "Life"), el("span", "sims-coins", fmtCoins(L.coins) + " Simoleons")); panel.append(head);
  panel.append(el("p", "sims-small", "§ lives only in this Sims save — it isn't site credit or real money."));
  const tabs = el("div", "sims-tools"); tabs.setAttribute("role", "tablist");
  for (const [k, lab] of [["inv", "Inventory"], ["garden", "Garden"], ["market", "Market"], ["trade", "Trade"], ["fish", "Fish log"]]) { const b = btn(lab, () => { tab = k; renderLife(); }); b.setAttribute("aria-pressed", String(tab === k)); b.dataset.lifeTab = k; tabs.append(b); }
  panel.append(tabs); const body = el("div", "sims-life-body"); panel.append(body);
  ({ inv: renderInv, garden: renderGarden, market: renderMarket, trade: renderTrade, fish: renderFishLog })[tab](body);
}
function itemRow(id, n, extra) { const i = itemInfo(id); const r = el("div", "sims-item-row"); r.append(el("span", "sims-ico", i.icon), el("span", "sims-iname", i.label + (i.rarity && i.rarity !== "common" ? " ★" : "")), el("em", "", "×" + n)); if (extra) for (const b of extra) r.append(b); return r; }
function renderInv(body) {
  const I = inv(), ids = Object.keys(I).filter((k) => itemInfo(k)).sort();
  if (!ids.length) body.append(el("p", "sims-small", "Empty. Harvest crops, catch fish, or buy seeds at the market stall."));
  for (const id of ids) { const i = itemInfo(id), acts = [];
    if (i.kind === "dish" || (i.kind === "crop" && i.hunger)) acts.push(btn(i.fun && !i.hunger ? "Use" : "Eat", () => eat(id)));
    if (i.kind === "seed") acts.push(btn("Plant all", () => plantAll(id.slice(5))));
    body.append(itemRow(id, I[id], acts)); }
  body.append(el("h5", "", "Cook & craft (at the stove)"));
  for (const d in DISHES) { const D = DISHES[d], ok = !!recipeIngredients(d); const r = el("div", "sims-item-row"); r.append(el("span", "sims-ico", D.icon), el("span", "sims-iname", D.label), el("em", "", D.need.map(([k, n]) => n + " " + (k === "veg" ? "veg" : k)).join(" + ") + (D.hunger ? " · +" + D.hunger + " hunger" : " · +fun"))); r.append(btn(D.craft ? "Make" : "Cook", () => cook(d), !ok)); body.append(r); }
}
function renderGarden(body) {
  const plots = plotTiles(); let ripe = 0, thirsty = 0, grow = 0, dead = 0, empty = 0;
  for (const [k] of plots) { const s = cropState(k); if (!s) empty++; else if (s.dead) dead++; else if (s.ripe) ripe++; else { grow++; if (s.thirsty) thirsty++; } }
  body.append(el("p", "sims-small", plots.size ? plots.size + " plots · " + grow + " growing (" + thirsty + " thirsty) · " + ripe + " ripe · " + dead + " wilted · " + empty + " empty" : "No plots yet. Build › Garden to dig soil, or buy a Planter Bed in Buy › Outdoor."));
  const row = el("div", "sims-row"); const sel = document.createElement("select"); sel.className = "sims-input"; sel.id = "sims-seed-pick";
  for (const c in CROPS) { const o = document.createElement("option"); o.value = c; o.textContent = CROPS[c].icon + " " + CROPS[c].label + " (" + (inv()["seed_" + c] || 0) + " seeds, " + CROPS[c].grow + " min)"; sel.append(o); }
  row.append(sel, btn("Plant empty plots", () => plantAll(sel.value))); body.append(row);
  body.append(btn("Tend garden (water + harvest)", tendGarden));
  body.append(el("p", "sims-small", "Crops grow on real time while watered; a watering lasts 60 minutes. Dry for 90 more minutes and they wilt. Right-click a plot for actions."));
  for (const [k] of plots) { const s = cropState(k); if (!s) continue; body.append(el("div", "sims-small", CROPS[s.crop].icon + " " + CROPS[s.crop].label + " @" + k + " — " + (s.dead ? "wilted" : s.ripe ? "ripe!" : Math.round(s.p * 100) + "% · ~" + s.etaMin + " min watered" + (s.thirsty ? " · THIRSTY" : "")))); }
}
function renderMarket(body) {
  const near = nearMarket();
  body.append(el("p", "sims-small", near ? "Rosa's market stall — prices change daily." : "The market stall is on the sidewalk in front of your lot."));
  if (!near) { body.append(btn("Walk to the market", () => goMarket())); return; }
  body.append(el("h5", "", "Buy"));
  for (const c in CROPS) { const id = "seed_" + c; body.append(itemRow(id, inv()[id] || 0, [btn("Buy " + fmtCoins(buyPrice(id)), () => shopBuy(id)), btn("×5", () => shopBuy(id, 5))])); }
  body.append(el("h5", "", "Sell"));
  const ids = Object.keys(inv()).filter((k) => itemInfo(k) && !k.startsWith("seed_"));
  if (!ids.length) body.append(el("p", "sims-small", "Nothing to sell yet."));
  for (const id of ids) body.append(itemRow(id, inv()[id], [btn("Sell " + fmtCoins(sellPrice(id)), () => shopSell(id)), btn("All", () => shopSell(id, inv()[id]))]));
}
function renderFishLog(body) {
  const log = life().fishlog, got = FISH.filter((f) => log[f.id]).length;
  body.append(el("p", "sims-small", got + " / " + FISH.length + " species caught. Right-click any river, canal or lake to fish."));
  const g = el("div", "sims-fishlog");
  for (const f of FISH) { const e = log[f.id]; const c = el("div", "sims-fishcard" + (e ? " is-got" : "")); c.append(el("b", "", e ? f.label : "???"), el("span", "", f.rarity + " · " + f.water.join("/")), el("span", "", (f.times ? f.times.join("/") : "any time") + " · " + (f.seasons ? f.seasons.join("/") : "all year")), el("span", "", e ? "×" + e.n + " · best " + e.best + "×" : "not caught")); g.append(c); }
  body.append(g);
}

// ---------------- player-to-player trading (server-validated via /api/sims-lot op:"trade") ----------------
const TR = { list: [], draft: { to: "", give: {}, want: {}, giveCoins: 0, wantCoins: 0, counterOf: null }, last: 0, busy: false, err: "" };
async function tradeApi(act, extra) {
  const body = Object.assign({ op: "trade", act, sid: X.mySid(), key: X.ownerKey(), name: X.myName() }, extra || {});
  try { const d = await X.api("POST", body); if (d && Array.isArray(d.trades)) { TR.list = d.trades; applyDone(); } return d || { ok: false, error: "network" }; } catch (e) { return { ok: false, error: "network" }; }
}
const roleOf = (t) => (t.a === X.mySid() ? "a" : "b");
const mine = (t) => (roleOf(t) === "a" ? t.aGives : t.bGives), theirs = (t) => (roleOf(t) === "a" ? t.bGives : t.aGives);
function canGive(g) { if ((g.coins || 0) > life().coins) return false; for (const [k, n] of Object.entries(g.items || {})) if (!has(k, n)) return false; return true; }
function applyDone() {
  const L = life(); let changed = false;
  for (const t of TR.list) { if (t.status !== "done" || L.trades.includes(t.id)) continue;
    const g = mine(t), r = theirs(t);
    for (const [k, n] of Object.entries(g.items || {})) addItem(k, -Math.min(n, inv()[k] || 0));
    L.coins = Math.max(0, L.coins - (g.coins || 0)) + (r.coins || 0);
    for (const [k, n] of Object.entries(r.items || {})) if (itemInfo(k)) addItem(k, n);
    L.trades.push(t.id); if (L.trades.length > 60) L.trades.shift(); changed = true;
    X.setStatus("Trade with " + (roleOf(t) === "a" ? t.bName : t.aName) + " complete!"); }
  if (changed) { X.save(); renderLife(); }
}
export async function pollTrades(force) {
  const now = performance.now(), open = TR.list.some((t) => t.status === "open" || t.status === "accepted");
  if (TR.busy || (!force && now - TR.last < (tab === "trade" || open ? 3000 : 12000))) return; if (!X.mySid()) return;
  TR.busy = true; TR.last = now; const before = JSON.stringify(TR.list.map((t) => t.id + t.rev + t.status + JSON.stringify(t.conf)));
  await tradeApi("list"); TR.busy = false;
  const after = JSON.stringify(TR.list.map((t) => t.id + t.rev + t.status + JSON.stringify(t.conf)));
  if (before !== after) { const inc = TR.list.find((t) => t.status === "open" && t.turn === roleOf(t)); if (inc && tab !== "trade") X.setNet("Trade offer from " + (roleOf(inc) === "a" ? inc.bName : inc.aName) + " — open Life › Trade."); if (tab === "trade") renderLife(); }
}
export function startTradeWith(sid) { TR.draft = { to: sid, give: {}, want: {}, giveCoins: 0, wantCoins: 0, counterOf: null }; openTab("trade"); }
async function act(a, extra) { const d = await tradeApi(a, extra); TR.err = d.ok ? "" : d.error || "failed"; renderLife(); return d; }
function renderTrade(body) {
  const D = TR.draft, peers = X.peers();
  if (TR.err) body.append(el("p", "sims-small sims-err", TR.err));
  for (const t of TR.list) {
    const r = roleOf(t), who = r === "a" ? t.bName : t.aName, card = el("div", "sims-trade");
    const fmt = (g) => [...Object.entries(g.items || {}).map(([k, n]) => n + "× " + (itemInfo(k) ? itemInfo(k).label : k)), g.coins ? fmtCoins(g.coins) : ""].filter(Boolean).join(", ") || "nothing";
    card.append(el("b", "", "With " + who + " · " + t.status + (t.status === "open" ? (t.turn === r ? " (your move)" : " (waiting)") : "")), el("div", "sims-small", "You give: " + fmt(mine(t))), el("div", "sims-small", "You get: " + fmt(theirs(t))));
    const row = el("div", "sims-tools");
    if (t.status === "open" && t.turn === r) { row.append(btn("Accept", () => act("accept", { id: t.id, rev: t.rev })), btn("Counter", () => { TR.draft = { to: r === "a" ? t.b : t.a, give: { ...(mine(t).items || {}) }, want: { ...(theirs(t).items || {}) }, giveCoins: mine(t).coins || 0, wantCoins: theirs(t).coins || 0, counterOf: t.id, rev: t.rev }; renderLife(); })); }
    if (t.status === "accepted" && !t.conf[r]) row.append(btn("Confirm trade", () => { if (!canGive(mine(t))) { TR.err = "You no longer have everything you're giving."; return renderLife(); } act("confirm", { id: t.id, rev: t.rev }); }));
    if (t.status === "accepted" && t.conf[r]) row.append(el("span", "sims-small", "Confirmed — waiting for " + who));
    if (t.status === "open" || t.status === "accepted") row.append(btn(t.turn === r && t.status === "open" ? "Decline" : "Cancel", () => act("cancel", { id: t.id })));
    card.append(row); body.append(card);
  }
  body.append(el("h5", "", D.counterOf ? "Counter-offer" : "New offer"));
  const to = document.createElement("select"); to.className = "sims-input"; to.id = "sims-trade-to"; to.append(new Option(peers.length ? "Trade with…" : "Nobody online yet", ""));
  for (const p of peers) to.append(new Option(p.name, p.sid)); to.value = D.to; to.onchange = () => (D.to = to.value); to.disabled = !!D.counterOf; body.append(to);
  const side = (label, map, coinsKey, ids) => { const box = el("div", "sims-trade-side"); box.append(el("b", "", label));
    for (const [k, n] of Object.entries(map)) { const r = itemRow(k, n, [btn("−", () => { if (--map[k] <= 0) delete map[k]; renderLife(); })]); box.append(r); }
    const row = el("div", "sims-row"); const s = document.createElement("select"); s.className = "sims-input"; for (const k of ids) s.append(new Option(itemInfo(k).icon + " " + itemInfo(k).label, k));
    row.append(s, btn("Add", () => { if (!s.value) return; map[s.value] = Math.min(99, (map[s.value] || 0) + 1); renderLife(); })); box.append(row);
    const c = document.createElement("input"); c.type = "number"; c.min = 0; c.max = 99999; c.className = "sims-input"; c.value = D[coinsKey]; c.setAttribute("aria-label", label + " §"); c.oninput = () => (D[coinsKey] = Math.max(0, Math.min(99999, c.value | 0))); box.append(el("span", "sims-small", "§"), c); return box; };
  body.append(side("You give", D.give, "giveCoins", Object.keys(inv()).filter((k) => itemInfo(k))), side("You want", D.want, "wantCoins", ALL_ITEMS));
  const send = btn(D.counterOf ? "Send counter-offer" : "Send offer", async () => {
    if (!D.to) { TR.err = "Choose who to trade with."; return renderLife(); }
    const give = { items: D.give, coins: D.giveCoins }, want = { items: D.want, coins: D.wantCoins };
    if (!canGive(give)) { TR.err = "You don't have everything you're offering."; return renderLife(); }
    const d = await act(D.counterOf ? "counter" : "offer", D.counterOf ? { id: D.counterOf, rev: D.rev, give, want } : { to: D.to, toName: (peers.find((p) => p.sid === D.to) || {}).name, give, want });
    if (d.ok) TR.draft = { to: D.to, give: {}, want: {}, giveCoins: 0, wantCoins: 0, counterOf: null }; renderLife(); });
  send.id = "sims-trade-send"; body.append(send);
  if (D.counterOf) body.append(btn("Cancel counter", () => { D.counterOf = null; renderLife(); }));
  body.append(el("p", "sims-small", "Both players must accept, then both confirm. Items move only after both confirms."));
}
export const tradeState = () => TR;

// ---------------- action registry (right-click / long-press) ----------------
// Every target kind maps to a function returning actions: { label, icon, edit?, run(), sub?: [...] }.
// `edit` actions change the lot and are hidden from visitors / neighbor homes.
const SIT = (label, use, dur) => [label, { pose: "sit", use, dur }];
export const FURNITURE_ACTIONS = {
  sofa: [SIT("Sit", { energy: 0.8, fun: 1.2 }, 20), ["Nap", { pose: "lie", use: { energy: 2.4 }, dur: 30 }], ["Watch TV from here", { pose: "sit", use: { fun: 2.2 }, dur: 25 }]],
  loveseat: [SIT("Sit", { energy: 0.7, fun: 1.4 }, 18), ["Nap", { pose: "lie", use: { energy: 2.2 }, dur: 25 }]],
  armchair: [SIT("Sit", { energy: 0.7, fun: 0.8 }, 14), SIT("Read a book", { fun: 2.0 }, 20)],
  bench: [SIT("Sit", { energy: 0.6, fun: 0.6 }, 12), SIT("People-watch", { fun: 1.6 }, 15)],
  dchair: [SIT("Sit", { energy: 0.6 }, 10), ["Eat here", "eat"]], officechair: [SIT("Sit", { energy: 0.6 }, 10)], stool: [SIT("Sit", { energy: 0.4 }, 8)],
  bed: [["Sleep", { pose: "lie", use: { energy: 3.2 }, dur: 60 }], ["Nap", { pose: "lie", use: { energy: 2.6 }, dur: 20 }], ["Relax", { pose: "lie", use: { energy: 1, fun: 1 }, dur: 12 }]],
  dbed: [["Sleep", { pose: "lie", use: { energy: 3.8 }, dur: 60 }], ["Nap", { pose: "lie", use: { energy: 3 }, dur: 20 }]],
  fridge: [["Grab a snack", { use: { hunger: 3.5 }, dur: 6 }], ["Have a meal", { use: { hunger: 4 }, dur: 18 }]],
  stove: [["Cook…", "cook"], ["Make a quick meal", { pose: "paint", use: { hunger: 4.5, fun: 0.3 }, dur: 15 }]],
  grill: [["Cook…", "cook"], ["Grill burgers", { pose: "paint", use: { hunger: 3.8, fun: 0.8 }, dur: 15 }]],
  microwave: [["Heat leftovers", { use: { hunger: 2.4 }, dur: 6 }]], counter: [["Prep a snack", { use: { hunger: 1.5 }, dur: 8 }]], ksink: [["Wash dishes", { use: { hygiene: 1.2, hunger: 0.4 }, dur: 6 }]],
  dtable: [["Eat here", "eat"], ["Have a snack", { use: { hunger: 1.2, fun: 0.4 }, dur: 12 }]], longtable: [["Eat here", "eat"], ["Chat over coffee", { use: { fun: 1.4 }, dur: 12 }]],
  toilet: [["Use toilet", { pose: "sit", use: { hygiene: 2.0 }, dur: 8 }]], shower: [["Shower", { pose: "inside", use: { hygiene: 5 }, dur: 15 }]],
  bathtub: [["Take a bath", { pose: "lie", use: { hygiene: 4.2, energy: 0.6 }, dur: 20 }]], vanity: [["Freshen up", { use: { hygiene: 1.6 }, dur: 6 }]], hottub: [["Soak", { pose: "inside", use: { hygiene: 2.5, fun: 2.5 }, dur: 20 }]],
  tv: [["Watch TV", { use: { fun: 3 }, dur: 20 }], ["Watch the news", { use: { fun: 1.6 }, dur: 10 }]],
  computer: [["Play games", { use: { fun: 3.2, energy: -0.2 }, dur: 20 }], ["Browse the web", { use: { fun: 2 }, dur: 12 }]],
  arcade: [["Play arcade", { use: { fun: 4.2 }, dur: 15 }]], stereo: [["Listen to music", { use: { fun: 2.4 }, dur: 12 }], ["Dance", { use: { fun: 3, energy: -0.3 }, dur: 10 }]],
  easel: [["Paint", { pose: "paint", use: { fun: 4, energy: -0.3 }, dur: 25 }], ["Quick sketch", { pose: "paint", use: { fun: 2.5 }, dur: 10 }]],
  piano: [["Play piano", { use: { fun: 3.5 }, dur: 20 }]], bookshelf: [["Read a book", { use: { fun: 2.2 }, dur: 18 }]], desk: [["Do homework", { use: { fun: 1 }, dur: 15 }]],
  plant: [["Water plant", { pose: "paint", use: { fun: 1 }, dur: 5 }]], tree: [["Water plant", { pose: "paint", use: { fun: 1.2 }, dur: 5 }]], cactus: [["Admire", { use: { fun: 0.8 }, dur: 4 }]], planter: [["Tend flowers", { pose: "paint", use: { fun: 1.2 }, dur: 6 }]],
  aquarium: [["Watch the fish", { use: { fun: 2.6 }, dur: 12 }], ["Feed the fish", { use: { fun: 1.5 }, dur: 4 }]], fireplace: [["Warm up", { use: { fun: 1.6, energy: 0.4 }, dur: 14 }]],
  swing: [SIT("Swing", { fun: 3, energy: -0.4 }, 12)], dresser: [["Change outfit", "outfit"]], wardrobe: [["Change outfit", "outfit"]],
  floorlamp: [["Turn on/off", "toggle"]], tablelamp: [["Turn on/off", "toggle"]], lantern: [["Turn on/off", "toggle"]],
};
function furnitureActions(t) {
  const info = X.catInfo(t.obj.type) || { label: t.obj.type }, cat = info.cat || t.obj.type, out = [];
  if (t.obj.type === "gardenbed") { for (const k of t.bedTiles || []) out.push(...plotActions(k, true).map((a) => ({ ...a, label: a.label }))); }
  const list = FURNITURE_ACTIONS[cat] || [["Use", {}]];
  for (const [label, over] of list) {
    if (over === "cook") out.push({ label, icon: "🍳", sub: Object.keys(DISHES).map((d) => ({ label: DISHES[d].icon + " " + DISHES[d].label + (recipeIngredients(d) ? "" : " (missing)"), disabled: !recipeIngredients(d) || t.remote, run: () => cook(d) })).concat(t.remote ? [] : []) });
    else if (over === "eat") { const dish = Object.keys(inv()).find((k) => k.startsWith("dish_") && itemInfo(k).hunger); out.push({ label: dish ? "Eat " + itemInfo(dish).label + " here" : "Eat here (no food)", disabled: !dish, run: () => X.useObj(t, { pose: "sit", use: {}, dur: 12, label: "Eating" }, (s) => { if (dish && has(dish, 1)) { addItem(dish, -1); s.needs.hunger = Math.min(100, s.needs.hunger + itemInfo(dish).hunger); X.save(); renderLife(); } }) }); }
    else if (over === "toggle") out.push({ label, run: () => X.useObj(t, null) });
    else if (over === "outfit") out.push({ label, run: () => X.useObj(t, { use: { hygiene: 0.8 }, dur: 6 }, (s) => X.reroll(s)) });
    else out.push({ label, run: () => X.useObj(t, Object.keys(over).length ? { ...over, label } : null) });
  }
  if (!t.remote && !X.visiting()) { out.push({ label: "Move", icon: "✥", edit: true, run: () => X.carry(t.obj.id) }); out.push({ label: "Sell (" + "§" + (info.price || 0) + ")", icon: "✕", edit: true, run: () => X.sell(t.obj.id) }); }
  out.push({ label: "Inspect", icon: "ⓘ", run: () => X.inspect(info.label + " — " + Object.entries(info.use || {}).map(([k, v]) => (v > 0 ? "+" : "") + k).join(", ") + (info.price ? " · §" + info.price : "") + (t.remote ? " · in " + (t.houseName || "a neighbor's home") : "")) });
  return out;
}
function plotActions(k, bed) {
  const st = cropState(k), out = [], where = bed ? " (bed " + k + ")" : "";
  if (!st) out.push({ label: "Plant" + where + "…", icon: "🌱", edit: true, sub: Object.keys(CROPS).map((c) => ({ label: CROPS[c].icon + " " + CROPS[c].label + " ×" + (inv()["seed_" + c] || 0), disabled: !has("seed_" + c, 1), run: () => doPlant(k, c) })) });
  else { if (!st.ripe && !st.dead) out.push({ label: "Water" + where, icon: "💧", edit: true, run: () => doWater(k) }); out.push({ label: (st.dead ? "Clear wilted" : st.ripe ? "Harvest" : "Harvest (not ripe)") + where, icon: "🧺", edit: true, disabled: !st.ripe && !st.dead, run: () => doHarvest(k) });
    out.push({ label: "Inspect" + where, icon: "ⓘ", run: () => X.inspect(CROPS[st.crop].label + ": " + (st.dead ? "wilted" : st.ripe ? "ripe" : Math.round(st.p * 100) + "% grown, ~" + st.etaMin + " watered min left") + (st.thirsty ? " · thirsty" : st.wetLeft ? " · watered for " + Math.ceil(st.wetLeft / MIN) + " min" : "")) }); }
  if (!bed && !st) out.push({ label: "Remove plot", edit: true, run: () => removePlot(k) });
  return out;
}
const SOCIAL = [["Talk", "💬", { fun: 6 }, ["How's it going?", "Nice weather, huh?", "Seen the market today?"]], ["Wave", "👋", { fun: 3 }, ["Hey there!", "Hi!"]], ["Joke", "😂", { fun: 10 }, ["Why did the fish blush? It saw the ocean's bottom!", "I'm reading a book on anti-gravity. Can't put it down!"]], ["Hug", "🤗", { fun: 12 }, ["*hug*"]]];
const social = (t) => SOCIAL.map(([label, icon, gain, lines]) => ({ label, icon, run: () => X.social(t, label, gain, lines[Math.floor(Math.random() * lines.length)]) }));
export const REGISTRY = {
  furniture: furnitureActions,
  plot: (t) => plotActions(t.key, false),
  water: (t) => [{ label: "Fish here", icon: "🎣", run: () => X.fishAt(t.point) }, { label: "Inspect water", icon: "ⓘ", run: () => X.inspect("A " + waterKind(t.point.x, t.point.z) + ". Fish here: " + FISH.filter((f) => f.water.includes(waterKind(t.point.x, t.point.z))).length + " species, varying by time of day and season.") }],
  stall: () => [{ label: "Shop (buy)", icon: "🛒", run: () => goMarket(() => openTab("market")) }, { label: "Sell goods", icon: "§", run: () => goMarket(() => openTab("market")) }, { label: "Talk to Rosa", icon: "💬", run: () => goMarket(() => X.sayLocal(X.selected().id, "What's fresh today?", 3000)) }],
  sim: (t) => (t.sim.id === (X.selected() || {}).id ? [{ label: "Inspect needs", icon: "ⓘ", run: () => X.inspect(t.sim.name + ": " + Object.entries(t.sim.needs).map(([k, v]) => k + " " + Math.round(v)).join(" · ")) }, { label: "Eat something", icon: "🍽", run: () => { const d = Object.keys(inv()).find((k) => itemInfo(k).hunger); if (d) eat(d); else X.setStatus("No food — harvest or cook something."); } }] : [...social(t), { label: "Select " + t.sim.name, run: () => X.select(t.sim.id) }]),
  remote: (t) => [...social(t), { label: "Trade…", icon: "⇄", run: () => startTradeWith(t.sid) }, { label: "Invite to visit", icon: "🏠", run: () => X.invite(t.sid) }, { label: "Message", icon: "✉", run: () => X.dm(t.sid) }],
  npc: (t) => social(t),
  car: () => [{ label: "Wave at the driver", icon: "👋", run: () => X.inspect("The driver waves back.") }, { label: "Admire the car", run: () => X.inspect("Nice ride.") }],
  mycar: (t) => [{ label: "Drive to…", icon: "🚗", run: () => X.pickDriveTarget(t) }, ...(t.parkedAway ? [{ label: "Drive home", icon: "🏠", run: () => X.driveHome() }] : []), { label: "Inspect", icon: "ⓘ", run: () => X.inspect("Your car. Right-click a house or lot sign and choose Drive here.") }],
  boat: (t) => [{ label: "Wave at the boat", icon: "👋", run: () => X.inspect("A horn toots back!") }, { label: "Fish near here", icon: "🎣", run: () => X.fishAt(t.point) }],
  door: (t) => [{ label: "Walk through", icon: "🚪", run: () => X.walkTo(t.point) }, { label: "Knock", icon: "✊", run: () => X.knock(t) }, ...(t.own ? [{ label: "Remove door", edit: true, run: () => X.removeDoor(t.edge) }] : [])],
  terrain: (t) => [{ label: "Walk here", icon: "🚶", run: () => X.walkTo(t.point) }, ...(t.own && t.tile ? [{ label: "Dig garden plot", icon: "⛏", edit: true, run: () => { digPlots(t.tile, t.tile); X.setStatus("Dug a plot. Right-click it to plant."); } }] : []), ...(t.far ? [{ label: "Drive here", icon: "🚗", run: () => X.driveTo(t.point) }] : [])],
  house: (t) => [{ label: "Walk here", icon: "🚶", run: () => X.walkTo(t.door || t.point) }, { label: "Drive here", icon: "🚗", run: () => X.driveTo(t.door || t.point) }, { label: "Inspect house", icon: "ⓘ", run: () => X.inspect(t.name + ": " + t.beds + " bed · " + t.baths + " bath · living room, kitchen, porch, yard, driveway") }, ...(t.sid ? [{ label: "Visit (their shared lot)", run: () => X.visitSign(t.sid) }] : [])],
};
// ---------------- radial menu ----------------
let menu = null;
export function closeMenu() { if (menu) { menu.remove(); menu = null; document.removeEventListener("keydown", menuKeys, true); } }
function menuKeys(e) { if (e.key === "Escape") { e.preventDefault(); closeMenu(); } }
export function actionsFor(t) { const f = REGISTRY[t.kind]; let list = f ? f(t) : []; if (X.visiting() || t.remote) list = list.filter((a) => !a.edit); return list; }
export function openMenu(t, cx, cy, list) {
  closeMenu(); list = list || actionsFor(t); if (!list.length) return null;
  const stage = X.$("sims-stage"), r = stage.getBoundingClientRect();
  menu = el("div", "sims-pie"); menu.setAttribute("role", "menu"); menu.setAttribute("aria-label", (t.title || "Actions"));
  const x = Math.max(110, Math.min(r.width - 110, cx - r.left)), y = Math.max(100, Math.min(r.height - 100, cy - r.top)); menu.style.left = x + "px"; menu.style.top = y + "px";
  const title = el("div", "sims-pie-title", t.title || ""); menu.append(title);
  const n = list.length, radial = n <= 8, R = n <= 4 ? 78 : 92;
  let armed = false; menu.addEventListener("pointerdown", () => { armed = true; }, true);
  if (!radial) menu.classList.add("is-list");
  list.forEach((a, i) => { const b = el("button", "sims-pie-btn", (a.icon ? a.icon + " " : "") + a.label + (a.sub ? " ›" : "")); b.type = "button"; b.setAttribute("role", "menuitem"); if (a.disabled) b.disabled = true;
    if (radial) { const ang = -Math.PI / 2 + (i / n) * Math.PI * 2; b.style.left = Math.cos(ang) * R + "px"; b.style.top = Math.sin(ang) * R * 0.8 + "px"; }
    b.onclick = (e) => { e.stopPropagation(); if (!armed && e.detail !== 0) return; /* ignore the click from lifting a long-press */ if (a.sub) { openMenu({ ...t, title: a.label }, cx, cy, a.sub); return; } closeMenu(); try { a.run(); } catch (err) { console.error(err); X.setStatus("Couldn't do that: " + err.message); } };
    menu.append(b); });
  stage.append(menu); document.addEventListener("keydown", menuKeys, true);
  setTimeout(() => { const f = menu && menu.querySelector("button:not([disabled])"); if (f) f.focus({ preventScroll: true }); }, 0);
  return menu;
}
export const menuOpen = () => !!menu;
export function init(ctx) { X = ctx; T = ctx.THREE; }
export { life };
export { shopBuy, shopSell };
