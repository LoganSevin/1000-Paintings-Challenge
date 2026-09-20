(function () {
  "use strict";

  var GLYPHS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  var TOP = GLYPHS.length - 1;

  var state = { selected: 0 };

  function $(id) {
    return document.getElementById(id);
  }

  function yValue(index) {
    return TOP === 0 ? 1 : (TOP - index) / TOP;
  }

  function rankLabel(index) {
    if (index === 0) return "highest point";
    if (index === TOP) return "lowest point";
    return "rung " + (index + 1) + " of " + GLYPHS.length;
  }

  function renderColumn() {
    var col = $("az-column");
    if (!col) return;
    col.innerHTML = "";
    GLYPHS.forEach(function (ch, i) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "az-rung" + (i === state.selected ? " is-selected" : "");
      btn.dataset.azIndex = String(i);
      btn.setAttribute("aria-pressed", i === state.selected ? "true" : "false");
      btn.title = ch + " · " + rankLabel(i);
      var y = yValue(i).toFixed(2);
      btn.innerHTML =
        '<span class="az-y">' +
        y +
        '</span><span class="az-glyph">' +
        ch +
        '</span><span class="az-idx">' +
        i +
        "</span>";
      btn.addEventListener("click", function () {
        selectIndex(i);
      });
      col.appendChild(btn);
    });
  }

  function renderReadout() {
    var ch = GLYPHS[state.selected];
    var glyphEl = $("az-readout-glyph");
    var metaEl = $("az-readout-meta");
    if (glyphEl) glyphEl.textContent = ch;
    if (metaEl) {
      metaEl.textContent =
        ch +
        " is the " +
        rankLabel(state.selected) +
        ". Index " +
        state.selected +
        " of 0–35. Height y = " +
        yValue(state.selected).toFixed(3) +
        " (1 at 0, 0 at Z).";
    }
  }

  function selectIndex(index) {
    var i = Math.max(0, Math.min(TOP, index | 0));
    state.selected = i;
    document.querySelectorAll(".az-rung").forEach(function (el) {
      var on = Number(el.dataset.azIndex) === i;
      el.classList.toggle("is-selected", on);
      el.setAttribute("aria-pressed", on ? "true" : "false");
    });
    renderReadout();
    var rung = document.querySelector('.az-rung[data-az-index="' + i + '"]');
    if (rung && rung.scrollIntoView) {
      rung.scrollIntoView({ block: "nearest" });
    }
  }

  function copySelected() {
    var ch = GLYPHS[state.selected];
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(ch).catch(function () {});
    }
    var btn = $("az-copy");
    if (btn) {
      var prev = btn.textContent;
      btn.textContent = "Copied " + ch;
      setTimeout(function () {
        btn.textContent = prev;
      }, 1200);
    }
  }

  function onKey(e) {
    if (!document.body.classList.contains("az-tab-active")) return;
    if (e.key === "ArrowDown" || e.key === "j") {
      e.preventDefault();
      selectIndex(state.selected + 1);
    } else if (e.key === "ArrowUp" || e.key === "k") {
      e.preventDefault();
      selectIndex(state.selected - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      selectIndex(0);
    } else if (e.key === "End") {
      e.preventDefault();
      selectIndex(TOP);
    }
  }

  function init() {
    renderColumn();
    renderReadout();
    var copyBtn = $("az-copy");
    if (copyBtn && !copyBtn.dataset.bound) {
      copyBtn.dataset.bound = "1";
      copyBtn.addEventListener("click", copySelected);
    }
    if (!document.documentElement.dataset.azKeys) {
      document.documentElement.dataset.azKeys = "1";
      document.addEventListener("keydown", onKey);
    }
  }

  window.AzScale = {
    onShow: init,
    glyphs: GLYPHS.slice(),
  };

  window.addEventListener("az-show", init);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
