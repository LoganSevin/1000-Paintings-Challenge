/**
 * Grand Exchange — RuneScape-style 8-slot offer UI + Banker 100 SIM market.
 */
(function () {
  "use strict";

  var STORAGE = "gallery.grand-exchange.v4";
  var STORAGE_LEGACY = "gallery.grand-exchange.v3";
  var STORAGE_LEGACY2 = "gallery.grand-exchange.v2";
  var STORAGE_LEGACY3 = "gallery.grand-exchange.v1";
  var PLAYER_ID = 100;
  var MAX_SLOTS = 8;
  var NPC_TICK_MS = 1200;
  var GUIDE_BASE = 89;
  var PAINTING_TOTAL = 1000;
  /** Match Spellforge ID spaces */
  var GEN_BASE = 100000;
  var SKETCH_BASE = 200000;
  var INV_SKETCH_BASE = 300000;

  var state = null;
  var roster = [];
  var analyses = {};
  /** Spellforge extras: gen / phone / sketch / inverted — id -> {url,title,source,genNum,analysis} */
  var extraItems = {};
  var arsenalExtraNums = [];
  var selected = 1;
  var tickTimer = null;
  var tickN = 0;
  var view = "home"; // home | setup | pick | history
  var setupSide = "buy"; // buy | sell
  var setupSlot = 0;
  var bagView = "inv"; // inv | bank
  var bankPage = 0;
  var INV_SLOTS = 28;
  var BANK_PAGE = 96; // 8×12 visible; bank itself is unlimited
  var selectedInvItem = null;
  var selectedBankItem = null;
  var forgeSlots = [null, null, null];
  var lastForgeResult = null;

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

  function assetUrl(path) {
    if (!path) return path;
    if (/^(https?:|data:|blob:)/i.test(path)) return path;
    try {
      if (typeof window.galleryApiUrl === "function" && path.charAt(0) === "/") {
        return window.galleryApiUrl(path);
      }
    } catch (e) {}
    var base = String(window.SPELLFORGE_API_BASE || "").replace(/\/$/, "");
    if (base && path.charAt(0) === "/") return base + path;
    try {
      return new URL(path, window.location.href).href;
    } catch (e2) {
      return path;
    }
  }

  function apiUrl(path) {
    try {
      if (typeof window.galleryApiUrl === "function") return window.galleryApiUrl(path);
    } catch (e) {}
    var base = String(window.SPELLFORGE_API_BASE || "").replace(/\/$/, "");
    return base ? base + path : path;
  }

  function forgedOf(n) {
    n = Number(n);
    if (!state || !state.forged) return null;
    return state.forged[String(n)] || state.forged[n] || null;
  }

  function extraOf(n) {
    n = Number(n);
    return extraItems[n] || extraItems[String(n)] || null;
  }

  function kindLabel(n) {
    n = Number(n);
    var f = forgedOf(n);
    if (f) return "Forged #" + n;
    var ex = extraOf(n);
    if (!ex) return "#" + n;
    var g = ex.genNum != null ? ex.genNum : n;
    if (ex.source === "phone-upload") return "Phone G#" + g;
    if (ex.source === "sketch") return "Sketch S#" + g;
    if (ex.source === "sketch-inverted") return "Inv sketch SI#" + g;
    return "Gen G#" + g;
  }

  function thumb(n) {
    n = Number(n);
    var f = forgedOf(n);
    if (f && f.thumb) return assetUrl(f.thumb);
    var ex = extraOf(n);
    if (ex && ex.url) return assetUrl(ex.url);
    if (f && f.parents && f.parents[0]) return thumb(f.parents[0]);
    if (n >= 1 && n <= PAINTING_TOTAL) return "paintings/" + n + ".jpg";
    return "paintings/1.jpg";
  }

  function titleFor(n) {
    n = Number(n);
    var f = forgedOf(n);
    if (f && f.title) return f.title;
    var ex = extraOf(n);
    if (ex) {
      if (ex.analysis && ex.analysis.title) return ex.analysis.title;
      if (ex.title) return ex.title;
      return kindLabel(n);
    }
    var a = analyses[String(n)];
    if (a && a.title) return a.title;
    return "Painting #" + n;
  }

  function fullDescFor(n) {
    n = Number(n);
    var f = forgedOf(n);
    if (f && f.description) return String(f.description);
    var ex = extraOf(n);
    if (ex && ex.analysis && ex.analysis.description) return String(ex.analysis.description);
    var a = analyses[String(n)];
    if (a && a.description) return String(a.description);
    if (ex) return "A " + kindLabel(n) + " from the Spellforge arsenal.";
    return "A painting from the 1000 Paintings Challenge.";
  }

  function descFor(n) {
    return String(fullDescFor(n)).slice(0, 90);
  }

  function autoGuide(n) {
    n = Number(n) || 1;
    var x = (n * 9301 + 49297) % 233280;
    var jitter = (x / 233280) * 0.5 - 0.15;
    var g = GUIDE_BASE * (1 + jitter);
    if (forgedOf(n)) g *= 1.45;
    else {
      var ex = extraOf(n);
      if (ex) {
        if (ex.source === "phone-upload") g *= 1.22;
        else if (ex.source === "sketch" || ex.source === "sketch-inverted") g *= 1.12;
        else g *= 1.18;
      } else {
        if (n % 100 === 0) g *= 1.35;
        else if (n % 50 === 0) g *= 1.18;
        else if (n % 10 === 0) g *= 1.08;
      }
    }
    var mult = Number(state && state.guideMult) || 1;
    return Math.max(1, Math.round(g * mult));
  }

  function guidePrice(n) {
    n = Number(n);
    if (state && state.guideOverrides && state.guideOverrides[String(n)] != null) {
      return Math.max(1, Math.round(Number(state.guideOverrides[String(n)]) || 1));
    }
    var f = forgedOf(n);
    if (f && f.guide != null) return Math.max(1, Math.round(Number(f.guide) || 1));
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
      version: 4,
      cashDelta: {},
      inventory: {},
      bank: {},
      offers: [],
      history: [],
      guideOverrides: {},
      guideMult: 1,
      itemStats: {},
      forged: {},
      nextForgeId: 10001,
      npcSeededOffers: false,
      _npcSeeded: false,
      packReady: true, // do not auto-fill inventory with gallery art
      _starterCash: false,
      createdAt: Date.now(),
    };
  }

  function migrate(s) {
    if (!s || typeof s !== "object") return defaultState();
    var wasOld = (Number(s.version) || 0) < 3;
    s.version = 4;
    s.cashDelta = s.cashDelta || {};
    s.inventory = s.inventory || {};
    s.bank = s.bank || {};
    s.offers = Array.isArray(s.offers) ? s.offers : [];
    s.history = Array.isArray(s.history) ? s.history : [];
    s.guideOverrides = s.guideOverrides || {};
    s.guideMult = Number(s.guideMult) || 1;
    s.itemStats = s.itemStats || {};
    s.forged = s.forged || {};
    s.nextForgeId = Math.max(10001, Number(s.nextForgeId) || 10001);
    if (!Object.keys(s.itemStats).length && s.history.length) {
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
    if (wasOld || !s.packReady) {
      // Old builds auto-stuffed #1–28 into inventory. Wipe that false start once.
      // Bank is left alone (you may have deposited for real).
      s.inventory = s.inventory || {};
      s.inventory[String(100)] = {};
      s.packReady = true;
    }
    return s;
  }

  function loadState() {
    try {
      var raw =
        localStorage.getItem(STORAGE) ||
        localStorage.getItem(STORAGE_LEGACY) ||
        localStorage.getItem(STORAGE_LEGACY2) ||
        localStorage.getItem(STORAGE_LEGACY3);
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

  function bankOf(id) {
    id = String(id);
    if (!state.bank) state.bank = {};
    if (!state.bank[id]) state.bank[id] = {};
    return state.bank[id];
  }

  function bankQty(id, itemId) {
    return Number(bankOf(id)[String(itemId)]) || 0;
  }

  function addBank(id, itemId, delta) {
    var b = bankOf(id);
    var k = String(itemId);
    var next = (Number(b[k]) || 0) + delta;
    if (next <= 0) delete b[k];
    else b[k] = next;
  }

  function invList(id) {
    return Object.keys(invOf(id))
      .map(function (k) {
        return { id: Number(k), qty: Number(invOf(id)[k]) || 0 };
      })
      .filter(function (x) {
        return x.qty > 0;
      })
      .sort(function (a, b) {
        return a.id - b.id;
      });
  }

  function bankList(id) {
    return Object.keys(bankOf(id))
      .map(function (k) {
        return { id: Number(k), qty: Number(bankOf(id)[k]) || 0 };
      })
      .filter(function (x) {
        return x.qty > 0;
      })
      .sort(function (a, b) {
        return a.id - b.id;
      });
  }

  function inventoryCount(id) {
    return invList(id).length;
  }

  function depositItem(itemId, qty) {
    itemId = Number(itemId);
    qty = Math.max(1, Math.floor(Number(qty) || 1));
    var have = qtyOf(PLAYER_ID, itemId);
    if (have < 1) return { ok: false, error: "Nothing to deposit." };
    qty = Math.min(qty, have);
    addInv(PLAYER_ID, itemId, -qty);
    addBank(PLAYER_ID, itemId, qty);
    saveState();
    return { ok: true, qty: qty };
  }

  function withdrawItem(itemId, qty) {
    itemId = Number(itemId);
    qty = Math.max(1, Math.floor(Number(qty) || 1));
    var have = bankQty(PLAYER_ID, itemId);
    if (have < 1) return { ok: false, error: "Bank is empty for that item." };
    var free = INV_SLOTS - inventoryCount(PLAYER_ID);
    var already = qtyOf(PLAYER_ID, itemId) > 0;
    if (!already && free < 1) return { ok: false, error: "Inventory full (28 kinds)." };
    qty = Math.min(qty, have);
    addBank(PLAYER_ID, itemId, -qty);
    addInv(PLAYER_ID, itemId, qty);
    saveState();
    return { ok: true, qty: qty };
  }

  function depositAll() {
    var list = invList(PLAYER_ID).slice();
    list.forEach(function (it) {
      var have = qtyOf(PLAYER_ID, it.id);
      if (have > 0) depositItem(it.id, have);
    });
    // Hard-clear any leftovers
    state.inventory[String(PLAYER_ID)] = {};
    selectedInvItem = null;
    saveState();
  }

  function withdrawAllPage() {
    var list = bankList(PLAYER_ID);
    var start = bankPage * BANK_PAGE;
    list.slice(start, start + BANK_PAGE).forEach(function (it) {
      withdrawItem(it.id, it.qty);
    });
    selectedBankItem = null;
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


  function ingestSpellAssets(items) {
    extraItems = {};
    arsenalExtraNums = [];
    (items || []).forEach(function (it) {
      if (!it) return;
      var genNum = parseInt(it.number, 10);
      if (!genNum || genNum < 1) return;
      var url = it.url || it.generatedUrl || it.phoneUrl || "";
      if (!url) return;
      var source =
        it.source === "phone-upload" || it.kind === "phone-upload"
          ? "phone-upload"
          : it.source === "sketch-inverted" || it.kind === "sketch-inverted"
            ? "sketch-inverted"
            : it.source === "sketch" || it.kind === "sketch"
              ? "sketch"
              : "generated";
      var base =
        source === "sketch" ? SKETCH_BASE : source === "sketch-inverted" ? INV_SKETCH_BASE : GEN_BASE;
      var num = base + genNum;
      var analysis = it.analysis || null;
      if (analysis && !analysis.title && it.title) analysis.title = it.title;
      var defaultTitle =
        source === "phone-upload"
          ? "Phone G#" + genNum
          : source === "sketch"
            ? "Sketch S#" + genNum
            : source === "sketch-inverted"
              ? "Inv sketch SI#" + genNum
              : "Gen G#" + genNum;
      extraItems[num] = {
        number: num,
        genNum: genNum,
        sketchNum: source === "sketch" || source === "sketch-inverted" ? genNum : null,
        url: url,
        title: (analysis && analysis.title) || it.title || defaultTitle,
        source: source,
        name: it.name || "",
        analysis: analysis,
      };
      extraItems[String(num)] = extraItems[num];
      if (analysis) {
        analyses[String(num)] = analysis;
        analyses[num] = analysis;
      }
      arsenalExtraNums.push(num);
    });
    arsenalExtraNums.sort(function (a, b) {
      return a - b;
    });
  }

  function loadArsenal() {
    var url = apiUrl("/api/transfer/spell-assets?t=" + Date.now());
    return fetch(url, { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) return null;
        return r.json().catch(function () {
          return null;
        });
      })
      .then(function (d) {
        if (d && d.ok && Array.isArray(d.items)) {
          ingestSpellAssets(d.items);
          if (d.painting_total) PAINTING_TOTAL = Number(d.painting_total) || PAINTING_TOTAL;
        } else if (window.SpellforgeAPI && typeof window.SpellforgeAPI.getDisplayOrder === "function") {
          // Fallback: reuse Spellforge display order if API already booted
          try {
            var order = window.SpellforgeAPI.getDisplayOrder() || [];
            order.forEach(function (n) {
              n = Number(n);
              if (n > PAINTING_TOTAL && arsenalExtraNums.indexOf(n) < 0) arsenalExtraNums.push(n);
            });
          } catch (e) {}
        }
        return arsenalExtraNums.length;
      })
      .catch(function () {
        return 0;
      });
  }

  function forgedIds() {
    if (!state || !state.forged) return [];
    return Object.keys(state.forged)
      .map(function (k) {
        return Number(k);
      })
      .filter(function (n) {
        return n > 0;
      })
      .sort(function (a, b) {
        return a - b;
      });
  }

  /** Full tradable arsenal: paintings + generated + phone + sketches + inverted + forged */
  function arsenalList() {
    var list = [];
    var i;
    for (i = 1; i <= PAINTING_TOTAL; i++) list.push(i);
    for (i = 0; i < arsenalExtraNums.length; i++) list.push(arsenalExtraNums[i]);
    forgedIds().forEach(function (id) {
      if (list.indexOf(id) < 0) list.push(id);
    });
    return list;
  }

  function randomArsenalItem(seedHint) {
    var list = arsenalList();
    if (!list.length) return 1 + Math.floor(Math.random() * PAINTING_TOTAL);
    if (seedHint != null) {
      var idx = Math.abs(Number(seedHint) || 0) % list.length;
      return list[idx];
    }
    return list[Math.floor(Math.random() * list.length)];
  }

  function ownedQty(itemId) {
    return qtyOf(PLAYER_ID, itemId) + bankQty(PLAYER_ID, itemId);
  }

  function consumeOwned(itemId, qty) {
    itemId = Number(itemId);
    qty = Math.max(1, Math.floor(Number(qty) || 1));
    var fromInv = Math.min(qty, qtyOf(PLAYER_ID, itemId));
    if (fromInv) addInv(PLAYER_ID, itemId, -fromInv);
    var left = qty - fromInv;
    if (left > 0) {
      if (bankQty(PLAYER_ID, itemId) < left) return false;
      addBank(PLAYER_ID, itemId, -left);
    }
    return true;
  }

  function setForgeStatus(msg, isErr) {
    var el = $("ge-forge-status");
    if (el) {
      el.textContent = msg || "";
      el.className = "ge-forge-status" + (isErr ? " err" : "");
    }
    if (msg) setStatus(msg, isErr);
  }

  function ensurePlayerStock() {
    // Inventory starts empty — you buy on the GE or withdraw from bank.
    // Never auto-fill from the gallery catalogue.
    state.packReady = true;
    if (cashOf(PLAYER_ID) < 1 && !state._starterCash) {
      state.cashDelta[String(PLAYER_ID)] = (Number(state.cashDelta[String(PLAYER_ID)]) || 0) + 5000;
      state._starterCash = true;
      saveState();
    }
  }

  function ensureNpcSeedStock() {
    if (state._npcSeeded) return;
    state._npcSeeded = true;
    var pool = arsenalList();
    for (var i = 0; i < roster.length; i++) {
      var p = roster[i];
      if (!p || p.is_player || Number(p.id) === PLAYER_ID) continue;
      var inv = invOf(p.id);
      var count = 3 + (Number(p.id) % 5);
      for (var k = 0; k < count; k++) {
        var item = pool.length
          ? pool[(Number(p.id) * 17 + k * 97) % pool.length]
          : 1 + ((Number(p.id) * 17 + k * 97) % PAINTING_TOTAL);
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
    var items = arsenalList();
    if (!items.length) {
      for (var n = 1; n <= PAINTING_TOTAL; n += 7) items.push(n);
    } else {
      // Thin sample across full arsenal for seed book density
      var sampled = [];
      for (var si = 0; si < items.length; si += Math.max(1, Math.floor(items.length / 140))) {
        sampled.push(items[si]);
      }
      items = sampled.length ? sampled : items;
    }
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

  function hitPlayerOffers(npc) {
    // Actively take the other side of the player's open offers for momentum.
    var mine = playerSlotOffers().filter(function (o) {
      return !o.complete && (Number(o.qtyLeft) || 0) > 0;
    });
    if (!mine.length) return false;
    var o = mine[Math.floor(Math.random() * mine.length)];
    var qty = Math.min(Number(o.qtyLeft) || 1, 1 + (Math.random() < 0.25 ? 1 : 0));
    if (o.side === "buy") {
      // Player is buying → NPC sells into them at player's price (or slightly under guide)
      if (qtyOf(npc.id, o.itemId) < qty) addInv(npc.id, o.itemId, qty);
      placeOffer({
        side: "sell",
        itemId: o.itemId,
        qty: qty,
        price: o.price,
        traderId: npc.id,
        silent: true,
      });
    } else {
      // Player is selling → NPC buys at player's price
      placeOffer({
        side: "buy",
        itemId: o.itemId,
        qty: qty,
        price: o.price,
        traderId: npc.id,
        silent: true,
      });
    }
    return true;
  }

  function npcTick() {
    if (!roster.length) return;
    tickN++;
    var actions = 4 + (tickN % 4);
    for (var a = 0; a < actions; a++) {
      var p = roster[Math.floor(Math.random() * roster.length)];
      if (!p || p.is_player || Number(p.id) === PLAYER_ID) continue;
      var roll = Math.random();
      // ~45% of actions: directly fill a player offer for visible momentum
      if (roll < 0.45 && hitPlayerOffers(p)) continue;
      if (roll < 0.55) {
        var mine = activeOffers().filter(function (o) {
          return Number(o.traderId) === Number(p.id) && !o.isPlayer;
        });
        if (mine.length) cancelOffer(mine[Math.floor(Math.random() * mine.length)].id);
        continue;
      }
      var item = randomArsenalItem();
      var guide = guidePrice(item);
      var side = Math.random() < 0.5 ? "buy" : "sell";
      if (side === "sell" && qtyOf(p.id, item) < 1) {
        addInv(p.id, item, 1 + Math.floor(Math.random() * 2));
      }
      var qty = 1 + (Math.random() < 0.35 ? 1 : 0);
      // Tighter prices around guide so books cross more often
      var slip = side === "buy" ? 0.92 + Math.random() * 0.1 : 0.95 + Math.random() * 0.12;
      placeOffer({
        side: side,
        itemId: item,
        qty: qty,
        price: Math.max(1, Math.round(guide * slip)),
        traderId: p.id,
        silent: true,
      });
    }
    matchOffers();
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


  function renderInvGrid() {
    var wrap = $("ge-inv-grid");
    if (!wrap) return;
    var list = invList(PLAYER_ID);
    var html = [];
    for (var i = 0; i < INV_SLOTS; i++) {
      var it = list[i];
      if (!it) {
        html.push('<div class="ge-inv-slot empty"></div>');
        continue;
      }
      var sel = selectedInvItem === it.id ? " selected" : "";
      html.push(
        '<button type="button" class="ge-inv-slot' +
          sel +
          '" data-ge-inv="' +
          it.id +
          '" title="' +
          esc(titleFor(it.id)) +
          '"><img src="' +
          esc(thumb(it.id)) +
          '" alt="" /><span class="qty">' +
          it.qty +
          "</span></button>"
      );
    }
    wrap.innerHTML = html.join("");
    if ($("ge-inv-meta")) {
      $("ge-inv-meta").textContent =
        list.length + " / " + INV_SLOTS + " used · click Deposit · right-click → Spellforge";
    }
  }

  function renderBankGrid() {
    var wrap = $("ge-bank-grid");
    if (!wrap) return;
    var list = bankList(PLAYER_ID);
    var pages = Math.max(1, Math.ceil(list.length / BANK_PAGE) || 1);
    if (bankPage > pages - 1) bankPage = pages - 1;
    if (bankPage < 0) bankPage = 0;
    var start = bankPage * BANK_PAGE;
    var slice = list.slice(start, start + BANK_PAGE);
    var html = [];
    for (var i = 0; i < BANK_PAGE; i++) {
      var it = slice[i];
      if (!it) {
        html.push('<div class="ge-bank-slot empty"></div>');
        continue;
      }
      var sel = selectedBankItem === it.id ? " selected" : "";
      html.push(
        '<button type="button" class="ge-bank-slot' +
          sel +
          '" data-ge-bank="' +
          it.id +
          '" title="' +
          esc(titleFor(it.id)) +
          '"><img src="' +
          esc(thumb(it.id)) +
          '" alt="" /><span class="qty">' +
          it.qty +
          "</span></button>"
      );
    }
    wrap.innerHTML = html.join("");
    if ($("ge-bank-page")) $("ge-bank-page").textContent = pages ? bankPage + 1 + " / " + pages : "1 / 1";
    if ($("ge-bank-meta")) {
      $("ge-bank-meta").textContent = list.length + " types in bank (unlimited) · page " + (bankPage + 1) + " · " + BANK_PAGE + " shown";
    }
  }

  function renderBags() {
    var invP = $("ge-inv-panel");
    var bankP = $("ge-bank-panel");
    if (invP) invP.hidden = bagView !== "inv";
    if (bankP) bankP.hidden = bagView !== "bank";
    if ($("ge-bag-inv")) $("ge-bag-inv").classList.toggle("active", bagView === "inv");
    if ($("ge-bag-bank")) $("ge-bag-bank").classList.toggle("active", bagView === "bank");
    // Always rebuild both grids so deposit/withdraw stay fresh even when a panel is hidden
    renderInvGrid();
    renderBankGrid();
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
    var list = arsenalList();
    for (var i = 0; i < list.length && shown < 200; i++) {
      var n = list[i];
      var title = titleFor(n);
      var label = kindLabel(n);
      var hay = (title + " " + label + " #" + n).toLowerCase();
      if (q) {
        var qLow = q;
        if (
          hay.indexOf(qLow) === -1 &&
          !(qLow === "phone" && extraOf(n) && extraOf(n).source === "phone-upload") &&
          !(qLow === "gen" && extraOf(n) && extraOf(n).source === "generated") &&
          !(
            (qLow === "sketch" || qLow === "sketches") &&
            extraOf(n) &&
            (extraOf(n).source === "sketch" || extraOf(n).source === "sketch-inverted")
          ) &&
          !(qLow === "inverted" && extraOf(n) && extraOf(n).source === "sketch-inverted") &&
          !(qLow === "forged" && forgedOf(n))
        ) {
          continue;
        }
      }
      html.push(
        '<button type="button" class="ge-pick-item" data-ge-item="' +
          n +
          '"><img src="' +
          esc(thumb(n)) +
          '" alt="" loading="lazy" /><span>' +
          esc(label) +
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
    renderBags();
    renderForgeSlots();
  }


  function syncForgeToSpellforge() {
    try {
      if (!window.SpellforgeAPI) return;
      if (typeof window.SpellforgeAPI.equipSlots === "function") {
        window.SpellforgeAPI.equipSlots(forgeSlots.slice(), { skipAutoVision: true });
        return;
      }
      if (typeof window.SpellforgeAPI.equipToSlot === "function") {
        for (var i = 0; i < 3; i++) {
          if (forgeSlots[i] != null) window.SpellforgeAPI.equipToSlot(forgeSlots[i], i);
        }
      }
    } catch (e) {}
  }

  function renderForgeSlots() {
    for (var i = 0; i < 3; i++) {
      var btn = $("ge-forge-slot-" + i);
      if (!btn) continue;
      var id = forgeSlots[i];
      btn.classList.toggle("filled", !!id);
      btn.title = id ? "Clear slot · " + kindLabel(id) : "Clear slot";
      var num = btn.querySelector(".ge-forge-num");
      var img = btn.querySelector("img");
      if (id) {
        if (!img) {
          img = document.createElement("img");
          img.alt = "";
          btn.appendChild(img);
        }
        img.src = thumb(id);
        if (num) num.style.display = "none";
      } else {
        if (img) img.remove();
        if (num) {
          num.style.display = "";
          num.textContent = String(i + 1);
        }
      }
    }
  }

  function placeInForge(itemId) {
    itemId = Number(itemId);
    if (!itemId) return { ok: false, error: "No item." };
    if (ownedQty(itemId) < 1) return { ok: false, error: "You do not own that item." };
    var slot = -1;
    for (var i = 0; i < 3; i++) {
      if (forgeSlots[i] == null) {
        slot = i;
        break;
      }
    }
    if (slot < 0) return { ok: false, error: "Spellforge slots are full — clear one first." };
    forgeSlots[slot] = itemId;
    try {
      if (window.SpellforgeAPI && typeof window.SpellforgeAPI.equipToSlot === "function") {
        window.SpellforgeAPI.equipToSlot(itemId, slot);
      } else {
        syncForgeToSpellforge();
      }
    } catch (e) {}
    return { ok: true, slot: slot, itemId: itemId };
  }

  function clearForgeSlot(slotIndex) {
    slotIndex = Number(slotIndex);
    if (slotIndex < 0 || slotIndex > 2) return;
    forgeSlots[slotIndex] = null;
    syncForgeToSpellforge();
    renderForgeSlots();
    setForgeStatus("Cleared Spellforge slot " + (slotIndex + 1) + ".");
  }

  function showForgeResult(id) {
    var panel = $("ge-forge-result");
    if (!panel) return;
    panel.hidden = false;
    if ($("ge-forge-result-img")) $("ge-forge-result-img").src = thumb(id);
    if ($("ge-forge-result-title")) $("ge-forge-result-title").textContent = titleFor(id);
    if ($("ge-forge-result-desc")) $("ge-forge-result-desc").textContent = descFor(id);
  }

  function hideForgeResult() {
    var panel = $("ge-forge-result");
    if (panel) panel.hidden = true;
  }

  function openSpellforgeTab() {
    syncForgeToSpellforge();
    var tab = document.querySelector('.tab[data-tab="spellforge"]');
    if (tab) {
      tab.click();
      return;
    }
    try {
      window.dispatchEvent(new Event("spellforge-show"));
      if (window.SpellforgeAPI && window.SpellforgeAPI.onShow) window.SpellforgeAPI.onShow();
    } catch (e) {}
  }

  function combineForge() {
    var a = forgeSlots[0];
    var b = forgeSlots[1];
    var c = forgeSlots[2];
    if (a == null || b == null || c == null) {
      setForgeStatus("Fill all 3 Spellforge slots before combining.", true);
      return;
    }
    var parents = [Number(a), Number(b), Number(c)];
    for (var i = 0; i < 3; i++) {
      if (ownedQty(parents[i]) < 1) {
        setForgeStatus("Missing stock for " + kindLabel(parents[i]) + " (need 1 in inv or bank).", true);
        return;
      }
    }

    var titles = parents.map(titleFor);
    var descs = parents.map(fullDescFor);
    var title = titles.join(" / ");
    var description =
      descs
        .map(function (d) {
          return String(d || "").trim();
        })
        .filter(Boolean)
        .join(" ") +
      " Forged amalgam of " +
      parents.map(kindLabel).join(", ") +
      ".";

    var id = Number(state.nextForgeId) || 10001;
    state.nextForgeId = id + 1;
    var entry = {
      id: id,
      parents: parents.slice(),
      title: title,
      description: description,
      thumb: thumb(parents[0]),
      guide: Math.max(
        1,
        Math.round((guidePrice(parents[0]) + guidePrice(parents[1]) + guidePrice(parents[2])) / 2)
      ),
      createdAt: Date.now(),
    };
    if (!state.forged) state.forged = {};
    state.forged[String(id)] = entry;

    function finish(visionUrl) {
      if (visionUrl) entry.thumb = visionUrl;
      for (var j = 0; j < 3; j++) {
        if (!consumeOwned(parents[j], 1)) {
          setForgeStatus("Could not consume materials after forge.", true);
          return;
        }
      }
      addInv(PLAYER_ID, id, 1);
      forgeSlots = [null, null, null];
      syncForgeToSpellforge();
      lastForgeResult = id;
      saveState();
      showForgeResult(id);
      setForgeStatus("Forged " + titleFor(id) + " (#" + id + ") — added to inventory.");
      render();
    }

    setForgeStatus("Combining…");
    var api = window.SpellforgeAPI;
    if (api && typeof api.generateFromSlots === "function") {
      Promise.resolve()
        .then(function () {
          return api.generateFromSlots(parents.slice(), { forceCloud: true });
        })
        .then(function (url) {
          var vision = url;
          try {
            if (!vision && api.getFusion) {
              var f = api.getFusion() || {};
              vision = f.visionUrl || "";
            }
          } catch (e) {}
          finish(vision || null);
        })
        .catch(function () {
          finish(null);
        });
    } else {
      finish(null);
    }
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
        setStatus("Exchange reset — empty pack. Buy or withdraw to fill it.");
        showView("home");
        render();
      });
    }

    if ($("ge-bag-inv") && !$("ge-bag-inv").dataset.bound) {
      $("ge-bag-inv").dataset.bound = "1";
      $("ge-bag-inv").addEventListener("click", function () {
        bagView = "inv";
        renderBags();
      });
    }
    if ($("ge-bag-bank") && !$("ge-bag-bank").dataset.bound) {
      $("ge-bag-bank").dataset.bound = "1";
      $("ge-bag-bank").addEventListener("click", function () {
        bagView = "bank";
        renderBags();
      });
    }
    var invGrid = $("ge-inv-grid");
    if (invGrid && !invGrid.dataset.bound) {
      invGrid.dataset.bound = "1";
      invGrid.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-ge-inv]");
        if (!btn) return;
        selectedInvItem = Number(btn.getAttribute("data-ge-inv")) || null;
        selected = selectedInvItem || selected;
        renderBags();
      });
      invGrid.addEventListener("dblclick", function (e) {
        var btn = e.target.closest("[data-ge-inv]");
        if (!btn) return;
        var id = Number(btn.getAttribute("data-ge-inv"));
        var res = depositItem(id, 1);
        setStatus(res.ok ? "Deposited #" + id : res.error, !res.ok);
        render();
      });
      invGrid.addEventListener("contextmenu", function (e) {
        var btn = e.target.closest("[data-ge-inv]");
        if (!btn) return;
        e.preventDefault();
        var id = Number(btn.getAttribute("data-ge-inv"));
        var res = placeInForge(id);
        renderForgeSlots();
        if (!res.ok) setForgeStatus(res.error, true);
        else setForgeStatus("Placed " + kindLabel(id) + " in Spellforge slot " + (res.slot + 1) + ".");
      });
    }
    var bankGrid = $("ge-bank-grid");
    if (bankGrid && !bankGrid.dataset.bound) {
      bankGrid.dataset.bound = "1";
      bankGrid.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-ge-bank]");
        if (!btn) return;
        selectedBankItem = Number(btn.getAttribute("data-ge-bank")) || null;
        selected = selectedBankItem || selected;
        renderBags();
      });
      bankGrid.addEventListener("dblclick", function (e) {
        var btn = e.target.closest("[data-ge-bank]");
        if (!btn) return;
        var id = Number(btn.getAttribute("data-ge-bank"));
        var res = withdrawItem(id, 1);
        setStatus(res.ok ? "Withdrew #" + id : res.error, !res.ok);
        render();
      });
      bankGrid.addEventListener("contextmenu", function (e) {
        var btn = e.target.closest("[data-ge-bank]");
        if (!btn) return;
        e.preventDefault();
        var id = Number(btn.getAttribute("data-ge-bank"));
        var res = placeInForge(id);
        renderForgeSlots();
        if (!res.ok) setForgeStatus(res.error, true);
        else setForgeStatus("Placed " + kindLabel(id) + " in Spellforge slot " + (res.slot + 1) + ".");
      });
    }
    if ($("ge-dep-one") && !$("ge-dep-one").dataset.bound) {
      $("ge-dep-one").dataset.bound = "1";
      $("ge-dep-one").addEventListener("click", function () {
        if (!selectedInvItem) {
          setStatus("Select an inventory item first.", true);
          return;
        }
        var res = depositItem(selectedInvItem, qtyOf(PLAYER_ID, selectedInvItem));
        setStatus(res.ok ? "Deposited #" + selectedInvItem : res.error, !res.ok);
        selectedInvItem = null;
        render();
      });
    }
    if ($("ge-dep-all") && !$("ge-dep-all").dataset.bound) {
      $("ge-dep-all").dataset.bound = "1";
      $("ge-dep-all").addEventListener("click", function () {
        depositAll();
        setStatus("Inventory deposited to bank.");
        render();
      });
    }
    if ($("ge-wd-one") && !$("ge-wd-one").dataset.bound) {
      $("ge-wd-one").dataset.bound = "1";
      $("ge-wd-one").addEventListener("click", function () {
        if (!selectedBankItem) {
          setStatus("Select a bank item first.", true);
          return;
        }
        var res = withdrawItem(selectedBankItem, 1);
        setStatus(res.ok ? "Withdrew #" + selectedBankItem : res.error, !res.ok);
        render();
      });
    }
    if ($("ge-wd-all") && !$("ge-wd-all").dataset.bound) {
      $("ge-wd-all").dataset.bound = "1";
      $("ge-wd-all").addEventListener("click", function () {
        withdrawAllPage();
        setStatus("Withdrew this bank page into inventory (space allowing).");
        render();
      });
    }
    if ($("ge-bank-prev") && !$("ge-bank-prev").dataset.bound) {
      $("ge-bank-prev").dataset.bound = "1";
      $("ge-bank-prev").addEventListener("click", function () {
        bankPage = Math.max(0, bankPage - 1);
        renderBankGrid();
      });
    }
    if ($("ge-bank-next") && !$("ge-bank-next").dataset.bound) {
      $("ge-bank-next").dataset.bound = "1";
      $("ge-bank-next").addEventListener("click", function () {
        bankPage += 1;
        renderBankGrid();
      });
    }

    for (var fi = 0; fi < 3; fi++) {
      (function (slot) {
        var el = $("ge-forge-slot-" + slot);
        if (el && !el.dataset.bound) {
          el.dataset.bound = "1";
          el.addEventListener("click", function () {
            if (forgeSlots[slot] == null) {
              setForgeStatus("Slot " + (slot + 1) + " empty — right-click inv/bank to fill.");
              return;
            }
            clearForgeSlot(slot);
          });
        }
      })(fi);
    }
    if ($("ge-forge-combine") && !$("ge-forge-combine").dataset.bound) {
      $("ge-forge-combine").dataset.bound = "1";
      $("ge-forge-combine").addEventListener("click", combineForge);
    }
    if ($("ge-forge-open") && !$("ge-forge-open").dataset.bound) {
      $("ge-forge-open").dataset.bound = "1";
      $("ge-forge-open").addEventListener("click", openSpellforgeTab);
    }
    if ($("ge-forge-bank") && !$("ge-forge-bank").dataset.bound) {
      $("ge-forge-bank").dataset.bound = "1";
      $("ge-forge-bank").addEventListener("click", function () {
        if (!lastForgeResult) {
          setForgeStatus("No forged result to bank.", true);
          return;
        }
        var res = depositItem(lastForgeResult, 1);
        setForgeStatus(res.ok ? "Banked forged #" + lastForgeResult : res.error, !res.ok);
        render();
      });
    }
    if ($("ge-forge-sell") && !$("ge-forge-sell").dataset.bound) {
      $("ge-forge-sell").dataset.bound = "1";
      $("ge-forge-sell").addEventListener("click", function () {
        if (!lastForgeResult) {
          setForgeStatus("No forged result to sell.", true);
          return;
        }
        selected = lastForgeResult;
        openSetup("sell", 0);
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
    Promise.all([loadAnalyses(), loadRoster(), loadArsenal()]).then(function () {
      ensurePlayerStock();
      ensureNpcSeedStock();
      seedNpcOffers();
      saveState();
      showView("home");
      render();
      startTicks();
      var extras = arsenalExtraNums.length;
      setStatus(
        "Welcome to the Grand Exchange · arsenal " +
          arsenalList().length +
          " (paintings + gen/phone/sketches" +
          (extras ? " · " + extras + " extras" : "") +
          ")."
      );
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
