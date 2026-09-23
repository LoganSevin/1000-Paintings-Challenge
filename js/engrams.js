/**
 * Engrams — surreal acronym / backronym experience.
 * Type any word; each letter expands into a thought-provoking word.
 */
(function () {
  "use strict";

  var HISTORY_KEY = "engrams_history_v1";
  var HISTORY_MAX = 40;
  var MIN_LEN = 1;
  var MAX_LEN = 15;
  var DEFAULT_UNLOCK = 2;
  var LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

  /** Curated surreal / philosophical / artistic lexicon per letter. */
  var LEXICON = {
    A: [
      "Arise", "Abyss", "Aurora", "Alchemy", "Aether", "Axiom", "Amethyst",
      "Aphelion", "Arcane", "Astral", "Anamnesis", "Aperture", "Avalanche",
      "Allegory", "Aeon", "Atelier", "Ambrosia", "Aporia"
    ],
    B: [
      "Beacon", "Bloom", "Bardo", "Babel", "Benthos", "Becoming", "Bricolage",
      "Breath", "Boreal", "Buddhafield", "Basalt", "Beloved", "Brume", "Byzantine"
    ],
    C: [
      "Chorus", "Chiaroscuro", "Cipher", "Cascade", "Cosmos", "Chrysalis",
      "Catharsis", "Cathedral", "Cartography", "Crescent", "Chimera", "Cadence",
      "Celestial", "Cloister", "Chronicle"
    ],
    D: [
      "Dream", "Depth", "Dawn", "Dialect", "Diaspora", "Duet", "Daimon",
      "Dissonance", "Dwelling", "Dervish", "Diaphanous", "Destiny", "Delta", "Doctrine"
    ],
    E: [
      "Echo", "Eclipse", "Ember", "Epiphany", "Elysium", "Entropy", "Eden",
      "Emanation", "Ether", "Eloquent", "Eunoia", "Exegesis", "Elegy", "Emergence"
    ],
    F: [
      "Fold", "Fractal", "Fathom", "Flame", "Fugue", "Filament", "Fable",
      "Frontier", "Fiction", "Fluence", "Formless", "Forge", "Fervor", "Fenestration"
    ],
    G: [
      "Glyph", "Gossamer", "Gravity", "Genesis", "Grail", "Gnostic", "Garden",
      "Glimpse", "Golem", "Golden", "Gyre", "Galaxy", "Grace", "Geometry"
    ],
    H: [
      "Horizon", "Halo", "Hymn", "Hologram", "Hearth", "Hush", "Helix",
      "Hypothesis", "Harbor", "Hermetic", "Hue", "Harbinger", "Hollow", "Hyperion"
    ],
    I: [
      "Interest", "Infinite", "Iris", "Ink", "Incantation", "Icarus", "Island",
      "Illusion", "Insight", "Icon", "Idyll", "Ineffable", "Ion", "Intuition"
    ],
    J: [
      "Journey", "Jewel", "Juncture", "Jubilant", "Jasmine", "Jigsaw", "Joule",
      "Judgment", "Jade", "Jettison", "Joy", "Juxtapose", "Janus", "Journal"
    ],
    K: [
      "Key", "Kinetic", "Karma", "Kaleidoscope", "Kindling", "Kingdom", "Knot",
      "Koan", "Kyoto", "Keel", "Kismet", "Knowledge", "Kairos", "Kraken"
    ],
    L: [
      "Lumen", "Labyrinth", "Liminal", "Lotus", "Lattice", "Lucid", "Legacy",
      "Lantern", "Lyric", "Lapis", "Leviathan", "Lullaby", "Lexicon", "Longitude"
    ],
    M: [
      "Myth", "Mirror", "Mosaic", "Metamorphosis", "Moon", "Mnemonic", "Muse",
      "Monad", "Meridian", "Manifest", "Mystery", "Mandala", "Murmur", "Memory"
    ],
    N: [
      "Nexus", "Night", "Nebula", "Notion", "Numinous", "Nest", "Narrative",
      "Nadir", "Nocturne", "Nemesis", "Nectar", "Nova", "Nameless", "Needle"
    ],
    O: [
      "Oracle", "Orbit", "Origin", "Omen", "Opaline", "Odyssey", "Ocean",
      "Obsidian", "Overture", "Omniscient", "Opus", "Outlet", "Oasis", "Ontology"
    ],
    P: [
      "Prism", "Portal", "Poem", "Paradox", "Phoenix", "Pulse", "Palette",
      "Pilgrim", "Pneuma", "Pinnacle", "Phantom", "Praxis", "Pyre", "Presence"
    ],
    Q: [
      "Quest", "Quantum", "Quiet", "Quill", "Quasar", "Quiver", "Quintessence",
      "Query", "Quorum", "Quartz", "Quixotic", "Quotient", "Quake", "Quondam"
    ],
    R: [
      "Riddle", "Radiance", "Rune", "Reverie", "River", "Resonance", "Ritual",
      "Rose", "Realm", "Rapture", "Root", "Rhapsody", "Relic", "Revelation"
    ],
    S: [
      "Surreal", "Silence", "Spiral", "Star", "Synapse", "Solstice", "Shadow",
      "Symphony", "Seed", "Sigil", "Solitude", "Spectrum", "Sutra", "Seraph"
    ],
    T: [
      "Threshold", "Temple", "Tide", "Tapestry", "Truth", "Twilight", "Talisman",
      "Tesseract", "Testament", "Thread", "Trance", "Totem", "Topology", "Tremor"
    ],
    U: [
      "Umbra", "Universe", "Unfold", "Utopia", "Ultraviolet", "Undercurrent",
      "Ursine", "Unity", "Urn", "Uprising", "Ultramarine", "Unspoken", "Umbilical", "Uplift"
    ],
    V: [
      "Vision", "Vortex", "Veil", "Vesper", "Voyage", "Vivid", "Vault",
      "Verse", "Vigil", "Vapor", "Vernacular", "Vesperal", "Vertex", "Vita"
    ],
    W: [
      "Wonder", "Woven", "Whisper", "Wyrd", "Watershed", "Womb", "Wavelength",
      "Wilderness", "Waking", "Witness", "Wreathe", "Wayfarer", "Wisdom", "Wisp"
    ],
    X: [
      "Xenolith", "Xanadu", "Xylem", "Xenial", "Xeric", "Xylograph", "Xenogenesis",
      "X-factor", "Xenon", "Xanthic", "Xylophone", "Xenogamy", "Xiphoid", "Xyst"
    ],
    Y: [
      "Yearn", "Yonder", "Yarn", "Yugen", "Yellow", "Yoke", "Yarrow",
      "Yield", "Ylem", "Yogic", "Youth", "Yaw", "Yggdrasil", "Yes"
    ],
    Z: [
      "Zenith", "Zephyr", "Zodiac", "Ziggurat", "Zeitgeist", "Zone", "Zest",
      "Zircon", "Zero", "Zen", "Zigzag", "Zealous", "Zither", "Zoar"
    ]
  };

  var CONNECTORS = [
    ["from", "the"],
    ["of", "the"],
    ["into", "the"],
    ["toward", "the"],
    ["beneath", "the"],
    ["beyond", "the"],
    ["through", "the"],
    ["within", "the"],
    ["as", "the"],
    ["amid", "the"],
    ["across", "the"],
    ["under"]
  ];

  var state = {
    unlock: DEFAULT_UNLOCK,
    seedRaw: "",
    seedLetters: "",
    words: [],
    poem: "",
    nonce: 0,
    filterLetter: "",
    history: [],
    debounce: 0,
    inited: false
  };

  function $(id) {
    return document.getElementById(id);
  }

  function hashStr(s) {
    var h = 2166136261 >>> 0;
    var i;
    for (i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(a) {
    return function () {
      var t = (a += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function extractLetters(raw) {
    return String(raw || "")
      .toUpperCase()
      .replace(/[^A-Z]/g, "")
      .slice(0, MAX_LEN);
  }

  function pickWord(letter, rng, preferredLen, used) {
    var bank = LEXICON[letter] || [letter + "ther"];
    var scored = bank.map(function (w, idx) {
      var len = w.replace(/[^a-zA-Z]/g, "").length;
      var dist = Math.abs(len - preferredLen);
      var usedPenalty = used[w] ? 40 : 0;
      var jitter = rng() * 3;
      return { w: w, score: dist + usedPenalty + jitter, idx: idx };
    });
    scored.sort(function (a, b) {
      return a.score - b.score;
    });
    var choice = scored[0].w;
    used[choice] = true;
    return choice;
  }

  function weavePoem(words, seed, nonce) {
    if (!words.length) return "";
    var rng = mulberry32(hashStr(seed + "|poem|" + nonce));
    var parts = [words[0]];
    var i;
    for (i = 1; i < words.length; i++) {
      var conn = CONNECTORS[Math.floor(rng() * CONNECTORS.length)];
      if (rng() < 0.55) {
        parts.push(conn.join(" "));
      } else if (rng() < 0.75) {
        parts.push(conn[0]);
      }
      parts.push(words[i]);
    }
    var line = parts.join(" ");
    return line.charAt(0).toUpperCase() + line.slice(1);
  }

  function preferredWordLen(unlock, letterIndex, seedLen) {
    var base = Math.max(3, Math.min(14, unlock + 2));
    var wobble = ((letterIndex * 3 + seedLen) % 5) - 2;
    return Math.max(3, Math.min(14, base + wobble));
  }

  function generate(raw, unlock, nonce) {
    var letters = extractLetters(raw);
    var note = "";
    var fullAlpha = String(raw || "").toUpperCase().replace(/[^A-Z]/g, "");
    if (fullAlpha.length > MAX_LEN) {
      note = "Using first " + MAX_LEN + " letters of a longer seed.";
    }
    if (!letters.length) {
      return {
        seedRaw: raw || "",
        seedLetters: "",
        words: [],
        poem: "",
        note: "Type at least one letter (A–Z).",
        clamped: false
      };
    }
    var unlockN = Math.max(MIN_LEN, Math.min(MAX_LEN, unlock | 0));
    var clamped = false;
    if (letters.length > unlockN) {
      letters = letters.slice(0, unlockN);
      clamped = true;
      note = note
        ? note + " Seed clipped to unlock " + unlockN + "."
        : "Seed clipped to unlock length " + unlockN + " — raise the slider to go deeper.";
    }
    var rng = mulberry32(hashStr(letters + "|" + unlockN + "|" + nonce));
    var used = {};
    var words = [];
    var i;
    for (i = 0; i < letters.length; i++) {
      var L = letters.charAt(i);
      words.push(pickWord(L, rng, preferredWordLen(unlockN, i, letters.length), used));
    }
    return {
      seedRaw: raw || "",
      seedLetters: letters,
      words: words,
      poem: weavePoem(words, letters, nonce),
      note: note,
      clamped: clamped
    };
  }

  function loadHistory() {
    try {
      var raw = localStorage.getItem(HISTORY_KEY);
      var list = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(list)) return [];
      return list.slice(0, HISTORY_MAX);
    } catch (e) {
      return [];
    }
  }

  function saveHistory() {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(state.history.slice(0, HISTORY_MAX)));
    } catch (e) {}
  }

  function pushHistory(entry) {
    if (!entry || !entry.seedLetters) return;
    var key = entry.seedLetters + "|" + (entry.words || []).join(",") + "|" + (entry.poem || "");
    state.history = state.history.filter(function (h) {
      return (h.seedLetters + "|" + (h.words || []).join(",") + "|" + (h.poem || "")) !== key;
    });
    state.history.unshift({
      id: String(Date.now()) + "-" + Math.floor(Math.random() * 1e6),
      seedRaw: entry.seedRaw,
      seedLetters: entry.seedLetters,
      words: entry.words.slice(),
      poem: entry.poem,
      unlock: state.unlock,
      at: Date.now()
    });
    if (state.history.length > HISTORY_MAX) state.history.length = HISTORY_MAX;
    saveHistory();
    renderHistory();
  }

  function buildLetterRail() {
    var rail = $("engrams-rail");
    if (!rail || rail.dataset.ready === "1") return;
    rail.innerHTML = "";
    LETTERS.forEach(function (L) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "engrams-letter";
      btn.dataset.letter = L;
      btn.textContent = L;
      btn.title = "Seed / filter with " + L;
      btn.addEventListener("click", function () {
        onLetterClick(L);
      });
      rail.appendChild(btn);
    });
    rail.dataset.ready = "1";
  }

  function onLetterClick(L) {
    var input = $("engrams-prompt");
    if (!input) return;
    if (state.filterLetter === L && !input.value) {
      state.filterLetter = "";
      updateRailActive();
      return;
    }
    state.filterLetter = L;
    if (!input.value) {
      input.value = L;
    } else {
      var cur = extractLetters(input.value);
      if (cur.length < state.unlock) {
        input.value = input.value + L;
      } else {
        input.value = L;
      }
    }
    updateRailActive();
    runGenerate(false);
    input.focus();
  }

  function updateRailActive() {
    var rail = $("engrams-rail");
    if (!rail) return;
    var seedSet = {};
    var i;
    for (i = 0; i < state.seedLetters.length; i++) {
      seedSet[state.seedLetters.charAt(i)] = true;
    }
    Array.prototype.forEach.call(rail.querySelectorAll(".engrams-letter"), function (btn) {
      var L = btn.dataset.letter;
      btn.classList.toggle("is-in-seed", !!seedSet[L]);
      btn.classList.toggle("is-filter", state.filterLetter === L);
    });
  }

  function renderStage(result) {
    state.seedRaw = result.seedRaw;
    state.seedLetters = result.seedLetters;
    state.words = result.words;
    state.poem = result.poem;

    var seedEl = $("engrams-seed-display");
    var slots = $("engrams-slots");
    var poemEl = $("engrams-poem");
    var noteEl = $("engrams-note");
    var metaEl = $("engrams-meta");

    if (seedEl) {
      seedEl.textContent = result.seedLetters
        ? result.seedLetters.split("").join(" · ")
        : "—";
    }
    if (slots) {
      slots.innerHTML = "";
      result.words.forEach(function (w, idx) {
        var card = document.createElement("div");
        card.className = "engrams-slot";
        var letter = document.createElement("span");
        letter.className = "engrams-slot-letter";
        letter.textContent = result.seedLetters.charAt(idx) || "";
        var word = document.createElement("span");
        word.className = "engrams-slot-word";
        word.textContent = w;
        card.appendChild(letter);
        card.appendChild(word);
        slots.appendChild(card);
      });
      if (!result.words.length) {
        slots.innerHTML = '<p class="engrams-empty">Type a word — each letter becomes an engram expansion.</p>';
      }
    }
    if (poemEl) {
      poemEl.textContent = result.poem || "…";
    }
    if (noteEl) {
      noteEl.textContent = result.note || "";
      noteEl.hidden = !result.note;
    }
    if (metaEl) {
      var n = result.seedLetters.length;
      metaEl.textContent =
        "Seed " + n + " / unlock " + state.unlock + " · richness toward " + MAX_LEN;
    }
    updateRailActive();
    updateLengthUI();
  }

  function updateLengthUI() {
    var slider = $("engrams-unlock");
    var label = $("engrams-unlock-label");
    var seedLen = $("engrams-seed-len");
    if (slider && Number(slider.value) !== state.unlock) {
      slider.value = String(state.unlock);
    }
    if (label) {
      label.textContent = String(state.unlock);
    }
    if (seedLen) {
      seedLen.textContent = String(state.seedLetters.length || 0);
    }
  }

  function runGenerate(save) {
    var input = $("engrams-prompt");
    var raw = input ? input.value : state.seedRaw;
    var result = generate(raw, state.unlock, state.nonce);
    renderStage(result);
    if (save && result.words.length) {
      pushHistory(result);
    }
  }

  function reshuffle() {
    state.nonce = (state.nonce + 1) % 1e9;
    runGenerate(false);
  }

  function copyCurrent() {
    var text =
      (state.seedLetters || "") +
      "\n" +
      (state.words || []).join(" · ") +
      "\n" +
      (state.poem || "");
    if (!state.seedLetters) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(flashCopy).catch(fallbackCopy);
    } else {
      fallbackCopy();
    }
    function fallbackCopy() {
      try {
        var ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        flashCopy();
      } catch (e) {}
    }
  }

  function flashCopy() {
    var btn = $("engrams-copy");
    if (!btn) return;
    var prev = btn.textContent;
    btn.textContent = "Copied";
    setTimeout(function () {
      btn.textContent = prev;
    }, 1200);
  }

  function renderHistory() {
    var list = $("engrams-history");
    if (!list) return;
    list.innerHTML = "";
    if (!state.history.length) {
      list.innerHTML = '<p class="engrams-empty">No saved engrams yet.</p>';
      return;
    }
    state.history.forEach(function (h) {
      var item = document.createElement("article");
      item.className = "engrams-hist-item";
      item.dataset.id = h.id;

      var head = document.createElement("header");
      var seed = document.createElement("strong");
      seed.textContent = h.seedLetters;
      var sub = document.createElement("span");
      sub.className = "engrams-hist-sub";
      sub.textContent = (h.words || []).join(" · ");
      head.appendChild(seed);
      head.appendChild(sub);

      var poem = document.createElement("p");
      poem.className = "engrams-hist-poem";
      poem.textContent = h.poem || "";

      var actions = document.createElement("div");
      actions.className = "engrams-hist-actions";

      var openBtn = document.createElement("button");
      openBtn.type = "button";
      openBtn.className = "engrams-btn engrams-btn-ghost";
      openBtn.textContent = "Open";
      openBtn.addEventListener("click", function () {
        reopen(h);
      });

      var copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "engrams-btn engrams-btn-ghost";
      copyBtn.textContent = "Copy";
      copyBtn.addEventListener("click", function () {
        var t = h.seedLetters + "\n" + (h.words || []).join(" · ") + "\n" + (h.poem || "");
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(t).catch(function () {});
        }
      });

      var delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "engrams-btn engrams-btn-ghost";
      delBtn.textContent = "Delete";
      delBtn.addEventListener("click", function () {
        state.history = state.history.filter(function (x) {
          return x.id !== h.id;
        });
        saveHistory();
        renderHistory();
      });

      actions.appendChild(openBtn);
      actions.appendChild(copyBtn);
      actions.appendChild(delBtn);
      item.appendChild(head);
      item.appendChild(poem);
      item.appendChild(actions);
      list.appendChild(item);
    });
  }

  function reopen(h) {
    var input = $("engrams-prompt");
    if (input) input.value = h.seedRaw || h.seedLetters;
    if (h.unlock) {
      state.unlock = Math.max(MIN_LEN, Math.min(MAX_LEN, h.unlock | 0));
    }
    state.nonce = (state.nonce + 1) % 1e9;
    state.seedLetters = h.seedLetters || "";
    state.words = (h.words || []).slice();
    state.poem = h.poem || "";
    renderStage({
      seedRaw: h.seedRaw || h.seedLetters,
      seedLetters: state.seedLetters,
      words: state.words,
      poem: state.poem,
      note: ""
    });
  }

  function bind() {
    var input = $("engrams-prompt");
    var gen = $("engrams-generate");
    var reshuf = $("engrams-reshuffle");
    var copy = $("engrams-copy");
    var save = $("engrams-save");
    var slider = $("engrams-unlock");
    var clearHist = $("engrams-clear-history");

    if (input) {
      input.addEventListener("input", function () {
        clearTimeout(state.debounce);
        state.debounce = setTimeout(function () {
          runGenerate(false);
        }, 220);
      });
      input.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter") {
          ev.preventDefault();
          runGenerate(true);
        }
      });
    }
    if (gen) {
      gen.addEventListener("click", function () {
        runGenerate(true);
      });
    }
    if (reshuf) {
      reshuf.addEventListener("click", reshuffle);
    }
    if (copy) {
      copy.addEventListener("click", copyCurrent);
    }
    if (save) {
      save.addEventListener("click", function () {
        runGenerate(true);
      });
    }
    if (slider) {
      slider.addEventListener("input", function () {
        state.unlock = Math.max(MIN_LEN, Math.min(MAX_LEN, parseInt(slider.value, 10) || DEFAULT_UNLOCK));
        updateLengthUI();
        runGenerate(false);
      });
    }
    if (clearHist) {
      clearHist.addEventListener("click", function () {
        state.history = [];
        saveHistory();
        renderHistory();
      });
    }
  }

  function init() {
    if (state.inited) {
      runGenerate(false);
      return;
    }
    state.inited = true;
    state.history = loadHistory();
    buildLetterRail();
    bind();
    var slider = $("engrams-unlock");
    if (slider) {
      state.unlock = Math.max(MIN_LEN, Math.min(MAX_LEN, parseInt(slider.value, 10) || DEFAULT_UNLOCK));
    }
    var input = $("engrams-prompt");
    if (input && !input.value) {
      input.value = "AI";
    }
    renderHistory();
    runGenerate(false);
  }

  function onShow() {
    init();
  }

  function onHide() {
    clearTimeout(state.debounce);
  }

  window.Engrams = {
    onShow: onShow,
    onHide: onHide,
    generate: generate,
    LEXICON: LEXICON
  };

  window.addEventListener("engrams-show", onShow);
  window.addEventListener("engrams-hide", onHide);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      if ($("panel-engrams")) buildLetterRail();
    });
  } else if ($("panel-engrams")) {
    buildLetterRail();
  }
})();
