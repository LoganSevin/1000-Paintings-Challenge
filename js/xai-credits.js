/**
 * Global top-left HUD: xAI prepaid credits + weekly usage remaining.
 * Polls /api/xai-usage (server uses Management API).
 */
(function () {
  "use strict";

  var POLL_MS = 60000;
  var el = null;
  var timer = null;
  var lastPayload = null;

  function money(n) {
    if (n == null || isNaN(Number(n))) return "—";
    var v = Number(n);
    if (Math.abs(v) >= 100) return "$" + v.toFixed(0);
    if (Math.abs(v) >= 10) return "$" + v.toFixed(1);
    return "$" + v.toFixed(2);
  }

  function ensureEl() {
    if (el && document.body.contains(el)) return el;
    el = document.getElementById("xai-credits-hud");
    if (!el) {
      el = document.createElement("div");
      el.id = "xai-credits-hud";
      el.className = "xai-credits-hud";
      el.setAttribute("role", "status");
      el.setAttribute("aria-live", "polite");
      el.innerHTML =
        '<a class="xai-credits-link" href="https://console.x.ai/team/default/billing" target="_blank" rel="noopener noreferrer" title="Open xAI billing">' +
        '<span class="xai-credits-line" id="xai-credits-line1">Credits …</span>' +
        '<span class="xai-credits-line" id="xai-credits-line2">Week …</span>' +
        "</a>" +
        '<button type="button" class="xai-credits-refresh" id="xai-credits-refresh" title="Refresh credits">↻</button>';
      document.body.appendChild(el);
      var btn = document.getElementById("xai-credits-refresh");
      if (btn) {
        btn.addEventListener("click", function (e) {
          e.preventDefault();
          e.stopPropagation();
          refresh(true);
        });
      }
    }
    return el;
  }

  function render(data) {
    ensureEl();
    var line1 = document.getElementById("xai-credits-line1");
    var line2 = document.getElementById("xai-credits-line2");
    if (!line1 || !line2) return;

    el.classList.remove("is-error", "is-low", "is-ok", "is-loading");

    if (!data) {
      el.classList.add("is-loading");
      line1.textContent = "Credits …";
      line2.textContent = "Week …";
      return;
    }

    if (!data.ok) {
      el.classList.add("is-error");
      line1.textContent = "Credits unavailable";
      var hint = data.message || data.error || "Check Management Key";
      if (hint.length > 72) hint = hint.slice(0, 70) + "…";
      line2.textContent = hint;
      el.title = data.message || data.error || "Could not load xAI usage";
      var link = el.querySelector(".xai-credits-link");
      if (link && data.mgmt_keys_url) link.href = data.mgmt_keys_url;
      else if (link && data.console_url) link.href = data.console_url;
      return;
    }

    var credits = data.credits_usd;
    var weekLeft = data.week_remaining_usd;
    var weekSpent = data.week_spent_usd;
    var weekLimit = data.week_limit_usd;

    el.classList.add("is-ok");
    if (credits != null && Number(credits) < 5) el.classList.add("is-low");
    if (weekLeft != null && Number(weekLeft) < 5) el.classList.add("is-low");

    line1.textContent = "Credits " + money(credits) + " left";

    if (weekLimit != null && weekLeft != null) {
      line2.textContent =
        "Week " + money(weekLeft) + " left of " + money(weekLimit);
    } else if (weekLeft != null && weekSpent != null) {
      line2.textContent =
        "Week " + money(weekLeft) + " left · used " + money(weekSpent);
    } else if (weekSpent != null) {
      line2.textContent = "Week used " + money(weekSpent);
    } else {
      line2.textContent = "Week —";
    }

    var tip = [];
    if (credits != null) tip.push("Prepaid credits: " + money(credits));
    if (weekSpent != null) tip.push("This week spent: " + money(weekSpent));
    if (weekLimit != null) tip.push("Weekly soft limit: " + money(weekLimit));
    if (weekLeft != null) tip.push("Weekly remaining: " + money(weekLeft));
    if (data.cached) tip.push("(cached)");
    tip.push("Click ↻ to refresh · opens billing in new tab");
    el.title = tip.join(" · ");

    var a = el.querySelector(".xai-credits-link");
    if (a && data.console_url) a.href = data.console_url;
  }

  function apiUrl(path) {
    if (typeof window.galleryApiUrl === "function") return window.galleryApiUrl(path);
    return path;
  }

  function refresh(force) {
    ensureEl();
    if (force) {
      el.classList.add("is-loading");
    }
    var q = force ? "?refresh=1" : "";
    return fetch(apiUrl("/api/xai-usage" + q), { cache: "no-store" })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        lastPayload = data;
        render(data);
        return data;
      })
      .catch(function (err) {
        render({
          ok: false,
          error: "network",
          message: (err && err.message) || "Network error",
        });
      });
  }

  function isPublicSite() {
    var h = (location.hostname || "").toLowerCase();
    return (
      h.indexOf("netlify.app") >= 0 ||
      h.indexOf("github.io") >= 0 ||
      h.indexOf("pages.dev") >= 0
    );
  }

  function start() {
    ensureEl();
    if (isPublicSite()) {
      el.hidden = true;
      return;
    }
    render(null);
    refresh(false);
    if (timer) clearInterval(timer);
    timer = setInterval(function () {
      refresh(false);
    }, POLL_MS);
  }

  // Refresh after generations finish (if other tabs dispatch this)
  window.addEventListener("xai-usage-refresh", function () {
    refresh(true);
  });
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) refresh(false);
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }

  window.XaiCreditsHud = {
    refresh: refresh,
    getLast: function () {
      return lastPayload;
    },
  };
})();
