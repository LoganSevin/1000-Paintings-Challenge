/**
 * Runes tab — Unicode runic keyboard, English letter fillers, incantation prompts.
 * Symbols from https://www.symbolselect.com/rune-symbols/
 */
(function () {
  "use strict";

  var MAP_KEY = "runes_blocks_map_v2";
  var MAP_KEY_LEGACY = "runes_letter_map_v1";
  var INCANT_KEY = "runes_incantation_v1";
  var FILLER_KEY = "runes_filler_v1";
  var SESSION_KEY = "runes_full_session_v3";

  /**
   * Full set from symbolselect.com (and user paste), in page order.
   * Note: ᛯ and ᛮ are Runic digits in Unicode — still included as on the source page.
   */
  var RUNES = [
    "ᛉ", "ᛟ", "ᚠ", "ᛝ", "ᚢ", "ᛏ", "ᚱ", "ᚹ", "ᚨ", "ᛞ", "᛭", "ᛗ", "ᚡ", "ᛜ", "ᛋ",
    "ᛤ", "ᛦ", "ᚸ", "ᛖ", "ᛒ", "ᚼ", "ᛥ", "ᛊ", "ᛃ", "ᛈ", "ᛣ", "ᚾ", "ᛁ", "ᚴ", "ᚦ",
    "ᛯ", "ᚧ", "ᚲ", "ᛙ", "ᚷ", "ᚳ", "ᚺ", "ᛇ", "ᛠ", "ᛡ", "ᛅ", "ᛢ", "ᚤ", "ᛓ", "ᛪ",
    "ᛄ", "ᛧ", "ᛕ", "ᛂ", "ᛚ", "ᚥ", "ᚻ", "ᚵ", "ᚣ", "ᚯ", "ᛨ", "ᚪ", "ᚶ", "ᛔ", "ᛘ",
    "ᚮ", "ᚫ", "ᛛ", "ᛮ", "ᚿ", "ᚬ", "ᛩ", "ᚩ", "ᛆ", "ᚽ", "ᛀ", "ᚰ", "ᛑ", "ᚭ",
  ];

  /** Default Elder-Futhark-ish letter fillers (user-editable). */
  var DEFAULT_MAP = {
    a: "ᚨ",
    b: "ᛒ",
    c: "ᚲ",
    d: "ᛞ",
    e: "ᛖ",
    f: "ᚠ",
    g: "ᚷ",
    h: "ᚺ",
    i: "ᛁ",
    j: "ᛃ",
    k: "ᚲ",
    l: "ᛚ",
    m: "ᛗ",
    n: "ᚾ",
    o: "ᛟ",
    p: "ᛈ",
    q: "ᚲ",
    r: "ᚱ",
    s: "ᛊ",
    t: "ᛏ",
    u: "ᚢ",
    v: "ᚹ",
    w: "ᚹ",
    x: "ᛉ",
    y: "ᛃ",
    z: "ᛉ",
  };

  /** Built-in 2–3 letter blocks (user can add more / override via assign). */
  var DEFAULT_MULTI = [
    { from: "th", to: "ᚦ" },
    { from: "ng", to: "ᛜ" },
    { from: "ae", to: "ᚫ" },
    { from: "ing", to: "ᛝ" },
    { from: "st", to: "ᛥ" },
  ];

  var PROMPT_MAX = 7200;
  var ASPECT_KEY = "runes_aspect_v1";

  var state = {
    /**
     * Cipher blocks: English key (1–3 letters, a–z) → one rune.
     * Longer keys win when translating (greedy). Same rune may be bound to many keys.
     * @type {Array<{from:string,to:string}>}
     */
    blocks: [],
    selectedRune: null,
    assignBuffer: "",
    mode: "type", // type | assign
    started: false,
    busy: false,
    /** @type {Array<null|{kind:string,num:number,title:string,description:string,url:string,prompt:string}>} */
    spells: [null, null, null],
    generatedPool: [],
    paintingAnalyses: {},
    lod1Analyses: {},
    imageUrl: "",
    videoUrl: "",
  };

  function $(id) {
    return document.getElementById(id);
  }

  function apiUrl(path) {
    if (typeof window.galleryApiUrl === "function") return window.galleryApiUrl(path);
    var base = String(window.SPELLFORGE_API_BASE || "").replace(/\/$/, "");
    return base ? base + path : path;
  }

  function absoluteUrl(url) {
    if (!url) return "";
    if (/^(https?:|data:|blob:)/i.test(url)) return url;
    try {
      return new URL(url, window.location.href).href;
    } catch (e) {
      return url;
    }
  }

  function delayMs(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function getAspect() {
    var sel = $("ru-aspect");
    var v = sel && sel.value ? sel.value : "16:9";
    if (!/^\d+:\d+$/.test(v)) v = "16:9";
    return v;
  }

  function getDuration() {
    var sel = $("ru-duration");
    var n = sel ? parseInt(sel.value, 10) : 10;
    return n > 0 ? n : 10;
  }

  function setBusy(on) {
    state.busy = !!on;
    [
      "ru-btn-gen-image",
      "ru-btn-gen-video",
      "ru-btn-rebuild",
      "ru-btn-random-spells",
      "ru-btn-from-spellforge",
    ].forEach(function (id) {
      var el = $(id);
      if (el) el.disabled = !!on;
    });
  }

  function paintingUrl(num) {
    if (window.getPaintingUrl) return window.getPaintingUrl(num);
    return "paintings/" + num + ".jpg";
  }

  function getPaintingAnalysis(num) {
    var key = String(num);
    var a = null;
    if (window.getGalleryAnalyses) {
      var all = window.getGalleryAnalyses() || {};
      a = all[key] || all[num] || null;
    }
    if (!a) a = state.paintingAnalyses[key] || state.paintingAnalyses[num] || null;
    return a && typeof a === "object" ? a : null;
  }

  function getGeneratedAnalysis(num) {
    var key = String(num);
    var a = state.lod1Analyses[key] || state.lod1Analyses[num] || null;
    if (a) return a;
    for (var i = 0; i < state.generatedPool.length; i++) {
      if (state.generatedPool[i].num === num && state.generatedPool[i].analysis) {
        return state.generatedPool[i].analysis;
      }
    }
    return null;
  }

  function clip(s, n) {
    s = String(s || "").trim();
    if (s.length <= n) return s;
    return s.slice(0, Math.max(0, n - 1)).replace(/\s+\S*$/, "") + "…";
  }

  /** Full English payload for a spell — everything we can cipher into a long rune string. */
  function spellEnglishCorpus(s) {
    if (!s) return "";
    var chunks = [];
    if (s.title) chunks.push(String(s.title).trim());
    if (s.description) chunks.push(String(s.description).trim());
    if (s.prompt) chunks.push(String(s.prompt).trim());
    if (s.style) chunks.push("Style: " + String(s.style).trim());
    if (s.mood) chunks.push("Mood: " + String(s.mood).trim());
    if (s.medium) chunks.push("Medium: " + String(s.medium).trim());
    if (s.tags && s.tags.length) {
      chunks.push("Tags: " + (Array.isArray(s.tags) ? s.tags.join(", ") : String(s.tags)));
    }
    // Prefer description as the long "prompt" when prompt field is empty
    if (!s.prompt && s.description) {
      chunks.push(String(s.description).trim());
    }
    // Dedupe consecutive identical chunks
    var out = [];
    for (var i = 0; i < chunks.length; i++) {
      if (!chunks[i]) continue;
      if (out.length && out[out.length - 1] === chunks[i]) continue;
      out.push(chunks[i]);
    }
    return out.join("\n\n");
  }

  /**
   * Mass-produce runes: every English letter sequence → cipher blocks (same as live typing).
   * Does NOT clip — caller clips only for API max length.
   */
  function massCipherEnglish(text) {
    return englishToRunes(String(text || ""));
  }

  function loadAnalysisCaches() {
    var tasks = [];
    if (window.loadGalleryData) {
      tasks.push(
        window.loadGalleryData().then(function (data) {
          if (data && data.analyses) state.paintingAnalyses = data.analyses;
          return true;
        }).catch(function () {
          return false;
        })
      );
    }
    tasks.push(
      fetch(apiUrl("/api/lod1-analyses"), { cache: "no-store" })
        .then(function (r) {
          if (!r.ok) throw new Error("lod1");
          return r.json();
        })
        .then(function (d) {
          if (d && typeof d === "object") state.lod1Analyses = d;
          return true;
        })
        .catch(function () {
          return fetch("data/lod1-analyses.json", { cache: "no-store" })
            .then(function (r) {
              return r.ok ? r.json() : {};
            })
            .then(function (d) {
              if (d && typeof d === "object") state.lod1Analyses = d;
            })
            .catch(function () {});
        })
    );
    tasks.push(
      fetch("data/analyses.json", { cache: "no-store" })
        .then(function (r) {
          return r.ok ? r.json() : {};
        })
        .then(function (d) {
          if (d && typeof d === "object" && Object.keys(state.paintingAnalyses).length < 10) {
            state.paintingAnalyses = d;
          }
        })
        .catch(function () {})
    );
    return Promise.all(tasks);
  }

  /** Re-hydrate spell slots with full analyses so cipher has long text. */
  function refreshSpellTexts() {
    for (var i = 0; i < 3; i++) {
      var s = state.spells[i];
      if (!s || !s.num) continue;
      var full = resolveSpell(s.kind, s.num);
      if (full) state.spells[i] = full;
    }
  }

  function defaultBlocks() {
    var blocks = [];
    Object.keys(DEFAULT_MAP).forEach(function (letter) {
      blocks.push({ from: letter, to: DEFAULT_MAP[letter] });
    });
    DEFAULT_MULTI.forEach(function (b) {
      blocks.push({ from: b.from, to: b.to });
    });
    return blocks;
  }

  function normalizeBlockKey(raw) {
    return String(raw || "")
      .toLowerCase()
      .replace(/[^a-z]/g, "")
      .slice(0, 3);
  }

  function setBlock(from, to) {
    from = normalizeBlockKey(from);
    to = String(to || "").trim();
    if (!from || from.length < 1 || from.length > 3 || !to) return false;
    // One key → one rune (replace existing same key); many keys may share a rune
    var next = [];
    var replaced = false;
    state.blocks.forEach(function (b) {
      if (b.from === from) {
        next.push({ from: from, to: to });
        replaced = true;
      } else {
        next.push(b);
      }
    });
    if (!replaced) next.push({ from: from, to: to });
    state.blocks = next;
    saveMap();
    if (typeof scheduleSave === "function") scheduleSave();
    return true;
  }

  function removeBlock(from) {
    from = normalizeBlockKey(from);
    state.blocks = state.blocks.filter(function (b) {
      return b.from !== from;
    });
    saveMap();
    if (typeof scheduleSave === "function") scheduleSave();
  }

  function loadMap() {
    state.blocks = defaultBlocks();
    try {
      var raw = localStorage.getItem(MAP_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.blocks) && parsed.blocks.length) {
          state.blocks = [];
          parsed.blocks.forEach(function (b) {
            if (!b) return;
            var from = normalizeBlockKey(b.from);
            var to = String(b.to || "").trim();
            if (from && to) state.blocks.push({ from: from, to: to });
          });
          return;
        }
      }
      // Migrate v1 single-letter map
      var legacy = localStorage.getItem(MAP_KEY_LEGACY);
      if (legacy) {
        var old = JSON.parse(legacy);
        if (old && typeof old === "object" && !Array.isArray(old)) {
          state.blocks = defaultBlocks();
          Object.keys(old).forEach(function (k) {
            var key = normalizeBlockKey(k);
            if (key.length === 1 && old[k]) setBlock(key, old[k]);
          });
          saveMap();
        }
      }
    } catch (e) {
      state.blocks = defaultBlocks();
    }
  }

  function saveMap() {
    try {
      localStorage.setItem(MAP_KEY, JSON.stringify({ blocks: state.blocks }));
    } catch (e) {}
  }

  /** Sorted longest-first for greedy English → runes matching. */
  function blocksLongestFirst() {
    return state.blocks.slice().sort(function (a, b) {
      return b.from.length - a.from.length || a.from.localeCompare(b.from);
    });
  }

  /** Rune → list of English keys (for keyboard meta + reverse gloss). */
  function runeToKeys() {
    var rev = {};
    state.blocks.forEach(function (b) {
      if (!b || !b.to) return;
      if (!rev[b.to]) rev[b.to] = [];
      if (rev[b.to].indexOf(b.from) < 0) rev[b.to].push(b.from);
    });
    Object.keys(rev).forEach(function (r) {
      rev[r].sort(function (a, b) {
        return b.length - a.length || a.localeCompare(b);
      });
    });
    return rev;
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function setStatus(msg, kind) {
    var el = $("ru-status");
    if (!el) return;
    el.textContent = msg || "";
    el.className = "ru-status" + (kind ? " " + kind : "");
  }

  /**
   * Translate English → runes with greedy 3→2→1 letter block matching.
   * Repeated sequences (e.g. "tt", "ing") match every time they appear.
   */
  function englishToRunes(text) {
    var filler = ($("ru-filler") && $("ru-filler").value) || "·";
    var blocks = blocksLongestFirst();
    var out = "";
    var i = 0;
    var s = String(text || "");
    var lower = s.toLowerCase();
    while (i < s.length) {
      var ch = s.charAt(i);
      if (ch === " " || ch === "\n" || ch === "\t") {
        out += ch === "\n" ? "\n" : " ";
        i++;
        continue;
      }
      if (/[0-9]/.test(ch) || /[.,!?;:'"()\-—–/\\]/.test(ch)) {
        out += ch;
        i++;
        continue;
      }
      if (!/[a-z]/i.test(ch)) {
        out += ch;
        i++;
        continue;
      }
      var matched = false;
      for (var b = 0; b < blocks.length; b++) {
        var key = blocks[b].from;
        var len = key.length;
        if (len < 1) continue;
        if (lower.slice(i, i + len) === key) {
          out += blocks[b].to;
          i += len;
          matched = true;
          break;
        }
      }
      if (!matched) {
        out += filler || "·";
        i++;
      }
    }
    return out;
  }

  function runesToEnglish(text) {
    var rev = runeToKeys();
    var out = "";
    var s = String(text || "");
    // Walk by code point so multi-byte runes stay whole
    var chars = Array.from(s);
    for (var i = 0; i < chars.length; i++) {
      var ch = chars[i];
      if (ch === " " || ch === "\n" || ch === "\t") {
        out += ch;
        continue;
      }
      if (rev[ch] && rev[ch].length) {
        // Prefer shortest key for reverse gloss (usually a single letter)
        var keys = rev[ch].slice().sort(function (a, b) {
          return a.length - b.length || a.localeCompare(b);
        });
        out += keys[0];
      } else if (RUNES.indexOf(ch) >= 0) {
        out += "?";
      } else {
        out += ch;
      }
    }
    return out;
  }

  function activeSpells() {
    return state.spells.filter(function (s) {
      return s && s.num;
    });
  }

  function spellDnaParts() {
    refreshSpellTexts();
    var parts = [];
    activeSpells().forEach(function (s, i) {
      var label = s.kind === "generated" ? "Generated G#" + s.num : "Painting #" + s.num;
      var title = s.title || "Untitled";
      var desc = String(s.description || "").trim();
      var prompt = String(s.prompt || "").trim();
      // Long English corpus (description is the real product text for most paintings)
      var englishBlob = spellEnglishCorpus(s);
      // Mass-produce FULL length through cipher — same engine as typing English
      var titleRu = massCipherEnglish(title);
      var descRu = massCipherEnglish(desc);
      var promptRu = massCipherEnglish(prompt || desc);
      var runicBlob = massCipherEnglish(englishBlob);
      parts.push({
        index: i + 1,
        label: label,
        kind: s.kind,
        num: s.num,
        title: title,
        description: desc,
        prompt: prompt || desc,
        englishBlob: englishBlob,
        titleRu: titleRu,
        descRu: descRu,
        promptRu: promptRu,
        runicBlob: runicBlob,
        enChars: englishBlob.length,
        runeChars: runicBlob.length,
      });
    });
    return parts;
  }

  function spellDnaBlockEnglish(parts) {
    return parts
      .map(function (p) {
        return (
          "Spell " +
          p.index +
          " (" +
          p.label +
          ") — " +
          p.enChars +
          " English chars → " +
          p.runeChars +
          " runes\n" +
          "Title: " +
          p.title +
          "\n" +
          (p.description ? "Description:\n" + p.description + "\n" : "") +
          (p.prompt && p.prompt !== p.description ? "Prompt:\n" + p.prompt + "\n" : "")
        );
      })
      .join("\n\n");
  }

  /** Lengthy mass-ciphered spell DNA only — full description/prompt as runes. */
  function spellDnaRunesOnly(parts) {
    return parts
      .map(function (p) {
        return (
          "—— Spell " +
          p.index +
          " " +
          p.label +
          " (" +
          p.runeChars +
          " runes) ——\n" +
          (p.runicBlob || "—")
        );
      })
      .join("\n\n");
  }

  /**
   * One continuous mass-produced runic document:
   * typed English cast + every spell's full English corpus, all through the cipher.
   */
  function massProduceRunicDocument(english, parts) {
    var sections = [];
    var castRu = massCipherEnglish(english);
    if (castRu.trim()) {
      sections.push(castRu.trim());
    }
    parts.forEach(function (p) {
      if (p.runicBlob && p.runicBlob.trim()) {
        sections.push(p.runicBlob.trim());
      }
    });
    return sections.join("\n\n");
  }

  /**
   * Build cast package with cipher ALWAYS applied via current blocks.
   * Mass-produces lengthy rune strings from full spell descriptions (not short titles only).
   */
  function buildPromptPackage(opts) {
    opts = opts || {};
    var forceCipher = opts.forceCipher !== false;
    var syncFields = opts.syncFields !== false;

    refreshSpellTexts();

    var english = ($("ru-english") && $("ru-english").value) || "";
    var runesField = ($("ru-runes") && $("ru-runes").value) || "";

    // Always mass-cipher English cast with current blocks (same as live typing)
    var runesFromEnglish = english.trim() ? massCipherEnglish(english) : "";
    var runes =
      forceCipher && runesFromEnglish
        ? runesFromEnglish
        : runesField.trim() || runesFromEnglish;
    if (!english.trim() && runesField.trim()) {
      english = runesToEnglish(runesField);
    }

    if (syncFields && forceCipher && runesFromEnglish) {
      var ruEl = $("ru-runes");
      if (ruEl) ruEl.value = runesFromEnglish;
      runes = runesFromEnglish;
      var prev = $("ru-live-preview");
      if (prev) {
        prev.textContent = runesFromEnglish;
        prev.classList.remove("ru-preview-empty");
      }
    }

    var parts = spellDnaParts();
    var dnaEn = spellDnaBlockEnglish(parts);
    var dnaRu = spellDnaRunesOnly(parts);
    // Full mass-produced runic prompt (cast + all spell DNA as long rune strings)
    var massRunes = massProduceRunicDocument(english, parts);

    var totalRuneChars = massRunes.length;
    var totalEnChars =
      english.length +
      parts.reduce(function (n, p) {
        return n + (p.enChars || 0);
      }, 0);

    // Generation package: lengthy ciphered runes are THE prompt
    var packageText = [
      "=== MASS CIPHERED RUNIC PROMPT (" +
        totalEnChars +
        " English chars → " +
        totalRuneChars +
        " runes) ===",
      "Render these rune characters as the written subject. Do not replace them with Latin letters.",
      "",
      massRunes.trim() || "—",
      "",
      "=== BREAKDOWN ===",
      "YOUR CAST (ciphered from English typing):",
      runes.trim() || "—",
      "",
      parts.length ? "SPELL DNA (each full description/prompt mass-ciphered):" : "",
      parts.length ? dnaRu : "",
      "",
      "=== ENGLISH SOURCE (reference only) ===",
      english.trim() || "—",
      parts.length ? dnaEn : "",
      "",
      "Aspect " +
        getAspect() +
        ". Full-bleed single scene. Paint the lengthy runic script above. Ritual stone, aurora, ceremonial ink.",
    ]
      .filter(function (line, idx, arr) {
        if (line === "" && arr[idx - 1] === "") return false;
        return true;
      })
      .join("\n");

    // API body: lead with the mass-produced runes (clip only here)
    var stasisCore = [
      "MASS CIPHERED RUNIC PROMPT — paint these glyphs:\n" + (massRunes.trim() || "—"),
      "ENGLISH SOURCE (secondary):\n" +
        (english.trim() || "—") +
        (parts.length
          ? "\n\n" +
            parts
              .map(function (p) {
                return (
                  p.label +
                  ":\n" +
                  p.englishBlob
                );
              })
              .join("\n\n")
          : ""),
      "Aspect " + getAspect() + ". Full bleed. Rune glyphs are primary subject.",
    ].join("\n\n");

    var stasis = clip(stasisCore, PROMPT_MAX);

    return {
      english: english.trim(),
      runes: runes.trim(),
      massRunes: massRunes.trim(),
      packageText: packageText,
      stasis: stasis,
      parts: parts,
      totalRuneChars: totalRuneChars,
      totalEnChars: totalEnChars,
    };
  }

  /** Always rebuild with full mass-cipher — never send short title-only stubs. */
  function generationPromptText() {
    var pack = rebuildPrompt({ forceCipher: true, quiet: true });
    return clip(pack.packageText, PROMPT_MAX);
  }

  function extractImageUrl(payload) {
    if (!payload) return "";
    var img = payload.image || (payload.images && payload.images[0]);
    var raw =
      (img && (img.url || img.download_url || img.uri)) ||
      payload.image_url ||
      payload.output_url ||
      "";
    return absoluteUrl(raw);
  }

  function extractVideoUrl(payload) {
    if (!payload) return "";
    var vid = payload.video;
    var raw =
      (vid && (vid.url || vid.download_url || vid.uri)) ||
      payload.video_url ||
      "";
    if (window.GallerySaveVideo && window.GallerySaveVideo.preferSavedUrl) {
      raw = window.GallerySaveVideo.preferSavedUrl(payload, raw) || raw;
    }
    return absoluteUrl(raw);
  }

  function showMediaImage(url) {
    state.imageUrl = absoluteUrl(url);
    var img = $("ru-preview-img");
    var vid = $("ru-preview-video");
    var empty = $("ru-preview-empty");
    if (vid) {
      vid.hidden = true;
      try {
        vid.pause();
      } catch (e) {}
    }
    if (img) {
      img.src = state.imageUrl;
      img.hidden = false;
    }
    if (empty) empty.hidden = true;
  }

  function showMediaVideo(url) {
    state.videoUrl = absoluteUrl(url);
    var img = $("ru-preview-img");
    var vid = $("ru-preview-video");
    var empty = $("ru-preview-empty");
    if (img) img.hidden = true;
    if (vid) {
      vid.src = state.videoUrl;
      vid.hidden = false;
      try {
        vid.play().catch(function () {});
      } catch (e) {}
    }
    if (empty) empty.hidden = true;
  }

  function pollImageJob(jobId, left) {
    if (left == null) left = 100;
    if (left <= 0) return Promise.reject(new Error("Timed out waiting for image."));
    return fetch(apiUrl("/api/jobs/" + encodeURIComponent(jobId)), { cache: "no-store" })
      .then(function (r) {
        return r.json().then(function (d) {
          return { ok: r.ok, d: d };
        });
      })
      .then(function (res) {
        var job = res.d || {};
        var st = String(job.status || "working").toLowerCase();
        setStatus("Generating still… " + st + " (" + left + ")");
        if (st === "done" || st === "completed" || st === "success") {
          var url = extractImageUrl(job);
          if (url) return url;
          throw new Error("Job finished but no image URL.");
        }
        if (st === "failed" || st === "error" || st === "expired") {
          throw new Error(
            (job.error && (job.error.message || job.error)) || "Image job failed"
          );
        }
        return delayMs(1500).then(function () {
          return pollImageJob(jobId, left - 1);
        });
      });
  }

  function pollVideoJob(jobId, left) {
    if (left == null) left = 120;
    if (left <= 0) return Promise.reject(new Error("Timed out waiting for video."));
    return fetch(apiUrl("/api/jobs/" + encodeURIComponent(jobId)), { cache: "no-store" })
      .then(function (r) {
        return r.json().then(function (d) {
          return { ok: r.ok, d: d };
        });
      })
      .then(function (res) {
        var job = res.d || {};
        var st = String(job.status || "working").toLowerCase();
        setStatus("Animating video… " + st + " (" + left + ")");
        if (st === "done" || st === "completed" || st === "success") {
          var url = extractVideoUrl(job);
          if (url) return url;
          throw new Error("Video job finished but no URL.");
        }
        if (st === "failed" || st === "error" || st === "expired") {
          throw new Error(
            (job.error && (job.error.message || job.error)) || "Video job failed"
          );
        }
        return delayMs(2000).then(function () {
          return pollVideoJob(jobId, left - 1);
        });
      });
  }

  function saveImageToGallery(url) {
    url = absoluteUrl(url || state.imageUrl);
    if (!url) return Promise.resolve(null);
    var pack = buildPromptPackage();
    return fetch(apiUrl("/api/save-generated-image"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_url: url,
        source: "runes",
        collection: "generated",
        description: clip(pack.english || pack.runes || "Runic cast", 160),
        meta: {
          source: "runes",
          aspect: getAspect(),
          runes: pack.runes.slice(0, 200),
          english: pack.english.slice(0, 200),
        },
      }),
    })
      .then(function (r) {
        return r.json().then(function (d) {
          if (!r.ok || (d && d.ok === false)) return null;
          if (d && d.url) {
            state.imageUrl = absoluteUrl(d.url);
            var img = $("ru-preview-img");
            if (img) img.src = state.imageUrl;
          }
          return d;
        });
      })
      .catch(function () {
        return null;
      });
  }

  function saveVideoToGallery(url) {
    url = absoluteUrl(url || state.videoUrl);
    if (!url) return Promise.resolve(null);
    var chain;
    if (window.GallerySaveVideo && window.GallerySaveVideo.save) {
      chain = window.GallerySaveVideo.save(url, { force: true, timeoutMs: 180000 });
    } else {
      chain = fetch(apiUrl("/api/save-video"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url, force_mp4: true }),
      }).then(function (r) {
        return r.json();
      });
    }
    return chain
      .then(function (d) {
        if (d && d.url) {
          state.videoUrl = absoluteUrl(d.url);
          var vid = $("ru-preview-video");
          if (vid) vid.src = state.videoUrl;
        }
        return d;
      })
      .catch(function () {
        return null;
      });
  }

  function buildGenerateBody(jobId) {
    // Force-apply current cipher to cast + all spell DNA before send
    var pack = rebuildPrompt({ forceCipher: true, quiet: true });
    var prompt = clip(pack.packageText, PROMPT_MAX);
    var spells = activeSpells();
    var parts = pack.parts || spellDnaParts();
    var spellNums = spells
      .filter(function (s) {
        return s.kind === "painting";
      })
      .map(function (s) {
        return s.num;
      });
    var spellDetails = spells.map(function (s, i) {
      var p = parts[i] || {};
      return {
        number: s.num,
        url: s.url || (s.kind === "generated" ? "/generated/" + s.num + ".jpg" : paintingUrl(s.num)),
        title: s.title || "",
        description: clip(s.description || "", 400),
        prompt: clip(s.prompt || "", 200),
        // Ciphered fields for the server / model path
        title_runes: p.titleRu || englishToRunes(s.title || ""),
        description_runes: p.descRu || englishToRunes(s.description || ""),
        prompt_runes: p.promptRu || englishToRunes(s.prompt || ""),
        dna_runes: p.runicBlob || englishToRunes([s.title, s.description, s.prompt].filter(Boolean).join(". ")),
        source: s.kind === "generated" ? "generated" : "painting",
        slot: i,
      };
    });
    var buzz = [
      "runes",
      "ciphered runic script",
      "incantation",
      "paint rune glyphs",
      "full bleed",
      "aspect " + getAspect(),
    ];
    // Include a few ciphered tokens so buzz does not only send English
    if (pack.runes) {
      buzz.push("cast:" + pack.runes.slice(0, 24));
    }
    return {
      job_id: jobId,
      stasis: clip(pack.stasis || prompt, PROMPT_MAX),
      prompt: prompt,
      fused_prompt: prompt,
      buzz_words: buzz.slice(0, 16),
      spells: spellNums,
      spell_details: spellDetails,
      aspect_ratio: getAspect(),
      mag_fresh: true,
      fresh_variation: true,
      spell_cast: spellDetails.length > 0,
    };
  }

  function generateStill() {
    var bodyPreview = buildGenerateBody(
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : "runes-" + Date.now()
    );
    var prompt = bodyPreview.prompt || "";
    if (!prompt || prompt.length < 12 || (!bodyPreview.stasis || bodyPreview.stasis.indexOf("—") === 0)) {
      var hasCast =
        (($("ru-english") && $("ru-english").value.trim()) ||
          ($("ru-runes") && $("ru-runes").value.trim()) ||
          activeSpells().length);
      if (!hasCast) {
        setStatus("Build an incantation (English/runes) and/or equip spell DNA first.", "err");
        return;
      }
    }
    var jobId = bodyPreview.job_id;
    var body = bodyPreview;
    saveSession(true);
    setBusy(true);
    setStatus("Casting still @ " + getAspect() + " (cipher applied to cast + spell DNA)…");
    fetch(apiUrl("/api/generate-stasis-vision"), {
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
          return pollImageJob(d.job_id || jobId);
        }
        if (!res.ok) {
          var err = (d && d.error && d.error.message) || (d && d.error) || "Generate failed";
          throw new Error(typeof err === "string" ? err : JSON.stringify(err));
        }
        var url = extractImageUrl(d);
        if (!url && d.job_id) return pollImageJob(d.job_id);
        if (!url) throw new Error("No image returned");
        return url;
      })
      .then(function (url) {
        showMediaImage(url);
        setStatus("Still ready — saving to Generated…");
        saveSession(true);
        return saveImageToGallery(url).then(function (saved) {
          setStatus(
            "Runic still ready" +
              (saved && saved.num != null ? " · Generated #" + saved.num : "") +
              ". Session saved. Gallery → Generated.",
            "ok"
          );
          saveSession(true);
        });
      })
      .catch(function (err) {
        setStatus(
          (err && err.message) ||
            "Generate failed — is start_server.bat running with an API key?",
          "err"
        );
      })
      .then(function () {
        setBusy(false);
      });
  }

  function generateVideo() {
    var aspect = getAspect();
    var duration = getDuration();
    var jobId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : "runes-v-" + Date.now();
    var body = buildGenerateBody(jobId);
    if (!body.prompt || body.prompt.length < 12) {
      setStatus("Build an incantation (English/runes) and/or equip spell DNA first.", "err");
      return;
    }
    saveSession(true);
    setBusy(true);
    setStatus("Casting still for video @ " + aspect + " (cipher applied)…");
    fetch(apiUrl("/api/generate-stasis-vision"), {
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
          return pollImageJob(d.job_id || jobId);
        }
        if (!res.ok) {
          var err = (d && d.error && d.error.message) || (d && d.error) || "Still failed";
          throw new Error(typeof err === "string" ? err : JSON.stringify(err));
        }
        var url = extractImageUrl(d);
        if (!url && d.job_id) return pollImageJob(d.job_id);
        if (!url) throw new Error("No still for video");
        return url;
      })
      .then(function (stillUrl) {
        showMediaImage(stillUrl);
        setStatus("Animating video (" + duration + "s)…");
        return saveImageToGallery(stillUrl).then(function () {
          return fetch(apiUrl("/api/animate-cast"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              wait: false,
              wait_for_result: false,
              stasis: clip(body.stasis, 4000),
              prompt: clip(body.prompt, 4000),
              duration: duration,
              resolution: "720p",
              aspect_ratio: aspect,
              image_url: stillUrl,
              reference_image: stillUrl,
            }),
            cache: "no-store",
          });
        });
      })
      .then(function (r) {
        return r.json().then(function (d) {
          if (!r.ok) {
            throw new Error((d && d.error) || "Video failed");
          }
          var jid = d.job_id || d.id;
          if (jid) return pollVideoJob(jid);
          var url = extractVideoUrl(d);
          if (url) return url;
          throw new Error("No video job id");
        });
      })
      .then(function (url) {
        showMediaVideo(url);
        setStatus("Video ready — saving…");
        return saveVideoToGallery(url).then(function () {
          setStatus("Runic video ready · saved under Gallery videos.", "ok");
        });
      })
      .catch(function (err) {
        setStatus((err && err.message) || "Video generate failed.", "err");
      })
      .then(function () {
        setBusy(false);
      });
  }

  function resolveSpell(kind, num) {
    num = parseInt(num, 10);
    if (!num || num < 1) return null;
    if (kind === "generated") {
      var g = null;
      for (var i = 0; i < state.generatedPool.length; i++) {
        if (state.generatedPool[i].num === num) {
          g = state.generatedPool[i];
          break;
        }
      }
      var a = getGeneratedAnalysis(num) || (g && g.analysis) || {};
      var desc = String(a.description || "").trim();
      var pr = String(a.prompt || "").trim();
      return {
        kind: "generated",
        num: num,
        title: a.title || (g && g.title) || "Generated #" + num,
        description: desc,
        // Paintings/LOD1 often lack prompt — use description as the long text to cipher
        prompt: pr || desc,
        style: a.style || "",
        mood: a.mood || "",
        medium: a.medium || "",
        tags: a.tags || [],
        url: (g && (g.url || g.generatedUrl)) || "/generated/" + num + ".jpg",
      };
    }
    var pa = getPaintingAnalysis(num) || {};
    var pdesc = String(pa.description || "").trim();
    var ppr = String(pa.prompt || "").trim();
    return {
      kind: "painting",
      num: num,
      title: pa.title || "Painting #" + num,
      description: pdesc,
      prompt: ppr || pdesc,
      style: pa.style || "",
      mood: pa.mood || "",
      medium: pa.medium || "",
      tags: pa.tags || [],
      url: paintingUrl(num),
    };
  }

  function updateSpellMeta() {
    var el = $("ru-spell-meta");
    if (!el) return;
    var n = activeSpells().length;
    el.textContent =
      n === 0
        ? "Spells: none — pure rune cast"
        : "Spells: " +
          n +
          " source" +
          (n === 1 ? "" : "s") +
          " folded into prompt DNA";
  }

  function renderSpellSlots() {
    var host = $("ru-spell-slots");
    if (!host) return;
    host.innerHTML = "";
    var names = ["I", "II", "III"];
    for (var i = 0; i < 3; i++) {
      (function (slot) {
        var s = state.spells[slot];
        var card = document.createElement("div");
        card.className = "ru-spell-slot";
        card.innerHTML =
          '<div class="ru-spell-slot-head"><span>Spell ' +
          names[slot] +
          '</span><button type="button" class="btn-secondary ru-spell-clear" data-slot="' +
          slot +
          '" style="padding:0.15rem 0.4rem;font-size:0.7rem">Clear</button></div>' +
          '<label class="ru-label">Source</label>' +
          '<select class="ru-spell-kind" data-slot="' +
          slot +
          '">' +
          '<option value="painting"' +
          (!s || s.kind === "painting" ? " selected" : "") +
          ">Painting</option>" +
          '<option value="generated"' +
          (s && s.kind === "generated" ? " selected" : "") +
          ">Generated</option>" +
          "</select>" +
          '<label class="ru-label">Number</label>' +
          '<input type="number" class="ru-spell-num" data-slot="' +
          slot +
          '" min="1" max="99999" placeholder="#" value="' +
          (s && s.num ? s.num : "") +
          '" />' +
          '<img class="ru-spell-thumb' +
          (s && s.url ? " show" : "") +
          '" data-slot="' +
          slot +
          '" alt="" ' +
          (s && s.url ? 'src="' + escapeHtml(s.url) + '"' : "") +
          " />" +
          '<div class="ru-spell-title" data-slot="' +
          slot +
          '">' +
          escapeHtml(s ? s.title || "" : "—") +
          "</div>" +
          (s
            ? '<div class="ru-source">' +
              escapeHtml(
                String((s.description || s.prompt || "").length) +
                  " English chars ready to mass-cipher"
              ) +
              "</div>"
            : "");
        host.appendChild(card);
      })(i);
    }

    host.querySelectorAll(".ru-spell-kind").forEach(function (sel) {
      sel.addEventListener("change", function () {
        var slot = parseInt(sel.getAttribute("data-slot"), 10);
        var numInp = host.querySelector('.ru-spell-num[data-slot="' + slot + '"]');
        var num = numInp ? parseInt(numInp.value, 10) : 0;
        if (num) applySpellSlot(slot, sel.value, num);
      });
    });
    host.querySelectorAll(".ru-spell-num").forEach(function (inp) {
      inp.addEventListener("change", function () {
        var slot = parseInt(inp.getAttribute("data-slot"), 10);
        var kindSel = host.querySelector('.ru-spell-kind[data-slot="' + slot + '"]');
        var kind = kindSel ? kindSel.value : "painting";
        applySpellSlot(slot, kind, parseInt(inp.value, 10));
      });
    });
    host.querySelectorAll(".ru-spell-clear").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var slot = parseInt(btn.getAttribute("data-slot"), 10);
        state.spells[slot] = null;
        renderSpellSlots();
        updateSpellMeta();
        rebuildPrompt();
      });
    });
    updateSpellMeta();
  }

  function applySpellSlot(slot, kind, num) {
    var resolved = resolveSpell(kind, num);
    state.spells[slot] = resolved;
    renderSpellSlots();
    updateSpellMeta();
    rebuildPrompt();
    if (resolved) {
      setStatus(
        "Spell " +
          (slot + 1) +
          ": " +
          (resolved.kind === "generated" ? "G#" : "#") +
          resolved.num +
          " · " +
          (resolved.title || ""),
        "ok"
      );
    } else {
      setStatus("Could not resolve that spell number.", "err");
    }
  }

  function loadGeneratedPool() {
    return fetch(apiUrl("/api/transfer/spell-assets?t=" + Date.now()), {
      cache: "no-store",
    })
      .then(function (r) {
        if (!r.ok) return [];
        return r.json();
      })
      .then(function (d) {
        var items = (d && d.items) || [];
        state.generatedPool = items.map(function (it) {
          return {
            num: parseInt(it.number, 10),
            title: it.title || "",
            url: it.url || it.generatedUrl || "",
            analysis: it.analysis || null,
          };
        }).filter(function (x) {
          return x.num > 0;
        });
        return state.generatedPool.length;
      })
      .catch(function () {
        state.generatedPool = [];
        return 0;
      });
  }

  function randomPaintings() {
    var nums = [];
    var tries = 0;
    while (nums.length < 3 && tries < 80) {
      tries++;
      var n = 1 + Math.floor(Math.random() * 1000);
      if (nums.indexOf(n) >= 0) continue;
      nums.push(n);
    }
    for (var i = 0; i < 3; i++) {
      state.spells[i] = resolveSpell("painting", nums[i]);
    }
    renderSpellSlots();
    updateSpellMeta();
    rebuildPrompt();
    setStatus("Loaded 3 random paintings as spell DNA.", "ok");
  }

  function fromSpellforgeEquipped() {
    var nums = [];
    if (window.SpellforgeAPI && window.SpellforgeAPI.getEquippedSlots) {
      var slots = window.SpellforgeAPI.getEquippedSlots() || [];
      slots.forEach(function (n) {
        if (n) nums.push(n);
      });
    }
    if (!nums.length) {
      setStatus("Spellforge has no equipped spells — equip I–III there first, or use Random.", "err");
      return;
    }
    for (var i = 0; i < 3; i++) {
      if (nums[i]) {
        // Spellforge may use GEN_BASE + n for generated
        var n = parseInt(nums[i], 10);
        if (n > 100000) {
          state.spells[i] = resolveSpell("generated", n - 100000);
        } else {
          state.spells[i] = resolveSpell("painting", n);
        }
      } else {
        state.spells[i] = null;
      }
    }
    renderSpellSlots();
    updateSpellMeta();
    rebuildPrompt();
    setStatus("Imported equipped Spellforge spells.", "ok");
  }

  function syncFromEnglish() {
    var en = $("ru-english");
    var ru = $("ru-runes");
    var prev = $("ru-live-preview");
    if (!en || !ru) return;
    var runes = englishToRunes(en.value);
    ru.value = runes;
    if (prev) {
      if (runes.trim()) {
        prev.textContent = runes;
        prev.classList.remove("ru-preview-empty");
      } else {
        prev.textContent = "Type English or tap runes…";
        prev.classList.add("ru-preview-empty");
      }
    }
    persistDraft();
  }

  function syncFromRunes() {
    var en = $("ru-english");
    var ru = $("ru-runes");
    var prev = $("ru-live-preview");
    if (!en || !ru) return;
    // Don't overwrite English if user is hand-editing runes unless empty
    if (!en.value.trim()) {
      en.value = runesToEnglish(ru.value);
    }
    if (prev) {
      if (ru.value.trim()) {
        prev.textContent = ru.value;
        prev.classList.remove("ru-preview-empty");
      } else {
        prev.textContent = "Type English or tap runes…";
        prev.classList.add("ru-preview-empty");
      }
    }
    persistDraft();
  }

  function collectSession() {
    var spells = state.spells.map(function (s) {
      if (!s) return null;
      return {
        kind: s.kind,
        num: s.num,
        title: s.title || "",
        description: s.description || "",
        prompt: s.prompt || "",
        url: s.url || "",
      };
    });
    return {
      v: 3,
      savedAt: Date.now(),
      english: ($("ru-english") && $("ru-english").value) || "",
      runes: ($("ru-runes") && $("ru-runes").value) || "",
      filler: ($("ru-filler") && $("ru-filler").value) || "·",
      promptOut: ($("ru-prompt-out") && $("ru-prompt-out").value) || "",
      aspect: getAspect(),
      duration: getDuration(),
      spells: spells,
      blocks: state.blocks.slice(),
      imageUrl: state.imageUrl || "",
      videoUrl: state.videoUrl || "",
    };
  }

  function saveSession(quiet) {
    try {
      var data = collectSession();
      localStorage.setItem(SESSION_KEY, JSON.stringify(data));
      // Keep legacy keys in sync
      localStorage.setItem(
        INCANT_KEY,
        JSON.stringify({ english: data.english, runes: data.runes })
      );
      localStorage.setItem(FILLER_KEY, data.filler || "·");
      localStorage.setItem(ASPECT_KEY, data.aspect || "16:9");
      saveMap();
      if (!quiet) {
        var when = new Date(data.savedAt).toLocaleString();
        setStatus("Session saved (" + when + "). Safe to refresh.", "ok");
      }
      var stamp = $("ru-save-stamp");
      if (stamp) stamp.textContent = "Saved " + new Date(data.savedAt).toLocaleTimeString();
      return true;
    } catch (e) {
      if (!quiet) setStatus("Could not save session (storage full?).", "err");
      return false;
    }
  }

  function applySession(d) {
    if (!d || typeof d !== "object") return false;
    if ($("ru-english") && d.english != null) $("ru-english").value = d.english;
    if ($("ru-runes") && d.runes != null) $("ru-runes").value = d.runes;
    if ($("ru-filler") && d.filler != null) $("ru-filler").value = d.filler;
    if ($("ru-prompt-out") && d.promptOut != null) $("ru-prompt-out").value = d.promptOut;
    if ($("ru-aspect") && d.aspect) $("ru-aspect").value = d.aspect;
    if ($("ru-duration") && d.duration) $("ru-duration").value = String(d.duration);
    if (Array.isArray(d.blocks) && d.blocks.length) {
      state.blocks = d.blocks
        .map(function (b) {
          return b && b.from && b.to
            ? { from: normalizeBlockKey(b.from), to: String(b.to) }
            : null;
        })
        .filter(Boolean);
    }
    if (Array.isArray(d.spells)) {
      state.spells = [null, null, null];
      for (var i = 0; i < 3; i++) {
        var s = d.spells[i];
        if (s && s.num) {
          state.spells[i] = {
            kind: s.kind === "generated" ? "generated" : "painting",
            num: parseInt(s.num, 10),
            title: s.title || "",
            description: s.description || "",
            prompt: s.prompt || "",
            url: s.url || "",
          };
        }
      }
    }
    if (d.imageUrl) showMediaImage(d.imageUrl);
    if (d.videoUrl) showMediaVideo(d.videoUrl);
    var prev = $("ru-live-preview");
    if (prev && d.runes) {
      prev.textContent = d.runes;
      prev.classList.remove("ru-preview-empty");
    }
    var stamp = $("ru-save-stamp");
    if (stamp && d.savedAt) {
      stamp.textContent = "Restored " + new Date(d.savedAt).toLocaleString();
    }
    return true;
  }

  function restoreSession() {
    try {
      var raw = localStorage.getItem(SESSION_KEY);
      if (raw) {
        var d = JSON.parse(raw);
        if (applySession(d)) return true;
      }
    } catch (e) {}
    // Legacy draft only
    try {
      var f = localStorage.getItem(FILLER_KEY);
      if (f != null && $("ru-filler")) $("ru-filler").value = f;
      var raw2 = localStorage.getItem(INCANT_KEY);
      if (!raw2) return false;
      var d2 = JSON.parse(raw2);
      if ($("ru-english") && d2.english != null) $("ru-english").value = d2.english;
      if ($("ru-runes") && d2.runes != null) $("ru-runes").value = d2.runes;
      var prev = $("ru-live-preview");
      if (prev && d2.runes) {
        prev.textContent = d2.runes;
        prev.classList.remove("ru-preview-empty");
      }
      return true;
    } catch (e2) {
      return false;
    }
  }

  function persistDraft() {
    saveSession(true);
  }

  function restoreDraft() {
    restoreSession();
  }

  function exportSessionFile() {
    saveSession(true);
    var data = collectSession();
    var blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "runes-session-" + new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-") + ".json";
    a.click();
    setTimeout(function () {
      try {
        URL.revokeObjectURL(a.href);
      } catch (e) {}
    }, 2000);
    setStatus("Exported session JSON download.", "ok");
  }

  function importSessionFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var d = JSON.parse(String(reader.result || ""));
        if (!applySession(d)) throw new Error("bad file");
        saveMap();
        renderMapGrid();
        renderKeyboard();
        renderSpellSlots();
        rebuildPrompt({ forceCipher: true, quiet: true });
        saveSession(true);
        setStatus("Imported session from file.", "ok");
      } catch (e) {
        setStatus("Import failed — not a valid runes session file.", "err");
      }
    };
    reader.readAsText(file);
  }

  var _saveTimer = null;
  function scheduleSave() {
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(function () {
      saveSession(true);
    }, 400);
  }

  function insertRune(rune) {
    var ru = $("ru-runes");
    if (!ru) return;
    var start = ru.selectionStart != null ? ru.selectionStart : ru.value.length;
    var end = ru.selectionEnd != null ? ru.selectionEnd : start;
    var v = ru.value;
    ru.value = v.slice(0, start) + rune + v.slice(end);
    var pos = start + rune.length;
    ru.focus();
    try {
      ru.setSelectionRange(pos, pos);
    } catch (e) {}
    syncFromRunes();
  }

  function renderKeyboard() {
    var kb = $("ru-keyboard");
    if (!kb) return;
    var rev = runeToKeys();
    kb.innerHTML = "";
    RUNES.forEach(function (rune) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ru-key";
      if (rev[rune] && rev[rune].length) btn.classList.add("mapped");
      if (state.selectedRune === rune) btn.classList.add("selected");
      var meta =
        rev[rune] && rev[rune].length
          ? rev[rune].slice(0, 3).join("·")
          : "·";
      btn.innerHTML =
        escapeHtml(rune) + '<span class="ru-key-meta">' + escapeHtml(meta) + "</span>";
      btn.title =
        "Rune " +
        rune +
        (rev[rune] ? " ← " + rev[rune].join(", ").toUpperCase() : " (unmapped)") +
        (state.mode === "assign"
          ? " — select, then type 1–3 letters + Enter"
          : " — insert");
      btn.addEventListener("click", function () {
        if (state.mode === "assign") {
          state.selectedRune = rune;
          state.assignBuffer = "";
          renderKeyboard();
          updateAssignHud();
          setStatus(
            "Selected " +
              rune +
              " — type 1–3 English letters (a–z), Enter to save, Esc to cancel. Digraphs/trigraphs allowed (e.g. th, ing).",
            "ok"
          );
          return;
        }
        insertRune(rune);
        setStatus("Inserted " + rune, "ok");
      });
      kb.appendChild(btn);
    });
  }

  function updateAssignHud() {
    var hud = $("ru-assign-hud");
    if (!hud) return;
    if (state.mode !== "assign") {
      hud.hidden = true;
      return;
    }
    hud.hidden = false;
    if (!state.selectedRune) {
      hud.textContent = "Assign: tap a rune, then type a 1–3 letter key.";
      return;
    }
    hud.textContent =
      "Assign " +
      state.selectedRune +
      " ← [" +
      (state.assignBuffer || "…") +
      "]  (" +
      state.assignBuffer.length +
      "/3) · Enter save · Esc cancel · Backspace edit";
  }

  function renderMapGrid() {
    var grid = $("ru-map-grid");
    if (!grid) return;
    grid.innerHTML = "";

    // Multi-letter blocks first (2–3)
    var multi = state.blocks
      .filter(function (b) {
        return b.from.length >= 2;
      })
      .sort(function (a, b) {
        return b.from.length - a.from.length || a.from.localeCompare(b.from);
      });

    if (multi.length) {
      var multiHead = document.createElement("div");
      multiHead.className = "ru-map-section-label";
      multiHead.textContent = "2–3 letter blocks (matched first when translating)";
      multiHead.style.gridColumn = "1 / -1";
      grid.appendChild(multiHead);
      multi.forEach(function (b) {
        var cell = document.createElement("div");
        cell.className = "ru-map-cell ru-map-cell-multi";
        cell.innerHTML =
          '<label>' +
          escapeHtml(b.from.toUpperCase()) +
          "</label>" +
          '<div class="ru-map-multi-row">' +
          '<span class="ru-map-multi-rune">' +
          escapeHtml(b.to) +
          "</span>" +
          '<button type="button" class="btn-secondary ru-map-remove" data-from="' +
          escapeHtml(b.from) +
          '" style="padding:0.15rem 0.4rem;font-size:0.65rem">×</button>' +
          "</div>";
        grid.appendChild(cell);
      });
    }

    var singleHead = document.createElement("div");
    singleHead.className = "ru-map-section-label";
    singleHead.textContent = "Single letters A–Z";
    singleHead.style.gridColumn = "1 / -1";
    grid.appendChild(singleHead);

    var singleMap = {};
    state.blocks.forEach(function (b) {
      if (b.from.length === 1) singleMap[b.from] = b.to;
    });

    "abcdefghijklmnopqrstuvwxyz".split("").forEach(function (letter) {
      var cell = document.createElement("div");
      cell.className = "ru-map-cell";
      var lab = document.createElement("label");
      lab.htmlFor = "ru-map-" + letter;
      lab.textContent = letter.toUpperCase();
      var inp = document.createElement("input");
      inp.id = "ru-map-" + letter;
      inp.type = "text";
      inp.maxLength = 2;
      inp.value = singleMap[letter] || "";
      inp.setAttribute("aria-label", "Rune for letter " + letter.toUpperCase());
      inp.addEventListener("input", function () {
        var v = (inp.value || "").trim();
        if (v.length > 1) {
          var chars = Array.from(v);
          v = chars[chars.length - 1] || "";
          inp.value = v;
        }
        if (v) setBlock(letter, v);
        else removeBlock(letter);
        renderKeyboard();
        renderMapGrid();
        syncFromEnglish();
      });
      cell.appendChild(lab);
      cell.appendChild(inp);
      grid.appendChild(cell);
    });

    grid.querySelectorAll(".ru-map-remove").forEach(function (btn) {
      btn.addEventListener("click", function () {
        removeBlock(btn.getAttribute("data-from"));
        renderMapGrid();
        renderKeyboard();
        syncFromEnglish();
        setStatus("Removed block.", "ok");
      });
    });
  }

  function onKeydownAssign(e) {
    if (state.mode !== "assign") return;
    // Don't steal typing from inputs/textareas
    var t = e.target;
    if (
      t &&
      (t.tagName === "INPUT" ||
        t.tagName === "TEXTAREA" ||
        t.isContentEditable)
    ) {
      return;
    }
    if (!state.selectedRune) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    if (e.key === "Escape") {
      e.preventDefault();
      state.assignBuffer = "";
      state.selectedRune = null;
      renderKeyboard();
      updateAssignHud();
      setStatus("Assign cancelled.", "ok");
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      var key = normalizeBlockKey(state.assignBuffer);
      if (!key) {
        setStatus("Type 1–3 letters before Enter.", "err");
        return;
      }
      setBlock(key, state.selectedRune);
      var saved = key.toUpperCase() + " → " + state.selectedRune;
      state.assignBuffer = "";
      // Keep rune selected so user can bind another multi-letter key to same rune
      renderMapGrid();
      renderKeyboard();
      updateAssignHud();
      syncFromEnglish();
      setStatus("Mapped " + saved + " (you can assign another 1–3 letter key to the same rune).", "ok");
      return;
    }
    if (e.key === "Backspace") {
      e.preventDefault();
      state.assignBuffer = state.assignBuffer.slice(0, -1);
      updateAssignHud();
      return;
    }
    var k = e.key;
    if (!k || k.length !== 1) return;
    var letter = k.toLowerCase();
    if (!/[a-z]/.test(letter)) return;
    e.preventDefault();
    if (state.assignBuffer.length >= 3) {
      setStatus("Max 3 letters — press Enter to save or Backspace.", "err");
      return;
    }
    state.assignBuffer += letter;
    updateAssignHud();
    if (state.assignBuffer.length === 3) {
      setStatus(
        "Buffer full [" +
          state.assignBuffer.toUpperCase() +
          "] — press Enter to map to " +
          state.selectedRune,
        "ok"
      );
    }
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        resolve();
      } catch (err) {
        reject(err);
      }
      document.body.removeChild(ta);
    });
  }

  function rebuildPrompt(opts) {
    opts = opts || {};
    var pack = buildPromptPackage({
      forceCipher: opts.forceCipher !== false,
      syncFields: opts.syncFields !== false,
    });
    var out = $("ru-prompt-out");
    if (out) out.value = pack.packageText;
    // Show mass-produced runes length in meta
    var meta = $("ru-spell-meta");
    if (meta && pack.parts) {
      var bits = pack.parts.map(function (p) {
        return (
          (p.kind === "generated" ? "G#" : "#") +
          p.num +
          " " +
          p.enChars +
          "→" +
          p.runeChars
        );
      });
      meta.textContent =
        "Mass cipher: " +
        (pack.totalEnChars || 0) +
        " English → " +
        (pack.totalRuneChars || 0) +
        " runes" +
        (bits.length ? " · " + bits.join(" · ") : "");
    }
    if (!opts.quiet) {
      setStatus(
        "Mass-ciphered " +
          (pack.totalEnChars || 0) +
          " English chars into " +
          (pack.totalRuneChars || 0) +
          " runes (cast + full spell descriptions).",
        "ok"
      );
    }
    scheduleSave();
    return pack;
  }

  function bindControls() {
    var en = $("ru-english");
    var ru = $("ru-runes");
    if (en && !en.dataset.bound) {
      en.dataset.bound = "1";
      en.addEventListener("input", function () {
        syncFromEnglish();
        scheduleSave();
      });
    }
    if (ru && !ru.dataset.bound) {
      ru.dataset.bound = "1";
      ru.addEventListener("input", function () {
        syncFromRunes();
        scheduleSave();
      });
    }

    var filler = $("ru-filler");
    if (filler && !filler.dataset.bound) {
      filler.dataset.bound = "1";
      filler.addEventListener("input", function () {
        syncFromEnglish();
        scheduleSave();
      });
    }

    var pout = $("ru-prompt-out");
    if (pout && !pout.dataset.bound) {
      pout.dataset.bound = "1";
      pout.addEventListener("input", function () {
        scheduleSave();
      });
    }

    document.querySelectorAll(".ru-mode button").forEach(function (btn) {
      if (btn.dataset.bound) return;
      btn.dataset.bound = "1";
      btn.addEventListener("click", function () {
        state.mode = btn.dataset.ruMode || "type";
        document.querySelectorAll(".ru-mode button").forEach(function (b) {
          b.classList.toggle("active", b === btn);
        });
        state.selectedRune = null;
        state.assignBuffer = "";
        renderKeyboard();
        updateAssignHud();
        setStatus(
          state.mode === "assign"
            ? "Assign mode: tap a rune, type 1–3 letters, Enter to save. Same rune can get many keys (th, ing, a…)."
            : "Type mode: tap runes to write your incantation.",
          "ok"
        );
      });
    });

    var map = {
      "ru-btn-space": function () {
        insertRune(" ");
      },
      "ru-btn-backspace": function () {
        var el = $("ru-runes");
        if (!el) return;
        var start = el.selectionStart != null ? el.selectionStart : el.value.length;
        var end = el.selectionEnd != null ? el.selectionEnd : start;
        if (start === end && start > 0) {
          // Delete one code point
          var chars = Array.from(el.value);
          var before = el.value.slice(0, start);
          var beforeChars = Array.from(before);
          beforeChars.pop();
          el.value = beforeChars.join("") + el.value.slice(end);
          var pos = beforeChars.join("").length;
          el.focus();
          try {
            el.setSelectionRange(pos, pos);
          } catch (e) {}
        } else if (start !== end) {
          el.value = el.value.slice(0, start) + el.value.slice(end);
          el.focus();
          try {
            el.setSelectionRange(start, start);
          } catch (e) {}
        }
        syncFromRunes();
      },
      "ru-btn-clear": function () {
        if ($("ru-english")) $("ru-english").value = "";
        if ($("ru-runes")) $("ru-runes").value = "";
        var prev = $("ru-live-preview");
        if (prev) {
          prev.textContent = "Type English or tap runes…";
          prev.classList.add("ru-preview-empty");
        }
        persistDraft();
        setStatus("Cleared incantation.", "ok");
      },
      "ru-btn-translate": function () {
        syncFromEnglish();
        setStatus("English → runes.", "ok");
      },
      "ru-btn-reverse": function () {
        var en = $("ru-english");
        var ru = $("ru-runes");
        if (en && ru) en.value = runesToEnglish(ru.value);
        persistDraft();
        setStatus("Runes → English gloss (best-effort).", "ok");
      },
      "ru-btn-rebuild": function () {
        refreshSpellTexts();
        rebuildPrompt({ forceCipher: true });
      },
      "ru-btn-mass-cipher": function () {
        refreshSpellTexts();
        var pack = rebuildPrompt({ forceCipher: true });
        // Dump the continuous mass runic document into the runes field for inspection
        if (pack.massRunes && $("ru-runes")) {
          // Keep typed cast in English field; put full mass product in prompt (already done)
          // Also mirror mass runes into a dedicated feel: append spell DNA runes under cast
          var castOnly = pack.english ? massCipherEnglish(pack.english) : "";
          var combined = pack.massRunes;
          $("ru-runes").value = combined;
          var prev = $("ru-live-preview");
          if (prev) {
            prev.textContent = combined.slice(0, 400) + (combined.length > 400 ? "…" : "");
            prev.classList.remove("ru-preview-empty");
          }
        }
        setStatus(
          "Mass-produced lengthy runes: " +
            (pack.totalRuneChars || 0) +
            " characters from cast + " +
            activeSpells().length +
            " spell DNA texts.",
          "ok"
        );
        scheduleSave();
      },
      "ru-btn-save": function () {
        saveSession(false);
      },
      "ru-btn-export": function () {
        exportSessionFile();
      },
      "ru-btn-import": function () {
        var inp = $("ru-import-file");
        if (inp) inp.click();
      },
      "ru-btn-copy-runes": function () {
        var t = ($("ru-runes") && $("ru-runes").value) || "";
        copyText(t).then(
          function () {
            setStatus("Runes copied.", "ok");
          },
          function () {
            setStatus("Copy failed.", "err");
          }
        );
      },
      "ru-btn-copy-prompt": function () {
        var pack = rebuildPrompt();
        copyText(pack.packageText).then(
          function () {
            setStatus("Full incantation package copied.", "ok");
          },
          function () {
            setStatus("Copy failed.", "err");
          }
        );
      },
      "ru-btn-reset-map": function () {
        if (!confirm("Reset all 1–3 letter cipher blocks to defaults?")) return;
        state.blocks = defaultBlocks();
        saveMap();
        renderMapGrid();
        renderKeyboard();
        syncFromEnglish();
        setStatus("Cipher blocks reset to defaults.", "ok");
      },
      "ru-btn-add-block": function () {
        var fromEl = $("ru-new-block-from");
        var toEl = $("ru-new-block-to");
        var from = normalizeBlockKey(fromEl && fromEl.value);
        var to = (toEl && toEl.value && Array.from(toEl.value.trim())[0]) || state.selectedRune || "";
        if (!from || from.length < 1) {
          setStatus("Enter a 1–3 letter English key.", "err");
          return;
        }
        if (!to) {
          setStatus("Pick a rune (or paste one) for this block.", "err");
          return;
        }
        setBlock(from, to);
        if (fromEl) fromEl.value = "";
        if (toEl) toEl.value = "";
        renderMapGrid();
        renderKeyboard();
        syncFromEnglish();
        setStatus("Mapped " + from.toUpperCase() + " → " + to, "ok");
      },
      "ru-btn-to-spellforge": function () {
        var pack = rebuildPrompt();
        try {
          sessionStorage.setItem("runes_to_spellforge_notes", pack.english || pack.runes);
          sessionStorage.setItem("runes_to_spellforge_prompt", pack.packageText);
        } catch (e) {}
        var tab = document.querySelector('.site-tabs .tab[data-tab="spellforge"]');
        if (tab) tab.click();
        setTimeout(function () {
          var notes = document.getElementById("spell-stasis");
          if (notes && pack.english) {
            notes.value = (notes.value ? notes.value + "\n\n" : "") + pack.english;
            notes.dispatchEvent(new Event("input", { bubbles: true }));
          }
          copyText(pack.packageText);
          setStatus("Opened Spellforge — package copied; gloss added to notes.", "ok");
        }, 200);
      },
      "ru-btn-gen-image": function () {
        generateStill();
      },
      "ru-btn-gen-video": function () {
        generateVideo();
      },
      "ru-btn-random-spells": function () {
        randomPaintings();
      },
      "ru-btn-from-spellforge": function () {
        fromSpellforgeEquipped();
      },
      "ru-btn-clear-spells": function () {
        state.spells = [null, null, null];
        renderSpellSlots();
        updateSpellMeta();
        rebuildPrompt();
        setStatus("Cleared spell DNA.", "ok");
      },
    };

    Object.keys(map).forEach(function (id) {
      var el = $(id);
      if (!el || el.dataset.bound) return;
      el.dataset.bound = "1";
      el.addEventListener("click", map[id]);
    });

    var aspect = $("ru-aspect");
    if (aspect && !aspect.dataset.bound) {
      aspect.dataset.bound = "1";
      try {
        var savedA = localStorage.getItem(ASPECT_KEY);
        if (savedA && /^\d+:\d+$/.test(savedA)) aspect.value = savedA;
      } catch (e) {}
      aspect.addEventListener("change", function () {
        try {
          localStorage.setItem(ASPECT_KEY, aspect.value || "16:9");
        } catch (e2) {}
        rebuildPrompt({ forceCipher: true });
        scheduleSave();
      });
    }

    var dur = $("ru-duration");
    if (dur && !dur.dataset.bound) {
      dur.dataset.bound = "1";
      dur.addEventListener("change", function () {
        scheduleSave();
      });
    }

    var importFile = $("ru-import-file");
    if (importFile && !importFile.dataset.bound) {
      importFile.dataset.bound = "1";
      importFile.addEventListener("change", function () {
        var f = importFile.files && importFile.files[0];
        if (f) importSessionFile(f);
        importFile.value = "";
      });
    }

    window.addEventListener("keydown", onKeydownAssign);
    window.addEventListener("beforeunload", function () {
      saveSession(true);
    });
  }

  function start() {
    if (!$("panel-runes")) return;
    if (!state.started) {
      state.started = true;
      loadMap();
      restoreSession();
      bindControls();
      renderMapGrid();
      renderKeyboard();
      renderSpellSlots();
      // If english present, re-apply cipher so runes match current blocks
      if ($("ru-english") && $("ru-english").value.trim()) {
        syncFromEnglish();
      } else if ($("ru-runes") && $("ru-runes").value) {
        syncFromRunes();
      }
    }
    Promise.all([loadAnalysisCaches(), loadGeneratedPool()]).then(function (res) {
      var n = res[1] || 0;
      refreshSpellTexts();
      renderSpellSlots();
      rebuildPrompt({ forceCipher: true, quiet: true });
      saveSession(true);
      setStatus(
        RUNES.length +
          " runes · " +
          n +
          " generated · full descriptions mass-cipher into lengthy rune prompts · session auto-saves.",
        "ok"
      );
    });
  }

  window.addEventListener("runes-show", start);
  window.addEventListener("tab-changed", function (e) {
    if (e.detail && e.detail.tab === "runes") start();
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      if (location.hash.replace("#", "") === "runes") start();
    });
  } else if (location.hash.replace("#", "") === "runes") {
    start();
  }
})();
