/**
 * Defer non-critical CSS so first paint (especially phone / Tailscale) is faster.
 * Scripts stay in page order with defer; this only async-loads secondary stylesheets.
 */
(function () {
  "use strict";

  var CRITICAL = {
    "styles.css": 1,
    "site-nav.css": 1,
    "mobile.css": 1,
    "dream-stasis.css": 1,
    "stasis-skin.css": 1,
    "spellforge.css": 1,
  };

  function baseName(href) {
    try {
      var path = String(href || "").split("?")[0];
      var parts = path.split("/");
      return parts[parts.length - 1] || "";
    } catch (e) {
      return "";
    }
  }

  function promote(link) {
    if (!link || link.media === "all") return;
    link.media = "all";
    try {
      link.onload = null;
    } catch (e) {}
  }

  function loadWhenIdle() {
    var links = document.querySelectorAll('link[rel="stylesheet"][data-lazy-css]');
    var i = 0;
    function next() {
      if (i >= links.length) return;
      promote(links[i++]);
      if (i < links.length) {
        setTimeout(next, 30);
      }
    }
    next();
  }

  function isLocalHost() {
    var h = (location.hostname || "").toLowerCase();
    return h === "localhost" || h === "127.0.0.1" || h === "[::1]";
  }

  function isPhoneLike() {
    try {
      return (
        window.matchMedia("(max-width: 768px)").matches ||
        (window.matchMedia("(pointer: coarse)").matches && window.innerWidth < 900)
      );
    } catch (e) {
      return false;
    }
  }

  function markNonCritical() {
    // Desktop localhost: load ALL CSS normally — never sacrifice PC for phone hacks
    if (isLocalHost() && !isPhoneLike()) return;

    var links = document.querySelectorAll('link[rel="stylesheet"][href*="css/"]');
    links.forEach(function (link) {
      var name = baseName(link.getAttribute("href"));
      if (CRITICAL[name]) return;
      if (link.dataset.lazyCss === "0") return;
      if (link.sheet) return;
      link.dataset.lazyCss = "1";
      link.media = "print";
      link.addEventListener("load", function () {
        promote(link);
      });
      if (link.sheet) promote(link);
    });
  }

  function boot() {
    markNonCritical();
    if (isLocalHost() && !isPhoneLike()) return;
    var start = function () {
      if (typeof requestIdleCallback === "function") {
        requestIdleCallback(loadWhenIdle, { timeout: 2500 });
      } else {
        setTimeout(loadWhenIdle, 400);
      }
    };
    start();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
