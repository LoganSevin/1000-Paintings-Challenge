(function () {
  "use strict";

  var STORE = "logan7in-keys-v1";
  var DEFAULT_SPEND = 0.08;

  function $(id) {
    return document.getElementById(id);
  }

  function money(n) {
    var v = Number(n);
    if (isNaN(v)) v = 0;
    return "$" + v.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  }

  function requiredOf(spend) {
    var s = Number(spend);
    if (!(s > 0)) s = DEFAULT_SPEND;
    var r = Math.round(s * 80) / 100;
    if (r >= s) r = s - 0.0001;
    if (r <= 0) r = s / 2;
    return r;
  }

  function mask(key) {
    var k = String(key || "");
    if (k.length < 10) return "••••";
    return k.slice(0, 4) + "…" + k.slice(-4);
  }

  function loadKeys() {
    try {
      var raw = JSON.parse(localStorage.getItem(STORE) || "[]");
      return Array.isArray(raw) ? raw : [];
    } catch (e) {
      return [];
    }
  }

  function saveKeys(rows) {
    try {
      localStorage.setItem(STORE, JSON.stringify(rows));
    } catch (e) {}
  }

  function canGo(row) {
    return Number(row.balance) > Number(row.required);
  }

  function paint() {
    var host = $("ky-list");
    if (!host) return;
    var rows = loadKeys();
    host.innerHTML = "";
    if (!rows.length) {
      var empty = document.createElement("p");
      empty.className = "ky-lede";
      empty.textContent = "No keys yet. Add one below.";
      host.appendChild(empty);
      return;
    }
    rows.forEach(function (row, i) {
      var card = document.createElement("article");
      card.className = "ky-card";
      var h = document.createElement("h3");
      h.textContent = row.name || "Key " + (i + 1);
      var maskEl = document.createElement("p");
      maskEl.className = "ky-mask";
      maskEl.textContent = mask(row.key);
      var meta = document.createElement("div");
      meta.className = "ky-meta";
      meta.innerHTML =
        "<div><span>Spend value</span><strong>" +
        money(row.spend) +
        "</strong></div>" +
        "<div><span>Required (&lt; spend)</span><strong>" +
        money(row.required) +
        "</strong></div>" +
        "<div><span>Balance</span><strong>" +
        money(row.balance) +
        "</strong></div>";
      var status = document.createElement("p");
      status.className = "ky-status " + (canGo(row) ? "ok" : "need");
      status.textContent = canGo(row)
        ? "Balance is over required. This key can spend (balance > required, required < spend)."
        : "Need more value. Add enough to go over required. Required stays less than spend, never equal.";
      var rowEl = document.createElement("div");
      rowEl.className = "ky-row";
      var addIn = document.createElement("input");
      addIn.className = "ky-num";
      addIn.type = "number";
      addIn.min = "0.0001";
      addIn.step = "0.01";
      addIn.placeholder = "Add $";
      var addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "ky-btn accent";
      addBtn.textContent = "Add value";
      addBtn.addEventListener("click", function () {
        var n = Number(addIn.value);
        if (!(n > 0)) return;
        var all = loadKeys();
        all[i].balance = Number(all[i].balance || 0) + n;
        saveKeys(all);
        paint();
      });
      var useBtn = document.createElement("button");
      useBtn.type = "button";
      useBtn.className = "ky-btn";
      useBtn.textContent = "Use for cloud";
      useBtn.addEventListener("click", function () {
        if (window.AccountGate && window.AccountGate.getVisitorXaiKey != null) {
          try {
            localStorage.setItem(
              "l7in_xai_key_" + (((window.AccountGate.getUser && window.AccountGate.getUser()) || {}).sub || "anon"),
              row.key
            );
          } catch (e) {}
        }
        status.textContent = "Set as this browser’s cloud key.";
        status.className = "ky-status ok";
      });
      var delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "ky-btn";
      delBtn.textContent = "Remove";
      delBtn.addEventListener("click", function () {
        var all = loadKeys();
        all.splice(i, 1);
        saveKeys(all);
        paint();
      });
      rowEl.appendChild(addIn);
      rowEl.appendChild(addBtn);
      rowEl.appendChild(useBtn);
      rowEl.appendChild(delBtn);
      card.appendChild(h);
      card.appendChild(maskEl);
      card.appendChild(meta);
      card.appendChild(status);
      card.appendChild(rowEl);
      host.appendChild(card);
    });
  }

  function bind() {
    if (!$("panel-key")) return;
    var add = $("ky-add-btn");
    if (add) {
      add.addEventListener("click", function () {
        var name = ($("ky-name") && $("ky-name").value.trim()) || "";
        var key = ($("ky-secret") && $("ky-secret").value.trim()) || "";
        var spend = Number($("ky-spend") && $("ky-spend").value) || DEFAULT_SPEND;
        if (!key) return;
        if (!(spend > 0)) spend = DEFAULT_SPEND;
        var rows = loadKeys();
        rows.unshift({
          id: "k-" + Date.now().toString(36),
          name: name || "Key",
          key: key,
          spend: spend,
          required: requiredOf(spend),
          balance: 0,
          at: Date.now(),
        });
        saveKeys(rows);
        if ($("ky-secret")) $("ky-secret").value = "";
        paint();
      });
    }
    paint();
    window.addEventListener("tab-changed", function (e) {
      if (e.detail && e.detail.tab === "key") paint();
    });
  }

  window.KeyTab = { onShow: paint };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind);
  else bind();
})();
