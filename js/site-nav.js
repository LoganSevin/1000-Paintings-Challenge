/**
 * Site navigation helpers.
 * Local studio: keep ALL tabs visible (horizontal scroll) — no "More" dump.
 * Public hosts may still use a light overflow menu for less-used tools.
 */
(function () {
  "use strict";

  /** Only used on public static hosts — keep local studio fully visible. */
  var PUBLIC_PRIMARY = [
    "gallery",
    "pulse",
    "spellforge",
    "muralwalk",
    "fleeting-idea",
    "conceptualizer",
    "income",
  ];

  function isPublicSite() {
    var h = (location.hostname || "").toLowerCase();
    return (
      h.indexOf("netlify.app") >= 0 ||
      h.indexOf("github.io") >= 0 ||
      h.indexOf("pages.dev") >= 0
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

  function tabLabel(tab) {
    return (tab.textContent || tab.dataset.tab || "").trim();
  }

  function initPublicMode() {
    if (isPublicSite()) {
      document.body.classList.add("is-public-site");
    }
    if (isLocalStudio()) {
      document.body.classList.add("is-local-studio");
    }
  }

  /** Undo any leftover overflow hiding from a previous broken build. */
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

  /**
   * Public-only: tuck non-primary tabs into More.
   * Local studio never runs this — full scrollable strip.
   */
  function initTabOverflowPublicOnly() {
    var nav = document.querySelector(".site-tabs");
    if (!nav) return;

    // Always start from a clean full list
    restoreAllTabs(nav);

    // Local / LAN studio: keep every tab visible (scroll the bar)
    if (!isPublicSite() || isLocalStudio()) {
      nav.dataset.navReady = "1";
      nav.classList.add("site-tabs-scroll-all");
      return;
    }

    if (nav.dataset.navReady) return;
    nav.dataset.navReady = "1";

    var tabs = Array.prototype.slice.call(nav.querySelectorAll(".tab[data-tab]"));
    if (!tabs.length) return;

    var overflow = [];
    tabs.forEach(function (tab) {
      var id = tab.dataset.tab;
      if (PUBLIC_PRIMARY.indexOf(id) >= 0) return;
      tab.classList.add("tab-overflow");
      tab.hidden = true;
      overflow.push(tab);
    });

    if (!overflow.length) return;

    var wrap = document.createElement("div");
    wrap.className = "site-tabs-more";
    wrap.innerHTML =
      '<button type="button" class="tab site-tabs-more-btn" id="site-tabs-more-btn" aria-haspopup="true" aria-expanded="false">' +
      '<span class="site-tabs-more-label">More</span>' +
      '<span class="site-tabs-more-caret" aria-hidden="true">▾</span>' +
      "</button>" +
      '<div class="site-tabs-more-menu" id="site-tabs-more-menu" role="menu" hidden></div>';

    nav.appendChild(wrap);

    var btn = wrap.querySelector("#site-tabs-more-btn");
    var menu = wrap.querySelector("#site-tabs-more-menu");
    var label = wrap.querySelector(".site-tabs-more-label");

    overflow.forEach(function (tab) {
      var item = document.createElement("button");
      item.type = "button";
      item.className = "site-tabs-more-item";
      item.setAttribute("role", "menuitem");
      item.dataset.tab = tab.dataset.tab;
      item.textContent = tabLabel(tab);
      item.addEventListener("click", function () {
        tab.click();
        closeMenu();
      });
      menu.appendChild(item);
    });

    function closeMenu() {
      menu.hidden = true;
      btn.setAttribute("aria-expanded", "false");
      wrap.classList.remove("is-open");
    }

    function openMenu() {
      menu.hidden = false;
      btn.setAttribute("aria-expanded", "true");
      wrap.classList.add("is-open");
    }

    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (menu.hidden) openMenu();
      else closeMenu();
    });

    document.addEventListener("click", function (e) {
      if (!wrap.contains(e.target)) closeMenu();
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeMenu();
    });

    window.addEventListener("tab-changed", function (e) {
      var name = e.detail && e.detail.tab;
      var inOverflow = overflow.some(function (t) {
        return t.dataset.tab === name;
      });
      btn.classList.toggle("active", inOverflow);
      if (inOverflow) {
        var match = overflow.filter(function (t) {
          return t.dataset.tab === name;
        })[0];
        label.textContent = match ? tabLabel(match) : "More";
      } else {
        label.textContent = "More";
      }
      menu.querySelectorAll(".site-tabs-more-item").forEach(function (item) {
        item.classList.toggle("active", item.dataset.tab === name);
      });
    });
  }

  initPublicMode();
  initTabOverflowPublicOnly();

  window.SiteNav = {
    isPublicSite: isPublicSite,
    isLocalStudio: isLocalStudio,
    primaryTabs: PUBLIC_PRIMARY.slice(),
    restoreAllTabs: function () {
      restoreAllTabs(document.querySelector(".site-tabs"));
    },
  };
})();
