/**
 * Stare — step back from inside a world; view through a unique frame that builds the edges.
 * 13 nested squares = image depth geometry (drag within parent only).
 * Open = invent once (text DNA). New variation = one step per click.
 */
(function () {
  "use strict";

  var TRAY_SIZE = 48;
  var ANALYSES_URL = "data/analyses.json";
  var MAX_RECENT_SEEDS = 24;
  var LAYER_COUNT = 13;
  /** Size of each square as a fraction of its parent (L1 uses view). */
  var DEFAULT_CHILD_SCALE = 0.86;
  var L1_SCALE = 0.94;
  var DEFAULT_POTENCY = 70;
  var MAX_EQUIPPED = 6;

  var state = {
    imageUrl: "",
    busy: false,
    saved: [],
    genNum: null,
    immersive: false,
    pool: [],
    tray: [],
    equipped: [],
    poolReady: false,
    /** Tray filter: all | painting | generated */
    trayFilter: "all",
    analyses: null,
    analysesLoading: null,
    lod1Analyses: {},
    lastCast: null,
    recentSeeds: [],
    /** Modifiers accumulated across manual variation clicks. */
    modifierStack: [],
    /** How many times New variation has been clicked this lineage. */
    variationStep: 0,
    /** Nested square geometry: each layer ox/oy in 0–1 free-room of parent, scale vs parent. */
    spaceLayers: null,
    spaceDrag: null,
    spaceBound: false,
    spaceHover: -1,
  };

  function $(id) {
    return document.getElementById(id);
  }

  function apiUrl(path) {
    if (typeof window.galleryApiUrl === "function") return window.galleryApiUrl(path);
    var base = String(window.SPELLFORGE_API_BASE || "").replace(/\/$/, "");
    return base ? base + path : path;
  }

  function absUrl(url) {
    if (!url) return "";
    if (/^(https?:|data:|blob:)/i.test(url)) return url;
    try {
      return new URL(url, location.href).href;
    } catch (e) {
      return url;
    }
  }

  function paintingUrl(n) {
    if (typeof window.getPaintingUrl === "function") return window.getPaintingUrl(n);
    return "paintings/" + n + ".jpg";
  }

  function generatedUrl(n) {
    return "/generated/" + n + ".jpg";
  }

  function spellKey(item) {
    if (!item) return "";
    return String(item.kind || "painting") + ":" + String(item.num);
  }

  function clampPotency(v) {
    var n = parseInt(v, 10);
    if (isNaN(n)) return DEFAULT_POTENCY;
    return Math.max(0, Math.min(100, n));
  }

  function potencyWord(p) {
    if (p >= 85) return "DOMINANT";
    if (p >= 65) return "STRONG";
    if (p >= 40) return "MODERATE";
    if (p >= 15) return "LIGHT";
    return "TRACE";
  }

  function setStatus(msg, kind) {
    var el = $("stare-status");
    if (!el) return;
    el.textContent = msg || "";
    el.className =
      "stare-status" + (kind === "err" ? " err" : kind === "ok" ? " ok" : "");
  }

  function setBusy(on) {
    state.busy = !!on;
    ["stare-generate", "stare-save", "stare-variation", "stare-immerse", "stare-randomize"].forEach(
      function (id) {
        var b = $(id);
        if (!b) return;
        if (id === "stare-save" || id === "stare-immerse") {
          b.disabled = !!on || !state.imageUrl;
        } else {
          b.disabled = !!on;
        }
      }
    );
  }

  function userIdea() {
    var el = $("stare-prompt");
    return el ? String(el.value || "").trim() : "";
  }

  function frameKind() {
    var s = $("stare-border");
    return (s && s.value) || "worlds";
  }

  function moodValue() {
    var s = $("stare-mood");
    return (s && s.value) || "vast";
  }

  function aspectValue() {
    var s = $("stare-aspect");
    return (s && s.value) || "1:1";
  }

  function equippedSpellMeta() {
    return state.equipped.map(function (s) {
      return {
        kind: s.kind || "painting",
        num: s.num,
        label: s.label,
        potency: clampPotency(s.potency),
        url: s.url,
      };
    });
  }

  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  function uniqueSeedToken() {
    var token =
      (typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID().slice(0, 8)
        : Math.random().toString(36).slice(2, 10)) +
      "-" +
      Date.now().toString(36);
    var n = 0;
    while (state.recentSeeds.indexOf(token) >= 0 && n < 5) {
      token = token + pick("abcdefghijkmnopqrstuvwxyz".split(""));
      n++;
    }
    state.recentSeeds.push(token);
    if (state.recentSeeds.length > MAX_RECENT_SEEDS) {
      state.recentSeeds = state.recentSeeds.slice(-MAX_RECENT_SEEDS);
    }
    return token;
  }

  function ensureAnalyses() {
    if (state.analyses) return Promise.resolve(state.analyses);
    if (state.analysesLoading) return state.analysesLoading;
    state.analysesLoading = fetch(ANALYSES_URL, { cache: "force-cache" })
      .then(function (r) {
        return r.ok ? r.json() : {};
      })
      .then(function (data) {
        state.analyses = data && typeof data === "object" ? data : {};
        state.analysesLoading = null;
        return state.analyses;
      })
      .catch(function () {
        state.analyses = {};
        state.analysesLoading = null;
        return state.analyses;
      });
    return state.analysesLoading;
  }

  function analysisForPainting(num) {
    var map = state.analyses || {};
    return map[String(num)] || map[num] || null;
  }

  function analysisForGenerated(num) {
    return state.lod1Analyses[String(num)] || state.lod1Analyses[num] || null;
  }

  function ensureGeneratedAnalysis(num) {
    if (analysisForGenerated(num)) return Promise.resolve(analysisForGenerated(num));
    var paths = [
      "generated-meta/" + num + ".json",
      "/generated-meta/" + num + ".json",
      "generated/" + num + ".json",
      "/generated/" + num + ".json",
    ];
    // Prefer sidecar JSON first (generated-meta/), then legacy co-located
    function trySidecar(i) {
      if (i >= paths.length) return Promise.resolve(null);
      return fetch(paths[i], { cache: "force-cache" })
        .then(function (r) {
          return r.ok ? r.json() : trySidecar(i + 1);
        })
        .catch(function () {
          return trySidecar(i + 1);
        });
    }
    return trySidecar(0)
      .then(function (data) {
        var a = data && (data.analysis || data);
        if (a && (a.description || a.title || a.prompt)) {
          state.lod1Analyses[String(num)] = a;
          state.lod1Analyses[num] = a;
          return a;
        }
        return null;
      })
      .catch(function () {
        return null;
      });
  }

  function hydrateEquippedAnalyses() {
    return ensureAnalyses().then(function () {
      var jobs = state.equipped.map(function (item) {
        if (item.kind === "generated") return ensureGeneratedAnalysis(item.num);
        return Promise.resolve();
      });
      return Promise.all(jobs);
    });
  }

  /**
   * DNA chip from equipped spell (painting or generated), scaled by potency.
   */
  function spellDnaFromItem(item) {
    if (!item) return null;
    var kind = item.kind || "painting";
    var num = item.num;
    var pot = clampPotency(item.potency != null ? item.potency : DEFAULT_POTENCY);
    var a =
      kind === "generated" ? analysisForGenerated(num) || {} : analysisForPainting(num) || {};
    var desc = String(a.description || a.prompt || "").replace(/\s+/g, " ").trim();
    var sentences = desc
      ? desc
          .split(/[.!?]+/)
          .map(function (s) {
            return s.trim();
          })
          .filter(function (s) {
            return s.length > 12;
          })
      : [];
    var fragBudget = pot >= 85 ? 220 : pot >= 65 ? 160 : pot >= 40 ? 110 : pot >= 15 ? 70 : 40;
    var tagN = pot >= 70 ? 5 : pot >= 40 ? 3 : 2;
    var fragment = "";
    if (sentences.length) {
      var take = pot >= 70 ? Math.min(2, sentences.length) : 1;
      fragment = shuffle(sentences).slice(0, take).join(" ").slice(0, fragBudget);
    } else if (desc) {
      fragment = desc.slice(0, fragBudget);
    }
    return {
      key: spellKey(item),
      kind: kind,
      num: num,
      label: item.label || (kind === "generated" ? "G#" + num : "#" + num),
      potency: pot,
      title: String(a.title || "").slice(0, 48),
      mood: String(a.mood || "").slice(0, 40),
      style: String(a.style || "").slice(0, 40),
      medium: String(a.medium || "").slice(0, 24),
      tags: shuffle(a.tags || []).slice(0, tagN),
      colors: shuffle(a.colors || []).slice(0, tagN),
      fragment: fragment,
    };
  }

  function dnaWhisper(chip) {
    var bits = [];
    if (chip.colors && chip.colors.length) bits.push(chip.colors.slice(0, 3).join(", "));
    if (chip.mood) bits.push(chip.mood);
    if (chip.style) bits.push(chip.style);
    if (chip.tags && chip.tags.length) bits.push(chip.tags.slice(0, 3).join(", "));
    if (chip.fragment) bits.push(chip.fragment.slice(0, chip.potency >= 70 ? 160 : 90));
    return bits.join(" · ") || "quiet atmospheric force";
  }

  function equippedDnaChips() {
    return state.equipped
      .map(spellDnaFromItem)
      .filter(Boolean)
      .sort(function (a, b) {
        return b.potency - a.potency;
      });
  }

  /** Exactly 13 depth planes, viewer → ~1000 yards. Each holds dense clutter of its own. */
  var DEPTH_LAYER_DEFS = [
    {
      n: 1,
      dist: "0–6 in",
      name: "grasp rim",
      role: "frame that builds the edges — nearest, sharpest",
      clutter: [
        "hex bolts",
        "cooling vents",
        "status LEDs",
        "cable grommets",
        "brushed alloy grain",
        "countersunk screws",
        "heat-sink fins",
        "seal gaskets",
        "light-pipe edges",
        "embossed circuit traces",
      ],
    },
    {
      n: 2,
      dist: "6–18 in",
      name: "threshold lip",
      role: "inner mechanical lip of the viewport hatch you stepped back from",
      clutter: [
        "iris blade tips",
        "hinge jaws",
        "dust seals",
        "sensor lenses",
        "rivet rows",
        "vent grilles",
        "fiber filaments",
        "oil-sheen metal",
        "port shutters",
        "servo housings",
      ],
    },
    {
      n: 3,
      dist: "2–8 ft",
      name: "spell veil",
      role: "spell DNA as translucent data-atmosphere ABOVE mid paint — never paste source paintings",
      clutter: [
        "phosphor haze",
        "soft scan dust",
        "color-temperature bands",
        "ghost glyph films (unreadable)",
        "volumetric light sheets",
        "interference shimmer",
        "cool cyan wash",
        "echo silhouettes",
        "hologram grain",
        "mood fog ribbons",
      ],
    },
    {
      n: 4,
      dist: "8–25 ft",
      name: "new mid skin",
      role: "newly made layer under the spell veil",
      clutter: [
        "fresh brush ridges",
        "wet glints",
        "small props mid-air",
        "path stones",
        "hanging charms",
        "paper scraps",
        "lantern glass shards",
        "floating petals",
        "wire loops",
        "tiny furniture ghosts",
      ],
    },
    {
      n: 5,
      dist: "25–60 ft",
      name: "near courtyard",
      role: "first walkable room of the world",
      clutter: [
        "scattered chairs",
        "broken tiles",
        "puddle mirrors",
        "leaning ladders",
        "stacked crates",
        "hanging laundry",
        "bird cages",
        "potted weeds",
        "street lamps",
        "market debris",
      ],
    },
    {
      n: 6,
      dist: "60–120 ft",
      name: "arcade / arcade haze",
      role: "arches and repeat structures compressing scale",
      clutter: [
        "column forest",
        "hanging signs (blank)",
        "rope bridges",
        "balcony clutter",
        "window eyes",
        "draped cloth",
        "stacked books",
        "bird flocks",
        "steam vents",
        "awning stripes",
      ],
    },
    {
      n: 7,
      dist: "120–250 ft",
      name: "mid plaza",
      role: "open middle ground still readable",
      clutter: [
        "fountain spray",
        "crowd silhouettes",
        "cart wheels",
        "banner poles",
        "statue fragments",
        "market tents",
        "oil drums",
        "scaffold towers",
        "kite strings",
        "mirror panels",
      ],
    },
    {
      n: 8,
      dist: "250–450 ft",
      name: "district belt",
      role: "city/landscape band of many small events",
      clutter: [
        "rooftop gardens",
        "chimney forests",
        "antenna thickets",
        "bridge ribs",
        "train cars",
        "water towers",
        "greenhouse glass",
        "crane arms",
        "billboard blanks",
        "smoke stacks",
      ],
    },
    {
      n: 9,
      dist: "450–700 ft",
      name: "far belt",
      role: "denser far clutter, smaller scale",
      clutter: [
        "grid of windows",
        "orchard rows",
        "antenna needles",
        "ship masts",
        "turbine blades",
        "hill villages",
        "pipeline snakes",
        "billowing laundry fields",
        "crane flocks",
        "glasshouse seas",
      ],
    },
    {
      n: 10,
      dist: "700–1000 ft",
      name: "horizon clutter",
      role: "busy horizon line of micro-events",
      clutter: [
        "skyline teeth",
        "smokestack dots",
        "bridge threads",
        "caravan dots",
        "lighthouse blinks",
        "tower needles",
        "cloud machinery",
        "floating barges",
        "antenna forest",
        "ruin ribs",
      ],
    },
    {
      n: 11,
      dist: "~300–500 yd",
      name: "prior world bones",
      role: "previous variation / buried world structure under spells (if any)",
      clutter: [
        "ghost architecture",
        "faded plazas",
        "echo bridges",
        "memory windows",
        "half-erased towers",
        "soft ruin piles",
        "old path scars",
        "dim lantern fields",
        "sunk rooftops",
        "pale monument stubs",
      ],
    },
    {
      n: 12,
      dist: "~500–800 yd",
      name: "deep weather clutter",
      role: "weather and particle density of the far interior",
      clutter: [
        "rain curtains",
        "ash snow",
        "plaid fog bands",
        "dust columns",
        "lightning needles",
        "spore clouds",
        "mirage shelves",
        "ice glitter",
        "pollen storms",
        "shadow flocks",
      ],
    },
    {
      n: 13,
      dist: "~800–1000+ yd",
      name: "farthest interior",
      role: "ultimate 1000-yard stare vanishing — still cluttered, tiny",
      clutter: [
        "pin-light cities",
        "horizon machines",
        "tiny processions",
        "second-sky seams",
        "moon-door flecks",
        "vortex lint",
        "lantern constellations",
        "inverted city crumbs",
        "stair-to-nowhere dots",
        "glowing seed orbs",
      ],
    },
  ];

  /** Alien computer in an alien world; pyramid optical illusion depth (no inception recursion). */
  var CRAFT_MODES = [
    "stunning pyramid optical illusion through a mechanical alien-computer viewport",
    "forced-perspective pyramid tunnel — hard metal bezel, crystalline depth, museum-quality light",
    "xeno-tech shrine: machine rim + monumental triangular recession, not recursive copies",
    "painterly impossible-pyramid vista — one continuous space, stepped planes, dazzling geometry",
  ];

  var DEPTH_LIGHT = [
    "hard speculars on metal bezel; long raking light that carves pyramid facets into the deep field",
    "cool phosphor on the chassis; warm alien sun catching triangular planes like polished stone",
    "rim LEDs answering a single distant apex glow — not repeated mini-suns",
    "high-contrast chiaroscuro: sharp near metal, luminous mid facets, soft haze only at the vanishing apex",
  ];

  /** Mechanical alien-computer borders (machine in a world, not a desktop). */
  var HYLIC_RIMS = [
    "machined alien bezel planted in strange ground: brushed black metal, hex bolts, vents, LEDs",
    "angular viewport housing with riveted plates, gear teeth, cable ports — chassis in alien dust",
    "CRT-style alloy hood with screws, grilles, and cyan light-bars under a foreign sky",
    "segmented armor bezel with hex panels, magnetic latches, light-pipes — temple machine in open air",
    "industrial monitor frame: anodized rails, hinge jaws, dust seals on otherworld stone",
    "metal iris of blade segments and servo housings framing a triangular optical tunnel",
    "console lip of matte alloy, heat-sink fins, embossed circuit grain — no organic collage",
    "brutalist machine edge: thick steel, countersunk fasteners, sensor stubs, oil-sheen metal",
  ];

  var TITLE_A = [
    "Pyramid Gate",
    "Apex Tunnel",
    "Triune Depth",
    "Facet Stare",
    "Ziggurat View",
    "Machine Apex",
    "Optical Pyramid",
    "Bezel & Peak",
    "Forced Path",
    "Crystal Stair",
  ];
  var TITLE_B = [
    "of the Alien Computer",
    "of Forced Perspective",
    "with Mechanical Border",
    "of the Far Apex",
    "of Stepped Planes",
    "of Illusion Depth",
    "of Polished Facets",
    "of the 1000-Yard Peak",
    "of Hard Geometry",
    "of the Vanishing Point",
  ];

  function inventTitle(seed) {
    return pick(TITLE_A) + " " + pick(TITLE_B) + " · " + String(seed).slice(0, 6);
  }

  function pickClutter(pool, count) {
    return shuffle(pool).slice(0, count || 3).join(", ");
  }

  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  function ensureSpaceLayers() {
    if (state.spaceLayers && state.spaceLayers.length === LAYER_COUNT) {
      return state.spaceLayers;
    }
    state.spaceLayers = defaultSpaceLayers();
    return state.spaceLayers;
  }

  function defaultSpaceLayers() {
    var layers = [];
    for (var i = 0; i < LAYER_COUNT; i++) {
      layers.push({
        /** 0–1 position in free room of parent (0.5 = centered). */
        ox: 0.5,
        oy: 0.5,
        scale: i === 0 ? L1_SCALE : DEFAULT_CHILD_SCALE,
      });
    }
    return layers;
  }

  /**
   * Absolute rects in a unit square [0,1]² — L1 outermost, each nested inside previous.
   */
  function computeSpaceRectsUnit() {
    var layers = ensureSpaceLayers();
    var rects = [];
    var px = 0;
    var py = 0;
    var pw = 1;
    var ph = 1;
    for (var i = 0; i < LAYER_COUNT; i++) {
      var L = layers[i];
      var scale = clamp(L.scale, 0.55, 0.96);
      var w = pw * scale;
      var h = ph * scale;
      var freeX = Math.max(0, pw - w);
      var freeY = Math.max(0, ph - h);
      var ox = clamp(L.ox, 0, 1);
      var oy = clamp(L.oy, 0, 1);
      L.ox = ox;
      L.oy = oy;
      L.scale = scale;
      var x = px + freeX * ox;
      var y = py + freeY * oy;
      rects.push({
        n: i + 1,
        x: x,
        y: y,
        w: w,
        h: h,
        cx: x + w / 2,
        cy: y + h / 2,
      });
      px = x;
      py = y;
      pw = w;
      ph = h;
    }
    return rects;
  }

  /**
   * Stylization only: nested geometry = shape of the stare (pyramid optical form),
   * centered on the image's flat-Z centerpoint — not content, not inception.
   */
  function geometrySpaceBlock() {
    var rects = computeSpaceRectsUnit();
    var parts = rects.map(function (r) {
      return (
        "L" +
        r.n +
        "@" +
        (r.cx * 100).toFixed(0) +
        "," +
        (r.cy * 100).toFixed(0) +
        "s" +
        (r.w * 100).toFixed(0)
      );
    });
    var r1 = rects[0];
    var r13 = rects[12];
    var ecc =
      Math.hypot(r13.cx - r1.cx, r13.cy - r1.cy) > 0.06
        ? "apex slightly off flat-Z center (dynamic pull)"
        : "apex locked to flat-Z center of the screen";
    return (
      "STARE SHAPE / STYLIZATION (geometry only — does NOT invent content):\n" +
      "The picture plane is a FLAT Z. The optical CENTERPOINT is the flat-Z center of the image. " +
      ecc +
      ". Nested apertures shape a pyramid-illusion stare (forced perspective, stepped facets to one apex) — " +
      "stylize HOW we look, not WHAT we see. Do NOT draw UI squares or wireframe diagrams. Nest guide: " +
      parts.join(" ") +
      "\n"
    );
  }

  function zFlowMode() {
    return Math.random() < 0.5 ? "inward" : "outward";
  }

  function zFlowBlock(mode) {
    if (mode === "outward") {
      return (
        "FLAT-Z MOTION (mandatory):\n" +
        "Everything appears to RUSH OUTWARD toward the viewer / emerge from depth toward the flat-Z centerpoint of the screen — " +
        "as if the walls and volumes are pressing forward into the glass. Near field densest and largest; far soft. " +
        "One continuous space — no inception, no nested copies of the same scene.\n"
      );
    }
    return (
      "FLAT-Z MOTION (mandatory):\n" +
      "Everything FALLS INWARD toward the flat-Z centerpoint of the screen — walls and volumes recede into the stare, " +
      "pulled into the optical apex. Near field densest; far soft at ~1000 yards. " +
      "One continuous space — no inception, no nested copies of the same scene.\n"
    );
  }

  /**
   * Spell DNA owns walls + dimensions (content). Potency scales force.
   */
  function spellWallsAndDimensions(chips) {
    if (!chips || !chips.length) {
      return (
        "SPELL WALLS / DIMENSIONS: no spells equipped — invent walls and volumes freely, but keep flat-Z center motion.\n"
      );
    }
    var ranked = chips.slice().sort(function (a, b) {
      return b.potency - a.potency;
    });
    var roles = [
      "NEAR WALL / rim-volume language (what the closest surfaces are made of and feel like)",
      "SIDE WALL / corridor language (left-right dimensions and side plane material)",
      "DEEP WALL / far volume language (what recedes toward the apex / centerpoint)",
      "OUTWARD-OR-INWARD surge motifs (particles, figures, structures that move on the Z axis)",
      "PALETTE & LIGHT material (color temperature and luminous matter of the walls)",
      "ATMOSPHERE fill (fog, dust, fluid, signal between walls)",
    ];
    var lines = [
      "SPELL WALLS & DIMENSIONS (CONTENT — honor potencies; transform, never paste source images):",
      "The walls, floors, ceilings, and spatial dimensions of the stare ARE built from spell information.",
      "Higher potency = that spell dominates that wall/volume language.",
    ];
    ranked.forEach(function (c, i) {
      var role = roles[i % roles.length];
      var src = c.kind === "generated" ? "generated G#" + c.num : "painting #" + c.num;
      lines.push(
        "· " +
          c.label +
          " (" +
          src +
          ") @" +
          c.potency +
          "% " +
          potencyWord(c.potency) +
          " → " +
          role +
          (c.title ? " | “" + c.title + "”" : "") +
          ": " +
          dnaWhisper(c)
      );
    });
    lines.push(
      "Fuse these into ONE coherent architecture of walls and dimensions around the flat-Z centerpoint — " +
        "spell-true materials and motifs, not generic stock scenery."
    );
    return lines.join("\n") + "\n";
  }

  /** Subject is synthesized from spells + idea — not a random unrelated kernel. */
  function inventSceneSubject(chips, idea) {
    var ranked = (chips || []).slice().sort(function (a, b) {
      return (b.potency || 0) - (a.potency || 0);
    });
    if (!ranked.length) {
      return (
        (idea
          ? "World intention: “" + idea.slice(0, 160) + "”. "
          : "Invent a striking original world. ") +
        "Walls and volumes must still obey flat-Z centerpoint motion."
      );
    }
    var top = ranked[0];
    var bits = ranked
      .filter(function (c) {
        return c.potency >= 20;
      })
      .slice(0, 4)
      .map(function (c) {
        return (
          c.label +
          "@" +
          c.potency +
          "%:" +
          (c.title ? " “" + c.title + "”" : "") +
          " " +
          dnaWhisper(c).slice(0, c.potency >= 65 ? 140 : 80)
        );
      });
    return (
      "Spell-driven world (PRIMARY CONTENT): invent a NEW scene whose walls, dimensions, props, palette, and figures " +
      "are visibly informed by these spell forces (transform — do not recreate the source images). " +
      "Lead force " +
      top.label +
      " @" +
      top.potency +
      "% " +
      potencyWord(top.potency) +
      ". " +
      bits.join(" || ") +
      (idea
        ? " User intention (blend with spells, never as a flat label): “" + idea.slice(0, 140) + "”."
        : "")
    );
  }

  /** Shape stylization of the stare (how we look) — not what the walls are made of. */
  function styleShapeBlock(rimRecipe, mood, mode, light) {
    return (
      "STARE SHAPE STYLIZATION (HOW it looks — secondary to spell walls):\n" +
      "- Optical shape: pyramid / forced-perspective tunnel to a single apex at the flat-Z centerpoint — stunning, clear, no inception recursion.\n" +
      "- Frame guide: " +
      frameGuideLine() +
      ".\n" +
      "- Mechanical bezel flavor (stylize the rim only): " +
      rimRecipe +
      ".\n" +
      "- Light stylization: " +
      light +
      ".\n" +
      "- Mode: " +
      mode +
      ". Mood: " +
      mood +
      ".\n" +
      "- The shape of the stare (nested geometry, pyramid illusion, metal rim language) is STYLIZATION. " +
      "Spell DNA still owns wall materials, side planes, deep volumes, and Z-axis motion content.\n" +
      "- No HUD, watermark, readable text, OS windows, or photo collage panels.\n"
    );
  }

  function noveltyGuardBlock(seed) {
    var recent = (state.recentSeeds || []).slice(-8).join(", ");
    return (
      "NOVELTY LOCK:\n" +
      "- Brand-new painting informed by the equipped spells — not a recolor of a previous gen.\n" +
      "- BOTH: spell-true walls/dimensions AND stare-shape stylization (flat-Z center, pyramid optical form).\n" +
      "- Do not paste source images. Do not invent a generic scene that ignores spell potencies.\n" +
      "- No nested-inception copies; one continuous space.\n" +
      "- Seed " +
      seed +
      (recent ? ". Avoid recent seeds: " + recent : "") +
      ".\n"
    );
  }

  function updateSpaceReadout() {
    var el = $("stare-space-readout");
    if (!el) return;
    var rects = computeSpaceRectsUnit();
    var r1 = rects[0];
    var r13 = rects[12];
    var hover = state.spaceHover >= 0 ? rects[state.spaceHover] : null;
    var bits = [
      "L1 " +
        (r1.w * 100).toFixed(0) +
        "% · L13 " +
        (r13.w * 100).toFixed(0) +
        "% at (" +
        (r13.cx * 100).toFixed(0) +
        "%, " +
        (r13.cy * 100).toFixed(0) +
        "%)",
    ];
    if (hover) {
      bits.unshift(
        "Dragging/hover L" +
          hover.n +
          " · stays inside L" +
          (hover.n === 1 ? "view" : String(hover.n - 1))
      );
    }
    el.textContent = bits.join(" · ");
  }

  function spaceCanvasSize() {
    var stage = $("stare-space-stage");
    var canvas = $("stare-space");
    if (!stage || !canvas) return { w: 0, h: 0, canvas: null };
    var rect = stage.getBoundingClientRect();
    var cssW = Math.max(120, Math.floor(rect.width));
    var cssH = Math.max(120, Math.floor(rect.height || rect.width));
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = Math.floor(cssW * dpr);
    var h = Math.floor(cssH * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    return { w: w, h: h, cssW: cssW, cssH: cssH, dpr: dpr, canvas: canvas };
  }

  function drawSpaceView() {
    var sz = spaceCanvasSize();
    var canvas = sz.canvas;
    if (!canvas || !sz.w) return;
    var ctx = canvas.getContext("2d");
    if (!ctx) return;
    var W = sz.w;
    var H = sz.h;
    var pad = Math.min(W, H) * 0.04;
    var side = Math.min(W, H) - pad * 2;
    var ox = (W - side) / 2;
    var oy = (H - side) / 2;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#05040c";
    ctx.fillRect(0, 0, W, H);

    // faint ground grid
    ctx.strokeStyle = "rgba(255,255,255,0.04)";
    ctx.lineWidth = 1;
    for (var g = 0; g <= 8; g++) {
      var t = ox + (side * g) / 8;
      ctx.beginPath();
      ctx.moveTo(t, oy);
      ctx.lineTo(t, oy + side);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(ox, oy + (side * g) / 8);
      ctx.lineTo(ox + side, oy + (side * g) / 8);
      ctx.stroke();
    }

    var unit = computeSpaceRectsUnit();
    var pxRects = unit.map(function (r) {
      return {
        n: r.n,
        x: ox + r.x * side,
        y: oy + r.y * side,
        w: r.w * side,
        h: r.h * side,
      };
    });

    // fill from outside in with translucent depth tint
    for (var i = 0; i < pxRects.length; i++) {
      var r = pxRects[i];
      var t01 = i / (LAYER_COUNT - 1);
      var isVeil = r.n === 3;
      var isDeep = r.n >= 11;
      var fill = isVeil
        ? "rgba(90, 110, 200, " + (0.1 + t01 * 0.04) + ")"
        : isDeep
          ? "rgba(40, 50, 90, " + (0.06 + t01 * 0.05) + ")"
          : "rgba(200, 180, 140, " + (0.03 + (1 - t01) * 0.04) + ")";
      ctx.fillStyle = fill;
      ctx.fillRect(r.x, r.y, r.w, r.h);
    }

    // stroke rings (outer first so labels readable)
    for (var j = 0; j < pxRects.length; j++) {
      var pr = pxRects[j];
      var active = state.spaceHover === j || (state.spaceDrag && state.spaceDrag.idx === j);
      var veil = pr.n === 3;
      ctx.lineWidth = active ? Math.max(2, side * 0.006) : Math.max(1, side * 0.0035);
      if (veil) {
        ctx.strokeStyle = active ? "rgba(180, 200, 255, 0.95)" : "rgba(140, 160, 230, 0.75)";
      } else if (pr.n >= 11) {
        ctx.strokeStyle = active ? "rgba(160, 180, 255, 0.9)" : "rgba(100, 120, 180, 0.55)";
      } else {
        ctx.strokeStyle = active
          ? "rgba(255, 230, 180, 0.95)"
          : "rgba(220, 200, 160, " + (0.35 + (1 - j / 13) * 0.4) + ")";
      }
      ctx.strokeRect(pr.x + 0.5, pr.y + 0.5, pr.w - 1, pr.h - 1);

      var label = "L" + pr.n;
      var fs = Math.max(9, Math.min(14, pr.w * 0.08));
      ctx.font = "600 " + fs + "px system-ui, sans-serif";
      ctx.fillStyle = active ? "rgba(255,245,220,0.95)" : "rgba(230,220,200,0.7)";
      ctx.textBaseline = "top";
      ctx.fillText(label, pr.x + fs * 0.35, pr.y + fs * 0.3);
    }

    state._spaceMap = { ox: ox, oy: oy, side: side, pxRects: pxRects, unit: unit };
    updateSpaceReadout();
  }

  function hitSpaceLayer(clientX, clientY) {
    var canvas = $("stare-space");
    var map = state._spaceMap;
    if (!canvas || !map) return -1;
    var rect = canvas.getBoundingClientRect();
    var x = ((clientX - rect.left) / rect.width) * canvas.width;
    var y = ((clientY - rect.top) / rect.height) * canvas.height;
    var pxRects = map.pxRects;
    // Innermost first for ring: point in rect i but not in child i+1
    for (var i = pxRects.length - 1; i >= 0; i--) {
      var r = pxRects[i];
      if (x < r.x || y < r.y || x > r.x + r.w || y > r.y + r.h) continue;
      if (i < pxRects.length - 1) {
        var c = pxRects[i + 1];
        if (x >= c.x && y >= c.y && x <= c.x + c.w && y <= c.y + c.h) {
          continue;
        }
      }
      return i;
    }
    // fallback: any containing rect, outermost preference if in padding of view
    for (var k = 0; k < pxRects.length; k++) {
      var rr = pxRects[k];
      if (x >= rr.x && y >= rr.y && x <= rr.x + rr.w && y <= rr.y + rr.h) return k;
    }
    return -1;
  }

  function bindSpaceView() {
    if (state.spaceBound) {
      drawSpaceView();
      return;
    }
    var stage = $("stare-space-stage");
    var canvas = $("stare-space");
    if (!stage || !canvas) return;
    state.spaceBound = true;
    ensureSpaceLayers();

    function onDown(e) {
      if (e.button != null && e.button !== 0) return;
      drawSpaceView();
      var idx = hitSpaceLayer(e.clientX, e.clientY);
      if (idx < 0) return;
      e.preventDefault();
      var layers = ensureSpaceLayers();
      state.spaceDrag = {
        idx: idx,
        startX: e.clientX,
        startY: e.clientY,
        origOx: layers[idx].ox,
        origOy: layers[idx].oy,
        pointerId: e.pointerId,
      };
      state.spaceHover = idx;
      stage.classList.add("is-dragging");
      if (stage.setPointerCapture) {
        try {
          stage.setPointerCapture(e.pointerId);
        } catch (err) {}
      }
      drawSpaceView();
    }

    function onMove(e) {
      if (!state.spaceDrag) {
        var h = hitSpaceLayer(e.clientX, e.clientY);
        if (h !== state.spaceHover) {
          state.spaceHover = h;
          drawSpaceView();
        }
        return;
      }
      e.preventDefault();
      var map = state._spaceMap;
      if (!map) return;
      var canvasEl = $("stare-space");
      var crect = canvasEl.getBoundingClientRect();
      var dprX = canvasEl.width / crect.width;
      var dprY = canvasEl.height / crect.height;
      var dxPx = (e.clientX - state.spaceDrag.startX) * dprX;
      var dyPx = (e.clientY - state.spaceDrag.startY) * dprY;
      var side = map.side;
      var idx = state.spaceDrag.idx;
      var layers = ensureSpaceLayers();
      var unit = computeSpaceRectsUnit();

      // Parent free room in unit space
      var parentW = 1;
      var parentH = 1;
      if (idx > 0) {
        parentW = unit[idx - 1].w;
        parentH = unit[idx - 1].h;
      }
      var scale = layers[idx].scale;
      var childW = parentW * scale;
      var childH = parentH * scale;
      var freeX = Math.max(1e-6, parentW - childW);
      var freeY = Math.max(1e-6, parentH - childH);
      // Convert pixel delta to free-room fraction
      var dOx = dxPx / side / freeX;
      var dOy = dyPx / side / freeY;
      layers[idx].ox = clamp(state.spaceDrag.origOx + dOx, 0, 1);
      layers[idx].oy = clamp(state.spaceDrag.origOy + dOy, 0, 1);
      // Nested depth: children stay relative; recompute clamps cascade via compute
      computeSpaceRectsUnit();
      drawSpaceView();
    }

    function onUp(e) {
      if (!state.spaceDrag) return;
      if (e.pointerId != null && state.spaceDrag.pointerId !== e.pointerId) return;
      state.spaceDrag = null;
      stage.classList.remove("is-dragging");
      drawSpaceView();
    }

    stage.addEventListener("pointerdown", onDown);
    stage.addEventListener("pointermove", onMove);
    stage.addEventListener("pointerup", onUp);
    stage.addEventListener("pointercancel", onUp);
    stage.addEventListener("pointerleave", function () {
      if (!state.spaceDrag) {
        state.spaceHover = -1;
        drawSpaceView();
      }
    });

    window.addEventListener("resize", function () {
      drawSpaceView();
    });

    drawSpaceView();
  }

  function resetSpaceGeometry() {
    state.spaceLayers = defaultSpaceLayers();
    state.spaceHover = -1;
    state.spaceDrag = null;
    drawSpaceView();
    setStatus("Depth geometry reset — nested L1→L13 centered.", "ok");
  }

  function craftQualityBlock(mood, mode) {
    return (
      "CRAFT FINISH: " +
      mode +
      ". Mood: " +
      mood +
      ". Full-bleed and visually stunning; spell walls readable; " +
      "flat-Z center motion obvious; pyramid stare shape is style only; no inception clutter.\n"
    );
  }

  function frameGuideLine() {
    return (
      {
        worlds: "mechanical border between machine-space and the painted world inside",
        threshold: "hatch / iris / sealed viewport you stepped back from",
        frame: "machined picture-bezel almost within arm's reach — metal, bolts, vents",
        nature: "bio-mechanical rim: alloy veins, sensor roots, coolant mist at the lip",
        city: "console aperture: rack rails, cable trays, panel lips",
        abstract: "geometric machine lip of panels, light-bars, and engraved circuit grain",
      }[frameKind()] || "mechanical alien-computer frame that builds the edges"
    );
  }

  function moodLine() {
    return (
      {
        vast: "solemn vast depth",
        eerie: "eerie liminal hush",
        tender: "tender distance",
        cosmic: "cosmic scale, quiet awe",
        storm: "storm-lit drama held in balance",
      }[moodValue()] || "solemn vast depth"
    );
  }

  /** Sample 4 depth planes with fresh clutter so the stack stays readable without a novel-length list. */
  function depthPlanesBrief() {
    var picks = [0, 2, 5, 12]; // L1, L3 veil, L6, L13
    return picks
      .map(function (i) {
        var layer = DEPTH_LAYER_DEFS[i];
        return (
          "L" +
          layer.n +
          " (" +
          layer.dist +
          ") " +
          layer.name +
          ": " +
          pickClutter(layer.clutter, 3)
        );
      })
      .join("\n");
  }

  /**
   * BOTH: spell-owned walls/dimensions + stare-shape stylization on flat-Z centerpoint.
   */
  function buildStareCast(options) {
    options = options || {};
    var idea = userIdea();
    var seed = uniqueSeedToken();
    var title = inventTitle(seed);
    var chips = equippedDnaChips();
    var subject = inventSceneSubject(chips, idea);
    var mode = pick(CRAFT_MODES);
    var mood = moodLine();
    var light = pick(DEPTH_LIGHT);
    var rim = pick(HYLIC_RIMS);
    var zFlow = zFlowMode();

    state.lastSubject = subject;

    var prompt = (
      "CREATE ONE BRAND-NEW full-bleed fine-art painting. Follow every line in order.\n\n" +
      noveltyGuardBlock(seed) +
      "\n" +
      "=== A) SPELL CONTENT (walls, dimensions, what fills space) — PRIMARY ===\n" +
      spellWallsAndDimensions(chips) +
      "\n" +
      "Spell-driven subject:\n" +
      subject +
      "\n\n" +
      "=== B) FLAT-Z CENTERPOINT MOTION ===\n" +
      zFlowBlock(zFlow) +
      "\n" +
      "=== C) STARE SHAPE STYLIZATION (how the stare is shaped — SECONDARY to spells) ===\n" +
      styleShapeBlock(rim, mood, mode, light) +
      geometrySpaceBlock() +
      "\n" +
      "Depth plane samples (style steps only — fill each plane's surfaces with SPELL wall materials from A):\n" +
      depthPlanesBrief() +
      "\n\n" +
      craftQualityBlock(mood, mode) +
      "TITLE: " +
      title +
      " · Z-flow: " +
      zFlow +
      (options.variationNote ? "\n" + options.variationNote + "\n" : "")
    ).slice(0, 4500);

    var potBuzz = chips
      .filter(function (c) {
        return c.potency >= 50;
      })
      .slice(0, 4)
      .map(function (c) {
        return c.label + " " + c.potency + "%";
      });

    var buzz = shuffle(
      [
        "spell walls",
        "spell dimensions",
        "flat Z centerpoint",
        zFlow === "outward" ? "rushing outward" : "falling inward",
        "pyramid stare shape",
        "spell potency",
        "both content and style",
        "no inception",
        mood.split(" ")[0],
        frameKind(),
        seed.slice(0, 6),
      ]
        .concat(potBuzz)
        .concat(
          chips.reduce(function (acc, c) {
            return acc.concat((c.tags || []).slice(0, 1));
          }, [])
        )
    ).slice(0, 14);

    return {
      prompt: prompt,
      title: title,
      seed: seed,
      buzz: buzz,
      subject: subject,
      rim: rim,
      zFlow: zFlow,
      potencies: chips.map(function (c) {
        return { key: c.key, label: c.label, potency: c.potency, kind: c.kind, num: c.num };
      }),
    };
  }

  function showPreview(url) {
    state.imageUrl = url || "";
    var img = $("stare-preview");
    var empty = $("stare-empty");
    if (img) {
      if (url) {
        img.src = absUrl(url);
        img.hidden = false;
      } else {
        img.removeAttribute("src");
        img.hidden = true;
      }
    }
    if (empty) {
      empty.hidden = !!url;
      empty.setAttribute("aria-hidden", url ? "true" : "false");
    }
    var save = $("stare-save");
    var imm = $("stare-immerse");
    if (save) save.disabled = state.busy || !url;
    if (imm) imm.disabled = state.busy || !url;
  }

  function extractImageUrl(payload) {
    if (!payload) return "";
    var img = payload.image || (payload.images && payload.images[0]);
    var raw =
      (img && (img.url || img.download_url || img.uri)) ||
      payload.image_url ||
      payload.output_url ||
      "";
    return absUrl(raw);
  }

  function delay(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function pollJob(jobId, left, statusLabel) {
    if (left == null) left = 90;
    var label = statusLabel || "Building frame edges";
    if (left <= 0) return Promise.reject(new Error("Timed out waiting for stare image."));
    return fetch(apiUrl("/api/jobs/" + encodeURIComponent(jobId)), { cache: "no-store" })
      .then(function (r) {
        return r.json().then(function (d) {
          return { ok: r.ok, d: d };
        });
      })
      .then(function (res) {
        var job = res.d || {};
        var st = String(job.status || "working").toLowerCase();
        setStatus(label + "… " + st);
        if (st === "done" || st === "completed" || st === "success") {
          var url = extractImageUrl(job);
          if (url) return url;
          throw new Error("Job done but no image URL.");
        }
        if (st === "failed" || st === "error" || st === "expired") {
          throw new Error((job.error && (job.error.message || job.error)) || "Generate failed");
        }
        return delay(1500).then(function () {
          return pollJob(jobId, left - 1, label);
        });
      });
  }

  /** Subject/atmosphere twists for each variation click — force new invention. */
  var PIPELINE_MODIFIERS = [
    "New alien terrain around the computer (different ground, sky, weather)",
    "Swap mechanical bezel family (iris ↔ CRT hood ↔ hex armor ↔ gear ring ↔ vented chassis)",
    "Stronger pyramid illusion: clearer facet planes and forced-perspective lines to one apex",
    "Change pyramid material (basalt / mirror alloy / glass / light / green metal) — still one structure",
    "Off-axis apex for more dramatic optical pull",
    "Longer shadow drama on stepped terraces; single summit light",
    "Cooler phosphor on metal, warmer alien sun on stone facets",
    "More monumental scale — tiny figures against huge pyramid planes",
    "Inverted or floating tetrahedron as the far mass (still one object, not nested clones)",
    "Hard industrial metal vs sleek xeno-alloy bezel — commit; keep pyramid depth stunning",
  ];

  function pickPipelineModifiers(count, used) {
    used = used || [];
    var pool = shuffle(PIPELINE_MODIFIERS);
    var out = [];
    for (var i = 0; i < pool.length && out.length < count; i++) {
      if (used.indexOf(pool[i]) >= 0) continue;
      out.push(pool[i]);
    }
    while (out.length < count) {
      out.push(pick(PIPELINE_MODIFIERS) + " (re-roll " + uniqueSeedToken().slice(0, 4) + ")");
    }
    return out;
  }

  function stackModifiersBlock(modifiers) {
    if (!modifiers || !modifiers.length) return "";
    return (
      "\nCraft modifiers from earlier steps (keep beauty; later lines refine gently):\n" +
      modifiers
        .map(function (m, i) {
          return "  " + (i + 1) + ". " + m;
        })
        .join("\n") +
      "\n"
    );
  }

  /**
   * One variation click = a NEW invention (same rails), never a refine of the last image.
   */
  function buildVariationStepPrompt(step, modifiers) {
    var note =
      "VARIATION STEP " +
      step +
      " (single click): invent a DIFFERENT new scene with the same stare rails. " +
      "Do not polish or recolor the previous still. " +
      (modifiers && modifiers.length
        ? "Extra twist this step: " + modifiers[modifiers.length - 1]
        : "Change subject, palette event, and mid-ground action.");
    var cast = buildStareCast({ variationNote: note });
    cast.step = step;
    cast.modifiers = (modifiers || []).slice();
    cast.title =
      String(cast.title)
        .replace(/\s*·\s*s\d+.*$/i, "")
        .trim() +
      " · s" +
      step +
      " · " +
      cast.seed.slice(0, 5);
    // Rebuild prompt title line consistency is fine; body already has TITLE
    cast.prompt = cast.prompt.replace(/TITLE:.*$/m, "TITLE: " + cast.title);
    return cast;
  }

  function runStasisRequest(body, statusLabel) {
    var jobId = body.job_id;
    setStatus(statusLabel || "Generating…");
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
          return pollJob(d.job_id || jobId, 90, statusLabel);
        }
        if (!res.ok) throw new Error((d && d.error) || "Generate failed");
        var url = extractImageUrl(d);
        if (!url && d.job_id) return pollJob(d.job_id, 90, statusLabel);
        if (!url) throw new Error("No image returned");
        return url;
      });
  }

  /* —— Spell tray (paintings + generated) —— */
  function loadSpellPool() {
    if (state.poolReady && state.pool.length) {
      if (!state.tray.length) fillTray();
      renderTray();
      renderEquipped();
      return;
    }
    setStatus("Loading paintings + generated spells…");
    var paintings = [];
    for (var i = 1; i <= 1000; i++) {
      paintings.push({
        kind: "painting",
        num: i,
        url: paintingUrl(i),
        label: "#" + i,
      });
    }

    fetch(apiUrl("/api/dream-pool"), { cache: "no-store" })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (d) {
        var gens = [];
        var nums = (d && d.generated_nums) || [];
        var files = (d && d.generated_files) || [];
        if (nums.length) {
          nums.forEach(function (n) {
            n = parseInt(n, 10);
            if (!n) return;
            gens.push({
              kind: "generated",
              num: n,
              url: generatedUrl(n),
              label: "G#" + n,
            });
          });
        } else if (files.length) {
          files.forEach(function (f) {
            var n =
              typeof f === "object"
                ? parseInt(f.num != null ? f.num : f.number, 10)
                : parseInt(f, 10);
            var url =
              typeof f === "object" && f.url
                ? f.url
                : n
                  ? generatedUrl(n)
                  : "";
            if (!n && !url) return;
            if (!n && url) {
              var m = String(url).match(/(\d+)\.(?:jpg|jpeg|png|webp)/i);
              n = m ? parseInt(m[1], 10) : 0;
            }
            if (!n) return;
            gens.push({
              kind: "generated",
              num: n,
              url: url || generatedUrl(n),
              label: "G#" + n,
            });
          });
        }
        state.pool = paintings.concat(gens);
        state.poolReady = true;
        fillTray();
        renderTray();
        renderEquipped();
        setStatus(
          "Tray ready — " +
            paintings.length +
            " paintings + " +
            gens.length +
            " generated. Equip & set potency.",
          "ok"
        );
      })
      .catch(function () {
        state.pool = paintings;
        state.poolReady = true;
        fillTray();
        renderTray();
        renderEquipped();
        setStatus("Tray: paintings only (generated pool unavailable).", "err");
      });
  }

  function filteredPool() {
    var f = state.trayFilter || "all";
    if (f === "all") return state.pool.slice();
    return state.pool.filter(function (item) {
      return item.kind === f;
    });
  }

  function fillTray() {
    var copy = filteredPool();
    for (var i = copy.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = copy[i];
      copy[i] = copy[j];
      copy[j] = tmp;
    }
    state.tray = copy.slice(0, TRAY_SIZE);
  }

  function setTrayFilter(filter) {
    state.trayFilter = filter || "all";
    document.querySelectorAll(".stare-filter-btn").forEach(function (btn) {
      btn.classList.toggle("is-active", btn.getAttribute("data-filter") === state.trayFilter);
    });
    fillTray();
    renderTray();
  }

  function renderTray() {
    var strip = $("stare-spell-strip");
    var count = $("stare-tray-count");
    if (!strip) return;
    strip.innerHTML = "";
    state.tray.forEach(function (item, idx) {
      var el = document.createElement("button");
      el.type = "button";
      el.className =
        "stare-spell" + (item.kind === "generated" ? " is-generated" : " is-painting");
      el.dataset.idx = String(idx);
      el.title = "Equip " + item.label + " (" + item.kind + ")";
      var img = document.createElement("img");
      img.src = item.url;
      img.alt = item.label;
      img.loading = "lazy";
      var lab = document.createElement("span");
      lab.textContent = item.label;
      el.appendChild(img);
      el.appendChild(lab);
      el.addEventListener("click", function () {
        equipSpell(item);
      });
      strip.appendChild(el);
    });
    if (count) {
      var g = state.pool.filter(function (p) {
        return p.kind === "generated";
      }).length;
      count.textContent =
        state.tray.length +
        " shown · pool " +
        state.pool.length +
        " (" +
        g +
        " gen) · " +
        state.equipped.length +
        " equipped";
    }
  }

  function renderEquipped() {
    var box = $("stare-equipped");
    if (!box) return;
    box.innerHTML = "";
    if (!state.equipped.length) {
      box.innerHTML =
        '<span class="stare-equipped-empty">No spells equipped — tray below (paintings + generated). Set each influence potency.</span>';
      return;
    }
    state.equipped.forEach(function (item, idx) {
      var pot = clampPotency(item.potency != null ? item.potency : DEFAULT_POTENCY);
      item.potency = pot;
      var row = document.createElement("div");
      row.className =
        "stare-equip-row" + (item.kind === "generated" ? " is-generated" : "");
      row.innerHTML =
        '<img class="stare-equip-thumb" src="' +
        String(item.url).replace(/"/g, "") +
        '" alt="" />' +
        '<div class="stare-equip-meta">' +
        '<div class="stare-equip-top">' +
        "<strong>" +
        escapeHtml(item.label) +
        "</strong>" +
        '<span class="stare-equip-kind">' +
        (item.kind === "generated" ? "generated" : "painting") +
        "</span>" +
        '<button type="button" class="stare-equip-remove" data-idx="' +
        idx +
        '" title="Remove">×</button>' +
        "</div>" +
        '<label class="stare-potency-label">' +
        '<span>Influence <em class="stare-potency-val">' +
        pot +
        "%</em> · " +
        potencyWord(pot) +
        "</span>" +
        '<input type="range" class="stare-potency" min="0" max="100" step="5" value="' +
        pot +
        '" data-idx="' +
        idx +
        '" />' +
        "</label>" +
        "</div>";
      box.appendChild(row);
    });

    box.querySelectorAll(".stare-equip-remove").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var i = parseInt(btn.getAttribute("data-idx"), 10);
        var gone = state.equipped[i];
        state.equipped.splice(i, 1);
        renderEquipped();
        renderTray();
        setStatus("Removed " + (gone && gone.label) + ".");
      });
    });
    box.querySelectorAll(".stare-potency").forEach(function (range) {
      range.addEventListener("input", function () {
        var i = parseInt(range.getAttribute("data-idx"), 10);
        var p = clampPotency(range.value);
        if (!state.equipped[i]) return;
        state.equipped[i].potency = p;
        var row = range.closest(".stare-equip-row");
        if (row) {
          var em = row.querySelector(".stare-potency-val");
          var lab = row.querySelector(".stare-potency-label span");
          if (em) em.textContent = p + "%";
          if (lab) {
            lab.innerHTML =
              "Influence <em class=\"stare-potency-val\">" +
              p +
              "%</em> · " +
              potencyWord(p);
          }
        }
      });
    });
  }

  function equipSpell(item) {
    if (!item || item.num == null) return;
    var key = spellKey(item);
    if (
      state.equipped.some(function (s) {
        return spellKey(s) === key;
      })
    ) {
      setStatus(item.label + " already equipped.", "err");
      return;
    }
    if (state.equipped.length >= MAX_EQUIPPED) {
      setStatus("Max " + MAX_EQUIPPED + " spells — remove one first.", "err");
      return;
    }
    state.equipped.push({
      kind: item.kind || "painting",
      num: item.num,
      url: item.url,
      label: item.label,
      potency: DEFAULT_POTENCY,
    });
    renderEquipped();
    renderTray();
    if (item.kind === "generated") {
      ensureGeneratedAnalysis(item.num);
    }
    setStatus(
      "Equipped " + item.label + " @ " + DEFAULT_POTENCY + "% (" + state.equipped.length + "/" + MAX_EQUIPPED + ")."
    );
  }

  function bindDrag() {
    var strip = $("stare-spell-strip");
    var well = $("stare-well");
    if (!strip || strip.dataset.dragBound) return;
    strip.dataset.dragBound = "1";
    var drag = null;

    strip.addEventListener("pointerdown", function (e) {
      var btn = e.target.closest(".stare-spell");
      if (!btn) return;
      var item = state.tray[parseInt(btn.dataset.idx, 10)];
      if (!item) return;
      e.preventDefault();
      btn.setPointerCapture(e.pointerId);
      var ghost = document.createElement("div");
      ghost.className = "stare-drag-ghost";
      var img = document.createElement("img");
      img.src = item.url;
      ghost.appendChild(img);
      document.body.appendChild(ghost);
      ghost.style.left = e.clientX + "px";
      ghost.style.top = e.clientY + "px";
      drag = { item: item, ghost: ghost, pid: e.pointerId };
      if (well) well.classList.add("stare-drop-active");
    });

    strip.addEventListener("pointermove", function (e) {
      if (!drag || e.pointerId !== drag.pid) return;
      drag.ghost.style.left = e.clientX + "px";
      drag.ghost.style.top = e.clientY + "px";
    });

    function endDrag(e) {
      if (!drag || e.pointerId !== drag.pid) return;
      var r = well ? well.getBoundingClientRect() : null;
      var over =
        r &&
        e.clientX >= r.left &&
        e.clientX <= r.right &&
        e.clientY >= r.top &&
        e.clientY <= r.bottom;
      if (drag.ghost.parentNode) drag.ghost.parentNode.removeChild(drag.ghost);
      if (well) well.classList.remove("stare-drop-active");
      if (over) equipSpell(drag.item);
      drag = null;
    }
    strip.addEventListener("pointerup", endDrag);
    strip.addEventListener("pointercancel", endDrag);
  }

  function newJobId(prefix) {
    return typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : (prefix || "stare") + "-" + Date.now() + "-" + Math.floor(Math.random() * 1e6);
  }

  function stareJobBody(cast, source) {
    return {
      job_id: newJobId(source === "stare-tab" ? "stare-open" : "stare-var"),
      stasis: cast.prompt.slice(0, 4200),
      prompt: cast.prompt.slice(0, 4200),
      fused_prompt: cast.prompt.slice(0, 4200),
      buzz_words: cast.buzz,
      spells: [],
      spell_details: [],
      aspect_ratio: aspectValue(),
      // Always pure text invent — never refine/reference (that was echoing old stills).
      mag_fresh: true,
      fresh_variation: true,
      refine: false,
      spell_cast: false,
      source: source || "stare-tab",
      craft_hints:
        "OBEY BOTH: (1) SPELL walls/dimensions/content by potency (2) STARE shape stylization on flat-Z centerpoint " +
        "(inward fall or outward surge; pyramid optical form). Spells are not optional flavor. " +
        "No inception, no OS UI, no photo paste. Seed " +
        cast.seed +
        " Z:" +
        (cast.zFlow || "") +
        ". " +
        String(cast.subject || "").slice(0, 140),
    };
  }

  /** Open a stare: invent a new painting (text DNA + geometry, no image refs). */
  function generateStare() {
    if (state.busy) return;
    if (!state.equipped.length && !userIdea()) {
      setStatus("Equip spells from the tray (or describe the world), then generate.", "err");
      return;
    }

    setBusy(true);
    setStatus("Reading spell DNA + potencies…");
    state.modifierStack = [];
    state.variationStep = 0;

    hydrateEquippedAnalyses()
      .then(function () {
        var cast = buildStareCast();
        state.lastCast = cast;
        var nameEl = $("stare-name");
        if (nameEl) nameEl.value = cast.title;

        return runStasisRequest(
          stareJobBody(cast, "stare-tab"),
          "New scene — “" + cast.title + "”"
        ).then(function (url) {
          state.genNum = null;
          showPreview(url);
          var potBits = (cast.potencies || [])
            .map(function (p) {
              return p.label + " " + p.potency + "%";
            })
            .join(", ");
          setStatus(
            "“" +
              cast.title +
              "” ready" +
              (potBits ? " · " + potBits : "") +
              ".",
            "ok"
          );
        });
      })
      .catch(function (err) {
        setStatus((err && err.message) || "Generate failed", "err");
      })
      .then(function () {
        setBusy(false);
      });
  }

  /**
   * One variation click = fully new invent with a twist (no image refine).
   */
  function varyStare() {
    if (state.busy) return;
    if (!state.equipped.length && !userIdea() && !state.lastCast) {
      setStatus("Equip spells (or add an intention), then vary.", "err");
      return;
    }

    setBusy(true);
    setStatus("Reading spell DNA + potencies…");

    hydrateEquippedAnalyses()
      .then(function () {
        var step = (state.variationStep || 0) + 1;
        state.variationStep = step;

        var modifiers = (state.modifierStack || []).slice();
        modifiers = modifiers.concat(pickPipelineModifiers(1, modifiers));
        state.modifierStack = modifiers.slice();

        var built = buildVariationStepPrompt(step, modifiers);
        state.lastCast = built;
        var nameEl = $("stare-name");
        if (nameEl) nameEl.value = built.title;

        return runStasisRequest(
          stareJobBody(built, "stare-tab-variation"),
          "New scene step " + step
        ).then(function (url) {
          state.genNum = null;
          showPreview(absUrl(url));
          setStatus(
            "“" +
              built.title +
              "” · new invention · " +
              String(built.subject || "").slice(0, 80) +
              "…",
            "ok"
          );
        });
      })
      .catch(function (err) {
        setStatus((err && err.message) || "Variation failed", "err");
      })
      .then(function () {
        setBusy(false);
      });
  }

  function saveStare() {
    if (!state.imageUrl || state.busy) return;
    var nameEl = $("stare-name");
    var name = nameEl ? String(nameEl.value || "").trim() : "";
    if (!name) {
      name =
        (state.lastCast && state.lastCast.title) ||
        inventTitle(uniqueSeedToken());
      if (nameEl) nameEl.value = name;
    }
    var castPrompt =
      (state.lastCast && state.lastCast.prompt) || userIdea() || "";
    var castSeed = (state.lastCast && state.lastCast.seed) || "";
    var mods = (state.lastCast && state.lastCast.modifiers) || state.modifierStack || [];
    var step =
      (state.lastCast && state.lastCast.variationStep) || state.variationStep || 0;
    var desc =
      name +
      (castSeed ? " · seed " + castSeed.slice(0, 10) : "") +
      (step > 0 ? " · s" + step : "") +
      (mods.length ? " · +" + mods.length + "mod" : "") +
      " · stare portal";

    setBusy(true);
    setStatus("Saving stare…");
    fetch(apiUrl("/api/save-generated-image"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_url: state.imageUrl,
        source: "stare",
        collection: "generated",
        description: desc.slice(0, 240),
        meta: {
          source: "stare",
          frame: frameKind(),
          mood: moodValue(),
          prompt: userIdea(),
          cast_prompt: String(castPrompt).slice(0, 1200),
          seed: castSeed,
          title: name,
          spells: equippedSpellMeta(),
          text_dna_only: true,
          modifiers: mods.slice(0, 12),
          variation_step: step,
          geometry: computeSpaceRectsUnit().map(function (r) {
            return {
              n: r.n,
              x: +r.x.toFixed(4),
              y: +r.y.toFixed(4),
              w: +r.w.toFixed(4),
              h: +r.h.toFixed(4),
            };
          }),
        },
      }),
    })
      .then(function (r) {
        return r.json().then(function (d) {
          if (!r.ok || (d && d.ok === false)) {
            throw new Error((d && d.error) || "Save generated failed");
          }
          return d;
        });
      })
      .then(function (saved) {
        state.genNum = saved && saved.num != null ? saved.num : null;
        var url = (saved && saved.url) || state.imageUrl;
        return fetch(apiUrl("/api/stares"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name,
            border: frameKind(),
            mood: moodValue(),
            prompt: userIdea(),
            cast_prompt: String(castPrompt).slice(0, 1200),
            seed: castSeed,
            modifiers: mods.slice(0, 12),
            variation_step: step,
            geometry: computeSpaceRectsUnit().map(function (r) {
              return {
                n: r.n,
                x: +r.x.toFixed(4),
                y: +r.y.toFixed(4),
                w: +r.w.toFixed(4),
                h: +r.h.toFixed(4),
              };
            }),
            image_url: url,
            gen_num: state.genNum,
            spells: equippedSpellMeta(),
          }),
        }).then(function (r) {
          return r.json().then(function (d) {
            if (!r.ok || (d && d.ok === false)) {
              throw new Error((d && d.error) || "Stare catalog save failed");
            }
            return d;
          });
        });
      })
      .then(function () {
        setStatus(
          "Saved “" +
            name +
            "”" +
            (state.genNum != null ? " · G#" + state.genNum : "") +
            ".",
          "ok"
        );
        return loadSaved();
      })
      .catch(function (err) {
        setStatus((err && err.message) || "Save failed", "err");
      })
      .then(function () {
        setBusy(false);
      });
  }

  function loadSaved() {
    return fetch(apiUrl("/api/stares"), { cache: "no-store" })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (d) {
        state.saved = (d && d.stares) || [];
        renderSaved();
      })
      .catch(function () {
        state.saved = [];
        renderSaved();
      });
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderSaved() {
    var list = $("stare-list");
    if (!list) return;
    list.innerHTML = "";
    if (!state.saved.length) {
      list.innerHTML = '<p class="stare-empty">No saved stares yet.</p>';
      return;
    }
    state.saved
      .slice()
      .reverse()
      .forEach(function (m) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "stare-card";
        var url = absUrl(m.image_url || m.url || "");
        btn.innerHTML =
          (url ? '<img src="' + url.replace(/"/g, "") + '" alt="" loading="lazy" />' : "") +
          "<span>" +
          escapeHtml(m.name || "Stare") +
          "<small>" +
          escapeHtml(
            (m.border || "frame") + (m.gen_num != null ? " · G#" + m.gen_num : "")
          ) +
          "</small></span>";
        btn.addEventListener("click", function () {
          if (url) showPreview(url);
          var n = $("stare-name");
          if (n) n.value = m.name || "";
          var p = $("stare-prompt");
          if (p && m.prompt) p.value = m.prompt;
          setStatus("Loaded “" + (m.name || "stare") + "”.");
        });
        list.appendChild(btn);
      });
  }

  function setImmersive(on) {
    state.immersive = !!on;
    var well = $("stare-well");
    if (well) well.classList.toggle("is-immersive", state.immersive);
    document.body.classList.toggle("stare-immersive", state.immersive);
  }

  function bind() {
    var handlers = {
      "stare-generate": generateStare,
      "stare-variation": varyStare,
      "stare-save": saveStare,
      "stare-space-reset": resetSpaceGeometry,
      "stare-randomize": function () {
        fillTray();
        renderTray();
        setStatus("Shuffled spell tray.");
      },
      "stare-clear-spells": function () {
        state.equipped = [];
        renderEquipped();
        renderTray();
        setStatus("Cleared equipped spells.");
      },
      "stare-immerse": function () {
        if (!state.imageUrl) {
          setStatus("Generate a stare first.", "err");
          return;
        }
        setImmersive(true);
      },
      "stare-exit-immerse": function () {
        setImmersive(false);
      },
    };
    Object.keys(handlers).forEach(function (id) {
      var el = $(id);
      if (!el || el.dataset.bound) return;
      el.dataset.bound = "1";
      el.addEventListener("click", handlers[id]);
    });
    document.querySelectorAll(".stare-filter-btn").forEach(function (btn) {
      if (btn.dataset.bound) return;
      btn.dataset.bound = "1";
      btn.addEventListener("click", function () {
        setTrayFilter(btn.getAttribute("data-filter") || "all");
      });
    });
    setTrayFilter(state.trayFilter || "all");
    bindDrag();
    bindSpaceView();
    window.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && state.immersive) setImmersive(false);
    });
  }

  function onShow() {
    bind();
    loadSpellPool();
    ensureAnalyses();
    loadSaved();
    bindSpaceView();
    requestAnimationFrame(function () {
      drawSpaceView();
    });
  }

  function onHide() {
    setImmersive(false);
  }

  window.Stare = { onShow: onShow, onHide: onHide };
  window.addEventListener("stare-show", onShow);
  window.addEventListener("stare-hide", onHide);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();
