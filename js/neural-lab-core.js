/**
 * neural-lab-core.js — the math behind the Neural Lab tab (no DOM).
 *  - Net: a small dense network (Keras-Sequential-like) with hand-written
 *    forward/backward, dropout, fixed Fourier-feature encoding, SGD / Adam.
 *  - Datasets: moons (as sklearn.make_moons / micrograd demo), circles,
 *    spiral, XOR — all seeded so a reset reproduces the same points.
 *  - Code export: the designed model as Keras, PyTorch, JAX/Flax, micrograd.
 * Runs in the browser (window.NeuralLabCore) and in Node (for tests).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.NeuralLabCore = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ------------------------------------------------------------------ RNG
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gaussFactory(rand) {
    var spare = null;
    return function () {
      if (spare !== null) { var s = spare; spare = null; return s; }
      var u = 0, v = 0;
      while (u === 0) u = rand();
      v = rand();
      var m = Math.sqrt(-2 * Math.log(u));
      spare = m * Math.sin(2 * Math.PI * v);
      return m * Math.cos(2 * Math.PI * v);
    };
  }

  // ---------------------------------------------------------- activations
  var SQ2PI = Math.sqrt(2 / Math.PI);
  var ACTS = {
    relu: { f: function (z) { return z > 0 ? z : 0; }, d: function (z) { return z > 0 ? 1 : 0; } },
    tanh: { f: Math.tanh, d: function (z) { var t = Math.tanh(z); return 1 - t * t; } },
    sigmoid: {
      f: function (z) { return 1 / (1 + Math.exp(-z)); },
      d: function (z) { var s = 1 / (1 + Math.exp(-z)); return s * (1 - s); },
    },
    gelu: {
      // tanh approximation (same as keras approximate=True / torch approximate="tanh")
      f: function (z) { return 0.5 * z * (1 + Math.tanh(SQ2PI * (z + 0.044715 * z * z * z))); },
      d: function (z) {
        var u = SQ2PI * (z + 0.044715 * z * z * z);
        var t = Math.tanh(u);
        return 0.5 * (1 + t) + 0.5 * z * (1 - t * t) * SQ2PI * (1 + 3 * 0.044715 * z * z);
      },
    },
    linear: { f: function (z) { return z; }, d: function () { return 1; } },
  };

  // ------------------------------------------------------------------ Net
  /**
   * spec = { inputDim, outputDim, outAct, loss: "bce"|"mse",
   *          layers: [{type:"dense",units,act}|{type:"dropout",rate}|{type:"fourier",freqs,scale}] }
   * The output Dense(outputDim, outAct) is appended automatically.
   */
  function Net(spec, seed) {
    this.spec = spec;
    var rand = mulberry32(seed || 1);
    var gauss = gaussFactory(rand);
    this.rand = rand;
    var dim = spec.inputDim;
    var L = [];
    var all = spec.layers.concat([{ type: "dense", units: spec.outputDim, act: spec.outAct, output: true }]);
    for (var i = 0; i < all.length; i++) {
      var s = all[i];
      if (s.type === "dense") {
        var n = Math.max(1, s.units | 0);
        var W = new Float64Array(n * dim);
        var std = s.act === "relu" || s.act === "gelu" ? Math.sqrt(2 / dim) : Math.sqrt(2 / (dim + n));
        for (var k = 0; k < W.length; k++) W[k] = gauss() * std;
        L.push({
          kind: "dense", nin: dim, nout: n, act: s.act || "linear", output: !!s.output,
          W: W, b: new Float64Array(n),
          gW: new Float64Array(W.length), gb: new Float64Array(n),
          mW: new Float64Array(W.length), vW: new Float64Array(W.length),
          mb: new Float64Array(n), vb: new Float64Array(n),
          z: new Float64Array(n), a: new Float64Array(n), dz: new Float64Array(n), dx: new Float64Array(dim),
        });
        dim = n;
      } else if (s.type === "dropout") {
        L.push({ kind: "dropout", nin: dim, nout: dim, rate: Math.min(0.9, Math.max(0, +s.rate || 0)),
          mask: new Float64Array(dim), a: new Float64Array(dim), dx: new Float64Array(dim) });
      } else if (s.type === "fourier") {
        var m = Math.max(1, s.freqs | 0);
        var B = new Float64Array(m * dim);
        var sc = +s.scale || 1;
        for (var q = 0; q < B.length; q++) B[q] = gauss() * sc;
        L.push({ kind: "fourier", nin: dim, nout: 2 * m, m: m, B: B, scale: sc,
          p: new Float64Array(m), a: new Float64Array(2 * m), dx: new Float64Array(dim) });
        dim = 2 * m;
      }
    }
    this.layers = L;
    this.outDim = dim;
    this.t = 0;
    this.x0 = new Float64Array(spec.inputDim);
  }

  Net.prototype.paramCount = function () {
    var c = 0;
    this.layers.forEach(function (l) { if (l.kind === "dense") c += l.W.length + l.b.length; });
    return c;
  };

  /** forward one sample; returns the output buffer (reused). */
  Net.prototype.forward = function (x, train) {
    var inp = x;
    var L = this.layers;
    for (var li = 0; li < L.length; li++) {
      var l = L[li];
      if (l.kind === "dense") {
        var W = l.W, b = l.b, z = l.z, a = l.a, nin = l.nin, f = ACTS[l.act].f;
        for (var j = 0; j < l.nout; j++) {
          var s = b[j], off = j * nin;
          for (var i = 0; i < nin; i++) s += W[off + i] * inp[i];
          z[j] = s;
          a[j] = f(s);
        }
        inp = a;
      } else if (l.kind === "dropout") {
        if (train && l.rate > 0) {
          var keep = 1 - l.rate, inv = 1 / keep;
          for (var d = 0; d < l.nin; d++) {
            var mk = this.rand() < keep ? inv : 0;
            l.mask[d] = mk;
            l.a[d] = inp[d] * mk;
          }
        } else {
          for (var d2 = 0; d2 < l.nin; d2++) { l.mask[d2] = 1; l.a[d2] = inp[d2]; }
        }
        inp = l.a;
      } else {
        var B = l.B, fin = l.nin, m = l.m, TWO_PI = 2 * Math.PI;
        for (var r = 0; r < m; r++) {
          var p = 0, o2 = r * fin;
          for (var c = 0; c < fin; c++) p += B[o2 + c] * inp[c];
          p *= TWO_PI;
          l.p[r] = p;
          l.a[r] = Math.sin(p);
          l.a[m + r] = Math.cos(p);
        }
        inp = l.a;
      }
    }
    return inp;
  };

  /** backward from dOut (dLoss/dOutput-activation or, if preAct, dLoss/dz of last layer) */
  Net.prototype.backward = function (x, dOut, preAct) {
    var L = this.layers;
    var grad = dOut;
    for (var li = L.length - 1; li >= 0; li--) {
      var l = L[li];
      var inp = li === 0 ? x : L[li - 1].a;
      if (l.kind === "dense") {
        var dz = l.dz, z = l.z, d = ACTS[l.act].d, nin = l.nin;
        if (preAct && li === L.length - 1) { for (var j0 = 0; j0 < l.nout; j0++) dz[j0] = grad[j0]; }
        else { for (var j1 = 0; j1 < l.nout; j1++) dz[j1] = grad[j1] * d(z[j1]); }
        var dx = l.dx;
        if (li > 0) for (var q = 0; q < nin; q++) dx[q] = 0;
        var W = l.W, gW = l.gW;
        for (var j = 0; j < l.nout; j++) {
          var g = dz[j];
          if (g === 0) continue;
          l.gb[j] += g;
          var off = j * nin;
          for (var i = 0; i < nin; i++) {
            gW[off + i] += g * inp[i];
            if (li > 0) dx[i] += g * W[off + i];
          }
        }
        grad = dx;
      } else if (l.kind === "dropout") {
        for (var k = 0; k < l.nin; k++) l.dx[k] = grad[k] * l.mask[k];
        grad = l.dx;
      } else {
        var m = l.m, fin = l.nin, B = l.B, TWO_PI = 2 * Math.PI;
        for (var c0 = 0; c0 < fin; c0++) l.dx[c0] = 0;
        if (li === 0) { grad = l.dx; continue; } // nothing trainable below
        for (var r = 0; r < m; r++) {
          var gp = (grad[r] * Math.cos(l.p[r]) - grad[m + r] * Math.sin(l.p[r])) * TWO_PI;
          for (var c = 0; c < fin; c++) l.dx[c] += gp * B[r * fin + c];
        }
        grad = l.dx;
      }
    }
  };

  Net.prototype.zeroGrad = function () {
    this.layers.forEach(function (l) { if (l.kind === "dense") { l.gW.fill(0); l.gb.fill(0); } });
  };

  Net.prototype.step = function (opt, lr, n) {
    var scale = 1 / n;
    this.t++;
    var b1 = 0.9, b2 = 0.999, eps = 1e-8;
    var c1 = 1 - Math.pow(b1, this.t), c2 = 1 - Math.pow(b2, this.t);
    this.layers.forEach(function (l) {
      if (l.kind !== "dense") return;
      var pairs = [[l.W, l.gW, l.mW, l.vW], [l.b, l.gb, l.mb, l.vb]];
      for (var p = 0; p < 2; p++) {
        var P = pairs[p][0], G = pairs[p][1], M = pairs[p][2], V = pairs[p][3];
        if (opt === "adam") {
          for (var i = 0; i < P.length; i++) {
            var g = G[i] * scale;
            M[i] = b1 * M[i] + (1 - b1) * g;
            V[i] = b2 * V[i] + (1 - b2) * g * g;
            P[i] -= (lr * (M[i] / c1)) / (Math.sqrt(V[i] / c2) + eps);
          }
        } else {
          for (var k = 0; k < P.length; k++) P[k] -= lr * G[k] * scale;
        }
      }
    });
  };

  /**
   * One minibatch. X: Float64Array N*inDim, Y: Float64Array N*outDim, idx: sample indices.
   * Returns mean loss over the batch.
   */
  Net.prototype.trainBatch = function (X, Y, idx, start, end, opt, lr) {
    var din = this.spec.inputDim, dout = this.spec.outputDim, loss = 0;
    var x = this.x0, dOut = this._dOut || (this._dOut = new Float64Array(dout));
    var bce = this.spec.loss === "bce";
    this.zeroGrad();
    for (var t = start; t < end; t++) {
      var s = idx[t];
      for (var i = 0; i < din; i++) x[i] = X[s * din + i];
      var out = this.forward(x, true);
      for (var o = 0; o < dout; o++) {
        var p = out[o], y = Y[s * dout + o];
        if (bce) {
          var pc = Math.min(1 - 1e-7, Math.max(1e-7, p));
          loss -= y * Math.log(pc) + (1 - y) * Math.log(1 - pc);
          dOut[o] = p - y; // dL/dz for sigmoid + BCE
        } else {
          var e = p - y;
          loss += (e * e) / dout;
          dOut[o] = (2 * e) / dout; // dL/da
        }
      }
      this.backward(x, dOut, bce);
    }
    this.step(opt, lr, end - start);
    return loss / (end - start);
  };

  Net.prototype.predictInto = function (X, n, out) {
    var din = this.spec.inputDim, dout = this.spec.outputDim, x = this.x0;
    for (var s = 0; s < n; s++) {
      for (var i = 0; i < din; i++) x[i] = X[s * din + i];
      var o = this.forward(x, false);
      for (var k = 0; k < dout; k++) out[s * dout + k] = o[k];
    }
    return out;
  };

  /** A trainer that walks epochs in shuffled minibatches. */
  function Trainer(net, X, Y, n, opts) {
    this.net = net; this.X = X; this.Y = Y; this.n = n;
    this.opt = opts.optimizer || "adam";
    this.lr = +opts.lr || 0.01;
    this.batch = Math.max(1, Math.min(n, opts.batch | 0 || 32));
    this.idx = new Int32Array(n);
    for (var i = 0; i < n; i++) this.idx[i] = i;
    this.pos = n; // forces shuffle on first call
    this.epoch = 0;
    this.epochLoss = 0; this.epochCount = 0; this.lastEpochLoss = NaN;
    this.steps = 0;
  }
  Trainer.prototype.shuffle = function () {
    var r = this.net.rand, a = this.idx;
    for (var i = a.length - 1; i > 0; i--) { var j = (r() * (i + 1)) | 0; var t = a[i]; a[i] = a[j]; a[j] = t; }
    this.pos = 0;
  };
  /** one minibatch; returns true when it finished an epoch */
  Trainer.prototype.stepBatch = function () {
    if (this.pos >= this.n) this.shuffle();
    var end = Math.min(this.n, this.pos + this.batch);
    var l = this.net.trainBatch(this.X, this.Y, this.idx, this.pos, end, this.opt, this.lr);
    this.epochLoss += l * (end - this.pos); this.epochCount += end - this.pos;
    this.pos = end; this.steps++;
    if (this.pos >= this.n) {
      this.epoch++;
      this.lastEpochLoss = this.epochLoss / this.epochCount;
      this.epochLoss = 0; this.epochCount = 0;
      return true;
    }
    return false;
  };
  Trainer.prototype.runEpoch = function () { while (!this.stepBatch()) {} return this.lastEpochLoss; };

  // ------------------------------------------------------------- datasets
  function makeDataset(name, n, noise, seed) {
    var rand = mulberry32(seed || 7), g = gaussFactory(rand);
    var X = new Float64Array(n * 2), Y = new Float64Array(n);
    var i, t;
    noise = noise == null ? 0.1 : noise;
    if (name === "moons") { // sklearn.datasets.make_moons
      var nOut = Math.floor(n / 2), nIn = n - nOut;
      for (i = 0; i < nOut; i++) {
        t = nOut > 1 ? (Math.PI * i) / (nOut - 1) : 0;
        X[2 * i] = Math.cos(t) + g() * noise; X[2 * i + 1] = Math.sin(t) + g() * noise; Y[i] = 0;
      }
      for (i = 0; i < nIn; i++) {
        t = nIn > 1 ? (Math.PI * i) / (nIn - 1) : 0;
        var k = nOut + i;
        X[2 * k] = 1 - Math.cos(t) + g() * noise; X[2 * k + 1] = 1 - Math.sin(t) - 0.5 + g() * noise; Y[k] = 1;
      }
    } else if (name === "circles") { // make_circles(factor=0.5)
      var nO = Math.floor(n / 2);
      for (i = 0; i < n; i++) {
        var outer = i < nO, cnt = outer ? nO : n - nO, j = outer ? i : i - nO;
        t = (2 * Math.PI * j) / cnt;
        var r = outer ? 1 : 0.5;
        X[2 * i] = r * Math.cos(t) + g() * noise; X[2 * i + 1] = r * Math.sin(t) + g() * noise; Y[i] = outer ? 0 : 1;
      }
    } else if (name === "spiral") { // two interleaved arms (TF Playground style)
      var half = Math.floor(n / 2);
      for (i = 0; i < n; i++) {
        var arm = i < half ? 0 : 1, jj = arm ? i - half : i, m = arm ? n - half : half;
        var rr = (jj / m) * 1.0;
        t = 1.75 * (jj / m) * 2 * Math.PI + arm * Math.PI;
        X[2 * i] = rr * Math.sin(t) + g() * noise * 0.6; X[2 * i + 1] = rr * Math.cos(t) + g() * noise * 0.6; Y[i] = arm;
      }
    } else { // xor
      for (i = 0; i < n; i++) {
        var a = rand() * 2 - 1, b = rand() * 2 - 1;
        var pad = 0.05;
        a += a > 0 ? pad : -pad; b += b > 0 ? pad : -pad;
        X[2 * i] = a + g() * noise * 0.5; X[2 * i + 1] = b + g() * noise * 0.5; Y[i] = a * b > 0 ? 1 : 0;
      }
    }
    return { X: X, Y: Y, n: n, name: name };
  }

  function accuracy(net, data) {
    var out = net.predictInto(data.X, data.n, new Float64Array(data.n));
    var c = 0;
    for (var i = 0; i < data.n; i++) if ((out[i] > 0.5 ? 1 : 0) === data.Y[i]) c++;
    return c / data.n;
  }

  function bounds(data, pad) {
    var x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (var i = 0; i < data.n; i++) {
      var x = data.X[2 * i], y = data.X[2 * i + 1];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    pad = pad == null ? 0.35 : pad;
    var cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, h = Math.max(x1 - x0, y1 - y0) / 2 + pad;
    return { x0: cx - h, x1: cx + h, y0: cy - h, y1: cy + h };
  }

  /** pixels (RGBA Uint8ClampedArray, w, h) -> coordinate dataset in [-1,1] (aspect-kept) */
  function imageDataset(rgba, w, h) {
    var n = w * h, X = new Float64Array(n * 2), Y = new Float64Array(n * 3);
    var s = 2 / Math.max(w, h);
    for (var yy = 0; yy < h; yy++) for (var xx = 0; xx < w; xx++) {
      var i = yy * w + xx;
      X[2 * i] = (xx + 0.5 - w / 2) * s; X[2 * i + 1] = (yy + 0.5 - h / 2) * s;
      Y[3 * i] = rgba[4 * i] / 255; Y[3 * i + 1] = rgba[4 * i + 1] / 255; Y[3 * i + 2] = rgba[4 * i + 2] / 255;
    }
    return { X: X, Y: Y, n: n, w: w, h: h };
  }

  function psnr(pred, Y, n) {
    var se = 0;
    for (var i = 0; i < n * 3; i++) { var e = pred[i] - Y[i]; se += e * e; }
    var mse = se / (n * 3);
    return { mse: mse, psnr: mse > 0 ? 10 * Math.log10(1 / mse) : 99 };
  }

  // --------------------------------------------------------- code export
  function num(v) {
    var s = String(+(+v).toPrecision(6));
    return s.indexOf(".") < 0 && s.indexOf("e") < 0 ? s + ".0" : s;
  }
  var PT_ACT = { relu: "nn.ReLU()", tanh: "nn.Tanh()", sigmoid: "nn.Sigmoid()", gelu: 'nn.GELU(approximate="tanh")' };
  var JAX_ACT = { relu: "nn.relu", tanh: "nn.tanh", sigmoid: "nn.sigmoid", gelu: "nn.gelu" };

  function exportCode(spec, train, lang) {
    var L = spec.layers, paint = spec.outputDim === 3, lines = [];
    var hasFourier = L.some(function (l) { return l.type === "fourier"; });
    var ep = train.epochs | 0, bs = train.batch | 0, lr = num(train.lr), adam = train.optimizer === "adam";
    var dataNote = paint
      ? "# X: (H*W, 2) pixel coords in [-1, 1]; Y: (H*W, 3) RGB in [0, 1]  (coordinate network)"
      : "# X: (N, 2) points; y: (N,) labels 0/1  e.g. sklearn.datasets.make_moons(200, noise=0.1)";
    if (lang === "keras") {
      lines.push("# Keras 3 (keras-master/keras/src/models/sequential.py)");
      lines.push("import keras", "from keras import layers, ops");
      if (hasFourier) {
        lines.push("", "class FourierFeatures(layers.Layer):",
          '    """Fixed random Fourier features: [sin(2*pi*xB), cos(2*pi*xB)] (Tancik et al. 2020)."""',
          "    def __init__(self, freqs, scale, **kw):", "        super().__init__(**kw)", "        self.freqs, self.scale = freqs, scale",
          "    def build(self, input_shape):",
          "        self.B = self.add_weight(shape=(input_shape[-1], self.freqs), trainable=False,",
          "                                 initializer=keras.initializers.RandomNormal(stddev=self.scale))",
          "    def call(self, x):", "        p = 2 * 3.141592653589793 * ops.matmul(x, self.B)",
          "        return ops.concatenate([ops.sin(p), ops.cos(p)], axis=-1)");
      }
      lines.push("", dataNote, "model = keras.Sequential([", "    keras.Input(shape=(2,)),");
      L.forEach(function (l) {
        if (l.type === "dense") lines.push("    layers.Dense(" + l.units + ', activation="' + l.act + '"),');
        else if (l.type === "dropout") lines.push("    layers.Dropout(" + num(l.rate) + "),");
        else lines.push("    FourierFeatures(freqs=" + l.freqs + ", scale=" + num(l.scale) + "),");
      });
      lines.push("    layers.Dense(" + spec.outputDim + ', activation="sigmoid"),', "])");
      lines.push("model.compile(", "    optimizer=keras.optimizers." + (adam ? "Adam" : "SGD") + "(learning_rate=" + lr + "),",
        '    loss="' + (paint ? "mse" : "binary_crossentropy") + '",' + (paint ? "" : ' metrics=["accuracy"],'), ")");
      lines.push("model.summary()", "model.fit(X, " + (paint ? "Y" : "y") + ", batch_size=" + bs + ", epochs=" + ep + ", shuffle=True)");
    } else if (lang === "pytorch") {
      lines.push("# PyTorch (torch/nn/modules/linear.py, torch/optim/" + (adam ? "adam" : "sgd") + ".py)");
      lines.push("import math", "import torch", "from torch import nn");
      if (hasFourier) {
        lines.push("", "class FourierFeatures(nn.Module):", "    def __init__(self, in_dim, freqs, scale):", "        super().__init__()",
          '        self.register_buffer("B", torch.randn(in_dim, freqs) * scale)  # fixed, not trained',
          "    def forward(self, x):", "        p = 2 * math.pi * x @ self.B", "        return torch.cat([torch.sin(p), torch.cos(p)], dim=-1)");
      }
      lines.push("", dataNote, "model = nn.Sequential(");
      var dim = 2;
      L.forEach(function (l) {
        if (l.type === "dense") { lines.push("    nn.Linear(" + dim + ", " + l.units + "), " + PT_ACT[l.act] + ","); dim = l.units; }
        else if (l.type === "dropout") lines.push("    nn.Dropout(p=" + num(l.rate) + "),");
        else { lines.push("    FourierFeatures(" + dim + ", " + l.freqs + ", " + num(l.scale) + "),"); dim = 2 * l.freqs; }
      });
      lines.push("    nn.Linear(" + dim + ", " + spec.outputDim + ")," + (paint ? " nn.Sigmoid()," : "  # logits; sigmoid lives in the loss"), ")");
      lines.push("loss_fn = " + (paint ? "nn.MSELoss()" : "nn.BCEWithLogitsLoss()"));
      lines.push("opt = torch.optim." + (adam ? "Adam" : "SGD") + "(model.parameters(), lr=" + lr + ")");
      lines.push("X = torch.as_tensor(X, dtype=torch.float32)", (paint ? "Y = torch.as_tensor(Y, dtype=torch.float32)" : "Y = torch.as_tensor(y, dtype=torch.float32).unsqueeze(1)"));
      lines.push("for epoch in range(" + ep + "):", "    model.train()", "    for idx in torch.randperm(len(X)).split(" + bs + "):",
        "        loss = loss_fn(model(X[idx]), Y[idx])", "        opt.zero_grad()", "        loss.backward()", "        opt.step()");
      if (!paint) lines.push("model.eval()", "acc = ((model(X) > 0).float() == Y).float().mean()");
    } else if (lang === "jax") {
      lines.push("# JAX + Flax (linen) + Optax.  Pure-JAX equivalent: jax/example_libraries/stax.py + optimizers.py");
      lines.push("import jax, jax.numpy as jnp", "import flax.linen as nn", "import optax", "", dataNote);
      lines.push("class Model(nn.Module):", "    @nn.compact", "    def __call__(self, x, train: bool = False):");
      var fi = 0;
      L.forEach(function (l) {
        if (l.type === "dense") lines.push("        x = " + JAX_ACT[l.act] + "(nn.Dense(" + l.units + ")(x))");
        else if (l.type === "dropout") lines.push("        x = nn.Dropout(rate=" + num(l.rate) + ", deterministic=not train)(x)");
        else {
          lines.push("        B = self.variable('consts', 'B" + fi + "', lambda: " + num(l.scale) + " * jax.random.normal(jax.random.key(" + fi + "), (x.shape[-1], " + l.freqs + "))).value",
            "        p = 2 * jnp.pi * x @ B", "        x = jnp.concatenate([jnp.sin(p), jnp.cos(p)], axis=-1)");
          fi++;
        }
      });
      lines.push("        return nn.Dense(" + spec.outputDim + ")(x)  # logits", "");
      lines.push("model = Model()", "key = jax.random.key(0)", "variables = model.init(key, jnp.zeros((1, 2)))",
        "params = variables['params']", "consts = {k: v for k, v in variables.items() if k != 'params'}",
        "tx = optax." + (adam ? "adam" : "sgd") + "(" + lr + ")", "opt_state = tx.init(params)", "",
        "def loss_fn(params, xb, yb, key):",
        "    out = model.apply({'params': params, **consts}, xb, train=True, rngs={'dropout': key})",
        paint ? "    return jnp.mean((jax.nn.sigmoid(out) - yb) ** 2)" : "    return optax.sigmoid_binary_cross_entropy(out[:, 0], yb).mean()", "",
        "@jax.jit", "def train_step(params, opt_state, xb, yb, key):",
        "    loss, grads = jax.value_and_grad(loss_fn)(params, xb, yb, key)",
        "    updates, opt_state = tx.update(grads, opt_state, params)",
        "    return optax.apply_updates(params, updates), opt_state, loss", "",
        "X, T = jnp.asarray(X), jnp.asarray(" + (paint ? "Y" : "y") + ", dtype=jnp.float32)",
        "for epoch in range(" + ep + "):", "    key, pk = jax.random.split(key)", "    perm = jax.random.permutation(pk, len(X))",
        "    for i in range(0, len(X), " + bs + "):", "        idx = perm[i:i + " + bs + "]", "        key, dk = jax.random.split(key)",
        "        params, opt_state, loss = train_step(params, opt_state, X[idx], T[idx], dk)");
    } else {
      var dense = L.filter(function (l) { return l.type === "dense"; });
      var pure = dense.length === L.length && dense.every(function (l) { return l.act === "relu"; }) && !paint;
      lines.push("# micrograd (micrograd-master/micrograd/nn.py) — scalar autograd, like demo.ipynb");
      if (!pure) lines.push("# note: micrograd's MLP only has ReLU hidden layers, no dropout/Fourier;", "#       this is the closest equivalent (hidden sizes kept).");
      lines.push("from micrograd.engine import Value", "from micrograd.nn import MLP", "",
        "model = MLP(2, [" + dense.map(function (l) { return l.units; }).concat([paint ? 3 : 1]).join(", ") + "])",
        "print(model, len(model.parameters()))", "", "y = y * 2 - 1  # micrograd demo uses -1/+1 labels and an SVM loss",
        "for k in range(100):", "    scores = [model(list(map(Value, xr))) for xr in X]",
        "    losses = [(1 + -yi * si).relu() for yi, si in zip(y, scores)]",
        "    loss = sum(losses) * (1.0 / len(losses)) + 1e-4 * sum(p * p for p in model.parameters())",
        "    model.zero_grad()", "    loss.backward()", "    for p in model.parameters():", "        p.data -= (1.0 - 0.9 * k / 100) * p.grad");
    }
    return lines.join("\n");
  }

  return {
    ACTS: ACTS, Net: Net, Trainer: Trainer, makeDataset: makeDataset, accuracy: accuracy,
    bounds: bounds, imageDataset: imageDataset, psnr: psnr, exportCode: exportCode,
    mulberry32: mulberry32,
  };
});
