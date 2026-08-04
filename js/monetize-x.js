/**
 * Monetize with X + public tip/sales links.
 * Fans tip Logan via Cash App. You post on X — you do not tip yourself.
 */
(function () {
  "use strict";

  var DEFAULTS = {
    cash_app: "Logan7in",
    artist_name:
      (typeof window !== "undefined" && window.GALLERY_AUTHOR && window.GALLERY_AUTHOR.author) ||
      "Logan Sevin",
    public_url: "https://1000-l7in.netlify.app/",
    x_handle: "",
    tip_presets_usd: [5, 10, 25, 50],
  };

  var cfg = Object.assign({}, DEFAULTS);

  function $(id) {
    return document.getElementById(id);
  }

  function cashTag() {
    return String(cfg.cash_app || DEFAULTS.cash_app).replace(/^\$/, "").trim() || DEFAULTS.cash_app;
  }

  function siteUrl() {
    // Free public share URL — never localhost (fans can't open that).
    var u = (cfg.public_url || DEFAULTS.public_url || "").trim();
    if (!u || /localhost|127\.0\.0\.1/i.test(u)) {
      u = DEFAULTS.public_url;
    }
    // If the visitor is already on a public host (Netlify free subdomain), share that.
    try {
      if (typeof location !== "undefined" && location.hostname) {
        var h = String(location.hostname).toLowerCase();
        if (/netlify\.app$/i.test(h) || /github\.io$/i.test(h) || /pages\.dev$/i.test(h)) {
          u = location.protocol + "//" + location.host + "/";
        }
      }
    } catch (e) {}
    if (!u.endsWith("/")) u += "/";
    return u;
  }

  function cashAppTipUrl(amount) {
    var n = Math.max(1, Math.round(Number(amount) || 5));
    return "https://cash.app/$" + cashTag() + "/" + n;
  }

  function cashAppHomeUrl() {
    return "https://cash.app/$" + cashTag();
  }

  function xIntentUrl(text, url) {
    var t = encodeURIComponent(text);
    var u = url ? "&url=" + encodeURIComponent(url) : "";
    return "https://twitter.com/intent/tweet?text=" + t + u;
  }

  function postTemplates() {
    var name = cfg.artist_name || "Logan Sevin";
    var site = siteUrl();
    var cash = cashAppHomeUrl();
    var tag = "$" + cashTag();
    return [
      {
        id: "tip",
        label: "Ask for tips",
        text:
          "Support my 1000 Paintings Challenge — tip " +
          name +
          " on Cash App " +
          tag +
          " " +
          cash +
          " · gallery " +
          site +
          " #art #painting #CashApp",
      },
      {
        id: "sale",
        label: "Sell a piece",
        text:
          "Original art for sale from my 1000 Paintings Challenge. Browse & buy → " +
          site +
          " · pay " +
          tag +
          " " +
          cash +
          " #artforsale #painting",
      },
      {
        id: "print",
        label: "Prints / commissions",
        text:
          "Commissions & prints open. DM or tip/buy via Cash App " +
          tag +
          " · full gallery " +
          site +
          " · " +
          name +
          " #commission #artist",
      },
      {
        id: "daily",
        label: "Daily grind",
        text:
          "Painting daily toward 1000. Fuel the next canvas — Cash App " +
          tag +
          " or shop " +
          site +
          " 🎨 " +
          name,
      },
      {
        id: "rent",
        label: "Honest hustle",
        text:
          "Independent artist covering rent with real sales — not simulated. Support " +
          name +
          ": " +
          cash +
          " · art " +
          site +
          " #supportartists",
      },
    ];
  }

  function pulse(el) {
    if (!el) return;
    el.classList.remove("mx-pulse");
    void el.offsetWidth;
    el.classList.add("mx-pulse");
    setTimeout(function () {
      el.classList.remove("mx-pulse");
    }, 900);
  }

  function setStatus(msg, isErr) {
    var el = $("mx-status");
    if (!el) return;
    el.hidden = !msg;
    el.textContent = msg || "";
    el.classList.toggle("mx-status-err", !!isErr);
    if (msg) pulse(el);
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () {
        return true;
      }).catch(function () {
        return false;
      });
    }
    return Promise.resolve(false);
  }

  function openX(text) {
    var url = xIntentUrl(text);
    window.open(url, "_blank", "noopener,noreferrer");
    setStatus("X compose opened — post it so fans can tip you. You do not tip yourself.");
    pulse($("mx-desk"));
    if (window.RealIncome && RealIncome.refresh) {
      /* no-op income; motion only */
    }
  }

  function renderTemplates() {
    var wrap = $("mx-templates");
    if (!wrap) return;
    var list = postTemplates();
    wrap.innerHTML = "";
    list.forEach(function (t) {
      var card = document.createElement("div");
      card.className = "mx-template-card";
      card.innerHTML =
        "<strong>" +
        t.label +
        '</strong><p class="mx-template-text"></p><div class="mx-template-actions"></div>';
      card.querySelector(".mx-template-text").textContent = t.text;
      var actions = card.querySelector(".mx-template-actions");
      var postBtn = document.createElement("button");
      postBtn.type = "button";
      postBtn.className = "btn-primary mx-btn-x";
      postBtn.textContent = "Post on X";
      postBtn.addEventListener("click", function () {
        openX(t.text);
      });
      var copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "btn-secondary";
      copyBtn.textContent = "Copy";
      copyBtn.addEventListener("click", function () {
        copyText(t.text).then(function (ok) {
          setStatus(ok ? "Copied — paste into X or anywhere." : "Select & copy manually.");
          pulse(card);
        });
      });
      actions.appendChild(postBtn);
      actions.appendChild(copyBtn);
      wrap.appendChild(card);
    });
  }

  function renderFanTipButtons() {
    var wrap = $("mx-fan-tips");
    if (!wrap) return;
    wrap.innerHTML = "";
    var presets = cfg.tip_presets_usd || DEFAULTS.tip_presets_usd;
    presets.forEach(function (amt) {
      var a = document.createElement("a");
      a.className = "btn-primary mx-fan-tip-btn";
      a.href = cashAppTipUrl(amt);
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = "Tip $" + amt;
      a.addEventListener("click", function () {
        pulse(a);
        setStatus("Opening Cash App for a fan tip to $" + cashTag() + " — not a self-tip.");
      });
      wrap.appendChild(a);
    });
    var open = document.createElement("a");
    open.className = "btn-secondary mx-fan-tip-btn";
    open.href = cashAppHomeUrl();
    open.target = "_blank";
    open.rel = "noopener noreferrer";
    open.textContent = "Cash App $" + cashTag();
    wrap.appendChild(open);
  }

  function updateLabels() {
    var tag = "$" + cashTag();
    document.querySelectorAll("[data-mx-cashtag]").forEach(function (el) {
      el.textContent = tag;
      if (el.tagName === "A") el.href = cashAppHomeUrl();
    });
    document.querySelectorAll("[data-mx-site]").forEach(function (el) {
      el.textContent = siteUrl();
      if (el.tagName === "A") el.href = siteUrl();
    });
    var qr = $("mx-cash-link");
    if (qr) qr.href = cashAppHomeUrl();
  }

  function loadConfig() {
    return fetch("/data/public-site.json?t=" + Date.now(), { cache: "no-store" })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (site) {
        if (site && site.public_url) cfg.public_url = String(site.public_url);
        if (site && site.cash_app) cfg.cash_app = String(site.cash_app).replace(/^\$/, "");
        return fetch("/api/payment-config?t=" + Date.now(), { cache: "no-store" });
      })
      .then(function (r) {
        return r && r.ok ? r.json() : null;
      })
      .then(function (d) {
        if (d && typeof d === "object") {
          if (d.cash_app) cfg.cash_app = String(d.cash_app).replace(/^\$/, "");
          if (d.public_url) cfg.public_url = d.public_url;
          if (d.x_handle) cfg.x_handle = String(d.x_handle).replace(/^@/, "");
          if (d.tip_presets_usd) cfg.tip_presets_usd = d.tip_presets_usd;
          if (d.creator_payout && d.creator_payout.name) cfg.artist_name = d.creator_payout.name;
          if (d.business_name && !cfg.artist_name) cfg.artist_name = d.business_name;
        }
        updateLabels();
        renderTemplates();
        renderFanTipButtons();
        return cfg;
      })
      .catch(function () {
        updateLabels();
        renderTemplates();
        renderFanTipButtons();
        return cfg;
      });
  }

  function bind() {
    $("mx-post-tip") &&
      $("mx-post-tip").addEventListener("click", function () {
        openX(postTemplates()[0].text);
      });
    $("mx-post-sale") &&
      $("mx-post-sale").addEventListener("click", function () {
        openX(postTemplates()[1].text);
      });
    $("mx-copy-tip-link") &&
      $("mx-copy-tip-link").addEventListener("click", function () {
        var link = cashAppTipUrl(10);
        copyText(link).then(function (ok) {
          setStatus(
            ok
              ? "Tip link copied (" + link + "). Send to fans on X, texts, bio — they tip you."
              : link
          );
          pulse($("mx-copy-tip-link"));
        });
      });
    $("mx-copy-gallery") &&
      $("mx-copy-gallery").addEventListener("click", function () {
        copyText(siteUrl()).then(function (ok) {
          setStatus(ok ? "Free gallery link copied for X / bio." : siteUrl());
        });
      });
    $("mx-copy-free-link") &&
      $("mx-copy-free-link").addEventListener("click", function () {
        copyText(siteUrl()).then(function (ok) {
          setStatus(
            ok
              ? "Copied free link: " + siteUrl() + " — paste anywhere. No domain purchase needed."
              : siteUrl()
          );
          pulse($("mx-copy-free-link"));
        });
      });
    $("mx-copy-free-spellforge") &&
      $("mx-copy-free-spellforge").addEventListener("click", function () {
        var u = siteUrl().replace(/\/?$/, "/") + "#spellforge";
        copyText(u).then(function (ok) {
          setStatus(ok ? "Copied Spellforge link: " + u : u);
        });
      });
    $("mx-open-cash") &&
      $("mx-open-cash").addEventListener("click", function () {
        window.open(cashAppHomeUrl(), "_blank", "noopener,noreferrer");
        setStatus("Your Cash App — check for fan payments. Do not send yourself money.");
      });

    // HUD: Tip → monetize desk (share), not self-tip loop
    var hudTip = $("money-hud-tip");
    if (hudTip) {
      hudTip.title = "Share tip jar on X — fans pay you";
      hudTip.textContent = "Get paid";
      hudTip.addEventListener(
        "click",
        function (e) {
          e.preventDefault();
          e.stopImmediatePropagation();
          var tab = document.querySelector('.site-tabs .tab[data-tab="income"]');
          if (tab) tab.click();
          setTimeout(function () {
            var desk = $("mx-desk");
            if (desk) {
              desk.scrollIntoView({ behavior: "smooth", block: "center" });
              pulse(desk);
            }
          }, 200);
          setStatus("Share a tip post on X. Fans tip you — you never tip yourself.");
        },
        true
      );
    }

    window.addEventListener("tab-changed", function (ev) {
      if (ev.detail && ev.detail.tab === "income") {
        loadConfig();
        pulse($("mx-desk"));
      }
    });
  }

  function init() {
    bind();
    loadConfig();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.MonetizeX = {
    openX: openX,
    cashAppTipUrl: cashAppTipUrl,
    siteUrl: siteUrl,
    postTemplates: postTemplates,
    reload: loadConfig,
  };
})();
