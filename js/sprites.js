/**
 * Sprites: a survivor-game character at sprite size.
 * Spell I, Spell II, and Spell III are the creature.
 * Idle, walk, and burst each play as a loop.
 * Paint asks Spellforge for one four-frame strip of the chosen loop.
 */
(function () {
  "use strict";

  var ASPECT = "16:9";
  var FRAMES = 4;
  var FRAME_MS = 160;
  var CYCLES = {
    idle: "Idle loop. Four beats of the creature breathing and shifting its weight. The last frame matches the first so the loop is seamless.",
    walk: "Walk loop. Four beats of the same creature walking in place: contact, passing, contact, passing. The last frame matches the first.",
    burst: "Burst loop. Four beats of the same creature gathering a bright pulse and releasing it, then returning to the start pose. The last frame matches the first.",
  };
  var ROMAN = ["I", "II", "III"];

  var cycle = "idle";
  var shown = false;
  var painting = false;
  var timer = 0;
  var started = 0;
  var sheets = { idle: null, walk: null, burst: null };
  var pics = [null, null, null];

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

  function loadPics(spells) {
    for (var i = 0; i < 3; i++) {
      var id = Number(spells[i].id);
      pics[i] = null;
      if (!(id >= 1 && id <= 1000)) continue;
      (function (slot, num) {
        var img = new Image();
        img.onload = function () { pics[slot] = img; };
        img.src = "paintings/" + num + ".jpg";
      })(i, id);
    }
  }

  function frameIndex(now) {
    return Math.floor((now - started) / FRAME_MS) % FRAMES;
  }

  function drawPuppet(ctx, w, h, frame, spells) {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#141820";
    ctx.fillRect(0, 0, w, h);
    var bob = cycle === "idle" ? [0, -3, -1, -3][frame] : [0, -2, 0, -2][frame];
    var step = cycle === "walk" ? [-7, 0, 7, 0][frame] : 0;
    var squash = cycle === "burst" ? [0.86, 1.2, 1.05, 1][frame] : 1;
    var cx = w * 0.5;
    var ground = h * 0.84 + bob;
    var bodyH = 34 * squash;
    var bodyW = 28 / squash;
    ctx.fillStyle = "hsla(" + hueOf(spells[2].text || "feet") + ", 55%, 42%, 1)";
    ctx.beginPath();
    ctx.ellipse(cx - 8 + step * 0.3, ground, 6, 4, 0, 0, Math.PI * 2);
    ctx.ellipse(cx + 8 - step * 0.3, ground, 6, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    var bodyTop = ground - 8 - bodyH;
    roundPart(ctx, pics[1], cx - bodyW / 2, bodyTop, bodyW, bodyH, hueOf(spells[1].text || "body"));
    var head = 22;
    roundPart(ctx, pics[0], cx - head / 2, bodyTop - head + 4, head, head, hueOf(spells[0].text || "head"));
    ctx.fillStyle = "hsla(" + hueOf(spells[2].text || "spark") + ", 70%, 62%, 1)";
    if (cycle === "burst" && frame === 1) {
      ctx.beginPath();
      ctx.arc(cx, bodyTop + bodyH * 0.45, 26, 0, Math.PI * 2);
      ctx.globalAlpha = 0.55;
      ctx.fill();
      ctx.globalAlpha = 1;
    } else {
      ctx.beginPath();
      ctx.arc(cx + 10, bodyTop + 8, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#1a1e28";
    ctx.fillRect(cx - 5, bodyTop + 8, 3, 3);
    ctx.fillRect(cx + 2, bodyTop + 8, 3, 3);
  }

  function roundPart(ctx, img, x, y, w, h, hue) {
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.clip();
    if (img && img.naturalWidth) {
      ctx.drawImage(img, x, y, w, h);
    } else {
      ctx.fillStyle = "hsla(" + hue + ", 62%, 48%, 1)";
      ctx.fillRect(x, y, w, h);
    }
    ctx.restore();
  }

  function drawSheet(ctx, w, h, img, frame) {
    var sw = img.naturalWidth / FRAMES;
    var sh = img.naturalHeight;
    if (!(sw > 1) || !(sh > 1)) return;
    ctx.fillStyle = "#141820";
    ctx.fillRect(0, 0, w, h);
    var scale = Math.min(w / sw, h / sh);
    var dw = sw * scale;
    var dh = sh * scale;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, frame * sw, 0, sw, sh, (w - dw) / 2, (h - dh) / 2, dw, dh);
  }

  function draw() {
    var stage = $("spr-stage");
    var mini = $("spr-mini");
    if (!stage) return;
    var spells = readSpells();
    var frame = frameIndex(performance.now());
    stage.dataset.cycle = cycle;
    stage.dataset.frame = String(frame);
    var sheet = sheets[cycle];
    [stage, mini].forEach(function (canvas) {
      if (!canvas) return;
      var ctx = canvas.getContext("2d");
      if (!ctx) return;
      if (sheet && sheet.naturalWidth) drawSheet(ctx, canvas.width, canvas.height, sheet, frame);
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
      var sheet = sheets[cycle];
      if (sheet && sheet.src) {
        strip.src = sheet.src;
        strip.hidden = false;
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
      "One small survivor-game character, full body, readable at sprite size.",
      "Four equal frames in a single row. The same creature, the same scale, and the same ground line in every frame.",
      CYCLES[cycle],
      "Flat solid dark backdrop. No scenery.",
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
    setStatus("Painting the " + cycle + " loop from Spell I, Spell II, and Spell III…");
    fetch(apiUrl("/api/generate-stasis-vision"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        job_id: jobId,
        stasis: prompt,
        prompt: prompt,
        fused_prompt: prompt,
        buzz_words: ["sprite", "loop", cycle, "Spell I", "Spell II", "Spell III"],
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
        sheets[cycle] = img;
        var strip = $("spr-strip");
        if (strip) {
          strip.src = img.src;
          strip.hidden = false;
          strip.alt = cycle + " sprite strip, four frames";
        }
        setStatus(cycle.charAt(0).toUpperCase() + cycle.slice(1) + " loop is ready.");
        draw();
        var api = window.SpellforgeAPI;
        if (api && typeof api.saveGenerated === "function") {
          api.saveGenerated({ title: "Sprite " + cycle, url: img.src, prompt: prompt, tags: ["sprite", cycle] }).catch(function () {});
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
