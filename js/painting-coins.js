/**
 * Gallery Coins — every gallery item is its own play-credit coin.
 * Paintings (P), Generated (G), Sketches (S), Inverted sketches (I), Saved videos (V),
 * Phone uploads (U) and — on the studio PC server — Characters/Objects/Places/Stasis/Fallout.
 *
 * PLAY CREDITS ONLY: shares the Slots balance (localStorage "slotsPlayCredits.v2").
 * No real money, no crypto, no cash-out, no payment links.
 *
 * Prices come from js/painting-coins-math.js. On Netlify the shared market lives in
 * /api/coins (netlify/functions/painting-coins.mjs); anywhere else it falls back to a
 * local, per-browser market. Wallet + holdings always live in this browser.
 */
(function () {
  "use strict";

  var M = window.PaintingCoinsMath;
  if (!M) return;

  var CREDITS_KEY = "slotsPlayCredits.v2"; // same key + default as js/slots.js
  var START_CREDITS = 100;
  var STORE_KEY = "galleryCoins.v1";
  var API = "/api/coins";
  var PAGE = 48;
  var POLL_MS = 20000;
  var VIEW_FLUSH_MS = 2000;
  var IS_LOCAL = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  var PUBLIC_GENERATED_ORIGIN = IS_LOCAL ? "" : "https://l7in-generated.netlify.app";

  /* ---------- shared play credits (Slots balance) ---------- */
  var PlayCredits = {
    key: CREDITS_KEY,
    get: function () {
      var n;
      try {
        n = parseInt(localStorage.getItem(CREDITS_KEY), 10);
      } catch (e) {}
      if (!isFinite(n) || n < 0) n = START_CREDITS;
      return n;
    },
    set: function (n) {
      n = Math.max(0, Math.floor(Number(n) || 0));
      try {
        localStorage.setItem(CREDITS_KEY, String(n));
      } catch (e) {}
      window.dispatchEvent(new CustomEvent("play-credits-changed", { detail: { credits: n } }));
      return n;
    },
  };
  window.PlayCredits = window.PlayCredits || PlayCredits;

  /* ---------- state ---------- */
  var wallet = loadWallet();
  var market = { mode: "idle", coins: {}, scope: "", fetchedAt: 0, promise: null };
  var items = [];
  var byKey = Object.create(null);
  var kindCounts = {};
  var itemsPromise = null;
  var itemsDone = false;
  var ui = { q: "", kind: "", sort: "number", mine: false, page: 0, selected: null, qty: 1, busy: false, msg: "", msgKind: "" };
  var pollTimer = 0;
  var viewQueue = [];
  var viewTimer = 0;
  var el = {};

  function $(id) {
    return document.getElementById(id);
  }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
  function fmt(n) {
    return Math.round(Number(n) || 0).toLocaleString();
  }
  function today() {
    var d = new Date();
    return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
  }

  function loadWallet() {
    var w = null;
    try {
      w = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
    } catch (e) {}
    w = w && typeof w === "object" ? w : {};
    return {
      h: w.h && typeof w.h === "object" ? w.h : {}, // holdings key → qty
      c: w.c && typeof w.c === "object" ? w.c : {}, // cost basis key → credits
      m: w.m && typeof w.m === "object" ? w.m : {}, // meta key → {t title, u url, f face}
      t: Array.isArray(w.t) ? w.t.slice(0, 60) : [], // recent trades
      local: w.local && typeof w.local === "object" ? w.local : {}, // local-mode market stats
      viewed: w.viewed && typeof w.viewed === "object" ? w.viewed : { day: "", keys: [] },
    };
  }
  function saveWallet() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(wallet));
    } catch (e) {}
    window.dispatchEvent(new CustomEvent("gallery-coins-changed"));
  }

  function held(key) {
    return Math.max(0, parseInt(wallet.h[key], 10) || 0);
  }
  function statsFor(key) {
    return market.mode === "shared" ? market.coins[key] : wallet.local[key];
  }
  function priceFor(key) {
    return M.priceOf(key, statsFor(key));
  }
  function portfolio() {
    var coins = 0;
    var kinds = 0;
    var value = 0;
    var cost = 0;
    Object.keys(wallet.h).forEach(function (k) {
      var q = held(k);
      if (!q || !M.validKey(k)) return;
      kinds += 1;
      coins += q;
      value += priceFor(k) * q;
      cost += Number(wallet.c[k]) || 0;
    });
    var credits = PlayCredits.get();
    return { credits: credits, coins: coins, kinds: kinds, value: value, cost: cost, net: credits + value };
  }

  /* ---------- gallery items → coins ---------- */
  function resolveUrl(raw) {
    raw = String(raw || "").trim();
    if (!raw) return "";
    if (/^(https?:|data:|blob:)/i.test(raw)) return raw;
    if (raw.indexOf("/generated/") === 0 && PUBLIC_GENERATED_ORIGIN) {
      return PUBLIC_GENERATED_ORIGIN + raw.slice("/generated".length);
    }
    return raw.charAt(0) === "/" ? raw.slice(1) : raw;
  }

  function addItem(kind, idOrNum, title, url, face, meta) {
    var key = M.keyFor(kind, idOrNum);
    if (!key || byKey[key]) return;
    var k = M.parseKey(key);
    var it = {
      key: key,
      kind: kind,
      num: k.num,
      ticker: M.ticker(key),
      title: title || k.def.label + (k.num ? " #" + k.num : ""),
      url: url || "",
      face: face || "img",
      src: meta || "",
    };
    it.hay = (it.ticker + " " + it.title + " " + k.def.label + " " + (k.num || "") + " " + key).toLowerCase();
    byKey[key] = it;
    items.push(it);
    kindCounts[kind] = (kindCounts[kind] || 0) + 1;
  }

  function getJson(url, opts) {
    return fetch(url, opts || { cache: "default" }).then(function (r) {
      if (!r.ok) throw new Error(url + " " + r.status);
      var ct = r.headers.get("content-type") || "";
      if (ct.indexOf("json") < 0 && !/\.json(\?|$)/.test(url)) throw new Error("not json");
      return r.json();
    });
  }
  function firstJson(urls) {
    var i = 0;
    function next() {
      if (i >= urls.length) return Promise.reject(new Error("none"));
      var u = urls[i++];
      return getJson(u).catch(next);
    }
    return next();
  }
  function rowsOf(data) {
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.items)) return data.items;
    return [];
  }

  function loadPaintings() {
    var p = window.loadGalleryData
      ? window.loadGalleryData()
      : getJson("data/manifest.json").then(function (m) {
          return { manifest: m, analyses: {} };
        });
    return p.then(function (data) {
      var man = (data && data.manifest) || [];
      var an = (data && data.analyses) || {};
      man.forEach(function (row) {
        var n = parseInt(row.number, 10);
        if (!n) return;
        var a = an[String(n)] || {};
        var url = window.getPaintingUrl ? window.getPaintingUrl(n) : "paintings/" + (row.filename || n + ".jpg");
        addItem("p", n, a.title ? a.title : "Painting #" + n, url, "img", "paintings");
      });
    });
  }

  function loadGenerated() {
    var pool = IS_LOCAL
      ? getJson("/api/dream-pool").then(function (d) {
          var nums = Array.isArray(d.generated_nums) ? d.generated_nums : [];
          if (!nums.length) throw new Error("empty");
          var files = d.generated_files || {};
          return nums.map(function (n) {
            return { num: n, url: "/generated/" + (files[String(n)] || n + ".jpg") };
          });
        })
      : Promise.reject(new Error("remote"));
    return pool
      .catch(function () {
        return getJson("data/lod1-manifest.json").then(rowsOf);
      })
      .then(function (rows) {
        rows.forEach(function (row) {
          var n = parseInt(row.num != null ? row.num : row.number, 10);
          if (!n) return;
          var url = resolveUrl(row.url || "/generated/" + (row.name || n + ".jpg"));
          addItem("g", n, "Generated #" + n, url, "img", "generated");
        });
      });
  }

  function loadSketches() {
    var urls = [];
    if (IS_LOCAL) urls.push("/api/sketch-manifest");
    urls.push("data/sketch-manifest.json");
    return firstJson(urls).then(function (data) {
      rowsOf(data).forEach(function (row) {
        var n = parseInt(row.num != null ? row.num : row.number, 10);
        if (!n) return;
        addItem("s", n, "Sketch #" + n, "sketches/" + n + ".png", "img", "sketches");
        addItem("si", n, "Inverted sketch #" + n, "sketches-inverted/" + n + ".png", "img", "sketches-inverted");
      });
    });
  }

  function loadVideos() {
    var urls = [];
    if (IS_LOCAL) urls.push("/api/saved-videos");
    urls.push("data/saved-videos-manifest.json");
    return firstJson(urls).then(function (data) {
      rowsOf(data).forEach(function (row) {
        var n = parseInt(row.num != null ? row.num : row.number, 10);
        if (!n) return;
        addItem("v", n, "Saved video #" + n, resolveUrl(row.url || "/saved-videos/" + n + ".mp4"), "video", "saved-videos");
      });
    });
  }

  function loadPhoneUploads() {
    return getJson("/api/transfer/list?box=phone-uploads&t=" + Date.now(), { cache: "no-store" }).then(function (data) {
      rowsOf(data).forEach(function (it) {
        var id = it.id || "phone-uploads/" + it.name;
        addItem("u", id, it.title || it.name || "Phone upload", it.url || "", "img", "phone-uploads");
      });
    });
  }

  function loadStudioCollection(kind) {
    // Characters / Objects / Places / Stasis / Fallout: only the studio PC server lists them.
    var col = M.KINDS[kind].collection;
    return getJson("/api/gallery-assets?collection=" + encodeURIComponent(col) + "&t=" + Date.now(), {
      cache: "no-store",
    }).then(function (data) {
      if (!data || data.error) return;
      rowsOf(data).forEach(function (it) {
        var id = it.id || col + "/" + (it.name || it.url);
        var title = it.title || it.entity_name || M.KINDS[kind].label;
        if (it.version != null && title.indexOf("#") < 0) title += " #" + it.version;
        addItem(kind, id, title, resolveUrl(it.url), "img", col);
      });
    });
  }

  function loadItems() {
    if (itemsPromise) return itemsPromise;
    var jobs = [loadPaintings(), loadGenerated(), loadSketches(), loadVideos(), loadPhoneUploads()];
    if (IS_LOCAL) {
      ["c", "o", "l", "x", "f"].forEach(function (k) {
        jobs.push(loadStudioCollection(k));
      });
    }
    itemsPromise = Promise.all(
      jobs.map(function (p) {
        return p
          .then(function () {
            renderAll();
          })
          .catch(function () {});
      })
    ).then(function () {
      itemsDone = true;
      renderAll();
      return items;
    });
    return itemsPromise;
  }

  /** Gallery lightbox detail → coin key. */
  var COLLECTION_KIND = {
    paintings: "p",
    generated: "g",
    sketches: "s",
    "sketches-inverted": "si",
    "saved-videos": "v",
    "phone-uploads": "u",
    characters: "c",
    objects: "o",
    places: "l",
    stasis: "x",
    fallout: "f",
  };
  function keyForGalleryItem(d) {
    if (!d) return null;
    var kind = COLLECTION_KIND[d.collection || "paintings"];
    if (!kind) return null;
    if (M.KINDS[kind].numbered) return d.number != null ? M.keyFor(kind, d.number) : null;
    return M.keyFor(kind, d.id || d.collection + "/" + (d.name || d.url));
  }

  /* ---------- market ---------- */
  function fetchMarket(force) {
    if (market.promise && !force) return market.promise;
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var to = setTimeout(function () {
      if (ctrl) ctrl.abort();
    }, 8000);
    market.promise = fetch(API + "?t=" + Date.now(), { cache: "no-store", signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) {
        var ct = r.headers.get("content-type") || "";
        if (!r.ok || ct.indexOf("json") < 0) throw new Error("no market");
        return r.json();
      })
      .then(function (j) {
        if (!j || !j.ok || !j.shared) throw new Error("no market");
        var coins = {};
        Object.keys(j.coins || {}).forEach(function (k) {
          if (M.validKey(k)) coins[k] = M.cleanStats(j.coins[k]);
        });
        market.coins = coins;
        market.mode = "shared";
        market.scope = j.scope || "";
        market.fetchedAt = Date.now();
      })
      .catch(function () {
        if (market.mode !== "shared") market.mode = "local";
      })
      .then(function () {
        clearTimeout(to);
        renderAll();
        return market;
      });
    return market.promise;
  }
  function ensureMarket() {
    return market.mode === "idle" ? fetchMarket() : market.promise || Promise.resolve(market);
  }

  /* ---------- views (opens) ---------- */
  function recordView(key) {
    if (!M.validKey(key)) return;
    var day = today();
    if (wallet.viewed.day !== day) wallet.viewed = { day: day, keys: [] };
    if (wallet.viewed.keys.indexOf(key) >= 0) return;
    wallet.viewed.keys.push(key);
    if (wallet.viewed.keys.length > 600) wallet.viewed.keys = wallet.viewed.keys.slice(-600);
    ensureMarket().then(function () {
      if (market.mode === "shared") {
        viewQueue.push(key);
        scheduleViewFlush();
      } else {
        wallet.local[key] = M.applyView(key, wallet.local[key], Date.now());
      }
      saveWallet();
      renderAll();
    });
  }
  function scheduleViewFlush() {
    if (viewTimer) return;
    viewTimer = setTimeout(flushViews, VIEW_FLUSH_MS);
  }
  function flushViews() {
    viewTimer = 0;
    if (!viewQueue.length) return;
    var batch = viewQueue.splice(0, 24);
    fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "view", coins: batch }),
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (j) {
        if (j && j.throttled) viewQueue = batch.concat(viewQueue);
        if (j && j.coins) {
          Object.keys(j.coins).forEach(function (k) {
            if (M.validKey(k)) market.coins[k] = M.cleanStats(j.coins[k]);
          });
          renderAll();
        }
      })
      .catch(function () {})
      .then(function () {
        if (viewQueue.length) scheduleViewFlush();
      });
  }

  /* ---------- trading ---------- */
  function setMsg(text, kind) {
    ui.msg = text || "";
    ui.msgKind = kind || "";
    renderDetail();
  }

  function metaFor(key) {
    var it = byKey[key];
    if (it) return { t: it.title, u: it.url, f: it.face };
    return wallet.m[key] || { t: M.ticker(key), u: "", f: "img" };
  }

  function settle(key, side, qty, total, price, stats) {
    var credits = PlayCredits.get();
    if (side === "buy") {
      PlayCredits.set(credits - total);
      wallet.h[key] = held(key) + qty;
      wallet.c[key] = (Number(wallet.c[key]) || 0) + total;
      wallet.m[key] = metaFor(key);
    } else {
      var have = held(key);
      var basis = Number(wallet.c[key]) || 0;
      PlayCredits.set(credits + total);
      var left = Math.max(0, have - qty);
      if (left) {
        wallet.h[key] = left;
        wallet.c[key] = Math.round(basis * (left / have));
      } else {
        delete wallet.h[key];
        delete wallet.c[key];
      }
    }
    wallet.t.unshift({ at: Date.now(), k: key, side: side, q: qty, total: total, px: price, mode: market.mode });
    wallet.t = wallet.t.slice(0, 60);
    if (stats) market.coins[key] = M.cleanStats(stats);
    saveWallet();
    ui.msg =
      (side === "buy" ? "Bought " : "Sold ") +
      qty +
      " × " +
      M.ticker(key) +
      " for " +
      fmt(total) +
      " play credits.";
    ui.msgKind = "ok";
    renderAll();
  }

  function trade(side) {
    var key = ui.selected;
    if (!key || ui.busy) return;
    var qty = Math.max(1, Math.min(M.RULES.maxQty, parseInt(ui.qty, 10) || 1));
    var q = M.quote(key, statsFor(key), side, qty);
    if (!q.ok) return setMsg(q.error, "err");
    var credits = PlayCredits.get();
    if (side === "buy" && q.total > credits) {
      return setMsg("Not enough play credits (" + fmt(credits) + "). Sell coins or win more in Slots.", "err");
    }
    if (side === "sell" && held(key) < qty) {
      return setMsg("You hold " + held(key) + " × " + M.ticker(key) + ".", "err");
    }
    if (market.mode !== "shared") {
      var r = M.applyTrade(key, wallet.local[key], side, qty, Date.now());
      if (!r.ok) return setMsg(r.error, "err");
      wallet.local[key] = r.stats;
      settle(key, side, qty, r.quote.total, r.quote.priceAfter, null);
      return;
    }
    ui.busy = true;
    setMsg("Placing order…", "");
    fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "trade", coin: key, side: side, qty: qty, limit: q.total }),
    })
      .then(function (r) {
        return r.json().catch(function () {
          return { ok: false, error: "Bad market response (" + r.status + ")" };
        });
      })
      .then(function (j) {
        ui.busy = false;
        if (j && j.ok) {
          settle(key, side, j.qty, j.total, j.price, j.stats);
          return;
        }
        if (j && j.priceMoved) {
          if (j.stats) market.coins[key] = M.cleanStats(j.stats);
          setMsg("Price moved — new quote " + fmt(j.quote && j.quote.total) + " credits. Tap again to confirm.", "err");
          renderAll();
          return;
        }
        setMsg((j && j.error) || "Trade failed.", "err");
      })
      .catch(function () {
        ui.busy = false;
        setMsg("Shared market unreachable — no trade was placed.", "err");
      });
  }

  function refill() {
    var p = portfolio();
    if (p.credits >= 1 || p.coins > 0) return;
    PlayCredits.set(START_CREDITS);
    ui.msg = "Refilled to " + START_CREDITS + " play credits.";
    ui.msgKind = "ok";
    renderAll();
  }

  /* ---------- rendering helpers ---------- */
  function pointsFor(key) {
    var st = M.cleanStats(statsFor(key));
    var pts = [[0, M.baseValue(key)]];
    return pts.concat(st.h);
  }
  function changePct(key) {
    var base = M.baseValue(key);
    return ((priceFor(key) - base) / base) * 100;
  }
  function sparkSvg(pts, w, h, cls) {
    var vals = pts.map(function (p) {
      return p[1];
    });
    if (vals.length < 2) vals = [vals[0] || 1, vals[0] || 1];
    var min = Math.min.apply(null, vals);
    var max = Math.max.apply(null, vals);
    var span = Math.max(1, max - min);
    var pad = 2;
    var coords = vals
      .map(function (v, i) {
        var x = pad + (i / (vals.length - 1)) * (w - pad * 2);
        var y = max === min ? h / 2 : h - pad - ((v - min) / span) * (h - pad * 2);
        return x.toFixed(1) + "," + y.toFixed(1);
      })
      .join(" ");
    var last = vals[vals.length - 1];
    var cls2 = last > vals[0] ? "up" : last < vals[0] ? "down" : "flat";
    return (
      '<svg class="' + cls + " " + cls2 + '" viewBox="0 0 ' + w + " " + h + '" preserveAspectRatio="none" aria-hidden="true">' +
      '<polyline fill="none" points="' + coords + '"/></svg>'
    );
  }
  function faceHtml(key, meta, big) {
    var k = M.parseKey(key);
    var label = k ? k.def.prefix : "?";
    var inner;
    if (meta.f === "video" || !meta.u) {
      inner =
        '<span class="pc-face-ph"><b>' + esc(label) + "</b><i>" + (meta.f === "video" ? "▶" : "✦") + "</i></span>";
      if (big && meta.f === "video" && meta.u) {
        inner +=
          '<video class="pc-face-video" muted playsinline preload="metadata" src="' +
          esc(meta.u) +
          '" onerror="this.remove()" onloadeddata="this.classList.add(\'ok\')"></video>';
      }
    } else {
      inner =
        '<img loading="lazy" decoding="async" alt="" src="' +
        esc(meta.u) +
        '" onerror="this.parentNode.classList.add(\'pc-face-broken\');this.remove()">';
    }
    return (
      '<span class="pc-face pc-kind-' + esc(k ? k.kind : "") + (big ? " pc-face--big" : "") + '" data-label="' + esc(label) + '">' +
      inner +
      "</span>"
    );
  }
  function tierClass(key) {
    return "pc-tier-" + M.rarity(key).tier.toLowerCase();
  }

  /* ---------- list ---------- */
  function filteredItems() {
    var q = ui.q.trim().toLowerCase();
    var qn = /^([a-z]{1,2})?-?0*(\d+)$/.exec(q);
    var list = items.filter(function (it) {
      if (ui.kind && it.kind !== ui.kind) return false;
      if (ui.mine && !held(it.key)) return false;
      if (!q) return true;
      if (qn && it.num === parseInt(qn[2], 10) && (!qn[1] || M.KINDS[it.kind].prefix.toLowerCase() === qn[1])) return true;
      return it.hay.indexOf(q) >= 0;
    });
    var order = {};
    M.KIND_ORDER.forEach(function (k, i) {
      order[k] = i;
    });
    var byNumber = function (a, b) {
      return order[a.kind] - order[b.kind] || (a.num || 0) - (b.num || 0) || (a.key < b.key ? -1 : 1);
    };
    var sorters = {
      number: byNumber,
      "price-desc": function (a, b) {
        return priceFor(b.key) - priceFor(a.key) || byNumber(a, b);
      },
      "price-asc": function (a, b) {
        return priceFor(a.key) - priceFor(b.key) || byNumber(a, b);
      },
      gainers: function (a, b) {
        return changePct(b.key) - changePct(a.key) || byNumber(a, b);
      },
      active: function (a, b) {
        var sa = M.cleanStats(statsFor(a.key));
        var sb = M.cleanStats(statsFor(b.key));
        return sb.b + sb.s + sb.v - (sa.b + sa.s + sa.v) || byNumber(a, b);
      },
      held: function (a, b) {
        return held(b.key) - held(a.key) || byNumber(a, b);
      },
    };
    return list.sort(sorters[ui.sort] || byNumber);
  }

  function renderCounts() {
    if (!el.counts) return;
    var total = items.length;
    var parts = M.KIND_ORDER.filter(function (k) {
      return kindCounts[k];
    }).map(function (k) {
      return '<span class="pc-count pc-kind-' + k + '"><b>' + fmt(kindCounts[k]) + "</b> " + esc(M.KINDS[k].plural) + "</span>";
    });
    el.counts.innerHTML =
      '<span class="pc-count pc-count-total"><b id="pc-total-coins">' +
      fmt(total) +
      "</b> coins" +
      (itemsDone ? "" : " (loading…)") +
      "</span>" +
      parts.join("");
    if (el.kind) {
      var cur = el.kind.value;
      el.kind.innerHTML =
        '<option value="">All kinds</option>' +
        M.KIND_ORDER.filter(function (k) {
          return kindCounts[k];
        })
          .map(function (k) {
            return '<option value="' + k + '">' + esc(M.KINDS[k].plural) + " (" + fmt(kindCounts[k]) + ")</option>";
          })
          .join("");
      el.kind.value = cur;
    }
  }

  function renderGrid() {
    if (!el.grid) return;
    var list = filteredItems();
    var pages = Math.max(1, Math.ceil(list.length / PAGE));
    if (ui.page >= pages) ui.page = pages - 1;
    if (ui.page < 0) ui.page = 0;
    var slice = list.slice(ui.page * PAGE, ui.page * PAGE + PAGE);
    if (!slice.length) {
      el.grid.innerHTML =
        '<p class="pc-empty">' + (items.length ? "No coins match." : "Loading gallery coins…") + "</p>";
    } else {
      el.grid.innerHTML = slice
        .map(function (it) {
          var px = priceFor(it.key);
          var ch = changePct(it.key);
          var h = held(it.key);
          return (
            '<button type="button" role="listitem" class="pc-card ' +
            tierClass(it.key) +
            (ui.selected === it.key ? " selected" : "") +
            (h ? " held" : "") +
            '" data-key="' +
            esc(it.key) +
            '" title="' +
            esc(it.title) +
            '">' +
            faceHtml(it.key, { u: it.url, f: it.face }, false) +
            '<span class="pc-tk">' +
            esc(it.ticker) +
            "</span>" +
            '<span class="pc-title">' +
            esc(it.title) +
            "</span>" +
            '<span class="pc-row"><span class="pc-price">' +
            fmt(px) +
            ' <small>cr</small></span><span class="pc-chg ' +
            (ch > 0.05 ? "up" : ch < -0.05 ? "down" : "flat") +
            '">' +
            (ch >= 0 ? "+" : "") +
            ch.toFixed(1) +
            "%</span></span>" +
            sparkSvg(pointsFor(it.key), 64, 18, "pc-spark") +
            (h ? '<span class="pc-held">×' + h + "</span>" : "") +
            "</button>"
          );
        })
        .join("");
    }
    if (el.page) el.page.textContent = "Page " + (ui.page + 1) + " of " + pages + " · " + fmt(list.length) + " coins";
    if (el.prev) el.prev.disabled = ui.page <= 0;
    if (el.next) el.next.disabled = ui.page >= pages - 1;
  }

  /* ---------- detail ---------- */
  function chartSvg(pts) {
    var W = 320;
    var H = 130;
    var padL = 30;
    var padR = 6;
    var padT = 10;
    var padB = 18;
    var vals = pts.map(function (p) {
      return p[1];
    });
    if (vals.length < 2) {
      vals = [vals[0], vals[0]];
      pts = [pts[0], [Date.now(), vals[0]]];
    }
    var min = Math.min.apply(null, vals);
    var max = Math.max.apply(null, vals);
    if (max === min) {
      max += 1;
      min = Math.max(0, min - 1);
    }
    var xs = function (i) {
      return padL + (i / (vals.length - 1)) * (W - padL - padR);
    };
    var ys = function (v) {
      return padT + (1 - (v - min) / (max - min)) * (H - padT - padB);
    };
    var line = vals
      .map(function (v, i) {
        return xs(i).toFixed(1) + "," + ys(v).toFixed(1);
      })
      .join(" ");
    var area = padL + "," + (H - padB) + " " + line + " " + xs(vals.length - 1).toFixed(1) + "," + (H - padB);
    var dots = vals
      .map(function (v, i) {
        return i === 0
          ? ""
          : '<circle cx="' + xs(i).toFixed(1) + '" cy="' + ys(v).toFixed(1) + '" r="2.2"><title>' +
              esc(new Date(pts[i][0]).toLocaleString() + " · " + v + " cr") +
              "</title></circle>";
      })
      .join("");
    var up = vals[vals.length - 1] >= vals[0];
    var lastT = pts[pts.length - 1][0];
    return (
      '<svg class="pc-chart ' + (up ? "up" : "down") + '" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Price history">' +
      '<line class="pc-axis" x1="' + padL + '" y1="' + (H - padB) + '" x2="' + (W - padR) + '" y2="' + (H - padB) + '"/>' +
      '<text x="' + (padL - 4) + '" y="' + (padT + 4) + '" text-anchor="end">' + fmt(max) + "</text>" +
      '<text x="' + (padL - 4) + '" y="' + (H - padB) + '" text-anchor="end">' + fmt(min) + "</text>" +
      '<text x="' + padL + '" y="' + (H - 4) + '">mint</text>' +
      '<text x="' + (W - padR) + '" y="' + (H - 4) + '" text-anchor="end">' +
      esc(lastT ? new Date(lastT).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "now") +
      "</text>" +
      '<polygon class="pc-area" points="' + area + '"/>' +
      '<polyline class="pc-line" points="' + line + '"/>' +
      dots +
      "</svg>"
    );
  }

  function renderDetail() {
    if (!el.detail) return;
    var key = ui.selected;
    if (!key || !M.validKey(key)) {
      el.detail.innerHTML =
        '<p class="pc-muted">Pick any coin to see its value breakdown, price history and trade it.</p>';
      return;
    }
    var st = M.cleanStats(statsFor(key));
    var ex = M.explain(key, st);
    var meta = metaFor(key);
    var h = held(key);
    var qty = Math.max(1, Math.min(M.RULES.maxQty, parseInt(ui.qty, 10) || 1));
    var qb = M.quote(key, st, "buy", qty);
    var qs = M.quote(key, st, "sell", qty);
    var basis = Number(wallet.c[key]) || 0;
    var value = ex.price * h;
    var pl = value - basis;
    var ch = changePct(key);
    var k = M.parseKey(key);
    var feLine = k.def.numbered
      ? " + first-edition " + ex.firstEdition
      : "";
    el.detail.innerHTML =
      '<div class="pc-d-head">' +
      faceHtml(key, meta, true) +
      '<div class="pc-d-id"><div class="pc-d-tk">' +
      esc(ex.ticker) +
      ' <span class="pc-tier ' +
      tierClass(key) +
      '">' +
      esc(ex.rarity.tier) +
      "</span></div>" +
      '<div class="pc-d-title">' +
      esc(meta.t) +
      "</div>" +
      '<div class="pc-muted">' +
      esc(ex.kindLabel) +
      (ex.number ? " #" + ex.number : "") +
      " · coin <code>" +
      esc(key) +
      "</code></div>" +
      '<div class="pc-d-price">' +
      fmt(ex.price) +
      ' <small>play credits</small> <span class="pc-chg ' +
      (ch > 0.05 ? "up" : ch < -0.05 ? "down" : "flat") +
      '">' +
      (ch >= 0 ? "+" : "") +
      ch.toFixed(1) +
      "% vs mint</span></div></div></div>" +
      '<div class="pc-d-chart"><div class="pc-d-label">Price history</div>' +
      chartSvg(pointsFor(key)) +
      '<div class="pc-muted pc-small">' +
      (st.h.length ? st.h.length + " price change" + (st.h.length === 1 ? "" : "s") + " recorded" : "No trades yet — flat at mint value") +
      (market.mode === "shared" ? " · shared by all visitors" : " · this browser only") +
      "</div></div>" +
      '<table class="pc-explain"><tbody>' +
      "<tr><th>Base</th><td>(" + ex.mint + " mint" + feLine + ") × " + esc(ex.rarity.tier) + " " + ex.rarity.mult + " (" + esc(ex.rarity.why) + ")</td><td>" + fmt(ex.base) + "</td></tr>" +
      "<tr><th>Popularity</th><td>" + fmt(ex.views) + " open" + (ex.views === 1 ? "" : "s") + " → ×" + ex.popularity.toFixed(2) + "</td><td></td></tr>" +
      "<tr><th>Demand</th><td>" + fmt(ex.bought) + " bought − " + fmt(ex.sold) + " sold (net " + (ex.net >= 0 ? "+" : "") + ex.net + ") → ×" + ex.demand.toFixed(2) + "</td><td></td></tr>" +
      "<tr class=\"pc-total\"><th>Price</th><td>" + fmt(ex.base) + " × " + ex.popularity.toFixed(2) + " × " + ex.demand.toFixed(2) + "</td><td>" + fmt(ex.price) + "</td></tr>" +
      "<tr><th>Supply</th><td colspan=\"2\">" + fmt(ex.circulating) + " / " + fmt(ex.supply) + " in circulation</td></tr>" +
      "</tbody></table>" +
      '<div class="pc-trade">' +
      '<label>Qty <input type="number" id="pc-qty" min="1" max="' + M.RULES.maxQty + '" value="' + qty + '"></label>' +
      '<button type="button" class="pc-buy" id="pc-buy"' + (ui.busy || !qb.ok ? " disabled" : "") + ">Buy " + qty + (qb.ok ? " for " + fmt(qb.total) : "") + "</button>" +
      '<button type="button" class="pc-sell" id="pc-sell"' + (ui.busy || !qs.ok || h < qty ? " disabled" : "") + ">Sell " + qty + (qs.ok ? " for " + fmt(qs.total) : "") + "</button>" +
      "</div>" +
      '<div class="pc-msg ' + esc(ui.msgKind) + '" id="pc-msg" role="status">' + esc(ui.msg) + "</div>" +
      '<div class="pc-pos">You hold <b id="pc-held">' + h + "</b> × " + esc(ex.ticker) +
      (h ? " · worth " + fmt(value) + " cr · cost " + fmt(basis) + ' · <span class="' + (pl >= 0 ? "up" : "down") + '">' + (pl >= 0 ? "+" : "") + fmt(pl) + "</span>" : "") +
      "</div>" +
      (ex.kind === "p"
        ? '<button type="button" class="pc-link" id="pc-open-painting">Open painting in gallery</button>'
        : "");
  }

  /* ---------- wallet ---------- */
  function renderHud() {
    var p = portfolio();
    var set = function (id, t) {
      var n = $(id);
      if (n) n.textContent = t;
    };
    set("pc-credits", fmt(p.credits));
    set("pc-holdings", fmt(p.value));
    set("pc-networth", fmt(p.net));
    set(
      "pc-mode",
      market.mode === "shared"
        ? "Shared" + (market.scope === "preview" ? " (preview)" : market.scope === "dev" ? " (dev)" : "")
        : market.mode === "local"
          ? "Local"
          : "…"
    );
    var rf = $("pc-refill");
    if (rf) rf.hidden = !(p.credits < 1 && p.coins === 0);
  }

  function renderWallet() {
    if (!el.wallet) return;
    var p = portfolio();
    var rows = Object.keys(wallet.h)
      .filter(function (k) {
        return held(k) > 0 && M.validKey(k);
      })
      .sort(function (a, b) {
        return priceFor(b) * held(b) - priceFor(a) * held(a);
      });
    var hold = rows.length
      ? rows
          .map(function (k) {
            var q = held(k);
            var v = priceFor(k) * q;
            var pl = v - (Number(wallet.c[k]) || 0);
            return (
              '<button type="button" class="pc-w-row" data-key="' + esc(k) + '">' +
              faceHtml(k, metaFor(k), false) +
              '<span class="pc-w-tk">' + esc(M.ticker(k)) + " <small>×" + q + "</small></span>" +
              '<span class="pc-w-v">' + fmt(v) + ' cr <small class="' + (pl >= 0 ? "up" : "down") + '">' + (pl >= 0 ? "+" : "") + fmt(pl) + "</small></span>" +
              "</button>"
            );
          })
          .join("")
      : '<p class="pc-muted">No coins yet. Pick any gallery coin and buy with play credits.</p>';
    var trades = wallet.t.slice(0, 8).map(function (t) {
      return (
        '<li><span class="' + (t.side === "buy" ? "down" : "up") + '">' + (t.side === "buy" ? "Bought" : "Sold") + "</span> " +
        t.q + " × " + esc(M.ticker(t.k)) + " · " + (t.side === "buy" ? "−" : "+") + fmt(t.total) + ' cr <small class="pc-muted">' +
        esc(new Date(t.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })) + "</small></li>"
      );
    });
    el.wallet.innerHTML =
      '<div class="pc-w-head"><h3>Your wallet</h3><span class="pc-muted">' +
      fmt(p.coins) + " coin" + (p.coins === 1 ? "" : "s") + " · " + fmt(p.kinds) + " item" + (p.kinds === 1 ? "" : "s") +
      "</span></div>" +
      '<div class="pc-w-sum"><div><span>Play credits</span><b>' + fmt(p.credits) + "</b></div><div><span>Holdings</span><b id=\"pc-w-value\">" + fmt(p.value) +
      "</b></div><div><span>Net worth</span><b>" + fmt(p.net) + "</b></div></div>" +
      '<div class="pc-w-list" id="pc-w-list">' + hold + "</div>" +
      (trades.length ? '<div class="pc-d-label">Recent trades</div><ul class="pc-w-trades">' + trades.join("") + "</ul>" : "");
  }

  /* ---------- integrations: Banker, Grand Exchange, Gallery lightbox ---------- */
  function renderBankCard() {
    var card = $("pc-bank-card");
    if (!card) return;
    var p = portfolio();
    card.innerHTML =
      '<div class="pc-bank-head"><h3>Play-credit wallet · Gallery Coins</h3>' +
      '<button type="button" class="btn-primary" data-pc-open="">Open Coins</button></div>' +
      '<div class="pc-bank-stats"><div><span>Play credits</span><strong>' + fmt(p.credits) + "</strong></div>" +
      "<div><span>Coins held</span><strong>" + fmt(p.coins) + "</strong></div>" +
      "<div><span>Coin value</span><strong>" + fmt(p.value) + " cr</strong></div>" +
      "<div><span>Net worth</span><strong>" + fmt(p.net) + " cr</strong></div></div>" +
      '<p class="bk-muted">Separate from the SIM $ ledger — play credits (shared with Slots) have no cash value and cannot be cashed out.</p>';
  }
  function renderGeChip() {
    var v = $("pc-ge-value");
    if (v) v.textContent = fmt(portfolio().value) + " cr";
  }
  var lightboxKey = null;
  function renderLightboxChip() {
    var box = $("pc-lightbox-coin");
    if (!box) return;
    if (!lightboxKey) {
      box.hidden = true;
      return;
    }
    var key = lightboxKey;
    var h = held(key);
    box.hidden = false;
    box.innerHTML =
      '<span class="pc-lb-coin ' + tierClass(key) + '">' + esc(M.ticker(key)) + "</span>" +
      '<span class="pc-lb-txt">Gallery coin · <b>' + fmt(priceFor(key)) + "</b> play credits" +
      (h ? " · you hold " + h : "") + ' <small class="pc-muted">(no cash value)</small></span>' +
      '<button type="button" class="btn-secondary" data-pc-open="' + esc(key) + '">Trade coin</button>';
  }

  function renderAll() {
    renderHud();
    renderCounts();
    renderGrid();
    renderDetail();
    renderWallet();
    renderBankCard();
    renderGeChip();
    renderLightboxChip();
  }

  /* ---------- navigation ---------- */
  function select(key) {
    if (!M.validKey(key)) return;
    if (ui.selected !== key) {
      ui.msg = "";
      ui.msgKind = "";
    }
    ui.selected = key;
    recordView(key);
    renderGrid();
    renderDetail();
  }

  function openCoins(key) {
    var lb = $("lightbox");
    if (key && lb && lb.open && typeof lb.close === "function") {
      try {
        lb.close();
      } catch (e) {}
    }
    if (window.GalleryTabs && window.GalleryTabs.showTab) window.GalleryTabs.showTab("coins");
    if (key) {
      select(key);
      var d = $("pc-detail");
      if (d && d.scrollIntoView) d.scrollIntoView({ block: "nearest" });
    }
  }

  function onShow() {
    loadItems();
    fetchMarket(market.mode !== "idle");
    var m = /[?&]c=([a-z]{1,2}:[0-9a-z]{1,8})/.exec(location.hash || "") || /[?&]coin=([a-z]{1,2}:[0-9a-z]{1,8})/.exec(location.search || "");
    if (m && M.validKey(m[1]) && !ui.selected) select(m[1]);
    if (!pollTimer) {
      pollTimer = setInterval(function () {
        if (document.body.getAttribute("data-active-tab") !== "coins" || document.hidden) return;
        if (market.mode === "shared") fetchMarket(true);
      }, POLL_MS);
    }
    renderAll();
  }
  function onHide() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = 0;
  }

  function bind() {
    el.grid = $("pc-grid");
    el.detail = $("pc-detail");
    el.wallet = $("pc-wallet");
    el.counts = $("pc-counts");
    el.kind = $("pc-kind");
    el.page = $("pc-page");
    el.prev = $("pc-prev");
    el.next = $("pc-next");
    var search = $("pc-search");
    var t = 0;
    if (search)
      search.addEventListener("input", function () {
        clearTimeout(t);
        t = setTimeout(function () {
          ui.q = search.value || "";
          ui.page = 0;
          renderGrid();
        }, 180);
      });
    if (el.kind)
      el.kind.addEventListener("change", function () {
        ui.kind = el.kind.value;
        ui.page = 0;
        renderGrid();
      });
    var sort = $("pc-sort");
    if (sort)
      sort.addEventListener("change", function () {
        ui.sort = sort.value;
        ui.page = 0;
        renderGrid();
      });
    var mine = $("pc-mine");
    if (mine)
      mine.addEventListener("change", function () {
        ui.mine = !!mine.checked;
        ui.page = 0;
        renderGrid();
      });
    if (el.prev)
      el.prev.addEventListener("click", function () {
        ui.page -= 1;
        renderGrid();
      });
    if (el.next)
      el.next.addEventListener("click", function () {
        ui.page += 1;
        renderGrid();
      });
    var rf = $("pc-refill");
    if (rf) rf.addEventListener("click", refill);
    if (el.grid)
      el.grid.addEventListener("click", function (e) {
        var c = e.target.closest(".pc-card");
        if (c) select(c.getAttribute("data-key"));
      });
    if (el.wallet)
      el.wallet.addEventListener("click", function (e) {
        var c = e.target.closest(".pc-w-row");
        if (c) select(c.getAttribute("data-key"));
      });
    if (el.detail) {
      el.detail.addEventListener("click", function (e) {
        if (e.target.id === "pc-buy") trade("buy");
        else if (e.target.id === "pc-sell") trade("sell");
        else if (e.target.id === "pc-open-painting") {
          var k = M.parseKey(ui.selected);
          if (k && k.kind === "p" && typeof window.openLightbox === "function") window.openLightbox(k.num);
        }
      });
      el.detail.addEventListener("input", function (e) {
        if (e.target.id !== "pc-qty") return;
        ui.qty = Math.max(1, Math.min(M.RULES.maxQty, parseInt(e.target.value, 10) || 1));
        var qty = ui.qty;
        var st = statsFor(ui.selected);
        var qb = M.quote(ui.selected, st, "buy", qty);
        var qs = M.quote(ui.selected, st, "sell", qty);
        var b = $("pc-buy");
        var s = $("pc-sell");
        if (b) {
          b.textContent = "Buy " + qty + (qb.ok ? " for " + fmt(qb.total) : "");
          b.disabled = ui.busy || !qb.ok;
        }
        if (s) {
          s.textContent = "Sell " + qty + (qs.ok ? " for " + fmt(qs.total) : "");
          s.disabled = ui.busy || !qs.ok || held(ui.selected) < qty;
        }
      });
    }
    // "Open Coins" buttons anywhere (Banker card, Grand Exchange HUD, lightbox chip)
    document.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("[data-pc-open]");
      if (!b) return;
      e.preventDefault();
      openCoins(b.getAttribute("data-pc-open") || "");
    });

    window.addEventListener("tab-changed", function (e) {
      var tab = e.detail && e.detail.tab;
      if (tab === "coins") onShow();
      else onHide();
      if (tab === "banker" || tab === "exchange") {
        ensureMarket().then(function () {
          renderBankCard();
          renderGeChip();
        });
        renderBankCard();
        renderGeChip();
      }
    });
    window.addEventListener("gallery-item-open", function (e) {
      var key = keyForGalleryItem(e.detail);
      lightboxKey = key;
      renderLightboxChip();
      if (key) {
        recordView(key);
        ensureMarket().then(renderLightboxChip);
      }
    });
    window.addEventListener("play-credits-changed", renderHud);
    window.addEventListener("storage", function (e) {
      if (e.key === CREDITS_KEY || e.key === STORE_KEY) {
        if (e.key === STORE_KEY) wallet = loadWallet();
        renderAll();
      }
    });
    if (document.body.getAttribute("data-active-tab") === "coins" || /^#coins\b/.test(location.hash || "")) onShow();
    else {
      renderBankCard();
      renderGeChip();
    }
  }

  window.GalleryCoins = {
    open: openCoins,
    keyForGalleryItem: keyForGalleryItem,
    portfolio: portfolio,
    refresh: function () {
      return fetchMarket(true);
    },
    loadItems: loadItems,
    __test: {
      getItems: function () {
        return items;
      },
      kindCounts: function () {
        return Object.assign({}, kindCounts);
      },
      market: function () {
        return market;
      },
      wallet: function () {
        return wallet;
      },
      trade: trade,
      select: select,
      setQty: function (q) {
        ui.qty = q;
        renderDetail();
      },
    },
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind);
  else bind();
})();
