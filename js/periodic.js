/**
 * Periodic Table — a bench for placing atoms, bonding them, and heating a sample.
 */
(function () {
  "use strict";

  var FAMILIES = [
    ["alkali", "Alkali"],
    ["alkaline", "Alkaline earth"],
    ["transition", "Transition"],
    ["post", "Post-transition"],
    ["metalloid", "Metalloid"],
    ["nonmetal", "Nonmetal"],
    ["halogen", "Halogen"],
    ["noble", "Noble gas"],
    ["lanthanide", "Lanthanide"],
    ["actinide", "Actinide"],
  ];

  var GROUP_TITLE = {
    1: "Group 1. Hydrogen, then the alkali metals.",
    2: "Group 2. The alkaline earth metals.",
    13: "Group 13. The boron group.",
    14: "Group 14. The carbon group.",
    15: "Group 15. The pnictogens.",
    16: "Group 16. The chalcogens.",
    17: "Group 17. The halogens.",
    18: "Group 18. The noble gases.",
  };

  var MAX_ATOMS = 14;
  var elements = [];
  var bySymbol = {};
  var buttons = [];
  var atoms = [];
  var bonds = [];
  var armed = "";
  var selected = 0;
  var nextId = 1;
  var heatK = 298;
  var actionNote = "Click an element, then click the bench.";
  var filter = { q: "", family: "", group: 0, row: 0 };
  var drag = null;
  var built = false;
  var loading = null;

  function $(id) {
    return document.getElementById(id);
  }

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }

  function family(el) {
    var category = el.category || "";
    if (el.group === 18) return "noble";
    if (el.group === 17) return "halogen";
    if (el.n >= 57 && el.n <= 71) return "lanthanide";
    if (el.n >= 89 && el.n <= 103) return "actinide";
    if (el.group === 1 && el.n !== 1) return "alkali";
    if (el.group === 2) return "alkaline";
    if (el.group >= 3 && el.group <= 12) return "transition";
    if (category.indexOf("metalloid") >= 0) return "metalloid";
    if (category.indexOf("nonmetal") >= 0) return "nonmetal";
    if (category.indexOf("post-transition") >= 0) return "post";
    if (el.block === "p" && el.group >= 13 && el.group <= 16) return "post";
    return "transition";
  }

  function isMetal(el) {
    var f = family(el);
    return f === "alkali" || f === "alkaline" || f === "transition" || f === "post" || f === "lanthanide" || f === "actinide";
  }

  function rowOf(y) {
    if (y <= 7) return y + 1;
    if (y >= 9) return y + 1;
    return y;
  }

  function groupTitle(g) {
    if (GROUP_TITLE[g]) return GROUP_TITLE[g];
    if (g >= 3 && g <= 12) return "Group " + g + ". Transition metals.";
    return "Group " + g + ".";
  }

  function tempText(k) {
    if (k == null || isNaN(k)) return "—";
    var c = Math.round(k - 273.15);
    var kelvin = (Math.round(k * 10) / 10).toFixed(1);
    return c + " °C (" + kelvin + " K)";
  }

  function atomById(id) {
    var i;
    for (i = 0; i < atoms.length; i++) if (atoms[i].id === id) return atoms[i];
    return null;
  }

  function bondBetween(a, b) {
    var i;
    for (i = 0; i < bonds.length; i++) {
      var bond = bonds[i];
      if ((bond.a === a && bond.b === b) || (bond.a === b && bond.b === a)) return bond;
    }
    return null;
  }

  function valenceElectrons(el) {
    var shells = el.shells || [];
    var outer = shells.length ? shells[shells.length - 1] : 0;
    if (el.symbol === "H") return 1;
    if (el.symbol === "He") return 2;
    return outer || 0;
  }

  function giveMax(el) {
    if (!isMetal(el)) return 0;
    if (family(el) === "alkali") return 1;
    if (family(el) === "alkaline") return 2;
    var v = valenceElectrons(el);
    return Math.max(1, Math.min(v || 2, 3));
  }

  function maxShare(el) {
    if (isMetal(el) || family(el) === "noble") return 0;
    if (el.symbol === "H") return 1;
    var v = valenceElectrons(el);
    if (v >= 8) return 0;
    if (v <= 4) return v;
    return 8 - v;
  }

  function ionicLost(id) {
    var n = 0;
    var i;
    for (i = 0; i < bonds.length; i++) {
      if (bonds[i].kind === "ionic" && bonds[i].a === id) n += bonds[i].order;
    }
    return n;
  }

  function ionicGained(id) {
    var n = 0;
    var i;
    for (i = 0; i < bonds.length; i++) {
      if (bonds[i].kind === "ionic" && bonds[i].b === id) n += bonds[i].order;
    }
    return n;
  }

  function covalentOrders(id) {
    var n = 0;
    var i;
    for (i = 0; i < bonds.length; i++) {
      if (bonds[i].kind === "covalent" && (bonds[i].a === id || bonds[i].b === id)) n += bonds[i].order;
    }
    return n;
  }

  function shellElectrons(atom) {
    var el = bySymbol[atom.symbol];
    return valenceElectrons(el) + covalentOrders(atom.id) + ionicGained(atom.id) - ionicLost(atom.id);
  }

  function shellCap(el) {
    return el.symbol === "H" || el.symbol === "He" ? 2 : 8;
  }

  function shareRoom(atom) {
    return maxShare(bySymbol[atom.symbol]) - covalentOrders(atom.id);
  }

  function takeRoom(atom) {
    var el = bySymbol[atom.symbol];
    return shellCap(el) - shellElectrons(atom);
  }

  function giveRoom(atom) {
    return giveMax(bySymbol[atom.symbol]) - ionicLost(atom.id);
  }

  function loneCount(atom) {
    var el = bySymbol[atom.symbol];
    var lone = valenceElectrons(el) - covalentOrders(atom.id) - ionicLost(atom.id) + ionicGained(atom.id);
    if (lone < 0) lone = 0;
    if (lone > 8) lone = 8;
    return lone;
  }

  function chargeOf(atom) {
    return ionicLost(atom.id) - ionicGained(atom.id);
  }

  function chargeText(q) {
    if (!q) return "";
    var n = Math.abs(q);
    var sign = q > 0 ? "+" : "−";
    return n === 1 ? sign : String(n) + sign;
  }

  function orderName(order) {
    return order === 3 ? "Triple" : order === 2 ? "Double" : "Single";
  }

  function pureSample() {
    if (!atoms.length) return null;
    var sym = atoms[0].symbol;
    var i;
    for (i = 1; i < atoms.length; i++) if (atoms[i].symbol !== sym) return null;
    for (i = 0; i < bonds.length; i++) if (bonds[i].kind !== "metallic") return null;
    return bySymbol[sym];
  }

  function phaseOf(el, k) {
    if (el.melt == null) {
      return { phase: "solid", why: "No melting point is listed. The sample stays solid in this model." };
    }
    if (k < el.melt) {
      return { phase: "solid", why: el.name + " is solid. It melts at " + tempText(el.melt) + "." };
    }
    if (el.boil == null) {
      return {
        phase: "gas",
        why: el.name + " is past " + tempText(el.melt) + " and no boiling point is listed. It sublimes, so this heater calls it gas.",
      };
    }
    if (k < el.boil) {
      return { phase: "liquid", why: el.name + " is liquid. It melts at " + tempText(el.melt) + " and boils at " + tempText(el.boil) + "." };
    }
    return { phase: "gas", why: el.name + " is gas. It boils at " + tempText(el.boil) + "." };
  }

  function matches(el) {
    if (filter.q) {
      var q = filter.q;
      var asNumber = /^\d+$/.test(q) && String(el.n).indexOf(q) === 0;
      var asText = el.symbol.toLowerCase().indexOf(q) === 0 || el.name.toLowerCase().indexOf(q) === 0;
      if (!asNumber && !asText) return false;
    }
    if (filter.family && family(el) !== filter.family) return false;
    if (filter.row && el.y !== filter.row) return false;
    if (filter.group) {
      var inColumn = el.x === filter.group && el.y <= 7;
      var fBlock = filter.group === 3 && el.y >= 9;
      if (!inColumn && !fBlock) return false;
    }
    return true;
  }

  function applyFilter() {
    var i;
    for (i = 0; i < buttons.length; i++) {
      var el = bySymbol[buttons[i].getAttribute("data-symbol")];
      if (el) buttons[i].classList.toggle("is-dim", !matches(el));
    }
    var heads = document.querySelectorAll("#pt-grid .pt-ghead");
    for (i = 0; i < heads.length; i++) {
      heads[i].classList.toggle("is-on", !!filter.group && parseInt(heads[i].getAttribute("data-group"), 10) === filter.group);
    }
  }

  function paintArm() {
    var i;
    for (i = 0; i < buttons.length; i++) {
      buttons[i].classList.toggle("is-armed", !!armed && buttons[i].getAttribute("data-symbol") === armed);
    }
    var hand = $("pt-hand");
    if (!hand) return;
    if (!armed || !bySymbol[armed]) hand.textContent = "Nothing in hand.";
    else hand.textContent = "Holding " + bySymbol[armed].name.toLowerCase() + ". Click the bench, or click an atom to attach it.";
  }

  function arm(symbol) {
    armed = armed === symbol ? "" : symbol;
    selected = 0;
    paintArm();
    applyPhase();
  }

  function addAtom(symbol, fx, fy) {
    var atom = { id: nextId, symbol: symbol, fx: fx, fy: fy };
    nextId += 1;
    atoms.push(atom);
    return atom;
  }

  function removeAtom(id) {
    atoms = atoms.filter(function (atom) { return atom.id !== id; });
    bonds = bonds.filter(function (bond) { return bond.a !== id && bond.b !== id; });
    if (selected === id) selected = 0;
    actionNote = "Removed that atom.";
    renderBench();
    applyPhase();
  }

  function clearBench() {
    atoms = [];
    bonds = [];
    selected = 0;
    actionNote = "Bench cleared.";
    renderBench();
    applyPhase();
  }

  function tryBond(idA, idB) {
    if (idA === idB) return;
    var A = atomById(idA);
    var B = atomById(idB);
    if (!A || !B) return;
    var eA = bySymbol[A.symbol];
    var eB = bySymbol[B.symbol];
    var existing = bondBetween(idA, idB);
    if (family(eA) === "noble" || family(eB) === "noble") {
      var gas = family(eA) === "noble" ? eA : eB;
      actionNote = gas.name + " has a full shell. It does not bond.";
      return;
    }
    if (isMetal(eA) && isMetal(eB)) {
      if (existing) actionNote = eA.name + " and " + eB.name + " already share a metallic sea.";
      else {
        bonds.push({ a: idA, b: idB, order: 1, kind: "metallic" });
        actionNote = eA.name + " and " + eB.name + " pool their outer electrons. Metallic bond.";
      }
      return;
    }
    var metal = isMetal(eA) ? A : isMetal(eB) ? B : null;
    var other = metal === A ? B : metal === B ? A : null;
    if (metal && other && !isMetal(bySymbol[other.symbol])) {
      if (existing && existing.kind !== "ionic") {
        actionNote = "Those two are already bonded another way.";
        return;
      }
      if (giveRoom(metal) < 1) {
        actionNote = bySymbol[metal.symbol].name + " has no outer electron left to give.";
        return;
      }
      if (takeRoom(other) < 1) {
        actionNote = bySymbol[other.symbol].name + " has a full shell.";
        return;
      }
      if (existing) existing.order += 1;
      else bonds.push({ a: metal.id, b: other.id, order: 1, kind: "ionic" });
      actionNote = bySymbol[metal.symbol].name + " gave an electron to " + bySymbol[other.symbol].name.toLowerCase() + ". Ionic bond.";
      return;
    }
    if (existing && existing.kind !== "covalent") {
      actionNote = "Those two are already bonded another way.";
      return;
    }
    if (shareRoom(A) < 1 || shareRoom(B) < 1) {
      var full = shareRoom(A) < 1 ? eA : eB;
      actionNote = full.name + " has no open bond left.";
      return;
    }
    if (existing) {
      if (existing.order >= 3) {
        actionNote = "Three shared pairs is the limit on this bench.";
        return;
      }
      existing.order += 1;
      actionNote = "Shared another pair. " + orderName(existing.order) + " covalent bond.";
      return;
    }
    var pull = "";
    if (eA.en != null && eB.en != null) pull = Math.abs(eA.en - eB.en) >= 0.4 ? "Polar" : "Nonpolar";
    bonds.push({ a: idA, b: idB, order: 1, kind: "covalent" });
    actionNote = "Shared a pair. " + (pull ? pull + " covalent" : "Covalent") + " bond.";
  }

  function formulaHtml() {
    var counts = {};
    var i;
    atoms.forEach(function (atom) {
      counts[atom.symbol] = (counts[atom.symbol] || 0) + 1;
    });
    var syms = Object.keys(counts);
    var ionic = false;
    for (i = 0; i < bonds.length; i++) if (bonds[i].kind === "ionic") ionic = true;
    var ordered = [];
    if (ionic) {
      syms.forEach(function (sym) { if (isMetal(bySymbol[sym])) ordered.push(sym); });
      syms.filter(function (sym) { return ordered.indexOf(sym) < 0; }).sort().forEach(function (sym) { ordered.push(sym); });
    } else if (syms.indexOf("C") >= 0) {
      ordered.push("C");
      if (syms.indexOf("H") >= 0) ordered.push("H");
      syms.filter(function (sym) { return sym !== "C" && sym !== "H"; }).sort().forEach(function (sym) { ordered.push(sym); });
    } else {
      ordered = syms.sort();
    }
    return ordered.map(function (sym) {
      var n = counts[sym];
      return sym + (n > 1 ? "<sub>" + n + "</sub>" : "");
    }).join("");
  }

  function shellSummary() {
    if (!atoms.length) return "";
    return atoms.map(function (atom) {
      var el = bySymbol[atom.symbol];
      if (isMetal(el)) {
        var lost = ionicLost(atom.id);
        if (!lost) return atom.symbol + " metal";
        return atom.symbol + " gave " + lost;
      }
      if (family(el) === "noble") return atom.symbol + " full";
      return atom.symbol + " " + shellElectrons(atom) + "/" + shellCap(el);
    }).join(" · ");
  }

  function applyPhase() {
    var bench = $("pt-bench");
    var phaseEl = $("pt-phase");
    var sample = pureSample();
    var why = "";
    if (bench) bench.classList.remove("is-solid", "is-liquid", "is-gas");
    if (sample) {
      var state = phaseOf(sample, heatK);
      if (bench) bench.classList.add("is-" + state.phase);
      if (phaseEl) phaseEl.textContent = state.phase;
      why = state.why;
    } else if (phaseEl) phaseEl.textContent = "";
    var bits = [];
    if (actionNote) bits.push(actionNote);
    if (why) bits.push(why);
    var shells = shellSummary();
    if (shells) bits.push(shells);
    var result = $("pt-result");
    if (result) result.textContent = bits.join(" ");
    var formula = $("pt-formula");
    if (formula) formula.innerHTML = atoms.length ? formulaHtml() : "Empty bench";
    var label = $("pt-heat-label");
    if (label) label.textContent = Math.round(heatK - 273.15) + " °C";
    var heat = $("pt-heat");
    if (heat && document.activeElement !== heat) heat.value = String(heatK);
    var remove = $("pt-remove");
    if (remove) remove.disabled = !selected;
    var hint = $("pt-bench-hint");
    if (hint) hint.hidden = atoms.length > 0;
  }

  function paintBonds() {
    var bench = $("pt-bench");
    if (!bench) return;
    var w = bench.clientWidth || 640;
    var h = bench.clientHeight || 360;
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "pt-bond-svg");
    svg.setAttribute("viewBox", "0 0 " + w + " " + h);
    bonds.forEach(function (bond, index) {
      var A = atomById(bond.a);
      var B = atomById(bond.b);
      if (!A || !B) return;
      var x1 = A.fx * w;
      var y1 = A.fy * h;
      var x2 = B.fx * w;
      var y2 = B.fy * h;
      var dx = x2 - x1;
      var dy = y2 - y1;
      var len = Math.sqrt(dx * dx + dy * dy) || 1;
      var ux = dx / len;
      var uy = dy / len;
      var px = -uy;
      var py = ux;
      var pad = 30;
      var ax = x1 + ux * pad;
      var ay = y1 + uy * pad;
      var bx = x2 - ux * pad;
      var by = y2 - uy * pad;
      var hit = document.createElementNS("http://www.w3.org/2000/svg", "line");
      hit.setAttribute("class", "pt-bond-hit");
      hit.setAttribute("data-bond", String(index));
      hit.setAttribute("x1", ax);
      hit.setAttribute("y1", ay);
      hit.setAttribute("x2", bx);
      hit.setAttribute("y2", by);
      svg.appendChild(hit);
      var offsets = bond.kind === "covalent" && bond.order === 3 ? [-4, 0, 4] : bond.kind === "covalent" && bond.order === 2 ? [-3, 3] : [0];
      offsets.forEach(function (off) {
        var line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("class", "pt-bond-line is-" + bond.kind);
        if (bond.kind === "ionic") line.setAttribute("stroke-dasharray", "5 4");
        line.setAttribute("x1", ax + px * off);
        line.setAttribute("y1", ay + py * off);
        line.setAttribute("x2", bx + px * off);
        line.setAttribute("y2", by + py * off);
        svg.appendChild(line);
      });
    });
    var old = bench.querySelector(".pt-bond-svg");
    if (old) bench.replaceChild(svg, old);
    else bench.insertBefore(svg, bench.firstChild);
  }

  function renderBench() {
    var bench = $("pt-bench");
    if (!bench) return;
    var html = ['<p id="pt-bench-hint" class="pt-bench-hint"' + (atoms.length ? " hidden" : "") + ">Set an element here.</p>"];
    html.push('<span id="pt-phase" class="pt-phase"></span>');
    atoms.forEach(function (atom) {
      var el = bySymbol[atom.symbol];
      var dots = "";
      var n = loneCount(atom);
      var k;
      for (k = 0; k < n; k++) {
        var ang = n === 1 ? -90 : -90 + (k * 360) / n;
        dots += '<i class="pt-e" style="transform: rotate(' + ang + 'deg) translateY(-30px)"></i>';
      }
      var charge = chargeText(chargeOf(atom));
      html.push(
        '<button type="button" class="pt-dot' + (selected === atom.id ? " is-on" : "") + '" data-id="' + atom.id + '" data-symbol="' + atom.symbol + '" data-family="' + family(el) + '" style="left:' + (atom.fx * 100) + "%;top:" + (atom.fy * 100) + '%">' +
        dots +
        '<span class="pt-dot-sym">' + atom.symbol + "</span>" +
        (charge ? '<span class="pt-charge">' + charge + "</span>" : "") +
        "</button>"
      );
    });
    bench.innerHTML = html.join("");
    paintBonds();
  }

  function placeNear(targetId, symbol) {
    var target = atomById(targetId);
    var n = 0;
    var i;
    for (i = 0; i < bonds.length; i++) {
      if (bonds[i].a === targetId || bonds[i].b === targetId) n += 1;
    }
    var ang = -Math.PI / 2 + n * (Math.PI / 2.15);
    var fx = clamp(target.fx + Math.cos(ang) * 0.18, 0.1, 0.9);
    var fy = clamp(target.fy + Math.sin(ang) * 0.22, 0.16, 0.84);
    return addAtom(symbol, fx, fy);
  }

  function onAtomTap(id) {
    if (armed) {
      if (atoms.length >= MAX_ATOMS) {
        actionNote = "The bench holds " + MAX_ATOMS + " atoms. Remove one.";
        applyPhase();
        return;
      }
      var newbie = placeNear(id, armed);
      tryBond(newbie.id, id);
      renderBench();
      applyPhase();
      return;
    }
    if (selected && selected !== id) {
      tryBond(selected, id);
      selected = 0;
      renderBench();
      applyPhase();
      return;
    }
    selected = selected === id ? 0 : id;
    renderBench();
    applyPhase();
  }

  function onBenchTap(e) {
    var bench = $("pt-bench");
    if (!armed) {
      selected = 0;
      actionNote = "Click an element in the table first.";
      renderBench();
      applyPhase();
      return;
    }
    if (atoms.length >= MAX_ATOMS) {
      actionNote = "The bench holds " + MAX_ATOMS + " atoms. Remove one.";
      applyPhase();
      return;
    }
    var rect = bench.getBoundingClientRect();
    var fx = 0.5;
    var fy = 0.46;
    if (rect.width && rect.height) {
      fx = clamp((e.clientX - rect.left) / rect.width, 0.12, 0.88);
      fy = clamp((e.clientY - rect.top) / rect.height, 0.18, 0.82);
    }
    addAtom(armed, fx, fy);
    actionNote = bySymbol[armed].name + " is on the bench.";
    renderBench();
    applyPhase();
  }

  function bindBench() {
    var bench = $("pt-bench");
    if (!bench || bench.dataset.bound) return;
    bench.dataset.bound = "1";
    bench.addEventListener("pointerdown", function (e) {
      var dot = e.target.closest(".pt-dot");
      if (!dot) return;
      drag = {
        id: parseInt(dot.getAttribute("data-id"), 10),
        x: e.clientX,
        y: e.clientY,
        moved: false,
        pointerId: e.pointerId,
      };
      if (dot.setPointerCapture) dot.setPointerCapture(e.pointerId);
    });
    bench.addEventListener("pointermove", function (e) {
      if (!drag || e.pointerId !== drag.pointerId) return;
      if (Math.abs(e.clientX - drag.x) > 6 || Math.abs(e.clientY - drag.y) > 6) drag.moved = true;
      if (!drag.moved) return;
      var atom = atomById(drag.id);
      var rect = bench.getBoundingClientRect();
      if (!atom || !rect.width) return;
      atom.fx = clamp((e.clientX - rect.left) / rect.width, 0.1, 0.9);
      atom.fy = clamp((e.clientY - rect.top) / rect.height, 0.14, 0.86);
      var dot = bench.querySelector('.pt-dot[data-id="' + atom.id + '"]');
      if (dot) {
        dot.style.left = atom.fx * 100 + "%";
        dot.style.top = atom.fy * 100 + "%";
      }
      paintBonds();
    });
    bench.addEventListener("pointerup", function (e) {
      if (drag && e.pointerId === drag.pointerId) {
        var moved = drag.moved;
        var id = drag.id;
        drag = null;
        if (moved) return;
        onAtomTap(id);
        return;
      }
      var hit = e.target.closest && e.target.closest(".pt-bond-hit");
      if (hit) {
        var index = parseInt(hit.getAttribute("data-bond"), 10);
        bonds.splice(index, 1);
        actionNote = "Bond removed.";
        renderBench();
        applyPhase();
        return;
      }
      var dot = e.target.closest && e.target.closest(".pt-dot");
      if (dot) {
        onAtomTap(parseInt(dot.getAttribute("data-id"), 10));
        return;
      }
      if (e.target.closest && e.target.closest("#pt-bench")) onBenchTap(e);
    });
  }

  function buildLegend() {
    var host = $("pt-legend");
    if (!host || host.dataset.built) return;
    host.dataset.built = "1";
    host.innerHTML = FAMILIES.map(function (row) {
      return '<button type="button" data-family="' + row[0] + '" aria-pressed="false"><span class="pt-swatch" data-family="' + row[0] + '"></span>' + row[1] + "</button>";
    }).join("");
    host.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-family]");
      if (!btn || !host.contains(btn)) return;
      var next = btn.getAttribute("data-family");
      filter.family = filter.family === next ? "" : next;
      filter.group = 0;
      filter.row = 0;
      applyFilter();
      var legend = host.querySelectorAll("button");
      var i;
      for (i = 0; i < legend.length; i++) {
        var on = legend[i].getAttribute("data-family") === filter.family;
        legend[i].classList.toggle("is-on", on);
        legend[i].setAttribute("aria-pressed", on ? "true" : "false");
      }
    });
  }

  function buildGrid() {
    var grid = $("pt-grid");
    if (!grid) return;
    var html = [];
    var g;
    for (g = 1; g <= 18; g++) {
      html.push('<button type="button" class="pt-ghead" data-group="' + g + '" style="grid-column:' + g + ';grid-row:1" title="' + groupTitle(g) + '">' + g + "</button>");
    }
    elements.forEach(function (el) {
      html.push(
        '<button type="button" class="pt-cell" data-n="' + el.n + '" data-symbol="' + el.symbol + '" data-family="' + family(el) + '" style="grid-column:' + el.x + ";grid-row:" + rowOf(el.y) + '" aria-label="' + el.name + ", atomic number " + el.n + '">' +
        '<span class="pt-n">' + el.n + "</span><span class=\"pt-sym\">" + el.symbol + "</span></button>"
      );
    });
    html.push('<button type="button" class="pt-seat" data-row="9" style="grid-column:3;grid-row:7" title="Lanthanides">57–71</button>');
    html.push('<button type="button" class="pt-seat" data-row="10" style="grid-column:3;grid-row:8" title="Actinides">89–103</button>');
    html.push('<p class="pt-f-label" style="grid-column:1 / -1;grid-row:9">Lanthanides and actinides</p>');
    grid.innerHTML = html.join("");
    buttons = Array.prototype.slice.call(grid.querySelectorAll(".pt-cell"));
    grid.addEventListener("click", function (e) {
      var head = e.target.closest(".pt-ghead");
      if (head) {
        var group = parseInt(head.getAttribute("data-group"), 10);
        filter.group = filter.group === group ? 0 : group;
        filter.family = "";
        filter.row = 0;
        applyFilter();
        return;
      }
      var seat = e.target.closest(".pt-seat");
      if (seat) {
        var seatRow = parseInt(seat.getAttribute("data-row"), 10);
        filter.row = filter.row === seatRow ? 0 : seatRow;
        filter.family = "";
        filter.group = 0;
        applyFilter();
        var label = grid.querySelector(".pt-f-label");
        if (label && label.scrollIntoView) label.scrollIntoView({ block: "nearest" });
        return;
      }
      var cell = e.target.closest(".pt-cell");
      if (!cell) return;
      arm(cell.getAttribute("data-symbol"));
    });
  }

  function bindChrome() {
    var shell = document.querySelector("#panel-periodic .pt-shell");
    if (!shell || shell.dataset.bound) return;
    shell.dataset.bound = "1";
    bindBench();
    var clearBtn = $("pt-clear");
    if (clearBtn) clearBtn.addEventListener("click", clearBench);
    var removeBtn = $("pt-remove");
    if (removeBtn) {
      removeBtn.addEventListener("click", function () {
        if (selected) removeAtom(selected);
      });
    }
    var heat = $("pt-heat");
    if (heat) {
      heat.addEventListener("input", function () {
        heatK = parseInt(heat.value, 10) || 0;
        if (pureSample()) actionNote = "";
        applyPhase();
      });
    }
    var search = $("pt-search");
    if (search) {
      search.addEventListener("input", function () {
        filter.q = String(search.value || "").trim().toLowerCase();
        applyFilter();
        var exact = null;
        var hits = [];
        var i;
        for (i = 0; i < elements.length; i++) {
          if (!matches(elements[i])) continue;
          hits.push(elements[i]);
          if (elements[i].symbol.toLowerCase() === filter.q) exact = elements[i];
        }
        if (exact) arm(exact.symbol);
        else if (hits.length === 1) arm(hits[0].symbol);
      });
    }
    document.addEventListener("keydown", function (e) {
      var panel = $("panel-periodic");
      if (!panel || panel.hidden) return;
      if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "SELECT" || e.target.tagName === "TEXTAREA")) return;
      if (e.key === "Escape") {
        armed = "";
        selected = 0;
        paintArm();
        renderBench();
        applyPhase();
      } else if ((e.key === "Backspace" || e.key === "Delete") && selected) {
        e.preventDefault();
        removeAtom(selected);
      }
    });
    window.addEventListener("resize", function () {
      if (built) paintBonds();
    });
  }

  function build() {
    if (built) return;
    built = true;
    buildLegend();
    buildGrid();
    bindChrome();
    renderBench();
    paintArm();
    applyPhase();
  }

  function onShow() {
    if (!loading) {
      loading = fetch("data/periodic/elements.json", { cache: "force-cache" })
        .then(function (r) {
          if (!r.ok) throw new Error("elements");
          return r.json();
        })
        .then(function (rows) {
          elements = rows;
          bySymbol = {};
          rows.forEach(function (el) { bySymbol[el.symbol] = el; });
          build();
        })
        .catch(function () {
          var result = $("pt-result");
          if (result) result.textContent = "The elements did not load.";
        });
    }
  }

  document.addEventListener("periodic-show", onShow);
  window.Periodic = { onShow: onShow };
})();
