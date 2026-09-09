/**
 * Ragdoll — pose a paint-stained 6-limb figure, generate from pose + patches.
 */
(function () {
  "use strict";

  var LIMBS = ["head", "torso", "l_arm", "r_arm", "l_leg", "r_leg"];
  var state = {
    matter: null,
    engine: null,
    mouse: null,
    bodies: {},
    skins: {},
    images: {},
    scars: [],
    patches: [],
    raf: 0,
    running: false,
    ready: false,
    lastScarAt: 0,
    drag: null,
    boundPointer: false,
    objects: [],
    objectSkins: {},
    bgImage: null,
    bgUrl: "",
    generating: false,
    loading: false,
  };

  function $(id) {
    return document.getElementById(id);
  }

  function apiUrl(path) {
    if (typeof window.galleryApiUrl === "function") return window.galleryApiUrl(path);
    var base = String(window.SPELLFORGE_API_BASE || "").replace(/\/$/, "");
    return base ? base + path : path;
  }

  function setStatus(msg, kind) {
    var el = $("rd-status");
    if (!el) return;
    el.textContent = msg || "";
    el.className = "rd-status" + (kind ? " " + kind : "");
  }

  function randPainting() {
    return 1 + Math.floor(Math.random() * 1000);
  }

  function loadMatter() {
    if (window.Matter) return Promise.resolve(window.Matter);
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/matter-js/0.19.0/matter.min.js";
      s.onload = function () {
        resolve(window.Matter);
      };
      s.onerror = function () {
        reject(new Error("Matter.js failed to load"));
      };
      document.head.appendChild(s);
    });
  }

  function loadImage(url) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        resolve(img);
      };
      img.onerror = function () {
        resolve(null);
      };
      img.src = url;
    });
  }

  function skinUrl(num) {
    return apiUrl("/paintings/" + num + ".jpg");
  }

  function ensureSkins() {
    LIMBS.forEach(function (id) {
      if (!state.skins[id]) state.skins[id] = randPainting();
    });
  }

  function loadSkins() {
    ensureSkins();
    return Promise.all(
      LIMBS.map(function (id) {
        return loadImage(skinUrl(state.skins[id])).then(function (img) {
          if (img) state.images[id] = img;
        });
      })
    );
  }

  function canvasSize() {
    var canvas = $("rd-canvas");
    var stage = $("rd-stage");
    if (!canvas || !stage) return { w: 800, h: 560, dpr: 1 };
    var cssW = Math.max(280, stage.clientWidth || 800);
    var cssH = Math.max(360, Math.min(560, Math.round(cssW * 0.7)));
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = cssW + "px";
    canvas.style.height = cssH + "px";
    return { w: canvas.width, h: canvas.height, dpr: dpr };
  }

  function makeRagdoll(Matter, w, h) {
    var Bodies = Matter.Bodies;
    var Constraint = Matter.Constraint;
    var Composite = Matter.Composite;
    var cx = w * 0.5;
    var cy = h * 0.32;
    var s = Math.min(w, h) / 560;
    var group = Matter.Body.nextGroup(true);

    function rec(id, x, y, bw, bh, opts) {
      opts = opts || {};
      var body = Bodies.rectangle(x, y, bw * s, bh * s, {
        collisionFilter: { group: group, category: 0x0001, mask: 0xffffffff },
        frictionAir: 0.05,
        density: opts.density || 0.0014,
        restitution: 0.05,
        sleepThreshold: Infinity,
        label: id,
        chamfer: { radius: Math.max(4, 8 * s) },
      });
      state.bodies[id] = body;
      return body;
    }

    function circ(id, x, y, r) {
      var body = Bodies.circle(x, y, r * s, {
        collisionFilter: { group: group, category: 0x0001, mask: 0xffffffff },
        frictionAir: 0.05,
        density: 0.0012,
        sleepThreshold: Infinity,
        label: id,
      });
      state.bodies[id] = body;
      return body;
    }

    var torso = rec("torso", cx, cy + 70 * s, 70, 110);
    var head = circ("head", cx, cy - 18 * s, 28);
    var lArm = rec("l_arm", cx - 62 * s, cy + 40 * s, 22, 90);
    var rArm = rec("r_arm", cx + 62 * s, cy + 40 * s, 22, 90);
    var lLeg = rec("l_leg", cx - 22 * s, cy + 160 * s, 24, 110);
    var rLeg = rec("r_leg", cx + 22 * s, cy + 160 * s, 24, 110);

    function pin(a, b, ax, ay, bx, by) {
      return Constraint.create({
        bodyA: a,
        bodyB: b,
        pointA: { x: ax * s, y: ay * s },
        pointB: { x: bx * s, y: by * s },
        stiffness: 0.72,
        damping: 0.12,
        length: 2 * s,
      });
    }

    var floor = Bodies.rectangle(w / 2, h - 18 * s, w + 80, 36 * s, {
      isStatic: true,
      label: "floor",
      friction: 0.9,
    });
    var walls = [
      Bodies.rectangle(w / 2, -20, w + 80, 40, { isStatic: true, label: "ceil" }),
      Bodies.rectangle(-20, h / 2, 40, h + 80, { isStatic: true, label: "wall" }),
      Bodies.rectangle(w + 20, h / 2, 40, h + 80, { isStatic: true, label: "wall" }),
    ];

    Composite.add(state.engine.world, [
      floor,
      walls[0],
      walls[1],
      walls[2],
      torso,
      head,
      lArm,
      rArm,
      lLeg,
      rLeg,
      pin(head, torso, 0, 26, 0, -52),
      pin(lArm, torso, 0, -36, -32, -36),
      pin(rArm, torso, 0, -36, 32, -36),
      pin(lLeg, torso, 0, -48, -16, 52),
      pin(rLeg, torso, 0, -48, 16, 52),
    ]);
    return { scale: s };
  }

  function applyPose(pose) {
    if (!pose) return;
    LIMBS.forEach(function (id) {
      var b = state.bodies[id];
      var p = pose[id];
      if (!b || !p) return;
      Matter.Body.setPosition(b, { x: p.x, y: p.y });
      Matter.Body.setAngle(b, p.angle || 0);
      Matter.Body.setVelocity(b, { x: 0, y: 0 });
      Matter.Body.setAngularVelocity(b, 0);
    });
  }

  function readPose() {
    var pose = {};
    LIMBS.forEach(function (id) {
      var b = state.bodies[id];
      if (!b) return;
      pose[id] = { x: b.position.x, y: b.position.y, angle: b.angle };
    });
    return pose;
  }

  function persist() {
    var payload = {
      limbs: LIMBS,
      pose: readPose(),
      accumulated_patches: state.patches.slice(-80),
      scars: state.scars.slice(-40),
      skins: state.skins,
      objects: snapshotObjects(),
      background: state.bgUrl || "",
      prompt: ($("rd-prompt") && $("rd-prompt").value) || "",
    };
    fetch(apiUrl("/api/ragdoll/state"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(function () {});
  }

  function drawLimb(ctx, id, body) {
    var img = state.images[id] || (body.plugin && body.plugin.img);
    ctx.save();
    ctx.translate(body.position.x, body.position.y);
    ctx.rotate(body.angle);
    var bw = body.bounds.max.x - body.bounds.min.x;
    var bh = body.bounds.max.y - body.bounds.min.y;
    // bounds are AABB; use parts[0] for local size
    var w = (body.circleRadius ? body.circleRadius * 2 : body.parts[0].vertices)
      ? null
      : bw;
    if (body.circleRadius) {
      var r = body.circleRadius;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.clip();
      if (img) ctx.drawImage(img, -r, -r, r * 2, r * 2);
      else {
        ctx.fillStyle = "#5a4030";
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(20,12,6,0.7)";
      ctx.lineWidth = 2;
      ctx.stroke();
    } else {
      var verts = body.vertices;
      var minX = Infinity;
      var minY = Infinity;
      var maxX = -Infinity;
      var maxY = -Infinity;
      verts.forEach(function (v) {
        var lx = (v.x - body.position.x) * Math.cos(-body.angle) - (v.y - body.position.y) * Math.sin(-body.angle);
        var ly = (v.x - body.position.x) * Math.sin(-body.angle) + (v.y - body.position.y) * Math.cos(-body.angle);
        if (lx < minX) minX = lx;
        if (ly < minY) minY = ly;
        if (lx > maxX) maxX = lx;
        if (ly > maxY) maxY = ly;
      });
      ctx.beginPath();
      verts.forEach(function (v, i) {
        var lx = (v.x - body.position.x) * Math.cos(-body.angle) - (v.y - body.position.y) * Math.sin(-body.angle);
        var ly = (v.x - body.position.x) * Math.sin(-body.angle) + (v.y - body.position.y) * Math.cos(-body.angle);
        if (i === 0) ctx.moveTo(lx, ly);
        else ctx.lineTo(lx, ly);
      });
      ctx.closePath();
      ctx.clip();
      var lw = maxX - minX;
      var lh = maxY - minY;
      if (img) ctx.drawImage(img, minX, minY, lw, lh);
      else {
        ctx.fillStyle = "#4a3428";
        ctx.fillRect(minX, minY, lw, lh);
      }
      ctx.beginPath();
      verts.forEach(function (v, i) {
        var lx = (v.x - body.position.x) * Math.cos(-body.angle) - (v.y - body.position.y) * Math.sin(-body.angle);
        var ly = (v.x - body.position.x) * Math.sin(-body.angle) + (v.y - body.position.y) * Math.cos(-body.angle);
        if (i === 0) ctx.moveTo(lx, ly);
        else ctx.lineTo(lx, ly);
      });
      ctx.closePath();
      ctx.strokeStyle = "rgba(20,12,6,0.7)";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.restore();
  }

  function draw() {
    var canvas = $("rd-canvas");
    if (!canvas || !state.engine) return;
    var ctx = canvas.getContext("2d");
    ctx.fillStyle = "#161310";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (state.bgImage) {
      ctx.globalAlpha = 1;
      ctx.drawImage(state.bgImage, 0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "rgba(10, 8, 6, 0.18)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.fillStyle = "rgba(42, 34, 24, 0.92)";
    ctx.fillRect(0, canvas.height - 28, canvas.width, 28);
    (state.objects || []).forEach(function (ob, i) {
      if (ob) drawLimb(ctx, "obj-" + i, ob);
    });
    LIMBS.forEach(function (id) {
      if (state.bodies[id]) drawLimb(ctx, id, state.bodies[id]);
    });
    state.scars.forEach(function (sc) {
      ctx.beginPath();
      ctx.arc(sc.x, sc.y, sc.r || 6, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(90, 20, 16, 0.75)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255, 180, 120, 0.35)";
      ctx.stroke();
    });
  }

  function tick() {
    if (!state.running || !state.engine) return;
    Matter.Engine.update(state.engine, 1000 / 60);
    draw();
    state.raf = requestAnimationFrame(tick);
  }

  function startLoop() {
    if (state.running) return;
    state.running = true;
    state.raf = requestAnimationFrame(tick);
  }

  function stopLoop() {
    state.running = false;
    if (state.raf) cancelAnimationFrame(state.raf);
    state.raf = 0;
  }

  function canvasPoint(ev) {
    var canvas = $("rd-canvas");
    var rect = canvas.getBoundingClientRect();
    var sx = canvas.width / Math.max(1, rect.width);
    var sy = canvas.height / Math.max(1, rect.height);
    return {
      x: (ev.clientX - rect.left) * sx,
      y: (ev.clientY - rect.top) * sy,
    };
  }

  function hitLimb(pt) {
    var Matter = state.matter;
    if (!Matter) return null;
    for (var i = LIMBS.length - 1; i >= 0; i--) {
      var b = state.bodies[LIMBS[i]];
      if (!b) continue;
      if (Matter.Bounds.contains(b.bounds, pt) && Matter.Vertices.contains(b.vertices, pt)) {
        return b;
      }
    }
    var objs = state.objects || [];
    for (var j = objs.length - 1; j >= 0; j--) {
      var ob = objs[j];
      if (!ob) continue;
      if (Matter.Bounds.contains(ob.bounds, pt) && Matter.Vertices.contains(ob.vertices, pt)) {
        return ob;
      }
    }
    return null;
  }

  function endDrag() {
    var Matter = state.matter;
    var canvas = $("rd-canvas");
    if (canvas) canvas.classList.remove("is-drag");
    if (!state.drag || !Matter || !state.engine) {
      state.drag = null;
      return;
    }
    try {
      if (state.drag.constraint) Matter.Composite.remove(state.engine.world, state.drag.constraint);
      if (state.drag.pin) Matter.Composite.remove(state.engine.world, state.drag.pin);
    } catch (e) {}
    state.drag = null;
  }

  function startDrag(ev) {
    if (!state.ready || !state.matter || !state.engine) return;
    var pt = canvasPoint(ev);
    var body = hitLimb(pt);
    if (!body) return;
    ev.preventDefault();
    var Matter = state.matter;
    if (Matter.Sleeping) Matter.Sleeping.set(body, false);
    var dx = pt.x - body.position.x;
    var dy = pt.y - body.position.y;
    var c = Math.cos(-body.angle);
    var s = Math.sin(-body.angle);
    var local = { x: dx * c - dy * s, y: dx * s + dy * c };
    var pin = Matter.Bodies.circle(pt.x, pt.y, 8, {
      isStatic: true,
      collisionFilter: { mask: 0, group: 0, category: 0 },
    });
    var constraint = Matter.Constraint.create({
      bodyA: body,
      pointA: local,
      bodyB: pin,
      pointB: { x: 0, y: 0 },
      stiffness: 0.85,
      damping: 0.15,
      length: 0,
    });
    Matter.Composite.add(state.engine.world, [pin, constraint]);
    state.drag = { body: body, pin: pin, constraint: constraint };
    var canvas = $("rd-canvas");
    if (canvas) {
      canvas.classList.add("is-drag");
      try {
        canvas.setPointerCapture(ev.pointerId);
      } catch (err) {}
    }
  }

  function moveDrag(ev) {
    if (!state.drag || !state.drag.pin) return;
    ev.preventDefault();
    var pt = canvasPoint(ev);
    state.matter.Body.setPosition(state.drag.pin, { x: pt.x, y: pt.y });
  }

  function setupWorld(saved) {
    var Matter = state.matter;
    var size = canvasSize();
    endDrag();
    if (state.engine) {
      Matter.World.clear(state.engine.world, false);
      Matter.Engine.clear(state.engine);
    }
    state.engine = Matter.Engine.create();
    state.engine.gravity.y = 0.95;
    state.engine.enableSleeping = false;
    state.bodies = {};
    state.objects = [];
    makeRagdoll(Matter, size.w, size.h);
    if (saved && saved.pose && Object.keys(saved.pose).length) applyPose(saved.pose);
    restoreObjects(saved && saved.objects);
    state.ready = true;
  }

  function loadState() {
    return fetch(apiUrl("/api/ragdoll/state"), { cache: "no-store" })
      .then(function (r) {
        return r.json();
      })
      .then(function (d) {
        var data = d && (d.state || d);
        if (data && data.skins) state.skins = data.skins;
        if (data && Array.isArray(data.scars)) state.scars = data.scars;
        if (data && Array.isArray(data.accumulated_patches)) state.patches = data.accumulated_patches;
        if (data && data.background) state.bgUrl = String(data.background || "");
        if (data && data.prompt && $("rd-prompt") && !$("rd-prompt").value) {
          $("rd-prompt").value = String(data.prompt);
        }
        if (state.bgUrl) {
          loadImage(apiUrl(state.bgUrl)).then(function (img) {
            if (img) state.bgImage = img;
          });
        }
        return data || {};
      })
      .catch(function () {
        return {};
      });
  }

  function snapshotObjects() {
    return (state.objects || []).map(function (b) {
      return {
        kind: ((b.plugin && b.plugin.kind) || String(b.label || "crate").replace(/^obj-/, "")).replace(/^obj-/, ""),
        x: b.position.x,
        y: b.position.y,
        angle: b.angle,
        skin: (b.plugin && b.plugin.skin) || randPainting(),
      };
    });
  }

  function spawnObject(kind, preset) {
    var Matter = state.matter;
    if (!Matter || !state.engine) return null;
    var canvas = $("rd-canvas");
    var w = canvas ? canvas.width : 800;
    kind = kind || "crate";
    var x = preset && preset.x != null ? preset.x : w * (0.25 + Math.random() * 0.5);
    var y = preset && preset.y != null ? preset.y : 60 + Math.random() * 50;
    var skin = (preset && preset.skin) || randPainting();
    var opts = {
      restitution: kind === "ball" ? 0.58 : 0.14,
      friction: 0.4,
      frictionAir: 0.015,
      density: kind === "plank" ? 0.0009 : 0.0022,
      sleepThreshold: Infinity,
      label: "obj-" + kind,
      collisionFilter: { group: 0, category: 0x0001, mask: 0xffffffff },
    };
    var body;
    if (kind === "ball") body = Matter.Bodies.circle(x, y, 26, opts);
    else if (kind === "plank") body = Matter.Bodies.rectangle(x, y, 160, 18, opts);
    else body = Matter.Bodies.rectangle(x, y, 50, 50, Object.assign({ chamfer: { radius: 6 } }, opts));
    body.plugin = { kind: kind, skin: skin };
    Matter.Composite.add(state.engine.world, body);
    state.objects.push(body);
    var key = "obj-" + (state.objects.length - 1);
    loadImage(skinUrl(skin)).then(function (img) {
      if (!img) return;
      body.plugin.img = img;
      state.images[key] = img;
    });
    if (preset && preset.angle) Matter.Body.setAngle(body, preset.angle);
    return body;
  }

  function restoreObjects(list) {
    if (list && list.length) {
      list.forEach(function (o) {
        spawnObject(o.kind || "crate", o);
      });
      return;
    }
    spawnObject("crate");
    spawnObject("ball");
    spawnObject("plank");
  }

  function init() {
    if (!$("panel-ragdoll")) return Promise.resolve();
    if (state.loading) return Promise.resolve();
    state.loading = true;
    setStatus("Loading Matter.js…");
    return loadMatter()
      .then(function (M) {
        state.matter = M;
        return loadState();
      })
      .then(function (saved) {
        ensureSkins();
        if (saved && saved.skins) state.skins = Object.assign({}, saved.skins, state.skins);
        return loadSkins().then(function () {
          return saved;
        });
      })
      .then(function (saved) {
        setupWorld(saved);
        setStatus("Drag limbs and objects. Generate paints a new background.");
      })
      .catch(function (err) {
        setStatus((err && err.message) || "Ragdoll failed to start", "err");
      })
      .then(function () {
        state.loading = false;
      });
  }

  function reskin() {
    LIMBS.forEach(function (id) {
      state.skins[id] = randPainting();
    });
    loadSkins().then(function () {
      persist();
      setStatus("Limbs reskinned from the 1000.", "ok");
    });
  }

  function stampScar() {
    var t = state.bodies.torso;
    if (!t) return;
    state.scars.push({
      x: t.position.x + (Math.random() - 0.5) * 24,
      y: t.position.y + (Math.random() - 0.5) * 36,
      r: 4 + Math.random() * 5,
    });
    persist();
    setStatus("Scar stamped.", "ok");
  }

  function drop() {
    LIMBS.forEach(function (id) {
      var b = state.bodies[id];
      if (!b) return;
      Matter.Body.setVelocity(b, { x: (Math.random() - 0.5) * 6, y: -4 - Math.random() * 3 });
    });
    (state.objects || []).forEach(function (b) {
      Matter.Body.setVelocity(b, { x: (Math.random() - 0.5) * 8, y: -5 - Math.random() * 4 });
    });
  }

  function resetPose() {
    var size = canvasSize();
    setupWorld({});
    persist();
    setStatus("Pose reset.");
  }

  function delayMs(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function extractImageUrl(payload) {
    if (!payload) return "";
    var img = payload.image || (payload.images && payload.images[0]) || {};
    var raw =
      (img && (img.url || img.download_url)) ||
      payload.url ||
      payload.image_url ||
      payload.output_url ||
      "";
    if (!raw && payload.result && payload.result.url) raw = payload.result.url;
    return raw;
  }

  function pollImageJob(jobId, left) {
    if (left == null) left = 90;
    if (left <= 0) return Promise.reject(new Error("Timed out waiting for image."));
    return fetch(apiUrl("/api/jobs/" + jobId), { cache: "no-store" })
      .then(function (r) {
        return r.json();
      })
      .then(function (job) {
        var st = String((job && job.status) || "working").toLowerCase();
        setStatus("Painting the room… " + st);
        if (st === "done" || st === "completed" || st === "success") {
          var url = extractImageUrl(job);
          if (url) return url;
          throw new Error("Job finished but no image URL.");
        }
        if (st === "failed" || st === "error" || st === "expired") {
          throw new Error((job.error && (job.error.message || job.error)) || "Image job failed");
        }
        return delayMs(1500).then(function () {
          return pollImageJob(jobId, left - 1);
        });
      });
  }

  function buildPrompt() {
    var user = ($("rd-prompt") && $("rd-prompt").value.trim()) || "";
    var dna = LIMBS.map(function (id) {
      return "#" + (state.skins[id] || "?");
    }).join(", ");
    var extra =
      "Painterly environment filling the whole frame, Logan Sevin gallery DNA from paintings " +
      dna +
      ". A posed canvas ragdoll figure may be implied in the space but the painting is the ROOM / world behind it. No UI, no watermark.";
    if (state.objects && state.objects.length) {
      extra += " Still-life physics objects (crates, spheres, planks) rest in the scene.";
    }
    if (user) return user + " " + extra;
    return "A lived-in studio interior, dramatic light, oil and raw canvas, " + extra;
  }

  function setBackgroundFromUrl(url) {
    if (!url) return Promise.resolve();
    var full = url;
    if (full.charAt(0) === "/") full = apiUrl(full);
    return loadImage(full).then(function (img) {
      if (img) {
        state.bgImage = img;
        state.bgUrl = url;
      }
    });
  }

  function generatePainting() {
    if (state.generating) return;
    var prompt = buildPrompt();
    var jobId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : "ragdoll-" + Date.now();
    state.generating = true;
    var btn = $("rd-generate");
    if (btn) btn.disabled = true;
    setStatus("Generating a new room from the prompt…");
    var pose = readPose();
    state.patches.push({
      t: Date.now(),
      skins: Object.assign({}, state.skins),
      pose: pose,
      prompt: prompt.slice(0, 400),
    });
    fetch(apiUrl("/api/generate-stasis-vision"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        job_id: jobId,
        stasis: prompt,
        prompt: prompt,
        buzz_words: ["ragdoll", "pose", "studio", "canvas"],
        spells: LIMBS.map(function (id) {
          return state.skins[id];
        }).filter(Boolean),
        aspect_ratio: "16:9",
        mag_fresh: true,
        spell_cast: false,
        fresh_variation: true,
        source: "ragdoll",
      }),
    })
      .then(function (r) {
        return r.json().then(function (d) {
          return { r: r, d: d };
        });
      })
      .then(function (pack) {
        var d = pack.d || {};
        if (pack.r.status === 202 || (!extractImageUrl(d) && (d.job_id || jobId))) {
          return pollImageJob(d.job_id || jobId);
        }
        if (!pack.r.ok) throw new Error(d.error || "Generate failed");
        var url = extractImageUrl(d);
        if (!url && d.job_id) return pollImageJob(d.job_id);
        if (!url) throw new Error("No image returned");
        return url;
      })
      .then(function (url) {
        setStatus("Hanging the new painting on the wall…");
        return setBackgroundFromUrl(url).then(function () {
          return fetch(apiUrl("/api/save-generated-image"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              image_url: url.charAt(0) === "/" || url.indexOf("http") === 0 ? url : apiUrl(url),
              source: "ragdoll",
              collection: "generated",
              description: (($("rd-prompt") && $("rd-prompt").value) || "Ragdoll scene").slice(0, 160),
              meta: { source: "ragdoll", prompt: prompt.slice(0, 500) },
            }),
          }).then(function (r) {
            return r.json();
          });
        });
      })
      .then(function (saved) {
        persist();
        var n = saved && saved.num != null ? "Generated #" + saved.num : "Generated";
        setStatus("Background changed · " + n, "ok");
      })
      .catch(function (err) {
        setStatus((err && err.message) || "Generate failed — is the gallery server running?", "err");
      })
      .then(function () {
        state.generating = false;
        if (btn) btn.disabled = false;
      });
  }

  function bind() {
    if (!$("panel-ragdoll")) return;
    $("rd-generate") && $("rd-generate").addEventListener("click", generatePainting);
    $("rd-reskin") && $("rd-reskin").addEventListener("click", reskin);
    $("rd-scar") && $("rd-scar").addEventListener("click", stampScar);
    $("rd-drop") && $("rd-drop").addEventListener("click", drop);
    $("rd-reset") && $("rd-reset").addEventListener("click", resetPose);
    $("rd-add-crate") &&
      $("rd-add-crate").addEventListener("click", function () {
        spawnObject("crate");
        persist();
      });
    $("rd-add-ball") &&
      $("rd-add-ball").addEventListener("click", function () {
        spawnObject("ball");
        persist();
      });
    $("rd-add-plank") &&
      $("rd-add-plank").addEventListener("click", function () {
        spawnObject("plank");
        persist();
      });
    var canvas = $("rd-canvas");
    if (canvas && !state.boundPointer) {
      state.boundPointer = true;
      canvas.addEventListener("pointerdown", startDrag);
      canvas.addEventListener("pointermove", moveDrag);
      canvas.addEventListener("pointerup", endDrag);
      canvas.addEventListener("pointercancel", endDrag);
      canvas.addEventListener("lostpointercapture", endDrag);
    }
    window.addEventListener("resize", function () {
      if (!state.ready || !state.matter) return;
      var pose = readPose();
      setupWorld({ pose: pose, objects: snapshotObjects() });
    });
  }

  function onShow() {
    document.body.classList.add("rd-tab-active");
    if (state.ready) startLoop();
    else if (!state.loading) init().then(startLoop);
  }

  function onHide() {
    document.body.classList.remove("rd-tab-active");
    if (state.ready) persist();
    stopLoop();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }

  window.addEventListener("ragdoll-show", onShow);
  window.addEventListener("ragdoll-hide", onHide);
  window.addEventListener("tab-changed", function (e) {
    if (e.detail && e.detail.tab === "ragdoll") onShow();
    else onHide();
  });

  window.Ragdoll = { onShow: onShow, onHide: onHide };
})();
