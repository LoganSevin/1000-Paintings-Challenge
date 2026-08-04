/**
 * Muralwalk world/screen coordinate math only — no painting numbers.
 */
(function () {
  if (window.MuralwalkCoords) return;
  var SPEED = 4.2;
  var ORB_R = 40;

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function coordHash(x, y) {
    var h = x * 374761393 + y * 668265263;
    h = (h ^ (h >>> 13)) * 1274126177;
    return (h ^ (h >>> 16)) >>> 0;
  }

  function cameraCenter(w, h) {
    return { x: w / 2, y: h / 2 };
  }

  function worldToScreen(wx, wy, camWx, camWy, w, h) {
    var c = cameraCenter(w, h);
    return { x: c.x + (wx - camWx), y: c.y + (wy - camWy) };
  }

  function screenToWorld(sx, sy, camWx, camWy, w, h) {
    var c = cameraCenter(w, h);
    return { x: camWx + (sx - c.x), y: camWy + (sy - c.y) };
  }

  function updateCamera(camWx, camWy, wx, wy, lerp) {
    if (lerp == null) lerp = 0.26;
    return {
      camWx: camWx + (wx - camWx) * lerp,
      camWy: camWy + (wy - camWy) * lerp,
    };
  }

  function dist(ax, ay, bx, by) {
    var dx = bx - ax;
    var dy = by - ay;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function normalize(dx, dy) {
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    return { dx: dx / len, dy: dy / len, len: len };
  }

  function pushCircle(px, py, cx, cy, minR) {
    var dx = px - cx;
    var dy = py - cy;
    var d2 = dx * dx + dy * dy;
    if (d2 >= minR * minR) return { x: px, y: py };
    var d = Math.sqrt(d2) || 1;
    return { x: cx + (dx / d) * minR, y: cy + (dy / d) * minR };
  }

  function uvFromWorld(wx, wy) {
    return {
      u: 0.5 + wx * 0.0018,
      v: 0.5 + wy * 0.0018,
    };
  }

  function gridScroll(wx, wy, step) {
    return {
      ox: -(((wx % step) + step) % step),
      oy: -(((wy % step) + step) % step),
    };
  }

  function visibleInRect(sx, sy, w, h, margin) {
    margin = margin == null ? 0 : margin;
    return sx > -margin && sy > -margin && sx < w + margin && sy < h + margin;
  }

  function orbOffset(i, salt) {
    salt = salt == null ? 99 : salt;
    return {
      ox: (coordHash(i, salt) % 50) - 25,
      oy: (coordHash(salt, i) % 50) - 25,
    };
  }

  function orbWorldPos(i, ring, ang, px, py) {
    var off = orbOffset(i);
    return {
      x: px + Math.cos(ang) * ring + off.ox,
      y: py + Math.sin(ang) * ring + off.oy,
    };
  }

  function orbSpawnRing(idx, worldSeed) {
    return 55 + (coordHash(idx, worldSeed) % 200);
  }

  function orbSpawnAngle(idx, scoreSalt) {
    return (coordHash(idx, scoreSalt + 7) % 628) / 100;
  }

  var ENTITY_ANGLES = [0.55, 1.9, 3.4, 4.8, 5.9, 2.6, 0.2, 3.9];

  function entityPlacement(index, worldSeed, variant) {
    var i = index;
    return {
      angle: ENTITY_ANGLES[i % ENTITY_ANGLES.length] + variant * 0.12 + (i % 3) * 0.08,
      dist: 200 + i * 95 + (coordHash(i, worldSeed) % 70),
      phase: (coordHash(i, 7) % 628) / 100,
      speed: 0.55 + (coordHash(i, 9) % 8) / 10,
      patrolR: 48 + (coordHash(i, 3) % 50),
      sizeBias: coordHash(i, worldSeed + 17) % 48,
    };
  }

  function obstacleFallbackPlacement(oi) {
    return {
      angle: 1.1 + oi * 1.35,
      dist: 260 + oi * 80,
      slot: oi,
    };
  }

  function enemyFallbackPlacement(ei) {
    return {
      angle: 2.4 + ei * 2.1,
      dist: 320 + ei * 100,
      patrolR: 55 + ei * 20,
      phase: ei,
      speed: 0.75,
      slot: ei + 2,
    };
  }

  var PROP_ANGLES = [-Math.PI / 2, Math.PI / 6, (Math.PI * 2) / 3];

  function propWorldPos(slot, dist) {
    var ang = PROP_ANGLES[slot % 3];
    return {
      x: Math.cos(ang) * dist,
      y: Math.sin(ang) * dist,
      angle: ang,
    };
  }

  function visionCrop(slot, worldSeed, variant) {
    return {
      cropWFrac: 0.34 + (coordHash(slot, variant) % 12) / 100,
      cropHFrac: 0.34 + (coordHash(variant, slot) % 12) / 100,
      u: clamp(0.12 + slot * 0.24 + (variant % 4) * 0.05, 0.05, 0.62),
      v: clamp(0.14 + (coordHash(slot, worldSeed) % 50) / 100, 0.05, 0.62),
      tilt: ((coordHash(slot, worldSeed + 3) % 16) - 8) * 0.012,
    };
  }

  function entityDrawSize(base, index, worldSeed, variant, spread) {
    spread = spread == null ? 36 : spread;
    return base + (coordHash(index, variant + worldSeed) % spread);
  }

  function patrolStep(ent, wx, wy, t) {
    ent.phase += 0.018 * ent.speed;
    ent.x = ent.patrolX + Math.cos(ent.phase) * ent.patrolR;
    ent.y = ent.patrolY + Math.sin(ent.phase) * ent.patrolR;
    var dx = wx - ent.x;
    var dy = wy - ent.y;
    var d = dist(wx, wy, ent.x, ent.y) || 1;
    if (d < 240 && d > 36) {
      ent.patrolX += (dx / d) * ent.speed * 0.35;
      ent.patrolY += (dy / d) * ent.speed * 0.35;
    }
    if (d < 34) {
      return pushCircle(wx, wy, ent.x, ent.y, 38);
    }
    return { x: wx, y: wy };
  }

  window.MuralwalkCoords = {
    SPEED: SPEED,
    ORB_R: ORB_R,
    clamp: clamp,
    coordHash: coordHash,
    cameraCenter: cameraCenter,
    worldToScreen: worldToScreen,
    screenToWorld: screenToWorld,
    updateCamera: updateCamera,
    dist: dist,
    normalize: normalize,
    pushCircle: pushCircle,
    uvFromWorld: uvFromWorld,
    gridScroll: gridScroll,
    visibleInRect: visibleInRect,
    orbWorldPos: orbWorldPos,
    orbSpawnRing: orbSpawnRing,
    orbSpawnAngle: orbSpawnAngle,
    entityPlacement: entityPlacement,
    obstacleFallbackPlacement: obstacleFallbackPlacement,
    enemyFallbackPlacement: enemyFallbackPlacement,
    propWorldPos: propWorldPos,
    visionCrop: visionCrop,
    entityDrawSize: entityDrawSize,
    patrolStep: patrolStep,
  };
})();

/**
 * Muralwalk painting / spell-slot math only — no world coordinates.
 */
(function () {
  if (window.MuralwalkSpellMath) return;
  var SLOT_LABELS = ["Spell I", "Spell II", "Spell III"];
  var TOTAL_PAINTINGS = 1000;

  function spellHash(seed, n) {
    var h = seed * 374761393 + n * 668265263;
    h = (h ^ (h >>> 13)) * 1274126177;
    return (h ^ (h >>> 16)) >>> 0;
  }

  function equippedNums(slots) {
    return (slots || []).filter(function (n) {
      return n >= 1;
    });
  }

  function paintingUrlFor(num) {
    if (window.getPaintingUrl) return window.getPaintingUrl(num);
    return "paintings/" + num + ".jpg";
  }

  function spellsMatch(a, b) {
    if (!a || !b || a.length < 2 || b.length < 2) return false;
    return a.join(",") === b.join(",");
  }

  function floorRequestKey(nums, variant, stasisText, unlockFloor) {
    return (
      nums.join(",") +
      "|" +
      variant +
      "|" +
      (stasisText || "").slice(0, 64) +
      "|" +
      (unlockFloor ? "u" : "p")
    );
  }

  function pickFromPool(pool, seed) {
    if (!pool || !pool.length) return null;
    return pool[spellHash(seed, pool.length) % pool.length];
  }

  function buildSpellPool(total, exclude, hasAnalysis) {
    var excludeMap = {};
    (exclude || []).forEach(function (n) {
      excludeMap[n] = true;
    });
    var pool = [];
    var max = total || TOTAL_PAINTINGS;
    for (var i = 1; i <= max; i++) {
      if (excludeMap[i]) continue;
      if (!hasAnalysis || hasAnalysis(i)) pool.push(i);
    }
    if (!pool.length) {
      for (var j = 1; j <= max; j++) {
        if (!excludeMap[j]) pool.push(j);
      }
    }
    return pool;
  }

  function orbValueIndex(orbIndex, worldSeed, score, valueCount) {
    return spellHash(worldSeed + score, orbIndex) % valueCount;
  }

  function slotLabel(index) {
    return SLOT_LABELS[index] || "Spell";
  }

  function entityKindFromText(text) {
    var lower = String(text || "").toLowerCase();
    if (
      /\b(bat|eye|eyes|spirit|shadow|beast|creature|phantom|specter|demon|wraith|spectre|monster|fiend|hunter)\b/.test(
        lower
      )
    ) {
      return "enemy";
    }
    if (
      /\b(tree|dune|dunes|rock|rocks|wall|pillar|arch|gate|tower|obelisk|branch|desert|column|cliff|stone|forest)\b/.test(
        lower
      )
    ) {
      return "obstacle";
    }
    return "prop";
  }

  function spellEntityHint(num, getAnalysis) {
    var a = getAnalysis ? getAnalysis(num) : null;
    if (!a) return null;
    var blob =
      (a.title || "") +
      " " +
      (a.tags || []).join(" ") +
      " " +
      (a.description || "").slice(0, 120);
    var kind = entityKindFromText(blob);
    if (kind === "prop") return null;
    return {
      kind: kind,
      subject: a.title || "Painting #" + num,
      spellNum: num,
    };
  }

  window.MuralwalkSpellMath = {
    SLOT_LABELS: SLOT_LABELS,
    TOTAL_PAINTINGS: TOTAL_PAINTINGS,
    spellHash: spellHash,
    equippedNums: equippedNums,
    paintingUrlFor: paintingUrlFor,
    spellsMatch: spellsMatch,
    floorRequestKey: floorRequestKey,
    pickFromPool: pickFromPool,
    buildSpellPool: buildSpellPool,
    orbValueIndex: orbValueIndex,
    slotLabel: slotLabel,
    entityKindFromText: entityKindFromText,
    spellEntityHint: spellEntityHint,
  };
})();

/**
 * Muralwalk — dark gray start, value orbs → 1000, swap spells, stasis floor forever.
 */
(function () {
  var C = window.MuralwalkCoords;
  var SM = window.MuralwalkSpellMath;
  if (!C || !SM) {
    console.error("[Muralwalk] failed to initialize — hard refresh (Ctrl+Shift+R)");
    window.MuralwalkAPI = {
      onShow: function () {},
      onHide: function () {},
    };
    return;
  }

  var TILE = 220;
  var SPEED = C.SPEED;
  var ORB_R = C.ORB_R;
  var SHUFFLE_COST = 100;
  var SELECT_SPELL_COST = 250;
  var REIMAGINE_COST = 50;
  var REDEFINE_COST = 25;
  var SAVE_IMAGE_ORB_REWARD = 1000;
  var ORBS_PER_USD = 100;
  var MIN_ORB_CONVERT = 100;
  var WALLET_STORAGE_KEY = "muralwalk.wallet";
  var SPELL_STATS_KEY = "muralwalk.spellStats";
  var FUSION_HISTORY_MAX = 12;
  var ENTITY_OUTCOME_HISTORY_MAX = 35;
  var MOSAIC_DWELL_MS = 2800;
  var MOSAIC_COMPASS = [
    { key: "n", dx: 0, dy: -1, label: "North", short: "N" },
    { key: "ne", dx: 1, dy: -1, label: "Northeast", short: "NE" },
    { key: "e", dx: 1, dy: 0, label: "East", short: "E" },
    { key: "se", dx: 1, dy: 1, label: "Southeast", short: "SE" },
    { key: "s", dx: 0, dy: 1, label: "South", short: "S" },
    { key: "sw", dx: -1, dy: 1, label: "Southwest", short: "SW" },
    { key: "w", dx: -1, dy: 0, label: "West", short: "W" },
    { key: "nw", dx: -1, dy: -1, label: "Northwest", short: "NW" },
  ];
  var FALLOUT_HUD_ORDER = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];
  var STASIS_VISION_GALLERY_KEYS = ["center"].concat(FALLOUT_HUD_ORDER);
  var MOSAIC_HUD_GRID = ["nw", "n", "ne", "w", "center", "e", "sw", "s", "se"];
  var MOSAIC_HUD_LABELS = {
    nw: "NW",
    n: "N",
    ne: "NE",
    w: "W",
    center: "C",
    e: "E",
    sw: "SW",
    s: "S",
    se: "SE",
  };
  var FALLOUT_SAVE_ROOT = "saved-fallout";
  var FALLOUT_SAVE_FOLDERS = {
    n: "north",
    ne: "northeast",
    e: "east",
    se: "southeast",
    s: "south",
    sw: "southwest",
    w: "west",
    nw: "northwest",
  };
  var GHOST_USAGE_USD = 0.5;
  var GHOST_SAVE_USD = 0.5;
  var GHOST_RECEIVE_CASHTAG = "Logan7in";
  var MW_BUZZ_REGEN_MS = 1600;
  var WORK_QUEUE_GAP_MS = 3200;
  var FALLOUT_SAVE_DEFER_MS = 2200;
  var STASIS_SAVE_GAP_MS = 1100;
  var STASIS_SAVE_BACKLOT_GAP_MS = 520;
  var STASIS_SAVE_ENCODE_MS = 360;
  var SPELL_PROJECTILE_R = 13;
  var SPELL_PROJECTILE_SPEED = 3.6;
  var SPELL_PROJECTILE_FIRE_GAP_MS = 2600;
  var CENTER_SAVE_FOLDER = "saved-stasis";
  var FALLOUT_SPELL_FEED_MS = 14000;
  var CENTER_STASIS_WAIT_MS = 120000;
  var MOSAIC_GEN_STALE_MS = 90000;
  var SAVE_IMAGE_MAX_EDGE = 1024;
  var ORB_SPELL_PICKUP_R = 64;
  var PLAYER_BODY_R = 10;
  var PLAYER_COLLISION_PASSES = 10;
  var TOTAL = SM.TOTAL_PAINTINGS;
  var ORB_VALUES = [1, 5, 10, 20, 100];
  var ORB_COLORS = {
    1: "#d8d8e0",
    5: "#7ec8ff",
    10: "#8eff8e",
    20: "#ffd54a",
    100: "#f0a0ff",
  };
  var ORB_ACTION_STYLES = {
    redefine: { color: "#b8a0f8", label: "R", cost: REDEFINE_COST },
    reimagine: { color: "#ffb86a", label: "Im", cost: REIMAGINE_COST },
    spell_shuffle: { color: "#c9a227", label: "?", cost: SHUFFLE_COST },
    spell_select: { color: "#7ec8ff", label: "#", cost: SELECT_SPELL_COST },
    buzz_inject: { color: "#8eff8e", label: "bz", cost: 0 },
    extra_buzz: { color: "#ffd68a", label: "ex", cost: 0 },
    save_work: { color: "#e8f8ff", label: "Sv", cost: 0 },
  };
  var MAZE_CELL = 88;
  var ORB_CLEARANCE = 50;
  var ORB_SPELL_RADIUS = 27;
  var ORB_CLUSTER_PITCH = 78;
  var ORB_CLUSTER_GAP = 48;
  var ORB_CLUSTER_RADIUS = 210;
  var ORB_SECTOR_PITCH = MAZE_CELL * 5;
  var PLAYER_SPAWN_GUARD = 110;
  var FLOOR_STATUS_DISMISS_MS = 2000;
  var FLOOR_OUTCOME_DISMISS_MS = 1300;
  var BUZZ_INJECT_STATUS_MS = 420;
  var MENU_STATUS_DISMISS_MS = 2200;
  var MW_REDEFINE_STATUS_DISMISS_MS = 2600;
  var VIDEIFY_STATUS_DISMISS_MS = 4200;
  var ORB_CLUSTER_DEFS = {
    score_n: { ox: 0, oy: -1, cols: 5, rows: 3 },
    score_e: { ox: 1.05, oy: 0.15, cols: 4, rows: 2 },
    spell: { ox: -1.02, oy: 0.05, cols: 2, rows: 2 },
    stasis: { ox: 0.12, oy: 1.02, cols: 3, rows: 1 },
    buzz: { ox: -0.92, oy: 0.88, cols: 2, rows: 2 },
  };
  var DARK_GRAY = "#4a4a54";
  var DARK_VEIL = 0.03;
  var SLOT_LABELS = SM.SLOT_LABELS;

  var g = {
    started: false,
    ready: false,
    running: false,
    wx: 0,
    wy: 0,
    camWx: 0,
    camWy: 0,
    vx: 0,
    vy: 0,
    _prevWx: 0,
    _prevWy: 0,
    keys: {},
    moveHeld: {},
    touchMove: {},
    canvas: null,
    ctx: null,
    guyCanvas: null,
    guyCtx: null,
    w: 960,
    h: 540,
    spellCache: {},
    _galleryBacklogPromise: null,
    slots: [null, null, null],
    score: 0,
    usdBalance: 0,
    _blendPromise: null,
    floorUnlocked: false,
    floorGenerating: false,
    floorStatus: "",
    _floorStatusTimer: 0,
    _menuStatusTimer: 0,
    _floorGenPromise: null,
    buzzWords: [],
    extraBuzzPrompt: "",
    activeBuzzWords: [],
    fusionHistory: [],
    entityOutcomeHistory: [],
    spellShiftCount: 0,
    _entityOutcomeImgCache: {},
    _visionProgressMsg: "",
    spellStats: {},
    tickerEvents: [],
    cashAppTag: GHOST_RECEIVE_CASHTAG,
    treasuryBalance: 0,
    ghostQueuedTotal: 0,
    playerSharePct: 80,
    platformEarned: 0,
    _buzzRegenTimer: 0,
    stasisVariant: 0,
    stasisText: "",
    stasisTitle: "",
    orbs: [],
    spellProjectiles: [],
    stasisProps: [],
    obstacles: [],
    enemies: [],
    _propGenToken: 0,
    fusion: {
      visionUrl: "",
      visionImg: null,
      _url: "",
      source: "",
    },
    stasisFromApi: false,
    _floorRequestKey: "",
    guy: { x: 0, y: 0, phase: "idle" },
    fx: { swirl: 0, glitch: 0, mural: 0, seed: 1 },
    raf: 0,
    _shiftBuf: null,
    _noiseBuf: null,
    _audio: null,
    _noiseGain: null,
    _noiseSrc: null,
    _noiseFilter: null,
    _noisePan: null,
    _lastNoiseStep: 0,
    _moveDx: 0,
    _moveDy: 0,
    _lastFrameMs: 0,
    _autoFloorTimer: 0,
    _lastAutoFloorKey: "",
    _stasisPending: false,
    _stasisFlushTimer: 0,
    _saveDirHandle: null,
    _saveDirLabel: "",
    _serverSaveDir: "",
    _serverGalleryRoot: "",
    _localBootstrapDone: false,
    _aiStasisLanded: false,
    _bootstrapPromise: null,
    _worldGenPromise: null,
    _visionRegenPromise: null,
    worldLoading: false,
    worldReady: false,
    playing: false,
    menuOpen: true,
    _loadFailsafeTimer: 0,
    _showing: false,
    playerPersona: "wanderer",
    playerPalette: [201, 162, 39],
    _orbSpellImgCache: {},
    _mazeGx: null,
    _mazeGy: null,
    _orbHintMsg: "",
    _orbPatchCount: 0,
    _orbSectors: {},
    _playScrollLocked: false,
    _playScrollY: 0,
    gameFocused: false,
    _lastFalloutHudMs: 0,
    _playerStasisSavedKey: "",
    _stasisSavePending: false,
    _stasisSaveTimer: 0,
    _stasisSaveDrainActive: false,
    _stasisSaveRetryTimer: 0,
    visionMosaic: { focusGx: 0, focusGy: 0, cells: {} },
    _mosaicDwellMs: 0,
    _mosaicDwellKey: "",
    _falloutEnemySeq: 0,
    _workQueue: [],
    _workActive: false,
    _workActiveKey: "",
    _workGapTimer: 0,
    _queueStatus: "",
    _falloutCenterWaitQueued: false,
    _falloutBootDone: false,
    _lastPlayerMosaicKey: "",
    _falloutHudRaf: 0,
    _falloutHudLastMs: 0,
    _falloutSaveCompass: "",
    _minimapThumbCache: {},
    _mosaicGenInflight: {},
    _mapLoadCompass: "",
    _lastMapQueueKickMs: 0,
  };

  function $(id) {
    return document.getElementById(id);
  }

  function clamp(v, lo, hi) {
    return C.clamp(v, lo, hi);
  }

  function equippedNums() {
    return SM.equippedNums(g.slots);
  }

  function paintingUrlFor(num) {
    return SM.paintingUrlFor(num);
  }

  function preloadPaintingThumb(num) {
    num = parseInt(num, 10);
    if (!num || num < 1) return null;
    if (!g._thumbPreload) g._thumbPreload = {};
    if (g._orbSpellImgCache[String(num)]) {
      g._thumbPreload[num] = g._orbSpellImgCache[String(num)];
      return g._thumbPreload[num];
    }
    if (g._thumbPreload[num]) return g._thumbPreload[num];
    var url = paintingUrlFor(num);
    var img = new Image();
    img.loading = "eager";
    img.decoding = "async";
    img.src = url;
    g._thumbPreload[num] = img;
    g._orbSpellImgCache[String(num)] = img;
    return img;
  }

  function preloadPaintingThumbs(nums) {
    for (var i = 0; i < (nums || []).length; i++) {
      if (nums[i]) preloadPaintingThumb(nums[i]);
    }
  }

  function paintingUrlFromThumb(url) {
    if (!url) return null;
    var m = String(url).match(/paintings\/(\d+)\.jpg/i);
    return m ? parseInt(m[1], 10) : null;
  }

  function setHudThumb(el, url) {
    if (!el) return;
    if (!url) {
      el.hidden = true;
      el.removeAttribute("src");
      return;
    }
    el.loading = "eager";
    el.setAttribute("fetchpriority", "high");
    el.hidden = false;
    var num = paintingUrlFromThumb(url);
    var cached = num ? g._thumbPreload && g._thumbPreload[num] : null;
    if (cached && cached.complete && cached.naturalWidth) {
      if (el.getAttribute("src") !== cached.src) el.src = cached.src;
      return;
    }
    if (el.getAttribute("src") !== url) el.src = url;
    if (el.decode) el.decode().catch(function () {});
  }

  function spellsMatch(a, b) {
    return SM.spellsMatch(a, b);
  }

  function worldToScreen(wx, wy) {
    return C.worldToScreen(wx, wy, g.camWx, g.camWy, g.w, g.h);
  }

  function updateCamera() {
    var cam = C.updateCamera(g.camWx, g.camWy, g.wx, g.wy);
    g.camWx = cam.camWx;
    g.camWy = cam.camWy;
  }

  function cacheSpellAnalysis(num, analysis) {
    if (!num || !analysis) return;
    g.spellCache[String(num)] = analysis;
  }

  function getAnalysis(num) {
    var key = String(num);
    if (g.spellCache[key]) return g.spellCache[key];
    if (typeof window.getGalleryAnalysis === "function") {
      var live = window.getGalleryAnalysis(num);
      if (live) {
        g.spellCache[key] = live;
        return live;
      }
    }
    return null;
  }

  function syncEquippedSpells() {
    var nums = equippedNums();
    preloadPaintingThumbs(nums);
    for (var i = 0; i < nums.length; i++) {
      var n = nums[i];
      if (g.spellCache[String(n)]) continue;
      if (typeof window.getGalleryAnalysis === "function") {
        cacheSpellAnalysis(n, window.getGalleryAnalysis(n));
      }
    }
    return nums;
  }

  function equippedAnalysesReady() {
    syncEquippedSpells();
    var nums = equippedNums();
    if (nums.length < 2) return false;
    for (var i = 0; i < nums.length; i++) {
      if (!getAnalysis(nums[i])) return false;
    }
    return true;
  }

  function analysesReady() {
    return equippedAnalysesReady();
  }

  function loadGalleryDataNow() {
    var loader = window.ensureGalleryData || window.loadGalleryData;
    if (!loader) return Promise.resolve(null);
    return loader()
      .then(function (data) {
        syncEquippedSpells();
        return data;
      })
      .catch(function () {
        return null;
      });
  }

  function backlogGalleryData() {
    if (g._galleryBacklogPromise) return g._galleryBacklogPromise;
    var run = function () {
      return loadGalleryDataNow();
    };
    if (typeof requestIdleCallback === "function") {
      g._galleryBacklogPromise = new Promise(function (resolve) {
        requestIdleCallback(
          function () {
            run().then(resolve).catch(function () {
              resolve(null);
            });
          },
          { timeout: 4000 }
        );
      });
    } else {
      g._galleryBacklogPromise = new Promise(function (resolve) {
        setTimeout(function () {
          run().then(resolve).catch(function () {
            resolve(null);
          });
        }, 0);
      });
    }
    return g._galleryBacklogPromise;
  }

  function ensureEquippedSpellData() {
    syncEquippedSpells();
    var nums = equippedNums();
    if (nums.length >= 2 && equippedAnalysesReady()) return Promise.resolve();
    return loadGalleryDataNow().then(function () {
      syncEquippedSpells();
    });
  }

  function ensureSlotsReady() {
    return ensureEquippedSpellData().then(function () {
      if (equippedNums().length < 2) initSlots();
      else {
        syncEquippedSpells();
        regenerateStasisText();
        refreshReadouts();
      }
      refreshMenuPanel();
    });
  }

  function uniqueList(arr) {
    var out = [];
    var seen = {};
    for (var i = 0; i < arr.length; i++) {
      var s = String(arr[i] || "").trim();
      if (!s || seen[s]) continue;
      seen[s] = true;
      out.push(s);
    }
    return out;
  }

  function renderChipList(el, items) {
    if (!el) return;
    el.innerHTML = "";
    if (!items || !items.length) {
      el.innerHTML = '<span class="mw-chip mw-chip-empty">—</span>';
      return;
    }
    for (var i = 0; i < items.length; i++) {
      var chip = document.createElement("span");
      chip.className = "mw-chip";
      chip.textContent = items[i];
      el.appendChild(chip);
    }
  }

  function collectCombinedMeta(nums) {
    var styles = [];
    var tags = [];
    var moods = [];
    nums.forEach(function (n) {
      var a = getAnalysis(n);
      if (!a) return;
      if (a.style) styles.push(a.style);
      if (a.medium) styles.push(a.medium);
      if (a.tags) tags = tags.concat(a.tags);
      if (a.mood) moods.push(a.mood);
    });
    return {
      styles: uniqueList(styles),
      tags: uniqueList(tags).slice(0, 14),
      moods: uniqueList(moods),
    };
  }

  function spellReadoutHtml(num) {
    var a = getAnalysis(num);
    if (!a) {
      var pending = analysesReady()
        ? "Painting #" + num + " — no analysis on file."
        : "Loading painting analysis…";
      return (
        '<span class="mw-spell-box-title">#' + num + "</span>" +
        '<p class="mw-spell-box-text">' + escapeHtml(pending) + "</p>"
      );
    }
    var tags = (a.tags || []).slice(0, 8);
    var styles = uniqueList([a.style, a.medium].filter(Boolean));
    var desc = a.description || a.style || a.title || "Painting #" + num;
    var tagHtml = tags
      .map(function (t) {
        return '<span class="mw-chip">' + escapeHtml(t) + "</span>";
      })
      .join("");
    var styleHtml = styles
      .map(function (s) {
        return '<span class="mw-chip">' + escapeHtml(s) + "</span>";
      })
      .join("");
    return (
      '<span class="mw-spell-box-title">#' +
      num +
      " · " +
      escapeHtml(a.title || "Untitled") +
      "</span>" +
      '<span class="mw-meta-label">Style</span>' +
      '<div class="mw-spell-chips">' +
      (styleHtml || '<span class="mw-chip mw-chip-empty">—</span>') +
      "</div>" +
      '<span class="mw-meta-label">Tags</span>' +
      '<div class="mw-spell-chips">' +
      (tagHtml || '<span class="mw-chip mw-chip-empty">—</span>') +
      "</div>" +
      '<p class="mw-spell-box-text">' +
      escapeHtml(desc) +
      "</p>"
    );
  }

  function isMuralwalkActive() {
    var panel = $("panel-muralwalk");
    return panel && !panel.hidden;
  }

  function canWalk() {
    return !g.menuOpen;
  }

  function canAffordShuffle() {
    return g.score >= SHUFFLE_COST;
  }

  function canAffordSelect() {
    return g.score >= SELECT_SPELL_COST;
  }

  function canAffordReimagine() {
    return g.score >= REIMAGINE_COST;
  }

  function canAffordRedefine() {
    return g.score >= REDEFINE_COST;
  }

  function normalizeSpellNum(raw) {
    if (window.normalizePaintingNumber) return window.normalizePaintingNumber(raw);
    var n = parseInt(raw, 10);
    return !isNaN(n) && n >= 1 && n <= TOTAL ? n : null;
  }

  function getSpellforgeState() {
    if (window.SpellforgeAPI && window.SpellforgeAPI.getFusion) {
      return window.SpellforgeAPI.getFusion();
    }
    return window.spellforgeFusion || null;
  }

  function syncFromSpellforge() {
    var sf = getSpellforgeState();
    if (!sf) return false;
    if (sf.slots && sf.slots.length) {
      for (var i = 0; i < 3; i++) g.slots[i] = sf.slots[i] || null;
    } else if (sf.spells && sf.spells.length >= 2) {
      for (var j = 0; j < 3; j++) g.slots[j] = sf.spells[j] || null;
    } else {
      return false;
    }
    if (equippedNums().length < 2) return false;
    if (sf.stasis) {
      g.stasisText = sf.stasis;
      g.stasisFromApi = true;
    }
    if (sf.title) g.stasisTitle = sf.title;
    if (sf.buzz) g.buzzWords = sf.buzz;
    if (sf.visionUrl) {
      g.fusion.visionUrl = sf.visionUrl;
      g.fusion.source = "ai";
      loadFusionImage(sf.visionUrl, g.floorUnlocked, "ai").catch(function () {});
    }
    if (!g.stasisText.trim()) regenerateStasisText();
    syncEquippedSpells();
    refreshPlayerPersona();
    refreshReadouts();
    refreshMenuPanel();
    return true;
  }

  function pickPersonaNoun(stasis) {
    var text = String(stasis || "").toLowerCase();
    var personaMap = {
      person: 9,
      figure: 8,
      child: 8,
      creature: 8,
      woman: 7,
      man: 7,
      spirit: 7,
      being: 7,
      soul: 7,
      guardian: 7,
      dancer: 7,
      spectator: 6,
      traveler: 6,
      witness: 6,
      face: 6,
      eye: 6,
      rat: 6,
      bird: 6,
      form: 5,
      wanderer: 5,
    };
    var best = "wanderer";
    var bestScore = 0;
    Object.keys(personaMap).forEach(function (word) {
      var re = new RegExp("\\b" + word + "s?\\b");
      if (!re.test(text)) return;
      if (personaMap[word] > bestScore) {
        bestScore = personaMap[word];
        best = word;
      }
    });
    return best;
  }

  function refreshStasisInterfaceSkin() {
    if (!window.StasisInterfaceSkin) return;
    window.StasisInterfaceSkin.apply({
      stasisText: g.stasisText || "",
      buzz: collectBuzzForEquipped(),
      extraPrompt: g.extraBuzzPrompt || "",
      visionImg: g.fusion && g.fusion.visionImg,
      activeTab: isMuralwalkActive() ? "muralwalk" : "",
    });
  }

  function refreshPlayerPersona() {
    g.playerPersona = pickPersonaNoun(g.stasisText);
    if (window.StasisWalkFloor && g.fusion.visionImg && g.fusion.visionImg.complete) {
      g.playerPalette = window.StasisWalkFloor.sampleImageColor(g.fusion.visionImg, 0.5, 0.5);
    } else if (window.StasisWalkFloor) {
      g.playerPalette = window.StasisWalkFloor.paletteFromBuzz(collectBuzzForEquipped(), g.stasisText)[0];
    }
    refreshStasisInterfaceSkin();
  }

  function toggleMenu() {
    if (g.menuOpen) closeMenu();
    else openMenu();
  }

  function isTouchUI() {
    return (
      window.matchMedia("(pointer: coarse)").matches ||
      window.matchMedia("(hover: none)").matches ||
      "ontouchstart" in window
    );
  }

  var MOVE_KEY_CODES = [
    "KeyW",
    "KeyA",
    "KeyS",
    "KeyD",
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
  ];

  function setTouchDir(dir, down) {
    if (!dir) return;
    if (down) g.touchMove[dir] = true;
    else delete g.touchMove[dir];
  }

  function anchorPlayMonitor() {
    var frame = document.querySelector("#mw-game-ui .mw-pixel-frame");
    if (!frame) return;
    var header = document.querySelector(".site-header");
    var rect = frame.getBoundingClientRect();
    var offset = header ? header.getBoundingClientRect().height + 8 : 8;
    var top = rect.top + window.scrollY - offset;
    window.scrollTo(0, Math.max(0, top));
  }

  function unlockPlayViewport() {
    document.body.style.top = "";
    document.documentElement.classList.remove("mw-game-locked");
    document.body.classList.remove("mw-game-locked");
    g._playScrollLocked = false;
    g._playScrollY = 0;
  }

  function setGameFocused(focused) {
    g.gameFocused = !!focused;
    var frame = document.querySelector("#mw-game-ui .mw-pixel-frame");
    if (frame) frame.classList.toggle("mw-game-active", g.gameFocused);
  }

  function updatePlayScrollLock() {
    var shouldGuard = g.playing && !g.menuOpen && isMuralwalkActive();
    document.documentElement.classList.toggle("mw-playing", shouldGuard);
    document.body.classList.toggle("mw-playing", shouldGuard);
    if (!shouldGuard) {
      setGameFocused(false);
      unlockPlayViewport();
    }
  }

  function isPlayScrollGuardTarget(target) {
    if (!target || !target.closest) return false;
    return !!target.closest(".mw-pixel-frame, #mw-floor, #mw-guy");
  }

  function onPlayScrollBlock(e) {
    if (g.menuOpen || !g.playing || !isMuralwalkActive()) return;
    if (!isPlayScrollGuardTarget(e.target)) return;
    if (e.cancelable) e.preventDefault();
  }

  function bindPlayScrollGuard() {
    if (g._playScrollGuardBound) return;
    g._playScrollGuardBound = true;
    document.addEventListener("wheel", onPlayScrollBlock, { passive: false });
    document.addEventListener("touchmove", onPlayScrollBlock, { passive: false });
    var gameUi = $("mw-game-ui");
    if (gameUi && !gameUi.dataset.focusBound) {
      gameUi.dataset.focusBound = "1";
      gameUi.addEventListener(
        "pointerdown",
        function (e) {
          if (!g.playing || g.menuOpen || !isMuralwalkActive()) return;
          if (e.target.closest(".mw-pixel-frame")) {
            setGameFocused(true);
          } else if (
            e.target.closest(
              ".mw-stasis-strip, .muralwalk-hud, .mw-fallout-hud, .mw-stasis-action-btn"
            )
          ) {
            setGameFocused(false);
            clearKeys();
          }
        },
        true
      );
    }
    bindFalloutHudClicks();
  }

  function updateTouchControlsVisible() {
    var panel = $("mw-touch-controls");
    if (!panel) return;
    var show =
      isTouchUI() && g.playing && !g.menuOpen && isMuralwalkActive() && !g._videofyRecording;
    panel.hidden = !show;
    panel.setAttribute("aria-hidden", show ? "false" : "true");
    document.body.classList.toggle("mw-mobile-play", show);
    updatePlayScrollLock();
    if (!show) {
      ["w", "a", "s", "d"].forEach(function (dir) {
        setTouchDir(dir, false);
      });
      panel.querySelectorAll(".mw-touch-btn.pressed").forEach(function (btn) {
        btn.classList.remove("pressed");
      });
    }
  }

  function bindTouchControls() {
    var panel = $("mw-touch-controls");
    if (!panel || panel.dataset.bound) return;
    panel.dataset.bound = "1";
    panel.querySelectorAll(".mw-touch-btn[data-dir]").forEach(function (btn) {
      var dir = btn.getAttribute("data-dir");
      function press(e) {
        if (e.cancelable) e.preventDefault();
        btn.classList.add("pressed");
        setTouchDir(dir, true);
      }
      function release(e) {
        if (e.cancelable) e.preventDefault();
        btn.classList.remove("pressed");
        setTouchDir(dir, false);
      }
      btn.addEventListener("pointerdown", press);
      btn.addEventListener("pointerup", release);
      btn.addEventListener("pointerleave", release);
      btn.addEventListener("pointercancel", release);
      btn.addEventListener("contextmenu", function (e) {
        e.preventDefault();
      });
    });
    var spellBtn = $("mw-touch-spellbook");
    if (spellBtn) {
      spellBtn.addEventListener("click", function (e) {
        e.preventDefault();
        openMenu();
      });
    }
  }

  function openMenu() {
    g.menuOpen = true;
    clearTimeout(g._stasisFlushTimer);
    g._stasisFlushTimer = 0;
    clearKeys();
    var menu = $("mw-menu-screen");
    var game = $("mw-game-ui");
    if (menu) menu.hidden = false;
    if (game) game.hidden = true;
    refreshMenuPanel();
    updateScoreHud();
    updateTouchControlsVisible();
    updateSlotHud();
    setGameFocused(false);
    updatePlayScrollLock();
  }

  function closeMenu() {
    g.menuOpen = false;
    var menu = $("mw-menu-screen");
    var game = $("mw-game-ui");
    if (menu) menu.hidden = true;
    if (game) game.hidden = false;
    if (!g.playing) startSession();
    else ensureOrbsNearPlayer();
    setGameFocused(true);
    focusWalkSurface();
    updateScoreHud();
    flushPendingStasis();
    updateTouchControlsVisible();
    updateSlotHud();
    updateGameSaveButtons();
    updatePlayScrollLock();
  }

  function markStasisPending() {
    g._stasisPending = true;
    g._floorRequestKey = "";
  }

  function scheduleStasisFlush() {
    if (g.menuOpen || !g._stasisPending) return;
    clearTimeout(g._stasisFlushTimer);
    g._stasisFlushTimer = setTimeout(function () {
      g._stasisFlushTimer = 0;
      flushPendingStasis();
    }, 200);
  }

  function flushPendingStasis() {
    if (!g._stasisPending || g.menuOpen) return;
    clearTimeout(g._stasisFlushTimer);
    g._stasisFlushTimer = 0;
    g._stasisPending = false;
    g._localBootstrapDone = false;
    g._aiStasisLanded = false;
    g._bootstrapPromise = null;
    regenerateStasisVision({
      quietStatus: true,
      outcomeMsg: "Stasis vision updated.",
      unlockFloor: g.floorUnlocked,
      keepPreviousOnFail: hasVisionFloor(),
    });
  }

  function visionStatusHandler(opts) {
    if (opts && opts.quietStatus) {
      return function (msg) {
        g._visionProgressMsg = msg || "";
      };
    }
    return setFloorStatus;
  }

  function refreshMenuPanel() {
    var wrap = $("mw-menu-spells");
    var stasisEl = $("mw-menu-stasis");
    if (!wrap) return;
    syncEquippedSpells();
    var nums = equippedNums();
    wrap.innerHTML = "";
    if (nums.length < 2) {
      wrap.innerHTML = '<p class="mw-menu-spell">Loading spell analyses…</p>';
      if (stasisEl) stasisEl.textContent = "Waiting for paintings to analyze.";
      return;
    }
    var affordShuffle = canAffordShuffle();
    var affordSelect = canAffordSelect();
    for (var i = 0; i < 3; i++) {
      var num = g.slots[i];
      if (!num) continue;
      var a = getAnalysis(num);
      var row = document.createElement("div");
      row.className = "mw-menu-spell-row";
      var line = document.createElement("p");
      line.className = "mw-menu-spell";
      line.innerHTML =
        "<strong>" +
        SLOT_LABELS[i] +
        "</strong> · #" +
        num +
        " — " +
        escapeHtml(a ? a.title || "Untitled" : "Loading…");
      row.appendChild(line);
      var actions = document.createElement("div");
      actions.className = "mw-menu-spell-actions";
      var shuffleBtn = document.createElement("button");
      shuffleBtn.type = "button";
      shuffleBtn.className = "mw-shuffle-btn";
      shuffleBtn.dataset.slot = String(i);
      shuffleBtn.disabled = !affordShuffle;
      shuffleBtn.textContent = "Shuffle (" + SHUFFLE_COST + ")";
      shuffleBtn.title = affordShuffle
        ? "Random spell — " + SHUFFLE_COST + " orbs"
        : "Need " + SHUFFLE_COST + " orbs";
      actions.appendChild(shuffleBtn);
      var selectBtn = document.createElement("button");
      selectBtn.type = "button";
      selectBtn.className = "mw-select-btn";
      selectBtn.dataset.slot = String(i);
      selectBtn.disabled = !affordSelect;
      selectBtn.textContent = "Select (" + SELECT_SPELL_COST + ")";
      selectBtn.title = affordSelect
        ? "Pick #1–" + TOTAL + " — " + SELECT_SPELL_COST + " orbs"
        : "Need " + SELECT_SPELL_COST + " orbs";
      actions.appendChild(selectBtn);
      row.appendChild(actions);
      wrap.appendChild(row);
    }
    if (!g.stasisText.trim()) regenerateStasisText();
    if (stasisEl) {
      stasisEl.textContent =
        g.stasisText || "Your fused stasis will appear here before you walk.";
    }
  }

  function bindMenuShuffles() {
    var wrap = $("mw-menu-spells");
    if (!wrap || wrap.dataset.shuffleBound) return;
    wrap.dataset.shuffleBound = "1";
    wrap.addEventListener("click", function (e) {
      var shuffleBtn =
        e.target && e.target.closest ? e.target.closest(".mw-shuffle-btn") : null;
      if (shuffleBtn && !shuffleBtn.disabled) {
        var slot = parseInt(shuffleBtn.dataset.slot, 10);
        if (slot >= 0) shuffleSpellSlot(slot, true);
        return;
      }
      var selectBtn =
        e.target && e.target.closest ? e.target.closest(".mw-select-btn") : null;
      if (selectBtn && !selectBtn.disabled) {
        var slotIdx = parseInt(selectBtn.dataset.slot, 10);
        if (slotIdx >= 0) openSelectSpellDialog(slotIdx, true);
      }
    });
    bindSelectSpellDialog();
  }

  function canSelectSpellInHud() {
    return (
      canAffordSelect() &&
      equippedNums().length >= 2 &&
      !g._redefinePromise &&
      !g._reimaginePromise &&
      !g.floorGenerating &&
      !g._worldGenPromise &&
      !g._visionRegenPromise
    );
  }

  function bindSlotHudSelect() {
    var hud = $("mw-slot-hud");
    if (!hud || hud.dataset.selectBound) return;
    hud.dataset.selectBound = "1";
    bindSelectSpellDialog();
    hud.addEventListener("click", function (e) {
      var btn =
        e.target && e.target.closest ? e.target.closest(".mw-slot-hud-select") : null;
      if (!btn || btn.disabled) return;
      e.preventDefault();
      e.stopPropagation();
      var slot = parseInt(btn.dataset.slot, 10);
      if (slot >= 0) openSelectSpellDialog(slot, false);
    });
  }

  function openSelectSpellDialog(slotIdx, fromMenu) {
    if (!canAffordSelect()) {
      var msg = "Need " + SELECT_SPELL_COST + " orbs to select a spell.";
      setFloorStatus(msg);
      if (fromMenu) setMenuStatus(msg, null);
      return;
    }
    g._selectSpellSlot = slotIdx;
    g._selectFromMenu = fromMenu === true;
    var dlg = $("mw-select-spell-dialog");
    var input = $("mw-select-spell-num");
    var err = $("mw-select-spell-error");
    if (err) {
      err.hidden = true;
      err.textContent = "";
    }
    if (input) {
      input.value = "";
      input.min = "1";
      input.max = String(TOTAL);
    }
    if (!dlg) return;
    if (typeof dlg.showModal === "function") dlg.showModal();
    else dlg.setAttribute("open", "");
    if (input) input.focus();
  }

  function closeSelectSpellDialog() {
    var dlg = $("mw-select-spell-dialog");
    if (!dlg) return;
    if (typeof dlg.close === "function") dlg.close();
    else dlg.removeAttribute("open");
    g._selectSpellSlot = null;
  }

  function bindSelectSpellDialog() {
    var dlg = $("mw-select-spell-dialog");
    if (!dlg || dlg.dataset.bound) return;
    dlg.dataset.bound = "1";
    var form = dlg.querySelector(".mw-select-spell-form");
    var cancelBtn = $("mw-select-spell-cancel");
    if (cancelBtn && !cancelBtn.dataset.bound) {
      cancelBtn.dataset.bound = "1";
      cancelBtn.addEventListener("click", function () {
        closeSelectSpellDialog();
      });
    }
    if (form && !form.dataset.bound) {
      form.dataset.bound = "1";
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var input = $("mw-select-spell-num");
        var err = $("mw-select-spell-error");
        var num = normalizeSpellNum(input ? input.value : "");
        if (!num) {
          if (err) {
            err.hidden = false;
            err.textContent = "Enter a painting number from 1 to " + TOTAL + ".";
          }
          return;
        }
        var slotIdx = g._selectSpellSlot;
        if (slotIdx == null || slotIdx < 0) {
          closeSelectSpellDialog();
          return;
        }
        var used = g.slots.filter(function (n, i) {
          return n && i !== slotIdx;
        });
        if (used.indexOf(num) >= 0) {
          if (err) {
            err.hidden = false;
            err.textContent = "That spell is already equipped in another slot.";
          }
          return;
        }
        var ok = selectSpellSlot(slotIdx, num, g._selectFromMenu === true);
        if (ok) closeSelectSpellDialog();
      });
    }
  }

  function setMenuStatus(msg, progress) {
    clearTimeout(g._menuStatusTimer);
    g._menuStatusTimer = 0;
    var st = $("mw-menu-status");
    var bar = $("mw-menu-bar");
    var fill = $("mw-menu-bar-fill");
    var show = !!(msg || progress != null);
    if (st) {
      st.hidden = !show;
      if (msg) st.textContent = msg;
    }
    if (bar) bar.hidden = !show;
    if (fill && progress != null) {
      fill.style.width = Math.max(0, Math.min(100, Math.round(progress * 100))) + "%";
    }
    if (msg && progress == null && !g.worldLoading) {
      var capturedMenu = msg;
      g._menuStatusTimer = setTimeout(function () {
        g._menuStatusTimer = 0;
        if (st && !st.hidden && st.textContent === capturedMenu) {
          setMenuStatus("", null);
        }
      }, MENU_STATUS_DISMISS_MS);
    }
  }

  function isFloorStatusSticky() {
    return !!(
      g.floorGenerating ||
      g._worldGenPromise ||
      g._visionRegenPromise ||
      g._redefinePromise ||
      g._reimaginePromise ||
      g.worldLoading
    );
  }

  function clearFloorStatusTimer() {
    if (g._floorStatusTimer) {
      clearTimeout(g._floorStatusTimer);
      g._floorStatusTimer = 0;
    }
  }

  function workQueueDepth() {
    return g._workQueue.length + (g._workActive ? 1 : 0);
  }

  function workQueueBusy() {
    return !!(g._workActive || g._workQueue.length || g._workGapTimer);
  }

  function enqueueWork(kind, key, fn, priority) {
    key = String(key || kind);
    for (var i = 0; i < g._workQueue.length; i++) {
      if (g._workQueue[i].kind === kind && g._workQueue[i].key === key) return;
    }
    g._workQueue.push({
      kind: kind,
      key: key,
      fn: fn,
      priority: priority == null ? 0 : priority,
    });
    g._workQueue.sort(function (a, b) {
      return b.priority - a.priority;
    });
    pumpWorkQueue();
  }

  function pumpWorkQueue() {
    if (g._workActive || g._workGapTimer || !g._workQueue.length) return;
    var item = g._workQueue.shift();
    g._workActive = true;
    g._workActiveKey = item.key || "";
    g._queueStatus = item.kind;
    Promise.resolve()
      .then(function () {
        return item.fn();
      })
      .catch(function () {})
      .finally(function () {
        var wasStasisSave = item.kind === "stasis_save";
        g._workActive = false;
        g._workActiveKey = "";
        g._queueStatus = "";
        if (g._workGapTimer) clearTimeout(g._workGapTimer);
        g._workGapTimer = setTimeout(function () {
          g._workGapTimer = 0;
          pumpWorkQueue();
          if (wasStasisSave || stasisGenBlockedBySaveCycle()) {
            drainStasisSaveBacklot();
          } else {
            processPendingStasisSaves();
            ensureFalloutMapLoaded();
          }
        }, WORK_QUEUE_GAP_MS);
      });
  }

  function startFloorGenBackground() {
    if (g._worldGenPromise) return g._worldGenPromise;
    g.floorGenerating = true;
    return beginWorldLoad(g.floorUnlocked).finally(function () {
      g.floorGenerating = false;
      g._worldGenPromise = null;
      updateHudLabel();
      updateScoreHud();
      updateStasisActionButtons();
    });
  }

  function startSession() {
    g.playing = true;
    preloadPaintingThumbs(equippedNums());
    g.worldLoading = false;
    setMenuStatus("", null);
    var btn = $("mw-play-btn");
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Play";
    }
    placePlayerAtSpawn();
    resetVisionMosaic();
    spawnOrbs();
    setWorldReady(true);
    updateHudLabel();
    updateScoreHud();
    requestAnimationFrame(function () {
      ensureOrbsNearPlayer();
      layoutPropsPlaceholders();
      layoutWorldEntities();
      refreshPlayerPersona();
      startFloorGenBackground();
      maybeSpawnAllFalloutEnemies();
    });
  }

  function setWorldLoading(loading, status, progress) {
    g.worldLoading = !!loading;
    if (loading && g.playing && !g.menuOpen) {
      if (status) setFloorStatus(status);
      setMenuStatus("", null);
      updateScoreHud();
      return;
    }
    if (loading) {
      g.worldReady = false;
      clearKeys();
      setMenuStatus(status || "Preparing stasis world…", progress != null ? progress : 0.15);
      var btn = $("mw-play-btn");
      if (btn) btn.disabled = true;
    } else {
      setMenuStatus("", null);
      if (g.playing) g.worldReady = true;
    }
    updateScoreHud();
  }

  function setLoadStatus(msg, progress) {
    if (g.playing && !g.menuOpen) {
      if (msg) setFloorStatus(msg);
      g.worldLoading = true;
    } else {
      setWorldLoading(true, msg, progress);
    }
  }

  function finishLoadStatus() {
    g.worldLoading = false;
    setFloorStatus("");
    g.floorGenerating = false;
    g._worldGenPromise = null;
    setMenuStatus("", null);
    if (g.playing) setWorldReady(true);
    updateScoreHud();
    updateStasisActionButtons();
  }

  function armLoadFailsafe(ms) {
    clearTimeout(g._loadFailsafeTimer);
    g._loadFailsafeTimer = setTimeout(function () {
      if (!g.playing && !g.menuOpen) {
        forceWorldReady();
        return;
      }
      if (shouldDrawStasisPlane()) return;
      if (!g.floorGenerating && !g._worldGenPromise) return;
      ensureLocalBootstrap(g.floorUnlocked)
        .then(function () {
          refreshPlayerPersona();
        })
        .catch(function () {
          forceWorldReady();
        });
    }, ms || 15000);
  }

  function waitForVisionFloor(maxMs) {
    if (hasVisionFloor()) return Promise.resolve();
    maxMs = maxMs || 10000;
    var start = Date.now();
    return new Promise(function (resolve) {
      function poll() {
        if (hasVisionFloor() || Date.now() - start > maxMs) {
          resolve();
          return;
        }
        requestAnimationFrame(poll);
      }
      if (g.fusion.visionUrl) {
        loadFusionImage(g.fusion.visionUrl, g.floorUnlocked, g.fusion.source || "ai")
          .then(resolve)
          .catch(function () {
            poll();
          });
      } else {
        poll();
      }
    });
  }

  function setWorldReady(ready) {
    g.worldReady = ready === true;
    if (g.worldReady) {
      g.worldLoading = false;
      clearTimeout(g._loadFailsafeTimer);
      g._loadFailsafeTimer = 0;
      if (g.playing) focusWalkSurface();
    }
    updateScoreHud();
  }

  function forceWorldReady() {
    if (!hasVisionFloor() && equippedNums().length >= 2) {
      var nums = equippedNums();
      loadFusionImage(paintingUrlFor(nums[0]), g.floorUnlocked, "local")
        .then(function () {
          maybeSpawnAllFalloutEnemies();
        })
        .catch(function () {});
    }
    setFloorStatus("");
    if (g.playing) {
      setWorldReady(true);
      updateHudLabel();
      maybeSpawnAllFalloutEnemies();
    }
  }

  function onPlayClicked() {
    requestAnimationFrame(function () {
      closeMenu();
    });
  }

  function isEditableTarget(target) {
    if (!target || !target.tagName) return false;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return true;
    if (target.isContentEditable) return true;
    return false;
  }

  function movementCodeFromEvent(e) {
    var code = e.code || "";
    if (MOVE_KEY_CODES.indexOf(code) >= 0) return code;
    var key = e.key || "";
    if (key.length === 1) {
      var lower = key.toLowerCase();
      if (lower === "w") return "KeyW";
      if (lower === "a") return "KeyA";
      if (lower === "s") return "KeyS";
      if (lower === "d") return "KeyD";
    }
    if (MOVE_KEY_CODES.indexOf(key) >= 0) return key;
    return null;
  }

  function releaseMovementCode(code) {
    if (!code) return;
    delete g.moveHeld[code];
  }

  function pressMovementCode(code) {
    if (!code) return;
    g.moveHeld[code] = true;
  }

  function syncLegacyKeys() {
    var mh = g.moveHeld;
    var tm = g.touchMove;
    g.keys.w = !!(mh.KeyW || tm.w);
    g.keys.a = !!(mh.KeyA || tm.a);
    g.keys.s = !!(mh.KeyS || tm.s);
    g.keys.d = !!(mh.KeyD || tm.d);
    g.keys.ArrowUp = !!mh.ArrowUp;
    g.keys.ArrowDown = !!mh.ArrowDown;
    g.keys.ArrowLeft = !!mh.ArrowLeft;
    g.keys.ArrowRight = !!mh.ArrowRight;
  }

  function keyToken(e, down) {
    var moveCode = movementCodeFromEvent(e);
    if (moveCode) {
      var inGame =
        g.gameFocused && g.playing && !g.menuOpen && isMuralwalkActive();
      if (!down) {
        releaseMovementCode(moveCode);
        if (inGame) {
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }
      if (e.repeat) return;
      if (isEditableTarget(e.target)) return;
      if (!isMuralwalkActive()) return;
      if (inGame) {
        e.preventDefault();
        e.stopPropagation();
        if (canWalk()) pressMovementCode(moveCode);
        return;
      }
      return;
    }

    if (isEditableTarget(e.target)) return;

    if (down && isMuralwalkActive() && (e.code === "Escape" || e.key === "Escape")) {
      e.preventDefault();
      e.stopPropagation();
      toggleMenu();
      return;
    }
    if (down && isMuralwalkActive() && g.playing && e.code === "KeyB") {
      e.preventDefault();
      e.stopPropagation();
      openMenu();
      return;
    }
    if (
      down &&
      isMuralwalkActive() &&
      g.playing &&
      !g.menuOpen &&
      !isEditableTarget(e.target) &&
      (e.code === "Space" ||
        e.key === " " ||
        e.code === "PageUp" ||
        e.code === "PageDown" ||
        e.code === "Home" ||
        e.code === "End")
    ) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  function getInputDir() {
    var mh = g.moveHeld;
    var tm = g.touchMove;
    var dx = 0;
    var dy = 0;
    if (mh.KeyW || mh.ArrowUp || tm.w) dy -= 1;
    if (mh.KeyS || mh.ArrowDown || tm.s) dy += 1;
    if (mh.KeyA || mh.ArrowLeft || tm.a) dx -= 1;
    if (mh.KeyD || mh.ArrowRight || tm.d) dx += 1;
    syncLegacyKeys();
    return { dx: dx, dy: dy };
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function spellDescription(num) {
    var a = getAnalysis(num);
    if (!a) {
      return analysesReady()
        ? "Painting #" + num + " — no analysis on file."
        : "Loading painting analysis…";
    }
    var parts = [];
    if (a.title) parts.push(a.title);
    if (a.description) parts.push(a.description);
    else if (a.style) parts.push(a.style);
    return parts.join(". ") || "Painting #" + num;
  }

  function pickRandomSpell(exclude, salt) {
    exclude = exclude || [];
    salt = salt == null ? g.fx.seed : salt;
    var analyzed =
      typeof window.getAnalyzedPaintingNumbers === "function"
        ? window.getAnalyzedPaintingNumbers()
        : null;
    if (analyzed && analyzed.length) {
      var fast = [];
      for (var i = 0; i < analyzed.length; i++) {
        if (exclude.indexOf(analyzed[i]) < 0) fast.push(analyzed[i]);
      }
      if (fast.length) return SM.pickFromPool(fast, salt);
    }
    for (var t = 0; t < 48; t++) {
      var probe = 1 + (SM.spellHash(salt + t, TOTAL) % TOTAL);
      if (exclude.indexOf(probe) >= 0) continue;
      if (getAnalysis(probe)) return probe;
    }
    var pool = SM.buildSpellPool(TOTAL, exclude, function (i) {
      return !!getAnalysis(i);
    });
    var picked = SM.pickFromPool(pool, salt);
    if (picked) return picked;
    var seed = salt + exclude.length * 17;
    for (var f = 0; f < TOTAL; f++) {
      var cand = 1 + (SM.spellHash(seed + f, TOTAL) % TOTAL);
      if (exclude.indexOf(cand) < 0) return cand;
    }
    return 1;
  }

  function initSlots() {
    g.fx.seed += 17;
    g.stasisFromApi = false;
    g._floorRequestKey = "";
    g._localBootstrapDone = false;
    g._aiStasisLanded = false;
    g._bootstrapPromise = null;
    if (!syncFromSpellforge()) {
      var used = [];
      for (var i = 0; i < 3; i++) {
        var n = pickRandomSpell(used);
        g.slots[i] = n;
        if (n) used.push(n);
      }
      syncEquippedSpells();
      regenerateStasisText();
    }
    refreshMenuPanel();
  }

  function syncSpellforgeVision() {
    var sf = window.spellforgeFusion;
    if (!sf || !sf.visionUrl || !sf.spells || sf.spells.length < 2) return false;
    if (!spellsMatch(sf.spells, equippedNums())) return false;
    if (sf.stasis) {
      g.stasisText = sf.stasis;
      g.stasisFromApi = true;
    }
    if (sf.title) g.stasisTitle = sf.title;
    if (sf.buzz) g.buzzWords = sf.buzz;
    g.fusion.visionUrl = sf.visionUrl;
    g.fusion.source = "ai";
    loadFusionImage(sf.visionUrl, g.floorUnlocked, "ai").catch(function () {});
    refreshReadouts();
    return true;
  }

  function parseStasisSubjects(stasis, nums) {
    var subjects = [];
    var text = String(stasis || "").replace(/^[^:]+:\s*/, "");
    var parts = text.split(/\s+While\s+|\s+As\s+|\s+— yet\s+|; together,\s+/i);
    for (var i = 0; i < parts.length; i++) {
      var chunk = parts[i].replace(/\.\s*Shared.*$/i, "").trim();
      var sentence = chunk.split(/[.!?]/)[0].trim();
      if (sentence.length > 8) subjects.push(sentence);
    }
    for (var j = 0; j < nums.length; j++) {
      if (subjects[j]) continue;
      var a = getAnalysis(nums[j]);
      if (a && a.description) subjects.push(a.description.split(/[.!?]/)[0].trim());
      else if (a && a.title) subjects.push(a.title);
      else subjects.push("Spell #" + nums[j]);
    }
    return subjects.slice(0, 3);
  }

  function layoutStasisProps(subjects, nums) {
    g.stasisProps = [];
    for (var i = 0; i < subjects.length; i++) {
      var dist = 130 + i * 55;
      var pos = C.propWorldPos(i, dist);
      g.stasisProps.push({
        spellNum: nums[i],
        subject: subjects[i],
        x: pos.x,
        y: pos.y,
        img: null,
        url: "",
        status: "pending",
        slot: i,
      });
    }
  }

  function loadPropImage(prop, url) {
    if (!url) {
      prop.status = "error";
      return Promise.resolve();
    }
    return new Promise(function (resolve) {
      var img = new Image();
      var isLocal = url.indexOf("data:") === 0 || url.indexOf("blob:") === 0;
      if (!isLocal) img.crossOrigin = "anonymous";
      img.onload = function () {
        prop.img = img;
        prop.url = url;
        prop.status = "ready";
        resolve();
      };
      img.onerror = function () {
        prop.status = "error";
        resolve();
      };
      img.src = url;
    });
  }

  function sharedStasisVisionUrl() {
    if (g.fusion.visionUrl) return Promise.resolve(g.fusion.visionUrl);
    var nums = equippedNums();
    if (nums.length < 2 || typeof window.composeStasisVisionLocal !== "function") {
      return Promise.resolve("");
    }
    return window
      .composeStasisVisionLocal({
        spells: nums,
        stasis: g.stasisText,
        buzz_words: collectBuzzForEquipped(),
      })
      .then(function (url) {
        if (url) loadFusionImage(url, g.floorUnlocked, "local").catch(function () {});
        return url;
      })
      .catch(function () {
        return "";
      });
  }

  function evolveStasisProps() {
    var nums = equippedNums();
    if (nums.length < 2 || !g.stasisText.trim()) {
      g.stasisProps = [];
      return Promise.resolve();
    }
    var subjects = parseStasisSubjects(g.stasisText, nums);
    layoutStasisProps(subjects, nums);
    g._propGenToken += 1;
    var token = g._propGenToken;
    return sharedStasisVisionUrl().then(function (url) {
      if (token !== g._propGenToken) return;
      return Promise.all(
        g.stasisProps.map(function (prop) {
          prop.status = "generating";
          if (url) return loadPropImage(prop, url);
          prop.status = "ready";
          return Promise.resolve();
        })
      );
    });
  }

  function drawPropVision(ctx, p, sx, sy, size) {
    var img = p.img;
    if (!img || !img.complete || !img.naturalWidth) return false;
    var slot = p.slot || 0;
    var iw = img.naturalWidth;
    var ih = img.naturalHeight;
    var crop = C.visionCrop(slot, g.fx.seed, g.stasisVariant);
    var cropW = iw * crop.cropWFrac;
    var cropH = ih * crop.cropHFrac;
    var sx0 = clamp(crop.u * iw - cropW / 2, 0, Math.max(0, iw - cropW));
    var sy0 = clamp(crop.v * ih - cropH / 2, 0, Math.max(0, ih - cropH));
    var sc = size / Math.max(cropW, cropH);
    var dw = cropW * sc;
    var dh = cropH * sc;
    var tilt = crop.tilt;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(tilt);
    ctx.shadowColor = "rgba(201,162,39,0.55)";
    ctx.shadowBlur = 20;
    ctx.drawImage(img, sx0, sy0, cropW, cropH, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();
    return true;
  }

  function drawStasisProps(ctx) {
    if (!g.stasisProps.length) return;
    for (var i = 0; i < g.stasisProps.length; i++) {
      var p = g.stasisProps[i];
      var scr = worldToScreen(p.x, p.y);
      var sx = scr.x;
      var sy = scr.y;
      if (sx < -220 || sy < -220 || sx > g.w + 220 || sy > g.h + 220) continue;
      var pulse =
        p.status === "generating"
          ? 0.55 + Math.sin(Date.now() * 0.007 + i) * 0.3
          : 1;
      var size = C.entityDrawSize(132, i, g.fx.seed, g.stasisVariant, 48);

      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = "rgba(201,162,39,0.18)";
      ctx.beginPath();
      ctx.ellipse(sx, sy + size * 0.42, size * 0.55, size * 0.14, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.globalAlpha = pulse;
      if (!drawPropVision(ctx, p, sx, sy, size)) {
        ctx.strokeStyle = "#c9a227";
        ctx.setLineDash([5, 4]);
        ctx.strokeRect(sx - size / 2, sy - size / 2, size, size);
        ctx.fillStyle = "rgba(201,162,39,0.12)";
        ctx.fillRect(sx - size / 2, sy - size / 2, size, size);
        ctx.fillStyle = "#f5e6a8";
        ctx.font = "11px Courier New, monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(p.status === "generating" ? "forming…" : "…", sx, sy);
      }
      ctx.restore();

      ctx.save();
      ctx.fillStyle = "rgba(245,230,200,0.9)";
      ctx.font = "9px Courier New, monospace";
      ctx.textAlign = "center";
      var label = p.subject.length > 40 ? p.subject.slice(0, 38) + "…" : p.subject;
      ctx.fillText(label, sx, sy + size * 0.58);
      ctx.restore();
    }
  }

  function entityMetaForSpell(spellNum) {
    var a = getAnalysis(spellNum);
    return {
      tags: (a && a.tags) || [],
      styles: uniqueList([a && a.style, a && a.medium].filter(Boolean)),
      mood: (a && a.mood) || "",
    };
  }

  function recordEntityOutcome(action) {
    var url = g.fusion.visionUrl || g.fusion._url;
    if (!url || !hasVisionFloor()) return;
    var nums = equippedNums();
    if (nums.length < 2 || !g.stasisText.trim()) return;
    var entry = {
      shift: g.spellShiftCount,
      visionUrl: url,
      stasisText: g.stasisText,
      stasisTitle: g.stasisTitle,
      spells: nums.slice(),
      subjects: parseStasisSubjects(g.stasisText, nums),
      source: g.fusion.source,
      action: action || "vision",
      ts: Date.now(),
    };
    var kept = [];
    for (var i = 0; i < g.entityOutcomeHistory.length; i++) {
      if (g.entityOutcomeHistory[i].shift !== entry.shift) {
        kept.push(g.entityOutcomeHistory[i]);
      }
    }
    kept.unshift(entry);
    if (kept.length > ENTITY_OUTCOME_HISTORY_MAX) kept.length = ENTITY_OUTCOME_HISTORY_MAX;
    g.entityOutcomeHistory = kept;
  }

  function ensureEntityOutcomeImage(url) {
    if (!url) return null;
    if (g._entityOutcomeImgCache[url]) return g._entityOutcomeImgCache[url];
    var img = new Image();
    var isLocal = url.indexOf("data:") === 0 || url.indexOf("blob:") === 0;
    if (!isLocal) img.crossOrigin = "anonymous";
    img.src = url;
    g._entityOutcomeImgCache[url] = img;
    return img;
  }

  function getEntityOutcomesForLayout() {
    var outcomes = [];
    var nums = equippedNums();
    if (nums.length >= 2 && g.stasisText.trim() && hasVisionFloor()) {
      outcomes.push({
        shift: g.spellShiftCount,
        visionUrl: g.fusion.visionUrl || g.fusion._url,
        stasisText: g.stasisText,
        spells: nums.slice(),
        subjects: parseStasisSubjects(g.stasisText, nums),
        age: 0,
      });
    }
    for (var i = 0; i < g.entityOutcomeHistory.length; i++) {
      var h = g.entityOutcomeHistory[i];
      if (h.shift === g.spellShiftCount) continue;
      var age = g.spellShiftCount - h.shift;
      if (age <= 0 || age > ENTITY_OUTCOME_HISTORY_MAX) continue;
      ensureEntityOutcomeImage(h.visionUrl);
      outcomes.push({
        shift: h.shift,
        visionUrl: h.visionUrl,
        stasisText: h.stasisText,
        spells: h.spells || [],
        subjects: h.subjects || [],
        age: age,
      });
    }
    return outcomes;
  }

  function drawEntityVision(ctx, ent, sx, sy, size) {
    var url = ent.visionUrl;
    if (!url) return false;
    var img = ensureEntityOutcomeImage(url);
    if (!img || !img.complete || !img.naturalWidth) return false;
    var slot = ent.visionSlot != null ? ent.visionSlot : ent.slot || 0;
    var crop = C.visionCrop(slot, g.fx.seed, ent.outcomeShift != null ? ent.outcomeShift : g.spellShiftCount);
    var iw = img.naturalWidth;
    var ih = img.naturalHeight;
    var cropW = iw * crop.cropWFrac;
    var cropH = ih * crop.cropHFrac;
    var sx0 = clamp(crop.u * iw - cropW / 2, 0, Math.max(0, iw - cropW));
    var sy0 = clamp(crop.v * ih - cropH / 2, 0, Math.max(0, ih - cropH));
    var sc = size / Math.max(cropW, cropH);
    var dw = cropW * sc;
    var dh = cropH * sc;
    ctx.save();
    ctx.globalAlpha *= ent.alpha != null ? ent.alpha : 1;
    ctx.translate(sx, sy);
    ctx.rotate(crop.tilt + (ent.maze ? 0 : 0.04));
    ctx.shadowColor = "rgba(201,162,39,0.45)";
    ctx.shadowBlur = ent.maze ? 10 : 16;
    ctx.drawImage(img, sx0, sy0, cropW, cropH, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();
    return true;
  }

  function resolveGeometryKind(ent) {
    if (ent.geometryKind) return ent.geometryKind;
    if (ent.maze) return "wall";
    var tags = (ent.tags || []).join(" ").toLowerCase();
    var styles = (ent.styles || []).join(" ").toLowerCase();
    var text = String(ent.subject || "").toLowerCase() + " " + tags + " " + styles;
    if (ent.kind === "enemy") {
      if (/\b(bat|wing|flutter)\b/.test(text)) return "bat";
      if (/\b(eye|gaze|watch|stare)\b/.test(text)) return "eye";
      if (/\b(spirit|soul|ghost|wisp|phantom|specter|spectre)\b/.test(text)) return "wisp";
      if (/\b(beast|creature|monster|fiend|demon|wolf|rat|hound)\b/.test(text)) return "beast";
      return "skull";
    }
    if (/\b(tree|forest|branch|wood|oak|grove)\b/.test(text)) return "tree";
    if (/\b(dune|desert|sand|arid)\b/.test(text)) return "dune";
    if (/\b(arch|gate|door|portal)\b/.test(text)) return "arch";
    if (/\b(tower|spire|obelisk|column|pillar)\b/.test(text)) return "spire";
    if (/\b(rock|stone|cliff|boulder|granite)\b/.test(text)) return "rock";
    if (/\b(water|wave|river|sea|pool|lake)\b/.test(text)) return "pool";
    if (/\babstract|geometric|minimal|angular/.test(styles)) return "crystal";
    if (/\borganic|curv|flow|soft/.test(styles + " " + tags)) return "mound";
    return "mound";
  }

  function entityPalette(ent) {
    var pals =
      window.StasisWalkFloor && window.StasisWalkFloor.paletteFromBuzz
        ? window.StasisWalkFloor.paletteFromBuzz(ent.tags || [], ent.subject || g.stasisText)
        : [[120, 100, 140]];
    return pals[ent.slot % pals.length] || [120, 100, 140];
  }

  function rgbFill(ctx, rgb, alpha) {
    ctx.fillStyle = "rgba(" + rgb.join(",") + "," + (alpha == null ? 0.9 : alpha) + ")";
  }

  function rgbStroke(ctx, rgb, alpha, width) {
    ctx.strokeStyle = "rgba(" + rgb.join(",") + "," + (alpha == null ? 1 : alpha) + ")";
    ctx.lineWidth = width == null ? 2 : width;
  }

  function drawTreeGeometry(ctx, sx, sy, size, rgb) {
    var trunkW = size * 0.14;
    var trunkH = size * 0.55;
    rgbFill(ctx, [rgb[0] * 0.45, rgb[1] * 0.38, rgb[2] * 0.32], 0.95);
    ctx.fillRect(sx - trunkW / 2, sy - trunkH, trunkW, trunkH);
    rgbFill(ctx, rgb, 0.88);
    ctx.beginPath();
    ctx.moveTo(sx, sy - size * 1.15);
    ctx.lineTo(sx - size * 0.42, sy - size * 0.35);
    ctx.lineTo(sx + size * 0.42, sy - size * 0.35);
    ctx.closePath();
    ctx.fill();
    rgbFill(ctx, [rgb[0] + 18, rgb[1] + 14, rgb[2] + 10], 0.55);
    ctx.beginPath();
    ctx.arc(sx - size * 0.12, sy - size * 0.72, size * 0.22, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawSpireGeometry(ctx, sx, sy, size, rgb) {
    rgbFill(ctx, rgb, 0.9);
    ctx.beginPath();
    ctx.moveTo(sx, sy - size * 1.2);
    ctx.lineTo(sx - size * 0.22, sy);
    ctx.lineTo(sx + size * 0.22, sy);
    ctx.closePath();
    ctx.fill();
    rgbStroke(ctx, [rgb[0] + 30, rgb[1] + 24, rgb[2] + 18], 0.7, 2);
    ctx.strokeRect(sx - size * 0.28, sy, size * 0.56, size * 0.12);
  }

  function drawRockGeometry(ctx, sx, sy, size, rgb) {
    rgbFill(ctx, rgb, 0.92);
    ctx.beginPath();
    ctx.moveTo(sx - size * 0.38, sy);
    ctx.lineTo(sx - size * 0.2, sy - size * 0.55);
    ctx.lineTo(sx + size * 0.08, sy - size * 0.62);
    ctx.lineTo(sx + size * 0.36, sy - size * 0.2);
    ctx.lineTo(sx + size * 0.28, sy);
    ctx.closePath();
    ctx.fill();
    rgbStroke(ctx, [rgb[0] - 20, rgb[1] - 18, rgb[2] - 16], 0.65, 2);
    ctx.stroke();
  }

  function drawDuneGeometry(ctx, sx, sy, size, rgb) {
    rgbFill(ctx, [rgb[0] + 20, rgb[1] + 12, rgb[2] - 8], 0.85);
    ctx.beginPath();
    ctx.moveTo(sx - size * 0.55, sy);
    ctx.quadraticCurveTo(sx - size * 0.1, sy - size * 0.45, sx + size * 0.5, sy);
    ctx.lineTo(sx - size * 0.55, sy);
    ctx.fill();
    rgbFill(ctx, rgb, 0.55);
    ctx.beginPath();
    ctx.moveTo(sx - size * 0.2, sy + 2);
    ctx.quadraticCurveTo(sx + size * 0.15, sy - size * 0.22, sx + size * 0.42, sy + 2);
    ctx.fill();
  }

  function drawArchGeometry(ctx, sx, sy, size, rgb) {
    rgbStroke(ctx, rgb, 0.95, 3);
    ctx.beginPath();
    ctx.moveTo(sx - size * 0.38, sy);
    ctx.lineTo(sx - size * 0.38, sy - size * 0.55);
    ctx.quadraticCurveTo(sx, sy - size * 0.95, sx + size * 0.38, sy - size * 0.55);
    ctx.lineTo(sx + size * 0.38, sy);
    ctx.stroke();
    rgbFill(ctx, [rgb[0] * 0.6, rgb[1] * 0.55, rgb[2] * 0.5], 0.35);
    ctx.fillRect(sx - size * 0.38, sy - size * 0.08, size * 0.76, size * 0.08);
  }

  function drawPoolGeometry(ctx, sx, sy, size, rgb) {
    rgbFill(ctx, [rgb[0] * 0.7, rgb[1] * 0.85, rgb[2] + 30], 0.75);
    ctx.beginPath();
    ctx.ellipse(sx, sy - size * 0.08, size * 0.48, size * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
    rgbStroke(ctx, [rgb[0] + 40, rgb[1] + 50, rgb[2] + 60], 0.5, 1.5);
    ctx.beginPath();
    ctx.ellipse(sx, sy - size * 0.08, size * 0.48, size * 0.18, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  function drawCrystalGeometry(ctx, sx, sy, size, rgb) {
    rgbFill(ctx, rgb, 0.88);
    ctx.beginPath();
    ctx.moveTo(sx, sy - size * 0.95);
    ctx.lineTo(sx + size * 0.3, sy - size * 0.35);
    ctx.lineTo(sx + size * 0.12, sy);
    ctx.lineTo(sx - size * 0.12, sy);
    ctx.lineTo(sx - size * 0.3, sy - size * 0.35);
    ctx.closePath();
    ctx.fill();
    rgbStroke(ctx, [255, 255, 255], 0.35, 1);
    ctx.stroke();
  }

  function drawMoundGeometry(ctx, sx, sy, size, rgb) {
    rgbFill(ctx, rgb, 0.86);
    ctx.beginPath();
    ctx.ellipse(sx, sy - size * 0.18, size * 0.42, size * 0.34, 0, Math.PI, 0);
    ctx.fill();
    rgbFill(ctx, [rgb[0] - 12, rgb[1] - 10, rgb[2] - 8], 0.7);
    ctx.fillRect(sx - size * 0.42, sy - size * 0.18, size * 0.84, size * 0.18);
  }

  function drawWallGeometry(ctx, sx, sy, size, rgb) {
    var w = size * 0.92;
    var h = size * 0.92;
    rgbFill(ctx, [rgb[0] * 0.35, rgb[1] * 0.32, rgb[2] * 0.38], 0.95);
    ctx.fillRect(sx - w / 2, sy - h / 2, w, h);
    rgbStroke(ctx, [rgb[0] + 22, rgb[1] + 18, rgb[2] + 14], 0.55, 2);
    ctx.strokeRect(sx - w / 2, sy - h / 2, w, h);
    rgbFill(ctx, rgb, 0.35);
    for (var row = 0; row < 3; row++) {
      for (var col = 0; col < 3; col++) {
        if ((row + col) % 2) continue;
        ctx.fillRect(
          sx - w / 2 + col * (w / 3) + 2,
          sy - h / 2 + row * (h / 3) + 2,
          w / 3 - 4,
          h / 3 - 4
        );
      }
    }
  }

  function drawBatGeometry(ctx, sx, sy, size, rgb) {
    rgbFill(ctx, rgb, 0.9);
    ctx.beginPath();
    ctx.moveTo(sx, sy - size * 0.15);
    ctx.quadraticCurveTo(sx - size * 0.65, sy - size * 0.55, sx - size * 0.45, sy);
    ctx.lineTo(sx, sy - size * 0.35);
    ctx.quadraticCurveTo(sx + size * 0.65, sy - size * 0.55, sx + size * 0.45, sy);
    ctx.closePath();
    ctx.fill();
    rgbFill(ctx, [30, 24, 28], 0.95);
    ctx.beginPath();
    ctx.arc(sx, sy - size * 0.22, size * 0.1, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawEyeGeometry(ctx, sx, sy, size, rgb) {
    rgbFill(ctx, rgb, 0.85);
    ctx.beginPath();
    ctx.ellipse(sx, sy - size * 0.35, size * 0.42, size * 0.28, 0, 0, Math.PI * 2);
    ctx.fill();
    rgbFill(ctx, [20, 18, 22], 0.95);
    ctx.beginPath();
    ctx.arc(sx, sy - size * 0.35, size * 0.16, 0, Math.PI * 2);
    ctx.fill();
    rgbFill(ctx, [240, 220, 180], 0.9);
    ctx.beginPath();
    ctx.arc(sx + size * 0.04, sy - size * 0.38, size * 0.05, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawWispGeometry(ctx, sx, sy, size, rgb) {
    rgbFill(ctx, rgb, 0.55);
    for (var i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.ellipse(
        sx + (i - 1) * size * 0.14,
        sy - size * (0.35 + i * 0.08),
        size * 0.22,
        size * 0.34,
        0,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }
  }

  function drawBeastGeometry(ctx, sx, sy, size, rgb) {
    rgbFill(ctx, rgb, 0.9);
    ctx.beginPath();
    ctx.moveTo(sx - size * 0.42, sy);
    ctx.lineTo(sx - size * 0.2, sy - size * 0.45);
    ctx.lineTo(sx + size * 0.05, sy - size * 0.55);
    ctx.lineTo(sx + size * 0.38, sy - size * 0.25);
    ctx.lineTo(sx + size * 0.3, sy);
    ctx.closePath();
    ctx.fill();
    rgbFill(ctx, [40, 30, 35], 0.9);
    ctx.beginPath();
    ctx.arc(sx + size * 0.18, sy - size * 0.32, size * 0.06, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawSkullGeometry(ctx, sx, sy, size, rgb) {
    rgbFill(ctx, rgb, 0.88);
    ctx.beginPath();
    ctx.arc(sx, sy - size * 0.38, size * 0.28, 0, Math.PI * 2);
    ctx.fill();
    rgbFill(ctx, [30, 24, 28], 0.95);
    ctx.fillRect(sx - size * 0.1, sy - size * 0.42, size * 0.08, size * 0.08);
    ctx.fillRect(sx + size * 0.02, sy - size * 0.42, size * 0.08, size * 0.08);
    ctx.beginPath();
    ctx.moveTo(sx - size * 0.08, sy - size * 0.22);
    ctx.lineTo(sx, sy - size * 0.12);
    ctx.lineTo(sx + size * 0.08, sy - size * 0.22);
    ctx.strokeStyle = "rgba(30,24,28,0.9)";
    ctx.stroke();
  }

  function drawEntityGeometry(ctx, ent, sx, sy, size, tall) {
    if (drawEntityVision(ctx, ent, sx, sy, size)) {
      if (!ent.maze) {
        ctx.save();
        ctx.globalAlpha = (ent.alpha != null ? ent.alpha : 1) * 0.35;
        ctx.strokeStyle = "rgba(255,240,200,0.55)";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(sx - size * 0.34, sy - size * 0.55, size * 0.68, size * 0.62);
        ctx.restore();
      }
      return;
    }
    var kind = resolveGeometryKind(ent);
    var rgb = entityPalette(ent);
    var draw = {
      tree: drawTreeGeometry,
      spire: drawSpireGeometry,
      rock: drawRockGeometry,
      dune: drawDuneGeometry,
      arch: drawArchGeometry,
      pool: drawPoolGeometry,
      crystal: drawCrystalGeometry,
      mound: drawMoundGeometry,
      wall: drawWallGeometry,
      bat: drawBatGeometry,
      eye: drawEyeGeometry,
      wisp: drawWispGeometry,
      beast: drawBeastGeometry,
      skull: drawSkullGeometry,
    }[kind];
    if (draw) draw(ctx, sx, sy, tall ? size * 1.1 : size, rgb);
    else if (ent.kind === "enemy") drawSkullGeometry(ctx, sx, sy, size, rgb);
    else drawMoundGeometry(ctx, sx, sy, size, rgb);
  }

  function drawObstacles(ctx) {
    if (!g.obstacles.length) return;
    for (var i = 0; i < g.obstacles.length; i++) {
      var o = g.obstacles[i];
      var scr = worldToScreen(o.x, o.y);
      var sx = scr.x;
      var sy = scr.y;
      if (sx < -160 || sy < -200 || sx > g.w + 160 || sy > g.h + 80) continue;
      var size = C.entityDrawSize(88, i, g.fx.seed, g.stasisVariant, 36);
      ctx.save();
      ctx.globalAlpha = (o.alpha != null ? o.alpha : 1) * 0.38;
      ctx.fillStyle = "rgba(20,18,16,0.55)";
      ctx.beginPath();
      ctx.ellipse(sx, sy + 8, size * 0.42, size * 0.1, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.globalAlpha = o.alpha != null ? o.alpha : 1;
      drawEntityGeometry(ctx, o, sx, sy, size, true);
      ctx.restore();
      if (!o.maze && (o.alpha == null || o.alpha > 0.45)) {
        ctx.save();
        ctx.fillStyle = "rgba(245,230,200,0.85)";
        ctx.font = "8px Courier New, monospace";
        ctx.textAlign = "center";
        ctx.fillText(o.subject, sx, sy + 14);
        ctx.restore();
      }
    }
  }

  var FALLOUT_ENEMY_COLORS = {
    n: "#8ec5ff",
    ne: "#b8a0ff",
    e: "#ffb088",
    se: "#ffd070",
    s: "#98e8a8",
    sw: "#88d8c8",
    w: "#90c8ff",
    nw: "#c8b0ff",
  };

  function falloutEnemyPortrait(enemy) {
    var cell = getEnemyMosaicCell(enemy);
    if (cell && cell._thumbUrl) {
      if (!enemy._thumbImg) {
        enemy._thumbImg = new Image();
        enemy._thumbImg.src = cell._thumbUrl;
      } else if (enemy._thumbImg.src !== cell._thumbUrl) {
        enemy._thumbImg.src = cell._thumbUrl;
      }
      if (enemy._thumbImg.complete && enemy._thumbImg.naturalWidth) {
        return enemy._thumbImg;
      }
    }
    if (cell && cell.visionImg && cell.visionImg.complete && cell.visionImg.naturalWidth) {
      mosaicCellThumbUrl(cell);
      return cell.visionImg;
    }
    if (enemy.visionUrl) {
      var cached = ensureEntityOutcomeImage(enemy.visionUrl);
      if (cached && cached.complete && cached.naturalWidth) return cached;
    }
    return preloadPaintingThumb(enemy.spellNum);
  }

  function drawFalloutEnemyOrb(ctx, e, sx, sy, size, pulse) {
    var r = size * 0.52;
    var color = FALLOUT_ENEMY_COLORS[e.compass] || "#ff9898";
    var img = falloutEnemyPortrait(e);
    var bob = Math.sin(Date.now() * 0.002 + e.phase) * 4;
    ctx.save();
    ctx.globalAlpha = pulse * (e.alpha != null ? e.alpha : 1);
    ctx.shadowColor = color;
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.arc(sx, sy + bob, r + 4, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(12,10,14,0.94)";
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.save();
    ctx.beginPath();
    ctx.arc(sx, sy + bob, r - 1, 0, Math.PI * 2);
    ctx.clip();
    if (img && img.complete && img.naturalWidth) {
      ctx.drawImage(img, sx - r, sy + bob - r, r * 2, r * 2);
    } else {
      ctx.fillStyle = "rgba(70,55,105,0.65)";
      ctx.fillRect(sx - r, sy + bob - r, r * 2, r * 2);
    }
    ctx.restore();
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(sx, sy + bob, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#fff8e8";
    ctx.font = "bold 9px Courier New, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(e.compassLabel || e.compass || "?", sx, sy + bob + r + 11);
    ctx.restore();
  }

  function drawEnemies(ctx) {
    if (!g.enemies.length) return;
    var t = Date.now() * 0.001;
    for (var i = 0; i < g.enemies.length; i++) {
      var e = g.enemies[i];
      var scr = worldToScreen(e.x, e.y);
      var sx = scr.x;
      var sy = scr.y;
      if (sx < -160 || sy < -160 || sx > g.w + 160 || sy > g.h + 160) continue;
      var pulse = 0.72 + Math.sin(t * 3 + e.phase) * 0.22;
      var size = C.entityDrawSize(72, i, g.fx.seed, g.stasisVariant, 28);
      if (e.fallout) {
        drawFalloutEnemyOrb(ctx, e, sx, sy, size, pulse);
        continue;
      }
      ctx.save();
      ctx.globalAlpha = (e.alpha != null ? e.alpha : 1) * 0.28;
      ctx.fillStyle = "rgba(180,60,60,0.45)";
      ctx.beginPath();
      ctx.arc(sx, sy, size * 0.55, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.globalAlpha = pulse * (e.alpha != null ? e.alpha : 1);
      drawEntityGeometry(ctx, e, sx, sy - Math.sin(t * 2 + e.phase) * 6, size, false);
      ctx.restore();
      ctx.save();
      ctx.fillStyle = "#ffb0b0";
      ctx.font = "bold 8px Courier New, monospace";
      ctx.textAlign = "center";
      ctx.fillText(e.subject, sx, sy + size * 0.55);
      ctx.restore();
    }
  }

  function getFalloutSaveTurnKey() {
    for (var i = 0; i < FALLOUT_HUD_ORDER.length; i++) {
      var key = FALLOUT_HUD_ORDER[i];
      var enemy = falloutEnemyForCompass(key);
      if (!enemy) continue;
      if (enemyStasisReadyForSave(enemy) && !isEnemyStasisSaved(enemy)) return key;
    }
    return null;
  }

  function falloutVisionBusyForCompass(compass) {
    if (!compass) return false;
    if (g._workActive && g._workActiveKey === compass && g._queueStatus === "fallout_gen") {
      return true;
    }
    if (
      g._workActive &&
      g._workActiveKey === compass &&
      g._queueStatus === "fallout_vision"
    ) {
      return true;
    }
    if (g._workActive && g._mapLoadCompass === compass && g._queueStatus === "fallout_gen") {
      return true;
    }
    for (var i = 0; i < g._workQueue.length; i++) {
      var item = g._workQueue[i];
      if (item.key !== compass) continue;
      if (item.kind === "fallout_gen" || item.kind === "fallout_vision") return true;
    }
    return false;
  }

  function purgeFalloutVisionQueue(compass) {
    if (!compass) return;
    if (g._workQueue.length) {
      g._workQueue = g._workQueue.filter(function (item) {
        return !(item.kind === "fallout_vision" && item.key === compass);
      });
    }
  }

  function falloutGenQueuedForCompass(compass) {
    if (!compass) return false;
    if (g._workActive && g._workActiveKey === compass && g._queueStatus === "fallout_gen") {
      return true;
    }
    for (var i = 0; i < g._workQueue.length; i++) {
      var item = g._workQueue[i];
      if (item.kind === "fallout_gen" && item.key === compass) return true;
    }
    return false;
  }

  function falloutGenPipelineBusy() {
    if (
      g._workActive &&
      (g._queueStatus === "fallout_gen" || g._queueStatus === "fallout_map_load")
    ) {
      return true;
    }
    for (var j = 0; j < g._workQueue.length; j++) {
      var kind = g._workQueue[j].kind;
      if (kind === "fallout_gen" || kind === "fallout_map_load") return true;
    }
    return false;
  }

  function stasisSaveQueueBusy() {
    if (g._falloutSaveCompass) return true;
    if (
      g._workActive &&
      (g._queueStatus === "stasis_save" ||
        g._queueStatus === "fallout_save" ||
        g._queueStatus === "player_save")
    ) {
      return true;
    }
    for (var j = 0; j < g._workQueue.length; j++) {
      var sk = g._workQueue[j].kind;
      if (sk === "stasis_save" || sk === "fallout_save" || sk === "player_save") return true;
    }
    return false;
  }

  function falloutSaveQueueBusy() {
    return stasisSaveQueueBusy();
  }

  function allNineStasisGalleryReady() {
    if (!hasVisionFloor()) return false;
    syncMosaicCenterCell();
    ensureMosaicRing();
    for (var i = 0; i < FALLOUT_HUD_ORDER.length; i++) {
      var compass = mosaicCompassByKey(FALLOUT_HUD_ORDER[i]);
      var cell = compass ? mosaicCellForCompass(compass) : null;
      if (!compassCellReady(cell)) return false;
    }
    return true;
  }

  function compassSpellsForSlot(key, cell, enemy) {
    if (cell && cell.spells && cell.spells.length) return cell.spells.slice();
    if (enemy) return falloutSpellNums(enemy);
    return [];
  }

  function isCompassSlotSaved(key) {
    if (key === "center") return isPlayerStasisSaved();
    var compass = mosaicCompassByKey(key);
    var cell = compass ? mosaicCellForCompass(compass) : null;
    if (!compassCellReady(cell)) return false;
    var enemy = falloutEnemyForCompass(key);
    var spells = compassSpellsForSlot(key, cell, enemy);
    var saveKey = stasisContentKey(cell.visionUrl, spells);
    if (cell._savedKey && cell._savedKey === saveKey) return true;
    if (enemy && enemy._savedKey && enemy._savedKey === saveKey) return true;
    return false;
  }

  function compassSlotNeedsSave(key) {
    if (key === "center") return playerStasisReadyForSave();
    var compass = mosaicCompassByKey(key);
    var cell = compass ? mosaicCellForCompass(compass) : null;
    if (!compassCellReady(cell)) return false;
    return !isCompassSlotSaved(key);
  }

  function countUnsavedStasisPieces() {
    var n = 0;
    for (var i = 0; i < STASIS_VISION_GALLERY_KEYS.length; i++) {
      if (compassSlotNeedsSave(STASIS_VISION_GALLERY_KEYS[i])) n += 1;
    }
    return n;
  }

  function hasUnsavedStasisPieces() {
    return countUnsavedStasisPieces() > 0;
  }

  function allNineStasisSaved() {
    if (!allNineStasisGalleryReady()) return false;
    for (var i = 0; i < STASIS_VISION_GALLERY_KEYS.length; i++) {
      if (compassSlotNeedsSave(STASIS_VISION_GALLERY_KEYS[i])) return false;
    }
    return true;
  }

  function stasisGenBlockedBySaveCycle() {
    return !!(g.playing && allNineStasisGalleryReady() && hasUnsavedStasisPieces());
  }

  function stasisSpellHuntBlocked() {
    return !!(g.playing && allNineStasisGalleryReady() && !allNineStasisSaved());
  }

  function purgeFalloutGenQueue() {
    if (g._workQueue.length) {
      g._workQueue = g._workQueue.filter(function (item) {
        return (
          item.kind !== "fallout_gen" &&
          item.kind !== "fallout_vision" &&
          item.kind !== "stasis_save" &&
          item.kind !== "fallout_save" &&
          item.kind !== "player_save"
        );
      });
    }
  }

  function onStasisSaveCycleComplete() {
    if (!allNineStasisSaved()) return;
    if (g._stasisSaveRetryTimer) {
      clearTimeout(g._stasisSaveRetryTimer);
      g._stasisSaveRetryTimer = 0;
    }
    g.spellProjectiles = [];
    setFloorStatus("All 9 stasis visions saved — spell hunt unlocked.", {
      duration: 2800,
      sticky: false,
    });
    scheduleFalloutHudUpdate();
    ensureActionOrbs();
    ensureFalloutMapLoaded();
  }

  function checkStasisSaveCycleProgress() {
    scheduleFalloutHudUpdate();
    if (allNineStasisSaved()) {
      onStasisSaveCycleComplete();
      return;
    }
    if (allNineStasisGalleryReady() && hasUnsavedStasisPieces()) {
      purgeFalloutGenQueue();
      drainStasisSaveBacklot();
      return;
    }
    if (compassCellsNeedingGen().length || hasUnsavedStasisPieces()) {
      ensureFalloutMapLoaded();
    }
  }

  function getNextStasisSaveTarget() {
    for (var i = 0; i < FALLOUT_HUD_ORDER.length; i++) {
      var compassKey = FALLOUT_HUD_ORDER[i];
      if (compassSlotNeedsSave(compassKey)) return compassKey;
    }
    if (compassSlotNeedsSave("center")) return "player";
    return null;
  }

  function ensureEnemyForCompassKey(key) {
    var enemy = falloutEnemyForCompass(key);
    if (enemy) return enemy;
    if (!g.playing || !hasVisionFloor()) return null;
    var compass = mosaicCompassByKey(key);
    if (!compass) return null;
    return createFalloutEnemyAtCompass(
      compass,
      loadoutForCompass(compass, clonePlayerSpellLoadout())
    );
  }

  function markCompassSlotSaved(key, cell, spells) {
    if (!cell) return;
    var saveKey = stasisContentKey(cell.visionUrl, spells);
    cell._savedKey = saveKey;
    if (key !== "center") {
      var enemy = falloutEnemyForCompass(key);
      if (enemy) enemy._savedKey = saveKey;
    }
  }

  function saveFalloutCompassByKeyAsync(key) {
    var compass = mosaicCompassByKey(key);
    var cell = compass ? mosaicCellForCompass(compass) : null;
    var enemy = ensureEnemyForCompassKey(key);
    var label = compass ? compass.label : MOSAIC_HUD_LABELS[key] || key;
    if (!cell || !cell.visionImg || !cell.visionImg.complete) {
      return Promise.resolve();
    }
    if (isCompassSlotSaved(key)) return Promise.resolve();
    var spells = compassSpellsForSlot(key, cell, enemy);
    var folder = FALLOUT_SAVE_FOLDERS[key] || key;
    var filename = "";
    return visionImgToBlob(cell.visionImg)
      .then(function (blob) {
        return saveBlobWithOpts(blob, filename, {
          fallout_compass: key,
          spells: spells,
        });
      })
      .then(function (result) {
        markCompassSlotSaved(key, cell, spells);
        var where = (result && result.path) || FALLOUT_SAVE_ROOT + "/" + folder;
        finishEnemySaveReward(
          label + " saved → " + where + " (+" + SAVE_IMAGE_ORB_REWARD + " orbs)"
        );
        updateGameSaveButtons();
      });
  }

  function runOneStasisSave(target) {
    return yieldToMainThread(STASIS_SAVE_ENCODE_MS).then(function () {
      if (target === "player") {
        if (!playerStasisReadyForSave()) return Promise.resolve();
        return saveStasisImageAsync(true, true);
      }
      if (isCompassSlotSaved(target)) return Promise.resolve();
      return saveFalloutCompassByKeyAsync(target);
    });
  }

  function drainStasisSaveBacklot() {
    if (!g.playing || !isMuralwalkActive()) return;
    if (!allNineStasisGalleryReady()) return;
    if (g._stasisSaveDrainActive) return;
    spawnMissingFalloutEnemies();
    if (allNineStasisSaved()) {
      onStasisSaveCycleComplete();
      return;
    }
    if (!hasUnsavedStasisPieces()) return;
    var target = getNextStasisSaveTarget();
    if (!target) {
      if (g._stasisSaveRetryTimer) clearTimeout(g._stasisSaveRetryTimer);
      g._stasisSaveRetryTimer = setTimeout(function () {
        g._stasisSaveRetryTimer = 0;
        drainStasisSaveBacklot();
      }, 500);
      return;
    }
    g._stasisSaveDrainActive = true;
    var left = countUnsavedStasisPieces();
    setFloorStatus("Saving stasis backlot — " + left + " of 9 left…", {
      duration: 900,
      sticky: true,
    });
    runOneStasisSave(target)
      .catch(function (err) {
        setFloorStatus((err && err.message) || "Save failed — retrying next…", {
          duration: 1600,
          sticky: false,
        });
      })
      .finally(function () {
        g._stasisSaveDrainActive = false;
        g._falloutSaveCompass = "";
        scheduleFalloutHudUpdate();
        if (allNineStasisSaved()) {
          onStasisSaveCycleComplete();
          return;
        }
        if (hasUnsavedStasisPieces()) {
          setTimeout(drainStasisSaveBacklot, STASIS_SAVE_BACKLOT_GAP_MS);
        }
      });
  }

  function queueNextStasisSave() {
    drainStasisSaveBacklot();
  }

  function processPendingStasisSaves() {
    g._stasisSavePending = false;
    if (!allNineStasisGalleryReady()) return;
    drainStasisSaveBacklot();
  }

  function scheduleStasisAutoSave() {
    if (!g.playing || !isMuralwalkActive()) return;
    if (!allNineStasisGalleryReady()) return;
    if (g._stasisSaveTimer) clearTimeout(g._stasisSaveTimer);
    var defer = stasisGenBlockedBySaveCycle() ? STASIS_SAVE_BACKLOT_GAP_MS : FALLOUT_SAVE_DEFER_MS;
    g._stasisSaveTimer = setTimeout(function () {
      g._stasisSaveTimer = 0;
      drainStasisSaveBacklot();
    }, defer);
  }

  function enemyCellGenerating(enemy) {
    var cell = getEnemyMosaicCell(enemy);
    return !!(cell && cell.status === "generating");
  }

  function enemyActionQueueBusy(enemy) {
    if (!enemy || !enemy.fallout) return false;
    return (
      falloutVisionBusyForCompass(enemy.compass) ||
      enemyCellGenerating(enemy) ||
      (g._falloutSaveCompass && g._falloutSaveCompass === enemy.compass)
    );
  }

  function canEnemyPursueSave(enemy) {
    if (!enemy || !enemy.fallout) return false;
    if (!enemyStasisReadyForSave(enemy) || isEnemyStasisSaved(enemy)) return false;
    if (enemyCellGenerating(enemy)) return false;
    if (g._falloutSaveCompass && g._falloutSaveCompass !== enemy.compass) return false;
    return getFalloutSaveTurnKey() === enemy.compass;
  }

  function enemyShouldCollectScoreOnly(enemy) {
    if (!enemy || !enemy.fallout) return false;
    if (enemyActionQueueBusy(enemy)) return true;
    if (enemyStasisReadyForSave(enemy) && !isEnemyStasisSaved(enemy)) {
      return getFalloutSaveTurnKey() !== enemy.compass;
    }
    return false;
  }

  function enemyMayCollectActionOrb(enemy, orb) {
    if (!orb || orb.type === "score") return true;
    if (stasisSpellHuntBlocked()) {
      if (orb.type !== "score") return false;
    }
    if (orb.type === "save_work") return canEnemyPursueSave(enemy) && orb.saveTarget === enemy.compass;
    if (enemyShouldCollectScoreOnly(enemy)) return false;
    if (enemyActionQueueBusy(enemy)) return false;
    if (orb.type === "spell_shuffle" || orb.type === "spell_select" || orb.type === "buzz_inject" ||
        orb.type === "extra_buzz" || orb.type === "redefine" || orb.type === "reimagine") {
      if (!enemy.falloutGenDone) return true;
      return enemyCanSeekSpellChange(enemy);
    }
    return !enemy.falloutGenDone;
  }

  function nearestScoreOrb(x, y) {
    return nearestOrbMatching(x, y, function (o) {
      return o.type === "score";
    });
  }

  function processPendingFalloutSaves() {
    if (!g._stasisSavePending) return;
    processPendingStasisSaves();
  }

  function queueEnemyFalloutSave(enemy) {
    if (!enemy || isEnemyStasisSaved(enemy) || !enemyStasisReadyForSave(enemy)) return;
    enemy._pendingSave = true;
    g._stasisSavePending = true;
    if (allNineStasisGalleryReady()) scheduleStasisAutoSave();
  }

  function updateFalloutEnemyMove(enemy, dt) {
    var cellReady = enemyStasisReadyForSave(enemy);
    var enemySaved = isEnemyStasisSaved(enemy);
    var playerSaved = isPlayerStasisSaved();
    var target = null;
    var scoreOnly = enemyShouldCollectScoreOnly(enemy);

    if (scoreOnly) {
      target = nearestScoreOrb(enemy.x, enemy.y);
    } else if (canEnemyPursueSave(enemy)) {
      target = nearestOrbMatching(enemy.x, enemy.y, function (o) {
        return o.type === "save_work" && o.saveTarget === enemy.compass;
      });
      if (target) {
        var sdx = target.x - enemy.x;
        var sdy = target.y - enemy.y;
        if (sdx * sdx + sdy * sdy < ORB_R * ORB_R * 0.55 && !canCollectSaveOrb(target)) {
          target = nearestScoreOrb(enemy.x, enemy.y);
        }
      }
    } else if (enemySaved && !playerSaved && cellReady) {
      target = nearestOrbMatching(enemy.x, enemy.y, function (o) {
        return o.type === "save_work" && o.saveTarget === "player";
      });
      var pdx = g.wx - enemy.x;
      var pdy = g.wy - enemy.y;
      var pd = Math.sqrt(pdx * pdx + pdy * pdy) || 1;
      if (pd < 130 && target) pushPlayerTowardOrb(target, 3.2);
      if (!target) {
        moveEntityToward(enemy, g.wx, g.wy, dt, 2.6);
        return;
      }
    } else if (enemySaved && playerSaved && !enemyActionQueueBusy(enemy)) {
      target = nearestOrbMatching(enemy.x, enemy.y, function (o) {
        return (
          o.type === "spell_shuffle" ||
          o.type === "spell_select" ||
          o.type === "buzz_inject" ||
          o.type === "extra_buzz" ||
          o.type === "redefine" ||
          o.type === "reimagine"
        );
      });
    } else if (!enemy.falloutGenDone && !enemyActionQueueBusy(enemy)) {
      target = nearestOrbMatching(enemy.x, enemy.y, function (o) {
        return o.type !== "save_work" && enemyMayCollectActionOrb(enemy, o);
      });
    } else if (!enemyActionQueueBusy(enemy)) {
      target = nearestOrbMatching(enemy.x, enemy.y, function (o) {
        return o.type !== "save_work" && enemyMayCollectActionOrb(enemy, o);
      });
    }
    if (!target && scoreOnly) {
      target = nearestScoreOrb(enemy.x, enemy.y);
    }

    if (target) {
      moveEntityToward(enemy, target.x, target.y, dt);
      return;
    }
    enemy.phase += 0.018 * enemy.speed * (dt / 16.667);
    enemy.x = enemy.patrolX + Math.cos(enemy.phase) * enemy.patrolR;
    enemy.y = enemy.patrolY + Math.sin(enemy.phase) * enemy.patrolR;
  }

  function updateEnemies() {
    if (!g.enemies.length || g.menuOpen || !g.playing) return;
    var dt = g._lastDt || 16.667;
    for (var i = 0; i < g.enemies.length; i++) {
      var e = g.enemies[i];
      if (e.fallout) {
        updateFalloutEnemyMove(e, dt);
      } else {
        var pushed = C.patrolStep(e, g.wx, g.wy);
        g.wx = pushed.x;
        g.wy = pushed.y;
      }
    }
    enemyCollectOrbs();
    updateSpellProjectiles(dt);
    depenetratePlayer();
  }

  function pickSlotForProjectileHit(spellNum) {
    var candidates = [];
    for (var i = 0; i < 3; i++) {
      if (g.slots[i] !== spellNum) candidates.push(i);
    }
    if (!candidates.length) return Math.floor(Math.random() * 3);
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  function applyProjectileSpellHit(spellNum, compassLabel) {
    spellNum = normalizeSpellNum(spellNum);
    if (!spellNum) return;
    var slotIdx = pickSlotForProjectileHit(spellNum);
    if (g.slots[slotIdx] === spellNum) return;
    g.slots[slotIdx] = spellNum;
    syncEquippedSpells();
    g.spellShiftCount += 1;
    updateSlotHud();
    refreshReadouts();
    preloadPaintingThumbs(equippedNums());
    refreshStasisInterfaceSkin();
    setFloorStatus(
      (compassLabel || "Enemy") + " spell #" + spellNum + " → slot " + (slotIdx + 1),
      { duration: 1400, sticky: false }
    );
  }

  function spawnSpellProjectile(fromX, fromY, spellNum, slotIdx, enemy) {
    spellNum = normalizeSpellNum(spellNum);
    if (!spellNum) return;
    preloadOrbSpellImage(spellNum);
    g.spellProjectiles.push({
      x: fromX,
      y: fromY,
      spellNum: spellNum,
      slotIdx: slotIdx,
      compass: enemy && enemy.compass,
      compassLabel: enemy && enemy.compassLabel,
      life: 0,
    });
  }

  function updateSpellProjectiles(dt) {
    if (!stasisSpellHuntBlocked()) {
      if (g.spellProjectiles.length) g.spellProjectiles = [];
      return;
    }
    var now = Date.now();
    for (var ei = 0; ei < g.enemies.length; ei++) {
      var enemy = g.enemies[ei];
      if (!enemy || !enemy.fallout || !enemyStasisReadyForSave(enemy)) continue;
      if (!enemy._lastSpellShotMs) enemy._lastSpellShotMs = 0;
      var fireGap = SPELL_PROJECTILE_FIRE_GAP_MS + ei * 180;
      if (now - enemy._lastSpellShotMs < fireGap) continue;
      var spells = enemy.spellSlots && enemy.spellSlots.length ? enemy.spellSlots : [];
      if (!spells.length) continue;
      var slotIdx = Math.floor(Math.random() * Math.min(3, spells.length));
      var spellNum = spells[slotIdx];
      if (!spellNum) continue;
      enemy._lastSpellShotMs = now;
      spawnSpellProjectile(enemy.x, enemy.y, spellNum, slotIdx, enemy);
    }
    var step = SPELL_PROJECTILE_SPEED * (dt / 16.667);
    var hitR = PLAYER_BODY_R + SPELL_PROJECTILE_R + 5;
    for (var pi = g.spellProjectiles.length - 1; pi >= 0; pi--) {
      var proj = g.spellProjectiles[pi];
      var pdx = g.wx - proj.x;
      var pdy = g.wy - proj.y;
      var pd = Math.sqrt(pdx * pdx + pdy * pdy) || 1;
      if (pd <= hitR) {
        applyProjectileSpellHit(proj.spellNum, proj.compassLabel);
        g.spellProjectiles.splice(pi, 1);
        continue;
      }
      proj.x += (pdx / pd) * step;
      proj.y += (pdy / pd) * step;
      proj.life += dt;
      if (proj.life > 14000) g.spellProjectiles.splice(pi, 1);
    }
  }

  function drawSpellProjectiles(ctx) {
    if (!g.spellProjectiles.length) return;
    var t = Date.now() * 0.001;
    for (var i = 0; i < g.spellProjectiles.length; i++) {
      var proj = g.spellProjectiles[i];
      var scr = worldToScreen(proj.x, proj.y);
      var sx = scr.x;
      var sy = scr.y;
      if (sx < -60 || sy < -60 || sx > g.w + 60 || sy > g.h + 60) continue;
      var pulse = 0.86 + Math.sin(t * 8 + i) * 0.12;
      var r = SPELL_PROJECTILE_R;
      var img = preloadOrbSpellImage(proj.spellNum);
      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.shadowColor = "#e8b84a";
      ctx.shadowBlur = 16;
      ctx.beginPath();
      ctx.arc(sx, sy, r + 3, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(12,10,8,0.9)";
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.save();
      ctx.beginPath();
      ctx.arc(sx, sy, r - 1, 0, Math.PI * 2);
      ctx.clip();
      if (img && img.complete && img.naturalWidth) {
        var size = (r - 1) * 2;
        ctx.drawImage(img, sx - r + 1, sy - r + 1, size, size);
      } else {
        ctx.fillStyle = "rgba(90,70,120,0.75)";
        ctx.fillRect(sx - r, sy - r, r * 2, r * 2);
      }
      ctx.restore();
      ctx.strokeStyle = "#f0d070";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  function getMovementBlockers() {
    var blocks = [];
    var i;
    for (i = 0; i < g.obstacles.length; i++) {
      var o = g.obstacles[i];
      var pad = o.pillar || o.maze ? 8 : 4;
      blocks.push({
        x: o.x,
        y: o.y,
        r: (o.r || 40) + PLAYER_BODY_R + pad,
      });
    }
    for (i = 0; i < g.stasisProps.length; i++) {
      var p = g.stasisProps[i];
      if (!p || p.status === "empty" || p.status === "error") continue;
      blocks.push({ x: p.x, y: p.y, r: 64 + PLAYER_BODY_R });
    }
    return blocks;
  }

  function playerOverlapsBlockers(x, y, blockers) {
    for (var i = 0; i < blockers.length; i++) {
      var b = blockers[i];
      var dx = x - b.x;
      var dy = y - b.y;
      if (dx * dx + dy * dy < b.r * b.r - 0.5) return true;
    }
    return false;
  }

  function resolveCircleCollisions(px, py, blockers, passes) {
    passes = passes == null ? PLAYER_COLLISION_PASSES : passes;
    var x = px;
    var y = py;
    for (var pass = 0; pass < passes; pass++) {
      var moved = false;
      for (var i = 0; i < blockers.length; i++) {
        var b = blockers[i];
        var pushed = C.pushCircle(x, y, b.x, b.y, b.r);
        if (Math.abs(pushed.x - x) > 0.02 || Math.abs(pushed.y - y) > 0.02) moved = true;
        x = pushed.x;
        y = pushed.y;
      }
      if (!moved) break;
    }
    return { x: x, y: y };
  }

  function tryUnstickPlayer(ix, iy, blockers) {
    var best = null;
    var bestScore = -Infinity;
    var dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [0.72, 0.72],
      [-0.72, 0.72],
      [0.72, -0.72],
      [-0.72, -0.72],
    ];
    for (var d = 0; d < dirs.length; d++) {
      var ox = dirs[d][0];
      var oy = dirs[d][1];
      var probe = resolveCircleCollisions(g.wx + ox * 16, g.wy + oy * 16, blockers, 12);
      if (playerOverlapsBlockers(probe.x, probe.y, blockers)) continue;
      var slide = ox * ix + oy * iy;
      var score = slide * 2 + C.dist(g.wx, g.wy, probe.x, probe.y);
      if (score > bestScore) {
        bestScore = score;
        best = probe;
      }
    }
    if (best) {
      g.wx = best.x;
      g.wy = best.y;
    }
  }

  function depenetratePlayer() {
    var blockers = getMovementBlockers();
    if (!blockers.length) return;
    var fixed = resolveCircleCollisions(g.wx, g.wy, blockers, 14);
    g.wx = fixed.x;
    g.wy = fixed.y;
  }

  function movePlayerWithSlide(dx, dy, step) {
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    var nx = dx / len;
    var ny = dy / len;
    var startX = g.wx;
    var startY = g.wy;
    var blockers = getMovementBlockers();

    var afterX = resolveCircleCollisions(startX + nx * step, startY, blockers);
    var afterXY = resolveCircleCollisions(afterX.x, startY + ny * step, blockers);
    g.wx = afterXY.x;
    g.wy = afterXY.y;

    var fixed = resolveCircleCollisions(g.wx, g.wy, blockers, 12);
    g.wx = fixed.x;
    g.wy = fixed.y;

    if (C.dist(startX, startY, g.wx, g.wy) < step * 0.22) {
      tryUnstickPlayer(nx, ny, blockers);
    }
  }

  function resolveObstacleCollision() {
    depenetratePlayer();
  }

  function propsActive() {
    return g.stasisProps.some(function (p) {
      return p.status === "ready" || p.status === "generating" || p.status === "pending";
    });
  }

  function mwUniqueStrings(arr) {
    var out = [];
    var seen = {};
    for (var i = 0; i < (arr || []).length; i++) {
      var s = String(arr[i] || "").trim();
      if (!s || seen[s]) continue;
      seen[s] = true;
      out.push(s);
    }
    return out;
  }

  function allMwBuzzWords(meta) {
    var list = (meta.tags || []).slice();
    var styles = meta.styles || [];
    for (var i = 0; i < styles.length; i++) list.push(styles[i]);
    if (meta.moods) {
      list = list.concat(String(meta.moods).split(/[\s·+,]+/));
    }
    return mwUniqueStrings(list).slice(0, 18);
  }

  function getMwActiveBuzz() {
    var extra = String(g.extraBuzzPrompt || "")
      .split(/[,;\s]+/)
      .map(function (s) {
        return s.trim();
      })
      .filter(function (s) {
        return s.length > 2;
      });
    return mwUniqueStrings((g.activeBuzzWords || []).concat(extra)).slice(0, 18);
  }

  function collectBuzzForEquipped() {
    var active = getMwActiveBuzz();
    if (active.length) return active;
    var nums = equippedNums();
    var meta = collectCombinedMeta(nums);
    if (window.StasisFloorGen && window.StasisFloorGen.collectBuzz) {
      return window.StasisFloorGen.collectBuzz(meta);
    }
    return meta.tags || [];
  }

  function renderMwBuzzToggles(resetActive) {
    var el = $("mw-buzz-toggles");
    if (!el) return;
    var nums = equippedNums();
    if (nums.length < 2) {
      el.innerHTML = '<span class="spell-chip">—</span>';
      return;
    }
    var meta = collectCombinedMeta(nums);
    var words = allMwBuzzWords(meta);
    if (resetActive || !g.activeBuzzWords.length) g.activeBuzzWords = words.slice();
    el.innerHTML = "";
    if (!words.length) {
      el.innerHTML = '<span class="spell-chip">—</span>';
      return;
    }
    for (var i = 0; i < words.length; i++) {
      (function (word) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "spell-chip spell-chip-toggle";
        if (g.activeBuzzWords.indexOf(word) >= 0) btn.className += " active";
        btn.textContent = word;
        btn.addEventListener("click", function () {
          var idx = g.activeBuzzWords.indexOf(word);
          if (idx >= 0) g.activeBuzzWords.splice(idx, 1);
          else g.activeBuzzWords.push(word);
          btn.classList.toggle("active");
          onMwBuzzChanged();
        });
        el.appendChild(btn);
      })(words[i]);
    }
  }

  function scheduleBuzzVisionRegen() {
    clearTimeout(g._buzzRegenTimer);
    g._buzzRegenTimer = setTimeout(function () {
      g._buzzRegenTimer = 0;
      if (equippedNums().length < 2 || !g.stasisText.trim()) return;
      g.buzzWords = getMwActiveBuzz();
      g._floorRequestKey = "";
      if (g.menuOpen) {
        markStasisPending();
        return;
      }
      regenerateVisionFromBuzz();
    }, MW_BUZZ_REGEN_MS);
  }

  function onMwBuzzChanged() {
    g.buzzWords = getMwActiveBuzz();
    try {
      localStorage.setItem(
        "muralwalk.buzz",
        JSON.stringify({
          active: g.activeBuzzWords,
          extra: g.extraBuzzPrompt,
        })
      );
    } catch (err) {}
    scheduleBuzzVisionRegen();
  }

  function regenerateVisionFromBuzz() {
    if (equippedNums().length < 2 || !g.stasisText.trim()) return;
    enqueueWork(
      "buzz_vision",
      "player",
      function () {
        g.buzzWords = getMwActiveBuzz();
        g.spellShiftCount += 1;
        return regenerateStasisVision({
          quietStatus: true,
          unlockFloor: g.floorUnlocked,
          keepPreviousOnFail: hasVisionFloor(),
        }).then(function () {
          recordSpellGenerated(equippedNums());
          updateHud();
        });
      },
      3
    );
  }

  function bindMwBuzzPanel() {
    var input = $("mw-extra-buzz");
    if (input && !input.dataset.bound) {
      input.dataset.bound = "1";
      input.addEventListener("input", function () {
        g.extraBuzzPrompt = input.value;
        onMwBuzzChanged();
      });
    }
    try {
      var saved = JSON.parse(localStorage.getItem("muralwalk.buzz"));
      if (saved && typeof saved === "object") {
        if (saved.active) g.activeBuzzWords = saved.active.slice();
        if (saved.extra) {
          g.extraBuzzPrompt = saved.extra;
          if (input) input.value = saved.extra;
        }
      }
    } catch (err) {}
  }

  function defaultSpellStat() {
    return { used: 0, generated: 0, saved: 0, earned_usd: 0 };
  }

  function loadSpellStats() {
    try {
      var raw = JSON.parse(localStorage.getItem(SPELL_STATS_KEY));
      if (raw && typeof raw === "object") g.spellStats = raw.stats || raw;
      if (raw && raw.events) g.tickerEvents = raw.events.slice(0, 40);
    } catch (err) {}
    if (!isLocalGalleryServer()) return Promise.resolve();
    return fetch("/api/spell-stats")
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (data) {
        if (!data || !data.ok) return;
        if (data.stats) g.spellStats = data.stats;
        if (data.events) g.tickerEvents = data.events.slice(0, 40);
        saveSpellStatsLocal();
      })
      .catch(function () {})
      .finally(function () {
        renderSpellTicker();
      });
  }

  function saveSpellStatsLocal() {
    try {
      localStorage.setItem(
        SPELL_STATS_KEY,
        JSON.stringify({ stats: g.spellStats, events: g.tickerEvents })
      );
    } catch (err) {}
  }

  function syncSpellStatsServer() {
    if (!isLocalGalleryServer()) return Promise.resolve();
    return fetch("/api/spell-stats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stats: g.spellStats, events: g.tickerEvents }),
    }).catch(function () {});
  }

  function bumpSpellStat(num, kind) {
    var key = String(num);
    if (!g.spellStats[key]) g.spellStats[key] = defaultSpellStat();
    if (kind === "used") g.spellStats[key].used += 1;
    else if (kind === "generated") g.spellStats[key].generated += 1;
    else if (kind === "saved") g.spellStats[key].saved += 1;
  }

  function pushTickerEvent(num, kind) {
    g.tickerEvents.unshift({
      num: num,
      kind: kind,
      ts: Date.now(),
    });
    if (g.tickerEvents.length > 40) g.tickerEvents.length = 40;
    saveSpellStatsLocal();
    syncSpellStatsServer();
    renderSpellTicker();
  }

  function recordSpellUsed(nums) {
    (nums || []).forEach(function (n) {
      bumpSpellStat(n, "used");
      pushTickerEvent(n, "used");

    });
  }

  function recordSpellGenerated(nums) {
    (nums || []).forEach(function (n) {
      bumpSpellStat(n, "generated");
      pushTickerEvent(n, "generated");
    });
  }

  function recordSpellSaved(nums) {
    (nums || []).forEach(function (n) {
      bumpSpellStat(n, "saved");
      pushTickerEvent(n, "saved");
    });
  }

  function renderSpellTicker() {
    var track = $("mw-spell-ticker-track");
    if (!track) return;
    var nums = equippedNums();
    var parts = [];
    nums.forEach(function (n) {
      var s = g.spellStats[String(n)] || defaultSpellStat();
      parts.push(
        "#" +
          n +
          " used " +
          s.used +
          " · gen " +
          s.generated +
          " · save " +
          s.saved
      );
    });
    if (!parts.length) {
      var recent = g.tickerEvents.slice(0, 8).map(function (ev) {
        if (ev.kind === "buzz" && ev.word) return 'buzz "' + ev.word + '"';
        return "#" + ev.num + " " + ev.kind;
      });
      parts = recent.length ? recent : ["Collect orbs · shuffle spells · save stasis for rewards"];
    }
    var text = parts.join("   ◆   ");
    track.textContent = text + "   ◆   " + text;
  }

  function snapshotFusionHistory(action) {
    var url = g.fusion.visionUrl || g.fusion._url;
    if (!url || !hasVisionFloor()) return;
    if (g.fusionHistory.length && g.fusionHistory[0].url === url) return;
    g.fusionHistory.unshift({
      url: url,
      stasisText: g.stasisText,
      stasisTitle: g.stasisTitle,
      spells: equippedNums().slice(),
      source: g.fusion.source,
      buzz: getMwActiveBuzz().slice(),
      extraBuzz: g.extraBuzzPrompt,
      ts: Date.now(),
      action: action || "replace",
    });
    if (g.fusionHistory.length > FUSION_HISTORY_MAX) {
      g.fusionHistory.length = FUSION_HISTORY_MAX;
    }
    renderVisionHistory();
  }

  function renderVisionHistory() {
    var wrap = $("mw-vision-history");
    var list = $("mw-vision-history-list");
    if (!wrap || !list) return;
    if (!g.fusionHistory.length) {
      wrap.hidden = true;
      list.innerHTML = "";
      return;
    }
    wrap.hidden = false;
    list.innerHTML = "";
    g.fusionHistory.forEach(function (entry, idx) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "mw-vision-history-item";
      btn.title =
        (entry.action || "vision") +
        " · #" +
        (entry.spells || []).join("·") +
        " · tap to restore";
      var img = document.createElement("img");
      img.alt = "Prior stasis " + (idx + 1);
      img.loading = "lazy";
      img.src = entry.url;
      btn.appendChild(img);
      var cap = document.createElement("span");
      cap.className = "mw-vision-history-cap";
      cap.textContent = "#" + (entry.spells || []).join("·");
      btn.appendChild(cap);
      btn.addEventListener("click", function () {
        restoreFusionHistory(idx);
      });
      list.appendChild(btn);
    });
  }

  function restoreFusionHistory(idx) {
    var entry = g.fusionHistory[idx];
    if (!entry || !entry.url) return;
    if (entry.stasisText) g.stasisText = entry.stasisText;
    if (entry.stasisTitle) g.stasisTitle = entry.stasisTitle;
    if (entry.extraBuzz) {
      g.extraBuzzPrompt = entry.extraBuzz;
      var input = $("mw-extra-buzz");
      if (input) input.value = entry.extraBuzz;
    }
    if (entry.buzz) g.activeBuzzWords = entry.buzz.slice();
    renderMwBuzzToggles(false);
    loadFusionImage(entry.url, g.floorUnlocked, entry.source || "local", {
      skipHistory: true,
      action: "restore",
    }).then(function () {
      setFloorStatus("Restored prior stasis vision.");
      publishToSpellforge();
      updateHud();
    });
  }

  function layoutPropsPlaceholders() {
    var nums = equippedNums();
    if (nums.length < 2 || !g.stasisText.trim()) {
      g.stasisProps = [];
      return;
    }
    var subjects = parseStasisSubjects(g.stasisText, nums);
    layoutStasisProps(subjects, nums);
    for (var i = 0; i < g.stasisProps.length; i++) {
      if (g.stasisProps[i].status === "pending") g.stasisProps[i].status = "generating";
    }
  }

  function ensureFastFloor() {
    if (hasVisionFloor()) return Promise.resolve();
    var nums = equippedNums();
    if (nums.length < 2) return Promise.resolve();
    return loadFusionImage(paintingUrlFor(nums[0]), false, "local").catch(function () {});
  }

  function ensureLocalBootstrap(unlockFloor) {
    if (g._bootstrapPromise) return g._bootstrapPromise;
    g._bootstrapPromise = ensureFastFloor()
      .then(function () {
        return new Promise(function (resolve) {
          setTimeout(function () {
            instantLocalBootstrap(unlockFloor).then(resolve).catch(resolve);
          }, 200);
        });
      })
      .finally(function () {
        g._bootstrapPromise = null;
      });
    return g._bootstrapPromise;
  }

  function instantLocalBootstrap(unlockFloor) {
    var nums = equippedNums();
    if (nums.length < 2) return Promise.resolve();
    if (!g.stasisText.trim()) regenerateStasisText();
    if (hasVisionFloor() && g._localBootstrapDone) return Promise.resolve();
    setFloorStatus("Fusing stasis vision…");

    var buzz = collectBuzzForEquipped();
    var floorWork = Promise.resolve();
    if (typeof window.composeStasisVisionLocal === "function") {
      floorWork = window
        .composeStasisVisionLocal({
          spells: nums,
          stasis: g.stasisText,
          buzz_words: buzz,
        })
        .then(function (url) {
          g.buzzWords = buzz;
          return loadFusionImage(url, unlockFloor === true, "local");
        })
        .catch(function () {
          if (!hasVisionFloor() && nums[0]) {
            return loadFusionImage(paintingUrlFor(nums[0]), unlockFloor === true, "local");
          }
        });
    } else if (!hasVisionFloor() && nums[0]) {
      floorWork = loadFusionImage(paintingUrlFor(nums[0]), unlockFloor === true, "local");
    }

    return floorWork
      .then(function () {
        g._localBootstrapDone = true;
        layoutWorldEntities();
        return evolveStasisProps();
      })
      .then(function () {
        refreshPlayerPersona();
        updateHudLabel();
        publishToSpellforge();
      });
  }

  function upgradeWorldWithAi(unlockFloor) {
    if (window.SPELLFORGE_LOCAL_GENERATE === true) {
      return ensureLocalBootstrap(unlockFloor);
    }
    if (!window.StasisFloorGen || !window.StasisFloorGen.buildFloor) {
      return ensureLocalBootstrap(unlockFloor);
    }

    unlockFloor = unlockFloor === true;
    g.floorGenerating = true;
    setFloorStatus("Upgrading with AI stasis vision…");

    var nums = equippedNums();
    var work = window.StasisFloorGen.buildFloor({
      spells: nums,
      getAnalysis: getAnalysis,
      localStasis: g.stasisText,
      localTitle: g.stasisTitle,
      buzz_words: getMwActiveBuzz(),
      onStatus: setFloorStatus,
      skipBlend: g.stasisFromApi,
    });

    return work
      .then(function (result) {
        if (!result || !result.url) return;
        if (result.stasis) g.stasisText = result.stasis;
        if (result.title) g.stasisTitle = result.title;
        if (result.buzz) g.buzzWords = result.buzz;
        if (result.stasis) g.stasisFromApi = true;
        return loadFusionImage(result.url, unlockFloor, result.source || "ai");
      })
      .then(function () {
        if (unlockFloor) g.floorUnlocked = true;
        g._aiStasisLanded = true;
        refreshPlayerPersona();
        layoutWorldEntities();
        return evolveStasisProps();
      })
      .catch(function (err) {
        if (err && err.message) setFloorStatus(err.message);
        return ensureLocalBootstrap(unlockFloor);
      })
      .finally(function () {
        g.floorGenerating = false;
        g._worldGenPromise = null;
        setFloorStatus("");
        updateHudLabel();
        updateStasisActionButtons();
      });
  }

  function visionRegenInflight() {
    return !!(
      g._visionRegenPromise ||
      g._reimaginePromise ||
      g._redefinePromise ||
      g._worldGenPromise ||
      g.floorGenerating
    );
  }

  function regenerateStasisVision(opts) {
    opts = opts || {};
    var nums = equippedNums();
    if (nums.length < 2 || !g.stasisText.trim()) return Promise.resolve();
    if (g.playing && stasisSpellHuntBlocked() && !opts.force) {
      setFloorStatus("Save all 9 stasis visions before painting new stasis.");
      return Promise.resolve();
    }
    if (visionRegenInflight() && !opts.force) return Promise.resolve();
    if (!window.StasisFloorGen || !window.StasisFloorGen.generateVision) {
      return upgradeWorldWithAi(opts.unlockFloor === true);
    }

    g._floorRequestKey = "";
    g._previewKey = "";
    g._visionRegenPromise = true;
    g.floorGenerating = true;
    g._visionProgressMsg = "";
    if (opts.quietStatus) {
      setFloorStatus("");
    } else {
      setFloorStatus(opts.statusMsg || "Painting stasis vision…", { sticky: true });
    }
    updateStasisActionButtons();

    var buzz = collectBuzzForEquipped();
    var unlockFloor = opts.unlockFloor === true || g.floorUnlocked;
    var statusFn = visionStatusHandler(opts);
    var visionOk = false;

    return window.StasisFloorGen.checkHealth()
      .then(function (health) {
        return window.StasisFloorGen.generateVision(
          nums,
          g.stasisText,
          buzz,
          health,
          statusFn
        );
      })
      .then(function (url) {
        if (!url) throw new Error("No vision returned.");
        g.stasisFromApi = true;
        return loadFusionImage(url, unlockFloor, "ai", {
          action: opts.outcomeMsg ? "orb" : "replace",
        });
      })
      .then(function () {
        visionOk = true;
        g._aiStasisLanded = true;
        g._localBootstrapDone = true;
        layoutWorldEntities();
        refreshPlayerPersona();
        publishToSpellforge();
        refreshReadouts();
        updateStasisPreview();
        evolveStasisProps();
      })
      .catch(function (err) {
        if (hasVisionFloor() && opts.keepPreviousOnFail !== false) {
          setFloorStatus("Stasis vision failed — keeping previous floor.", {
            duration: 2200,
          });
          if (opts.rejectOnFail) {
            return Promise.reject(err || new Error("Stasis vision failed."));
          }
          return;
        }
        return upgradeWorldWithAi(unlockFloor).catch(function () {
          return ensureLocalBootstrap(unlockFloor);
        });
      })
      .finally(function () {
        g._visionRegenPromise = null;
        g.floorGenerating = false;
        g._visionProgressMsg = "";
        if (visionOk && opts.outcomeMsg && !opts.quietStatus) {
          setFloorStatus(opts.outcomeMsg, { duration: FLOOR_OUTCOME_DISMISS_MS });
        } else if (g.floorStatus.indexOf("keeping previous") < 0 && !opts.quietStatus) {
          setFloorStatus("");
        } else if (!visionOk && opts.quietStatus) {
          setFloorStatus("");
        }
        updateHudLabel();
        updateStasisActionButtons();
        ensureActionOrbs();
        if (visionOk) ensureFalloutMapLoaded();
      });
  }

  function beginWorldLoad(unlockFloor) {
    var nums = equippedNums();
    if (nums.length < 2) {
      return Promise.resolve();
    }
    if (!g.stasisText.trim()) regenerateStasisText();

    var key = SM.floorRequestKey(nums, g.stasisVariant, g.stasisText, unlockFloor);
    if (g._floorRequestKey === key && g._worldGenPromise) {
      return g._worldGenPromise;
    }
    g._floorRequestKey = key;

    armLoadFailsafe(15000);
    setLoadStatus("Mixing stasis from your spells…", 0.12);
    g.floorGenerating = true;

    var spellforgePending = syncSpellforgeVision();

    g._worldGenPromise = Promise.resolve()
      .then(function () {
        if (spellforgePending) {
          setLoadStatus("Loading Spellforge stasis vision…", 0.35);
          return waitForVisionFloor(6000);
        }
      })
      .then(function () {
        if (hasVisionFloor()) {
          g._aiStasisLanded = true;
          g._localBootstrapDone = true;
          setLoadStatus("Stasis vision ready…", 0.82);
          return evolveStasisProps();
        }
        setLoadStatus("Generating stasis vision…", 0.45);
        return regenerateStasisVision({
          statusMsg: "AI painting from stasis…",
          unlockFloor: unlockFloor === true,
          keepPreviousOnFail: false,
          force: true,
        });
      })
      .then(function () {
        refreshPlayerPersona();
        if (!hasVisionFloor()) return ensureLocalBootstrap(unlockFloor);
        if (!g._localBootstrapDone) g._localBootstrapDone = true;
      })
      .catch(function () {
        return ensureLocalBootstrap(unlockFloor);
      })
      .finally(function () {
        g._worldGenPromise = null;
        g.floorGenerating = false;
        finishLoadStatus();
        updateHudLabel();
        updateScoreHud();
        updateStasisActionButtons();
        if (hasVisionFloor()) {
          ensureFalloutMapLoaded();
        }
      });

    return g._worldGenPromise;
  }

  function requestAiStasisFloor(unlockFloor) {
    return beginWorldLoad(unlockFloor === true);
  }

  function localMixStasis(nums, variant) {
    variant = variant || 0;
    var frags = [];
    var moods = [];
    var tags = [];
    for (var i = 0; i < nums.length; i++) {
      var rot = (i + (variant % nums.length)) % nums.length;
      var a = getAnalysis(nums[rot]);
      if (!a) continue;
      if (a.description) frags.push(a.description.split(/[.!?]/)[0].trim());
      else if (a.title) frags.push(a.title);
      if (a.mood) moods.push(a.mood);
      if (a.tags) tags = tags.concat(a.tags.slice(0, 3));
    }
    if (frags.length < 2) return frags[0] || "Equip more spells.";
    var leads = [
      "One fused stasis:",
      "Singular braided vision:",
      "The merged spell reads:",
      "Unified apparition:",
    ];
    var joins = [" While ", " As ", " — yet ", "; together, "];
    var tagSample = tags.slice(0, 5).join(", ");
    return (
      leads[variant % leads.length] +
      " " +
      frags.join(joins[variant % joins.length]) +
      ". Shared " +
      (tagSample || "form and hue") +
      " holds in one mural" +
      (moods.length ? " (" + moods.join(" + ") + ")." : ".")
    );
  }

  function localMixTitle(nums) {
    var titles = [];
    nums.forEach(function (n) {
      var a = getAnalysis(n);
      if (a && a.title) titles.push(a.title);
    });
    return titles.length ? titles.join(" · ") : "Fused #" + nums.join("·");
  }

  function regenerateStasisText() {
    var nums = equippedNums();
    if (nums.length < 2) {
      g.stasisText = "";
      g.stasisTitle = "";
      g.stasisProps = [];
      return;
    }
    g.stasisText = localMixStasis(nums, g.stasisVariant);
    g.stasisTitle = localMixTitle(nums);
    g._videofyAnalysis = null;
    layoutPropsPlaceholders();
    layoutWorldEntities();
    refreshReadouts();
    refreshStasisInterfaceSkin();
  }

  function hasVisionFloor() {
    var img = g.fusion.visionImg;
    return !!(img && img.complete && img.naturalWidth > 0);
  }

  function shouldDrawStasisPlane() {
    if (hasVisionFloor()) return true;
    return !!(g.stasisText.trim() && equippedNums().length >= 2);
  }

  function mazeCellIsWall(gx, gy, seed) {
    if (Math.abs(gx) < 2 && Math.abs(gy) < 2) return false;
    var ax = ((gx % 6) + 6) % 6;
    var ay = ((gy % 6) + 6) % 6;
    var h = C.coordHash(gx * 17 + seed, gy * 31 - seed);
    var corridor = ax === 1 || ax === 3 || ax === 5 || ay === 1 || ay === 3 || ay === 5;
    if (corridor) return false;
    if ((ax === 0 || ax === 2 || ax === 4) && (ay === 0 || ay === 2 || ay === 4)) {
      return h % 5 > 0;
    }
    return h % 3 === 0;
  }

  function layoutMazeObstacles(nums, centerGx, centerGy, outcome) {
    outcome = outcome || null;
    var visionUrl = outcome ? outcome.visionUrl : g.fusion.visionUrl || g.fusion._url;
    var outcomeShift = outcome ? outcome.shift : g.spellShiftCount;
    var radius = 9;
    var seen = {};
    for (var dy = -radius; dy <= radius; dy++) {
      for (var dx = -radius; dx <= radius; dx++) {
        var gx = centerGx + dx;
        var gy = centerGy + dy;
        if (!mazeCellIsWall(gx, gy, g.fx.seed)) continue;
        var key = gx + "," + gy;
        if (seen[key]) continue;
        seen[key] = true;
        var wx = gx * MAZE_CELL + MAZE_CELL * 0.5;
        var wy = gy * MAZE_CELL + MAZE_CELL * 0.5;
        var spellIdx = Math.abs(gx + gy) % nums.length;
        var meta = entityMetaForSpell(nums[spellIdx]);
        g.obstacles.push({
          subject: "Stasis wall",
          spellNum: nums[spellIdx],
          slot: spellIdx,
          visionSlot: spellIdx,
          visionUrl: visionUrl,
          outcomeShift: outcomeShift,
          alpha: 1,
          kind: "obstacle",
          geometryKind: "wall",
          maze: true,
          mazeGx: gx,
          mazeGy: gy,
          tags: meta.tags,
          styles: meta.styles,
          mood: meta.mood,
          r: MAZE_CELL * 0.44,
          x: wx,
          y: wy,
          phase: 0,
          speed: 0,
        });
      }
    }
    var pillarSpots = [
      { gx: centerGx + 3, gy: centerGy + 1 },
      { gx: centerGx - 2, gy: centerGy + 4 },
      { gx: centerGx + 5, gy: centerGy - 3 },
    ];
    for (var pi = 0; pi < pillarSpots.length; pi++) {
      var spot = pillarSpots[pi];
      if (mazeCellIsWall(spot.gx, spot.gy, g.fx.seed)) continue;
      var pk = spot.gx + "," + spot.gy;
      if (seen[pk]) continue;
      seen[pk] = true;
      var px = spot.gx * MAZE_CELL + MAZE_CELL * 0.5;
      var py = spot.gy * MAZE_CELL + MAZE_CELL * 0.5;
      var pmeta = entityMetaForSpell(nums[pi % nums.length]);
      g.obstacles.push({
        subject: "Stasis pillar",
        spellNum: nums[pi % nums.length],
        slot: pi % nums.length,
        visionSlot: pi % nums.length,
        visionUrl: visionUrl,
        outcomeShift: outcomeShift,
        alpha: 1,
        kind: "obstacle",
        geometryKind: "spire",
        pillar: true,
        tags: pmeta.tags,
        styles: pmeta.styles,
        mood: pmeta.mood,
        r: 46,
        x: px,
        y: py,
        phase: 0,
        speed: 0,
      });
    }
  }

  function maybeRefreshMaze() {
    if (!g.playing || g.menuOpen || equippedNums().length < 2) return;
    var gx = Math.floor(g.wx / MAZE_CELL);
    var gy = Math.floor(g.wy / MAZE_CELL);
    if (g._mazeGx === gx && g._mazeGy === gy && g.obstacles.length) return;
    g._mazeGx = gx;
    g._mazeGy = gy;
    layoutWorldEntities();
  }

  function layoutWorldEntities() {
    var nums = equippedNums();
    g.obstacles = [];
    var keptFallout = [];
    for (var fk = 0; fk < g.enemies.length; fk++) {
      if (g.enemies[fk].fallout) keptFallout.push(g.enemies[fk]);
    }
    g.enemies = keptFallout.slice();
    if (nums.length < 2) return;

    var outcomes = getEntityOutcomesForLayout();
    if (!outcomes.length) return;
    for (var oi = 0; oi < outcomes.length; oi++) {
      ensureEntityOutcomeImage(outcomes[oi].visionUrl);
    }

    var current = outcomes[0];
    nums = current.spells.length ? current.spells : nums;
    var placed = 0;
    var centerGx = g._mazeGx != null ? g._mazeGx : Math.floor(g.wx / MAZE_CELL);
    var centerGy = g._mazeGy != null ? g._mazeGy : Math.floor(g.wy / MAZE_CELL);
    g._mazeGx = centerGx;
    g._mazeGy = centerGy;

    function enrichEntity(ent) {
      var meta = entityMetaForSpell(ent.spellNum);
      ent.tags = meta.tags;
      ent.styles = meta.styles;
      ent.mood = meta.mood;
      ent.geometryKind = resolveGeometryKind(ent);
      return ent;
    }

    function placeEntity(ent, place) {
      enrichEntity(ent);
      ent.x = place.x != null ? place.x : Math.cos(place.angle) * place.dist;
      ent.y = place.y != null ? place.y : Math.sin(place.angle) * place.dist;
      ent.phase = place.phase;
      ent.speed = place.speed;
      if (ent.kind === "enemy") {
        ent.patrolX = ent.x;
        ent.patrolY = ent.y;
        ent.patrolR = place.patrolR;
        g.enemies.push(ent);
      } else {
        g.obstacles.push(ent);
      }
    }

    layoutMazeObstacles(nums, centerGx, centerGy, current);

    outcomes.forEach(function (outcome, oi) {
      var age = outcome.age != null ? outcome.age : oi;
      var alpha = Math.max(0.24, 1 - age * 0.021);
      var subjects = outcome.subjects || [];
      var oNums = outcome.spells || nums;
      var maxSubjects = age === 0 ? subjects.length : Math.max(1, 3 - Math.floor(age / 12));
      var drift = age * 52;
      var driftAng = (outcome.shift % 8) * (Math.PI / 4);

      subjects.slice(0, maxSubjects).forEach(function (subj, i) {
        var kind = SM.entityKindFromText(subj);
        if (kind === "prop") return;
        var ring = 3 + ((placed + i + age) % 4);
        var gx = centerGx + ((placed + i) % 3 - 1) * ring + Math.round(Math.cos(driftAng) * (age * 0.35));
        var gy = centerGy + (Math.floor((placed + i) / 3) - 1) * ring + Math.round(Math.sin(driftAng) * (age * 0.35));
        var tries = 0;
        while (mazeCellIsWall(gx, gy, g.fx.seed) && tries < 8) {
          gx += 1;
          tries++;
        }
        var wx = gx * MAZE_CELL + MAZE_CELL * 0.5 + Math.cos(driftAng + i) * drift;
        var wy = gy * MAZE_CELL + MAZE_CELL * 0.5 + Math.sin(driftAng + i) * drift;
        var place = C.entityPlacement(placed + i + age * 3, g.fx.seed, outcome.shift || g.stasisVariant);
        place.x = wx;
        place.y = wy;
        placed += 1;
        placeEntity(
          {
            subject: subj.length > 48 ? subj.slice(0, 46) + "…" : subj,
            spellNum: oNums[i] || oNums[0],
            slot: i,
            visionSlot: i,
            visionUrl: outcome.visionUrl,
            outcomeShift: outcome.shift,
            outcomeAge: age,
            alpha: alpha,
            kind: kind,
            r: kind === "obstacle" ? 40 : 30,
          },
          place
        );
      });

      if (age > 0) return;
      oNums.forEach(function (n, i) {
        var hint = SM.spellEntityHint(n, getAnalysis);
        if (!hint || hint.kind === "enemy") return;
        var dup = g.obstacles.some(function (e) {
          return e.spellNum === n && !e.maze && !e.outcomeAge;
        });
        if (dup) return;
        var gx = centerGx + 2 + i * 2;
        var gy = centerGy - 1 + i;
        if (mazeCellIsWall(gx, gy, g.fx.seed)) gx += 1;
        var place = C.entityPlacement(placed + i + 3, g.fx.seed, g.stasisVariant);
        place.x = gx * MAZE_CELL + MAZE_CELL * 0.5;
        place.y = gy * MAZE_CELL + MAZE_CELL * 0.5;
        placeEntity(
          {
            subject: hint.subject,
            spellNum: n,
            slot: i,
            visionSlot: i,
            visionUrl: outcome.visionUrl,
            outcomeShift: outcome.shift,
            outcomeAge: 0,
            alpha: 1,
            kind: hint.kind,
            r: 38,
          },
          place
        );
        placed += 1;
      });
    });

    var nonFalloutCount = 0;
    for (var nf = 0; nf < g.enemies.length; nf++) {
      if (!g.enemies[nf].fallout) nonFalloutCount++;
    }
    while (nonFalloutCount < 2 && countFalloutEnemies() < MOSAIC_COMPASS.length) {
      var ei = nonFalloutCount;
      var efp = C.enemyFallbackPlacement(ei);
      var foe = enrichEntity({
        subject: ei === 0 ? "Stasis warden" : "Fused specter",
        spellNum: nums[ei % nums.length],
        slot: efp.slot,
        visionSlot: efp.slot,
        visionUrl: current.visionUrl,
        outcomeShift: current.shift,
        alpha: 1,
        kind: "enemy",
        r: 30,
        phase: efp.phase,
        speed: efp.speed,
      });
      foe.x = Math.cos(efp.angle) * efp.dist;
      foe.y = Math.sin(efp.angle) * efp.dist;
      foe.patrolX = foe.x;
      foe.patrolY = foe.y;
      foe.patrolR = efp.patrolR;
      g.enemies.push(foe);
      nonFalloutCount++;
    }
  }

  function loadFusionImage(url, unlockFloor, source, opts) {
    opts = opts || {};
    if (
      !opts.skipHistory &&
      url &&
      g.fusion.visionUrl &&
      g.fusion.visionUrl !== url
    ) {
      snapshotFusionHistory(opts.action || "replace");
    }
    if (!url) {
      g.fusion.visionImg = null;
      g.fusion._url = "";
      g.fusion.visionUrl = "";
      g._previewKey = "";
      updateStasisPreview();
      return Promise.resolve();
    }
    if (g.fusion._url === url && hasVisionFloor()) {
      updateStasisActionButtons();
      return Promise.resolve();
    }

    function attachImage(img, src) {
      return new Promise(function (resolve, reject) {
        var settled = false;
        function settle(ok) {
          if (settled) return;
          settled = true;
          if (!ok) {
            if (g.fusion.visionUrl === src || g.fusion._url === src) {
              g.fusion.visionUrl = "";
              g.fusion._url = "";
            }
            reject(new Error("Could not load stasis vision."));
            return;
          }
          g.fusion.visionImg = img;
          g.fusion.visionUrl = src;
          g.fusion._url = src;
          g._videofyAnalysis = null;
          if (unlockFloor === true) g.floorUnlocked = true;
          g.fusion.source =
            source ||
            (src.indexOf("data:") === 0 || src.indexOf("blob:") === 0 ? "local" : "ai");
          if (g.fusion.source === "ai" || g.stasisFromApi) g._aiStasisLanded = true;
          if (opts.action !== "restore") {
            recordSpellGenerated(equippedNums());
            recordEntityOutcome(opts.action || "vision");
            syncMosaicCenterCell();
            layoutWorldEntities();
            maybeSpawnAllFalloutEnemies();
          }
          refreshPlayerPersona();
          updateStasisPreview();
          updateSlotHud();
          if (img.decode) {
            img.decode().then(resolve).catch(resolve);
          } else {
            resolve();
          }
        }
        img.loading = "eager";
        img.onload = function () {
          settle(true);
        };
        img.onerror = function () {
          settle(false);
        };
        img.src = src;
      });
    }

    var img = new Image();
    var isLocal = url.indexOf("data:") === 0 || url.indexOf("blob:") === 0;
    if (!isLocal) img.crossOrigin = "anonymous";

    return attachImage(img, url).catch(function () {
      if (isLocal) throw new Error("Could not load stasis vision.");
      var plain = new Image();
      return attachImage(plain, url);
    });
  }

  function scheduleAutoFloor() {
    var nums = equippedNums();
    if (
      nums.length < 2 ||
      g.floorGenerating ||
      !g.playing ||
      g.menuOpen ||
      g._worldGenPromise
    ) {
      return;
    }
    if (shouldDrawStasisPlane() && hasVisionFloor()) return;
    clearTimeout(g._autoFloorTimer);
    g._autoFloorTimer = setTimeout(function () {
      if (shouldDrawStasisPlane() || g._worldGenPromise) return;
      startFloorGenBackground();
    }, 900);
  }

  function setFloorStatus(msg, opts) {
    opts = opts || {};
    clearFloorStatusTimer();
    msg = msg || "";
    g.floorStatus = msg;
    var idEl = $("mw-painting-id");
    if (idEl && msg) {
      idEl.textContent = msg.length > 42 ? msg.slice(0, 40) + "…" : msg;
    } else if (idEl && !msg && g.playing) {
      updateHudLabel();
    }
    if (!msg) return;
    var sticky =
      opts.sticky === true ||
      (opts.sticky !== false && isFloorStatusSticky());
    if (!sticky) {
      var captured = msg;
      var ms =
        opts.duration != null ? opts.duration : FLOOR_STATUS_DISMISS_MS;
      g._floorStatusTimer = setTimeout(function () {
        g._floorStatusTimer = 0;
        if (g.floorStatus !== captured || isFloorStatusSticky()) return;
        g.floorStatus = "";
        updateHudLabel();
      }, ms);
    }
  }

  function blendStasisReadout() {
    var nums = equippedNums();
    if (nums.length < 2) return Promise.resolve();
    if (!analysesReady()) return Promise.resolve();
    regenerateStasisText();
    if (!window.StasisFloorGen) return Promise.resolve();
    if (g._blendPromise) return g._blendPromise;
    g._blendPromise = window.StasisFloorGen.checkHealth()
      .then(function (health) {
        if (!health.ok || window.SPELLFORGE_LOCAL_GENERATE === true) return null;
        if (!String(g.stasisText || "").trim()) {
          throw new Error("Stasis text is empty.");
        }
        return window.StasisFloorGen.blendSpells(nums);
      })
      .then(function (blend) {
        if (!blend) return;
        if (blend.mixed_description) {
          g.stasisText = blend.mixed_description;
          g.stasisFromApi = true;
        }
        if (blend.fused_title) g.stasisTitle = blend.fused_title;
        refreshReadouts();
        if (isMuralwalkActive() && equippedNums().length >= 2) {
          evolveStasisProps();
        }
      })
      .catch(function (err) {
        if (err && err.message) setFloorStatus(err.message);
      })
      .finally(function () {
        g._blendPromise = null;
      });
    return g._blendPromise;
  }

  function generateStasisFloor(unlockFloor) {
    var nums = equippedNums();
    if (nums.length < 2) return Promise.resolve();
    if (g.floorGenerating) return g._floorGenPromise || Promise.resolve();
    unlockFloor = unlockFloor === true;

    if (!g.stasisText.trim()) regenerateStasisText();
    g.floorGenerating = true;
    setFloorStatus("Preparing stasis vision…");

    function finishLocalFallback() {
      if (typeof window.composeStasisVisionLocal !== "function") {
        return Promise.reject(new Error("No vision composer available."));
      }
      var buzz =
        window.StasisFloorGen && window.StasisFloorGen.collectBuzz
          ? window.StasisFloorGen.collectBuzz({
              tags: nums.reduce(function (acc, n) {
                var a = getAnalysis(n);
                return a && a.tags ? acc.concat(a.tags.slice(0, 6)) : acc;
              }, []),
              styles: nums.reduce(function (acc, n) {
                var a = getAnalysis(n);
                return a && a.style ? acc.concat([a.style]) : acc;
              }, []),
              moods: nums
                .map(function (n) {
                  var a = getAnalysis(n);
                  return a && a.mood ? a.mood : "";
                })
                .filter(Boolean)
                .join(" · "),
            })
          : [];
      setFloorStatus("API unavailable — local fuse fallback…");
      return window
        .composeStasisVisionLocal({
          spells: nums,
          stasis: g.stasisText,
          buzz_words: buzz,
        })
        .then(function (url) {
          return {
            url: url,
            stasis: g.stasisText,
            title: g.stasisTitle,
            buzz: buzz,
            spells: nums,
            source: "local",
          };
        });
    }

    var work =
      window.StasisFloorGen && window.StasisFloorGen.buildFloor
        ? window.StasisFloorGen.buildFloor({
            spells: nums,
            getAnalysis: getAnalysis,
            localStasis: g.stasisText,
            localTitle: g.stasisTitle,
            buzz_words: getMwActiveBuzz(),
            onStatus: setFloorStatus,
            skipBlend: g.stasisFromApi,
          })
        : finishLocalFallback();

    g._floorGenPromise = work
      .then(function (result) {
        if (!result || !result.url) return;
        g.stasisText = result.stasis || g.stasisText;
        g.stasisTitle = result.title || g.stasisTitle;
        g.buzzWords = result.buzz || [];
        if (result.stasis) {
          g.stasisText = result.stasis;
          g.stasisFromApi = true;
        }
        return loadFusionImage(result.url, unlockFloor, result.source || "ai");
      })
      .then(function () {
        if (unlockFloor) g.floorUnlocked = true;
        updateHud();
        publishToSpellforge();
      })
      .catch(function () {
        return finishLocalFallback()
          .then(function (result) {
            if (!result || !result.url) return;
            return loadFusionImage(result.url, unlockFloor, "local");
          })
          .then(function () {
            if (unlockFloor) g.floorUnlocked = true;
          })
          .then(function () {
            updateHud();
            publishToSpellforge();
          });
      })
      .finally(function () {
        g.floorGenerating = false;
        setFloorStatus("");
        g._floorGenPromise = null;
        updateHud();
      });

    return g._floorGenPromise;
  }

  function publishToSpellforge() {
    var nums = equippedNums();
    window.dispatchEvent(
      new CustomEvent("muralwalk-fusion", {
        detail: {
          spells: nums,
          stasis: g.stasisText,
          title: g.stasisTitle,
          visionUrl: g.fusion.visionUrl,
          buzz: g.buzzWords,
        },
      })
    );
  }

  function updateStasisPreview() {
    var vision = g.fusion.visionImg;
    var ready = !!(vision && vision.complete && vision.naturalWidth > 0);
    var key = ready ? g.fusion._url || g.fusion.visionUrl || "" : "";
    if (g._previewKey !== key) {
      g._previewKey = key;
      var canvas = $("mw-stasis-preview-canvas");
      var empty = $("mw-stasis-preview-empty");
      if (canvas) {
        if (ready) {
          var ctx = canvas.getContext("2d");
          var cw = canvas.width;
          var ch = canvas.height;
          ctx.clearRect(0, 0, cw, ch);
          var scale = Math.min(cw / vision.naturalWidth, ch / vision.naturalHeight);
          var dw = vision.naturalWidth * scale;
          var dh = vision.naturalHeight * scale;
          try {
            ctx.drawImage(vision, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
            canvas.hidden = false;
          } catch (err) {
            canvas.hidden = true;
          }
        } else {
          var clear = canvas.getContext("2d");
          clear.clearRect(0, 0, canvas.width, canvas.height);
          canvas.hidden = true;
        }
      }
      if (empty) {
        var keepPreview = !ready && hasVisionFloor();
        empty.hidden = ready || keepPreview;
        if (!ready && !keepPreview) {
          empty.textContent = g.floorGenerating || g._worldGenPromise || g._reimaginePromise
            ? "Painting stasis…"
            : "Stasis image will appear here.";
        } else if (keepPreview) {
          empty.textContent = "Upgrading stasis…";
          empty.hidden = false;
        }
      }
    }
    if (ready && !g._videofyPromise) {
      prefetchVideofyAnalysis();
    }
    updateStasisActionButtons();
  }

  function prefetchVideofyAnalysis() {
    var canvas = $("mw-stasis-video-canvas");
    var vision = g.fusion.visionImg;
    if (!canvas || !vision || !vision.complete || g._videofyPrefetching) return;
    var nums = equippedNums();
    if (nums.length < 2 || !g.stasisText.trim()) return;
    var key = videofyPlanKey(vision, g.stasisText, nums);
    if (g._videofyAnalysis && g._videofyAnalysis.key === key) return;
    clearTimeout(g._videofyPrefetchTimer);
    g._videofyPrefetchTimer = setTimeout(function () {
      if (g._videofyPromise) return;
      g._videofyPrefetching = true;
      requestAnimationFrame(function () {
        try {
          getVideofyAnalysis(vision, canvas.width, canvas.height, g.stasisText, nums);
        } catch (err) {}
        g._videofyPrefetching = false;
      });
    }, 400);
  }

  function stasisVisionReady() {
    if (hasVisionFloor()) return true;
    return !!(g.fusion.visionUrl || g.fusion._url);
  }

  function stasisActionsBusy() {
    if (
      g._visionRegenPromise ||
      g._reimaginePromise ||
      g._redefinePromise ||
      g._videofyPromise
    ) {
      return true;
    }
    if (stasisVisionReady()) return false;
    return !!(g.floorGenerating || g._worldGenPromise);
  }

  var mwRedefineCount = 0;

  function setMwRedefineStatus(msg, isError) {
    var el = $("mw-stasis-redefine-status");
    if (!el) return;
    if (!msg) {
      el.hidden = true;
      el.textContent = "";
      el.className = "mw-stasis-redefine-status";
      return;
    }
    el.hidden = false;
    el.className = isError
      ? "mw-stasis-redefine-status error"
      : "mw-stasis-redefine-status";
    el.textContent = msg;
  }

  function canBuildStasisVideo() {
    var canvas = $("mw-stasis-video-canvas");
    return !!(
      window.MediaRecorder &&
      canvas &&
      canvas.captureStream &&
      hasVisionFloor()
    );
  }

  function videofyClamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function videofySmooth(u) {
    u = videofyClamp(u, 0, 1);
    return u * u * (3 - 2 * u);
  }

  function videofyBreathe(t, speed, phase) {
    return 0.5 + 0.5 * Math.sin(t * Math.PI * 2 * (speed || 1) + (phase || 0));
  }

  function videofySmoothPulse(t, speed, phase) {
    return videofySmooth(videofyBreathe(t, speed || 0.6, phase));
  }

  function videofyLerpRgb(a, b, u) {
    u = videofyClamp(u, 0, 1);
    return [
      Math.round(a[0] + (b[0] - a[0]) * u),
      Math.round(a[1] + (b[1] - a[1]) * u),
      Math.round(a[2] + (b[2] - a[2]) * u),
    ];
  }

  function videofyPaletteAt(pals, t) {
    if (!pals || !pals.length) return [40, 36, 48];
    if (pals.length === 1) return pals[0].slice();
    var pos = t * pals.length * 0.85;
    var i = Math.floor(pos) % pals.length;
    var j = (i + 1) % pals.length;
    return videofyLerpRgb(pals[i], pals[j], videofySmooth(pos - Math.floor(pos)));
  }

  function videofyPalette(buzz, stasis) {
    if (window.StasisWalkFloor && window.StasisWalkFloor.paletteFromBuzz) {
      return window.StasisWalkFloor.paletteFromBuzz(buzz, stasis);
    }
    return [[120, 100, 140]];
  }

  var VIDEIFY_BUZZ_FX = {
    swirl: "swirl",
    spiral: "swirl",
    vortex: "swirl",
    fluid: "ripple",
    flow: "ripple",
    water: "ripple",
    ripple: "ripple",
    wave: "ripple",
    light: "glow",
    glow: "glow",
    luminous: "glow",
    dark: "vignette",
    shadow: "vignette",
    noir: "vignette",
    soft: "soft",
    dream: "soft",
    haze: "soft",
    motion: "ripple",
    dance: "swirl",
    dynamic: "ripple",
  };

  var VIDEIFY_OPPOSITE_SUBSTR = [
    ["light", "abyssal void"],
    ["bright", "eclipsed ash"],
    ["luminous", "lightless choke"],
    ["dark", "searing whiteout"],
    ["shadow", "blinding glare"],
    ["soft", "razor fracture"],
    ["gentle", "violent rupture"],
    ["hard", "dissolving mist"],
    ["sharp", "blurred melt"],
    ["warm", "bitter frost"],
    ["cool", "molten flare"],
    ["cold", "fever heat"],
    ["calm", "frantic unravel"],
    ["still", "violent surge"],
    ["quiet", "deafening roar"],
    ["smooth", "jagged rupture"],
    ["flow", "static choke"],
    ["fluid", "crystalline lock"],
    ["organic", "synthetic rupture"],
    ["natural", "artificial glare"],
    ["minimal", "chaotic overload"],
    ["dense", "hollow vacuum"],
    ["serene", "manic collapse"],
    ["peace", "warring static"],
    ["dream", "nightmare static"],
    ["gold", "corroded rust"],
    ["blue", "sickly orange"],
    ["red", "bruised cyan"],
    ["green", "toxic magenta"],
    ["portrait", "shattered profile"],
    ["landscape", "inverted horizon"],
    ["abstract", "hyperliteral grid"],
    ["figurative", "faceless dissolve"],
    ["oil", "dry chalk void"],
    ["watercolor", "tar sludge"],
    ["ink", "bleached absence"],
    ["pastel", "neon acid"],
    ["vivid", "ashen drain"],
    ["muted", "screaming saturation"],
    ["harmony", "dissonant riot"],
    ["balance", "lopsided wreck"],
    ["unity", "splintered clash"],
    ["fused", "shattered apart"],
    ["merged", "torn asunder"],
    ["singular", "fractured many"],
  ];

  var VIDEIFY_INVERT_FRAMES = [
    "anti-",
    "un-",
    "non-",
    "counter-",
    "inverse ",
    "hollow ",
    "corrupted ",
    "unmade ",
  ];

  var VIDEIFY_STASIS_STOPWORDS = {
    the: 1,
    and: 1,
    one: 1,
    your: 1,
    with: 1,
    from: 1,
    that: 1,
    this: 1,
    into: 1,
    while: 1,
    yet: 1,
    together: 1,
    holds: 1,
    shared: 1,
    reads: 1,
    vision: 1,
    spell: 1,
    mural: 1,
    form: 1,
    hue: 1,
    unified: 1,
    merged: 1,
    fused: 1,
    singular: 1,
    apparition: 1,
    braided: 1,
    frame: 1,
    canvas: 1,
  };

  function videofyLexiconOpposite(lower) {
    var i;
    var best = null;
    for (i = 0; i < VIDEIFY_OPPOSITE_SUBSTR.length; i++) {
      if (lower === VIDEIFY_OPPOSITE_SUBSTR[i][0]) {
        return VIDEIFY_OPPOSITE_SUBSTR[i][1];
      }
    }
    for (i = 0; i < VIDEIFY_OPPOSITE_SUBSTR.length; i++) {
      if (lower.indexOf(VIDEIFY_OPPOSITE_SUBSTR[i][0]) >= 0) {
        if (!best || VIDEIFY_OPPOSITE_SUBSTR[i][0].length > best[0].length) {
          best = VIDEIFY_OPPOSITE_SUBSTR[i];
        }
      }
    }
    return best ? best[1] : null;
  }

  function videofyMeaningfulWords(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter(function (w) {
        return w.length >= 3 && !VIDEIFY_STASIS_STOPWORDS[w];
      });
  }

  function videofyOppositeWord(word, seed, kind) {
    word = String(word || "").trim();
    if (!word) {
      return { text: "", chaos: 0 };
    }
    var lower = word.toLowerCase();
    var h = videofyHashStr(lower + "|" + String(seed) + "|" + kind);
    var hit = videofyLexiconOpposite(lower);
    if (hit) {
      return { text: hit, chaos: 0.72 + (h % 17) / 100 };
    }
    if (lower.length > 3) {
      return {
        text: VIDEIFY_INVERT_FRAMES[h % VIDEIFY_INVERT_FRAMES.length] + lower,
        chaos: 0.64 + (h % 19) / 100,
      };
    }
    return { text: "not " + lower, chaos: 0.58 };
  }

  function videofyShuffleTokens(tokens, stasisText) {
    var out = tokens.slice();
    var i;
    for (i = out.length - 1; i > 0; i--) {
      var j = (videofyHashStr(String(stasisText) + "shuffle" + i) >>> 0) % (i + 1);
      var tmp = out[i];
      out[i] = out[j];
      out[j] = tmp;
    }
    return out;
  }

  function videofyInvertedEffects(fx, chaos) {
    fx = fx || {};
    chaos = chaos || 0;
    var inv = {};
    if (fx.swirl) inv.ripple = true;
    if (fx.ripple) inv.swirl = true;
    if (fx.glow) inv.vignette = true;
    if (fx.vignette) inv.glow = true;
    if (fx.soft) inv.ripple = true;
    if (chaos > 0.45) {
      inv.swirl = true;
      inv.ripple = true;
    }
    if (chaos > 0.62) inv.glow = true;
    if (chaos > 0.78) inv.vignette = true;
    return inv;
  }

  function videofyTokenChaos(tok, localSmooth) {
    if (!tok) return 0.35;
    var c = tok.chaos != null ? tok.chaos : 0.55;
    if (tok.invert) c = Math.min(1, c + (1 - localSmooth) * 0.42);
    return c;
  }

  var VIDEIFY_MAX_LAYERS = 3;
  var VIDEIFY_MAX_SPRITE_DIM = 160;
  var VIDEIFY_DURATION_SEC = 24;
  var VIDEIFY_FPS = 24;
  var VIDEIFY_SETTINGS_STORAGE_KEY = "muralwalk.videofySettings";
  var VIDEIFY_SETTINGS_DEFAULT = {
    duration: 24,
    motion: 50,
    warp: 45,
    spellMorph: 50,
    subjectMotion: 50,
    visionHold: 60,
    overlays: 40,
    pulseSpeed: 45,
    tokenPace: 50,
    showCaption: true,
    notes: "",
  };

  function videofyNorm(v) {
    return videofyClamp(v, 0, 100) / 100;
  }

  function parseVideofyNotes(text) {
    var t = String(text || "").toLowerCase();
    var adj = {
      motion: 0,
      warp: 0,
      spellMorph: 0,
      subjectMotion: 0,
      visionHold: 0,
      overlays: 0,
      pulseSpeed: 0,
      tokenPace: 0,
      showCaption: null,
    };
    function has(words) {
      for (var i = 0; i < words.length; i++) {
        if (t.indexOf(words[i]) >= 0) return true;
      }
      return false;
    }
    if (has(["no strobe", "no strobing", "anti strobe", "smooth", "calm", "gentle", "soft pulse"])) {
      adj.pulseSpeed -= 25;
      adj.overlays -= 15;
    }
    if (has(["strobe", "strobing", "energetic", "intense", "punchy"])) {
      adj.pulseSpeed += 20;
      adj.overlays += 10;
    }
    if (has(["slow", "slower", "drift", "lazy", "languid"])) {
      adj.motion -= 20;
      adj.tokenPace -= 15;
      adj.pulseSpeed -= 10;
    }
    if (has(["fast", "quick", "rapid", "dynamic", "lively"])) {
      adj.motion += 20;
      adj.tokenPace += 15;
      adj.pulseSpeed += 8;
    }
    if (has(["no warp", "less warp", "subtle warp", "minimal warp", "flat"])) {
      adj.warp -= 30;
    }
    if (has(["more warp", "heavy warp", "strong warp", "warped", "liquify"])) {
      adj.warp += 25;
    }
    if (has(["no morph", "less morph", "subtle morph", "minimal morph"])) {
      adj.spellMorph -= 25;
    }
    if (has(["strong morph", "more morph", "crossfade", "blend spells"])) {
      adj.spellMorph += 20;
    }
    if (has(["no overlay", "less overlay", "subtle overlay", "minimal overlay", "clean"])) {
      adj.overlays -= 30;
    }
    if (has(["more overlay", "heavy overlay", "buzz", "particles", "fx"])) {
      adj.overlays += 25;
    }
    if (has(["no caption", "hide caption", "without caption", "no text", "no ticker"])) {
      adj.showCaption = false;
    }
    if (has(["show caption", "caption on", "with caption", "ticker"])) {
      adj.showCaption = true;
    }
    if (has(["hold vision", "static", "steady", "stable", "locked"])) {
      adj.visionHold += 25;
      adj.motion -= 10;
      adj.warp -= 10;
    }
    if (has(["more layers", "subject motion", "floating subjects", "orbit subjects"])) {
      adj.subjectMotion += 20;
    }
    if (has(["less motion", "subtle motion", "minimal motion", "still"])) {
      adj.motion -= 25;
      adj.subjectMotion -= 15;
    }
    return adj;
  }

  function readVideofyPanelRaw() {
    function num(id, fallback) {
      var el = $(id);
      if (!el) return fallback;
      var v = parseInt(el.value, 10);
      return isNaN(v) ? fallback : v;
    }
    var cap = $("mw-vf-showCaption");
    var notes = $("mw-vf-notes");
    return {
      duration: num("mw-vf-duration", VIDEIFY_SETTINGS_DEFAULT.duration),
      motion: num("mw-vf-motion", VIDEIFY_SETTINGS_DEFAULT.motion),
      warp: num("mw-vf-warp", VIDEIFY_SETTINGS_DEFAULT.warp),
      spellMorph: num("mw-vf-spellMorph", VIDEIFY_SETTINGS_DEFAULT.spellMorph),
      subjectMotion: num("mw-vf-subjectMotion", VIDEIFY_SETTINGS_DEFAULT.subjectMotion),
      visionHold: num("mw-vf-visionHold", VIDEIFY_SETTINGS_DEFAULT.visionHold),
      overlays: num("mw-vf-overlays", VIDEIFY_SETTINGS_DEFAULT.overlays),
      pulseSpeed: num("mw-vf-pulseSpeed", VIDEIFY_SETTINGS_DEFAULT.pulseSpeed),
      tokenPace: num("mw-vf-tokenPace", VIDEIFY_SETTINGS_DEFAULT.tokenPace),
      showCaption: cap ? cap.checked : VIDEIFY_SETTINGS_DEFAULT.showCaption,
      notes: notes ? String(notes.value || "").trim() : "",
    };
  }

  function mergeVideofySettings(raw) {
    raw = raw || VIDEIFY_SETTINGS_DEFAULT;
    var adj = parseVideofyNotes(raw.notes);
    var keys = [
      "motion",
      "warp",
      "spellMorph",
      "subjectMotion",
      "visionHold",
      "overlays",
      "pulseSpeed",
      "tokenPace",
    ];
    var out = {
      duration: videofyClamp(
        raw.duration != null ? raw.duration : VIDEIFY_SETTINGS_DEFAULT.duration,
        8,
        36
      ),
      showCaption:
        adj.showCaption !== null
          ? adj.showCaption
          : raw.showCaption !== false,
      notes: raw.notes || "",
    };
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var base = raw[k] != null ? raw[k] : VIDEIFY_SETTINGS_DEFAULT[k];
      out[k] = videofyClamp(base + (adj[k] || 0), 0, 100);
    }
    return out;
  }

  function getVideofySettings() {
    return mergeVideofySettings(readVideofyPanelRaw());
  }

  function saveVideofySettingsToStorage(raw) {
    try {
      localStorage.setItem(VIDEIFY_SETTINGS_STORAGE_KEY, JSON.stringify(raw || readVideofyPanelRaw()));
    } catch (err) {}
  }

  function loadVideofySettingsToPanel() {
    var saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(VIDEIFY_SETTINGS_STORAGE_KEY));
    } catch (err) {}
    if (!saved || typeof saved !== "object") saved = VIDEIFY_SETTINGS_DEFAULT;
    function setRange(id, val, fallback) {
      var el = $(id);
      if (!el) return;
      el.value = String(val != null ? val : fallback);
    }
    setRange("mw-vf-duration", saved.duration, VIDEIFY_SETTINGS_DEFAULT.duration);
    setRange("mw-vf-motion", saved.motion, VIDEIFY_SETTINGS_DEFAULT.motion);
    setRange("mw-vf-warp", saved.warp, VIDEIFY_SETTINGS_DEFAULT.warp);
    setRange("mw-vf-spellMorph", saved.spellMorph, VIDEIFY_SETTINGS_DEFAULT.spellMorph);
    setRange("mw-vf-subjectMotion", saved.subjectMotion, VIDEIFY_SETTINGS_DEFAULT.subjectMotion);
    setRange("mw-vf-visionHold", saved.visionHold, VIDEIFY_SETTINGS_DEFAULT.visionHold);
    setRange("mw-vf-overlays", saved.overlays, VIDEIFY_SETTINGS_DEFAULT.overlays);
    setRange("mw-vf-pulseSpeed", saved.pulseSpeed, VIDEIFY_SETTINGS_DEFAULT.pulseSpeed);
    setRange("mw-vf-tokenPace", saved.tokenPace, VIDEIFY_SETTINGS_DEFAULT.tokenPace);
    var cap = $("mw-vf-showCaption");
    if (cap) cap.checked = saved.showCaption !== false;
    var notes = $("mw-vf-notes");
    if (notes) notes.value = saved.notes || "";
    refreshVideofyPanelLabels();
  }

  function refreshVideofyPanelLabels() {
    var fields = [
      { input: "mw-vf-duration", label: "mw-vf-val-duration", suffix: "s" },
      { input: "mw-vf-motion", label: "mw-vf-val-motion" },
      { input: "mw-vf-warp", label: "mw-vf-val-warp" },
      { input: "mw-vf-spellMorph", label: "mw-vf-val-spellMorph" },
      { input: "mw-vf-subjectMotion", label: "mw-vf-val-subjectMotion" },
      { input: "mw-vf-visionHold", label: "mw-vf-val-visionHold" },
      { input: "mw-vf-overlays", label: "mw-vf-val-overlays" },
      { input: "mw-vf-pulseSpeed", label: "mw-vf-val-pulseSpeed" },
      { input: "mw-vf-tokenPace", label: "mw-vf-val-tokenPace" },
    ];
    fields.forEach(function (f) {
      var input = $(f.input);
      var label = $(f.label);
      if (!input || !label) return;
      label.textContent = String(input.value) + (f.suffix || "");
    });
  }

  function bindVideofyPanel() {
    var panel = $("mw-videofy-panel");
    if (!panel || panel.dataset.bound) return;
    panel.dataset.bound = "1";
    loadVideofySettingsToPanel();

    var tuneBtn = $("mw-stasis-videofy-tune");
    if (tuneBtn) {
      tuneBtn.addEventListener("click", function () {
        var opening = panel.hidden;
        panel.hidden = !opening;
        tuneBtn.setAttribute("aria-expanded", opening ? "true" : "false");
        if (opening) loadVideofySettingsToPanel();
      });
    }

    var ids = [
      "mw-vf-duration",
      "mw-vf-motion",
      "mw-vf-warp",
      "mw-vf-spellMorph",
      "mw-vf-subjectMotion",
      "mw-vf-visionHold",
      "mw-vf-overlays",
      "mw-vf-pulseSpeed",
      "mw-vf-tokenPace",
    ];
    ids.forEach(function (id) {
      var el = $(id);
      if (!el) return;
      el.addEventListener("input", function () {
        refreshVideofyPanelLabels();
        saveVideofySettingsToStorage();
      });
    });

    var cap = $("mw-vf-showCaption");
    if (cap) {
      cap.addEventListener("change", function () {
        saveVideofySettingsToStorage();
      });
    }
    var notes = $("mw-vf-notes");
    if (notes) {
      notes.addEventListener("change", function () {
        saveVideofySettingsToStorage();
      });
      notes.addEventListener("blur", function () {
        saveVideofySettingsToStorage();
      });
    }

    var resetBtn = $("mw-vf-reset");
    if (resetBtn) {
      resetBtn.addEventListener("click", function () {
        saveVideofySettingsToStorage(VIDEIFY_SETTINGS_DEFAULT);
        loadVideofySettingsToPanel();
      });
    }
  }

  function videofyCapSprite(sprite, maxDim) {
    var bw = sprite.width;
    var bh = sprite.height;
    if (bw <= maxDim && bh <= maxDim) return sprite;
    var scale = maxDim / Math.max(bw, bh);
    var nw = Math.max(4, Math.round(bw * scale));
    var nh = Math.max(4, Math.round(bh * scale));
    var capped = document.createElement("canvas");
    capped.width = nw;
    capped.height = nh;
    var cctx = capped.getContext("2d");
    cctx.drawImage(sprite, 0, 0, nw, nh);
    return capped;
  }

  function videofyHashStr(s) {
    var h = 2166136261;
    s = String(s || "");
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function videofyPlanKey(vision, stasisText, nums) {
    return (
      (g.fusion._url || vision.src || "") +
      "|" +
      String(stasisText || "").slice(0, 96) +
      "|" +
      (nums || []).join(",")
    );
  }

  function parseStasisVideofyTitle(stasisText) {
    if (g.stasisTitle && g.stasisTitle.trim()) return g.stasisTitle.trim();
    var m = String(stasisText || "").match(/^([^:]+):/);
    if (m) return m[1].trim();
    return "Fused stasis";
  }

  function stasisPromptTokens(stasisText, buzz) {
    var out = [];
    var seen = {};
    function add(w) {
      w = String(w || "").toLowerCase().trim();
      if (w.length < 3 || seen[w]) return;
      seen[w] = 1;
      out.push(w);
    }
    (buzz || []).forEach(add);
    String(stasisText || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .forEach(add);
    return out;
  }

  function videofyActiveEffects(buzz, stasisText, spotlight) {
    var found = {};
    var all = stasisPromptTokens(stasisText, buzz);
    if (spotlight) all = all.concat([String(spotlight).toLowerCase()]);
    for (var i = 0; i < all.length; i++) {
      var w = all[i];
      Object.keys(VIDEIFY_BUZZ_FX).forEach(function (key) {
        if (w.indexOf(key) >= 0) found[VIDEIFY_BUZZ_FX[key]] = true;
      });
    }
    return found;
  }

  function createSubjectBandSprite(layer, layerW, layerH, bandIndex, bandCount) {
    var bandH = Math.ceil(layerH / bandCount);
    var by0 = bandIndex * bandH;
    var bh = Math.min(bandH, layerH - by0);
    var bw = layerW;
    var sprite = document.createElement("canvas");
    sprite.width = bw;
    sprite.height = bh;
    var sctx = sprite.getContext("2d");
    sctx.drawImage(layer, 0, by0, bw, bh, 0, 0, bw, bh);
    var mask = sctx.createLinearGradient(0, 0, 0, bh);
    mask.addColorStop(0, "rgba(255,255,255,0.15)");
    mask.addColorStop(0.12, "rgba(255,255,255,0.95)");
    mask.addColorStop(0.88, "rgba(255,255,255,0.95)");
    mask.addColorStop(1, "rgba(255,255,255,0.15)");
    sctx.globalCompositeOperation = "destination-in";
    sctx.fillStyle = mask;
    sctx.fillRect(0, 0, bw, bh);
    sctx.globalCompositeOperation = "source-over";
    return videofyCapSprite(sprite, VIDEIFY_MAX_SPRITE_DIM);
  }

  var VIDEIFY_PERSON_HINTS =
    "person figure face portrait woman man child girl boy human dancer spectator witness traveler being soul character eye profile bust body crowd".split(
      " "
    );
  var VIDEIFY_SCENE_HINTS =
    "landscape horizon sky forest city room interior exterior scene vista mountain sea ocean field street architecture building garden desert river valley coast cliff temple bridge horizon".split(
      " "
    );

  function videofyTextBlob(stasisText, meta, subjects) {
    return (
      String(stasisText || "") +
      " " +
      (subjects || []).join(" ") +
      " " +
      (meta && meta.tags ? meta.tags.join(" ") : "") +
      " " +
      (meta && meta.styles ? meta.styles.join(" ") : "")
    ).toLowerCase();
  }

  function videofyHintScore(blob, hints) {
    var score = 0;
    for (var i = 0; i < hints.length; i++) {
      if (blob.indexOf(hints[i]) >= 0) {
        score += hints[i].length > 5 ? 3 : 2;
      }
    }
    return score;
  }

  function videofyIsPersonText(text) {
    return /\b(person|figure|face|portrait|woman|man|child|girl|boy|human|dancer|spectator|witness|traveler|being|soul|character|profile|bust|crowd)\b/i.test(
      String(text || "")
    );
  }

  function videofyResolveContentMode(stasisText, meta, subjects) {
    var blob = videofyTextBlob(stasisText, meta, subjects);
    var people = videofyHintScore(blob, VIDEIFY_PERSON_HINTS);
    var scene = videofyHintScore(blob, VIDEIFY_SCENE_HINTS);
    subjects.forEach(function (s) {
      if (videofyIsPersonText(s)) people += 4;
    });
    if (people >= 4 && people >= scene) return "people";
    if (people >= 3 && scene < 3) return "people";
    return "scene";
  }

  function videofyRegionBox(reg) {
    var w = reg.w || 0.14;
    var h = reg.h || 0.14;
    return {
      l: reg.u - w * 0.5,
      r: reg.u + w * 0.5,
      t: reg.v - h * 0.5,
      b: reg.v + h * 0.5,
    };
  }

  function videofySalientRegionsConflict(a, b) {
    var du = a.u - b.u;
    var dv = a.v - b.v;
    if (Math.sqrt(du * du + dv * dv) < 0.26) return true;
    var ba = videofyRegionBox(a);
    var bb = videofyRegionBox(b);
    var overlapW = Math.min(ba.r, bb.r) - Math.max(ba.l, bb.l);
    var overlapH = Math.min(ba.b, bb.b) - Math.max(ba.t, bb.t);
    if (overlapW <= 0 || overlapH <= 0) return false;
    var overlapArea = overlapW * overlapH;
    var minArea = Math.min(a.w * a.h, b.w * b.h);
    return overlapArea > minArea * 0.22;
  }

  function videofyPruneSalientRegions(regions) {
    var out = [];
    var i;
    for (i = 0; i < (regions || []).length; i++) {
      var reg = regions[i];
      var clash = false;
      var j;
      for (j = 0; j < out.length; j++) {
        if (videofySalientRegionsConflict(reg, out[j])) {
          clash = true;
          break;
        }
      }
      if (!clash) out.push(reg);
    }
    return out;
  }

  function videofyDefaultRegions(count) {
    var defs = [
      { u: 0.2, v: 0.28, w: 0.14, h: 0.15, score: 1, label: "detail" },
      { u: 0.78, v: 0.26, w: 0.14, h: 0.15, score: 0.95, label: "detail" },
      { u: 0.5, v: 0.52, w: 0.15, h: 0.16, score: 0.9, label: "detail" },
      { u: 0.22, v: 0.74, w: 0.13, h: 0.14, score: 0.85, label: "detail" },
      { u: 0.76, v: 0.72, w: 0.13, h: 0.14, score: 0.8, label: "detail" },
    ];
    return videofyPruneSalientRegions(defs.slice(0, count));
  }

  function videofyScanSalientRegions(layerCanvas, count) {
    count = count || 6;
    try {
      var cw = layerCanvas.width;
      var ch = layerCanvas.height;
      if (cw < 12 || ch < 12) return videofyDefaultRegions(count);
      var ctx = layerCanvas.getContext("2d");
      var img = ctx.getImageData(0, 0, cw, ch);
      var data = img.data;
      var cols = 14;
      var rows = 10;
      var cells = [];
      var gx;
      var gy;
      for (gy = 0; gy < rows; gy++) {
        for (gx = 0; gx < cols; gx++) {
          var x0 = Math.floor((gx * cw) / cols);
          var y0 = Math.floor((gy * ch) / rows);
          var x1 = Math.min(cw - 1, Math.floor(((gx + 1) * cw) / cols));
          var y1 = Math.min(ch - 1, Math.floor(((gy + 1) * ch) / rows));
          var lumSum = 0;
          var lumSq = 0;
          var edge = 0;
          var samples = 0;
          var y;
          var x;
          for (y = y0; y < y1; y += 2) {
            for (x = x0; x < x1; x += 2) {
              var i = (y * cw + x) * 4;
              var r = data[i];
              var g = data[i + 1];
              var b = data[i + 2];
              var lum = 0.299 * r + 0.587 * g + 0.114 * b;
              lumSum += lum;
              lumSq += lum * lum;
              if (x + 2 < x1) {
                var i2 = (y * cw + x + 2) * 4;
                var lum2 = 0.299 * data[i2] + 0.587 * data[i2 + 1] + 0.114 * data[i2 + 2];
                edge += Math.abs(lum - lum2);
              }
              if (y + 2 < y1) {
                var i3 = ((y + 2) * cw + x) * 4;
                var lum3 = 0.299 * data[i3] + 0.587 * data[i3 + 1] + 0.114 * data[i3 + 2];
                edge += Math.abs(lum - lum3);
              }
              samples++;
            }
          }
          if (!samples) continue;
          var mean = lumSum / samples;
          var variance = Math.max(0, lumSq / samples - mean * mean);
          var score = variance * 0.55 + edge * 0.45;
          cells.push({
            u: (gx + 0.5) / cols,
            v: (gy + 0.5) / rows,
            w: 1 / cols,
            h: 1 / rows,
            score: score,
            label: "detail",
          });
        }
      }
      cells.sort(function (a, b) {
        return b.score - a.score;
      });
      var picked = [];
      var ci;
      for (ci = 0; ci < cells.length && picked.length < count; ci++) {
        var c = cells[ci];
        var candidate = {
          u: c.u,
          v: c.v,
          w: videofyClamp(c.w * 1.65, 0.1, 0.16),
          h: videofyClamp(c.h * 1.65, 0.1, 0.16),
          score: c.score,
          label: "detail",
        };
        var tooClose = false;
        var pi;
        for (pi = 0; pi < picked.length; pi++) {
          if (videofySalientRegionsConflict(candidate, picked[pi])) {
            tooClose = true;
            break;
          }
        }
        if (!tooClose) picked.push(candidate);
      }
      picked = videofyPruneSalientRegions(picked);
      return picked.length ? picked : videofyDefaultRegions(count);
    } catch (err) {
      return videofyDefaultRegions(count);
    }
  }

  function videofyLabelRegions(regions, tokens) {
    tokens = tokens || [];
    return (regions || []).map(function (reg, i) {
      var tok = tokens[(i + Math.floor(reg.u * 11)) % Math.max(1, tokens.length)];
      return {
        u: reg.u,
        v: reg.v,
        w: reg.w,
        h: reg.h,
        score: reg.score,
        label: (tok && tok.word) || reg.label || "detail",
      };
    });
  }

  function videofyBuildTalkers(subjects, regions, tokens, stasisText) {
    var talkers = [];
    var personSubjects = (subjects || []).filter(videofyIsPersonText);
    if (!personSubjects.length) personSubjects = (subjects || []).slice(0, 2);
    if (!personSubjects.length) personSubjects = [String(stasisText || "figure").slice(0, 60)];
    var faceRegions = (regions || []).filter(function (r) {
      return r.v < 0.62;
    });
    if (!faceRegions.length) faceRegions = videofyDefaultRegions(3);
    var count = Math.min(3, Math.max(personSubjects.length, faceRegions.length));
    var i;
    for (i = 0; i < count; i++) {
      var reg = faceRegions[i % faceRegions.length];
      var lines = (tokens || [])
        .filter(function (t) {
          return t.spellIdx === i % 3 || t.kind === "stasis";
        })
        .map(function (t) {
          return t.word;
        });
      if (!lines.length) {
        lines = (tokens || []).map(function (t) {
          return t.word;
        });
      }
      if (!lines.length) lines = ["..."];
      talkers.push({
        cx: reg.u,
        cy: reg.v,
        rw: Math.max(0.14, reg.w * 1.8),
        rh: Math.max(0.16, reg.h * 2),
        mouthV: 0.68,
        subject: personSubjects[i % personSubjects.length],
        lines: lines.slice(0, 12),
        phase: (videofyHashStr(personSubjects[i % personSubjects.length] + String(i)) % 100) / 100,
        slot: ["I", "II", "III"][i] || String(i + 1),
      });
    }
    return talkers;
  }

  function drawVideofySpeechBubble(ctx, w, h, anchorX, anchorY, text, alpha) {
    text = String(text || "").slice(0, 52);
    if (!text) return;
    alpha = alpha != null ? alpha : 0.92;
    ctx.save();
    ctx.font = "bold 11px Courier New, monospace";
    var tw = ctx.measureText(text).width;
    var bw = Math.min(w * 0.46, tw + 22);
    var bh = 24;
    var bx = videofyClamp(anchorX - bw / 2, 6, w - bw - 6);
    var by = videofyClamp(anchorY - bh - 14, 6, h - bh - 8);
    ctx.fillStyle = "rgba(248,242,230," + alpha + ")";
    ctx.strokeStyle = "rgba(42,32,54," + alpha + ")";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(bx + 6, by);
    ctx.lineTo(bx + bw - 6, by);
    ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + 6);
    ctx.lineTo(bx + bw, by + bh - 6);
    ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - 6, by + bh);
    ctx.lineTo(anchorX + 7, by + bh);
    ctx.lineTo(anchorX, by + bh + 9);
    ctx.lineTo(anchorX - 7, by + bh);
    ctx.lineTo(bx + 6, by + bh);
    ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - 6);
    ctx.lineTo(bx, by + 6);
    ctx.quadraticCurveTo(bx, by, bx + 6, by);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(28,18,38," + alpha + ")";
    ctx.textAlign = "center";
    ctx.fillText(text, bx + bw / 2, by + 16);
    ctx.restore();
  }

  function drawVideofyTalkers(ctx, w, h, t, vision, plan, state) {
    var talkers = plan.talkers || [];
    if (!vision || !vision.complete || !talkers.length) return;
    var iw = vision.naturalWidth || vision.width;
    var ih = vision.naturalHeight || vision.height;
    var i;
    for (i = 0; i < talkers.length; i++) {
      var tk = talkers[i];
      var talkRate = 5.5 + (state.chaos || 0) * 2.5;
      var talkPhase = t * talkRate + tk.phase;
      var mouthOpen = 0.25 + 0.75 * Math.abs(Math.sin(talkPhase * Math.PI * 2));
      var syllable = Math.floor(talkPhase * 3) % 3;
      if (syllable === 0) mouthOpen *= 0.55;
      var lineIdx = Math.floor(t * tk.lines.length * 1.6) % tk.lines.length;
      var line = tk.lines[lineIdx] || "…";

      var cropW = iw * tk.rw;
      var cropH = ih * tk.rh;
      var sx = videofyClamp(tk.cx * iw - cropW / 2, 0, Math.max(0, iw - cropW));
      var sy = videofyClamp(tk.cy * ih - cropH / 2, 0, Math.max(0, ih - cropH));
      var panelW = w * (0.34 + (i === 0 ? 0.06 : 0));
      var panelH = h * (0.4 + (i === 0 ? 0.05 : 0));
      var dx = w * (0.04 + (i % 2) * 0.52);
      var dy = h * (0.1 + (i % 3) * 0.2);

      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.45)";
      ctx.shadowBlur = 16;
      ctx.drawImage(vision, sx, sy, cropW, cropH, dx, dy, panelW, panelH);

      var mx = dx + panelW * 0.5;
      var my = dy + panelH * tk.mouthV;
      var jawDrop = panelH * 0.018 * mouthOpen;
      ctx.fillStyle = "rgba(18,8,14," + (0.45 + mouthOpen * 0.4) + ")";
      ctx.beginPath();
      ctx.ellipse(mx, my + jawDrop, panelW * 0.055 * (0.65 + mouthOpen * 0.5), panelH * 0.022 * mouthOpen, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(60,40,50,0.55)";
      ctx.lineWidth = 1;
      ctx.stroke();

      drawVideofySpeechBubble(ctx, w, h, mx, dy - 6, line, 0.94);
      ctx.font = "bold 9px Courier New, monospace";
      ctx.fillStyle = "rgba(220,200,255,0.75)";
      ctx.textAlign = "left";
      ctx.fillText(tk.slot + " speaks", dx + 4, dy + panelH - 5);
      ctx.restore();
    }
  }

  function videofySpotlightAt(t, count) {
    count = Math.max(1, count);
    var run = t * count * 1.05;
    var idx = Math.floor(run) % count;
    var local = videofySmooth(run - Math.floor(run));
    return { index: idx, local: local, blend: local };
  }

  function drawVideofySceneSpotlights(ctx, w, h, t, vision, plan, state) {
    var regions = plan.salientRegions || [];
    if (!vision || !vision.complete || !regions.length) return;
    var spot = videofySpotlightAt(t, regions.length);
    var reg = regions[spot.index];
    var iw = vision.naturalWidth || vision.width;
    var ih = vision.naturalHeight || vision.height;
    var zoom = 1.55 + spot.local * 0.45 + (state.chaos || 0) * 0.12;
    var cropW = iw * reg.w * zoom;
    var cropH = ih * reg.h * zoom;
    var sx = videofyClamp(reg.u * iw - cropW / 2, 0, Math.max(0, iw - cropW));
    var sy = videofyClamp(reg.v * ih - cropH / 2, 0, Math.max(0, ih - cropH));
    var panX = Math.sin(t * Math.PI * 2 * 0.35 + spot.index) * cropW * 0.04;
    var panY = Math.cos(t * Math.PI * 2 * 0.28 + spot.index) * cropH * 0.04;
    sx = videofyClamp(sx + panX, 0, Math.max(0, iw - cropW));
    sy = videofyClamp(sy + panY, 0, Math.max(0, ih - cropH));

    ctx.save();
    ctx.fillStyle = "rgba(4,3,8," + (0.42 + spot.local * 0.18) + ")";
    ctx.fillRect(0, 0, w, h);

    var pipW = w * (0.58 + spot.local * 0.14);
    var pipH = h * (0.58 + spot.local * 0.14);
    var pipX = (w - pipW) / 2;
    var pipY = (h - pipH) / 2;
    ctx.shadowColor = "rgba(201,162,39,0.55)";
    ctx.shadowBlur = 28;
    ctx.filter = "contrast(1.14) saturate(1.18) brightness(1.04)";
    ctx.drawImage(vision, sx, sy, cropW, cropH, pipX, pipY, pipW, pipH);
    ctx.filter = "none";

    ctx.strokeStyle = "rgba(201,162,39,0.65)";
    ctx.lineWidth = 2;
    ctx.strokeRect(pipX + 1, pipY + 1, pipW - 2, pipH - 2);

    var miniW = w * 0.22;
    var miniH = h * 0.18;
    var miniX = w - miniW - 8;
    var miniY = h - miniH - 8;
    ctx.globalAlpha = 0.88;
    ctx.drawImage(vision, 0, 0, iw, ih, miniX, miniY, miniW, miniH);
    ctx.strokeStyle = "rgba(245,240,232,0.35)";
    ctx.lineWidth = 1;
    ctx.strokeRect(miniX, miniY, miniW, miniH);
    var markL = miniX + videofyClamp(reg.u - reg.w * 0.5, 0, 1 - reg.w) * miniW;
    var markT = miniY + videofyClamp(reg.v - reg.h * 0.5, 0, 1 - reg.h) * miniH;
    var markW = reg.w * miniW;
    var markH = reg.h * miniH;
    ctx.strokeStyle = "rgba(201,162,39,0.95)";
    ctx.lineWidth = 2;
    ctx.strokeRect(markL, markT, markW, markH);

    drawVideofySpeechBubble(
      ctx,
      w,
      h,
      pipX + pipW / 2,
      pipY - 4,
      "≠ " + (reg.label || "detail"),
      0.9
    );
    ctx.font = "bold 9px Courier New, monospace";
    ctx.fillStyle = "rgba(200,180,220,0.8)";
    ctx.textAlign = "left";
    ctx.fillText(
      "spotlight " + (spot.index + 1) + "/" + regions.length,
      10,
      h - 36
    );
    ctx.restore();
  }

  function buildVideofyTokens(nums, meta, subjects, stasisText) {
    var tokens = [];
    var slots = ["I", "II", "III"];
    var seen = {};
    stasisText = String(stasisText || "");
    meta = meta || { styles: [], tags: [] };

    function pushOpposite(source, spellIdx, slot, kind) {
      source = String(source || "").trim();
      if (!source) return;
      var dedupe = kind + "|" + source.toLowerCase();
      if (seen[dedupe]) return;
      seen[dedupe] = 1;
      var seed = videofyHashStr(source + stasisText + kind + String(spellIdx));
      var opp = videofyOppositeWord(source, seed, kind);
      if (!opp.text) return;
      tokens.push({
        word: opp.text,
        source: source,
        spellIdx: spellIdx,
        slot: slot,
        kind: kind,
        invert: true,
        chaos: opp.chaos,
      });
    }

    function pushStyleWords(style, spellIdx, slot) {
      pushOpposite(style, spellIdx, slot, "style");
      videofyMeaningfulWords(style).forEach(function (w) {
        if (w.length >= 4) pushOpposite(w, spellIdx, slot, "style");
      });
    }

    videofyMeaningfulWords(stasisText).forEach(function (w, wi) {
      pushOpposite(w, wi % 3, slots[wi % 3], "stasis");
    });

    (meta.styles || []).forEach(function (style, si) {
      pushStyleWords(style, si % 3, slots[si % 3]);
    });

    for (var i = 0; i < Math.min(nums.length, 3); i++) {
      var a = getAnalysis(nums[i]);
      if (a && a.style) pushStyleWords(a.style, i, slots[i]);
    }

    (meta.tags || []).forEach(function (tag, ti) {
      pushOpposite(tag, ti % 3, slots[ti % 3], "tag");
    });

    for (var j = 0; j < Math.min(nums.length, 3); j++) {
      var aj = getAnalysis(nums[j]);
      (aj && aj.tags ? aj.tags : []).forEach(function (tag) {
        pushOpposite(tag, j, slots[j], "tag");
      });
    }

    if (!tokens.length) {
      pushOpposite("stasis", 0, slots[0], "stasis");
    }
    return videofyShuffleTokens(tokens, stasisText);
  }

  function loadVideofySpellImages(nums) {
    var jobs = [];
    for (var i = 0; i < Math.min(nums.length, 3); i++) {
      (function (idx, num) {
        jobs.push(
          new Promise(function (resolve) {
            var img = new Image();
            var url = paintingUrlFor(num);
            if (url.indexOf("data:") !== 0 && url.indexOf("blob:") !== 0) {
              img.crossOrigin = "anonymous";
            }
            img.onload = function () {
              resolve({ idx: idx, num: num, img: img });
            };
            img.onerror = function () {
              resolve({ idx: idx, num: num, img: null });
            };
            img.src = url;
          })
        );
      })(i, nums[i]);
    }
    return Promise.all(jobs).then(function (rows) {
      var spellImages = [];
      rows.forEach(function (row) {
        if (row.img) spellImages[row.idx] = row.img;
      });
      return spellImages;
    });
  }

  function buildStasisVideofyPlan(vision, outW, outH, stasisText, nums) {
    nums = nums || equippedNums();
    var iw = vision.naturalWidth || vision.width;
    var ih = vision.naturalHeight || vision.height;
    var coverScale = Math.max(outW / iw, outH / ih);
    var dw = iw * coverScale;
    var dh = ih * coverScale;
    var dx = (outW - dw) / 2;
    var dy = (outH - dh) / 2;
    var cover = { dx: dx, dy: dy, dw: dw, dh: dh };
    var meta = collectCombinedMeta(nums);
    var buzz = collectBuzzForEquipped();
    var subjects = parseStasisSubjects(stasisText, nums);
    if (subjects.length < 2) {
      subjects = [String(stasisText || "Fused stasis").slice(0, 120)];
    }
    var layerScale = Math.min(1, 520 / Math.max(dw, dh));
    var layer = document.createElement("canvas");
    layer.width = Math.ceil(dw * layerScale);
    layer.height = Math.ceil(dh * layerScale);
    var lctx = layer.getContext("2d");
    lctx.drawImage(vision, 0, 0, iw, ih, 0, 0, layer.width, layer.height);

    var layerCount = Math.min(VIDEIFY_MAX_LAYERS, Math.max(2, subjects.length));
    var layers = [];
    for (var i = 0; i < layerCount; i++) {
      var sprite = createSubjectBandSprite(layer, layer.width, layer.height, i, layerCount);
      var bandH = dh / layerCount;
      var homeCy = dy + bandH * (i + 0.5);
      var analysis = getAnalysis(nums[i]);
      layers.push({
        sprite: sprite,
        subject: subjects[i] || subjects[0],
        spellNum: nums[i] || 0,
        slot: ["I", "II", "III"][i] || String(i + 1),
        style: (analysis && analysis.style) || "",
        tags: (analysis && analysis.tags) || [],
        homeCx: cover.dx + cover.dw / 2,
        homeCy: homeCy,
        bw: sprite.width,
        bh: sprite.height,
        index: i,
        seed: videofyHashStr(subjects[i] + String(nums[i])) / 4294967295,
        phase: (videofyHashStr(subjects[i]) % 628) / 100,
        hue: (videofyHashStr(String(nums[i])) % 48) - 24,
      });
    }

    var tokens = buildVideofyTokens(nums, meta, subjects, stasisText);
    var salientRegions = videofyLabelRegions(
      videofyPruneSalientRegions(videofyScanSalientRegions(layer, 5)),
      tokens
    );
    var contentMode = videofyResolveContentMode(stasisText, meta, subjects);
    var talkers =
      contentMode === "people" ? videofyBuildTalkers(subjects, salientRegions, tokens, stasisText) : [];

    return {
      cover: cover,
      layers: layers,
      subjects: subjects.slice(0, layerCount),
      title: parseStasisVideofyTitle(stasisText),
      stasisExcerpt: String(stasisText || "").replace(/\s+/g, " ").trim(),
      palette: videofyPalette(buzz, stasisText),
      meta: meta,
      buzz: buzz,
      tokens: tokens,
      contentMode: contentMode,
      salientRegions: salientRegions,
      talkers: talkers,
      nums: nums.slice(0, 3),
      spellImages: [],
    };
  }

  function videofyTimelineState(t, plan, settings) {
    settings = settings || VIDEIFY_SETTINGS_DEFAULT;
    var tokens = plan.tokens || [];
    var n = Math.max(1, tokens.length);
    var pace = 0.35 + videofyNorm(settings.tokenPace) * 1.45;
    var pulseSp = 0.18 + videofyNorm(settings.pulseSpeed) * 0.95;
    var run = t * n * pace;
    var idx = Math.floor(run) % n;
    var local = run - Math.floor(run);
    var smooth = videofySmooth(local);
    var prev = tokens[(idx + n - 1) % n] || null;
    var next = tokens[(idx + 1) % n] || null;
    var active = tokens[idx] || null;
    return {
      tokenIndex: idx,
      tokenLocal: local,
      tokenSmooth: smooth,
      activeToken: active,
      prevToken: prev,
      nextToken: next,
      globalPhase: t,
      chaos: videofyTokenChaos(active, smooth),
      invertPulse: 1 - smooth,
      breathe: videofyBreathe(t, 0.65 * pulseSp, 0.2),
      swell: videofySmoothPulse(t, 0.45 * pulseSp, 0.5),
      beat: videofySmoothPulse(t, 0.45 * pulseSp, 0.5),
    };
  }

  function videofySpellWeights(state, spellCount) {
    var w = [];
    var i;
    for (i = 0; i < spellCount; i++) w[i] = 0.05;
    if (!spellCount) return w;
    var tok = state.activeToken;
    var focus = tok ? tok.spellIdx % spellCount : 0;
    var next = (focus + 1) % spellCount;
    var ease = state.tokenSmooth;
    if (tok && tok.invert) {
      focus =
        (focus + 1 + Math.floor((state.tokenLocal + state.tokenIndex * 0.19) * spellCount)) %
        spellCount;
      next = (focus + 2) % spellCount;
      ease = videofySmooth(Math.abs(Math.sin(state.tokenLocal * Math.PI * 2)));
    }
    for (i = 0; i < spellCount; i++) {
      if (i === focus) w[i] = 0.1 + (1 - ease) * 0.75;
      else if (i === next) w[i] = 0.1 + ease * 0.75;
    }
    var sum = 0;
    for (i = 0; i < spellCount; i++) sum += w[i];
    if (sum > 0) for (i = 0; i < spellCount; i++) w[i] /= sum;
    return w;
  }

  function getVideofyAnalysis(vision, outW, outH, stasisText, nums) {
    stasisText = stasisText || g.stasisText || "";
    nums = nums || equippedNums();
    var key = videofyPlanKey(vision, stasisText, nums);
    if (g._videofyAnalysis && g._videofyAnalysis.key === key) {
      return g._videofyAnalysis.data;
    }
    var data = buildStasisVideofyPlan(vision, outW, outH, stasisText, nums);
    g._videofyAnalysis = { key: key, data: data };
    return data;
  }

  function videofyCoverRect(img, w, h, zoom, panX, panY) {
    var iw = img.naturalWidth || img.width;
    var ih = img.naturalHeight || img.height;
    var scale = Math.max(w / iw, h / ih) * (zoom || 1);
    var dw = iw * scale;
    var dh = ih * scale;
    return {
      dx: (w - dw) / 2 + (panX || 0),
      dy: (h - dh) / 2 + (panY || 0),
      dw: dw,
      dh: dh,
      iw: iw,
      ih: ih,
    };
  }

  function drawVideofyCover(ctx, w, h, img, alpha, zoom, panX, panY, filterStr) {
    if (!img || alpha < 0.02) return;
    var r = videofyCoverRect(img, w, h, zoom, panX, panY);
    ctx.save();
    ctx.globalAlpha = alpha;
    if (filterStr) ctx.filter = filterStr;
    ctx.drawImage(img, r.dx, r.dy, r.dw, r.dh);
    ctx.restore();
  }

  function drawMeshWarpedImage(ctx, w, h, img, t, amp, zoom, panX, panY, seed, strips) {
    if (!img || !img.complete) return;
    var r = videofyCoverRect(img, w, h, zoom, panX, panY);
    strips = strips || 14;
    var sh = r.ih / strips;
    var dhStrip = r.dh / strips;
    var phase = t * Math.PI * 2;
    for (var row = 0; row < strips; row++) {
      var sy = row * sh;
      var hh = row === strips - 1 ? r.ih - sy : sh;
      var wave =
        Math.sin(phase * 1.15 + row * 0.45 + seed * 9) * amp +
        Math.cos(phase * 0.85 + row * 0.3) * amp * 0.38;
      var drip = Math.sin(phase * 0.7 + row * 0.18) * amp * 0.22;
      ctx.drawImage(img, 0, sy, r.iw, hh, r.dx + wave, r.dy + row * dhStrip + drip, r.dw, dhStrip + 1);
    }
  }

  function drawVideofySpellMorph(ctx, w, h, t, plan, state, settings) {
    settings = settings || VIDEIFY_SETTINGS_DEFAULT;
    var morphN = videofyNorm(settings.spellMorph);
    if (morphN < 0.03) return;
    var imgs = plan.spellImages || [];
    var count = imgs.length;
    if (!count) return;
    var weights = videofySpellWeights(state, count);
    var motionN = videofyNorm(settings.motion);
    var chaos = state.chaos || 0;
    var drift = (state.globalPhase - 0.5) * w * 0.08 * motionN * (1 + chaos * 0.55);
    for (var i = 0; i < count; i++) {
      if (!imgs[i] || weights[i] < 0.04) continue;
      var offX =
        drift * (i - (count - 1) / 2) +
        Math.sin(t * Math.PI * 2 * (0.55 + chaos * 0.9) + i) * w * 0.028 * motionN * (1 + chaos * 0.4);
      var offY =
        Math.cos(t * Math.PI * 2 * (0.45 + chaos * 0.7) + i) * h * 0.02 * motionN * (1 + chaos * 0.35);
      var scale =
        1 +
        state.globalPhase * 0.08 * motionN +
        weights[i] * 0.1 * morphN +
        chaos * state.invertPulse * 0.06;
      var hue = (videofyHashStr(String(plan.nums[i])) % 30) - 15;
      var hueFlip = chaos > 0.42 ? 165 * state.invertPulse : 0;
      drawVideofyCover(
        ctx,
        w,
        h,
        imgs[i],
        weights[i] * 0.55 * morphN * (1 + chaos * 0.15),
        scale,
        offX,
        offY,
        "saturate(" +
          (0.75 + weights[i] * 0.55 * morphN + chaos * 0.25) +
          ") hue-rotate(" +
          (hue * state.tokenSmooth + hueFlip) +
          "deg) contrast(" +
          (1 + chaos * 0.28) +
          ")"
      );
    }
  }

  function subjectLayerPose(layer, t, w, h, state, fx, settings) {
    settings = settings || VIDEIFY_SETTINGS_DEFAULT;
    var subjN = videofyNorm(settings.subjectMotion);
    var motionN = videofyNorm(settings.motion);
    var phase = t * Math.PI * 2 * (1.4 + layer.index * 0.35) * (0.35 + motionN * 0.65) + layer.phase;
    var tok = state.activeToken;
    var chaos = state.chaos || 0;
    var isSpellFocus = tok && tok.spellIdx === layer.index;
    if (tok && tok.invert) {
      isSpellFocus =
        tok.spellIdx !== layer.index && (layer.index + state.tokenIndex + Math.floor(chaos * 3)) % 2 === 0;
    }
    var swell = state.swell || 0.5;
    var focusBlend = isSpellFocus ? state.tokenSmooth : 1 - state.tokenSmooth * 0.45;
    if (tok && tok.invert) {
      focusBlend = isSpellFocus ? state.invertPulse : 1 - state.invertPulse * 0.55;
    }
    var orbitR =
      Math.min(w, h) *
      (0.09 + focusBlend * 0.12 + swell * 0.04 + chaos * 0.08) *
      (0.2 + subjN * 0.8) *
      (1 + chaos * 0.35);
    var ang = phase * (0.95 + layer.index * 0.22) + layer.seed * 6;
    var mx = (Math.cos(ang) * orbitR + (layer.index - 1) * w * 0.08 * Math.sin(phase * 0.55)) * subjN;
    var my =
      (Math.sin(ang * 0.85) * orbitR * 0.72 - Math.sin(phase * 0.65) * h * (0.05 + focusBlend * 0.08)) * subjN;
    if (fx.swirl) {
      mx += Math.cos(phase * 1.1) * w * 0.05 * subjN;
      my += Math.sin(phase * 1.1) * h * 0.05 * subjN;
    }
    return {
      x: layer.homeCx + mx,
      y: layer.homeCy + my,
      rot:
        Math.sin(phase * 0.55) * (0.12 + focusBlend * 0.14) * subjN + (layer.index - 1) * 0.08 * subjN,
      scale:
        0.88 +
        focusBlend * 0.14 * videofyBreathe(t, 0.5 + layer.index * 0.1, layer.phase) * subjN +
        swell * 0.04 * subjN,
      alpha: 0.35 + focusBlend * 0.38 * subjN,
    };
  }

  function drawSubjectLayer(ctx, layer, t, w, h, state, fx, settings) {
    if (!layer.sprite) return;
    var pose = subjectLayerPose(layer, t, w, h, state, fx, settings);
    var phase = t * Math.PI * 2 + layer.phase;
    ctx.save();
    ctx.globalAlpha = pose.alpha;
    ctx.translate(pose.x, pose.y);
    ctx.rotate(pose.rot);
    ctx.scale(pose.scale, pose.scale);
    if (layer.hue) {
      ctx.filter =
        "hue-rotate(" + layer.hue * Math.sin(phase * 0.35) * 0.6 + "deg) saturate(" + (1.05 + state.swell * 0.12) + ")";
    }
    var strips = fx.ripple ? 7 : 5;
    var sh = Math.ceil(layer.bh / strips);
    for (var row = 0; row < strips; row++) {
      var y0 = row * sh;
      var hh = Math.min(sh, layer.bh - y0);
      var wave =
        Math.sin(phase * 1.4 + row * 0.55 + layer.seed * 7) *
        (fx.ripple ? 10 : 6) *
        videofyNorm((settings || VIDEIFY_SETTINGS_DEFAULT).subjectMotion);
      ctx.drawImage(layer.sprite, 0, y0, layer.bw, hh, wave, y0 - layer.bh / 2, layer.bw, hh);
    }
    ctx.restore();
  }

  function drawVideofyParticleBurst(ctx, w, h, t, pal, seed, intensity) {
    if (intensity < 0.2) return;
    var n = Math.floor(28 * intensity);
    for (var p = 0; p < n; p++) {
      var bx = (videofyHashStr("p" + seed + p) % 1000) / 1000;
      var by = (videofyHashStr("q" + seed + p) % 1000) / 1000;
      var px = ((bx + t * (0.018 + (p % 4) * 0.003)) % 1) * w;
      var py = ((by + t * (0.012 + (p % 3) * 0.002)) % 1) * h;
      var rgb = pal[p % pal.length] || [200, 180, 220];
      var twinkle = 0.15 + 0.85 * videofySmoothPulse(t + p * 0.04, 0.22 + (p % 5) * 0.04, p);
      ctx.fillStyle = "rgba(" + rgb.join(",") + "," + (0.12 + twinkle * 0.22) + ")";
      ctx.fillRect(px, py, 1 + (p % 2), 1 + (p % 2));
    }
  }

  function drawVideofyBuzzOverlay(ctx, w, h, t, state, fx, pal, overlayN) {
    overlayN = overlayN != null ? overlayN : 0.4;
    if (overlayN < 0.03) return;
    var pulse = state.swell || 0.5;
    var breathe = state.breathe || 0.5;
    var fxScale = videofyClamp(overlayN * 2.2, 0, 1);
    if (fx.swirl) {
      ctx.save();
      ctx.globalAlpha = (0.05 + pulse * 0.04) * fxScale;
      ctx.strokeStyle = "rgba(200,180,255,0.42)";
      ctx.lineWidth = 1;
      for (var s = 0; s < 2; s++) {
        ctx.beginPath();
        ctx.arc(
          w * (0.38 + state.globalPhase * 0.22),
          h * 0.5,
          (34 + s * 32) * (0.75 + breathe * 0.15),
          0,
          Math.PI * 2 * (0.15 + t * 0.55)
        );
        ctx.stroke();
      }
      ctx.restore();
    }
    if (fx.ripple) {
      ctx.strokeStyle = "rgba(200,220,255," + (0.06 + pulse * 0.05) * fxScale + ")";
      ctx.lineWidth = 1;
      var step = 28;
      var wave = t * Math.PI * 2 * 0.75;
      for (var y = 0; y < h; y += step) {
        ctx.beginPath();
        for (var x = 0; x <= w; x += 18) {
          var yy = y + Math.sin(wave + x * 0.01) * 6;
          if (x === 0) ctx.moveTo(x, yy);
          else ctx.lineTo(x, yy);
        }
        ctx.stroke();
      }
    }
    if (fx.glow && pal.length) {
      var rgb = videofyPaletteAt(pal, t);
      var grd = ctx.createRadialGradient(w / 2, h * 0.45, 0, w / 2, h * 0.45, Math.max(w, h) * 0.62);
      grd.addColorStop(0, "rgba(" + rgb.join(",") + "," + (0.12 + pulse * 0.1) * fxScale + ")");
      grd.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = grd;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
    }
    if (fx.vignette) {
      var vig = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.2, w / 2, h / 2, Math.max(w, h) * 0.85);
      vig.addColorStop(0, "rgba(0,0,0,0)");
      vig.addColorStop(1, "rgba(0,0,0," + (0.38 + breathe * 0.12) * fxScale + ")");
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, w, h);
    }
    drawVideofyParticleBurst(
      ctx,
      w,
      h,
      t,
      pal,
      videofyHashStr(state.activeToken && state.activeToken.word),
      pulse * 0.75 * fxScale
    );
  }

  function drawVideofyMiniCaption(ctx, w, h, plan, state) {
    var tok = state.activeToken;
    if (!tok) return;
    var chaos = state.chaos || 0;
    var word = tok.word.length > 40 ? tok.word.slice(0, 37) + "…" : tok.word;
    var prefix =
      tok.kind === "stasis" ? "stasis ≠ " : tok.kind === "style" ? "style ≠ " : tok.kind === "tag" ? "tag ≠ " : "≠ ";
    var label = prefix + word;
    var slide = Math.sin(state.globalPhase * Math.PI * 2 * (0.4 + chaos * 1.1)) * (3 + chaos * 5);
    ctx.save();
    ctx.globalAlpha = 0.58 + state.invertPulse * 0.28;
    ctx.fillStyle = "rgba(8,7,10,0.5)";
    ctx.fillRect(0, h - 28, w, 28);
    ctx.font = "bold 10px Courier New, monospace";
    ctx.textAlign = "left";
    ctx.fillStyle =
      "rgba(" +
      Math.floor(255 - chaos * 90) +
      "," +
      Math.floor(110 + chaos * 70) +
      "," +
      Math.floor(170 + chaos * 50) +
      ",0.9)";
    ctx.fillText(label, 12 + slide, h - 10);
    ctx.restore();
  }

  function drawMuralwalkVideofyFrame(ctx, w, h, t, vision, plan, stasisText, buzz, settings) {
    settings = settings || getVideofySettings();
    var pals = plan.palette || videofyPalette(buzz, stasisText);
    var state = videofyTimelineState(t, plan, settings);
    var tokWord = (state.activeToken && state.activeToken.word) || "anti-stasis";
    var chaos = state.chaos || 0;
    var fxBase = videofyActiveEffects(plan.buzz || buzz, stasisText, tokWord);
    var fx = videofyInvertedEffects(fxBase, chaos);
    var bg = videofyPaletteAt(pals, t + chaos * 0.18);
    var breathe = state.breathe || 0.5;
    var swell = state.swell || 0.5;
    var anim = t * Math.PI * 2;
    var motionN = videofyNorm(settings.motion);
    var warpN = videofyNorm(settings.warp);
    var visionN = videofyNorm(settings.visionHold);
    var overlayN = videofyNorm(settings.overlays);
    var contentMode = plan.contentMode || "scene";
    var contentFocus = contentMode === "people" || contentMode === "scene";
    var warpAmp =
      (4 + swell * 7 + state.invertPulse * 6) *
      (0.12 + warpN * 0.88) *
      (0.35 + motionN * 0.65) *
      (contentFocus ? 0.22 : 1 + chaos * 0.75);
    var zoom =
      1.01 + breathe * 0.03 * motionN + state.globalPhase * 0.02 * motionN + chaos * state.invertPulse * 0.04;
    var panX =
      Math.sin(anim * (0.42 + chaos * 0.85)) * w * 0.028 * motionN +
      Math.sin(anim * 2.2 + state.tokenIndex) * w * 0.018 * chaos;
    var panY =
      Math.cos(anim * (0.35 + chaos * 0.7)) * h * 0.02 * motionN +
      Math.cos(anim * 1.7 + state.tokenIndex * 0.6) * h * 0.014 * chaos;

    ctx.fillStyle = "rgb(" + Math.floor(bg[0] * 0.09) + "," + Math.floor(bg[1] * 0.09) + "," + Math.floor(bg[2] * 0.11) + ")";
    ctx.fillRect(0, 0, w, h);

    var seed = videofyHashStr(stasisText);
    if (!contentFocus) {
      for (var i = 0; i < Math.min(pals.length, 3); i++) {
        var rgb = videofyPaletteAt(pals, t + i * 0.08);
        var px = w * (0.18 + 0.64 * (((i + seed) % 97) / 97));
        var py = h * (0.22 + 0.56 * (((i * 1.7 + seed) % 89) / 89));
        var grd = ctx.createRadialGradient(px, py, 0, px, py, Math.min(w, h) * (0.3 + breathe * 0.06));
        grd.addColorStop(0, "rgba(" + rgb.join(",") + ",0.18)");
        grd.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = grd;
        ctx.fillRect(0, 0, w, h);
      }
    }

    if (!contentFocus) {
      drawVideofySpellMorph(ctx, w, h, t, plan, state, settings);
    }

    if (vision && vision.complete) {
      if (contentFocus) {
        ctx.save();
        ctx.globalAlpha = 0.88 + visionN * 0.1;
        drawVideofyCover(ctx, w, h, vision, 1, 1, 0, 0, "contrast(1.04) saturate(1.05)");
        ctx.restore();
      } else {
        ctx.save();
        ctx.globalAlpha = 0.32 + visionN * 0.52 + swell * 0.08 * visionN;
        drawMeshWarpedImage(ctx, w, h, vision, t, warpAmp, zoom, panX, panY, seed * 0.001, 14);
        ctx.restore();
        ctx.save();
        ctx.globalCompositeOperation = "soft-light";
        ctx.globalAlpha = (0.08 + state.tokenSmooth * 0.06) * visionN;
        drawMeshWarpedImage(
          ctx,
          w,
          h,
          vision,
          t + 0.012,
          warpAmp * 0.55,
          zoom * 1.02,
          -panX * 0.6,
          -panY * 0.6,
          seed * 0.001 + 2,
          10
        );
        ctx.restore();
        ctx.save();
        ctx.globalAlpha = (0.06 + breathe * 0.05) * visionN;
        drawVideofyCover(
          ctx,
          w,
          h,
          vision,
          1,
          zoom * (1.01 + visionN * 0.02),
          panX * 0.25,
          panY * 0.25,
          "contrast(1.08) saturate(" + (1.08 + swell * 0.1 * visionN) + ")"
        );
        ctx.restore();
      }
    }

    if (contentMode === "people") {
      drawVideofyTalkers(ctx, w, h, t, vision, plan, state);
    } else {
      drawVideofySceneSpotlights(ctx, w, h, t, vision, plan, state);
    }

    if (!contentFocus) {
      var layers = plan.layers || [];
      for (var li = 0; li < layers.length; li++) {
        drawSubjectLayer(ctx, layers[li], t, w, h, state, fx, settings);
      }
      drawVideofyBuzzOverlay(ctx, w, h, t, state, fx, pals, overlayN);
    } else {
      drawVideofyBuzzOverlay(ctx, w, h, t, state, fx, pals, overlayN * 0.35);
    }

    if (settings.showCaption) {
      drawVideofyMiniCaption(ctx, w, h, plan, state);
    }
  }

  function preferredVideofyMime() {
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return "";
    var types = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
    for (var i = 0; i < types.length; i++) {
      if (MediaRecorder.isTypeSupported(types[i])) return types[i];
    }
    return "";
  }

  function videofyYield() {
    return new Promise(function (resolve) {
      requestAnimationFrame(function () {
        setTimeout(resolve, 0);
      });
    });
  }

  function videofyCaptureFrame(stream) {
    if (!stream) return;
    var tracks = stream.getVideoTracks();
    if (tracks.length && typeof tracks[0].requestFrame === "function") {
      try {
        tracks[0].requestFrame();
      } catch (err) {}
    }
  }

  function videofyFixWebmBlob(blob, durationSec, mime) {
    durationSec = durationSec || VIDEIFY_DURATION_SEC;
    var durationMs = Math.round(durationSec * 1000);
    if (!window.ysFixWebmDuration) {
      return Promise.resolve(blob);
    }
    return window.ysFixWebmDuration(blob, durationMs).then(function (fixed) {
      return fixed || blob;
    });
  }

  function videofyRevokeMp4Url() {
    if (g._videofyLastMp4Url) {
      try {
        URL.revokeObjectURL(g._videofyLastMp4Url);
      } catch (err) {}
      g._videofyLastMp4Url = null;
    }
    g._videofyLastMp4Blob = null;
  }

  function videofyConvertToMp4(webmBlob, durationSec) {
    videofyRevokeMp4Url();
    if (!window.VideofyExport || !window.VideofyExport.toMp4) {
      return Promise.resolve(URL.createObjectURL(webmBlob));
    }
    setVideofyStatus("Converting to MP4…", true);
    return window.VideofyExport.toMp4(webmBlob, {
      onStatus: function (msg, show) {
        setVideofyStatus(msg, show !== false);
      },
    })
      .then(function (mp4Blob) {
        g._videofyLastMp4Blob = mp4Blob;
        g._videofyLastMp4Url = URL.createObjectURL(mp4Blob);
        return g._videofyLastMp4Url;
      })
      .catch(function (err) {
        setVideofyStatus(
          (err && err.message) || "MP4 conversion failed — showing WebM preview.",
          true
        );
        return URL.createObjectURL(webmBlob);
      });
  }

  function videofyFinalizeBlobUrl(blob, durationSec, mime) {
    return videofyFixWebmBlob(blob, durationSec, mime).then(function (fixedBlob) {
      g._videofyLastBlob = fixedBlob;
      return videofyConvertToMp4(fixedBlob, durationSec);
    });
  }

  function updateVideofyExportUi(hasBlob) {
    var wrap = $("mw-stasis-video-exports");
    var tt = $("mw-export-tiktok");
    var yt = $("mw-export-youtube");
    var busy = !!g._videofyExporting;
    var ready = !!hasBlob && !busy && !!window.VideofyExport;
    if (wrap) wrap.hidden = !hasBlob;
    if (tt) {
      tt.disabled = !ready;
      tt.textContent = busy && tt.dataset.busyPlatform === "tiktok" ? "TikTok…" : "TikTok";
    }
    if (yt) {
      yt.disabled = !ready;
      yt.textContent = busy && yt.dataset.busyPlatform === "youtube" ? "YouTube…" : "YouTube";
    }
  }

  function exportVideofyToPlatform(platform) {
    if (!g._videofyLastBlob || g._videofyExporting || !window.VideofyExport) {
      setVideofyStatus("Videofy a stasis video first.", true);
      return;
    }
    var tt = $("mw-export-tiktok");
    var yt = $("mw-export-youtube");
    g._videofyExporting = true;
    if (tt) tt.dataset.busyPlatform = platform === "tiktok" ? "tiktok" : "";
    if (yt) yt.dataset.busyPlatform = platform === "youtube" ? "youtube" : "";
    updateVideofyExportUi(true);

    window.VideofyExport.export(platform, g._videofyLastBlob, {
      title: g.stasisTitle || "Muralwalk stasis",
      onStatus: function (msg, show) {
        setVideofyStatus(msg, show !== false);
      },
    })
      .catch(function (err) {
        setVideofyStatus((err && err.message) || "Export failed — try Download MP4.", true);
      })
      .finally(function () {
        g._videofyExporting = false;
        if (tt) tt.dataset.busyPlatform = "";
        if (yt) yt.dataset.busyPlatform = "";
        updateVideofyExportUi(!!g._videofyLastBlob);
      });
  }

  function bindVideofyExports() {
    var tt = $("mw-export-tiktok");
    var yt = $("mw-export-youtube");
    if (tt && !tt.dataset.bound) {
      tt.dataset.bound = "1";
      tt.addEventListener("click", function () {
        exportVideofyToPlatform("tiktok");
      });
    }
    if (yt && !yt.dataset.bound) {
      yt.dataset.bound = "1";
      yt.addEventListener("click", function () {
        exportVideofyToPlatform("youtube");
      });
    }
    updateVideofyExportUi(!!g._videofyLastBlob);
  }

  function recordMuralwalkVideofy(canvas, drawFrame, durationSec, fps, onProgress) {
    durationSec = durationSec || VIDEIFY_DURATION_SEC;
    fps = fps || VIDEIFY_FPS;
    if (!window.MediaRecorder || !canvas.captureStream) {
      return Promise.reject(new Error("Video export not supported in this browser."));
    }

    g._videofyRecording = true;
    canvas.classList.add("mw-videofy-recording");
    var stream = canvas.captureStream(fps);
    var mime = preferredVideofyMime();
    var recorder;
    try {
      recorder = mime
        ? new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 3500000 })
        : new MediaRecorder(stream);
    } catch (err) {
      g._videofyRecording = false;
      canvas.classList.remove("mw-videofy-recording");
      return Promise.reject(err);
    }

    return new Promise(function (resolve, reject) {
      var chunks = [];
      var frame = 0;
      var totalFrames = Math.round(durationSec * fps);
      var intervalMs = 1000 / fps;
      var timer = null;
      var stopped = false;

      function cleanup() {
        if (timer) clearInterval(timer);
        g._videofyRecording = false;
        canvas.classList.remove("mw-videofy-recording");
        stream.getTracks().forEach(function (tr) {
          tr.stop();
        });
      }

      recorder.ondataavailable = function (ev) {
        if (ev.data && ev.data.size) chunks.push(ev.data);
      };
      recorder.onerror = function () {
        stopped = true;
        cleanup();
        reject(new Error("Video recording failed."));
      };
      recorder.onstop = function () {
        cleanup();
        if (!chunks.length) {
          reject(new Error("Video recording produced no frames."));
          return;
        }
        var blob = new Blob(chunks, { type: mime || "video/webm" });
        videofyFinalizeBlobUrl(blob, durationSec, mime).then(resolve).catch(function () {
          resolve(URL.createObjectURL(blob));
        });
      };

      recorder.start(Math.max(100, Math.round(1000 / fps)));
      drawFrame(0);
      videofyCaptureFrame(stream);

      timer = setInterval(function () {
        if (stopped) return;
        frame++;
        if (frame >= totalFrames) {
          stopped = true;
          clearInterval(timer);
          timer = null;
          drawFrame(1);
          videofyCaptureFrame(stream);
          if (onProgress) onProgress(totalFrames, totalFrames);
          setTimeout(function () {
            try {
              if (recorder.state === "recording" && recorder.requestData) {
                recorder.requestData();
              }
            } catch (e1) {}
            setTimeout(function () {
              try {
                stream.getVideoTracks().forEach(function (tr) {
                  tr.stop();
                });
                recorder.stop();
              } catch (e2) {
                cleanup();
                reject(e2);
              }
            }, 280);
          }, intervalMs);
          return;
        }
        var t = frame / Math.max(1, totalFrames - 1);
        drawFrame(t);
        videofyCaptureFrame(stream);
        if (onProgress && frame % 8 === 0) {
          onProgress(frame, totalFrames);
        }
      }, intervalMs);
    });
  }

  function buildMuralwalkVideofy() {
    var canvas = $("mw-stasis-video-canvas");
    var vision = g.fusion.visionImg;
    if (!canvas || !vision || !vision.complete || equippedNums().length < 2) {
      return Promise.reject(new Error("Stasis vision not ready."));
    }

    var buzz = collectBuzzForEquipped();
    var stasisText = g.stasisText;
    var nums = equippedNums();
    var vctx = canvas.getContext("2d");

    return videofyYield()
      .then(function () {
        setVideofyStatus("Loading spell layers…", true);
        return loadVideofySpellImages(nums);
      })
      .then(function (spellImages) {
        var plan = getVideofyAnalysis(vision, canvas.width, canvas.height, stasisText, nums);
        plan.spellImages = spellImages;
        var settings = getVideofySettings();
        var durationSec = settings.duration || VIDEIFY_DURATION_SEC;
        var modeLabel =
          plan.contentMode === "people" ? "talking figures" : "scene spotlights";
        setVideofyStatus("Rendering " + durationSec + "s " + modeLabel + "…", true);
        return recordMuralwalkVideofy(
          canvas,
          function (t) {
            drawMuralwalkVideofyFrame(
              vctx,
              canvas.width,
              canvas.height,
              t,
              vision,
              plan,
              stasisText,
              buzz,
              settings
            );
          },
          durationSec,
          VIDEIFY_FPS,
          function (frame, total) {
            setVideofyStatus("Rendering stasis animation… " + frame + "/" + total, true);
          }
        );
      });
  }

  function updateStasisActionButtons() {
    var ready = stasisVisionReady();
    var busy = stasisActionsBusy();
    var nums = equippedNums();
    var hasStasis = !!g.stasisText.trim();
    var canAct = nums.length >= 2 && hasStasis && !busy;
    var reBtn = $("mw-stasis-reimagine");
    var defBtn = $("mw-stasis-redefine");
    var fsBtn = $("mw-stasis-fullscreen");
    var saveBtn = $("mw-stasis-save-image");
    var vidBtn = $("mw-stasis-videofy");
    if (reBtn) {
      reBtn.textContent = "Reimagine (" + REIMAGINE_COST + ")";
      reBtn.disabled =
        !canAct || !canAffordReimagine() || !window.StasisFloorGen;
      reBtn.title = canAffordReimagine()
        ? "New stasis image — " + REIMAGINE_COST + " orbs"
        : "Need " + REIMAGINE_COST + " orbs";
    }
    if (defBtn) {
      if (defBtn.dataset.busy !== "1") {
        defBtn.textContent = "Redefine (" + REDEFINE_COST + ")";
      }
      defBtn.disabled =
        nums.length < 2 ||
        !hasStasis ||
        !canAffordRedefine() ||
        busy ||
        !window.StasisFloorGen ||
        !window.StasisFloorGen.redefineStasis ||
        defBtn.dataset.busy === "1";
      defBtn.title = canAffordRedefine()
        ? "Reword stasis prompt — " + REDEFINE_COST + " orbs"
        : "Need " + REDEFINE_COST + " orbs";
    }
    if (fsBtn) fsBtn.disabled = !ready;
    if (saveBtn) {
      saveBtn.disabled = !hasVisionFloor() || isPlayerStasisSaved();
      saveBtn.title = isPlayerStasisSaved()
        ? "Center auto-saved → saved-stasis/"
        : hasVisionFloor()
          ? "Center saves automatically when painted"
          : "Paint center stasis first";
    }
    if (vidBtn) vidBtn.disabled = !ready || !canAct || !canBuildStasisVideo();
    var printBtn = $("mw-stasis-tabloid-print");
    if (printBtn) printBtn.disabled = !hasVisionFloor();
  }

  function setVideofyStatus(msg, show) {
    var el = $("mw-stasis-video-status");
    if (!el) return;
    el.hidden = !show;
    if (show && msg) el.textContent = msg;
  }

  function showMuralwalkVideo(blobUrl, expectedSec) {
    var video = $("mw-stasis-video");
    var dl = $("mw-stasis-video-download");
    updateVideofyExportUi(!!g._videofyLastBlob);
    if (video) {
      video.onloadedmetadata = function () {
        var dur = video.duration;
        if (!isFinite(dur) || dur <= 0) {
          setVideofyStatus(
            "Video metadata still odd — try Videofy again.",
            true
          );
          return;
        }
        if (expectedSec && dur > expectedSec * 4) {
          setVideofyStatus(
            "Duration looks wrong (" +
              Math.round(dur) +
              "s) — try Videofy again.",
            true
          );
          return;
        }
        var fmt = g._videofyLastMp4Blob ? "MP4" : "WebM";
        setVideofyStatus(
          fmt + " ready — " + dur.toFixed(1) + "s. Download or use TikTok/YouTube to upload.",
          true
        );
        setTimeout(function () {
          setVideofyStatus("", false);
        }, VIDEIFY_STATUS_DISMISS_MS);
      };
      video.src = blobUrl;
      video.hidden = false;
      try {
        video.load();
      } catch (err) {}
    }
    if (dl) {
      dl.href = blobUrl;
      var ext = g._videofyLastMp4Blob ? "mp4" : "webm";
      dl.download = "muralwalk-stasis-" + Math.round(expectedSec || VIDEIFY_DURATION_SEC) + "s." + ext;
      dl.textContent = g._videofyLastMp4Blob ? "Download MP4" : "Download WebM";
      dl.hidden = false;
    }
    if (!video) setVideofyStatus("", false);
  }

  function redefineStasis() {
    var nums = equippedNums();
    if (nums.length < 2 || !g.stasisText.trim()) return;
    if (!canAffordRedefine()) {
      setFloorStatus("Need " + REDEFINE_COST + " orbs to redefine stasis.");
      return;
    }
    if (
      g._redefinePromise ||
      g._reimaginePromise ||
      g._videofyPromise ||
      g.floorGenerating ||
      g._worldGenPromise
    ) {
      return;
    }
    if (!window.StasisFloorGen || !window.StasisFloorGen.redefineStasis) {
      return;
    }

    g.score -= REDEFINE_COST;
    saveWallet("spend", { action: "redefine", cost: REDEFINE_COST });
    updateScoreHud();

    var btn = $("mw-stasis-redefine");
    var prior = g.stasisText;
    var priorTitle = g.stasisTitle;
    mwRedefineCount += 1;
    g._redefinePromise = true;
    updateStasisActionButtons();

    if (btn) {
      btn.dataset.busy = "1";
      btn.disabled = true;
      btn.textContent = "Redefining…";
    }
    setMwRedefineStatus("Rewording fused stasis…", false);
    var readout = $("mw-stasis-readout");
    if (readout) readout.textContent = "Redefining stasis…";

    var healthRef = null;

    window.StasisFloorGen.checkHealth()
      .then(function (health) {
        healthRef = health;
        return window.StasisFloorGen.redefineStasis(
          nums,
          prior,
          mwRedefineCount,
          health,
          function (variant) {
            return localMixStasis(nums, variant);
          }
        );
      })
      .then(function (result) {
        var mixed = (result && result.mixed_description) || "";
        if (!mixed.trim()) throw new Error("Redefine returned empty text.");
        g.stasisText = mixed.trim();
        if (result && result.fused_title) g.stasisTitle = result.fused_title;
        g.stasisFromApi = true;
        g.stasisVariant += 1;
        g._floorRequestKey = "";
        g._previewKey = "";
        g._videofyAnalysis = null;
        layoutPropsPlaceholders();
        layoutWorldEntities();
        refreshReadouts();
        publishToSpellforge();
        markStasisPending();
        setMwRedefineStatus("Stasis text redefined.", false);
        g.spellShiftCount += 1;
        if (g.menuOpen) {
          setMenuStatus("Redefine done — stasis repaints when you close spellbook.", null);
        } else {
          regenerateStasisVision({
            quietStatus: true,
            outcomeMsg: "Stasis redefined.",
            unlockFloor: g.floorUnlocked,
            keepPreviousOnFail: hasVisionFloor(),
          });
        }
        setTimeout(function () {
          setMwRedefineStatus("", false);
        }, MW_REDEFINE_STATUS_DISMISS_MS);
      })
      .catch(function (err) {
        g.stasisText = prior;
        g.stasisTitle = priorTitle;
        g.score += REDEFINE_COST;
        saveWallet("refund", { action: "redefine", amount: REDEFINE_COST });
        updateScoreHud();
        refreshReadouts();
        setMwRedefineStatus((err && err.message) || "Redefine failed.", true);
        setFloorStatus("Redefine failed — orbs refunded.");
      })
      .finally(function () {
        g._redefinePromise = null;
        if (btn) {
          btn.dataset.busy = "";
          btn.textContent = "Redefine (" + REDEFINE_COST + ")";
        }
        updateHudLabel();
        updateStasisPreview();
        updateStasisActionButtons();
        ensureActionOrbs();
      });
  }

  function reimagineStasis() {
    var nums = equippedNums();
    if (nums.length < 2 || !g.stasisText.trim()) return;
    if (!canAffordReimagine()) {
      setFloorStatus("Need " + REIMAGINE_COST + " orbs to reimagine.");
      return;
    }
    if (visionRegenInflight()) return;
    if (!window.StasisFloorGen || !window.StasisFloorGen.generateVision) return;

    g.score -= REIMAGINE_COST;
    saveWallet("spend", { action: "reimagine", cost: REIMAGINE_COST });
    updateScoreHud();

    g._reimaginePromise = true;
    g.spellShiftCount += 1;
    regenerateStasisVision({
      quietStatus: true,
      outcomeMsg: "Stasis reimagined.",
      unlockFloor: g.floorUnlocked,
      keepPreviousOnFail: hasVisionFloor(),
      rejectOnFail: true,
    })
      .catch(function () {
        g.score += REIMAGINE_COST;
        saveWallet("refund", { action: "reimagine", amount: REIMAGINE_COST });
        updateScoreHud();
        setFloorStatus("Reimagine failed — orbs refunded.");
      })
      .finally(function () {
        g._reimaginePromise = null;
        updateHudLabel();
        updateStasisPreview();
        updateStasisActionButtons();
        ensureActionOrbs();
      });
  }

  function closeStasisVisionDialog() {
    var dlg = $("spell-stasis-vision-dialog");
    if (!dlg) return;
    g._stasisVisionGallery = null;
    if (window.galleryDialog && window.galleryDialog.close) {
      window.galleryDialog.close(dlg);
    } else if (typeof dlg.close === "function") {
      dlg.close();
    } else {
      dlg.removeAttribute("open");
      dlg.style.display = "none";
    }
  }

  function hudIdxForGalleryKey(key) {
    for (var i = 0; i < MOSAIC_HUD_GRID.length; i++) {
      if (MOSAIC_HUD_GRID[i] === key) return i;
    }
    return 4;
  }

  function visionUrlForGallerySlot(slot) {
    if (!slot) return "";
    if (slot.isCenter) {
      var centerUrl = g.fusion.visionUrl || g.fusion._url || "";
      if (
        !centerUrl &&
        g.fusion.visionImg &&
        g.fusion.visionImg.complete &&
        g.fusion.visionImg.naturalWidth
      ) {
        centerUrl = g.fusion.visionImg.src || "";
      }
      if (!centerUrl && slot.cell) {
        centerUrl = slot.cell.visionUrl || "";
        if (
          !centerUrl &&
          slot.cell.visionImg &&
          slot.cell.visionImg.complete &&
          slot.cell.visionImg.naturalWidth
        ) {
          centerUrl = slot.cell.visionImg.src || "";
        }
        if (!centerUrl && slot.cell.visionImg && slot.cell.visionImg.complete) {
          centerUrl = mosaicCellThumbUrl(slot.cell) || "";
        }
      }
      return centerUrl;
    }
    if (!slot.cell) return "";
    var url = slot.cell.visionUrl || "";
    if (
      !url &&
      slot.cell.visionImg &&
      slot.cell.visionImg.complete &&
      slot.cell.visionImg.naturalWidth
    ) {
      url = slot.cell.visionImg.src || "";
    }
    if (!url && slot.cell.visionImg && slot.cell.visionImg.complete) {
      url = mosaicCellThumbUrl(slot.cell) || "";
    }
    return url;
  }

  function gallerySlotHasVision(slot, url) {
    if (url) return true;
    if (!slot) return false;
    if (slot.isCenter && hasVisionFloor()) return true;
    if (slot.cell && slot.cell.status === "ready") return true;
    if (
      slot.cell &&
      slot.cell.visionImg &&
      slot.cell.visionImg.complete &&
      slot.cell.visionImg.naturalWidth
    ) {
      return true;
    }
    return false;
  }

  function spellNumsForGallerySlot(slot) {
    if (!slot) return [];
    if (slot.isCenter) return equippedNums().slice();
    if (slot.cell && slot.cell.spells && slot.cell.spells.length) {
      return slot.cell.spells.slice();
    }
    if (slot.enemy) return falloutSpellNums(slot.enemy);
    return [];
  }

  function refreshGalleryEntryVision(entry) {
    if (!entry) return entry;
    var slot = mosaicHudCellState(entry.key);
    var url = visionUrlForGallerySlot(slot);
    entry.url = url;
    entry.pending = !gallerySlotHasVision(slot, url);
    entry.spellNums = spellNumsForGallerySlot(slot);
    return entry;
  }

  function updateVisionDialogSpells(entry) {
    var wrap = $("spell-stasis-vision-spells");
    if (!wrap) return;
    entry = refreshGalleryEntryVision(entry);
    var nums = entry.spellNums || [];
    var hasAny = false;
    for (var i = 0; i < 3; i++) {
      var img = $("spell-stasis-vision-spell-" + i);
      if (!img) continue;
      var num = nums[i];
      if (num) {
        setHudThumb(img, paintingUrlFor(num));
        img.hidden = false;
        img.alt = "Spell painting #" + num;
        hasAny = true;
      } else {
        img.hidden = true;
        img.removeAttribute("src");
      }
    }
    wrap.hidden = !hasAny;
    if (hasAny) {
      wrap.title = nums
        .filter(function (n) {
          return !!n;
        })
        .map(function (n) {
          return "#" + n;
        })
        .join(" · ");
    } else {
      wrap.title = "";
    }
  }

  function buildStasisVisionGallery() {
    if (g.playing && hasVisionFloor()) {
      syncMosaicCenterCell();
      ensureMosaicRing();
    }
    var list = [];
    for (var i = 0; i < STASIS_VISION_GALLERY_KEYS.length; i++) {
      var key = STASIS_VISION_GALLERY_KEYS[i];
      var slot = mosaicHudCellState(key);
      var url = visionUrlForGallerySlot(slot);
      list.push({
        key: key,
        imageNum: i + 1,
        totalSlots: STASIS_VISION_GALLERY_KEYS.length,
        label: slot.label,
        short: slot.short,
        hudIdx: hudIdxForGalleryKey(key),
        url: url,
        pending: !gallerySlotHasVision(slot, url),
        spellNums: spellNumsForGallerySlot(slot),
      });
    }
    return list;
  }

  function showStasisVisionGalleryIndex(idx) {
    var gal = g._stasisVisionGallery;
    if (!gal || !gal.entries.length) return;
    var total = gal.entries.length;
    idx = ((idx % total) + total) % total;
    gal.index = idx;
    var entry = refreshGalleryEntryVision(gal.entries[idx]);
    var dlgImg = $("spell-stasis-vision-dialog-img");
    var caption = $("spell-stasis-vision-dialog-caption");
    var placeholder = $("spell-stasis-vision-dialog-placeholder");
    var prevBtn = $("spell-stasis-vision-dialog-prev");
    var nextBtn = $("spell-stasis-vision-dialog-next");
    var captionText =
      "Image #" + entry.imageNum + " of " + entry.totalSlots + " · " + entry.label;
    if (caption) {
      caption.hidden = false;
      caption.textContent = captionText;
    }
    var url = entry.url || "";
    if (!url && entry.pending) {
      if (dlgImg) {
        dlgImg.hidden = true;
        dlgImg.removeAttribute("src");
      }
      if (placeholder) placeholder.hidden = true;
    } else {
      if (!url) {
        var slot = mosaicHudCellState(entry.key);
        url = visionUrlForGallerySlot(slot);
      }
      if (placeholder) placeholder.hidden = true;
      if (dlgImg && url) {
        dlgImg.hidden = false;
        dlgImg.src = url;
        dlgImg.alt = "Image #" + entry.imageNum + " · " + entry.label + " stasis vision";
      } else if (dlgImg) {
        dlgImg.hidden = true;
        dlgImg.removeAttribute("src");
      }
    }
    updateVisionDialogSpells(entry);
    if (prevBtn) prevBtn.hidden = total < 2;
    if (nextBtn) nextBtn.hidden = total < 2;
  }

  function stepStasisVisionGallery(delta) {
    var gal = g._stasisVisionGallery;
    if (!gal || gal.entries.length < 2) return;
    var total = gal.entries.length;
    var next = gal.index;
    for (var attempt = 0; attempt < total; attempt++) {
      next = ((next + delta) % total + total) % total;
      var entry = refreshGalleryEntryVision(gal.entries[next]);
      if (!entry.pending) {
        showStasisVisionGalleryIndex(next);
        return;
      }
    }
    showStasisVisionGalleryIndex(next);
  }

  function openStasisVisionDialog(url, hudIdx, imageNum) {
    var gallery = buildStasisVisionGallery();
    if (!gallery.length) return;
    var idx = 0;
    if (imageNum != null) {
      for (var n = 0; n < gallery.length; n++) {
        if (gallery[n].imageNum === imageNum) {
          idx = n;
          break;
        }
      }
    } else if (hudIdx != null) {
      for (var j = 0; j < gallery.length; j++) {
        if (gallery[j].hudIdx === hudIdx) {
          idx = j;
          break;
        }
      }
    } else if (url) {
      for (var k = 0; k < gallery.length; k++) {
        if (gallery[k].url === url) {
          idx = k;
          break;
        }
      }
    }
    g._stasisVisionGallery = { entries: gallery, index: idx };
    var dlg = $("spell-stasis-vision-dialog");
    if (!dlg || !$("spell-stasis-vision-dialog-img")) return;
    showStasisVisionGalleryIndex(idx);
    if (window.galleryDialog && window.galleryDialog.open) {
      window.galleryDialog.open(dlg);
    } else if (typeof dlg.showModal === "function") {
      dlg.showModal();
    } else {
      dlg.setAttribute("open", "");
      dlg.style.display = "flex";
    }
  }

  function fullscreenStasis() {
    openStasisVisionDialog(null, null, 1);
  }

  var SAVE_FOLDER_DB = "muralwalk-save-v1";
  var SAVE_FOLDER_STORE = "handles";

  function isLocalGalleryServer() {
    var h = (location.hostname || "").toLowerCase();
    return h === "localhost" || h === "127.0.0.1" || h === "";
  }

  function stasisImageFilename() {
    return "muralwalk-stasis-" + equippedNums().join("-") + "-" + Date.now() + ".png";
  }

  function updateSaveFolderHint() {
    var el = $("mw-save-folder-hint");
    if (!el) return;
    if (g._saveDirHandle && g._saveDirLabel) {
      el.textContent = "Saves: browser folder \"" + g._saveDirLabel + "\"";
      return;
    }
    if (g._serverSaveDir) {
      el.textContent = "Saves: " + g._serverSaveDir;
      return;
    }
    if (isLocalGalleryServer()) {
      el.textContent = "Saves: gallery/saved-stasis (local server)";
    } else {
      el.textContent = "Saves: Downloads or folder you pick";
    }
  }

  function openSaveDb() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) {
        reject(new Error("IndexedDB unavailable"));
        return;
      }
      var req = indexedDB.open(SAVE_FOLDER_DB, 1);
      req.onupgradeneeded = function () {
        req.result.createObjectStore(SAVE_FOLDER_STORE);
      };
      req.onsuccess = function () {
        resolve(req.result);
      };
      req.onerror = function () {
        reject(req.error || new Error("Could not open save database."));
      };
    });
  }

  function persistSaveDirHandle(handle) {
    return openSaveDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(SAVE_FOLDER_STORE, "readwrite");
        tx.objectStore(SAVE_FOLDER_STORE).put(handle, "dir");
        tx.oncomplete = function () {
          resolve();
        };
        tx.onerror = function () {
          reject(tx.error || new Error("Could not remember folder."));
        };
      });
    });
  }

  function restoreSaveDirHandle() {
    if (!window.indexedDB) return Promise.resolve(null);
    return openSaveDb()
      .then(function (db) {
        return new Promise(function (resolve, reject) {
          var tx = db.transaction(SAVE_FOLDER_STORE, "readonly");
          var req = tx.objectStore(SAVE_FOLDER_STORE).get("dir");
          req.onsuccess = function () {
            resolve(req.result || null);
          };
          req.onerror = function () {
            reject(req.error);
          };
        });
      })
      .catch(function () {
        return null;
      });
  }

  function refreshSaveFolderLocation() {
    if (!isLocalGalleryServer()) {
      updateSaveFolderHint();
      return Promise.resolve();
    }
    return fetch("/api/save-location")
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (!data || !data.ok) return;
        g._serverSaveDir = data.save_dir || "";
        g._serverGalleryRoot = data.gallery_root || "";
        var pathInput = $("mw-save-folder-path");
        if (pathInput && !pathInput.matches(":focus")) {
          pathInput.value = g._serverSaveDir;
        }
        updateSaveFolderHint();
      })
      .catch(function () {
        updateSaveFolderHint();
      });
  }

  function setServerSaveLocation(pathStr, useDefault) {
    return fetch("/api/set-save-location", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: pathStr || "",
        use_default: useDefault === true,
      }),
    })
      .then(function (r) {
        return r.json().then(function (data) {
          return { ok: r.ok, data: data };
        });
      })
      .then(function (res) {
        if (!res.ok) throw new Error((res.data && res.data.error) || "Could not set folder.");
        g._serverSaveDir = res.data.save_dir || "";
        g._serverGalleryRoot = res.data.gallery_root || "";
        updateSaveFolderHint();
        return res.data;
      });
  }

  function pickBrowserSaveFolder() {
    if (typeof window.showDirectoryPicker !== "function") {
      return Promise.reject(new Error("Browser folder picker not supported here."));
    }
    return window
      .showDirectoryPicker({ mode: "readwrite", id: "muralwalk-stasis-save" })
      .then(function (handle) {
        g._saveDirHandle = handle;
        g._saveDirLabel = handle.name || "folder";
        return persistSaveDirHandle(handle);
      })
      .then(function () {
        updateSaveFolderHint();
        return g._saveDirLabel;
      });
  }

  function openSaveFolderDialog() {
    var dlg = $("mw-save-folder-dialog");
    var pathInput = $("mw-save-folder-path");
    if (!dlg) return;
    refreshSaveFolderLocation().finally(function () {
      if (pathInput && g._serverSaveDir) pathInput.value = g._serverSaveDir;
      if (typeof dlg.showModal === "function") dlg.showModal();
      else dlg.setAttribute("open", "");
    });
  }

  function closeSaveFolderDialog() {
    var dlg = $("mw-save-folder-dialog");
    if (!dlg) return;
    if (typeof dlg.close === "function") dlg.close();
    else dlg.removeAttribute("open");
  }

  function bindSaveFolderDialog() {
    var dlg = $("mw-save-folder-dialog");
    if (!dlg || dlg.dataset.bound) return;
    dlg.dataset.bound = "1";
    var pickBtn = $("mw-save-folder-pick");
    var defaultBtn = $("mw-save-folder-default");
    var cancelBtn = $("mw-save-folder-cancel");
    var form = dlg.querySelector(".mw-save-folder-form");
    if (pickBtn && !pickBtn.dataset.bound) {
      pickBtn.dataset.bound = "1";
      pickBtn.addEventListener("click", function () {
        pickBrowserSaveFolder()
          .then(function (name) {
            setFloorStatus("Save folder: " + name);
            closeSaveFolderDialog();
          })
          .catch(function (err) {
            setFloorStatus((err && err.message) || "Could not pick folder.");
          });
      });
    }
    if (defaultBtn && !defaultBtn.dataset.bound) {
      defaultBtn.dataset.bound = "1";
      defaultBtn.addEventListener("click", function () {
        if (!isLocalGalleryServer()) {
          g._saveDirHandle = null;
          g._saveDirLabel = "";
          updateSaveFolderHint();
          setFloorStatus("Using browser save prompts.");
          closeSaveFolderDialog();
          return;
        }
        setServerSaveLocation("", true)
          .then(function (data) {
            var pathInput = $("mw-save-folder-path");
            if (pathInput) pathInput.value = data.save_dir || "";
            setFloorStatus("Save folder: gallery saved-stasis");
            closeSaveFolderDialog();
          })
          .catch(function (err) {
            setFloorStatus((err && err.message) || "Could not reset folder.");
          });
      });
    }
    if (cancelBtn && !cancelBtn.dataset.bound) {
      cancelBtn.dataset.bound = "1";
      cancelBtn.addEventListener("click", function () {
        closeSaveFolderDialog();
      });
    }
    if (form && !form.dataset.bound) {
      form.dataset.bound = "1";
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var pathInput = $("mw-save-folder-path");
        var pathStr = pathInput ? String(pathInput.value || "").trim() : "";
        if (!isLocalGalleryServer()) {
          setFloorStatus("Custom paths need the local gallery server.");
          return;
        }
        if (!pathStr) {
          setFloorStatus("Enter a folder path or use Gallery default.");
          return;
        }
        setServerSaveLocation(pathStr, false)
          .then(function () {
            setFloorStatus("Save folder updated.");
            closeSaveFolderDialog();
          })
          .catch(function (err) {
            setFloorStatus((err && err.message) || "Could not set folder.");
          });
      });
    }
  }

  function yieldToMainThread(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms == null ? 0 : ms);
    });
  }

  function finishSaveReward(message, skipPlayerMark) {
    if (!skipPlayerMark) {
      recordSpellSaved(equippedNums());
      markPlayerStasisSaved();
    }
    addScore(SAVE_IMAGE_ORB_REWARD);
    setFloorStatus(message, { duration: 2600 });
    updateScoreHud();
    setTimeout(function () {
      ensureActionOrbs();
    }, 900);
  }

  function finishEnemySaveReward(message) {
    addScore(SAVE_IMAGE_ORB_REWARD);
    setFloorStatus(message, { duration: 1100, sticky: false });
    updateScoreHud();
    scheduleFalloutHudUpdate();
    setTimeout(function () {
      ensureActionOrbs();
    }, 1200);
  }

  function saveBlobToServer(blob, filename, opts) {
    opts = opts || {};
    return yieldToMainThread(64).then(function () {
      return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        fetch("/api/save-stasis-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            image_base64: reader.result,
            spells: opts.spells || equippedNums(),
            filename: filename,
            fallout_compass: opts.fallout_compass || "",
          }),
        })
          .then(function (r) {
            return r.json().then(function (data) {
              return { ok: r.ok, data: data };
            });
          })
          .then(function (res) {
            if (!res.ok) throw new Error((res.data && res.data.error) || "Save failed.");
            resolve(res.data);
          })
          .catch(reject);
      };
      reader.onerror = function () {
        reject(new Error("Could not read image."));
      };
      reader.readAsDataURL(blob);
      });
    });
  }

  function saveBlobToDirHandle(dirHandle, blob, filename) {
    return dirHandle
      .getFileHandle(filename, { create: true })
      .then(function (fileHandle) {
        return fileHandle.createWritable();
      })
      .then(function (writable) {
        return writable.write(blob).then(function () {
          return writable.close();
        });
      });
  }

  function saveBlobWithPicker(blob, filename) {
    if (typeof window.showSaveFilePicker !== "function") {
      return Promise.reject(new Error("No save picker"));
    }
    return window
      .showSaveFilePicker({
        suggestedName: filename,
        types: [
          {
            description: "PNG image",
            accept: { "image/png": [".png"] },
          },
        ],
      })
      .then(function (handle) {
        return handle.createWritable();
      })
      .then(function (writable) {
        return writable.write(blob).then(function () {
          return writable.close();
        });
      });
  }

  function saveBlobDownload(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 2000);
    return Promise.resolve({ path: "Downloads", filename: filename });
  }

  function saveStasisImageAsync(fromOrb, fromDrain) {
    if (isPlayerStasisSaved()) {
      if (!fromOrb) setFloorStatus("Stasis already saved.");
      return Promise.resolve();
    }
    if (!fromOrb && !playerStasisReadyForSave()) {
      if (stasisChangesPending()) setFloorStatus("Wait for stasis to finish painting.");
      return Promise.resolve();
    }
    var vision = g.fusion.visionImg;
    if (!vision || !vision.complete || !vision.naturalWidth) return Promise.resolve();
    var filename = stasisImageFilename();
    return visionImgToBlob(vision)
      .then(function (blob) {
        return saveBlobWithOpts(blob, filename, { spells: equippedNums() });
      })
      .then(function (result) {
        var where = (result && (result.path || result.dir)) || "saved-stasis";
        var shortPath = where.length > 72 ? "…" + where.slice(-69) : where;
        finishSaveReward(
          "Center saved " +
            ((result && result.filename) || filename) +
            " → " +
            shortPath +
            " (+" +
            SAVE_IMAGE_ORB_REWARD +
            " orbs)"
        );
        updateGameSaveButtons();
        scheduleFalloutHudUpdate();
        if (!fromDrain) checkStasisSaveCycleProgress();
      })
      .catch(function (err) {
        setFloorStatus((err && err.message) || "Could not save image.");
      });
  }

  function saveStasisImage(fromOrb) {
    saveStasisImageAsync(fromOrb);
  }

  function currentWalkVisionImg() {
    var pinfo = playerCompassInfo();
    if (!pinfo.isCenter && pinfo.key) {
      var c = mosaicCompassByKey(pinfo.key);
      var cell = c ? mosaicCellForCompass(c) : null;
      if (cell && cell.visionImg && cell.visionImg.complete && cell.visionImg.naturalWidth) {
        return { img: cell.visionImg, label: pinfo.label || pinfo.key, tile: true };
      }
    }
    var vision = g.fusion.visionImg;
    if (vision && vision.complete && vision.naturalWidth) {
      return { img: vision, label: "Center", tile: false };
    }
    return null;
  }

  function prepareMuralwalkTabloidPrint() {
    if (!window.TabloidPrint) return;
    var cur = currentWalkVisionImg();
    if (!cur) {
      setFloorStatus("No painted stasis to print yet.");
      return;
    }
    window.TabloidPrint.prepare({
      image: cur.img,
      title: g.stasisTitle || "Muralwalk stasis",
      subtitle: cur.tile ? cur.label + " fallout" : "Center floor",
      caption: g.stasisText || "",
      source: "Muralwalk",
      filename: "muralwalk-" + String(cur.label || "center").toLowerCase().replace(/\s+/g, "-"),
    });
  }

  function saveFalloutCompassByKey(key) {
    var compass = mosaicCompassByKey(key);
    var cell = compass ? mosaicCellForCompass(compass) : null;
    var enemy = falloutEnemyForCompass(key);
    var label = compass ? compass.label : MOSAIC_HUD_LABELS[key] || key;
    if (!cell || !cell.visionImg || !cell.visionImg.complete) {
      setFloorStatus("No painted stasis for " + label + " yet.");
      return;
    }
    if (enemy && canEnemyPursueSave(enemy)) {
      queueEnemyFalloutSave(enemy);
      processPendingFalloutSaves();
      return;
    }
    var folder = FALLOUT_SAVE_FOLDERS[key] || key;
    var spells = cell.spells && cell.spells.length ? cell.spells : falloutSpellNums(enemy);
    var filename = "";
    visionImgToBlob(cell.visionImg)
      .then(function (blob) {
        return saveBlobWithOpts(blob, filename, {
          fallout_compass: key,
          spells: spells,
        });
      })
      .then(function (result) {
        if (enemy) {
          enemy._savedKey = stasisContentKey(cell.visionUrl, spells);
        }
        var where = (result && result.path) || FALLOUT_SAVE_ROOT + "/" + folder;
        finishEnemySaveReward(
          label + " saved → " + where + " (+" + SAVE_IMAGE_ORB_REWARD + " orbs)"
        );
        updateGameSaveButtons();
        scheduleFalloutHudUpdate();
      })
      .catch(function (err) {
        setFloorStatus((err && err.message) || "Could not save compass tile.");
      });
  }

  function saveStasisMapCell(hudIdx) {
    var key = MOSAIC_HUD_GRID[hudIdx];
    if (!key) return;
    if (key === "center") {
      saveStasisImage(true);
      return;
    }
    saveFalloutCompassByKey(key);
  }

  function refreshStasisMapCell(hudIdx) {
    var key = MOSAIC_HUD_GRID[hudIdx];
    if (!key || !g.playing || g.menuOpen) return;
    if (stasisSpellHuntBlocked()) {
      setFloorStatus("Save all 9 stasis visions before refreshing tiles.");
      return;
    }
    if (key === "center") {
      if (equippedNums().length < 2 || !g.stasisText.trim()) {
        setFloorStatus("Equip spells and stasis before refreshing center.");
        return;
      }
      if (visionRegenInflight() || stasisActionsBusy() || g.floorGenerating || g._worldGenPromise) {
        setFloorStatus("Center stasis is already painting.");
        return;
      }
      g.spellShiftCount += 1;
      syncMosaicCenterCell();
      delete g._minimapThumbCache[
        mosaicCellKey(g.visionMosaic.focusGx, g.visionMosaic.focusGy)
      ];
      enqueueWork(
        "buzz_vision",
        "player-refresh",
        function () {
          return regenerateStasisVision({
            quietStatus: true,
            unlockFloor: g.floorUnlocked,
            keepPreviousOnFail: hasVisionFloor(),
          }).then(function () {
            syncMosaicCenterCell();
            scheduleFalloutHudUpdate();
          });
        },
        3
      );
      setFloorStatus("Refreshing center stasis…", { duration: 900, sticky: false });
      scheduleFalloutHudUpdate();
      return;
    }
    var enemy = falloutEnemyForCompass(key);
    var label = MOSAIC_HUD_LABELS[key] || key.toUpperCase();
    if (!enemy) {
      setFloorStatus("No enemy for " + label + " yet.");
      return;
    }
    var cell = getEnemyMosaicCell(enemy);
    if (cell && cell.status === "generating" && !isMosaicCellGenStale(cell)) {
      setFloorStatus(label + " stasis is painting…", { duration: 900, sticky: false });
      return;
    }
    if (falloutVisionBusyForCompass(key)) {
      setFloorStatus(label + " stasis is still painting…", { duration: 900, sticky: false });
      return;
    }
    if (cell) {
      resetMosaicCellForRegen(cell);
    }
    enemy.falloutGenDone = false;
    enemy._savedKey = "";
    enqueueWork(
      "fallout_vision",
      key,
      function () {
        return runFalloutMosaicGen(enemy);
      },
      2
    );
    setFloorStatus("Refreshing " + label + " stasis…", { duration: 900, sticky: false });
    scheduleFalloutHudUpdate();
  }

  function updateFalloutMapCellButtons(hudIdx, slot, cell) {
    var saveBtn = $("mw-fallout-save-" + hudIdx);
    var refreshBtn = $("mw-fallout-refresh-" + hudIdx);
    var canSave = false;
    var canRefresh = false;
    if (slot.isCenter) {
      canSave = playerStasisReadyForSave();
      canRefresh =
        equippedNums().length >= 2 &&
        !!g.stasisText.trim() &&
        !visionRegenInflight() &&
        !stasisActionsBusy() &&
        !g.floorGenerating &&
        !g._worldGenPromise;
      if (saveBtn) {
        if (isPlayerStasisSaved()) {
          saveBtn.title = "Center auto-saved → saved-stasis/";
        } else if (canSave) {
          saveBtn.title = "Saving center → saved-stasis/…";
        } else {
          saveBtn.title = "Paint center stasis first";
        }
      }
      if (refreshBtn) {
        if (g.floorGenerating || g._worldGenPromise || visionRegenInflight()) {
          refreshBtn.title = "Center stasis is painting…";
        } else if (canRefresh) {
          refreshBtn.title = "Refresh center stasis";
        } else {
          refreshBtn.title = "Center stasis is waiting…";
        }
      }
    } else {
      var painting = !!(cell && cell.status === "generating");
      var stale = painting && isMosaicCellGenStale(cell);
      canSave = !!(cell && cell.status === "ready" && cell.visionImg);
      canRefresh =
        !!slot.enemy &&
        (!painting || stale) &&
        !falloutVisionBusyForCompass(slot.key);
      var folder = FALLOUT_SAVE_FOLDERS[slot.key] || slot.key;
      if (saveBtn) {
        saveBtn.title = canSave
          ? "Save " + slot.short + " → saved-fallout/" + folder + "/"
          : "No painted stasis yet";
      }
      if (refreshBtn) {
        if (painting && !stale) {
          refreshBtn.title = slot.short + " stasis is painting…";
        } else if (canRefresh) {
          refreshBtn.title = "Refresh " + slot.short + " stasis";
        } else if (falloutGenQueuedForCompass(slot.key)) {
          refreshBtn.title = slot.short + " stasis is loading…";
        } else {
          refreshBtn.title = slot.short + " stasis is waiting…";
        }
      }
    }
    if (saveBtn) saveBtn.disabled = !canSave;
    if (refreshBtn) refreshBtn.disabled = !canRefresh;
  }

  function saveCompassTileFromGame() {
    var pinfo = playerCompassInfo();
    if (pinfo.isCenter) {
      saveStasisImage(true);
      return;
    }
    if (!pinfo.key) {
      setFloorStatus("Walk a painted compass tile to save its fallout vision.");
      return;
    }
    saveFalloutCompassByKey(pinfo.key);
  }

  function updateGameSaveButtons() {
    var wrap = $("mw-game-actions");
    var centerBtn = $("mw-game-save-image");
    var tileBtn = $("mw-game-save-tile");
    var printBtn = $("mw-game-tabloid-print");
    var show = g.playing && !g.menuOpen && isMuralwalkActive();
    if (wrap) wrap.hidden = !show;
    if (!show) return;
    var pinfo = playerCompassInfo();
    var onCompass =
      !pinfo.isCenter &&
      pinfo.key &&
      (function () {
        var c = mosaicCompassByKey(pinfo.key);
        var cell = c ? mosaicCellForCompass(c) : null;
        return !!(cell && cell.status === "ready" && cell.visionImg);
      })();
    if (centerBtn) {
      centerBtn.hidden = true;
      centerBtn.disabled = true;
    }
    if (printBtn) printBtn.disabled = !currentWalkVisionImg();
    if (tileBtn) {
      tileBtn.disabled = !onCompass && !hasVisionFloor();
      if (onCompass) {
        var folder = FALLOUT_SAVE_FOLDERS[pinfo.key] || pinfo.key;
        tileBtn.textContent = "Save " + (pinfo.short || pinfo.key);
        tileBtn.title =
          "Save " +
          pinfo.label +
          " fallout → saved-fallout/" +
          folder +
          "/ (+1000 orbs)";
      } else {
        tileBtn.textContent = "Save tile";
        tileBtn.title = "Walk a painted compass tile to save its fallout vision";
      }
    }
  }

  function bindStasisVisionDialog() {
    var closeBtn = $("spell-stasis-vision-dialog-close");
    var prevBtn = $("spell-stasis-vision-dialog-prev");
    var nextBtn = $("spell-stasis-vision-dialog-next");
    var dlg = $("spell-stasis-vision-dialog");
    if (closeBtn && !closeBtn.dataset.bound) {
      closeBtn.dataset.bound = "1";
      closeBtn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        closeStasisVisionDialog();
      });
    }
    if (prevBtn && !prevBtn.dataset.bound) {
      prevBtn.dataset.bound = "1";
      prevBtn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        stepStasisVisionGallery(-1);
      });
    }
    if (nextBtn && !nextBtn.dataset.bound) {
      nextBtn.dataset.bound = "1";
      nextBtn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        stepStasisVisionGallery(1);
      });
    }
    if (dlg && !dlg.dataset.mwDialogBound) {
      dlg.dataset.mwDialogBound = "1";
      dlg.addEventListener("click", function (e) {
        if (e.target === dlg) closeStasisVisionDialog();
      });
      dlg.addEventListener("cancel", function (e) {
        e.preventDefault();
        closeStasisVisionDialog();
      });
      dlg.addEventListener("keydown", function (e) {
        if (!g._stasisVisionGallery || g._stasisVisionGallery.entries.length < 2) return;
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          stepStasisVisionGallery(-1);
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          stepStasisVisionGallery(1);
        }
      });
    }
  }

  function videofyStasis() {
    var nums = equippedNums();
    if (!canBuildStasisVideo() || nums.length < 2 || g._videofyPromise) return;

    g._videofyPromise = true;
    g._videofyLastBlob = null;
    videofyRevokeMp4Url();
    if (window.VideofyExport && window.VideofyExport.prefetch) {
      window.VideofyExport.prefetch();
    }
    setVideofyStatus("Videofying stasis — animating your fused vision…", true);
    updateStasisActionButtons();
    updateVideofyExportUi(false);

    var video = $("mw-stasis-video");
    var dl = $("mw-stasis-video-download");
    var exports = $("mw-stasis-video-exports");
    if (video) {
      video.hidden = true;
      video.removeAttribute("src");
    }
    if (dl) dl.hidden = true;
    if (exports) exports.hidden = true;

    var expectedSec = (getVideofySettings().duration || VIDEIFY_DURATION_SEC);
    buildMuralwalkVideofy()
      .then(function (blobUrl) {
        showMuralwalkVideo(blobUrl, expectedSec);
      })
      .catch(function (err) {
        setVideofyStatus((err && err.message) || "Videofy failed.", true);
      })
      .finally(function () {
        g._videofyPromise = null;
        updateStasisActionButtons();
      });
  }

  function bindStasisActions() {
    bindStasisVisionDialog();
    bindSaveFolderDialog();
    bindMwBuzzPanel();
    bindVideofyPanel();
    bindVideofyExports();
    restoreSaveDirHandle().then(function (handle) {
      if (!handle) return;
      g._saveDirHandle = handle;
      g._saveDirLabel = handle.name || "folder";
      updateSaveFolderHint();
    });
    refreshSaveFolderLocation();
    var defBtn = $("mw-stasis-redefine");
    if (defBtn && !defBtn.dataset.bound) {
      defBtn.dataset.bound = "1";
      defBtn.addEventListener("click", redefineStasis);
    }
    var reBtn = $("mw-stasis-reimagine");
    if (reBtn && !reBtn.dataset.bound) {
      reBtn.dataset.bound = "1";
      reBtn.addEventListener("click", reimagineStasis);
    }
    var fsBtn = $("mw-stasis-fullscreen");
    if (fsBtn && !fsBtn.dataset.bound) {
      fsBtn.dataset.bound = "1";
      fsBtn.addEventListener("click", fullscreenStasis);
    }
    var saveBtn = $("mw-stasis-save-image");
    if (saveBtn && !saveBtn.dataset.bound) {
      saveBtn.dataset.bound = "1";
      saveBtn.addEventListener("click", saveStasisImage);
    }
    var stripPrintBtn = $("mw-stasis-tabloid-print");
    if (stripPrintBtn && !stripPrintBtn.dataset.bound) {
      stripPrintBtn.dataset.bound = "1";
      stripPrintBtn.addEventListener("click", prepareMuralwalkTabloidPrint);
    }
    var gameSaveBtn = $("mw-game-save-image");
    if (gameSaveBtn && !gameSaveBtn.dataset.bound) {
      gameSaveBtn.dataset.bound = "1";
      gameSaveBtn.addEventListener("click", function () {
        saveStasisImage(true);
      });
    }
    var gameTileBtn = $("mw-game-save-tile");
    if (gameTileBtn && !gameTileBtn.dataset.bound) {
      gameTileBtn.dataset.bound = "1";
      gameTileBtn.addEventListener("click", saveCompassTileFromGame);
    }
    var gamePrintBtn = $("mw-game-tabloid-print");
    if (gamePrintBtn && !gamePrintBtn.dataset.bound) {
      gamePrintBtn.dataset.bound = "1";
      gamePrintBtn.addEventListener("click", prepareMuralwalkTabloidPrint);
    }
    var folderBtn = $("mw-stasis-save-folder");
    if (folderBtn && !folderBtn.dataset.bound) {
      folderBtn.dataset.bound = "1";
      folderBtn.addEventListener("click", openSaveFolderDialog);
    }
    var vidBtn = $("mw-stasis-videofy");
    if (vidBtn && !vidBtn.dataset.bound) {
      vidBtn.dataset.bound = "1";
      vidBtn.addEventListener("click", videofyStasis);
    }
    updateStasisActionButtons();
    updateGameSaveButtons();
  }

  function getOrbBlockers() {
    var blocks = [];
    var i;
    for (i = 0; i < g.obstacles.length; i++) {
      var o = g.obstacles[i];
      blocks.push({
        x: o.x,
        y: o.y,
        r: o.r || 40,
        pillar: !!(o.pillar || /pillar/i.test(o.subject || "")),
      });
    }
    for (i = 0; i < g.stasisProps.length; i++) {
      var p = g.stasisProps[i];
      blocks.push({ x: p.x, y: p.y, r: 78, pillar: true });
    }
    return blocks;
  }

  function isOrbPositionBlocked(x, y, clearance) {
    clearance = clearance == null ? ORB_CLEARANCE : clearance;
    var blocks = getOrbBlockers();
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      var dx = x - b.x;
      var dy = y - b.y;
      var need = b.r + clearance + (b.pillar ? 12 : 0);
      if (dx * dx + dy * dy < need * need) return true;
    }
    return false;
  }

  function orbFootprint(type) {
    if (type === "spell_shuffle" || type === "spell_select") return ORB_SPELL_RADIUS + 10;
    if (type === "buzz_inject" || type === "extra_buzz") return 26;
    if (type === "reimagine") return 24;
    if (type === "redefine") return 22;
    return 18;
  }

  function isOrbTooCloseToOthers(x, y, footprint, skipIdx) {
    for (var i = 0; i < g.orbs.length; i++) {
      if (i === skipIdx) continue;
      var o = g.orbs[i];
      if (o.taken) continue;
      var dx = x - o.x;
      var dy = y - o.y;
      var need = footprint + orbFootprint(o.type || "score") + ORB_CLUSTER_GAP;
      if (dx * dx + dy * dy < need * need) return true;
    }
    return false;
  }

  function isOrbNearSpawnGuard(x, y, footprint) {
    if (g._spawnGuardWx == null || g._spawnGuardWy == null) return false;
    var dx = x - g._spawnGuardWx;
    var dy = y - g._spawnGuardWy;
    var need = PLAYER_SPAWN_GUARD + (footprint || 18);
    return dx * dx + dy * dy < need * need;
  }

  function isOrbSpotInvalid(x, y, footprint) {
    return (
      isOrbPositionBlocked(x, y) ||
      isOrbTooCloseToOthers(x, y, footprint) ||
      isOrbNearSpawnGuard(x, y, footprint)
    );
  }

  function placePlayerAtSpawn() {
    var ps = playerSector();
    var sec = sectorWorldCenter(ps.sx, ps.sy);
    var pocket = ORB_SECTOR_PITCH * 0.36;
    g.wx = sec.x + pocket;
    g.wy = sec.y + pocket;
    g.camWx = g.wx;
    g.camWy = g.wy;
    g._prevWx = g.wx;
    g._prevWy = g.wy;
    g.vx = 0;
    g.vy = 0;
    g._spawnGuardWx = g.wx;
    g._spawnGuardWy = g.wy;
  }

  function playerSector() {
    return {
      sx: Math.floor(g.wx / ORB_SECTOR_PITCH),
      sy: Math.floor(g.wy / ORB_SECTOR_PITCH),
    };
  }

  function sectorWorldCenter(sx, sy) {
    var gx = sx * 5;
    var gy = sy * 5;
    if (mazeCellIsWall(gx, gy, g.fx.seed)) {
      var offs = [
        [0, 0],
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
        [1, 1],
        [-1, -1],
        [1, -1],
        [-1, 1],
      ];
      for (var i = 0; i < offs.length; i++) {
        var nx = gx + offs[i][0];
        var ny = gy + offs[i][1];
        if (!mazeCellIsWall(nx, ny, g.fx.seed)) {
          gx = nx;
          gy = ny;
          break;
        }
      }
    }
    return {
      x: gx * MAZE_CELL + MAZE_CELL * 0.5,
      y: gy * MAZE_CELL + MAZE_CELL * 0.5,
    };
  }

  function sectorKey(sx, sy) {
    return sx + "," + sy;
  }

  function clusterCenter(key, sectorSx, sectorSy) {
    var c = ORB_CLUSTER_DEFS[key];
    sectorSx = sectorSx == null ? 0 : sectorSx;
    sectorSy = sectorSy == null ? 0 : sectorSy;
    if (!c) return sectorWorldCenter(sectorSx, sectorSy);
    var sec = sectorWorldCenter(sectorSx, sectorSy);
    return {
      x: sec.x + c.ox * ORB_CLUSTER_RADIUS,
      y: sec.y + c.oy * ORB_CLUSTER_RADIUS,
    };
  }

  function clusterSlotPos(key, slot, sectorSx, sectorSy) {
    var c = ORB_CLUSTER_DEFS[key];
    var col = slot % c.cols;
    var row = Math.floor(slot / c.cols);
    var startX = -((c.cols - 1) * ORB_CLUSTER_PITCH) / 2;
    var startY = -((c.rows - 1) * ORB_CLUSTER_PITCH) / 2;
    var center = clusterCenter(key, sectorSx, sectorSy);
    return {
      x: center.x + startX + col * ORB_CLUSTER_PITCH,
      y: center.y + startY + row * ORB_CLUSTER_PITCH,
    };
  }

  function resolveOrbGridPosition(x, y, footprint, clusterKey, slot) {
    if (!isOrbSpotInvalid(x, y, footprint)) return { x: x, y: y };
    var step = ORB_CLUSTER_PITCH * 0.58;
    var phase = ((slot || 0) + (clusterKey ? clusterKey.length : 0) * 5) * 0.71;
    for (var ring = 1; ring <= 7; ring++) {
      var slots = ring * 8;
      for (var s = 0; s < slots; s++) {
        var ang = (s / slots) * Math.PI * 2 + phase;
        var nx = x + Math.cos(ang) * step * ring;
        var ny = y + Math.sin(ang) * step * ring;
        if (!isOrbSpotInvalid(nx, ny, footprint)) return { x: nx, y: ny };
      }
    }
    return { x: x + step * 2.2, y: y + step * 1.6 };
  }

  function placeOrb(orb, x, y) {
    var footprint = orbFootprint(orb.type || "score");
    var finalPos = resolveOrbGridPosition(x, y, footprint, orb.cluster || "misc", g.orbs.length);
    orb.x = finalPos.x;
    orb.y = finalPos.y;
    orb.cluster = orb.cluster || "";
    g.orbs.push(orb);
  }

  function placeOrbInCluster(orb, clusterKey, slot, sectorSx, sectorSy) {
    var ps = playerSector();
    sectorSx = sectorSx == null ? ps.sx : sectorSx;
    sectorSy = sectorSy == null ? ps.sy : sectorSy;
    var pos = clusterSlotPos(clusterKey, slot, sectorSx, sectorSy);
    var footprint = orbFootprint(orb.type || "score");
    var finalPos = resolveOrbGridPosition(pos.x, pos.y, footprint, clusterKey, slot);
    orb.x = finalPos.x;
    orb.y = finalPos.y;
    orb.cluster = clusterKey;
    orb.clusterSlot = slot;
    orb.sectorSx = sectorSx;
    orb.sectorSy = sectorSy;
    g.orbs.push(orb);
  }

  function spawnScoreCluster(clusterKey, count, saltBase, sectorSx, sectorSy) {
    var c = ORB_CLUSTER_DEFS[clusterKey];
    var cap = c.cols * c.rows;
    var n = Math.min(count, cap);
    var values = ORB_VALUES;
    for (var i = 0; i < n; i++) {
      var val = values[SM.orbValueIndex(saltBase + i, g.fx.seed, g.score, values.length)];
      placeOrbInCluster(
        { type: "score", value: val, taken: false },
        clusterKey,
        i,
        sectorSx,
        sectorSy
      );
    }
  }

  function preloadOrbSpellImage(num) {
    return preloadPaintingThumb(num);
  }

  function activeSpellOrbNums() {
    var nums = [];
    for (var i = 0; i < g.orbs.length; i++) {
      var o = g.orbs[i];
      if (o.taken) continue;
      if (o.type !== "spell_shuffle" && o.type !== "spell_select") continue;
      if (!o.spellNum || nums.indexOf(o.spellNum) >= 0) continue;
      nums.push(o.spellNum);
    }
    return nums;
  }

  function spellOrbScatterPos(sectorSx, sectorSy, scatterIdx, salt) {
    var sec = sectorWorldCenter(sectorSx, sectorSy);
    var h = SM.spellHash(
      salt + scatterIdx * 13,
      sectorSx * 1009 + sectorSy * 917 + g.fx.seed
    );
    var ring = scatterIdx % 4;
    var slots = 8;
    var ang =
      (scatterIdx % slots) * ((Math.PI * 2) / slots) +
      ring * 0.38 +
      ((h % 360) / 360) * 0.22;
    var dist = ORB_CLUSTER_RADIUS * (0.58 + ring * 0.18 + (h % 9) * 0.012);
    return {
      x: sec.x + Math.cos(ang) * dist,
      y: sec.y + Math.sin(ang) * dist,
    };
  }

  function spellScatterIdxInSector(sectorSx, sectorSy, mode) {
    var n = 0;
    for (var i = 0; i < g.orbs.length; i++) {
      var o = g.orbs[i];
      if (o.taken || o.type !== mode) continue;
      if (o.sectorSx === sectorSx && o.sectorSy === sectorSy) n++;
    }
    return n;
  }

  function countSpellOrbsInSector(sectorSx, sectorSy) {
    var n = 0;
    for (var i = 0; i < g.orbs.length; i++) {
      var o = g.orbs[i];
      if (o.taken) continue;
      if (o.type !== "spell_shuffle" && o.type !== "spell_select") continue;
      if (o.sectorSx === sectorSx && o.sectorSy === sectorSy) n++;
    }
    return n;
  }

  function bestSectorForSpellOrbs(centerSx, centerSy) {
    var bestSx = centerSx;
    var bestSy = centerSy;
    var bestN = countSpellOrbsInSector(centerSx, centerSy);
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        var sx = centerSx + dx;
        var sy = centerSy + dy;
        var n = countSpellOrbsInSector(sx, sy);
        if (n < bestN) {
          bestN = n;
          bestSx = sx;
          bestSy = sy;
        }
      }
    }
    spawnOrbSector(bestSx, bestSy);
    return { sx: bestSx, sy: bestSy };
  }

  function sectorSpellOrbPlan(sx, sy, saltBase) {
    var h = SM.spellHash(saltBase, sx * 67 + sy * 89 + g.score);
    return [
      {
        mode: "spell_shuffle",
        slotIdx: h % 2,
        salt: saltBase + 50 + (h % 17),
        scatterIdx: h % 5,
      },
      {
        mode: (h >> 9) % 3 === 0 ? "spell_shuffle" : "spell_select",
        slotIdx: 1 + (h % 2),
        salt: saltBase + 83 + ((h >> 12) % 29),
        scatterIdx: 2 + ((h >> 7) % 3),
      },
    ];
  }

  function buildSpellOrb(mode, slotIdx, salt) {
    salt = salt == null ? g.fx.seed + g.orbs.length + slotIdx * 31 : salt;
    var used = g.slots.filter(function (n, i) {
      return n && i !== slotIdx;
    });
    var orbUsed = activeSpellOrbNums();
    for (var u = 0; u < orbUsed.length; u++) {
      if (used.indexOf(orbUsed[u]) < 0) used.push(orbUsed[u]);
    }
    var spellNum;
    if (mode === "spell_shuffle") {
      spellNum = pickRandomSpell(used, salt);
    } else {
      spellNum = pickRandomSpell([], salt);
      if (used.indexOf(spellNum) >= 0) {
        spellNum = pickRandomSpell(used.concat([spellNum]), salt + 97);
      }
    }
    if (!spellNum) return null;
    return {
      type: mode,
      slotIdx: slotIdx,
      spellNum: spellNum,
      value: mode === "spell_shuffle" ? SHUFFLE_COST : SELECT_SPELL_COST,
      taken: false,
    };
  }

  function spawnSpellOrbScattered(mode, spellSlot, salt, sectorSx, sectorSy, scatterIdx) {
    if (scatterIdx == null) {
      scatterIdx = spellScatterIdxInSector(sectorSx, sectorSy, mode);
    }
    var orb = buildSpellOrb(mode, spellSlot, salt);
    if (!orb) return;
    var pos = spellOrbScatterPos(sectorSx, sectorSy, scatterIdx, salt);
    var footprint = orbFootprint(orb.type || "score");
    var finalPos = resolveOrbGridPosition(
      pos.x,
      pos.y,
      footprint,
      "spell",
      scatterIdx + salt
    );
    orb.x = finalPos.x;
    orb.y = finalPos.y;
    orb.cluster = "spell";
    orb.scatterIdx = scatterIdx;
    orb.sectorSx = sectorSx;
    orb.sectorSy = sectorSy;
    g.orbs.push(orb);
  }

  function buildBuzzOrb(salt) {
    return {
      type: "buzz_inject",
      buzzWord: pickBuzzInjectWord(salt),
      value: 0,
      taken: false,
    };
  }

  function getExtraBuzzPromptWords() {
    return String(g.extraBuzzPrompt || "")
      .split(/[,;]+/)
      .map(function (s) {
        return s.trim();
      })
      .filter(function (s) {
        return s.length > 0;
      });
  }

  function hasExtraBuzzPrompt() {
    return getExtraBuzzPromptWords().length > 0;
  }

  function buildExtraBuzzOrb() {
    return {
      type: "extra_buzz",
      value: 0,
      taken: false,
    };
  }

  function pushBuzzOrb(x, y, salt) {
    placeOrb(buildBuzzOrb(salt), x, y);
  }

  function spawnBuzzInCluster(slot, salt, sectorSx, sectorSy) {
    var orb = buildBuzzOrb(salt);
    if (!orb) return;
    placeOrbInCluster(orb, "buzz", slot, sectorSx, sectorSy);
  }

  function spawnExtraBuzzInCluster(slot, sectorSx, sectorSy) {
    placeOrbInCluster(buildExtraBuzzOrb(), "buzz", slot, sectorSx, sectorSy);
  }

  function pushScoreOrb(x, y, value) {
    placeOrb(
      {
        type: "score",
        value: value,
        taken: false,
      },
      x,
      y
    );
  }

  function pushActionOrb(x, y, actionType) {
    placeOrb(
      {
        type: actionType,
        value: 0,
        taken: false,
      },
      x,
      y
    );
  }

  function pushSpellOrb(x, y, mode, slotIdx) {
    var orb = buildSpellOrb(mode, slotIdx);
    if (!orb) return;
    placeOrb(orb, x, y);
  }

  function spawnActionInCluster(actionType, slot, salt, sectorSx, sectorSy) {
    placeOrbInCluster(
      { type: actionType, value: 0, taken: false },
      "stasis",
      slot,
      sectorSx,
      sectorSy
    );
  }



  function countActiveOrbs(filter) {
    var n = 0;
    for (var i = 0; i < g.orbs.length; i++) {
      var o = g.orbs[i];
      if (o.taken) continue;
      if (!filter || filter(o)) n++;
    }
    return n;
  }

  function countActiveOrbsOfType(type) {
    return countActiveOrbs(function (o) {
      return o.type === type;
    });
  }

  function ensureActionOrbs() {
    if (!g.playing || g.menuOpen || equippedNums().length < 2) return;
    pruneDuplicateSaveOrbs();
    if (stasisSpellHuntBlocked()) return;
    var ps = playerSector();
    var spellSec = bestSectorForSpellOrbs(ps.sx, ps.sy);
    var salt = g.orbs.length + g.score;
    if (countActiveOrbsOfType("redefine") < 1) {
      spawnActionInCluster(
        "redefine",
        countActiveOrbsOfType("redefine"),
        salt,
        ps.sx,
        ps.sy
      );
    }
    if (countActiveOrbsOfType("reimagine") < 1) {
      spawnActionInCluster("reimagine", 2, salt + 3, ps.sx, ps.sy);
    }
    if (countActiveOrbsOfType("spell_shuffle") < 1) {
      spawnSpellOrbScattered(
        "spell_shuffle",
        countActiveOrbsOfType("spell_shuffle"),
        salt + 5 + spellSec.sx * 3 + spellSec.sy,
        spellSec.sx,
        spellSec.sy
      );
    }
    if (countActiveOrbsOfType("spell_select") < 1) {
      spawnSpellOrbScattered(
        "spell_select",
        2,
        salt + 7 + spellSec.sx * 11 + spellSec.sy * 5,
        spellSec.sx,
        spellSec.sy
      );
    }
    if (countActiveOrbsOfType("buzz_inject") < 1) {
      spawnBuzzInCluster(countActiveOrbsOfType("buzz_inject"), salt + 9, ps.sx, ps.sy);
    }
    if (shouldSpawnSaveOrb("player") && countActiveSaveOrbs("player") < 1) {
      spawnSaveWorkOrb("player", ps.sx, ps.sy, 0);
    }
    var saveTurn = getFalloutSaveTurnKey();
    if (saveTurn && !falloutSaveQueueBusy() && shouldSpawnSaveOrb(saveTurn)) {
      if (countActiveSaveOrbs(saveTurn) < 1) {
        spawnSaveWorkOrb(saveTurn, ps.sx, ps.sy, 1);
      }
    }
  }

  function spawnOrbSector(sx, sy) {
    var key = sectorKey(sx, sy);
    if (g._orbSectors[key]) return;
    g._orbSectors[key] = true;
    var saltBase = SM.spellHash(sx * 17 + 3, sy * 31 + g.fx.seed);
    spawnScoreCluster("score_n", 5, saltBase, sx, sy);
    spawnScoreCluster("score_e", 2, saltBase + 20, sx, sy);
    var spellPlan = sectorSpellOrbPlan(sx, sy, saltBase);
    for (var spi = 0; spi < spellPlan.length; spi++) {
      var entry = spellPlan[spi];
      spawnSpellOrbScattered(
        entry.mode,
        entry.slotIdx,
        entry.salt,
        sx,
        sy,
        entry.scatterIdx
      );
    }
    if ((saltBase & 3) === 0) {
      spawnBuzzInCluster(0, saltBase + 60, sx, sy);
    }
  }

  function ensureOrbSectorsAroundPlayer(includeNeighbors) {
    var ps = playerSector();
    var key = sectorKey(ps.sx, ps.sy);
    var sectorChanged = g._lastOrbSectorKey !== key;
    if (sectorChanged) g._lastOrbSectorKey = key;
    spawnOrbSector(ps.sx, ps.sy);
    if (!includeNeighbors && !sectorChanged) return;
    var cardinals = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (var ci = 0; ci < cardinals.length; ci++) {
      spawnOrbSector(ps.sx + cardinals[ci][0], ps.sy + cardinals[ci][1]);
    }
    if (includeNeighbors && sectorChanged) {
      spawnOrbSector(ps.sx + 1, ps.sy + 1);
      spawnOrbSector(ps.sx - 1, ps.sy - 1);
    }
  }

  function spawnOrbs() {
    g.orbs = [];
    g._orbSectors = {};
    g._orbPatchCount = 0;
    g._lastOrbSectorKey = "";
    g._orbNeighborsReady = false;
    ensureOrbSectorsAroundPlayer(false);
    ensureActionOrbs();
  }

  function ensureOrbsNearPlayer() {
    if (!g._orbNeighborsReady && g.playing) {
      g._orbNeighborsReady = true;
      ensureOrbSectorsAroundPlayer(true);
    } else {
      ensureOrbSectorsAroundPlayer(false);
    }
    ensureActionOrbs();
  }

  function canCollectActionOrb(o) {
    if (!o || o.type === "score") return true;
    if (stasisSpellHuntBlocked()) return false;
    if (o.type === "save_work") return canCollectSaveOrb(o);
    if (o.type === "buzz_inject") {
      return equippedNums().length >= 2 && !!(o.buzzWord && String(o.buzzWord).trim());
    }
    if (o.type === "extra_buzz") {
      return (
        equippedNums().length >= 2 &&
        !!g.stasisText.trim() &&
        hasExtraBuzzPrompt() &&
        !g.floorGenerating &&
        !g._worldGenPromise &&
        !g._visionRegenPromise
      );
    }
    if (equippedNums().length < 2 || !g.stasisText.trim()) return false;
    if (o.type === "spell_shuffle") {
      var usedShuffle = g.slots.filter(function (n, i) {
        return n && i !== o.slotIdx;
      });
      return (
        canAffordShuffle() &&
        o.spellNum &&
        usedShuffle.indexOf(o.spellNum) < 0 &&
        !g._redefinePromise &&
        !g._reimaginePromise &&
        !g.floorGenerating &&
        !g._worldGenPromise &&
        !g._visionRegenPromise
      );
    }
    if (o.type === "spell_select") {
      var usedSelect = g.slots.filter(function (n, i) {
        return n && i !== o.slotIdx;
      });
      return (
        canAffordSelect() &&
        o.spellNum &&
        usedSelect.indexOf(o.spellNum) < 0 &&
        !g._redefinePromise &&
        !g._reimaginePromise &&
        !g.floorGenerating &&
        !g._worldGenPromise &&
        !g._visionRegenPromise
      );
    }
    if (o.type === "redefine") {
      return (
        canAffordRedefine() &&
        !g._redefinePromise &&
        !g._reimaginePromise &&
        !g._videofyPromise &&
        !g.floorGenerating &&
        !g._worldGenPromise &&
        !!(window.StasisFloorGen && window.StasisFloorGen.redefineStasis)
      );
    }
    if (o.type === "reimagine") {
      return (
        canAffordReimagine() &&
        !g._reimaginePromise &&
        !g._worldGenPromise &&
        !g.floorGenerating &&
        !!(window.StasisFloorGen && window.StasisFloorGen.generateVision)
      );
    }
    return false;
  }

  function triggerActionOrb(o) {
    if (o.type === "spell_shuffle" || o.type === "spell_select") {
      var oldNum = g.slots[o.slotIdx] || null;
      var swapMsg = spellSwapMessage(o.slotIdx, oldNum, o.spellNum);
      g.fx.glitch = Math.max(g.fx.glitch, 0.75);
      if (o.type === "spell_shuffle") {
        g.score -= SHUFFLE_COST;
        saveWallet("spend", { action: "shuffle", cost: SHUFFLE_COST });
      } else {
        g.score -= SELECT_SPELL_COST;
        saveWallet("spend", { action: "select", cost: SELECT_SPELL_COST });
      }
      applySpellSlotChange(o.slotIdx, o.spellNum, false, swapMsg, swapMsg);
      return;
    }
    if (o.type === "buzz_inject") {
      g.fx.swirl = Math.max(g.fx.swirl, 0.5);
      injectBuzzFromOrb(o.buzzWord);
      return;
    }
    if (o.type === "extra_buzz") {
      g.fx.swirl = Math.max(g.fx.swirl, 0.65);
      applyExtraBuzzFromOrb();
      return;
    }
    if (o.type === "redefine") {
      g.fx.swirl = Math.max(g.fx.swirl, 0.85);
      redefineStasis();
      return;
    }
    if (o.type === "reimagine") {
      g.fx.mural = Math.max(g.fx.mural, 0.9);
      reimagineStasis();
    }
  }

  function stasisContentKey(url, spells) {
    return String(url || "") + "|" + (spells || []).join("-");
  }

  function stasisChangesPending() {
    return !!(
      g._stasisPending ||
      g.floorGenerating ||
      g._worldGenPromise ||
      g._visionRegenPromise ||
      g._reimaginePromise ||
      g._redefinePromise
    );
  }

  function markPlayerStasisSaved() {
    g._playerStasisSavedKey = stasisContentKey(
      g.fusion.visionUrl || g.fusion._url,
      equippedNums()
    );
  }

  function isPlayerStasisSaved() {
    if (!hasVisionFloor()) return false;
    return (
      g._playerStasisSavedKey ===
      stasisContentKey(g.fusion.visionUrl || g.fusion._url, equippedNums())
    );
  }

  function playerStasisReadyForSave() {
    return hasVisionFloor() && !stasisChangesPending() && !isPlayerStasisSaved();
  }

  function getEnemyMosaicCell(enemy) {
    if (!enemy || !enemy.fallout) return null;
    return getMosaicCell(
      g.visionMosaic.focusGx + enemy.compassDx,
      g.visionMosaic.focusGy + enemy.compassDy
    );
  }

  function enemyStasisReadyForSave(enemy) {
    var cell = getEnemyMosaicCell(enemy);
    return !!(cell && cell.status === "ready" && cell.visionUrl && cell.visionImg);
  }

  function isEnemyStasisSaved(enemy) {
    if (!enemy || !enemy.compass) return false;
    return isCompassSlotSaved(enemy.compass);
  }

  function enemyCanSeekSpellChange(enemy) {
    return (
      isEnemyStasisSaved(enemy) &&
      isPlayerStasisSaved() &&
      !enemyCellGenerating(enemy) &&
      !falloutVisionBusyForCompass(enemy.compass) &&
      enemyStasisReadyForSave(enemy)
    );
  }

  function countActiveSaveOrbs(target) {
    return countActiveOrbs(function (o) {
      return o.type === "save_work" && o.saveTarget === target;
    });
  }

  function pruneDuplicateSaveOrbs() {
    if (!g.orbs || !g.orbs.length) return;
    for (var i = 0; i < g.orbs.length; i++) {
      var o = g.orbs[i];
      if (o.taken || o.type !== "save_work") continue;
      if (o.saveTarget === "player" && isPlayerStasisSaved()) {
        o.taken = true;
        continue;
      }
      var enemy = falloutEnemyForCompass(o.saveTarget);
      if (enemy && isEnemyStasisSaved(enemy)) {
        o.taken = true;
      }
    }
  }

  function shouldSpawnSaveOrb(saveTarget) {
    if (saveTarget === "player") {
      return false;
    }
    var enemy = falloutEnemyForCompass(saveTarget);
    if (!enemy) return false;
    return canEnemyPursueSave(enemy) && !isEnemyStasisSaved(enemy);
  }

  function buildSaveWorkOrb(saveTarget) {
    return {
      type: "save_work",
      saveTarget: saveTarget,
      value: SAVE_IMAGE_ORB_REWARD,
      taken: false,
    };
  }

  function spawnSaveWorkOrb(saveTarget, sectorSx, sectorSy, slot) {
    if (!shouldSpawnSaveOrb(saveTarget)) return;
    placeOrbInCluster(buildSaveWorkOrb(saveTarget), "stasis", slot || 0, sectorSx, sectorSy);
  }

  function canCollectSaveOrb(o) {
    if (!o || o.type !== "save_work") return false;
    if (o.saveTarget === "player") return playerStasisReadyForSave();
    var enemy = falloutEnemyForCompass(o.saveTarget);
    if (!enemy) return false;
    return canEnemyPursueSave(enemy);
  }

  function visionImgToBlob(vision, opts) {
    opts = opts || {};
    var maxEdge = opts.maxEdge == null ? SAVE_IMAGE_MAX_EDGE : opts.maxEdge;
    return yieldToMainThread(32).then(function () {
      return new Promise(function (resolve, reject) {
        if (!vision || !vision.complete || !vision.naturalWidth) {
          reject(new Error("No vision image."));
          return;
        }
        var srcW = vision.naturalWidth;
        var srcH = vision.naturalHeight;
        var scale = Math.min(1, maxEdge / Math.max(srcW, srcH));
        var canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(srcW * scale));
        canvas.height = Math.max(1, Math.round(srcH * scale));
        var ctx = canvas.getContext("2d");
        try {
          ctx.drawImage(vision, 0, 0, canvas.width, canvas.height);
        } catch (err) {
          reject(err);
          return;
        }
        canvas.toBlob(
          function (blob) {
            if (!blob) reject(new Error("Could not encode image."));
            else resolve(blob);
          },
          "image/png",
          0.9
        );
      });
    });
  }

  function saveBlobToPickedFolder(blob, filename, opts) {
    opts = opts || {};
    var parts = opts.fallout_compass
      ? [FALLOUT_SAVE_ROOT, FALLOUT_SAVE_FOLDERS[opts.fallout_compass] || opts.fallout_compass]
      : [CENTER_SAVE_FOLDER];
    var chain = Promise.resolve(g._saveDirHandle);
    for (var pi = 0; pi < parts.length; pi++) {
      (function (part) {
        chain = chain.then(function (dir) {
          return dir.getDirectoryHandle(part, { create: true });
        });
      })(parts[pi]);
    }
    return chain.then(function (dir) {
      return saveBlobToDirHandle(dir, blob, filename).then(function () {
        return { path: g._saveDirLabel + "/" + parts.join("/"), filename: filename };
      });
    });
  }

  function saveBlobWithOpts(blob, filename, opts) {
    opts = opts || {};
    if (g._saveDirHandle) {
      return saveBlobToPickedFolder(blob, filename, opts).catch(function (err) {
        if (isLocalGalleryServer()) {
          return saveBlobToServer(blob, filename, opts);
        }
        return Promise.reject(
          err || new Error("Could not write to the picked save folder.")
        );
      });
    }
    if (isLocalGalleryServer()) {
      return saveBlobToServer(blob, filename, opts);
    }
    if (typeof window.showSaveFilePicker === "function") {
      return saveBlobWithPicker(blob, filename).then(function () {
        return { path: "chosen location", filename: filename };
      });
    }
    return saveBlobDownload(blob, filename);
  }

  function saveEnemyStasisDirect(enemy) {
    var cell = getEnemyMosaicCell(enemy);
    if (!cell || !cell.visionImg) return Promise.resolve();
    if (isEnemyStasisSaved(enemy)) return Promise.resolve();
    g._falloutSaveCompass = enemy.compass;
    var folder = FALLOUT_SAVE_FOLDERS[enemy.compass] || enemy.compass;
    var filename = "";
    return visionImgToBlob(cell.visionImg)
      .then(function (blob) {
        return saveBlobWithOpts(blob, filename, {
          fallout_compass: enemy.compass,
          spells: falloutSpellNums(enemy),
        });
      })
      .then(function (result) {
        var spells = compassSpellsForSlot(enemy.compass, cell, enemy);
        markCompassSlotSaved(enemy.compass, cell, spells);
        var where = (result && result.path) || FALLOUT_SAVE_ROOT + "/" + folder;
        finishEnemySaveReward(
          enemy.compassLabel + " saved → " + where + " (+" + SAVE_IMAGE_ORB_REWARD + " orbs)"
        );
      })
      .catch(function (err) {
        setFloorStatus((err && err.message) || "Could not save fallout vision.");
      })
      .finally(function () {
        if (g._falloutSaveCompass === enemy.compass) g._falloutSaveCompass = "";
        enemy._pendingSave = false;
      });
  }

  function saveEnemyStasisFromOrb(enemy) {
    if (!canEnemyPursueSave(enemy) && !g._falloutSaveCompass) {
      enemy._pendingSave = true;
      scheduleStasisAutoSave();
      return Promise.resolve();
    }
    return saveEnemyStasisDirect(enemy);
  }

  function triggerSaveWorkOrb(o) {
    if (!o || o.type !== "save_work") return;
    if (!canCollectSaveOrb(o)) {
      o.taken = true;
      return;
    }
    if (o.saveTarget === "player") {
      saveStasisImage(true);
      return;
    }
    var enemy = falloutEnemyForCompass(o.saveTarget);
    if (enemy) saveEnemyStasisFromOrb(enemy);
  }

  function mosaicHudCellState(key) {
    if (key === "center") {
      syncMosaicCenterCell();
      var centerCell = getMosaicCell(g.visionMosaic.focusGx, g.visionMosaic.focusGy);
      return {
        key: "center",
        label: "Center",
        short: "C",
        isCenter: true,
        cell: centerCell,
        enemy: null,
        compass: null,
      };
    }
    var compass = mosaicCompassByKey(key);
    return {
      key: key,
      label: compass ? compass.label : key,
      short: MOSAIC_HUD_LABELS[key] || key.toUpperCase(),
      isCenter: false,
      cell: compass ? mosaicCellForCompass(compass) : null,
      enemy: falloutEnemyForCompass(key),
      compass: compass,
    };
  }

  function openFalloutVisionFullscreen(hudIdx) {
    var key = MOSAIC_HUD_GRID[hudIdx];
    if (!key) return;
    openStasisVisionDialog(null, hudIdx);
  }

  function bindFalloutHudClicks() {
    for (var i = 0; i < MOSAIC_HUD_GRID.length; i++) {
      (function (idx) {
        var thumb = $("mw-fallout-thumb-" + idx);
        var saveBtn = $("mw-fallout-save-" + idx);
        var refreshBtn = $("mw-fallout-refresh-" + idx);
        if (thumb && !thumb.dataset.falloutBound) {
          thumb.dataset.falloutBound = "1";
          thumb.style.cursor = "pointer";
          thumb.addEventListener("click", function (e) {
            e.stopPropagation();
            openFalloutVisionFullscreen(idx);
          });
        }
        if (saveBtn && !saveBtn.dataset.falloutBound) {
          saveBtn.dataset.falloutBound = "1";
          saveBtn.addEventListener("click", function (e) {
            e.preventDefault();
            e.stopPropagation();
            if (!g.playing || g.menuOpen) return;
            saveStasisMapCell(idx);
          });
        }
        if (refreshBtn && !refreshBtn.dataset.falloutBound) {
          refreshBtn.dataset.falloutBound = "1";
          refreshBtn.addEventListener("click", function (e) {
            e.preventDefault();
            e.stopPropagation();
            if (!g.playing || g.menuOpen) return;
            refreshStasisMapCell(idx);
          });
        }
      })(i);
    }
  }

  function nearestOrbMatching(wx, wy, filter) {
    var best = null;
    var bestD2 = Infinity;
    for (var i = 0; i < g.orbs.length; i++) {
      var o = g.orbs[i];
      if (o.taken || !filter(o)) continue;
      var dx = o.x - wx;
      var dy = o.y - wy;
      var d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = o;
      }
    }
    return best;
  }

  function moveEntityToward(ent, tx, ty, dt, speedMul) {
    speedMul = speedMul == null ? 3.4 : speedMul;
    var dx = tx - ent.x;
    var dy = ty - ent.y;
    var dist = Math.sqrt(dx * dx + dy * dy) || 1;
    var step = ent.speed * speedMul * (dt / 16.667);
    ent.x += (dx / dist) * step;
    ent.y += (dy / dist) * step;
    ent.patrolX = ent.x;
    ent.patrolY = ent.y;
  }

  function pushPlayerTowardOrb(orb, strength) {
    if (!orb) return;
    strength = strength == null ? 2.8 : strength;
    var dx = orb.x - g.wx;
    var dy = orb.y - g.wy;
    var d = Math.sqrt(dx * dx + dy * dy) || 1;
    if (d < 220) {
      g.wx += (dx / d) * strength;
      g.wy += (dy / d) * strength;
      depenetratePlayer();
      clampPlayerToVisionFloor();
      depenetratePlayer();
    }
  }

  function mosaicCompassByKey(key) {
    for (var i = 0; i < MOSAIC_COMPASS.length; i++) {
      if (MOSAIC_COMPASS[i].key === key) return MOSAIC_COMPASS[i];
    }
    return null;
  }

  function falloutEnemyForCompass(key) {
    for (var i = 0; i < g.enemies.length; i++) {
      var e = g.enemies[i];
      if (e.fallout && e.compass === key) return e;
    }
    return null;
  }

  function mosaicCellForCompass(compass) {
    if (!compass || !g.visionMosaic) return null;
    return getMosaicCell(g.visionMosaic.focusGx + compass.dx, g.visionMosaic.focusGy + compass.dy);
  }

  function falloutSpellNums(enemy) {
    if (enemy && enemy.spellSlots && enemy.spellSlots.length) return enemy.spellSlots.slice();
    return equippedNums().slice();
  }

  function scheduleFalloutHudUpdate() {
    if (g._falloutHudRaf) return;
    g._falloutHudRaf = requestAnimationFrame(function () {
      g._falloutHudRaf = 0;
      var now = performance.now();
      if (now - (g._falloutHudLastMs || 0) < 180) {
        scheduleFalloutHudUpdate();
        return;
      }
      g._falloutHudLastMs = now;
      updateFalloutHud(true);
    });
  }

  function ensureFalloutSpellBubbles(cellEl, idx) {
    if (!cellEl) return null;
    var wrap = $("mw-fallout-spells-" + idx);
    var status = cellEl.querySelector(".mw-fallout-status");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.className = "mw-fallout-spells";
      wrap.id = "mw-fallout-spells-" + idx;
      wrap.setAttribute("aria-hidden", "true");
      for (var s = 0; s < 3; s++) {
        var spellImg = document.createElement("img");
        spellImg.className = "mw-fallout-spell";
        spellImg.id = "mw-fallout-spell-" + idx + "-" + s;
        spellImg.width = 12;
        spellImg.height = 12;
        spellImg.loading = "lazy";
        spellImg.alt = "";
        wrap.appendChild(spellImg);
      }
      if (status) cellEl.insertBefore(wrap, status);
      else cellEl.appendChild(wrap);
    } else if (
      wrap.parentElement &&
      wrap.parentElement.classList.contains("mw-fallout-thumb-wrap")
    ) {
      if (status) cellEl.insertBefore(wrap, status);
      else cellEl.appendChild(wrap);
    }
    return wrap;
  }

  function updateFalloutCellSpellBubbles(idx, slot, cell, enemy) {
    var cellEl = $("mw-fallout-cell-" + idx);
    ensureFalloutSpellBubbles(cellEl, idx);
    var spellNums = slot.isCenter
      ? equippedNums()
      : cell && cell.spells && cell.spells.length
        ? cell.spells.slice()
        : falloutSpellNums(enemy);
    for (var s = 0; s < 3; s++) {
      var spellImg = $("mw-fallout-spell-" + idx + "-" + s);
      if (!spellImg) continue;
      var num = spellNums[s];
      if (num) {
        setHudThumb(spellImg, paintingUrlFor(num));
        spellImg.hidden = false;
        spellImg.alt = (slot.short || slot.label) + " spell " + (s + 1) + " #" + num;
        spellImg.title = "#" + num;
      } else {
        spellImg.hidden = true;
        spellImg.removeAttribute("src");
        spellImg.title = "";
      }
    }
  }

  function mosaicCellThumbUrl(cell) {
    if (!cell || !cell.visionImg || !cell.visionImg.complete || !cell.visionImg.naturalWidth) {
      return cell && cell.visionUrl ? cell.visionUrl : "";
    }
    if (cell._thumbUrl) return cell._thumbUrl;
    if (!cell._thumbPending) {
      cell._thumbPending = true;
      var run = function () {
        try {
          var img = cell.visionImg;
          var edge = 112;
          var scale = edge / Math.max(img.naturalWidth, img.naturalHeight);
          var c = document.createElement("canvas");
          c.width = Math.max(1, Math.round(img.naturalWidth * scale));
          c.height = Math.max(1, Math.round(img.naturalHeight * scale));
          c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
          cell._thumbUrl = c.toDataURL("image/jpeg", 0.78);
        } catch (err) {
          cell._thumbUrl = cell.visionUrl || "";
        }
        cell._thumbPending = false;
        scheduleFalloutHudUpdate();
      };
      if (typeof requestIdleCallback === "function") {
        requestIdleCallback(run, { timeout: 1500 });
      } else {
        setTimeout(run, 120);
      }
    }
    return cell.visionUrl || "";
  }

  function updateFalloutHud(fromScheduler) {
    var hud = $("mw-fallout-hud");
    if (!hud) return;
    var show = g.playing && !g.menuOpen && isMuralwalkActive() && hasVisionFloor();
    hud.hidden = !show;
    if (!show) return;
    if (!fromScheduler) {
      scheduleFalloutHudUpdate();
      return;
    }
    bindFalloutHudClicks();
    ensureMosaicRing();
    syncMosaicCenterCell();
    for (var i = 0; i < MOSAIC_HUD_GRID.length; i++) {
      var slot = mosaicHudCellState(MOSAIC_HUD_GRID[i]);
      var key = slot.key;
      var cellEl = $("mw-fallout-cell-" + i);
      var thumb = $("mw-fallout-thumb-" + i);
      var label = $("mw-fallout-label-" + i);
      var orbsEl = $("mw-fallout-orbs-" + i);
      var status = $("mw-fallout-status-" + i);
      var cell = slot.cell;
      var enemy = slot.enemy;
      if (label) label.textContent = slot.short;
      if (orbsEl) {
        if (slot.isCenter) {
          orbsEl.hidden = true;
        } else {
          orbsEl.hidden = false;
          var orbTotal = enemy && enemy.orbTotal ? enemy.orbTotal : 0;
          orbsEl.textContent = String(orbTotal);
          orbsEl.className = "mw-fallout-orbs" + (orbTotal > 0 ? " has-orbs" : "");
          orbsEl.title = orbTotal > 0 ? orbTotal + " orbs collected" : "Orbs collected";
        }
      }
      var imgSrc = "";
      var statText = slot.isCenter ? "center" : enemy ? "hunting" : "—";
      var statClass = "mw-fallout-status";
      var cellClass = "mw-fallout-cell" + (slot.isCenter ? " center-cell" : "");
      if (cell && cell.visionImg) imgSrc = mosaicCellThumbUrl(cell);
      else if (cell && cell.visionUrl) imgSrc = cell.visionUrl;
      if (slot.isCenter) {
        if (g.floorGenerating || g._worldGenPromise) {
          statText = "painting…";
          statClass += " generating";
          cellClass += " generating";
        } else if (isPlayerStasisSaved()) {
          statText = "saved";
          statClass += " ready";
          cellClass += " ready";
        } else if (hasVisionFloor()) {
          statText = "ready";
          statClass += " ready";
          cellClass += " ready";
        }
      } else if (cell && cell.status === "ready" && enemy && isEnemyStasisSaved(enemy)) {
        statText = "saved";
        statClass += " ready";
        cellClass += " ready";
      } else if (cell && cell.status === "ready") {
        statText = "save";
        statClass += " ready";
        cellClass += " ready";
      } else if (cell && cell.status === "generating") {
        statText = "painting…";
        statClass += " generating";
        cellClass += " generating";
      } else if (cell && cell.status === "error") {
        statText = "retry…";
        statClass += " generating";
        cellClass += " generating";
      } else if (
        falloutGenQueuedForCompass(key) ||
        (g._workActive && g._mapLoadCompass === key && g._queueStatus === "fallout_gen")
      ) {
        statText = "loading…";
        statClass += " generating";
        cellClass += " generating";
      } else if (enemy && !enemy.falloutGenDone) {
        statText = enemy.lastOrbType ? "orb" : "collect";
        statClass += " collecting";
        cellClass += " active";
      } else if (enemy) {
        statText = "fed";
        cellClass += " active";
      }
      if (cellEl) {
        cellEl.className = cellClass + (imgSrc ? " has-vision" : "");
        cellEl.dataset.compass = key;
      }
      if (status) {
        status.textContent = statText;
        status.className = statClass;
        if (slot.isCenter) {
          status.title = "Center stasis · saves: saved-stasis/";
        } else {
          var spellNums = falloutSpellNums(enemy);
          var spellLine = spellNums.length
            ? spellNums.map(function (n) { return "#" + n; }).join("·")
            : "";
          var saveFolder = FALLOUT_SAVE_FOLDERS[key] || key;
          status.title =
            slot.label +
            (spellLine ? " · " + spellLine : "") +
            " · saves: saved-fallout/" +
            saveFolder +
            "/";
        }
      }
      if (thumb) {
        if (imgSrc) {
          setHudThumb(thumb, imgSrc);
          thumb.hidden = false;
          thumb.alt = slot.label + " stasis";
        } else {
          thumb.removeAttribute("src");
          thumb.hidden = false;
          thumb.alt = slot.label + " stasis (loading)";
        }
      }
      updateFalloutCellSpellBubbles(i, slot, cell, enemy);
      updateFalloutMapCellButtons(i, slot, cell);
    }
    tryKickFalloutMapQueue();
  }

  function tryKickFalloutMapQueue() {
    if (!g.playing || equippedNums().length < 2 || !hasVisionFloor()) return;
    if (stasisGenBlockedBySaveCycle()) {
      checkStasisSaveCycleProgress();
      return;
    }
    if (!compassCellsNeedingGen().length || falloutGenPipelineBusy()) return;
    ensureFalloutMapLoaded();
  }

  function updateSlotHud() {
    var hud = $("mw-slot-hud");
    if (!hud) return;
    var show = g.playing && !g.menuOpen && isMuralwalkActive();
    hud.hidden = !show;
    var canSelect = canSelectSpellInHud();
    for (var i = 0; i < 3; i++) {
      var thumb = $("mw-slot-hud-thumb-" + i);
      var text = $("mw-slot-hud-text-" + i);
      var selectBtn = $("mw-slot-hud-select-" + i);
      var num = g.slots[i];
      if (selectBtn) {
        selectBtn.disabled = !canSelect;
        selectBtn.title = canSelect
          ? "Pick painting #1–" + TOTAL + " (" + SELECT_SPELL_COST + " orbs)"
          : "Need " + SELECT_SPELL_COST + " orbs to select a spell";
      }
      if (!text) continue;
      if (!num) {
        if (thumb) {
          thumb.hidden = true;
          thumb.removeAttribute("src");
          thumb.title = "Spell " + (i + 1) + " empty";
        }
        text.textContent = "empty";
        text.className = "mw-slot-hud-text empty";
        continue;
      }
      var a = getAnalysis(num);
      var title = a && a.title ? a.title : "Painting";
      if (title.length > 24) title = title.slice(0, 22) + "…";
      var tip = a && a.title ? "#" + num + " — " + a.title : "Painting #" + num;
      text.textContent = "#" + num + " · " + title;
      text.className = "mw-slot-hud-text";
      text.title = tip;
      if (thumb) {
        setHudThumb(thumb, paintingUrlFor(num));
        thumb.hidden = false;
        thumb.alt = "Spell slot " + (i + 1) + ", painting " + num;
        thumb.title = tip;
      }
    }
    updateFalloutHud();
  }

  function updateOrbCounter() {
    var val = $("mw-orb-counter-val");
    var wrap = $("mw-orb-counter");
    if (val) val.textContent = String(g.score);
    if (wrap) {
      wrap.classList.toggle("can-shuffle", canAffordShuffle());
      wrap.title = canAffordShuffle()
        ? SHUFFLE_COST + " orbs to shuffle a spell"
        : "Collect orbs — shuffle costs " + SHUFFLE_COST;
    }
    var menuVal = $("mw-menu-orbs-val");
    var menuHint = $("mw-menu-shuffle-hint");
    var menuWrap = $("mw-menu-orbs");
    if (menuVal) menuVal.textContent = String(g.score);
    if (menuHint) {
      var bits = [];
      if (canAffordShuffle()) {
        bits.push(Math.floor(g.score / SHUFFLE_COST) + " shuffle");
      }
      if (canAffordSelect()) {
        bits.push(Math.floor(g.score / SELECT_SPELL_COST) + " select");
      }
      if (canAffordRedefine()) {
        bits.push(Math.floor(g.score / REDEFINE_COST) + " redefine");
      }
      if (canAffordReimagine()) {
        bits.push(Math.floor(g.score / REIMAGINE_COST) + " reimagine");
      }
      menuHint.textContent = bits.length
        ? bits.join(" · ") + " available"
        : "Shuffle " +
          SHUFFLE_COST +
          " · Select " +
          SELECT_SPELL_COST +
          " · Redefine " +
          REDEFINE_COST +
          " · Reimagine " +
          REIMAGINE_COST;
    }
    if (menuWrap) {
      menuWrap.classList.toggle(
        "can-shuffle",
        canAffordShuffle() || canAffordSelect() || canAffordRedefine() || canAffordReimagine()
      );
      menuWrap.title =
        g.score +
        " orbs — shuffle " +
        SHUFFLE_COST +
        ", select " +
        SELECT_SPELL_COST +
        ", redefine " +
        REDEFINE_COST +
        ", reimagine " +
        REIMAGINE_COST;
    }
  }

  function updateScoreHud() {
    var el = $("mw-score-val");
    if (el) el.textContent = String(g.score);
    updateOrbCounter();
    updateSlotHud();
    var hint = $("mw-swap-hint");
    if (hint) {
      var walkHint = isTouchUI()
        ? "Use the <strong>pad</strong> to walk · <strong>Spells</strong> for spellbook"
        : "Collect orbs · press <strong>B</strong> for spellbook";
      var actionHint =
        " · spell orbs show <strong>slot</strong> + new painting · buzz orbs add extra prompt · <strong>R</strong>/<strong>Im</strong> shift stasis";
      hint.innerHTML = g.menuOpen
        ? "Press <strong>Play</strong> or <strong>Esc</strong> to walk · shuffle spells for <strong>" +
          SHUFFLE_COST +
          "</strong> orbs."
        : g.floorGenerating || g._worldGenPromise
          ? "Stasis floor painting — you can still walk and collect orbs."
          : g.playing
            ? walkHint + actionHint + " · shuffle <strong>" + SHUFFLE_COST + "</strong>."
            : "Equip 2+ spells — floor paints from fused stasis like Spellforge.";
    }
    updateTouchControlsVisible();
  }

  function refreshReadouts() {
    syncEquippedSpells();
    var nums = equippedNums();
    for (var i = 0; i < 3; i++) {
      var shell = $("mw-spell-box-" + i);
      var num = g.slots[i];
      if (!shell) continue;
      if (!num) {
        shell.innerHTML =
          '<span class="mw-spell-box-label">' +
          SLOT_LABELS[i] +
          '</span><p class="mw-spell-box-text">Empty — swap to fill</p>';
        continue;
      }
      shell.title =
        g.playing && !g.menuOpen && canAffordShuffle()
          ? "Shuffle this spell (" + SHUFFLE_COST + " orbs)"
          : g.playing && !g.menuOpen
            ? "Need " + SHUFFLE_COST + " orbs to shuffle"
            : "";
      shell.innerHTML =
        '<span class="mw-spell-box-label">' +
        SLOT_LABELS[i] +
        "</span>" +
        spellReadoutHtml(num);
    }
    var meta = collectCombinedMeta(nums);
    renderChipList($("mw-combined-styles"), meta.styles);
    renderChipList($("mw-combined-tags"), meta.tags);
    var moodEl = $("mw-fused-mood");
    if (moodEl) {
      var mood = meta.moods.join(" · ");
      moodEl.textContent = mood ? "Mood: " + mood : "";
      moodEl.hidden = !mood;
    }
    var st = $("mw-stasis-readout");
    if (st) {
      if (!analysesReady()) {
        st.textContent = "Loading spell analyses…";
      } else {
        st.textContent =
          g.stasisText ||
          (nums.length >= 2
            ? "Stasis will form once spells are blended."
            : "Need 2+ spells for stasis.");
      }
    }
    renderMwBuzzToggles(false);
    renderSpellTicker();
    updateScoreHud();
    updateHudLabel();
    updateSlotHud();
  }

  function formatSpellRef(num) {
    if (!num) return "empty";
    var a = getAnalysis(num);
    var title = a && a.title ? a.title : "Painting";
    return "#" + num + " · " + title;
  }

  function spellSwapMessage(slotIdx, oldNum, newNum) {
    return (
      "Spell slot " +
      (slotIdx + 1) +
      " · " +
      formatSpellRef(oldNum) +
      " → " +
      formatSpellRef(newNum)
    );
  }

  function pickBuzzInjectWord(salt) {
    var nums = equippedNums();
    var words = [];
    if (nums.length >= 2) words = allMwBuzzWords(collectCombinedMeta(nums));
    if (!words.length) {
      words = ["swirl", "haze", "glow", "mist", "violet", "crystalline", "ember", "drift"];
    }
    return words[SM.spellHash(salt, g.score + g.fx.seed) % words.length];
  }

  function applyExtraBuzzFromOrb() {
    var words = getExtraBuzzPromptWords();
    if (!words.length) return;
    var added = 0;
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (g.activeBuzzWords.indexOf(w) < 0) {
        g.activeBuzzWords.push(w);
        added++;
      }
    }
    renderMwBuzzToggles(false);
    var preview = words.join(", ");
    if (preview.length > 48) preview = preview.slice(0, 46) + "…";
    setFloorStatus(
      added
        ? 'Typed extra buzz applied: "' + preview + '"'
        : 'Extra buzz already active: "' + preview + '"',
      { duration: BUZZ_INJECT_STATUS_MS, sticky: false }
    );
    onMwBuzzChanged();
    g.tickerEvents.unshift({
      num: equippedNums()[0] || 0,
      kind: "buzz",
      word: preview,
      ts: Date.now(),
    });
    if (g.tickerEvents.length > 40) g.tickerEvents.length = 40;
    renderSpellTicker();
  }

  function injectBuzzFromOrb(word) {
    word = String(word || "").trim();
    if (!word) return;
    var extra = String(g.extraBuzzPrompt || "").trim();
    var parts = extra
      ? extra.split(/[,;]+/).map(function (s) {
          return s.trim();
        }).filter(Boolean)
      : [];
    if (parts.indexOf(word) < 0) parts.push(word);
    g.extraBuzzPrompt = parts.join(", ");
    var input = $("mw-extra-buzz");
    if (input) input.value = g.extraBuzzPrompt;
    if (g.activeBuzzWords.indexOf(word) < 0) g.activeBuzzWords.push(word);
    renderMwBuzzToggles(false);
    setFloorStatus('Extra buzz injected: "' + word + '"', {
      duration: BUZZ_INJECT_STATUS_MS,
      sticky: false,
    });
    onMwBuzzChanged();
    g.tickerEvents.unshift({
      num: equippedNums()[0] || 0,
      kind: "buzz",
      word: word,
      ts: Date.now(),
    });
    if (g.tickerEvents.length > 40) g.tickerEvents.length = 40;
    renderSpellTicker();
  }

  function applySpellSlotChange(slotIdx, newNum, fromMenu, actionLabel, floorMsg) {
    g.slots[slotIdx] = newNum;
    syncEquippedSpells();
    recordSpellUsed([newNum]);
    g.stasisVariant += 1;
    g.spellShiftCount += 1;
    g.fx.seed += 31;
    g.stasisFromApi = false;
    g._floorRequestKey = "";
    g._aiStasisLanded = false;
    markStasisPending();

    ensureActionOrbs();
    regenerateStasisText();
    layoutWorldEntities();
    refreshReadouts();
    refreshMenuPanel();
    updateScoreHud();
    updateHudLabel();
    preloadPaintingThumbs(equippedNums());
    updateSlotHud();

    if (fromMenu) {
      setMenuStatus(
        (actionLabel || "Spell updated") +
          " — stasis repaints when you close spellbook.",
        null
      );
    } else {
      if (floorMsg) {
        setFloorStatus(floorMsg, { duration: 1000 });
      }
      scheduleStasisFlush();
    }
    return true;
  }

  function shuffleSpellSlot(slotIdx, fromMenu) {
    if (!canAffordShuffle()) {
      var msg = "Need " + SHUFFLE_COST + " orbs to shuffle.";
      setFloorStatus(msg);
      if (fromMenu) setMenuStatus(msg, null);
      return false;
    }
    var used = g.slots.filter(function (n, i) {
      return n && i !== slotIdx;
    });
    var newNum = pickRandomSpell(used);
    if (!newNum) return false;

    g.score -= SHUFFLE_COST;
    saveWallet("spend", { action: "shuffle", cost: SHUFFLE_COST });
    return applySpellSlotChange(slotIdx, newNum, fromMenu, "Shuffled");
  }

  function selectSpellSlot(slotIdx, newNum, fromMenu) {
    if (!canAffordSelect()) {
      var msg = "Need " + SELECT_SPELL_COST + " orbs to select a spell.";
      setFloorStatus(msg);
      if (fromMenu) setMenuStatus(msg, null);
      return false;
    }
    newNum = normalizeSpellNum(newNum);
    if (!newNum) return false;
    var used = g.slots.filter(function (n, i) {
      return n && i !== slotIdx;
    });
    if (used.indexOf(newNum) >= 0) return false;

    g.score -= SELECT_SPELL_COST;
    saveWallet("spend", { action: "select", cost: SELECT_SPELL_COST });
    return applySpellSlotChange(slotIdx, newNum, fromMenu, "Spell #" + newNum + " equipped");
  }

  function formatUsd(amount) {
    var n = Number(amount);
    if (!isFinite(n) || n < 0) n = 0;
    return "$" + n.toFixed(2);
  }

  function walletTotalValue(orbs, usd) {
    return Math.max(0, Number(orbs) || 0) + Math.max(0, Number(usd) || 0) * ORBS_PER_USD;
  }

  function readWalletFromStorage() {
    try {
      var raw = JSON.parse(localStorage.getItem(WALLET_STORAGE_KEY));
      if (!raw || typeof raw !== "object") return null;
      return {
        orbs: Math.max(0, Math.floor(Number(raw.orbs) || 0)),
        usd: Math.max(0, Math.round((Number(raw.usd) || 0) * 100) / 100),
        cashAppTag: String(raw.cashAppTag || "").trim(),
      };
    } catch (err) {
      return null;
    }
  }

  function writeWalletToStorage() {
    try {
      localStorage.setItem(
        WALLET_STORAGE_KEY,
        JSON.stringify({
          orbs: g.score,
          usd: g.usdBalance,
          cashAppTag: g.cashAppTag || "",
          updated: Date.now(),
        })
      );
    } catch (err) {}
  }

  function applyWalletState(orbs, usd, cashAppTag) {
    g.score = Math.max(0, Math.floor(Number(orbs) || 0));
    g.usdBalance = Math.max(0, Math.round((Number(usd) || 0) * 100) / 100);
    if (cashAppTag != null) g.cashAppTag = String(cashAppTag || "").trim();
  }

  function normalizeCashAppTag(tag) {
    tag = String(tag || "").trim();
    if (!tag) return "";
    return tag.charAt(0) === "$" ? tag.slice(1) : tag;
  }

  function cashAppProfileUrl(tag) {
    tag = normalizeCashAppTag(tag);
    return tag ? "https://cash.app/$" + encodeURIComponent(tag) : "";
  }

  function cashAppSendUrl(tag, amountUsd) {
    tag = normalizeCashAppTag(tag);
    amountUsd = Math.round(Number(amountUsd) * 100) / 100;
    if (!tag || !amountUsd) return "";
    return (
      "https://cash.app/$" +
      encodeURIComponent(tag) +
      "/" +
      amountUsd.toFixed(2)
    );
  }

  function receivePayeeLabel() {
    return "$" + GHOST_RECEIVE_CASHTAG;
  }

  function payoutReasonLabel(reason) {
    if (reason === "spell_used" || reason === "ghost_usage") return "spell used";
    if (reason === "spell_saved" || reason === "ghost_save") return "stasis saved";
    return String(reason || "").replace(/_/g, " ");
  }

  function applyGhostRewardResult(data, spellNum, kind) {
    if (!data || data.error) {
      if (data && data.error) {
        setMenuStatus(data.error, null);
      }
      return null;
    }
    if (data.player_usd != null) {
      g.usdBalance = Math.round(Number(data.player_usd) * 100) / 100;
      writeWalletToStorage();
    }
    if (data.cashtag) g.cashAppTag = normalizeCashAppTag(data.cashtag);
    if (data.treasury_balance != null) g.treasuryBalance = Number(data.treasury_balance) || 0;
    var key = String(spellNum || (data.spell != null ? data.spell : ""));
    if (key && data.amount) {
      if (!g.spellStats[key]) g.spellStats[key] = defaultSpellStat();
      g.spellStats[key].earned_usd =
        Math.round(((g.spellStats[key].earned_usd || 0) + Number(data.amount)) * 100) / 100;
      saveSpellStatsLocal();
      syncSpellStatsServer();
      renderSpellTicker();
    }
    updateScoreHud();
    fetchTreasuryStatus();
    return data;
  }

  function ghostRewardUsage(spellNum) {
    if (!isLocalGalleryServer()) return Promise.resolve(null);
    return fetch("/api/muralwalk-ghost", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "usage", spells: [spellNum] }),
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        return applyGhostRewardResult(data, spellNum, "used");
      })
      .catch(function () {
        return null;
      });
  }

  function ghostRewardSave(nums) {
    if (!isLocalGalleryServer()) return Promise.resolve(null);
    return fetch("/api/muralwalk-ghost", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "save", spells: nums || [] }),
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (!data || data.error) {
          return applyGhostRewardResult(data, null, "saved");
        }
        if (data.player_usd != null) {
          g.usdBalance = Math.round(Number(data.player_usd) * 100) / 100;
          writeWalletToStorage();
        }
        if (data.cashtag) g.cashAppTag = normalizeCashAppTag(data.cashtag);
        if (data.treasury_balance != null) g.treasuryBalance = Number(data.treasury_balance) || 0;
        var split = Math.max(1, (nums && nums.length) || 1);
        var each = data.amount ? Number(data.amount) / split : 0;
        (nums || []).forEach(function (n) {
          var key = String(n);
          if (!g.spellStats[key]) g.spellStats[key] = defaultSpellStat();
          g.spellStats[key].earned_usd =
            Math.round(((g.spellStats[key].earned_usd || 0) + each) * 100) / 100;
        });
        saveSpellStatsLocal();
        syncSpellStatsServer();
        renderSpellTicker();
        updateScoreHud();
        fetchTreasuryStatus();
        return data;
      })
      .catch(function () {
        return null;
      });
  }

  function fetchGhostLedger() {
    if (!isLocalGalleryServer()) return Promise.resolve(null);
    return fetch("/api/muralwalk-ledger")
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (data) {
        if (!data || !data.ok) return null;
        g.ghostQueuedTotal = Number(data.queued_total) || 0;
        if (data.usd_balance != null) g.usdBalance = Number(data.usd_balance) || g.usdBalance;
        return data;
      })
      .catch(function () {
        return null;
      });
  }

  function syncWalletServer(action, meta) {
    if (!isLocalGalleryServer()) return Promise.resolve();
    return fetch("/api/muralwalk-wallet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
        action: action || "sync",
        orbs: g.score,
        usd: g.usdBalance,
        cashAppTag: g.cashAppTag || "",
        meta: meta || null,
      }),
    }).catch(function () {});
  }

  function fetchWalletFromServer() {
    if (!isLocalGalleryServer()) return Promise.resolve(null);
    return fetch("/api/muralwalk-wallet")
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (data) {
        if (!data || !data.ok) return null;
        return {
          orbs: Math.max(0, Math.floor(Number(data.orbs) || 0)),
          usd: Math.max(0, Math.round((Number(data.usd) || 0) * 100) / 100),
          cashAppTag: String(data.cashAppTag || "").trim(),
        };
      })
      .catch(function () {
        return null;
      });
  }

  function loadWallet() {
    var local = readWalletFromStorage();
    if (local) applyWalletState(local.orbs, local.usd, local.cashAppTag);
    return fetchWalletFromServer().then(function (remote) {
      if (!remote) return;
      var localVal = local ? walletTotalValue(local.orbs, local.usd) : -1;
      var remoteVal = walletTotalValue(remote.orbs, remote.usd);
      if (remoteVal > localVal) {
        applyWalletState(remote.orbs, remote.usd, remote.cashAppTag);
      } else if (remote.cashAppTag && !g.cashAppTag) {
        g.cashAppTag = remote.cashAppTag;
      }
      writeWalletToStorage();
    });
  }

  function saveWallet(action, meta) {
    writeWalletToStorage();
    syncWalletServer(action, meta);
  }

  function maxConvertibleOrbs() {
    return Math.floor(g.score / MIN_ORB_CONVERT) * MIN_ORB_CONVERT;
  }

  function previewOrbConversion(orbAmount) {
    orbAmount = Math.floor(Number(orbAmount) || 0);
    if (orbAmount < MIN_ORB_CONVERT) return 0;
    if (orbAmount > g.score) return 0;
    return Math.round((orbAmount / ORBS_PER_USD) * 100) / 100;
  }

  function convertOrbsToUsd(orbAmount) {
    orbAmount = Math.floor(Number(orbAmount) || 0);
    if (orbAmount < MIN_ORB_CONVERT) {
      return Promise.resolve({
        ok: false,
        message: "Minimum " + MIN_ORB_CONVERT + " orbs per conversion.",
      });
    }
    if (orbAmount % MIN_ORB_CONVERT !== 0) {
      return Promise.resolve({
        ok: false,
        message: "Convert in multiples of " + MIN_ORB_CONVERT + " orbs.",
      });
    }
    if (orbAmount > g.score) {
      return Promise.resolve({
        ok: false,
        message: "Not enough orbs — you have " + g.score + ".",
      });
    }
    if (isLocalGalleryServer()) {
      return fetch("/api/muralwalk-convert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orbs: orbAmount, orbs_available: g.score }),
      })
        .then(function (r) {
          return r.json().then(function (data) {
            return { httpOk: r.ok, data: data };
          });
        })
        .then(function (res) {
          if (!res.httpOk || !res.data.ok) {
            return {
              ok: false,
              message: (res.data && res.data.error) || "Conversion failed.",
            };
          }
          g.score = res.data.orbs;
          g.usdBalance = res.data.usd;
          g.treasuryBalance = res.data.treasury_balance;
          writeWalletToStorage();
          updateScoreHud();
          fetchTreasuryStatus();
          return {
            ok: true,
            orbs: orbAmount,
            usd: res.data.player_usd,
            balance: g.usdBalance,
            platformUsd: res.data.platform_usd,
          };
        })
        .catch(function () {
          return { ok: false, message: "Conversion failed — is the server running?" };
        });
    }
    var usd = previewOrbConversion(orbAmount);
    g.score -= orbAmount;
    g.usdBalance = Math.round((g.usdBalance + usd) * 100) / 100;
    saveWallet("convert", { orbs: orbAmount, usd: usd });
    updateScoreHud();
    return Promise.resolve({
      ok: true,
      orbs: orbAmount,
      usd: usd,
      balance: g.usdBalance,
    });
  }

  function fetchTreasuryStatus() {
    if (!isLocalGalleryServer()) return Promise.resolve();
    return fetch("/api/muralwalk-treasury")
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (data) {
        if (!data || !data.ok) return;
        g.treasuryBalance = data.balance;
        g.playerSharePct = data.player_share_pct || 80;
        g.platformEarned = data.platform_earned || 0;
        g.ghostQueuedTotal = Number(data.queued_total) || g.ghostQueuedTotal;
        renderOperatorPanel(data);
      })
      .catch(function () {});
  }

  function fundTreasury(amount, note) {
    return fetch("/api/muralwalk-treasury", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "fund",
        amount: amount,
        note: note || "gallery fund",
      }),
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (!data.ok) throw new Error(data.error || "Fund failed.");
        return fetchTreasuryStatus().then(function () {
          return data;
        });
      });
  }

  function renderOperatorPanel(data) {
    var panel = $("mw-operator-panel");
    var summary = $("mw-operator-summary");
    if (!panel) return;
    panel.hidden = !(data && data.admin);
    if (!data || !data.admin) return;
    if (summary) {
      summary.textContent =
        String(data.queued_payouts || 0) +
        " to send → " +
        receivePayeeLabel() +
        " (" +
        formatUsd(g.ghostQueuedTotal) +
        ")";
    }
    refreshPayoutsList();
  }

  function refreshPayoutsList() {
    var list = $("mw-payouts-list");
    if (!list || !isLocalGalleryServer()) return;
    fetch("/api/muralwalk-payouts")
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (data) {
        if (!data || !data.ok || !data.admin) {
          list.innerHTML = "";
          return;
        }
        var payouts = (data.payouts || []).filter(function (p) {
          return p.status === "queued";
        });
        if (!payouts.length) {
          list.innerHTML = "<p class=\"mw-payouts-empty\">All caught up.</p>";
          return;
        }
        list.innerHTML = "";
        (data.payouts || []).forEach(function (p, idx) {
          if (p.status !== "queued") return;
          var payee = normalizeCashAppTag(p.cashtag || GHOST_RECEIVE_CASHTAG);
          var row = document.createElement("div");
          row.className = "mw-payout-row";
          var reason = p.reason ? " · " + escapeHtml(payoutReasonLabel(p.reason)) : "";
          row.innerHTML =
            "<span>" +
            formatUsd(p.amount) +
            " → $" +
            escapeHtml(payee) +
            reason +
            "</span>";
          var sendLink = document.createElement("a");
          sendLink.className = "mw-payout-send";
          sendLink.href = cashAppSendUrl(payee, p.amount);
          sendLink.target = "_blank";
          sendLink.rel = "noopener noreferrer";
          sendLink.textContent = "Send";
          row.appendChild(sendLink);
          var btn = document.createElement("button");
          btn.type = "button";
          btn.className = "mw-stasis-action-btn";
          btn.textContent = "Mark sent";
          btn.addEventListener("click", function () {
            fetch("/api/muralwalk-payouts", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ index: idx }),
            }).then(function () {
              refreshPayoutsList();
              fetchTreasuryStatus();
            });
          });
          row.appendChild(btn);
          list.appendChild(row);
        });
      });
  }

  function addScore(val) {
    g.score += val;
    saveWallet("earn", { amount: val });
    updateScoreHud();
  }

  function updateHudLabel() {
    var idEl = $("mw-painting-id");
    if (!idEl) return;
    var nums = equippedNums();
    if (g.playing && nums.length >= 2) {
      idEl.textContent = "FUSE " + nums.join("·");
    } else {
      idEl.textContent = g.score + " orbs";
    }
  }

  function mosaicCellKey(gx, gy) {
    return gx + "," + gy;
  }

  function mosaicTilePitch() {
    if (!window.StasisWalkFloor || !window.StasisWalkFloor.visionTilePitch) {
      return { pitchX: 420, pitchY: 300, pad: 22 };
    }
    return window.StasisWalkFloor.visionTilePitch(g.w, g.h, g.fusion.visionImg);
  }

  function ensureMosaicRing() {
    var fm = g.visionMosaic;
    for (var i = 0; i < MOSAIC_COMPASS.length; i++) {
      var c = MOSAIC_COMPASS[i];
      var gx = fm.focusGx + c.dx;
      var gy = fm.focusGy + c.dy;
      var key = mosaicCellKey(gx, gy);
      if (!fm.cells[key]) {
        fm.cells[key] = {
          gx: gx,
          gy: gy,
          compass: c.key,
          compassLabel: c.label,
          status: "empty",
          visionUrl: "",
          visionImg: null,
          spells: [],
          stasisText: "",
          buzz: [],
          source: "",
        };
      }
    }
  }

  function syncMosaicCenterCell() {
    if (!hasVisionFloor()) return;
    var fm = g.visionMosaic;
    var key = mosaicCellKey(fm.focusGx, fm.focusGy);
    fm.cells[key] = {
      gx: fm.focusGx,
      gy: fm.focusGy,
      compass: null,
      compassLabel: "Center",
      status: "ready",
      visionUrl: g.fusion.visionUrl || g.fusion._url,
      visionImg: g.fusion.visionImg,
      spells: equippedNums().slice(),
      stasisText: g.stasisText,
      buzz: collectBuzzForEquipped().slice(),
      source: g.fusion.source || "ai",
    };
    ensureMosaicRing();
  }

  function resetVisionMosaic() {
    g.visionMosaic = { focusGx: 0, focusGy: 0, cells: {} };
    g._mosaicDwellMs = 0;
    g._mosaicDwellKey = "";
    g._falloutEnemySeq = 0;
    g._lastPlayerMosaicKey = "";
    g._falloutSaveCompass = "";
    g._falloutCenterWaitQueued = false;
    g._falloutBootDone = false;
    g._mapLoadCompass = "";
    g._mosaicGenInflight = {};
    g._minimapThumbCache = {};
    g.spellProjectiles = [];
    if (hasVisionFloor()) syncMosaicCenterCell();
  }

  function getMosaicCell(gx, gy) {
    return g.visionMosaic.cells[mosaicCellKey(gx, gy)] || null;
  }

  function entityMosaicGrid(wx, wy) {
    var pitch = mosaicTilePitch();
    var relGx = Math.round(wx / pitch.pitchX);
    var relGy = Math.round(wy / pitch.pitchY);
    return {
      gx: g.visionMosaic.focusGx + relGx,
      gy: g.visionMosaic.focusGy + relGy,
      relGx: relGx,
      relGy: relGy,
      fracX: wx / pitch.pitchX - relGx,
      fracY: wy / pitch.pitchY - relGy,
    };
  }

  function playerMosaicGrid() {
    return entityMosaicGrid(g.wx, g.wy);
  }

  function compassInfoForOffset(dx, dy) {
    if (!dx && !dy) {
      return {
        isCenter: true,
        key: "center",
        label: "Center",
        short: "C",
        color: "#c9a227",
        dx: 0,
        dy: 0,
      };
    }
    for (var i = 0; i < MOSAIC_COMPASS.length; i++) {
      var c = MOSAIC_COMPASS[i];
      if (c.dx === dx && c.dy === dy) {
        return {
          isCenter: false,
          key: c.key,
          label: c.label,
          short: c.short,
          color: FALLOUT_ENEMY_COLORS[c.key] || "#c9a227",
          dx: c.dx,
          dy: c.dy,
        };
      }
    }
    return {
      isCenter: false,
      key: "",
      label: "Region",
      short: "?",
      color: "#a8a8b8",
      dx: dx,
      dy: dy,
    };
  }

  function playerCompassInfo() {
    var grid = playerMosaicGrid();
    return compassInfoForOffset(grid.relGx, grid.relGy);
  }

  function hexToRgba(hex, alpha) {
    hex = String(hex || "#888").replace("#", "");
    if (hex.length === 3) {
      hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    }
    var r = parseInt(hex.slice(0, 2), 16) || 120;
    var g = parseInt(hex.slice(2, 4), 16) || 120;
    var b = parseInt(hex.slice(4, 6), 16) || 140;
    return "rgba(" + r + "," + g + "," + b + "," + alpha + ")";
  }

  function buildMosaicDrawPayload() {
    if (!hasVisionFloor()) return null;
    var pitch = mosaicTilePitch();
    var fm = g.visionMosaic;
    var tiles = [];
    var keys = Object.keys(fm.cells);
    var pinfo = playerCompassInfo();
    var activeTile = null;
    var activeImg = g.fusion.visionImg;
    var activeBuzz = collectBuzzForEquipped();
    var activeStasis = g.stasisText;
    for (var i = 0; i < keys.length; i++) {
      var cell = fm.cells[keys[i]];
      if (!cell) continue;
      if (cell.status === "empty" && !cell.visionImg) continue;
      var dgx = cell.gx - fm.focusGx;
      var dgy = cell.gy - fm.focusGy;
      if (Math.abs(dgx) > 1 || Math.abs(dgy) > 1) continue;
      var alpha = cell.status === "ready" ? 0.92 : cell.status === "generating" ? 0.55 : 0.35;
      tiles.push({
        offsetWx: dgx * pitch.pitchX,
        offsetWy: dgy * pitch.pitchY,
        img: cell.visionImg,
        buzz: cell.buzz,
        stasis: cell.stasisText,
        alpha: alpha,
        compass: cell.compass,
      });
    }
    if (!pinfo.isCenter && pinfo.key) {
      var compass = mosaicCompassByKey(pinfo.key);
      var activeCell = compass ? mosaicCellForCompass(compass) : null;
      if (
        activeCell &&
        activeCell.status === "ready" &&
        activeCell.visionImg &&
        activeCell.visionImg.complete
      ) {
        activeTile = {
          offsetWx: compass.dx * pitch.pitchX,
          offsetWy: compass.dy * pitch.pitchY,
          img: activeCell.visionImg,
          buzz: activeCell.buzz,
          stasis: activeCell.stasisText,
          alpha: 0.97,
          compass: pinfo.key,
        };
        activeImg = activeCell.visionImg;
        if (activeCell.buzz && activeCell.buzz.length) activeBuzz = activeCell.buzz;
        if (activeCell.stasisText) activeStasis = activeCell.stasisText;
      }
    }
    if (!tiles.length && g.fusion.visionImg) {
      tiles.push({
        offsetWx: 0,
        offsetWy: 0,
        img: g.fusion.visionImg,
        buzz: collectBuzzForEquipped(),
        stasis: g.stasisText,
        alpha: 0.92,
      });
    }
    return {
      tiles: tiles,
      pitchX: pitch.pitchX,
      pitchY: pitch.pitchY,
      pad: pitch.pad,
      centerImg: g.fusion.visionImg,
      activeTile: activeTile,
      activeImg: activeImg,
      activeBuzz: activeBuzz,
      activeStasis: activeStasis,
      onCompassTile: !!(activeTile && !pinfo.isCenter),
    };
  }

  function compassForEnemy() {
    var used = {};
    for (var i = 0; i < g.enemies.length; i++) {
      if (g.enemies[i].fallout && g.enemies[i].compass) used[g.enemies[i].compass] = true;
    }
    for (var c = 0; c < MOSAIC_COMPASS.length; c++) {
      if (!used[MOSAIC_COMPASS[c].key]) return MOSAIC_COMPASS[c];
    }
    return null;
  }

  function countFalloutEnemies() {
    var n = 0;
    for (var i = 0; i < g.enemies.length; i++) {
      if (g.enemies[i].fallout) n++;
    }
    return n;
  }

  function clonePlayerSpellLoadout() {
    return {
      spellSlots: equippedNums().slice(),
      stasisText: g.stasisText,
      buzz: collectBuzzForEquipped().slice(),
      orbTotal: 0,
    };
  }

  function loadoutForCompass(compass, baseLoadout) {
    baseLoadout = baseLoadout || clonePlayerSpellLoadout();
    var slots = (baseLoadout.spellSlots || equippedNums()).slice();
    if (slots.length < 2 || !compass) return baseLoadout;
    var orderIdx = FALLOUT_HUD_ORDER.indexOf(compass.key);
    if (orderIdx < 0) orderIdx = 0;
    var salt = SM.spellHash(slots[0] * 17 + orderIdx, slots[1] * 31 + g.fx.seed);
    var pick = (salt % TOTAL) + 1;
    var slotIdx = orderIdx % Math.max(1, slots.length);
    slots[slotIdx] = pick;
    if (slots.length > 1) {
      var alt = ((salt >> 4) % TOTAL) + 1;
      slots[(slotIdx + 1) % slots.length] = alt;
    }
    var buzz = (baseLoadout.buzz || collectBuzzForEquipped()).slice();
    var buzzWord = getExtraBuzzPromptWords()[orderIdx % 3];
    if (buzzWord && buzz.indexOf(buzzWord) < 0) buzz.push(buzzWord);
    return {
      spellSlots: slots,
      stasisText: localMixStasis(slots, g.stasisVariant + orderIdx + 2),
      buzz: buzz,
      orbTotal: 0,
    };
  }

  function waitForCenterStasisReady(maxMs) {
    maxMs = maxMs == null ? CENTER_STASIS_WAIT_MS : maxMs;
    if (hasVisionFloor()) return Promise.resolve();
    var start = Date.now();
    return new Promise(function (resolve) {
      function poll() {
        if (hasVisionFloor() || Date.now() - start > maxMs) {
          resolve();
          return;
        }
        setTimeout(poll, 220);
      }
      poll();
    });
  }

  function waitForEnemySpellFeed(enemy, maxMs) {
    maxMs = maxMs == null ? FALLOUT_SPELL_FEED_MS : maxMs;
    if (!enemy) return Promise.resolve();
    var start = Date.now();
    return new Promise(function (resolve) {
      function poll() {
        if (!enemy || !g.playing) {
          resolve();
          return;
        }
        if ((enemy._feedOrbCount || 0) > 0 || enemy.lastOrbType === "spell_shuffle" ||
            enemy.lastOrbType === "spell_select" || enemy.lastOrbType === "buzz_inject" ||
            enemy.lastOrbType === "extra_buzz" || enemy.lastOrbType === "redefine" ||
            enemy.lastOrbType === "reimagine") {
          resolve();
          return;
        }
        if (Date.now() - start > maxMs) {
          resolve();
          return;
        }
        setTimeout(poll, 240);
      }
      poll();
    });
  }

  function enemySpellState(enemy) {
    return {
      nums: falloutSpellNums(enemy),
      stasis: (enemy && enemy.stasisText) || g.stasisText || "",
      buzz:
        enemy && enemy.buzz && enemy.buzz.length
          ? enemy.buzz.slice()
          : collectBuzzForEquipped().slice(),
    };
  }

  function createFalloutEnemyAtCompass(compass, loadout) {
    if (!compass || falloutEnemyForCompass(compass.key)) return null;
    ensureMosaicRing();
    var gx = g.visionMosaic.focusGx + compass.dx;
    var gy = g.visionMosaic.focusGy + compass.dy;
    var key = mosaicCellKey(gx, gy);
    var cell = g.visionMosaic.cells[key];
    loadout = loadout || clonePlayerSpellLoadout();
    var seq = g._falloutEnemySeq++;
    var efp = C.enemyFallbackPlacement(seq);
    var slots = loadout.spellSlots && loadout.spellSlots.length ? loadout.spellSlots : equippedNums();
    var spellNum = slots[seq % Math.max(1, slots.length)] || slots[0] || 1;
    preloadPaintingThumbs(slots);
    var pitch = mosaicTilePitch();
    var enemy = {
      subject: compass.label + " fallout",
      spellNum: spellNum,
      spellSlots: slots.slice(),
      stasisText: loadout.stasisText || g.stasisText,
      buzz: (loadout.buzz || collectBuzzForEquipped()).slice(),
      orbTotal: loadout.orbTotal || 0,
      slot: seq % 3,
      kind: "enemy",
      fallout: true,
      compass: compass.key,
      compassDx: compass.dx,
      compassDy: compass.dy,
      compassLabel: compass.label,
      falloutGenDone: false,
      _pendingSave: false,
      r: 28,
      phase: efp.phase,
      speed: 0.78 + (seq % 5) * 0.08,
      x: compass.dx * pitch.pitchX * 0.72,
      y: compass.dy * pitch.pitchY * 0.72,
      patrolX: compass.dx * pitch.pitchX * 0.72,
      patrolY: compass.dy * pitch.pitchY * 0.72,
      patrolR: 42 + (seq % 4) * 8,
      visionUrl: "",
      outcomeShift: g.spellShiftCount,
      alpha: 1,
    };
    var meta = entityMetaForSpell(spellNum);
    enemy.tags = meta.tags;
    enemy.styles = meta.styles;
    enemy.mood = meta.mood;
    enemy.geometryKind = resolveGeometryKind(enemy);
    g.enemies.push(enemy);
    if (cell && cell.status === "empty") cell.status = "pending";
    return enemy;
  }

  function runFalloutBootStep(compass, baseLoadout) {
    var loadout = loadoutForCompass(compass, baseLoadout);
    preloadPaintingThumbs(loadout.spellSlots);
    var enemy = falloutEnemyForCompass(compass.key);
    if (!enemy) enemy = createFalloutEnemyAtCompass(compass, loadout);
    if (enemy) {
      enemy.spellSlots = loadout.spellSlots.slice();
      enemy.stasisText = loadout.stasisText;
      enemy.buzz = loadout.buzz.slice();
      enemy.spellNum = loadout.spellSlots[0] || enemy.spellNum;
      enemy.falloutGenDone = false;
      enemy._feedOrbCount = 0;
      enemy._pendingSave = false;
    }
    scheduleFalloutHudUpdate();
    return Promise.resolve();
  }

  function mosaicCellGenInflightKey(cell) {
    if (!cell) return "";
    return mosaicCellKey(cell.gx, cell.gy);
  }

  function getMosaicCellGenInflight(cell) {
    var key = mosaicCellGenInflightKey(cell);
    return key ? g._mosaicGenInflight[key] || null : null;
  }

  function trackMosaicCellGenInflight(cell, promise) {
    var key = mosaicCellGenInflightKey(cell);
    if (!key || !promise) return promise;
    g._mosaicGenInflight[key] = promise;
    promise.finally(function () {
      if (g._mosaicGenInflight[key] === promise) {
        delete g._mosaicGenInflight[key];
      }
    });
    return promise;
  }

  function isMosaicCellGenStale(cell) {
    if (!cell || cell.status !== "generating") return false;
    if (getMosaicCellGenInflight(cell)) return false;
    if (!cell._genSince) return true;
    return Date.now() - cell._genSince > 12000;
  }

  function waitForMosaicCellReady(cell, maxMs) {
    maxMs = maxMs == null ? MOSAIC_GEN_STALE_MS : maxMs;
    if (!cell) return Promise.resolve(false);
    if (cell.status === "ready" && cell.visionImg) return Promise.resolve(true);
    var start = Date.now();
    return new Promise(function (resolve) {
      function poll() {
        if (!cell) {
          resolve(false);
          return;
        }
        if (cell.status === "ready" && cell.visionImg) {
          resolve(true);
          return;
        }
        if (cell.status === "error") {
          resolve(false);
          return;
        }
        if (isMosaicCellGenStale(cell)) {
          resolve(false);
          return;
        }
        if (Date.now() - start > maxMs) {
          resolve(false);
          return;
        }
        setTimeout(poll, 420);
      }
      poll();
    });
  }

  function resetMosaicCellForRegen(cell) {
    if (!cell) return;
    cell.status = "pending";
    cell.visionImg = null;
    cell.visionUrl = "";
    cell._thumbUrl = "";
    cell._thumbPending = false;
    cell._genSince = 0;
    delete g._minimapThumbCache[mosaicCellKey(cell.gx, cell.gy)];
  }

  function compassCellsNeedingGen() {
    var need = [];
    ensureMosaicRing();
    for (var i = 0; i < FALLOUT_HUD_ORDER.length; i++) {
      var key = FALLOUT_HUD_ORDER[i];
      var compass = mosaicCompassByKey(key);
      if (!compass) continue;
      var cell = mosaicCellForCompass(compass);
      if (cell && cell.status === "generating") {
        if (isMosaicCellGenStale(cell)) need.push(key);
        continue;
      }
      if (
        !cell ||
        cell.status === "error" ||
        cell.status !== "ready" ||
        !cell.visionUrl ||
        !cell.visionImg
      ) {
        need.push(key);
      }
    }
    return need;
  }

  function applyCompassLoadoutToEnemy(enemy, compass, baseLoadout) {
    if (!enemy || !compass) return;
    var loadout = loadoutForCompass(compass, baseLoadout);
    preloadPaintingThumbs(loadout.spellSlots);
    enemy.spellSlots = loadout.spellSlots.slice();
    enemy.stasisText = loadout.stasisText;
    enemy.buzz = loadout.buzz.slice();
    enemy.spellNum = loadout.spellSlots[0] || enemy.spellNum;
  }

  function compassCellReady(cell) {
    return !!(cell && cell.status === "ready" && cell.visionUrl && cell.visionImg);
  }

  function runFalloutGenStep(compassKey, opts) {
    opts = opts || {};
    var compass = mosaicCompassByKey(compassKey);
    if (!compass) return Promise.resolve();
    var baseLoadout = opts.baseLoadout || clonePlayerSpellLoadout();
    var enemy = falloutEnemyForCompass(compassKey);
    if (!enemy) {
      enemy = createFalloutEnemyAtCompass(compass, loadoutForCompass(compass, baseLoadout));
    }
    if (!enemy) return Promise.resolve();
    applyCompassLoadoutToEnemy(enemy, compass, baseLoadout);
    var cell = getEnemyMosaicCell(enemy);
    if (cell && cell.status === "generating") {
      var inflight = getMosaicCellGenInflight(cell);
      if (inflight) {
        return inflight.then(function () {
          return runFalloutGenStep(compassKey, opts);
        });
      }
      if (isMosaicCellGenStale(cell)) {
        resetMosaicCellForRegen(cell);
        return runFalloutGenStep(compassKey, opts);
      }
      return waitForMosaicCellReady(cell, MOSAIC_GEN_STALE_MS).then(function (ready) {
        cell = getEnemyMosaicCell(enemy);
        if (ready && cell && cell.status === "ready" && cell.visionImg) {
          enemy.falloutGenDone = true;
          enemy.visionUrl = cell.visionUrl || "";
          return Promise.resolve();
        }
        if (cell && cell.status === "generating" && isMosaicCellGenStale(cell)) {
          resetMosaicCellForRegen(cell);
        }
        return runFalloutGenStep(compassKey, opts);
      });
    }
    if (cell && cell.status === "ready" && cell.visionUrl && cell.visionImg) {
      enemy.falloutGenDone = true;
      enemy.visionUrl = cell.visionUrl;
      return Promise.resolve();
    }
    if (opts.skipSpellFeed) {
      enemy.falloutGenDone = false;
      return runFalloutMosaicGen(enemy);
    }
    return waitForEnemySpellFeed(enemy, FALLOUT_SPELL_FEED_MS).then(function () {
      enemy.falloutGenDone = false;
      return runFalloutMosaicGen(enemy);
    });
  }

  function runFalloutBootAll(baseLoadout) {
    if (!g.playing || !hasVisionFloor() || equippedNums().length < 2) {
      return Promise.resolve();
    }
    ensureMosaicRing();
    syncMosaicCenterCell();
    baseLoadout = baseLoadout || clonePlayerSpellLoadout();
    preloadPaintingThumbs(baseLoadout.spellSlots);
    var chain = Promise.resolve();
    for (var b = 0; b < FALLOUT_HUD_ORDER.length; b++) {
      (function (compass) {
        if (!compass) return;
        chain = chain.then(function () {
          runFalloutBootStep(compass, baseLoadout);
          return yieldToMainThread(60);
        });
      })(mosaicCompassByKey(FALLOUT_HUD_ORDER[b]));
    }
    return chain;
  }

  function runFalloutGenStepToCompletion(compassKey, opts, attempt) {
    opts = opts || {};
    attempt = attempt || 0;
    var compass = mosaicCompassByKey(compassKey);
    if (!compass) return Promise.resolve();
    var baseLoadout = opts.baseLoadout || clonePlayerSpellLoadout();
    var enemy = falloutEnemyForCompass(compassKey);
    if (!enemy) {
      enemy = createFalloutEnemyAtCompass(compass, loadoutForCompass(compass, baseLoadout));
    }
    if (!enemy) return Promise.resolve();
    applyCompassLoadoutToEnemy(enemy, compass, baseLoadout);
    enemy.falloutGenDone = false;

    var cell = getEnemyMosaicCell(enemy);
    if (compassCellReady(cell)) {
      enemy.falloutGenDone = true;
      enemy.visionUrl = cell.visionUrl || "";
      return Promise.resolve();
    }

    return runFalloutMosaicGen(enemy)
      .then(function () {
        cell = getEnemyMosaicCell(enemy);
        if (compassCellReady(cell)) {
          enemy.falloutGenDone = true;
          enemy.visionUrl = cell.visionUrl || "";
          return;
        }
        if (attempt >= 2) {
          throw new Error("Compass stasis did not complete.");
        }
        if (cell && cell.status === "error") {
          resetMosaicCellForRegen(cell);
        }
        return yieldToMainThread(480).then(function () {
          return runFalloutGenStepToCompletion(compassKey, opts, attempt + 1);
        });
      });
  }

  function ensureFalloutMapLoaded() {
    if (!g.playing || equippedNums().length < 2) return;
    if (stasisGenBlockedBySaveCycle()) {
      checkStasisSaveCycleProgress();
      return;
    }
    if (!hasVisionFloor()) {
      if (!g._falloutCenterWaitQueued) {
        g._falloutCenterWaitQueued = true;
        enqueueWork(
          "fallout_map_load",
          "center-wait",
          function () {
            return waitForCenterStasisReady().then(function () {
              g._falloutCenterWaitQueued = false;
              ensureFalloutMapLoaded();
            });
          },
          45
        );
      }
      return;
    }
    if (falloutGenPipelineBusy()) return;

    if (!g._falloutBootDone) {
      enqueueWork(
        "fallout_map_load",
        "boot",
        function () {
          return runFalloutBootAll().then(function () {
            g._falloutBootDone = true;
            scheduleFalloutHudUpdate();
          });
        },
        45
      );
      return;
    }

    var need = compassCellsNeedingGen();
    if (!need.length) return;

    var nextKey = need[0];
    var step = FALLOUT_HUD_ORDER.indexOf(nextKey) + 1;
    var label = MOSAIC_HUD_LABELS[nextKey] || nextKey.toUpperCase();
    var baseLoadout = clonePlayerSpellLoadout();
    purgeFalloutVisionQueue(nextKey);
    enqueueWork(
      "fallout_gen",
      nextKey,
      function () {
        g._mapLoadCompass = nextKey;
        setFloorStatus("Stasis map " + step + "/8 · " + label, {
          duration: 1600,
          sticky: false,
        });
        scheduleFalloutHudUpdate();
        return runFalloutGenStepToCompletion(nextKey, { baseLoadout: baseLoadout })
          .then(function () {
            var doneCell = mosaicCellForCompass(mosaicCompassByKey(nextKey));
            if (!compassCellReady(doneCell)) {
              throw new Error("Compass tile not ready.");
            }
            setFloorStatus(label + " stasis painted.", {
              duration: 900,
              sticky: false,
            });
            if (!compassCellsNeedingGen().length) {
              if (hasUnsavedStasisPieces()) {
                checkStasisSaveCycleProgress();
              } else {
                setFloorStatus("Stasis map loaded — all 9 stasis visions ready.", {
                  duration: 2400,
                  sticky: false,
                });
              }
            }
          })
          .catch(function () {
            scheduleFalloutHudUpdate();
            if (!stasisGenBlockedBySaveCycle()) ensureFalloutMapLoaded();
            else checkStasisSaveCycleProgress();
          })
          .finally(function () {
            if (g._mapLoadCompass === nextKey) g._mapLoadCompass = "";
            scheduleFalloutHudUpdate();
            updateGameSaveButtons();
          });
      },
      46
    );
  }

  function spawnMissingFalloutEnemies() {
    if (!g.playing || !hasVisionFloor() || equippedNums().length < 2) return;
    var baseLoadout = clonePlayerSpellLoadout();
    var spawned = false;
    for (var i = 0; i < FALLOUT_HUD_ORDER.length; i++) {
      var compass = mosaicCompassByKey(FALLOUT_HUD_ORDER[i]);
      if (!compass || falloutEnemyForCompass(compass.key)) continue;
      createFalloutEnemyAtCompass(compass, loadoutForCompass(compass, baseLoadout));
      spawned = true;
    }
    if (spawned) scheduleFalloutHudUpdate();
  }

  function maybeSpawnAllFalloutEnemies() {
    if (!g.playing || equippedNums().length < 2) return;
    ensureFalloutMapLoaded();
    spawnMissingFalloutEnemies();
  }

  function applyOrbToEnemyState(enemy, orb) {
    if (!enemy) return;
    if (!enemy.spellSlots || !enemy.spellSlots.length) {
      enemy.spellSlots = equippedNums().slice();
    }
    if (!enemy.buzz) enemy.buzz = collectBuzzForEquipped().slice();
    if (!enemy.stasisText) enemy.stasisText = g.stasisText;
    if (!orb) return;
    if (orb.type === "score") {
      enemy.orbTotal = (enemy.orbTotal || 0) + (orb.value || 0);
      enemy.lastOrbType = "score";
      enemy.lastOrbValue = orb.value || 0;
      return;
    }
    enemy._feedOrbCount = (enemy._feedOrbCount || 0) + 1;
    var mix = falloutSpellStateFromOrb(orb, enemy);
    enemy.spellSlots = mix.nums;
    enemy.stasisText = mix.stasis;
    enemy.buzz = mix.buzz;
    enemy.spellNum = mix.nums[0] || enemy.spellNum;
    enemy.lastOrbType = orb.type;
    enemy.lastOrbValue = orb.spellNum || orb.buzzWord || orb.value || orb.type;
    preloadPaintingThumbs(mix.nums);
  }

  function falloutSpellStateFromOrb(orb, enemy) {
    var mix = enemySpellState(enemy);
    var nums = mix.nums.slice();
    var stasis = mix.stasis;
    var buzz = mix.buzz.slice();
    if (!orb) return { nums: nums, stasis: stasis, buzz: buzz };
    if (orb.type === "spell_shuffle" || orb.type === "spell_select") {
      if (orb.spellNum != null && orb.slotIdx != null) nums[orb.slotIdx] = orb.spellNum;
    } else if (orb.type === "buzz_inject" && orb.buzzWord) {
      if (buzz.indexOf(orb.buzzWord) < 0) buzz.push(orb.buzzWord);
    } else if (orb.type === "extra_buzz") {
      getExtraBuzzPromptWords().forEach(function (w) {
        if (buzz.indexOf(w) < 0) buzz.push(w);
      });
    } else if (orb.type === "redefine" || orb.type === "reimagine") {
      stasis = localMixStasis(nums, g.stasisVariant + (orb.type === "reimagine" ? 3 : 1));
    }
    return { nums: nums, stasis: stasis, buzz: buzz };
  }

  function loadMosaicCellImage(cell, url) {
    if (!cell || !url) return Promise.resolve();
    return yieldToMainThread(24).then(function () {
      return new Promise(function (resolve, reject) {
        var img = new Image();
        var isLocal = url.indexOf("data:") === 0 || url.indexOf("blob:") === 0;
        if (!isLocal) img.crossOrigin = "anonymous";
        img.loading = "eager";
        var finalize = function () {
          cell.visionImg = img;
          cell.visionUrl = url;
          cell.status = "ready";
          cell._thumbUrl = "";
          cell._thumbPending = false;
          delete g._minimapThumbCache[mosaicCellKey(cell.gx, cell.gy)];
          scheduleFalloutHudUpdate();
          resolve();
        };
        img.onload = function () {
          if (img.decode) {
            img.decode().then(finalize).catch(finalize);
          } else {
            setTimeout(finalize, 0);
          }
        };
        img.onerror = function () {
          cell.status = "error";
          cell._genSince = 0;
          reject(new Error("Mosaic image failed to load."));
        };
        img.src = url;
      });
    });
  }

  function runFalloutMosaicGen(enemy) {
    if (!enemy || !window.StasisFloorGen || !window.StasisFloorGen.generateVision) {
      return Promise.resolve();
    }
    var gx = g.visionMosaic.focusGx + enemy.compassDx;
    var gy = g.visionMosaic.focusGy + enemy.compassDy;
    var key = mosaicCellKey(gx, gy);
    ensureMosaicRing();
    var cell = g.visionMosaic.cells[key];
    if (!cell) return Promise.resolve();

    var inflight = getMosaicCellGenInflight(cell);
    if (cell.status === "generating") {
      if (inflight) return inflight;
      if (isMosaicCellGenStale(cell)) {
        resetMosaicCellForRegen(cell);
      } else {
        return waitForMosaicCellReady(cell, MOSAIC_GEN_STALE_MS);
      }
    }
    if (cell.status === "ready" && !enemyCanSeekSpellChange(enemy)) {
      enemy.falloutGenDone = true;
      enemy.visionUrl = cell.visionUrl || "";
      return Promise.resolve();
    }
    if (cell.status === "ready") {
      cell.status = "pending";
      cell.visionImg = null;
      enemy.falloutGenDone = false;
    }

    var mix = enemySpellState(enemy);
    if (mix.nums.length < 2 || !mix.stasis.trim()) return Promise.resolve();

    var genPromise = window.StasisFloorGen.checkHealth()
      .then(function (health) {
        return window.StasisFloorGen.generateVision(
          mix.nums,
          mix.stasis,
          mix.buzz,
          health,
          function (statusMsg) {
            if (!statusMsg || !g.playing) return;
            var msg = String(statusMsg);
            if (/queued|pending/i.test(msg)) {
              msg = "painting stasis…";
            }
            setFloorStatus(enemy.compassLabel + " · " + msg, {
              duration: 1400,
              sticky: false,
            });
          }
        );
      })
      .then(function (url) {
        if (!url) throw new Error("No fallout vision.");
        cell.source = "ai";
        return loadMosaicCellImage(cell, url);
      })
      .then(function () {
        if (cell.status !== "ready" || !cell.visionImg) {
          throw new Error("Fallout vision did not land.");
        }
        enemy.falloutGenDone = true;
        enemy.visionUrl = cell.visionUrl || "";
        return yieldToMainThread(120);
      })
      .then(function () {
        setFloorStatus(enemy.compassLabel + " stasis painted.", {
          duration: 650,
          sticky: false,
        });
        scheduleFalloutHudUpdate();
        return yieldToMainThread(280);
      })
      .then(function () {
        recordEntityOutcome("fallout-" + enemy.compass);
        return yieldToMainThread(FALLOUT_SAVE_DEFER_MS);
      })
      .then(function () {
        setTimeout(function () {
          ensureActionOrbs();
        }, 600);
        if (allNineStasisGalleryReady() && hasUnsavedStasisPieces()) {
          checkStasisSaveCycleProgress();
        } else if (!compassCellsNeedingGen().length) {
          ensureFalloutMapLoaded();
        }
      })
      .catch(function () {
        cell.status = "error";
        cell._genSince = 0;
        enemy.falloutGenDone = false;
        scheduleFalloutHudUpdate();
        if (!stasisGenBlockedBySaveCycle()) ensureFalloutMapLoaded();
        else checkStasisSaveCycleProgress();
      })
      .finally(function () {
        if (cell.status === "ready") cell._genSince = 0;
      });

    trackMosaicCellGenInflight(cell, genPromise);
    cell.status = "generating";
    cell._genSince = Date.now();
    cell.spells = mix.nums.slice();
    cell.stasisText = mix.stasis;
    cell.buzz = mix.buzz.slice();
    cell.compass = enemy.compass;
    cell.compassLabel = enemy.compassLabel;
    g.spellShiftCount += 1;
    scheduleFalloutHudUpdate();
    return genPromise;
  }

  function triggerFalloutMosaicGen(enemy, orb) {
    if (!enemy || enemy.falloutGenDone) return;
    if (stasisGenBlockedBySaveCycle() || stasisSpellHuntBlocked()) return;
    if (!window.StasisFloorGen || !window.StasisFloorGen.generateVision) return;
    var gx = g.visionMosaic.focusGx + enemy.compassDx;
    var gy = g.visionMosaic.focusGy + enemy.compassDy;
    ensureMosaicRing();
    var cell = g.visionMosaic.cells[mosaicCellKey(gx, gy)];
    if (!cell) return;
    if (getMosaicCellGenInflight(cell)) return;
    if (cell.status === "generating" && !isMosaicCellGenStale(cell)) return;
    if (falloutVisionBusyForCompass(enemy.compass)) return;
    if (cell.status === "ready" && !enemyCanSeekSpellChange(enemy)) {
      enemy.falloutGenDone = true;
      return;
    }
    var mix = enemySpellState(enemy);
    if (mix.nums.length < 2 || !mix.stasis.trim()) return;
    enqueueWork(
      "fallout_vision",
      enemy.compass,
      function () {
        return runFalloutMosaicGen(enemy);
      },
      2
    );
  }

  function enemyCollectOrbs() {
    if (!g.enemies.length) return;
    var collected = false;
    for (var ei = 0; ei < g.enemies.length; ei++) {
      var e = g.enemies[ei];
      if (!e.fallout) continue;
      for (var i = 0; i < g.orbs.length; i++) {
        var o = g.orbs[i];
        if (o.taken) continue;
        var dx = o.x - e.x;
        var dy = o.y - e.y;
        if (dx * dx + dy * dy >= ORB_R * ORB_R) continue;
        if (o.type === "save_work") {
          if (o.saveTarget !== e.compass || !canCollectSaveOrb(o)) continue;
          o.taken = true;
          e._pendingSave = true;
          queueEnemyFalloutSave(e);
          processPendingFalloutSaves();
          collected = true;
          break;
        }
        if (!enemyMayCollectActionOrb(e, o)) continue;
        o.taken = true;
        applyOrbToEnemyState(e, o);
        collected = true;
        if (o.type === "score") {
          ensureActionOrbs();
          break;
        }
        if (enemyCanSeekSpellChange(e)) {
          var cell = getEnemyMosaicCell(e);
          if (cell) cell.status = "pending";
          e.falloutGenDone = false;
          triggerFalloutMosaicGen(e, o);
        } else if (!e.falloutGenDone) {
          triggerFalloutMosaicGen(e, o);
        }
        ensureActionOrbs();
        break;
      }
    }
    if (collected) scheduleFalloutHudUpdate();
  }

  function promoteMosaicCell(gx, gy) {
    var cell = getMosaicCell(gx, gy);
    if (!cell || cell.status !== "ready" || !cell.visionUrl) return;
    var pitch = mosaicTilePitch();
    var dgx = gx - g.visionMosaic.focusGx;
    var dgy = gy - g.visionMosaic.focusGy;
    if (!dgx && !dgy) return;

    g.wx -= dgx * pitch.pitchX;
    g.wy -= dgy * pitch.pitchY;
    g.camWx -= dgx * pitch.pitchX;
    g.camWy -= dgy * pitch.pitchY;
    g.visionMosaic.focusGx = gx;
    g.visionMosaic.focusGy = gy;

    if (cell.spells && cell.spells.length >= 2) {
      for (var i = 0; i < 3; i++) g.slots[i] = cell.spells[i] || null;
      syncEquippedSpells();
    }
    if (cell.stasisText) {
      g.stasisText = cell.stasisText;
      g.stasisFromApi = true;
    }
    if (cell.buzz && cell.buzz.length) {
      g.activeBuzzWords = cell.buzz.slice();
      renderMwBuzzToggles(false);
    }

    var focusLabel = cell.compassLabel || "new center";
    cell.compass = null;
    cell.compassLabel = "Center";
    g.spellShiftCount += 1;
    loadFusionImage(cell.visionUrl, g.floorUnlocked, cell.source || "ai", {
      action: "mosaic-focus",
    }).then(function () {
      publishToSpellforge();
      layoutWorldEntities();
      refreshReadouts();
      setFloorStatus("Focus saved — " + focusLabel + ".", {
        duration: FLOOR_OUTCOME_DISMISS_MS,
      });
    });
    ensureMosaicRing();
    g._mosaicDwellMs = 0;
    g._mosaicDwellKey = "";
    g._lastPlayerMosaicKey = "";
  }

  function compassLabelForOffset(dx, dy) {
    for (var i = 0; i < MOSAIC_COMPASS.length; i++) {
      var c = MOSAIC_COMPASS[i];
      if (c.dx === dx && c.dy === dy) return c.label;
    }
    return "Region";
  }

  function updateMosaicRegionNotice() {
    if (!g.playing || g.menuOpen || !hasVisionFloor()) return;
    var grid = playerMosaicGrid();
    var key = mosaicCellKey(grid.gx, grid.gy);
    if (key === g._lastPlayerMosaicKey) return;
    g._lastPlayerMosaicKey = key;
    updateGameSaveButtons();
    var isCenter =
      grid.gx === g.visionMosaic.focusGx && grid.gy === g.visionMosaic.focusGy;
    if (isCenter) return;
    var cell = getMosaicCell(grid.gx, grid.gy);
    var label =
      (cell && cell.compassLabel) ||
      compassLabelForOffset(grid.relGx, grid.relGy);
    setFloorStatus("Entering " + label + " compass", {
      duration: 650,
      sticky: false,
    });
  }

  function getMinimapThumb(cacheKey, visionImg) {
    if (!visionImg || !visionImg.complete || !visionImg.naturalWidth) return null;
    var src = visionImg.src || visionImg.currentSrc || "";
    var entry = g._minimapThumbCache[cacheKey];
    if (entry && entry.ready && entry.src === src && entry.canvas) return entry.canvas;
    try {
      var size = 40;
      var c = document.createElement("canvas");
      c.width = size;
      c.height = size;
      c.getContext("2d").drawImage(visionImg, 0, 0, size, size);
      g._minimapThumbCache[cacheKey] = { ready: true, canvas: c, src: src };
      return c;
    } catch (err) {
      return null;
    }
  }

  function drawMinimapCellLabel(ctx, x, y, w, h, text, color, isCenter) {
    ctx.save();
    ctx.font = (isCenter ? "bold 8px" : "bold 7px") + " Courier New, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    var lx = x + w / 2;
    var ly = y + h - 1;
    ctx.fillStyle = "rgba(0,0,0,0.72)";
    ctx.fillRect(x, y + h - 10, w, 10);
    ctx.fillStyle = color || "#f5e6a8";
    ctx.fillText(text, lx, ly);
    ctx.restore();
  }

  function mosaicMinimapCellColor(cell, isCenter) {
    if (isCenter) return "rgba(201,162,39,0.35)";
    if (!cell || cell.status === "empty") return "rgba(40,38,48,0.92)";
    if (cell.status === "generating") return "rgba(220,160,70,0.88)";
    if (cell.status === "ready") return "rgba(90,180,120,0.82)";
    if (cell.status === "error") return "rgba(180,70,70,0.88)";
    return "rgba(80,75,95,0.9)";
  }

  function drawMinimapEntityMarker(ctx, x, y, color, label, isPlayer) {
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.75)";
    ctx.beginPath();
    ctx.arc(x, y, isPlayer ? 4.5 : 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, isPlayer ? 3.2 : 2.4, 0, Math.PI * 2);
    ctx.fill();
    if (isPlayer) {
      ctx.strokeStyle = "#fff8e8";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x - 5, y);
      ctx.lineTo(x + 5, y);
      ctx.moveTo(x, y - 5);
      ctx.lineTo(x, y + 5);
      ctx.stroke();
    }
    if (label) {
      ctx.font = (isPlayer ? "bold 7px" : "7px") + " Courier New, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = "rgba(0,0,0,0.85)";
      ctx.fillText(label, x + 0.5, y + (isPlayer ? 5 : 4));
      ctx.fillStyle = isPlayer ? "#fff8e8" : color;
      ctx.fillText(label, x, y + (isPlayer ? 4.5 : 3.5));
    }
    ctx.restore();
  }

  function drawCompassRegionBorder(ctx) {
    if (!g.playing || !hasVisionFloor()) return;
    var info = playerCompassInfo();
    if (info.isCenter) return;
    var t = Date.now() * 0.0035;
    var pulse = 0.5 + Math.sin(t) * 0.22;
    var thick = 18;
    var w = g.w;
    var h = g.h;
    var edge = hexToRgba(info.color, pulse);
    var soft = hexToRgba(info.color, pulse * 0.45);

    ctx.save();
    if (info.dy < 0) {
      var gTop = ctx.createLinearGradient(0, 0, 0, thick * 2.2);
      gTop.addColorStop(0, edge);
      gTop.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = gTop;
      ctx.fillRect(0, 0, w, thick * 2.2);
    }
    if (info.dy > 0) {
      var gBot = ctx.createLinearGradient(0, h, 0, h - thick * 2.2);
      gBot.addColorStop(0, edge);
      gBot.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = gBot;
      ctx.fillRect(0, h - thick * 2.2, w, thick * 2.2);
    }
    if (info.dx < 0) {
      var gLeft = ctx.createLinearGradient(0, 0, thick * 2.2, 0);
      gLeft.addColorStop(0, edge);
      gLeft.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = gLeft;
      ctx.fillRect(0, 0, thick * 2.2, h);
    }
    if (info.dx > 0) {
      var gRight = ctx.createLinearGradient(w, 0, w - thick * 2.2, 0);
      gRight.addColorStop(0, edge);
      gRight.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = gRight;
      ctx.fillRect(w - thick * 2.2, 0, thick * 2.2, h);
    }

    ctx.lineWidth = 3;
    ctx.strokeStyle = soft;
    if (info.dy < 0) {
      ctx.beginPath();
      ctx.moveTo(0, 1.5);
      ctx.lineTo(w, 1.5);
      ctx.stroke();
    }
    if (info.dy > 0) {
      ctx.beginPath();
      ctx.moveTo(0, h - 1.5);
      ctx.lineTo(w, h - 1.5);
      ctx.stroke();
    }
    if (info.dx < 0) {
      ctx.beginPath();
      ctx.moveTo(1.5, 0);
      ctx.lineTo(1.5, h);
      ctx.stroke();
    }
    if (info.dx > 0) {
      ctx.beginPath();
      ctx.moveTo(w - 1.5, 0);
      ctx.lineTo(w - 1.5, h);
      ctx.stroke();
    }

    var label = info.label.toUpperCase();
    ctx.font = "bold 12px Courier New, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    var lx = w / 2;
    var ly = 16;
    if (info.dy > 0 && !info.dx) ly = h - 16;
    else if (info.dx > 0 && info.dy < 0) {
      lx = w - 72;
      ly = 18;
    } else if (info.dx < 0 && info.dy < 0) {
      lx = 72;
      ly = 18;
    } else if (info.dx > 0 && info.dy > 0) {
      lx = w - 72;
      ly = h - 18;
    } else if (info.dx < 0 && info.dy > 0) {
      lx = 72;
      ly = h - 18;
    } else if (info.dx > 0) {
      lx = w - 56;
      ly = h / 2;
    } else if (info.dx < 0) {
      lx = 56;
      ly = h / 2;
    }
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(0,0,0,0.85)";
    ctx.strokeText(label, lx, ly);
    ctx.fillStyle = info.color;
    ctx.fillText(label, lx, ly);
    ctx.restore();
  }

  function drawMosaicMinimap(ctx) {
    if (!g.playing || !hasVisionFloor()) return;
    syncMosaicCenterCell();
    var fm = g.visionMosaic;
    var grid = playerMosaicGrid();
    var pinfo = playerCompassInfo();
    var cellSize = 34;
    var gap = 3;
    var pad = 10;
    var originX = pad;
    var originY = pad + 10;
    var gridW = cellSize * 3 + gap * 2;
    var boxW = gridW + 18;
    var boxH = gridW + 42;

    ctx.save();
    ctx.fillStyle = "rgba(6,5,8,0.88)";
    ctx.strokeStyle = "rgba(201,162,39,0.55)";
    ctx.lineWidth = 2;
    ctx.fillRect(originX - 6, originY - 16, boxW, boxH);
    ctx.strokeRect(originX - 6, originY - 16, boxW, boxH);

    ctx.font = "bold 9px Courier New, monospace";
    ctx.textAlign = "left";
    ctx.fillStyle = "#e8d8a0";
    ctx.fillText("STASIS MAP", originX, originY - 6);

    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        var gx = fm.focusGx + dx;
        var gy = fm.focusGy + dy;
        var cell = getMosaicCell(gx, gy);
        var isCenter = !dx && !dy;
        var cinfo = compassInfoForOffset(dx, dy);
        var cx = originX + (dx + 1) * (cellSize + gap);
        var cy = originY + (dy + 1) * (cellSize + gap);
        var inner = cellSize - 2;
        var cacheKey = mosaicCellKey(gx, gy);
        var visionImg = isCenter ? g.fusion.visionImg : cell && cell.visionImg;
        var miniThumb = getMinimapThumb(cacheKey, visionImg);

        ctx.fillStyle = mosaicMinimapCellColor(cell, isCenter);
        ctx.fillRect(cx, cy, inner, inner);
        if (miniThumb) {
          try {
            ctx.drawImage(miniThumb, cx, cy, inner, inner);
          } catch (err) {}
        } else if (!isCenter && (!cell || cell.status === "empty")) {
          ctx.fillStyle = "rgba(20,18,24,0.92)";
          ctx.fillRect(cx, cy, inner, inner);
        }

        if (!isCenter) {
          ctx.strokeStyle = hexToRgba(cinfo.color, 0.95);
          ctx.lineWidth = grid.gx === gx && grid.gy === gy ? 3 : 2;
          ctx.strokeRect(cx - 0.5, cy - 0.5, inner + 1, inner + 1);
          drawMinimapCellLabel(ctx, cx, cy, inner, inner, cinfo.short, cinfo.color, false);
        } else {
          ctx.strokeStyle = "rgba(201,162,39,0.9)";
          ctx.lineWidth = 2;
          ctx.strokeRect(cx - 0.5, cy - 0.5, inner + 1, inner + 1);
          drawMinimapCellLabel(ctx, cx, cy, inner, inner, "C", "#f5e6a8", true);
        }

        if (grid.gx === gx && grid.gy === gy) {
          ctx.strokeStyle = "#fff8e8";
          ctx.lineWidth = 2;
          ctx.strokeRect(cx - 2, cy - 2, inner + 4, inner + 4);
        }
      }
    }

    var pCellX = originX + (grid.relGx + 1) * (cellSize + gap);
    var pCellY = originY + (grid.relGy + 1) * (cellSize + gap);
    var pInner = cellSize - 2;
    drawMinimapEntityMarker(
      ctx,
      pCellX + pInner / 2 + grid.fracX * (pInner * 0.38),
      pCellY + pInner / 2 + grid.fracY * (pInner * 0.38),
      "#fff0b8",
      "P",
      true
    );

    for (var ej = 0; ej < g.enemies.length; ej++) {
      var enemy = g.enemies[ej];
      if (!enemy.fallout) continue;
      var eg = entityMosaicGrid(enemy.x, enemy.y);
      var edx = eg.gx - fm.focusGx;
      var edy = eg.gy - fm.focusGy;
      if (Math.abs(edx) > 1 || Math.abs(edy) > 1) continue;
      var eCellX = originX + (edx + 1) * (cellSize + gap);
      var eCellY = originY + (edy + 1) * (cellSize + gap);
      var eColor = FALLOUT_ENEMY_COLORS[enemy.compass] || "#ff9898";
      drawMinimapEntityMarker(
        ctx,
        eCellX + pInner / 2 + eg.fracX * (pInner * 0.34),
        eCellY + pInner / 2 + eg.fracY * (pInner * 0.34),
        eColor,
        enemy.compass ? enemy.compass.toUpperCase() : "E",
        false
      );
    }

    var textY = originY + gridW + 8;
    ctx.textAlign = "left";
    ctx.font = "bold 8px Courier New, monospace";
    ctx.fillStyle = "#fff0b8";
    ctx.fillText(
      "YOU " +
        (g.wx | 0) +
        "," +
        (g.wy | 0) +
        " · tile " +
        grid.relGx +
        "," +
        grid.relGy +
        " · " +
        pinfo.short,
      originX,
      textY
    );
    if (workQueueDepth() > 0) {
      ctx.fillStyle = "rgba(200,220,255,0.9)";
      ctx.fillText("queue " + workQueueDepth(), originX + boxW - 52, textY);
    }
    ctx.restore();
  }

  function applySpellOrbMagnet() {
    if (!g.playing || g.menuOpen || !canWalk()) return;
    var best = null;
    var bestD2 = ORB_SPELL_PICKUP_R * ORB_SPELL_PICKUP_R * 2.2;
    for (var i = 0; i < g.orbs.length; i++) {
      var o = g.orbs[i];
      if (o.taken) continue;
      if (o.type !== "spell_shuffle" && o.type !== "spell_select") continue;
      if (!canCollectActionOrb(o)) continue;
      var dx = o.x - g.wx;
      var dy = o.y - g.wy;
      var d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = { dx: dx, dy: dy, d2: d2 };
      }
    }
    if (!best) return;
    var dist = Math.sqrt(best.d2) || 1;
    var reach = ORB_SPELL_PICKUP_R * 1.35;
    if (dist > reach) return;
    var pull = Math.min(3.2, (reach - dist) * 0.14);
    g.wx += (best.dx / dist) * pull;
    g.wy += (best.dy / dist) * pull;
  }

  function updateMosaicDwell(dt) {
    if (!g.playing || g.menuOpen || !hasVisionFloor()) {
      g._mosaicDwellMs = 0;
      g._mosaicDwellKey = "";
      return;
    }
    var grid = playerMosaicGrid();
    var key = mosaicCellKey(grid.gx, grid.gy);
    var cell = getMosaicCell(grid.gx, grid.gy);
    var isCenter = grid.gx === g.visionMosaic.focusGx && grid.gy === g.visionMosaic.focusGy;

    if (isCenter || !cell || cell.status !== "ready") {
      g._mosaicDwellMs = 0;
      g._mosaicDwellKey = "";
      return;
    }

    if (g._mosaicDwellKey !== key) {
      g._mosaicDwellKey = key;
      g._mosaicDwellMs = 0;
    }
    g._mosaicDwellMs += dt;
    var remain = Math.max(0, MOSAIC_DWELL_MS - g._mosaicDwellMs);
    if (remain > 0 && remain < MOSAIC_DWELL_MS - 200) {
      g._orbHintMsg =
        "Hold on " + (cell.compassLabel || "tile") + "… " + (remain / 1000).toFixed(1) + "s";
    }
    if (g._mosaicDwellMs >= MOSAIC_DWELL_MS) {
      promoteMosaicCell(grid.gx, grid.gy);
    }
  }

  function clampPlayerToVisionFloor() {
    if (!hasVisionFloor() || !window.StasisWalkFloor) return;
    var mosaic = buildMosaicDrawPayload();
    var clamped;
    if (mosaic && window.StasisWalkFloor.clampWorldToMosaic) {
      clamped = window.StasisWalkFloor.clampWorldToMosaic(
        g.wx,
        g.wy,
        g.camWx,
        g.camWy,
        g.w,
        g.h,
        mosaic,
        22
      );
    } else if (window.StasisWalkFloor.clampWorldToVision) {
      clamped = window.StasisWalkFloor.clampWorldToVision(
        g.wx,
        g.wy,
        g.camWx,
        g.camWy,
        g.w,
        g.h,
        g.fusion.visionImg,
        22
      );
    } else {
      return;
    }
    g.wx = clamped.x;
    g.wy = clamped.y;
  }

  function updateHud() {
    refreshReadouts();
  }

  function renderDarkVeil(ctx, alpha) {
    if (!alpha || alpha <= 0) return;
    ctx.save();
    ctx.fillStyle = "rgba(10, 10, 14, " + alpha + ")";
    ctx.fillRect(0, 0, g.w, g.h);
    ctx.restore();
  }

  function renderDarkGray(ctx) {
    ctx.fillStyle = DARK_GRAY;
    ctx.fillRect(0, 0, g.w, g.h);

    var step = 56;
    var scroll = C.gridScroll(g.camWx, g.camWy, step);
    ctx.strokeStyle = "rgba(255,255,255,0.14)";
    ctx.lineWidth = 1;
    for (var gx = scroll.ox; gx < g.w; gx += step) {
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, g.h);
      ctx.stroke();
    }
    for (var gy = scroll.oy; gy < g.h; gy += step) {
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(g.w, gy);
      ctx.stroke();
    }

    var cx = g.w / 2;
    var cy = g.h / 2;
    var cell = 10;
    var wx0 = Math.floor(g.camWx / cell);
    var wy0 = Math.floor(g.camWy / cell);
    for (var i = 0; i < 240; i++) {
      var tx = wx0 + (C.coordHash(i, 3) % 120) - 60;
      var ty = wy0 + (C.coordHash(3, i) % 80) - 40;
      var sx = cx + (tx * cell - g.camWx);
      var sy = cy + (ty * cell - g.camWy);
      if (sx < -4 || sy < -4 || sx > g.w + 4 || sy > g.h + 4) continue;
      var b = 55 + (C.coordHash(tx, ty) % 70);
      ctx.fillStyle = "rgba(" + b + "," + b + "," + (b + 10) + ",0.55)";
      ctx.fillRect(sx | 0, sy | 0, 2, 2);
    }

    var grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, g.w * 0.65);
    grd.addColorStop(0, "rgba(70,70,78,0.28)");
    grd.addColorStop(1, "rgba(20,20,24,0)");
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, g.w, g.h);
  }

  function drawWasdHints(ctx) {
    if (!canWalk()) return;
    var inp = getInputDir();
    var moving = inp.dx !== 0 || inp.dy !== 0;
    var pulse = 0.45 + Math.sin(Date.now() * 0.004) * 0.2;
    var cx = g.w / 2;
    var cy = g.h / 2;
    ctx.save();
    ctx.font = "bold 15px Courier New, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    function key(ch, x, y, lit) {
      ctx.globalAlpha = lit ? 1 : pulse;
      ctx.fillStyle = lit ? "#ffe08a" : "rgba(201,162,39,0.75)";
      ctx.strokeStyle = lit ? "#fff" : "rgba(255,255,255,0.35)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.rect(x - 16, y - 14, 32, 28);
      ctx.stroke();
      ctx.fillText(ch, x, y);
    }
    key("W", cx, cy - 58, inp.dy < 0);
    key("A", cx - 46, cy + 6, inp.dx < 0);
    key("S", cx, cy + 58, inp.dy > 0);
    key("D", cx + 46, cy + 6, inp.dx > 0);
    if (!moving) {
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = "rgba(245,240,232,0.8)";
      ctx.font = "11px Courier New, monospace";
      ctx.fillText("click floor · WASD or arrows to walk", cx, cy + 92);
    }
    ctx.restore();
  }

  function drawFloorPixelNoise(ctx, visionActive) {
    if (visionActive) return;
    var inp = getInputDir();
    var speed = Math.sqrt(g.vx * g.vx + g.vy * g.vy);
    var moving = speed > 0.04 || inp.dx !== 0 || inp.dy !== 0;
    var dirX = inp.dx || (speed > 0.04 ? g.vx / speed : 0);
    var dirY = inp.dy || (speed > 0.04 ? g.vy / speed : 0);
    var count = moving ? 900 : 160;
    var alpha = moving ? Math.min(0.55, 0.18 + speed * 0.1) : 0.1;
    ctx.save();
    ctx.globalAlpha = alpha;
    for (var i = 0; i < count; i++) {
      var x = (Math.random() * g.w) | 0;
      var y = (Math.random() * g.h) | 0;
      var n = (Math.random() * 200) | 0;
      if (moving) {
        var len = 2 + speed * (3 + Math.random() * 5);
        ctx.strokeStyle = "rgba(" + n + "," + n + "," + (n + 20) + "," + (0.35 + Math.random() * 0.5) + ")";
        ctx.lineWidth = 1 + (Math.random() > 0.7 ? 1 : 0);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - dirX * len, y - dirY * len);
        ctx.stroke();
      } else {
        ctx.fillStyle = "rgba(" + n + "," + n + "," + (n + 15) + "," + (0.15 + Math.random() * 0.25) + ")";
        ctx.fillRect(x, y, 1, 1);
      }
    }
    ctx.restore();
  }

  function coverScale(img) {
    return Math.max(g.w / img.width, g.h / img.height) * (1.14 + g.fx.mural * 0.05);
  }

  function compositionPoint(ox, oy) {
    var tileX = (ox % TILE) / TILE - 0.5;
    var tileY = (oy % TILE) / TILE - 0.5;
    return {
      fx: clamp(0.5 + Math.sin(ox * 0.013) * 0.3 + tileX * 0.2, 0.06, 0.94),
      fy: clamp(0.5 + Math.cos(oy * 0.011) * 0.3 + tileY * 0.2, 0.06, 0.94),
      px: ((Math.floor(ox * 2.8) % 16) - 8) | 0,
      py: ((Math.floor(oy * 2.8) % 16) - 8) | 0,
    };
  }

  function drawStasisFloor(ctx, img) {
    var cx = g.w / 2;
    var cy = g.h / 2;
    var tile = TILE;
    var cols = Math.ceil(g.w / tile) + 2;
    var rows = Math.ceil(g.h / tile) + 2;
    var tx0 = Math.floor(g.wx / tile) - Math.floor(cols / 2);
    var ty0 = Math.floor(g.wy / tile) - Math.floor(rows / 2);

    for (var row = 0; row < rows; row++) {
      for (var col = 0; col < cols; col++) {
        var twx = (tx0 + col) * tile;
        var twy = (ty0 + row) * tile;
        var c = compositionPoint(twx, twy);
        var sc = Math.max(tile / img.width, tile / img.height) * (1.1 + g.fx.mural * 0.04);
        var dw = img.width * sc;
        var dh = img.height * sc;
        var x = cx + (twx - g.wx) - dw * c.fx + c.px;
        var y = cy + (twy - g.wy) - dh * c.fy + c.py;
        if (x + dw < -24 || y + dh < -24 || x > g.w + 24 || y > g.h + 24) continue;
        ctx.drawImage(img, x, y, dw, dh);
      }
    }

    var motion = Math.sqrt(g.vx * g.vx + g.vy * g.vy);
    if (motion > 0.3) {
      ctx.globalAlpha = Math.min(0.22, motion * 0.1);
      var c0 = compositionPoint(g.wx, g.wy);
      var sc0 = coverScale(img);
      var dw0 = img.width * sc0;
      var dh0 = img.height * sc0;
      var x0 = (g.w - dw0) * c0.fx + c0.px - g.vx * 4;
      var y0 = (g.h - dh0) * c0.fy + c0.py - g.vy * 4;
      ctx.drawImage(img, x0, y0, dw0, dh0);
      ctx.globalAlpha = 1;
    }
  }

  function drawOrbTextLabel(ctx, text, x, y, opts) {
    opts = opts || {};
    if (!text) return;
    var font = opts.font || "bold 11px Courier New, monospace";
    var fill = opts.fill || "#fff8e8";
    var padX = opts.padX == null ? 7 : opts.padX;
    var padY = opts.padY == null ? 4 : opts.padY;
    var bg = opts.bg || "rgba(6, 5, 8, 0.92)";
    var border = opts.border || "rgba(201, 162, 39, 0.55)";
    var align = opts.align || "center";
    ctx.save();
    ctx.font = font;
    ctx.textAlign = align;
    ctx.textBaseline = "middle";
    var tw = ctx.measureText(text).width;
    var bx = align === "center" ? x - tw / 2 - padX : x - padX;
    var by = y - 7 - padY;
    var bw = tw + padX * 2;
    var bh = 14 + padY * 2;
    ctx.fillStyle = bg;
    ctx.fillRect(bx, by, bw, bh);
    if (border) {
      ctx.strokeStyle = border;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
    }
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.85)";
    ctx.strokeText(text, x, y);
    ctx.fillStyle = fill;
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  function isBuzzStatusMsg(msg) {
    return /buzz/i.test(msg || "");
  }

  function drawFloorStatus(ctx) {
    var msg = g.floorStatus || g._orbHintMsg || "";
    if (!msg) return;
    var buzzToast = isBuzzStatusMsg(msg);
    ctx.save();
    ctx.fillStyle = buzzToast ? "rgba(6, 5, 8, 0.72)" : "rgba(6, 5, 8, 0.9)";
    if (buzzToast) {
      ctx.fillRect(0, g.h * 0.44, g.w, g.h * 0.1);
    } else {
      ctx.fillRect(0, g.h * 0.38, g.w, g.h * 0.22);
    }
    ctx.font = "bold 15px Courier New, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    var lines = msg.length > 80 ? [msg.slice(0, 80) + "…"] : [msg];
    if (lines[0].indexOf(" → ") >= 0 && lines[0].length > 52) {
      var arrow = lines[0].indexOf(" → ");
      var head = lines[0].slice(0, arrow + 3);
      var tail = lines[0].slice(arrow + 3);
      lines = [head, tail];
    }
    var mid = g.h * 0.49 - ((lines.length - 1) * 10);
    var ink = g.floorStatus ? "#fff0b8" : "#d4e6ff";
    for (var li = 0; li < lines.length; li++) {
      var ly = mid + li * 20;
      ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(0, 0, 0, 0.9)";
      ctx.strokeText(lines[li], g.w / 2, ly);
      ctx.fillStyle = ink;
      ctx.fillText(lines[li], g.w / 2, ly);
    }
    ctx.restore();
  }

  function drawWalkPixelShift(ctx) {
    if (!hasVisionFloor()) return;
    var move = Math.min(2.5, Math.sqrt(g.vx * g.vx + g.vy * g.vy));
    var amount = 0.1 + move * 0.5 + g.fx.swirl * 0.15;
    if (amount < 0.06) return;
    if (!g._shiftBuf) g._shiftBuf = document.createElement("canvas");
    var tmp = g._shiftBuf;
    tmp.width = g.w;
    tmp.height = g.h;
    tmp.getContext("2d").drawImage(g.canvas, 0, 0);
    var cols = 48;
    var sh = Math.ceil(g.h / cols);
    for (var i = 0; i < cols; i++) {
      var y0 = i * sh;
      var hStrip = Math.min(sh, g.h - y0);
      var shift =
        Math.sin(g.wx * 0.04 + i * 0.35) * amount * 6 + g.vx * 2;
      ctx.drawImage(tmp, 0, y0, g.w, hStrip, shift, y0, g.w, hStrip);
    }
  }

  function drawBuzzOrb(ctx, sx, sy, o, actionable, pulse) {
    var style = ORB_ACTION_STYLES.buzz_inject;
    var r = 22;
    var word = String(o.buzzWord || "buzz");
    var show = word.length > 10 ? word.slice(0, 9) + "…" : word;
    ctx.save();
    ctx.globalAlpha = pulse * (actionable ? 1 : 0.45);
    ctx.shadowColor = style.color;
    ctx.shadowBlur = 18;
    ctx.fillStyle = "rgba(20,40,28,0.9)";
    ctx.beginPath();
    ctx.arc(sx, sy, r + 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = actionable ? style.color : "rgba(255,255,255,0.35)";
    ctx.lineWidth = 2.5;
    ctx.setLineDash([3, 2]);
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = actionable ? "#d8ffe0" : "rgba(200,220,200,0.55)";
    ctx.font = "bold 10px Courier New, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(show, sx, sy);
    ctx.font = "8px Courier New, monospace";
    ctx.fillStyle = actionable ? "rgba(180,255,190,0.95)" : "rgba(180,255,190,0.45)";
    ctx.fillText("buzz", sx, sy - r - 7);
    ctx.restore();
  }

  function drawExtraBuzzOrb(ctx, sx, sy, o, actionable, pulse) {
    var style = ORB_ACTION_STYLES.extra_buzz;
    var r = 22;
    var words = getExtraBuzzPromptWords();
    var preview = words.length ? words.join(", ") : "type prompt";
    var show = preview.length > 12 ? preview.slice(0, 11) + "…" : preview;
    ctx.save();
    ctx.globalAlpha = pulse * (actionable ? 1 : 0.42);
    ctx.shadowColor = style.color;
    ctx.shadowBlur = 18;
    ctx.fillStyle = "rgba(42,34,18,0.92)";
    ctx.beginPath();
    ctx.arc(sx, sy, r + 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = actionable ? style.color : "rgba(255,255,255,0.3)";
    ctx.lineWidth = 2.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = actionable ? "#fff0c8" : "rgba(220,200,160,0.5)";
    ctx.font = "bold 9px Courier New, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(show, sx, sy);
    ctx.font = "8px Courier New, monospace";
    ctx.fillStyle = actionable ? "rgba(255,220,150,0.95)" : "rgba(255,220,150,0.4)";
    ctx.fillText("extra", sx, sy - r - 7);
    if (!words.length) {
      ctx.font = "7px Courier New, monospace";
      ctx.fillStyle = "rgba(255,220,150,0.55)";
      ctx.fillText("spellbook", sx, sy + r + 10);
    }
    ctx.restore();
  }

  function drawSpellOrb(ctx, sx, sy, o, actionable, pulse) {
    var style = ORB_ACTION_STYLES[o.type];
    var r = ORB_SPELL_RADIUS;
    var color = style ? style.color : "#c9a227";
    var img = preloadOrbSpellImage(o.spellNum);
    var slotLabel = "Slot " + (o.slotIdx + 1);
    var swapLabel = "→ #" + o.spellNum;
    var analysis = getAnalysis(o.spellNum);
    var title = analysis && analysis.title ? analysis.title : "";
    if (title.length > 22) title = title.slice(0, 20) + "…";
    var costLabel = String(o.value) + " orbs";

    ctx.save();
    ctx.globalAlpha = pulse * (actionable ? 1 : 0.55);
    ctx.shadowColor = color;
    ctx.shadowBlur = 20;
    ctx.beginPath();
    ctx.arc(sx, sy, r + 4, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(10,9,8,0.92)";
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.save();
    ctx.beginPath();
    ctx.arc(sx, sy, r - 2, 0, Math.PI * 2);
    ctx.clip();
    if (img && img.complete && img.naturalWidth) {
      var size = (r - 2) * 2;
      ctx.drawImage(img, sx - r + 2, sy - r + 2, size, size);
    } else {
      ctx.fillStyle = "rgba(70,55,105,0.65)";
      ctx.fillRect(sx - r, sy - r, r * 2, r * 2);
      ctx.fillStyle = "#f5e6a8";
      ctx.font = "11px Courier New, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("…", sx, sy);
    }
    ctx.restore();
    ctx.strokeStyle = actionable ? color : "rgba(255,255,255,0.5)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = actionable ? 1 : 0.88;
    var badgeR = 11;
    var badgeX = sx;
    var badgeY = sy + r + 2;
    ctx.fillStyle = actionable ? color : "rgba(120,120,130,0.85)";
    ctx.beginPath();
    ctx.arc(badgeX, badgeY, badgeR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#fff8e8";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.font = "bold 11px Courier New, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.9)";
    ctx.strokeText(String(o.spellNum), badgeX, badgeY + 0.5);
    ctx.fillStyle = "#fff8e8";
    ctx.fillText(String(o.spellNum), badgeX, badgeY + 0.5);

    drawOrbTextLabel(ctx, costLabel, sx, sy - r - 22, {
      font: "bold 11px Courier New, monospace",
      fill: "#fff0b8",
      border: color,
    });
    drawOrbTextLabel(ctx, slotLabel, sx, sy - r - 44, {
      font: "bold 12px Courier New, monospace",
      fill: "#ffffff",
      border: color,
    });
    drawOrbTextLabel(ctx, swapLabel, sx, sy + r + 24, {
      font: "bold 11px Courier New, monospace",
      fill: "#e8f4ff",
      border: "rgba(126, 200, 255, 0.65)",
    });
    if (title) {
      drawOrbTextLabel(ctx, title, sx, sy + r + 46, {
        font: "bold 10px Courier New, monospace",
        fill: "#f5e6c8",
        border: "rgba(201, 162, 39, 0.45)",
      });
    }
    ctx.restore();
  }

  function updateNearbyOrbHint() {
    if (!g.playing || g.menuOpen || g.floorStatus) return;
    var best = null;
    var bestD2 = ORB_SPELL_PICKUP_R * ORB_SPELL_PICKUP_R * 2.4;
    for (var i = 0; i < g.orbs.length; i++) {
      var o = g.orbs[i];
      if (o.taken) continue;
      if (
        o.type !== "spell_shuffle" &&
        o.type !== "spell_select" &&
        o.type !== "extra_buzz"
      ) {
        continue;
      }
      var dx = o.x - g.wx;
      var dy = o.y - g.wy;
      var d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = o;
      }
    }
    if (!best) {
      g._orbHintMsg = "";
      return;
    }
    if (best.type === "extra_buzz") {
      var words = getExtraBuzzPromptWords();
      g._orbHintMsg = words.length
        ? 'Apply typed extra buzz: "' + words.join(", ") + '"'
        : "Type extra buzz in spellbook first";
      return;
    }
    var oldNum = g.slots[best.slotIdx] || null;
    g._orbHintMsg = spellSwapMessage(best.slotIdx, oldNum, best.spellNum);
  }

  function drawOrbs() {
    var ctx = g.ctx;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    for (var i = 0; i < g.orbs.length; i++) {
      var o = g.orbs[i];
      if (o.taken) continue;
      var scr = worldToScreen(o.x, o.y);
      var sx = scr.x;
      var sy = scr.y;
      if (sx < -80 || sy < -80 || sx > g.w + 80 || sy > g.h + 80) continue;
      var pulse = 0.88 + Math.sin(Date.now() * 0.006 + i) * 0.12;
      var kind = o.type || "score";
      var actionable = kind === "score" || canCollectActionOrb(o);
      if (kind === "spell_shuffle" || kind === "spell_select") {
        drawSpellOrb(ctx, sx, sy, o, actionable, pulse);
        continue;
      }
      if (kind === "buzz_inject") {
        drawBuzzOrb(ctx, sx, sy, o, actionable, pulse);
        continue;
      }
      if (kind === "extra_buzz") {
        drawExtraBuzzOrb(ctx, sx, sy, o, actionable, pulse);
        continue;
      }
      if (kind === "save_work") {
        var saveStyle = ORB_ACTION_STYLES.save_work;
        var saveR = 21;
        var saveCompass = mosaicCompassByKey(o.saveTarget);
        var saveLabel =
          o.saveTarget === "player" ? "Sv" : (saveCompass && saveCompass.short) || "Sv";
        ctx.save();
        ctx.globalAlpha = pulse * (actionable ? 1 : 0.45);
        ctx.shadowColor = saveStyle.color;
        ctx.shadowBlur = 26;
        ctx.fillStyle = saveStyle.color;
        ctx.beginPath();
        ctx.arc(sx, sy, saveR, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = actionable ? "#fff" : "rgba(255,255,255,0.35)";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = "#0a0908";
        ctx.font = "bold 10px Courier New, monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(saveLabel, sx, sy);
        ctx.font = "8px Courier New, monospace";
        ctx.fillStyle = "#fff0c8";
        ctx.fillText("+" + o.value, sx, sy + saveR + 9);
        ctx.restore();
        continue;
      }
      var style = ORB_ACTION_STYLES[kind];
      var r;
      var color;
      var label;
      if (kind === "score") {
        r = 16 + (o.value >= 100 ? 10 : o.value >= 20 ? 6 : o.value >= 10 ? 4 : 2);
        color = ORB_COLORS[o.value] || "#eee";
        label = String(o.value);
      } else {
        r = kind === "reimagine" ? 22 : 19;
        color = style.color;
        label = style.label;
        pulse *= actionable ? 1 : 0.42;
      }
      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.shadowColor = color;
      ctx.shadowBlur = kind === "score" ? 22 : 28;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(sx, sy, r + 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = actionable ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.35)";
      ctx.lineWidth = kind === "score" ? 2 : 2.5;
      if (kind !== "score") {
        ctx.setLineDash([4, 3]);
      }
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.beginPath();
      ctx.arc(sx, sy, Math.max(4, r * 0.35), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#1a1a1e";
      ctx.font =
        kind === "score"
          ? "bold 12px Courier New, monospace"
          : "bold 11px Courier New, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, sx, sy - (kind === "score" ? 0 : 1));
      if (kind !== "score" && style) {
        ctx.font = "9px Courier New, monospace";
        ctx.fillStyle = actionable ? "#1a1a1e" : "rgba(26,26,30,0.55)";
        ctx.fillText(String(style.cost), sx, sy + r * 0.52);
      }
      ctx.restore();
    }
    ctx.restore();
  }

  function ensureNoiseBuffer() {
    if (g._noiseBuf) return g._noiseBuf;
    var len = 44100 * 2;
    var buf = new Float32Array(len);
    for (var i = 0; i < len; i++) buf[i] = Math.random() * 2 - 1;
    g._noiseBuf = buf;
    return buf;
  }

  function ensureAudio() {
    if (g._audio) return g._audio;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      g._audio = new AC();
    } catch (e) {
      return null;
    }
    return g._audio;
  }

  function startNoiseLoop() {
    var ac = ensureAudio();
    if (!ac || g._noiseSrc) return;
    var buf = ensureNoiseBuffer();
    var audioBuf = ac.createBuffer(1, buf.length, ac.sampleRate);
    audioBuf.copyToChannel(buf, 0);
    var src = ac.createBufferSource();
    src.buffer = audioBuf;
    src.loop = true;
    var filter = ac.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 520;
    filter.Q.value = 0.7;
    var gain = ac.createGain();
    gain.gain.value = 0;
    var pan = ac.createStereoPanner ? ac.createStereoPanner() : null;
    src.connect(filter);
    if (pan) {
      filter.connect(pan);
      pan.connect(gain);
    } else {
      filter.connect(gain);
    }
    gain.connect(ac.destination);
    src.start();
    g._noiseSrc = src;
    g._noiseFilter = filter;
    g._noiseGain = gain;
    g._noisePan = pan;
  }

  function updateMovementNoise(speed, dx, dy) {
    var ac = ensureAudio();
    if (!ac) return;
    if (ac.state === "suspended") ac.resume();
    startNoiseLoop();
    if (!g._noiseGain) return;
    var moving = speed > 0.15;
    var vol = moving ? Math.min(0.14, 0.03 + speed * 0.028) : 0;
    g._noiseGain.gain.setTargetAtTime(vol, ac.currentTime, 0.04);
    if (g._noiseFilter) {
      var angle = moving ? Math.atan2(dy, dx) : 0;
      g._noiseFilter.frequency.setTargetAtTime(
        280 + Math.abs(Math.sin(angle)) * 900 + speed * 40,
        ac.currentTime,
        0.05
      );
    }
    if (g._noisePan) {
      g._noisePan.pan.setTargetAtTime(
        moving ? clamp(dx * 0.55, -1, 1) : 0,
        ac.currentTime,
        0.05
      );
    }
    if (moving && ac.currentTime - g._lastNoiseStep > 0.11) {
      g._lastNoiseStep = ac.currentTime;
      var click = ac.createOscillator();
      var clickGain = ac.createGain();
      click.type = "square";
      click.frequency.value = 90 + speed * 18;
      clickGain.gain.value = Math.min(0.035, speed * 0.01);
      click.connect(clickGain);
      clickGain.connect(ac.destination);
      click.start();
      click.stop(ac.currentTime + 0.03);
    }
  }

  function drawMotionNoise(ctx) {
    var speed = Math.sqrt(g.vx * g.vx + g.vy * g.vy);
    if (speed < 0.12) return;
    var streaks = Math.min(90, Math.floor(50 + speed * 28));
    var alpha = Math.min(0.42, 0.08 + speed * 0.06);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 1;
    for (var i = 0; i < streaks; i++) {
      var x = Math.random() * g.w;
      var y = Math.random() * g.h;
      var len = 4 + speed * (2 + Math.random() * 4);
      ctx.strokeStyle =
        "rgba(" +
        (210 + (Math.random() * 45) | 0) +
        "," +
        (205 + (Math.random() * 40) | 0) +
        "," +
        (200 + (Math.random() * 35) | 0) +
        "," +
        (0.25 + Math.random() * 0.55) +
        ")";
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - g.vx * len, y - g.vy * len);
      ctx.stroke();
    }
    ctx.restore();
  }

  function updateMoveHud(dx, dy) {
    var arrow = $("mw-move-arrow");
    var label = $("mw-move-label");
    var hud = $("mw-move-hud");
    var reticle = $("mw-center-reticle");
    var moving = dx !== 0 || dy !== 0;
    if (reticle) reticle.classList.toggle("moving", moving);
    if (hud) hud.classList.toggle("active", moving);
    if (!arrow || !label) return;
    if (!moving) {
      arrow.textContent = "·";
      label.textContent = "still";
      return;
    }
    var pos =
      " (" + (g.wx | 0) + "," + (g.wy | 0) + ")";
    if (Math.abs(dx) >= Math.abs(dy)) {
      arrow.textContent = dx > 0 ? "\u2192" : "\u2190";
      label.textContent = (dx > 0 ? "east" : "west") + pos;
    } else {
      arrow.textContent = dy > 0 ? "\u2193" : "\u2191";
      label.textContent = (dy > 0 ? "south" : "north") + pos;
    }
  }

  function orbPickupRadius(o) {
    if (!o) return ORB_R;
    if (o.type === "spell_shuffle" || o.type === "spell_select") return ORB_SPELL_PICKUP_R;
    return ORB_R;
  }

  function orbPickupRadius2(o) {
    var r = orbPickupRadius(o);
    return r * r;
  }

  function collectOrbs() {
    for (var i = 0; i < g.orbs.length; i++) {
      var o = g.orbs[i];
      if (o.taken) continue;
      var dx = o.x - g.wx;
      var dy = o.y - g.wy;
      if (dx * dx + dy * dy >= orbPickupRadius2(o)) continue;
      var kind = o.type || "score";
      if (kind === "score") {
        o.taken = true;
        addScore(o.value);
        continue;
      }
      if (kind === "save_work") {
        if (!canCollectSaveOrb(o)) continue;
        o.taken = true;
        triggerSaveWorkOrb(o);
        ensureActionOrbs();
        continue;
      }
      if (!canCollectActionOrb(o)) continue;
      o.taken = true;
      triggerActionOrb(o);
      ensureActionOrbs();
    }
  }

  function playerScreenPos() {
    return worldToScreen(g.wx, g.wy);
  }

  function drawPlayerMarker(ctx) {
    var pos = playerScreenPos();
    var gx = Math.floor(pos.x);
    var gy = Math.floor(pos.y);
    var px = 4;
    var rgb = g.playerPalette || [201, 162, 39];
    var fill = "rgb(" + rgb.join(",") + ")";
    var persona = g.playerPersona || "wanderer";
    ctx.save();
    ctx.shadowColor = "rgba(" + rgb.join(",") + ",0.85)";
    ctx.shadowBlur = 12;
    ctx.fillStyle = fill;
    if (persona === "eye") {
      ctx.beginPath();
      ctx.arc(gx + px * 1.5, gy, px * 1.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#1a1a1e";
      ctx.beginPath();
      ctx.arc(gx + px * 1.5, gy, px * 0.55, 0, Math.PI * 2);
      ctx.fill();
    } else if (persona === "rat" || persona === "creature") {
      ctx.fillRect(gx, gy + px, 3 * px, px);
      ctx.fillRect(gx + px, gy, px, px);
      ctx.fillRect(gx + 2 * px, gy - px, px, px);
    } else if (persona === "bird") {
      ctx.fillRect(gx + px, gy, 2 * px, px);
      ctx.fillRect(gx, gy - px, px, 2 * px);
      ctx.fillRect(gx + 3 * px, gy - px, px, 2 * px);
    } else if (persona === "spirit" || persona === "soul") {
      ctx.beginPath();
      ctx.arc(gx + px * 1.5, gy - px, px * 1.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.55;
      ctx.fillRect(gx + px, gy + px, px, 2 * px);
      ctx.globalAlpha = 1;
    } else if (persona === "dancer" || persona === "guardian") {
      ctx.fillRect(gx + px, gy - 2 * px, px, 3 * px);
      ctx.fillRect(gx, gy, 3 * px, px);
      ctx.fillRect(gx, gy + px, px, 2 * px);
      ctx.fillRect(gx + 2 * px, gy + px, px, 2 * px);
    } else {
      ctx.fillRect(gx, gy, 2 * px, px);
      ctx.fillRect(gx + px, gy - px, px, px);
      ctx.fillRect(gx + px, gy + px, px, 2 * px);
    }
    ctx.restore();
  }

  function drawGuy() {
    var ctx = g.guyCtx;
    if (!ctx) return;
    ctx.clearRect(0, 0, g.w, g.h);
    drawPlayerMarker(ctx);
    var pos = playerScreenPos();
    g.guy.x = pos.x;
    g.guy.y = pos.y;
  }

  function updateGuy() {
    drawGuy();
  }

  function renderFrame(moveDx, moveDy) {
    if (!g.ctx) return;
    moveDx = moveDx || 0;
    moveDy = moveDy || 0;
    var ctx = g.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    renderDarkGray(ctx);
    var mosaic = buildMosaicDrawPayload();
    var hasPlane = false;
    if (shouldDrawStasisPlane() && window.StasisWalkFloor) {
      if (mosaic && window.StasisWalkFloor.drawMosaicPlane) {
        hasPlane = window.StasisWalkFloor.drawMosaicPlane(
          ctx,
          g.w,
          g.h,
          g.camWx,
          g.camWy,
          mosaic,
          collectBuzzForEquipped(),
          g.stasisText
        );
      } else if (window.StasisWalkFloor.drawPlane) {
        hasPlane = window.StasisWalkFloor.drawPlane(
          ctx,
          g.w,
          g.h,
          g.camWx,
          g.camWy,
          g.fusion.visionImg,
          collectBuzzForEquipped(),
          g.stasisText
        );
      }
    }
    if (!hasPlane && (g.floorGenerating || g._worldGenPromise) && g.playing) {
      setFloorStatus("Painting stasis floor…");
    }
    if (window.StasisWalkFloor && (moveDx || moveDy) && canWalk()) {
      window.StasisWalkFloor.predictAhead(
        ctx,
        g.w,
        g.h,
        g.camWx,
        g.camWy,
        moveDx,
        moveDy,
        hasPlane ? g.fusion.visionImg : null,
        collectBuzzForEquipped(),
        g.stasisText
      );
    }
    drawFloorPixelNoise(ctx, hasPlane);
    if (hasVisionFloor() || g._localBootstrapDone) {
      drawObstacles(ctx);
      drawStasisProps(ctx);
      drawEnemies(ctx);
    }
    drawOrbs();
    drawSpellProjectiles(ctx);
    drawPlayerMarker(ctx);
    drawCompassRegionBorder(ctx);
    drawMosaicMinimap(ctx);
    drawWasdHints(ctx);
    var moveSpd = Math.sqrt(g.vx * g.vx + g.vy * g.vy);
    if (moveSpd > 0.06) drawMotionNoise(ctx);
    drawFloorStatus(ctx);
    updateGuy();
  }

  function tick() {
    if (!g.running) return;
    if (!isMuralwalkActive()) {
      g.raf = requestAnimationFrame(tick);
      return;
    }

    var now = performance.now();
    if (!g._lastFrameMs) g._lastFrameMs = now;
    var dt = Math.min(50, Math.max(1, now - g._lastFrameMs));
    g._lastFrameMs = now;
    g._lastDt = dt;

    if (!g.menuOpen && !g._videofyRecording && !g._videofyExporting) {
      var moveStep = SPEED * (dt / 16.667);
      var camLerp = 1 - Math.pow(1 - 0.26, dt / 16.667);

      if (g.fusion.visionUrl && !hasVisionFloor() && !g.floorGenerating && !g._visionLoading) {
        g._visionLoading = true;
        loadFusionImage(g.fusion.visionUrl, g.floorUnlocked, g.fusion.source || "local")
          .then(function () {
            refreshReadouts();
          })
          .catch(function () {
            if (!hasVisionFloor() && equippedNums().length >= 2 && !g._worldGenPromise) {
              g._localBootstrapDone = false;
              startFloorGenBackground();
            }
          })
          .finally(function () {
            g._visionLoading = false;
          });
      }

      var inp = getInputDir();
      var dx = inp.dx;
      var dy = inp.dy;
      updateEnemies();
      if (canWalk() && (dx || dy)) {
        movePlayerWithSlide(dx, dy, moveStep);
        clampPlayerToVisionFloor();
        depenetratePlayer();
        applySpellOrbMagnet();
        depenetratePlayer();
        collectOrbs();
        ensureOrbsNearPlayer();
        maybeRefreshMaze();
      } else {
        dx = 0;
        dy = 0;
        if (!canWalk()) clearKeys();
        g.vx *= 0.55;
        g.vy *= 0.55;
      }

      if (canWalk() && g.playing) updateNearbyOrbHint();
      updateMosaicRegionNotice();
      updateMosaicDwell(dt);

      var cam = C.updateCamera(g.camWx, g.camWy, g.wx, g.wy, camLerp);
      g.camWx = cam.camWx;
      g.camWy = cam.camWy;

      g._moveDx = dx;
      g._moveDy = dy;
      g.vx = (g.wx - g._prevWx) * 0.55 + g.vx * 0.45;
      g.vy = (g.wy - g._prevWy) * 0.55 + g.vy * 0.45;
      g._prevWx = g.wx;
      g._prevWy = g.wy;

      var speed = Math.sqrt(g.vx * g.vx + g.vy * g.vy);
      updateMoveHud(dx, dy);
      updateMovementNoise(speed, dx, dy);
      if (now - (g._lastFalloutHudMs || 0) >= 220) {
        g._lastFalloutHudMs = now;
        scheduleFalloutHudUpdate();
      }
      if (now - (g._lastMapQueueKickMs || 0) >= 900) {
        g._lastMapQueueKickMs = now;
        tryKickFalloutMapQueue();
      }
      renderFrame(dx, dy);
      updateStasisActionButtons();
    }

    g.raf = requestAnimationFrame(tick);
  }

  function onKeyDown(e) {
    keyToken(e, true);
  }

  function onKeyUp(e) {
    keyToken(e, false);
  }

  function onFocusInClearKeys(e) {
    if (isEditableTarget(e.target)) clearKeys();
  }

  function onVisibilityClearKeys() {
    if (document.hidden) clearKeys();
  }

  function bindKeys() {
    if (g.keysBound) return;
    g.keysBound = true;
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("keyup", onKeyUp, true);
    document.addEventListener("focusin", onFocusInClearKeys, true);
    document.addEventListener("visibilitychange", onVisibilityClearKeys);
    window.addEventListener("blur", clearKeys);
  }

  function clearKeys() {
    g.keys = {};
    g.moveHeld = {};
    g.touchMove = {};
  }

  function unbindKeys() {
    if (!g.keysBound) return;
    g.keysBound = false;
    document.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("keyup", onKeyUp, true);
    document.removeEventListener("focusin", onFocusInClearKeys, true);
    document.removeEventListener("visibilitychange", onVisibilityClearKeys);
    window.removeEventListener("blur", clearKeys);
    clearKeys();
  }

  function bindSpellBoxes() {
    for (var i = 0; i < 3; i++) {
      (function (slot) {
        var btn = $("mw-spell-box-" + slot);
        if (!btn || btn.dataset.bound) return;
        btn.dataset.bound = "1";
        btn.addEventListener("click", function () {
          if (!g.playing || g.menuOpen) return;
          shuffleSpellSlot(slot, false);
        });
      })(i);
    }
  }

  function ingestSpellforge(detail) {
    if (!detail) return;
    var prevSpells = equippedNums().join(",");
    window.spellforgeFusion = detail;
    if (!syncFromSpellforge()) return;
    var nextSpells = equippedNums().join(",");
    if (prevSpells !== nextSpells) {
      g._floorRequestKey = "";
      g._aiStasisLanded = false;
      g._localBootstrapDone = false;
      markStasisPending();
      renderMwBuzzToggles(true);
    }
    if (!g.menuOpen && g.playing) {
      layoutPropsPlaceholders();
      layoutWorldEntities();
      refreshPlayerPersona();
      startFloorGenBackground();
    } else {
      layoutWorldEntities();
      refreshMenuPanel();
    }
  }

  function ensureCanvasReady() {
    if (g._canvasReady) return true;
    g.canvas = $("mw-floor");
    g.guyCanvas = $("mw-guy");
    if (!g.canvas) return false;
    g.ctx = g.canvas.getContext("2d");
    g.guyCtx = g.guyCanvas ? g.guyCanvas.getContext("2d") : null;
    g.w = g.canvas.width;
    g.h = g.canvas.height;

    bindSpellBoxes();
    bindMenuShuffles();
    bindSlotHudSelect();
    bindStasisActions();
    updateStasisPreview();
    var playBtn = $("mw-play-btn");
    if (playBtn && !playBtn.dataset.bound) {
      playBtn.dataset.bound = "1";
      playBtn.addEventListener("click", onPlayClicked);
    }
    if (!g.canvas.dataset.bound) {
      g.canvas.dataset.bound = "1";
      g.canvas.addEventListener("click", focusWalkSurface);
    }

    if (!g._galleryBound) {
      g._galleryBound = true;
      window.addEventListener("gallery-data-ready", function () {
        if (equippedNums().length < 2) initSlots();
        else {
          syncEquippedSpells();
          regenerateStasisText();
          refreshReadouts();
        }
        refreshMenuPanel();
        if (g.playing && equippedNums().length >= 2 && !hasVisionFloor()) {
          startFloorGenBackground();
        }
      });
    }

    g._canvasReady = true;
    g.started = true;
    return true;
  }

  function ensureStarted() {
    ensureCanvasReady();
    refreshReadouts();
    return ensureSlotsReady()
      .then(function () {
        backlogGalleryData();
      })
      .finally(function () {
        g.ready = true;
        window.dispatchEvent(new Event("muralwalk-ready"));
      });
  }

  function startLoop() {
    bindKeys();
    g.running = true;
    if (g.raf) cancelAnimationFrame(g.raf);
    g.raf = 0;
    tick();
  }

  function stopLoop() {
    g.running = false;
    if (g.raf) cancelAnimationFrame(g.raf);
  }

  function focusWalkSurface() {
    if (g.playing && !g.menuOpen) setGameFocused(true);
    for (var i = 0; i < 3; i++) {
      var box = $("mw-spell-box-" + i);
      if (box && box.blur) box.blur();
    }
    if (!g.canvas) return;
    try {
      g.canvas.focus({ preventScroll: true });
    } catch (err) {
      g.canvas.focus();
    }
    var ac = ensureAudio();
    if (ac && ac.state === "suspended") ac.resume();
  }

  function onShow() {
    if (g._showing) return;
    g._showing = true;
    setTimeout(function () {
      g._showing = false;
    }, 50);

    ensureStarted();
    syncFromSpellforge();
    if (window.spellforgeFusion) ingestSpellforge(window.spellforgeFusion);
    refreshStasisInterfaceSkin();
    ensureSlotsReady().then(function () {
      refreshMenuPanel();
    });
    if (!g.playing) openMenu();
    else if (g.menuOpen) openMenu();
    else closeMenu();
    startLoop();
  }

  function onHide() {
    stopLoop();
    unbindKeys();
    setGameFocused(false);
    unlockPlayViewport();
    updateTouchControlsVisible();
    updateSlotHud();
    if (g._noiseGain) g._noiseGain.gain.setTargetAtTime(0, (g._audio && g._audio.currentTime) || 0, 0.05);
  }

  function boot() {
    if (!$("panel-muralwalk")) return;
    bindMwBuzzPanel();
    loadWallet().finally(function () {
      updateScoreHud();
    });
    loadSpellStats();
    bindTouchControls();
    bindPlayScrollGuard();
    bindKeys();
    window.addEventListener("muralwalk-show", onShow);
    window.addEventListener("muralwalk-hide", onHide);
    window.addEventListener("spellforge-fusion", function (e) {
      ingestSpellforge(e.detail);
    });
    var panel = $("panel-muralwalk");
    if (
      (panel && panel.classList.contains("active")) ||
      location.hash.replace("#", "") === "muralwalk"
    ) {
      onShow();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  window.MuralwalkAPI = { onShow: onShow, onHide: onHide };
})();