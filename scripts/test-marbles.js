// Node tests for js/marbles.js engine.  Run: node scripts/test-marbles.js
"use strict";
var E = require("../js/marbles.js"), assert = require("assert");
var C = E.CELLS, I = E.INDEX, ZONE = E.ZONE;
function cell(q, r) { var i = I[q + "," + r]; assert(i !== undefined, "cell " + q + "," + r); return i; }
function empty() { return new Array(E.N).fill(-1); }
var pass = 0;
function t(name, fn) { fn(); pass++; console.log("ok  " + name); }

// Red=0 (home r<-4), target Lavender=3. Orange=1 (q>4) is a neutral point for Red.
t("canEndAt: own home, opposite, center allowed; neutral points not", function () {
  assert(E.canEndAt(0, ZONE[0][0]) && E.canEndAt(0, ZONE[3][0]) && E.canEndAt(0, cell(0, 0)));
  [1, 2, 4, 5].forEach(function (z) { ZONE[z].forEach(function (i) { assert(!E.canEndAt(0, i)); }); });
});
t("step into a neutral base is rejected", function () {
  var b = empty(), from = cell(4, -4); b[from] = 0;           // center edge cell next to Orange point
  var into = cell(5, -4); assert.strictEqual(C[into].zone, 1);
  assert(E.stepMoves(b, from).indexOf(into) < 0);
  assert(!E.allDestinations(b, from)[into]);
  b[from] = 1; assert(E.stepMoves(b, from).indexOf(into) >= 0, "Orange may step home");
});
t("step into own home and opposite base allowed", function () {
  var b = empty(), a = cell(1, -4); b[a] = 0;
  assert(E.stepMoves(b, a).indexOf(cell(1, -5)) >= 0);
  var c = cell(-1, 4); b[c] = 0; assert(E.stepMoves(b, c).indexOf(cell(-1, 5)) >= 0);
});
// chain: (4,-4) -> jump over (5,-4) -> lands (6,-4) [Orange] -> jump over (6,-3) -> lands (6,-2)? check zone
t("chain passing through a neutral base is allowed", function () {
  var b = empty(), from = cell(3, -3); b[from] = 0;
  b[cell(4, -3)] = 2;                       // jump (3,-3)->(5,-3): Orange point (q>4)
  var mid = cell(5, -3); assert.strictEqual(C[mid].zone, 1);
  b[cell(4, -2)] = 2;                       // jump (5,-3)->(3,-1): center
  var end = cell(3, -1); assert.strictEqual(C[end].zone, -1);
  var d = E.allDestinations(b, from);
  assert(!d[mid], "cannot end in Orange point");
  assert(d[end], "may finish chain through Orange point");
  assert.deepStrictEqual(d[end], [from, mid, end]);
  var v = {}; v[from] = true;
  assert(E.legalJumps(b, from, v, 0).indexOf(mid) >= 0, "UI may jump into Orange when chain continues");
  // UI state after landing in mid: continuing jump available, stopping not
  b[from] = -1; b[mid] = 0; v[mid] = true;
  assert(!E.canEndAt(0, mid));
  assert.deepStrictEqual(E.legalJumps(b, mid, v, 0), [end]);
});
t("chain ending in a neutral base is rejected", function () {
  var b = empty(), from = cell(3, -3); b[from] = 0; b[cell(4, -3)] = 2;
  var mid = cell(5, -3);
  var d = E.allDestinations(b, from); assert(!d[mid]);
  var v = {}; v[from] = true;
  assert(E.legalJumps(b, from, v, 0).indexOf(mid) < 0, "dead-end jump into neutral point not offered");
  b[from] = 1; assert(E.allDestinations(b, from)[mid], "Orange may end there");
});
t("allDestinations never ends in forbidden bases (random boards)", function () {
  for (var g = 0; g < 300; g++) {
    var b = empty();
    for (var i = 0; i < E.N; i++) if (Math.random() < 0.35) b[i] = (Math.random() * 6) | 0;
    for (i = 0; i < E.N; i++) if (b[i] >= 0) {
      var d = E.allDestinations(b, i);
      for (var k in d) { assert(E.canEndAt(b[i], +k)); assert.strictEqual(b[+k], -1); }
    }
  }
});
[2, 3, 4, 6].forEach(function (n) {
  t("computer-vs-computer " + n + " players finishes", function () {
    for (var color = 0; color < 6; color += (n === 6 ? 6 : 2)) for (var rep = 0; rep < 3; rep++) {
      var seats = E.seatsFor(n, color), b = E.newBoard(seats), turn = 0, moves = 0, winner = -1;
      while (moves < 4000) {
        var p = seats[turn], path = E.aiMove(b, p);
        if (path) {
          var to = path[path.length - 1];
          assert(E.canEndAt(p, to), "AI ended in forbidden base");
          assert.strictEqual(b[to], -1); assert.strictEqual(b[path[0]], p);
          b[to] = p; b[path[0]] = -1;
        }
        moves++;
        if (E.hasWon(b, p)) { winner = p; break; }
        turn = (turn + 1) % seats.length;
      }
      assert(winner >= 0, n + "p color " + color + " stuck after " + moves + " moves");
      for (var i = 0; i < E.N; i++) if (b[i] >= 0) assert(E.canEndAt(b[i], i));
    }
  });
});
console.log(pass + " tests passed");
