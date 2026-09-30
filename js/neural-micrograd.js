/*!
 * neural-micrograd.js — a JavaScript port of micrograd (engine.py + nn.py)
 * for the Neural Lab tab. Scalar-valued autograd + a tiny MLP library.
 *
 * Original Python: https://github.com/karpathy/micrograd by Andrej Karpathy.
 * Ported to JS for this site; API mirrors the original (Value, Neuron, Layer, MLP).
 * Additions beyond the original engine: tanh(), exp() and a `label` field used
 * only for drawing the computation graph (the originals are relu/pow/+/*).
 *
 * ---------------------------------------------------------------------------
 * The MIT License (MIT) Copyright (c) 2020 Andrej Karpathy
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 * ---------------------------------------------------------------------------
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Micrograd = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var nextId = 1;

  /** stores a single scalar value and its gradient */
  function Value(data, children, op, label) {
    this.data = data;
    this.grad = 0;
    // internal variables used for autograd graph construction
    this._backward = noop;
    this._prev = children || [];
    this._op = op || ""; // the op that produced this node, for graph drawing
    this.label = label || "";
    this.id = nextId++;
  }
  function noop() {}
  function wrap(o) {
    return o instanceof Value ? o : new Value(o);
  }

  Value.prototype.add = function (other) {
    other = wrap(other);
    var self = this;
    var out = new Value(self.data + other.data, [self, other], "+");
    out._backward = function () {
      self.grad += out.grad;
      other.grad += out.grad;
    };
    return out;
  };

  Value.prototype.mul = function (other) {
    other = wrap(other);
    var self = this;
    var out = new Value(self.data * other.data, [self, other], "*");
    out._backward = function () {
      self.grad += other.data * out.grad;
      other.grad += self.data * out.grad;
    };
    return out;
  };

  Value.prototype.pow = function (k) {
    if (typeof k !== "number") throw new Error("only supporting int/float powers for now");
    var self = this;
    var out = new Value(Math.pow(self.data, k), [self], "**" + k);
    out._backward = function () {
      self.grad += k * Math.pow(self.data, k - 1) * out.grad;
    };
    return out;
  };

  Value.prototype.relu = function () {
    var self = this;
    var out = new Value(self.data < 0 ? 0 : self.data, [self], "ReLU");
    out._backward = function () {
      self.grad += (out.data > 0 ? 1 : 0) * out.grad;
    };
    return out;
  };

  // --- additions (not in engine.py; from the "spelled-out intro" lecture) ---
  Value.prototype.tanh = function () {
    var self = this;
    var t = Math.tanh(self.data);
    var out = new Value(t, [self], "tanh");
    out._backward = function () {
      self.grad += (1 - t * t) * out.grad;
    };
    return out;
  };

  Value.prototype.exp = function () {
    var self = this;
    var out = new Value(Math.exp(self.data), [self], "exp");
    out._backward = function () {
      self.grad += out.data * out.grad;
    };
    return out;
  };

  Value.prototype.backward = function () {
    // topological order all of the children in the graph (iterative DFS so
    // big graphs from MLP training don't blow the JS call stack)
    var topo = [];
    var visited = new Set();
    var stack = [[this, 0]];
    visited.add(this);
    while (stack.length) {
      var top = stack[stack.length - 1];
      var v = top[0];
      if (top[1] < v._prev.length) {
        var c = v._prev[top[1]++];
        if (!visited.has(c)) {
          visited.add(c);
          stack.push([c, 0]);
        }
      } else {
        topo.push(v);
        stack.pop();
      }
    }
    // go one variable at a time and apply the chain rule to get its gradient
    this.grad = 1;
    for (var i = topo.length - 1; i >= 0; i--) topo[i]._backward();
    return topo;
  };

  Value.prototype.neg = function () { return this.mul(-1); };
  Value.prototype.sub = function (o) { return this.add(wrap(o).neg()); };
  Value.prototype.div = function (o) { return this.mul(wrap(o).pow(-1)); };
  Value.prototype.setLabel = function (l) { this.label = l; return this; };
  Value.prototype.toString = function () {
    return "Value(data=" + this.data + ", grad=" + this.grad + ")";
  };

  /** Same walk as trace() in trace_graph.ipynb: all nodes and edges under root. */
  function trace(rootV) {
    var nodes = [], edges = [], seen = new Set();
    (function build(v) {
      if (seen.has(v)) return;
      seen.add(v);
      nodes.push(v);
      for (var i = 0; i < v._prev.length; i++) {
        edges.push([v._prev[i], v]);
        build(v._prev[i]);
      }
    })(rootV);
    return { nodes: nodes, edges: edges };
  }

  // ---------------------------------------------------------------- nn.py
  // Seeded uniform RNG so demos are reproducible (Python used random.seed(1337)).
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  var rng = mulberry32(1337);
  function seed(s) { rng = mulberry32(s); }
  function uniform(a, b) { return a + (b - a) * rng(); }

  function Neuron(nin, nonlin) {
    this.w = [];
    for (var i = 0; i < nin; i++) this.w.push(new Value(uniform(-1, 1)));
    this.b = new Value(0);
    this.nonlin = nonlin !== false;
  }
  Neuron.prototype.call = function (x) {
    var act = this.b;
    for (var i = 0; i < this.w.length; i++) act = act.add(this.w[i].mul(x[i]));
    return this.nonlin ? act.relu() : act;
  };
  Neuron.prototype.parameters = function () { return this.w.concat([this.b]); };
  Neuron.prototype.zeroGrad = function () { this.parameters().forEach(function (p) { p.grad = 0; }); };
  Neuron.prototype.toString = function () { return (this.nonlin ? "ReLU" : "Linear") + "Neuron(" + this.w.length + ")"; };

  function Layer(nin, nout, nonlin) {
    this.neurons = [];
    for (var i = 0; i < nout; i++) this.neurons.push(new Neuron(nin, nonlin));
  }
  Layer.prototype.call = function (x) {
    var out = this.neurons.map(function (n) { return n.call(x); });
    return out.length === 1 ? out[0] : out;
  };
  Layer.prototype.parameters = function () {
    var ps = [];
    this.neurons.forEach(function (n) { ps = ps.concat(n.parameters()); });
    return ps;
  };
  Layer.prototype.toString = function () {
    return "Layer of [" + this.neurons.map(String).join(", ") + "]";
  };

  function MLP(nin, nouts) {
    var sz = [nin].concat(nouts);
    this.layers = [];
    for (var i = 0; i < nouts.length; i++) this.layers.push(new Layer(sz[i], sz[i + 1], i !== nouts.length - 1));
  }
  MLP.prototype.call = function (x) {
    for (var i = 0; i < this.layers.length; i++) x = this.layers[i].call(x);
    return x;
  };
  MLP.prototype.parameters = function () {
    var ps = [];
    this.layers.forEach(function (l) { ps = ps.concat(l.parameters()); });
    return ps;
  };
  MLP.prototype.zeroGrad = function () { this.parameters().forEach(function (p) { p.grad = 0; }); };
  MLP.prototype.toString = function () {
    return "MLP of [" + this.layers.map(String).join(", ") + "]";
  };

  function sum(vals, start) {
    var s = start instanceof Value ? start : new Value(start || 0);
    for (var i = 0; i < vals.length; i++) s = s.add(vals[i]);
    return s;
  }

  /**
   * demo.ipynb, step by step: SVM max-margin loss + L2 reg, full-batch SGD with
   * learning_rate = 1.0 - 0.9*k/100. X: [[x,y]...], y: +1/-1.
   */
  function demoStep(model, X, y, k, steps) {
    var inputs = X.map(function (row) { return row.map(function (v) { return new Value(v); }); });
    var scores = inputs.map(function (inp) { return model.call(inp); });
    var losses = scores.map(function (s, i) { return s.mul(-y[i]).add(1).relu(); });
    var dataLoss = sum(losses).mul(1.0 / losses.length);
    var alpha = 1e-4;
    var params = model.parameters();
    var reg = sum(params.map(function (p) { return p.mul(p); })).mul(alpha);
    var total = dataLoss.add(reg);
    var correct = 0;
    scores.forEach(function (s, i) { if ((y[i] > 0) === (s.data > 0)) correct++; });
    model.zeroGrad();
    total.backward();
    var lr = 1.0 - (0.9 * k) / (steps || 100);
    params.forEach(function (p) { p.data -= lr * p.grad; });
    return { loss: total.data, acc: correct / X.length, lr: lr };
  }

  return {
    Value: Value, trace: trace, Neuron: Neuron, Layer: Layer, MLP: MLP,
    sum: sum, seed: seed, demoStep: demoStep,
    LICENSE: "The MIT License (MIT) Copyright (c) 2020 Andrej Karpathy",
  };
});
