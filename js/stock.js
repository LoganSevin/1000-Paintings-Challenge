/**
 * Stock desk — educational investing tips panel (not financial advice).
 */
(function () {
  "use strict";

  var STORAGE_KEY = "gallery-stock-plan-v1";

  function $(id) {
    return document.getElementById(id);
  }

  function showSection(id) {
    document.querySelectorAll(".stk-nav-btn").forEach(function (btn) {
      btn.classList.toggle("is-active", btn.getAttribute("data-stk-sec") === id);
    });
    document.querySelectorAll(".stk-sec").forEach(function (sec) {
      var on = sec.getAttribute("data-stk-sec") === id;
      sec.hidden = !on;
      sec.classList.toggle("is-active", on);
    });
  }

  function loadPlan() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var data = JSON.parse(raw);
      if (data.checks) {
        document.querySelectorAll("#stk-checklist input[data-stk-check]").forEach(function (el) {
          var k = el.getAttribute("data-stk-check");
          el.checked = !!data.checks[k];
        });
      }
      var notes = $("stk-notes");
      if (notes && typeof data.notes === "string") notes.value = data.notes;
    } catch (e) {}
  }

  function savePlan() {
    var checks = {};
    document.querySelectorAll("#stk-checklist input[data-stk-check]").forEach(function (el) {
      checks[el.getAttribute("data-stk-check")] = !!el.checked;
    });
    var notes = $("stk-notes");
    var payload = {
      checks: checks,
      notes: notes ? notes.value : "",
      savedAt: Date.now(),
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      var st = $("stk-save-status");
      if (st) {
        st.textContent = "Saved on this device.";
        setTimeout(function () {
          if (st.textContent === "Saved on this device.") st.textContent = "";
        }, 2200);
      }
    } catch (e) {
      var st2 = $("stk-save-status");
      if (st2) st2.textContent = "Could not save (storage blocked).";
    }
  }

  function clearPlan() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {}
    document.querySelectorAll("#stk-checklist input[data-stk-check]").forEach(function (el) {
      el.checked = false;
    });
    var notes = $("stk-notes");
    if (notes) notes.value = "";
    var st = $("stk-save-status");
    if (st) st.textContent = "Cleared.";
  }

  function runRiskQuiz() {
    var h = ($("stk-q-horizon") || {}).value || "long";
    var d = ($("stk-q-drop") || {}).value || "hold";
    var k = ($("stk-q-know") || {}).value || "some";
    var out = $("stk-risk-out");
    if (!out) return;

    if (h === "short" || d === "panic") {
      out.textContent =
        "Suggested stance: mostly cash / short bonds for near-term needs. Avoid putting rent or “need it soon” money in stocks. Learn with tiny paper sizes if curious.";
      return;
    }
    if (h === "mid" && d === "freeze") {
      out.textContent =
        "Suggested stance: majority broad low-cost index + automatic buys. Keep a cash buffer so you never have to sell stocks in a panic. Skip concentrated speculation for now.";
      return;
    }
    if (k === "new") {
      out.textContent =
        "Suggested stance: 100% simple — one diversified equity index (or target-date fund), automatic contributions, ignore daily news. Add individual stocks only after you can explain the business.";
      return;
    }
    if (k === "deep" && d === "hold" && h === "long") {
      out.textContent =
        "Suggested stance: core index as the engine (majority), optional small “satellite” sleeve for researched quality names. Cap any single speculative stock. Rebalance yearly; sell on broken thesis, not headlines.";
      return;
    }
    out.textContent =
      "Suggested stance: core diversified equities on a schedule, small satellite ideas only if you understand them, written sell rules, no leverage. Boring is a feature.";
  }

  function bind() {
    if (!$("panel-stock") || $("panel-stock")._stkBound) return;
    $("panel-stock")._stkBound = true;

    document.querySelectorAll(".stk-nav-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        showSection(btn.getAttribute("data-stk-sec") || "core");
      });
    });

    var run = $("stk-risk-run");
    if (run) run.addEventListener("click", runRiskQuiz);

    var save = $("stk-save-plan");
    if (save) save.addEventListener("click", savePlan);
    var clr = $("stk-clear-plan");
    if (clr) clr.addEventListener("click", clearPlan);

    // Auto-save checklist toggles
    document.querySelectorAll("#stk-checklist input[data-stk-check]").forEach(function (el) {
      el.addEventListener("change", savePlan);
    });
    var notes = $("stk-notes");
    if (notes) {
      var t;
      notes.addEventListener("input", function () {
        clearTimeout(t);
        t = setTimeout(savePlan, 500);
      });
    }

    loadPlan();
  }

  function onShow() {
    bind();
    loadPlan();
  }

  window.StockDesk = { onShow: onShow };
  window.addEventListener("stock-show", onShow);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();
