/**
 * Houma — third-person drive on real OpenStreetMap geometry.
 * Google Earth imagery can't be copied. OSM streets/water/footprints can.
 */
(function () {
  "use strict";

  var CELL = 8;
  var ORIGIN = 2200;
  var COLS = 560;
  var ROWS = 560;
  var T = { GRASS: 0, WATER: 1, ROAD: 2, PARK: 3, BLDG: 4 };

  var grid = null;
  var osm = { roads: [], water: [], buildings: [], parking: [] };
  var streetSigns = [];
  var player = null;
  var cars = [];
  var peds = [];
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
    return ((x + ORIGIN) / CELL) | 0;
  }
  function wyToC(y) {
    return ((y + ORIGIN) / CELL) | 0;
  }
  function cToWx(c) {
    return c * CELL - ORIGIN;
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
      else stampLine(f.p, 14, T.WATER);
    });
    osm.roads.forEach(function (f) {
      var w = f.h === "primary" || f.h === "secondary" ? 9 : f.h === "residential" ? 6 : 5;
      stampLine(f.p, w, T.ROAD);
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
    var ride = spawnCar("sedan", sp[0], sp[1], ang, "#2a2c30");
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
    if (driven) {
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
      throttle = 0.4;
    }
    ent.v += (throttle * acc - ent.v * 2.2) * dt;
    ent.v = Math.max(-maxV * 0.35, Math.min(maxV, ent.v));
    if (Math.abs(ent.v) > 0.4) ent.a += steer * 1.8 * dt * (ent.v >= 0 ? 1 : -1);
    var t = worldT(ent.x + Math.cos(ent.a) * 3, ent.y + Math.sin(ent.a) * 3);
    var scale = mode === "foot" && t === T.WATER ? 0.35 : 1;
    var nx = ent.x + Math.cos(ent.a) * ent.v * dt * scale;
    var ny = ent.y + Math.sin(ent.a) * ent.v * dt * scale;
    if (canMove(nx, ent.y, mode)) ent.x = nx;
    else ent.v *= 0.25;
    if (canMove(ent.x, ny, mode)) ent.y = ny;
    else ent.v *= 0.25;
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
      moveEntity(player.veh, dt, player.veh.boat ? "boat" : "car", player.veh.kind === "truck" ? 22 : 26, 18);
      player.x = player.veh.x;
      player.y = player.veh.y;
      player.a = player.veh.a;
    } else {
      moveEntity(player, dt, "foot", 5.2, 14);
    }
    cars.forEach(function (c) {
      if (c === player.veh) return;
      moveEntity(c, dt, c.boat ? "boat" : "car", 12, 8);
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
    updateMissions();
    hud();
  }

  function hud() {
    if ($("hm-stars")) $("hm-stars").textContent = wanted ? "★".repeat(wanted) + "☆".repeat(5 - wanted) : "☆☆☆☆☆";
    if ($("hm-cash")) $("hm-cash").textContent = "$" + Math.floor(money);
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
    if (ready) update(dt);
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

  function onKey(e, down) {
    var k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    keys[k] = down;
    if (down && (k === "f" || k === "e")) {
      tryEnter();
      e.preventDefault();
    }
    if (down && k === "c") {
      camMode = camMode ? 0 : 1;
      toast(camMode ? "Street cam." : "Follow cam.");
    }
  }

  function loadOsm() {
    toast("Loading real Houma streets…");
    return fetch("data/houma-osm.json?v=1")
      .then(function (r) {
        if (!r.ok) throw new Error("osm " + r.status);
        return r.json();
      })
      .then(function (data) {
        ingest(data);
        spawnWorld();
        ready = true;
        toast("OpenStreetMap Houma — " + osm.roads.length + " streets, " + osm.buildings.length + " footprints.");
      })
      .catch(function (err) {
        toast("Could not load OSM: " + (err && err.message));
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
  }

  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  function bind() {
    if (document.body.dataset.hmBound) return;
    document.body.dataset.hmBound = "1";
    window.addEventListener("keydown", function (e) {
      if (document.body.getAttribute("data-active-tab") !== "houma") return;
      onKey(e, true);
    });
    window.addEventListener("keyup", function (e) {
      onKey(e, false);
    });
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

  window.Houma = { onShow: start, onHide: stop };
})();
