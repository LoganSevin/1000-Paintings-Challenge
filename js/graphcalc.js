/**
 * Graphing Calculator — Desmos-style multi-expression grapher.
 * y=f(x), x=f(y), polar, parametric, points, lists, piecewise, sliders,
 * variable assignments, actions (a -> a+1), and a ticker.
 */
(function () {
  "use strict";

  var COLORS = [
    "#2d70b3",
    "#c74440",
    "#388c46",
    "#6042a6",
    "#fa7e19",
    "#111111",
    "#00a2c7",
    "#c7448a",
    "#5a6a3a",
    "#8b5a2b",
  ];

  var SUB_MAP = {
    "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4",
    "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9",
  };
  var TO_SUB = {
    "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄",
    "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
  };
  var FROM_SUB = {
    "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4",
    "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9",
  };
  var TO_SUP = {
    "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴",
    "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
    "+": "⁺", "-": "⁻", "n": "ⁿ",
  };
  var FROM_SUP = {
    "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4",
    "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9",
    "⁺": "+", "⁻": "-", "ⁿ": "n",
  };

  /** a_1 / a_12 → a₁ / a₁₂ for labels (internal id stays a_1). */
  function prettyVar(name) {
    var s = String(name || "");
    return s.replace(/_(\d+)/g, function (_, digits) {
      return digits
        .split("")
        .map(function (d) {
          return TO_SUB[d] || d;
        })
        .join("");
    });
  }

  /** Show powers as superscripts in the editor: x^2 → x², x^{10} → x¹⁰ */
  function prettyPowers(text) {
    var s = String(text || "");
    s = s.replace(/\^\{([^}]+)\}/g, function (_, inner) {
      return String(inner)
        .split("")
        .map(function (ch) {
          return TO_SUP[ch] != null ? TO_SUP[ch] : ch;
        })
        .join("");
    });
    s = s.replace(/\^(-?\d+)/g, function (_, digits) {
      return String(digits)
        .split("")
        .map(function (ch) {
          return TO_SUP[ch] != null ? TO_SUP[ch] : ch;
        })
        .join("");
    });
    return s;
  }

  /** Build integer/float range list [start...end] or [start, next...end] (step). */
  function buildRangeList(start, end, stepHint) {
    if (!isFinite(start) || !isFinite(end)) return [];
    var step;
    if (stepHint != null && isFinite(stepHint) && stepHint !== 0) {
      step = stepHint;
    } else {
      step = start <= end ? 1 : -1;
    }
    // If step points the wrong way, flip
    if ((end - start) * step < 0) step = -step;
    var out = [];
    var guard = 0;
    if (step > 0) {
      for (var n = start; n <= end + Math.abs(step) * 1e-9 && guard < 10000; n += step) {
        out.push(Math.round(n * 1e10) / 1e10);
        guard++;
      }
    } else {
      for (var m = start; m >= end - Math.abs(step) * 1e-9 && guard < 10000; m += step) {
        out.push(Math.round(m * 1e10) / 1e10);
        guard++;
      }
    }
    return out;
  }

  /** Cartesian product of list values for lattice: for x=A, y=B → all (xi,yj). */
  function cartesianLists(lists) {
    // lists: [{name, values:[]}, ...]
    if (!lists.length) return [{}];
    var acc = [{}];
    lists.forEach(function (L) {
      var next = [];
      acc.forEach(function (env) {
        (L.values || []).forEach(function (val) {
          var e = {};
          Object.keys(env).forEach(function (k) {
            e[k] = env[k];
          });
          e[L.name] = val;
          next.push(e);
        });
      });
      acc = next;
    });
    return acc;
  }

  function isListValue(v) {
    return Array.isArray(v);
  }

  function isPointPair(v) {
    return (
      Array.isArray(v) &&
      v.length >= 2 &&
      typeof v[0] === "number" &&
      typeof v[1] === "number" &&
      isFinite(v[0]) &&
      isFinite(v[1])
    );
  }

  /**
   * Desmos-style list broadcast into points:
   * (L, 0) → (L_i, 0) for each i
   * (0, L) → (0, L_i)
   * (A, B) → zip pairs (A_i, B_i) when both lists
   * numbers stay single points
   */
  function broadcastPoints(xVal, yVal) {
    var xList = isListValue(xVal);
    var yList = isListValue(yVal);
    var out = [];
    var i;
    if (!xList && !yList) {
      if (typeof xVal === "number" && typeof yVal === "number" && isFinite(xVal) && isFinite(yVal)) {
        out.push([xVal, yVal]);
      }
      return out;
    }
    if (xList && !yList) {
      if (typeof yVal !== "number" || !isFinite(yVal)) return out;
      for (i = 0; i < xVal.length; i++) {
        if (typeof xVal[i] === "number" && isFinite(xVal[i])) out.push([xVal[i], yVal]);
      }
      return out;
    }
    if (!xList && yList) {
      if (typeof xVal !== "number" || !isFinite(xVal)) return out;
      for (i = 0; i < yVal.length; i++) {
        if (typeof yVal[i] === "number" && isFinite(yVal[i])) out.push([xVal, yVal[i]]);
      }
      return out;
    }
    // both lists → zip (not cartesian; use "for" for lattice)
    var n = Math.min(xVal.length, yVal.length);
    for (i = 0; i < n; i++) {
      if (
        typeof xVal[i] === "number" &&
        typeof yVal[i] === "number" &&
        isFinite(xVal[i]) &&
        isFinite(yVal[i])
      ) {
        out.push([xVal[i], yVal[i]]);
      }
    }
    return out;
  }

  function listIsOnlyNumbers(list) {
    if (!isListValue(list) || !list.length) return false;
    return list.every(function (item) {
      return typeof item === "number" && isFinite(item);
    });
  }

  function listHasPointPairs(list) {
    if (!isListValue(list)) return false;
    return list.some(function (item) {
      return isPointPair(item) || (isListValue(item) && item.length >= 2);
    });
  }

  /**
   * Graph only lists of points [(x,y), …].
   * Bare number lists [1,2,3] do NOT plot — use (L,0) or (0,L) instead.
   */
  function drawListValue(ctx, w, h, color, list) {
    if (!isListValue(list) || !list.length) return;
    if (listIsOnlyNumbers(list)) return;
    var pts = [];
    list.forEach(function (item) {
      if (isPointPair(item)) {
        drawDot(ctx, w, h, color, item[0], item[1]);
        pts.push({ x: item[0], y: item[1] });
      } else if (isListValue(item) && item.length >= 2) {
        var x2 = +item[0];
        var y2 = +item[1];
        if (isFinite(x2) && isFinite(y2)) {
          drawDot(ctx, w, h, color, x2, y2);
          pts.push({ x: x2, y: y2 });
        }
      }
    });
    if (pts.length >= 2) drawPolyline(ctx, w, h, color, pts);
  }

  function drawListForRow(ctx, w, h, row, list) {
    drawListValue(ctx, w, h, rowStyle(row), list);
  }

  function drawBroadcastPoints(ctx, w, h, color, xVal, yVal) {
    var pairs = broadcastPoints(xVal, yVal);
    pairs.forEach(function (p) {
      drawDot(ctx, w, h, color, p[0], p[1]);
    });
  }

  var BUILTINS = {
    sin: Math.sin,
    cos: Math.cos,
    tan: Math.tan,
    asin: Math.asin,
    acos: Math.acos,
    atan: Math.atan,
    arctan: Math.atan,
    arcsin: Math.asin,
    arccos: Math.acos,
    atan2: Math.atan2,
    sinh: Math.sinh || function (x) { return (Math.exp(x) - Math.exp(-x)) / 2; },
    cosh: Math.cosh || function (x) { return (Math.exp(x) + Math.exp(-x)) / 2; },
    tanh: Math.tanh || function (x) {
      var e2 = Math.exp(2 * x);
      return (e2 - 1) / (e2 + 1);
    },
    exp: Math.exp,
    ln: Math.log,
    log: Math.log,
    log10: Math.log10 || function (x) { return Math.log(x) / Math.LN10; },
    log2: Math.log2 || function (x) { return Math.log(x) / Math.LN2; },
    sqrt: Math.sqrt,
    cbrt: Math.cbrt || function (x) { return Math.pow(x, 1 / 3); },
    abs: Math.abs,
    floor: Math.floor,
    ceil: Math.ceil,
    round: Math.round,
    trunc: Math.trunc || function (x) { return x < 0 ? Math.ceil(x) : Math.floor(x); },
    sign: Math.sign || function (x) { return x > 0 ? 1 : x < 0 ? -1 : 0; },
    min: Math.min,
    max: Math.max,
    pow: Math.pow,
    hypot: Math.hypot || function (a, b) { return Math.sqrt(a * a + b * b); },
    mod: function (a, b) { return a % b; },
    total: function () {
      var s = 0;
      for (var i = 0; i < arguments.length; i++) s += arguments[i];
      return s;
    },
    mean: function () {
      if (!arguments.length) return NaN;
      var s = 0;
      for (var i = 0; i < arguments.length; i++) s += arguments[i];
      return s / arguments.length;
    },
    length: function (list) {
      return Array.isArray(list) ? list.length : NaN;
    },
  };

  var CONSTANTS = { pi: Math.PI, e: Math.E, tau: Math.PI * 2 };
  var AXIS_VARS = { x: 1, y: 1, t: 1, r: 1, theta: 1, i: 1, n: 1 };

  var state = {
    exprs: [],
    view: { xmin: -10, xmax: 10, ymin: -10, ymax: 10 },
    /** name -> { value, min, max, step } */
    params: {},
    /** plain assigned constants a = 5 (no free x/y) */
    assigns: {},
    angleMode: "rad",
    grid: true,
    focusId: null,
    nextId: 1,
    colorIdx: 0,
    ticker: { on: false, ms: 50, handle: null, steps: 0 },
  };

  var drag = null;
  var raf = 0;
  var bound = false;

  function $(id) {
    return document.getElementById(id);
  }

  function uid() {
    return "e" + state.nextId++;
  }

  function nextColor() {
    var c = COLORS[state.colorIdx % COLORS.length];
    state.colorIdx++;
    return c;
  }

  /** #rrggbb + alpha 0–1 → rgba(...) for canvas stroke/fill */
  function colorWithAlpha(hex, alpha) {
    var h = String(hex || "#2d70b3").replace(/^#/, "");
    if (h.length === 3) {
      h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
    }
    if (h.length !== 6) h = "2d70b3";
    var r = parseInt(h.slice(0, 2), 16);
    var g = parseInt(h.slice(2, 4), 16);
    var b = parseInt(h.slice(4, 6), 16);
    var a = alpha != null && isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 1;
    return "rgba(" + r + "," + g + "," + b + "," + a + ")";
  }

  function rowStyle(row, fillBoost) {
    var op = row && row.opacity != null && isFinite(row.opacity) ? row.opacity : 1;
    if (fillBoost != null) op = op * fillBoost;
    return colorWithAlpha((row && row.color) || "#2d70b3", op);
  }

  function clampOpacity(v) {
    var n = parseFloat(v);
    if (!isFinite(n)) return 1;
    if (n > 1 && n <= 100) n = n / 100;
    return Math.max(0, Math.min(1, n));
  }

  function normalizeHex(hex) {
    var h = String(hex || "#2d70b3").trim();
    if (h.charAt(0) !== "#") h = "#" + h;
    if (/^#[0-9a-fA-F]{3}$/.test(h)) {
      h =
        "#" +
        h.charAt(1) +
        h.charAt(1) +
        h.charAt(2) +
        h.charAt(2) +
        h.charAt(3) +
        h.charAt(3);
    }
    if (!/^#[0-9a-fA-F]{6}$/.test(h)) return "#2d70b3";
    return h.toLowerCase();
  }

  function unique(arr) {
    var o = {};
    (arr || []).forEach(function (x) {
      if (x) o[x] = 1;
    });
    return Object.keys(o);
  }

  function degToRad(x) {
    return (x * Math.PI) / 180;
  }

  function wrapTrig(fn) {
    return function (x) {
      return fn(state.angleMode === "deg" ? degToRad(x) : x);
    };
  }

  function wrapInvTrig(fn) {
    return function (x) {
      var v = fn(x);
      return state.angleMode === "deg" ? (v * 180) / Math.PI : v;
    };
  }

  /* —— Normalize user text —— */
  function normalizeSource(src) {
    var s = String(src || "");
    // Desmos / LaTeX wrappers from copy-paste
    s = s.replace(/\\left/gi, "");
    s = s.replace(/\\right/gi, "");
    s = s.replace(/\\bigl/gi, "");
    s = s.replace(/\\bigr/gi, "");
    s = s.replace(/\\Bigl/gi, "");
    s = s.replace(/\\Bigr/gi, "");
    s = s.replace(/\\,/g, " ");
    s = s.replace(/\\;/g, " ");
    s = s.replace(/\\ /g, " ");
    s = s.replace(/\\quad/gi, " ");
    s = s.replace(/\\cdot/gi, "*");
    s = s.replace(/\\times/gi, "*");
    s = s.replace(/\\div/gi, "/");
    s = s.replace(/\\pi/gi, "pi");
    s = s.replace(/\\theta/gi, "theta");
    // unicode subscripts → _digit
    s = s.replace(/[₀₁₂₃₄₅₆₇₈₉]/g, function (ch) {
      return "_" + (FROM_SUB[ch] || SUB_MAP[ch] || "");
    });
    // unicode superscripts → ^digits (so x² parses as power)
    s = s.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻ⁿ]+/g, function (run) {
      var body = run
        .split("")
        .map(function (ch) {
          return FROM_SUP[ch] != null ? FROM_SUP[ch] : "";
        })
        .join("");
      return "^" + body;
    });
    s = s.replace(/π/g, "pi");
    s = s.replace(/θ/g, "theta");
    s = s.replace(/·|×/g, "*");
    s = s.replace(/÷/g, "/");
    s = s.replace(/−|\u2212/g, "-");
    s = s.replace(/≤/g, "<=");
    s = s.replace(/≥/g, ">=");
    s = s.replace(/≠/g, "!=");
    s = s.replace(/→/g, "->");
    s = s.replace(/\*\*/g, "^");
    // ellipsis variants
    s = s.replace(/…/g, "...");
    s = s.replace(/\.\.\./g, "...");
    // a_{12} or a_{1} → a_12
    s = s.replace(/_\{([^}]+)\}/g, function (_, inner) {
      return "_" + String(inner).replace(/\s+/g, "");
    });
    // collapse whitespace
    s = s.replace(/\s+/g, " ").trim();
    return s;
  }

  /**
   * Split a Desmos multi-curve paste into individual (x(t), y(t)) expressions.
   * Handles: \left(...\right)\left(...\right) and newline-separated curves.
   */
  function splitDesmosPaste(raw) {
    var s = String(raw || "");
    if (!s.trim()) return [];
    // Normalize LaTeX joiners into separators
    s = s.replace(/\\right\s*\)\s*\\left\s*\(/gi, ")\n(");
    s = s.replace(/\\right\s*\\left/gi, "\n");
    s = s.replace(/\\left/gi, "");
    s = s.replace(/\\right/gi, "");
    // )( with optional whitespace → separate curves
    s = s.replace(/\)\s*\(/g, ")\n(");
    // Also split on newlines
    var chunks = s.split(/\r?\n|;/);
    var out = [];
    chunks.forEach(function (chunk) {
      var t = chunk.trim();
      if (!t) return;
      // strip leftover latex
      t = normalizeSource(t);
      if (!t) return;
      // ensure outer parens for bare pairs
      out.push(t);
    });
    // If still one giant chunk with multiple top-level pairs, scan balanced parens
    if (out.length === 1 && (out[0].match(/^\(/g) || []).length < 2) {
      // try balanced split of consecutive (...) (...)
      var big = out[0];
      var parts = [];
      var i = 0;
      while (i < big.length) {
        while (i < big.length && /\s/.test(big.charAt(i))) i++;
        if (i >= big.length) break;
        if (big.charAt(i) !== "(") {
          // not a list of curves — single expression
          return out;
        }
        var depth = 0;
        var start = i;
        for (; i < big.length; i++) {
          var ch = big.charAt(i);
          if (ch === "(") depth++;
          else if (ch === ")") {
            depth--;
            if (depth === 0) {
              i++;
              parts.push(big.slice(start, i).trim());
              break;
            }
          }
        }
        if (depth !== 0) break;
      }
      if (parts.length > 1) return parts.map(function (p) {
        return normalizeSource(p);
      });
    }
    return out;
  }

  /** Split (xExpr, yExpr) on the top-level comma only. */
  function splitTopLevelPair(src) {
    var s = String(src || "").trim();
    if (s.charAt(0) === "(" && s.charAt(s.length - 1) === ")") {
      s = s.slice(1, -1).trim();
    }
    var depth = 0;
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      if (ch === "(" || ch === "[" || ch === "{") depth++;
      else if (ch === ")" || ch === "]" || ch === "}") depth--;
      else if (ch === "," && depth === 0) {
        return {
          xSrc: s.slice(0, i).trim(),
          ySrc: s.slice(i + 1).trim(),
        };
      }
    }
    return null;
  }

  function looksLikeBezierParametric(text) {
    var s = String(text || "");
    return (
      /\bt\b/.test(s) &&
      (/\(1\s*-\s*t\)/.test(s) ||
        /\(1-t\)/.test(s) ||
        (s.indexOf("t^3") >= 0 && s.indexOf("t^2") >= 0))
    );
  }

  /* —— Tokenizer —— */
  function tokenize(src) {
    var s = normalizeSource(src);
    var tokens = [];
    var i = 0;

    function pushOp(v) {
      tokens.push({ t: "op", v: v });
    }

    while (i < s.length) {
      var ch = s.charAt(i);
      if (/\s/.test(ch)) {
        i++;
        continue;
      }

      // multi-char ops
      if (ch === "-" && s.charAt(i + 1) === ">") {
        pushOp("->");
        i += 2;
        continue;
      }
      if (ch === "!" && s.charAt(i + 1) === "=") {
        pushOp("!=");
        i += 2;
        continue;
      }
      if ((ch === "<" || ch === ">") && s.charAt(i + 1) === "=") {
        pushOp(ch + "=");
        i += 2;
        continue;
      }
      if (ch === "." && s.charAt(i + 1) === "." && s.charAt(i + 2) === ".") {
        pushOp("...");
        i += 3;
        continue;
      }

      if (/[0-9.]/.test(ch) && !(ch === "." && !/[0-9]/.test(s.charAt(i + 1)))) {
        var j = i + 1;
        while (j < s.length && /[0-9.]/.test(s.charAt(j))) j++;
        // scientific notation 1e-3
        if ((s.charAt(j) === "e" || s.charAt(j) === "E") && /[+\-0-9]/.test(s.charAt(j + 1))) {
          j++;
          if (s.charAt(j) === "+" || s.charAt(j) === "-") j++;
          while (j < s.length && /[0-9]/.test(s.charAt(j))) j++;
        }
        var num = parseFloat(s.slice(i, j));
        if (!isFinite(num)) throw new Error("Bad number");
        tokens.push({ t: "num", v: num });
        i = j;
        // implicit mult: 5x, 2sin, 3(
        if (i < s.length && /[a-zA-Z_([]/.test(s.charAt(i))) {
          pushOp("*");
        }
        continue;
      }

      if (/[a-zA-Z_]/.test(ch)) {
        var k = i + 1;
        while (k < s.length && /[a-zA-Z_0-9]/.test(s.charAt(k))) k++;
        var id = s.slice(i, k).toLowerCase();
        tokens.push({ t: "id", v: id });
        i = k;
        // implicit mult: x(, pi(, a[  — but NOT if next is ( and id is a builtin function
        // (function calls handled in parser; here only )( style after id when next is id or number)
        if (i < s.length) {
          var nx = s.charAt(i);
          if (/[0-9]/.test(nx)) pushOp("*");
          else if (/[a-zA-Z_]/.test(nx)) pushOp("*");
          else if (nx === "(" && !BUILTINS[id] && id !== "piecewise") {
            // x(2) means x * (2) for non-functions
            pushOp("*");
          } else if (nx === "[") {
            pushOp("*");
          }
        }
        continue;
      }

      if (ch === ")" || ch === "]") {
        tokens.push({ t: "op", v: ch });
        i++;
        if (i < s.length && /[0-9a-zA-Z_([]/.test(s.charAt(i))) pushOp("*");
        continue;
      }

      if ("+-*/^(),=[]{}:<>!".indexOf(ch) >= 0) {
        pushOp(ch);
        i++;
        continue;
      }

      throw new Error("Unexpected character “" + ch + "”");
    }
    return tokens;
  }

  /* —— Compiler —— */
  function compileExpr(src, opts) {
    opts = opts || {};
    var tokens = tokenize(src);
    var pos = 0;
    var free = {};

    function peek() {
      return tokens[pos];
    }
    function take() {
      return tokens[pos++];
    }
    function expect(v) {
      var t = take();
      if (!t || t.v !== v) throw new Error("Expected “" + v + "”");
      return t;
    }

    function parsePrimary() {
      var t = peek();
      if (!t) throw new Error("Unexpected end of expression");

      if (t.t === "num") {
        take();
        return function () {
          return t.v;
        };
      }

      if (t.t === "id") {
        take();
        var name = t.v;

        // function call only for builtins / piecewise
        if (peek() && peek().v === "(" && (BUILTINS[name] || name === "piecewise")) {
          take();
          var args = [];
          if (!peek() || peek().v !== ")") {
            args.push(parseCmp());
            while (peek() && peek().v === ",") {
              take();
              args.push(parseCmp());
            }
          }
          expect(")");
          if (name === "piecewise") {
            return function (ctx) {
              for (var i = 0; i + 1 < args.length; i += 2) {
                if (args[i](ctx)) return args[i + 1](ctx);
              }
              if (args.length % 2 === 1) return args[args.length - 1](ctx);
              return NaN;
            };
          }
          var fn = BUILTINS[name];
          var wrapped =
            name === "sin" || name === "cos" || name === "tan"
              ? wrapTrig(fn)
              : name === "asin" ||
                  name === "acos" ||
                  name === "atan" ||
                  name === "arcsin" ||
                  name === "arccos" ||
                  name === "arctan"
                ? wrapInvTrig(fn)
                : fn;
          return function (ctx) {
            var vals = args.map(function (a) {
              return a(ctx);
            });
            var flat = [];
            vals.forEach(function (v) {
              if (Array.isArray(v)) flat = flat.concat(v);
              else flat.push(v);
            });
            if (name === "length") return wrapped(vals[0]);
            return wrapped.apply(null, flat);
          };
        }

        if (CONSTANTS[name] != null) {
          return function () {
            return CONSTANTS[name];
          };
        }

        // free parameter / assign / axis var — not free if already a stored list
        if (
          !AXIS_VARS[name] &&
          !BUILTINS[name] &&
          !isListValue(state.assigns[name])
        ) {
          free[name] = 1;
        }

        return function (ctx) {
          if (ctx && ctx[name] != null && (typeof ctx[name] === "number" || Array.isArray(ctx[name]))) {
            return ctx[name];
          }
          if (state.assigns[name] != null) return state.assigns[name];
          if (state.params[name] && isFinite(state.params[name].value)) {
            return state.params[name].value;
          }
          // missing axis var at runtime → NaN (not a hard error)
          return NaN;
        };
      }

      // list: [1,2,3] · [1...5] · [1,2...5] · [1,2,...,10] · [5,4...1]
      if (t.v === "[") {
        take();
        if (peek() && peek().v === "]") {
          take();
          return function () {
            return [];
          };
        }
        var parts = [];
        // collect sequence of expressions and optional "..." markers
        // forms:
        //   a ... b
        //   a , b ... c     (step = b-a)
        //   a , b , ... , c
        //   a , b , c
        parts.push(parseCmp());
        while (peek() && peek().v !== "]") {
          if (peek().v === "...") {
            take();
            // optional comma after ellipsis: [1,2,...,10]
            if (peek() && peek().v === ",") take();
            if (!peek() || peek().v === "]") {
              throw new Error("Ellipsis needs an end value (e.g. [1...5] or [1,2...10])");
            }
            var endFn = parseCmp();
            // optional trailing commas/items not allowed after range end for simplicity
            expect("]");
            return function (ctx) {
              var vals = parts.map(function (fn) {
                return fn(ctx);
              });
              var end = endFn(ctx);
              if (vals.length === 1) {
                return buildRangeList(vals[0], end, null);
              }
              // step from first two values
              var step = vals[1] - vals[0];
              return buildRangeList(vals[0], end, step);
            };
          }
          if (peek().v === ",") {
            take();
            // allow ", ..." without requiring another value before ellipsis
            if (peek() && peek().v === "...") continue;
            if (peek() && peek().v === "]") break;
            parts.push(parseCmp());
            continue;
          }
          throw new Error("Expected “,” or “...” in list");
        }
        expect("]");
        return function (ctx) {
          return parts.map(function (fn) {
            return fn(ctx);
          });
        };
      }

      // piecewise { cond: val, cond: val, default }
      if (t.v === "{") {
        take();
        var branches = [];
        var def = null;
        while (peek() && peek().v !== "}") {
          // try cond : val
          var save = pos;
          var left = parseCmp();
          if (peek() && peek().v === ":") {
            take();
            var right = parseCmp();
            branches.push({ cond: left, val: right });
          } else {
            // bare default expression
            pos = save;
            def = parseCmp();
          }
          if (peek() && peek().v === ",") take();
          else break;
        }
        expect("}");
        return function (ctx) {
          for (var bi = 0; bi < branches.length; bi++) {
            var c = branches[bi].cond(ctx);
            if (c) return branches[bi].val(ctx);
          }
          return def ? def(ctx) : NaN;
        };
      }

      if (t.v === "(") {
        take();
        // empty ()
        if (peek() && peek().v === ")") {
          take();
          return function () {
            return NaN;
          };
        }
        var inner = parseCmp();
        // point or parametric pair (a, b) as list of 2
        if (peek() && peek().v === ",") {
          take();
          var inner2 = parseCmp();
          // more?
          var rest = [inner, inner2];
          while (peek() && peek().v === ",") {
            take();
            rest.push(parseCmp());
          }
          expect(")");
          return function (ctx) {
            return rest.map(function (fn) {
              return fn(ctx);
            });
          };
        }
        expect(")");
        return inner;
      }

      if (t.v === "-") {
        take();
        var u = parsePow();
        return function (ctx) {
          var v = u(ctx);
          return typeof v === "number" ? -v : NaN;
        };
      }
      if (t.v === "+") {
        take();
        return parsePow();
      }

      throw new Error("Unexpected “" + (t.v || t.t) + "”");
    }

    function parsePow() {
      var left = parsePrimary();
      if (peek() && peek().v === "^") {
        take();
        var right = parsePow();
        return function (ctx) {
          return Math.pow(+left(ctx), +right(ctx));
        };
      }
      return left;
    }

    function parseMul() {
      var left = parsePow();
      while (peek() && (peek().v === "*" || peek().v === "/")) {
        var op = take().v;
        var right = parsePow();
        left = (function (L, R, o) {
          return function (ctx) {
            var a = L(ctx);
            var b = R(ctx);
            if (Array.isArray(a) || Array.isArray(b)) return NaN;
            return o === "*" ? a * b : a / b;
          };
        })(left, right, op);
      }
      return left;
    }

    function parseAdd() {
      var left = parseMul();
      while (peek() && (peek().v === "+" || peek().v === "-")) {
        var op = take().v;
        var right = parseMul();
        left = (function (L, R, o) {
          return function (ctx) {
            var a = L(ctx);
            var b = R(ctx);
            if (Array.isArray(a) || Array.isArray(b)) return NaN;
            return o === "+" ? a + b : a - b;
          };
        })(left, right, op);
      }
      return left;
    }

    function parseCmp() {
      var left = parseAdd();
      var t = peek();
      if (t && (t.v === "<" || t.v === ">" || t.v === "<=" || t.v === ">=" || t.v === "=" || t.v === "!=")) {
        var op = take().v;
        var right = parseAdd();
        return function (ctx) {
          var a = left(ctx);
          var b = right(ctx);
          if (op === "<") return a < b ? 1 : 0;
          if (op === ">") return a > b ? 1 : 0;
          if (op === "<=") return a <= b ? 1 : 0;
          if (op === ">=") return a >= b ? 1 : 0;
          if (op === "=") return Math.abs(a - b) < 1e-9 ? 1 : 0;
          if (op === "!=") return Math.abs(a - b) >= 1e-9 ? 1 : 0;
          return 0;
        };
      }
      return left;
    }

    if (!tokens.length) {
      return {
        fn: function () {
          return NaN;
        },
        free: [],
      };
    }

    var fn = parseCmp();
    if (pos < tokens.length && !opts.allowTrailing) {
      var trail = tokens[pos];
      throw new Error(
        "Unexpected trailing “" +
          (trail.v != null ? trail.v : trail.t) +
          "” — use * for multiply (e.g. 5*x) or check brackets"
      );
    }
    return { fn: fn, free: Object.keys(free) };
  }

  function safeEval(compiled, ctx) {
    if (!compiled || !compiled.fn) return NaN;
    try {
      var v = compiled.fn(ctx || {});
      if (typeof v === "number") return isFinite(v) ? v : NaN;
      return v; // lists / etc.
    } catch (e) {
      return NaN;
    }
  }

  function baseCtx(extra) {
    var c = {};
    Object.keys(state.assigns).forEach(function (k) {
      c[k] = state.assigns[k];
    });
    Object.keys(state.params).forEach(function (k) {
      c[k] = state.params[k].value;
    });
    if (extra) {
      Object.keys(extra).forEach(function (k) {
        c[k] = extra[k];
      });
    }
    return c;
  }

  /* —— Split "x=[1...5], y=[1...5]" generators on top-level commas —— */
  function splitTopLevelComma(src) {
    var s = String(src || "");
    var parts = [];
    var depth = 0;
    var start = 0;
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      if (ch === "(" || ch === "[" || ch === "{") depth++;
      else if (ch === ")" || ch === "]" || ch === "}") depth--;
      else if (ch === "," && depth === 0) {
        parts.push(s.slice(start, i).trim());
        start = i + 1;
      }
    }
    parts.push(s.slice(start).trim());
    return parts.filter(Boolean);
  }

  /** Parse "x = [1...5]" or "x=[1,2,3]" → {name, listSrc} */
  function parseGeneratorClause(clause) {
    var m = String(clause || "").match(
      /^([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.+)$/
    );
    if (!m) return null;
    return { name: m[1].toLowerCase(), listSrc: m[2].trim() };
  }

  /* —— Row kinds —— */
  function detectKind(raw) {
    var s = normalizeSource(String(raw || "")).trim();
    if (!s) return { kind: "empty" };

    // Action: a -> a+1 , a_1 → a_1+0.1  (arrow forms)
    var act = s.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*->\s*(.+)$/);
    if (act) {
      return { kind: "action", target: act[1].toLowerCase(), src: act[2] };
    }

    // Desmos-style: (x,y) for x=[1...5], y=[1...5]  → lattice of points
    var forIdx = s.toLowerCase().lastIndexOf(" for ");
    if (forIdx > 0) {
      var body = s.slice(0, forIdx).trim();
      var genSrc = s.slice(forIdx + 5).trim();
      if (body && genSrc) {
        return { kind: "for", body: body, gens: genSrc };
      }
    }

    // Bare list first so [1,2,3] / [1...5] is NEVER treated as something else
    if (s.charAt(0) === "[") {
      return { kind: "list", name: null, src: s };
    }

    // Assignment a = expr  (not y= / x= / r=)
    // L = [1,2,3]  → named list that still GRAPHS + is callable as L
    var asg = s.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.+)$/);
    if (asg) {
      var name = asg[1].toLowerCase();
      var rhs = String(asg[2] || "").trim();
      if (name !== "y" && name !== "x" && name !== "r") {
        if (rhs.charAt(0) === "[") {
          return { kind: "list", name: name, src: rhs };
        }
        // L = M  (copy / alias another list or expression)
        return { kind: "assign", name: name, src: rhs };
      }
    }

    // Piecewise as full expression for y
    if (s.charAt(0) === "{") {
      return { kind: "yfn", src: s };
    }

    // Parametric (f(t), g(t)) — Desmos / Bezier paste (top-level comma split)
    var pair = splitTopLevelPair(s);
    if (pair && /\bt\b/i.test(s) && !/\bfor\b/i.test(s)) {
      return {
        kind: "parametric",
        xSrc: pair.xSrc,
        ySrc: pair.ySrc,
        tMin: 0,
        tMax: 1,
        bezier: looksLikeBezierParametric(s),
      };
    }

    // Point (a,b) — no t (may still use lists L)
    if (pair && !/\bt\b/i.test(s) && !/\bfor\b/i.test(s)) {
      return { kind: "point", xSrc: pair.xSrc, ySrc: pair.ySrc };
    }

    // Parametric without outer parens: f(t), g(t)
    var para = s.match(/^([^,=]+)\s*,\s*([^,=]+)$/);
    if (para && /\bt\b/i.test(s) && s.indexOf("->") < 0) {
      return {
        kind: "parametric",
        xSrc: para[1],
        ySrc: para[2],
        tMin: 0,
        tMax: 1,
      };
    }

    var polar = s.match(/^r\s*=\s*(.+)$/i);
    if (polar) return { kind: "polar", src: polar[1] };

    var ineq = s.match(/^(y|x)\s*(<=|>=|<|>)\s*(.+)$/i);
    if (ineq) {
      return {
        kind: "inequality",
        axis: ineq[1].toLowerCase(),
        op: ineq[2],
        src: ineq[3],
      };
    }

    var xeq = s.match(/^x\s*=\s*(.+)$/i);
    if (xeq) {
      if (!/\by\b/i.test(xeq[1]) && !/\bt\b/i.test(xeq[1])) {
        return { kind: "vertical", src: xeq[1] };
      }
      return { kind: "xfn", src: xeq[1] };
    }

    var yeq = s.match(/^y\s*=\s*(.+)$/i);
    if (yeq) return { kind: "yfn", src: yeq[1] };

    return { kind: "yfn", src: s };
  }

  function compileRow(row) {
    row.error = "";
    row.compiled = null;
    row.free = [];
    row.kind = "empty";
    var det = detectKind(row.text);
    row.kind = det.kind;
    if (det.kind === "empty") return;

    try {
      if (det.kind === "action") {
        var rhs = compileExpr(det.src);
        row.compiled = { target: det.target, rhs: rhs };
        row.free = rhs.free.filter(function (v) {
          return v !== det.target;
        });
      } else if (det.kind === "assign") {
        var ae = compileExpr(det.src);
        row.compiled = { name: det.name, rhs: ae };
        row.free = ae.free.filter(function (v) {
          return v !== det.name;
        });
        // if no free axis vars, store as constant assign
        var needsAxis = ae.free.some(function (v) {
          return AXIS_VARS[v];
        });
        // free params only → still evaluate into assigns when possible
        if (!needsAxis) {
          var val = safeEval(ae, baseCtx({}));
          if (typeof val === "number" && isFinite(val)) {
            state.assigns[det.name] = val;
            // also as param so slider can override? keep as assign only
            if (state.params[det.name]) {
              state.params[det.name].value = val;
            }
          } else if (Array.isArray(val)) {
            state.assigns[det.name] = val;
          }
        }
      } else if (det.kind === "list") {
        var le = compileExpr(det.src);
        row.compiled = { list: le, name: det.name || null };
        row.free = le.free.filter(function (v) {
          return !isListValue(state.assigns[v]);
        });
        // Store named list so other expressions can use L, a_1, …
        if (det.name) {
          var listVal = safeEval(le, baseCtx({}));
          if (isListValue(listVal)) state.assigns[det.name] = listVal;
        }
      } else if (det.kind === "for") {
        // (x,y) for x=[1...5], y=[5...1]  → cartesian lattice of points
        var genParts = splitTopLevelComma(det.gens);
        var gens = [];
        var freeAll = [];
        genParts.forEach(function (clause) {
          var g = parseGeneratorClause(clause);
          if (!g) throw new Error("Bad generator (want x=[1...5])");
          var gList = compileExpr(g.listSrc);
          gens.push({ name: g.name, list: gList });
          freeAll = freeAll.concat(gList.free);
        });
        // Body: prefer (exprX, exprY) as a point template
        var bodySrc = det.body.trim();
        var bodyPoint = bodySrc.match(/^\(\s*(.+)\s*,\s*(.+)\s*\)$/);
        var bodyX = null;
        var bodyY = null;
        var bodyFn = null;
        if (bodyPoint) {
          bodyX = compileExpr(bodyPoint[1]);
          bodyY = compileExpr(bodyPoint[2]);
          freeAll = freeAll.concat(bodyX.free, bodyY.free);
        } else {
          bodyFn = compileExpr(bodySrc);
          freeAll = freeAll.concat(bodyFn.free);
        }
        // Generator names are bound, not free params
        var boundNames = {};
        gens.forEach(function (g) {
          boundNames[g.name] = 1;
        });
        freeAll = freeAll.filter(function (v) {
          return !boundNames[v] && !isListValue(state.assigns[v]);
        });
        row.compiled = {
          gens: gens,
          bodyX: bodyX,
          bodyY: bodyY,
          bodyFn: bodyFn,
        };
        row.free = unique(freeAll);
      } else if (det.kind === "point") {
        var cx = compileExpr(det.xSrc);
        var cy = compileExpr(det.ySrc);
        row.compiled = { x: cx, y: cy };
        row.free = unique(cx.free.concat(cy.free));
      } else if (det.kind === "parametric") {
        var px = compileExpr(det.xSrc);
        var py = compileExpr(det.ySrc);
        row.compiled = {
          x: px,
          y: py,
          tMin: det.tMin != null ? det.tMin : 0,
          tMax: det.tMax != null ? det.tMax : 1,
          bezier: !!det.bezier,
        };
        // t is the curve parameter, not a free slider
        row.free = unique(px.free.concat(py.free)).filter(function (v) {
          return v !== "t";
        });
      } else if (det.kind === "polar") {
        var pr = compileExpr(det.src);
        row.compiled = { r: pr };
        row.free = pr.free;
      } else if (det.kind === "inequality") {
        var pi = compileExpr(det.src);
        row.compiled = { f: pi, axis: det.axis, op: det.op };
        row.free = pi.free;
      } else {
        var p = compileExpr(det.src);
        row.compiled = { f: p };
        row.free = p.free;
      }
    } catch (e) {
      row.error = (e && e.message) || "Invalid expression";
      row.compiled = null;
    }
  }

  function recompileAll() {
    // Multi-pass so later lines can use L from earlier list assigns
    state.assigns = {};
    var pass;
    for (pass = 0; pass < 4; pass++) {
      state.exprs.forEach(function (row) {
        compileRow(row);
      });
    }
    ensureParams();
  }

  function ensureParams() {
    var needed = {};
    state.exprs.forEach(function (row) {
      (row.free || []).forEach(function (v) {
        // Never turn a named list into a numeric slider
        if (isListValue(state.assigns[v])) return;
        if (!AXIS_VARS[v] && !BUILTINS[v] && !CONSTANTS[v]) needed[v] = 1;
      });
      if (row.kind === "action" && row.compiled && row.compiled.target) {
        if (!isListValue(state.assigns[row.compiled.target])) {
          needed[row.compiled.target] = 1;
        }
      }
    });
    Object.keys(needed).forEach(function (v) {
      if (isListValue(state.assigns[v])) return;
      if (!state.params[v]) {
        var init = state.assigns[v];
        if (typeof init !== "number" || !isFinite(init)) init = 1;
        state.params[v] = {
          value: init,
          min: -10,
          max: 10,
          step: 0.01,
          /** independent of action ticker */
          playing: false,
          /** loop = min→max→min wrap · alternate = ping-pong */
          animMode: "alternate",
          animDir: 1,
          /** fraction of (max-min) advanced per anim tick */
          animSpeed: 0.02,
        };
        expandParamBounds(v, init);
      } else {
        // preserve animation flags on existing params
        if (state.params[v].playing == null) state.params[v].playing = false;
        if (!state.params[v].animMode) state.params[v].animMode = "alternate";
        if (state.params[v].animDir == null) state.params[v].animDir = 1;
        if (state.params[v].animSpeed == null) state.params[v].animSpeed = 0.02;
      }
    });
    Object.keys(state.params).forEach(function (v) {
      if (!needed[v] || isListValue(state.assigns[v])) delete state.params[v];
    });
  }

  /** Evaluate a for-comprehension into a list of points / values. */
  function evalForComprehension(compiled) {
    if (!compiled || !compiled.gens || !compiled.gens.length) return [];
    var gens = compiled.gens.map(function (g) {
      var vals = safeEval(g.list, baseCtx({}));
      if (!isListValue(vals)) vals = [];
      return { name: g.name, values: vals };
    });
    var envs = cartesianLists(gens);
    var out = [];
    envs.forEach(function (env) {
      var ctx = baseCtx(env);
      if (compiled.bodyX && compiled.bodyY) {
        var px = safeEval(compiled.bodyX, ctx);
        var py = safeEval(compiled.bodyY, ctx);
        if (typeof px === "number" && typeof py === "number" && isFinite(px) && isFinite(py)) {
          out.push([px, py]);
        }
      } else if (compiled.bodyFn) {
        var v = safeEval(compiled.bodyFn, ctx);
        if (isPointPair(v)) out.push([v[0], v[1]]);
        else if (typeof v === "number" && isFinite(v)) out.push(v);
        else if (isListValue(v)) {
          v.forEach(function (item) {
            out.push(item);
          });
        }
      }
    });
    return out;
  }

  function expandParamBounds(name, value) {
    var p = state.params[name];
    if (!p || !isFinite(value)) return;
    if (value < p.min) p.min = Math.floor(value - Math.abs(value) * 0.2 - 1);
    if (value > p.max) p.max = Math.ceil(value + Math.abs(value) * 0.2 + 1);
    // ensure min < max
    if (p.min >= p.max) {
      p.min = value - 10;
      p.max = value + 10;
    }
  }

  function setParamValue(name, value) {
    if (!state.params[name]) {
      state.params[name] = {
        value: value,
        min: -10,
        max: 10,
        step: 0.01,
        playing: false,
        animMode: "alternate",
        animDir: 1,
        animSpeed: 0.02,
      };
    }
    var p = state.params[name];
    p.value = value;
    expandParamBounds(name, value);
    state.assigns[name] = value;
  }

  /* —— View (isotropic: equal x/y scale — no warp on Zoom fit) —— */
  function getViewTransform(w, h) {
    var v = state.view;
    var dx = v.xmax - v.xmin;
    var dy = v.ymax - v.ymin;
    if (!(dx > 0)) dx = 1;
    if (!(dy > 0)) dy = 1;
    // Same world-units per pixel on both axes (prevents stretch)
    var scale = Math.min(w / dx, h / dy);
    var usedW = dx * scale;
    var usedH = dy * scale;
    return {
      v: v,
      scale: scale,
      ox: (w - usedW) / 2,
      oy: (h - usedH) / 2,
      dx: dx,
      dy: dy,
    };
  }

  function worldToScreen(x, y, w, h) {
    var t = getViewTransform(w, h);
    return {
      x: t.ox + (x - t.v.xmin) * t.scale,
      y: t.oy + (t.v.ymax - y) * t.scale,
    };
  }

  function screenToWorld(sx, sy, w, h) {
    var t = getViewTransform(w, h);
    return {
      x: t.v.xmin + (sx - t.ox) / t.scale,
      y: t.v.ymax - (sy - t.oy) / t.scale,
    };
  }

  function niceStep(range, target) {
    var rough = range / target;
    var pow = Math.pow(10, Math.floor(Math.log10(Math.abs(rough) || 1e-12)));
    var n = rough / pow;
    var step = n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10;
    return step * pow;
  }

  function zoomAt(cx, cy, factor) {
    var v = state.view;
    state.view = {
      xmin: cx - (cx - v.xmin) * factor,
      xmax: cx + (v.xmax - cx) * factor,
      ymin: cy - (cy - v.ymin) * factor,
      ymax: cy + (v.ymax - cy) * factor,
    };
  }

  function homeView() {
    state.view = { xmin: -10, xmax: 10, ymin: -10, ymax: 10 };
  }

  /** Fit view to all graphable geometry (Desmos sketch paste, lists, curves). */
  function zoomToFit() {
    var minX = Infinity;
    var maxX = -Infinity;
    var minY = Infinity;
    var maxY = -Infinity;
    function acc(x, y) {
      if (typeof x === "number" && typeof y === "number" && isFinite(x) && isFinite(y)) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    function accPairList(list) {
      if (!isListValue(list)) return;
      list.forEach(function (item) {
        if (isPointPair(item)) acc(item[0], item[1]);
        else if (isListValue(item) && item.length >= 2) acc(+item[0], +item[1]);
      });
    }
    state.exprs.forEach(function (row) {
      if (!row.visible || !row.compiled || row.error) return;
      var c = row.compiled;
      if (row.kind === "parametric") {
        var t0 = c.tMin != null ? c.tMin : 0;
        var t1 = c.tMax != null ? c.tMax : 1;
        var nt = 40;
        for (var ti = 0; ti <= nt; ti++) {
          var tv = t0 + (ti / nt) * (t1 - t0);
          acc(
            safeEval(c.x, baseCtx({ t: tv })),
            safeEval(c.y, baseCtx({ t: tv }))
          );
        }
      } else if (row.kind === "point") {
        var pairs = broadcastPoints(
          safeEval(c.x, baseCtx({})),
          safeEval(c.y, baseCtx({}))
        );
        pairs.forEach(function (p) {
          acc(p[0], p[1]);
        });
      } else if (row.kind === "list") {
        var list = safeEval(c.list, baseCtx({}));
        accPairList(list);
      } else if (row.kind === "for") {
        accPairList(evalForComprehension(c));
      } else if (row.kind === "yfn") {
        var v = state.view;
        for (var i = 0; i <= 40; i++) {
          var x = v.xmin + (i / 40) * (v.xmax - v.xmin);
          var y = safeEval(c.f, baseCtx({ x: x }));
          if (typeof y === "number" && isFinite(y)) acc(x, y);
        }
      }
    });
    if (!isFinite(minX) || !isFinite(maxX) || !isFinite(minY) || !isFinite(maxY)) {
      homeView();
      return;
    }
    if (minX === maxX) {
      minX -= 1;
      maxX += 1;
    }
    if (minY === maxY) {
      minY -= 1;
      maxY += 1;
    }
    // Pad equally in world units (isotropic view transform handles canvas aspect)
    var spanX = maxX - minX;
    var spanY = maxY - minY;
    var pad = Math.max(spanX, spanY) * 0.06 + 1;
    state.view = {
      xmin: minX - pad,
      xmax: maxX + pad,
      ymin: minY - pad,
      ymax: maxY + pad,
    };
  }

  /**
   * Paste one or many Desmos curves. Returns number of expressions added.
   */
  function pasteDesmos(text) {
    var curves = splitDesmosPaste(text);
    if (!curves.length) return 0;
    // Single short expression — let normal input handle it
    if (curves.length === 1 && curves[0].length < 80 && !looksLikeBezierParametric(curves[0])) {
      return 0;
    }
    var added = 0;
    curves.forEach(function (curve) {
      if (!curve || !curve.trim()) return;
      var row = {
        id: uid(),
        text: curve.trim(),
        color: nextColor(),
        opacity: 1,
        visible: true,
        error: "",
        kind: "empty",
        compiled: null,
        free: [],
        inTicker: true,
      };
      state.exprs.push(row);
      added++;
    });
    if (!added) return 0;
    // drop a single empty placeholder if we bulk-pasted into a fresh board
    state.exprs = state.exprs.filter(function (r, idx) {
      if (r.text && String(r.text).trim()) return true;
      // keep one empty only if nothing else
      return false;
    });
    if (!state.exprs.length) {
      // shouldn't happen
      return 0;
    }
    recompileAll();
    renderList();
    renderSliders();
    zoomToFit();
    scheduleDraw();
    setStatusSafe(
      "Pasted " + added + " curve" + (added === 1 ? "" : "s") + " · view fitted"
    );
    return added;
  }

  function setStatusSafe(msg) {
    // optional status in readout area
    var el = $("gc-ticker-status");
    if (el) {
      el.textContent = msg || "Idle";
      el.classList.add("is-running");
      setTimeout(function () {
        el.classList.remove("is-running");
      }, 2000);
    }
  }

  function scheduleDraw() {
    if (raf) return;
    raf = requestAnimationFrame(function () {
      raf = 0;
      draw();
    });
  }

  function fmt(n) {
    if (typeof n !== "number" || !isFinite(n)) return "—";
    var a = Math.abs(n);
    if (a !== 0 && (a >= 1e4 || a < 1e-3)) return n.toExponential(2);
    return (Math.round(n * 1000) / 1000).toString();
  }

  /* —— Drawing —— */
  function draw() {
    var canvas = $("gc-canvas");
    var host = $("gc-canvas-host");
    if (!canvas || !host) return;
    var dpr = window.devicePixelRatio || 1;
    var w = host.clientWidth || 640;
    var h = host.clientHeight || 480;
    if (w < 2 || h < 2) return;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    var ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#f7f8fc";
    ctx.fillRect(0, 0, w, h);
    if (state.grid) drawGrid(ctx, w, h);
    drawAxes(ctx, w, h);
    state.exprs.forEach(function (row) {
      if (!row.visible || !row.compiled || row.error) return;
      // Actions never graph; pure number assigns don't either.
      // Lists (bare or L=[…]) always graph. Assigns that evaluate to lists also graph.
      if (row.kind === "action") return;
      if (row.kind === "assign") {
        // Number assigns never graph; list-of-points assigns can graph
        var av = safeEval(row.compiled.rhs, baseCtx({}));
        if (isListValue(av) && listHasPointPairs(av)) {
          drawListForRow(ctx, w, h, row, av);
        }
        return;
      }
      if (row.kind === "for") {
        var ptsFor = evalForComprehension(row.compiled);
        drawListForRow(ctx, w, h, row, ptsFor);
        return;
      }
      drawRow(ctx, w, h, row);
    });
    var label = $("gc-view-label");
    if (label) {
      var v = state.view;
      label.textContent =
        "x:[" + fmt(v.xmin) + ", " + fmt(v.xmax) + "]  y:[" + fmt(v.ymin) + ", " + fmt(v.ymax) + "]";
    }
    var tickLab = $("gc-ticker-status");
    if (tickLab) {
      var playingN = 0;
      Object.keys(state.params).forEach(function (k) {
        if (state.params[k] && state.params[k].playing) playingN++;
      });
      var bits = [];
      if (playingN) bits.push(playingN + " param" + (playingN === 1 ? "" : "s") + " ▶");
      if (state.ticker.on) {
        bits.push("actions · " + state.ticker.ms + "ms · step " + state.ticker.steps);
      }
      tickLab.textContent = bits.length ? bits.join(" · ") : "Idle";
      tickLab.classList.toggle("is-running", playingN > 0 || state.ticker.on);
    }
  }

  function drawGrid(ctx, w, h) {
    var v = state.view;
    var xs = niceStep(v.xmax - v.xmin, 10);
    var ys = niceStep(v.ymax - v.ymin, 10);
    ctx.strokeStyle = "#e2e6ef";
    ctx.lineWidth = 1;
    ctx.beginPath();
    var x0 = Math.floor(v.xmin / xs) * xs;
    for (var x = x0; x <= v.xmax + xs * 0.5; x += xs) {
      var p = worldToScreen(x, 0, w, h);
      ctx.moveTo(p.x, 0);
      ctx.lineTo(p.x, h);
    }
    var y0 = Math.floor(v.ymin / ys) * ys;
    for (var y = y0; y <= v.ymax + ys * 0.5; y += ys) {
      var q = worldToScreen(0, y, w, h);
      ctx.moveTo(0, q.y);
      ctx.lineTo(w, q.y);
    }
    ctx.stroke();
    ctx.fillStyle = "#8a93a8";
    ctx.font = "11px Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (var xl = x0; xl <= v.xmax + xs * 0.5; xl += xs) {
      if (Math.abs(xl) < xs * 1e-9) continue;
      var sp = worldToScreen(xl, 0, w, h);
      ctx.fillText(fmt(xl), sp.x, Math.min(h - 14, Math.max(2, sp.y + 3)));
    }
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    for (var yl = y0; yl <= v.ymax + ys * 0.5; yl += ys) {
      if (Math.abs(yl) < ys * 1e-9) continue;
      var sq = worldToScreen(0, yl, w, h);
      ctx.fillText(fmt(yl), Math.min(w - 36, Math.max(4, sq.x + 4)), sq.y);
    }
  }

  function drawAxes(ctx, w, h) {
    var o = worldToScreen(0, 0, w, h);
    ctx.strokeStyle = "#5a6478";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, o.y);
    ctx.lineTo(w, o.y);
    ctx.moveTo(o.x, 0);
    ctx.lineTo(o.x, h);
    ctx.stroke();
  }

  function drawPolyline(ctx, w, h, color, points) {
    if (!points.length) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.25;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    var started = false;
    var prev = null;
    var maxJump = Math.max(w, h) * 0.4;
    for (var i = 0; i < points.length; i++) {
      var p = points[i];
      if (!p || !isFinite(p.x) || !isFinite(p.y)) {
        started = false;
        prev = null;
        continue;
      }
      var s = worldToScreen(p.x, p.y, w, h);
      if (Math.abs(s.y) > h * 6) {
        started = false;
        prev = null;
        continue;
      }
      if (!started) {
        ctx.moveTo(s.x, s.y);
        started = true;
      } else if (prev && Math.hypot(s.x - prev.x, s.y - prev.y) > maxJump) {
        ctx.moveTo(s.x, s.y);
      } else {
        ctx.lineTo(s.x, s.y);
      }
      prev = s;
    }
    ctx.stroke();
  }

  function drawDot(ctx, w, h, color, x, y) {
    if (!isFinite(x) || !isFinite(y)) return;
    var s = worldToScreen(x, y, w, h);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(s.x, s.y, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }

  function drawRow(ctx, w, h, row) {
    var color = rowStyle(row);
    var c = row.compiled;
    var kind = row.kind;
    if (!c) return;

    if (kind === "yfn") {
      // Bare list L only graphs if it is a list of points [(x,y),…]
      // Number lists must be plotted as (L,0) or (0,L)
      var yTest = safeEval(c.f, baseCtx({ x: 0, y: 0 }));
      if (isListValue(yTest)) {
        if (listHasPointPairs(yTest)) drawListValue(ctx, w, h, color, yTest);
        return;
      }
      var pts = [];
      var n = Math.min(1600, Math.max(500, Math.floor(w * 1.6)));
      var v = state.view;
      for (var i = 0; i <= n; i++) {
        var x = v.xmin + (i / n) * (v.xmax - v.xmin);
        var y = safeEval(c.f, baseCtx({ x: x, y: 0 }));
        pts.push(typeof y === "number" && isFinite(y) ? { x: x, y: y } : null);
      }
      drawPolyline(ctx, w, h, color, pts);
    } else if (kind === "xfn") {
      var ptsX = [];
      var ny = Math.min(1600, Math.max(500, Math.floor(h * 1.6)));
      var vv = state.view;
      for (var j = 0; j <= ny; j++) {
        var yv = vv.ymin + (j / ny) * (vv.ymax - vv.ymin);
        var xv = safeEval(c.f, baseCtx({ y: yv, x: 0 }));
        ptsX.push(typeof xv === "number" && isFinite(xv) ? { x: xv, y: yv } : null);
      }
      drawPolyline(ctx, w, h, color, ptsX);
    } else if (kind === "vertical") {
      var xv2 = safeEval(c.f, baseCtx({}));
      if (isFinite(xv2)) {
        drawPolyline(ctx, w, h, color, [
          { x: xv2, y: state.view.ymin },
          { x: xv2, y: state.view.ymax },
        ]);
      }
    } else if (kind === "polar") {
      var ptsP = [];
      for (var k = 0; k <= 720; k++) {
        var th = (k / 720) * Math.PI * 2;
        var thIn = state.angleMode === "deg" ? (th * 180) / Math.PI : th;
        var rr = safeEval(c.r, baseCtx({ theta: thIn, t: thIn }));
        if (typeof rr !== "number" || !isFinite(rr)) {
          ptsP.push(null);
          continue;
        }
        ptsP.push({ x: rr * Math.cos(th), y: rr * Math.sin(th) });
      }
      drawPolyline(ctx, w, h, color, ptsP);
    } else if (kind === "parametric") {
      // Desmos default + cubic Beziers: t from 0 to 1
      var t0 = c.tMin != null ? c.tMin : 0;
      var t1 = c.tMax != null ? c.tMax : 1;
      if (!(t1 > t0)) {
        t0 = 0;
        t1 = 1;
      }
      var ptsT = [];
      // More samples for image sketches / Béziers so curves stay accurate
      var nt = c.bezier || (row && row.fromSketch) ? 96 : 160;
      for (var ti = 0; ti <= nt; ti++) {
        var tv = t0 + (ti / nt) * (t1 - t0);
        // never convert t to degrees — t is a unit parameter for (x(t),y(t))
        var xp = safeEval(c.x, baseCtx({ t: tv, theta: tv }));
        var yp = safeEval(c.y, baseCtx({ t: tv, theta: tv }));
        ptsT.push(
          typeof xp === "number" && typeof yp === "number" && isFinite(xp) && isFinite(yp)
            ? { x: xp, y: yp }
            : null
        );
      }
      drawPolyline(ctx, w, h, color, ptsT);
    } else if (kind === "point") {
      // (L,0) (0,L) (A,B) with list broadcast / zip
      var px = safeEval(c.x, baseCtx({}));
      var py = safeEval(c.y, baseCtx({}));
      drawBroadcastPoints(ctx, w, h, color, px, py);
    } else if (kind === "list") {
      var list = safeEval(c.list, baseCtx({}));
      // Keep named list in assigns for reuse (L, pts_1, …)
      if (c.name && isListValue(list)) state.assigns[c.name] = list;
      // Only graph list-of-points; number lists stay data-only
      if (listHasPointPairs(list)) drawListValue(ctx, w, h, color, list);
    } else if (kind === "inequality") {
      drawInequality(ctx, w, h, row);
    }
  }

  function drawInequality(ctx, w, h, row) {
    var c = row.compiled;
    var color = rowStyle(row, 0.2);
    var lineColor = rowStyle(row);
    var v = state.view;
    var stepX = (v.xmax - v.xmin) / Math.min(100, Math.floor(w / 7));
    var stepY = (v.ymax - v.ymin) / Math.min(80, Math.floor(h / 7));
    ctx.fillStyle = color;
    ctx.globalAlpha = 1;
    for (var x = v.xmin; x <= v.xmax; x += stepX) {
      for (var y = v.ymin; y <= v.ymax; y += stepY) {
        var f = safeEval(c.f, baseCtx({ x: x, y: y }));
        if (typeof f !== "number" || !isFinite(f)) continue;
        var ok = false;
        var left = c.axis === "y" ? y : x;
        if (c.op === ">") ok = left > f;
        else if (c.op === ">=") ok = left >= f;
        else if (c.op === "<") ok = left < f;
        else if (c.op === "<=") ok = left <= f;
        if (ok) {
          var s = worldToScreen(x, y, w, h);
          ctx.fillRect(
            s.x,
            s.y,
            Math.ceil(stepX * (w / (v.xmax - v.xmin))) + 1,
            Math.ceil(stepY * (h / (v.ymax - v.ymin))) + 1
          );
        }
      }
    }
    ctx.globalAlpha = 1;
    drawRow(ctx, w, h, {
      kind: c.axis === "y" ? "yfn" : "xfn",
      compiled: { f: c.f },
      color: row.color,
      opacity: row.opacity,
      visible: true,
    });
  }

  /* —— Ticker / actions —— */
  function refreshDependentAssigns() {
    state.exprs.forEach(function (row) {
      if (!row.compiled) return;
      if (row.kind === "assign") {
        var val = safeEval(row.compiled.rhs, baseCtx({}));
        if (typeof val === "number" && isFinite(val)) {
          state.assigns[row.compiled.name] = val;
        } else if (isListValue(val)) {
          state.assigns[row.compiled.name] = val;
        }
      } else if (row.kind === "list" && row.compiled.name) {
        var lv = safeEval(row.compiled.list, baseCtx({}));
        if (isListValue(lv)) state.assigns[row.compiled.name] = lv;
      }
    });
  }

  /** Fire one action row (button or ticker). */
  function runOneAction(row) {
    if (!row || row.error || row.kind !== "action" || !row.compiled) return false;
    var target = row.compiled.target;
    var next = safeEval(row.compiled.rhs, baseCtx({}));
    if (typeof next === "number" && isFinite(next)) {
      setParamValue(target, next);
      refreshDependentAssigns();
      return true;
    }
    return false;
  }

  function runActionsOnce(onlyTicker) {
    var ran = false;
    state.exprs.forEach(function (row) {
      if (!row.visible || row.error || row.kind !== "action" || !row.compiled) return;
      // Ticker only runs actions opted into the ticker (default ON)
      if (onlyTicker && row.inTicker === false) return;
      if (runOneAction(row)) ran = true;
    });
    if (ran) {
      state.ticker.steps++;
      renderSliders();
      scheduleDraw();
    }
    return ran;
  }

  function startTicker() {
    stopTicker(false);
    state.ticker.on = true;
    var ms = Math.max(16, Math.min(2000, state.ticker.ms || 50));
    state.ticker.ms = ms;
    state.ticker.handle = setInterval(function () {
      runActionsOnce(true);
    }, ms);
    var btn = $("gc-ticker-toggle");
    if (btn) {
      btn.textContent = "Actions ON";
      btn.classList.add("is-active");
    }
    ensureAnimLoop();
    scheduleDraw();
  }

  function stopTicker(keepAnim) {
    state.ticker.on = false;
    if (state.ticker.handle) {
      clearInterval(state.ticker.handle);
      state.ticker.handle = null;
    }
    var btn = $("gc-ticker-toggle");
    if (btn) {
      btn.textContent = "Actions off";
      btn.classList.remove("is-active");
    }
    if (!keepAnim) scheduleDraw();
  }

  /* —— Independent parameter animation (Desmos-style slider play) —— */
  var paramAnimHandle = null;

  function anyParamPlaying() {
    return Object.keys(state.params).some(function (k) {
      return state.params[k] && state.params[k].playing;
    });
  }

  function ensureAnimLoop() {
    if (paramAnimHandle) return;
    paramAnimHandle = setInterval(function () {
      tickParamAnimations();
      if (state.ticker.on) {
        // action ticker runs on its own interval; status still updates here
      }
      if (!anyParamPlaying() && !state.ticker.on) {
        // keep loop if nothing playing — still cheap; stop if idle
        // leave running for snappy play; optional stop:
      }
    }, 32);
  }

  function stopAnimLoopIfIdle() {
    if (anyParamPlaying() || state.ticker.on) return;
    if (paramAnimHandle) {
      clearInterval(paramAnimHandle);
      paramAnimHandle = null;
    }
  }

  function tickParamAnimations() {
    var moved = false;
    Object.keys(state.params).forEach(function (k) {
      var p = state.params[k];
      if (!p || !p.playing) return;
      var span = p.max - p.min;
      if (!(span > 0)) return;
      var speed = p.animSpeed != null ? p.animSpeed : 0.02;
      var step = span * speed;
      if (!(step > 0)) step = span / 100;
      var dir = p.animDir != null ? p.animDir : 1;
      var mode = p.animMode || "alternate";
      var next = p.value + dir * step;

      if (mode === "loop") {
        // min → max, wrap to min
        if (next > p.max) next = p.min;
        if (next < p.min) next = p.max;
        p.animDir = 1;
      } else {
        // alternate / ping-pong
        if (next >= p.max) {
          next = p.max;
          p.animDir = -1;
        } else if (next <= p.min) {
          next = p.min;
          p.animDir = 1;
        }
      }
      p.value = next;
      state.assigns[k] = next;
      moved = true;
    });
    if (moved) {
      refreshDependentAssigns();
      // soft-update slider UIs without full rebuild
      var box = $("gc-sliders");
      if (box) {
        box.querySelectorAll(".gc-slider-block").forEach(function (block) {
          var name = block.dataset.param;
          if (!name || !state.params[name]) return;
          var p = state.params[name];
          var range = block.querySelector('input[type="range"]');
          var valIn = block.querySelector(".gc-slider-val-input");
          var valLab = block.querySelector(".gc-slider-val");
          if (range) range.value = String(p.value);
          if (valIn) valIn.value = String(p.value);
          if (valLab) valLab.textContent = fmt(p.value);
          block.classList.toggle("is-running", !!p.playing);
        });
      }
      scheduleDraw();
    }
  }

  function setParamPlaying(name, on) {
    var p = state.params[name];
    if (!p) return;
    p.playing = !!on;
    if (p.playing) {
      if (p.animDir == null) p.animDir = 1;
      ensureAnimLoop();
    } else {
      stopAnimLoopIfIdle();
    }
    renderSliders();
    scheduleDraw();
  }

  /* —— UI —— */
  function addExpr(text) {
    var raw = text != null ? String(text) : "";
    // Multi-curve Desmos paste into "add" or empty row
    if (raw && (raw.indexOf("\\left") >= 0 || raw.indexOf("\\right") >= 0 || (raw.match(/\([^\n]+\)/g) || []).length > 1)) {
      var n = pasteDesmos(raw);
      if (n > 0) return state.exprs[state.exprs.length - 1];
    }
    var row = {
      id: uid(),
      text: raw,
      color: nextColor(),
      /** 0–1 stroke/fill opacity */
      opacity: 1,
      visible: true,
      error: "",
      kind: "empty",
      compiled: null,
      free: [],
      /** When true, ticker will fire this action each tick */
      inTicker: true,
    };
    compileRow(row);
    state.exprs.push(row);
    state.focusId = row.id;
    ensureParams();
    // second pass so assigns resolve
    recompileAll();
    renderList();
    renderSliders();
    scheduleDraw();
    return row;
  }

  function removeExpr(id) {
    state.exprs = state.exprs.filter(function (r) {
      return r.id !== id;
    });
    if (!state.exprs.length) addExpr("sin(x)");
    else {
      recompileAll();
      renderList();
      renderSliders();
      scheduleDraw();
    }
  }

  function renderList() {
    var list = $("gc-expr-list");
    if (!list) return;
    list.innerHTML = "";
    state.exprs.forEach(function (row, idx) {
      var div = document.createElement("div");
      div.className =
        "gc-expr-row" +
        (row.id === state.focusId ? " is-focus" : "") +
        (row.error ? " has-error" : "") +
        (row.kind === "action" ? " is-action" : "") +
        (row.kind === "assign" ? " is-assign" : "") +
        (row.kind === "list" ? " is-list" : "") +
        (row.kind === "for" ? " is-list" : "");
      div.dataset.id = row.id;

      var num = document.createElement("div");
      num.className = "gc-expr-idx";
      num.textContent = String(idx + 1);

      // Style column: color picker + opacity + show/hide
      var styleCol = document.createElement("div");
      styleCol.className = "gc-style-col";

      var colorWrap = document.createElement("label");
      colorWrap.className =
        "gc-color-wrap" + (row.visible ? "" : " is-hidden");
      colorWrap.title = "Line / point color";
      var colorIn = document.createElement("input");
      colorIn.type = "color";
      colorIn.className = "gc-color-input";
      colorIn.value = normalizeHex(row.color || "#2d70b3");
      colorIn.addEventListener("input", function () {
        row.color = colorIn.value;
        scheduleDraw();
      });
      colorIn.addEventListener("change", function () {
        row.color = colorIn.value;
        scheduleDraw();
      });
      colorWrap.appendChild(colorIn);

      var visBtn = document.createElement("button");
      visBtn.type = "button";
      visBtn.className = "gc-vis-btn" + (row.visible ? "" : " is-off");
      visBtn.title = row.visible ? "Hide graph" : "Show graph";
      visBtn.textContent = row.visible ? "◉" : "○";
      visBtn.addEventListener("click", function () {
        row.visible = !row.visible;
        renderList();
        scheduleDraw();
      });

      if (row.kind === "action") {
        colorWrap.classList.add("is-action-swatch");
        colorIn.disabled = true;
        colorIn.title = "Actions are not graphed";
      }

      styleCol.appendChild(colorWrap);
      styleCol.appendChild(visBtn);

      var ta = document.createElement("textarea");
      ta.className = "gc-expr-input";
      ta.rows = 1;
      ta.spellcheck = false;
      ta.placeholder =
        "sin(x) · [1...5] · L=[1,2...10] · (x,y) for x=L, y=M · x^2 · a→a+0.1";
      // Prefer arrow character in the editor
      ta.value = prettyPowers(String(row.text || "").replace(/->/g, "→"));
      ta.addEventListener("focus", function () {
        state.focusId = row.id;
        list.querySelectorAll(".gc-expr-row").forEach(function (el) {
          el.classList.toggle("is-focus", el.dataset.id === row.id);
        });
      });
      ta.addEventListener("paste", function (ev) {
        var clip =
          (ev.clipboardData && ev.clipboardData.getData("text")) ||
          (window.clipboardData && window.clipboardData.getData("Text")) ||
          "";
        if (
          clip &&
          (clip.indexOf("\\left") >= 0 ||
            clip.indexOf("\\right") >= 0 ||
            (clip.match(/\([^)]{20,}\)/g) || []).length > 1 ||
            splitDesmosPaste(clip).length > 1)
        ) {
          ev.preventDefault();
          // Replace this row if empty, else append curves
          if (!String(row.text || "").trim()) {
            state.exprs = state.exprs.filter(function (r) {
              return r.id !== row.id;
            });
          }
          var n = pasteDesmos(clip);
          if (!n) {
            // fallback single
            row.text = normalizeSource(clip);
            recompileAll();
            renderList();
            zoomToFit();
            scheduleDraw();
          }
        }
      });
      ta.addEventListener("input", function () {
        // Keep → and visual superscripts in the field
        var pretty = prettyPowers(ta.value.replace(/->/g, "→"));
        if (pretty !== ta.value) {
          var pos = ta.selectionStart;
          // rough caret: if we only expanded trailing ^digit, nudge
          var delta = pretty.length - ta.value.length;
          ta.value = pretty;
          try {
            ta.setSelectionRange(pos + delta, pos + delta);
          } catch (e) {}
        }
        row.text = ta.value;
        recompileAll();
        var err = div.querySelector(".gc-expr-err");
        if (row.error) {
          if (!err) {
            err = document.createElement("div");
            err.className = "gc-expr-err";
            div.appendChild(err);
          }
          err.textContent = row.error;
          div.classList.add("has-error");
        } else {
          if (err) err.remove();
          div.classList.remove("has-error");
        }
        div.classList.toggle("is-action", row.kind === "action");
        div.classList.toggle("is-assign", row.kind === "assign");
        div.classList.toggle("is-list", row.kind === "list");
        // Rebuild action chrome if kind flipped
        var chrome = div.querySelector(".gc-action-bar");
        if (row.kind === "action" && !chrome) {
          renderList();
          return;
        }
        if (row.kind !== "action" && chrome) {
          renderList();
          return;
        }
        renderSliders();
        scheduleDraw();
      });
      ta.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter" && !ev.shiftKey) {
          ev.preventDefault();
          var r = addExpr("");
          setTimeout(function () {
            var el = list.querySelector('[data-id="' + r.id + '"] textarea');
            if (el) el.focus();
          }, 0);
        }
      });

      var del = document.createElement("button");
      del.type = "button";
      del.className = "gc-expr-del";
      del.title = "Remove";
      del.textContent = "×";
      del.addEventListener("click", function () {
        if (state.exprs.length <= 1) {
          row.text = "";
          recompileAll();
          renderList();
          renderSliders();
          scheduleDraw();
          return;
        }
        removeExpr(row.id);
      });

      div.appendChild(num);
      div.appendChild(styleCol);
      div.appendChild(ta);
      div.appendChild(del);

      // Opacity for anything that can draw (not pure actions)
      var showOpacity = row.kind !== "action";
      if (showOpacity) {
        var opacRow = document.createElement("div");
        opacRow.className = "gc-opacity-row";
        var opacLab = document.createElement("span");
        opacLab.className = "gc-opacity-lab";
        opacLab.textContent = "Opacity";
        var opac = document.createElement("input");
        opac.type = "range";
        opac.className = "gc-opacity-range";
        opac.min = "0";
        opac.max = "100";
        opac.step = "1";
        var opPct = Math.round(clampOpacity(row.opacity) * 100);
        opac.value = String(opPct);
        var opacVal = document.createElement("span");
        opacVal.className = "gc-opacity-val";
        opacVal.textContent = opPct + "%";
        opac.addEventListener("input", function () {
          row.opacity = clampOpacity(parseInt(opac.value, 10) / 100);
          opacVal.textContent = Math.round(row.opacity * 100) + "%";
          scheduleDraw();
        });
        opacRow.appendChild(opacLab);
        opacRow.appendChild(opac);
        opacRow.appendChild(opacVal);
        div.appendChild(opacRow);
      }

      if (row.error) {
        var errEl = document.createElement("div");
        errEl.className = "gc-expr-err";
        errEl.textContent = row.error;
        div.appendChild(errEl);
      } else if (row.kind === "action" && row.compiled) {
        var bar = document.createElement("div");
        bar.className = "gc-action-bar";
        var runBtn = document.createElement("button");
        runBtn.type = "button";
        runBtn.className = "gc-action-run";
        runBtn.textContent = "▶ Run";
        runBtn.title = "Fire this action once";
        runBtn.addEventListener("click", function () {
          if (runOneAction(row)) {
            renderSliders();
            scheduleDraw();
          }
        });
        var tickLab = document.createElement("label");
        tickLab.className = "gc-action-tick";
        var tickCb = document.createElement("input");
        tickCb.type = "checkbox";
        tickCb.checked = row.inTicker !== false;
        tickCb.addEventListener("change", function () {
          row.inTicker = !!tickCb.checked;
        });
        tickLab.appendChild(tickCb);
        tickLab.appendChild(document.createTextNode(" In action loop"));
        tickLab.title =
          "When checked, top-bar Actions loop fires this row. Prefer parameter ▶ Play for smooth min↔max animation.";
        var arrow = document.createElement("span");
        arrow.className = "gc-action-arrow";
        arrow.textContent =
          prettyVar(row.compiled.target) +
          "  →  " +
          String(row.text.split(/->|→/)[1] || "").trim();
        bar.appendChild(runBtn);
        bar.appendChild(tickLab);
        bar.appendChild(arrow);
        div.appendChild(bar);
      } else if (row.kind === "list") {
        var lh = document.createElement("div");
        lh.className = "gc-expr-hint";
        var lval = row.compiled
          ? safeEval(row.compiled.list, baseCtx({}))
          : null;
        var n = isListValue(lval) ? lval.length : 0;
        var nm =
          row.compiled && row.compiled.name
            ? prettyVar(row.compiled.name)
            : null;
        if (listIsOnlyNumbers(lval)) {
          lh.textContent =
            (nm ? nm + " = " : "") +
            "number list (" +
            n +
            ") — not graphed alone. Plot with (" +
            (nm || "L") +
            ", 0) or (0, " +
            (nm || "L") +
            ")";
        } else if (listHasPointPairs(lval)) {
          lh.textContent =
            (nm ? nm + " = " : "") +
            "point list · " +
            n +
            " points · graphed";
        } else {
          lh.textContent =
            (nm ? nm + " = list · " : "List · ") + n + " items";
        }
        div.appendChild(lh);
      } else if (row.kind === "for") {
        var fh = document.createElement("div");
        fh.className = "gc-expr-hint";
        var fpts = row.compiled ? evalForComprehension(row.compiled) : [];
        fh.textContent =
          "for lattice · " +
          (isListValue(fpts) ? fpts.length : 0) +
          " points (cartesian product of generators)";
        div.appendChild(fh);
      } else if (row.kind === "assign") {
        var av = state.assigns[row.compiled && row.compiled.name];
        var hint2 = document.createElement("div");
        hint2.className = "gc-expr-hint";
        if (isListValue(av)) {
          hint2.textContent =
            prettyVar(row.compiled.name) + " = list (" + av.length + ") · graphed";
        } else {
          hint2.textContent =
            prettyVar(row.compiled && row.compiled.name) +
            (typeof av === "number" && isFinite(av) ? " = " + fmt(av) : " = …");
        }
        div.appendChild(hint2);
      }
      list.appendChild(div);
    });
  }

  function renderSliders() {
    var box = $("gc-sliders");
    if (!box) return;
    var keys = Object.keys(state.params).sort();
    if (!keys.length) {
      box.hidden = true;
      box.innerHTML = "";
      return;
    }
    box.hidden = false;
    box.innerHTML =
      "<h3>Parameters — play animates min↔max (pause stops only this param)</h3>";
    keys.forEach(function (k) {
      var p = state.params[k];
      if (p.playing == null) p.playing = false;
      if (!p.animMode) p.animMode = "alternate";
      if (p.animDir == null) p.animDir = 1;
      if (p.animSpeed == null) p.animSpeed = 0.02;

      var wrap = document.createElement("div");
      wrap.className = "gc-slider-block" + (p.playing ? " is-running" : "");
      wrap.dataset.param = k;

      var head = document.createElement("div");
      head.className = "gc-slider-head";
      var lab = document.createElement("strong");
      lab.textContent = prettyVar(k);
      lab.title = k;
      var valLab = document.createElement("span");
      valLab.className = "gc-slider-val";
      valLab.textContent = fmt(p.value);
      if (p.playing) {
        var runDot = document.createElement("span");
        runDot.className = "gc-run-dot";
        runDot.title = "Animating";
        runDot.textContent = "●";
        head.appendChild(runDot);
      }
      head.appendChild(lab);
      head.appendChild(valLab);

      var range = document.createElement("input");
      range.type = "range";
      range.min = String(p.min);
      range.max = String(p.max);
      range.step = String(p.step || 0.01);
      range.value = String(p.value);

      var bounds = document.createElement("div");
      bounds.className = "gc-slider-bounds";
      var minIn = document.createElement("input");
      minIn.type = "number";
      minIn.title = "Min";
      minIn.value = String(p.min);
      minIn.step = "any";
      var valIn = document.createElement("input");
      valIn.type = "number";
      valIn.className = "gc-slider-val-input";
      valIn.title = "Value";
      valIn.value = String(p.value);
      valIn.step = "any";
      var maxIn = document.createElement("input");
      maxIn.type = "number";
      maxIn.title = "Max";
      maxIn.value = String(p.max);
      maxIn.step = "any";
      bounds.appendChild(minIn);
      bounds.appendChild(valIn);
      bounds.appendChild(maxIn);

      // Play / pause + mode (loop vs alternate)
      var animRow = document.createElement("div");
      animRow.className = "gc-param-anim";
      var playBtn = document.createElement("button");
      playBtn.type = "button";
      playBtn.className = "gc-param-play" + (p.playing ? " is-on" : "");
      playBtn.textContent = p.playing ? "⏸ Pause" : "▶ Play";
      playBtn.title =
        "Animate this parameter between min and max. Pause stops only this slider — not other params or the action ticker.";
      playBtn.addEventListener("click", function () {
        setParamPlaying(k, !p.playing);
      });
      var modeSel = document.createElement("select");
      modeSel.className = "gc-param-mode";
      modeSel.title = "Loop: min→max wrap · Alternate: back and forth";
      [
        { v: "alternate", t: "↔ Alternate" },
        { v: "loop", t: "→ Loop" },
      ].forEach(function (opt) {
        var o = document.createElement("option");
        o.value = opt.v;
        o.textContent = opt.t;
        if (p.animMode === opt.v) o.selected = true;
        modeSel.appendChild(o);
      });
      modeSel.addEventListener("change", function () {
        p.animMode = modeSel.value;
        p.animDir = 1;
      });
      var speed = document.createElement("input");
      speed.type = "range";
      speed.className = "gc-param-speed";
      speed.min = "1";
      speed.max = "20";
      speed.step = "1";
      speed.value = String(Math.round((p.animSpeed || 0.02) * 500));
      speed.title = "Animation speed";
      speed.addEventListener("input", function () {
        p.animSpeed = Math.max(0.002, parseInt(speed.value, 10) / 500);
      });
      animRow.appendChild(playBtn);
      animRow.appendChild(modeSel);
      animRow.appendChild(speed);

      function syncUI() {
        range.min = String(p.min);
        range.max = String(p.max);
        range.step = String(p.step || 0.01);
        range.value = String(p.value);
        minIn.value = String(p.min);
        maxIn.value = String(p.max);
        valIn.value = String(p.value);
        valLab.textContent = fmt(p.value);
      }

      function applyValue(n) {
        if (!isFinite(n)) return;
        p.value = n;
        expandParamBounds(k, n);
        state.assigns[k] = n;
        syncUI();
        refreshDependentAssigns();
        scheduleDraw();
      }

      range.addEventListener("input", function () {
        applyValue(parseFloat(range.value));
      });
      valIn.addEventListener("change", function () {
        applyValue(parseFloat(valIn.value));
      });
      minIn.addEventListener("change", function () {
        var n = parseFloat(minIn.value);
        if (!isFinite(n)) return;
        p.min = n;
        if (p.max <= p.min) p.max = p.min + 1;
        if (p.value < p.min) applyValue(p.min);
        else syncUI();
      });
      maxIn.addEventListener("change", function () {
        var n = parseFloat(maxIn.value);
        if (!isFinite(n)) return;
        p.max = n;
        if (p.max <= p.min) p.min = p.max - 1;
        if (p.value > p.max) applyValue(p.max);
        else syncUI();
      });

      wrap.appendChild(head);
      wrap.appendChild(range);
      wrap.appendChild(bounds);
      wrap.appendChild(animRow);
      box.appendChild(wrap);
    });
    if (anyParamPlaying()) ensureAnimLoop();
  }

  function updateReadout(world, hits) {
    var el = $("gc-readout");
    if (!el) return;
    if (!world) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    var parts = ["(" + fmt(world.x) + ", " + fmt(world.y) + ")"];
    (hits || []).forEach(function (h) {
      parts.push(h);
    });
    el.textContent = parts.join("  ·  ");
  }

  function probeAt(world) {
    var hits = [];
    state.exprs.forEach(function (row, idx) {
      if (!row.visible || !row.compiled || row.error) return;
      if (row.kind === "yfn") {
        var y = safeEval(row.compiled.f, baseCtx({ x: world.x }));
        if (typeof y === "number" && isFinite(y)) hits.push("#" + (idx + 1) + " y≈" + fmt(y));
      }
    });
    return hits;
  }

  function bindCanvas() {
    var host = $("gc-canvas-host");
    if (!host || host._gcBound) return;
    host._gcBound = true;

    host.addEventListener("pointerdown", function (ev) {
      if (ev.button !== 0) return;
      host.setPointerCapture(ev.pointerId);
      drag = {
        x: ev.clientX,
        y: ev.clientY,
        view: Object.assign({}, state.view),
      };
      host.classList.add("is-panning");
    });
    host.addEventListener("pointermove", function (ev) {
      var rect = host.getBoundingClientRect();
      var w = rect.width;
      var h = rect.height;
      var world = screenToWorld(ev.clientX - rect.left, ev.clientY - rect.top, w, h);
      if (drag) {
        var dx = ev.clientX - drag.x;
        var dy = ev.clientY - drag.y;
        var vx = drag.view;
        // Temporary view for scale from drag start bounds
        var prev = state.view;
        state.view = vx;
        var tr = getViewTransform(w, h);
        state.view = prev;
        var wdx = -dx / tr.scale;
        var wdy = dy / tr.scale;
        state.view = {
          xmin: vx.xmin + wdx,
          xmax: vx.xmax + wdx,
          ymin: vx.ymin + wdy,
          ymax: vx.ymax + wdy,
        };
        scheduleDraw();
      } else {
        updateReadout(world, probeAt(world));
      }
    });
    function endDrag(ev) {
      drag = null;
      host.classList.remove("is-panning");
      try {
        host.releasePointerCapture(ev.pointerId);
      } catch (e) {}
    }
    host.addEventListener("pointerup", endDrag);
    host.addEventListener("pointercancel", endDrag);
    host.addEventListener("pointerleave", function () {
      if (!drag) updateReadout(null);
    });
    host.addEventListener(
      "wheel",
      function (ev) {
        ev.preventDefault();
        var rect = host.getBoundingClientRect();
        var world = screenToWorld(
          ev.clientX - rect.left,
          ev.clientY - rect.top,
          rect.width,
          rect.height
        );
        zoomAt(world.x, world.y, ev.deltaY > 0 ? 1.12 : 1 / 1.12);
        scheduleDraw();
      },
      { passive: false }
    );
    host.addEventListener("dblclick", function () {
      homeView();
      scheduleDraw();
    });
  }

  function bind() {
    if (bound) return;
    if (!$("panel-graphcalc")) return;
    bound = true;

    $("gc-add-expr") &&
      $("gc-add-expr").addEventListener("click", function () {
        var r = addExpr("");
        setTimeout(function () {
          var el = document.querySelector('#gc-expr-list [data-id="' + r.id + '"] textarea');
          if (el) el.focus();
        }, 0);
      });

    function zoomIn() {
      var v = state.view;
      zoomAt((v.xmin + v.xmax) / 2, (v.ymin + v.ymax) / 2, 0.7);
    }
    function zoomOut() {
      var v = state.view;
      zoomAt((v.xmin + v.xmax) / 2, (v.ymin + v.ymax) / 2, 1 / 0.7);
    }

    $("gc-home") &&
      $("gc-home").addEventListener("click", function () {
        homeView();
        scheduleDraw();
      });
    $("gc-zoom-fit") &&
      $("gc-zoom-fit").addEventListener("click", function () {
        zoomToFit();
        scheduleDraw();
      });
    $("gc-paste-desmos") &&
      $("gc-paste-desmos").addEventListener("click", function () {
        var text = window.prompt(
          "Paste Desmos / LaTeX curves (\\left(...\\right) blocks). Multi-curve paste supported.",
          ""
        );
        if (text && text.trim()) {
          var n = pasteDesmos(text);
          if (!n) {
            addExpr(normalizeSource(text));
            zoomToFit();
            scheduleDraw();
          }
        }
      });

    bindSketchPanel();
    $("gc-zoom-in") &&
      $("gc-zoom-in").addEventListener("click", function () {
        zoomIn();
        scheduleDraw();
      });
    $("gc-zoom-out") &&
      $("gc-zoom-out").addEventListener("click", function () {
        zoomOut();
        scheduleDraw();
      });
    $("gc-toggle-grid") &&
      $("gc-toggle-grid").addEventListener("click", function () {
        state.grid = !state.grid;
        this.classList.toggle("is-active", state.grid);
        scheduleDraw();
      });
    $("gc-toggle-rad") &&
      $("gc-toggle-rad").addEventListener("click", function () {
        state.angleMode = state.angleMode === "rad" ? "deg" : "rad";
        this.textContent = state.angleMode === "rad" ? "Radians" : "Degrees";
        this.classList.toggle("is-active", state.angleMode === "deg");
        recompileAll();
        renderList();
        scheduleDraw();
      });
    $("gc-help-btn") &&
      $("gc-help-btn").addEventListener("click", function () {
        var hp = $("gc-help-panel");
        if (!hp) return;
        hp.hidden = !hp.hidden;
        this.classList.toggle("is-active", !hp.hidden);
      });
      $("gc-examples") &&
      $("gc-examples").addEventListener("click", function () {
        stopTicker();
        state.exprs = [];
        state.colorIdx = 0;
        state.params = {};
        state.assigns = {};
        state.ticker.steps = 0;
        // Number list is data — plot via (L,0) / (0,L)
        addExpr("L = [1...5]");
        addExpr("(L, 0)");
        addExpr("(0, L)");
        // Lattice with for
        addExpr("(x,y) for x=[1...4], y=[1...3]");
        // Animate with parameter Play (not action ticker)
        addExpr("y = sin(x + a)");
        setParamValue("a", 0);
        if (state.params.a) {
          state.params.a.min = 0;
          state.params.a.max = 6.28;
          state.params.a.animMode = "loop";
          state.params.a.playing = true;
        }
        ensureParams();
        ensureAnimLoop();
        renderList();
        renderSliders();
        homeView();
        scheduleDraw();
      });

    $("gc-ticker-toggle") &&
      $("gc-ticker-toggle").addEventListener("click", function () {
        if (state.ticker.on) stopTicker();
        else startTicker();
      });
      $("gc-ticker-step") &&
      $("gc-ticker-step").addEventListener("click", function () {
        // Step runs every action that has Ticker checked (same set as live ticker)
        runActionsOnce(true);
      });
    $("gc-ticker-ms") &&
      $("gc-ticker-ms").addEventListener("change", function () {
        var n = parseInt(this.value, 10);
        if (!isFinite(n)) return;
        state.ticker.ms = Math.max(16, Math.min(2000, n));
        this.value = String(state.ticker.ms);
        if (state.ticker.on) startTicker();
      });

    bindCanvas();
    window.addEventListener("resize", scheduleDraw);

    if (!state.exprs.length) {
      addExpr("y = sin(x)");
      addExpr("y = x^2/10");
    } else {
      recompileAll();
      renderList();
      renderSliders();
      scheduleDraw();
    }
  }

  function onShow() {
    bind();
    scheduleDraw();
    setTimeout(scheduleDraw, 50);
    setTimeout(scheduleDraw, 200);
  }

  function onHide() {
    stopTicker(false);
    Object.keys(state.params).forEach(function (k) {
      if (state.params[k]) state.params[k].playing = false;
    });
    stopAnimLoopIfIdle();
  }

  /* —— Image → sketch (img2desmos-style) —— */
  var lastSketchIds = [];

  function setSketchStatus(msg, kind) {
    var el = $("gc-sketch-status");
    if (!el) return;
    el.textContent = msg || "";
    el.classList.remove("is-err", "is-ok");
    if (kind === "err") el.classList.add("is-err");
    if (kind === "ok") el.classList.add("is-ok");
  }

  function showSketchPreview(canvas) {
    var prev = $("gc-sketch-preview");
    if (!prev || !canvas) return;
    prev.width = canvas.width;
    prev.height = canvas.height;
    var ctx = prev.getContext("2d");
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, prev.width, prev.height);
    ctx.drawImage(canvas, 0, 0);
  }

  /** Cached catalog for paintings/generated sketch picker */
  var sketchCatalog = {
    paintings: null,
    generated: null,
  };

  function loadSketchPickList(collection) {
    var file = $("gc-sketch-file");
    var numPick = $("gc-sketch-numpick");
    var numIn = $("gc-sketch-num");
    var rangeLab = $("gc-sketch-range-label");
    if (collection === "file") {
      if (file) file.hidden = false;
      if (numPick) numPick.hidden = true;
      return Promise.resolve();
    }
    if (file) file.hidden = true;
    if (numPick) numPick.hidden = false;
    if (rangeLab) rangeLab.textContent = "loading…";
    var api = window.GraphCalcImgTrace;
    if (!api || !api.fetchGalleryCatalog) {
      if (rangeLab) rangeLab.textContent = "(tracer not loaded)";
      return Promise.resolve();
    }
    return api.fetchGalleryCatalog(collection).then(function (cat) {
      sketchCatalog[collection] = cat;
      var first = cat.first || 1;
      var last = cat.last || (collection === "paintings" ? 1000 : 0);
      var count = cat.count || 0;
      if (numIn) {
        numIn.min = String(first);
        numIn.max = String(last > 0 ? last : first);
        var cur = parseInt(numIn.value, 10);
        if (!isFinite(cur) || cur < first || (last > 0 && cur > last)) {
          numIn.value = String(first);
        }
      }
      if (rangeLab) {
        if (collection === "paintings") {
          rangeLab.textContent = "(1–1000 · all paintings)";
        } else {
          rangeLab.textContent =
            "(" +
            first +
            "–" +
            last +
            " · " +
            count +
            " files, full range)";
        }
      }
      setSketchStatus(
        collection === "paintings"
          ? "Paintings ready — enter #1–1000, then Preview or Convert"
          : "Generated ready — enter #" +
              first +
              "–" +
              last +
              " (" +
              count +
              " total), then Preview or Convert"
      );
    });
  }

  function resolveSketchImageUrl() {
    var src = $("gc-sketch-source");
    var mode = src ? src.value : "file";
    if (mode === "file") {
      var fileIn = $("gc-sketch-file");
      if (!fileIn || !fileIn.files || !fileIn.files[0]) {
        return Promise.reject(new Error("Choose an image file first"));
      }
      return Promise.resolve(URL.createObjectURL(fileIn.files[0]));
    }
    var numIn = $("gc-sketch-num");
    var n = numIn ? parseInt(numIn.value, 10) : NaN;
    if (!isFinite(n) || n < 1) {
      return Promise.reject(
        new Error(
          mode === "paintings"
            ? "Enter a painting number from 1 to 1000"
            : "Enter a generated image number"
        )
      );
    }
    var api = window.GraphCalcImgTrace;
    var cat = sketchCatalog[mode];
    var ensure =
      cat
        ? Promise.resolve(cat)
        : api && api.fetchGalleryCatalog
          ? api.fetchGalleryCatalog(mode).then(function (c) {
              sketchCatalog[mode] = c;
              return c;
            })
          : Promise.resolve(null);
    return ensure.then(function (catalog) {
      if (mode === "paintings") {
        if (n < 1 || n > 1000) {
          throw new Error("Painting # must be 1–1000");
        }
      } else if (mode === "generated" && catalog) {
        var first = catalog.first || 1;
        var last = catalog.last || 0;
        if (n < first || (last > 0 && n > last)) {
          throw new Error(
            "Generated # must be " + first + "–" + last + " (you entered " + n + ")"
          );
        }
        // If nums list is sparse, check membership
        if (Array.isArray(catalog.nums) && catalog.nums.length && catalog.nums.indexOf(n) < 0) {
          // still try URL — file might exist with gaps
        }
      }
      var url =
        api && api.urlForNumber
          ? api.urlForNumber(mode, n, catalog)
          : mode === "paintings"
            ? "/paintings/" + n + ".jpg"
            : "/generated/" + n + ".jpg";
      if (!url) throw new Error("Could not resolve image URL for #" + n);
      return url;
    });
  }

  function previewSketchByNumber() {
    resolveSketchImageUrl()
      .then(function (url) {
        setSketchStatus("Loading preview…");
        var api = window.GraphCalcImgTrace;
        return api.loadImage(url).then(function (img) {
          var c = document.createElement("canvas");
          var maxW = 160;
          var w = img.naturalWidth || img.width;
          var h = img.naturalHeight || img.height;
          if (w > maxW) {
            h = Math.round((h * maxW) / w);
            w = maxW;
          }
          c.width = w;
          c.height = h;
          c.getContext("2d").drawImage(img, 0, 0, w, h);
          showSketchPreview(c);
          var src = $("gc-sketch-source");
          var mode = src ? src.value : "";
          var numIn = $("gc-sketch-num");
          var n = numIn ? numIn.value : "?";
          setSketchStatus(
            "Preview " +
              (mode === "paintings" ? "Painting" : "Generated") +
              " #" +
              n +
              " — ready to Convert",
            "ok"
          );
        });
      })
      .catch(function (err) {
        setSketchStatus((err && err.message) || "Preview failed", "err");
      });
  }

  function apiUrlLocal(path) {
    if (typeof window.galleryApiUrl === "function") return window.galleryApiUrl(path);
    return path;
  }

  function previewCanvasToBase64(canvas) {
    if (!canvas) return "";
    try {
      return canvas.toDataURL("image/png");
    } catch (e) {
      return "";
    }
  }

  /** Save current sketch batch → gallery/sketches/N.json (N = next integer). */
  function saveSketchBatch(opts) {
    opts = opts || {};
    var curves = opts.curves || [];
    if (!curves.length) {
      return Promise.reject(new Error("No curves to save"));
    }
    var payload = {
      title: opts.title || "",
      source_url: opts.source_url || "",
      width: opts.width,
      height: opts.height,
      curves: curves,
      preview_base64: opts.preview_base64 || "",
      meta: {
        detail: opts.detail,
        max_curves: opts.maxCurves,
        contour_count: opts.contourCount,
        source: "graphcalc-img2curve",
      },
    };
    return fetch(apiUrlLocal("/api/sketches/save"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(function (r) {
        return r.text().then(function (text) {
          var d = {};
          try {
            d = text ? JSON.parse(text) : {};
          } catch (e) {
            d = {
              error:
                "Server returned non-JSON (status " +
                r.status +
                "). Restart start_server.bat so /api/sketches/save is live.",
            };
          }
          return { ok: r.ok, status: r.status, d: d || {} };
        });
      })
      .then(function (res) {
        if (!res.ok || (res.d && res.d.ok === false)) {
          var msg =
            (res.d && (res.d.error || res.d.message)) ||
            "Save failed (HTTP " + res.status + ")";
          if (res.status === 404 || /unknown api/i.test(String(msg))) {
            msg +=
              " — restart the gallery server (start_server.bat) to enable sketch saving.";
          }
          throw new Error(msg);
        }
        return res.d;
      });
  }

  function refreshSketchLoadList() {
    var sel = $("gc-sketch-load");
    if (!sel) return Promise.resolve();
    return fetch(apiUrlLocal("/api/sketches?limit=100&t=" + Date.now()), {
      cache: "no-store",
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        var items = (data && data.items) || [];
        var keep = sel.value;
        sel.innerHTML = '<option value="">Load sketch #…</option>';
        items.forEach(function (it) {
          var o = document.createElement("option");
          o.value = String(it.num);
          o.textContent =
            "#" +
            it.num +
            " · " +
            (it.curve_count || "?") +
            " curves" +
            (it.title && it.title !== "Sketch #" + it.num
              ? " · " + it.title
              : "");
          sel.appendChild(o);
        });
        if (keep) sel.value = keep;
      })
      .catch(function () {
        /* server may be offline */
      });
  }

  function loadSketchByNum(num) {
    num = parseInt(num, 10);
    if (!isFinite(num) || num < 1) {
      return Promise.reject(new Error("Invalid sketch number"));
    }
    setSketchStatus("Loading sketch #" + num + "…");
    return fetch(
      apiUrlLocal("/api/sketches/get?num=" + num + "&t=" + Date.now()),
      { cache: "no-store" }
    )
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        var sk = data && data.sketch;
        if (!sk || !Array.isArray(sk.curves) || !sk.curves.length) {
          throw new Error("Sketch empty or missing");
        }
        state.exprs = state.exprs.filter(function (r) {
          return r.text && String(r.text).trim() && !r.fromSketch;
        });
        lastSketchIds = [];
        sk.curves.forEach(function (curve) {
          var row = {
            id: uid(),
            text: String(curve),
            color: "#1a1a2e",
            opacity: 0.95,
            visible: true,
            error: "",
            kind: "empty",
            compiled: null,
            free: [],
            inTicker: true,
            fromSketch: true,
            sketchNum: sk.num,
          };
          state.exprs.push(row);
          lastSketchIds.push(row.id);
        });
        if (!state.exprs.length) {
          throw new Error("No curves in sketch");
        }
        recompileAll();
        renderList();
        renderSliders();
        zoomToFit();
        scheduleDraw();
        setSketchStatus(
          "Loaded sketch #" +
            sk.num +
            " · " +
            sk.curves.length +
            " curves" +
            (sk.preview_url ? " · " + sk.preview_url : ""),
          "ok"
        );
        if (sk.preview_url) {
          var img = new Image();
          img.crossOrigin = "anonymous";
          img.onload = function () {
            var c = document.createElement("canvas");
            c.width = img.naturalWidth || img.width;
            c.height = img.naturalHeight || img.height;
            c.getContext("2d").drawImage(img, 0, 0);
            showSketchPreview(c);
          };
          img.src =
            (typeof window.galleryApiUrl === "function"
              ? window.galleryApiUrl(sk.preview_url)
              : sk.preview_url) +
            (sk.preview_url.indexOf("?") >= 0 ? "&" : "?") +
            "t=" +
            Date.now();
        }
        return sk;
      });
  }

  function runImageSketch() {
    var api = window.GraphCalcImgTrace;
    if (!api || !api.imageToBezierExprs) {
      setSketchStatus("Image tracer failed to load — hard-refresh the page.", "err");
      return;
    }
    var detailEl = $("gc-sketch-detail");
    var maxEl = $("gc-sketch-max");
    var autoEl = $("gc-sketch-autosave");
    var detail = detailEl ? parseInt(detailEl.value, 10) : 7;
    var maxCurves = maxEl ? parseInt(maxEl.value, 10) : 900;
    var doSave = !autoEl || autoEl.checked;
    setSketchStatus("Tracing edges…");
    var runBtn = $("gc-sketch-run");
    if (runBtn) runBtn.disabled = true;
    var sourceUrl = "";

    resolveSketchImageUrl()
      .then(function (url) {
        sourceUrl = url;
        return api.imageToBezierExprs(url, {
          detail: detail,
          maxCurves: maxCurves,
          maxWidth: 520,
          flipY: true,
        });
      })
      .then(function (result) {
        if (!result || !result.exprs || !result.exprs.length) {
          if (runBtn) runBtn.disabled = false;
          setSketchStatus("No curves found — try higher detail or a higher-contrast image.", "err");
          if (result && result.preview) showSketchPreview(result.preview);
          return null;
        }
        if (result.preview) showSketchPreview(result.preview);
        // Drop empty placeholder rows
        state.exprs = state.exprs.filter(function (r) {
          return r.text && String(r.text).trim();
        });
        lastSketchIds = [];
        result.exprs.forEach(function (curve) {
          var row = {
            id: uid(),
            text: curve,
            color: "#1a1a2e",
            opacity: 0.95,
            visible: true,
            error: "",
            kind: "empty",
            compiled: null,
            free: [],
            inTicker: true,
            fromSketch: true,
          };
          state.exprs.push(row);
          lastSketchIds.push(row.id);
        });
        recompileAll();
        renderList();
        renderSliders();
        zoomToFit();
        scheduleDraw();

        var msg =
          "Sketched " +
          result.exprs.length +
          " curves from " +
          result.contourCount +
          " contours · Zoom fit";
        if (!doSave) {
          if (runBtn) runBtn.disabled = false;
          setSketchStatus(msg + " · not saved (auto-save off)", "ok");
          return null;
        }
        setSketchStatus(msg + " · saving to sketches/…");
        return saveSketchBatch({
          curves: result.exprs,
          source_url: sourceUrl.indexOf("blob:") === 0 ? "upload" : sourceUrl,
          width: result.width,
          height: result.height,
          detail: detail,
          maxCurves: maxCurves,
          contourCount: result.contourCount,
          preview_base64: previewCanvasToBase64(result.preview),
        })
          .then(function (saved) {
            if (runBtn) runBtn.disabled = false;
            lastSketchIds.forEach(function (id) {
              state.exprs.forEach(function (r) {
                if (r.id === id) r.sketchNum = saved.num;
              });
            });
            setSketchStatus(
              msg +
                " · saved as sketches/" +
                saved.num +
                ".json (#" +
                saved.num +
                ")",
              "ok"
            );
            refreshSketchLoadList();
            return saved;
          })
          .catch(function (err) {
            if (runBtn) runBtn.disabled = false;
            setSketchStatus(
              msg +
                " · save failed: " +
                ((err && err.message) || "is the gallery server running?"),
              "err"
            );
          });
      })
      .catch(function (err) {
        if (runBtn) runBtn.disabled = false;
        setSketchStatus((err && err.message) || "Sketch failed", "err");
      });
  }

  function clearLastSketch() {
    if (!lastSketchIds.length) {
      // fallback: remove all fromSketch
      var before = state.exprs.length;
      state.exprs = state.exprs.filter(function (r) {
        return !r.fromSketch;
      });
      if (state.exprs.length === before) {
        setSketchStatus("No sketch batch to clear.", "err");
        return;
      }
    } else {
      var drop = {};
      lastSketchIds.forEach(function (id) {
        drop[id] = 1;
      });
      state.exprs = state.exprs.filter(function (r) {
        return !drop[r.id];
      });
      lastSketchIds = [];
    }
    if (!state.exprs.length) addExpr("y = sin(x)");
    recompileAll();
    renderList();
    renderSliders();
    scheduleDraw();
    setSketchStatus("Cleared last sketch.", "ok");
  }

  function bindSketchPanel() {
    var src = $("gc-sketch-source");
    var detail = $("gc-sketch-detail");
    var detailVal = $("gc-sketch-detail-val");
    if (detail && detailVal) {
      detail.addEventListener("input", function () {
        detailVal.textContent = detail.value;
      });
    }
    if (src) {
      src.addEventListener("change", function () {
        loadSketchPickList(src.value);
      });
      loadSketchPickList(src.value);
    }
    var numIn = $("gc-sketch-num");
    var numGo = $("gc-sketch-num-go");
    var numPrev = $("gc-sketch-num-prev");
    var numNext = $("gc-sketch-num-next");
    if (numGo) numGo.addEventListener("click", previewSketchByNumber);
    if (numIn) {
      numIn.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter") {
          ev.preventDefault();
          previewSketchByNumber();
        }
      });
      numIn.addEventListener("change", function () {
        // clamp to min/max attributes
        var n = parseInt(numIn.value, 10);
        var lo = parseInt(numIn.min, 10) || 1;
        var hi = parseInt(numIn.max, 10) || n;
        if (isFinite(n)) {
          if (n < lo) numIn.value = String(lo);
          if (n > hi) numIn.value = String(hi);
        }
      });
    }
    function stepSketchNum(delta) {
      if (!numIn) return;
      var n = parseInt(numIn.value, 10) || 1;
      var lo = parseInt(numIn.min, 10) || 1;
      var hi = parseInt(numIn.max, 10) || 1000;
      n = Math.max(lo, Math.min(hi, n + delta));
      numIn.value = String(n);
      previewSketchByNumber();
    }
    if (numPrev) numPrev.addEventListener("click", function () {
      stepSketchNum(-1);
    });
    if (numNext) numNext.addEventListener("click", function () {
      stepSketchNum(1);
    });
    var file = $("gc-sketch-file");
    if (file) {
      file.addEventListener("change", function () {
        if (!file.files || !file.files[0]) return;
        var url = URL.createObjectURL(file.files[0]);
        window.GraphCalcImgTrace.loadImage(url)
          .then(function (img) {
            var c = document.createElement("canvas");
            var maxW = 160;
            var w = img.naturalWidth || img.width;
            var h = img.naturalHeight || img.height;
            if (w > maxW) {
              h = Math.round((h * maxW) / w);
              w = maxW;
            }
            c.width = w;
            c.height = h;
            c.getContext("2d").drawImage(img, 0, 0, w, h);
            showSketchPreview(c);
            setSketchStatus("Ready — Convert to curves");
          })
          .catch(function () {
            setSketchStatus("Could not read file", "err");
          });
      });
    }
    $("gc-sketch-run") &&
      $("gc-sketch-run").addEventListener("click", runImageSketch);
    $("gc-sketch-clear") &&
      $("gc-sketch-clear").addEventListener("click", clearLastSketch);
    var loadSel = $("gc-sketch-load");
    if (loadSel) {
      loadSel.addEventListener("change", function () {
        if (!loadSel.value) return;
        loadSketchByNum(loadSel.value).catch(function (err) {
          setSketchStatus((err && err.message) || "Load failed", "err");
        });
      });
    }
    refreshSketchLoadList();
  }

  window.GraphCalc = {
    onShow: onShow,
    onHide: onHide,
    redraw: scheduleDraw,
    pasteDesmos: pasteDesmos,
    zoomToFit: zoomToFit,
    sketchImage: runImageSketch,
  };
  window.addEventListener("graphcalc-show", onShow);
  window.addEventListener("graphcalc-hide", onHide);
})();
