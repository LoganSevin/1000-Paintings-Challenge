/**
 * Spellforge: shuffled grid, spell slots, fused text, interaction preview, optional fusion video.
 */
(function () {
  var PAGE_SIZE = 25;
  var PAGE_COUNT = 40;
  var TOTAL = PAGE_SIZE * PAGE_COUNT;
  var DISPLAY_ORDER_KEY = "spellforge_display_order_v11";
  var SHUFFLE_VERSION_KEY = "spellforge_shuffle_version";
  var SHUFFLE_VERSION = "v11-full-arsenal-pages";
  var EQUIP_SAVE_KEY = "spellforge_equipped_v1";
  var ASPECT_KEY = "spellforge_aspect_v1";
  /** Generated/phone arsenal IDs are GEN_BASE + generated file number (avoids clobbering paintings 1–1000). */
  var GEN_BASE = 100000;
  /** Sketch arsenal IDs are SKETCH_BASE + sketch number (avoids clobbering gen). */
  var SKETCH_BASE = 200000;
  /** Inverted chalk sketches use INV_SKETCH_BASE + number. */
  var INV_SKETCH_BASE = 300000;
  var NOTE_BASE = 400000;
  var NOTES_KEY = "spellforge_notes_v1";
  var ASPECT_OPTIONS = ["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3"];
  var NOTE_THUMB =
    "data:image/svg+xml," +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">' +
        '<rect width="64" height="64" rx="8" fill="#1e293b"/>' +
        '<rect x="14" y="12" width="36" height="40" rx="3" fill="#334155" stroke="#94a3b8" stroke-width="2"/>' +
        '<path d="M20 22h24M20 30h24M20 38h16" stroke="#e2e8f0" stroke-width="2.5" stroke-linecap="round"/>' +
      "</svg>"
    );

  var canonicalList = [];
  var displayOrder = [];
  var pageSnapshotBeforeShuffle = null;
  var manifest = [];
  var manifestByNumber = {};
  var analyses = {};
  /** Phone + generated extras — arsenalNum → { url, analysis, title, source, genNum } */
  var extraSpells = {};
  /** Arsenal numbers for extras only (GEN_BASE + G#) */
  var arsenalExtraNums = [];
  /** @deprecated alias kept for a few UI notes */
  var phoneSpellNums = [];
  /** Live counts from /api/transfer/spell-assets */
  var arsenalStats = {
    paintings: TOTAL,
    generated: 0,
    phone: 0,
    extras: 0,
    total: TOTAL,
    pages: PAGE_COUNT,
  };
  var spells = [null, null, null];
  var spellNotes = { notes: {}, nextNoteId: NOTE_BASE + 1 };
  var activePage = 0;
  var pickerQuery = "";
  var pendingPickNumber = null;
  var slotDialogBound = false;
  var blendRequestId = 0;
  var redefineRequestId = 0;
  var redefineCount = 0;
  var autoVisionTimer = null;
  var generatingVision = false;
  var lastFusedPrompt = "";
  var spellStasis = "";
  var spellPrompt = "";
  var stasisUserDirty = false;
  var activeBuzzWords = [];
  var stasisVisionUrl = "";
  var serverOnline = false;
  var apiReady = false;
  var lastHealth = null;
  var spellforgeStarted = false;
  var spellforgeReady = false;
  var suppressAutoVision = false;
  var skipLocalFuse = false;
  /**
   * Per-slot spell text overrides (color name → hex edits).
   * null = use default analysis text for that painting.
   */
  var spellSlotBodyOverride = [null, null, null];
  /**
   * Named hues for bold color rewrite / nearest-name.
   * Keep reference hexes fairly pure so Lab matching does not collapse to beige/navy.
   */
  var COLOR_NAME_HEX = {
    // Reds / pinks
    red: "#EF4444",
    scarlet: "#FF2400",
    crimson: "#DC143C",
    vermilion: "#E34234",
    tomato: "#FF6347",
    brick: "#B22222",
    carmine: "#960018",
    rose: "#F43F5E",
    pink: "#FF4FA3",
    hotpink: "#FF69B4",
    salmon: "#FA8072",
    blush: "#DE5D83",
    // Oranges / yellows
    orange: "#F97316",
    tangerine: "#FF8C00",
    apricot: "#FBCEB1",
    coral: "#FF6B4A",
    peach: "#FFAB70",
    amber: "#F59E0B",
    gold: "#EAB308",
    yellow: "#FACC15",
    lemon: "#FFF44F",
    mustard: "#E1AD01",
    // Earths
    ochre: "#CC7722",
    sienna: "#A0522D",
    rust: "#B7410E",
    brown: "#92400E",
    chocolate: "#7B3F00",
    coffee: "#6F4E37",
    mahogany: "#C04000",
    bronze: "#CD7F32",
    copper: "#B87333",
    tan: "#D2B48C",
    khaki: "#C3B091",
    sand: "#C2B280",
    // Greens
    green: "#16A34A",
    forest: "#228B22",
    emerald: "#059669",
    jade: "#00A86B",
    mint: "#34D399",
    seafoam: "#93E9BE",
    sage: "#9CAF88",
    moss: "#8A9A5B",
    olive: "#6B8E23",
    lime: "#84CC16",
    chartreuse: "#B8FF00",
    // Cyans / blues
    teal: "#0D9488",
    turquoise: "#14B8A6",
    cyan: "#06B6D4",
    aqua: "#00FFFF",
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
    // Purples
    purple: "#A855F7",
    violet: "#7C3AED",
    lavender: "#C084FC",
    lilac: "#C8A2C8",
    mauve: "#C26B9A",
    magenta: "#FF00AA",
    fuchsia: "#FF00CC",
    plum: "#9B2D8A",
    eggplant: "#614051",
    wine: "#722F37",
    burgundy: "#7F1D1D",
    maroon: "#9F1239",
    // Neutrals (only win when chroma is low)
    white: "#F8FAFC",
    ivory: "#FFFFF0",
    cream: "#FFF5E0",
    bone: "#E3DAC9",
    beige: "#F5F0DC",
    linen: "#FAF0E6",
    silver: "#C0C0C0",
    gray: "#6B7280",
    grey: "#6B7280",
    slate: "#64748B",
    steel: "#71797E",
    ash: "#B2BEB5",
    charcoal: "#374151",
    black: "#0A0A0C",
  };

  /** Low-chroma dictionary names — only matched when the sample is also neutral. */
  var COLOR_NEUTRAL_NAMES = {
    white: 1,
    ivory: 1,
    cream: 1,
    bone: 1,
    beige: 1,
    linen: 1,
    silver: 1,
    gray: 1,
    grey: 1,
    slate: 1,
    steel: 1,
    ash: 1,
    charcoal: 1,
    black: 1,
    tan: 1,
    khaki: 1,
    sand: 1,
  };

  /** Same heuristic set as Commercial — terms that often trip image-API moderation. */
  var SPELL_MOD_RULES = [
    {
      level: "high",
      re: /\b(batman|joker|superman|spiderman|spider-?man|iron\s*man|thanos|yoda|vader|darth|grogu|baby\s*yoda|mandalorian|elsa|olaf|mario|luigi|harry\s*potter|voldemort|hogwarts|gandalf|sauron|gollum|deadpool|wolverine|hulk|black\s*panther|wakanda|barbie|mickey|minnie|disney|marvel|dc\s*comics|lightsaber|death\s*star|millennium\s*falcon|avengers|infinity\s*gauntlet|jedi|sith|skywalker|chewbacca|pennywise|xenomorph|terminator|buzz\s*lightyear|spongebob|pikachu|pokemon|pokémon|inception|matrix|oppenheimer|dune|euphoria|wednesday|john\s*wick|top\s*gun|star\s*wars|star\s*trek|breaking\s*bad|stranger\s*things|squid\s*game|nazi|swastika|isis|porn|nude|naked|nsfw|explicit\s*sex|child\s*porn|underage|lolita)\b/gi,
    },
    {
      level: "high",
      re: /\b(gore|beheading|dismember|bloody\s*massacre|torture|rape|suicidal|school\s*shooting)\b/gi,
    },
    {
      level: "med",
      re: /\b(gun|rifle|pistol|blood|corpse|kill|murder|weapon|war\s*crime|lingerie|sexy|erotic)\b/gi,
    },
    {
      level: "med",
      re: /\b(tt\d{7,8}|imdb\.com\/title)\b/gi,
    },
  ];

  function escapeModHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function scanSpellModeration(text) {
    if (window.Commercial && typeof window.Commercial.scanModeration === "function") {
      return window.Commercial.scanModeration(text);
    }
    text = String(text || "");
    var hits = [];
    var seen = {};
    SPELL_MOD_RULES.forEach(function (rule) {
      var re = new RegExp(rule.re.source, rule.re.flags);
      var m;
      while ((m = re.exec(text)) !== null) {
        var key = m.index + ":" + m[0].toLowerCase();
        if (seen[key]) continue;
        seen[key] = true;
        hits.push({
          start: m.index,
          end: m.index + m[0].length,
          level: rule.level,
          match: m[0],
        });
        if (m[0].length === 0) re.lastIndex++;
      }
    });
    hits.sort(function (a, b) {
      return a.start - b.start || b.end - a.end;
    });
    var cleaned = [];
    var lastEnd = -1;
    hits.forEach(function (h) {
      if (h.start < lastEnd) return;
      cleaned.push(h);
      lastEnd = h.end;
    });
    var counts = {};
    cleaned.forEach(function (h) {
      var k = h.match.toLowerCase();
      if (!counts[k]) counts[k] = { match: h.match, level: h.level, n: 0 };
      counts[k].n++;
      if (h.level === "high") counts[k].level = "high";
    });
    return {
      hits: cleaned,
      flags: Object.keys(counts)
        .map(function (k) {
          return counts[k];
        })
        .sort(function (a, b) {
          if (a.level !== b.level) return a.level === "high" ? -1 : 1;
          return b.n - a.n;
        }),
    };
  }

  function omitFlaggedFromText(text, onlyWord) {
    text = String(text || "");
    var scan = scanSpellModeration(text);
    if (!scan.hits.length) return text;
    var only = onlyWord ? String(onlyWord).toLowerCase() : "";
    var hits = scan.hits.slice().sort(function (a, b) {
      return b.start - a.start;
    });
    var out = text;
    hits.forEach(function (h) {
      if (only && h.match.toLowerCase() !== only) return;
      var before = out.slice(0, h.start);
      var after = out.slice(h.end);
      // tidy double spaces / dangling punctuation left by removal
      out = (before + after)
        .replace(/[ \t]{2,}/g, " ")
        .replace(/\s+([,.;:!?])/g, "$1")
        .replace(/\(\s*\)/g, "")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n");
    });
    return out.replace(/[ \t]+$/gm, "").trim();
  }

  function updateStasisModeration() {
    var input = document.getElementById("spell-stasis");
    var flagsEl = document.getElementById("spell-mod-flags");
    var summary = document.getElementById("spell-mod-summary");
    var omitBtn = document.getElementById("spell-omit-flagged");
    var text = input ? input.value : spellStasis;
    var scan = scanSpellModeration(text + "\n" + (spellPrompt || ""));
    var high = 0;
    var med = 0;
    scan.flags.forEach(function (f) {
      if (f.level === "high") high++;
      else med++;
    });
    if (summary) {
      if (!scan.flags.length) {
        summary.textContent = "clean";
        summary.className = "spell-mod-summary";
      } else {
        summary.textContent =
          scan.hits.length +
          " hit(s) · " +
          high +
          " high · " +
          med +
          " med";
        summary.className =
          "spell-mod-summary" + (high ? " danger" : " warn");
      }
    }
    if (omitBtn) {
      omitBtn.disabled = !scan.flags.length || !String(text || "").trim();
    }
    if (!flagsEl) return scan;
    flagsEl.innerHTML = "";
    if (!scan.flags.length) {
      var ok = document.createElement("span");
      ok.className = "spell-mod-flag ok-msg";
      ok.textContent = "No common moderation triggers — safe to generate";
      flagsEl.appendChild(ok);
      return scan;
    }
    scan.flags.forEach(function (f) {
      var chip = document.createElement("button");
      chip.type = "button";
      chip.className = "spell-mod-flag" + (f.level === "med" ? " med" : "");
      chip.title =
        "Click to omit “" +
        f.match +
        "” from stasis (" +
        (f.level === "high" ? "high" : "medium") +
        " risk)";
      chip.innerHTML =
        escapeModHtml(f.match) +
        (f.n > 1 ? "<em>×" + f.n + "</em>" : "") +
        (f.level === "high" ? " <em>high</em>" : " <em>med</em>");
      chip.addEventListener("click", function () {
        omitStasisWord(f.match);
      });
      flagsEl.appendChild(chip);
    });
    return scan;
  }

  function setStasisText(text, opts) {
    opts = opts || {};
    spellStasis = String(text || "");
    if (opts.userEdit) stasisUserDirty = true;
    if (opts.clearDirty) stasisUserDirty = false;
    var stasisEl = document.getElementById("spell-stasis");
    if (stasisEl && stasisEl.value !== spellStasis) stasisEl.value = spellStasis;
    lastFusedPrompt = getGenerationStasisPayload() || (spellStasis + " " + spellPrompt).trim();
    updateStasisModeration();
    updateRedefineButton();
    updatePhysicalPromptPreview();
    publishFusion();
  }

  function dropBuzzWord(word) {
    var w = String(word || "").toLowerCase();
    if (!w) return;
    activeBuzzWords = activeBuzzWords.filter(function (b) {
      return String(b).toLowerCase() !== w;
    });
    var strip = document.getElementById("spell-buzz-toggles");
    if (strip) {
      strip.querySelectorAll(".spell-chip-toggle").forEach(function (btn) {
        if (String(btn.textContent || "").toLowerCase() === w) {
          btn.classList.remove("active");
          btn.classList.remove("is-on");
          btn.setAttribute("aria-pressed", "false");
        }
      });
    }
  }

  function afterStasisOmit(msg) {
    setRedefineStatus(msg, false);
    var nums = getEquippedInOrder();
    var meta = collectCombinedMeta(nums);
    // Do not auto-generate after omit — that was causing failed fetch noise
    applyFusedUi._lastVisionSlots = "";
    clearTimeout(autoVisionTimer);
    onBuzzChanged();
    syncSpellLoop(nums, null, meta);
    publishFusion();
  }

  function omitStasisWord(word) {
    var next = omitFlaggedFromText(spellStasis, word);
    if (word) dropBuzzWord(word);
    if (next === spellStasis) {
      if (word) afterStasisOmit("Dropped buzz “" + word + "”.");
      return;
    }
    setStasisText(next, { userEdit: true });
    afterStasisOmit("Omitted “" + word + "” — review stasis, then generate.");
  }

  function omitAllFlaggedStasis() {
    var scan = scanSpellModeration(spellStasis + "\n" + (spellPrompt || ""));
    if (!scan.flags.length) {
      setRedefineStatus("No flagged words to omit.", false);
      return;
    }
    var next = omitFlaggedFromText(spellStasis, "");
    scan.flags.forEach(function (f) {
      dropBuzzWord(f.match);
    });
    var promptEl = document.getElementById("spell-prompt");
    if (promptEl && spellPrompt) {
      spellPrompt = omitFlaggedFromText(spellPrompt, "");
      promptEl.value = spellPrompt;
    }
    setStasisText(next, { userEdit: true });
    afterStasisOmit("Omitted all flagged moderation words — review, then generate.");
  }

  function isLocalHost() {
    var h = (location.hostname || "").toLowerCase();
    return h === "localhost" || h === "127.0.0.1" || h === "[::1]";
  }

  function isNetlifySite() {
    return (location.hostname || "").toLowerCase().indexOf("netlify.app") >= 0;
  }

  function isRenderSite() {
    var h = (location.hostname || "").toLowerCase();
    return h.indexOf("onrender.com") >= 0 || h.indexOf("render.com") >= 0;
  }

  /** Never tell Netlify visitors to run start_server.bat */
  function hostedMsg(localMsg, publicMsg) {
    return isLocalHost() ? localMsg : publicMsg;
  }

  function apiBase() {
    return String(window.SPELLFORGE_API_BASE || "").replace(/\/$/, "");
  }

  function apiUrl(path) {
    var base = apiBase();
    if (!base) return path;
    return base + path;
  }

  function assetUrl(path) {
    if (!path) return path;
    if (path.indexOf("http") === 0) return path;
    var base = apiBase();
    if (base) return base + (path.charAt(0) === "/" ? path : "/" + path);
    try {
      return new URL(path, window.location.href).href;
    } catch (e) {
      return path;
    }
  }

  function hasRemoteApi() {
    return !!apiBase();
  }

  function forceLocalOnly() {
    return window.SPELLFORGE_LOCAL_GENERATE === true;
  }

  function hasLocalCompose() {
    return typeof window.composeStasisVisionLocal === "function";
  }

  /**
   * Free in-browser fuse ONLY when SPELLFORGE_LOCAL_GENERATE === true.
   * Never use it as a silent fallback when health is slow/failed — that
   * replaced xAI with ugly stacked paintings.
   */
  function useLocalGenerate() {
    return forceLocalOnly() && hasLocalCompose();
  }

  /** Skip paid AI text blend only when user forces local-only mode. */
  function useFreeSpellforge() {
    return forceLocalOnly();
  }

  /** Allow opt-in free fuse after credits errors (default off). */
  function allowLocalCreditsFallback() {
    return (
      window.SPELLFORGE_LOCAL_FALLBACK_ON_CREDITS === true && hasLocalCompose()
    );
  }

  function canGenerateVision() {
    if (forceLocalOnly()) return hasLocalCompose();
    if (location.protocol === "file:") return false;
    // Cloud is default: button enabled; generate hits /api/generate-stasis-vision.
    // Do not require a green health probe first (that used to flip to free fuse).
    return true;
  }

  function updateGenerateButton() {
    var btn = document.getElementById("spell-generate-stasis");
    if (!btn) return;
    btn.textContent = useLocalGenerate()
      ? "Fuse paintings (free)"
      : "Generate image from stasis";
  }

  function updateRedefineButton() {
    var btn = document.getElementById("spell-redefine-stasis");
    if (!btn) return;
    var nums = getEquippedInOrder();
    btn.disabled = nums.length < 2 || !spellStasis.trim() || btn.dataset.busy === "1";
  }

  function updateMuralwalkButton() {
    var btn = document.getElementById("spell-send-muralwalk");
    if (!btn) return;
    btn.disabled = !stasisVisionUrl || getEquippedInOrder().length < 2;
  }

  function publishFusion() {
    var nums = getEquippedInOrder();
    var titleEl = document.getElementById("spell-fused-title");
    var payload = {
      slots: spells.slice(),
      spells: nums,
      stasis: spellStasis,
      visionUrl: stasisVisionUrl,
      title: titleEl ? titleEl.textContent : "",
      buzz: getActiveBuzz(),
      prompt: spellPrompt,
    };
    window.spellforgeFusion = payload;
    try {
      if (stasisVisionUrl) {
        localStorage.setItem(
          "spellforge_last_vision_v1",
          JSON.stringify({
            url: stasisVisionUrl,
            slots: nums,
            t: Date.now(),
          })
        );
      }
    } catch (eVis) {}
    window.dispatchEvent(
      new CustomEvent("spellforge-fusion", { detail: payload })
    );
    updateMuralwalkButton();
  }

  function scheduleAutoVision(nums) {
    if (suppressAutoVision) return;
    var physical = getGenerationStasisPayload();
    if (
      nums.length < 2 ||
      (!spellStasis.trim() && !String(physical || "").trim()) ||
      !canGenerateVision()
    ) {
      return;
    }
    if (generatingVision) return;

    var slotKey = nums.join(",");
    if (applyFusedUi._lastVisionSlots === slotKey && stasisVisionUrl) return;

    clearTimeout(autoVisionTimer);
    autoVisionTimer = setTimeout(function () {
      var now = getEquippedInOrder();
      var phys = getGenerationStasisPayload();
      if (
        now.join(",") !== slotKey ||
        generatingVision ||
        (!spellStasis.trim() && !String(phys || "").trim())
      ) {
        return;
      }
      if (applyFusedUi._lastVisionSlots === slotKey && stasisVisionUrl) return;
      // Always xAI unless local mode is explicitly forced — never free-fuse auto-run.
      generateStasisVision().then(function () {
        applyFusedUi._lastVisionSlots = slotKey;
      });
    }, nums.length >= 3 ? 800 : 1200);
  }

  function isCreditsError(msg) {
    if (!msg) return false;
    var m = String(msg).toLowerCase();
    return (
      m.indexOf("credit") >= 0 ||
      m.indexOf("license") >= 0 ||
      m.indexOf("purchase") >= 0 ||
      m.indexOf("billing") >= 0
    );
  }

  function parseApiResponse(res) {
    return res.text().then(function (text) {
      var trimmed = (text || "").trim();
      if (!trimmed || trimmed.charAt(0) === "<") {
        throw new Error(
          hostedMsg(
            "Server returned HTML instead of JSON. Run start_server.bat, then Ctrl+Shift+R.",
            isNetlifySite()
              ? "Cloud API not found. Run deploy_netlify_easy.bat on your PC, then add XAI_API_KEY on Netlify (NETLIFY_FIX.md)."
              : "AI API not available on this link yet."
          )
        );
      }
      try {
        return JSON.parse(trimmed);
      } catch (e) {
        throw new Error(
          hostedMsg(
            "Invalid server response. Run start_server.bat and open http://localhost:8765/#spellforge",
            isNetlifySite()
              ? "Redeploy with deploy_netlify_easy.bat, add XAI_API_KEY, then Deploy on Netlify."
              : "AI API not available on this link yet."
          )
        );
      }
    });
  }

  function $(sel) {
    return document.querySelector(sel);
  }

  function getAspectRatio() {
    var sel = document.getElementById("spell-aspect");
    var v = sel && sel.value ? String(sel.value).trim() : "";
    if (!v) {
      try {
        v = localStorage.getItem(ASPECT_KEY) || "";
      } catch (e) {
        v = "";
      }
    }
    if (ASPECT_OPTIONS.indexOf(v) < 0) v = "16:9";
    return v;
  }

  function setAspectRatio(ratio) {
    var v = String(ratio || "").trim();
    if (ASPECT_OPTIONS.indexOf(v) < 0) v = "16:9";
    var sel = document.getElementById("spell-aspect");
    if (sel) sel.value = v;
    try {
      localStorage.setItem(ASPECT_KEY, v);
    } catch (e) {}
    applyAspectPreview(v);
    return v;
  }

  /**
   * Strip aspect / frame-shape talk from prompts so the model does not fight
   * the UI-chosen aspect_ratio (API field only). Keeps composition consistent.
   */
  function stripAspectTalkFromPrompt(text) {
    var s = String(text || "");
    if (!s) return s;
    // Explicit Spellforge / pipeline frame directives
    s = s.replace(
      /\n*\s*OUTPUT FRAME\s*:[^\n]*(?:\n(?!\n)[^\n]*)*/gi,
      "\n"
    );
    s = s.replace(
      /\b(?:output\s+)?(?:frame|canvas|image)\s*(?:shape|size|format)?\s*(?:at|in|as|to)?\s*aspect(?:\s*ratio)?\s*[:\-]?\s*\d+\s*[:/]\s*\d+\b[^.!?\n]*/gi,
      ""
    );
    s = s.replace(
      /\baspect(?:\s*ratio)?\s*[:\-]?\s*\d+\s*[:/]\s*\d+\b/gi,
      ""
    );
    s = s.replace(
      /\b(?:at|in|for|as)\s+(?:a\s+)?(?:\d+\s*[:/]\s*\d+)\s*(?:aspect(?:\s*ratio)?|frame|canvas|format)?\b/gi,
      ""
    );
    // Common ratio tokens (with optional landscape/portrait/widescreen labels)
    s = s.replace(
      /\b(?:widescreen|ultrawide|cinematic|vertical|horizontal)?\s*(?:aspect\s*)?(?:ratio\s*)?(?:of\s*)?(?:1\s*[:/]\s*1|4\s*[:/]\s*3|3\s*[:/]\s*4|16\s*[:/]\s*9|9\s*[:/]\s*16|3\s*[:/]\s*2|2\s*[:/]\s*3)\b(?:\s*(?:landscape|portrait|widescreen|vertical|horizontal|frame|canvas|format|aspect(?:\s*ratio)?))?/gi,
      ""
    );
    s = s.replace(
      /\b(?:landscape|portrait|widescreen|vertical|horizontal)\s+(?:format|orientation|frame|canvas|aspect(?:\s*ratio)?)\b/gi,
      ""
    );
    s = s.replace(
      /\b(?:letterbox(?:ed|ing)?|pillarbox(?:ed|ing)?|do not letterbox|full-?bleed still at aspect[^.!?\n]*)\b/gi,
      ""
    );
    s = s.replace(
      /\bbuzz[^.\n]*aspect\s+\d+\s*[:/]\s*\d+/gi,
      function (m) {
        return m.replace(/aspect\s+\d+\s*[:/]\s*\d+/gi, "").trim();
      }
    );
    // Cleanup leftover punctuation / empty lines
    s = s.replace(/[ \t]{2,}/g, " ");
    s = s.replace(/ ?([,;:])\s*([,;:])/g, "$1");
    s = s.replace(/\(\s*\)/g, "");
    s = s.replace(/\n{3,}/g, "\n\n");
    return s.trim();
  }

  /** Drop aspect-ish buzz tokens; frame is controlled only by aspect_ratio API field. */
  function filterBuzzNoAspect(list) {
    return (list || []).filter(function (b) {
      var t = String(b || "").trim();
      if (!t) return false;
      if (/aspect/i.test(t)) return false;
      if (/^\d+\s*[:/]\s*\d+$/.test(t)) return false;
      if (/full[-\s]?bleed/i.test(t)) return false;
      if (/letterbox|pillarbox/i.test(t)) return false;
      if (/^(landscape|portrait|widescreen|vertical|horizontal)$/i.test(t)) {
        return false;
      }
      return true;
    });
  }

  function applyAspectPreview(ratio) {
    var r = String(ratio || getAspectRatio());
    var css = r.replace(":", " / ");
    var frame = document.getElementById("spell-stasis-vision-view");
    var img = document.getElementById("spell-stasis-vision-img");
    var wrap = document.getElementById("spell-stasis-vision-wrap");
    if (frame) frame.style.setProperty("--spell-vision-aspect", css);
    if (img) img.style.setProperty("--spell-vision-aspect", css);
    if (wrap) wrap.dataset.aspect = r;
  }

  function bindAspectControl() {
    var sel = document.getElementById("spell-aspect");
    if (!sel || sel.dataset.bound) return;
    sel.dataset.bound = "1";
    var saved = "";
    try {
      saved = localStorage.getItem(ASPECT_KEY) || "";
    } catch (e) {}
    if (ASPECT_OPTIONS.indexOf(saved) >= 0) sel.value = saved;
    applyAspectPreview(sel.value || "16:9");
    sel.addEventListener("change", function () {
      setAspectRatio(sel.value || "16:9");
      var statusEl = document.getElementById("spell-generate-status");
      if (statusEl && !generatingVision) {
        statusEl.hidden = false;
        statusEl.className = "spell-generate-status";
        statusEl.textContent = "Aspect set to " + getAspectRatio() + " — next Generate uses this frame.";
      }
    });
  }

  function shuffleArray(arr) {
    var a = arr.slice();
    var i = a.length;
    while (i > 1) {
      var j = Math.floor(Math.random() * i--);
      var t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  function buildCanonicalList() {
    canonicalList = [];
    for (var n = 1; n <= TOTAL; n++) canonicalList.push(n);
  }

  function buildFullArsenalList() {
    buildCanonicalList();
    var list = canonicalList.slice();
    var seen = {};
    for (var i = 0; i < list.length; i++) seen[list[i]] = true;
    for (var j = 0; j < arsenalExtraNums.length; j++) {
      var x = arsenalExtraNums[j];
      if (!seen[x]) {
        list.push(x);
        seen[x] = true;
      }
    }
    return list;
  }

  /** Keep saved order, drop missing, insert new phone/generated at random positions. */
  function reconcileDisplayOrder(order, fullSet) {
    var full = fullSet || buildFullArsenalList();
    var want = {};
    for (var i = 0; i < full.length; i++) want[full[i]] = true;
    var kept = [];
    var keptSet = {};
    (order || []).forEach(function (n) {
      n = parseInt(n, 10);
      if (!n || !want[n] || keptSet[n]) return;
      kept.push(n);
      keptSet[n] = true;
    });
    var missing = [];
    for (var j = 0; j < full.length; j++) {
      if (!keptSet[full[j]]) missing.push(full[j]);
    }
    // Shuffle missing, then insert each at a random index so they mix into the book
    missing = shuffleArray(missing);
    for (var m = 0; m < missing.length; m++) {
      var idx = Math.floor(Math.random() * (kept.length + 1));
      kept.splice(idx, 0, missing[m]);
    }
    return kept;
  }

  function saveDisplayOrder() {
    try {
      localStorage.setItem(DISPLAY_ORDER_KEY, JSON.stringify(displayOrder || []));
      localStorage.setItem(SHUFFLE_VERSION_KEY, SHUFFLE_VERSION);
    } catch (e) {}
  }

  function buildDisplayOrder(forceNew) {
    var full = buildFullArsenalList();
    if (!forceNew) {
      try {
        if (localStorage.getItem(SHUFFLE_VERSION_KEY) === SHUFFLE_VERSION) {
          var saved = JSON.parse(localStorage.getItem(DISPLAY_ORDER_KEY) || "null");
          if (saved && saved.length) {
            displayOrder = reconcileDisplayOrder(saved, full);
            saveDisplayOrder();
            return;
          }
        }
      } catch (e) {}
    }
    displayOrder = shuffleArray(full);
    saveDisplayOrder();
  }

  function loadSpellNotes() {
    try {
      var raw = localStorage.getItem(NOTES_KEY);
      if (!raw) {
        spellNotes = { notes: {}, nextNoteId: NOTE_BASE + 1 };
        return;
      }
      var parsed = JSON.parse(raw);
      spellNotes = {
        notes: (parsed && parsed.notes) || {},
        nextNoteId: Math.max(
          NOTE_BASE + 1,
          Number(parsed && parsed.nextNoteId) || NOTE_BASE + 1
        ),
      };
    } catch (e) {
      spellNotes = { notes: {}, nextNoteId: NOTE_BASE + 1 };
    }
  }

  function saveSpellNotes() {
    try {
      localStorage.setItem(NOTES_KEY, JSON.stringify(spellNotes));
    } catch (e) {}
  }

  function noteOf(num) {
    num = parseInt(num, 10);
    if (!num || !spellNotes || !spellNotes.notes) return null;
    return spellNotes.notes[String(num)] || spellNotes.notes[num] || null;
  }

  function isNoteId(n) {
    return !!noteOf(n);
  }

  function isValidSpellNum(n) {
    n = parseInt(n, 10);
    if (!n || n < 1) return false;
    if (n <= TOTAL) return true;
    if (noteOf(n)) return true;
    return !!extraSpells[n] || !!extraSpells[String(n)];
  }

  function spellKindLabel(num) {
    if (noteOf(num)) return "Note";
    var extra = extraSpells[num] || extraSpells[String(num)];
    if (!extra) return "#" + num;
    var g = extra.genNum != null ? extra.genNum : num;
    if (extra.source === "phone-upload") return "Phone G#" + g;
    if (extra.source === "sketch") return "Sketch S#" + g;
    if (extra.source === "sketch-inverted") return "Inv sketch SI#" + g;
    return "Gen G#" + g;
  }

  function buildManifestMap() {
    manifestByNumber = {};
    for (var i = 0; i < manifest.length; i++) {
      var num = manifest[i].number;
      manifestByNumber[num] = manifest[i];
      manifestByNumber[String(num)] = manifest[i];
    }
  }

  function paintingUrl(num) {
    if (noteOf(num)) return NOTE_THUMB;
    var extra = extraSpells[num] || extraSpells[String(num)];
    if (extra && extra.url) return assetUrl(extra.url);
    if (window.getPaintingUrl) return window.getPaintingUrl(num);
    return "paintings/" + num + ".jpg";
  }

  function getAnalysis(num) {
    num = parseInt(num, 10);
    var note = noteOf(num);
    if (note) {
      return {
        title: note.title || "Note",
        description: String(note.text || ""),
        prompt: String(note.text || ""),
        tags: ["note"],
        style: "text note",
      };
    }
    var extra = extraSpells[num] || extraSpells[String(num)];
    if (extra && extra.analysis) return extra.analysis;
    var a = analyses[String(num)] || analyses[num] || null;
    if (a) return a;
    try {
      var ga = window.getGalleryAnalyses
        ? window.getGalleryAnalyses()
        : window.galleryAnalyses;
      if (ga) {
        a = ga[String(num)] || ga[num] || null;
        if (a) {
          analyses[String(num)] = a;
          analyses[num] = a;
        }
      }
    } catch (e) {}
    return a || null;
  }

  function analysisSpellText(num) {
    var note = noteOf(num);
    if (note) return String(note.text || "");
    var a = getAnalysis(num);
    var extra = extraSpells[num] || extraSpells[String(num)];
    if (!a) {
      if (extra) {
        return (
          (extra.title || spellKindLabel(num)) +
          "\n\n(Description pending — run analyze_missing_descriptions.bat on the PC, then refresh Spellforge.)"
        );
      }
      return "Painting #" + num + " (no analysis yet)";
    }
    var parts = [];
    if (a.title) parts.push(a.title);
    if (extra) {
      var kindLabel =
        extra.source === "phone-upload"
          ? "Phone upload"
          : extra.source === "sketch"
            ? "Line sketch (black on white)"
            : extra.source === "sketch-inverted"
              ? "Inverted sketch (white on black)"
              : "Generated still";
      var idLabel =
        extra.source === "sketch" || extra.source === "sketch-inverted"
          ? (extra.source === "sketch-inverted" ? "SI#" : "S#") +
            (extra.sketchNum != null ? extra.sketchNum : extra.genNum)
          : "G#" + (extra.genNum != null ? extra.genNum : num);
      parts.push(kindLabel + " · " + idLabel);
    }
    if (a.description) {
      parts.push(a.description);
    } else if (extra || a.needs_description) {
      parts.push(
        "(Description pending — run analyze_missing_descriptions.bat, then hard-refresh.)"
      );
    }
    if (a.prompt) parts.push("Generation prompt: " + a.prompt);
    if (a.source_description && a.source_description !== a.description) {
      parts.push("Source (verbatim): " + a.source_description);
    }
    if (a.style) parts.push("Style: " + a.style);
    if (a.tags && a.tags.length) parts.push("Tags: " + a.tags.join(", "));
    return parts.join("\n\n");
  }

  function ingestSpellAssets(items) {
    extraSpells = {};
    arsenalExtraNums = [];
    phoneSpellNums = [];
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
      // Offset so paintings 1–1000 stay intact; sketches / inverted use own bases
      var base =
        source === "sketch"
          ? SKETCH_BASE
          : source === "sketch-inverted"
            ? INV_SKETCH_BASE
            : GEN_BASE;
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
      extraSpells[num] = {
        number: num,
        genNum: genNum,
        sketchNum:
          source === "sketch" || source === "sketch-inverted" ? genNum : null,
        url: url,
        title: (analysis && analysis.title) || it.title || defaultTitle,
        source: source,
        name: it.name || "",
        analysis: analysis,
      };
      extraSpells[String(num)] = extraSpells[num];
      if (analysis) {
        analyses[String(num)] = analysis;
        analyses[num] = analysis;
      }
      arsenalExtraNums.push(num);
      if (source === "phone-upload") phoneSpellNums.push(num);
    });
    arsenalExtraNums.sort(function (a, b) {
      return b - a;
    });
    phoneSpellNums.sort(function (a, b) {
      return b - a;
    });
  }

  function loadSpellAssets(opts) {
    // Optional — never block Spellforge if offline / route missing
    var q = "?t=" + Date.now();
    if (opts && opts.skipSketches) q += "&skip_sketches=1";
    var url = apiUrl("/api/transfer/spell-assets" + q);
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
          if (d.painting_total) arsenalStats.paintings = d.painting_total;
          if (typeof d.generated_count === "number") {
            /* server counts pure generated; phone counted separately */
          }
          refreshArsenalStats();
          if (d.pages && d.pages > arsenalStats.pages) {
            arsenalStats.pages = d.pages;
          }
          if (d.arsenal_total) arsenalStats.total = d.arsenal_total;
        }
        return arsenalExtraNums.length;
      })
      .catch(function () {
        return 0;
      });
  }

  /** @deprecated name — use loadSpellAssets */
  function loadPhoneSpellAssets() {
    return loadSpellAssets();
  }

  function escapeHtml(s) {
    var d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/"/g, "&quot;");
  }

  function totalPageCount() {
    // Always derive from real arsenal length (paintings + gen + phone), never hard-cap at 40
    var n = (displayOrder && displayOrder.length) || arsenalStats.total || TOTAL;
    return Math.max(1, Math.ceil(n / PAGE_SIZE));
  }

  function refreshArsenalStats() {
    var extras = arsenalExtraNums.length;
    var phone = 0;
    var gen = 0;
    var sketches = 0;
    var invSketches = 0;
    for (var i = 0; i < arsenalExtraNums.length; i++) {
      var ex = extraSpells[arsenalExtraNums[i]];
      if (ex && ex.source === "phone-upload") phone++;
      else if (ex && ex.source === "sketch") sketches++;
      else if (ex && ex.source === "sketch-inverted") invSketches++;
      else gen++;
    }
    arsenalStats = {
      paintings: TOTAL,
      generated: gen,
      sketches: sketches,
      invertedSketches: invSketches,
      phone: phone,
      extras: extras,
      total: TOTAL + extras,
      pages: Math.max(1, Math.ceil((TOTAL + extras) / PAGE_SIZE)),
    };
    return arsenalStats;
  }

  function arsenalSummaryText() {
    var s = refreshArsenalStats();
    return (
      s.total +
      " spells · " +
      s.pages +
      " pages · " +
      s.paintings +
      " paintings + " +
      s.generated +
      " generated + " +
      (s.sketches || 0) +
      " sketches + " +
      (s.invertedSketches || 0) +
      " inverted + " +
      s.phone +
      " phone"
    );
  }

  function itemsOnPage(pageIndex) {
    var start = pageIndex * PAGE_SIZE;
    var out = [];
    for (var i = 0; i < PAGE_SIZE; i++) {
      var num = displayOrder[start + i];
      if (num != null) out.push(num);
    }
    return out;
  }

  function findPageForNumber(num) {
    var idx = displayOrder.indexOf(num);
    if (idx < 0) idx = displayOrder.indexOf(parseInt(num, 10));
    return idx < 0 ? 0 : Math.floor(idx / PAGE_SIZE);
  }

  function filterBySearch(query) {
    var qRaw = String(query || "").trim();
    if (!qRaw) return null;
    var qLow = qRaw.toLowerCase();
    var hits = [];
    for (var i = 0; i < displayOrder.length; i++) {
      var num = displayOrder[i];
      var a = getAnalysis(num);
      var extra = extraSpells[num] || extraSpells[String(num)];
      // Kind filters: phone / generated / gen / sketch
      if (extra) {
        if (qLow === "phone" && extra.source === "phone-upload") {
          hits.push(num);
          continue;
        }
        if (
          (qLow === "gen" || qLow === "generated") &&
          extra.source === "generated"
        ) {
          hits.push(num);
          continue;
        }
        if (
          (qLow === "sketch" || qLow === "sketches" || qLow === "line") &&
          (extra.source === "sketch" || extra.source === "sketch-inverted")
        ) {
          hits.push(num);
          continue;
        }
        if (
          (qLow === "inverted" ||
            qLow === "invert" ||
            qLow === "chalk" ||
            qLow === "si") &&
          extra.source === "sketch-inverted"
        ) {
          hits.push(num);
          continue;
        }
      }
      if (window.paintingMatchesSearch && !extra) {
        if (window.paintingMatchesSearch(num, a, qRaw)) hits.push(num);
        continue;
      }
      var text = spellKindLabel(num) + " ";
      if (extra && extra.genNum != null) {
        if (extra.source === "sketch") {
          text += "s#" + extra.genNum + " " + extra.genNum + " sketch ";
        } else if (extra.source === "sketch-inverted") {
          text +=
            "si#" +
            extra.genNum +
            " " +
            extra.genNum +
            " inverted chalk sketch ";
        } else {
          text += "g#" + extra.genNum + " " + extra.genNum + " ";
        }
      }
      if (a) {
        if (a.title) text += a.title + " ";
        if (a.description) text += a.description + " ";
        if (a.prompt) text += a.prompt + " ";
        if (a.source_description) text += a.source_description + " ";
        if (a.tags) text += a.tags.join(" ");
      }
      if (text.toLowerCase().indexOf(qLow) >= 0) hits.push(num);
    }
    if (window.paintingNumericSearchRank && window.numericQueryDigits(qRaw)) {
      hits.sort(function (a, b) {
        var ra = window.paintingNumericSearchRank(a, qRaw);
        var rb = window.paintingNumericSearchRank(b, qRaw);
        if (ra !== rb) return ra - rb;
        return a - b;
      });
    }
    return hits;
  }

  function makeTile(paintingNum, options) {
    options = options || {};
    var card = document.createElement("article");
    card.className = "card spell-pick";
    if (options.exactMatch) card.className += " search-exact";
    if (spells.indexOf(paintingNum) >= 0) card.className += " equipped";
    var extra = extraSpells[paintingNum] || extraSpells[String(paintingNum)];
    if (extra) {
      card.className +=
        extra.source === "phone-upload"
          ? " spell-pick-phone"
          : extra.source === "sketch"
            ? " spell-pick-sketch"
            : extra.source === "sketch-inverted"
              ? " spell-pick-sketch-inverted"
              : " spell-pick-generated";
    }
    card.setAttribute("role", "listitem");
    card.tabIndex = 0;
    card.dataset.number = String(paintingNum);

    var url = paintingUrl(paintingNum);
    var a = getAnalysis(paintingNum);
    var kind = spellKindLabel(paintingNum);
    var label =
      a && a.title
        ? (extra ? kind + " · " + a.title : "#" + paintingNum + " — " + a.title)
        : kind;
    card.title = label;

    card.innerHTML =
      '<div class="card-thumb">' +
      '<img src="' +
      escapeAttr(url) +
      '" alt="' +
      escapeAttr(label) +
      '" loading="eager" width="400" height="400" />' +
      "</div>" +
      '<div class="card-meta spell-pick-meta">' +
      '<div class="card-number">' +
      escapeHtml(kind) +
      "</div>" +
      (a && a.title
        ? '<div class="card-title spell-pick-title">' + escapeHtml(a.title) + "</div>"
        : "") +
      "</div>";

    return card;
  }

  function updatePageNav() {
    var searching = pickerQuery.trim().length > 0;
    var bar = document.getElementById("spellbook-pager-bar");
    var gridNav = document.getElementById("spellbook-grid-nav");
    var indicator = document.getElementById("spell-page-indicator");
    var prev = document.getElementById("spell-page-prev");
    var next = document.getElementById("spell-page-next");
    var pageJump = document.getElementById("spell-page-jump");
    var pages = totalPageCount();

    if (bar) bar.hidden = searching;
    if (gridNav) gridNav.hidden = false;

    if (indicator && !searching) {
      indicator.textContent =
        "Page " + (activePage + 1) + " of " + pages + " · " + arsenalSummaryText();
    }
    if (pageJump && !searching) {
      pageJump.max = String(pages);
      pageJump.value = String(activePage + 1);
      pageJump.setAttribute("max", String(pages));
    }
    if (prev) prev.disabled = searching || activePage <= 0;
    if (next) next.disabled = searching || activePage >= pages - 1;
  }

  function updatePickerCount(count) {
    var el = document.getElementById("spell-picker-count");
    if (!el) return;
    if (pickerQuery.trim()) {
      el.textContent = count + " matches · " + arsenalSummaryText();
    } else {
      el.textContent =
        "Page " +
        (activePage + 1) +
        "/" +
        totalPageCount() +
        " · " +
        arsenalSummaryText();
    }
  }

  function renderGrid() {
    var picker = document.getElementById("spell-picker");
    if (!picker) return;

    var searching = pickerQuery.trim().length > 0;
    var numbers = searching ? filterBySearch(pickerQuery) : itemsOnPage(activePage);
    picker.classList.toggle("spell-picker-5x5", !searching);
    picker.innerHTML = "";

    if (!numbers || !numbers.length) {
      picker.innerHTML =
        '<p class="spell-picker-empty">No paintings to show. Hard-refresh (Ctrl+Shift+R).</p>';
      updatePickerCount(0);
      updatePageNav();
      return;
    }

    for (var i = 0; i < numbers.length; i++) {
      picker.appendChild(
        makeTile(numbers[i], {
          exactMatch:
            window.isPrimaryNumericSearchHit &&
            window.isPrimaryNumericSearchHit(numbers[i], pickerQuery),
        })
      );
    }

    updatePickerCount(numbers.length);
    updatePageNav();
  }

  function selectPage(index) {
    activePage = Math.max(0, Math.min(totalPageCount() - 1, index | 0));
    pickerQuery = "";
    var search = document.getElementById("spell-search");
    if (search) search.value = "";
    renderGrid();
  }

  function goPrevPage() {
    if (activePage > 0) selectPage(activePage - 1);
  }

  function goNextPage() {
    if (activePage < totalPageCount() - 1) selectPage(activePage + 1);
  }

  function attachNav() {
    var prev = document.getElementById("spell-page-prev");
    var next = document.getElementById("spell-page-next");
    var pageJump = document.getElementById("spell-page-jump");
    if (prev) prev.onclick = function () { goPrevPage(); return false; };
    if (next) next.onclick = function () { goNextPage(); return false; };
    if (pageJump) {
      pageJump.onchange = function () {
        var p = parseInt(pageJump.value, 10);
        if (p >= 1 && p <= totalPageCount()) selectPage(p - 1);
      };
    }
  }

  function saveEquippedSpells() {
    try {
      localStorage.setItem(EQUIP_SAVE_KEY, JSON.stringify(spells));
    } catch (e) {}
  }

  function loadEquippedSpells() {
    try {
      var raw = localStorage.getItem(EQUIP_SAVE_KEY);
      if (!raw) return;
      var saved = JSON.parse(raw);
      if (!Array.isArray(saved) || saved.length !== 3) return;
      for (var i = 0; i < 3; i++) {
        var n = parseInt(saved[i], 10);
        spells[i] = isValidSpellNum(n) ? n : null;
      }
    } catch (e) {}
  }

  function loadSpellsFromShareLink() {
    try {
      var params = new URLSearchParams(window.location.search);
      var raw = params.get("spells");
      if (!raw) return;
      var parts = raw.split(",").map(function (x) {
        return parseInt(x.trim(), 10);
      });
      var valid = [];
      for (var i = 0; i < parts.length && valid.length < 3; i++) {
        if (isValidSpellNum(parts[i])) valid.push(parts[i]);
      }
      if (valid.length < 2) return;
      spells[0] = valid[0];
      spells[1] = valid[1];
      spells[2] = valid.length > 2 ? valid[2] : null;
      saveEquippedSpells();
    } catch (e) {}
  }

  function buildShareSpellUrl() {
    var nums = getEquippedInOrder();
    if (nums.length < 2) return "";
    try {
      var u = new URL(window.location.href);
      u.searchParams.set("spells", nums.join(","));
      u.hash = "spellforge";
      return u.href;
    } catch (e) {
      return "";
    }
  }

  function copyShareSpellLink() {
    var url = buildShareSpellUrl();
    var status = document.getElementById("spell-share-status");
    if (!url) {
      if (status) status.textContent = "Equip at least 2 spells first.";
      return;
    }
    function done(ok) {
      if (status) {
        status.textContent = ok
          ? "Link copied — send it so friends load your spell combo."
          : "Copy this link: " + url;
      }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () {
        done(true);
      }).catch(function () {
        done(false);
      });
    } else {
      done(false);
    }
  }

  function getEquippedInOrder() {
    var out = [];
    for (var i = 0; i < spells.length; i++) {
      if (spells[i]) out.push(spells[i]);
    }
    return out;
  }

  function uniqueStrings(list) {
    var seen = {};
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var key = String(list[i]).toLowerCase();
      if (!list[i] || seen[key]) continue;
      seen[key] = true;
      out.push(list[i]);
    }
    return out;
  }

  function normalizeHex(raw) {
    var s = String(raw || "")
      .trim()
      .replace(/^#/, "");
    if (/^[0-9a-fA-F]{3}$/.test(s)) {
      s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    }
    if (!/^[0-9a-fA-F]{6}$/.test(s)) return "";
    return ("#" + s).toUpperCase();
  }

  function hexToRgb(hex) {
    var h = normalizeHex(hex);
    if (!h) return null;
    return {
      r: parseInt(h.slice(1, 3), 16),
      g: parseInt(h.slice(3, 5), 16),
      b: parseInt(h.slice(5, 7), 16),
    };
  }

  function rgbToHsl(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    var max = Math.max(r, g, b);
    var min = Math.min(r, g, b);
    var h = 0;
    var s = 0;
    var l = (max + min) / 2;
    if (max !== min) {
      var d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
      else if (max === g) h = ((b - r) / d + 2) / 6;
      else h = ((r - g) / d + 4) / 6;
    }
    return { h: h * 360, s: s * 100, l: l * 100 };
  }

  /** sRGB 0–255 → CIE Lab (D65) for perceptually better nearest-name matching. */
  function rgbToLab(r, g, b) {
    function lin(c) {
      c = c / 255;
      return c > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92;
    }
    var R = lin(r);
    var G = lin(g);
    var B = lin(b);
    var x = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / 0.95047;
    var y = (R * 0.2126729 + G * 0.7151522 + B * 0.072175) / 1.0;
    var z = (R * 0.0193339 + G * 0.119192 + B * 0.9503041) / 1.08883;
    function f(t) {
      return t > 0.008856 ? Math.pow(t, 1 / 3) : 7.787 * t + 16 / 116;
    }
    var fx = f(x);
    var fy = f(y);
    var fz = f(z);
    return {
      L: 116 * fy - 16,
      a: 500 * (fx - fy),
      b: 200 * (fy - fz),
    };
  }

  function labDistanceSq(A, B) {
    if (!A || !B) return 1e12;
    var dL = A.L - B.L;
    var da = A.a - B.a;
    var db = A.b - B.b;
    return dL * dL + da * da + db * db;
  }

  function isNeutralSample(hsl, lab) {
    if (!hsl) return true;
    // Low saturation, or very light/dark with modest chroma
    var chroma = lab ? Math.sqrt(lab.a * lab.a + lab.b * lab.b) : hsl.s;
    if (hsl.s < 12 || chroma < 10) return true;
    if (hsl.s < 22 && (hsl.l < 10 || hsl.l > 93)) return true;
    if (hsl.s < 18 && hsl.l > 78 && chroma < 18) return true;
    return false;
  }

  function nameToHex(name) {
    var key = String(name || "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z]/g, "");
    if (COLOR_NAME_HEX[key]) return COLOR_NAME_HEX[key];
    // multi-word: "deep blue" → try last token
    var parts = String(name || "")
      .toLowerCase()
      .split(/[\s\-_\/]+/);
    for (var i = parts.length - 1; i >= 0; i--) {
      var p = parts[i].replace(/[^a-z]/g, "");
      if (COLOR_NAME_HEX[p]) return COLOR_NAME_HEX[p];
    }
    return "";
  }

  function titleCaseColorName(name) {
    return String(name || "color")
      .replace(/^vivid\s+/i, "")
      .replace(/hotpink/i, "Hot Pink")
      .split(/[\s\-_]+/)
      .filter(Boolean)
      .map(function (w) {
        if (/^hotpink$/i.test(w)) return "Hot Pink";
        return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
      })
      .join(" ");
  }

  /**
   * Nearest dictionary name for a hex — Lab distance + neutral/chroma separation
   * so light pinks do not become "Beige" and rich blues do not become "Navy".
   */
  function hexToNearestName(hex) {
    var h = normalizeHex(hex);
    if (!h) return "color";
    var rgb = hexToRgb(h);
    if (!rgb) return "color";
    var lab = rgbToLab(rgb.r, rgb.g, rgb.b);
    var hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
    var sampleNeutral = isNeutralSample(hsl, lab);

    var best = "color";
    var bestD = Infinity;
    var keys = Object.keys(COLOR_NAME_HEX);
    for (var i = 0; i < keys.length; i++) {
      var name = keys[i];
      // Prefer American spelling when both grey/gray exist
      if (name === "grey") continue;
      var refHex = COLOR_NAME_HEX[name];
      if (refHex === h) return name;
      var ref = hexToRgb(refHex);
      if (!ref) continue;
      var refLab = rgbToLab(ref.r, ref.g, ref.b);
      var refHsl = rgbToHsl(ref.r, ref.g, ref.b);
      var refNeutral = !!COLOR_NEUTRAL_NAMES[name] || isNeutralSample(refHsl, refLab);

      // Chromatic samples only match chromatic names; neutrals only match neutrals
      if (sampleNeutral !== refNeutral) continue;

      var d = labDistanceSq(lab, refLab);
      // Soft hue preference for chromatics (avoid sand-beige winning over peach)
      if (!sampleNeutral) {
        var dh = Math.abs(hsl.h - refHsl.h);
        if (dh > 180) dh = 360 - dh;
        d += (dh / 180) * (dh / 180) * 140;
        // Prefer more saturated dictionary swatches when sample is bold
        if (hsl.s > 45 && refHsl.s < 30) d += 80;
      } else {
        // Neutrals: weight lightness more than tiny a/b noise
        var dL = lab.L - refLab.L;
        d = dL * dL * 1.35 + (lab.a - refLab.a) * (lab.a - refLab.a) * 0.6 +
          (lab.b - refLab.b) * (lab.b - refLab.b) * 0.6;
      }

      if (d < bestD) {
        bestD = d;
        best = name;
      }
    }
    return best;
  }

  /**
   * Optional light/deep/pale prefix when sample L differs a lot from the named swatch.
   */
  function hexToNearestNameWithTone(hex) {
    var base = hexToNearestName(hex);
    if (!base || base === "color") return base;
    if (COLOR_NEUTRAL_NAMES[base]) return base;
    var rgb = hexToRgb(hex);
    var ref = hexToRgb(COLOR_NAME_HEX[base]);
    if (!rgb || !ref) return base;
    var L = rgbToLab(rgb.r, rgb.g, rgb.b).L;
    var refL = rgbToLab(ref.r, ref.g, ref.b).L;
    var dL = L - refL;
    if (dL > 18 && L > 62) return "light " + base;
    if (dL > 12 && L > 78) return "pale " + base;
    if (dL < -18 && L < 42) return "deep " + base;
    if (dL < -12 && L < 28) return "dark " + base;
    return base;
  }

  /** Final token written into spell text + sent to xAI. */
  function formatBoldColorLabel(hex) {
    var h = normalizeHex(hex);
    if (!h) return "";
    var name = titleCaseColorName(hexToNearestNameWithTone(h));
    return name + " (" + h + ")";
  }

  /** Display name only (for popover title). */
  function formatBoldColorNameOnly(hex) {
    var h = normalizeHex(hex);
    if (!h) return "Color";
    return titleCaseColorName(hexToNearestNameWithTone(h));
  }

  function colorDistanceSq(hexA, hexB) {
    var A = hexToRgb(hexA);
    var B = hexToRgb(hexB);
    if (!A || !B) return 1e12;
    var dr = A.r - B.r;
    var dg = A.g - B.g;
    var db = A.b - B.b;
    return dr * dr + dg * dg + db * db;
  }

  /**
   * Same pigment family: exact hex, or same nearest name with close RGB
   * (so duplicate “blue / Blue (#…) / #2563EB” edit as one thing).
   */
  function sameColorFamily(hexA, hexB) {
    var a = normalizeHex(hexA);
    var b = normalizeHex(hexB);
    if (!a || !b) return false;
    if (a === b) return true;
    if (hexToNearestName(a) !== hexToNearestName(b)) return false;
    // ~42 per channel — close variants of the same named hue
    return colorDistanceSq(a, b) <= 42 * 42 * 3;
  }

  /**
   * Expand a name or bare-hex span so re-apply replaces a full "Name (#HEX)" block.
   */
  function expandColorTokenRange(body, start, end) {
    body = String(body || "");
    start = Math.max(0, parseInt(start, 10) || 0);
    end = Math.min(body.length, parseInt(end, 10) || 0);
    if (end < start) return { start: start, end: start };

    var before = body.slice(0, start);
    var after = body.slice(end);

    // Name followed by " (#HEX)"
    var trail = after.match(/^\s*\(#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})\)/);
    if (trail) {
      return { start: start, end: end + trail[0].length };
    }

    // Bare hex preceded by "Name (" — one word only (avoid eating "a Scarlet")
    var lead = before.match(/((?:vivid\s+)?[A-Za-z][a-zA-Z]+)\s*\(\s*$/i);
    if (lead) {
      var end2 = end;
      var closeM = after.match(/^\s*\)/);
      if (closeM) end2 = end + closeM[0].length;
      return { start: start - lead[0].length, end: end2 };
    }

    return { start: start, end: end };
  }

  function hashToHex(str) {
    var h = 2166136261;
    var s = String(str || "color");
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    h = Math.abs(h >>> 0);
    var r = 60 + (h % 160);
    var g = 50 + ((h >> 8) % 160);
    var b = 70 + ((h >> 16) % 160);
    function hx(n) {
      var t = n.toString(16).toUpperCase();
      return t.length < 2 ? "0" + t : t;
    }
    return "#" + hx(r) + hx(g) + hx(b);
  }

  function getSpellSlotBody(slotIndex) {
    if (!spells[slotIndex]) return "";
    if (spellSlotBodyOverride[slotIndex] != null) return spellSlotBodyOverride[slotIndex];
    var note = noteOf(spells[slotIndex]);
    if (note) return String(note.text || "");
    return analysisSpellText(spells[slotIndex]);
  }

  function setSpellSlotBody(slotIndex, text) {
    spellSlotBodyOverride[slotIndex] = String(text || "");
  }

  function resetSpellSlotBody(slotIndex) {
    spellSlotBodyOverride[slotIndex] = null;
  }

  function clearSpellSlotBody(slotIndex) {
    spellSlotBodyOverride[slotIndex] = null;
  }

  /**
   * Find color tokens in text (non-overlapping), left-to-right.
   * Prefers labeled "Name (#HEX)" blocks, then bare hex, then bare names.
   * Returns { start, end, kind: 'labeled'|'name'|'hex', value, hex, name? }[]
   */
  function scanColorSpans(text) {
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

    // 1) Labeled: Scarlet (#FF2400) or vivid Scarlet (#FF2400)
    var labeledRe =
      /\b((?:vivid\s+)?[A-Za-z][A-Za-z\s\-]{0,28}?)\s*\(#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})\)/g;
    while ((m = labeledRe.exec(text))) {
      var hxL = normalizeHex("#" + m[2]);
      if (!hxL) continue;
      if (!free(m.index, m.index + m[0].length)) continue;
      mark(m.index, m.index + m[0].length);
      var rawName = String(m[1] || "")
        .replace(/^vivid\s+/i, "")
        .trim();
      spans.push({
        start: m.index,
        end: m.index + m[0].length,
        kind: "labeled",
        value: m[0],
        hex: hxL,
        name: rawName,
      });
    }

    // 2) Bare hex
    var hexRe = /#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/g;
    while ((m = hexRe.exec(text))) {
      var hx = normalizeHex(m[0]);
      if (!hx) continue;
      if (!free(m.index, m.index + m[0].length)) continue;
      mark(m.index, m.index + m[0].length);
      spans.push({
        start: m.index,
        end: m.index + m[0].length,
        kind: "hex",
        value: m[0],
        hex: hx,
        name: titleCaseColorName(hexToNearestName(hx)),
      });
    }

    // 3) Bare color names
    var names = Object.keys(COLOR_NAME_HEX).sort(function (a, b) {
      return b.length - a.length;
    });
    for (var n = 0; n < names.length; n++) {
      var name = names[n];
      if (name === "grey") continue; // gray covers it
      var re = new RegExp("\\b" + name + "\\b", "gi");
      var mm;
      while ((mm = re.exec(text))) {
        if (!free(mm.index, mm.index + mm[0].length)) continue;
        mark(mm.index, mm.index + mm[0].length);
        spans.push({
          start: mm.index,
          end: mm.index + mm[0].length,
          kind: "name",
          value: mm[0],
          hex: COLOR_NAME_HEX[name],
          name: titleCaseColorName(name),
        });
      }
    }
    spans.sort(function (a, b) {
      return a.start - b.start;
    });
    return spans;
  }

  function countColorsInText(text) {
    return scanColorSpans(text).length;
  }

  function spellSlotActionBar(slotIndex, colorCount) {
    var dirty = spellSlotBodyOverride[slotIndex] != null;
    var n = colorCount != null ? colorCount : 0;
    return (
      '<div class="spell-slot-color-bar">' +
      '<span class="spell-slot-color-count">' +
      n +
      " color" +
      (n === 1 ? "" : "s") +
      " stated</span>" +
      '<span class="spell-slot-actions">' +
      '<button type="button" class="spell-slot-text-edit btn-secondary" data-slot="' +
      slotIndex +
      '" title="Edit this spell’s description and image prompt (fix names, wording)">Edit text</button>' +
      '<button type="button" class="spell-slot-color-reset btn-secondary" data-slot="' +
      slotIndex +
      '"' +
      (dirty ? "" : " disabled") +
      ' title="Restore original spell description (undo color + text edits)">Default text</button>' +
      "</span>" +
      "</div>"
    );
  }

  /** Highlight colors — click opens editor; Apply writes "Name (#HEX)" boldly. */
  function buildSpellColorHtml(text, slotIndex) {
    var spans = scanColorSpans(text);
    if (!spans.length) {
      return (
        '<pre class="spell-slot-text">' + escapeHtml(text) + "</pre>" +
        spellSlotActionBar(slotIndex, 0)
      );
    }
    var html = "";
    var pos = 0;
    var idx = 0;
    spans.forEach(function (sp) {
      if (sp.start > pos) {
        html += escapeHtml(text.slice(pos, sp.start));
      }
      idx++;
      var label = formatBoldColorLabel(sp.hex);
      var cls =
        "spell-color-hit" +
        (sp.kind === "labeled"
          ? " is-labeled"
          : sp.kind === "hex"
            ? " is-hex"
            : " is-name");
      var title =
        "Click to recolor → Apply writes “" +
        label +
        "” (name + hex, bold for the AI)";
      html +=
        '<button type="button" class="' +
        cls +
        '" data-slot="' +
        slotIndex +
        '" data-start="' +
        sp.start +
        '" data-end="' +
        sp.end +
        '" data-kind="' +
        sp.kind +
        '" data-value="' +
        escapeHtml(sp.value) +
        '" data-hex="' +
        escapeHtml(sp.hex) +
        '" data-index="' +
        idx +
        '" title="' +
        escapeHtml(title) +
        '" style="--swatch:' +
        escapeHtml(sp.hex) +
        '">' +
        '<i class="spell-color-hit-swatch" aria-hidden="true"></i>' +
        "<span>" +
        escapeHtml(sp.value) +
        "</span>" +
        (sp.kind === "name"
          ? '<em class="spell-color-hit-hex">' + escapeHtml(sp.hex) + "</em>"
          : sp.kind === "hex"
            ? '<em class="spell-color-hit-hex">' +
              escapeHtml(titleCaseColorName(hexToNearestName(sp.hex))) +
              "</em>"
            : "") +
        "</button>";
      pos = sp.end;
    });
    if (pos < text.length) html += escapeHtml(text.slice(pos));
    return (
      '<div class="spell-slot-text spell-slot-text-rich">' +
      html +
      "</div>" +
      spellSlotActionBar(slotIndex, spans.length)
    );
  }

  function closeSpellColorPopover() {
    var old = document.getElementById("spell-color-popover");
    if (old) old.remove();
    var oldEdit = document.getElementById("spell-text-edit-popover");
    if (oldEdit) oldEdit.remove();
    if (closeSpellColorPopover._onDoc) {
      document.removeEventListener("mousedown", closeSpellColorPopover._onDoc, true);
      closeSpellColorPopover._onDoc = null;
    }
    if (closeSpellColorPopover._onKey) {
      document.removeEventListener("keydown", closeSpellColorPopover._onKey, true);
      closeSpellColorPopover._onKey = null;
    }
  }

  /**
   * Free-text editor for one spell’s body (title/description/prompt block).
   * Fixes OCR/AI name mistakes like Forel → Foret without touching other slots.
   */
  function openSlotTextEditor(slotIndex, anchorEl) {
    closeSpellColorPopover();
    var startText = getSpellSlotBody(slotIndex);
    var pop = document.createElement("div");
    pop.id = "spell-text-edit-popover";
    pop.className = "spell-text-edit-popover";
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-label", "Edit spell text");
    var roman = ["I", "II", "III"][slotIndex] || String(slotIndex + 1);
    pop.innerHTML =
      '<div class="spell-color-popover-title">Edit Spell ' +
      roman +
      " text</div>" +
      '<p class="spell-color-popover-hint">Correct names, banner wording, and image prompt for <strong>this spell only</strong>. Changes feed generate.</p>' +
      '<textarea class="spell-text-edit-area" rows="12" spellcheck="true" aria-label="Spell description and prompt"></textarea>' +
      '<div class="spell-color-popover-actions">' +
      '<button type="button" class="btn-secondary spell-text-edit-cancel">Cancel</button>' +
      '<button type="button" class="btn-cast spell-text-edit-save">Save</button>' +
      "</div>";
    document.body.appendChild(pop);
    var area = pop.querySelector(".spell-text-edit-area");
    var saveBtn = pop.querySelector(".spell-text-edit-save");
    var cancelBtn = pop.querySelector(".spell-text-edit-cancel");
    area.value = startText;

    function placePopover() {
      var rect =
        anchorEl && anchorEl.getBoundingClientRect
          ? anchorEl.getBoundingClientRect()
          : { left: 16, top: 16, right: 16, bottom: 48, width: 120, height: 28 };
      var pw = pop.offsetWidth || 360;
      var ph = pop.offsetHeight || 320;
      var left = rect.left + window.scrollX;
      var top = rect.bottom + window.scrollY + 6;
      var maxL = window.scrollX + window.innerWidth - pw - 8;
      var maxT = window.scrollY + window.innerHeight - ph - 8;
      if (left > maxL) left = Math.max(window.scrollX + 8, maxL);
      if (left < window.scrollX + 8) left = window.scrollX + 8;
      if (top > maxT) top = Math.max(window.scrollY + 8, rect.top + window.scrollY - ph - 6);
      if (top < window.scrollY + 8) top = window.scrollY + 8;
      pop.style.left = Math.round(left) + "px";
      pop.style.top = Math.round(top) + "px";
    }
    placePopover();
    requestAnimationFrame(placePopover);

    function save() {
      var next = String(area.value || "");
      setSpellSlotBody(slotIndex, next);
      // Patch live analysis title/description/prompt so re-equip picks up Foret etc.
      patchAnalysisFromSlotBody(slotIndex, next);
      closeSpellColorPopover();
      renderSlots();
    }
    saveBtn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      save();
    });
    cancelBtn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      closeSpellColorPopover();
    });
    area.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        e.preventDefault();
        closeSpellColorPopover();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        save();
      }
    });

    closeSpellColorPopover._onDoc = function (e) {
      if (pop.contains(e.target)) return;
      if (anchorEl && anchorEl.contains && anchorEl.contains(e.target)) return;
      closeSpellColorPopover();
    };
    closeSpellColorPopover._onKey = function (e) {
      if (e.key === "Escape") closeSpellColorPopover();
    };
    setTimeout(function () {
      document.addEventListener("mousedown", closeSpellColorPopover._onDoc, true);
      document.addEventListener("keydown", closeSpellColorPopover._onKey, true);
    }, 0);
    setTimeout(function () {
      try {
        area.focus();
      } catch (err) {}
    }, 30);
  }

  /**
   * When user edits slot text, push obvious title/description/prompt fixes
   * into the in-memory analysis so the head label and future defaults improve.
   */
  function patchAnalysisFromSlotBody(slotIndex, body) {
    var num = spells[slotIndex];
    if (!num) return;
    body = String(body || "");
    var a = getAnalysis(num);
    if (!a) {
      a = {};
      analyses[String(num)] = a;
      analyses[num] = a;
    }
    var lines = body.split(/\n+/).map(function (l) {
      return l.trim();
    }).filter(Boolean);
    if (!lines.length) return;

    // First non-meta line often is title
    var first = lines[0];
    if (
      first &&
      first.length < 80 &&
      first.indexOf("Prompt weight:") !== 0 &&
      first.indexOf("Style:") !== 0 &&
      first.indexOf("Tags:") !== 0 &&
      first.indexOf("Phone upload") !== 0
    ) {
      a.title = first.replace(/^['"]|['"]$/g, "");
    }

    // Description: block before "Prompt weight:"
    var descParts = [];
    var promptPart = "";
    var mode = "desc";
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (i === 0 && a.title && line === a.title) continue;
      if (/^Phone upload/i.test(line)) continue;
      if (/^Prompt weight:\s*/i.test(line)) {
        mode = "prompt";
        promptPart = line.replace(/^Prompt weight:\s*/i, "");
        continue;
      }
      if (/^Style:\s*/i.test(line) || /^Tags:\s*/i.test(line)) continue;
      if (mode === "prompt") promptPart += (promptPart ? " " : "") + line;
      else descParts.push(line);
    }
    if (descParts.length) a.description = descParts.join(" ");
    if (promptPart) a.prompt = promptPart;

    // Keep phone extra title in sync
    var extra = extraSpells[num] || extraSpells[String(num)];
    if (extra && a.title) {
      extra.title = a.title;
      if (extra.analysis) {
        extra.analysis.title = a.title;
        if (a.description) extra.analysis.description = a.description;
        if (a.prompt) extra.analysis.prompt = a.prompt;
      }
    }
  }

  /**
   * Floating color editor — Apply writes "Name (#HEX)" at this span only.
   * opts: { start, end, oldHex, anchorEl }
   */
  function openSlotHexPicker(slotIndex, opts) {
    opts = opts || {};
    closeSpellColorPopover();
    var startHex = normalizeHex(opts.oldHex) || "#EF4444";
    var spanStart = opts.start;
    var spanEnd = opts.end;
    var anchorEl = opts.anchorEl;

    var pop = document.createElement("div");
    pop.id = "spell-color-popover";
    pop.className = "spell-color-popover";
    pop.setAttribute("role", "dialog");
    pop.setAttribute(
      "aria-label",
      "Bold color rewrite: " + formatBoldColorNameOnly(startHex)
    );

    pop.innerHTML =
      '<div class="spell-color-popover-title">' +
      'Bold color rewrite: <span class="spell-color-popover-name" aria-live="polite">' +
      escapeHtml(formatBoldColorNameOnly(startHex)) +
      "</span></div>" +
      '<div class="spell-color-popover-row">' +
      '<input type="color" class="spell-color-popover-swatch" value="' +
      startHex +
      '" aria-label="Color swatch" />' +
      '<input type="text" class="spell-color-popover-hex" value="' +
      startHex +
      '" maxlength="7" spellcheck="false" aria-label="Hex code" />' +
      "</div>" +
      '<div class="spell-color-popover-preview" aria-live="polite">' +
      "Writes: <strong class=\"spell-color-popover-label\">" +
      escapeHtml(formatBoldColorLabel(startHex)) +
      "</strong></div>" +
      '<p class="spell-color-popover-hint">Writes name + hex. Matching mentions of this color update only inside <strong>this spell</strong> — Spells I / II / III never change each other.</p>' +
      '<div class="spell-color-popover-actions">' +
      '<button type="button" class="btn-secondary spell-color-popover-cancel">Cancel</button>' +
      '<button type="button" class="btn-cast spell-color-popover-apply">Apply</button>' +
      "</div>";

    document.body.appendChild(pop);

    var swatch = pop.querySelector(".spell-color-popover-swatch");
    var hexIn = pop.querySelector(".spell-color-popover-hex");
    var labelEl = pop.querySelector(".spell-color-popover-label");
    var nameEl = pop.querySelector(".spell-color-popover-name");
    var applyBtn = pop.querySelector(".spell-color-popover-apply");
    var cancelBtn = pop.querySelector(".spell-color-popover-cancel");

    function syncPreview() {
      var h = normalizeHex(hexIn.value) || normalizeHex(swatch.value) || startHex;
      var nameOnly = formatBoldColorNameOnly(h);
      if (labelEl) labelEl.textContent = formatBoldColorLabel(h);
      if (nameEl) nameEl.textContent = nameOnly;
      pop.setAttribute("aria-label", "Bold color rewrite: " + nameOnly);
      if (normalizeHex(hexIn.value)) {
        try {
          swatch.value = normalizeHex(hexIn.value);
        } catch (e) {}
      }
    }

    function placePopover() {
      var rect =
        anchorEl && anchorEl.getBoundingClientRect
          ? anchorEl.getBoundingClientRect()
          : { left: 16, top: 16, right: 16, bottom: 48, width: 80, height: 28 };
      var pw = pop.offsetWidth || 240;
      var ph = pop.offsetHeight || 160;
      var left = rect.left + window.scrollX;
      var top = rect.bottom + window.scrollY + 6;
      var maxL = window.scrollX + window.innerWidth - pw - 8;
      var maxT = window.scrollY + window.innerHeight - ph - 8;
      if (left > maxL) left = Math.max(window.scrollX + 8, maxL);
      if (left < window.scrollX + 8) left = window.scrollX + 8;
      if (top > maxT) {
        top = rect.top + window.scrollY - ph - 6;
      }
      if (top < window.scrollY + 8) top = window.scrollY + 8;
      pop.style.left = Math.round(left) + "px";
      pop.style.top = Math.round(top) + "px";
    }

    placePopover();
    requestAnimationFrame(placePopover);

    swatch.addEventListener("input", function () {
      var h = normalizeHex(swatch.value);
      if (h) hexIn.value = h;
      syncPreview();
    });
    hexIn.addEventListener("input", function () {
      syncPreview();
    });

    function apply() {
      var h = normalizeHex(hexIn.value) || normalizeHex(swatch.value);
      if (!h) {
        closeSpellColorPopover();
        return;
      }
      var oldH = normalizeHex(opts.oldHex) || startHex;
      // Only this spell slot — never rewrite colors on the other two fields.
      var n = rewriteColorFamilyInSlot(slotIndex, oldH, h, {
        focusStart: spanStart,
        focusEnd: spanEnd,
      });
      if (!n) {
        var body = getSpellSlotBody(slotIndex);
        var token = formatBoldColorLabel(h);
        var next =
          body.replace(/\s+$/, "") +
          (body ? " " : "") +
          "COLOR LOCK: " +
          token +
          ".";
        setSpellSlotBody(slotIndex, next);
      }
      closeSpellColorPopover();
      renderSlots();
    }

    applyBtn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      apply();
    });
    cancelBtn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      closeSpellColorPopover();
    });
    hexIn.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        apply();
      }
    });

    closeSpellColorPopover._onDoc = function (e) {
      if (pop.contains(e.target)) return;
      if (anchorEl && anchorEl.contains && anchorEl.contains(e.target)) return;
      closeSpellColorPopover();
    };
    closeSpellColorPopover._onKey = function (e) {
      if (e.key === "Escape") closeSpellColorPopover();
    };
    setTimeout(function () {
      document.addEventListener("mousedown", closeSpellColorPopover._onDoc, true);
      document.addEventListener("keydown", closeSpellColorPopover._onKey, true);
    }, 0);

    setTimeout(function () {
      try {
        hexIn.focus();
        hexIn.select();
      } catch (err) {}
    }, 30);
  }

  function bindSpellSlotColorHits(slotEl, slotIndex) {
    if (!slotEl) return;
    var hits = slotEl.querySelectorAll(".spell-color-hit");
    for (var i = 0; i < hits.length; i++) {
      (function (btn) {
        btn.addEventListener("click", function (e) {
          e.preventDefault();
          e.stopPropagation();
          var start = parseInt(btn.getAttribute("data-start"), 10);
          var end = parseInt(btn.getAttribute("data-end"), 10);
          var hex = btn.getAttribute("data-hex") || "";
          openSlotHexPicker(slotIndex, {
            start: start,
            end: end,
            oldHex: hex,
            anchorEl: btn,
          });
        });
      })(hits[i]);
    }
    var editBtn = slotEl.querySelector(".spell-slot-text-edit");
    if (editBtn) {
      editBtn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        openSlotTextEditor(slotIndex, editBtn);
      });
    }
    var resetBtn = slotEl.querySelector(".spell-slot-color-reset");
    if (resetBtn) {
      resetBtn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        resetSpellSlotBody(slotIndex);
        renderSlots();
      });
    }
  }

  /**
   * Rewrite every span in `body` that belongs to oldHex's pigment family
   * with the new bold "Name (#HEX)" token. Returns { text, count }.
   */
  function rewriteColorFamilyInBody(body, oldHex, newHex) {
    body = String(body || "");
    var oldH = normalizeHex(oldHex);
    var newH = normalizeHex(newHex);
    if (!oldH || !newH) return { text: body, count: 0 };
    var token = formatBoldColorLabel(newH);
    var spans = scanColorSpans(body);
    var hits = [];
    for (var i = 0; i < spans.length; i++) {
      if (sameColorFamily(spans[i].hex, oldH)) hits.push(spans[i]);
    }
    if (!hits.length) return { text: body, count: 0 };
    // Replace high → low so indices stay valid
    hits.sort(function (a, b) {
      return b.start - a.start;
    });
    var next = body;
    var count = 0;
    for (var h = 0; h < hits.length; h++) {
      var range = expandColorTokenRange(next, hits[h].start, hits[h].end);
      // Re-scan safety: range must still look like a color token region
      if (range.end < range.start || range.start < 0 || range.end > next.length) continue;
      next = next.slice(0, range.start) + token + next.slice(range.end);
      count++;
    }
    return { text: next, count: count };
  }

  /**
   * Apply family rewrite only inside one spell slot (Spell I, II, or III).
   * Matching blues/reds in the other two fields are left untouched.
   */
  function rewriteColorFamilyInSlot(slotIndex, oldHex, newHex, focus) {
    focus = focus || {};
    if (slotIndex == null || slotIndex < 0 || slotIndex > 2) return 0;
    if (!spells[slotIndex]) return 0;
    var oldH = normalizeHex(oldHex);
    var newH = normalizeHex(newHex);
    var body = getSpellSlotBody(slotIndex);
    var res = rewriteColorFamilyInBody(body, oldH, newH);
    if (res.count > 0) {
      setSpellSlotBody(slotIndex, res.text);
      return res.count;
    }
    // Fallback: replace only the clicked span in this slot
    if (
      typeof focus.focusStart === "number" &&
      typeof focus.focusEnd === "number" &&
      !isNaN(focus.focusStart) &&
      !isNaN(focus.focusEnd)
    ) {
      var range = expandColorTokenRange(
        body,
        focus.focusStart,
        focus.focusEnd
      );
      if (
        range.start >= 0 &&
        range.end <= body.length &&
        range.end >= range.start
      ) {
        var token = formatBoldColorLabel(newH);
        setSpellSlotBody(
          slotIndex,
          body.slice(0, range.start) + token + body.slice(range.end)
        );
        return 1;
      }
    }
    return 0;
  }

  /**
   * Canonical palette: one entry per pigment family (same name / near hex),
   * preferring user-labeled hexes. Used so prompts never restate the same color.
   */
  function getCanonicalColorLocks() {
    var samples = [];
    for (var s = 0; s < 3; s++) {
      if (!spells[s]) continue;
      var spans = scanColorSpans(getSpellSlotBody(s));
      for (var i = 0; i < spans.length; i++) {
        var hx = normalizeHex(spans[i].hex);
        if (!hx) continue;
        samples.push({
          hex: hx,
          name: hexToNearestName(hx),
          labeled: spans[i].kind === "labeled",
          slot: s,
        });
      }
    }
    var groups = [];
    for (var si = 0; si < samples.length; si++) {
      var sample = samples[si];
      var group = null;
      for (var g = 0; g < groups.length; g++) {
        if (sameColorFamily(groups[g].hex, sample.hex)) {
          group = groups[g];
          break;
        }
      }
      if (!group) {
        groups.push({
          hex: sample.hex,
          name: sample.name,
          labeled: sample.labeled,
          count: 1,
          slots: [sample.slot],
        });
        continue;
      }
      group.count += 1;
      if (group.slots.indexOf(sample.slot) < 0) group.slots.push(sample.slot);
      // Prefer labeled (user-applied) hex as the canonical pigment
      if (sample.labeled && !group.labeled) {
        group.hex = sample.hex;
        group.name = sample.name;
        group.labeled = true;
      } else if (sample.labeled && group.labeled) {
        // Keep first labeled; still same family
      } else if (!group.labeled && sample.hex) {
        // Prefer more saturated / later user intent: keep existing unless identical name drift
        group.hex = sample.hex;
        group.name = sample.name;
      }
    }
    return groups.map(function (gr) {
      return {
        hex: gr.hex,
        name: gr.name,
        label: formatBoldColorLabel(gr.hex),
        count: gr.count,
        slots: gr.slots,
      };
    });
  }

  /** Unique “Name (#HEX)” labels — one per color family. */
  function getPaletteColorLabels() {
    return getCanonicalColorLocks().map(function (g) {
      return g.label;
    });
  }

  /** Unique hexes — one per color family (aligned with labels). */
  function getPaletteHexList() {
    return getCanonicalColorLocks().map(function (g) {
      return g.hex;
    });
  }

  function stasisWithPaletteHex() {
    var base = String(spellStasis || "").trim();
    base = base
      .replace(/\n?Palette\s*\(\d+\s*colors?\)\s*:[^\n]*/gi, "")
      .replace(/\n?Spell\s+[IVX]+\s+palette\s*:[^\n]*/gi, "")
      .trim();
    var lines = [];
    var names = ["I", "II", "III"];
    for (var s = 0; s < 3; s++) {
      if (!spells[s]) continue;
      var spans = scanColorSpans(getSpellSlotBody(s));
      var hexes = [];
      var seen = {};
      for (var i = 0; i < spans.length; i++) {
        if (spans[i].kind !== "hex") continue;
        if (seen[spans[i].hex]) continue;
        seen[spans[i].hex] = true;
        hexes.push(spans[i].hex);
      }
      if (hexes.length) {
        lines.push(
          "Spell " + names[s] + " palette (" + hexes.length + "): " + hexes.join(", ")
        );
      }
    }
    if (!lines.length) return base;
    return (base ? base + "\n\n" + lines.join("\n") : lines.join("\n")).trim();
  }

  function collectCombinedMeta(nums) {
    var styles = [];
    var tags = [];
    var moods = [];
    var colors = [];
    for (var i = 0; i < nums.length; i++) {
      var a = getAnalysis(nums[i]);
      if (!a) continue;
      if (a.style) styles.push(a.style);
      if (a.mood) moods.push(a.mood);
      if (a.tags) tags = tags.concat(a.tags);
      if (a.colors) colors = colors.concat(a.colors);
    }
    // Prefer live hex from per-spell text overrides
    var liveHex = getPaletteHexList();
    return {
      styles: uniqueStrings(styles),
      tags: uniqueStrings(tags),
      moods: uniqueStrings(moods),
      colors: liveHex.length ? liveHex : uniqueStrings(colors),
    };
  }

  function renderChipList(el, items) {
    if (!el) return;
    el.innerHTML = "";
    if (!items.length) {
      el.innerHTML = '<span class="spell-chip">—</span>';
      return;
    }
    for (var i = 0; i < items.length; i++) {
      var span = document.createElement("span");
      span.className = "spell-chip";
      span.textContent = items[i];
      el.appendChild(span);
    }
  }

  function localFusedTitle(nums) {
    var titles = [];
    for (var i = 0; i < nums.length; i++) {
      var a = getAnalysis(nums[i]);
      if (a && a.title) titles.push(a.title);
    }
    if (!titles.length) return "Fused spell · #" + nums.join(", #");
    if (titles.length === 2) return titles[0] + " × " + titles[1];
    return titles.join(" · ");
  }

  function localFusedMood(meta) {
    return meta.moods.length ? meta.moods.join(" + ") : "";
  }

  function localMixedDescription(nums, meta, variant) {
    variant = (variant || 0) | 0;
    var frags = [];
    // Prefer per-slot bodies (may already contain hex colors user chose)
    var slotBodies = [];
    for (var s = 0; s < 3; s++) {
      if (spells[s]) slotBodies.push(getSpellSlotBody(s));
    }
    var sources = slotBodies.length >= 2 ? slotBodies : null;
    for (var i = 0; i < nums.length; i++) {
      var rot = (i + (variant % Math.max(1, nums.length))) % nums.length;
      var line = "";
      if (sources && sources[rot]) {
        var body = sources[rot];
        // First non-empty paragraph / sentence
        var para = body.split(/\n\n+/)[0] || body;
        line = para.split(/[.!?]/)[0].trim();
      }
      if (!line) {
        var a = getAnalysis(nums[rot]);
        if (!a) continue;
        if (a.description) line = a.description.split(/[.!?]/)[0].trim();
        else if (a.title) line = a.title;
      }
      if (line) frags.push(line);
    }
    if (frags.length < 2) {
      return frags[0] || "Add another spell to fuse descriptions.";
    }
    var mood = localFusedMood(meta);
    var tagSample = meta.tags.slice(0, 6).join(", ");
    var leads = [
      "One braided spell:",
      "A singular fused apparition:",
      "The merged stasis-field:",
      "Unified in one vision:",
    ];
    var joins = [" Meanwhile, ", " As ", " — yet ", "; together, "];
    var tails = [
      " pulse through a single shifting canvas",
      " coalesce into one luminous frame",
      " breathe as a shared spectral tableau",
      " hold in layered suspension",
    ];
    return (
      leads[variant % leads.length] +
      " " +
      frags.join(joins[variant % joins.length]) +
      ". The three visions overlap—shared " +
      (tagSample || "forms and hues") +
      tails[variant % tails.length] +
      (mood ? " in a " + mood + " atmosphere." : ".")
    );
  }

  function localRedefineDescription(nums, meta, current, variant) {
    variant = (variant || 0) | 0;
    var text = (current || "").trim();
    if (text) {
      var parts = text.split(/(?<=[.!?])\s+/).filter(function (p) {
        return p.trim();
      });
      if (parts.length >= 2) {
        var rot = variant % parts.length;
        var reordered = parts.slice(rot).concat(parts.slice(0, rot));
        var openers = [
          "As one fused spell, ",
          "In singular stasis, ",
          "The merged apparition ",
          "Unified yet restless, ",
          "Held in one braided frame, ",
        ];
        var body = reordered[0].replace(/^[^a-zA-Z]+/, "").trim();
        if (body) {
          body = body.charAt(0).toLowerCase() + body.slice(1);
          reordered[0] = openers[variant % openers.length] + body;
        }
        return reordered.join(" ");
      }
    }
    return localMixedDescription(nums, meta, variant + 1);
  }

  function localFusedPayload(nums, meta) {
    return {
      fused_title: localFusedTitle(nums),
      mixed_description: localMixedDescription(nums, meta),
      combined_styles: meta.styles,
      combined_tags: meta.tags,
      combined_mood: localFusedMood(meta),
    };
  }

  /**
   * xAI image API: hard max 8000 characters on the FINAL framed prompt.
   * Server wraps stasis with framing (~500–700 chars), so the body we send
   * must stay under PROMPT_BODY_MAX or jobs fail with "exceeds … 8000".
   */
  var PROMPT_MAX_CHARS = 8000;
  var PROMPT_BODY_MAX = 7200;

  function clipPromptText(s, maxLen) {
    s = String(s || "").trim();
    maxLen = maxLen != null ? maxLen : PROMPT_BODY_MAX;
    if (!s) return "";
    if (s.length <= maxLen) return s;
    var budget = Math.max(0, maxLen - 1);
    var cut = s.slice(0, budget);
    var nl = cut.lastIndexOf("\n");
    if (nl > budget * 0.55) cut = cut.slice(0, nl);
    else {
      var sp = cut.lastIndexOf(" ");
      if (sp > budget * 0.7) cut = cut.slice(0, sp);
    }
    return cut.replace(/\s+$/g, "") + "…";
  }

  function buildColorLocksSection(compact) {
    var colorLocks = getCanonicalColorLocks();
    if (!colorLocks.length) return "";
    var lines = [];
    if (compact) {
      lines.push(
        "MANDATORY PRODUCT PALETTE (override all source colors): " +
          colorLocks
            .map(function (lock) {
              return lock.label;
            })
            .join("; ") +
          ". Paint with these hex pigments as dominant hues."
      );
      return lines.join("\n");
    }
    lines.push(
      "MANDATORY BOLD COLOR LOCKS — these pigments WIN over any colors described in source spell texts:"
    );
    for (var ci = 0; ci < colorLocks.length; ci++) {
      var lock = colorLocks[ci];
      var where =
        lock.slots && lock.slots.length
          ? " spells " +
            lock.slots
              .map(function (si) {
                return ["I", "II", "III"][si] || String(si + 1);
              })
              .join("/")
          : "";
      var times =
        lock.count > 1
          ? " (appears " +
            lock.count +
            "× — ONE unified pigment" +
            where +
            ")"
          : where
            ? " (from" + where + ")"
            : "";
      lines.push(
        "  • " +
          lock.label +
          times +
          " — use this exact " +
          titleCaseColorName(lock.name) +
          " at " +
          lock.hex +
          " as a major visible pigment (saturated, not a shy tint; not replaced by the source painting’s old palette)."
      );
    }
    lines.push(
      "If a source description names a different color, REPAINT it into the locked pigments above. Product palette = locks only."
    );
    return lines.join("\n");
  }

  /**
   * The real generation prompt: Spell I–III bodies + merge rules, always ≤ 8000 chars.
   * Product goal = brand-new fused artwork (not a remake of equipped paintings).
   * Color locks + originality lead; source texts are motif DNA only.
   */
  function buildPhysicalGenerationPrompt(nums, meta) {
    nums = nums || getEquippedInOrder();
    meta = meta || collectCombinedMeta(nums);
    if (!nums.length) return "";

    var roman = ["I", "II", "III"];
    var spellParts = [];
    for (var s = 0; s < 3; s++) {
      if (!spells[s]) continue;
      var num = spells[s];
      var a = getAnalysis(num) || {};
      var title = a.title || "Painting #" + num;
      var body = stripAspectTalkFromPrompt(
        String(getSpellSlotBody(s) || "").trim()
      );
      if (!body) body = "(no description)";
      spellParts.push({
        header:
          "── INFLUENCE " + roman[s] + " (motif DNA only · ref #" + num + ") ──",
        body: body,
      });
    }
    if (!spellParts.length) return "";

    var artist =
      (window.GALLERY_AUTHOR && window.GALLERY_AUTHOR.author) || "Logan Sevin";
    var head =
      "SPELLFORGE PRODUCT — invent ONE brand-new fine-art painting for sale.\n" +
      "This is NOT a remake, restage, collage, or near-copy of any equipped painting. " +
      "Do not preserve any source composition, figure pose, camera angle, or layout.\n" +
      "Borrow only abstract motifs, mood, and texture ideas from the influence texts below, " +
      "then invent a fourth original scene that has never existed.\n" +
      "Studio author: " +
      artist +
      ".";
    var merge =
      "FUSION DIRECTIVE: Weave influence motifs into a NEW composition and new subjects. " +
      "One coherent painting — not three panels, not a grid, not a stacked photo-fusion of the source works.";
    // No aspect-ratio wording — frame comes only from aspect_ratio API field
    var output =
      "Output: one original finished artwork (product-ready). Fill the canvas fully; no letterboxing; no collage panels of source paintings.";

    var styles =
      meta.styles && meta.styles.length
        ? "Style DNA (interpret freely, invent the scene): " +
          meta.styles.slice(0, 8).join(", ") +
          "."
        : "";
    var moods =
      meta.moods && meta.moods.length
        ? "Mood DNA: " + meta.moods.slice(0, 6).join(" + ") + "."
        : "";
    var tagsList = (meta.tags || []).slice(0, 12);
    var tags = tagsList.length
      ? "Motif tags (not a checklist of the original paintings): " +
        tagsList.join(", ") +
        "."
      : "";
    var buzzList = filterBuzzNoAspect(getActiveBuzz().slice(0, 16));
    var buzz = buzzList.length
      ? "Buzz words: " + buzzList.join(", ") + "."
      : "";
    var extra = stripAspectTalkFromPrompt(String(spellPrompt || "").trim());
    if (extra) extra = "Extra direction: " + extra;
    var notes = stripAspectTalkFromPrompt(String(spellStasis || "").trim());
    if (
      notes &&
      (notes.indexOf("SOURCE SPELLS") >= 0 ||
        notes.indexOf("UNIFIED STASIS VISION") >= 0 ||
        notes.indexOf("SPELLFORGE PRODUCT") >= 0 ||
        notes.length <= 8)
    ) {
      notes = "";
    }
    if (notes) notes = "Artist synthesis notes: " + notes;

    function assemble(bodyBudget, compactColors, trimNotes, trimMeta) {
      var colorSec = buildColorLocksSection(compactColors);
      var bodies = spellParts.map(function (sp) {
        var b = sp.body;
        if (bodyBudget != null && b.length > bodyBudget) {
          b = clipPromptText(b, bodyBudget);
        }
        return sp.header + "\n" + b;
      });
      // Color locks first so they survive length pressure and beat source palette text
      var parts = [head, ""];
      if (colorSec) {
        parts.push(colorSec);
        parts.push("");
      }
      parts.push(
        "INFLUENCE TEXTS (motif / mood DNA only — invent new subjects & staging):"
      );
      parts.push(bodies.join("\n\n"));
      parts.push("");
      parts.push(merge);
      if (!trimMeta) {
        if (styles) parts.push(styles);
        if (moods) parts.push(moods);
        if (tags) parts.push(tags);
      } else {
        if (styles) parts.push(clipPromptText(styles, 180));
        if (moods) parts.push(clipPromptText(moods, 120));
      }
      if (buzz) parts.push(trimMeta ? clipPromptText(buzz, 200) : buzz);
      if (extra) {
        parts.push(
          trimNotes ? clipPromptText(extra, 280) : clipPromptText(extra, 600)
        );
      }
      if (notes) {
        parts.push("");
        parts.push(
          trimNotes ? clipPromptText(notes, 400) : clipPromptText(notes, 1200)
        );
      }
      parts.push("");
      parts.push(output);
      return parts.join("\n");
    }

    // Progressive fit into PROMPT_BODY_MAX (leaves room for server framing ≤8000)
    // Prefer keeping color locks + originality head over long source prose
    var attempts = [
      function () {
        return assemble(null, false, false, false);
      },
      function () {
        return assemble(null, true, false, false);
      },
      function () {
        return assemble(1400, false, true, true);
      },
      function () {
        return assemble(900, false, true, true);
      },
      function () {
        return assemble(600, true, true, true);
      },
      function () {
        return assemble(400, true, true, true);
      },
      function () {
        return assemble(280, true, true, true);
      },
    ];
    var best = "";
    for (var ai = 0; ai < attempts.length; ai++) {
      best = attempts[ai]();
      if (best.length <= PROMPT_BODY_MAX) return best;
    }
    return clipPromptText(best, PROMPT_BODY_MAX);
  }

  function getGenerationStasisPayload() {
    var nums = getEquippedInOrder();
    var meta = collectCombinedMeta(nums);
    return clipPromptText(
      stripAspectTalkFromPrompt(buildPhysicalGenerationPrompt(nums, meta)),
      PROMPT_BODY_MAX
    );
  }

  function updatePhysicalPromptCharCount(text) {
    var el = document.getElementById("spell-physical-chars");
    if (!el) return;
    var n = String(text || "").length;
    el.textContent =
      n +
      " / " +
      PROMPT_BODY_MAX +
      " body (API max " +
      PROMPT_MAX_CHARS +
      " with framing)";
    el.className =
      "spell-physical-chars" +
      (n > PROMPT_BODY_MAX
        ? " over"
        : n > PROMPT_BODY_MAX * 0.9
          ? " warn"
          : "");
  }

  function updatePhysicalPromptPreview() {
    var el = document.getElementById("spell-physical-prompt");
    var buzzEl = document.getElementById("spell-physical-buzz");
    var nums = getEquippedInOrder();
    if (!el) return;
    if (nums.length < 2) {
      el.value = "";
      el.placeholder = "Equip 2–3 spells to build the physical generation prompt…";
      if (buzzEl) buzzEl.textContent = "";
      updatePhysicalPromptCharCount("");
      return;
    }
    var physical = buildPhysicalGenerationPrompt(
      nums,
      collectCombinedMeta(nums)
    );
    el.value = physical;
    updatePhysicalPromptCharCount(physical);
    var buzz = getActiveBuzz();
    if (buzzEl) {
      buzzEl.innerHTML = buzz.length
        ? "<strong>Also sent as buzz_words (" +
          buzz.length +
          "):</strong> " +
          buzz
            .map(function (w) {
              return escapeHtml(w);
            })
            .join(", ")
        : "<strong>buzz_words:</strong> (none)";
    }
    lastFusedPrompt = physical;
  }

  function bindPhysicalPromptUi() {
    var copyBtn = document.getElementById("spell-physical-copy");
    var refreshBtn = document.getElementById("spell-physical-refresh");
    if (copyBtn && !copyBtn._bound) {
      copyBtn._bound = true;
      copyBtn.addEventListener("click", function () {
        var el = document.getElementById("spell-physical-prompt");
        var t = el ? el.value : getGenerationStasisPayload();
        if (!t) return;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(t).then(
            function () {
              copyBtn.textContent = "Copied";
              setTimeout(function () {
                copyBtn.textContent = "Copy";
              }, 1200);
            },
            function () {}
          );
        }
      });
    }
    if (refreshBtn && !refreshBtn._bound) {
      refreshBtn._bound = true;
      refreshBtn.addEventListener("click", function () {
        updatePhysicalPromptPreview();
      });
    }
  }

  function resolveStasisVisionUrl(url) {
    return assetUrl(url || "");
  }

  function openStasisVisionDialog() {
    if (!stasisVisionUrl) return;
    var dlg = document.getElementById("spell-stasis-vision-dialog");
    var dlgImg = document.getElementById("spell-stasis-vision-dialog-img");
    if (!dlg || !dlgImg) return;
    dlgImg.src = resolveStasisVisionUrl(stasisVisionUrl);
    if (window.galleryDialog && window.galleryDialog.open) {
      window.galleryDialog.open(dlg);
    } else if (typeof dlg.showModal === "function") {
      dlg.showModal();
    } else {
      dlg.setAttribute("open", "");
    }
  }

  function refreshSpellforgeInterfaceSkin() {
    if (!window.StasisInterfaceSkin) return;
    var img = document.getElementById("spell-stasis-vision-img");
    var visionImg = img && img.complete && img.naturalWidth ? img : null;
    window.StasisInterfaceSkin.apply({
      stasisText: spellStasis,
      buzz: getActiveBuzz(),
      extraPrompt: spellPrompt,
      visionImg: visionImg,
      activeTab: "spellforge",
    });
  }

  function updateStasisVisionView(url) {
    var hint = document.getElementById("spell-stasis-vision-hint");
    var loading = document.getElementById("spell-stasis-vision-loading");
    var fig = document.getElementById("spell-stasis-vision-figure");
    var img = document.getElementById("spell-stasis-vision-img");
    var open = document.getElementById("spell-stasis-vision-open");
    if (!url) {
      if (loading) loading.hidden = true;
      if (fig) fig.hidden = true;
      if (hint) hint.hidden = false;
      if (img) img.removeAttribute("src");
      if (open) {
        open.href = "#";
        open.setAttribute("aria-disabled", "true");
      }
      refreshSpellforgeInterfaceSkin();
      return;
    }
    var resolved = resolveStasisVisionUrl(url);
    if (loading) loading.hidden = true;
    if (hint) hint.hidden = true;
    if (fig) fig.hidden = false;
    if (img) {
      img.onload = function () {
        refreshSpellforgeInterfaceSkin();
      };
      img.src = resolved;
    }
    if (open) {
      open.href = resolved;
      open.removeAttribute("aria-disabled");
    }
    refreshSpellforgeInterfaceSkin();
  }

  function setStasisVisionLoading(on) {
    var hint = document.getElementById("spell-stasis-vision-hint");
    var loading = document.getElementById("spell-stasis-vision-loading");
    var fig = document.getElementById("spell-stasis-vision-figure");
    if (on) {
      if (hint) hint.hidden = true;
      if (loading) loading.hidden = false;
      if (fig) fig.hidden = true;
    } else if (!stasisVisionUrl) {
      if (loading) loading.hidden = true;
      if (hint) hint.hidden = false;
    } else {
      if (loading) loading.hidden = true;
    }
  }

  function prepareSpellforgeTabloidPrint() {
    if (!window.TabloidPrint || !stasisVisionUrl) return;
    var img = document.getElementById("spell-stasis-vision-img");
    if (!img || !img.src) return;
    var stasisEl = document.getElementById("spell-stasis");
    var nums = getEquippedInOrder();
    window.TabloidPrint.prepare({
      image: img,
      title: "Stasis vision",
      subtitle: nums.length ? "Spells " + nums.join(", ") : "",
      caption: stasisEl ? stasisEl.value : spellStasis,
      source: "Spellforge",
      filename: "spellforge-stasis-vision",
    });
  }

  function bindStasisVisionView() {
    var viewBtn = document.getElementById("spell-stasis-vision-view");
    var zoomBtn = document.getElementById("spell-stasis-vision-zoom");
    var printBtn = document.getElementById("spell-stasis-vision-print");
    var closeBtn = document.getElementById("spell-stasis-vision-dialog-close");
    var dlg = document.getElementById("spell-stasis-vision-dialog");

    if (viewBtn && !viewBtn.dataset.bound) {
      viewBtn.dataset.bound = "1";
      viewBtn.addEventListener("click", openStasisVisionDialog);
    }
    if (zoomBtn && !zoomBtn.dataset.bound) {
      zoomBtn.dataset.bound = "1";
      zoomBtn.addEventListener("click", openStasisVisionDialog);
    }
    if (printBtn && !printBtn.dataset.bound) {
      printBtn.dataset.bound = "1";
      printBtn.addEventListener("click", prepareSpellforgeTabloidPrint);
    }
    if (closeBtn && dlg && !closeBtn.dataset.bound) {
      closeBtn.dataset.bound = "1";
      closeBtn.addEventListener("click", function () {
        if (window.galleryDialog && window.galleryDialog.close) {
          window.galleryDialog.close(dlg);
        } else if (typeof dlg.close === "function") {
          dlg.close();
        } else {
          dlg.removeAttribute("open");
        }
      });
    }
  }

  function updateServerHint() {
    var banner = document.getElementById("spellforge-server-hint");
    if (!banner) return;
    var onFile = location.protocol === "file:";
    if (onFile) {
      banner.hidden = false;
      banner.innerHTML =
        "Open via the local server — run <code>start_server.bat</code>, then " +
        '<a href="http://localhost:8765/#spellforge">http://localhost:8765/#spellforge</a> ' +
        "(file:// tabs cannot call Spellforge APIs).";
      return;
    }
    if (!serverOnline) {
      banner.hidden = false;
      if (isNetlifySite()) {
        banner.innerHTML =
          "<strong>Generate is not installed yet.</strong> Drag-and-drop cannot add the AI server. " +
          "Run <code>deploy_netlify_full.bat</code> on your PC (or connect GitHub on Netlify). " +
          "See <code>NETLIFY_FIX.md</code>. Then add <code>XAI_API_KEY</code> in Netlify environment variables.";
      } else if (isLocalHost()) {
        banner.innerHTML =
          "Run <code>start_server.bat</code> from the gallery folder, then open " +
          '<a href="http://localhost:8765/#spellforge">http://localhost:8765/#spellforge</a>.';
      } else if (!hasRemoteApi()) {
        banner.innerHTML =
          "Browse and timelapse work here. Connect the cloud API (see <code>SHARE_ONLINE.md</code>).";
      } else {
        banner.innerHTML =
          "AI server is starting or unreachable — wait a minute and refresh. " +
          "(Render free tier sleeps when idle.)";
      }
      return;
    }
    if (!apiReady && !useLocalGenerate()) {
      banner.hidden = false;
      banner.className = "spellforge-banner";
      if (isLocalHost()) {
        banner.innerHTML =
          "Gallery server is <strong>outdated</strong> — press Ctrl+C in the old server window, run " +
          "<code>start_server.bat</code> again, then hard-refresh (Ctrl+Shift+R).";
      } else if (isNetlifySite()) {
        banner.innerHTML =
          "<strong>AI key not set.</strong> Generate still uses the cloud path and will error until you add " +
          "<code>XAI_API_KEY</code> on Netlify (see <code>NETLIFY_API_KEY.md</code>). " +
          "Free local fuse is opt-in only (<code>SPELLFORGE_LOCAL_GENERATE</code>).";
      } else if (isRenderSite()) {
        banner.innerHTML =
          "<strong>AI key not set on Render.</strong> In the Render dashboard open this Web Service → " +
          "Environment → add <code>XAI_API_KEY</code> (value from " +
          '<a href="https://console.x.ai/team/default/api-keys" target="_blank" rel="noopener">console.x.ai</a>' +
          ") → Save Changes → wait for redeploy. Then hard-refresh this page. " +
          "Check <code>/api/health</code> shows <code>api_configured: true</code>.";
      } else {
        banner.innerHTML =
          "AI server not ready — add an API key or run <code>start_server.bat</code>. " +
          "Generate does not switch to free fuse automatically.";
      }
      return;
    }
    if (!isLocalHost()) {
      banner.hidden = false;
      banner.className = "spellforge-banner spellforge-banner-invite";
      var mode = useLocalGenerate()
        ? "<strong>Local fuse</strong> — free canvas stack (SPELLFORGE_LOCAL_GENERATE). "
        : "<strong>Live Spellforge</strong> — Generate uses xAI for a new stasis vision from your fusion. ";
      banner.innerHTML =
        mode +
        "Pick spells, toggle buzz words, generate a stasis vision, watch the timelapse. " +
        'Use <strong>Share spell link</strong> to invite friends.';
      return;
    }
    banner.hidden = true;
    banner.className = "spellforge-banner";
  }

  function allBuzzWords(meta) {
    var list = (meta.tags || []).slice();
    var styles = meta.styles || [];
    for (var i = 0; i < styles.length; i++) list.push(styles[i]);
    return uniqueStrings(list);
  }

  function getActiveBuzz() {
    var extra = String(spellPrompt || "")
      .split(/[,;\s]+/)
      .map(function (s) {
        return s.trim();
      })
      .filter(function (s) {
        return s.length > 2;
      });
    var hexBuzz = getPaletteHexList();
    return uniqueStrings(activeBuzzWords.concat(extra).concat(hexBuzz));
  }

  function onBuzzChanged() {
    var nums = getEquippedInOrder();
    var meta = collectCombinedMeta(nums);
    var physical = buildPhysicalGenerationPrompt(nums, meta);
    if (window.SpellTimelapse) {
      window.SpellTimelapse.setBuzz(getActiveBuzz());
      window.SpellTimelapse.setLivePrompt(spellPrompt);
      window.SpellTimelapse.configure({
        stasisText: physical || spellStasis,
        livePrompt: spellPrompt,
        nums: nums,
      });
    }
    syncSpellLoop(nums, null, meta);
    updatePhysicalPromptPreview();
    if (window.SpellTimelapse && window.SpellTimelapse.scheduleVideoBuild) {
      window.SpellTimelapse.scheduleVideoBuild();
    }
  }

  function renderBuzzToggles(meta, resetActive) {
    var el = document.getElementById("spell-buzz-toggles");
    if (!el) return;
    var words = allBuzzWords(meta);
    if (resetActive || !activeBuzzWords.length) activeBuzzWords = words.slice();
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
        var on = activeBuzzWords.indexOf(word) >= 0;
        if (on) {
          btn.classList.add("active");
          btn.classList.add("is-on");
        }
        btn.setAttribute("aria-pressed", on ? "true" : "false");
        btn.title = on
          ? "On — click to remove from buzz_words"
          : "Off — click to include in buzz_words";
        btn.textContent = word;
        btn.addEventListener("click", function () {
          var idx = activeBuzzWords.indexOf(word);
          var nowOn;
          if (idx >= 0) {
            activeBuzzWords.splice(idx, 1);
            nowOn = false;
          } else {
            activeBuzzWords.push(word);
            nowOn = true;
          }
          btn.classList.toggle("active", nowOn);
          btn.classList.toggle("is-on", nowOn);
          btn.setAttribute("aria-pressed", nowOn ? "true" : "false");
          btn.title = nowOn
            ? "On — click to remove from buzz_words"
            : "Off — click to include in buzz_words";
          onBuzzChanged();
        });
        el.appendChild(btn);
      })(words[i]);
    }
  }

  function syncSpellLoop(nums, fused, meta) {
    if (!window.SpellLoop) return;
    var payload = fused;
    if (!payload && nums.length >= 2) payload = localFusedPayload(nums, meta);
    var urls = stasisVisionUrl ? [stasisVisionUrl] : [];
    window.SpellLoop.setState(nums, payload, meta, spellStasis, spellPrompt, urls);
    if (window.SpellTimelapse) {
      window.SpellTimelapse.setBuzz(getActiveBuzz());
      window.SpellTimelapse.setLivePrompt(spellPrompt);
      window.SpellTimelapse.configure({
        stasisText: spellStasis,
        livePrompt: spellPrompt,
        nums: nums,
      });
      if (stasisVisionUrl) {
        window.SpellTimelapse.setStasisVision(stasisVisionUrl, spellStasis);
      } else if (window.SpellTimelapse.scheduleVideoBuild) {
        window.SpellTimelapse.scheduleVideoBuild();
      }
    }
  }

  function applyFusedUi(fused, meta, nums) {
    var hint = document.getElementById("spell-fusion-hint");
    var metaPanel = document.getElementById("spell-fusion-meta");
    var titleEl = document.getElementById("spell-fused-title");
    var moodEl = document.getElementById("spell-fused-mood");
    var stasisEl = document.getElementById("spell-stasis");
    var stylesEl = document.getElementById("spell-combined-styles");
    if (hint) hint.hidden = nums.length >= 2;
    if (metaPanel) metaPanel.hidden = nums.length < 2;

    var styles = (fused && fused.combined_styles) || meta.styles;
    var tags = (fused && fused.combined_tags) || meta.tags;
    meta.tags = tags;
    meta.styles = styles;
    if (stylesEl) renderChipList(stylesEl, styles);
    renderBuzzToggles(meta, applyFusedUi._lastSlots !== nums.join(","));

    if (titleEl) {
      titleEl.textContent =
        (fused && fused.fused_title) ||
        "Fused spell · #" + nums.join(", #");
    }
    if (moodEl) {
      var mood = (fused && fused.combined_mood) || meta.moods.join(" · ");
      moodEl.textContent = mood ? "Mood: " + mood : "";
      moodEl.hidden = !mood;
    }
    var mixed =
      (fused && fused.mixed_description) ||
      (nums.length >= 2 ? localMixedDescription(nums, meta) : "");
    var slotKey = nums.join(",");
    var slotsChanged = applyFusedUi._lastSlots !== slotKey;
    if (slotsChanged) {
      stasisVisionUrl = "";
      applyFusedUi._lastVisionSlots = "";
      activeBuzzWords = [];
      // Clear body overrides only for slots that changed painting
      stasisUserDirty = false;
      applyFusedUi._lastSlots = slotKey;
      updateStasisVisionView("");
    }
    if (getPaletteHexList().length) {
      meta.colors = getPaletteHexList();
    }
    if (nums.length >= 2) {
      // Keep user edits / omits unless slots changed or stasis empty
      if (slotsChanged || !stasisUserDirty || !String(spellStasis || "").trim()) {
        spellStasis = mixed;
        stasisUserDirty = false;
      }
    } else {
      spellStasis = "";
      spellPrompt = "";
      stasisUserDirty = false;
      var promptEl = document.getElementById("spell-prompt");
      if (promptEl) promptEl.value = "";
      stasisVisionUrl = "";
      activeBuzzWords = [];
      applyFusedUi._lastSlots = "";
      updateStasisVisionView("");
    }
    var genBtn = document.getElementById("spell-generate-stasis");
    if (genBtn) genBtn.disabled = nums.length < 2;
    if (stasisEl && stasisEl.value !== spellStasis) stasisEl.value = spellStasis;
    updateStasisModeration();

    lastFusedPrompt = getGenerationStasisPayload() || (spellStasis + " " + spellPrompt).trim();
    updateStasisVisionView(stasisVisionUrl);
    syncSpellLoop(nums, fused, meta);
    updateRedefineButton();
    bindPhysicalPromptUi();
    updatePhysicalPromptPreview();
    publishFusion();
    refreshSpellforgeInterfaceSkin();
    if (nums.length >= 2) scheduleAutoVision(nums);
  }

  function applyRedefinedStasis(result, nums) {
    var mixed = (result && result.mixed_description) || "";
    if (!mixed.trim()) return;

    setStasisText(mixed.trim(), { clearDirty: true });

    var titleEl = document.getElementById("spell-fused-title");
    if (titleEl && result && result.fused_title) {
      titleEl.textContent = result.fused_title;
    }

    applyFusedUi._lastVisionSlots = "";
    var meta = collectCombinedMeta(nums);
    syncSpellLoop(nums, null, meta);
    refreshSpellforgeInterfaceSkin();
    scheduleAutoVision(nums);
  }

  function setRedefineStatus(msg, isError) {
    var el = document.getElementById("spell-redefine-status");
    if (!el) return;
    if (!msg) {
      el.hidden = true;
      el.textContent = "";
      el.className = "spell-redefine-status";
      return;
    }
    el.hidden = false;
    el.className = isError
      ? "spell-redefine-status error"
      : "spell-redefine-status";
    el.textContent = msg;
  }

  function fetchAiRedefine(nums, currentStasis, variant) {
    var token = ++redefineRequestId;
    // Status only — never overwrite the stasis textarea mid-request (caused double text)

    return fetch(apiUrl("/api/redefine-stasis"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        spells: nums,
        stasis: currentStasis,
        variant: variant,
      }),
    })
      .then(function (r) {
        return parseApiResponse(r).then(function (data) {
          return { ok: r.ok, data: data };
        });
      })
      .then(function (res) {
        if (token !== redefineRequestId) return null;
        if (!res.ok) throw new Error((res.data && res.data.error) || "Redefine failed");
        return res.data;
      });
  }

  function redefineStasis() {
    var nums = getEquippedInOrder();
    var btn = document.getElementById("spell-redefine-stasis");
    var stasisElLive = document.getElementById("spell-stasis");
    if (stasisElLive) spellStasis = stasisElLive.value;
    if (nums.length < 2 || !spellStasis.trim()) return;

    redefineCount += 1;
    var variant = redefineCount;
    var prior = spellStasis;
    if (btn) {
      btn.dataset.busy = "1";
      btn.disabled = true;
      btn.textContent = "Redefining…";
    }
    setRedefineStatus(
      serverOnline && apiReady
        ? "Rewording as one singular spell…"
        : "Restructuring locally…",
      false
    );

    var work =
      serverOnline && apiReady
        ? fetchAiRedefine(nums, prior, variant)
        : Promise.resolve({
            mixed_description: localRedefineDescription(
              nums,
              collectCombinedMeta(nums),
              prior,
              variant
            ),
          });

    work
      .then(function (result) {
        if (!result) return;
        applyRedefinedStasis(result, nums);
        setRedefineStatus("Stasis redefined — generate again to refresh the vision.", false);
      })
      .catch(function (err) {
        if (isCreditsError(err && err.message)) {
          applyRedefinedStasis(
            {
              mixed_description: localRedefineDescription(
                nums,
                collectCombinedMeta(nums),
                prior,
                variant
              ),
            },
            nums
          );
          setRedefineStatus("No API credits — restructured locally instead.", false);
          return;
        }
        setStasisText(prior, { userEdit: true });
        setRedefineStatus(
          (err && err.message) || "Redefine failed — kept your previous stasis.",
          true
        );
      })
      .finally(function () {
        if (btn) {
          btn.dataset.busy = "";
          btn.textContent = "Redefine";
          updateRedefineButton();
        }
      });
  }

  function fetchAiBlend(nums) {
    var token = ++blendRequestId;
    // Do not touch #spell-stasis while blending — local fusion is already shown

    return fetch(apiUrl("/api/blend-spells"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spells: nums }),
    })
      .then(function (r) {
        return parseApiResponse(r).then(function (data) {
          return { ok: r.ok, data: data };
        });
      })
      .then(function (res) {
        if (token !== blendRequestId) return null;
        if (!res.ok) throw new Error((res.data && res.data.error) || "Blend failed");
        return res.data;
      });
  }

  function updateFusion() {
    var nums = getEquippedInOrder();
    var meta = collectCombinedMeta(nums);

    if (nums.length < 2) {
      applyFusedUi(nums.length ? localFusedPayload(nums, meta) : null, meta, nums);
      return;
    }

    var local = localFusedPayload(nums, meta);
    applyFusedUi(local, meta, nums);

    if (!serverOnline || useFreeSpellforge()) return;

    fetchAiBlend(nums)
      .then(function (fused) {
        if (!fused) return;
        // Don't clobber manual edits / omits with remote blend text
        if (stasisUserDirty) {
          var metaOnly = collectCombinedMeta(nums);
          if (fused.combined_styles) metaOnly.styles = fused.combined_styles;
          if (fused.combined_tags) metaOnly.tags = fused.combined_tags;
          if (fused.combined_mood) metaOnly.moods = [fused.combined_mood];
          applyFusedUi(
            {
              fused_title: fused.fused_title,
              mixed_description: spellStasis,
              combined_styles: metaOnly.styles,
              combined_tags: metaOnly.tags,
              combined_mood: fused.combined_mood || "",
            },
            metaOnly,
            nums
          );
          return;
        }
        var meta2 = collectCombinedMeta(nums);
        if (fused.combined_styles) meta2.styles = fused.combined_styles;
        if (fused.combined_tags) meta2.tags = fused.combined_tags;
        applyFusedUi(fused, meta2, nums);
      })
      .catch(function () {
        // Keep local fusion — silent fallback (avoids "Failed to fetch" UI thrash)
        applyFusedUi(local, meta, nums);
      });
  }

  function checkServer() {
    if (location.protocol === "file:") {
      serverOnline = false;
      apiReady = false;
      updateServerHint();
      updateGenerateButton();
      return Promise.resolve(hasLocalCompose());
    }
    return fetch(apiUrl("/api/health"), { method: "GET" })
      .then(function (r) {
        if (!r.ok) throw new Error("offline");
        return parseApiResponse(r);
      })
      .then(function (data) {
        lastHealth = data || null;
        var modern =
          data &&
          (data.stasis_vision === true ||
            (data.api_version || 0) >= 3 ||
            data.image_provider === "xai" ||
            data.xai_configured === true);
        serverOnline = !!(data && data.ok && modern);
        if (isNetlifySite() && data && data.ok && !modern) {
          serverOnline = false;
        }
        // Prefer explicit configured flags; do not treat "unknown" as free-fuse.
        var configured =
          data &&
          (data.api_configured === true ||
            data.xai_configured === true ||
            data.wombo_configured === true ||
            data.image_provider === "xai" ||
            data.image_provider === "wombo");
        if (data && data.api_configured === false && !configured) {
          apiReady = false;
        } else {
          apiReady = !!(serverOnline && (configured || data.api_configured !== false));
        }
        updateServerHint();
        updateGenerateButton();
        return serverOnline || forceLocalOnly();
      })
      .catch(function () {
        lastHealth = null;
        // On same-origin local gallery, keep trying cloud — do not flip to free fuse.
        serverOnline = false;
        apiReady = false;
        updateServerHint();
        updateGenerateButton();
        return forceLocalOnly();
      });
  }

  function pollImageJob(jobId, statusEl, attemptsLeft) {
    if (attemptsLeft == null) attemptsLeft = 90;
    return new Promise(function (resolve, reject) {
      if (attemptsLeft <= 0) {
        reject(
          new Error(
            isLocalHost()
              ? "Timed out waiting for xAI (3+ min). Check start_server.bat is running and try again."
              : "Timed out waiting for xAI from your phone. Keep the PC awake with start_server.bat open, Tailscale connected, then try Generate again."
          )
        );
        return;
      }
      fetch(apiUrl("/api/jobs/" + encodeURIComponent(jobId)), {
        cache: "no-store",
      })
        .then(function (r) {
          if (!r.ok) {
            throw new Error("Job status HTTP " + r.status);
          }
          return r.json();
        })
        .then(function (job) {
          if (!job || typeof job !== "object") {
            throw new Error("Invalid job status response.");
          }
          var st = String(job.status || "working");
          if (statusEl) {
            statusEl.hidden = false;
            statusEl.className = "spell-generate-status";
            statusEl.textContent =
              st === "queued" || st === "pending"
                ? "xAI generating… (" + st + ")"
                : "Generating… (" + st + ")";
          }
          if (st === "done") {
            if (job.images && job.images.length) {
              resolve(job.images);
              return;
            }
            if (job.image && job.image.url) {
              resolve([job.image]);
              return;
            }
            reject(new Error("Job done but no image URL returned."));
            return;
          }
          if (st === "failed" || st === "error") {
            var err = job.error;
            var msg =
              (err && err.message) ||
              (typeof err === "string" ? err : "") ||
              "Generate failed";
            if (/8000|maximum allowed length|prompt length/i.test(msg)) {
              msg =
                "Prompt too long for xAI (max 8000). Rebuild/shorten the physical prompt and try again.";
            }
            reject(new Error(msg));
            return;
          }
          setTimeout(function () {
            pollImageJob(jobId, statusEl, attemptsLeft - 1)
              .then(resolve)
              .catch(reject);
          }, 2000);
        })
        .catch(function (err) {
          // Transient poll glitch — retry a few times instead of hard-failing
          if (attemptsLeft > 3) {
            setTimeout(function () {
              pollImageJob(jobId, statusEl, attemptsLeft - 1)
                .then(resolve)
                .catch(reject);
            }, 2000);
            return;
          }
          reject(err);
        });
    });
  }

  /**
   * Hand finished stills to Studio 3D printers.
   * Prefer same-origin absolute URLs; for remote CDNs, try proxy or data URL so
   * the parent page never hits a bare CORS "Failed to fetch".
   */
  function notifyStudioPrinters(url, nums) {
    var resolved = resolveStasisVisionUrl(url) || "";
    if (!resolved) return;

    function send(imageUrl) {
      if (!imageUrl) return;
      try {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage(
            {
              type: "spellforge-job-done",
              imageUrl: imageUrl,
              stasis: String(spellStasis || "").slice(0, 400),
              spells: (nums || []).slice(),
              source: "spellforge",
            },
            "*"
          );
        }
        window.dispatchEvent(
          new CustomEvent("spellforge-job-done", {
            detail: { imageUrl: imageUrl, spells: (nums || []).slice() },
          })
        );
      } catch (e) {}
    }

    // Rebase localhost absolute → current origin (phone/Tailscale)
    try {
      var u = new URL(resolved, location.href);
      var host = (u.hostname || "").toLowerCase();
      if (
        host === "localhost" ||
        host === "127.0.0.1" ||
        host === "0.0.0.0" ||
        host === "[::1]"
      ) {
        resolved = location.origin + u.pathname + u.search + u.hash;
      } else {
        resolved = u.href;
      }
    } catch (e0) {}

    // data: / blob: / same-origin path — send immediately
    if (
      resolved.indexOf("data:") === 0 ||
      resolved.indexOf("blob:") === 0 ||
      resolved.indexOf(location.origin) === 0 ||
      resolved.charAt(0) === "/"
    ) {
      send(resolved);
      return;
    }

    // Remote CDN: try fetch via same-origin proxy, then data URL, else raw URL
    var proxyPath = apiUrl("/api/proxy-media?url=" + encodeURIComponent(resolved));
    var proxyAbs =
      proxyPath.indexOf("http") === 0
        ? proxyPath
        : new URL(proxyPath, location.href).href;
    fetch(proxyAbs, { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("proxy");
        return r.blob();
      })
      .then(function (blob) {
        if (blob.size > 6 * 1024 * 1024) {
          // Too large for data URL postMessage — send proxy URL instead
          send(proxyAbs);
          return "sent";
        }
        return new Promise(function (resolve) {
          var reader = new FileReader();
          reader.onload = function () {
            resolve(reader.result);
          };
          reader.onerror = function () {
            resolve(null);
          };
          reader.readAsDataURL(blob);
        });
      })
      .then(function (dataUrl) {
        if (dataUrl === "sent") return;
        if (dataUrl) send(dataUrl);
        else send(proxyAbs);
      })
      .catch(function () {
        send(resolved);
      });
  }

  function applyGeneratedVision(url, nums, statusEl) {
    stasisVisionUrl = url;
    applyFusedUi._lastVisionSlots = nums.join(",");
    updateStasisVisionView(url);
    if (statusEl) statusEl.hidden = true;
    var meta = collectCombinedMeta(nums);
    if (window.SpellLoop && window.SpellLoop.restartRun) {
      window.SpellLoop.restartRun();
    }
    syncSpellLoop(nums, null, meta);
    publishFusion();
    refreshSpellforgeInterfaceSkin();
    // Notify Studio 3D printers (parent window when embedded as Spellforge Plane)
    try {
      notifyStudioPrinters(url, nums);
    } catch (ePost) {}
    var timelapse = window.SpellTimelapse
      ? window.SpellTimelapse.setStasisVision(url, spellStasis)
      : Promise.resolve();
    return timelapse.then(function () {
      refreshSpellforgeInterfaceSkin();
    });
  }

  function generateStasisVisionLocal(nums, statusEl) {
    var aspect = getAspectRatio();
    var paletteHex = getPaletteHexList();
    if (statusEl) {
      statusEl.hidden = false;
      statusEl.className = "spell-generate-status";
      statusEl.textContent =
        "Local fuse at " + aspect + " with locked palette (no API credits)…";
    }
    var stasisSend = stripAspectTalkFromPrompt(getGenerationStasisPayload());
    updatePhysicalPromptPreview();
    return window
      .composeStasisVisionLocal({
        spells: nums,
        stasis: stasisSend,
        buzz_words: filterBuzzNoAspect(getActiveBuzz()),
        aspect_ratio: aspect,
        palette_hex: paletteHex,
      })
      .then(function (dataUrl) {
        applyAspectPreview(aspect);
        return applyGeneratedVision(dataUrl, nums, statusEl);
      });
  }

  function generateStasisVisionCloud(nums, statusEl, btn) {
    var jobId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : "job-" + Date.now();

    var paletteHex = getPaletteHexList();
    var colorLocks = getCanonicalColorLocks();
    var aspect = getAspectRatio();
    applyAspectPreview(aspect);
    // Physical prompt includes bold color locks + originality directive.
    // Aspect ratio is API-only; mag_fresh invents a new product (not image-to-image of your pieces).
    var stasisSend = stripAspectTalkFromPrompt(getGenerationStasisPayload());
    if (!String(stasisSend || "").trim()) {
      return Promise.reject(
        new Error("Physical prompt is empty — equip 2–3 spells and rebuild.")
      );
    }
    if (stasisSend.length > PROMPT_BODY_MAX) {
      stasisSend = clipPromptText(stasisSend, PROMPT_BODY_MAX);
    }
    lastFusedPrompt = stasisSend;
    updatePhysicalPromptPreview();

    // Text DNA only — no painting URLs as visual references (those pull the model toward remakes)
    var spellPayloads = [];
    for (var s = 0; s < 3; s++) {
      if (!spells[s]) continue;
      var n = spells[s];
      var a = getAnalysis(n) || {};
      var desc = stripAspectTalkFromPrompt(
        String(getSpellSlotBody(s) || a.description || a.prompt || "").trim()
      );
      if (desc.length > 1800) desc = clipPromptText(desc, 1800);
      spellPayloads.push({
        number: n,
        // omit url on purpose — product is text-fused original, not img2img of sources
        title: a.title || "",
        description: desc,
        prompt: clipPromptText(
          stripAspectTalkFromPrompt(a.prompt || a.description || ""),
          800
        ),
        style: a.style || "",
        mood: a.mood || "",
        tags: (a.tags || []).slice(0, 8),
        colors: paletteHex.length
          ? paletteHex
          : (a.colors || []).slice(0, 6),
        source: "influence-text",
        slot: s,
      });
    }

    var buzz = filterBuzzNoAspect(getActiveBuzz().slice(0, 12));
    // Reinforce product goals without aspect-ratio words
    ["original painting", "brand new composition", "invented scene"].forEach(
      function (w) {
        if (buzz.indexOf(w) < 0) buzz.push(w);
      }
    );
    colorLocks.slice(0, 6).forEach(function (lock) {
      var token = String(lock.name || "").replace(/\s+/g, " ").trim();
      if (token && buzz.indexOf(token) < 0) buzz.push(token);
    });

    if (statusEl) {
      statusEl.hidden = false;
      statusEl.className = "spell-generate-status";
      statusEl.textContent =
        "New product still · frame " +
        aspect +
        " · " +
        (paletteHex.length ? paletteHex.length + " locked colors · " : "") +
        stasisSend.length +
        " char body";
    }

    // Phone + Tailscale can be slow; 45s was aborting valid queues mid-handshake.
    var acceptMs = isLocalHost() ? 90000 : 180000;
    var controller =
      typeof AbortController !== "undefined" ? new AbortController() : null;
    var abortTimer = null;
    var acceptTick = null;
    var acceptStarted = Date.now();
    if (controller) {
      abortTimer = setTimeout(function () {
        try {
          controller.abort();
        } catch (e) {}
      }, acceptMs);
    }
    if (statusEl) {
      acceptTick = setInterval(function () {
        if (!statusEl || generatingVision === false) return;
        var sec = Math.round((Date.now() - acceptStarted) / 1000);
        statusEl.textContent =
          "Contacting your PC server… " + sec + "s (keep Tailscale on, PC awake)";
      }, 2000);
    }

    return fetch(apiUrl("/api/generate-stasis-vision"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        job_id: jobId,
        stasis: stasisSend,
        prompt: stasisSend,
        buzz_words: buzz.slice(0, 16),
        // Painting-range IDs only — arsenal 100000+ / 300000+ must not become source stills
        spells: nums.filter(function (id) {
          return id >= 1 && id <= 1000;
        }),
        spell_details: spellPayloads,
        fused_prompt: stasisSend,
        palette_hex: paletteHex,
        aspect_ratio: aspect,
        // Fresh original product — do not attach source painting images
        mag_fresh: true,
        fresh_variation: true,
        spell_cast: false,
        attach_references: false,
        reference_image: "",
        spell_reference_image: "",
        source: "spellforge",
        product_mode: "original_fusion",
      }),
      signal: controller ? controller.signal : undefined,
      cache: "no-store",
    })
      .then(function (r) {
        if (abortTimer) clearTimeout(abortTimer);
        if (acceptTick) clearInterval(acceptTick);
        if (r.status === 202) {
          return parseApiResponse(r).then(function (d) {
            var id = (d && d.job_id) || jobId;
            if (statusEl) {
              statusEl.textContent = "Queued on PC — waiting for xAI…";
            }
            // More poll attempts for phone (slow DERP path)
            return pollImageJob(id, statusEl, isLocalHost() ? 100 : 150);
          });
        }
        return parseApiResponse(r).then(function (d) {
          if (!r.ok) {
            var errMsg =
              (d && d.error && d.error.message) ||
              (d && d.error) ||
              "Generate failed (HTTP " + r.status + ")";
            throw new Error(
              typeof errMsg === "string" ? errMsg : JSON.stringify(errMsg)
            );
          }
          // Sync completion
          if (d && (d.status === "queued" || d.status === "pending") && d.job_id) {
            if (statusEl) statusEl.textContent = "Queued on PC — waiting for xAI…";
            return pollImageJob(d.job_id, statusEl, isLocalHost() ? 100 : 150);
          }
          var img = d.image || (d.images && d.images[0]);
          if (img && img.url) return [{ url: img.url }];
          if (d && d.job_id) {
            if (statusEl) statusEl.textContent = "Queued on PC — waiting for xAI…";
            return pollImageJob(d.job_id, statusEl, isLocalHost() ? 100 : 150);
          }
          throw new Error("No image returned");
        });
      })
      .then(function (images) {
        var img = images && images[0];
        if (img && img.url) return img.url;
        throw new Error("No image returned");
      })
      .then(function (url) {
        return applyGeneratedVision(url, nums, statusEl);
      })
      .catch(function (err) {
        if (abortTimer) clearTimeout(abortTimer);
        if (acceptTick) clearInterval(acceptTick);
        var msg = (err && err.message) || String(err || "");
        if (err && err.name === "AbortError") {
          msg = isLocalHost()
            ? "PC server did not accept the job in time. Close extra server windows, run start_server.bat once, hard-refresh, try again."
            : "Phone could not reach your PC in time. Check: (1) Tailscale Connected on phone + PC, (2) start_server.bat still open, (3) PC not asleep, (4) open http://desktop-khpuv0r.tail51fce6.ts.net:8765/api/health — should say ok. Then hard-refresh Spellforge and try Generate again.";
        }
        if (/failed to fetch|networkerror|load failed/i.test(msg)) {
          msg = isLocalHost()
            ? msg
            : "Lost connection to your PC (Tailscale or server). Reconnect Tailscale, confirm start_server.bat is running, hard-refresh, try again.";
        }
        if (isCreditsError(msg) && allowLocalCreditsFallback() && !skipLocalFuse) {
          if (statusEl) {
            statusEl.hidden = false;
            statusEl.className = "spell-generate-status";
            statusEl.textContent =
              "No API credits — fusing paintings locally (opt-in fallback)…";
          }
          return generateStasisVisionLocal(nums, statusEl);
        }
        throw new Error(msg);
      });
  }

  function generateStasisVision(opts) {
    opts = opts || {};
    var forceCloud = !!opts.forceCloud;
    skipLocalFuse = forceCloud;
    if (opts.extraPrompt != null) {
      spellPrompt = String(opts.extraPrompt || "").trim();
      var extraEl = document.getElementById("spell-prompt");
      if (extraEl) extraEl.value = spellPrompt;
    }
    var nums = getEquippedInOrder();
    var stasisElLive = document.getElementById("spell-stasis");
    if (stasisElLive) {
      spellStasis = stasisElLive.value;
    }
    // Always rebuild from current slot bodies (bold color rewrites) + aspect preview
    applyAspectPreview(getAspectRatio());
    updatePhysicalPromptPreview();
    var physical = getGenerationStasisPayload();
    lastFusedPrompt = physical || (spellStasis + " " + spellPrompt).trim();
    var btn = document.getElementById("spell-generate-stasis");
    var statusEl = document.getElementById("spell-generate-status");
    if (forceCloud && nums.filter(slotHasPromptText).length < 2) {
      return Promise.reject(
        new Error(
          "Need descriptions for at least 2 equipped spells before generating."
        )
      );
    }
    // Notes optional — physical Spell I–III merge prompt is enough for xAI.
    if (nums.length < 2 || (!String(physical || "").trim() && !spellStasis.trim())) {
      var emptyMsg =
        nums.length < 2
          ? "Equip at least 2 spells, then generate."
          : "Spell descriptions are still loading — wait a moment, then generate again.";
      if (forceCloud) return Promise.reject(new Error(emptyMsg));
      return Promise.resolve();
    }

    if (!canGenerateVision() || (forceCloud && location.protocol === "file:")) {
      var blocked = hostedMsg(
        "Cannot generate — run start_server.bat and open http://localhost:8765/#spellforge (not file://).",
        "Cannot reach the PC gallery server. On phone: Tailscale ON, open the MagicDNS link (not Netlify/Render unless that has a key). On PC: start_server.bat must stay open."
      );
      if (statusEl) {
        statusEl.hidden = false;
        statusEl.className = "spell-generate-status error";
        statusEl.textContent = blocked;
      }
      if (forceCloud) return Promise.reject(new Error(blocked));
      return Promise.resolve();
    }

    generatingVision = true;
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Generating…";
    }
    setStasisVisionLoading(true);

    var localOk = !forceCloud && useLocalGenerate();
    if (statusEl && !localOk) {
      statusEl.hidden = false;
      statusEl.className = "spell-generate-status";
      statusEl.textContent = "Calling xAI for stasis vision…";
    }

    var work = localOk
      ? generateStasisVisionLocal(nums, statusEl)
      : generateStasisVisionCloud(nums, statusEl, btn);

    var failed = null;
    return work
      .catch(function (err) {
        if (
          !forceCloud &&
          isCreditsError(err && err.message) &&
          allowLocalCreditsFallback()
        ) {
          if (statusEl) {
            statusEl.hidden = false;
            statusEl.className = "spell-generate-status";
            statusEl.textContent =
              "No API credits — fusing paintings locally (opt-in fallback)…";
          }
          return generateStasisVisionLocal(nums, statusEl);
        }
        failed = err;
        updateStasisVisionView(stasisVisionUrl);
        if (statusEl) {
          statusEl.hidden = false;
          statusEl.className = "spell-generate-status error";
          var msg = err && err.message ? err.message : String(err);
          if (isCreditsError(msg)) {
            msg =
              msg +
              " Free fuse is off by default so quality is preserved. Set SPELLFORGE_LOCAL_FALLBACK_ON_CREDITS = true in spellforge-config.js only if you want stacked paintings.";
          }
          statusEl.textContent = msg;
        }
      })
      .finally(function () {
        generatingVision = false;
        skipLocalFuse = false;
        setStasisVisionLoading(false);
        if (btn) {
          btn.disabled = nums.length < 2;
          updateGenerateButton();
        }
        updateMuralwalkButton();
      })
      .then(function (result) {
        if (failed && forceCloud) return Promise.reject(failed);
        return stasisVisionUrl || result;
      });
  }

  function openMuralwalkFloor() {
    if (!stasisVisionUrl) return;
    publishFusion();
    var tab = document.querySelector('.site-tabs .tab[data-tab="muralwalk"]');
    if (tab) tab.click();
    else location.hash = "muralwalk";
  }

  function openAnimateTabFromSpellforge() {
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

  function spellforgeAnimatePayload() {
    var physical = document.getElementById("spell-physical-prompt");
    var stasisEl = document.getElementById("spell-stasis");
    var prompt =
      (physical && physical.value && physical.value.trim()) ||
      (stasisEl && stasisEl.value && stasisEl.value.trim()) ||
      String(spellStasis || lastFusedPrompt || "").trim();
    return {
      prompt: prompt,
      stasis: String(spellStasis || "").trim() || prompt,
      imageUrl: stasisVisionUrl || "",
      aspect: getAspectRatio(),
    };
  }

  function setSpellGenerateStatus(msg, isErr) {
    var statusEl = document.getElementById("spell-generate-status");
    if (!statusEl) return;
    statusEl.hidden = !msg;
    statusEl.textContent = msg || "";
    statusEl.className = "spell-generate-status" + (isErr ? " error" : "");
  }

  function sendSpellforgeToAnimate(opts) {
    opts = opts || {};
    var payload = spellforgeAnimatePayload();
    openAnimateTabFromSpellforge();
    return new Promise(function (resolve) {
      setTimeout(function () {
        try {
          if (!window.Animate || typeof window.Animate.seedFromSpellforge !== "function") {
            setSpellGenerateStatus("Animate not ready — open Animate and paste the prompt.", true);
            resolve(null);
            return;
          }
          var seeded = window.Animate.seedFromSpellforge({
            prompt: payload.prompt,
            stasis: payload.stasis,
            imageUrl: payload.imageUrl,
            aspect: payload.aspect,
            autoCast: !!opts.autoCast,
          });
          if (opts.autoCast) {
            setSpellGenerateStatus("Seeded Animate — cast if it did not start automatically.");
          } else {
            setSpellGenerateStatus("Sent fused prompt to Animate.");
          }
          resolve(seeded);
        } catch (e) {
          setSpellGenerateStatus("Could not hand off to Animate.", true);
          resolve(null);
        }
      }, 60);
    });
  }

  function bindStasisAndPrompt() {
    var stasisEl = document.getElementById("spell-stasis");
    if (stasisEl && !stasisEl.dataset.modBound) {
      stasisEl.dataset.modBound = "1";
      stasisEl.addEventListener("input", function () {
        spellStasis = stasisEl.value;
        stasisUserDirty = true;
        lastFusedPrompt = (spellStasis + " " + spellPrompt).trim();
        updateStasisModeration();
        updateRedefineButton();
        publishFusion();
      });
    }

    var promptEl = document.getElementById("spell-prompt");
    if (promptEl && !promptEl.dataset.loopBound) {
      promptEl.dataset.loopBound = "1";
      promptEl.addEventListener("keydown", function (e) {
        if (e.key === "Enter") e.preventDefault();
      });
      promptEl.addEventListener(
        "input",
        debounce(function () {
          spellPrompt = promptEl.value;
          updateStasisModeration();
          onBuzzChanged();
          refreshSpellforgeInterfaceSkin();
        }, 40)
      );
    }

    var omitBtn = document.getElementById("spell-omit-flagged");
    if (omitBtn && !omitBtn.dataset.bound) {
      omitBtn.dataset.bound = "1";
      omitBtn.onclick = omitAllFlaggedStasis;
    }

    var genBtn = document.getElementById("spell-generate-stasis");
    if (genBtn) genBtn.onclick = generateStasisVision;

    var redefineBtn = document.getElementById("spell-redefine-stasis");
    if (redefineBtn && !redefineBtn.dataset.bound) {
      redefineBtn.dataset.bound = "1";
      redefineBtn.onclick = redefineStasis;
    }

    var mwBtn = document.getElementById("spell-send-muralwalk");
    if (mwBtn && !mwBtn.dataset.bound) {
      mwBtn.dataset.bound = "1";
      mwBtn.onclick = openMuralwalkFloor;
    }

    var sendAn = document.getElementById("spell-send-animate");
    if (sendAn && !sendAn.dataset.bound) {
      sendAn.dataset.bound = "1";
      sendAn.addEventListener("click", function () {
        sendSpellforgeToAnimate({ autoCast: false });
      });
    }
    var genAn = document.getElementById("spell-gen-video-animate");
    if (genAn && !genAn.dataset.bound) {
      genAn.dataset.bound = "1";
      genAn.addEventListener("click", function () {
        sendSpellforgeToAnimate({ autoCast: true });
      });
    }

    for (var nsi = 0; nsi < 3; nsi++) {
      (function (slot) {
        var btn = document.getElementById("spell-note-equip-" + slot);
        if (btn && !btn.dataset.bound) {
          btn.dataset.bound = "1";
          btn.addEventListener("click", function () {
            var ta = document.getElementById("spell-note-text");
            var res = equipNote(slot, ta && ta.value);
            if (!res.ok) {
              setSpellGenerateStatus(res.error, true);
              return;
            }
            if (ta) ta.value = "";
            setSpellGenerateStatus("Equipped note into Spell " + ["I", "II", "III"][slot] + ".");
          });
        }
      })(nsi);
    }

    updateStasisModeration();
  }

  function renderSlots() {
    closeSpellColorPopover();
    var slots = document.querySelectorAll(".spell-slot");
    var names = ["I", "II", "III"];
    for (var s = 0; s < slots.length; s++) {
      var el = slots[s];
      var num = spells[s];
      if (!num) {
        el.classList.remove("filled");
        el.innerHTML = '<span class="slot-label">Spell ' + names[s] + "</span>";
        clearSpellSlotBody(s);
        continue;
      }
      var a = getAnalysis(num);
      var extra = extraSpells[num] || extraSpells[String(num)];
      var title =
        a && a.title
          ? a.title
          : noteOf(num)
            ? "Note"
            : extra
              ? spellKindLabel(num)
              : "Painting #" + num;
      var body = getSpellSlotBody(s);
      var head = spellKindLabel(num) + " · " + title;
      el.classList.add("filled");
      el.innerHTML =
        '<div class="spell-slot-inner">' +
        '<img src="' +
        escapeAttr(paintingUrl(num)) +
        '" alt="' +
        escapeAttr(head) +
        '" />' +
        '<div class="spell-slot-copy">' +
        '<div class="spell-slot-head">' +
        escapeHtml(head) +
        "</div>" +
        buildSpellColorHtml(body, s) +
        "</div>" +
        '<button type="button" class="slot-clear" aria-label="Clear">×</button>' +
        "</div>";
      bindSpellSlotColorHits(el, s);
      (function (idx, btn) {
        btn.addEventListener("click", function (e) {
          e.stopPropagation();
          spells[idx] = null;
          clearSpellSlotBody(idx);
          renderSlots();
          renderGrid();
        });
      })(s, el.querySelector(".slot-clear"));
    }
    updateFusion();
    saveEquippedSpells();
  }

  function equipNote(slotIndex, text) {
    slotIndex = parseInt(slotIndex, 10);
    text = String(text || "").trim();
    if (slotIndex < 0 || slotIndex > 2 || isNaN(slotIndex)) {
      return { ok: false, error: "Pick Spell I–III." };
    }
    if (!text) return { ok: false, error: "Write a note first." };
    loadSpellNotes();
    if (!spellNotes.notes) spellNotes.notes = {};
    var id = Number(spellNotes.nextNoteId) || NOTE_BASE + 1;
    spellNotes.nextNoteId = id + 1;
    var title = text.replace(/\s+/g, " ").slice(0, 40);
    if (text.length > 40) title += "…";
    spellNotes.notes[String(id)] = {
      id: id,
      title: title || "Note",
      text: text,
      createdAt: Date.now(),
    };
    saveSpellNotes();
    spells[slotIndex] = id;
    clearSpellSlotBody(slotIndex);
    if (spellforgeReady) {
      renderSlots();
      renderGrid();
    } else {
      saveEquippedSpells();
    }
    return { ok: true, slot: slotIndex, id: id };
  }

  function equipToSlot(num, slotIndex) {
    spells[slotIndex] = num;
    // New painting in slot → start from default description (colors as names)
    clearSpellSlotBody(slotIndex);
    renderSlots();
    renderGrid();
    saveEquippedSpells();
  }

  function setEquippedSlots(next, opts) {
    opts = opts || {};
    var skipAuto = !!opts.skipAutoVision;
    if (skipAuto) {
      clearTimeout(autoVisionTimer);
      suppressAutoVision = true;
    }
    try {
      var i;
      for (i = 0; i < 3; i++) {
        var n = next && next[i] != null ? parseInt(next[i], 10) : 0;
        spells[i] = n && !isNaN(n) ? n : null;
        clearSpellSlotBody(i);
      }
      saveEquippedSpells();
      if (spellforgeReady && !opts.skipRender) {
        renderSlots();
        renderGrid();
      }
    } finally {
      if (skipAuto) suppressAutoVision = false;
    }
  }

  function slotHasPromptText(num) {
    var a = getAnalysis(num);
    if (a && String(a.description || a.prompt || a.source_description || "").trim()) {
      return true;
    }
    var extra = extraSpells[num] || extraSpells[String(num)];
    if (
      extra &&
      extra.analysis &&
      String(extra.analysis.description || extra.analysis.prompt || "").trim()
    ) {
      return true;
    }
    var body = analysisSpellText(num);
    return !!(body && !/no analysis yet|description pending/i.test(body));
  }

  function ensureSlotAnalyses(nums) {
    nums = nums || [];
    function hydrate(n) {
      getAnalysis(n);
    }
    nums.forEach(hydrate);
    if (nums.filter(slotHasPromptText).length >= Math.min(2, nums.length)) {
      return Promise.resolve(nums);
    }
    return loadSpellAssets({ skipSketches: true }).then(function () {
      nums.forEach(hydrate);
      return nums;
    });
  }

  function generateFromSlots(slotNums, opts) {
    opts = opts || {};
    opts.forceCloud = true;
    return whenSpellforgeReady()
      .then(function () {
        setEquippedSlots(slotNums, { skipAutoVision: true, skipRender: true });
        return ensureSlotAnalyses(getEquippedInOrder());
      })
      .then(function (nums) {
        var ok = nums.filter(slotHasPromptText);
        if (ok.length < 2) {
          return Promise.reject(
            new Error(
              "Need descriptions for at least 2 equipped spells. Wait for analyses to load, then Forge again."
            )
          );
        }
        if (opts.extraPrompt != null) {
          spellPrompt = String(opts.extraPrompt || "").trim();
          var promptEl = document.getElementById("spell-prompt");
          if (promptEl) promptEl.value = spellPrompt;
        }
        updatePhysicalPromptPreview();
        return generateStasisVision(opts).then(function () {
          return stasisVisionUrl;
        });
      });
  }

  function whenSpellforgeReady() {
    ensureSpellforgeStarted();
    if (spellforgeReady) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () {
        reject(new Error("Spellforge did not finish loading."));
      }, 60000);
      window.addEventListener(
        "spellforge-ready",
        function () {
          clearTimeout(t);
          resolve();
        },
        { once: true }
      );
    });
  }

  function openSlotDialog(num) {
    num = parseInt(num, 10);
    if (!num) return;
    pendingPickNumber = num;
    var dialog = document.getElementById("spell-slot-dialog");
    var img = document.getElementById("spell-preview-img");
    var meta = document.getElementById("spell-preview-meta");
    if (!dialog || !img) return;

    img.src = paintingUrl(num);
    img.alt = "Painting #" + num;
    if (meta) meta.textContent = analysisSpellText(num);

    if (!slotDialogBound) {
      slotDialogBound = true;
      var closeBtn = document.getElementById("spell-slot-dialog-close");
      if (closeBtn) {
        closeBtn.onclick = function () {
          if (window.galleryDialog) window.galleryDialog.close(dialog);
          else dialog.close();
        };
      }
      var btns = document.querySelectorAll(".btn-spell-slot");
      for (var b = 0; b < btns.length; b++) {
        btns[b].onclick = function () {
          if (pendingPickNumber == null) return;
          equipToSlot(pendingPickNumber, parseInt(this.dataset.slot, 10));
          pendingPickNumber = null;
          if (window.galleryDialog) window.galleryDialog.close(dialog);
          else dialog.close();
        };
      }
    }

    if (window.galleryDialog) window.galleryDialog.open(dialog);
    else dialog.showModal();
  }

  function bindPicker() {
    var picker = document.getElementById("spell-picker");
    if (!picker || picker.dataset.bound) return;
    picker.dataset.bound = "1";
    picker.addEventListener("click", function (e) {
      var card = e.target.closest
        ? e.target.closest(".card[data-number]")
        : null;
      if (card && card.dataset.number) {
        openSlotDialog(card.dataset.number);
      }
    });
  }

  function shuffleCurrentPage() {
    var start = activePage * PAGE_SIZE;
    var slice = displayOrder.slice(start, start + PAGE_SIZE);
    pageSnapshotBeforeShuffle = slice.slice();
    slice = shuffleArray(slice);
    for (var i = 0; i < PAGE_SIZE; i++) displayOrder[start + i] = slice[i];
    saveDisplayOrder();
    var rb = document.getElementById("spell-restore-page");
    if (rb) rb.hidden = false;
    renderGrid();
  }

  function restoreCurrentPage() {
    if (!pageSnapshotBeforeShuffle) return;
    var start = activePage * PAGE_SIZE;
    for (var i = 0; i < PAGE_SIZE; i++) displayOrder[start + i] = pageSnapshotBeforeShuffle[i];
    saveDisplayOrder();
    pageSnapshotBeforeShuffle = null;
    var rb = document.getElementById("spell-restore-page");
    if (rb) rb.hidden = true;
    renderGrid();
  }

  function reshuffleAll() {
    var nExtra = arsenalExtraNums.length;
    var msg =
      "Shuffle the full arsenal into a new random order?" +
      (nExtra
        ? " (" +
          TOTAL +
          " paintings + " +
          nExtra +
          " phone/generated images mixed together.)"
        : " (all " + TOTAL + " paintings.)");
    if (!confirm(msg)) return;
    buildDisplayOrder(true);
    activePage = 0;
    pageSnapshotBeforeShuffle = null;
    var rb = document.getElementById("spell-restore-page");
    if (rb) rb.hidden = true;
    renderGrid();
  }

  function jumpToPainting(num) {
    num = parseInt(num, 10) || 1;
    if (!isValidSpellNum(num)) {
      num = Math.max(1, Math.min(TOTAL, num));
    }
    activePage = findPageForNumber(num);
    pickerQuery = "";
    var search = document.getElementById("spell-search");
    if (search) search.value = "";
    renderGrid();
    var tile = document.querySelector('#spell-picker [data-number="' + num + '"]');
    if (tile) tile.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function debounce(fn, ms) {
    var t;
    return function () {
      var args = arguments;
      var self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  }

  function bindControls() {
    attachNav();
    bindPicker();

    var search = document.getElementById("spell-search");
    if (search) {
      search.addEventListener(
        "input",
        debounce(function (e) {
          pickerQuery = e.target.value;
          renderGrid();
        }, 200)
      );
    }

    var jump = document.getElementById("spell-jump");
    if (jump) {
      jump.onchange = function () {
        if (jump.value) jumpToPainting(jump.value);
      };
    }

    var shuf = document.getElementById("spell-shuffle");
    if (shuf) shuf.onclick = shuffleCurrentPage;
    var restore = document.getElementById("spell-restore-page");
    if (restore) restore.onclick = restoreCurrentPage;
    var all = document.getElementById("spell-reshuffle-all");
    if (all) all.onclick = reshuffleAll;

    bindStasisAndPrompt();
    bindAspectControl();
    bindStasisVisionView();
    var shareBtn = document.getElementById("spell-share-link");
    if (shareBtn && !shareBtn.dataset.bound) {
      shareBtn.dataset.bound = "1";
      shareBtn.addEventListener("click", copyShareSpellLink);
    }

    var panel = document.getElementById("panel-spellforge");
    if (panel) {
      panel.addEventListener("keydown", function (e) {
        if (pickerQuery.trim()) return;
        var tag = (e.target.tagName || "").toLowerCase();
        if (tag === "input" || tag === "textarea") return;
        if (e.key === "ArrowLeft") { e.preventDefault(); goPrevPage(); }
        if (e.key === "ArrowRight") { e.preventDefault(); goNextPage(); }
      });
    }
  }

  function loadAndStart() {
    var loading = document.getElementById("spell-picker-loading");
    if (loading) loading.hidden = false;

    function ready() {
      spellforgeReady = true;
      loadSpellNotes();
      buildManifestMap();
      // Paintings + phone uploads + generated stills (mixed shuffle)
      loadSpellAssets().then(function () {
        buildDisplayOrder(false);
        loadSpellsFromShareLink();
        if (!location.search.match(/spells=/)) loadEquippedSpells();
        if (loading) loading.hidden = true;
        if (window.SpellLoop) {
          window.SpellLoop.init("spell-loop-canvas", "spell-loop-caption");
        }
        if (window.SpellTimelapse && !window.SpellLoop) {
          window.SpellTimelapse.init("spell-loop-canvas", "spell-loop-caption");
        }
        bindControls();
        bindStasisVisionView();
        updateStasisVisionView(stasisVisionUrl);
        renderSlots();
        renderGrid();
        checkServer().then(function () {
          updateServerHint();
          var genBtn = document.getElementById("spell-generate-stasis");
          if (genBtn) genBtn.disabled = getEquippedInOrder().length < 2;
          updateGenerateButton();
          updateRedefineButton();
          updateMuralwalkButton();
          updateFusion();
        });
        window.dispatchEvent(new Event("spellforge-ready"));
      });
    }

    if (window.loadGalleryData) {
      window
        .loadGalleryData()
        .then(function (data) {
          manifest = data.manifest && data.manifest.length ? data.manifest : [];
          analyses = data.analyses || {};
          if (manifest.length < TOTAL) {
            manifest = [];
            for (var i = 1; i <= TOTAL; i++) manifest.push({ number: i, filename: i + ".jpg" });
          }
          ready();
        })
        .catch(function () {
          manifest = [];
          for (var j = 1; j <= TOTAL; j++) manifest.push({ number: j, filename: j + ".jpg" });
          analyses = {};
          ready();
        });
    } else {
      for (var k = 1; k <= TOTAL; k++) manifest.push({ number: k, filename: k + ".jpg" });
      ready();
    }

    window.addEventListener("gallery-data-ready", function () {
      if (window.getGalleryManifest) manifest = window.getGalleryManifest() || manifest;
      if (window.getGalleryAnalyses) analyses = window.getGalleryAnalyses() || analyses;
      buildManifestMap();
      // Re-apply phone analyses on top of painting analyses
      Object.keys(extraSpells).forEach(function (k) {
        var ex = extraSpells[k];
        if (ex && ex.analysis) {
          analyses[String(ex.number)] = ex.analysis;
          analyses[ex.number] = ex.analysis;
        }
      });
      renderSlots();
      renderGrid();
    });
  }

  function onShow() {
    ensureSpellforgeStarted();
    if (!spellforgeReady) {
      window.addEventListener(
        "spellforge-ready",
        function () {
          onShow();
        },
        { once: true }
      );
      return;
    }
    attachNav();
    // Refresh phone/generated arsenal; new tiles shuffle into the book
    loadSpellAssets().then(function () {
      displayOrder = reconcileDisplayOrder(displayOrder, buildFullArsenalList());
      saveDisplayOrder();
      renderGrid();
      renderSlots();
      updateFusion();
    });
    renderGrid();
    renderSlots();
    updateFusion();
    if (window.SpellLoop) {
      if (window.SpellLoop.resize) window.SpellLoop.resize();
      var nums = getEquippedInOrder();
      if (nums.length >= 2) {
        var meta = collectCombinedMeta(nums);
        syncSpellLoop(nums, null, meta);
        if (window.SpellLoop.start) window.SpellLoop.start();
      } else {
        if (window.SpellLoop.start) window.SpellLoop.start();
      }
    }
    refreshSpellforgeInterfaceSkin();
  }

  function ensureSpellforgeStarted() {
    if (spellforgeStarted) return;
    spellforgeStarted = true;
    loadAndStart();
  }

  function boot() {
    if (!document.getElementById("panel-spellforge")) return;
    try {
      loadSpellNotes();
      window.equipSpellPainting = function (num) {
        ensureSpellforgeStarted();
        openSlotDialog(num);
      };
      window.spellforgeRefresh = renderGrid;
      window.SpellforgeAPI = {
        onShow: onShow,
        prevPage: goPrevPage,
        nextPage: goNextPage,
        setPage: selectPage,
        reshuffle: reshuffleAll,
        refresh: renderGrid,
        getFusion: function () {
          return window.spellforgeFusion || {
            slots: spells.slice(),
            spells: getEquippedInOrder(),
            stasis: spellStasis,
            visionUrl: stasisVisionUrl,
            title: "",
            buzz: getActiveBuzz(),
          };
        },
        getEquippedSlots: function () {
          return spells.slice();
        },
        getDisplayOrder: function () {
          return (displayOrder && displayOrder.length ? displayOrder : []).slice();
        },
        getPageCount: function () {
          return totalPageCount();
        },
        equipToSlot: function (num, slotIndex) {
          equipToSlot(num, slotIndex);
        },
        equipSlots: function (slots, opts) {
          setEquippedSlots(slots, opts);
        },
        equipNote: function (slotIndex, text) {
          return equipNote(slotIndex, text);
        },
        whenReady: function () {
          return whenSpellforgeReady();
        },
        generate: function (opts) {
          return whenSpellforgeReady().then(function () {
            return generateStasisVision(opts || {});
          });
        },
        generateFromSlots: function (slots, opts) {
          return generateFromSlots(slots, opts || {});
        },
      };
      publishFusion();
      var hash = location.hash.replace("#", "");
      var embedSf = false;
      try {
        embedSf = new URLSearchParams(location.search).get("embed") === "spellforge";
      } catch (eEmb) {}
      // Embed (Studio 3D plane) or direct hash — always boot arsenal
      if (hash === "spellforge" || embedSf) {
        ensureSpellforgeStarted();
        if (embedSf) {
          // tabs.js may have already fired show; ensure grid fills after assets
          setTimeout(function () {
            try {
              onShow();
            } catch (eOn) {}
          }, 200);
          setTimeout(function () {
            try {
              if (window.SpellforgeAPI && window.SpellforgeAPI.refresh) {
                window.SpellforgeAPI.refresh();
              } else {
                renderGrid();
              }
            } catch (eRef) {}
          }, 800);
        }
      }
    } catch (err) {
      console.error("Spellforge:", err);
      var picker = document.getElementById("spell-picker");
      if (picker) picker.innerHTML = "<p class=\"spell-picker-empty\">Spellforge failed to load.</p>";
    }
  }

  window.addEventListener("spellforge-show", onShow);
  window.addEventListener("spellforge-hide", function () {
    if (window.SpellLoop) window.SpellLoop.stop();
    var vid = document.getElementById("spell-loop-video");
    if (vid && !vid.paused) vid.pause();
  });
  window.addEventListener("spellforge-equip", function (e) {
    if (e.detail && e.detail.number) openSlotDialog(e.detail.number);
  });

  // Used by spell-loop / local fuse so phone G# tiles resolve to /generated/N.jpg
  window.getSpellforgeSpellUrl = paintingUrl;
  window.getSpellforgeSpellAnalysis = getAnalysis;
  window.isSpellforgeSpellNum = isValidSpellNum;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();