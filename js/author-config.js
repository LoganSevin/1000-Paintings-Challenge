/**
 * Canonical authorship for the entire gallery.
 * All works: author & owner = Logan Sevin (human). Never attribute authorship to AI.
 */
(function (global) {
  "use strict";

  var AUTHOR = {
    version: 1,
    author: "Logan Sevin",
    legalName: "Logan Sevin",
    displayName: "Logan Sevin",
    role: "Human artist, author, and owner of all works in this gallery",
    project: "1000 Paintings Challenge",
    cashApp: "Logan7in",
    copyrightNotice: "© Logan Sevin. All rights reserved.",
    signedAt: "",
    ownershipStatement:
      "Every painting, still, vision, character, fighter, clip, and derivative work presented in this gallery is authored and owned by Logan Sevin. Studio tools may assist the process; they do not own the art. Attribution is always Logan Sevin — never an AI system as author.",
    attributionLine: "Art by Logan Sevin",
    creditShort: "Logan Sevin",
  };

  global.GALLERY_AUTHOR = AUTHOR;
  global.GALLERY_ARTIST = AUTHOR.author;

  function applyDomCredits() {
    var metaAuthor = document.querySelector('meta[name="author"]');
    if (metaAuthor) metaAuthor.setAttribute("content", AUTHOR.author);

    var els = document.querySelectorAll("[data-gallery-author]");
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var mode = (el.getAttribute("data-gallery-author") || "name").toLowerCase();
      if (mode === "copyright") el.textContent = AUTHOR.copyrightNotice;
      else if (mode === "attribution") el.textContent = AUTHOR.attributionLine;
      else if (mode === "ownership") el.textContent = AUTHOR.ownershipStatement;
      else if (mode === "project") el.textContent = AUTHOR.project + " · " + AUTHOR.attributionLine;
      else el.textContent = AUTHOR.author;
    }

    var footerMeta = document.querySelector(".site-footer-meta");
    if (footerMeta && footerMeta.getAttribute("data-author-applied") !== "1") {
      footerMeta.setAttribute("data-author-applied", "1");
      var base = footerMeta.textContent || "";
      if (base.indexOf("Logan Sevin") < 0) {
        footerMeta.textContent =
          AUTHOR.attributionLine +
          " · " +
          AUTHOR.copyrightNotice +
          " · " +
          AUTHOR.project;
      }
    }
  }

  /** Standard credit string for exports, watermarks, social posts. */
  function creditLine(opts) {
    opts = opts || {};
    if (opts.short) return AUTHOR.creditShort;
    if (opts.copyright) return AUTHOR.copyrightNotice;
    return AUTHOR.attributionLine;
  }

  function applyAtomicStamp(payload) {
    var year = payload && payload.year;
    var stamp = payload && payload.stamp;
    if (year) {
      AUTHOR.copyrightNotice = "© " + year + " Logan Sevin. All rights reserved.";
    }
    if (stamp) AUTHOR.signedAt = stamp;
    if (payload && payload.signature) AUTHOR.signatureLine = payload.signature;
    applyDomCredits();
  }

  function browserTimeZone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    } catch (e) {
      return "";
    }
  }

  function pad2(n) {
    n = Math.floor(Math.abs(Number(n) || 0));
    return n < 10 ? "0" + n : String(n);
  }

  function syncAtomicClock() {
    var tz = browserTimeZone();
    var url = "/api/atomic-time";
    try {
      if (typeof global.galleryApiUrl === "function") url = global.galleryApiUrl(url);
    } catch (e) {}
    if (tz) url += (url.indexOf("?") >= 0 ? "&" : "?") + "tz=" + encodeURIComponent(tz);
    return fetch(url, { cache: "no-store" })
      .then(function (r) {
        return r.ok ? r.json() : Promise.reject();
      })
      .then(function (d) {
        if (d && d.ok) applyAtomicStamp(d);
        return d;
      })
      .catch(function () {
        var d = new Date();
        var months = [
          "January",
          "February",
          "March",
          "April",
          "May",
          "June",
          "July",
          "August",
          "September",
          "October",
          "November",
          "December",
        ];
        var tz = "";
        try {
          tz = d.toLocaleTimeString(undefined, { timeZoneName: "short" }).split(" ").pop() || "";
        } catch (e2) {
          tz = "";
        }
        applyAtomicStamp({
          year: d.getFullYear(),
          stamp:
            d.getDate() +
            " " +
            months[d.getMonth()] +
            " " +
            d.getFullYear() +
            "  " +
            pad2(d.getHours()) +
            ":" +
            pad2(d.getMinutes()) +
            ":" +
            pad2(d.getSeconds()) +
            (tz ? " " + tz : ""),
        });
      });
  }

  global.galleryAuthorCredit = creditLine;
  global.galleryAuthorApply = applyDomCredits;
  global.galleryAtomicStamp = function () {
    return AUTHOR.signedAt || "";
  };
  global.gallerySyncAtomicClock = syncAtomicClock;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      applyDomCredits();
      syncAtomicClock();
    });
  } else {
    applyDomCredits();
    syncAtomicClock();
  }
})(typeof window !== "undefined" ? window : globalThis);
