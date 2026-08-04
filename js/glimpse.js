/**
 * Glimpse — webcam generative spell filters (wear the art).
 */
(function () {
  "use strict";

  var CAST_TRAY_SLICE = 36;
  var DRAG_UP_THRESHOLD = 28;
  var FETCH_TIMEOUT_MS = 90000;
  var POLL_INTERVAL_MS = 900;
  var FIRST_POLL_DELAY_MS = 600;
  var MAX_CAPTURE_SIDE = 1280;

  var state = {
    stream: null,
    cameraOn: false,
    mirror: true,
    filterMix: 0.62,
    sceneClarity: 0.34,
    blendMode: "overlay",
    filterUrl: "",
    filterImg: null,
    filterReady: false,
    applied: [],
    pool: [],
    poolReady: false,
    trayItems: [],
    generating: false,
    continuityId: "",
    drag: null,
    rafId: 0,
    active: false,
    lastCaptureUrl: "",
    sceneAnalysis: null,
    analyzing: false,
    describeTimer: 0,
  };

  function $(id) {
    return document.getElementById(id);
  }

  function apiUrl(path) {
    var base = String(window.SPELLFORGE_API_BASE || "").replace(/\/$/, "");
    return base ? base + path : path;
  }

  function parseApiResponse(res) {
    if (window.parseGalleryApiResponse) return window.parseGalleryApiResponse(res);
    return res.json();
  }

  function fetchWithTimeout(url, options, ms) {
    ms = ms || FETCH_TIMEOUT_MS;
    if (typeof AbortSignal !== "undefined" && AbortSignal.timeout) {
      options = options || {};
      options.signal = AbortSignal.timeout(ms);
      return fetch(url, options);
    }
    return fetch(url, options);
  }

  function setStatus(msg, kind) {
    var el = $("gl-status");
    if (!el) return;
    el.textContent = msg || "";
    el.className = "gl-status" + (kind ? " " + kind : "");
  }

  function escapeHtml(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function updateLayerPreviews() {
    var camImg = $("gl-layer-camera");
    var camEmpty = $("gl-layer-camera-empty");
    var genImg = $("gl-layer-generated");
    var genEmpty = $("gl-layer-generated-empty");

    if (state.lastCaptureUrl && camImg) {
      camImg.src = state.lastCaptureUrl;
      camImg.hidden = false;
      if (camEmpty) camEmpty.hidden = true;
    } else {
      if (camImg) {
        camImg.hidden = true;
        camImg.removeAttribute("src");
      }
      if (camEmpty) camEmpty.hidden = false;
    }

    if (state.filterUrl && genImg) {
      genImg.src = state.filterUrl;
      genImg.hidden = false;
      if (genEmpty) genEmpty.hidden = true;
    } else {
      if (genImg) {
        genImg.hidden = true;
        genImg.removeAttribute("src");
      }
      if (genEmpty) genEmpty.hidden = false;
    }
  }

  function renderSceneDescription(analysis) {
    var el = $("gl-scene-desc");
    if (!el) return;
    if (!analysis) {
      el.textContent = "Start the camera — scene description runs automatically, or tap Describe.";
      return;
    }
    var tags = (analysis.tags || [])
      .slice(0, 6)
      .map(function (t) {
        return escapeHtml(t);
      })
      .join(" · ");
    var colors = (analysis.colors || [])
      .slice(0, 4)
      .map(function (c) {
        return escapeHtml(c);
      })
      .join(", ");
    el.innerHTML =
      "<strong>" +
      escapeHtml(analysis.title || "Scene") +
      "</strong> — " +
      escapeHtml(analysis.description || "") +
      (analysis.mood ? ' <em>(' + escapeHtml(analysis.mood) + ")</em>" : "") +
      (tags ? '<span class="gl-scene-tags">' + tags + "</span>" : "") +
      (colors ? '<span class="gl-scene-tags">Colors: ' + colors + "</span>" : "");
  }

  function setSceneDescPending(msg) {
    var el = $("gl-scene-desc");
    if (el) el.textContent = msg || "Analyzing what the camera sees…";
  }

  function scheduleDescribeCamera(delayMs) {
    if (state.describeTimer) clearTimeout(state.describeTimer);
    state.describeTimer = setTimeout(function () {
      state.describeTimer = 0;
      describeCameraScene({ quiet: true });
    }, delayMs == null ? 1800 : delayMs);
  }

  function saveCameraCapture(frame) {
    if (!frame) return;
    state.lastCaptureUrl = frame;
    updateLayerPreviews();
  }

  function snapshotCameraPreview() {
    if (!state.cameraOn) return Promise.resolve("");
    return captureVideoFrame().then(function (frame) {
      saveCameraCapture(frame);
      return frame;
    });
  }

  function describeCameraScene(options) {
    options = options || {};
    if (!state.cameraOn) {
      if (!options.quiet) setStatus("Start the camera first.", "error");
      return Promise.resolve();
    }
    if (state.analyzing) return Promise.resolve();

    state.analyzing = true;
    var btn = $("gl-describe");
    if (btn) btn.disabled = true;
    if (!options.quiet) setStatus("Describing camera scene…", "pending");
    setSceneDescPending("Analyzing what the camera sees…");

    return snapshotCameraPreview()
      .then(function (frame) {
        if (!frame) throw new Error("Could not capture camera frame.");
        return compressDataUrl(frame, 768, 0.82);
      })
      .then(function (compressed) {
        return fetchWithTimeout(
          apiUrl("/api/analyze-image"),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ image: compressed }),
          },
          FETCH_TIMEOUT_MS
        );
      })
      .then(function (r) {
        return parseApiResponse(r).then(function (d) {
          if (!r.ok) throw new Error((d && d.error) || "Scene description failed");
          return d;
        });
      })
      .then(function (d) {
        if (!d || !d.analysis) throw new Error("No scene description returned.");
        state.sceneAnalysis = d.analysis;
        renderSceneDescription(d.analysis);
        if (!options.quiet) setStatus("Camera scene described.", "ok");
      })
      .catch(function (err) {
        renderSceneDescription(null);
        var msg = err.message || "";
        if (msg.indexOf("Unknown API route") >= 0 || msg.indexOf("/api/analyze-image") >= 0) {
          setSceneDescPending("Scene analysis needs a server restart — close and reopen start_server.bat, then hard-refresh.");
          if (!options.quiet) {
            setStatus("Restart start_server.bat to enable camera scene description.", "error");
          }
          return;
        }
        setSceneDescPending("Could not describe scene — tap Describe to retry.");
        if (!options.quiet) {
          setStatus(msg || "Could not describe scene. Is the gallery server running?", "error");
        }
      })
      .finally(function () {
        state.analyzing = false;
        if (btn) btn.disabled = false;
      });
  }

  function normalizeSpell(item) {
    item = item || {};
    var num = item.paintingNum || item.number || null;
    if (num && !item.analysis && window.getGalleryAnalysis) {
      item.analysis = window.getGalleryAnalysis(num);
    }
    return {
      url: item.url || "",
      label: item.label || (num ? "#" + num : "Spell"),
      paintingNum: num,
      title: item.title || (item.analysis && item.analysis.title) || item.label || "",
      tags: item.tags || (item.analysis && item.analysis.tags) || [],
      analysis: item.analysis || null,
    };
  }

  function spellRow(m) {
    var num = m.number;
    var analysis = window.getGalleryAnalysis ? window.getGalleryAnalysis(num) : null;
    return normalizeSpell({
      number: num,
      url: window.getPaintingUrl ? window.getPaintingUrl(num) : "paintings/" + num + ".jpg",
      analysis: analysis,
      title: (analysis && analysis.title) || "Painting #" + num,
      tags: (analysis && analysis.tags) || [],
      paintingNum: num,
      label: "#" + num,
    });
  }

  function paintingNumsFromSpells(spells) {
    var nums = [];
    (spells || []).forEach(function (s) {
      if (s.paintingNum && nums.indexOf(s.paintingNum) < 0) nums.push(s.paintingNum);
    });
    return nums.sort(function (a, b) {
      return a - b;
    });
  }

  function aspectForVideo(video) {
    if (!video || !video.videoWidth) return "3:4";
    var r = video.videoWidth / video.videoHeight;
    if (r > 1.15) return "16:9";
    if (r < 0.8) return "9:16";
    return "3:4";
  }

  function buildGlimpseStasis(spell) {
    var lines = [
      "GLIMPSE — camera-faithful spell filter pass on the exact webcam capture.",
      "THIS IS THE USER'S LIVE CAMERA PHOTO. Keep the identical scene, pose, face, hands, background layout, spacing, and depth — same moment, same composition.",
      "Do NOT invent a new scene. Apply spell grit as a filter: film grain, brush texture, color grade, ink edges, painterly noise, tactile surface quality.",
      "Output must read as the same camera shot with enhanced stylistic grit — recognizably the user's pose and room.",
    ];
    var prompt = ($("gl-prompt") && $("gl-prompt").value.trim()) || "";
    if (prompt) lines.push("Filter direction: " + prompt);
    if (spell) {
      var a = spell.analysis || (spell.paintingNum && window.getGalleryAnalysis ? window.getGalleryAnalysis(spell.paintingNum) : null);
      lines.push(
        "Spell #" +
          spell.paintingNum +
          " " +
          (spell.title || "Spell") +
          ": " +
          String((a && a.description) || "").slice(0, 300)
      );
      if (a && a.tags && a.tags.length) lines.push("Spell effects: " + a.tags.join(", "));
    }
    state.applied.forEach(function (s) {
      var sa = s.analysis || (s.paintingNum && window.getGalleryAnalysis ? window.getGalleryAnalysis(s.paintingNum) : null);
      lines.push("#" + s.paintingNum + " " + (s.title || "Spell") + " — " + String((sa && sa.description) || "").slice(0, 180));
    });
    return lines.join("\n");
  }

  function buildGlimpseBuzz() {
    var buzz = [
      "camera faithful",
      "same pose",
      "film grit",
      "texture pass",
      "color grade",
      "painterly filter",
      "webcam scene",
    ];
    state.applied.forEach(function (s) {
      (s.tags || []).slice(0, 4).forEach(function (t) {
        if (buzz.indexOf(t) < 0) buzz.push(t);
      });
    });
    return buzz;
  }

  function buildGlimpseCraftHints(spell) {
    var hints = [
      "Refine this exact webcam photo — preserve pose, scene layout, and identity.",
      "Add spell-driven grit, grain, brush texture, and color grade as a filter layer — not a new invented image.",
    ];
    if (spell && spell.title) hints.push("Spell texture source: " + spell.title);
    return hints.join(" ");
  }

  function buildGlimpsePrompt(spell) {
    var custom = ($("gl-prompt") && $("gl-prompt").value.trim()) || "";
    var spellTitle = (spell && spell.title) || "spell painting";
    var base =
      "Filter pass on this webcam capture. Keep the same person, pose, room, and camera framing. " +
      "Apply grit, texture, and color stylization from spell #" +
      (spell && spell.paintingNum ? spell.paintingNum : "") +
      " (" +
      spellTitle +
      ") as a quality overlay — the result must still look like this camera scene, not a newly generated painting.";
    return custom ? base + " Filter notes: " + custom : base;
  }

  function compressDataUrl(dataUrl, maxSide, quality) {
    return new Promise(function (resolve) {
      if (!dataUrl || dataUrl.indexOf("data:image") !== 0) return resolve(dataUrl || "");
      var img = new Image();
      img.onload = function () {
        var w = img.width;
        var h = img.height;
        var scale = Math.min(1, maxSide / Math.max(w, h, 1));
        var canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(w * scale));
        canvas.height = Math.max(1, Math.round(h * scale));
        var ctx = canvas.getContext("2d");
        if (!ctx) return resolve(dataUrl);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = function () {
        resolve(dataUrl);
      };
      img.src = dataUrl;
    });
  }

  function isGlimpseVisible() {
    var panel = $("panel-glimpse");
    return !!(panel && !panel.hidden && panel.classList.contains("active"));
  }

  function syncCanvasSize() {
    var video = $("gl-video");
    var canvas = $("gl-canvas");
    var stage = $("gl-stage");
    if (!video || !canvas || !stage) return false;
    var vw = video.videoWidth;
    var vh = video.videoHeight;
    if (!vw || !vh) return false;

    var rect = stage.getBoundingClientRect();
    var stageW = Math.max(rect.width, 280);
    var stageH = Math.max(rect.height, 210);
    var scale = Math.min(stageW / vw, stageH / vh);
    if (!isFinite(scale) || scale <= 0) scale = 1;

    var w = Math.max(1, Math.round(vw * scale));
    var h = Math.max(1, Math.round(vh * scale));
    canvas.width = w;
    canvas.height = h;
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    return true;
  }

  function waitForVideoReady(video) {
    return new Promise(function (resolve, reject) {
      if (!video) {
        reject(new Error("No video element."));
        return;
      }
      if (video.readyState >= 2 && video.videoWidth > 0) {
        resolve();
        return;
      }
      var settled = false;
      function done() {
        if (settled) return;
        settled = true;
        video.removeEventListener("loadedmetadata", onMeta);
        video.removeEventListener("loadeddata", onMeta);
        video.removeEventListener("error", onErr);
        clearTimeout(timer);
        resolve();
      }
      function onMeta() {
        if (video.videoWidth > 0) done();
      }
      function onErr() {
        if (settled) return;
        settled = true;
        video.removeEventListener("loadedmetadata", onMeta);
        video.removeEventListener("loadeddata", onMeta);
        video.removeEventListener("error", onErr);
        clearTimeout(timer);
        reject(new Error("Video stream failed."));
      }
      video.addEventListener("loadedmetadata", onMeta);
      video.addEventListener("loadeddata", onMeta);
      video.addEventListener("error", onErr);
      var timer = setTimeout(function () {
        if (video.videoWidth > 0) done();
        else onErr();
      }, 8000);
    });
  }

  function drawComposite() {
    var video = $("gl-video");
    var canvas = $("gl-canvas");
    var stage = $("gl-stage");
    if (!video || !canvas || !state.cameraOn) return;
    var ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (!syncCanvasSize()) return;

    var hasFilter = !!(state.filterReady && state.filterImg && state.filterImg.complete);
    if (stage) stage.classList.toggle("gl-filter-active", hasFilter);

    ctx.save();
    if (state.mirror) {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    if (hasFilter) {
      ctx.globalAlpha = state.filterMix;
      ctx.globalCompositeOperation = state.blendMode;
      ctx.drawImage(state.filterImg, 0, 0, canvas.width, canvas.height);

      if (state.sceneClarity > 0) {
        ctx.globalAlpha = state.sceneClarity;
        ctx.globalCompositeOperation = "soft-light";
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      }
    }
    ctx.restore();
  }

  function startRenderLoop() {
    stopRenderLoop();
    function tick() {
      if (!state.cameraOn) return;
      if (!isGlimpseVisible()) {
        state.rafId = requestAnimationFrame(tick);
        return;
      }
      drawComposite();
      state.rafId = requestAnimationFrame(tick);
    }
    state.rafId = requestAnimationFrame(tick);
  }

  function stopRenderLoop() {
    if (state.rafId) {
      cancelAnimationFrame(state.rafId);
      state.rafId = 0;
    }
  }

  function captureVideoFrame() {
    var video = $("gl-video");
    if (!video || !video.videoWidth) return Promise.resolve("");
    var w = video.videoWidth;
    var h = video.videoHeight;
    var scale = Math.min(1, MAX_CAPTURE_SIDE / Math.max(w, h));
    var canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    var ctx = canvas.getContext("2d");
    if (!ctx) return Promise.resolve("");
    if (state.mirror) {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return Promise.resolve(canvas.toDataURL("image/jpeg", 0.9));
  }

  function setFilterImage(url) {
    state.filterUrl = url || "";
    state.filterReady = false;
    if (!url) {
      state.filterImg = null;
      updateLayerPreviews();
      drawComposite();
      return;
    }
    var img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = function () {
      state.filterImg = img;
      state.filterReady = true;
      updateLayerPreviews();
      drawComposite();
    };
    img.onerror = function () {
      setStatus("Could not load filter image.", "error");
    };
    img.src = url;
  }

  function pollImageJob(jobId, attemptsLeft, firstPoll) {
    if (attemptsLeft == null) attemptsLeft = 80;
    if (attemptsLeft <= 0) return Promise.reject(new Error("Filter generation timed out."));
    var pollOnce = function () {
      return fetchWithTimeout(apiUrl("/api/jobs/" + jobId), { cache: "no-store" }, 25000);
    };
    var startPoll = firstPoll
      ? new Promise(function (resolve) {
          setTimeout(resolve, FIRST_POLL_DELAY_MS);
        }).then(pollOnce)
      : pollOnce();
    return startPoll
      .then(function (r) {
        return parseApiResponse(r);
      })
      .then(function (job) {
        setStatus("Casting filter… (" + (job.status || "working") + ")", "pending");
        if (job.status === "done") {
          var img = job.image || (job.images && job.images[0]);
          if (img && img.url) return img.url;
          throw new Error("No image returned.");
        }
        if (job.status === "failed") {
          throw new Error((job.error && job.error.message) || "Generation failed.");
        }
        return new Promise(function (resolve) {
          setTimeout(resolve, POLL_INTERVAL_MS);
        }).then(function () {
          return pollImageJob(jobId, attemptsLeft - 1, false);
        });
      });
  }

  function beginGenerate() {
    state.generating = true;
    var stage = $("gl-stage");
    var overlay = $("gl-lens-overlay");
    if (stage) stage.classList.add("gl-filtering");
    if (overlay) overlay.hidden = false;
    document.querySelectorAll(".gl-btn, .gl-spell").forEach(function (el) {
      el.disabled = true;
    });
  }

  function endGenerate() {
    state.generating = false;
    var stage = $("gl-stage");
    var overlay = $("gl-lens-overlay");
    if (stage) stage.classList.remove("gl-filtering");
    if (overlay) overlay.hidden = true;
    document.querySelectorAll(".gl-btn, .gl-spell").forEach(function (el) {
      el.disabled = false;
    });
  }

  function castSpellFilter(spell, options) {
    options = options || {};
    if (state.generating) return Promise.resolve();
    if (!state.cameraOn) {
      setStatus("Start the camera first.", "error");
      return Promise.resolve();
    }
    spell = normalizeSpell(spell);
    if (!spell.url) return Promise.resolve();

    if (!state.continuityId) state.continuityId = "gl-filter-" + Date.now();
    var refine = true;
    var spellCast = true;
    var variation = !!options.variation;

    beginGenerate();
    setStatus(
      variation
        ? "Reshaping lens from camera with spell " + (spell.label || "") + "…"
        : "Transforming frame with spell " + (spell.label || "") + "…",
      "pending"
    );

    var jobId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : "gl-" + Date.now();
    var video = $("gl-video");

    return captureVideoFrame()
      .then(function (frame) {
        if (!frame) throw new Error("Could not capture camera frame.");
        saveCameraCapture(frame);
        scheduleDescribeCamera(1200);
        return compressDataUrl(frame, MAX_CAPTURE_SIDE, 0.9);
      })
      .then(function (frame) {
        if (!frame) throw new Error("Could not prepare camera frame.");
        return fetchWithTimeout(
          apiUrl("/api/generate-stasis-vision"),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              job_id: jobId,
              stasis: buildGlimpseStasis(spell),
              craft_hints: buildGlimpseCraftHints(spell),
              buzz_words: buildGlimpseBuzz(),
              spells: paintingNumsFromSpells(state.applied),
              aspect_ratio: aspectForVideo(video),
              mag_fresh: false,
              fresh_variation: variation,
              refine: refine,
              spell_cast: spellCast,
              spell_reference_image: spell.url,
              reference_image: frame,
              glimpse_geometry_lock: true,
              prompt: buildGlimpsePrompt(spell),
            }),
          },
          FETCH_TIMEOUT_MS
        );
      })
      .then(function (r) {
        if (r.status === 202) {
          return r.json().then(function (d) {
            return pollImageJob((d && d.job_id) || jobId, null, true);
          });
        }
        return parseApiResponse(r).then(function (d) {
          if (!r.ok) throw new Error((d && d.error) || "Filter cast failed");
          var img = d.image || (d.images && d.images[0]);
          if (img && img.url) return img.url;
          throw new Error("No image returned.");
        });
      })
      .then(function (url) {
        setFilterImage(url);
        setStatus("Filter live — your pose stays on camera; resync lens when you move.", "ok");
      })
      .catch(function (err) {
        setStatus(err.message || "Filter failed. Is the gallery server running?", "error");
      })
      .finally(endGenerate);
  }

  function renderApplied() {
    var row = $("gl-applied");
    if (!row) return;
    row.innerHTML = "";
    if (!state.applied.length) {
      row.innerHTML = '<span class="gl-applied-empty">No spells — drag onto the lens.</span>';
      return;
    }
    state.applied.forEach(function (item, idx) {
      var chip = document.createElement("span");
      chip.className = "gl-chip";
      chip.textContent = item.label || "Spell";
      var rm = document.createElement("button");
      rm.type = "button";
      rm.className = "gl-chip-rm";
      rm.textContent = "×";
      rm.dataset.idx = String(idx);
      chip.appendChild(rm);
      row.appendChild(chip);
    });
  }

  function addSpell(item) {
    if (state.generating) return;
    item = normalizeSpell(item);
    if (!item.url) return;
    if (!state.cameraOn) {
      setStatus("Start the camera, then cast spells at the lens.", "error");
      return;
    }
    var exists = state.applied.some(function (s) {
      return s.url === item.url;
    });
    if (exists) {
      setStatus("That spell is already on the filter.", "error");
      return;
    }
    if (state.applied.length >= 12) {
      setStatus("Max 12 spells per filter.", "error");
      return;
    }
    state.applied.push(item);
    renderApplied();
    castSpellFilter(item);
  }

  function loadSpellPool() {
    if (state.poolReady) return Promise.resolve();
    return (window.loadGalleryData ? window.loadGalleryData() : Promise.resolve({ manifest: [] }))
      .then(function (data) {
        state.pool = (data.manifest || []).map(function (m) {
          return normalizeSpell(spellRow(m));
        });
        state.poolReady = true;
        fillTrayRandom();
        renderTray();
      });
  }

  function fillTrayRandom() {
    var copy = state.pool.slice();
    for (var i = copy.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = copy[i];
      copy[i] = copy[j];
      copy[j] = t;
    }
    state.trayItems = copy.slice(0, CAST_TRAY_SLICE);
  }

  function renderTray() {
    var strip = $("gl-spell-strip");
    if (!strip) return;
    strip.innerHTML = "";
    state.trayItems.forEach(function (item, idx) {
      var el = document.createElement("div");
      el.className = "st-spell gl-spell";
      el.dataset.idx = String(idx);
      var img = document.createElement("img");
      img.src = item.url;
      img.alt = item.label;
      el.appendChild(img);
      strip.appendChild(el);
    });
    var count = $("gl-tray-count");
    if (count) count.textContent = state.trayItems.length + " shown · drag onto lens";
  }

  function createGhost(item, x, y) {
    var ghost = document.createElement("div");
    ghost.className = "st-drag-ghost";
    var img = document.createElement("img");
    img.src = item.url;
    ghost.appendChild(img);
    document.body.appendChild(ghost);
    ghost.style.left = x + "px";
    ghost.style.top = y + "px";
    return ghost;
  }

  function isOverStage(x, y) {
    var stage = $("gl-stage");
    if (!stage) return false;
    var rect = stage.getBoundingClientRect();
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  function onPointerDown(e) {
    if (state.generating) return;
    var spell = e.target.closest(".gl-spell");
    if (!spell || !spell.closest("#gl-spell-strip")) return;
    var item = normalizeSpell(state.trayItems[parseInt(spell.dataset.idx, 10)]);
    if (!item.url) return;
    e.preventDefault();
    if (spell.setPointerCapture) spell.setPointerCapture(e.pointerId);
    state.drag = {
      item: item,
      ghost: createGhost(item, e.clientX, e.clientY),
      pointerId: e.pointerId,
      startY: e.clientY,
      moved: false,
    };
    var stage = $("gl-stage");
    if (stage) stage.classList.add("gl-drop-active");
  }

  function onPointerUp(e) {
    if (!state.drag || e.pointerId !== state.drag.pointerId) return;
    var drag = state.drag;
    if (drag.ghost.parentNode) drag.ghost.parentNode.removeChild(drag.ghost);
    var stage = $("gl-stage");
    if (stage) stage.classList.remove("gl-drop-active");
    var over = isOverStage(e.clientX, e.clientY);
    var dy = drag.startY - e.clientY;
    if (over && (dy >= DRAG_UP_THRESHOLD || !drag.moved)) addSpell(drag.item);
    state.drag = null;
  }

  function onPointerMove(e) {
    if (!state.drag || e.pointerId !== state.drag.pointerId) return;
    state.drag.moved = true;
    state.drag.ghost.style.left = e.clientX + "px";
    state.drag.ghost.style.top = e.clientY + "px";
  }

  function onPointerCancel(e) {
    if (!state.drag || e.pointerId !== state.drag.pointerId) return;
    if (state.drag.ghost.parentNode) state.drag.ghost.parentNode.removeChild(state.drag.ghost);
    var stage = $("gl-stage");
    if (stage) stage.classList.remove("gl-drop-active");
    state.drag = null;
  }

  function updateCameraUi() {
    var empty = $("gl-camera-empty");
    var btn = $("gl-camera-btn");
    var stage = $("gl-stage");
    if (empty) empty.hidden = state.cameraOn;
    if (btn) btn.textContent = state.cameraOn ? "Stop camera" : "Start camera";
    if (stage) stage.classList.toggle("gl-camera-live", state.cameraOn);
  }

  function stopCamera() {
    stopRenderLoop();
    if (state.describeTimer) {
      clearTimeout(state.describeTimer);
      state.describeTimer = 0;
    }
    if (state.stream) {
      state.stream.getTracks().forEach(function (t) {
        t.stop();
      });
      state.stream = null;
    }
    var video = $("gl-video");
    if (video) {
      video.srcObject = null;
      video.hidden = true;
    }
    state.cameraOn = false;
    updateCameraUi();
  }

  function startCamera() {
    if (state.cameraOn) {
      stopCamera();
      setStatus("Camera stopped.", "ok");
      return Promise.resolve();
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus("Camera not supported in this browser.", "error");
      return Promise.resolve();
    }
    setStatus("Requesting camera…", "pending");
    return navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      })
      .then(function (stream) {
        state.stream = stream;
        var video = $("gl-video");
        if (!video) return;
        video.srcObject = stream;
        video.hidden = false;
        video.setAttribute("playsinline", "");
        video.muted = true;
        return video.play().then(function () {
          return waitForVideoReady(video);
        });
      })
      .then(function () {
        state.cameraOn = true;
        state.active = isGlimpseVisible();
        updateCameraUi();
        syncCanvasSize();
        drawComposite();
        startRenderLoop();
        requestAnimationFrame(function () {
          syncCanvasSize();
          drawComposite();
        });
        setStatus("Camera live — drag spells onto the lens.", "ok");
        snapshotCameraPreview().then(function () {
          scheduleDescribeCamera(900);
        });
      })
      .catch(function (err) {
        setStatus((err && err.message) || "Could not access camera.", "error");
      });
  }

  function clearFilter() {
    setFilterImage("");
    state.applied = [];
    state.continuityId = "";
    renderApplied();
    var stage = $("gl-stage");
    if (stage) stage.classList.remove("gl-filter-active");
    setStatus("Filter cleared — live camera only.", "ok");
  }

  function resyncLens() {
    if (!state.applied.length) {
      setStatus("Cast a spell first, then resync from camera.", "error");
      return;
    }
    var last = state.applied[state.applied.length - 1];
    castSpellFilter(last, { variation: true });
  }

  function snapshot() {
    var canvas = $("gl-canvas");
    if (!canvas || !state.cameraOn) {
      setStatus("Start camera first.", "error");
      return;
    }
    drawComposite();
    canvas.toBlob(function (blob) {
      if (!blob) return;
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "glimpse-" + Date.now() + ".jpg";
      a.click();
      setTimeout(function () {
        URL.revokeObjectURL(a.href);
      }, 2000);
      setStatus("Snapshot saved.", "ok");
    }, "image/jpeg", 0.92);
  }

  function bindUi() {
    $("gl-camera-btn") &&
      $("gl-camera-btn").addEventListener("click", function () {
        startCamera();
      });
    $("gl-mirror-btn") &&
      $("gl-mirror-btn").addEventListener("click", function () {
        state.mirror = !state.mirror;
        $("gl-mirror-btn").textContent = state.mirror ? "Mirror: on" : "Mirror: off";
        drawComposite();
      });
    $("gl-mix") &&
      $("gl-mix").addEventListener("input", function () {
        state.filterMix = parseInt($("gl-mix").value, 10) / 100;
        drawComposite();
      });
    $("gl-clarity") &&
      $("gl-clarity").addEventListener("input", function () {
        state.sceneClarity = parseInt($("gl-clarity").value, 10) / 100;
        drawComposite();
      });
    $("gl-blend") &&
      $("gl-blend").addEventListener("change", function () {
        state.blendMode = $("gl-blend").value || "overlay";
        drawComposite();
      });
    $("gl-resync") &&
      $("gl-resync").addEventListener("click", resyncLens);
    $("gl-describe") &&
      $("gl-describe").addEventListener("click", function () {
        describeCameraScene();
      });
    var layerCamera = $("gl-layer-camera");
    var layerGenerated = $("gl-layer-generated");
    if (layerCamera) {
      layerCamera.addEventListener("click", function () {
        if (!state.lastCaptureUrl) return;
        window.open(state.lastCaptureUrl, "_blank", "noopener");
      });
    }
    if (layerGenerated) {
      layerGenerated.addEventListener("click", function () {
        if (!state.filterUrl) return;
        window.open(state.filterUrl, "_blank", "noopener");
      });
    }
    $("gl-snapshot") &&
      $("gl-snapshot").addEventListener("click", snapshot);
    $("gl-clear-filter") &&
      $("gl-clear-filter").addEventListener("click", clearFilter);
    $("gl-randomize") &&
      $("gl-randomize").addEventListener("click", function () {
        fillTrayRandom();
        renderTray();
      });
    $("gl-applied") &&
      $("gl-applied").addEventListener("click", function (e) {
        var btn = e.target.closest(".gl-chip-rm");
        if (!btn) return;
        state.applied.splice(parseInt(btn.dataset.idx, 10), 1);
        renderApplied();
      });
    var strip = $("gl-spell-strip");
    if (strip) {
      strip.addEventListener("pointerdown", onPointerDown);
      strip.addEventListener("pointermove", onPointerMove);
      strip.addEventListener("pointerup", onPointerUp);
      strip.addEventListener("pointercancel", onPointerCancel);
    }
    window.addEventListener("resize", syncCanvasSize);
  }

  function onShow() {
    state.active = true;
    loadSpellPool();
    renderApplied();
    if (state.cameraOn) startRenderLoop();
  }

  function onHide() {
    state.active = false;
    stopCamera();
  }

  function boot() {
    if (!$("panel-glimpse")) return;
    bindUi();
    renderApplied();
    updateCameraUi();
    if ($("gl-mirror-btn")) $("gl-mirror-btn").textContent = "Mirror: on";
    if (isGlimpseVisible()) onShow();
    if ($("gl-mix")) state.filterMix = parseInt($("gl-mix").value, 10) / 100;
    if ($("gl-clarity")) state.sceneClarity = parseInt($("gl-clarity").value, 10) / 100;
    updateLayerPreviews();
    renderSceneDescription(null);
    setStatus("Start camera — live pose stays visible; drag spells for grit and color.", "ok");
    window.dispatchEvent(new Event("glimpse-ready"));
  }

  window.Glimpse = { onShow: onShow, onHide: onHide };
  window.addEventListener("glimpse-show", onShow);
  window.addEventListener("glimpse-hide", onHide);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();