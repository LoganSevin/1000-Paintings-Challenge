/**
 * Dungeon on the Sprites tab.
 * Send copies the finished stills into the room.
 * Levels come from clears. Anyone on the tab shares the same room.
 */
(function () {
  "use strict";

  var ROOM_W = 22;
  var ROOM_H = 14;
  var TILE = 32;
  var MIGHT_STEP = 0.28;
  var HASTE_STEP = 0.18;
  var STRIDE_STEP = 0.14;
  var BURST_STEP = 0.3;
  var VITAL_STEP = 8;
  var OFFERS = ["might", "haste", "stride", "vitality", "burst"];

  var me = resetMe();
  var frames = { idle: [], walk: [], burst: [] };
  var enemies = [];
  var bolts = [];
  var gems = [];
  var others = {};
  var spriteCache = {};
  var keys = {};
  var pointer = { on: false, x: 0, y: 0 };
  var hits = [];
  var running = false;
  var paused = false;
  var mode = "solo";
  var floorN = 1;
  var timer = 0;
  var netTimer = 0;
  var last = 0;
  var shot = 0;
  var hurt = 0;
  var burstLeft = 0;
  var spriteRev = 0;
  var sentRev = 0;
  var enterLatch = false;
  var known = {};
  var note = "";

  function resetMe() {
    return {
      x: 4,
      y: 7,
      face: 1,
      cycle: "idle",
      frame: 0,
      hp: 30,
      maxHp: 30,
      level: 1,
      xp: 0,
      might: 1,
      haste: 1,
      stride: 1,
      burstPow: 1,
      meter: 40,
    };
  }

  function $(id) {
    return document.getElementById(id);
  }

  function apiUrl(path) {
    if (typeof window.galleryApiUrl === "function") return window.galleryApiUrl(path);
    var base = String(window.SPELLFORGE_API_BASE || "").replace(/\/$/, "");
    var p = path.charAt(0) === "/" ? path : "/" + path;
    return base ? base + p : p;
  }

  function playerName() {
    var name = "";
    try { name = localStorage.getItem("pageChatName") || ""; } catch (e) {}
    name = String(name).replace(/<[^>]*>/g, "").trim();
    if (!name || /^guest(-\d+)?$/i.test(name)) name = "guest";
    return name.slice(0, 32);
  }

  function playerId() {
    var id = "";
    try { id = localStorage.getItem("sprDungeonId") || ""; } catch (e) {}
    if (!/^[a-z0-9-]{8,40}$/.test(id)) {
      id = "p" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
      try { localStorage.setItem("sprDungeonId", id); } catch (e2) {}
    }
    return id;
  }

  function xpNeed(level) {
    return 4 + level * 3;
  }

  function setNote(text) {
    note = text || "";
    var el = $("spr-game-note");
    if (el && text) el.textContent = text;
  }

  function setStatus(text, isError) {
    var el = $("spr-status");
    if (!el) return;
    el.textContent = text || "";
    el.classList.toggle("is-error", !!isError);
  }

  function frameCount() {
    return frames.idle.length + frames.walk.length + frames.burst.length;
  }

  function one(n) {
    return (Math.round(n * 10) / 10).toFixed(1);
  }

  function offerText(id) {
    if (id === "might") {
      var next = me.might + MIGHT_STEP;
      return "Might. Shot damage " + one(4 * me.might) + " now, " + one(4 * next) + " with this. Burst damage " + one(10 * me.might * me.burstPow) + " now, " + one(10 * next * me.burstPow) + " with this.";
    }
    if (id === "haste") {
      var nextH = me.haste + HASTE_STEP;
      return "Haste. Time between shots " + one(0.7 / me.haste) + "s now, " + one(0.7 / nextH) + "s with this. Meter gain " + one(22 * me.haste) + " a second now, " + one(22 * nextH) + " with this.";
    }
    if (id === "stride") {
      var nextS = me.stride + STRIDE_STEP;
      return "Stride. Move speed " + one(4.4 * me.stride) + " tiles a second now, " + one(4.4 * nextS) + " with this.";
    }
    if (id === "vitality") {
      var max = me.maxHp + VITAL_STEP;
      var hp = Math.min(max, me.hp + VITAL_STEP);
      return "Vitality. Life " + Math.round(me.hp) + "/" + me.maxHp + " now, " + Math.round(hp) + "/" + max + " with this.";
    }
    var nextB = me.burstPow + BURST_STEP;
    return "Burst. Reach " + one(2.3 + me.burstPow) + " tiles now, " + one(2.3 + nextB) + " with this. Burst damage " + one(10 * me.might * me.burstPow) + " now, " + one(10 * me.might * nextB) + " with this.";
  }

  function scaleCanvas(node, size) {
    var c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    var g = c.getContext("2d");
    g.imageSmoothingEnabled = false;
    g.drawImage(node, 0, 0, size, size);
    return c;
  }

  function knockOut(source) {
    var w = source.width;
    var h = source.height;
    if (w < 2 || h < 2) return source;
    var c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    var g = c.getContext("2d");
    g.imageSmoothingEnabled = false;
    g.drawImage(source, 0, 0);
    var image = g.getImageData(0, 0, w, h);
    var d = image.data;
    var samples = [];
    var step = Math.max(1, Math.floor(Math.max(w, h) / 24));
    var x;
    var y;
    for (x = 0; x < w; x += step) {
      samples.push(x * 4);
      samples.push(((h - 1) * w + x) * 4);
    }
    for (y = step; y < h - 1; y += step) {
      samples.push(y * w * 4);
      samples.push((y * w + w - 1) * 4);
    }
    function mid(channel) {
      var vals = [];
      var i;
      for (i = 0; i < samples.length; i++) vals.push(d[samples[i] + channel]);
      vals.sort(function (a, b) { return a - b; });
      return vals[Math.floor(vals.length / 2)];
    }
    var kr = mid(0);
    var kg = mid(1);
    var kb = mid(2);
    function dist2(i) {
      var dr = d[i] - kr;
      var dg = d[i + 1] - kg;
      var db = d[i + 2] - kb;
      return dr * dr + dg * dg + db * db;
    }
    function flood(limit2) {
      var alpha = new Uint8Array(w * h);
      var seen = new Uint8Array(w * h);
      var stack = [];
      var i;
      for (i = 0; i < w * h; i++) alpha[i] = d[i * 4 + 3];
      function push(x0, y0) {
        if (x0 < 0 || y0 < 0 || x0 >= w || y0 >= h) return;
        var p = y0 * w + x0;
        if (seen[p]) return;
        seen[p] = 1;
        if (dist2(p * 4) > limit2) return;
        alpha[p] = 0;
        stack.push(p);
      }
      for (x = 0; x < w; x++) {
        push(x, 0);
        push(x, h - 1);
      }
      for (y = 1; y < h - 1; y++) {
        push(0, y);
        push(w - 1, y);
      }
      var n = 0;
      while (stack.length && n < w * h) {
        var p = stack.pop();
        n += 1;
        var px = p % w;
        var py = (p / w) | 0;
        push(px + 1, py);
        push(px - 1, py);
        push(px, py + 1);
        push(px, py - 1);
      }
      var cleared = 0;
      for (i = 0; i < alpha.length; i++) if (alpha[i] === 0) cleared += 1;
      return { alpha: alpha, share: cleared / alpha.length };
    }
    var pass = flood(32 * 32);
    if (pass.share < 0.12) pass = flood(56 * 56);
    if (pass.share > 0.97 || pass.share < 0.05) return source;
    var alpha = pass.alpha;
    var round;
    for (round = 0; round < 3; round++) {
      var next = new Uint8Array(alpha);
      for (y = 1; y < h - 1; y++) {
        for (x = 1; x < w - 1; x++) {
          var p = y * w + x;
          if (alpha[p] === 0) continue;
          var edge = alpha[p - 1] < 28 || alpha[p + 1] < 28 || alpha[p - w] < 28 || alpha[p + w] < 28;
          if (!edge) continue;
          var dist = Math.sqrt(dist2(p * 4));
          if (dist < 100) next[p] = Math.min(alpha[p], Math.round(255 * dist / 100));
        }
      }
      alpha = next;
    }
    for (var p = 0; p < w * h; p++) d[p * 4 + 3] = alpha[p];
    g.putImageData(image, 0, 0);
    return c;
  }

  function capture() {
    var out = { idle: [], walk: [], burst: [] };
    var nodes = document.querySelectorAll("#spr-layers .spr-layer");
    var i;
    for (i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var cycle = node.getAttribute("data-cycle");
      var index = parseInt(node.getAttribute("data-frame"), 10) || 0;
      if (!out[cycle] || node.width < 2) continue;
      var fitted = node.width > 192 ? scaleCanvas(node, 192) : node;
      out[cycle][index] = scaleCanvas(knockOut(fitted), 96);
    }
    ["idle", "walk", "burst"].forEach(function (key) {
      out[key] = out[key].filter(Boolean);
    });
    return out;
  }

  function packSprite() {
    var list = [];
    function push(img) {
      if (!img || list.length >= 4) return;
      var size = 64;
      var url = "";
      while (size >= 24) {
        var c = scaleCanvas(img, size);
        try { url = c.toDataURL("image/png"); } catch (e) { url = ""; }
        if (url && url.length <= 16000) break;
        size -= 16;
        url = "";
      }
      if (url && url.length <= 16000) list.push(url);
    }
    frames.idle.slice(0, 2).forEach(push);
    frames.walk.slice(0, 2).forEach(push);
    return list;
  }

  function spawnWave() {
    enemies = [];
    gems = [];
    bolts = [];
    var n = Math.min(12, 3 + floorN * 2);
    var i;
    for (i = 0; i < n; i++) {
      var edge = i % 4;
      var x = edge === 1 ? ROOM_W - 2 : 2;
      var y = 2 + (i % 8);
      if (edge === 2) { x = 4 + (i % 10); y = 1.6; }
      if (edge === 3) { x = 4 + (i % 10); y = ROOM_H - 1.8; }
      var hp = 6 + floorN * 4;
      enemies.push({ id: "local" + floorN + "n" + i, x: x, y: y, hp: hp, maxHp: hp, spd: 1.15 + floorN * 0.05 });
    }
  }

  function offerLevel() {
    paused = true;
    var box = $("spr-level");
    var host = $("spr-level-choices");
    if (!box || !host) return;
    var pool = OFFERS.slice();
    var picks = [];
    while (picks.length < 3 && pool.length) {
      picks.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    }
    host.innerHTML = "";
    picks.forEach(function (pick) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = offerText(pick);
      btn.addEventListener("click", function () {
        applyOffer(pick);
        paused = false;
        box.hidden = true;
      });
      host.appendChild(btn);
    });
    box.hidden = false;
  }

  function applyOffer(id) {
    if (id === "might") me.might += MIGHT_STEP;
    if (id === "haste") me.haste += HASTE_STEP;
    if (id === "stride") me.stride += STRIDE_STEP;
    if (id === "burst") me.burstPow += BURST_STEP;
    if (id === "vitality") {
      me.maxHp += VITAL_STEP;
      me.hp = Math.min(me.maxHp, me.hp + VITAL_STEP);
    }
    me.level += 1;
    me.xp = 0;
  }

  function addXp(amount) {
    if (paused) return;
    me.xp += amount;
    if (me.xp >= xpNeed(me.level)) offerLevel();
  }

  function nearestEnemy() {
    var best = null;
    var bestD = 1e9;
    var i;
    for (i = 0; i < enemies.length; i++) {
      var e = enemies[i];
      var dx = e.x - me.x;
      var dy = e.y - me.y;
      var d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  function fire() {
    var target = nearestEnemy();
    if (!target) return;
    var dx = target.x - me.x;
    var dy = target.y - me.y;
    var dist = Math.sqrt(dx * dx + dy * dy) || 1;
    bolts.push({
      x: me.x,
      y: me.y - 0.4,
      vx: (dx / dist) * 9,
      vy: (dy / dist) * 9,
      dmg: 4 * me.might,
    });
  }

  function doBurst() {
    if (me.meter < 100 || paused) return;
    me.meter = 0;
    burstLeft = 0.55;
    me.cycle = "burst";
    var radius = 2.3 + me.burstPow;
    var dmg = 10 * me.might * me.burstPow;
    var i;
    for (i = enemies.length - 1; i >= 0; i--) {
      var e = enemies[i];
      var dx = e.x - me.x;
      var dy = e.y - me.y;
      if (dx * dx + dy * dy > radius * radius) continue;
      if (mode === "live") hits.push({ id: e.id, dmg: dmg });
      else hurtEnemy(e, dmg, i);
    }
  }

  function hurtEnemy(e, dmg, index) {
    e.hp -= dmg;
    if (e.hp > 0) return;
    gems.push({ x: e.x, y: e.y, v: 4 });
    enemies.splice(index, 1);
  }

  function tick(dt) {
    if (!running) return;
    me.meter = Math.min(100, me.meter + dt * 22 * me.haste);
    if (hurt > 0) hurt -= dt;
    if (burstLeft > 0) {
      burstLeft -= dt;
      me.cycle = "burst";
    }
    var ax = 0;
    var ay = 0;
    if (!paused) {
      if (keys.KeyW || keys.KeyK) ay -= 1;
      if (keys.KeyS || keys.KeyJ) ay += 1;
      if (keys.KeyA) ax -= 1;
      if (keys.KeyD) ax += 1;
      if (pointer.on) {
        ax += pointer.x;
        ay += pointer.y;
      }
      var mag = Math.sqrt(ax * ax + ay * ay);
      if (mag > 1) {
        ax /= mag;
        ay /= mag;
      }
      if (mag > 0.08) {
        me.x += ax * 4.4 * me.stride * dt;
        me.y += ay * 4.4 * me.stride * dt;
        if (Math.abs(ax) > 0.2) me.face = ax < 0 ? -1 : 1;
        if (!(burstLeft > 0)) me.cycle = "walk";
      } else if (!(burstLeft > 0)) {
        me.cycle = "idle";
      }
      me.x = Math.max(1.2, Math.min(ROOM_W - 1.2, me.x));
      me.y = Math.max(1.2, Math.min(ROOM_H - 1.2, me.y));
      me.frame = Math.floor(performance.now() / 140) % 6;
      shot -= dt;
      if (shot <= 0) {
        shot = 0.7 / me.haste;
        fire();
      }
    }

    var b;
    for (b = bolts.length - 1; b >= 0; b--) {
      var bolt = bolts[b];
      bolt.x += bolt.vx * dt;
      bolt.y += bolt.vy * dt;
      var hit = false;
      var e;
      for (e = enemies.length - 1; e >= 0; e--) {
        var foe = enemies[e];
        var dx = foe.x - bolt.x;
        var dy = foe.y - bolt.y;
        if (dx * dx + dy * dy > 0.45) continue;
        hit = true;
        if (mode === "live") hits.push({ id: foe.id, dmg: bolt.dmg });
        else hurtEnemy(foe, bolt.dmg, e);
        break;
      }
      if (hit || bolt.x < 0 || bolt.y < 0 || bolt.x > ROOM_W || bolt.y > ROOM_H) bolts.splice(b, 1);
    }

    if (mode === "solo" && !paused) {
      var i;
      for (i = 0; i < enemies.length; i++) {
        var foe2 = enemies[i];
        var dx2 = me.x - foe2.x;
        var dy2 = me.y - foe2.y;
        var dist = Math.sqrt(dx2 * dx2 + dy2 * dy2) || 1;
        if (dist > 0.5) {
          foe2.x += (dx2 / dist) * foe2.spd * dt;
          foe2.y += (dy2 / dist) * foe2.spd * dt;
        }
      }
    }

    if (!paused && hurt <= 0) {
      var j;
      for (j = 0; j < enemies.length; j++) {
        var foe3 = enemies[j];
        var dx3 = foe3.x - me.x;
        var dy3 = foe3.y - me.y;
        if (dx3 * dx3 + dy3 * dy3 < 0.55) {
          me.hp -= 5 + floorN;
          hurt = 0.7;
          break;
        }
      }
    }

    var g;
    for (g = gems.length - 1; g >= 0; g--) {
      var gem = gems[g];
      var gx = me.x - gem.x;
      var gy = me.y - gem.y;
      var gd = Math.sqrt(gx * gx + gy * gy) || 1;
      if (gd < 2.6) {
        gem.x += (gx / gd) * 7 * dt;
        gem.y += (gy / gd) * 7 * dt;
      }
      if (gd < 0.45) {
        addXp(gem.v);
        gems.splice(g, 1);
      }
    }

    if (me.hp <= 0) {
      me.hp = Math.ceil(me.maxHp * 0.55);
      me.x = 4;
      me.y = 7;
      hurt = 1.4;
      setNote("You fainted, then got back up. The level stays.");
    }

    var door = !enemies.length && me.x > ROOM_W - 2.1 && Math.abs(me.y - ROOM_H / 2) < 1.6;
    if (door && !enterLatch && mode === "solo") {
      enterLatch = true;
      floorN += 1;
      me.x = 2.2;
      spawnWave();
      setNote("Floor " + floorN + ". The room fills again.");
    }
    if (!door) enterLatch = false;

    var hudL = $("spr-hud-level");
    var hudF = $("spr-hud-floor");
    var hudP = $("spr-hud-party");
    if (hudL) hudL.textContent = "Level " + me.level + "  " + me.hp + "/" + me.maxHp;
    if (hudF) hudF.textContent = "Floor " + floorN;
    var party = Object.keys(others).length;
    if (hudP) hudP.textContent = party ? "With " + party + (party === 1 ? " other" : " others") : (mode === "live" ? "The room is open" : "Just you");
    draw();
  }

  function worldX(tile) { return tile * TILE + 16; }
  function worldY(tile) { return tile * TILE + 16; }

  function drawCreature(g, set, cycle, frame, x, y, face) {
    var list = set && set[cycle] && set[cycle].length ? set[cycle] : (set && set.idle);
    g.save();
    g.translate(worldX(x), worldY(y));
    g.fillStyle = "rgba(0,0,0,0.45)";
    g.beginPath();
    g.ellipse(0, 2, 12, 4, 0, 0, Math.PI * 2);
    g.fill();
    if (list && list.length) {
      var img = list[Math.abs(frame) % list.length];
      if (face < 0) g.scale(-1, 1);
      g.imageSmoothingEnabled = false;
      g.drawImage(img, -21, -40, 42, 42);
    } else {
      g.fillStyle = "#f0d78a";
      g.fillRect(-8, -28, 16, 18);
      g.fillStyle = "#ece6d6";
      g.fillRect(-4, -24, 3, 3);
    }
    g.restore();
  }

  function draw() {
    var canvas = $("spr-game-canvas");
    if (!canvas) return;
    var g = canvas.getContext("2d");
    g.imageSmoothingEnabled = false;
    g.fillStyle = "#12151e";
    g.fillRect(0, 0, canvas.width, canvas.height);
    var x;
    var y;
    for (y = 0; y < ROOM_H; y++) {
      for (x = 0; x < ROOM_W; x++) {
        var edge = x === 0 || y === 0 || x === ROOM_W - 1 || y === ROOM_H - 1;
        g.fillStyle = edge ? "#2a2418" : ((x + y) % 2 ? "#181b24" : "#141820");
        g.fillRect(16 + x * TILE, 16 + y * TILE, TILE - 1, TILE - 1);
      }
    }
    if (!enemies.length && running) {
      g.fillStyle = "#c9a227";
      g.fillRect(16 + (ROOM_W - 1) * TILE, 16 + (Math.floor(ROOM_H / 2) - 1) * TILE, TILE - 1, TILE * 2);
    }
    if (!running) {
      g.fillStyle = "#f0e2c0";
      g.font = "20px Georgia, serif";
      g.textAlign = "center";
      g.fillText("Send the finished sprite in.", canvas.width / 2, canvas.height / 2);
      g.textAlign = "left";
      return;
    }
    var i;
    for (i = 0; i < gems.length; i++) {
      g.fillStyle = "#8fd0ea";
      g.fillRect(worldX(gems[i].x) - 3, worldY(gems[i].y) - 3, 6, 6);
    }
    for (i = 0; i < enemies.length; i++) {
      var e = enemies[i];
      g.fillStyle = "#c4493a";
      g.fillRect(worldX(e.x) - 10, worldY(e.y) - 18, 20, 16);
      g.fillStyle = "#1a0c0c";
      g.fillRect(worldX(e.x) - 6, worldY(e.y) - 14, 3, 3);
      g.fillRect(worldX(e.x) + 2, worldY(e.y) - 14, 3, 3);
      g.fillStyle = "#3a1210";
      g.fillRect(worldX(e.x) - 12, worldY(e.y) - 22, 24, 3);
      g.fillStyle = "#8fd0ea";
      g.fillRect(worldX(e.x) - 12, worldY(e.y) - 22, 24 * Math.max(0, e.hp / e.maxHp), 3);
    }
    for (i = 0; i < bolts.length; i++) {
      g.fillStyle = "#f0d78a";
      g.fillRect(worldX(bolts[i].x) - 3, worldY(bolts[i].y) - 3, 6, 6);
    }
    var ids = Object.keys(others);
    for (i = 0; i < ids.length; i++) {
      var o = others[ids[i]];
      drawCreature(g, o.frames, o.cycle, o.frame, o.x, o.y, o.face);
      g.fillStyle = "#f0e2c0";
      g.font = "12px sans-serif";
      g.textAlign = "center";
      g.fillText(o.name + "  " + o.level, worldX(o.x), worldY(o.y) - 46);
      g.textAlign = "left";
    }
    if (hurt > 0.45) g.globalAlpha = 0.55;
    drawCreature(g, frames, me.cycle, me.frame, me.x, me.y, me.face);
    g.globalAlpha = 1;
    g.fillStyle = "#241418";
    g.fillRect(worldX(me.x) - 16, worldY(me.y) - 48, 32, 4);
    g.fillStyle = "#d46a6a";
    g.fillRect(worldX(me.x) - 16, worldY(me.y) - 48, 32 * Math.max(0, me.hp / me.maxHp), 4);
    g.fillStyle = "#2a2418";
    g.fillRect(worldX(me.x) - 16, worldY(me.y) + 6, 32, 3);
    g.fillStyle = "#c9a227";
    g.fillRect(worldX(me.x) - 16, worldY(me.y) + 6, 32 * (me.meter / 100), 3);
  }

  function loadOtherSprite(id, rev, list) {
    if (!list || !list.length) return;
    var frameset = { idle: [], walk: [], burst: [] };
    var pending = list.map(function (url, index) {
      return new Promise(function (resolve) {
        var img = new Image();
        img.onload = function () {
          if (index < 2) frameset.idle.push(img);
          else frameset.walk.push(img);
          resolve();
        };
        img.onerror = function () { resolve(); };
        img.src = url;
      });
    });
    Promise.all(pending).then(function () {
      spriteCache[id] = { rev: rev, frames: frameset };
      if (others[id]) others[id].frames = frameset;
    });
  }

  function syncNet() {
    if (!running) return;
    var body = {
      id: playerId(),
      name: playerName(),
      x: me.x,
      y: me.y,
      face: me.face,
      cycle: me.cycle,
      frame: me.frame % 6,
      level: me.level,
      hp: me.hp,
      maxHp: me.maxHp,
      hits: hits.splice(0, 12),
      enter: !enemies.length && me.x > ROOM_W - 2.1 && Math.abs(me.y - ROOM_H / 2) < 1.6,
      known: known,
    };
    if (spriteRev !== sentRev) {
      body.spriteRev = spriteRev;
      body.sprite = packSprite();
    }
    fetch(apiUrl("/api/sprite-dungeon"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify(body),
    }).then(function (r) {
      return r.json().catch(function () { return {}; });
    }).then(function (data) {
      if (!data || !data.ok) throw new Error("offline");
      mode = "live";
      sentRev = spriteRev;
      if (typeof data.floor === "number" && data.floor !== floorN) {
        floorN = data.floor;
        me.x = 2.2;
        enterLatch = true;
      }
      enemies = Array.isArray(data.enemies) ? data.enemies : [];
      if (Array.isArray(data.killed)) data.killed.forEach(function () { addXp(4); });
      var next = {};
      (data.players || []).forEach(function (p) {
        var cached = spriteCache[p.id];
        if (p.sprite && p.sprite.length && (!cached || cached.rev !== p.spriteRev)) loadOtherSprite(p.id, p.spriteRev, p.sprite);
        known[p.id] = p.spriteRev || 0;
        next[p.id] = {
          name: p.name || "guest",
          x: p.x,
          y: p.y,
          face: p.face < 0 ? -1 : 1,
          cycle: p.cycle || "idle",
          frame: p.frame || 0,
          level: p.level || 1,
          frames: cached ? cached.frames : null,
        };
      });
      others = next;
    }).catch(function () {
      if (mode === "live") {
        mode = "solo";
        if (!enemies.length) spawnWave();
        setNote("The shared room did not answer. This run stays on your screen.");
      }
    });
  }

  function loop() {
    var now = performance.now();
    var dt = last ? Math.min(0.08, (now - last) / 1000) : 0.016;
    last = now;
    tick(dt);
  }

  function startLoops() {
    if (timer) clearInterval(timer);
    if (netTimer) clearInterval(netTimer);
    last = 0;
    timer = setInterval(loop, 32);
    netTimer = setInterval(syncNet, 800);
    syncNet();
  }

  function stopLoops() {
    if (timer) clearInterval(timer);
    if (netTimer) clearInterval(netTimer);
    timer = 0;
    netTimer = 0;
  }

  function sendIn() {
    var caught = capture();
    if (!caught.idle.length && !caught.walk.length && !caught.burst.length) {
      setStatus("Paint the loops first. Then send the finished sprite in.", true);
      setNote("The dungeon is waiting for a finished sprite.");
      return;
    }
    frames = caught;
    spriteRev += 1;
    if (!running) {
      me = resetMe();
      floorN = 1;
      mode = "solo";
      spawnWave();
      running = true;
      var shown = document.getElementById("panel-sprites");
      if (shown && !shown.hidden) startLoops();
    }
    setStatus("The sprite is in the dungeon.");
    setNote("Floor " + floorN + ". Clear the room, step through the gold door, and level when the stills fall.");
    var game = $("spr-game");
    if (game && game.scrollIntoView) game.scrollIntoView({ block: "nearest" });
    draw();
  }

  function onKey(e, down) {
    var tag = (e.target && e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return;
    if (!running) return;
    if (e.code === "KeyW" || e.code === "KeyA" || e.code === "KeyS" || e.code === "KeyD" || e.code === "Space") {
      if (down) e.preventDefault();
    }
    if (e.code === "Space") {
      if (down) doBurst();
      return;
    }
    keys[e.code] = down;
  }

  function bindPointer() {
    var canvas = $("spr-game-canvas");
    if (!canvas || canvas.dataset.bound) return;
    canvas.dataset.bound = "1";
    var origin = null;
    function setFrom(ev) {
      if (!origin) return;
      var dx = ev.clientX - origin.x;
      var dy = ev.clientY - origin.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 10) {
        pointer.on = false;
        return;
      }
      pointer.on = true;
      pointer.x = Math.max(-1, Math.min(1, dx / 48));
      pointer.y = Math.max(-1, Math.min(1, dy / 48));
    }
    canvas.addEventListener("pointerdown", function (ev) {
      origin = { x: ev.clientX, y: ev.clientY };
      canvas.setPointerCapture(ev.pointerId);
    });
    canvas.addEventListener("pointermove", setFrom);
    function end() {
      origin = null;
      pointer.on = false;
      pointer.x = 0;
      pointer.y = 0;
    }
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
  }

  function bind() {
    var send = $("spr-send");
    if (send) send.addEventListener("click", sendIn);
    var burst = $("spr-burst");
    if (burst) burst.addEventListener("click", doBurst);
    window.addEventListener("keydown", function (e) { onKey(e, true); });
    window.addEventListener("keyup", function (e) { onKey(e, false); });
    window.addEventListener("sprites-hide", stopLoops);
    window.addEventListener("sprites-show", function () {
      if (running) startLoops();
      else draw();
    });
    bindPointer();
    draw();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind);
  else bind();

  window.SpriteDungeon = {
    send: sendIn,
    state: function () {
      return {
        open: running,
        x: me.x,
        y: me.y,
        level: me.level,
        xp: me.xp,
        hp: me.hp,
        floor: floorN,
        enemies: enemies.length,
        mode: mode,
        others: Object.keys(others).length,
        frames: frameCount(),
        paused: paused,
        might: me.might,
        haste: me.haste,
        stride: me.stride,
        burst: me.burstPow,
        maxHp: me.maxHp,
      };
    },
  };
})();
