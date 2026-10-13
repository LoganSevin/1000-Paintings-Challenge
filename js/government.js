/**
 * Government — plain-language US civics guide + USAJOBS search (opens usajobs.gov).
 * No API keys, no network calls: the job form just builds a usajobs.gov search URL.
 */
(function () {
  "use strict";

  function $(id) {
    return document.getElementById(id);
  }

  function buildUrl(k, l) {
    var p = [];
    if (k) p.push("k=" + encodeURIComponent(k));
    if (l) p.push("l=" + encodeURIComponent(l));
    return "https://www.usajobs.gov/search/results/" + (p.length ? "?" + p.join("&") : "");
  }

  function init() {
    var form = $("gov-jobs-form");
    if (!form) return;
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var k = String($("gov-jobs-k").value || "").trim();
      var l = String($("gov-jobs-l").value || "").trim();
      var url = buildUrl(k, l);
      var w = window.open(url, "_blank", "noopener");
      if (!w) window.location.href = url;
    });
    var quick = document.querySelectorAll("#panel-government [data-gov-k]");
    for (var i = 0; i < quick.length; i++) {
      quick[i].addEventListener("click", function (ev) {
        $("gov-jobs-k").value = ev.currentTarget.getAttribute("data-gov-k");
        $("gov-jobs-k").focus();
      });
    }
    window.dispatchEvent(new Event("government-ready"));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
