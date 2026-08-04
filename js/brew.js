/**
 * Brew — A–Z spell alphabet with letter-weighted vision brewing.
 */
(function () {
  "use strict";

  var LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  var ALPHABET_SIZE = 26;
  var BASE_INCLUSION = 1 / ALPHABET_SIZE;
  var INVENTORY_TABS = [
    { id: "ag", label: "A–G", letters: "ABCDEFG" },
    { id: "hn", label: "H–N", letters: "HIJKLMN" },
    { id: "ou", label: "O–U", letters: "OPQRSTU" },
    { id: "vz", label: "V–Z", letters: "VWXYZ" },
  ];
  var CAST_TRAY_SLICE = 36;
  var FETCH_TIMEOUT_MS = 90000;
  var POLL_INTERVAL_MS = 900;
  var FIRST_POLL_DELAY_MS = 600;

  var COLOR_FALLBACKS = [
    "#6ec4ae",
    "#8b7ec8",
    "#c9a227",
    "#c87878",
    "#78a8c8",
    "#a8c878",
    "#c878a8",
    "#78c8b8",
    "#b87848",
    "#8898b8",
  ];

  var state = {
    alphabet: [],
    pool: [],
    poolReady: false,
    trayItems: [],
    selectedLetter: "",
    counts: {},
    sequence: [],
    potency: {},
    culpability: {},
    entropy: 0,
    totalLetters: 0,
    imageUrl: "",
    generating: false,
    continuityId: "",
    drag: null,
    active: false,
    inventoryTab: 0,
    linearMode: false,
    linearJumps: [],
  };

  function $(id) {
    return document.getElementById(id);
  }

  function apiUrl(path) {
    var base = String(window.SPELLFORGE_API_BASE || "").replace(/\/$/, "");
    return base ? base + path : path;
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
    return fetch(url, options);
  }

  function setStatus(msg, kind) {
    var el = $("br-status");
    if (!el) return;
    el.textContent = msg || "";
    el.className = "br-status" + (kind ? " " + kind : "");
  }

  function escapeHtml(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function normalizeSpell(item) {
    item = item || {};
    var num = item.paintingNum || item.number || null;
    if (num && !item.analysis && window.getGalleryAnalysis) {
      item.analysis = window.getGalleryAnalysis(num);
    }
    return {
      url: item.url || "",
      label: item.label || (num ? "#" + num : "Spell"),
      paintingNum: num,
      title: item.title || (item.analysis && item.analysis.title) || item.label || "",
      tags: item.tags || (item.analysis && item.analysis.tags) || [],
      colors: item.colors || (item.analysis && item.analysis.colors) || [],
      analysis: item.analysis || null,
    };
  }

  function spellRow(m) {
    var num = m.number;
    var analysis = window.getGalleryAnalysis ? window.getGalleryAnalysis(num) : null;
    return normalizeSpell({
      number: num,
      url: window.getPaintingUrl ? window.getPaintingUrl(num) : "paintings/" + num + ".jpg",
      analysis: analysis,
      title: (analysis && analysis.title) || "Painting #" + num,
      tags: (analysis && analysis.tags) || [],
      colors: (analysis && analysis.colors) || [],
      paintingNum: num,
      label: "#" + num,
    });
  }

  function spellFromNumber(num) {
    num = parseInt(num, 10);
    if (!num || num < 1) return null;
    var found = state.pool.find(function (s) {
      return s.paintingNum === num;
    });
    if (found) return normalizeSpell(found);
    var analysis = window.getGalleryAnalysis ? window.getGalleryAnalysis(num) : null;
    if (!analysis && !window.getPaintingUrl) return null;
    return normalizeSpell({
      number: num,
      paintingNum: num,
      url: window.getPaintingUrl ? window.getPaintingUrl(num) : "paintings/" + num + ".jpg",
      analysis: analysis,
      title: (analysis && analysis.title) || "Painting #" + num,
      tags: (analysis && analysis.tags) || [],
      colors: (analysis && analysis.colors) || [],
      label: "#" + num,
    });
  }

  function paintingNumsFromAlphabet() {
    return state.alphabet
      .map(function (slot) {
        return slot.spell && slot.spell.paintingNum;
      })
      .filter(function (n) {
        return n;
      })
      .sort(function (a, b) {
        return a - b;
      });
  }

  function spellPotency(spell) {
    spell = spell || {};
    var a = spell.analysis;
    if (!a) return 1;
    var score = 1;
    score += (spell.tags || a.tags || []).length * 0.12;
    score += (spell.colors || a.colors || []).length * 0.18;
    if (a.mood) score += 0.25;
    if (a.style) score += 0.25;
    if (a.medium) score += 0.15;
    score += Math.min(0.8, String(a.description || "").length / 250);
    return Math.min(3.2, Math.max(0.5, score));
  }

  function dominantColor(spell, letterIdx) {
    var colors = (spell && (spell.colors || (spell.analysis && spell.analysis.colors))) || [];
    if (colors.length) {
      var c = String(colors[0]).trim();
      if (/^#[0-9a-f]{3,8}$/i.test(c)) return c;
      if (/^rgb/i.test(c)) return c;
    }
    return COLOR_FALLBACKS[letterIdx % COLOR_FALLBACKS.length];
  }

  function shuffle(arr) {
    var copy = arr.slice();
    for (var i = copy.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = copy[i];
      copy[i] = copy[j];
      copy[j] = t;
    }
    return copy;
  }

  function initAlphabetSlots() {
    state.alphabet = LETTERS.map(function (letter) {
      return { letter: letter, spell: null };
    });
  }

  function randomizeAlphabet() {
    if (!state.pool.length) return;
    var picks = shuffle(state.pool).slice(0, 26);
    while (picks.length < 26) {
      picks = picks.concat(shuffle(state.pool));
    }
    picks = picks.slice(0, 26);
    state.alphabet.forEach(function (slot, i) {
      slot.spell = normalizeSpell(picks[i]);
    });
    refreshPotency();
    renderAlphabet();
    analyzeText();
    setStatus("A–Z remapped with 26 unique spells.", "ok");
  }

  function inventoryTabForLetter(letter) {
    for (var i = 0; i < INVENTORY_TABS.length; i++) {
      if (INVENTORY_TABS[i].letters.indexOf(letter) >= 0) return i;
    }
    return state.inventoryTab;
  }

  function assignSpellToLetter(letter, spell) {
    letter = String(letter || "").toUpperCase();
    if (!letter || LETTERS.indexOf(letter) < 0) return false;
    state.inventoryTab = inventoryTabForLetter(letter);
    spell = normalizeSpell(spell);
    if (!spell.url) return false;
    var slot = state.alphabet.find(function (s) {
      return s.letter === letter;
    });
    if (!slot) return false;
    slot.spell = spell;
    refreshPotency();
    renderAlphabet();
    analyzeText();
    setStatus("Letter " + letter + " → spell #" + spell.paintingNum + ".", "ok");
    return true;
  }

  function refreshPotency() {
    state.potency = {};
    state.alphabet.forEach(function (slot) {
      state.potency[slot.letter] = spellPotency(slot.spell);
    });
  }

  function getBrewText() {
    var el = $("br-input");
    return el && el.value ? el.value : "";
  }

  function parseLetters(text) {
    var counts = {};
    var sequence = [];
    LETTERS.forEach(function (l) {
      counts[l] = 0;
    });
    var raw = String(text || "");
    for (var i = 0; i < raw.length; i++) {
      var ch = raw[i].toUpperCase();
      if (ch >= "A" && ch <= "Z") {
        counts[ch] = (counts[ch] || 0) + 1;
        sequence.push(ch);
      }
    }
    return { counts: counts, sequence: sequence };
  }

  function letterEntropy(counts, total) {
    if (!total) return 0;
    var entropy = 0;
    LETTERS.forEach(function (l) {
      var c = counts[l] || 0;
      if (c > 0) {
        var p = c / total;
        entropy -= p * Math.log2(p);
      }
    });
    return entropy;
  }

  function computeCulpability(counts) {
    var culp = {};
    var sum = 0;
    LETTERS.forEach(function (l) {
      var w = BASE_INCLUSION + (counts[l] || 0) * (state.potency[l] || 1);
      culp[l] = w;
      sum += w;
    });
    if (sum > 0) {
      LETTERS.forEach(function (l) {
        culp[l] = culp[l] / sum;
      });
    }
    return { culpability: culp, sum: sum };
  }

  function inclusionPct(letter) {
    return ((state.culpability[letter] || 0) * 100).toFixed(1);
  }

  function floorPctLabel() {
    return (BASE_INCLUSION * 100).toFixed(2) + "%";
  }

  function linearIndex(letter) {
    return LETTERS.indexOf(String(letter || "").toUpperCase());
  }

  function linearOrdinal(letter) {
    var idx = linearIndex(letter);
    return idx < 0 ? 0 : idx + 1;
  }

  function parseOrganizedSpeech(text) {
    return String(text || "")
      .trim()
      .split(/\s+/)
      .filter(function (w) {
        return w.length > 0;
      });
  }

  function wordLinearSpan(word) {
    var letters = String(word || "")
      .toUpperCase()
      .replace(/[^A-Z]/g, "")
      .split("");
    if (!letters.length) return null;
    var ords = letters
      .map(function (l) {
        return linearOrdinal(l);
      })
      .filter(function (n) {
        return n > 0;
      });
    if (!ords.length) return null;
    return {
      word: word,
      min: Math.min.apply(null, ords),
      max: Math.max.apply(null, ords),
      letters: letters,
    };
  }

  function computeLinearJumps(sequence) {
    var jumps = [];
    var prevIdx = null;
    (sequence || []).forEach(function (letter, pos) {
      var idx = linearIndex(letter);
      if (idx < 0) return;
      var jump = prevIdx === null ? 0 : idx - prevIdx;
      jumps.push({
        letter: letter,
        pos: pos,
        linearIdx: idx,
        ordinal: idx + 1,
        jump: jump,
      });
      prevIdx = idx;
    });
    return jumps;
  }

  function jumpClass(jump) {
    var a = Math.abs(jump);
    if (a >= 10) return "br-jump-wide";
    if (a >= 4) return "br-jump-mid";
    return "br-jump-near";
  }

  function jumpLabel(jump) {
    if (jump === 0) return "·";
    return jump > 0 ? "→+" + jump : "←" + jump;
  }

  function summarizeLinearJumps(jumps) {
    if (!jumps.length) return "";
    var deltas = jumps.slice(1).map(function (j) {
      return j.jump;
    });
    if (!deltas.length) return "Single letter — sits at A–Z ordinal " + jumps[0].ordinal + ".";
    var sum = 0;
    var absSum = 0;
    var maxAbs = 0;
    deltas.forEach(function (d) {
      sum += d;
      absSum += Math.abs(d);
      if (Math.abs(d) > maxAbs) maxAbs = Math.abs(d);
    });
    var avg = absSum / deltas.length;
    var drift = sum > 0 ? "drifting toward Z" : sum < 0 ? "drifting toward A" : "balanced drift";
    return (
      "Linear jumps — avg |Δ| " +
      avg.toFixed(1) +
      " slots, max |Δ| " +
      maxAbs +
      " (" +
      drift +
      "). Speech hops; A–Z line holds fixed weight."
    );
  }

  function setLinearMode(on) {
    state.linearMode = !!on;
    document.body.classList.toggle("br-linear-active", state.linearMode);
    var btn = $("br-linear-toggle");
    var panel = $("br-linear-panel");
    if (btn) {
      btn.textContent = state.linearMode ? "Linear: on" : "Linear: off";
      btn.setAttribute("aria-pressed", state.linearMode ? "true" : "false");
    }
    if (panel) panel.hidden = !state.linearMode;
    renderSequence();
    renderLinearCompare();
  }

  function renderLinearCompare() {
    if (!state.linearMode) return;

    var speechEl = $("br-organized-speech");
    var trackEl = $("br-linear-track");
    var naturalEl = $("br-linear-natural");
    var jumpEl = $("br-linear-jump");
    if (!speechEl || !trackEl || !naturalEl) return;

    var text = getBrewText();
    var words = parseOrganizedSpeech(text);
    speechEl.innerHTML = "";
    if (!words.length) {
      speechEl.innerHTML = '<span class="br-seq-empty">Words from your stanza…</span>';
    } else {
      words.forEach(function (word) {
        var span = wordLinearSpan(word);
        var el = document.createElement("span");
        el.className = "br-speech-word";
        var textNode = document.createElement("span");
        textNode.className = "br-speech-word-text";
        textNode.textContent = word;
        el.appendChild(textNode);
        if (span) {
          var bar = document.createElement("span");
          bar.className = "br-speech-span";
          bar.title = "A–Z span " + span.min + "–" + span.max + " for “" + word + "”";
          var fill = document.createElement("span");
          fill.className = "br-speech-span-fill";
          var leftPct = ((span.min - 1) / 25) * 100;
          var widthPct = Math.max(4, ((span.max - span.min + 1) / 26) * 100);
          fill.style.left = leftPct + "%";
          fill.style.width = widthPct + "%";
          var midLetter = span.letters[Math.floor(span.letters.length / 2)] || "A";
          var midIdx = linearIndex(midLetter);
          fill.style.background = dominantColor(
            state.alphabet[midIdx] && state.alphabet[midIdx].spell,
            midIdx
          );
          bar.appendChild(fill);
          el.appendChild(bar);
        }
        speechEl.appendChild(el);
      });
    }

    trackEl.innerHTML = "";
    var maxCulp = 0;
    LETTERS.forEach(function (l) {
      var v = state.culpability[l] || 0;
      if (v > maxCulp) maxCulp = v;
    });
    LETTERS.forEach(function (letter, idx) {
      var culp = state.culpability[letter] || 0;
      var count = state.counts[letter] || 0;
      var slot = state.alphabet[idx];
      var color = dominantColor(slot && slot.spell, idx);

      var cell = document.createElement("div");
      cell.className = "br-linear-slot";
      if (count > 0) cell.classList.add("br-linear-hit");

      var glyph = document.createElement("span");
      glyph.className = "br-linear-glyph";
      glyph.textContent = letter;
      cell.appendChild(glyph);

      var barWrap = document.createElement("div");
      barWrap.className = "br-linear-bar-wrap";
      var bar = document.createElement("div");
      bar.className = "br-linear-bar";
      bar.style.height = Math.max(4, Math.round(culp * 100)) + "%";
      bar.style.background = color;
      bar.title = letter + " · " + (culp * 100).toFixed(1) + "% inclusion";
      barWrap.appendChild(bar);
      cell.appendChild(barWrap);

      var ord = document.createElement("span");
      ord.className = "br-linear-ord";
      ord.textContent = String(idx + 1);
      cell.appendChild(ord);

      var ticks = document.createElement("div");
      ticks.className = "br-linear-ticks";
      for (var t = 0; t < Math.min(count, 8); t++) {
        var tick = document.createElement("span");
        tick.className = "br-linear-tick";
        tick.style.background = color;
        ticks.appendChild(tick);
      }
      if (count > 8) {
        var more = document.createElement("span");
        more.className = "br-linear-ord";
        more.textContent = "+" + (count - 8);
        ticks.appendChild(more);
      }
      cell.appendChild(ticks);
      trackEl.appendChild(cell);
    });

    naturalEl.innerHTML = "";
    state.linearJumps = computeLinearJumps(state.sequence);
    if (!state.linearJumps.length) {
      naturalEl.innerHTML = '<span class="br-seq-empty">Natural letter stream maps here…</span>';
    } else {
      var maxShow = 64;
      var jumps = state.linearJumps.length > maxShow ? state.linearJumps.slice(-maxShow) : state.linearJumps;
      if (state.linearJumps.length > maxShow) {
        var earlier = document.createElement("span");
        earlier.className = "br-seq-empty";
        earlier.textContent = "…" + (state.linearJumps.length - maxShow) + " · ";
        naturalEl.appendChild(earlier);
      }
      jumps.forEach(function (row, i) {
        if (i > 0) {
          var arrow = document.createElement("span");
          arrow.className = "br-linear-jump-arrow " + jumpClass(row.jump);
          arrow.textContent = jumpLabel(row.jump);
          arrow.title = "Alphabet jump of " + row.jump + " from previous letter";
          naturalEl.appendChild(arrow);
        }
        var wrap = document.createElement("span");
        wrap.className = "br-linear-chip-wrap";
        var chip = document.createElement("span");
        chip.className = "br-linear-chip";
        var letterEl = document.createElement("span");
        letterEl.className = "br-linear-chip-letter";
        letterEl.textContent = row.letter;
        var slot = state.alphabet[row.linearIdx];
        letterEl.style.background = dominantColor(slot && slot.spell, row.linearIdx);
        letterEl.title =
          row.letter +
          " at A–Z ordinal " +
          row.ordinal +
          " · " +
          ((state.culpability[row.letter] || 0) * 100).toFixed(1) +
          "% weight";
        var ordEl = document.createElement("span");
        ordEl.className = "br-linear-chip-ord";
        ordEl.textContent = String(row.ordinal);
        chip.appendChild(letterEl);
        chip.appendChild(ordEl);
        wrap.appendChild(chip);
        naturalEl.appendChild(wrap);
      });
    }

    if (jumpEl) jumpEl.textContent = summarizeLinearJumps(state.linearJumps);
  }

  function buildBrewLinearBlock() {
    if (!state.linearMode) return "";
    var lines = [
      "",
      "LINEAR MODE (stylization math only — never paint letter glyphs):",
      "Lay brew color/light left-to-right as a gradient on the stylization layer; subject from the prompt stays primary.",
      "Organized speech ordinals tune inclusion — they do not replace what the user is saying.",
    ];
    var words = parseOrganizedSpeech(getBrewText());
    if (words.length) {
      lines.push("");
      lines.push("Organized speech (word order):");
      lines.push(words.join(" "));
      lines.push("Per-word A–Z spans:");
      words.forEach(function (w) {
        var span = wordLinearSpan(w);
        if (span) lines.push("  “" + w + "”: ordinals " + span.min + "–" + span.max);
      });
    }
    lines.push("");
    lines.push("Fixed A–Z linear inclusion (ordinal → weight %):");
    LETTERS.forEach(function (l, idx) {
      lines.push(
        String(idx + 1) +
          "." +
          l +
          " " +
          ((state.culpability[l] || 0) * 100).toFixed(2) +
          "%"
      );
    });
    if (state.linearJumps.length) {
      lines.push("");
      lines.push("Natural stream with linear ordinals and jumps (letter@ordinal, Δ from prior):");
      var parts = [];
      state.linearJumps.slice(0, 100).forEach(function (row, i) {
        var seg = row.letter + "@" + row.ordinal;
        if (i > 0) seg = "(" + jumpLabel(row.jump) + ")" + seg;
        parts.push(seg);
      });
      lines.push(parts.join(" "));
      lines.push(summarizeLinearJumps(state.linearJumps));
    }
    return lines.join("\n");
  }

  function analyzeText() {
    var parsed = parseLetters(getBrewText());
    state.counts = parsed.counts;
    state.sequence = parsed.sequence;
    state.totalLetters = parsed.sequence.length;
    state.entropy = letterEntropy(parsed.counts, state.totalLetters);
    var culp = computeCulpability(parsed.counts);
    state.culpability = culp.culpability;
    renderMetrics();
    renderWeightBars();
    renderSequence();
    renderCulpability();
    renderAlphabet();
    state.linearJumps = computeLinearJumps(state.sequence);
    renderLinearCompare();
  }

  function renderMetrics() {
    var ent = $("br-entropy");
    var hint = $("br-entropy-hint");
    var active = $("br-active-count");
    var dom = $("br-dominant");

    if (ent) {
      ent.textContent = state.totalLetters ? state.entropy.toFixed(2) + " bits" : "—";
    }
    if (hint) {
      if (!state.totalLetters) {
        hint.textContent = "uniform = gibberish talk";
      } else if (state.entropy > 3.8) {
        hint.textContent = "high entropy — scattered letter talk";
      } else if (state.entropy < 2.2) {
        hint.textContent = "low entropy — focused word shapes";
      } else {
        hint.textContent = "balanced — mixed sense and drift";
      }
    }
    if (active) {
      var used = LETTERS.filter(function (l) {
        return (state.counts[l] || 0) > 0;
      }).length;
      active.textContent = String(used) + " / 26";
    }
    var floor = $("br-floor");
    var floorHint = $("br-floor-hint");
    if (floor) floor.textContent = "1÷26 · " + floorPctLabel();
    if (floorHint) {
      floorHint.textContent = state.totalLetters
        ? "floor + stanza stack on every letter"
        : "all 26 spells always in the brew";
    }
    if (dom) {
      var topL = "";
      var topV = 0;
      LETTERS.forEach(function (l) {
        var v = state.culpability[l] || 0;
        if (v > topV) {
          topV = v;
          topL = l;
        }
      });
      if (topL && topV > 0) {
        var slot = state.alphabet.find(function (s) {
          return s.letter === topL;
        });
        var spellLabel = slot && slot.spell ? "#" + slot.spell.paintingNum : "";
        var boost = (state.counts[topL] || 0) > 0 ? " +" + state.counts[topL] + "×" : " (floor)";
        dom.textContent = topL + " " + (topV * 100).toFixed(1) + "%" + boost + (spellLabel ? " · " + spellLabel : "");
      } else {
        dom.textContent = "—";
      }
    }
  }

  function renderWeightBars() {
    var wrap = $("br-weight-bars");
    if (!wrap) return;
    wrap.innerHTML = "";
    var maxCulp = 0;
    LETTERS.forEach(function (l) {
      var v = state.culpability[l] || 0;
      if (v > maxCulp) maxCulp = v;
    });

    LETTERS.forEach(function (letter, idx) {
      var culp = state.culpability[letter] || 0;
      var count = state.counts[letter] || 0;
      var slot = state.alphabet[idx];
      var color = dominantColor(slot && slot.spell, idx);

      var cell = document.createElement("div");
      cell.className = "br-weight-cell";
      if (culp > 0 && culp >= maxCulp * 0.85) cell.classList.add("br-hot");

      var glyph = document.createElement("span");
      glyph.className = "br-weight-letter";
      glyph.textContent = letter;
      cell.appendChild(glyph);

      var barWrap = document.createElement("div");
      barWrap.className = "br-weight-bar-wrap";
      var bar = document.createElement("div");
      bar.className = "br-weight-bar";
      var h = Math.max(4, Math.round(culp * 100));
      bar.style.height = h + "%";
      bar.style.background = color;
      barWrap.appendChild(bar);
      cell.appendChild(barWrap);

      var pct = document.createElement("span");
      pct.className = "br-weight-pct";
      pct.textContent = (culp * 100).toFixed(1) + "%";
      pct.title = "1÷26 floor " + floorPctLabel() + (count ? " + " + count + " in stanza" : "");
      cell.appendChild(pct);

      wrap.appendChild(cell);
    });
  }

  function renderSequence() {
    var el = $("br-sequence");
    if (!el) return;
    el.innerHTML = "";
    if (!state.sequence.length) {
      el.innerHTML = '<span class="br-seq-empty">Type to see the letter stream…</span>';
      return;
    }
    var maxShow = 120;
    var offset = state.sequence.length > maxShow ? state.sequence.length - maxShow : 0;
    var seq = state.sequence.slice(offset);
    if (offset > 0) {
      var more = document.createElement("span");
      more.className = "br-seq-empty";
      more.textContent = "…" + offset + " earlier · ";
      el.appendChild(more);
    }
    seq.forEach(function (letter, i) {
      var idx = LETTERS.indexOf(letter);
      var slot = state.alphabet[idx];
      var chip = document.createElement("span");
      chip.className = "br-seq-chip";
      if (state.linearMode) {
        chip.textContent = letter;
        var ord = linearOrdinal(letter);
        var jumpRow = state.linearJumps[offset + i];
        var jumpNote = jumpRow && jumpRow.jump !== 0 ? " · jump " + jumpLabel(jumpRow.jump) : "";
        chip.title =
          letter +
          " @ A–Z " +
          ord +
          " → #" +
          (slot && slot.spell ? slot.spell.paintingNum : "?") +
          " · " +
          ((state.culpability[letter] || 0) * 100).toFixed(1) +
          "%" +
          jumpNote;
      } else {
        chip.textContent = letter;
        chip.title =
          letter +
          " → #" +
          (slot && slot.spell ? slot.spell.paintingNum : "?") +
          " · weight " +
          ((state.culpability[letter] || 0) * 100).toFixed(1) +
          "%";
      }
      chip.style.background = dominantColor(slot && slot.spell, idx);
      el.appendChild(chip);
    });
  }

  function renderCulpability() {
    var list = $("br-culpability");
    if (!list) return;
    list.innerHTML = "";
    var ranked = LETTERS.map(function (l) {
      return { letter: l, weight: state.culpability[l] || 0, count: state.counts[l] || 0 };
    })
      .sort(function (a, b) {
        return b.weight - a.weight;
      })
      .slice(0, 10);

    ranked.forEach(function (row) {
      var idx = LETTERS.indexOf(row.letter);
      var slot = state.alphabet[idx];
      var color = dominantColor(slot && slot.spell, idx);
      var spellTitle = slot && slot.spell ? slot.spell.title : "—";

      var el = document.createElement("div");
      el.className = "br-culp-row";
      el.innerHTML =
        '<span class="br-culp-letter">' +
        escapeHtml(row.letter) +
        "</span>" +
        '<span class="br-culp-spell" title="' +
        escapeHtml(spellTitle) +
        '">#' +
        (slot && slot.spell ? slot.spell.paintingNum : "?") +
        "</span>" +
        '<div class="br-culp-bar-wrap"><div class="br-culp-bar"></div></div>' +
        '<span class="br-culp-pct">' +
        (row.weight * 100).toFixed(1) +
        "%</span>";
      var bar = el.querySelector(".br-culp-bar");
      if (bar) {
        bar.style.width = Math.round(row.weight * 100) + "%";
        bar.style.background = color;
      }
      list.appendChild(el);
    });
  }

  function createLetterSlotEl(slot, idx) {
    var el = document.createElement("div");
    el.className = "br-letter-slot";
    el.dataset.letter = slot.letter;
    if (state.selectedLetter === slot.letter) el.classList.add("br-selected");
    if ((state.counts[slot.letter] || 0) > 0) el.classList.add("br-weighted");
    if (slot.spell && slot.spell.url) el.classList.add("br-equipped");

    var floorBadge = document.createElement("span");
    floorBadge.className = "br-letter-floor";
    floorBadge.textContent = "÷26";
    floorBadge.title = "Guaranteed 1÷26 inclusion in every brew";
    el.appendChild(floorBadge);

    var glyph = document.createElement("span");
    glyph.className = "br-letter-glyph";
    glyph.textContent = slot.letter;
    el.appendChild(glyph);

    if (slot.spell && slot.spell.url) {
      var img = document.createElement("img");
      img.className = "br-letter-thumb";
      img.src = slot.spell.url;
      img.alt = slot.letter + " spell";
      el.appendChild(img);
      var num = document.createElement("span");
      num.className = "br-letter-num";
      num.textContent = "#" + slot.spell.paintingNum;
      el.appendChild(num);
    } else {
      var empty = document.createElement("span");
      empty.className = "br-letter-num";
      empty.textContent = "empty";
      el.appendChild(empty);
    }

    var incl = document.createElement("span");
    incl.className = "br-letter-inclusion";
    incl.textContent = inclusionPct(slot.letter) + "%";
    incl.title = "Current brew inclusion (floor + stanza)";
    el.appendChild(incl);

    el.addEventListener("click", function () {
      promptReplaceLetter(slot.letter);
    });
    return el;
  }

  function renderAlphabet() {
    var tabsEl = $("br-inventory-tabs");
    var panelsEl = $("br-inventory-panels");
    if (!tabsEl || !panelsEl) return;

    if (!tabsEl.dataset.ready) {
      tabsEl.dataset.ready = "1";
      INVENTORY_TABS.forEach(function (tab, tabIdx) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "br-inventory-tab";
        btn.setAttribute("role", "tab");
        btn.setAttribute("aria-selected", tabIdx === state.inventoryTab ? "true" : "false");
        btn.dataset.tabIdx = String(tabIdx);
        btn.textContent = tab.label;
        btn.addEventListener("click", function () {
          state.inventoryTab = tabIdx;
          renderAlphabet();
        });
        tabsEl.appendChild(btn);

        var panel = document.createElement("div");
        panel.className = "br-inventory-panel";
        panel.id = "br-inventory-panel-" + tab.id;
        panel.setAttribute("role", "tabpanel");
        panel.dataset.tabIdx = String(tabIdx);
        var grid = document.createElement("div");
        grid.className = "br-alphabet";
        grid.id = "br-alphabet-" + tab.id;
        panel.appendChild(grid);
        panelsEl.appendChild(panel);
      });
    }

    tabsEl.querySelectorAll(".br-inventory-tab").forEach(function (btn) {
      var on = parseInt(btn.dataset.tabIdx, 10) === state.inventoryTab;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    panelsEl.querySelectorAll(".br-inventory-panel").forEach(function (panel) {
      var on = parseInt(panel.dataset.tabIdx, 10) === state.inventoryTab;
      panel.classList.toggle("active", on);
      if (!on) return;
      var grid = panel.querySelector(".br-alphabet");
      if (!grid) return;
      grid.innerHTML = "";
      var tab = INVENTORY_TABS[state.inventoryTab];
      tab.letters.split("").forEach(function (letter) {
        var slot = state.alphabet.find(function (s) {
          return s.letter === letter;
        });
        if (!slot) return;
        grid.appendChild(createLetterSlotEl(slot, LETTERS.indexOf(letter)));
      });
    });
  }

  function promptReplaceLetter(letter) {
    state.selectedLetter = letter;
    state.inventoryTab = inventoryTabForLetter(letter);
    renderAlphabet();
    var current = state.alphabet.find(function (s) {
      return s.letter === letter;
    });
    var curNum = current && current.spell ? current.spell.paintingNum : "";
    var input = window.prompt("Spell number for letter " + letter + " (1–1000):", curNum ? String(curNum) : "");
    if (input == null) return;
    input = input.trim().replace(/^#/, "");
    if (!input) return;
    var spell = spellFromNumber(input);
    if (!spell) {
      setStatus("Could not find painting #" + input + ".", "error");
      return;
    }
    assignSpellToLetter(letter, spell);
  }

  var STYLIZATION_SHARE = 0.35;

  function brewAntiLetterLines() {
    return [
      "OUTPUT TYPOGRAPHY RULE — avoid visible letters like the plague:",
      "Do NOT render alphabet glyphs, typography, captions, subtitles, signs with readable text, handwriting, graffiti letters, or letter-shaped objects.",
      "The user's prompt subject and meaning MUST still be painted at face value — only the characters themselves stay invisible.",
      "Letter-weight math becomes stylization only: color grade, texture, brush energy, atmosphere — layered on the subject, not replacing it.",
    ];
  }

  function promptSubjectWords(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s'-]/g, " ")
      .split(/\s+/)
      .filter(function (w) {
        return w.length > 2;
      });
  }

  function buildBrewStylizationNote() {
    var parts = [];
    parts.push(
      "letter-weight brew as painterly stylization (~" +
        Math.round(STYLIZATION_SHARE * 100) +
        "% influence)"
    );
    parts.push("1÷26 spell floor across inventory");
    var influences = topSpellInfluences(4)
      .map(function (inf) {
        return "#" + inf.num + " " + inf.title;
      })
      .join(", ");
    if (influences) parts.push("spell tint from " + influences);
    if (state.linearMode) parts.push("subtle left-to-right spectral gradient");
    parts.push("no visible letters or typography in frame");
    return parts.join("; ");
  }

  function topSpellInfluences(limit) {
    limit = limit || 8;
    return LETTERS.map(function (l) {
      return { letter: l, w: state.culpability[l] || 0 };
    })
      .sort(function (a, b) {
        return b.w - a.w;
      })
      .slice(0, limit)
      .map(function (r) {
        var slot = state.alphabet.find(function (s) {
          return s.letter === r.letter;
        });
        var spell = slot && slot.spell;
        var a = spell && spell.analysis;
        var tags = (spell && spell.tags) || [];
        var colors = (spell && spell.colors) || [];
        return {
          weight: r.w,
          title: (spell && spell.title) || "Spell",
          num: spell && spell.paintingNum,
          mood: (a && a.mood) || "",
          style: (a && a.style) || "",
          tags: tags.slice(0, 4),
          colors: colors.slice(0, 3),
        };
      })
      .filter(function (r) {
        return r.num;
      });
  }

  function buildBrewStasis() {
    var text = getBrewText().trim();
    var lines = brewAntiLetterLines().concat([
      "",
      "BREW — subject-first vision with letter-weight stylization layered on top.",
      "PRIORITY: ~" +
        Math.round((1 - STYLIZATION_SHARE) * 100) +
        "% subject fidelity (paint the prompt at face value, know what the user is saying).",
      "STYLIZATION: ~" +
        Math.round(STYLIZATION_SHARE * 100) +
        "% brew influence (spell colors, texture, mood from A–Z letter weights — must not swallow the subject).",
    ]);

    lines.push("");
    if (text) {
      lines.push("PRIMARY SUBJECT — paint at face value (this is what the user means):");
      lines.push(text);
      var words = promptSubjectWords(text);
      if (words.length) {
        lines.push("Understand and honor: " + words.slice(0, 16).join(", "));
      }
    } else {
      lines.push("PRIMARY SUBJECT: none yet — lean on spell inventory stylization until a stanza is added.");
    }

    lines.push("");
    lines.push("BREW STYLIZATION LAYER (secondary — letter-weight spell fusion, never paint the glyphs):");
    lines.push("UNIVERSAL INCLUSION: every letter A–Z carries a guaranteed 1÷26 (" + floorPctLabel() + ") floor — all 26 inventory spells participate.");
    lines.push("Stanza letters stack additional culpability (frequency × spell potency) on top of that floor.");
    lines.push("");
    lines.push("Alphabet mapping (all 26 active spells):");
    state.alphabet.forEach(function (slot) {
      if (!slot.spell) return;
      var a = slot.spell.analysis;
      lines.push(
        slot.letter +
          " = #" +
          slot.spell.paintingNum +
          " " +
          (slot.spell.title || "Spell") +
          " [potency " +
          (state.potency[slot.letter] || 1).toFixed(2) +
          "]"
      );
      if (a && a.description) lines.push("  " + String(a.description).slice(0, 200));
      if (slot.spell.tags && slot.spell.tags.length) {
        lines.push("  tags: " + slot.spell.tags.slice(0, 8).join(", "));
      }
      if (slot.spell.colors && slot.spell.colors.length) {
        lines.push("  colors: " + slot.spell.colors.slice(0, 5).join(", "));
      }
    });

    lines.push("");
    lines.push("Final inclusion per letter (1÷26 floor + stanza culpability, normalized):");
    LETTERS.map(function (l) {
      return { letter: l, w: state.culpability[l] || 0, c: state.counts[l] || 0 };
    })
      .sort(function (a, b) {
        return b.w - a.w;
      })
      .forEach(function (r) {
        lines.push(
          r.letter +
            ": " +
            (r.w * 100).toFixed(2) +
            "% inclusion (floor " +
            floorPctLabel() +
            (r.c ? ", stanza ×" + r.c : ", floor only") +
            ")"
        );
      });

    if (state.totalLetters) {
      lines.push("Letter entropy: " + state.entropy.toFixed(2) + " bits — " + (state.entropy > 3.5 ? "scattered/gibberish" : "word-shaped"));
      lines.push("Natural sequence (weight math only, never render): " + state.sequence.slice(0, 80).join(""));
    } else {
      lines.push("No stanza yet — pure 1÷26 equal inclusion across all inventory spells.");
    }

    lines.push("");
    lines.push("Stylization tint from top weighted spells (apply to subject, not instead of it):");
    topSpellInfluences(10).forEach(function (inf) {
      var chunk =
        "#" +
        inf.num +
        " " +
        inf.title +
        " (" +
        (inf.weight * 100).toFixed(1) +
        "% weight)";
      if (inf.mood) chunk += " · mood: " + inf.mood;
      if (inf.style) chunk += " · style: " + inf.style;
      if (inf.colors.length) chunk += " · colors: " + inf.colors.join(", ");
      if (inf.tags.length) chunk += " · tags: " + inf.tags.join(", ");
      lines.push(chunk);
    });

    lines.push(buildBrewLinearBlock());
    return lines.join("\n");
  }

  function buildBrewBuzz() {
    var text = getBrewText().trim();
    var buzz = [];
    promptSubjectWords(text)
      .slice(0, 14)
      .forEach(function (w) {
        if (buzz.indexOf(w) < 0) buzz.push(w);
      });
    if (text) {
      buzz.push("face value", "subject first", "what is said");
    }
    buzz.push("painterly vision", "spell stylization", "no typography", "no letter glyphs");
    if (state.linearMode) buzz.push("linear spectrum", "left to right gradient");
    topSpellInfluences(8).forEach(function (inf) {
      if (inf.mood && buzz.indexOf(inf.mood) < 0) buzz.push(inf.mood);
      if (inf.style && buzz.indexOf(inf.style) < 0) buzz.push(inf.style);
      inf.tags.forEach(function (t) {
        if (buzz.indexOf(t) < 0) buzz.push(t);
      });
      inf.colors.forEach(function (c) {
        var clean = String(c).trim();
        if (clean && buzz.indexOf(clean) < 0) buzz.push(clean);
      });
    });
    return buzz;
  }

  function buildBrewCraftHints() {
    var text = getBrewText().trim();
    var hints = [];
    if (text) {
      hints.push("PRIMARY — paint the user's prompt at face value: " + text);
      hints.push("Know what they are saying; keep the subject, scene, and meaning readable.");
    }
    hints.push(
      "SECONDARY — brew stylization (~" +
        Math.round(STYLIZATION_SHARE * 100) +
        "%): letter-weight spell fusion tints color, texture, and atmosphere only."
    );
    hints.push("Avoid visible letters and typography — subject stays, glyphs do not.");
    hints.push("What IS: the prompt's present truth. What COULD BE: emergent possibility within that same subject.");
    if (state.linearMode) {
      hints.push("Linear brew feel: subtle left-to-right color-spectrum gradient on the stylization layer.");
    }
    topSpellInfluences(5).forEach(function (inf) {
      hints.push(
        "Stylization tint #" +
          inf.num +
          " " +
          inf.title +
          " (" +
          (inf.weight * 100).toFixed(0) +
          "%) — " +
          (inf.tags.slice(0, 3).join(", ") || inf.mood || "spell color")
      );
    });
    return hints.join(" ");
  }

  function buildBrewPrompt() {
    var text = getBrewText().trim();
    if (text) return text;
    return (
      "Painterly vision with brew spell stylization across the full A–Z inventory. " +
      buildBrewStylizationNote()
    );
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
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = function () {
        resolve(dataUrl);
      };
      img.src = dataUrl;
    });
  }

  function pollImageJob(jobId, attemptsLeft, firstPoll) {
    if (attemptsLeft == null) attemptsLeft = 80;
    if (attemptsLeft <= 0) return Promise.reject(new Error("Brew generation timed out."));
    var pollOnce = function () {
      return fetchWithTimeout(apiUrl("/api/jobs/" + jobId), { cache: "no-store" }, 25000);
    };
    var startPoll = firstPoll
      ? new Promise(function (resolve) {
          setTimeout(resolve, FIRST_POLL_DELAY_MS);
        }).then(pollOnce)
      : pollOnce();
    return startPoll
      .then(function (r) {
        return parseApiResponse(r);
      })
      .then(function (job) {
        setStatus("Brewing… (" + (job.status || "working") + ")", "pending");
        if (job.status === "done") {
          var img = job.image || (job.images && job.images[0]);
          if (img && img.url) return img.url;
          throw new Error("No image returned.");
        }
        if (job.status === "failed") {
          throw new Error((job.error && job.error.message) || "Generation failed.");
        }
        return new Promise(function (resolve) {
          setTimeout(resolve, POLL_INTERVAL_MS);
        }).then(function () {
          return pollImageJob(jobId, attemptsLeft - 1, false);
        });
      });
  }

  function showPreview(url) {
    var empty = $("br-stage-empty");
    var img = $("br-preview");
    if (!img) return;
    if (!url) {
      if (empty) empty.hidden = false;
      img.hidden = true;
      img.removeAttribute("src");
      return;
    }
    if (empty) empty.hidden = true;
    img.src = url;
    img.hidden = false;
  }

  function beginGenerate() {
    state.generating = true;
    var stage = $("br-stage");
    if (stage) stage.classList.add("br-generating");
    document.querySelectorAll(".br-btn, .br-spell").forEach(function (el) {
      el.disabled = true;
    });
  }

  function endGenerate() {
    state.generating = false;
    var stage = $("br-stage");
    if (stage) stage.classList.remove("br-generating");
    document.querySelectorAll(".br-btn, .br-spell").forEach(function (el) {
      el.disabled = false;
    });
  }

  function brewGenerate(options) {
    options = options || {};
    if (state.generating) return Promise.resolve();

    var hasSpells = state.alphabet.some(function (s) {
      return s.spell && s.spell.url;
    });
    if (!hasSpells) {
      setStatus("Map spells to A–Z first — hit Randomize A–Z.", "error");
      return Promise.resolve();
    }

    var text = getBrewText().trim();
    if (!text && !state.imageUrl) {
      analyzeText();
    }

    if (!state.continuityId) {
      state.continuityId = "br-cast-" + Date.now();
    }

    var variation = !!options.variation;
    var hasImage = !!state.imageUrl;
    var refine = hasImage && !variation;

    beginGenerate();
    setStatus(
      variation ? "Brewing new variation…" : hasImage ? "Refining brew…" : "Brewing letter-weighted vision…",
      "pending"
    );

    var jobId =
      typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : "br-" + Date.now();
    var refImage = state.imageUrl || "";

    return compressDataUrl(refImage, 1280, 0.82)
      .then(function (compressedRef) {
        return fetchWithTimeout(
          apiUrl("/api/generate-stasis-vision"),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              job_id: jobId,
              stasis: buildBrewStasis(),
              craft_hints: buildBrewCraftHints(),
              buzz_words: buildBrewBuzz(),
              spells: paintingNumsFromAlphabet(),
              aspect_ratio: "16:9",
              mag_fresh: !refine,
              fresh_variation: variation,
              refine: refine,
              reference_image: refine ? compressedRef : "",
              prompt: buildBrewPrompt(),
            }),
          },
          FETCH_TIMEOUT_MS
        );
      })
      .then(function (r) {
        if (r.status === 202) {
          return r.json().then(function (d) {
            return pollImageJob((d && d.job_id) || jobId, null, true);
          });
        }
        return parseApiResponse(r).then(function (d) {
          if (!r.ok) throw new Error((d && d.error) || "Generate failed");
          var img = d.image || (d.images && d.images[0]);
          if (img && img.url) return img.url;
          throw new Error("No image returned.");
        });
      })
      .then(function (url) {
        state.imageUrl = url;
        showPreview(url);
        setStatus("Brew ready — your subject at face value, with spell stylization layered on.", "ok");
      })
      .catch(function (err) {
        setStatus(err.message || "Brew failed. Is the gallery server running?", "error");
      })
      .finally(endGenerate);
  }

  function loadSpellPool() {
    if (state.poolReady) return Promise.resolve();
    return (window.loadGalleryData ? window.loadGalleryData() : Promise.resolve({ manifest: [] }))
      .then(function (data) {
        state.pool = (data.manifest || []).map(function (m) {
          return normalizeSpell(spellRow(m));
        });
        state.poolReady = true;
        if (!state.alphabet.some(function (s) {
          return s.spell;
        })) {
          randomizeAlphabet();
        }
        fillTrayRandom();
        renderTray();
      });
  }

  function fillTrayRandom() {
    state.trayItems = shuffle(state.pool).slice(0, CAST_TRAY_SLICE);
  }

  function renderTray() {
    var strip = $("br-spell-strip");
    if (!strip) return;
    strip.innerHTML = "";
    state.trayItems.forEach(function (item, idx) {
      var el = document.createElement("div");
      el.className = "st-spell br-spell";
      el.dataset.idx = String(idx);
      var img = document.createElement("img");
      img.src = item.url;
      img.alt = item.label;
      el.appendChild(img);
      strip.appendChild(el);
    });
    var count = $("br-tray-count");
    if (count) count.textContent = state.trayItems.length + " shown · drag onto a letter";
  }

  function createGhost(item, x, y) {
    var ghost = document.createElement("div");
    ghost.className = "st-drag-ghost";
    var img = document.createElement("img");
    img.src = item.url;
    ghost.appendChild(img);
    document.body.appendChild(ghost);
    ghost.style.left = x + "px";
    ghost.style.top = y + "px";
    return ghost;
  }

  function letterAtPoint(x, y) {
    var slots = document.querySelectorAll(".br-letter-slot");
    for (var i = 0; i < slots.length; i++) {
      var rect = slots[i].getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        return slots[i].dataset.letter || "";
      }
    }
    return "";
  }

  function onPointerDown(e) {
    if (state.generating) return;
    var spell = e.target.closest(".br-spell");
    if (!spell || !spell.closest("#br-spell-strip")) return;
    var item = normalizeSpell(state.trayItems[parseInt(spell.dataset.idx, 10)]);
    if (!item.url) return;
    e.preventDefault();
    spell.setPointerCapture(e.pointerId);
    state.drag = {
      item: item,
      ghost: createGhost(item, e.clientX, e.clientY),
      pointerId: e.pointerId,
    };
  }

  function onPointerUp(e) {
    if (!state.drag || e.pointerId !== state.drag.pointerId) return;
    var drag = state.drag;
    if (drag.ghost.parentNode) drag.ghost.parentNode.removeChild(drag.ghost);
    document.querySelectorAll(".br-letter-slot.br-drop-active").forEach(function (el) {
      el.classList.remove("br-drop-active");
    });
    var letter = letterAtPoint(e.clientX, e.clientY);
    if (letter) assignSpellToLetter(letter, drag.item);
    state.drag = null;
  }

  function onPointerMove(e) {
    if (!state.drag || e.pointerId !== state.drag.pointerId) return;
    state.drag.ghost.style.left = e.clientX + "px";
    state.drag.ghost.style.top = e.clientY + "px";
    var letter = letterAtPoint(e.clientX, e.clientY);
    document.querySelectorAll(".br-letter-slot").forEach(function (el) {
      el.classList.toggle("br-drop-active", el.dataset.letter === letter);
    });
  }

  function onPointerCancel(e) {
    if (!state.drag || e.pointerId !== state.drag.pointerId) return;
    if (state.drag.ghost.parentNode) state.drag.ghost.parentNode.removeChild(state.drag.ghost);
    document.querySelectorAll(".br-letter-slot.br-drop-active").forEach(function (el) {
      el.classList.remove("br-drop-active");
    });
    state.drag = null;
  }

  function bindUi() {
    var input = $("br-input");
    if (input) {
      input.addEventListener("input", analyzeText);
    }
    $("br-generate-btn") &&
      $("br-generate-btn").addEventListener("click", function () {
        brewGenerate();
      });
    $("br-variation-btn") &&
      $("br-variation-btn").addEventListener("click", function () {
        brewGenerate({ variation: true });
      });
    $("br-randomize-alpha") &&
      $("br-randomize-alpha").addEventListener("click", function () {
        randomizeAlphabet();
      });
    $("br-linear-toggle") &&
      $("br-linear-toggle").addEventListener("click", function () {
        setLinearMode(!state.linearMode);
      });
    $("br-randomize-tray") &&
      $("br-randomize-tray").addEventListener("click", function () {
        fillTrayRandom();
        renderTray();
      });
    var strip = $("br-spell-strip");
    if (strip) {
      strip.addEventListener("pointerdown", onPointerDown);
      strip.addEventListener("pointermove", onPointerMove);
      strip.addEventListener("pointerup", onPointerUp);
      strip.addEventListener("pointercancel", onPointerCancel);
    }
  }

  function onShow() {
    state.active = true;
    loadSpellPool().then(function () {
      analyzeText();
      renderAlphabet();
    });
  }

  function onHide() {
    state.active = false;
  }

  function boot() {
    if (!$("panel-brew")) return;
    initAlphabetSlots();
    bindUi();
    renderAlphabet();
    analyzeText();
    loadSpellPool();
    window.dispatchEvent(new Event("brew-ready"));
  }

  window.Brew = {
    onShow: onShow,
    onHide: onHide,
    generate: brewGenerate,
    assignLetter: assignSpellToLetter,
    setLinearMode: setLinearMode,
  };
  window.addEventListener("brew-show", onShow);
  window.addEventListener("brew-hide", onHide);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();