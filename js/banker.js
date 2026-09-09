/**
 * Banker tab — supermarket 100 ledger (SIM cards, Luhn, encrypted vault).
 */
(function () {
  "use strict";

  var state = null;
  var reveal = false;

  function $(id) {
    return document.getElementById(id);
  }

  function esc(s) {
    var d = document.createElement("div");
    d.textContent = String(s == null ? "" : s);
    return d.innerHTML;
  }

  function money(n) {
    var x = Number(n) || 0;
    return (
      "$" +
      x.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    );
  }

  function groupPan(pan) {
    var d = String(pan || "").replace(/\D/g, "");
    if (d.length !== 16) return pan || "";
    return d.slice(0, 4) + " " + d.slice(4, 8) + " " + d.slice(8, 12) + " " + d.slice(12);
  }

  function maskPan(last4) {
    return "•••• •••• •••• " + String(last4 || "••••");
  }

  function fetchLedger() {
    return fetch("/api/banker?t=" + Date.now(), { cache: "no-store" })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (data) {
        if (data && data.ok !== false) {
          state = data;
          render();
        }
        return data;
      })
      .catch(function () {
        var body = $("bk-body");
        if (body) {
          body.innerHTML =
            '<tr><td colspan="8" class="bk-muted">Server offline — start start_server.bat</td></tr>';
        }
        return null;
      });
  }

  function personById(id) {
    var list = (state && state.people) || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  function renderYou() {
    var wrap = $("bk-you-card");
    if (!wrap || !state) return;
    var me = personById(100) || (state.people || []).filter(function (p) {
      return p.is_player;
    })[0];
    if (!me) {
      wrap.innerHTML = "";
      return;
    }
    function face(kind, card) {
      var pan = reveal && card.pan ? groupPan(card.pan) : maskPan(card.last4);
      var cvv = reveal && card.cvv ? esc(card.cvv) : "•••";
      return (
        '<div class="bk-card-face ' +
        kind +
        '"><div class="bk-chip" aria-hidden="true"></div>' +
        '<div class="bk-pan">' +
        esc(pan) +
        "</div>" +
        '<div class="bk-card-meta"><span>EXP ' +
        esc(card.exp_mm) +
        "/" +
        esc(card.exp_yy) +
        "</span><span>CVV " +
        cvv +
        "</span><span>IIN " +
        esc(card.iin) +
        "</span></div>" +
        '<div class="bk-card-name">' +
        esc(me.full_name) +
        " · " +
        kind.toUpperCase() +
        " · " +
        (kind === "debit" ? money(card.balance_usd) : "LINE " + money(card.line_usd)) +
        "</div></div>"
      );
    }
    wrap.innerHTML =
      '<h3 style="margin:0 0 0.45rem;color:#dcc888;font-size:0.95rem">Your lines — Logan Sevin (paired with ' +
      esc(me.partner_name) +
      ")</h3>" +
      '<div class="bk-plastic">' +
      face("debit", me.debit || {}) +
      face("credit", me.credit || {}) +
      "</div>";
  }

  function renderTable() {
    var body = $("bk-body");
    if (!body || !state) return;
    var q = String(($("bk-search") && $("bk-search").value) || "")
      .trim()
      .toLowerCase();
    var rows = (state.people || []).filter(function (p) {
      if (!q) return true;
      var blob = [
        p.id,
        p.full_name,
        p.first,
        p.last,
        p.gender,
        p.partner_name,
        p.partner_id,
      ]
        .join(" ")
        .toLowerCase();
      return blob.indexOf(q) >= 0;
    });
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="8" class="bk-muted">No matches</td></tr>';
      return;
    }
    body.innerHTML = rows
      .map(function (p) {
        var d = p.debit || {};
        var c = p.credit || {};
        var panD = reveal && d.pan ? groupPan(d.pan) : maskPan(d.last4);
        var panC = reveal && c.pan ? groupPan(c.pan) : maskPan(c.last4);
        var cvvD = reveal && d.cvv ? d.cvv : "•••";
        var cvvC = reveal && c.cvv ? c.cvv : "•••";
        var luhn =
          d.luhn_ok && c.luhn_ok
            ? '<span class="bk-ok">mod 10 ✓</span>'
            : '<span class="bk-bad">fail</span>';
        var gcls = p.gender === "female" ? "bk-f" : "bk-m";
        return (
          '<tr class="' +
          (p.is_player ? "bk-you-row" : "") +
          '"><td>' +
          esc(p.id) +
          '</td><td>' +
          esc(p.full_name) +
          (p.is_player ? " <span class=\"bk-muted\">(you)</span>" : "") +
          '</td><td class="' +
          gcls +
          '">' +
          esc(p.gender) +
          "</td><td>#" +
          esc(p.partner_id) +
          " " +
          esc(p.partner_name) +
          "</td><td>" +
          money(p.possession_usd) +
          '</td><td class="bk-mono">' +
          esc(panD) +
          "<br>exp " +
          esc(d.exp_mm) +
          "/" +
          esc(d.exp_yy) +
          " · cvv " +
          esc(cvvD) +
          "<br>" +
          money(d.balance_usd) +
          '</td><td class="bk-mono">' +
          esc(panC) +
          "<br>exp " +
          esc(c.exp_mm) +
          "/" +
          esc(c.exp_yy) +
          " · cvv " +
          esc(cvvC) +
          "<br>line " +
          money(c.line_usd) +
          "</td><td>" +
          luhn +
          "</td></tr>"
        );
      })
      .join("");
  }

  function render() {
    if (!state) return;
    var set = function (id, t) {
      var el = $(id);
      if (el) el.textContent = t;
    };
    set("bk-sim-rev", money(state.sim_month_revenue_usd));
    set("bk-share", money(state.share_each_usd));
    var me = personById(100);
    set("bk-you-bal", money(me && me.possession_usd));
    renderYou();
    renderTable();
  }

  function init() {
    if (!$("panel-banker")) return;
    var rev = $("bk-reveal");
    if (rev) {
      rev.addEventListener("change", function () {
        reveal = !!rev.checked;
        render();
      });
    }
    var search = $("bk-search");
    if (search) {
      search.addEventListener("input", function () {
        renderTable();
      });
    }
    $("bk-refresh") &&
      $("bk-refresh").addEventListener("click", function () {
        fetchLedger();
      });
    window.addEventListener("tab-changed", function (e) {
      if (e.detail && e.detail.tab === "banker") fetchLedger();
    });
    fetchLedger();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.Banker = {
    refresh: fetchLedger,
    getState: function () {
      return state;
    },
  };
})();
