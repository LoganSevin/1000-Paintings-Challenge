/**
 * Math — one shot runs a solved route. Gauges and switches rewrite the object.
 * The point cloud is that object.
 */
(function () {
  "use strict";

  function num(n) {
    if (!isFinite(n)) return "—";
    var v = Math.round(n * 100) / 100;
    if (Object.is(v, -0)) v = 0;
    return String(v);
  }

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }

  function solveLinear(A, b) {
    var n = b.length;
    var M = [];
    var i;
    var j;
    var col;
    var max;
    var f;
    var tmp;
    for (i = 0; i < n; i++) M.push(A[i].concat([b[i]]));
    for (col = 0; col < n; col++) {
      max = col;
      for (i = col + 1; i < n; i++) {
        if (Math.abs(M[i][col]) > Math.abs(M[max][col])) max = i;
      }
      tmp = M[col];
      M[col] = M[max];
      M[max] = tmp;
      if (Math.abs(M[col][col]) < 1e-10) return null;
      for (i = col + 1; i < n; i++) {
        f = M[i][col] / M[col][col];
        for (j = col; j <= n; j++) M[i][j] -= f * M[col][j];
      }
    }
    var x = new Array(n);
    for (i = n - 1; i >= 0; i--) {
      x[i] = M[i][n];
      for (j = i + 1; j < n; j++) x[i] -= M[i][j] * x[j];
      x[i] /= M[i][i];
    }
    return x;
  }

  function cmul(a, b) {
    return [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
  }

  function cdiv(a, b) {
    var d = b[0] * b[0] + b[1] * b[1] || 1e-12;
    return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d];
  }

  function polyAt(z, n, a, b) {
    var p = [1, 0];
    var k;
    for (k = 0; k < n; k++) p = cmul(p, z);
    p[0] += a * z[0] + b;
    p[1] += a * z[1];
    return p;
  }

  function durandKerner(n, a, b) {
    var radius = Math.pow(Math.abs(b) + Math.abs(a) + 0.35, 1 / n);
    var z = [];
    var k;
    var iter;
    var i;
    var j;
    for (k = 0; k < n; k++) {
      var ang = (2 * Math.PI * k) / n + 0.37;
      z.push([radius * Math.cos(ang), radius * Math.sin(ang)]);
    }
    for (iter = 0; iter < 48; iter++) {
      for (i = 0; i < n; i++) {
        var den = [1, 0];
        for (j = 0; j < n; j++) {
          if (j === i) continue;
          den = cmul(den, [z[i][0] - z[j][0], z[i][1] - z[j][1]]);
        }
        var step = cdiv(polyAt(z[i], n, a, b), den);
        z[i][0] -= step[0];
        z[i][1] -= step[1];
      }
    }
    return z;
  }

  function rk4(accel, x, v, dt) {
    var k1x = v;
    var k1v = accel(x, v);
    var k2x = v + k1v * dt / 2;
    var k2v = accel(x + k1x * dt / 2, v + k1v * dt / 2);
    var k3x = v + k2v * dt / 2;
    var k3v = accel(x + k2x * dt / 2, v + k2v * dt / 2);
    var k4x = v + k3v * dt;
    var k4v = accel(x + k3x * dt, v + k3v * dt);
    return [
      x + (k1x + 2 * k2x + 2 * k3x + k4x) * dt / 6,
      v + (k1v + 2 * k2v + 2 * k3v + k4v) * dt / 6,
    ];
  }

  function hash01(i) {
    var x = Math.sin(i * 127.1 + 1.7) * 43758.5453;
    return x - Math.floor(x);
  }

  function pieceGaps(g) {
    var left = g.a * g.p + g.b;
    var midAtQ = g.m + g.d * (g.q - g.p);
    return {
      left: left,
      midAtQ: midAtQ,
      g1: g.m - left,
      g2: g.e - midAtQ,
      solvedM: left,
      solvedE: left + g.d * (g.q - g.p),
    };
  }

  function criticalOf(g) {
    var det = 4 * g.a * g.b - g.c * g.c;
    if (Math.abs(det) < 1e-6) return { det: det, x: null, y: null, kind: "degenerate" };
    var x = (-2 * g.b * g.d + g.c * g.e) / det;
    var y = (-2 * g.a * g.e + g.c * g.d) / det;
    var kind = "saddle";
    if (det > 0 && g.a > 0) kind = "minimum";
    else if (det > 0 && g.a < 0) kind = "maximum";
    return { det: det, x: x, y: y, kind: kind };
  }

  function surface(g, x, y) {
    return g.a * x * x + g.b * y * y + g.c * x * y + g.d * x + g.e * y;
  }

  function mapMatrix(g, sw) {
    var m = [[1, 0], [0, 1]];
    function mul(A, B) {
      return [
        [A[0][0] * B[0][0] + A[0][1] * B[1][0], A[0][0] * B[0][1] + A[0][1] * B[1][1]],
        [A[1][0] * B[0][0] + A[1][1] * B[1][0], A[1][0] * B[0][1] + A[1][1] * B[1][1]],
      ];
    }
    if (sw.rotate) {
      var c = Math.cos(g.theta);
      var s = Math.sin(g.theta);
      m = mul([[c, -s], [s, c]], m);
    }
    if (sw.shear) m = mul([[1, g.shear], [0, 1]], m);
    if (sw.reflect) m = mul([[-1, 0], [0, 1]], m);
    return m;
  }

  function squarePartial(x, n) {
    var s = 0;
    var k;
    for (k = 0; k < n; k++) {
      var h = 2 * k + 1;
      s += Math.sin(h * x) / h;
    }
    return (4 / Math.PI) * s;
  }

  function sawPartial(x, n) {
    var s = 0;
    var k;
    for (k = 1; k <= n; k++) s += Math.sin(k * x) / k;
    return s;
  }

  function fourierPeak(kind, n) {
    var fn = kind === "saw" ? sawPartial : squarePartial;
    var best = 0;
    var i;
    var samples = 240;
    for (i = 1; i < samples; i++) {
      var x = (i / samples) * Math.PI;
      var y = fn(x, n);
      if (y > best) best = y;
    }
    return best;
  }

  function trajectory(g, pendulum) {
    var x = g.x0;
    var v = g.v0;
    var mu = g.mu;
    var dt = 0.025;
    var steps = 1400;
    var pts = [];
    var i;
    function accel(px, pv) {
      if (pendulum) return -mu * pv - Math.sin(px);
      return -mu * (px * px - 1) * pv - px;
    }
    for (i = 0; i < steps; i++) {
      if (i % 2 === 0) pts.push({ x: x, v: v, t: i * dt });
      var next = rk4(accel, x, v, dt);
      x = next[0];
      v = next[1];
    }
    return pts;
  }

  function fitCloud(g, sw) {
    var xs = [];
    var ys = [];
    var i;
    var count = 28;
    for (i = 0; i < count; i++) {
      var x = -1.4 + (2.8 * i) / (count - 1);
      var clean = 0.5 * x * x - x + 0.3;
      var shake = (hash01(i + 3) - 0.5) * g.noise;
      xs.push(x);
      ys.push(clean + shake);
    }
    var degree = clamp(Math.round(g.degree), 1, 3);
    var m = degree + 1;
    var A = [];
    var b = [];
    var r;
    var c;
    for (r = 0; r < m; r++) {
      A.push([]);
      b.push(0);
      for (c = 0; c < m; c++) A[r].push(0);
    }
    for (i = 0; i < count; i++) {
      var pow = [];
      var p = 1;
      for (r = 0; r < m * 2; r++) {
        pow.push(p);
        p *= xs[i];
      }
      for (r = 0; r < m; r++) {
        b[r] += ys[i] * pow[r];
        for (c = 0; c < m; c++) A[r][c] += pow[r + c];
      }
    }
    if (sw.ridge) {
      for (r = 0; r < m; r++) A[r][r] += g.lambda;
    }
    return { xs: xs, ys: ys, coeff: solveLinear(A, b), degree: degree };
  }

  function evalPoly(coeff, x) {
    var y = 0;
    var p = 1;
    var i;
    for (i = 0; i < coeff.length; i++) {
      y += coeff[i] * p;
      p *= x;
    }
    return y;
  }

  var BLUE = [183, 211, 255];
  var GOLD = [255, 224, 138];
  var PINK = [240, 196, 234];
  var MINT = [183, 226, 180];
  var RED = [255, 150, 138];
  var WHITE = [244, 241, 234];

  var PROBLEMS = [
    {
      id: "piece",
      title: "Piecewise",
      camera: { yaw: 0.5, pitch: 0.35, dist: 4.4 },
      statement: "Three pieces meet at two breaks. The cloud splits where a gauge disagrees. One shot solves the two joins and closes the cloud.",
      gauges: [
        { id: "a", label: "Left slope", min: -3, max: 3, step: 0.05, value: 1.2 },
        { id: "b", label: "Left intercept", min: -3, max: 3, step: 0.05, value: -0.4 },
        { id: "p", label: "First break", min: -2.5, max: 1, step: 0.05, value: -0.5 },
        { id: "m", label: "Middle start", min: -3, max: 3, step: 0.05, value: 1.5 },
        { id: "d", label: "Middle slope", min: -3, max: 3, step: 0.05, value: -0.8 },
        { id: "q", label: "Second break", min: -1, max: 3.2, step: 0.05, value: 1.4 },
        { id: "e", label: "Right start", min: -3, max: 3, step: 0.05, value: -0.6 },
        { id: "s", label: "Right bend", min: -2, max: 2, step: 0.05, value: 0.7 },
      ],
      switches: [
        { id: "left", label: "Left piece", on: true },
        { id: "mid", label: "Middle piece", on: true },
        { id: "right", label: "Right piece", on: true },
      ],
      constrain: function (state) {
        if (state.g.q < state.g.p + 0.2) state.g.q = state.g.p + 0.2;
      },
      solve: function (state) {
        var gap = pieceGaps(state.g);
        state.g.m = gap.solvedM;
        state.g.e = gap.solvedE;
        state.sw.left = true;
        state.sw.mid = true;
        state.sw.right = true;
      },
      actions: [
        { name: "Close first break", run: function (state) { state.g.m = pieceGaps(state.g).solvedM; state.sw.left = true; state.sw.mid = true; } },
        { name: "Close second break", run: function (state) { state.g.e = pieceGaps(state.g).midAtQ; state.sw.mid = true; state.sw.right = true; } },
      ],
      formula: function (state) {
        var g = state.g;
        return [
          { on: state.sw.left, text: "left    " + num(g.a) + " x + " + num(g.b) + "    when x < " + num(g.p) },
          { on: state.sw.mid, text: "middle  " + num(g.m) + " + " + num(g.d) + " (x − " + num(g.p) + ")    when " + num(g.p) + " ≤ x < " + num(g.q) },
          { on: state.sw.right, text: "right   " + num(g.e) + " + " + num(g.s) + " (x − " + num(g.q) + ")²    when x ≥ " + num(g.q) },
        ];
      },
      route: function (state) {
        var gap = pieceGaps(state.g);
        return [
          { text: "Arm the left piece.", met: !!state.sw.left },
          { text: "Set the middle start to the left value at the first break.", met: !!state.sw.mid && Math.abs(gap.g1) < 0.06 },
          { text: "Arm the middle piece across to the second break.", met: !!state.sw.mid },
          { text: "Set the right start to the middle value there.", met: !!state.sw.right && Math.abs(gap.g2) < 0.06 },
          { text: "Both joins read as closed.", met: state.sw.left && state.sw.mid && state.sw.right && Math.abs(gap.g1) < 0.06 && Math.abs(gap.g2) < 0.06 },
        ];
      },
      answer: function (state) {
        var gap = pieceGaps(state.g);
        var closed = Math.abs(gap.g1) < 0.06 && Math.abs(gap.g2) < 0.06;
        return (closed ? "Gaps closed. " : "Gaps open. ") +
          "Solved middle start " + num(gap.solvedM) + ", solved right start " + num(gap.solvedE) +
          ". Live gaps " + num(gap.g1) + " and " + num(gap.g2) + ".";
      },
      cloud: function (state) {
        var g = state.g;
        var pts = [];
        var gap = pieceGaps(g);
        function ribbon(x0, x1, z, rgb, fn) {
          var i;
          var j;
          for (i = 0; i <= 70; i++) {
            var x = x0 + ((x1 - x0) * i) / 70;
            var y = fn(x);
            for (j = 0; j < 4; j++) pts.push({ x: x, y: y, z: z + (j - 1.5) * 0.08, rgb: rgb });
          }
        }
        if (state.sw.left) ribbon(-3.4, g.p, 0.2, BLUE, function (x) { return g.a * x + g.b; });
        if (state.sw.mid) ribbon(g.p, g.q, 0, GOLD, function (x) { return g.m + g.d * (x - g.p); });
        if (state.sw.right) ribbon(g.q, 3.6, -0.2, PINK, function (x) { return g.e + g.s * (x - g.q) * (x - g.q); });
        if (state.sw.left && state.sw.mid) {
          pts.push({ x: g.p, y: gap.left, z: 0, rgb: Math.abs(gap.g1) < 0.06 ? MINT : RED, big: true });
          pts.push({ x: g.p, y: g.m, z: 0, rgb: Math.abs(gap.g1) < 0.06 ? MINT : RED, big: true });
        }
        if (state.sw.mid && state.sw.right) {
          pts.push({ x: g.q, y: gap.midAtQ, z: 0, rgb: Math.abs(gap.g2) < 0.06 ? MINT : RED, big: true });
          pts.push({ x: g.q, y: g.e, z: 0, rgb: Math.abs(gap.g2) < 0.06 ? MINT : RED, big: true });
        }
        return pts;
      },
    },
    {
      id: "critical",
      title: "Critical point",
      camera: { yaw: 0.85, pitch: 0.7, dist: 4.6 },
      statement: "The surface is a quadratic. One shot moves the tilt so the critical point sits on the target (1, -1). The marker is the solved point.",
      gauges: [
        { id: "a", label: "x² weight", min: -2, max: 2, step: 0.05, value: 0.8 },
        { id: "b", label: "y² weight", min: -2, max: 2, step: 0.05, value: 0.6 },
        { id: "c", label: "xy weight", min: -2, max: 2, step: 0.05, value: 0.3 },
        { id: "d", label: "x tilt", min: -3, max: 3, step: 0.05, value: 0.4 },
        { id: "e", label: "y tilt", min: -3, max: 3, step: 0.05, value: -0.5 },
      ],
      switches: [
        { id: "marker", label: "Critical marker", on: true },
        { id: "target", label: "Target (1, -1)", on: true },
      ],
      solve: function (state) {
        state.g.d = -2 * state.g.a + state.g.c;
        state.g.e = -state.g.c + 2 * state.g.b;
        state.sw.marker = true;
        state.sw.target = true;
      },
      actions: [
        { name: "Flatten the tilt", run: function (state) { state.g.d = 0; state.g.e = 0; } },
        { name: "Force a saddle", run: function (state) { state.g.a = 1; state.g.b = -1; state.g.c = 0; } },
      ],
      formula: function (state) {
        var g = state.g;
        var hit = criticalOf(g);
        return [
          { on: true, text: "f = " + num(g.a) + " x² + " + num(g.b) + " y² + " + num(g.c) + " xy + " + num(g.d) + " x + " + num(g.e) + " y" },
          { on: state.sw.marker, text: "∇f = 0 at (" + (hit.x == null ? "—" : num(hit.x)) + ", " + (hit.y == null ? "—" : num(hit.y)) + ")" },
          { on: state.sw.target, text: "target (1, -1)" },
        ];
      },
      route: function (state) {
        var hit = criticalOf(state.g);
        var dist = hit.x == null ? 99 : Math.hypot(hit.x - 1, hit.y + 1);
        return [
          { text: "Read the Hessian determinant 4ab − c².", met: true },
          { text: "Solve the 2×2 gradient system.", met: hit.x != null },
          { text: "Keep the marker on that point.", met: !!state.sw.marker && hit.x != null },
          { text: "Land the point on (1, -1).", met: dist < 0.08 },
        ];
      },
      answer: function (state) {
        var hit = criticalOf(state.g);
        if (hit.x == null) return "Solved target is (1, -1). This Hessian is degenerate, so the critical set is not one point. det = " + num(hit.det) + ".";
        var dist = Math.hypot(hit.x - 1, hit.y + 1);
        return "Solved critical point (" + num(hit.x) + ", " + num(hit.y) + "), a " + hit.kind +
          ". Target (1, -1). Distance " + num(dist) + ". det = " + num(hit.det) + ".";
      },
      cloud: function (state) {
        var g = state.g;
        var pts = [];
        var i;
        var j;
        for (i = 0; i < 36; i++) {
          for (j = 0; j < 36; j++) {
            var x = -2.2 + (4.4 * i) / 35;
            var y = -2.2 + (4.4 * j) / 35;
            var z = surface(g, x, y);
            var t = clamp(0.5 + z / 6, 0, 1);
            pts.push({ x: x, y: z * 0.35, z: y, rgb: [80 + t * 160, 90 + (1 - t) * 80, 120] });
          }
        }
        var hit = criticalOf(g);
        if (state.sw.marker && hit.x != null) {
          pts.push({ x: hit.x, y: surface(g, hit.x, hit.y) * 0.35, z: hit.y, rgb: GOLD, big: true });
        }
        if (state.sw.target) pts.push({ x: 1, y: surface(g, 1, -1) * 0.35, z: -1, rgb: RED, big: true });
        return pts;
      },
    },
    {
      id: "linear",
      title: "Linear map",
      camera: { yaw: 0.6, pitch: 0.5, dist: 4.2 },
      statement: "A cloud is sent through a matrix built from the switches. One shot makes that matrix a quarter turn, which keeps area.",
      gauges: [
        { id: "theta", label: "Turn", min: -3.14, max: 3.14, step: 0.01, value: 0.6 },
        { id: "shear", label: "Shear", min: -1.5, max: 1.5, step: 0.05, value: 0.4 },
      ],
      switches: [
        { id: "rotate", label: "Rotate", on: true },
        { id: "shear", label: "Shear", on: true },
        { id: "reflect", label: "Reflect x", on: false },
      ],
      solve: function (state) {
        state.g.theta = Math.PI / 2;
        state.sw.rotate = true;
        state.sw.shear = false;
        state.sw.reflect = false;
      },
      actions: [
        { name: "Drop the shear", run: function (state) { state.sw.shear = false; } },
        { name: "Flip x", run: function (state) { state.sw.reflect = !state.sw.reflect; } },
      ],
      formula: function (state) {
        var m = mapMatrix(state.g, state.sw);
        var det = m[0][0] * m[1][1] - m[0][1] * m[1][0];
        return [
          { on: state.sw.rotate, text: "rotate by " + num(state.g.theta) },
          { on: state.sw.shear, text: "then shear " + num(state.g.shear) },
          { on: state.sw.reflect, text: "then reflect x" },
          { on: true, text: "matrix [[" + num(m[0][0]) + ", " + num(m[0][1]) + "], [" + num(m[1][0]) + ", " + num(m[1][1]) + "]]  det " + num(det) },
        ];
      },
      route: function (state) {
        var m = mapMatrix(state.g, state.sw);
        var det = m[0][0] * m[1][1] - m[0][1] * m[1][0];
        return [
          { text: "Turn rotation on.", met: !!state.sw.rotate },
          { text: "Take the shear off so the columns stay perpendicular.", met: !state.sw.shear },
          { text: "Leave reflection off so orientation stays.", met: !state.sw.reflect },
          { text: "Set the turn to a right angle.", met: Math.abs(state.g.theta - Math.PI / 2) < 0.06 },
          { text: "Determinant is 1.", met: Math.abs(det - 1) < 0.06 },
        ];
      },
      answer: function (state) {
        var m = mapMatrix(state.g, state.sw);
        var det = m[0][0] * m[1][1] - m[0][1] * m[1][0];
        var image = [m[0][0], m[1][0]];
        return "Solved quarter turn sends (1, 0) to (0, 1) and keeps det 1. Live image of (1, 0) is (" +
          num(image[0]) + ", " + num(image[1]) + "). det = " + num(det) + ".";
      },
      cloud: function (state) {
        var m = mapMatrix(state.g, state.sw);
        var pts = [];
        var i;
        var k;
        for (k = 0; k < 5; k++) {
          var z = -0.6 + k * 0.3;
          for (i = 0; i < 64; i++) {
            var ang = (i / 64) * Math.PI * 2;
            var x = Math.cos(ang);
            var y = Math.sin(ang);
            pts.push({ x: x, y: y, z: z, rgb: [70, 68, 64] });
            pts.push({ x: m[0][0] * x + m[0][1] * y, y: m[1][0] * x + m[1][1] * y, z: z, rgb: BLUE });
          }
        }
        return pts;
      },
    },
    {
      id: "fourier",
      title: "Fourier",
      camera: { yaw: 0.4, pitch: 0.25, dist: 4.8 },
      statement: "A square wave is a stack of odd harmonics. One shot raises the stack and measures the Gibbs overshoot past the jump.",
      gauges: [
        { id: "n", label: "Harmonics", min: 1, max: 24, step: 1, value: 3 },
      ],
      switches: [
        { id: "square", label: "Square wave", on: true },
        { id: "layers", label: "Show each harmonic", on: true },
      ],
      solve: function (state) {
        state.g.n = 17;
        state.sw.square = true;
        state.sw.layers = true;
      },
      actions: [
        { name: "Add one harmonic", run: function (state) { state.g.n = clamp(Math.round(state.g.n) + 1, 1, 24); } },
        { name: "Use the saw", run: function (state) { state.sw.square = !state.sw.square; } },
      ],
      formula: function (state) {
        var n = Math.round(state.g.n);
        var kind = state.sw.square ? "square" : "saw";
        var peak = fourierPeak(kind, n);
        return [
          { on: state.sw.square, text: "square  (4/π) Σ sin((2k+1) x) / (2k+1)    N = " + n },
          { on: !state.sw.square, text: "saw  Σ sin(k x) / k    N = " + n },
          { on: true, text: "first peak " + num(peak) },
        ];
      },
      route: function (state) {
        var n = Math.round(state.g.n);
        var peak = fourierPeak(state.sw.square ? "square" : "saw", n);
        return [
          { text: "Use the square wave.", met: !!state.sw.square },
          { text: "Keep at least nine harmonics.", met: !!state.sw.square && n >= 9 },
          { text: "Read the first peak after the jump.", met: true },
          { text: "The peak sits near the Gibbs value 1.18.", met: !!state.sw.square && Math.abs(peak - 1.179) < 0.05 },
        ];
      },
      answer: function (state) {
        var n = Math.round(state.g.n);
        var kind = state.sw.square ? "square" : "saw";
        var peak = fourierPeak(kind, n);
        if (!state.sw.square) return "Solved square-wave spike is about 1.18, the Gibbs overshoot. This saw's first peak is " + num(peak) + ".";
        return "Gibbs overshoot. Solved spike is about 1.18 for a jump of height 1. Live first peak is " + num(peak) + " with " + n + " harmonics. Overshoot " + num(peak - 1) + ".";
      },
      cloud: function (state) {
        var n = Math.round(state.g.n);
        var square = !!state.sw.square;
        var pts = [];
        var i;
        var k;
        var samples = 180;
        for (i = 0; i <= samples; i++) {
          var x = -Math.PI + (2 * Math.PI * i) / samples;
          var y = square ? squarePartial(x, n) : sawPartial(x, n);
          pts.push({ x: x, y: y, z: 0, rgb: WHITE });
        }
        if (state.sw.layers) {
          var limit = Math.min(n, 12);
          for (k = 0; k < limit; k++) {
            var harm = square ? 2 * k + 1 : k + 1;
            var amp = square ? (4 / Math.PI) / harm : 1 / harm;
            for (i = 0; i <= 80; i++) {
              var hx = -Math.PI + (2 * Math.PI * i) / 80;
              pts.push({
                x: hx,
                y: amp * Math.sin(harm * hx),
                z: 0.25 + k * 0.18,
                rgb: k % 2 ? BLUE : GOLD,
              });
            }
          }
        }
        return pts;
      },
    },
    {
      id: "oscillator",
      title: "Oscillator",
      camera: { yaw: 0.9, pitch: 0.55, dist: 4.5 },
      statement: "Van der Pol grows a limit cycle near amplitude 2. One shot sets the damping and integrates the orbit. Switch to the pendulum and it falls to rest.",
      gauges: [
        { id: "mu", label: "Damping μ", min: 0, max: 3, step: 0.05, value: 0.15 },
        { id: "x0", label: "Start x", min: -2.5, max: 2.5, step: 0.05, value: 0.2 },
        { id: "v0", label: "Start v", min: -2.5, max: 2.5, step: 0.05, value: 0 },
      ],
      switches: [
        { id: "cycle", label: "Van der Pol", on: true },
        { id: "pendulum", label: "Pendulum", on: false },
      ],
      solve: function (state) {
        state.g.mu = 1.2;
        state.g.x0 = 0.2;
        state.g.v0 = 0;
        state.sw.cycle = true;
        state.sw.pendulum = false;
      },
      actions: [
        { name: "Swap to the pendulum", run: function (state) { state.sw.pendulum = !state.sw.pendulum; state.sw.cycle = !state.sw.pendulum; } },
        { name: "Release from rest", run: function (state) { state.g.v0 = 0; } },
      ],
      formula: function (state) {
        var pendulum = !!state.sw.pendulum;
        return [
          { on: !pendulum && state.sw.cycle, text: "x″ + " + num(state.g.mu) + " (x² − 1) x′ + x = 0" },
          { on: pendulum, text: "x″ + " + num(state.g.mu) + " x′ + sin x = 0" },
          { on: true, text: "start (" + num(state.g.x0) + ", " + num(state.g.v0) + ")" },
        ];
      },
      route: function (state) {
        var pendulum = !!state.sw.pendulum;
        var pts = trajectory(state.g, pendulum);
        var amp = 0;
        var i;
        var start = Math.floor(pts.length * 0.7);
        for (i = start; i < pts.length; i++) if (Math.abs(pts[i].x) > amp) amp = Math.abs(pts[i].x);
        return [
          { text: "Stay on Van der Pol.", met: !pendulum && !!state.sw.cycle },
          { text: "Put μ in the cycle range.", met: !pendulum && state.g.mu > 0.5 },
          { text: "Integrate the orbit.", met: pts.length > 100 },
          { text: "The late amplitude sits near 2.", met: !pendulum && amp > 1.4 && amp < 2.6 },
        ];
      },
      answer: function (state) {
        var pendulum = !!state.sw.pendulum;
        var pts = trajectory(state.g, pendulum);
        var amp = 0;
        var i;
        var start = Math.floor(pts.length * 0.7);
        for (i = start; i < pts.length; i++) if (Math.abs(pts[i].x) > amp) amp = Math.abs(pts[i].x);
        if (pendulum) return "Solved pendulum equilibrium is 0. Live late amplitude is " + num(amp) + ".";
        return "Solved Van der Pol limit cycle has amplitude about 2. Live late amplitude is " + num(amp) + " at μ = " + num(state.g.mu) + ".";
      },
      cloud: function (state) {
        var pendulum = !!state.sw.pendulum;
        var samples = trajectory(state.g, pendulum);
        var pts = [];
        var i;
        for (i = 0; i < samples.length; i++) {
          var t = i / samples.length;
          pts.push({
            x: samples[i].x * 0.7,
            y: samples[i].v * 0.7,
            z: (samples[i].t / 35) - 0.6,
            rgb: pendulum ? PINK : [120 + t * 120, 170, 220],
          });
        }
        return pts;
      },
    },
    {
      id: "roots",
      title: "Roots",
      camera: { yaw: 0.7, pitch: 0.85, dist: 4.2 },
      statement: "Durand–Kerner finds the roots of zⁿ + a z + b. One shot solves z⁴ − 1 = 0. The cloud is those roots, lifted by size.",
      gauges: [
        { id: "n", label: "Degree", min: 2, max: 6, step: 1, value: 3 },
        { id: "a", label: "a", min: -2, max: 2, step: 0.05, value: 0.5 },
        { id: "b", label: "b", min: -2, max: 2, step: 0.05, value: 0.4 },
      ],
      switches: [
        { id: "lift", label: "Lift by modulus", on: true },
        { id: "axes", label: "Keep the plane", on: true },
      ],
      solve: function (state) {
        state.g.n = 4;
        state.g.a = 0;
        state.g.b = -1;
        state.sw.lift = true;
      },
      actions: [
        { name: "Conjugate pair", run: function (state) { state.g.a = 0; } },
        { name: "Degree up", run: function (state) { state.g.n = clamp(Math.round(state.g.n) + 1, 2, 6); } },
      ],
      formula: function (state) {
        return [
          { on: true, text: "z^" + Math.round(state.g.n) + " + " + num(state.g.a) + " z + " + num(state.g.b) + " = 0" },
          { on: state.sw.lift, text: "height = |z|" },
        ];
      },
      route: function (state) {
        var roots = durandKerner(Math.round(state.g.n), state.g.a, state.g.b);
        var want = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        var hit = 0;
        var i;
        var j;
        if (roots.length === 4) {
          for (i = 0; i < 4; i++) {
            for (j = 0; j < 4; j++) {
              if (Math.hypot(roots[j][0] - want[i][0], roots[j][1] - want[i][1]) < 0.12) hit += 1;
            }
          }
        }
        return [
          { text: "Set the degree to 4.", met: Math.round(state.g.n) === 4 },
          { text: "Clear the z term.", met: Math.abs(state.g.a) < 0.05 },
          { text: "Set the constant to −1.", met: Math.abs(state.g.b + 1) < 0.05 },
          { text: "The four roots land on 1, −1, i, −i.", met: hit >= 4 },
        ];
      },
      answer: function (state) {
        var n = Math.round(state.g.n);
        var roots = durandKerner(n, state.g.a, state.g.b);
        var text = roots.map(function (z) { return "(" + num(z[0]) + ", " + num(z[1]) + ")"; }).join("  ");
        return "Solved z⁴ − 1 = 0 has roots 1, −1, i, −i. Live roots of degree " + n + ": " + text + ".";
      },
      cloud: function (state) {
        var n = Math.round(state.g.n);
        var roots = durandKerner(n, state.g.a, state.g.b);
        var pts = [];
        var i;
        var k;
        if (state.sw.axes) {
          for (i = 0; i <= 40; i++) {
            var t = -1.6 + (3.2 * i) / 40;
            pts.push({ x: t, y: 0, z: 0, rgb: [60, 58, 54] });
            pts.push({ x: 0, y: 0, z: t, rgb: [60, 58, 54] });
          }
        }
        for (k = 0; k < roots.length; k++) {
          var mod = Math.hypot(roots[k][0], roots[k][1]);
          var y = state.sw.lift ? mod : 0;
          for (i = 0; i < 10; i++) {
            pts.push({ x: roots[k][0], y: y, z: roots[k][1], rgb: GOLD, big: true });
          }
        }
        return pts;
      },
    },
    {
      id: "fit",
      title: "Fit",
      camera: { yaw: 0.45, pitch: 0.4, dist: 4.3 },
      statement: "The cloud was built from 0.50 x² − x + 0.30, then shaken. One shot silences the shake, fits degree 2, and recovers that quadratic.",
      gauges: [
        { id: "noise", label: "Shake", min: 0, max: 1.4, step: 0.02, value: 0.7 },
        { id: "degree", label: "Degree", min: 1, max: 3, step: 1, value: 1 },
        { id: "lambda", label: "Ridge", min: 0, max: 1, step: 0.02, value: 0.2 },
      ],
      switches: [
        { id: "ridge", label: "Ridge penalty", on: false },
        { id: "curve", label: "Show the fit", on: true },
      ],
      solve: function (state) {
        state.g.noise = 0;
        state.g.degree = 2;
        state.sw.ridge = false;
        state.sw.curve = true;
      },
      actions: [
        { name: "Silence the shake", run: function (state) { state.g.noise = 0; } },
        { name: "Penalize the fit", run: function (state) { state.sw.ridge = !state.sw.ridge; } },
      ],
      formula: function (state) {
        var fit = fitCloud(state.g, state.sw);
        var coeff = fit.coeff || [];
        var text = coeff.map(function (c, i) { return num(c) + (i ? " x^" + i : ""); }).join(" + ");
        return [
          { on: true, text: "truth  0.50 x² − x + 0.30" },
          { on: state.sw.curve, text: "fit  " + (text || "—") },
          { on: state.sw.ridge, text: "ridge λ = " + num(state.g.lambda) },
        ];
      },
      route: function (state) {
        var fit = fitCloud(state.g, state.sw);
        var c = fit.coeff || [];
        var close = c.length === 3 && Math.abs(c[0] - 0.3) < 0.08 && Math.abs(c[1] + 1) < 0.08 && Math.abs(c[2] - 0.5) < 0.08;
        return [
          { text: "Silence the shake.", met: state.g.noise < 0.02 },
          { text: "Ask for degree 2.", met: Math.round(state.g.degree) === 2 },
          { text: "Leave the ridge off.", met: !state.sw.ridge },
          { text: "The coefficients match 0.30, −1, 0.50.", met: close },
        ];
      },
      answer: function (state) {
        var fit = fitCloud(state.g, state.sw);
        var c = fit.coeff || [0, 0];
        var shown = c.map(function (v, i) { return num(v) + (i ? " x^" + i : ""); }).join(" + ");
        return "Solved source is 0.50 x² − x + 0.30. Live fit is " + shown + ".";
      },
      cloud: function (state) {
        var fit = fitCloud(state.g, state.sw);
        var pts = [];
        var i;
        for (i = 0; i < fit.xs.length; i++) {
          pts.push({ x: fit.xs[i], y: fit.ys[i], z: 0, rgb: WHITE, big: true });
        }
        if (state.sw.curve && fit.coeff) {
          for (i = 0; i <= 80; i++) {
            var x = -1.5 + (3 * i) / 80;
            pts.push({ x: x, y: evalPoly(fit.coeff, x), z: 0.15, rgb: GOLD });
          }
        }
        return pts;
      },
    },
    {
      id: "divergence",
      title: "Divergence",
      camera: { yaw: 0.8, pitch: 0.6, dist: 4.4 },
      statement: "A linear field F = (a x + b y, c x + d y, e z) has constant divergence a + d + e. One shot sets e so the divergence, and the flux through the unit cube, is zero.",
      gauges: [
        { id: "a", label: "a", min: -2, max: 2, step: 0.05, value: 1 },
        { id: "b", label: "b", min: -2, max: 2, step: 0.05, value: 0.4 },
        { id: "c", label: "c", min: -2, max: 2, step: 0.05, value: -0.3 },
        { id: "d", label: "d", min: -2, max: 2, step: 0.05, value: 0.5 },
        { id: "e", label: "e", min: -2, max: 2, step: 0.05, value: 0.8 },
      ],
      switches: [
        { id: "zterm", label: "Use the z term", on: true },
        { id: "flow", label: "Push points along F", on: true },
      ],
      solve: function (state) {
        state.sw.zterm = true;
        state.g.e = -(state.g.a + state.g.d);
      },
      actions: [
        { name: "Cancel a and d", run: function (state) { state.sw.zterm = true; state.g.e = -(state.g.a + state.g.d); } },
        { name: "Drop the z term", run: function (state) { state.sw.zterm = false; } },
      ],
      formula: function (state) {
        var e = state.sw.zterm ? state.g.e : 0;
        var div = state.g.a + state.g.d + e;
        return [
          { on: true, text: "F = (" + num(state.g.a) + " x + " + num(state.g.b) + " y,  " + num(state.g.c) + " x + " + num(state.g.d) + " y,  " + num(e) + " z)" },
          { on: true, text: "div F = " + num(div) + "    flux of the unit cube = " + num(div) },
        ];
      },
      route: function (state) {
        var e = state.sw.zterm ? state.g.e : 0;
        var div = state.g.a + state.g.d + e;
        return [
          { text: "Keep the z term in the field.", met: !!state.sw.zterm },
          { text: "Read div F = a + d + e.", met: true },
          { text: "Set e = −(a + d).", met: !!state.sw.zterm && Math.abs(state.g.e + state.g.a + state.g.d) < 0.06 },
          { text: "Divergence, and the cube's flux, is 0.", met: Math.abs(div) < 0.06 },
        ];
      },
      answer: function (state) {
        var e = state.sw.zterm ? state.g.e : 0;
        var div = state.g.a + state.g.d + e;
        var solved = -(state.g.a + state.g.d);
        return "Solved e = −(a + d) = " + num(solved) + ". Live div F = " + num(div) + ". Flux through the unit cube is " + num(div) + ".";
      },
      cloud: function (state) {
        var e = state.sw.zterm ? state.g.e : 0;
        var div = state.g.a + state.g.d + e;
        var pts = [];
        var i;
        var j;
        var k;
        var tint = div >= 0 ? GOLD : BLUE;
        for (i = 0; i < 7; i++) {
          for (j = 0; j < 7; j++) {
            for (k = 0; k < 7; k++) {
              var x = -1 + i / 3;
              var y = -1 + j / 3;
              var z = -1 + k / 3;
              var fx = state.g.a * x + state.g.b * y;
              var fy = state.g.c * x + state.g.d * y;
              var fz = e * z;
              var push = state.sw.flow ? 0.18 : 0;
              pts.push({ x: x + fx * push, y: y + fy * push, z: z + fz * push, rgb: tint });
            }
          }
        }
        return pts;
      },
    },
  ];

  var current = 0;
  var state = null;
  var points = [];
  var raf = 0;
  var built = false;
  var view = { yaw: 0.6, pitch: 0.4, dist: 4.4, drag: null, user: false };
  var env = buildEnv();

  function buildEnv() {
    var pts = [];
    var i;
    var j;
    for (i = -5; i <= 5; i++) {
      for (j = -5; j <= 5; j++) {
        if ((i + j) % 2) continue;
        pts.push({ x: i / 4.2, y: -1.08, z: j / 4.2, rgb: [46, 42, 36] });
      }
    }
    for (i = 0; i < 70; i++) {
      pts.push({
        x: Math.sin(i * 1.7) * 1.35,
        y: ((i * 13) % 22) / 12 - 0.9,
        z: Math.cos(i * 1.13) * 1.35,
        rgb: [38, 40, 48],
      });
    }
    return pts;
  }

  function $(id) {
    return document.getElementById(id);
  }

  function problem() {
    return PROBLEMS[current];
  }

  function blankState(p) {
    var next = { g: {}, sw: {} };
    p.gauges.forEach(function (g) { next.g[g.id] = g.value; });
    p.switches.forEach(function (sw) { next.sw[sw.id] = sw.on; });
    return next;
  }

  function frameCamera(p) {
    if (view.user) return;
    view.yaw = p.camera.yaw;
    view.pitch = p.camera.pitch;
    view.dist = p.camera.dist;
  }

  function normalize(src) {
    if (!src.length) return [];
    var min = [Infinity, Infinity, Infinity];
    var max = [-Infinity, -Infinity, -Infinity];
    src.forEach(function (p) {
      if (p.x < min[0]) min[0] = p.x;
      if (p.y < min[1]) min[1] = p.y;
      if (p.z < min[2]) min[2] = p.z;
      if (p.x > max[0]) max[0] = p.x;
      if (p.y > max[1]) max[1] = p.y;
      if (p.z > max[2]) max[2] = p.z;
    });
    var c = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
    var span = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2], 0.4);
    var s = span / 2;
    return src.map(function (p) {
      return {
        x: (p.x - c[0]) / s,
        y: (p.y - c[1]) / s,
        z: (p.z - c[2]) / s,
        rgb: p.rgb,
        big: p.big,
      };
    });
  }

  function refresh() {
    var p = problem();
    if (p.constrain) p.constrain(state);
    points = normalize(p.cloud(state));
    var formula = $("mx-formula");
    if (formula) {
      formula.innerHTML = p.formula(state).map(function (line) {
        return '<p class="' + (line.on ? "is-on" : "is-off") + '">' + esc(line.text) + "</p>";
      }).join("");
    }
    var route = $("mx-route");
    if (route) {
      route.innerHTML = p.route(state).map(function (step) {
        return '<li class="' + (step.met ? "is-done" : "") + '">' + esc(step.text) + "</li>";
      }).join("");
    }
    var answer = $("mx-answer");
    if (answer) answer.textContent = p.answer(state);
    var count = $("mx-count");
    if (count) count.textContent = points.length.toLocaleString() + " points";
    syncGaugeLabels();
  }

  function syncGaugeLabels() {
    var host = $("mx-gauges");
    if (!host) return;
    var inputs = host.querySelectorAll("input");
    var i;
    for (i = 0; i < inputs.length; i++) {
      var id = inputs[i].getAttribute("data-id");
      if (state.g[id] == null) continue;
      if (document.activeElement !== inputs[i]) inputs[i].value = String(state.g[id]);
      var val = inputs[i].parentNode.querySelector(".mx-gauge-val");
      if (val) val.textContent = num(state.g[id]);
    }
    var switches = $("mx-switches");
    if (!switches) return;
    var buttons = switches.querySelectorAll("button");
    for (i = 0; i < buttons.length; i++) {
      var sid = buttons[i].getAttribute("data-id");
      var on = !!state.sw[sid];
      buttons[i].classList.toggle("is-on", on);
      buttons[i].setAttribute("aria-pressed", on ? "true" : "false");
    }
  }

  function paintChrome() {
    var p = problem();
    var title = $("mx-title");
    if (title) title.textContent = p.title;
    var statement = $("mx-statement");
    if (statement) statement.textContent = p.statement;
    var buttons = document.querySelectorAll("#mx-curriculum button");
    var i;
    for (i = 0; i < buttons.length; i++) {
      buttons[i].classList.toggle("is-on", parseInt(buttons[i].getAttribute("data-i"), 10) === current);
    }
    var gauges = $("mx-gauges");
    gauges.innerHTML = p.gauges.map(function (g) {
      return '<label class="mx-gauge">' + g.label +
        '<input type="range" data-id="' + g.id + '" min="' + g.min + '" max="' + g.max + '" step="' + g.step + '" value="' + state.g[g.id] + '" aria-label="' + g.label + '" />' +
        '<span class="mx-gauge-val">' + num(state.g[g.id]) + "</span></label>";
    }).join("");
    gauges.querySelectorAll("input").forEach(function (input) {
      input.addEventListener("input", function () {
        state.g[input.getAttribute("data-id")] = parseFloat(input.value);
        refresh();
      });
    });
    var switches = $("mx-switches");
    switches.innerHTML = p.switches.map(function (sw) {
      var on = !!state.sw[sw.id];
      return '<button type="button" data-id="' + sw.id + '" class="mx-switch' + (on ? " is-on" : "") + '" aria-pressed="' + (on ? "true" : "false") + '">' + sw.label + "</button>";
    }).join("");
    switches.querySelectorAll("button").forEach(function (button) {
      button.addEventListener("click", function () {
        var id = button.getAttribute("data-id");
        state.sw[id] = !state.sw[id];
        refresh();
      });
    });
    var actions = $("mx-actions");
    actions.innerHTML = p.actions.map(function (act, index) {
      return '<button type="button" data-act="' + index + '">' + act.name + "</button>";
    }).join("");
    actions.querySelectorAll("button").forEach(function (button) {
      button.addEventListener("click", function () {
        p.actions[parseInt(button.getAttribute("data-act"), 10)].run(state);
        refresh();
      });
    });
    refresh();
  }

  function select(index) {
    current = index;
    view.user = false;
    state = blankState(problem());
    frameCamera(problem());
    paintChrome();
  }

  function project(p, w, h) {
    var cy = Math.cos(view.yaw);
    var sy = Math.sin(view.yaw);
    var cp = Math.cos(view.pitch);
    var sp = Math.sin(view.pitch);
    var x1 = p.x * cy - p.z * sy;
    var z1 = p.x * sy + p.z * cy;
    var y1 = p.y * cp - z1 * sp;
    var z2 = p.y * sp + z1 * cp;
    var f = (Math.min(w, h) * 1.22) / (z2 + view.dist);
    return { sx: w / 2 + x1 * f, sy: h / 2 - y1 * f, depth: z2, rgb: p.rgb, big: p.big };
  }

  function draw() {
    var canvas = $("mx-cloud");
    if (!canvas) return;
    var rect = canvas.getBoundingClientRect();
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = Math.max(2, rect.width);
    var h = Math.max(2, rect.height);
    var bw = Math.round(w * dpr);
    var bh = Math.round(h * dpr);
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    var ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#12110e";
    ctx.fillRect(0, 0, w, h);
    var drawn = [];
    env.forEach(function (p) { drawn.push(project(p, w, h)); });
    points.forEach(function (p) { drawn.push(project(p, w, h)); });
    drawn.sort(function (a, b) { return b.depth - a.depth; });
    var i;
    for (i = 0; i < drawn.length; i++) {
      var dot = drawn[i];
      var size = dot.big ? 6.5 : Math.max(1.7, 96 / (dot.depth + view.dist + 2.2));
      ctx.fillStyle = "rgb(" + dot.rgb[0] + "," + dot.rgb[1] + "," + dot.rgb[2] + ")";
      ctx.fillRect(dot.sx - size / 2, dot.sy - size / 2, size, size);
    }
    ctx.strokeStyle = "rgba(244,241,234,0.35)";
    ctx.lineWidth = 1;
    [[1.15, 0, 0], [0, 1.15, 0], [0, 0, 1.15]].forEach(function (axis, index) {
      var a = project({ x: 0, y: 0, z: 0, rgb: WHITE }, w, h);
      var b = project({ x: axis[0], y: axis[1], z: axis[2], rgb: WHITE }, w, h);
      ctx.strokeStyle = index === 0 ? "rgba(255,224,138,0.7)" : index === 1 ? "rgba(183,211,255,0.7)" : "rgba(240,196,234,0.7)";
      ctx.beginPath();
      ctx.moveTo(a.sx, a.sy);
      ctx.lineTo(b.sx, b.sy);
      ctx.stroke();
    });
  }

  function loop() {
    var panel = $("panel-math");
    if (!panel || panel.hidden) {
      raf = 0;
      return;
    }
    draw();
    raf = requestAnimationFrame(loop);
  }

  function bindCloud() {
    var canvas = $("mx-cloud");
    if (!canvas || canvas.dataset.bound) return;
    canvas.dataset.bound = "1";
    canvas.addEventListener("pointerdown", function (e) {
      view.drag = { x: e.clientX, y: e.clientY, yaw: view.yaw, pitch: view.pitch, id: e.pointerId };
      if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointermove", function (e) {
      if (!view.drag || e.pointerId !== view.drag.id) return;
      view.user = true;
      view.yaw = view.drag.yaw + (e.clientX - view.drag.x) * 0.008;
      view.pitch = clamp(view.drag.pitch + (e.clientY - view.drag.y) * 0.008, -1.15, 1.15);
    });
    function endDrag(e) {
      if (view.drag && e.pointerId === view.drag.id) view.drag = null;
    }
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);
    canvas.addEventListener("wheel", function (e) {
      e.preventDefault();
      view.user = true;
      view.dist = clamp(view.dist + e.deltaY * 0.004, 2.3, 8.5);
    }, { passive: false });
  }

  function bindChrome() {
    var shot = $("mx-shot");
    if (shot && !shot.dataset.bound) {
      shot.dataset.bound = "1";
      shot.addEventListener("click", function () {
        problem().solve(state);
        refresh();
      });
    }
    var reset = $("mx-reset");
    if (reset && !reset.dataset.bound) {
      reset.dataset.bound = "1";
      reset.addEventListener("click", function () {
        state = blankState(problem());
        refresh();
      });
    }
    var curriculum = $("mx-curriculum");
    if (curriculum && !curriculum.dataset.built) {
      curriculum.dataset.built = "1";
      curriculum.innerHTML = PROBLEMS.map(function (p, i) {
        return '<button type="button" data-i="' + i + '">' + p.title + "</button>";
      }).join("");
      curriculum.addEventListener("click", function (e) {
        var button = e.target.closest("button");
        if (!button) return;
        select(parseInt(button.getAttribute("data-i"), 10));
      });
    }
  }

  function ensure() {
    if (built) return;
    built = true;
    bindChrome();
    bindCloud();
    select(0);
  }

  function focusStage() {
    var canvas = $("mx-cloud");
    if (!canvas || !canvas.getBoundingClientRect) return;
    var rect = canvas.getBoundingClientRect();
    if (rect.top < 64 || rect.bottom > window.innerHeight - 8) {
      canvas.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }

  function onShow() {
    ensure();
    if (!raf) loop();
    requestAnimationFrame(focusStage);
  }

  document.addEventListener("math-show", onShow);
  window.MathLab = { onShow: onShow };
})();
