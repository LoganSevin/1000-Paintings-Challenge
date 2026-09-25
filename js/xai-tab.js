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
    var cloud = $("xa-cloud-meter");
    var studio = window.StudioTelemetry && window.StudioTelemetry.snapshot
      ? window.StudioTelemetry.snapshot()
      : null;
    function fill(node) {
      if (!node) return;
      var html = "";
      if (studio) {
        html +=
          "<p class=\"xa-meter\">Studio meter: <strong>" +
          studio.activity +
          "</strong> actions · " +
          studio.cloud_try +
          " cloud tries · " +
          studio.fuse +
          " on-device fuses · " +
          studio.describe +
          " describes</p>";
      }
      if (data && data.ok && data.vendor_ok !== false && data.credits_usd != null) {
        html +=
          "<p class=\"xa-meter\">Prepaid at xAI: <strong>" +
          money(data.credits_usd) +
          "</strong></p>" +
          "<p class=\"xa-meter\">This week at xAI: <strong>" +
          money(data.week_spent_usd) +
          "</strong> spent" +
          (data.week_limit_usd != null ? " of " + money(data.week_limit_usd) + " soft limit" : "") +
          "</p>";
      } else {
        html +=
          "<p>xAI prepaid readout is not linked on this host yet (needs a Management Key on Netlify). The studio meter above is live and functional.</p>";
        if (data && data.message) {
          html += "<p class=\"xa-key-state\">" + String(data.message).slice(0, 180) + "</p>";
        }
      }
      html += "<p>Vendor dollars never cap Logan7in unlimited.</p>";
      node.innerHTML = html;
    }
    fill(el);
    fill(cloud);
    setNeedle(data, studio);
  }

  function setNeedle(data, studio) {
    var needle = $("xa-needle");
    var read = $("xa-gauge-read");
    var keeper = $("xa-keeper");
    var pct = 0;
    var label = "studio";
    if (data && data.ok && data.vendor_ok !== false && data.credits_usd != null) {
      var spent = Number(data.week_spent_usd);
      var limit = Number(data.week_limit_usd);
      var credits = Number(data.credits_usd);
      if (limit > 0 && !isNaN(spent)) {
        pct = Math.max(0, Math.min(1, spent / limit));
        label = Math.round(pct * 100) + "% week";
      } else if (!isNaN(credits)) {
        pct = Math.max(0, Math.min(1, credits / 100));
        label = money(credits);
      }
    } else if (studio && studio.needle != null) {
      pct = studio.needle;
      label = studio.activity + " acts";
    }
    var deg = -90 + pct * 180;
    if (needle) needle.style.transform = "rotate(" + deg + "deg)";
    if (read) read.textContent = label;
    if (keeper) {
      keeper.classList.remove("is-keeping");
      void keeper.getBoundingClientRect();
      keeper.classList.add("is-keeping");
    }
  }

  function setCloud(on) {
    var shell = document.querySelector("#panel-xai .xa-shell");
    var title = $("xa-title");
    var lede = $("xa-lede");
    var studio = $("xa-studio");
    var cloud = $("xa-cloud");
    if (shell) shell.classList.toggle("is-cloud", !!on);
    if (title) title.textContent = on ? "Cloud xAI" : "xAI";
    if (lede) {
      lede.hidden = !!on;
    }
    if (studio) studio.hidden = !!on;
    if (cloud) cloud.hidden = !on;
    var want = on ? "cloud-xai" : "xai";
    if ((location.hash || "").replace(/^#/, "") !== want) {
      try {
        history.replaceState(null, "", "#" + want);
      } catch (err) {
        location.hash = want;
      }
    }
    paintMeter(window.XaiCreditsHud && window.XaiCreditsHud.getLast && window.XaiCreditsHud.getLast());
  }

  function bind() {
    if (!$("panel-xai")) return;
    paintKey();
    paintMeter(window.XaiCreditsHud && window.XaiCreditsHud.getLast && window.XaiCreditsHud.getLast());
    window.addEventListener("xai-usage-updated", function (e) {
      paintMeter(e.detail);
    });
    window.addEventListener("studio-telemetry-updated", function () {
      paintMeter(window.XaiCreditsHud && window.XaiCreditsHud.getLast && window.XaiCreditsHud.getLast());
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
    var openCloud = $("xa-open-cloud");
    if (openCloud) {
      openCloud.addEventListener("click", function () {
        setCloud(true);
      });
    }
    var back = $("xa-back-studio");
    if (back) {
      back.addEventListener("click", function () {
        setCloud(false);
      });
    }
    var cloudRefresh = $("xa-cloud-refresh");
    if (cloudRefresh) {
      cloudRefresh.addEventListener("click", function () {
        if (window.XaiCreditsHud && window.XaiCreditsHud.refresh) window.XaiCreditsHud.refresh(true);
      });
    }
    window.addEventListener("tab-changed", function (e) {
      if (e.detail && e.detail.tab === "xai") {
        var h = (location.hash || "").replace(/^#/, "");
        setCloud(h === "cloud-xai");
        paintKey();
        paintMeter(window.XaiCreditsHud && window.XaiCreditsHud.getLast && window.XaiCreditsHud.getLast());
      }
    });
  }

  window.XaiTab = {
    setCloud: setCloud,
    isCloud: function () {
      var shell = document.querySelector("#panel-xai .xa-shell");
      return !!(shell && shell.classList.contains("is-cloud"));
    },
    onShow: function () {
      var h = (location.hash || "").replace(/^#/, "");
      setCloud(h === "cloud-xai");
      paintKey();
      paintMeter(window.XaiCreditsHud && window.XaiCreditsHud.getLast && window.XaiCreditsHud.getLast());
    },
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind);
  else bind();
})();
