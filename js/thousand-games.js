/**
 * 1000 — one thousand different playable game templates.
 * Click a card, play, edit the JSON while it runs.
 */
(function () {
  "use strict";

  var FAMILIES = [
    "dodge", "collect", "snake", "breakout", "pong", "flap", "shooter", "memory",
    "clicker", "paint", "stack", "orbit", "runner", "maze", "survive", "golf",
    "rhythm", "grow", "mirror", "ice", "twin", "bomber", "harvest", "bounce",
    "split", "lockon", "drift", "charge", "swarm", "quiet",
  ];
  var ADJ = [
    "Amber", "Brutal", "Quiet", "Velvet", "Iron", "Sour", "Hollow", "Bright",
    "Crooked", "Soft", "Fever", "Glass", "Mud", "Neon", "Dust", "Silver",
    "Hungry", "Late", "Minor", "Major", "False", "True", "Slow", "Sudden",
    "Hidden", "Open", "Broken", "Whole", "Night", "Noon", "Salt", "Smoke",
  ];
  var NOUN = [
    "Moth", "Key", "Well", "Door", "Coin", "Tooth", "River", "Nail",
    "Crown", "Seed", "Bell", "Rope", "Mask", "Hive", "Spark", "Bone",
    "Wheel", "Mirror", "Ash", "Thorn", "Vault", "Drift", "Pulse", "Fang",
    "Loom", "Spark", "Grit", "Bloom", "Cinder", "Harbor", "Latch", "Orbit",
  ];
  var EDITS_KEY = "thousand_edits_v1";

  var catalog = [];
  var current = null;
  var play = null;
  var raf = 0;
  var running = false;
  var keys = {};
  var canvas;
  var ctx;
  var pointer = { x: 0, y: 0, down: false };

  function $(id) {
    return document.getElementById(id);
  }

  function hash(n) {
    n = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
    n ^= n >>> 13;
    return n >>> 0;
  }

  function pick(arr, n) {
    return arr[(n >>> 0) % arr.length];
  }

  function hsl(h, s, l) {
    h = ((h % 360) + 360) % 360;
    return "hsl(" + h + ", " + s + "%, " + l + "%)";
  }

  function validColor(s) {
    if (typeof s !== "string") return false;
    s = s.trim();
    if (/^hsl\(\s*\d+(\.\d+)?\s*,\s*\d+(\.\d+)?%\s*,\s*\d+(\.\d+)?%\s*\)$/i.test(s)) return true;
    if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s)) return true;
    return false;
  }

  function makeSpec(id) {
    var h = hash(id * 9973 + 17);
    var fam = FAMILIES[(id - 1) % FAMILIES.length];
    var a = ADJ[(id - 1) % ADJ.length];
    var b = NOUN[(id * 3) % NOUN.length];
    var c = NOUN[(id * 7 + 5) % NOUN.length];
    if (!a) a = "Iron";
    if (!b) b = "Gate";
    if (!c) c = "Spark";
    if (c === b) c = NOUN[(id * 11 + 2) % NOUN.length] || "Wheel";
    var bits = h;
    return {
      id: id,
      title: a + " " + b + " " + c,
      family: fam,
      seed: h,
      bg: hsl(h, 22 + (bits % 20), 8 + (bits % 6)),
      ink: hsl(h + 40, 42, 78),
      acc: hsl(h + 180, 58, 54),
      danger: hsl(h + 12, 72, 50),
      wrap: (bits & 1) === 1,
      timed: (bits & 2) === 2,
      invert: (bits & 4) === 4,
      speed: Math.round((0.6 + ((bits >>> 5) % 18) / 10) * 100) / 100,
      count: 3 + ((bits >>> 9) % 16),
      size: 6 + ((bits >>> 13) % 14),
      gravity: ((bits >>> 7) % 9) / 20,
      friction: 0.82 + ((bits >>> 11) % 12) / 100,
      goal: 5 + ((bits >>> 15) % 40),
      timeLimit: (bits & 2) === 2 ? 12 + ((bits >>> 19) % 40) : 0,
      notes: fam + " · tweak any field and hit Apply",
    };
  }

  function buildCatalog() {
    catalog = [];
    var i;
    for (i = 1; i <= 1000; i++) catalog.push(makeSpec(i));
  }

  function loadEdits() {
    try {
      return JSON.parse(localStorage.getItem(EDITS_KEY) || "{}");
    } catch (e) {
      return {};
    }
  }

  function saveEdit(spec) {
    var all = loadEdits();
    all[spec.id] = spec;
    try {
      localStorage.setItem(EDITS_KEY, JSON.stringify(all));
    } catch (e) {}
  }

  function specFor(id) {
    var base = catalog[id - 1] || makeSpec(id);
    var edits = loadEdits()[id];
    if (!edits || typeof edits !== "object") return base;
    if (FAMILIES.indexOf(edits.family) < 0) return base;
    if (!validColor(edits.bg) || !validColor(edits.ink) || !validColor(edits.acc) || !validColor(edits.danger)) {
      return base;
    }
    edits.id = id;
    edits.title = edits.title || base.title;
    return edits;
  }

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }

  function rnd(state) {
    state.rng = (Math.imul(state.rng, 1664525) + 1013904223) >>> 0;
    return state.rng / 4294967296;
  }

  function boot(spec) {
    var w = canvas.width;
    var h = canvas.height;
    var st = {
      spec: spec,
      t: 0,
      score: 0,
      lives: 3,
      over: false,
      win: false,
      rng: spec.seed || 1,
      player: { x: w / 2, y: h * 0.7, vx: 0, vy: 0, a: 0 },
      ents: [],
      trail: [],
      grid: [],
      cooldown: 0,
    };
    var i;
    var fam = spec.family;
    if (fam === "snake") {
      st.player = { x: (w / 2) | 0, y: (h / 2) | 0, vx: spec.size, vy: 0 };
      st.ents = [{ x: w * 0.3, y: h * 0.3 }];
      st.trail = [{ x: st.player.x, y: st.player.y }];
    }
    if (fam === "breakout") {
      for (i = 0; i < spec.count; i++) {
        st.ents.push({
          x: 20 + (i % 10) * ((w - 40) / 10),
          y: 24 + Math.floor(i / 10) * 18,
          w: (w - 50) / 11,
          h: 12,
          live: true,
        });
      }
      st.player.y = h - 24;
      st.ball = { x: w / 2, y: h - 40, vx: spec.speed * 2, vy: -spec.speed * 3 };
    }
    if (fam === "pong") {
      st.player.x = 24;
      st.player.y = h / 2;
      st.ai = { x: w - 24, y: h / 2 };
      st.ball = { x: w / 2, y: h / 2, vx: spec.speed * 3, vy: spec.speed };
    }
    if (fam === "memory") {
      var n = Math.min(16, spec.count + (spec.count % 2));
      for (i = 0; i < n; i++) st.ents.push({ id: i >> 1, open: false, done: false });
      for (i = st.ents.length - 1; i > 0; i--) {
        var j = (rnd(st) * (i + 1)) | 0;
        var tmp = st.ents[i];
        st.ents[i] = st.ents[j];
        st.ents[j] = tmp;
      }
      st.pick = [];
    }
    if (fam === "maze") {
      var cols = 11;
      var rows = 7;
      st.grid = [];
      for (i = 0; i < cols * rows; i++) st.grid.push(rnd(st) > 0.32);
      st.grid[0] = true;
      st.grid[cols * rows - 1] = true;
      st.cols = cols;
      st.rows = rows;
      st.player.x = 0;
      st.player.y = 0;
    }
    if (fam === "rhythm") {
      st.ents = [];
      st.lane = 1;
    }
    return st;
  }

  function wrapOrBounce(o, w, h, spec, r) {
    r = r || 8;
    if (spec.wrap) {
      if (o.x < 0) o.x = w;
      if (o.x > w) o.x = 0;
      if (o.y < 0) o.y = h;
      if (o.y > h) o.y = 0;
    } else {
      if (o.x < r) {
        o.x = r;
        o.vx *= -1;
      }
      if (o.x > w - r) {
        o.x = w - r;
        o.vx *= -1;
      }
      if (o.y < r) {
        o.y = r;
        o.vy *= -1;
      }
      if (o.y > h - r) {
        o.y = h - r;
        o.vy *= -1;
      }
    }
  }

  function movePlayer(st, dt, w, h) {
    var sp = st.spec.speed * 120;
    if (keys.a || keys.ArrowLeft) st.player.vx -= sp * dt;
    if (keys.d || keys.ArrowRight) st.player.vx += sp * dt;
    if (keys.w || keys.ArrowUp) st.player.vy -= sp * dt;
    if (keys.s || keys.ArrowDown) st.player.vy += sp * dt;
    if (pointer.down && st.spec.family !== "flap" && st.spec.family !== "golf") {
      st.player.vx += (pointer.x - st.player.x) * 4 * dt;
      st.player.vy += (pointer.y - st.player.y) * 4 * dt;
    }
    st.player.vx *= st.spec.friction;
    st.player.vy *= st.spec.friction;
    st.player.vy += st.spec.gravity * 400 * dt;
    st.player.x += st.player.vx * dt;
    st.player.y += st.player.vy * dt;
    wrapOrBounce(st.player, w, h, st.spec, st.spec.size);
  }

  function spawnEnt(st, w, h, kind) {
    st.ents.push({
      x: rnd(st) * w,
      y: rnd(st) * (kind === "fall" ? 20 : h),
      vx: (rnd(st) - 0.5) * 80 * st.spec.speed,
      vy: kind === "fall" ? 40 + rnd(st) * 80 * st.spec.speed : (rnd(st) - 0.5) * 80,
      r: 4 + rnd(st) * st.spec.size,
      kind: kind || "bit",
    });
  }

  function hit(a, b, extra) {
    extra = extra || 0;
    var dx = a.x - b.x;
    var dy = a.y - b.y;
    var r = (a.r || stSize(a)) + (b.r || 8) + extra;
    return dx * dx + dy * dy < r * r;
  }

  function stSize(o) {
    return o === play.player ? play.spec.size : 8;
  }

  function win(st) {
    st.win = true;
    st.over = true;
  }

  function lose(st) {
    st.over = true;
    st.win = false;
  }

  function tick(st, dt, w, h) {
    if (st.over) return;
    st.t += dt;
    if (st.spec.timeLimit && st.t >= st.spec.timeLimit) {
      if (st.score >= st.spec.goal) win(st);
      else lose(st);
      return;
    }
    var fam = st.spec.family;
    var i;
    st.cooldown = Math.max(0, st.cooldown - dt);

    if (fam === "dodge" || fam === "survive" || fam === "swarm" || fam === "ice") {
      movePlayer(st, dt, w, h);
      while (st.ents.length < st.spec.count) spawnEnt(st, w, h, "fall");
      st.ents.forEach(function (e) {
        e.y += (e.vy + (fam === "ice" ? 0 : 30)) * dt * st.spec.speed;
        e.x += e.vx * dt * (fam === "ice" ? 0.2 : 1);
        if (e.y > h + 10) {
          e.y = -10;
          e.x = rnd(st) * w;
          st.score += 1;
        }
        if (hit(st.player, e, 0)) lose(st);
      });
      if (!st.spec.timed && st.score >= st.spec.goal) win(st);
    } else if (fam === "collect" || fam === "harvest") {
      movePlayer(st, dt, w, h);
      while (st.ents.length < st.spec.count) spawnEnt(st, w, h, "bit");
      st.ents = st.ents.filter(function (e) {
        if (hit(st.player, e, 4)) {
          st.score += 1;
          return false;
        }
        return true;
      });
      if (st.score >= st.spec.goal) win(st);
    } else if (fam === "snake") {
      if (st.cooldown <= 0) {
        st.cooldown = 0.12 / st.spec.speed;
        if (keys.a || keys.ArrowLeft) {
          st.player.vx = -st.spec.size;
          st.player.vy = 0;
        }
        if (keys.d || keys.ArrowRight) {
          st.player.vx = st.spec.size;
          st.player.vy = 0;
        }
        if (keys.w || keys.ArrowUp) {
          st.player.vx = 0;
          st.player.vy = -st.spec.size;
        }
        if (keys.s || keys.ArrowDown) {
          st.player.vx = 0;
          st.player.vy = st.spec.size;
        }
        st.player.x += st.player.vx;
        st.player.y += st.player.vy;
        if (st.spec.wrap) {
          if (st.player.x < 0) st.player.x = w - st.spec.size;
          if (st.player.x > w) st.player.x = 0;
          if (st.player.y < 0) st.player.y = h - st.spec.size;
          if (st.player.y > h) st.player.y = 0;
        } else if (st.player.x < 0 || st.player.y < 0 || st.player.x > w || st.player.y > h) lose(st);
        st.trail.unshift({ x: st.player.x, y: st.player.y });
        while (st.trail.length > st.score + 5) st.trail.pop();
        st.ents.forEach(function (e) {
          if (Math.abs(e.x - st.player.x) < st.spec.size && Math.abs(e.y - st.player.y) < st.spec.size) {
            st.score += 1;
            e.x = rnd(st) * w;
            e.y = rnd(st) * h;
          }
        });
        for (i = 4; i < st.trail.length; i++) {
          if (Math.abs(st.trail[i].x - st.player.x) < 2 && Math.abs(st.trail[i].y - st.player.y) < 2) lose(st);
        }
        if (st.score >= st.spec.goal) win(st);
      }
    } else if (fam === "breakout") {
      st.player.x = pointer.x || st.player.x;
      if (keys.a || keys.ArrowLeft) st.player.x -= 260 * dt * st.spec.speed;
      if (keys.d || keys.ArrowRight) st.player.x += 260 * dt * st.spec.speed;
      st.player.x = clamp(st.player.x, 30, w - 30);
      st.ball.x += st.ball.vx * 40 * dt;
      st.ball.y += st.ball.vy * 40 * dt;
      if (st.ball.x < 6 || st.ball.x > w - 6) st.ball.vx *= -1;
      if (st.ball.y < 6) st.ball.vy *= -1;
      if (st.ball.y > h) lose(st);
      if (st.ball.y > st.player.y - 10 && Math.abs(st.ball.x - st.player.x) < 36) {
        st.ball.vy = -Math.abs(st.ball.vy);
        st.ball.vx += (st.ball.x - st.player.x) * 0.2;
      }
      st.ents.forEach(function (b) {
        if (!b.live) return;
        if (st.ball.x > b.x && st.ball.x < b.x + b.w && st.ball.y > b.y && st.ball.y < b.y + b.h) {
          b.live = false;
          st.ball.vy *= -1;
          st.score += 1;
        }
      });
      if (st.ents.every(function (b) { return !b.live; })) win(st);
    } else if (fam === "pong") {
      if (keys.w || keys.ArrowUp) st.player.y -= 220 * dt * st.spec.speed;
      if (keys.s || keys.ArrowDown) st.player.y += 220 * dt * st.spec.speed;
      st.player.y = clamp(st.player.y, 20, h - 20);
      st.ai.y += (st.ball.y - st.ai.y) * 3 * dt * st.spec.speed;
      st.ball.x += st.ball.vx * 50 * dt;
      st.ball.y += st.ball.vy * 50 * dt;
      if (st.ball.y < 8 || st.ball.y > h - 8) st.ball.vy *= -1;
      if (st.ball.x < 32 && Math.abs(st.ball.y - st.player.y) < 28) st.ball.vx = Math.abs(st.ball.vx);
      if (st.ball.x > w - 32 && Math.abs(st.ball.y - st.ai.y) < 28) st.ball.vx = -Math.abs(st.ball.vx);
      if (st.ball.x < 0) lose(st);
      if (st.ball.x > w) {
        st.score += 1;
        st.ball.x = w / 2;
        if (st.score >= st.spec.goal) win(st);
      }
    } else if (fam === "flap") {
      if (keys[" "] || keys.w || keys.ArrowUp || pointer.down) st.player.vy = -180 * st.spec.speed;
      st.player.vy += (220 + st.spec.gravity * 400) * dt;
      st.player.y += st.player.vy * dt;
      if (st.player.y > h || st.player.y < 0) lose(st);
      if (st.cooldown <= 0) {
        st.cooldown = 1.1 / st.spec.speed;
        var gap = 70 + st.spec.size * 2;
        var gy = 40 + rnd(st) * (h - 80);
        st.ents.push({ x: w + 10, y: gy, gap: gap, vx: -120 * st.spec.speed });
      }
      st.ents.forEach(function (e) {
        e.x += e.vx * dt;
        if (e.x < st.player.x && !e.passed) {
          e.passed = true;
          st.score += 1;
        }
        if (Math.abs(e.x - st.player.x) < 16 && (st.player.y < e.y - e.gap / 2 || st.player.y > e.y + e.gap / 2)) lose(st);
      });
      if (st.score >= st.spec.goal) win(st);
    } else if (fam === "shooter" || fam === "lockon" || fam === "twin") {
      movePlayer(st, dt, w, h);
      if ((keys[" "] || pointer.down) && st.cooldown <= 0) {
        st.cooldown = 0.18 / st.spec.speed;
        st.ents.push({ x: st.player.x, y: st.player.y, vx: 0, vy: -280, r: 4, kind: "shot" });
      }
      while (st.ents.filter(function (e) { return e.kind === "foe"; }).length < st.spec.count) {
        st.ents.push({ x: rnd(st) * w, y: -10, vx: (rnd(st) - 0.5) * 40, vy: 40 + rnd(st) * 50, r: 10, kind: "foe" });
      }
      st.ents.forEach(function (e) {
        e.x += (e.vx || 0) * dt;
        e.y += (e.vy || 0) * dt;
      });
      st.ents = st.ents.filter(function (e) {
        if (e.kind === "shot") {
          var hitFoe = st.ents.some(function (f) {
            if (f.kind !== "foe") return false;
            if (hit(e, f, 2)) {
              f.dead = true;
              st.score += 1;
              return true;
            }
            return false;
          });
          return e.y > -20 && !hitFoe;
        }
        if (e.kind === "foe") {
          if (hit(st.player, e, 0)) lose(st);
          return !e.dead && e.y < h + 20;
        }
        return true;
      });
      if (st.score >= st.spec.goal) win(st);
    } else if (fam === "clicker" || fam === "quiet") {
      if (pointer.down && st.cooldown <= 0) {
        st.cooldown = fam === "quiet" ? 0.4 : 0.05;
        st.score += fam === "quiet" ? 3 : 1;
        pointer.down = fam === "clicker";
      }
      if (st.score >= st.spec.goal) win(st);
    } else if (fam === "paint") {
      if (pointer.down) st.trail.push({ x: pointer.x, y: pointer.y });
      st.score = Math.min(st.spec.goal, (st.trail.length / 8) | 0);
      if (st.score >= st.spec.goal) win(st);
    } else if (fam === "stack" || fam === "grow") {
      movePlayer(st, dt, w, h);
      if (st.cooldown <= 0) {
        st.cooldown = 0.6 / st.spec.speed;
        st.ents.push({ x: rnd(st) * w, y: -10, vy: 70 * st.spec.speed, r: 8 + rnd(st) * 10 });
      }
      st.ents.forEach(function (e) {
        e.y += e.vy * dt;
        if (hit(st.player, e, fam === "grow" ? st.score : 0)) {
          e.dead = true;
          st.score += 1;
          if (fam === "grow") st.spec = Object.assign({}, st.spec, { size: st.spec.size + 1 });
        }
        if (e.y > h) lose(st);
      });
      st.ents = st.ents.filter(function (e) { return !e.dead; });
      if (st.score >= st.spec.goal) win(st);
    } else if (fam === "orbit" || fam === "bounce" || fam === "drift") {
      st.player.a += dt * st.spec.speed;
      st.player.x = w / 2 + Math.cos(st.player.a) * (40 + st.spec.size * 3);
      st.player.y = h / 2 + Math.sin(st.player.a * (fam === "drift" ? 0.6 : 1)) * (30 + st.spec.size * 2);
      while (st.ents.length < st.spec.count) spawnEnt(st, w, h, "bit");
      st.ents.forEach(function (e) {
        e.x += e.vx * dt * 0.2;
        e.y += e.vy * dt * 0.2;
        wrapOrBounce(e, w, h, st.spec, 4);
        if (hit(st.player, e, 6)) {
          e.x = rnd(st) * w;
          st.score += 1;
        }
      });
      if (st.score >= st.spec.goal) win(st);
    } else if (fam === "runner") {
      st.player.y = h * 0.65;
      if (keys.w || keys.ArrowUp || keys[" "] || pointer.down) st.player.vy = -220;
      st.player.vy += 520 * dt;
      st.player.y += st.player.vy * dt;
      if (st.player.y > h * 0.65) {
        st.player.y = h * 0.65;
        st.player.vy = 0;
      }
      if (st.cooldown <= 0) {
        st.cooldown = 0.9 / st.spec.speed;
        st.ents.push({ x: w + 10, y: h * 0.65, vx: -180 * st.spec.speed, r: 12 });
      }
      st.ents.forEach(function (e) {
        e.x += e.vx * dt;
        if (e.x < -20) {
          e.gone = true;
          st.score += 1;
        }
        if (hit(st.player, e, 4) && st.player.y > h * 0.5) lose(st);
      });
      st.ents = st.ents.filter(function (e) { return !e.gone; });
      if (st.score >= st.spec.goal) win(st);
    } else if (fam === "maze") {
      var cols = st.cols;
      if (st.cooldown <= 0) {
        st.cooldown = 0.12;
        var nx = st.player.x;
        var ny = st.player.y;
        if (keys.a || keys.ArrowLeft) nx--;
        if (keys.d || keys.ArrowRight) nx++;
        if (keys.w || keys.ArrowUp) ny--;
        if (keys.s || keys.ArrowDown) ny++;
        if (nx >= 0 && ny >= 0 && nx < cols && ny < st.rows && st.grid[ny * cols + nx]) {
          st.player.x = nx;
          st.player.y = ny;
        }
        if (st.player.x === cols - 1 && st.player.y === st.rows - 1) win(st);
      }
    } else if (fam === "memory") {
      if (pointer.down && st.cooldown <= 0) {
        st.cooldown = 0.2;
        var cols2 = 4;
        var cell = Math.min(w, h) / 5;
        var col = clamp((pointer.x / cell) | 0, 0, 3);
        var row = clamp((pointer.y / cell) | 0, 0, 3);
        var idx = row * cols2 + col;
        if (st.ents[idx] && !st.ents[idx].done && !st.ents[idx].open) {
          st.ents[idx].open = true;
          st.pick.push(idx);
          if (st.pick.length === 2) {
            var p = st.ents[st.pick[0]];
            var q = st.ents[st.pick[1]];
            if (p.id === q.id) {
              p.done = q.done = true;
              st.score += 1;
            } else {
              var a = st.pick[0];
              var b = st.pick[1];
              setTimeout(function () {
                if (play && play.ents[a]) play.ents[a].open = false;
                if (play && play.ents[b]) play.ents[b].open = false;
              }, 450);
            }
            st.pick = [];
          }
        }
        pointer.down = false;
      }
      if (st.ents.every(function (e) { return e.done; })) win(st);
    } else if (fam === "golf" || fam === "charge") {
      if (pointer.down && st.cooldown <= 0) {
        st.player.vx += (st.player.x - pointer.x) * 0.15;
        st.player.vy += (st.player.y - pointer.y) * 0.15;
        st.cooldown = 0.35;
        pointer.down = false;
      }
      st.player.vx *= 0.985;
      st.player.vy *= 0.985;
      st.player.x += st.player.vx * dt * 8;
      st.player.y += st.player.vy * dt * 8;
      wrapOrBounce(st.player, w, h, st.spec, 8);
      if (!st.hole) st.hole = { x: w * 0.8, y: h * 0.25, r: 14 };
      if (hit(st.player, st.hole, -4)) {
        st.score += 1;
        st.player.x = w * 0.2;
        st.player.y = h * 0.8;
        st.player.vx = st.player.vy = 0;
        if (st.score >= st.spec.goal) win(st);
      }
    } else if (fam === "rhythm") {
      st.lane = keys.a || keys.ArrowLeft ? 0 : keys.d || keys.ArrowRight ? 2 : 1;
      if (st.cooldown <= 0) {
        st.cooldown = 0.55 / st.spec.speed;
        st.ents.push({ lane: (rnd(st) * 3) | 0, y: -10, vy: 160 * st.spec.speed });
      }
      st.ents.forEach(function (e) {
        e.y += e.vy * dt;
        if (e.y > h * 0.78 && e.y < h * 0.9 && e.lane === st.lane && !e.hit) {
          e.hit = true;
          st.score += 1;
        }
        if (e.y > h && !e.hit) lose(st);
      });
      st.ents = st.ents.filter(function (e) { return e.y < h + 20; });
      if (st.score >= st.spec.goal) win(st);
    } else if (fam === "mirror" || fam === "split") {
      movePlayer(st, dt, w, h);
      var ghost = { x: w - st.player.x, y: fam === "split" ? st.player.y : h - st.player.y, r: st.spec.size };
      while (st.ents.length < st.spec.count) spawnEnt(st, w, h, "bit");
      st.ents = st.ents.filter(function (e) {
        if (hit(st.player, e, 4) || hit(ghost, e, 4)) {
          st.score += 1;
          return false;
        }
        return true;
      });
      if (st.score >= st.spec.goal) win(st);
    } else if (fam === "bomber") {
      movePlayer(st, dt, w, h);
      if ((keys[" "] || pointer.down) && st.cooldown <= 0) {
        st.cooldown = 0.5;
        st.ents.push({ x: st.player.x, y: st.player.y, r: 6, t: 0.8, kind: "bomb" });
      }
      st.ents.forEach(function (e) {
        e.t -= dt;
        if (e.t <= 0 && e.kind === "bomb") {
          e.kind = "boom";
          e.r = 40;
          e.t = 0.2;
          st.score += 1;
        }
      });
      st.ents = st.ents.filter(function (e) { return e.t > 0; });
      if (st.score >= st.spec.goal) win(st);
    } else {
      movePlayer(st, dt, w, h);
      while (st.ents.length < st.spec.count) spawnEnt(st, w, h, "bit");
      st.ents.forEach(function (e) {
        e.x += Math.sin(st.t * 2 + e.x) * 10 * dt;
        if (hit(st.player, e, 6)) {
          e.x = rnd(st) * w;
          e.y = rnd(st) * h;
          st.score += 1;
        }
      });
      if (st.score >= st.spec.goal) win(st);
    }
  }

  function draw(st, w, h) {
    if (!ctx) return;
    ctx.fillStyle = validColor(st.spec.bg) ? st.spec.bg : "#1a1520";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = validColor(st.spec.ink) ? st.spec.ink : "#f4ead6";
    ctx.font = "12px Georgia, serif";
    ctx.fillText(st.spec.title + "  ·  " + st.spec.family, 10, 18);
    ctx.fillText("score " + st.score + " / " + st.spec.goal + (st.spec.timeLimit ? "   t " + Math.max(0, st.spec.timeLimit - st.t).toFixed(1) : ""), 10, 34);
    var fam = st.spec.family;
    ctx.fillStyle = st.spec.acc;
    if (fam === "maze") {
      var cw = w / st.cols;
      var ch = h / st.rows;
      var i;
      for (i = 0; i < st.grid.length; i++) {
        var x = i % st.cols;
        var y = (i / st.cols) | 0;
        ctx.fillStyle = st.grid[i] ? st.spec.bg : st.spec.danger;
        if (!st.grid[i]) ctx.fillRect(x * cw, y * ch, cw - 1, ch - 1);
      }
      ctx.fillStyle = st.spec.acc;
      ctx.fillRect(st.player.x * cw + 4, st.player.y * ch + 4, cw - 8, ch - 8);
      ctx.fillStyle = st.spec.ink;
      ctx.fillRect((st.cols - 1) * cw + 6, (st.rows - 1) * ch + 6, cw - 12, ch - 12);
      return;
    }
    if (fam === "memory") {
      var cell = Math.min(w, h) / 5;
      st.ents.forEach(function (e, idx) {
        var x = (idx % 4) * cell + 8;
        var y = ((idx / 4) | 0) * cell + 8;
        ctx.fillStyle = e.done || e.open ? hsl(e.id * 50, 50, 50) : st.spec.danger;
        ctx.fillRect(x, y, cell - 12, cell - 12);
      });
      return;
    }
    if (fam === "paint") {
      ctx.strokeStyle = st.spec.acc;
      ctx.lineWidth = st.spec.size / 2;
      ctx.beginPath();
      st.trail.forEach(function (p, i) {
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();
      return;
    }
    if (fam === "breakout") {
      ctx.fillRect(st.player.x - 32, st.player.y, 64, 10);
      ctx.beginPath();
      ctx.arc(st.ball.x, st.ball.y, 6, 0, Math.PI * 2);
      ctx.fill();
      st.ents.forEach(function (b) {
        if (!b.live) return;
        ctx.fillStyle = st.spec.ink;
        ctx.fillRect(b.x, b.y, b.w - 2, b.h - 2);
      });
      return;
    }
    if (fam === "pong") {
      ctx.fillRect(20, st.player.y - 24, 8, 48);
      ctx.fillRect(w - 28, st.ai.y - 24, 8, 48);
      ctx.beginPath();
      ctx.arc(st.ball.x, st.ball.y, 7, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    if (fam === "rhythm") {
      [0, 1, 2].forEach(function (lane) {
        ctx.fillStyle = lane === st.lane ? st.spec.acc : st.spec.danger;
        ctx.fillRect(w * 0.25 + lane * 70, h * 0.8, 50, 16);
      });
      st.ents.forEach(function (e) {
        ctx.fillStyle = st.spec.ink;
        ctx.fillRect(w * 0.25 + e.lane * 70, e.y, 50, 12);
      });
      return;
    }
    if (fam === "snake") {
      st.trail.forEach(function (p) {
        ctx.fillRect(p.x, p.y, st.spec.size - 1, st.spec.size - 1);
      });
      ctx.fillStyle = st.spec.ink;
      st.ents.forEach(function (e) {
        ctx.fillRect(e.x, e.y, st.spec.size, st.spec.size);
      });
      return;
    }
    if (fam === "flap") {
      ctx.beginPath();
      ctx.arc(st.player.x, st.player.y, st.spec.size, 0, Math.PI * 2);
      ctx.fill();
      st.ents.forEach(function (e) {
        ctx.fillRect(e.x, 0, 28, e.y - e.gap / 2);
        ctx.fillRect(e.x, e.y + e.gap / 2, 28, h);
      });
      return;
    }
    if (fam === "golf" || fam === "charge") {
      ctx.fillStyle = st.spec.ink;
      ctx.beginPath();
      ctx.arc(st.hole.x, st.hole.y, st.hole.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(st.player.x, st.player.y, st.spec.size, 0, Math.PI * 2);
    ctx.fill();
    if (fam === "mirror" || fam === "split") {
      ctx.beginPath();
      ctx.arc(fam === "split" ? w - st.player.x : w - st.player.x, fam === "mirror" ? h - st.player.y : st.player.y, st.spec.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = st.spec.danger;
    st.ents.forEach(function (e) {
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r || 6, 0, Math.PI * 2);
      ctx.fill();
    });
    if (st.over) {
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = st.win ? st.spec.acc : st.spec.danger;
      ctx.font = "28px Georgia, serif";
      ctx.fillText(st.win ? "cleared" : "out", w / 2 - 50, h / 2);
    }
  }

  function loop(ts) {
    if (!running || !play) return;
    var now = ts;
    var dt = Math.min(0.05, (now - (play._last || now)) / 1000);
    play._last = now;
    if (!ctx) resize();
    if (!ctx) return;
    var w = canvas.width;
    var h = canvas.height;
    tick(play, dt, w, h);
    draw(play, w, h);
    $("k-status").textContent = play.over ? (play.win ? "Cleared. Edit the template and Apply to replay." : "Out. Apply or click the card again.") : "Playing — WASD / arrows / click. Edit JSON on the right.";
    raf = requestAnimationFrame(loop);
  }

  function resize() {
    canvas = $("k-canvas");
    if (!canvas) return;
    ctx = canvas.getContext("2d");
    var r = canvas.getBoundingClientRect();
    var w = Math.max(320, r.width || canvas.clientWidth || 640);
    var h = Math.max(240, r.height || canvas.clientHeight || 400);
    canvas.width = w;
    canvas.height = h;
  }

  function startGame(spec) {
    current = spec;
    resize();
    play = boot(JSON.parse(JSON.stringify(spec)));
    $("k-json").value = JSON.stringify(spec, null, 2);
    $("k-now").textContent = spec.id + " · " + spec.title;
    document.querySelectorAll(".k-card").forEach(function (c) {
      c.classList.toggle("on", Number(c.dataset.id) === spec.id);
    });
    if (!running) {
      running = true;
      raf = requestAnimationFrame(loop);
    }
  }

  function renderGrid(filter) {
    var box = $("k-grid");
    if (!box) return;
    filter = (filter || "").toLowerCase();
    box.innerHTML = "";
    var frag = document.createDocumentFragment();
    catalog.forEach(function (g) {
      if (filter && (g.title + g.family + g.id).toLowerCase().indexOf(filter) < 0) return;
      var b = document.createElement("button");
      b.type = "button";
      b.className = "k-card";
      b.dataset.id = String(g.id);
      var name = (g && g.title) || ("Game " + g.id);
      var fam = (g && g.family) || "arcade";
      if (name.indexOf("undefined") >= 0) name = "Game " + g.id;
      var t = document.createElement("span");
      t.textContent = "#" + g.id + " " + name;
      var sm = document.createElement("small");
      sm.textContent = fam;
      b.appendChild(t);
      b.appendChild(sm);
      b.addEventListener("click", function () {
        startGame(specFor(g.id));
      });
      frag.appendChild(b);
    });
    box.appendChild(frag);
  }

  function bind() {
    canvas = $("k-canvas");
    if (canvas) ctx = canvas.getContext("2d");
    if (!canvas) return;
    $("k-search") &&
      $("k-search").addEventListener("input", function (e) {
        renderGrid(e.target.value);
      });
    $("k-apply") &&
      $("k-apply").addEventListener("click", function () {
        try {
          var spec = JSON.parse($("k-json").value);
          if (!spec.id) spec.id = current ? current.id : 1;
          saveEdit(spec);
          startGame(spec);
        } catch (err) {
          $("k-status").textContent = "JSON error: " + err.message;
        }
      });
    $("k-reset") &&
      $("k-reset").addEventListener("click", function () {
        if (!current) return;
        var all = loadEdits();
        delete all[current.id];
        localStorage.setItem(EDITS_KEY, JSON.stringify(all));
        startGame(makeSpec(current.id));
      });
    $("k-rand") &&
      $("k-rand").addEventListener("click", function () {
        startGame(specFor(1 + ((Math.random() * 1000) | 0)));
      });
    canvas.addEventListener("pointerdown", function (e) {
      var r = canvas.getBoundingClientRect();
      pointer.down = true;
      pointer.x = ((e.clientX - r.left) / r.width) * canvas.width;
      pointer.y = ((e.clientY - r.top) / r.height) * canvas.height;
    });
    canvas.addEventListener("pointermove", function (e) {
      var r = canvas.getBoundingClientRect();
      pointer.x = ((e.clientX - r.left) / r.width) * canvas.width;
      pointer.y = ((e.clientY - r.top) / r.height) * canvas.height;
    });
    window.addEventListener("pointerup", function () {
      pointer.down = false;
    });
    window.addEventListener("keydown", function (e) {
      if (document.body.getAttribute("data-active-tab") !== "thousand") return;
      var k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      keys[k] = true;
      if (k === " " || k.indexOf("Arrow") === 0) e.preventDefault();
    });
    window.addEventListener("keyup", function (e) {
      var k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      keys[k] = false;
    });
    window.addEventListener("thousand-show", function () {
      resize();
      renderGrid(($("k-search") && $("k-search").value) || "");
      startGame(current || specFor(1));
    });
    window.addEventListener("thousand-hide", function () {
      running = false;
      if (raf) cancelAnimationFrame(raf);
    });
    window.addEventListener("resize", function () {
      if (running) resize();
    });
  }

  function init() {
    if (!$("panel-thousand")) return;
    try {
      try {
        if (!localStorage.getItem("thousand_edits_cleared_v3")) {
          localStorage.removeItem(EDITS_KEY);
          localStorage.setItem("thousand_edits_cleared_v3", "1");
        }
      } catch (e0) {}
      buildCatalog();
      bind();
      renderGrid("");
      var n = $("k-count");
      if (n) n.textContent = String(catalog.length);
      if ($("k-status")) $("k-status").textContent = catalog.length + " games ready. Opening #1.";
      startGame(specFor(1));
    } catch (err) {
      var s = $("k-status");
      if (s) s.textContent = "Init failed: " + (err && err.message ? err.message : err);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  window.ThousandGames = {
    onShow: function () {
      resize();
      if (catalog.length) startGame(current || specFor(1));
    },
    catalog: function () {
      return catalog;
    },
  };
})();
