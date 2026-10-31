/**
 * Houma — third-person drive on real OpenStreetMap geometry.
 * Google Earth imagery can't be copied. OSM streets/water/footprints can.
 */
(function () {
  "use strict";
  // 3D renderer (js/houma3d.js, Sims-tab look). Resolved next to this script; loaded on first show.
  var H3D_URL = (function () { try { return new URL("houma3d.js?v=16", document.currentScript.src).href; } catch (e) { return "js/houma3d.js?v=11"; } })();
  var h3dLoading = null;
  function use3d() { return !!(window.Houma3D && window.Houma3D.active()); }

  var CELL = 8;
  var ORIGIN = 2200;
  var X0 = -ORIGIN, Y0 = -ORIGIN, X1 = ORIGIN, Y1 = ORIGIN; // world bounds (meters); replaced by the GIS extent
  var gis = null; // real parish geometry (data/houma-gis): lots, structures, centerlines, water, bridges, land use
  var COLS = 560;
  var ROWS = 560;
  var T = { GRASS: 0, WATER: 1, ROAD: 2, PARK: 3, BLDG: 4 };

  var grid = null;
  var osm = { roads: [], water: [], buildings: [], parking: [] };
  var streetSigns = [];
  var player = null;
  var cars = [];
  var peds = [];
  // Parcel-derived homes + resident NPCs (Terrebonne Assessor data, data/houma-parcels.json)
  var originLL = [29.59007223, -90.72057];
  var homes = [];
  var residents = [];
  var homeBuckets = {};
  var BK = 100;
  var lastMet = null;
  var keys = {};
  var wanted = 0;
  var wantedTimer = 0;
  var money = 120;
  var mission = 0;
  var running = false;
  var raf = 0;
  var lastT = 0;
  var toastT = 0;
  var canvas;
  var ctx;
  var viewW = 800;
  var viewH = 500;
  var camMode = 1;
  var ready = false;
  var missions = [
    { name: "Barrow / 182", hint: "You're on real Houma streets. Drive. F to jack another car." },
    { name: "Main Street", hint: "Follow signs to Main Street along the bayou." },
    { name: "Tunnel Blvd", hint: "Find West or East Tunnel Boulevard." },
    { name: "Civic Center", hint: "Civic Center Boulevard — the lot before the building." },
    { name: "The water", hint: "Get next to the Intracoastal / bayou." },
  ];

  function $(id) {
    return document.getElementById(id);
  }

  function wxToC(x) {
    return ((x - X0) / CELL) | 0;
  }
  function wyToC(y) {
    return ((y - Y0) / CELL) | 0;
  }
  function cToWx(c) {
    return c * CELL + X0;
  }
  function getT(cx, cy) {
    if (cx < 0 || cy < 0 || cx >= COLS || cy >= ROWS || !grid) return T.GRASS;
    return grid[cy * COLS + cx];
  }
  function setT(cx, cy, v) {
    if (cx < 0 || cy < 0 || cx >= COLS || cy >= ROWS || !grid) return;
    grid[cy * COLS + cx] = v;
  }

  function stampDisk(x, y, r, v) {
    var cx = wxToC(x);
    var cy = wyToC(y);
    var cr = Math.max(1, (r / CELL) | 0);
    var dx;
    var dy;
    for (dy = -cr; dy <= cr; dy++) {
      for (dx = -cr; dx <= cr; dx++) {
        if (dx * dx + dy * dy <= cr * cr + 1) setT(cx + dx, cy + dy, v);
      }
    }
  }

  function stampLine(pts, r, v) {
    var i;
    var s;
    for (i = 0; i < pts.length - 1; i++) {
      var x0 = pts[i][0];
      var y0 = pts[i][1];
      var x1 = pts[i + 1][0];
      var y1 = pts[i + 1][1];
      var len = Math.max(1, Math.hypot(x1 - x0, y1 - y0));
      var n = Math.ceil(len / 4);
      for (s = 0; s <= n; s++) {
        var t = s / n;
        stampDisk(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r, v);
      }
    }
  }

  function fillPoly(pts, v) {
    if (pts.length < 3) return;
    var minx = pts[0][0];
    var maxx = minx;
    var miny = pts[0][1];
    var maxy = miny;
    var i;
    for (i = 1; i < pts.length; i++) {
      minx = Math.min(minx, pts[i][0]);
      maxx = Math.max(maxx, pts[i][0]);
      miny = Math.min(miny, pts[i][1]);
      maxy = Math.max(maxy, pts[i][1]);
    }
    var cy0 = wyToC(miny);
    var cy1 = wyToC(maxy);
    var y;
    for (y = cy0; y <= cy1; y++) {
      var wy = cToWx(y) + CELL * 0.5;
      var xs = [];
      var j;
      for (j = 0; j < pts.length; j++) {
        var a = pts[j];
        var b = pts[(j + 1) % pts.length];
        if ((a[1] <= wy && b[1] > wy) || (b[1] <= wy && a[1] > wy)) {
          var t = (wy - a[1]) / (b[1] - a[1] || 1e-6);
          xs.push(a[0] + t * (b[0] - a[0]));
        }
      }
      xs.sort(function (p, q) {
        return p - q;
      });
      for (j = 0; j + 1 < xs.length; j += 2) {
        var x = xs[j];
        while (x <= xs[j + 1]) {
          setT(wxToC(x), y, v);
          x += CELL;
        }
      }
    }
  }

  function ingest(data) {
    osm = { roads: [], water: [], buildings: [], parking: [] };
    streetSigns = [];
    if (data.origin) originLL = data.origin;
    if (data.bounds) { X0 = data.bounds[0]; Y0 = data.bounds[1]; X1 = data.bounds[2]; Y1 = data.bounds[3]; COLS = Math.ceil((X1 - X0) / CELL); ROWS = Math.ceil((Y1 - Y0) / CELL); }
    (data.features || []).forEach(function (f) {
      if (f.k === "road") osm.roads.push(f);
      else if (f.k === "water") osm.water.push(f);
      else if (f.k === "building") osm.buildings.push(f);
      else if (f.k === "parking") osm.parking.push(f);
    });
    grid = new Uint8Array(COLS * ROWS);
    osm.buildings.forEach(function (f) {
      if (f.p.length > 3) fillPoly(f.p, T.BLDG);
    });
    osm.parking.forEach(function (f) {
      if (f.p.length > 3) fillPoly(f.p, T.PARK);
    });
    osm.water.forEach(function (f) {
      if (f.p.length > 3 && closeRing(f.p)) fillPoly(f.p, T.WATER);
      else stampLine(f.p, Math.max(3, (f.w || 28) / 2), T.WATER);
    });
    osm.roads.forEach(function (f) {
      var w = f.hw ? f.hw + 1 : f.h === "trunk" || f.h === "primary" || f.h === "secondary" ? 9 : f.h === "residential" ? 6 : 5;
      if (f.lvl !== -1) stampLine(f.p, w, T.ROAD);
      if (f.n && f.p.length > 1) {
        var mid = f.p[(f.p.length / 2) | 0];
        var a = f.p[Math.min(f.p.length - 1, ((f.p.length / 2) | 0) + 1)];
        var ang = Math.atan2(a[1] - mid[1], a[0] - mid[0]);
        streetSigns.push({ x: mid[0], y: mid[1], a: ang, name: f.n });
      }
    });
  }

  function closeRing(pts) {
    var a = pts[0];
    var b = pts[pts.length - 1];
    return Math.hypot(a[0] - b[0], a[1] - b[1]) < 4;
  }

  function worldT(x, y) {
    return getT(wxToC(x), wyToC(y));
  }

  // narrower channel widths matching the aerial: the bayous through town are roughly 18-26 m bank to bank, not 40 m
  function bayouW(kind, name, w) {
    name = name || "";
    if (/intracoastal|navigation|houma nav/i.test(name)) return w || 40;
    if (kind === "river") return /terrebonne|black|blue/i.test(name) ? 26 : /bayou/i.test(name) ? 22 : 24;
    if (kind === "canal") return /bayou/i.test(name) ? 18 : 16;
    if (kind === "stream") return 8;
    return w;
  }
  function canMove(x, y, mode) {
    var t = worldT(x, y);
    if (mode === "boat") return t === T.WATER;
    if (mode === "car") return t !== T.BLDG && t !== T.WATER;
    return t !== T.BLDG;
  }

  function streetAt(x, y) {
    var best = "";
    var bestD = 55;
    streetSigns.forEach(function (s) {
      var d = Math.hypot(s.x - x, s.y - y);
      if (d < bestD) {
        bestD = d;
        best = s.name;
      }
    });
    return best;
  }

  function districtAt(x, y) {
    var t = worldT(x, y);
    var s = streetAt(x, y);
    var place = t === T.WATER ? "Bayou / canal" : t === T.PARK ? "Parking" : "Houma";
    if (s) return s + " · " + place;
    return place;
  }

  function rand(a, b) {
    return a + Math.random() * (b - a);
  }

  function pickRoad(namePart) {
    var i;
    for (i = 0; i < osm.roads.length; i++) {
      var n = (osm.roads[i].n || "") + " " + (osm.roads[i].r || "");
      if (n.toLowerCase().indexOf(namePart.toLowerCase()) >= 0 && osm.roads[i].p.length > 3) return osm.roads[i];
    }
    return osm.roads[0];
  }

  function spawnCar(kind, x, y, ang, color) {
    return {
      kind: kind || "sedan",
      x: x,
      y: y,
      a: ang || 0,
      v: 0,
      cop: kind === "cop",
      boat: kind === "boat",
      color:
        color ||
        (kind === "cop"
          ? "#2d5aa0"
          : kind === "boat"
            ? "#c45c26"
            : kind === "truck"
              ? "#8a8e92"
              : ["#c23b5a", "#d4a017", "#2a9d8f", "#e8ddd0", "#4a4a4a", "#2a2c30"][(Math.random() * 6) | 0]),
    };
  }

  function spawnWorld() {
    cars = [];
    peds = [];
    var spawnRd = pickRoad("Barrow") || pickRoad("Main") || pickRoad("Park") || osm.roads[0];
    var sp = spawnRd.p[Math.min(4, spawnRd.p.length - 2)];
    var sp2 = spawnRd.p[Math.min(5, spawnRd.p.length - 1)];
    var ang = Math.atan2(sp2[1] - sp[1], sp2[0] - sp[0]);
    var ride = spawnCar("sedan", sp[0], sp[1], ang, "#3f5f86");
    cars.push(ride);
    player = { x: sp[0], y: sp[1], a: ang, v: 0, veh: ride };
    var n;
    var tries = 0;
    for (n = 0; n < 40 && tries < 400; tries++) {
      var rd = osm.roads[(Math.random() * osm.roads.length) | 0];
      if (!rd.p.length) continue;
      var k = (Math.random() * (rd.p.length - 1)) | 0;
      var a = rd.p[k];
      var b = rd.p[k + 1];
      var aa = Math.atan2(b[1] - a[1], b[0] - a[0]);
      cars.push(spawnCar(Math.random() < 0.2 ? "truck" : Math.random() < 0.1 ? "cop" : "sedan", a[0], a[1], aa));
      n++;
    }
    for (n = 0; n < 24; n++) {
      peds.push({
        x: player.x + rand(-80, 80),
        y: player.y + rand(-80, 80),
        a: rand(0, 6.28),
        v: rand(1.2, 2.4),
        hue: (n * 47) % 360,
      });
    }
    wanted = 0;
    money = 120;
    mission = 1;
  }

  function nearestCar(maxd) {
    var best = null;
    var bestD = maxd || 8;
    cars.forEach(function (c) {
      if (c === player.veh) return;
      var d = Math.hypot(c.x - player.x, c.y - player.y);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    });
    return best;
  }

  function toast(msg) {
    var el = $("hm-toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    toastT = 2.6;
  }

  function bumpWanted(n) {
    wanted = Math.max(0, Math.min(5, wanted + n));
    wantedTimer = 14;
  }

  function tryEnter() {
    if (player.veh) {
      var v = player.veh;
      player.x = v.x - Math.sin(v.a) * 4;
      player.y = v.y + Math.cos(v.a) * 4;
      player.veh = null;
      toast("On foot.");
      return;
    }
    var c = nearestCar(7);
    if (!c) {
      toast("No ride in range.");
      return;
    }
    player.veh = c;
    bumpWanted(c.cop ? 2 : 1);
    toast(c.kind === "truck" ? "Pickup." : "Car.");
  }

  function moveEntity(ent, dt, mode, maxV, acc) {
    var throttle = 0;
    var steer = 0;
    var driven = ent === player || (player.veh && ent === player.veh);
    if (driven && auto && ent === player.veh) {
      var ac = autoCtl(ent, dt); throttle = ac[0]; steer = ac[1];
    } else if (driven) {
      if (keys.w || keys.ArrowUp) throttle = 1;
      if (keys.s || keys.ArrowDown) throttle = -0.5;
      if (keys.a || keys.ArrowLeft) steer = -1;
      if (keys.d || keys.ArrowRight) steer = 1;
    } else if (ent.cop && wanted > 0) {
      var ang = Math.atan2(player.y - ent.y, player.x - ent.x);
      var diff = ang - ent.a;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      steer = Math.max(-1, Math.min(1, diff * 2));
      throttle = 0.85;
    } else {
      throttle = ent.v < 13 ? 0.5 : 0; // traffic: same engine, cruises ~30 mph in town
    }
    if (mode === "car") {
      // realistic longitudinal model: thrust tapers as v^2 approaches top speed (44.7 m/s = 100 mph),
      // ~0-60 mph in ~9 s; brakes at 8 m/s^2, rolling/air drag when coasting
      var VMAX = 44.7, A0 = 3.5;
      // grass / dirt: a little less grip (slower turn-in, softer acceleration, more rolling drag)
      var gr = driven && window.Houma3D && window.Houma3D.offRoad && window.Houma3D.offRoad(ent.x, ent.y) ? 0.72 : 1;
      if (gr < 1) ent.v -= ent.v * 0.12 * dt;
      if (throttle > 0) ent.v += throttle * A0 * (0.55 + 0.45 * gr) * (1 - (ent.v / VMAX) * Math.abs(ent.v / VMAX)) * dt;
      else if (throttle < 0) ent.v += (ent.v > 0.3 ? -8 : -2.5) * dt;
      else ent.v -= Math.sign(ent.v) * Math.min(Math.abs(ent.v), (0.35 + 0.0004 * ent.v * ent.v) * dt);
      ent.v = Math.max(-8, Math.min(VMAX, ent.v));
      if (Math.abs(ent.v) > 0.4) ent.a += steer * 1.8 * gr / (1 + Math.abs(ent.v) / 18) * dt * (ent.v >= 0 ? 1 : -1);
    } else {
      ent.v += (throttle * acc - ent.v * 2.2) * dt;
      ent.v = Math.max(-maxV * 0.35, Math.min(maxV, ent.v));
      if (Math.abs(ent.v) > 0.4) ent.a += steer * 1.8 * dt * (ent.v >= 0 ? 1 : -1);
    }
    var t = worldT(ent.x + Math.cos(ent.a) * 3, ent.y + Math.sin(ent.a) * 3);
    var scale = mode === "foot" && t === T.WATER ? 0.35 : 1;
    var nx = ent.x + Math.cos(ent.a) * ent.v * dt * scale;
    var ny = ent.y + Math.sin(ent.a) * ent.v * dt * scale;
    // 3D drivable surface: on a bridge deck/ramp the car follows the deck height and the parapets stop it
    var H3 = mode === "car" && window.Houma3D && window.Houma3D.deckY ? window.Houma3D : null;
    var z0 = ent._z || 0, up = H3 && z0 > 0.9;
    var deckOK = function (x, y) { if (!H3) return true; if (!up) return !(H3.hitBldg && H3.hitBldg(x + Math.cos(ent.a) * 1.6 * Math.sign(ent.v || 1), y + Math.sin(ent.a) * 1.6 * Math.sign(ent.v || 1), 0.9)); var z = H3.deckY(x, y, z0); return Math.abs(z - z0) < 1.0; };
    // slide along walls axis by axis; a head-on hit stops the car with a small bounce
    // a driven car may roll off the bank into a bayou (and bog down there); traffic keeps to dry land
    var cm = function (x, y) { if (driven && mode === "car" && worldT(x, y) === T.WATER) return true; return canMove(x, y, mode); };
    var hx = !((up || cm(nx, ent.y)) && deckOK(nx, ent.y)), hy = !((up || cm(ent.x, ny)) && deckOK(ent.x, ny));
    if (!hx) ent.x = nx;
    if (!hy) ent.y = ny;
    if (hx && hy) ent.v *= mode === "car" ? -0.15 : 0.25; else if (hx || hy) ent.v *= mode === "car" ? 0.6 : 0.25;
    if (H3) ent._z = H3.deckY(ent.x, ent.y, z0);
    if (mode === "car") { // in the water (not on a deck): the car sinks into the mud and stalls; only a slow reverse gets it out
      var inW = worldT(ent.x, ent.y) === T.WATER && !((ent._z || 0) > 0.5);
      if (inW) {
        ent._sink = Math.min(1.5, (ent._sink || 0) + dt * 1.1);
        if (ent.v > 0) ent.v = Math.min(ent.v * Math.pow(0.01, dt), ent._sink > 0.9 ? 0 : 1.5); else ent.v = Math.max(ent.v, -1.5);
        if (driven && !ent._sankMsg) { ent._sankMsg = 1; if (auto) setAuto(false, "Stopped: in the water"); toast("Splash! The car is stuck in the bayou. Back out slowly (S), or get out (F)."); }
      } else if (ent._sink) { ent._sink = Math.max(0, ent._sink - dt * 2); if (!ent._sink) ent._sankMsg = 0; }
    }
  }

  function updateMissions() {
    var s = streetAt(player.x, player.y);
    if (mission === 1 && /main/i.test(s)) {
      mission = 2;
      toast("Main Street.");
    } else if (mission === 2 && /tunnel/i.test(s)) {
      mission = 3;
      toast("Tunnel Blvd.");
    } else if (mission === 3 && /civic/i.test(s)) {
      mission = 4;
      toast("Civic Center.");
    } else if (mission === 4 && worldT(player.x, player.y) === T.WATER) {
      mission = 5;
      toast("The water.");
    }
  }

  function update(dt) {
    if (!player) return;
    if (toastT > 0) {
      toastT -= dt;
      if (toastT <= 0 && $("hm-toast")) $("hm-toast").classList.remove("show");
    }
    if (player.veh) {
      moveEntity(player.veh, dt, player.veh.boat ? "boat" : "car", 44.7, 3.5);
      player.x = player.veh.x;
      player.y = player.veh.y;
      player.a = player.veh.a;
    } else {
      moveEntity(player, dt, "foot", 5.2, 14);
    }
    cars.forEach(function (c) {
      if (c === player.veh) return;
      moveEntity(c, dt, c.boat ? "boat" : "car", 44.7, 3.5);
    });
    peds.forEach(function (p) {
      p.x += Math.cos(p.a) * p.v * dt;
      p.y += Math.sin(p.a) * p.v * dt;
      if (!canMove(p.x, p.y, "foot") || Math.random() < 0.01) p.a += 1.1;
    });
    if (wanted > 0) {
      wantedTimer -= dt;
      if (wantedTimer <= 0) {
        wanted -= 1;
        wantedTimer = 10;
      }
    }
    updateResidents(dt);
    updateMissions();
    hud();
  }

  function hud() {
    if ($("hm-stars")) $("hm-stars").textContent = wanted ? "★".repeat(wanted) + "☆".repeat(5 - wanted) : "☆☆☆☆☆";
    if ($("hm-cash")) $("hm-cash").textContent = "$" + Math.floor(money);
    if ($("hm-speed")) $("hm-speed").textContent = player.veh && !player.veh.boat ? Math.round(Math.abs(player.veh.v || 0) * 2.23694) + " mph" : "";
    if ($("hm-dist")) $("hm-dist").textContent = districtAt(player.x, player.y);
    if ($("hm-miss")) {
      $("hm-miss").textContent =
        mission >= missions.length ? "Keep driving Houma." : missions[mission].name + " — " + missions[mission].hint;
    }
  }

  function camPos() {
    var a = player.a;
    var dist = camMode === 1 ? 9 : 18;
    var height = camMode === 1 ? 3.6 : 7;
    return {
      x: player.x - Math.cos(a) * dist,
      y: player.y - Math.sin(a) * dist,
      z: height,
      yaw: a,
    };
  }

  function project(wx, wy, wz, cam) {
    var dx = wx - cam.x;
    var dy = wy - cam.y;
    var dz = (wz || 0) - cam.z;
    var c = Math.cos(cam.yaw);
    var s = Math.sin(cam.yaw);
    var right = -dx * s + dy * c;
    var fwd = dx * c + dy * s;
    var up = dz;
    var pitch = camMode === 1 ? 0.18 : 0.32;
    var fy = up * Math.cos(pitch) + fwd * Math.sin(pitch);
    var fz = -up * Math.sin(pitch) + fwd * Math.cos(pitch);
    if (fz < 1.2) return null;
    var fov = viewH * 0.9;
    return { x: viewW * 0.5 + (right * fov) / fz, y: viewH * 0.58 - (fy * fov) / fz, z: fz };
  }

  function drawPoly(pts, fill, stroke) {
    var i;
    for (i = 0; i < pts.length; i++) if (!pts[i]) return;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  function shade(hex, d) {
    if (!hex || hex[0] !== "#") return hex;
    var n = parseInt(hex.slice(1), 16);
    var r = Math.max(0, Math.min(255, ((n >> 16) & 255) + d));
    var g = Math.max(0, Math.min(255, ((n >> 8) & 255) + d));
    var b = Math.max(0, Math.min(255, (n & 255) + d));
    return "rgb(" + r + "," + g + "," + b + ")";
  }

  function sat(t) {
    if (t === T.WATER) return "#5c4a38";
    if (t === T.ROAD) return "#5a5854";
    if (t === T.PARK) return "#6a6860";
    if (t === T.BLDG) return "#c8c2b8";
    return "#1f4a28";
  }

  function drawGround(cam) {
    var rad = 42;
    var cx = wxToC(player.x);
    var cy = wyToC(player.y);
    var x;
    var y;
    var quads = [];
    for (y = cy - rad; y <= cy + rad; y++) {
      for (x = cx - rad; x <= cx + rad; x++) {
        var t = getT(x, y);
        var x0 = cToWx(x);
        var y0 = cToWx(y);
        var p0 = project(x0, y0, 0, cam);
        var p1 = project(x0 + CELL, y0, 0, cam);
        var p2 = project(x0 + CELL, y0 + CELL, 0, cam);
        var p3 = project(x0, y0 + CELL, 0, cam);
        if (!p0 || !p1 || !p2 || !p3) continue;
        quads.push({ z: p0.z, pts: [p0, p1, p2, p3], col: sat(t) });
      }
    }
    quads.sort(function (a, b) {
      return b.z - a.z;
    });
    quads.forEach(function (q) {
      drawPoly(q.pts, q.col, null);
    });
  }

  function drawRoads(cam) {
    osm.roads.forEach(function (rd) {
      var mid = rd.p[(rd.p.length / 2) | 0];
      if (Math.hypot(mid[0] - player.x, mid[1] - player.y) > 280) return;
      var half = rd.h === "primary" || rd.h === "secondary" ? 4.2 : 3.2;
      var i;
      for (i = 1; i < rd.p.length; i++) {
        var a = rd.p[i - 1];
        var b = rd.p[i];
        var ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
        var px = -Math.sin(ang);
        var py = Math.cos(ang);
        var q0 = project(a[0] + px * half, a[1] + py * half, 0.12, cam);
        var q1 = project(a[0] - px * half, a[1] - py * half, 0.12, cam);
        var q2 = project(b[0] - px * half, b[1] - py * half, 0.12, cam);
        var q3 = project(b[0] + px * half, b[1] + py * half, 0.12, cam);
        drawPoly([q0, q1, q2, q3], "#55534f", null);
        var y0 = project(a[0] + px * 0.35, a[1] + py * 0.35, 0.18, cam);
        var y1 = project(b[0] + px * 0.35, b[1] + py * 0.35, 0.18, cam);
        var y2 = project(a[0] - px * 0.35, a[1] - py * 0.35, 0.18, cam);
        var y3 = project(b[0] - px * 0.35, b[1] - py * 0.35, 0.18, cam);
        if (y0 && y1) {
          ctx.strokeStyle = "rgba(220,180,40,0.9)";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(y0.x, y0.y);
          ctx.lineTo(y1.x, y1.y);
          ctx.stroke();
        }
        if (y2 && y3) {
          ctx.beginPath();
          ctx.moveTo(y2.x, y2.y);
          ctx.lineTo(y3.x, y3.y);
          ctx.stroke();
        }
        ctx.lineWidth = 1;
      }
    });
  }

  function drawBuildings(cam) {
    var vis = [];
    osm.buildings.forEach(function (b) {
      var c = b.p[0];
      if (Math.hypot(c[0] - player.x, c[1] - player.y) > 160) return;
      vis.push(b);
    });
    vis.sort(function (a, b) {
      return Math.hypot(b.p[0][0] - cam.x, b.p[0][1] - cam.y) - Math.hypot(a.p[0][0] - cam.x, a.p[0][1] - cam.y);
    });
    vis.forEach(function (b) {
      var z = Math.min(16, b.z || 6.5);
      var col = z > 10 ? "#c4b8a8" : "#d8d0c4";
      var top = [];
      var i;
      for (i = 0; i < b.p.length; i++) {
        var p = project(b.p[i][0], b.p[i][1], z, cam);
        if (!p) return;
        top.push(p);
      }
      for (i = 0; i < b.p.length - 1; i++) {
        var a = b.p[i];
        var c = b.p[i + 1];
        var p0 = project(a[0], a[1], 0, cam);
        var p1 = project(c[0], c[1], 0, cam);
        var p2 = project(c[0], c[1], z, cam);
        var p3 = project(a[0], a[1], z, cam);
        drawPoly([p0, p1, p2, p3], shade(col, -22 - (i % 3) * 6), "rgba(40,30,20,0.2)");
      }
      drawPoly(top, col, "rgba(60,50,40,0.25)");
    });
  }

  function drawSigns(cam) {
    streetSigns.forEach(function (sg) {
      if (Math.hypot(sg.x - player.x, sg.y - player.y) > 90) return;
      var fx = Math.cos(sg.a + 1.57);
      var fy = Math.sin(sg.a + 1.57);
      var a = project(sg.x - fx * 3.2, sg.y - fy * 3.2, 2.8, cam);
      var b = project(sg.x + fx * 3.2, sg.y + fy * 3.2, 2.8, cam);
      var c = project(sg.x + fx * 3.2, sg.y + fy * 3.2, 3.6, cam);
      var d = project(sg.x - fx * 3.2, sg.y - fy * 3.2, 3.6, cam);
      drawPoly([a, b, c, d], "#1f7a3a", "#0d3d1c");
      var p = project(sg.x, sg.y, 3.25, cam);
      if (p && p.z < 70) {
        ctx.fillStyle = "#f4f7f2";
        ctx.font = "700 " + Math.max(8, 420 / p.z) + "px Bahnschrift, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(sg.name, p.x, p.y);
      }
    });
  }

  function carPt(ent, lon, lat, z, cam) {
    var fx = Math.cos(ent.a);
    var fy = Math.sin(ent.a);
    return project(ent.x + fx * lon + -fy * lat, ent.y + fy * lon + fx * lat, z, cam);
  }

  function drawCar(ent, cam) {
    var truck = ent.kind === "truck";
    var col = ent.color;
    var L = truck ? 2.6 : 2.2;
    var W = truck ? 1.05 : 0.95;
    function q(a, b, c, d, fill) {
      drawPoly([a, b, c, d], fill, "rgba(0,0,0,0.25)");
    }
    q(carPt(ent, L, W, 0.85, cam), carPt(ent, L, -W, 0.85, cam), carPt(ent, -L, -W, 0.85, cam), carPt(ent, -L, W, 0.85, cam), col);
    q(carPt(ent, L * 0.3, W * 0.8, 1.45, cam), carPt(ent, L * 0.3, -W * 0.8, 1.45, cam), carPt(ent, -L * 0.35, -W * 0.8, 1.45, cam), carPt(ent, -L * 0.35, W * 0.8, 1.45, cam), shade(col, 10));
    q(carPt(ent, L * 0.3, W * 0.65, 0.85, cam), carPt(ent, L * 0.3, -W * 0.65, 0.85, cam), carPt(ent, L * 0.3, -W * 0.65, 1.45, cam), carPt(ent, L * 0.3, W * 0.65, 1.45, cam), "rgba(140,190,220,0.7)");
    [[L * 0.6, W + 0.12], [L * 0.6, -W - 0.12], [-L * 0.55, W + 0.12], [-L * 0.55, -W - 0.12]].forEach(function (wh) {
      var wp = carPt(ent, wh[0], wh[1], 0.35, cam);
      if (!wp) return;
      ctx.fillStyle = "#1a1a1a";
      ctx.beginPath();
      ctx.arc(wp.x, wp.y, Math.max(1.5, 18 / wp.z), 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function drawMinimap() {
    var mw = 196;
    var mh = 156;
    var mx = viewW - mw - 14;
    var my = 12;
    ctx.fillStyle = "rgba(6,8,6,0.85)";
    ctx.fillRect(mx - 5, my - 5, mw + 10, mh + 10);
    var span = 900;
    var x0 = player.x - span;
    var y0 = player.y - span;
    var step = 10;
    var ix;
    var iy;
    for (iy = 0; iy < mh; iy += 2) {
      for (ix = 0; ix < mw; ix += 2) {
        var wx = x0 + (ix / mw) * span * 2;
        var wy = y0 + (iy / mh) * span * 2;
        ctx.fillStyle = sat(worldT(wx, wy));
        ctx.fillRect(mx + ix, my + iy, 2, 2);
      }
    }
    drawRouteMini(mx, my, mw, mh, x0, y0, span);
    ctx.save();
    ctx.translate(mx + mw / 2, my + mh / 2);
    ctx.rotate(player.a);
    ctx.fillStyle = "#ff4fa3";
    ctx.beginPath();
    ctx.moveTo(7, 0);
    ctx.lineTo(-5, 4);
    ctx.lineTo(-5, -4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function draw() {
    if (!ctx || !player) return;
    if (use3d()) {
      // the WebGL canvas underneath draws the world; this canvas is only the HUD overlay now
      ctx.clearRect(0, 0, viewW, viewH);
      try { drawMinimap(); } catch (e) {}
      return;
    }
    try {
      ctx.fillStyle = "#79b4e0";
      ctx.fillRect(0, 0, viewW, viewH);
      var g = ctx.createLinearGradient(0, 0, 0, viewH * 0.5);
      g.addColorStop(0, "#5ba3d9");
      g.addColorStop(1, "#c5dce8");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, viewW, viewH * 0.5);
      var cam = camPos();
      drawGround(cam);
      drawRoads(cam);
      drawBuildings(cam);
      drawHomes(cam);
      drawSigns(cam);
      cars.forEach(function (c) {
        if (Math.hypot(c.x - player.x, c.y - player.y) < 120) drawCar(c, cam);
      });
      if (!player.veh) {
        var p = project(player.x, player.y, 1.6, cam);
        if (p) {
          ctx.fillStyle = "#e8c36a";
          ctx.beginPath();
          ctx.arc(p.x, p.y, Math.max(3, 40 / p.z), 0, Math.PI * 2);
          ctx.fill();
        }
      }
      peds.forEach(function (pe) {
        var s = project(pe.x, pe.y, 1.5, cam);
        if (!s) return;
        ctx.fillStyle = "hsl(" + pe.hue + ",30%,55%)";
        ctx.beginPath();
        ctx.arc(s.x, s.y, Math.max(2, 28 / s.z), 0, Math.PI * 2);
        ctx.fill();
      });
      drawMinimap();
    } catch (err) {
      ctx.fillStyle = "#1a3048";
      ctx.fillRect(0, 0, viewW, viewH);
      ctx.fillStyle = "#ffe7c2";
      ctx.font = "14px sans-serif";
      ctx.fillText(String(err && err.message ? err.message : err), 16, 40);
    }
  }

  function loop(ts) {
    if (!running) return;
    var dt = Math.min(0.05, (ts - lastT) / 1000 || 0.016);
    lastT = ts;
    if (ready) { update(dt); gpsUpdate(dt); }
    if (ready && window.Houma3D) {
      try { window.Houma3D.frame(dt); } catch (e) { if (!loop.warned) { loop.warned = 1; console.warn("Houma 3D frame", e); } }
    }
    draw();
    raf = requestAnimationFrame(loop);
  }

  function resize() {
    if (!canvas) return;
    var wrap = $("hm-stage");
    var r = wrap ? wrap.getBoundingClientRect() : { width: 800, height: 500 };
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    viewW = Math.max(320, r.width);
    viewH = Math.max(240, r.height);
    canvas.width = viewW * dpr;
    canvas.height = viewH * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    canvas.style.width = viewW + "px";
    canvas.style.height = viewH + "px";
  }

  // World keys only when the Houma World view is showing and the user isn't typing in a field.
  function isTypingTarget(t) {
    if (!t || t === document || t === window) return false;
    var tag = (t.tagName || "").toUpperCase();
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || !!t.isContentEditable;
  }
  function worldKeysActive(e) {
    if (document.body.getAttribute("data-active-tab") !== "houma") return false;
    if (isTypingTarget(e.target) || isTypingTarget(document.activeElement)) return false;
    var stage = $("hm-stage");
    if (!stage || stage.hidden) return false; // Properties / Multi-owners view open
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    return true;
  }

  function onKey(e, down) {
    var k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    keys[k] = down;
    if (down && auto && /^(w|a|s|d|ArrowUp|ArrowDown|ArrowLeft|ArrowRight| )$/.test(k)) setAuto(false, "Manual — you took the wheel");
    if (down && (k === "f" || k === "e")) {
      tryEnter();
      e.preventDefault();
    }
    if (down && k === "c") {
      camMode = camMode ? 0 : 1;
      toast(camMode ? "Street cam." : "Follow cam.");
    }
  }

  // ---- real geometry: Terrebonne Parish GIS (parcels, structures, street centerlines) + OSM water/bridges/land use
  var GV = "?v=3";
  function getJ(u) { return fetch(u + GV).then(function (r) { if (!r.ok) throw new Error(u + " " + r.status); return r.json(); }); }
  function dec(a) { var out = [], x = 0, y = 0, i; for (i = 0; i < a.length; i += 2) { x += a[i]; y += a[i + 1]; out.push([x / 10, y / 10]); } return out; }
  function centroid(p) { var a = 0, cx = 0, cy = 0, i, j; for (i = 0, j = p.length - 1; i < p.length; j = i++) { var f = p[j][0] * p[i][1] - p[i][0] * p[j][1]; a += f; cx += (p[j][0] + p[i][0]) * f; cy += (p[j][1] + p[i][1]) * f; } if (Math.abs(a) < 1e-6) return [p[0][0], p[0][1], 0]; return [cx / (3 * a), cy / (3 * a), Math.abs(a / 2)]; }
  function titleCase(n) { return (n || "").toLowerCase().replace(/\b([a-z])/g, function (m) { return m.toUpperCase(); }).replace(/\bAv\b/, "Ave"); }
  function roadClass(cls, name) {
    if (/HIGHWAY|HWY|MARTIN LUTHER KING|TUNNEL BLVD|PRAGUE|INDUSTRIAL BLVD|ST CHARLES|SAINT CHARLES|GRAND CAILLOU|NEW ORLEANS BLVD/.test(name)) return cls === 3 ? "trunk" : "secondary";
    return cls === 1 ? "motorway" : cls === 2 ? "trunk" : cls === 3 ? "primary" : cls === 4 ? "residential" : cls === 5 ? "living_street" : "service";
  }
  // half-widths (m) shared with js/houma3d.js and scripts/fetch_houma_gis.py (buildings are clipped against these)
  var PHW = { 1: 7, 2: 7, 3: 5, 4: 3.5, 5: 3, 0: 2.3 };
  var OHW = { motorway: 7.6, trunk: 7.6, primary: 7.2, secondary: 6.0, tertiary: 4.6, motorway_link: 3.6, trunk_link: 3.6, primary_link: 3.4, secondary_link: 3.2, tertiary_link: 3.0 };
  function osmHW(cls, lanes, one) { if (lanes) return Math.max(2.6, lanes * 1.75 + 0.6); var h = OHW[cls] || 3.5; return one && !/link$/.test(cls) ? h / 2 + 1 : h; }
  function loadGis() {
    return getJ("data/houma-gis/meta.json").then(function (meta) {
      var parts = [getJ("data/houma-gis/roads.json"), getJ("data/houma-gis/water.json")], i;
      for (i = 0; i < meta.parts.lots; i++) parts.push(getJ("data/houma-gis/lots-" + i + ".json"));
      for (i = 0; i < meta.parts.bldg; i++) parts.push(getJ("data/houma-gis/bldg-" + i + ".json"));
      return Promise.all(parts).then(function (all) {
        var roads = all[0], wat = all[1], feats = [], lots = [], lotByAcct = {}, bl = [];
        roads.rows.forEach(function (r) {
          var nm = r[0] || "";
          if (r[3] === 1) feats.push({ k: "road", p: dec(r[2]), n: nm || r[7] || "", r: r[7] || "", h: r[1], lanes: r[4], one: r[5], lvl: r[6], osm: 1, hw: osmHW(r[1], r[4], r[5]) });
          else feats.push({ k: "road", p: dec(r[2]), n: titleCase(nm), r: "", h: roadClass(r[1], nm), hw: PHW[r[1]] || 2.3 });
        });
        wat.water.forEach(function (w) { feats.push({ k: "water", p: dec(w[3]), n: w[0], w: bayouW(w[1], w[0], w[2]), wk: w[1] }); });
        for (i = 2; i < 2 + meta.parts.lots; i++) all[i].rows.forEach(function (r) { var p = dec(r[1]); if (p.length < 3) return; var c = centroid(p), L = { acct: String(r[0]), p: p, cx: c[0], cy: c[1], area: c[2], h: null }; lots.push(L); if (r[0] && !lotByAcct[L.acct]) lotByAcct[L.acct] = L; });
        for (i = 2 + meta.parts.lots; i < all.length; i++) all[i].rows.forEach(function (r) { var p = dec(r[1]); if (p.length >= 3) { var f = { k: "building", p: p, acct: String(r[0]), bt: r[2] || "", lv: r[3] || 0, z: r[4] || 0, rf: r[5] || "", nm: r[6] || "" }; feats.push(f); bl.push(f); } });
        gis = {
          meta: meta, lots: lots, lotByAcct: lotByAcct, bridges: wat.bridges.map(function (b) { return { n: b[0], h: b[1], p: dec(b[2]) }; }),
          green: wat.green.map(function (g) { return { k: g[0], n: g[1], p: dec(g[2]) }; }), poi: wat.poi.map(function (q) { return { k: q[0], n: q[1], x: q[2], y: q[3] }; }),
          city: (meta.city || []).map(dec), marks: [], aero: [],
        };
        return getJ("data/houma-gis/landmarks.json").then(function (lm) {
          gis.marks = lm.marks.map(function (m) { return { k: m[0], n: m[1], x: m[2], y: m[3], p: m[4] && m[4].length ? dec(m[4]) : null }; });
          gis.aero = lm.aero.map(function (a) { return { k: a[0], ref: a[1], w: a[2], p: dec(a[3]) }; });
        }).catch(function (e) { console.warn("landmarks", e); }).then(function () { return { origin: meta.origin, bounds: meta.bounds, features: feats, gis: true }; });
      });
    });
  }
  function loadOsm() {
    toast("Loading real Houma parcels, streets and bayous…");
    return loadGis().catch(function (e) { console.warn("houma-gis unavailable, falling back to OSM extract", e); gis = null; return fetch("data/houma-osm.json?v=1").then(function (r) { if (!r.ok) throw new Error("osm " + r.status); return r.json(); }); })
      .then(function (r) { return r; })
      .then(function (data) {
        ingest(data);
        spawnWorld();
        ready = true;
        if (window.HoumaProps) window.HoumaProps.load().then(placeHomes).catch(function (e) { console.warn("parcels", e); });
        buildGraph();
        if (!homes.length) gpsIndex(null); // streets are searchable before the parcel shards finish loading
        toast((gis ? "Greater Houma: " + gis.lots.length.toLocaleString() + " parish parcels, " : "OpenStreetMap Houma — ") + osm.buildings.length.toLocaleString() + " building footprints, " + osm.roads.length.toLocaleString() + " street segments.");
      })
      .catch(function (err) {
        toast("Could not load OSM: " + (err && err.message));
      });
  }

  function llToXY(lat, lon) {
    return [(lon - originLL[1]) * 111320.0 * Math.cos((originLL[0] * Math.PI) / 180), (originLL[0] - lat) * 110540.0];
  }
  function niceName(owner) {
    // "BRUNET, JOSHUA PAUL" -> "Joshua Brunet"
    var t = function (w) { return w.charAt(0) + w.slice(1).toLowerCase(); };
    var m = /^([^,]+),\s*([A-Z'\-]+)/.exec(owner || "");
    if (!m) return owner;
    return t(m[2]) + " " + m[1].split(/\s+/).map(t).join(" ");
  }
  function nearBuckets(x, y, r, fn) {
    var bx0 = Math.floor((x - r) / BK), bx1 = Math.floor((x + r) / BK), by0 = Math.floor((y - r) / BK), by1 = Math.floor((y + r) / BK), bx, by;
    for (by = by0; by <= by1; by++) for (bx = bx0; bx <= bx1; bx++) (homeBuckets[bx + "," + by] || []).forEach(fn);
  }
  function placeHomes(d) {
    homes = []; residents = []; homeBuckets = {};
    var isBiz = window.HoumaProps ? window.HoumaProps.isBiz : function () { return false; };
    d.parcels.forEach(function (p) {
      if (p.lat == null || p.lon == null) return;
      var xy = llToXY(p.lat, p.lon);
      var lot = gis && gis.lotByAcct[p.id];
      if (lot) xy = [lot.cx, lot.cy]; // the parcel's real polygon centroid
      if (xy[0] < X0 + 40 || xy[0] > X1 - 40 || xy[1] < Y0 + 40 || xy[1] > Y1 - 40) return;
      var built = (p.sqft || 0) > 0 || (p.bldg || 0) > 0;
      var biz = isBiz(p.owner);
      var onOsm = getT(wxToC(xy[0]), wyToC(xy[1])) === T.BLDG; // OSM footprint already drawn here
      var h = { x: xy[0], y: xy[1], p: p, lot: lot || null, built: built, osm: onOsm, biz: biz, w: Math.max(5, Math.min(14, Math.sqrt(p.sqft || 900) * 0.3)), r: null };
      // Resident NPC: a person (not a company) who owns a built parcel; owner-occupied if mailing starts with site address
      if (lot) lot.h = h;
      if (built && !biz && p.owner) {
        var occ = p.site && p.mail && p.mail.toUpperCase().indexOf(p.site.toUpperCase()) === 0;
        h.r = { home: h, x: h.x + rand(-4, 4), y: h.y + rand(-4, 4), a: rand(0, 6.28), v: rand(0.6, 1.4), name: niceName(p.owner), occ: occ, hue: (parseInt(p.id, 10) * 37) % 360 };
        residents.push(h.r);
      }
      homes.push(h);
      var k = Math.floor(h.x / BK) + "," + Math.floor(h.y / BK);
      (homeBuckets[k] = homeBuckets[k] || []).push(h);
    });
    toast("Greater Houma: " + (gis ? gis.lots.length.toLocaleString() + " parcels, " + osm.buildings.length.toLocaleString() + " buildings · " : "") + homes.length.toLocaleString() + " owner records, " + residents.length.toLocaleString() + " residents (parish data " + ((gis && gis.meta.fetched) || d.meta.fetched) + ").");
    gpsIndex(d);
  }
  function updateResidents(dt) {
    if (!player || !homes.length) return;
    var best = null, bd = 6;
    nearBuckets(player.x, player.y, 160, function (h) {
      var r = h.r;
      if (!r) return;
      r.x += Math.cos(r.a) * r.v * dt;
      r.y += Math.sin(r.a) * r.v * dt;
      if (Math.hypot(r.x - h.x, r.y - h.y) > 10 || Math.random() < 0.01) r.a = Math.atan2(h.y - r.y, h.x - r.x) + rand(-1.2, 1.2);
      var dd = Math.hypot(r.x - player.x, r.y - player.y);
      if (dd < bd) { bd = dd; best = r; }
    });
    if (best && best !== lastMet && !player.veh) {
      lastMet = best;
      var p = best.home.p;
      toast(best.name + " — " + (best.occ ? "lives at " : "owns ") + (p.site || "parcel " + p.id) + " · parcel " + p.id + (p.assessed ? " · assessed $" + Math.round(p.assessed).toLocaleString() : ""));
    }
  }
  function drawHomes(cam) {
    if (!homes.length) return;
    var vis = [];
    nearBuckets(player.x, player.y, 130, function (h) {
      var d = Math.hypot(h.x - cam.x, h.y - cam.y);
      if (d < 130) vis.push([d, h]);
    });
    vis.sort(function (a, b) { return b[0] - a[0]; });
    vis.forEach(function (it) {
      var h = it[1], d = it[0];
      if (h.built && !h.osm) {
        var w = h.w / 2, z = h.biz ? 5.5 : 3.6, col = h.biz ? "#9fb4d8" : "#e7b98f";
        var c = [[h.x - w, h.y - w], [h.x + w, h.y - w], [h.x + w, h.y + w], [h.x - w, h.y + w]];
        var i, ok = true, top = [];
        for (i = 0; i < 4; i++) { var tp = project(c[i][0], c[i][1], z, cam); if (!tp) { ok = false; break; } top.push(tp); }
        if (ok) {
          for (i = 0; i < 4; i++) {
            var a = c[i], b = c[(i + 1) % 4];
            drawPoly([project(a[0], a[1], 0, cam), project(b[0], b[1], 0, cam), project(b[0], b[1], z, cam), project(a[0], a[1], z, cam)], shade(col, -18 - i * 5), "rgba(40,20,10,0.25)");
          }
          var apex = project(h.x, h.y, z + (h.biz ? 0.4 : 2.2), cam);
          if (apex) for (i = 0; i < 4; i++) drawPoly([top[i], top[(i + 1) % 4], apex], shade(h.biz ? "#6f7f9a" : "#a5483a", -i * 6), "rgba(30,10,5,0.3)");
          else drawPoly(top, col);
        }
      } else if (!h.built) {
        var s = project(h.x, h.y, 1.2, cam);
        if (s) { ctx.fillStyle = "rgba(255,210,74,0.8)"; ctx.fillRect(s.x - 1, s.y - Math.max(4, 60 / s.z), 2, Math.max(4, 60 / s.z)); }
      }
      if (d < 38) {
        var lp = project(h.x, h.y, h.built ? 7.5 : 2.4, cam);
        if (lp) {
          ctx.font = "600 " + Math.max(9, Math.min(13, 260 / lp.z)) + "px Bahnschrift, sans-serif";
          ctx.textAlign = "center";
          ctx.fillStyle = "rgba(10,6,10,0.65)";
          var label = h.p.site || "#" + h.p.id;
          var tw = ctx.measureText(label).width;
          ctx.fillRect(lp.x - tw / 2 - 3, lp.y - 11, tw + 6, 14);
          ctx.fillStyle = h.biz ? "#bcd0ff" : "#ffe7c2";
          ctx.fillText(label, lp.x, lp.y);
        }
      }
      var r = h.r;
      if (r) {
        var sp = project(r.x, r.y, 1.0, cam);
        if (sp) {
          var rad = Math.max(2, 30 / sp.z);
          ctx.fillStyle = "hsl(" + r.hue + ",55%,58%)";
          ctx.beginPath(); ctx.arc(sp.x, sp.y, rad, 0, Math.PI * 2); ctx.fill();
          var hp = project(r.x, r.y, 1.9, cam);
          if (hp) { ctx.fillStyle = "#f1d2b6"; ctx.beginPath(); ctx.arc(hp.x, hp.y, rad * 0.6, 0, Math.PI * 2); ctx.fill(); }
          if (Math.hypot(r.x - player.x, r.y - player.y) < 22 && hp) {
            ctx.font = "11px Bahnschrift, sans-serif"; ctx.textAlign = "center"; ctx.fillStyle = "#fff";
            ctx.fillText(r.name, hp.x, hp.y - rad - 3);
          }
        }
      }
    });
  }

  function start() {
    canvas = $("hm-canvas");
    if (!canvas) return;
    ctx = canvas.getContext("2d");
    resize();
    if (!running) {
      running = true;
      lastT = performance.now();
      raf = requestAnimationFrame(loop);
    }
    if (!ready) loadOsm();
    else hud();
    if (!h3dLoading && !window.Houma3D) {
      h3dLoading = import(H3D_URL).catch(function (e) { console.warn("Houma 3D unavailable, using 2D", e); });
    }
  }

  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  function bind() {
    if (document.body.dataset.hmBound) return;
    document.body.dataset.hmBound = "1";
    gpsUI();
    window.addEventListener("keydown", function (e) {
      if (!worldKeysActive(e)) { keys = {}; return; }
      onKey(e, true);
    });
    window.addEventListener("keyup", function (e) {
      if (isTypingTarget(e.target)) return;
      onKey(e, false);
    });
    window.addEventListener("blur", function () { keys = {}; });
    window.addEventListener("resize", function () {
      if (running) resize();
    });
    window.addEventListener("houma-show", start);
    window.addEventListener("houma-hide", stop);
    $("hm-reset") &&
      $("hm-reset").addEventListener("click", function () {
        if (ready) spawnWorld();
      });
    $("hm-tour-btn") && $("hm-tour-btn").addEventListener("click", function () {
      toast("Follow the green signs. This map is OpenStreetMap Houma, not cubes.");
    });
  }

  function init() {
    if (!$("panel-houma")) return;
    bind();
    if (location.hash.replace("#", "") === "houma") start();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  function goTo(pid) {
    var h = null;
    homes.forEach(function (x) { if (x.p.id === String(pid)) h = x; });
    if (!h || !player) return false;
    if (player.veh) { player.veh.v = 0; player.veh = null; }
    player.x = h.x + 9; player.y = h.y + 9; player.a = Math.atan2(h.y - player.y, h.x - player.x); player.v = 0;
    toast((h.r ? h.r.name + "'s place — " : h.p.owner + " — ") + (h.p.site || "parcel " + h.p.id));
    return true;
  }
  // ---- GPS: "Drive to" any street / property address, A* over the real road graph, turn-by-turn guidance
  var G = { adj: [], xs: [], ys: [], segs: new Map(), keyN: new Map() }, route = null, routeVer = 0, gpsDest = null, gpsIdx = { streets: [], addrs: [] }, gpsT = 0;
  var GS = 30;
  function gNode(x, y) { var k = Math.round(x * 2) + "," + Math.round(y * 2), n = G.keyN.get(k); if (n != null) return n; n = G.xs.length; G.xs.push(x); G.ys.push(y); G.adj.push([]); G.keyN.set(k, n); return n; }
  function gSegAdd(sg) { var x0 = Math.floor(Math.min(G.xs[sg.u], G.xs[sg.v]) / GS), x1 = Math.floor(Math.max(G.xs[sg.u], G.xs[sg.v]) / GS), y0 = Math.floor(Math.min(G.ys[sg.u], G.ys[sg.v]) / GS), y1 = Math.floor(Math.max(G.ys[sg.u], G.ys[sg.v]) / GS), i, j; for (i = x0; i <= x1; i++) for (j = y0; j <= y1; j++) { var k = i * 100003 + j, L = G.segs.get(k); if (!L) G.segs.set(k, (L = [])); L.push(sg); } }
  function gLink(a, b, name, one) { var d = Math.hypot(G.xs[a] - G.xs[b], G.ys[a] - G.ys[b]) + 0.01; G.adj[a].push([b, d, name]); if (!one) G.adj[b].push([a, d, name]); }
  function gUnlink(a, b) { G.adj[a] = G.adj[a].filter(function (e) { return e[0] !== b; }); }
  function gNearestSeg(x, y, R, skipName) {
    var best = null, bd = R, r = Math.ceil(R / GS), ci = Math.floor(x / GS), cj = Math.floor(y / GS), i, j;
    for (i = ci - r; i <= ci + r; i++) for (j = cj - r; j <= cj + r; j++) { var L = G.segs.get(i * 100003 + j); if (!L) continue; L.forEach(function (sg) { if (sg.dead || sg.road === skipName) return; var ax = G.xs[sg.u], ay = G.ys[sg.u], dx = G.xs[sg.v] - ax, dy = G.ys[sg.v] - ay, l2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)), px = ax + dx * t, py = ay + dy * t, d = Math.hypot(x - px, y - py); if (d < bd) { bd = d; best = { sg: sg, x: px, y: py, d: d, t: t }; } }); }
    return best;
  }
  // split a segment at a point, returning the new node
  function gSplit(h) {
    var sg = h.sg; if (h.t < 0.02) return sg.u; if (h.t > 0.98) return sg.v;
    var n = gNode(h.x, h.y); sg.dead = true; gUnlink(sg.u, sg.v); gUnlink(sg.v, sg.u);
    var a = { u: sg.u, v: n, name: sg.name, one: sg.one, road: sg.road }, b = { u: n, v: sg.v, name: sg.name, one: sg.one, road: sg.road };
    gLink(sg.u, n, sg.name, sg.one); gLink(n, sg.v, sg.name, sg.one); gSegAdd(a); gSegAdd(b); return n;
  }
  function buildGraph() {
    G = { adj: [], xs: [], ys: [], segs: new Map(), keyN: new Map() };
    var ends = [];
    osm.roads.forEach(function (f, ri) {
      if (!f.p || f.p.length < 2) return; var prev = gNode(f.p[0][0], f.p[0][1]), first = prev, i;
      for (i = 1; i < f.p.length; i++) { var n = gNode(f.p[i][0], f.p[i][1]); if (n === prev) continue; gLink(prev, n, f.n || f.r || "", !!f.one); gSegAdd({ u: prev, v: n, name: f.n || f.r || "", one: !!f.one, road: ri }); prev = n; }
      ends.push([first, ri], [prev, ri]);
    });
    // stitch dead ends (parish centerlines meeting OSM highways, small digitizing gaps) onto the nearest other road
    ends.forEach(function (e) {
      var n = e[0]; if (G.adj[n].length > 1) return; var inc = 0; G.adj.forEach && null; // degree check is approximate for one-way ends
      var h = gNearestSeg(G.xs[n], G.ys[n], 22, e[1]); if (!h) return; var m = gSplit(h); if (m !== n) gLink(n, m, "", false); void inc;
    });
  }
  function gSnap(x, y) { var h = gNearestSeg(x, y, 400, -1); return h ? gSplit(h) : null; }
  function astar(s, t) {
    var N = G.xs.length, gs = new Float64Array(N).fill(Infinity), from = new Int32Array(N).fill(-1), heap = [[0, s]], tx = G.xs[t], ty = G.ys[t], closed = new Uint8Array(N);
    gs[s] = 0;
    function push(it) { heap.push(it); var i = heap.length - 1; while (i > 0) { var p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; var tmp = heap[p]; heap[p] = heap[i]; heap[i] = tmp; i = p; } }
    function pop() { var top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; var i = 0; for (;;) { var l = 2 * i + 1, r = l + 1, m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; var tmp = heap[m]; heap[m] = heap[i]; heap[i] = tmp; i = m; } } return top; }
    var it = 0;
    while (heap.length && it++ < 400000) {
      var cur = pop()[1]; if (cur === t) break; if (closed[cur]) continue; closed[cur] = 1;
      G.adj[cur].forEach(function (e) { var ng = gs[cur] + e[1]; if (ng < gs[e[0]]) { gs[e[0]] = ng; from[e[0]] = cur; push([ng + Math.hypot(G.xs[e[0]] - tx, G.ys[e[0]] - ty), e[0]]); } });
    }
    if (from[t] < 0 && s !== t) return null;
    var path = [t]; while (path[0] !== s) path.unshift(from[path[0]]);
    return { nodes: path, len: gs[t] };
  }
  function edgeName(a, b) { var L = G.adj[a], i; for (i = 0; i < L.length; i++) if (L[i][0] === b) return L[i][2]; return ""; }
  function planRoute() {
    if (!gpsDest || !player || !G.xs.length) return;
    var s = gSnap(player.x, player.y), t = gpsDest.node != null ? gpsDest.node : (gpsDest.node = gSnap(gpsDest.x, gpsDest.y));
    if (s == null || t == null) { toast("No road near the destination."); return; }
    var r = astar(s, t); if (!r) { toast("No drivable route found to " + gpsDest.label + "."); route = null; return; }
    var pts = r.nodes.map(function (n) { return [G.xs[n], G.ys[n]]; }), names = [], i, turns = [];
    for (i = 0; i < r.nodes.length - 1; i++) names.push(edgeName(r.nodes[i], r.nodes[i + 1]));
    var acc = [0]; for (i = 1; i < pts.length; i++) acc.push(acc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    for (i = 1; i < pts.length - 1; i++) {
      var a1 = Math.atan2(pts[i][1] - pts[i - 1][1], pts[i][0] - pts[i - 1][0]), j = i + 1;
      while (j < pts.length - 1 && acc[j] - acc[i] < 12) j++;
      var a2 = Math.atan2(pts[j][1] - pts[i][1], pts[j][0] - pts[i][0]), d = Math.atan2(Math.sin(a2 - a1), Math.cos(a2 - a1)) * 180 / Math.PI;
      var nameChange = names[i] && names[i] !== names[i - 1];
      if (Math.abs(d) > 35 || (nameChange && Math.abs(d) > 12)) {
        var dir = Math.abs(d) < 45 ? (d > 0 ? "Bear right" : "Bear left") : Math.abs(d) > 150 ? "Make a U-turn" : d > 0 ? "Turn right" : "Turn left"; // +y is south, so positive angle = clockwise = right
        if (turns.length && acc[i] - turns[turns.length - 1].at < 15) continue;
        turns.push({ i: i, at: acc[i], x: pts[i][0], y: pts[i][1], dir: dir, onto: names[i] || "" });
      }
    }
    route = { pts: pts, acc: acc, turns: turns, len: acc[acc.length - 1], cost: r.len, names: names, k: 0 }; routeVer++;
  }
  // ---- Auto-drive: pure-pursuit along the GPS polyline with a curvature/bridge/arrival speed profile
  var autoPark = null, auto = false, autoMsg = "", autoStuck = 0, autoRev = 0, autoArrT = 0;
  function setAuto(on, msg) {
    if (on && !route) { toast("Pick a 'Drive to' destination first."); on = false; }
    if (on && !player.veh) { tryEnter(); if (!player.veh) { toast("Get in a car to use auto-drive."); on = false; } }
    auto = on; autoMsg = msg || (on ? "Auto-drive ON" : "Auto-drive off"); autoStuck = 0; autoRev = 0;
    if (on) toast("Auto-drive engaged. Press any steering/gas/brake key to take over.");
    else if (msg) toast(msg);
    autoUI();
  }
  function autoUI() {
    var b = $("hm-auto"), st = $("hm-auto-st"); if (!b) return;
    b.hidden = !route && !auto; b.textContent = auto ? "■ Stop auto-drive" : "▶ Auto-drive"; b.classList.toggle("on", auto);
    st.hidden = !autoMsg; st.textContent = autoMsg; st.className = "hm-auto-st" + (auto ? " on" : "");
  }
  function onDeck(x, y) { var H3 = window.Houma3D; return !!(H3 && H3.deckY && Math.max(H3.deckY(x, y, 0), H3.deckY(x, y, 12)) > 0.5); }
  function autoCtl(ent, dt) {
    var v = Math.max(0, ent.v);
    if (!route) { // arrived (or route cleared): brake to a smooth stop
      var st = 0;
      if (autoPark) { // pull over to the right-hand curb: steer onto a point ahead and to the right, straighten as we stop
        var dx = autoPark.x - ent.x, dy = autoPark.y - ent.y, fwd = dx * Math.cos(autoPark.a) + dy * Math.sin(autoPark.a);
        var aim = fwd > 4 ? Math.atan2(dy, dx) : autoPark.a, df = aim - ent.a; while (df > Math.PI) df -= Math.PI * 2; while (df < -Math.PI) df += Math.PI * 2;
        st = Math.max(-1, Math.min(1, df * 2.5)); if (fwd < 1) autoPark = null;
      }
      if (v < 0.3) { ent.v = 0; autoPark = null; if (auto && autoArrT <= 0) { auto = false; autoUI(); } return [0, 0]; }
      return [v > 6 ? -0.5 : -0.25, st];
    }
    if (autoRev > 0) { autoRev -= dt; return [-0.5, 0]; } // backing off an obstacle
    var P = route.pts, A = route.acc, k = route.k || 0, i;
    // project onto the segment ahead of the nearest vertex for a continuous arc-length position
    var s0 = A[k];
    if (k < P.length - 1) { var ex = P[k + 1][0] - P[k][0], ey = P[k + 1][1] - P[k][1], L2 = ex * ex + ey * ey || 1, u = ((ent.x - P[k][0]) * ex + (ent.y - P[k][1]) * ey) / L2; if (u > 0) s0 += Math.min(1, u) * Math.sqrt(L2); }
    function at(s) { s = Math.min(s, route.len); var j = k; while (j < P.length - 2 && A[j + 1] < s) j++; var sl = A[j + 1] - A[j] || 1, f = Math.max(0, Math.min(1, (s - A[j]) / sl)); return [P[j][0] + (P[j + 1 < P.length ? j + 1 : j][0] - P[j][0]) * f, P[j][1] + (P[j + 1 < P.length ? j + 1 : j][1] - P[j][1]) * f]; }
    var look = 7 + v * 0.55, tg = at(s0 + look);
    var diff = Math.atan2(tg[1] - ent.y, tg[0] - ent.x) - ent.a;
    while (diff > Math.PI) diff -= Math.PI * 2; while (diff < -Math.PI) diff += Math.PI * 2;
    // pure pursuit: curvature = 2 sin(alpha)/Ld, steer = needed yaw rate / available yaw rate
    var rate = 1.8 / (1 + v / 18), need = v * 2 * Math.sin(diff) / look;
    var steer = Math.max(-1, Math.min(1, v > 1 ? need / rate : diff * 3));
    // speed profile: corners ahead (heading change over short windows), bridges, destination
    var vt = 44.7, horizon = v * v / 6 + 40, BR = 3.2;
    for (var d = 0; d < horizon; d += 8) {
      var a1 = at(s0 + d), a2 = at(s0 + d + 12), a3 = at(s0 + d + 24);
      var h1 = Math.atan2(a2[1] - a1[1], a2[0] - a1[0]), h2 = Math.atan2(a3[1] - a2[1], a3[0] - a2[0]), th = Math.abs(h2 - h1);
      if (th > Math.PI) th = Math.PI * 2 - th;
      // heading change th over ~24 m -> radius ~24/th; corner speed sqrt(a_lat * R) with a_lat ~4.5 m/s^2 (8 m/s at 90 deg, ~20 at 15 deg)
      var vc = th < 0.03 ? 44.7 : Math.max(6.5, Math.min(44.7, Math.sqrt(4.5 * 22 / th)));
      if (onDeck(a2[0], a2[1])) vc = Math.min(vc, 20); // ~45 mph on bridges and their ramps
      vt = Math.min(vt, Math.sqrt(vc * vc + 2 * BR * d));
    }
    var dl = Math.min(route.len - s0, gpsDest ? Math.hypot(gpsDest.x - ent.x, gpsDest.y - ent.y) - 26 : 1e9);
    vt = Math.min(vt, Math.sqrt(2 * 2.5 * Math.max(0, dl - 2)) + (dl > 4 ? 2 : 0));
    if (Math.abs(diff) > 1.2) vt = Math.min(vt, 5);
    // obstacle look-ahead (buildings / trees via the 3D hit test, off-road tiles): brake
    var H3 = window.Houma3D, dist = 3 + v * 0.8;
    if (H3 && H3.hitBldg && (ent._z || 0) < 0.9 && H3.hitBldg(ent.x + Math.cos(ent.a) * dist, ent.y + Math.sin(ent.a) * dist, 1.2)) vt = Math.min(vt, 4);
    var thr = v < vt - 0.8 ? Math.min(1, (vt - v) / 3 + 0.3) : v > vt + 1.5 ? -0.5 : 0;
    // stuck recovery: pinned against something while asking for gas
    if (thr > 0 && v < 0.5) { autoStuck += dt; if (autoStuck > 1.5) { autoStuck = 0; autoRev = 1.2; } } else autoStuck = 0;
    return [thr, steer];
  }
  function fmtD(m) { return m < 950 ? Math.max(10, Math.round(m / 10) * 10) + " m" : (m / 1609.34).toFixed(1) + " mi"; }
  function gpsUpdate(dt) {
    var el = $("hm-gps-turn"); if (!el) return;
    autoUI();
    if (!route || !gpsDest) { if (!auto && !/Arrived/.test(el.innerHTML)) el.hidden = true; return; }
    if (auto && !player.veh) setAuto(false, "Auto-drive off — left the car");
    gpsT += dt;
    // progress: nearest route vertex ahead of the last one
    var best = route.k, bd = 1e9, i, P = route.pts;
    for (i = Math.max(0, route.k - 3); i < Math.min(P.length, route.k + 60); i++) { var d = Math.hypot(P[i][0] - player.x, P[i][1] - player.y); if (d < bd) { bd = d; best = i; } }
    route.k = best;
    var left = routeLeft(); // single source of truth: geometric length along the drawn route
    if (Math.hypot(gpsDest.x - player.x, gpsDest.y - player.y) < 30 || (best >= P.length - 2 && bd < 30)) { el.hidden = false; el.innerHTML = "<b>Arrived</b> · " + esc(gpsDest.label); if (auto) { autoMsg = "Arrived — auto-drive finished"; toast("Arrived at " + gpsDest.label + "."); autoArrT = 0; if (player.veh) { var c = player.veh, ca = Math.cos(c.a), sa = Math.sin(c.a), lead = Math.max(10, Math.min(22, c.v * c.v / 5 + 8)), px_ = c.x + ca * lead - sa * 2.4, py_ = c.y + sa * lead + ca * 2.4; autoPark = canMove(px_, py_, "car") && canMove(c.x + ca * lead * 0.5 - sa * 1.2, c.y + sa * lead * 0.5 + ca * 1.2, "car") ? { x: px_, y: py_, a: c.a } : null; } } route = null; routeVer++; gpsDest = null; return; }
    if (bd > 35 && gpsT > 2) { gpsT = 0; planRoute(); return; } // off route: reroute along the real streets from here
    var nt = null; for (i = 0; i < route.turns.length; i++) if (route.turns[i].i > best) { nt = route.turns[i]; break; }
    var cur = route.names[Math.min(route.names.length - 1, best)] || "";
    el.hidden = false;
    el.innerHTML = nt ? "<span class='hm-gps-arrow'>" + (/U-turn/.test(nt.dir) ? "⮌" : /right/.test(nt.dir) ? (/Bear/.test(nt.dir) ? "↗" : "➜") : (/Bear/.test(nt.dir) ? "↖" : "⬅")) + "</span> In " + fmtD(Math.min(left, route.acc[nt.i] - route.acc[best])) + " <b>" + nt.dir.toLowerCase().replace(/^./, function (c) { return c.toUpperCase(); }) + "</b>" + (nt.onto ? " onto " + esc(nt.onto) : "") + "<small>" + esc(gpsDest.label) + " · " + fmtD(left) + " left</small>"
      : "<span class='hm-gps-arrow'>⬆</span> Continue" + (cur ? " on " + esc(cur) : "") + " · " + fmtD(left) + "<small>" + esc(gpsDest.label) + "</small>";
  }
  // the one remaining-distance figure every GPS readout uses: route length past the route vertex nearest the player
  function routeLeft() { if (!route) return 0; var P = route.pts, best = route.k || 0, bd = 1e9; for (var i = Math.max(0, best - 3); i < Math.min(P.length, best + 60); i++) { var d = Math.hypot(P[i][0] - player.x, P[i][1] - player.y); if (d < bd) { bd = d; best = i; } } route.k = best; route.left = route.len - route.acc[best]; return route.left; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function normSt(s) { return String(s || "").toUpperCase().replace(/\s+/g, " ").trim(); }
  window.addEventListener("houma-parcels", function (e) { if (ready && homes.length) gpsIndex(e.detail); });
  function gpsIndex(d) {
    var st = {}, addrs = [];
    osm.roads.forEach(function (f) { var n = f.n || f.r; if (!n) return; var k = normSt(n); (st[k] = st[k] || { label: n, roads: [] }).roads.push(f); if (f.r && f.n) { var k2 = normSt(f.r); (st[k2] = st[k2] || { label: f.r + " (" + f.n + ")", roads: [] }).roads.push(f); } });
    var seenA = {};
    (d && d.parcels || []).forEach(function (p) {
      // parish-wide shards (table's "whole parish" filter) can include records off the 3D map or without coordinates: only index drivable ones
      var xy = p.lat != null && p.lon != null ? llToXY(p.lat, p.lon) : null;
      var onMap = xy && xy[0] >= X0 && xy[0] <= X1 && xy[1] >= Y0 && xy[1] <= Y1;
      if (p.street && (onMap || p.city !== "PARISH")) { var k = normSt(p.street); if (!st[k]) st[k] = { label: titleCase(p.street), roads: [], prop: true }; }
      if (p.site && onMap) { var ka = normSt(p.site); if (!seenA[ka]) { seenA[ka] = 1; addrs.push({ label: titleCase(p.site), id: p.id, lat: p.lat, lon: p.lon }); } }
    });
    gpsIdx.streets = Object.keys(st).map(function (k) { var o = st[k]; o.key = k; return o; }).sort(function (a, b) { return a.label < b.label ? -1 : 1; });
    gpsIdx.addrs = addrs;
  }
  function gpsPick(item) {
    var x, y;
    if (item.roads) {
      var roadsFor = item.roads.length ? item.roads : osm.roads.filter(function (f) { return normSt(f.n).indexOf(item.key.replace(/ (ST|RD|AVE|DR|LN|BLVD|CT|HWY)$/, "")) === 0; });
      var bd = 1e12; roadsFor.forEach(function (f) { f.p.forEach(function (q) { var dd = Math.hypot(q[0] - player.x, q[1] - player.y); if (dd < bd) { bd = dd; x = q[0]; y = q[1]; } }); });
      if (x == null) { toast("That street (" + item.label + ") isn't in the road network yet."); return; }
    } else {
      var h = null; homes.forEach(function (o) { if (o.p.id === item.id) h = o; });
      if (h) { x = h.x; y = h.y; } else if (item.lat != null) { var q = llToXY(item.lat, item.lon); x = q[0]; y = q[1]; }
      if (x == null) return;
    }
    gpsDest = { x: x, y: y, label: item.label, node: null }; gpsT = 0; planRoute();
    if (route) { routeLeft(); toast("Route to " + item.label + " set: follow the blue line (distance shown in the GPS panel)."); }
  }
  function gpsUI() {
    var stage = $("hm-stage"); if (!stage || $("hm-gps")) return;
    var box = document.createElement("div"); box.className = "hm-gps"; box.id = "hm-gps";
    box.innerHTML = "<div class='hm-gps-row'><input id='hm-gps-q' type='search' autocomplete='off' placeholder='Drive to: street or address…' aria-label='Drive to street or address'><button type='button' id='hm-gps-x' title='Clear route'>✕</button></div><div id='hm-gps-list' class='hm-gps-list' role='listbox'></div><div id='hm-gps-turn' class='hm-gps-turn' hidden></div><div class='hm-gps-row hm-auto-row'><button type='button' id='hm-auto' hidden title='Let the car drive itself along the GPS route'>▶ Auto-drive</button><span id='hm-auto-st' class='hm-auto-st' hidden></span></div>";
    stage.appendChild(box);
    var q = $("hm-gps-q"), list = $("hm-gps-list"), cur = [];
    function render() {
      var t = normSt(q.value); list.innerHTML = ""; cur = [];
      if (t.length < 2) return;
      gpsIdx.streets.forEach(function (s) { if (cur.length < 8 && s.key.indexOf(t) >= 0) cur.push(s); });
      for (var i = 0; i < gpsIdx.addrs.length && cur.length < 14; i++) if (normSt(gpsIdx.addrs[i].label).indexOf(t) >= 0) cur.push(gpsIdx.addrs[i]);
      cur.forEach(function (it) { var b = document.createElement("button"); b.type = "button"; b.textContent = (it.roads ? "🛣 " : "🏠 ") + it.label; b.addEventListener("click", function () { choose(it); }); list.appendChild(b); });
    }
    function choose(it) { q.value = it.label; list.innerHTML = ""; q.blur(); gpsPick(it); }
    q.addEventListener("input", render);
    q.addEventListener("keydown", function (e) { e.stopPropagation(); if (e.key === "Enter" && cur[0]) { e.preventDefault(); choose(cur[0]); } if (e.key === "Escape") { list.innerHTML = ""; q.blur(); } });
    q.addEventListener("keyup", function (e) { e.stopPropagation(); });
    $("hm-auto").addEventListener("click", function () { setAuto(!auto, auto ? "Auto-drive off" : ""); this.blur(); });
    $("hm-gps-x").addEventListener("click", function () { if (auto) setAuto(false, "Auto-drive off — route cleared"); gpsDest = null; route = null; routeVer++; q.value = ""; list.innerHTML = ""; $("hm-gps-turn").hidden = true; });
  }
  function drawRouteMini(mx, my, mw, mh, x0, y0, span) {
    if (!route) return;
    var sx = mw / (span * 2), sy = mh / (span * 2), i;
    ctx.save(); ctx.beginPath(); ctx.rect(mx, my, mw, mh); ctx.clip();
    ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.beginPath();
    ctx.moveTo(mx + (player.x - x0) * sx, my + (player.y - y0) * sy);
    for (i = route.k || 0; i < route.pts.length; i++) ctx.lineTo(mx + (route.pts[i][0] - x0) * sx, my + (route.pts[i][1] - y0) * sy);
    ctx.strokeStyle = "rgba(0,30,60,0.85)"; ctx.lineWidth = 6; ctx.stroke();
    ctx.strokeStyle = "#35d0ff"; ctx.lineWidth = 3.5; ctx.stroke();
    if (gpsDest) { var dx = mx + (gpsDest.x - x0) * sx, dy = my + (gpsDest.y - y0) * sy; ctx.fillStyle = "#ffd23a"; ctx.beginPath(); ctx.arc(Math.max(mx + 4, Math.min(mx + mw - 4, dx)), Math.max(my + 4, Math.min(my + mh - 4, dy)), 4, 0, 7); ctx.fill(); }
    ctx.restore();
  }
  function state() {
    return {
      player: player, cars: cars, peds: peds, homes: homes, residents: residents, osm: osm, T: T,
      worldT: worldT, nearBuckets: nearBuckets, gis: function () { return gis; }, bounds: function () { return [X0, Y0, X1, Y1]; },
      camMode: function () { return camMode; },
      ready: function () { return ready && !!player; },
      homesReady: function () { return homes.length; },
      route: function () { return route; }, auto: function () { return { on: auto, msg: autoMsg }; }, setAuto: function (on) { setAuto(on); return auto; }, routeVer: function () { return routeVer; }, gpsTo: function (label) { var t = normSt(label), it = null; gpsIdx.streets.forEach(function (s) { if (!it && s.key === t) it = s; }); if (!it) gpsIdx.addrs.forEach(function (a) { if (!it && normSt(a.label) === t) it = a; }); if (it) gpsPick(it); return !!route; },
    };
  }
  window.Houma = { onShow: start, onHide: stop, goTo: goTo, setKey: function (k, d) { keys[k] = !!d; }, step: function (dt) { update(dt); }, sim: function (dt) { update(dt); gpsUpdate(dt); }, homesReady: function () { return homes.length; }, state: state };
})();
