/**
 * Colors — RGB Color Proof Pager.
 * Pages through all 16,777,216 RGB colors, 64 swatches (8×8) per page.
 *   Horizontal page (0–255)  = green.
 *   Vertical page   (0–4095) = red * 16 + blue group (blue = group * 64 + i).
 * Each swatch: Spell N (absolute index + 1), original RGB, and display RGB after a
 * channel-order permutation (BGR default). A strip at the top shows the original color.
 * Math is identical to the standalone rgb-color-proof-pager.html.
 */
(function () {
  "use strict";

  var STORE_KEY = "colorsPager.v1";
  var SLOTS_PER_PAGE = 64; // 8x8 grid
  var TOTAL_H_PAGES = 256; // Full green range
  var TOTAL_V_PAGES = 4096; // red * 16 + blue page group
  var ORDERS = ["BGR", "RGB", "GRB", "BRG", "RBG", "GBR"];

  // ---- math (verbatim from the reference) -----------------------------------

  // Original mapping: Blue fastest → Green → Red
  function indexToOriginalRGB(index) {
    var b = index % 256;
    var g = Math.floor(index / 256) % 256;
    var r = Math.floor(index / (256 * 256)) % 256;
    return { r: r, g: g, b: b };
  }

  // Apply permutation
  function permuteRGB(rgb, order) {
    return {
      r: rgb[order[0].toLowerCase()],
      g: rgb[order[1].toLowerCase()],
      b: rgb[order[2].toLowerCase()],
    };
  }

  // Reverse permutation
  function reversePermuteRGB(r, g, b, order) {
    var map = {};
    map[order[0]] = r;
    map[order[1]] = g;
    map[order[2]] = b;
    return { r: map.R, g: map.G, b: map.B };
  }

  function brightnessOf(rgb) {
    return rgb.r * 0.299 + rgb.g * 0.587 + rgb.b * 0.114;
  }

  /** Swatch i (0–63) on page (hPage, vPage). */
  function slotAt(hPage, vPage, i, order) {
    var red = Math.floor(vPage / 16);
    var bluePageGroup = vPage % 16;
    var green = hPage;
    var blue = bluePageGroup * SLOTS_PER_PAGE + i;
    var absoluteIndex = (red * 256 + green) * 256 + blue;
    var originalRGB = indexToOriginalRGB(absoluteIndex);
    var displayRGB = permuteRGB(originalRGB, order);
    return {
      i: i,
      absoluteIndex: absoluteIndex,
      spell: absoluteIndex + 1,
      original: originalRGB,
      display: displayRGB,
    };
  }

  /** Where display color (r, g, b) under `order` lives: page + swatch index. */
  function locateRGB(r, g, b, order) {
    var orig = reversePermuteRGB(r, g, b, order);
    return {
      hPage: orig.g,
      vPage: orig.r * 16 + Math.floor(orig.b / SLOTS_PER_PAGE),
      i: orig.b % SLOTS_PER_PAGE,
      original: orig,
      absoluteIndex: (orig.r * 256 + orig.g) * 256 + orig.b,
    };
  }

  function hex2(n) {
    var s = n.toString(16).toUpperCase();
    return s.length < 2 ? "0" + s : s;
  }

  function toHex(rgb) {
    return "#" + hex2(rgb.r) + hex2(rgb.g) + hex2(rgb.b);
  }

  function css(rgb) {
    return "rgb(" + rgb.r + "," + rgb.g + "," + rgb.b + ")";
  }

  // ---- state ----------------------------------------------------------------

  var state = {
    hPage: 0, // Green component
    vPage: 0, // Red component * 16 + Blue page group
    order: "BGR",
    selected: null, // absoluteIndex of the swatch shown in the detail panel
    started: false,
    slots: [],
  };
  var el = {};

  function $(id) {
    return document.getElementById(id);
  }

  function loadPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
      if (!p) return;
      if (Number.isInteger(p.h) && p.h >= 0 && p.h < TOTAL_H_PAGES) state.hPage = p.h;
      if (Number.isInteger(p.v) && p.v >= 0 && p.v < TOTAL_V_PAGES) state.vPage = p.v;
      if (ORDERS.indexOf(p.order) >= 0) state.order = p.order;
    } catch (e) {}
  }

  function savePrefs() {
    try {
      localStorage.setItem(
        STORE_KEY,
        JSON.stringify({ h: state.hPage, v: state.vPage, order: state.order })
      );
    } catch (e) {}
  }

  // ---- render ---------------------------------------------------------------

  function buildGrid() {
    el.grid.innerHTML = "";
    state.slots = [];
    for (var i = 0; i < SLOTS_PER_PAGE; i++) {
      var slot = document.createElement("button");
      slot.type = "button";
      slot.className = "clr-slot";
      slot.setAttribute("data-i", String(i));
      var tab = document.createElement("span");
      tab.className = "clr-orig-tab";
      tab.setAttribute("aria-hidden", "true");
      var text = document.createElement("span");
      text.className = "clr-slot-text";
      var spell = document.createElement("span");
      spell.className = "clr-slot-spell";
      var word = document.createElement("span");
      word.className = "clr-slot-word";
      word.textContent = "Spell ";
      var num = document.createElement("span");
      num.className = "clr-slot-num";
      spell.appendChild(word);
      spell.appendChild(num);
      var orig = document.createElement("span");
      orig.className = "clr-slot-line";
      var disp = document.createElement("span");
      disp.className = "clr-slot-line";
      text.appendChild(spell);
      text.appendChild(orig);
      text.appendChild(disp);
      slot.appendChild(tab);
      slot.appendChild(text);
      el.grid.appendChild(slot);
      state.slots.push({ node: slot, tab: tab, num: num, orig: orig, disp: disp });
    }
  }

  function renderPage() {
    el.hInput.value = state.hPage;
    el.vInput.value = state.vPage;
    el.order.value = state.order;

    var first = null;
    var last = null;
    for (var i = 0; i < SLOTS_PER_PAGE; i++) {
      var s = slotAt(state.hPage, state.vPage, i, state.order);
      var o = s.original;
      var d = s.display;
      var ui = state.slots[i];
      ui.node.style.backgroundColor = css(d);
      // Dynamic text color based on brightness
      ui.node.style.color = brightnessOf(d) < 128 ? "#fff" : "#000";
      // Original color tab
      ui.tab.style.backgroundColor = css(o);
      ui.num.textContent = String(s.spell);
      ui.orig.textContent = "Orig: " + o.r + "," + o.g + "," + o.b;
      ui.disp.textContent = "Disp: " + d.r + "," + d.g + "," + d.b;
      ui.node.setAttribute(
        "aria-label",
        "Spell " + s.spell + ", original " + o.r + " " + o.g + " " + o.b +
          ", display " + d.r + " " + d.g + " " + d.b
      );
      var sel = state.selected === s.absoluteIndex;
      ui.node.classList.toggle("clr-selected", sel);
      ui.node.setAttribute("aria-pressed", sel ? "true" : "false");
      if (i === 0) first = s;
      last = s;
    }

    var red = Math.floor(state.vPage / 16);
    var group = state.vPage % 16;
    el.info.textContent =
      "Green " + state.hPage +
      " · Red " + red +
      " · Blue " + group * SLOTS_PER_PAGE + "–" + (group * SLOTS_PER_PAGE + SLOTS_PER_PAGE - 1) +
      " · Spells " + first.spell.toLocaleString() + "–" + last.spell.toLocaleString();

    el.up.disabled = state.vPage <= 0;
    el.down.disabled = state.vPage >= TOTAL_V_PAGES - 1;
    el.left.disabled = state.hPage <= 0;
    el.right.disabled = state.hPage >= TOTAL_H_PAGES - 1;

    // Keep the detail panel in sync if the order changed under a selection.
    if (state.selected != null) showDetailFor(state.selected, false);
    savePrefs();
  }

  function showDetailFor(absoluteIndex, scroll) {
    var o = indexToOriginalRGB(absoluteIndex);
    var d = permuteRGB(o, state.order);
    var dHex = toHex(d);
    var oHex = toHex(o);
    el.detail.hidden = false;
    el.detailEmpty.hidden = true;
    el.dSwatch.style.backgroundColor = css(d);
    el.dSwatch.style.color = brightnessOf(d) < 128 ? "#fff" : "#000";
    el.dSwatchTab.style.backgroundColor = css(o);
    el.dSwatchHex.textContent = dHex;
    el.dSpell.textContent = "Spell " + (absoluteIndex + 1).toLocaleString();
    el.dOrig.textContent = o.r + ", " + o.g + ", " + o.b;
    el.dOrigHex.textContent = oHex;
    el.dDisp.textContent = d.r + ", " + d.g + ", " + d.b;
    el.dDispHex.textContent = dHex;
    el.dOrder.textContent = state.order;
    el.copyDisp.setAttribute("data-hex", dHex);
    el.copyOrig.setAttribute("data-hex", oHex);
    el.copyStatus.textContent = "";
    if (scroll && el.detail.scrollIntoView) {
      try {
        el.detail.scrollIntoView({ block: "nearest", behavior: "smooth" });
      } catch (e) {}
    }
  }

  function selectSlot(i) {
    var s = slotAt(state.hPage, state.vPage, i, state.order);
    state.selected = s.absoluteIndex;
    state.slots.forEach(function (ui, k) {
      var on = k === i;
      ui.node.classList.toggle("clr-selected", on);
      ui.node.setAttribute("aria-pressed", on ? "true" : "false");
    });
    showDetailFor(s.absoluteIndex, true);
  }

  // ---- actions (same rules as the reference) --------------------------------

  function move(dh, dv) {
    if (dh < 0 && state.hPage > 0) state.hPage--;
    if (dh > 0 && state.hPage < TOTAL_H_PAGES - 1) state.hPage++;
    if (dv < 0 && state.vPage > 0) state.vPage--;
    if (dv > 0 && state.vPage < TOTAL_V_PAGES - 1) state.vPage++;
    renderPage();
  }

  function goPage() {
    var newH = parseInt(el.hInput.value, 10);
    var newV = parseInt(el.vInput.value, 10);
    if (!isNaN(newH) && newH >= 0 && newH < TOTAL_H_PAGES) state.hPage = newH;
    if (!isNaN(newV) && newV >= 0 && newV < TOTAL_V_PAGES) state.vPage = newV;
    renderPage();
  }

  function goRGB() {
    var r = parseInt(el.rInput.value, 10);
    var g = parseInt(el.gInput.value, 10);
    var b = parseInt(el.bInput.value, 10);
    if ([r, g, b].some(function (v) { return isNaN(v) || v < 0 || v > 255; })) {
      el.jumpMsg.textContent = "Please enter valid RGB values (0–255)";
      el.jumpMsg.classList.add("clr-err");
      return;
    }
    el.jumpMsg.textContent = "";
    el.jumpMsg.classList.remove("clr-err");
    var loc = locateRGB(r, g, b, state.order);
    state.hPage = loc.hPage;
    state.vPage = loc.vPage;
    state.selected = loc.absoluteIndex;
    renderPage();
    showDetailFor(loc.absoluteIndex, true);
    var node = state.slots[loc.i] && state.slots[loc.i].node;
    if (node) {
      node.classList.remove("clr-flash");
      void node.offsetWidth; // restart the highlight animation
      node.classList.add("clr-flash");
    }
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy") ? resolve() : reject(new Error("copy failed"));
      } catch (e) {
        reject(e);
      }
      ta.remove();
    });
  }

  function onCopy(e) {
    var hex = e.currentTarget.getAttribute("data-hex") || "";
    if (!hex) return;
    copyText(hex).then(
      function () {
        el.copyStatus.textContent = "Copied " + hex;
      },
      function () {
        el.copyStatus.textContent = hex + " (select and copy)";
      }
    );
  }

  // ---- wiring ---------------------------------------------------------------

  function cacheEls() {
    el.panel = $("panel-colors");
    el.grid = $("clr-grid");
    el.up = $("clr-up");
    el.down = $("clr-down");
    el.left = $("clr-left");
    el.right = $("clr-right");
    el.hInput = $("clr-h-input");
    el.vInput = $("clr-v-input");
    el.goPage = $("clr-go-page");
    el.rInput = $("clr-r-input");
    el.gInput = $("clr-g-input");
    el.bInput = $("clr-b-input");
    el.goRGB = $("clr-go-rgb");
    el.jumpMsg = $("clr-jump-msg");
    el.order = $("clr-order");
    el.info = $("clr-page-info");
    el.detail = $("clr-detail");
    el.detailEmpty = $("clr-detail-empty");
    el.dSwatch = $("clr-d-swatch");
    el.dSwatchTab = $("clr-d-swatch-tab");
    el.dSwatchHex = $("clr-d-swatch-hex");
    el.dSpell = $("clr-d-spell");
    el.dOrig = $("clr-d-orig");
    el.dOrigHex = $("clr-d-orig-hex");
    el.dDisp = $("clr-d-disp");
    el.dDispHex = $("clr-d-disp-hex");
    el.dOrder = $("clr-d-order");
    el.copyDisp = $("clr-copy-disp");
    el.copyOrig = $("clr-copy-orig");
    el.copyStatus = $("clr-copy-status");
  }

  function onEnter(fn) {
    return function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        fn();
      }
    };
  }

  function bind() {
    el.up.addEventListener("click", function () { move(0, -1); });
    el.down.addEventListener("click", function () { move(0, 1); });
    el.left.addEventListener("click", function () { move(-1, 0); });
    el.right.addEventListener("click", function () { move(1, 0); });
    el.goPage.addEventListener("click", goPage);
    el.hInput.addEventListener("keydown", onEnter(goPage));
    el.vInput.addEventListener("keydown", onEnter(goPage));
    el.goRGB.addEventListener("click", goRGB);
    [el.rInput, el.gInput, el.bInput].forEach(function (inp) {
      inp.addEventListener("keydown", onEnter(goRGB));
    });
    el.order.addEventListener("change", function () {
      if (ORDERS.indexOf(el.order.value) >= 0) state.order = el.order.value;
      renderPage();
    });
    el.grid.addEventListener("click", function (e) {
      var node = e.target && e.target.closest ? e.target.closest(".clr-slot") : null;
      if (!node) return;
      selectSlot(parseInt(node.getAttribute("data-i"), 10));
    });
    el.copyDisp.addEventListener("click", onCopy);
    el.copyOrig.addEventListener("click", onCopy);

    // Arrow keys page when Colors is active and focus isn't in a form field.
    window.addEventListener("keydown", function (e) {
      if (document.body.getAttribute("data-active-tab") !== "colors") return;
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      var t = e.target;
      if (t && (/^(input|textarea|select)$/i.test(t.tagName) || t.isContentEditable)) return;
      var d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (!d || !state.started) return;
      e.preventDefault();
      move(d[0], d[1]);
    });

    window.addEventListener("colors-show", onShow);
    window.addEventListener("tab-changed", function (e) {
      if (e.detail && e.detail.tab === "colors") onShow();
    });
  }

  /** Lazy init: build the 64 swatches the first time the tab opens. */
  function onShow() {
    if (state.started) return;
    state.started = true;
    loadPrefs();
    buildGrid();
    renderPage();
  }

  function init() {
    cacheEls();
    if (!el.panel || !el.grid) return;
    bind();
    if (
      /#colou?rs?\b/i.test(location.hash || "") ||
      document.body.getAttribute("data-active-tab") === "colors"
    ) {
      onShow();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.Colors = {
    onShow: onShow,
    getState: function () {
      return { hPage: state.hPage, vPage: state.vPage, order: state.order, selected: state.selected };
    },
  };
  window.ColorsMath = {
    indexToOriginalRGB: indexToOriginalRGB,
    permuteRGB: permuteRGB,
    reversePermuteRGB: reversePermuteRGB,
    slotAt: slotAt,
    locateRGB: locateRGB,
    toHex: toHex,
  };
})();
