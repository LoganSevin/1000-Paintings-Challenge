// node tests/splice-engine.test.js
"use strict";
var fs = require("fs");
var path = require("path");
var assert = require("assert");
var E = require("../js/splice-engine.js");

var dir = path.join(__dirname, "..", "data", "diction");
var raw = [];
fs.readdirSync(dir).filter(function (f) { return /^[a-z]\.txt$/.test(f); }).forEach(function (f) {
  Array.prototype.push.apply(raw, fs.readFileSync(path.join(dir, f), "utf8").split(/\r?\n/));
});
var words = E.cleanWords(raw);

var DESC =
  "A lone lighthouse keeper, wrapped in a salt-stained coat, climbs the spiral stairs at dusk; " +
  "below, the sea folds over black rocks, and gulls circle the lamp. In the window, a small brass " +
  "compass glints: north, always north. He hums an old song, waiting for the first ship of winter!";
assert(DESC.length >= 200, "description is 200+ chars");

function punctSkeleton(s) { return s.replace(/[A-Za-z?]+/g, "W"); }
var results = [];
function check(name, fn) {
  try { fn(); results.push("PASS " + name); } catch (e) { results.push("FAIL " + name + ": " + e.message); process.exitCode = 1; }
}

var strand = E.parseStrand(DESC);
var t0 = Date.now();
var index = E.buildIndex(words, strand.pool);
var buildMs = Date.now() - t0;

check("punctuation positions preserved (structure + exact char positions when lengths match)", function () {
  [0, 0.5, 1].forEach(function (d) {
    var r = E.splice(strand, index, { fill: [] }, { dial: d, rng: E.makeRng(7) });
    var out = E.render(strand, r.fill);
    assert.strictEqual(punctSkeleton(out), punctSkeleton(DESC), "skeleton at dial " + d);
    if (d < 0.6) {
      var exact = r.fill.every(function (f, i) { return f.word && f.word.length === strand.slots[i].len; });
      if (exact) {
        assert.strictEqual(out.length, DESC.length);
        for (var i = 0; i < DESC.length; i++) if (!/[A-Za-z]/.test(DESC[i])) assert.strictEqual(out[i], DESC[i], "char " + i);
      }
    }
  });
});

check("? slots (gaps) map to single spaces", function () {
  var gaps = strand.tokens.filter(function (t) { return t.type === "gap"; }).length;
  var r = E.splice(strand, index, { fill: [] }, { dial: 0.5, rng: E.makeRng(3) });
  var out = E.render(strand, r.fill);
  assert.strictEqual((out.match(/ /g) || []).length, gaps);
  assert.strictEqual(gaps, (DESC.match(/\s+/g) || []).length);
});

check("letters used never exceed the pool (multiset)", function () {
  for (var s = 1; s <= 30; s++) {
    var r = E.splice(strand, index, { fill: [] }, { dial: s / 30, rng: E.makeRng(s) });
    var used = E.countLetters(r.fill.map(function (f) { return f.word; }).join(""));
    for (var k = 0; k < 26; k++) assert(used[k] <= strand.pool[k], "letter " + String.fromCharCode(97 + k) + " seed " + s);
    // cut one and lock one too
    r.fill[2].locked = true;
    var r2 = E.splice(strand, index, r, { dial: 1, rng: E.makeRng(s + 99), only: 5 });
    var used2 = E.countLetters(r2.fill.map(function (f) { return f.word; }).join(""));
    for (var k2 = 0; k2 < 26; k2++) assert(used2[k2] <= strand.pool[k2]);
  }
});

check("guide lock survives a full splice; cut changes only its slot", function () {
  var r = E.splice(strand, index, { fill: [] }, { dial: 0.8, rng: E.makeRng(11) });
  r.fill[4].locked = true;
  var keep = r.fill[4].word;
  var before = r.fill.map(function (f) { return f.word; });
  var cut = E.splice(strand, index, { fill: r.fill.map(function (f) { return Object.assign({}, f); }) }, { dial: 1, rng: E.makeRng(12), only: 9 });
  cut.fill.forEach(function (f, i) { if (i !== 9) assert.strictEqual(f.word, before[i]); });
  assert.notStrictEqual(cut.fill[9].word, before[9], "cut re-rolls to a different word");
  var all = E.splice(strand, index, cut, { dial: 1, rng: E.makeRng(13) });
  assert.strictEqual(all.fill[4].word, keep);
});

var times = [];
check("200+ char description splices under 200 ms", function () {
  for (var s = 0; s < 20; s++) {
    var a = Date.now();
    E.splice(strand, index, { fill: [] }, { dial: s / 19, rng: E.makeRng(s + 1) });
    times.push(Date.now() - a);
  }
  assert(Math.max.apply(null, times) < 200, "max " + Math.max.apply(null, times));
});

check("dial changes the output (literal stays close, wild drifts)", function () {
  function avgSim(d) {
    var tot = 0, n = 0;
    for (var s = 1; s <= 8; s++) {
      var r = E.splice(strand, index, { fill: [] }, { dial: d, rng: E.makeRng(s) });
      r.fill.forEach(function (f, i) { if (f.word) { tot += E.similarity(f.word, strand.slots[i].src); n++; } });
    }
    return tot / n;
  }
  var lit = avgSim(0), wild = avgSim(1);
  var o1 = E.render(strand, E.splice(strand, index, { fill: [] }, { dial: 0, rng: E.makeRng(5) }).fill);
  var o2 = E.render(strand, E.splice(strand, index, { fill: [] }, { dial: 1, rng: E.makeRng(5) }).fill);
  assert.notStrictEqual(o1, o2);
  assert(lit > wild + 0.2, "literal sim " + lit.toFixed(2) + " vs wild " + wild.toFixed(2));
  console.log("  literal: " + o1.slice(0, 120) + "…");
  console.log("  wild:    " + o2.slice(0, 120) + "…");
  console.log("  avg similarity literal " + lit.toFixed(2) + " / wild " + wild.toFixed(2));
});

check("long strand (1000+ chars) stays linear", function () {
  var big = new Array(6).join(DESC + " ");
  var st = E.parseStrand(big);
  var ix = E.buildIndex(words, st.pool);
  var a = Date.now();
  var r = E.splice(st, ix, { fill: [] }, { dial: 0.5, rng: E.makeRng(1) });
  var ms = Date.now() - a;
  assert(ms < 400, ms + " ms");
  assert.strictEqual(punctSkeleton(E.render(st, r.fill)), punctSkeleton(big.trim()));
});

console.log(results.join("\n"));
console.log("words: " + words.length + ", index build " + buildMs + " ms, splice ms max " + Math.max.apply(null, times) + " avg " + (times.reduce(function (a, b) { return a + b; }, 0) / times.length).toFixed(1));
