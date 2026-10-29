// Seeded house floor-plan generator (24x24 lot tiles, street on +z).
// Living room, kitchen, 1-5 bedrooms, 1-3 bathrooms, all opening onto a central hallway;
// front door off the porch, kitchen back door, exterior windows, per-room furniture,
// a front path, a driveway to the street and 1-2 parked cars. Every room is reachable (BFS-checked).
const N = 24;
const FRONT = [[0, 1], [1, 0], [0, -1], [-1, 0]];
const EXT = [["siding", "#d9d2c3"], ["brick", "#a5583f"], ["siding", "#8fa7b8"], ["plaster", "#e8dcc6"], ["siding", "#b7c4a4"], ["brick", "#8a6a5a"], ["stone", "#b5ada0"], ["plaster", "#f0e6d8"], ["siding", "#c98f6b"], ["wood", "#9a6a3a"]];
const PAINT = ["#efe8dc", "#e6dfd2", "#dfe7e9", "#ece3cf", "#e4e9dc", "#efe0dc", "#e2dbea"];
const ROOF = ["#5a3a2a", "#3c3f44", "#6b2f2a", "#2f4a3a", "#555a60", "#7a5a3a"];
export function generatePlan(seed, G, opts = {}) {
  const t = G.tools(G.rng(seed >>> 0));
  const beds = opts.beds || t.ri(1, 5), baths = Math.max(1, Math.min(3, Math.round(beds / 2)));
  const extIdx = t.ri(0, EXT.length - 1), ext = { c: EXT[extIdx][1], p: EXT[extIdx][0] === "plaster" && false ? undefined : EXT[extIdx][0] + ":" + t.ri(1, 50) };
  const paint = t.pick(PAINT);
  // rooms with depths (z extent); left column holds living (front) + kitchen; others balance both columns
  const R = (k, d) => ({ k, d });
  const left = [R("living", t.ri(5, 6)), R("kitchen", t.ri(4, 5))], right = [];
  const others = []; for (let b = 0; b < beds; b++) others.push(R("bed", b === 0 ? 4 : 3)); for (let b = 0; b < baths; b++) others.push(R("bath", 2));
  // interleave so baths sit between bedrooms
  others.sort((a, b) => (a.k === b.k ? 0 : a.k === "bed" ? -1 : 1));
  const mixd = []; const bb = others.filter((r) => r.k === "bed"), ba = others.filter((r) => r.k === "bath"); while (bb.length || ba.length) { if (bb.length) mixd.push(bb.shift()); if (ba.length) mixd.push(ba.shift()); if (bb.length) mixd.push(bb.shift()); }
  const sum = (a) => a.reduce((s, r) => s + r.d, 0);
  for (const r of mixd) (sum(right) <= sum(left) ? right : left).push(r);
  let D = Math.max(sum(left), sum(right));
  const MAXD = 16; // keep a front yard + porch
  while (D > MAXD) { for (const col of [left, right]) for (const r of col) if (sum(col) > MAXD && r.d > (r.k === "bath" ? 2 : r.k === "living" ? 4 : 3)) r.d--; const nd = Math.max(sum(left), sum(right)); if (nd === D) break; D = nd; }
  const wl = left.some((r) => r.k === "bed") || right.length ? t.ri(4, 5) : 4, wr = t.ri(4, 5), W = wl + 2 + wr;
  const flip = t.chance(0.5); // mirror columns
  const driveSide = t.chance(0.5) ? 1 : -1, driveX = driveSide > 0 ? 19 : 2;
  const z1 = 19, z0 = Math.max(2, z1 - D);
  let x0 = driveSide > 0 ? Math.max(1, 18 - W - t.ri(0, 2)) : Math.min(N - 1 - W, 6 + t.ri(0, 2)); x0 = Math.max(1, Math.min(N - 1 - W, x0));
  const x1 = x0 + W;
  const colX = (side) => { const lft = (side === "L") !== flip; return lft ? [x0, x0 + (flip ? wr : wl)] : [x1 - (flip ? wl : wr), x1]; };
  const hx0 = x0 + (flip ? wr : wl), hx1 = hx0 + 2;
  const rooms = [];
  for (const [col, side] of [[left, "L"], [right, "R"]]) {
    let z = z1; const [rx0, rx1] = colX(side);
    col.forEach((r, i) => { const top = i === col.length - 1 ? z0 : z - r.d; rooms.push({ k: r.k, x0: rx0, x1: rx1, z0: top, z1: z, side: rx0 < hx0 ? -1 : 1 }); z = top; });
  }
  const walls = {}, floors = {}, objects = []; let nid = 1;
  const wall = (key, ty) => { walls[key] = { t: ty || "wall", c: paint }; };
  const rectWalls = (r) => { for (let x = r.x0; x < r.x1; x++) { wall("h:" + x + ":" + r.z0); wall("h:" + x + ":" + r.z1); } for (let z = r.z0; z < r.z1; z++) { wall("v:" + r.x0 + ":" + z); wall("v:" + r.x1 + ":" + z); } };
  for (const r of rooms) rectWalls(r);
  rectWalls({ x0: hx0, x1: hx1, z0, z1 });
  // exterior finish + windows
  const exterior = (k) => { const [o, xs, zs] = k.split(":"); const x = +xs, z = +zs; return o === "h" ? z === z0 || z === z1 : x === x0 || x === x1; };
  for (const k in walls) if (exterior(k)) { walls[k].c = ext.c; walls[k].p = ext.p; walls[k].ext = 1; }
  const doors = [];
  const door = (k, front) => { walls[k] = Object.assign(walls[k] || { c: paint }, { t: "door" }); doors.push({ k, front: !!front }); };
  for (const r of rooms) {
    const zc = r.z0 + Math.floor((r.z1 - r.z0) / 2), ex = r.side < 0 ? r.x1 : r.x0;
    if (r.k === "living") { delete walls["v:" + ex + ":" + zc]; delete walls["v:" + ex + ":" + (zc - 1)]; r.door = [r.side < 0 ? ex - 1 : ex, zc]; }
    else { door("v:" + ex + ":" + zc); r.door = [r.side < 0 ? ex - 1 : ex, zc]; }
    if (r.k === "kitchen") { const bx = r.x0 + Math.floor((r.x1 - r.x0) / 2); if (r.z0 === z0) door("h:" + bx + ":" + z0); }
    // windows on exterior walls every ~2-3 tiles, not in baths' corners
    for (let x = r.x0 + 1; x < r.x1 - 1; x += 2) for (const z of [r.z0, r.z1]) { const k = "h:" + x + ":" + z; if (walls[k] && walls[k].ext && walls[k].t === "wall") walls[k].t = "window"; }
    for (let z = r.z0 + 1; z < r.z1 - 1; z += 2) for (const x of [r.x0, r.x1]) { const k = "v:" + x + ":" + z; if (walls[k] && walls[k].ext && walls[k].t === "wall") walls[k].t = "window"; }
  }
  const frontX = hx0 + (t.chance(0.5) ? 0 : 1);
  door("h:" + frontX + ":" + z1, true);
  const flo = { living: t.pick(["wood", "herring", "carpet"]), kitchen: t.pick(["tile", "checker", "terrazzo"]), bed: t.pick(["carpet", "wood"]), bath: t.pick(["tile", "marble"]), hall: t.pick(["wood", "herring"]) };
  const fcol = { wood: "#b89970", herring: "#a87f55", carpet: t.pick(["#8c7a6b", "#6f7f8c", "#9a8a70"]), tile: "#d8d2c6", checker: "#e8e4dc", terrazzo: "#cfc7bb", marble: "#e9e6e0", concrete: "#a9a59d", pavers: "#b59c84", stone: "#9d968a" };
  const fseed = t.ri(1, 40);
  const fill = (r, kind) => { for (let x = r.x0; x < r.x1; x++) for (let z = r.z0; z < r.z1; z++) floors[x + "," + z] = kind + ":" + fseed + ":" + fcol[kind]; };
  for (const r of rooms) fill(r, flo[r.k]);
  fill({ x0: hx0, x1: hx1, z0, z1 }, flo.hall);
  // porch, path, driveway
  const porch = { x0: Math.max(x0, hx0 - 1), x1: Math.min(x1, hx1 + 1), z0: z1, z1: z1 + 2 };
  fill(porch, "wood");
  for (let z = porch.z1; z < N; z++) floors[frontX + "," + z] = "pavers:" + fseed + ":" + fcol.pavers;
  const drive = { x0: driveX, x1: driveX + 3, z0: Math.max(z0, 9), z1: N };
  fill(drive, "concrete");
  // ---- furniture ----
  const occ = new Map(), reserved = new Set();
  for (const r of rooms) if (r.door) reserved.add(r.door[0] + "," + r.door[1]);
  for (let z = z0; z < z1; z++) for (let x = hx0; x < hx1; x++) reserved.add(x + "," + z); // keep the hall clear
  for (const d of doors) { const [o, xs, zs] = d.k.split(":"); const x = +xs, z = +zs; if (o === "h") { reserved.add(x + "," + z); reserved.add(x + "," + (z - 1)); } else { reserved.add(x + "," + z); reserved.add(x - 1 + "," + z); } }
  const fp = (cat, rot) => { const c = G.CATS[cat]; return rot % 2 ? [c.d, c.w] : [c.w, c.d]; };
  const fits = (r, cat, x, z, rot) => { const [Wd, Dd] = fp(cat, rot); if (x < r.x0 || z < r.z0 || x + Wd > r.x1 || z + Dd > r.z1) return false; for (let i = 0; i < Wd; i++) for (let j = 0; j < Dd; j++) { const k = x + i + "," + (z + j); if (occ.has(k) || reserved.has(k)) return false; } const [fx, fz] = FRONT[rot]; const ax = fx > 0 ? x + Wd : fx < 0 ? x - 1 : x, az = fz > 0 ? z + Dd : fz < 0 ? z - 1 : z; if (ax < r.x0 || az < r.z0 || ax >= r.x1 || az >= r.z1 || occ.has(ax + "," + az)) return false; return true; };
  const put = (r, cat, prefs, opt = {}) => {
    const c = G.CATS[cat]; if (!c) return null; const cands = [];
    for (const side of prefs) {
      if (side === "back") for (let x = r.x0; x < r.x1; x++) cands.push([x, r.z0, 0]);
      if (side === "front") for (let x = r.x0; x < r.x1; x++) cands.push([x, r.z1 - (c.d), 2]);
      if (side === "left") for (let z = r.z0; z < r.z1; z++) cands.push([r.x0, z, 1]);
      if (side === "right") for (let z = r.z0; z < r.z1; z++) cands.push([r.x1 - c.d, z, 3]);
      if (side === "mid") for (let x = r.x0 + 1; x < r.x1 - 1; x++) for (let z = r.z0 + 1; z < r.z1 - 1; z++) cands.push([x, z, opt.rot || 0]);
    }
    if (opt.shuffle !== false) for (let i = cands.length - 1; i > 0; i--) { const j = t.ri(0, i); [cands[i], cands[j]] = [cands[j], cands[i]]; }
    for (const [x, z, rot] of cands) if (fits(r, cat, x, z, rot)) { const [Wd, Dd] = fp(cat, rot); for (let i = 0; i < Wd; i++) for (let j = 0; j < Dd; j++) occ.set(x + i + "," + (z + j), nid); const o = { id: "p" + nid++, type: G.genType(cat, t.ri(1, 999999)), x, z, rot, room: r.k }; objects.push(o); return o; }
    return null;
  };
  const away = (r) => (r.side < 0 ? "left" : "right"); // wall opposite the hallway
  for (const r of rooms) {
    if (r.k === "living") { put(r, t.chance(0.6) ? "sofa" : "loveseat", ["back", away(r)]); put(r, "tv", ["front", away(r)]); put(r, "armchair", [away(r), "back"]); put(r, t.chance(0.5) ? "bookshelf" : "fireplace", [away(r), "back", "front"]); put(r, "floorlamp", ["back", "front"]); put(r, t.pick(["plant", "tree", "aquarium"]), ["front", "back"]); if (opts.easel) put(r, "easel", ["front", "back", away(r)]); }
    if (r.k === "kitchen") { put(r, "fridge", ["back", away(r)]); put(r, "stove", ["back", away(r)]); put(r, "ksink", ["back", away(r)]); put(r, "counter", ["back", away(r), "front"]); const tb = put(r, "dtable", ["mid", "front"]); if (tb) for (const [dx, dz, rot] of [[-1, 0, 1], [1, 0, 3], [0, 1, 2]]) { const x = tb.x + dx, z = tb.z + dz; if (fits(r, "dchair", x, z, rot)) { occ.set(x + "," + z, nid); objects.push({ id: "p" + nid++, type: G.genType("dchair", t.ri(1, 999999)), x, z, rot, room: r.k }); } } }
    if (r.k === "bed") { const master = !rooms.some((q) => q.k === "bed" && q.master); r.master = master; put(r, master && r.x1 - r.x0 >= 4 ? "dbed" : "bed", ["back", away(r)]); put(r, "nightstand", ["back", away(r)]); put(r, t.chance(0.5) ? "dresser" : "wardrobe", [away(r), "front", "back"]); if (t.chance(0.4)) put(r, t.pick(["desk", "computer", "bookshelf", "plant"]), ["front", away(r)]); }
    if (r.k === "bath") { put(r, "toilet", [away(r), "back"]); put(r, r.x1 - r.x0 >= 4 && t.chance(0.5) ? "bathtub" : "shower", ["back", away(r), "front"]); put(r, "vanity", ["front", "back", away(r)]); }
  }
  // porch bench + lantern, some yard extras
  const pr = { ...porch, k: "porch" }; put(pr, "bench", ["front", "back"]);
  const yardL = { x0: 1, x1: x0, z0: z0, z1: z1, k: "yard" }, yardR = { x0: x1, x1: driveSide > 0 ? driveX : N - 1, z0, z1, k: "yard" };
  const yard = (yardL.x1 - yardL.x0) >= (yardR.x1 - yardR.x0) ? yardL : yardR;
  if (yard.x1 - yard.x0 >= 2) { if (t.chance(0.6)) put(yard, "grill", ["mid", "back"]); if (t.chance(0.4)) put(yard, "swing", ["mid"]); if (t.chance(0.5)) put(yard, "planter", ["mid", "back"]); }
  // ---- connectivity check: every object needs a reachable approach tile from the front path ----
  const blocks = (k) => walls[k] && walls[k].t !== "door";
  const edge = (ax, az, bx, bz) => (bx === ax + 1 ? "v:" + bx + ":" + az : bx === ax - 1 ? "v:" + ax + ":" + az : bz === az + 1 ? "h:" + ax + ":" + bz : "h:" + ax + ":" + az);
  const reach = () => { const seen = new Set([frontX + "," + (N - 1)]), q = [[frontX, N - 1]]; while (q.length) { const [x, z] = q.shift(); for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, nz = z + dz, k = nx + "," + nz; if (nx < 0 || nz < 0 || nx >= N || nz >= N || seen.has(k) || occ.has(k) || blocks(edge(x, z, nx, nz))) continue; seen.add(k); q.push([nx, nz]); } } return seen; };
  for (let pass = 0; pass < 6; pass++) {
    const seen = reach(); let bad = null;
    for (const o of objects) { const cat = o.type.split(":")[1]; const [Wd, Dd] = fp(cat, o.rot); let ok = false;
      for (let i = -1; i <= Wd && !ok; i++) for (let j = -1; j <= Dd && !ok; j++) { const x = o.x + i, z = o.z + j; if ((i < 0 || i >= Wd) !== (j < 0 || j >= Dd) && seen.has(x + "," + z)) ok = true; }
      if (!ok) { bad = o; break; } }
    for (const r of rooms) if (r.door && !seen.has(r.door[0] + "," + r.door[1])) bad = bad || objects.find((o) => o.room === r.k);
    if (!bad) break; objects.splice(objects.indexOf(bad), 1); for (const [k, v] of [...occ]) if ("p" + v === bad.id) occ.delete(k);
  }
  const cars = []; const nc = t.chance(0.55) ? 2 : 1; for (let i = 0; i < nc; i++) cars.push({ x: drive.x0 + 1.5, z: N - 2.6 - i * 5.2, kind: t.pick(["sedan", "hatch", "sedan", "van", "pickup"]), col: t.pick(["#c43a32", "#2f5d8a", "#e8e4dc", "#1d1d1f", "#6b7a4a", "#c9a227", "#8a8f96", "#5a3a6a"]) });
  return { beds, baths, walls, floors, objects, rooms, house: { x0, z0, x1, z1 }, hall: { x0: hx0, x1: hx1 }, door: { x: frontX, z: z1 }, gate: { x: frontX, z: N - 1 }, porch, drive, cars, roof: { c: t.pick(ROOF), style: t.pick(["gable", "gable", "hip"]) }, ext, fenced: t.chance(0.5) };
}
export function planLabel(p) { return p.beds + " bd · " + p.baths + " ba"; }
