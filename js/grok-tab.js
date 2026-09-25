(function () {
  "use strict";

  function paint() {
    var el = document.getElementById("gk-key-state");
    if (!el) return;
    var gate = window.AccountGate;
    var k = gate && gate.getVisitorXaiKey ? gate.getVisitorXaiKey() : "";
    el.textContent = k && k.length > 8
      ? "A Grok key is saved in this browser. Optional cloud calls can use it."
      : "No Grok key saved. The studio still works without one.";
  }

  function bind() {
    if (!document.getElementById("panel-grok")) return;
    paint();
    var connect = document.getElementById("gk-connect");
    if (connect) {
      connect.addEventListener("click", function () {
        var gate = window.AccountGate;
        if (gate && gate.promptKeyAsync) gate.promptKeyAsync().then(paint);
        else if (gate && gate.promptKey) {
          gate.promptKey();
          paint();
        }
      });
    }
    var clear = document.getElementById("gk-clear");
    if (clear) {
      clear.addEventListener("click", function () {
        try {
          Object.keys(localStorage).forEach(function (k) {
            if (k.indexOf("l7in_xai_key_") === 0) localStorage.removeItem(k);
          });
        } catch (e) {}
        paint();
      });
    }
    window.addEventListener("tab-changed", function (e) {
      if (e.detail && e.detail.tab === "grok") paint();
    });
  }

  window.GrokTab = { onShow: paint };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind);
  else bind();
})();
