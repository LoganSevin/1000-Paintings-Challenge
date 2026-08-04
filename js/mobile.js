/**
 * Phone layout helpers — is-phone class, Fleeting Idea drawers, resize hooks.
 */
(function () {
  "use strict";

  var PHONE_MQ = window.matchMedia("(max-width: 768px)");

  function $(id) {
    return document.getElementById(id);
  }

  function closeFiDrawers() {
    document.body.classList.remove("fi-mobile-layers-open", "fi-mobile-library-open");
  }

  function ensureFiMobileDock() {
    if (!PHONE_MQ.matches || !$("panel-fleeting-idea")) return;
    if ($("fi-mobile-dock")) return;

    var dock = document.createElement("div");
    dock.id = "fi-mobile-dock";
    dock.className = "fi-mobile-dock";
    dock.setAttribute("aria-label", "Mobile panels");

    var layersBtn = document.createElement("button");
    layersBtn.type = "button";
    layersBtn.id = "fi-mobile-layers";
    layersBtn.className = "fi-mobile-dock-btn";
    layersBtn.dataset.panel = "layers";
    layersBtn.textContent = "Layers";

    var libraryBtn = document.createElement("button");
    libraryBtn.type = "button";
    libraryBtn.id = "fi-mobile-library";
    libraryBtn.className = "fi-mobile-dock-btn";
    libraryBtn.dataset.panel = "library";
    libraryBtn.textContent = "Library";

    dock.appendChild(layersBtn);
    dock.appendChild(libraryBtn);

    var workspace = $("fi-workspace");
    if (workspace) workspace.appendChild(dock);

    layersBtn.addEventListener("click", function () {
      var open = document.body.classList.toggle("fi-mobile-layers-open");
      if (open) document.body.classList.remove("fi-mobile-library-open");
    });

    libraryBtn.addEventListener("click", function () {
      var open = document.body.classList.toggle("fi-mobile-library-open");
      if (open) document.body.classList.remove("fi-mobile-layers-open");
    });
  }

  function removeFiMobileDock() {
    var dock = $("fi-mobile-dock");
    if (dock) dock.remove();
    closeFiDrawers();
  }

  function scrollActiveTabIntoView() {
    if (!PHONE_MQ.matches) return;
    var active = document.querySelector(".site-tabs .tab.active");
    if (active && active.scrollIntoView) {
      active.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
    }
  }

  function setPhoneLayout() {
    var on = PHONE_MQ.matches;
    document.documentElement.classList.toggle("is-phone", on);
    if (on) {
      ensureFiMobileDock();
    } else {
      removeFiMobileDock();
    }
    if (on && document.body.classList.contains("fi-tab-active")) {
      if (typeof window.FleetingIdea !== "undefined" && window.FleetingIdea.syncEdgeInsets) {
        window.FleetingIdea.syncEdgeInsets();
      }
    }
  }

  function onBackdropClose(e) {
    if (!document.body.classList.contains("fi-tab-active")) return;
    if (
      !document.body.classList.contains("fi-mobile-layers-open") &&
      !document.body.classList.contains("fi-mobile-library-open")
    ) {
      return;
    }
    var left = $("fi-sheets-panel");
    var right = $("fi-acquired-rail");
    var dock = $("fi-mobile-dock");
    if (left && left.contains(e.target)) return;
    if (right && right.contains(e.target)) return;
    if (dock && dock.contains(e.target)) return;
    closeFiDrawers();
  }

  function bindTabScroll() {
    document.querySelectorAll(".site-tabs .tab").forEach(function (tab) {
      tab.addEventListener("click", function () {
        setTimeout(scrollActiveTabIntoView, 50);
      });
    });
  }

  PHONE_MQ.addEventListener("change", setPhoneLayout);
  window.addEventListener("resize", function () {
    if (PHONE_MQ.matches && document.body.classList.contains("fi-tab-active")) {
      if (window.FleetingIdea && window.FleetingIdea.syncEdgeInsets) {
        window.FleetingIdea.syncEdgeInsets();
      }
    }
  });

  window.addEventListener("fleeting-idea-show", function () {
    if (PHONE_MQ.matches) {
      ensureFiMobileDock();
      if (window.FleetingIdea && window.FleetingIdea.syncEdgeInsets) {
        window.FleetingIdea.syncEdgeInsets();
      }
    }
  });

  window.addEventListener("fleeting-idea-hide", closeFiDrawers);
  document.addEventListener("click", onBackdropClose);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      setPhoneLayout();
      bindTabScroll();
      scrollActiveTabIntoView();
    });
  } else {
    setPhoneLayout();
    bindTabScroll();
    scrollActiveTabIntoView();
  }

  function showPhoneUrlBanner() {
    if (PHONE_MQ.matches) return;
    var h = (location.hostname || "").toLowerCase();
    if (h !== "localhost" && h !== "127.0.0.1") return;
    if ($("phone-url-banner")) return;

    fetch("/api/health", { cache: "no-store" })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (data) {
        var urls = data && data.lan_urls;
        if (!urls || !urls.length) return;
        var url = urls[0];
        var bar = document.createElement("p");
        bar.id = "phone-url-banner";
        bar.className = "phone-url-banner";
        bar.innerHTML =
          'On your phone (same Wi-Fi): <a href="' +
          url +
          '"><strong>' +
          url +
          "</strong></a> — not localhost.";
        var header = document.querySelector(".site-header .header-inner");
        if (header) header.appendChild(bar);
      })
      .catch(function () {});
  }

  window.MobileLayout = {
    isPhone: function () {
      return PHONE_MQ.matches;
    },
    closeFiDrawers: closeFiDrawers,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", showPhoneUrlBanner);
  } else {
    showPhoneUrlBanner();
  }
})();