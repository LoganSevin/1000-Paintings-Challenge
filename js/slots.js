/**
 * Slots — free play-credit painting reels. No real money.
 */
(function () {
  "use strict";

  var CREDITS_KEY = "slotsPlayCredits.v1";
  var SOUND_KEY = "slotsSoundOn.v1";
  var BET_KEY = "slotsBet.v1";
  var START_CREDITS = 100;
  var REEL_COUNT = 3;
  var CELL = 120; // px, synced with CSS reel height roughly via transform
  var FALLBACK = [
    { id: "star", label: "Star", emoji: "★", weight: 8, three: 40, two: 4 },
    { id: "moon", label: "Moon", emoji: "☾", weight: 10, three: 25, two: 3 },
    { id: "sun", label: "Sun", emoji: "☀", weight: 12, three: 18, two: 2 },
    { id: "gem", label: "Gem", emoji: "◆", weight: 14, three: 12, two: 2 },
    { id: "leaf", label: "Leaf", emoji: "❧", weight: 16, three: 8, two: 1 },
    { id: "ring", label: "Ring", emoji: "◎", weight: 18, three: 5, two: 1 },
  ];

  // Fixed painting picks (rarer first). Weights: lower = rarer.
  var PAINTING_PICKS = [
    { number: 1, weight: 4, three: 50, two: 5 },
    { number: 7, weight: 6, three: 35, two: 4 },
    { number: 42, weight: 8, three: 28, two: 3 },
    { number: 100, weight: 10, three: 20, two: 3 },
    { number: 250, weight: 12, three: 14, two: 2 },
    { number: 500, weight: 14, three: 10, two: 2 },
    { number: 777, weight: 16, three: 7, two: 1 },
    { number: 999, weight: 18, three: 5, two: 1 },
  ];

  var state = {
    credits: START_CREDITS,
    bet: 1,
    spinning: false,
    sound: false,
    symbols: null,
    results: [0, 0, 0],
    started: false,
  };

  var el = {};
  var strips = [];
  var audioCtx = null;

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

  function loadCredits() {
    var raw = recall(CREDITS_KEY);
    var n = parseInt(raw, 10);
    if (!isFinite(n) || n < 0) n = START_CREDITS;
    state.credits = n;
  }

  function saveCredits() {
    store(CREDITS_KEY, String(state.credits));
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
      g.gain.value = 0.04;
      o.connect(g);
      g.connect(audioCtx.destination);
      o.start();
      g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
      o.stop(audioCtx.currentTime + dur);
    } catch (e) {}
  }

  function weightedIndex(syms) {
    var total = 0;
    for (var i = 0; i < syms.length; i++) total += syms[i].weight || 1;
    var r = Math.random() * total;
    for (var j = 0; j < syms.length; j++) {
      r -= syms[j].weight || 1;
      if (r <= 0) return j;
    }
    return syms.length - 1;
  }

  function buildFallbackSymbols() {
    return FALLBACK.map(function (s) {
      return {
        id: s.id,
        label: s.label,
        weight: s.weight,
        three: s.three,
        two: s.two,
        emoji: s.emoji,
        url: "",
      };
    });
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
            var out = [];
            PAINTING_PICKS.forEach(function (pick) {
              var row = byNum[pick.number];
              var name = (row && row.filename) || pick.number + ".jpg";
              var a = (analyses && analyses[String(pick.number)]) || {};
              out.push({
                id: "p" + pick.number,
                label: a.title || "#" + pick.number,
                weight: pick.weight,
                three: pick.three,
                two: pick.two,
                url: "paintings/" + name,
                number: pick.number,
              });
            });
            if (out.length < 4) throw new Error("few");
            return out;
          });
      })
      .catch(function () {
        return buildFallbackSymbols();
      });
  }

  function cellH() {
    var reel = el.reels && el.reels.querySelector(".sl-reel");
    return (reel && reel.clientHeight) || 120;
  }

  function symHtml(sym) {
    if (sym.url) {
      return (
        '<img src="' +
        esc(sym.url) +
        '" alt="' +
        esc(sym.label) +
        '" loading="lazy" decoding="async" width="96" height="96" />'
      );
    }
    return (
      '<span class="sl-sym-fallback" title="' +
      esc(sym.label) +
      '">' +
      esc(sym.emoji || "?") +
      "</span>"
    );
  }

  function buildStrip(reelEl, loops) {
    var syms = state.symbols;
    var h = cellH();
    var html = "";
    var n = syms.length * (loops || 8);
    for (var i = 0; i < n; i++) {
      var sym = syms[i % syms.length];
      html += '<div class="sl-sym" style="height:' + h + 'px">' + symHtml(sym) + "</div>";
    }
    var strip = document.createElement("div");
    strip.className = "sl-strip";
    strip.innerHTML = html;
    strip.style.transform = "translateY(0)";
    reelEl.innerHTML = "";
    reelEl.appendChild(strip);
    return strip;
  }

  function renderReels() {
    if (!el.reels || !state.symbols) return;
    el.reels.innerHTML = "";
    strips = [];
    for (var i = 0; i < REEL_COUNT; i++) {
      var reel = document.createElement("div");
      reel.className = "sl-reel";
      reel.setAttribute("data-reel", String(i));
      el.reels.appendChild(reel);
      strips.push(buildStrip(reel, 10));
      // show a random resting face
      var idx = weightedIndex(state.symbols);
      state.results[i] = idx;
      var h = cellH();
      strips[i].style.transition = "none";
      strips[i].style.transform = "translateY(" + -(idx * h) + "px)";
    }
  }

  function renderPaytable() {
    if (!el.payRows || !state.symbols) return;
    var rows = state.symbols
      .slice()
      .sort(function (a, b) {
        return b.three - a.three;
      })
      .map(function (s) {
        return (
          '<div class="sl-pay-row"><span>3× ' +
          esc(s.label) +
          '</span><strong>×' +
          s.three +
          "</strong></div>" +
          '<div class="sl-pay-row"><span>2× ' +
          esc(s.label) +
          '</span><strong>×' +
          s.two +
          "</strong></div>"
        );
      })
      .join("");
    el.payRows.innerHTML =
      rows +
      '<div class="sl-pay-row"><span>Payout = multiplier × bet</span><strong></strong></div>';

    if (el.symLegend) {
      el.symLegend.innerHTML = state.symbols
        .map(function (s) {
          return (
            "<figure>" +
            symHtml(s) +
            "<figcaption>" +
            esc(s.label.length > 10 ? s.label.slice(0, 9) + "…" : s.label) +
            "</figcaption></figure>"
          );
        })
        .join("");
    }
  }

  function paintHud() {
    if (el.credits) el.credits.textContent = String(state.credits);
    if (el.refill) el.refill.hidden = state.credits > 0;
    if (el.spin) {
      el.spin.disabled = state.spinning || state.credits < state.bet;
    }
    document.querySelectorAll(".sl-bet").forEach(function (btn) {
      var v = parseInt(btn.getAttribute("data-bet"), 10);
      btn.classList.toggle("active", v === state.bet);
      btn.disabled = state.spinning;
    });
    if (el.sound) el.sound.classList.toggle("active", state.sound);
  }

  function setMsg(text, kind) {
    if (!el.msg) return;
    el.msg.textContent = text || "";
    el.msg.className = "sl-msg" + (kind === "win" ? " is-win" : kind === "err" ? " is-err" : "");
  }

  function setLast(text, win) {
    if (!el.last) return;
    el.last.textContent = text || "";
    el.last.classList.toggle("is-win", !!win);
  }

  function score(results) {
    var syms = state.symbols;
    var a = results[0];
    var b = results[1];
    var c = results[2];
    if (a === b && b === c) {
      return { mult: syms[a].three, kind: "three", sym: syms[a] };
    }
    // best pair
    var best = 0;
    var pairSym = null;
    if (a === b && syms[a].two > best) {
      best = syms[a].two;
      pairSym = syms[a];
    }
    if (b === c && syms[b].two > best) {
      best = syms[b].two;
      pairSym = syms[b];
    }
    if (a === c && syms[a].two > best) {
      best = syms[a].two;
      pairSym = syms[a];
    }
    if (best > 0) return { mult: best, kind: "two", sym: pairSym };
    return { mult: 0, kind: "none", sym: null };
  }

  function animateReel(strip, targetIdx, delayMs, durationMs) {
    return new Promise(function (resolve) {
      var h = cellH();
      var symN = state.symbols.length;
      var loops = 6 + Math.floor(Math.random() * 3);
      // land on targetIdx after extra full loops
      var finalOffset = (loops * symN + targetIdx) * h;
      strip.style.transition = "none";
      strip.style.transform = "translateY(0px)";
      // force reflow
      void strip.offsetHeight;
      setTimeout(function () {
        strip.style.transition =
          "transform " + durationMs + "ms cubic-bezier(0.12, 0.75, 0.12, 1)";
        strip.style.transform = "translateY(" + -finalOffset + "px)";
        beep(220 + delayMs / 5, 0.05, "triangle");
        setTimeout(function () {
          // normalize strip position without jump: rebuild short strip at rest
          resolve();
        }, durationMs + 30);
      }, delayMs);
    });
  }

  function settleReels() {
    var h = cellH();
    for (var i = 0; i < REEL_COUNT; i++) {
      var reel = el.reels.children[i];
      if (!reel) continue;
      strips[i] = buildStrip(reel, 4);
      strips[i].style.transition = "none";
      strips[i].style.transform = "translateY(" + -(state.results[i] * h) + "px)";
    }
  }

  function highlightWinners(kind) {
    document.querySelectorAll(".sl-reel").forEach(function (r) {
      r.classList.remove("is-winner");
    });
    if (kind === "three") {
      document.querySelectorAll(".sl-reel").forEach(function (r) {
        r.classList.add("is-winner");
      });
    } else if (kind === "two") {
      var res = state.results;
      var pairs = [];
      if (res[0] === res[1]) pairs = [0, 1];
      else if (res[1] === res[2]) pairs = [1, 2];
      else if (res[0] === res[2]) pairs = [0, 2];
      pairs.forEach(function (i) {
        var r = el.reels.children[i];
        if (r) r.classList.add("is-winner");
      });
    }
  }

  function spin() {
    if (state.spinning) return;
    if (state.credits < state.bet) {
      setMsg("Not enough play credits — tap Refill.", "err");
      paintHud();
      return;
    }
    state.spinning = true;
    state.credits -= state.bet;
    saveCredits();
    paintHud();
    setMsg("Spinning…", "");
    setLast("");
    highlightWinners("none");
    beep(180, 0.06, "sawtooth");

    var targets = [];
    for (var i = 0; i < REEL_COUNT; i++) {
      targets.push(weightedIndex(state.symbols));
    }
    state.results = targets;

    // rebuild long strips for animation
    for (var r = 0; r < REEL_COUNT; r++) {
      var reel = el.reels.children[r];
      strips[r] = buildStrip(reel, 12);
    }

    var jobs = [];
    for (var j = 0; j < REEL_COUNT; j++) {
      jobs.push(animateReel(strips[j], targets[j], j * 280, 1600 + j * 420));
    }

    Promise.all(jobs).then(function () {
      settleReels();
      var result = score(targets);
      var win = result.mult * state.bet;
      if (win > 0) {
        state.credits += win;
        saveCredits();
        highlightWinners(result.kind);
        var label =
          (result.kind === "three" ? "3× " : "2× ") +
          (result.sym && result.sym.label ? result.sym.label : "match");
        setLast("+" + win + "  (" + label + ")", true);
        setMsg("You won " + win + " play credits!", "win");
        beep(520, 0.12, "square");
        setTimeout(function () {
          beep(660, 0.14, "square");
        }, 90);
      } else {
        setLast("No win", false);
        setMsg("Try again — just for fun.", "");
        beep(110, 0.08, "triangle");
      }
      state.spinning = false;
      paintHud();
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
    el.spin = $("sl-spin");
    el.refill = $("sl-refill");
    el.sound = $("sl-sound");
    el.payRows = $("sl-pay-rows");
    el.symLegend = $("sl-symbols");
    el.msg = $("sl-msg");
  }

  function bind() {
    if (!el.panel) return;
    document.querySelectorAll(".sl-bet").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (state.spinning) return;
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
    window.addEventListener("keydown", function (e) {
      if (e.code !== "Space" && e.key !== " ") return;
      if (document.body.getAttribute("data-active-tab") !== "slots") return;
      if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
      e.preventDefault();
      spin();
    });
    window.addEventListener("slots-show", onShow);
    window.addEventListener("slots-hide", function () {});
    window.addEventListener("tab-changed", function (e) {
      if (e.detail && e.detail.tab === "slots") onShow();
    });
    window.addEventListener("resize", function () {
      if (!state.started || state.spinning) return;
      settleReels();
    });
  }

  function onShow() {
    if (!state.started) {
      state.started = true;
      loadCredits();
      loadPrefs();
      paintHud();
      loadSymbols().then(function (syms) {
        state.symbols = syms;
        renderReels();
        renderPaytable();
        paintHud();
      });
    } else {
      paintHud();
      settleReels();
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
