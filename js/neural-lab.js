/**
 * Neural Lab — a visual neural-network design interface, 100% in the browser.
 *  Designer (Keras-Sequential-style blocks) + live SVG network diagram,
 *  2D toy datasets with a decision-boundary heatmap, Paint mode (a coordinate
 *  network x,y -> r,g,b that learns to repaint a gallery painting), a micrograd
 *  computation-graph view, and Keras / PyTorch / JAX / micrograd code export.
 * No API keys, no servers: uses js/neural-lab-core.js + js/neural-micrograd.js.
 * Built lazily on first open of #neural. Everything is scoped to .nn-*.
 */
(function () {
  "use strict";

  var C = window.NeuralLabCore;
  var MG = window.Micrograd;

  // ------------------------------------------------------------ references
  var GH = {
    keras: "https://github.com/keras-team/keras/blob/master/",
    torch: "https://github.com/pytorch/pytorch/blob/main/",
    jax: "https://github.com/jax-ml/jax/blob/main/",
    d2l: "https://d2l.ai/",
  };
  var LEARN = {
    dense: { d2l: "chapter_multilayer-perceptrons/mlp.html", title: "d2l 5.1 Multilayer Perceptrons",
      keras: "keras/src/layers/core/dense.py", torch: "torch/nn/modules/linear.py", jax: "jax/example_libraries/stax.py" },
    act: { d2l: "chapter_multilayer-perceptrons/mlp.html#activation-functions", title: "d2l 5.1.2 Activation functions",
      keras: "keras/src/activations/activations.py", torch: "torch/nn/modules/activation.py", jax: "jax/_src/nn/functions.py" },
    dropout: { d2l: "chapter_multilayer-perceptrons/dropout.html", title: "d2l 5.6 Dropout",
      keras: "keras/src/layers/regularization/dropout.py", torch: "torch/nn/modules/dropout.py", jax: "jax/example_libraries/stax.py" },
    fourier: { href: "https://arxiv.org/abs/2006.10739", title: "Tancik et al. 2020, Fourier Features (not in d2l)",
      keras: "keras/src/layers/layer.py", torch: "torch/nn/modules/module.py", jax: "jax/_src/numpy/ufuncs.py" },
    bce: { d2l: "chapter_linear-classification/softmax-regression.html", title: "d2l 4.1 Softmax regression / cross-entropy",
      keras: "keras/src/losses/losses.py", torch: "torch/nn/modules/loss.py", jax: "jax/_src/nn/functions.py" },
    mse: { d2l: "chapter_linear-regression/linear-regression.html", title: "d2l 3.1 Linear regression / squared loss",
      keras: "keras/src/losses/losses.py", torch: "torch/nn/modules/loss.py", jax: "jax/_src/numpy/reductions.py" },
    sgd: { d2l: "chapter_optimization/minibatch-sgd.html", title: "d2l 12.5 Minibatch SGD",
      keras: "keras/src/optimizers/sgd.py", torch: "torch/optim/sgd.py", jax: "jax/example_libraries/optimizers.py" },
    adam: { d2l: "chapter_optimization/adam.html", title: "d2l 12.10 Adam",
      keras: "keras/src/optimizers/adam.py", torch: "torch/optim/adam.py", jax: "jax/example_libraries/optimizers.py" },
    autograd: { d2l: "chapter_preliminaries/autograd.html", title: "d2l 2.5 Automatic differentiation",
      keras: "keras/src/backend/tensorflow/trainer.py", torch: "torch/autograd/__init__.py", jax: "jax/_src/interpreters/ad.py" },
    backprop: { d2l: "chapter_multilayer-perceptrons/backprop.html", title: "d2l 5.3 Backpropagation",
      keras: "keras/src/models/sequential.py", torch: "torch/nn/modules/container.py", jax: "jax/_src/api.py" },
    init: { d2l: "chapter_multilayer-perceptrons/numerical-stability-and-init.html", title: "d2l 5.4 Initialization",
      keras: "keras/src/initializers/random_initializers.py", torch: "torch/nn/init.py", jax: "jax/_src/nn/initializers.py" },
    conv: { d2l: "chapter_convolutional-neural-networks/conv-layer.html", title: "d2l 7.2 Convolutions (next step: image mode)",
      keras: "keras/src/layers/convolutional/conv2d.py", torch: "torch/nn/modules/conv.py", jax: "jax/example_libraries/stax.py" },
  };
  function d2lHref(k) { var e = LEARN[k]; return e.href || GH.d2l + e.d2l; }
  function d2lLocal(k) {
    var e = LEARN[k];
    return e.d2l ? "d2l-en-master/" + e.d2l.split("#")[0].replace(/\.html$/, ".md") : "";
  }

  // ------------------------------------------------------------- defaults
  function defaultDesign(kind) {
    return kind === "paint"
      ? [{ type: "fourier", freqs: 32, scale: 3 }, { type: "dense", units: 48, act: "relu" }, { type: "dense", units: 48, act: "relu" }]
      : [{ type: "dense", units: 16, act: "relu" }, { type: "dense", units: 16, act: "relu" }];
  }
  function defaultTrain(kind) {
    return kind === "paint"
      ? { lr: 0.005, optimizer: "adam", batch: 256, epochs: 300 }
      : { lr: 0.03, optimizer: "adam", batch: 32, epochs: 300, speed: 1 };
  }

  var S = {
    built: false, visible: false, view: "data", raf: 0,
    designs: { data: defaultDesign("data"), paint: defaultDesign("paint") },
    train: { data: defaultTrain("data"), paint: defaultTrain("paint") },
    ds: { name: "moons", noise: 0.1, n: 200 },
    paintCfg: { num: 1, size: 64 },
    runs: { data: null, paint: null },
    exportFor: "data", exportLang: "keras",
    seed: { data: 1, paint: 1 },
    mg: { preset: "simple", inputs: {}, reveal: -1, anim: 0, demo: null },
  };

  var el = {};
  function h(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (attrs[k] == null) continue;
      if (k === "class") n.className = attrs[k];
      else if (k === "text") n.textContent = attrs[k];
      else if (k === "html") n.innerHTML = attrs[k];
      else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (c) { if (c != null) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }
  var SVGNS = "http://www.w3.org/2000/svg";
  function s(tag, attrs) {
    var n = document.createElementNS(SVGNS, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }
  function fmt(v, d) { return isFinite(v) ? (+v).toFixed(d == null ? 3 : d) : "–"; }
  function modeKind() { return S.view === "paint" ? "paint" : S.view === "export" ? S.exportFor : "data"; }

  // =============================================================== build UI
  function build() {
    var root = document.getElementById("nn-root");
    if (!root || S.built) return;
    S.built = true;
    root.innerHTML = "";

    var modes = h("div", { class: "nn-modes", role: "tablist" });
    [["data", "Designer · 2D data"], ["paint", "Paint"], ["micrograd", "micrograd"], ["export", "Export code"]].forEach(function (m) {
      modes.appendChild(h("button", { type: "button", class: "nn-mode", "data-view": m[0], role: "tab", text: m[1], onclick: function () { setView(m[0]); } }));
    });

    var top = h("header", { class: "nn-top" }, [
      h("div", { class: "nn-title" }, [
        h("h2", { text: "Neural Lab" }),
        h("span", { class: "nn-badge", text: "preview" }),
      ]),
      h("p", { class: "nn-hint", html:
        "Design a network like <strong>Keras Sequential</strong>, watch it learn in your browser, then copy the same model as Keras, PyTorch or JAX code. " +
        "Everything runs on this device — no keys, no servers. Framework references point into the source repos (keras, pytorch, jax, micrograd, d2l)." }),
      modes,
    ]);

    el.blocks = h("ol", { class: "nn-blocks" });
    el.addRow = h("div", { class: "nn-add" });
    el.trainBox = h("div", { class: "nn-train" });
    var left = h("aside", { class: "nn-col nn-left" }, [
      h("h3", { text: "Layers" }), el.blocks, el.addRow, h("h3", { text: "Training" }), el.trainBox,
    ]);

    el.stageData = buildDataStage();
    el.stagePaint = buildPaintStage();
    el.stageMg = buildMicrogradStage();
    el.stageExport = buildExportStage();
    var center = h("section", { class: "nn-col nn-center" }, [el.stageData, el.stagePaint, el.stageMg, el.stageExport]);

    el.netWrap = h("div", { class: "nn-netwrap" });
    el.chart = h("canvas", { class: "nn-chart", width: 320, height: 150, "aria-label": "loss curve" });
    el.stats = h("dl", { class: "nn-stats" });
    el.right = h("aside", { class: "nn-col nn-right" }, [
      h("h3", { text: "Network" }), el.netWrap,
      h("p", { class: "nn-legend", html: '<span class="nn-sw nn-pos"></span>positive weight <span class="nn-sw nn-neg"></span>negative · thickness = |w|' }),
      h("h3", { text: "Loss" }), el.chart, el.stats,
    ]);

    el.grid = h("div", { class: "nn-grid" }, [left, center, el.right]);
    el.left = left;
    root.appendChild(top);
    root.appendChild(el.grid);
    root.appendChild(h("p", { class: "nn-foot", html:
      'micrograd engine ported from <a href="https://github.com/karpathy/micrograd" target="_blank" rel="noopener">karpathy/micrograd</a> (MIT, © 2020 Andrej Karpathy). ' +
      "Toy datasets follow scikit-learn's make_moons / make_circles. Learn more: <a href=\"https://d2l.ai\" target=\"_blank\" rel=\"noopener\">Dive into Deep Learning</a>." }));
    el.modes = modes;
    setView(S.view);
  }

  // ---------------------------------------------------------- designer UI
  function renderDesigner() {
    var kind = modeKind();
    var design = S.designs[kind];
    var ol = el.blocks;
    ol.innerHTML = "";
    ol.appendChild(h("li", { class: "nn-block nn-locked" }, [
      h("span", { class: "nn-bt", text: "Input" }),
      h("span", { class: "nn-bmeta", text: kind === "paint" ? "(2) pixel x, y" : "(2) point x, y" }),
    ]));
    design.forEach(function (b, i) {
      var li = h("li", { class: "nn-block nn-" + b.type, "data-i": i });
      var head = h("div", { class: "nn-bhead" }, [
        h("span", { class: "nn-bt", text: b.type === "dense" ? "Dense" : b.type === "dropout" ? "Dropout" : "Fourier features" }),
        h("span", { class: "nn-bbtns" }, [
          h("button", { type: "button", class: "nn-ib", title: "Move up", "aria-label": "Move up", text: "↑", onclick: function () { moveBlock(i, -1); } }),
          h("button", { type: "button", class: "nn-ib", title: "Move down", "aria-label": "Move down", text: "↓", onclick: function () { moveBlock(i, 1); } }),
          h("button", { type: "button", class: "nn-ib nn-del", title: "Remove", "aria-label": "Remove layer", text: "✕", onclick: function () { design.splice(i, 1); designChanged(); } }),
        ]),
      ]);
      li.appendChild(head);
      var row = h("div", { class: "nn-brow" });
      if (b.type === "dense") {
        row.appendChild(numField("units", b.units, 1, 128, 1, function (v) { b.units = v; designChanged(); }));
        var sel = h("select", { class: "nn-in", "aria-label": "activation", onchange: function () { b.act = sel.value; designChanged(); } });
        ["relu", "tanh", "sigmoid", "gelu"].forEach(function (a) { sel.appendChild(h("option", { value: a, text: a })); });
        sel.value = b.act;
        row.appendChild(h("label", { class: "nn-f" }, ["activation", sel]));
      } else if (b.type === "dropout") {
        row.appendChild(numField("rate", b.rate, 0, 0.9, 0.05, function (v) { b.rate = v; designChanged(); }));
      } else {
        row.appendChild(numField("freqs", b.freqs, 1, 128, 1, function (v) { b.freqs = v; designChanged(); }));
        row.appendChild(numField("scale σ", b.scale, 0.1, 30, 0.5, function (v) { b.scale = v; designChanged(); }));
      }
      li.appendChild(row);
      li.appendChild(learnLine(b.type, b.type === "dense" ? "act" : null));
      ol.appendChild(li);
    });
    var outTxt = kind === "paint" ? "Dense(3, sigmoid) → r, g, b · MSE loss" : "Dense(1, sigmoid) → class · binary cross-entropy";
    ol.appendChild(h("li", { class: "nn-block nn-locked" }, [
      h("span", { class: "nn-bt", text: "Output" }), h("span", { class: "nn-bmeta", text: outTxt }),
      learnLine(kind === "paint" ? "mse" : "bce"),
    ]));

    el.addRow.innerHTML = "";
    [["dense", "+ Dense"], ["dropout", "+ Dropout"], ["fourier", "+ Fourier"]].forEach(function (a) {
      el.addRow.appendChild(h("button", { type: "button", class: "nn-btn nn-small", "data-add": a[0], text: a[1], onclick: function () { addBlock(a[0]); } }));
    });
    el.addRow.appendChild(h("button", { type: "button", class: "nn-btn nn-small nn-ghost", text: "Default", title: "Restore the default design", onclick: function () {
      S.designs[kind] = defaultDesign(kind); designChanged();
    } }));
    var r = S.runs[kind];
    el.addRow.appendChild(h("span", { class: "nn-params", text: r ? r.net.paramCount().toLocaleString() + " trainable params" : "" }));
  }

  function learnLine(key, key2) {
    var e = LEARN[key];
    var p = h("div", { class: "nn-learn" });
    p.appendChild(h("a", { href: d2lHref(key), target: "_blank", rel: "noopener", text: "learn: " + e.title }));
    if (key2) p.appendChild(h("a", { href: d2lHref(key2), target: "_blank", rel: "noopener", text: " · activations" }));
    return p;
  }

  function numField(label, val, min, max, step, cb) {
    var inp = h("input", { class: "nn-in", type: "number", min: min, max: max, step: step, value: val, "aria-label": label });
    inp.addEventListener("change", function () {
      var v = parseFloat(inp.value);
      if (!isFinite(v)) v = val;
      v = Math.min(max, Math.max(min, v));
      if (step >= 1) v = Math.round(v);
      inp.value = v;
      cb(v);
    });
    return h("label", { class: "nn-f" }, [label, inp]);
  }

  function addBlock(type) {
    var d = S.designs[modeKind()];
    if (d.length >= 8) return;
    if (type === "dense") d.push({ type: "dense", units: 16, act: "relu" });
    else if (type === "dropout") d.push({ type: "dropout", rate: 0.1 });
    else d.unshift({ type: "fourier", freqs: 16, scale: 2 });
    designChanged();
  }
  function moveBlock(i, dir) {
    var d = S.designs[modeKind()], j = i + dir;
    if (j < 0 || j >= d.length) return;
    var t = d[i]; d[i] = d[j]; d[j] = t;
    designChanged();
  }
  function designChanged() {
    var kind = modeKind();
    if (kind === "paint") resetPaint(); else resetData();
    renderDesigner();
    if (S.view === "export") renderExport();
  }

  function renderTrainControls() {
    var kind = modeKind();
    var t = S.train[kind];
    var box = el.trainBox;
    box.innerHTML = "";
    var lr = h("select", { class: "nn-in", "aria-label": "learning rate" });
    [0.0003, 0.001, 0.003, 0.005, 0.01, 0.03, 0.1, 0.3, 1].forEach(function (v) { lr.appendChild(h("option", { value: v, text: String(v) })); });
    lr.value = String(t.lr);
    lr.onchange = function () { t.lr = +lr.value; if (S.view === "export") renderExport(); var r = S.runs[kind]; if (r && r.trainer) r.trainer.lr = t.lr; };
    var opt = h("select", { class: "nn-in", "aria-label": "optimizer" }, [h("option", { value: "adam", text: "Adam" }), h("option", { value: "sgd", text: "SGD" })]);
    opt.value = t.optimizer;
    opt.onchange = function () { t.optimizer = opt.value; if (S.view === "export") renderExport(); var r = S.runs[kind]; if (r && r.trainer) r.trainer.opt = t.optimizer; };
    var bs = h("select", { class: "nn-in", "aria-label": "batch size" });
    (kind === "paint" ? [64, 128, 256, 512, 1024] : [1, 8, 16, 32, 64, 200]).forEach(function (v) { bs.appendChild(h("option", { value: v, text: String(v) })); });
    bs.value = String(t.batch);
    bs.onchange = function () { t.batch = +bs.value; if (S.view === "export") renderExport(); var r = S.runs[kind]; if (r && r.trainer) r.trainer.batch = Math.min(r.trainer.n, t.batch); };
    var ep = h("input", { class: "nn-in", type: "number", min: 1, max: 5000, step: 1, value: t.epochs, "aria-label": "epochs" });
    ep.onchange = function () { t.epochs = Math.max(1, Math.min(5000, Math.round(+ep.value || 1))); ep.value = t.epochs; if (S.view === "export") renderExport(); };
    el.epochsInput = ep;
    var rows = [
      h("label", { class: "nn-f" }, ["learning rate", lr]),
      h("label", { class: "nn-f" }, ["optimizer", opt]),
      h("label", { class: "nn-f" }, ["batch size", bs]),
      h("label", { class: "nn-f" }, ["epochs", ep]),
    ];
    if (kind === "data") {
      var sp = h("select", { class: "nn-in", "aria-label": "speed" }, [
        h("option", { value: "1", text: "watch (1 epoch/frame)" }), h("option", { value: "5", text: "quick (5/frame)" }), h("option", { value: "0", text: "max" })]);
      sp.value = String(t.speed);
      sp.onchange = function () { t.speed = +sp.value; };
      rows.push(h("label", { class: "nn-f" }, ["speed", sp]));
    }
    box.appendChild(h("div", { class: "nn-fields" }, rows));
    el.playBtn = h("button", { type: "button", class: "nn-btn nn-play", "data-act": "play", text: "▶ Train", onclick: togglePlay });
    box.appendChild(h("div", { class: "nn-ctl", hidden: S.view === "export" ? "" : null }, [
      el.playBtn,
      h("button", { type: "button", class: "nn-btn", "data-act": "step", text: "Step", title: "Train one epoch", onclick: stepOnce }),
      h("button", { type: "button", class: "nn-btn nn-ghost", "data-act": "reset", text: "Reset", title: "New random weights", onclick: function () {
        S.seed[kind]++; if (kind === "paint") resetPaint(); else resetData(); } }),
    ]));
    box.appendChild(h("p", { class: "nn-learn" }, [
      h("a", { href: d2lHref("sgd"), target: "_blank", rel: "noopener", text: "learn: " + LEARN.sgd.title }),
      h("a", { href: d2lHref("adam"), target: "_blank", rel: "noopener", text: " · " + LEARN.adam.title }),
    ]));
    syncPlay();
  }

  // =========================================================== 2D data mode
  function buildDataStage() {
    var dsSel = h("select", { class: "nn-in", "aria-label": "dataset", id: "nn-dataset" });
    [["moons", "Moons (micrograd demo)"], ["circles", "Circles"], ["spiral", "Spiral"], ["xor", "XOR"]].forEach(function (d) {
      dsSel.appendChild(h("option", { value: d[0], text: d[1] }));
    });
    dsSel.value = S.ds.name;
    dsSel.onchange = function () { S.ds.name = dsSel.value; resetData(); };
    var noise = h("input", { class: "nn-range", type: "range", min: 0, max: 0.4, step: 0.02, value: S.ds.noise, "aria-label": "noise" });
    var noiseV = h("span", { class: "nn-val", text: S.ds.noise.toFixed(2) });
    noise.oninput = function () { noiseV.textContent = (+noise.value).toFixed(2); };
    noise.onchange = function () { S.ds.noise = +noise.value; resetData(); };
    el.boundary = h("canvas", { class: "nn-boundary", width: 480, height: 480, "aria-label": "decision boundary" });
    el.dataStatus = h("p", { class: "nn-status" });
    return h("div", { class: "nn-stage nn-stage-data" }, [
      h("div", { class: "nn-row" }, [h("label", { class: "nn-f" }, ["dataset", dsSel]), h("label", { class: "nn-f nn-grow" }, ["noise ", noiseV, noise])]),
      h("div", { class: "nn-canvaswrap" }, [el.boundary]),
      el.dataStatus,
    ]);
  }

  function makeRun(kind) {
    var design = S.designs[kind], t = S.train[kind], spec, data, test = null;
    if (kind === "paint") {
      data = S.paintData;
      spec = { inputDim: 2, outputDim: 3, outAct: "sigmoid", loss: "mse", layers: design };
    } else {
      data = C.makeDataset(S.ds.name, S.ds.n, S.ds.noise, 7);
      test = C.makeDataset(S.ds.name, S.ds.n, S.ds.noise, 99);
      spec = { inputDim: 2, outputDim: 1, outAct: "sigmoid", loss: "bce", layers: design };
    }
    var net = new C.Net(spec, S.seed[kind]);
    var r = {
      kind: kind, net: net, data: data, test: test, spec: spec,
      trainer: data ? new C.Trainer(net, data.X, data.Y, data.n, t) : null,
      running: false, hist: [], lastRender: 0, lastNet: 0, lastChart: 0, dirty: true,
      stepsSec: 0, _sc: 0, _st: performance.now(), nextFrame: 0,
    };
    if (kind === "data") r.bounds = C.bounds(data, 0.4);
    return r;
  }

  function resetData() {
    S.runs.data = makeRun("data");
    if (S.view === "data") buildNetSvg(S.runs.data);
    syncPlay();
    renderAllNow();
  }

  var GRID = 60;
  function renderBoundary(r) {
    var cv = el.boundary, ctx = cv.getContext("2d");
    var b = r.bounds, W = cv.width, H = cv.height;
    if (!r.gridX) {
      r.gridX = new Float64Array(GRID * GRID * 2);
      for (var gy = 0; gy < GRID; gy++) for (var gx = 0; gx < GRID; gx++) {
        var k = gy * GRID + gx;
        r.gridX[2 * k] = b.x0 + ((gx + 0.5) / GRID) * (b.x1 - b.x0);
        r.gridX[2 * k + 1] = b.y1 - ((gy + 0.5) / GRID) * (b.y1 - b.y0);
      }
      r.gridOut = new Float64Array(GRID * GRID);
      r.small = document.createElement("canvas");
      r.small.width = GRID; r.small.height = GRID;
    }
    r.net.predictInto(r.gridX, GRID * GRID, r.gridOut);
    var sctx = r.small.getContext("2d"), img = sctx.createImageData(GRID, GRID), d = img.data;
    for (var i = 0; i < GRID * GRID; i++) {
      var c = boundaryColor(r.gridOut[i]);
      d[4 * i] = c[0]; d[4 * i + 1] = c[1]; d[4 * i + 2] = c[2]; d[4 * i + 3] = 255;
    }
    sctx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(r.small, 0, 0, W, H);
    // p = 0.5 contour: mark cells whose neighbours straddle 0.5
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    var cw = W / GRID, ch = H / GRID;
    for (var y = 0; y < GRID - 1; y++) for (var x = 0; x < GRID - 1; x++) {
      var a = r.gridOut[y * GRID + x] > 0.5, e = r.gridOut[y * GRID + x + 1] > 0.5, f = r.gridOut[(y + 1) * GRID + x] > 0.5;
      if (a !== e || a !== f) ctx.fillRect((x + 1) * cw - 1, (y + 1) * ch - 1, 2, 2);
    }
    var pts = function (data, hollow) {
      for (var i2 = 0; i2 < data.n; i2++) {
        var px = ((data.X[2 * i2] - b.x0) / (b.x1 - b.x0)) * W, py = ((b.y1 - data.X[2 * i2 + 1]) / (b.y1 - b.y0)) * H;
        ctx.beginPath();
        ctx.arc(px, py, hollow ? 3.2 : 4.2, 0, Math.PI * 2);
        var col = data.Y[i2] > 0.5 ? "#3f93e0" : "#f08a3c";
        if (hollow) { ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.stroke(); }
        else { ctx.fillStyle = col; ctx.fill(); ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.lineWidth = 1; ctx.stroke(); }
      }
    };
    if (r.test) pts(r.test, true);
    pts(r.data, false);
  }
  function boundaryColor(p) {
    // orange (class 0) -> dark -> blue (class 1), TF-Playground style in the gallery palette
    var t = Math.abs(p - 0.5) * 2;
    var base = p > 0.5 ? [40, 110, 190] : [200, 105, 40];
    var dark = [22, 20, 18];
    var k = 0.25 + 0.6 * t;
    return [dark[0] + (base[0] - dark[0]) * k, dark[1] + (base[1] - dark[1]) * k, dark[2] + (base[2] - dark[2]) * k];
  }

  // ============================================================ Paint mode
  function buildPaintStage() {
    var num = h("input", { class: "nn-in nn-num", type: "number", min: 1, max: 1000, step: 1, value: S.paintCfg.num, "aria-label": "painting number", id: "nn-paint-num" });
    num.onchange = function () { pickPainting(+num.value); };
    var size = h("select", { class: "nn-in", "aria-label": "image size", id: "nn-paint-size" });
    [32, 48, 64, 96].forEach(function (v) { size.appendChild(h("option", { value: v, text: v + " px" })); });
    size.value = String(S.paintCfg.size);
    size.onchange = function () { S.paintCfg.size = +size.value; loadPainting(); };
    el.paintNum = num;
    el.target = h("canvas", { class: "nn-pimg", width: 64, height: 64, "aria-label": "target painting" });
    el.recon = h("canvas", { class: "nn-pimg", width: 64, height: 64, "aria-label": "network repaint" });
    el.film = h("div", { class: "nn-film", "aria-label": "training frames" });
    el.paintStatus = h("p", { class: "nn-status" });
    return h("div", { class: "nn-stage nn-stage-paint" }, [
      h("div", { class: "nn-row" }, [
        h("label", { class: "nn-f" }, ["painting #", num]),
        h("button", { type: "button", class: "nn-btn nn-small", text: "◀", "aria-label": "previous painting", onclick: function () { pickPainting(S.paintCfg.num - 1); } }),
        h("button", { type: "button", class: "nn-btn nn-small", text: "▶", "aria-label": "next painting", onclick: function () { pickPainting(S.paintCfg.num + 1); } }),
        h("button", { type: "button", class: "nn-btn nn-small", text: "Random", onclick: function () { pickPainting(1 + Math.floor(Math.random() * 1000)); } }),
        h("label", { class: "nn-f" }, ["size", size]),
      ]),
      h("div", { class: "nn-pair" }, [
        h("figure", {}, [el.target, h("figcaption", { text: "target (painting, downsampled)" })]),
        h("figure", {}, [el.recon, h("figcaption", { text: "network f(x, y) → r, g, b" })]),
      ]),
      el.paintStatus,
      h("h4", { class: "nn-h4", text: "Frames" }),
      el.film,
      h("p", { class: "nn-hint nn-small-hint", html:
        "A <em>coordinate network</em> sees only a pixel's position and must output its color, so the whole painting ends up stored in the weights. " +
        "The Fourier-features block lets a small MLP capture brushwork detail instead of a blur (try removing it)." }),
    ]);
  }

  function pickPainting(n) {
    n = Math.round(n);
    if (!isFinite(n)) n = 1;
    if (n < 1) n = 1000;
    if (n > 1000) n = 1;
    S.paintCfg.num = n;
    el.paintNum.value = n;
    loadPainting();
  }

  function loadPainting() {
    var n = S.paintCfg.num, size = S.paintCfg.size;
    var r0 = S.runs.paint;
    if (r0) r0.running = false;
    syncPlay();
    el.paintStatus.textContent = "Loading painting #" + n + "…";
    var img = new Image();
    img.decoding = "async";
    img.onload = function () {
      if (S.paintCfg.num !== n || S.paintCfg.size !== size) return;
      var w = img.naturalWidth, hh = img.naturalHeight, sc = size / Math.max(w, hh);
      var tw = Math.max(8, Math.round(w * sc)), th = Math.max(8, Math.round(hh * sc));
      var cv = el.target;
      cv.width = tw; cv.height = th;
      var ctx = cv.getContext("2d", { willReadFrequently: true });
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, tw, th);
      var px;
      try { px = ctx.getImageData(0, 0, tw, th).data; } catch (e) {
        el.paintStatus.textContent = "Could not read painting pixels (" + e.message + ")."; return;
      }
      S.paintData = C.imageDataset(px, tw, th);
      el.recon.width = tw; el.recon.height = th;
      resetPaint();
      el.paintStatus.textContent = "Painting #" + n + " at " + tw + "×" + th + " = " + (tw * th).toLocaleString() + " pixels. Press ▶ Train.";
    };
    img.onerror = function () { el.paintStatus.textContent = "Painting #" + n + " failed to load."; };
    img.src = "paintings/" + n + ".jpg";
  }

  function resetPaint() {
    if (!S.paintData) { S.runs.paint = null; return; }
    S.runs.paint = makeRun("paint");
    var r = S.runs.paint;
    r.pred = new Float64Array(r.data.n * 3);
    r.frameEpochs = [0, 1, 3, 10, 30, 100, 300, 1000, 3000];
    el.film.innerHTML = "";
    if (S.view === "paint") buildNetSvg(r);
    syncPlay();
    renderAllNow();
  }

  function renderRecon(r) {
    var t0 = performance.now();
    r.net.predictInto(r.data.X, r.data.n, r.pred);
    var cv = el.recon, ctx = cv.getContext("2d"), img = ctx.createImageData(r.data.w, r.data.h), d = img.data, p = r.pred;
    for (var i = 0; i < r.data.n; i++) {
      d[4 * i] = p[3 * i] * 255; d[4 * i + 1] = p[3 * i + 1] * 255; d[4 * i + 2] = p[3 * i + 2] * 255; d[4 * i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    r.renderCost = performance.now() - t0;
    var q = C.psnr(r.pred, r.data.Y, r.data.n);
    r.psnr = q.psnr; r.mse = q.mse;
    var ep = r.trainer.epoch;
    var last = r.hist[r.hist.length - 1];
    if (!last || last.epoch !== ep) r.hist.push({ epoch: ep, loss: q.mse, psnr: q.psnr });
    while (r.nextFrame < r.frameEpochs.length && ep >= r.frameEpochs[r.nextFrame]) {
      var fc = h("canvas", { class: "nn-frame", width: r.data.w, height: r.data.h, title: "epoch " + ep });
      fc.getContext("2d").putImageData(img, 0, 0);
      el.film.appendChild(h("figure", {}, [fc, h("figcaption", { text: "ep " + ep })]));
      r.nextFrame++;
    }
  }

  // ======================================================= network diagram
  var MAXN = 10;
  function buildNetSvg(r) {
    var wrap = el.netWrap;
    wrap.innerHTML = "";
    if (!r) return;
    var cols = [{ n: r.spec.inputDim, label: "in " + r.spec.inputDim, names: r.kind === "paint" ? ["x", "y"] : ["x₁", "x₂"] }];
    var conns = [], drops = [];
    r.net.layers.forEach(function (l) {
      if (l.kind === "dropout") { drops.push({ after: cols.length - 1, rate: l.rate }); return; }
      cols.push({ n: l.nout, label: l.kind === "fourier" ? "Fourier " + l.nout : (l.output ? "out " + l.nout : "Dense " + l.nout),
        sub: l.kind === "fourier" ? "sin/cos" : l.act, layer: l, names: l.output && r.kind === "paint" ? ["r", "g", "b"] : null });
      conns.push({ from: cols.length - 2, to: cols.length - 1, layer: l });
    });
    var W = 320, H = 250, padX = 24, top = 16, bottom = 40;
    var dx = (W - 2 * padX) / Math.max(1, cols.length - 1);
    var svg = s("svg", { viewBox: "0 0 " + W + " " + H, class: "nn-svg", role: "img", "aria-label": "network diagram" });
    cols.forEach(function (c, ci) {
      var shown = Math.min(c.n, MAXN);
      c.x = padX + ci * dx;
      c.ys = [];
      var span = H - top - bottom, gap = Math.min(22, span / Math.max(1, shown));
      var y0 = top + span / 2 - (gap * (shown - 1)) / 2;
      for (var k = 0; k < shown; k++) c.ys.push(y0 + k * gap);
      c.shown = shown;
    });
    var gLines = s("g", {}), gNodes = s("g", {});
    r.svgLines = [];
    conns.forEach(function (cn) {
      var a = cols[cn.from], b = cols[cn.to], l = cn.layer;
      for (var j = 0; j < b.shown; j++) for (var i = 0; i < a.shown; i++) {
        var ln = s("line", { x1: a.x, y1: a.ys[i], x2: b.x, y2: b.ys[j], "stroke-linecap": "round" });
        gLines.appendChild(ln);
        r.svgLines.push({ el: ln, layer: l, j: j, i: i, fixed: l.kind === "fourier" });
      }
    });
    drops.forEach(function (d) {
      var x = cols[d.after].x + dx / 2;
      gLines.appendChild(s("line", { x1: x, y1: top - 6, x2: x, y2: H - bottom + 4, class: "nn-dropline" }));
      var t = s("text", { x: x, y: top - 8, class: "nn-droptxt", "text-anchor": "middle" });
      t.textContent = "dropout " + d.rate;
      gLines.appendChild(t);
    });
    r.svgNodes = [];
    cols.forEach(function (c) {
      c.ys.forEach(function (y, k) {
        var circ = s("circle", { cx: c.x, cy: y, r: 6, class: "nn-node" });
        gNodes.appendChild(circ);
        if (c.layer && c.layer.kind === "dense") r.svgNodes.push({ el: circ, layer: c.layer, j: k });
        if (c.names && c.names[k]) {
          var tx = s("text", { x: c.x, y: y + 3, class: "nn-nodetxt", "text-anchor": "middle" });
          tx.textContent = c.names[k];
          gNodes.appendChild(tx);
        }
      });
      if (c.n > c.shown) {
        var more = s("text", { x: c.x, y: c.ys[c.shown - 1] + 17, class: "nn-more", "text-anchor": "middle" });
        more.textContent = "+" + (c.n - c.shown);
        gNodes.appendChild(more);
      }
      var lb = s("text", { x: c.x, y: H - 18, class: "nn-collabel", "text-anchor": "middle" });
      lb.textContent = c.label;
      gNodes.appendChild(lb);
      if (c.sub) {
        var sb = s("text", { x: c.x, y: H - 6, class: "nn-colsub", "text-anchor": "middle" });
        sb.textContent = c.sub;
        gNodes.appendChild(sb);
      }
    });
    svg.appendChild(gLines);
    svg.appendChild(gNodes);
    wrap.appendChild(svg);
    updateNetSvg(r);
  }

  function updateNetSvg(r) {
    if (!r || !r.svgLines) return;
    var maxBy = new Map();
    r.svgLines.forEach(function (o) {
      if (o.fixed) return;
      var w = o.layer.W[o.j * o.layer.nin + o.i];
      o.w = w;
      maxBy.set(o.layer, Math.max(maxBy.get(o.layer) || 1e-9, Math.abs(w)));
    });
    r.svgLines.forEach(function (o) {
      if (o.fixed) {
        o.el.setAttribute("stroke", "rgba(200,190,160,0.16)");
        o.el.setAttribute("stroke-width", "0.6");
        return;
      }
      var t = Math.abs(o.w) / maxBy.get(o.layer);
      var a = (0.12 + 0.78 * t).toFixed(2);
      o.el.setAttribute("stroke", o.w >= 0 ? "rgba(224,182,64," + a + ")" : "rgba(95,168,232," + a + ")");
      o.el.setAttribute("stroke-width", (0.35 + 3.3 * t).toFixed(2));
    });
    r.svgNodes.forEach(function (o) {
      var t = Math.max(-1, Math.min(1, o.layer.b[o.j] * 2));
      o.el.setAttribute("fill", t >= 0 ? "rgba(224,182,64," + (0.12 + 0.6 * t).toFixed(2) + ")" : "rgba(95,168,232," + (0.12 - 0.6 * t).toFixed(2) + ")");
    });
  }

  // ================================================================ chart
  function renderChart(r) {
    var cv = el.chart, ctx = cv.getContext("2d"), W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#0c0d10";
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(245,240,232,0.08)";
    ctx.lineWidth = 1;
    for (var g = 1; g < 4; g++) { ctx.beginPath(); ctx.moveTo(0, (g * H) / 4); ctx.lineTo(W, (g * H) / 4); ctx.stroke(); }
    var hs = r ? r.hist : [];
    ctx.font = "11px DM Sans, system-ui, sans-serif";
    if (hs.length < 1) {
      ctx.fillStyle = "rgba(200,190,160,0.6)";
      ctx.fillText("press ▶ Train", 10, 20);
      return;
    }
    var maxE = Math.max(1, hs[hs.length - 1].epoch);
    var lmax = -Infinity, lmin = Infinity;
    hs.forEach(function (p) { var v = Math.log10(Math.max(1e-6, p.loss)); if (v > lmax) lmax = v; if (v < lmin) lmin = v; });
    if (lmax - lmin < 0.5) lmin = lmax - 0.5;
    var X = function (e) { return 4 + (e / maxE) * (W - 8); };
    ctx.strokeStyle = "#e0b640";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    hs.forEach(function (p, i) {
      var y = 6 + (1 - (Math.log10(Math.max(1e-6, p.loss)) - lmin) / (lmax - lmin)) * (H - 22);
      if (i) ctx.lineTo(X(p.epoch), y); else ctx.moveTo(X(p.epoch), y);
    });
    ctx.stroke();
    var paint = r.kind === "paint";
    ctx.strokeStyle = "#5fa8e8";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    hs.forEach(function (p, i) {
      var v = paint ? Math.min(1, Math.max(0, (p.psnr - 10) / 35)) : p.acc;
      var y = 6 + (1 - v) * (H - 22);
      if (i) ctx.lineTo(X(p.epoch), y); else ctx.moveTo(X(p.epoch), y);
    });
    ctx.stroke();
    ctx.fillStyle = "#e0b640"; ctx.fillText("loss (log)", 8, H - 4);
    ctx.fillStyle = "#5fa8e8"; ctx.fillText(paint ? "PSNR 10–45 dB" : "train acc 0–100%", 70, H - 4);
    ctx.fillStyle = "rgba(200,190,160,0.7)";
    ctx.textAlign = "right"; ctx.fillText("epoch " + maxE, W - 6, H - 4); ctx.textAlign = "left";
  }

  function renderStats(r) {
    if (!r) { el.stats.innerHTML = ""; return; }
    var tr = r.trainer, rows = [];
    rows.push(["epoch", tr ? tr.epoch + " / " + S.train[r.kind].epochs : "–"]);
    rows.push(["loss", fmt(tr && tr.lastEpochLoss, 4)]);
    if (r.kind === "data") {
      rows.push(["train acc", r.acc == null ? "–" : (r.acc * 100).toFixed(1) + "%"]);
      rows.push(["test acc", r.testAcc == null ? "–" : (r.testAcc * 100).toFixed(1) + "%"]);
    } else {
      rows.push(["PSNR", r.psnr == null ? "–" : r.psnr.toFixed(1) + " dB"]);
      rows.push(["pixels", r.data ? r.data.n.toLocaleString() : "–"]);
    }
    rows.push(["params", r.net.paramCount().toLocaleString()]);
    rows.push(["steps/s", r.stepsSec ? String(Math.round(r.stepsSec)) : "–"]);
    el.stats.innerHTML = rows.map(function (x) { return "<div><dt>" + x[0] + "</dt><dd>" + x[1] + "</dd></div>"; }).join("");
    el.stats.setAttribute("data-kind", r.kind);
    if (r.kind === "data") {
      el.dataStatus.textContent = r.acc == null
        ? "Press ▶ Train (or Step) to fit the " + S.ds.name + " data. Filled dots = training set, rings = held-out test set."
        : (r.running ? "Training… " : tr.epoch >= S.train.data.epochs ? "Done. " : "Paused. ") +
          "Epoch " + tr.epoch + ": train " + (r.acc * 100).toFixed(1) + "%, test " + (r.testAcc * 100).toFixed(1) + "%.";
    } else if (r.psnr != null && tr.epoch > 0) {
      el.paintStatus.textContent = (r.running ? "Repainting… " : tr.epoch >= S.train.paint.epochs ? "Done. " : "Paused. ") +
        "Epoch " + tr.epoch + ", PSNR " + r.psnr.toFixed(1) + " dB (higher = closer to the painting).";
    }
  }

  // ============================================================ train loop
  function currentRun() {
    if (S.view === "paint") return S.runs.paint;
    if (S.view === "data") return S.runs.data;
    return null;
  }
  function togglePlay() {
    var r = currentRun();
    if (!r || !r.trainer) return;
    var t = S.train[r.kind];
    if (!r.running && r.trainer.epoch >= t.epochs) {
      t.epochs = r.trainer.epoch + t.epochs; // finished: keep going for another round
      if (el.epochsInput) el.epochsInput.value = t.epochs;
    }
    r.running = !r.running;
    syncPlay();
    kick();
  }
  function stepOnce() {
    var r = currentRun();
    if (!r || !r.trainer) return;
    r.running = false;
    r.trainer.runEpoch();
    afterEpoch(r);
    syncPlay();
    renderAllNow();
  }
  function syncPlay() {
    if (!el.playBtn) return;
    var r = currentRun();
    var on = !!(r && r.running);
    el.playBtn.textContent = on ? "❚❚ Pause" : "▶ Train";
    el.playBtn.classList.toggle("on", on);
    el.playBtn.setAttribute("data-state", on ? "running" : "paused");
  }
  function afterEpoch(r) {
    if (r.kind === "data") {
      r.acc = C.accuracy(r.net, r.data);
      r.testAcc = C.accuracy(r.net, r.test);
      r.hist.push({ epoch: r.trainer.epoch, loss: r.trainer.lastEpochLoss, acc: r.acc });
      if (r.hist.length > 1200) r.hist = r.hist.filter(function (_, i) { return i % 2 === 0; });
    }
  }
  function kick() { if (!S.raf && S.visible) S.raf = requestAnimationFrame(loop); }

  function loop(now) {
    S.raf = 0;
    if (!S.visible || document.hidden) return;
    var r = currentRun();
    var busy = false;
    if (r && r.running && r.trainer) {
      busy = true;
      var t = S.train[r.kind];
      var budget = r.kind === "paint" ? 11 : 9;
      var t0 = performance.now(), epochs = 0, steps = 0;
      var maxEpochs = r.kind === "data" && t.speed ? t.speed : Infinity;
      while (performance.now() - t0 < budget) {
        steps++;
        if (r.trainer.stepBatch()) {
          epochs++;
          afterEpoch(r);
          if (r.trainer.epoch >= t.epochs) { r.running = false; syncPlay(); break; }
          if (epochs >= maxEpochs) break;
        }
      }
      r._sc += steps;
      if (now - r._st > 1000) { r.stepsSec = (r._sc * 1000) / (now - r._st); r._sc = 0; r._st = now; }
      r.dirty = true;
    }
    if (r && r.dirty) renderThrottled(r, now, !r.running);
    if (busy || (r && r.dirty)) kick();
  }

  function renderThrottled(r, now, force) {
    if (r.kind === "data") {
      if (force || now - r.lastRender > 90) { renderBoundary(r); r.lastRender = now; }
    } else {
      var iv = Math.max(160, (r.renderCost || 10) * 8);
      if (force || now - r.lastRender > iv) { renderRecon(r); r.lastRender = now; }
    }
    if (force || now - r.lastNet > 260) { updateNetSvg(r); r.lastNet = now; }
    if (force || now - r.lastChart > 240) { renderChart(r); renderStats(r); r.lastChart = now; }
    if (force) r.dirty = false;
  }

  function renderAllNow() {
    if (!S.built) return;
    var r = currentRun();
    if (r) renderThrottled(r, performance.now(), true);
    else { renderChart(null); renderStats(null); }
    if (S.view !== "micrograd") renderDesigner();
  }

  // ============================================================= micrograd
  var PRESETS = {
    simple: { title: "x*2 + 1 → relu (trace_graph.ipynb, cell 1)", inputs: { x: 1.0 } },
    neuron: { title: "2D neuron: relu(w·x + b) (trace_graph.ipynb, cell 2)", inputs: { x1: 1.0, x2: -2.0 } },
    tanh: { title: "tanh neuron (micrograd lecture)", inputs: { x1: 2.0, x2: 0.0, w1: -3.0, w2: 1.0, b: 6.8813735870195432 } },
    readme: { title: "README example (checks g = 24.7041)", inputs: { a: -4.0, b: 2.0 } },
  };
  function buildExpr(name, v) {
    var V = MG.Value;
    var leaf = function (x, l) { return new V(x, [], "", l); };
    var out, leaves = [];
    if (name === "simple") {
      var x = leaf(v.x, "x");
      leaves.push(x);
      out = x.mul(2).setLabel("x*2").add(1).setLabel("x*2+1").relu().setLabel("y");
    } else if (name === "neuron") {
      MG.seed(1337);
      var n = new MG.Neuron(2);
      n.w[0].label = "w1"; n.w[1].label = "w2"; n.b.label = "b";
      var xs = [leaf(v.x1, "x1"), leaf(v.x2, "x2")];
      leaves = xs;
      out = n.call(xs).setLabel("y");
      out._prev[0].label = "n";
    } else if (name === "tanh") {
      var x1 = leaf(v.x1, "x1"), x2 = leaf(v.x2, "x2"), w1 = leaf(v.w1, "w1"), w2 = leaf(v.w2, "w2"), bb = leaf(v.b, "b");
      leaves = [x1, x2, w1, w2, bb];
      var s1 = x1.mul(w1).setLabel("x1*w1"), s2 = x2.mul(w2).setLabel("x2*w2");
      out = s1.add(s2).setLabel("x1w1+x2w2").add(bb).setLabel("n").tanh().setLabel("o");
    } else {
      var A = leaf(v.a, "a"), B = leaf(v.b, "b");
      leaves = [A, B];
      var c = A.add(B);
      var d = A.mul(B).add(B.pow(3));
      c = c.add(c.add(1));
      c = c.add(new V(1).add(c).add(A.neg()));
      d = d.add(d.mul(2).add(B.add(A).relu()));
      d = d.add(new V(3).mul(d).add(B.sub(A).relu()));
      c.label = "c"; d.label = "d";
      var e = c.sub(d).setLabel("e");
      var f = e.pow(2).setLabel("f");
      out = f.div(2.0).add(new V(10.0).div(f)).setLabel("g");
    }
    var topo = out.backward();
    return { out: out, leaves: leaves, topo: topo };
  }

  function buildMicrogradStage() {
    var sel = h("select", { class: "nn-in", "aria-label": "expression", id: "nn-mg-preset" });
    Object.keys(PRESETS).forEach(function (k) { sel.appendChild(h("option", { value: k, text: PRESETS[k].title })); });
    sel.value = S.mg.preset;
    sel.onchange = function () { S.mg.preset = sel.value; S.mg.inputs = {}; S.mg.reveal = -1; clearInterval(S.mg.anim); renderMg(); };
    el.mgInputs = h("div", { class: "nn-mg-inputs" });
    el.mgGraph = h("div", { class: "nn-mg-graph" });
    el.mgNote = h("p", { class: "nn-status", id: "nn-mg-note" });
    el.mgDemoCanvas = h("canvas", { class: "nn-mg-demo", width: 220, height: 220, "aria-label": "micrograd demo decision boundary" });
    el.mgDemoLog = h("p", { class: "nn-status", id: "nn-mg-log", text: "MLP(2, [16, 16, 1]) · 337 parameters · SVM max-margin loss + L2 · SGD lr 1.0 → 0.1" });
    el.mgDemoBtn = h("button", { type: "button", class: "nn-btn nn-play", id: "nn-mg-demo-run", text: "▶ Run demo.ipynb (100 steps)", onclick: runMgDemo });
    var lic = h("details", { class: "nn-license" }, [
      h("summary", { text: "micrograd license (MIT) — © 2020 Andrej Karpathy" }),
      h("pre", { text: (MG && MG.LICENSE_TEXT) || MIT_TEXT }),
    ]);
    return h("div", { class: "nn-stage nn-stage-mg" }, [
      h("p", { class: "nn-hint", html:
        "micrograd is Andrej Karpathy's ~100-line autograd engine, ported here to JavaScript. Each box is a <code>Value</code> with its forward <b>data</b> and the <b>grad</b> that " +
        "<code>backward()</code> fills in by the chain rule, walking the graph in reverse topological order — the same idea as " +
        "<code>torch.autograd</code> and <code>jax.grad</code>, one scalar at a time. " +
        '<a href="' + d2lHref("autograd") + '" target="_blank" rel="noopener">learn: ' + LEARN.autograd.title + "</a> · " +
        '<a href="' + d2lHref("backprop") + '" target="_blank" rel="noopener">' + LEARN.backprop.title + "</a>" }),
      h("div", { class: "nn-row" }, [h("label", { class: "nn-f nn-grow" }, ["expression", sel]),
        h("button", { type: "button", class: "nn-btn nn-small", id: "nn-mg-animate", text: "Step through backward()", onclick: animateBackward })]),
      el.mgInputs, el.mgGraph, el.mgNote,
      h("h4", { class: "nn-h4", text: "demo.ipynb — train micrograd's own MLP on moons" }),
      h("div", { class: "nn-mg-demorow" }, [el.mgDemoCanvas, h("div", {}, [el.mgDemoBtn, el.mgDemoLog])]),
      lic,
    ]);
  }

  function mgVals() {
    var p = PRESETS[S.mg.preset], vals = {};
    Object.keys(p.inputs).forEach(function (k) { vals[k] = k in S.mg.inputs ? S.mg.inputs[k] : p.inputs[k]; });
    return vals;
  }

  function renderMg() {
    var vals = mgVals();
    el.mgInputs.innerHTML = "";
    Object.keys(vals).forEach(function (k) {
      var inp = h("input", { class: "nn-range", type: "range", min: -4, max: 7, step: 0.05, value: vals[k], "aria-label": k });
      var lab = h("span", { class: "nn-val", text: (+vals[k]).toFixed(2) });
      inp.oninput = function () { S.mg.inputs[k] = +inp.value; lab.textContent = (+inp.value).toFixed(2); S.mg.reveal = -1; clearInterval(S.mg.anim); drawMgGraph(); };
      el.mgInputs.appendChild(h("label", { class: "nn-f" }, [k + " = ", lab, inp]));
    });
    drawMgGraph();
  }

  function drawMgGraph() {
    var ex = buildExpr(S.mg.preset, mgVals());
    S.mg.ex = ex;
    var tr = MG.trace(ex.out);
    // layout like graphviz rankdir=LR: value nodes at column 2*depth, their op node at 2*depth-1
    var depth = new Map();
    ex.topo.forEach(function (v) {
      var d = 0;
      v._prev.forEach(function (c) { d = Math.max(d, depth.get(c) + 1); });
      depth.set(v, d);
    });
    var cols = [];
    tr.nodes.forEach(function (v) {
      var c = depth.get(v) * 2;
      (cols[c] = cols[c] || []).push({ v: v, kind: "val" });
      if (v._op) (cols[c - 1] = cols[c - 1] || []).push({ v: v, kind: "op" });
    });
    var topoIdx = new Map();
    ex.topo.forEach(function (v, i) { topoIdx.set(v, i); });
    var BW = 176, BH = 44, OW = 36, CG = 30, RG = 14;
    var pos = new Map(), opPos = new Map();
    var x = 10, maxH = 0;
    for (var ci = 0; ci < cols.length; ci++) {
      var col = cols[ci] || [];
      col.sort(function (a, b) { return topoIdx.get(a.v) - topoIdx.get(b.v); });
      if (ci > 0) {
        col.forEach(function (n) {
          var ys = [];
          if (n.kind === "op") n.v._prev.forEach(function (c) { if (pos.has(c)) ys.push(pos.get(c).y); });
          else if (opPos.has(n.v)) ys.push(opPos.get(n.v).y);
          n.bary = ys.length ? ys.reduce(function (a, b) { return a + b; }, 0) / ys.length : 0;
        });
        col.sort(function (a, b) { return a.bary - b.bary; });
      }
      var w = ci % 2 === 0 ? BW : OW;
      var yPrev = -Infinity;
      col.forEach(function (n) {
        // stay near the barycenter, but never overlap the node above
        var want = ci > 0 && n.bary ? n.bary : 0;
        var y = Math.max(10 + BH / 2, yPrev + BH + RG, want);
        yPrev = y;
        if (n.kind === "val") pos.set(n.v, { x: x, y: y, w: BW }); else opPos.set(n.v, { x: x, y: y, w: OW });
        maxH = Math.max(maxH, y + BH / 2 + 10);
      });
      if (col.length) x += w + CG;
    }
    var W = x, H = Math.max(maxH, 80);
    var svg = s("svg", { width: W, height: H, viewBox: "0 0 " + W + " " + H, class: "nn-mg-svg", role: "img", "aria-label": "micrograd computation graph" });
    var edges = s("g", { class: "nn-mg-edges" }), nodes = s("g", {});
    var revealed = new Set();
    if (S.mg.reveal >= 0) for (var ri = 0; ri <= S.mg.reveal && ri < ex.topo.length; ri++) revealed.add(ex.topo[ex.topo.length - 1 - ri]);
    function curve(x1, y1, x2, y2) {
      var mx = (x1 + x2) / 2;
      return s("path", { d: "M" + x1 + "," + y1 + " C" + mx + "," + y1 + " " + mx + "," + y2 + " " + x2 + "," + y2, class: "nn-mg-edge" });
    }
    var seenEdge = new Set();
    tr.edges.forEach(function (e) {
      var key = e[0].id + ">" + e[1].id;
      if (seenEdge.has(key)) return;
      seenEdge.add(key);
      var a = pos.get(e[0]), o = opPos.get(e[1]);
      if (a && o) edges.appendChild(curve(a.x + a.w, a.y, o.x, o.y));
    });
    tr.nodes.forEach(function (v) {
      var a = pos.get(v);
      if (v._op) { var o = opPos.get(v); edges.appendChild(curve(o.x + o.w, o.y, a.x, a.y)); }
      var showGrad = S.mg.reveal < 0 || revealed.has(v);
      var g = s("g", { class: "nn-mg-node" + (v === ex.out ? " nn-mg-root" : "") + (v._prev.length ? "" : " nn-mg-leaf") + (S.mg.reveal >= 0 && revealed.has(v) ? " nn-mg-lit" : ""), "data-label": v.label || "" });
      g.appendChild(s("rect", { x: a.x, y: a.y - BH / 2, width: BW, height: BH, rx: 6 }));
      var t1 = s("text", { x: a.x + 8, y: a.y - 5, class: "nn-mg-lbl" });
      t1.textContent = v.label || (v._prev.length ? "" : "const");
      var t2 = s("text", { x: a.x + BW - 8, y: a.y - 5, class: "nn-mg-data", "text-anchor": "end" });
      t2.textContent = "data " + v.data.toFixed(4);
      var t3 = s("text", { x: a.x + BW - 8, y: a.y + 14, class: "nn-mg-grad" + (showGrad ? "" : " nn-mg-hidden"), "text-anchor": "end" });
      t3.textContent = "grad " + (showGrad ? v.grad.toFixed(4) : "?");
      g.appendChild(t1); g.appendChild(t2); g.appendChild(t3);
      nodes.appendChild(g);
      if (v._op) {
        var op = opPos.get(v);
        var og = s("g", { class: "nn-mg-op" });
        og.appendChild(s("circle", { cx: op.x + OW / 2, cy: op.y, r: OW / 2 }));
        var ot = s("text", { x: op.x + OW / 2, y: op.y + 4, "text-anchor": "middle" });
        ot.textContent = v._op;
        og.appendChild(ot);
        nodes.appendChild(og);
      }
    });
    svg.appendChild(edges);
    svg.appendChild(nodes);
    el.mgGraph.innerHTML = "";
    el.mgGraph.appendChild(svg);
    var lbl = ex.out.label || "out";
    var note = lbl + " = " + ex.out.data.toFixed(4) + " · " +
      ex.leaves.map(function (l) { return "∂" + lbl + "/∂" + l.label + " = " + l.grad.toFixed(4); }).join(" · ") + " · " + tr.nodes.length + " Values";
    if (S.mg.preset === "readme") note += ". micrograd's README expects g = 24.7041, a.grad = 138.8338, b.grad = 645.5773 at a = -4, b = 2.";
    if (S.mg.preset === "neuron") note += ". Weights come from a seeded JS RNG, so they differ from Python's random.seed(1337).";
    el.mgNote.textContent = note;
  }

  function animateBackward() {
    clearInterval(S.mg.anim);
    S.mg.reveal = 0;
    drawMgGraph();
    var n = S.mg.ex.topo.length;
    S.mg.anim = setInterval(function () {
      if (!S.visible || S.view !== "micrograd") { clearInterval(S.mg.anim); return; }
      S.mg.reveal++;
      if (S.mg.reveal >= n) { clearInterval(S.mg.anim); S.mg.reveal = -1; }
      drawMgGraph();
    }, Math.max(110, Math.min(450, 6000 / n)));
  }

  function runMgDemo() {
    if (S.mg.demo && S.mg.demo.running) { S.mg.demo.running = false; el.mgDemoBtn.textContent = "▶ Resume demo"; return; }
    if (!S.mg.demo || S.mg.demo.k >= 100) {
      MG.seed(1337);
      var d = C.makeDataset("moons", 100, 0.1, 1337);
      var X = [], y = [];
      for (var i = 0; i < 100; i++) { X.push([d.X[2 * i], d.X[2 * i + 1]]); y.push(d.Y[i] * 2 - 1); }
      S.mg.demo = { model: new MG.MLP(2, [16, 16, 1]), X: X, y: y, data: d, k: 0, running: false, last: null };
    }
    var demo = S.mg.demo;
    demo.running = true;
    el.mgDemoBtn.textContent = "❚❚ Pause";
    (function tick() {
      if (!demo.running || S.mg.demo !== demo) return;
      if (!S.visible || S.view !== "micrograd") { demo.running = false; el.mgDemoBtn.textContent = "▶ Resume demo"; return; }
      var t0 = performance.now();
      while (demo.k < 100 && performance.now() - t0 < 24) { demo.last = MG.demoStep(demo.model, demo.X, demo.y, demo.k, 100); demo.k++; }
      el.mgDemoLog.textContent = "step " + demo.k + "/100 · loss " + demo.last.loss.toFixed(4) + " · accuracy " + (demo.last.acc * 100).toFixed(0) + "% · lr " + demo.last.lr.toFixed(3);
      el.mgDemoLog.setAttribute("data-acc", String(demo.last.acc));
      el.mgDemoLog.setAttribute("data-step", String(demo.k));
      drawMgDemo(demo);
      if (demo.k >= 100) { demo.running = false; el.mgDemoBtn.textContent = "↻ Run demo.ipynb again"; el.mgDemoLog.textContent += " · done"; return; }
      requestAnimationFrame(tick);
    })();
  }
  function mgForward(model, x0, x1) {
    var x = [x0, x1];
    model.layers.forEach(function (L) {
      x = L.neurons.map(function (n) {
        var a = n.b.data;
        for (var i = 0; i < n.w.length; i++) a += n.w[i].data * x[i];
        return n.nonlin && a < 0 ? 0 : a;
      });
    });
    return x[0];
  }
  function drawMgDemo(demo) {
    var cv = el.mgDemoCanvas, ctx = cv.getContext("2d"), W = cv.width, H = cv.height, G = 48;
    var b = C.bounds(demo.data, 0.5);
    if (!demo.small) { demo.small = document.createElement("canvas"); demo.small.width = G; demo.small.height = G; }
    var sctx = demo.small.getContext("2d"), img = sctx.createImageData(G, G), d = img.data;
    for (var gy = 0; gy < G; gy++) for (var gx = 0; gx < G; gx++) {
      var px = b.x0 + ((gx + 0.5) / G) * (b.x1 - b.x0), py = b.y1 - ((gy + 0.5) / G) * (b.y1 - b.y0);
      var c = boundaryColor(1 / (1 + Math.exp(-2 * mgForward(demo.model, px, py)))), o = 4 * (gy * G + gx);
      d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
    }
    sctx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(demo.small, 0, 0, W, H);
    for (var i = 0; i < demo.X.length; i++) {
      var qx = ((demo.X[i][0] - b.x0) / (b.x1 - b.x0)) * W, qy = ((b.y1 - demo.X[i][1]) / (b.y1 - b.y0)) * H;
      ctx.beginPath();
      ctx.arc(qx, qy, 3.3, 0, Math.PI * 2);
      ctx.fillStyle = demo.y[i] > 0 ? "#3f93e0" : "#f08a3c";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,.85)";
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }
  }

  var MIT_TEXT = "The MIT License (MIT) Copyright (c) 2020 Andrej Karpathy\n\n" +
    "Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the \"Software\"), " +
    "to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, " +
    "and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\n" +
    "The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\n" +
    "THE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, " +
    "FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER " +
    "LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.";

  // ================================================================ export
  function buildExportStage() {
    var forSel = h("div", { class: "nn-seg", role: "group", "aria-label": "which model" });
    [["data", "2D classifier"], ["paint", "Paint network"]].forEach(function (f) {
      forSel.appendChild(h("button", { type: "button", class: "nn-segb", "data-for": f[0], text: f[1], onclick: function () {
        S.exportFor = f[0]; renderDesigner(); renderTrainControls(); renderExport(); } }));
    });
    var langs = h("div", { class: "nn-seg", role: "tablist", "aria-label": "framework" });
    [["keras", "Keras"], ["pytorch", "PyTorch"], ["jax", "JAX / Flax"], ["micrograd", "micrograd"]].forEach(function (l) {
      langs.appendChild(h("button", { type: "button", class: "nn-segb", "data-lang": l[0], text: l[1], onclick: function () { S.exportLang = l[0]; renderExport(); } }));
    });
    el.exportFor = forSel;
    el.langs = langs;
    el.code = h("pre", { class: "nn-code", id: "nn-code", tabindex: "0" });
    el.copyBtn = h("button", { type: "button", class: "nn-btn nn-small", id: "nn-copy", text: "Copy", onclick: copyCode });
    el.refs = h("div", { class: "nn-refs" });
    return h("div", { class: "nn-stage nn-stage-export" }, [
      h("p", { class: "nn-hint", html: "The layers on the left, written out for each framework — same architecture, optimizer, learning rate, batch size and epochs. Edit the design and the code follows." }),
      h("div", { class: "nn-row" }, [forSel, langs, el.copyBtn]),
      el.code,
      h("h4", { class: "nn-h4", text: "Where each piece lives in the repos you downloaded" }),
      el.refs,
    ]);
  }

  var CONCEPTS = [
    ["dense", "Dense / Linear"], ["act", "Activations"], ["dropout", "Dropout"], ["fourier", "Fourier features"],
    ["bce", "Binary cross-entropy"], ["mse", "MSE loss"], ["sgd", "SGD"], ["adam", "Adam"],
    ["init", "Weight init"], ["backprop", "Backprop"], ["autograd", "Autograd"], ["conv", "Conv2D (future image mode)"],
  ];
  function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  function renderExport() {
    var kind = S.exportFor;
    Array.prototype.forEach.call(el.exportFor.children, function (b) { b.classList.toggle("on", b.getAttribute("data-for") === kind); });
    Array.prototype.forEach.call(el.langs.children, function (b) { b.classList.toggle("on", b.getAttribute("data-lang") === S.exportLang); });
    var spec = { outputDim: kind === "paint" ? 3 : 1, layers: S.designs[kind] };
    el.code.textContent = C.exportCode(spec, S.train[kind], S.exportLang);
    el.code.setAttribute("data-lang", S.exportLang);
    var used = { dense: 1, act: 1, init: 1, backprop: 1, autograd: 1, conv: 1 };
    S.designs[kind].forEach(function (b) { used[b.type] = 1; });
    used[kind === "paint" ? "mse" : "bce"] = 1;
    used[S.train[kind].optimizer === "adam" ? "adam" : "sgd"] = 1;
    var cell = function (repo, base, path) {
      return '<a href="' + base + path + '" target="_blank" rel="noopener" title="' + esc("AI-ML-Repositories/" + repo + "/" + path) + '">' + esc(path.split("/").slice(-2).join("/")) + "</a>";
    };
    var html = '<div class="nn-tablewrap"><table class="nn-reftable"><thead><tr><th>concept</th><th>keras-master</th><th>pytorch-main</th><th>jax-main</th><th>learn more (d2l)</th></tr></thead><tbody>';
    CONCEPTS.forEach(function (c) {
      var k = c[0];
      if (!used[k]) return;
      var e = LEARN[k];
      html += "<tr><td>" + c[1] + "</td><td>" + cell("keras-master", GH.keras, e.keras) + "</td><td>" + cell("pytorch-main", GH.torch, e.torch) +
        "</td><td>" + cell("jax-main", GH.jax, e.jax) + '</td><td><a href="' + d2lHref(k) + '" target="_blank" rel="noopener" title="' +
        esc(d2lLocal(k) ? "AI-ML-Repositories/" + d2lLocal(k) : "") + '">' + esc(e.title) + "</a></td></tr>";
    });
    html += "</tbody></table></div>";
    html += '<p class="nn-hint nn-small-hint">Links open the same file on GitHub; on your PC it is under <code>AI-ML-Repositories/&lt;repo&gt;/…</code> (hover a link for the path). ' +
      "micrograd: <code>micrograd-master/micrograd/engine.py</code> + <code>nn.py</code> are ported in <code>js/neural-micrograd.js</code>. " +
      "Toy data: <code>scikit-learn-main/sklearn/datasets/_samples_generator.py</code> (make_moons, make_circles). " +
      "fastai builds on PyTorch (<code>fastai-main/fastai/layers.py</code>); TensorFlow is a Keras backend (<code>tensorflow-master</code>).</p>";
    el.refs.innerHTML = html;
  }

  function copyCode() {
    var txt = el.code.textContent;
    var done = function () { el.copyBtn.textContent = "Copied ✓"; setTimeout(function () { el.copyBtn.textContent = "Copy"; }, 1400); };
    var manual = function () {
      var rg = document.createRange();
      rg.selectNodeContents(el.code);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(rg);
      el.copyBtn.textContent = "Selected — press Ctrl/⌘-C";
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done, manual);
    else manual();
  }

  // ================================================================= views
  function setView(v) {
    var prev = currentRun();
    if (prev && S.view !== v) prev.running = false; // leaving a mode pauses it (keeps phones cool)
    clearInterval(S.mg.anim);
    S.mg.reveal = -1;
    if (S.mg.demo) S.mg.demo.running = false;
    S.view = v;
    Array.prototype.forEach.call(el.modes.children, function (b) {
      var on = b.getAttribute("data-view") === v;
      b.classList.toggle("on", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    el.stageData.hidden = v !== "data";
    el.stagePaint.hidden = v !== "paint";
    el.stageMg.hidden = v !== "micrograd";
    el.stageExport.hidden = v !== "export";
    el.left.hidden = v === "micrograd";
    el.right.hidden = v === "micrograd" || v === "export";
    el.grid.setAttribute("data-view", v);
    renderTrainControls();
    if (v === "data" && !S.runs.data) resetData();
    if (v === "paint" && !S.paintData) loadPainting();
    if (v === "export") renderExport();
    if (v === "micrograd") {
      renderMg();
      if (S.mg.demo && S.mg.demo.k < 100) el.mgDemoBtn.textContent = "▶ Resume demo";
    }
    if (v === "data" || v === "paint") {
      var r = currentRun();
      if (r) buildNetSvg(r); else el.netWrap.innerHTML = "";
    }
    syncPlay();
    renderAllNow();
  }

  function onShow() {
    if (!C || !MG) return;
    S.visible = true;
    build();
    kick();
  }
  function onHide() {
    S.visible = false;
    ["data", "paint"].forEach(function (k) { if (S.runs[k]) S.runs[k].running = false; });
    if (S.mg.demo) S.mg.demo.running = false;
    clearInterval(S.mg.anim);
    if (S.built) syncPlay();
  }
  window.addEventListener("neural-hide", onHide);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) kick(); });

  window.NeuralLab = {
    onShow: onShow,
    onHide: onHide,
    setView: function (v) { if (S.built) setView(v); },
    _state: S, // read-only hooks for tests
  };
})();
