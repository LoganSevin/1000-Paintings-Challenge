/**
 * Grand Exchange — RuneScape-style 8-slot offer UI + Banker 100 SIM market.
 */
(function () {
  "use strict";

  var STORAGE = "gallery.grand-exchange.v2";
  var STORAGE_LEGACY = "gallery.grand-exchange.v1";
  var PLAYER_ID = 100;
  var MAX_SLOTS = 8;
  var NPC_TICK_MS = 2800;
  var GUIDE_BASE = 89;

  var state = null;
  var roster = [];
  var analyses = {};
  var selected = 1;
  var tickTimer = null;
  var tickN = 0;
  var view = "home"; // home | setup | pick | history
  var setupSide = "buy"; // buy | sell
  var setupSlot = 0;

  function $(id) {
    return document.getElementById(id);
  }

  function esc(s) {
    var d = document.createElement("div");
    d.textContent = String(s == null ? "" : s);
    return d.innerHTML;
  }

  function money(n) {
    var x = Math.round((Number(n) || 0) * 100) / 100;
    return (
      "$" +
      x.toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      })
    );
  }

  function uid() {
    return "ge_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  function thumb(n) {
    return "paintings/" + n + ".jpg";
  }

  function titleFor(n) {
    var a = analyses[String(n)];
    if (a && a.title) return a.title;
    return "Painting #" + n;
  }

  function descFor(n) {
    var a = analyses[String(n)];
    if (a && a.description) return String(a.description).slice(0, 90);
    return "A painting from the 1000 Paintings Challenge.";
  }

  function autoGuide(n) {
    n = Number(n) || 1;
    var x = (n * 9301 + 49297) % 233280;
    var jitter = (x / 233280) * 0.5 - 0.15;
    var g = GUIDE_BASE * (1 + jitter);
    if (n % 100 === 0) g *= 1.35;
    else if (n % 50 === 0) g *= 1.18;
    else if (n % 10 === 0) g *= 1.08;
    var mult = Number(state && state.guideMult) || 1;
    return Math.max(1, Math.round(g * mult));
  }

  function guidePrice(n) {
    n = Number(n);
    if (state && state.guideOverrides && state.guideOverrides[String(n)] != null) {
      return Math.max(1, Math.round(Number(state.guideOverrides[String(n)]) || 1));
    }
    return autoGuide(n);
  }

  function itemStats(n) {
    n = String(n);
    if (!state.itemStats) state.itemStats = {};
    if (!state.itemStats[n]) {
      state.itemStats[n] = { trades: 0, qty: 0, volume: 0, lastPrice: 0, lastAt: 0 };
    }
    return state.itemStats[n];
  }

  function recordTrade(h) {
    var st = itemStats(h.itemId);
    st.trades += 1;
    st.qty += Number(h.qty) || 0;
    st.volume += Number(h.total) || 0;
    st.lastPrice = Number(h.price) || 0;
    st.lastAt = h.at || Date.now();
  }

  function defaultState() {
    return {
      version: 2,
      cashDelta: {},
      inventory: {},
      offers: [],
      history: [],
      guideOverrides: {},
      guideMult: 1,
      itemStats: {},
      npcSeededOffers: false,
      _npcSeeded: false,
      createdAt: Date.now(),
    };
  }

  function migrate(s) {
    if (!s || typeof s !== "object") return defaultState();
    s.version = 2;
    s.cashDelta = s.cashDelta || {};
    s.inventory = s.inventory || {};
    s.offers = Array.isArray(s.offers) ? s.offers : [];
    s.history = Array.isArray(s.history) ? s.history : [];
    s.guideOverrides = s.guideOverrides || {};
    s.guideMult = Number(s.guideMult) || 1;
    s.itemStats = s.itemStats || {};
    if (!Object.keys(s.itemStats).length && s.history.length) {
      s.history.forEach(function (h) {
        recordTrade.call({ itemStats: s.itemStats }, h);
      });
      // fix: recordTrade uses state - rebuild manually
      s.itemStats = {};
      s.history.forEach(function (h) {
        var k = String(h.itemId);
        var st = s.itemStats[k] || { trades: 0, qty: 0, volume: 0, lastPrice: 0, lastAt: 0 };
        st.trades += 1;
        st.qty += Number(h.qty) || 0;
        st.volume += Number(h.total) || 0;
        st.lastPrice = Number(h.price) || 0;
        st.lastAt = h.at || 0;
        s.itemStats[k] = st;
      });
    }
    return s;
  }

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE) || localStorage.getItem(STORAGE_LEGACY);
      if (!raw) return defaultState();
      return migrate(JSON.parse(raw));
    } catch (e) {
      return defaultState();
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE, JSON.stringify(state));
    } catch (e) {}
  }

  function person(id) {
    id = Number(id);
    for (var i = 0; i < roster.length; i++) {
      if (Number(roster[i].id) === id) return roster[i];
    }
    return null;
  }

  function personName(id) {
    var p = person(id);
    if (p && p.full_name) return p.full_name;
    if (Number(id) === PLAYER_ID) return "Logan Sevin";
    return "Trader #" + id;
  }

  function baseCash(id) {
    var p = person(id);
    if (!p) return 50000;
    if (p.debit && p.debit.balance_usd != null) return Number(p.debit.balance_usd) || 0;
    return Number(p.possession_usd) || 0;
  }

  function cashOf(id) {
    id = String(id);
    return Math.max(0, baseCash(id) + (Number(state.cashDelta[id]) || 0));
  }

  function invOf(id) {
    id = String(id);
    if (!state.inventory[id]) state.inventory[id] = {};
    return state.inventory[id];
  }

  function qtyOf(id, itemId) {
    return Number(invOf(id)[String(itemId)]) || 0;
  }

  function addInv(id, itemId, delta) {
    var inv = invOf(id);
    var k = String(itemId);
    var next = (Number(inv[k]) || 0) + delta;
    if (next <= 0) delete inv[k];
    else inv[k] = next;
  }

  function addCash(id, delta) {
    id = String(id);
    state.cashDelta[id] = (Number(state.cashDelta[id]) || 0) + delta;
  }

  function activeOffers() {
    return state.offers.filter(function (o) {
      if (!o || o.cancelled) return false;
      if (o.isPlayer && o.complete) return true;
      return (Number(o.qtyLeft) || 0) > 0;
    });
  }

  function playerSlotOffers() {
    return state.offers.filter(function (o) {
      return o && o.isPlayer && !o.cancelled && (o.complete || (Number(o.qtyLeft) || 0) > 0);
    });
  }

  function ensurePlayerStock() {
    var inv = invOf(PLAYER_ID);
    if (Object.keys(inv).length) return;
    for (var n = 1; n <= 40; n++) inv[String(n)] = 1;
    for (var m = 50; m <= 1000; m += 25) inv[String(m)] = 1;
  }

  function ensureNpcSeedStock() {
    if (state._npcSeeded) return;
    state._npcSeeded = true;
    for (var i = 0; i < roster.length; i++) {
      var p = roster[i];
      if (!p || p.is_player || Number(p.id) === PLAYER_ID) continue;
      var inv = invOf(p.id);
      var count = 3 + (Number(p.id) % 5);
      for (var k = 0; k < count; k++) {
        var item = 1 + ((Number(p.id) * 17 + k * 97) % 1000);
        inv[String(item)] = (Number(inv[String(item)]) || 0) + 1;
      }
    }
  }

  function matchOffers() {
    var safety = 0;
    while (safety++ < 800) {
      var buys = activeOffers()
        .filter(function (o) {
          return o.side === "buy" && !o.complete && (Number(o.qtyLeft) || 0) > 0;
        })
        .sort(function (a, b) {
          return b.price - a.price || a.createdAt - b.createdAt;
        });
      var sells = activeOffers()
        .filter(function (o) {
          return o.side === "sell" && !o.complete && (Number(o.qtyLeft) || 0) > 0;
        })
        .sort(function (a, b) {
          return a.price - b.price || a.createdAt - b.createdAt;
        });

      var matched = false;
      for (var bi = 0; bi < buys.length && !matched; bi++) {
        var buy = buys[bi];
        for (var si = 0; si < sells.length; si++) {
          var sell = sells[si];
          if (String(buy.itemId) !== String(sell.itemId)) continue;
          if (Number(buy.traderId) === Number(sell.traderId)) continue;
          if (buy.price < sell.price) continue;
          var qty = Math.min(buy.qtyLeft, sell.qtyLeft);
          if (qty <= 0) continue;
          var px = sell.price;
          var total = qty * px;
          var refund = qty * (buy.price - px);
          if (refund) addCash(buy.traderId, refund);
          addCash(sell.traderId, total);
          addInv(buy.traderId, buy.itemId, qty);
          buy.qtyLeft -= qty;
          sell.qtyLeft -= qty;
          var h = {
            id: uid(),
            itemId: Number(buy.itemId),
            qty: qty,
            price: px,
            total: total,
            buyerId: buy.traderId,
            buyerName: buy.traderName,
            sellerId: sell.traderId,
            sellerName: sell.traderName,
            at: Date.now(),
          };
          state.history.unshift(h);
          if (state.history.length > 400) state.history.length = 400;
          recordTrade(h);
          if (buy.qtyLeft <= 0) {
            if (buy.isPlayer) buy.complete = true;
          }
          if (sell.qtyLeft <= 0) {
            if (sell.isPlayer) sell.complete = true;
          }
          matched = true;
          break;
        }
      }
      if (!matched) break;
    }
    // Drop finished NPC offers; keep completed player offers until collected
    state.offers = state.offers.filter(function (o) {
      if (!o || o.cancelled) return false;
      if (o.isPlayer && o.complete) return true;
      return (Number(o.qtyLeft) || 0) > 0;
    });
  }

  function placeOffer(opts) {
    var side = opts.side;
    var itemId = Number(opts.itemId);
    var qty = Math.max(1, Math.floor(Number(opts.qty) || 1));
    var price = Math.max(1, Math.floor(Number(opts.price) || 1));
    var traderId = Number(opts.traderId);
    var isPlayer = traderId === PLAYER_ID;
    var silent = !!opts.silent;

    if (isPlayer && playerSlotOffers().length >= MAX_SLOTS) {
      return { ok: false, error: "All " + MAX_SLOTS + " offer slots are full." };
    }
    if (side === "buy") {
      var need = qty * price;
      if (cashOf(traderId) < need) {
        return { ok: false, error: "Not enough SIM cash (need " + money(need) + ")." };
      }
      addCash(traderId, -need);
    } else {
      if (qtyOf(traderId, itemId) < qty) {
        return { ok: false, error: "Not enough stock of #" + itemId + "." };
      }
      addInv(traderId, itemId, -qty);
    }

    state.offers.push({
      id: uid(),
      side: side,
      itemId: itemId,
      qty: qty,
      qtyLeft: qty,
      price: price,
      traderId: traderId,
      traderName: personName(traderId),
      isPlayer: isPlayer,
      complete: false,
      createdAt: Date.now(),
      slot: isPlayer ? setupSlot : -1,
    });
    matchOffers();
    if (!silent) saveState();
    return { ok: true };
  }

  function cancelOffer(offerId) {
    var o = null;
    for (var i = 0; i < state.offers.length; i++) {
      if (state.offers[i].id === offerId) {
        o = state.offers[i];
        break;
      }
    }
    if (!o || o.cancelled) return;
    var left = Number(o.qtyLeft) || 0;
    if (!o.complete) {
      if (o.side === "buy") addCash(o.traderId, left * o.price);
      else addInv(o.traderId, o.itemId, left);
    }
    o.cancelled = true;
    o.qtyLeft = 0;
    o.complete = false;
    state.offers = state.offers.filter(function (x) {
      return x && !x.cancelled && ((x.isPlayer && x.complete) || (Number(x.qtyLeft) || 0) > 0);
    });
    saveState();
  }

  function collectOffer(offerId) {
    var o = null;
    for (var i = 0; i < state.offers.length; i++) {
      if (state.offers[i].id === offerId) {
        o = state.offers[i];
        break;
      }
    }
    if (!o || !o.isPlayer) return;
    // Settlement already applied during matches; collecting frees the slot.
    o.cancelled = true;
    o.complete = false;
    o.qtyLeft = 0;
    state.offers = state.offers.filter(function (x) {
      return x && !x.cancelled && ((x.isPlayer && x.complete) || (Number(x.qtyLeft) || 0) > 0);
    });
    saveState();
  }

  function collectAll() {
    playerSlotOffers()
      .filter(function (o) {
        return o.complete;
      })
      .forEach(function (o) {
        collectOffer(o.id);
      });
  }

  function seedNpcOffers() {
    if (state.npcSeededOffers) return;
    if (!roster.length) return;
    state.npcSeededOffers = true;
    var items = [];
    for (var n = 1; n <= 1000; n += 7) items.push(n);
    for (var i = 0; i < roster.length; i++) {
      var p = roster[i];
      if (!p || p.is_player || Number(p.id) === PLAYER_ID) continue;
      var item = items[(Number(p.id) * 3) % items.length];
      var g = guidePrice(item);
      if (qtyOf(p.id, item) < 2) addInv(p.id, item, 2);
      placeOffer({
        side: "sell",
        itemId: item,
        qty: 1,
        price: Math.max(1, Math.round(g * (1.02 + (Number(p.id) % 7) * 0.01))),
        traderId: p.id,
        silent: true,
      });
      placeOffer({
        side: "buy",
        itemId: item,
        qty: 1,
        price: Math.max(1, Math.round(g * (0.9 - (Number(p.id) % 5) * 0.01))),
        traderId: p.id,
        silent: true,
      });
    }
    saveState();
  }

  function npcTick() {
    if (!roster.length) return;
    tickN++;
    var actions = 2 + (tickN % 3);
    for (var a = 0; a < actions; a++) {
      var p = roster[Math.floor(Math.random() * roster.length)];
      if (!p || p.is_player || Number(p.id) === PLAYER_ID) continue;
      var roll = Math.random();
      if (roll < 0.18) {
        var mine = activeOffers().filter(function (o) {
          return Number(o.traderId) === Number(p.id) && !o.isPlayer;
        });
        if (mine.length) cancelOffer(mine[Math.floor(Math.random() * mine.length)].id);
        continue;
      }
      var item = 1 + Math.floor(Math.random() * 1000);
      var guide = guidePrice(item);
      var side = Math.random() < 0.5 ? "buy" : "sell";
      if (side === "sell" && qtyOf(p.id, item) < 1) {
        if (Math.random() < 0.5) addInv(p.id, item, 1);
        else side = "buy";
      }
      var qty = 1 + (Math.random() < 0.2 ? 1 : 0);
      var slip = side === "buy" ? 0.82 + Math.random() * 0.2 : 0.98 + Math.random() * 0.2;
      placeOffer({
        side: side,
        itemId: item,
        qty: qty,
        price: Math.max(1, Math.round(guide * slip)),
        traderId: p.id,
        silent: true,
      });
    }
    saveState();
    if (view === "home" || view === "history") render();
  }

  function setStatus(msg, isErr) {
    var el = $("ge-status");
    if (!el) return;
    el.textContent = msg || "";
    el.className = "ge-status" + (isErr ? " err" : "");
  }

  function showView(name) {
    view = name;
    ["ge-home", "ge-setup", "ge-pick", "ge-history"].forEach(function (id) {
      var el = $(id);
      if (!el) return;
      if (id === "ge-home") el.classList.toggle("hide", name !== "home");
      else el.classList.toggle("show", name === id.replace("ge-", ""));
    });
    // map setup/pick/history
    if ($("ge-setup")) $("ge-setup").classList.toggle("show", name === "setup");
    if ($("ge-pick")) $("ge-pick").classList.toggle("show", name === "pick");
    if ($("ge-history")) $("ge-history").classList.toggle("show", name === "history");
    if ($("ge-home")) $("ge-home").classList.toggle("hide", name !== "home");

    var ex = $("ge-tab-exchange");
    var hi = $("ge-tab-history");
    if (ex) ex.classList.toggle("active", name === "home" || name === "setup" || name === "pick");
    if (hi) hi.classList.toggle("active", name === "history");
  }

  function updateTotal() {
    var qty = Math.max(1, Number($("ge-qty") && $("ge-qty").value) || 1);
    var px = Math.max(1, Number($("ge-price") && $("ge-price").value) || 1);
    if ($("ge-total")) $("ge-total").textContent = "Total: " + money(qty * px);
  }

  function renderSlots() {
    var wrap = $("ge-slots");
    if (!wrap) return;
    var offers = playerSlotOffers();
    var html = [];
    for (var i = 0; i < MAX_SLOTS; i++) {
      var o = offers[i];
      if (!o) {
        html.push(
          '<div class="ge-slot" data-slot="' +
            i +
            '">' +
            '<div class="ge-slot-label">Empty</div>' +
            '<div class="ge-slot-empty-actions">' +
            '<button type="button" class="ge-slot-action buy" data-ge-empty-buy="' +
            i +
            '" title="Buy">⬇</button>' +
            '<button type="button" class="ge-slot-action sell" data-ge-empty-sell="' +
            i +
            '" title="Sell">⬆</button>' +
            "</div></div>"
        );
        continue;
      }
      var filled = o.qty - (Number(o.qtyLeft) || 0);
      var pct = o.complete ? 100 : Math.round((filled / Math.max(1, o.qty)) * 100);
      var progClass = o.side === "sell" ? "sell" : "";
      if (o.complete) progClass += " done";
      html.push(
        '<div class="ge-slot" data-offer="' +
          esc(o.id) +
          '">' +
          '<div class="ge-slot-label">' +
          (o.complete ? "Done — " : "") +
          (o.side === "buy" ? "Buy" : "Sell") +
          "</div>" +
          '<div class="ge-slot-row">' +
          '<img src="' +
          esc(thumb(o.itemId)) +
          '" alt="" />' +
          '<div class="ge-slot-meta">' +
          '<div class="name">' +
          esc(titleFor(o.itemId)) +
          "</div>" +
          '<div class="qty">' +
          filled +
          " / " +
          o.qty +
          "</div>" +
          '<div class="px">' +
          money(o.price) +
          " each</div>" +
          "</div></div>" +
          '<div class="ge-progress ' +
          progClass +
          '"><span style="width:' +
          pct +
          '%"></span></div>' +
          '<div class="ge-slot-foot">' +
          (o.complete
            ? '<button type="button" data-ge-collect="' + esc(o.id) + '">Collect</button>'
            : '<button type="button" data-ge-abort="' + esc(o.id) + '">Abort</button>') +
          "</div></div>"
      );
    }
    wrap.innerHTML = html.join("");
  }

  function renderSetup() {
    if ($("ge-setup-side")) $("ge-setup-side").textContent = setupSide === "buy" ? "Buy offer" : "Sell offer";
    if ($("ge-setup-slot-label")) $("ge-setup-slot-label").textContent = "Slot " + (setupSlot + 1);
    if ($("ge-setup-img")) $("ge-setup-img").src = thumb(selected);
    if ($("ge-setup-name")) $("ge-setup-name").textContent = titleFor(selected);
    if ($("ge-setup-desc")) $("ge-setup-desc").textContent = descFor(selected);
    if ($("ge-setup-guide")) {
      $("ge-setup-guide").textContent =
        "Guide price " + money(guidePrice(selected)) + " · you hold " + qtyOf(PLAYER_ID, selected);
    }
    if ($("ge-price") && document.activeElement !== $("ge-price")) {
      $("ge-price").value = String(guidePrice(selected));
    }
    updateTotal();
  }

  function renderCatalog() {
    var wrap = $("ge-catalog");
    var q = (($("ge-search") && $("ge-search").value) || "").trim().toLowerCase();
    if (!wrap) return;
    var html = [];
    var shown = 0;
    for (var n = 1; n <= 1000 && shown < 160; n++) {
      var title = titleFor(n);
      if (q && (title + " #" + n).toLowerCase().indexOf(q) === -1) continue;
      html.push(
        '<button type="button" class="ge-pick-item" data-ge-item="' +
          n +
          '"><img src="' +
          esc(thumb(n)) +
          '" alt="" loading="lazy" /><span>#' +
          n +
          " · " +
          money(guidePrice(n)) +
          "</span></button>"
      );
      shown++;
    }
    wrap.innerHTML = html.join("") || '<p class="ge-summary">No matches.</p>';
  }

  function renderHistory() {
    var body = $("ge-feed-body");
    if (body) {
      var mine = state.history.filter(function (h) {
        return Number(h.buyerId) === PLAYER_ID || Number(h.sellerId) === PLAYER_ID;
      });
      var rows = (mine.length ? mine : state.history).slice(0, 40);
      body.innerHTML = rows.length
        ? rows
            .map(function (h) {
              var side = Number(h.buyerId) === PLAYER_ID ? "BUY" : Number(h.sellerId) === PLAYER_ID ? "SELL" : "NPC";
              var other = side === "BUY" ? h.sellerName : side === "SELL" ? h.buyerName : h.buyerName + " / " + h.sellerName;
              return (
                "<tr><td>#" +
                h.itemId +
                "</td><td>" +
                side +
                "</td><td>" +
                h.qty +
                "</td><td>" +
                money(h.price) +
                "</td><td>" +
                esc(other) +
                "</td></tr>"
              );
            })
            .join("")
        : '<tr><td colspan="5">No trades yet.</td></tr>';
    }
    var top = $("ge-top-body");
    if (!top) return;
    var rows2 = Object.keys(state.itemStats || {})
      .map(function (k) {
        var st = state.itemStats[k];
        return { id: Number(k), trades: st.trades || 0, volume: st.volume || 0, lastPrice: st.lastPrice || 0 };
      })
      .filter(function (r) {
        return r.trades > 0;
      })
      .sort(function (a, b) {
        return b.trades - a.trades;
      })
      .slice(0, 15);
    top.innerHTML = rows2.length
      ? rows2
          .map(function (r) {
            return (
              "<tr><td>#" +
              r.id +
              "</td><td>" +
              r.trades +
              "</td><td>" +
              money(r.volume) +
              "</td><td>" +
              money(r.lastPrice) +
              "</td></tr>"
            );
          })
          .join("")
      : '<tr><td colspan="4">No piece stats yet.</td></tr>';
  }

  function render() {
    if ($("ge-you-cash")) $("ge-you-cash").textContent = money(cashOf(PLAYER_ID));
    if ($("ge-you-slots")) $("ge-you-slots").textContent = playerSlotOffers().length + " / " + MAX_SLOTS;
    if ($("ge-open")) $("ge-open").textContent = String(activeOffers().length);
    if ($("ge-tick")) $("ge-tick").textContent = "tick " + tickN;
    if (view === "home") renderSlots();
    if (view === "setup") renderSetup();
    if (view === "pick") renderCatalog();
    if (view === "history") renderHistory();
  }

  function openSetup(side, slot) {
    setupSide = side;
    setupSlot = slot;
    selected = selected || 1;
    if ($("ge-qty")) $("ge-qty").value = "1";
    if ($("ge-price")) $("ge-price").value = String(guidePrice(selected));
    showView("setup");
    renderSetup();
  }

  function bind() {
    if ($("ge-tab-exchange") && !$("ge-tab-exchange").dataset.bound) {
      $("ge-tab-exchange").dataset.bound = "1";
      $("ge-tab-exchange").addEventListener("click", function () {
        showView("home");
        render();
      });
    }
    if ($("ge-tab-history") && !$("ge-tab-history").dataset.bound) {
      $("ge-tab-history").dataset.bound = "1";
      $("ge-tab-history").addEventListener("click", function () {
        showView("history");
        render();
      });
    }
    var slots = $("ge-slots");
    if (slots && !slots.dataset.bound) {
      slots.dataset.bound = "1";
      slots.addEventListener("click", function (e) {
        var buy = e.target.closest("[data-ge-empty-buy]");
        var sell = e.target.closest("[data-ge-empty-sell]");
        var col = e.target.closest("[data-ge-collect]");
        var ab = e.target.closest("[data-ge-abort]");
        if (buy) openSetup("buy", Number(buy.getAttribute("data-ge-empty-buy")) || 0);
        else if (sell) openSetup("sell", Number(sell.getAttribute("data-ge-empty-sell")) || 0);
        else if (col) {
          collectOffer(col.getAttribute("data-ge-collect"));
          setStatus("Collected.");
          render();
        } else if (ab) {
          cancelOffer(ab.getAttribute("data-ge-abort"));
          setStatus("Offer aborted — reserved cash/stock returned.");
          render();
        }
      });
    }
    if ($("ge-choose-item") && !$("ge-choose-item").dataset.bound) {
      $("ge-choose-item").dataset.bound = "1";
      $("ge-choose-item").addEventListener("click", function () {
        showView("pick");
        renderCatalog();
      });
    }
    if ($("ge-pick-back") && !$("ge-pick-back").dataset.bound) {
      $("ge-pick-back").dataset.bound = "1";
      $("ge-pick-back").addEventListener("click", function () {
        showView("setup");
        renderSetup();
      });
    }
    if ($("ge-setup-back") && !$("ge-setup-back").dataset.bound) {
      $("ge-setup-back").dataset.bound = "1";
      $("ge-setup-back").addEventListener("click", function () {
        showView("home");
        render();
      });
    }
    var catalog = $("ge-catalog");
    if (catalog && !catalog.dataset.bound) {
      catalog.dataset.bound = "1";
      catalog.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-ge-item]");
        if (!btn) return;
        selected = Number(btn.getAttribute("data-ge-item")) || 1;
        if ($("ge-price")) $("ge-price").value = String(guidePrice(selected));
        showView("setup");
        renderSetup();
      });
    }
    if ($("ge-search") && !$("ge-search").dataset.bound) {
      $("ge-search").dataset.bound = "1";
      $("ge-search").addEventListener("input", renderCatalog);
    }
    document.querySelectorAll("[data-ge-qty]").forEach(function (btn) {
      if (btn.dataset.bound) return;
      btn.dataset.bound = "1";
      btn.addEventListener("click", function () {
        var d = Number(btn.getAttribute("data-ge-qty")) || 0;
        var el = $("ge-qty");
        if (!el) return;
        el.value = String(Math.max(1, (Number(el.value) || 1) + d));
        updateTotal();
      });
    });
    document.querySelectorAll("[data-ge-qty-set]").forEach(function (btn) {
      if (btn.dataset.bound) return;
      btn.dataset.bound = "1";
      btn.addEventListener("click", function () {
        var el = $("ge-qty");
        if (!el) return;
        el.value = String(Math.max(1, (Number(el.value) || 0) + (Number(btn.getAttribute("data-ge-qty-set")) || 0)));
        updateTotal();
      });
    });
    document.querySelectorAll("[data-ge-px]").forEach(function (btn) {
      if (btn.dataset.bound) return;
      btn.dataset.bound = "1";
      btn.addEventListener("click", function () {
        var d = Number(btn.getAttribute("data-ge-px")) || 0;
        var el = $("ge-price");
        if (!el) return;
        var step = Math.max(1, Math.round(guidePrice(selected) * 0.01));
        el.value = String(Math.max(1, (Number(el.value) || 1) + d * step));
        updateTotal();
      });
    });
    if ($("ge-px-guide") && !$("ge-px-guide").dataset.bound) {
      $("ge-px-guide").dataset.bound = "1";
      $("ge-px-guide").addEventListener("click", function () {
        if ($("ge-price")) $("ge-price").value = String(guidePrice(selected));
        updateTotal();
      });
    }
    if ($("ge-px-down") && !$("ge-px-down").dataset.bound) {
      $("ge-px-down").dataset.bound = "1";
      $("ge-px-down").addEventListener("click", function () {
        if ($("ge-price")) $("ge-price").value = String(Math.max(1, Math.round(guidePrice(selected) * 0.95)));
        updateTotal();
      });
    }
    if ($("ge-px-up") && !$("ge-px-up").dataset.bound) {
      $("ge-px-up").dataset.bound = "1";
      $("ge-px-up").addEventListener("click", function () {
        if ($("ge-price")) $("ge-price").value = String(Math.max(1, Math.round(guidePrice(selected) * 1.05)));
        updateTotal();
      });
    }
    ["ge-qty", "ge-price"].forEach(function (id) {
      var el = $(id);
      if (el && !el.dataset.bound) {
        el.dataset.bound = "1";
        el.addEventListener("input", updateTotal);
      }
    });
    if ($("ge-confirm") && !$("ge-confirm").dataset.bound) {
      $("ge-confirm").dataset.bound = "1";
      $("ge-confirm").addEventListener("click", function () {
        var res = placeOffer({
          side: setupSide,
          itemId: selected,
          qty: ($("ge-qty") && $("ge-qty").value) || 1,
          price: ($("ge-price") && $("ge-price").value) || guidePrice(selected),
          traderId: PLAYER_ID,
        });
        if (!res.ok) {
          setStatus(res.error, true);
          return;
        }
        setStatus((setupSide === "buy" ? "Buy" : "Sell") + " offer placed in slot " + (setupSlot + 1) + ".");
        showView("home");
        render();
      });
    }
    if ($("ge-collect-all") && !$("ge-collect-all").dataset.bound) {
      $("ge-collect-all").dataset.bound = "1";
      $("ge-collect-all").addEventListener("click", function () {
        collectAll();
        setStatus("Collected completed offers.");
        showView("home");
        render();
      });
    }
    if ($("ge-seed-npcs") && !$("ge-seed-npcs").dataset.bound) {
      $("ge-seed-npcs").dataset.bound = "1";
      $("ge-seed-npcs").addEventListener("click", function () {
        state.npcSeededOffers = false;
        seedNpcOffers();
        setStatus("NPC books refilled.");
        render();
      });
    }
    if ($("ge-refresh") && !$("ge-refresh").dataset.bound) {
      $("ge-refresh").dataset.bound = "1";
      $("ge-refresh").addEventListener("click", function () {
        loadRoster().then(function () {
          setStatus("Banker roster refreshed.");
          render();
        });
      });
    }
    if ($("ge-reset") && !$("ge-reset").dataset.bound) {
      $("ge-reset").dataset.bound = "1";
      $("ge-reset").addEventListener("click", function () {
        if (!confirm("Reset Grand Exchange progress?")) return;
        state = defaultState();
        ensurePlayerStock();
        ensureNpcSeedStock();
        seedNpcOffers();
        saveState();
        tickN = 0;
        setStatus("Exchange reset.");
        showView("home");
        render();
      });
    }
  }

  function loadAnalyses() {
    return fetch("data/analyses.json?t=" + Date.now(), { cache: "no-store" })
      .then(function (r) {
        return r.ok ? r.json() : {};
      })
      .then(function (data) {
        analyses = data || {};
      })
      .catch(function () {
        analyses = {};
      });
  }

  function loadRoster() {
    return fetch("/api/banker/roster?t=" + Date.now(), { cache: "no-store" })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (data) {
        if (data && (data.people || data.roster)) roster = data.people || data.roster || [];
        return fetch("data/payment-config.json?t=" + Date.now(), { cache: "no-store" })
          .then(function (r) {
            return r.ok ? r.json() : null;
          })
          .then(function (cfg) {
            if (cfg && cfg.prices_usd && cfg.prices_usd.paintings) {
              GUIDE_BASE = Number(cfg.prices_usd.paintings) || GUIDE_BASE;
            }
          })
          .catch(function () {});
      })
      .catch(function () {
        if (!roster.length) {
          roster = [];
          for (var i = 1; i <= 100; i++) {
            roster.push({
              id: i,
              full_name: i === PLAYER_ID ? "Logan Sevin" : "Citizen #" + i,
              is_player: i === PLAYER_ID,
              possession_usd: 50000,
              debit: { balance_usd: 50000 },
            });
          }
        }
      });
  }

  function startTicks() {
    stopTicks();
    tickTimer = setInterval(npcTick, NPC_TICK_MS);
  }
  function stopTicks() {
    if (tickTimer) clearInterval(tickTimer);
    tickTimer = null;
  }

  function onShow() {
    bind();
    Promise.all([loadAnalyses(), loadRoster()]).then(function () {
      ensurePlayerStock();
      ensureNpcSeedStock();
      seedNpcOffers();
      saveState();
      showView("home");
      render();
      startTicks();
      setStatus("Welcome to the Grand Exchange.");
    });
  }

  function onHide() {
    stopTicks();
  }

  function init() {
    state = loadState();
    window.addEventListener("exchange-hide", onHide);
    document.addEventListener("DOMContentLoaded", function () {
      if (location.hash.replace("#", "") === "exchange") onShow();
    });
    document.addEventListener(
      "click",
      function (e) {
        var t = e.target.closest('.tab[data-tab="exchange"]');
        if (t) setTimeout(onShow, 0);
      },
      true
    );
  }

  init();
  window.GrandExchange = {
    refresh: function () {
      return loadRoster().then(render);
    },
    state: function () {
      return state;
    },
  };
})();
