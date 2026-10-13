/* Marbles — Chinese Checkers on a 121-hole star board. No external libraries. */
(function (root) {
  "use strict";
  var DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]];
  // Points clockwise from top. Opposite of i is (i+3)%6.
  var POINTS = [
    { name: "Red", fill: "#d8262c", board: "#c8323a", test: function (q, r, s) { return r < -4; } },
    { name: "Orange", fill: "#f08a1c", board: "#e9822a", test: function (q, r, s) { return q > 4; } },
    { name: "Blue", fill: "#2a62d6", board: "#2f5fbf", test: function (q, r, s) { return s < -4; } },
    { name: "Lavender", fill: "#b79be8", board: "#a98fd8", test: function (q, r, s) { return r > 4; } },
    { name: "Green", fill: "#2f9e44", board: "#2f8f45", test: function (q, r, s) { return q < -4; } },
    { name: "Yellow", fill: "#f2cf1d", board: "#e8c62a", test: function (q, r, s) { return s > 4; } }
  ];

  function key(q, r) { return q + "," + r; }

  // Build board: union of two big triangles = 121 holes.
  var CELLS = [], INDEX = {};
  for (var q = -8; q <= 8; q++) for (var r = -8; r <= 8; r++) {
    var s = -q - r;
    var a = q <= 4 && r <= 4 && s <= 4, b = q >= -4 && r >= -4 && s >= -4;
    if (a || b) {
      var zone = -1;
      for (var p = 0; p < 6; p++) if (POINTS[p].test(q, r, s)) zone = p;
      INDEX[key(q, r)] = CELLS.length;
      CELLS.push({ q: q, r: r, s: s, zone: zone });
    }
  }
  var N = CELLS.length;
  var NEIGH = CELLS.map(function (c) {
    return DIRS.map(function (d) {
      var i = INDEX[key(c.q + d[0], c.r + d[1])];
      return i === undefined ? -1 : i;
    });
  });
  var ZONE = [[], [], [], [], [], []];
  CELLS.forEach(function (c, i) { if (c.zone >= 0) ZONE[c.zone].push(i); });

  function hexDist(a, b) {
    var A = CELLS[a], B = CELLS[b];
    return Math.max(Math.abs(A.q - B.q), Math.abs(A.r - B.r), Math.abs(A.s - B.s));
  }
  var DIST = [];
  for (var i = 0; i < N; i++) { DIST.push([]); for (var j = 0; j < N; j++) DIST[i].push(hexDist(i, j)); }

  function seatsFor(count, color) {
    var offs = { 2: [0, 3], 3: [0, 2, 4], 4: [0, 1, 3, 4], 6: [0, 1, 2, 3, 4, 5] }[count];
    return offs.map(function (o) { return (color + o) % 6; });
  }

  function newBoard(seats) {
    var b = new Array(N).fill(-1);
    seats.forEach(function (p) { ZONE[p].forEach(function (i) { b[i] = p; }); });
    return b;
  }

  // A marble may only END a turn in its own home point or the one directly opposite;
  // other star points may be passed through during a jump chain but not stopped in.
  function canEndAt(p, i) {
    var z = CELLS[i].zone;
    return z < 0 || z === p || z === (p + 3) % 6;
  }
  function stepMoves(b, from) {
    var out = [], p = b[from];
    NEIGH[from].forEach(function (n) { if (n >= 0 && b[n] < 0 && canEndAt(p, n)) out.push(n); });
    return out;
  }
  // Single jumps from `from`, excluding cells in `visited`. Pieces jump over any one adjacent marble.
  function jumpMoves(b, from, visited) {
    var out = [], c = CELLS[from];
    DIRS.forEach(function (d, k) {
      var mid = NEIGH[from][k];
      if (mid < 0 || b[mid] < 0) return;
      var land = INDEX[key(c.q + 2 * d[0], c.r + 2 * d[1])];
      if (land === undefined || b[land] >= 0) return;
      if (visited && visited[land]) return;
      out.push(land);
    });
    return out;
  }
  // Can a chain that is sitting at `at` (cells in `visited` already used) still
  // reach a cell where player p may stop? `b` must not contain the moving marble.
  function chainCanEnd(b, at, visited, p) {
    var seen = {}; for (var v in visited) seen[v] = true; seen[at] = true;
    var queue = [at];
    while (queue.length) {
      var cur = queue.shift(), next = jumpMoves(b, cur, seen);
      for (var k = 0; k < next.length; k++) {
        if (canEndAt(p, next[k])) return true;
        seen[next[k]] = true; queue.push(next[k]);
      }
    }
    return false;
  }
  // Jumps the marble at `from` (owned by p) may take now: the landing cell must be a
  // legal stop, or the chain must be able to continue from it to a legal stop.
  function legalJumps(b, from, visited, p) {
    var owner = b[from];
    b[from] = -1;
    var out = jumpMoves(b, from, visited).filter(function (n) {
      if (canEndAt(p, n)) return true;
      var v = {}; for (var x in visited) v[x] = true; v[from] = true; v[n] = true;
      return chainCanEnd(b, n, v, p);
    });
    b[from] = owner;
    return out;
  }
  // All final destinations reachable this turn (steps + chained jumps). Map dest -> path.
  function allDestinations(b, from) {
    var res = {};
    stepMoves(b, from).forEach(function (n) { res[n] = [from, n]; });
    var owner = b[from];
    b[from] = -1; // the moving marble leaves its hole
    var visited = {}; visited[from] = true;
    var queue = [[from]];
    while (queue.length) {
      var path = queue.shift(), at = path[path.length - 1];
      jumpMoves(b, at, visited).forEach(function (n) {
        visited[n] = true;
        var np = path.concat([n]);
        if (!res[n] && canEndAt(owner, n)) res[n] = np; // pass through, but never stop in, other points
        queue.push(np);
      });
    }
    b[from] = owner;
    return res;
  }

  // Win: target triangle is full and holds at least one of the player's marbles
  // (standard anti-blocking rule; normally it is simply all ten of yours).
  function hasWon(b, p) {
    var t = ZONE[(p + 3) % 6], own = 0;
    for (var i = 0; i < t.length; i++) { if (b[t[i]] < 0) return false; if (b[t[i]] === p) own++; }
    return own > 0;
  }

  var TIP = POINTS.map(function (_, p) {
    // farthest cell of target triangle (tip)
    var t = ZONE[(p + 3) % 6], best = t[0];
    t.forEach(function (i) { if (DIST[i][INDEX["0,0"]] > DIST[best][INDEX["0,0"]]) best = i; });
    return best;
  });

  function aiMove(b, p) {
    var target = ZONE[(p + 3) % 6], tip = TIP[p];
    var inT = {}; target.forEach(function (i) { inT[i] = true; });
    var empties = target.filter(function (i) { return b[i] !== p; });
    function d(i) {
      if (inT[i]) return 0;
      var m = 99;
      for (var k = 0; k < empties.length; k++) if (DIST[i][empties[k]] < m) m = DIST[i][empties[k]];
      return m;
    }
    var best = null, bestScore = -1e9;
    for (var i = 0; i < N; i++) {
      if (b[i] !== p) continue;
      var dests = allDestinations(b, i);
      for (var k in dests) {
        var to = +k, sc = 0;
        var tipGain = DIST[i][tip] - DIST[to][tip];
        sc += (d(i) - d(to)) * 10 + tipGain * 3;
        if (inT[i] && !inT[to]) sc -= 40;          // don't leave the goal
        if (inT[i] && inT[to]) sc += tipGain > 0 ? 2 : -6; // shuffle deeper only
        sc += DIST[i][tip] * 0.4;                   // advance stragglers
        if (!inT[i] && d(i) <= 2 && inT[to]) sc += 8;
        sc += Math.random() * 0.5;
        if (sc > bestScore) { bestScore = sc; best = dests[k]; }
      }
    }
    return best; // path array or null
  }

  var Engine = {
    CELLS: CELLS, NEIGH: NEIGH, ZONE: ZONE, POINTS: POINTS, INDEX: INDEX, N: N,
    seatsFor: seatsFor, newBoard: newBoard, stepMoves: stepMoves, jumpMoves: jumpMoves,
    allDestinations: allDestinations, canEndAt: canEndAt, legalJumps: legalJumps, hasWon: hasWon, aiMove: aiMove
  };
  root.MarblesEngine = Engine;
  if (typeof module !== "undefined" && module.exports) module.exports = Engine;

  // ---------------- UI ----------------
  if (typeof document === "undefined") return;

  var SVGNS = "http://www.w3.org/2000/svg";
  var S = 21; // hex size
  function px(i) { var c = CELLS[i]; return [S * Math.sqrt(3) * (c.q + c.r / 2), S * 1.5 * c.r]; }
  function el(tag, attrs, parent) {
    var e = document.createElementNS(SVGNS, tag);
    for (var a in attrs) e.setAttribute(a, attrs[a]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function polyPts(ids, pad) {
    var pts = ids.map(px), cx = 0, cy = 0;
    pts.forEach(function (p) { cx += p[0]; cy += p[1]; }); cx /= pts.length; cy /= pts.length;
    return pts.map(function (p) {
      var dx = p[0] - cx, dy = p[1] - cy, L = Math.sqrt(dx * dx + dy * dy) || 1;
      return (p[0] + dx / L * pad).toFixed(1) + "," + (p[1] + dy / L * pad).toFixed(1);
    }).join(" ");
  }
  function cid(q, r) { return INDEX[key(q, r)]; }

  function init() {
    var panel = document.getElementById("panel-marbles");
    if (!panel || panel.dataset.mbInit) return;
    panel.dataset.mbInit = "1";
    var svg = panel.querySelector("#mb-board");
    var statusEl = panel.querySelector("#mb-status");
    var modeSel = panel.querySelector("#mb-mode"), countSel = panel.querySelector("#mb-count"), colorSel = panel.querySelector("#mb-color");
    var endBtn = panel.querySelector("#mb-end"), undoBtn = panel.querySelector("#mb-undo"), newBtn = panel.querySelector("#mb-new");

    // --- static board art ---
    var defs = el("defs", {}, svg);
    POINTS.forEach(function (pt, p) {
      var g = el("radialGradient", { id: "mb-g" + p, cx: "35%", cy: "30%", r: "70%" }, defs);
      el("stop", { offset: "0%", "stop-color": "#fff", "stop-opacity": "0.9" }, g);
      el("stop", { offset: "30%", "stop-color": pt.fill }, g);
      el("stop", { offset: "100%", "stop-color": shade(pt.fill) }, g);
    });
    el("circle", { cx: 0, cy: 0, r: 296, fill: "#b3121b" }, svg);
    el("circle", { cx: 0, cy: 0, r: 284, fill: "none", stroke: "#e8c14a", "stroke-width": 2 }, svg);
    el("circle", { cx: 0, cy: 0, r: 278, fill: "#0b0b0b" }, svg);
    // decorative lanterns & dragons in the gaps between star points
    var deco = el("g", { "class": "mb-deco" }, svg);
    for (var k = 0; k < 6; k++) {
      var ang = (k * 60) * Math.PI / 180, R = 222;
      var x = R * Math.sin(ang), y = -R * Math.cos(ang);
      if (k % 2 === 0) lantern(deco, x, y); else dragon(deco, x, y, k * 60);
    }
    // yellow star outline
    var tips = [cid(4, -8), cid(8, -4), cid(4, 4), cid(-4, 8), cid(-8, 4), cid(-4, -4)];
    var inner = [cid(4, -4), cid(4, 0), cid(0, 4), cid(-4, 4), cid(-4, 0), cid(0, -4)];
    var star = [];
    for (k = 0; k < 6; k++) { star.push(tips[k]); star.push(inner[(k + 1) % 6]); }
    var starPts = star.map(function (i, n) {
      var p = px(i), L = Math.sqrt(p[0] * p[0] + p[1] * p[1]), pad = n % 2 === 0 ? 30 : 12;
      return (p[0] * (L + pad) / L).toFixed(1) + "," + (p[1] * (L + pad) / L).toFixed(1);
    }).join(" ");
    el("polygon", { points: starPts, fill: "#141414", stroke: "#f2cf1d", "stroke-width": 4, "stroke-linejoin": "round" }, svg);
    // colored triangles
    POINTS.forEach(function (pt, p) {
      var z = ZONE[p], corners = triCorners(z);
      el("polygon", { points: polyPts(corners, 17), fill: pt.board, stroke: "#f2cf1d", "stroke-width": 1.5, "stroke-linejoin": "round" }, svg);
    });
    // cream hexagonal center
    el("polygon", { points: polyPts(inner, 17), fill: "#f4ecd6", stroke: "#f2cf1d", "stroke-width": 1.5, "stroke-linejoin": "round" }, svg);

    var holeLayer = el("g", {}, svg), hiLayer = el("g", {}, svg), marbleLayer = el("g", {}, svg), hitLayer = el("g", {}, svg);
    for (var i = 0; i < N; i++) {
      var p0 = px(i);
      el("circle", { cx: p0[0], cy: p0[1], r: 6.5, fill: "#1a1410", stroke: "#000", "stroke-width": 1 }, holeLayer);
      var hit = el("circle", { cx: p0[0], cy: p0[1], r: 17, fill: "transparent", "data-i": i, "class": "mb-hit" }, hitLayer);
      hit.addEventListener("click", onTap);
    }

    function triCorners(z) {
      // three cells with maximum distance from triangle's other cells = corners
      var best = [];
      z.forEach(function (i) {
        var cnt = 0; z.forEach(function (j) { if (DIST[i][j] === 1) cnt++; });
        if (cnt <= 2) best.push(i);
      });
      return best;
    }

    // --- game state ---
    var G = null, history = [], busy = false;

    function newGame() {
      var color = +colorSel.value, count = +countSel.value, mode = modeSel.value;
      var seats = seatsFor(count, color);
      G = {
        board: newBoard(seats), seats: seats, turn: 0, mode: mode,
        human: mode === "pass" ? seats.slice() : [color],
        sel: -1, jumping: false, visited: null, winner: -1, moves: 0
      };
      history = [];
      render();
      maybeAI();
    }
    function cur() { return G.seats[G.turn]; }
    function isHuman(p) { return G.human.indexOf(p) >= 0; }
    function snapshot() { return { board: G.board.slice(), turn: G.turn, winner: G.winner, moves: G.moves }; }

    function legalFor(i) {
      if (G.jumping) return legalJumps(G.board, i, G.visited, cur());
      return stepMoves(G.board, i).concat(jumpMovesFresh(i));
    }
    function jumpMovesFresh(i) { var v = {}; v[i] = true; return legalJumps(G.board, i, v, cur()); }
    function canStop() { return G.jumping && canEndAt(cur(), G.sel); }

    function onTap(e) {
      if (!G || busy || G.winner >= 0) return;
      var p = cur(); if (!isHuman(p)) return;
      var i = +e.currentTarget.getAttribute("data-i");
      if (G.jumping) {
        if (i === G.sel) { if (canStop()) endTurn(); return; }
        if (legalJumps(G.board, G.sel, G.visited, p).indexOf(i) >= 0) doJump(i);
        return;
      }
      if (G.board[i] === p) { G.sel = G.sel === i ? -1 : i; render(); return; }
      if (G.sel >= 0 && G.board[i] < 0) {
        var from = G.sel;
        if (stepMoves(G.board, from).indexOf(i) >= 0) {
          history.push(snapshot());
          G.board[i] = p; G.board[from] = -1; G.sel = -1;
          endTurn(); return;
        }
        if (jumpMovesFresh(from).indexOf(i) >= 0) {
          history.push(snapshot());
          G.visited = {}; G.visited[from] = true; G.jumping = true;
          doJump(i); return;
        }
      }
    }
    function doJump(i) {
      var p = cur();
      G.board[i] = p; G.board[G.sel] = -1; G.sel = i; G.visited[i] = true;
      if (legalJumps(G.board, i, G.visited, p).length === 0 && canEndAt(p, i)) { endTurn(); return; }
      render();
    }
    function endTurn() {
      var p = cur();
      G.sel = -1; G.jumping = false; G.visited = null; G.moves++;
      if (hasWon(G.board, p)) { G.winner = p; render(); return; }
      G.turn = (G.turn + 1) % G.seats.length;
      render();
      maybeAI();
    }
    function maybeAI() {
      if (!G || G.winner >= 0 || isHuman(cur())) return;
      busy = true;
      var game = G;
      setTimeout(function () {
        if (game !== G) return;
        busy = false;
        var p = cur(), path = aiMove(G.board, p);
        if (path) { G.board[path[path.length - 1]] = p; G.board[path[0]] = -1; G.lastPath = path; }
        endTurn();
      }, 450);
    }

    function undo() {
      if (!G || busy) return;
      if (G.jumping) { var s = history.pop(); restore(s); render(); return; }
      if (!history.length) return;
      restore(history.pop());
      render();
      maybeAI();
    }
    function restore(s) {
      G.board = s.board; G.turn = s.turn; G.winner = s.winner; G.moves = s.moves;
      G.sel = -1; G.jumping = false; G.visited = null; G.lastPath = null;
    }

    function render() {
      while (marbleLayer.firstChild) marbleLayer.removeChild(marbleLayer.firstChild);
      while (hiLayer.firstChild) hiLayer.removeChild(hiLayer.firstChild);
      if (G.lastPath && G.lastPath.length > 1) {
        el("polyline", { points: G.lastPath.map(function (i) { return px(i).join(","); }).join(" "), fill: "none", stroke: "rgba(255,255,255,.45)", "stroke-width": 2, "stroke-dasharray": "4 4" }, hiLayer);
      }
      for (var i = 0; i < N; i++) {
        if (G.board[i] < 0) continue;
        var p = px(i);
        el("circle", { cx: p[0], cy: p[1], r: 9.5, fill: "url(#mb-g" + G.board[i] + ")", stroke: "rgba(0,0,0,.55)", "stroke-width": 1 }, marbleLayer);
      }
      if (G.sel >= 0) {
        var sp = px(G.sel);
        el("circle", { cx: sp[0], cy: sp[1], r: 13, fill: "none", stroke: "#fff", "stroke-width": 2.5 }, hiLayer);
        legalFor(G.sel).forEach(function (d) {
          var dp = px(d);
          el("circle", { cx: dp[0], cy: dp[1], r: 8, fill: "rgba(255,255,255,.35)", stroke: "#fff", "stroke-width": 2 }, hiLayer);
        });
      }
      var p0 = cur(), pt = POINTS[p0];
      if (G.winner >= 0) {
        var w = POINTS[G.winner];
        statusEl.innerHTML = '<span class="mb-dot" style="background:' + w.fill + '"></span> ' +
          (isHuman(G.winner) ? (G.mode === "pass" ? w.name + " wins!" : "You win! 🎉") : w.name + " (computer) wins.") + " Tap New game to play again.";
        statusEl.className = "mb-status mb-win";
      } else {
        var who = isHuman(p0) ? (G.mode === "pass" ? pt.name + "'s turn" : "Your turn (" + pt.name + ")") : pt.name + " (computer) is thinking…";
        if (G.jumping) who += canStop() ? " — keep jumping, or tap End turn" : " — you can't stop in another player's point; keep jumping";
        statusEl.innerHTML = '<span class="mb-dot" style="background:' + pt.fill + '"></span> ' + who;
        statusEl.className = "mb-status";
      }
      endBtn.hidden = !G.jumping;
      endBtn.disabled = G.jumping && !canStop();
      undoBtn.disabled = !history.length;
    }

    endBtn.addEventListener("click", function () { if (G && G.jumping && canStop()) endTurn(); });
    undoBtn.addEventListener("click", undo);
    newBtn.addEventListener("click", newGame);
    [modeSel, countSel, colorSel].forEach(function (s) { s.addEventListener("change", newGame); });
    newGame();
  }

  function shade(hex) {
    var n = parseInt(hex.slice(1), 16);
    var r = (n >> 16) * 0.45 | 0, g = ((n >> 8) & 255) * 0.45 | 0, b = (n & 255) * 0.45 | 0;
    return "rgb(" + r + "," + g + "," + b + ")";
  }
  function lantern(g, x, y) {
    var t = el("g", { transform: "translate(" + x.toFixed(1) + "," + y.toFixed(1) + ")" }, g);
    el("line", { x1: 0, y1: -22, x2: 0, y2: -14, stroke: "#e8c14a", "stroke-width": 1.5 }, t);
    el("ellipse", { cx: 0, cy: 0, rx: 12, ry: 15, fill: "#d8262c", stroke: "#e8c14a", "stroke-width": 1.5 }, t);
    el("rect", { x: -7, y: -16, width: 14, height: 4, fill: "#e8c14a" }, t);
    el("rect", { x: -7, y: 12, width: 14, height: 4, fill: "#e8c14a" }, t);
    el("line", { x1: 0, y1: 16, x2: 0, y2: 26, stroke: "#e8c14a", "stroke-width": 1.5 }, t);
  }
  function dragon(g, x, y, rot) {
    var t = el("g", { transform: "translate(" + x.toFixed(1) + "," + y.toFixed(1) + ") rotate(" + (rot + 90) + ")" }, g);
    el("path", { d: "M-26,4 C-18,-10 -8,12 0,0 S16,-12 22,-2", fill: "none", stroke: "#2f9e44", "stroke-width": 5, "stroke-linecap": "round" }, t);
    el("path", { d: "M-26,4 C-18,-10 -8,12 0,0 S16,-12 22,-2", fill: "none", stroke: "#e8c14a", "stroke-width": 1.2, "stroke-dasharray": "2 3" }, t);
    el("circle", { cx: 24, cy: -3, r: 5, fill: "#2f9e44", stroke: "#e8c14a", "stroke-width": 1 }, t);
    el("circle", { cx: 25.5, cy: -4.5, r: 1.2, fill: "#d8262c" }, t);
    el("path", { d: "M27,-6 l6,-4 M27,-1 l6,3", stroke: "#d8262c", "stroke-width": 1.2 }, t);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})(typeof window !== "undefined" ? window : globalThis);
