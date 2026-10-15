/* Splice engine — linear "CRISPR" word descrambler. No 15-letter limit:
 * the strand is walked left to right, one word slot at a time, each slot is
 * filled with a dictionary word drawn from the letters still in the pool. */
(function (root) {
  "use strict";

  var FUNCTION_WORDS = [
    "a", "i", "the", "of", "in", "to", "and", "is", "it", "on", "at", "as", "an", "or", "be", "by",
    "we", "he", "so", "no", "my", "me", "us", "up", "do", "go", "if", "its", "for", "with", "was",
    "are", "his", "her", "our", "all", "but", "not", "from", "this", "that", "into", "one", "who",
    "she", "they", "has", "had", "you", "out", "now", "then", "than", "what", "when", "where",
  ];
  var FUNC = {};
  FUNCTION_WORDS.forEach(function (w) { FUNC[w] = true; });
  var TWO_OK = {};
  ("am an as at be by do go he hi if in is it me my no of oh on or ox so to up us we ah ok").split(" ").forEach(function (w) { TWO_OK[w] = true; });

  function isLetter(ch) { return /[A-Za-z]/.test(ch); }

  /** Strand: word slots (letters), anchors (punctuation, locked), gaps (spaces = "?"). */
  function parseStrand(text) {
    text = String(text || "");
    var tokens = [];
    var i = 0;
    while (i < text.length) {
      var ch = text.charAt(i);
      if (isLetter(ch)) {
        var j = i;
        while (j < text.length && isLetter(text.charAt(j))) j++;
        tokens.push({ type: "word", src: text.slice(i, j), len: j - i, slot: 0 });
        i = j;
      } else if (/\s/.test(ch)) {
        var k = i;
        while (k < text.length && /\s/.test(text.charAt(k))) k++;
        tokens.push({ type: "gap" });
        i = k;
      } else {
        tokens.push({ type: "anchor", ch: ch });
        i++;
      }
    }
    // trim leading/trailing gaps
    while (tokens.length && tokens[0].type === "gap") tokens.shift();
    while (tokens.length && tokens[tokens.length - 1].type === "gap") tokens.pop();
    var slots = [];
    tokens.forEach(function (t) { if (t.type === "word") { t.slot = slots.length; slots.push(t); } });
    return { tokens: tokens, slots: slots, pool: countLetters(text) };
  }

  function countLetters(s) {
    var c = new Array(26).fill(0);
    s = String(s || "").toLowerCase();
    for (var i = 0; i < s.length; i++) {
      var k = s.charCodeAt(i) - 97;
      if (k >= 0 && k < 26) c[k]++;
    }
    return c;
  }
  function sortKey(w) { return w.split("").sort().join(""); }
  function fits(counts, pool) {
    for (var i = 0; i < 26; i++) if (counts[i] > pool[i]) return false;
    return true;
  }
  function take(pool, counts, sign) {
    for (var i = 0; i < 26; i++) pool[i] -= sign * counts[i];
  }
  function sum(arr) { var s = 0; for (var i = 0; i < arr.length; i++) s += arr[i]; return s; }

  /** Word list from data/diction (one word per line). */
  function cleanWords(list) {
    var out = [];
    var seen = {};
    for (var i = 0; i < list.length; i++) {
      var w = String(list[i] || "").trim().toLowerCase();
      if (!w || !/^[a-z]+$/.test(w) || seen[w]) continue;
      if (w.length === 1 && w !== "a" && w !== "i") continue;
      if (w.length === 2 && !TWO_OK[w]) continue;
      seen[w] = true;
      out.push(w);
    }
    FUNCTION_WORDS.forEach(function (w) { if (!seen[w]) { seen[w] = true; out.push(w); } });
    return out;
  }

  /** Sorted-letters index for one pool: len -> [{key, counts, words}], only entries the full pool can build. */
  function buildIndex(words, pool) {
    var byLen = {};
    var groups = {};
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      var c = countLetters(w);
      if (!fits(c, pool)) continue;
      var key = sortKey(w);
      var g = groups[key];
      if (!g) {
        g = groups[key] = { key: key, counts: c, words: [] };
        (byLen[w.length] = byLen[w.length] || []).push(g);
      }
      g.words.push(w);
    }
    return { byLen: byLen, byKey: groups };
  }

  function makeRng(seed) {
    if (seed == null) return Math.random;
    var s = (seed >>> 0) || 1;
    return function () {
      s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
      return (s >>> 0) / 4294967296;
    };
  }

  /** How close a candidate is to the source word: letters in place + shared letters. */
  function similarity(w, src) {
    src = String(src || "").toLowerCase();
    if (!src) return 0;
    var pos = 0;
    var n = Math.min(w.length, src.length);
    for (var i = 0; i < n; i++) if (w.charAt(i) === src.charAt(i)) pos++;
    var a = countLetters(w), b = countLetters(src), shared = 0;
    for (var k = 0; k < 26; k++) shared += Math.min(a[k], b[k]);
    var L = Math.max(w.length, src.length);
    return (pos + 0.5 * shared) / (1.5 * L);
  }

  var SAMPLE = 400;

  /** Pick one word for a slot. dial: 0 literal … 1 wild.
   *  Linear and bounded: scans the length bucket from a random offset and stops
   *  after SAMPLE fitting words, plus the source word and function words. */
  function pickWord(index, slot, pool, dial, rng, avoid) {
    var L = slot.len;
    var lens = [L];
    if (dial > 0.6) {
      if (L > 1) lens.push(L - 1);
      lens.push(L + 1);
    }
    var lit = 1 - dial;
    var srcLow = String(slot.src || "").toLowerCase();
    var srcCounts = countLetters(srcLow);
    var cands = [];
    var seen = {};
    function add(g, w) {
      if (seen[w]) return;
      seen[w] = true;
      cands.push({ w: w, g: g });
    }
    function addKey(w) {
      var g = index.byKey[sortKey(w)];
      if (g && g.words.indexOf(w) >= 0 && fits(g.counts, pool)) add(g, w);
    }
    function gather(len) {
      var groups = index.byLen[len] || [];
      var n = groups.length;
      if (!n) return;
      var start = Math.floor(rng() * n);
      var got = 0;
      for (var s = 0; s < n && got < SAMPLE; s++) {
        var g = groups[(start + s) % n];
        if (!fits(g.counts, pool)) continue;
        add(g, g.words[Math.floor(rng() * g.words.length)]);
        got++;
      }
    }
    if (srcLow) addKey(srcLow);
    if (L <= 4) FUNCTION_WORDS.forEach(function (w) { if (w.length === L) addKey(w); });
    lens.forEach(gather);
    if (!cands.length) {
      for (var d = L - 1; d >= 1 && !cands.length; d--) gather(d);
    }
    if (!cands.length) return null;
    var best = null, bestScore = -Infinity;
    for (var c = 0; c < cands.length; c++) {
      var w = cands[c].w;
      var score = 0;
      if (lit > 0) score += lit * 14 * simFast(w, cands[c].g.counts, srcLow, srcCounts);
      if (FUNC[w] && L <= 4) score += 2.2;
      if (w.length !== L) score -= 0.8;
      if (avoid && w === avoid) score -= 60;
      // Gumbel noise: sampling proportional to exp(score)
      var u = rng();
      score += -Math.log(-Math.log(u * 0.999998 + 0.000001));
      if (score > bestScore) { bestScore = score; best = cands[c]; }
    }
    return { word: best.w, counts: best.g.counts };
  }

  function simFast(w, wc, src, sc) {
    if (!src) return 0;
    var pos = 0, n = Math.min(w.length, src.length);
    for (var i = 0; i < n; i++) if (w.charCodeAt(i) === src.charCodeAt(i)) pos++;
    var shared = 0;
    for (var k = 0; k < 26; k++) shared += wc[k] < sc[k] ? wc[k] : sc[k];
    return (pos + 0.5 * shared) / (1.5 * Math.max(w.length, src.length));
  }

  function matchCase(word, src) {
    if (!word) return word;
    if (src && src === src.toUpperCase() && src.length > 1) return word.toUpperCase();
    if (src && /[A-Z]/.test(src.charAt(0))) return word.charAt(0).toUpperCase() + word.slice(1);
    return word;
  }

  /**
   * state.fill[i] = { word, counts, locked } or null (open "?").
   * opts: { dial, rng, only: slotIndex (cut one) }
   */
  function splice(strand, index, state, opts) {
    opts = opts || {};
    var dial = Math.max(0, Math.min(1, opts.dial == null ? 0.5 : opts.dial));
    var rng = opts.rng || Math.random;
    var fill = (state && state.fill) || [];
    var pool = strand.pool.slice();
    var n = strand.slots.length;
    var redo = [];
    for (var i = 0; i < n; i++) {
      var f = fill[i];
      var keep = f && (f.locked || (opts.only != null && opts.only !== i));
      if (keep && f.word) take(pool, f.counts, 1);
      if (!keep) redo.push(i);
    }
    for (var r = 0; r < redo.length; r++) {
      var idx = redo[r];
      var locked = fill[idx] && fill[idx].locked;
      var avoid = opts.only === idx && fill[idx] ? fill[idx].word : "";
      var p = pickWord(index, strand.slots[idx], pool, dial, rng, avoid);
      if (p) {
        take(pool, p.counts, 1);
        fill[idx] = { word: p.word, counts: p.counts, locked: !!locked };
      } else {
        fill[idx] = { word: "", counts: new Array(26).fill(0), locked: false };
      }
    }
    return { fill: fill, left: pool, total: sum(strand.pool), used: sum(strand.pool) - sum(pool) };
  }

  /** Assemble text: punctuation in place, gaps become spaces, open slots "?". */
  function render(strand, fill) {
    var out = "";
    strand.tokens.forEach(function (t) {
      if (t.type === "gap") out += " ";
      else if (t.type === "anchor") out += t.ch;
      else {
        var f = fill[t.slot];
        out += f && f.word ? matchCase(f.word, t.src) : "?";
      }
    });
    return out;
  }

  var api = {
    parseStrand: parseStrand,
    cleanWords: cleanWords,
    buildIndex: buildIndex,
    splice: splice,
    render: render,
    countLetters: countLetters,
    makeRng: makeRng,
    similarity: similarity,
    FUNCTION_WORDS: FUNCTION_WORDS,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.SpliceEngine = api;
})(typeof window !== "undefined" ? window : globalThis);
