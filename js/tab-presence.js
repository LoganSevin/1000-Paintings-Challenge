(function () {
  "use strict";

  var SID_KEY = "tabPresenceSid";
  var HEARTBEAT_MS = 10000;
  var TAB_RE = /^[a-z0-9-]{1,40}$/;
  var counts = {};
  var currentTab = "gallery";
  var timer = null;
  var HEAD_SVG =
    '<svg class="tab-presence-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<circle class="tp-fill" cx="12" cy="8.2" r="5.1"></circle>' +
    '<circle class="tp-stroke" cx="12" cy="8.2" r="5.1"></circle>' +
    '<path class="tp-fill" d="M5.2 21.2c0-4.2 3-6.8 6.8-6.8s6.8 2.6 6.8 6.8"></path>' +
    '<path class="tp-stroke" d="M5.2 21.2c0-4.2 3-6.8 6.8-6.8s6.8 2.6 6.8 6.8"></path>' +
    '<circle class="tp-face" cx="10.1" cy="7.6" r="0.55"></circle>' +
    '<circle class="tp-face" cx="13.9" cy="7.6" r="0.55"></circle>' +
    '<path class="tp-face" d="M10.3 9.7c0.9 0.9 2.5 0.9 3.4 0"></path>' +
    "</svg>";

  function hashTab() {
    var h = (location.hash || "").replace(/^#/, "").split("?")[0];
    if (!h || h === "subscribe") return "gallery";
    if (h === "0-z" || h === "zeroz" || h === "0z") return "az";
    if (h === "kjv" || h === "scripture") return "bible";
    if (h === "rooms") return "places";
    return h;
  }

  function sessionId() {
    try {
      var id = sessionStorage.getItem(SID_KEY);
      if (id && id.length >= 8) return id;
      id =
        (crypto.randomUUID && crypto.randomUUID()) ||
        "sid-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
      sessionStorage.setItem(SID_KEY, id);
      return id;
    } catch (e) {
      return "sid-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
    }
  }

  function cssEscape(s) {
    if (window.CSS && CSS.escape) return CSS.escape(s);
    return String(s).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  function tabButtons() {
    return document.querySelectorAll(
      ".site-tabs .tab[data-tab], .kids-tabs .tab[data-tab], .site-tabs-more-item[data-tab]"
    );
  }

  function ensureHead(btn) {
    var wrap = btn.querySelector(":scope > .tab-presence");
    if (wrap) return wrap;
    wrap = document.createElement("span");
    wrap.className = "tab-presence";
    wrap.setAttribute("aria-hidden", "true");
    wrap.innerHTML = '<span class="tab-presence-count"></span>' + HEAD_SVG;

    var tally = btn.querySelector(":scope > .tab-tally");
    var name = btn.querySelector(":scope > .tab-name");
    if (tally) btn.insertBefore(wrap, tally);
    else if (name) btn.insertBefore(wrap, name);
    else btn.insertBefore(wrap, btn.firstChild);
    return wrap;
  }

  function paintTab(name, n) {
    n = parseInt(n, 10) || 0;
    document.querySelectorAll('[data-tab="' + cssEscape(name) + '"]').forEach(function (btn) {
      if (!btn.closest(".site-tabs, .kids-tabs, .site-tabs-more")) return;
      var wrap = ensureHead(btn);
      var countEl = wrap.querySelector(".tab-presence-count");
      var occupied = n > 0;
      wrap.classList.toggle("is-occupied", occupied);
      if (countEl) countEl.textContent = occupied ? String(n) : "";
      var label = occupied ? n + " here now" : "empty";
      var prev = (btn.title || "").replace(/\s*·\s*\d+ here now|\s*·\s*empty/g, "");
      btn.title = (prev ? prev + " · " : "") + label;
    });
  }

  function paintAll(next) {
    counts = next && typeof next === "object" ? next : {};
    var seen = {};
    tabButtons().forEach(function (btn) {
      var name = btn.getAttribute("data-tab");
      if (!name || seen[name]) {
        if (name) paintTab(name, counts[name] || 0);
        return;
      }
      seen[name] = true;
      paintTab(name, counts[name] || 0);
    });
  }

  function applyPayload(data) {
    if (data && data.ok && data.counts) paintAll(data.counts);
  }

  function heartbeat(tab, force) {
    if (document.hidden && !force) return;
    tab = String(tab || currentTab || hashTab()).toLowerCase();
    if (!TAB_RE.test(tab)) return;
    currentTab = tab;
    // Optimistic: at least yourself on current tab
    var optimistic = Object.assign({}, counts);
    // Rebuild from last server counts but ensure current tab >= 1
    optimistic[tab] = Math.max(1, parseInt(optimistic[tab], 10) || 0);
    paintAll(optimistic);

    fetch("/api/presence", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sid: sessionId(), tab: tab }),
      keepalive: true,
    })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(applyPayload)
      .catch(function () {});
  }

  function leave() {
    var sid = sessionId();
    var payload = JSON.stringify({ sid: sid, leave: true });
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(
          "/api/presence",
          new Blob([payload], { type: "application/json" })
        );
        return;
      }
    } catch (e) {}
    try {
      fetch("/api/presence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true,
      });
    } catch (e2) {}
  }

  function schedule() {
    if (timer) clearInterval(timer);
    timer = setInterval(function () {
      if (document.hidden) return;
      heartbeat(currentTab, false);
    }, HEARTBEAT_MS);
  }

  function init() {
    tabButtons().forEach(ensureHead);
    paintAll({});
    currentTab = hashTab();
    heartbeat(currentTab, true);
    schedule();

    window.addEventListener("tab-changed", function (e) {
      var tab = (e && e.detail && e.detail.tab) || hashTab();
      heartbeat(tab, true);
    });

    window.addEventListener("hashchange", function () {
      var tab = hashTab();
      if (tab !== currentTab) heartbeat(tab, true);
    });

    document.addEventListener("visibilitychange", function () {
      if (document.hidden) return;
      heartbeat(currentTab, true);
    });

    window.addEventListener("pagehide", leave);
    window.addEventListener("beforeunload", leave);

    // If tabs are injected later (overflow menu), refresh heads occasionally.
    setInterval(function () {
      tabButtons().forEach(ensureHead);
      paintAll(counts);
    }, 15000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
