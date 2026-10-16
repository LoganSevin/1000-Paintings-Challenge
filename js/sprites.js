/**
 * Sprites: a survivor-game character at sprite size.
 * Spell I, Spell II, and Spell III are the creature.
 * Idle, walk, and burst each play as a loop.
 * Paint asks Spellforge for one sheet: idle, walk, and burst together.
 */
(function () {
  "use strict";

  var ASPECT = "16:9";
  var FRAMES = 8;
  var COLS = 8;
  var SHEET_ROWS = 3;
  var FRAME_MS = 110;
  var ROW = { idle: 0, walk: 1, burst: 2 };
  var CYCLES = {
    idle: "Top row, left to right, is the idle loop. Eight frames. The creature breathes, shifts its weight, blinks once, and the cape sways. The last frame matches the first.",
    walk: "Middle row, left to right, is the walk loop. Eight frames, side view facing right: contact, down, passing, up, then the other foot. The arms swing opposite the legs. The last frame matches the first.",
    burst: "Bottom row, left to right, is the burst loop. Eight frames: crouch, deeper crouch, launch, a bright pixel burst at the peak, fall, land, and recover. The last frame matches the first.",
  };
  var POSE = {
    idle: [
      { y: 0, x: 0, sq: 0, arm: 0, blink: 0, fx: 0, front: [0, 0], back: [0, 0] },
      { y: 0, x: 1, sq: 0, arm: 1, blink: 0, fx: 1, front: [1, 0], back: [0, 0] },
      { y: -1, x: 1, sq: -1, arm: 1, blink: 0, fx: 2, front: [1, -1], back: [0, 0] },
      { y: -1, x: 0, sq: -1, arm: 0, blink: 0, fx: 1, front: [0, 0], back: [-1, 0] },
      { y: 0, x: -1, sq: 0, arm: -1, blink: 1, fx: 0, front: [0, 0], back: [0, 0] },
      { y: 0, x: -1, sq: 1, arm: -1, blink: 1, fx: 0, front: [0, 0], back: [1, 0] },
      { y: -1, x: 0, sq: 0, arm: 0, blink: 0, fx: 1, front: [0, -1], back: [0, 0] },
      { y: 0, x: 0, sq: 0, arm: 0, blink: 0, fx: 0, front: [0, 0], back: [0, 0] },
    ],
    walk: [
      { y: 0, x: 0, sq: 0, arm: 3, blink: 0, fx: 1, front: [4, 0], back: [-3, -4] },
      { y: 2, x: 0, sq: 1, arm: 2, blink: 0, fx: 0, front: [3, 1], back: [-1, -1] },
      { y: -2, x: 0, sq: 0, arm: 0, blink: 0, fx: 2, front: [1, -5], back: [1, 0] },
      { y: -1, x: 0, sq: 0, arm: -2, blink: 0, fx: 1, front: [-1, -2], back: [3, 0] },
      { y: 0, x: 0, sq: 0, arm: -3, blink: 0, fx: 1, front: [-3, -4], back: [4, 0] },
      { y: 2, x: 0, sq: 1, arm: -2, blink: 0, fx: 0, front: [-1, -1], back: [3, 1] },
      { y: -2, x: 0, sq: 0, arm: 0, blink: 0, fx: 2, front: [1, 0], back: [1, -5] },
      { y: -1, x: 0, sq: 0, arm: 2, blink: 0, fx: 1, front: [3, 0], back: [-1, -2] },
    ],
    burst: [
      { y: 3, x: 0, sq: 2, arm: -2, blink: 0, fx: 2, front: [2, 2], back: [-2, 2] },
      { y: 4, x: 0, sq: 3, arm: -3, blink: 0, fx: 3, front: [3, 3], back: [-2, 3] },
      { y: -8, x: 0, sq: -2, arm: 3, blink: 0, fx: 6, front: [2, -4], back: [-3, -2] },
      { y: -16, x: 0, sq: -2, arm: 5, blink: 0, fx: 8, front: [1, -5], back: [-2, -5] },
      { y: -14, x: 0, sq: -1, arm: 4, blink: 0, fx: 7, front: [0, -4], back: [-1, -4] },
      { y: -6, x: 0, sq: 0, arm: 2, blink: 0, fx: 4, front: [1, -2], back: [-1, -1] },
      { y: 3, x: 0, sq: 3, arm: 0, blink: 0, fx: 2, front: [3, 3], back: [-2, 3] },
      { y: 0, x: 0, sq: 0, arm: 0, blink: 0, fx: 0, front: [0, 0], back: [0, 0] },
    ],
  };
  var ROMAN = ["I", "II", "III"];

  var cycle = "idle";
  var shown = false;
  var painting = false;
  var timer = 0;
  var started = 0;
  var sheet = null;
  var pics = [null, null, null];
  var chips = [null, null, null];

  function $(id) {
    return document.getElementById(id);
  }

  function apiUrl(path) {
    if (typeof window.galleryApiUrl === "function") return window.galleryApiUrl(path);
    var base = String(window.SPELLFORGE_API_BASE || "").replace(/\/$/, "");
    var p = path.charAt(0) === "/" ? path : "/" + path;
    return base ? base + p : p;
  }

  function stampLine() {
    var artist = (window.GALLERY_AUTHOR && window.GALLERY_AUTHOR.author) || "Logan Sevin";
    var stamp = (typeof window.galleryAtomicStamp === "function" && window.galleryAtomicStamp()) || "";
    return artist + (stamp ? " · " + stamp : "");
  }

  function cleanWords(text) {
    return String(text || "").replace(/landscape/gi, "wide view").replace(/\s+/g, " ").trim();
  }

  function readSpells() {
    var api = window.SpellforgeAPI;
    var texts = ["", "", ""];
    var ids = [null, null, null];
    if (api && typeof api.getSlotTexts === "function") {
      try { texts = api.getSlotTexts() || texts; } catch (e) {}
    }
    if (api && typeof api.getEquippedSlots === "function") {
      try { ids = api.getEquippedSlots() || ids; } catch (e2) {}
    }
    var out = [];
    for (var i = 0; i < 3; i++) {
      var raw = String(texts[i] || "").replace(/\s+/g, " ").trim();
      out.push({
        slot: i,
        roman: ROMAN[i],
        id: ids[i] || null,
        raw: raw,
        text: cleanWords(raw),
      });
    }
    return out;
  }

  function hueOf(text) {
    var h = 0;
    var s = String(text || "sprite");
    for (var i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) >>> 0;
    return h % 360;
  }

  function paintSpells(spells) {
    for (var i = 0; i < 3; i++) {
      var el = $("spr-spell-" + i);
      if (!el) continue;
      var sp = spells[i];
      var body = sp.raw || "Empty. Equip this spell in Spellforge.";
      if (body.length > 180) body = body.slice(0, 178) + "…";
      el.innerHTML = "";
      var b = document.createElement("b");
      b.textContent = "Spell " + sp.roman + (sp.id ? " #" + sp.id : "");
      el.appendChild(b);
      el.appendChild(document.createTextNode(" " + body));
    }
  }

  function spellPictureUrl(id) {
    id = Number(id);
    if (!(id > 0)) return "";
    if (typeof window.getSpellforgeSpellUrl === "function") {
      try {
        var u = String(window.getSpellforgeSpellUrl(id) || "");
        if (u && u.indexOf("data:image/svg") !== 0) return u;
      } catch (e) {}
    }
    if (id >= 1 && id <= 1000) return "paintings/" + id + ".jpg";
    return "";
  }

  function quantize(img) {
    var c = document.createElement("canvas");
    c.width = 12;
    c.height = 12;
    var g = c.getContext("2d");
    g.imageSmoothingEnabled = false;
    g.drawImage(img, 0, 0, 12, 12);
    return c;
  }

  function loadPics(spells) {
    for (var i = 0; i < 3; i++) {
      var src = spellPictureUrl(spells[i].id);
      pics[i] = null;
      chips[i] = null;
      if (!src) continue;
      (function (slot, url) {
        var img = new Image();
        img.onload = function () {
          pics[slot] = img;
          chips[slot] = quantize(img);
        };
        img.src = url;
      })(i, src);
    }
  }

  function frameIndex(now) {
    return Math.floor((now - started) / FRAME_MS) % FRAMES;
  }

  function hsl(h, s, l) {
    return "hsl(" + (h % 360) + " " + s + "% " + l + "%)";
  }

  function colorsFrom(text) {
    var h = hueOf(text || "sprite");
    return {
      dark: hsl(h, 42, 22),
      mid: hsl(h, 56, 44),
      light: hsl(h, 68, 66),
      spot: hsl(h + 36, 62, 56),
    };
  }

  function block(ctx, x, y, w, h, color) {
    if (w < 1 || h < 1) return;
    ctx.fillStyle = color;
    ctx.fillRect(x | 0, y | 0, w | 0, h | 0);
  }

  var MASK = {
    head: ["  ####  ", " ###### ", "########", "## #### ", "########", " ###### ", "  ####  "],
    body: [" ###### ", "########", "########", "########", " ###### ", "  ####  "],
    arm: ["##", "##", "##", "# "],
    leg: ["##", "##", "##", "##", "##", "###"],
    cape: ["##  ", "### ", " ## ", "  ##", "   #"],
  };

  function chipData(chip) {
    if (!chip) return null;
    if (!chip._px) chip._px = chip.getContext("2d").getImageData(0, 0, chip.width, chip.height).data;
    return chip._px;
  }

  function paintMask(ctx, rows, ox, oy, chip, text) {
    var scale = 2;
    var pal = colorsFrom(text);
    var data = chipData(chip);
    var h = rows.length;
    var w = 0;
    var r;
    var c;
    for (r = 0; r < h; r++) if (rows[r].length > w) w = rows[r].length;
    for (r = 0; r < h; r++) {
      for (c = 0; c < rows[r].length; c++) {
        if (rows[r].charAt(c) !== "#") continue;
        block(ctx, ox + c * scale - 1, oy + r * scale - 1, scale + 2, scale + 2, "#07090e");
      }
    }
    for (r = 0; r < h; r++) {
      for (c = 0; c < rows[r].length; c++) {
        if (rows[r].charAt(c) !== "#") continue;
        var x = ox + c * scale;
        var y = oy + r * scale;
        var color = pal.mid;
        if (data && chip) {
          var u = Math.max(0, Math.min(chip.width - 1, Math.floor(((c + 0.5) / w) * chip.width)));
          var v = Math.max(0, Math.min(chip.height - 1, Math.floor(((r + 0.5) / h) * chip.height)));
          var i = (v * chip.width + u) * 4;
          color = "rgb(" + data[i] + "," + data[i + 1] + "," + data[i + 2] + ")";
        } else if (r < 2) color = pal.light;
        else if (r > h * 0.5 && ((r + c) & 1)) color = pal.dark;
        block(ctx, x, y, scale, scale, color);
        if (!data && r === 0) block(ctx, x, y, scale, 1, pal.light);
        if (r > h * 0.62 && ((r + c) & 1)) block(ctx, x, y + scale - 1, scale, 1, "rgba(0,0,0,0.5)");
      }
    }
  }

  function drawShadow(ctx, cx, groundY, rx) {
    var ry = Math.max(2, Math.round(rx * 0.28));
    var py;
    for (py = -ry; py <= ry; py++) {
      var t = 1 - (py * py) / (ry * ry);
      if (t <= 0) continue;
      var span = Math.max(1, Math.round(rx * Math.sqrt(t)));
      ctx.fillStyle = py === 0 ? "rgba(0,0,0,0.78)" : "rgba(0,0,0,0.55)";
      ctx.fillRect((cx - span) | 0, (groundY + py) | 0, span * 2, 1);
    }
  }

  function drawPuppet(ctx, w, h, frame, spells) {
    var pose = (POSE[cycle] || POSE.idle)[frame] || POSE.idle[0];
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, w, h);
    block(ctx, 0, 0, w, h, "#12151e");
    block(ctx, 0, 56, w, h - 56, "#2a3548");
    block(ctx, 0, 56, w, 1, "#3d4d68");
    var air = Math.max(0, -pose.y);
    var shadowRx = Math.max(5, 14 + pose.sq - Math.floor(air / 2));
    drawShadow(ctx, 32 + pose.x, 58, shadowRx);
    var lean = pose.x * 2;
    var bodyX = 22 + lean;
    var bodyY = 32 + pose.y + Math.max(0, pose.sq);
    var headX = bodyX + 2 + (pose.arm > 0 ? 2 : 0);
    var headY = bodyY - 12;
    var swing = Math.max(-3, Math.min(3, pose.arm));
    paintMask(ctx, MASK.cape, bodyX - 6 - (pose.fx % 3), bodyY + 2 + (pose.fx % 2), chips[2], spells[2].text);
    paintMask(ctx, MASK.leg, bodyX + 2 + pose.back[0], bodyY + 10 + pose.back[1], chips[2], spells[2].text);
    paintMask(ctx, MASK.arm, bodyX - swing, bodyY + 2, chips[1], spells[1].text);
    paintMask(ctx, MASK.body, bodyX, bodyY, chips[1], spells[1].text);
    paintMask(ctx, MASK.leg, bodyX + 8 + pose.front[0], bodyY + 10 + pose.front[1], chips[2], spells[2].text);
    paintMask(ctx, MASK.arm, bodyX + 12 + swing, bodyY + 1, chips[1], spells[1].text);
    paintMask(ctx, MASK.head, headX, headY, chips[0], spells[0].text);
    if (!chips[0]) {
      var crest = colorsFrom(spells[0].text).light;
      block(ctx, headX + 6, headY - 4, 2, 4, crest);
      block(ctx, headX + 10, headY - 3, 2, 3, crest);
    }
    if (pose.blink) block(ctx, headX + 10, headY + 7, 4, 1, "#0c0e14");
    else {
      block(ctx, headX + 10, headY + 6, 2, 2, "#0c0e14");
      block(ctx, headX + 11, headY + 6, 1, 1, "#f4f7ff");
    }
    if (cycle === "burst" && pose.fx > 0) {
      var spark = colorsFrom(spells[2].text).light;
      var n = pose.fx + 4;
      var i;
      for (i = 0; i < n; i++) {
        var ang = (i / n) * Math.PI * 2 + frame * 0.8;
        var rad = 8 + pose.fx * 2;
        var sx = 32 + pose.x + Math.round(Math.cos(ang) * rad);
        var sy = bodyY + 6 + Math.round(Math.sin(ang) * rad * 0.62);
        block(ctx, sx, sy, 2, 2, spark);
      }
    }
  }

  function drawSheet(ctx, w, h, img, frame, row) {
    var col = frame % COLS;
    var sw = img.naturalWidth / COLS;
    var sh = img.naturalHeight / SHEET_ROWS;
    if (!(sw > 1) || !(sh > 1)) return;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#12151e";
    ctx.fillRect(0, 0, w, h);
    var scale = Math.min(w / sw, h / sh);
    var dw = sw * scale;
    var dh = sh * scale;
    ctx.drawImage(img, col * sw, row * sh, sw, sh, (w - dw) / 2, (h - dh) / 2, dw, dh);
  }

  function draw() {
    var stage = $("spr-stage");
    var mini = $("spr-mini");
    if (!stage) return;
    var spells = readSpells();
    var frame = frameIndex(performance.now());
    stage.dataset.cycle = cycle;
    stage.dataset.frame = String(frame);
    [stage, mini].forEach(function (canvas) {
      if (!canvas) return;
      var ctx = canvas.getContext("2d");
      if (!ctx) return;
      if (sheet && sheet.naturalWidth) drawSheet(ctx, canvas.width, canvas.height, sheet, frame, ROW[cycle] || 0);
      else drawPuppet(ctx, canvas.width, canvas.height, frame, spells);
    });
  }

  function setCycle(next) {
    if (!CYCLES[next]) return;
    cycle = next;
    var buttons = document.querySelectorAll("#panel-sprites [data-cycle]");
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].classList.toggle("is-on", buttons[i].getAttribute("data-cycle") === cycle);
    }
    var strip = $("spr-strip");
    if (strip) {
      if (sheet && sheet.src) {
        strip.src = sheet.src;
        strip.hidden = false;
        strip.alt = "Idle, walk, and burst, eight frames each";
      } else {
        strip.removeAttribute("src");
        strip.hidden = true;
      }
    }
    draw();
  }

  function setStatus(text, isError) {
    var el = $("spr-status");
    if (!el) return;
    el.textContent = text || "";
    el.classList.toggle("is-error", !!isError);
  }

  function buildPrompt(spells) {
    var lines = [
      "One small survivor-game character, full body, side view facing right, readable at sprite size.",
      "Chunky pixel art. Visible square pixels, a dark one-pixel outline, and a limited palette taken from the spells.",
      "One sprite sheet. Three rows and eight columns. No lines between the frames. Every cell is the same size.",
      "Paint idle, walk, and burst in this same image, at the same time, of the same creature.",
      CYCLES.idle,
      CYCLES.walk,
      CYCLES.burst,
      "The same creature, the same scale, the same pixel size, and the same ground line in every cell.",
      "Flat solid dark backdrop. A hard oval shadow on the ground under the feet in every frame. No scenery.",
      "The creature is one combination of Spell 1, Spell 2, and Spell 3. Do not paint Spell 1 by itself.",
      "Spell 1 is Spell I. Spell 2 is Spell II. Spell 3 is Spell III.",
      "",
    ];
    for (var i = 0; i < spells.length; i++) {
      var sp = spells[i];
      var body = sp.text || "(empty)";
      if (body.length > 700) body = body.slice(0, 700);
      lines.push("Spell " + (i + 1) + " (Spell " + sp.roman + ")" + (sp.id ? " (#" + sp.id + ")" : ""));
      lines.push(body);
      lines.push("");
    }
    var sig = stampLine();
    lines.push("OUTPUT ASPECT " + ASPECT + " wide — this ratio is mandatory, not 1:1 unless the control is 1:1. Fill the canvas. Do not letterbox.");
    lines.push("IN-CANVAS SIGNATURE (mandatory, small, painterly, lower corner): write exactly \"" + sig + "\".");
    return lines.join("\n").trim();
  }

  function imageUrl(payload) {
    if (!payload) return "";
    var img = payload.image || (payload.images && payload.images[0]);
    return (img && (img.url || img.download_url || img.uri)) || payload.image_url || payload.output_url || "";
  }

  function pollJob(jobId, left) {
    if (left <= 0) return Promise.reject(new Error("The sprite took too long."));
    return fetch(apiUrl("/api/jobs/" + encodeURIComponent(jobId)), { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (job) {
        var st = String((job && job.status) || "").toLowerCase();
        if (st === "done" || st === "completed" || st === "success") {
          var url = imageUrl(job);
          if (url) return url;
          throw new Error("The sprite finished without an image.");
        }
        if (st === "failed" || st === "error" || st === "expired") {
          throw new Error((job && job.error && (job.error.message || job.error)) || "The sprite did not finish.");
        }
        return new Promise(function (resolve) { setTimeout(resolve, 1200); }).then(function () {
          return pollJob(jobId, left - 1);
        });
      });
  }

  function paintLoop() {
    if (painting) return;
    var spells = readSpells();
    var filled = spells.filter(function (sp) { return sp.text; });
    if (!filled.length) {
      setStatus("Equip Spell I, Spell II, or Spell III in Spellforge first.", true);
      return;
    }
    painting = true;
    var btn = $("spr-paint");
    if (btn) btn.disabled = true;
    var prompt = buildPrompt(spells);
    var jobId = (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : "sprites-" + Date.now();
    var ids = [];
    for (var i = 0; i < spells.length; i++) {
      var n = Number(spells[i].id);
      if (n >= 1 && n <= 1000) ids.push(n);
    }
    setStatus("Painting idle, walk, and burst together from Spell I, Spell II, and Spell III…");
    fetch(apiUrl("/api/generate-stasis-vision"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        job_id: jobId,
        stasis: prompt,
        prompt: prompt,
        fused_prompt: prompt,
        buzz_words: ["sprite", "idle", "walk", "burst", "Spell I", "Spell II", "Spell III"],
        spells: ids,
        spell_details: spells.map(function (sp) {
          return { slot: sp.slot, id: sp.id, title: "Spell " + sp.roman, description: sp.text };
        }),
        aspect_ratio: ASPECT,
        signature: stampLine(),
        mag_fresh: true,
        fresh_variation: true,
        spell_cast: false,
        attach_references: false,
        source: "sprites",
      }),
    })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) {
          return { status: r.status, d: d || {} };
        });
      })
      .then(function (res) {
        var url = imageUrl(res.d);
        if (url) return url;
        if (res.status === 202 || (res.d && res.d.job_id)) return pollJob(res.d.job_id || jobId, 40);
        throw new Error((res.d && res.d.error) || "The sprite did not start.");
      })
      .then(function (url) {
        return new Promise(function (resolve, reject) {
          var img = new Image();
          img.onload = function () { resolve(img); };
          img.onerror = function () { reject(new Error("The sprite image did not load.")); };
          img.src = url;
        });
      })
      .then(function (img) {
        sheet = img;
        setCycle(cycle);
        setStatus("Idle, walk, and burst are ready.");
        draw();
        var api = window.SpellforgeAPI;
        if (api && typeof api.saveGenerated === "function") {
          api.saveGenerated({ title: "Sprite idle walk burst", url: img.src, prompt: prompt, tags: ["sprite", "idle", "walk", "burst"] }).catch(function () {});
        }
      })
      .catch(function (err) {
        var msg = String((err && err.message) || err || "");
        if (/quota|neuron|credits|capacity|paywall|buy credits|balance|api key|failed to fetch|network/i.test(msg)) {
          msg = "The sprite did not start. Press Paint again.";
        }
        setStatus(msg.slice(0, 180) || "The sprite did not start.", true);
      })
      .then(function () {
        painting = false;
        if (btn) btn.disabled = false;
      });
  }

  function refreshFromSpells() {
    var spells = readSpells();
    paintSpells(spells);
    loadPics(spells);
    setCycle(cycle);
  }

  var spellWait = 0;

  function waitForSpells() {
    if (spellWait) return;
    var n = 0;
    spellWait = setInterval(function () {
      n += 1;
      var ready = window.SpellforgeAPI && typeof window.SpellforgeAPI.getSlotTexts === "function";
      if (!shown || ready || n > 120) {
        clearInterval(spellWait);
        spellWait = 0;
      }
      if (shown && ready) refreshFromSpells();
    }, 50);
  }

  function start() {
    shown = true;
    if (!started) started = performance.now();
    refreshFromSpells();
    if (!timer) timer = setInterval(function () { if (shown) draw(); }, 50);
    if (!(window.SpellforgeAPI && window.SpellforgeAPI.getSlotTexts)) waitForSpells();
    draw();
  }

  function stop() {
    shown = false;
    if (timer) {
      clearInterval(timer);
      timer = 0;
    }
  }

  function bind() {
    var panel = $("panel-sprites");
    if (!panel || panel.dataset.bound) return;
    panel.dataset.bound = "1";
    panel.addEventListener("click", function (ev) {
      var t = ev.target;
      if (!t || t.tagName !== "BUTTON") return;
      var next = t.getAttribute("data-cycle");
      if (next) setCycle(next);
    });
    var paint = $("spr-paint");
    if (paint) paint.addEventListener("click", paintLoop);
  }

  bind();
  window.addEventListener("sprites-show", start);
  window.addEventListener("sprites-hide", stop);
  window.Sprites = { start: start, readSpells: readSpells };
})();
