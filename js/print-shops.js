(function () {
  "use strict";

  var KEY = "print-shops:urls";
  var cfg = {
    etsy_shop_url: "",
    redbubble_shop_url: "",
    default_price_usd: 45,
    listing_limit: 24,
  };

  function $(id) {
    return document.getElementById(id);
  }

  function generatedUrl(n) {
    if (typeof window.generatedUrl === "function") return window.generatedUrl(n);
    return "https://l7in-generated.netlify.app/" + n + ".jpg";
  }

  function loadCfg() {
    fetch("data/print-shops.json", { cache: "no-store" })
      .then(function (r) {
        return r.ok ? r.json() : {};
      })
      .then(function (d) {
        cfg = Object.assign(cfg, d || {});
        try {
          var saved = JSON.parse(localStorage.getItem(KEY) || "{}");
          if (saved.etsy_shop_url) cfg.etsy_shop_url = saved.etsy_shop_url;
          if (saved.redbubble_shop_url) cfg.redbubble_shop_url = saved.redbubble_shop_url;
        } catch (e) {}
        fillFields();
      })
      .catch(function () {
        fillFields();
      });
  }

  function fillFields() {
    var et = $("ps-etsy-url");
    var rb = $("ps-rb-url");
    if (et) et.value = cfg.etsy_shop_url || "";
    if (rb) rb.value = cfg.redbubble_shop_url || "";
    var aE = $("ps-open-etsy-shop");
    var aR = $("ps-open-rb-shop");
    if (aE) {
      aE.href = cfg.etsy_shop_url || cfg.etsy_open || "https://www.etsy.com/sell";
      aE.textContent = cfg.etsy_shop_url ? "Open my Etsy shop" : "Create Etsy shop";
    }
    if (aR) {
      aR.href = cfg.redbubble_shop_url || cfg.redbubble_open || "https://www.redbubble.com/portfolio/images/new";
      aR.textContent = cfg.redbubble_shop_url ? "Open my Redbubble" : "Upload to Redbubble";
    }
  }

  function saveUrls() {
    var et = $("ps-etsy-url");
    var rb = $("ps-rb-url");
    cfg.etsy_shop_url = et ? et.value.trim() : "";
    cfg.redbubble_shop_url = rb ? rb.value.trim() : "";
    try {
      localStorage.setItem(
        KEY,
        JSON.stringify({
          etsy_shop_url: cfg.etsy_shop_url,
          redbubble_shop_url: cfg.redbubble_shop_url,
        })
      );
    } catch (e) {}
    fillFields();
  }

  function csvEscape(s) {
    var t = String(s == null ? "" : s).replace(/"/g, '""');
    return '"' + t + '"';
  }

  function listingFromAnalysis(id, a) {
    var n = a.number || parseInt(id, 10);
    var title = (a.title || "Untitled") + " — Logan Sevin 1000 Paintings G#" + n;
    if (title.length > 140) title = title.slice(0, 137) + "…";
    var tags = (a.tags || []).concat(["logan sevin", "1000 paintings", "surreal art", "digital painting"]).slice(0, 13);
    var desc = [
      a.title || "Original artwork",
      "",
      a.description || "",
      "",
      "Original digital painting by Logan Sevin (logan7in.art), from the 1000 Paintings Challenge. Piece G#" +
        n +
        (a.style ? ". Style: " + a.style : "") +
        (a.mood ? ". Mood: " + a.mood : "") +
        ".",
      "",
      "Prints and merch listed on Etsy and Redbubble. Full gallery: https://logan7in.art",
      "Cash App $Logan7in",
    ].join("\n");
    return {
      n: n,
      title: title,
      description: desc,
      tags: tags.join(","),
      image: generatedUrl(n),
      price: cfg.default_price_usd || 45,
    };
  }

  function download(name, body, type) {
    var blob = new Blob([body], { type: type || "text/plain" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 800);
  }

  function exportEtsyCsv() {
    var status = $("ps-status");
    if (status) status.textContent = "Building Etsy listing CSV…";
    fetch("data/lod1-analyses.json", { cache: "default" })
      .then(function (r) {
        return r.json();
      })
      .then(function (map) {
        var keys = Object.keys(map).sort(function (a, b) {
          return parseInt(a, 10) - parseInt(b, 10);
        });
        var limit = cfg.listing_limit || 24;
        var rows = [
          [
            "TITLE",
            "DESCRIPTION",
            "PRICE",
            "CURRENCY_CODE",
            "QUANTITY",
            "TAGS",
            "MATERIALS",
            "IMAGE1",
            "TYPE",
            "WHO_MADE",
            "WHEN_MADE",
          ].join(","),
        ];
        var i;
        for (i = 0; i < keys.length && rows.length - 1 < limit; i++) {
          var L = listingFromAnalysis(keys[i], map[keys[i]] || {});
          rows.push(
            [
              csvEscape(L.title),
              csvEscape(L.description),
              L.price,
              "USD",
              99,
              csvEscape(L.tags),
              csvEscape("digital print, archival ink"),
              csvEscape(L.image),
              "physical",
              "i_did",
              "made_to_order",
            ].join(",")
          );
        }
        download("logan-sevin-etsy-listings.csv", rows.join("\n"), "text/csv");
        if (status) {
          status.textContent =
            "Downloaded " +
            (rows.length - 1) +
            " Etsy drafts. Open your Etsy shop → Listings → import, or paste titles from the CSV. Then paste your shop URL below.";
        }
      })
      .catch(function () {
        if (status) status.textContent = "Could not load analyses to build listings.";
      });
  }

  function exportRedbubbleTxt() {
    var status = $("ps-status");
    if (status) status.textContent = "Building Redbubble copy pack…";
    fetch("data/lod1-analyses.json", { cache: "default" })
      .then(function (r) {
        return r.json();
      })
      .then(function (map) {
        var keys = Object.keys(map).sort(function (a, b) {
          return parseInt(a, 10) - parseInt(b, 10);
        });
        var limit = cfg.listing_limit || 24;
        var lines = [
          "Logan Sevin — Redbubble listing pack",
          "Upload each IMAGE url as a new work at https://www.redbubble.com/portfolio/images/new",
          "Shop: " + (cfg.redbubble_shop_url || "(paste your shop URL after you create it)"),
          "",
        ];
        var i;
        for (i = 0; i < keys.length && i < limit; i++) {
          var L = listingFromAnalysis(keys[i], map[keys[i]] || {});
          lines.push("===== G#" + L.n + " =====");
          lines.push("TITLE: " + L.title);
          lines.push("TAGS: " + L.tags);
          lines.push("IMAGE: " + L.image);
          lines.push("DESCRIPTION:");
          lines.push(L.description);
          lines.push("");
        }
        download("logan-sevin-redbubble-listings.txt", lines.join("\n"), "text/plain");
        if (status) {
          status.textContent =
            "Downloaded Redbubble copy for " +
            Math.min(limit, keys.length) +
            " pieces. Upload each image, paste title/tags/description.";
        }
      })
      .catch(function () {
        if (status) status.textContent = "Could not load analyses.";
      });
  }

  function bind() {
    var save = $("ps-save-urls");
    if (save) save.addEventListener("click", saveUrls);
    var et = $("ps-etsy-url");
    var rb = $("ps-rb-url");
    if (et) et.addEventListener("change", saveUrls);
    if (rb) rb.addEventListener("change", saveUrls);
    var csv = $("ps-export-etsy");
    if (csv) csv.addEventListener("click", exportEtsyCsv);
    var txt = $("ps-export-rb");
    if (txt) txt.addEventListener("click", exportRedbubbleTxt);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      bind();
      loadCfg();
    });
  } else {
    bind();
    loadCfg();
  }
})();
