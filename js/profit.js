(function () {
  "use strict";

  var CASH = "Logan7in";
  var SITE = "https://1000-l7in.netlify.app/";
  var X = "L7IN597";
  var BILLING = "https://console.x.ai/team/default/billing";

  var FIVERR_GIGS =
    "GIG 1 — Custom gallery still ($75+)\n" +
    "I paint original stills in my 1000 Paintings Challenge language. You send a brief. I deliver one still + 1 revision. Credit: Logan Sevin. Pay: Cash App $Logan7in before files.\n\n" +
    "GIG 2 — Character sheet ($120)\n" +
    "Named character, readable silhouette, commercial-ready. I do not sell 'AI art' as the author — the work is mine.\n\n" +
    "GIG 3 — Brand pack ($250)\n" +
    "Three stills locked to your brand colors / product. Logo lockup treatment. 5-day turnaround after payment.\n\n" +
    "Profile: 1000 Paintings Challenge · " + SITE + " · X @" + X;

  var PRESS =
    "Logan Sevin is a New Orleans-area painter running the 1000 Paintings Challenge: a living gallery of original stills, commercial pieces, and a public studio at " +
    SITE +
    ". He sells prints and commissions on Cash App $Logan7in and posts process on X @" +
    X +
    ".\n\nSuggested angle: a human-authored painting factory that also ships brand stills — not an anonymous model dump.\n\nPress kit: bio, cashtag, gallery URL, commission rates. Reply to lsevin71@gmail.com.";

  var PROPOSAL =
    "Hi — Logan Sevin here (1000 Paintings Challenge).\n\n" +
    "I take paid stills and brand packs. Typical:\n" +
    "• Custom still $75 (1 revision)\n" +
    "• Character $120\n" +
    "• Brand pack $250 / 3 stills\n" +
    "• Studio week $400\n\n" +
    "Gallery: " + SITE + "\n" +
    "Pay: Cash App $Logan7in (files after payment)\n" +
    "X: @" + X + "\n\n" +
    "Send the brief, deadline, and usage (personal / commercial). I’ll confirm price the same day.";

  function $(id) {
    return document.getElementById(id);
  }

  function cashLink(amount) {
    var n = Number(amount);
    if (n > 0) return "https://cash.app/$" + CASH + "/" + n;
    return "https://cash.app/$" + CASH;
  }

  function setStatus(id, text) {
    var el = $(id);
    if (el) el.textContent = text || "";
  }

  function copyText(text, statusId, ok) {
    var t = String(text || "");
    function done() {
      setStatus(statusId, ok || "Copied.");
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(t).then(done).catch(function () {
        window.prompt("Copy:", t);
        done();
      });
    }
    window.prompt("Copy:", t);
    done();
    return Promise.resolve();
  }

  function loadDesk() {
    return fetch("/api/profit/desk?t=" + Date.now(), { cache: "no-store" })
      .then(function (r) {
        return r.json();
      })
      .then(function (d) {
        if (!d || !d.ok) return d;
        var set = function (id, v) {
          var el = $(id);
          if (el) el.textContent = v;
        };
        set("pf-credits", d.credits_usd != null ? "$" + Number(d.credits_usd).toFixed(2) : "—");
        set("pf-subs", String(d.subscribers || 0));
        set("pf-sales", d.month_sales_usd != null ? "$" + Number(d.month_sales_usd).toFixed(0) : "$0");
        set("pf-threshold", "$" + Number((d.credits_cfg && d.credits_cfg.threshold_usd) || 8));
        set("pf-reload", "$" + Number((d.credits_cfg && d.credits_cfg.reload_usd) || 25));
        if (d.credits_low) setStatus("pf-credit-status", "Credits are low. Open xAI billing and turn on Auto top-up.");
        else setStatus("pf-credit-status", "Keep Auto top-up on in xAI Console so generation never dies mid-piece.");
        var box = $("pf-issue");
        if (box && d.issue) box.textContent = d.issue.title + "\n\n" + d.issue.body;
        return d;
      })
      .catch(function () {
        return null;
      });
  }

  function subscribe(email) {
    return fetch("/api/newsletter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email, source: "profit-tab" }),
    }).then(function (r) {
      return r.json();
    });
  }

  function saveCreditsCfg() {
    var th = Number(($("pf-th") && $("pf-th").value) || 8);
    var rel = Number(($("pf-rel") && $("pf-rel").value) || 25);
    return fetch("/api/profit/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credits: { threshold_usd: th, reload_usd: rel } }),
    }).then(function (r) {
      return r.json();
    });
  }

  function bind() {
    $("pf-copy-fiverr") &&
      $("pf-copy-fiverr").addEventListener("click", function () {
        copyText(FIVERR_GIGS, "pf-fiverr-status", "Fiverr gigs copied — paste into your Fiverr account.");
      });
    $("pf-copy-proposal") &&
      $("pf-copy-proposal").addEventListener("click", function () {
        copyText(PROPOSAL, "pf-prop-status", "Proposal copied.");
      });
    $("pf-copy-press") &&
      $("pf-copy-press").addEventListener("click", function () {
        copyText(PRESS, "pf-press-status", "Press kit copied.");
      });
    $("pf-copy-sub") &&
      $("pf-copy-sub").addEventListener("click", function () {
        copyText("https://1000-l7in.netlify.app/subscribe", "pf-nl-status", "Subscribe link copied.");
      });
    $("pf-open-billing") &&
      $("pf-open-billing").addEventListener("click", function () {
        window.open(BILLING, "_blank", "noopener,noreferrer");
      });
    $("pf-save-credits") &&
      $("pf-save-credits").addEventListener("click", function () {
        saveCreditsCfg().then(function () {
          setStatus("pf-credit-status", "Saved studio warning levels. Enable Auto top-up in the xAI tab that just needs your card.");
          loadDesk();
        });
      });
    $("pf-nl-form") &&
      $("pf-nl-form").addEventListener("submit", function (e) {
        e.preventDefault();
        var email = ($("pf-nl-email") && $("pf-nl-email").value) || "";
        subscribe(email)
          .then(function (d) {
            setStatus("pf-nl-join", d && d.ok ? "You’re on the list." : (d && d.error) || "Could not subscribe.");
            loadDesk();
          })
          .catch(function () {
            setStatus("pf-nl-join", "Server offline — email lsevin71@gmail.com with subject Subscribe.");
          });
      });
    document.querySelectorAll("[data-pf-cash]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        window.open(cashLink(btn.getAttribute("data-pf-cash")), "_blank", "noopener,noreferrer");
      });
    });
    window.addEventListener("profit-show", loadDesk);
    var siteForm = $("site-nl-form");
    if (siteForm) {
      siteForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var email = ($("site-nl-email") && $("site-nl-email").value) || "";
        subscribe(email)
          .then(function (d) {
            if (d && d.ok) siteForm.reset();
            alert(d && d.ok ? "You’re on Logan’s studio list." : (d && d.error) || "Could not subscribe.");
          })
          .catch(function () {
            window.location.href = "mailto:lsevin71@gmail.com?subject=" + encodeURIComponent("Subscribe 1000 Paintings") + "&body=" + encodeURIComponent(email);
          });
      });
    }
  }

  function init() {
    if (!$("panel-profit")) return;
    bind();
    loadDesk();
    var fiverr = $("pf-fiverr");
    if (fiverr) fiverr.textContent = FIVERR_GIGS;
    var prop = $("pf-proposal");
    if (prop) prop.textContent = PROPOSAL;
    var press = $("pf-press");
    if (press) press.textContent = PRESS;
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  window.ProfitDesk = { onShow: loadDesk, copyProposal: function () { return PROPOSAL; } };
})();
