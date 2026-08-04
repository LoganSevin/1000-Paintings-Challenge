/**
 * Logan — personal stock photos fused with gallery spell style → images & living clips.
 */
(function () {
  "use strict";

  var STORAGE_KEY = "logan-stock-v1";
  var ATTIRE_STORAGE_KEY = "logan-keep-attire-v1";
  var PROMPT_MEMORY_STORAGE_KEY = "logan-prompt-memory-v1";
  var SCENES_STORAGE_KEY = "logan-scenes-v1";
  var SCENE_SECONDARY_STORAGE_KEY = "logan-scene-secondary-v1";
  var MAX_SCENES = 30;
  var TRAY_SLICE = 36;
  var MAX_STOCK = 12;
  var MAX_STYLE_SPELLS = 6;
  var MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
  var FETCH_TIMEOUT_MS = 120000;
  var POLL_INTERVAL_MS = 900;
  var FIRST_POLL_DELAY_MS = 600;
  var VIDEO_POLL_MS = 800;
  var VIDEO_POLL_MAX_MS = 12 * 60 * 1000;
  var CLIP_SEC = 6;
  var LIFE_PLAYBACK_ACCEL = 1.0;
  var LIFE_CAPTURE_FPS = 30;

  var DEFAULT_SCENES = [
    {
      id: "in-painting",
      label: "Inside the painting",
      hint: "You stepping into a spell world",
      prefix: "Logan enters a living painting from the 1000 Paintings Challenge — ",
      motion:
        "Logan steps through wet pigment into the spell world — brushstrokes ripple at his feet, mural light blooms around him, he breathes and turns as painted atmosphere swirls with gallery energy.",
    },
    {
      id: "studio",
      label: "Studio portrait",
      hint: "Full-figure fine-art self-portrait",
      prefix: "Logan full-body studio self-portrait — painter of the challenge, ",
      motion:
        "Logan holds a painter's stance — subtle weight shift, confident blink, fabric and brush bristles catch shifting studio light, glaze shimmers across the canvas behind him.",
    },
    {
      id: "portal",
      label: "Portal leap",
      hint: "Jumping between mural dimensions",
      prefix: "Logan leaps through a glowing spell portal — ",
      motion:
        "Logan launches through a radiant portal — hair and clothes whip in dimensional wind, spell colors streak past, he lands with kinetic painterly impact as worlds fold behind him.",
    },
    {
      id: "duel",
      label: "Spell duel",
      hint: "You casting against your own art",
      prefix: "Logan in spell duel — channeling gallery paintings, ",
      motion:
        "Logan channels gallery spells — hands trace arcs of living pigment, sparks of brush DNA burst from his paintings, he parries and casts with bold full-body choreography.",
    },
    {
      id: "mural",
      label: "Mural walk",
      hint: "Walking your own gallery floor",
      prefix: "Logan walks the mural floor among his paintings — ",
      motion:
        "Logan strides the mural floor — paintings breathe on the walls, floor reflections ripple under his steps, he glances at his own spell worlds as light crawls across the gallery.",
    },
  ];

  var LIFE_TEMPO_HINT =
    "MOTION TEMPO: normal real-time speed — NOT slow motion. Logan's BODY performs clear choreography in the first second — arms, hands, legs, torso, head. TikTok energy.";

  var ANTI_IDLE_BLOCK =
    "FORBIDDEN: idle stance, frozen pose, statue stillness, mannequin freeze, only blinking/breathing, subtle micromotion only.";

  var FACE_IDENTITY_BLOCK =
    "CRITICAL IDENTITY LOCK — The subject MUST be the exact same person as reference_photo / stock photo: " +
    "same face shape, eyes, eyebrows, nose, mouth, lips, jawline, cheekbones, skin tone, age, hairline, hair color and hairstyle. " +
    "Do NOT substitute a different model, celebrity, or generic face. This is Logan — preserve his recognizable identity.";

  var FULL_BODY_FRAMING =
    "FRAMING — FULL BODY DEFAULT: Show Logan head-to-toe (minimum knees-up heroic full figure). " +
    "Entire body visible — head, torso, arms, legs, and feet when possible. Match body proportions from the stock photo. " +
    "BAN: face-only crop, bust shot, shoulders-up, headshot, tight face zoom, passport crop.";

  var CLOSEUP_FRAMING =
    "FRAMING — CLOSE-UP REQUESTED: User asked for tight framing; honor their crop while keeping Logan's exact face identity from stock.";

  var ATTIRE_KEEP_BLOCK =
    "ATTIRE LOCK — KEEP STOCK CLOTHES: Copy Logan's exact outfit from reference_photo / stock photo — same garments, colors, fabrics, layers, accessories, shoes, and silhouette. " +
    "Paint the clothes with spell-style brush handling but do NOT replace, redesign, or fantasy-reskin the wardrobe. Style spells affect background and atmosphere only, not wardrobe.";

  var ATTIRE_CONJURE_BLOCK =
    "ATTIRE — CONJURE OUTFIT: Invent a new painterly costume for Logan inspired by the style-spell rack — bold spell-world wardrobe, palette, and textures. " +
    "Face and body proportions still locked to stock photo; only the clothing may be reimagined.";

  var REF_MAX_SIDE = 1536;
  var REF_QUALITY = 0.92;
  var VIDEO_FETCH_TIMEOUT_MS = 180000;

  var state = {
    pool: [],
    poolReady: false,
    trayItems: [],
    stock: [],
    activeStockId: "",
    styleSpells: [],
    sceneId: "in-painting",
    scenes: [],
    sceneSecondary: true,
    styleBlend: 30,
    keepAttire: true,
    promptMemory: true,
    aspect: "16:9",
    previewMode: "image",
    prompt: "",
    creation: { imageUrl: "", videoUrl: "", playUrl: "", videoBlob: null, id: "" },
    history: [],
    forging: false,
    drag: null,
    active: false,
    videoResumeBound: false,
    blobUrls: [],
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

  function delay(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function escapeHtml(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function uniqueId() {
    return "lo-" + Date.now() + "-" + Math.floor(Math.random() * 1e6);
  }

  function shuffle(arr) {
    var copy = arr.slice();
    var i;
    for (i = copy.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = copy[i];
      copy[i] = copy[j];
      copy[j] = t;
    }
    return copy;
  }

  function trackBlobUrl(url) {
    if (url && url.indexOf("blob:") === 0) state.blobUrls.push(url);
  }

  function absoluteUrl(url) {
    if (!url) return "";
    if (url.indexOf("blob:") === 0 || url.indexOf("data:") === 0) return url;
    if (/^https?:\/\//i.test(String(url))) {
      try {
        return new URL(url).href;
      } catch (eAbs) {
        return String(url);
      }
    }
    var apiBase = String(window.SPELLFORGE_API_BASE || "").replace(/\/$/, "");
    if (apiBase) {
      try {
        return new URL(url, apiBase + "/").href;
      } catch (eApi) {}
    }
    try {
      return new URL(url, window.location.href).href;
    } catch (e) {
      return String(url);
    }
  }

  function isSameOriginUrl(url) {
    try {
      return new URL(url, window.location.href).origin === window.location.origin;
    } catch (e) {
      return false;
    }
  }

  function mediaProxyUrl(url) {
    url = absoluteUrl(url);
    if (!url || url.indexOf("blob:") === 0 || url.indexOf("data:") === 0) return url;
    if (isSameOriginUrl(url)) return url;
    var proxyPath = "/api/proxy-media?url=" + encodeURIComponent(url);
    try {
      return new URL(proxyPath, window.location.href).href;
    } catch (eProxy) {
      return proxyPath;
    }
  }

  function parseVideoFetchError(res, bodyText) {
    var msg = "Video fetch failed (" + (res && res.status) + ")";
    if (bodyText) {
      try {
        var j = JSON.parse(bodyText);
        if (j && j.error) msg = String(j.error);
      } catch (eJson) {
        if (bodyText.length < 200) msg = bodyText;
      }
    }
    return new Error(msg);
  }

  function fetchVideoBlobFromUrl(fetchUrl) {
    return fetchWithTimeout(fetchUrl, { cache: "no-store", credentials: "same-origin" }, VIDEO_FETCH_TIMEOUT_MS).then(
      function (r) {
        if (!r.ok) {
          return r.text().then(function (text) {
            throw parseVideoFetchError(r, text);
          });
        }
        var ct = (r.headers.get("content-type") || "").toLowerCase();
        if (ct.indexOf("json") >= 0) {
          return r.json().then(function (j) {
            throw new Error((j && j.error) || "Video proxy returned an error.");
          });
        }
        return r.blob();
      }
    );
  }

  function resolveVideoBlob(url) {
    url = absoluteUrl(url);
    if (!url) return Promise.reject(new Error("No video URL."));
    if (url.indexOf("blob:") === 0) {
      return fetchVideoBlobFromUrl(url);
    }

    var proxyUrl = mediaProxyUrl(url);
    return fetchVideoBlobFromUrl(proxyUrl)
      .then(function (blob) {
        if (!blob || !blob.size) throw new Error("Video file is empty.");
        return blob;
      })
      .catch(function (proxyErr) {
        if (proxyUrl === url) throw proxyErr;
        return fetchVideoBlobFromUrl(url)
          .then(function (blob) {
            if (!blob || !blob.size) throw proxyErr;
            return blob;
          })
          .catch(function () {
            throw proxyErr;
          });
      });
  }

  function setStatus(msg, kind) {
    var el = $("lo-status");
    if (!el) return;
    el.textContent = msg || "";
    el.className = "lo-status" + (kind ? " " + kind : "");
  }

  function getActiveStock() {
    var i;
    for (i = 0; i < state.stock.length; i++) {
      if (state.stock[i].id === state.activeStockId) return state.stock[i];
    }
    return state.stock[0] || null;
  }

  function cloneDefaultScenes() {
    return DEFAULT_SCENES.map(function (s) {
      return {
        id: s.id,
        label: s.label,
        hint: s.hint,
        prefix: s.prefix,
        motion: s.motion,
      };
    });
  }

  function normalizeScene(raw) {
    raw = raw || {};
    var label = String(raw.label || raw.name || "Custom scene").trim() || "Custom scene";
    return {
      id: String(raw.id || slugifySceneId(label)).trim() || slugifySceneId(label),
      label: label,
      hint: String(raw.hint || raw.description || "").trim(),
      prefix: String(raw.prefix || raw.push || "").trim(),
      motion: String(raw.motion || raw.action || "").trim(),
    };
  }

  function slugifySceneId(name) {
    var text = String(name || "scene")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);
    return text || "scene-" + Date.now();
  }

  function ensureUniqueSceneId(id, ignoreId) {
    id = slugifySceneId(id);
    var taken = {};
    state.scenes.forEach(function (s) {
      if (s.id !== ignoreId) taken[s.id] = true;
    });
    if (!taken[id]) return id;
    var n = 2;
    while (taken[id + "-" + n]) n++;
    return id + "-" + n;
  }

  function loadScenes() {
    try {
      var raw = localStorage.getItem(SCENES_STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && parsed.length) {
          state.scenes = parsed.map(normalizeScene);
          if (!state.scenes.some(function (s) {
            return s.id === state.sceneId;
          })) {
            state.sceneId = state.scenes[0].id;
          }
          return;
        }
      }
    } catch (eScenes) {}
    state.scenes = cloneDefaultScenes();
    if (!state.scenes.some(function (s) {
      return s.id === state.sceneId;
    })) {
      state.sceneId = state.scenes[0] ? state.scenes[0].id : "in-painting";
    }
  }

  function persistScenes() {
    try {
      localStorage.setItem(SCENES_STORAGE_KEY, JSON.stringify(state.scenes));
    } catch (eSaveScenes) {
      setStatus("Could not save scenes — storage may be full.", "error");
    }
  }

  function loadSceneSecondaryPreference() {
    try {
      var raw = localStorage.getItem(SCENE_SECONDARY_STORAGE_KEY);
      if (raw === "0" || raw === "false") state.sceneSecondary = false;
      else if (raw === "1" || raw === "true") state.sceneSecondary = true;
    } catch (eSec) {}
  }

  function persistSceneSecondaryPreference() {
    try {
      localStorage.setItem(SCENE_SECONDARY_STORAGE_KEY, state.sceneSecondary ? "1" : "0");
    } catch (eSaveSec) {}
  }

  function getSceneById(id) {
    var i;
    for (i = 0; i < state.scenes.length; i++) {
      if (state.scenes[i].id === id) return state.scenes[i];
    }
    return null;
  }

  function getScene() {
    return getSceneById(state.sceneId) || state.scenes[0] || DEFAULT_SCENES[0];
  }

  function escapeRegex(text) {
    return String(text || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function expandSceneTokens(text, activeScene) {
    text = String(text || "");
    if (!text) return "";
    activeScene = activeScene || getScene();
    var sceneMap = {};
    state.scenes.forEach(function (s) {
      sceneMap[s.id] = s;
    });

    text = text.replace(/\{scene\.(label|hint|prefix|motion)\}/gi, function (_m, field) {
      var key = String(field || "").toLowerCase();
      return (activeScene && activeScene[key]) || "";
    });

    state.scenes.forEach(function (s) {
      ["label", "hint", "prefix", "motion"].forEach(function (field) {
        var re = new RegExp("\\{" + escapeRegex(s.id) + "\\." + field + "\\}", "gi");
        text = text.replace(re, s[field] || "");
      });
      var shortRe = new RegExp("\\{" + escapeRegex(s.id) + "\\}", "gi");
      text = text.replace(shortRe, s.prefix || s.hint || s.label || "");
    });

    text = text.replace(/@scene(?::([a-z0-9_-]+))?/gi, function (_m, id) {
      var sc = id ? sceneMap[String(id).toLowerCase()] || getSceneById(String(id).toLowerCase()) : activeScene;
      if (!sc) return "";
      return [sc.prefix, sc.hint, sc.motion].filter(Boolean).join(" — ");
    });

    return text.replace(/\s+/g, " ").trim();
  }

  function prepareUserPrompt(raw, scene) {
    return expandSceneTokens(String(raw || "").trim(), scene || getScene());
  }

  function buildSceneSecondaryBlock(scene) {
    if (!state.sceneSecondary || !scene) return "";
    var bits = [
      "SECONDARY SCENE PUSH (" + scene.label + ")",
      scene.hint,
      scene.prefix,
      "Supporting context only — user prompt takes priority; do not override the user's words.",
    ].filter(Boolean);
    return bits.join(" ");
  }

  function buildSceneMotionFallback(scene, userPrompt) {
    if (String(userPrompt || "").trim()) return "";
    return scene && scene.motion ? "Scene motion default: " + scene.motion : "";
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

  function imageUrlToDataUrl(url) {
    if (!url) return Promise.resolve("");
    if (url.indexOf("data:") === 0) return Promise.resolve(url);
    return fetch(url)
      .then(function (r) {
        return r.blob();
      })
      .then(function (blob) {
        return new Promise(function (resolve, reject) {
          var reader = new FileReader();
          reader.onload = function () {
            resolve(reader.result);
          };
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      })
      .catch(function () {
        return url;
      });
  }

  function persistStock() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.stock));
    } catch (e) {
      setStatus("Could not save all photos — storage full. Remove a few.", "error");
    }
  }

  function loadStock() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) state.stock = JSON.parse(raw) || [];
    } catch (eLoad) {
      state.stock = [];
    }
    if (state.stock.length && !state.activeStockId) state.activeStockId = state.stock[0].id;
  }

  function normalizeSpell(item) {
    var num = item.paintingNum || item.number || 0;
    var analysis = num && window.getGalleryAnalysis ? window.getGalleryAnalysis(num) : item.analysis || null;
    return {
      url: item.url || "",
      label: item.label || (num ? "#" + num : "Spell"),
      paintingNum: num,
      title: item.title || (analysis && analysis.title) || item.label || "",
      description: (analysis && analysis.description) || item.description || "",
      tags: item.tags || (analysis && analysis.tags) || [],
      style: (analysis && analysis.style) || item.style || "",
      mood: (analysis && analysis.mood) || item.mood || "",
    };
  }

  function spellRow(m) {
    var num = m.number;
    return normalizeSpell({
      number: num,
      url: window.getPaintingUrl ? window.getPaintingUrl(num) : "paintings/" + num + ".jpg",
      paintingNum: num,
      label: "#" + num,
    });
  }

  function paintingNumsFromStyles() {
    return state.styleSpells
      .map(function (s) {
        return s.paintingNum;
      })
      .filter(Boolean);
  }

  function buildBuzz() {
    var buzz = ["logan", "self portrait", "1000 paintings challenge", "artist fusion"];
    state.styleSpells.forEach(function (s) {
      (s.tags || []).slice(0, 2).forEach(function (t) {
        if (buzz.indexOf(t) < 0) buzz.push(t);
      });
    });
    return buzz;
  }

  function faceLikenessPercent() {
    return 100 - state.styleBlend;
  }

  function wantsCloseUp(userPrompt) {
    var p = String(userPrompt || "").toLowerCase();
    return /\b(close[\s-]?up|closeup|headshot|head shot|bust shot|bust only|face only|tight (face|crop|shot)|shoulders up|shoulder-up|from the neck up|neck up|macro face|extreme close|\bcu\b|\becu\b|facial detail only|portrait crop|tight portrait)\b/i.test(
      p
    );
  }

  function buildFramingDirective(userPrompt) {
    return wantsCloseUp(userPrompt) ? CLOSEUP_FRAMING : FULL_BODY_FRAMING;
  }

  function buildAttireDirective() {
    return state.keepAttire ? ATTIRE_KEEP_BLOCK : ATTIRE_CONJURE_BLOCK;
  }

  function buildAttireBuzz() {
    return state.keepAttire
      ? ["keep clothes", "same outfit", "stock attire", "wardrobe lock"]
      : ["conjured outfit", "spell costume", "fantasy wardrobe", "painterly clothes"];
  }

  function loadAttirePreference() {
    try {
      var raw = localStorage.getItem(ATTIRE_STORAGE_KEY);
      if (raw === "conjure") state.keepAttire = false;
      else if (raw === "keep") state.keepAttire = true;
    } catch (eAttire) {}
  }

  function persistAttirePreference() {
    try {
      localStorage.setItem(ATTIRE_STORAGE_KEY, state.keepAttire ? "keep" : "conjure");
    } catch (eSaveAttire) {}
  }

  function renderAttireToggle() {
    var wrap = $("lo-attire");
    if (!wrap) return;
    wrap.querySelectorAll("[data-attire]").forEach(function (btn) {
      var keep = btn.getAttribute("data-attire") === "keep";
      btn.classList.toggle("active", keep === state.keepAttire);
      btn.setAttribute("aria-pressed", keep === state.keepAttire ? "true" : "false");
    });
  }

  function setKeepAttire(keep) {
    state.keepAttire = !!keep;
    persistAttirePreference();
    renderAttireToggle();
    setStatus(
      state.keepAttire
        ? "Attire: keeping clothes from your stock photo."
        : "Attire: conjuring spell-style outfit.",
      "ok"
    );
  }

  function readPromptInput() {
    var el = $("lo-prompt");
    return el && el.value ? el.value.trim() : "";
  }

  function resolveUserPrompt() {
    var input = readPromptInput();
    if (!state.promptMemory) return input;
    return input || String(state.prompt || "").trim();
  }

  function syncPromptState(userPrompt) {
    if (state.promptMemory) state.prompt = userPrompt;
  }

  function loadPromptMemoryPreference() {
    try {
      var raw = localStorage.getItem(PROMPT_MEMORY_STORAGE_KEY);
      if (raw === "fresh") state.promptMemory = false;
      else if (raw === "remember") state.promptMemory = true;
    } catch (ePromptMem) {}
  }

  function persistPromptMemoryPreference() {
    try {
      localStorage.setItem(PROMPT_MEMORY_STORAGE_KEY, state.promptMemory ? "remember" : "fresh");
    } catch (eSavePromptMem) {}
  }

  function updatePromptMemoryUi() {
    var wrap = $("lo-prompt-memory");
    if (wrap) {
      wrap.querySelectorAll("[data-memory]").forEach(function (btn) {
        var remember = btn.getAttribute("data-memory") === "remember";
        btn.classList.toggle("active", remember === state.promptMemory);
        btn.setAttribute("aria-pressed", remember === state.promptMemory ? "true" : "false");
      });
    }
    var hint = $("lo-prompt-memory-hint");
    if (hint) {
      hint.textContent = state.promptMemory
        ? "Remember — reuses your last prompt for animate and restores it from session history."
        : "Fresh only — only the text in the box is sent. History previews won't change your prompt. Re-forge when the scene should match.";
    }
    var input = $("lo-prompt");
    if (input) input.classList.toggle("lo-prompt--fresh", !state.promptMemory);
  }

  function setPromptMemory(remember) {
    state.promptMemory = !!remember;
    persistPromptMemoryPreference();
    updatePromptMemoryUi();
    setStatus(
      state.promptMemory
        ? "Prompt memory on — last prompt carries into animate & history."
        : "Fresh only — only what's in the prompt box is used.",
      "ok"
    );
  }

  function clearPromptField() {
    state.prompt = "";
    var el = $("lo-prompt");
    if (el) {
      el.value = "";
      el.focus();
    }
    setStatus("Prompt cleared.", "ok");
  }

  function buildStasis(scene, userPrompt) {
    var prepared = prepareUserPrompt(userPrompt, scene);
    var likeness = faceLikenessPercent();
    var framing = buildFramingDirective(userPrompt);
    var styleScope = state.keepAttire
      ? "Art style weight ~" +
        state.styleBlend +
        "% — apply brush language, palette, texture, and mood to environment/background/atmosphere ONLY; wardrobe stays stock."
      : "Art style weight ~" +
        state.styleBlend +
        "% — apply brush language, palette, texture, and mood to scene AND conjured wardrobe around the locked face/body.";
    var lines = [
      "LOGAN CREATION — personal stock photo fused with gallery spell DNA.",
      FACE_IDENTITY_BLOCK,
      framing,
      buildAttireDirective(),
      "Active scene: " + scene.label + " (" + scene.id + ").",
      buildSceneSecondaryBlock(scene),
      "Face likeness priority ~" + likeness + "% — reference_photo is the identity anchor; match Logan exactly.",
      styleScope,
      "Style spells inform paint handling — they must NOT replace Logan's face with another person.",
      "Output: ONE cinematic frame starring Logan inside the 1000 Paintings Challenge universe.",
      "BAN: wrong face, face swap, generic model, collage of source paintings, slideshow panels.",
    ];
    state.styleSpells.forEach(function (s, idx) {
      lines.push(
        "[style " +
          (idx + 1) +
          "] #" +
          s.paintingNum +
          " " +
          s.title +
          " — " +
          (s.style || "painterly") +
          ", mood: " +
          (s.mood || "layered")
      );
    });
    lines.push(
      "PRIMARY user prompt: " + (prepared || "Logan in his own painted world.")
    );
    if (scene.motion) lines.push("Scene action variable (" + scene.id + ".motion): " + scene.motion);
    return lines.join("\n");
  }

  function buildCraftHints(scene, userPrompt) {
    var prepared = prepareUserPrompt(userPrompt, scene);
    var parts = [
      FACE_IDENTITY_BLOCK,
      buildFramingDirective(userPrompt),
      buildAttireDirective(),
      "Identity anchor: reference_photo is Logan — preserve his exact face and body proportions in the output.",
      state.keepAttire
        ? "Art direction from spell style rack — palette and brush DNA on environment only; never override face or wardrobe."
        : "Art direction from spell style rack — palette and brush DNA on scene and conjured outfit; never override the face.",
      prepared ? "Primary prompt: " + prepared : "",
      buildSceneSecondaryBlock(scene),
    ];
    state.styleSpells.forEach(function (s) {
      parts.push("#" + s.paintingNum + " " + (s.description || s.title || "").slice(0, 120));
    });
    return parts.join(" ");
  }

  function userPerformanceText(scene, userPrompt) {
    var text = prepareUserPrompt(userPrompt, scene);
    if (text) return text;
    return String((scene && scene.motion) || "Logan performs bold full-body motion in his painted world").trim();
  }

  function buildPerformanceLead(scene, userPrompt) {
    var perf = userPerformanceText(scene, userPrompt);
    return (
      "HIGHEST PRIORITY — MANDATORY VISIBLE PERFORMANCE: Logan MUST visibly perform: " +
      perf +
      ". Full-body choreography required — arms, hands, legs, torso, head, and expression move with clear readable action. " +
      ANTI_IDLE_BLOCK +
      " " +
      LIFE_TEMPO_HINT
    );
  }

  function buildLoganBeats(scene, userPrompt) {
    var text = userPerformanceText(scene, userPrompt);
    if (!text) return [];
    return [
      {
        id: "lo-perf-1",
        order: 1,
        character_id: "logan",
        character: { id: "logan", name: "Logan", preview_url: "" },
        type: "action",
        text: text,
        action: text,
        dialogue: "",
        reaction: "",
        follow_up: false,
      },
    ];
  }

  function clipDurationForPrompt(userPrompt) {
    var text = String(userPrompt || "").trim();
    return text.length > 48 ? 8 : CLIP_SEC;
  }

  function buildAnimateStasis(scene, userPrompt) {
    var perf = userPerformanceText(scene, userPrompt);
    var lines = [
      buildStasis(scene, userPrompt),
      "",
      "[PHOTO-TO-LIFE — DUAL REFERENCE]",
      "reference_image = the forged Logan scene (composition, palette, costume, environment). Animate THIS frame only.",
      "spell_reference_image = Logan's personal stock photo — permanent FACE + BODY identity lock for every frame of motion.",
      "Throughout the clip: Logan's face MUST match spell_reference_image exactly — same eyes, nose, mouth, jaw, skin tone, hairline, hairstyle.",
      buildAttireDirective() + " Wardrobe must stay consistent for the entire clip.",
      "Do NOT morph Logan into a generic model. Do NOT drift from the user's directed performance.",
      "",
      "MANDATORY PERFORMANCE SCRIPT — execute in order:",
      "BEAT 1 — Logan ACTION (visible full-body motion): " + perf,
      ANTI_IDLE_BLOCK,
      LIFE_TEMPO_HINT,
      "Camera locked — NO pan, zoom, Ken Burns, crop drift, or slideshow. No cuts, no new objects, no scene change.",
    ];
    return lines.join("\n");
  }

  function buildAnimatePrompt(scene, userPrompt) {
    var prepared = prepareUserPrompt(userPrompt, scene);
    return (
      buildPerformanceLead(scene, userPrompt) +
      " PRIMARY: " +
      (prepared || "Logan full body inside his painted universe") +
      " " +
      buildSceneSecondaryBlock(scene) +
      " " +
      buildSceneMotionFallback(scene, prepared) +
      " Face locked to spell_reference_image throughout. " +
      buildFramingDirective(userPrompt) +
      " " +
      buildAttireDirective() +
      " Honor style-spell brush DNA from the rack. " +
      " Fixed camera — absolutely NO Ken Burns, pan, zoom, or slideshow."
    );
  }

  function buildAnimateCraftHints(scene, userPrompt) {
    return (
      buildPerformanceLead(scene, userPrompt) +
      " " +
      buildCraftHints(scene, userPrompt) +
      " Photo-to-life: Logan's stock photo (spell_reference_image) anchors face identity — never drift. " +
      ANTI_IDLE_BLOCK
    );
  }

  function buildAnimateBuzz(userPrompt) {
    var perf = String(userPrompt || "").trim();
    var extra = ["photo-to-life", "living painting", "visible action", "body choreography", "not idle"];
    if (perf) {
      perf
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(function (w) {
          return w.length > 3 && extra.indexOf(w) < 0;
        })
        .slice(0, 6)
        .forEach(function (w) {
          extra.push(w);
        });
    }
    return buildBuzz().concat(buildAttireBuzz()).concat(
      wantsCloseUp(userPrompt)
        ? ["face lock", "same person", "logan identity", "close-up"].concat(extra)
        : ["face lock", "same person", "logan identity", "full body", "head to toe"].concat(extra)
    );
  }

  function pollImageJob(jobId, attemptsLeft, firstPoll) {
    if (attemptsLeft == null) attemptsLeft = 90;
    if (attemptsLeft <= 0) return Promise.reject(new Error("Image generation timed out."));
    var pollOnce = function () {
      return fetchWithTimeout(apiUrl("/api/jobs/" + jobId), { cache: "no-store" }, 30000);
    };
    var start = firstPoll ? delay(FIRST_POLL_DELAY_MS).then(pollOnce) : pollOnce();
    return start
      .then(function (r) {
        return parseApiResponse(r);
      })
      .then(function (job) {
        setStatus("Forging your scene… (" + (job.status || "working") + ")", "pending");
        if (job.status === "done") {
          var img = job.image || (job.images && job.images[0]);
          if (img && img.url) return img.url;
          throw new Error("No image returned.");
        }
        if (job.status === "failed") {
          throw new Error((job.error && job.error.message) || "Image generation failed.");
        }
        return delay(POLL_INTERVAL_MS).then(function () {
          return pollImageJob(jobId, attemptsLeft - 1, false);
        });
      });
  }

  function pollVideoJob(jobId, startedAt) {
    startedAt = startedAt || Date.now();
    if (Date.now() - startedAt > VIDEO_POLL_MAX_MS) {
      return Promise.reject(new Error("Video generation timed out."));
    }
    return fetchWithTimeout(apiUrl("/api/jobs/" + jobId), { cache: "no-store" }, 30000)
      .then(function (r) {
        return parseApiResponse(r);
      })
      .then(function (job) {
        setStatus("Bringing you to life… (" + (job.status || "working") + ")", "pending");
        if (job.status === "done") {
          var vid = job.video;
          var url =
            (vid && (vid.url || vid.download_url || vid.uri)) ||
            job.video_url ||
            job.output_url ||
            job.result_url;
          if (window.GallerySaveVideo && window.GallerySaveVideo.preferSavedUrl) {
            url = window.GallerySaveVideo.preferSavedUrl(job, url);
          }
          if (url) return absoluteUrl(url);
          throw new Error("No video URL returned.");
        }
        if (job.status === "failed" || job.status === "expired") {
          throw new Error((job.error && (job.error.message || job.error)) || "Video failed.");
        }
        return delay(VIDEO_POLL_MS).then(function () {
          return pollVideoJob(jobId, startedAt);
        });
      });
  }

  function pickRecorderMime() {
    var mime = "";
    if (window.MediaRecorder && MediaRecorder.isTypeSupported) {
      ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].some(function (t) {
        if (MediaRecorder.isTypeSupported(t)) {
          mime = t;
          return true;
        }
        return false;
      });
    }
    return mime;
  }

  function accelerateVideoBlob(blob, rate) {
    rate = rate || LIFE_PLAYBACK_ACCEL;
    if (!blob || !blob.size || rate <= 1.02) return Promise.resolve(blob);
    var mime = pickRecorderMime();
    if (!mime || !window.MediaRecorder) return Promise.resolve(blob);

    return new Promise(function (resolve) {
      var video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      var src = URL.createObjectURL(blob);
      trackBlobUrl(src);
      var settled = false;

      function done(outBlob) {
        if (settled) return;
        settled = true;
        resolve(outBlob || blob);
      }

      video.onerror = function () {
        done(blob);
      };

      video.onloadedmetadata = function () {
        var w = video.videoWidth || 720;
        var h = video.videoHeight || 1280;
        var canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        var ctx = canvas.getContext("2d");
        if (!ctx || !canvas.captureStream) {
          done(blob);
          return;
        }

        var stream = canvas.captureStream(LIFE_CAPTURE_FPS);
        var recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 5500000 });
        var chunks = [];
        recorder.ondataavailable = function (ev) {
          if (ev.data && ev.data.size) chunks.push(ev.data);
        };
        recorder.onstop = function () {
          var out = new Blob(chunks, { type: mime });
          done(out && out.size ? out : blob);
        };

        video.playbackRate = rate;
        recorder.start(120);
        video.currentTime = 0;

        function drawFrame() {
          if (settled) return;
          if (video.readyState >= 2) ctx.drawImage(video, 0, 0, w, h);
          if (video.ended || video.currentTime >= video.duration - 0.04) {
            try {
              recorder.stop();
            } catch (eStop) {
              done(blob);
            }
            return;
          }
          if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(drawFrame);
          else requestAnimationFrame(drawFrame);
        }

        video.play().then(drawFrame).catch(function () {
          done(blob);
        });
        setTimeout(function () {
          if (!settled) {
            try {
              recorder.stop();
            } catch (eT) {
              done(blob);
            }
          }
        }, Math.ceil(((video.duration || CLIP_SEC) / rate + 3) * 1000));
      };

      video.src = src;
    });
  }

  function blobPlayUrl(blob, sourceUrl) {
    var playUrl = URL.createObjectURL(blob);
    trackBlobUrl(playUrl);
    return { playUrl: playUrl, blob: blob, sourceUrl: absoluteUrl(sourceUrl) };
  }

  function materializeVideoPlayback(sourceUrl) {
    sourceUrl = absoluteUrl(sourceUrl);
    if (!sourceUrl) return Promise.reject(new Error("No video URL."));
    if (sourceUrl.indexOf("blob:") === 0) {
      return fetch(sourceUrl)
        .then(function (r) {
          return r.blob();
        })
        .then(function (blob) {
          if (!blob || !blob.size) throw new Error("Video blob is empty.");
          return blobPlayUrl(blob, sourceUrl);
        });
    }
    return resolveVideoBlob(sourceUrl).then(function (blob) {
      if (!blob || !blob.size) throw new Error("Video file is empty.");
      if (LIFE_PLAYBACK_ACCEL <= 1.02) return blobPlayUrl(blob, sourceUrl);
      return accelerateVideoBlob(blob, LIFE_PLAYBACK_ACCEL)
        .then(function (fast) {
          if (fast && fast.size > blob.size * 0.12) return blobPlayUrl(fast, sourceUrl);
          return blobPlayUrl(blob, sourceUrl);
        })
        .catch(function () {
          return blobPlayUrl(blob, sourceUrl);
        });
    });
  }

  function forgeImage() {
    if (state.forging) return Promise.resolve();
    var stock = getActiveStock();
    if (!stock) {
      setStatus("Add a photo of you first.", "error");
      return Promise.resolve();
    }
    var scene = getScene();
    var userPrompt = resolveUserPrompt();
    syncPromptState(userPrompt);
    state.forging = true;
    updateActionButtons();
    setStatus(
      state.promptMemory
        ? "Forging scene with your likeness + spell style…"
        : "Forging fresh scene — prompt box only, no carryover…",
      "pending"
    );

    var jobId =
      typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : "lo-img-" + Date.now();
    var spellNums = paintingNumsFromStyles();
    var preparedPrompt = prepareUserPrompt(userPrompt, scene);
    var castPrompt =
      FACE_IDENTITY_BLOCK +
      " " +
      buildFramingDirective(userPrompt) +
      " " +
      buildAttireDirective() +
      " PRIMARY: " +
      (preparedPrompt || "Logan full body inside his painted universe") +
      " " +
      buildSceneSecondaryBlock(scene);

    return compressDataUrl(stock.dataUrl, REF_MAX_SIDE, REF_QUALITY)
      .then(function (compressedRef) {
        return fetchWithTimeout(
          apiUrl("/api/generate-stasis-vision"),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              job_id: jobId,
              stasis: buildStasis(scene, userPrompt),
              craft_hints: buildCraftHints(scene, userPrompt),
              buzz_words: buildBuzz().concat(buildAttireBuzz()).concat(
                wantsCloseUp(userPrompt)
                  ? ["face lock", "same person", "logan identity", "close-up"]
                  : ["face lock", "same person", "logan identity", "full body", "head to toe"]
              ),
              spells: spellNums,
              aspect_ratio: state.aspect,
              mag_fresh: !state.promptMemory,
              fresh_variation: true,
              refine: state.promptMemory,
              spell_cast: false,
              spell_reference_image: "",
              reference_image: compressedRef,
              prompt: castPrompt,
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
          if (!r.ok) throw new Error((d && d.error) || "Forge failed");
          var img = d.image || (d.images && d.images[0]);
          if (img && img.url) return img.url;
          throw new Error("No image returned.");
        });
      })
      .then(function (imageUrl) {
        state.creation = {
          id: uniqueId(),
          imageUrl: absoluteUrl(imageUrl),
          videoUrl: "",
          playUrl: "",
          videoBlob: null,
        };
        showPreviewImage(imageUrl);
        state.history.unshift({
          id: state.creation.id,
          label: scene.label,
          imageUrl: state.creation.imageUrl,
          videoUrl: "",
          prompt: userPrompt,
        });
        renderHistory();
        setStatus("Scene ready — hit Animate here to play the clip in this tab.", "ok");
      })
      .catch(function (err) {
        setStatus(err.message || "Forge failed — is the server running?", "error");
      })
      .finally(function () {
        state.forging = false;
        updateActionButtons();
      });
  }

  function forgeVideo() {
    if (state.forging || !state.creation.imageUrl) return Promise.resolve();
    var stock = getActiveStock();
    if (!stock) {
      setStatus("Add a photo of you first — stock photo anchors your face in motion.", "error");
      return Promise.resolve();
    }
    var userPrompt = resolveUserPrompt();
    syncPromptState(userPrompt);
    state.forging = true;
    updateActionButtons();
    setStatus(
      state.promptMemory
        ? "Animating you here in Logan — your prompt + stock likeness + spell style…"
        : "Animating with prompt box only — no memory carryover…",
      "pending"
    );

    var scene = getScene();
    var imageUrl = state.creation.imageUrl;
    var spellNums = paintingNumsFromStyles();
    var loganBeats = buildLoganBeats(scene, userPrompt);
    var clipSec = clipDurationForPrompt(userPrompt);
    var jobId =
      typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : "lo-vid-" + Date.now();

    return Promise.all([
      imageUrlToDataUrl(imageUrl).then(function (raw) {
        return compressDataUrl(raw, REF_MAX_SIDE, REF_QUALITY);
      }),
      compressDataUrl(stock.dataUrl, REF_MAX_SIDE, REF_QUALITY),
    ])
      .then(function (refs) {
        var compressed = refs[0];
        var stockRef = refs[1];
        return fetchWithTimeout(
          apiUrl("/api/animate-cast"),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              job_id: jobId,
              stasis: buildAnimateStasis(scene, userPrompt),
              prompt: buildAnimatePrompt(scene, userPrompt),
              craft_hints: buildAnimateCraftHints(scene, userPrompt),
              buzz_words: buildAnimateBuzz(userPrompt),
              beats: loganBeats,
              duration: clipSec,
              spells: spellNums,
              spell_cast: false,
              spell_reference_image: stockRef,
              resolution: "720p",
              aspect_ratio: state.aspect,
              morph_chain: false,
              culmination: true,
              reference_image: compressed,
              image_url: imageUrl,
            }),
          },
          FETCH_TIMEOUT_MS
        );
      })
      .then(function (r) {
        return parseApiResponse(r).then(function (d) {
          if (!r.ok) throw new Error((d && d.error) || "Life cast failed");
          if (r.status === 202 && d.job_id) return pollVideoJob(d.job_id);
          var vid = d.video;
          var url =
            (vid && (vid.url || vid.download_url || vid.uri)) || d.video_url || d.output_url || d.result_url;
          if (url) return absoluteUrl(url);
          if (d.job_id) return pollVideoJob(d.job_id);
          throw new Error("No video job returned.");
        });
      })
      .then(function (url) {
        url = absoluteUrl(url);
        setStatus("Saving clip to saved-videos/…", "pending");
        var saveP =
          window.GallerySaveVideo && window.GallerySaveVideo.save
            ? window.GallerySaveVideo.save(url)
            : Promise.resolve(null);
        return saveP
          .then(function (saved) {
            if (saved && saved.url) url = absoluteUrl(saved.url);
            setStatus("Preparing clip for playback…", "pending");
            return materializeVideoPlayback(url)
              .then(function (playback) {
                state.creation.videoUrl = playback.sourceUrl;
                state.creation.playUrl = playback.playUrl;
                state.creation.videoBlob = playback.blob;
                if (saved && saved.name) state.creation.savedName = saved.name;
                if (state.history[0] && state.history[0].id === state.creation.id) {
                  state.history[0].videoUrl = playback.sourceUrl;
                  renderHistory();
                }
                return playback;
              })
              .catch(function (fetchErr) {
                var fallbackPlay = mediaProxyUrl(url);
                state.creation.videoUrl = url;
                state.creation.playUrl = fallbackPlay;
                state.creation.videoBlob = null;
                if (state.history[0] && state.history[0].id === state.creation.id) {
                  state.history[0].videoUrl = url;
                  renderHistory();
                }
                return {
                  playUrl: fallbackPlay,
                  blob: null,
                  sourceUrl: url,
                  fetchWarning: fetchErr && fetchErr.message,
                };
              });
          })
          .catch(function () {
            setStatus("Preparing clip for playback…", "pending");
            return materializeVideoPlayback(url)
              .then(function (playback) {
                state.creation.videoUrl = playback.sourceUrl;
                state.creation.playUrl = playback.playUrl;
                state.creation.videoBlob = playback.blob;
                if (state.history[0] && state.history[0].id === state.creation.id) {
                  state.history[0].videoUrl = playback.sourceUrl;
                  renderHistory();
                }
                return playback;
              })
              .catch(function (fetchErr) {
                var fallbackPlay = mediaProxyUrl(url);
                state.creation.videoUrl = url;
                state.creation.playUrl = fallbackPlay;
                state.creation.videoBlob = null;
                return {
                  playUrl: fallbackPlay,
                  blob: null,
                  sourceUrl: url,
                  fetchWarning: fetchErr && fetchErr.message,
                };
              });
          });
      })
      .then(function (playback) {
        state.previewMode = "video";
        return showPreviewVideo(playback.playUrl, playback.sourceUrl).then(function (autoplayOk) {
          playback.autoplayOk = autoplayOk !== false;
          return playback;
        });
      })
      .then(function (playback) {
        if (playback && playback.fetchWarning) {
          setStatus(
            "Clip ready via stream — if playback stalls, restart start_server.bat and try again. (" +
              playback.fetchWarning +
              ")",
            "ok"
          );
          return;
        }
        setStatus(
          playback && playback.autoplayOk === false
            ? "Animation ready — press ▶ play on the preview (or go fullscreen on your TV)."
            : "Animation ready — playing in Logan tab. Use Fullscreen on your TV.",
          "ok"
        );
      })
      .catch(function (err) {
        setStatus(err.message || "Life cast failed.", "error");
      })
      .finally(function () {
        state.forging = false;
        updateActionButtons();
      });
  }

  function updateViewToggle() {
    var hasImage = !!state.creation.imageUrl;
    var hasVideo = !!state.creation.videoUrl;
    var imgBtn = $("lo-view-image");
    var vidBtn = $("lo-view-video");
    if (imgBtn) {
      imgBtn.disabled = !hasImage;
      imgBtn.classList.toggle("active", state.previewMode === "image" && hasImage);
    }
    if (vidBtn) {
      vidBtn.disabled = !hasVideo;
      vidBtn.classList.toggle("active", state.previewMode === "video" && hasVideo);
    }
  }

  function showPreviewImage(url) {
    var img = $("lo-preview-image");
    var vid = $("lo-preview-video");
    var empty = $("lo-preview-empty");
    var badge = $("lo-preview-badge");
    state.previewMode = "image";
    if (empty) empty.hidden = true;
    if (vid) {
      vid.hidden = true;
      vid.pause();
    }
    if (img) {
      img.hidden = false;
      img.src = absoluteUrl(url);
    }
    if (badge) {
      badge.hidden = false;
      badge.textContent = "Image";
    }
    updateViewToggle();
  }

  function setVideoElementSrc(vid, url) {
    if (!vid || !url) return false;
    if (vid.src === url || vid.currentSrc === url) return false;
    vid.src = url;
    vid.load();
    return true;
  }

  function canAutoplayVideo() {
    return document.visibilityState === "visible" && !!state.active;
  }

  function safePlayVideo(vid, opts) {
    opts = opts || {};
    if (!vid) return Promise.resolve(false);
    vid.muted = true;
    vid.defaultMuted = true;
    vid.setAttribute("muted", "");

    if (!canAutoplayVideo()) {
      vid.classList.remove("is-playing");
      if (!opts.silent) {
        setStatus("Clip ready — press ▶ play (browser blocks autoplay while tab is in background).", "ok");
      }
      return Promise.resolve(false);
    }

    function tryPlay() {
      var playPromise = vid.play();
      if (!playPromise || !playPromise.then) {
        vid.classList.add("is-playing");
        return Promise.resolve(true);
      }
      return playPromise
        .then(function () {
          vid.classList.add("is-playing");
          return true;
        })
        .catch(function (err) {
          vid.classList.remove("is-playing");
          if (err && (err.name === "AbortError" || /interrupted|power/i.test(String(err.message || "")))) {
            if (!opts.silent) {
              setStatus("Clip ready — press ▶ play (browser paused background video to save power).", "ok");
            }
            return false;
          }
          vid.muted = true;
          return vid.play().then(function () {
            vid.classList.add("is-playing");
            return true;
          }).catch(function () {
            if (!opts.silent) {
              setStatus("Clip ready — press ▶ play on the preview.", "ok");
            }
            return false;
          });
        });
    }

    if (vid.readyState >= 2) return tryPlay();
    return new Promise(function (resolve) {
      vid.addEventListener(
        "canplay",
        function () {
          tryPlay().then(resolve);
        },
        { once: true }
      );
    });
  }

  function bindVideoAutoplayResume() {
    if (state.videoResumeBound) return;
    state.videoResumeBound = true;
    document.addEventListener("visibilitychange", function () {
      if (document.hidden || !state.active || state.previewMode !== "video") return;
      var vid = $("lo-preview-video");
      if (!vid || vid.hidden || !vid.paused || !vid.currentSrc) return;
      safePlayVideo(vid, { silent: true });
    });
    var stage = $("lo-stage");
    if (stage && typeof IntersectionObserver !== "undefined") {
      var observer = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (!entry.isIntersecting || !state.active || state.previewMode !== "video") return;
            var vid = $("lo-preview-video");
            if (!vid || vid.hidden || !vid.paused || !vid.currentSrc) return;
            safePlayVideo(vid, { silent: true });
          });
        },
        { threshold: 0.35 }
      );
      observer.observe(stage);
    }
  }

  function showPreviewVideo(url, sourceUrl) {
    url = absoluteUrl(url || "");
    sourceUrl = absoluteUrl(sourceUrl || state.creation.videoUrl || url);
    var img = $("lo-preview-image");
    var vid = $("lo-preview-video");
    var empty = $("lo-preview-empty");
    var badge = $("lo-preview-badge");
    state.previewMode = "video";
    if (empty) empty.hidden = true;
    if (img) img.hidden = true;
    if (!vid) {
      updateViewToggle();
      return Promise.resolve();
    }

    vid.hidden = false;
    vid.controls = true;
    vid.playsInline = true;
    vid.preload = "auto";
    vid.setAttribute("playsinline", "");
    vid.setAttribute("webkit-playsinline", "");
    if (state.creation.imageUrl) vid.poster = absoluteUrl(state.creation.imageUrl);
    bindVideoAutoplayResume();

    function mountAndPlay(playSrc) {
      setVideoElementSrc(vid, playSrc);
      vid.classList.remove("is-playing");
      return safePlayVideo(vid);
    }

    var fallbackChain = [];
    if (url && url.indexOf("blob:") === 0) fallbackChain.push(url);
    if (state.creation.playUrl && fallbackChain.indexOf(state.creation.playUrl) < 0) {
      fallbackChain.push(state.creation.playUrl);
    }
    if (sourceUrl) {
      var proxied = mediaProxyUrl(sourceUrl);
      if (fallbackChain.indexOf(proxied) < 0) fallbackChain.push(proxied);
      var resolved = absoluteUrl(sourceUrl);
      if (fallbackChain.indexOf(resolved) < 0) fallbackChain.push(resolved);
    }
    var fallbackIdx = 0;

    vid.onerror = function () {
      vid.classList.remove("is-playing");
      fallbackIdx++;
      if (fallbackIdx < fallbackChain.length) {
        mountAndPlay(fallbackChain[fallbackIdx]);
        return;
      }
      setStatus(
        "Video failed to load — restart start_server.bat, hard-refresh (Ctrl+F5), then animate again.",
        "error"
      );
    };

    if (badge) {
      badge.hidden = false;
      badge.textContent = "Video";
    }
    updateViewToggle();

    if (url && fallbackChain.indexOf(url) < 0) fallbackChain.unshift(url);

    if (fallbackChain.length) {
      return mountAndPlay(fallbackChain[0]).then(function (ok) {
        return ok;
      });
    }
    return materializeVideoPlayback(sourceUrl || url)
      .then(function (playback) {
        state.creation.videoUrl = playback.sourceUrl;
        state.creation.playUrl = playback.playUrl;
        state.creation.videoBlob = playback.blob;
        return mountAndPlay(playback.playUrl);
      })
      .catch(function (err) {
        setStatus((err && err.message) || "Could not load video.", "error");
      });
  }

  function updateActionButtons() {
    var hasStock = !!getActiveStock();
    var hasImage = !!state.creation.imageUrl;
    var hasVideo = !!state.creation.videoUrl;
    var busy = state.forging;
    var animateBtn = $("lo-animate-here");
    var dlImg = $("lo-download-image");
    var dlVid = $("lo-download-video");
    if (animateBtn) animateBtn.disabled = !hasStock || busy;
    if (dlImg) dlImg.disabled = !hasImage || busy;
    if (dlVid) dlVid.disabled = !hasVideo || busy;
    updateViewToggle();
  }

  function animateHere() {
    if (state.forging) return Promise.resolve();
    var stock = getActiveStock();
    if (!stock) {
      setStatus("Add a photo of you first.", "error");
      return Promise.resolve();
    }
    if (!state.creation.imageUrl) {
      setStatus("No scene yet — forging image first, then animating…", "pending");
      return forgeImage().then(function () {
        if (state.creation.imageUrl) return forgeVideo();
      });
    }
    return forgeVideo();
  }

  function toggleFullscreen() {
    var stage = $("lo-stage");
    if (!stage) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(function () {});
      return;
    }
    if (stage.requestFullscreen) stage.requestFullscreen();
    else if (stage.webkitRequestFullscreen) stage.webkitRequestFullscreen();
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 8000);
  }

  function downloadUrl(url, filename) {
    var a = document.createElement("a");
    a.href = url.indexOf("blob:") === 0 ? url : mediaProxyUrl(url);
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function renderStock() {
    var grid = $("lo-stock-grid");
    var count = $("lo-stock-count");
    if (count) count.textContent = state.stock.length + " photo" + (state.stock.length === 1 ? "" : "s");
    if (!grid) return;
    if (!state.stock.length) {
      grid.innerHTML = '<p class="lo-rack-empty">No stock yet — add photos of you</p>';
      return;
    }
    grid.innerHTML = state.stock
      .map(function (s) {
        return (
          '<button type="button" class="lo-stock-card' +
          (s.id === state.activeStockId ? " active" : "") +
          '" data-stock="' +
          escapeHtml(s.id) +
          '">' +
          '<img src="' +
          escapeHtml(s.dataUrl) +
          '" alt="Logan stock" />' +
          '<span class="lo-stock-rm" data-rm-stock="' +
          escapeHtml(s.id) +
          '" title="Remove">×</span></button>'
        );
      })
      .join("");
  }

  function readSceneDialogFields() {
    return normalizeScene({
      label: ($("lo-scene-dialog-name") && $("lo-scene-dialog-name").value) || "",
      hint: ($("lo-scene-dialog-hint") && $("lo-scene-dialog-hint").value) || "",
      prefix: ($("lo-scene-dialog-prefix") && $("lo-scene-dialog-prefix").value) || "",
      motion: ($("lo-scene-dialog-motion") && $("lo-scene-dialog-motion").value) || "",
    });
  }

  function clearSceneDialogFields() {
    ["lo-scene-dialog-name", "lo-scene-dialog-hint", "lo-scene-dialog-prefix", "lo-scene-dialog-motion"].forEach(
      function (id) {
        var el = $(id);
        if (el) el.value = "";
      }
    );
  }

  function closeSceneDialog() {
    var dlg = $("lo-scene-dialog");
    if (dlg && dlg.close) dlg.close();
  }

  function openSceneAddDialog() {
    if (state.scenes.length >= MAX_SCENES) {
      setStatus("Max " + MAX_SCENES + " scenes — remove one first.", "error");
      return;
    }
    clearSceneDialogFields();
    var dlg = $("lo-scene-dialog");
    if (!dlg || !dlg.showModal) return;
    dlg.showModal();
    var name = $("lo-scene-dialog-name");
    if (name) name.focus();
  }

  function commitSceneFromDialog() {
    if (state.scenes.length >= MAX_SCENES) {
      setStatus("Max " + MAX_SCENES + " scenes — remove one first.", "error");
      return;
    }
    var draft = readSceneDialogFields();
    if (!draft.label) {
      setStatus("Scene name is required.", "error");
      return;
    }
    draft.id = ensureUniqueSceneId(slugifySceneId(draft.label));
    state.scenes.push(draft);
    state.sceneId = draft.id;
    persistScenes();
    renderScenes();
    closeSceneDialog();
    setStatus("Scene added — @" + draft.id + " · use {" + draft.id + ".motion} in prompts", "ok");
  }

  function updateScenePanelUi() {
    var sec = $("lo-scene-secondary");
    if (sec) sec.checked = !!state.sceneSecondary;
    var addBtn = $("lo-scene-add-btn");
    if (addBtn) addBtn.disabled = state.scenes.length >= MAX_SCENES;
  }

  function renderScenes() {
    var el = $("lo-scenes");
    if (!el) return;
    if (!state.scenes.length) {
      el.innerHTML = '<p class="lo-rack-empty">No scenes yet</p>';
    } else {
      el.innerHTML = state.scenes
        .map(function (s) {
          return (
            '<button type="button" class="lo-scene' +
            (s.id === state.sceneId ? " active" : "") +
            '" data-scene="' +
            escapeHtml(s.id) +
            '" title="' +
            escapeHtml(s.id) +
            '"><span class="lo-scene-label">' +
            escapeHtml(s.label) +
            '</span><span class="lo-scene-hint">' +
            escapeHtml(s.hint || "No description") +
            '</span><span class="lo-scene-id">@' +
            escapeHtml(s.id) +
            "</span></button>"
          );
        })
        .join("");
    }
    updateScenePanelUi();
  }

  function selectScene(id) {
    if (!getSceneById(id)) return;
    state.sceneId = id;
    renderScenes();
    setStatus("Scene: " + getScene().label + " (" + id + ")", "ok");
  }

  function resetBuiltInScenes() {
    var customs = state.scenes.filter(function (s) {
      return !DEFAULT_SCENES.some(function (d) {
        return d.id === s.id;
      });
    });
    state.scenes = cloneDefaultScenes().concat(customs);
    if (!getSceneById(state.sceneId)) state.sceneId = state.scenes[0].id;
    persistScenes();
    renderScenes();
    setStatus("Built-in scenes reset — your custom scenes kept.", "ok");
  }

  function setSceneSecondary(on) {
    state.sceneSecondary = !!on;
    persistSceneSecondaryPreference();
    updateScenePanelUi();
    setStatus(
      state.sceneSecondary
        ? "Scene push is secondary — your prompt leads."
        : "Scene push off — use @scene callbacks in your prompt when needed.",
      "ok"
    );
  }

  function renderStyleRack() {
    var rack = $("lo-style-rack");
    if (!rack) return;
    if (!state.styleSpells.length) {
      rack.innerHTML = '<p class="lo-rack-empty">Drop paintings here to borrow your brush DNA</p>';
      return;
    }
    rack.innerHTML = state.styleSpells
      .map(function (s, idx) {
        return (
          '<div class="lo-style-chip" data-idx="' +
          idx +
          '"><img src="' +
          escapeHtml(s.url) +
          '" alt="" /><button type="button" class="lo-style-chip-rm" data-rm-style="' +
          idx +
          '">×</button></div>'
        );
      })
      .join("");
  }

  function renderHistory() {
    var el = $("lo-history");
    if (!el) return;
    if (!state.history.length) {
      el.innerHTML = '<p class="lo-history-empty">Recent forges appear here.</p>';
      return;
    }
    el.innerHTML = state.history
      .slice(0, 10)
      .map(function (h) {
        return (
          '<button type="button" class="lo-history-card" data-hist="' +
          escapeHtml(h.id) +
          '">' +
          (h.imageUrl ? '<img src="' + escapeHtml(absoluteUrl(h.imageUrl)) + '" alt="" />' : "") +
          '<span class="lo-history-label">' +
          escapeHtml(h.label) +
          "</span></button>"
        );
      })
      .join("");
  }

  function addStockFromFile(file) {
    if (!file || !file.type.startsWith("image/")) return Promise.resolve();
    if (file.size > MAX_UPLOAD_BYTES) {
      setStatus("Each photo must be under 8 MB.", "error");
      return Promise.resolve();
    }
    if (state.stock.length >= MAX_STOCK) {
      setStatus("Max " + MAX_STOCK + " stock photos — remove one first.", "error");
      return Promise.resolve();
    }
    return new Promise(function (resolve) {
      var reader = new FileReader();
      reader.onload = function () {
        compressDataUrl(reader.result, 960, 0.78).then(function (dataUrl) {
          var item = { id: uniqueId(), dataUrl: dataUrl, createdAt: Date.now() };
          state.stock.unshift(item);
          state.activeStockId = item.id;
          persistStock();
          renderStock();
          setStatus("Stock photo added.", "ok");
          resolve();
        });
      };
      reader.readAsDataURL(file);
    });
  }

  function removeStock(id) {
    state.stock = state.stock.filter(function (s) {
      return s.id !== id;
    });
    if (state.activeStockId === id) state.activeStockId = state.stock[0] ? state.stock[0].id : "";
    persistStock();
    renderStock();
  }

  function addStyleSpell(item) {
    item = normalizeSpell(item);
    if (!item.url || !item.paintingNum) return;
    var dup = state.styleSpells.some(function (s) {
      return s.paintingNum === item.paintingNum;
    });
    if (dup) {
      setStatus("That painting is already in your style rack.", "ok");
      return;
    }
    if (state.styleSpells.length >= MAX_STYLE_SPELLS) {
      setStatus("Style rack full (" + MAX_STYLE_SPELLS + ") — remove one first.", "error");
      return;
    }
    state.styleSpells.push(item);
    renderStyleRack();
    setStatus("Added #" + item.paintingNum + " to style rack.", "ok");
  }

  function loadPool() {
    if (state.poolReady) return Promise.resolve();
    return (window.loadGalleryData ? window.loadGalleryData() : Promise.resolve({ manifest: [] })).then(
      function (data) {
        state.pool = (data.manifest || []).map(function (m) {
          return normalizeSpell(spellRow(m));
        });
        state.poolReady = true;
        fillTrayRandom();
        renderTray();
      }
    );
  }

  function fillTrayRandom() {
    state.trayItems = shuffle(state.pool).slice(0, TRAY_SLICE);
  }

  function renderTray() {
    var strip = $("lo-spell-strip");
    if (!strip) return;
    strip.innerHTML = "";
    state.trayItems.forEach(function (item, idx) {
      var el = document.createElement("div");
      el.className = "st-spell lo-spell";
      el.dataset.idx = String(idx);
      var img = document.createElement("img");
      img.src = item.url;
      img.alt = item.label;
      el.appendChild(img);
      strip.appendChild(el);
    });
    var count = $("lo-tray-count");
    if (count) count.textContent = state.trayItems.length + " shown · drag onto style rack";
  }

  function createGhost(item, x, y) {
    var ghost = document.createElement("div");
    ghost.className = "st-drag-ghost";
    var img = document.createElement("img");
    img.src = item.url;
    ghost.appendChild(img);
    ghost.style.left = x + "px";
    ghost.style.top = y + "px";
    document.body.appendChild(ghost);
    return ghost;
  }

  function isOverStyleRack(x, y) {
    var el = $("lo-style-rack");
    if (!el) return false;
    var r = el.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }

  function bindUi() {
    loadScenes();
    loadSceneSecondaryPreference();
    renderScenes();
    loadAttirePreference();
    renderAttireToggle();
    loadPromptMemoryPreference();
    updatePromptMemoryUi();
    loadStock();
    renderStock();
    renderStyleRack();
    renderHistory();
    updateActionButtons();

    $("lo-upload-btn") &&
      $("lo-upload-btn").addEventListener("click", function () {
        var input = $("lo-upload-input");
        if (input) input.click();
      });

    $("lo-upload-input") &&
      $("lo-upload-input").addEventListener("change", function (e) {
        var files = e.target.files;
        if (!files || !files.length) return;
        var chain = Promise.resolve();
        var i;
        for (i = 0; i < files.length; i++) {
          (function (file) {
            chain = chain.then(function () {
              return addStockFromFile(file);
            });
          })(files[i]);
        }
        chain.finally(function () {
          e.target.value = "";
        });
      });

    $("lo-stock-grid") &&
      $("lo-stock-grid").addEventListener("click", function (e) {
        var rm = e.target.closest("[data-rm-stock]");
        if (rm) {
          e.stopPropagation();
          removeStock(rm.getAttribute("data-rm-stock"));
          return;
        }
        var card = e.target.closest("[data-stock]");
        if (card) {
          state.activeStockId = card.getAttribute("data-stock");
          renderStock();
          updateActionButtons();
          setStatus("Stock photo selected.", "ok");
        }
      });

    $("lo-scenes") &&
      $("lo-scenes").addEventListener("click", function (e) {
        var btn = e.target.closest("[data-scene]");
        if (!btn) return;
        selectScene(btn.getAttribute("data-scene"));
      });

    $("lo-scene-add-btn") && $("lo-scene-add-btn").addEventListener("click", openSceneAddDialog);
    $("lo-scene-reset") && $("lo-scene-reset").addEventListener("click", resetBuiltInScenes);
    $("lo-scene-secondary") &&
      $("lo-scene-secondary").addEventListener("change", function (e) {
        setSceneSecondary(!!(e.target && e.target.checked));
      });
    var sceneForm = $("lo-scene-dialog-form");
    if (sceneForm) {
      sceneForm.addEventListener("submit", function (e) {
        e.preventDefault();
        commitSceneFromDialog();
      });
    }
    $("lo-scene-dialog-cancel") && $("lo-scene-dialog-cancel").addEventListener("click", closeSceneDialog);
    $("lo-scene-dialog-close") && $("lo-scene-dialog-close").addEventListener("click", closeSceneDialog);
    var sceneDlg = $("lo-scene-dialog");
    if (sceneDlg) {
      sceneDlg.addEventListener("cancel", function (e) {
        e.preventDefault();
        closeSceneDialog();
      });
    }

    $("lo-attire") &&
      $("lo-attire").addEventListener("click", function (e) {
        var btn = e.target.closest("[data-attire]");
        if (!btn) return;
        setKeepAttire(btn.getAttribute("data-attire") === "keep");
      });

    $("lo-prompt-memory") &&
      $("lo-prompt-memory").addEventListener("click", function (e) {
        var btn = e.target.closest("[data-memory]");
        if (!btn) return;
        setPromptMemory(btn.getAttribute("data-memory") === "remember");
      });

    $("lo-clear-prompt") && $("lo-clear-prompt").addEventListener("click", clearPromptField);

    var blend = $("lo-style-blend");
    if (blend) {
      state.styleBlend = parseInt(blend.value, 10) || 30;
      blend.addEventListener("input", function () {
        state.styleBlend = parseInt(blend.value, 10) || 30;
        var val = $("lo-style-blend-val");
        if (val) val.textContent = faceLikenessPercent() + "% your face";
      });
      var valInit = $("lo-style-blend-val");
      if (valInit) valInit.textContent = faceLikenessPercent() + "% your face";
    }

    var aspectEl = $("lo-aspect");
    if (aspectEl) {
      state.aspect = aspectEl.value || state.aspect;
      aspectEl.addEventListener("change", function () {
        state.aspect = aspectEl.value || "16:9";
      });
    }

    $("lo-style-rack") &&
      $("lo-style-rack").addEventListener("click", function (e) {
        var rm = e.target.closest("[data-rm-style]");
        if (!rm) return;
        var idx = parseInt(rm.getAttribute("data-rm-style"), 10);
        state.styleSpells.splice(idx, 1);
        renderStyleRack();
      });

    $("lo-clear-styles") &&
      $("lo-clear-styles").addEventListener("click", function () {
        state.styleSpells = [];
        renderStyleRack();
      });

    $("lo-forge-image") && $("lo-forge-image").addEventListener("click", forgeImage);
    $("lo-animate-here") && $("lo-animate-here").addEventListener("click", animateHere);
    $("lo-view-image") &&
      $("lo-view-image").addEventListener("click", function () {
        if (state.creation.imageUrl) showPreviewImage(state.creation.imageUrl);
      });
    $("lo-view-video") &&
      $("lo-view-video").addEventListener("click", function () {
        if (state.creation.playUrl || state.creation.videoUrl) {
          showPreviewVideo(state.creation.playUrl, state.creation.videoUrl);
        }
      });
    $("lo-fullscreen") && $("lo-fullscreen").addEventListener("click", toggleFullscreen);
    $("lo-download-image") &&
      $("lo-download-image").addEventListener("click", function () {
        if (state.creation.imageUrl) downloadUrl(state.creation.imageUrl, "logan-scene.jpg");
      });
    $("lo-download-video") &&
      $("lo-download-video").addEventListener("click", function () {
        if (state.creation.videoBlob && state.creation.videoBlob.size) {
          downloadBlob(state.creation.videoBlob, "logan-clip.webm");
          return;
        }
        if (state.creation.playUrl) downloadUrl(state.creation.playUrl, "logan-clip.webm");
        else if (state.creation.videoUrl) downloadUrl(state.creation.videoUrl, "logan-clip.webm");
      });
    $("lo-tray-random") &&
      $("lo-tray-random").addEventListener("click", function () {
        fillTrayRandom();
        renderTray();
      });

    $("lo-history") &&
      $("lo-history").addEventListener("click", function (e) {
        var card = e.target.closest("[data-hist]");
        if (!card) return;
        var entry = state.history.find(function (h) {
          return h.id === card.getAttribute("data-hist");
        });
        if (!entry) return;
        state.creation = {
          id: entry.id,
          imageUrl: entry.imageUrl,
          videoUrl: entry.videoUrl || "",
        };
        if (state.promptMemory) {
          state.prompt = entry.prompt || "";
          if ($("lo-prompt")) $("lo-prompt").value = state.prompt;
        }
        state.creation.playUrl = "";
        state.creation.videoBlob = null;
        if (entry.videoUrl) {
          state.creation.videoUrl = entry.videoUrl;
          showPreviewVideo("", entry.videoUrl);
        } else if (entry.imageUrl) showPreviewImage(entry.imageUrl);
        updateActionButtons();
        if (!state.promptMemory) {
          setStatus("Preview restored — prompt unchanged (Fresh only mode).", "ok");
        }
      });

    var strip = $("lo-spell-strip");
    if (strip) {
      strip.addEventListener("pointerdown", onPointerDown);
      strip.addEventListener("pointermove", onPointerMove);
      strip.addEventListener("pointerup", onPointerUp);
      strip.addEventListener("pointercancel", onPointerCancel);
    }
  }

  function onPointerDown(e) {
    var spell = e.target.closest(".lo-spell");
    if (!spell) return;
    var item = normalizeSpell(state.trayItems[parseInt(spell.dataset.idx, 10)]);
    if (!item.url) return;
    e.preventDefault();
    spell.setPointerCapture(e.pointerId);
    state.drag = { item: item, ghost: createGhost(item, e.clientX, e.clientY), pointerId: e.pointerId };
    var rack = $("lo-style-rack");
    if (rack) rack.classList.add("drop-active");
  }

  function onPointerUp(e) {
    if (!state.drag || e.pointerId !== state.drag.pointerId) return;
    if (state.drag.ghost.parentNode) state.drag.ghost.parentNode.removeChild(state.drag.ghost);
    var rack = $("lo-style-rack");
    if (rack) rack.classList.remove("drop-active");
    if (isOverStyleRack(e.clientX, e.clientY)) addStyleSpell(state.drag.item);
    state.drag = null;
  }

  function onPointerMove(e) {
    if (!state.drag || e.pointerId !== state.drag.pointerId) return;
    state.drag.ghost.style.left = e.clientX + "px";
    state.drag.ghost.style.top = e.clientY + "px";
  }

  function onPointerCancel(e) {
    if (!state.drag || e.pointerId !== state.drag.pointerId) return;
    if (state.drag.ghost.parentNode) state.drag.ghost.parentNode.removeChild(state.drag.ghost);
    var rack = $("lo-style-rack");
    if (rack) rack.classList.remove("drop-active");
    state.drag = null;
  }

  function onShow() {
    state.active = true;
    loadPool();
  }

  function onHide() {
    state.active = false;
    var vid = $("lo-preview-video");
    if (vid) vid.pause();
  }

  function boot() {
    if (!$("panel-logan")) return;
    bindUi();
    loadPool();
    window.dispatchEvent(new Event("logan-ready"));
  }

  window.Logan = { onShow: onShow, onHide: onHide };
  window.addEventListener("logan-show", onShow);
  window.addEventListener("logan-hide", onHide);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();