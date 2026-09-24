/**
 * Slots — 5×3 painting reels with wilds, scatters, free spins & bonus.
 * Play credits only. No real money.
 */
(function () {
  "use strict";

  var CREDITS_KEY = "slotsPlayCredits.v2";
  var SOUND_KEY = "slotsSoundOn.v2";
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
    { number: 1, weight: 4, pays: [21, 84, 210] },
    { number: 7, weight: 5, pays: [17, 66, 160] },
    { number: 42, weight: 6, pays: [14, 52, 130] },
    { number: 100, weight: 8, pays: [12, 42, 94] },
    { number: 250, weight: 10, pays: [10, 33, 76] },
    { number: 500, weight: 12, pays: [9, 26, 60] },
    { number: 777, weight: 14, pays: [6, 19, 42] },
    { number: 999, weight: 16, pays: [5, 15, 33] },
  ];

  var WILD = {
    id: "wild",
    label: "Wild",
    kind: "wild",
    weight: 3.8,
    pays: [26, 105, 260],
  };
  var SCATTER = {
    id: "scatter",
    label: "Lock Link",
    kind: "scatter",
    // Tuned for ~1/100–150 Lock It Link triggers (6+ orbs on 15 cells).
    weight: 11.8,
    // Small anywhere pays for 3–5 orbs (× total bet). 6+ starts Lock It Link.
    scatterPay: [0, 0, 0, 1, 2, 5],
    linkTrigger: 6,
  };

  // Lock It Link orb prizes (× bet). Weighted low so feature RTP stays ~10–15%.
  var LINK_ORB_TABLE = [
    { kind: "credit", mult: 1, w: 28 },
    { kind: "credit", mult: 1, w: 18 },
    { kind: "credit", mult: 2, w: 16 },
    { kind: "credit", mult: 2, w: 12 },
    { kind: "credit", mult: 3, w: 10 },
    { kind: "credit", mult: 4, w: 6 },
    { kind: "credit", mult: 5, w: 4 },
    { kind: "credit", mult: 8, w: 2.5 },
    { kind: "jackpot", label: "MINI", mult: 15, w: 1.6 },
    { kind: "jackpot", label: "MINOR", mult: 40, w: 0.7 },
    { kind: "jackpot", label: "MAJOR", mult: 100, w: 0.2 },
  ];
  var LINK_GRAND_MULT = 1000;
  var LINK_RESPIN_START = 3;
  // Chance each empty cell becomes an orb on a respin (feature math).
  var LINK_ORB_LAND_P = 0.04;
  var BONUS = {
    id: "bonus",
    label: "Bonus",
    kind: "bonus",
    weight: 3.2,
  };

  var FALLBACK_REG = [
    { id: "star", label: "Star", emoji: "★", weight: 4, pays: [21, 84, 210] },
    { id: "moon", label: "Moon", emoji: "☾", weight: 5, pays: [17, 66, 160] },
    { id: "sun", label: "Sun", emoji: "☀", weight: 6, pays: [14, 52, 130] },
    { id: "gem", label: "Gem", emoji: "◆", weight: 8, pays: [12, 42, 94] },
    { id: "leaf", label: "Leaf", emoji: "❧", weight: 10, pays: [10, 33, 76] },
    { id: "ring", label: "Ring", emoji: "◎", weight: 12, pays: [9, 26, 60] },
    { id: "bolt", label: "Bolt", emoji: "⚡", weight: 14, pays: [6, 19, 42] },
    { id: "heart", label: "Heart", emoji: "♥", weight: 16, pays: [5, 15, 33] },
  ];

  var BONUS_CARDS = [
    { type: "credits", mult: 5 },
    { type: "credits", mult: 5 },
    { type: "credits", mult: 8 },
    { type: "credits", mult: 10 },
    { type: "credits", mult: 12 },
    { type: "credits", mult: 15 },
    { type: "credits", mult: 25 },
    { type: "freespins", amount: 3 },
    { type: "freespins", amount: 3 },
    { type: "freespins", amount: 5 },
    { type: "freespins", amount: 5 },
    { type: "freespins", amount: 8 },
  ];

  var state = {
    credits: START_CREDITS,
    bet: 1,
    spinning: false,
    sound: true,
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
    autoSaved: 0, // paused auto-spin count across bonus / free spins
    bonusOpen: false,
    forceGrid: null, // test hook: one-shot next grid
    bonusResolve: null,
    linkActive: false,
    link: null, // hold-and-spin session state
    linkSkipWait: false,
  };

  var el = {};
  var strips = [];
  var audioCtx = null;
  var autoTimer = 0;
  var symbolsPromise = null;
  var symbolsLocked = false;
  var animFast = false;

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
    // v2 key defaults ON; ignore legacy v1 "off" so sound works after the fix.
    var saved = recall(SOUND_KEY);
    if (saved === "0") state.sound = false;
    else if (saved === "1") state.sound = true;
    else state.sound = true;
    var b = parseInt(recall(BET_KEY), 10);
    if (b === 1 || b === 5 || b === 10) state.bet = b;
  }

  var masterGain = null;
  var spinNodes = null;
  var soundErrors = [];
  var soundFired = [];

  function noteSound(name) {
    soundFired.push(name);
    if (soundFired.length > 100) soundFired.shift();
  }

  function ensureAudio() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      if (!audioCtx) {
        audioCtx = new AC();
        masterGain = audioCtx.createGain();
        masterGain.gain.value = 0.22;
        masterGain.connect(audioCtx.destination);
      }
      if (audioCtx.state === "suspended") {
        audioCtx.resume().catch(function () {});
      }
      return audioCtx;
    } catch (e) {
      soundErrors.push(String(e && e.message ? e.message : e));
      return null;
    }
  }

  function tone(freq, dur, type, vol, when) {
    if (!state.sound) return;
    var ctx = ensureAudio();
    if (!ctx || !masterGain) return;
    try {
      var t0 = ctx.currentTime + (when || 0);
      var o = ctx.createOscillator();
      var g = ctx.createGain();
      o.type = type || "sine";
      o.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol || 0.08), t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.max(0.03, dur));
      o.connect(g);
      g.connect(masterGain);
      o.start(t0);
      o.stop(t0 + dur + 0.02);
    } catch (e) {
      soundErrors.push(String(e && e.message ? e.message : e));
    }
  }

  function noiseBurst(dur, vol) {
    if (!state.sound) return;
    var ctx = ensureAudio();
    if (!ctx || !masterGain) return;
    try {
      var n = Math.max(1, Math.floor(ctx.sampleRate * dur));
      var buf = ctx.createBuffer(1, n, ctx.sampleRate);
      var data = buf.getChannelData(0);
      for (var i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
      var src = ctx.createBufferSource();
      src.buffer = buf;
      var g = ctx.createGain();
      var f = ctx.createBiquadFilter();
      f.type = "bandpass";
      f.frequency.value = 1800;
      f.Q.value = 0.7;
      g.gain.value = vol || 0.05;
      src.connect(f);
      f.connect(g);
      g.connect(masterGain);
      src.start();
      src.stop(ctx.currentTime + dur + 0.01);
    } catch (e) {
      soundErrors.push(String(e && e.message ? e.message : e));
    }
  }

  function sndClick() {
    noteSound("click");
    tone(720, 0.04, "triangle", 0.04);
    tone(480, 0.05, "sine", 0.03, 0.01);
  }

  function stopSpinWhirr() {
    if (!spinNodes) return;
    try {
      if (spinNodes.tickTimer) clearInterval(spinNodes.tickTimer);
      if (audioCtx && spinNodes.g) {
        spinNodes.g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.05);
      }
      var stopAt = (audioCtx && audioCtx.currentTime) + 0.06;
      if (spinNodes.osc) spinNodes.osc.stop(stopAt);
      if (spinNodes.lfo) spinNodes.lfo.stop(stopAt);
    } catch (e) {}
    spinNodes = null;
  }

  function sndSpinStart() {
    noteSound("spinStart");
    stopSpinWhirr();
    if (!state.sound) return;
    var ctx = ensureAudio();
    if (!ctx || !masterGain) return;
    try {
      var osc = ctx.createOscillator();
      var lfo = ctx.createOscillator();
      var lfoGain = ctx.createGain();
      var g = ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.value = 55;
      lfo.frequency.value = 12;
      lfoGain.gain.value = 18;
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);
      g.gain.value = 0.035;
      osc.connect(g);
      g.connect(masterGain);
      osc.start();
      lfo.start();
      var tickTimer = setInterval(function () {
        if (!state.sound || !state.spinning) return;
        tone(240 + Math.random() * 80, 0.025, "square", 0.028);
      }, 95);
      spinNodes = { osc: osc, lfo: lfo, g: g, tickTimer: tickTimer };
      tone(160, 0.06, "sawtooth", 0.05);
    } catch (e) {
      soundErrors.push(String(e && e.message ? e.message : e));
    }
  }

  function sndReelStop(col) {
    noteSound("reelStop");
    noiseBurst(0.045, 0.06);
    tone(90 + col * 12, 0.08, "triangle", 0.09);
    tone(180 + col * 20, 0.05, "sine", 0.04, 0.02);
  }

  function sndLose() {
    noteSound("lose");
    tone(140, 0.08, "triangle", 0.04);
    tone(100, 0.1, "sine", 0.03, 0.04);
  }

  function sndFanfare(kind) {
    noteSound("fanfare:" + (kind || "win"));
    var seq =
      kind === "bonus"
        ? [392, 494, 587, 784, 988]
        : kind === "free"
          ? [523, 659, 784, 1046]
          : [440, 554, 659, 880, 1175];
    for (var i = 0; i < seq.length; i++) {
      tone(seq[i], 0.14, i % 2 ? "triangle" : "sine", 0.07, i * 0.09);
    }
    noiseBurst(0.08, 0.04);
  }

  function sndWin(amount, bet) {
    noteSound("win");
    var ratio = bet > 0 ? amount / bet : amount;
    var scale = Math.max(0.5, Math.min(3, Math.log10(1 + ratio * 4) + 0.5));
    var base = 440;
    for (var i = 0; i < 3 + Math.floor(scale); i++) {
      tone(base * (1 + i * 0.33), 0.12 + i * 0.03, "sine", 0.05 * scale, i * 0.07);
    }
    if (ratio >= 10) sndFanfare("big");
  }

  function sndCardFlip() {
    noteSound("cardFlip");
    noiseBurst(0.03, 0.05);
    tone(620, 0.06, "square", 0.045);
    tone(880, 0.08, "triangle", 0.04, 0.04);
  }

  function sndBonusOpen() {
    noteSound("bonusOpen");
    sndFanfare("bonus");
  }

  function sndFreeSpins() {
    noteSound("freeSpins");
    sndFanfare("free");
  }

  function sndRefill() {
    noteSound("refill");
    tone(400, 0.08, "sine", 0.05);
    tone(600, 0.1, "sine", 0.04, 0.06);
  }

  function sndLinkLock() {
    noteSound("linkLock");
    tone(660, 0.07, "square", 0.06);
    tone(880, 0.09, "sine", 0.05, 0.04);
    noiseBurst(0.03, 0.04);
  }

  function sndLinkReset() {
    noteSound("linkReset");
    tone(523, 0.08, "triangle", 0.07);
    tone(659, 0.08, "triangle", 0.07, 0.07);
    tone(784, 0.12, "sine", 0.08, 0.14);
  }

  function sndLinkEmpty() {
    noteSound("linkEmpty");
    tone(160, 0.05, "triangle", 0.035);
  }

  function sndLinkTally() {
    noteSound("linkTally");
    tone(740, 0.05, "sine", 0.045);
  }

  function sndLinkGrand() {
    noteSound("linkGrand");
    sndFanfare("big");
    tone(1175, 0.2, "sine", 0.09, 0.35);
  }

  function sndLinkStart() {
    noteSound("linkStart");
    sndFanfare("bonus");
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
    if (symbolsPromise) return symbolsPromise;
    symbolsPromise = fetch("data/manifest.json", { cache: "default" })
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
      })
      .then(function (pack) {
        symbolsLocked = true;
        return pack;
      });
    return symbolsPromise;
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
    if (state.forceGrid) {
      var forced = state.forceGrid;
      state.forceGrid = null;
      return forced;
    }
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
    var link = false;
    if (sc.n >= (SCATTER.linkTrigger || 6)) {
      link = true;
      // No scatter cash pay when Lock It Link starts — feature pays the orbs.
    } else if (sc.n >= 3) {
      scatterWin = (SCATTER.scatterPay[Math.min(sc.n, 5)] || 0) * bet * freeMult;
      total += scatterWin;
    }
    var bonus = bonusTriggered(grid);
    return {
      lineWins: lineWins,
      scatter: sc,
      scatterWin: scatterWin,
      freeAward: 0,
      link: link,
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
    LINK_ORB_TABLE: LINK_ORB_TABLE,
    LINK_GRAND_MULT: LINK_GRAND_MULT,
    LINK_RESPIN_START: LINK_RESPIN_START,
    LINK_ORB_LAND_P: LINK_ORB_LAND_P,
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
      inner =
        '<span class="sl-orb" aria-hidden="true"></span><span class="sl-special-sub">LINK</span>';
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

  function symCellHtml(sid, h, c, r) {
    var attrs =
      'class="sl-sym" data-sid="' +
      esc(sid) +
      '"' +
      (c != null
        ? ' data-c="' + c + '" data-r="' + r + '"'
        : "") +
      ' style="height:' +
      h +
      'px"';
    return "<div " + attrs + ">" + symHtml(state.symbols[sid]) + "</div>";
  }

  /** Build a tall strip whose landing window is exactly resultRows (3 ids). */
  function buildResultStrip(reelEl, col, resultRows, h) {
    h = h || cellH();
    var ids = [];
    // Enough filler so the spin travels visibly; length varies per reel.
    var filler = 24 + col * 5;
    for (var i = 0; i < filler; i++) {
      ids.push(pickSymbolId(col));
    }
    var landIndex = ids.length;
    ids.push(resultRows[0], resultRows[1], resultRows[2]);
    // A couple below the window so the strip isn't empty under the land.
    for (var j = 0; j < 3; j++) ids.push(pickSymbolId(col));

    var html = "";
    for (var k = 0; k < ids.length; k++) {
      html += symCellHtml(ids[k], h, null, null);
    }
    var strip = document.createElement("div");
    strip.className = "sl-strip";
    strip.style.transition = "none";
    strip.style.transform = "translateY(0)";
    strip.innerHTML = html;
    reelEl.innerHTML = "";
    reelEl.appendChild(strip);
    return { strip: strip, landIndex: landIndex, h: h };
  }

  /** After land: keep the same 3 visible nodes, drop filler, clear transform. */
  function normalizeReel(reel, strip, landIndex, col) {
    var nodes = strip.querySelectorAll(".sl-sym");
    var keep = [];
    for (var r = 0; r < ROWS; r++) {
      var node = nodes[landIndex + r];
      if (!node) continue;
      node.setAttribute("data-c", String(col));
      node.setAttribute("data-r", String(r));
      keep.push(node);
    }
    var settled = document.createElement("div");
    settled.className = "sl-strip sl-strip-static";
    settled.style.transition = "none";
    settled.style.transform = "none";
    keep.forEach(function (n) {
      settled.appendChild(n);
    });
    reel.classList.remove("is-spinning");
    reel.innerHTML = "";
    reel.appendChild(settled);
    strips[col] = settled;
  }

  function renderStaticGrid(grid) {
    if (!el.reels || !grid) return;
    var h = cellH();
    el.reels.innerHTML = "";
    strips = [];
    for (var c = 0; c < COLS; c++) {
      var reel = document.createElement("div");
      reel.className = "sl-reel";
      reel.style.height = 3 * h + "px";
      var strip = document.createElement("div");
      strip.className = "sl-strip sl-strip-static";
      strip.style.transition = "none";
      strip.style.transform = "none";
      var html = "";
      for (var r = 0; r < ROWS; r++) {
        html += symCellHtml(grid[c][r], h, c, r);
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
      '<details class="sl-details"><summary>Wild · Lock It Link · Bonus · Free spins</summary><div class="sl-pay-rows">';
    html +=
      "<div class=\"sl-pay-row\"><span>Wild</span><strong>Substitutes any regular · not on reel 1</strong></div>";
    html +=
      "<div class=\"sl-pay-row\"><span>Link orbs 3 / 4 / 5</span><strong>×1 / ×2 / ×4 total bet</strong></div>";
    html +=
      "<div class=\"sl-pay-row\"><span>Lock It Link</span><strong>6+ glowing orbs → hold &amp; spin · RESPINS 3 · new orb resets to 3 · tally all values</strong></div>";
    html +=
      "<div class=\"sl-pay-row\"><span>Orbs</span><strong>1×–8× bet · MINI 15× · MINOR 40× · MAJOR 100× · GRAND 1000× if all 15 fill</strong></div>";
    html +=
      "<div class=\"sl-pay-row\"><span>Bonus pick</span><strong>Bonus on reels 1+3+5 → pick 3 cards → free spins (+3/+5/+8) & credits</strong></div>";
    html +=
      "<div class=\"sl-pay-row\"><span>Free spins</span><strong>From bonus pick · 2× wins · same bet · can retrigger</strong></div>";
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
        "<figcaption>Link</figcaption></figure>";
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
      el.spin.disabled =
        state.spinning ||
        state.bonusOpen ||
        state.linkActive ||
        (!state.inFree && state.credits < state.bet);
      if (state.linkActive) el.spin.textContent = "Link…";
      else el.spin.textContent = state.inFree ? "Free spin" : "Spin";
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
    if (el.auto) el.auto.disabled = state.spinning || state.bonusOpen || state.linkActive;
    paintLinkBanner();
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
      if (el.linesSvg) el.linesSvg.innerHTML = "";
      el.reels.innerHTML = "";
      strips = [];
      var jobs = [];
      for (var c = 0; c < COLS; c++) {
        (function (col) {
          var reel = document.createElement("div");
          reel.className = "sl-reel is-spinning";
          reel.style.height = 3 * h + "px";
          var built = buildResultStrip(reel, col, grid[col], h);
          var strip = built.strip;
          var landIndex = built.landIndex;
          el.reels.appendChild(reel);
          strips[col] = strip;
          var delay = animFast ? col * 25 : col * 220;
          var dur = animFast ? 90 + col * 30 : 1400 + col * 280;
          jobs.push(
            new Promise(function (res) {
              void strip.offsetHeight;
              setTimeout(function () {
                strip.style.transition =
                  "transform " + dur + "ms cubic-bezier(0.12, 0.75, 0.12, 1)";
                strip.style.transform =
                  "translateY(" + -(landIndex * built.h) + "px)";
                /* reel tick covered by spin whirr */
                setTimeout(function () {
                  normalizeReel(reel, strip, landIndex, col);
                  sndReelStop(col);
                  if (col === COLS - 1) stopSpinWhirr();
                  res();
                }, dur + 40);
              }, delay);
            })
          );
        })(c);
      }
      Promise.all(jobs).then(function () {
        // DOM already shows the result cells; do not re-randomize or rebuild identities.
        resolve();
      });
    });
  }

  function clearAutoTimer() {
    if (autoTimer) {
      clearTimeout(autoTimer);
      autoTimer = 0;
    }
  }

  function stopAuto() {
    state.autoLeft = 0;
    state.autoSaved = 0;
    clearAutoTimer();
    if (el.auto) el.auto.value = "0";
  }

  /** Pause auto without forgetting the remaining count (bonus / free spins). */
  function pauseAuto() {
    if (state.autoLeft > 0) state.autoSaved = state.autoLeft;
    clearAutoTimer();
  }

  function resumeAutoAfterFeature() {
    if (state.autoSaved > 0) {
      state.autoLeft = state.autoSaved;
      state.autoSaved = 0;
      if (el.auto) el.auto.value = String(state.autoLeft);
    }
    scheduleAuto();
  }

  function scheduleAuto() {
    if (state.autoLeft <= 0) return;
    if (state.bonusOpen || state.spinning || state.inFree || state.linkActive) return;
    clearAutoTimer();
    autoTimer = setTimeout(function () {
      if (state.autoLeft <= 0 || state.bonusOpen || state.spinning) return;
      state.autoLeft -= 1;
      if (el.auto) el.auto.value = state.autoLeft > 0 ? String(state.autoLeft) : "0";
      spin();
    }, 900);
  }

  function shuffleInPlace(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  function cardLabel(card) {
    return card.type === "freespins"
      ? "+" + card.amount + " FS"
      : "×" + card.mult;
  }

  function applyCardPrize(card, totals, betUsed) {
    if (card.type === "freespins") totals.free += card.amount;
    else totals.credits += card.mult * betUsed;
  }


  function rollLinkOrb() {
    var total = 0;
    for (var i = 0; i < LINK_ORB_TABLE.length; i++) total += LINK_ORB_TABLE[i].w;
    var r = Math.random() * total;
    for (var j = 0; j < LINK_ORB_TABLE.length; j++) {
      r -= LINK_ORB_TABLE[j].w;
      if (r <= 0) {
        var row = LINK_ORB_TABLE[j];
        return {
          locked: true,
          kind: row.kind,
          mult: row.mult,
          label: row.label || null,
          value: 0, // filled when bet known
        };
      }
    }
    var fallback = LINK_ORB_TABLE[0];
    return { locked: true, kind: fallback.kind, mult: fallback.mult, label: null, value: 0 };
  }

  function orbCredits(orb, bet) {
    return Math.round((orb.mult || 0) * bet);
  }

  function paintLinkBanner() {
    if (!el.linkBanner) return;
    var L = state.link;
    var on = !!(state.linkActive && L);
    el.linkBanner.hidden = !on;
    if (!on) return;
    if (el.linkCount) el.linkCount.textContent = String(L.respins);
    if (el.linkDots) {
      var dots = "";
      for (var i = 0; i < LINK_RESPIN_START; i++) {
        dots += i < L.respins ? "●" : "○";
      }
      el.linkDots.textContent = dots;
      el.linkDots.classList.toggle("is-reset", !!L.resetFlash);
    }
    if (el.linkTotal) el.linkTotal.textContent = String(Math.round(L.displayTotal || 0));
  }

  function renderLinkGrid() {
    if (!el.reels || !state.link) return;
    var L = state.link;
    var h = cellH();
    el.reels.classList.add("sl-reels-link");
    el.reels.innerHTML = "";
    strips = [];
    if (el.linesSvg) el.linesSvg.innerHTML = "";
    for (var c = 0; c < COLS; c++) {
      var reel = document.createElement("div");
      reel.className = "sl-reel sl-reel-link";
      reel.style.height = 3 * h + "px";
      var strip = document.createElement("div");
      strip.className = "sl-strip sl-strip-static";
      var html = "";
      for (var r = 0; r < ROWS; r++) {
        var cell = L.cells[c][r];
        var cls = "sl-sym sl-link-cell";
        if (cell.locked) cls += " is-locked";
        if (cell.spinning) cls += " is-spinning-cell";
        if (cell.jackpot) cls += " is-jackpot";
        if (cell.grand) cls += " is-grand";
        var inner;
        if (cell.locked) {
          if (cell.kind === "jackpot") {
            inner =
              '<div class="sl-link-orb jackpot"><span class="sl-link-jp">' +
              esc(cell.label) +
              '</span><span class="sl-link-val">' +
              esc(String(cell.value)) +
              "</span></div>";
          } else {
            inner =
              '<div class="sl-link-orb"><span class="sl-link-val">' +
              esc(String(cell.value)) +
              "</span></div>";
          }
        } else {
          inner = '<div class="sl-link-blank">·</div>';
        }
        html +=
          '<div class="' +
          cls +
          '" data-c="' +
          c +
          '" data-r="' +
          r +
          '" data-sid="' +
          (cell.locked ? "orb" : "blank") +
          '" style="height:' +
          h +
          'px">' +
          inner +
          "</div>";
      }
      strip.innerHTML = html;
      reel.appendChild(strip);
      el.reels.appendChild(reel);
      strips.push(strip);
    }
    paintLinkBanner();
  }

  function countLocked(cells) {
    var n = 0;
    for (var c = 0; c < COLS; c++)
      for (var r = 0; r < ROWS; r++) if (cells[c][r].locked) n++;
    return n;
  }

  function sumLocked(cells) {
    var s = 0;
    for (var c = 0; c < COLS; c++)
      for (var r = 0; r < ROWS; r++) if (cells[c][r].locked) s += cells[c][r].value || 0;
    return s;
  }

  function waitLinkGap(ms) {
    ms = animFast ? Math.min(ms, 80) : ms;
    return new Promise(function (resolve) {
      if (state.linkSkipWait) {
        state.linkSkipWait = false;
        resolve();
        return;
      }
      var left = ms;
      var step = 50;
      function tick() {
        if (state.linkSkipWait) {
          state.linkSkipWait = false;
          resolve();
          return;
        }
        left -= step;
        if (left <= 0) resolve();
        else setTimeout(tick, step);
      }
      setTimeout(tick, step);
    });
  }

  function animateEmptyCells(outcomes) {
    // outcomes: list of {c,r,orb|null} decided first — land exactly on them.
    return new Promise(function (resolve) {
      var L = state.link;
      outcomes.forEach(function (o) {
        L.cells[o.c][o.r].spinning = true;
      });
      renderLinkGrid();
      var dur = animFast ? 120 : 520;
      setTimeout(function () {
        outcomes.forEach(function (o) {
          var cell = L.cells[o.c][o.r];
          cell.spinning = false;
          if (o.orb) {
            cell.locked = true;
            cell.kind = o.orb.kind;
            cell.mult = o.orb.mult;
            cell.label = o.orb.label;
            cell.value = orbCredits(o.orb, L.bet);
            cell.jackpot = o.orb.kind === "jackpot";
          }
        });
        renderLinkGrid();
        resolve();
      }, dur);
    });
  }

  function tallyLinkTotal() {
    return new Promise(function (resolve) {
      var L = state.link;
      var locked = [];
      for (var c = 0; c < COLS; c++) {
        for (var r = 0; r < ROWS; r++) {
          if (L.cells[c][r].locked) locked.push(L.cells[c][r]);
        }
      }
      L.displayTotal = 0;
      paintLinkBanner();
      if (el.linkSummary) {
        el.linkSummary.hidden = false;
        el.linkSummary.innerHTML =
          '<div class="sl-link-summary-title">Lock It Link</div><div class="sl-link-summary-total">TOTAL <strong id="sl-link-summary-val">0</strong></div>';
      }
      var i = 0;
      var running = 0;
      function next() {
        if (i >= locked.length) {
          if (L.grand) {
            running += L.grandBonus;
            L.displayTotal = running;
            sndLinkGrand();
            if (el.linkSummary) {
              el.linkSummary.innerHTML +=
                '<div class="sl-link-grand">GRAND +' + Math.round(L.grandBonus) + "</div>";
            }
            paintLinkBanner();
            var sv = document.getElementById("sl-link-summary-val");
            if (sv) sv.textContent = String(Math.round(running));
          }
          L.total = running;
          setTimeout(resolve, animFast ? 200 : 900);
          return;
        }
        var cell = locked[i++];
        running += cell.value || 0;
        L.displayTotal = running;
        paintLinkBanner();
        sndLinkTally();
        var node = el.reels.querySelector(
          '.sl-link-cell[data-c="' + cell._c + '"][data-r="' + cell._r + '"]'
        );
        // mark cells with coords
        var sv = document.getElementById("sl-link-summary-val");
        if (sv) sv.textContent = String(Math.round(running));
        setTimeout(next, animFast ? 40 : 160);
      }
      // stamp coords for highlight
      for (var c2 = 0; c2 < COLS; c2++)
        for (var r2 = 0; r2 < ROWS; r2++) {
          L.cells[c2][r2]._c = c2;
          L.cells[c2][r2]._r = r2;
        }
      next();
    });
  }

  function endLinkFeature() {
    return tallyLinkTotal().then(function () {
      var L = state.link;
      var win = L.total || 0;
      if (win > 0) {
        state.credits += win;
        saveCredits();
        if (state.inFree) state.freeTotalWin += win;
        setLast("Link +" + Math.round(win), true);
        setMsg("Lock It Link +" + Math.round(win) + " play credits!", "win");
      } else {
        setMsg("Lock It Link — no total.", "");
      }
      return waitLinkGap(animFast ? 200 : 1200).then(function () {
        state.linkActive = false;
        state.link = null;
        if (el.linkBanner) el.linkBanner.hidden = true;
        if (el.linkSummary) {
          el.linkSummary.hidden = true;
          el.linkSummary.innerHTML = "";
        }
        el.reels.classList.remove("sl-reels-link");
        if (state.grid) renderStaticGrid(state.grid);
        paintHud();
      });
    });
  }

  function runLinkFeature(triggerGrid, betUsed) {
    pauseAuto();
    state.linkActive = true;
    state.spinning = false;
    var cells = [];
    var triggerCells = [];
    for (var c = 0; c < COLS; c++) {
      cells[c] = [];
      for (var r = 0; r < ROWS; r++) {
        if (triggerGrid[c][r] === "scatter") {
          var orb = rollLinkOrb();
          orb.value = orbCredits(orb, betUsed);
          orb.jackpot = orb.kind === "jackpot";
          cells[c][r] = orb;
          triggerCells.push({ c: c, r: r });
        } else {
          cells[c][r] = { locked: false, spinning: false, value: 0 };
        }
      }
    }
    state.link = {
      bet: betUsed,
      respins: LINK_RESPIN_START,
      cells: cells,
      displayTotal: sumLocked(cells),
      total: 0,
      grand: false,
      grandBonus: 0,
      resetFlash: false,
    };
    sndLinkStart();
    setMsg("Lock It Link! " + triggerCells.length + " orbs locked — RESPINS 3", "win");
    renderLinkGrid();
    triggerCells.forEach(function () {
      sndLinkLock();
    });
    paintHud();

    function respinOnce() {
      var L = state.link;
      if (!L) return Promise.resolve();
      // Decide outcomes first (result integrity).
      var outcomes = [];
      var anyNew = false;
      for (var c = 0; c < COLS; c++) {
        for (var r = 0; r < ROWS; r++) {
          if (L.cells[c][r].locked) continue;
          if (Math.random() < LINK_ORB_LAND_P) {
            var orb = rollLinkOrb();
            outcomes.push({ c: c, r: r, orb: orb });
            anyNew = true;
          } else {
            outcomes.push({ c: c, r: r, orb: null });
          }
        }
      }
      if (!outcomes.length) {
        L.respins = 0;
        return Promise.resolve();
      }
      return animateEmptyCells(outcomes).then(function () {
        if (anyNew) {
          L.respins = LINK_RESPIN_START;
          L.resetFlash = true;
          paintLinkBanner();
          sndLinkReset();
          setMsg("New orb! Respins reset to 3", "win");
          return waitLinkGap(280).then(function () {
            L.resetFlash = false;
            paintLinkBanner();
          });
        }
        L.respins -= 1;
        sndLinkEmpty();
        paintLinkBanner();
        setMsg("RESPINS: " + L.respins, L.respins > 0 ? "" : "win");
        return Promise.resolve();
      });
    }

    function loop() {
      var L = state.link;
      if (!L) return Promise.resolve();
      if (countLocked(L.cells) >= COLS * ROWS) {
        L.grand = true;
        L.grandBonus = LINK_GRAND_MULT * L.bet;
        L.respins = 0;
        setMsg("GRID FULL — GRAND!", "win");
        return endLinkFeature();
      }
      if (L.respins <= 0) return endLinkFeature();
      return waitLinkGap(700).then(function () {
        return respinOnce().then(loop);
      });
    }

    return loop();
  }

  function openBonus(betUsed) {
    betUsed = betUsed || state.bet;
    state.bonusOpen = true;
    // Unlock the spin flag while the modal is up — bonusOpen still blocks new spins.
    state.spinning = false;
    pauseAuto();
    paintHud();
    if (!el.bonusModal) {
      return Promise.resolve({ credits: 0, free: 5 });
    }

    var cards = shuffleInPlace(BONUS_CARDS.slice());
    var picks = [];
    var totals = { credits: 0, free: 0 };
    var settled = false;
    var autoCloseTimer = 0;

    el.bonusModal.hidden = false;
    if (el.bonusHint) {
      el.bonusHint.textContent =
        "Pick 3 cards — free spins (+3 / +5 / +8) or credit prizes. At least one free-spin prize is guaranteed.";
    }
    if (el.bonusSummary) {
      el.bonusSummary.hidden = true;
      el.bonusSummary.textContent = "";
    }
    if (el.bonusStart) {
      el.bonusStart.hidden = true;
      el.bonusStart.disabled = false;
    }
    var grid = el.bonusGrid;
    grid.innerHTML = "";
    setMsg("Bonus! Pick 3 cards for free spins", "win");
    sndBonusOpen();

    function finishBonus(prize) {
      if (settled) return;
      settled = true;
      state.bonusResolve = null;
      if (autoCloseTimer) clearTimeout(autoCloseTimer);
      el.bonusModal.hidden = true;
      state.bonusOpen = false;
      paintHud();
      if (resolveFn) resolveFn(prize);
    }

    var resolveFn = null;

    function showStartScreen() {
      // Guarantee free spins
      if (totals.free <= 0) {
        totals.free = 5;
      }
      document.querySelectorAll(".sl-bonus-card").forEach(function (b) {
        b.disabled = true;
      });
      var parts = [];
      if (totals.free > 0) parts.push("+" + totals.free + " free spins");
      if (totals.credits > 0) parts.push("+" + Math.round(totals.credits) + " credits");
      var summary = "Bonus total: " + parts.join(" · ");
      if (el.bonusSummary) {
        el.bonusSummary.textContent = summary;
        el.bonusSummary.hidden = false;
      }
      setMsg(summary, "win");
      sndFreeSpins();
      if (el.bonusStart) {
        el.bonusStart.hidden = false;
        el.bonusStart.focus();
      }
      autoCloseTimer = setTimeout(function () {
        finishBonus({ credits: totals.credits, free: totals.free });
      }, 3000);
    }

    function revealCard(btn, card) {
      if (settled || btn.classList.contains("revealed") || picks.length >= 3) return;
      // Guarantee: if this is the 3rd pick and no FS yet, force a +5 FS prize.
      if (picks.length === 2 && totals.free <= 0 && card.type !== "freespins") {
        card = { type: "freespins", amount: 5 };
      }
      btn.classList.add("revealed");
      btn.innerHTML = '<span class="sl-bonus-front">' + esc(cardLabel(card)) + "</span>";
      picks.push(card);
      applyCardPrize(card, totals, betUsed);
      sndCardFlip();
      if (picks.length >= 3) showStartScreen();
    }

    cards.forEach(function (card) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "sl-bonus-card";
      btn.setAttribute("aria-label", "Bonus card");
      btn._slCard = card;
      btn.innerHTML = '<span class="sl-bonus-back">?</span>';
      function onPick(ev) {
        if (ev) {
          ev.preventDefault();
          ev.stopPropagation();
        }
        revealCard(btn, btn._slCard);
      }
      // Single click/tap handler (touch-action: manipulation on cards).
      btn.addEventListener("click", onPick);
      grid.appendChild(btn);
    });

    function onStartClick(ev) {
      if (ev) ev.preventDefault();
      if (picks.length < 3) return;
      finishBonus({ credits: totals.credits, free: totals.free });
    }
    if (el.bonusStart) {
      el.bonusStart.onclick = onStartClick;
    }

    function forceCompleteRemaining() {
      if (settled) return;
      var buttons = grid.querySelectorAll(".sl-bonus-card:not(.revealed)");
      for (var bi = 0; bi < buttons.length && picks.length < 3; bi++) {
        revealCard(buttons[bi], buttons[bi]._slCard || { type: "freespins", amount: 5 });
      }
      if (totals.free <= 0) totals.free = 5;
      // Skip the 3s linger when escaping / closing — award and go.
      finishBonus({ credits: totals.credits, free: totals.free });
    }

    function onEsc(e) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      forceCompleteRemaining();
    }
    window.addEventListener("keydown", onEsc);

    if (el.bonusClose) {
      el.bonusClose.onclick = function (ev) {
        ev.preventDefault();
        forceCompleteRemaining();
      };
    }

    return new Promise(function (resolve) {
      resolveFn = function (prize) {
        window.removeEventListener("keydown", onEsc);
        if (el.bonusStart) el.bonusStart.onclick = null;
        if (el.bonusClose) el.bonusClose.onclick = null;
        resolve(prize);
      };
      state.bonusResolve = resolveFn;
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
    resumeAutoAfterFeature();
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
      sndWin(win, betUsed);
    } else {
      setLast(state.inFree ? "Free spin · no win" : "No win", false);
      setMsg(state.inFree ? "Free spins left: " + state.freeSpins : "Try again — just for fun.", "");
      sndLose();
    }
    var highlightScatter =
      evalResult.link || evalResult.scatter.n >= 3 ? evalResult.scatter.cells : [];
    highlightWins(evalResult.lineWins, highlightScatter);
    showLineSummary(evalResult);
  }

  function afterSpin(grid, betUsed) {
    var mult = state.inFree ? state.freeMult : 1;
    var evalResult = evaluate(grid, betUsed, mult);
    applyEval(evalResult, betUsed);

    var chain = Promise.resolve();
    if (evalResult.link) {
      chain = chain.then(function () {
        return runLinkFeature(grid, betUsed);
      });
    }
    if (evalResult.bonus) {
      chain = chain.then(function () {
        return openBonus(betUsed).then(function (prize) {
          if (prize.credits > 0) {
            state.credits += prize.credits;
            saveCredits();
            if (state.inFree) state.freeTotalWin += prize.credits;
          }
          var freeGain = Math.max(0, prize.free || 0);
          if (freeGain <= 0) freeGain = 5;
          if (!state.inFree) {
            state.inFree = true;
            state.freeBet = betUsed;
            state.freeTotalWin = state.freeTotalWin || 0;
            state.freeSpins = freeGain;
          } else {
            state.freeSpins += freeGain;
          }
          setMsg(
            "Bonus → +" +
              freeGain +
              " free spins" +
              (prize.credits > 0 ? " · +" + Math.round(prize.credits) + " credits" : "") +
              "!",
            "win"
          );
          setLast("Bonus +" + freeGain + " FS", true);
          paintHud();
        });
      });
    }

    return chain.then(function () {
      if (state.inFree && state.freeSpins <= 0) finishFreeSession();
      state.spinning = false;
      paintHud();
      if (state.linkActive || state.bonusOpen) return;
      if (state.inFree && state.freeSpins > 0) {
        clearAutoTimer();
        autoTimer = setTimeout(function () {
          spin();
        }, animFast ? 200 : 850);
        return;
      }
      if (!state.inFree) resumeAutoAfterFeature();
    });
  }

  function spin() {
    if (state.spinning || state.bonusOpen || state.linkActive) return;
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
    ensureAudio();
    sndSpinStart();

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
    sndRefill();
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
    el.bonusHint = $("sl-bonus-hint");
    el.bonusSummary = $("sl-bonus-summary");
    el.bonusStart = $("sl-bonus-start");
    el.bonusClose = $("sl-bonus-close");
    el.linkBanner = $("sl-link-banner");
    el.linkCount = $("sl-link-count");
    el.linkDots = $("sl-link-dots");
    el.linkTotal = $("sl-link-total");
    el.linkSummary = $("sl-link-summary");
  }

  function bind() {
    if (!el.panel) return;
    function unlockAudio() {
      ensureAudio();
    }
    el.panel.addEventListener("pointerdown", unlockAudio, { passive: true });
    el.panel.addEventListener("touchstart", unlockAudio, { passive: true });
    el.panel.addEventListener("click", unlockAudio, true);

    document.querySelectorAll(".sl-bet").forEach(function (btn) {
      btn.addEventListener("click", function () {
        ensureAudio();
        sndClick();
        if (state.spinning || state.inFree || state.bonusOpen) return;
        state.bet = parseInt(btn.getAttribute("data-bet"), 10) || 1;
        store(BET_KEY, String(state.bet));
        paintHud();
      });
    });
    if (el.spin)
      el.spin.addEventListener("click", function () {
        ensureAudio();
        if (state.linkActive) {
          state.linkSkipWait = true;
          return;
        }
        sndClick();
        spin();
      });
    if (el.refill)
      el.refill.addEventListener("click", function () {
        ensureAudio();
        refill();
      });
    if (el.sound) {
      el.sound.addEventListener("click", function () {
        ensureAudio();
        state.sound = !state.sound;
        store(SOUND_KEY, state.sound ? "1" : "0");
        paintHud();
        if (state.sound) {
          sndClick();
          tone(520, 0.08, "sine", 0.06);
        } else {
          stopSpinWhirr();
        }
      });
    }
    if (el.auto) {
      el.auto.addEventListener("change", function () {
        ensureAudio();
        sndClick();
        var n = parseInt(el.auto.value, 10) || 0;
        state.autoLeft = n;
        state.autoSaved = 0;
        if (n > 0 && !state.spinning && !state.bonusOpen) spin();
      });
    }
    window.addEventListener("keydown", function (e) {
      if (e.code !== "Space" && e.key !== " ") return;
      if (e.repeat) return;
      if (document.body.getAttribute("data-active-tab") !== "slots") return;
      if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
      if (state.linkActive) {
        e.preventDefault();
        state.linkSkipWait = true;
        return;
      }
      if (state.spinning || state.bonusOpen) return;
      e.preventDefault();
      ensureAudio();
      spin();
    });
    if (el.reels) {
      el.reels.addEventListener("click", function () {
        if (state.linkActive) state.linkSkipWait = true;
      });
    }
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
        if (!state.symbols) {
          state.regular = pack.regular;
          state.symbols = pack.map;
        }
        if (!state.grid) state.grid = seedGrid();
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
    checkSlotsDebug();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  function readVisibleGrid() {
    var out = [];
    for (var c = 0; c < COLS; c++) {
      out[c] = [];
      for (var r = 0; r < ROWS; r++) {
        var node =
          el.reels &&
          el.reels.querySelector(
            '.sl-sym[data-c="' + c + '"][data-r="' + r + '"]'
          );
        out[c][r] = node ? node.getAttribute("data-sid") : null;
      }
    }
    return out;
  }

  window.Slots = {
    onShow: onShow,
    spin: spin,
    isSpinning: function () {
      return !!state.spinning;
    },
    getGrid: function () {
      return state.grid ? state.grid.map(function (col) { return col.slice(); }) : null;
    },
    getVisibleGrid: readVisibleGrid,
    /** Test helpers — not used by the UI. */
    __test: {
      forceGrid: function (g) {
        state.forceGrid = g;
      },
      grantFreeSpins: function (n, bet) {
        state.inFree = true;
        state.freeSpins = n;
        state.freeBet = bet || state.bet;
        state.freeTotalWin = 0;
        stopAuto();
        paintHud();
      },
      setAuto: function (n) {
        state.autoLeft = n;
        if (el.auto) el.auto.value = String(n);
      },
      setFast: function (on) {
        animFast = !!on;
      },
      stopPending: function () {
        stopAuto();
        clearAutoTimer();
      },
      ensureAudio: ensureAudio,
      getAudioState: function () {
        return audioCtx ? audioCtx.state : "none";
      },
      getSoundFired: function () {
        return soundFired.slice();
      },
      getSoundErrors: function () {
        return soundErrors.slice();
      },
      clearSoundLog: function () {
        soundFired = [];
        soundErrors = [];
      },
      isSoundOn: function () {
        return !!state.sound;
      },
      isBonusOpen: function () {
        return !!state.bonusOpen;
      },
      getFreeSpins: function () {
        return { inFree: !!state.inFree, left: state.freeSpins };
      },
      /** Force a bonus-triggering grid on the next spin. */
      forceBonusSpin: function () {
        var g = [];
        for (var c = 0; c < COLS; c++) {
          g[c] = [];
          for (var r = 0; r < ROWS; r++) g[c][r] = state.regular[0].id;
        }
        g[0][1] = "bonus";
        g[2][1] = "bonus";
        g[4][1] = "bonus";
        state.forceGrid = g;
      },
      forceLink: function () {
        var g = [];
        var n = 0;
        for (var c = 0; c < COLS; c++) {
          g[c] = [];
          for (var r = 0; r < ROWS; r++) {
            if (n < 6) {
              g[c][r] = "scatter";
              n++;
            } else {
              g[c][r] = state.regular[0].id;
            }
          }
        }
        state.forceGrid = g;
      },
      isLinkActive: function () {
        return !!state.linkActive;
      },
      getLink: function () {
        return state.link
          ? {
              respins: state.link.respins,
              locked: countLocked(state.link.cells),
              displayTotal: state.link.displayTotal,
              total: state.link.total,
              grand: !!state.link.grand,
            }
          : null;
      },
      skipLinkWait: function () {
        state.linkSkipWait = true;
      },
      pickBonusCards: function (n) {
        n = n || 3;
        var cards = document.querySelectorAll(".sl-bonus-card:not(.revealed)");
        for (var i = 0; i < n && i < cards.length; i++) cards[i].click();
      },
      startBonusFreeSpins: function () {
        if (el.bonusStart) el.bonusStart.click();
      },
    },
  };

  function checkSlotsDebug() {
    try {
      var q = new URLSearchParams(location.search || "");
      var flag = (q.get("slotsdebug") || "") + (location.hash || "");
      if (/bonus/i.test(flag)) {
        onShow();
        loadSymbols().then(function (pack) {
          if (!state.symbols) {
            state.regular = pack.regular;
            state.symbols = pack.map;
          }
          window.Slots.__test.setFast(true);
          window.Slots.__test.forceBonusSpin();
          setTimeout(function () {
            if (!state.spinning && !state.bonusOpen && !state.linkActive) spin();
          }, 300);
        });
      } else if (/link/i.test(flag)) {
        onShow();
        loadSymbols().then(function (pack) {
          if (!state.symbols) {
            state.regular = pack.regular;
            state.symbols = pack.map;
          }
          window.Slots.__test.setFast(true);
          window.Slots.__test.forceLink();
          setTimeout(function () {
            if (!state.spinning && !state.bonusOpen && !state.linkActive) spin();
          }, 300);
        });
      }
    } catch (e) {}
  }
})();
