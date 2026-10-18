/**
 * Social room on the Sprites tab.
 * A painted sprite is saved as an entity or an enemy.
 * Paint the loops also paints the projectile, and that projectile stays on the entity.
 * The room uses only those saves. Space holds up the entity's picture.
 * The frame button opens that picture full screen.
 * Levels come from clears. Anyone on the tab shares the same room.
 */
(function () {
  "use strict";

  var ROOM_W = 22;
  var ROOM_H = 14;
  var TILE = 32;
  var MIGHT_STEP = 0.5;
  var HASTE_STEP = 0.25;
  var STRIDE_STEP = 0.45;
  var BURST_STEP = 0.55;
  var VITAL_STEP = 12;
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
  var fired = 0;
  var hurt = 0;
  var burstLeft = 0;
  var spriteRev = 0;
  var sentRev = 0;
  var enterLatch = false;
  var known = {};
  var note = "";
  var aimShot = false;
  var guardLeft = 0;
  var hurryLeft = 0;
  var shield = 0;
  var cooldowns = {};
  var lastAction = "";
  var roster = [];
  var enemyRoster = [];
  var pickedId = "";
  var sentEntityId = "";
  var shotFrames = [];
  var outcomeUrl = "";
  var outcomeImg = null;
  var heldFrame = null;
  var pictureOpen = false;

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

  function holdTime(pow) {
    return 1.2 + pow * 0.8;
  }

  function reachTiles(pow) {
    return 1.6 + pow * 0.8;
  }

  function frameMs() {
    return Math.max(70, 140 / me.haste);
  }

  function bodyScale() {
    return 1 + Math.max(0, me.maxHp - 30) / 40;
  }

  function boltSize() {
    return 16 + (me.might - 1) * 14;
  }

  function offerText(id) {
    if (id === "might") {
      var next = me.might + MIGHT_STEP;
      return "Might. A shot hits for " + one(4 * me.might) + " now, " + one(4 * next) + " with this. The projectile sprite draws at " + Math.round(boltSize()) + " px now, " + Math.round(16 + (next - 1) * 14) + " px with this.";
    }
    if (id === "haste") {
      var nextH = me.haste + HASTE_STEP;
      return "Haste. A shot leaves every " + one(0.7 / me.haste) + "s now, every " + one(0.7 / nextH) + "s with this. Walk frames flip every " + Math.round(frameMs()) + " ms now, every " + Math.round(Math.max(70, 140 / nextH)) + " ms with this.";
    }
    if (id === "stride") {
      var nextS = me.stride + STRIDE_STEP;
      return "Stride. You cross " + one(4.4 * me.stride) + " tiles a second now, " + one(4.4 * nextS) + " with this.";
    }
    if (id === "vitality") {
      var max = me.maxHp + VITAL_STEP;
      var hp = Math.min(max, me.hp + VITAL_STEP);
      var scaleNow = Math.round(bodyScale() * 100);
      var scaleNext = Math.round((1 + Math.max(0, max - 30) / 40) * 100);
      return "Vitality. Life " + Math.round(me.hp) + "/" + me.maxHp + " now, " + Math.round(hp) + "/" + max + " with this. You stand at " + scaleNow + " percent size now, " + scaleNext + " percent with this.";
    }
    var nextB = me.burstPow + BURST_STEP;
    return "Frame. The picture stays up " + one(holdTime(me.burstPow)) + "s now, " + one(holdTime(nextB)) + "s with this. The clear around you reaches " + one(reachTiles(me.burstPow)) + " tiles now, " + one(reachTiles(nextB)) + " tiles with this.";
  }

  function paintStats() {
    var host = $("spr-stats");
    if (!host) return;
    var lines = [
      "Might " + one(me.might) + ". A shot hits for " + one(4 * me.might) + ". The projectile draws at " + Math.round(boltSize()) + " px.",
      "Haste " + one(me.haste) + ". A shot leaves every " + one(0.7 / me.haste) + "s. Walk frames flip every " + Math.round(frameMs()) + " ms.",
      "Stride " + one(me.stride) + ". You cross " + one(4.4 * me.stride) + " tiles a second.",
      "Vitality. Life " + Math.round(me.hp) + "/" + me.maxHp + ". You stand at " + Math.round(bodyScale() * 100) + " percent size.",
      "Frame " + one(me.burstPow) + ". The picture stays up " + one(holdTime(me.burstPow)) + "s. The clear reaches " + one(reachTiles(me.burstPow)) + " tiles.",
    ];
    if (host.childElementCount !== lines.length) {
      host.innerHTML = "";
      lines.forEach(function () {
        host.appendChild(document.createElement("li"));
      });
    }
    var items = host.children;
    var i;
    for (i = 0; i < lines.length; i++) items[i].textContent = lines[i];
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
    var out = { idle: [], walk: [], burst: [], shot: [] };
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
    ["idle", "walk", "burst", "shot"].forEach(function (key) {
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

  function packPicture() {
    if (!outcomeImg || !outcomeImg.width) return "";
    var size = 48;
    while (size >= 24) {
      var c = scaleCanvas(outcomeImg, size);
      var url = "";
      try { url = c.toDataURL("image/jpeg", 0.7); } catch (e) { url = ""; }
      if (url && url.length <= 16000) return url;
      size -= 12;
    }
    return "";
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
      var looks = enemyLooks();
      var look = looks.length ? looks[i % looks.length] : null;
      enemies.push({
        id: "local" + floorN + "n" + i,
        x: x,
        y: y,
        hp: hp,
        maxHp: hp,
        spd: 1.15 + floorN * 0.05,
        look: look ? look.frames : null,
        lookId: look ? look.id : "",
      });
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
      dmg: 4 * me.might * (aimShot ? 2 : 1),
      look: shotFrames,
    });
    fired += 1;
    aimShot = false;
  }

  function doBurst() {
    if (!running) {
      setNote("Step into the room with a saved entity. Then Space holds the picture up.");
      return;
    }
    if (paused) return;
    if (me.meter < 100) {
      setNote("The picture lifts when the meter is full. It is " + one(me.meter) + " now.");
      return;
    }
    me.meter = 0;
    burstLeft = holdTime(me.burstPow);
    me.cycle = "burst";
    setNote("You hold the picture up. Click the frame to open it full screen.");
    var radius = reachTiles(me.burstPow);
    var dmg = 8 + me.burstPow * 6;
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
    if (guardLeft > 0) guardLeft -= dt;
    if (hurryLeft > 0) hurryLeft -= dt;
    if (burstLeft > 0) {
      burstLeft -= dt;
      me.cycle = "burst";
    }
    var ax = 0;
    var ay = 0;
    if (!paused) {
      if (keys.ArrowUp) ay -= 1;
      if (keys.ArrowDown) ay += 1;
      if (keys.ArrowLeft) ax -= 1;
      if (keys.ArrowRight) ax += 1;
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
      me.frame = Math.floor(performance.now() / frameMs()) % 6;
      shot -= dt;
      if (shot <= 0) {
        shot = 0.7 / (me.haste * (hurryLeft > 0 ? 1.5 : 1));
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
          var blow = 5 + floorN;
          if (guardLeft > 0) {
            guardLeft = 0;
            blow = 0;
            setNote("Guard took that hit. Damage 0.");
          } else if (shield > 0) {
            var used = Math.min(shield, blow);
            shield -= used;
            blow -= used;
            setNote("Shield took " + used + ". Shield " + shield + " left.");
          }
          if (blow > 0) me.hp -= blow;
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
    paintStats();
    draw();
  }

  function worldX(tile) { return tile * TILE + 16; }
  function worldY(tile) { return tile * TILE + 16; }

  function drawCreature(g, set, cycle, frame, x, y, face, scale) {
    var list = set && set[cycle] && set[cycle].length ? set[cycle] : (set && set.idle);
    var s = 42 * (scale || 1);
    g.save();
    g.translate(worldX(x), worldY(y));
    g.fillStyle = "rgba(0,0,0,0.45)";
    g.beginPath();
    g.ellipse(0, 2, 12 * (scale || 1), 4, 0, 0, Math.PI * 2);
    g.fill();
    if (list && list.length) {
      var img = list[Math.abs(frame) % list.length];
      if (face < 0) g.scale(-1, 1);
      g.imageSmoothingEnabled = false;
      g.drawImage(img, -s / 2, -s + 2, s, s);
    } else {
      g.fillStyle = "#f0d78a";
      g.fillRect(-8, -28, 16, 18);
      g.fillStyle = "#ece6d6";
      g.fillRect(-4, -24, 3, 3);
    }
    g.restore();
  }

  function drawPicture(g, img, x, y, size, lift) {
    if (!img || !img.width) return null;
    var s = size;
    var left = worldX(x) - s / 2;
    var top = worldY(y) - lift - s;
    g.fillStyle = "#c9a227";
    g.fillRect(left - 3, top - 3, s + 6, s + 6);
    g.fillStyle = "#12151e";
    g.fillRect(left, top, s, s);
    g.imageSmoothingEnabled = false;
    g.drawImage(img, left, top, s, s);
    return { x: left - 3, y: top - 3, w: s + 6, h: s + 6 };
  }

  function drawBolt(g, bolt) {
    var list = Array.isArray(bolt.look) ? bolt.look : [];
    var s = boltSize();
    var img = list.length ? list[Math.floor(performance.now() / 90) % list.length] : null;
    if (img) {
      g.save();
      g.translate(worldX(bolt.x), worldY(bolt.y));
      g.rotate(Math.atan2(bolt.vy, bolt.vx));
      g.imageSmoothingEnabled = false;
      g.drawImage(img, -s / 2, -s / 2, s, s);
      g.restore();
      return;
    }
    g.fillStyle = "#f0d78a";
    g.beginPath();
    g.moveTo(worldX(bolt.x), worldY(bolt.y) - 4);
    g.lineTo(worldX(bolt.x) + 4, worldY(bolt.y));
    g.lineTo(worldX(bolt.x), worldY(bolt.y) + 4);
    g.lineTo(worldX(bolt.x) - 4, worldY(bolt.y));
    g.fill();
  }

  function draw() {
    var canvas = $("spr-game-canvas");
    if (!canvas) return;
    heldFrame = null;
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
      g.fillText("Save an entity, then step into the room.", canvas.width / 2, canvas.height / 2);
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
      if (e.look) {
        drawCreature(g, e.look, "walk", Math.floor(performance.now() / 140) % 6, e.x, e.y, e.x < me.x ? 1 : -1);
      } else {
        g.fillStyle = "#c4493a";
        g.fillRect(worldX(e.x) - 10, worldY(e.y) - 18, 20, 16);
        g.fillStyle = "#1a0c0c";
        g.fillRect(worldX(e.x) - 6, worldY(e.y) - 14, 3, 3);
        g.fillRect(worldX(e.x) + 2, worldY(e.y) - 14, 3, 3);
      }
      g.fillStyle = "#3a1210";
      g.fillRect(worldX(e.x) - 12, worldY(e.y) - 22, 24, 3);
      g.fillStyle = "#8fd0ea";
      g.fillRect(worldX(e.x) - 12, worldY(e.y) - 22, 24 * Math.max(0, e.hp / e.maxHp), 3);
    }
    for (i = 0; i < bolts.length; i++) drawBolt(g, bolts[i]);
    var ids = Object.keys(others);
    for (i = 0; i < ids.length; i++) {
      var o = others[ids[i]];
      drawCreature(g, o.frames, o.cycle, o.frame, o.x, o.y, o.face);
      var up = o.cycle === "burst";
      drawPicture(g, o.pictureImg, o.x, o.y, up ? 34 : 18, up ? 78 : 56);
      g.fillStyle = "#f0e2c0";
      g.font = "12px sans-serif";
      g.textAlign = "center";
      g.fillText(o.name + "  " + o.level, worldX(o.x), worldY(o.y) - 46);
      g.textAlign = "left";
    }
    if (hurt > 0.45) g.globalAlpha = 0.55;
    drawCreature(g, frames, me.cycle, me.frame, me.x, me.y, me.face, bodyScale());
    g.globalAlpha = 1;
    g.fillStyle = "#241418";
    g.fillRect(worldX(me.x) - 16, worldY(me.y) - 48, 32, 4);
    g.fillStyle = "#d46a6a";
    g.fillRect(worldX(me.x) - 16, worldY(me.y) - 48, 32 * Math.max(0, me.hp / me.maxHp), 4);
    g.fillStyle = "#2a2418";
    g.fillRect(worldX(me.x) - 16, worldY(me.y) + 6, 32, 3);
    g.fillStyle = "#c9a227";
    g.fillRect(worldX(me.x) - 16, worldY(me.y) + 6, 32 * (me.meter / 100), 3);
    var channel = burstLeft > 0;
    heldFrame = drawPicture(g, outcomeImg, me.x, me.y, channel ? 34 + me.burstPow * 12 : 22, channel ? 86 : 62);
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
      var prev = spriteCache[id] || {};
      spriteCache[id] = { rev: rev, frames: frameset, picture: prev.picture || null, pictureUrl: prev.pictureUrl || "" };
      if (others[id]) others[id].frames = frameset;
    });
  }

  function loadOtherPicture(id, url) {
    if (!url) return;
    var img = new Image();
    img.onload = function () {
      var prev = spriteCache[id] || { rev: 0, frames: null };
      prev.picture = img;
      prev.pictureUrl = url;
      spriteCache[id] = prev;
      if (others[id]) others[id].pictureImg = img;
    };
    img.src = url;
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
      var pic = packPicture();
      if (pic) body.picture = pic;
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
        if (p.picture && (!cached || cached.pictureUrl !== p.picture)) loadOtherPicture(p.id, p.picture);
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
          pictureImg: cached && cached.picture ? cached.picture : null,
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
    var ent = pickedEntity();
    if (!ent || !frameTotal(ent.frames)) {
      setStatus("Save the sprite in the side panel first.", true);
      setNote("The room uses a saved entity. An unsaved paint stays on the stage.");
      return;
    }
    frames = ent.frames;
    shotFrames = (ent.frames.shot || []).slice();
    sentEntityId = ent.id;
    showOutcome(ent.outcome || "");
    spriteRev += 1;
    if (!running) {
      me = resetMe();
      floorN = 1;
      mode = "solo";
      aimShot = false;
      guardLeft = 0;
      hurryLeft = 0;
      shield = 0;
      cooldowns = {};
      lastAction = "";
      keys = {};
      spawnWave();
      running = true;
      var shown = document.getElementById("panel-sprites");
      if (shown && !shown.hidden) startLoops();
    }
    setStatus(ent.name + " is in the room.");
    var shotLine = shotFrames.length
      ? " Shots use the projectile painted with this entity."
      : " The shot stays a plain mark until Paint the loops.";
    setNote(ent.name + " uses " + moveLabel(ent.frames) + ". Arrows play Walk. Letting go plays Idle. Space holds the picture up." + shotLine);
    var game = $("spr-game");
    if (game && game.scrollIntoView) game.scrollIntoView({ block: "nearest" });
    draw();
  }

  function isTypingEl(el) {
    if (!el || el === window || el === document) return false;
    var tag = (el.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return true;
    return !!el.isContentEditable;
  }

  function openSpriteDb() {
    return new Promise(function (resolve, reject) {
      if (typeof indexedDB === "undefined") return reject(new Error("no idb"));
      var req = indexedDB.open("l7in-sprite-loops", 3);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains("loops")) db.createObjectStore("loops", { keyPath: "id" });
        if (!db.objectStoreNames.contains("entities")) db.createObjectStore("entities", { keyPath: "id" });
        if (!db.objectStoreNames.contains("enemies")) db.createObjectStore("enemies", { keyPath: "id" });
        if (!db.objectStoreNames.contains("projectiles")) db.createObjectStore("projectiles", { keyPath: "id" });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function frameTotal(set) {
    if (!set) return 0;
    return (set.idle ? set.idle.length : 0) + (set.walk ? set.walk.length : 0) + (set.burst ? set.burst.length : 0);
  }

  function moveLabel(set) {
    var bits = [];
    if (set && set.idle && set.idle.length) bits.push("Idle");
    if (set && set.walk && set.walk.length) bits.push("Walk");
    if (set && set.burst && set.burst.length) bits.push("Burst");
    if (set && set.shot && set.shot.length) bits.push("Shot");
    return bits.join(", ") || "No loops";
  }

  function pickedEntity() {
    var i;
    for (i = 0; i < roster.length; i++) {
      if (roster[i].id === pickedId) return roster[i];
    }
    return null;
  }

  function enemyLooks() {
    var list = [];
    var i;
    for (i = 0; i < enemyRoster.length; i++) {
      if (!frameTotal(enemyRoster[i].frames)) continue;
      list.push(enemyRoster[i]);
    }
    return list;
  }

  function storeName(kind) {
    if (kind === "enemy") return "enemies";
    return "entities";
  }

  function rosterOf(kind) {
    if (kind === "enemy") return enemyRoster;
    return roster;
  }

  function setRoster(kind, list) {
    if (kind === "enemy") enemyRoster = list;
    else roster = list;
  }

  function findIn(list, id) {
    var i;
    for (i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  function listId(kind) {
    if (kind === "enemy") return "spr-enemy-list";
    return "spr-entity-list";
  }

  function emptyLabel(kind) {
    if (kind === "enemy") return "No saved enemies yet.";
    return "No saved entities yet.";
  }

  function framesFromUrls(urls) {
    var out = { idle: [], walk: [], burst: [], shot: [] };
    var jobs = [];
    ["idle", "walk", "burst", "shot"].forEach(function (key) {
      var list = (urls && urls[key]) || [];
      out[key] = new Array(list.length);
      list.forEach(function (url, index) {
        jobs.push(new Promise(function (resolve) {
          var img = new Image();
          img.onload = function () {
            var c = document.createElement("canvas");
            c.width = img.naturalWidth || 96;
            c.height = img.naturalHeight || 96;
            var g = c.getContext("2d");
            g.imageSmoothingEnabled = false;
            g.drawImage(img, 0, 0);
            out[key][index] = c;
            resolve();
          };
          img.onerror = function () { resolve(); };
          img.src = url;
        }));
      });
    });
    return Promise.all(jobs).then(function () {
      ["idle", "walk", "burst", "shot"].forEach(function (key) {
        out[key] = out[key].filter(Boolean);
      });
      return out;
    });
  }

  function putRecord(store, rec) {
    return openSpriteDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(store, "readwrite");
        tx.objectStore(store).put(rec);
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function deleteRecord(store, id) {
    return openSpriteDb().then(function (db) {
      return new Promise(function (resolve) {
        var tx = db.transaction(store, "readwrite");
        tx.objectStore(store).delete(id);
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { resolve(false); };
      });
    }).catch(function () { return false; });
  }

  function loadStore(store) {
    return openSpriteDb().then(function (db) {
      return new Promise(function (resolve) {
        var tx = db.transaction(store, "readonly");
        var req = tx.objectStore(store).getAll();
        req.onsuccess = function () { resolve(req.result || []); };
        req.onerror = function () { resolve([]); };
      });
    }).catch(function () { return []; });
  }

  function renderCards(kind) {
    var host = $(listId(kind));
    if (!host) return;
    var list = rosterOf(kind);
    host.innerHTML = "";
    if (!list.length) {
      var empty = document.createElement("p");
      empty.className = "spr-entity-empty";
      empty.textContent = emptyLabel(kind);
      host.appendChild(empty);
      return;
    }
    list.forEach(function (ent) {
      var btn = document.createElement("button");
      btn.type = "button";
      var on = kind === "enemy" || ent.id === pickedId;
      btn.className = "spr-entity" + (on ? " is-on" : "");
      btn.dataset.id = ent.id;
      var img = document.createElement("img");
      img.alt = "";
      if (ent.thumb) img.src = ent.thumb;
      var text = document.createElement("span");
      var name = document.createElement("span");
      name.className = "spr-entity-name";
      name.textContent = ent.name;
      var moves = document.createElement("span");
      moves.className = "spr-entity-moves";
      moves.textContent = kind === "enemy" ? "Enemy" : moveLabel(ent.frames);
      text.appendChild(name);
      text.appendChild(moves);
      var drop = document.createElement("span");
      drop.className = "spr-entity-drop";
      drop.setAttribute("aria-label", "Remove " + ent.name);
      drop.textContent = "\u00d7";
      btn.appendChild(img);
      btn.appendChild(text);
      btn.appendChild(drop);
      btn.addEventListener("click", function (ev) {
        if (ev.target.classList && ev.target.classList.contains("spr-entity-drop")) {
          dropKind(kind, ent.id);
          return;
        }
        if (kind === "entity") pickEntity(ent.id);
      });
      host.appendChild(btn);
    });
  }

  function renderRoster() {
    renderCards("entity");
  }

  function showOutcome(url) {
    outcomeUrl = url || "";
    var img = $("spr-outcome");
    var btn = $("spr-burst");
    if (img) {
      if (outcomeUrl) img.src = outcomeUrl;
      else img.removeAttribute("src");
    }
    if (btn) btn.classList.toggle("has-picture", !!outcomeUrl);
    if (!outcomeUrl) {
      outcomeImg = null;
      return;
    }
    var drawn = new Image();
    drawn.onload = function () { outcomeImg = drawn; if (running) draw(); };
    drawn.src = outcomeUrl;
  }

  function outcomeUrlFromPage(caught) {
    var nodes = document.querySelectorAll(".spell-slot-inner img");
    var i;
    for (i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (!node.complete || node.naturalWidth < 8) continue;
      try {
        var c = document.createElement("canvas");
        c.width = 96;
        c.height = 96;
        var g = c.getContext("2d");
        g.drawImage(node, 0, 0, 96, 96);
        var url = c.toDataURL("image/jpeg", 0.8);
        if (url && url.indexOf("data:image") === 0) return url;
      } catch (e) {}
    }
    var src = (caught.burst && caught.burst[0]) || (caught.idle && caught.idle[0]);
    if (!src) return "";
    try { return src.toDataURL("image/png"); } catch (e2) { return ""; }
  }

  function openPicture() {
    if (!outcomeUrl) {
      setNote("Save an entity. The frame shows the picture from that save.");
      return;
    }
    var stage = $("spr-picture-stage");
    var img = $("spr-picture-full");
    if (!stage || !img) return;
    img.src = outcomeUrl;
    stage.hidden = false;
    pictureOpen = true;
    document.body.classList.add("spr-picture-open");
    if (stage.requestFullscreen) stage.requestFullscreen().catch(function () {});
  }

  function closePicture() {
    var stage = $("spr-picture-stage");
    if (stage) stage.hidden = true;
    pictureOpen = false;
    document.body.classList.remove("spr-picture-open");
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function () {});
  }

  function pickEntity(id) {
    var ent = findIn(roster, id);
    if (!ent) return;
    pickedId = ent.id;
    try { localStorage.setItem("sprPickedEntity", ent.id); } catch (e) {}
    if (ent.outcome) showOutcome(ent.outcome);
    renderCards("entity");
    setNote(ent.name + " is selected. Send uses this saved entity. The frame shows its picture. Moves: " + moveLabel(ent.frames) + ".");
  }

  function dropKind(kind, id) {
    var list = rosterOf(kind);
    var ent = findIn(list, id);
    var name = ent ? ent.name : "That sprite";
    setRoster(kind, list.filter(function (item) { return item.id !== id; }));
    if (kind === "entity") {
      if (pickedId === id) {
        pickedId = "";
        try { localStorage.removeItem("sprPickedEntity"); } catch (e) {}
      }
      if (sentEntityId === id) {
        frames = { idle: [], walk: [], burst: [] };
        shotFrames = [];
        sentEntityId = "";
        spriteRev += 1;
        showOutcome("");
      }
      setNote(name + " left the panel, so the room will not use that entity.");
    } else {
      var n;
      for (n = 0; n < enemies.length; n++) {
        if (enemies[n].lookId === id) {
          enemies[n].look = null;
          enemies[n].lookId = "";
        }
      }
      setNote(name + " left the panel, so the room will not use that enemy.");
    }
    renderCards(kind);
    deleteRecord(storeName(kind), id);
    if (running) draw();
  }

  function saveKind(kind) {
    var prompt = $("spr-prompt");
    var name = String((prompt && prompt.value) || "").trim().slice(0, 32);
    var now = Date.now();
    var key = kind + "\n" + name;
    if (!name) {
      setNote("Name the sprite in the bar, then save it.");
      setStatus("The side panel needs a name.", true);
      if (prompt) prompt.focus();
      return;
    }
    if (saveKind.last && now - saveKind.last < 400 && saveKind.lastKey === key) return;
    var caught = capture();
    if (!frameTotal(caught)) {
      setNote("Paint the loops first. Then save the sprite in the side panel.");
      setStatus("Paint the loops first.", true);
      return;
    }
    var urls = { idle: [], walk: [], burst: [], shot: [] };
    ["idle", "walk", "burst", "shot"].forEach(function (cycle) {
      caught[cycle].forEach(function (canvas) {
        var url = "";
        try { url = canvas.toDataURL("image/png"); } catch (e) { url = ""; }
        if (url) urls[cycle].push(url);
      });
    });
    if (!frameTotal(urls)) {
      setNote("The stills could not be saved.");
      return;
    }
    saveKind.last = now;
    saveKind.lastKey = key;
    var prefix = kind === "enemy" ? "n" : "e";
    var id = prefix + now.toString(36) + Math.random().toString(36).slice(2, 6);
    var outcome = kind === "entity" ? outcomeUrlFromPage(caught) : "";
    var rec = { id: id, name: name, saved: now, frames: urls };
    if (outcome) rec.outcome = outcome;
    var item = {
      id: id,
      name: name,
      saved: now,
      frames: caught,
      thumb: urls.idle[0] || urls.walk[0] || urls.burst[0] || "",
      outcome: outcome,
    };
    rosterOf(kind).push(item);
    if (kind === "entity") {
      pickedId = id;
      try { localStorage.setItem("sprPickedEntity", id); } catch (e) {}
      showOutcome(outcome);
      setStatus(name + " is in the side panel.");
      setNote(name + " is saved. " + moveLabel(caught) + " are its moves. The frame shows this picture. Send steps into the room with this entity.");
    } else {
      setStatus(name + " is an enemy.");
      setNote(name + " is saved. The room can use this enemy.");
    }
    renderCards(kind);
    putRecord(storeName(kind), rec).catch(function () {
      setNote(name + " is in the panel for this visit. The browser did not keep the file.");
    });
  }

  function saveEntity() {
    saveKind("entity");
  }

  function restoreKind(kind, storageKey) {
    var stored = "";
    try { if (storageKey) stored = localStorage.getItem(storageKey) || ""; } catch (e) {}
    return loadStore(storeName(kind)).then(function (rows) {
      rows.sort(function (a, b) { return (a.saved || 0) - (b.saved || 0); });
      return Promise.all(rows.map(function (rec) {
        return framesFromUrls(rec.frames || {}).then(function (frameset) {
          var urls = rec.frames || {};
          return {
            id: rec.id,
            name: rec.name || "Sprite",
            saved: rec.saved || 0,
            frames: frameset,
            thumb: (urls.idle && urls.idle[0]) || (urls.walk && urls.walk[0]) || (urls.burst && urls.burst[0]) || "",
            outcome: rec.outcome || "",
          };
        });
      }));
    }).then(function (items) {
      if (rosterOf(kind).length) return;
      var clean = items.filter(function (item) { return item && item.id && frameTotal(item.frames); });
      setRoster(kind, clean);
      if (kind === "entity" && clean.some(function (item) { return item.id === stored; })) {
        pickedId = stored;
        var ent = pickedEntity();
        if (ent && ent.outcome) showOutcome(ent.outcome);
      }
      renderCards(kind);
    }).catch(function () {
      renderCards(kind);
    });
  }

  function restoreRoster() {
    restoreKind("entity", "sprPickedEntity");
    restoreKind("enemy", "");
  }


  function onKey(e, down) {
    if (down && e.key === "Escape" && pictureOpen) {
      e.preventDefault();
      e.stopPropagation();
      closePicture();
      return;
    }
    if (isTypingEl(e.target)) {
      if (down && e.target.id === "spr-prompt" && (e.key === "Escape" || e.key === "Enter")) {
        e.preventDefault();
        e.stopPropagation();
        if (e.key === "Escape") e.target.blur();
        else saveEntity();
      }
      return;
    }
    if (!running) return;
    var arrow = e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowRight";
    var space = e.code === "Space";
    if (!(arrow || space)) return;
    e.preventDefault();
    e.stopPropagation();
    if (paused) {
      if (arrow && !down) keys[e.key] = false;
      return;
    }
    if (space) {
      if (down && !e.repeat) doBurst();
      return;
    }
    keys[e.key] = down;
  }

  function setKeyMode(typing) {
    var el = $("spr-key-mode");
    var form = $("spr-prompt-form");
    if (form) form.classList.toggle("is-typing", !!typing);
    if (!el) return;
    el.textContent = typing
      ? "Typing the name. Enter saves an entity. Escape leaves the bar."
      : "Arrow keys play Walk. Letting go plays Idle. Space holds the picture up.";
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
      var prompt = $("spr-prompt");
      if (prompt && document.activeElement === prompt) prompt.blur();
      origin = { x: ev.clientX, y: ev.clientY };
      try { canvas.setPointerCapture(ev.pointerId); } catch (err) {}
    });
    canvas.addEventListener("pointermove", setFrom);
    function canvasPoint(ev) {
      var rect = canvas.getBoundingClientRect();
      var sx = rect.width ? canvas.width / rect.width : 1;
      var sy = rect.height ? canvas.height / rect.height : 1;
      return { x: (ev.clientX - rect.left) * sx, y: (ev.clientY - rect.top) * sy };
    }
    function end(ev) {
      if (origin && ev && heldFrame) {
        var dx = ev.clientX - origin.x;
        var dy = ev.clientY - origin.y;
        if (dx * dx + dy * dy < 64) {
          var p = canvasPoint(ev);
          if (p.x >= heldFrame.x && p.y >= heldFrame.y && p.x <= heldFrame.x + heldFrame.w && p.y <= heldFrame.y + heldFrame.h) {
            openPicture();
          }
        }
      }
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
    if (burst) burst.addEventListener("click", openPicture);
    var save = $("spr-save-entity");
    if (save) save.addEventListener("click", saveEntity);
    var saveEnemy = $("spr-save-enemy");
    if (saveEnemy) saveEnemy.addEventListener("click", function () { saveKind("enemy"); });
    var stage = $("spr-picture-stage");
    if (stage) stage.addEventListener("click", closePicture);
    var form = $("spr-prompt-form");
    var prompt = $("spr-prompt");
    if (form && prompt && !form.dataset.bound) {
      form.dataset.bound = "1";
      form.addEventListener("submit", function (ev) {
        ev.preventDefault();
        saveEntity();
      });
      prompt.addEventListener("focus", function () {
        keys = {};
        setKeyMode(true);
      });
      prompt.addEventListener("blur", function () {
        setKeyMode(false);
      });
    }
    window.addEventListener("keydown", function (e) { onKey(e, true); }, true);
    window.addEventListener("keyup", function (e) { onKey(e, false); }, true);
    window.addEventListener("sprites-hide", stopLoops);
    window.addEventListener("sprites-show", function () {
      if (running) startLoops();
      else draw();
    });
    bindPointer();
    renderCards("entity");
    renderCards("enemy");
    restoreRoster();
    paintStats();
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
        meter: me.meter,
        cycle: me.cycle,
        entities: roster.length,
        entity: (function () {
          var ent = pickedEntity();
          return ent ? ent.name : "";
        })(),
        typing: !!(document.activeElement && document.activeElement.id === "spr-prompt"),
        outcome: !!outcomeUrl,
        pictureOpen: pictureOpen,
        enemiesSaved: enemyRoster.length,
        foeSprites: enemies.filter(function (e) { return !!e.look; }).length,
        bolts: bolts.length,
        fired: fired,
        shotFrames: shotFrames.length,
      };
    },
  };
})();
