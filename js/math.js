/**
 * Math — a point cloud you shape.
 * Range sets the domain, Create drops a geometry, Sculpt moves points,
 * and a function bends whatever is there.
 */
(function () {
  "use strict";

  var SHAPES = [
    { id: "sheet", name: "Sheet" },
    { id: "sphere", name: "Sphere" },
    { id: "torus", name: "Torus" },
    { id: "helix", name: "Helix" },
  ];
  var FUNCTIONS = [
    { id: "flat", name: "Flat" },
    { id: "ripple", name: "Ripple" },
    { id: "saddle", name: "Saddle" },
    { id: "piecewise", name: "Piecewise" },
    { id: "twist", name: "Twist" },
  ];
  var TOOLS = [
    { id: "orbit", name: "Orbit" },
    { id: "push", name: "Push" },
    { id: "pull", name: "Pull" },
    { id: "smooth", name: "Smooth" },
  ];

  var shape = "sheet";
  var fnId = "ripple";
  var tool = "orbit";
  var range = { x0: -2, x1: 2, z0: -2, z1: 2, n: 24 };
  var fn = { a: 0.7, b: 1.4, cut: 0 };
  var brush = { radius: 64, strength: 0.45 };
  var samples = [];
  var sculpt = [];
  var points = [];
  var raf = 0;
  var built = false;
  var gaugeRows = {};
  var view = { yaw: 0.78, pitch: 0.58, dist: 4.6, drag: null };

  function $(id) {
    return document.getElementById(id);
  }

  function num(n) {
    if (!isFinite(n)) return "—";
    var v = Math.round(n * 100) / 100;
    if (Object.is(v, -0)) v = 0;
    return String(v);
  }

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }

  function spanX() {
    return Math.max(0.4, range.x1 - range.x0);
  }

  function spanZ() {
    return Math.max(0.4, range.z1 - range.z0);
  }

  function midX() {
    return (range.x0 + range.x1) / 2;
  }

  function midZ() {
    return (range.z0 + range.z1) / 2;
  }

  function heightAt(x, z) {
    if (fnId === "ripple") return fn.a * Math.sin(fn.b * x) * Math.cos(fn.b * z);
    if (fnId === "saddle") return fn.a * x * x - fn.b * z * z;
    if (fnId === "piecewise") {
      return x < fn.cut ? fn.a * Math.sin(x) : fn.b * (x - fn.cut) * (x - fn.cut);
    }
    return 0;
  }

  function place(sample) {
    var u = sample.u;
    var v = sample.v;
    if (shape === "sphere") {
      var rx = spanX() / 2;
      var rz = spanZ() / 2;
      var ry = Math.min(rx, rz);
      var phi = u * Math.PI;
      var theta = v * Math.PI * 2;
      return {
        x: midX() + rx * Math.sin(phi) * Math.cos(theta),
        y: ry * Math.cos(phi),
        z: midZ() + rz * Math.sin(phi) * Math.sin(theta),
      };
    }
    if (shape === "torus") {
      var ring = Math.min(spanX(), spanZ()) * 0.28;
      var tube = ring * 0.42;
      var th = u * Math.PI * 2;
      var ph = v * Math.PI * 2;
      return {
        x: midX() + (ring + tube * Math.cos(ph)) * Math.cos(th),
        y: tube * Math.sin(ph),
        z: midZ() + (ring + tube * Math.cos(ph)) * Math.sin(th),
      };
    }
    if (shape === "helix") {
      var turns = 3;
      var ang = u * turns * Math.PI * 2;
      var rad = Math.min(spanX(), spanZ()) * (0.16 + 0.2 * v);
      return {
        x: midX() + rad * Math.cos(ang),
        y: range.z0 + spanZ() * u,
        z: midZ() + rad * Math.sin(ang),
      };
    }
    return {
      x: range.x0 + spanX() * u,
      y: 0,
      z: range.z0 + spanZ() * v,
    };
  }

  function applyFn(p) {
    var h = heightAt(p.x, p.z);
    var x = p.x;
    var y = p.y;
    var z = p.z;
    if (shape === "sphere" || shape === "torus") {
      var ox = x - midX();
      var oy = y;
      var oz = z - midZ();
      var len = Math.hypot(ox, oy, oz) || 1;
      x += (ox / len) * h * 0.55;
      y += (oy / len) * h * 0.55;
      z += (oz / len) * h * 0.55;
    } else {
      y += h;
    }
    if (fnId === "twist") {
      var ang = fn.a * y;
      var c = Math.cos(ang);
      var s = Math.sin(ang);
      var x2 = x * c - z * s;
      z = x * s + z * c;
      x = x2;
    }
    return { x: x, y: y, z: z };
  }

  function colorFor(y, moved) {
    var t = clamp((y + 1.4) / 2.8, 0, 1);
    var rgb = [
      Math.round(70 + t * 185),
      Math.round(150 - Math.abs(t - 0.45) * 80),
      Math.round(214 - t * 150),
    ];
    if (moved) {
      rgb[0] = Math.min(255, rgb[0] + 80);
      rgb[1] = Math.min(255, rgb[1] + 36);
      rgb[2] = Math.max(0, rgb[2] - 24);
    }
    return rgb;
  }

  function moved(offset) {
    return Math.hypot(offset.dx, offset.dy, offset.dz) > 0.02;
  }

  function compose() {
    points = samples.map(function (sample, index) {
      var p = applyFn(place(sample));
      var offset = sculpt[index] || { dx: 0, dy: 0, dz: 0 };
      p.x += offset.dx;
      p.y += offset.dy;
      p.z += offset.dz;
      p.rgb = colorFor(p.y, moved(offset));
      p.sx = 0;
      p.sy = 0;
      return p;
    });
    paintReadout();
  }

  function rebuildSamples() {
    var n = range.n | 0;
    var list = [];
    var i;
    var j;
    if (shape === "helix") {
      var along = n * 4;
      var across = 5;
      for (i = 0; i < along; i++) {
        for (j = 0; j < across; j++) {
          list.push({ u: along === 1 ? 0 : i / (along - 1), v: j / (across - 1) });
        }
      }
    } else {
      for (i = 0; i < n; i++) {
        for (j = 0; j < n; j++) {
          list.push({
            u: n === 1 ? 0.5 : i / (n - 1),
            v: n === 1 ? 0.5 : j / (n - 1),
          });
        }
      }
    }
    samples = list;
    sculpt = list.map(function () {
      return { dx: 0, dy: 0, dz: 0 };
    });
    compose();
  }

  function formulaLines() {
    var lines = [];
    var closed = shape === "sphere" || shape === "torus";
    if (fnId === "flat") lines.push(closed ? "The surface stays the geometry you made." : "y = 0");
    if (fnId === "ripple") {
      lines.push((closed ? "offset = " : "y = ") + num(fn.a) + " sin(" + num(fn.b) + " x) cos(" + num(fn.b) + " z)");
    }
    if (fnId === "saddle") {
      lines.push((closed ? "offset = " : "y = ") + num(fn.a) + " x² − " + num(fn.b) + " z²");
    }
    if (fnId === "piecewise") {
      lines.push((closed ? "offset" : "y") + " = " + num(fn.a) + " sin x    before x = " + num(fn.cut));
      lines.push((closed ? "offset" : "y") + " = " + num(fn.b) + " (x − " + num(fn.cut) + ")²    after");
    }
    if (fnId === "twist") lines.push("rotate x and z by " + num(fn.a) + " × y");
    lines.push("x " + num(range.x0) + " … " + num(range.x1) + "    z " + num(range.z0) + " … " + num(range.z1));
    return lines;
  }

  function sculptedCount() {
    var count = 0;
    var i;
    for (i = 0; i < sculpt.length; i++) if (moved(sculpt[i])) count += 1;
    return count;
  }

  function paintReadout() {
    var title = $("mx-title");
    var found = SHAPES.filter(function (item) { return item.id === shape; })[0];
    if (title) title.textContent = found ? found.name : "Math";
    var count = $("mx-count");
    if (count) count.textContent = points.length.toLocaleString() + " points · " + sculptedCount() + " sculpted";
    var formula = $("mx-formula");
    if (formula) {
      formula.innerHTML = formulaLines().map(function (line) {
        return "<p>" + esc(line) + "</p>";
      }).join("");
    }
    var orbit = $("mx-orbit");
    if (orbit) {
      orbit.textContent = tool === "orbit"
        ? "Drag to orbit. Scroll to move in."
        : "Drag on the cloud to " + tool + ". Scroll still moves in.";
    }
    var canvas = $("mx-cloud");
    if (canvas) canvas.classList.toggle("is-sculpt", tool !== "orbit");
    ["mx-create", "mx-functions", "mx-tools"].forEach(function (id) {
      var host = $(id);
      if (!host) return;
      var buttons = host.querySelectorAll("button");
      var i;
      for (i = 0; i < buttons.length; i++) {
        var on = buttons[i].getAttribute("data-id") === (id === "mx-create" ? shape : id === "mx-functions" ? fnId : tool);
        buttons[i].classList.toggle("is-on", on);
        buttons[i].setAttribute("aria-pressed", on ? "true" : "false");
      }
    });
    if (gaugeRows.a) gaugeRows.a.hidden = fnId === "flat";
    if (gaugeRows.b) gaugeRows.b.hidden = fnId === "flat" || fnId === "twist";
    if (gaugeRows.cut) gaugeRows.cut.hidden = fnId !== "piecewise";
  }

  function keepRange() {
    if (range.x1 < range.x0 + 0.4) range.x1 = range.x0 + 0.4;
    if (range.z1 < range.z0 + 0.4) range.z1 = range.z0 + 0.4;
    range.x0 = clamp(range.x0, -6, 5.6);
    range.x1 = clamp(range.x1, -5.6, 6);
    range.z0 = clamp(range.z0, -6, 5.6);
    range.z1 = clamp(range.z1, -5.6, 6);
    range.n = clamp(Math.round(range.n), 12, 36);
  }

  function project(p, w, h) {
    var cy = Math.cos(view.yaw);
    var sy = Math.sin(view.yaw);
    var cp = Math.cos(view.pitch);
    var sp = Math.sin(view.pitch);
    var x1 = p.x * cy - p.z * sy;
    var z1 = p.x * sy + p.z * cy;
    var y1 = p.y * cp - z1 * sp;
    var z2 = p.y * sp + z1 * cp;
    var f = (Math.min(w, h) * 1.05) / (z2 + view.dist);
    return { sx: w / 2 + x1 * f, sy: h / 2 - y1 * f, depth: z2, rgb: p.rgb };
  }

  function draw() {
    var canvas = $("mx-cloud");
    if (!canvas) return;
    var rect = canvas.getBoundingClientRect();
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = Math.max(2, rect.width);
    var h = Math.max(2, rect.height);
    var bw = Math.round(w * dpr);
    var bh = Math.round(h * dpr);
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    var ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#12110e";
    ctx.fillRect(0, 0, w, h);
    var drawn = [];
    var i;
    var j;
    for (i = -4; i <= 4; i++) {
      for (j = -4; j <= 4; j++) {
        if ((i + j) % 2) continue;
        drawn.push(project({ x: i * 0.55, y: -1.45, z: j * 0.55, rgb: [42, 38, 32] }, w, h));
      }
    }
    for (i = 0; i < points.length; i++) {
      var dot = project(points[i], w, h);
      points[i].sx = dot.sx;
      points[i].sy = dot.sy;
      drawn.push(dot);
    }
    drawn.sort(function (a, b) { return b.depth - a.depth; });
    for (i = 0; i < drawn.length; i++) {
      var size = Math.max(1.8, 78 / (drawn[i].depth + view.dist + 2.4));
      ctx.fillStyle = "rgb(" + drawn[i].rgb[0] + "," + drawn[i].rgb[1] + "," + drawn[i].rgb[2] + ")";
      ctx.fillRect(drawn[i].sx - size / 2, drawn[i].sy - size / 2, size, size);
    }
    [[1.5, 0, 0, "rgba(255,224,138,0.75)"], [0, 1.5, 0, "rgba(183,211,255,0.75)"], [0, 0, 1.5, "rgba(240,196,234,0.75)"]].forEach(function (axis) {
      var a = project({ x: 0, y: 0, z: 0, rgb: [255, 255, 255] }, w, h);
      var b = project({ x: axis[0], y: axis[1], z: axis[2], rgb: [255, 255, 255] }, w, h);
      ctx.strokeStyle = axis[3];
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.moveTo(a.sx, a.sy);
      ctx.lineTo(b.sx, b.sy);
      ctx.stroke();
    });
  }

  function sculptAt(px, py) {
    var radius = brush.radius;
    var hit = [];
    var i;
    for (i = 0; i < points.length; i++) {
      var dx = points[i].sx - px;
      var dy = points[i].sy - py;
      if (dx * dx + dy * dy <= radius * radius) hit.push(i);
    }
    if (!hit.length) return;
    if (tool === "smooth") {
      var average = 0;
      for (i = 0; i < hit.length; i++) average += points[hit[i]].y;
      average /= hit.length;
      for (i = 0; i < hit.length; i++) {
        sculpt[hit[i]].dy += (average - points[hit[i]].y) * 0.45;
      }
    } else {
      var dir = tool === "pull" ? -1 : 1;
      var mag = brush.strength * 0.62 * dir;
      var cx = midX();
      var cz = midZ();
      for (i = 0; i < hit.length; i++) {
        var index = hit[i];
        var fall = 1 - Math.hypot(points[index].sx - px, points[index].sy - py) / radius;
        if (shape === "sphere" || shape === "torus") {
          var ox = points[index].x - cx;
          var oy = points[index].y;
          var oz = points[index].z - cz;
          var len = Math.hypot(ox, oy, oz) || 1;
          sculpt[index].dx += (ox / len) * mag * fall;
          sculpt[index].dy += (oy / len) * mag * fall;
          sculpt[index].dz += (oz / len) * mag * fall;
        } else {
          sculpt[index].dy += mag * fall;
        }
      }
    }
    compose();
  }

  function choiceHost(id, items, current, onPick) {
    var host = $(id);
    if (!host || host.dataset.built) return;
    host.dataset.built = "1";
    host.innerHTML = items.map(function (item) {
      var on = item.id === current();
      return '<button type="button" data-id="' + item.id + '" class="' + (on ? "is-on" : "") + '" aria-pressed="' + (on ? "true" : "false") + '">' + item.name + "</button>";
    }).join("");
    host.addEventListener("click", function (e) {
      var button = e.target.closest("button");
      if (!button) return;
      onPick(button.getAttribute("data-id"));
    });
  }

  function addGauge(host, spec) {
    var row = document.createElement("label");
    row.className = "mx-gauge";
    row.innerHTML = spec.label +
      '<input type="range" min="' + spec.min + '" max="' + spec.max + '" step="' + spec.step + '" value="' + spec.value + '" aria-label="' + spec.label + '" />' +
      '<span class="mx-gauge-val">' + num(spec.value) + "</span>";
    host.appendChild(row);
    var input = row.querySelector("input");
    var val = row.querySelector(".mx-gauge-val");
    input.addEventListener("input", function () {
      spec.on(parseFloat(input.value));
      val.textContent = num(parseFloat(input.value));
    });
    return row;
  }

  function bindControls() {
    choiceHost("mx-create", SHAPES, function () { return shape; }, function (id) {
      shape = id;
      rebuildSamples();
    });
    choiceHost("mx-functions", FUNCTIONS, function () { return fnId; }, function (id) {
      fnId = id;
      compose();
    });
    choiceHost("mx-tools", TOOLS, function () { return tool; }, function (id) {
      tool = id;
      paintReadout();
    });
    var gauges = $("mx-gauges");
    if (gauges && !gauges.dataset.built) {
      gauges.dataset.built = "1";
      addGauge(gauges, { label: "x from", min: -6, max: 2, step: 0.1, value: range.x0, on: function (v) { range.x0 = v; keepRange(); compose(); } });
      addGauge(gauges, { label: "x to", min: -2, max: 6, step: 0.1, value: range.x1, on: function (v) { range.x1 = v; keepRange(); compose(); } });
      addGauge(gauges, { label: "z from", min: -6, max: 2, step: 0.1, value: range.z0, on: function (v) { range.z0 = v; keepRange(); compose(); } });
      addGauge(gauges, { label: "z to", min: -2, max: 6, step: 0.1, value: range.z1, on: function (v) { range.z1 = v; keepRange(); compose(); } });
      addGauge(gauges, { label: "density", min: 12, max: 36, step: 1, value: range.n, on: function (v) { range.n = v; keepRange(); rebuildSamples(); } });
    }
    var fnHost = $("mx-fn");
    if (fnHost && !fnHost.dataset.built) {
      fnHost.dataset.built = "1";
      gaugeRows.a = addGauge(fnHost, { label: "a", min: -2, max: 2, step: 0.05, value: fn.a, on: function (v) { fn.a = v; compose(); } });
      gaugeRows.b = addGauge(fnHost, { label: "b", min: -2, max: 2, step: 0.05, value: fn.b, on: function (v) { fn.b = v; compose(); } });
      gaugeRows.cut = addGauge(fnHost, { label: "cut", min: -3, max: 3, step: 0.05, value: fn.cut, on: function (v) { fn.cut = v; compose(); } });
    }
    var sculptHost = $("mx-sculpt");
    if (sculptHost && !sculptHost.dataset.built) {
      sculptHost.dataset.built = "1";
      addGauge(sculptHost, { label: "radius", min: 20, max: 140, step: 1, value: brush.radius, on: function (v) { brush.radius = v; } });
      addGauge(sculptHost, { label: "strength", min: 0.05, max: 1, step: 0.05, value: brush.strength, on: function (v) { brush.strength = v; } });
    }
    var clear = $("mx-clear");
    if (clear && !clear.dataset.bound) {
      clear.dataset.bound = "1";
      clear.addEventListener("click", function () {
        var i;
        for (i = 0; i < sculpt.length; i++) sculpt[i] = { dx: 0, dy: 0, dz: 0 };
        compose();
      });
    }
  }

  function bindCloud() {
    var canvas = $("mx-cloud");
    if (!canvas || canvas.dataset.bound) return;
    canvas.dataset.bound = "1";
    canvas.addEventListener("pointerdown", function (e) {
      var rect = canvas.getBoundingClientRect();
      if (tool !== "orbit") {
        view.drag = { mode: "sculpt", id: e.pointerId };
        sculptAt(e.clientX - rect.left, e.clientY - rect.top);
        try { if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId); } catch (err) {}
        return;
      }
      view.drag = { mode: "orbit", x: e.clientX, y: e.clientY, yaw: view.yaw, pitch: view.pitch, id: e.pointerId };
      try { if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId); } catch (err) {}
    });
    canvas.addEventListener("pointermove", function (e) {
      if (!view.drag || e.pointerId !== view.drag.id) return;
      if (view.drag.mode === "sculpt") {
        var rect = canvas.getBoundingClientRect();
        sculptAt(e.clientX - rect.left, e.clientY - rect.top);
        return;
      }
      view.yaw = view.drag.yaw + (e.clientX - view.drag.x) * 0.008;
      view.pitch = clamp(view.drag.pitch + (e.clientY - view.drag.y) * 0.008, -1.15, 1.15);
    });
    function endDrag(e) {
      if (view.drag && e.pointerId === view.drag.id) view.drag = null;
    }
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);
    canvas.addEventListener("wheel", function (e) {
      e.preventDefault();
      view.dist = clamp(view.dist + e.deltaY * 0.004, 2.3, 9);
    }, { passive: false });
  }

  function loop() {
    var panel = $("panel-math");
    if (!panel || panel.hidden) {
      raf = 0;
      return;
    }
    draw();
    raf = requestAnimationFrame(loop);
  }

  function focusStage() {
    var canvas = $("mx-cloud");
    if (!canvas || !canvas.getBoundingClientRect) return;
    var rect = canvas.getBoundingClientRect();
    if (rect.top < 64 || rect.bottom > window.innerHeight - 8) {
      canvas.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }

  function ensure() {
    if (built) return;
    built = true;
    bindControls();
    bindCloud();
    rebuildSamples();
  }

  function onShow() {
    ensure();
    if (!raf) loop();
    requestAnimationFrame(focusStage);
  }

  document.addEventListener("math-show", onShow);
  window.MathLab = { onShow: onShow };
})();
