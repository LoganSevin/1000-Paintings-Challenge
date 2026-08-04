/**
 * Market desk — simulated sales volumetrics, price gauging for marketing,
 * and paper real-time stock trading. Never handles payment credentials.
 */
(function () {
  "use strict";

  var state = null;
  var pollTimer = null;
  var selectedSymbol = "ART-PNT";

  function $(id) {
    return document.getElementById(id);
  }

  function esc(s) {
    var d = document.createElement("div");
    d.textContent = String(s == null ? "" : s);
    return d.innerHTML;
  }

  function money(n, digits) {
    var x = Number(n) || 0;
    if (digits == null) digits = x >= 100 || x === Math.floor(x) ? 0 : 2;
    return "$" + x.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }

  function pct(n) {
    var x = Number(n) || 0;
    var sign = x > 0 ? "+" : "";
    return sign + x.toFixed(2) + "%";
  }

  function sparkSvg(values, up) {
    var vals = (values || []).map(Number).filter(function (v) {
      return isFinite(v);
    });
    if (vals.length < 2) return "";
    var min = Math.min.apply(null, vals);
    var max = Math.max.apply(null, vals);
    var span = max - min || 1;
    var w = 72;
    var h = 28;
    var pts = vals
      .map(function (v, i) {
        var x = (i / (vals.length - 1)) * w;
        var y = h - ((v - min) / span) * (h - 2) - 1;
        return x.toFixed(1) + "," + y.toFixed(1);
      })
      .join(" ");
    var color = up ? "#6ecf8a" : "#e88a8a";
    return (
      '<svg class="mk-spark" viewBox="0 0 ' +
      w +
      " " +
      h +
      '" width="72" height="28" aria-hidden="true"><polyline fill="none" stroke="' +
      color +
      '" stroke-width="1.5" points="' +
      pts +
      '"/></svg>'
    );
  }

  function fetchMarket(opts) {
    opts = opts || {};
    var url = "/api/market?t=" + Date.now();
    var p;
    if (opts.burst) {
      p = fetch("/api/market/tick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force_sales: opts.burst }),
      }).then(function (r) {
        return r.json();
      });
    } else {
      p = fetch(url, { cache: "no-store" }).then(function (r) {
        return r.ok ? r.json() : null;
      });
    }
    return p
      .then(function (data) {
        if (data && data.ok !== false) {
          state = data;
          render();
          if (window.GalleryShop && GalleryShop.applyGaugedPrices && data.gauged_prices) {
            GalleryShop.applyGaugedPrices(data.gauged_prices);
          }
        }
        return data;
      })
      .catch(function () {
        return null;
      });
  }

  function trade(side) {
    var qtyEl = $("mk-qty");
    var qty = parseFloat(qtyEl && qtyEl.value) || 1;
    var status = $("mk-trade-status");
    if (status) {
      status.textContent = "Sending paper " + side + "…";
      status.hidden = false;
    }
    return fetch("/api/market/trade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol: selectedSymbol, side: side, qty: qty }),
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (data && data.ok) {
          state = data;
          render();
          if (status) status.textContent = "Paper " + side + " filled @ " + money(data.last_trade && data.last_trade.price, 2);
        } else if (status) {
          status.textContent = (data && data.error) || "Trade failed";
        }
      })
      .catch(function () {
        if (status) status.textContent = "Server offline — start gallery server";
      });
  }

  function renderVolumetrics() {
    var v = (state && state.volumetrics) || {};
    var set = function (id, text) {
      var el = $(id);
      if (el) el.textContent = text;
    };
    set("mk-sim-rev", money(v.sim_month_revenue_usd));
    set("mk-sim-pieces", String(v.sim_pieces_sold || 0));
    set("mk-velocity", (Number(v.velocity_per_min) || 0).toFixed(1) + "/min");
    set("mk-real-rev", money(v.real_month_sales_usd));
    set("mk-goal", money(v.monthly_goal_usd));
    set("mk-sim-pct", (v.sim_progress_pct || 0) + "% sim");
    var bar = $("mk-goal-bar");
    if (bar) bar.style.width = Math.min(100, Number(v.sim_progress_pct) || 0) + "%";
    var bar2 = $("mk-combined-bar");
    if (bar2) bar2.style.width = Math.min(100, Number(v.combined_progress_pct) || 0) + "%";
  }

  function renderPortfolio() {
    var p = (state && state.portfolio) || {};
    var set = function (id, text) {
      var el = $(id);
      if (el) el.textContent = text;
    };
    set("mk-cash", money(p.paper_cash_usd, 2));
    set("mk-equity", money(p.equity_usd, 2));
    set("mk-total", money(p.total_usd, 2));
    var tbody = $("mk-holdings-body");
    if (!tbody) return;
    var rows = p.holdings || [];
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="mk-muted">No open paper positions</td></tr>';
      return;
    }
    tbody.innerHTML = rows
      .map(function (h) {
        var cls = (h.pnl_usd || 0) >= 0 ? "mk-up" : "mk-down";
        return (
          "<tr data-sym=\"" +
          esc(h.symbol) +
          "\"><td>" +
          esc(h.symbol) +
          "</td><td>" +
          esc(h.qty) +
          "</td><td>" +
          money(h.price, 2) +
          '</td><td class="' +
          cls +
          '">' +
          money(h.pnl_usd, 2) +
          "</td><td>" +
          money(h.market_value, 2) +
          "</td></tr>"
        );
      })
      .join("");
    tbody.querySelectorAll("tr[data-sym]").forEach(function (tr) {
      tr.addEventListener("click", function () {
        selectedSymbol = tr.getAttribute("data-sym");
        renderBooks();
      });
    });
  }

  function renderBooks() {
    var list = $("mk-book-list");
    if (!list || !state) return;
    var symbols = state.symbols || [];
    list.innerHTML = symbols
      .map(function (s) {
        var up = (s.change_pct || 0) >= 0;
        var live = s.live_quote ? '<span class="mk-live">LIVE</span>' : s.kind === "art" ? '<span class="mk-art">ART</span>' : '<span class="mk-sim">SIM</span>';
        var sel = s.symbol === selectedSymbol ? " mk-row-selected" : "";
        return (
          '<button type="button" class="mk-row' +
          sel +
          '" data-sym="' +
          esc(s.symbol) +
          '">' +
          '<span class="mk-sym">' +
          esc(s.symbol) +
          " " +
          live +
          '</span><span class="mk-name">' +
          esc(s.name) +
          '</span><span class="mk-px">' +
          money(s.price, s.price < 50 ? 2 : 2) +
          '</span><span class="mk-chg ' +
          (up ? "mk-up" : "mk-down") +
          '">' +
          pct(s.change_pct) +
          "</span>" +
          sparkSvg(s.spark, up) +
          '<span class="mk-heat" title="Heat">🔥' +
          Math.round(s.heat || 0) +
          "</span></button>"
        );
      })
      .join("");
    list.querySelectorAll("[data-sym]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        selectedSymbol = btn.getAttribute("data-sym");
        renderBooks();
        renderGauges();
      });
    });
    var selLabel = $("mk-selected");
    if (selLabel) selLabel.textContent = selectedSymbol;
  }

  function renderGauges() {
    var wrap = $("mk-gauges");
    if (!wrap || !state) return;
    var prices = state.gauged_prices || {};
    var keys = Object.keys(prices);
    wrap.innerHTML = keys
      .map(function (k) {
        var g = prices[k];
        var prem = Number(g.premium_pct) || 0;
        var cls = prem >= 0 ? "mk-up" : "mk-down";
        var width = Math.min(100, Math.abs(prem) * 2.5 + 20);
        return (
          '<div class="mk-gauge-card">' +
          "<header><strong>" +
          esc(k) +
          "</strong> <span class=\"mk-muted\">" +
          esc(g.symbol || "") +
          "</span></header>" +
          '<div class="mk-gauge-prices"><span class="mk-base">' +
          money(g.base_usd) +
          ' base</span><span class="mk-gauged">' +
          money(g.gauged_usd) +
          " live</span></div>" +
          '<div class="mk-gauge-bar"><i class="' +
          cls +
          '" style="width:' +
          width +
          '%"></i></div>' +
          '<div class="mk-gauge-meta"><span class="' +
          cls +
          '">' +
          pct(prem) +
          " gauge</span><span>heat " +
          esc(g.heat) +
          "</span></div>" +
          (g.hook ? '<p class="mk-hook">' + esc(g.hook) + "</p>" : "") +
          "</div>"
        );
      })
      .join("");
  }

  function renderFeed() {
    var feed = $("mk-sales-feed");
    if (!feed || !state) return;
    var sales = state.sim_sales || [];
    if (!sales.length) {
      feed.innerHTML = '<li class="mk-muted">Waiting for simulated volume…</li>';
      return;
    }
    feed.innerHTML = sales
      .map(function (s) {
        return (
          "<li><span class=\"mk-badge-sim\">SIM</span> " +
          esc(s.collection) +
          " · <strong>" +
          money(s.price_usd) +
          "</strong> · " +
          esc(s.hook || "volume") +
          ' <time class="mk-muted">' +
          esc(String(s.at || "").replace("T", " ").replace("Z", "")) +
          "</time></li>"
        );
      })
      .join("");
  }

  function renderTrades() {
    var el = $("mk-trade-feed");
    if (!el || !state) return;
    var logs = state.trade_log || [];
    if (!logs.length) {
      el.innerHTML = '<li class="mk-muted">No paper trades yet</li>';
      return;
    }
    el.innerHTML = logs
      .map(function (t) {
        return (
          "<li><span class=\"mk-badge-paper\">PAPER</span> " +
          esc(t.side).toUpperCase() +
          " " +
          esc(t.qty) +
          " " +
          esc(t.symbol) +
          " @ " +
          money(t.price, 2) +
          "</li>"
        );
      })
      .join("");
  }

  function render() {
    if (!state) return;
    renderVolumetrics();
    renderPortfolio();
    renderBooks();
    renderGauges();
    renderFeed();
    renderTrades();
  }

  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(function () {
      var panel = $("panel-market");
      if (panel && !panel.hidden) fetchMarket();
    }, 4000);
  }

  function bind() {
    $("mk-burst") &&
      $("mk-burst").addEventListener("click", function () {
        fetchMarket({ burst: 12 });
      });
    $("mk-refresh") &&
      $("mk-refresh").addEventListener("click", function () {
        fetchMarket();
      });
    $("mk-buy") &&
      $("mk-buy").addEventListener("click", function () {
        trade("buy");
      });
    $("mk-sell") &&
      $("mk-sell").addEventListener("click", function () {
        trade("sell");
      });
    $("mk-reset") &&
      $("mk-reset").addEventListener("click", function () {
        fetch("/api/market/reset-paper", { method: "POST" })
          .then(function (r) {
            return r.json();
          })
          .then(function (data) {
            if (data) {
              state = data;
              render();
            }
          });
      });
    window.addEventListener("tab-changed", function (e) {
      if (e.detail && e.detail.tab === "market") fetchMarket();
    });
  }

  function init() {
    if (!$("panel-market")) return;
    bind();
    fetchMarket();
    startPolling();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.MarketDesk = {
    refresh: fetchMarket,
    getState: function () {
      return state;
    },
  };
})();
