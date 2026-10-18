/**
 * Sprites: a survivor-game character at sprite size.
 * Spell I, Spell II, and Spell III are the creature.
 * Idle, walk, burst, and the projectile each play as a loop.
 * Paint asks for twenty-four stills: six idle, six walk, six burst, and six projectile stills.
 * The first still locks the creature. Each later body still edits the previous pose.
 * Each projectile still keeps that creature's colors and moves the flight by one small step.
 * Burst is that creature holding up a picture frame. The picture is the Spellforge outcome.
 * Those stills stack in one frame. One is visible at a time. The set is saved.
 */
(function () {
  "use strict";

  var ASPECT = "1:1";
  var FRAMES = 6;
  var FRAME_MS = 140;
  var STILLS = [
    { cycle: "idle", frame: 0, pose: "Standing still, weight even, eyes open, cape hanging." },
    { cycle: "idle", frame: 1, pose: "Breathing in. The chest is a little higher. The cape is still." },
    { cycle: "idle", frame: 2, pose: "Weight shifted onto the back foot." },
    { cycle: "idle", frame: 3, pose: "Eyes closed in one blink. The body stays in place." },
    { cycle: "idle", frame: 4, pose: "The cape sways behind the body. The body is almost still." },
    { cycle: "idle", frame: 5, pose: "The same stance as the first idle still, ready to repeat." },
    { cycle: "walk", frame: 0, pose: "Side view facing right. Contact: the front foot is forward, the back foot trails, and the arms swing opposite the legs." },
    { cycle: "walk", frame: 1, pose: "Side view facing right. Down: the weight is on the front foot." },
    { cycle: "walk", frame: 2, pose: "Side view facing right. Passing: the back leg swings through." },
    { cycle: "walk", frame: 3, pose: "Side view facing right. Up: the back foot leaves the ground." },
    { cycle: "walk", frame: 4, pose: "Side view facing right. The other foot is now forward." },
    { cycle: "walk", frame: 5, pose: "Side view facing right. Passing the other way, ready for the first walk still to follow." },
    { cycle: "burst", frame: 0, pose: "Both hands lift a picture frame in front of the chest. The feet stay on the ground." },
    { cycle: "burst", frame: 1, pose: "The same picture frame rises to face height. The feet stay on the ground." },
    { cycle: "burst", frame: 2, pose: "The picture frame is held up above the head, facing the viewer. The picture inside is the Spellforge outcome." },
    { cycle: "burst", frame: 3, pose: "The hold is steady. The frame is fully presented. The picture inside stays the same Spellforge outcome." },
    { cycle: "burst", frame: 4, pose: "The same frame tilts one small step. Both hands stay on it. The feet stay on the ground." },
    { cycle: "burst", frame: 5, pose: "The frame settles back toward the first raised hold so the loop repeats." },
    { cycle: "shot", frame: 0, pose: "One compact bolt, just formed, centered. It uses this creature's colors. The creature's body is not in the picture." },
    { cycle: "shot", frame: 1, pose: "The same bolt lengthens one step toward the right." },
    { cycle: "shot", frame: 2, pose: "A bright core leads. A short trail of the same pixels follows." },
    { cycle: "shot", frame: 3, pose: "The bolt is at its longest. The trail is clear." },
    { cycle: "shot", frame: 4, pose: "The trail catches the core. The bolt shortens." },
    { cycle: "shot", frame: 5, pose: "The bolt tightens back to the first shape so the loop repeats." },
  ];
  var CYCLES = { idle: 1, walk: 1, burst: 1, shot: 1 };
  var POSE = {
    idle: [
      { y: 0, x: 0, sq: 0, arm: 0, blink: 0, fx: 0, front: [0, 0], back: [0, 0] },
      { y: 0, x: 1, sq: 0, arm: 1, blink: 0, fx: 1, front: [1, 0], back: [0, 0] },
      { y: -1, x: 1, sq: -1, arm: 1, blink: 0, fx: 2, front: [1, -1], back: [0, 0] },
      { y: -1, x: 0, sq: -1, arm: 0, blink: 0, fx: 1, front: [0, 0], back: [-1, 0] },
      { y: 0, x: -1, sq: 0, arm: -1, blink: 1, fx: 0, front: [0, 0], back: [0, 0] },
      { y: 0, x: 0, sq: 0, arm: 0, blink: 0, fx: 0, front: [0, 0], back: [0, 0] },
    ],
    walk: [
      { y: 0, x: 0, sq: 0, arm: 3, blink: 0, fx: 1, front: [4, 0], back: [-3, -4] },
      { y: 2, x: 0, sq: 1, arm: 2, blink: 0, fx: 0, front: [3, 1], back: [-1, -1] },
      { y: -2, x: 0, sq: 0, arm: 0, blink: 0, fx: 2, front: [1, -5], back: [1, 0] },
      { y: -1, x: 0, sq: 0, arm: -2, blink: 0, fx: 1, front: [-1, -2], back: [3, 0] },
      { y: 0, x: 0, sq: 0, arm: -3, blink: 0, fx: 1, front: [-3, -4], back: [4, 0] },
      { y: 2, x: 0, sq: 1, arm: -2, blink: 0, fx: 0, front: [-1, -1], back: [3, 1] },
    ],
    burst: [
      { y: 1, x: 0, sq: 1, arm: -1, blink: 0, fx: 0, front: [0, 0], back: [0, 0] },
      { y: 0, x: 0, sq: 0, arm: 2, blink: 0, fx: 1, front: [0, 0], back: [0, 0] },
      { y: 0, x: 0, sq: 0, arm: 4, blink: 0, fx: 2, front: [1, 0], back: [-1, 0] },
      { y: -1, x: 0, sq: 0, arm: 5, blink: 0, fx: 3, front: [1, 0], back: [-1, 0] },
      { y: 0, x: 1, sq: 0, arm: 4, blink: 0, fx: 2, front: [0, 0], back: [0, 0] },
      { y: 0, x: 0, sq: 0, arm: 2, blink: 0, fx: 1, front: [0, 0], back: [0, 0] },
    ],
  };
  var ROMAN = ["I", "II", "III"];

  var cycle = "idle";
  var shown = false;
  var painting = false;
  var timer = 0;
  var started = 0;

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
    if (cycle === "shot") {
      var bolt = colorsFrom(spells[0].text);
      var span = frame < 3 ? 8 + frame * 4 : 8 + (5 - frame) * 4;
      var bx = 32 - (span >> 1);
      block(ctx, bx, 30, span, 4, bolt.mid);
      block(ctx, bx + span - 3, 29, 4, 6, bolt.light);
      block(ctx, bx, 31, 2, 2, bolt.dark);
      return;
    }
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
    if (cycle === "burst") {
      var held = [8, 14, 20, 22, 18, 12][frame] || 14;
      var framePal = colorsFrom(spells[1].text);
      var pic = colorsFrom(spells[2].text);
      var fw = 18;
      var fh = 14;
      var fx0 = 23;
      var fy0 = bodyY - held;
      block(ctx, fx0 - 1, fy0 - 1, fw + 2, fh + 2, framePal.light);
      block(ctx, fx0, fy0, fw, fh, "#12151e");
      block(ctx, fx0 + 2, fy0 + 2, fw - 4, fh - 4, pic.mid);
      block(ctx, fx0 + 4, fy0 + 4, 4, 3, pic.light);
    }
  }

  function layerNode(host, cycleName, frame) {
    if (!host) return null;
    var nodes = host.querySelectorAll(".spr-layer");
    var i;
    for (i = 0; i < nodes.length; i++) {
      if (nodes[i].dataset.cycle === cycleName && Number(nodes[i].dataset.frame) === frame) return nodes[i];
    }
    return null;
  }

  function placeStill(cycleName, frame, img) {
    if (!img || !img.naturalWidth || !CYCLES[cycleName]) return;
    var hosts = [$("spr-layers"), $("spr-layers-mini")];
    var h;
    for (h = 0; h < hosts.length; h++) {
      var host = hosts[h];
      if (!host) continue;
      var node = layerNode(host, cycleName, frame);
      if (!node) {
        node = document.createElement("canvas");
        node.className = "spr-layer";
        node.dataset.cycle = cycleName;
        node.dataset.frame = String(frame);
        node.hidden = true;
        host.appendChild(node);
      }
      node.width = img.naturalWidth;
      node.height = img.naturalHeight;
      var g = node.getContext("2d");
      g.imageSmoothingEnabled = false;
      g.globalAlpha = 1;
      g.fillStyle = "#12151e";
      g.fillRect(0, 0, node.width, node.height);
      g.drawImage(img, 0, 0);
    }
    draw();
  }

  function draw() {
    var stage = $("spr-stage");
    var mini = $("spr-mini");
    if (!stage) return;
    var spells = readSpells();
    var frame = frameIndex(performance.now());
    stage.dataset.cycle = cycle;
    stage.dataset.frame = String(frame);
    var showing = !!layerNode($("spr-layers"), cycle, frame);
    [stage, mini].forEach(function (canvas) {
      if (!canvas) return;
      canvas.hidden = showing;
      if (showing) return;
      var ctx = canvas.getContext("2d");
      if (!ctx) return;
      drawPuppet(ctx, canvas.width, canvas.height, frame, spells);
    });
    var layers = document.querySelectorAll("#panel-sprites .spr-layer");
    var i;
    for (i = 0; i < layers.length; i++) {
      var node = layers[i];
      var on = showing && node.dataset.cycle === cycle && Number(node.dataset.frame) === frame;
      node.hidden = !on;
    }
  }

  function setCycle(next) {
    if (!CYCLES[next]) return;
    cycle = next;
    var buttons = document.querySelectorAll("#panel-sprites button[data-cycle]");
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].classList.toggle("is-on", buttons[i].getAttribute("data-cycle") === cycle);
    }
    draw();
  }

  function setStatus(text, isError) {
    var el = $("spr-status");
    if (!el) return;
    el.textContent = text || "";
    el.classList.toggle("is-error", !!isError);
  }

  function buildFramePrompt(spells, job, hasRef) {
    var lines = job.cycle === "shot"
      ? [
          hasRef
            ? "The attached picture belongs to this creature. Keep the same colors, the same texture, the same palette, and the same painted signature."
            : "One small projectile made from this creature's colors, texture, and palette.",
          "Paint one small projectile. Do not paint the creature's body.",
          "Opaque chunky pixel art. Solid pixels, a dark one-pixel outline, and a limited palette taken from the spells. No transparency, no fade, and no ghosted shape.",
          "Do not make a character sheet, a film strip, or extra projectiles beside this one.",
          "The projectile is centered on a flat solid dark backdrop, no scenery.",
          "This still is projectile frame " + (job.frame + 1) + " of 6. " + job.pose,
          "The projectile is one combination of Spell 1, Spell 2, and Spell 3. Do not paint Spell 1 by itself.",
          "Spell 1 is Spell I. Spell 2 is Spell II. Spell 3 is Spell III.",
          "",
        ]
      : hasRef
      ? [
          "The attached picture is this same creature. Keep the same face, the same colors, the same texture, the same outfit, the same proportions, the same outline, and the same flat backdrop.",
          "Do not invent a new creature. Do not invent a new composition. Change only the pose, by one small step.",
          "Opaque chunky pixel art. Solid pixels, a dark one-pixel outline, and a limited palette taken from the spells. No transparency, no fade, and no ghosted body.",
          "Do not make a character sheet, a film strip, or extra poses beside this one.",
          "Full body, centered, feet on a hard oval shadow, flat solid dark backdrop, no scenery.",
          "This still is " + job.cycle + " frame " + (job.frame + 1) + " of 6. " + job.pose,
          "The creature is one combination of Spell 1, Spell 2, and Spell 3. Do not paint Spell 1 by itself.",
          "Spell 1 is Spell I. Spell 2 is Spell II. Spell 3 is Spell III.",
          "",
        ]
      : [
          "One sprite still of one creature in one pose. This picture is the character lock. Every later still must be this same creature, with the same texture.",
          "Opaque chunky pixel art. Solid pixels, a dark one-pixel outline, and a limited palette taken from the spells. No transparency, no fade, and no ghosted body.",
          "Do not make a character sheet, a film strip, or extra poses beside this one.",
          "Full body, centered, feet on a hard oval shadow, flat solid dark backdrop, no scenery.",
          "This still is " + job.cycle + " frame " + (job.frame + 1) + " of 6. " + job.pose,
          "The creature is one combination of Spell 1, Spell 2, and Spell 3. Do not paint Spell 1 by itself.",
          "Spell 1 is Spell I. Spell 2 is Spell II. Spell 3 is Spell III.",
          "",
        ];
    if (job.cycle === "burst") {
      lines.pop();
      lines.push("Both hands hold one picture frame up. The feet stay on the ground. Do not jump, do not crouch into a leap, and do not leave the ground.");
      lines.push("The picture inside the frame is the Spellforge outcome, one combination of Spell 1, Spell 2, and Spell 3. Keep that picture sharp and readable.");
      lines.push("");
    }
    for (var i = 0; i < spells.length; i++) {
      var sp = spells[i];
      var body = sp.text || "(empty)";
      if (body.length > 700) body = body.slice(0, 700);
      lines.push("Spell " + (i + 1) + " (Spell " + sp.roman + ")" + (sp.id ? " (#" + sp.id + ")" : ""));
      lines.push(body);
      lines.push("");
    }
    var sig = stampLine();
    lines.push("OUTPUT ASPECT 1:1 square — this ratio is mandatory. Fill the canvas. Do not letterbox.");
    lines.push("IN-CANVAS SIGNATURE (mandatory, small, painterly, lower corner): write exactly \"" + sig + "\".");
    return lines.join("\n").trim();
  }

  function imageRecord(payload) {
    var img = (payload && (payload.image || (payload.images && payload.images[0]))) || {};
    var url = (img && (img.url || img.download_url || img.uri)) || (payload && (payload.image_url || payload.output_url)) || "";
    var remote = (img && img.remote_url) || "";
    return { url: String(url || ""), remote: String(remote || "") };
  }

  function pollJob(jobId, left) {
    if (left <= 0) return Promise.reject(new Error("The sprite took too long."));
    return fetch(apiUrl("/api/jobs/" + encodeURIComponent(jobId)), { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (job) {
        var st = String((job && job.status) || "").toLowerCase();
        if (st === "done" || st === "completed" || st === "success") {
          var rec = imageRecord(job);
          if (rec.url) return rec;
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

  function loadImage(url) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error("The sprite image did not load.")); };
      img.src = url;
    });
  }

  function shrinkData(url) {
    return loadImage(url).then(function (img) {
      var max = 768;
      var w = img.naturalWidth || 1;
      var h = img.naturalHeight || 1;
      var k = Math.min(1, max / Math.max(w, h));
      var c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(w * k));
      c.height = Math.max(1, Math.round(h * k));
      var g = c.getContext("2d");
      g.fillStyle = "#12151e";
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0, c.width, c.height);
      try { return c.toDataURL("image/jpeg", 0.85); }
      catch (e) { return url; }
    }).catch(function () { return url; });
  }

  function referenceFrom(rec) {
    if (rec.remote && /^https?:\/\//i.test(rec.remote)) return Promise.resolve(rec.remote);
    return shrinkData(rec.url);
  }

  function spriteDb() {
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

  function saveLoop(frames) {
    return spriteDb().then(function (db) {
      return new Promise(function (resolve) {
        var tx = db.transaction("loops", "readwrite");
        tx.objectStore("loops").put({ id: "latest", saved: Date.now(), frames: frames });
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { resolve(false); };
      });
    }).catch(function () { return false; });
  }

  function loadLoop() {
    return spriteDb().then(function (db) {
      return new Promise(function (resolve) {
        var tx = db.transaction("loops", "readonly");
        var req = tx.objectStore("loops").get("latest");
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function () { resolve(null); };
      });
    }).catch(function () { return null; });
  }

  function fileStill(job, stored, prompt) {
    var api = window.SpellforgeAPI;
    if (!api || typeof api.saveGenerated !== "function" || !stored) return;
    var title = "Sprite " + job.cycle + " " + (job.frame + 1);
    api.saveGenerated({
      title: title,
      url: stored,
      prompt: prompt || "",
      tags: ["sprite", job.cycle],
    }).catch(function () {});
  }

  function restoreLoop() {
    return loadLoop().then(function (rec) {
      if (!rec || !rec.frames || !rec.frames.length || painting) return 0;
      var jobs = rec.frames.map(function (fr) {
        if (!fr || !fr.url) return Promise.resolve();
        return loadImage(fr.url).then(function (img) {
          placeStill(fr.cycle, fr.frame, img);
        }).catch(function () {});
      });
      return Promise.all(jobs).then(function () {
        if (!painting && rec.frames.length) {
          setStatus(rec.frames.length + " saved stills of one creature. One shows at a time.");
        }
        return rec.frames.length;
      });
    });
  }

  function requestStill(spells, job, referenceUrl) {
    var hasRef = !!referenceUrl;
    var prompt = buildFramePrompt(spells, job, hasRef);
    var jobId = (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : "sprites-" + Date.now() + "-" + job.cycle + job.frame;
    var ids = [];
    var i;
    for (i = 0; i < spells.length; i++) {
      var n = Number(spells[i].id);
      if (n >= 1 && n <= 1000) ids.push(n);
    }
    var payload = {
      job_id: jobId,
      stasis: prompt,
      prompt: prompt,
      fused_prompt: prompt,
      buzz_words: ["sprite", job.cycle, "Spell I", "Spell II", "Spell III"],
      spells: ids,
      spell_details: spells.map(function (sp) {
        return { slot: sp.slot, id: sp.id, title: "Spell " + sp.roman, description: sp.text };
      }),
      aspect_ratio: ASPECT,
      signature: stampLine(),
      mag_fresh: !hasRef,
      fresh_variation: false,
      spell_cast: false,
      attach_references: false,
      source: job.cycle === "shot" ? "sprites-shot" : "sprites",
    };
    if (hasRef) payload.reference_image = referenceUrl;
    return fetch(apiUrl("/api/generate-stasis-vision"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify(payload),
    })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) {
          return { status: r.status, d: d || {} };
        });
      })
      .then(function (res) {
        var rec = imageRecord(res.d);
        if (rec.url) return rec;
        if (res.status === 202 || (res.d && res.d.job_id)) return pollJob(res.d.job_id || jobId, 40);
        var errText = res.d && (res.d.error && res.d.error.message ? res.d.error.message : res.d.error);
        throw new Error(errText || "The sprite did not start. Press Paint again.");
      })
      .then(function (rec) {
        return loadImage(rec.url).then(function (img) {
          placeStill(job.cycle, job.frame, img);
          return rec;
        });
      })
      .then(function (rec) {
        return referenceFrom(rec).then(function (ref) {
          return shrinkData(rec.url).then(function (stored) {
            return { url: rec.url, remote: rec.remote, ref: ref, stored: stored, prompt: prompt };
          });
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
    var index = 0;
    var failed = 0;
    var saved = [];
    var lock = "";
    var last = { idle: "", walk: "", burst: "", shot: "" };
    function finish() {
      painting = false;
      if (btn) btn.disabled = false;
      var kept = saved.length;
      if (!kept) setStatus("The sprite did not start. Press Paint again.", true);
      else if (failed) setStatus(kept + " of 24 stills are saved. Press Paint the loops for the rest.", true);
      else setStatus("Twenty-four stills of one creature are saved. The projectile is included. One shows at a time.");
      draw();
    }
    function step() {
      if (!painting) return;
      if (index >= STILLS.length) {
        saveLoop(saved).then(finish, finish);
        return;
      }
      var job = STILLS[index];
      var ref = "";
      if (!(job.cycle === "idle" && job.frame === 0)) {
        ref = job.frame === 0 ? lock : (last[job.cycle] || lock);
      }
      setStatus(job.cycle === "shot"
        ? "Painting projectile still " + (job.frame + 1) + " of 6…"
        : "Painting " + job.cycle + " still " + (job.frame + 1) + " of 6, same creature…");
      requestStill(spells, job, ref).then(
        function (got) {
          var nextRef = got.ref || got.stored || got.url;
          last[job.cycle] = nextRef;
          if (job.cycle === "idle" && job.frame === 0) lock = nextRef;
          var stored = got.stored || got.url;
          saved.push({ cycle: job.cycle, frame: job.frame, url: stored });
          fileStill(job, stored, got.prompt);
          saveLoop(saved);
          index += 1;
          step();
        },
        function () {
          failed += 1;
          index += 1;
          if (job.cycle === "idle" && job.frame === 0) {
            painting = false;
            if (btn) btn.disabled = false;
            setStatus("The sprite did not start. Press Paint again.", true);
            return;
          }
          step();
        }
      );
    }
    step();
  }

  function refreshFromSpells() {
    var spells = readSpells();
    paintSpells(spells);
    loadPics(spells);
    setCycle(cycle);
  }

  function dockForge() {
    var host = $("spr-forge");
    var book = document.querySelector(".spellbook-panel");
    if (!host || !book || book.parentNode === host) return;
    if (!book._sprMark || !book._sprMark.parentNode) {
      var mark = document.createComment("spr-forge-home");
      book.parentNode.insertBefore(mark, book);
      book._sprMark = mark;
    }
    host.appendChild(book);
  }

  function undockForge() {
    var book = document.querySelector(".spellbook-panel");
    if (!book || !book._sprMark || !book._sprMark.parentNode) return;
    if (book.parentNode === book._sprMark.parentNode) return;
    book._sprMark.parentNode.insertBefore(book, book._sprMark);
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

  function wakeForge() {
    if (window.SpellforgeAPI && typeof window.SpellforgeAPI.onShow === "function") {
      try { window.SpellforgeAPI.onShow(); } catch (e) {}
      return;
    }
    var n = 0;
    var wait = setInterval(function () {
      n += 1;
      if (!shown || n > 80) {
        clearInterval(wait);
        return;
      }
      if (window.SpellforgeAPI && typeof window.SpellforgeAPI.onShow === "function") {
        clearInterval(wait);
        try { window.SpellforgeAPI.onShow(); } catch (e2) {}
      }
    }, 50);
  }

  function start() {
    shown = true;
    dockForge();
    wakeForge();
    if (!started) started = performance.now();
    refreshFromSpells();
    if (!timer) timer = setInterval(function () { if (shown) draw(); }, 50);
    if (!(window.SpellforgeAPI && window.SpellforgeAPI.getSlotTexts)) waitForSpells();
    restoreLoop();
    draw();
  }

  function stop() {
    shown = false;
    undockForge();
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
  window.addEventListener("spellforge-fusion", function () {
    if (shown) refreshFromSpells();
  });
  window.addEventListener("spellforge-local-fuse", function () {
    if (shown) refreshFromSpells();
  });
  window.Sprites = { start: start, readSpells: readSpells, placeStill: placeStill, framePrompt: buildFramePrompt };
})();
