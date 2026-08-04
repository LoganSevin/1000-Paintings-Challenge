/**
 * Gab — pyramid letter finishers + 10 unique next-word hints, image gen + spell cast.
 */
(function () {
  "use strict";

  var IDLE_MS = 70;
  var PREDICTION_SETS = 5;
  var STANZA_WORDS = 10;
  var TIERS = [1, 2, 3, 4, 5];
  var CAST_TRAY_SLICE = 36;
  var FETCH_TIMEOUT_MS = 90000;
  var POLL_INTERVAL_MS = 900;
  var FIRST_POLL_DELAY_MS = 600;

  var CORE_WORDS =
    "the and for are but not you all can had her was one our out day get has him his how its may new now old see way who boy did its let put say she too use any art oil sky sea sun fog mist glow " +
    "dark light soft bold warm cool deep pale rich mute vivid still calm wild free bold gold blue gray green red pink void form line edge shape color paint brush canvas frame spell cast vision dream " +
    "stone wood glass metal clay silk wool linen marble bronze copper silver crystal ceramic porcelain paper ink charcoal pencil pastel watercolor acrylic tempera fresco mural portrait landscape abstract " +
    "figure shadow highlight texture surface pattern rhythm motion fluid organic geometric angular curved spiral horizon meadow forest mountain river ocean desert garden interior exterior architecture vessel " +
    "lantern book anchor crystal rose thorn vine leaf petal bloom wilt flame ember smoke mirror window door stair hall room wall floor ceiling arch column pillar dome spire bridge path trail wander " +
    "whisper shout echo silence music dance breath pulse heart soul spirit mind hand eye voice word letter glyph symbol sign mark trace trail fade emerge appear vanish shimmer flicker flash gleam glitter " +
    "ancient modern future past present moment eternal fleeting fragile solid hollow dense sparse thick thin wide narrow tall short vast tiny immense infinite finite real imagined remembered forgotten found lost";

  var state = {
    wordBank: {},
    bigrams: {},
    trigrams: {},
    lanePlans: null,
    stanzaSig: "",
    seenStanzas: {},
    idleTimer: null,
    lanesBuilt: false,
    active: false,
    galleryReady: false,
    cast: {
      pool: [],
      poolReady: false,
      trayItems: [],
      applied: [],
      imageUrl: "",
      generating: false,
      continuityId: "",
      drag: null,
    },
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

  function tokenize(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s'-]/g, " ")
      .split(/\s+/)
      .filter(function (w) {
        return w.length > 1;
      });
  }

  function addWord(w) {
    w = String(w || "").toLowerCase().replace(/[^a-z']/g, "");
    if (w.length < 2 || w.length > 24) return;
    state.wordBank[w] = (state.wordBank[w] || 0) + 1;
  }

  function ingestText(text) {
    var words = tokenize(text);
    for (var i = 0; i < words.length; i++) {
      addWord(words[i]);
      if (i > 0) {
        var prev = words[i - 1];
        if (!state.bigrams[prev]) state.bigrams[prev] = {};
        state.bigrams[prev][words[i]] = (state.bigrams[prev][words[i]] || 0) + 1;
        if (i > 1) {
          var pair = words[i - 2] + " " + prev;
          if (!state.trigrams[pair]) state.trigrams[pair] = {};
          state.trigrams[pair][words[i]] = (state.trigrams[pair][words[i]] || 0) + 1;
        }
      }
    }
  }

  function seedWordBank() {
    ingestText(CORE_WORDS);
    if (window.loadGalleryData) {
      window
        .loadGalleryData()
        .then(function (data) {
          (data.manifest || []).forEach(function (m) {
            var a = window.getGalleryAnalysis ? window.getGalleryAnalysis(m.number) : null;
            if (!a) return;
            ingestText(a.title);
            ingestText(a.description);
            ingestText((a.tags || []).join(" "));
            ingestText(a.style);
            ingestText(a.mood);
            ingestText(a.medium);
          });
          state.galleryReady = true;
        })
        .catch(function () {});
    }
  }

  function getGabText() {
    var el = $("gb-input");
    return el && el.value ? el.value.trim() : "";
  }

  var GAB_PUNCT_ONLY = /^[,.!?&]+$/;
  var GAB_PUNCT_TAIL = /[,.!?&]+$/;
  var STANZA_PUNCT = ["", "", "", "", ",", "", "!", "&", "?", "."];

  function lastTokenRaw(text) {
    var m = String(text || "").match(/(\S+)$/);
    return m ? m[1] : "";
  }

  function stripTrailingPunct(token) {
    return String(token || "")
      .replace(GAB_PUNCT_TAIL, "")
      .replace(/[^a-zA-Z0-9']/g, "");
  }

  function isPunctOnly(token) {
    return GAB_PUNCT_ONLY.test(String(token || ""));
  }

  function trailingPunctOnToken(text) {
    var token = lastTokenRaw(text);
    if (!token) return "";
    var m = token.match(GAB_PUNCT_TAIL);
    return m ? m[0] : "";
  }

  function atWordBoundary(text) {
    return !trailingWord(text);
  }

  function trailingWord(text) {
    var t = String(text || "");
    if (!t || /\s$/.test(t)) return "";
    var token = lastTokenRaw(t);
    if (!token || isPunctOnly(token)) return "";
    var letters = token.match(/^([a-zA-Z'][a-zA-Z']*)/);
    if (!letters) return "";
    var rest = token.slice(letters[1].length);
    if (!rest || GAB_PUNCT_ONLY.test(rest)) return "";
    return letters[1];
  }

  function completedWords(text) {
    var raw = String(text || "");
    var t = raw.trim();
    if (!t) return [];
    var tokens = t.split(/\s+/);
    if (!/\s$/.test(raw) && trailingWord(raw) && tokens.length) tokens.pop();
    return tokens
      .map(function (token) {
        if (isPunctOnly(token)) return "";
        return stripTrailingPunct(token).toLowerCase();
      })
      .filter(function (w) {
        return w.length > 1;
      });
  }

  function lastCompletedWordRaw(text) {
    var t = String(text || "");
    if (!t.trim()) return "";
    if (/\s$/.test(t)) {
      var spaced = t.trim().split(/\s+/);
      return spaced.length ? spaced[spaced.length - 1] : "";
    }
    if (trailingWord(t)) {
      var parts = t.trim().split(/\s+/);
      return parts.length > 1 ? parts[parts.length - 2] : "";
    }
    return lastTokenRaw(t);
  }

  function completionsFor(partial) {
    partial = String(partial || "").toLowerCase();
    if (!partial) return [];
    var hits = [];
    Object.keys(state.wordBank).forEach(function (w) {
      if (w.indexOf(partial) === 0 && w.length > partial.length) hits.push(w);
    });
    hits.sort(function (a, b) {
      var fa = state.wordBank[a] || 0;
      var fb = state.wordBank[b] || 0;
      if (fb !== fa) return fb - fa;
      if (a.length !== b.length) return a.length - b.length;
      return a.localeCompare(b);
    });
    return hits;
  }

  function rankedFollowers(map) {
    if (!map) return [];
    return Object.keys(map).sort(function (a, b) {
      return map[b] - map[a] || a.localeCompare(b);
    });
  }

  function frequentWords(limit, offset) {
    limit = limit || 24;
    offset = offset || 0;
    var keys = Object.keys(state.wordBank).sort(function (a, b) {
      return (state.wordBank[b] || 0) - (state.wordBank[a] || 0) || a.localeCompare(b);
    });
    if (!keys.length) return ["vision"];
    var out = [];
    var i;
    for (i = 0; i < limit; i++) {
      out.push(keys[(offset + i) % keys.length]);
    }
    return out;
  }

  function nextWordAfter(prev, seed) {
    prev = String(prev || "").toLowerCase();
    seed = seed || 0;
    var ranked = rankedFollowers(state.bigrams[prev]);
    if (ranked.length) return ranked[seed % ranked.length];
    return frequentWords(1, seed + prev.length)[0];
  }

  function nextWordAfterContext(prevTwo, prevOne, seed) {
    prevTwo = String(prevTwo || "").toLowerCase();
    prevOne = String(prevOne || "").toLowerCase();
    seed = seed || 0;
    if (prevTwo && prevOne) {
      var tri = rankedFollowers(state.trigrams[prevTwo + " " + prevOne]);
      if (tri.length) return tri[seed % tri.length];
    }
    return nextWordAfter(prevOne, seed);
  }

  function lastCompletedWord(text) {
    var words = completedWords(text);
    return words.length ? String(words[words.length - 1]) : "";
  }

  function punctForSlot(index) {
    return STANZA_PUNCT[index] || "";
  }

  function spacingAfterPunct(punct) {
    return !!punct;
  }

  function formatWordWithPunct(word, punct) {
    if (!word) return "";
    return word + (punct || "");
  }

  function stanzaRankOffset(slot) {
    return [0, 1, 2, 3, 4, 8, 12, 17, 22, 28][slot] || slot * 3;
  }

  function pickUniqueWord(options, rank, used, fallbackSeed) {
    var i;
    var w;
    for (i = 0; i < options.length + 24; i++) {
      w = options[(rank + i) % Math.max(options.length, 1)];
      if (w && !used[w]) return w;
    }
    w = frequentWords(1, fallbackSeed + rank)[0];
    if (w && !used[w]) return w;
    for (i = 0; i < 40; i++) {
      w = frequentWords(1, fallbackSeed + rank + i + 7)[0];
      if (w && !used[w]) return w;
    }
    return w || "";
  }

  function buildStanzaPredictions(text) {
    var partial = trailingWord(text);
    var lowerPartial = partial.toLowerCase();
    var words = completedWords(text);
    var anchor = lastCompletedWord(text);
    var context = words.map(function (w) {
      return String(w).toLowerCase();
    });
    var predictions = [];
    var used = {};
    var slot = 0;
    var seed = String(text || "").length;

    if (lowerPartial.length) {
      var completions = completionsFor(lowerPartial);
      var finish = pickUniqueWord(completions.length ? completions : frequentWords(12, seed), 0, used, seed);
      if (finish) {
        used[finish] = true;
        predictions.push(finish);
        if (context.length) context[context.length - 1] = finish;
        else context.push(finish);
        anchor = finish;
        slot = 1;
      }
    }

    while (predictions.length < STANZA_WORDS) {
      var prevTwo = context.length > 1 ? context[context.length - 2] : "";
      var prevOne = context.length ? context[context.length - 1] : "";
      var options = followerOptions(prevTwo, prevOne, seed + slot * 31);
      var rank = stanzaRankOffset(slot);
      var pick = pickUniqueWord(options, rank, used, seed + slot);
      if (!pick) break;
      used[pick] = true;
      predictions.push(pick);
      context.push(pick);
      slot++;
    }

    return {
      anchor: anchor,
      partial: partial,
      words: predictions,
    };
  }

  function stanzaSignature(stanza) {
    return (stanza.anchor || "") + "|" + (stanza.words || []).join(" ");
  }

  function avoidRepeatedStanza(stanza, text) {
    var sig = stanzaSignature(stanza);
    var attempt = 0;
    while (state.seenStanzas[sig] && attempt < 12) {
      stanza = buildStanzaPredictions(text + String.fromCharCode(32 + attempt));
      sig = stanzaSignature(stanza);
      attempt++;
    }
    state.seenStanzas[sig] = true;
    var keys = Object.keys(state.seenStanzas);
    if (keys.length > 48) {
      keys.slice(0, keys.length - 40).forEach(function (k) {
        delete state.seenStanzas[k];
      });
    }
    state.stanzaSig = sig;
    return stanza;
  }

  function appendWordToInput(word, punct) {
    var input = $("gb-input");
    if (!input || !word) return;
    var val = input.value;
    var partial = trailingWord(val);
    if (partial.length) val = val.slice(0, -partial.length);
    if (val.length && !/\s$/.test(val)) val += " ";
    val += formatWordWithPunct(word, punct);
    if (spacingAfterPunct(punct)) val += " ";
    input.value = val;
    onInput();
    input.focus();
  }

  function updateLastWordDisplay(text, mode) {
    var el = $("gb-last-word");
    if (!el) return;
    if (mode === "idle" || (!text.trim() && !trailingWord(text))) {
      el.textContent = "Last word: —";
      return;
    }
    var partial = trailingWord(text);
    if (partial) {
      el.textContent = "Last word: " + partial + "…";
      return;
    }
    var raw = lastCompletedWordRaw(text);
    var clean = stripTrailingPunct(raw);
    if (!clean) {
      el.textContent = "Last word: —";
      return;
    }
    var punct = raw.match(GAB_PUNCT_TAIL);
    el.textContent = "Last word: " + clean + (punct ? punct[0] : "");
  }

  function formatStanzaHint(zone, variant, text, stanza) {
    if (!stanza || !stanza.words.length) return "word, next";
    var slot = zone === "below" ? variant + 5 : variant;
    var word = stanza.words[slot] || "";
    if (!word) return "…";
    var punct = punctForSlot(slot);
    var shown = formatWordWithPunct(word, punct);
    var anchor = lastCompletedWord(text);
    var anchorRaw = lastCompletedWordRaw(text);
    var anchorPunct = anchorRaw.match(GAB_PUNCT_TAIL);
    var anchorShown = anchor
      ? anchor + (anchorPunct && atWordBoundary(text) ? anchorPunct[0] : "")
      : "";
    if (zone === "above" && variant === 0 && anchorShown) {
      return anchorShown + " → " + shown;
    }
    return shown;
  }

  function setHintElement(el, zone, variant, text, stanza, mode) {
    if (!el) return;
    if (mode === "idle") {
      el.textContent = "word, next";
      el.title = "";
      el.classList.remove("gb-hint-live");
      delete el.dataset.word;
      delete el.dataset.punct;
      return;
    }
    var slot = zone === "below" ? variant + 5 : variant;
    var word = stanza && stanza.words[slot] ? stanza.words[slot] : "";
    var punct = punctForSlot(slot);
    var hint = formatStanzaHint(zone, variant, text, stanza);
    el.textContent = hint;
    el.title = word ? "Tap to add: " + formatWordWithPunct(word, punct) : "";
    el.classList.add("gb-hint-live");
    if (word) {
      el.dataset.word = word;
      el.dataset.punct = punct;
    }
  }

  function planSignature(head, forward) {
    return String(head || "").toLowerCase() + "|" + (forward || []).slice(0, 4).join(" ");
  }

  function buildCompletionPool(partial, words, need) {
    partial = String(partial || "").toLowerCase();
    need = need || 16;
    var pool = [];
    var seen = {};
    var hits = completionsFor(partial);
    var ranked;

    function pushWord(word) {
      word = String(word || "").toLowerCase();
      if (!word || seen[word]) return;
      if (partial && word.indexOf(partial) !== 0) return;
      if (partial && word.length <= partial.length) return;
      seen[word] = true;
      pool.push(word);
    }

    hits.forEach(pushWord);
    if (!partial.length && words.length) {
      ranked = rankedFollowers(state.bigrams[words[words.length - 1].toLowerCase()]);
      ranked.forEach(pushWord);
    }
    if (pool.length < need) {
      frequentWords(need * 2).forEach(function (fw) {
        if (!partial.length) pushWord(fw);
      });
    }
    if (partial.length && pool.length < need) {
      Object.keys(state.wordBank).forEach(pushWord);
    }
    var guard = 0;
    while (pool.length < need && guard < need * 4) {
      pushWord(frequentWords(1, pool.length + partial.length + guard)[0]);
      guard++;
    }
    return pool.slice(0, Math.max(pool.length, need));
  }

  function followerOptions(prevTwo, prevOne, seed) {
    var options = [];
    var seen = {};
    var tri;
    var bi;
    var fw;
    var i;

    function pushOption(word) {
      word = String(word || "").toLowerCase();
      if (!word || seen[word]) return;
      seen[word] = true;
      options.push(word);
    }

    if (prevTwo && prevOne) {
      tri = rankedFollowers(state.trigrams[prevTwo + " " + prevOne]);
      tri.forEach(pushOption);
    }
    bi = rankedFollowers(state.bigrams[prevOne]);
    bi.forEach(pushOption);
    fw = frequentWords(18, seed);
    fw.forEach(pushOption);

    if (!options.length) return frequentWords(6, seed);
    for (i = options.length - 1; i > 0; i--) {
      var j = (seed + i * 7) % (i + 1);
      var tmp = options[i];
      options[i] = options[j];
      options[j] = tmp;
    }
    return options;
  }

  function buildForwardChain(anchorWords, seed, count) {
    anchorWords = (anchorWords || []).map(function (w) {
      return String(w || "").toLowerCase();
    });
    count = count || 3;
    seed = seed || 0;
    var chain = [];
    var prevTwo = anchorWords.length > 1 ? anchorWords[anchorWords.length - 2] : "";
    var prevOne = anchorWords.length ? anchorWords[anchorWords.length - 1] : "";
    var options;
    var pick;
    var step;

    for (step = 0; step < count; step++) {
      options = followerOptions(prevTwo, prevOne, seed + step * 19);
      pick = options[(seed + step * 11) % options.length];
      if (chain.length && chain[chain.length - 1] === pick) {
        pick = options[(seed + step * 11 + 1) % options.length];
      }
      chain.push(pick);
      prevTwo = prevOne;
      prevOne = pick;
    }
    return chain;
  }

  function pickCompletionFromPool(pool, variant, usedWords) {
    var i;
    var word;
    for (i = 0; i < pool.length; i++) {
      word = pool[(variant + i) % pool.length];
      if (!usedWords[word]) return word;
    }
    return pool[variant % pool.length] || "";
  }

  function buildLanePlans(text) {
    var partial = trailingWord(text);
    var lower = partial.toLowerCase();
    var words = completedWords(text);
    var completionPool = buildCompletionPool(lower, words, 20);
    var usedSigs = {};
    var usedHints = {};
    var usedCompletions = {};
    var lanes = [];
    var v;
    var completion;
    var anchorWords;
    var forward;
    var sig;
    var attempt;

    for (v = 0; v < PREDICTION_SETS; v++) {
      completion = pickCompletionFromPool(completionPool, v, usedCompletions);
      if (completion) usedCompletions[completion] = true;
      anchorWords = words.slice();
      if (lower.length && completion) {
        if (anchorWords.length) anchorWords[anchorWords.length - 1] = completion;
        else anchorWords.push(completion);
      } else if (!lower.length && completion) {
        anchorWords = anchorWords.concat([completion]);
      }
      for (attempt = 0; attempt < 20; attempt++) {
        forward = buildForwardChain(anchorWords, v * 17 + attempt * 9 + 3, 4);
        sig = planSignature(completion || anchorWords.join(" "), forward);
        if (!usedSigs[sig]) break;
      }
      usedSigs[sig] = true;
      lanes.push({
        variant: v,
        completion: completion,
        forward: forward,
        anchorWords: anchorWords,
      });
    }
    return { lanes: lanes };
  }

  function pushLetterTokens(tokens, text, role) {
    String(text || "")
      .slice(0, 12)
      .split("")
      .forEach(function (ch) {
        if (ch === " ") return;
        tokens.push({ type: "letter", char: ch, role: role });
      });
  }

  function pushWordGap(tokens, role) {
    tokens.push({ type: "gap", role: role || "word-end" });
  }

  function grammaticalLetterStream(plan, tier) {
    var partial = trailingWord(plan.text).toLowerCase();
    var words = completedWords(plan.text);
    var finishPart = "";
    var bridgeParts = [];
    var wi;
    var needed;

    if (partial.length && plan.completion) {
      finishPart = plan.completion.slice(partial.length);
      plan.forward.forEach(function (w) {
        bridgeParts.push(String(w || ""));
      });
    } else if (plan.completion) {
      finishPart = plan.completion;
      plan.forward.forEach(function (w) {
        bridgeParts.push(String(w || ""));
      });
    } else if (plan.forward.length) {
      finishPart = plan.forward[0];
      for (wi = 1; wi < plan.forward.length; wi++) bridgeParts.push(plan.forward[wi]);
    }

    needed = tier;
    var segments = [];
    if (finishPart.length) {
      segments.push({
        text: finishPart.slice(0, needed),
        role: partial.length ? "finish" : "next",
      });
      needed -= Math.min(needed, finishPart.length);
    }
    for (wi = 0; wi < bridgeParts.length && needed > 0; wi++) {
      segments.push({ text: bridgeParts[wi].slice(0, needed), role: "bridge", gapBefore: true });
      needed -= Math.min(needed, bridgeParts[wi].length);
    }
    return {
      segments: segments,
      needsWordStartGap: !partial.length && words.length > 0,
    };
  }

  function tokensFromLetterStream(stream, tier) {
    var tokens = [];
    var letters = 0;
    var si;

    if (stream.needsWordStartGap) pushWordGap(tokens, "word-start");

    for (si = 0; si < stream.segments.length && letters < tier; si++) {
      var seg = stream.segments[si];
      if (!seg.text) continue;
      if (seg.gapBefore && letters > 0) pushWordGap(tokens, "word-end");
      pushLetterTokens(tokens, seg.text, seg.role);
      letters += seg.text.length;
    }
    return { tokens: tokens };
  }

  function predictLaneTier(text, tier, variant, lanePlans) {
    var plan = lanePlans.lanes[variant];
    if (!plan) return { tokens: [] };
    plan.text = text;
    return tokensFromLetterStream(grammaticalLetterStream(plan, tier), tier);
  }

  function randomLetter() {
    return String.fromCharCode(97 + Math.floor(Math.random() * 26));
  }

  function buildLaneStack(container, idPrefix, hintPrefix, descending, zone) {
    if (!container) return;
    container.innerHTML = "";
    var v;
    for (v = 0; v < PREDICTION_SETS; v++) {
      var lane = document.createElement("div");
      lane.className = "gb-pred-lane" + (descending ? "" : " gb-pred-lane-below");
      lane.dataset.variant = String(v);
      var label = document.createElement("span");
      label.className = "gb-pred-label" + (descending ? "" : " gb-pred-label-below");
      label.textContent = String(v + 1);
      lane.appendChild(label);
      var hint = document.createElement("button");
      hint.type = "button";
      hint.className = "gb-pred-hint gb-hint-tap";
      hint.id = hintPrefix + v;
      (function (hintBtn) {
        hintBtn.addEventListener("click", function () {
          var w = hintBtn.dataset.word;
          if (w) appendWordToInput(w, hintBtn.dataset.punct || "");
        });
      })(hint);
      lane.appendChild(hint);
      var tiersWrap = document.createElement("div");
      tiersWrap.className = "gb-pred-tiers" + (descending ? "" : " gb-pred-tiers-below");
      var order = descending ? [5, 4, 3, 2, 1] : [1, 2, 3, 4, 5];
      order.forEach(function (tierNum) {
        var tierEl = document.createElement("div");
        tierEl.className = "gb-tier gb-tier-" + tierNum + " gb-tier-lane";
        tierEl.id = idPrefix + v + "-tier-" + tierNum;
        tiersWrap.appendChild(tierEl);
      });
      lane.appendChild(tiersWrap);
      container.appendChild(lane);
    }
  }

  function buildPredictionLanes() {
    if (state.lanesBuilt) return;
    buildLaneStack($("gb-finisher-stack"), "gb-v", "gb-pred-hint-", true, "above");
    buildLaneStack($("gb-finisher-below"), "gb-bv", "gb-below-hint-", false, "below");
    state.lanesBuilt = true;
  }

  function tierElementId(zone, variant, tier) {
    return (zone === "below" ? "gb-bv" : "gb-v") + variant + "-tier-" + tier;
  }

  function renderTier(zone, variant, tier, payload, mode) {
    var el = $(tierElementId(zone, variant, tier));
    if (!el) return;
    el.innerHTML = "";
    el.className =
      "gb-tier gb-tier-" + tier + " gb-tier-lane" + (mode === "idle" ? " gb-idle" : " gb-live");
    var tokens = payload && payload.tokens;
    var idx = 0;

    if (tokens && tokens.length) {
      tokens.forEach(function (tok) {
        if (tok.type === "gap") {
          var gap = document.createElement("span");
          gap.className = "gb-word-gap" + (tok.role === "word-start" ? " gb-word-gap-start" : "");
          gap.setAttribute("aria-label", "Word break");
          gap.appendChild(document.createElement("i"));
          el.appendChild(gap);
          return;
        }
        var span = document.createElement("span");
        span.className = "gb-letter";
        if (tok.role === "bridge" || tok.role === "next") span.className += " gb-letter-bridge";
        if (tok.role === "finish" || tok.role === "predict") span.className += " gb-letter-predict";
        span.textContent = tok.char;
        span.style.animationDelay = idx * 0.06 + tier * 0.03 + variant * 0.05 + "s";
        el.appendChild(span);
        idx++;
      });
      return;
    }

    var letters = payload.letters || payload;
    if (typeof letters === "string") letters = letters.split("");
    letters.forEach(function (ch, i) {
      var span = document.createElement("span");
      span.className = "gb-letter";
      span.textContent = ch === " " ? "·" : ch;
      span.style.animationDelay = i * 0.06 + tier * 0.03 + variant * 0.05 + "s";
      el.appendChild(span);
    });
  }

  function renderVariant(zone, variant, text, mode, lanePlans, stanza) {
    var hintId = zone === "below" ? "gb-below-hint-" : "gb-pred-hint-";
    if (mode === "idle") {
      TIERS.forEach(function (tier) {
        var letters = [];
        var v;
        for (v = 0; v < tier; v++) letters.push(randomLetter());
        renderTier(zone, variant, tier, letters, "idle");
      });
      setHintElement($(hintId + variant), zone, variant, text, null, "idle");
      return;
    }
    TIERS.forEach(function (tier) {
      renderTier(zone, variant, tier, predictLaneTier(text, tier, variant, lanePlans), "live");
    });
    setHintElement($(hintId + variant), zone, variant, text, stanza, "live");
  }

  function renderAllVariants(text, mode) {
    var v;
    var lanePlans = mode === "live" ? buildLanePlans(text) : null;
    var stanza = mode === "live" ? avoidRepeatedStanza(buildStanzaPredictions(text), text) : null;
    state.lanePlans = lanePlans;
    updateLastWordDisplay(text, mode);
    for (v = 0; v < PREDICTION_SETS; v++) {
      renderVariant("above", v, text, mode, lanePlans, stanza);
      renderVariant("below", v, text, mode, lanePlans, stanza);
    }
  }

  function renderIdle() {
    renderAllVariants("", "idle");
    var countEl = $("gb-count");
    if (countEl) countEl.textContent = "a–z flash · type to predict";
  }

  function renderLive(text) {
    renderAllVariants(text, "live");
    var countEl = $("gb-count");
    if (countEl) {
      var stanza = buildStanzaPredictions(text);
      countEl.textContent =
        text.length + " chars · " + stanza.words.length + " next words · pyramid live";
    }
  }

  function onInput() {
    var input = $("gb-input");
    if (!input) return;
    var text = input.value;
    if (!text.trim() && !trailingWord(text)) {
      renderIdle();
      return;
    }
    renderLive(text);
  }

  function startIdle() {
    stopIdle();
    buildPredictionLanes();
    renderIdle();
    state.idleTimer = setInterval(function () {
      var input = $("gb-input");
      if (!input || input.value.trim() || trailingWord(input.value)) return;
      renderIdle();
    }, IDLE_MS);
  }

  function stopIdle() {
    if (state.idleTimer) {
      clearInterval(state.idleTimer);
      state.idleTimer = null;
    }
  }

  function setStatus(msg, kind) {
    var el = $("gb-status");
    if (!el) return;
    el.textContent = msg || "";
    el.className = "gb-status" + (kind ? " " + kind : "");
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
      paintingNum: num,
      label: "#" + num,
    });
  }

  function paintingNumsFromSpells(spells) {
    var nums = [];
    (spells || []).forEach(function (s) {
      if (s.paintingNum && nums.indexOf(s.paintingNum) < 0) nums.push(s.paintingNum);
    });
    return nums.sort(function (a, b) {
      return a - b;
    });
  }

  function buildGabStasis() {
    var prompt = getGabText();
    var lines = ["GAB CAST — paint the typed vision with equipped spell characteristics."];
    if (prompt) {
      lines.push("");
      lines.push("Gab prompt:");
      lines.push(prompt);
    }
    if (state.cast.applied.length) {
      lines.push("");
      lines.push("Equipped spells:");
      state.cast.applied.forEach(function (s) {
        var a = s.analysis || (s.paintingNum && window.getGalleryAnalysis ? window.getGalleryAnalysis(s.paintingNum) : null);
        lines.push(
          "#" + s.paintingNum + " " + (s.title || "Spell") + ": " + String((a && a.description) || "").slice(0, 280)
        );
      });
    }
    return lines.join("\
");
  }

  function buildGabBuzz() {
    var buzz = ["gab cast", "painterly vision"];
    ingestText(getGabText());
    tokenize(getGabText()).forEach(function (w) {
      if (buzz.indexOf(w) < 0) buzz.push(w);
    });
    state.cast.applied.forEach(function (s) {
      (s.tags || []).slice(0, 4).forEach(function (t) {
        if (buzz.indexOf(t) < 0) buzz.push(t);
      });
    });
    return buzz;
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
    if (attemptsLeft <= 0) return Promise.reject(new Error("Gab generation timed out."));
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
        setStatus("Generating… (" + (job.status || "working") + ")", "pending");
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
    var empty = $("gb-cast-empty");
    var img = $("gb-cast-preview");
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
    state.cast.generating = true;
    var stage = $("gb-cast-stage");
    if (stage) stage.classList.add("gb-generating");
    document.querySelectorAll(".gb-btn, .gb-spell").forEach(function (el) {
      el.disabled = true;
    });
  }

  function endGenerate() {
    state.cast.generating = false;
    var stage = $("gb-cast-stage");
    if (stage) stage.classList.remove("gb-generating");
    document.querySelectorAll(".gb-btn, .gb-spell").forEach(function (el) {
      el.disabled = false;
    });
  }

  function gabGenerate(options) {
    options = options || {};
    if (state.cast.generating) return Promise.resolve();
    var prompt = getGabText();
    var applied = state.cast.applied;
    var hasImage = !!state.cast.imageUrl;
    if (!prompt && !applied.length && !hasImage) {
      setStatus("Type your gab prompt first.", "error");
      return Promise.resolve();
    }
    if (!state.cast.continuityId) {
      state.cast.continuityId = "gb-cast-" + Date.now();
    }
    var variation = !!options.variation;
    var spellCast = !!options.spellCast;
    var lastSpell = applied.length ? applied[applied.length - 1] : null;
    if (!spellCast && hasImage && !variation && lastSpell) spellCast = true;
    var refine = spellCast || (hasImage && !variation);

    beginGenerate();
    setStatus(
      spellCast
        ? "Imbuing gab vision with spell…"
        : variation
          ? "Painting new variation…"
          : hasImage
            ? "Refining gab vision…"
            : "Generating from gab prompt…",
      "pending"
    );

    var jobId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : "gb-" + Date.now();
    var refImage = state.cast.imageUrl || "";
    var spellRef = spellCast && lastSpell ? lastSpell.url : "";

    return compressDataUrl(refImage, 1280, 0.82)
      .then(function (compressedRef) {
        return fetchWithTimeout(
          apiUrl("/api/generate-stasis-vision"),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              job_id: jobId,
              stasis: buildGabStasis(),
              craft_hints: prompt ? "Gab: " + prompt : "",
              buzz_words: buildGabBuzz(),
              spells: paintingNumsFromSpells(applied),
              aspect_ratio: "16:9",
              mag_fresh: !refine,
              fresh_variation: variation,
              refine: refine,
              spell_cast: spellCast,
              spell_reference_image: spellRef,
              reference_image: refine ? compressedRef : "",
              prompt: prompt,
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
        state.cast.imageUrl = url;
        showPreview(url);
        setStatus("Vision ready — drag spells onto the stage to reshape.", "ok");
      })
      .catch(function (err) {
        setStatus(err.message || "Generate failed. Is the gallery server running?", "error");
      })
      .finally(endGenerate);
  }

  function renderApplied() {
    var row = $("gb-applied");
    if (!row) return;
    row.innerHTML = "";
    if (!state.cast.applied.length) {
      row.innerHTML = '<span class="gb-applied-empty">No spells — drag from tray onto the stage.</span>';
      return;
    }
    state.cast.applied.forEach(function (item, idx) {
      var chip = document.createElement("span");
      chip.className = "gb-chip";
      chip.textContent = item.label || "Spell";
      var rm = document.createElement("button");
      rm.type = "button";
      rm.className = "gb-chip-rm";
      rm.textContent = "×";
      rm.dataset.idx = String(idx);
      chip.appendChild(rm);
      row.appendChild(chip);
    });
  }

  function addSpell(item) {
    if (state.cast.generating) return;
    item = normalizeSpell(item);
    if (!item.url) return;
    if (!state.cast.imageUrl && !getGabText()) {
      setStatus("Type a gab prompt and Generate first, or generate then drag spells.", "error");
      return;
    }
    var exists = state.cast.applied.some(function (s) {
      return s.url === item.url;
    });
    if (exists) {
      setStatus("That spell is already equipped.", "error");
      return;
    }
    if (state.cast.applied.length >= 16) {
      setStatus("Max 16 spells.", "error");
      return;
    }
    state.cast.applied.push(item);
    renderApplied();
    if (state.cast.imageUrl) {
      setStatus("Applying spell " + state.cast.applied.length + "…", "pending");
      gabGenerate({ spellCast: true });
    } else {
      setStatus("Spell equipped — hit Generate image.", "ok");
    }
  }

  function loadSpellPool() {
    if (state.cast.poolReady) return Promise.resolve();
    return (window.loadGalleryData ? window.loadGalleryData() : Promise.resolve({ manifest: [] }))
      .then(function (data) {
        state.cast.pool = (data.manifest || []).map(function (m) {
          return normalizeSpell(spellRow(m));
        });
        state.cast.poolReady = true;
        fillTrayRandom();
        renderTray();
      });
  }

  function fillTrayRandom() {
    var copy = state.cast.pool.slice();
    for (var i = copy.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = copy[i];
      copy[i] = copy[j];
      copy[j] = t;
    }
    state.cast.trayItems = copy.slice(0, CAST_TRAY_SLICE);
  }

  function renderTray() {
    var strip = $("gb-spell-strip");
    if (!strip) return;
    strip.innerHTML = "";
    state.cast.trayItems.forEach(function (item, idx) {
      var el = document.createElement("div");
      el.className = "st-spell gb-spell";
      el.dataset.idx = String(idx);
      var img = document.createElement("img");
      img.src = item.url;
      img.alt = item.label;
      el.appendChild(img);
      strip.appendChild(el);
    });
    var count = $("gb-tray-count");
    if (count) count.textContent = state.cast.trayItems.length + " shown · drag onto stage";
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

  function isOverStage(x, y) {
    var stage = $("gb-cast-stage");
    if (!stage) return false;
    var rect = stage.getBoundingClientRect();
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  function onPointerDown(e) {
    if (state.cast.generating) return;
    var spell = e.target.closest(".gb-spell");
    if (!spell || !spell.closest("#gb-spell-strip")) return;
    var item = normalizeSpell(state.cast.trayItems[parseInt(spell.dataset.idx, 10)]);
    if (!item.url) return;
    e.preventDefault();
    spell.setPointerCapture(e.pointerId);
    state.cast.drag = {
      item: item,
      ghost: createGhost(item, e.clientX, e.clientY),
      pointerId: e.pointerId,
    };
    var stage = $("gb-cast-stage");
    if (stage) stage.classList.add("gb-drop-active");
  }

  function onPointerUp(e) {
    if (!state.cast.drag || e.pointerId !== state.cast.drag.pointerId) return;
    var drag = state.cast.drag;
    if (drag.ghost.parentNode) drag.ghost.parentNode.removeChild(drag.ghost);
    var stage = $("gb-cast-stage");
    if (stage) stage.classList.remove("gb-drop-active");
    if (isOverStage(e.clientX, e.clientY)) addSpell(drag.item);
    state.cast.drag = null;
  }

  function onPointerMove(e) {
    if (!state.cast.drag || e.pointerId !== state.cast.drag.pointerId) return;
    state.cast.drag.ghost.style.left = e.clientX + "px";
    state.cast.drag.ghost.style.top = e.clientY + "px";
  }

  function onPointerCancel(e) {
    if (!state.cast.drag || e.pointerId !== state.cast.drag.pointerId) return;
    if (state.cast.drag.ghost.parentNode) state.cast.drag.ghost.parentNode.removeChild(state.cast.drag.ghost);
    var stage = $("gb-cast-stage");
    if (stage) stage.classList.remove("gb-drop-active");
    state.cast.drag = null;
  }

  function bindUi() {
    var input = $("gb-input");
    if (input) {
      input.addEventListener("input", onInput);
      input.addEventListener("focus", onInput);
    }
    $("gb-generate-btn") &&
      $("gb-generate-btn").addEventListener("click", function () {
        gabGenerate();
      });
    $("gb-variation-btn") &&
      $("gb-variation-btn").addEventListener("click", function () {
        gabGenerate({ variation: true });
      });
    $("gb-randomize") &&
      $("gb-randomize").addEventListener("click", function () {
        fillTrayRandom();
        renderTray();
      });
    $("gb-applied") &&
      $("gb-applied").addEventListener("click", function (e) {
        var btn = e.target.closest(".gb-chip-rm");
        if (!btn) return;
        state.cast.applied.splice(parseInt(btn.dataset.idx, 10), 1);
        renderApplied();
      });
    var strip = $("gb-spell-strip");
    if (strip) {
      strip.addEventListener("pointerdown", onPointerDown);
      strip.addEventListener("pointermove", onPointerMove);
      strip.addEventListener("pointerup", onPointerUp);
      strip.addEventListener("pointercancel", onPointerCancel);
    }
  }

  function onShow() {
    state.active = true;
    buildPredictionLanes();
    startIdle();
    loadSpellPool();
    renderApplied();
    if (!state.galleryReady) seedWordBank();
  }

  function onHide() {
    state.active = false;
    stopIdle();
  }

  function boot() {
    if (!$("panel-gab")) return;
    buildPredictionLanes();
    seedWordBank();
    bindUi();
    renderApplied();
    renderIdle();
    window.dispatchEvent(new Event("gab-ready"));
  }

  window.Gab = { onShow: onShow, onHide: onHide, generate: gabGenerate };
  window.addEventListener("gab-show", onShow);
  window.addEventListener("gab-hide", onHide);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
