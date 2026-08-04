/**
 * Commercial — partnership / brand commercialization generator.
 * Catalog of real businesses + logo lookup + spell-formatted pieces.
 */
(function () {
  "use strict";

  var FETCH_TIMEOUT_MS = 180000;
  var VIDEO_POLL_MS = 2000;
  var VIDEO_POLL_MAX_MS = 12 * 60 * 1000;
  var VIDEO_REF_MAX_SIDE = 960;
  var MAX_WORLD_SPELLS = 6;
  var TRAY_SLICE = 48;
  /** Keep under typical model/moderation limits (user reported >8000 often fails). */
  var MAX_STASIS_CHARS = 3200;
  var MAX_PROMPT_CHARS = 1800;
  var MAX_TOTAL_TEXT_CHARS = 4800;
  var MAX_BRANDS_IN_PROMPT = 4;
  var MAX_TITLES_IN_PROMPT = 3;
  var MAX_CELEBS_IN_PROMPT = 3;
  var MAX_STYLES_IN_PROMPT = 2;
  var MAX_WORLDS_IN_PROMPT = 4;
  var STORAGE_SELECTED = "gallery-commercial-selected-v1";
  var STORAGE_STYLES = "gallery-commercial-styles-v1";
  var STORAGE_TITLES = "gallery-commercial-titles-v1";
  var STORAGE_CELEBS = "gallery-commercial-celebs-v1";
  var STORAGE_CUSTOM_STYLES = "gallery-commercial-custom-styles-v1";
  var STORAGE_CUSTOM_TITLES = "gallery-commercial-custom-titles-v1";
  var STORAGE_CUSTOM_CELEBS = "gallery-commercial-custom-celebs-v1";
  var STORAGE_PREFS = "gallery-commercial-prefs-v1";

  var state = {
    brands: [],
    categories: [],
    filterCat: "all",
    selected: {}, // id -> brand
    styles: [],
    styleCategories: [],
    filterStyleCat: "all",
    selectedStyles: {}, // id -> style
    titles: [],
    titleCategories: [], // kind:all|movie|tv + genres
    filterTitleCat: "all",
    selectedTitles: {}, // id -> title
    celebs: [],
    celebCategories: [],
    filterCelebCat: "all",
    selectedCelebs: {}, // id -> celeb
    leftPanel: "brands", // brands | titles | celebs | styles
    pool: [],
    tray: [],
    appliedSpells: [],
    generating: false,
    imageUrl: "",
    videoUrl: "",
    savedImageNum: null,
    savedVideoNum: null,
    mode: "image", // image | video
    aspect: "1:1",
    duration: 10,
    poolFilter: "all", // all | paintings | generated
    ready: false,
    promptDirty: false, // user edited stasis/prompt manually
    lastPayload: null,
    editorOpen: false,
  };

  function $(id) {
    return document.getElementById(id);
  }

  function apiUrl(path) {
    if (typeof window.galleryApiUrl === "function") return window.galleryApiUrl(path);
    var base = String(window.SPELLFORGE_API_BASE || "").replace(/\/$/, "");
    return base ? base + path : path;
  }

  function setStatus(msg, kind) {
    var el = $("co-status");
    if (!el) return;
    el.textContent = msg || "";
    el.className = "co-status" + (kind ? " " + kind : "");
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
    return fetch(url, options || {});
  }

  function absoluteUrl(url) {
    if (!url) return "";
    if (url.indexOf("data:") === 0 || url.indexOf("blob:") === 0 || /^https?:\/\//i.test(url)) {
      return url;
    }
    try {
      return new URL(url, window.location.href).href;
    } catch (_) {
      return url;
    }
  }

  function logoSrc(brand) {
    if (!brand) return "";
    if (brand.logo_url) return absoluteUrl(brand.logo_url);
    if (brand.domain) return apiUrl("/api/commercial-logo?domain=" + encodeURIComponent(brand.domain));
    return apiUrl("/api/commercial-logo?name=" + encodeURIComponent(brand.name || brand.id || ""));
  }

  function loadSelectedFromStorage() {
    try {
      var raw = localStorage.getItem(STORAGE_SELECTED);
      if (!raw) return;
      var ids = JSON.parse(raw);
      if (!Array.isArray(ids)) return;
      state.selected = {};
      ids.forEach(function (id) {
        var b = state.brands.find(function (x) {
          return x.id === id;
        });
        if (b) state.selected[id] = b;
      });
    } catch (_) {}
  }

  function persistSelected() {
    try {
      localStorage.setItem(STORAGE_SELECTED, JSON.stringify(Object.keys(state.selected)));
    } catch (_) {}
  }

  function persistSelectedStyles() {
    try {
      localStorage.setItem(STORAGE_STYLES, JSON.stringify(Object.keys(state.selectedStyles)));
    } catch (_) {}
  }

  function loadSelectedStylesFromStorage() {
    try {
      var raw = localStorage.getItem(STORAGE_STYLES);
      if (!raw) return;
      var ids = JSON.parse(raw);
      if (!Array.isArray(ids)) return;
      state.selectedStyles = {};
      ids.forEach(function (id) {
        var s = state.styles.find(function (x) {
          return x.id === id;
        });
        if (s) state.selectedStyles[id] = s;
      });
    } catch (_) {}
  }

  function persistSelectedTitles() {
    try {
      localStorage.setItem(STORAGE_TITLES, JSON.stringify(Object.keys(state.selectedTitles)));
    } catch (_) {}
  }

  function loadSelectedTitlesFromStorage() {
    try {
      var raw = localStorage.getItem(STORAGE_TITLES);
      if (!raw) return;
      var ids = JSON.parse(raw);
      if (!Array.isArray(ids)) return;
      state.selectedTitles = {};
      ids.forEach(function (id) {
        var t = state.titles.find(function (x) {
          return x.id === id;
        });
        if (t) state.selectedTitles[id] = t;
      });
    } catch (_) {}
  }

  function selectedTitlesList() {
    return Object.keys(state.selectedTitles).map(function (id) {
      return state.selectedTitles[id];
    });
  }

  function titleIconsLine(t, maxN) {
    maxN = maxN == null ? 5 : maxN;
    var list = (t && t.icons) || [];
    if (!list.length) return "";
    return list.slice(0, maxN).join(", ");
  }

  function titlePosterLabel(t) {
    if (!t) return "?";
    var kind = t.kind === "tv" ? "TV" : "FILM";
    var y = t.year ? String(t.year) : "";
    return kind + (y ? "\n" + y : "");
  }

  /** Always spell Superman as super-man (user preference + softer moderation). */
  function spellSuperMan(s) {
    return String(s || "").replace(/\bsuper[\s_-]*man\b/gi, "super-man");
  }

  /**
   * Soften over-specific franchise tokens so the model invents fresh motifs.
   * UI catalog names stay intact; only generation prompts use this.
   */
  function softenMotifForModeration(phrase) {
    var s = spellSuperMan(String(phrase || "").trim());
    if (!s) return "";
    // Drop obvious proper-noun tokens that push the model toward clones
    // (super-man kept as hyphenated form rather than stripped)
    s = s.replace(
      /\b(batman|bat-signal|batmobile|joker|wonder woman|spiderman|spider-man|iron man|ironman|thanos|groot|yoda|vader|darth|grogu|baby yoda|mandalorian|elsa|anna|olaf|mario|luigi|bowser|harry potter|voldemort|hogwarts|dumbledore|frodo|gandalf|gollum|sauron|one ring|deadpool|wolverine|hulk|black panther|wakanda|barbie|oppenheimer|joker makeup|pennywise|xenomorph|alien queen|t-800|terminator|e\.?t\.?|wall-?e|nemo|buzz lightyear|woody|simba|mickey|minnie|darth maul|palpatine|leia|luke skywalker|han solo|chewbacca|r2-d2|c-3po|bb-8|ahsoka|obi-wan|kenobi|anakin|skywalker|jedi|sith|lightsaber|death star|millennium falcon|avengers|infinity gauntlet|witcher|geralt|stranger things|upside down|wednesday addams|homelander|squid game|iron throne|khaleesi|daenerys|jon snow|walter white|heisenberg|saul goodman|tony soprano|dunder mifflin|friends couch|central perk)\b/gi,
      ""
    );
    s = s.replace(/\b(tt\d{6,})\b/gi, "");
    s = s.replace(/\s{2,}/g, " ").replace(/^[\s,;:/\-]+|[\s,;:/\-]+$/g, "");
    // If we stripped too much, fall back to generic object words still present
    if (s.length < 3) return "";
    return s;
  }

  function titleEraLabel(year) {
    var y = parseInt(year, 10);
    if (!y) return "contemporary";
    if (y >= 2020) return "2020s";
    if (y >= 2010) return "2010s";
    if (y >= 2000) return "2000s";
    if (y >= 1990) return "1990s";
    if (y >= 1980) return "1980s";
    if (y >= 1970) return "1970s";
    if (y >= 1960) return "1960s";
    return "classic-era";
  }

  function genreMoodPhrase(genre) {
    var g = String(genre || "drama").toLowerCase();
    var map = {
      action: "kinetic action-adventure mood, bold silhouettes, dynamic staging",
      "sci-fi": "speculative sci-fi atmosphere, futuristic materials, cosmic or high-tech ambiance",
      fantasy: "mythic fantasy atmosphere, legendary architecture, enchanted light",
      horror: "suspenseful gothic-horror atmosphere, dramatic shadow, eerie stillness (no gore)",
      thriller: "tense thriller mood, noir edges, high-contrast night",
      crime: "crime-drama mood, urban night, sharp wardrobe and interiors",
      drama: "prestige drama mood, grounded emotion, rich production design",
      comedy: "witty comedic production design, playful props, bright staging",
      romance: "romantic cinematic light, intimate sets, soft color",
      animation: "stylized animated production design, bold shapes, playful materials",
      adventure: "epic adventure scale, journeys, dramatic landscapes",
      war: "historical war-era production design, uniforms and vehicles as set dressing (no graphic violence)",
      musical: "theatrical musical staging, performance light, glamorous costume color",
      western: "frontier western atmosphere, dust light, rugged props",
      mystery: "mystery mood, clues as set dressing, fog and shadow",
      biography: "period biopic production design, era-correct wardrobe and interiors",
      family: "family adventure warmth, approachable wonder, bright sets",
    };
    return map[g] || g + " cinematic mood";
  }

  /** Generative brief — genre/era weather + freshly invented beings and props. */
  function titleSafePromptBrief(t, maxIcons) {
    maxIcons = maxIcons == null ? 4 : maxIcons;
    var motifs = ((t && t.icons) || [])
      .map(softenMotifForModeration)
      .filter(Boolean)
      .slice(0, maxIcons);
    var motifBit = motifs.length
      ? "dream-set motifs to reimagine as one-of-a-kind artifacts: " + motifs.join(", ")
      : "invented heraldry, never-seen wardrobe silhouettes, and architecture that only exists in this frame";
    var kind = t && t.kind === "tv" ? "prestige television" : "feature-film";
    var era = titleEraLabel(t && t.year);
    var mood = genreMoodPhrase(t && t.genre);
    return (
      kind +
      " production design inspired by " +
      era +
      " " +
      (t && t.genre ? t.genre + " " : "") +
      "cinema — " +
      mood +
      "; " +
      motifBit +
      ". Birth a never-before-seen lead figure with a unique face, personal sigils, and couture that has no twin — pure generative myth."
    );
  }

  function titlePlacementBlurb(t) {
    // Intentionally omit exact film/show titles and IMDb IDs — they trip content moderation.
    return "Cinematic story-world layer: " + titleSafePromptBrief(t, 5) + ".";
  }

  function titlesPromptLine() {
    var list = selectedTitlesList();
    if (!list.length) return "";
    return list
      .map(function (t) {
        return titleSafePromptBrief(t, 3);
      })
      .join(" | ");
  }

  /** Short safe summary for buzz words / video body */
  function titlesSafeShortLine() {
    var list = selectedTitlesList();
    if (!list.length) return "";
    return list
      .map(function (t) {
        return (
          titleEraLabel(t.year) +
          " " +
          (t.genre || "drama") +
          " " +
          (t.kind === "tv" ? "TV" : "film") +
          " aesthetic"
        );
      })
      .join(", ");
  }

  /**
   * When a movie/TV title name trips moderation:
   * 1) try all-lowercase first
   * 2) if still flagged, use a creative antonym / inverse-myth of the title
   * UI still shows the real title; only API text uses this.
   */
  var TITLE_ANTONYMS = {
    barbie: "the unpainted clay ordinary — soft earth tones, no pink empire",
    "the matrix": "the unplugged daylight city — warm sun, uncoded rain",
    matrix: "the unplugged daylight city — warm sun, uncoded rain",
    inception: "the waking surface — single solid reality, no nested dreams",
    "spider-man": "the gravity-bound neighbor without webs",
    spiderman: "the gravity-bound neighbor without webs",
    "the dark knight": "the bright day wardens — open sunlight civic hope",
    "star wars": "the quiet uncharted garden beyond fleets",
    "the avengers": "the solitary craftsperson myth — one quiet maker",
    avengers: "the solitary craftsperson myth — one quiet maker",
    "iron man": "the unarmored poet of open sky",
    "black panther": "the open-field traveler of unguarded dawn",
    joker: "the gentle carnival healer of soft laughter",
    batman: "the open-daylight civic gardener",
    "harry potter": "the unspellbound library of ordinary wonder",
    hogwarts: "the free-roaming meadow school of open sky",
    "the witcher": "the unmonstrous peacetime wanderer",
    witcher: "the unmonstrous peacetime wanderer",
    "stranger things": "the ordinary summer of unbroken streetlights",
    "the mandalorian": "the unhelmeted caravan of open faces",
    mandalorian: "the unhelmeted caravan of open faces",
    "the last of us": "the first of many — green renewal after quiet",
    wednesday: "the sunlit school of candid smiles",
    euphoria: "the clear-water calm of unglittered mornings",
    dune: "the water-rich orchard of soft rain",
    "dune: part two": "the water-rich orchard of soft rain",
    oppenheimer: "the unsplit light of peacetime invention",
    "john wick": "the unarmed gardener of quiet cities",
    "top gun": "the grounded sky-listener of soft clouds",
    "top gun: maverick": "the grounded sky-listener of soft clouds",
    "mission: impossible": "the everyday possible — ordinary courage",
    "the boys": "the unpowered neighbors of humble streets",
    "game of thrones": "the thaw of endless summer courts",
    "breaking bad": "the unbroken good of open kitchens",
    "the godfather": "the gentle godparent of sunlit feasts",
    "pulp fiction": "the linear quiet of soft mornings",
    "fight club": "the peace circle of open hands",
    alien: "the familiar friend of warm stations",
    aliens: "the familiar friend of warm stations",
    terminator: "the untimed guardian of gentle futures",
    "jurassic park": "the bird-safe meadow of living fossils at peace",
    frozen: "the thawed midsummer garden",
    "the lion king": "the quiet valley without crowns",
    "toy story": "the living-room myth of free play",
    "the hunger games": "the shared feast of unforced games",
    twilight: "the noon meadow of open sky",
    "the notebook": "the unfinished letter of distant storms",
    titanic: "the unbreaking harbor of still water",
    jaws: "the kind shore of calm swimming",
    "e.t.": "the homebound friend of ordinary bikes",
    "back to the future": "the present-tense afternoon of staying put",
    "the shining": "the warm inn of open doors",
    psycho: "the gentle motel of soft rain",
    casablanca: "the open border of endless travel",
    "the wizard of oz": "the unyellowed home of ordinary rooms",
    "blade runner": "the daylight city of unchased rain",
    "blade runner 2049": "the daylight city of unchased rain",
    mad: "the gentle clarity",
    "a quiet place": "the loud meadow of shared song",
    it: "the unclowned summer of safe streets",
    scream: "the soft whisper of friendly porches",
    halloween: "the ordinary october of porch lights",
    "the batman": "the bright day wardens",
    deadpool: "the earnest unmasked helper",
    "guardians of the galaxy": "the quiet gardeners of a small home star",
    "black mirror": "the warm window of unmediated faces",
    westworld: "the unscripted prairie of free will",
    "the expanse": "the near-earth porch of soft gravity",
    foundation: "the unfinished story of living streets",
    "house of the dragon": "the unwinged court of open peace",
    "the rings of power": "the unforged light of shared craft",
    "the boys": "the unpowered street of ordinary neighbors",
    "squid game": "the unranked playground of free play",
    "money heist": "the open vault of shared bread",
    narcos: "the uncarted garden of quiet towns",
    "peaky blinders": "the unrazored dawn of open mills",
    sherlock: "the unpuzzled afternoon of soft cases",
    "doctor who": "the untraveling home of one hour",
    "star trek": "the unvoyaging hearth of near neighbors",
    "the office": "the unfilmed quiet of empty desks",
    friends: "the uncoffeed solitude of open streets",
    "the simpsons": "the unyellowed town of soft realism",
    "breaking bad": "the unbroken kitchen of honest work",
  };

  var WORD_ANTONYMS = {
    dark: "bright",
    black: "luminous",
    night: "day",
    knight: "gardener",
    war: "peace",
    wars: "gardens",
    dead: "living",
    death: "life",
    kill: "heal",
    bad: "good",
    stranger: "familiar",
    strange: "ordinary",
    last: "first",
    end: "beginning",
    final: "first",
    hunger: "feast",
    quiet: "singing",
    silent: "voiced",
    impossible: "everyday",
    matrix: "unplugged",
    frozen: "thawed",
    cold: "warm",
    fire: "rain",
    blood: "sap",
    pulp: "whole",
    fight: "peace",
    club: "circle",
    boys: "neighbors",
    man: "spirit",
    men: "people",
    godfather: "godparent",
    god: "mortal",
    devil: "angel",
    evil: "kind",
    horror: "wonder",
    scream: "whisper",
    alien: "familiar",
    terminator: "guardian",
    joker: "healer",
    batman: "daylight-warden",
    spider: "gravity",
    iron: "open",
    panther: "meadow",
    force: "gentleness",
    empire: "commune",
    revenge: "forgiveness",
    deadpool: "earnest",
    wick: "gardener",
    dune: "orchard",
    sand: "rain",
    witcher: "peacemaker",
    rings: "open hands",
    power: "softness",
    dragon: "songbird",
    throne: "shared table",
    breaking: "mending",
    bad: "good",
    peaky: "soft",
    blinders: "open eyes",
    stranger: "neighbor",
    things: "comforts",
    mandalorian: "unhelmeted traveler",
    wednesday: "sunday picnic",
    euphoria: "clarity",
    boys: "kin",
    top: "grounded",
    gun: "kite",
    mission: "errand",
    avengers: "solitary maker",
    guardians: "gardeners",
    galaxy: "home star",
    star: "hearth",
    wars: "gardens",
    matrix: "daylight",
    barbie: "unpainted clay",
    inception: "waking",
    oppenheimer: "unsplit light",
    shining: "warm inn",
    jaws: "kind shore",
    titanic: "still harbor",
    psycho: "gentle motel",
    alien: "friend",
    frozen: "midsummer",
    lion: "valley",
    king: "neighbor",
    toy: "free play",
    story: "myth",
    hunger: "shared feast",
    games: "unforced play",
    twilight: "noon",
    notebook: "unfinished letter",
    wizard: "homebody",
    oz: "ordinary rooms",
    blade: "daylight",
    runner: "stroller",
    quiet: "chorus",
    place: "meadow",
    scream: "porch whisper",
    halloween: "porch light",
    it: "safe summer",
    pulp: "intact",
    fiction: "morning",
    fight: "open hands",
    club: "circle",
    godfather: "godparent feast",
    casablanca: "open border",
    back: "present",
    future: "afternoon",
  };

  function inventTitleAntonym(name) {
    var key = String(name || "")
      .toLowerCase()
      .replace(/[^a-z0-9:.\s\-']/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (TITLE_ANTONYMS[key]) return TITLE_ANTONYMS[key];
    var stripped = key.replace(/^(the|a|an)\s+/, "");
    if (TITLE_ANTONYMS[stripped]) return TITLE_ANTONYMS[stripped];

    var words = stripped.split(/[\s:\-]+/).filter(Boolean);
    var flipped = words.map(function (w) {
      return WORD_ANTONYMS[w] || WORD_ANTONYMS[w.replace(/s$/, "")] || null;
    });
    var known = flipped.filter(Boolean);
    if (known.length) {
      return (
        "the inverse-myth (" +
        known.join(" ") +
        ") — a freshly named world that flips the mood of “" +
        stripped +
        "”"
      );
    }
    return (
      "the counter-myth of “" +
      stripped +
      "” — inverted tone, original nameplate invented only for this frame"
    );
  }

  /** True if text trips our moderation highlighter (any flag). */
  function textTriggersModeration(text) {
    if (!text) return false;
    // scanModeration is defined later as a function declaration (hoisted)
    if (typeof scanModeration !== "function") return false;
    var scan = scanModeration(text);
    return !!(scan.flags && scan.flags.length);
  }

  /**
   * Movie/TV brand string for API prompts:
   * lowercase first; if that still flags, use antonym.
   * Returns { phrase, mode: "lower"|"antonym", original }
   */
  function titleBrandForPrompt(name) {
    var original = String(name || "").trim();
    if (!original) return { phrase: "", mode: "empty", original: "" };
    var lower = original.toLowerCase();
    if (!textTriggersModeration(lower)) {
      return { phrase: lower, mode: "lower", original: original };
    }
    var ant = inventTitleAntonym(original);
    return { phrase: ant, mode: "antonym", original: original };
  }

  function titleBrandPhrase(name) {
    return titleBrandForPrompt(name).phrase;
  }

  /** Map a list of title names through lower→antonym pipeline; join for prompts. */
  function titleBrandsListPhrase(names) {
    var notes = [];
    var phrases = (names || [])
      .map(function (n) {
        var r = titleBrandForPrompt(n);
        if (r.mode === "antonym") {
          notes.push(r.original + " → antonym");
        } else if (r.mode === "lower") {
          notes.push(r.original + " → lowercase");
        }
        return r.phrase;
      })
      .filter(Boolean);
    return { text: phrases.join(", "), notes: notes };
  }

  function toggleTitle(t) {
    if (!t || !t.id) return;
    if (state.selectedTitles[t.id]) {
      delete state.selectedTitles[t.id];
    } else {
      state.selectedTitles[t.id] = t;
    }
    persistSelectedTitles();
    renderTitleList();
    renderSelectedTitles();
    onLoadoutChanged(
      (state.selectedTitles[t.id] ? "Equipped " : "Removed ") + t.name + " — prompt updated."
    );
  }

  function clearAllTitles() {
    state.selectedTitles = {};
    persistSelectedTitles();
    renderTitleList();
    renderSelectedTitles();
    onLoadoutChanged("All movies & TV cleared — prompt updated.");
  }

  function persistSelectedCelebs() {
    try {
      localStorage.setItem(STORAGE_CELEBS, JSON.stringify(Object.keys(state.selectedCelebs)));
    } catch (_) {}
  }

  function loadSelectedCelebsFromStorage() {
    try {
      var raw = localStorage.getItem(STORAGE_CELEBS);
      if (!raw) return;
      var ids = JSON.parse(raw);
      if (!Array.isArray(ids)) return;
      state.selectedCelebs = {};
      ids.forEach(function (id) {
        var c = state.celebs.find(function (x) {
          return x.id === id;
        });
        if (c) state.selectedCelebs[id] = c;
      });
    } catch (_) {}
  }

  function selectedCelebsList() {
    return Object.keys(state.selectedCelebs).map(function (id) {
      return state.selectedCelebs[id];
    });
  }

  function normalizeCelebRow(row) {
    row = row || {};
    var name = String(row.name || "").trim();
    if (!name) return null;
    var id = String(row.id || name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "celeb";
    var icons = [];
    if (Array.isArray(row.icons)) {
      icons = row.icons
        .map(function (p) {
          return String(p || "").trim();
        })
        .filter(Boolean)
        .slice(0, 10);
    }
    var showcases = [];
    if (Array.isArray(row.showcases)) {
      showcases = row.showcases
        .map(function (p) {
          return String(p || "").trim();
        })
        .filter(Boolean)
        .slice(0, 8);
    } else if (typeof row.showcases === "string" && row.showcases.trim()) {
      showcases = row.showcases
        .split(",")
        .map(function (p) {
          return p.trim();
        })
        .filter(Boolean)
        .slice(0, 8);
    }
    return {
      id: id,
      name: name,
      category: String(row.category || "custom").trim().toLowerCase() || "custom",
      era: String(row.era || "contemporary").trim(),
      vibe: String(row.vibe || "").trim(),
      icons: icons,
      showcases: showcases,
      known_for: String(row.known_for || row.category || "").trim(),
      custom: !!row.custom,
    };
  }

  /**
   * What entertainment brands this celeb is pitching — equipped Movies & TV first,
   * else catalog showcases.
   */
  function celebShowcaseBrands(c, equippedTitles) {
    equippedTitles = equippedTitles || selectedTitlesList();
    if (equippedTitles.length) {
      return equippedTitles.map(function (t) {
        var safe = titleBrandForPrompt(t.name);
        return {
          name: t.name,
          safeName: safe.phrase,
          titleMode: safe.mode,
          kind: t.kind === "tv" ? "TV series brand" : "film brand",
          year: t.year,
          genre: t.genre,
        };
      });
    }
    return (c.showcases || []).map(function (name) {
      var safe = titleBrandForPrompt(name);
      return {
        name: name,
        safeName: safe.phrase,
        titleMode: safe.mode,
        kind: "entertainment brand",
        year: null,
        genre: "",
      };
    });
  }

  /**
   * Celeb as brand ambassador for movie/TV: they showcase the title brand in-world.
   * Title names: lowercase first; antonym if still moderation-flagged.
   */
  function celebSafePromptBrief(c, equippedTitles) {
    if (!c) return "";
    var vibe = c.vibe || "star presence";
    var icons = (c.icons || [])
      .map(softenMotifForModeration)
      .filter(Boolean)
      .slice(0, 3)
      .join(", ");
    var brands = celebShowcaseBrands(c, equippedTitles);
    var brandLine = brands.length
      ? brands
          .map(function (b) {
            return (
              (b.safeName || titleBrandPhrase(b.name)) +
              (b.year ? " (" + b.year + ")" : "") +
              " " +
              (b.kind || "entertainment brand")
            );
          })
          .join("; ")
      : "the equipped movie/TV entertainment brand";
    return (
      "Brand ambassador channeling " +
      c.name +
      " star-voltage (" +
      (c.era || "era") +
      " " +
      (c.category || "icon") +
      "): " +
      vibe +
      (icons ? "; red-carpet/set sparks: " + icons : "") +
      ". This figure SHOWCASES and sells the entertainment brand(s) " +
      brandLine +
      " as the hero product of the commercial — premiere campaign energy, title key-art as living signage, diegetic posters/marquees/props for that show or film, the star presenting the title-brand to the spell-world. Mint a singular original face with that voltage (new bone structure, invented couture) who exists to champion that movie/TV brand myth."
    );
  }

  function toggleCeleb(c) {
    if (!c || !c.id) return;
    if (state.selectedCelebs[c.id]) {
      delete state.selectedCelebs[c.id];
    } else {
      state.selectedCelebs[c.id] = c;
    }
    persistSelectedCelebs();
    renderCelebList();
    renderSelectedCelebs();
    onLoadoutChanged(
      (state.selectedCelebs[c.id] ? "Equipped " : "Removed ") + c.name + " — prompt updated."
    );
  }

  function clearAllCelebs() {
    state.selectedCelebs = {};
    persistSelectedCelebs();
    renderCelebList();
    renderSelectedCelebs();
    onLoadoutChanged("All celebrities cleared — prompt updated.");
  }

  function filteredCelebs() {
    var q = (($("co-celeb-search") && $("co-celeb-search").value) || "").trim().toLowerCase();
    return state.celebs.filter(function (c) {
      if (state.filterCelebCat !== "all" && c.category !== state.filterCelebCat) return false;
      if (!q) return true;
      var blob = [c.name, c.vibe, c.category, c.era, c.known_for, (c.icons || []).join(" ")]
        .join(" ")
        .toLowerCase();
      return blob.indexOf(q) >= 0;
    });
  }

  function renderCelebCategories() {
    var row = $("co-celeb-cats");
    if (!row) return;
    var cats = ["all"].concat(state.celebCategories || []);
    row.innerHTML = "";
    cats.forEach(function (c) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "co-cat-btn" + (state.filterCelebCat === c ? " active" : "");
      btn.textContent = c === "all" ? "All" : c;
      btn.addEventListener("click", function () {
        state.filterCelebCat = c;
        renderCelebCategories();
        renderCelebList();
      });
      row.appendChild(btn);
    });
  }

  function renderCelebList() {
    var list = $("co-celeb-list");
    if (!list) return;
    list.innerHTML = "";
    var rows = filteredCelebs();
    if (!rows.length) {
      list.innerHTML = '<p class="co-stage-empty" style="padding:0.75rem">No celebrities match.</p>';
      return;
    }
    rows.forEach(function (c) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        "co-brand-card co-celeb-card" + (state.selectedCelebs[c.id] ? " selected" : "");
      var poster = document.createElement("div");
      poster.className = "co-title-poster";
      poster.textContent = (c.category || "★").slice(0, 8).toUpperCase();
      var meta = document.createElement("div");
      meta.className = "co-brand-meta";
      meta.innerHTML = "<strong></strong><span></span><div class=\"co-brand-products\"></div>";
      meta.querySelector("strong").textContent = c.name;
      meta.querySelector("span").textContent =
        (c.category || "icon") + (c.era ? " · " + c.era : "");
      var prod = meta.querySelector(".co-brand-products");
      var show = (c.showcases || []).slice(0, 3).join(", ");
      var equipped = selectedTitlesList();
      if (equipped.length) {
        prod.textContent =
          "Showcases: " +
          equipped
            .map(function (t) {
              return t.name;
            })
            .slice(0, 3)
            .join(", ");
      } else {
        prod.textContent = show
          ? "Showcases: " + show
          : c.vibe || (c.icons || []).slice(0, 3).join(", ");
      }
      btn.appendChild(poster);
      btn.appendChild(meta);
      btn.title =
        c.name +
        (show ? " — showcases " + show : "") +
        (c.vibe ? " · " + c.vibe : "");
      btn.addEventListener("click", function () {
        toggleCeleb(c);
      });
      list.appendChild(btn);
    });
  }

  function renderSelectedCelebs() {
    var wrap = $("co-selected-celebs");
    if (!wrap) return;
    wrap.innerHTML = "";
    var list = selectedCelebsList();
    if (!list.length) {
      wrap.innerHTML =
        '<span class="co-selected-label" style="text-transform:none;letter-spacing:0">None — open Celebrities and click to equip</span>';
      return;
    }
    list.forEach(function (c) {
      var chip = document.createElement("button");
      chip.type = "button";
      chip.className = "co-brand-chip co-celeb-chip";
      chip.title = "Click to remove " + c.name;
      var kind = document.createElement("span");
      kind.style.cssText = "font-size:0.62rem;opacity:0.75;margin-right:0.25rem";
      kind.textContent = (c.category || "★").slice(0, 6).toUpperCase();
      var lab = document.createElement("span");
      lab.textContent = c.name;
      var x = document.createElement("span");
      x.className = "co-chip-x";
      x.setAttribute("aria-hidden", "true");
      x.textContent = "×";
      chip.appendChild(kind);
      chip.appendChild(lab);
      chip.appendChild(x);
      chip.addEventListener("click", function (e) {
        e.preventDefault();
        toggleCeleb(c);
      });
      wrap.appendChild(chip);
    });
  }

  function loadCelebs() {
    return fetch("data/commercial-celebrities.json?t=" + Date.now(), { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("celebs file");
        return r.json();
      })
      .then(function (d) {
        var base = ((d && d.celebrities) || []).map(normalizeCelebRow).filter(Boolean);
        var custom = [];
        try {
          custom = JSON.parse(localStorage.getItem(STORAGE_CUSTOM_CELEBS) || "[]");
          if (!Array.isArray(custom)) custom = [];
        } catch (_) {
          custom = [];
        }
        custom = custom.map(function (row) {
          return normalizeCelebRow(Object.assign({}, row, { custom: true }));
        }).filter(Boolean);
        state.celebs = base.concat(custom);
        var seen = {};
        state.celebCategories = [];
        state.celebs.forEach(function (c) {
          if (c.category && !seen[c.category]) {
            seen[c.category] = true;
            state.celebCategories.push(c.category);
          }
        });
        state.celebCategories.sort();
        loadSelectedCelebsFromStorage();
        renderCelebCategories();
        renderCelebList();
        renderSelectedCelebs();
      })
      .catch(function () {
        state.celebs = [];
        setStatus("Celebrities catalog missing (data/commercial-celebrities.json).", "error");
      });
  }

  function addCustomCeleb() {
    var nameEl = $("co-celeb-add-name");
    var vibeEl = $("co-celeb-add-vibe");
    var catEl = $("co-celeb-add-cat");
    var name = nameEl && nameEl.value.trim();
    if (!name) {
      setStatus("Enter a celebrity name.", "error");
      return;
    }
    var vibe = (vibeEl && vibeEl.value.trim()) || "iconic public presence";
    var category = (catEl && catEl.value) || "custom";
    var id =
      "custom-" +
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
    var showcaseEl = $("co-celeb-add-showcases");
    var showRaw = (showcaseEl && showcaseEl.value.trim()) || "";
    var showcases = showRaw
      ? showRaw
          .split(",")
          .map(function (p) {
            return p.trim();
          })
          .filter(Boolean)
      : [];
    var celeb = normalizeCelebRow({
      id: id,
      name: name,
      category: category,
      vibe: vibe,
      icons: [vibe],
      showcases: showcases,
      era: "contemporary",
      custom: true,
    });
    var custom = [];
    try {
      custom = JSON.parse(localStorage.getItem(STORAGE_CUSTOM_CELEBS) || "[]");
      if (!Array.isArray(custom)) custom = [];
    } catch (_) {
      custom = [];
    }
    custom = custom.filter(function (s) {
      return s && s.id !== id;
    });
    custom.push(celeb);
    try {
      localStorage.setItem(STORAGE_CUSTOM_CELEBS, JSON.stringify(custom));
    } catch (_) {}
    if (nameEl) nameEl.value = "";
    if (vibeEl) vibeEl.value = "";
    if (showcaseEl) showcaseEl.value = "";
    loadCelebs().then(function () {
      state.selectedCelebs[id] = state.celebs.find(function (x) {
        return x.id === id;
      });
      persistSelectedCelebs();
      renderCelebList();
      renderSelectedCelebs();
      onLoadoutChanged("Added " + name + " — prompt updated.");
    });
  }

  function normalizeTitleRow(row) {
    row = row || {};
    var name = String(row.name || "").trim();
    if (!name) return null;
    var id = String(row.id || name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "title";
    var icons = [];
    if (Array.isArray(row.icons)) {
      icons = row.icons
        .map(function (p) {
          return String(p || "").trim();
        })
        .filter(Boolean)
        .slice(0, 12);
    } else if (typeof row.icons === "string" && row.icons.trim()) {
      icons = row.icons
        .split(",")
        .map(function (p) {
          return p.trim();
        })
        .filter(Boolean)
        .slice(0, 12);
    }
    return {
      id: id,
      name: name,
      kind: row.kind === "tv" ? "tv" : "movie",
      year: parseInt(row.year, 10) || null,
      genre: String(row.genre || "other").trim().toLowerCase() || "other",
      imdb_id: String(row.imdb_id || row.imdb || "").trim(),
      icons: icons,
      description: String(row.description || "").trim(),
      custom: !!row.custom,
    };
  }

  function filteredTitles() {
    var q = (($("co-title-search") && $("co-title-search").value) || "").trim().toLowerCase();
    return state.titles.filter(function (t) {
      var cat = state.filterTitleCat || "all";
      if (cat === "movie" && t.kind !== "movie") return false;
      if (cat === "tv" && t.kind !== "tv") return false;
      if (cat !== "all" && cat !== "movie" && cat !== "tv" && t.genre !== cat) return false;
      if (!q) return true;
      var iconBlob = (t.icons || []).join(" ").toLowerCase();
      return (
        String(t.name || "")
          .toLowerCase()
          .indexOf(q) >= 0 ||
        String(t.genre || "")
          .toLowerCase()
          .indexOf(q) >= 0 ||
        String(t.imdb_id || "")
          .toLowerCase()
          .indexOf(q) >= 0 ||
        iconBlob.indexOf(q) >= 0 ||
        String(t.year || "").indexOf(q) >= 0
      );
    });
  }

  function renderTitleCategories() {
    var row = $("co-title-cats");
    if (!row) return;
    var cats = ["all", "movie", "tv"].concat(state.titleCategories || []);
    row.innerHTML = "";
    cats.forEach(function (c) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "co-cat-btn" + (state.filterTitleCat === c ? " active" : "");
      btn.textContent =
        c === "all" ? "All" : c === "movie" ? "Movies" : c === "tv" ? "TV" : c.replace(/-/g, " ");
      btn.addEventListener("click", function () {
        state.filterTitleCat = c;
        renderTitleCategories();
        renderTitleList();
      });
      row.appendChild(btn);
    });
  }

  function renderTitleList() {
    var list = $("co-title-list");
    if (!list) return;
    list.innerHTML = "";
    var rows = filteredTitles();
    if (!rows.length) {
      list.innerHTML = '<p class="co-stage-empty" style="padding:0.75rem">No titles match.</p>';
      return;
    }
    rows.forEach(function (t) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        "co-brand-card co-title-card" + (state.selectedTitles[t.id] ? " selected" : "");
      var poster = document.createElement("div");
      poster.className = "co-title-poster";
      poster.textContent = titlePosterLabel(t);
      poster.title = t.imdb_id ? "IMDb " + t.imdb_id : t.name;
      var meta = document.createElement("div");
      meta.className = "co-brand-meta";
      meta.innerHTML = "<strong></strong><span></span><div class=\"co-brand-products\"></div>";
      meta.querySelector("strong").textContent = t.name;
      meta.querySelector("span").textContent =
        (t.kind === "tv" ? "TV" : "Movie") +
        (t.year ? " · " + t.year : "") +
        (t.genre ? " · " + t.genre : "");
      var icons = titleIconsLine(t, 4);
      var prodEl = meta.querySelector(".co-brand-products");
      if (icons) {
        prodEl.textContent = icons;
        prodEl.title = ((t.icons || []) || []).join(" · ");
      } else {
        prodEl.hidden = true;
      }
      btn.appendChild(poster);
      btn.appendChild(meta);
      btn.title = t.name + (icons ? " — " + titleIconsLine(t, 8) : "");
      btn.addEventListener("click", function () {
        toggleTitle(t);
      });
      list.appendChild(btn);
    });
  }

  function renderSelectedTitles() {
    var wrap = $("co-selected-titles");
    if (!wrap) return;
    wrap.innerHTML = "";
    var list = selectedTitlesList();
    if (!list.length) {
      wrap.innerHTML =
        '<span class="co-selected-label" style="text-transform:none;letter-spacing:0">None — open Movies & TV and click to equip</span>';
      return;
    }
    list.forEach(function (t) {
      var chip = document.createElement("button");
      chip.type = "button";
      chip.className = "co-brand-chip co-title-chip";
      chip.title = "Click to remove " + t.name;
      chip.innerHTML =
        "<span class=\"co-title-chip-kind\"></span><span></span><span class=\"co-chip-x\" aria-hidden=\"true\">×</span>";
      chip.querySelector(".co-title-chip-kind").textContent = t.kind === "tv" ? "TV" : "FILM";
      chip.querySelector("span:not(.co-title-chip-kind):not(.co-chip-x)").textContent = t.name;
      // simpler: use text only
      chip.textContent = "";
      var kind = document.createElement("span");
      kind.className = "co-title-chip-kind";
      kind.textContent = t.kind === "tv" ? "TV" : "FILM";
      kind.style.cssText = "font-size:0.62rem;opacity:0.75;margin-right:0.25rem";
      var lab = document.createElement("span");
      lab.textContent = t.name;
      var x = document.createElement("span");
      x.className = "co-chip-x";
      x.setAttribute("aria-hidden", "true");
      x.textContent = "×";
      chip.appendChild(kind);
      chip.appendChild(lab);
      chip.appendChild(x);
      chip.addEventListener("click", function (e) {
        e.preventDefault();
        toggleTitle(t);
      });
      wrap.appendChild(chip);
    });
  }

  function loadTitles() {
    return fetch("data/commercial-titles.json?t=" + Date.now(), { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("titles file");
        return r.json();
      })
      .then(function (d) {
        var base = ((d && d.titles) || []).map(normalizeTitleRow).filter(Boolean);
        var custom = [];
        try {
          custom = JSON.parse(localStorage.getItem(STORAGE_CUSTOM_TITLES) || "[]");
          if (!Array.isArray(custom)) custom = [];
        } catch (_) {
          custom = [];
        }
        custom = custom.map(function (row) {
          return normalizeTitleRow(Object.assign({}, row, { custom: true }));
        }).filter(Boolean);
        state.titles = base.concat(custom);
        var seen = {};
        state.titleCategories = [];
        state.titles.forEach(function (t) {
          if (t.genre && !seen[t.genre]) {
            seen[t.genre] = true;
            state.titleCategories.push(t.genre);
          }
        });
        state.titleCategories.sort();
        loadSelectedTitlesFromStorage();
        renderTitleCategories();
        renderTitleList();
        renderSelectedTitles();
        setStatus(state.titles.length + " movies & TV in catalog.", "ok");
      })
      .catch(function () {
        state.titles = [];
        setStatus("Movies & TV catalog missing (data/commercial-titles.json).", "error");
      });
  }

  function addCustomTitle() {
    var nameEl = $("co-title-add-name");
    var iconsEl = $("co-title-add-icons");
    var kindEl = $("co-title-add-kind");
    var name = nameEl && nameEl.value.trim();
    if (!name) {
      setStatus("Enter a title name.", "error");
      return;
    }
    var iconsRaw = (iconsEl && iconsEl.value.trim()) || "";
    var icons = iconsRaw
      ? iconsRaw
          .split(",")
          .map(function (p) {
            return p.trim();
          })
          .filter(Boolean)
      : [];
    var kind = kindEl && kindEl.value === "tv" ? "tv" : "movie";
    var id =
      "custom-" +
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
    var title = normalizeTitleRow({
      id: id,
      name: name,
      kind: kind,
      genre: "custom",
      icons: icons.length ? icons : [name + " iconography"],
      custom: true,
    });
    var custom = [];
    try {
      custom = JSON.parse(localStorage.getItem(STORAGE_CUSTOM_TITLES) || "[]");
      if (!Array.isArray(custom)) custom = [];
    } catch (_) {
      custom = [];
    }
    custom = custom.filter(function (s) {
      return s && s.id !== id;
    });
    custom.push(title);
    try {
      localStorage.setItem(STORAGE_CUSTOM_TITLES, JSON.stringify(custom));
    } catch (_) {}
    if (nameEl) nameEl.value = "";
    if (iconsEl) iconsEl.value = "";
    loadTitles().then(function () {
      state.selectedTitles[id] = state.titles.find(function (x) {
        return x.id === id;
      });
      persistSelectedTitles();
      renderTitleList();
      renderSelectedTitles();
      setStatus("Added title " + name + ".", "ok");
    });
  }

  function paintingUrlForNum(num) {
    if (!num) return "";
    if (window.getPaintingUrl) return window.getPaintingUrl(num);
    return "paintings/" + num + ".jpg";
  }

  function styleRefCacheBust(url) {
    if (!url) return "";
    var u = String(url);
    if (u.indexOf("data:") === 0 || u.indexOf("blob:") === 0) return u;
    // Bust once per page load so rebaked style refs show after refresh
    var bust = window.__coStyleRefBust || (window.__coStyleRefBust = String(Date.now()));
    return u + (u.indexOf("?") >= 0 ? "&" : "?") + "v=" + bust;
  }

  function resolveStyleReference(style) {
    style = style || {};
    // UI thumbs only (gallery crops). Never soft-blended into generation reference.
    if (style.paintingNum) {
      return {
        url: absoluteUrl(styleRefCacheBust(paintingUrlForNum(style.paintingNum))),
        paintingNum: style.paintingNum,
        label: style.name,
        baked: false,
      };
    }
    if (style.refUrl) {
      return {
        url: absoluteUrl(styleRefCacheBust(style.refUrl)),
        paintingNum: style.paintingNum || null,
        label: style.name,
        baked: !!style.refBaked,
      };
    }
    if (style.id) {
      var baked = "assets/commercial-style-refs/" + style.id + ".jpg";
      return {
        url: absoluteUrl(styleRefCacheBust(baked)),
        paintingNum: style.paintingNum || null,
        label: style.name,
        baked: true,
      };
    }
    var keys = (style.keywords || []).map(function (k) {
      return String(k).toLowerCase();
    });
    keys.push(String(style.name || "").toLowerCase());
    var analyses = (window.galleryAnalyses || window.getGalleryAnalyses && window.getGalleryAnalyses()) || {};
    var best = null;
    var bestScore = 0;
    Object.keys(analyses).forEach(function (key) {
      var a = analyses[key];
      if (!a) return;
      var blob = [
        a.style,
        a.medium,
        a.mood,
        a.title,
        a.description,
        (a.tags || []).join(" "),
      ]
        .join(" ")
        .toLowerCase();
      var score = 0;
      keys.forEach(function (k) {
        if (k && blob.indexOf(k) >= 0) score += k.length > 4 ? 2 : 1;
      });
      if (score > bestScore) {
        bestScore = score;
        best = parseInt(key, 10) || a.number || null;
      }
    });
    if (best && bestScore > 0) {
      return { url: absoluteUrl(paintingUrlForNum(best)), paintingNum: best, label: style.name };
    }
    // Fallback: first painting in pool / #1
    var fallback = state.pool.find(function (p) {
      return p.source === "paintings" && p.paintingNum;
    });
    if (fallback) {
      return { url: absoluteUrl(fallback.url), paintingNum: fallback.paintingNum, label: style.name };
    }
    return { url: absoluteUrl(paintingUrlForNum(1)), paintingNum: 1, label: style.name };
  }

  function attachStyleRefs() {
    state.styles.forEach(function (s) {
      var ref = resolveStyleReference(s);
      s.refUrl = ref.url;
      s.refPaintingNum = ref.paintingNum;
    });
  }

  function loadArtStyles() {
    return fetch("data/commercial-art-styles.json?t=" + Date.now(), { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("styles file");
        return r.json();
      })
      .then(function (d) {
        var base = ((d && d.styles) || []).map(function (s) {
          return {
            id: s.id,
            name: s.name,
            category: s.category || "other",
            description: s.description || "",
            keywords: s.keywords || [],
            custom: false,
            paintingNum: s.paintingNum || null,
            refUrl: s.refUrl || "",
            refBaked: !!s.refBaked,
          };
        });
        var custom = [];
        try {
          custom = JSON.parse(localStorage.getItem(STORAGE_CUSTOM_STYLES) || "[]");
          if (!Array.isArray(custom)) custom = [];
        } catch (_) {
          custom = [];
        }
        custom = custom.map(function (s) {
          return {
            id: s.id || "custom-" + String(s.name || "style").toLowerCase().replace(/[^a-z0-9]+/g, "-"),
            name: s.name,
            category: s.category || "custom",
            description: s.description || "Custom art style.",
            keywords: s.keywords || [s.name],
            custom: true,
            paintingNum: s.paintingNum || null,
            refUrl: s.refUrl || "",
          };
        });
        // Ensure analyses loaded for matching
        var ready = window.loadGalleryData
          ? window.loadGalleryData()
          : Promise.resolve({});
        return ready.then(function () {
          state.styles = base.concat(custom);
          var seen = {};
          state.styleCategories = [];
          state.styles.forEach(function (s) {
            if (s.category && !seen[s.category]) {
              seen[s.category] = true;
              state.styleCategories.push(s.category);
            }
          });
          state.styleCategories.sort();
          attachStyleRefs();
          loadSelectedStylesFromStorage();
          renderStyleCategories();
          renderStyleList();
          renderSelectedStyles();
        });
      })
      .catch(function () {
        state.styles = [];
        setStatus("Art styles catalog missing (data/commercial-art-styles.json).", "error");
      });
  }

  function selectedStylesList() {
    return Object.keys(state.selectedStyles).map(function (id) {
      return state.selectedStyles[id];
    });
  }

  function toggleStyle(s) {
    if (!s || !s.id) return;
    if (state.selectedStyles[s.id]) {
      delete state.selectedStyles[s.id];
    } else {
      state.selectedStyles[s.id] = s;
    }
    persistSelectedStyles();
    renderStyleList();
    renderSelectedStyles();
    onLoadoutChanged(
      (state.selectedStyles[s.id] ? "Style " + s.name + " equipped" : "Removed style " + s.name) +
        " — prompt updated."
    );
  }

  function clearAllStyles() {
    state.selectedStyles = {};
    persistSelectedStyles();
    renderStyleList();
    renderSelectedStyles();
    onLoadoutChanged("All art styles cleared — prompt updated.");
  }

  function filteredStyles() {
    var q = (($("co-style-search") && $("co-style-search").value) || "").trim().toLowerCase();
    return state.styles.filter(function (s) {
      if (state.filterStyleCat !== "all" && s.category !== state.filterStyleCat) return false;
      if (!q) return true;
      return (
        String(s.name || "")
          .toLowerCase()
          .indexOf(q) >= 0 ||
        String(s.description || "")
          .toLowerCase()
          .indexOf(q) >= 0 ||
        String(s.category || "")
          .toLowerCase()
          .indexOf(q) >= 0
      );
    });
  }

  function renderStyleCategories() {
    var row = $("co-style-cats");
    if (!row) return;
    var cats = ["all"].concat(state.styleCategories || []);
    row.innerHTML = "";
    cats.forEach(function (c) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "co-cat-btn" + (state.filterStyleCat === c ? " active" : "");
      btn.textContent = c === "all" ? "All" : c.replace(/-/g, " ");
      btn.addEventListener("click", function () {
        state.filterStyleCat = c;
        renderStyleCategories();
        renderStyleList();
      });
      row.appendChild(btn);
    });
  }

  function renderStyleList() {
    var list = $("co-style-list");
    if (!list) return;
    list.innerHTML = "";
    var rows = filteredStyles();
    if (!rows.length) {
      list.innerHTML = '<p class="co-stage-empty" style="padding:0.75rem">No styles match.</p>';
      return;
    }
    rows.forEach(function (s) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        "co-brand-card co-style-card" + (state.selectedStyles[s.id] ? " selected" : "");
      var img = document.createElement("img");
      img.className = "co-style-ref";
      img.alt = "";
      img.loading = "lazy";
      img.src = s.refUrl || "";
      img.onerror = function () {
        img.style.background = "#2a3545";
      };
      var meta = document.createElement("div");
      meta.className = "co-brand-meta";
      var strong = document.createElement("strong");
      strong.textContent = s.name;
      var cat = document.createElement("span");
      cat.textContent =
        (s.category || "style") +
        (s.refPaintingNum || s.paintingNum
          ? " · gallery #" + (s.refPaintingNum || s.paintingNum)
          : "");
      var desc = document.createElement("div");
      desc.className = "co-style-desc";
      desc.textContent = s.description || "";
      meta.appendChild(strong);
      meta.appendChild(cat);
      meta.appendChild(desc);
      btn.appendChild(img);
      btn.appendChild(meta);
      btn.addEventListener("click", function () {
        toggleStyle(s);
      });
      list.appendChild(btn);
    });
  }

  function renderSelectedStyles() {
    var wrap = $("co-selected-styles");
    if (!wrap) return;
    wrap.innerHTML = "";
    var list = selectedStylesList();
    if (!list.length) {
      wrap.innerHTML =
        '<span class="co-selected-label" style="text-transform:none;letter-spacing:0">None — open Art styles and click to equip</span>';
      return;
    }
    list.forEach(function (s) {
      var chip = document.createElement("button");
      chip.type = "button";
      chip.className = "co-brand-chip co-style-chip";
      chip.title = "Click to remove " + s.name;
      chip.innerHTML = "<img alt=\"\" /><span></span><span class=\"co-chip-x\" aria-hidden=\"true\">×</span>";
      var img = chip.querySelector("img");
      img.src = s.refUrl || "";
      img.onerror = function () {
        img.style.opacity = "0.35";
      };
      chip.querySelector("span").textContent = s.name;
      chip.addEventListener("click", function (e) {
        e.preventDefault();
        toggleStyle(s);
      });
      wrap.appendChild(chip);
    });
  }

  function setLeftPanel(which) {
    if (which === "styles") state.leftPanel = "styles";
    else if (which === "titles") state.leftPanel = "titles";
    else if (which === "celebs") state.leftPanel = "celebs";
    else state.leftPanel = "brands";
    var pb = $("co-panel-brands");
    var pt = $("co-panel-titles");
    var pc = $("co-panel-celebs");
    var ps = $("co-panel-styles");
    if (pb) pb.hidden = state.leftPanel !== "brands";
    if (pt) pt.hidden = state.leftPanel !== "titles";
    if (pc) pc.hidden = state.leftPanel !== "celebs";
    if (ps) ps.hidden = state.leftPanel !== "styles";
    document.querySelectorAll("[data-co-left]").forEach(function (btn) {
      btn.classList.toggle("active", btn.getAttribute("data-co-left") === state.leftPanel);
    });
  }

  function addCustomStyle() {
    var nameEl = $("co-style-add-name");
    var descEl = $("co-style-add-desc");
    var name = nameEl && nameEl.value.trim();
    if (!name) {
      setStatus("Enter a style name.", "error");
      return;
    }
    var id =
      "custom-" +
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
    var style = {
      id: id,
      name: name,
      category: "custom",
      description: (descEl && descEl.value.trim()) || "Custom art style for commercial pieces.",
      keywords: [name],
      custom: true,
    };
    var ref = resolveStyleReference(style);
    style.refUrl = ref.url;
    style.refPaintingNum = ref.paintingNum;
    var custom = [];
    try {
      custom = JSON.parse(localStorage.getItem(STORAGE_CUSTOM_STYLES) || "[]");
      if (!Array.isArray(custom)) custom = [];
    } catch (_) {
      custom = [];
    }
    custom = custom.filter(function (s) {
      return s && s.id !== id;
    });
    custom.push(style);
    try {
      localStorage.setItem(STORAGE_CUSTOM_STYLES, JSON.stringify(custom));
    } catch (_) {}
    if (nameEl) nameEl.value = "";
    if (descEl) descEl.value = "";
    loadArtStyles().then(function () {
      state.selectedStyles[id] = state.styles.find(function (s) {
        return s.id === id;
      });
      persistSelectedStyles();
      renderStyleList();
      renderSelectedStyles();
      setStatus("Added style " + name + ".", "ok");
    });
  }

  function normalizeBrandRow(row) {
    row = row || {};
    var name = String(row.name || "").trim();
    if (!name) return null;
    var id = String(row.id || name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "brand";
    var domain = String(row.domain || "")
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .split("/")[0];
    var category = String(row.category || "custom").trim().toLowerCase() || "custom";
    var products = [];
    if (Array.isArray(row.products)) {
      products = row.products
        .map(function (p) {
          return String(p || "").trim();
        })
        .filter(Boolean)
        .slice(0, 12);
    } else if (typeof row.products === "string" && row.products.trim()) {
      products = row.products
        .split(",")
        .map(function (p) {
          return p.trim();
        })
        .filter(Boolean)
        .slice(0, 12);
    }
    return {
      id: id,
      name: name,
      domain: domain,
      category: category,
      products: products,
      custom: !!row.custom,
      logo_url:
        row.logo_url ||
        (domain
          ? apiUrl("/api/commercial-logo?domain=" + encodeURIComponent(domain))
          : apiUrl("/api/commercial-logo?name=" + encodeURIComponent(name))),
    };
  }

  function brandProductsLine(b, maxN) {
    maxN = maxN == null ? 5 : maxN;
    var list = (b && b.products) || [];
    if (!list.length) return "";
    return list.slice(0, maxN).join(", ");
  }

  /** Categories that are physical places / venues (not pure online/product-only brands). */
  var PLACE_BRAND_CATEGORIES = {
    "fast-food": true,
    restaurants: true,
    coffee: true,
    gym: true,
    retail: true,
    grocery: true,
    hotel: true,
    "gas-stations": true,
    banks: true, // branches / lobbies
    jewelers: true,
    apparel: true, // flagship stores
    "real-estate": true, // offices / showings
  };

  function brandIsPlace(b) {
    if (!b) return false;
    var cat = String(b.category || "").toLowerCase();
    if (PLACE_BRAND_CATEGORIES[cat]) return true;
    // Heuristic: names that imply a venue
    var n = String(b.name || "").toLowerCase();
    if (/\b(store|shop|market|cafe|café|restaurant|hotel|gym|fitness|bank|theater|theatre|club|salon|spa|clinic|pharmacy)\b/.test(n)) {
      return true;
    }
    return false;
  }

  function brandIndoorLine(b) {
    if (!brandIsPlace(b)) return "";
    var cat = String(b.category || "venue").replace(/-/g, " ");
    return (
      "INDOOR " +
      cat +
      " interior: stage " +
      b.name +
      " as an enclosed indoor place — ceiling, walls, floor, interior lighting, " +
      "inside the premises (lobby, aisle, dining room, studio floor, checkout, guest room, or sales floor). " +
      "Not an outdoor street facade as the main subject; not a parking lot hero shot. " +
      "If the spell-world is outdoors, grow an indoor pocket of this brand inside it (portal shop, pocket lobby, glass-roof arcade)."
    );
  }

  function brandPlacementBlurb(b) {
    var prods = brandProductsLine(b, 6);
    var indoor = brandIsPlace(b);
    var bits = [
      "Brand presence for " +
        b.name +
        (b.domain ? " (" + b.domain + ")" : "") +
        " (" +
        (b.category || "business") +
        "): keep the real logo geometry and brand colors accurate and legible as diegetic " +
        (indoor
          ? "interior signage, menu boards, ceiling banners, counter logos, and in-store landmarks."
          : "signage, marquees, livery, and landmarks."),
    ];
    if (indoor) {
      bits.push(brandIndoorLine(b));
    }
    if (prods) {
      bits.push(
        "PRODUCT PLACEMENT (required — show what " +
          b.name +
          " is known for, not only the logo): integrate recognizable products/services such as " +
          prods +
          (indoor
            ? " inside the indoor venue — on shelves, counters, tables, racks, plates, machines, or display cases within the enclosed space."
            : " as native objects in the spell world — held, worn, driven, eaten, packaged, displayed on shelves, pouring, glowing, monumental, or woven into architecture.") +
          " Products must read as the real-world items associated with this company."
      );
    } else {
      bits.push(
        "PRODUCT PLACEMENT: invent iconic real-world products/services this company is famous for and place them diegetically " +
          (indoor ? "inside the indoor brand space" : "in the world") +
          " alongside the logo."
      );
    }
    return bits.join(" ");
  }

  function applyBrandPayload(d, sourceLabel) {
    var raw = (d && d.brands) || (Array.isArray(d) ? d : []) || [];
    state.brands = raw.map(normalizeBrandRow).filter(Boolean);
    state.categories = (d && d.categories) || [];
    if (!state.categories.length) {
      var seen = {};
      state.brands.forEach(function (b) {
        if (b.category) seen[b.category] = true;
      });
      state.categories = Object.keys(seen).sort();
    }
    loadSelectedFromStorage();
    renderCategories();
    renderBrandList();
    renderSelectedLogos();
    setStatus(
      state.brands.length +
        " businesses in catalog" +
        (sourceLabel ? " (" + sourceLabel + ")" : "") +
        ".",
      "ok"
    );
  }

  function loadBrandsFromStaticFile() {
    return fetch("data/commercial-brands.json?t=" + Date.now(), { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("Static catalog HTTP " + r.status);
        return r.json();
      })
      .then(function (d) {
        applyBrandPayload(d, "offline file");
        // Merge custom brands file if present
        return fetch("data/commercial-brands-custom.json?t=" + Date.now(), {
          cache: "no-store",
        })
          .then(function (r2) {
            return r2.ok ? r2.json() : null;
          })
          .then(function (custom) {
            if (!custom || !custom.brands || !custom.brands.length) return;
            var byId = {};
            state.brands.forEach(function (b) {
              byId[b.id] = b;
            });
            custom.brands.forEach(function (row) {
              var b = normalizeBrandRow(Object.assign({}, row, { custom: true }));
              if (b) byId[b.id] = b;
            });
            state.brands = Object.keys(byId)
              .map(function (k) {
                return byId[k];
              })
              .sort(function (a, b) {
                return (a.category + a.name).localeCompare(b.category + b.name);
              });
            applyBrandPayload({ brands: state.brands }, "file + custom");
          })
          .catch(function () {});
      });
  }

  function loadBrands() {
    return fetchWithTimeout(apiUrl("/api/commercial-brands?t=" + Date.now()), { cache: "no-store" }, 20000)
      .then(function (r) {
        return parseApiResponse(r).then(function (d) {
          if (!r.ok || (d && d.error && !d.brands)) {
            throw new Error((d && d.error) || "API " + r.status);
          }
          applyBrandPayload(d, "api");
        });
      })
      .catch(function (err) {
        // Fallback: catalog JSON is static — show list even if server routes not restarted yet
        return loadBrandsFromStaticFile().catch(function () {
          setStatus(
            ((err && err.message) || "Could not load brand list") +
              " — restart start_server.bat so /api/commercial-brands is live.",
            "error"
          );
        });
      });
  }

  function renderCategories() {
    var row = $("co-cats");
    if (!row) return;
    var cats = ["all"].concat(state.categories || []);
    row.innerHTML = "";
    cats.forEach(function (c) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "co-cat-btn" + (state.filterCat === c ? " active" : "");
      btn.textContent = c === "all" ? "All" : c.replace(/-/g, " ");
      btn.addEventListener("click", function () {
        state.filterCat = c;
        renderCategories();
        renderBrandList();
      });
      row.appendChild(btn);
    });
  }

  function filteredBrands() {
    var q = (($("co-search") && $("co-search").value) || "").trim().toLowerCase();
    return state.brands.filter(function (b) {
      if (state.filterCat !== "all" && b.category !== state.filterCat) return false;
      if (!q) return true;
      var prodBlob = ((b.products || []) || []).join(" ").toLowerCase();
      return (
        String(b.name || "")
          .toLowerCase()
          .indexOf(q) >= 0 ||
        String(b.domain || "")
          .toLowerCase()
          .indexOf(q) >= 0 ||
        String(b.category || "")
          .toLowerCase()
          .indexOf(q) >= 0 ||
        prodBlob.indexOf(q) >= 0
      );
    });
  }

  function renderBrandList() {
    var list = $("co-brand-list");
    if (!list) return;
    list.innerHTML = "";
    var rows = filteredBrands();
    if (!rows.length) {
      list.innerHTML = '<p class="co-stage-empty" style="padding:0.75rem">No matches — add a business with +.</p>';
      return;
    }
    rows.forEach(function (b) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "co-brand-card" + (state.selected[b.id] ? " selected" : "");
      btn.dataset.id = b.id;
      var img = document.createElement("img");
      img.className = "co-brand-logo";
      img.alt = "";
      img.loading = "lazy";
      img.src = logoSrc(b);
      img.onerror = function () {
        img.style.background = "#2a3545";
        img.removeAttribute("src");
      };
      var meta = document.createElement("div");
      meta.className = "co-brand-meta";
      meta.innerHTML = "<strong></strong><span></span><div class=\"co-brand-products\"></div>";
      meta.querySelector("strong").textContent = b.name;
      meta.querySelector("span").textContent =
        (b.category || "custom") + (b.domain ? " · " + b.domain : "");
      var prodEl = meta.querySelector(".co-brand-products");
      var prods = brandProductsLine(b, 4);
      if (prods) {
        prodEl.textContent = prods;
        prodEl.title = ((b.products || []) || []).join(" · ");
      } else {
        prodEl.hidden = true;
      }
      btn.appendChild(img);
      btn.appendChild(meta);
      btn.title = b.name + (prods ? " — known for: " + brandProductsLine(b, 8) : "");
      btn.addEventListener("click", function () {
        toggleBrand(b);
      });
      list.appendChild(btn);
    });
  }

  function toggleBrand(b) {
    if (!b || !b.id) return;
    if (state.selected[b.id]) {
      delete state.selected[b.id];
    } else {
      state.selected[b.id] = b;
    }
    persistSelected();
    renderBrandList();
    renderSelectedLogos();
    onLoadoutChanged(
      (state.selected[b.id] ? "Selected " : "Deselected ") +
        (b.name || "brand") +
        " — prompt updated."
    );
  }

  function clearAllBrands() {
    state.selected = {};
    persistSelected();
    renderBrandList();
    renderSelectedLogos();
    onLoadoutChanged("All brands cleared — prompt updated.");
  }

  function selectedList() {
    return Object.keys(state.selected).map(function (id) {
      return state.selected[id];
    });
  }

  function renderSelectedLogos() {
    var wrap = $("co-selected-logos");
    if (!wrap) return;
    wrap.innerHTML = "";
    var list = selectedList();
    if (!list.length) {
      wrap.innerHTML = '<span class="co-selected-label" style="text-transform:none;letter-spacing:0">None selected — click a business to equip</span>';
      return;
    }
    list.forEach(function (b) {
      var chip = document.createElement("button");
      chip.type = "button";
      chip.className = "co-brand-chip";
      chip.title = "Click to deselect " + b.name;
      chip.innerHTML = "<img alt=\"\" /><span></span><span class=\"co-chip-x\" aria-hidden=\"true\">×</span>";
      var img = chip.querySelector("img");
      img.src = logoSrc(b);
      img.onerror = function () {
        img.style.opacity = "0.35";
      };
      chip.querySelector("span").textContent = b.name;
      chip.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        toggleBrand(b);
      });
      wrap.appendChild(chip);
    });
  }

  function addBusiness() {
    var nameEl = $("co-add-name");
    var domainEl = $("co-add-domain");
    var prodEl = $("co-add-products");
    var catEl = $("co-add-category");
    var name = nameEl && nameEl.value.trim();
    if (!name) {
      setStatus("Enter a business name.", "error");
      return;
    }
    var domain = domainEl && domainEl.value.trim();
    var productsRaw = (prodEl && prodEl.value.trim()) || "";
    var products = productsRaw
      ? productsRaw
          .split(",")
          .map(function (p) {
            return p.trim();
          })
          .filter(Boolean)
          .slice(0, 12)
      : [];
    var category = (catEl && catEl.value) || "custom";
    setStatus("Adding " + name + "…", "pending");
    fetchWithTimeout(
      apiUrl("/api/commercial-brands"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name,
          domain: domain,
          category: category,
          products: products,
        }),
      },
      30000
    )
      .then(function (r) {
        return parseApiResponse(r).then(function (d) {
          if (!r.ok || (d && d.ok === false)) {
            throw new Error((d && d.error) || "Could not add business");
          }
          return d.brand;
        });
      })
      .then(function (brand) {
        if (nameEl) nameEl.value = "";
        if (domainEl) domainEl.value = "";
        if (prodEl) prodEl.value = "";
        return loadBrands().then(function () {
          if (brand && brand.id) {
            var found = state.brands.find(function (b) {
              return b.id === brand.id;
            });
            if (found) {
              state.selected[found.id] = found;
              persistSelected();
              renderBrandList();
              renderSelectedLogos();
            }
          }
          setStatus(
            "Added " +
              name +
              (products.length ? " with product placement" : "") +
              " — logo loaded when domain resolves.",
            "ok"
          );
        });
      })
      .catch(function (err) {
        setStatus((err && err.message) || "Add failed.", "error");
      });
  }

  function spellKey(sp) {
    if (!sp) return "";
    if (sp.paintingNum) return "p:" + sp.paintingNum;
    if (sp.lod1Num) return "g:" + sp.lod1Num;
    if (sp.url) return "u:" + sp.url;
    return sp.label || "";
  }

  function loadSpellPool() {
    var pool = [];
    var p = window.loadGalleryData
      ? window.loadGalleryData()
      : Promise.resolve({ manifest: window.galleryManifest || [] });
    return p
      .then(function (data) {
        var manifest = (data && data.manifest) || window.galleryManifest || [];
        manifest.forEach(function (m) {
          var n = m.number;
          pool.push({
            paintingNum: n,
            lod1Num: null,
            label: "#" + n,
            url: window.getPaintingUrl ? window.getPaintingUrl(n) : "paintings/" + n + ".jpg",
            source: "paintings",
          });
        });
        // Generated stills + other acquired libraries
        return fetchWithTimeout(apiUrl("/api/gallery-assets?collection=generated&t=" + Date.now()), {
          cache: "no-store",
        }, 20000)
          .then(function (r) {
            return r.ok ? parseApiResponse(r) : { items: [] };
          })
          .then(function (d) {
            (d.items || d.files || d.assets || []).forEach(function (item) {
              var url = item.url || item.path || "";
              if (!url) return;
              var num = item.num || item.number || null;
              if (!num && url) {
                var m = String(url).match(/\/generated\/(\d+)\./i);
                if (m) num = parseInt(m[1], 10);
              }
              pool.push({
                paintingNum: null,
                lod1Num: num,
                label: num ? "Gen " + num : item.name || "Generated",
                url: url,
                source: "generated",
              });
            });
          })
          .catch(function () {});
      })
      .then(function () {
        return fetchWithTimeout(apiUrl("/api/acquired-images"), { cache: "no-store" }, 15000)
          .then(function (r) {
            return r.ok ? parseApiResponse(r) : { folders: [] };
          })
          .then(function (index) {
            var folders = ["lod1s", "saved-stasis", "saved-game-bosses"];
            (index.folders || []).forEach(function (f) {
              if (f && f.id && folders.indexOf(f.id) < 0) folders.push(f.id);
            });
            return Promise.all(
              folders.map(function (fid) {
                return fetchWithTimeout(
                  apiUrl("/api/acquired-images?folder=" + encodeURIComponent(fid)),
                  { cache: "no-store" },
                  15000
                )
                  .then(function (r) {
                    return r.ok ? parseApiResponse(r) : { files: [] };
                  })
                  .then(function (data) {
                    (data.files || []).forEach(function (file) {
                      if (!file.url) return;
                      // Prefer images for spell tray
                      if (file.content_type && String(file.content_type).indexOf("video") >= 0) return;
                      pool.push({
                        paintingNum: null,
                        lod1Num: null,
                        label: file.name || fid,
                        url: file.url,
                        source: fid === "lod1s" || fid.indexOf("generated") >= 0 ? "generated" : "acquired",
                      });
                    });
                  })
                  .catch(function () {});
              })
            );
          })
          .catch(function () {});
      })
      .then(function () {
        // de-dupe by url
        var seen = {};
        state.pool = pool.filter(function (sp) {
          var k = sp.url || spellKey(sp);
          if (!k || seen[k]) return false;
          seen[k] = true;
          return true;
        });
        shuffleTray();
      });
  }

  function poolFiltered() {
    if (state.poolFilter === "paintings") {
      return state.pool.filter(function (s) {
        return s.source === "paintings";
      });
    }
    if (state.poolFilter === "generated") {
      return state.pool.filter(function (s) {
        return s.source === "generated" || s.source === "acquired" || s.lod1Num;
      });
    }
    return state.pool.slice();
  }

  function shuffleTray() {
    var pool = poolFiltered();
    for (var i = pool.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = pool[i];
      pool[i] = pool[j];
      pool[j] = t;
    }
    state.tray = pool.slice(0, TRAY_SLICE);
    renderTray();
  }

  function renderTray() {
    var strip = $("co-spell-strip");
    var count = $("co-tray-count");
    if (count) {
      count.textContent =
        state.tray.length + " shown · " + poolFiltered().length + " in filter · " + state.pool.length + " total";
    }
    if (!strip) return;
    strip.innerHTML = "";
    state.tray.forEach(function (sp) {
      var el = document.createElement("div");
      el.className = "co-spell";
      el.dataset.source = sp.source || "";
      el.draggable = true;
      el.title = (sp.label || "") + (sp.source === "generated" ? " (generated)" : "");
      el.innerHTML = "<img alt=\"\" /><span></span>";
      el.querySelector("img").src = absoluteUrl(sp.url);
      el.querySelector("span").textContent = sp.label;
      el.addEventListener("dragstart", function (e) {
        e.dataTransfer.setData("text/plain", JSON.stringify(sp));
        e.dataTransfer.effectAllowed = "copy";
      });
      el.addEventListener("click", function () {
        equipSpell(sp);
      });
      strip.appendChild(el);
    });
  }

  /** Loadout changed — always rebuild auto prompt so adds are visible. */
  function onLoadoutChanged(msg) {
    state.promptDirty = false;
    renderApplied();
    renderWorldDetails();
    // Celeb cards show which titles they currently showcase
    if (typeof renderCelebList === "function") renderCelebList();
    if (typeof renderSelectedCelebs === "function") renderSelectedCelebs();
    refreshPromptPreview(true);
    if (msg) setStatus(msg, "ok");
  }

  function worldSpellPromptLine(sp, i) {
    var blurb = spellWorldBlurb(sp);
    var label = sp.label || (sp.paintingNum ? "#" + sp.paintingNum : "world");
    return "World " + (i + 1) + " (" + label + "): " + clipText(blurb, 220);
  }

  function equipSpell(sp) {
    if (!sp || (!sp.url && !sp.paintingNum)) return;
    var key = spellKey(sp);
    if (
      state.appliedSpells.some(function (x) {
        return spellKey(x) === key;
      })
    ) {
      setStatus("That world is already equipped.", "ok");
      return;
    }
    state.appliedSpells.push(sp);
    while (state.appliedSpells.length > MAX_WORLD_SPELLS) {
      state.appliedSpells.shift();
    }
    onLoadoutChanged(
      "World " +
        (sp.label || "spell") +
        " equipped (" +
        state.appliedSpells.length +
        "/" +
        MAX_WORLD_SPELLS +
        ") — prompt updated."
    );
  }

  function removeWorldAt(idx) {
    if (idx < 0 || idx >= state.appliedSpells.length) return;
    var sp = state.appliedSpells[idx];
    state.appliedSpells.splice(idx, 1);
    onLoadoutChanged(
      "Removed world " + (sp && sp.label ? sp.label : "") + " — prompt updated."
    );
  }

  function renderApplied() {
    var el = $("co-applied");
    if (!el) return;
    el.innerHTML = "";
    if (!state.appliedSpells.length) {
      el.innerHTML =
        '<span class="co-selected-label" style="text-transform:none;letter-spacing:0">No worlds — pick up to ' +
        MAX_WORLD_SPELLS +
        " tray spells (paintings / generated)</span>";
      return;
    }
    state.appliedSpells.forEach(function (sp, idx) {
      var chip = document.createElement("button");
      chip.type = "button";
      chip.className = "co-chip";
      chip.title = spellWorldBlurb(sp) + " — click to remove";
      if (sp.url) {
        var img = document.createElement("img");
        img.alt = "";
        img.src = absoluteUrl(sp.url);
        img.onerror = function () {
          img.remove();
        };
        chip.appendChild(img);
      }
      var lab = document.createElement("span");
      lab.textContent = (sp.label || "#" + (sp.paintingNum || "?")) + " ×";
      chip.appendChild(lab);
      chip.addEventListener("click", function () {
        removeWorldAt(idx);
      });
      el.appendChild(chip);
    });
  }

  function renderWorldDetails() {
    var wrap = $("co-world-detail");
    if (!wrap) return;
    wrap.innerHTML = "";
    var spells = state.appliedSpells || [];
    if (!spells.length) {
      wrap.innerHTML =
        '<p class="co-loadout-empty" style="margin:0;padding:0.35rem 0">Equip tray spells to inspect world blurbs and prompt lines here.</p>';
      return;
    }
    spells.forEach(function (sp, idx) {
      var card = document.createElement("div");
      card.className = "co-world-card";
      var img = document.createElement("img");
      img.alt = "";
      img.src = absoluteUrl(sp.url || "");
      img.onerror = function () {
        img.style.opacity = "0.3";
      };
      var meta = document.createElement("div");
      meta.className = "co-world-meta";
      var strong = document.createElement("strong");
      strong.textContent =
        "World " +
        (idx + 1) +
        " · " +
        (sp.label || "#" + (sp.paintingNum || "?")) +
        (sp.source ? " · " + sp.source : "");
      var blurb = document.createElement("div");
      blurb.className = "co-world-blurb";
      blurb.textContent = spellWorldBlurb(sp);
      var line = document.createElement("div");
      line.className = "co-world-prompt-line";
      line.textContent = "→ " + worldSpellPromptLine(sp, idx);
      meta.appendChild(strong);
      meta.appendChild(blurb);
      meta.appendChild(line);
      var rm = document.createElement("button");
      rm.type = "button";
      rm.className = "co-btn";
      rm.textContent = "Remove";
      rm.addEventListener("click", function () {
        removeWorldAt(idx);
      });
      card.appendChild(img);
      card.appendChild(meta);
      card.appendChild(rm);
      wrap.appendChild(card);
    });
  }

  function renderLoadoutLines() {
    var wrap = $("co-loadout-lines");
    var summary = $("co-loadout-summary");
    if (!wrap) return;
    wrap.innerHTML = "";
    var brands = selectedList();
    var titles = selectedTitlesList();
    var styles = selectedStylesList();
    var spells = state.appliedSpells || [];
    var celebsN = selectedCelebsList().length;
    if (summary) {
      summary.textContent =
        brands.length +
        " brand(s) · " +
        titles.length +
        " title(s) · " +
        celebsN +
        " celeb(s) · " +
        styles.length +
        " style(s) · " +
        spells.length +
        " world(s)";
    }
    function addLine(kind, text) {
      var row = document.createElement("div");
      row.className = "co-loadout-line";
      var k = document.createElement("span");
      k.className = "k";
      k.textContent = kind;
      var v = document.createElement("span");
      v.className = "v";
      v.textContent = text;
      row.appendChild(k);
      row.appendChild(v);
      wrap.appendChild(row);
    }
    var celebs = selectedCelebsList();
    if (!brands.length && !titles.length && !celebs.length && !styles.length && !spells.length) {
      wrap.innerHTML =
        '<div class="co-loadout-empty">Add brands, Movies & TV, celebrities, styles, or world spells — lines appear here and in stasis/prompt.</div>';
      return;
    }
    brands.forEach(function (b) {
      addLine("Brand", brandCompactLine(b));
      if (brandIsPlace(b)) {
        addLine("Indoor place", clipText(brandIndoorLine(b), 200));
      }
    });
    titles.forEach(function (t) {
      addLine(
        "Title mood",
        titleEraLabel(t.year) +
          " " +
          (t.genre || "drama") +
          " " +
          (t.kind === "tv" ? "TV" : "film") +
          " · " +
          t.name
      );
    });
    celebs.forEach(function (c) {
      var brands = celebShowcaseBrands(c);
      var brandNames = brands
        .map(function (b) {
          var safe = b.safeName || titleBrandPhrase(b.name);
          var tag =
            b.titleMode === "antonym"
              ? " [antonym]"
              : b.titleMode === "lower"
                ? " [lower]"
                : "";
          return (safe || b.name) + tag;
        })
        .join(", ");
      addLine(
        "Celeb showcase",
        c.name +
          " presents " +
          (brandNames || "movie/TV brand") +
          (c.vibe ? " · " + clipText(c.vibe, 80) : "")
      );
    });
    // Show title brand transforms (lowercase / antonym)
    selectedTitlesList().forEach(function (t) {
      var r = titleBrandForPrompt(t.name);
      addLine(
        "Title brand",
        t.name +
          " → " +
          (r.mode === "antonym" ? "ANTONYM: " : r.mode === "lower" ? "lower: " : "") +
          r.phrase
      );
    });
    styles.forEach(function (s) {
      addLine("Style", s.name + (s.description ? " — " + clipText(s.description, 100) : ""));
    });
    spells.forEach(function (sp, i) {
      addLine("World", worldSpellPromptLine(sp, i));
    });
    var brief = (($("co-prompt") && $("co-prompt").value) || "").trim();
    if (brief) addLine("Director", clipText(brief, 200));
  }

  function brandNamesLine() {
    return selectedList()
      .map(function (b) {
        return b.name;
      })
      .join(", ");
  }

  function productPlacementPromptLine() {
    var brands = selectedList();
    if (!brands.length) return "";
    return brands
      .map(function (b) {
        var p = brandProductsLine(b, 5);
        return p
          ? b.name + " products in-world: " + p + "."
          : b.name + " iconic products placed in-world.";
      })
      .join(" ");
  }

  function readPrefsFromUi() {
    var aspect = $("co-aspect");
    var duration = $("co-duration");
    if (aspect && aspect.value) state.aspect = aspect.value;
    if (duration && duration.value) state.duration = parseInt(duration.value, 10) || 10;
    try {
      localStorage.setItem(
        STORAGE_PREFS,
        JSON.stringify({
          mode: state.mode,
          aspect: state.aspect,
          duration: state.duration,
          poolFilter: state.poolFilter,
        })
      );
    } catch (_) {}
  }

  function loadPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(STORAGE_PREFS) || "{}");
      if (p.mode === "image" || p.mode === "video") state.mode = p.mode;
      if (p.aspect) state.aspect = p.aspect;
      if (p.duration) state.duration = p.duration;
      if (p.poolFilter) state.poolFilter = p.poolFilter;
    } catch (_) {}
  }

  function syncModeUi() {
    document.querySelectorAll("[data-co-mode]").forEach(function (btn) {
      btn.classList.toggle("active", btn.getAttribute("data-co-mode") === state.mode);
    });
    document.querySelectorAll("[data-co-pool]").forEach(function (btn) {
      btn.classList.toggle("active", btn.getAttribute("data-co-pool") === state.poolFilter);
    });
    var dur = $("co-duration-wrap");
    if (dur) dur.hidden = state.mode !== "video";
    var aspect = $("co-aspect");
    if (aspect) aspect.value = state.aspect;
    var duration = $("co-duration");
    if (duration) duration.value = String(state.duration);
    var gen = $("co-generate");
    if (gen) gen.textContent = state.mode === "video" ? "Generate video" : "Generate image";
  }

  function analysisForSpell(sp) {
    if (!sp) return null;
    if (sp.paintingNum && window.getGalleryAnalysis) {
      return window.getGalleryAnalysis(sp.paintingNum);
    }
    return null;
  }

  function spellWorldBlurb(sp) {
    var a = analysisForSpell(sp);
    var label = sp.label || (sp.paintingNum ? "painting #" + sp.paintingNum : "spell world");
    if (!a) return label + " as a fully realized imaginative world";
    var bits = [label];
    if (a.title) bits.push('"' + a.title + '"');
    if (a.description) bits.push(String(a.description).slice(0, 220));
    if (a.mood) bits.push("mood " + a.mood);
    if (a.style) bits.push(a.style + " style");
    if (a.colors && a.colors.length) bits.push("palette " + a.colors.slice(0, 4).join("/"));
    return bits.join(" — ");
  }

  function clipText(s, max) {
    s = String(s || "");
    if (s.length <= max) return s;
    return s.slice(0, Math.max(0, max - 1)).replace(/\s+\S*$/, "") + "…";
  }

  function brandCompactLine(b) {
    var prods = brandProductsLine(b, 3);
    var place = brandIsPlace(b) ? " · indoor place" : "";
    return b.name + (prods ? " (" + prods + ")" : "") + place;
  }

  /**
   * Imaginative generation text — vivid commercial fantasy, length-capped,
   * always inventing unique beings instead of cloning famous ones.
   */
  function composeCommercialPayload(userPrompt) {
    userPrompt = String(userPrompt || "").trim();
    var brands = selectedList().slice(0, MAX_BRANDS_IN_PROMPT);
    var titles = selectedTitlesList().slice(0, MAX_TITLES_IN_PROMPT);
    var celebs = selectedCelebsList().slice(0, MAX_CELEBS_IN_PROMPT);
    var styles = selectedStylesList().slice(0, MAX_STYLES_IN_PROMPT);
    var spells = (state.appliedSpells || []).slice(0, MAX_WORLDS_IN_PROMPT);

    var brandNames = brands
      .map(function (b) {
        return b.name;
      })
      .join(", ");
    var brandProducts = brands.map(brandCompactLine).join("; ");
    var placeBrands = brands.filter(brandIsPlace);
    var placeIndoorDirective = placeBrands.length
      ? "Place-type businesses are INDOOR-ORIENTED: stage " +
        placeBrands
          .map(function (b) {
            return b.name;
          })
          .join(", ") +
        " as enclosed interiors (ceiling, walls, floor, indoor light, aisles/counters/tables inside the venue). Prefer lobby, dining room, sales floor, gym floor, hotel corridor, café interior — not outdoor street façades or parking-lot hero shots. Spell-world outdoors may host these as indoor pocket realms."
      : "";
    var titleMoods = titles
      .map(function (t) {
        return (
          titleEraLabel(t.year) +
          " " +
          (t.genre || "drama") +
          " " +
          (t.kind === "tv" ? "prestige-TV" : "feature-film") +
          " dream-logic"
        );
      })
      .join(", ");
    var equippedTitlesForCelebs = selectedTitlesList();
    var celebEnergy = celebs
      .map(function (c) {
        return clipText(celebSafePromptBrief(c, equippedTitlesForCelebs), 280);
      })
      .join(" ");
    var showcaseTitlePack = (function () {
      var names = [];
      if (equippedTitlesForCelebs.length) {
        equippedTitlesForCelebs.forEach(function (t) {
          if (t.name) names.push(t.name);
        });
      } else {
        celebs.forEach(function (c) {
          (c.showcases || []).forEach(function (n) {
            if (names.indexOf(n) < 0) names.push(n);
          });
        });
      }
      // also include equipped titles even without celebs
      selectedTitlesList().forEach(function (t) {
        if (t.name && names.indexOf(t.name) < 0) names.push(t.name);
      });
      return titleBrandsListPhrase(names.slice(0, 8));
    })();
    var showcaseTitleNames = showcaseTitlePack.text;
    var titleBrandNotes = showcaseTitlePack.notes || [];
    var styleNames = styles
      .map(function (s) {
        return s.name + (s.description ? " (" + clipText(s.description, 60) + ")" : "");
      })
      .join("; ");
    var worldLabels = spells
      .map(function (sp) {
        return sp.label || (sp.paintingNum ? "#" + sp.paintingNum : "world");
      })
      .join(" + ");
    var worldBlurbs = spells
      .map(function (sp, i) {
        return worldSpellPromptLine(sp, i);
      })
      .join(" ");

    // Seed variation so repeated generates feel less template-y
    var seeds = [
      "Let brands bloom as living architecture and weather.",
      "Treat products as mythical artifacts the world itself grew.",
      "Stage a single impossible commercial myth — one breath, one light.",
      "Surreal partnership spectacle: wonder first, logo legible second.",
      "Dream-logic advertising: the storefront is a temple, the snack is a star.",
    ];
    var seed = seeds[(brands.length + titles.length + celebs.length + spells.length) % seeds.length];

    var stasisParts = [
      "Imaginative brands-in-worlds commercial fantasy — one continuous painting of partnership wonder.",
      seed,
      "Craft a single seamless frame: no collage panels, no letterbox, no stacked photos, no double exposure.",
    ];
    if (spells.length) {
      stasisParts.push(
        "Spell-world environment from " +
          worldLabels +
          (spells.length > 1
            ? ": braid them into one hybrid climate and architecture."
            : ": expand it into a full living realm.")
      );
      stasisParts.push(clipText(worldBlurbs, 700));
    } else {
      stasisParts.push(
        "Invent a bold impossible commercial realm — floating avenues, living signage, weather made of brand color."
      );
    }
    if (brands.length) {
      stasisParts.push(
        "Brand guests (true logos + signature products as diegetic wonders — temples, vehicles, feasts, monuments, neon fauna): " +
          brandProducts +
          "."
      );
      if (placeIndoorDirective) {
        stasisParts.push(placeIndoorDirective);
      }
      placeBrands.forEach(function (b) {
        var line = brandIndoorLine(b);
        if (line) stasisParts.push(clipText(line, 280));
      });
    }
    if (titles.length) {
      stasisParts.push(
        "Movie/TV entertainment brands in the air (" +
          titleMoods +
          (showcaseTitleNames ? "; title-brands: " + showcaseTitleNames : "") +
          ") — marquees, key-art weather, premiere myth as diegetic architecture."
      );
    }
    if (celebs.length) {
      stasisParts.push(
        "Celebrities as brand ambassadors SHOWCASE the movie/TV brand" +
          (showcaseTitleNames ? " (" + showcaseTitleNames + ")" : "") +
          " — red-carpet campaign inside the spell world, star presenting the title as the hero product: " +
          clipText(celebEnergy, 720) +
          "."
      );
    }
    if (styles.length) {
      stasisParts.push(
        "Paint the whole scene with this visual language as one coherent climate of light and texture: " +
          styleNames +
          "."
      );
    }
    if (userPrompt) {
      stasisParts.push("Director whisper: " + clipText(userPrompt, 300) + ".");
    }
    stasisParts.push(
      "Aspect " +
        state.aspect +
        ". Full bleed edge-to-edge. One light setup, one perspective, story-rich commercial magic."
    );
    var stasis = spellSuperMan(clipText(stasisParts.join(" "), MAX_STASIS_CHARS));

    var promptParts = [
      "Invent one continuous commercial myth-scene — inventive, surreal-capable, emotionally charged — not a bland product shot and not a collage.",
      worldLabels
        ? "The universe grows from " + worldLabels + "; make geography, weather, and materials feel alive."
        : "Invent a breathtaking commercial cosmos.",
      worldBlurbs ? clipText("World DNA: " + worldBlurbs, 420) : "",
      brandNames
        ? "Summon " +
          brandNames +
          " as living guests — logos accurate and legible as architecture/signage/livery; products as legendary objects the world worships or wears." +
          (placeIndoorDirective
            ? " Venue brands are indoor places: shoot inside the store/restaurant/gym/hotel/café — interior architecture and in-room product display."
            : "")
        : "",
      titleMoods || showcaseTitleNames
        ? "Entertainment brand identity for " +
          (showcaseTitleNames || titleMoods) +
          " lives as marquees, posters-as-architecture, and campaign weather (" +
          (titleMoods || "cinematic") +
          ")."
        : "",
      celebEnergy
        ? "Celebrity ambassadors showcase that movie/TV brand: " +
          clipText(celebEnergy, 420) +
          " The star is selling the show/film — not floating alone."
        : "",
      styleNames ? "Visual dialect: " + styleNames + " across the entire frame." : "",
      userPrompt ? "Obey this director note with flair: " + clipText(userPrompt, 220) : "",
      "No stacked frames, soft-light mush, or pasted posters. Full bleed " + state.aspect + ". Make it unforgettable.",
    ].filter(Boolean);
    var prompt = spellSuperMan(clipText(promptParts.join(" "), MAX_PROMPT_CHARS));

    var total = stasis.length + prompt.length;
    if (total > MAX_TOTAL_TEXT_CHARS) {
      var over = total - MAX_TOTAL_TEXT_CHARS;
      stasis = clipText(stasis, Math.max(900, stasis.length - over));
    }

    var buzz = [
      "imaginative commercial fantasy",
      "single seamless scene",
      "no collage",
      "full bleed",
      brandNames ? "diegetic brand wonders" : "",
      titleMoods ? "cinematic weather" : "",
      celebs.length ? "star energy homage" : "",
      styleNames ? styleNames.slice(0, 60) : "",
      "aspect " + state.aspect,
    ].filter(Boolean);

    var spellNums = spells
      .map(function (s) {
        return s.paintingNum;
      })
      .filter(Boolean)
      .slice(0, MAX_WORLD_SPELLS);

    var payload = {
      stasis: stasis,
      prompt: prompt,
      buzz_words: buzz,
      spells: spellNums,
      aspect_ratio: state.aspect,
      lengths: {
        stasis: stasis.length,
        prompt: prompt.length,
        total: stasis.length + prompt.length,
        brands: brands.length,
        titles: titles.length,
        celebs: celebs.length,
        styles: styles.length,
        worlds: spells.length,
        brandsTotal: selectedList().length,
        titlesTotal: selectedTitlesList().length,
        celebsTotal: selectedCelebsList().length,
        stylesTotal: selectedStylesList().length,
        worldsTotal: (state.appliedSpells || []).length,
      },
      worldLines: spells.map(function (sp, i) {
        return worldSpellPromptLine(sp, i);
      }),
      titleBrandNotes: titleBrandNotes,
    };
    state.lastPayload = payload;
    return payload;
  }

  /** @deprecated use composeCommercialPayload — kept for video short path */
  function buildStasis(userPrompt) {
    return getActivePayload(userPrompt).stasis;
  }

  /**
   * Heuristic terms that often trip image-API content moderation.
   * High = named mega-IP / adult / graphic; med = violence-adjacent.
   * Do not flag "copyright/copyrighted" — those words are banned from our prompts entirely.
   */
  var MOD_RULES = [
    {
      level: "high",
      // Flag "superman" but not "super-man" (hyphen form is preferred)
      re: /\b(batman|joker|superman|spiderman|spider-?man|iron\s*man|thanos|yoda|vader|darth|grogu|baby\s*yoda|mandalorian|elsa|olaf|mario|luigi|harry\s*potter|voldemort|hogwarts|gandalf|sauron|gollum|deadpool|wolverine|hulk|black\s*panther|wakanda|barbie|mickey|minnie|disney|marvel|dc\s*comics|lightsaber|death\s*star|millennium\s*falcon|avengers|infinity\s*gauntlet|jedi|sith|skywalker|chewbacca|grogu|pennywise|xenomorph|terminator|buzz\s*lightyear|spongebob|pikachu|pokemon|pokémon|inception|matrix|oppenheimer|dune|euphoria|wednesday|john\s*wick|top\s*gun|star\s*wars|star\s*trek|breaking\s*bad|stranger\s*things|squid\s*game|nazi|swastika|isis|porn|nude|naked|nsfw|explicit\s*sex|child\s*porn|underage|lolita)\b/gi,
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

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function scanModeration(text) {
    text = String(text || "");
    var hits = []; // {start,end,level,match}
    var seen = {};
    MOD_RULES.forEach(function (rule) {
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
    // drop overlaps (keep earlier / longer)
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

  function highlightModerationHtml(text) {
    text = String(text || "");
    var scan = scanModeration(text);
    if (!scan.hits.length) {
      return escapeHtml(text) + (text.slice(-1) === "\n" ? "\n" : "");
    }
    var out = "";
    var i = 0;
    scan.hits.forEach(function (h) {
      if (h.start > i) out += escapeHtml(text.slice(i, h.start));
      out +=
        '<mark class="co-hl-mark ' +
        (h.level === "high" ? "high" : "med") +
        '">' +
        escapeHtml(text.slice(h.start, h.end)) +
        "</mark>";
      i = h.end;
    });
    if (i < text.length) out += escapeHtml(text.slice(i));
    // keep trailing newline visible in pre
    if (text.slice(-1) === "\n") out += "\n";
    return out;
  }

  function charCountClass(n, max) {
    if (n > max) return "danger";
    if (n > max * 0.85) return "warn";
    return "ok";
  }

  function setCharCount(el, n, max) {
    if (!el) return;
    el.textContent = n + " / " + max;
    el.className = "co-char-count " + charCountClass(n, max);
  }

  function syncHlScroll(input, layer) {
    if (!input || !layer) return;
    layer.scrollTop = input.scrollTop;
    layer.scrollLeft = input.scrollLeft;
  }

  function updateFieldHighlight(inputId, layerId) {
    var input = $(inputId);
    var layer = $(layerId);
    if (!input || !layer) return;
    layer.innerHTML = highlightModerationHtml(input.value);
    syncHlScroll(input, layer);
  }

  function renderModFlags(stasisText, promptText) {
    var wrap = $("co-mod-flags");
    if (!wrap) return { high: 0, med: 0 };
    var combined = stasisText + "\n" + promptText;
    var scan = scanModeration(combined);
    wrap.innerHTML = "";
    if (!scan.flags.length) {
      var ok = document.createElement("span");
      ok.className = "co-mod-flag ok-msg";
      ok.textContent = "No common moderation triggers detected";
      wrap.appendChild(ok);
      return { high: 0, med: 0 };
    }
    var high = 0;
    var med = 0;
    scan.flags.forEach(function (f) {
      if (f.level === "high") high++;
      else med++;
      var chip = document.createElement("span");
      chip.className = "co-mod-flag" + (f.level === "med" ? " med" : "");
      chip.title =
        (f.level === "high" ? "High risk" : "Medium risk") +
        " — often blocked by image content moderation";
      chip.innerHTML =
        escapeHtml(f.match) +
        (f.n > 1 ? "<em>×" + f.n + "</em>" : "") +
        (f.level === "high" ? " <em>high</em>" : " <em>med</em>");
      wrap.appendChild(chip);
    });
    return { high: high, med: med };
  }

  function readEditorPayload() {
    var stasisEl = $("co-stasis-edit");
    var promptEl = $("co-prompt-edit");
    var stasis = stasisEl ? stasisEl.value : "";
    var prompt = promptEl ? promptEl.value : "";
    return {
      stasis: stasis,
      prompt: prompt,
      buzz_words: (state.lastPayload && state.lastPayload.buzz_words) || [],
      spells: (state.lastPayload && state.lastPayload.spells) || [],
      aspect_ratio: state.aspect,
      lengths: {
        stasis: stasis.length,
        prompt: prompt.length,
        total: stasis.length + prompt.length,
      },
      manual: true,
    };
  }

  function getActivePayload(userPrompt) {
    if (state.promptDirty) {
      var manual = readEditorPayload();
      // keep spell nums from last compose if available
      if (state.lastPayload) {
        manual.spells = state.lastPayload.spells;
        manual.buzz_words = state.lastPayload.buzz_words;
        manual.aspect_ratio = state.lastPayload.aspect_ratio || state.aspect;
      }
      state.lastPayload = manual;
      return manual;
    }
    return composeCommercialPayload(userPrompt);
  }

  function writeEditorFromPayload(p) {
    var stasisEl = $("co-stasis-edit");
    var promptEl = $("co-prompt-edit");
    if (stasisEl) stasisEl.value = spellSuperMan((p && p.stasis) || "");
    if (promptEl) promptEl.value = spellSuperMan((p && p.prompt) || "");
    updateFieldHighlight("co-stasis-edit", "co-stasis-hl");
    updateFieldHighlight("co-prompt-edit", "co-prompt-hl");
    updatePromptMeta();
  }

  function updatePromptMeta() {
    var stasisEl = $("co-stasis-edit");
    var promptEl = $("co-prompt-edit");
    var stasis = stasisEl ? stasisEl.value : "";
    var prompt = promptEl ? promptEl.value : "";
    var sLen = stasis.length;
    var pLen = prompt.length;
    var total = sLen + pLen;
    setCharCount($("co-stasis-count"), sLen, MAX_STASIS_CHARS);
    setCharCount($("co-prompt-count"), pLen, MAX_PROMPT_CHARS);
    var totalEl = $("co-total-count");
    if (totalEl) {
      totalEl.textContent = "total " + total + " / " + MAX_TOTAL_TEXT_CHARS;
      totalEl.className = "co-char-count " + charCountClass(total, MAX_TOTAL_TEXT_CHARS);
    }
    var flags = renderModFlags(stasis, prompt);
    var meta = $("co-prompt-meta");
    if (meta) {
      var parts = [
        "stasis " + sLen,
        "prompt " + pLen,
        "total " + total,
        state.promptDirty ? "edited" : "auto",
      ];
      if (flags.high) parts.push(flags.high + " high-risk");
      if (flags.med) parts.push(flags.med + " med-risk");
      var notes = (state.lastPayload && state.lastPayload.titleBrandNotes) || [];
      if (notes.length) {
        var antN = notes.filter(function (n) {
          return String(n).indexOf("antonym") >= 0;
        }).length;
        var lowN = notes.length - antN;
        if (lowN) parts.push(lowN + " title(s) lowercase");
        if (antN) parts.push(antN + " title antonym(s)");
      }
      if (total > MAX_TOTAL_TEXT_CHARS) parts.push("OVER LIMIT");
      else if (flags.high) parts.push("moderation risk");
      else parts.push("OK");
      meta.textContent = parts.join(" · ");
      var cls = "co-prompt-meta ok";
      if (flags.high || total > MAX_TOTAL_TEXT_CHARS) cls = "co-prompt-meta danger";
      else if (flags.med || total > MAX_TOTAL_TEXT_CHARS * 0.85) cls = "co-prompt-meta warn";
      meta.className = cls;
    }
  }

  function refreshPromptPreview(force) {
    var editor = $("co-prompt-editor");
    var meta = $("co-prompt-meta");
    if (!editor && !meta) return;

    // Always refresh loadout lines + world cards (even if text is manually locked)
    renderLoadoutLines();
    renderWorldDetails();

    if (!state.promptDirty || force) {
      var userPrompt = (($("co-prompt") && $("co-prompt").value) || "").trim();
      var p = composeCommercialPayload(userPrompt);
      writeEditorFromPayload(p);
      state.promptDirty = false;
    } else {
      updateFieldHighlight("co-stasis-edit", "co-stasis-hl");
      updateFieldHighlight("co-prompt-edit", "co-prompt-hl");
      updatePromptMeta();
    }
  }

  function onEditorInput() {
    state.promptDirty = true;
    // Normalize Superman spelling as the user types / pastes
    ["co-stasis-edit", "co-prompt-edit"].forEach(function (id) {
      var el = $(id);
      if (!el) return;
      var next = spellSuperMan(el.value);
      if (next !== el.value) {
        var start = el.selectionStart;
        var end = el.selectionEnd;
        el.value = next;
        try {
          el.setSelectionRange(start, end);
        } catch (_) {}
      }
    });
    updateFieldHighlight("co-stasis-edit", "co-stasis-hl");
    updateFieldHighlight("co-prompt-edit", "co-prompt-hl");
    updatePromptMeta();
    // keep lastPayload in sync for generate
    state.lastPayload = readEditorPayload();
    if (state.lastPayload && state.lastPayload.spells === undefined) {
      /* spells filled in getActivePayload */
    }
  }

  function setEditorOpen(open) {
    state.editorOpen = !!open;
    var editor = $("co-prompt-editor");
    var toggleBtn = $("co-prompt-toggle");
    if (editor) editor.hidden = !state.editorOpen;
    if (toggleBtn) toggleBtn.textContent = state.editorOpen ? "Hide" : "Show";
    if (state.editorOpen) {
      // Opening editor always syncs loadout lines; keep manual text if dirty
      renderLoadoutLines();
      renderWorldDetails();
      renderCelebList(); // refresh "Showcases:" lines if titles changed
      if (!state.promptDirty) refreshPromptPreview(true);
      else {
        updateFieldHighlight("co-stasis-edit", "co-stasis-hl");
        updateFieldHighlight("co-prompt-edit", "co-prompt-hl");
        updatePromptMeta();
      }
    }
  }

  function loadLogoDataUrl(brand) {
    var url = logoSrc(brand);
    return fetch(url, { cache: "force-cache" })
      .then(function (r) {
        if (!r.ok) throw new Error("logo");
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
        return "";
      });
  }

  function aspectCanvasSize(aspect) {
    var parts = String(aspect || "1:1").split(":");
    var aw = parseFloat(parts[0]) || 1;
    var ah = parseFloat(parts[1]) || 1;
    var maxSide = 1280;
    if (aw >= ah) {
      return { w: maxSide, h: Math.max(1, Math.round(maxSide * (ah / aw))) };
    }
    return { w: Math.max(1, Math.round(maxSide * (aw / ah))), h: maxSide };
  }

  function loadImageEl(url) {
    return new Promise(function (resolve) {
      if (!url) return resolve(null);
      var img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = function () {
        resolve(img);
      };
      img.onerror = function () {
        resolve(null);
      };
      img.src = absoluteUrl(url);
    });
  }

  function drawCover(ctx, img, dx, dy, dw, dh, alpha) {
    if (!img) return;
    var iw = img.naturalWidth || img.width || 1;
    var ih = img.naturalHeight || img.height || 1;
    var sc = Math.max(dw / iw, dh / ih);
    var tw = iw * sc;
    var th = ih * sc;
    ctx.save();
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.drawImage(img, dx + (dw - tw) / 2, dy + (dh - th) / 2, tw, th);
    ctx.restore();
  }

  /**
   * Clean world reference for the image model.
   * - 1 world: full-bleed cover of that spell
   * - 2–3 worlds: clean side-by-side strips (no soft-light / overlay mush)
   * Multi-world fusion is also driven by spells[] + prompt text.
   * Logos/styles stay text-only — never composited here.
   */
  function buildCleanWorldReference() {
    var urls = (state.appliedSpells || [])
      .map(function (s) {
        return s && s.url;
      })
      .filter(Boolean)
      .slice(0, MAX_WORLD_SPELLS);
    if (!urls.length) return Promise.resolve("");

    return Promise.all(urls.map(loadImageEl)).then(function (imgs) {
      var worlds = (imgs || []).filter(Boolean);
      if (!worlds.length) return "";
      var size = aspectCanvasSize(state.aspect);
      var W = size.w;
      var H = size.h;
      var canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      var ctx = canvas.getContext("2d");
      if (!ctx) return "";
      ctx.fillStyle = "#0a0c12";
      ctx.fillRect(0, 0, W, H);

      if (worlds.length === 1) {
        drawCover(ctx, worlds[0], 0, 0, W, H, 1);
      } else {
        // Clean vertical strips — source-over only, no blend modes
        var n = worlds.length;
        var stripW = Math.floor(W / n);
        worlds.forEach(function (img, i) {
          var x = i * stripW;
          var w = i === n - 1 ? W - x : stripW;
          drawCover(ctx, img, x, 0, w, H, 1);
        });
      }
      return canvas.toDataURL("image/jpeg", 0.9);
    });
  }

  function updateSellButton() {
    var sell = $("co-sell");
    if (!sell) return;
    var has = !!(state.imageUrl || state.videoUrl);
    sell.hidden = !has;
    sell.disabled = !has;
  }

  function updateSaveButtons() {
    var saveImg = $("co-save-image");
    var saveVid = $("co-save-video");
    if (saveImg) {
      saveImg.disabled = !state.imageUrl;
      saveImg.hidden = false;
    }
    if (saveVid) {
      saveVid.disabled = !state.videoUrl;
      saveVid.hidden = false;
    }
  }

  function showStill(url) {
    state.imageUrl = url;
    state.videoUrl = "";
    state.savedVideoNum = null;
    if (!url || String(url).indexOf("/generated/") < 0) {
      state.savedImageNum = null;
    }
    var img = $("co-preview");
    var vid = $("co-preview-video");
    var empty = $("co-empty");
    if (vid) {
      vid.pause();
      vid.removeAttribute("src");
      vid.hidden = true;
    }
    if (img) {
      img.src = url;
      img.hidden = false;
    }
    if (empty) empty.hidden = true;
    updateSellButton();
    updateSaveButtons();
  }

  function showVideo(url) {
    state.videoUrl = url;
    var img = $("co-preview");
    var vid = $("co-preview-video");
    var empty = $("co-empty");
    if (img) img.hidden = true;
    if (vid) {
      vid.src = absoluteUrl(url);
      vid.hidden = false;
      vid.play().catch(function () {});
    }
    if (empty) empty.hidden = true;
    updateSellButton();
    updateSaveButtons();
  }

  /**
   * Persist still into gallery/generated/N so it appears under Gallery → Generated.
   * Remote xAI URLs expire — always save while the link is still valid.
   */
  function saveStillToGallery(url, opts) {
    opts = opts || {};
    url = url || state.imageUrl;
    if (!url) return Promise.reject(new Error("No still to save."));
    if (!opts.force && /\/generated\/\d+\./i.test(String(url))) {
      var m = String(url).match(/\/generated\/(\d+)\./i);
      state.savedImageNum = m ? parseInt(m[1], 10) : state.savedImageNum;
      return Promise.resolve({
        ok: true,
        already_saved: true,
        num: state.savedImageNum,
        url: url,
      });
    }
    var brands = brandNamesLine() || "";
    var title =
      "Commercial — " +
      (brands || "piece").slice(0, 80) +
      (titlesSafeShortLine() ? " · " + titlesSafeShortLine().slice(0, 40) : "");
    var payload = {
      image_url: absoluteUrl(url),
      source: "commercial",
      collection: "generated",
      description: title,
      meta: {
        brands: brands,
        titles: titlesSafeShortLine(),
        celebs: selectedCelebsList()
          .map(function (c) {
            return c.name || c.id || "";
          })
          .filter(Boolean)
          .join(", ")
          .slice(0, 120),
        aspect: state.aspect,
        spells: (state.appliedSpells || [])
          .map(function (s) {
            return s.paintingNum;
          })
          .filter(Boolean),
      },
    };
    // Prefer base64 for data URLs / when local fetch of remote may fail
    var chain = Promise.resolve(null);
    if (String(url).indexOf("data:") === 0) {
      payload.image_base64 = url;
      delete payload.image_url;
    } else if (opts.asDataUrl) {
      chain = imageUrlToDataUrl(url).then(function (dataUrl) {
        if (dataUrl) {
          payload.image_base64 = dataUrl;
          delete payload.image_url;
        }
      });
    }
    return chain
      .then(function () {
        return fetchWithTimeout(
          apiUrl("/api/save-generated-image"),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          },
          120000
        );
      })
      .then(function (r) {
        return parseApiResponse(r).then(function (d) {
          if (!r.ok || (d && d.ok === false)) {
            throw new Error((d && d.error) || "Save image failed (" + r.status + ")");
          }
          return d;
        });
      })
      .then(function (d) {
        if (d && d.url) {
          state.savedImageNum = d.num != null ? d.num : state.savedImageNum;
          var local = absoluteUrl(d.url);
          state.imageUrl = local;
          var img = $("co-preview");
          if (img && !state.videoUrl) img.src = local;
          updateSaveButtons();
        }
        return d;
      });
  }

  function saveVideoToGallery(url) {
    url = url || state.videoUrl;
    if (!url) return Promise.reject(new Error("No video to save."));
    if (window.GallerySaveVideo && window.GallerySaveVideo.save) {
      return window.GallerySaveVideo.save(url, { force: true, timeoutMs: 180000 }).then(function (saved) {
        if (!saved || !saved.ok) {
          throw new Error((saved && saved.error) || "Video save failed — is start_server.bat running?");
        }
        state.savedVideoNum = saved.num != null ? saved.num : state.savedVideoNum;
        if (saved.url) {
          var local = absoluteUrl(saved.url);
          state.videoUrl = local;
          var vid = $("co-preview-video");
          if (vid) {
            vid.src = local;
          }
        }
        updateSaveButtons();
        return saved;
      });
    }
    return fetchWithTimeout(
      apiUrl("/api/save-video"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: absoluteUrl(url), force_mp4: true }),
      },
      180000
    ).then(function (r) {
      return parseApiResponse(r).then(function (d) {
        if (!r.ok || (d && d.ok === false)) {
          throw new Error((d && d.error) || "Video save failed");
        }
        if (d && d.url) {
          state.videoUrl = absoluteUrl(d.url);
          state.savedVideoNum = d.num;
        }
        updateSaveButtons();
        return d;
      });
    });
  }

  function sellCurrentCommercial() {
    var url = state.imageUrl || state.videoUrl;
    if (!url) {
      setStatus("Generate a piece first, then sell it.", "error");
      return;
    }
    if (!window.GalleryShop || !window.GalleryShop.sellCurrentImage) {
      setStatus("Shop not loaded — open Gallery tab once, then retry.", "error");
      return;
    }
    var brands = brandNamesLine() || "Commercial";
    var ok = window.GalleryShop.sellCurrentImage(url, {
      collection: state.videoUrl ? "videos" : "commercial",
      title: "Commercial — " + brands.slice(0, 48),
      subtitle: state.mode === "video" ? "Video campaign still" : "Brands in Worlds still",
      stamp: Date.now(),
    });
    if (ok) setStatus("Added to cart — complete Cash App checkout to earn money for credits.", "ok");
    else setStatus("Could not add to cart.", "error");
  }

  function generateStill(pack, userPrompt) {
    var jobId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : "co-" + Date.now();
    var composed = getActivePayload(userPrompt);
    // Re-attach spell numbers if manual edit lost them
    if (!composed.spells || !composed.spells.length) {
      composed.spells = (state.appliedSpells || [])
        .map(function (s) {
          return s.paintingNum;
        })
        .filter(Boolean)
        .slice(0, MAX_WORLD_SPELLS);
    }
    if (!composed.buzz_words || !composed.buzz_words.length) {
      composed.buzz_words = ["single scene", "no collage", "full bleed", "aspect " + state.aspect];
    }
    composed.aspect_ratio = composed.aspect_ratio || state.aspect;
    // Soft cap if user edited past limits; always super-man not Superman
    composed.stasis = spellSuperMan(clipText(composed.stasis, MAX_STASIS_CHARS + 400));
    composed.prompt = spellSuperMan(clipText(composed.prompt, MAX_PROMPT_CHARS + 200));
    composed.lengths = {
      stasis: composed.stasis.length,
      prompt: composed.prompt.length,
      total: composed.stasis.length + composed.prompt.length,
    };
    state.lastPayload = composed;
    refreshPromptPreview();
    var flags = scanModeration(composed.stasis + "\n" + composed.prompt);
    var highRisk = flags.flags.some(function (f) {
      return f.level === "high";
    });
    setStatus(
      "Sending generate… stasis " +
        composed.lengths.stasis +
        " + prompt " +
        composed.lengths.prompt +
        " = " +
        composed.lengths.total +
        " chars" +
        (composed.manual || state.promptDirty ? " (manual)" : "") +
        (highRisk ? " · high-risk terms still present" : ""),
      highRisk ? "error" : "pending"
    );
    var body = {
      job_id: jobId,
      stasis: composed.stasis,
      prompt: composed.prompt,
      buzz_words: composed.buzz_words,
      spells: composed.spells,
      aspect_ratio: composed.aspect_ratio,
      mag_fresh: true,
      spell_cast: true,
      fresh_variation: true,
    };
    // Clean world-only reference (no logo/style composites)
    if (pack && pack.worldRef) {
      body.reference_image = pack.worldRef;
      body.spell_reference_image = pack.worldRef;
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
          return pollImageJob((d && d.job_id) || "");
        });
      }
      return parseApiResponse(r).then(function (d) {
        if (!r.ok) throw new Error((d && d.error) || "Generate failed");
        var img = d.image || (d.images && d.images[0]);
        if (img && img.url) return absoluteUrl(img.url);
        if (d.job_id) return pollImageJob(d.job_id);
        throw new Error("No image returned.");
      });
    });
  }

  function imageUrlToDataUrl(url) {
    if (!url) return Promise.resolve("");
    if (String(url).indexOf("data:") === 0) return Promise.resolve(url);
    return fetch(absoluteUrl(url), { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("Image fetch failed");
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
      });
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
        resolve(canvas.toDataURL("image/jpeg", quality || 0.88));
      };
      img.onerror = function () {
        resolve(dataUrl);
      };
      img.src = dataUrl;
    });
  }

  function delay(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function yieldToUi() {
    return delay(0);
  }

  function formatElapsed(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    var m = Math.floor(s / 60);
    s = s % 60;
    return m > 0 ? m + "m " + s + "s" : s + "s";
  }

  function pollVideoJob(jobId, startedAt) {
    startedAt = startedAt || Date.now();
    if (Date.now() - startedAt > VIDEO_POLL_MAX_MS) {
      return Promise.reject(
        new Error("Video timed out after " + formatElapsed(VIDEO_POLL_MAX_MS) + ". Try a shorter duration.")
      );
    }
    return fetchWithTimeout(apiUrl("/api/jobs/" + jobId), { cache: "no-store" }, 30000)
      .then(function (r) {
        return parseApiResponse(r);
      })
      .then(function (job) {
        var st = String((job && job.status) || "working").toLowerCase();
        var elapsed = formatElapsed(Date.now() - startedAt);
        setStatus(
          "Animating video… " + st + " · " + elapsed + " (UI stays live — please wait)",
          "pending"
        );
        if (st === "done" || st === "completed" || st === "success") {
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
        if (st === "failed" || st === "error" || st === "expired") {
          throw new Error(
            (job.error && (job.error.message || job.error)) || "Video generation failed."
          );
        }
        return delay(VIDEO_POLL_MS).then(function () {
          return pollVideoJob(jobId, startedAt);
        });
      });
  }

  /**
   * Image-to-life without wait_for_result — long blocking HTTP freezes the tab.
   * Submit job, poll /api/jobs, show elapsed progress.
   */
  function generateVideoFromStill(imageUrl, userPrompt) {
    setStatus("Preparing still for animation…", "pending");
    var jobId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : "co-vid-" + Date.now();
    var startedAt = Date.now();
    return yieldToUi()
      .then(function () {
        return imageUrlToDataUrl(imageUrl);
      })
      .then(function (raw) {
        setStatus("Compressing reference for video…", "pending");
        return compressDataUrl(raw, VIDEO_REF_MAX_SIDE, 0.82);
      })
      .then(function (compressed) {
        if (!compressed) throw new Error("Could not prepare still for video.");
        var life =
          "IMAGE-TO-LIFE from this still only. Keep logos, products, and original cinematic set-dressing stable. " +
          "Living world motion (lights, weather, subtle crowd/creature energy). Fixed camera, no Ken Burns. " +
          (brandNamesLine() ? "Brands: " + brandNamesLine() + ". " : "") +
          (productPlacementPromptLine() ? productPlacementPromptLine().slice(0, 320) + " " : "") +
          (titlesSafeShortLine()
            ? "Cinematic mood: " +
              titlesSafeShortLine() +
              " — populate with never-before-seen heroes and personal sigils. "
            : "") +
          (userPrompt || "") +
          " Seamless loop.";
        // Keep body lean — huge stasis + giant data URLs stall the browser
        var stasisShort = (
          "Commercial brands-and-stories-in-worlds video. " +
          brandNamesLine() +
          ". " +
          productPlacementPromptLine().slice(0, 200) +
          ". " +
          titlesSafeShortLine() +
          ". Original cinematic motifs only."
        ).slice(0, 2500);
        setStatus("Starting video job (async)…", "pending");
        return fetchWithTimeout(
          apiUrl("/api/animate-cast"),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              // Do NOT wait_for_result — blocks server thread + freezes client for minutes
              wait: false,
              wait_for_result: false,
              job_id: jobId,
              stasis: stasisShort,
              prompt: life.slice(0, 4000),
              image_to_life_prompt: life.slice(0, 6000),
              craft_hints:
                "Brands in worlds. Logo fidelity. Product placement. Living environment. Fixed camera.",
              buzz_words: [
                "brands in worlds",
                "product placement",
                "worldbuilding motion",
                "diegetic logos",
                "fixed camera",
                "loop",
              ],
              duration: state.duration,
              spells: [],
              spell_cast: false,
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
          if (!r.ok) {
            throw new Error((d && (d.error || d.message)) || "Video failed (" + r.status + ")");
          }
          // Immediate result (rare)
          var vid = d.video;
          var url =
            (vid && (vid.url || vid.download_url || vid.uri)) ||
            d.video_url ||
            d.output_url ||
            d.result_url;
          if (url) return absoluteUrl(url);
          var jid = (d && (d.job_id || d.id)) || jobId;
          if (r.status === 202 || jid) {
            setStatus("Video rendering… 0s (polling — UI stays responsive)", "pending");
            return pollVideoJob(jid, startedAt);
          }
          throw new Error("No video job returned.");
        });
      })
      .then(function (url) {
        setStatus("Saving video to gallery/saved-videos/…", "pending");
        return saveVideoToGallery(url)
          .then(function (saved) {
            var local = (saved && saved.url && absoluteUrl(saved.url)) || url;
            if (saved && saved.num != null) {
              setStatus("Video saved as saved-videos/" + saved.num + ".mp4", "ok");
            }
            return local;
          })
          .catch(function (err) {
            console.warn("[commercial] video auto-save failed", err);
            setStatus(
              "Video ready but NOT saved to disk: " +
                ((err && err.message) || "save failed") +
                " — click Save video (needs local server).",
              "error"
            );
            return url;
          });
      });
  }

  function generate() {
    if (state.generating) return;
    readPrefsFromUi();
    var brands = selectedList();
    var titles = selectedTitlesList();
    var celebs = selectedCelebsList();
    if (!brands.length && !titles.length && !celebs.length) {
      setStatus("Select at least one business, movie/TV title, or celebrity.", "error");
      return;
    }
    var promptEl = $("co-prompt");
    var userPrompt = (promptEl && promptEl.value.trim()) || "";
    state.generating = true;
    // Seed worlds from the tray if none equipped (up to 2 for a richer default)
    if (!state.appliedSpells.length && state.tray.length) {
      var picks = state.tray.slice();
      for (var i = picks.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var t = picks[i];
        picks[i] = picks[j];
        picks[j] = t;
      }
      picks.slice(0, Math.min(2, picks.length, MAX_WORLD_SPELLS)).forEach(function (sp) {
        equipSpell(sp);
      });
      setStatus(
        "Auto-equipped " + state.appliedSpells.length + " world spell(s) from the tray…",
        "pending"
      );
    }
    setStatus(
      state.mode === "video"
        ? "Step 1/2: still (" +
            state.aspect +
            "), then video " +
            state.duration +
            "s — UI stays responsive…"
        : "Generating still (" + state.aspect + ")…",
      "pending"
    );
    var genBtn = $("co-generate");
    if (genBtn) {
      genBtn.disabled = true;
      genBtn.dataset.label = genBtn.textContent;
      genBtn.textContent = state.mode === "video" ? "Working…" : "Generating…";
    }

    // Logos stay catalog/prompt-driven; reference image is a clean world only
    yieldToUi()
      .then(function () {
        return buildCleanWorldReference();
      })
      .then(function (worldRef) {
        return { worldRef: worldRef || "" };
      })
      .then(function (pack) {
        setStatus(
          state.mode === "video" ? "Step 1/2: generating still…" : "Generating still…",
          "pending"
        );
        return generateStill(pack, userPrompt).then(function (stillUrl) {
          showStill(stillUrl);
          setStatus("Saving still to gallery/generated/…", "pending");
          return saveStillToGallery(stillUrl)
            .then(function (saved) {
              var local =
                (saved && saved.url && absoluteUrl(saved.url)) || state.imageUrl || stillUrl;
              showStill(local);
              var n = saved && saved.num != null ? saved.num : state.savedImageNum;
              if (state.mode !== "video") {
                setStatus(
                  "Saved still" +
                    (n != null ? " as generated/" + n : "") +
                    " — " +
                    brandNamesLine() +
                    " in " +
                    (state.appliedSpells.length
                      ? state.appliedSpells.length + " spell world(s)"
                      : "an invented commercial world") +
                    ". Open Gallery → Generated to browse.",
                  "ok"
                );
                return local;
              }
              setStatus(
                "Still saved" +
                  (n != null ? " (#" + n + ")" : "") +
                  " — Step 2/2: starting video…",
                "pending"
              );
              return yieldToUi().then(function () {
                return generateVideoFromStill(local, userPrompt).then(function (videoUrl) {
                  showVideo(videoUrl);
                  var vn = state.savedVideoNum;
                  setStatus(
                    "Video ready" +
                      (vn != null ? " — saved-videos/" + vn : " (check Save video if not saved)") +
                      " · still in Generated" +
                      (n != null ? " #" + n : "") +
                      ".",
                    "ok"
                  );
                  return videoUrl;
                });
              });
            })
            .catch(function (err) {
              console.warn("[commercial] still auto-save failed", err);
              if (state.mode !== "video") {
                setStatus(
                  "Still ready but NOT saved: " +
                    ((err && err.message) || "save failed") +
                    " — click Save image (start_server.bat must be running).",
                  "error"
                );
                return stillUrl;
              }
              setStatus(
                "Still not saved to disk — continuing video… (" +
                  ((err && err.message) || "save failed") +
                  ")",
                "error"
              );
              return yieldToUi().then(function () {
                return generateVideoFromStill(stillUrl, userPrompt).then(function (videoUrl) {
                  showVideo(videoUrl);
                  setStatus(
                    "Video ready. Still failed to save — use Save image / Save video.",
                    "error"
                  );
                  return videoUrl;
                });
              });
            });
        });
      })
      .then(function () {
        if (window.dispatchEvent) window.dispatchEvent(new Event("xai-usage-refresh"));
      })
      .catch(function (err) {
        setStatus((err && err.message) || "Generate failed.", "error");
      })
      .finally(function () {
        state.generating = false;
        if (genBtn) {
          genBtn.disabled = false;
          if (genBtn.dataset.label) {
            genBtn.textContent = genBtn.dataset.label;
            delete genBtn.dataset.label;
          }
        }
      });
  }

  function pollImageJob(jobId, left) {
    if (!jobId) return Promise.reject(new Error("Missing job id"));
    if (left == null) left = 80;
    if (left <= 0) return Promise.reject(new Error("Timed out waiting for image."));
    return fetchWithTimeout(apiUrl("/api/jobs/" + jobId), { cache: "no-store" }, 30000)
      .then(function (r) {
        return parseApiResponse(r);
      })
      .then(function (job) {
        var st = String((job && job.status) || "").toLowerCase();
        setStatus("Generating… (" + st + ")", "pending");
        if (st === "done" || st === "completed" || st === "success") {
          var img = job.image || (job.images && job.images[0]);
          var url = (img && img.url) || job.image_url || job.output_url;
          if (url) return absoluteUrl(url);
          throw new Error("No image in job.");
        }
        if (st === "failed" || st === "error" || st === "expired") {
          throw new Error((job.error && (job.error.message || job.error)) || "Job failed");
        }
        return new Promise(function (resolve) {
          setTimeout(resolve, 1200);
        }).then(function () {
          return pollImageJob(jobId, left - 1);
        });
      });
  }

  function wire() {
    var add = $("co-add-btn");
    if (add) add.addEventListener("click", addBusiness);
    var clearB = $("co-clear-brands");
    if (clearB) clearB.addEventListener("click", clearAllBrands);
    var clearS = $("co-clear-styles");
    if (clearS) clearS.addEventListener("click", clearAllStyles);
    var clearT = $("co-clear-titles");
    if (clearT) clearT.addEventListener("click", clearAllTitles);
    var clearC = $("co-clear-celebs");
    if (clearC) clearC.addEventListener("click", clearAllCelebs);
    var styleAdd = $("co-style-add-btn");
    if (styleAdd) styleAdd.addEventListener("click", addCustomStyle);
    var titleAdd = $("co-title-add-btn");
    if (titleAdd) titleAdd.addEventListener("click", addCustomTitle);
    var celebAdd = $("co-celeb-add-btn");
    if (celebAdd) celebAdd.addEventListener("click", addCustomCeleb);
    var gen = $("co-generate");
    if (gen) gen.addEventListener("click", generate);
    var sell = $("co-sell");
    if (sell) sell.addEventListener("click", sellCurrentCommercial);
    var saveImg = $("co-save-image");
    if (saveImg) {
      saveImg.addEventListener("click", function () {
        if (!state.imageUrl) {
          setStatus("Generate a still first.", "error");
          return;
        }
        setStatus("Saving still to generated/…", "pending");
        saveStillToGallery(state.imageUrl, { force: true, asDataUrl: true })
          .then(function (d) {
            setStatus(
              "Saved as generated/" +
                (d && d.num != null ? d.num : "?") +
                " — Gallery → Generated tab.",
              "ok"
            );
          })
          .catch(function (err) {
            setStatus((err && err.message) || "Save image failed.", "error");
          });
      });
    }
    var saveVid = $("co-save-video");
    if (saveVid) {
      saveVid.addEventListener("click", function () {
        if (!state.videoUrl) {
          setStatus("Generate a video first.", "error");
          return;
        }
        setStatus("Saving video to saved-videos/…", "pending");
        saveVideoToGallery(state.videoUrl)
          .then(function (d) {
            setStatus(
              "Saved as saved-videos/" +
                (d && d.num != null ? d.num : "?") +
                (d && d.name ? " (" + d.name + ")" : "") +
                ".",
              "ok"
            );
          })
          .catch(function (err) {
            setStatus((err && err.message) || "Save video failed.", "error");
          });
      });
    }
    var promptIn = $("co-prompt");
    if (promptIn) {
      promptIn.addEventListener("input", function () {
        // Director brief is part of loadout text — rebuild unless user locked stasis/prompt
        if (!state.promptDirty) refreshPromptPreview(true);
        else renderLoadoutLines();
      });
    }
    ["co-stasis-edit", "co-prompt-edit"].forEach(function (id) {
      var el = $(id);
      if (!el) return;
      el.addEventListener("input", onEditorInput);
      el.addEventListener("scroll", function () {
        var layerId = id === "co-stasis-edit" ? "co-stasis-hl" : "co-prompt-hl";
        syncHlScroll(el, $(layerId));
      });
    });
    var resetBtn = $("co-prompt-reset");
    if (resetBtn) {
      resetBtn.addEventListener("click", function () {
        state.promptDirty = false;
        refreshPromptPreview(true);
        setEditorOpen(true);
        setStatus("Prompt rebuilt from current selection.", "ok");
      });
    }
    var copyBtn = $("co-prompt-copy");
    if (copyBtn) {
      copyBtn.addEventListener("click", function () {
        var stasis = (($("co-stasis-edit") && $("co-stasis-edit").value) || "");
        var prompt = (($("co-prompt-edit") && $("co-prompt-edit").value) || "");
        if (!stasis && !prompt) refreshPromptPreview(true);
        stasis = (($("co-stasis-edit") && $("co-stasis-edit").value) || "");
        prompt = (($("co-prompt-edit") && $("co-prompt-edit").value) || "");
        var text =
          "=== STASIS (" +
          stasis.length +
          " chars) ===\n" +
          stasis +
          "\n\n=== PROMPT (" +
          prompt.length +
          " chars) ===\n" +
          prompt;
        function ok() {
          setStatus("Prompt copied (" + text.length + " chars).", "ok");
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(ok).catch(function () {
            setStatus("Could not copy — select text manually.", "error");
          });
        } else {
          setStatus("Clipboard unavailable — select text manually.", "error");
        }
      });
    }
    var toggleBtn = $("co-prompt-toggle");
    if (toggleBtn) {
      toggleBtn.addEventListener("click", function () {
        setEditorOpen(!state.editorOpen);
      });
    }
    var rnd = $("co-randomize");
    if (rnd) rnd.addEventListener("click", shuffleTray);
    var search = $("co-search");
    if (search) {
      search.addEventListener("input", function () {
        renderBrandList();
      });
    }
    var styleSearch = $("co-style-search");
    if (styleSearch) {
      styleSearch.addEventListener("input", function () {
        renderStyleList();
      });
    }
    var titleSearch = $("co-title-search");
    if (titleSearch) {
      titleSearch.addEventListener("input", function () {
        renderTitleList();
      });
    }
    var celebSearch = $("co-celeb-search");
    if (celebSearch) {
      celebSearch.addEventListener("input", function () {
        renderCelebList();
      });
    }
    document.querySelectorAll("[data-co-left]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setLeftPanel(btn.getAttribute("data-co-left"));
      });
    });
    document.querySelectorAll("[data-co-mode]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.mode = btn.getAttribute("data-co-mode") === "video" ? "video" : "image";
        syncModeUi();
        readPrefsFromUi();
      });
    });
    document.querySelectorAll("[data-co-pool]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.poolFilter = btn.getAttribute("data-co-pool") || "all";
        syncModeUi();
        shuffleTray();
        readPrefsFromUi();
      });
    });
    var aspect = $("co-aspect");
    if (aspect) {
      aspect.addEventListener("change", function () {
        state.aspect = aspect.value || "1:1";
        readPrefsFromUi();
        if (!state.promptDirty) refreshPromptPreview(true);
        else renderLoadoutLines();
      });
    }
    var duration = $("co-duration");
    if (duration) {
      duration.addEventListener("change", function () {
        state.duration = parseInt(duration.value, 10) || 10;
        readPrefsFromUi();
      });
    }
    var stage = $("co-stage");
    if (stage) {
      stage.addEventListener("dragover", function (e) {
        e.preventDefault();
      });
      stage.addEventListener("drop", function (e) {
        e.preventDefault();
        try {
          var raw = e.dataTransfer.getData("text/plain");
          var sp = JSON.parse(raw);
          equipSpell(sp);
        } catch (_) {}
      });
    }
  }

  function onShow() {
    loadPrefs();
    syncModeUi();
    setLeftPanel(state.leftPanel || "brands");
    if (!state.ready) {
      state.ready = true;
      loadBrands();
      loadTitles();
      loadCelebs();
      loadSpellPool().then(function () {
        return loadArtStyles();
      }).then(function () {
        refreshPromptPreview(true);
      });
    } else {
      renderBrandList();
      renderSelectedLogos();
      renderTitleList();
      renderSelectedTitles();
      renderCelebList();
      renderSelectedCelebs();
      renderStyleList();
      renderSelectedStyles();
      loadSpellPool().then(function () {
        attachStyleRefs();
        renderStyleList();
        renderSelectedStyles();
        refreshPromptPreview(true);
      });
    }
    refreshPromptPreview(true);
  }

  function boot() {
    if (!$("panel-commercial")) return;
    loadPrefs();
    wire();
    syncModeUi();
    setLeftPanel("brands");
    window.Commercial = {
      onShow: onShow,
      getLastPayload: function () {
        return getActivePayload((($("co-prompt") && $("co-prompt").value) || "").trim());
      },
      previewPrompt: refreshPromptPreview,
      scanModeration: scanModeration,
      saveStill: saveStillToGallery,
      saveVideo: saveVideoToGallery,
    };
    updateSaveButtons();
    window.dispatchEvent(new Event("commercial-ready"));
  }

  window.addEventListener("commercial-show", onShow);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
