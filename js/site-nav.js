/**
 * Site navigation helpers.
 * Always show every studio tab in a scrollable strip.
 * Kids Mode has its own More 🔒 passcode shelf — do not reuse that name here.
 */
(function () {
  "use strict";

  function isPublicSite() {
    var h = (location.hostname || "").toLowerCase();
    return (
      h.indexOf("netlify.app") >= 0 ||
      h.indexOf("github.io") >= 0 ||
      h.indexOf("pages.dev") >= 0 ||
      h === "logan7in.art" ||
      h === "www.logan7in.art"
    );
  }

  function isLocalStudio() {
    var h = (location.hostname || "").toLowerCase();
    return (
      h === "localhost" ||
      h === "127.0.0.1" ||
      h === "[::1]" ||
      h === "" ||
      location.protocol === "file:"
    );
  }

  function initPublicMode() {
    if (isPublicSite()) {
      document.body.classList.add("is-public-site");
    }
    if (isLocalStudio()) {
      document.body.classList.add("is-local-studio");
    }
  }

  function restoreAllTabs(nav) {
    if (!nav) return;
    nav.querySelectorAll(".tab[data-tab]").forEach(function (tab) {
      tab.classList.remove("tab-overflow");
      tab.hidden = false;
      tab.style.display = "";
    });
    var more = nav.querySelector(".site-tabs-more");
    if (more && more.parentNode) more.parentNode.removeChild(more);
  }

  function initFullTabStrip() {
    var nav = document.querySelector(".site-tabs");
    if (!nav) return;
    restoreAllTabs(nav);
    nav.dataset.navReady = "1";
    nav.classList.add("site-tabs-scroll-all");
  }

  initPublicMode();
  initFullTabStrip();

  window.SiteNav = {
    isPublicSite: isPublicSite,
    isLocalStudio: isLocalStudio,
    primaryTabs: [],
    restoreAllTabs: function () {
      restoreAllTabs(document.querySelector(".site-tabs"));
    },
  };
})();
