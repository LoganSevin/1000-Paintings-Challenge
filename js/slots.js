/**
 * Slots — 5×3 painting reels with wilds, scatters, free spins & bonus.
 * Play credits only. No real money.
 */
(function () {
  "use strict";

  var CREDITS_KEY = "slotsPlayCredits.v2";
  var SOUND_KEY = "slotsSoundOn.v1";
  var BET_KEY = "slotsBet.v1";
  var START_CREDITS = 100;
  var COLS = 5;
  var ROWS = 3;
  var LINE_COUNT = 20;

  // 20 classic left-to-right paylines (row index per reel: 0=top, 1=mid, 2=bot)
  var PAYLINES = [
    [1, 1, 1, 1, 1],
    [0, 0, 0, 0, 0],
    [2, 2, 2, 2, 2],
    [0, 1, 2, 1, 0],
    [2, 1, 0, 1, 2],
    [0, 0, 1, 2, 2],
    [2, 2, 1, 0, 0],
    [1, 0, 0, 0, 1],
    [1, 2, 2, 2, 1],
    [0, 1, 1, 1, 0],
    [2, 1, 1, 1, 2],
    [0, 1, 0, 1, 0],
    [2, 1, 2, 1, 2],
    [1, 0, 1, 0, 1],
    [1, 2, 1, 2, 1],
    [0, 0, 1, 0, 0],
    [2, 2, 1, 2, 2],
    [1, 1, 0, 1, 1],
    [1, 1, 2, 1, 1],
    [0, 2, 0, 2, 0],
  ];

  // Regular painting symbols: pays = [3oak, 4oak, 5oak] × line bet
  var PAINTING_PICKS = [
    { number: 1, weight: 4, pays: [29, 116, 290] },
    { number: 7, weight: 5, pays: [23, 91, 222] },
    { number: 42, weight: 6, pays: [20, 72, 182] },
    { number: 100, weight: 8, pays: [17, 59, 130] },
    { number: 250, weight: 10, pays: [14, 46, 106] },
    { number: 500, weight: 12, pays: [12, 36, 84] },
    { number: 777, weight: 14, pays: [9, 27, 59] },
    { number: 999, weight: 16, pays: [7, 21, 46] },
  ];

  var WILD = {
    id: "wild",
    label: "Wild",
    kind: "wild",
    weight: 3.8,
    pays: [36, 145, 360],
  };
  var SCATTER = {
    id: "scatter",
    label: "Scatter",
    kind: "scatter",
    weight: 2.4,
    // pays × total bet for 3/4/5 anywhere
    scatterPay: [0, 0, 0, 2, 8, 40],
    freeSpins: [0, 0, 0, 10, 15, 20],
  };
  var BONUS = {
    id: "bonus",
    label: "Bonus",
    kind: "bonus",
    weight: 5.5,
  };

  var FALLBACK_REG = [
    { id: "star", label: "Star", emoji: "★", weight: 4, pays: [29, 116, 290] },
    { id: "moon", label: "Moon", emoji: "☾", weight: 5, pays: [23, 91, 222] },
    { id: "sun", label: "Sun", emoji: "☀", weight: 6, pays: [20, 72, 182] },
    { id: "gem", label: "Gem", emoji: "◆", weight: 8, pays: [17, 59, 130] },
    { id: "leaf", label: "Leaf", emoji: "❧", weight: 10, pays: [14, 46, 106] },
    { id: "ring", label: "Ring", emoji: "◎", weight: 12, pays: [12, 36, 84] },
    { id: "bolt", label: "Bolt", emoji: "⚡", weight: 14, pays: [9, 27, 59] },
    { id: "heart", label: "Heart", emoji: "♥", weight: 16, pays: [7, 21, 46] },
  ];

  var BONUS_CARDS = [
    { type: "credits", mult: 5 },
    { type: "credits", mult: 5 },
    { type: "credits", mult: 8 },
    { type: "credits", mult: 8 },
    { type: "credits", mult: 10 },
    { type: "credits", mult: 10 },
    { type: "credits", mult: 15 },
    { type: "credits", mult: 20 },
    { type: "credits", mult: 25 },
    { type: "credits", mult: 30 },
    { type: "credits", mult: 50 },
    { type: "freespins", amount: 3 },
  ];

  var state = {
    credits: START_CREDITS,
    bet: 1,
    spinning: false,
    sound: false,
    symbols: null, // regular + specials map by id
    regular: [],
    grid: null, // [col][row] = symbol id
    started: false,
    freeSpins: 0,
    freeBet: 0,
    freeMult: 2,
    freeTotalWin: 0,
    inFree: false,
    autoLeft: 0,
    bonusOpen: false,
  };

  var el = {};
  var strips = [];
  var audioCtx = null;
  var autoTimer = 0;

  function $(id) {
    return document.getElementById(id);
  }

  function store(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch (e) {}
  }
  function recall(k) {
    try {
      return localStorage.getItem(k);
    } catch (e) {
      return null;
    }
  }
  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function lineBet() {
    return state.bet / LINE_COUNT;
  }

  function loadCredits() {
    var n = parseInt(recall(CREDITS_KEY), 10);
    if (!isFinite(n) || n < 0) n = START_CREDITS;
    state.credits = n;
  }
  function saveCredits() {
    store(CREDITS_KEY, String(Math.floor(state.credits)));
  }
  function loadPrefs() {
    state.sound = recall(SOUND_KEY) === "1";
    var b = parseInt(recall(BET_KEY), 10);
    if (b === 1 || b === 5 || b === 10) state.bet = b;
  }

  function beep(freq, dur, type) {
    if (!state.sound) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      var o = audioCtx.createOscillator();
      var g = audioCtx.createGain();
      o.type = type || "square";
      o.frequency.value = freq;
      g.gain.value = 0.035;
      o.connect(g);
      g.connect(audioCtx.destination);
      o.start();
      g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
      o.stop(audioCtx.currentTime + dur);
    } catch (e) {}
  }

  function buildSymbolTable(regular) {
    var map = {};
    regular.forEach(function (s) {
      map[s.id] = s;
    });
    map.wild = Object.assign({}, WILD);
    map.scatter = Object.assign({}, SCATTER);
    map.bonus = Object.assign({}, BONUS);
    return { regular: regular, map: map };
  }

  function loadSymbols() {
    return fetch("data/manifest.json", { cache: "default" })
      .then(function (r) {
        if (!r.ok) throw new Error("manifest");
        return r.json();
      })
      .then(function (man) {
        var byNum = {};
        (Array.isArray(man) ? man : []).forEach(function (row) {
          byNum[row.number] = row;
        });
        return fetch("data/analyses.json", { cache: "default" })
          .then(function (r) {
            return r.ok ? r.json() : {};
          })
          .catch(function () {
            return {};
          })
          .then(function (analyses) {
            var out = PAINTING_PICKS.map(function (pick) {
              var row = byNum[pick.number];
              var name = (row && row.filename) || pick.number + ".jpg";
              var a = (analyses && analyses[String(pick.number)]) || {};
              return {
                id: "p" + pick.number,
                label: a.title || "#" + pick.number,
                weight: pick.weight,
                pays: pick.pays.slice(),
                url: "paintings/" + name,
                number: pick.number,
                kind: "regular",
              };
            });
            if (out.length < 4) throw new Error("few");
            return buildSymbolTable(out);
          });
      })
      .catch(function () {
        return buildSymbolTable(
          FALLBACK_REG.map(function (s) {
            return {
              id: s.id,
              label: s.label,
              weight: s.weight,
              pays: s.pays.slice(),
              emoji: s.emoji,
              kind: "regular",
            };
          })
        );
      });
  }

  /** Weighted pick for one cell. col is 0..4 */
  function pickSymbolId(col) {
    var pool = [];
    state.regular.forEach(function (s) {
      pool.push({ id: s.id, w: s.weight });
    });
    if (col > 0) pool.push({ id: "wild", w: WILD.weight });
    pool.push({ id: "scatter", w: SCATTER.weight });
    if (col === 0 || col === 2 || col === 4) pool.push({ id: "bonus", w: BONUS.weight });
    var total = 0;
    for (var i = 0; i < pool.length; i++) total += pool[i].w;
    var r = Math.random() * total;
    for (var j = 0; j < pool.length; j++) {
      r -= pool[j].w;
      if (r <= 0) return pool[j].id;
    }
    return pool[pool.length - 1].id;
  }

  function spinGrid() {
    var grid = [];
    for (var c = 0; c < COLS; c++) {
      grid[c] = [];
      for (var r = 0; r < ROWS; r++) grid[c][r] = pickSymbolId(c);
    }
    return grid;
  }

  function evalLine(grid, line, lb) {
    var ids = [];
    for (var c = 0; c < COLS; c++) ids.push(grid[c][line[c]]);
    var first = ids[0];
    if (first === "scatter" || first === "bonus") return null;
    var target = first === "wild" ? null : first;
    var count = 0;
    var cells = [];
    for (var i = 0; i < COLS; i++) {
      var id = ids[i];
      if (id === "scatter" || id === "bonus") break;
      if (id === "wild") {
        count++;
        cells.push({ c: i, r: line[i] });
        continue;
      }
      if (target == null) {
        target = id;
        count++;
        cells.push({ c: i, r: line[i] });
        continue;
      }
      if (id === target) {
        count++;
        cells.push({ c: i, r: line[i] });
        continue;
      }
      break;
    }
    if (!target || count < 3) {
      var wildOnly = true;
      var wc = 0;
      var wcells = [];
      for (var w = 0; w < COLS; w++) {
        if (ids[w] !== "wild") {
          wildOnly = false;
          break;
        }
        wc++;
        wcells.push({ c: w, r: line[w] });
      }
      if (wildOnly && wc >= 3) {
        var wp = WILD.pays[wc - 3];
        return {
          symbol: "wild",
          count: wc,
          mult: wp,
          win: wp * lb,
          cells: wcells,
        };
      }
      return null;
    }
    var pays = (state.symbols[target] && state.symbols[target].pays) || [0, 0, 0];
    var mult = pays[count - 3] || 0;
    if (mult <= 0) return null;
    return {
      symbol: target,
      count: count,
      mult: mult,
      win: mult * lb,
      cells: cells,
    };
  }

  function countSpecial(grid, kind) {
    var n = 0;
    var cells = [];
    for (var c = 0; c < COLS; c++) {
      for (var r = 0; r < ROWS; r++) {
        if (grid[c][r] === kind) {
          n++;
          cells.push({ c: c, r: r });
        }
      }
    }
    return { n: n, cells: cells };
  }

  function bonusTriggered(grid) {
    // Need at least one bonus on reels 1, 3, 5 (cols 0,2,4)
    function has(col) {
      for (var r = 0; r < ROWS; r++) if (grid[col][r] === "bonus") return true;
      return false;
    }
    return has(0) && has(2) && has(4);
  }

  function evaluate(grid, bet, freeMult) {
    freeMult = freeMult || 1;
    var lb = bet / LINE_COUNT;
    var lineWins = [];
    var total = 0;
    for (var i = 0; i < PAYLINES.length; i++) {
      var res = evalLine(grid, PAYLINES[i], lb);
      if (res) {
        res.line = i + 1;
        res.win = res.win * freeMult;
        total += res.win;
        lineWins.push(res);
      }
    }
    var sc = countSpecial(grid, "scatter");
    var scatterWin = 0;
    var freeAward = 0;
    if (sc.n >= 3) {
      scatterWin = (SCATTER.scatterPay[Math.min(sc.n, 5)] || 0) * bet * freeMult;
      freeAward = SCATTER.freeSpins[Math.min(sc.n, 5)] || 0;
      total += scatterWin;
    }
    var bonus = bonusTriggered(grid);
    return {
      lineWins: lineWins,
      scatter: sc,
      scatterWin: scatterWin,
      freeAward: freeAward,
      bonus: bonus,
      total: total,
    };
  }

  // Expose math for RTP harness
  window.SlotsMath = {
    PAYLINES: PAYLINES,
    LINE_COUNT: LINE_COUNT,
    WILD: WILD,
    SCATTER: SCATTER,
    BONUS: BONUS,
    PAINTING_PICKS: PAINTING_PICKS,
    BONUS_CARDS: BONUS_CARDS,
    pickSymbolId: function (col, regular) {
      var saved = state.regular;
      state.regular = regular;
      var id = pickSymbolId(col);
      state.regular = saved;
      return id;
    },
    spinGrid: function (regular) {
      var saved = state.regular;
      state.regular = regular;
      state.symbols = buildSymbolTable(regular).map;
      var g = spinGrid();
      state.regular = saved;
      return g;
    },
    evaluate: function (grid, bet, freeMult, regular) {
      var savedR = state.regular;
      var savedS = state.symbols;
      state.regular = regular;
      state.symbols = buildSymbolTable(regular).map;
      // monkey lineBet via temporary bet
      var savedBet = state.bet;
      state.bet = bet;
      var ev = evaluate(grid, bet, freeMult);
      state.bet = savedBet;
      state.regular = savedR;
      state.symbols = savedS;
      return ev;
    },
    buildFallbackRegular: function () {
      return FALLBACK_REG.map(function (s) {
        return {
          id: s.id,
          label: s.label,
          weight: s.weight,
          pays: s.pays.slice(),
          emoji: s.emoji,
          kind: "regular",
        };
      });
    },
  };

  function cellH() {
    var reel = el.reels && el.reels.querySelector(".sl-reel");
    if (!reel) return 72;
    return Math.max(48, Math.floor(reel.clientHeight / ROWS));
  }

  function symHtml(sym, compact) {
    if (!sym) return '<span class="sl-sym-fallback">?</span>';
    var cls = "sl-tile";
    if (sym.kind === "wild") cls += " sl-tile-wild";
    if (sym.kind === "scatter") cls += " sl-tile-scatter";
    if (sym.kind === "bonus") cls += " sl-tile-bonus";
    var inner;
    if (sym.kind === "wild") {
      inner = '<span class="sl-special-mark">W</span><span class="sl-special-sub">WILD</span>';
    } else if (sym.kind === "scatter") {
      inner = '<span class="sl-special-mark">✦</span><span class="sl-special-sub">SCATTER</span>';
    } else if (sym.kind === "bonus") {
      inner = '<span class="sl-special-mark">★</span><span class="sl-special-sub">BONUS</span>';
    } else if (sym.url) {
      inner =
        '<img src="' +
        esc(sym.url) +
        '" alt="' +
        esc(sym.label) +
        '" loading="lazy" decoding="async" />';
    } else {
      inner =
        '<span class="sl-sym-fallback">' + esc(sym.emoji || "?") + "</span>";
    }
    return '<div class="' + cls + '">' + inner + "</div>";
  }

  function buildStrip(reelEl, loops) {
    var ids = [];
    state.regular.forEach(function (s) {
      ids.push(s.id);
    });
    ids.push("wild", "scatter", "bonus");
    var h = cellH();
    var n = ids.length * (loops || 6);
    var html = "";
    for (var i = 0; i < n; i++) {
      var sid = ids[i % ids.length];
      html +=
        '<div class="sl-sym" style="height:' +
        h +
        'px">' +
        symHtml(state.symbols[sid]) +
        "</div>";
    }
    var strip = document.createElement("div");
    strip.className = "sl-strip";
    strip.innerHTML = html;
    reelEl.innerHTML = "";
    reelEl.appendChild(strip);
    return strip;
  }

  function renderStaticGrid(grid) {
    if (!el.reels) return;
    var h = cellH();
    el.reels.innerHTML = "";
    strips = [];
    for (var c = 0; c < COLS; c++) {
      var reel = document.createElement("div");
      reel.className = "sl-reel";
      reel.style.height = 3 * h + "px";
      var strip = document.createElement("div");
      strip.className = "sl-strip sl-strip-static";
      var html = "";
      for (var r = 0; r < ROWS; r++) {
        var sid = grid[c][r];
        html +=
          '<div class="sl-sym" data-c="' +
          c +
          '" data-r="' +
          r +
          '" style="height:' +
          h +
          'px">' +
          symHtml(state.symbols[sid]) +
          "</div>";
      }
      strip.innerHTML = html;
      reel.appendChild(strip);
      el.reels.appendChild(reel);
      strips.push(strip);
    }
    if (el.linesSvg) {
      el.linesSvg.setAttribute("viewBox", "0 0 100 100");
      el.linesSvg.innerHTML = "";
    }
  }

  function highlightWins(lineWins, scatterCells) {
    document.querySelectorAll(".sl-sym.is-win").forEach(function (n) {
      n.classList.remove("is-win");
    });
    var marked = {};
    function mark(c, r) {
      var key = c + "," + r;
      if (marked[key]) return;
      marked[key] = true;
      var node = el.reels.querySelector('.sl-sym[data-c="' + c + '"][data-r="' + r + '"]');
      if (node) node.classList.add("is-win");
    }
    (lineWins || []).forEach(function (lw) {
      (lw.cells || []).forEach(function (p) {
        mark(p.c, p.r);
      });
    });
    (scatterCells || []).forEach(function (p) {
      mark(p.c, p.r);
    });
    // SVG lines
    if (!el.linesSvg) return;
    el.linesSvg.innerHTML = "";
    var colors = ["#f0d78a", "#9dffb8", "#7ec8ff", "#ffb0e0", "#ffe08a"];
    (lineWins || []).slice(0, 8).forEach(function (lw, i) {
      var line = PAYLINES[lw.line - 1];
      if (!line) return;
      var pts = [];
      for (var c = 0; c < COLS; c++) {
        var x = ((c + 0.5) / COLS) * 100;
        var y = ((line[c] + 0.5) / ROWS) * 100;
        pts.push(x.toFixed(1) + "," + y.toFixed(1));
      }
      var poly = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
      poly.setAttribute("points", pts.join(" "));
      poly.setAttribute("fill", "none");
      poly.setAttribute("stroke", colors[i % colors.length]);
      poly.setAttribute("stroke-width", "1.6");
      poly.setAttribute("stroke-linecap", "round");
      poly.setAttribute("stroke-linejoin", "round");
      poly.setAttribute("opacity", "0.85");
      el.linesSvg.appendChild(poly);
    });
  }

  function renderPaytable() {
    if (!el.payRows) return;
    var html = "";
    html +=
      '<details class="sl-details" open><summary>Line pays (× line bet · 20 lines)</summary><div class="sl-pay-rows">';
    state.regular
      .slice()
      .sort(function (a, b) {
        return b.pays[2] - a.pays[2];
      })
      .forEach(function (s) {
        html +=
          '<div class="sl-pay-row"><span>' +
          esc(s.label) +
          "</span><strong>3×" +
          s.pays[0] +
          " · 4×" +
          s.pays[1] +
          " · 5×" +
          s.pays[2] +
          "</strong></div>";
      });
    html +=
      '<div class="sl-pay-row"><span>Wild</span><strong>3×' +
      WILD.pays[0] +
      " · 4×" +
      WILD.pays[1] +
      " · 5×" +
      WILD.pays[2] +
      "</strong></div>";
    html += "</div></details>";
    html +=
      '<details class="sl-details"><summary>Wild · Scatter · Bonus · Free spins</summary><div class="sl-pay-rows">';
    html +=
      "<div class=\"sl-pay-row\"><span>Wild</span><strong>Substitutes any regular · not on reel 1</strong></div>";
    html +=
      "<div class=\"sl-pay-row\"><span>Scatter 3 / 4 / 5</span><strong>×2 / ×8 / ×40 total bet + 10 / 15 / 20 free spins</strong></div>";
    html +=
      "<div class=\"sl-pay-row\"><span>Free spins</span><strong>2× wins · same bet · can retrigger</strong></div>";
    html +=
      "<div class=\"sl-pay-row\"><span>Bonus</span><strong>Bonus on reels 1+3+5 → pick 3 of 12 cards</strong></div>";
    html +=
      "<div class=\"sl-pay-row\"><span>Paylines</span><strong>20 fixed · left to right · bet split across lines</strong></div>";
    html += "</div></details>";
    el.payRows.innerHTML = html;

    if (el.symLegend) {
      var legend = state.regular
        .map(function (s) {
          return (
            "<figure>" +
            symHtml(s, true) +
            "<figcaption>" +
            esc(s.label.length > 10 ? s.label.slice(0, 9) + "…" : s.label) +
            "</figcaption></figure>"
          );
        })
        .join("");
      legend +=
        "<figure>" +
        symHtml(state.symbols.wild, true) +
        "<figcaption>Wild</figcaption></figure>";
      legend +=
        "<figure>" +
        symHtml(state.symbols.scatter, true) +
        "<figcaption>Scatter</figcaption></figure>";
      legend +=
        "<figure>" +
        symHtml(state.symbols.bonus, true) +
        "<figcaption>Bonus</figcaption></figure>";
      el.symLegend.innerHTML = legend;
    }
  }

  function paintHud() {
    if (el.credits) el.credits.textContent = String(Math.floor(state.credits));
    if (el.refill) el.refill.hidden = state.credits > 0 || state.inFree;
    if (el.spin) {
      el.spin.disabled = state.spinning || state.bonusOpen || (!state.inFree && state.credits < state.bet);
      el.spin.textContent = state.inFree ? "Free spin" : "Spin";
    }
    document.querySelectorAll(".sl-bet").forEach(function (btn) {
      var v = parseInt(btn.getAttribute("data-bet"), 10);
      btn.classList.toggle("active", v === state.bet);
      btn.disabled = state.spinning || state.inFree || state.bonusOpen;
    });
    if (el.sound) el.sound.classList.toggle("active", state.sound);
    if (el.fsBanner) {
      el.fsBanner.hidden = !state.inFree;
      if (el.fsCount) el.fsCount.textContent = String(state.freeSpins);
    }
    if (el.auto) el.auto.disabled = state.spinning || state.bonusOpen;
  }

  function setMsg(text, kind) {
    if (!el.msg) return;
    el.msg.textContent = text || "";
    el.msg.className =
      "sl-msg" + (kind === "win" ? " is-win" : kind === "err" ? " is-err" : "");
  }

  function setLast(text, win) {
    if (!el.last) return;
    el.last.textContent = text || "";
    el.last.classList.toggle("is-win", !!win);
  }

  function showLineSummary(evalResult) {
    if (!el.winSummary) return;
    if (!evalResult || (!evalResult.lineWins.length && !evalResult.scatterWin)) {
      el.winSummary.hidden = true;
      el.winSummary.innerHTML = "";
      return;
    }
    var parts = evalResult.lineWins.slice(0, 12).map(function (lw) {
      var name = (state.symbols[lw.symbol] && state.symbols[lw.symbol].label) || lw.symbol;
      return (
        "<li>Line " +
        lw.line +
        ": " +
        lw.count +
        "× " +
        esc(name) +
        " → +" +
        lw.win.toFixed(2).replace(/\.00$/, "") +
        "</li>"
      );
    });
    if (evalResult.scatterWin > 0) {
      parts.push(
        "<li>Scatter ×" +
          evalResult.scatter.n +
          " → +" +
          evalResult.scatterWin.toFixed(2).replace(/\.00$/, "") +
          "</li>"
      );
    }
    el.winSummary.innerHTML =
      "<strong>Wins</strong><ul>" + parts.join("") + "</ul>";
    el.winSummary.hidden = false;
  }

  function animateReelsTo(grid) {
    return new Promise(function (resolve) {
      var h = cellH();
      el.reels.innerHTML = "";
      strips = [];
      var jobs = [];
      for (var c = 0; c < COLS; c++) {
        (function (col) {
          var reel = document.createElement("div");
          reel.className = "sl-reel is-spinning";
          reel.style.height = 3 * h + "px";
          var strip = buildStrip(reel, 10);
          el.reels.appendChild(reel);
          strips[col] = strip;
          var delay = col * 220;
          var dur = 1400 + col * 280;
          jobs.push(
            new Promise(function (res) {
              void strip.offsetHeight;
              setTimeout(function () {
                // land so first 3 visible match grid[col]
                // strip has repeating ids — just settle via static render after
                strip.style.transition =
                  "transform " + dur + "ms cubic-bezier(0.12, 0.75, 0.12, 1)";
                strip.style.transform = "translateY(" + -(8 + col) * h * 3 + "px)";
                beep(200 + col * 40, 0.04, "triangle");
                setTimeout(res, dur + 40);
              }, delay);
            })
          );
        })(c);
      }
      Promise.all(jobs).then(function () {
        renderStaticGrid(grid);
        resolve();
      });
    });
  }

  function stopAuto() {
    state.autoLeft = 0;
    if (autoTimer) {
      clearTimeout(autoTimer);
      autoTimer = 0;
    }
    if (el.auto) el.auto.value = "0";
  }

  function scheduleAuto() {
    if (state.autoLeft <= 0) return;
    if (state.bonusOpen || state.spinning) return;
    autoTimer = setTimeout(function () {
      if (state.autoLeft <= 0) return;
      state.autoLeft -= 1;
      spin();
    }, state.inFree ? 700 : 900);
  }

  function openBonus() {
    state.bonusOpen = true;
    stopAuto();
    paintHud();
    if (!el.bonusModal) return Promise.resolve({ credits: 0, free: 0 });
    el.bonusModal.hidden = false;
    var cards = BONUS_CARDS.slice();
    // shuffle
    for (var i = cards.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = cards[i];
      cards[i] = cards[j];
      cards[j] = t;
    }
    var picks = [];
    var totalCredits = 0;
    var totalFree = 0;
    var grid = el.bonusGrid;
    grid.innerHTML = "";
    setMsg("Bonus! Pick 3 cards", "win");
    beep(480, 0.1, "sine");

    return new Promise(function (resolve) {
      cards.forEach(function (card, idx) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "sl-bonus-card";
        btn.innerHTML = '<span class="sl-bonus-back">?</span>';
        btn.addEventListener("click", function () {
          if (btn.classList.contains("revealed") || picks.length >= 3) return;
          btn.classList.add("revealed");
          var label =
            card.type === "freespins"
              ? "+" + card.amount + " FS"
              : "×" + card.mult;
          btn.innerHTML =
            '<span class="sl-bonus-front">' + esc(label) + "</span>";
          picks.push(card);
          if (card.type === "freespins") totalFree += card.amount;
          else totalCredits += card.mult * state.bet;
          beep(360 + picks.length * 80, 0.08, "square");
          if (picks.length >= 3) {
            document.querySelectorAll(".sl-bonus-card").forEach(function (b) {
              b.disabled = true;
            });
            setTimeout(function () {
              el.bonusModal.hidden = true;
              state.bonusOpen = false;
              resolve({ credits: totalCredits, free: totalFree });
            }, 900);
          }
        });
        grid.appendChild(btn);
      });
    });
  }

  function finishFreeSession() {
    var total = state.freeTotalWin;
    state.inFree = false;
    state.freeSpins = 0;
    setMsg(
      total > 0
        ? "Free spins done — +" + Math.round(total) + " play credits total!"
        : "Free spins done.",
      total > 0 ? "win" : ""
    );
    setLast(total > 0 ? "FS total +" + Math.round(total) : "", total > 0);
    state.freeTotalWin = 0;
    paintHud();
  }

  function applyEval(evalResult, betUsed) {
    var win = evalResult.total;
    if (win > 0) {
      state.credits += win;
      saveCredits();
      if (state.inFree) state.freeTotalWin += win;
      setLast("+" + (win % 1 ? win.toFixed(1) : String(Math.round(win))), true);
      setMsg(
        (state.inFree ? "Free spin win " : "You won ") +
          (win % 1 ? win.toFixed(1) : Math.round(win)) +
          "!",
        "win"
      );
      beep(560, 0.1, "square");
    } else {
      setLast(state.inFree ? "Free spin · no win" : "No win", false);
      setMsg(state.inFree ? "Free spins left: " + state.freeSpins : "Try again — just for fun.", "");
      beep(120, 0.06, "triangle");
    }
    highlightWins(evalResult.lineWins, evalResult.scatter.n >= 3 ? evalResult.scatter.cells : []);
    showLineSummary(evalResult);

    if (evalResult.freeAward > 0) {
      if (!state.inFree) {
        state.inFree = true;
        state.freeBet = betUsed;
        state.freeTotalWin = win;
        state.freeSpins = evalResult.freeAward;
        stopAuto();
        setMsg("Free spins! " + evalResult.freeAward + " awarded (2×)", "win");
      } else {
        state.freeSpins += evalResult.freeAward;
        setMsg("Retrigger! +" + evalResult.freeAward + " free spins", "win");
      }
      beep(700, 0.12, "sine");
    }
  }

  function afterSpin(grid, betUsed) {
    var mult = state.inFree ? state.freeMult : 1;
    var evalResult = evaluate(grid, betUsed, mult);
    applyEval(evalResult, betUsed);

    var chain = Promise.resolve();
    if (evalResult.bonus) {
      chain = chain.then(function () {
        return openBonus().then(function (prize) {
          if (prize.credits > 0) {
            state.credits += prize.credits;
            saveCredits();
            if (state.inFree) state.freeTotalWin += prize.credits;
            setMsg("Bonus +" + Math.round(prize.credits) + " credits!", "win");
            setLast("Bonus +" + Math.round(prize.credits), true);
          }
          if (prize.free > 0) {
            if (!state.inFree) {
              state.inFree = true;
              state.freeBet = betUsed;
              state.freeTotalWin = state.freeTotalWin || 0;
              state.freeSpins = prize.free;
            } else {
              state.freeSpins += prize.free;
            }
            setMsg("Bonus awarded +" + prize.free + " free spins!", "win");
          }
          paintHud();
        });
      });
    }

    return chain.then(function () {
      if (evalResult.bonus || evalResult.freeAward > 0) stopAuto();
      if (state.inFree && state.freeSpins <= 0) finishFreeSession();
      state.spinning = false;
      paintHud();
      if (state.inFree && state.freeSpins > 0 && !state.bonusOpen) {
        autoTimer = setTimeout(function () {
          spin();
        }, 850);
        return;
      }
      scheduleAuto();
    });
  }

  function spin() {
    if (state.spinning || state.bonusOpen) return;
    if (!state.symbols) return;

    var betUsed = state.bet;
    var paying = !state.inFree;
    if (state.inFree) {
      if (state.freeSpins <= 0) {
        finishFreeSession();
        return;
      }
      betUsed = state.freeBet || state.bet;
      state.freeSpins -= 1;
    } else {
      if (state.credits < state.bet) {
        setMsg("Not enough play credits — tap Refill.", "err");
        stopAuto();
        paintHud();
        return;
      }
      state.credits -= state.bet;
      saveCredits();
    }

    state.spinning = true;
    paintHud();
    setMsg(state.inFree ? "Free spinning…" : "Spinning…", "");
    if (el.winSummary) el.winSummary.hidden = true;
    beep(180, 0.05, "sawtooth");

    var grid = spinGrid();
    state.grid = grid;

    animateReelsTo(grid).then(function () {
      return afterSpin(grid, betUsed);
    });
  }

  function refill() {
    state.credits = START_CREDITS;
    saveCredits();
    setMsg("Refilled to " + START_CREDITS + " play credits.", "");
    setLast("");
    paintHud();
    beep(400, 0.08, "sine");
  }

  function cacheEls() {
    el.panel = $("panel-slots");
    el.credits = $("sl-credits");
    el.last = $("sl-last");
    el.reels = $("sl-reels");
    el.linesSvg = $("sl-lines");
    el.spin = $("sl-spin");
    el.refill = $("sl-refill");
    el.sound = $("sl-sound");
    el.auto = $("sl-auto");
    el.payRows = $("sl-pay-rows");
    el.symLegend = $("sl-symbols");
    el.msg = $("sl-msg");
    el.winSummary = $("sl-win-summary");
    el.fsBanner = $("sl-fs-banner");
    el.fsCount = $("sl-fs-count");
    el.bonusModal = $("sl-bonus-modal");
    el.bonusGrid = $("sl-bonus-grid");
  }

  function bind() {
    if (!el.panel) return;
    document.querySelectorAll(".sl-bet").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (state.spinning || state.inFree) return;
        state.bet = parseInt(btn.getAttribute("data-bet"), 10) || 1;
        store(BET_KEY, String(state.bet));
        paintHud();
      });
    });
    if (el.spin) el.spin.addEventListener("click", spin);
    if (el.refill) el.refill.addEventListener("click", refill);
    if (el.sound) {
      el.sound.addEventListener("click", function () {
        state.sound = !state.sound;
        store(SOUND_KEY, state.sound ? "1" : "0");
        paintHud();
        if (state.sound) beep(440, 0.06, "sine");
      });
    }
    if (el.auto) {
      el.auto.addEventListener("change", function () {
        var n = parseInt(el.auto.value, 10) || 0;
        state.autoLeft = n;
        if (n > 0 && !state.spinning) spin();
      });
    }
    window.addEventListener("keydown", function (e) {
      if (e.code !== "Space" && e.key !== " ") return;
      if (document.body.getAttribute("data-active-tab") !== "slots") return;
      if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
      e.preventDefault();
      spin();
    });
    window.addEventListener("slots-show", onShow);
    window.addEventListener("tab-changed", function (e) {
      if (e.detail && e.detail.tab === "slots") onShow();
    });
    window.addEventListener("resize", function () {
      if (!state.started || state.spinning || !state.grid) return;
      renderStaticGrid(state.grid);
    });
  }

  function seedGrid() {
    var g = [];
    for (var c = 0; c < COLS; c++) {
      g[c] = [];
      for (var r = 0; r < ROWS; r++) g[c][r] = state.regular[r % state.regular.length].id;
    }
    return g;
  }

  function onShow() {
    if (!state.started) {
      state.started = true;
      loadCredits();
      loadPrefs();
      paintHud();
      loadSymbols().then(function (pack) {
        state.regular = pack.regular;
        state.symbols = pack.map;
        state.grid = seedGrid();
        renderStaticGrid(state.grid);
        renderPaytable();
        paintHud();
      });
    } else {
      paintHud();
      if (state.grid) renderStaticGrid(state.grid);
    }
  }

  function init() {
    cacheEls();
    bind();
    if (
      /#slots/i.test(location.hash || "") ||
      document.body.getAttribute("data-active-tab") === "slots"
    ) {
      onShow();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.Slots = { onShow: onShow, spin: spin };
})();
