/**
 * Grand Exchange — RuneScape-style 8-slot offer UI + Banker 100 SIM market.
 */
(function () {
  "use strict";

  // Stable key — do not bump (legacy keys are still read once and rewritten here).
  var STORAGE = "gallery.grand-exchange";
  var STORAGE_LEGACY_KEYS = [
    "gallery.grand-exchange.v6",
    "gallery.grand-exchange.v5",
    "gallery.grand-exchange.v4",
    "gallery.grand-exchange.v3",
    "gallery.grand-exchange.v2",
    "gallery.grand-exchange.v1",
  ];
  var PLAYER_ID = 100;
  var MAX_SLOTS = 8;
  var MAX_TRACKED = 16;
  var TRACK_HISTORY_MAX = 36;
  var NPC_TICK_MS = 1200;
  var GUIDE_BASE = 89;
  var PAINTING_TOTAL = 1000;
  /** Match Spellforge ID spaces */
  var GEN_BASE = 100000;
  var SKETCH_BASE = 200000;
  var INV_SKETCH_BASE = 300000;
  var NOTE_BASE = 400000;
  var COLOR_BASE = 500000;
  var NOTE_THUMB =
    "data:image/svg+xml," +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">' +
        '<rect width="64" height="64" rx="8" fill="#1e293b"/>' +
        '<rect x="14" y="12" width="36" height="40" rx="3" fill="#334155" stroke="#94a3b8" stroke-width="2"/>' +
        '<path d="M20 22h24M20 30h24M20 38h16" stroke="#e2e8f0" stroke-width="2.5" stroke-linecap="round"/>' +
      "</svg>"
    );

  var LEDGER_THUMB =
    "data:image/svg+xml," +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">' +
        '<rect width="64" height="64" rx="8" fill="#1a2332"/>' +
        '<rect x="12" y="10" width="40" height="44" rx="4" fill="#243447" stroke="#c9a227" stroke-width="2"/>' +
        '<path d="M20 22h24M20 30h24M20 38h18" stroke="#e8d5a3" stroke-width="2.5" stroke-linecap="round"/>' +
        '<circle cx="48" cy="48" r="8" fill="#c9a227"/><text x="48" y="51" text-anchor="middle" font-size="10" fill="#1a2332" font-family="sans-serif">✦</text>' +
      "</svg>"
    );

  var state = null;
  // NPC packs stay in memory only — never persist (was blowing localStorage).
  var npcRuntime = { inventory: {}, bank: {} };
  var roster = [];
  var analyses = {};
  /** Spellforge extras: gen / phone / sketch / inverted — id -> {url,title,source,genNum,analysis} */
  var extraItems = {};
  var arsenalExtraNums = [];
  var selected = 1;
  var tickTimer = null;
  var tickN = 0;
  var view = "home"; // home | setup | pick | history | tracker
  var setupSide = "buy"; // buy | sell
  var setupSlot = 0;
  var bagView = "inv"; // inv | bank
  var bankPage = 0;
  var INV_SLOTS = 28;
  var BANK_PAGE = 96; // 8×12 visible; bank itself is unlimited
  var selectedInvItem = null;
  var selectedBankItem = null;
  var forgeSlots = [null, null, null];
  var lastForgeResult = null;
  var autoForgeTimer = null;
  var autoForgeBusy = false;
  var autoForgeCycle = 0;
  var pendingGenerateId = null;
  var AUTO_FORGE_TOPIC_MEMORY = 8;
  /** Persist caps — Auto-forge mints many ledgers; localStorage ~5MB shared. */
  var PERSIST_NOTE_TEXT_MAX = 1500;
  var PERSIST_NOTE_DESC_MAX = 800;
  var PERSIST_FORGED_DESC_MAX = 600;
  var PERSIST_DESC_OVERRIDE_MAX = 2000;
  var PERSIST_MAX_NOTES = 160;
  var PERSIST_MAX_FORGED = 80;
  var PERSIST_MAX_DESC_OVERRIDES = 40;
  var PERSIST_MAX_GUIDE_OVERRIDES = 200;
  var PERSIST_MAX_ITEM_STATS = 120;
  var PERSIST_MAX_BANK_KINDS = 360;
  var PERSIST_MAX_COLOR_CHIPS = 80;
  var PERSIST_LS_SOFT_BYTES = 1800000;
  var PERSIST_LS_HARD_BYTES = 3200000;
  var GE_IDB_NAME = "gallery-ge-persist";
  var GE_IDB_STORE = "saves";
  var GE_IDB_KEY = "main";
  var recentForgeTopics = [];
  /** Live working thumbs (often data URLs) after Force load — memory only. */
  var thumbOverrides = {};
  var exchangeOpen = false;
  var worldKeys = Object.create(null);
  var worldRaf = 0;
  var worldLastTs = 0;
  var walkAcc = 0;
  var playerPos = { x: 48, y: 78 };
  var npcStates = [];
  var WORLD_W = 100;
  var WORLD_H = 100;
  var PLAYER_SPEED = 18; // % per second
  var WALK_XP_PER_LEVEL_CAP = 80;
  var COLLECT_XP = 25;
  var FORGE_XP = 80;
  var WALK_XP_STEP = 1;
  var WALK_DIST_PER_XP = 28; // percent-units walked per walk XP

  function $(id) {
    return document.getElementById(id);
  }

  function esc(s) {
    var d = document.createElement("div");
    d.textContent = String(s == null ? "" : s);
    return d.innerHTML;
  }

  function money(n) {
    var x = Math.round((Number(n) || 0) * 100) / 100;
    return (
      "$" +
      x.toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      })
    );
  }

  function uid() {
    return "ge_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  function assetUrl(path) {
    if (!path) return path;
    if (/^(https?:|data:|blob:)/i.test(path)) return path;
    try {
      if (typeof window.galleryApiUrl === "function" && path.charAt(0) === "/") {
        return window.galleryApiUrl(path);
      }
    } catch (e) {}
    var base = String(window.SPELLFORGE_API_BASE || "").replace(/\/$/, "");
    if (base && path.charAt(0) === "/") return base + path;
    try {
      return new URL(path, window.location.href).href;
    } catch (e2) {
      return path;
    }
  }

  function apiUrl(path) {
    try {
      if (typeof window.galleryApiUrl === "function") return window.galleryApiUrl(path);
    } catch (e) {}
    var base = String(window.SPELLFORGE_API_BASE || "").replace(/\/$/, "");
    return base ? base + path : path;
  }

  function forgedOf(n) {
    n = Number(n);
    if (!state || !state.forged) return null;
    return state.forged[String(n)] || state.forged[n] || null;
  }

  function noteOf(n) {
    n = Number(n);
    if (!state || !state.notes) return null;
    return state.notes[String(n)] || state.notes[n] || null;
  }

  function isNoteId(n) {
    n = Number(n);
    return !!noteOf(n) || (n > NOTE_BASE && n < NOTE_BASE + 100000);
  }

  function isLedgerNote(n) {
    var note = typeof n === "object" && n ? n : noteOf(n);
    if (!note) return false;
    return note.kind === "ledger" || !!note.isLedger || !!note.pendingGenerate;
  }

  function ledgerOf(n) {
    var note = noteOf(n);
    return note && isLedgerNote(note) ? note : null;
  }

  /** Short inventory/slot label from prompt text (legacy single-string notes). */
  function deriveNoteTitle(prompt) {
    var t = String(prompt || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!t) return "Note";
    if (t.length <= 40) return t;
    return t.slice(0, 40) + "…";
  }

  /** Prompt body used for forge/Spellforge generation. */
  function notePromptOf(note) {
    if (note == null) return "";
    if (typeof note === "string") return String(note);
    if (note.text != null) return String(note.text);
    if (note.prompt != null) return String(note.prompt);
    // Legacy: only title existed — treat it as the prompt body
    if (note.title != null) return String(note.title);
    return "";
  }

  function noteTitleOf(note) {
    if (note == null) return "Note";
    if (typeof note === "string") return deriveNoteTitle(note);
    var title = String(note.title || "").replace(/\s+/g, " ").trim();
    var prompt = notePromptOf(note);
    // If title missing, or title was dumped as the full long prompt, derive a short one.
    if (!title) return deriveNoteTitle(prompt) || "Note";
    if (prompt && title === prompt && prompt.length > 40) return deriveNoteTitle(prompt);
    return title.slice(0, 80) || "Note";
  }

  /** Normalize legacy/plain-string notes into {id,title,text,createdAt}. */
  function normalizeNoteEntry(raw, idHint) {
    var id = Number(
      (raw && typeof raw === "object" && raw.id != null ? raw.id : idHint) || 0
    );
    if (typeof raw === "string") {
      var promptS = String(raw);
      return {
        id: id || undefined,
        title: deriveNoteTitle(promptS),
        text: promptS,
        createdAt: Date.now(),
      };
    }
    if (!raw || typeof raw !== "object") return null;
    var prompt = notePromptOf(raw);
    var title = noteTitleOf(raw);
    // If title was the only field and equaled prompt, notePromptOf already recovered it.
    if (!prompt && title && title !== "Note") {
      // title-only legacy: treat as prompt and re-derive display title
      prompt = String(raw.title || "");
      title = deriveNoteTitle(prompt);
    }
    var out = {
      id: id || Number(raw.id) || undefined,
      title: title || "Note",
      text: String(prompt || ""),
      createdAt: raw.createdAt || Date.now(),
    };
    if (raw.kind === "ledger" || raw.isLedger || raw.pendingGenerate) {
      out.kind = "ledger";
      out.isLedger = true;
      out.pendingGenerate = raw.pendingGenerate !== false;
      out.description = String(raw.description != null ? raw.description : prompt || "").slice(0, PERSIST_NOTE_DESC_MAX);
      out.text = String(out.text || "").slice(0, PERSIST_NOTE_TEXT_MAX);
      if (Array.isArray(raw.parents)) {
        out.parents = raw.parents.map(Number).filter(function (n) { return n > 0; }).slice(0, 3);
      } else {
        out.parents = [];
      }
      if (raw.guide != null) out.guide = Math.max(1, Math.round(Number(raw.guide) || 1));
    }
    return out;
  }

  function normalizeAllNotes(notesMap) {
    var out = {};
    if (!notesMap || typeof notesMap !== "object") return out;
    Object.keys(notesMap).forEach(function (k) {
      var norm = normalizeNoteEntry(notesMap[k], Number(k));
      if (!norm) return;
      if (norm.id == null) norm.id = Number(k);
      out[String(norm.id)] = norm;
    });
    return out;
  }

  function normalizeGeHex(raw) {
    var s = String(raw || "").trim();
    if (!s) return "";
    if (s.charAt(0) !== "#") s = "#" + s;
    if (/^#[0-9a-fA-F]{3}$/.test(s)) {
      s = "#" + s.charAt(1) + s.charAt(1) + s.charAt(2) + s.charAt(2) + s.charAt(3) + s.charAt(3);
    }
    if (!/^#[0-9a-fA-F]{6}$/.test(s)) return "";
    return s.toUpperCase();
  }

  function geHexToRgb(hex) {
    var h = normalizeGeHex(hex);
    if (!h) return null;
    return {
      r: parseInt(h.slice(1, 3), 16),
      g: parseInt(h.slice(3, 5), 16),
      b: parseInt(h.slice(5, 7), 16),
    };
  }

  var GE_COLOR_NAME_HEX = {
    // ===== REDS =====
    red: "#EF4444",
    scarlet: "#FF2400",
    crimson: "#DC143C",
    vermilion: "#E34234",
    cadmiumred: "#E30022",
    alizarin: "#E32636",
    tomato: "#FF6347",
    brick: "#B22222",
    carmine: "#960018",
    cardinal: "#C41E3A",
    ruby: "#E0115F",
    cherry: "#DE3163",
    candyapple: "#FF0800",
    fireengine: "#CE2029",
    persianred: "#C72C41",
    indianred: "#CD5C5C",
    englishred: "#AB4E52",
    venetianred: "#C80815",
    cinnabar: "#E34234",
    garnet: "#733635",
    oxblood: "#4A0000",
    blood: "#8A0303",
    // ===== PINKS / ROSES =====
    rose: "#F43F5E",
    pink: "#FF4FA3",
    hotpink: "#FF69B4",
    deeppink: "#FF1493",
    fuchsia: "#FF00CC",
    magenta: "#FF00AA",
    salmon: "#FA8072",
    lightsalmon: "#FFA07A",
    coral: "#FF6B4A",
    blush: "#DE5D83",
    raspberry: "#E30B5D",
    watermelon: "#FC6C85",
    flamingo: "#FC8EAC",
    bubblegum: "#FFC1CC",
    carnation: "#FFA6C9",
    ballet: "#F4C2C2",
    dustyrose: "#DCAE96",
    oldrose: "#C08081",
    rosewood: "#65000B",
    frenchrose: "#F64A8A",
    tea: "#D0F0C0",
    // ===== ORANGES =====
    orange: "#F97316",
    tangerine: "#FF8C00",
    persimmon: "#EC5800",
    apricot: "#FBCEB1",
    peach: "#FFAB70",
    cantaloupe: "#FFA07A",
    mango: "#FF8243",
    pumpkin: "#FF7518",
    carrot: "#ED9121",
    amber: "#F59E0B",
    honey: "#EB9605",
    saffron: "#F4C430",
    marigold: "#EAA221",
    cadmiumorange: "#ED872D",
    burntorange: "#CC5500",
    terracotta: "#E2725B",
    coralorange: "#FF7F50",
    // ===== YELLOWS / GOLDS =====
    gold: "#EAB308",
    yellow: "#FACC15",
    lemon: "#FFF44F",
    canary: "#FFEF00",
    mustard: "#E1AD01",
    maize: "#FBEC5D",
    butter: "#FFFD74",
    creamyellow: "#FFFDD0",
    champagne: "#F7E7CE",
    flavescent: "#F7E98E",
    goldenrod: "#DAA520",
    darkgoldenrod: "#B8860B",
    khaki: "#C3B091",
    jasmine: "#F8DE7E",
    // ===== EARTHS / BROWNS =====
    ochre: "#CC7722",
    sienna: "#A0522D",
    rawumber: "#826644",
    burntumber: "#8A3324",
    umber: "#635147",
    rust: "#B7410E",
    brown: "#92400E",
    chocolate: "#7B3F00",
    coffee: "#6F4E37",
    espresso: "#3C1414",
    mahogany: "#C04000",
    chestnut: "#954535",
    bronze: "#CD7F32",
    copper: "#B87333",
    cinnamon: "#D2691E",
    tan: "#D2B48C",
    sand: "#C2B280",
    taupe: "#483C32",
    walnut: "#5C4033",
    auburn: "#A52A2A",
    sepia: "#704214",
    cocoa: "#D2691E",
    caramel: "#FFD59A",
    ginger: "#B06500",
    clay: "#B66A50",
    adobe: "#BD6A4C",
    // ===== GREENS =====
    green: "#16A34A",
    forest: "#228B22",
    hunter: "#355E3B",
    emerald: "#059669",
    jade: "#00A86B",
    mint: "#34D399",
    seafoam: "#93E9BE",
    sage: "#9CAF88",
    moss: "#8A9A5B",
    olive: "#6B8E23",
    lime: "#84CC16",
    chartreuse: "#B8FF00",
    pine: "#01796F",
    fern: "#4F7942",
    malachite: "#0BDA51",
    kelly: "#4CBB17",
    neon: "#39FF14",
    springgreen: "#00FF7F",
    seafoamgreen: "#9FE2BF",
    aquamarine: "#7FFFD4",
    viridian: "#40826D",
    phthalo: "#000F89",
    hookersgreen: "#49796B",
    artichoke: "#8F9779",
    avocado: "#568203",
    pear: "#D1E231",
    pickle: "#563F1B",
    shamrock: "#009E60",
    // ===== TEALS / CYANS =====
    teal: "#0D9488",
    turquoise: "#14B8A6",
    cyan: "#06B6D4",
    aqua: "#00FFFF",
    tiffany: "#0ABAB5",
    peacock: "#33A1C9",
    lagoon: "#007BA7",
    // ===== BLUES =====
    sky: "#38BDF8",
    azure: "#0080FF",
    cerulean: "#007BA7",
    blue: "#2563EB",
    sapphire: "#0B5FFF",
    cobalt: "#0047AB",
    ultramarine: "#1E3A8A",
    royal: "#4169E1",
    periwinkle: "#CCCCFF",
    indigo: "#4338CA",
    navy: "#1E3A5F",
    midnight: "#191970",
    denim: "#1560BD",
    ice: "#A5F2F3",
    powderblue: "#B0E0E6",
    babyblue: "#89CFF0",
    cornflower: "#6495ED",
    steelblue: "#4682B4",
    dodger: "#1E90FF",
    frenchblue: "#0072BB",
    prussian: "#003153",
    yale: "#0F4D92",
    oxford: "#002147",
    arctic: "#D6EAF8",
    glacial: "#A3D5FF",
    turquoiseblue: "#00FFEF",
    // ===== PURPLES / VIOLETS =====
    purple: "#A855F7",
    violet: "#7C3AED",
    lavender: "#C084FC",
    lilac: "#C8A2C8",
    orchid: "#DA70D6",
    mauve: "#C26B9A",
    plum: "#9B2D8A",
    eggplant: "#614051",
    amethyst: "#9966CC",
    grape: "#6F2DA8",
    wine: "#722F37",
    burgundy: "#7F1D1D",
    maroon: "#9F1239",
    mulberry: "#C54B8C",
    heliotrope: "#DF73FF",
    thistle: "#D8BFD8",
    wisteria: "#C9A0DC",
    byzantium: "#702963",
    tyrian: "#66023C",
    iris: "#5A4FCF",
    electricviolet: "#8F00FF",
    // ===== NEUTRALS =====
    white: "#F8FAFC",
    ivory: "#FFFFF0",
    cream: "#FFF5E0",
    bone: "#E3DAC9",
    beige: "#F5F0DC",
    linen: "#FAF0E6",
    pearl: "#EAE0C8",
    alabaster: "#EDEAE0",
    snow: "#FFFAFA",
    silver: "#C0C0C0",
    platinum: "#E5E4E2",
    gray: "#6B7280",
    grey: "#6B7280",
    slate: "#64748B",
    steel: "#71797E",
    ash: "#B2BEB5",
    charcoal: "#374151",
    graphite: "#383838",
    black: "#0A0A0C",
    ebony: "#555D50",
    jet: "#343434",
    onyx: "#353839",
    smoke: "#738276",
    pewter: "#8E9293",
    warmgray: "#8B8589",
    coolgray: "#8C92AC",
    // ===== METALLICS / SPECIAL =====
    gunmetal: "#2A3439",
    brass: "#B5A642",
    rosegold: "#B76E79",
    champagnegold: "#F7E7CE",
  };

  var GE_COLOR_NEUTRAL_NAMES = {
    white: 1, ivory: 1, cream: 1, bone: 1, beige: 1, linen: 1, pearl: 1,
    alabaster: 1, snow: 1, silver: 1, platinum: 1, gray: 1, grey: 1,
    slate: 1, steel: 1, ash: 1, charcoal: 1, graphite: 1, black: 1,
    ebony: 1, jet: 1, onyx: 1, smoke: 1, pewter: 1, warmgray: 1, coolgray: 1,
    tan: 1, khaki: 1, sand: 1, taupe: 1, gunmetal: 1,
  };

  function geRgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var h = 0, s = 0, l = (max + min) / 2;
    if (max !== min) {
      var d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
      else if (max === g) h = ((b - r) / d + 2) / 6;
      else h = ((r - g) / d + 4) / 6;
    }
    return { h: h * 360, s: s * 100, l: l * 100 };
  }

  function geRgbToLab(r, g, b) {
    function lin(c) {
      c = c / 255;
      return c > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92;
    }
    var R = lin(r), G = lin(g), B = lin(b);
    var x = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / 0.95047;
    var y = (R * 0.2126729 + G * 0.7151522 + B * 0.072175) / 1.0;
    var z = (R * 0.0193339 + G * 0.119192 + B * 0.9503041) / 1.08883;
    function f(tv) {
      return tv > 0.008856 ? Math.pow(tv, 1 / 3) : 7.787 * tv + 16 / 116;
    }
    var fx = f(x), fy = f(y), fz = f(z);
    return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
  }

  function geLabDistanceSq(A, B) {
    if (!A || !B) return 1e12;
    var dL = A.L - B.L, da = A.a - B.a, db = A.b - B.b;
    return dL * dL + da * da + db * db;
  }

  function geIsNeutralSample(hsl, lab) {
    if (!hsl) return true;
    var chroma = lab ? Math.sqrt(lab.a * lab.a + lab.b * lab.b) : hsl.s;
    if (hsl.s < 12 || chroma < 10) return true;
    if (hsl.s < 22 && (hsl.l < 10 || hsl.l > 93)) return true;
    if (hsl.s < 18 && hsl.l > 78 && chroma < 18) return true;
    return false;
  }

  function geTitleCaseColorName(name) {
    var s = String(name || "color");
    var compounds = [
      ["hotpink", "Hot Pink"],
      ["deeppink", "Deep Pink"],
      ["lightsalmon", "Light Salmon"],
      ["cadmiumred", "Cadmium Red"],
      ["cadmiumorange", "Cadmium Orange"],
      ["powderblue", "Powder Blue"],
      ["babyblue", "Baby Blue"],
      ["steelblue", "Steel Blue"],
      ["frenchblue", "French Blue"],
      ["frenchrose", "French Rose"],
      ["dustyrose", "Dusty Rose"],
      ["candyapple", "Candy Apple"],
      ["fireengine", "Fire Engine"],
      ["persianred", "Persian Red"],
      ["indianred", "Indian Red"],
      ["englishred", "English Red"],
      ["venetianred", "Venetian Red"],
      ["burntorange", "Burnt Orange"],
      ["coralorange", "Coral Orange"],
      ["creamyyellow", "Cream Yellow"],
      ["creamyellow", "Cream Yellow"],
      ["darkgoldenrod", "Dark Goldenrod"],
      ["rawumber", "Raw Umber"],
      ["burntumber", "Burnt Umber"],
      ["springgreen", "Spring Green"],
      ["seafoamgreen", "Seafoam Green"],
      ["hookersgreen", "Hooker's Green"],
      ["turquoiseblue", "Turquoise Blue"],
      ["electricviolet", "Electric Violet"],
      ["warmgray", "Warm Gray"],
      ["coolgray", "Cool Gray"],
      ["rosegold", "Rose Gold"],
      ["champagnegold", "Champagne Gold"],
    ];
    for (var i = 0; i < compounds.length; i++) {
      var re = new RegExp(compounds[i][0], "gi");
      s = s.replace(re, compounds[i][1]);
    }
    return s
      .replace(/^vivid\s+/i, "")
      .split(/[\s\-_]+/)
      .filter(Boolean)
      .map(function (w) {
        if (w.indexOf("'") >= 0) return w; // already titled compound piece
        // Keep already-cased compound tokens from replacements above
        if (/[A-Z]/.test(w.slice(1))) return w;
        return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
      })
      .join(" ");
  }

  function geHexToNearestBaseName(hex) {
    var h = normalizeGeHex(hex);
    if (!h) return "color";
    var rgb = geHexToRgb(h);
    if (!rgb) return "color";
    var lab = geRgbToLab(rgb.r, rgb.g, rgb.b);
    var hsl = geRgbToHsl(rgb.r, rgb.g, rgb.b);
    var sampleNeutral = geIsNeutralSample(hsl, lab);
    var best = "color";
    var bestD = Infinity;
    var keys = Object.keys(GE_COLOR_NAME_HEX);
    for (var i = 0; i < keys.length; i++) {
      var name = keys[i];
      if (name === "grey") continue;
      var refHex = GE_COLOR_NAME_HEX[name];
      if (refHex === h) return name;
      var ref = geHexToRgb(refHex);
      if (!ref) continue;
      var refLab = geRgbToLab(ref.r, ref.g, ref.b);
      var refHsl = geRgbToHsl(ref.r, ref.g, ref.b);
      var refNeutral = !!GE_COLOR_NEUTRAL_NAMES[name] || geIsNeutralSample(refHsl, refLab);
      if (sampleNeutral !== refNeutral) continue;
      var d = geLabDistanceSq(lab, refLab);
      if (!sampleNeutral) {
        var dh = Math.abs(hsl.h - refHsl.h);
        if (dh > 180) dh = 360 - dh;
        d += (dh / 180) * (dh / 180) * 140;
        if (hsl.s > 45 && refHsl.s < 30) d += 80;
        var dL = lab.L - refLab.L;
        d += dL * dL * 0.15;
      } else {
        var dLn = lab.L - refLab.L;
        d =
          dLn * dLn * 1.35 +
          (lab.a - refLab.a) * (lab.a - refLab.a) * 0.6 +
          (lab.b - refLab.b) * (lab.b - refLab.b) * 0.6;
      }
      if (d < bestD) {
        bestD = d;
        best = name;
      }
    }
    return best;
  }

  function geHexToNearestName(hex) {
    var h = normalizeGeHex(hex);
    var base = geHexToNearestBaseName(h);
    if (!base || base === "color") return "Color";
    if (GE_COLOR_NEUTRAL_NAMES[base]) return geTitleCaseColorName(base);
    var rgb = geHexToRgb(h);
    var ref = geHexToRgb(GE_COLOR_NAME_HEX[base]);
    if (!rgb || !ref) return geTitleCaseColorName(base);
    var lab = geRgbToLab(rgb.r, rgb.g, rgb.b);
    var refLab = geRgbToLab(ref.r, ref.g, ref.b);
    var hsl = geRgbToHsl(rgb.r, rgb.g, rgb.b);
    var refHsl = geRgbToHsl(ref.r, ref.g, ref.b);
    var L = lab.L, refL = refLab.L, dL = L - refL, prefix = "";
    if (hsl.s > refHsl.s + 28 && hsl.s > 70 && L > 28 && L < 72) prefix = "vivid ";
    else if (dL > 18 && L > 62) prefix = "light ";
    else if (dL > 12 && L > 78) prefix = "pale ";
    else if (dL < -18 && L < 42) prefix = "deep ";
    else if (dL < -12 && L < 28) prefix = "dark ";
    else if (hsl.s + 25 < refHsl.s && hsl.s < 40 && !geIsNeutralSample(hsl, lab)) prefix = "muted ";
    return geTitleCaseColorName(prefix + base);
  }

  function colorChipLabel(name, hex) {
    var h = normalizeGeHex(hex) || "#888888";
    var n = geHexToNearestName(h) || String(name || "").trim() || "Color";
    return n + " (" + h + ")";
  }

  function colorChipThumb(hex) {
    var h = normalizeGeHex(hex) || "#888888";
    return (
      "data:image/svg+xml," +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">' +
          '<rect width="64" height="64" rx="10" fill="' +
          h +
          '"/>' +
          '<rect x="3" y="3" width="58" height="58" rx="8" fill="none" stroke="#000" stroke-opacity=".35" stroke-width="2"/>' +
          "</svg>"
      )
    );
  }

  function colorChipOf(n) {
    n = Number(n);
    if (!state || !state.colorChips) return null;
    return state.colorChips[String(n)] || state.colorChips[n] || null;
  }

  function isColorChipId(n) {
    n = Number(n);
    return !!colorChipOf(n) || (n > COLOR_BASE && n < COLOR_BASE + 100000);
  }


  function scanGeColorSpans(text) {
    text = String(text || "");
    var occupied = new Array(text.length);
    var spans = [];
    var m;
    function mark(from, to) {
      for (var i = from; i < to; i++) occupied[i] = true;
    }
    function free(from, to) {
      for (var j = from; j < to; j++) {
        if (occupied[j]) return false;
      }
      return true;
    }
    var labeledRe =
      /\b((?:vivid\s+)?[A-Za-z][A-Za-z\s\-]{0,28}?)\s*\(#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})\)/g;
    while ((m = labeledRe.exec(text))) {
      var hxL = normalizeGeHex("#" + m[2]);
      if (!hxL) continue;
      if (!free(m.index, m.index + m[0].length)) continue;
      mark(m.index, m.index + m[0].length);
      spans.push({
        start: m.index,
        end: m.index + m[0].length,
        kind: "labeled",
        value: m[0],
        hex: hxL,
        name: String(m[1] || "").replace(/^vivid\s+/i, "").trim(),
      });
    }
    var hexRe = /#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/g;
    while ((m = hexRe.exec(text))) {
      var hx = normalizeGeHex(m[0]);
      if (!hx) continue;
      if (!free(m.index, m.index + m[0].length)) continue;
      mark(m.index, m.index + m[0].length);
      spans.push({
        start: m.index,
        end: m.index + m[0].length,
        kind: "hex",
        value: m[0],
        hex: hx,
        name: geHexToNearestName(hx),
      });
    }
    var nameAliases = {
      hotpink: "hot pink",
      deeppink: "deep pink",
      lightsalmon: "light salmon",
      cadmiumred: "cadmium red",
      cadmiumorange: "cadmium orange",
      powderblue: "powder blue",
      babyblue: "baby blue",
      steelblue: "steel blue",
      frenchblue: "french blue",
      frenchrose: "french rose",
      dustyrose: "dusty rose",
      candyapple: "candy apple",
      fireengine: "fire engine",
      persianred: "persian red",
      indianred: "indian red",
      englishred: "english red",
      venetianred: "venetian red",
      burntorange: "burnt orange",
      coralorange: "coral orange",
      creamyellow: "cream yellow",
      darkgoldenrod: "dark goldenrod",
      rawumber: "raw umber",
      burntumber: "burnt umber",
      springgreen: "spring green",
      seafoamgreen: "seafoam green",
      hookersgreen: "hookers green",
      turquoiseblue: "turquoise blue",
      electricviolet: "electric violet",
      warmgray: "warm gray",
      coolgray: "cool gray",
      rosegold: "rose gold",
      champagnegold: "champagne gold",
    };
    var names = Object.keys(GE_COLOR_NAME_HEX).sort(function (a, b) {
      return b.length - a.length;
    });
    var tone = "(?:pale|light|deep|dark|vivid|muted|bright|soft)\\s+";
    for (var n = 0; n < names.length; n++) {
      var name = names[n];
      if (name === "grey") continue;
      var display = nameAliases[name] || name;
      var escName = display.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
      var pattern = "(?:" + tone + ")?" + escName;
      if (display.indexOf(" ") >= 0) {
        pattern = "(?:" + pattern + "|(?:" + tone + ")?" + name + ")";
      }
      var re = new RegExp("\\b" + pattern + "\\b", "gi");
      var mm;
      while ((mm = re.exec(text))) {
        if (!free(mm.index, mm.index + mm[0].length)) continue;
        mark(mm.index, mm.index + mm[0].length);
        spans.push({
          start: mm.index,
          end: mm.index + mm[0].length,
          kind: "name",
          value: mm[0],
          hex: GE_COLOR_NAME_HEX[name],
          name: geTitleCaseColorName(mm[0]),
        });
      }
    }
    spans.sort(function (a, b) {
      return a.start - b.start;
    });
    return spans;
  }

  function buildGeColorHitHtml(text, opts) {
    opts = opts || {};
    var source = opts.source || "note";
    var itemId = opts.itemId != null ? String(opts.itemId) : "";
    var spans = scanGeColorSpans(text);
    if (!spans.length) return esc(text);
    var html = "";
    var pos = 0;
    spans.forEach(function (sp, idx) {
      if (sp.start > pos) html += esc(text.slice(pos, sp.start));
      var title =
        "Click to set pigment → Apply writes “" + colorChipLabel(sp.name, sp.hex) + "”";
      html +=
        '<button type="button" class="ge-color-hit" data-ge-color-source="' +
        esc(source) +
        '" data-item-id="' +
        esc(itemId) +
        '" data-start="' +
        sp.start +
        '" data-end="' +
        sp.end +
        '" data-kind="' +
        sp.kind +
        '" data-hex="' +
        esc(sp.hex) +
        '" data-name="' +
        esc(sp.name || "") +
        '" data-value="' +
        esc(sp.value) +
        '" data-index="' +
        idx +
        '" title="' +
        esc(title) +
        '" style="--swatch:' +
        esc(sp.hex) +
        '">' +
        '<i class="ge-color-hit-swatch" aria-hidden="true"></i>' +
        "<span>" +
        esc(sp.value) +
        "</span>" +
        (sp.kind === "name"
          ? '<em class="ge-color-hit-hex">' + esc(sp.hex) + "</em>"
          : sp.kind === "hex"
            ? '<em class="ge-color-hit-hex">' + esc(sp.name || "") + "</em>"
            : "") +
        "</button>";
      pos = sp.end;
    });
    if (pos < text.length) html += esc(text.slice(pos));
    return html;
  }

  function renderNoteColorHits() {
    var host = $("ge-note-color-hits");
    var ta = $("ge-note-text");
    if (!host) return;
    var text = ta ? ta.value : "";
    var spans = scanGeColorSpans(text);
    if (!spans.length) {
      host.innerHTML = "";
      return;
    }
    host.innerHTML = spans
      .map(function (sp, idx) {
        return (
          '<button type="button" class="ge-color-hit" data-ge-color-source="note" data-start="' +
          sp.start +
          '" data-end="' +
          sp.end +
          '" data-kind="' +
          sp.kind +
          '" data-hex="' +
          esc(sp.hex) +
          '" data-name="' +
          esc(sp.name || "") +
          '" data-value="' +
          esc(sp.value) +
          '" data-index="' +
          idx +
          '" title="Lock ' +
          esc(colorChipLabel(sp.name, sp.hex)) +
          '" style="--swatch:' +
          esc(sp.hex) +
          '">' +
          '<i class="ge-color-hit-swatch" aria-hidden="true"></i>' +
          "<span>" +
          esc(sp.value) +
          "</span>" +
          (sp.kind === "name"
            ? '<em class="ge-color-hit-hex">' + esc(sp.hex) + "</em>"
            : "") +
          "</button>"
        );
      })
      .join("");
  }

  function closeGeColorPopover() {
    var old = document.getElementById("ge-color-popover");
    if (old) old.remove();
  }

  function applyGeColorRewrite(source, start, end, hex, name, itemId) {
    hex = normalizeGeHex(hex);
    if (!hex) return { ok: false, error: "Invalid hex." };
    var label = colorChipLabel(name || geHexToNearestName(hex), hex);

    function rewriteInString(text, s, e) {
      s = Number(s);
      e = Number(e);
      text = String(text || "");
      if (s >= 0 && e > s && e <= text.length) {
        return text.slice(0, s) + label + text.slice(e);
      }
      return null;
    }

    if (source === "note") {
      var ta = $("ge-note-text");
      if (!ta) return { ok: false, error: "Note missing." };
      var next = rewriteInString(ta.value || "", start, end);
      if (next == null) {
        // Fallback: replace first matching old value token
        return { ok: false, error: "Color span moved — click the chip again." };
      }
      ta.value = next;
      ta.focus();
      try {
        var caret = Number(start) + label.length;
        ta.setSelectionRange(caret, caret);
      } catch (e2) {}
      renderNoteColorHits();
      return { ok: true, label: label };
    }

    if (source === "desc") {
      itemId = Number(itemId);
      if (!itemId) return { ok: false, error: "No item." };
      if (!state.descOverrides) state.descOverrides = {};
      var body = fullDescFor(itemId);
      var nextDesc = rewriteInString(body, start, end);
      if (nextDesc == null) {
        return { ok: false, error: "Color span moved — reopen Description." };
      }
      state.descOverrides[String(itemId)] = nextDesc;
      var f = forgedOf(itemId);
      if (f) {
        if (f._originalDescription == null) f._originalDescription = String(f.description || body || "");
        f.description = nextDesc;
      }
      saveState();
      openItemDescription(itemId);
      return { ok: true, label: label };
    }
    return { ok: false, error: "Unknown source." };
  }

  function openGeColorPopover(anchorBtn) {
    closeGeColorPopover();
    if (!anchorBtn) return;
    var startHex = normalizeGeHex(anchorBtn.getAttribute("data-hex")) || "#888888";
    var startName = anchorBtn.getAttribute("data-name") || geHexToNearestName(startHex);
    var source = anchorBtn.getAttribute("data-ge-color-source") || "note";
    var start = anchorBtn.getAttribute("data-start");
    var end = anchorBtn.getAttribute("data-end");
    var itemId = anchorBtn.getAttribute("data-item-id") || "";
    var pop = document.createElement("div");
    pop.id = "ge-color-popover";
    pop.className = "ge-color-popover";
    pop.innerHTML =
      '<div class="ge-color-popover-title">Color chip</div>' +
      '<div class="ge-color-popover-row">' +
      '<input type="color" class="ge-color-pop-swatch" value="' +
      startHex +
      '" />' +
      '<input type="text" class="ge-color-pop-hex" value="' +
      startHex +
      '" maxlength="7" spellcheck="false" />' +
      "</div>" +
      '<div class="ge-color-popover-preview">Writes: <strong class="ge-color-pop-label">' +
      esc(colorChipLabel(startName, startHex)) +
      "</strong></div>" +
      '<p class="ge-color-chips-hint" style="margin:0 0 8px">' +
      (source === "desc"
        ? "Apply rewrites this color in the item description."
        : "Apply rewrites this color in the note as Name (#HEX).") +
      "</p>" +
      '<div class="ge-color-popover-actions">' +
      '<button type="button" class="ge-color-popover-cancel">Cancel</button>' +
      '<button type="button" class="ge-color-popover-apply">Apply</button>' +
      "</div>";
    document.body.appendChild(pop);

    // Do NOT capture-stop on the whole popover — that blocked Apply/Cancel.
    // Outside-dismiss is handled by the document click (ignores pop.contains).

    var rect = anchorBtn.getBoundingClientRect();
    var left = Math.min(rect.left, window.innerWidth - (pop.offsetWidth || 280) - 12);
    var top = Math.min(rect.bottom + 6, window.innerHeight - (pop.offsetHeight || 180) - 12);
    pop.style.left = Math.max(8, left) + "px";
    pop.style.top = Math.max(8, top) + "px";

    var sw = pop.querySelector(".ge-color-pop-swatch");
    var hx = pop.querySelector(".ge-color-pop-hex");
    var lab = pop.querySelector(".ge-color-pop-label");
    var suppressOutsideUntil = 0;

    function syncPreview() {
      var h = normalizeGeHex(hx.value) || normalizeGeHex(sw.value) || startHex;
      if (!h) return;
      try {
        sw.value = h;
      } catch (eSw) {}
      hx.value = h;
      var n = geHexToNearestName(h);
      if (lab) lab.textContent = colorChipLabel(n, h);
    }

    function doApply() {
      var h = normalizeGeHex(hx.value) || normalizeGeHex(sw.value);
      if (!h) {
        setForgeStatus("Pick a valid hex color.", true);
        return;
      }
      var n = geHexToNearestName(h);
      var res = applyGeColorRewrite(source, start, end, h, n, itemId);
      closeGeColorPopover();
      if (!res.ok) setForgeStatus(res.error, true);
      else setForgeStatus("Locked " + res.label + (source === "desc" ? " in description." : " in note."));
    }

    sw.addEventListener("input", function () {
      hx.value = sw.value;
      syncPreview();
    });
    sw.addEventListener("change", function () {
      // Native picker closes with a document click — ignore that dismiss briefly
      suppressOutsideUntil = Date.now() + 500;
      hx.value = sw.value;
      syncPreview();
      pop.dataset.suppressOutsideUntil = String(suppressOutsideUntil);
    });
    sw.addEventListener("click", function (e) {
      e.stopPropagation();
      suppressOutsideUntil = Date.now() + 800;
      pop.dataset.suppressOutsideUntil = String(suppressOutsideUntil);
    });
    hx.addEventListener("input", syncPreview);
    hx.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        doApply();
      }
    });
    function onCancel(e) {
      e.preventDefault();
      e.stopPropagation();
      closeGeColorPopover();
    }
    function onApply(e) {
      e.preventDefault();
      e.stopPropagation();
      doApply();
    }
    var cancelEl = pop.querySelector(".ge-color-popover-cancel");
    var applyEl = pop.querySelector(".ge-color-popover-apply");
    cancelEl.addEventListener("pointerdown", onCancel);
    cancelEl.addEventListener("click", onCancel);
    applyEl.addEventListener("pointerdown", onApply);
    applyEl.addEventListener("click", onApply);
  }

  var geDescEditItemId = null;

  function renderDescToolbar(itemId, dirty) {
    return (
      '<div class="ge-desc-toolbar">' +
      '<button type="button" class="ge-desc-edit-btn" data-item-id="' +
      itemId +
      '">Edit text</button>' +
      '<button type="button" class="ge-desc-default-btn" data-item-id="' +
      itemId +
      '"' +
      (dirty ? "" : " disabled") +
      ">Default text</button>" +
      "</div>"
    );
  }

  function openItemDescription(itemId) {
    itemId = Number(itemId);
    if (!itemId) return { ok: false, error: "No item." };
    if (noteOf(itemId) && !ledgerOf(itemId)) {
      return openItemFullscreen(itemId);
    }
    closeGeColorPopover();
    geDescEditItemId = itemId;
    var lb = $("ge-lightbox");
    if (!lb) return { ok: false, error: "Viewer missing." };
    var img = $("ge-lightbox-img");
    var noteEl = $("ge-lightbox-note");
    var plain = $("ge-lightbox-desc");
    var rich = $("ge-lightbox-desc-rich");
    if (noteEl) {
      noteEl.hidden = true;
      noteEl.textContent = "";
    }
    var isLed = !!ledgerOf(itemId);
    var noteEl2 = $("ge-lightbox-note");
    if (isLed) {
      if (img) {
        img.hidden = true;
        img.removeAttribute("src");
      }
      if (noteEl2) {
        noteEl2.hidden = false;
        noteEl2.textContent = notePromptOf(ledgerOf(itemId)) || titleFor(itemId);
      }
    } else {
      if (noteEl2) {
        noteEl2.hidden = true;
        noteEl2.textContent = "";
      }
      if (img) {
        img.hidden = false;
        img.src = thumb(itemId);
        img.alt = titleFor(itemId);
      }
    }
    var body = String(fullDescFor(itemId) || "").trim();
    var dirty = !!(state.descOverrides && state.descOverrides[String(itemId)] != null);
    if ($("ge-lightbox-title")) {
      $("ge-lightbox-title").textContent = kindLabel(itemId) + " · " + titleFor(itemId);
    }
    if (plain) {
      plain.hidden = true;
      plain.textContent = "";
    }
    if (rich) {
      rich.hidden = false;
      rich.innerHTML =
        renderDescToolbar(itemId, dirty) +
        '<div class="ge-desc-rich-body" data-item-id="' +
        itemId +
        '">' +
        (body
          ? buildGeColorHitHtml(body, { source: "desc", itemId: itemId })
          : "<em>No description text.</em>") +
        "</div>" +
        (isLed
          ? '<p class="ge-color-chips-hint" style="margin-top:10px">Ledger composition prompt is above. Edit this description, then right-click → Generate when ready.</p>'
          : '<p class="ge-color-chips-hint" style="margin-top:10px">Click a color chip to change its pigment. Edit text / Default text work like Spellforge.</p>');
    }
    lb.hidden = false;
    return { ok: true };
  }

  function startGeDescTextEdit(itemId) {
    itemId = Number(itemId);
    var rich = $("ge-lightbox-desc-rich");
    if (!rich || !itemId) return;
    var body = String(fullDescFor(itemId) || "");
    var dirty = !!(state.descOverrides && state.descOverrides[String(itemId)] != null);
    rich.innerHTML =
      renderDescToolbar(itemId, dirty) +
      '<textarea class="ge-desc-edit" id="ge-desc-edit-ta"></textarea>' +
      '<div class="ge-desc-edit-actions">' +
      '<button type="button" class="ge-desc-edit-cancel" data-item-id="' +
      itemId +
      '">Cancel</button>' +
      '<button type="button" class="ge-desc-edit-save" data-item-id="' +
      itemId +
      '">Save text</button>' +
      "</div>";
    var ta = $("ge-desc-edit-ta");
    if (ta) {
      ta.value = body;
      ta.focus();
    }
  }

  function saveGeDescTextEdit(itemId) {
    itemId = Number(itemId);
    var ta = $("ge-desc-edit-ta");
    if (!ta || !itemId) return;
    if (!state.descOverrides) state.descOverrides = {};
    var text = String(ta.value || "");
    var orig = originalDescFor(itemId);
    if (text === orig) {
      delete state.descOverrides[String(itemId)];
    } else {
      state.descOverrides[String(itemId)] = text;
      var f = forgedOf(itemId);
      if (f) {
        if (f._originalDescription == null) f._originalDescription = String(f.description || orig || "");
        f.description = text;
      }
      var led = ledgerOf(itemId);
      if (led) {
        if (led._originalDescription == null) {
          led._originalDescription = String(led.description != null ? led.description : notePromptOf(led) || "");
        }
        led.description = text;
        state.notes[String(itemId)] = led;
        syncNoteToSpellforgeStore(led);
      }
    }
    saveState();
    openItemDescription(itemId);
    setStatus("Description saved for " + kindLabel(itemId) + ".");
  }

  function revertGeDescText(itemId) {
    itemId = Number(itemId);
    if (!itemId) return;
    if (state.descOverrides) delete state.descOverrides[String(itemId)];
    var f = forgedOf(itemId);
    if (f && f._originalDescription) f.description = f._originalDescription;
    var led = ledgerOf(itemId);
    if (led && led._originalDescription != null) {
      led.description = led._originalDescription;
      state.notes[String(itemId)] = led;
      syncNoteToSpellforgeStore(led);
    }
    saveState();
    openItemDescription(itemId);
    setStatus("Reverted to default description.");
  }

  /** One-time: remove old preset color-chip items from pack/bank. */
  function purgePresetColorChips() {
    if (state._purgedPresetColorChips) return;
    var pid = String(PLAYER_ID);
    var inv = (state.inventory && state.inventory[pid]) || {};
    var bank = (state.bank && state.bank[pid]) || {};
    // Defaults were COLOR_BASE+1 .. +6
    for (var i = 1; i <= 6; i++) {
      var k = String(COLOR_BASE + i);
      delete inv[k];
      delete bank[k];
      if (state.colorChips) delete state.colorChips[k];
    }
    state._purgedPresetColorChips = true;
    state._colorChipsSeeded = true; // never re-seed
    state._colorChipCatalogReady = true;
  }


  function syncNoteToSpellforgeStore(note) {
    if (!note || note.id == null) return;
    try {
      var raw = localStorage.getItem("spellforge_notes_v1");
      var store = raw ? JSON.parse(raw) : { notes: {}, nextNoteId: NOTE_BASE + 1 };
      if (!store.notes) store.notes = {};
      var norm = normalizeNoteEntry(note, note.id);
      var packed = {
        id: note.id,
        title: String((norm && norm.title) || "Note").slice(0, 80),
        text: String((norm && norm.text) || "").slice(0, PERSIST_NOTE_TEXT_MAX),
        createdAt: (norm && norm.createdAt) || Date.now(),
      };
      if (norm && isLedgerNote(norm)) {
        packed.kind = "ledger";
        packed.isLedger = true;
        packed.pendingGenerate = norm.pendingGenerate !== false;
        var desc = String(norm.description != null ? norm.description : packed.text).slice(
          0,
          PERSIST_NOTE_DESC_MAX
        );
        // Avoid duplicating the same long prompt in both fields.
        if (desc && desc !== packed.text) packed.description = desc;
        packed.parents = Array.isArray(norm.parents) ? norm.parents.map(Number).slice(0, 3) : [];
        if (norm.guide != null) packed.guide = Math.max(1, Math.round(Number(norm.guide) || 1));
      }
      store.notes[String(note.id)] = packed;
      // Cap shared Spellforge note bag so it cannot eat the GE quota.
      var ids = Object.keys(store.notes).sort(function (a, b) {
        return Number(a) - Number(b);
      });
      while (ids.length > PERSIST_MAX_NOTES) {
        var drop = ids.shift();
        delete store.notes[drop];
      }
      var next = Math.max(
        Number(store.nextNoteId) || NOTE_BASE + 1,
        Number(note.id) + 1,
        Number(state && state.nextNoteId) || NOTE_BASE + 1
      );
      store.nextNoteId = next;
      localStorage.setItem("spellforge_notes_v1", JSON.stringify(store));
    } catch (e) {}
  }

  function extraOf(n) {
    n = Number(n);
    return extraItems[n] || extraItems[String(n)] || null;
  }

  function kindLabel(n) {
    n = Number(n);
    if (colorChipOf(n)) return "Color " + colorChipLabel(colorChipOf(n).name, colorChipOf(n).hex);
    if (ledgerOf(n)) return "Ledger #" + n;
    if (noteOf(n)) return "Note #" + n;
    var f = forgedOf(n);
    if (f) return "Forged #" + n;
    var ex = extraOf(n);
    if (!ex) return "#" + n;
    var g = ex.genNum != null ? ex.genNum : n;
    if (ex.source === "phone-upload") return "Phone G#" + g;
    if (ex.source === "sketch") return "Sketch S#" + g;
    if (ex.source === "sketch-inverted") return "Inv sketch SI#" + g;
    return "Gen G#" + g;
  }

  function thumb(n) {
    n = Number(n);
    if (colorChipOf(n)) return colorChipThumb(colorChipOf(n).hex);
    if (ledgerOf(n)) return LEDGER_THUMB;
    if (noteOf(n)) return NOTE_THUMB;
    if (thumbOverrides[String(n)]) return thumbOverrides[String(n)];
    var f = forgedOf(n);
    if (f && f.imageUrl) return assetUrl(f.imageUrl);
    if (f && f.thumb && !isParentPaintingUrl(f.thumb, f.parents)) return assetUrl(f.thumb);
    var ex = extraOf(n);
    if (ex && ex.url) return assetUrl(ex.url);
    if (n >= GEN_BASE && n < SKETCH_BASE) {
      var g = n - GEN_BASE;
      return assetUrl("/generated/" + g + ".jpg");
    }
    // Last resort for forged: parent stand-in (display only — Force load will regenerate)
    if (f && f.parents && f.parents[0]) return thumb(f.parents[0]);
    if (f && f.thumb) return assetUrl(f.thumb);
    if (n >= 1 && n <= PAINTING_TOTAL) return "paintings/" + n + ".jpg";
    return "paintings/1.jpg";
  }

  function paintingPathFor(id) {
    id = Number(id);
    if (id >= 1 && id <= PAINTING_TOTAL) return "paintings/" + id + ".jpg";
    return "";
  }

  /** True if url is clearly one of this forged item's parent paintings (wrong for Force load). */
  function isParentPaintingUrl(url, parents) {
    if (!url || !parents || !parents.length) return false;
    var s = String(url).split("?")[0].replace(/^.*\//, "");
    // paintings/123.jpg or .../paintings/123.jpg
    var m = String(url).match(/paintings\/(\d+)\.(?:jpg|jpeg|png|webp)/i);
    if (!m) return false;
    var pid = Number(m[1]);
    for (var i = 0; i < parents.length; i++) {
      if (Number(parents[i]) === pid) return true;
    }
    return false;
  }

  function rawThumbCandidates(itemId) {
    itemId = Number(itemId);
    var out = [];
    function add(u) {
      if (!u) return;
      u = String(u);
      if (out.indexOf(u) >= 0) return;
      out.push(u);
    }
    var f = forgedOf(itemId);

    // Own image only — never parent fillers (those caused Force load to show the wrong art).
    if (f) {
      if (f.imageUrl) {
        add(f.imageUrl);
        add(assetUrl(f.imageUrl));
      }
      if (f.thumb && !isParentPaintingUrl(f.thumb, f.parents)) {
        add(f.thumb);
        add(assetUrl(f.thumb));
      }
      if (thumbOverrides[String(itemId)]) add(thumbOverrides[String(itemId)]);
    } else {
      var ex = extraOf(itemId);
      if (ex && ex.url) {
        add(ex.url);
        add(assetUrl(ex.url));
      }
      if (itemId >= 1 && itemId <= PAINTING_TOTAL) {
        add(paintingPathFor(itemId));
        add(assetUrl(paintingPathFor(itemId)));
      }
      if (itemId >= GEN_BASE && itemId < SKETCH_BASE) {
        var g = itemId - GEN_BASE;
        add("/generated/" + g + ".jpg");
        add("generated/" + g + ".jpg");
        add(assetUrl("/generated/" + g + ".jpg"));
      }
      if (itemId >= SKETCH_BASE && itemId < INV_SKETCH_BASE) {
        var s = itemId - SKETCH_BASE;
        add("/sketches/" + s + ".jpg");
        add(assetUrl("/sketches/" + s + ".jpg"));
      }
      if (itemId >= INV_SKETCH_BASE && itemId < NOTE_BASE) {
        var invs = itemId - INV_SKETCH_BASE;
        add("/inverted/" + invs + ".jpg");
        add(assetUrl("/inverted/" + invs + ".jpg"));
      }
      if (thumbOverrides[String(itemId)]) add(thumbOverrides[String(itemId)]);
    }

    var busted = [];
    out.slice(0, 6).forEach(function (u) {
      if (u.indexOf("data:") === 0) return;
      var sep = u.indexOf("?") >= 0 ? "&" : "?";
      busted.push(u + sep + "geforce=" + Date.now());
    });
    return busted.concat(out);
  }

  function bindBagThumbErrors(wrap) {
    if (!wrap) return;
    var imgs = wrap.querySelectorAll("img");
    for (var i = 0; i < imgs.length; i++) {
      (function (img) {
        img.addEventListener("error", function () {
          img.classList.add("broken");
          img.title = "Broken thumb — right-click → Force load image";
        });
      })(imgs[i]);
    }
  }

  function applyThumbToDom(itemId, url) {
    itemId = Number(itemId);
    url = String(url || "");
    if (!url) return;
    var sel =
      '[data-ge-inv="' +
      itemId +
      '"] img, [data-ge-bank="' +
      itemId +
      '"] img, [data-forge-item="' +
      itemId +
      '"] img';
    try {
      document.querySelectorAll(sel).forEach(function (img) {
        img.classList.remove("broken");
        img.src = url;
      });
    } catch (e) {}
    if (lastForgeResult === itemId && $("ge-forge-result-img")) {
      $("ge-forge-result-img").src = url;
      $("ge-forge-result-img").classList.remove("broken");
    }
    var lb = $("ge-lightbox");
    if (lb && !lb.hidden && $("ge-lightbox-img") && !$("ge-lightbox-img").hidden) {
      $("ge-lightbox-img").src = url;
    }
    if ($("ge-setup-img") && Number(selected) === itemId) {
      $("ge-setup-img").src = url;
    }
  }

  function acceptForcedImage(itemId, dataUrl, src) {
    itemId = Number(itemId);
    thumbOverrides[String(itemId)] = dataUrl;
    var f = forgedOf(itemId);
    if (f) {
      // Keep the real forge URL — never write a parent painting path as imageUrl
      if (src && !isParentPaintingUrl(src, f.parents) && String(src).indexOf("data:") !== 0) {
        var persist = persistableThumbUrl(src, null);
        if (persist) {
          f.imageUrl = persist;
          f.thumb = persist;
        } else if (/^https:\/\//i.test(src)) {
          f.imageUrl = src;
          f.thumb = src;
        }
      }
      // data URL: keep in thumbOverrides for display; leave imageUrl if already set
    }
    applyThumbToDom(itemId, dataUrl);
    try {
      saveState();
    } catch (eSave) {}
    renderBags();
    renderForgeSlots();
    if (lastForgeResult === itemId) showForgeResult(itemId);
    return { ok: true, from: src };
  }

  function regenerateForgedImage(itemId) {
    var f = forgedOf(itemId);
    if (!f || !f.parents || f.parents.length < 3) {
      return Promise.resolve({
        ok: false,
        error: "No forge parents saved — cannot regenerate. Re-Combine from Spellforge slots.",
      });
    }
    setStatus("Regenerating forged image for #" + itemId + " (not a parent stand-in)…");
    setForgeStatus("Regenerating #" + itemId + "…");
    var prompt =
      typeof buildForgePromptForItem === "function"
        ? buildForgePromptForItem(itemId)
        : buildForgePrompt(f.parents.map(Number));
    return generateForgeImage(f.parents.map(Number), prompt).then(function (url) {
      f.pendingGenerate = false;
      if (pendingGenerateId === itemId) pendingGenerateId = null;
      if (state.descOverrides && state.descOverrides[String(itemId)] != null) {
        f.description = String(state.descOverrides[String(itemId)]);
      }
      if (!url) throw new Error("Generate returned no URL.");
      f.imageUrl = url;
      f.thumb = url;
      return geInlineImage(url).then(function (dataUrl) {
        if (dataUrl && String(dataUrl).indexOf("data:image") === 0) {
          return acceptForcedImage(itemId, dataUrl, url);
        }
        // Still apply remote URL even if inline failed
        thumbOverrides[String(itemId)] = assetUrl(url);
        applyThumbToDom(itemId, assetUrl(url));
        saveState();
        renderBags();
        renderForgeSlots();
        return { ok: true, from: url, regenerated: true };
      });
    });
  }

  function forceLoadItemImage(itemId) {
    itemId = Number(itemId);
    if (!itemId) return Promise.resolve({ ok: false, error: "No item." });
    if (noteOf(itemId)) {
      return Promise.resolve({ ok: false, error: "Notes are text — nothing to load." });
    }
    if (colorChipOf(itemId)) {
      return Promise.resolve({ ok: false, error: "Color chips are solid swatches — nothing to force-load." });
    }
    setStatus("Force loading correct image for " + kindLabel(itemId) + "…");
    setForgeStatus("Force loading #" + itemId + "…");
    var f = forgedOf(itemId);
    var candidates = rawThumbCandidates(itemId);

    function tryAt(i) {
      if (i >= candidates.length) {
        // Forged piece with no own URL left — regenerate the real image (do not use parent art)
        if (f) return regenerateForgedImage(itemId);
        return Promise.resolve({
          ok: false,
          error: "Could not load this item's own image.",
        });
      }
      var src = candidates[i];
      if (f && isParentPaintingUrl(src, f.parents)) {
        return tryAt(i + 1);
      }
      return geInlineImage(src)
        .then(function (dataUrl) {
          if (!dataUrl || String(dataUrl).indexOf("data:image") !== 0) {
            return tryAt(i + 1);
          }
          return new Promise(function (resolve) {
            var probe = new Image();
            probe.onload = function () {
              if (!probe.naturalWidth || probe.naturalWidth < 2 || probe.naturalHeight < 2) {
                tryAt(i + 1).then(resolve);
                return;
              }
              resolve(acceptForcedImage(itemId, dataUrl, src));
            };
            probe.onerror = function () {
              tryAt(i + 1).then(resolve);
            };
            probe.src = dataUrl;
          });
        })
        .catch(function () {
          return tryAt(i + 1);
        });
    }

    // If forged thumb is only a parent stand-in, skip straight to regenerate when no imageUrl
    var start =
      f && !f.imageUrl && (!f.thumb || isParentPaintingUrl(f.thumb, f.parents)) && !thumbOverrides[String(itemId)]
        ? regenerateForgedImage(itemId)
        : tryAt(0);

    return start
      .then(function (res) {
        if (res && res.ok) {
          var msg = res.regenerated
            ? "Regenerated correct image for #" + itemId + "."
            : "Force loaded correct image for " + kindLabel(itemId) + ".";
          setStatus(msg);
          setForgeStatus(msg);
        } else {
          setStatus((res && res.error) || "Force load failed.", true);
          setForgeStatus((res && res.error) || "Force load failed.", true);
        }
        return res;
      })
      .catch(function (err) {
        var msg = (err && err.message) || String(err || "Force load failed");
        setStatus(msg, true);
        setForgeStatus(msg, true);
        return { ok: false, error: msg };
      });
  }

  function titleFor(n) {
    n = Number(n);
    var chip = colorChipOf(n);
    if (chip) return colorChipLabel(chip.name, chip.hex);
    var note = noteOf(n);
    if (note) return noteTitleOf(note);
    var f = forgedOf(n);
    if (f && f.title) return f.title;
    var ex = extraOf(n);
    if (ex) {
      if (ex.analysis && ex.analysis.title) return ex.analysis.title;
      if (ex.title) return ex.title;
      return kindLabel(n);
    }
    var a = analyses[String(n)];
    if (a && a.title) return a.title;
    return "Painting #" + n;
  }

  function originalDescFor(n) {
    n = Number(n);
    var note = noteOf(n);
    if (note) {
      if (isLedgerNote(note)) {
        if (note._originalDescription != null) return String(note._originalDescription);
        if (note.description != null) return String(note.description);
      }
      return notePromptOf(note);
    }
    var f = forgedOf(n);
    if (f) {
      if (f._originalDescription != null) return String(f._originalDescription);
      if (f.description) return String(f.description);
    }
    var ex = extraOf(n);
    if (ex && ex.analysis && ex.analysis.description) return String(ex.analysis.description);
    var a = analyses[String(n)];
    if (a && a.description) return String(a.description);
    if (ex) return "A " + kindLabel(n) + " from the Spellforge arsenal.";
    return "A painting from the 1000 Paintings Challenge.";
  }

  function fullDescFor(n) {
    n = Number(n);
    var chip = colorChipOf(n);
    if (chip) {
      return (
        "MANDATORY BOLD COLOR LOCK — use pigment " +
        colorChipLabel(chip.name, chip.hex) +
        " exactly. Repaint conflicting source colors into this lock."
      );
    }
    if (state && state.descOverrides && state.descOverrides[String(n)] != null) {
      return String(state.descOverrides[String(n)] || "");
    }
    var note = noteOf(n);
    if (note) {
      if (isLedgerNote(note) && note.description != null) return String(note.description);
      return notePromptOf(note);
    }
    var f = forgedOf(n);
    if (f && f.description) return String(f.description);
    var ex = extraOf(n);
    if (ex && ex.analysis && ex.analysis.description) return String(ex.analysis.description);
    var a = analyses[String(n)];
    if (a && a.description) return String(a.description);
    if (ex) return "A " + kindLabel(n) + " from the Spellforge arsenal.";
    return "A painting from the 1000 Paintings Challenge.";
  }

  function descFor(n) {
    return String(fullDescFor(n)).slice(0, 90);
  }

  function autoGuide(n) {
    n = Number(n) || 1;
    var x = (n * 9301 + 49297) % 233280;
    var jitter = (x / 233280) * 0.5 - 0.15;
    var g = GUIDE_BASE * (1 + jitter);
    if (colorChipOf(n)) g *= 0.4;
    else if (noteOf(n)) g *= 0.55;
    else if (forgedOf(n)) g *= 1.45;
    else {
      var ex = extraOf(n);
      if (ex) {
        if (ex.source === "phone-upload") g *= 1.22;
        else if (ex.source === "sketch" || ex.source === "sketch-inverted") g *= 1.12;
        else g *= 1.18;
      } else {
        if (n % 100 === 0) g *= 1.35;
        else if (n % 50 === 0) g *= 1.18;
        else if (n % 10 === 0) g *= 1.08;
      }
    }
    var mult = Number(state && state.guideMult) || 1;
    return Math.max(1, Math.round(g * mult));
  }

  function guidePrice(n) {
    n = Number(n);
    if (state && state.guideOverrides && state.guideOverrides[String(n)] != null) {
      return Math.max(1, Math.round(Number(state.guideOverrides[String(n)]) || 1));
    }
    var f = forgedOf(n);
    if (f && f.guide != null) return Math.max(1, Math.round(Number(f.guide) || 1));
    return autoGuide(n);
  }


  function slimPriceHistory() {
    var out = {};
    var tracked = Array.isArray(state.trackedItems) ? state.trackedItems : [];
    var src = state.priceHistory || {};
    for (var i = 0; i < tracked.length; i++) {
      var k = String(tracked[i]);
      var arr = Array.isArray(src[k]) ? src[k] : [];
      out[k] = arr.slice(-TRACK_HISTORY_MAX).map(function (p) {
        return {
          t: Number(p && p.t) || 0,
          g: Math.max(1, Math.round(Number(p && p.g) || 1)),
          m: Math.max(1, Math.round(Number(p && p.m) || Number(p && p.g) || 1)),
          b: Math.max(0, Math.round(Number(p && p.b) || 0)),
          s: Math.max(0, Math.round(Number(p && p.s) || 0)),
        };
      });
    }
    return out;
  }

  function bestBookBuy(itemId) {
    itemId = Number(itemId);
    var best = 0;
    activeOffers().forEach(function (o) {
      if (!o || o.side !== "buy" || o.complete) return;
      if (Number(o.itemId) !== itemId) return;
      if ((Number(o.qtyLeft) || 0) <= 0) return;
      var px = Number(o.price) || 0;
      if (px > best) best = px;
    });
    return best;
  }

  function bestBookSell(itemId) {
    itemId = Number(itemId);
    var best = 0;
    activeOffers().forEach(function (o) {
      if (!o || o.side !== "sell" || o.complete) return;
      if (Number(o.itemId) !== itemId) return;
      if ((Number(o.qtyLeft) || 0) <= 0) return;
      var px = Number(o.price) || 0;
      if (!best || px < best) best = px;
    });
    return best;
  }

  function midMarketPrice(itemId) {
    var buy = bestBookBuy(itemId);
    var sell = bestBookSell(itemId);
    if (buy && sell) return Math.max(1, Math.round((buy + sell) / 2));
    if (buy) return buy;
    if (sell) return sell;
    return guidePrice(itemId);
  }

  function isTracked(itemId) {
    itemId = Number(itemId);
    if (!state || !Array.isArray(state.trackedItems)) return false;
    return state.trackedItems.indexOf(itemId) >= 0;
  }

  function trackItem(itemId) {
    itemId = Number(itemId);
    if (!itemId) return { ok: false, error: "No item." };
    if (!state.trackedItems) state.trackedItems = [];
    if (isTracked(itemId)) return { ok: true, already: true };
    if (state.trackedItems.length >= MAX_TRACKED) {
      return { ok: false, error: "Market Tracker is full (" + MAX_TRACKED + ")." };
    }
    state.trackedItems.push(itemId);
    snapshotOneTracked(itemId);
    saveState();
    return { ok: true };
  }

  function untrackItem(itemId) {
    itemId = Number(itemId);
    if (!state.trackedItems) state.trackedItems = [];
    state.trackedItems = state.trackedItems.filter(function (n) {
      return Number(n) !== itemId;
    });
    if (state.priceHistory && state.priceHistory[String(itemId)]) {
      delete state.priceHistory[String(itemId)];
    }
    saveState();
    return { ok: true };
  }

  function toggleTrackItem(itemId) {
    if (isTracked(itemId)) return untrackItem(itemId);
    return trackItem(itemId);
  }

  function snapshotOneTracked(itemId) {
    itemId = Number(itemId);
    if (!itemId || !state) return;
    if (!state.priceHistory) state.priceHistory = {};
    var k = String(itemId);
    var arr = Array.isArray(state.priceHistory[k]) ? state.priceHistory[k] : [];
    var g = guidePrice(itemId);
    var b = bestBookBuy(itemId);
    var s = bestBookSell(itemId);
    var m = midMarketPrice(itemId);
    var last = arr.length ? arr[arr.length - 1] : null;
    // Skip duplicate ticks with identical book/guide
    if (
      last &&
      Number(last.g) === g &&
      Number(last.m) === m &&
      Number(last.b) === b &&
      Number(last.s) === s &&
      Date.now() - (Number(last.t) || 0) < 2500
    ) {
      return;
    }
    arr.push({ t: Date.now(), g: g, m: m, b: b, s: s });
    if (arr.length > TRACK_HISTORY_MAX) arr = arr.slice(-TRACK_HISTORY_MAX);
    state.priceHistory[k] = arr;
  }

  function snapshotTrackedPrices() {
    if (!state || !Array.isArray(state.trackedItems) || !state.trackedItems.length) return;
    state.trackedItems.forEach(function (id) {
      snapshotOneTracked(id);
    });
  }

  function sparklineSvg(points) {
    var vals = (points || [])
      .map(function (p) {
        return Number(p && (p.m != null ? p.m : p.g)) || 0;
      })
      .filter(function (n) {
        return n > 0;
      });
    if (vals.length < 2) {
      return (
        '<svg class="ge-tracker-spark" viewBox="0 0 72 28" aria-hidden="true">' +
        '<line x1="4" y1="14" x2="68" y2="14" stroke="#5a6f84" stroke-width="1"/>' +
        "</svg>"
      );
    }
    var min = Math.min.apply(null, vals);
    var max = Math.max.apply(null, vals);
    var span = Math.max(1, max - min);
    var w = 72;
    var h = 28;
    var pad = 3;
    var coords = vals
      .map(function (v, i) {
        var x = pad + (i / (vals.length - 1)) * (w - pad * 2);
        var y = h - pad - ((v - min) / span) * (h - pad * 2);
        return x.toFixed(1) + "," + y.toFixed(1);
      })
      .join(" ");
    var up = vals[vals.length - 1] >= vals[0];
    var stroke = up ? "#6ecf8e" : "#e07070";
    return (
      '<svg class="ge-tracker-spark" viewBox="0 0 72 28" aria-hidden="true">' +
      '<polyline fill="none" stroke="' +
      stroke +
      '" stroke-width="1.6" points="' +
      coords +
      '"/>' +
      "</svg>"
    );
  }

  function itemStats(n) {
    n = String(n);
    if (!state.itemStats) state.itemStats = {};
    if (!state.itemStats[n]) {
      state.itemStats[n] = { trades: 0, qty: 0, volume: 0, lastPrice: 0, lastAt: 0 };
    }
    return state.itemStats[n];
  }

  function recordTrade(h) {
    var st = itemStats(h.itemId);
    st.trades += 1;
    st.qty += Number(h.qty) || 0;
    st.volume += Number(h.total) || 0;
    st.lastPrice = Number(h.price) || 0;
    st.lastAt = h.at || Date.now();
  }

  function defaultState() {
    return {
      version: 6,
      cashDelta: {},
      inventory: {},
      bank: {},
      offers: [],
      history: [],
      guideOverrides: {},
      guideMult: 1,
      itemStats: {},
      forged: {},
      notes: {},
      descOverrides: {},
      colorChips: {},
      nextForgeId: 10001,
      nextNoteId: NOTE_BASE + 1,
      nextColorId: COLOR_BASE + 1,
      _colorChipCatalogReady: false,
      _colorChipsSeeded: false,
      npcSeededOffers: false,
      _npcSeeded: false,
      packReady: true, // do not auto-fill inventory with gallery art
      clearedAutoSeed: true, // never wipe a real pack again
      _starterCash: false,
      level: 1,
      xp: 0,
      walkXpThisLevel: 0,
      trackedItems: [],
      priceHistory: {},
      autoForge: false,
      recentForgeTopics: [],
      createdAt: Date.now(),
    };
  }

  function looksLikeAutoSeedPack(inv) {
    if (!inv || typeof inv !== "object") return false;
    var keys = Object.keys(inv);
    if (keys.length < 20 || keys.length > 28) return false;
    for (var i = 0; i < keys.length; i++) {
      var n = Number(keys[i]);
      var q = Number(inv[keys[i]]) || 0;
      if (!(n >= 1 && n <= 28) || q !== 1) return false;
    }
    return true;
  }

  function migrate(s) {
    if (!s || typeof s !== "object") return defaultState();
    s.version = Math.max(6, Number(s.version) || 6);
    s.cashDelta = s.cashDelta || {};
    s.inventory = s.inventory || {};
    s.bank = s.bank || {};
    // Drop NPC packs from older saves (they filled localStorage).
    (function stripNpcBags() {
      var pid = String(100);
      var invKeep = {};
      if (s.inventory[pid]) invKeep[pid] = s.inventory[pid];
      s.inventory = invKeep;
      var bankKeep = {};
      if (s.bank[pid]) bankKeep[pid] = s.bank[pid];
      s.bank = bankKeep;
      var cashKeep = {};
      if (s.cashDelta[pid] != null) cashKeep[pid] = s.cashDelta[pid];
      s.cashDelta = cashKeep;
      s._npcSeeded = false;
    })();
    s.offers = Array.isArray(s.offers) ? s.offers : [];
    s.history = Array.isArray(s.history) ? s.history : [];
    s.guideOverrides = s.guideOverrides || {};
    s.guideMult = Number(s.guideMult) || 1;
    s.itemStats = s.itemStats || {};
    s.forged = s.forged || {};
    s.notes = normalizeAllNotes(s.notes || {});
    s.descOverrides = s.descOverrides || {};
    s.colorChips = s.colorChips || {};
    s.nextColorId = Math.max(COLOR_BASE + 1, Number(s.nextColorId) || COLOR_BASE + 1);
    s._colorChipCatalogReady = !!s._colorChipCatalogReady;
    s._colorChipsSeeded = !!s._colorChipsSeeded;
    s.nextForgeId = Math.max(10001, Number(s.nextForgeId) || 10001);
    s.nextNoteId = Math.max(NOTE_BASE + 1, Number(s.nextNoteId) || NOTE_BASE + 1);
    s.level = Math.max(1, Number(s.level) || 1);
    s.xp = Math.max(0, Number(s.xp) || 0);
    s.walkXpThisLevel = Math.max(0, Number(s.walkXpThisLevel) || 0);
    s.trackedItems = Array.isArray(s.trackedItems)
      ? s.trackedItems
          .map(function (n) {
            return Number(n);
          })
          .filter(function (n) {
            return n > 0;
          })
          .slice(0, MAX_TRACKED)
      : [];
    s.priceHistory = s.priceHistory && typeof s.priceHistory === "object" ? s.priceHistory : {};
    s.autoForge = !!s.autoForge;
    s.recentForgeTopics = Array.isArray(s.recentForgeTopics)
      ? s.recentForgeTopics
          .map(function (t) {
            return String(t || "")
              .toLowerCase()
              .trim()
              .slice(0, 48);
          })
          .filter(Boolean)
          .slice(-AUTO_FORGE_TOPIC_MEMORY)
      : [];
    s.packReady = true;
    if (!Object.keys(s.itemStats).length && s.history.length) {
      s.itemStats = {};
      s.history.forEach(function (h) {
        var k = String(h.itemId);
        var st = s.itemStats[k] || { trades: 0, qty: 0, volume: 0, lastPrice: 0, lastAt: 0 };
        st.trades += 1;
        st.qty += Number(h.qty) || 0;
        st.volume += Number(h.total) || 0;
        st.lastPrice = Number(h.price) || 0;
        st.lastAt = h.at || 0;
        s.itemStats[k] = st;
      });
    }
    // One-time only: strip the ancient auto-seed pack (#1–28). Never touch bank or XP.
    // Never wipe a real pack just because packReady was missing.
    if (!s.clearedAutoSeed) {
      var pid = String(100);
      if (looksLikeAutoSeedPack(s.inventory[pid])) {
        s.inventory[pid] = {};
      }
      s.clearedAutoSeed = true;
    }
    return s;
  }

  function scrubLegacyStorage() {
    try {
      var drop = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (!k) continue;
        if (k === STORAGE) continue;
        if (k.indexOf("gallery.grand-exchange") === 0 || k.indexOf("gallery.ge") === 0) {
          drop.push(k);
        }
      }
      drop.forEach(function (k) {
        try {
          localStorage.removeItem(k);
        } catch (e2) {}
      });
    } catch (e) {}
  }

  function loadState() {
    try {
      scrubLegacyStorage();
      var raw = localStorage.getItem(STORAGE);
      var fromLegacy = false;
      if (!raw) {
        for (var i = 0; i < STORAGE_LEGACY_KEYS.length; i++) {
          raw = localStorage.getItem(STORAGE_LEGACY_KEYS[i]);
          if (raw) {
            fromLegacy = true;
            break;
          }
        }
      }
      if (!raw) return defaultState();
      var parsed = JSON.parse(raw);
      var migrated = migrate(parsed);
      // Stub written when only IndexedDB held the full save.
      if (parsed && parsed._idbOnly) {
        migrated._needsIdbHydrate = true;
        return migrated;
      }
      // Rewrite a slim player-only save so NPC packs never stay on disk.
      try {
        state = migrated;
        npcRuntime = { inventory: {}, bank: {} };
        var slim = slimForPersist();
        var payload = Object.assign({}, slim);
        delete payload._persistMeta;
        localStorage.setItem(STORAGE, JSON.stringify(payload));
        idbPutGeSave(payload).catch(function () {});
        if (fromLegacy) scrubLegacyStorage();
        state = null;
        return migrate(payload);
      } catch (eSave) {
        state = null;
        migrated._needsIdbHydrate = true;
        // Fall back to in-memory migrated (still stripped of NPC bags)
        return migrated;
      }
    } catch (e) {
      return defaultState();
    }
  }

  function geSaveRicherScore(s) {
    if (!s || typeof s !== "object") return 0;
    var notes = s.notes ? Object.keys(s.notes).length : 0;
    var forged = s.forged ? Object.keys(s.forged).length : 0;
    var bank = 0;
    try {
      bank = Object.keys((s.bank && s.bank[String(PLAYER_ID)]) || {}).length;
    } catch (e) {}
    return (
      notes * 1000 +
      forged * 100 +
      bank * 10 +
      (Number(s.nextNoteId) || 0) +
      (Number(s.nextForgeId) || 0) +
      (Number(s.xp) || 0)
    );
  }

  /** Async: pull fuller save from IndexedDB when LS was stubby/failed. */
  function hydrateGeFromIdb() {
    return idbGetGeSave().then(function (row) {
      if (!row || !row.payload || typeof row.payload !== "object") return false;
      var incoming = migrate(row.payload);
      var curScore = geSaveRicherScore(state);
      var inScore = geSaveRicherScore(incoming);
      if (!(state && state._needsIdbHydrate) && inScore <= curScore) return false;
      state = incoming;
      delete state._needsIdbHydrate;
      npcRuntime = { inventory: {}, bank: {} };
      recentForgeTopics = Array.isArray(state.recentForgeTopics)
        ? state.recentForgeTopics.slice()
        : [];
      try {
        var slim = slimForPersist();
        var payload = Object.assign({}, slim);
        delete payload._persistMeta;
        applySlimLiveBags(slim);
        try {
          localStorage.setItem(STORAGE, JSON.stringify(payload));
        } catch (eLs) {
          // Keep IDB as source of truth when LS still full.
        }
      } catch (eSlim) {}
      return true;
    });
  }

  function enforcePlayerInvCap() {
    var pid = String(PLAYER_ID);
    var inv = (state.inventory && state.inventory[pid]) || {};
    var keys = Object.keys(inv).filter(function (k) {
      return (Number(inv[k]) || 0) > 0;
    });
    if (keys.length <= INV_SLOTS) return 0;
    // Move overflow kinds to bank (keep lowest ids in pack)
    keys.sort(function (a, b) {
      return Number(a) - Number(b);
    });
    var moved = 0;
    for (var i = INV_SLOTS; i < keys.length; i++) {
      var k = keys[i];
      var q = Number(inv[k]) || 0;
      if (q > 0) {
        addBank(PLAYER_ID, Number(k), q);
        delete inv[k];
        moved++;
      }
    }
    return moved;
  }

  function openGeIdb() {
    return new Promise(function (resolve, reject) {
      if (typeof indexedDB === "undefined" || !indexedDB) {
        reject(new Error("IndexedDB unavailable"));
        return;
      }
      var req = indexedDB.open(GE_IDB_NAME, 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(GE_IDB_STORE)) {
          db.createObjectStore(GE_IDB_STORE);
        }
      };
      req.onsuccess = function () {
        resolve(req.result);
      };
      req.onerror = function () {
        reject(req.error || new Error("Could not open GE IDB"));
      };
    });
  }

  function idbPutGeSave(payload) {
    return openGeIdb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(GE_IDB_STORE, "readwrite");
        tx.oncomplete = function () {
          resolve(true);
        };
        tx.onerror = function () {
          reject(tx.error || new Error("IDB write failed"));
        };
        tx.objectStore(GE_IDB_STORE).put(
          { savedAt: Date.now(), payload: payload },
          GE_IDB_KEY
        );
      });
    });
  }

  function idbGetGeSave() {
    return openGeIdb()
      .then(function (db) {
        return new Promise(function (resolve, reject) {
          var tx = db.transaction(GE_IDB_STORE, "readonly");
          var req = tx.objectStore(GE_IDB_STORE).get(GE_IDB_KEY);
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

  function persistByteLength(obj) {
    try {
      return JSON.stringify(obj).length;
    } catch (e) {
      return 0;
    }
  }

  function formatPersistKb(n) {
    return (Math.round((Number(n) || 0) / 102.4) / 10).toFixed(1) + "KB";
  }

  function ownedItemIdSet() {
    var set = Object.create(null);
    var pid = String(PLAYER_ID);
    var inv = (state.inventory && state.inventory[pid]) || {};
    var bank = (state.bank && state.bank[pid]) || {};
    Object.keys(inv).forEach(function (k) {
      if ((Number(inv[k]) || 0) > 0) set[k] = true;
    });
    Object.keys(bank).forEach(function (k) {
      if ((Number(bank[k]) || 0) > 0) set[k] = true;
    });
    (state.offers || []).forEach(function (o) {
      if (o && o.isPlayer && o.itemId != null) set[String(o.itemId)] = true;
    });
    (state.trackedItems || []).forEach(function (n) {
      if (n) set[String(n)] = true;
    });
    return set;
  }

  function pruneBankForPersist(bankMap, maxKinds) {
    var keys = Object.keys(bankMap || {}).filter(function (k) {
      return (Number(bankMap[k]) || 0) > 0;
    });
    if (keys.length <= maxKinds) return { bank: Object.assign({}, bankMap || {}), dropped: [] };
    // Keep paintings/extras first; drop oldest ledger/forged stacks when over cap.
    var keepers = [];
    var dropCandidates = [];
    keys.forEach(function (k) {
      var n = Number(k);
      var isLed = n >= NOTE_BASE && n < COLOR_BASE;
      var isForged = n >= 10001 && n < GEN_BASE;
      if (isLed || isForged) dropCandidates.push(k);
      else keepers.push(k);
    });
    dropCandidates.sort(function (a, b) {
      return Number(a) - Number(b); // oldest ids first
    });
    var room = Math.max(0, maxKinds - keepers.length);
    var keepDrop = dropCandidates.slice(-room);
    var dropped = dropCandidates.slice(0, Math.max(0, dropCandidates.length - room));
    var out = {};
    keepers.concat(keepDrop).forEach(function (k) {
      out[k] = bankMap[k];
    });
    return { bank: out, dropped: dropped };
  }

  function pickNewestKeys(keys, max, metaFn) {
    var arr = keys.slice();
    arr.sort(function (a, b) {
      var ma = metaFn(a) || 0;
      var mb = metaFn(b) || 0;
      if (ma !== mb) return mb - ma;
      return Number(b) - Number(a);
    });
    return arr.slice(0, max);
  }

  function slimForPersist(opts) {
    opts = opts || {};
    var aggressive = !!opts.aggressive;
    var noteTextMax = aggressive ? 700 : PERSIST_NOTE_TEXT_MAX;
    var noteDescMax = aggressive ? 400 : PERSIST_NOTE_DESC_MAX;
    var forgedDescMax = aggressive ? 280 : PERSIST_FORGED_DESC_MAX;
    var maxNotes = aggressive ? 60 : PERSIST_MAX_NOTES;
    var maxForged = aggressive ? 40 : PERSIST_MAX_FORGED;
    var maxDesc = aggressive ? 20 : PERSIST_MAX_DESC_OVERRIDES;
    var maxBank = aggressive ? 200 : PERSIST_MAX_BANK_KINDS;
    var stripForgedThumbs = !!opts.stripForgedThumbs || aggressive;

    var pid = String(PLAYER_ID);
    enforcePlayerInvCap();
    var inv = {};
    inv[pid] = Object.assign({}, (state.inventory && state.inventory[pid]) || {});
    var bankSrc = Object.assign({}, (state.bank && state.bank[pid]) || {});
    var bankPrune = pruneBankForPersist(bankSrc, maxBank);
    var bank = {};
    bank[pid] = bankPrune.bank;
    var cash = {};
    if (state.cashDelta && state.cashDelta[pid] != null) cash[pid] = state.cashDelta[pid];

    var owned = ownedItemIdSet();
    // Bank prune may drop ids — reflect that in owned for meta keep.
    Object.keys(bank[pid]).forEach(function (k) {
      owned[k] = true;
    });
    Object.keys(inv[pid]).forEach(function (k) {
      owned[k] = true;
    });

    var forged = {};
    var forgedKeys = Object.keys(state.forged || {});
    var forgedKeep = pickNewestKeys(
      forgedKeys.filter(function (k) {
        return owned[k] || true;
      }),
      maxForged,
      function (k) {
        var f = state.forged[k];
        return (f && (f.createdAt || f.id)) || Number(k) || 0;
      }
    );
    // Prefer owned forged when over cap
    forgedKeep = pickNewestKeys(
      forgedKeys,
      maxForged,
      function (k) {
        var f = state.forged[k];
        var base = (f && (f.createdAt || f.id)) || Number(k) || 0;
        return base + (owned[k] ? 1e15 : 0);
      }
    );
    forgedKeep.forEach(function (k) {
      var f = state.forged[k];
      if (!f || typeof f !== "object") return;
      var imageUrl = stripForgedThumbs ? "" : persistableThumbUrl(f.imageUrl || "", null);
      var thumbRaw = f.thumb || "";
      var thumb = stripForgedThumbs ? "" : persistableThumbUrl(thumbRaw, null);
      if (thumb && isParentPaintingUrl(thumb, f.parents)) thumb = imageUrl || "";
      if (!thumb && imageUrl) thumb = imageUrl;
      forged[k] = {
        id: f.id,
        parents: Array.isArray(f.parents) ? f.parents.slice(0, 3) : [],
        title: String(f.title || "").slice(0, 120),
        description: String(f.description || "").slice(0, forgedDescMax),
        imageUrl: imageUrl || "",
        thumb: thumb || "",
        guide: f.guide,
        createdAt: f.createdAt,
        pendingGenerate: !!f.pendingGenerate && !imageUrl,
      };
    });

    var notes = {};
    var noteKeys = Object.keys(state.notes || {});
    var noteKeep = pickNewestKeys(noteKeys, maxNotes, function (k) {
      var n = state.notes[k];
      var base = (n && (n.createdAt || n.id)) || Number(k) || 0;
      return base + (owned[k] ? 1e15 : 0);
    });
    noteKeep.forEach(function (k) {
      var n = normalizeNoteEntry(state.notes[k], Number(k));
      if (!n) return;
      var text = String(n.text || "").slice(0, noteTextMax);
      var packed = {
        id: n.id != null ? n.id : Number(k),
        title: String(n.title || "Note").slice(0, 80),
        text: text,
        createdAt: n.createdAt,
      };
      if (isLedgerNote(n)) {
        packed.kind = "ledger";
        packed.isLedger = true;
        packed.pendingGenerate = n.pendingGenerate !== false;
        var desc = String(n.description != null ? n.description : n.text || "").slice(0, noteDescMax);
        if (desc && desc !== text) packed.description = desc;
        packed.parents = Array.isArray(n.parents) ? n.parents.map(Number).slice(0, 3) : [];
        if (n.guide != null) packed.guide = Math.max(1, Math.round(Number(n.guide) || 1));
      }
      notes[String(n.id != null ? n.id : k)] = packed;
    });

    // Drop bank ledger/forged stacks we are not persisting meta for (no empty shells on reload).
    Object.keys(bank[pid]).forEach(function (k) {
      if (inv[pid][k]) return; // never drop something still in the pack
      var n = Number(k);
      if (n >= NOTE_BASE && n < COLOR_BASE && !notes[k]) {
        delete bank[pid][k];
        bankPrune.dropped.push(k);
      } else if (n >= 10001 && n < GEN_BASE && !forged[k]) {
        delete bank[pid][k];
        bankPrune.dropped.push(k);
      }
    });

    var descOverridesSlim = {};
    var descKeys = Object.keys(state.descOverrides || {});
    pickNewestKeys(descKeys, maxDesc, function (k) {
      return (owned[k] ? 1e15 : 0) + Number(k);
    }).forEach(function (k) {
      var v = state.descOverrides[k];
      if (v == null) return;
      descOverridesSlim[k] = String(v).slice(0, aggressive ? 900 : PERSIST_DESC_OVERRIDE_MAX);
    });

    var colorChips = {};
    var chipKeys = Object.keys(state.colorChips || {});
    pickNewestKeys(chipKeys, PERSIST_MAX_COLOR_CHIPS, function (k) {
      var c = state.colorChips[k];
      return (owned[k] ? 1e15 : 0) + ((c && c.createdAt) || Number(k) || 0);
    }).forEach(function (k) {
      var c = state.colorChips[k];
      if (!c) return;
      colorChips[k] = {
        id: c.id,
        name: String(c.name || "").slice(0, 40),
        hex: normalizeGeHex(c.hex) || "#888888",
        createdAt: c.createdAt,
      };
    });

    var guideOverridesSlim = {};
    var gKeys = Object.keys(state.guideOverrides || {});
    pickNewestKeys(gKeys, PERSIST_MAX_GUIDE_OVERRIDES, function (k) {
      return (owned[k] ? 1e15 : 0) + Number(k);
    }).forEach(function (k) {
      var v = Number(state.guideOverrides[k]);
      if (!(v > 0)) return;
      guideOverridesSlim[k] = Math.max(1, Math.round(v));
    });

    var itemStatsSlim = {};
    var statKeys = Object.keys(state.itemStats || {});
    pickNewestKeys(statKeys, PERSIST_MAX_ITEM_STATS, function (k) {
      var st = state.itemStats[k] || {};
      return (Number(st.lastAt) || 0) + (Number(st.volume) || 0);
    }).forEach(function (k) {
      itemStatsSlim[k] = state.itemStats[k];
    });

    // Keep player offers + a small NPC book sample so the market isn't empty on reload
    var offers = (state.offers || [])
      .filter(function (o) {
        return o && !o.cancelled;
      })
      .slice(0, aggressive ? 24 : 60);

    return {
      version: Math.max(6, Number(state.version) || 6),
      cashDelta: cash,
      inventory: inv,
      bank: bank,
      offers: offers,
      history: Array.isArray(state.history) ? state.history.slice(0, aggressive ? 10 : 50) : [],
      guideOverrides: guideOverridesSlim,
      guideMult: Number(state.guideMult) || 1,
      itemStats: itemStatsSlim,
      forged: forged,
      notes: notes,
      descOverrides: descOverridesSlim,
      colorChips: colorChips,
      nextForgeId: state.nextForgeId,
      nextNoteId: state.nextNoteId,
      nextColorId: state.nextColorId || COLOR_BASE + 1,
      _colorChipCatalogReady: !!state._colorChipCatalogReady,
      _colorChipsSeeded: !!state._colorChipsSeeded,
      npcSeededOffers: !!state.npcSeededOffers,
      // Force NPC packs to reseed in memory each session (not persisted)
      _npcSeeded: false,
      packReady: true,
      clearedAutoSeed: true,
      _starterCash: !!state._starterCash,
      level: Math.max(1, Number(state.level) || 1),
      xp: Math.max(0, Number(state.xp) || 0),
      walkXpThisLevel: Math.max(0, Number(state.walkXpThisLevel) || 0),
      trackedItems: Array.isArray(state.trackedItems)
        ? state.trackedItems
            .map(function (n) {
              return Number(n);
            })
            .filter(function (n) {
              return n > 0;
            })
            .slice(0, MAX_TRACKED)
        : [],
      priceHistory: slimPriceHistory(),
      autoForge: !!state.autoForge,
      recentForgeTopics: Array.isArray(state.recentForgeTopics)
        ? state.recentForgeTopics
            .map(function (t) {
              return String(t || "")
                .toLowerCase()
                .trim()
                .slice(0, 48);
            })
            .filter(Boolean)
            .slice(-AUTO_FORGE_TOPIC_MEMORY)
        : [],
      createdAt: state.createdAt || Date.now(),
      _persistMeta: {
        bankDropped: bankPrune.dropped.length,
        noteCount: Object.keys(notes).length,
        forgedCount: Object.keys(forged).length,
        aggressive: aggressive,
      },
    };
  }

  function applySlimLiveBags(slim) {
    // Keep live bags/level aligned — but do NOT replace forged thumbs in memory
    // (slim drops data: and oversize URLs; wiping them here made forge images vanish).
    state.inventory = slim.inventory;
    state.bank = slim.bank;
    state.cashDelta = Object.assign({}, state.cashDelta || {}, slim.cashDelta);
    state.history = slim.history;
    state.level = slim.level;
    state.xp = slim.xp;
    state.trackedItems = slim.trackedItems || [];
    state.priceHistory = slim.priceHistory || {};
    state.recentForgeTopics = slim.recentForgeTopics || [];
    recentForgeTopics = state.recentForgeTopics.slice();
  }

  function tryLocalStorageSet(key, valueStr) {
    localStorage.setItem(key, valueStr);
  }

  function scrubSpellforgeNotesQuota() {
    try {
      var raw = localStorage.getItem("spellforge_notes_v1");
      if (!raw || raw.length < PERSIST_LS_SOFT_BYTES / 2) return;
      var store = JSON.parse(raw);
      if (!store || !store.notes) return;
      var ids = Object.keys(store.notes).sort(function (a, b) {
        return Number(a) - Number(b);
      });
      var keep = Math.min(PERSIST_MAX_NOTES, 40);
      while (ids.length > keep) {
        delete store.notes[ids.shift()];
      }
      localStorage.setItem("spellforge_notes_v1", JSON.stringify(store));
    } catch (e) {
      try {
        localStorage.removeItem("spellforge_notes_v1");
      } catch (e2) {}
    }
  }

  function saveState() {
    if (!state) return false;
    var lastBytes = 0;
    var lastMeta = null;
    function attempt(opts, afterCleanupMsg) {
      var slim = slimForPersist(opts);
      lastMeta = slim._persistMeta || null;
      var payload = Object.assign({}, slim);
      delete payload._persistMeta;
      var raw = JSON.stringify(payload);
      lastBytes = raw.length;
      tryLocalStorageSet(STORAGE, raw);
      applySlimLiveBags(slim);
      // Best-effort mirror to IndexedDB (large-blob safe).
      idbPutGeSave(payload).catch(function () {});
      if (afterCleanupMsg) setStatus(afterCleanupMsg, false);
      else if (lastBytes >= PERSIST_LS_SOFT_BYTES) {
        if (!saveState._lastQuotaWarnAt || Date.now() - saveState._lastQuotaWarnAt > 45000) {
          saveState._lastQuotaWarnAt = Date.now();
          setStatus(
            "GE save OK but storage is getting full (" +
              formatPersistKb(lastBytes) +
              " · " +
              ((lastMeta && lastMeta.noteCount) || "?") +
              " notes). Oldest bank ledgers may prune on cleanup.",
            false
          );
        }
      }
      return true;
    }

    try {
      return attempt({});
    } catch (e) {
      // Tier 1: drop market fluff
      try {
        scrubLegacyStorage();
        scrubSpellforgeNotesQuota();
        var emergency = slimForPersist({});
        emergency.history = [];
        emergency.offers = (emergency.offers || []).filter(function (o) {
          return o && o.isPlayer;
        });
        emergency.itemStats = {};
        emergency.priceHistory = {};
        var rawE = JSON.stringify(emergency);
        lastBytes = rawE.length;
        tryLocalStorageSet(STORAGE, rawE);
        applySlimLiveBags(emergency);
        state.itemStats = {};
        idbPutGeSave(emergency).catch(function () {});
        setStatus("Saved pack/bank/level (cleared market history to free storage).", false);
        return true;
      } catch (e2) {
        // Tier 2: aggressive note/forged/bank prune + strip thumbs
        try {
          scrubSpellforgeNotesQuota();
          var hard = slimForPersist({ aggressive: true, stripForgedThumbs: true });
          hard.history = [];
          hard.offers = (hard.offers || []).filter(function (o) {
            return o && o.isPlayer;
          });
          hard.itemStats = {};
          hard.priceHistory = {};
          hard.descOverrides = {};
          var dropped = (hard._persistMeta && hard._persistMeta.bankDropped) || 0;
          var payloadH = Object.assign({}, hard);
          delete payloadH._persistMeta;
          var rawH = JSON.stringify(payloadH);
          lastBytes = rawH.length;
          tryLocalStorageSet(STORAGE, rawH);
          applySlimLiveBags(hard);
          // Also prune live note bag for dropped bank ledgers we no longer persist
          idbPutGeSave(payloadH).catch(function () {});
          setStatus(
            "Saved after storage cleanup" +
              (dropped ? " (pruned " + dropped + " oldest bank ledger/forged stacks)" : "") +
              " · " +
              formatPersistKb(lastBytes) +
              ".",
            false
          );
          return true;
        } catch (e3) {
          // Tier 3: IndexedDB only
          try {
            var idbSlim = slimForPersist({ aggressive: true, stripForgedThumbs: true });
            idbSlim.history = [];
            idbSlim.offers = (idbSlim.offers || []).filter(function (o) {
              return o && o.isPlayer;
            });
            idbSlim.itemStats = {};
            idbSlim.priceHistory = {};
            idbSlim.descOverrides = {};
            var payloadI = Object.assign({}, idbSlim);
            delete payloadI._persistMeta;
            lastBytes = persistByteLength(payloadI);
            applySlimLiveBags(idbSlim);
            // Fire IDB write; report optimistic success with clear messaging.
            idbPutGeSave(payloadI)
              .then(function () {
                setStatus(
                  "Saved to extended browser storage (IndexedDB) · localStorage still full (" +
                    formatPersistKb(lastBytes) +
                    " attempted). Progress should reload on this device.",
                  false
                );
              })
              .catch(function () {
                setStatus(
                  "Could not save GE progress — storage still full after cleanup (" +
                    formatPersistKb(lastBytes) +
                    " · notes/forged/bank). Export or prune bank ledgers, then retry.",
                  true
                );
              });
            // Tiny LS stub so load knows to hydrate from IDB
            try {
              tryLocalStorageSet(
                STORAGE,
                JSON.stringify({
                  version: Math.max(6, Number(state.version) || 6),
                  _idbOnly: true,
                  cashDelta: payloadI.cashDelta,
                  inventory: payloadI.inventory,
                  bank: payloadI.bank,
                  level: payloadI.level,
                  xp: payloadI.xp,
                  nextForgeId: payloadI.nextForgeId,
                  nextNoteId: payloadI.nextNoteId,
                  autoForge: !!payloadI.autoForge,
                  createdAt: payloadI.createdAt,
                })
              );
            } catch (eStub) {}
            return true;
          } catch (e4) {
            try {
              setStatus(
                "Could not save GE progress — storage still full after cleanup (" +
                  formatPersistKb(lastBytes) +
                  ").",
                true
              );
            } catch (e5) {}
            return false;
          }
        }
      }
    }
  }

  function person(id) {
    id = Number(id);
    for (var i = 0; i < roster.length; i++) {
      if (Number(roster[i].id) === id) return roster[i];
    }
    return null;
  }

  function personName(id) {
    var p = person(id);
    if (p && p.full_name) return p.full_name;
    if (Number(id) === PLAYER_ID) return "Logan Sevin";
    return "Trader #" + id;
  }

  function baseCash(id) {
    var p = person(id);
    if (!p) return 50000;
    if (p.debit && p.debit.balance_usd != null) return Number(p.debit.balance_usd) || 0;
    return Number(p.possession_usd) || 0;
  }

  function cashOf(id) {
    id = String(id);
    return Math.max(0, baseCash(id) + (Number(state.cashDelta[id]) || 0));
  }

  function invOf(id) {
    id = String(id);
    if (Number(id) === PLAYER_ID) {
      if (!state.inventory) state.inventory = {};
      if (!state.inventory[id]) state.inventory[id] = {};
      return state.inventory[id];
    }
    if (!npcRuntime.inventory[id]) npcRuntime.inventory[id] = {};
    return npcRuntime.inventory[id];
  }

  function qtyOf(id, itemId) {
    return Number(invOf(id)[String(itemId)]) || 0;
  }

  function addInv(id, itemId, delta) {
    var inv = invOf(id);
    var k = String(itemId);
    var next = (Number(inv[k]) || 0) + delta;
    if (next <= 0) delete inv[k];
    else inv[k] = next;
  }

  function addCash(id, delta) {
    id = String(id);
    state.cashDelta[id] = (Number(state.cashDelta[id]) || 0) + delta;
  }

  function bankOf(id) {
    id = String(id);
    if (Number(id) === PLAYER_ID) {
      if (!state.bank) state.bank = {};
      if (!state.bank[id]) state.bank[id] = {};
      return state.bank[id];
    }
    if (!npcRuntime.bank[id]) npcRuntime.bank[id] = {};
    return npcRuntime.bank[id];
  }

  function bankQty(id, itemId) {
    return Number(bankOf(id)[String(itemId)]) || 0;
  }

  function addBank(id, itemId, delta) {
    var b = bankOf(id);
    var k = String(itemId);
    var next = (Number(b[k]) || 0) + delta;
    if (next <= 0) delete b[k];
    else b[k] = next;
  }

  function invList(id) {
    return Object.keys(invOf(id))
      .map(function (k) {
        return { id: Number(k), qty: Number(invOf(id)[k]) || 0 };
      })
      .filter(function (x) {
        return x.qty > 0;
      })
      .sort(function (a, b) {
        return a.id - b.id;
      });
  }

  function bankList(id) {
    return Object.keys(bankOf(id))
      .map(function (k) {
        return { id: Number(k), qty: Number(bankOf(id)[k]) || 0 };
      })
      .filter(function (x) {
        return x.qty > 0;
      })
      .sort(function (a, b) {
        return a.id - b.id;
      });
  }

  function inventoryCount(id) {
    return invList(id).length;
  }

  function depositItem(itemId, qty) {
    itemId = Number(itemId);
    qty = Math.max(1, Math.floor(Number(qty) || 1));
    var have = qtyOf(PLAYER_ID, itemId);
    if (have < 1) return { ok: false, error: "Nothing to deposit." };
    qty = Math.min(qty, have);
    addInv(PLAYER_ID, itemId, -qty);
    addBank(PLAYER_ID, itemId, qty);
    saveState();
    return { ok: true, qty: qty };
  }

  function withdrawItem(itemId, qty) {
    itemId = Number(itemId);
    qty = Math.max(1, Math.floor(Number(qty) || 1));
    var have = bankQty(PLAYER_ID, itemId);
    if (have < 1) return { ok: false, error: "Bank is empty for that item." };
    var free = INV_SLOTS - inventoryCount(PLAYER_ID);
    var already = qtyOf(PLAYER_ID, itemId) > 0;
    if (!already && free < 1) return { ok: false, error: "Inventory full (28 kinds)." };
    qty = Math.min(qty, have);
    addBank(PLAYER_ID, itemId, -qty);
    addInv(PLAYER_ID, itemId, qty);
    saveState();
    return { ok: true, qty: qty };
  }

  function depositAll() {
    var list = invList(PLAYER_ID).slice();
    list.forEach(function (it) {
      var have = qtyOf(PLAYER_ID, it.id);
      if (have > 0) depositItem(it.id, have);
    });
    // Hard-clear any leftovers
    state.inventory[String(PLAYER_ID)] = {};
    selectedInvItem = null;
    saveState();
  }

  function withdrawAllPage() {
    var list = bankList(PLAYER_ID);
    var start = bankPage * BANK_PAGE;
    list.slice(start, start + BANK_PAGE).forEach(function (it) {
      withdrawItem(it.id, it.qty);
    });
    selectedBankItem = null;
  }


  function activeOffers() {
    return state.offers.filter(function (o) {
      if (!o || o.cancelled) return false;
      if (o.isPlayer && o.complete) return true;
      return (Number(o.qtyLeft) || 0) > 0;
    });
  }

  function playerSlotOffers() {
    return state.offers.filter(function (o) {
      return (
        o &&
        o.isPlayer &&
        !o.cancelled &&
        (o.complete ||
          (Number(o.qtyLeft) || 0) > 0 ||
          (Number(o.readyItems) || 0) > 0 ||
          (Number(o.readyCash) || 0) > 0)
      );
    });
  }


  function ingestSpellAssets(items) {
    extraItems = {};
    arsenalExtraNums = [];
    (items || []).forEach(function (it) {
      if (!it) return;
      var genNum = parseInt(it.number, 10);
      if (!genNum || genNum < 1) return;
      var url = it.url || it.generatedUrl || it.phoneUrl || "";
      if (!url) return;
      var source =
        it.source === "phone-upload" || it.kind === "phone-upload"
          ? "phone-upload"
          : it.source === "sketch-inverted" || it.kind === "sketch-inverted"
            ? "sketch-inverted"
            : it.source === "sketch" || it.kind === "sketch"
              ? "sketch"
              : "generated";
      var base =
        source === "sketch" ? SKETCH_BASE : source === "sketch-inverted" ? INV_SKETCH_BASE : GEN_BASE;
      var num = base + genNum;
      var analysis = it.analysis || null;
      if (analysis && !analysis.title && it.title) analysis.title = it.title;
      var defaultTitle =
        source === "phone-upload"
          ? "Phone G#" + genNum
          : source === "sketch"
            ? "Sketch S#" + genNum
            : source === "sketch-inverted"
              ? "Inv sketch SI#" + genNum
              : "Gen G#" + genNum;
      extraItems[num] = {
        number: num,
        genNum: genNum,
        sketchNum: source === "sketch" || source === "sketch-inverted" ? genNum : null,
        url: url,
        title: (analysis && analysis.title) || it.title || defaultTitle,
        source: source,
        name: it.name || "",
        analysis: analysis,
      };
      extraItems[String(num)] = extraItems[num];
      if (analysis) {
        analyses[String(num)] = analysis;
        analyses[num] = analysis;
      }
      arsenalExtraNums.push(num);
    });
    arsenalExtraNums.sort(function (a, b) {
      return a - b;
    });
  }

  function loadArsenal() {
    var url = apiUrl("/api/transfer/spell-assets?t=" + Date.now());
    return fetch(url, { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) return null;
        return r.json().catch(function () {
          return null;
        });
      })
      .then(function (d) {
        if (d && d.ok && Array.isArray(d.items)) {
          ingestSpellAssets(d.items);
          if (d.painting_total) PAINTING_TOTAL = Number(d.painting_total) || PAINTING_TOTAL;
        } else if (window.SpellforgeAPI && typeof window.SpellforgeAPI.getDisplayOrder === "function") {
          // Fallback: reuse Spellforge display order if API already booted
          try {
            var order = window.SpellforgeAPI.getDisplayOrder() || [];
            order.forEach(function (n) {
              n = Number(n);
              if (n > PAINTING_TOTAL && arsenalExtraNums.indexOf(n) < 0) arsenalExtraNums.push(n);
            });
          } catch (e) {}
        }
        return arsenalExtraNums.length;
      })
      .catch(function () {
        return 0;
      });
  }

  function forgedIds() {
    if (!state || !state.forged) return [];
    return Object.keys(state.forged)
      .map(function (k) {
        return Number(k);
      })
      .filter(function (n) {
        return n > 0;
      })
      .sort(function (a, b) {
        return a - b;
      });
  }

  /** Full tradable arsenal: paintings + generated + phone + sketches + inverted + forged */
  function arsenalList() {
    var list = [];
    var i;
    for (i = 1; i <= PAINTING_TOTAL; i++) list.push(i);
    for (i = 0; i < arsenalExtraNums.length; i++) list.push(arsenalExtraNums[i]);
    forgedIds().forEach(function (id) {
      if (list.indexOf(id) < 0) list.push(id);
    });
    return list;
  }

  /** XP needed to go from `level` → level+1 (simple quadratic curve). */
  function xpForLevel(level) {
    level = Math.max(1, Number(level) || 1);
    return Math.floor(40 + level * 35 + level * level * 8);
  }

  function grantXp(amount, opts) {
    opts = opts || {};
    amount = Math.max(0, Math.floor(Number(amount) || 0));
    if (!amount || !state) return;
    if (opts.walk) {
      var cap = WALK_XP_PER_LEVEL_CAP;
      var already = Number(state.walkXpThisLevel) || 0;
      if (already >= cap) return;
      amount = Math.min(amount, cap - already);
      state.walkXpThisLevel = already + amount;
    }
    state.xp = (Number(state.xp) || 0) + amount;
    state.level = Math.max(1, Number(state.level) || 1);
    var guard = 0;
    while (state.xp >= xpForLevel(state.level) && guard < 50) {
      state.xp -= xpForLevel(state.level);
      state.level += 1;
      state.walkXpThisLevel = 0;
      guard++;
    }
    saveState();
    updateLevelHud();
  }

  function updateLevelHud() {
    if (!state) return;
    var lv = Math.max(1, Number(state.level) || 1);
    var xp = Math.max(0, Number(state.xp) || 0);
    var need = xpForLevel(lv);
    var pct = need > 0 ? Math.min(100, Math.round((xp / need) * 100)) : 0;
    ["ge-world-lv", "ge-ui-lv"].forEach(function (id) {
      if ($(id)) $(id).textContent = String(lv);
    });
    ["ge-world-xp-fill", "ge-ui-xp-fill"].forEach(function (id) {
      if ($(id)) $(id).style.width = pct + "%";
    });
    if ($("ge-world-cash")) $("ge-world-cash").textContent = money(cashOf(PLAYER_ID));
  }

  function tagsFor(n) {
    n = Number(n);
    var out = [];
    var seen = Object.create(null);
    function add(t) {
      t = String(t || "").trim();
      if (!t) return;
      var key = t.toLowerCase();
      if (seen[key]) return;
      seen[key] = 1;
      out.push(t);
    }
    var a = analyses[String(n)] || analyses[n];
    if (a && Array.isArray(a.tags)) a.tags.forEach(add);
    var ex = extraOf(n);
    if (ex) {
      if (ex.analysis && Array.isArray(ex.analysis.tags)) ex.analysis.tags.forEach(add);
      if (ex.source === "phone-upload") add("phone");
      else if (ex.source === "sketch") add("sketch");
      else if (ex.source === "sketch-inverted") {
        add("sketch");
        add("inverted");
      } else if (ex.source === "generated") add("generated");
    }
    if (ledgerOf(n)) add("ledger");
    else if (noteOf(n)) add("note");
    if (forgedOf(n)) add("forged");
    if (n >= 1 && n <= PAINTING_TOTAL) add("painting");
    return out;
  }

  function collectAllTags() {
    var map = Object.create(null);
    function add(t) {
      t = String(t || "").trim();
      if (!t) return;
      var k = t.toLowerCase();
      if (!map[k]) map[k] = t;
    }
    Object.keys(analyses || {}).forEach(function (k) {
      var a = analyses[k];
      if (a && Array.isArray(a.tags)) a.tags.forEach(add);
    });
    Object.keys(extraItems || {}).forEach(function (k) {
      if (String(Number(k)) !== String(k) && Number(k) !== Number(k)) return;
      tagsFor(Number(k)).forEach(add);
    });
    forgedIds().forEach(function (id) {
      tagsFor(id).forEach(add);
    });
    ["painting", "generated", "phone", "sketch", "inverted", "forged", "ledger", "note"].forEach(add);
    return Object.keys(map)
      .sort()
      .map(function (k) {
        return map[k];
      });
  }

  function populateTagFilter() {
    var sel = $("ge-tag-filter");
    if (!sel) return;
    var prev = sel.value || "";
    var tags = collectAllTags();
    var html = ['<option value="">All tags</option>'];
    tags.forEach(function (t) {
      html.push('<option value="' + esc(t) + '">' + esc(t) + "</option>");
    });
    sel.innerHTML = html.join("");
    if (prev) {
      sel.value = prev;
      if (sel.value !== prev) sel.value = "";
    }
  }

  function randomArsenalItem(seedHint) {
    var list = arsenalList();
    if (!list.length) return 1 + Math.floor(Math.random() * PAINTING_TOTAL);
    if (seedHint != null) {
      var idx = Math.abs(Number(seedHint) || 0) % list.length;
      return list[idx];
    }
    return list[Math.floor(Math.random() * list.length)];
  }

  function ownedQty(itemId) {
    return qtyOf(PLAYER_ID, itemId) + bankQty(PLAYER_ID, itemId);
  }

  function consumeOwned(itemId, qty) {
    itemId = Number(itemId);
    qty = Math.max(1, Math.floor(Number(qty) || 1));
    var fromInv = Math.min(qty, qtyOf(PLAYER_ID, itemId));
    if (fromInv) addInv(PLAYER_ID, itemId, -fromInv);
    var left = qty - fromInv;
    if (left > 0) {
      if (bankQty(PLAYER_ID, itemId) < left) return false;
      addBank(PLAYER_ID, itemId, -left);
    }
    return true;
  }

  function setForgeStatus(msg, isErr) {
    var el = $("ge-forge-status");
    if (el) {
      el.textContent = msg || "";
      el.className = "ge-forge-status" + (isErr ? " err" : "");
    }
    if (msg) setStatus(msg, isErr);
  }

  function ensurePlayerStock() {
    // Inventory starts empty — you buy on the GE or withdraw from bank.
    // Never auto-fill from the gallery catalogue.
    state.packReady = true;
    if (cashOf(PLAYER_ID) < 1 && !state._starterCash) {
      state.cashDelta[String(PLAYER_ID)] = (Number(state.cashDelta[String(PLAYER_ID)]) || 0) + 5000;
      state._starterCash = true;
      saveState();
    }
  }

  function ensureNpcSeedStock() {
    if (state._npcSeeded) return;
    state._npcSeeded = true;
    var pool = arsenalList();
    for (var i = 0; i < roster.length; i++) {
      var p = roster[i];
      if (!p || p.is_player || Number(p.id) === PLAYER_ID) continue;
      var inv = invOf(p.id);
      var count = 3 + (Number(p.id) % 5);
      for (var k = 0; k < count; k++) {
        var item = pool.length
          ? pool[(Number(p.id) * 17 + k * 97) % pool.length]
          : 1 + ((Number(p.id) * 17 + k * 97) % PAINTING_TOTAL);
        inv[String(item)] = (Number(inv[String(item)]) || 0) + 1;
      }
    }
  }

  function matchOffers() {
    var safety = 0;
    while (safety++ < 800) {
      var buys = activeOffers()
        .filter(function (o) {
          return o.side === "buy" && !o.complete && (Number(o.qtyLeft) || 0) > 0;
        })
        .sort(function (a, b) {
          return b.price - a.price || a.createdAt - b.createdAt;
        });
      var sells = activeOffers()
        .filter(function (o) {
          return o.side === "sell" && !o.complete && (Number(o.qtyLeft) || 0) > 0;
        })
        .sort(function (a, b) {
          return a.price - b.price || a.createdAt - b.createdAt;
        });

      var matched = false;
      for (var bi = 0; bi < buys.length && !matched; bi++) {
        var buy = buys[bi];
        for (var si = 0; si < sells.length; si++) {
          var sell = sells[si];
          if (String(buy.itemId) !== String(sell.itemId)) continue;
          if (Number(buy.traderId) === Number(sell.traderId)) continue;
          if (buy.price < sell.price) continue;
          var qty = Math.min(buy.qtyLeft, sell.qtyLeft);
          if (qty <= 0) continue;
          var px = sell.price;
          var total = qty * px;
          var refund = qty * (buy.price - px);
          // RuneScape-style: player goods/cash sit on the offer until Collect.
          // NPCs settle immediately.
          if (buy.isPlayer) {
            buy.readyItems = (Number(buy.readyItems) || 0) + qty;
            if (refund) buy.readyCash = (Number(buy.readyCash) || 0) + refund;
          } else {
            if (refund) addCash(buy.traderId, refund);
            addInv(buy.traderId, buy.itemId, qty);
          }
          if (sell.isPlayer) {
            sell.readyCash = (Number(sell.readyCash) || 0) + total;
          } else {
            addCash(sell.traderId, total);
          }
          buy.qtyLeft -= qty;
          sell.qtyLeft -= qty;
          var h = {
            id: uid(),
            itemId: Number(buy.itemId),
            qty: qty,
            price: px,
            total: total,
            buyerId: buy.traderId,
            buyerName: buy.traderName,
            sellerId: sell.traderId,
            sellerName: sell.traderName,
            at: Date.now(),
          };
          state.history.unshift(h);
          if (state.history.length > 400) state.history.length = 400;
          recordTrade(h);
          if (buy.qtyLeft <= 0) {
            if (buy.isPlayer) buy.complete = true;
          }
          if (sell.qtyLeft <= 0) {
            if (sell.isPlayer) sell.complete = true;
          }
          matched = true;
          break;
        }
      }
      if (!matched) break;
    }
    // Drop finished NPC offers; keep completed player offers until collected
    state.offers = state.offers.filter(function (o) {
      if (!o || o.cancelled) return false;
      if (o.isPlayer && ((Number(o.readyItems) || 0) > 0 || (Number(o.readyCash) || 0) > 0)) return true;
      if (o.isPlayer && o.complete) return true;
      return (Number(o.qtyLeft) || 0) > 0;
    });
  }

  function placeOffer(opts) {
    var side = opts.side;
    var itemId = Number(opts.itemId);
    var qty = Math.max(1, Math.floor(Number(opts.qty) || 1));
    var price = Math.max(1, Math.floor(Number(opts.price) || 1));
    var traderId = Number(opts.traderId);
    var isPlayer = traderId === PLAYER_ID;
    var silent = !!opts.silent;

    if (isPlayer && playerSlotOffers().length >= MAX_SLOTS) {
      return { ok: false, error: "All " + MAX_SLOTS + " offer slots are full." };
    }
    if (side === "buy") {
      var need = qty * price;
      if (cashOf(traderId) < need) {
        return { ok: false, error: "Not enough SIM cash (need " + money(need) + ")." };
      }
      addCash(traderId, -need);
    } else {
      if (qtyOf(traderId, itemId) < qty) {
        return { ok: false, error: "Not enough stock of #" + itemId + "." };
      }
      addInv(traderId, itemId, -qty);
    }

    state.offers.push({
      id: uid(),
      side: side,
      itemId: itemId,
      qty: qty,
      qtyLeft: qty,
      price: price,
      traderId: traderId,
      traderName: personName(traderId),
      isPlayer: isPlayer,
      complete: false,
      readyItems: 0,
      readyCash: 0,
      createdAt: Date.now(),
      slot: isPlayer ? setupSlot : -1,
    });
    matchOffers();
    if (!silent) saveState();
    return { ok: true };
  }

  function cancelOffer(offerId) {
    var o = null;
    for (var i = 0; i < state.offers.length; i++) {
      if (state.offers[i].id === offerId) {
        o = state.offers[i];
        break;
      }
    }
    if (!o || o.cancelled) return;
    var left = Number(o.qtyLeft) || 0;
    if (!o.complete) {
      // Return only the unfilled reservation; filled portion stays for Collect.
      if (o.side === "buy") addCash(o.traderId, left * o.price);
      else addInv(o.traderId, o.itemId, left);
    }
    o.qtyLeft = 0;
    var pending = (Number(o.readyItems) || 0) > 0 || (Number(o.readyCash) || 0) > 0;
    if (o.isPlayer && pending) {
      o.complete = true;
      saveState();
      return;
    }
    o.cancelled = true;
    o.complete = false;
    state.offers = state.offers.filter(function (x) {
      return x && !x.cancelled && ((x.isPlayer && x.complete) || (Number(x.qtyLeft) || 0) > 0 || (Number(x.readyItems) || 0) > 0 || (Number(x.readyCash) || 0) > 0);
    });
    saveState();
  }

  function collectOffer(offerId) {
    var o = null;
    for (var i = 0; i < state.offers.length; i++) {
      if (state.offers[i].id === offerId) {
        o = state.offers[i];
        break;
      }
    }
    if (!o || !o.isPlayer) return;
    var readyItems = Number(o.readyItems) || 0;
    var readyCash = Number(o.readyCash) || 0;
    if (readyItems < 1 && readyCash < 1 && !o.complete) return;
    if (readyItems > 0) {
      var already = qtyOf(PLAYER_ID, o.itemId) > 0;
      var free = INV_SLOTS - inventoryCount(PLAYER_ID);
      if (!already && free < 1) {
        addBank(PLAYER_ID, o.itemId, readyItems);
        setStatus("Pack full — collected #" + o.itemId + " went to bank.");
      } else {
        addInv(PLAYER_ID, o.itemId, readyItems);
      }
    }
    if (readyCash > 0) addCash(PLAYER_ID, readyCash);
    o.readyItems = 0;
    o.readyCash = 0;
    // Free the slot only when the offer is fully filled (or was marked complete).
    if (o.complete || (Number(o.qtyLeft) || 0) <= 0) {
      o.cancelled = true;
      o.complete = false;
      o.qtyLeft = 0;
      state.offers = state.offers.filter(function (x) {
        return x && !x.cancelled && ((x.isPlayer && x.complete) || (Number(x.qtyLeft) || 0) > 0 || (Number(x.readyItems) || 0) > 0 || (Number(x.readyCash) || 0) > 0);
      });
    }
    grantXp(COLLECT_XP);
    saveState();
  }

  function collectAll() {
    playerSlotOffers()
      .filter(function (o) {
        return o.complete;
      })
      .forEach(function (o) {
        collectOffer(o.id);
      });
  }

  function seedNpcOffers() {
    if (state.npcSeededOffers) return;
    if (!roster.length) return;
    state.npcSeededOffers = true;
    var items = arsenalList();
    if (!items.length) {
      for (var n = 1; n <= PAINTING_TOTAL; n += 7) items.push(n);
    } else {
      // Thin sample across full arsenal for seed book density
      var sampled = [];
      for (var si = 0; si < items.length; si += Math.max(1, Math.floor(items.length / 140))) {
        sampled.push(items[si]);
      }
      items = sampled.length ? sampled : items;
    }
    for (var i = 0; i < roster.length; i++) {
      var p = roster[i];
      if (!p || p.is_player || Number(p.id) === PLAYER_ID) continue;
      var item = items[(Number(p.id) * 3) % items.length];
      var g = guidePrice(item);
      if (qtyOf(p.id, item) < 2) addInv(p.id, item, 2);
      placeOffer({
        side: "sell",
        itemId: item,
        qty: 1,
        price: Math.max(1, Math.round(g * (1.02 + (Number(p.id) % 7) * 0.01))),
        traderId: p.id,
        silent: true,
      });
      placeOffer({
        side: "buy",
        itemId: item,
        qty: 1,
        price: Math.max(1, Math.round(g * (0.9 - (Number(p.id) % 5) * 0.01))),
        traderId: p.id,
        silent: true,
      });
    }
    snapshotTrackedPrices();
    saveState();
  }

  function hitPlayerOffers(npc) {
    // Actively take the other side of the player's open offers for momentum.
    var mine = playerSlotOffers().filter(function (o) {
      return !o.complete && (Number(o.qtyLeft) || 0) > 0;
    });
    if (!mine.length) return false;
    var o = mine[Math.floor(Math.random() * mine.length)];
    var qty = Math.min(Number(o.qtyLeft) || 1, 1 + (Math.random() < 0.25 ? 1 : 0));
    if (o.side === "buy") {
      // Player is buying → NPC sells into them at player's price (or slightly under guide)
      if (qtyOf(npc.id, o.itemId) < qty) addInv(npc.id, o.itemId, qty);
      placeOffer({
        side: "sell",
        itemId: o.itemId,
        qty: qty,
        price: o.price,
        traderId: npc.id,
        silent: true,
      });
    } else {
      // Player is selling → NPC buys at player's price
      placeOffer({
        side: "buy",
        itemId: o.itemId,
        qty: qty,
        price: o.price,
        traderId: npc.id,
        silent: true,
      });
    }
    return true;
  }

  function npcTick() {
    if (!roster.length) return;
    tickN++;
    var actions = 4 + (tickN % 4);
    for (var a = 0; a < actions; a++) {
      var p = roster[Math.floor(Math.random() * roster.length)];
      if (!p || p.is_player || Number(p.id) === PLAYER_ID) continue;
      var roll = Math.random();
      // ~45% of actions: directly fill a player offer for visible momentum
      if (roll < 0.45 && hitPlayerOffers(p)) continue;
      if (roll < 0.55) {
        var mine = activeOffers().filter(function (o) {
          return Number(o.traderId) === Number(p.id) && !o.isPlayer;
        });
        if (mine.length) cancelOffer(mine[Math.floor(Math.random() * mine.length)].id);
        continue;
      }
      var item = randomArsenalItem();
      var guide = guidePrice(item);
      var side = Math.random() < 0.5 ? "buy" : "sell";
      if (side === "sell" && qtyOf(p.id, item) < 1) {
        addInv(p.id, item, 1 + Math.floor(Math.random() * 2));
      }
      var qty = 1 + (Math.random() < 0.35 ? 1 : 0);
      // Tighter prices around guide so books cross more often
      var slip = side === "buy" ? 0.92 + Math.random() * 0.1 : 0.95 + Math.random() * 0.12;
      placeOffer({
        side: side,
        itemId: item,
        qty: qty,
        price: Math.max(1, Math.round(guide * slip)),
        traderId: p.id,
        silent: true,
      });
    }
    matchOffers();
    snapshotTrackedPrices();
    saveState();
    if (view === "home" || view === "history" || view === "tracker") render();
  }

  function setStatus(msg, isErr) {
    var el = $("ge-status");
    if (!el) return;
    el.textContent = msg || "";
    el.className = "ge-status" + (isErr ? " err" : "");
  }

  function showView(name) {
    view = name;
    ["ge-home", "ge-setup", "ge-pick", "ge-history", "ge-tracker"].forEach(function (id) {
      var el = $(id);
      if (!el) return;
      if (id === "ge-home") el.classList.toggle("hide", name !== "home");
      else el.classList.toggle("show", name === id.replace("ge-", ""));
    });
    // map setup/pick/history/tracker
    if ($("ge-setup")) $("ge-setup").classList.toggle("show", name === "setup");
    if ($("ge-pick")) $("ge-pick").classList.toggle("show", name === "pick");
    if ($("ge-history")) $("ge-history").classList.toggle("show", name === "history");
    if ($("ge-tracker")) $("ge-tracker").classList.toggle("show", name === "tracker");
    if ($("ge-home")) $("ge-home").classList.toggle("hide", name !== "home");

    var ex = $("ge-tab-exchange");
    var hi = $("ge-tab-history");
    var tr = $("ge-tab-tracker");
    if (ex) ex.classList.toggle("active", name === "home" || name === "setup" || name === "pick");
    if (hi) hi.classList.toggle("active", name === "history");
    if (tr) tr.classList.toggle("active", name === "tracker");
  }

  function maxOfferQtyFromInventory() {
    var itemId = Number(selected) || 0;
    if (!itemId) return 1;
    if (setupSide === "sell") {
      // Sell: all of this item currently in the pack
      return Math.max(1, qtyOf(PLAYER_ID, itemId) || 1);
    }
    // Buy: as many as cash can cover at the current offer price (at least 1)
    var px = Math.max(1, Number($("ge-price") && $("ge-price").value) || guidePrice(itemId) || 1);
    var cash = Math.max(0, cashOf(PLAYER_ID));
    var afford = Math.floor(cash / px);
    return Math.max(1, afford || 1);
  }

  function setOfferQtyToMax() {
    var el = $("ge-qty");
    if (!el) return;
    var maxQ = maxOfferQtyFromInventory();
    el.value = String(maxQ);
    updateTotal();
    if (setupSide === "sell") {
      setStatus("Qty set to Max — " + maxQ + " from inventory.");
    } else {
      setStatus("Qty set to Max — " + maxQ + " (what your cash covers).");
    }
  }

  function updateTotal() {
    var qty = Math.max(1, Number($("ge-qty") && $("ge-qty").value) || 1);
    var px = Math.max(1, Number($("ge-price") && $("ge-price").value) || 1);
    if ($("ge-total")) $("ge-total").textContent = "Total: " + money(qty * px);
    var maxBtn = $("ge-qty-max");
    if (maxBtn) {
      var maxQ = maxOfferQtyFromInventory();
      maxBtn.title =
        setupSide === "sell"
          ? "Max from inventory (" + maxQ + ")"
          : "Max you can afford (" + maxQ + ")";
      maxBtn.textContent = "Max";
    }
  }


  function renderInvGrid() {
    var wrap = $("ge-inv-grid");
    if (!wrap) return;
    var list = invList(PLAYER_ID);
    var html = [];
    for (var i = 0; i < INV_SLOTS; i++) {
      var it = list[i];
      if (!it) {
        html.push('<div class="ge-inv-slot empty"></div>');
        continue;
      }
      var sel = selectedInvItem === it.id ? " selected" : "";
      var ledCls = ledgerOf(it.id) ? " ledger" : noteOf(it.id) ? " note" : "";
      html.push(
        '<button type="button" class="ge-inv-slot' +
          sel +
          ledCls +
          '" data-ge-inv="' +
          it.id +
          '" title="' +
          esc((ledgerOf(it.id) ? "Ledger · " : "") + titleFor(it.id)) +
          '"><img src="' +
          esc(thumb(it.id)) +
          '" alt="" loading="eager" decoding="async" /><span class="qty">' +
          it.qty +
          "</span></button>"
      );
    }
    wrap.innerHTML = html.join("");
    bindBagThumbErrors(wrap);
    if ($("ge-inv-meta")) {
      $("ge-inv-meta").textContent =
        list.length +
        " / " +
        INV_SLOTS +
        " used · right-click → Force load if thumb is blank";
    }
  }

  function renderBankGrid() {
    var wrap = $("ge-bank-grid");
    if (!wrap) return;
    var list = bankList(PLAYER_ID);
    var pages = Math.max(1, Math.ceil(list.length / BANK_PAGE) || 1);
    if (bankPage > pages - 1) bankPage = pages - 1;
    if (bankPage < 0) bankPage = 0;
    var start = bankPage * BANK_PAGE;
    var slice = list.slice(start, start + BANK_PAGE);
    var html = [];
    for (var i = 0; i < BANK_PAGE; i++) {
      var it = slice[i];
      if (!it) {
        html.push('<div class="ge-bank-slot empty"></div>');
        continue;
      }
      var sel = selectedBankItem === it.id ? " selected" : "";
      var ledCls = ledgerOf(it.id) ? " ledger" : noteOf(it.id) ? " note" : "";
      html.push(
        '<button type="button" class="ge-bank-slot' +
          sel +
          ledCls +
          '" data-ge-bank="' +
          it.id +
          '" title="' +
          esc((ledgerOf(it.id) ? "Ledger · " : "") + titleFor(it.id)) +
          '"><img src="' +
          esc(thumb(it.id)) +
          '" alt="" loading="eager" decoding="async" /><span class="qty">' +
          it.qty +
          "</span></button>"
      );
    }
    wrap.innerHTML = html.join("");
    bindBagThumbErrors(wrap);
    if ($("ge-bank-page")) $("ge-bank-page").textContent = pages ? bankPage + 1 + " / " + pages : "1 / 1";
    if ($("ge-bank-meta")) {
      $("ge-bank-meta").textContent = list.length + " types in bank (unlimited) · page " + (bankPage + 1) + " · " + BANK_PAGE + " shown";
    }
  }

  function renderBags() {
    var invP = $("ge-inv-panel");
    var bankP = $("ge-bank-panel");
    if (invP) invP.hidden = bagView !== "inv";
    if (bankP) bankP.hidden = bagView !== "bank";
    if ($("ge-bag-inv")) $("ge-bag-inv").classList.toggle("active", bagView === "inv");
    if ($("ge-bag-bank")) $("ge-bag-bank").classList.toggle("active", bagView === "bank");
    // Always rebuild both grids so deposit/withdraw stay fresh even when a panel is hidden
    renderInvGrid();
    renderBankGrid();
  }

  function renderSlots() {
    var wrap = $("ge-slots");
    if (!wrap) return;
    var offers = playerSlotOffers();
    var html = [];
    for (var i = 0; i < MAX_SLOTS; i++) {
      var o = offers[i];
      if (!o) {
        html.push(
          '<div class="ge-slot" data-slot="' +
            i +
            '">' +
            '<div class="ge-slot-label">Empty</div>' +
            '<div class="ge-slot-empty-actions">' +
            '<button type="button" class="ge-slot-action buy" data-ge-empty-buy="' +
            i +
            '" title="Buy">⬇</button>' +
            '<button type="button" class="ge-slot-action sell" data-ge-empty-sell="' +
            i +
            '" title="Sell">⬆</button>' +
            "</div></div>"
        );
        continue;
      }
      var filled = o.qty - (Number(o.qtyLeft) || 0);
      var pct = o.complete ? 100 : Math.round((filled / Math.max(1, o.qty)) * 100);
      var progClass = o.side === "sell" ? "sell" : "";
      if (o.complete) progClass += " done";
      html.push(
        '<div class="ge-slot" data-offer="' +
          esc(o.id) +
          '">' +
          '<div class="ge-slot-label">' +
          (o.complete || (Number(o.readyItems) || 0) > 0 || (Number(o.readyCash) || 0) > 0
            ? "Collect — "
            : "") +
          (o.side === "buy" ? "Buy" : "Sell") +
          "</div>" +
          '<div class="ge-slot-row">' +
          '<img src="' +
          esc(thumb(o.itemId)) +
          '" alt="" />' +
          '<div class="ge-slot-meta">' +
          '<div class="name">' +
          esc(titleFor(o.itemId)) +
          "</div>" +
          '<div class="qty">' +
          filled +
          " / " +
          o.qty +
          "</div>" +
          '<div class="px">' +
          money(o.price) +
          " each</div>" +
          "</div></div>" +
          '<div class="ge-progress ' +
          progClass +
          '"><span style="width:' +
          pct +
          '%"></span></div>' +
          '<div class="ge-slot-foot">' +
          ((Number(o.readyItems) || 0) > 0 || (Number(o.readyCash) || 0) > 0 || o.complete
            ? '<button type="button" data-ge-collect="' + esc(o.id) + '">Collect</button>'
            : '') +
          ((Number(o.qtyLeft) || 0) > 0 && !o.complete
            ? '<button type="button" data-ge-abort="' + esc(o.id) + '">Abort</button>'
            : '') +
          "</div></div>"
      );
    }
    wrap.innerHTML = html.join("");
  }


  function catalogFilterList() {
    var q = (($("ge-search") && $("ge-search").value) || "").trim().toLowerCase();
    var tagSel = (($("ge-tag-filter") && $("ge-tag-filter").value) || "").trim().toLowerCase();
    var out = [];
    var list = arsenalList();
    for (var i = 0; i < list.length; i++) {
      var n = list[i];
      var title = titleFor(n);
      var label = kindLabel(n);
      var hay = (title + " " + label + " #" + n).toLowerCase();
      if (tagSel) {
        var itemTags = tagsFor(n).map(function (t) {
          return String(t).toLowerCase();
        });
        if (itemTags.indexOf(tagSel) === -1) continue;
      }
      if (q) {
        var qLow = q;
        if (
          hay.indexOf(qLow) === -1 &&
          !(qLow === "phone" && extraOf(n) && extraOf(n).source === "phone-upload") &&
          !(qLow === "gen" && extraOf(n) && extraOf(n).source === "generated") &&
          !(
            (qLow === "sketch" || qLow === "sketches") &&
            extraOf(n) &&
            (extraOf(n).source === "sketch" || extraOf(n).source === "sketch-inverted")
          ) &&
          !(qLow === "inverted" && extraOf(n) && extraOf(n).source === "sketch-inverted") &&
          !(qLow === "forged" && forgedOf(n))
        ) {
          continue;
        }
      }
      out.push(n);
    }
    return out;
  }

  function pickRandomTradeItem() {
    var pool;
    if (setupSide === "sell") {
      pool = invList(PLAYER_ID).map(function (it) {
        return it.id;
      });
      if (!pool.length) {
        // Fall back to bank for sell random
        pool = bankList(PLAYER_ID).map(function (it) {
          return it.id;
        });
      }
    } else {
      pool = catalogFilterList();
      if (!pool.length) pool = arsenalList();
    }
    if (!pool.length) return null;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function applyRandomItem() {
    var n = pickRandomTradeItem();
    if (n == null) {
      setStatus(
        setupSide === "sell"
          ? "Nothing in inventory/bank to randomize."
          : "No items match the current filters.",
        true
      );
      return false;
    }
    selected = Number(n);
    if ($("ge-price")) $("ge-price").value = String(guidePrice(selected));
    renderSetup();
    setStatus("Random: " + kindLabel(selected) + " · " + titleFor(selected) + " @ " + money(guidePrice(selected)));
    return true;
  }

  function renderSetup() {
    if ($("ge-setup-side")) $("ge-setup-side").textContent = setupSide === "buy" ? "Buy offer" : "Sell offer";
    if ($("ge-setup-slot-label")) $("ge-setup-slot-label").textContent = "Slot " + (setupSlot + 1);
    if ($("ge-setup-img")) $("ge-setup-img").src = thumb(selected);
    if ($("ge-setup-name")) $("ge-setup-name").textContent = titleFor(selected);
    if ($("ge-setup-desc")) $("ge-setup-desc").textContent = descFor(selected);
    if ($("ge-setup-guide")) {
      var held = qtyOf(PLAYER_ID, selected);
      var banked = bankQty(PLAYER_ID, selected);
      $("ge-setup-guide").textContent =
        "Guide price " +
        money(guidePrice(selected)) +
        " · inventory " +
        held +
        (banked ? " · bank " + banked : "") +
        (setupSide === "sell" ? " · Max = inventory" : "");
    }
    updateTotal();
    if ($("ge-price") && document.activeElement !== $("ge-price")) {
      $("ge-price").value = String(guidePrice(selected));
    }
    var trackBtn = $("ge-track-item");
    if (trackBtn) {
      var tracked = isTracked(selected);
      trackBtn.textContent = tracked ? "Untrack" : "Track";
      trackBtn.title = tracked
        ? "Remove from Market Tracker"
        : "Watch this item on the Market Tracker";
    }
    updateTotal();
  }

  function renderCatalog() {
    var wrap = $("ge-catalog");
    var q = (($("ge-search") && $("ge-search").value) || "").trim().toLowerCase();
    var tagSel = (($("ge-tag-filter") && $("ge-tag-filter").value) || "").trim().toLowerCase();
    if (!wrap) return;
    var html = [];
    var shown = 0;
    var list = arsenalList();
    for (var i = 0; i < list.length && shown < 200; i++) {
      var n = list[i];
      var title = titleFor(n);
      var label = kindLabel(n);
      var hay = (title + " " + label + " #" + n).toLowerCase();
      if (tagSel) {
        var itemTags = tagsFor(n).map(function (t) {
          return String(t).toLowerCase();
        });
        if (itemTags.indexOf(tagSel) === -1) continue;
      }
      if (q) {
        var qLow = q;
        if (
          hay.indexOf(qLow) === -1 &&
          !(qLow === "phone" && extraOf(n) && extraOf(n).source === "phone-upload") &&
          !(qLow === "gen" && extraOf(n) && extraOf(n).source === "generated") &&
          !(
            (qLow === "sketch" || qLow === "sketches") &&
            extraOf(n) &&
            (extraOf(n).source === "sketch" || extraOf(n).source === "sketch-inverted")
          ) &&
          !(qLow === "inverted" && extraOf(n) && extraOf(n).source === "sketch-inverted") &&
          !(qLow === "forged" && forgedOf(n))
        ) {
          continue;
        }
      }
      html.push(
        '<button type="button" class="ge-pick-item" data-ge-item="' +
          n +
          '"><img src="' +
          esc(thumb(n)) +
          '" alt="" loading="lazy" /><span>' +
          esc(label) +
          " · " +
          money(guidePrice(n)) +
          "</span></button>"
      );
      shown++;
    }
    wrap.innerHTML = html.join("") || '<p class="ge-summary">No matches.</p>';
  }

  function renderHistory() {
    var body = $("ge-feed-body");
    if (body) {
      var mine = state.history.filter(function (h) {
        return Number(h.buyerId) === PLAYER_ID || Number(h.sellerId) === PLAYER_ID;
      });
      var rows = (mine.length ? mine : state.history).slice(0, 40);
      body.innerHTML = rows.length
        ? rows
            .map(function (h) {
              var side = Number(h.buyerId) === PLAYER_ID ? "BUY" : Number(h.sellerId) === PLAYER_ID ? "SELL" : "NPC";
              var other = side === "BUY" ? h.sellerName : side === "SELL" ? h.buyerName : h.buyerName + " / " + h.sellerName;
              return (
                "<tr><td>#" +
                h.itemId +
                "</td><td>" +
                side +
                "</td><td>" +
                h.qty +
                "</td><td>" +
                money(h.price) +
                "</td><td>" +
                esc(other) +
                "</td></tr>"
              );
            })
            .join("")
        : '<tr><td colspan="5">No trades yet.</td></tr>';
    }
    var top = $("ge-top-body");
    if (!top) return;
    var rows2 = Object.keys(state.itemStats || {})
      .map(function (k) {
        var st = state.itemStats[k];
        return { id: Number(k), trades: st.trades || 0, volume: st.volume || 0, lastPrice: st.lastPrice || 0 };
      })
      .filter(function (r) {
        return r.trades > 0;
      })
      .sort(function (a, b) {
        return b.trades - a.trades;
      })
      .slice(0, 15);
    top.innerHTML = rows2.length
      ? rows2
          .map(function (r) {
            return (
              "<tr><td>#" +
              r.id +
              "</td><td>" +
              r.trades +
              "</td><td>" +
              money(r.volume) +
              "</td><td>" +
              money(r.lastPrice) +
              "</td></tr>"
            );
          })
          .join("")
      : '<tr><td colspan="4">No piece stats yet.</td></tr>';
  }

  function renderTracker() {
    var empty = $("ge-tracker-empty");
    var list = $("ge-tracker-list");
    if (!list) return;
    var ids = (state && Array.isArray(state.trackedItems) ? state.trackedItems : []).slice();
    if (!ids.length) {
      if (empty) empty.hidden = false;
      list.hidden = true;
      list.innerHTML = "";
      return;
    }
    if (empty) empty.hidden = true;
    list.hidden = false;
    var hist = (state && state.priceHistory) || {};
    list.innerHTML = ids
      .map(function (id) {
        id = Number(id);
        var g = guidePrice(id);
        var buy = bestBookBuy(id);
        var sell = bestBookSell(id);
        var mid = midMarketPrice(id);
        var pts = Array.isArray(hist[String(id)]) ? hist[String(id)] : [];
        var prev = pts.length >= 2 ? pts[pts.length - 2] : null;
        // delta vs previous snapshot mid/guide
        var prevVal = prev ? Number(prev.m != null ? prev.m : prev.g) || g : null;
        var delta = prevVal != null ? mid - prevVal : 0;
        var deltaCls = delta > 0 ? "delta-up" : delta < 0 ? "delta-down" : "delta-flat";
        var deltaTxt =
          prevVal == null ? "—" : (delta > 0 ? "+" : "") + money(delta);
        var buyTxt = buy ? money(buy) : "—";
        var sellTxt = sell ? money(sell) : "—";
        return (
          '<div class="ge-tracker-row" data-ge-tracked="' +
          id +
          '">' +
          '<img src="' +
          esc(thumb(id)) +
          '" alt="" />' +
          '<div class="ge-tracker-meta">' +
          '<div class="name">' +
          esc(titleFor(id)) +
          "</div>" +
          '<div class="sub">' +
          esc(kindLabel(id)) +
          " · mid " +
          money(mid) +
          "</div>" +
          "</div>" +
          '<div class="ge-tracker-prices">' +
          '<div class="guide">Guide ' +
          money(g) +
          ' <span class="' +
          deltaCls +
          '">(' +
          deltaTxt +
          ")</span></div>" +
          '<div class="buy">Best buy ' +
          buyTxt +
          "</div>" +
          '<div class="sell">Best sell ' +
          sellTxt +
          "</div>" +
          "</div>" +
          sparklineSvg(pts) +
          '<button type="button" class="ge-tracker-untrack" data-ge-untrack="' +
          id +
          '" title="Untrack">×</button>' +
          "</div>"
        );
      })
      .join("");
  }

  function render() {
    if ($("ge-you-cash")) $("ge-you-cash").textContent = money(cashOf(PLAYER_ID));
    if ($("ge-you-slots")) $("ge-you-slots").textContent = playerSlotOffers().length + " / " + MAX_SLOTS;
    if ($("ge-open")) $("ge-open").textContent = String(activeOffers().length);
    if ($("ge-tick")) $("ge-tick").textContent = "tick " + tickN;
    updateLevelHud();
    if (view === "home") renderSlots();
    if (view === "setup") renderSetup();
    if (view === "pick") renderCatalog();
    if (view === "history") renderHistory();
    if (view === "tracker") renderTracker();
    renderBags();
    renderForgeSlots();
    renderNoteColorHits();
    if (typeof syncAutoForgeToggleUi === "function") syncAutoForgeToggleUi();
  }


  function syncForgeToSpellforge() {
    try {
      if (!window.SpellforgeAPI) return;
      var panel = document.getElementById("panel-spellforge");
      var visible = panel && !panel.hidden;
      if (typeof window.SpellforgeAPI.equipSlots === "function") {
        window.SpellforgeAPI.equipSlots(forgeSlots.slice(), {
          skipAutoVision: true,
          skipRender: !visible,
        });
        return;
      }
      if (visible && typeof window.SpellforgeAPI.equipToSlot === "function") {
        for (var i = 0; i < 3; i++) {
          if (forgeSlots[i] != null) window.SpellforgeAPI.equipToSlot(forgeSlots[i], i);
        }
      }
    } catch (e) {}
  }

  function renderForgeSlots() {
    for (var i = 0; i < 3; i++) {
      var btn = $("ge-forge-slot-" + i);
      if (!btn) continue;
      var id = forgeSlots[i];
      btn.classList.toggle("filled", !!id);
      btn.classList.toggle("note-slot", !!(id && noteOf(id)));
      btn.classList.toggle("color-slot", !!(id && colorChipOf(id)));
      btn.title = id ? "Clear slot · " + kindLabel(id) : "Clear slot";
      var num = btn.querySelector(".ge-forge-num");
      var img = btn.querySelector("img:not(.ge-note-icon)");
      var badge = btn.querySelector(".ge-note-badge");
      if (id && (noteOf(id) || colorChipOf(id))) {
        if (img) img.remove();
        if (!badge) {
          badge = document.createElement("span");
          badge.className = "ge-note-badge";
          btn.appendChild(badge);
        }
        var chip = colorChipOf(id);
        if (chip) {
          badge.innerHTML =
            '<img class="ge-note-icon" src="' +
            colorChipThumb(chip.hex) +
            '" alt="" /><span>' +
            esc(String(titleFor(id)).slice(0, 28)) +
            "</span>";
        } else {
          badge.innerHTML =
            '<img class="ge-note-icon" src="' +
            NOTE_THUMB +
            '" alt="" /><span>' +
            esc(String(titleFor(id)).slice(0, 28)) +
            "</span>";
        }
        if (num) num.style.display = "none";
      } else if (id) {
        if (badge) badge.remove();
        if (!img) {
          img = document.createElement("img");
          img.alt = "";
          btn.appendChild(img);
        }
        img.src = thumb(id);
        if (num) num.style.display = "none";
      } else {
        if (img) img.remove();
        if (badge) badge.remove();
        if (num) {
          num.style.display = "";
          num.textContent = String(i + 1);
        }
      }
    }
  }

  function placeInForge(itemId, slotIndex) {
    itemId = Number(itemId);
    if (!itemId) return { ok: false, error: "No item." };
    if (!noteOf(itemId) && ownedQty(itemId) < 1) {
      return { ok: false, error: "You do not own that item." };
    }
    var slot = slotIndex == null || slotIndex === "" ? -1 : Number(slotIndex);
    if (slot < 0 || slot > 2 || isNaN(slot)) {
      slot = -1;
      for (var i = 0; i < 3; i++) {
        if (forgeSlots[i] == null) {
          slot = i;
          break;
        }
      }
      if (slot < 0) return { ok: false, error: "Spellforge slots are full — clear one first." };
    }
    forgeSlots[slot] = itemId;
    // Do NOT call SpellforgeAPI here — live equip re-renders Spellforge and can blank its UI
    // while you're still on Grand Exchange. Sync happens on Open Spellforge / Combine.
    return { ok: true, slot: slot, itemId: itemId };
  }

  function hideForgeContextMenu() {
    var menu = $("ge-forge-menu");
    if (menu) menu.hidden = true;
  }

  function showForgeContextMenu(clientX, clientY, itemId, source) {
    var menu = $("ge-forge-menu");
    if (!menu) return;
    source = source === "bank" ? "bank" : "inv";
    menu.dataset.itemId = String(itemId);
    menu.dataset.source = source;
    var isChip = !!colorChipOf(itemId);
    var isLed = !!ledgerOf(itemId);
    var isNote = !!noteOf(itemId) && !isLed;
    for (var i = 0; i < 3; i++) {
      var btn = menu.querySelector('[data-forge-pick="' + i + '"]');
      if (!btn) continue;
      var cur = forgeSlots[i];
      btn.textContent =
        "Slot " +
        (i + 1) +
        (cur != null ? " · " + kindLabel(cur) : " · empty");
      btn.classList.toggle("occupied", cur != null);
      // Ledgers are complete compositions — not forge fillers.
      btn.hidden = !!isLed;
    }
    var divider = menu.querySelector(".ge-forge-menu-divider");
    if (divider) divider.hidden = !!isLed;
    var dep = menu.querySelector('[data-ge-action="deposit"]');
    var wd = menu.querySelector('[data-ge-action="withdraw"]');
    var descBtn = menu.querySelector('[data-ge-action="description"]');
    var forceLoad = menu.querySelector('[data-ge-action="force-load"]');
    var animateBtn = menu.querySelector('[data-ge-action="animate"]');
    var trackBtn = menu.querySelector('[data-ge-action="track"]');
    var sellBtn = menu.querySelector('[data-ge-action="sell"]');
    var genBtn = menu.querySelector('[data-ge-action="generate"]');
    var genAllBtn = menu.querySelector('[data-ge-action="generate-all"]');
    if (dep) dep.hidden = source !== "inv";
    if (wd) wd.hidden = source !== "bank";
    if (descBtn) descBtn.hidden = isNote; // plain notes already text; ledgers editable
    if (forceLoad) forceLoad.hidden = isChip || isNote || isLed;
    if (animateBtn) animateBtn.hidden = isChip || isNote || isLed;
    if (sellBtn) sellBtn.hidden = isNote || isLed || isChip;
    if (genBtn) {
      genBtn.hidden = !isLed;
      genBtn.textContent = "Generate";
    }
    if (genAllBtn) {
      var pendingN = countPendingLedgers();
      genAllBtn.hidden = !(isLed && pendingN >= 1);
      genAllBtn.textContent =
        pendingN > 1 ? "Generate all (" + pendingN + ")" : "Generate all";
    }
    if (trackBtn) {
      trackBtn.hidden = false;
      trackBtn.textContent = isTracked(itemId) ? "Untrack" : "Track";
    }
    menu.hidden = false;
    // Position inside viewport
    var pad = 8;
    var w = menu.offsetWidth || 180;
    var h = menu.offsetHeight || 180;
    var x = Math.min(clientX, window.innerWidth - w - pad);
    var y = Math.min(clientY, window.innerHeight - h - pad);
    x = Math.max(pad, x);
    y = Math.max(pad, y);
    menu.style.left = x + "px";
    menu.style.top = y + "px";
    menu.dataset.openedAt = String(Date.now());
  }

  function placeNoteInForge(slot, title, prompt) {
    // Back-compat: placeNoteInForge(slot, promptOnly)
    if (prompt == null && title != null && arguments.length < 3) {
      prompt = title;
      title = "";
    }
    prompt = String(prompt || "").trim();
    title = String(title || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);
    if (!prompt) return { ok: false, error: "Write a prompt first." };
    if (!title) title = deriveNoteTitle(prompt);
    slot = Number(slot);
    if (slot < 0 || slot > 2 || isNaN(slot)) {
      return { ok: false, error: "Pick slot 1–3." };
    }
    if (!state.notes) state.notes = {};
    var id = Number(state.nextNoteId) || NOTE_BASE + 1;
    try {
      var rawShared = localStorage.getItem("spellforge_notes_v1");
      if (rawShared) {
        var shared = JSON.parse(rawShared);
        id = Math.max(id, Number(shared && shared.nextNoteId) || NOTE_BASE + 1);
      }
    } catch (eShared) {}
    state.nextNoteId = id + 1;
    var entry = {
      id: id,
      title: title || "Note",
      text: prompt,
      createdAt: Date.now(),
    };
    state.notes[String(id)] = entry;
    forgeSlots[slot] = id;
    syncNoteToSpellforgeStore(entry);
    saveState();
    return { ok: true, slot: slot, itemId: id };
  }

  function selectedForgeAspect() {
    var sel = $("ge-forge-aspect");
    var v = sel && sel.value ? String(sel.value) : "1:1";
    var ok = { "1:1": 1, "4:3": 1, "3:4": 1, "16:9": 1, "9:16": 1, "3:2": 1, "2:3": 1 };
    return ok[v] ? v : "1:1";
  }


  function hideGeLightbox() {
    var lb = $("ge-lightbox");
    if (lb) lb.hidden = true;
    closeGeColorPopover();
    var rich = $("ge-lightbox-desc-rich");
    if (rich) {
      rich.hidden = true;
      rich.innerHTML = "";
    }
    var plain = $("ge-lightbox-desc");
    if (plain) plain.hidden = false;
  }

  function openItemFullscreen(itemId) {
    itemId = Number(itemId);
    if (!itemId) return { ok: false, error: "No item." };
    // Color chips: show swatch + lock text in GE lightbox
    if (colorChipOf(itemId)) {
      var lbC = $("ge-lightbox");
      if (!lbC) return { ok: false, error: "Viewer missing." };
      var imgC = $("ge-lightbox-img");
      var noteC = $("ge-lightbox-note");
      if (noteC) {
        noteC.hidden = false;
        noteC.textContent = fullDescFor(itemId);
      }
      if (imgC) {
        imgC.hidden = false;
        imgC.src = thumb(itemId);
        imgC.alt = titleFor(itemId);
      }
      if ($("ge-lightbox-title")) $("ge-lightbox-title").textContent = kindLabel(itemId);
      if ($("ge-lightbox-desc")) $("ge-lightbox-desc").textContent = titleFor(itemId);
      lbC.hidden = false;
      return { ok: true };
    }
    // Paintings 1–1000: reuse gallery lightbox when available
    if (itemId >= 1 && itemId <= 1000 && typeof window.openLightbox === "function") {
      try {
        window.openLightbox(itemId);
        return { ok: true };
      } catch (e) {}
    }
    var lb = $("ge-lightbox");
    if (!lb) return { ok: false, error: "Viewer missing." };
    var img = $("ge-lightbox-img");
    var noteEl = $("ge-lightbox-note");
    var isNote = !!noteOf(itemId);
    if (isNote) {
      if (img) {
        img.hidden = true;
        img.removeAttribute("src");
      }
      if (noteEl) {
        noteEl.hidden = false;
        noteEl.textContent = fullDescFor(itemId) || titleFor(itemId);
      }
    } else {
      if (noteEl) {
        noteEl.hidden = true;
        noteEl.textContent = "";
      }
      if (img) {
        img.hidden = false;
        img.src = thumb(itemId);
        img.alt = titleFor(itemId);
      }
    }
    if ($("ge-lightbox-title")) $("ge-lightbox-title").textContent = kindLabel(itemId) + " · " + titleFor(itemId);
    if ($("ge-lightbox-desc")) $("ge-lightbox-desc").textContent = isNote ? "" : descFor(itemId);
    lb.hidden = false;
    return { ok: true };
  }

  var geAnimate = {
    busy: false,
    cancel: false,
    jobId: null,
  };

  function setGeAnimateStatus(msg, kind) {
    var el = $("ge-animate-status");
    if (!el) {
      setStatus(msg, kind === "err");
      return;
    }
    el.textContent = msg || "";
    el.className = "ge-animate-status" + (kind === "err" ? " err" : kind === "ok" ? " ok" : "");
  }

  function setGeAnimateProgress(pct) {
    var wrap = $("ge-animate-progress");
    var fill = $("ge-animate-progress-fill");
    if (!wrap || !fill) return;
    if (pct == null) {
      wrap.hidden = true;
      return;
    }
    wrap.hidden = false;
    fill.style.width = Math.max(4, Math.min(100, Number(pct) || 4)) + "%";
  }

  function geAnimateDuration() {
    var sel = $("ge-animate-dur");
    var n = sel ? Number(sel.value) : 15;
    if (n === 6 || n === 10 || n === 15) return n;
    return 15;
  }

  function persistableThumbUrl(url, parentFallback) {
    var thumb = String(url || "");
    var fallback = parentFallback ? "paintings/" + parentFallback + ".jpg" : "";
    if (!thumb) return fallback;
    // data URLs blow localStorage — never persist them
    if (thumb.indexOf("data:") === 0) return fallback;
    try {
      var u = new URL(thumb, location.href);
      // Same origin (incl. localhost/LAN): store path so reload still works
      if (typeof location !== "undefined" && u.origin === location.origin) {
        return u.pathname + u.search;
      }
    } catch (e) {}
    // Public https CDN urls are fine (up to a sane length)
    if (/^https:\/\//i.test(thumb) && thumb.length <= 1800) return thumb;
    if (thumb.length <= 400 && thumb.indexOf("http://") !== 0) return thumb;
    return fallback;
  }

  function geCompressDataUrl(dataUrl, maxSide, quality) {
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

  /** Inline a gallery/LAN image as a data URL so the cloud API does not need to fetch http://localhost. */
  function geInlineImage(path) {
    return new Promise(function (resolve, reject) {
      var url = String(path || "");
      if (!url) return reject(new Error("No image to inline."));
      if (url.indexOf("data:image") === 0) {
        return geCompressDataUrl(url, 1280, 0.85).then(resolve);
      }
      var fetchUrl = url;
      try {
        var u = new URL(url, location.href);
        if (u.origin === location.origin) fetchUrl = u.pathname + u.search;
      } catch (e) {}
      fetch(fetchUrl, { cache: "force-cache", credentials: "same-origin" })
        .then(function (r) {
          if (!r.ok) throw new Error("Could not load image (" + r.status + ").");
          return r.blob();
        })
        .then(function (blob) {
          return new Promise(function (res, rej) {
            var reader = new FileReader();
            reader.onload = function () {
              res(reader.result);
            };
            reader.onerror = function () {
              rej(new Error("Could not read image bytes."));
            };
            reader.readAsDataURL(blob);
          });
        })
        .then(function (dataUrl) {
          return geCompressDataUrl(dataUrl, 1280, 0.85);
        })
        .then(resolve)
        .catch(function (err) {
          reject(err || new Error("Could not inline reference image."));
        });
    });
  }

  function absoluteAssetUrl(path) {
    if (!path) return "";
    if (/^https?:\/\//i.test(path) || path.indexOf("data:") === 0) return path;
    try {
      return new URL(path, location.href).href;
    } catch (e) {
      return path;
    }
  }

  function pollGeAnimateJob(jobId, startedAt) {
    startedAt = startedAt || Date.now();
    if (geAnimate.cancel) return Promise.reject(new Error("Cancelled."));
    if (Date.now() - startedAt > 12 * 60 * 1000) {
      return Promise.reject(new Error("Timed out after 12 minutes."));
    }
    return fetch(geApiUrl("/api/jobs/" + encodeURIComponent(jobId)), { cache: "no-store" })
      .then(function (r) {
        return r.json().then(function (d) {
          return { ok: r.ok, status: r.status, d: d };
        });
      })
      .then(function (res) {
        if (geAnimate.cancel) return Promise.reject(new Error("Cancelled."));
        if (res.status === 404) throw new Error("Job lost — try again.");
        var d = res.d || {};
        var st = String(d.status || "").toLowerCase();
        var pct = d.progress_pct != null ? d.progress_pct : d.progress != null ? Number(d.progress) * 100 : null;
        if (pct == null) {
          var elapsed = Math.round((Date.now() - startedAt) / 1000);
          pct = Math.min(92, 8 + elapsed / 2);
        }
        setGeAnimateProgress(pct);
        setGeAnimateStatus("Animating… " + st + (d.elapsed_sec != null ? " · " + d.elapsed_sec + "s" : ""));
        if (st === "done" || st === "completed" || st === "success") {
          var vid = d.video || {};
          var url = vid.url || vid.download_url || vid.uri || d.url || "";
          if (url) return url;
          throw new Error("Job finished but no video URL.");
        }
        if (st === "failed" || st === "error" || st === "expired") {
          throw new Error((d.error && (d.error.message || d.error)) || "Video generation failed.");
        }
        var wait = st === "queued" ? 800 : 1500;
        return new Promise(function (resolve) {
          setTimeout(resolve, wait);
        }).then(function () {
          return pollGeAnimateJob(jobId, startedAt);
        });
      });
  }

  function showGeAnimateVideo(url) {
    var video = $("ge-animate-video");
    var still = $("ge-animate-still");
    if (still) still.hidden = true;
    if (!video) return;
    video.hidden = false;
    video.src = absoluteAssetUrl(url);
    video.controls = true;
    try {
      video.play();
    } catch (e) {}
  }

  function endGeAnimateBusy() {
    geAnimate.busy = false;
    geAnimate.jobId = null;
    var cancel = $("ge-animate-cancel");
    if (cancel) cancel.hidden = true;
  }

  function startGeAnimateForItem(itemId, directionOpt) {
    itemId = Number(itemId);
    if (!itemId) return { ok: false, error: "No item." };
    if (geAnimate.busy) return { ok: false, error: "Already animating — wait or Cancel." };
    if (noteOf(itemId)) {
      return { ok: false, error: "Notes are text fillers — pick an image item to animate." };
    }
    if (colorChipOf(itemId)) {
      return { ok: false, error: "Color chips are pigments — insert into note or forge slots." };
    }
    if (!exchangeOpen) openExchangeUi();

    var direction = String(directionOpt || "").trim();
    var prompt = geSoftenPrompt(
      "Cinematic subtle motion of this artwork. Keep composition and subject identity. " +
        String(titleFor(itemId) || "") +
        (direction ? " Animation direction: " + direction : "")
    );
    var stasis = geSoftenPrompt(
      (
        String(fullDescFor(itemId) || descFor(itemId) || titleFor(itemId) || "").trim() +
        (direction ? "\n\nAnimation direction (optional user notes): " + direction : "")
      ).trim()
    );
    if (stasis.length > 3500) stasis = stasis.slice(0, 3500);
    var aspect = selectedForgeAspect();
    var duration = geAnimateDuration();
    var spells = itemId >= 1 && itemId <= 1000 ? [itemId] : [];
    var stillUrl = thumb(itemId);

    var still = $("ge-animate-still");
    var video = $("ge-animate-video");
    if (video) {
      video.hidden = true;
      video.removeAttribute("src");
    }
    if (still) {
      still.hidden = false;
      still.src = stillUrl;
      still.alt = titleFor(itemId);
    }

    geAnimate.busy = true;
    geAnimate.cancel = false;
    var cancelBtn = $("ge-animate-cancel");
    if (cancelBtn) cancelBtn.hidden = false;
    setGeAnimateProgress(4);
    setGeAnimateStatus("Inlining reference image…");
    setStatus("Animating in Grand Exchange — stay here while it processes.");

    geInlineImage(stillUrl)
      .then(function (dataUrl) {
        if (geAnimate.cancel) throw new Error("Cancelled.");
        if (!dataUrl || String(dataUrl).indexOf("data:image") !== 0) {
          throw new Error(
            "Reference image could not be inlined — reload the page and try again (keep start_server.bat running)."
          );
        }
        setGeAnimateProgress(8);
        setGeAnimateStatus("Starting animation of " + kindLabel(itemId) + " (" + duration + "s)…");
        var body = {
          stasis: stasis || prompt,
          prompt: prompt,
          duration: duration,
          spells: spells,
          resolution: "720p",
          morph_chain: false,
          video_url: "",
          aspect_ratio: aspect === "1:1" ? "16:9" : aspect,
          source: "grand-exchange",
          // data URL — cloud API must not try to fetch localhost/LAN http URLs
          reference_image: dataUrl,
        };
        return fetch(geApiUrl("/api/animate-cast"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          cache: "no-store",
        });
      })
      .then(function (r) {
        return r.json().then(function (d) {
          return { ok: r.ok, status: r.status, d: d };
        });
      })
      .then(function (res) {
        if (geAnimate.cancel) throw new Error("Cancelled.");
        var d = res.d || {};
        if (!res.ok) {
          throw new Error((d.error && (d.error.message || d.error)) || "Animate cast failed.");
        }
        if (res.status === 202 && d.job_id) {
          geAnimate.jobId = d.job_id;
          return pollGeAnimateJob(d.job_id);
        }
        var vid = d.video || {};
        var url = vid.url || vid.download_url || vid.uri || "";
        if (url) return url;
        if (d.job_id) {
          geAnimate.jobId = d.job_id;
          return pollGeAnimateJob(d.job_id);
        }
        throw new Error("No job id returned.");
      })
      .then(function (url) {
        endGeAnimateBusy();
        setGeAnimateProgress(100);
        showGeAnimateVideo(url);
        setGeAnimateStatus("Done — playing clip in Grand Exchange.", "ok");
        setStatus("Animation ready in GE.");
        try {
          grantXp(Math.max(10, Math.round(FORGE_XP / 2)));
        } catch (eXp) {}
      })
      .catch(function (err) {
        endGeAnimateBusy();
        setGeAnimateProgress(null);
        var msg = (err && err.message) || String(err || "failed");
        setGeAnimateStatus(msg, "err");
        setStatus("GE animate failed: " + msg, true);
      });

    return { ok: true };
  }

  function cancelGeAnimate() {
    geAnimate.cancel = true;
    setGeAnimateStatus("Cancelling…");
    endGeAnimateBusy();
    setGeAnimateProgress(null);
    setGeAnimateStatus("Cancelled.", "err");
  }

  var geAnimatePromptPending = null;

  function hideGeAnimatePrompt() {
    var modal = $("ge-animate-prompt");
    if (modal) modal.hidden = true;
    geAnimatePromptPending = null;
  }

  function openGeAnimatePrompt(itemId) {
    itemId = Number(itemId);
    if (!itemId) return Promise.resolve({ ok: false, cancelled: true, error: "No item." });
    if (geAnimate.busy) {
      return Promise.resolve({ ok: false, error: "Already animating — wait or Cancel." });
    }
    if (noteOf(itemId)) {
      return Promise.resolve({
        ok: false,
        error: "Notes are text fillers — pick an image item to animate.",
      });
    }
    var modal = $("ge-animate-prompt");
    var ta = $("ge-animate-direction");
    var lead = $("ge-animate-prompt-lead");
    if (!modal || !ta) {
      // Fallback if HTML missing — start with no direction
      return Promise.resolve({ ok: true, direction: "", itemId: itemId });
    }
    if (lead) {
      lead.textContent =
        "Optional direction for " +
        kindLabel(itemId) +
        " — leave blank for default motion.";
    }
    // Keep last typed direction as convenience; still optional
    modal.hidden = false;
    ta.focus();
    try {
      ta.setSelectionRange(ta.value.length, ta.value.length);
    } catch (e) {}

    return new Promise(function (resolve) {
      geAnimatePromptPending = {
        itemId: itemId,
        resolve: resolve,
      };
    });
  }

  function confirmGeAnimatePrompt() {
    if (!geAnimatePromptPending) return;
    var pending = geAnimatePromptPending;
    var ta = $("ge-animate-direction");
    var direction = ta ? String(ta.value || "").trim() : "";
    hideGeAnimatePrompt();
    pending.resolve({ ok: true, direction: direction, itemId: pending.itemId });
  }

  function cancelGeAnimatePrompt() {
    if (!geAnimatePromptPending) {
      hideGeAnimatePrompt();
      return;
    }
    var pending = geAnimatePromptPending;
    hideGeAnimatePrompt();
    pending.resolve({ ok: false, cancelled: true, error: "Cancelled." });
  }

  function sendItemToAnimate(itemId) {
    return openGeAnimatePrompt(itemId).then(function (res) {
      if (!res || !res.ok) {
        if (res && res.cancelled) return { ok: false, error: "Cancelled." };
        return { ok: false, error: (res && res.error) || "Cancelled." };
      }
      return startGeAnimateForItem(res.itemId, res.direction);
    });
  }

  function openSellForItem(itemId) {
    itemId = Number(itemId);
    if (!itemId) return { ok: false, error: "No item." };
    if (noteOf(itemId)) return { ok: false, error: "Notes are forge fillers — not sellable on GE." };
    var invHave = qtyOf(PLAYER_ID, itemId);
    var bankHave = bankQty(PLAYER_ID, itemId);
    if (invHave < 1 && bankHave < 1) {
      return { ok: false, error: "You do not own that item." };
    }
    if (invHave < 1 && bankHave > 0) {
      var wd = withdrawItem(itemId, 1);
      if (!wd.ok) {
        // Inventory full — still open sell UI with selection; user can free a slot.
        selected = itemId;
        openSetup("sell", 0);
        return {
          ok: false,
          error: wd.error + " Selected for sell — free inventory space or sell after withdrawing.",
        };
      }
    }
    selected = itemId;
    openSetup("sell", 0);
    return { ok: true };
  }

  function openAnimateTab() {
    var tab = document.querySelector('.tab[data-tab="animate"]');
    if (tab) {
      tab.click();
      return true;
    }
    try {
      window.dispatchEvent(new Event("animate-show"));
    } catch (e) {}
    return false;
  }

  function sendForgeResultToAnimate() {
    if (!lastForgeResult) {
      setForgeStatus("No forged result to animate.", true);
      return;
    }
    sendItemToAnimate(lastForgeResult).then(function (res) {
      if (!res) return;
      if (!res.ok) {
        if (res.error && res.error !== "Cancelled.") setForgeStatus(res.error, true);
        return;
      }
      setForgeStatus("Animating forged #" + lastForgeResult + " in Grand Exchange…");
    });
  }

  function clearForgeSlot(slotIndex) {
    slotIndex = Number(slotIndex);
    if (slotIndex < 0 || slotIndex > 2) return;
    forgeSlots[slotIndex] = null;
    renderForgeSlots();
    setForgeStatus("Cleared Spellforge slot " + (slotIndex + 1) + ".");
  }

  function showForgeResult(id) {
    var panel = $("ge-forge-result");
    if (!panel) return;
    panel.hidden = false;
    id = Number(id);
    var f = forgedOf(id);
    var pending = !!(f && f.pendingGenerate) || pendingGenerateId === id;
    panel.classList.toggle("ge-forge-ready", pending);
    if ($("ge-forge-result-img")) {
      $("ge-forge-result-img").src = thumb(id);
      $("ge-forge-result-img").alt = titleFor(id);
    }
    if ($("ge-forge-result-title")) {
      $("ge-forge-result-title").textContent =
        titleFor(id) + (pending ? " · ready to generate" : "");
    }
    var body = String(fullDescFor(id) || "").trim();
    if ($("ge-forge-result-desc")) {
      $("ge-forge-result-desc").textContent = body ? body.slice(0, 160) : descFor(id);
    }
    var ta = $("ge-forge-result-desc-edit");
    if (ta && document.activeElement !== ta) {
      ta.value = body;
    }
    var genBtn = $("ge-forge-result-generate");
    if (genBtn) genBtn.hidden = !pending;
    var hint = $("ge-forge-ready-hint");
    if (hint) hint.hidden = !pending;
    var animBtn = $("ge-forge-to-animate");
    if (animBtn) animBtn.disabled = !!pending && !(f && f.imageUrl);
  }

  function hideForgeResult() {
    var panel = $("ge-forge-result");
    if (panel) {
      panel.hidden = true;
      panel.classList.remove("ge-forge-ready");
    }
    var hint = $("ge-forge-ready-hint");
    if (hint) hint.hidden = true;
    var genBtn = $("ge-forge-result-generate");
    if (genBtn) genBtn.hidden = true;
  }

  function saveForgeResultDescription() {
    if (!lastForgeResult) {
      setForgeStatus("No forged result to edit.", true);
      return false;
    }
    var ta = $("ge-forge-result-desc-edit");
    if (!ta) return false;
    var itemId = Number(lastForgeResult);
    if (!state.descOverrides) state.descOverrides = {};
    var text = String(ta.value || "");
    var orig = originalDescFor(itemId);
    if (text === orig) {
      delete state.descOverrides[String(itemId)];
    } else {
      state.descOverrides[String(itemId)] = text;
    }
    var f = forgedOf(itemId);
    if (f) {
      if (f._originalDescription == null) {
        f._originalDescription = String(f.description || orig || "");
      }
      // Always keep forged.description as the live callback wording.
      f.description = text;
    }
    saveState();
    showForgeResult(itemId);
    setForgeStatus("Description saved for #" + itemId + " — callbacks will use your wording.");
    return true;
  }

  function openSpellforgeTab() {
    try {
      var geAspect = selectedForgeAspect();
      var spellAspect = document.getElementById("spell-aspect");
      if (spellAspect && geAspect) spellAspect.value = geAspect;
    } catch (eAsp) {}
    var tab = document.querySelector('.tab[data-tab="spellforge"]');
    if (tab) {
      tab.click();
      // Sync after the Spellforge tab is visible so renderSlots paints into a live panel.
      setTimeout(function () {
        try {
          syncForgeToSpellforge();
          if (window.SpellforgeAPI && typeof window.SpellforgeAPI.refresh === "function") {
            window.SpellforgeAPI.refresh();
          }
        } catch (e) {}
      }, 50);
      return;
    }
    try {
      syncForgeToSpellforge();
      window.dispatchEvent(new Event("spellforge-show"));
    } catch (e) {}
  }

  var forgeBusy = false;

  function geApiUrl(path) {
    try {
      if (window.SpellforgeAPI && typeof window.SpellforgeAPI.apiUrl === "function") {
        return window.SpellforgeAPI.apiUrl(path);
      }
    } catch (e) {}
    return path;
  }


  function geAutoSoftenOn() {
    var el = $("ge-auto-soften");
    if (el) return !!el.checked;
    try {
      var v = localStorage.getItem("spellforge_auto_soften_v1");
      if (v == null) return true;
      return v !== "0" && v !== "false";
    } catch (e) {
      return true;
    }
  }

  function geSoftenPrompt(text) {
    if (!geAutoSoftenOn()) return String(text || "");
    try {
      if (window.SpellforgeAPI && typeof window.SpellforgeAPI.softenPromptForModeration === "function") {
        return window.SpellforgeAPI.softenPromptForModeration(text);
      }
    } catch (e) {}
    // Lightweight fallback if Spellforge not loaded
    var s = String(text || "");
    s = s.replace(/\b(porn|nude|naked|nsfw|gore|rape|underage|lolita)\b/gi, "art study");
    s = s.replace(/\b(batman|superman|spiderman|marvel|disney|pokemon)\b/gi, "heroic figure");
    return s;
  }

  function buildForgePrompt(parents) {
    var lines = [
      "Create a brand-new original painting that fuses these three influences into one fresh composition.",
      "This is NOT a remake, collage, or near-copy of any source.",
    ];
    parents.forEach(function (id, idx) {
      if (colorChipOf(id)) {
        lines.push(
          "COLOR LOCK " +
            (idx + 1) +
            ": " +
            String(fullDescFor(id) || "").trim()
        );
        return;
      }
      lines.push(
        "Influence " +
          (idx + 1) +
          " (" +
          kindLabel(id) +
          " — " +
          titleFor(id) +
          "): " +
          String(fullDescFor(id) || descFor(id) || "").trim()
      );
    });
    lines.push("Invented scene · original painting · cohesive style.");
    var prompt = lines.filter(Boolean).join("\n\n");
    prompt = geSoftenPrompt(prompt);
    if (prompt.length > 7000) prompt = prompt.slice(0, 7000);
    return prompt;
  }

  function pollForgeJob(jobId, attemptsLeft) {
    attemptsLeft = attemptsLeft == null ? 120 : attemptsLeft;
    if (attemptsLeft <= 0) return Promise.reject(new Error("Timed out waiting for generated image."));
    return fetch(geApiUrl("/api/jobs/" + encodeURIComponent(jobId)), { cache: "no-store" })
      .then(function (r) {
        return r.json().then(function (d) {
          return { ok: r.ok, d: d };
        });
      })
      .then(function (res) {
        var d = res.d || {};
        var st = String(d.status || "").toLowerCase();
        if (st === "done" || st === "completed" || st === "success") {
          var img = d.image || (d.images && d.images[0]);
          var url = (img && img.url) || d.url || d.image_url || "";
          if (url) return url;
          throw new Error("Job finished but no image URL.");
        }
        if (st === "failed" || st === "error") {
          throw new Error((d.error && d.error.message) || d.error || "Generate job failed.");
        }
        setForgeStatus("Generating image… (" + (121 - attemptsLeft) + "s)");
        return new Promise(function (resolve) {
          setTimeout(resolve, 1000);
        }).then(function () {
          return pollForgeJob(jobId, attemptsLeft - 1);
        });
      });
  }

  function generateForgeImage(parents, prompt) {
    var spellIds = parents.filter(function (id) {
      return id >= 1 && id <= 1000;
    });
    var spellDetails = parents.map(function (n, s) {
      return {
        number: n,
        title: titleFor(n),
        description: String(fullDescFor(n) || "").slice(0, 1800),
        prompt: String(descFor(n) || "").slice(0, 800),
        source: "influence-text",
        slot: s,
      };
    });
    var jobId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : "ge-forge-" + Date.now();
    return fetch(geApiUrl("/api/generate-stasis-vision"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        job_id: jobId,
        stasis: prompt,
        prompt: prompt,
        fused_prompt: prompt,
        buzz_words: ["original painting", "brand new composition", "invented scene"],
        spells: spellIds,
        spell_details: spellDetails,
        aspect_ratio: selectedForgeAspect(),
        mag_fresh: true,
        fresh_variation: true,
        spell_cast: false,
        attach_references: false,
        reference_image: "",
        spell_reference_image: "",
        source: "grand-exchange-forge",
        product_mode: "original_fusion",
      }),
      cache: "no-store",
    }).then(function (r) {
      return r.json().then(function (d) {
        if (r.status === 202 || (d && (d.status === "queued" || d.status === "pending") && d.job_id)) {
          return pollForgeJob(d.job_id || jobId);
        }
        if (!r.ok) {
          var errMsg =
            (d && d.error && d.error.message) || (d && d.error) || "Generate failed (HTTP " + r.status + ")";
          throw new Error(typeof errMsg === "string" ? errMsg : JSON.stringify(errMsg));
        }
        var img = d && (d.image || (d.images && d.images[0]));
        if (img && img.url) return img.url;
        if (d && d.job_id) return pollForgeJob(d.job_id);
        throw new Error("No image returned from generate.");
      });
    });
  }

  function imaginativeForgeTitle(parents) {
    var bits = parents.map(function (id) {
      return String(titleFor(id) || kindLabel(id) || "#" + id)
        .replace(/\s+/g, " ")
        .trim()
        .split(" ")[0];
    });
    var recipes = [
      bits[0] + " dreams of " + bits[1] + " under " + bits[2],
      "Echo of " + bits.join(" · "),
      bits[1] + " wearing " + bits[0] + "'s " + bits[2],
      "Midnight pact: " + bits[0] + " × " + bits[2],
      "Unlikely chorus of " + bits.join(", "),
      bits[2] + " remembers " + bits[0] + " & " + bits[1],
      "Forge hymn — " + bits.join("/"),
      "What if " + bits[0] + " met " + bits[1] + " inside " + bits[2] + "?",
    ];
    return recipes[Math.floor(Math.random() * recipes.length)].slice(0, 160);
  }

  function imaginativeForgeDescription(parents, title) {
    var lines = parents.map(function (id, idx) {
      var d = String(fullDescFor(id) || descFor(id) || "").trim().slice(0, 220);
      return (
        "Voice " +
        (idx + 1) +
        " (" +
        kindLabel(id) +
        " — " +
        titleFor(id) +
        "): " +
        (d || "silent influence")
      );
    });
    var flourishes = [
      "Let the scene argue with itself until a single painting wins.",
      "Keep the light strange; keep the story kind.",
      "Invent architecture that could only exist after these three collided.",
      "No collage — one continuous world, newly born.",
      "The callback should feel like a whispered rumor between the parents.",
    ];
    return (
      (title || "Forged piece") +
      ". " +
      flourishes[Math.floor(Math.random() * flourishes.length)] +
      "\n\n" +
      lines.join("\n")
    ).slice(0, 4000);
  }

  function buildForgePromptForItem(itemId) {
    itemId = Number(itemId);
    var f = forgedOf(itemId);
    var parents = f && Array.isArray(f.parents) ? f.parents.map(Number) : [];
    var base = parents.length ? buildForgePrompt(parents) : "";
    var edited =
      state && state.descOverrides && state.descOverrides[String(itemId)] != null
        ? String(state.descOverrides[String(itemId)] || "").trim()
        : "";
    var live = f ? String(f.description || "").trim() : "";
    var direction = edited || (f && f.pendingGenerate ? live : "");
    if (direction) {
      var prompt =
        "Primary artistic direction (artist-authored callback — honor this wording):\n" +
        direction +
        (base ? "\n\nSupporting influences:\n" + base : "");
      prompt = geSoftenPrompt(prompt);
      if (prompt.length > 7000) prompt = prompt.slice(0, 7000);
      return prompt;
    }
    return base || geSoftenPrompt(live || "Original forged painting.");
  }

  function consumeForgeParents(parents) {
    for (var j = 0; j < parents.length; j++) {
      if (noteOf(parents[j]) || colorChipOf(parents[j])) continue;
      if (!consumeOwned(parents[j], 1)) return false;
    }
    return true;
  }

  function listPendingLedgers() {
    var out = [];
    if (!state || !state.notes) return out;
    Object.keys(state.notes).forEach(function (k) {
      var n = state.notes[k];
      if (!n || !isLedgerNote(n)) return;
      if (n.pendingGenerate === false) return;
      var id = Number(n.id != null ? n.id : k);
      if (!id) return;
      if (ownedQty(id) < 1) return;
      out.push(id);
    });
    out.sort(function (a, b) { return a - b; });
    return out;
  }

  function countPendingLedgers() {
    return listPendingLedgers().length;
  }

  function refreshAutoForgeLedgerStatus(extra) {
    var n = countPendingLedgers();
    var msg =
      n <= 0
        ? "ledger ready · 0 pending"
        : n === 1
          ? "1 ledger ready"
          : n + " ledgers ready";
    if (extra) msg = extra + " · " + msg;
    setAutoForgeStatus(msg);
    return n;
  }

  function allocateNoteId() {
    if (!state.notes) state.notes = {};
    var id = Number(state.nextNoteId) || NOTE_BASE + 1;
    try {
      var rawShared = localStorage.getItem("spellforge_notes_v1");
      if (rawShared) {
        var shared = JSON.parse(rawShared);
        id = Math.max(id, Number(shared && shared.nextNoteId) || NOTE_BASE + 1);
      }
    } catch (eShared) {}
    state.nextNoteId = id + 1;
    return id;
  }

  function removeLedgerItem(itemId) {
    itemId = Number(itemId);
    if (!itemId) return;
    try {
      consumeOwned(itemId, ownedQty(itemId) || 1);
    } catch (eCons) {}
    if (state.notes) delete state.notes[String(itemId)];
    if (state.descOverrides) delete state.descOverrides[String(itemId)];
    try {
      var raw = localStorage.getItem("spellforge_notes_v1");
      if (raw) {
        var store = JSON.parse(raw);
        if (store && store.notes) {
          delete store.notes[String(itemId)];
          localStorage.setItem("spellforge_notes_v1", JSON.stringify(store));
        }
      }
    } catch (eSync) {}
  }

  function buildLedgerPrompt(itemId) {
    itemId = Number(itemId);
    var led = ledgerOf(itemId);
    if (!led) return "";
    var composition = String(notePromptOf(led) || "").trim();
    var edited =
      state && state.descOverrides && state.descOverrides[String(itemId)] != null
        ? String(state.descOverrides[String(itemId)] || "").trim()
        : "";
    var direction = edited || String(led.description || "").trim();
    var prompt;
    if (direction && composition && direction !== composition) {
      prompt =
        "Primary artistic direction (artist-authored ledger — honor this wording):\n" +
        direction +
        "\n\nCombined composition prompt:\n" +
        composition;
    } else {
      prompt = direction || composition || "Original forged painting from prompt ledger.";
    }
    prompt = geSoftenPrompt(prompt);
    if (prompt.length > 7000) prompt = prompt.slice(0, 7000);
    return prompt;
  }

  /** Auto-forge output: mint a prompt ledger (note) with combined composition — no forge wait, no image API. */
  function mintForgeLedger(opts) {
    opts = opts || {};
    if (forgeBusy) return { ok: false, error: "Already combining — wait…" };
    var a = forgeSlots[0];
    var b = forgeSlots[1];
    var c = forgeSlots[2];
    if (a == null || b == null || c == null) {
      return { ok: false, error: "Fill all 3 Spellforge slots before pairing." };
    }
    var parents = [Number(a), Number(b), Number(c)];
    for (var i = 0; i < 3; i++) {
      if (noteOf(parents[i]) || colorChipOf(parents[i])) continue;
      if (ownedQty(parents[i]) < 1) {
        return {
          ok: false,
          error: "Missing stock for " + kindLabel(parents[i]) + " (need 1 in inv or bank).",
        };
      }
    }
    if (!exchangeOpen) openExchangeUi();

    var title =
      opts.title ||
      (opts.imaginative ? imaginativeForgeTitle(parents) : parents.map(titleFor).join(" / "));
    var description;
    if (opts.description != null) {
      description = String(opts.description);
    } else if (opts.imaginative) {
      description = imaginativeForgeDescription(parents, title);
    } else {
      description =
        parents
          .map(fullDescFor)
          .map(function (d) {
            return String(d || "").trim();
          })
          .filter(Boolean)
          .join(" ") +
        " Forged amalgam of " +
        parents.map(kindLabel).join(", ") +
        ".";
    }
    var composition =
      opts.composition != null ? String(opts.composition) : buildForgePrompt(parents);

    if (!consumeForgeParents(parents)) {
      return { ok: false, error: "Could not consume materials after pairing." };
    }

    var id = allocateNoteId();
    var entry = {
      id: id,
      title: String(title || "Prompt ledger").slice(0, 80),
      text: String(composition || "").slice(0, PERSIST_NOTE_TEXT_MAX),
      description: String(description || "").slice(0, PERSIST_NOTE_DESC_MAX),
      kind: "ledger",
      isLedger: true,
      pendingGenerate: true,
      parents: parents.slice(),
      guide: Math.max(
        1,
        Math.round((guidePrice(parents[0]) + guidePrice(parents[1]) + guidePrice(parents[2])) / 2)
      ),
      createdAt: Date.now(),
    };
    if (!state.notes) state.notes = {};
    state.notes[String(id)] = entry;
    syncNoteToSpellforgeStore(entry);
    if (inventoryCount(PLAYER_ID) >= INV_SLOTS) {
      // Prefer bank when pack is full so Auto-forge can keep minting ledgers.
      addBank(PLAYER_ID, id, 1);
    } else {
      addInv(PLAYER_ID, id, 1);
    }
    forgeSlots = [null, null, null];
    renderForgeSlots();
    hideForgeResult();
    pendingGenerateId = null;
    grantXp(Math.max(8, Math.round(FORGE_XP / 3)));
    if (opts.imaginative || opts.trackTopics !== false) {
      rememberForgeTopics(parents, title, description);
    }
    render();
    saveState();
    var ready = refreshAutoForgeLedgerStatus("paired");
    setForgeStatus(
      "Ledger #" +
        id +
        " ready — combined prompt saved. Edit description anytime; right-click Generate or Generate all. (" +
        ready +
        " pending)"
    );
    return { ok: true, id: id, entry: entry };
  }

  function generateLedgerNow(itemId) {
    itemId = Number(itemId);
    var led = ledgerOf(itemId);
    if (!led) {
      setForgeStatus("No prompt ledger to generate.", true);
      return Promise.resolve({ ok: false, error: "No ledger." });
    }
    if (forgeBusy) {
      setForgeStatus("Already generating…", true);
      return Promise.resolve({ ok: false, error: "Busy." });
    }
    var parents = Array.isArray(led.parents) ? led.parents.map(Number) : [];
    var prompt = buildLedgerPrompt(itemId);
    if (!prompt) {
      setForgeStatus("Ledger #" + itemId + " has an empty prompt.", true);
      return Promise.resolve({ ok: false, error: "Empty prompt." });
    }
    forgeBusy = true;
    setForgeStatus("Generating from ledger #" + itemId + "…");
    setAutoForgeStatus("generating ledger #" + itemId + "…");
    var genParents = parents.length ? parents : [itemId];
    return generateForgeImage(genParents, prompt)
      .then(function (url) {
        forgeBusy = false;
        var forgeId = Number(state.nextForgeId) || 10001;
        state.nextForgeId = forgeId + 1;
        var entry = {
          id: forgeId,
          parents: parents.slice(),
          title: noteTitleOf(led),
          description: String(
            (state.descOverrides && state.descOverrides[String(itemId)] != null
              ? state.descOverrides[String(itemId)]
              : led.description) ||
              notePromptOf(led) ||
              ""
          ).slice(0, 4000),
          thumb: url || (parents[0] ? thumb(parents[0]) : LEDGER_THUMB),
          guide: led.guide != null ? led.guide : autoGuide(forgeId),
          createdAt: Date.now(),
          pendingGenerate: false,
          fromLedger: itemId,
        };
        if (url) {
          entry.imageUrl = url;
          entry.thumb = url;
          thumbOverrides[String(forgeId)] = assetUrl(url);
        }
        if (!state.forged) state.forged = {};
        state.forged[String(forgeId)] = entry;
        removeLedgerItem(itemId);
        addInv(PLAYER_ID, forgeId, 1);
        lastForgeResult = forgeId;
        grantXp(Math.max(10, Math.round(FORGE_XP / 2)));
        showForgeResult(forgeId);
        render();
        saveState();
        refreshAutoForgeLedgerStatus();
        setForgeStatus(
          url
            ? "Generated #" + forgeId + " from ledger #" + itemId + "."
            : "Generate returned no URL for ledger #" + itemId + ".",
          !url
        );
        if (state.autoForge) scheduleAutoForge(900);
        return { ok: !!url, id: forgeId, ledgerId: itemId, url: url || "" };
      })
      .catch(function (err) {
        forgeBusy = false;
        var msg = (err && err.message) || String(err || "generate failed");
        setForgeStatus("Generate failed for ledger #" + itemId + ": " + msg, true);
        refreshAutoForgeLedgerStatus();
        return { ok: false, error: msg };
      });
  }

  /** Queue Generate on every pending ledger (inv/bank). One at a time — no silent auto-fire. */
  function generateAllLedgers() {
    var ids = listPendingLedgers();
    if (!ids.length) {
      setForgeStatus("No pending ledgers to generate.", true);
      refreshAutoForgeLedgerStatus();
      return Promise.resolve({ ok: false, error: "None.", done: 0 });
    }
    if (forgeBusy) {
      setForgeStatus("Already generating…", true);
      return Promise.resolve({ ok: false, error: "Busy.", done: 0 });
    }
    setForgeStatus("Generate all — " + ids.length + " ledger(s) queued…");
    var chain = Promise.resolve({ ok: true, done: 0, results: [] });
    ids.forEach(function (id) {
      chain = chain.then(function (acc) {
        return generateLedgerNow(id).then(function (res) {
          acc.results.push(res);
          if (res && res.ok) acc.done += 1;
          return acc;
        });
      });
    });
    return chain.then(function (acc) {
      refreshAutoForgeLedgerStatus();
      setForgeStatus(
        "Generate all finished — " + acc.done + " / " + ids.length + " succeeded."
      );
      return acc;
    });
  }

  /** Pair/combine without calling image generation. Leaves pendingGenerate for Logan. */
  function prepareForgeCombine(opts) {
    opts = opts || {};
    if (forgeBusy) return { ok: false, error: "Already combining — wait…" };
    var a = forgeSlots[0];
    var b = forgeSlots[1];
    var c = forgeSlots[2];
    if (a == null || b == null || c == null) {
      return { ok: false, error: "Fill all 3 Spellforge slots before combining." };
    }
    var parents = [Number(a), Number(b), Number(c)];
    for (var i = 0; i < 3; i++) {
      if (noteOf(parents[i]) || colorChipOf(parents[i])) continue;
      if (ownedQty(parents[i]) < 1) {
        return {
          ok: false,
          error: "Missing stock for " + kindLabel(parents[i]) + " (need 1 in inv or bank).",
        };
      }
    }
    if (!exchangeOpen) openExchangeUi();

    var title =
      opts.title ||
      (opts.imaginative ? imaginativeForgeTitle(parents) : parents.map(titleFor).join(" / "));
    var description;
    if (opts.description != null) {
      description = String(opts.description);
    } else if (opts.imaginative) {
      description = imaginativeForgeDescription(parents, title);
    } else {
      description =
        parents
          .map(fullDescFor)
          .map(function (d) {
            return String(d || "").trim();
          })
          .filter(Boolean)
          .join(" ") +
        " Forged amalgam of " +
        parents.map(kindLabel).join(", ") +
        ".";
    }

    var id = Number(state.nextForgeId) || 10001;
    state.nextForgeId = id + 1;
    var entry = {
      id: id,
      parents: parents.slice(),
      title: title,
      description: description,
      thumb: thumb(parents[0]),
      guide: Math.max(
        1,
        Math.round((guidePrice(parents[0]) + guidePrice(parents[1]) + guidePrice(parents[2])) / 2)
      ),
      createdAt: Date.now(),
      pendingGenerate: true,
    };
    if (!state.forged) state.forged = {};
    state.forged[String(id)] = entry;
    if (!consumeForgeParents(parents)) {
      delete state.forged[String(id)];
      return { ok: false, error: "Could not consume materials after forge." };
    }
    addInv(PLAYER_ID, id, 1);
    forgeSlots = [null, null, null];
    lastForgeResult = id;
    pendingGenerateId = id;
    grantXp(Math.max(10, Math.round(FORGE_XP / 2)));
    showForgeResult(id);
    render();
    saveState();
    if (opts.imaginative || opts.trackTopics !== false) {
      rememberForgeTopics(parents, title, description);
    }
    setForgeStatus(
      "Paired #" +
        id +
        " — ready to generate. Prefer Auto-forge ledgers + right-click Generate; this panel Generate still works."
    );
    refreshAutoForgeLedgerStatus();
    return { ok: true, id: id, entry: entry };
  }

  function generateForgedNow(itemId) {
    itemId = Number(itemId || lastForgeResult || pendingGenerateId);
    var f = forgedOf(itemId);
    if (!f) {
      setForgeStatus("No forged piece to generate.", true);
      return Promise.resolve({ ok: false, error: "No forged piece." });
    }
    if (forgeBusy) {
      setForgeStatus("Already generating…", true);
      return Promise.resolve({ ok: false, error: "Busy." });
    }
    // Persist any in-panel wording before gen so callbacks stick.
    if (lastForgeResult === itemId) saveForgeResultDescription();
    var parents = (f.parents || []).map(Number);
    if (parents.length < 1) {
      setForgeStatus("No forge parents saved — cannot generate.", true);
      return Promise.resolve({ ok: false, error: "No parents." });
    }
    var prompt = buildForgePromptForItem(itemId);
    forgeBusy = true;
    var combineBtn = $("ge-forge-combine");
    var genBtn = $("ge-forge-result-generate");
    if (combineBtn) combineBtn.disabled = true;
    if (genBtn) genBtn.disabled = true;
    setForgeStatus("Generating image for #" + itemId + " (your wording drives the callback)…");
    refreshAutoForgeLedgerStatus("generating…");
    return generateForgeImage(parents, prompt)
      .then(function (url) {
        forgeBusy = false;
        if (combineBtn) combineBtn.disabled = false;
        if (genBtn) genBtn.disabled = false;
        if (url) {
          f.imageUrl = url;
          f.thumb = url;
          thumbOverrides[String(itemId)] = assetUrl(url);
        }
        f.pendingGenerate = false;
        if (pendingGenerateId === itemId) pendingGenerateId = null;
        // Never overwrite artist-authored description on success.
        if (state.descOverrides && state.descOverrides[String(itemId)] != null) {
          f.description = String(state.descOverrides[String(itemId)]);
        }
        grantXp(Math.max(10, Math.round(FORGE_XP / 2)));
        lastForgeResult = itemId;
        showForgeResult(itemId);
        render();
        saveState();
        setForgeStatus(
          url
            ? "Generated #" + itemId + " — description kept as you worded it."
            : "Generate returned no URL for #" + itemId + ".",
          !url
        );
        if (state.autoForge) scheduleAutoForge(900);
        return { ok: !!url, id: itemId, url: url || "" };
      })
      .catch(function (err) {
        forgeBusy = false;
        if (combineBtn) combineBtn.disabled = false;
        if (genBtn) genBtn.disabled = false;
        var msg = (err && err.message) || String(err || "generate failed");
        setForgeStatus("Generate failed for #" + itemId + ": " + msg, true);
        return { ok: false, error: msg };
      });
  }

  function combineForge() {
    if (forgeBusy) {
      setForgeStatus("Already combining — wait for the image…", true);
      return;
    }
    // Manual Combine still generates. Auto-forge uses prepareForgeCombine instead.
    var a = forgeSlots[0];
    var b = forgeSlots[1];
    var c = forgeSlots[2];
    if (a == null || b == null || c == null) {
      setForgeStatus("Fill all 3 Spellforge slots before combining.", true);
      return;
    }
    var parents = [Number(a), Number(b), Number(c)];
    for (var i = 0; i < 3; i++) {
      if (noteOf(parents[i]) || colorChipOf(parents[i])) continue;
      if (ownedQty(parents[i]) < 1) {
        setForgeStatus("Missing stock for " + kindLabel(parents[i]) + " (need 1 in inv or bank).", true);
        return;
      }
    }

    if (!exchangeOpen) openExchangeUi();

    var titles = parents.map(titleFor);
    var descs = parents.map(fullDescFor);
    var title = titles.join(" / ");
    var description =
      descs
        .map(function (d) {
          return String(d || "").trim();
        })
        .filter(Boolean)
        .join(" ") +
      " Forged amalgam of " +
      parents.map(kindLabel).join(", ") +
      ".";
    var prompt = buildForgePrompt(parents);

    var id = Number(state.nextForgeId) || 10001;
    state.nextForgeId = id + 1;
    var entry = {
      id: id,
      parents: parents.slice(),
      title: title,
      description: description,
      thumb: thumb(parents[0]),
      guide: Math.max(
        1,
        Math.round((guidePrice(parents[0]) + guidePrice(parents[1]) + guidePrice(parents[2])) / 2)
      ),
      createdAt: Date.now(),
      pendingGenerate: false,
    };
    if (!state.forged) state.forged = {};
    state.forged[String(id)] = entry;

    function finish(visionUrl, genErr) {
      forgeBusy = false;
      var combineBtn = $("ge-forge-combine");
      if (combineBtn) combineBtn.disabled = false;
      if (visionUrl) {
        entry.imageUrl = visionUrl;
        entry.thumb = visionUrl;
        thumbOverrides[String(id)] = assetUrl(visionUrl);
      }
      // If Logan edited description mid-flight, keep his wording.
      if (state.descOverrides && state.descOverrides[String(id)] != null) {
        entry.description = String(state.descOverrides[String(id)]);
      }
      for (var j = 0; j < 3; j++) {
        if (noteOf(parents[j]) || colorChipOf(parents[j])) continue;
        if (!consumeOwned(parents[j], 1)) {
          setForgeStatus("Could not consume materials after forge.", true);
          return;
        }
      }
      addInv(PLAYER_ID, id, 1);
      forgeSlots = [null, null, null];
      lastForgeResult = id;
      entry.pendingGenerate = false;
      if (pendingGenerateId === id) pendingGenerateId = null;
      grantXp(FORGE_XP);
      if (!exchangeOpen) openExchangeUi();
      showForgeResult(id);
      render();
      saveState();
      if (visionUrl) {
        setForgeStatus("Forged " + titleFor(id) + " (#" + id + ") with new image — in inventory. +" + FORGE_XP + " XP");
      } else {
        setForgeStatus(
          "Forged #" +
            id +
            " into inventory, but image gen failed" +
            (genErr ? ": " + genErr : ".") +
            " Using parent thumb. Keep start_server.bat running for new images. +" +
            FORGE_XP +
            " XP",
          true
        );
      }
    }

    forgeBusy = true;
    var btn = $("ge-forge-combine");
    if (btn) btn.disabled = true;
    setForgeStatus("Combining — generating a new image (stay on Grand Exchange)…");
    generateForgeImage(parents, prompt)
      .then(function (url) {
        finish(url || null, null);
      })
      .catch(function (err) {
        var msg = (err && err.message) || String(err || "generate failed");
        finish(null, msg);
      });
  }

  function setAutoForgeStatus(msg) {
    var el = $("ge-autoforge-status");
    if (!el) return;
    el.textContent = msg ? String(msg) : "";
  }

  function syncAutoForgeToggleUi() {
    var on = !!(state && state.autoForge);
    var cb = $("ge-autoforge-on");
    if (cb && cb.checked !== on) cb.checked = on;
    var bar = $("ge-autoforge-bar");
    if (bar) bar.classList.toggle("on", on);
    if (!on) {
      setAutoForgeStatus("");
    } else {
      refreshAutoForgeLedgerStatus();
    }
  }

  function stopAutoForgeTimer() {
    if (autoForgeTimer) {
      clearTimeout(autoForgeTimer);
      autoForgeTimer = null;
    }
  }

  function scheduleAutoForge(ms) {
    stopAutoForgeTimer();
    if (!state || !state.autoForge) return;
    autoForgeTimer = setTimeout(function () {
      autoForgeTimer = null;
      runAutoForgeCycle();
    }, Math.max(200, Number(ms) || 800));
  }

  function setAutoForgeEnabled(on) {
    if (!state) return;
    state.autoForge = !!on;
    saveState();
    syncAutoForgeToggleUi();
    if (state.autoForge) {
      setAutoForgeStatus("buying…");
      setForgeStatus(
        "Auto-forge ON — buying ~$1 art, minting prompt ledgers (right-click Generate / Generate all)."
      );
      scheduleAutoForge(200);
    } else {
      stopAutoForgeTimer();
      autoForgeBusy = false;
      setAutoForgeStatus("");
      setForgeStatus("Auto-forge OFF.");
    }
  }

  function autoForgeFreeInvSlots() {
    return Math.max(0, INV_SLOTS - inventoryCount(PLAYER_ID));
  }

  function autoForgeClaimOfferSlot() {
    var used = Object.create(null);
    playerSlotOffers().forEach(function (o) {
      if (o && o.slot != null && o.slot >= 0) used[Number(o.slot)] = 1;
    });
    for (var i = 0; i < MAX_SLOTS; i++) {
      if (!used[i]) {
        setupSlot = i;
        return i;
      }
    }
    return -1;
  }

  function autoForgePickCheapCatalogIds(limit) {
    limit = Math.max(1, Number(limit) || 8);
    var pool = arsenalList().slice();
    var recent = autoForgeRecentTopics();
    var owned = invOf(PLAYER_ID);
    var scored = [];
    for (var i = 0; i < pool.length; i++) {
      var id = pool[i];
      if (noteOf(id) || colorChipOf(id)) continue;
      if (Number(owned[String(id)]) > 0) continue;
      var g = guidePrice(id);
      var overlap = autoForgeOverlapScore(autoForgeItemTopics(id), recent);
      scored.push({ id: id, score: overlap * 5 + Math.min(g, 40) * 0.05 + Math.random() });
    }
    scored.sort(function (a, b) {
      return a.score - b.score;
    });
    return scored.slice(0, limit).map(function (x) {
      return x.id;
    });
  }

  function autoForgeNpcSellerId() {
    for (var i = 0; i < roster.length; i++) {
      var p = roster[i];
      if (!p || p.is_player || Number(p.id) === PLAYER_ID) continue;
      return Number(p.id);
    }
    return 1;
  }

  /** Buy as much ~$1 art as cash + inventory allow (from cheap sells or catalog at 1 SIM). */
  function autoForgeBuyCheap() {
    var bought = 0;
    var cash = cashOf(PLAYER_ID);
    var free = autoForgeFreeInvSlots();
    if (cash < 1 || free < 1) return 0;

    // 1) Match existing NPC sell offers priced around $1
    var cheapSells = activeOffers().filter(function (o) {
      return (
        o &&
        o.side === "sell" &&
        !o.isPlayer &&
        !o.complete &&
        (Number(o.qtyLeft) || 0) > 0 &&
        Number(o.price) >= 1 &&
        Number(o.price) <= 3
      );
    });
    cheapSells.sort(function (a, b) {
      return a.price - b.price || a.createdAt - b.createdAt;
    });

    for (var i = 0; i < cheapSells.length && cash >= 1 && free > 0; i++) {
      if (playerSlotOffers().length >= MAX_SLOTS) break;
      if (autoForgeClaimOfferSlot() < 0) break;
      var sell = cheapSells[i];
      var px = Math.max(1, Math.round(Number(sell.price) || 1));
      if (cash < px) continue;
      var res = placeOffer({
        side: "buy",
        itemId: sell.itemId,
        qty: 1,
        price: px,
        traderId: PLAYER_ID,
        silent: true,
      });
      if (!res.ok) continue;
      collectAll();
      bought++;
      cash = cashOf(PLAYER_ID);
      free = autoForgeFreeInvSlots();
    }

    // 2) Stock cheap catalog sells at $1 and buy into them
    var need = Math.min(free, Math.floor(cash / 1), 6);
    if (need < 1) {
      saveState();
      return bought;
    }
    var picks = autoForgePickCheapCatalogIds(need);
    var npcId = autoForgeNpcSellerId();
    for (var p = 0; p < picks.length && cash >= 1 && free > 0; p++) {
      if (playerSlotOffers().length >= MAX_SLOTS) {
        collectAll();
        if (playerSlotOffers().length >= MAX_SLOTS) break;
      }
      if (autoForgeClaimOfferSlot() < 0) {
        collectAll();
        if (autoForgeClaimOfferSlot() < 0) break;
      }
      var itemId = picks[p];
      if (qtyOf(npcId, itemId) < 1) addInv(npcId, itemId, 1);
      placeOffer({
        side: "sell",
        itemId: itemId,
        qty: 1,
        price: 1,
        traderId: npcId,
        silent: true,
      });
      var buyRes = placeOffer({
        side: "buy",
        itemId: itemId,
        qty: 1,
        price: 1,
        traderId: PLAYER_ID,
        silent: true,
      });
      if (!buyRes.ok) continue;
      collectAll();
      bought++;
      cash = cashOf(PLAYER_ID);
      free = autoForgeFreeInvSlots();
    }
    saveState();
    return bought;
  }

  function autoForgeMaterialCandidates() {
    var list = invList(PLAYER_ID).concat(bankList(PLAYER_ID));
    var out = [];
    var seen = Object.create(null);
    for (var i = 0; i < list.length; i++) {
      var id = Number(list[i].id);
      if (!id || seen[id]) continue;
      if (noteOf(id) || colorChipOf(id)) continue;
      var f = forgedOf(id);
      if (f && f.pendingGenerate) continue;
      seen[id] = 1;
      out.push(id);
    }
    return out;
  }

  function autoForgeShuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  var AUTO_FORGE_STOPWORDS = {
    a: 1,
    an: 1,
    the: 1,
    of: 1,
    and: 1,
    or: 1,
    to: 1,
    in: 1,
    on: 1,
    for: 1,
    with: 1,
    from: 1,
    into: 1,
    over: 1,
    under: 1,
    a: 1,
    painting: 1,
    forged: 1,
    note: 1,
    sketch: 1,
    generated: 1,
    phone: 1,
    inverted: 1,
    amalgam: 1,
    piece: 1,
    art: 1,
  };

  var AUTO_FORGE_MOODS = [
    "dream",
    "night",
    "storm",
    "quiet",
    "fierce",
    "tender",
    "cosmic",
    "urban",
    "wild",
    "sacred",
    "playful",
    "melancholy",
    "mechanical",
    "organic",
    "mythic",
    "domestic",
    "oceanic",
    "desert",
    "forest",
    "portrait",
    "animal",
    "creature",
    "city",
    "ritual",
    "machine",
    "garden",
    "sky",
    "water",
    "fire",
    "shadow",
  ];

  function autoForgeRecentTopics() {
    var fromState =
      state && Array.isArray(state.recentForgeTopics) ? state.recentForgeTopics.slice() : [];
    var merged = recentForgeTopics.concat(fromState);
    var out = [];
    var seen = Object.create(null);
    for (var i = merged.length - 1; i >= 0; i--) {
      var t = String(merged[i] || "")
        .toLowerCase()
        .trim()
        .slice(0, 48);
      if (!t || seen[t]) continue;
      seen[t] = 1;
      out.unshift(t);
      if (out.length >= AUTO_FORGE_TOPIC_MEMORY) break;
    }
    return out;
  }

  function autoForgeTokenizeText(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s\-]/g, " ")
      .split(/\s+/)
      .map(function (w) {
        return w.replace(/^-+|-+$/g, "");
      })
      .filter(function (w) {
        return w.length >= 3 && !AUTO_FORGE_STOPWORDS[w];
      });
  }

  /** Topic / mood / keyword fingerprint for an item (discovery variation). */
  function autoForgeItemTopics(itemId) {
    itemId = Number(itemId);
    var bag = Object.create(null);
    function add(t) {
      t = String(t || "")
        .toLowerCase()
        .trim()
        .slice(0, 48);
      if (!t || AUTO_FORGE_STOPWORDS[t]) return;
      bag[t] = (bag[t] || 0) + 1;
    }
    tagsFor(itemId).forEach(add);
    autoForgeTokenizeText(titleFor(itemId)).forEach(add);
    autoForgeTokenizeText(String(fullDescFor(itemId) || "").slice(0, 400)).forEach(add);
    AUTO_FORGE_MOODS.forEach(function (m) {
      var blob = (
        String(titleFor(itemId) || "") +
        " " +
        String(fullDescFor(itemId) || "") +
        " " +
        tagsFor(itemId).join(" ")
      ).toLowerCase();
      if (blob.indexOf(m) >= 0) add(m);
    });
    // Kind buckets for coarse streak avoidance
    if (itemId >= 1 && itemId <= PAINTING_TOTAL) add("kind-painting");
    else if (forgedOf(itemId)) add("kind-forged");
    else if (extraOf(itemId)) add("kind-" + String((extraOf(itemId).source || "extra").split("-")[0]));
    return Object.keys(bag);
  }

  function autoForgeComboTopics(parents) {
    var bag = Object.create(null);
    (parents || []).forEach(function (id) {
      autoForgeItemTopics(id).forEach(function (t) {
        bag[t] = 1;
      });
    });
    return Object.keys(bag);
  }

  function autoForgeOverlapScore(topics, recent) {
    if (!topics || !topics.length || !recent || !recent.length) return 0;
    var recentSet = Object.create(null);
    var streakWeights = Object.create(null);
    for (var i = 0; i < recent.length; i++) {
      var t = recent[i];
      recentSet[t] = 1;
      // Heavier penalty for the most recent topics (back-to-back streak)
      streakWeights[t] = (streakWeights[t] || 0) + (recent.length - i);
    }
    var score = 0;
    for (var j = 0; j < topics.length; j++) {
      var key = topics[j];
      if (!recentSet[key]) continue;
      score += 2 + (streakWeights[key] || 1);
    }
    return score;
  }

  function rememberForgeTopics(parents, title, description) {
    var topics = autoForgeComboTopics(parents || []);
    autoForgeTokenizeText(title).forEach(function (t) {
      if (topics.indexOf(t) < 0) topics.push(t);
    });
    autoForgeTokenizeText(String(description || "").slice(0, 280)).forEach(function (t) {
      if (topics.indexOf(t) < 0) topics.push(t);
    });
    // Keep a short signature of dominant topics (not the whole bag)
    topics.sort(function (a, b) {
      return b.length - a.length || (a < b ? -1 : 1);
    });
    var sig = topics.filter(function (t) {
      return t.indexOf("kind-") !== 0;
    }).slice(0, 6);
    if (!sig.length) sig = topics.slice(0, 4);
    recentForgeTopics = recentForgeTopics.concat(sig).slice(-AUTO_FORGE_TOPIC_MEMORY * 2);
    if (!state.recentForgeTopics) state.recentForgeTopics = [];
    state.recentForgeTopics = state.recentForgeTopics.concat(sig).slice(-AUTO_FORGE_TOPIC_MEMORY * 2);
  }

  function autoForgeImaginativeNotePrompt(parentsHint, avoidTopics) {
    var sparks = [
      { text: "a hallway of mirrors that only reflect unfinished paintings", tags: ["mirror", "museum", "dream"] },
      { text: "stormlight braided through museum velvet", tags: ["storm", "museum", "velvet"] },
      { text: "two clocks arguing about which century owns the color blue", tags: ["clock", "time", "blue"] },
      { text: "a quiet market stall selling bottled horizons", tags: ["market", "horizon", "quiet"] },
      { text: "calligraphy that rearranges itself when nobody looks", tags: ["calligraphy", "text", "secret"] },
      { text: "an orchard growing frames instead of fruit", tags: ["orchard", "frame", "garden"] },
      { text: "soft geometry learning how to dream in oil paint", tags: ["geometry", "dream", "paint"] },
      { text: "a brass submarine cartographing forgotten lullabies", tags: ["machine", "ocean", "lullaby"] },
      { text: "desert kites carrying library index cards", tags: ["desert", "kite", "library"] },
      { text: "neon moss colonizing abandoned concert halls", tags: ["neon", "moss", "music"] },
    ];
    var recent = avoidTopics || autoForgeRecentTopics();
    sparks.sort(function (a, b) {
      return autoForgeOverlapScore(a.tags, recent) - autoForgeOverlapScore(b.tags, recent);
    });
    var spark = sparks[0].text;
    if (parentsHint && parentsHint.length) {
      return (
        "Note filler influence: weave " +
        spark +
        " through " +
        parentsHint
          .map(function (id) {
            return titleFor(id);
          })
          .join(" + ") +
        "."
      );
    }
    return "Note filler influence: " + spark + ".";
  }

  /** Score a candidate trio — lower overlap with recent topics = better (discovery/play). */
  function autoForgeScoreTrio(ids, recent) {
    var topics = autoForgeComboTopics(ids);
    var overlap = autoForgeOverlapScore(topics, recent);
    // Intra-trio diversity bonus (different materials/subjects together = tasty)
    var unique = {};
    ids.forEach(function (id) {
      autoForgeItemTopics(id).forEach(function (t) {
        if (t.indexOf("kind-") === 0) unique[t] = 1;
        else if (AUTO_FORGE_MOODS.indexOf(t) >= 0) unique["mood-" + t] = 1;
      });
    });
    var diversity = Object.keys(unique).length;
    // Prefer some internal contrast but not chaos
    return overlap * 10 - diversity * 3 + Math.random() * 1.5;
  }

  function autoForgePickDivergentTrio(mats, needCount, recent) {
    needCount = needCount || 3;
    if (mats.length < needCount) return null;
    var best = null;
    var bestScore = Infinity;
    var attempts = Math.min(48, mats.length * 4);
    for (var n = 0; n < attempts; n++) {
      var pool = autoForgeShuffle(mats);
      var trio = pool.slice(0, needCount);
      // Greedy: if first pick is too similar to recent streak, re-roll first item
      var score = autoForgeScoreTrio(trio, recent);
      if (score < bestScore) {
        bestScore = score;
        best = trio;
      }
      if (bestScore <= 2) break; // good enough divergence
    }
    return best;
  }

  /** Load forge slots creatively with topic variation; occasionally include a note filler. */
  function autoForgeLoadSlots() {
    forgeSlots = [null, null, null];
    var mats = autoForgeMaterialCandidates();
    if (mats.length < 2) return { ok: false, error: "Need more art in inv/bank to pair." };

    var recent = autoForgeRecentTopics();
    var useNote = Math.random() < 0.15; // ~10–20%
    var need = useNote ? 2 : 3;
    var picks = autoForgePickDivergentTrio(mats, need, recent);
    if (!picks || picks.length < need) {
      picks = autoForgeShuffle(mats).slice(0, need);
    }
    if (picks.length < need) {
      return { ok: false, error: "Not enough distinct pieces to forge." };
    }

    // Imaginative slot order
    var order = autoForgeShuffle([0, 1, 2]);
    var slotMats = picks.slice();
    for (var i = 0; i < slotMats.length; i++) {
      placeInForge(slotMats[i], order[i]);
    }
    if (useNote) {
      var empty = -1;
      for (var s = 0; s < 3; s++) {
        if (forgeSlots[s] == null) {
          empty = s;
          break;
        }
      }
      if (empty >= 0) {
        var noteRes = placeNoteInForge(
          empty,
          "Auto note " + (autoForgeCycle + 1),
          autoForgeImaginativeNotePrompt(slotMats, recent)
        );
        if (!noteRes.ok) {
          var leftover = mats.filter(function (id) {
            return slotMats.indexOf(id) < 0;
          });
          var alt = autoForgePickDivergentTrio(leftover.concat(slotMats), 1, recent);
          if (leftover.length) placeInForge(leftover[0], empty);
          else if (alt && alt[0]) placeInForge(alt[0], empty);
        }
      }
    }
    for (var z = 0; z < 3; z++) {
      if (forgeSlots[z] != null) continue;
      var ranked = mats
        .filter(function (id) {
          return forgeSlots.indexOf(id) < 0;
        })
        .map(function (id) {
          return { id: id, score: autoForgeOverlapScore(autoForgeItemTopics(id), recent) };
        })
        .sort(function (a, b) {
          return a.score - b.score;
        });
      if (ranked.length) placeInForge(ranked[0].id, z);
    }
    if (forgeSlots[0] == null || forgeSlots[1] == null || forgeSlots[2] == null) {
      return { ok: false, error: "Could not fill all forge slots." };
    }
    renderForgeSlots();
    return {
      ok: true,
      usedNote: useNote,
      topics: autoForgeComboTopics(
        forgeSlots.filter(function (id) {
          return id != null && !noteOf(id);
        })
      ),
    };
  }

  function runAutoForgeCycle() {
    if (!state || !state.autoForge) return;
    if (autoForgeBusy || forgeBusy) {
      scheduleAutoForge(1000);
      return;
    }

    autoForgeBusy = true;
    autoForgeCycle += 1;
    try {
      setAutoForgeStatus("buying…");
      var nBuy = autoForgeBuyCheap();
      collectAll();
      render();

      setAutoForgeStatus("pairing…");
      var loaded = autoForgeLoadSlots();
      if (!loaded.ok) {
        setForgeStatus("Auto-forge: " + loaded.error + (nBuy ? " (bought " + nBuy + ")" : ""), true);
        refreshAutoForgeLedgerStatus(nBuy ? "bought " + nBuy : "pairing…");
        autoForgeBusy = false;
        scheduleAutoForge(2200);
        return;
      }
      // Mint prompt ledger — do NOT hold forge UI / wait for Generate.
      var prep = mintForgeLedger({ imaginative: true });
      autoForgeBusy = false;
      if (!prep.ok) {
        setForgeStatus("Auto-forge ledger failed: " + prep.error, true);
        refreshAutoForgeLedgerStatus();
        scheduleAutoForge(1800);
        return;
      }
      refreshAutoForgeLedgerStatus("minted #" + prep.id);
      // Keep cycling — ledgers sit ready in inv/bank until Logan Generate / Generate all.
      scheduleAutoForge(1600);
    } catch (err) {
      autoForgeBusy = false;
      setForgeStatus("Auto-forge error: " + ((err && err.message) || err), true);
      refreshAutoForgeLedgerStatus();
      scheduleAutoForge(3000);
    }
  }

  function openSetup(side, slot) {

    setupSide = side;
    setupSlot = slot;
    selected = selected || 1;
    if ($("ge-qty")) $("ge-qty").value = "1";
    if ($("ge-price")) $("ge-price").value = String(guidePrice(selected));
    showView("setup");
    renderSetup();
  }

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function boothRect() {
    return { x: 42, y: 18, w: 16, h: 18 };
  }

  function collectArtFloorUrls() {
    var picks = [];
    var seen = {};
    function pushId(n) {
      n = Number(n);
      if (!n || seen[n]) return;
      seen[n] = 1;
      picks.push(n);
    }
    try {
      var inv = (state && state.inventory) || {};
      Object.keys(inv).forEach(function (k) {
        if (inv[k] > 0) pushId(k);
      });
    } catch (eInv) {}
    var extras = typeof arsenalExtraNums !== "undefined" ? arsenalExtraNums : [];
    for (var ei = 0; ei < extras.length && picks.length < 12; ei++) pushId(extras[ei]);
    var seed = [1, 7, 12, 24, 36, 48, 64, 81, 100, 128, 256, 512];
    for (var si = 0; si < seed.length && picks.length < 12; si++) pushId(seed[si]);
    while (picks.length < 12) {
      pushId(1 + Math.floor(Math.random() * Math.max(1, PAINTING_TOTAL)));
      if (picks.length > 40) break;
    }
    return picks.map(function (id) {
      return thumb(id) || "paintings/" + id + ".jpg";
    });
  }

  /** Hang gallery thumbs on 3D easels (replaces old 2D Art Floor dressing). */
  function dressArtFloor() {
    var urls = collectArtFloorUrls();
    if (window.GeArtFloor3D && typeof window.GeArtFloor3D.setPaintingUrls === "function") {
      try {
        window.GeArtFloor3D.setPaintingUrls(urls);
      } catch (e3) {}
    }
  }

  var artFloor3dWaitTimer = 0;

  function ensureArtFloor3D() {
    var stage = $("ge-world-stage");
    if (!stage) return false;
    if (!window.GeArtFloor3D || typeof window.GeArtFloor3D.mount !== "function") {
      return false;
    }
    try {
      window.GeArtFloor3D.mount(stage, {
        getPaintingUrls: collectArtFloorUrls,
        onOpenExchange: function () {
          if (!exchangeOpen) openExchangeUi();
        },
        onWalkXp: function (n) {
          grantXp(n || 1, { walk: true });
        },
      });
      return true;
    } catch (eMount) {
      console.warn("[GE] Art Floor 3D mount failed", eMount);
      return false;
    }
  }

  function startWorldLoopWhenReady(attempts) {
    if (exchangeOpen) return;
    attempts = attempts == null ? 80 : attempts;
    if (ensureArtFloor3D()) {
      try {
        window.GeArtFloor3D.start();
        dressArtFloor();
      } catch (eStart) {
        console.warn("[GE] Art Floor 3D start failed", eStart);
      }
      return;
    }
    if (attempts <= 0) {
      console.warn("[GE] Art Floor 3D unavailable (Three.js module did not load)");
      return;
    }
    if (artFloor3dWaitTimer) clearTimeout(artFloor3dWaitTimer);
    artFloor3dWaitTimer = setTimeout(function () {
      artFloor3dWaitTimer = 0;
      startWorldLoopWhenReady(attempts - 1);
    }, 75);
  }

  function nearBooth() {
    if (window.GeArtFloor3D && typeof window.GeArtFloor3D.isNearBooth === "function") {
      try {
        return !!window.GeArtFloor3D.isNearBooth();
      } catch (e) {}
    }
    return false;
  }

  function applyPlayerDom() {
    /* 3D avatar — no 2D player DOM */
  }

  function initNpcs() {
    /* 3D NPCs owned by GeArtFloor3D */
  }

  function collidesBooth(x, y) {
    return false;
  }

  function collidesWorld(x, y) {
    return false;
  }

  function worldStep(dt) {
    /* movement handled inside GeArtFloor3D */
  }

  function worldLoop(ts) {
    worldRaf = 0;
  }

  function startWorldLoop() {
    if (exchangeOpen) return;
    startWorldLoopWhenReady(80);
  }

  function stopWorldLoop() {
    if (worldRaf) cancelAnimationFrame(worldRaf);
    worldRaf = 0;
    worldLastTs = 0;
    worldKeys = Object.create(null);
    if (window.GeArtFloor3D && typeof window.GeArtFloor3D.pause === "function") {
      try {
        window.GeArtFloor3D.pause();
      } catch (ePause) {}
    }
  }

  function bindWorldKeys() {
    /* Keyboard owned by GeArtFloor3D while the 3D world runs */
    if (bindWorldKeys._on) return;
    bindWorldKeys._on = true;
  }

  function unbindWorldKeys() {
    bindWorldKeys._on = false;
    worldKeys = Object.create(null);
  }

  function onWorldKeyDown(e) {}
  function onWorldKeyUp(e) {}

  function openExchangeUi() {
    exchangeOpen = true;
    stopWorldLoop();
    unbindWorldKeys();
    var world = $("ge-world");
    var ui = $("ge-exchange-ui");
    if (world) world.hidden = true;
    if (ui) ui.hidden = false;
    showView("home");
    render();
    startTicks();
    setStatus("Grand Exchange open — ✕ or Close returns to the Art Floor.");
  }

  function closeExchangeUi() {
    exchangeOpen = false;
    stopTicks();
    var world = $("ge-world");
    var ui = $("ge-exchange-ui");
    if (ui) ui.hidden = true;
    if (world) world.hidden = false;
    updateLevelHud();
    bindWorldKeys();
    // Defer start so layout has size after unhiding
    setTimeout(function () {
      if (exchangeOpen) return;
      dressArtFloor();
      startWorldLoop();
      if ($("ge-world-stage")) {
        try {
          $("ge-world-stage").focus();
        } catch (err) {}
      }
    }, 30);
  }

  function bind() {
    if ($("ge-tab-exchange") && !$("ge-tab-exchange").dataset.bound) {
      $("ge-tab-exchange").dataset.bound = "1";
      $("ge-tab-exchange").addEventListener("click", function () {
        showView("home");
        render();
      });
    }
    if ($("ge-tab-history") && !$("ge-tab-history").dataset.bound) {
      $("ge-tab-history").dataset.bound = "1";
      $("ge-tab-history").addEventListener("click", function () {
        showView("history");
        render();
      });
    }
    if ($("ge-tab-tracker") && !$("ge-tab-tracker").dataset.bound) {
      $("ge-tab-tracker").dataset.bound = "1";
      $("ge-tab-tracker").addEventListener("click", function () {
        showView("tracker");
        render();
      });
    }
    if ($("ge-track-item") && !$("ge-track-item").dataset.bound) {
      $("ge-track-item").dataset.bound = "1";
      $("ge-track-item").addEventListener("click", function () {
        var id = Number(selected) || 0;
        if (!id) {
          setStatus("Choose an item first.", true);
          return;
        }
        var was = isTracked(id);
        var res = toggleTrackItem(id);
        if (!res.ok) setStatus(res.error, true);
        else
          setStatus(
            was
              ? "Untracked " + kindLabel(id) + "."
              : "Tracking " + kindLabel(id) + " (" + state.trackedItems.length + "/" + MAX_TRACKED + ")."
          );
        renderSetup();
        if (view === "tracker") renderTracker();
      });
    }
    var trackerList = $("ge-tracker-list");
    if (trackerList && !trackerList.dataset.bound) {
      trackerList.dataset.bound = "1";
      trackerList.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-ge-untrack]");
        if (!btn) return;
        var id = Number(btn.getAttribute("data-ge-untrack"));
        untrackItem(id);
        setStatus("Untracked " + kindLabel(id) + ".");
        renderTracker();
      });
    }
    var slots = $("ge-slots");
    if (slots && !slots.dataset.bound) {
      slots.dataset.bound = "1";
      slots.addEventListener("click", function (e) {
        var buy = e.target.closest("[data-ge-empty-buy]");
        var sell = e.target.closest("[data-ge-empty-sell]");
        var col = e.target.closest("[data-ge-collect]");
        var ab = e.target.closest("[data-ge-abort]");
        if (buy) openSetup("buy", Number(buy.getAttribute("data-ge-empty-buy")) || 0);
        else if (sell) openSetup("sell", Number(sell.getAttribute("data-ge-empty-sell")) || 0);
        else if (col) {
          collectOffer(col.getAttribute("data-ge-collect"));
          setStatus("Collected. +" + COLLECT_XP + " XP");
          render();
        } else if (ab) {
          cancelOffer(ab.getAttribute("data-ge-abort"));
          setStatus("Offer aborted — reserved cash/stock returned.");
          render();
        }
      });
    }
    if ($("ge-choose-item") && !$("ge-choose-item").dataset.bound) {
      $("ge-choose-item").dataset.bound = "1";
      $("ge-choose-item").addEventListener("click", function () {
        showView("pick");
        renderCatalog();
      });
    }
    if ($("ge-random-item") && !$("ge-random-item").dataset.bound) {
      $("ge-random-item").dataset.bound = "1";
      $("ge-random-item").addEventListener("click", function () {
        applyRandomItem();
      });
    }
    if ($("ge-random-pick") && !$("ge-random-pick").dataset.bound) {
      $("ge-random-pick").dataset.bound = "1";
      $("ge-random-pick").addEventListener("click", function () {
        if (applyRandomItem()) {
          showView("setup");
          renderSetup();
        }
      });
    }
    if ($("ge-pick-back") && !$("ge-pick-back").dataset.bound) {
      $("ge-pick-back").dataset.bound = "1";
      $("ge-pick-back").addEventListener("click", function () {
        showView("setup");
        renderSetup();
      });
    }
    if ($("ge-setup-back") && !$("ge-setup-back").dataset.bound) {
      $("ge-setup-back").dataset.bound = "1";
      $("ge-setup-back").addEventListener("click", function () {
        showView("home");
        render();
      });
    }
    var catalog = $("ge-catalog");
    if (catalog && !catalog.dataset.bound) {
      catalog.dataset.bound = "1";
      catalog.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-ge-item]");
        if (!btn) return;
        selected = Number(btn.getAttribute("data-ge-item")) || 1;
        if ($("ge-price")) $("ge-price").value = String(guidePrice(selected));
        showView("setup");
        renderSetup();
      });
    }
    if ($("ge-search") && !$("ge-search").dataset.bound) {
      $("ge-search").dataset.bound = "1";
      $("ge-search").addEventListener("input", renderCatalog);
    }
    if ($("ge-tag-filter") && !$("ge-tag-filter").dataset.bound) {
      $("ge-tag-filter").dataset.bound = "1";
      $("ge-tag-filter").addEventListener("change", renderCatalog);
    }
    if ($("ge-open-exchange") && !$("ge-open-exchange").dataset.bound) {
      $("ge-open-exchange").dataset.bound = "1";
      $("ge-open-exchange").addEventListener("click", openExchangeUi);
    }
    if ($("ge-close-exchange") && !$("ge-close-exchange").dataset.bound) {
      $("ge-close-exchange").dataset.bound = "1";
      $("ge-close-exchange").addEventListener("click", closeExchangeUi);
    }
    if ($("ge-booth") && !$("ge-booth").dataset.bound) {
      $("ge-booth").dataset.bound = "1";
      $("ge-booth").addEventListener("click", function () {
        if (!exchangeOpen) openExchangeUi();
      });
    }
    if (!window.__geWorldKeysBound) {
      window.__geWorldKeysBound = true;
      bindWorldKeys();
    }
    document.querySelectorAll("[data-ge-qty]").forEach(function (btn) {
      if (btn.dataset.bound) return;
      btn.dataset.bound = "1";
      btn.addEventListener("click", function () {
        var d = Number(btn.getAttribute("data-ge-qty")) || 0;
        var el = $("ge-qty");
        if (!el) return;
        el.value = String(Math.max(1, (Number(el.value) || 1) + d));
        updateTotal();
      });
    });
    document.querySelectorAll("[data-ge-qty-set]").forEach(function (btn) {
      if (btn.dataset.bound) return;
      btn.dataset.bound = "1";
      btn.addEventListener("click", function () {
        var el = $("ge-qty");
        if (!el) return;
        el.value = String(Math.max(1, (Number(el.value) || 0) + (Number(btn.getAttribute("data-ge-qty-set")) || 0)));
        updateTotal();
      });
    });
    if ($("ge-qty-max") && !$("ge-qty-max").dataset.bound) {
      $("ge-qty-max").dataset.bound = "1";
      $("ge-qty-max").addEventListener("click", function () {
        setOfferQtyToMax();
      });
    }
    document.querySelectorAll("[data-ge-px]").forEach(function (btn) {
      if (btn.dataset.bound) return;
      btn.dataset.bound = "1";
      btn.addEventListener("click", function () {
        var d = Number(btn.getAttribute("data-ge-px")) || 0;
        var el = $("ge-price");
        if (!el) return;
        var step = Math.max(1, Math.round(guidePrice(selected) * 0.01));
        el.value = String(Math.max(1, (Number(el.value) || 1) + d * step));
        updateTotal();
      });
    });
    if ($("ge-px-guide") && !$("ge-px-guide").dataset.bound) {
      $("ge-px-guide").dataset.bound = "1";
      $("ge-px-guide").addEventListener("click", function () {
        if ($("ge-price")) $("ge-price").value = String(guidePrice(selected));
        updateTotal();
      });
    }
    if ($("ge-px-down") && !$("ge-px-down").dataset.bound) {
      $("ge-px-down").dataset.bound = "1";
      $("ge-px-down").addEventListener("click", function () {
        if ($("ge-price")) $("ge-price").value = String(Math.max(1, Math.round(guidePrice(selected) * 0.95)));
        updateTotal();
      });
    }
    if ($("ge-px-up") && !$("ge-px-up").dataset.bound) {
      $("ge-px-up").dataset.bound = "1";
      $("ge-px-up").addEventListener("click", function () {
        if ($("ge-price")) $("ge-price").value = String(Math.max(1, Math.round(guidePrice(selected) * 1.05)));
        updateTotal();
      });
    }
    ["ge-qty", "ge-price"].forEach(function (id) {
      var el = $(id);
      if (el && !el.dataset.bound) {
        el.dataset.bound = "1";
        el.addEventListener("input", updateTotal);
      }
    });
    if ($("ge-confirm") && !$("ge-confirm").dataset.bound) {
      $("ge-confirm").dataset.bound = "1";
      $("ge-confirm").addEventListener("click", function () {
        var res = placeOffer({
          side: setupSide,
          itemId: selected,
          qty: ($("ge-qty") && $("ge-qty").value) || 1,
          price: ($("ge-price") && $("ge-price").value) || guidePrice(selected),
          traderId: PLAYER_ID,
        });
        if (!res.ok) {
          setStatus(res.error, true);
          return;
        }
        setStatus((setupSide === "buy" ? "Buy" : "Sell") + " offer placed in slot " + (setupSlot + 1) + ".");
        showView("home");
        render();
      });
    }
    if ($("ge-collect-all") && !$("ge-collect-all").dataset.bound) {
      $("ge-collect-all").dataset.bound = "1";
      $("ge-collect-all").addEventListener("click", function () {
        collectAll();
        setStatus("Collected completed offers. +" + COLLECT_XP + " XP each");
        showView("home");
        render();
      });
    }
    if ($("ge-seed-npcs") && !$("ge-seed-npcs").dataset.bound) {
      $("ge-seed-npcs").dataset.bound = "1";
      $("ge-seed-npcs").addEventListener("click", function () {
        state.npcSeededOffers = false;
        seedNpcOffers();
        setStatus("NPC books refilled.");
        render();
      });
    }
    if ($("ge-refresh") && !$("ge-refresh").dataset.bound) {
      $("ge-refresh").dataset.bound = "1";
      $("ge-refresh").addEventListener("click", function () {
        loadRoster().then(function () {
          setStatus("Banker roster refreshed.");
          render();
        });
      });
    }
    if ($("ge-reset") && !$("ge-reset").dataset.bound) {
      $("ge-reset").dataset.bound = "1";
      $("ge-reset").addEventListener("click", function () {
        if (!confirm("Reset Grand Exchange? This clears inventory, bank, offers, and level XP.")) return;
        state = defaultState();
        ensurePlayerStock();
        ensureNpcSeedStock();
        seedNpcOffers();
        saveState();
        tickN = 0;
        setStatus("Exchange reset — empty pack. Buy or withdraw to fill it.");
        showView("home");
        render();
      });
    }

    if ($("ge-bag-inv") && !$("ge-bag-inv").dataset.bound) {
      $("ge-bag-inv").dataset.bound = "1";
      $("ge-bag-inv").addEventListener("click", function () {
        bagView = "inv";
        renderBags();
      });
    }
    if ($("ge-bag-bank") && !$("ge-bag-bank").dataset.bound) {
      $("ge-bag-bank").dataset.bound = "1";
      $("ge-bag-bank").addEventListener("click", function () {
        bagView = "bank";
        renderBags();
      });
    }
    var invGrid = $("ge-inv-grid");
    if (invGrid && !invGrid.dataset.bound) {
      invGrid.dataset.bound = "1";
      invGrid.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-ge-inv]");
        if (!btn) return;
        selectedInvItem = Number(btn.getAttribute("data-ge-inv")) || null;
        selected = selectedInvItem || selected;
        renderBags();
      });
      invGrid.addEventListener("dblclick", function (e) {
        var btn = e.target.closest("[data-ge-inv]");
        if (!btn) return;
        var id = Number(btn.getAttribute("data-ge-inv"));
        var res = depositItem(id, 1);
        setStatus(res.ok ? "Deposited #" + id : res.error, !res.ok);
        render();
      });
      invGrid.addEventListener("contextmenu", function (e) {
        var btn = e.target.closest("[data-ge-inv]");
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        var id = Number(btn.getAttribute("data-ge-inv"));
        selectedInvItem = id;
        selected = id;
        showForgeContextMenu(e.clientX, e.clientY, id, "inv");
      });
    }
    var bankGrid = $("ge-bank-grid");
    if (bankGrid && !bankGrid.dataset.bound) {
      bankGrid.dataset.bound = "1";
      bankGrid.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-ge-bank]");
        if (!btn) return;
        selectedBankItem = Number(btn.getAttribute("data-ge-bank")) || null;
        selected = selectedBankItem || selected;
        renderBags();
      });
      bankGrid.addEventListener("dblclick", function (e) {
        var btn = e.target.closest("[data-ge-bank]");
        if (!btn) return;
        var id = Number(btn.getAttribute("data-ge-bank"));
        var res = withdrawItem(id, 1);
        setStatus(res.ok ? "Withdrew #" + id : res.error, !res.ok);
        render();
      });
      bankGrid.addEventListener("contextmenu", function (e) {
        var btn = e.target.closest("[data-ge-bank]");
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        var id = Number(btn.getAttribute("data-ge-bank"));
        selectedBankItem = id;
        selected = id;
        showForgeContextMenu(e.clientX, e.clientY, id, "bank");
      });
    }
    var forgeMenu = $("ge-forge-menu");
    if (forgeMenu && !forgeMenu.dataset.bound) {
      forgeMenu.dataset.bound = "1";
      forgeMenu.addEventListener("click", function (e) {
        var actionBtn = e.target.closest("[data-ge-action]");
        var pick = e.target.closest("[data-forge-pick]");
        if (!actionBtn && !pick) return;
        e.preventDefault();
        e.stopPropagation();
        var id = Number(forgeMenu.dataset.itemId);
        var source = forgeMenu.dataset.source || "inv";
        hideForgeContextMenu();
        if (actionBtn) {
          var action = actionBtn.getAttribute("data-ge-action");
          if (action === "view") {
            var viewRes = openItemFullscreen(id);
            if (!viewRes.ok) setStatus(viewRes.error, true);
            return;
          }
          if (action === "description") {
            var dRes = openItemDescription(id);
            if (!dRes.ok) setStatus(dRes.error, true);
            return;
          }
          if (action === "force-load") {
            forceLoadItemImage(id);
            return;
          }
          if (action === "animate") {
            sendItemToAnimate(id).then(function (anRes) {
              if (!anRes) return;
              if (!anRes.ok) {
                if (anRes.error && anRes.error !== "Cancelled.") setStatus(anRes.error, true);
                return;
              }
              setStatus("Animating in Grand Exchange…");
            });
            return;
          }
          if (action === "sell") {
            var sellRes = openSellForItem(id);
            if (!sellRes.ok) setStatus(sellRes.error, true);
            else setStatus("Sell offer setup for " + kindLabel(id) + ".");
            render();
            return;
          }
          if (action === "track") {
            var wasTracked = isTracked(id);
            var trRes = toggleTrackItem(id);
            if (!trRes.ok) setStatus(trRes.error, true);
            else
              setStatus(
                wasTracked
                  ? "Untracked " + kindLabel(id) + " from Market Tracker."
                  : "Tracking " + kindLabel(id) + " on Market Tracker."
              );
            render();
            return;
          }
          if (action === "deposit") {
            var depRes = depositItem(id, 1);
            setStatus(depRes.ok ? "Deposited " + kindLabel(id) : depRes.error, !depRes.ok);
            render();
            return;
          }
          if (action === "withdraw") {
            var wdRes = withdrawItem(id, 1);
            setStatus(wdRes.ok ? "Withdrew " + kindLabel(id) : wdRes.error, !wdRes.ok);
            render();
            return;
          }
          if (action === "generate") {
            if (!ledgerOf(id)) {
              setStatus("Generate works on prompt ledgers.", true);
              return;
            }
            generateLedgerNow(id).then(function (gRes) {
              if (!gRes) return;
              if (!gRes.ok) setStatus(gRes.error || "Generate failed.", true);
              else setStatus("Generated forged #" + gRes.id + " from ledger.");
            });
            return;
          }
          if (action === "generate-all") {
            generateAllLedgers().then(function (gRes) {
              if (!gRes) return;
              if (!gRes.ok && !gRes.done) setStatus(gRes.error || "Generate all failed.", true);
              else setStatus("Generate all: " + (gRes.done || 0) + " ledger(s) done.");
            });
            return;
          }
          return;
        }
        var slot = Number(pick.getAttribute("data-forge-pick"));
        var res = placeInForge(id, slot);
        renderForgeSlots();
        if (!res.ok) setForgeStatus(res.error, true);
        else setForgeStatus("Placed " + kindLabel(id) + " in Spellforge slot " + (res.slot + 1) + ".");
        renderBags();
      });
      document.addEventListener(
        "pointerdown",
        function (e) {
          var menu = $("ge-forge-menu");
          if (!menu || menu.hidden) return;
          if (menu.contains(e.target)) return;
          var opened = Number(menu.dataset.openedAt) || 0;
          if (Date.now() - opened < 300) return;
          hideForgeContextMenu();
        },
        true
      );
      document.addEventListener(
        "keydown",
        function (e) {
          if (e.key === "Escape") {
            hideForgeContextMenu();
            hideGeLightbox();
            if ($("ge-animate-prompt") && !$("ge-animate-prompt").hidden) {
              cancelGeAnimatePrompt();
            }
            closeGeColorPopover();
          }
        },
        true
      );
    }
    if ($("ge-auto-soften") && !$("ge-auto-soften").dataset.bound) {
      $("ge-auto-soften").dataset.bound = "1";
      try {
        var softV = localStorage.getItem("spellforge_auto_soften_v1");
        $("ge-auto-soften").checked = softV == null ? true : softV !== "0" && softV !== "false";
      } catch (eSoft) {
        $("ge-auto-soften").checked = true;
      }
      $("ge-auto-soften").addEventListener("change", function () {
        try {
          localStorage.setItem(
            "spellforge_auto_soften_v1",
            $("ge-auto-soften").checked ? "1" : "0"
          );
        } catch (eSet) {}
        var sf = document.getElementById("spell-auto-soften");
        if (sf) sf.checked = $("ge-auto-soften").checked;
      });
    }
    if ($("ge-animate-cancel") && !$("ge-animate-cancel").dataset.bound) {
      $("ge-animate-cancel").dataset.bound = "1";
      $("ge-animate-cancel").addEventListener("click", cancelGeAnimate);
    }
    if ($("ge-animate-prompt-go") && !$("ge-animate-prompt-go").dataset.bound) {
      $("ge-animate-prompt-go").dataset.bound = "1";
      $("ge-animate-prompt-go").addEventListener("click", confirmGeAnimatePrompt);
    }
    if ($("ge-animate-prompt-cancel") && !$("ge-animate-prompt-cancel").dataset.bound) {
      $("ge-animate-prompt-cancel").dataset.bound = "1";
      $("ge-animate-prompt-cancel").addEventListener("click", cancelGeAnimatePrompt);
    }
    if ($("ge-animate-prompt") && !$("ge-animate-prompt").dataset.boundBackdrop) {
      $("ge-animate-prompt").dataset.boundBackdrop = "1";
      $("ge-animate-prompt").addEventListener("click", function (e) {
        if (e.target === $("ge-animate-prompt")) cancelGeAnimatePrompt();
      });
    }
    if ($("ge-animate-direction") && !$("ge-animate-direction").dataset.boundKeys) {
      $("ge-animate-direction").dataset.boundKeys = "1";
      $("ge-animate-direction").addEventListener("keydown", function (e) {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          confirmGeAnimatePrompt();
        }
      });
    }
    if ($("ge-lightbox-close") && !$("ge-lightbox-close").dataset.bound) {
      $("ge-lightbox-close").dataset.bound = "1";
      $("ge-lightbox-close").addEventListener("click", hideGeLightbox);
    }
    if ($("ge-lightbox") && !$("ge-lightbox").dataset.boundBg) {
      $("ge-lightbox").dataset.boundBg = "1";
      $("ge-lightbox").addEventListener("click", function (e) {
        if (e.target === $("ge-lightbox")) hideGeLightbox();
      });
    }
    if ($("ge-dep-one") && !$("ge-dep-one").dataset.bound) {
      $("ge-dep-one").dataset.bound = "1";
      $("ge-dep-one").addEventListener("click", function () {
        if (!selectedInvItem) {
          setStatus("Select an inventory item first.", true);
          return;
        }
        var res = depositItem(selectedInvItem, qtyOf(PLAYER_ID, selectedInvItem));
        setStatus(res.ok ? "Deposited #" + selectedInvItem : res.error, !res.ok);
        selectedInvItem = null;
        render();
      });
    }
    if ($("ge-dep-all") && !$("ge-dep-all").dataset.bound) {
      $("ge-dep-all").dataset.bound = "1";
      $("ge-dep-all").addEventListener("click", function () {
        depositAll();
        setStatus("Inventory deposited to bank.");
        render();
      });
    }
    if ($("ge-wd-one") && !$("ge-wd-one").dataset.bound) {
      $("ge-wd-one").dataset.bound = "1";
      $("ge-wd-one").addEventListener("click", function () {
        if (!selectedBankItem) {
          setStatus("Select a bank item first.", true);
          return;
        }
        var res = withdrawItem(selectedBankItem, 1);
        setStatus(res.ok ? "Withdrew #" + selectedBankItem : res.error, !res.ok);
        render();
      });
    }
    if ($("ge-wd-all") && !$("ge-wd-all").dataset.bound) {
      $("ge-wd-all").dataset.bound = "1";
      $("ge-wd-all").addEventListener("click", function () {
        withdrawAllPage();
        setStatus("Withdrew this bank page into inventory (space allowing).");
        render();
      });
    }
    if ($("ge-bank-prev") && !$("ge-bank-prev").dataset.bound) {
      $("ge-bank-prev").dataset.bound = "1";
      $("ge-bank-prev").addEventListener("click", function () {
        bankPage = Math.max(0, bankPage - 1);
        renderBankGrid();
      });
    }
    if ($("ge-bank-next") && !$("ge-bank-next").dataset.bound) {
      $("ge-bank-next").dataset.bound = "1";
      $("ge-bank-next").addEventListener("click", function () {
        bankPage += 1;
        renderBankGrid();
      });
    }

    for (var fi = 0; fi < 3; fi++) {
      (function (slot) {
        var el = $("ge-forge-slot-" + slot);
        if (el && !el.dataset.bound) {
          el.dataset.bound = "1";
          el.addEventListener("click", function () {
            if (forgeSlots[slot] == null) {
              setForgeStatus("Slot " + (slot + 1) + " empty — right-click inv/bank to fill.");
              return;
            }
            clearForgeSlot(slot);
          });
        }
      })(fi);
    }
    if ($("ge-forge-combine") && !$("ge-forge-combine").dataset.bound) {
      $("ge-forge-combine").dataset.bound = "1";
      $("ge-forge-combine").addEventListener("click", combineForge);
    }
    if ($("ge-autoforge-on") && !$("ge-autoforge-on").dataset.bound) {
      $("ge-autoforge-on").dataset.bound = "1";
      $("ge-autoforge-on").addEventListener("change", function () {
        setAutoForgeEnabled(!!$("ge-autoforge-on").checked);
      });
    }
    if ($("ge-forge-result-generate") && !$("ge-forge-result-generate").dataset.bound) {
      $("ge-forge-result-generate").dataset.bound = "1";
      $("ge-forge-result-generate").addEventListener("click", function () {
        generateForgedNow(lastForgeResult || pendingGenerateId);
      });
    }
    if ($("ge-forge-result-save-desc") && !$("ge-forge-result-save-desc").dataset.bound) {
      $("ge-forge-result-save-desc").dataset.bound = "1";
      $("ge-forge-result-save-desc").addEventListener("click", function () {
        saveForgeResultDescription();
      });
    }
    if ($("ge-forge-result-open-desc") && !$("ge-forge-result-open-desc").dataset.bound) {
      $("ge-forge-result-open-desc").dataset.bound = "1";
      $("ge-forge-result-open-desc").addEventListener("click", function () {
        if (!lastForgeResult) {
          setForgeStatus("No forged result to describe.", true);
          return;
        }
        saveForgeResultDescription();
        openItemDescription(lastForgeResult);
      });
    }
    if ($("ge-forge-open") && !$("ge-forge-open").dataset.bound) {
      $("ge-forge-open").dataset.bound = "1";
      $("ge-forge-open").addEventListener("click", openSpellforgeTab);
    }
    if ($("ge-forge-bank") && !$("ge-forge-bank").dataset.bound) {
      $("ge-forge-bank").dataset.bound = "1";
      $("ge-forge-bank").addEventListener("click", function () {
        if (!lastForgeResult) {
          setForgeStatus("No forged result to bank.", true);
          return;
        }
        var res = depositItem(lastForgeResult, 1);
        setForgeStatus(res.ok ? "Banked forged #" + lastForgeResult : res.error, !res.ok);
        render();
      });
    }
    if ($("ge-forge-sell") && !$("ge-forge-sell").dataset.bound) {
      $("ge-forge-sell").dataset.bound = "1";
      $("ge-forge-sell").addEventListener("click", function () {
        if (!lastForgeResult) {
          setForgeStatus("No forged result to sell.", true);
          return;
        }
        selected = lastForgeResult;
        openSetup("sell", 0);
      });
    }
    if ($("ge-forge-to-animate") && !$("ge-forge-to-animate").dataset.bound) {
      $("ge-forge-to-animate").dataset.bound = "1";
      $("ge-forge-to-animate").addEventListener("click", sendForgeResultToAnimate);
    }
    for (var ni = 0; ni < 3; ni++) {
      (function (slot) {
        var noteBtn = $("ge-note-slot-" + slot);
        if (noteBtn && !noteBtn.dataset.bound) {
          noteBtn.dataset.bound = "1";
          noteBtn.addEventListener("click", function () {
            var titleEl = $("ge-note-title");
            var ta = $("ge-note-text");
            var res = placeNoteInForge(
              slot,
              titleEl && titleEl.value,
              ta && ta.value
            );
            renderForgeSlots();
            if (!res.ok) setForgeStatus(res.error, true);
            else {
              setForgeStatus(
                "Note placed in Spellforge slot " + (slot + 1) + "."
              );
              if (titleEl) titleEl.value = "";
              if (ta) ta.value = "";
              renderNoteColorHits();
            }
          });
        }
      })(ni);
    }
    if ($("ge-note-text") && !$("ge-note-text").dataset.colorBound) {
      $("ge-note-text").dataset.colorBound = "1";
      $("ge-note-text").addEventListener("input", function () {
        renderNoteColorHits();
      });
      renderNoteColorHits();
    }
    if (!document.documentElement.dataset.geColorHitBound) {
      document.documentElement.dataset.geColorHitBound = "1";
      document.addEventListener("click", function (e) {
        // Toolbar / edit actions in description
        var editBtn = e.target.closest(".ge-desc-edit-btn");
        if (editBtn) {
          e.preventDefault();
          startGeDescTextEdit(Number(editBtn.getAttribute("data-item-id")));
          return;
        }
        var defBtn = e.target.closest(".ge-desc-default-btn");
        if (defBtn) {
          e.preventDefault();
          revertGeDescText(Number(defBtn.getAttribute("data-item-id")));
          return;
        }
        var saveBtn = e.target.closest(".ge-desc-edit-save");
        if (saveBtn) {
          e.preventDefault();
          saveGeDescTextEdit(Number(saveBtn.getAttribute("data-item-id")));
          return;
        }
        var cancelBtn = e.target.closest(".ge-desc-edit-cancel");
        if (cancelBtn) {
          e.preventDefault();
          openItemDescription(Number(cancelBtn.getAttribute("data-item-id")));
          return;
        }

        var hit = e.target.closest(".ge-color-hit");
        if (hit) {
          e.preventDefault();
          e.stopPropagation();
          openGeColorPopover(hit);
          return;
        }

        var pop = document.getElementById("ge-color-popover");
        if (!pop) return;
        if (pop.contains(e.target)) return;
        // Also ignore if the event path includes the popover (shadow/native quirks)
        var path = typeof e.composedPath === "function" ? e.composedPath() : [];
        for (var pi = 0; pi < path.length; pi++) {
          if (path[pi] === pop) return;
        }
        var until = Number(pop.dataset.suppressOutsideUntil || 0);
        if (Date.now() < until) return;
        closeGeColorPopover();
      });
    }
  }

  function loadAnalyses() {
    return fetch("data/analyses.json?t=" + Date.now(), { cache: "no-store" })
      .then(function (r) {
        return r.ok ? r.json() : {};
      })
      .then(function (data) {
        analyses = data || {};
      })
      .catch(function () {
        analyses = {};
      });
  }

  function loadRoster() {
    return fetch("/api/banker/roster?t=" + Date.now(), { cache: "no-store" })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (data) {
        if (data && (data.people || data.roster)) roster = data.people || data.roster || [];
        return fetch("data/payment-config.json?t=" + Date.now(), { cache: "no-store" })
          .then(function (r) {
            return r.ok ? r.json() : null;
          })
          .then(function (cfg) {
            if (cfg && cfg.prices_usd && cfg.prices_usd.paintings) {
              GUIDE_BASE = Number(cfg.prices_usd.paintings) || GUIDE_BASE;
            }
          })
          .catch(function () {});
      })
      .catch(function () {
        if (!roster.length) {
          roster = [];
          for (var i = 1; i <= 100; i++) {
            roster.push({
              id: i,
              full_name: i === PLAYER_ID ? "Logan Sevin" : "Citizen #" + i,
              is_player: i === PLAYER_ID,
              possession_usd: 50000,
              debit: { balance_usd: 50000 },
            });
          }
        }
      });
  }

  function startTicks() {
    stopTicks();
    tickTimer = setInterval(npcTick, NPC_TICK_MS);
  }
  function stopTicks() {
    if (tickTimer) clearInterval(tickTimer);
    tickTimer = null;
  }

  function onShow() {
    bind();
    initNpcs();
    applyPlayerDom();
    dressArtFloor();
    Promise.all([loadAnalyses(), loadRoster(), loadArsenal()]).then(function () {
      ensurePlayerStock();
      ensureNpcSeedStock();
      seedNpcOffers();
      saveState();
      populateTagFilter();
      updateLevelHud();
      dressArtFloor();
      if (exchangeOpen) {
        var world = $("ge-world");
        var ui = $("ge-exchange-ui");
        if (world) world.hidden = true;
        if (ui) ui.hidden = false;
        showView("home");
        render();
        startTicks();
      } else {
        closeExchangeUi();
      }
      var extras = arsenalExtraNums.length;
      setStatus(
        "Welcome to the Art Floor · arsenal " +
          arsenalList().length +
          " (paintings + gen/phone/sketches" +
          (extras ? " · " + extras + " extras" : "") +
          "). Explore the 3D Art Floor or Open Grand Exchange."
      );
      syncAutoForgeToggleUi();
      if (state.autoForge) {
        refreshAutoForgeLedgerStatus("buying…");
        scheduleAutoForge(600);
      }
    });
  }

  function onHide() {
    stopAutoForgeTimer();
    stopTicks();
    stopWorldLoop();
    unbindWorldKeys();
    if (window.GeArtFloor3D && typeof window.GeArtFloor3D.dispose === "function") {
      try {
        window.GeArtFloor3D.dispose();
      } catch (eDisp) {}
    }
    saveState();
  }

  function init() {
    state = loadState();
    npcRuntime = { inventory: {}, bank: {} };
    recentForgeTopics = Array.isArray(state.recentForgeTopics) ? state.recentForgeTopics.slice() : [];
    hydrateGeFromIdb().then(function (hydrated) {
      if (!hydrated || !state) return;
      try {
        updateLevelHud();
        if (exchangeOpen) render();
        syncAutoForgeToggleUi();
      } catch (eHydra) {}
    });
    // Restore pending generate highlight from saved forged entries
    try {
      Object.keys(state.forged || {}).forEach(function (k) {
        var f = state.forged[k];
        if (f && f.pendingGenerate && !f.imageUrl) {
          pendingGenerateId = Number(f.id || k);
          lastForgeResult = pendingGenerateId;
        }
      });
    } catch (ePend) {}
    try {
      purgePresetColorChips();
    } catch (eChip) {}
    try {
      var moved = enforcePlayerInvCap();
      if (moved > 0) {
        saveState();
      } else {
        saveState();
      }
    } catch (eCap) {}
    window.addEventListener("pagehide", function () {
      saveState();
    });
    window.addEventListener("beforeunload", function () {
      saveState();
    });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") saveState();
    });
    window.addEventListener("exchange-hide", onHide);
    document.addEventListener("DOMContentLoaded", function () {
      if (location.hash.replace("#", "") === "exchange") onShow();
    });
    document.addEventListener(
      "click",
      function (e) {
        var t = e.target.closest('.tab[data-tab="exchange"]');
        if (t) setTimeout(onShow, 0);
      },
      true
    );
  }

  init();
  window.GrandExchange = {
    refresh: function () {
      return loadRoster().then(render);
    },
    state: function () {
      return state;
    },
    setAutoForge: setAutoForgeEnabled,
    generateForged: generateForgedNow,
    prepareForge: prepareForgeCombine,
    mintLedger: mintForgeLedger,
    generateLedger: generateLedgerNow,
    generateAllLedgers: generateAllLedgers,
    pendingLedgers: listPendingLedgers,
  };
})();
