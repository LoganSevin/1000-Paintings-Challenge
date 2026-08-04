/**
 * Fleeting Idea — Spellforge-style vision: generate / preview, no 3D walk.
 */
(function () {
  var FLASH_TIMEOUT_MS = 240000;
  var FETCH_TIMEOUT_MS = 45000;
  var HEALTH_TIMEOUT_MS = 20000;
  var LOCAL_GALLERY = "http://localhost:8765";
  var LOCAL_GALLERY_ALT = "http://127.0.0.1:8765";
  var HEALTH_CACHE_MS = 30000;

  var state = {
    visionUrl: "",
    generating: false,
    flashWatchdog: null,
    health: null,
    healthAt: 0,
  };

  function $(id) {
    return document.getElementById(id);
  }

  function apiBase() {
    return String(window.SPELLFORGE_API_BASE || "").replace(/\/$/, "");
  }

  function apiUrl(path) {
    var base = apiBase();
    return base ? base + path : path;
  }

  function isLocalDev() {
    var h = (location.hostname || "").toLowerCase();
    return (
      location.protocol === "file:" ||
      h === "localhost" ||
      h === "127.0.0.1" ||
      h === "[::1]"
    );
  }

  function adoptApiBase(base) {
    if (!base || apiBase()) return;
    window.SPELLFORGE_API_BASE = base;
  }

  function parseHealth(data) {
    if (!data || !data.ok) {
      return { serverOnline: false, apiReady: false, data: data || null };
    }
    var modern = data.stasis_vision === true || (data.api_version || 0) >= 3;
    return {
      serverOnline: modern,
      apiReady: modern && data.api_configured !== false,
      data: data,
    };
  }

  function rememberHealth(health) {
    state.health = health;
    state.healthAt = Date.now();
    return health;
  }

  function cachedHealthFresh() {
    return state.health && Date.now() - state.healthAt < HEALTH_CACHE_MS;
  }

  function probeHealth(base) {
    var url = (base || "") + "/api/health";
    return fetchWithTimeout(url, { cache: "no-store" }, HEALTH_TIMEOUT_MS)
      .then(function (r) {
        if (!r.ok) throw new Error("offline");
        return r.json();
      })
      .then(function (data) {
        var health = parseHealth(data);
        if (health.serverOnline && base) adoptApiBase(base);
        return rememberHealth(health);
      });
  }

  function delay(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function localHealthCandidates() {
    var candidates = [];
    if (location.protocol !== "file:") candidates.push("");
    if (isLocalDev()) {
      [LOCAL_GALLERY, LOCAL_GALLERY_ALT].forEach(function (base) {
        if (candidates.indexOf(base) < 0) candidates.push(base);
      });
    }
    var configured = apiBase();
    if (configured && candidates.indexOf(configured) < 0) candidates.push(configured);
    return candidates;
  }

  function probeBestHealth(candidates) {
    return Promise.all(
      candidates.map(function (base) {
        return probeHealth(base).catch(function () {
          return null;
        });
      })
    ).then(function (results) {
      var ready = null;
      var online = null;
      results.forEach(function (health) {
        if (!health) return;
        if (health.apiReady) ready = health;
        else if (health.serverOnline && !online) online = health;
      });
      if (ready) return rememberHealth(ready);
      if (online) return rememberHealth(online);
      return rememberHealth({ serverOnline: false, apiReady: false, data: null });
    });
  }

  function apiOfflineMessage() {
    if (window.SPELLFORGE_LOCAL_GENERATE === true) {
      return "Local-only mode is on — set SPELLFORGE_LOCAL_GENERATE to false in spellforge-config.js to use AI generation.";
    }
    var health = state.health;
    if (health && health.serverOnline && !health.apiReady) {
      return "Gallery server is running but no AI key is configured — set XAI_API_KEY (or WOMBO) and restart start_server.bat.";
    }
    if (location.protocol === "file:") {
      return "Open via the gallery server — run start_server.bat, then http://localhost:8765/#fleeting-idea (don't open index.html directly).";
    }
    if (isLocalDev() && location.port && location.port !== "8765") {
      return (
        "This page is on port " + location.port + ", not the gallery server — open http://localhost:8765/#fleeting-idea and hard-refresh (Ctrl+Shift+R)."
      );
    }
    if (isLocalDev()) {
      return "Gallery server not responding — run start_server.bat in the gallery folder, wait for \"Starting gallery server\", then open http://localhost:8765/#fleeting-idea and hard-refresh (Ctrl+Shift+R).";
    }
    return "API offline — open http://localhost:8765 or set SPELLFORGE_API_BASE in spellforge-config.js.";
  }

  function stasisText() {
    if (window.FleetingIdea && window.FleetingIdea.getStasis) {
      var composed = window.FleetingIdea.getStasis();
      if (composed && composed.trim()) return composed.trim();
    }
    return "";
  }

  function userPromptText() {
    if (window.FleetingIdea && window.FleetingIdea.getUserPrompt) {
      return window.FleetingIdea.getUserPrompt() || "";
    }
    var el = $("fi-prompt");
    return el && el.value ? el.value.trim() : "";
  }

  function paintingNumsFromSlots() {
    if (window.FleetingIdea && window.FleetingIdea.getSheetPaintingNums) {
      var fromStage = window.FleetingIdea.getSheetPaintingNums();
      if (fromStage.length) return fromStage;
    }
    if (!window.FleetingAcquired || !window.FleetingAcquired.getSlots) return [];
    var nums = [];
    window.FleetingAcquired.getSlots().forEach(function (slot) {
      if (slot.paintingNum && nums.indexOf(slot.paintingNum) < 0) nums.push(slot.paintingNum);
    });
    return nums.sort(function (a, b) {
      return a - b;
    });
  }

  function setStatus(msg, isError) {
    var el = $("fi-generate-status");
    if (!el) return;
    el.textContent = msg || "";
    var isPending = !!(msg && /generating|capturing|refining|fusing|loading|working|painting/i.test(msg));
    el.className =
      "fi-generate-status" + (isError ? " error" : isPending ? " pending" : msg ? " ok" : "");
  }

  function releaseGenerating(flashBtn) {
    state.generating = false;
    if (state.flashWatchdog) {
      clearTimeout(state.flashWatchdog);
      state.flashWatchdog = null;
    }
    if (flashBtn) flashBtn.disabled = false;
    var genBtn = $("fi-generate-vision");
    if (genBtn) genBtn.disabled = false;
  }

  function showVision(url, opts) {
    opts = opts || {};
    if (!url) {
      state.visionUrl = "";
      if (window.FleetingIdea && window.FleetingIdea.setStageImage) {
        window.FleetingIdea.setStageImage("");
      }
      return;
    }
    var addToGlass = opts.addToGlass !== false;
    state.visionUrl = url;
    if (window.FleetingIdea && window.FleetingIdea.setStageImage) {
      window.FleetingIdea.setStageImage(url, {
        addToGlass: addToGlass,
        label: opts.label || "generated",
      });
    } else {
      window.dispatchEvent(
        new CustomEvent("fi-stage-image", {
          detail: { url: url, addToGlass: addToGlass, label: opts.label || "generated" },
        })
      );
    }
  }

  function validateVisionUrl(url) {
    if (!url) return Promise.reject(new Error("No image returned."));
    if (window.FleetingIdea && window.FleetingIdea.validateImageUrl) {
      return window.FleetingIdea.validateImageUrl(url).then(function () { return url; });
    }
    return new Promise(function (resolve, reject) {
      var img = new Image();
      try {
        if (new URL(url, location.href).origin !== location.origin) img.crossOrigin = "anonymous";
      } catch (e) {
        if (url.indexOf("data:") !== 0 && url.indexOf("blob:") !== 0) img.crossOrigin = "anonymous";
      }
      img.onload = function () {
        if (window.FleetingIdea && window.FleetingIdea.imageHasVisibleInk) {
          if (!window.FleetingIdea.imageHasVisibleInk(img)) {
            reject(new Error("Generated image was blank — not added."));
            return;
          }
        } else if (!(img.naturalWidth > 0 && img.naturalHeight > 0)) {
          reject(new Error("Generated image was empty — not added."));
          return;
        }
        resolve(url);
      };
      img.onerror = function () { reject(new Error("Could not load generated image.")); };
      img.src = url;
    });
  }

  function applyVisionUrl(url, opts) {
    if (!url) return Promise.resolve();
    opts = opts || {};
    return validateVisionUrl(url)
      .then(function (validUrl) {
        showVision(validUrl, {
          addToGlass: opts.addToGlass !== false,
          label: opts.label || "generated",
        });
        setStatus("Vision ready.");
        if (window.FleetingAcquired && window.FleetingAcquired.notifyGeneratedAdded) {
          window.FleetingAcquired.notifyGeneratedAdded(validUrl);
        }
        window.dispatchEvent(new CustomEvent("fi-generated-new", { detail: { url: validUrl } }));
      })
      .catch(function (err) {
        setStatus(err.message || "Blank image rejected — not added to the glass.", true);
        if (window.FleetingIdea && window.FleetingIdea.enforceNoBlankImageLayers) {
          window.FleetingIdea.enforceNoBlankImageLayers({ silent: true });
        } else if (window.FleetingIdea && window.FleetingIdea.purgeEmptyImageLayers) {
          window.FleetingIdea.purgeEmptyImageLayers({ silent: true });
        }
      });
  }

  function useActiveSlotAsFloor() {
    if (!window.FleetingAcquired) return;
    var slots = window.FleetingAcquired.getSlots();
    var active = window.FleetingAcquired.getActiveSlot ? window.FleetingAcquired.getActiveSlot() : 0;
    var slot =
      slots[active] ||
      slots.find(function (s) {
        return s && s.url;
      });
    if (!slot || !slot.url) {
      setStatus("Pick an image in the Library first.", true);
      return;
    }
    setStatus("Loading slot image…");
    applyVisionUrl(slot.url, { addToGlass: true, label: "slot" });
  }

  function fetchWithTimeout(url, options, timeoutMs) {
    timeoutMs = timeoutMs || FETCH_TIMEOUT_MS;
    if (typeof AbortSignal !== "undefined" && AbortSignal.timeout) {
      options = options || {};
      options.signal = AbortSignal.timeout(timeoutMs);
      return fetch(url, options);
    }
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        reject(new Error("Request timed out."));
      }, timeoutMs);
      fetch(url, options)
        .then(function (r) {
          clearTimeout(timer);
          resolve(r);
        })
        .catch(function (err) {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  function pollImageJob(jobId, attemptsLeft) {
    if (attemptsLeft == null) attemptsLeft = 80;
    if (attemptsLeft <= 0) return Promise.reject(new Error("Generation timed out."));
    return fetchWithTimeout(apiUrl("/api/jobs/" + jobId), {}, 20000)
      .then(function (r) {
        return r.json();
      })
      .then(function (job) {
        setStatus("Generating… (" + (job.status || "working") + ")");
        if (job.status === "done") {
          var img = job.image || (job.images && job.images[0]);
          if (img && img.url) return img.url;
          throw new Error("No image returned.");
        }
        if (job.status === "failed") {
          throw new Error((job.error && job.error.message) || "Generation failed.");
        }
        return new Promise(function (resolve) {
          setTimeout(resolve, 1000);
        }).then(function () {
          return pollImageJob(jobId, attemptsLeft - 1);
        });
      });
  }

  function prepareReferenceImage(dataUrl) {
    if (!dataUrl) return Promise.resolve("");
    if (window.FleetingIdea && window.FleetingIdea.prepareCaptureForApi) {
      return window.FleetingIdea.prepareCaptureForApi(dataUrl);
    }
    if (window.FleetingIdea && window.FleetingIdea.compressDataUrl) {
      return window.FleetingIdea.compressDataUrl(dataUrl, 960, 0.78);
    }
    return Promise.resolve(dataUrl);
  }

  function buildGenerateBody(nums, opts) {
    opts = opts || {};
    var stasis = stasisText() || opts.stasisFallback || "Fleeting idea fusion";
    var body = {
      stasis: stasis,
      buzz_words: [],
      spells: nums || [],
    };
    var prompt = userPromptText();
    if (prompt) body.prompt = prompt;
    if (opts.reference_image) body.reference_image = opts.reference_image;
    if (opts.refine) body.refine = true;
    return body;
  }

  function generateLocal(nums) {
    if (!window.composeStasisVisionLocal) {
      return Promise.reject(new Error("Local fusion unavailable."));
    }
    setStatus("Fusing equipped paintings…");
    return window
      .composeStasisVisionLocal({
        spells: nums,
        stasis: stasisText() || "Fleeting idea fusion",
        buzz_words: [],
      })
      .then(function (dataUrl) {
        return applyVisionUrl(dataUrl);
      });
  }

  function fetchVisionUrl(nums, opts) {
    opts = opts || {};
    var jobId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : "fi-" + Date.now();
    setStatus(opts.statusMsg || "Generating vision (API)…");
    var refWork = opts.reference_image
      ? prepareReferenceImage(opts.reference_image).then(function (compressed) {
          opts.reference_image = compressed;
        })
      : Promise.resolve();
    return refWork.then(function () {
      return fetchWithTimeout(
        apiUrl("/api/generate-stasis-vision"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildGenerateBody(nums, opts)),
        },
        FETCH_TIMEOUT_MS
      );
    })
      .then(function (r) {
        if (r.status === 202) {
          return r.json().then(function (d) {
            return pollImageJob((d && d.job_id) || jobId);
          });
        }
        return r.json().then(function (d) {
          if (!r.ok) throw new Error((d && d.error) || "Generate failed");
          var img = d.image || (d.images && d.images[0]);
          if (img && img.url) return img.url;
          throw new Error("No image returned.");
        });
      });
  }

  function generateCloud(nums, opts) {
    return fetchVisionUrl(nums, opts).then(function (url) {
      return applyVisionUrl(url, opts);
    });
  }

  function regenerateLayer(layerId) {
    if (state.generating) {
      setStatus("Already generating…", true);
      return Promise.resolve();
    }
    if (!window.FleetingIdea || !window.FleetingIdea.getLayer) {
      setStatus("Layer unavailable.", true);
      return Promise.resolve();
    }
    var obj = window.FleetingIdea.getLayer(layerId);
    if (!obj || obj.type !== "image" || obj.isPip) return Promise.resolve();

    state.generating = true;
    setStatus("Regenerating layer…");
    var genBtn = $("fi-generate-vision");
    if (genBtn) genBtn.disabled = true;

    var generated = window.FleetingIdea.layerIsGenerated(obj);
    var reloadUrl = obj.url;
    if (obj.paintingNum && window.FleetingAcquired && window.FleetingAcquired.getSlots) {
      var slot = window.FleetingAcquired.getSlots().find(function (s) {
        return s && s.paintingNum === obj.paintingNum && s.url;
      });
      if (slot) reloadUrl = slot.url;
    }

    function runApiRegenerate() {
      var lastCapture =
        window.FleetingIdea.getLastCapture ? window.FleetingIdea.getLastCapture() : "";
      return checkApiReady()
        .then(function (ready) {
          if (window.SPELLFORGE_LOCAL_GENERATE === true) {
            throw new Error(
              "Local-only mode is on — set SPELLFORGE_LOCAL_GENERATE to false in spellforge-config.js to use AI generation."
            );
          }
          if (!ready) throw new Error(apiOfflineMessage());
          return fetchVisionUrl([], {
            reference_image: lastCapture || undefined,
            refine: !!lastCapture,
            statusMsg: "Regenerating layer vision…",
          });
        })
        .then(function (url) {
          return window.FleetingIdea.replaceLayerImage(layerId, url, {
            label: "generated",
            loadFailed: false,
          }).then(function (ok) {
            if (!ok) throw new Error("Generated image was empty.");
            setStatus("Layer regenerated.");
            if (window.FleetingAcquired && window.FleetingAcquired.notifyGeneratedAdded) {
              window.FleetingAcquired.notifyGeneratedAdded(url);
            }
            window.dispatchEvent(new CustomEvent("fi-generated-new", { detail: { url: url } }));
          });
        });
    }

    var work = window.FleetingIdea.reloadLayerImage(layerId, reloadUrl).then(function (ok) {
      var refreshed = window.FleetingIdea.getLayer(layerId);
      if (ok && refreshed && !window.FleetingIdea.imageLayerLooksEmpty(refreshed)) {
        setStatus("Layer reloaded.");
        return;
      }
      if (!generated) {
        setStatus(
          ok ? "Reloaded but image still empty — check the slot or file." : "Could not reload image — check the file or slot.",
          !ok
        );
        return;
      }
      return runApiRegenerate();
    });

    return Promise.resolve(work)
      .catch(function (err) {
        setStatus(err.message || "Regenerate failed.", true);
      })
      .finally(function () {
        releaseGenerating(null);
      });
  }

  function checkApiReady(force) {
    if (!force && cachedHealthFresh() && state.health.apiReady) {
      return Promise.resolve(true);
    }

    function tryDiscover() {
      return probeBestHealth(localHealthCandidates());
    }

    return tryDiscover()
      .catch(function () {
        return delay(400).then(tryDiscover);
      })
      .catch(function () {
        return delay(1000).then(tryDiscover);
      })
      .then(function (health) {
        return !!(health && health.apiReady);
      })
      .catch(function () {
        rememberHealth({ serverOnline: false, apiReady: false, data: null });
        return false;
      });
  }

  function warmApiConnection() {
    checkApiReady(true).then(function (ready) {
      if (ready) {
        setStatus("");
        return;
      }
      setStatus(apiOfflineMessage(), true);
    });
  }

  function refineFromCapture(capturedUrl) {
    var stasis =
      (stasisText() || "Overhead projection") +
      " · refine this glass composition into polished fine-art imagery";
    return checkApiReady().then(function (ready) {
      if (!ready) {
        setStatus("API offline — showing raw OHP capture.", true);
        return applyVisionUrl(capturedUrl, { addToGlass: true, label: "capture" });
      }
      return generateCloud([], {
        reference_image: capturedUrl,
        refine: true,
        stasisFallback: stasis,
        statusMsg: "Refining overhead capture…",
      }).catch(function (err) {
        setStatus("Refine failed — showing raw capture. " + (err.message || ""), true);
        return applyVisionUrl(capturedUrl, { addToGlass: true, label: "capture" });
      });
    });
  }

  function flashFrameProject() {
    if (state.generating) return;
    if (!window.FleetingIdea || !window.FleetingIdea.captureProjection) {
      setStatus("Overhead capture unavailable.", true);
      return;
    }
    state.generating = true;
    setStatus("Capturing OHP frame…");
    var flashBtn = $("fi-flash-frame");
    if (flashBtn) flashBtn.disabled = true;
    state.flashWatchdog = setTimeout(function () {
      releaseGenerating(flashBtn);
      setStatus("Flash & project timed out — try again.", true);
    }, FLASH_TIMEOUT_MS);
    if (window.FleetingIdea.recompose) window.FleetingIdea.recompose();

    new Promise(function (resolve) {
      requestAnimationFrame(function () {
        requestAnimationFrame(resolve);
      });
    })
      .then(function () {
        return window.FleetingIdea.captureProjection({ flash: true });
      })
      .then(function (capturedUrl) {
        setStatus("Captured OHP frame — refining…");
        return refineFromCapture(capturedUrl);
      })
      .catch(function (err) {
        setStatus(err.message || "Could not flash project.", true);
      })
      .finally(function () {
        releaseGenerating(flashBtn);
      });
  }

  function generateWalkFloor() {
    if (state.generating) return;
    var stasis = stasisText();
    var prompt = userPromptText();
    if (!stasis && !prompt) {
      setStatus("Compose stasis on the glass or type a prompt below the OHP first.", true);
      return;
    }
    state.generating = true;
    setStatus("Generating from stasis…");
    var btn = $("fi-generate-vision");
    if (btn) btn.disabled = true;
    var lastCapture =
      window.FleetingIdea && window.FleetingIdea.getLastCapture
        ? window.FleetingIdea.getLastCapture()
        : "";
    var work = checkApiReady().then(function (ready) {
      if (window.SPELLFORGE_LOCAL_GENERATE === true) {
        return Promise.reject(
          new Error("Local-only mode is on — set SPELLFORGE_LOCAL_GENERATE to false in spellforge-config.js to use AI generation.")
        );
      }
      if (!ready) {
        return Promise.reject(new Error(apiOfflineMessage()));
      }
      return generateCloud([], {
        reference_image: lastCapture || undefined,
        refine: !!lastCapture,
        statusMsg: lastCapture ? "Generating from stasis + OHP capture…" : "Generating from stasis + prompt…",
      });
    });
    Promise.resolve(work)
      .catch(function (err) {
        setStatus(err.message || "Could not generate.", true);
      })
      .finally(function () {
        releaseGenerating(null);
      });
  }

  function prepareFleetingTabloidPrint() {
    if (!window.TabloidPrint || !window.FleetingIdea) return;
    var btn = $("fi-tabloid-print");
    if (btn) btn.disabled = true;
    Promise.resolve(window.FleetingIdea.captureProjection({ flash: false }))
      .then(function (dataUrl) {
        return window.TabloidPrint.prepare({
          image: dataUrl,
          title: "Fleeting Idea",
          subtitle: "OHP composition",
          caption: window.FleetingIdea.getStasis() || "",
          source: "Fleeting Idea",
          filename: "fleeting-idea-composition",
        });
      })
      .catch(function (err) {
        setStatus(err.message || "Add layers on the glass before printing.", true);
      })
      .finally(function () {
        if (btn) btn.disabled = false;
      });
  }

  function bind() {
    var flashBtn = $("fi-flash-frame");
    var genBtn = $("fi-generate-vision");
    var useBtn = $("fi-use-slot-vision");
    var printBtn = $("fi-tabloid-print");
    if (flashBtn) flashBtn.addEventListener("click", flashFrameProject);
    if (genBtn) genBtn.addEventListener("click", generateWalkFloor);
    if (useBtn) useBtn.addEventListener("click", useActiveSlotAsFloor);
    if (printBtn) printBtn.addEventListener("click", prepareFleetingTabloidPrint);
    warmApiConnection();
  }

  window.FleetingWalk = {
    generate: generateWalkFloor,
    checkApiReady: checkApiReady,
    retryConnection: function () {
      state.health = null;
      state.healthAt = 0;
      return checkApiReady(true);
    },
    regenerateLayer: regenerateLayer,
    flashProject: flashFrameProject,
    useActiveSlot: useActiveSlotAsFloor,
    setVision: applyVisionUrl,
    setCompassTextures: function () {},
    setCompassTexture: function () {},
    refreshPortraits: function () {},
    start: function () {},
    stop: function () {},
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();