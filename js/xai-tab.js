(function () {
  "use strict";

  function $(id) {
    return document.getElementById(id);
  }

  function money(n) {
    if (n == null || isNaN(Number(n))) return "—";
    var v = Number(n);
    if (Math.abs(v) >= 100) return "$" + v.toFixed(0);
    if (Math.abs(v) >= 10) return "$" + v.toFixed(1);
    return "$" + v.toFixed(2);
  }

  function keyOn() {
    var gate = window.AccountGate;
    var k = gate && gate.getVisitorXaiKey ? gate.getVisitorXaiKey() : "";
    return !!(k && k.length > 8);
  }

  function paintKey() {
    var el = $("xa-key-state");
    if (!el) return;
    el.textContent = keyOn()
      ? "A visitor xAI key is saved in this browser. Optional cloud gens can bill that key."
      : "No visitor key saved. The studio still works. Cloud Grok is optional.";
  }

  function paintMeter(data) {
    var el = $("xa-meter");
    if (!el) return;
    if (!data) {
      el.innerHTML = "<p>Vendor meter: waiting…</p>";
      return;
    }
    if (!data.ok) {
      el.innerHTML =
        "<p>Vendor meter unavailable. That does not cap Logan7in unlimited.</p>";
      return;
    }
    el.innerHTML =
      "<p class=\"xa-meter\">Prepaid at xAI: <strong>" +
      money(data.credits_usd) +
      "</strong></p>" +
      "<p class=\"xa-meter\">This week at xAI: <strong>" +
      money(data.week_spent_usd) +
      "</strong> spent" +
      (data.week_limit_usd != null ? " of " + money(data.week_limit_usd) + " soft limit" : "") +
      "</p>" +
      "<p>Those numbers are telemetry. They are not a door on this site.</p>";
  }

  function bind() {
    if (!$("panel-xai")) return;
    paintKey();
    paintMeter(window.XaiCreditsHud && window.XaiCreditsHud.getLast && window.XaiCreditsHud.getLast());
    window.addEventListener("xai-usage-updated", function (e) {
      paintMeter(e.detail);
    });
    var refresh = $("xa-refresh");
    if (refresh) {
      refresh.addEventListener("click", function () {
        if (window.XaiCreditsHud && window.XaiCreditsHud.refresh) window.XaiCreditsHud.refresh(true);
      });
    }
    var connect = $("xa-connect");
    if (connect) {
      connect.addEventListener("click", function () {
        var gate = window.AccountGate;
        if (gate && gate.promptKeyAsync) {
          gate.promptKeyAsync().then(paintKey);
        } else if (gate && gate.promptKey) {
          gate.promptKey();
          paintKey();
        }
      });
    }
    var clear = $("xa-clear");
    if (clear) {
      clear.addEventListener("click", function () {
        try {
          var prefix = "l7in_xai_key_";
          Object.keys(localStorage).forEach(function (k) {
            if (k.indexOf(prefix) === 0) localStorage.removeItem(k);
          });
        } catch (err) {}
        paintKey();
      });
    }
    window.addEventListener("tab-changed", function (e) {
      if (e.detail && e.detail.tab === "xai") {
        paintKey();
        paintMeter(window.XaiCreditsHud && window.XaiCreditsHud.getLast && window.XaiCreditsHud.getLast());
      }
    });
  }

  window.XaiTab = {
    onShow: function () {
      paintKey();
      paintMeter(window.XaiCreditsHud && window.XaiCreditsHud.getLast && window.XaiCreditsHud.getLast());
    },
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind);
  else bind();
})();
