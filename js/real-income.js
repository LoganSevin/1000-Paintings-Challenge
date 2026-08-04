/**
 * Real income desk — Cash App only (spendable for rent/gas/food).
 * Simulated Market money is never mixed in.
 */
(function () {
  "use strict";

  var state = null;

  function $(id) {
    return document.getElementById(id);
  }

  function money(n) {
    var x = Number(n) || 0;
    return "$" + x.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  function esc(s) {
    var d = document.createElement("div");
    d.textContent = String(s == null ? "" : s);
    return d.innerHTML;
  }

  function fetchSummary() {
    return fetch("/api/real-income?t=" + Date.now(), { cache: "no-store" })
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
        return null;
      });
  }

  function postEntry(payload) {
    return fetch("/api/real-income", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).then(function (r) {
      return r.json();
    });
  }

  function setStatus(msg, isErr) {
    var el = $("ri-status");
    if (!el) return;
    el.hidden = !msg;
    el.textContent = msg || "";
    el.classList.toggle("ri-status-err", !!isErr);
  }

  function render() {
    if (!state) return;
    var inc = state.income || {};
    var life = state.life_needs || {};
    var spent = (state.spent && state.spent.by_category_usd) || {};
    var goals = state.budget_goals_usd || {};

    var set = function (id, text) {
      var el = $(id);
      if (el) el.textContent = text;
    };

    set("ri-balance", money(state.balance_usd));
    set("ri-month-income", money(inc.month_total_usd));
    set("ri-month-shop", money(inc.month_shop_usd));
    set("ri-month-logged", money(inc.month_logged_usd));
    set("ri-all-income", money(inc.total_all_time_usd));
    set("ri-month-spent", money((state.spent && state.spent.month_total_usd) || 0));
    set("ri-goal", money(state.monthly_revenue_goal_usd));
    set("ri-progress", (state.month_progress_pct || 0) + "%");

    var bar = $("ri-goal-bar");
    if (bar) bar.style.width = Math.min(100, Number(state.month_progress_pct) || 0) + "%";

    var cash = state.cash_app || "Logan7in";
    document.querySelectorAll("[data-ri-cashtag]").forEach(function (el) {
      el.textContent = "$" + cash;
      if (el.tagName === "A") el.href = "https://cash.app/$" + cash;
    });

    ["rent", "food", "gas"].forEach(function (cat) {
      var row = life[cat] || {};
      set("ri-" + cat + "-goal", money(row.goal_usd));
      set("ri-" + cat + "-spent", money(row.spent_usd));
      set("ri-" + cat + "-left", money(row.remaining_usd));
      var b = $("ri-" + cat + "-bar");
      if (b) {
        var g = Number(row.goal_usd) || 1;
        var pct = Math.min(100, Math.round(((Number(row.spent_usd) || 0) / g) * 100));
        b.style.width = pct + "%";
      }
      var goalInput = $("ri-goal-" + cat);
      if (goalInput && goals[cat] != null) goalInput.value = goals[cat];
    });

    var how = $("ri-how-list");
    if (how && Array.isArray(state.how_to_spend_in_real_world)) {
      how.innerHTML = state.how_to_spend_in_real_world
        .map(function (line) {
          return "<li>" + esc(line) + "</li>";
        })
        .join("");
    }

    var feed = $("ri-ledger");
    if (feed) {
      var entries = state.entries || [];
      if (!entries.length) {
        feed.innerHTML =
          '<li class="ri-muted">No real Cash App entries yet. When money lands in Cash App, log income below — or complete a gallery cart sale after the buyer pays.</li>';
      } else {
        feed.innerHTML = entries
          .map(function (e) {
            var cls = e.kind === "income" ? "ri-up" : "ri-down";
            var sign = e.kind === "income" ? "+" : "−";
            return (
              "<li><span class=\"" +
              cls +
              '">' +
              sign +
              money(e.amount_usd) +
              "</span> · " +
              esc(e.kind) +
              " / " +
              esc(e.category) +
              (e.note ? " — " + esc(e.note) : "") +
              ' <time class="ri-muted">' +
              esc(String(e.at || "").replace("T", " ").replace("Z", "")) +
              "</time></li>"
            );
          })
          .join("");
      }
    }

    var disc = $("ri-disclaimer");
    if (disc && state.disclaimer) disc.textContent = state.disclaimer;
  }

  function bind() {
    $("ri-refresh") &&
      $("ri-refresh").addEventListener("click", function () {
        fetchSummary();
      });

    $("ri-log-income") &&
      $("ri-log-income").addEventListener("click", function () {
        var amt = parseFloat(($("ri-income-amt") && $("ri-income-amt").value) || 0);
        var cat = ($("ri-income-cat") && $("ri-income-cat").value) || "sales";
        var note = ($("ri-income-note") && $("ri-income-note").value) || "";
        if (!(amt > 0)) {
          setStatus("Enter a real amount that already landed in Cash App.", true);
          return;
        }
        setStatus("Logging real income…");
        postEntry({
          action: "add",
          kind: "income",
          amount_usd: amt,
          category: cat,
          note: note,
        })
          .then(function (data) {
            if (data && data.ok) {
              state = data;
              render();
              setStatus("Logged +" + money(amt) + " real Cash App income. Use Cash App to transfer/spend.");
              if ($("ri-income-amt")) $("ri-income-amt").value = "";
            } else {
              setStatus((data && data.error) || "Failed — is the gallery server running?", true);
            }
          })
          .catch(function () {
            setStatus("Server offline. Run start_server.bat", true);
          });
      });

    $("ri-log-spend") &&
      $("ri-log-spend").addEventListener("click", function () {
        var amt = parseFloat(($("ri-spend-amt") && $("ri-spend-amt").value) || 0);
        var cat = ($("ri-spend-cat") && $("ri-spend-cat").value) || "other";
        var note = ($("ri-spend-note") && $("ri-spend-note").value) || "";
        if (!(amt > 0)) {
          setStatus("Enter what you spent from Cash App / bank.", true);
          return;
        }
        setStatus("Logging real spend…");
        postEntry({
          action: "add",
          kind: "spend",
          amount_usd: amt,
          category: cat,
          note: note,
        })
          .then(function (data) {
            if (data && data.ok) {
              state = data;
              render();
              setStatus("Logged −" + money(amt) + " toward " + cat + ".");
              if ($("ri-spend-amt")) $("ri-spend-amt").value = "";
            } else {
              setStatus((data && data.error) || "Failed", true);
            }
          })
          .catch(function () {
            setStatus("Server offline. Run start_server.bat", true);
          });
      });

    $("ri-save-goals") &&
      $("ri-save-goals").addEventListener("click", function () {
        var goals = {
          rent: parseFloat(($("ri-goal-rent") && $("ri-goal-rent").value) || 0) || 0,
          food: parseFloat(($("ri-goal-food") && $("ri-goal-food").value) || 0) || 0,
          gas: parseFloat(($("ri-goal-gas") && $("ri-goal-gas").value) || 0) || 0,
        };
        postEntry({ action: "set_goals", budget_goals_usd: goals })
          .then(function (data) {
            if (data && data.ok) {
              state = data;
              render();
              setStatus("Budget goals saved.");
            }
          })
          .catch(function () {
            setStatus("Could not save goals", true);
          });
      });

    $("ri-open-shop") &&
      $("ri-open-shop").addEventListener("click", function () {
        if (window.GalleryShop && GalleryShop.openCheckout) GalleryShop.openCheckout();
        else {
          var cart = $("gallery-cart-btn");
          if (cart) cart.click();
        }
      });

    $("ri-open-cashapp") &&
      $("ri-open-cashapp").addEventListener("click", function () {
        var tag = (state && state.cash_app) || "Logan7in";
        window.open("https://cash.app/$" + tag, "_blank", "noopener,noreferrer");
      });

    window.addEventListener("tab-changed", function (e) {
      if (e.detail && e.detail.tab === "income") fetchSummary();
    });
    window.addEventListener("gallery-sales-update", function () {
      if ($("panel-income") && !$("panel-income").hidden) fetchSummary();
    });
  }

  function init() {
    if (!$("panel-income")) return;
    bind();
    fetchSummary();
    setInterval(function () {
      var p = $("panel-income");
      if (p && !p.hidden) fetchSummary();
    }, 20000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.RealIncome = { refresh: fetchSummary };
})();
