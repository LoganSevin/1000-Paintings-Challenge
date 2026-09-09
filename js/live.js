/**
 * Live — TikTok-style long-running show: tiny host walks inside the camera rectangle.
 * Chat prompts actions, gifts get thanks, rude lines get reported.
 */
(function () {
  "use strict";

  var STORAGE = "gallery.live.v1";
  var STUDIO_CHAT = "gallery.studio-chat.v1";
  var MAX_CHAT = 8;
  var MAX_GIFTS = 6;
  var MAX_MOD = 40;
  var ASPECTS = {
    "9:16": [9, 16],
    "4:5": [4, 5],
    "3:4": [3, 4],
    "1:1": [1, 1],
    "4:3": [4, 3],
    "16:9": [16, 9],
  };

  var RUDE_RE =
    /\b(kys|kill yourself|stupid|idiot|ugly|shut up|hate you|dumbass|fuck you)\b/i;
  var GIFTS = [
    { id: "rose", name: "Rose", coins: 1 },
    { id: "finger", name: "Finger Heart", coins: 5 },
    { id: "tiktok", name: "TikTok", coins: 99 },
    { id: "galaxy", name: "Galaxy", coins: 1000 },
  ];

  var state = {
    ready: false,
    running: false,
    live: false,
    raf: 0,
    t: 0,
    last: 0,
    startedAt: 0,
    elapsed: 0,
    aspect: "9:16",
    camW: 360,
    camH: 640,
    dpr: 1,
    person: {
      x: 0.5,
      y: 0.72,
      vx: 0.08,
      facing: 1,
      action: "walk",
      actionT: 0,
      hop: 0,
      spin: 0,
      headLag: 0,
      sway: 0,
    },
    say: "",
    sayUntil: 0,
    comments: [],
    gifts: [],
    reports: [],
    studioCursor: -1,
    asking: false,
    lastAskAt: 0,
    chatDirty: true,
    giftDirty: true,
    modDirty: true,
    setImg: null,
    setNum: 0,
    setToken: 0,
    muted: false,
    talking: false,
    talkingUntil: 0,
    talkQueue: [],
    currentUtterance: null,
    gapUntil: 0,
    voice: null,
    nextBanterAt: 3,
    attach: null,
    limp: 0.45,
    cursor: { x: 0.5, y: 0.5, inside: false },
    mood: "ignore",
    moodT: 2.5,
    ignoreStyle: "wander",
    pool: { generated: [], spells: [], ready: false },
    floorImg: null,
    props: [],
    palette: [],
    targetProp: null,
    inspected: null,
    forgeSlots: [null, null, null],
    forgeSlot: 0,
    livePrompt: "",
    liveAnalyses: {},
    lod1: null,
    bookPage: 0,
    bookOrder: [],
    tt: {
      uniqueId: "",
      wanted: false,
      connected: false,
      connecting: false,
      after: 0,
      viewers: 0,
      likes: 0,
      error: "",
      poll: 0,
    },
  };

  var HOST_BITS = {
    wave: [
      "That's for the front row.",
      "I see you. This wave's got your name on it.",
      "Hands up from the camera. Stay.",
    ],
    jump: [
      "Up we go — don't blink.",
      "Gravity works for me tonight.",
      "Catch that. Live hop.",
    ],
    dance: [
      "Alright, we moving.",
      "This is the part the algorithm likes.",
      "Dance break. Don't leave.",
    ],
    bow: [
      "For the culture. And for you.",
      "I don't bow for free — except right now.",
      "Respect. That's yours.",
    ],
    sit: [
      "Taking a seat like I own the rectangle.",
      "Talk-show mode. I'm listening.",
      "Sat. Now say something worth sitting for.",
    ],
    spin: [
      "Three-sixty. Still pretty.",
      "That's the money angle.",
      "Spin it. Come back around.",
    ],
    run: [
      "We're not walking this one.",
      "Keep up.",
      "Sprint to the edge and back. Stay with me.",
    ],
    idle: [
      "Holding. Camera loves a still frame.",
      "Frozen on purpose. Look at the suit.",
    ],
    left: [
      "Taking stage left.",
      "Sliding over. Don't lose me.",
      "Left side of the frame is expensive.",
    ],
    right: [
      "Stage right. That's the pretty light.",
      "Crossing. Stay on me.",
      "Right where the camera wants me.",
    ],
    center: [
      "Back to center. This is my mark.",
      "Home base. Lights on me.",
      "Middle of the rectangle. That's the throne.",
    ],
    flip: [
      "Don't try this in a real studio.",
      "Flip. Land. Still the host.",
      "That's illegal in most rooms. Not this one.",
    ],
    inspect: [
      "Coming in on the piece.",
      "That's Spellforge DNA on a stick. I live here.",
      "Let me look at that one.",
    ],
  };

  var BANTER = [
    "Chat's in the building. Keep it moving.",
    "This backdrop is a painting off the wall. I've got a thousand of them.",
    "If you're new — I'm the host, this is the camera, you're already late.",
    "Gifts talk. Comments talk. Silence is a choice.",
    "Long stream energy. I can do this all night.",
    "Somebody say something worth a spin.",
    "Gold tie, gold light, gold attention. Don't waste it.",
    "Pull the left string. No — my left.",
    "I'm a puppet in a better suit than you.",
    "Don't slack the wires. I look cheap when you slack the wires.",
    "Yes I'm on strings. That's called production value.",
    "The bar up there is doing more work than half the room.",
    "Talk in Chat if you want me to move. That's the line in.",
    "I can talk and walk. That's the gig.",
    "Camera's tight. I'm tighter.",
    "Name on the comment. I'll say it back.",
    "If you're watching without talking, that's a choice and I noticed.",
    "Stay. The next bit's better if you stay.",
  ];

  function $(id) {
    return document.getElementById(id);
  }

  function apiUrl(path) {
    if (typeof window.galleryApiUrl === "function") return window.galleryApiUrl(path);
    var base = String(window.SPELLFORGE_API_BASE || "").replace(/\/$/, "");
    return base ? base + path : path;
  }

  function setStatus(msg) {
    var el = $("lv-status");
    if (el) el.textContent = msg || "";
  }

  function load() {
    try {
      var raw = JSON.parse(localStorage.getItem(STORAGE) || "null");
      if (raw && ASPECTS[raw.aspect]) state.aspect = raw.aspect;
      if (raw && Array.isArray(raw.reports)) state.reports = raw.reports.slice(-MAX_MOD);
      if (raw && raw.tiktokId) state.tt.uniqueId = String(raw.tiktokId).replace(/^@/, "");
      if (raw && typeof raw.prompt === "string") state.livePrompt = raw.prompt;
    } catch (e) {}
  }

  function save() {
    try {
      localStorage.setItem(
        STORAGE,
        JSON.stringify({
          aspect: state.aspect,
          reports: state.reports.slice(-MAX_MOD),
          tiktokId: state.tt.uniqueId || "",
          prompt: state.livePrompt || "",
        })
      );
    } catch (e) {}
  }

  function pad(n) {
    return (n < 10 ? "0" : "") + n;
  }

  function fmtClock(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var sec = s % 60;
    return pad(h) + ":" + pad(m) + ":" + pad(sec);
  }

  function pick(arr) {
    return arr[(Math.random() * arr.length) | 0];
  }

  function layout() {
    var fit = $("lv-fit");
    var cam = $("lv-camera");
    var canvas = $("lv-canvas");
    if (!fit || !cam || !canvas) return;
    var pair = ASPECTS[state.aspect] || ASPECTS["9:16"];
    var ar = pair[0] / pair[1];
    var boxW = Math.max(160, fit.clientWidth - 16);
    var boxH = Math.max(200, fit.clientHeight - 16);
    var w;
    var h;
    if (boxW / boxH > ar) {
      h = boxH;
      w = h * ar;
    } else {
      w = boxW;
      h = w / ar;
    }
    cam.style.width = Math.round(w) + "px";
    cam.style.height = Math.round(h) + "px";
    cam.style.aspectRatio = pair[0] + " / " + pair[1];
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(2, Math.round(w * dpr));
    canvas.height = Math.max(2, Math.round(h * dpr));
    state.camW = canvas.width;
    state.camH = canvas.height;
    state.dpr = dpr;
  }

  function wallFrac() {
    return { x: 0.16, y: 0.05, w: 0.68, h: 0.53 };
  }

  var GEN_BASE = 100000;

  function liveSpellLabel(n) {
    n = parseInt(n, 10);
    if (!n) return "empty";
    if (n >= 1 && n <= 1000) return "#" + n;
    if (n >= GEN_BASE && n < 200000) return "G#" + (n - GEN_BASE);
    if (n >= 200000 && n < 300000) return "S#" + (n - 200000);
    if (n >= 300000 && n < 400000) return "SI#" + (n - 300000);
    return "#" + n;
  }

  function resolveStill(url) {
    var u = String(url || "").trim();
    if (!u) return "";
    if (u.indexOf("data:") === 0 || u.indexOf("blob:") === 0) return u;
    if (/^https?:/i.test(u)) {
      try {
        var parsed = new URL(u, window.location.href);
        var host = (parsed.hostname || "").toLowerCase();
        if (
          parsed.origin === window.location.origin ||
          host === "localhost" ||
          host === "127.0.0.1" ||
          host === "0.0.0.0"
        ) {
          return (parsed.pathname.replace(/^\//, "") + parsed.search) || u;
        }
        return parsed.href;
      } catch (e) {
        return u;
      }
    }
    return u.replace(/^\//, "");
  }

  function stillFallbacks(url) {
    var u = resolveStill(url);
    if (!u) return [];
    var out = [u];
    if (/\.jpe?g(\?|#|$)/i.test(u)) {
      out.push(u.replace(/\.jpe?g(\?|#|$)/i, ".png$1"));
    } else if (/\.png(\?|#|$)/i.test(u)) {
      out.push(u.replace(/\.png(\?|#|$)/i, ".jpg$1"));
    }
    return out;
  }

  function thumbSrc(path, w) {
    var u = resolveStill(path);
    if (!u || u.indexOf("data:") === 0 || u.indexOf("blob:") === 0) return u;
    return apiUrl(
      "/api/transfer/thumb?src=" + encodeURIComponent(u) + "&w=" + (w || 200)
    );
  }

  function liveSpellUrl(n) {
    n = parseInt(n, 10);
    if (!n) return "";
    if (n >= 1 && n <= 1000) return "paintings/" + n + ".jpg";
    var raw = "";
    try {
      if (typeof window.getSpellforgeSpellUrl === "function") {
        raw = String(window.getSpellforgeSpellUrl(n) || "");
      }
    } catch (e) {}
    raw = resolveStill(raw);
    var bogusPainting = /(?:^|\/)paintings\/(\d+)\./i.exec(raw);
    if (n > 1000 && bogusPainting && parseInt(bogusPainting[1], 10) === n) raw = "";
    if (raw) return raw;
    if (n >= GEN_BASE && n < 200000) {
      var g = n - GEN_BASE;
      var gens = (state.pool && state.pool.generated) || [];
      var i;
      for (i = 0; i < gens.length; i++) {
        var a = gens[i];
        if (!a) continue;
        if (a.label === "Generated #" + g) return resolveStill(a.url);
        var m = String(a.url || "").match(/\/generated\/([^/?#]+)/i);
        if (m && m[1].replace(/\.[^.]+$/, "") === String(g)) return resolveStill(a.url);
      }
      return "generated/" + g + ".jpg";
    }
    if (n >= 200000 && n < 300000) return "sketches/" + (n - 200000) + ".png";
    if (n >= 300000 && n < 400000) return "sketches-inverted/" + (n - 300000) + ".png";
    return "paintings/" + n + ".jpg";
  }

  function spellFallbacks(n) {
    n = parseInt(n, 10);
    var primary = liveSpellUrl(n);
    var urls = [];
    function add(u) {
      if (u && urls.indexOf(u) < 0) urls.push(u);
    }
    if (primary) {
      add(thumbSrc(primary, 220));
      add(primary);
    }
    stillFallbacks(primary).forEach(add);
    if (n >= 1 && n <= 1000) add("paintings/" + n + ".jpg");
    else if (n >= GEN_BASE && n < 200000) {
      add("generated/" + (n - GEN_BASE) + ".jpg");
      add("generated/" + (n - GEN_BASE) + ".png");
    } else if (n >= 200000 && n < 300000) {
      add("sketches/" + (n - 200000) + ".png");
    } else if (n >= 300000 && n < 400000) {
      add("sketches-inverted/" + (n - 300000) + ".png");
    }
    return urls;
  }

  function setStillImg(img, n) {
    if (!img) return;
    var urls = spellFallbacks(n);
    var i = 0;
    img.onerror = function () {
      i++;
      if (i < urls.length) img.src = urls[i];
      else img.onerror = null;
    };
    if (urls[0]) img.src = urls[0];
    else img.removeAttribute("src");
  }

  function readForgeSlots() {
    try {
      if (window.SpellforgeAPI && typeof window.SpellforgeAPI.getEquippedSlots === "function") {
        var s = window.SpellforgeAPI.getEquippedSlots();
        if (Array.isArray(s) && s.length) return [s[0] || null, s[1] || null, s[2] || null];
      }
      var raw = JSON.parse(localStorage.getItem("spellforge_equipped_v1") || "null");
      if (Array.isArray(raw)) return [raw[0] || null, raw[1] || null, raw[2] || null];
    } catch (e) {}
    return [null, null, null];
  }

  function writeForgeSlots(slots) {
    state.forgeSlots = slots.slice(0, 3);
    try {
      localStorage.setItem("spellforge_equipped_v1", JSON.stringify(state.forgeSlots));
    } catch (e) {}
    try {
      if (window.SpellforgeAPI && typeof window.SpellforgeAPI.equipSlots === "function") {
        window.SpellforgeAPI.equipSlots(state.forgeSlots, { skipAutoVision: true });
      } else {
        var i = state.forgeSlot | 0;
        if (
          window.SpellforgeAPI &&
          typeof window.SpellforgeAPI.equipToSlot === "function" &&
          state.forgeSlots[i]
        ) {
          window.SpellforgeAPI.equipToSlot(state.forgeSlots[i], i);
        }
      }
    } catch (e2) {}
    renderForgeSlots();
  }

  function renderForgeSlots() {
    var slots = state.forgeSlots || readForgeSlots();
    state.forgeSlots = slots;
    var root = $("lv-slots");
    if (!root) return;
    root.querySelectorAll(".lv-slot").forEach(function (el) {
      var i = parseInt(el.getAttribute("data-slot"), 10);
      var n = slots[i];
      var img = el.querySelector("img");
      var lab = el.querySelector(".lv-slot-num");
      el.classList.toggle("active", i === state.forgeSlot);
      if (lab) lab.textContent = liveSpellLabel(n);
      if (img) setStillImg(img, n);
    });
  }

  function stepForgeSlot(i, dir) {
    var cur = parseInt((state.forgeSlots && state.forgeSlots[i]) || 1, 10) || 1;
    var next = cur;
    if (cur >= GEN_BASE && state.pool.generated && state.pool.generated.length) {
      var gens = state.pool.generated
        .map(function (a) {
          var m = String(a.label || a.url || "").match(/(\d+)/);
          return GEN_BASE + (m ? parseInt(m[1], 10) : 0);
        })
        .filter(Boolean);
      var gi = gens.indexOf(cur);
      if (gi < 0) gi = 0;
      next = gens[(gi + dir + gens.length) % gens.length];
    } else {
      next = cur + dir;
      if (next < 1) next = 1000;
      if (next > 1000) next = 1;
    }
    var slots = (state.forgeSlots || [null, null, null]).slice();
    slots[i] = next;
    writeForgeSlots(slots);
    setStatus("Slot " + (i + 1) + " → " + liveSpellLabel(next));
  }

  function pickForgeSlotNumber(i) {
    var cur = (state.forgeSlots && state.forgeSlots[i]) || 1;
    var typed = window.prompt("Spell number (1–1000 painting, or G#)", liveSpellLabel(cur));
    if (typed == null) return;
    typed = String(typed).trim();
    var n = 0;
    var gm = typed.match(/^g#?\s*(\d+)/i);
    if (gm) n = GEN_BASE + parseInt(gm[1], 10);
    else n = parseInt(typed.replace("#", ""), 10);
    if (!n) return;
    var slots = (state.forgeSlots || [null, null, null]).slice();
    slots[i] = n;
    writeForgeSlots(slots);
  }

  var BOOK_PAGE = 25;
  var BOOK_ORDER_KEY = "spellforge_display_order_v11";

  function bookList() {
    var list = [];
    try {
      if (window.SpellforgeAPI && typeof window.SpellforgeAPI.getDisplayOrder === "function") {
        var fromApi = window.SpellforgeAPI.getDisplayOrder();
        if (Array.isArray(fromApi) && fromApi.length) list = fromApi;
      }
    } catch (e0) {}
    if (!list.length) {
      try {
        var saved = JSON.parse(localStorage.getItem(BOOK_ORDER_KEY) || "null");
        if (Array.isArray(saved) && saved.length) list = saved;
      } catch (e) {}
    }
    list = list
      .map(function (n) {
        return parseInt(n, 10);
      })
      .filter(function (n) {
        return n >= 1;
      });
    if (!list.length) {
      var n;
      for (n = 1; n <= 1000; n++) list.push(n);
    }
    state.bookOrder = list;
    return list;
  }

  function bookPageCount() {
    return Math.max(1, Math.ceil(bookList().length / BOOK_PAGE));
  }

  function renderBook() {
    var box = $("lv-book");
    if (!box || (box.hidden && !box.classList.contains("on"))) return;
    var list = bookList();
    var pages = bookPageCount();
    if (state.bookPage < 0) state.bookPage = 0;
    if (state.bookPage >= pages) state.bookPage = pages - 1;
    var slotEl = $("lv-book-slot");
    var pageEl = $("lv-book-page");
    if (slotEl) slotEl.textContent = "Slot " + ((state.forgeSlot | 0) + 1);
    if (pageEl) pageEl.textContent = "Page " + (state.bookPage + 1) + " / " + pages;
    var grid = $("lv-book-grid");
    if (!grid) return;
    var start = state.bookPage * BOOK_PAGE;
    var slice = list.slice(start, start + BOOK_PAGE);
    var equipped = (state.forgeSlots && state.forgeSlots[state.forgeSlot]) || null;
    grid.innerHTML = "";
    slice.forEach(function (n) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "lv-book-tile" + (Number(n) === Number(equipped) ? " on" : "");
      btn.setAttribute("data-num", String(n));
      var img = document.createElement("img");
      img.alt = "";
      img.width = 200;
      img.height = 200;
      img.decoding = "async";
      var lab = document.createElement("span");
      lab.textContent = liveSpellLabel(n);
      btn.appendChild(img);
      btn.appendChild(lab);
      grid.appendChild(btn);
      setStillImg(img, n);
    });
  }

  function openBook(slot) {
    if (slot == null || isNaN(slot)) slot = state.forgeSlot | 0;
    state.forgeSlot = slot;
    var list = bookList();
    var cur = (state.forgeSlots && state.forgeSlots[slot]) || 0;
    var idx = list.indexOf(cur);
    if (idx < 0) idx = list.indexOf(parseInt(cur, 10));
    if (idx >= 0) state.bookPage = Math.floor(idx / BOOK_PAGE);
    var box = $("lv-book");
    if (box) {
      box.hidden = false;
      box.removeAttribute("hidden");
      box.classList.add("on");
    }
    renderForgeSlots();
    renderBook();
    setStatus("Spellbook on camera — pick a still for slot " + (slot + 1) + ".");
    loadPool().then(function () {
      renderForgeSlots();
      renderBook();
    });
  }

  function closeBook() {
    var box = $("lv-book");
    if (box) {
      box.classList.remove("on");
      box.hidden = true;
    }
  }

  function chooseBookSpell(n) {
    n = parseInt(n, 10);
    if (!n) return;
    var slots = (state.forgeSlots || [null, null, null]).slice();
    slots[state.forgeSlot | 0] = n;
    writeForgeSlots(slots);
    renderBook();
    setStatus("Slot " + ((state.forgeSlot | 0) + 1) + " → " + liveSpellLabel(n));
  }

  function randomBookPage() {
    state.bookPage = (Math.random() * bookPageCount()) | 0;
    renderBook();
  }

  function shuffleBookPages() {
    var list = bookList().slice();
    var i;
    for (i = list.length - 1; i > 0; i--) {
      var j = (Math.random() * (i + 1)) | 0;
      var t = list[i];
      list[i] = list[j];
      list[j] = t;
    }
    state.bookOrder = list;
    state.bookPage = 0;
    renderBook();
    setStatus("Pages shuffled.");
  }

  function randomBookPick() {
    var list = bookList();
    if (!list.length) return;
    chooseBookSpell(list[(Math.random() * list.length) | 0]);
    var idx = list.indexOf(state.forgeSlots[state.forgeSlot]);
    if (idx >= 0) state.bookPage = Math.floor(idx / BOOK_PAGE);
    renderBook();
  }

  function hangWall(url, label) {
    var src = resolveStill(url) || String(url || "").trim();
    if (!src) return Promise.reject(new Error("No still URL"));
    label = label || "Wall: Spellforge still";
    function apply(img) {
      releaseImg(state.setImg);
      state.setImg = img;
      state.palette = samplePalette(img);
      setStatus(label);
      return img;
    }
    return fetchStill(src)
      .then(apply)
      .catch(function () {
        return new Promise(function (resolve, reject) {
          var im = new Image();
          im.onload = function () {
            apply(im);
            resolve(im);
          };
          im.onerror = function () {
            setStatus("Still came back but the wall could not load it.");
            reject(new Error("wall"));
          };
          im.src = src;
        });
      });
  }

  function isProductStillUrl(url) {
    var u = String(url || "");
    if (!u || u.indexOf("data:") === 0 || u.indexOf("blob:") === 0) return false;
    return /generated\//i.test(u);
  }

  function loadLastVision() {
    var url = "";
    try {
      if (window.spellforgeFusion && window.spellforgeFusion.visionUrl) {
        url = window.spellforgeFusion.visionUrl;
      }
    } catch (e) {}
    if (!url) {
      try {
        var saved = JSON.parse(localStorage.getItem("spellforge_last_vision_v1") || "null");
        if (saved && saved.url) url = saved.url;
      } catch (e2) {}
    }
    if (!isProductStillUrl(url)) return Promise.resolve();
    return hangWall(url, "Wall: last product still").catch(function () {});
  }

  function rememberLiveAnalysis(n, a) {
    n = parseInt(n, 10);
    if (!n || !a) return;
    if (!state.liveAnalyses) state.liveAnalyses = {};
    state.liveAnalyses[n] = a;
    state.liveAnalyses[String(n)] = a;
  }

  function liveFallbackAnalysis(n) {
    var lab = liveSpellLabel(n);
    return {
      title: lab,
      description:
        "Influence still " +
        lab +
        " — borrow its palette, texture, and motif language. Invent a new scene; do not copy the source composition, pose, or layout.",
      prompt:
        "Original painterly scene influenced by the mood, pigments, and surface of " +
        lab +
        ", brand-new composition and subjects, no collage or remake of the source still.",
      style: "painterly",
      mood: "inventive",
      tags: ["influence", "fusion", "original"],
    };
  }

  function stillToAnalyzeDataUrl(url) {
    return new Promise(function (resolve, reject) {
      var im = new Image();
      im.onload = function () {
        var max = 512;
        var iw = im.naturalWidth || im.width || 1;
        var ih = im.naturalHeight || im.height || 1;
        var s = Math.min(1, max / Math.max(iw, ih));
        var c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(iw * s));
        c.height = Math.max(1, Math.round(ih * s));
        c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
        resolve(c.toDataURL("image/jpeg", 0.82));
      };
      im.onerror = function () {
        reject(new Error("still"));
      };
      im.src = resolveStill(url) || url;
    });
  }

  function describeSpellFromImage(n) {
    if (liveHasDNA(n)) return Promise.resolve(liveAnalysisOf(n));
    setStatus("Reading " + liveSpellLabel(n) + " from the still…");
    return stillToAnalyzeDataUrl(liveSpellUrl(n))
      .then(function (dataUrl) {
        return fetch(apiUrl("/api/analyze-image"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            image: dataUrl,
            mode: "phone",
            emphasis:
              "Spellforge influence DNA. Describe visible motifs, palette, texture, and mood. Write a generation prompt for a NEW painting, not a copy.",
          }),
          cache: "no-store",
        }).then(function (r) {
          return r.json().then(function (d) {
            return { ok: r.ok, d: d };
          });
        });
      })
      .then(function (res) {
        var a = res && res.ok && res.d && res.d.analysis;
        if (!a || !(a.description || a.prompt)) a = liveFallbackAnalysis(n);
        rememberLiveAnalysis(n, a);
        return a;
      })
      .catch(function () {
        var a = liveFallbackAnalysis(n);
        rememberLiveAnalysis(n, a);
        return a;
      });
  }

  function ensureSpellDNA(nums) {
    return hydrateLiveAnalyses(nums).then(function () {
      var missing = nums.filter(function (n) {
        return !liveHasDNA(n);
      });
      if (!missing.length) return nums;
      setStatus(
        "Writing descriptions from " + missing.map(liveSpellLabel).join(", ") + "…"
      );
      return Promise.all(missing.map(describeSpellFromImage)).then(function () {
        return nums;
      });
    });
  }

  function liveAnalysisOf(n) {
    n = parseInt(n, 10);
    if (!n) return null;
    if (state.liveAnalyses) {
      var cached = state.liveAnalyses[n] || state.liveAnalyses[String(n)];
      if (cached && (cached.description || cached.prompt)) return cached;
    }
    try {
      if (typeof window.getSpellforgeSpellAnalysis === "function") {
        var sf = window.getSpellforgeSpellAnalysis(n);
        if (sf && (sf.description || sf.prompt)) return sf;
      }
    } catch (e0) {}
    var ga = window.getGalleryAnalyses ? window.getGalleryAnalyses() : window.galleryAnalyses;
    if (ga) {
      var a = ga[String(n)] || ga[n];
      if (a && (a.description || a.prompt)) return a;
    }
    var g = n >= GEN_BASE && n < 200000 ? n - GEN_BASE : n;
    if (typeof window.getLod1Analysis === "function") {
      var lod = window.getLod1Analysis(g);
      if (lod && (lod.description || lod.prompt)) return lod;
    }
    if (state.lod1) return state.lod1[String(g)] || state.lod1[g] || null;
    return null;
  }

  function liveSpellDNA(n) {
    var a = liveAnalysisOf(n) || {};
    var parts = [];
    if (a.title) parts.push(a.title);
    if (a.description) parts.push(a.description);
    if (a.prompt) parts.push("Generation prompt: " + a.prompt);
    if (a.style) parts.push("Style: " + a.style);
    if (a.mood) parts.push("Mood: " + a.mood);
    if (a.tags && a.tags.length) parts.push("Tags: " + a.tags.join(", "));
    return parts.join("\n\n");
  }

  function liveHasDNA(n) {
    var t = liveSpellDNA(n);
    return !!(t && t.replace(/\s+/g, " ").length > 24);
  }

  function hydrateLiveAnalyses(nums) {
    var jobs = [];
    if (typeof window.loadGalleryData === "function") {
      jobs.push(window.loadGalleryData().catch(function () {}));
    }
    jobs.push(
      fetch(apiUrl("/api/lod1-analyses?t=" + Date.now()), { cache: "default" })
        .then(function (r) {
          return r.ok ? r.json() : null;
        })
        .then(function (d) {
          if (d && typeof d === "object") state.lod1 = d.analyses || d;
        })
        .catch(function () {})
    );
    return Promise.all(jobs).then(function () {
      return nums;
    });
  }

  function buildLiveProductPrompt(nums, extra) {
    var roman = ["I", "II", "III"];
    var bodies = [];
    var i;
    for (i = 0; i < nums.length && i < 3; i++) {
      var dna = liveSpellDNA(nums[i]);
      if (!dna) continue;
      bodies.push(
        "── INFLUENCE " +
          roman[i] +
          " (motif DNA only · " +
          liveSpellLabel(nums[i]) +
          ") ──\n" +
          dna
      );
    }
    var artist =
      (window.GALLERY_AUTHOR && window.GALLERY_AUTHOR.author) || "Logan Sevin";
    var extraLine = extra ? "\nExtra direction: " + extra + "\n" : "";
    var prompt =
      "SPELLFORGE PRODUCT — invent ONE brand-new fine-art painting for sale.\n" +
      "This is NOT a remake, restage, collage, or near-copy of any equipped painting. " +
      "Do not preserve any source composition, figure pose, camera angle, or layout.\n" +
      "Borrow only abstract motifs, mood, and texture ideas from the influence texts below, " +
      "then invent a fourth original scene that has never existed.\n" +
      "Studio author: " +
      artist +
      ".\n\n" +
      "INFLUENCE TEXTS (motif / mood DNA only — invent new subjects & staging):\n" +
      bodies.join("\n\n") +
      "\n\n" +
      "FUSION DIRECTIVE: Weave influence motifs into a NEW composition and new subjects. " +
      "One coherent painting — not three panels, not a grid, not a stacked photo-fusion of the source works.\n" +
      extraLine +
      "Output: one original finished artwork (product-ready). Fill the canvas fully; no letterboxing; no collage panels of source paintings.";
    if (prompt.length > 7200) prompt = prompt.slice(0, 7199) + "…";
    return prompt;
  }

  function pollLiveJob(jobId, left) {
    if (left == null) left = 90;
    if (left <= 0) return Promise.reject(new Error("Timed out waiting for xAI."));
    return fetch(apiUrl("/api/jobs/" + encodeURIComponent(jobId)), { cache: "no-store" })
      .then(function (r) {
        return r.json();
      })
      .then(function (job) {
        var st = String((job && job.status) || "working");
        setStatus("xAI inventing a new product still… (" + st + ")");
        if (st === "done") {
          var img = (job.images && job.images[0]) || job.image;
          var url = img && img.url;
          if (url) return url;
          throw new Error("Job done but no image URL.");
        }
        if (st === "failed" || st === "error") {
          var err = job.error;
          throw new Error((err && err.message) || err || "Generate failed");
        }
        return new Promise(function (resolve, reject) {
          setTimeout(function () {
            pollLiveJob(jobId, left - 1).then(resolve, reject);
          }, 2000);
        });
      });
  }

  function liveForgeProduct(nums, extra) {
    return ensureSpellDNA(nums).then(function () {
      var ready = nums.filter(liveHasDNA);
      if (!ready.length) {
        nums.forEach(function (n) {
          rememberLiveAnalysis(n, liveFallbackAnalysis(n));
        });
        ready = nums.slice();
      }
      var stasisSend = buildLiveProductPrompt(ready, extra);
      var details = ready.map(function (n, s) {
        var a = liveAnalysisOf(n) || {};
        return {
          number: n >= 1 && n <= 1000 ? n : 0,
          title: a.title || liveSpellLabel(n),
          description: String(a.description || a.prompt || "").slice(0, 1800),
          prompt: String(a.prompt || "").slice(0, 800),
          style: a.style || "",
          mood: a.mood || "",
          tags: (a.tags || []).slice(0, 8),
          source: "influence-text",
          slot: s,
        };
      });
      var jobId =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : "live-" + Date.now();
      setStatus("Calling xAI for a brand-new Spellforge product still…");
      return fetch(apiUrl("/api/generate-stasis-vision"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_id: jobId,
          stasis: stasisSend,
          prompt: stasisSend,
          fused_prompt: stasisSend,
          buzz_words: ["original painting", "brand new composition", "invented scene"],
          spells: ready.filter(function (n) {
            return n >= 1 && n <= 1000;
          }),
          spell_details: details,
          aspect_ratio: state.aspect || "9:16",
          mag_fresh: true,
          fresh_variation: true,
          spell_cast: false,
          attach_references: false,
          reference_image: "",
          spell_reference_image: "",
          source: "spellforge",
          product_mode: "original_fusion",
        }),
        cache: "no-store",
      }).then(function (r) {
        return r.json().then(function (d) {
          if (
            r.status === 202 ||
            (d && (d.status === "queued" || d.status === "pending") && (d.job_id || jobId))
          ) {
            return pollLiveJob(d.job_id || jobId);
          }
          if (!r.ok) {
            var errMsg =
              (d && d.error && d.error.message) || d.error || "Generate failed";
            throw new Error(typeof errMsg === "string" ? errMsg : JSON.stringify(errMsg));
          }
          var img = d.image || (d.images && d.images[0]);
          if (img && img.url) return img.url;
          if (d.job_id) return pollLiveJob(d.job_id);
          throw new Error("No image returned");
        });
      });
    });
  }

  function forgeOnWall() {
    var slots = (state.forgeSlots || []).filter(Boolean);
    if (slots.length < 2) {
      setStatus("Equip 2–3 spells in the slots, then Forge on wall.");
      speak("Need two or three spells in the slots first.");
      return;
    }
    var labels = slots.map(liveSpellLabel).join(", ");
    var extra = "";
    var promptEl = $("lv-prompt");
    if (promptEl) extra = String(promptEl.value || "").trim();
    state.livePrompt = extra;
    save();
    setStatus("Forging a NEW still from " + labels + " descriptions — not a remake.");
    speak("Inventing a new painting from the spell texts.");
    liveForgeProduct(slots, extra)
      .then(function (url) {
        if (!url) throw new Error("Generate finished with no still.");
        try {
          localStorage.setItem(
            "spellforge_last_vision_v1",
            JSON.stringify({ url: url, slots: slots, t: Date.now() })
          );
        } catch (eSave) {}
        return hangWall(url, "Wall: new Spellforge product");
      })
      .catch(function (err) {
        var msg = (err && err.message) || String(err || "Generate failed");
        setStatus(msg);
        speak("Generate missed. " + msg.slice(0, 80));
      });
  }

  function chooseVoice() {
    if (!window.speechSynthesis) return null;
    var voices = speechSynthesis.getVoices() || [];
    if (!voices.length) return null;
    var scored = voices.map(function (v) {
      var n = (v.name || "") + " " + (v.lang || "");
      var s = 0;
      if (/en[-_]US/i.test(n)) s += 6;
      else if (/en[-_]/i.test(n)) s += 4;
      if (/male|daniel|david|alex|guy|ryan|matthew|barack|google uk english male|microsoft david|microsoft guy|microsoft andrew/i.test(n))
        s += 8;
      if (/natural|neural|online/i.test(n)) s += 3;
      if (/female|zira|samantha|siri/i.test(n)) s -= 5;
      return { v: v, s: s };
    });
    scored.sort(function (a, b) {
      return b.s - a.s;
    });
    return scored[0] && scored[0].s > 0 ? scored[0].v : voices[0];
  }

  function hush() {
    state.talking = false;
    state.talkQueue = [];
    state.currentUtterance = null;
    if (window.speechSynthesis) {
      try {
        speechSynthesis.cancel();
      } catch (e) {}
    }
  }

  function synthBusy() {
    try {
      return !!(window.speechSynthesis && (speechSynthesis.speaking || speechSynthesis.pending));
    } catch (e) {
      return false;
    }
  }

  function lineHold(line, ms) {
    var words = String(line).split(/\s+/).filter(Boolean).length;
    var est = 1400 + words * 480;
    if (ms) return Math.max(ms, est);
    return Math.min(14000, Math.max(2400, est));
  }

  function utter(line, hold, cut) {
    hold = lineHold(line, hold);
    if (!cut && (synthBusy() || (state.talking && state.t < state.talkingUntil))) {
      if (state.talkQueue.length < 3 && state.talkQueue.indexOf(line) < 0) {
        state.talkQueue.push(line);
      }
      return;
    }
    if (cut) {
      state.talkQueue = [];
      try {
        if (window.speechSynthesis) speechSynthesis.cancel();
      } catch (e) {}
    }
    state.say = line.slice(0, 180);
    state.sayUntil = state.t + hold / 1000;
    state.talking = true;
    state.talkingUntil = state.t + hold / 1000;
    state.gapUntil = state.t + hold / 1000 + 0.4;
    var cap = $("lv-caption");
    if (cap) cap.textContent = state.say;
    if (state.muted || !window.speechSynthesis) return;
    try {
      var u = new SpeechSynthesisUtterance(line);
      state.currentUtterance = u;
      if (!state.voice) state.voice = chooseVoice();
      if (state.voice) u.voice = state.voice;
      u.rate = 0.96;
      u.pitch = 0.88;
      u.volume = 1;
      u.onend = function () {
        if (state.currentUtterance !== u) return;
        state.gapUntil = Math.max(state.gapUntil, state.t + 0.6);
      };
      u.onerror = function () {
        if (state.currentUtterance !== u) return;
        state.talking = false;
        state.gapUntil = Math.max(state.gapUntil, state.t + 0.3);
      };
      speechSynthesis.speak(u);
    } catch (err) {
      state.talking = false;
    }
  }

  function speak(text, ms, opts) {
    opts = opts || {};
    var line = String(text || "").replace(/\s+/g, " ").trim();
    if (!line) return;
    if (opts.cut) {
      utter(line, ms, true);
      return;
    }
    if (state.talking || synthBusy() || state.t < (state.gapUntil || 0) || state.talkQueue.length) {
      if (state.talkQueue.length < 2 && state.talkQueue.indexOf(line) < 0) {
        state.talkQueue.push(line);
      }
      return;
    }
    utter(line, ms, false);
  }

  function stepTalk(dt) {
    if (synthBusy()) {
      state.talking = true;
      return;
    }
    if (state.t < (state.gapUntil || 0) || state.t < state.talkingUntil) return;
    state.talking = false;
    if (state.talkQueue.length) {
      utter(state.talkQueue.shift(), null, false);
      return;
    }
    if (state.asking) return;
    state.nextBanterAt -= dt;
    if (state.nextBanterAt <= 0) {
      state.nextBanterAt = (state.live ? 11 : 14) + Math.random() * 6;
      speak(pick(BANTER));
    }
  }

  function hostLine(act, user) {
    var pool = HOST_BITS[act] || ["Watch the host."];
    var line = pick(pool);
    if (user && Math.random() < 0.55) return user + ". " + line;
    return line;
  }

  function setAction(name, dur) {
    var p = state.person;
    p.action = name;
    p.actionT = dur || 1.2;
    if (name === "left") {
      p.facing = -1;
      p.vx = -0.16;
      p.action = "walk";
      p.actionT = 1.8;
    } else if (name === "right") {
      p.facing = 1;
      p.vx = 0.16;
      p.action = "walk";
      p.actionT = 1.8;
    } else if (name === "center") {
      p.action = "walk";
      p.vx = p.x < 0.5 ? 0.14 : -0.14;
      p.facing = p.vx >= 0 ? 1 : -1;
      p.actionT = 2.2;
    } else if (name === "run") {
      p.vx = 0.28 * p.facing;
      p.actionT = dur || 1.6;
    } else if (name === "idle" || name === "sit") {
      p.vx = 0;
    } else if (name === "inspect") {
      var pr = nearestProp();
      if (pr) {
        state.targetProp = pr;
        p.action = "walk";
        p.actionT = 2.4;
      } else {
        p.action = "idle";
      }
    } else if (name === "follow") {
      state.mood = "follow";
      state.moodT = 5 + Math.random() * 5;
      p.action = "walk";
    } else if (name === "ignore") {
      state.mood = "ignore";
      state.ignoreStyle = pick(["wander", "avoid", "sit"]);
      state.moodT = 5 + Math.random() * 6;
      p.action = state.ignoreStyle === "sit" ? "sit" : "idle";
      p.vx = 0;
    }
  }

  function parsePrompt(text) {
    var t = String(text || "");
    if (/\b(flip|somersault)\b/i.test(t)) return "flip";
    if (/\b(jump|hop|leap)\b/i.test(t)) return "jump";
    if (/\b(danc|boogie|groove)\b/i.test(t)) return "dance";
    if (/\b(wave|hi+|hello|hey there)\b/i.test(t)) return "wave";
    if (/\b(bow|curtsy|thank)\b/i.test(t)) return "bow";
    if (/\b(sit|crouch)\b/i.test(t)) return "sit";
    if (/\b(spin|twirl|turn around)\b/i.test(t)) return "spin";
    if (/\b(run|sprint)\b/i.test(t)) return "run";
    if (/\b(stop|freeze|stay)\b/i.test(t)) return "idle";
    if (/\bleft\b/i.test(t)) return "left";
    if (/\bright\b/i.test(t)) return "right";
    if (/\b(come here|center|middle)\b/i.test(t)) return "center";
    if (/\b(look at|inspect|touch|that painting|the spell|the prop|the crate|the orb)\b/i.test(t))
      return "inspect";
    if (/\b(follow me|follow the cursor|come here pointer)\b/i.test(t)) return "follow";
    if (/\b(ignore|don't follow|stop following)\b/i.test(t)) return "ignore";
    return "";
  }

  function isRude(text) {
    return RUDE_RE.test(text || "");
  }

  function isQuestion(text) {
    var t = String(text || "");
    return /\?/.test(t) || /^(who|what|why|how|where|when)\b/i.test(t);
  }

  function localAnswer(text, user) {
    var t = String(text || "").toLowerCase();
    var who = user ? user : "chat";
    if (/\bwho\b/.test(t))
      return "I'm the host. Gold tie, live camera, your whole night if you stay.";
    if (/what is this|what's this|what is it/.test(t))
      return "It's a live show in a rectangle. I'm the talent. The wall is a painting.";
    if (/how long|been live/.test(t))
      return "Clock's running. I don't punch out. Neither should you, " + who + ".";
    if (/paint|gallery|logan/.test(t))
      return "Logan Sevin. A thousand paintings. This set is one of them, lit for me.";
    if (/love|beautiful|cool|fire/.test(t))
      return "I know. Say it again, " + who + ". The camera likes confidence.";
    return "";
  }

  function pushComment(user, text, opts) {
    opts = opts || {};
    var rude = opts.rude || isRude(text);
    var row = {
      id: Date.now() + Math.random(),
      user: String(user || "viewer").slice(0, 18),
      text: String(text || "").slice(0, 160),
      rude: rude,
      t: state.t,
    };
    var cut = !!opts.cut;
    state.comments.push(row);
    if (state.comments.length > MAX_CHAT) state.comments.splice(0, state.comments.length - MAX_CHAT);
    state.chatDirty = true;
    if (rude) {
      report(row, "auto");
      speak("We don't do that in this rectangle. Reported. Next.", null, { cut: true });
      setAction("idle", 1.4);
      return row;
    }
    var act = parsePrompt(row.text);
    if (opts.fromTikTok) {
      if (act) {
        setAction(act, 1.8);
        if (!opts.silent) speak(hostLine(act, row.user));
      } else if (isQuestion(row.text)) {
        askGrok(row);
      }
      return row;
    }
    if (opts.skipGrok) {
      if (act) setAction(act, 1.8);
      return row;
    }
    if (act === "follow") {
      setAction("follow");
      if (!opts.silent)
        speak(pick(["Alright, I'll follow the pointer.", "Fine. Cursor's the director."]), null, {
          cut: cut,
        });
    } else if (act === "ignore") {
      setAction("ignore");
      if (!opts.silent)
        speak(pick(["Not chasing that.", "Pointer's not talent. I am."]), null, { cut: cut });
    } else if (act) {
      setAction(act, 1.8);
      if (!opts.silent) speak(hostLine(act, row.user), null, { cut: cut });
    } else if (isQuestion(row.text)) {
      var canned = localAnswer(row.text, row.user);
      if (canned) speak(canned, null, { cut: cut });
      else askGrok(row);
    } else if (!opts.noRepeat && row.text.length < 90 && Math.random() < 0.72) {
      speak(
        pick([
          row.user + " said " + row.text + ". I heard you.",
          "Hold that thought from " + row.user + ". " + row.text,
          "Chat wants it on the record: " + row.text,
        ]),
        null,
        { cut: cut }
      );
    }
    return row;
  }

  function report(row, how) {
    state.reports.unshift({
      user: row.user,
      text: row.text,
      how: how || "tap",
      at: Date.now(),
    });
    if (state.reports.length > MAX_MOD) state.reports.length = MAX_MOD;
    row.rude = true;
    state.modDirty = true;
    state.chatDirty = true;
    save();
    setStatus("Reported @" + row.user);
  }

  function thankGift(user, gift) {
    var g = gift || pick(GIFTS);
    state.gifts.push({
      user: user,
      name: g.name,
      coins: g.coins,
      t: state.t,
    });
    if (state.gifts.length > MAX_GIFTS) state.gifts.splice(0, state.gifts.length - MAX_GIFTS);
    state.giftDirty = true;
    setAction("bow", 1.6);
    speak(
      pick([
        user + " just sent a " + g.name + ". That's how you talk to the host.",
        "Thank you " + user + " for the " + g.name + ". I felt that.",
        g.name + " in the building — " + user + ", you're on the list.",
      ]),
      null,
      { cut: false }
    );
  }

  function askGrok(row) {
    if (state.asking || state.t - state.lastAskAt < 4500) return;
    state.asking = true;
    state.lastAskAt = state.t;
    setStatus("Answering @" + row.user + "…");
    fetch(apiUrl("/api/chat"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          {
            role: "user",
            content:
              "You are a live show host on camera in Logan Sevin's studio: sharp, warm, a little vain. " +
              "Speak ONE sentence out loud (max 18 words). No stage directions, no hashtags, never say okay-dash-an-action. " +
              "If they asked for a move, riff like you already did it. Address @" +
              row.user +
              ". They said: " +
              row.text,
          },
        ],
      }),
      cache: "no-store",
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (d) {
        var text = String((d && (d.text || d.reply)) || "").trim();
        var act = "";
        var m = text.match(/\[ACTION:\s*([a-z]+)\]/i);
        if (m) {
          act = m[1].toLowerCase();
          text = text.replace(m[0], "").trim();
        }
        if (text) speak(text, null, { cut: false });
        if (act) setAction(act, 1.8);
        setStatus("");
      })
      .catch(function () {
        setStatus("Answer skipped — still live.");
      })
      .then(function () {
        state.asking = false;
      });
  }

  function readStudioMessages() {
    if (window.StudioChat && typeof window.StudioChat.getMessages === "function") {
      return window.StudioChat.getMessages();
    }
    try {
      var raw = JSON.parse(localStorage.getItem(STUDIO_CHAT) || "null");
      return raw && Array.isArray(raw.messages) ? raw.messages : [];
    } catch (e) {
      return [];
    }
  }

  function paintStudioOverlay() {
    var msgs = readStudioMessages().slice(-MAX_CHAT);
    state.comments = msgs.map(function (m, i) {
      var role = m.role === "assistant" ? "assistant" : "user";
      return {
        id: "s" + i,
        user: role === "assistant" ? "host" : "you",
        text: String(m.content || "").replace(/\s+/g, " ").trim().slice(0, 180),
        rude: false,
        role: role,
      };
    });
    state.chatDirty = true;
  }

  function onStudioLine(role, content) {
    var text = String(content || "").trim();
    if (!text) return;
    if (role === "assistant") {
      var said = text.length > 220 ? text.slice(0, 217) + "…" : text;
      speak(said, null, { cut: false });
      var act = parsePrompt(text);
      if (act) setAction(act, 1.8);
      return;
    }
    pushComment("you", text, { skipGrok: true, silent: true, cut: false, fromStudio: true });
  }

  function catchUpStudio(playNew) {
    var msgs = readStudioMessages();
    if (state.studioCursor < 0) {
      state.studioCursor = msgs.length;
      paintStudioOverlay();
      return;
    }
    if (!playNew) {
      state.studioCursor = msgs.length;
      paintStudioOverlay();
      return;
    }
    while (state.studioCursor < msgs.length) {
      var m = msgs[state.studioCursor++];
      onStudioLine(m.role, m.content);
    }
    paintStudioOverlay();
  }

  function handleTikTokEvent(ev) {
    var kind = ev && ev.kind;
    var hushTab = document.hidden || !document.body.classList.contains("lv-tab-active");
    if (kind === "comment" && ev.text) {
      pushComment(ev.user || "viewer", ev.text, { fromTikTok: true, silent: hushTab });
      return;
    }
    if (kind === "gift") {
      if (hushTab) return;
      thankGift(ev.user || "viewer", { name: ev.name || "gift", coins: ev.coins || 1, id: ev.name });
      return;
    }
    if (kind === "follow") {
      if (hushTab) return;
      speak(
        pick([
          "Thanks for the follow, " + (ev.user || "friend") + ".",
          (ev.user || "Someone") + " just followed. Welcome.",
        ])
      );
      return;
    }
    if (kind === "connect") {
      state.tt.connected = true;
      state.tt.connecting = false;
      state.live = true;
      speak("We're on TikTok Live. @" + (ev.unique_id || state.tt.uniqueId) + " — chat is real now.", null, {
        cut: true,
      });
      setStatus("Connected to @" + (ev.unique_id || state.tt.uniqueId) + ". Real comments drive the host.");
      return;
    }
    if (kind === "disconnect" || kind === "end") {
      state.tt.connected = false;
      state.tt.connecting = false;
      setStatus(kind === "end" ? "TikTok live ended." : "Disconnected from TikTok.");
      return;
    }
    if (kind === "error" && ev.error) {
      state.tt.error = ev.error;
      state.tt.connecting = false;
      setStatus(ev.error);
    }
  }

  function pollTikTok() {
    if (!state.tt.wanted) return;
    fetch(apiUrl("/api/tiktok-live/events?after=" + encodeURIComponent(String(state.tt.after || 0))), {
      cache: "no-store",
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (d) {
        if (!d) return;
        state.tt.connected = !!d.connected;
        state.tt.connecting = !!d.connecting;
        if (d.viewers) state.tt.viewers = d.viewers;
        if (d.likes) state.tt.likes = d.likes;
        if (d.error) state.tt.error = d.error;
        var evs = d.events || [];
        var i;
        for (i = 0; i < evs.length; i++) handleTikTokEvent(evs[i]);
        if (d.after != null) state.tt.after = d.after;
        if (d.connected) state.live = true;
        renderHud();
      })
      .catch(function () {
        if (state.tt.wanted) setStatus("Can't reach the gallery server for TikTok Live.");
      });
  }

  function connectTikTok() {
    var inp = $("lv-tiktok");
    var uid = ((inp && inp.value) || state.tt.uniqueId || "").replace(/^@/, "").trim();
    if (!uid) {
      setStatus("Enter your TikTok @username — the account that is live.");
      return;
    }
    state.tt.uniqueId = uid;
    state.tt.wanted = true;
    state.tt.after = 0;
    state.tt.error = "";
    state.tt.connecting = true;
    save();
    if (!state.tt.timer) state.tt.timer = setInterval(pollTikTok, 700);
    setStatus("Connecting to @" + uid + "… the LIVE must already be on.");
    fetch(apiUrl("/api/tiktok-live/connect"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unique_id: uid }),
      cache: "no-store",
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (d) {
        if (d && d.ok === false) {
          state.tt.connecting = false;
          state.tt.wanted = false;
          setStatus(d.error || "Could not connect.");
          return;
        }
        pollTikTok();
      })
      .catch(function () {
        state.tt.connecting = false;
        setStatus("Connect failed — is start_server.bat running?");
      });
  }

  function disconnectTikTok() {
    state.tt.wanted = false;
    state.tt.connecting = false;
    if (state.tt.timer) {
      clearInterval(state.tt.timer);
      state.tt.timer = 0;
    }
    fetch(apiUrl("/api/tiktok-live/disconnect"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      cache: "no-store",
    }).catch(function () {});
    state.tt.connected = false;
    setStatus("Disconnected from TikTok Live.");
    renderHud();
  }

  function simTick(dt) {
    if (!state.tt.wanted) return;
    state.tt.poll = (state.tt.poll || 0) + dt;
    if (state.tt.poll > 0.7) {
      state.tt.poll = 0;
      pollTikTok();
    }
  }

  function rgbOf(c, a) {
    if (!c) c = [180, 140, 80];
    if (a == null) return "rgb(" + c[0] + "," + c[1] + "," + c[2] + ")";
    return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")";
  }

  function blobToBitmap(blob) {
    var max = 1600;
    function down(bmp) {
      var iw = bmp.width || bmp.naturalWidth || 0;
      var ih = bmp.height || bmp.naturalHeight || 0;
      if (!iw || !ih || (iw <= max && ih <= max)) return bmp;
      if (typeof createImageBitmap !== "function") return bmp;
      var s = max / Math.max(iw, ih);
      return createImageBitmap(bmp, {
        resizeWidth: Math.max(1, Math.round(iw * s)),
        resizeHeight: Math.max(1, Math.round(ih * s)),
      });
    }
    if (typeof createImageBitmap === "function") {
      return createImageBitmap(blob).then(down);
    }
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blob);
      var im = new Image();
      im.onload = function () {
        URL.revokeObjectURL(url);
        resolve(im);
      };
      im.onerror = reject;
      im.src = url;
    }).then(down);
  }

  function fetchStill(url) {
    var urls = stillFallbacks(url);
    function next(i) {
      if (i >= urls.length) return Promise.reject(new Error("still"));
      return fetch(urls[i], { cache: "default" })
        .then(function (r) {
          if (!r.ok) return next(i + 1);
          return r.blob().then(blobToBitmap);
        })
        .catch(function () {
          return next(i + 1);
        });
    }
    return next(0);
  }

  function samplePalette(img) {
    var pal = [];
    try {
      var c = document.createElement("canvas");
      c.width = 40;
      c.height = 40;
      var ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0, 40, 40);
      var d = ctx.getImageData(0, 0, 40, 40).data;
      var buckets = {};
      var i;
      for (i = 0; i < 1600; i++) {
        var o = i * 4;
        var r = d[o];
        var g = d[o + 1];
        var b = d[o + 2];
        var lum = 0.299 * r + 0.587 * g + 0.114 * b;
        if (lum < 14 || lum > 248) continue;
        var key = (r >> 5) + "-" + (g >> 5) + "-" + (b >> 5);
        var bk = buckets[key];
        if (!bk) {
          bk = { r: 0, g: 0, b: 0, n: 0 };
          buckets[key] = bk;
        }
        bk.r += r;
        bk.g += g;
        bk.b += b;
        bk.n++;
      }
      pal = Object.keys(buckets)
        .map(function (k) {
          return buckets[k];
        })
        .sort(function (a, b) {
          return b.n - a.n;
        })
        .slice(0, 6)
        .map(function (bk) {
          return [(bk.r / bk.n) | 0, (bk.g / bk.n) | 0, (bk.b / bk.n) | 0];
        });
    } catch (e) {}
    return pal.length ? pal : [[201, 162, 39], [90, 24, 40], [30, 28, 36]];
  }

  function paintingAsset(n) {
    var url =
      typeof window.getPaintingUrl === "function"
        ? window.getPaintingUrl(n)
        : "/paintings/" + n + ".jpg";
    return { url: url, label: "Painting #" + n, source: "painting" };
  }

  function spellforgeAssets() {
    var out = [];
    try {
      var api = window.SpellforgeAPI;
      if (api && typeof api.getEquippedSlots === "function") {
        (api.getEquippedSlots() || []).forEach(function (n) {
          if (!n) return;
          var url = liveSpellUrl(n);
          if (url) out.push({ url: url, label: "Spell #" + n, source: "spellforge" });
        });
      }
      if (api && typeof api.getFusion === "function") {
        var f = api.getFusion() || {};
        if (f.visionUrl) {
          out.push({ url: f.visionUrl, label: "Forge vision", source: "spellforge" });
        }
      }
    } catch (e) {}
    return out;
  }

  function loadPool() {
    if (state.pool.ready) return Promise.resolve(state.pool);
    return fetch(apiUrl("/api/dream-pool?t=" + Date.now()), { cache: "default" })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        var nums = Array.isArray(data.generated_nums) ? data.generated_nums.slice() : [];
        var files = data.generated_files || {};
        state.pool.generated = nums.map(function (num) {
          var name = files[String(num)] || num + ".jpg";
          return { url: "/generated/" + name, label: "Generated #" + num, source: "generated" };
        });
        state.pool.spells = [];
        state.pool.ready = true;
        return state.pool;
      })
      .catch(function () {
        state.pool.ready = true;
        return state.pool;
      });
  }

  function pickAsset() {
    var bags = [];
    var forge = spellforgeAssets();
    if (forge.length) bags.push(forge);
    if (state.pool.spells.length) bags.push(state.pool.spells);
    if (state.pool.generated.length) bags.push(state.pool.generated);
    bags.push(null);
    var bag = pick(bags);
    if (!bag) return paintingAsset(1 + ((Math.random() * 1000) | 0));
    return pick(bag);
  }

  function releaseImg(img) {
    if (img && img.close) {
      try {
        img.close();
      } catch (e) {}
    }
  }

  function nearestProp() {
    var best = null;
    var bestD = 1e9;
    var i;
    for (i = 0; i < state.props.length; i++) {
      var pr = state.props[i];
      var d = Math.abs(pr.x - state.person.x);
      if (d < bestD) {
        bestD = d;
        best = pr;
      }
    }
    return best;
  }

  function hitProp(nx, ny) {
    var i;
    for (i = state.props.length - 1; i >= 0; i--) {
      var pr = state.props[i];
      if (Math.abs(nx - pr.x) <= pr.hitX && Math.abs(ny - pr.y) <= pr.hitY) return pr;
    }
    return null;
  }

  function flipMood() {
    if (state.mood === "follow") {
      state.mood = "ignore";
      state.ignoreStyle = pick(["wander", "avoid", "sit"]);
      state.moodT = 3.5 + Math.random() * 8;
      if (Math.random() < 0.72)
        speak(pick(["Not following that.", "Slack the strings. I'm on my mark.", "Pointer's not talent. I am."]));
    } else {
      state.mood = "follow";
      state.moodT = 2.8 + Math.random() * 6;
      if (Math.random() < 0.72)
        speak(pick(["Alright. Pull. I'll follow.", "Cursor's the bar now.", "Lead the wires. I'll walk."]));
    }
  }

  function dressStage() {
    var token = ++state.setToken;
    setStatus("Dressing the stage…");
    return loadPool().then(function () {
      if (token !== state.setToken) return;
      var floor = pickAsset();
      var kinds = ["stand", "crate", "orb", "screen"];
      var spots = [
        { x: 0.2, y: 0.78, kind: kinds[0] },
        { x: 0.8, y: 0.79, kind: kinds[1] },
        { x: 0.34, y: 0.86, kind: kinds[2] },
        { x: 0.66, y: 0.7, kind: kinds[3] },
      ];
      var jobs = [
        fetchStill(floor.url).then(function (img) {
          return { slot: "floor", img: img, asset: floor };
        }),
      ];
      spots.forEach(function (sp, idx) {
        var asset = pickAsset();
        jobs.push(
          fetchStill(asset.url).then(function (img) {
            return { slot: "prop", idx: idx, img: img, asset: asset, spot: sp };
          })
        );
      });
      return Promise.all(
        jobs.map(function (j) {
          return j.catch(function () {
            return null;
          });
        })
      ).then(function (rows) {
        if (token !== state.setToken) return;
        releaseImg(state.floorImg);
        state.props.forEach(function (pr) {
          releaseImg(pr.img);
        });
        state.floorImg = null;
        state.props = [];
        rows.forEach(function (row) {
          if (!row || !row.img) return;
          if (row.slot === "floor") {
            state.floorImg = row.img;
          } else {
            var sp = row.spot;
            var kind = sp.kind;
            state.props.push({
              kind: kind,
              x: sp.x,
              y: sp.y,
              img: row.img,
              label: row.asset.label,
              source: row.asset.source,
              hitX: kind === "orb" ? 0.07 : 0.08,
              hitY: kind === "orb" ? 0.09 : 0.11,
              bob: Math.random() * 6,
            });
          }
        });
        setStatus("Set dressed. Wall stays a new Forge still — not a remake of your paintings.");
        if (Math.random() < 0.7)
          speak(
            pick([
              "New set. Paintings on the floor, Spellforge in the wings.",
              "Dressed the rectangle. Don't touch my props unless I say.",
              "Backdrop's live. Generated, painted, forged — all mine.",
            ])
          );
      });
    });
  }

  function loadSet() {
    return dressStage();
  }

  function stepPerson(dt) {
    var p = state.person;
    p.actionT -= dt;
    state.moodT -= dt;
    if (state.moodT <= 0) flipMood();

    if (p.action === "jump" || p.action === "flip") {
      var u = Math.max(0, Math.min(1, 1 - p.actionT / 1.15));
      p.hop = Math.sin(u * Math.PI) * 0.12;
      if (p.action === "flip") p.spin = u * Math.PI * 2;
    } else {
      p.hop *= Math.max(0, 1 - dt * 8);
      if (p.action !== "spin") p.spin *= Math.max(0, 1 - dt * 6);
    }
    if (p.action === "spin") p.spin += dt * 8;

    var special =
      p.action === "jump" ||
      p.action === "flip" ||
      p.action === "wave" ||
      p.action === "dance" ||
      p.action === "bow";
    var moving = false;

    if (!special) {
      if (state.targetProp) {
        var tx = state.targetProp.x;
        var dx = tx - p.x;
        if (Math.abs(dx) > 0.035) {
          p.facing = dx > 0 ? 1 : -1;
          p.vx = 0.17 * p.facing;
          p.action = "walk";
          moving = true;
        } else {
          p.vx = 0;
          p.x = tx;
          p.action = "idle";
          if (state.inspected !== state.targetProp) {
            state.inspected = state.targetProp;
            speak(
              pick([
                state.targetProp.label + ". That's the piece.",
                "This " + state.targetProp.source + " still has teeth.",
                "Don't knock it. " + state.targetProp.label + ".",
              ])
            );
            setTimeout(function () {
              if (state.targetProp === state.inspected) state.targetProp = null;
            }, 1800);
          }
        }
      } else if (state.mood === "follow" && state.cursor.inside) {
        var cx = state.cursor.x;
        var cdx = cx - p.x;
        if (Math.abs(cdx) > 0.028) {
          p.facing = cdx > 0 ? 1 : -1;
          p.vx = (Math.abs(cdx) > 0.22 ? 0.26 : 0.15) * p.facing;
          p.action = Math.abs(cdx) > 0.22 ? "run" : "walk";
          moving = true;
        } else {
          p.vx = 0;
          if (p.action === "walk" || p.action === "run") p.action = "idle";
          if (state.cursor.y < 0.32 && Math.random() < dt * 0.35) {
            p.action = "jump";
            p.actionT = 0.9;
          }
        }
      } else if (state.mood === "ignore" && state.cursor.inside && state.ignoreStyle === "avoid") {
        var adx = state.cursor.x - p.x;
        if (Math.abs(adx) < 0.16) {
          p.facing = adx > 0 ? -1 : 1;
          p.vx = 0.14 * p.facing;
          p.action = "walk";
          moving = true;
        }
      } else if (state.mood === "ignore" && state.ignoreStyle === "sit") {
        p.action = "sit";
        p.vx = 0;
      }
    }

    if (p.action === "walk" || p.action === "run" || moving) {
      var spd = p.action === "run" ? 0.28 : Math.abs(p.vx) || 0.09;
      p.x += (p.vx || spd * p.facing) * dt;
    }

    if (!special && !state.targetProp && !(state.mood === "follow" && state.cursor.inside) && p.actionT <= 0) {
      if (p.action === "sit" && state.ignoreStyle === "sit") {
        p.vx = 0;
      } else if (state.props.length && Math.random() < 0.18) {
        state.targetProp = pick(state.props);
        p.action = "walk";
        p.actionT = 2.5;
      } else {
        p.action = Math.random() < 0.45 ? "idle" : "walk";
        p.actionT = 1.2 + Math.random() * 2.4;
        if (p.action === "walk") {
          p.facing = Math.random() < 0.5 ? -1 : 1;
          p.vx = (0.07 + Math.random() * 0.08) * p.facing;
        } else p.vx = 0;
      }
    }

    var pad = 0.12;
    if (p.x < pad) {
      p.x = pad;
      p.facing = 1;
      p.vx = Math.abs(p.vx) || 0.1;
    }
    if (p.x > 1 - pad) {
      p.x = 1 - pad;
      p.facing = -1;
      p.vx = -(Math.abs(p.vx) || 0.1);
    }
    p.y = 0.82;
    var wantLimp =
      state.mood === "follow" && state.cursor.inside ? 0.12 : state.ignoreStyle === "sit" ? 0.72 : 0.48;
    p.headLag += (-p.vx * 1.4 - p.headLag) * Math.min(1, dt * 5);
    p.sway = Math.sin(state.t * 2.5) * (0.028 + state.limp * 0.09);
    state.limp += (wantLimp - state.limp) * Math.min(1, dt * 2.2);
  }

  function coverImage(ctx, img, x, y, w, h) {
    if (!img) return;
    var iw = img.width || img.naturalWidth || 0;
    var ih = img.height || img.naturalHeight || 0;
    if (!iw || !ih) return;
    x = Math.round(x);
    y = Math.round(y);
    w = Math.max(1, Math.round(w));
    h = Math.max(1, Math.round(h));
    var s = Math.max(w / iw, h / ih);
    var dw = iw * s;
    var dh = ih * s;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.drawImage(img, x + (w - dw) * 0.5, y + (h - dh) * 0.5, dw, dh);
    ctx.restore();
  }

  function drawCurtain(ctx, x, w, h, flip) {
    ctx.save();
    ctx.translate(x, 0);
    if (flip) {
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
    }
    var base = state.palette[1] || [90, 20, 36];
    var g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, rgbOf([Math.max(8, (base[0] * 0.35) | 0), Math.max(4, (base[1] * 0.25) | 0), Math.max(6, (base[2] * 0.3) | 0)]));
    g.addColorStop(0.35, rgbOf(base, 0.92));
    g.addColorStop(0.7, rgbOf([ (base[0] * 0.45) | 0, (base[1] * 0.35) | 0, (base[2] * 0.4) | 0 ]));
    g.addColorStop(1, "#12060a");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(w, 0);
    var i;
    for (i = 0; i <= 8; i++) {
      var yy = (h * i) / 8;
      var wave = Math.sin(i * 0.9) * w * 0.08;
      ctx.lineTo(w * 0.55 + wave, yy);
    }
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(212,168,74,0.28)";
    ctx.lineWidth = Math.max(1.5, w * 0.04);
    ctx.beginPath();
    ctx.moveTo(w * 0.08, 0);
    ctx.quadraticCurveTo(w * 0.4, h * 0.12, w * 0.18, h * 0.22);
    ctx.stroke();
    ctx.restore();
  }

  function drawSet(ctx, w, h, now) {
    ctx.fillStyle = "#08060a";
    ctx.fillRect(0, 0, w, h);
    var wallH = h * 0.62;
    var wf = wallFrac();
    var wx = Math.round(w * wf.x);
    var wy = Math.round(h * wf.y);
    var ww = Math.round(w * wf.w);
    var wh = Math.round(h * wf.h);
    if (state.setImg) {
      ctx.save();
      coverImage(ctx, state.setImg, wx, wy, ww, wh);
      ctx.restore();
    } else {
      ctx.fillStyle = "#121018";
      ctx.fillRect(wx, wy, ww, wh);
      ctx.fillStyle = "rgba(212,168,74,0.45)";
      ctx.font = "600 " + Math.max(11, w * 0.032) + "px Georgia, serif";
      ctx.textAlign = "center";
      ctx.fillText("Forge a new still", wx + ww * 0.5, wy + wh * 0.5);
    }
    ctx.strokeStyle = rgbOf(state.palette[0] || [212, 168, 74], 0.7);
    ctx.lineWidth = Math.max(2, w * 0.008);
    ctx.strokeRect(wx, wy, ww, wh);
    if (state.floorImg) {
      ctx.save();
      ctx.globalAlpha = 0.55;
      coverImage(ctx, state.floorImg, 0, wallH, w, h - wallH);
      ctx.restore();
      ctx.fillStyle = "rgba(10,8,6,0.42)";
      ctx.fillRect(0, wallH, w, h - wallH);
    } else {
      ctx.fillStyle = "#16100c";
      ctx.fillRect(0, wallH, w, h - wallH);
    }
    var vanishX = w * 0.5;
    var vanishY = wallH - h * 0.02;
    ctx.strokeStyle = "rgba(90,70,48,0.35)";
    ctx.lineWidth = Math.max(1, state.dpr);
    var i;
    for (i = -8; i <= 8; i++) {
      ctx.beginPath();
      ctx.moveTo(vanishX + i * w * 0.09, h);
      ctx.lineTo(vanishX, vanishY);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(212,168,74,0.12)";
    for (i = 1; i <= 6; i++) {
      var fy = wallH + Math.pow(i / 6, 1.6) * (h - wallH);
      ctx.beginPath();
      ctx.moveTo(0, fy);
      ctx.lineTo(w, fy);
      ctx.stroke();
    }
    var px = state.person.x * w;
    var py = h * 0.82;
    var spot = ctx.createRadialGradient(px, py, 8, px, py - h * 0.22, w * 0.42);
    spot.addColorStop(0, "rgba(255,236,190,0.34)");
    spot.addColorStop(0.45, "rgba(255,200,90,0.08)");
    spot.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = spot;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "rgba(255,220,140,0.16)";
    ctx.beginPath();
    ctx.ellipse(px, py + h * 0.01, w * 0.12, h * 0.018, 0, 0, Math.PI * 2);
    ctx.fill();
    drawCurtain(ctx, 0, w * 0.16, h, false);
    drawCurtain(ctx, w * 0.84, w * 0.16, h, true);
    ctx.fillStyle = "#2a0c14";
    ctx.fillRect(0, 0, w, h * 0.045);
    var lx;
    for (lx = 0.18; lx <= 0.82; lx += 0.16) {
      var pulse = 0.55 + Math.sin(now * 3 + lx * 8) * 0.25;
      ctx.fillStyle = rgbOf(state.palette[0] || [255, 210, 120], pulse);
      ctx.beginPath();
      ctx.arc(w * lx, h * 0.038, Math.max(3, w * 0.012), 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,230,160,0.12)";
      ctx.beginPath();
      ctx.moveTo(w * lx, h * 0.04);
      ctx.lineTo(w * lx, h * 0.28);
      ctx.stroke();
    }
  }

  function containImage(ctx, img, x, y, rw, rh) {
    if (!img) return;
    var iw = img.width || img.naturalWidth || 0;
    var ih = img.height || img.naturalHeight || 0;
    if (!iw || !ih) return;
    var s = Math.min(rw / iw, rh / ih);
    var dw = iw * s;
    var dh = ih * s;
    ctx.drawImage(img, x + (rw - dw) * 0.5, y + (rh - dh) * 0.5, dw, dh);
  }

  function drawProp(ctx, pr, w, h, now) {
    var px = pr.x * w;
    var py = pr.y * h;
    var short = Math.min(w, h);
    var float = pr.kind === "orb" ? Math.sin(now * 2.2 + pr.bob) * short * 0.012 : 0;
    ctx.save();
    ctx.translate(px, py - float);
    if (pr.kind === "orb") {
      var or = short * 0.055;
      ctx.beginPath();
      ctx.arc(0, -or, or, 0, Math.PI * 2);
      ctx.fillStyle = "#0a0a0c";
      ctx.fill();
      ctx.save();
      ctx.beginPath();
      ctx.arc(0, -or, or * 0.92, 0, Math.PI * 2);
      ctx.clip();
      containImage(ctx, pr.img, -or, -or * 2, or * 2, or * 2);
      ctx.restore();
      ctx.strokeStyle = rgbOf(state.palette[0] || [212, 168, 74], 0.85);
      ctx.lineWidth = Math.max(2, short * 0.006);
      ctx.beginPath();
      ctx.arc(0, -or, or, 0, Math.PI * 2);
      ctx.stroke();
    } else if (pr.kind === "crate") {
      var cw = short * 0.09;
      var ch = short * 0.08;
      ctx.fillStyle = "#1a1612";
      ctx.fillRect(-cw * 0.5, -ch, cw, ch);
      containImage(ctx, pr.img, -cw * 0.42, -ch * 0.92, cw * 0.84, ch * 0.84);
      ctx.strokeStyle = rgbOf(state.palette[0] || [201, 162, 39], 0.7);
      ctx.strokeRect(-cw * 0.5, -ch, cw, ch);
    } else if (pr.kind === "screen") {
      var sw = short * 0.13;
      var sh = short * 0.09;
      ctx.fillStyle = "#111218";
      ctx.fillRect(-sw * 0.5, -sh - short * 0.04, sw, sh);
      containImage(ctx, pr.img, -sw * 0.46, -sh - short * 0.036, sw * 0.92, sh * 0.88);
      ctx.fillStyle = "#2a2a32";
      ctx.fillRect(-short * 0.01, -short * 0.04, short * 0.02, short * 0.04);
    } else {
      var fw = short * 0.11;
      var fh = short * 0.14;
      ctx.fillStyle = rgbOf(state.palette[0] || [180, 140, 60]);
      ctx.fillRect(-fw * 0.5 - 3, -fh - 3, fw + 6, fh + 6);
      ctx.fillStyle = "#0c0c10";
      ctx.fillRect(-fw * 0.5, -fh, fw, fh);
      containImage(ctx, pr.img, -fw * 0.5, -fh, fw, fh);
      ctx.fillStyle = "#2a241c";
      ctx.fillRect(-2, 0, 4, short * 0.06);
    }
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.font = Math.max(8, short * 0.018) + "px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(pr.source, 0, short * 0.055);
    ctx.restore();
  }

  function limb(ctx, x0, y0, x1, y1, width, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }

  function drawMic(ctx, x, y, s, ang) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang || 0);
    ctx.fillStyle = "#c9a227";
    ctx.beginPath();
    ctx.ellipse(0, -s * 0.09, s * 0.055, s * 0.08, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#2a2c34";
    ctx.fillRect(-s * 0.018, 0, s * 0.036, s * 0.16);
    ctx.fillStyle = "#d4a84a";
    ctx.fillRect(-s * 0.03, s * 0.05, s * 0.06, s * 0.02);
    ctx.restore();
  }

  function drawPerson(ctx, w, h, now) {
    var p = state.person;
    var short = Math.min(w, h);
    var s = short * 0.26;
    var x = p.x * w;
    var y = p.y * h - p.hop * h;
    var walk = p.action === "walk" || p.action === "run";
    var tempo = p.action === "run" ? 15 : 8.2;
    var phase = walk ? Math.sin(now * tempo) : p.action === "dance" ? Math.sin(now * 9) : 0;
    var bob = walk ? Math.abs(Math.sin(now * tempo)) * s * 0.035 : 0;
    if (p.action === "sit") bob = s * 0.16;
    if (p.action === "idle") bob = Math.sin(now * 2.2) * s * 0.012;
    var lean = (walk ? phase * 0.06 : 0) + (p.sway || 0);
    var limp = state.limp || 0.4;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(p.spin + lean);
    ctx.scale(p.facing, 1);
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.beginPath();
    ctx.ellipse(0, s * 0.02, s * 0.2, s * 0.045, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.translate(0, -bob);
    var sit = p.action === "sit";
    var floppy = limp * s * 0.08;
    var lag = (p.headLag || 0) * s;
    var kneeL = sit ? -s * 0.06 : -s * 0.08 + phase * s * 0.08;
    var kneeR = sit ? -s * 0.06 : -s * 0.08 - phase * s * 0.08;
    var legL = sit ? s * 0.02 : s * 0.02 + phase * s * 0.22 + floppy;
    var legR = sit ? s * 0.02 : s * 0.02 - phase * s * 0.22 + floppy;
    limb(ctx, -s * 0.05, -s * 0.2, -s * 0.07, kneeL, s * 0.07, "#14161c");
    limb(ctx, -s * 0.07, kneeL, -s * 0.09, legL, s * 0.068, "#14161c");
    limb(ctx, s * 0.05, -s * 0.2, s * 0.07, kneeR, s * 0.07, "#14161c");
    limb(ctx, s * 0.07, kneeR, s * 0.09, legR, s * 0.068, "#14161c");
    ctx.fillStyle = "#c9a227";
    ctx.beginPath();
    ctx.arc(-s * 0.07, kneeL, s * 0.018, 0, Math.PI * 2);
    ctx.arc(s * 0.07, kneeR, s * 0.018, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#0c0d10";
    ctx.beginPath();
    ctx.ellipse(-s * 0.08, legL, s * 0.07, s * 0.028, 0, 0, Math.PI * 2);
    ctx.ellipse(s * 0.08, legR, s * 0.07, s * 0.028, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#12141a";
    ctx.beginPath();
    ctx.moveTo(-s * 0.13, -s * 0.5);
    ctx.lineTo(s * 0.13, -s * 0.5);
    ctx.lineTo(s * 0.15, -s * 0.2);
    ctx.lineTo(-s * 0.15, -s * 0.2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#f4f0e6";
    ctx.beginPath();
    ctx.moveTo(-s * 0.04, -s * 0.5);
    ctx.lineTo(s * 0.04, -s * 0.5);
    ctx.lineTo(0, -s * 0.28);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#c9a227";
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.49);
    ctx.lineTo(s * 0.028, -s * 0.3);
    ctx.lineTo(0, -s * 0.27);
    ctx.lineTo(-s * 0.028, -s * 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#0a0b10";
    ctx.beginPath();
    ctx.moveTo(-s * 0.145, -s * 0.52);
    ctx.lineTo(-s * 0.02, -s * 0.5);
    ctx.lineTo(-s * 0.05, -s * 0.22);
    ctx.lineTo(-s * 0.17, -s * 0.24);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(s * 0.145, -s * 0.52);
    ctx.lineTo(s * 0.02, -s * 0.5);
    ctx.lineTo(s * 0.05, -s * 0.22);
    ctx.lineTo(s * 0.17, -s * 0.24);
    ctx.closePath();
    ctx.fill();
    var wave = p.action === "wave";
    var talk = state.talking || (state.say && state.t < state.sayUntil);
    var armL = p.action === "dance" ? -s * 0.42 + Math.sin(now * 10) * s * 0.1 : s * 0.14 * phase;
    var armR = wave
      ? -s * 0.55 + Math.sin(now * 13) * s * 0.1
      : talk
        ? -s * 0.18
        : -s * 0.14 * phase;
    var elLx = -s * 0.16;
    var elLy = -s * 0.34 + armL * 0.45 + floppy;
    var elRx = s * 0.16;
    var elRy = -s * 0.34 + armR * 0.45 + floppy;
    var handLx = -s * 0.24;
    var handLy = -s * 0.26 + armL;
    var handRx = wave ? s * 0.24 : s * 0.22;
    var handRy = wave ? -s * 0.74 + Math.sin(now * 13) * s * 0.08 : talk ? -s * 0.6 : -s * 0.26 + armR;
    limb(ctx, -s * 0.12, -s * 0.48, elLx, elLy, s * 0.052, "#0a0b10");
    limb(ctx, elLx, elLy, handLx, handLy, s * 0.05, "#0a0b10");
    limb(ctx, s * 0.12, -s * 0.48, elRx, elRy, s * 0.052, "#0a0b10");
    limb(ctx, elRx, elRy, handRx, handRy, s * 0.05, "#0a0b10");
    ctx.fillStyle = "#c9a227";
    ctx.beginPath();
    ctx.arc(elLx, elLy, s * 0.016, 0, Math.PI * 2);
    ctx.arc(elRx, elRy, s * 0.016, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#e2b496";
    ctx.beginPath();
    ctx.arc(handLx, handLy, s * 0.035, 0, Math.PI * 2);
    ctx.arc(handRx, handRy, s * 0.035, 0, Math.PI * 2);
    ctx.fill();
    drawMic(ctx, handRx, talk ? -s * 0.64 : handRy - s * 0.02, s, talk ? -0.55 : 0.35);
    ctx.save();
    ctx.translate(lag, -s * 0.02);
    ctx.rotate(-lag * 0.015);
    ctx.fillStyle = "#e6c0a6";
    ctx.beginPath();
    ctx.ellipse(0, -s * 0.68, s * 0.115, s * 0.135, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#1a1410";
    ctx.beginPath();
    ctx.ellipse(-s * 0.01, -s * 0.74, s * 0.13, s * 0.1, -0.15, Math.PI * 1.05, Math.PI * 1.95);
    ctx.fill();
    ctx.fillStyle = "#2a2018";
    ctx.fillRect(-s * 0.07, -s * 0.66, s * 0.055, s * 0.018);
    ctx.fillRect(s * 0.02, -s * 0.66, s * 0.055, s * 0.018);
    ctx.fillStyle = "#1a120e";
    ctx.beginPath();
    if (talk) {
      ctx.ellipse(0, -s * 0.595, s * 0.038, s * 0.028, 0, 0, Math.PI * 2);
    } else {
      ctx.ellipse(0, -s * 0.61, s * 0.03, s * 0.012, 0, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.fillStyle = "#f2f6ff";
    ctx.beginPath();
    ctx.arc(-s * 0.042, -s * 0.675, s * 0.016, 0, Math.PI * 2);
    ctx.arc(s * 0.048, -s * 0.675, s * 0.016, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#1a1a1a";
    ctx.beginPath();
    ctx.arc(-s * 0.04, -s * 0.675, s * 0.007, 0, Math.PI * 2);
    ctx.arc(s * 0.05, -s * 0.675, s * 0.007, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#c9a227";
    ctx.beginPath();
    ctx.arc(s * 0.1, -s * 0.63, s * 0.018, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(201,162,39,0.7)";
    ctx.lineWidth = Math.max(1, s * 0.012);
    ctx.beginPath();
    ctx.arc(s * 0.11, -s * 0.62, s * 0.04, 0.2, 1.4);
    ctx.stroke();
    ctx.fillStyle = "#c9a227";
    ctx.beginPath();
    ctx.arc(0, -s * 0.82, s * 0.02, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    function toWorld(lx, ly) {
      var px = lx * p.facing;
      var py = ly - bob;
      var ang = p.spin + lean;
      var ca = Math.cos(ang);
      var sa = Math.sin(ang);
      return { x: x + px * ca - py * sa, y: y + px * sa + py * ca };
    }
    var headW = toWorld(lag, -s * 0.82);
    var hlW = toWorld(handLx, handLy);
    var hrW = toWorld(handRx, handRy);
    var klW = toWorld(-s * 0.07, kneeL);
    var krW = toWorld(s * 0.07, kneeR);
    state.attach = {
      head: headW,
      handL: hlW,
      handR: hrW,
      kneeL: klW,
      kneeR: krW,
      bar: s,
    };
    ctx.restore();
    if (state.say && state.t < state.sayUntil) {
      var bx = x;
      var by = y - s * 1.05 - bob;
      var tw = Math.min(w * 0.55, 240 * state.dpr);
      var th = s * 0.22;
      ctx.fillStyle = "rgba(255,252,245,0.94)";
      ctx.beginPath();
      ctx.moveTo(bx - tw * 0.5 + 8, by - th);
      ctx.lineTo(bx + tw * 0.5 - 8, by - th);
      ctx.quadraticCurveTo(bx + tw * 0.5, by - th, bx + tw * 0.5, by - th + 8);
      ctx.lineTo(bx + tw * 0.5, by - 8);
      ctx.quadraticCurveTo(bx + tw * 0.5, by, bx + tw * 0.5 - 8, by);
      ctx.lineTo(bx + 8, by);
      ctx.lineTo(bx, by + th * 0.28);
      ctx.lineTo(bx - 8, by);
      ctx.lineTo(bx - tw * 0.5 + 8, by);
      ctx.quadraticCurveTo(bx - tw * 0.5, by, bx - tw * 0.5, by - 8);
      ctx.lineTo(bx - tw * 0.5, by - th + 8);
      ctx.quadraticCurveTo(bx - tw * 0.5, by - th, bx - tw * 0.5 + 8, by - th);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#16120e";
      ctx.font = "600 " + Math.max(11, s * 0.09) + "px Georgia, serif";
      ctx.textAlign = "center";
      ctx.fillText(state.say.slice(0, 32), bx, by - th * 0.38, tw - 16);
    }
  }

  function drawStrings(ctx, w, h, now) {
    var a = state.attach;
    if (!a || !a.head) return;
    var s = a.bar || Math.min(w, h) * 0.26;
    var slack = 8 + state.limp * 22;
    var barY = h * 0.032;
    var barX = a.head.x;
    if (state.mood === "follow" && state.cursor.inside) {
      barX = a.head.x * 0.55 + state.cursor.x * w * 0.45;
    }
    var half = s * 0.28;
    ctx.strokeStyle = "#6a4420";
    ctx.lineWidth = Math.max(3, s * 0.04);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(barX - half, barY);
    ctx.lineTo(barX + half, barY);
    ctx.stroke();
    ctx.fillStyle = "#3a2410";
    ctx.fillRect(barX - s * 0.03, 0, s * 0.06, barY + 2);
    ctx.fillStyle = "#c9a227";
    ctx.beginPath();
    ctx.arc(barX - half, barY, s * 0.025, 0, Math.PI * 2);
    ctx.arc(barX + half, barY, s * 0.025, 0, Math.PI * 2);
    ctx.arc(barX, barY, s * 0.022, 0, Math.PI * 2);
    ctx.fill();
    function stringTo(x0, y0, pt, phase) {
      if (!pt) return;
      var mx = (x0 + pt.x) * 0.5 + Math.sin(now * 3.2 + phase) * slack;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.quadraticCurveTo(mx, (y0 + pt.y) * 0.5, pt.x, pt.y);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(232, 214, 160, 0.62)";
    ctx.lineWidth = Math.max(1, s * 0.012);
    stringTo(barX, barY, a.head, 0);
    stringTo(barX - half * 0.72, barY, a.handL, 1.2);
    stringTo(barX + half * 0.72, barY, a.handR, 2.1);
    stringTo(barX - half * 0.35, barY, a.kneeL, 3);
    stringTo(barX + half * 0.35, barY, a.kneeR, 4);
  }

  function draw(now) {
    var canvas = $("lv-canvas");
    if (!canvas) return;
    var ctx = canvas.getContext("2d");
    var w = canvas.width;
    var h = canvas.height;
    drawSet(ctx, w, h, now);
    var ordered = state.props.slice().sort(function (a, b) {
      return a.y - b.y;
    });
    var hostDrawn = false;
    var i;
    for (i = 0; i < ordered.length; i++) {
      if (!hostDrawn && ordered[i].y > state.person.y) {
        drawPerson(ctx, w, h, now);
        hostDrawn = true;
      }
      drawProp(ctx, ordered[i], w, h, now);
    }
    if (!hostDrawn) drawPerson(ctx, w, h, now);
    drawStrings(ctx, w, h, now);
    if (state.mood === "follow" && state.cursor.inside) {
      ctx.fillStyle = "rgba(255,230,160,0.2)";
      ctx.beginPath();
      ctx.arc(state.cursor.x * w, state.cursor.y * h, Math.max(6, w * 0.018), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function renderChat() {
    if (!state.chatDirty) return;
    state.chatDirty = false;
    var el = $("lv-comments");
    if (!el) return;
    el.innerHTML = state.comments
      .map(function (c) {
        return (
          '<div class="lv-cmt' +
          (c.role === "assistant" ? " host" : "") +
          (c.rude ? " rude" : "") +
          '"><b>' +
          escapeHtml(c.user) +
          "</b> " +
          escapeHtml(c.text) +
          "</div>"
        );
      })
      .join("");
  }

  function renderGifts() {
    if (!state.giftDirty) return;
    state.giftDirty = false;
    var el = $("lv-gifts");
    if (!el) return;
    var now = state.t;
    el.innerHTML = state.gifts
      .filter(function (g) {
        return now - g.t < 4.5;
      })
      .map(function (g) {
        return (
          '<div class="lv-gift">@' +
          escapeHtml(g.user) +
          " · " +
          escapeHtml(g.name) +
          " +" +
          g.coins +
          "</div>"
        );
      })
      .join("");
  }

  function renderMod() {
    if (!state.modDirty) return;
    state.modDirty = false;
    var el = $("lv-mod");
    if (!el) return;
    if (!state.reports.length) {
      el.textContent = "No reports yet. Rude chat is auto-flagged; tap report on a comment.";
      return;
    }
    el.innerHTML = state.reports
      .slice(0, 16)
      .map(function (r) {
        return (
          "<div><b>@" +
          escapeHtml(r.user) +
          "</b> · " +
          escapeHtml(r.how) +
          "<br>" +
          escapeHtml(r.text) +
          "</div>"
        );
      })
      .join("");
  }

  function renderHud() {
    var badge = $("lv-badge");
    if (badge) {
      badge.textContent = state.tt.connected ? "LIVE" : state.live ? "ON AIR" : "OFF";
      badge.classList.toggle("off", !state.tt.connected && !state.live);
    }
    var v = $("lv-viewers");
    if (v) {
      v.textContent = state.tt.connected
        ? (state.tt.viewers ? Math.round(state.tt.viewers).toLocaleString() + " watching" : "@" + state.tt.uniqueId)
        : state.tt.connecting
          ? "Connecting…"
          : "Not on TikTok";
    }
    var likes = $("lv-likes");
    if (likes) likes.textContent = state.tt.likes ? Math.round(state.tt.likes).toLocaleString() + " likes" : "";
    var ttBtn = $("lv-tt-connect");
    if (ttBtn) {
      ttBtn.textContent = state.tt.connected || state.tt.connecting ? "Disconnect TikTok" : "Connect TikTok Live";
      ttBtn.classList.toggle("live", !!state.tt.connected);
    }
    var clock = $("lv-clock");
    if (clock) clock.textContent = fmtClock(state.live ? state.elapsed : 0);
    var go = $("lv-go");
    if (go) {
      go.textContent = state.live ? "End live" : "Go live";
      go.classList.toggle("live", state.live);
    }
    var cap = $("lv-caption");
    if (cap && state.t > state.sayUntil) cap.textContent = "";
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function tick(nowMs) {
    if (!state.running) return;
    var now = nowMs * 0.001;
    var dt = state.last ? Math.min(0.05, now - state.last) : 0.016;
    state.last = now;
    state.t += dt;
    if (state.live) state.elapsed += dt * 1000;
    simTick(dt);
    stepTalk(dt);
    stepPerson(dt);
    if (state.gifts.length) {
      var keep = state.gifts.filter(function (g) {
        return state.t - g.t < 4.5;
      });
      if (keep.length !== state.gifts.length) {
        state.gifts = keep;
        state.giftDirty = true;
      }
    }
    draw(state.t);
    renderChat();
    renderGifts();
    renderMod();
    renderHud();
    state.raf = requestAnimationFrame(tick);
  }

  function startLoop() {
    if (state.running) return;
    state.running = true;
    state.last = 0;
    state.raf = requestAnimationFrame(tick);
  }

  function stopLoop() {
    state.running = false;
    if (state.raf) cancelAnimationFrame(state.raf);
    state.raf = 0;
  }

  function toggleLive() {
    state.live = !state.live;
    if (state.live) {
      state.startedAt = Date.now();
      state.nextBanterAt = 8;
      state.voice = chooseVoice();
      speak("On camera. Connect TikTok Live and I'll talk to the real room.", null, {
        cut: true,
      });
      setStatus("Camera on. Connect your TikTok LIVE so real chat drives the host.");
    } else {
      hush();
      setStatus("Live ended · " + fmtClock(state.elapsed));
    }
    renderHud();
  }

  function inject() {
    var nameIn = $("lv-user");
    var textIn = $("lv-inject");
    var user = (nameIn && nameIn.value.trim()) || "you";
    var text = (textIn && textIn.value.trim()) || "";
    if (!text) {
      setStatus("Type a comment to send into the camera.");
      return;
    }
    if (textIn) textIn.value = "";
    if (window.StudioChat && typeof window.StudioChat.sendText === "function") {
      var ok = window.StudioChat.sendText(text);
      if (ok === false) {
        pushComment(user, text, { cut: true });
        setStatus("Chat is busy — sent to the host only.");
      } else {
        setStatus("Sent through Chat.");
      }
      return;
    }
    pushComment(user, text, { cut: true });
  }

  function bind() {
    if (!$("panel-live")) return;
    load();
    var sel = $("lv-aspect");
    if (sel) {
      sel.value = state.aspect;
      sel.addEventListener("change", function () {
        state.aspect = sel.value || "9:16";
        save();
        layout();
      });
    }
    var ttIn = $("lv-tiktok");
    if (ttIn && state.tt.uniqueId) ttIn.value = state.tt.uniqueId;
    $("lv-tt-connect") &&
      $("lv-tt-connect").addEventListener("click", function () {
        if (state.tt.connected || state.tt.connecting || state.tt.wanted) disconnectTikTok();
        else connectTikTok();
      });
    $("lv-go") && $("lv-go").addEventListener("click", toggleLive);
    $("lv-mute") &&
      $("lv-mute").addEventListener("click", function () {
        state.muted = !state.muted;
        if (state.muted) hush();
        $("lv-mute").textContent = state.muted ? "Unmute host" : "Mute host";
        setStatus(state.muted ? "Host muted." : "Host mic on.");
      });
    if (window.speechSynthesis) {
      speechSynthesis.addEventListener("voiceschanged", function () {
        state.voice = chooseVoice();
      });
    }
    $("lv-set") &&
      $("lv-set").addEventListener("click", function () {
        loadSet();
      });
    $("lv-send") && $("lv-send").addEventListener("click", inject);
    $("lv-inject") &&
      $("lv-inject").addEventListener("keydown", function (ev) {
        if (ev.key === "Enter" && !ev.shiftKey) {
          ev.preventDefault();
          inject();
        }
      });
    document.querySelectorAll("[data-lv-gift]").forEach(function (b) {
      b.addEventListener("click", function () {
        var id = b.getAttribute("data-lv-gift");
        var g = GIFTS.filter(function (x) {
          return x.id === id;
        })[0];
        var user = "you";
        thankGift(user, g || GIFTS[0]);
      });
    });
    var comments = $("lv-comments");
    if (comments) {
      comments.addEventListener("click", function (ev) {
        var btn = ev.target && ev.target.closest && ev.target.closest("[data-report]");
        if (!btn) return;
        var id = btn.getAttribute("data-report");
        var row = state.comments.filter(function (c) {
          return String(c.id) === String(id);
        })[0];
        if (row) {
          report(row, "tap");
          speak("Reported @" + row.user + ". Keep it kind in my camera.", null, { cut: true });
        }
      });
    }
    var cam = $("lv-camera");
    if (cam) {
      function camPoint(ev) {
        var rect = cam.getBoundingClientRect();
        return {
          x: (ev.clientX - rect.left) / Math.max(1, rect.width),
          y: (ev.clientY - rect.top) / Math.max(1, rect.height),
        };
      }
      function inWall(pt) {
        var r = wallFrac();
        return pt.x >= r.x && pt.x <= r.x + r.w && pt.y >= r.y && pt.y <= r.y + r.h;
      }
      function cursorAt(ev) {
        var pt = camPoint(ev);
        if (
          inWall(pt) ||
          (ev.target && ev.target.closest && ev.target.closest(".lv-slot"))
        ) {
          state.cursor.inside = false;
          return pt;
        }
        state.cursor.x = pt.x;
        state.cursor.y = pt.y;
        state.cursor.inside = true;
        return pt;
      }
      cam.addEventListener("pointermove", cursorAt);
      cam.addEventListener("pointerleave", function () {
        state.cursor.inside = false;
      });
      cam.addEventListener("pointerdown", function (ev) {
        if (
          ev.target &&
          ev.target.closest &&
          (ev.target.closest("#lv-book") || ev.target.closest(".lv-prompt-bar"))
        )
          return;
        var pt = cursorAt(ev);
        if (inWall(pt)) return;
        var pr = hitProp(state.cursor.x, state.cursor.y);
        if (pr) {
          state.targetProp = pr;
          state.inspected = null;
          if (state.mood === "ignore" && Math.random() < 0.45) {
            speak(pick(["That's scenery. I'm the show.", "Not walking over for a pointer."]));
            state.targetProp = null;
          }
          return;
        }
        if (state.mood === "ignore" && Math.random() < 0.5) {
          speak(pick(["I'm not a cursor pet.", "Ask in chat. The pointer's optional."]));
          return;
        }
        state.person.facing = state.cursor.x >= state.person.x ? 1 : -1;
        state.person.vx = 0.18 * state.person.facing;
        state.person.action = "walk";
        state.person.actionT = 1.4;
      });
    }
    $("lv-forge-gen") && $("lv-forge-gen").addEventListener("click", forgeOnWall);
    var livePrompt = $("lv-prompt");
    if (livePrompt) {
      livePrompt.value = state.livePrompt || "";
      livePrompt.addEventListener("input", function () {
        state.livePrompt = String(livePrompt.value || "");
        save();
      });
      livePrompt.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter") {
          ev.preventDefault();
          forgeOnWall();
        }
      });
      livePrompt.addEventListener("pointerdown", function (ev) {
        ev.stopPropagation();
      });
    }
    $("lv-book-open") &&
      $("lv-book-open").addEventListener("click", function () {
        openBook(state.forgeSlot | 0);
      });
    $("lv-book-close") && $("lv-book-close").addEventListener("click", closeBook);
    $("lv-book-prev") &&
      $("lv-book-prev").addEventListener("click", function () {
        state.bookPage = (state.bookPage - 1 + bookPageCount()) % bookPageCount();
        renderBook();
      });
    $("lv-book-next") &&
      $("lv-book-next").addEventListener("click", function () {
        state.bookPage = (state.bookPage + 1) % bookPageCount();
        renderBook();
      });
    $("lv-book-rand-page") && $("lv-book-rand-page").addEventListener("click", randomBookPage);
    $("lv-book-rand-pick") && $("lv-book-rand-pick").addEventListener("click", randomBookPick);
    $("lv-book-grid") &&
      $("lv-book-grid").addEventListener("click", function (ev) {
        var tile = ev.target.closest && ev.target.closest(".lv-book-tile");
        if (!tile) return;
        chooseBookSpell(tile.getAttribute("data-num"));
      });
    var slotsEl = $("lv-slots");
    if (slotsEl) {
      slotsEl.addEventListener("click", function (ev) {
        var nav = ev.target.closest && ev.target.closest(".lv-slot-nav");
        var btn = ev.target.closest && ev.target.closest(".lv-slot");
        if (!btn) return;
        ev.stopPropagation();
        var i = parseInt(btn.getAttribute("data-slot"), 10);
        state.forgeSlot = i;
        if (nav) {
          stepForgeSlot(i, parseInt(nav.getAttribute("data-dir"), 10) || 1);
          return;
        }
        openBook(i);
      });
      slotsEl.addEventListener("dblclick", function (ev) {
        var btn = ev.target.closest && ev.target.closest(".lv-slot");
        if (!btn) return;
        ev.stopPropagation();
        pickForgeSlotNumber(parseInt(btn.getAttribute("data-slot"), 10));
      });
    }
    window.addEventListener("spellforge-fusion", function (e) {
      var d = e.detail || {};
      if (d.visionUrl && isProductStillUrl(d.visionUrl)) {
        hangWall(d.visionUrl, "Wall: new Spellforge product").catch(function () {});
      }
    });
    window.addEventListener("resize", function () {
      if (!state.ready) return;
      layout();
    });
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) stopLoop();
      else if (state.ready && document.body.classList.contains("lv-tab-active")) startLoop();
    });
  }

  function onShow() {
    document.body.classList.add("lv-tab-active");
    state.ready = true;
    layout();
    startLoop();
    state.forgeSlots = readForgeSlots();
    renderForgeSlots();
    if ($("lv-prompt") && state.livePrompt) $("lv-prompt").value = state.livePrompt;
    loadLastVision();
    loadPool().then(function () {
      renderForgeSlots();
      if ($("lv-book") && $("lv-book").classList.contains("on")) renderBook();
      if (!state.setImg && !state.props.length) dressStage();
    });
    if (state.tt.wanted && !state.tt.timer) state.tt.timer = setInterval(pollTikTok, 700);
    setStatus("Enter the TikTok @ that's live, then Connect. Real comments move the host.");
  }

  function onHide() {
    document.body.classList.remove("lv-tab-active");
    hush();
    stopLoop();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }

  window.addEventListener("live-show", onShow);
  window.addEventListener("live-hide", onHide);
  window.addEventListener("tab-changed", function (e) {
    if (e.detail && e.detail.tab === "live") onShow();
    else onHide();
  });

  window.LiveShow = { onShow: onShow, onHide: onHide };
})();
