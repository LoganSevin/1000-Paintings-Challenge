/**
 * Brush Dash — free-roam combat arena.
 * Move left/right, shoot with spells; backdrop is your gallery paintings.
 * Offline / no credits for combat. Images load from local gallery data only.
 */
(function () {
  "use strict";

  const HS_KEY = "gallery-brush-dash-highscore-v3";
  const LOADOUT_KEY = "gallery-brush-dash-loadout-v1";
  const W = 960;
  const H = 540;
  const GROUND_Y = 470;
  const GRAVITY = 2400;
  const JUMP_V = -780;
  const DOUBLE_JUMP_V = -680;
  const MOVE_SPEED = 320;
  const MAX_LOADOUT = 3;
  const BG_PANELS = 6;
  const FETCH_TIMEOUT_MS = 180000;
  const POLL_INTERVAL_MS = 1500;
  const REF_MAX_SIDE = 1024;
  const REF_QUALITY = 0.88;
  const BOSS_HP_BASE = 220;

  const SPELLS = {
    bolt: {
      id: "bolt",
      name: "Pigment Bolt",
      short: "Bolt",
      icon: "●",
      color: "#6eb0e8",
      desc: "Fast single shot. Low cooldown.",
      cooldown: 0.22,
      pattern: "single",
      speed: 620,
      damage: 12,
      life: 1.4,
      size: 6,
      pierce: 0,
      spread: 0,
      count: 1,
      homing: 0,
    },
    fan: {
      id: "fan",
      name: "Brush Fan",
      short: "Fan",
      icon: "≪",
      color: "#a8e070",
      desc: "Three-way spray. Good for packs.",
      cooldown: 0.48,
      pattern: "fan",
      speed: 520,
      damage: 9,
      life: 1.1,
      size: 5,
      pierce: 0,
      spread: 0.28,
      count: 3,
      homing: 0,
    },
    frame: {
      id: "frame",
      name: "Gold Frame",
      short: "Frame",
      icon: "▣",
      color: "#e8c060",
      desc: "Heavy shot. Pierces one enemy.",
      cooldown: 0.55,
      pattern: "single",
      speed: 480,
      damage: 28,
      life: 1.6,
      size: 10,
      pierce: 1,
      spread: 0,
      count: 1,
      homing: 0,
    },
    seek: {
      id: "seek",
      name: "Seeking Stain",
      short: "Seek",
      icon: "◎",
      color: "#c878e8",
      desc: "Homes in on nearest foe.",
      cooldown: 0.4,
      pattern: "single",
      speed: 400,
      damage: 14,
      life: 2.2,
      size: 7,
      pierce: 0,
      spread: 0,
      count: 1,
      homing: 4.2,
    },
    splash: {
      id: "splash",
      name: "Ink Splash",
      short: "Splash",
      icon: "✱",
      color: "#e07090",
      desc: "Short-range burst of 5 blobs.",
      cooldown: 0.7,
      pattern: "burst",
      speed: 380,
      damage: 8,
      life: 0.55,
      size: 8,
      pierce: 0,
      spread: 0.55,
      count: 5,
      homing: 0,
    },
    beam: {
      id: "beam",
      name: "Stasis Beam",
      short: "Beam",
      icon: "━",
      color: "#70e8d0",
      desc: "Thin fast line. High fire rate.",
      cooldown: 0.12,
      pattern: "single",
      speed: 900,
      damage: 5,
      life: 0.7,
      size: 3,
      pierce: 2,
      spread: 0,
      count: 1,
      homing: 0,
    },
  };

  const SPELL_ORDER = ["bolt", "fan", "frame", "seek", "splash", "beam"];
  const DEFAULT_LOADOUT = ["bolt", "fan", "frame"];

  const ENEMY_KINDS = {
    blot: {
      name: "Ink Blot",
      w: 40,
      h: 40,
      hp: 28,
      speed: 70,
      score: 40,
      shootCd: [1.4, 2.2],
      projSpeed: 280,
      projDmg: 8,
      color: "#4a6080",
      fly: false,
    },
    wraith: {
      name: "Void Wraith",
      w: 36,
      h: 48,
      hp: 36,
      speed: 90,
      score: 60,
      shootCd: [1.0, 1.7],
      projSpeed: 340,
      projDmg: 10,
      color: "#603060",
      fly: true,
    },
    frame: {
      name: "Cracked Frame",
      w: 44,
      h: 44,
      hp: 48,
      speed: 45,
      score: 80,
      shootCd: [1.6, 2.4],
      projSpeed: 260,
      projDmg: 12,
      color: "#8a6a30",
      fly: false,
      spreadShot: true,
    },
    brushling: {
      name: "Brushling",
      w: 32,
      h: 38,
      hp: 22,
      speed: 110,
      score: 35,
      shootCd: [0.9, 1.4],
      projSpeed: 400,
      projDmg: 6,
      color: "#508868",
      fly: true,
    },
  };

  const canvas = document.getElementById("gm-canvas");
  if (!canvas || !canvas.getContext) return;

  const ctx = canvas.getContext("2d");
  const elScore = document.getElementById("gm-score");
  const elBest = document.getElementById("gm-best");
  const elCombo = document.getElementById("gm-combo");
  const elDistance = document.getElementById("gm-distance");
  const elHp = document.getElementById("gm-hp");
  const elActiveSpell = document.getElementById("gm-active-spell");
  const elBgLabel = document.getElementById("gm-bg-label");
  const elBossStatus = document.getElementById("gm-boss-status");
  const promptPanel = document.getElementById("gm-prompt-panel");
  const promptEdit = document.getElementById("gm-prompt-edit");
  const promptReason = document.getElementById("gm-prompt-reason");
  const btnPromptRetry = document.getElementById("gm-prompt-retry");
  const btnPromptReset = document.getElementById("gm-prompt-reset");
  const btnPromptCopy = document.getElementById("gm-prompt-copy");
  const btnPromptClose = document.getElementById("gm-prompt-close");
  const overlay = document.getElementById("gm-overlay");
  const overlayTitle = document.getElementById("gm-overlay-title");
  const overlayBody = document.getElementById("gm-overlay-body");
  const btnStart = document.getElementById("gm-start");
  const btnPause = document.getElementById("gm-pause");
  const btnMute = document.getElementById("gm-mute");
  const btnShuffleBg = document.getElementById("gm-shuffle-bg");
  const loadoutSlotsEl = document.getElementById("gm-loadout-slots");
  const spellPickerEl = document.getElementById("gm-spell-picker");
  const combatSlotsEl = document.getElementById("gm-combat-slots");

  canvas.width = W;
  canvas.height = H;

  let highScore = 0;
  try {
    highScore = Math.max(0, parseInt(localStorage.getItem(HS_KEY) || "0", 10) || 0);
  } catch (_) {
    highScore = 0;
  }

  function loadLoadout() {
    try {
      const raw = localStorage.getItem(LOADOUT_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr) && arr.length) {
          const clean = arr.filter((id) => SPELLS[id]).slice(0, MAX_LOADOUT);
          while (clean.length < MAX_LOADOUT) {
            const fill = DEFAULT_LOADOUT.find((id) => !clean.includes(id)) || "bolt";
            if (!clean.includes(fill)) clean.push(fill);
            else break;
          }
          return clean.slice(0, MAX_LOADOUT);
        }
      }
    } catch (_) {}
    return DEFAULT_LOADOUT.slice();
  }

  function saveLoadout(ids) {
    try {
      localStorage.setItem(LOADOUT_KEY, JSON.stringify(ids));
    } catch (_) {}
  }

  let loadout = loadLoadout();
  let pickSlot = 0;

  let audioCtx = null;
  let muted = false;
  try {
    muted = localStorage.getItem("gallery-brush-dash-muted") === "1";
  } catch (_) {}

  function ensureAudio() {
    if (muted) return null;
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audioCtx = new AC();
    }
    if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
    return audioCtx;
  }

  function beep(freq, dur, type, gain) {
    const ac = ensureAudio();
    if (!ac) return;
    const t0 = ac.currentTime;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type || "square";
    o.frequency.value = freq;
    g.gain.setValueAtTime(gain || 0.06, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + (dur || 0.08));
    o.connect(g);
    g.connect(ac.destination);
    o.start(t0);
    o.stop(t0 + (dur || 0.08) + 0.02);
  }

  /** Gallery backdrop — your paintings + boss fusion from the six */
  const galleryBg = {
    pool: [],
    panels: [],
    nums: [],
    status: "loading",
    shuffleGen: 0,
  };

  const boss = {
    phase: "idle", // idle | generating | active | defeated
    gen: 0,
    sourceNums: [],
    description: "",
    imageUrl: "",
    savedUrl: "",
    img: null,
    error: "",
  };

  /** After a loss, next wall must differ from these numbers */
  let excludeAfterLoss = [];

  function apiUrl(path) {
    if (typeof window.galleryApiUrl === "function") return window.galleryApiUrl(path);
    return path;
  }

  function paintingUrl(num) {
    if (window.getPaintingUrl) return window.getPaintingUrl(num);
    return "paintings/" + num + ".jpg";
  }

  function absoluteUrl(url) {
    if (!url) return "";
    if (url.indexOf("data:") === 0 || url.indexOf("blob:") === 0) return url;
    if (/^https?:\/\//i.test(url)) return url;
    try {
      return new URL(url, window.location.href).href;
    } catch (_) {
      return url;
    }
  }

  function delay(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function fetchWithTimeout(url, opts, ms) {
    opts = opts || {};
    ms = ms || FETCH_TIMEOUT_MS;
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = null;
    if (ctrl) {
      opts = Object.assign({}, opts, { signal: ctrl.signal });
      timer = setTimeout(function () {
        try {
          ctrl.abort();
        } catch (_) {}
      }, ms);
    }
    return fetch(url, opts).finally(function () {
      if (timer) clearTimeout(timer);
    });
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  function setBossStatus(text, kind) {
    if (elBossStatus) {
      elBossStatus.textContent = text || "";
      elBossStatus.dataset.kind = kind || "";
    }
  }

  function readEditedPrompt() {
    if (promptEdit && typeof promptEdit.value === "string") {
      return promptEdit.value.trim();
    }
    return (boss.description || "").trim();
  }

  function syncPromptFromBoss() {
    if (promptEdit) {
      promptEdit.value = boss.description || "";
    }
  }

  function hidePromptEditor() {
    if (promptPanel) promptPanel.hidden = true;
  }

  /**
   * HUD popup when boss image cannot be generated — show the would-be prompt for tweaking.
   */
  function showPromptEditor(reason) {
    if (!promptPanel) return;
    const msg =
      reason ||
      "Image generate unavailable. This is the prompt that would have made the boss — tweak it and retry when you can.";
    if (promptReason) promptReason.textContent = msg;
    if (!boss.description && boss.sourceNums && boss.sourceNums.length) {
      boss.description = buildBossDescription(boss.sourceNums);
    }
    syncPromptFromBoss();
    promptPanel.hidden = false;
    boss.phase = "prompt";
    setBossStatus("No boss image — edit prompt below", "error");
    // Focus after paint so the panel is visible
    setTimeout(function () {
      if (promptEdit && !promptPanel.hidden) {
        try {
          promptEdit.focus();
          // Place caret at end for easy tweaking
          const len = promptEdit.value.length;
          promptEdit.setSelectionRange(len, len);
        } catch (_) {}
      }
    }, 40);
  }

  function isGenerateBlockedError(err) {
    const raw = (err && err.message) || String(err || "");
    const lower = raw.toLowerCase();
    return (
      lower.indexOf("credit") >= 0 ||
      lower.indexOf("quota") >= 0 ||
      lower.indexOf("billing") >= 0 ||
      lower.indexOf("payment") >= 0 ||
      lower.indexOf("insufficient") >= 0 ||
      lower.indexOf("rate limit") >= 0 ||
      lower.indexOf("unauthorized") >= 0 ||
      lower.indexOf("401") >= 0 ||
      lower.indexOf("402") >= 0 ||
      lower.indexOf("403") >= 0 ||
      lower.indexOf("429") >= 0
    );
  }

  function friendlyGenerateError(err) {
    const raw = (err && err.message) || String(err || "Generate failed");
    const lower = raw.toLowerCase();
    if (isGenerateBlockedError(err)) {
      return (
        "Can't generate a boss image right now (" +
        raw +
        "). Here's the prompt that would have been used — edit it, then Retry when generate is available."
      );
    }
    if (lower.indexOf("network") >= 0 || lower.indexOf("fetch") >= 0 || lower.indexOf("abort") >= 0) {
      return "Could not reach the generator: " + raw + " Your prompt is below — tweak and retry.";
    }
    return "Could not generate a boss image: " + raw + " Prompt is editable below.";
  }

  /** Cloud first; on credit/block skip local so the prompt HUD can open. */
  function generateBossWithFallback(nums, promptText, ref) {
    return generateBossCloud(nums, promptText, ref).catch(function (err) {
      if (isGenerateBlockedError(err)) {
        throw err;
      }
      setBossStatus("Cloud failed — local fuse…", "pending");
      return generateBossLocal(nums, promptText)
        .then(function (url) {
          return url;
        })
        .catch(function () {
          throw err;
        });
    });
  }

  function retryBossFromPrompt() {
    const nums = (boss.sourceNums && boss.sourceNums.length
      ? boss.sourceNums
      : galleryBg.nums || []
    ).slice();
    if (!nums.length) {
      setBossStatus("No wall paintings for boss", "error");
      return;
    }
    const text = readEditedPrompt();
    if (!text) {
      setBossStatus("Prompt is empty — write something first", "error");
      if (promptEdit) promptEdit.focus();
      return;
    }
    boss.description = text;
    hidePromptEditor();
    const gen = ++boss.gen;
    boss.phase = "generating";
    boss.imageUrl = "";
    boss.savedUrl = "";
    boss.img = null;
    boss.error = "";
    removeBossEnemies();
    setBossStatus("Retrying boss from your prompt…", "pending");
    ensureAudio();
    beep(480, 0.05, "triangle", 0.04);

    collageWallReference(nums)
      .then(function (ref) {
        if (gen !== boss.gen) return null;
        setBossStatus("Generating singular boss…", "pending");
        return generateBossWithFallback(nums, boss.description, ref);
      })
      .then(function (url) {
        if (gen !== boss.gen) return null;
        if (!url) throw new Error("No boss image");
        boss.imageUrl = url;
        setBossStatus("Saving boss image…", "pending");
        return saveBossImage(url, nums, boss.description)
          .then(function (saved) {
            if (saved && (saved.url || saved.path)) {
              boss.savedUrl = absoluteUrl(saved.url || "/" + saved.path);
            }
            return url;
          })
          .catch(function (err) {
            console.warn("[game] boss save failed", err);
            return url;
          });
      })
      .then(function (url) {
        if (gen !== boss.gen || !url) return null;
        return loadHtmlImage(absoluteUrl(boss.savedUrl || url)).then(function (img) {
          return { img: img, url: url };
        });
      })
      .then(function (pack) {
        if (gen !== boss.gen || !pack) return;
        boss.img = pack.img;
        hidePromptEditor();
        setBossStatus(
          boss.savedUrl
            ? "Boss ready · saved " + boss.savedUrl.replace(/^.*\//, "")
            : "Boss ready",
          "ok"
        );
        if (state.mode === "play") {
          spawnBossEntity();
        } else {
          boss.phase = "ready";
          setBossStatus("Boss image ready — press Play", "ok");
        }
        beep(660, 0.08, "sine", 0.05);
      })
      .catch(function (err) {
        if (gen !== boss.gen) return;
        boss.phase = "prompt";
        boss.error = (err && err.message) || String(err);
        showPromptEditor(friendlyGenerateError(err));
      });
  }

  function layoutPanels() {
    const margin = 10;
    const gap = 8;
    const floorPad = H - GROUND_Y + 8;
    const wallH = H - floorPad - margin * 2;
    const wallW = W - margin * 2;
    const cols = 3;
    const rows = 2;
    const cellW = (wallW - gap * (cols - 1)) / cols;
    const cellH = (wallH - gap * (rows - 1)) / rows;
    const layouts = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        layouts.push({
          x: margin + c * (cellW + gap),
          y: margin + r * (cellH + gap),
          w: cellW,
          h: cellH,
        });
      }
    }
    return layouts;
  }

  function waitPanelsReady(gen, timeoutMs) {
    timeoutMs = timeoutMs || 12000;
    const start = Date.now();
    return new Promise(function (resolve) {
      function tick() {
        if (gen !== galleryBg.shuffleGen) return resolve(false);
        const panels = galleryBg.panels || [];
        const ready = panels.filter(function (p) {
          return p.ready && p.img;
        }).length;
        if (ready >= Math.min(BG_PANELS, panels.length) || Date.now() - start > timeoutMs) {
          return resolve(ready > 0);
        }
        setTimeout(tick, 80);
      }
      tick();
    });
  }

  function pickWallNumbers(excludeList) {
    const pool = galleryBg.pool.length
      ? galleryBg.pool.slice()
      : (function () {
          const f = [];
          for (let i = 1; i <= 40; i++) f.push(i);
          return f;
        })();
    const excl = new Set((excludeList || []).map(function (n) {
      return parseInt(n, 10);
    }).filter(function (n) {
      return n >= 1;
    }));
    let available = pool.filter(function (n) {
      return !excl.has(n);
    });
    // Prefer a fully different set when possible
    if (available.length < BG_PANELS) {
      available = pool.slice();
    }
    let picks = shuffle(available).slice(0, BG_PANELS);
    // If we still somehow mirrored the exclude set exactly, reshuffle harder
    if (excl.size >= BG_PANELS && picks.every(function (n) {
      return excl.has(n);
    })) {
      picks = shuffle(pool).slice(0, BG_PANELS);
    }
    return picks;
  }

  function assignBackdrop(numbers, opts) {
    opts = opts || {};
    const gen = ++galleryBg.shuffleGen;
    const layouts = layoutPanels();
    const picks = numbers.slice(0, BG_PANELS);
    galleryBg.nums = picks.slice();
    galleryBg.panels = layouts.map(function (lay, i) {
      const num = picks[i % Math.max(1, picks.length)];
      const panel = {
        num: num,
        img: null,
        ready: false,
        x: lay.x,
        y: lay.y,
        w: lay.w,
        h: lay.h,
      };
      if (num == null) return panel;
      const img = new Image();
      img.decoding = "async";
      img.onload = function () {
        if (gen !== galleryBg.shuffleGen) return;
        panel.ready = true;
        panel.img = img;
      };
      img.onerror = function () {
        panel.ready = false;
      };
      img.src = paintingUrl(num);
      return panel;
    });
    galleryBg.status = picks.length ? "ready" : "empty";
    if (elBgLabel) {
      if (!picks.length) elBgLabel.textContent = "No paintings found";
      else elBgLabel.textContent = "#" + picks.join(" · #");
    }
    // Never spend API credits unless the Game tab is actually open
    if (!opts.skipBoss && isGameTabActive()) {
      beginBossFromWall(gen);
    } else if (!opts.skipBoss && !isGameTabActive()) {
      boss.phase = "idle";
      setBossStatus("Boss waits until Game tab is open", "pending");
    }
    return gen;
  }

  function ensurePool() {
    if (galleryBg.pool.length) return Promise.resolve(galleryBg.pool);
    const apply = function (manifest) {
      const nums = (manifest || [])
        .map(function (m) {
          return m && m.number != null ? parseInt(m.number, 10) : NaN;
        })
        .filter(function (n) {
          return n >= 1;
        });
      if (!nums.length) {
        const fallback = [];
        for (let i = 1; i <= 40; i++) fallback.push(i);
        galleryBg.pool = fallback;
      } else {
        galleryBg.pool = nums;
      }
      return galleryBg.pool;
    };
    if (window.loadGalleryData) {
      return window
        .loadGalleryData()
        .then(function (data) {
          return apply((data && data.manifest) || window.galleryManifest || []);
        })
        .catch(function () {
          return apply(window.galleryManifest || []);
        });
    }
    if (window.galleryManifest && window.galleryManifest.length) {
      return Promise.resolve(apply(window.galleryManifest));
    }
    return fetch("data/manifest.json")
      .then(function (r) {
        return r.ok ? r.json() : [];
      })
      .then(apply)
      .catch(function () {
        return apply([]);
      });
  }

  /**
   * Load a new wall of 6 paintings.
   * @param {{ exclude?: number[], skipBoss?: boolean, reason?: string }} opts
   */
  function loadGalleryBackdrop(opts) {
    opts = opts || {};
    galleryBg.status = "loading";
    if (elBgLabel) elBgLabel.textContent = "Loading your paintings…";
    setBossStatus("Selecting wall…", "pending");

    return ensurePool().then(function () {
      const exclude = opts.exclude != null ? opts.exclude : excludeAfterLoss;
      const picks = pickWallNumbers(exclude);
      // Once we've committed a new wall after a loss, clear the exclude list
      if (opts.clearExclude || (excludeAfterLoss && excludeAfterLoss.length)) {
        // only clear when we intentionally reshuffled after loss/win
      }
      if (opts.clearExclude) excludeAfterLoss = [];
      assignBackdrop(picks, { skipBoss: opts.skipBoss });
      return picks;
    });
  }

  function analysisFor(num) {
    if (window.getGalleryAnalysis) return window.getGalleryAnalysis(num);
    const analyses = window.galleryAnalyses || {};
    return analyses[String(num)] || analyses[num] || null;
  }

  function buildBossDescription(nums) {
    const bits = [];
    const titles = [];
    (nums || []).forEach(function (n) {
      const a = analysisFor(n);
      if (a && a.title) titles.push(a.title);
      if (a && a.description) {
        bits.push("#" + n + " (" + (a.title || "work") + "): " + String(a.description).slice(0, 220));
      } else if (a && a.style) {
        bits.push("#" + n + ": " + a.style + " · " + (a.mood || "painting"));
      } else {
        bits.push("#" + n + ": gallery painting");
      }
    });
    const fusedTitle =
      titles.length >= 2
        ? "Fusion of “" + titles.slice(0, 3).join("” · “") + "”"
        : "Gallery wall fusion boss";
    return (
      "ONE singular cinematic painting, not a collage grid, not six panels. " +
      fusedTitle +
      ". " +
      "Seamlessly fuse the spirit, palette, forms, and mood of these six source works into a single coherent image: " +
      bits.join(" | ") +
      ". Epic boss presence, dramatic lighting, unified composition, no text, no frames, no UI, no watermark."
    );
  }

  function loadHtmlImage(url) {
    return new Promise(function (resolve, reject) {
      const img = new Image();
      try {
        const sameOrigin =
          url.indexOf("data:") === 0 ||
          url.indexOf("blob:") === 0 ||
          new URL(url, window.location.href).origin === window.location.origin;
        if (!sameOrigin) img.crossOrigin = "anonymous";
      } catch (_) {}
      img.onload = function () {
        resolve(img);
      };
      img.onerror = function () {
        reject(new Error("Could not load " + url));
      };
      img.src = url;
    });
  }

  function collageWallReference(nums) {
    const urls = (nums || []).map(paintingUrl);
    return Promise.all(
      urls.map(function (u) {
        return loadHtmlImage(absoluteUrl(u)).catch(function () {
          return null;
        });
      })
    ).then(function (imgs) {
      imgs = imgs.filter(Boolean);
      if (!imgs.length) return "";
      const side = REF_MAX_SIDE;
      const canvas = document.createElement("canvas");
      canvas.width = side;
      canvas.height = side;
      const c = canvas.getContext("2d");
      if (!c) return "";
      c.fillStyle = "#0a0908";
      c.fillRect(0, 0, side, side);
      const cols = 3;
      const rows = 2;
      const cellW = side / cols;
      const cellH = side / rows;
      for (let i = 0; i < Math.min(6, imgs.length); i++) {
        const img = imgs[i];
        const col = i % cols;
        const row = Math.floor(i / cols);
        const dx = col * cellW;
        const dy = row * cellH;
        const iw = img.naturalWidth || img.width || 1;
        const ih = img.naturalHeight || img.height || 1;
        const sc = Math.max(cellW / iw, cellH / ih);
        const dw = iw * sc;
        const dh = ih * sc;
        c.drawImage(img, dx + (cellW - dw) / 2, dy + (cellH - dh) / 2, dw, dh);
      }
      // Soft center blend so the model reads one field, not a hard grid
      c.globalAlpha = 0.28;
      c.globalCompositeOperation = "lighter";
      for (let i = 0; i < imgs.length; i++) {
        const img = imgs[i];
        const iw = img.naturalWidth || img.width || 1;
        const ih = img.naturalHeight || img.height || 1;
        const sc = Math.min(side / iw, side / ih) * 0.72;
        c.drawImage(img, (side - iw * sc) / 2, (side - ih * sc) / 2, iw * sc, ih * sc);
      }
      c.globalAlpha = 1;
      c.globalCompositeOperation = "source-over";
      return canvas.toDataURL("image/jpeg", REF_QUALITY);
    });
  }

  function pollImageJob(jobId, attemptsLeft) {
    if (attemptsLeft == null) attemptsLeft = 90;
    if (attemptsLeft <= 0) return Promise.reject(new Error("Boss generation timed out."));
    return fetchWithTimeout(apiUrl("/api/jobs/" + jobId), { cache: "no-store" }, 30000)
      .then(function (r) {
        return r.json();
      })
      .then(function (job) {
        if (job.status === "done" || job.status === "completed" || job.status === "success") {
          const img = job.image || (job.images && job.images[0]);
          const url = (img && img.url) || job.image_url || job.output_url || job.result_url;
          if (url) return absoluteUrl(url);
          throw new Error("No image URL in job result.");
        }
        if (job.status === "failed" || job.status === "expired" || job.status === "error") {
          throw new Error((job.error && (job.error.message || job.error)) || "Boss generate failed.");
        }
        setBossStatus("Fusing boss… (" + (job.status || "working") + ")", "pending");
        return delay(POLL_INTERVAL_MS).then(function () {
          return pollImageJob(jobId, attemptsLeft - 1);
        });
      });
  }

  function generateBossCloud(nums, description, refDataUrl) {
    if (!isGameTabActive()) {
      return Promise.reject(new Error("Boss generate blocked — Game tab not active (saves credits)."));
    }
    const jobId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : "gm-boss-" + Date.now();
    const body = {
      job_id: jobId,
      stasis: description.slice(0, 3500),
      prompt: description.slice(0, 2000),
      buzz_words: ["singular painting", "boss", "fused", "no collage", "no text", "epic"],
      spells: nums,
      aspect_ratio: "1:1",
      mag_fresh: true,
      fresh_variation: true,
      spell_cast: nums.length > 0,
    };
    if (refDataUrl && refDataUrl.indexOf("data:image") === 0) {
      body.reference_image = refDataUrl;
      body.spell_reference_image = refDataUrl;
    }
    return fetchWithTimeout(
      apiUrl("/api/generate-stasis-vision"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      FETCH_TIMEOUT_MS
    ).then(function (r) {
      if (r.status === 202) {
        return r.json().then(function (d) {
          return pollImageJob((d && d.job_id) || jobId);
        });
      }
      return r.json().then(function (d) {
        if (!r.ok) throw new Error((d && d.error) || "Generate failed (" + r.status + ")");
        const img = d.image || (d.images && d.images[0]);
        if (img && img.url) return absoluteUrl(img.url);
        if (d.job_id) return pollImageJob(d.job_id);
        throw new Error("No image returned from generate-stasis-vision.");
      });
    });
  }

  function generateBossLocal(nums, description) {
    if (window.composeStasisVisionLocal && nums.length >= 2) {
      return window
        .composeStasisVisionLocal({
          spells: nums,
          stasis: description,
          buzz_words: ["boss", "fusion", "singular", "gallery"],
          aspect_ratio: "1:1",
        })
        .then(function (url) {
          if (!url) throw new Error("Local fuse empty");
          return url;
        });
    }
    return collageWallReference(nums).then(function (url) {
      if (!url) throw new Error("Could not collage wall");
      return url;
    });
  }

  function saveBossImage(imageUrl, nums, description) {
    function postBody(body) {
      return fetchWithTimeout(
        apiUrl("/api/save-game-boss"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        60000
      ).then(function (r) {
        return r.json().then(function (d) {
          if (!r.ok || (d && d.ok === false)) {
            throw new Error((d && d.error) || "Save failed");
          }
          return d;
        });
      });
    }

    if (imageUrl && imageUrl.indexOf("data:image") === 0) {
      return postBody({
        image_base64: imageUrl,
        source_paintings: nums,
        description: description,
        meta: { kind: "brush-dash-boss" },
      });
    }

    // Prefer sending remote/local URL; server may read local paths. Else fetch→data URL.
    return postBody({
      image_url: imageUrl,
      source_paintings: nums,
      description: description,
      meta: { kind: "brush-dash-boss" },
    }).catch(function () {
      return fetch(absoluteUrl(imageUrl), { cache: "no-store" })
        .then(function (r) {
          if (!r.ok) throw new Error("Fetch boss image failed");
          return r.blob();
        })
        .then(function (blob) {
          return new Promise(function (resolve, reject) {
            const reader = new FileReader();
            reader.onload = function () {
              resolve(reader.result);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        })
        .then(function (dataUrl) {
          return postBody({
            image_base64: dataUrl,
            source_paintings: nums,
            description: description,
            meta: { kind: "brush-dash-boss" },
          });
        });
    });
  }

  function removeBossEnemies() {
    state.enemies = state.enemies.filter(function (e) {
      return !e.isBoss;
    });
  }

  function spawnBossEntity() {
    if (!boss.img || !boss.img.complete) return;
    removeBossEnemies();
    const bw = 110;
    const bh = 110;
    const hp = BOSS_HP_BASE + Math.floor(state.survival / 15) * 20 + state.kills * 2;
    state.enemies.push({
      kind: "boss",
      isBoss: true,
      x: W * 0.5 - bw / 2,
      y: GROUND_Y - bh - 20,
      w: bw,
      h: bh,
      hp: hp,
      maxHp: hp,
      baseY: GROUND_Y - bh - 40,
      bob: 0,
      shootT: 1.2,
      shootCd: [0.7, 1.15],
      frame: 0,
      anim: 0,
      flash: 0,
      vx: 80,
      wander: 0,
      sprite: boss.img,
      name: "Wall Boss",
    });
    boss.phase = "active";
    setBossStatus("BOSS · wall fusion · " + Math.ceil(hp) + " HP", "boss");
    floater(W / 2, 80, "BOSS", "#ffd78a");
    beep(180, 0.2, "sawtooth", 0.07);
    beep(360, 0.15, "triangle", 0.06);
  }

  function beginBossFromWall(wallGen) {
    // Hard gate: no cloud/local boss generation off the Game tab (saves credits)
    if (!isGameTabActive()) {
      boss.phase = "idle";
      setBossStatus("Open Game tab to generate boss", "pending");
      return;
    }
    const gen = ++boss.gen;
    const nums = (galleryBg.nums || []).slice();
    if (!nums.length) {
      setBossStatus("No wall for boss", "error");
      boss.phase = "idle";
      hidePromptEditor();
      return;
    }
    hidePromptEditor();
    boss.phase = "generating";
    boss.sourceNums = nums.slice();
    boss.description = buildBossDescription(nums);
    boss.imageUrl = "";
    boss.savedUrl = "";
    boss.img = null;
    boss.error = "";
    removeBossEnemies();
    setBossStatus("Fusing 6 works into one boss image…", "pending");

    waitPanelsReady(wallGen || galleryBg.shuffleGen)
      .then(function () {
        if (gen !== boss.gen) return null;
        if (!isGameTabActive()) {
          boss.gen++;
          return null;
        }
        return collageWallReference(nums);
      })
      .then(function (ref) {
        if (gen !== boss.gen) return null;
        if (!isGameTabActive()) {
          boss.gen++;
          boss.phase = "idle";
          setBossStatus("Boss gen cancelled — left Game tab", "pending");
          return null;
        }
        setBossStatus("Generating singular boss…", "pending");
        // Prefer any prompt the player already tweaked for this wall
        const promptText = (boss.description || buildBossDescription(nums)).trim();
        boss.description = promptText;
        return generateBossWithFallback(nums, promptText, ref);
      })
      .then(function (url) {
        if (gen !== boss.gen) return null;
        if (!url) throw new Error("No boss image");
        boss.imageUrl = url;
        setBossStatus("Saving boss image…", "pending");
        return saveBossImage(url, nums, boss.description)
          .then(function (saved) {
            if (saved && (saved.url || saved.path)) {
              boss.savedUrl = absoluteUrl(saved.url || "/" + saved.path);
            }
            return url;
          })
          .catch(function (err) {
            // Still play the boss even if disk save fails
            console.warn("[game] boss save failed", err);
            return url;
          });
      })
      .then(function (url) {
        if (gen !== boss.gen || !url) return null;
        return loadHtmlImage(absoluteUrl(boss.savedUrl || url)).then(function (img) {
          return { img: img, url: url };
        });
      })
      .then(function (pack) {
        if (gen !== boss.gen || !pack) return;
        boss.img = pack.img;
        hidePromptEditor();
        setBossStatus(
          boss.savedUrl
            ? "Boss ready · saved " + boss.savedUrl.replace(/^.*\//, "")
            : "Boss ready",
          "ok"
        );
        // Boss round when image loads — if playing, spawn now; else wait for Play
        if (state.mode === "play") {
          spawnBossEntity();
        } else {
          boss.phase = "ready";
          setBossStatus("Boss image ready — press Play", "ok");
        }
      })
      .catch(function (err) {
        if (gen !== boss.gen) return;
        boss.error = (err && err.message) || String(err);
        // Keep the would-be prompt available and editable in the HUD
        if (!boss.description) {
          boss.description = buildBossDescription(nums);
        }
        showPromptEditor(friendlyGenerateError(err));
      });
  }

  function onBossDefeated() {
    boss.phase = "defeated";
    setBossStatus("Boss down! New wall…", "ok");
    floater(W / 2, 100, "WALL CLEAR", "#7dffb3");
    state.score += 250;
    beep(880, 0.12, "sine", 0.06);
    // New random six (prefer different from current wall)
    excludeAfterLoss = [];
    loadGalleryBackdrop({
      exclude: galleryBg.nums.slice(),
      clearExclude: true,
    });
  }

  function onPlayerLostReshuffle() {
    // Next wall must differ from the wall we lost on
    excludeAfterLoss = galleryBg.nums.slice();
    loadGalleryBackdrop({
      exclude: excludeAfterLoss,
      clearExclude: false,
    }).then(function () {
      // After new wall is assigned, clear exclude so later shuffles aren't stuck
      excludeAfterLoss = [];
    });
  }

  function drawImageCover(img, dx, dy, dw, dh) {
    if (!img || !img.naturalWidth) return;
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    const scale = Math.max(dw / iw, dh / ih);
    const sw = dw / scale;
    const sh = dh / scale;
    const sx = (iw - sw) / 2;
    const sy = (ih - sh) / 2;
    ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
  }

  function drawGalleryBackground() {
    // Deep gallery base
    ctx.fillStyle = "#0a0c10";
    ctx.fillRect(0, 0, W, H);

    const panels = galleryBg.panels;
    if (panels && panels.length) {
      for (const p of panels) {
        // Frame mat
        ctx.fillStyle = "#1a1610";
        ctx.fillRect(p.x - 4, p.y - 4, p.w + 8, p.h + 8);
        ctx.strokeStyle = "rgba(200,160,80,0.55)";
        ctx.lineWidth = 2;
        ctx.strokeRect(p.x - 4.5, p.y - 4.5, p.w + 9, p.h + 9);

        if (p.ready && p.img) {
          drawImageCover(p.img, p.x, p.y, p.w, p.h);
        } else {
          ctx.fillStyle = "#1c2430";
          ctx.fillRect(p.x, p.y, p.w, p.h);
          ctx.fillStyle = "rgba(180,200,220,0.35)";
          ctx.font = "12px system-ui, sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(p.num ? "#" + p.num : "…", p.x + p.w / 2, p.y + p.h / 2);
        }

        // Soft glass sheen
        const sheen = ctx.createLinearGradient(p.x, p.y, p.x + p.w, p.y + p.h);
        sheen.addColorStop(0, "rgba(255,255,255,0.06)");
        sheen.addColorStop(0.5, "rgba(255,255,255,0)");
        sheen.addColorStop(1, "rgba(0,0,0,0.12)");
        ctx.fillStyle = sheen;
        ctx.fillRect(p.x, p.y, p.w, p.h);
      }
    } else {
      ctx.fillStyle = "#152030";
      ctx.fillRect(0, 0, W, H);
    }

    // Dim overlay so combat stays readable
    ctx.fillStyle = "rgba(6, 10, 16, 0.42)";
    ctx.fillRect(0, 0, W, GROUND_Y);

    // Floor
    const floorG = ctx.createLinearGradient(0, GROUND_Y, 0, H);
    floorG.addColorStop(0, "rgba(18, 22, 30, 0.92)");
    floorG.addColorStop(1, "rgba(8, 10, 14, 0.98)");
    ctx.fillStyle = floorG;
    ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);

    // Floor reflection strip of bottom-row paintings (blurred feel via low alpha)
    if (panels && panels.length >= 4) {
      ctx.save();
      ctx.globalAlpha = 0.12;
      ctx.translate(0, GROUND_Y + 2);
      ctx.scale(1, 0.35);
      for (let i = 3; i < Math.min(6, panels.length); i++) {
        const p = panels[i];
        if (p.ready && p.img) {
          drawImageCover(p.img, p.x, 0, p.w, p.h);
        }
      }
      ctx.restore();
    }

    ctx.strokeStyle = "rgba(200,160,80,0.4)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, GROUND_Y + 0.5);
    ctx.lineTo(W, GROUND_Y + 0.5);
    ctx.stroke();
  }

  const state = {
    mode: "title",
    t: 0,
    score: 0,
    combo: 0,
    maxCombo: 0,
    kills: 0,
    survival: 0,
    player: null,
    entities: [],
    enemies: [],
    bullets: [],
    eBullets: [],
    particles: [],
    floaters: [],
    keys: Object.create(null),
    fireHeld: false,
    pointer: { x: W * 0.7, y: H * 0.4, over: false },
    raf: 0,
    lastTs: 0,
    tabVisible: true,
    activeSlot: 0,
    cooldowns: [0, 0, 0],
    spawnAcc: 0,
    nextSpawn: 1.2,
    enemySpawnAcc: 0,
    nextEnemy: 1.5,
  };

  function resetPlayer() {
    return {
      x: W * 0.5 - 18,
      y: GROUND_Y - 48,
      w: 36,
      h: 48,
      vy: 0,
      onGround: true,
      jumpsLeft: 2,
      invuln: 0,
      blink: 0,
      brushAngle: 0,
      hp: 100,
      maxHp: 100,
      facing: 1,
    };
  }

  function setHud() {
    if (elScore) elScore.textContent = String(Math.floor(state.score));
    if (elBest) elBest.textContent = String(highScore);
    if (elCombo) elCombo.textContent = state.combo > 1 ? "×" + state.combo : "—";
    if (elDistance) {
      // Reuse distance slot as survival / kills
      elDistance.textContent = Math.floor(state.survival) + "s · " + state.kills + " K";
    }
    if (elHp && state.player) {
      elHp.textContent = Math.max(0, Math.ceil(state.player.hp)) + "/" + state.player.maxHp;
    } else if (elHp) {
      elHp.textContent = "—";
    }
    const sid = loadout[state.activeSlot];
    const sp = SPELLS[sid];
    if (elActiveSpell) {
      elActiveSpell.textContent = sp ? sp.short : "—";
      elActiveSpell.style.color = sp ? sp.color : "";
    }
    if (btnMute) btnMute.textContent = muted ? "Unmute" : "Mute";
    if (btnPause) {
      btnPause.disabled = state.mode !== "play" && state.mode !== "pause";
      btnPause.textContent = state.mode === "pause" ? "Resume" : "Pause";
    }
    renderCombatSlots();
  }

  function renderLoadoutUI() {
    if (loadoutSlotsEl) {
      loadoutSlotsEl.innerHTML = "";
      for (let i = 0; i < MAX_LOADOUT; i++) {
        const id = loadout[i];
        const sp = SPELLS[id];
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "gm-slot" + (pickSlot === i ? " active" : "");
        btn.dataset.slot = String(i);
        btn.innerHTML =
          '<span class="gm-slot-key">' +
          (i + 1) +
          '</span><span class="gm-slot-icon" style="color:' +
          (sp ? sp.color : "#888") +
          '">' +
          (sp ? sp.icon : "?") +
          '</span><span class="gm-slot-name">' +
          (sp ? sp.short : "Empty") +
          "</span>";
        btn.title = sp ? sp.name + " — " + sp.desc : "Empty slot";
        btn.addEventListener("click", () => {
          pickSlot = i;
          renderLoadoutUI();
        });
        loadoutSlotsEl.appendChild(btn);
      }
    }
    if (spellPickerEl) {
      spellPickerEl.innerHTML = "";
      SPELL_ORDER.forEach((id) => {
        const sp = SPELLS[id];
        const used = loadout.indexOf(id);
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "gm-spell-card" + (used >= 0 ? " equipped" : "");
        btn.innerHTML =
          '<span class="gm-spell-icon" style="color:' +
          sp.color +
          '">' +
          sp.icon +
          "</span><strong>" +
          sp.name +
          '</strong><span class="gm-spell-desc">' +
          sp.desc +
          "</span>" +
          (used >= 0 ? '<span class="gm-spell-tag">Slot ' + (used + 1) + "</span>" : "");
        btn.addEventListener("click", () => {
          const existing = loadout.indexOf(id);
          if (existing === pickSlot) return;
          if (existing >= 0) {
            const tmp = loadout[pickSlot];
            loadout[pickSlot] = id;
            loadout[existing] = tmp;
          } else {
            loadout[pickSlot] = id;
          }
          saveLoadout(loadout);
          renderLoadoutUI();
          setHud();
          beep(500, 0.04, "triangle", 0.04);
        });
        spellPickerEl.appendChild(btn);
      });
    }
  }

  function renderCombatSlots() {
    if (!combatSlotsEl) return;
    combatSlotsEl.innerHTML = "";
    for (let i = 0; i < MAX_LOADOUT; i++) {
      const id = loadout[i];
      const sp = SPELLS[id];
      const cd = state.cooldowns[i] || 0;
      const maxCd = sp ? sp.cooldown : 1;
      const pct = sp && maxCd > 0 ? Math.min(1, cd / maxCd) : 0;
      const div = document.createElement("div");
      div.className = "gm-combat-slot" + (state.activeSlot === i ? " active" : "");
      div.innerHTML =
        '<span class="gm-combat-key">' +
        (i + 1) +
        '</span><span class="gm-combat-icon" style="color:' +
        (sp ? sp.color : "#666") +
        '">' +
        (sp ? sp.icon : "·") +
        '</span><span class="gm-combat-cd" style="transform:scaleY(' +
        pct +
        ')"></span>';
      div.title = sp ? sp.name : "";
      combatSlotsEl.appendChild(div);
    }
  }

  function showOverlay(title, body, buttonLabel) {
    if (!overlay) return;
    overlay.hidden = false;
    if (overlayTitle) overlayTitle.textContent = title;
    if (overlayBody) overlayBody.innerHTML = body;
    if (btnStart) btnStart.textContent = buttonLabel || "Play";
  }

  function hideOverlay() {
    if (overlay) overlay.hidden = true;
  }

  function startGame() {
    state.mode = "play";
    state.t = 0;
    state.score = 0;
    state.combo = 0;
    state.maxCombo = 0;
    state.kills = 0;
    state.survival = 0;
    state.player = resetPlayer();
    state.entities = [];
    state.enemies = [];
    state.bullets = [];
    state.eBullets = [];
    state.particles = [];
    state.floaters = [];
    state.activeSlot = 0;
    state.cooldowns = [0, 0, 0];
    state.spawnAcc = 0;
    state.nextSpawn = 1.2;
    state.enemySpawnAcc = 0;
    state.nextEnemy = 1.4;
    hideOverlay();
    ensureAudio();
    beep(520, 0.06, "triangle", 0.05);
    setHud();
    if (!state.raf) loop(performance.now());

    // Boss round when image already loaded; otherwise generation continues from wall
    if (boss.img && (boss.phase === "ready" || boss.phase === "idle" || boss.phase === "generating")) {
      if (boss.img.complete && boss.phase !== "generating") {
        spawnBossEntity();
      }
    } else if (boss.phase === "active" && boss.img) {
      // already active from prior mid-run — keep
    } else if (!boss.img && galleryBg.nums.length && boss.phase === "idle") {
      beginBossFromWall(galleryBg.shuffleGen);
    }
  }

  function killPlayer() {
    if (state.mode !== "play") return;
    state.mode = "dead";
    state.combo = 0;
    removeBossEnemies();
    boss.phase = "idle";
    boss.img = null;
    boss.imageUrl = "";
    beep(110, 0.25, "sawtooth", 0.07);
    if (state.score > highScore) {
      highScore = Math.floor(state.score);
      try {
        localStorage.setItem(HS_KEY, String(highScore));
      } catch (_) {}
    }
    setHud();
    const wallNote =
      galleryBg.nums && galleryBg.nums.length
        ? "Wall was #" + galleryBg.nums.join(", #") + " — reshuffling a <strong>different</strong> six."
        : "Reshuffling the wall.";
    showOverlay(
      "Brush broken",
      "Score <strong>" +
        Math.floor(state.score) +
        "</strong> · Best <strong>" +
        highScore +
        "</strong><br/>Survived " +
        Math.floor(state.survival) +
        "s · " +
        state.kills +
        " kills · combo ×" +
        Math.max(1, state.maxCombo) +
        "<br/><br/>" +
        wallNote,
      "Play again"
    );
    onPlayerLostReshuffle();
  }

  function hurtPlayer(dmg) {
    const p = state.player;
    if (!p || p.invuln > 0 || state.mode !== "play") return;
    p.hp -= dmg;
    p.invuln = 0.7;
    state.combo = 0;
    beep(160, 0.1, "sawtooth", 0.06);
    spawnBurst(p.x + p.w / 2, p.y + p.h / 2, "#ff6b6b", 10);
    if (p.hp <= 0) {
      p.hp = 0;
      killPlayer();
    }
    setHud();
  }

  function spawnBurst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 80 + Math.random() * 220;
      state.particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 60,
        life: 0.35 + Math.random() * 0.45,
        max: 0.8,
        r: 2 + Math.random() * 3,
        color,
      });
    }
  }

  function floater(x, y, text, color) {
    state.floaters.push({ x, y, text, color: color || "#ffe8a0", life: 0.9 });
  }

  function spawnPickup() {
    const r = Math.random();
    const x = 40 + Math.random() * (W - 80);
    const y = GROUND_Y - 50 - Math.random() * 160;
    if (r < 0.18) {
      state.entities.push({ type: "heart", x, y, w: 18, h: 16, bob: Math.random() * 6, life: 12 });
    } else if (r < 0.4) {
      state.entities.push({
        type: "masterpiece",
        x,
        y,
        w: 32,
        h: 38,
        bob: Math.random() * 6,
        life: 14,
      });
    } else {
      state.entities.push({
        type: "pigment",
        x,
        y,
        w: 16,
        h: 16,
        bob: Math.random() * 6,
        hue: Math.floor(Math.random() * 360),
        life: 12,
      });
    }
  }

  function spawnEnemy() {
    let pool = ["blot", "brushling"];
    if (state.survival > 25) pool.push("wraith");
    if (state.survival > 45) pool.push("frame");
    if (state.survival > 80) pool = Object.keys(ENEMY_KINDS);
    const kind = pool[Math.floor(Math.random() * pool.length)];
    const def = ENEMY_KINDS[kind];
    const side = Math.random() < 0.5 ? 0 : 1;
    const x = side === 0 ? -def.w - 10 : W + 10;
    const fly = def.fly;
    const y = fly ? 80 + Math.random() * (GROUND_Y - 160) : GROUND_Y - def.h;
    const [cdMin, cdMax] = def.shootCd;
    const hp = def.hp + Math.floor(state.survival / 20) * 5;
    state.enemies.push({
      kind,
      x,
      y,
      w: def.w,
      h: def.h,
      hp,
      maxHp: hp,
      baseY: y,
      bob: Math.random() * Math.PI * 2,
      shootT: 0.5 + Math.random() * 0.8,
      shootCd: cdMin + Math.random() * (cdMax - cdMin),
      frame: 0,
      anim: 0,
      flash: 0,
      vx: (side === 0 ? 1 : -1) * def.speed * (0.7 + Math.random() * 0.5),
      wander: 0,
    });
  }

  function rectsOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function playerCenter() {
    const p = state.player;
    if (!p) return { x: W / 2, y: H / 2 };
    return { x: p.x + p.w / 2, y: p.y + p.h * 0.35 };
  }

  function aimAngle() {
    const c = playerCenter();
    if (state.pointer.over) {
      return Math.atan2(state.pointer.y - c.y, state.pointer.x - c.x);
    }
    const p = state.player;
    return p && p.facing < 0 ? Math.PI : 0;
  }

  function nearestEnemy(fromX, fromY) {
    let best = null;
    let bestD = Infinity;
    for (const e of state.enemies) {
      const cx = e.x + e.w / 2;
      const cy = e.y + e.h / 2;
      const d = (cx - fromX) * (cx - fromX) + (cy - fromY) * (cy - fromY);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  function firePlayerSpell() {
    if (state.mode !== "play") return;
    const p = state.player;
    if (!p) return;
    const slot = state.activeSlot;
    const id = loadout[slot];
    const sp = SPELLS[id];
    if (!sp) return;
    if ((state.cooldowns[slot] || 0) > 0) return;

    state.cooldowns[slot] = sp.cooldown;
    const c = playerCenter();
    const base = aimAngle();
    // Face toward aim
    p.facing = Math.cos(base) >= 0 ? 1 : -1;

    const mk = (angle) => {
      state.bullets.push({
        x: c.x + Math.cos(angle) * 16,
        y: c.y + Math.sin(angle) * 10,
        vx: Math.cos(angle) * sp.speed,
        vy: Math.sin(angle) * sp.speed,
        r: sp.size,
        dmg: sp.damage,
        life: sp.life,
        pierce: sp.pierce,
        color: sp.color,
        spell: sp.id,
        homing: sp.homing,
        hit: new Set(),
      });
    };

    if (sp.pattern === "fan" || sp.pattern === "burst") {
      const n = sp.count;
      const spread = sp.spread;
      for (let i = 0; i < n; i++) {
        const t = n === 1 ? 0 : (i / (n - 1) - 0.5) * 2;
        mk(base + t * spread);
      }
    } else {
      mk(base);
    }

    beep(sp.id === "beam" ? 900 : 480 + slot * 40, 0.04, "square", 0.04);
    spawnBurst(c.x, c.y, sp.color, 3);
  }

  function enemyShoot(e) {
    const isBoss = !!e.isBoss;
    const def = isBoss
      ? {
          projSpeed: 360,
          projDmg: 14,
          color: "#e8c060",
          spreadShot: true,
        }
      : ENEMY_KINDS[e.kind];
    if (!def) return;
    const p = state.player;
    if (!p) return;
    const ex = e.x + e.w / 2;
    const ey = e.y + e.h * 0.4;
    const px = p.x + p.w / 2;
    const py = p.y + p.h / 2;
    const dx = px - ex;
    const dy = py - ey;
    const len = Math.hypot(dx, dy) || 1;
    const vx = (dx / len) * def.projSpeed;
    const vy = (dy / len) * def.projSpeed;

    const fireOne = (ovx, ovy, r, dmg) => {
      state.eBullets.push({
        x: ex,
        y: ey,
        vx: ovx,
        vy: ovy,
        r: r || (isBoss ? 7 : 5),
        dmg: dmg || def.projDmg,
        life: 3.5,
        color: def.color,
      });
    };

    if (def.spreadShot || isBoss) {
      const ang = Math.atan2(vy, vx);
      const spread = isBoss ? 0.32 : 0.25;
      fireOne(Math.cos(ang - spread) * def.projSpeed, Math.sin(ang - spread) * def.projSpeed);
      fireOne(vx, vy);
      fireOne(Math.cos(ang + spread) * def.projSpeed, Math.sin(ang + spread) * def.projSpeed);
      if (isBoss) {
        fireOne(Math.cos(ang) * def.projSpeed * 0.85, Math.sin(ang) * def.projSpeed * 0.85, 9, 18);
      }
    } else {
      fireOne(vx, vy);
    }
    beep(isBoss ? 160 : 220, 0.05, "sawtooth", 0.035);
  }

  function tryJump() {
    if (state.mode === "title" || state.mode === "dead") {
      startGame();
      return;
    }
    if (state.mode === "pause") {
      state.mode = "play";
      hideOverlay();
      setHud();
      return;
    }
    if (state.mode !== "play") return;
    const p = state.player;
    if (!p || p.jumpsLeft <= 0) return;
    const first = p.jumpsLeft === 2 || p.onGround;
    p.vy = first ? JUMP_V : DOUBLE_JUMP_V;
    p.onGround = false;
    p.jumpsLeft -= 1;
    p.brushAngle = -0.45;
    beep(first ? 440 : 620, 0.05, "triangle", 0.045);
    spawnBurst(p.x + p.w / 2, p.y + p.h, "rgba(180,220,255,0.9)", 6);
  }

  function togglePause() {
    if (state.mode === "play") {
      state.mode = "pause";
      showOverlay(
        "Paused",
        "Walk freely · aim with mouse · fire spells.<br/><br/><kbd>A</kbd>/<kbd>D</kbd> move · <kbd>Space</kbd> jump · <kbd>Z</kbd> fire",
        "Resume"
      );
      setHud();
    } else if (state.mode === "pause") {
      state.mode = "play";
      hideOverlay();
      setHud();
    }
  }

  function damageEnemy(e, dmg, bx, by) {
    e.hp -= dmg;
    e.flash = 0.12;
    floater(e.x + e.w / 2, e.y, "-" + Math.round(dmg), "#ffd0a0");
    spawnBurst(bx, by, "#ffe0a0", 4);
    if (e.hp <= 0) {
      const wasBoss = !!e.isBoss;
      const def = ENEMY_KINDS[e.kind];
      const pts =
        (wasBoss ? 400 : def ? def.score : 40) + Math.floor(state.combo * 3);
      state.score += pts;
      state.combo += 1;
      state.maxCombo = Math.max(state.maxCombo, state.combo);
      state.kills += 1;
      floater(e.x + e.w / 2, e.y - 10, "+" + pts, wasBoss ? "#ffd78a" : "#7dffb3");
      spawnBurst(e.x + e.w / 2, e.y + e.h / 2, wasBoss ? "#e8c060" : def ? def.color : "#fff", wasBoss ? 28 : 16);
      beep(wasBoss ? 520 : 700, wasBoss ? 0.15 : 0.07, "triangle", 0.06);
      if (Math.random() < (wasBoss ? 1 : 0.35)) {
        state.entities.push({
          type: "pigment",
          x: e.x,
          y: e.y,
          w: 16,
          h: 16,
          bob: 0,
          hue: Math.floor(Math.random() * 360),
          life: 10,
        });
      }
      if (wasBoss || Math.random() < 0.1) {
        state.entities.push({
          type: "heart",
          x: e.x + 10,
          y: e.y,
          w: 18,
          h: 16,
          bob: 0,
          life: 10,
        });
      }
      if (wasBoss) {
        // Defer wall reshuffle so enemy is removed first
        setTimeout(function () {
          onBossDefeated();
        }, 80);
      }
      return true;
    }
    if (e.isBoss && elBossStatus) {
      setBossStatus("BOSS · " + Math.max(0, Math.ceil(e.hp)) + " / " + e.maxHp + " HP", "boss");
    }
    return false;
  }

  function update(dt) {
    if (state.mode !== "play") return;
    const p = state.player;
    if (!p) return;

    state.t += dt;
    state.survival += dt;
    state.score += dt * 2 * (1 + Math.max(0, state.combo - 1) * 0.05);

    for (let i = 0; i < state.cooldowns.length; i++) {
      if (state.cooldowns[i] > 0) state.cooldowns[i] = Math.max(0, state.cooldowns[i] - dt);
    }

    // Horizontal free movement
    let mx = 0;
    if (state.keys.ArrowLeft || state.keys.a || state.keys.A) mx -= 1;
    if (state.keys.ArrowRight || state.keys.d || state.keys.D) mx += 1;
    if (mx !== 0) {
      p.x += mx * MOVE_SPEED * dt;
      p.facing = mx > 0 ? 1 : -1;
    }
    // Clamp to arena
    p.x = Math.max(8, Math.min(W - p.w - 8, p.x));

    if (state.fireHeld || state.keys.z || state.keys.Z || state.keys.j || state.keys.J || state.keys.Control) {
      firePlayerSpell();
    }

    // Physics jump
    p.vy += GRAVITY * dt;
    p.y += p.vy * dt;
    if (p.y + p.h >= GROUND_Y) {
      p.y = GROUND_Y - p.h;
      p.vy = 0;
      if (!p.onGround) {
        p.onGround = true;
        p.jumpsLeft = 2;
        p.brushAngle = 0.15;
      }
    } else {
      p.onGround = false;
    }
    // Ceiling
    if (p.y < 8) {
      p.y = 8;
      if (p.vy < 0) p.vy = 0;
    }
    p.brushAngle *= 0.9;
    if (p.invuln > 0) p.invuln -= dt;
    p.blink += dt;

    // Pickups
    state.spawnAcc += dt;
    if (state.spawnAcc >= state.nextSpawn) {
      state.spawnAcc = 0;
      state.nextSpawn = 2 + Math.random() * 2;
      if (state.entities.length < 10) spawnPickup();
    }

    // Enemies (fewer trash mobs while boss is active)
    state.enemySpawnAcc += dt;
    if (state.enemySpawnAcc >= state.nextEnemy) {
      state.enemySpawnAcc = 0;
      const bossActive = boss.phase === "active";
      state.nextEnemy = Math.max(
        0.65,
        (bossActive ? 2.4 : 1.7) - state.survival / 90 + Math.random() * 0.4
      );
      const cap = bossActive ? 6 : 12;
      const nonBoss = state.enemies.filter(function (e) {
        return !e.isBoss;
      }).length;
      if (nonBoss < cap) spawnEnemy();
      if (!bossActive && state.survival > 40 && nonBoss < 10 && Math.random() < 0.4) spawnEnemy();
    }

    const hitbox = {
      x: p.x + 6,
      y: p.y + 8,
      w: p.w - 12,
      h: p.h - 10,
    };

    for (let i = state.entities.length - 1; i >= 0; i--) {
      const e = state.entities[i];
      e.bob += dt * 3.2;
      e.life -= dt;
      const bobY = Math.sin(e.bob) * 6;
      const box = { x: e.x, y: e.y + bobY, w: e.w, h: e.h };
      if (e.life <= 0) {
        state.entities.splice(i, 1);
        continue;
      }
      if (rectsOverlap(hitbox, box)) {
        if (e.type === "heart") {
          p.hp = Math.min(p.maxHp, p.hp + 22);
          floater(e.x, e.y, "+HP", "#ff8899");
          beep(640, 0.08, "sine", 0.05);
        } else {
          const pts =
            e.type === "masterpiece" ? 50 + Math.floor(state.combo * 4) : 10 + Math.floor(state.combo * 1.5);
          state.score += pts;
          state.combo += 1;
          state.maxCombo = Math.max(state.maxCombo, state.combo);
          floater(e.x, e.y, "+" + pts, e.type === "masterpiece" ? "#ffd78a" : "#7dffb3");
          beep(e.type === "masterpiece" ? 880 : 660, 0.06, "sine", 0.05);
        }
        spawnBurst(e.x + e.w / 2, e.y + e.h / 2, "#fff", 8);
        state.entities.splice(i, 1);
      }
    }

    for (let i = state.enemies.length - 1; i >= 0; i--) {
      const e = state.enemies[i];
      const isBoss = !!e.isBoss;
      const def = isBoss
        ? { speed: 95, fly: true, shootCd: e.shootCd || [0.7, 1.15] }
        : ENEMY_KINDS[e.kind];
      e.anim += dt;
      e.frame = Math.floor(e.anim * 6) % 4;
      if (e.flash > 0) e.flash -= dt;
      e.bob += dt * 2.5;
      e.wander -= dt;

      const pcx = p.x + p.w / 2;
      const ecx = e.x + e.w / 2;
      const chase = pcx > ecx ? 1 : -1;
      const spd = def ? def.speed : 60;
      if (e.wander <= 0) {
        e.vx = chase * spd * (0.5 + Math.random() * 0.7);
        if (!isBoss && Math.random() < 0.25) e.vx *= -1;
        e.wander = isBoss ? 0.35 + Math.random() * 0.5 : 0.6 + Math.random() * 1.2;
      }
      e.x += e.vx * dt;
      if (e.x < 8) {
        e.x = 8;
        e.vx = Math.abs(e.vx);
      }
      if (e.x + e.w > W - 8) {
        e.x = W - 8 - e.w;
        e.vx = -Math.abs(e.vx);
      }

      if (def && def.fly) {
        e.y = e.baseY + Math.sin(e.bob) * (isBoss ? 28 : 22);
        e.baseY += (p.y + 20 - e.baseY) * (isBoss ? 0.35 : 0.15) * dt;
        e.baseY = Math.max(40, Math.min(GROUND_Y - e.h - 20, e.baseY));
      } else {
        e.y = GROUND_Y - e.h;
      }

      e.shootT -= dt;
      if (e.shootT <= 0) {
        enemyShoot(e);
        const cds = def.shootCd || [1, 2];
        const a = cds[0];
        const b = cds[1];
        e.shootT = (a + Math.random() * (b - a)) * Math.max(0.5, 1 - state.survival / 200);
      }

      if (
        p.invuln <= 0 &&
        rectsOverlap(hitbox, { x: e.x + 4, y: e.y + 4, w: e.w - 8, h: e.h - 8 })
      ) {
        hurtPlayer(isBoss ? 22 : 14);
      }
    }

    // Player bullets
    for (let i = state.bullets.length - 1; i >= 0; i--) {
      const b = state.bullets[i];
      if (b.homing > 0) {
        const tgt = nearestEnemy(b.x, b.y);
        if (tgt) {
          const tx = tgt.x + tgt.w / 2;
          const ty = tgt.y + tgt.h / 2;
          const ang = Math.atan2(ty - b.y, tx - b.x);
          const spd = Math.hypot(b.vx, b.vy) || 400;
          const cur = Math.atan2(b.vy, b.vx);
          let diff = ang - cur;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          const turn = Math.max(-b.homing * dt, Math.min(b.homing * dt, diff));
          const na = cur + turn;
          b.vx = Math.cos(na) * spd;
          b.vy = Math.sin(na) * spd;
        }
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (b.life <= 0 || b.x < -40 || b.x > W + 40 || b.y < -40 || b.y > H + 40) {
        state.bullets.splice(i, 1);
        continue;
      }
      const bbox = { x: b.x - b.r, y: b.y - b.r, w: b.r * 2, h: b.r * 2 };
      let remove = false;
      for (let j = state.enemies.length - 1; j >= 0; j--) {
        const e = state.enemies[j];
        if (b.hit.has(e)) continue;
        if (rectsOverlap(bbox, e)) {
          b.hit.add(e);
          const dead = damageEnemy(e, b.dmg, b.x, b.y);
          if (dead) state.enemies.splice(j, 1);
          if (b.pierce > 0) b.pierce -= 1;
          else {
            remove = true;
            break;
          }
        }
      }
      if (remove) state.bullets.splice(i, 1);
    }

    for (let i = state.eBullets.length - 1; i >= 0; i--) {
      const b = state.eBullets[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (b.life <= 0 || b.x < -40 || b.x > W + 40 || b.y < -40 || b.y > H + 40) {
        state.eBullets.splice(i, 1);
        continue;
      }
      if (p.invuln <= 0 && rectsOverlap(hitbox, { x: b.x - b.r, y: b.y - b.r, w: b.r * 2, h: b.r * 2 })) {
        hurtPlayer(b.dmg);
        state.eBullets.splice(i, 1);
        spawnBurst(b.x, b.y, "#ff8899", 6);
      }
    }

    for (let i = state.particles.length - 1; i >= 0; i--) {
      const pt = state.particles[i];
      pt.life -= dt;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.vy += 400 * dt;
      if (pt.life <= 0) state.particles.splice(i, 1);
    }
    for (let i = state.floaters.length - 1; i >= 0; i--) {
      const f = state.floaters[i];
      f.life -= dt;
      f.y -= 40 * dt;
      if (f.life <= 0) state.floaters.splice(i, 1);
    }

    setHud();
  }

  function drawPlayer(p) {
    if (!p) return;
    const flash = p.invuln > 0 && Math.floor(p.blink * 16) % 2 === 0;
    if (flash) return;

    const aim = aimAngle();
    ctx.save();
    ctx.translate(p.x + p.w / 2, p.y + p.h / 2);
    ctx.scale(p.facing < 0 ? -1 : 1, 1);
    ctx.rotate(p.brushAngle || 0);

    ctx.fillStyle = "#2a4058";
    ctx.fillRect(-8, -4, 16, 22);
    ctx.fillStyle = "#8b5a2b";
    ctx.fillRect(-4, 14, 8, 14);
    ctx.fillStyle = "#c0c8d0";
    ctx.fillRect(-7, 8, 14, 8);
    const br = ctx.createLinearGradient(0, -22, 0, 0);
    br.addColorStop(0, "#6eb0e8");
    br.addColorStop(0.5, "#c9a24a");
    br.addColorStop(1, "#e07070");
    ctx.fillStyle = br;
    ctx.beginPath();
    ctx.moveTo(-12, 8);
    ctx.lineTo(-14, -20);
    ctx.lineTo(0, -24);
    ctx.lineTo(14, -20);
    ctx.lineTo(12, 8);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#f0f6fc";
    ctx.beginPath();
    ctx.arc(4, -2, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Aim line
    const c = playerCenter();
    const sp = SPELLS[loadout[state.activeSlot]];
    ctx.strokeStyle = sp ? sp.color : "#8cf";
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(c.x, c.y);
    ctx.lineTo(c.x + Math.cos(aim) * 48, c.y + Math.sin(aim) * 48);
    ctx.stroke();
    ctx.globalAlpha = 1;

    const pct = Math.max(0, p.hp / p.maxHp);
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(p.x, p.y - 10, p.w, 5);
    ctx.fillStyle = pct > 0.35 ? "#5dce8a" : "#e06060";
    ctx.fillRect(p.x, p.y - 10, p.w * pct, 5);

    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.ellipse(p.x + p.w / 2, GROUND_Y - 2, 16, 5, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawEnemySprite(e) {
    const f = e.frame || 0;
    const bob = Math.sin(e.anim * 8 + f) * 2;

    if (e.isBoss && e.sprite) {
      ctx.save();
      if (e.flash > 0) ctx.globalAlpha = 0.55 + Math.sin(e.flash * 80) * 0.45;
      // Gold frame around boss image
      ctx.fillStyle = "#1a1208";
      ctx.fillRect(e.x - 6, e.y - 6 + bob, e.w + 12, e.h + 12);
      ctx.strokeStyle = "rgba(232, 192, 96, 0.95)";
      ctx.lineWidth = 3;
      ctx.strokeRect(e.x - 6.5, e.y - 6.5 + bob, e.w + 13, e.h + 13);
      drawImageCover(e.sprite, e.x, e.y + bob, e.w, e.h);
      // Pulse ring
      ctx.strokeStyle = "rgba(255, 210, 120, " + (0.35 + 0.25 * Math.sin(e.anim * 4)) + ")";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(e.x + e.w / 2, e.y + e.h / 2 + bob, e.w * 0.62, e.h * 0.62, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      const pct = Math.max(0, e.hp / e.maxHp);
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(e.x - 10, e.y - 18 + bob, e.w + 20, 8);
      ctx.fillStyle = "#e8c060";
      ctx.fillRect(e.x - 10, e.y - 18 + bob, (e.w + 20) * pct, 8);
      ctx.fillStyle = "#ffe8b0";
      ctx.font = "bold 11px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("WALL BOSS", e.x + e.w / 2, e.y - 22 + bob);
      return;
    }

    ctx.save();
    ctx.translate(e.x + e.w / 2, e.y + e.h / 2 + bob);
    if (e.vx < 0) ctx.scale(-1, 1);
    if (e.flash > 0) ctx.globalAlpha = 0.55 + Math.sin(e.flash * 80) * 0.45;

    if (e.kind === "blot") {
      const squash = 1 + (f % 2 === 0 ? 0.08 : -0.06);
      ctx.scale(squash, 2 - squash);
      ctx.fillStyle = "#2a3a50";
      ctx.beginPath();
      ctx.ellipse(0, 4, 18, 14, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#5a80b0";
      ctx.beginPath();
      ctx.ellipse(0, 0, 16, 14, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#a0c8f0";
      ctx.beginPath();
      ctx.arc(-5, -3, 4, 0, Math.PI * 2);
      ctx.arc(6, -2, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#101820";
      ctx.beginPath();
      ctx.arc(-4, -3, 1.8, 0, Math.PI * 2);
      ctx.arc(7, -2, 1.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#4a70a0";
      ctx.fillRect(-2, 12, 4, 6 + (f % 3));
    } else if (e.kind === "wraith") {
      ctx.fillStyle = "rgba(80,30,90,0.85)";
      ctx.beginPath();
      ctx.moveTo(0, -22);
      ctx.quadraticCurveTo(18, -8, 12, 20);
      ctx.quadraticCurveTo(0, 10 + f * 2, -12, 20);
      ctx.quadraticCurveTo(-18, -8, 0, -22);
      ctx.fill();
      ctx.fillStyle = "#e080ff";
      ctx.beginPath();
      ctx.arc(-5, -6, 3, 0, Math.PI * 2);
      ctx.arc(6, -6, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#200828";
      ctx.fillRect(-7, -7, 3, 3);
      ctx.fillRect(4, -7, 3, 3);
    } else if (e.kind === "frame") {
      ctx.fillStyle = "#1a1208";
      ctx.fillRect(-18, -18, 36, 36);
      const pg = ctx.createLinearGradient(-14, -14, 14, 14);
      pg.addColorStop(0, "#804030");
      pg.addColorStop(1, "#305080");
      ctx.fillStyle = pg;
      ctx.fillRect(-14, -14, 28, 28);
      ctx.strokeStyle = "#d4a84a";
      ctx.lineWidth = 3;
      ctx.strokeRect(-18, -18, 36, 36);
      ctx.strokeStyle = "#fff0c0";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-4, -14);
      ctx.lineTo(2, 0);
      ctx.lineTo(-6, 14);
      ctx.stroke();
      ctx.fillStyle = "#f44";
      ctx.beginPath();
      ctx.arc(0, 2 + (f % 2), 3, 0, Math.PI * 2);
      ctx.fill();
    } else if (e.kind === "brushling") {
      ctx.rotate(-0.2 + Math.sin(e.anim * 10) * 0.15);
      ctx.fillStyle = "#6a4420";
      ctx.fillRect(-3, -4, 6, 20);
      ctx.fillStyle = "#c0c8d0";
      ctx.fillRect(-5, -8, 10, 6);
      ctx.fillStyle = "#40a070";
      ctx.beginPath();
      ctx.moveTo(-10, -8);
      ctx.lineTo(-12, -22 - (f % 2) * 2);
      ctx.lineTo(0, -26);
      ctx.lineTo(12, -22);
      ctx.lineTo(10, -8);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(3, 2, 2, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();

    if (e.hp < e.maxHp) {
      const pct = Math.max(0, e.hp / e.maxHp);
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(e.x, e.y - 8, e.w, 4);
      ctx.fillStyle = "#e07070";
      ctx.fillRect(e.x, e.y - 8, e.w * pct, 4);
    }
  }

  function drawEntity(e) {
    const bobY = Math.sin(e.bob || 0) * 6;
    const y = e.y + bobY;
    if (e.type === "pigment") {
      const grd = ctx.createRadialGradient(e.x + 8, y + 6, 1, e.x + 8, y + 8, 10);
      grd.addColorStop(0, "#fff");
      grd.addColorStop(0.35, "hsl(" + e.hue + ",90%,60%)");
      grd.addColorStop(1, "hsla(" + e.hue + ",80%,40%,0)");
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(e.x + e.w / 2, y + e.h / 2, 9, 0, Math.PI * 2);
      ctx.fill();
    } else if (e.type === "masterpiece") {
      ctx.fillStyle = "#1a1208";
      ctx.fillRect(e.x, y, e.w, e.h);
      const pg = ctx.createLinearGradient(e.x, y, e.x + e.w, y + e.h);
      pg.addColorStop(0, "#c07050");
      pg.addColorStop(0.5, "#5080c0");
      pg.addColorStop(1, "#c0a040");
      ctx.fillStyle = pg;
      ctx.fillRect(e.x + 4, y + 4, e.w - 8, e.h - 8);
      ctx.strokeStyle = "#e8c878";
      ctx.lineWidth = 3;
      ctx.strokeRect(e.x + 1, y + 1, e.w - 2, e.h - 2);
    } else if (e.type === "heart") {
      ctx.fillStyle = "#e05070";
      ctx.beginPath();
      const cx = e.x + e.w / 2;
      const cy = y + e.h / 2;
      ctx.moveTo(cx, cy + 5);
      ctx.bezierCurveTo(cx - 12, cy - 4, cx - 6, cy - 12, cx, cy - 6);
      ctx.bezierCurveTo(cx + 6, cy - 12, cx + 12, cy - 4, cx, cy + 5);
      ctx.fill();
    }
  }

  function drawBullet(b, enemy) {
    ctx.save();
    if (enemy) {
      ctx.fillStyle = b.color || "#c44";
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,200,200,0.5)";
      ctx.lineWidth = 1;
      ctx.stroke();
    } else {
      ctx.fillStyle = b.color;
      ctx.shadowColor = b.color;
      ctx.shadowBlur = 8;
      if (b.spell === "beam") {
        const ang = Math.atan2(b.vy, b.vx);
        ctx.translate(b.x, b.y);
        ctx.rotate(ang);
        ctx.fillRect(-10, -1.5, 20, 3);
      } else if (b.spell === "frame") {
        ctx.fillRect(b.x - b.r, b.y - b.r, b.r * 2, b.r * 2);
        ctx.strokeStyle = "#fff8d0";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(b.x - b.r, b.y - b.r, b.r * 2, b.r * 2);
      } else {
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function draw() {
    drawGalleryBackground();

    for (const e of state.entities) drawEntity(e);
    for (const e of state.enemies) drawEnemySprite(e);
    for (const b of state.eBullets) drawBullet(b, true);
    for (const b of state.bullets) drawBullet(b, false);
    drawPlayer(state.player);

    for (const pt of state.particles) {
      ctx.globalAlpha = Math.max(0, pt.life / (pt.max || 0.8));
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    for (const f of state.floaters) {
      ctx.globalAlpha = Math.max(0, f.life);
      ctx.fillStyle = f.color;
      ctx.font = "bold 14px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(f.text, f.x, f.y);
      ctx.globalAlpha = 1;
    }

    if (state.mode === "play" && state.t < 4.5) {
      ctx.fillStyle = "rgba(240,245,255,0.7)";
      ctx.font = "13px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("A/D or ←/→ walk · Space jump · mouse aim · Z/J fire · 1–3 spells", W / 2, 28);
    }

    if (state.mode === "title") {
      if (!state.player) state.player = resetPlayer();
      state.player.y = GROUND_Y - 48 + Math.sin(performance.now() / 400) * 4;
      drawPlayer(state.player);
    }
  }

  function loop(ts) {
    // Fully idle when Game tab is not active — no sim ticks, no credit work
    if (!isGameTabActive() && !state.tabVisible) {
      state.raf = 0;
      state.lastTs = 0;
      return;
    }
    state.raf = requestAnimationFrame(loop);
    if (!state.tabVisible) {
      state.lastTs = ts;
      return;
    }
    const dt = state.lastTs ? Math.min(0.033, (ts - state.lastTs) / 1000) : 0.016;
    state.lastTs = ts;
    update(dt);
    draw();
  }

  function canvasPoint(e) {
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width;
    const sy = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * sx,
      y: (e.clientY - rect.top) * sy,
    };
  }

  function isTypingTarget(t) {
    if (!t || t === document.body || t === document.documentElement) return false;
    if (t.isContentEditable) return true;
    const el = t.nodeType === 1 ? t : t.parentElement;
    if (!el) return false;
    if (el.closest && el.closest("input, textarea, select, [contenteditable='true'], [contenteditable='']")) {
      return true;
    }
    const tag = (el.tagName || "").toLowerCase();
    return tag === "input" || tag === "textarea" || tag === "select";
  }

  function isGameTabActive() {
    if (document.body.getAttribute("data-active-tab") === "game") return true;
    if (document.body.classList.contains("gm-tab-active")) return true;
    const panel = document.getElementById("panel-game");
    return !!(panel && !panel.hidden && panel.classList.contains("active"));
  }

  function onKey(e, down) {
    // Never steal keys from prompts/search fields (Spells, Book, etc.)
    if (isTypingTarget(e.target)) {
      if (!down) {
        // Clear held game keys so jump/move don't stick after leaving a field
        const k = e.key;
        if (state.keys[k]) state.keys[k] = false;
      }
      return;
    }
    // Only handle combat shortcuts while the Game tab is open
    if (!isGameTabActive()) {
      if (!down) {
        const k = e.key;
        if (state.keys[k]) state.keys[k] = false;
      }
      return;
    }

    if (e.repeat && down) return;
    const k = e.key;
    state.keys[k] = down;
    if (!down) return;

    if (k === "1" || k === "2" || k === "3") {
      const slot = parseInt(k, 10) - 1;
      state.activeSlot = slot;
      if (state.mode === "title" || state.mode === "dead" || state.mode === "pause") {
        pickSlot = slot;
        renderLoadoutUI();
      }
      setHud();
      beep(400 + slot * 80, 0.03, "triangle", 0.03);
      e.preventDefault();
      return;
    }

    if (k === " ") {
      e.preventDefault();
      tryJump();
    } else if (k === "p" || k === "P" || k === "Escape") {
      e.preventDefault();
      if (state.mode === "play" || state.mode === "pause") togglePause();
    } else if (k === "Enter" && (state.mode === "title" || state.mode === "dead" || state.mode === "pause")) {
      e.preventDefault();
      if (state.mode === "pause") {
        state.mode = "play";
        hideOverlay();
        setHud();
      } else startGame();
    } else if (k === "z" || k === "Z" || k === "j" || k === "J") {
      e.preventDefault();
      firePlayerSpell();
    } else if (k === "r" || k === "R") {
      if (state.mode !== "play") {
        loadGalleryBackdrop({ exclude: galleryBg.nums.slice(), clearExclude: true });
        beep(360, 0.05, "triangle", 0.04);
      }
    }
  }

  window.addEventListener("keydown", (e) => onKey(e, true));
  window.addEventListener("keyup", (e) => onKey(e, false));

  canvas.addEventListener("pointermove", (e) => {
    const pt = canvasPoint(e);
    state.pointer.x = pt.x;
    state.pointer.y = pt.y;
    state.pointer.over = true;
  });
  canvas.addEventListener("pointerleave", () => {
    state.pointer.over = false;
  });
  canvas.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    const pt = canvasPoint(e);
    state.pointer.x = pt.x;
    state.pointer.y = pt.y;
    state.pointer.over = true;
    if (e.button === 2 || e.button === 1 || e.shiftKey || e.ctrlKey) {
      state.fireHeld = true;
      firePlayerSpell();
    } else if (e.button === 0) {
      // Left click: fire toward cursor (free-aim arena)
      if (state.mode === "title" || state.mode === "dead") {
        startGame();
      } else if (state.mode === "pause") {
        state.mode = "play";
        hideOverlay();
        setHud();
      } else {
        state.fireHeld = true;
        firePlayerSpell();
      }
    }
  });
  canvas.addEventListener("pointerup", (e) => {
    state.fireHeld = false;
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch (_) {}
  });
  canvas.addEventListener("pointercancel", () => {
    state.fireHeld = false;
  });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  const btnFire = document.getElementById("gm-fire");
  if (btnFire) {
    const startFire = (e) => {
      e.preventDefault();
      state.fireHeld = true;
      firePlayerSpell();
    };
    const endFire = (e) => {
      e.preventDefault();
      state.fireHeld = false;
    };
    btnFire.addEventListener("pointerdown", startFire);
    btnFire.addEventListener("pointerup", endFire);
    btnFire.addEventListener("pointerleave", endFire);
    btnFire.addEventListener("pointercancel", endFire);
  }

  const btnJump = document.getElementById("gm-jump");
  if (btnJump) {
    btnJump.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      tryJump();
    });
  }

  // Optional left/right mobile buttons
  const btnLeft = document.getElementById("gm-left");
  const btnRight = document.getElementById("gm-right");
  if (btnLeft) {
    btnLeft.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      state.keys.a = true;
    });
    const up = (e) => {
      e.preventDefault();
      state.keys.a = false;
    };
    btnLeft.addEventListener("pointerup", up);
    btnLeft.addEventListener("pointerleave", up);
    btnLeft.addEventListener("pointercancel", up);
  }
  if (btnRight) {
    btnRight.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      state.keys.d = true;
    });
    const up = (e) => {
      e.preventDefault();
      state.keys.d = false;
    };
    btnRight.addEventListener("pointerup", up);
    btnRight.addEventListener("pointerleave", up);
    btnRight.addEventListener("pointercancel", up);
  }

  if (btnStart) {
    btnStart.addEventListener("click", () => {
      if (state.mode === "pause") {
        state.mode = "play";
        hideOverlay();
        setHud();
      } else {
        startGame();
      }
    });
  }
  if (btnPause) btnPause.addEventListener("click", () => togglePause());
  if (btnMute) {
    btnMute.addEventListener("click", () => {
      muted = !muted;
      try {
        localStorage.setItem("gallery-brush-dash-muted", muted ? "1" : "0");
      } catch (_) {}
      if (!muted) ensureAudio();
      setHud();
    });
  }
  if (btnShuffleBg) {
    btnShuffleBg.addEventListener("click", () => {
      // Manual shuffle: new six, different from current if possible, new boss fuse
      removeBossEnemies();
      hidePromptEditor();
      boss.phase = "idle";
      boss.img = null;
      loadGalleryBackdrop({
        exclude: galleryBg.nums.slice(),
        clearExclude: true,
      });
      beep(360, 0.05, "triangle", 0.04);
    });
  }

  if (promptEdit) {
    promptEdit.addEventListener("input", function () {
      boss.description = promptEdit.value;
    });
    // Don't steal game keys while typing
    promptEdit.addEventListener("keydown", function (e) {
      e.stopPropagation();
    });
    promptEdit.addEventListener("keyup", function (e) {
      e.stopPropagation();
    });
  }
  if (btnPromptRetry) {
    btnPromptRetry.addEventListener("click", function () {
      retryBossFromPrompt();
    });
  }
  if (btnPromptReset) {
    btnPromptReset.addEventListener("click", function () {
      const nums = (boss.sourceNums && boss.sourceNums.length
        ? boss.sourceNums
        : galleryBg.nums || []
      ).slice();
      boss.description = buildBossDescription(nums);
      syncPromptFromBoss();
      setBossStatus("Prompt reset from wall analyses", "ok");
      beep(400, 0.04, "triangle", 0.035);
    });
  }
  if (btnPromptCopy) {
    btnPromptCopy.addEventListener("click", function () {
      const text = readEditedPrompt();
      if (!text) return;
      const done = function () {
        setBossStatus("Prompt copied", "ok");
        beep(520, 0.04, "sine", 0.035);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(function () {
          if (promptEdit) {
            promptEdit.select();
            try {
              document.execCommand("copy");
              done();
            } catch (_) {}
          }
        });
      } else if (promptEdit) {
        promptEdit.select();
        try {
          document.execCommand("copy");
          done();
        } catch (_) {}
      }
    });
  }
  if (btnPromptClose) {
    btnPromptClose.addEventListener("click", function () {
      // Keep edited text on boss.description for later retry
      boss.description = readEditedPrompt() || boss.description;
      hidePromptEditor();
      setBossStatus(
        boss.description
          ? "Prompt saved in memory — open via status or retry later"
          : "Prompt panel closed",
        "error"
      );
    });
  }

  // Re-open prompt editor from status line when stuck without an image
  if (elBossStatus) {
    elBossStatus.style.cursor = "pointer";
    elBossStatus.title = "Click to open boss prompt editor (when generate fails)";
    elBossStatus.addEventListener("click", function () {
      if (boss.img && boss.phase === "active") return;
      if (boss.phase === "generating") return;
      if (!boss.description && !(boss.sourceNums && boss.sourceNums.length) && !(galleryBg.nums && galleryBg.nums.length)) {
        return;
      }
      if (!boss.description) {
        boss.description = buildBossDescription(boss.sourceNums.length ? boss.sourceNums : galleryBg.nums);
      }
      showPromptEditor(
        boss.error
          ? friendlyGenerateError({ message: boss.error })
          : "Edit the boss generation prompt. Retry when generate is available."
      );
    });
  }

  function onShow() {
    state.tabVisible = true;
    renderLoadoutUI();
    setHud();
    if (galleryBg.status === "loading" || !galleryBg.panels.length) {
      // Only generate boss while Game tab is open
      loadGalleryBackdrop({ skipBoss: false });
    } else if (
      !boss.img &&
      boss.phase !== "generating" &&
      boss.phase !== "active" &&
      galleryBg.nums &&
      galleryBg.nums.length
    ) {
      beginBossFromWall(galleryBg.shuffleGen);
    }
    if (!state.raf) {
      state.lastTs = 0;
      loop(performance.now());
    }
    if (state.mode === "title") {
      showOverlay(
        "Brush Dash",
        "Six of <strong>your paintings</strong> fuse into one boss image (saved when ready).<br/><br/>" +
          "<kbd>A</kbd>/<kbd>D</kbd> move · <kbd>Space</kbd> jump · mouse aim · click/<kbd>Z</kbd> fire · <kbd>1–3</kbd> spells<br/>" +
          "Beat the boss → new wall · lose → different six.",
        "Play"
      );
    }
  }

  function onHide() {
    state.tabVisible = false;
    // Cancel any in-flight boss API generation so credits are not spent off-tab
    if (boss.phase === "generating") {
      boss.gen++;
      boss.phase = "idle";
      setBossStatus("Boss gen paused — left Game tab", "pending");
    }
    if (state.mode === "play") {
      state.mode = "pause";
      showOverlay("Paused", "Tab left — arena paused. No credits spent while away.", "Resume");
      setHud();
    }
    if (state.raf) {
      cancelAnimationFrame(state.raf);
      state.raf = 0;
    }
    // Clear held keys so WASD/space don't stick into Supermarket
    if (state.keys) {
      Object.keys(state.keys).forEach(function (k) {
        state.keys[k] = false;
      });
    }
  }

  window.addEventListener("game-show", onShow);
  window.addEventListener("game-hide", onHide);
  window.addEventListener("tab-changed", (ev) => {
    if (ev.detail && ev.detail.tab === "game") onShow();
    else onHide();
  });
  window.addEventListener("gallery-data-ready", () => {
    // Never start boss generate from a non-game tab (e.g. Supermarket)
    if (!isGameTabActive()) return;
    if (!galleryBg.panels.some((p) => p.ready)) {
      loadGalleryBackdrop({ exclude: galleryBg.nums.slice() });
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state.mode === "play") {
      state.mode = "pause";
      showOverlay("Paused", "Window hidden — arena paused.", "Resume");
      setHud();
    }
  });

  state.player = resetPlayer();
  renderLoadoutUI();
  setHud();
  // Do NOT load backdrop / generate boss until Game tab is shown (saves credits)
  showOverlay(
    "Brush Dash",
    "Six of <strong>your paintings</strong> fuse into one boss image when you open this tab and play.<br/><br/>" +
      "<kbd>A</kbd>/<kbd>D</kbd> move · <kbd>Space</kbd> jump · mouse aim · click/<kbd>Z</kbd> fire · <kbd>1–3</kbd> spells<br/>" +
      "Boss generate only runs while the Game tab is active.",
    "Play"
  );
  draw();
  window.Game = {
    onShow,
    onHide,
    shuffleBackdrop: function () {
      if (!isGameTabActive()) return;
      loadGalleryBackdrop({ exclude: galleryBg.nums.slice(), clearExclude: true });
    },
  };
  window.dispatchEvent(new Event("game-ready"));
})();
