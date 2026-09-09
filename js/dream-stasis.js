/**
 * Dream Stasis — inhabit the vision.
 * Imaginative presence: time, absence, reactivity, skinned space.
 * Not explicit. Illusory, personal, alive.
 */
(function () {
  "use strict";

  var IDLE_MS = 14000;
  var CYCLE_MS = 28000;
  var WHISPER_MS = 11000;
  var STATE_KEY = "dream_stasis_v1";
  var CAM_ALWAYS_KEY = "dream_cam_always_v1";

  var state = {
    started: false,
    inhabiting: false,
    immersing: false,
    sources: [],
    index: 0,
    presence: 0.4,
    lastMove: 0,
    sessionStart: 0,
    absent: false,
    cycleOn: true,
    pointer: { x: 0.5, y: 0.45 },
    motionMag: 0,
    camOn: false,
    camStream: null,
    camVideo: null,
    camCanvas: null,
    camCtx: null,
    camPrev: null,
    camSampleTimer: 0,
    camCentroid: { x: 0.5, y: 0.45 },
    camOccupancy: 0,
    autoSense: true,
    alwaysCamera: true,
    camBusy: false,
    preferredDeviceId: "",
    deviceList: [],
    /** "user" = front / selfie, "environment" = back */
    facingMode: "user",
    raf: 0,
    whisperTimer: 0,
    cycleTimer: 0,
    whisperText: "",
    livePromptOn: false,
    livePromptBusy: false,
    livePromptTimer: 0,
    livePromptText: "",
    livePromptIntervalMs: 12000,
    /** Locked camera-derived subject — dream images wrap around this */
    cameraSubject: "",
    composedDreamPrompt: "",
    /** "generated" (default first→last) or "paintings" */
    pool: "generated",
    generatedNums: [],
    /** num string -> filename with extension */
    generatedFiles: {},
    /** true only after /api/dream-pool succeeded (not placeholder) */
    poolReady: false,
    invOpen: false,
    invKind: "paintings",
    invPage: 0,
    invPageSize: 40,
    hudHidden: false,
    talking: false,
    speechRec: null,
    lastHeard: "",
  };

  function apiUrl(path) {
    // Always same-origin relative paths — works for localhost AND Tailscale HTTPS
    if (typeof window.galleryApiUrl === "function") {
      try {
        return window.galleryApiUrl(path);
      } catch (e) {}
    }
    var base = String(window.SPELLFORGE_API_BASE || "").replace(/\/$/, "");
    return base ? base + path : path;
  }

  function isLocalHostPage() {
    var h = (location.hostname || "").toLowerCase();
    return (
      h === "localhost" ||
      h === "127.0.0.1" ||
      h === "[::1]" ||
      h === ""
    );
  }

  function $(id) {
    return document.getElementById(id);
  }

  function setStatus(msg) {
    var el = $("ds-status");
    if (el) el.textContent = msg || "";
  }

  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  function isPhoneClient() {
    if (document.documentElement.classList.contains("is-phone")) return true;
    var ua = navigator.userAgent || "";
    return (
      /iPhone|iPad|iPod|Android/i.test(ua) ||
      (navigator.maxTouchPoints > 1 && /MacIntel/.test(navigator.platform || ""))
    );
  }

  /** Secure context + mediaDevices — required for phone camera. */
  function browserAllowsCameraApi() {
    try {
      if (navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === "function") {
        // Localhost is always OK; HTTPS is OK; some Android LAN quirks still expose mediaDevices
        if (window.isSecureContext || isLocalHostPage()) return true;
      }
      // Legacy webkit path (older WebViews)
      if (
        typeof navigator.getUserMedia === "function" ||
        typeof navigator.webkitGetUserMedia === "function"
      ) {
        return window.isSecureContext || isLocalHostPage();
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  function defaultHttpsDreamUrl() {
    var hash = location.hash || "#dream";
    if (hash.indexOf("dream") < 0) hash = "#dream";
    // No :8765 — Tailscale Serve is HTTPS on 443
    return "https://desktop-khpuv0r.tail51fce6.ts.net/" + hash.replace(/^#?/, "#");
  }

  function getUserMediaFn() {
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      return function (c) {
        return navigator.mediaDevices.getUserMedia(c);
      };
    }
    var legacy =
      navigator.getUserMedia ||
      navigator.webkitGetUserMedia ||
      navigator.mozGetUserMedia;
    if (!legacy) return null;
    return function (c) {
      return new Promise(function (resolve, reject) {
        legacy.call(navigator, c, resolve, reject);
      });
    };
  }

  function loadAlwaysCameraPref() {
    try {
      var v = localStorage.getItem(CAM_ALWAYS_KEY);
      if (v === null || v === undefined || v === "") {
        // Default ON for phones; ON for desktop too (user asked always allow)
        state.alwaysCamera = true;
      } else {
        state.alwaysCamera = v === "1" || v === "true";
      }
    } catch (e) {
      state.alwaysCamera = true;
    }
    state.autoSense = state.alwaysCamera;
    var cb = $("ds-always-cam");
    if (cb) cb.checked = !!state.alwaysCamera;
  }

  function setAlwaysCamera(on) {
    state.alwaysCamera = !!on;
    state.autoSense = !!on;
    try {
      localStorage.setItem(CAM_ALWAYS_KEY, on ? "1" : "0");
    } catch (e) {}
    var cb = $("ds-always-cam");
    if (cb) cb.checked = !!on;
  }

  /**
   * Phone Safari/Chrome block camera on plain HTTP. Jump to Tailscale HTTPS immediately.
   * Must run early — before any camera button can "silently" fail.
   */
  function maybeForceHttpsForCamera() {
    // NEVER touch localhost — PC must keep working without redirects
    if (isLocalHostPage()) return false;
    if (location.protocol === "https:") return false;
    if (location.protocol === "file:") return false;
    // Phone (or any non-local http): camera needs HTTPS
    if (!isPhoneClient() && !/^100\./.test(location.hostname || "")) {
      // Desktop on LAN can stay on http for browsing
      if (!isPhoneClient()) return false;
    }
    var dest = defaultHttpsDreamUrl();
    try {
      // Always offer redirect on camera tap — don't block after one dismiss
      sessionStorage.setItem("ds_https_redirected", dest);
    } catch (e) {}
    setStatus("Phone camera needs HTTPS — opening secure link…");
    location.href = dest;
    return true;
  }

  function cameraBlockedMessage(httpsDream) {
    var url = httpsDream || defaultHttpsDreamUrl();
    if (location.protocol === "file:") {
      return "Camera blocked on file://. Open " + url + " in Safari/Chrome.";
    }
    if (!window.isSecureContext || location.protocol === "http:") {
      return "Camera needs HTTPS. Open: " + url;
    }
    return "Camera API missing. Use Safari or Chrome at " + url;
  }

  function fetchPhoneAccess() {
    return fetch("/api/phone-access", { cache: "no-store" })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .catch(function () {
        return null;
      });
  }

  function setCamButtonLabel(text, active) {
    var btn = $("ds-btn-sense");
    if (!btn) return;
    btn.textContent = text || "Camera";
    btn.classList.toggle("active", !!active);
    btn.disabled = !!state.camBusy && !state.camOn;
  }

  function showCamPrime(show) {
    var b = $("ds-btn-cam-prime");
    if (!b) return;
    b.hidden = !show;
  }

  function deniedCameraHelp() {
    var ios = /iPhone|iPad|iPod/i.test(navigator.userAgent || "");
    if (ios) {
      return (
        "Camera was denied earlier. On iPhone: Settings → Safari → Camera → Allow, " +
        "or Settings → [Safari/Chrome] → reset site permission for this address, then tap Allow camera again."
      );
    }
    return (
      "Camera was denied. In the browser site settings for this page, set Camera to Allow, " +
      "then tap Allow camera again."
    );
  }

  function fillPhoneAccessNote() {
    var gateNote = $("ds-gate-phone-note");
    if (!gateNote) return;

    var phone = isPhoneClient();
    var origin = (location.origin || "").replace(/\/+$/, "");
    var secure = browserAllowsCameraApi();

    function render(linesHtml) {
      gateNote.hidden = false;
      gateNote.innerHTML = linesHtml;
    }

    function renderWithHttps(httpsDream, httpsGallery) {
      httpsDream = httpsDream || defaultHttpsDreamUrl();
      httpsGallery = httpsGallery || httpsDream.replace(/#.*$/, "/");

      if (phone) {
        if (!secure) {
          render(
            "<strong>Camera is blocked on this page</strong> — phones only allow the camera on <strong>HTTPS</strong>. " +
              "You are on plain HTTP (or file). Tap this link, then Enter → Allow Camera:<br/>" +
              '<a class="ds-phone-link ds-phone-link-primary" href="' +
              httpsDream +
              '">' +
              httpsDream +
              "</a>" +
              '<p class="ds-phone-tip">Keep Tailscale <strong>Connected</strong> and the PC on <code>start_server.bat</code>. ' +
              "If the link fails, run <code>enable_phone_camera.bat</code> on the PC once.</p>"
          );
        } else {
          render(
            "HTTPS OK — camera can work. Tap <strong>Enter the field</strong> → <strong>Allow Camera</strong>. " +
              "Bookmark: <a class=\"ds-phone-link\" href=\"" +
              origin +
              "/#dream\">" +
              origin +
              "/#dream</a>"
          );
        }
        return;
      }

      render(
        "<strong>Phone camera (HTTPS required)</strong>" +
          "<ol class=\"ds-phone-steps\">" +
          "<li>PC: <code>start_server.bat</code> (enables Tailscale HTTPS) or <code>enable_phone_camera.bat</code>.</li>" +
          "<li>Phone: Tailscale <strong>Connected</strong>.</li>" +
          "<li>Open <strong>this</strong> link in Safari/Chrome (not http://):</li>" +
          "</ol>" +
          "<ul class=\"ds-phone-links\">" +
          '<li class="ds-phone-https"><a class="ds-phone-link ds-phone-link-primary" href="' +
          httpsDream +
          '">' +
          httpsDream +
          "</a></li>" +
          "</ul>" +
          '<p class="ds-phone-tip">Plain <code>http://…:8765</code> loads the gallery but <strong>blocks the camera</strong> on iPhone/Android. ' +
          "Gallery only: <a class=\"ds-phone-link\" href=\"" +
          httpsGallery +
          '">' +
          httpsGallery +
          "</a></p>"
      );
    }

    render("<strong>Phone camera</strong> — loading HTTPS link…");
    fetchPhoneAccess().then(function (data) {
      var dream =
        (data && (data.https_dream || data.httpsDream)) || defaultHttpsDreamUrl();
      var gallery =
        (data && (data.https_gallery || data.httpsGallery)) ||
        dream.replace(/#.*$/, "/");
      renderWithHttps(dream, gallery);
    });
  }

  function hashStr(s) {
    var h = 2166136261;
    s = String(s || "");
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function timeOfDayMood() {
    var h = new Date().getHours();
    if (h >= 5 && h < 9) return { name: "dawn", glow: [255, 190, 140], deep: [40, 30, 50] };
    if (h >= 9 && h < 17) return { name: "daylit dream", glow: [180, 200, 230], deep: [30, 40, 55] };
    if (h >= 17 && h < 21) return { name: "dusk", glow: [220, 140, 100], deep: [35, 25, 45] };
    return { name: "night stasis", glow: [140, 120, 200], deep: [12, 10, 28] };
  }

  function sessionElapsed() {
    if (!state.sessionStart) return 0;
    return Math.floor((Date.now() - state.sessionStart) / 1000);
  }

  function formatElapsed(sec) {
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  function paintingUrlFor(n) {
    if (typeof window.getPaintingUrl === "function") return window.getPaintingUrl(n);
    return "paintings/" + n + ".jpg";
  }

  function generatedUrlFor(n) {
    var key = String(n);
    var file = state.generatedFiles && state.generatedFiles[key];
    if (file) return "/generated/" + file;
    return "/generated/" + n + ".jpg";
  }

  /** Virtual pool — no 4000-object arrays. Build one entry on demand. */
  function poolLength() {
    if (state.pool === "paintings") return 1000;
    var nums = state.generatedNums;
    if (nums && nums.length) return nums.length;
    return 0;
  }

  function poolNumberAt(index) {
    if (state.pool === "paintings") {
      var pi = ((index % 1000) + 1000) % 1000;
      return pi + 1;
    }
    var nums = state.generatedNums || [];
    if (!nums.length) return null;
    var gi = ((index % nums.length) + nums.length) % nums.length;
    return nums[gi];
  }

  function sourceAt(index) {
    var n = poolNumberAt(index);
    if (n == null) return null;
    var cache = state._srcCache || (state._srcCache = {});
    var key = state.pool + ":" + n;
    if (cache[key]) return cache[key];
    var isPaint = state.pool === "paintings";
    var src = {
      url: isPaint ? paintingUrlFor(n) : generatedUrlFor(n),
      kind: "still",
      whisper: (isPaint ? "Painting #" : "Generated #") + n,
      number: n,
      collection: isPaint ? "paintings" : "generated",
      paintingNum: isPaint ? n : null,
      title: (isPaint ? "Painting #" : "Generated #") + n,
      description: "",
      prompt: "",
    };
    // Keep cache tiny
    var keys = Object.keys(cache);
    if (keys.length > 24) delete cache[keys[0]];
    cache[key] = src;
    return src;
  }

  function currentSource() {
    return sourceAt(state.index);
  }

  // Compatibility shim: code that used state.sources[i] / .length
  function syncSourcesShim() {
    var len = poolLength();
    // Lightweight proxy array — only materializes via getter for length/index
    var arr = [];
    arr.length = len;
    // Only attach current for any code that reads state.sources[state.index] without sourceAt
    if (len > 0) {
      var cur = sourceAt(state.index);
      if (cur) arr[state.index] = cur;
    }
    state.sources = arr;
    return len;
  }

  function updateCounter() {
    var el = $("ds-counter");
    if (!el) return;
    var total = poolLength();
    var src = currentSource();
    if (!src || !total) {
      el.textContent = "—";
      return;
    }
    var label =
      src.collection === "paintings"
        ? "#" + src.number
        : "G#" + src.number;
    el.textContent = label + " · " + (state.index + 1) + "/" + total;
  }

  function setPoolButtons() {
    var g = $("ds-btn-pool-gen");
    var p = $("ds-btn-pool-paint");
    if (g) g.classList.toggle("active", state.pool === "generated");
    if (p) p.classList.toggle("active", state.pool === "paintings");
  }

  function buildPoolSources(pool) {
    state.pool = pool || state.pool || "generated";
    state._srcCache = {};
    if (state.index >= poolLength()) state.index = 0;
    setPoolButtons();
    return syncSourcesShim();
  }

  var _poolLoadPromise = null;

  function applyDreamPoolPayload(d) {
    if (!d || !Array.isArray(d.generated_nums) || !d.generated_nums.length) {
      return buildPoolSources(state.pool || "generated");
    }
    state.generatedNums = d.generated_nums
      .map(function (x) {
        return parseInt(x, 10);
      })
      .filter(function (n) {
        return n > 0;
      });
    state.generatedFiles =
      d.generated_files && typeof d.generated_files === "object"
        ? d.generated_files
        : {};
    state.poolReady = true;
    state._srcCache = {};
    return buildPoolSources(state.pool || "generated");
  }

  function loadDreamPool(force) {
    // Real list already loaded — reuse (localhost + phone)
    if (!force && state.poolReady && state.generatedNums && state.generatedNums.length) {
      return Promise.resolve(buildPoolSources(state.pool || "generated"));
    }
    if (!force && _poolLoadPromise) return _poolLoadPromise;

    // Instant paint with placeholder ONLY until network returns (do not treat as ready)
    if (!state.generatedNums || !state.generatedNums.length) {
      state.generatedNums = [1];
      state.poolReady = false;
      buildPoolSources("generated");
    }

    // Never force-cache: that stuck localhost on stale/empty responses
    var url = apiUrl("/api/dream-pool") + (force ? "?force=1&t=" + Date.now() : "");
    _poolLoadPromise = fetch(url, { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("dream-pool HTTP " + r.status);
        return r.json();
      })
      .then(function (d) {
        return applyDreamPoolPayload(d);
      })
      .catch(function (err) {
        console.warn("[dream] pool load failed", err);
        // Keep placeholder so UI still shows something
        state.poolReady = false;
        return buildPoolSources(state.pool || "generated");
      })
      .then(function (n) {
        _poolLoadPromise = null;
        return n;
      });
    return _poolLoadPromise;
  }

  function collectSources() {
    return loadDreamPool(false);
  }

  /* —— Inventory (page only — never build 4000 DOM nodes) —— */
  function openInventory(kind) {
    state.invKind = kind || state.invKind || "paintings";
    state.invOpen = true;
    state.invPage = 0;
    var inv = $("ds-inv");
    if (inv) inv.hidden = false;
    var tP = $("ds-inv-tab-paintings");
    var tG = $("ds-inv-tab-generated");
    if (tP) tP.classList.toggle("active", state.invKind === "paintings");
    if (tG) tG.classList.toggle("active", state.invKind === "generated");
    // Ensure nums exist for generated inventory
    if (state.invKind === "generated" && (!state.generatedNums || state.generatedNums.length < 2)) {
      loadDreamPool(false).then(function () {
        renderInventory();
      });
    }
    renderInventory();
  }

  function closeInventory() {
    state.invOpen = false;
    var inv = $("ds-inv");
    if (inv) inv.hidden = true;
  }

  function inventoryPageSlice() {
    var size = state.invPageSize || 40;
    if (state.invKind === "generated") {
      var nums = state.generatedNums || [];
      var pages = Math.max(1, Math.ceil(nums.length / size) || 1);
      if (state.invPage >= pages) state.invPage = pages - 1;
      if (state.invPage < 0) state.invPage = 0;
      var start = state.invPage * size;
      var slice = nums.slice(start, start + size);
      return {
        total: nums.length,
        pages: pages,
        items: slice.map(function (n) {
          return {
            num: n,
            url: generatedUrlFor(n),
            label: "G#" + n,
            collection: "generated",
          };
        }),
      };
    }
    var pagesP = Math.ceil(1000 / size);
    if (state.invPage >= pagesP) state.invPage = pagesP - 1;
    if (state.invPage < 0) state.invPage = 0;
    var startP = state.invPage * size + 1;
    var endP = Math.min(1000, startP + size - 1);
    var items = [];
    for (var i = startP; i <= endP; i++) {
      items.push({
        num: i,
        url: paintingUrlFor(i),
        label: "#" + i,
        collection: "paintings",
      });
    }
    return { total: 1000, pages: pagesP, items: items };
  }

  function renderInventory() {
    var grid = $("ds-inv-grid");
    var title = $("ds-inv-title");
    var pageLab = $("ds-inv-page-label");
    if (!grid) return;
    var page = inventoryPageSlice();
    if (title) {
      title.textContent =
        state.invKind === "generated"
          ? "Generated (" + page.total + ")"
          : "Paintings 1–1000";
    }
    if (pageLab) pageLab.textContent = state.invPage + 1 + " / " + page.pages;
    // Build with DocumentFragment — only this page
    var frag = document.createDocumentFragment();
    page.items.forEach(function (it) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ds-inv-cell";
      btn.title = it.label;
      var img = document.createElement("img");
      img.loading = "lazy";
      img.decoding = "async";
      img.alt = it.label;
      img.src = it.url;
      var span = document.createElement("span");
      span.textContent = it.label;
      btn.appendChild(img);
      btn.appendChild(span);
      btn.addEventListener("click", function () {
        selectFromInventory(it);
      });
      frag.appendChild(btn);
    });
    grid.innerHTML = "";
    grid.appendChild(frag);
  }

  function selectFromInventory(it) {
    if (!it) return;
    state.pool = it.collection === "paintings" ? "paintings" : "generated";
    buildPoolSources(state.pool);
    var idx = 0;
    if (state.pool === "paintings") {
      idx = Math.max(0, (it.num || 1) - 1);
    } else {
      var nums = state.generatedNums || [];
      idx = nums.indexOf(it.num);
      if (idx < 0) idx = 0;
    }
    state.index = idx;
    closeInventory();
    if (!state.inhabiting) enterDream();
    else {
      showLayer(idx);
      updateCounter();
      setStatus(
        (it.collection === "paintings" ? "Painting #" : "Generated #") +
          it.num +
          " — Read cam → Fuse."
      );
    }
    setPoolButtons();
  }

  function persistLight() {
    try {
      localStorage.setItem(
        STATE_KEY,
        JSON.stringify({
          pool: state.pool,
          index: state.index,
          whisper: state.whisperText,
          cameraSubject: state.cameraSubject,
          composedDreamPrompt: state.composedDreamPrompt,
          cycleOn: state.cycleOn,
        })
      );
    } catch (e) {}
  }

  /**
   * Camera subject is primary; current dream vision / spells are the world-spell.
   * Text + visual references must both be used (not camera-only).
   */
  function composeAroundCameraSubject(cameraPrompt, environmentHint) {
    var subject = String(cameraPrompt || "").trim();
    var env = String(environmentHint || "").trim();
    if (!subject) return env;
    var envBlock = env
      ? env
      : "soft stasis light, painterly field, dream haze, museum atmosphere";
    return (
      "SPELL-CAST DREAM (mandatory — do not ignore attached spell reference images):\n" +
      "The attached spell / dream-environment image(s) define the WORLD: palette, brushwork, " +
      "motifs, architecture, lighting grammar, and material DNA. Paint the scene as if those " +
      "spells are the planet the subject is standing on.\n\n" +
      "PRIMARY SUBJECT (live camera — keep this person/pose/clothing/room presence legible):\n" +
      subject +
      "\n\n" +
      "DREAM ENVIRONMENT / SPELL TEXT (world-skin from dream matter + equipped spells):\n" +
      envBlock +
      "\n\n" +
      "COMPOSITION DIRECTIVE:\n" +
      "One imaginative full-bleed stasis scene. The camera subject is the clear focal presence " +
      "placed INSIDE the spell world — not a plain photo of the room, not a camera-only re-render. " +
      "Fuse: subject identity + spell color/brush/atmosphere/setting. " +
      "No collage panels, no picture-in-picture, no UI, no watermark, no text overlays. " +
      "Museum-quality painterly stasis, aspect full bleed."
    );
  }

  function absAssetUrl(u) {
    var s = String(u || "").trim();
    if (!s) return "";
    if (/^(https?:|data:|blob:)/i.test(s)) return s;
    try {
      return new URL(s, window.location.href).href;
    } catch (e) {
      return s;
    }
  }

  function analysisForSource(src) {
    if (!src) return null;
    var n = src.paintingNum != null ? src.paintingNum : src.number;
    if (n == null) return null;
    try {
      if (typeof window.getSpellforgeSpellAnalysis === "function") {
        var a = window.getSpellforgeSpellAnalysis(n);
        if (a) return a;
      }
    } catch (e0) {}
    // Gallery analyses if already loaded
    try {
      if (window.GalleryJump && typeof window.getAnalysis === "function") {
        var g = window.getAnalysis(n);
        if (g) return g;
      }
    } catch (e1) {}
    return null;
  }

  function currentEnvironmentHint() {
    var src = currentSource();
    var bits = [];
    if (src) {
      if (src.collection === "paintings" && src.number) {
        bits.push("WORLD-SPELL: gallery painting #" + src.number);
      } else if (src.collection === "generated" && src.number) {
        bits.push("WORLD-SPELL: generated still G#" + src.number);
      }
      if (src.title) bits.push(src.title);
      if (src.whisper) bits.push(src.whisper);
      if (src.description) bits.push(src.description);
      if (src.prompt) bits.push(String(src.prompt).slice(0, 500));
    }
    bits.push(timeOfDayMood().name + " light");
    return bits.filter(Boolean).join("\n");
  }

  /** Current vision only as spell ref — keep generation path light. */
  function gatherDreamSpellPack() {
    var pack = {
      spells: [],
      spell_details: [],
      spellRefUrl: "",
      secondaryRefs: [],
      labels: [],
    };
    var src = currentSource();
    if (!src || !src.url) return pack;
    var url = absAssetUrl(src.url);
    pack.spellRefUrl = url;
    pack.labels.push(
      src.collection === "paintings" ? "painting #" + src.number : "G#" + src.number
    );
    if (src.collection === "paintings" && src.number >= 1 && src.number <= 1000) {
      pack.spells.push(src.number);
    }
    pack.spell_details.push({
      number: src.number,
      url: url,
      title: src.title || "",
      description: String(src.description || src.whisper || "").slice(0, 400),
      prompt: String(src.prompt || "").slice(0, 240),
      source: src.collection === "generated" ? "generated" : "painting",
      slot: 0,
    });
    return pack;
  }

  function refreshComposedDreamPrompt() {
    if (!state.cameraSubject) {
      state.composedDreamPrompt = "";
      document.body.classList.remove("ds-subject-locked");
      return "";
    }
    state.composedDreamPrompt = composeAroundCameraSubject(
      state.cameraSubject,
      currentEnvironmentHint()
    );
    document.body.classList.add("ds-subject-locked");
    var ta = $("ds-live-prompt");
    // Keep editable field showing the composed generative prompt when subject is locked
    if (ta && state.composedDreamPrompt) {
      ta.value = state.composedDreamPrompt;
    }
    var label = $("ds-live-prompt-label");
    if (label) {
      label.textContent = "Dream prompt · camera subject + surrounding vision";
    }
    return state.composedDreamPrompt;
  }

  function lockCameraSubject(promptText, opts) {
    opts = opts || {};
    var t = String(promptText || "").trim();
    if (!t) return false;
    state.cameraSubject = t;
    state.livePromptText = t;
    refreshComposedDreamPrompt();
    state.whisperText = t.slice(0, 280);
    showWhisper(state.whisperText);
    applySkinFromCurrent();
    persistLight();
    var btn = $("ds-btn-live-whisper");
    if (btn) {
      btn.classList.add("active");
      btn.textContent = "Subject locked";
    }
    var clearBtn = $("ds-btn-clear-subject");
    if (clearBtn) clearBtn.hidden = false;
    if (!opts.skipGenerate) {
      setStatus("Subject locked — generating a new vision around you…");
      generateWhisperImageAndOpenIndex();
    } else {
      setStatus(
        "Camera subject locked — dream visions wrap generative prompt around you."
      );
    }
    return true;
  }

  function delayMs(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function extractImageUrl(payload) {
    if (!payload) return "";
    var img = payload.image || (payload.images && payload.images[0]);
    var raw =
      (img && (img.url || img.download_url || img.uri)) ||
      payload.image_url ||
      payload.output_url ||
      "";
    if (!raw) return "";
    if (/^(https?:|data:|blob:)/i.test(raw)) return raw;
    try {
      return new URL(raw, window.location.href).href;
    } catch (e) {
      return raw;
    }
  }

  function pollDreamImageJob(jobId, left) {
    if (left == null) left = 100;
    if (left <= 0) {
      return Promise.reject(new Error("Timed out waiting for dream image."));
    }
    return fetch(apiUrl("/api/jobs/" + encodeURIComponent(jobId)), {
      cache: "no-store",
    })
      .then(function (r) {
        return r.json().then(function (d) {
          return { ok: r.ok, d: d };
        });
      })
      .then(function (res) {
        var job = res.d || {};
        var st = String(job.status || "working").toLowerCase();
        setStatus("Whisper generating… " + st + " (" + left + ")");
        if (st === "done" || st === "completed" || st === "success") {
          var url = extractImageUrl(job);
          if (url) return { url: url, job: job };
          throw new Error("Job done but no image URL.");
        }
        if (st === "failed" || st === "error" || st === "expired") {
          throw new Error(
            (job.error && (job.error.message || job.error)) || "Generate failed"
          );
        }
        return delayMs(1500).then(function () {
          return pollDreamImageJob(jobId, left - 1);
        });
      });
  }

  function saveDreamStill(url, prompt) {
    return fetch(apiUrl("/api/save-generated-image"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_url: url,
        source: "dream-stasis",
        collection: "generated",
        description: String(prompt || "Dream fusion").slice(0, 200),
        meta: {
          source: "dream-stasis-new",
          camera: String(state.cameraSubject || state.livePromptText || "").slice(0, 400),
          prompt: String(prompt || "").slice(0, 800),
        },
      }),
    })
      .then(function (r) {
        return r.json().then(function (d) {
          if (!r.ok || (d && d.ok === false)) {
            throw new Error((d && d.error) || "Save failed");
          }
          return d;
        });
      });
  }

  /**
   * NEW image only: text prompt = camera + selected image description.
   * No reference image (that was returning the same picture).
   */
  function generateNewFromPrompts(combinedPrompt) {
    var prompt = String(combinedPrompt || "").trim();
    if (prompt.length < 8) {
      setStatus("Need camera text and a selected image description.");
      return Promise.resolve();
    }
    if (state.generatingWhisper) {
      setStatus("Already generating…");
      return Promise.resolve();
    }

    var beforeUrl = currentSource() && currentSource().url;
    state.generatingWhisper = true;
    var jobId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : "dream-" + Date.now();

    // Plain text generation — mag_fresh, no reference_image, no spell_cast
    var body = {
      job_id: jobId,
      stasis: prompt.slice(0, 4000),
      prompt: prompt.slice(0, 4000),
      fused_prompt: prompt.slice(0, 4000),
      buzz_words: ["new original painting", "not a copy", "full bleed", "imaginative"],
      spells: [],
      aspect_ratio: "16:9",
      mag_fresh: true,
      fresh_variation: true,
      spell_cast: false,
      source: "dream-stasis-new",
    };

    setStatus("Generating NEW image from camera + selected description…");
    return fetch(apiUrl("/api/generate-stasis-vision"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    })
      .then(function (r) {
        return r.json().then(function (d) {
          return { ok: r.ok, status: r.status, d: d };
        });
      })
      .then(function (res) {
        var d = res.d || {};
        if (res.status === 202 || (!extractImageUrl(d) && (d.job_id || jobId))) {
          return pollDreamImageJob(d.job_id || jobId);
        }
        if (!res.ok) {
          throw new Error((d && d.error) || "Generate failed");
        }
        var url = extractImageUrl(d);
        if (!url && d.job_id) return pollDreamImageJob(d.job_id);
        if (!url) throw new Error("No image returned");
        return { url: url, job: d };
      })
      .then(function (result) {
        var url = result.url;
        // Reject if server echoed the same selected image
        if (beforeUrl && url && String(url).indexOf(String(beforeUrl).replace(/^\//, "")) >= 0) {
          throw new Error("Got the same image back — try again.");
        }
        setStatus("Saving new image…");
        return saveDreamStill(url, prompt).then(function (saved) {
          var num = saved && saved.num != null ? saved.num : null;
          var finalUrl =
            (saved && saved.url) ||
            (num != null ? "/generated/" + num + ".jpg" : url);
          if (num != null) {
            if (!state.generatedNums) state.generatedNums = [];
            if (state.generatedNums.indexOf(num) < 0) {
              state.generatedNums.push(num);
              state.generatedNums.sort(function (a, b) {
                return a - b;
              });
            }
            if (!state.generatedFiles) state.generatedFiles = {};
            state.generatedFiles[String(num)] = String(num) + ".jpg";
            state.pool = "generated";
            state.poolReady = true;
            buildPoolSources("generated");
            state.index = state.generatedNums.indexOf(num);
            if (state.index < 0) state.index = state.generatedNums.length - 1;
          } else {
            // Show by absolute URL even without a G# yet
            state.pool = "generated";
            state.generatedNums = state.generatedNums || [1];
            state._srcCache = state._srcCache || {};
            state._srcCache["generated:new"] = {
              url: finalUrl,
              kind: "still",
              number: null,
              collection: "generated",
              title: "New fusion",
              whisper: "New fusion",
              prompt: prompt.slice(0, 400),
            };
            // Force show via temporary single-source view
            showLayer(state.index);
            var a = $("ds-layer-a");
            var b = $("ds-layer-b");
            var layer = a && a.classList.contains("active") ? a : b;
            if (layer) {
              layer.style.backgroundImage =
                'url("' + String(finalUrl).replace(/"/g, "%22") + '")';
            }
          }
          if (num != null) showLayer(state.index);
          persistLight();
          var jumpEl = $("ds-jump-num");
          if (jumpEl && num != null) jumpEl.value = "G#" + num;
          setStatus(
            num != null
              ? "NEW image · G#" + num
              : "NEW image saved"
          );
          return saved;
        });
      })
      .catch(function (err) {
        setStatus(
          (err && err.message) ||
            "Generate failed — is start_server.bat running with API key?"
        );
      })
      .then(function () {
        state.generatingWhisper = false;
      });
  }

  /** @deprecated name kept for call sites */
  function generateWhisperImageAndOpenIndex() {
    return generateNewFromPrompts(
      state.composedDreamPrompt || buildSimpleFusionPrompt()
    );
  }

  /**
   * Load painting # or Generated G# into Dream Stasis only — never leave this tab.
   */
  function jumpByNumber(raw) {
    var s = String(raw || "").trim().toLowerCase();
    if (!s) {
      setStatus("Enter a number (e.g. 42 or G#120) to use in the dream.");
      return;
    }
    var gen = false;
    if (s.charAt(0) === "g") {
      gen = true;
      s = s.replace(/^g#?/, "");
    } else if (s.indexOf("generated") >= 0) {
      gen = true;
      s = s.replace(/[^0-9]/g, "");
    }
    var num = parseInt(s, 10);
    if (!num || num < 1) {
      setStatus("Invalid #.");
      return;
    }

    var useGenerated = gen || num > 1000;
    state.pool = useGenerated ? "generated" : "paintings";
    if (useGenerated) {
      if (!state.generatedNums) state.generatedNums = [];
      if (state.generatedNums.indexOf(num) < 0) {
        state.generatedNums.push(num);
        state.generatedNums.sort(function (a, b) {
          return a - b;
        });
      }
      buildPoolSources("generated");
      state.index = Math.max(0, state.generatedNums.indexOf(num));
    } else {
      buildPoolSources("paintings");
      state.index = Math.max(0, Math.min(999, num - 1));
    }
    if (!state.inhabiting) {
      state.inhabiting = true;
      state.sessionStart = state.sessionStart || Date.now();
      state.lastMove = Date.now();
      document.body.classList.add("ds-inhabiting");
      document.documentElement.classList.add("ds-inhabiting");
      hideGate();
      startCycle();
      cancelAnimationFrame(state.raf);
      state.raf = requestAnimationFrame(tickPresence);
    }
    showLayer(state.index);
    persistLight();
    setStatus(
      (useGenerated ? "G#" : "#") +
        num +
        " · " +
        (state.index + 1) +
        "/" +
        poolLength()
    );
    syncJumpFields((useGenerated ? "G#" : "") + num);
  }

  // Analyses are large — load once, lazily, only when fusing
  var _analysesCache = { paintings: null, generated: null, loading: null };

  function loadAnalysesMap(kind) {
    if (_analysesCache[kind]) return Promise.resolve(_analysesCache[kind]);
    if (_analysesCache.loading) return _analysesCache.loading;
    var url =
      kind === "generated"
        ? apiUrl("/api/lod1-analyses")
        : "data/analyses.json";
    _analysesCache.loading = fetch(url, { cache: "force-cache" })
      .then(function (r) {
        return r.ok ? r.json() : {};
      })
      .then(function (data) {
        _analysesCache[kind] = data && typeof data === "object" ? data : {};
        _analysesCache.loading = null;
        return _analysesCache[kind];
      })
      .catch(function () {
        _analysesCache[kind] = {};
        _analysesCache.loading = null;
        return _analysesCache[kind];
      });
    return _analysesCache.loading;
  }

  function enrichSourceAnalysis(src) {
    if (!src || !src.number) return Promise.resolve(src);
    if (src.prompt) return Promise.resolve(src);
    var kind = src.collection === "generated" ? "generated" : "paintings";
    return loadAnalysesMap(kind).then(function (data) {
      var row = data[String(src.number)] || data[src.number] || null;
      if (!row) return src;
      src.title = row.title || src.title;
      src.description = row.description || src.description;
      src.prompt = row.prompt || src.prompt;
      if (row.title || row.description) {
        src.whisper =
          (row.title || "") +
          (row.description ? " — " + String(row.description).slice(0, 160) : "");
      }
      return src;
    });
  }

  function clearCameraSubject() {
    state.cameraSubject = "";
    state.composedDreamPrompt = "";
    document.body.classList.remove("ds-subject-locked");
    var btn = $("ds-btn-live-whisper");
    if (btn) {
      btn.classList.remove("active");
      btn.textContent = "Whisper into dream";
    }
    var clearBtn = $("ds-btn-clear-subject");
    if (clearBtn) clearBtn.hidden = true;
    var label = $("ds-live-prompt-label");
    if (label) label.textContent = "Live prompt · what the camera sees";
    if (state.livePromptText) {
      writeLivePrompt(state.livePromptText, { title: "live" });
    }
    applySkinFromCurrent();
    persistLight();
    setStatus("Camera subject cleared — dream returns to free drift.");
  }

  function applySkinFromCurrent() {
    var src = currentSource();
    if (!window.StasisInterfaceSkin) return;
    var img = new Image();
    img.crossOrigin = "anonymous";
    var text =
      state.composedDreamPrompt ||
      state.cameraSubject ||
      (src && src.whisper) ||
      state.whisperText ||
      "dream stasis presence absence time soft light imaginary field";
    function go() {
      window.StasisInterfaceSkin.applyNow({
        stasisText: text,
        extraPrompt: state.cameraSubject
          ? "camera subject is primary; dream vision is surrounding world-skin"
          : "imaginative dream field reactive presence",
        visionImg: img.complete && img.naturalWidth ? img : null,
        buzz: state.cameraSubject
          ? ["subject", "presence", "surround", "dream", "stasis"]
          : ["dream", "stasis", "presence", "time", "absence"],
        activeTab: "dream",
      });
      var mood = timeOfDayMood();
      var root = document.documentElement;
      root.style.setProperty("--ds-glow-rgb", mood.glow.join(", "));
      root.style.setProperty("--ds-deep-rgb", mood.deep.join(", "));
    }
    if (src && src.url && src.kind !== "video") {
      img.onload = go;
      img.onerror = go;
      img.src = src.url;
    } else {
      go();
    }
  }

  function showLayer(index) {
    var total = poolLength();
    if (!total) {
      // Instant placeholder until nums load
      state.pool = state.pool || "generated";
      if (!state.generatedNums || !state.generatedNums.length) {
        state.generatedNums = [1];
        total = 1;
      } else return;
    }
    state.index = ((index % total) + total) % total;
    var src = sourceAt(state.index);
    if (!src) return;
    syncSourcesShim();

    var a = $("ds-layer-a");
    var b = $("ds-layer-b");
    if (!a || !b) return;
    var useA = !a.classList.contains("active");
    var next = useA ? a : b;
    var prev = useA ? b : a;

    next.innerHTML = "";
    next.style.backgroundImage = "";
    next.classList.remove("video-wrap");
    // Preload next image in background (fast swipes)
    next.style.backgroundImage =
      'url("' + String(src.url).replace(/"/g, "%22") + '")';
    try {
      var warm = new Image();
      warm.decoding = "async";
      var n2 = poolNumberAt(state.index + 1);
      if (n2 != null) {
        warm.src =
          state.pool === "paintings" ? paintingUrlFor(n2) : generatedUrlFor(n2);
      }
    } catch (eW) {}

    prev.classList.remove("active");
    next.classList.add("active");

    if (src.whisper) state.whisperText = src.whisper;
    showWhisper(
      (src.collection === "generated" ? "G#" : "#") + src.number
    );
    // Skip heavy skin on every swipe (was slowing phones)
    persistLight();
    updateCounter();
    setStatus(
      (src.collection === "generated" ? "G#" : "#") +
        src.number +
        " · " +
        (state.index + 1) +
        "/" +
        total
    );
    // Lightweight fusion text only (no network on swipe)
    writeFusionToField();
    updateFacingButton();
  }

  function showWhisper(text) {
    var el = $("ds-whisper");
    if (!el) return;
    clearTimeout(state.whisperTimer);
    if (!text || !text.trim()) {
      el.classList.remove("show");
      el.textContent = "";
      return;
    }
    // Soft, imaginative — never instructional chrome
    var lines = text
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 220);
    el.textContent = lines;
    el.classList.add("show");
    state.whisperTimer = setTimeout(function () {
      el.classList.remove("show");
    }, WHISPER_MS);
  }

  function blendGaze() {
    // Camera centroid leads when sensing; pointer is a soft secondary
    if (state.camOn) {
      var t = 0.18;
      state.pointer.x += (state.camCentroid.x - state.pointer.x) * t;
      state.pointer.y += (state.camCentroid.y - state.pointer.y) * t;
    }
  }

  function updatePresenceUi() {
    var el = $("ds-presence");
    if (!el) return;
    var p = Math.round(state.presence * 100);
    var cam = state.camOn
      ? " · cam " + Math.round(state.motionMag * 100) + "%"
      : " · cursor only";
    el.textContent =
      (state.absent ? "absence " + (100 - p) + "%" : "presence " + p + "%") + cam;
    document.documentElement.style.setProperty(
      "--ds-presence",
      String(0.22 + state.presence * 0.78)
    );
    document.documentElement.style.setProperty(
      "--ds-px",
      Math.round(state.pointer.x * 100) + "%"
    );
    document.documentElement.style.setProperty(
      "--ds-py",
      Math.round(state.pointer.y * 100) + "%"
    );
    document.body.classList.toggle("ds-absent", state.absent);
    document.body.classList.toggle("ds-cam-on", state.camOn);
  }

  function updateTimeUi() {
    var el = $("ds-time");
    if (!el) return;
    var mood = timeOfDayMood();
    el.textContent =
      mood.name + " · in dream " + formatElapsed(sessionElapsed());
  }

  function tickPresence() {
    blendGaze();
    var idle = Date.now() - state.lastMove;
    var target;
    if (state.camOn) {
      // Body in the room: occupancy + motion are the dream's sense of "you"
      target = clamp(
        0.1 + state.camOccupancy * 0.45 + state.motionMag * 0.55,
        0.06,
        1
      );
      // Still body but in frame = soft presence, not absence
      if (state.camOccupancy > 0.12 && state.motionMag < 0.04) {
        target = Math.max(target, 0.38);
      }
    } else {
      target = idle > IDLE_MS ? 0.12 : 0.55 + state.motionMag * 0.35;
    }
    state.presence += (target - state.presence) * (state.camOn ? 0.08 : 0.04);
    var wasAbsent = state.absent;
    if (state.camOn) {
      state.absent =
        state.camOccupancy < 0.08 && state.motionMag < 0.05 && idle > 4000;
    } else {
      state.absent = idle > IDLE_MS && state.presence < 0.22;
    }
    if (state.absent && !wasAbsent) {
      showWhisper("The field notices a hollow — time continues without your weight.");
    } else if (!state.absent && wasAbsent) {
      showWhisper(
        state.camOn
          ? "You return to the frame. The dream leans toward you."
          : "You return. The dream leans toward you again."
      );
    }
    // Parallax — stronger when the camera tracks you
    var lean = state.camOn ? 3.4 : 2.2;
    var layers = document.querySelectorAll(".ds-layer.active");
    var ox = (state.pointer.x - 0.5) * lean * (0.45 + state.presence);
    var oy = (state.pointer.y - 0.5) * (lean * 0.85) * (0.45 + state.presence);
    var sc = 1.08 + state.presence * 0.08 + state.motionMag * 0.04;
    for (var i = 0; i < layers.length; i++) {
      layers[i].style.transform =
        "scale(" + sc + ") translate(" + ox + "%," + oy + "%)";
    }
    // Bloom reacts to breath of motion
    var bloom = $("ds-bloom");
    if (bloom) {
      bloom.style.opacity = String(0.2 + state.presence * 0.65 + state.motionMag * 0.25);
    }
    updatePresenceUi();
    updateTimeUi();
    if (state.inhabiting) {
      // Cap ~20fps presence loop so other tabs stay responsive
      state.raf = setTimeout(function () {
        state.raf = requestAnimationFrame(tickPresence);
      }, 50);
    }
  }

  function onPointer(e) {
    var stage = $("ds-stage");
    if (!stage) return;
    var r = stage.getBoundingClientRect();
    var x = e.clientX != null ? e.clientX : e.touches && e.touches[0] && e.touches[0].clientX;
    var y = e.clientY != null ? e.clientY : e.touches && e.touches[0] && e.touches[0].clientY;
    if (x == null) return;
    state.pointer.x = clamp((x - r.left) / Math.max(1, r.width), 0, 1);
    state.pointer.y = clamp((y - r.top) / Math.max(1, r.height), 0, 1);
    state.lastMove = Date.now();
    state.motionMag = clamp(state.motionMag * 0.85 + 0.2, 0, 1);
  }

  function startCycle() {
    clearInterval(state.cycleTimer);
    if (!state.cycleOn || poolLength() < 2) return;
    state.cycleTimer = setInterval(function () {
      if (!state.inhabiting || !state.cycleOn) return;
      // Slow when absent — the dream holds; active presence advances
      if (state.absent && Math.random() > 0.35) return;
      showLayer(state.index + 1);
    }, CYCLE_MS);
  }

  function stopCycle() {
    clearInterval(state.cycleTimer);
    state.cycleTimer = 0;
  }

  function hideGate() {
    var gate = $("ds-gate");
    if (!gate) return;
    gate.classList.add("hidden");
    gate.hidden = true;
    try {
      gate.style.display = "none";
    } catch (e) {}
  }

  function showGate() {
    // Gate is no longer the main UI — stay in field; Surface just stops camera
    hideGate();
  }

  function syncJumpFields(raw) {
    var a = $("ds-jump-num");
    var b = $("ds-jump-num-gate");
    var v = raw != null ? String(raw) : a && a.value;
    if (a && v != null) a.value = v;
    if (b && v != null) b.value = v;
  }

  function ensureDefaultVision() {
    var typed = ($("ds-jump-num") && $("ds-jump-num").value) || "";
    typed = String(typed || "").trim();

    state.pool = state.pool || "generated";
    // Show something immediately on localhost and phone
    if (!state.generatedNums || !state.generatedNums.length) {
      state.generatedNums = [1];
      state.poolReady = false;
    }
    buildPoolSources(state.pool);
    if (typed) {
      jumpByNumber(typed);
    } else {
      showLayer(state.index || 0);
      updateCounter();
    }

    // Always fetch real pool (placeholder [1] must not block this)
    return loadDreamPool(false).then(function (n) {
      if (typed) {
        // Re-resolve index after full list arrives
        jumpByNumber(typed);
      } else if (state.index >= n) {
        state.index = 0;
        showLayer(0);
      } else {
        updateCounter();
        // Refresh current image URL if extension map arrived
        showLayer(state.index);
      }
      return n;
    });
  }

  /** Description/prompt text from the selected still (not the image file). */
  function selectedVisionPrompt() {
    var src = currentSource();
    if (!src) return "";
    var bits = [];
    if (src.prompt) bits.push(String(src.prompt).trim());
    if (src.description) bits.push(String(src.description).trim());
    if (src.title) bits.push(String(src.title).trim());
    if (!bits.length && src.whisper && !/^Generated #|^Painting #/.test(src.whisper)) {
      bits.push(String(src.whisper).trim());
    }
    var a = analysisForSource(src);
    if (a) {
      if (a.prompt) bits.push(String(a.prompt).trim());
      if (a.description) bits.push(String(a.description).trim());
      if (a.style) bits.push(String(a.style).trim() + " style");
      if (a.mood) bits.push(String(a.mood).trim() + " mood");
    }
    var seen = {};
    var out = [];
    bits.forEach(function (b) {
      if (!b || seen[b]) return;
      seen[b] = true;
      out.push(b);
    });
    return out.join(". ").slice(0, 1800);
  }

  function cameraPromptText() {
    var live = String(state.livePromptText || "").trim();
    if (live && live.indexOf("NEW IMAGE") < 0 && live.indexOf("FUSION") < 0) {
      return live;
    }
    var ta = $("ds-live-prompt");
    var field = ta ? String(ta.value || "").trim() : "";
    // If field is our combined prompt, don't treat whole thing as camera
    if (field && field.indexOf("NEW IMAGE") === 0) {
      return String(state.cameraSubject || "").trim();
    }
    if (field && field.indexOf("CAMERA:") < 0 && field.indexOf("FROM SELECTED") < 0) {
      return field;
    }
    return String(state.cameraSubject || "").trim();
  }

  /**
   * Simple: NEW painting from camera text + pieces of selected image description.
   */
  function buildSimpleFusionPrompt() {
    var cam = cameraPromptText();
    var vision = selectedVisionPrompt();
    var src = currentSource();
    var tag =
      src && src.collection === "paintings"
        ? "painting #" + src.number
        : src && src.number
          ? "G#" + src.number
          : "selected image";

    if (!cam && !vision) {
      return "";
    }

    return (
      "NEW IMAGE (original — do not copy any existing photo or file).\n\n" +
      "CAMERA: " +
      (cam || "a living human presence in the scene") +
      "\n\n" +
      "FROM SELECTED IMAGE (" +
      tag +
      ") — take palette, mood, setting, and style elements only:\n" +
      (vision || "painterly atmosphere, rich color, museum still") +
      "\n\n" +
      "Combine into one new full-bleed imaginative painting. " +
      "Camera content is the subject; selected-image text supplies world and style. " +
      "No text overlays, no watermark, no collage panels."
    );
  }

  function buildFusionPrompt() {
    return buildSimpleFusionPrompt();
  }

  function writeFusionToField() {
    var fused = buildSimpleFusionPrompt();
    state.composedDreamPrompt = fused;
    var ta = $("ds-live-prompt");
    if (ta) ta.value = fused || ta.value;
    var panel = $("ds-live-prompt-panel");
    if (panel) panel.hidden = false;
    var label = $("ds-live-prompt-label");
    if (label) label.textContent = "Camera + selected description → NEW image";
    return fused;
  }

  /**
   * Enter the field: already in chamber on Generated first→last.
   * Paintings via Inventory. Never blocked by camera/API.
   */
  function enterDream(ev) {
    if (ev && ev.preventDefault) ev.preventDefault();
    try {
      state.inhabiting = true;
      state.sessionStart = state.sessionStart || Date.now();
      state.lastMove = Date.now();
      document.body.classList.add("ds-inhabiting");
      document.documentElement.classList.add("ds-inhabiting");
      hideGate();
      setStatus("Loading generated first → last…");
    } catch (eBoot) {
      console.error(eBoot);
    }

    try {
      startCycle();
    } catch (e0) {}
    try {
      cancelAnimationFrame(state.raf);
      state.raf = requestAnimationFrame(tickPresence);
    } catch (e1) {}

    // Show first image immediately (no waiting on network)
    ensureDefaultVision().then(function (n) {
      if (!state.inhabiting) return;
      updateCounter();
      setStatus(
        "In the field · Generated " +
          (state.index + 1) +
          "/" +
          n +
          " — ‹ › · Paintings · Read cam · Fuse"
      );
    });

    // Do NOT auto-start camera after a delay — iOS only allows getUserMedia
    // from a real tap. User taps Camera (or Read cam) on the phone.
    if (isPhoneClient()) {
      setStatus(
        (state.sources && poolLength()
          ? "In the field · tap Camera to allow the phone camera"
          : "In the field") + " · then Read cam / Generate"
      );
    }
  }

  /** NEW image: camera text + selected image description (text only). */
  function fuseNow() {
    if (!state.inhabiting) enterDream();
    var src = currentSource();
    if (!src) {
      setStatus("Pick a still with ‹ › first.");
      return Promise.resolve();
    }

    function runGenerate() {
      var cam = cameraPromptText();
      if (cam) state.cameraSubject = cam;
      if (!cam) {
        setStatus("Read cam first (or type camera text in the box), then Fuse.");
        return null;
      }
      var fused = writeFusionToField();
      if (!fused) {
        setStatus("Need camera text + selected image description.");
        return null;
      }
      state.composedDreamPrompt = fused;
      return generateNewFromPrompts(fused);
    }

    var chain = Promise.resolve();
    if (state.camOn && !String(state.livePromptText || "").trim()) {
      chain = runLivePromptOnce(false).catch(function () {});
    }
    return chain
      .then(function () {
        return enrichSourceAnalysis(src);
      })
      .then(function () {
        return runGenerate();
      });
  }

  function surface() {
    // Stay in the field visually; only release camera / full immerse
    state.immersing = false;
    var panel = $("panel-dream");
    if (panel) panel.classList.remove("ds-immersive");
    document.body.classList.remove("ds-immersive-body");
    stopLivePromptLoop();
    stopCamera();
    closeInventory();
    hideGate();
    setStatus("Camera off — still in the field. ‹ › browse · Paintings · Fuse");
  }

  function setHudHidden(hidden) {
    state.hudHidden = !!hidden;
    document.body.classList.toggle("ds-hud-hidden", state.hudHidden);
    var dock = $("ds-float-dock");
    if (dock) dock.hidden = !state.hudHidden;
    if (state.hudHidden) {
      setStatus("HUD hidden — tap Show HUD, or Talk. Keys: H show/hide · T talk");
    }
  }

  function toggleHud() {
    setHudHidden(!state.hudHidden);
  }

  function getSpeechRecognition() {
    return window.SpeechRecognition || window.webkitSpeechRecognition || null;
  }

  function stopTalking() {
    state.talking = false;
    document.body.classList.remove("ds-talking");
    ["ds-btn-talk", "ds-btn-talk-float"].forEach(function (id) {
      var b = $(id);
      if (b) {
        b.classList.remove("active");
        b.textContent = "Talk";
      }
    });
    try {
      if (state.speechRec) {
        state.speechRec.onresult = null;
        state.speechRec.onerror = null;
        state.speechRec.onend = null;
        state.speechRec.stop();
      }
    } catch (e) {}
    state.speechRec = null;
  }

  function speakDream(text) {
    if (!text || !window.speechSynthesis) return;
    try {
      window.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(String(text).slice(0, 500));
      u.rate = 0.95;
      u.pitch = 0.95;
      u.volume = 1;
      window.speechSynthesis.speak(u);
    } catch (e) {}
  }

  function dreamReplyTo(heard) {
    var src = currentSource();
    var vision = selectedVisionPrompt() || (src && (src.title || src.whisper)) || "this vision";
    var who =
      src && src.collection === "paintings"
        ? "painting " + src.number
        : src && src.number
          ? "generated " + src.number
          : "the field";
    var line = String(heard || "").trim();
    // Short spoken reply — field answers in character
    var reply =
      "I hear you. " +
      (line
        ? "You said: " + line.slice(0, 160) + ". "
        : "") +
      "We are inside " +
      who +
      ". " +
      String(vision).slice(0, 180) +
      " Stay with me in the field.";
    return reply.replace(/\s+/g, " ").trim();
  }

  function onHeardSpeech(finalText) {
    var t = String(finalText || "").trim();
    if (!t) return;
    state.lastHeard = t;
    state.livePromptText = t;
    state.cameraSubject = t;
    showWhisper("You: " + t.slice(0, 200));
    setStatus("You said: “" + t.slice(0, 100) + "”");
    var ta = $("ds-live-prompt");
    // Keep typed fusion separate; store speech as camera line
    if (ta && (!ta.value || ta.value.indexOf("NEW IMAGE") === 0)) {
      // leave fusion box; speech is camera input
    }
    var reply = dreamReplyTo(t);
    showWhisper(reply.slice(0, 220));
    speakDream(reply);
    // Soft-update fusion prompt with speech as camera
    try {
      writeFusionToField();
    } catch (e) {}
  }

  function startTalking() {
    var SR = getSpeechRecognition();
    if (!SR) {
      setStatus("Talk needs Chrome or Edge (speech recognition).");
      return;
    }
    stopTalking();
    state.talking = true;
    document.body.classList.add("ds-talking");
    ["ds-btn-talk", "ds-btn-talk-float"].forEach(function (id) {
      var b = $(id);
      if (b) {
        b.classList.add("active");
        b.textContent = "Listening…";
      }
    });
    setStatus("Listening — speak to the field. Tap Talk again to stop.");

    var rec = new SR();
    state.speechRec = rec;
    rec.lang = (navigator.language || "en-US").slice(0, 5) || "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    var finalBuf = "";

    rec.onresult = function (ev) {
      var interim = "";
      for (var i = ev.resultIndex; i < ev.results.length; i++) {
        var piece = ev.results[i][0].transcript || "";
        if (ev.results[i].isFinal) finalBuf += piece + " ";
        else interim += piece;
      }
      var live = (finalBuf + " " + interim).trim();
      if (live) showWhisper("You: " + live.slice(0, 200));
      if (finalBuf.trim().length > 2 && !interim) {
        var said = finalBuf.trim();
        finalBuf = "";
        onHeardSpeech(said);
      }
    };
    rec.onerror = function (ev) {
      var err = (ev && ev.error) || "";
      if (err === "no-speech" || err === "aborted") return;
      setStatus("Talk error: " + err + " — allow microphone for this site.");
      stopTalking();
    };
    rec.onend = function () {
      // Restart while still in talk mode (Chrome ends after pauses)
      if (state.talking && state.speechRec === rec) {
        try {
          rec.start();
        } catch (e2) {
          stopTalking();
        }
      }
    };
    try {
      rec.start();
    } catch (e) {
      setStatus("Could not start microphone — allow mic, use Chrome/Edge.");
      stopTalking();
    }
  }

  function toggleTalk() {
    if (state.talking) stopTalking();
    else startTalking();
  }

  function toggleImmerse() {
    state.immersing = !state.immersing;
    var panel = $("panel-dream");
    if (panel) panel.classList.toggle("ds-immersive", state.immersing);
    document.body.classList.toggle("ds-immersive-body", state.immersing);
    if (state.immersing) setHudHidden(true);
    var btn = $("ds-btn-immerse");
    if (btn) btn.classList.toggle("active", state.immersing);
    // iOS often blocks Fullscreen API — CSS immerse still works
    if (state.immersing) {
      try {
        var el = panel || document.documentElement;
        var req =
          el.requestFullscreen ||
          el.webkitRequestFullscreen ||
          el.webkitRequestFullScreen;
        if (req && !isPhoneClient()) {
          req.call(el).catch(function () {});
        }
      } catch (e) {}
      // Lock orientation hint when available
      try {
        if (screen.orientation && screen.orientation.lock) {
          screen.orientation.lock("portrait").catch(function () {});
        }
      } catch (e3) {}
    } else {
      try {
        if (document.fullscreenElement || document.webkitFullscreenElement) {
          var exit = document.exitFullscreen || document.webkitExitFullscreen;
          if (exit) exit.call(document);
        }
      } catch (e2) {}
    }
  }

  function stopCamera() {
    state.camOn = false;
    state.camBusy = false;
    state.camOccupancy = 0;
    state.motionMag = 0;
    if (state.camSampleTimer) {
      clearTimeout(state.camSampleTimer);
      state.camSampleTimer = 0;
    }
    if (state.camStream) {
      try {
        state.camStream.getTracks().forEach(function (t) {
          t.stop();
        });
      } catch (e) {}
      state.camStream = null;
    }
    if (state.camVideo) {
      try {
        state.camVideo.srcObject = null;
      } catch (eV) {}
      if (state._camVideoDetached && state.camVideo.parentNode) {
        try {
          state.camVideo.parentNode.removeChild(state.camVideo);
        } catch (eR) {}
      }
    }
    state.camVideo = null;
    state._camVideoDetached = false;
    state.camCanvas = null;
    state.camCtx = null;
    state.camPrev = null;
    setCamButtonLabel("Camera", false);
    var pip = $("ds-cam-pip");
    if (pip) {
      pip.hidden = true;
      var pv = pip.querySelector("video");
      if (pv) {
        try {
          pv.srcObject = null;
        } catch (e2) {}
      }
    }
    document.body.classList.remove("ds-cam-on");
  }

  /**
   * Camera presence: motion + body occupancy + motion centroid.
   * Frames are sampled in tiny resolution, never stored or uploaded.
   */
  function sampleCameraFrame() {
    if (!state.camOn || !state.camVideo || !state.camCtx) return;
    var video = state.camVideo;
    var ctx = state.camCtx;
    var w = 96;
    var h = 72;
    try {
      if (video.readyState < 2) {
        state.camSampleTimer = setTimeout(sampleCameraFrame, 80);
        return;
      }
      ctx.drawImage(video, 0, 0, w, h);
      var img = ctx.getImageData(0, 0, w, h);
      var data = img.data;
      var n = w * h;
      var gray = new Float32Array(n);
      var bright = 0;
      for (var i = 0, p = 0; i < data.length; i += 4, p++) {
        // Rec.709 luma
        var g = data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722;
        gray[p] = g;
        bright += g;
      }
      bright /= n;
      // Occupancy: how much of the frame is "body-like" mid-tones (not empty wall)
      var mid = 0;
      for (var j = 0; j < n; j++) {
        if (gray[j] > 28 && gray[j] < 230) mid++;
      }
      var occupancy = clamp(mid / n, 0, 1);
      // Soften occupancy so empty rooms read empty
      if (bright < 12) occupancy *= 0.35;

      var motion = 0;
      var cx = 0;
      var cy = 0;
      var weight = 0;
      if (state.camPrev && state.camPrev.length === n) {
        for (var y = 0; y < h; y++) {
          for (var x = 0; x < w; x++) {
            var idx = y * w + x;
            var d = Math.abs(gray[idx] - state.camPrev[idx]);
            if (d > 14) {
              motion += d;
              // Mirror X so lean matches your body in a selfie cam
              var mx = w - 1 - x;
              cx += mx * d;
              cy += y * d;
              weight += d;
            }
          }
        }
        // Normalize motion (empirical scale for 96×72)
        var mag = clamp(motion / (n * 18), 0, 1);
        // Exponential smooth
        state.motionMag = state.motionMag * 0.55 + mag * 0.45;
        state.camOccupancy = state.camOccupancy * 0.7 + occupancy * 0.3;
        if (weight > 1) {
          var nx = cx / weight / w;
          var ny = cy / weight / h;
          state.camCentroid.x = state.camCentroid.x * 0.65 + nx * 0.35;
          state.camCentroid.y = state.camCentroid.y * 0.65 + ny * 0.35;
        }
        if (state.motionMag > 0.045 || state.camOccupancy > 0.15) {
          state.lastMove = Date.now();
        }
      }
      state.camPrev = gray;
    } catch (err) {
      // Security / draw race — try again
    }
    // 120ms is enough for presence; 50ms was freezing tab clicks
    state.camSampleTimer = setTimeout(sampleCameraFrame, 120);
  }

  /** Virtual / software cams that often grab the default slot but show black. */
  function isVirtualCameraLabel(label) {
    var s = String(label || "").toLowerCase();
    return (
      /obs|virtual|vcam|droidcam|snap\s*camera|manycam|xsplit|ndi|wirecast|mmhmm|ecamm|prism\s*live|streamlabs|nvidia\s*broadcast|nvidia\s*rtx|irl\s*pro|iriun|epoccam|youcam|cyberlink|spare\s*camera|unity\s*capture|capture\s*card|elgato\s*virtual/.test(
        s
      ) || s.indexOf("virtual camera") >= 0
    );
  }

  function scoreCameraDevice(dev) {
    var label = String(dev.label || "");
    var low = label.toLowerCase();
    var score = 50;
    var phone = isPhoneClient();
    if (isVirtualCameraLabel(label)) score -= 80;
    if (/integrated|built-?in|facetime|hd\s*webcam|usb\s*camera|logitech|microsoft\s*life|realtek|lenovo|hp\s*hd|dell|webcam/.test(low)) {
      score += 40;
    }
    // Phones: strongly prefer front / selfie camera for presence
    if (phone) {
      if (/front|user|facing|selfie|TrueDepth|FaceTime/i.test(low)) score += 50;
      if (/back|rear|environment|wide|ultra/i.test(low)) score -= 25;
    } else {
      if (/front|user|facing/.test(low)) score += 15;
      if (/back|rear|environment/.test(low)) score -= 5;
    }
    if (!label) score -= 10; // unlabeled until permission
    return score;
  }

  function fillCameraSelect(devices, activeId) {
    var sel = $("ds-cam-select");
    if (!sel) return;
    var cams = (devices || []).filter(function (d) {
      return d.kind === "videoinput";
    });
    state.deviceList = cams;
    sel.innerHTML = "";
    if (!cams.length) {
      var opt0 = document.createElement("option");
      opt0.value = "";
      opt0.textContent = "No cameras found";
      sel.appendChild(opt0);
      return;
    }
    // Sort: real cameras first
    cams = cams.slice().sort(function (a, b) {
      return scoreCameraDevice(b) - scoreCameraDevice(a);
    });
    cams.forEach(function (d) {
      var opt = document.createElement("option");
      opt.value = d.deviceId;
      var tag = isVirtualCameraLabel(d.label) ? " (virtual)" : "";
      opt.textContent = (d.label || "Camera") + tag;
      if (activeId && d.deviceId === activeId) opt.selected = true;
      sel.appendChild(opt);
    });
    // Prefer selected non-virtual
    if (!activeId) {
      for (var i = 0; i < cams.length; i++) {
        if (!isVirtualCameraLabel(cams[i].label)) {
          sel.value = cams[i].deviceId;
          break;
        }
      }
    }
    sel.hidden = false;
  }

  function pickBestDeviceId(devices) {
    var cams = (devices || []).filter(function (d) {
      return d.kind === "videoinput";
    });
    if (!cams.length) return "";
    if (state.preferredDeviceId) {
      for (var i = 0; i < cams.length; i++) {
        if (cams[i].deviceId === state.preferredDeviceId) return cams[i].deviceId;
      }
    }
    cams.sort(function (a, b) {
      return scoreCameraDevice(b) - scoreCameraDevice(a);
    });
    // Prefer first non-virtual
    for (var j = 0; j < cams.length; j++) {
      if (!isVirtualCameraLabel(cams[j].label)) return cams[j].deviceId;
    }
    return cams[0].deviceId;
  }

  function constraintsForDevice(deviceId) {
    var phone = isPhoneClient();
    // Phones: keep constraints minimal — width/height ideals often prevent the Allow sheet on iOS
    if (phone && !deviceId) {
      return { video: { facingMode: "user" }, audio: false };
    }
    if (deviceId) {
      return {
        video: {
          deviceId: phone ? { ideal: deviceId } : { exact: deviceId },
        },
        audio: false,
      };
    }
    return { video: true, audio: false };
  }

  /** Prefer current facingMode first so Flip cam actually opens back/front. */
  function phoneConstraintChain() {
    var face = state.facingMode === "environment" ? "environment" : "user";
    var other = face === "user" ? "environment" : "user";
    return [
      { video: { facingMode: { exact: face } }, audio: false },
      { video: { facingMode: face }, audio: false },
      { video: { facingMode: { ideal: face } }, audio: false },
      // last resorts
      { video: true, audio: false },
      { video: { facingMode: other }, audio: false },
    ];
  }

  function applyMirrorForFacing(video) {
    if (!video) return;
    // Mirror only front/selfie — back camera should match the real world
    var mirror = state.facingMode !== "environment";
    video.classList.toggle("ds-cam-mirror", mirror);
    video.classList.toggle("ds-cam-rear", !mirror);
    try {
      if (mirror) {
        video.style.setProperty("transform", "scaleX(-1)", "important");
        video.style.setProperty("-webkit-transform", "scaleX(-1)", "important");
      } else {
        video.style.setProperty("transform", "none", "important");
        video.style.setProperty("-webkit-transform", "none", "important");
      }
    } catch (e) {
      video.style.transform = mirror ? "scaleX(-1)" : "none";
    }
  }

  function updateFacingButton() {
    var btn = $("ds-btn-flip-cam");
    if (!btn) return;
    var back = state.facingMode === "environment";
    btn.textContent = back ? "Front cam" : "Back cam";
    btn.title = back ? "Switch to front camera" : "Switch to back camera";
    btn.classList.toggle("active", back);
    btn.hidden = false;
  }

  function getUserMediaChain(constraintsList, index) {
    index = index || 0;
    var gum = getUserMediaFn();
    if (!gum) {
      return Promise.reject(new Error("getUserMedia missing"));
    }
    if (index >= constraintsList.length) {
      return Promise.reject(new Error("All camera constraints failed"));
    }
    return gum(constraintsList[index]).catch(function (err) {
      var name = (err && err.name) || "";
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        return Promise.reject(err);
      }
      return getUserMediaChain(constraintsList, index + 1);
    });
  }

  function prepVideoEl(video) {
    if (!video) return;
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    video.setAttribute("x5-playsinline", "");
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.autoplay = true;
    applyMirrorForFacing(video);
    // Avoid iOS fullscreen hijack
    video.setAttribute("controls", "false");
    try {
      video.removeAttribute("controls");
    } catch (e) {}
  }

  function attachStream(stream, fromEnter) {
    state.camStream = stream;
    state.camOn = true;
    state.camBusy = false;
    state.autoSense = true;
    // Once granted, keep "always" so next Enter reuses permission without friction
    if (state.alwaysCamera !== false) setAlwaysCamera(true);
    showCamPrime(false);

    var track = stream.getVideoTracks()[0];
    var label = (track && track.label) || "camera";
    setCamButtonLabel("Camera on", true);

    // Prefer the on-page pip <video> for capture — iOS often won't decode frames
    // from a <video> that is never inserted into the document.
    var pip = $("ds-cam-pip");
    var video = null;
    if (pip) {
      pip.hidden = false;
      video = pip.querySelector("video");
      if (!video) {
        video = document.createElement("video");
        pip.insertBefore(video, pip.firstChild);
      }
      prepVideoEl(video);
      video.srcObject = stream;
      var cap = pip.querySelector("span");
      if (cap) {
        cap.textContent = isVirtualCameraLabel(label)
          ? "virtual cam"
          : state.facingMode === "environment"
            ? "back cam"
            : isPhoneClient()
              ? "front cam"
              : "sensing you";
      }
      applyMirrorForFacing(video);
    }
    if (!video) {
      video = document.createElement("video");
      prepVideoEl(video);
      video.srcObject = stream;
      // Keep offscreen but in DOM so mobile browsers keep decoding frames
      video.setAttribute("aria-hidden", "true");
      video.style.cssText =
        "position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:-9px;top:-9px;";
      document.body.appendChild(video);
      state._camVideoDetached = true;
    } else {
      state._camVideoDetached = false;
    }
    state.camVideo = video;

    var canvas = document.createElement("canvas");
    canvas.width = 96;
    canvas.height = 72;
    state.camCanvas = canvas;
    state.camCtx = canvas.getContext("2d", { willReadFrequently: true });
    state.camPrev = null;

    document.body.classList.add("ds-cam-on");
    try {
      var playP = video.play();
      if (playP && playP.catch) playP.catch(function () {});
    } catch (ePlay) {}

    // Remember this device (desktop); phones prefer facingMode next time
    try {
      var settings = track && track.getSettings ? track.getSettings() : {};
      if (settings.deviceId && !isPhoneClient()) {
        state.preferredDeviceId = settings.deviceId;
        localStorage.setItem("dream_cam_device_v1", settings.deviceId);
      }
    } catch (e0) {}

    function afterPlay() {
      sampleCameraFrame();
      var warn = isVirtualCameraLabel(label)
        ? " Using “" +
          label +
          "” (virtual). Pick your real webcam in the camera list if the picture is black."
        : "";
      setStatus(
        (fromEnter
          ? isPhoneClient()
            ? "Phone camera on — move in frame. Live prompt + Whisper work here too."
            : "Camera senses you — move, lean, leave the frame. Nothing is recorded or sent."
          : "Camera on — " + label + ".") + warn
      );
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
        return true;
      }
      return navigator.mediaDevices
        .enumerateDevices()
        .then(function (devs) {
          fillCameraSelect(devs, state.preferredDeviceId);
          return true;
        })
        .catch(function () {
          return true;
        });
    }

    // iOS may reject play() without user gesture later — stream is still usable for sampling
    var playPromise = video.play();
    if (playPromise && typeof playPromise.then === "function") {
      return playPromise.then(afterPlay).catch(afterPlay);
    }
    return Promise.resolve(afterPlay());
  }

  function startCamera(fromEnter) {
    if (state.camOn) return Promise.resolve(true);
    if (state.camBusy) return Promise.resolve(false);

    // Phone on plain HTTP: must use HTTPS (Tailscale Serve) or camera API is missing
    if (!browserAllowsCameraApi()) {
      if (maybeForceHttpsForCamera()) {
        return Promise.resolve(false);
      }
      var httpsDream = defaultHttpsDreamUrl();
      setStatus(
        "Camera blocked here. On phone open: " + httpsDream + " then tap Camera."
      );
      showCamPrime(true);
      return Promise.resolve(false);
    }

    var gum = getUserMediaFn();
    if (!gum) {
      setStatus("This browser has no camera API. Use Safari or Chrome.");
      return Promise.resolve(false);
    }

    state.camBusy = true;
    setCamButtonLabel("Allow…", false);
    setStatus("Allow Camera when the phone asks…");

    try {
      var saved = localStorage.getItem("dream_cam_device_v1");
      if (saved && !isPhoneClient()) state.preferredDeviceId = saved;
    } catch (e1) {}

    var phone = isPhoneClient();

    // Phones: getUserMedia in this same call stack (user tap). Never after setTimeout.
    // Prefer facingMode over saved deviceId (deviceId often fails when flipping lenses).
    if (phone) {
      return getUserMediaChain(phoneConstraintChain(), 0)
        .then(function (stream) {
          // Detect actual facing from track settings when available
          try {
            var tr = stream.getVideoTracks()[0];
            var st = tr && tr.getSettings ? tr.getSettings() : {};
            if (st.facingMode === "user" || st.facingMode === "environment") {
              state.facingMode = st.facingMode;
            }
          } catch (eFace) {}
          return attachStream(stream, fromEnter).then(function () {
            updateFacingButton();
            if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
              return navigator.mediaDevices
                .enumerateDevices()
                .then(function (devs) {
                  fillCameraSelect(devs, state.preferredDeviceId);
                  return true;
                })
                .catch(function () {
                  return true;
                });
            }
            return true;
          });
        })
        .catch(function (err) {
          state.camOn = false;
          state.camBusy = false;
          setCamButtonLabel("Camera", false);
          showCamPrime(true);
          updateFacingButton();
          var name = (err && err.name) || "";
          var msg = (err && err.message) || "";
          if (name === "NotAllowedError" || name === "PermissionDeniedError") {
            setStatus(deniedCameraHelp());
          } else if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError") {
            setStatus(
              "No " +
                (state.facingMode === "environment" ? "back" : "front") +
                " camera available on this device."
            );
          } else if (name === "NotReadableError" || name === "TrackStartError") {
            setStatus("Camera busy — close other apps using it, then try again.");
          } else if (name === "SecurityError" || /secure|https/i.test(msg)) {
            setStatus("Camera needs HTTPS. Open " + defaultHttpsDreamUrl());
            maybeForceHttpsForCamera();
          } else {
            setStatus(
              "Camera failed" +
                (name ? " (" + name + ")" : "") +
                (msg ? ": " + msg : "") +
                ". Use Safari/Chrome on the HTTPS Tailscale link, tap Camera, Allow."
            );
          }
          return false;
        });
    }

    // Desktop: probe → enumerate → prefer real cam over OBS
    return navigator.mediaDevices
      .getUserMedia({ video: true, audio: false })
      .then(function (probe) {
        try {
          probe.getTracks().forEach(function (t) {
            t.stop();
          });
        } catch (e2) {}
        return navigator.mediaDevices.enumerateDevices();
      })
      .catch(function () {
        return navigator.mediaDevices.enumerateDevices().catch(function () {
          return [];
        });
      })
      .then(function (devices) {
        fillCameraSelect(devices, state.preferredDeviceId);
        var id = pickBestDeviceId(devices);
        if (id) state.preferredDeviceId = id;
        var cams = (devices || []).filter(function (d) {
          return d.kind === "videoinput";
        });
        var realCount = cams.filter(function (d) {
          return !isVirtualCameraLabel(d.label);
        }).length;
        if (cams.length && realCount === 0) {
          setStatus(
            "Only virtual cameras found (e.g. OBS). Pick a real webcam in the list."
          );
        }
        return navigator.mediaDevices.getUserMedia(constraintsForDevice(id));
      })
      .then(function (stream) {
        var track = stream.getVideoTracks()[0];
        var label = (track && track.label) || "";
        if (isVirtualCameraLabel(label) && state.deviceList.length > 1) {
          var alt = null;
          for (var i = 0; i < state.deviceList.length; i++) {
            var d = state.deviceList[i];
            if (
              !isVirtualCameraLabel(d.label) &&
              d.deviceId !== (track.getSettings && track.getSettings().deviceId)
            ) {
              alt = d.deviceId;
              break;
            }
          }
          if (alt) {
            try {
              stream.getTracks().forEach(function (t) {
                t.stop();
              });
            } catch (e3) {}
            state.preferredDeviceId = alt;
            return navigator.mediaDevices
              .getUserMedia(constraintsForDevice(alt))
              .then(function (s2) {
                return attachStream(s2, fromEnter);
              });
          }
        }
        return attachStream(stream, fromEnter);
      })
      .catch(function (err) {
        state.camOn = false;
        state.camBusy = false;
        setCamButtonLabel("Camera", false);
        var name = (err && err.name) || "";
        if (name === "NotAllowedError" || name === "PermissionDeniedError") {
          setStatus(deniedCameraHelp());
          showCamPrime(true);
        } else if (name === "NotFoundError" || name === "DevicesNotFoundError") {
          setStatus("No camera found — plug in a webcam or free it from OBS.");
        } else if (name === "NotReadableError" || name === "TrackStartError") {
          setStatus(
            "Camera busy — close OBS/Zoom/Teams using it, or pick another camera in the list."
          );
        } else {
          setStatus(
            "Camera error" +
              (err && err.message ? ": " + err.message : "") +
              " — try another device in the list."
          );
        }
        return false;
      });
  }

  function switchCameraDevice(deviceId) {
    if (!deviceId) return;
    state.preferredDeviceId = deviceId;
    // Infer facing from label when possible
    try {
      var dev = (state.deviceList || []).filter(function (d) {
        return d.deviceId === deviceId;
      })[0];
      var low = String((dev && dev.label) || "").toLowerCase();
      if (/back|rear|environment|wide|ultra/.test(low)) state.facingMode = "environment";
      else if (/front|user|selfie|facetime|true.?depth/.test(low)) state.facingMode = "user";
    } catch (e0) {}
    try {
      localStorage.setItem("dream_cam_device_v1", deviceId);
      localStorage.setItem("dream_cam_facing_v1", state.facingMode);
    } catch (e) {}
    var wasOn = state.camOn;
    // Hard-stop tracks so iOS will open the other lens
    if (state.camStream) {
      try {
        state.camStream.getTracks().forEach(function (t) {
          t.stop();
        });
      } catch (e2) {}
      state.camStream = null;
    }
    state.camOn = false;
    state.camBusy = false;
    if (wasOn || state.inhabiting) {
      startCamera(false);
    }
    updateFacingButton();
  }

  /** Flip front ↔ back using facingMode (reliable on iOS/Android). */
  function flipFacingCamera() {
    if (!browserAllowsCameraApi() && !isLocalHostPage()) {
      if (maybeForceHttpsForCamera()) return;
      setStatus("Open " + defaultHttpsDreamUrl() + " then use Back cam.");
      return;
    }
    state.facingMode =
      state.facingMode === "environment" ? "user" : "environment";
    state.preferredDeviceId = ""; // force facingMode path, not stale deviceId
    try {
      localStorage.setItem("dream_cam_facing_v1", state.facingMode);
      localStorage.removeItem("dream_cam_device_v1");
    } catch (e) {}
    updateFacingButton();

    // Must fully release the current track before requesting the other camera
    if (state.camStream) {
      try {
        state.camStream.getTracks().forEach(function (t) {
          t.stop();
        });
      } catch (e2) {}
      state.camStream = null;
    }
    state.camOn = false;
    state.camBusy = false;
    setCamButtonLabel("Camera", false);

    var want = state.facingMode === "environment" ? "back" : "front";
    setStatus("Opening " + want + " camera…");
    startCamera(false).then(function (ok) {
      if (ok) {
        setStatus(
          (want === "back" ? "Back" : "Front") +
            " camera on" +
            (want === "front" ? " (mirrored)" : "") +
            "."
        );
        updateFacingButton();
      } else {
        // Revert facing if open failed
        setStatus(
          "Could not open " +
            want +
            " camera. Try again, or pick a camera in the list."
        );
      }
    });
  }

  function toggleSense() {
    if (state.camOn) {
      stopLivePromptLoop();
      stopCamera();
      setStatus("Camera off.");
      updateFacingButton();
      return;
    }
    // Must call getUserMedia in this tap — no async work before startCamera
    if (!browserAllowsCameraApi() && !isLocalHostPage()) {
      if (maybeForceHttpsForCamera()) return;
      setStatus("Open " + defaultHttpsDreamUrl() + " then tap Camera.");
      return;
    }
    try {
      var face = localStorage.getItem("dream_cam_facing_v1");
      if (face === "user" || face === "environment") state.facingMode = face;
    } catch (eF) {}
    updateFacingButton();
    startCamera(false).then(function (ok) {
      if (ok) {
        setStatus(
          "Camera on (" +
            (state.facingMode === "environment" ? "back" : "front") +
            "). Use Back cam / Front cam to switch."
        );
        updateFacingButton();
      }
    });
  }

  function primeCameraFromGate() {
    // Dedicated big button on the gate — best chance of iOS permission sheet
    if (maybeForceHttpsForCamera()) return;
    setAlwaysCamera(true);
    startCamera(false).then(function (ok) {
      if (ok) {
        setStatus("Camera allowed. Tap Enter the field when ready.");
        showCamPrime(false);
      }
    });
  }

  function setLiveTick(text, busy) {
    var el = $("ds-live-prompt-tick");
    if (!el) return;
    el.textContent = text || "";
    el.classList.toggle("busy", !!busy);
  }

  function liveCaptureVideoEl() {
    // Always prefer the visible pip video (in-DOM) — required for reliable phone frames
    var pip = $("ds-cam-pip");
    var pv = pip && pip.querySelector("video");
    if (pv && pv.srcObject && (pv.videoWidth > 1 || pv.readyState >= 2)) {
      return pv;
    }
    if (state.camVideo && state.camVideo.srcObject) return state.camVideo;
    return pv || state.camVideo || null;
  }

  function captureCameraDataUrl() {
    if (!state.camOn) return null;
    var video = liveCaptureVideoEl();
    if (!video) return null;
    var vw = video.videoWidth || 0;
    var vh = video.videoHeight || 0;
    // readyState: 2 = HAVE_CURRENT_DATA — iOS sometimes stays at 1 briefly
    if (video.readyState < 1 && vw < 2) return null;
    if (vw < 2 || vh < 2) {
      // Last resort defaults (some WebViews report 0 until a paint)
      vw = vw || 640;
      vh = vh || 480;
      if (video.readyState < 2) return null;
    }
    // Smaller on phone = faster Tailscale upload + fewer xAI rejections
    var maxW = isPhoneClient() ? 384 : 512;
    var scale = Math.min(1, maxW / vw);
    var w = Math.max(32, Math.round(vw * scale));
    var h = Math.max(32, Math.round(vh * scale));
    var canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    var ctx = canvas.getContext("2d");
    if (!ctx) return null;
    try {
      // Mirror capture only for front cam (match mirror pip)
      if (state.facingMode !== "environment") {
        ctx.translate(w, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(video, 0, 0, w, h);
    } catch (drawErr) {
      return null;
    }
    try {
      var quality = isPhoneClient() ? 0.72 : 0.78;
      var dataUrl = canvas.toDataURL("image/jpeg", quality);
      // Reject empty / near-empty payloads
      if (!dataUrl || dataUrl.length < 800) return null;
      return dataUrl;
    } catch (e) {
      // SecurityError if canvas tainted — should not happen with getUserMedia
      return null;
    }
  }

  /** Wait until the phone has a real frame (iOS often needs a beat after play). */
  function waitForCameraFrame(maxTries, gapMs) {
    maxTries = maxTries == null ? 20 : maxTries;
    gapMs = gapMs == null ? 180 : gapMs;
    return new Promise(function (resolve) {
      function tick(left) {
        var frame = captureCameraDataUrl();
        if (frame) {
          resolve(frame);
          return;
        }
        if (left <= 0) {
          resolve(null);
          return;
        }
        // Nudge play on the live element
        try {
          var v = liveCaptureVideoEl();
          if (v && v.paused) v.play().catch(function () {});
        } catch (eN) {}
        setTimeout(function () {
          tick(left - 1);
        }, gapMs);
      }
      tick(maxTries);
    });
  }

  function writeLivePrompt(text, meta) {
    state.livePromptText = String(text || "").trim();
    var ta = $("ds-live-prompt");
    if (ta) ta.value = state.livePromptText;
    var label = $("ds-live-prompt-label");
    if (label && meta && meta.title) {
      label.textContent = "Live prompt · " + meta.title;
    }
  }

  function stopLivePromptLoop() {
    state.livePromptOn = false;
    if (state.livePromptTimer) {
      clearTimeout(state.livePromptTimer);
      state.livePromptTimer = 0;
    }
    var btn = $("ds-btn-live-prompt");
    if (btn) btn.classList.remove("active");
    var panel = $("ds-live-prompt-panel");
    // keep panel visible if it has text
    setLiveTick("idle", false);
  }

  function scheduleLivePrompt(delayMs) {
    if (state.livePromptTimer) clearTimeout(state.livePromptTimer);
    if (!state.livePromptOn) return;
    state.livePromptTimer = setTimeout(function () {
      runLivePromptOnce(true);
    }, delayMs != null ? delayMs : state.livePromptIntervalMs);
  }

  function runLivePromptOnce(fromLoop) {
    if (state.livePromptBusy) {
      if (fromLoop) scheduleLivePrompt(2000);
      return Promise.resolve();
    }
    if (!state.camOn) {
      setLiveTick("need camera", false);
      if (!fromLoop) setStatus("Turn on Camera first, then Live or Read now.");
      if (fromLoop && state.livePromptOn) scheduleLivePrompt(3000);
      return Promise.resolve();
    }

    state.livePromptBusy = true;
    setLiveTick("grabbing frame…", true);

    return waitForCameraFrame(isPhoneClient() ? 25 : 12, 160)
      .then(function (frame) {
        if (!frame) {
          setLiveTick("no frame", false);
          setStatus(
            "Could not read a camera frame. Keep the pip preview visible, leave the app open, " +
              "then tap Read now again."
          );
          return null;
        }

        setLiveTick("reading…", true);
        var mood = timeOfDayMood();
        var emphasis =
          "Live Dream Stasis frame. Time mood: " +
          mood.name +
          ". Presence " +
          Math.round(state.presence * 100) +
          "%. Describe the actual room and person; imaginative painterly language.";

        return fetch(apiUrl("/api/analyze-image"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            image: frame,
            mode: "live",
            emphasis: emphasis,
          }),
          cache: "no-store",
        }).then(function (r) {
          return r.text().then(function (text) {
            var d = null;
            try {
              d = text ? JSON.parse(text) : null;
            } catch (parseErr) {
              var snip = String(text || "").replace(/\s+/g, " ").slice(0, 120);
              throw new Error(
                "Server did not return JSON (HTTP " +
                  r.status +
                  "). " +
                  (snip || "Empty body.") +
                  " Keep start_server.bat running."
              );
            }
            return { ok: r.ok, d: d || {}, status: r.status };
          });
        });
      })
      .then(function (res) {
        if (!res) return;
        var d = res.d || {};
        if (!res.ok) {
          var errMsg =
            (d && (d.error || d.message || d.detail)) ||
            "Live prompt failed (HTTP " + res.status + ")";
          throw new Error(String(errMsg));
        }
        var a = d.analysis || {};
        var prompt = String(a.prompt || "").trim();
        var desc = String(a.description || "").trim();
        var title = String(a.title || "").trim();
        var composed =
          prompt ||
          [title, desc].filter(Boolean).join(". ") ||
          "Empty frame — no generation prompt.";
        // Optional painterly envelope
        if (prompt && !/^painterly|oil|brush|stasis/i.test(prompt)) {
          composed =
            prompt +
            " Painterly stasis vision, soft dream light, museum atmosphere, full bleed, no text overlays.";
        }
        // Store raw camera reading; if subject locked, re-wrap around new reading
        state.livePromptText = composed;
        if (state.cameraSubject) {
          // Refresh subject from latest camera if live loop is feeding
          state.cameraSubject = composed;
          refreshComposedDreamPrompt();
          setLiveTick(
            "subject updated " + new Date().toLocaleTimeString(),
            false
          );
          applySkinFromCurrent();
          if (title) showWhisper(title + " — held as dream subject");
        } else {
          writeLivePrompt(composed, { title: title || "live" });
          setLiveTick(
            "updated " +
              new Date().toLocaleTimeString() +
              (a.presence ? " · " + a.presence : ""),
            false
          );
          if (title && Math.random() > 0.55) {
            showWhisper(title + (desc ? " — " + desc.slice(0, 100) : ""));
          }
        }
        if (!fromLoop) {
          setStatus(
            state.cameraSubject
              ? "Camera subject refreshed — dream still wraps around you."
              : "Live prompt refreshed from camera."
          );
        }
        persistLight();
      })
      .catch(function (err) {
        var msg = (err && err.message) || String(err);
        setLiveTick("error", false);
        if (/Failed to fetch|NetworkError|Load failed|network/i.test(msg)) {
          setStatus(
            "Could not reach the PC gallery. Tailscale Connected? start_server.bat running?"
          );
        } else if (/api.?key|auth|401|403|unauth|credit|quota|billing/i.test(msg)) {
          setStatus("Vision API: " + msg.slice(0, 140));
        } else if (/HTML|restart|server|JSON/i.test(msg)) {
          setStatus(
            "Live read needs the gallery server + xAI key (start_server.bat). " + msg.slice(0, 100)
          );
        } else {
          setStatus("Camera read failed: " + msg.slice(0, 160));
        }
      })
      .then(function () {
        state.livePromptBusy = false;
        if (state.livePromptOn) scheduleLivePrompt(state.livePromptIntervalMs);
      });
  }

  function toggleLivePrompt() {
    var panel = $("ds-live-prompt-panel");
    if (state.livePromptOn) {
      stopLivePromptLoop();
      setStatus("Live prompt paused.");
      return;
    }
    state.livePromptOn = true;
    var btn = $("ds-btn-live-prompt");
    if (btn) btn.classList.add("active");
    if (panel) panel.hidden = false;
    if (!state.camOn) {
      startCamera(false).then(function (ok) {
        if (ok) {
          setStatus("Live prompt on — reading the room every ~12s.");
          scheduleLivePrompt(600);
        } else {
          stopLivePromptLoop();
        }
      });
    } else {
      setStatus("Live prompt on — reading the room every ~12s.");
      scheduleLivePrompt(400);
    }
  }

  function bind() {
    var stage = $("ds-stage");
    if (stage && !stage.dataset.bound) {
      stage.dataset.bound = "1";
      stage.addEventListener("pointermove", onPointer, { passive: true });
      stage.addEventListener("touchmove", onPointer, { passive: true });
      stage.addEventListener("click", function () {
        state.lastMove = Date.now();
        if (state.inhabiting && poolLength()) {
          showLayer(state.index + 1);
        }
      });
    }

    var map = {
      "ds-btn-enter": enterDream,
      "ds-btn-surface": surface,
      "ds-btn-next": function () {
        if (poolLength()) showLayer(state.index + 1);
      },
      "ds-btn-prev": function () {
        if (poolLength()) showLayer(state.index - 1);
      },
      "ds-btn-pool-gen": function () {
        state.pool = "generated";
        state.index = 0;
        buildPoolSources("generated");
        showLayer(0);
        loadDreamPool(false).then(function (n) {
          updateCounter();
          setStatus("Generated first → last · " + n);
        });
      },
      "ds-btn-pool-paint": function () {
        openInventory("paintings");
      },
      "ds-btn-inv": function () {
        openInventory(state.pool === "paintings" ? "paintings" : "generated");
      },
      "ds-inv-close": closeInventory,
      "ds-inv-prev": function () {
        state.invPage--;
        renderInventory();
      },
      "ds-inv-next": function () {
        state.invPage++;
        renderInventory();
      },
      "ds-inv-tab-paintings": function () {
        state.invKind = "paintings";
        state.invPage = 0;
        openInventory("paintings");
      },
      "ds-inv-tab-generated": function () {
        state.invKind = "generated";
        state.invPage = 0;
        openInventory("generated");
      },
      "ds-btn-immerse": toggleImmerse,
      "ds-btn-hide-hud": function () {
        setHudHidden(true);
      },
      "ds-btn-show-hud": function () {
        setHudHidden(false);
      },
      "ds-btn-talk": toggleTalk,
      "ds-btn-talk-float": toggleTalk,
      "ds-btn-sense": toggleSense,
      "ds-btn-flip-cam": flipFacingCamera,
      "ds-btn-fuse": fuseNow,
      "ds-btn-fuse-2": fuseNow,
      "ds-btn-live-now": function () {
        var panel = $("ds-live-prompt-panel");
        if (panel) panel.hidden = false;
        function after() {
          writeFusionToField();
          setStatus("Camera + vision in fusion prompt. Tap Fuse.");
        }
        if (!state.camOn) {
          startCamera(false).then(function (ok) {
            if (ok) return runLivePromptOnce(false).then(after);
            setStatus("Allow camera, then Read cam again.");
          });
        } else {
          runLivePromptOnce(false).then(after);
        }
      },
      "ds-btn-live-copy": function () {
        var t =
          ($("ds-live-prompt") && $("ds-live-prompt").value) ||
          state.composedDreamPrompt ||
          state.livePromptText ||
          "";
        if (!t.trim()) {
          setStatus("Nothing to copy yet.");
          return;
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(t).then(
            function () {
              setStatus("Prompt copied.");
            },
            function () {
              setStatus("Copy failed.");
            }
          );
        }
      },
      "ds-btn-jump": function () {
        var inp = $("ds-jump-num");
        jumpByNumber(inp && inp.value);
      },
      "ds-btn-refresh": function () {
        loadDreamPool(true).then(function (n) {
          showLayer(state.index || 0);
          setStatus("Pool refreshed · " + n + " visions");
        });
      },
    };

    Object.keys(map).forEach(function (id) {
      var el = $(id);
      if (!el) return;
      // Always rebind enter — inline onclick + this handler
      el.onclick = function (e) {
        try {
          map[id](e);
        } catch (err) {
          console.error(id, err);
          setStatus("Error: " + ((err && err.message) || err));
        }
        return false;
      };
    });

    var camSel = $("ds-cam-select");
    if (camSel && !camSel.dataset.bound) {
      camSel.dataset.bound = "1";
      camSel.addEventListener("change", function () {
        if (camSel.value) switchCameraDevice(camSel.value);
      });
    }

    ["ds-jump-num", "ds-jump-num-gate"].forEach(function (jid) {
      var jumpInp = $(jid);
      if (!jumpInp || jumpInp.dataset.bound) return;
      jumpInp.dataset.bound = "1";
      jumpInp.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          e.preventDefault();
          syncJumpFields(jumpInp.value);
          jumpByNumber(jumpInp.value);
          writeFusionToField();
        }
      });
      jumpInp.addEventListener("change", function () {
        syncJumpFields(jumpInp.value);
      });
    });

    window.addEventListener("keydown", function (e) {
      if (!state.inhabiting) return;
      var tag = (e.target && e.target.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "Escape") {
        if (state.talking) stopTalking();
        else if (state.hudHidden) setHudHidden(false);
        else if (state.immersing) toggleImmerse();
        else surface();
      } else if (e.key === "h" || e.key === "H") {
        toggleHud();
      } else if (e.key === "t" || e.key === "T") {
        toggleTalk();
      } else if (e.key === "ArrowRight") {
        showLayer(state.index + 1);
      } else if (e.key === "ArrowLeft") {
        showLayer(state.index - 1);
      }
    });
  }

  function start() {
    if (!$("panel-dream")) return;
    document.body.classList.toggle("ds-phone", isPhoneClient());

    try {
      loadAlwaysCameraPref();
    } catch (e0) {}
    try {
      bind();
    } catch (e1) {
      console.error("[dream] bind failed", e1);
    }

    if (!state.started) {
      state.started = true;
      try {
        var raw = localStorage.getItem(STATE_KEY);
        if (raw) {
          var d = JSON.parse(raw);
          if (d.pool) state.pool = d.pool;
          if (d.index != null) state.index = d.index;
          if (d.whisper) state.whisperText = d.whisper;
          if (d.cameraSubject) state.cameraSubject = d.cameraSubject;
          if (d.composedDreamPrompt) state.composedDreamPrompt = d.composedDreamPrompt;
          if (typeof d.cycleOn === "boolean") state.cycleOn = d.cycleOn;
        }
      } catch (e) {}
    }

    var panel = $("ds-live-prompt-panel");
    if (panel) panel.hidden = false;

    // Always enter the field — hide splash and show first image
    hideGate();
    try {
      var face = localStorage.getItem("dream_cam_facing_v1");
      if (face === "user" || face === "environment") state.facingMode = face;
    } catch (eFace) {}
    updateFacingButton();
    try {
      enterDream();
    } catch (eEnter) {
      console.error("[dream] enter failed", eEnter);
      hideGate();
      document.body.classList.add("ds-inhabiting");
      state.inhabiting = true;
      state.generatedNums = state.generatedNums.length ? state.generatedNums : [1];
      buildPoolSources("generated");
      showLayer(0);
      setStatus("In the field (fallback).");
    }
  }

  function onHide() {
    // Stop everything first so the rest of the app can receive clicks
    state.inhabiting = false;
    state.camBusy = false;
    if (state.raf) {
      try {
        cancelAnimationFrame(state.raf);
      } catch (e0) {}
      try {
        clearTimeout(state.raf);
      } catch (e1) {}
      state.raf = 0;
    }
    if (state.camSampleTimer) {
      clearTimeout(state.camSampleTimer);
      state.camSampleTimer = 0;
    }
    closeInventory();
    stopTalking();
    try {
      if (window.speechSynthesis) window.speechSynthesis.cancel();
    } catch (e) {}
    stopLivePromptLoop();
    stopCamera();
    stopCycle();
    setHudHidden(false);
    document.body.classList.remove(
      "ds-inhabiting",
      "ds-immersive-body",
      "ds-hud-hidden",
      "ds-talking",
      "ds-cam-on",
      "ds-phone"
    );
    document.documentElement.classList.remove("ds-inhabiting");
  }

  // Public API
  window.DreamStasis = {
    enter: enterDream,
    surface: surface,
    fuse: fuseNow,
    jump: jumpByNumber,
    inventory: openInventory,
    hideHud: function () {
      setHudHidden(true);
    },
    showHud: function () {
      setHudHidden(false);
    },
    talk: toggleTalk,
    isIn: function () {
      return !!state.inhabiting;
    },
  };

  window.addEventListener("dream-show", start);
  window.addEventListener("dream-hide", onHide);
  window.addEventListener("tab-changed", function (e) {
    if (e.detail && e.detail.tab === "dream") start();
    else if (state.inhabiting) surface();
  });

  function bootIfDream() {
    var hash = (location.hash || "").replace("#", "");
    if (hash === "dream" || document.body.getAttribute("data-active-tab") === "dream") {
      start();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootIfDream);
  } else {
    bootIfDream();
  }
})();
