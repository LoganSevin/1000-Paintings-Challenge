/**
 * Logan7in unlimited — studio license, not an xAI product.
 * xAI still meters their cloud. This site does not pass that meter through as a usage cap.
 */
(function () {
  "use strict";

  window.Logan7inUnlimited = {
    name: "Logan7in unlimited",
    prepaid: Infinity,
    monthly: Infinity,
    lifetime: true,
    siteCap: false,
  };

  if (window.SPELLFORGE_LOCAL_FALLBACK_ON_CREDITS !== false) {
    window.SPELLFORGE_LOCAL_FALLBACK_ON_CREDITS = true;
  }

  function ensureBadge() {
    if (document.getElementById("logan7in-unlimited")) return;
    var el = document.createElement("a");
    el.id = "logan7in-unlimited";
    el.className = "logan7in-unlimited";
    el.href = "#api";
    el.title = "Logan7in unlimited — studio use is uncapped for life. xAI’s vendor meter is not a door.";
    el.textContent = "Logan7in unlimited";
    document.body.appendChild(el);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ensureBadge);
  } else {
    ensureBadge();
  }
})();
