/**
 * Gallery shop — cart, multi-rail checkout (Cash App / Venmo / PayPal), tips,
 * and sell hooks for paintings, generated, commercial, videos, etc.
 * Revenue → Cash App $cashtag so you can buy xAI credits.
 */
(function () {
  "use strict";

  var CART_STORAGE_KEY = "gallery.cart.v1";
  var DEFAULT_CASH_APP = "Logan7in";

  var payConfig = {
    cash_app: DEFAULT_CASH_APP,
    venmo: "",
    paypal_me: "",
    tip_presets_usd: [3, 5, 10, 25, 50],
    tip_default_usd: 5,
    tip_label: "Fans tip Logan on Cash App — post your tip link on X (do not tip yourself)",
    public_url: "https://1000-l7in.netlify.app/",
    order_note_prefix: "1000 Paintings Challenge",
    monthly_revenue_goal_usd: 10000,
    creator_payout: {
      name: "Logan Sevin",
      cash_app: DEFAULT_CASH_APP,
      monthly_usd: 300,
    },
    prices_usd: {
      paintings: 89,
      generated: 45,
      commercial: 55,
      characters: 35,
      objects: 29,
      places: 39,
      rooms: 39,
      stasis: 19,
      fallout: 15,
      videos: 29,
      "game-bosses": 25,
      "tabloid-print": 49,
      custom: 35,
      tip: 5,
    },
  };

  var cart = [];
  var pendingOrderId = null;
  var salesStats = {
    pieces_sold: 0,
    orders_completed: 0,
    revenue_raised: 0,
    month_sales_usd: 0,
    pending_orders: 0,
  };
  var payoutSummary = null;
  var gaugedPrices = {};

  function $(id) {
    return document.getElementById(id);
  }

  function cashAppTag() {
    return String(payConfig.cash_app || DEFAULT_CASH_APP).replace(/^\$/, "").trim() || DEFAULT_CASH_APP;
  }

  function escapeHtml(s) {
    var d = document.createElement("div");
    d.textContent = String(s == null ? "" : s);
    return d.innerHTML;
  }

  function formatPrice(amount) {
    var n = Number(amount) || 0;
    return n % 1 === 0 ? "$" + n.toFixed(0) : "$" + n.toFixed(2);
  }

  function getCollectionPrice(collection) {
    var g = gaugedPrices[collection];
    if (g && g.gauged_usd != null) return Number(g.gauged_usd);
    var p = payConfig.prices_usd || {};
    return p[collection] != null ? p[collection] : p.custom != null ? p.custom : 25;
  }

  function applyGaugedPrices(map) {
    if (!map || typeof map !== "object") return;
    gaugedPrices = map;
    // Refresh visible card prices if cards already rendered
    document.querySelectorAll(".card-purchase[data-shop-id]").forEach(function (wrap) {
      var priceEl = wrap.querySelector(".card-price");
      if (!priceEl) return;
      var id = wrap.getAttribute("data-shop-id") || "";
      var coll = id.split(":")[0];
      if (!coll || gaugedPrices[coll] == null) return;
      priceEl.textContent = formatPrice(getCollectionPrice(coll));
    });
  }

  function loadGaugedPrices() {
    return fetch("/api/market/prices?t=" + Date.now(), { cache: "no-store" })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (data) {
        if (data && data.gauged_prices) applyGaugedPrices(data.gauged_prices);
        return data;
      })
      .catch(function () {
        return null;
      });
  }

  function resolveImageUrl(url) {
    var raw = String(url || "").trim();
    if (!raw) return "";
    if (/^https?:\/\//i.test(raw) || raw.indexOf("data:") === 0 || raw.indexOf("blob:") === 0) {
      return raw;
    }
    if (raw.startsWith("/")) {
      var base = String(window.SPELLFORGE_API_BASE || "").replace(/\/$/, "");
      return base ? base + raw : raw;
    }
    try {
      return new URL(raw, window.location.href).href;
    } catch (e) {
      return raw;
    }
  }

  function paintingShopId(num) {
    return "painting:" + num;
  }

  function assetShopId(item) {
    if (!item) return "";
    if (item.id) return String(item.collection || "asset") + ":" + item.id;
    if (item.number != null) return String(item.collection || "asset") + ":num:" + item.number;
    if (item.url) return String(item.collection || "asset") + ":url:" + String(item.url).slice(-48);
    return "";
  }

  function fromPainting(num, title) {
    var n = parseInt(num, 10);
    if (!n) return null;
    var a =
      window.getGalleryAnalysis && window.getGalleryAnalysis(n)
        ? window.getGalleryAnalysis(n)
        : null;
    return {
      id: paintingShopId(n),
      collection: "paintings",
      title: title || (a && a.title) || "Painting #" + n,
      subtitle: "Painting #" + n,
      imageUrl: window.getPaintingUrl ? window.getPaintingUrl(n) : "paintings/" + n + ".jpg",
      price: getCollectionPrice("paintings"),
      number: n,
    };
  }

  function fromAsset(item) {
    if (!item) return null;
    var collection = item.collection || "asset";
    var title = item.title || item.entity_name || "Gallery item";
    var subtitle = item.subtitle || "";
    if (!subtitle && item.number != null && collection === "generated") {
      subtitle = "G#" + item.number;
    }
    return {
      id: assetShopId(item),
      collection: collection,
      title: title,
      subtitle: subtitle,
      imageUrl: resolveImageUrl(item.url),
      price: item.price != null ? item.price : getCollectionPrice(collection),
      number: item.number != null ? item.number : null,
      assetId: item.id || null,
      version: item.version != null ? item.version : null,
    };
  }

  /** Sell any generated/preview still or video URL from Commercial, Spellforge, etc. */
  function fromGeneratedUrl(url, opts) {
    opts = opts || {};
    var u = resolveImageUrl(url);
    if (!u) return null;
    var collection = opts.collection || "generated";
    var title = opts.title || "Generated piece";
    var id =
      opts.id ||
      collection +
        ":" +
        String(u)
          .replace(/[^a-zA-Z0-9]+/g, "-")
          .slice(-40) +
        ":" +
        (opts.stamp || Date.now());
    return {
      id: id,
      collection: collection,
      title: title,
      subtitle: opts.subtitle || collection,
      imageUrl: u,
      price: opts.price != null ? opts.price : getCollectionPrice(collection),
      number: opts.number != null ? opts.number : null,
      assetId: opts.assetId || null,
    };
  }

  function loadCart() {
    try {
      var raw = JSON.parse(localStorage.getItem(CART_STORAGE_KEY));
      cart = Array.isArray(raw) ? raw : [];
    } catch (e) {
      cart = [];
    }
  }

  function saveCart() {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
    updateCartBadge();
    dispatchCartChange();
  }

  function cartTotal() {
    return cart.reduce(function (sum, item) {
      return sum + (Number(item.price) || 0);
    }, 0);
  }

  function isInCart(id) {
    return cart.some(function (item) {
      return item.id === id;
    });
  }

  function addToCart(shopItem) {
    if (!shopItem || !shopItem.id) return false;
    if (isInCart(shopItem.id)) return false;
    cart.push({
      id: shopItem.id,
      collection: shopItem.collection,
      title: shopItem.title,
      subtitle: shopItem.subtitle || "",
      imageUrl: shopItem.imageUrl,
      price: shopItem.price,
      number: shopItem.number,
      assetId: shopItem.assetId || null,
      version: shopItem.version != null ? shopItem.version : null,
      addedAt: Date.now(),
    });
    saveCart();
    return true;
  }

  function removeFromCart(id) {
    var before = cart.length;
    cart = cart.filter(function (item) {
      return item.id !== id;
    });
    if (cart.length !== before) saveCart();
  }

  function clearCart() {
    cart = [];
    saveCart();
  }

  function cashAppPayUrl(amount) {
    var total = Math.max(1, Math.round(Number(amount) || 0));
    return "https://cash.app/$" + cashAppTag() + "/" + total;
  }

  function venmoPayUrl(amount, note) {
    var user = String(payConfig.venmo || "").replace(/^@/, "").trim();
    if (!user) return "";
    var total = Math.max(1, Math.round(Number(amount) || 0));
    var n = encodeURIComponent(String(note || payConfig.order_note_prefix || "Gallery").slice(0, 200));
    return (
      "https://venmo.com/" +
      encodeURIComponent(user) +
      "?txn=pay&amount=" +
      total +
      "&note=" +
      n
    );
  }

  function paypalPayUrl(amount) {
    var me = String(payConfig.paypal_me || "")
      .replace(/^https?:\/\/(www\.)?paypal\.me\//i, "")
      .replace(/^\//, "")
      .trim();
    if (!me) return "";
    var total = Math.max(1, Math.round(Number(amount) || 0));
    return "https://www.paypal.me/" + me.replace(/\/$/, "") + "/" + total;
  }

  function buildOrderNote(extra) {
    var lines = cart.map(function (item, i) {
      var label = item.subtitle ? item.title + " (" + item.subtitle + ")" : item.title;
      return i + 1 + ". " + label + " — " + formatPrice(item.price);
    });
    if (extra) lines.unshift(String(extra));
    lines.push("Total: " + formatPrice(cartTotal()));
    lines.push((payConfig.order_note_prefix || "Gallery") + " order");
    lines.push("Cashtag $" + cashAppTag());
    return lines.join("\n");
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () {
        return true;
      }).catch(function () {
        return false;
      });
    }
    return Promise.resolve(false);
  }

  function copyOrderNote(extra) {
    return copyText(buildOrderNote(extra));
  }

  function postOrderToServer(opts) {
    opts = opts || {};
    var items = opts.items || cart;
    if (!items.length && !opts.allowEmpty) return Promise.resolve(null);
    var payload = {
      items: items,
      total: opts.total != null ? opts.total : cartTotal(),
      cashtag: "$" + cashAppTag(),
      payment_method: opts.payment_method || "cash_app",
      order_type: opts.order_type || "sale",
      created_at: new Date().toISOString(),
    };
    return fetch("/api/gallery-orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(function (res) {
        return res.ok ? res.json() : null;
      })
      .catch(function () {
        return null;
      });
  }

  function completeOrderOnServer(orderId) {
    if (!orderId) return Promise.resolve(null);
    return fetch("/api/gallery-orders/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order_id: orderId }),
    })
      .then(function (res) {
        return res.ok ? res.json() : null;
      })
      .catch(function () {
        return null;
      });
  }

  function applySalesStats(stats) {
    if (!stats) return;
    salesStats = Object.assign({}, salesStats, stats);
    var pieces = String(stats.pieces_sold || 0);
    var revenue = formatPrice(stats.revenue_raised || 0);
    var orders = String(stats.orders_completed || 0);
    ["gallery-sales-pieces", "gallery-cart-sales-pieces", "money-hud-pieces"].forEach(function (id) {
      var el = $(id);
      if (el) el.textContent = pieces;
    });
    ["gallery-sales-revenue", "gallery-cart-sales-revenue", "money-hud-revenue"].forEach(function (id) {
      var el = $(id);
      if (el) el.textContent = revenue;
    });
    var ordersEl = $("gallery-sales-orders");
    if (ordersEl) ordersEl.textContent = orders;
    if (stats.month_sales_usd != null) {
      var monthEl = $("money-hud-month");
      if (monthEl) monthEl.textContent = formatPrice(stats.month_sales_usd);
    }
    window.dispatchEvent(new CustomEvent("gallery-sales-update", { detail: stats }));
  }

  function applyPayoutSummary(data) {
    if (!data || data.ok === false) return;
    payoutSummary = data;
    var stipend = Number(data.monthly_stipend_usd || data.monthly_usd) || 300;
    var paid = Number(data.paid_this_month_usd) || 0;
    var rem = Number(data.remaining_this_month_usd);
    if (isNaN(rem)) rem = Math.max(0, stipend - paid);
    var monthSales = Number(data.month_sales_usd);
    if (isNaN(monthSales) && salesStats.month_sales_usd != null) {
      monthSales = Number(salesStats.month_sales_usd) || 0;
    }
    if (isNaN(monthSales)) monthSales = 0;
    var goal = Number(data.monthly_revenue_goal_usd || payConfig.monthly_revenue_goal_usd) || 10000;
    var cash = String(data.cash_app || cashAppTag()).replace(/^\$/, "");
    var name = data.payee || (payConfig.creator_payout && payConfig.creator_payout.name) || "Logan Sevin";

    if (data.config && data.config.creator_payout) {
      payConfig.creator_payout = Object.assign({}, payConfig.creator_payout, data.config.creator_payout);
      if (data.config.creator_payout.cash_app) payConfig.cash_app = data.config.creator_payout.cash_app;
    }
    if (data.config && data.config.monthly_revenue_goal_usd) {
      payConfig.monthly_revenue_goal_usd = data.config.monthly_revenue_goal_usd;
    }

    var dueEl = $("money-hud-creator-due");
    if (dueEl) dueEl.textContent = rem <= 0 ? "paid" : formatPrice(rem);

    var monthHud = $("money-hud-month");
    if (monthHud) monthHud.textContent = formatPrice(monthSales);

    var paidEl = $("creator-paid");
    if (paidEl) paidEl.textContent = formatPrice(paid) + " / " + formatPrice(stipend);
    var remEl = $("creator-remaining");
    if (remEl) remEl.textContent = formatPrice(rem);
    var salesEl = $("creator-month-sales");
    if (salesEl) salesEl.textContent = formatPrice(monthSales);
    var goalEl = $("creator-rev-goal");
    if (goalEl) goalEl.textContent = "$" + goal.toLocaleString() + "/mo";
    var bar = $("creator-goal-bar");
    if (bar) {
      var pct = Math.min(100, Math.round((monthSales / goal) * 100));
      bar.style.width = pct + "%";
    }

    var payAmt = rem > 0 ? Math.round(rem) : Math.round(stipend);
    var cashLink = $("creator-cashapp-link");
    if (cashLink) {
      cashLink.href = "https://cash.app/$" + encodeURIComponent(cash) + "/" + payAmt;
      cashLink.textContent =
        rem <= 0 ? "Open Cash App $" + cash : "Open Cash App $" + payAmt + " to $" + cash;
    }
    var mark = $("creator-payout-mark");
    if (mark) {
      mark.disabled = rem <= 0;
      mark.textContent = rem <= 0 ? "Stipend logged for this month" : "I sent $" + payAmt + " — log it";
      mark.dataset.amount = String(payAmt);
      mark.dataset.cash = cash;
      mark.dataset.name = name;
    }
    updateCashtagLabels();
  }

  function loadCreatorPayouts() {
    return fetch("/api/creator-payouts?t=" + Date.now(), { cache: "no-store" })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (data) {
        if (data) applyPayoutSummary(data);
        return data;
      })
      .catch(function () {
        return null;
      });
  }

  function recordCreatorPayout(amount) {
    var cash = cashAppTag();
    return fetch("/api/creator-payouts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "record",
        amount_usd: amount,
        amount: amount,
        method: "cash_app",
        cashtag: cash,
        note: "Monthly site stipend",
      }),
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (data && data.ok && data.summary) applyPayoutSummary(data.summary);
        else if (data && data.ok) return loadCreatorPayouts();
        return data;
      });
  }

  function fetchSalesStats() {
    return fetch("/api/gallery-sales-stats?t=" + Date.now())
      .then(function (res) {
        return res.ok ? res.json() : null;
      })
      .then(function (data) {
        if (data) applySalesStats(data);
        return data;
      })
      .catch(function () {
        return null;
      });
  }

  function loadPaymentConfig() {
    return fetch("/api/payment-config?t=" + Date.now(), { cache: "no-store" })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (d) {
        if (!d || typeof d !== "object") return payConfig;
        if (d.cash_app) payConfig.cash_app = String(d.cash_app).replace(/^\$/, "");
        if (d.venmo != null) payConfig.venmo = String(d.venmo || "");
        if (d.paypal_me != null) payConfig.paypal_me = String(d.paypal_me || "");
        if (Array.isArray(d.tip_presets_usd) && d.tip_presets_usd.length) {
          payConfig.tip_presets_usd = d.tip_presets_usd;
        }
        if (d.tip_default_usd != null) payConfig.tip_default_usd = d.tip_default_usd;
        if (d.tip_label) payConfig.tip_label = d.tip_label;
        if (d.public_url) payConfig.public_url = d.public_url;
        if (d.order_note_prefix) payConfig.order_note_prefix = d.order_note_prefix;
        if (d.monthly_revenue_goal_usd != null) {
          payConfig.monthly_revenue_goal_usd = Number(d.monthly_revenue_goal_usd) || 10000;
        }
        if (d.creator_payout && typeof d.creator_payout === "object") {
          payConfig.creator_payout = Object.assign({}, payConfig.creator_payout, d.creator_payout);
          if (d.creator_payout.cash_app) {
            payConfig.cash_app = String(d.creator_payout.cash_app).replace(/^\$/, "");
          }
        }
        if (d.prices_usd && typeof d.prices_usd === "object") {
          payConfig.prices_usd = Object.assign({}, payConfig.prices_usd, d.prices_usd);
        }
        renderTipButtons();
        renderPayMethodButtons();
        updateCashtagLabels();
        return payConfig;
      })
      .catch(function () {
        renderTipButtons();
        renderPayMethodButtons();
        updateCashtagLabels();
        return payConfig;
      });
  }

  function updateCashtagLabels() {
    var tag = "$" + cashAppTag();
    document.querySelectorAll("[data-cash-app-tag]").forEach(function (el) {
      el.textContent = tag;
      if (el.tagName === "A") el.href = "https://cash.app/" + tag;
    });
    document.querySelectorAll(".lightbox-purchase-hint").forEach(function (el) {
      el.textContent = "Checkout via Cash App — " + tag + (payConfig.venmo ? " · Venmo @" + payConfig.venmo : "") + (payConfig.paypal_me ? " · PayPal" : "");
    });
  }

  function showConfirmPayment(show) {
    var btn = $("gallery-cart-confirm");
    if (btn) btn.hidden = !show;
  }

  function updateCartBadge() {
    var n = cart.length;
    ["gallery-cart-btn", "money-hud-cart"].forEach(function (id) {
      var btn = $(id);
      if (!btn) return;
      var countEl = btn.querySelector(".gallery-cart-count") || $(id === "gallery-cart-btn" ? "gallery-cart-count" : "money-hud-cart-count");
      if (countEl) {
        countEl.textContent = String(n);
        countEl.hidden = n === 0;
      }
      btn.setAttribute("aria-label", n ? "Cart, " + n + " item" + (n === 1 ? "" : "s") : "Cart, empty");
    });
  }

  function dispatchCartChange() {
    window.dispatchEvent(new CustomEvent("gallery-cart-change", { detail: { count: cart.length } }));
  }

  function cardPurchaseHtml(shopItem) {
    if (!shopItem) return "";
    var inCart = isInCart(shopItem.id);
    return (
      '<div class="card-purchase" data-shop-id="' +
      escapeHtml(shopItem.id) +
      '">' +
      '<span class="card-price">' +
      escapeHtml(formatPrice(shopItem.price)) +
      "</span>" +
      '<button type="button" class="btn-card-buy' +
      (inCart ? " in-cart" : "") +
      '" data-shop-action="add" aria-label="Add ' +
      escapeHtml(shopItem.title) +
      ' to cart">' +
      (inCart ? "In cart" : "Add") +
      "</button>" +
      "</div>"
    );
  }

  function bindCardPurchase(card, shopItem) {
    if (!card || !shopItem) return;
    var wrap = card.querySelector(".card-purchase");
    if (!wrap) return;
    var btn = wrap.querySelector("[data-shop-action='add']");
    if (!btn) return;
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (isInCart(shopItem.id)) {
        openCheckout();
        return;
      }
      addToCart(shopItem);
      btn.textContent = "In cart";
      btn.classList.add("in-cart");
    });
  }

  function refreshCardPurchaseStates() {
    document.querySelectorAll(".card-purchase").forEach(function (wrap) {
      var id = wrap.getAttribute("data-shop-id");
      var btn = wrap.querySelector("[data-shop-action='add']");
      if (!btn || !id) return;
      var inCart = isInCart(id);
      btn.textContent = inCart ? "In cart" : "Add";
      btn.classList.toggle("in-cart", inCart);
    });
  }

  function updateLightbox(shopItem) {
    var block = $("lightbox-purchase");
    if (!block) return;
    if (!shopItem) {
      block.hidden = true;
      return;
    }
    block.hidden = false;
    var priceEl = $("lightbox-price");
    var addBtn = $("lightbox-add-cart");
    var buyBtn = $("lightbox-buy-now");
    if (priceEl) priceEl.textContent = formatPrice(shopItem.price);
    var inCart = isInCart(shopItem.id);
    if (addBtn) {
      addBtn.textContent = inCart ? "In cart — view checkout" : "Add to cart";
      addBtn.dataset.inCart = inCart ? "1" : "0";
    }
    if (buyBtn) buyBtn.textContent = "Buy now — " + formatPrice(shopItem.price);
    block.dataset.shopId = shopItem.id;
    block._shopItem = shopItem;
  }

  function renderCheckoutList() {
    var list = $("gallery-cart-list");
    var empty = $("gallery-cart-empty");
    var summary = $("gallery-cart-summary");
    var totalEl = $("gallery-cart-total");
    var payBtn = $("gallery-cart-pay");
    if (!list) return;

    list.innerHTML = "";
    if (!cart.length) {
      if (empty) empty.hidden = false;
      if (summary) summary.hidden = true;
      if (payBtn) payBtn.disabled = true;
      renderPayMethodButtons();
      return;
    }

    if (empty) empty.hidden = true;
    if (summary) summary.hidden = false;

    cart.forEach(function (item) {
      var row = document.createElement("li");
      row.className = "gallery-cart-item";
      row.innerHTML =
        '<div class="gallery-cart-item-thumb">' +
        (item.imageUrl
          ? '<img src="' + escapeHtml(item.imageUrl) + '" alt="" loading="lazy" />'
          : "") +
        "</div>" +
        '<div class="gallery-cart-item-meta">' +
        '<div class="gallery-cart-item-title">' +
        escapeHtml(item.title) +
        "</div>" +
        (item.subtitle
          ? '<div class="gallery-cart-item-sub">' + escapeHtml(item.subtitle) + "</div>"
          : "") +
        '<div class="gallery-cart-item-collection">' +
        escapeHtml(item.collection) +
        "</div>" +
        "</div>" +
        '<div class="gallery-cart-item-price">' +
        escapeHtml(formatPrice(item.price)) +
        "</div>" +
        '<button type="button" class="gallery-cart-remove" data-remove-id="' +
        escapeHtml(item.id) +
        '" aria-label="Remove">&times;</button>';
      list.appendChild(row);
    });

    list.querySelectorAll("[data-remove-id]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        removeFromCart(btn.getAttribute("data-remove-id"));
        renderCheckoutList();
        refreshCardPurchaseStates();
        var block = $("lightbox-purchase");
        if (block && block._shopItem) updateLightbox(block._shopItem);
      });
    });

    var total = cartTotal();
    if (totalEl) totalEl.textContent = formatPrice(total);
    if (payBtn) {
      payBtn.disabled = false;
      payBtn.textContent = "Pay " + formatPrice(total) + " with Cash App";
    }
    renderPayMethodButtons();
  }

  function renderPayMethodButtons() {
    var wrap = $("gallery-cart-pay-methods");
    if (!wrap) return;
    wrap.innerHTML = "";
    var total = cartTotal();
    if (!cart.length) return;

    function addPay(label, url, method) {
      if (!url) return;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn-primary gallery-pay-method-btn";
      btn.textContent = label + " " + formatPrice(total);
      btn.addEventListener("click", function () {
        startCheckout(method, url);
      });
      wrap.appendChild(btn);
    }

    addPay("Cash App", cashAppPayUrl(total), "cash_app");
    var v = venmoPayUrl(total, buildOrderNote().slice(0, 180));
    if (v) addPay("Venmo", v, "venmo");
    var p = paypalPayUrl(total);
    if (p) addPay("PayPal", p, "paypal");
  }

  function startCheckout(method, url) {
    if (!cart.length) return;
    copyOrderNote();
    postOrderToServer({ payment_method: method || "cash_app" }).then(function (data) {
      if (data && data.order_id) {
        pendingOrderId = data.order_id;
        showConfirmPayment(true);
      }
      if (data && data.stats) applySalesStats(data.stats);
    });
    if (url) window.open(url, "_blank", "noopener,noreferrer");
    var status = $("gallery-cart-status");
    if (status) {
      status.textContent =
        "Order summary copied. Complete payment, paste the note if asked, then click I've sent payment.";
      status.hidden = false;
    }
  }

  function openCheckout() {
    var dlg = $("gallery-cart-dialog");
    if (!dlg) return;
    renderCheckoutList();
    if (window.galleryDialog) window.galleryDialog.open(dlg);
    else if (dlg.showModal) dlg.showModal();
  }

  function closeCheckout() {
    var dlg = $("gallery-cart-dialog");
    if (!dlg) return;
    if (window.galleryDialog) window.galleryDialog.close(dlg);
    else if (dlg.close) dlg.close();
  }

  function renderTipButtons() {
    var wrap = $("tip-presets");
    if (!wrap) return;
    wrap.innerHTML = "";
    var presets = payConfig.tip_presets_usd || [5, 10, 25, 50];
    presets.forEach(function (amt) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn-secondary tip-preset-btn";
      btn.textContent = "Fan " + formatPrice(amt);
      btn.title = "Opens Cash App so a fan can tip Logan — not a self-tip";
      btn.addEventListener("click", function () {
        btn.classList.add("mx-pulse");
        setTimeout(function () {
          btn.classList.remove("mx-pulse");
        }, 600);
        sendTip(amt);
      });
      wrap.appendChild(btn);
    });
    var shareX = document.createElement("button");
    shareX.type = "button";
    shareX.className = "btn-primary tip-preset-btn mx-btn-x";
    shareX.textContent = "Post tip jar on X";
    shareX.title = "Share your tip link so others pay you";
    shareX.addEventListener("click", function () {
      if (window.MonetizeX && MonetizeX.openX) {
        var posts = MonetizeX.postTemplates();
        MonetizeX.openX(posts[0].text);
      } else {
        var site = payConfig.public_url || "https://1000-l7in.netlify.app/";
        var text =
          "Original art by Logan Sevin · tip $Logan7in https://cash.app/$Logan7in · © Logan Sevin · gallery " +
          site;
        window.open(
          "https://twitter.com/intent/tweet?text=" + encodeURIComponent(text),
          "_blank",
          "noopener,noreferrer"
        );
      }
      var st = $("tip-status");
      if (st) {
        st.textContent = "X opened — post so fans tip you. You do not tip yourself.";
        st.hidden = false;
      }
    });
    wrap.appendChild(shareX);
    var label = $("tip-label");
    if (label) {
      label.textContent =
        payConfig.tip_label ||
        "Fans tip Logan — post your Cash App on X (do not tip yourself)";
    }
  }

  function sendTip(amount) {
    var total = Math.max(1, Math.round(Number(amount) || payConfig.tip_default_usd || 10));
    var tipItem = {
      id: "tip:" + Date.now(),
      collection: "tip",
      title: "Fan tip for Logan Sevin",
      subtitle: "Visitor support via Cash App",
      imageUrl: "",
      price: total,
    };
    var note =
      (payConfig.order_note_prefix || "Gallery") +
      " FAN TIP $" +
      total +
      " for Logan Sevin — thank you!";
    copyText(note);
    postOrderToServer({
      items: [tipItem],
      total: total,
      payment_method: "cash_app",
      order_type: "tip",
      allowEmpty: false,
    }).then(function (data) {
      if (data && data.order_id) {
        pendingOrderId = data.order_id;
      }
      if (data && data.stats) applySalesStats(data.stats);
    });
    window.open(cashAppPayUrl(total), "_blank", "noopener,noreferrer");
    var status = $("tip-status");
    if (status) {
      status.textContent =
        "Cash App opened for a $" +
        total +
        " fan tip to $" +
        cashAppTag() +
        ". If YOU are Logan: close this and use “Post tip jar on X” instead — do not pay yourself.";
      status.hidden = false;
    }
    var conf = $("tip-confirm");
    if (conf) conf.hidden = false;
  }

  function sellCurrentImage(url, opts) {
    var item = fromGeneratedUrl(url, opts || {});
    if (!item) return false;
    addToCart(item);
    openCheckout();
    return true;
  }

  function bindEvents() {
    var cartBtn = $("gallery-cart-btn");
    if (cartBtn) {
      cartBtn.addEventListener("click", function () {
        openCheckout();
      });
    }
    var moneyCart = $("money-hud-cart");
    if (moneyCart) {
      moneyCart.addEventListener("click", function () {
        openCheckout();
      });
    }
    // money-hud-tip handled by monetize-x.js (Get paid → Income / X share)
    var moneyPay = $("money-hud-pay");
    if (moneyPay) {
      moneyPay.addEventListener("click", function () {
        var panel = $("creator-payout-panel");
        if (panel) {
          panel.scrollIntoView({ behavior: "smooth", block: "center" });
          panel.classList.add("pulse-highlight");
          setTimeout(function () {
            panel.classList.remove("pulse-highlight");
          }, 1200);
        }
      });
    }
    var moneyIncome = $("money-hud-income");
    if (moneyIncome) {
      moneyIncome.addEventListener("click", function () {
        var tab = document.querySelector('.site-tabs .tab[data-tab="income"]');
        if (tab) tab.click();
        else {
          var panel = $("panel-income");
          if (panel) {
            panel.hidden = false;
            panel.scrollIntoView({ behavior: "smooth", block: "start" });
          }
        }
      });
    }
    var markPayout = $("creator-payout-mark");
    if (markPayout) {
      markPayout.addEventListener("click", function () {
        var amt = Number(markPayout.dataset.amount) || 300;
        var status = $("creator-payout-status");
        markPayout.disabled = true;
        if (status) {
          status.textContent = "Logging Cash App stipend…";
          status.hidden = false;
        }
        recordCreatorPayout(amt)
          .then(function (data) {
            if (status) {
              if (data && data.ok === false) {
                status.textContent = "Could not log payout — is the gallery server running?";
                markPayout.disabled = false;
              } else {
                status.textContent =
                  "Logged $" +
                  amt +
                  " Cash App stipend. Use sales/tips to fund xAI credits at console.x.ai.";
              }
              status.hidden = false;
            }
          })
          .catch(function () {
            if (status) {
              status.textContent = "Could not log payout — is the gallery server running?";
              status.hidden = false;
            }
            markPayout.disabled = false;
          });
      });
    }

    $("gallery-cart-close") &&
      $("gallery-cart-close").addEventListener("click", closeCheckout);
    $("gallery-cart-cancel") &&
      $("gallery-cart-cancel").addEventListener("click", closeCheckout);

    $("gallery-cart-dialog") &&
      $("gallery-cart-dialog").addEventListener("click", function (e) {
        if (e.target === $("gallery-cart-dialog")) closeCheckout();
      });

    $("gallery-cart-clear") &&
      $("gallery-cart-clear").addEventListener("click", function () {
        clearCart();
        renderCheckoutList();
        refreshCardPurchaseStates();
        var block = $("lightbox-purchase");
        if (block && block._shopItem) updateLightbox(block._shopItem);
      });

    $("gallery-cart-pay") &&
      $("gallery-cart-pay").addEventListener("click", function () {
        startCheckout("cash_app", cashAppPayUrl(cartTotal()));
      });

    $("gallery-cart-confirm") &&
      $("gallery-cart-confirm").addEventListener("click", function () {
        if (!pendingOrderId) return;
        var status = $("gallery-cart-status");
        var orderId = pendingOrderId;
        var soldItems = cart.slice();
        if (status) {
          status.textContent = "Recording sale… downloading clean art (no Cash App QR)…";
          status.hidden = false;
        }
        completeOrderOnServer(orderId).then(function (data) {
          if (data && data.stats) applySalesStats(data.stats);
          pendingOrderId = null;
          showConfirmPayment(false);
          // Buyer delivery: clean file without QR; delist watermarked X listing
          if (window.SaleArtX && SaleArtX.onSaleComplete) {
            SaleArtX.onSaleComplete(soldItems, orderId);
          }
          clearCart();
          renderCheckoutList();
          refreshCardPurchaseStates();
          if (status) {
            status.textContent =
              "Sale recorded. Clean image(s) downloading (QR removed). Cash App $ is real spendable income.";
            status.hidden = false;
          }
        });
      });

    $("tip-confirm") &&
      $("tip-confirm").addEventListener("click", function () {
        if (!pendingOrderId) {
          var st = $("tip-status");
          if (st) {
            st.textContent = "Tip flow opened — if you already paid, thank you!";
            st.hidden = false;
          }
          return;
        }
        completeOrderOnServer(pendingOrderId).then(function (data) {
          if (data && data.stats) applySalesStats(data.stats);
          pendingOrderId = null;
          var conf = $("tip-confirm");
          if (conf) conf.hidden = true;
          var st = $("tip-status");
          if (st) {
            st.textContent = "Tip recorded — thank you! That helps buy more generation credits.";
            st.hidden = false;
          }
        });
      });

    $("lightbox-add-cart") &&
      $("lightbox-add-cart").addEventListener("click", function () {
        var block = $("lightbox-purchase");
        if (!block || !block._shopItem) return;
        if (block._shopItem && isInCart(block._shopItem.id)) {
          openCheckout();
          return;
        }
        addToCart(block._shopItem);
        updateLightbox(block._shopItem);
        refreshCardPurchaseStates();
      });

    $("lightbox-buy-now") &&
      $("lightbox-buy-now").addEventListener("click", function () {
        var block = $("lightbox-purchase");
        if (!block || !block._shopItem) return;
        if (!isInCart(block._shopItem.id)) addToCart(block._shopItem);
        updateLightbox(block._shopItem);
        refreshCardPurchaseStates();
        openCheckout();
        setTimeout(function () {
          startCheckout("cash_app", cashAppPayUrl(cartTotal()));
        }, 200);
      });

    window.addEventListener("gallery-cart-change", refreshCardPurchaseStates);
  }

  loadCart();
  bindEvents();
  updateCartBadge();
  loadPaymentConfig().then(function () {
    return Promise.all([fetchSalesStats(), loadCreatorPayouts(), loadGaugedPrices()]);
  });
  setInterval(function () {
    fetchSalesStats();
    loadCreatorPayouts();
    loadGaugedPrices();
  }, 30000);

  window.GalleryShop = {
    fromPainting: fromPainting,
    fromAsset: fromAsset,
    fromGeneratedUrl: fromGeneratedUrl,
    addToCart: addToCart,
    removeFromCart: removeFromCart,
    clearCart: clearCart,
    isInCart: isInCart,
    formatPrice: formatPrice,
    getCollectionPrice: getCollectionPrice,
    cardPurchaseHtml: cardPurchaseHtml,
    bindCardPurchase: bindCardPurchase,
    updateLightbox: updateLightbox,
    openCheckout: openCheckout,
    sellCurrentImage: sellCurrentImage,
    sendTip: sendTip,
    cashAppPayUrl: cashAppPayUrl,
    getPaymentConfig: function () {
      return Object.assign({}, payConfig);
    },
    getCart: function () {
      return cart.slice();
    },
    getCartCount: function () {
      return cart.length;
    },
    fetchSalesStats: fetchSalesStats,
    getSalesStats: function () {
      return Object.assign({}, salesStats);
    },
    reloadPaymentConfig: loadPaymentConfig,
    loadCreatorPayouts: loadCreatorPayouts,
    recordCreatorPayout: recordCreatorPayout,
    getPayoutSummary: function () {
      return payoutSummary ? Object.assign({}, payoutSummary) : null;
    },
    applyGaugedPrices: applyGaugedPrices,
    loadGaugedPrices: loadGaugedPrices,
    getGaugedPrices: function () {
      return Object.assign({}, gaugedPrices);
    },
  };
})();
