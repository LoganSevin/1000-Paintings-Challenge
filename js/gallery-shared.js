/**
 * Single source for Gallery + Spellforge: manifest, analyses, painting URLs.
 */
(function () {
  var MANIFEST_URL = "data/manifest.json";
  var ANALYSES_URL = "data/analyses.json";

  var manifest = [];
  var analyses = {};
  var byNumber = {};
  var loadPromise = null;
  var analyzedNumsCache = null;

  function resetAnalyzedIndex() {
    analyzedNumsCache = null;
  }

  function getGalleryAnalysis(num) {
    var n = parseInt(num, 10);
    if (!n || n < 1) return null;
    return analyses[String(n)] || analyses[n] || null;
  }

  /** Lazy index of painting numbers that have analysis entries (built once per load). */
  function getAnalyzedPaintingNumbers() {
    if (analyzedNumsCache) return analyzedNumsCache;
    if (!analyses || !Object.keys(analyses).length) return [];
    analyzedNumsCache = Object.keys(analyses)
      .map(function (k) {
        return parseInt(k, 10);
      })
      .filter(function (n) {
        return n >= 1;
      });
    return analyzedNumsCache;
  }

  function indexManifest(list) {
    manifest = list || [];
    byNumber = {};
    for (var i = 0; i < manifest.length; i++) {
      byNumber[manifest[i].number] = manifest[i];
    }
    window.galleryManifest = manifest;
    window.galleryManifestByNumber = byNumber;
    window.galleryAnalyses = analyses;
  }

  function getPaintingUrl(num) {
    var n = parseInt(num, 10);
    if (!n || n < 1) return "";
    var item = byNumber[n];
    var file = item && item.filename ? item.filename : n + ".jpg";
    try {
      return new URL("paintings/" + file, window.location.href).href;
    } catch (err) {
      return "paintings/" + file;
    }
  }

  function loadGalleryData() {
    if (loadPromise) return loadPromise;
    loadPromise = fetch(MANIFEST_URL)
      .then(function (res) {
        if (!res.ok) throw new Error("Could not load " + MANIFEST_URL);
        return res.json();
      })
      .then(function (m) {
        indexManifest(m);
        return fetch(ANALYSES_URL).catch(function () {
          return null;
        }).then(function (res) {
          if (res && res.ok) {
            return res.json().then(function (a) {
              var data = a || {};
              analyses = data;
              resetAnalyzedIndex();
              window.galleryAnalyses = analyses;
              window.dispatchEvent(new Event("gallery-data-ready"));
              return { manifest: manifest, analyses: analyses };
            });
          }
          resetAnalyzedIndex();
          window.dispatchEvent(new Event("gallery-data-ready"));
          return { manifest: manifest, analyses: analyses };
        });
      });
    return loadPromise;
  }

  function normalizePaintingNumber(num) {
    if (num == null || num === "") return null;
    var n = parseInt(num, 10);
    return !isNaN(n) && n >= 1 ? n : null;
  }

  /** Digits-only query (optional #). */
  function parsePaintingNumberQuery(query) {
    var q = String(query || "").trim();
    if (!q) return null;
    var m = q.match(/^#?\s*(\d+)\s*$/);
    if (!m) return null;
    var n = parseInt(m[1], 10);
    return n >= 1 ? n : null;
  }

  function numericQueryDigits(query) {
    var q = String(query || "").trim();
    var m = q.match(/^#?\s*(\d+)\s*$/);
    return m ? m[1] : null;
  }

  function paintingNumbersEqual(a, b) {
    var na = normalizePaintingNumber(a);
    var nb = normalizePaintingNumber(b);
    return na != null && nb != null && na === nb;
  }

  /**
   * Tiered number search — results unlock as you type more digits:
   * 1 → #1–#9 · 10 → #10–#99 · 100 → #100–#999 · 1000 → #1000+
   * Narrower queries (15, 150) stay within that tier via prefix.
   */
  function paintingMatchesNumericQuery(num, query) {
    var digits = numericQueryDigits(query);
    if (!digits) return false;
    var n = normalizePaintingNumber(num);
    if (n == null) return false;
    var k = digits.length;
    var p = parseInt(digits, 10);
    var floor = k === 1 ? 1 : Math.pow(10, k - 1);
    var ceiling = Math.pow(10, k);
    if (n < floor || n >= ceiling) return false;
    if (p === floor) return true;
    return String(n).indexOf(digits) === 0;
  }

  function paintingNumericSearchRank(num, query) {
    var digits = numericQueryDigits(query);
    var n = normalizePaintingNumber(num);
    if (!digits || n == null) return 2;
    var p = parseInt(digits, 10);
    if (n === p) return 0;
    return 1;
  }

  function isPrimaryNumericSearchHit(num, query) {
    var digits = numericQueryDigits(query);
    if (!digits) return false;
    var n = normalizePaintingNumber(num);
    if (n == null) return false;
    return n === parseInt(digits, 10);
  }

  function buildMetadataSearchText(a) {
    if (!a) return "";
    return [
      a.title,
      a.description,
      a.style,
      a.medium,
      a.mood,
    ]
      .concat(a.tags || [], a.colors || [])
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
  }

  function paintingMatchesSearch(num, a, query) {
    var q = String(query || "").trim();
    if (!q) return true;
    if (numericQueryDigits(q) != null) {
      return paintingMatchesNumericQuery(num, q);
    }
    return buildMetadataSearchText(a).indexOf(q.toLowerCase()) >= 0;
  }

  function escapeAttr(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;");
  }

  /** Same thumb markup as Gallery cards — safe inside #spell-picker via scoped CSS */
  function paintingThumbHtml(num, eager) {
    var url = getPaintingUrl(num);
    var loading = eager ? "eager" : "lazy";
    return (
      '<div class="card-thumb">' +
      '<img src="' +
      escapeAttr(url) +
      '" alt="Painting ' +
      num +
      '" loading="' +
      loading +
      '" width="400" height="400" />' +
      "</div>"
    );
  }

  window.normalizePaintingNumber = normalizePaintingNumber;
  window.parsePaintingNumberQuery = parsePaintingNumberQuery;
  window.numericQueryDigits = numericQueryDigits;
  window.paintingNumbersEqual = paintingNumbersEqual;
  window.paintingMatchesNumericQuery = paintingMatchesNumericQuery;
  window.paintingNumericSearchRank = paintingNumericSearchRank;
  window.isPrimaryNumericSearchHit = isPrimaryNumericSearchHit;
  window.buildMetadataSearchText = buildMetadataSearchText;
  window.paintingMatchesSearch = paintingMatchesSearch;
  window.getPaintingUrl = getPaintingUrl;
  window.loadGalleryData = loadGalleryData;
  window.getGalleryManifest = function () {
    return manifest;
  };
  window.getGalleryAnalyses = function () {
    return analyses;
  };
  window.getGalleryAnalysis = getGalleryAnalysis;
  window.getAnalyzedPaintingNumbers = getAnalyzedPaintingNumbers;
  window.ensureGalleryData = loadGalleryData;
  window.galleryPaintingThumbHtml = paintingThumbHtml;

  /** Parse fetch Response as JSON; clear error when server returns HTML (404 page, no API). */
  window.parseGalleryApiResponse = function (res) {
    return res.text().then(function (text) {
      var trimmed = (text || "").trim();
      if (!trimmed || trimmed.charAt(0) === "<") {
        throw new Error(
          "Server returned HTML instead of JSON. Restart start_server.bat, then hard-refresh " +
            "(Ctrl+Shift+R). Open http://localhost:8765/#animate — not file:// or a static host."
        );
      }
      try {
        return JSON.parse(trimmed);
      } catch (e) {
        throw new Error(
          "Invalid server response. Restart start_server.bat and hard-refresh the gallery page."
        );
      }
    });
  };
})();