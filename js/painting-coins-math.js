/**
 * Gallery Coins — shared, deterministic price math (browser + Netlify function).
 * EVERY gallery item is its own play-credit coin, keyed "<kind>:<id>":
 *   p:12  Painting #12 → P0012      g:12  Generated #12 → G0012
 *   s:12  Sketch #12 → S0012        si:12 Inverted sketch #12 → I0012
 *   v:12  Saved video #12 → V0012
 *   u:<hash> Phone upload → U-<HASH>  (c/o/l/x/f: Characters, Objects, Places, Stasis, Fallout)
 * Hashed kinds use a base-36 FNV-1a hash of the gallery item id (see hashId), so a coin's
 * identity never changes and new uploads get a coin automatically.
 *
 * PLAY CREDITS ONLY. No real money, no crypto, no cash-out.
 *
 * price = round( base × popularity × demand )
 *   base       = (kind mint + first-edition bonus) × rarity multiplier
 *                first-edition bonus (numbered kinds) = max(0, feMax − floor((N − 1) / feEvery))
 *                rarity (numbered): Legendary ×3 (#1, every 1000th) · Epic ×2 (every 100th)
 *                  Rare ×1.5 (every 50th, repeating digits 11/222/777) · Uncommon ×1.2
 *                  (every 10th, palindromes like 121) · Common ×1
 *                rarity (hashed ids): from the id hash — 1 in 1000 Legendary, 1 in 100 Epic,
 *                  1 in 20 Rare, 1 in 5 Uncommon
 *   popularity = 1 + min(0.5, 0.1 × log2(1 + opens))   (+10% per doubling of opens, max +50%)
 *   demand     = clamp(1 + 0.02 × net, 0.5, 3)          (net = coins bought − sold, all visitors)
 * Buying one coin costs the current price, then net +1. Selling one coin moves net −1 and
 * pays the price at that level minus a 3% exchange fee, so a buy→sell round trip never
 * creates credits.
 */
(function (root, factory) {
  if (typeof module === "object" && module && module.exports) module.exports = factory();
  else root.PaintingCoinsMath = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var RULES = {
    popStep: 0.1,
    popMax: 0.5,
    demandStep: 0.02,
    demandMin: 0.5,
    demandMax: 3,
    netMin: -25,
    supply: 1000,
    sellFee: 0.03,
    maxQty: 50,
    maxNumber: 999999,
    historyMax: 40,
  };

  /** Coin kinds. collection = the Gallery collection id it mirrors. */
  var KINDS = {
    p: { label: "Painting", plural: "Paintings", prefix: "P", collection: "paintings", numbered: true, mint: 20, feMax: 30, feEvery: 34 },
    g: { label: "Generated", plural: "Generated", prefix: "G", collection: "generated", numbered: true, mint: 8, feMax: 12, feEvery: 500 },
    s: { label: "Sketch", plural: "Sketches", prefix: "S", collection: "sketches", numbered: true, mint: 6, feMax: 10, feEvery: 520 },
    si: { label: "Inverted sketch", plural: "Inverted sketches", prefix: "I", collection: "sketches-inverted", numbered: true, mint: 6, feMax: 10, feEvery: 520 },
    v: { label: "Video", plural: "Videos", prefix: "V", collection: "saved-videos", numbered: true, mint: 15, feMax: 15, feEvery: 35 },
    u: { label: "Phone upload", plural: "Phone uploads", prefix: "U", collection: "phone-uploads", numbered: false, mint: 10 },
    c: { label: "Character", plural: "Characters", prefix: "C", collection: "characters", numbered: false, mint: 8 },
    o: { label: "Object", plural: "Objects", prefix: "O", collection: "objects", numbered: false, mint: 8 },
    l: { label: "Place", plural: "Places", prefix: "L", collection: "places", numbered: false, mint: 8 },
    x: { label: "Stasis", plural: "Stasis", prefix: "X", collection: "stasis", numbered: false, mint: 6 },
    f: { label: "Fallout", plural: "Fallout", prefix: "F", collection: "fallout", numbered: false, mint: 6 },
  };
  var KIND_ORDER = ["p", "g", "s", "si", "v", "u", "c", "o", "l", "x", "f"];

  function toInt(x) {
    var n = parseInt(x, 10);
    return isFinite(n) ? n : 0;
  }

  /** FNV-1a 32-bit → base36 (4–7 chars). Stable coin id for un-numbered gallery items. */
  function hashId(str) {
    str = String(str == null ? "" : str);
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    var s = h.toString(36);
    while (s.length < 4) s = "0" + s;
    return s;
  }

  /** "p:12" → { kind, id, num, def } or null when invalid. */
  function parseKey(key) {
    var m = /^([a-z]{1,2}):([0-9a-z]{1,8})$/.exec(String(key == null ? "" : key));
    if (!m) return null;
    var def = KINDS[m[1]];
    if (!def) return null;
    if (def.numbered) {
      if (!/^[1-9][0-9]{0,5}$/.test(m[2])) return null;
      var n = parseInt(m[2], 10);
      if (n < 1 || n > RULES.maxNumber) return null;
      return { kind: m[1], id: m[2], num: n, def: def };
    }
    if (!/^[0-9a-z]{4,8}$/.test(m[2])) return null;
    return { kind: m[1], id: m[2], num: null, def: def };
  }

  function validKey(key) {
    return !!parseKey(key);
  }

  function keyFor(kind, idOrNumber) {
    var def = KINDS[kind];
    if (!def) return null;
    var key = def.numbered ? kind + ":" + toInt(idOrNumber) : kind + ":" + hashId(idOrNumber);
    return validKey(key) ? key : null;
  }

  function ticker(key) {
    var k = parseKey(key);
    if (!k) return "?";
    if (k.def.numbered) {
      var s = String(k.num);
      while (s.length < 4) s = "0" + s;
      return k.def.prefix + s;
    }
    return k.def.prefix + "-" + k.id.toUpperCase();
  }

  function isRepdigit(n) {
    var s = String(n);
    return s.length >= 2 && /^(\d)\1+$/.test(s);
  }

  function isPalindrome(n) {
    var s = String(n);
    return s.length >= 3 && s === s.split("").reverse().join("");
  }

  function rarity(key) {
    var k = parseKey(key);
    if (!k) return { tier: "Common", mult: 1, why: "unknown item" };
    if (!k.def.numbered) {
      var h = parseInt(k.id, 36) || 0;
      if (h % 1000 === 0) return { tier: "Legendary", mult: 3, why: "1-in-1000 id hash" };
      if (h % 100 === 0) return { tier: "Epic", mult: 2, why: "1-in-100 id hash" };
      if (h % 20 === 0) return { tier: "Rare", mult: 1.5, why: "1-in-20 id hash" };
      if (h % 5 === 0) return { tier: "Uncommon", mult: 1.2, why: "1-in-5 id hash" };
      return { tier: "Common", mult: 1, why: "regular id hash" };
    }
    var n = k.num;
    var what = k.def.label.toLowerCase();
    if (n === 1) return { tier: "Legendary", mult: 3, why: "#1 — the first " + what };
    if (n % 1000 === 0) return { tier: "Legendary", mult: 3, why: "every 1000th " + what };
    if (n % 100 === 0) return { tier: "Epic", mult: 2, why: "every 100th " + what };
    if (n % 50 === 0) return { tier: "Rare", mult: 1.5, why: "every 50th " + what };
    if (isRepdigit(n)) return { tier: "Rare", mult: 1.5, why: "repeating digits" };
    if (n % 10 === 0) return { tier: "Uncommon", mult: 1.2, why: "every 10th " + what };
    if (isPalindrome(n)) return { tier: "Uncommon", mult: 1.2, why: "palindrome number" };
    return { tier: "Common", mult: 1, why: "regular " + what };
  }

  function firstEdition(key) {
    var k = parseKey(key);
    if (!k || !k.def.numbered) return 0;
    return Math.max(0, k.def.feMax - Math.floor((k.num - 1) / k.def.feEvery));
  }

  function mint(key) {
    var k = parseKey(key);
    return k ? k.def.mint : 1;
  }

  function baseValue(key) {
    return Math.max(1, Math.round((mint(key) + firstEdition(key)) * rarity(key).mult));
  }

  function popularity(views) {
    var v = Math.max(0, toInt(views));
    return 1 + Math.min(RULES.popMax, RULES.popStep * (Math.log(1 + v) / Math.LN2));
  }

  function demand(net) {
    var x = 1 + RULES.demandStep * toInt(net);
    return Math.min(RULES.demandMax, Math.max(RULES.demandMin, x));
  }

  function priceAt(key, views, net) {
    return Math.max(1, Math.round(baseValue(key) * popularity(views) * demand(net)));
  }

  /** Normalise a stats record {v opens, b bought, s sold, n net, h history [[t, price]]}. */
  function cleanStats(st) {
    st = st && typeof st === "object" ? st : {};
    var h = Array.isArray(st.h) ? st.h : [];
    return {
      v: Math.max(0, toInt(st.v)),
      b: Math.max(0, toInt(st.b)),
      s: Math.max(0, toInt(st.s)),
      n: Math.max(RULES.netMin, Math.min(RULES.supply, toInt(st.n))),
      h: h
        .filter(function (p) {
          return Array.isArray(p) && p.length >= 2 && Number(p[1]) > 0;
        })
        .map(function (p) {
          return [toInt(p[0]), Math.max(1, Math.round(Number(p[1])))];
        })
        .slice(-RULES.historyMax),
    };
  }

  function priceOf(key, st) {
    st = cleanStats(st);
    return priceAt(key, st.v, st.n);
  }

  /**
   * Quote a trade. side "buy" | "sell". Returns { ok, qty, total, avg, netAfter, priceAfter, error }.
   * Buy: pay price at net, net+1 (per coin). Sell: net−1, receive floor(price × 0.97) (per coin).
   */
  function quote(key, st, side, qty) {
    st = cleanStats(st);
    qty = toInt(qty);
    if (!validKey(key)) return { ok: false, error: "Unknown gallery item." };
    if (side !== "buy" && side !== "sell") return { ok: false, error: "Side must be buy or sell." };
    if (qty < 1 || qty > RULES.maxQty) {
      return { ok: false, error: "Quantity must be 1–" + RULES.maxQty + "." };
    }
    var net = st.n;
    var total = 0;
    for (var i = 0; i < qty; i++) {
      if (side === "buy") {
        if (net >= RULES.supply) {
          return { ok: false, error: "Supply cap reached (" + RULES.supply + " coins in circulation)." };
        }
        total += priceAt(key, st.v, net);
        net += 1;
      } else {
        net = Math.max(RULES.netMin, net - 1);
        total += Math.floor(priceAt(key, st.v, net) * (1 - RULES.sellFee));
      }
    }
    return {
      ok: true,
      side: side,
      qty: qty,
      total: total,
      avg: total / qty,
      netAfter: net,
      priceAfter: priceAt(key, st.v, net),
    };
  }

  /** Apply a trade to stats (returns a new stats object). */
  function applyTrade(key, st, side, qty, now) {
    var q = quote(key, st, side, qty);
    if (!q.ok) return { ok: false, error: q.error };
    var next = cleanStats(st);
    if (side === "buy") next.b += q.qty;
    else next.s += q.qty;
    next.n = q.netAfter;
    next.h.push([toInt(now) || Date.now(), q.priceAfter]);
    next.h = next.h.slice(-RULES.historyMax);
    return { ok: true, quote: q, stats: next };
  }

  /** Record one open (view). Adds a history point only when the price moves. */
  function applyView(key, st, now) {
    var next = cleanStats(st);
    var before = priceAt(key, next.v, next.n);
    next.v += 1;
    var after = priceAt(key, next.v, next.n);
    if (after !== before) {
      next.h.push([toInt(now) || Date.now(), after]);
      next.h = next.h.slice(-RULES.historyMax);
    }
    return next;
  }

  /** Human-readable breakdown of a coin's value. */
  function explain(key, st) {
    st = cleanStats(st);
    var k = parseKey(key);
    return {
      key: key,
      kind: k ? k.kind : "",
      kindLabel: k ? k.def.label : "",
      number: k ? k.num : null,
      ticker: ticker(key),
      mint: mint(key),
      firstEdition: firstEdition(key),
      rarity: rarity(key),
      base: baseValue(key),
      views: st.v,
      popularity: popularity(st.v),
      net: st.n,
      bought: st.b,
      sold: st.s,
      demand: demand(st.n),
      circulating: Math.max(0, st.n),
      supply: RULES.supply,
      price: priceAt(key, st.v, st.n),
    };
  }

  return {
    RULES: RULES,
    KINDS: KINDS,
    KIND_ORDER: KIND_ORDER,
    hashId: hashId,
    parseKey: parseKey,
    validKey: validKey,
    keyFor: keyFor,
    ticker: ticker,
    rarity: rarity,
    firstEdition: firstEdition,
    mint: mint,
    baseValue: baseValue,
    popularity: popularity,
    demand: demand,
    priceAt: priceAt,
    priceOf: priceOf,
    cleanStats: cleanStats,
    quote: quote,
    applyTrade: applyTrade,
    applyView: applyView,
    explain: explain,
  };
});
