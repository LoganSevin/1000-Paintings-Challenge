/**
 * Grand Exchange — RuneScape-style buy/sell for gallery paintings + Banker 100.
 * SIM cash only. Adjustable guide prices, NPC-filled books, per-piece trade stats.
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
        maximumFractionDigits: 2,
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

  function setGuidePrice(n, price) {
    n = String(n);
    price = Math.max(1, Math.round(Number(price) || 1));
    if (!state.guideOverrides) state.guideOverrides = {};
    state.guideOverrides[n] = price;
    saveState();
  }

  function clearGuideOverride(n) {
    if (!state.guideOverrides) return;
    delete state.guideOverrides[String(n)];
    saveState();
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
    // Rebuild itemStats from history if empty
    if (!Object.keys(s.itemStats).length && s.history.length) {
      s.history.forEach(function (h) {
        var st = s.itemStats[String(h.itemId)] || {
          trades: 0,
          qty: 0,
          volume: 0,
          lastPrice: 0,
          lastAt: 0,
        };
        st.trades += 1;
        st.qty += Number(h.qty) || 0;
        st.volume += Number(h.total) || 0;
        st.lastPrice = Number(h.price) || st.lastPrice;
        st.lastAt = Math.max(st.lastAt || 0, h.at || 0);
        s.itemStats[String(h.itemId)] = st;
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
      return o && !o.cancelled && (Number(o.qtyLeft) || 0) > 0;
    });
  }

  function playerOffers() {
    return activeOffers().filter(function (o) {
      return Number(o.traderId) === PLAYER_ID;
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
          return o.side === "buy";
        })
        .sort(function (a, b) {
          return b.price - a.price || a.createdAt - b.createdAt;
        });
      var sells = activeOffers()
        .filter(function (o) {
          return o.side === "sell";
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
          matched = true;
          break;
        }
      }
      if (!matched) break;
    }
    state.offers = state.offers.filter(function (o) {
      return o && !o.cancelled && (Number(o.qtyLeft) || 0) > 0;
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

    if (isPlayer && playerOffers().length >= MAX_SLOTS) {
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
      createdAt: Date.now(),
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
    if (o.side === "buy") addCash(o.traderId, left * o.price);
    else addInv(o.traderId, o.itemId, left);
    o.cancelled = true;
    o.qtyLeft = 0;
    state.offers = state.offers.filter(function (x) {
      return x && !x.cancelled && (Number(x.qtyLeft) || 0) > 0;
    });
    saveState();
  }

  function seedNpcOffers() {
    if (state.npcSeededOffers) return;
    if (!roster.length) return;
    state.npcSeededOffers = true;
    // Fill books: many NPCs post buy+sell around guide for a spread of items
    var items = [];
    for (var n = 1; n <= 1000; n += 7) items.push(n);
    for (var i = 0; i < roster.length; i++) {
      var p = roster[i];
      if (!p || p.is_player || Number(p.id) === PLAYER_ID) continue;
      var item = items[(Number(p.id) * 3) % items.length];
      var g = guidePrice(item);
      // ensure stock for sells
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
      // second random item for denser books
      var item2 = 1 + ((Number(p.id) * 41) % 1000);
      var g2 = guidePrice(item2);
      if (qtyOf(p.id, item2) < 1) addInv(p.id, item2, 1);
      if (Number(p.id) % 2 === 0) {
        placeOffer({
          side: "sell",
          itemId: item2,
          qty: 1,
          price: Math.max(1, Math.round(g2 * 1.05)),
          traderId: p.id,
          silent: true,
        });
      } else {
        placeOffer({
          side: "buy",
          itemId: item2,
          qty: 1,
          price: Math.max(1, Math.round(g2 * 0.92)),
          traderId: p.id,
          silent: true,
        });
      }
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
          return Number(o.traderId) === Number(p.id);
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
      var price = Math.max(1, Math.round(guide * slip));
      placeOffer({ side: side, itemId: item, qty: qty, price: price, traderId: p.id, silent: true });
    }
    saveState();
    render();
  }

  function booksFor(itemId) {
    var buys = [];
    var sells = [];
    activeOffers().forEach(function (o) {
      if (String(o.itemId) !== String(itemId)) return;
      if (o.side === "buy") buys.push(o);
      else sells.push(o);
    });
    buys.sort(function (a, b) {
      return b.price - a.price;
    });
    sells.sort(function (a, b) {
      return a.price - b.price;
    });
    return { buys: buys.slice(0, 14), sells: sells.slice(0, 14) };
  }

  function setStatus(msg, isErr) {
    var el = $("ge-status");
    if (!el) return;
    el.textContent = msg || "";
    el.style.color = isErr ? "#e07a7a" : "#8a8070";
  }

  function renderStats() {
    if ($("ge-you-cash")) $("ge-you-cash").textContent = money(cashOf(PLAYER_ID));
    if ($("ge-you-slots")) $("ge-you-slots").textContent = playerOffers().length + " / " + MAX_SLOTS;
    if ($("ge-open")) $("ge-open").textContent = String(activeOffers().length);
    if ($("ge-people")) $("ge-people").textContent = String(roster.length || 100);
    var dayAgo = Date.now() - 86400000;
    var vol = 0;
    var trades = 0;
    state.history.forEach(function (h) {
      if (h.at >= dayAgo) {
        vol += Number(h.total) || 0;
        trades += 1;
      }
    });
    if ($("ge-vol")) $("ge-vol").textContent = money(vol);
    if ($("ge-trades-24h")) $("ge-trades-24h").textContent = String(trades);
    if ($("ge-mult")) $("ge-mult").value = String(state.guideMult || 1);
  }

  function renderCatalog() {
    var wrap = $("ge-catalog");
    var q = (($("ge-search") && $("ge-search").value) || "").trim().toLowerCase();
    if (!wrap) return;
    var html = [];
    var shown = 0;
    for (var n = 1; n <= 1000 && shown < 140; n++) {
      var title = titleFor(n);
      if (q) {
        var hay = (title + " #" + n).toLowerCase();
        if (hay.indexOf(q) === -1) continue;
      }
      var st = itemStats(n);
      var active = n === selected ? " active" : "";
      html.push(
        '<button type="button" class="ge-item' +
          active +
          '" data-ge-item="' +
          n +
          '" title="' +
          esc(title) +
          " · " +
          st.trades +
          ' trades">' +
          '<img src="' +
          esc(thumb(n)) +
          '" alt="" loading="lazy" />' +
          '<span class="ge-item-n">#' +
          n +
          (st.trades ? " · " + st.trades + "tx" : "") +
          "</span>" +
          '<span class="ge-item-p">' +
          money(guidePrice(n)) +
          "</span>" +
          "</button>"
      );
      shown++;
    }
    wrap.innerHTML = html.join("") || '<p class="ge-empty">No paintings match.</p>';
  }

  function renderDetail() {
    var n = selected;
    var st = itemStats(n);
    if ($("ge-detail-img")) $("ge-detail-img").src = thumb(n);
    if ($("ge-detail-title")) $("ge-detail-title").textContent = titleFor(n);
    if ($("ge-detail-sub")) $("ge-detail-sub").textContent = "Item ID " + n + " · gallery painting";
    if ($("ge-detail-guide")) {
      var over = state.guideOverrides && state.guideOverrides[String(n)] != null;
      $("ge-detail-guide").textContent =
        "Guide " + money(guidePrice(n)) + (over ? " (custom)" : " (auto ×" + (state.guideMult || 1) + ")");
    }
    if ($("ge-detail-stock")) $("ge-detail-stock").textContent = "You hold " + qtyOf(PLAYER_ID, n);
    if ($("ge-detail-trades")) {
      $("ge-detail-trades").textContent =
        st.trades +
        " trades · " +
        st.qty +
        " units · vol " +
        money(st.volume) +
        (st.lastPrice ? " · last " + money(st.lastPrice) : "");
    }
    if ($("ge-guide-input")) $("ge-guide-input").value = String(guidePrice(n));
    if ($("ge-price") && document.activeElement !== $("ge-price")) {
      $("ge-price").value = String(guidePrice(n));
    }
    if ($("ge-qty") && document.activeElement !== $("ge-qty")) $("ge-qty").value = "1";

    var books = booksFor(n);
    if ($("ge-book-buys")) {
      $("ge-book-buys").innerHTML = books.buys.length
        ? books.buys
            .map(function (o) {
              return (
                "<li><span>" +
                esc(o.traderName) +
                " ×" +
                o.qtyLeft +
                '</span><strong class="ge-side-buy">' +
                money(o.price) +
                "</strong></li>"
              );
            })
            .join("")
        : '<li class="ge-empty">No buy offers</li>';
    }
    if ($("ge-book-sells")) {
      $("ge-book-sells").innerHTML = books.sells.length
        ? books.sells
            .map(function (o) {
              return (
                "<li><span>" +
                esc(o.traderName) +
                " ×" +
                o.qtyLeft +
                '</span><strong class="ge-side-sell">' +
                money(o.price) +
                "</strong></li>"
              );
            })
            .join("")
        : '<li class="ge-empty">No sell offers</li>';
    }
  }

  function renderOffers() {
    var body = $("ge-offer-body");
    if (!body) return;
    var rows = playerOffers();
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="5" class="ge-empty">No open offers — place a buy or sell.</td></tr>';
      return;
    }
    body.innerHTML = rows
      .map(function (o) {
        return (
          "<tr>" +
          '<td class="' +
          (o.side === "buy" ? "ge-side-buy" : "ge-side-sell") +
          '">' +
          o.side.toUpperCase() +
          "</td><td>#" +
          o.itemId +
          "</td><td>" +
          o.qtyLeft +
          "/" +
          o.qty +
          "</td><td>" +
          money(o.price) +
          '</td><td><button type="button" class="btn-secondary" data-ge-cancel="' +
          esc(o.id) +
          '">Cancel</button></td></tr>'
        );
      })
      .join("");
  }

  function renderInv() {
    var body = $("ge-inv-body");
    if (!body) return;
    var inv = invOf(PLAYER_ID);
    var ids = Object.keys(inv)
      .map(Number)
      .sort(function (a, b) {
        return a - b;
      });
    if (!ids.length) {
      body.innerHTML = '<tr><td colspan="3" class="ge-empty">Empty — buy from the exchange.</td></tr>';
      return;
    }
    body.innerHTML = ids
      .slice(0, 50)
      .map(function (id) {
        return (
          "<tr><td>#" +
          id +
          "</td><td>" +
          esc(titleFor(id)) +
          "</td><td>" +
          inv[String(id)] +
          "</td></tr>"
        );
      })
      .join("");
  }

  function renderFeed() {
    var body = $("ge-feed-body");
    if (!body) return;
    var rows = state.history.slice(0, 30);
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="4" class="ge-empty">No trades yet.</td></tr>';
      return;
    }
    body.innerHTML = rows
      .map(function (h) {
        return (
          "<tr><td>#" +
          h.itemId +
          " ×" +
          h.qty +
          "</td><td>" +
          money(h.price) +
          "</td><td>" +
          esc(h.buyerName) +
          "</td><td>" +
          esc(h.sellerName) +
          "</td></tr>"
        );
      })
      .join("");
  }

  function renderTopTraded() {
    var body = $("ge-top-body");
    if (!body) return;
    var rows = Object.keys(state.itemStats || {})
      .map(function (k) {
        var st = state.itemStats[k];
        return { id: Number(k), trades: st.trades || 0, volume: st.volume || 0, lastPrice: st.lastPrice || 0 };
      })
      .filter(function (r) {
        return r.trades > 0;
      })
      .sort(function (a, b) {
        return b.trades - a.trades || b.volume - a.volume;
      })
      .slice(0, 12);
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="4" class="ge-empty">No piece stats yet — NPCs will fill this.</td></tr>';
      return;
    }
    body.innerHTML = rows
      .map(function (r) {
        return (
          '<tr data-ge-jump="' +
          r.id +
          '" style="cursor:pointer"><td>#' +
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
      .join("");
  }

  function render() {
    renderStats();
    renderCatalog();
    renderDetail();
    renderOffers();
    renderInv();
    renderFeed();
    renderTopTraded();
    if ($("ge-tick")) $("ge-tick").textContent = "tick " + tickN;
  }

  function bind() {
    var search = $("ge-search");
    if (search && !search.dataset.bound) {
      search.dataset.bound = "1";
      search.addEventListener("input", renderCatalog);
    }
    var catalog = $("ge-catalog");
    if (catalog && !catalog.dataset.bound) {
      catalog.dataset.bound = "1";
      catalog.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-ge-item]");
        if (!btn) return;
        selected = Number(btn.getAttribute("data-ge-item")) || 1;
        render();
      });
    }
    var top = $("ge-top-body");
    if (top && !top.dataset.bound) {
      top.dataset.bound = "1";
      top.addEventListener("click", function (e) {
        var tr = e.target.closest("[data-ge-jump]");
        if (!tr) return;
        selected = Number(tr.getAttribute("data-ge-jump")) || 1;
        render();
      });
    }
    if ($("ge-buy") && !$("ge-buy").dataset.bound) {
      $("ge-buy").dataset.bound = "1";
      $("ge-buy").addEventListener("click", function () {
        var res = placeOffer({
          side: "buy",
          itemId: selected,
          qty: ($("ge-qty") && $("ge-qty").value) || 1,
          price: ($("ge-price") && $("ge-price").value) || guidePrice(selected),
          traderId: PLAYER_ID,
        });
        setStatus(res.ok ? "Buy offer placed." : res.error, !res.ok);
        render();
      });
    }
    if ($("ge-sell") && !$("ge-sell").dataset.bound) {
      $("ge-sell").dataset.bound = "1";
      $("ge-sell").addEventListener("click", function () {
        var res = placeOffer({
          side: "sell",
          itemId: selected,
          qty: ($("ge-qty") && $("ge-qty").value) || 1,
          price: ($("ge-price") && $("ge-price").value) || guidePrice(selected),
          traderId: PLAYER_ID,
        });
        setStatus(res.ok ? "Sell offer placed." : res.error, !res.ok);
        render();
      });
    }
    if ($("ge-offer-body") && !$("ge-offer-body").dataset.bound) {
      $("ge-offer-body").dataset.bound = "1";
      $("ge-offer-body").addEventListener("click", function (e) {
        var btn = e.target.closest("[data-ge-cancel]");
        if (!btn) return;
        cancelOffer(btn.getAttribute("data-ge-cancel"));
        setStatus("Offer cancelled — reserved cash/stock returned.");
        render();
      });
    }
    if ($("ge-save-guide") && !$("ge-save-guide").dataset.bound) {
      $("ge-save-guide").dataset.bound = "1";
      $("ge-save-guide").addEventListener("click", function () {
        setGuidePrice(selected, ($("ge-guide-input") && $("ge-guide-input").value) || guidePrice(selected));
        setStatus("Custom guide set for #" + selected + " → " + money(guidePrice(selected)));
        render();
      });
    }
    if ($("ge-reset-guide") && !$("ge-reset-guide").dataset.bound) {
      $("ge-reset-guide").dataset.bound = "1";
      $("ge-reset-guide").addEventListener("click", function () {
        clearGuideOverride(selected);
        setStatus("Guide for #" + selected + " back to auto.");
        render();
      });
    }
    if ($("ge-apply-mult") && !$("ge-apply-mult").dataset.bound) {
      $("ge-apply-mult").dataset.bound = "1";
      $("ge-apply-mult").addEventListener("click", function () {
        var m = Number($("ge-mult") && $("ge-mult").value) || 1;
        state.guideMult = Math.max(0.1, Math.min(10, m));
        saveState();
        setStatus("Global guide multiplier set to ×" + state.guideMult);
        render();
      });
    }
    if ($("ge-seed-npcs") && !$("ge-seed-npcs").dataset.bound) {
      $("ge-seed-npcs").dataset.bound = "1";
      $("ge-seed-npcs").addEventListener("click", function () {
        state.npcSeededOffers = false;
        seedNpcOffers();
        setStatus("NPC books refilled (" + activeOffers().length + " open offers).");
        render();
      });
    }
    if ($("ge-reset") && !$("ge-reset").dataset.bound) {
      $("ge-reset").dataset.bound = "1";
      $("ge-reset").addEventListener("click", function () {
        if (!confirm("Reset Grand Exchange progress? Banker ledger stays intact.")) return;
        state = defaultState();
        ensurePlayerStock();
        ensureNpcSeedStock();
        seedNpcOffers();
        saveState();
        tickN = 0;
        setStatus("Exchange reset + NPC books seeded.");
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
      render();
      startTicks();
      setStatus("GE live — NPCs merchanting. Adjust guides anytime.");
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
    guidePrice: guidePrice,
  };
})();
