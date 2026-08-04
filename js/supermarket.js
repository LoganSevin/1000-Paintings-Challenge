/**
 * Art Supermarket — interactive sim floor.
 * 99 NPC shoppers + you as #100 (WASD). Shelves stocked by gallery price count @ $1.
 * Empty = gray; click restock random or deliberate. Receipt ledger → generate image/video.
 */
(function () {
  "use strict";

  var PROMPT_MAX = 8000;
  /** Checkout when cart prompt is positively high under 8000 (healthy fill). */
  var PROMPT_SPLURGE_RATIO = 0.93;
  var PROMPT_HARD_RATIO = 0.985;
  /** Hard ceiling — never 100+ impulse piles; vision is a few strong pieces, not 185. */
  var MAX_CART_ITEMS = 16;
  /** How many distinct visual seeds can appear in the generate prompt. */
  var MAX_VISION_IDEAS = 12;
  var BATHROOM_DWELL = 2.2;
  var STORAGE_DAY_LOG = "gallery.supermarket.daylog.v2";
  var NPC_COUNT = 99;
  /**
   * 13 aisles, each face is a flat grid:
   *   5 cells left→right, 8 cells up→down, 2 faces back-to-back.
   * Entrance + exit + registers all sit on the bottom strip.
   */
  var AISLE_COUNT = 13;
  var COLS_LR = 5;
  var ROWS_UD = 8;
  var SIDES = 2;
  var REGISTER_COUNT = 11;
  var KIOSK_COUNT = 6;
  var WAVE_COOLDOWN_MS = 12000;
  var UNIT_PRICE = 1;
  /** Personal space: OK with ≤3 nearby; 4+ feels crowded and they spread out */
  var SOCIAL_RADIUS = 36;
  var SOCIAL_COMFORT = 3;
  var CHAT_COOLDOWN = 4.5;
  var NEAR_SHELF_DIST = 52;
  var STUCK_TIMEOUT = 2.2;
  var STUCK_HARD_BAIL = 2;
  /** Full-intent walk times (seconds) used to calibrate speed */
  var TIME_AISLE_UP_DOWN = 4;
  var TIME_CROSS_TO_LAST = 9;
  var paceV = 80;
  var paceH = 100;
  var NAMES = [
    "Ava", "Ben", "Cora", "Drew", "Eden", "Finn", "Gia", "Hank", "Ivy", "Jules",
    "Kai", "Lena", "Milo", "Noa", "Ollie", "Pia", "Quinn", "Remy", "Sage", "Tess",
    "Uma", "Vee", "Wren", "Xan", "Yara", "Zed", "Ash", "Bea", "Cy", "Dee",
    "Eli", "Faye", "Gus", "Hal", "Ina", "Jo", "Kit", "Lux", "Mae", "Ned",
    "Ora", "Pip", "Rio", "Sky", "Ty", "Uri", "Val", "Wes", "Xi", "Yen",
    "Zoe", "Art", "Bo", "Cal", "Dot", "Eve", "Fox", "Gem", "Hue", "Ion",
    "Jax", "Kip", "Lou", "Max", "Nix", "Oak", "Pax", "Rex", "Sol", "Tao",
    "Ula", "Vic", "Will", "Xio", "Yul", "Zan", "Ace", "Bay", "Cam", "Dan",
    "Em", "Flo", "Gil", "Hoy", "Ike", "Jay", "Ken", "Lee", "Mo", "Nan",
    "Oz", "Pat", "Ray", "Sam", "Tim", "Una", "Von", "Wyn", "Yaz",
  ];
  var STORAGE_NAMES = "gallery.supermarket.names.v1";

  var canvas, ctx;
  var W = 1180;
  var H = 640;
  var running = false;
  var lastTs = 0;
  var raf = 0;
  var keys = {};
  var selectedShelf = null;
  var selectedShopper = null;
  var waveActive = false;
  var waveCooldownUntil = 0;
  var catalog = [];
  var shelves = [];
  /** Solid blocks you cannot walk through (each double-sided aisle unit) */
  var solids = [];
  var shoppers = [];
  var player = null;
  var receipts = [];
  var chatBubbles = [];
  var nearShelf = null;
  /** When near a face: the 5 cells L→R in that row (vicinity selection) */
  var vicinityGroup = [];
  var vicinityIndex = 0;
  var simDay = 1;
  var dayLogs = {};
  /** True after all 99 exit: day archived, waiting for user to start next day */
  var dayClosed = false;
  /** Which archived day the table is showing */
  var selectedDayView = null;
  /** Inventory carousel index per day+customer: "day:id" → item index */
  var dayInvIndex = {};
  /** Inventory carousel index on selected receipt detail */
  var receiptInvIndex = 0;
  var receiptSort = "chars-desc"; // chars-desc | chars-asc | name-asc | name-desc | aspect-asc | aspect-desc
  var selectedReceiptId = null;
  /** Preferred generate aspect ratios (each shopper picks one) */
  var ASPECT_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"];
  var lastGenerated = { url: "", label: "", aspect: "", sourceId: null };
  var genPollTimer = 0;
  var zones = {};
  var prices = {
    paintings: 89,
    generated: 45,
    commercial: 55,
    characters: 35,
    objects: 29,
    places: 39,
    videos: 29,
    custom: 35,
  };

  function $(id) {
    return document.getElementById(id);
  }

  function setStatus(msg, kind) {
    var el = $("sm-status");
    if (!el) return;
    el.textContent = msg || "";
    el.className = "sm-status" + (kind ? " " + kind : "");
  }

  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  function rand(a, b) {
    return a + Math.random() * (b - a);
  }

  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function galleryPrice(collection) {
    if (window.GalleryShop && GalleryShop.getCollectionPrice) {
      try {
        return Math.max(1, Math.round(Number(GalleryShop.getCollectionPrice(collection)) || 1));
      } catch (e) {}
    }
    return Math.max(1, Math.round(Number(prices[collection] || prices.custom || 25)));
  }

  function loadPrices() {
    return fetch("/api/payment-config?t=" + Date.now(), { cache: "no-store" })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (d) {
        if (d && d.prices_usd) {
          Object.keys(d.prices_usd).forEach(function (k) {
            prices[k] = d.prices_usd[k];
          });
        }
      })
      .catch(function () {});
  }

  function loadCatalog() {
    catalog = [];
    function addPainting(n) {
      var url =
        window.getPaintingUrl && window.getPaintingUrl(n)
          ? window.getPaintingUrl(n)
          : "paintings/" + n + ".jpg";
      var a =
        window.getGalleryAnalysis && window.getGalleryAnalysis(n)
          ? window.getGalleryAnalysis(n)
          : null;
      catalog.push({
        collection: "paintings",
        number: n,
        title: (a && a.title) || "Painting #" + n,
        imageUrl: url,
        tags: (a && a.tags) || [],
        style: (a && a.style) || "",
        mood: (a && a.mood) || "",
      });
    }
    var man = window.galleryManifest || [];
    if (man.length) {
      man.forEach(function (row) {
        if (row && row.number) addPainting(row.number);
      });
    } else {
      for (var i = 1; i <= 48; i++) addPainting(i);
    }
    return fetch("/api/gallery-assets?collection=generated&t=" + Date.now(), { cache: "no-store" })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (data) {
        var items = (data && (data.items || data.assets)) || [];
        items.slice(0, 200).forEach(function (it) {
          if (!it) return;
          catalog.push({
            collection: "generated",
            number: it.number != null ? it.number : it.num,
            title: it.title || it.name || "Generated",
            imageUrl: it.url || it.image_url || "",
            tags: it.tags || [],
            style: it.style || "",
            mood: it.mood || "",
          });
        });
      })
      .catch(function () {})
      .then(function () {
        if (!catalog.length) {
          for (var j = 1; j <= 24; j++) addPainting(j);
        }
      });
  }

  function editionFromItem(item) {
    var stock = galleryPrice(item.collection || "paintings");
    var a =
      item.number != null && window.getGalleryAnalysis
        ? window.getGalleryAnalysis(item.number)
        : null;
    return {
      collection: item.collection || "paintings",
      number: item.number,
      title: (a && a.title) || item.title || "Art",
      description: item.description || (a && a.description) || "",
      imageUrl: item.imageUrl || "",
      tags: item.tags || (a && a.tags) || [],
      style: item.style || (a && a.style) || "",
      mood: item.mood || (a && a.mood) || "",
      colors: item.colors || (a && a.colors) || [],
      stock: stock,
      maxStock: stock,
      price: UNIT_PRICE,
      empty: false,
    };
  }

  function randomEdition() {
    if (!catalog.length) {
      return {
        collection: "paintings",
        number: 1,
        title: "Empty edition",
        imageUrl: "",
        tags: [],
        style: "",
        mood: "",
        stock: 1,
        maxStock: 1,
        price: UNIT_PRICE,
        empty: false,
      };
    }
    return editionFromItem(pick(catalog));
  }

  function buildZones() {
    // Bottom: entrance | 11 registers | exit
    // Top: back-room bathroom lane (stress relief when too close)
    // Mid: checkout approach lane between aisles and registers
    var bottomH = 96;
    var midLaneH = 78;
    var bathH = 52;
    var y = H - bottomH + 6;
    var h = bottomH - 14;
    var entranceW = 100;
    var exitW = 100;
    var gap = 6;
    var regBandX = 16 + entranceW + gap;
    var regBandW = W - 32 - entranceW - exitW - gap * 2;
    var regSlotW = (regBandW - gap * (REGISTER_COUNT - 1)) / REGISTER_COUNT;
    var registers = [];
    for (var i = 0; i < REGISTER_COUNT; i++) {
      registers.push({
        id: i + 1,
        x: regBandX + i * (regSlotW + gap),
        y: y,
        w: regSlotW,
        h: h,
        label: "R" + (i + 1),
      });
    }
    var aisleTop = bathH + 10;
    var aisleH = H - bottomH - midLaneH - aisleTop - 8;
    zones = {
      entrance: { x: 16, y: y, w: entranceW, h: h, label: "ENTRANCE" },
      exit: { x: W - 16 - exitW, y: y, w: exitW, h: h, label: "EXIT" },
      register: {
        x: regBandX,
        y: y,
        w: regBandW,
        h: h,
        label: "REGISTERS ×" + REGISTER_COUNT,
      },
      registers: registers,
      bathroom: {
        x: 16,
        y: 8,
        w: W - 32,
        h: bathH,
        label: "BACK ROOM · BATHROOM LANE",
      },
      aisles: { x: 12, y: aisleTop, w: W - 24, h: Math.max(160, aisleH) },
      midLane: {
        x: 12,
        y: aisleTop + Math.max(160, aisleH) + 4,
        w: W - 24,
        h: midLaneH - 8,
        label: "CHECKOUT LANE · FRONT KIOSKS",
      },
      bottomStrip: { x: 0, y: H - bottomH, w: W, h: bottomH },
      kiosks: [],
    };
    // 6 front kiosks in the mid-lane (between aisles and registers)
    var mid = zones.midLane;
    var kGap = 10;
    var kW = (mid.w - kGap * (KIOSK_COUNT + 1)) / KIOSK_COUNT;
    var kH = Math.min(44, mid.h - 16);
    var kiosks = [];
    for (var ki = 0; ki < KIOSK_COUNT; ki++) {
      kiosks.push({
        id: ki + 1,
        x: mid.x + kGap + ki * (kW + kGap),
        y: mid.y + (mid.h - kH) / 2,
        w: kW,
        h: kH,
        label: "K" + (ki + 1),
      });
    }
    zones.kiosks = kiosks;
  }

  function pickKiosk(shopper) {
    var ks = zones.kiosks || [];
    if (!ks.length) {
      return {
        x: zones.midLane.x + zones.midLane.w / 2,
        y: zones.midLane.y + zones.midLane.h / 2,
        kioskId: 0,
      };
    }
    var best = ks[0];
    var bestScore = 1e9;
    for (var i = 0; i < ks.length; i++) {
      var k = ks[i];
      var cx = k.x + k.w / 2;
      var cy = k.y + k.h / 2;
      var load = 0;
      activePeople().forEach(function (p) {
        if (p.id === (shopper && shopper.id)) return;
        if (
          (p.state === "kiosk" || p.state === "entry_kiosk") &&
          p.target &&
          Math.hypot(p.target.x - cx, p.target.y - cy) < 36
        ) {
          load += 2;
        }
        if (Math.hypot(p.x - cx, p.y - cy) < 32) load += 1;
      });
      var score = load * 10 + Math.random();
      if (score < bestScore) {
        bestScore = score;
        best = k;
      }
    }
    return {
      x: best.x + best.w / 2 + rand(-best.w * 0.15, best.w * 0.15),
      y: best.y + best.h * 0.55,
      kioskId: best.id,
    };
  }

  /** Exit-lane kiosk (after shopping) → then registers. */
  function goToKiosk(shopper) {
    ensureMinimumCart(shopper);
    padCartTowardHighChars(shopper);
    shopper.state = "kiosk";
    shopper.kioskPhase = "exit";
    shopper.target = pickKiosk(shopper);
    shopper.kioskDwell = 0.4 + rand(0.2, 0.65);
  }

  /**
   * Evenly assign 99 shoppers across the 6 front kiosks for entry dispatch.
   * Kiosk also seeds which aisle band they enter so they don't all jet for A1.
   */
  function assignEntryDispatch(shopper, waveIndex) {
    if (!shopper || shopper.isPlayer) return;
    var idx = waveIndex != null ? waveIndex : Math.max(0, (shopper.id || 1) - 1);
    var kioskIndex = idx % KIOSK_COUNT;
    shopper.entryKioskId = kioskIndex + 1;
    shopper.homeKioskIndex = kioskIndex;
    // Spread start aisles across the store from kiosk position (L↔R)
    var band = AISLE_COUNT / KIOSK_COUNT;
    var base = Math.floor(kioskIndex * band + band * 0.5);
    // Offset within the ~16 people sharing this kiosk
    var within = Math.floor(idx / KIOSK_COUNT);
    var start = (base + within * 2 + (kioskIndex % 2)) % AISLE_COUNT;
    shopper.startAisle = start;
    shopper.aisleSidePrefer = within % 2; // 0 left walkway, 1 right
    shopper.aisleOrder = makeAisleOrderForShopper(shopper);
    shopper.aisleIdx = 0;
    shopper.aisleGrabs = 0;
    shopper.wanderPending = 1 + (within % 3); // extra mid-store legs after release
  }

  function entryKioskPoint(shopper) {
    var ks = zones.kiosks || [];
    if (!ks.length) return pickKiosk(shopper);
    var kioskIndex = ((shopper.entryKioskId || 1) - 1) % ks.length;
    var k = ks[kioskIndex];
    var slot = Math.floor(Math.max(0, (shopper.id || 1) - 1) / KIOSK_COUNT) % 8;
    var col = slot % 4;
    var row = Math.floor(slot / 4) % 2;
    return {
      x: k.x + k.w * (0.18 + col * 0.2) + rand(-3, 3),
      y: k.y + k.h * (0.35 + row * 0.25) + rand(-2, 2),
      kioskId: k.id,
      entry: true,
    };
  }

  function goToEntryKiosk(shopper) {
    if (!shopper.entryKioskId) assignEntryDispatch(shopper, (shopper.id || 1) - 1);
    shopper.state = "entry_kiosk";
    shopper.kioskPhase = "entry";
    shopper.target = entryKioskPoint(shopper);
    // Longer dwell so groups form at kiosks before the aisle release
    shopper.kioskDwell = 0.85 + rand(0.35, 1.1);
  }

  /** After entry kiosk: step into mid-lane / store floor toward their start aisle (no jet). */
  function releaseFromKioskIntoStore(shopper) {
    var aisleNum =
      (shopper.aisleOrder && shopper.aisleOrder[0] != null
        ? shopper.aisleOrder[0]
        : shopper.startAisle) || 0;
    var vp = aisleVisitPoint(aisleNum, shopper);
    var mid = zones.midLane;
    if (mid) {
      return {
        x: vp.x + rand(-18, 18),
        y: mid.y + mid.h * (0.25 + Math.random() * 0.45),
        releaseWalk: true,
        nextAisle: aisleNum,
      };
    }
    return { x: vp.x, y: vp.y, visitOnly: true };
  }

  function midStoreWanderPoint(shopper) {
    var aisles = zones.aisles;
    var mid = zones.midLane;
    var roll = Math.random();
    if (roll < 0.35 && mid) {
      return {
        x: mid.x + mid.w * (0.08 + Math.random() * 0.84),
        y: mid.y + mid.h * (0.2 + Math.random() * 0.6),
        wander: true,
      };
    }
    if (roll < 0.55 && zones.bathroom) {
      var b = zones.bathroom;
      return {
        x: b.x + b.w * (0.15 + Math.random() * 0.7),
        y: b.y + b.h * 0.65,
        wander: true,
      };
    }
    // Cross to a random aisle walkway (walk the floor)
    var a = Math.floor(Math.random() * AISLE_COUNT);
    var vp = aisleVisitPoint(a, shopper);
    return {
      x: vp.x + rand(-10, 10),
      y: aisles.y + aisles.h * (0.12 + Math.random() * 0.76),
      wander: true,
    };
  }

  function loadDayLogs() {
    try {
      var raw = JSON.parse(localStorage.getItem(STORAGE_DAY_LOG) || "null");
      // Migrate v1 key if present
      if (!raw) {
        try {
          raw = JSON.parse(localStorage.getItem("gallery.supermarket.daylog.v1") || "null");
        } catch (e2) {
          raw = null;
        }
      }
      if (raw && typeof raw === "object") {
        dayLogs = raw.days || {};
        simDay = Math.max(1, parseInt(raw.simDay, 10) || 1);
        dayClosed = !!raw.dayClosed;
      }
    } catch (e) {
      dayLogs = {};
      simDay = 1;
      dayClosed = false;
    }
  }

  function saveDayLogs() {
    try {
      localStorage.setItem(
        STORAGE_DAY_LOG,
        JSON.stringify({ simDay: simDay, dayClosed: dayClosed, days: dayLogs })
      );
    } catch (e) {
      // If storage is full, drop oldest days and retry once
      try {
        var keys = Object.keys(dayLogs)
          .map(Number)
          .sort(function (a, b) {
            return a - b;
          });
        if (keys.length > 3) {
          keys.slice(0, keys.length - 3).forEach(function (k) {
            delete dayLogs[String(k)];
          });
          localStorage.setItem(
            STORAGE_DAY_LOG,
            JSON.stringify({ simDay: simDay, dayClosed: dayClosed, days: dayLogs })
          );
        }
      } catch (e2) {}
    }
  }

  function slimInventoryItems(items) {
    return (items || []).map(function (ed) {
      var phrase = "";
      try {
        phrase = visualPhrase ? visualPhrase(ed, 100) : ed.title || "";
      } catch (err) {
        phrase = ed.title || "art";
      }
      return {
        title: stripCatalogSpeak(ed.title || "") || "art",
        imageUrl: ed.imageUrl || "",
        number: ed.number,
        collection: ed.collection || "",
        description: stripCatalogSpeak(phrase),
      };
    });
  }

  function inventoryLabelFromItems(items) {
    items = items || [];
    if (!items.length) return "(empty)";
    var phrases = items.map(function (ed) {
      if (ed.description) return clipWords(stripCatalogSpeak(ed.description), 56);
      try {
        return clipWords(visualPhrase(ed, 56), 56);
      } catch (err) {
        return stripCatalogSpeak(ed.title || "art");
      }
    });
    return phrases.join(" · ") + (items.length ? " (" + items.length + " pcs)" : "");
  }

  function customerRowFromReceipt(r) {
    var items = slimInventoryItems(r.items || []);
    var prompt = stripCatalogSpeak(r.prompt || "");
    return {
      id: r.shopperId,
      name: r.name || "Shopper",
      items: items,
      inventory: inventoryLabelFromItems(items.length ? items : r.items || []),
      pcs: items.length || (r.items && r.items.length) || 0,
      chars: r.chars != null ? r.chars : prompt.length,
      total: r.total || 0,
      prompt: prompt,
      aspect: r.aspect || "16:9",
      generatedUrl: r.generatedUrl || "",
    };
  }

  function pickAspectRatio() {
    return ASPECT_RATIOS[Math.floor(Math.random() * ASPECT_RATIOS.length)];
  }

  /** Numeric width÷height for sort (9:16 ≈ 0.56 … 16:9 ≈ 1.78), not A–Z text. */
  function aspectSortKey(a) {
    var s = String(a || "16:9").trim();
    var m = s.match(/^(\d+(?:\.\d+)?)\s*[:/x×]\s*(\d+(?:\.\d+)?)$/i);
    if (m) {
      var w = parseFloat(m[1]);
      var h = parseFloat(m[2]);
      if (w > 0 && h > 0) return w / h;
    }
    return 1;
  }

  function archiveDayInterval() {
    // Snapshot all 99 customers: Name, Inventory, Prompt — never wipe older days
    var byId = {};
    receipts.forEach(function (r) {
      byId[r.shopperId] = customerRowFromReceipt(r);
    });
    shoppers.forEach(function (s) {
      if (byId[s.id]) return;
      var items =
        (s.pendingReceipt && s.pendingReceipt.items) || s.cart || [];
      var prompt = s.pendingReceipt
        ? s.pendingReceipt.prompt
        : cartPrompt(items, s);
      var slim = slimInventoryItems(items);
      byId[s.id] = {
        id: s.id,
        name: s.name,
        items: slim,
        inventory: inventoryLabelFromItems(slim.length ? slim : items),
        pcs: items.length,
        chars: String(prompt || "").length,
        total: items.length * UNIT_PRICE,
        prompt: stripCatalogSpeak(prompt || ""),
        aspect: s.preferredAspect || (s.pendingReceipt && s.pendingReceipt.aspect) || "16:9",
        generatedUrl:
          (s.pendingReceipt && s.pendingReceipt.generatedUrl) || s.generatedUrl || "",
      };
    });
    var customers = [];
    for (var i = 1; i <= NPC_COUNT; i++) {
      customers.push(
        byId[i] || {
          id: i,
          name: "Customer " + i,
          items: [],
          inventory: "(empty)",
          pcs: 0,
          chars: 0,
          total: 0,
          prompt: "",
        }
      );
    }
    // Sort table by name A–Z for stable readout
    customers.sort(function (a, b) {
      return String(a.name || "").localeCompare(String(b.name || ""), undefined, {
        sensitivity: "base",
      });
    });
    var avgChars = 0;
    var high = 0;
    customers.forEach(function (c) {
      avgChars += c.chars || 0;
      if ((c.chars || 0) > high) high = c.chars;
    });
    avgChars = Math.round(avgChars / Math.max(1, customers.length));
    dayLogs[String(simDay)] = {
      day: simDay,
      customers: customers,
      customerCount: customers.length,
      avgChars: avgChars,
      peakChars: high,
      receiptCount: receipts.length,
      closedAt: new Date().toISOString(),
    };
    // Keep last 30 full day tables (prompts are large)
    var keys = Object.keys(dayLogs)
      .map(Number)
      .sort(function (a, b) {
        return b - a;
      });
    keys.slice(30).forEach(function (k) {
      delete dayLogs[String(k)];
    });
    selectedDayView = simDay;
    saveDayLogs();
    renderDayLog();
  }

  function dayLogKeys() {
    return Object.keys(dayLogs)
      .map(Number)
      .filter(function (n) {
        return !isNaN(n);
      })
      .sort(function (a, b) {
        return b - a;
      });
  }

  function renderDayLog() {
    var dayEl = $("sm-hud-day");
    if (dayEl) {
      dayEl.textContent =
        "Day " + simDay + (dayClosed ? " (closed — start next when ready)" : "");
    }
    var sel = $("sm-day-select");
    var summary = $("sm-day-summary");
    var tbody = $("sm-day-table-body");
    var keys = dayLogKeys();
    if (!keys.length) {
      if (sel) {
        sel.innerHTML = '<option value="">No archived days yet</option>';
      }
      if (summary) {
        summary.textContent = dayClosed
          ? "Day " + simDay + " just finished archiving…"
          : "Finish a full exit cycle (all 99 at exit) to archive a day table.";
      }
      if (tbody) {
        tbody.innerHTML =
          '<tr><td colspan="3" class="sm-muted">No day archived yet — when all 99 exit, this table fills with Name, Inventory, Prompt. Next day will not start until you press Start next day.</td></tr>';
      }
      return;
    }
    if (selectedDayView == null || !dayLogs[String(selectedDayView)]) {
      selectedDayView = keys[0];
    }
    if (sel) {
      var keep = String(selectedDayView);
      sel.innerHTML = keys
        .map(function (d) {
          var log = dayLogs[String(d)];
          var n = (log && log.customers && log.customers.length) || 0;
          return (
            '<option value="' +
            d +
            '">Day ' +
            d +
            " · " +
            n +
            " shoppers" +
            (log && log.closedAt
              ? " · " + String(log.closedAt).replace("T", " ").slice(0, 16)
              : "") +
            "</option>"
          );
        })
        .join("");
      sel.value = keep;
      if (sel.value !== keep && keys.length) {
        sel.value = String(keys[0]);
        selectedDayView = keys[0];
      }
    }
    var log = dayLogs[String(selectedDayView)];
    if (!log) return;
    if (summary) {
      summary.innerHTML =
        "Day <strong>" +
        selectedDayView +
        "</strong> · " +
        (log.customerCount || (log.customers && log.customers.length) || 0) +
        " rows · avg <strong class=\"sm-chars-high\">" +
        (log.avgChars || 0) +
        "</strong> chars · peak <strong class=\"sm-chars-high\">" +
        (log.peakChars || 0) +
        "</strong>" +
        (dayClosed && selectedDayView === simDay
          ? ' · <span class="sm-day-closed-banner">Current day closed — press Start next day when ready</span>'
          : "");
    }
    if (!tbody) return;
    var rows = log.customers || [];
    if (!rows.length) {
      tbody.innerHTML =
        '<tr><td colspan="3" class="sm-muted">No customers stored for this day.</td></tr>';
      return;
    }
    tbody.innerHTML = rows
      .map(function (c) {
        var cid = c.id != null ? c.id : c.name;
        var key = String(selectedDayView) + ":" + cid;
        var idx = dayInvIndex[key] || 0;
        var prompt = c.prompt || "";
        var name =
          (c.name || "Shopper") +
          (c.id != null ? " (#" + c.id + ")" : "") +
          (c.aspect ? " · " + c.aspect : "");
        return (
          "<tr>" +
          '<td class="sm-day-name">' +
          escapeHtml(name) +
          "</td>" +
          '<td class="sm-day-inv">' +
          inventoryCarouselHtml(key, c.items || [], idx) +
          "</td>" +
          '<td class="sm-day-prompt"><div class="sm-day-prompt-full">' +
          escapeHtml(prompt || "(no prompt)") +
          "</div></td>" +
          "</tr>"
        );
      })
      .join("");
  }

  function itemImageSrc(ed) {
    if (!ed) return "";
    if (ed.imageUrl) return ed.imageUrl;
    if (ed.number != null && window.getPaintingUrl) {
      try {
        return window.getPaintingUrl(ed.number) || "";
      } catch (err) {
        return "";
      }
    }
    return "";
  }

  /** One inventory image + ‹ › index — no inventory text dump. */
  function inventoryCarouselHtml(key, items, index) {
    items = items || [];
    var n = items.length;
    var i = n ? clamp(index || 0, 0, n - 1) : 0;
    var src = n ? itemImageSrc(items[i]) : "";
    var img = src
      ? '<img class="sm-inv-one" src="' +
        escapeHtml(src) +
        '" alt="" loading="lazy" data-inv-img="' +
        escapeHtml(key) +
        '" />'
      : '<div class="sm-inv-one sm-inv-empty" data-inv-img="' + escapeHtml(key) + '">—</div>';
    return (
      '<div class="sm-inv-carousel" data-inv-key="' +
      escapeHtml(key) +
      '">' +
      '<div class="sm-inv-row">' +
      '<button type="button" class="sm-inv-prev" data-inv-key="' +
      escapeHtml(key) +
      '" data-inv-dir="-1" aria-label="Previous cart image">‹</button>' +
      img +
      '<button type="button" class="sm-inv-next" data-inv-key="' +
      escapeHtml(key) +
      '" data-inv-dir="1" aria-label="Next cart image">›</button>' +
      "</div>" +
      '<div class="sm-inv-idx" data-inv-label="' +
      escapeHtml(key) +
      '">' +
      (n ? i + 1 + " / " + n : "0 / 0") +
      "</div>" +
      "</div>"
    );
  }

  function itemsForInvKey(key) {
    if (!key) return [];
    if (key === "receipt") {
      var rec = findReceiptById(selectedReceiptId);
      return (rec && rec.items) || [];
    }
    var parts = String(key).split(":");
    var day = parts[0];
    var cid = parts.slice(1).join(":");
    var log = dayLogs[String(day)];
    if (!log || !log.customers) return [];
    for (var i = 0; i < log.customers.length; i++) {
      var c = log.customers[i];
      if (String(c.id) === String(cid) || String(c.name) === String(cid)) {
        return c.items || [];
      }
    }
    return [];
  }

  function stepInventoryCarousel(key, dir) {
    var items = itemsForInvKey(key);
    var n = items.length;
    if (!n) return;
    if (key === "receipt") {
      receiptInvIndex = (receiptInvIndex + dir + n) % n;
      updateCarouselDom(key, items, receiptInvIndex);
      return;
    }
    var cur = dayInvIndex[key] || 0;
    dayInvIndex[key] = (cur + dir + n) % n;
    updateCarouselDom(key, items, dayInvIndex[key]);
  }

  function updateCarouselDom(key, items, index) {
    var n = items.length;
    var i = n ? clamp(index, 0, n - 1) : 0;
    var src = n ? itemImageSrc(items[i]) : "";
    var imgs = document.querySelectorAll('[data-inv-img="' + key + '"]');
    for (var a = 0; a < imgs.length; a++) {
      var el = imgs[a];
      if (el.tagName === "IMG") {
        if (src) el.src = src;
      }
    }
    var labels = document.querySelectorAll('[data-inv-label="' + key + '"]');
    for (var b = 0; b < labels.length; b++) {
      labels[b].textContent = n ? i + 1 + " / " + n : "0 / 0";
    }
  }

  /** Moderation report only — not a second copy of the cart description. */
  function moderationReportHtml(text) {
    var scan = scanModeration(text || "");
    var hits = scan.hits || [];
    if (!hits.length) {
      return (
        '<div class="sm-mod-report clean">' +
        "<strong>Moderation flags</strong> — clean. No blocked keywords in this cart description." +
        "</div>"
      );
    }
    var counts = {};
    hits.forEach(function (h) {
      var w = String(h.match || "").toLowerCase();
      if (!w) return;
      counts[w] = (counts[w] || 0) + 1;
    });
    var words = Object.keys(counts).sort();
    var high = hits.some(function (h) {
      return h.level === "high";
    });
    return (
      '<div class="sm-mod-report">' +
      "<strong>Moderation flags</strong> — " +
      hits.length +
      " hit(s), risk " +
      (high ? "high" : "medium") +
      ". Flagged words only (not the full cart description):" +
      "<ul>" +
      words
        .map(function (w) {
          return (
            '<li><span class="sm-mod-word">' +
            escapeHtml(w) +
            "</span> ×" +
            counts[w] +
            "</li>"
          );
        })
        .join("") +
      "</ul></div>"
    );
  }

  /** Pick a register: prefer emptiest (fewest shoppers targeting / standing there). */
  function pickRegister(shopper) {
    var regs = zones.registers || [];
    if (!regs.length) return centerOf(zones.register);
    var best = regs[0];
    var bestScore = 1e9;
    for (var i = 0; i < regs.length; i++) {
      var r = regs[i];
      var cx = r.x + r.w / 2;
      var cy = r.y + r.h / 2;
      var load = 0;
      activePeople().forEach(function (p) {
        if (p.id === (shopper && shopper.id)) return;
        if (p.state === "checkout" || p.state === "exit") {
          if (p.target && Math.hypot(p.target.x - cx, p.target.y - cy) < 40) load += 2;
        }
        if (Math.hypot(p.x - cx, p.y - cy) < 36) load += 1;
      });
      // Slight preference for center registers + random
      var score = load * 10 + Math.abs(i - (REGISTER_COUNT - 1) / 2) * 0.15 + Math.random() * 0.5;
      if (score < bestScore) {
        bestScore = score;
        best = r;
      }
    }
    return {
      x: best.x + best.w / 2 + rand(-best.w * 0.2, best.w * 0.2),
      y: best.y + best.h * 0.45,
      registerId: best.id,
    };
  }

  function nearestRegisterPoint(px, py) {
    var regs = zones.registers || [];
    if (!regs.length) return centerOf(zones.register);
    var best = regs[0];
    var bestD = 1e9;
    for (var i = 0; i < regs.length; i++) {
      var r = regs[i];
      var cx = r.x + r.w / 2;
      var cy = r.y + r.h / 2;
      var d = Math.hypot(px - cx, py - cy);
      if (d < bestD) {
        bestD = d;
        best = r;
      }
    }
    return {
      x: best.x + best.w / 2,
      y: best.y + best.h / 2,
      registerId: best.id,
      dist: bestD,
    };
  }

  /**
   * 13 double-sided aisle units across the floor.
   * Each face is elongated flat rectangles: 5 cells left→right, 8 cells up→down.
   * Sides 0/1 share a spine (back-to-back). Walkways between units only.
   */
  function buildShelves() {
    shelves = [];
    solids = [];
    var ax = zones.aisles.x;
    var ay = zones.aisles.y;
    var aw = zones.aisles.w;
    var ah = zones.aisles.h;

    // Walkway ≥ 3 “sections” wide (center aisle clear of both shelf faces)
    var sectionW = 18;
    var walkW = sectionW * 3;
    var spineW = 5;
    var facePad = 2;

    // Face: 5 cols L→R; two faces + spine + walkways between aisles
    var faceW0 = sectionW * 2.2;
    var unitW0 = faceW0 + spineW + faceW0;
    var totalW0 = AISLE_COUNT * unitW0 + (AISLE_COUNT + 1) * walkW;
    var scale = aw / totalW0;
    walkW *= scale;
    spineW *= scale;
    faceW0 *= scale;
    sectionW *= scale;
    var unitW = faceW0 + spineW + faceW0;

    var faceH = ah - 8;
    var cellW = (faceW0 - facePad * 2) / COLS_LR;
    var cellH = (faceH - facePad * 2) / ROWS_UD;

    var id = 0;
    var xCursor = ax + walkW;
    for (var a = 0; a < AISLE_COUNT; a++) {
      var unitX = xCursor;
      var unitY = ay + 4;
      solids.push({
        x: unitX,
        y: unitY,
        w: unitW,
        h: faceH,
        aisle: a,
      });

      for (var side = 0; side < SIDES; side++) {
        // Left face then right face of the same aisle (back-to-back)
        var faceX = side === 0 ? unitX : unitX + faceW0 + spineW;
        // Stand just outside THIS face (not walkway center). Shared walkway center
        // made left+right faces equidistant so the left-hand face always won.
        var standOff = Math.min(14, walkW * 0.32);
        var faceApproachX = side === 0 ? unitX - standOff : unitX + unitW + standOff;
        for (var row = 0; row < ROWS_UD; row++) {
          for (var col = 0; col < COLS_LR; col++) {
            var cx = faceX + facePad + col * cellW;
            var cy = unitY + facePad + row * cellH;
            var ed = randomEdition();
            var cellCx = cx + cellW * 0.5;
            var cellCy = cy + cellH * 0.5;
            // Outer edge of this cell (toward the walkway) — picks column by how close you stand
            var edgeX = side === 0 ? cx : cx + cellW;
            shelves.push({
              id: id++,
              aisle: a,
              side: side,
              col: col,
              row: row,
              x: cx + 0.5,
              y: cy + 0.5,
              w: cellW - 1,
              h: cellH - 1,
              approachX: faceApproachX,
              approachY: cellCy,
              edgeX: edgeX,
              cellCx: cellCx,
              cellCy: cellCy,
              solidLeft: unitX,
              solidRight: unitX + unitW,
              edition: ed,
            });
          }
        }
      }
      xCursor += unitW + walkW;
    }
    recalibratePace();
  }

  /**
   * 4s to walk the full aisle height (up/down).
   * 9s to cross from first to last aisle with full intention.
   */
  function recalibratePace() {
    var aisleH = zones.aisles && zones.aisles.h ? zones.aisles.h : H * 0.7;
    if (solids.length) {
      aisleH = solids[0].h || aisleH;
    }
    var spanX = zones.aisles.w || W * 0.8;
    if (solids.length >= 2) {
      var first = solids[0];
      var last = solids[solids.length - 1];
      spanX = last.x + last.w - first.x;
    } else if (solids.length === 1) {
      spanX = solids[0].w * AISLE_COUNT;
    }
    paceV = Math.max(40, aisleH / TIME_AISLE_UP_DOWN);
    paceH = Math.max(40, spanX / TIME_CROSS_TO_LAST);
    // Apply to living shoppers
    shoppers.forEach(function (s) {
      s.speedV = paceV * rand(0.92, 1.08);
      s.speedH = paceH * rand(0.92, 1.08);
      s.speed = (s.speedV + s.speedH) * 0.5;
    });
    if (player) {
      player.speedV = paceV * 1.15;
      player.speedH = paceH * 1.15;
      player.speed = (player.speedV + player.speedH) * 0.5;
    }
  }

  function entitySpeed(entity, dx, dy) {
    var ax = Math.abs(dx);
    var ay = Math.abs(dy);
    var sv = entity.speedV || paceV;
    var sh = entity.speedH || paceH;
    if (ax < 0.01 && ay < 0.01) return (sv + sh) * 0.5;
    // Blend by movement direction: mostly horizontal uses H pace, vertical uses V
    var t = ax / (ax + ay);
    return sh * t + sv * (1 - t);
  }

  function circleHitsSolid(cx, cy, r) {
    for (var i = 0; i < solids.length; i++) {
      var s = solids[i];
      // Expand solid by radius (circle vs AABB)
      var nearestX = clamp(cx, s.x, s.x + s.w);
      var nearestY = clamp(cy, s.y, s.y + s.h);
      var dx = cx - nearestX;
      var dy = cy - nearestY;
      if (dx * dx + dy * dy < r * r) return true;
    }
    // Keep inside floor (aisles + entrance/register/exit)
    if (cx < 6 || cy < 8 || cx > W - 6 || cy > H - 8) return true;
    return false;
  }

  function tryMoveEntity(entity, nx, ny) {
    var r = entity.r || 5;
    if (!circleHitsSolid(nx, ny, r + 0.5)) {
      entity.x = nx;
      entity.y = ny;
      return true;
    }
    // Axis slide
    if (!circleHitsSolid(nx, entity.y, r + 0.5)) {
      entity.x = nx;
      return true;
    }
    if (!circleHitsSolid(entity.x, ny, r + 0.5)) {
      entity.y = ny;
      return true;
    }
    return false;
  }

  function loadNames() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_NAMES) || "null") || {};
    } catch (e) {
      return {};
    }
  }

  function saveNames() {
    var map = {};
    shoppers.forEach(function (s) {
      if (!s.isPlayer) map[s.id] = s.name;
    });
    if (player) map[player.id] = player.name;
    try {
      localStorage.setItem(STORAGE_NAMES, JSON.stringify(map));
    } catch (e) {}
  }

  function makeTaste() {
    var prefs = ["paintings", "generated", "commercial", "characters"];
    var fav = pick(prefs);
    return {
      favoriteCollection: fav,
      tagBias: pick(["portrait", "landscape", "abstract", "color", "mood", "dark", "bright", ""]),
      // High greed = splurge on many pieces; still capped by prompt budget
      greed: rand(0.65, 0.98),
      patience: rand(0.35, 0.9),
      // Personal soft ceiling — aim positively high under 8000
      promptBudget: Math.floor(PROMPT_MAX * rand(PROMPT_SPLURGE_RATIO, PROMPT_HARD_RATIO)),
      preferredAspect: pickAspectRatio(),
    };
  }

  function bathroomPoint() {
    var b = zones.bathroom;
    if (!b) return { x: W * 0.5, y: 30 };
    return {
      x: b.x + b.w * (0.15 + Math.random() * 0.7),
      y: b.y + b.h * 0.55,
    };
  }

  /** Keep shopping while under personal budget; stop before hard 8000 / cart cap. */
  function shouldCheckoutForPrompt(shopper) {
    var cart = (shopper && shopper.cart) || [];
    if (cart.length >= cartItemCap(shopper)) return true;
    var budget =
      (shopper.taste && shopper.taste.promptBudget) ||
      Math.floor(PROMPT_MAX * PROMPT_SPLURGE_RATIO);
    var vis = visionFillLen(cart);
    // Enough real art description already — don't keep grabbing empty noise
    if (vis >= Math.min(budget * 0.75, PROMPT_MAX * 0.7)) return true;
    var len = promptLen(cart, shopper);
    if (len >= budget) return true;
    if (len >= PROMPT_MAX) return true;
    if (len + 80 >= PROMPT_MAX) return true;
    return false;
  }

  function canFitAnother(shopper, edition) {
    if (!edition || !shopper) return false;
    var cart = shopper.cart || [];
    if (cart.length >= cartItemCap(shopper)) return false;
    var next = cartPrompt(cart.concat([edition]), shopper);
    if (next.length > PROMPT_MAX) return false;
    var budget =
      (shopper.taste && shopper.taste.promptBudget) ||
      Math.floor(PROMPT_MAX * PROMPT_SPLURGE_RATIO);
    if (next.length > budget && next.length > PROMPT_MAX * 0.94) return false;
    return true;
  }

  function editionKey(ed) {
    if (!ed) return "";
    return String(ed.collection || "") + ":" + String(ed.number != null ? ed.number : ed.title || "");
  }

  function cartKeys(cart) {
    var keys = {};
    (cart || []).forEach(function (ed) {
      keys[editionKey(ed)] = true;
      if (ed.collection) keys["col:" + ed.collection] = true;
      if (ed.title) keys["title:" + String(ed.title).toLowerCase().slice(0, 24)] = true;
    });
    return keys;
  }

  function scoreShelf(shopper, shelf) {
    var ed = shelf.edition;
    if (!ed || ed.empty || ed.stock <= 0) return -1;
    var score = Math.random() * 0.3;
    if (ed.collection === shopper.taste.favoriteCollection) score += 0.5;
    if (shopper.taste.tagBias && ed.tags && ed.tags.length) {
      var hit = ed.tags.some(function (t) {
        return String(t).toLowerCase().indexOf(shopper.taste.tagBias) >= 0;
      });
      if (hit) score += 0.3;
    }
    if (ed.style && shopper.taste.tagBias && String(ed.style).toLowerCase().indexOf(shopper.taste.tagBias) >= 0) {
      score += 0.15;
    }
    score += (ed.stock / Math.max(1, ed.maxStock)) * 0.08;
    // Avoid copying carts of people leaving with finished prompts
    var avoid = shopper.avoidKeys || {};
    var ek = editionKey(ed);
    if (avoid[ek]) score -= 0.85;
    if (avoid["col:" + ed.collection]) score -= 0.25;
    if (ed.title && avoid["title:" + String(ed.title).toLowerCase().slice(0, 24)]) score -= 0.4;
    // Positive pull from 1–3 nearby shoppers' carts
    var prefer = shopper.preferKeys || {};
    if (prefer[ek]) score += 0.45;
    if (prefer["col:" + ed.collection]) score += 0.2;
    return score;
  }

  /** Strip catalog IDs / painting numbers — keep visual language only. */
  function stripCatalogSpeak(s) {
    return String(s || "")
      .replace(/#\s*\d+/g, "")
      .replace(/\bpainting(?:s)?\s*#?\s*\d+\b/gi, "")
      .replace(/\b(?:piece|work|item)\s*#?\s*\d+\b/gi, "")
      .replace(
        /\b(?:from the\s+)?(?:paintings?|generated|commercial|characters?|objects?|places?|videos?|custom)\s+collection\b/gi,
        ""
      )
      .replace(/\bcollection\s*#?\s*\d+\b/gi, "")
      .replace(/\b\d{1,4}\s*\.(?:jpg|jpeg|png|webp)\b/gi, "")
      .replace(/\(\s*\$\d+(?:\.\d+)?\s*(?:unit)?\s*\)/gi, "")
      .replace(/\s{2,}/g, " ")
      .replace(/\s+([,.;:])/g, "$1")
      .trim();
  }

  function clipWords(s, maxChars) {
    s = String(s || "").trim();
    if (s.length <= maxChars) return s;
    return s.slice(0, Math.max(0, maxChars - 1)).replace(/\s+\S*$/, "").trim() + "…";
  }

  function analysisForEdition(ed) {
    if (!ed) return null;
    if (ed.number != null && window.getGalleryAnalysis) {
      return window.getGalleryAnalysis(ed.number) || null;
    }
    return null;
  }

  /**
   * Pure visual phrase for one cart piece — image description language, never catalog numbers.
   */
  function visualPhrase(ed, maxChars) {
    maxChars = maxChars || 220;
    if (!ed) return "an original gallery vision";
    var a = analysisForEdition(ed);
    var bits = [];
    var desc = stripCatalogSpeak((a && a.description) || ed.description || "");
    if (desc) bits.push(clipWords(desc, maxChars));
    var style = stripCatalogSpeak((a && a.style) || ed.style || "");
    var mood = stripCatalogSpeak((a && a.mood) || ed.mood || "");
    var tags = ((a && a.tags) || ed.tags || [])
      .map(function (t) {
        return stripCatalogSpeak(t);
      })
      .filter(Boolean)
      .slice(0, 5);
    var colors = ((a && a.colors) || ed.colors || []).slice(0, 4);
    var title = stripCatalogSpeak((a && a.title) || ed.title || "");
    if (title && !/^painting\b/i.test(title) && !/^\d+$/.test(title) && title.length > 2) {
      if (!desc || desc.toLowerCase().indexOf(title.toLowerCase()) < 0) {
        bits.unshift("subject energy of " + title);
      }
    }
    if (style) bits.push(style + " handling");
    if (mood) bits.push(mood + " mood");
    if (tags.length) bits.push("motifs of " + tags.join(", "));
    if (colors.length) bits.push("palette " + colors.join("/"));
    if (!bits.length) bits.push("soft gallery light on an imagined still");
    return stripCatalogSpeak(bits.join(", "));
  }

  function artDescription(ed) {
    return visualPhrase(ed, 160);
  }

  function ensureSocialMemory(person) {
    if (!person) return null;
    if (!person.social) {
      person.social = {
        met: {},
        chats: [],
        preferThemes: {},
        avoidThemes: {},
        choices: [],
        crowdNotes: [],
      };
    }
    return person.social;
  }

  function rememberThemes(bag, cart, weight) {
    if (!bag) return;
    (cart || []).forEach(function (ed) {
      var a = analysisForEdition(ed);
      var keys = [];
      if (a && a.mood) keys.push(String(a.mood).toLowerCase());
      if (a && a.style) keys.push(String(a.style).toLowerCase());
      if (ed.mood) keys.push(String(ed.mood).toLowerCase());
      if (ed.style) keys.push(String(ed.style).toLowerCase());
      ((a && a.tags) || ed.tags || []).slice(0, 3).forEach(function (t) {
        keys.push(String(t).toLowerCase());
      });
      if (!keys.length) {
        var phrase = visualPhrase(ed, 90);
        if (phrase) keys.push(clipWords(phrase, 40).toLowerCase());
      }
      keys.forEach(function (k) {
        k = stripCatalogSpeak(k);
        if (!k || k.length < 2) return;
        bag[k] = (bag[k] || 0) + (weight || 1);
      });
    });
  }

  function topThemeList(bag, n) {
    return Object.keys(bag || {})
      .map(function (k) {
        return { k: k, w: bag[k] };
      })
      .sort(function (a, b) {
        return b.w - a.w;
      })
      .slice(0, n || 6)
      .map(function (x) {
        return x.k;
      });
  }

  function rememberChat(person, other, line) {
    var s = ensureSocialMemory(person);
    if (!s) return;
    if (other && other.name) {
      s.met[other.name] = (s.met[other.name] || 0) + 1;
    }
    if (line) {
      s.chats.push(stripCatalogSpeak(String(line).slice(0, 100)));
      if (s.chats.length > 14) s.chats = s.chats.slice(-14);
    }
  }

  function rememberChoice(shopper, ed, note) {
    var s = ensureSocialMemory(shopper);
    if (!s || !ed) return;
    // Only store visual themes from the pick — not a shopping diary
    rememberThemes(s.preferThemes, [ed], 0.5);
    var phrase = clipWords(visualPhrase(ed, 90), 70);
    if (phrase) {
      s.choices.push(phrase);
      if (s.choices.length > 8) s.choices = s.choices.slice(-8);
    }
  }

  function cartItemCap(shopper) {
    var g = shopper && shopper.taste ? shopper.taste.greed : 0.75;
    // ~6–16 pieces max depending on greed — never triple-digit carts
    return Math.max(6, Math.min(MAX_CART_ITEMS, 6 + Math.floor(g * 10)));
  }

  function rememberCrowd(person, note) {
    var s = ensureSocialMemory(person);
    if (!s || !note) return;
    s.crowdNotes.push(stripCatalogSpeak(note));
    if (s.crowdNotes.length > 8) s.crowdNotes = s.crowdNotes.slice(-8);
  }

  /**
   * Distinct visual seeds from the cart only (what is in the image), longest first.
   * No shopping diary — pure look/feel of the art.
   */
  function collectVisionIdeas(cart) {
    cart = cart || [];
    var n = cart.length || 1;
    // Fewer pieces → longer per-piece description so the prompt is about seeing the work
    var per =
      n <= 3 ? 640 : n <= 6 ? 480 : n <= 10 ? 340 : 240;
    var scored = [];
    cart.forEach(function (ed) {
      var phrase = visualPhrase(ed, per);
      if (!phrase) return;
      scored.push({ phrase: phrase, len: phrase.length });
    });
    // Prefer richer descriptions; drop near-duplicates by 56-char stem
    scored.sort(function (a, b) {
      return b.len - a.len;
    });
    var seen = {};
    var ideas = [];
    scored.forEach(function (row) {
      var key = row.phrase.toLowerCase().replace(/\s+/g, " ").slice(0, 56);
      if (seen[key]) return;
      seen[key] = true;
      ideas.push(row.phrase);
    });
    return ideas.slice(0, MAX_VISION_IDEAS);
  }

  /**
   * Cart → generate recipe: the IMAGE content of the haul, fused into one scene.
   * Aisle influence only as short visual bias (mood/palette), never a trip report.
   */
  function cartPrompt(cart, shopper) {
    cart = cart || [];
    if (!cart.length) {
      return (
        "An empty visual field — no art subjects, light, or motif yet. " +
        "Need gallery work in the cart before a scene can form."
      );
    }

    var ideas = collectVisionIdeas(cart);
    if (!ideas.length) ideas.push("soft museum light on layered color and form");

    var weave = ideas
      .map(function (idea, i) {
        if (i === 0) return idea;
        var bridge = pick([
          "braided with",
          "overlapping",
          "dissolving into",
          "echoed by",
          "under the same light as",
          "fused beside",
          "sharing atmosphere with",
        ]);
        return bridge + " " + idea;
      })
      .join("; ");

    var parts = [];
    // ~85%+ of the prompt is the art itself
    parts.push(
      "A single continuous image (not a multi-panel collage, not a store interior documentary): " +
        "one shared composition made only from the cart's art. " +
        "See this scene: " +
        weave +
        "."
    );
    parts.push(
      "Hold one camera, one depth of field, one light direction; " +
        "let every cart motif exist inside that same pictured world."
    );

    // Optional short visual bias from nearby taste — no names, no "went to bathroom", no chat quotes
    var social = shopper && shopper.social ? shopper.social : null;
    if (social) {
      var prefer = topThemeList(social.preferThemes, 5);
      var avoid = topThemeList(social.avoidThemes, 4);
      if (prefer.length) {
        parts.push(
          "Lean the palette and subject weight toward: " + prefer.join(", ") + "."
        );
      }
      if (avoid.length) {
        parts.push(
          "Keep these visual notes quiet or absent: " + avoid.join(", ") + "."
        );
      }
    }

    var body = stripCatalogSpeak(parts.join(" "));
    // If still short, expand with more visual detail from cart (not social padding)
    if (body.length < PROMPT_MAX * 0.55 && cart.length) {
      var extra = [];
      cart.slice(0, MAX_VISION_IDEAS).forEach(function (ed) {
        var deep = visualPhrase(ed, 420);
        if (deep && body.indexOf(deep.slice(0, 40)) < 0) extra.push(deep);
      });
      if (extra.length) {
        body = stripCatalogSpeak(
          body + " Further visual detail within the same frame: " + extra.join("; ") + "."
        );
      }
    }
    return body.slice(0, PROMPT_MAX);
  }

  function promptLen(cart, shopper) {
    return cartPrompt(cart || [], shopper).length;
  }

  /** How much of the prompt is real art text (used to stop empty mega-carts). */
  function visionFillLen(cart) {
    return collectVisionIdeas(cart || []).join(" ").length;
  }

  function scanModeration(text) {
    if (window.Commercial && typeof Commercial.scanModeration === "function") {
      return Commercial.scanModeration(text);
    }
    text = String(text || "");
    var re =
      /\b(batman|superman|spiderman|marvel|disney|nazi|porn|nude|naked|gore|beheading|gun|rifle|blood|kill|murder)\b/gi;
    var hits = [];
    var m;
    var seen = {};
    while ((m = re.exec(text)) !== null) {
      var key = m.index + ":" + m[0];
      if (seen[key]) continue;
      seen[key] = true;
      hits.push({ start: m.index, end: m.index + m[0].length, level: "high", match: m[0] });
    }
    return { hits: hits, flags: hits.map(function (h) {
      return { match: h.match, level: h.level, n: 1 };
    }) };
  }

  function highlightModerationHtml(text) {
    text = String(text || "");
    if (window.Commercial && typeof Commercial.highlightModerationHtml === "function") {
      return Commercial.highlightModerationHtml(text);
    }
    var scan = scanModeration(text);
    if (!scan.hits.length) return escapeHtml(text);
    var out = "";
    var i = 0;
    scan.hits.forEach(function (h) {
      if (h.start > i) out += escapeHtml(text.slice(i, h.start));
      out +=
        '<mark class="sm-hl-mark ' +
        (h.level === "high" ? "high" : "med") +
        '">' +
        escapeHtml(text.slice(h.start, h.end)) +
        "</mark>";
      i = h.end;
    });
    if (i < text.length) out += escapeHtml(text.slice(i));
    return out;
  }

  function thumbsHtml(items, maxN) {
    maxN = maxN || 6;
    items = items || [];
    if (!items.length) return '<span class="sm-muted">(no images)</span>';
    return (
      '<div class="sm-thumbs">' +
      items
        .slice(0, maxN)
        .map(function (ed) {
          var src = ed.imageUrl || "";
          if (!src && ed.collection === "paintings" && ed.number != null && window.getPaintingUrl) {
            src = window.getPaintingUrl(ed.number);
          }
          if (!src) {
            return (
              '<span class="sm-thumb sm-thumb-empty" title="' +
              escapeHtml(ed.title || "") +
              '">#</span>'
            );
          }
          return (
            '<img class="sm-thumb" src="' +
            escapeHtml(src) +
            '" alt="' +
            escapeHtml(ed.title || "art") +
            '" title="' +
            escapeHtml(ed.title || "") +
            '" loading="lazy" />'
          );
        })
        .join("") +
      (items.length > maxN
        ? '<span class="sm-muted">+' + (items.length - maxN) + "</span>"
        : "") +
      "</div>"
    );
  }

  function makeAisleOrder() {
    return makeAisleOrderForShopper(null);
  }

  /**
   * Full store tour from a personal start aisle (seeded by entry kiosk).
   * Serpentine L→R or R→L so the 99 fan out instead of all rushing aisle 1.
   */
  function makeAisleOrderForShopper(shopper) {
    var start = 0;
    var goRight = true;
    if (shopper) {
      start = shopper.startAisle != null ? shopper.startAisle : 0;
      start = clamp(start, 0, AISLE_COUNT - 1);
      var k = shopper.homeKioskIndex != null ? shopper.homeKioskIndex : (shopper.id || 0) % 2;
      goRight = k % 2 === 0;
      // Half of each kiosk group reverse direction for more floor coverage
      if (shopper.id && Math.floor((shopper.id - 1) / KIOSK_COUNT) % 2 === 1) {
        goRight = !goRight;
      }
    } else {
      start = Math.floor(Math.random() * AISLE_COUNT);
      goRight = Math.random() < 0.5;
    }
    var order = [];
    if (goRight) {
      for (var a = start; a < AISLE_COUNT; a++) order.push(a);
      for (var b = start - 1; b >= 0; b--) order.push(b);
    } else {
      for (var c = start; c >= 0; c--) order.push(c);
      for (var d = start + 1; d < AISLE_COUNT; d++) order.push(d);
    }
    // Light mid-route variety (never scramble the first two legs — those seed spread)
    for (var i = 2; i < order.length; i++) {
      if (Math.random() < 0.22) {
        var j = 2 + Math.floor(Math.random() * (order.length - 2));
        var t = order[i];
        order[i] = order[j];
        order[j] = t;
      }
    }
    return order;
  }

  function buildShoppers() {
    var saved = loadNames();
    shoppers = [];
    for (var i = 1; i <= NPC_COUNT; i++) {
      var name = saved[i] || NAMES[(i - 1) % NAMES.length] + (i > NAMES.length ? " " + i : "");
      shoppers.push({
        id: i,
        name: name,
        isPlayer: false,
        x: zones.entrance.x + 20 + Math.random() * 30,
        y: zones.entrance.y + Math.random() * zones.entrance.h,
        vx: 0,
        vy: 0,
        r: 5,
        state: "waiting",
        target: null,
        cart: [],
        taste: makeTaste(),
        preferredAspect: null,
        aisleOrder: [],
        aisleIdx: 0,
        aisleGrabs: 0,
        entryKioskId: ((i - 1) % KIOSK_COUNT) + 1,
        startAisle: 0,
        wanderPending: 0,
        speed: paceV,
        speedV: paceV * rand(0.92, 1.08),
        speedH: paceH * rand(0.92, 1.08),
        dwell: 0,
        stuckT: 0,
        lastX: 0,
        lastY: 0,
        chatCd: rand(0, 2),
        bubble: "",
        bubbleT: 0,
        pendingReceipt: null,
        avoidKeys: {},
        preferKeys: {},
        color: "hsl(" + Math.floor(rand(190, 230)) + ",70%,65%)",
      });
      shoppers[shoppers.length - 1].preferredAspect =
        shoppers[shoppers.length - 1].taste.preferredAspect || pickAspectRatio();
    }
    player = {
      id: 100,
      name: saved[100] || "You (restocker & shopper)",
      isPlayer: true,
      x: zones.entrance.x + 35,
      y: zones.entrance.y + zones.entrance.h * 0.5,
      vx: 0,
      vy: 0,
      r: 7,
      state: "browse",
      target: null,
      cart: [],
      taste: makeTaste(),
      preferredAspect: null,
      speed: paceV,
      speedV: paceV * 1.12,
      speedH: paceH * 1.12,
      dwell: 0,
      stuckT: 0,
      chatCd: 0,
      bubble: "",
      bubbleT: 0,
      pendingReceipt: null,
      avoidKeys: {},
      preferKeys: {},
      color: "#5cf0a0",
    };
    player.preferredAspect = player.taste.preferredAspect || pickAspectRatio();
    recalibratePace();
    updateNameFields();
  }

  function updateNameFields() {
    var sel = $("sm-name-select");
    if (!sel) return;
    var cur = sel.value;
    sel.innerHTML = "";
    shoppers.forEach(function (s) {
      var o = document.createElement("option");
      o.value = String(s.id);
      o.textContent = "#" + s.id + " " + s.name;
      sel.appendChild(o);
    });
    var op = document.createElement("option");
    op.value = "100";
    op.textContent = "#100 " + (player ? player.name : "You");
    sel.appendChild(op);
    if (cur) sel.value = cur;
    onNameSelectChange();
  }

  function getShopperById(id) {
    id = parseInt(id, 10);
    if (id === 100) return player;
    for (var i = 0; i < shoppers.length; i++) {
      if (shoppers[i].id === id) return shoppers[i];
    }
    return null;
  }

  function onNameSelectChange() {
    var sel = $("sm-name-select");
    var input = $("sm-name-input");
    if (!sel || !input) return;
    var s = getShopperById(sel.value);
    input.value = s ? s.name : "";
    selectedShopper = s;
  }

  function applyNameEdit() {
    var sel = $("sm-name-select");
    var input = $("sm-name-input");
    if (!sel || !input) return;
    var s = getShopperById(sel.value);
    if (!s) return;
    s.name = String(input.value || s.name).slice(0, 40);
    saveNames();
    updateNameFields();
    setStatus("Name tag updated: " + s.name, "ok");
  }

  function resetShoppersToEntrance(dwellScale) {
    // Stagger release so ~99 people stream to 6 kiosks instead of one clump
    dwellScale = dwellScale != null ? dwellScale : 0.045;
    shoppers.forEach(function (s, idx) {
      s.state = "enter";
      s.cart = [];
      s.target = null;
      s.aisleIdx = 0;
      s.aisleGrabs = 0;
      s.kioskPhase = null;
      s.kioskDwell = 0;
      assignEntryDispatch(s, idx);
      // Wave out over ~4–5s so kiosks fill evenly
      s.dwell = rand(0.05, 0.25) + idx * dwellScale;
      s.stuckT = 0;
      s.stuckStrikes = 0;
      s.pendingReceipt = null;
      s.avoidKeys = {};
      s.preferKeys = {};
      s.social = null;
      ensureSocialMemory(s);
      s.chatCd = rand(0, 1);
      s.bubble = "";
      s.bubbleT = 0;
      s.x = zones.entrance.x + 10 + Math.random() * Math.max(20, zones.entrance.w - 20);
      s.y = zones.entrance.y + 8 + Math.random() * Math.max(12, zones.entrance.h - 16);
    });
    if (player) {
      player.social = null;
      ensureSocialMemory(player);
      player.stuckT = 0;
      player.stuckStrikes = 0;
      player.cart = player.cart || [];
      player.pendingReceipt = null;
    }
    chatBubbles = [];
  }

  /**
   * Start or restart the current day's wave.
   * Does NOT auto-advance the calendar day. Closed days stay in the table
   * until the user presses Start next day.
   */
  function startWave() {
    if (dayClosed) {
      setStatus(
        "Day " +
          simDay +
          " is closed and saved in the day log table. Press Start next day when you are ready — that keeps Day " +
          simDay +
          " and opens Day " +
          (simDay + 1) +
          ".",
        "ok"
      );
      renderDayLog();
      return;
    }
    if (waveActive && !allNpcsAtExit()) {
      setStatus(
        "Day " +
          simDay +
          " wave still running. When all 99 exit, the day archives into the table — next day will not start until you press Start next day.",
        ""
      );
      return;
    }
    if (Date.now() < waveCooldownUntil) {
      setStatus(
        "Cooldown — next wave in " + Math.ceil((waveCooldownUntil - Date.now()) / 1000) + "s",
        ""
      );
      return;
    }
    // Re-running same day without a close: archive any loose receipts first so they aren't lost
    if (receipts.length && !dayLogs[String(simDay)]) {
      archiveDayInterval();
      setStatus(
        "Saved Day " +
          simDay +
          " progress to the day table before reopening the wave. Use Start next day to move the calendar forward.",
        "ok"
      );
    }
    waveActive = true;
    dayClosed = false;
    receipts = [];
    selectedReceiptId = null;
    renderReceipts();
    resetShoppersToEntrance(0.006);
    saveDayLogs();
    setStatus(
        "Day " +
        simDay +
        " wave open — entrance → 6 kiosks (split 99) → aisles (full store walk) → exit kiosk → register → exit. Next day is manual.",
      "ok"
    );
    updateHud();
    renderLiveCarts();
    renderDayLog();
  }

  function allNpcsAtExit() {
    return shoppers.every(function (s) {
      return s.state === "done" || s.state === "at_exit";
    });
  }

  /**
   * User-driven: archive current day if needed, advance simDay, clear live receipts,
   * open a new wave. Previous days remain in the day log table.
   */
  function beginNextDay() {
    if (waveActive && !dayClosed && !allNpcsAtExit()) {
      setStatus(
        "Finish Day " +
          simDay +
          " first (all 99 at exit) so it can archive. Next day will not start automatically.",
        "err"
      );
      return;
    }
    // Archive if this day isn't stored yet
    if (!dayLogs[String(simDay)]) {
      archiveDayInterval();
    } else if (dayClosed && receipts.length) {
      // Re-archive so last-second edits/receipts are freshest
      archiveDayInterval();
    }
    var closed = simDay;
    selectedDayView = closed;
    simDay += 1;
    dayClosed = false;
    waveActive = true;
    waveCooldownUntil = 0;
    receipts = [];
    selectedReceiptId = null;
    renderReceipts();
    resetShoppersToEntrance(0.005);
    saveDayLogs();
    setStatus(
      "Day " +
        closed +
        " stays in the day log table. Day " +
        simDay +
        " is open at the entrance.",
      "ok"
    );
    updateHud();
    renderLiveCarts();
    renderDayLog();
  }

  /** @deprecated name kept for any external calls — does not auto-run anymore */
  function resetAllToEntrance() {
    beginNextDay();
  }

  function pickShelfOnAisle(shopper, aisleNum) {
    var ranked = shelves
      .filter(function (sh) {
        return (
          sh.aisle === aisleNum &&
          sh.edition &&
          !sh.edition.empty &&
          sh.edition.stock > 0 &&
          canFitAnother(shopper, sh.edition)
        );
      })
      .map(function (sh) {
        return { sh: sh, score: scoreShelf(shopper, sh) };
      })
      .sort(function (a, b) {
        return b.score - a.score;
      });
    if (!ranked.length) {
      // No stock fit — still walk to aisle center to "visit"
      return null;
    }
    var top = ranked.slice(0, Math.min(5, ranked.length));
    return pick(top).sh;
  }

  function aisleVisitPoint(aisleNum, shopper) {
    // Walkway on either side of this aisle unit (left and right faces)
    var solid = null;
    for (var i = 0; i < solids.length; i++) {
      if (solids[i].aisle === aisleNum) {
        solid = solids[i];
        break;
      }
    }
    if (!solid) return centerOf(zones.aisles);
    var standOff = 12;
    var useRight =
      shopper && shopper.aisleSidePrefer != null
        ? shopper.aisleSidePrefer === 1
        : Math.random() < 0.5;
    // Flip side sometimes so they walk both faces while touring
    if (shopper && (shopper.aisleIdx || 0) % 2 === 1) useRight = !useRight;
    return {
      x: useRight ? solid.x + solid.w + standOff : solid.x - standOff,
      y: solid.y + solid.h * (0.12 + Math.random() * 0.76),
    };
  }

  function advanceAisleOrCheckout(shopper) {
    shopper.aisleIdx = (shopper.aisleIdx || 0) + 1;
    shopper.aisleGrabs = 0;
    shopper.target = null;
    // All aisles done → exit kiosks → registers → exit
    if (shopper.aisleIdx >= AISLE_COUNT) {
      goToKiosk(shopper);
      if (shopper.cart.length > 1 && Math.random() < 0.25) {
        pushBubble(
          shopper,
          "Checkout K" + ((shopper.target && shopper.target.kioskId) || "") + "…"
        );
      }
      return;
    }
    // Often walk a mid-store leg so they cover the floor, not only aisle spines
    if ((shopper.wanderPending || 0) > 0 || Math.random() < 0.42) {
      if ((shopper.wanderPending || 0) > 0) shopper.wanderPending -= 1;
      shopper.target = midStoreWanderPoint(shopper);
    }
  }

  function activePeople() {
    var list = [];
    shoppers.forEach(function (s) {
      if (
        s.state !== "waiting" &&
        s.state !== "done" &&
        s.state !== "at_exit" &&
        s.state !== "bathroom"
      ) {
        list.push(s);
      }
    });
    if (player) list.push(player);
    return list;
  }

  function neighborsOf(person, radius) {
    var r2 = radius * radius;
    var out = [];
    activePeople().forEach(function (o) {
      if (o.id === person.id) return;
      var dx = o.x - person.x;
      var dy = o.y - person.y;
      if (dx * dx + dy * dy <= r2) out.push(o);
    });
    return out;
  }

  function cartDisplay(cart) {
    cart = cart || [];
    if (!cart.length) return "(empty)";
    return (
      cart
        .slice(0, 3)
        .map(function (ed) {
          return clipWords(visualPhrase(ed, 48), 42) || "vision";
        })
        .join(" · ") + (cart.length > 3 ? " +" + (cart.length - 3) : "")
    );
  }

  function otherCart(person) {
    if (person.pendingReceipt && person.pendingReceipt.items) return person.pendingReceipt.items;
    return person.cart || [];
  }

  function cartTalkSnippet(cart) {
    cart = cart || [];
    if (!cart.length) return "";
    var ed = pick(cart);
    try {
      return clipWords(visualPhrase(ed, 72), 48);
    } catch (err) {
      return clipWords(stripCatalogSpeak(ed.title || "that piece"), 40);
    }
  }

  function chatLine(speaker, other) {
    var myCart = speaker.cart || [];
    var yourCart = otherCart(other);
    var mine = cartTalkSnippet(myCart);
    var yours = cartTalkSnippet(yourCart);
    var otherLeaving =
      other.state === "checkout" || other.state === "exit" || other.state === "at_exit";
    var judgingYou = other.isPlayer;
    if (judgingYou) {
      if (!yourCart.length) {
        return pick([
          "Your basket's a blank canvas — steal some light!",
          "Empty cart? The aisles are humming without you.",
          "Come paint your haul — I'm judging the void.",
        ]);
      }
      return pick([
        "That " + yours + " in your cart is screaming main character.",
        "Ooh, you're stacking " + yours + " — spicy taste.",
        "If I filmed your cart it'd open on " + yours + ".",
        "Don't let " + yours + " bully the rest of your frame.",
        "Your image wants more tension next to " + yours + ".",
        "I'd remix " + yours + " with cooler shadows — just saying.",
        "Restocker energy: " + yours + " is half a dream already.",
      ]);
    }
    if (otherLeaving && yours) {
      return pick([
        "They're exiting on " + yours + " — I'm zigging elsewhere.",
        "Saw " + yours + " leave the building. Not cloning that.",
        "Their goodbye frame is " + yours + ". Gorgeous, not mine.",
        "Copycats die in aisle 7 — I'll skip " + yours + ".",
      ]);
    }
    if (mine && yours) {
      return pick([
        "Your " + yours + " and my " + mine + " could kiss in one still.",
        "I'm obsessed with " + yours + " — mine's more " + mine + ".",
        "Picture " + yours + " melting into " + mine + " under store light.",
        "That " + yours + " needs a friend — maybe my " + mine + "?",
        "If the cart were one image, " + yours + " is the hero shot.",
        "Don't sleep on " + mine + " — but " + yours + " has teeth.",
        "Aisle gossip: " + yours + " is the plot twist.",
        "We should braid " + mine + " with " + yours + " before checkout.",
      ]);
    }
    if (yours) {
      return pick([
        "Tell me about " + yours + " — that color is dangerous.",
        "I'd put " + yours + " dead center of the frame.",
        "Is " + yours + " as wild up close?",
      ]);
    }
    if (mine) {
      return pick([
        "Listen — " + mine + " is singing in my cart.",
        "I'm building a whole world around " + mine + ".",
        "Can't stop staring at " + mine + " in this light.",
      ]);
    }
    return pick([
      "These aisles feel like a film set tonight.",
      "Grab something that argues with the light.",
      "Empty carts are just prologues.",
    ]);
  }

  function mergeKeys(into, from, weight) {
    Object.keys(from || {}).forEach(function (k) {
      into[k] = (into[k] || 0) + (weight || 1);
    });
  }

  function pushBubble(person, text) {
    person.bubble = String(text || "").slice(0, 52);
    person.bubbleT = 2.8;
    chatBubbles.push({
      x: person.x,
      y: person.y - 14,
      text: person.bubble,
      t: 2.8,
      id: person.id,
    });
    if (chatBubbles.length > 40) chatBubbles = chatBubbles.slice(-40);
  }

  function applySocialForces(person, dt) {
    var near = neighborsOf(person, SOCIAL_RADIUS);
    var n = near.length;
    ensureSocialMemory(person);
    person.avoidKeys = {};
    person.preferKeys = {};

    // Always judge the player's cart when nearby
    if (!person.isPlayer && player) {
      var pDist = Math.hypot(person.x - player.x, person.y - player.y);
      if (pDist <= SOCIAL_RADIUS * 1.35) {
        var pc = otherCart(player);
        if (pc.length) {
          // Mild avoid-copy + chat judgment of you
          mergeKeys(person.avoidKeys, cartKeys(pc), 1.2);
          rememberThemes(person.social.avoidThemes, pc, 0.6);
          person.chatCd = (person.chatCd || 0) - dt;
          if (person.chatCd <= 0 && Math.random() < 0.55) {
            var lineP = chatLine(person, player);
            pushBubble(person, lineP);
            rememberChat(person, player, lineP);
            person.chatCd = CHAT_COOLDOWN * 0.7 + rand(0, 1);
          }
        } else if (person.chatCd <= 0 && Math.random() < 0.08) {
          var lineP2 = chatLine(person, player);
          pushBubble(person, lineP2);
          rememberChat(person, player, lineP2);
          person.chatCd = CHAT_COOLDOWN + 1;
        }
      }
    }

    near.forEach(function (o) {
      var leaving =
        o.state === "checkout" || o.state === "exit" || o.state === "at_exit";
      var oc = otherCart(o);
      if (leaving && oc.length) {
        mergeKeys(person.avoidKeys, cartKeys(oc), 2);
        rememberThemes(person.social.avoidThemes, oc, 1.2);
      } else if (oc.length && n <= SOCIAL_COMFORT) {
        mergeKeys(person.preferKeys, cartKeys(oc), 1);
        rememberThemes(person.social.preferThemes, oc, 1);
      }
      if (o.isPlayer && oc.length) {
        mergeKeys(person.avoidKeys, cartKeys(oc), 0.8);
        rememberThemes(person.social.avoidThemes, oc, 0.5);
      }
    });

    // You: uncomfortable walking up to a group of 3 others
    if (person.isPlayer && n >= SOCIAL_COMFORT) {
      var cx = 0;
      var cy = 0;
      near.forEach(function (o) {
        cx += o.x;
        cy += o.y;
      });
      cx /= n;
      cy /= n;
      var dx = person.x - cx;
      var dy = person.y - cy;
      var dist = Math.sqrt(dx * dx + dy * dy) || 1;
      var push = (person.speedH || paceH) * 0.55 * dt;
      tryMoveEntity(person, person.x + (dx / dist) * push, person.y + (dy / dist) * push);
      if (Math.random() < 0.04) {
        setStatus(
          "Uncomfortable — 3+ shoppers clustered. They may be judging your cart.",
          "err"
        );
      }
      return { crowded: true, near: near, playerCrowd: true };
    }

    if (n >= SOCIAL_COMFORT + 1) {
      // 4+: stress — head to back-room bathroom lane to cool off (NPCs)
      near.forEach(function (o) {
        var oc = otherCart(o);
        if (oc.length) {
          mergeKeys(person.avoidKeys, cartKeys(oc), 1.5);
          rememberThemes(person.social.avoidThemes, oc, 1.4);
        }
      });
      rememberCrowd(
        person,
        "A tight cluster of four-plus shoppers pressed in; the image cools and steps back from matching nearby carts."
      );
      if (!person.isPlayer && person.state === "browse" && person.state !== "bathroom") {
        if (Math.random() < 0.08 || !person.bathroomCd || person.bathroomCd <= 0) {
          person.prevState = person.state;
          person.state = "bathroom";
          person.target = bathroomPoint();
          person.bathroomDwell = BATHROOM_DWELL + rand(0, 1.2);
          person.bathroomCd = 8 + rand(0, 6);
          if (Math.random() < 0.45) {
            var talkAbout = pick(near);
            var bathLine = otherCart(talkAbout).length
              ? "Bathroom break — not matching " + cartDisplay(otherCart(talkAbout)).slice(0, 18)
              : "Need the back room…";
            pushBubble(person, bathLine);
            rememberChat(person, talkAbout, bathLine);
            rememberCrowd(person, "They slipped to the bathroom lane after the crowd felt too close.");
          }
        }
      }
      if (person.bathroomCd > 0) person.bathroomCd -= dt;
      // Still ease away while deciding
      var cx2 = 0;
      var cy2 = 0;
      near.forEach(function (o) {
        cx2 += o.x;
        cy2 += o.y;
      });
      cx2 /= Math.max(1, n);
      cy2 /= Math.max(1, n);
      var dx2 = person.x - cx2;
      var dy2 = person.y - cy2;
      var dist2 = Math.sqrt(dx2 * dx2 + dy2 * dy2) || 1;
      var pushSp = entitySpeed(person, dx2, dy2) * 0.5 * dt;
      tryMoveEntity(person, person.x + (dx2 / dist2) * pushSp, person.y + (dy2 / dist2) * pushSp);
      return { crowded: true, near: near };
    }
    if (person.bathroomCd > 0) person.bathroomCd -= dt;

    // Positive trio (1–3): chat + lean toward each other's carts (and judge you if you're one of them)
    if (n >= 1 && n <= SOCIAL_COMFORT && !person.isPlayer) {
      near.forEach(function (o) {
        var oc = otherCart(o);
        if (oc.length && !o.isPlayer) {
          mergeKeys(person.preferKeys, cartKeys(oc), 1);
          rememberThemes(person.social.preferThemes, oc, 1);
        }
      });
      person.chatCd = (person.chatCd || 0) - dt;
      if (person.chatCd <= 0) {
        var other = pick(near);
        var hasTalk =
          (person.cart && person.cart.length) ||
          otherCart(other).length ||
          other.isPlayer ||
          (other.pendingReceipt && other.pendingReceipt.items && other.pendingReceipt.items.length);
        if (hasTalk) {
          var lineA = chatLine(person, other);
          pushBubble(person, lineA);
          rememberChat(person, other, lineA);
          if (other && !other.isPlayer && Math.random() < 0.5) {
            var lineB = chatLine(other, person);
            pushBubble(other, lineB);
            rememberChat(other, person, lineB);
          }
        }
        person.chatCd = CHAT_COOLDOWN + rand(0, 1.5);
      }
    }

    near.forEach(function (o) {
      var dx = person.x - o.x;
      var dy = person.y - o.y;
      var d = Math.sqrt(dx * dx + dy * dy) || 0.01;
      var minD = person.r + o.r + 12;
      if (d < minD) {
        var push2 = ((minD - d) / minD) * entitySpeed(person, dx, dy) * 0.5 * dt;
        tryMoveEntity(person, person.x + (dx / d) * push2, person.y + (dy / d) * push2);
      }
    });
    return { crowded: false, near: near };
  }

  /**
   * Distance score for standing in front of a shelf cell.
   * Lower is better. Wrong side of the aisle unit is heavily penalized so the
   * face you're actually facing (left vs right of the solid) wins.
   */
  function shelfAccessScore(px, py, sh) {
    if (!sh) return 1e9;
    var standX = sh.approachX != null ? sh.approachX : sh.x + sh.w / 2;
    var standY = sh.cellCy != null ? sh.cellCy : sh.y + sh.h / 2;
    var edgeX = sh.edgeX != null ? sh.edgeX : standX;
    var cellCx = sh.cellCx != null ? sh.cellCx : sh.x + sh.w / 2;
    // Prefer the face edge you're walking up to (separates shared walkways)
    var d = Math.hypot(px - standX, py - standY);
    // Break column ties: slightly prefer the cell whose outer edge is nearer
    d += Math.abs(px - edgeX) * 0.12 + Math.abs(px - cellCx) * 0.04;
    // Must be on the walkway side of this face
    var sl = sh.solidLeft;
    var sr = sh.solidRight;
    if (sl != null && sr != null) {
      if (sh.side === 0) {
        // Left face: stand left of solid
        if (px > sl + 2) d += (px - sl) * 2.5 + 40;
      } else {
        // Right face: stand right of solid
        if (px < sr - 2) d += (sr - px) * 2.5 + 40;
      }
    }
    return d;
  }

  function updateNearShelf() {
    nearShelf = null;
    vicinityGroup = [];
    if (!player) return;
    var best = null;
    var bestD = NEAR_SHELF_DIST + 18;
    shelves.forEach(function (sh) {
      var d = shelfAccessScore(player.x, player.y, sh);
      if (d < bestD) {
        bestD = d;
        best = sh;
      }
    });
    if (!best) {
      vicinityIndex = 0;
      return;
    }
    // Vicinity = the 5 cells left→right on this face at this row
    vicinityGroup = shelves
      .filter(function (sh) {
        return sh.aisle === best.aisle && sh.side === best.side && sh.row === best.row;
      })
      .sort(function (a, b) {
        return a.col - b.col;
      });
    if (!vicinityGroup.length) vicinityGroup = [best];

    // Keep selected cell if still on this face/row and still in reach
    var still = false;
    if (selectedShelf) {
      for (var i = 0; i < vicinityGroup.length; i++) {
        if (vicinityGroup[i].id === selectedShelf.id) {
          var keepScore = shelfAccessScore(player.x, player.y, selectedShelf);
          if (keepScore < NEAR_SHELF_DIST + 28) {
            vicinityIndex = i;
            still = true;
          }
          break;
        }
      }
    }
    // Also keep face sticky when only the column would change from score noise
    if (!still && selectedShelf && selectedShelf.aisle === best.aisle && selectedShelf.side === best.side) {
      var sameFaceRow = vicinityGroup.filter(function (sh) {
        return sh.row === selectedShelf.row;
      });
      if (sameFaceRow.length && selectedShelf.row === best.row) {
        for (var j = 0; j < vicinityGroup.length; j++) {
          if (vicinityGroup[j].id === selectedShelf.id) {
            vicinityIndex = j;
            still = true;
            break;
          }
        }
      }
    }
    if (!still) {
      // Pick the closest column in this row (not always col 0)
      var pickIdx = 0;
      var pickD = 1e9;
      for (var k = 0; k < vicinityGroup.length; k++) {
        var sd = shelfAccessScore(player.x, player.y, vicinityGroup[k]);
        if (sd < pickD) {
          pickD = sd;
          pickIdx = k;
        }
      }
      vicinityIndex = pickIdx;
    }
    nearShelf = vicinityGroup[vicinityIndex] || best;
    selectedShelf = nearShelf;
  }

  function isInspectModalOpen() {
    var backdrop = $("sm-modal");
    return !!(backdrop && !backdrop.hidden);
  }

  function syncVicinitySelectionStatus() {
    if (!nearShelf) return;
    var ed = nearShelf.edition || {};
    var rowN = (nearShelf.row != null ? nearShelf.row : 0) + 1;
    setStatus(
      "Cell " +
        (vicinityIndex + 1) +
        "/5 · row " +
        rowN +
        "/" +
        ROWS_UD +
        " · " +
        (ed.empty ? "EMPTY" : ed.title || "Art") +
        " · stock " +
        (ed.stock || 0) +
        " · A/D or ←/→ cols · W/S or ↑/↓ rows · C inspect",
      "ok"
    );
    if (isInspectModalOpen()) {
      refreshInspectModal(nearShelf);
    }
  }

  /** Cycle left/right across the 5 cells in the current face row. */
  function cycleVicinity(dir) {
    if (!vicinityGroup.length) updateNearShelf();
    if (!vicinityGroup.length) {
      setStatus("Walk up to a shelf face first (5 cells highlight), then A/D or ←/→.", "err");
      return false;
    }
    vicinityIndex = (vicinityIndex + dir + vicinityGroup.length) % vicinityGroup.length;
    nearShelf = vicinityGroup[vicinityIndex];
    selectedShelf = nearShelf;
    syncVicinitySelectionStatus();
    return true;
  }

  /**
   * Move the 5-cell panel to the row above/below on the same aisle face.
   * dir -1 = toward top of aisle, +1 = toward bottom.
   */
  function cycleVicinityRow(dir) {
    if (!vicinityGroup.length && !(nearShelf || selectedShelf)) updateNearShelf();
    var base = nearShelf || selectedShelf || (vicinityGroup.length ? vicinityGroup[vicinityIndex] : null);
    if (!base) {
      setStatus("Walk up to a shelf face first, then W/S or ↑/↓ for rows.", "err");
      return false;
    }
    var preferCol =
      base.col != null
        ? base.col
        : vicinityGroup[vicinityIndex]
          ? vicinityGroup[vicinityIndex].col
          : 0;
    var newRow = ((base.row + dir) % ROWS_UD + ROWS_UD) % ROWS_UD;
    vicinityGroup = shelves
      .filter(function (sh) {
        return sh.aisle === base.aisle && sh.side === base.side && sh.row === newRow;
      })
      .sort(function (a, b) {
        return a.col - b.col;
      });
    if (!vicinityGroup.length) {
      setStatus("No cells on that row of this face.", "err");
      return false;
    }
    vicinityIndex = 0;
    for (var i = 0; i < vicinityGroup.length; i++) {
      if (vicinityGroup[i].col === preferCol) {
        vicinityIndex = i;
        break;
      }
    }
    nearShelf = vicinityGroup[vicinityIndex];
    selectedShelf = nearShelf;
    syncVicinitySelectionStatus();
    return true;
  }

  function canNavigateVicinityPanel() {
    return (
      isInspectModalOpen() ||
      (vicinityGroup && vicinityGroup.length > 0) ||
      !!(nearShelf || selectedShelf)
    );
  }

  function restockNearestOrSelected(randomOnly) {
    var sh = nearShelf || selectedShelf;
    if (!sh) {
      setStatus("Walk up to a shelf (gold highlight) first.", "err");
      return;
    }
    selectedShelf = sh;
    if (randomOnly) {
      restockShelf(sh, null);
      setStatus("R · auto-restocked " + (sh.edition.title || "shelf") + " (stock " + sh.edition.stock + ").", "ok");
      if (isInspectModalOpen()) refreshInspectModal(sh);
    } else {
      openInspectModal(sh);
    }
  }

  function shelfImageSrc(ed) {
    if (!ed) return "";
    if (ed.imageUrl) return ed.imageUrl;
    if (ed.number != null && window.getPaintingUrl) {
      try {
        return window.getPaintingUrl(ed.number) || "";
      } catch (err) {
        return "";
      }
    }
    return "";
  }

  function fillInspectDetail(shelf) {
    var detail = $("sm-inspect-detail");
    if (!detail || !shelf) return;
    var ed = shelf.edition || {};
    var cellLabel =
      vicinityGroup.length > 1
        ? " · selected cell " + (vicinityIndex + 1) + "/" + vicinityGroup.length
        : "";
    var imgSrc = shelfImageSrc(ed);
    detail.innerHTML =
      "<strong>" +
      escapeHtml(ed.empty ? "EMPTY SHELF" : ed.title || "Art") +
      "</strong><br/>" +
      '<span class="sm-muted">' +
      escapeHtml(ed.collection || "") +
      (ed.number != null ? " #" + ed.number : "") +
      " · stock " +
      (ed.stock || 0) +
      "/" +
      (ed.maxStock || 0) +
      " · aisle A" +
      (shelf.aisle + 1) +
      " face " +
      (shelf.side === 0 ? "L" : "R") +
      " · col " +
      ((shelf.col || 0) + 1) +
      "/5 row " +
      ((shelf.row || 0) + 1) +
      cellLabel +
      "</span>" +
      (imgSrc
        ? '<br/><img src="' +
          escapeHtml(imgSrc) +
          '" alt="" style="max-width:100%;max-height:140px;margin-top:0.4rem;border-radius:6px" />'
        : '<br/><span class="sm-muted" style="display:block;margin-top:0.35rem">(no image)</span>');
  }

  function bindInspectRestockActions(shelf) {
    var backdrop = $("sm-modal");
    var list = $("sm-pick-list");
    if (list) {
      list.innerHTML = "";
      var sample = catalog.slice().sort(function () {
        return Math.random() - 0.5;
      });
      sample.slice(0, 48).forEach(function (item) {
        var li = document.createElement("li");
        var btn = document.createElement("button");
        btn.type = "button";
        btn.textContent =
          (item.collection || "") +
          " · " +
          (item.title || "") +
          " (stock=" +
          galleryPrice(item.collection) +
          ")";
        btn.addEventListener("click", function () {
          restockShelf(shelf, item);
          if (backdrop) backdrop.hidden = true;
          setStatus("Shelf restocked with " + (item.title || "edition") + ".", "ok");
        });
        li.appendChild(btn);
        list.appendChild(li);
      });
    }
    var rnd = $("sm-inspect-random");
    if (rnd) {
      rnd.onclick = function () {
        restockShelf(shelf, null);
        if (isInspectModalOpen()) {
          refreshInspectModal(shelf);
        } else if (backdrop) {
          backdrop.hidden = true;
        }
        setStatus("Random edition placed on shelf.", "ok");
      };
    }
  }

  /** Refresh open inspect panel for the currently selected vicinity cell. */
  function refreshInspectModal(shelf) {
    shelf = shelf || nearShelf || selectedShelf;
    if (!shelf) return;
    selectedShelf = shelf;
    fillInspectDetail(shelf);
    // Restock actions must target the newly selected cell
    bindInspectRestockActions(shelf);
  }

  function openInspectModal(shelf) {
    shelf = shelf || nearShelf || selectedShelf;
    if (!shelf) {
      setStatus("No shelf nearby — walk closer until it glows gold, then press C.", "err");
      return;
    }
    selectedShelf = shelf;
    var backdrop = $("sm-modal");
    if (!backdrop) return;
    fillInspectDetail(shelf);
    bindInspectRestockActions(shelf);
    backdrop.hidden = false;
  }

  function allNpcsDone() {
    return allNpcsAtExit();
  }

  function finishWaveIfReady() {
    if (!waveActive || dayClosed) return;
    if (!allNpcsAtExit()) return;
    // Day complete: archive table, keep receipts on screen, wait for user
    waveActive = false;
    dayClosed = true;
    archiveDayInterval();
    saveDayLogs();
    setStatus(
      "Day " +
        simDay +
        " complete — all 99 archived in the day log table (Name · Inventory · Prompt). " +
        "Live receipts stay here for review. Next day will NOT start until you press Start next day.",
      "ok"
    );
    updateHud();
    renderDayLog();
    renderReceipts();
    renderLiveCarts();
  }

  function tryTakeFromShelf(shopper, shelf) {
    var ed = shelf.edition;
    if (!ed || ed.empty || ed.stock <= 0) return false;
    if (!canFitAnother(shopper, ed)) {
      if (!shopper.isPlayer && Math.random() < 0.2) {
        pushBubble(shopper, "Prompt budget tight…");
      }
      return false;
    }
    ed.stock -= 1;
    shopper.cart.push(Object.assign({}, ed, { stock: 1 }));
    if (ed.stock <= 0) {
      ed.empty = true;
      ed.stock = 0;
    }
    rememberChoice(shopper, ed, null);
    return true;
  }

  function forceTakeEdition(shopper, ed) {
    if (!ed || !shopper) return false;
    shopper.cart = shopper.cart || [];
    if (shopper.cart.length >= cartItemCap(shopper)) return false;
    // Bypass avoid-keys for guaranteed purchase; still respect hard 8000
    var probe = cartPrompt(shopper.cart.concat([ed]), shopper);
    if (probe.length > PROMPT_MAX && shopper.cart.length) return false;
    if (ed.stock != null && ed.stock > 0) {
      ed.stock -= 1;
      if (ed.stock <= 0) {
        ed.empty = true;
        ed.stock = 0;
      }
    }
    shopper.cart.push(Object.assign({}, ed, { stock: 1, empty: false }));
    rememberChoice(shopper, ed, null);
    return true;
  }

  function pushPlaceholderEdition(shopper) {
    var n = 1 + Math.floor(Math.random() * Math.max(40, catalog.length || 40));
    var url =
      window.getPaintingUrl && window.getPaintingUrl(n)
        ? window.getPaintingUrl(n)
        : "paintings/" + n + ".jpg";
    var a =
      window.getGalleryAnalysis && window.getGalleryAnalysis(n)
        ? window.getGalleryAnalysis(n)
        : null;
    var ed = {
      collection: "paintings",
      number: n,
      title: (a && a.title) || "impulse gallery light study",
      description: (a && a.description) || "",
      imageUrl: url,
      tags: (a && a.tags) || ["gallery", "impulse"],
      style: (a && a.style) || "soft still life",
      mood: (a && a.mood) || "curious",
      colors: (a && a.colors) || [],
      stock: 1,
      maxStock: 1,
      price: UNIT_PRICE,
      empty: false,
    };
    shopper.cart = shopper.cart || [];
    shopper.cart.push(ed);
    rememberChoice(
      shopper,
      ed,
      "impulse vision filled the empty cart with " + clipWords(visualPhrase(ed, 80), 70)
    );
    return ed;
  }

  /** Nobody leaves empty-handed — NPCs always get at least one real art description. */
  function ensureMinimumCart(shopper) {
    if (!shopper) return false;
    // Player chooses; never auto-fill their cart.
    if (shopper.isPlayer) return !!(shopper.cart && shopper.cart.length);
    shopper.cart = shopper.cart || [];
    if (shopper.cart.length > 0) return true;
    var candidates = shelves
      .filter(function (sh) {
        return sh.edition && !sh.edition.empty && sh.edition.stock > 0;
      })
      .sort(function (a, b) {
        return scoreShelf(shopper, b) - scoreShelf(shopper, a);
      });
    for (var i = 0; i < candidates.length; i++) {
      if (forceTakeEdition(shopper, candidates[i].edition)) {
        if (Math.random() < 0.25) pushBubble(shopper, "Got something!");
        return true;
      }
    }
    var target = candidates[0] || pick(shelves);
    if (target) {
      if (!target.edition || target.edition.empty || target.edition.stock <= 0) {
        restockShelf(target, null);
      }
      if (target.edition && forceTakeEdition(shopper, target.edition)) return true;
    }
    // Absolute fallback with real description text (never 0 items / 0 chars)
    pushPlaceholderEdition(shopper);
    return shopper.cart.length > 0;
  }

  function goToRegister(shopper) {
    ensureMinimumCart(shopper);
    padCartTowardHighChars(shopper);
    ensureMinimumCart(shopper);
    shopper.state = "checkout";
    shopper.target = pickRegister(shopper);
  }

  /** Pad with a few more pieces until the vision text is rich — never mega-carts. */
  function padCartTowardHighChars(shopper) {
    if (!shopper || shopper.isPlayer) return;
    ensureMinimumCart(shopper);
    var cap = cartItemCap(shopper);
    var guard = 0;
    while (!shouldCheckoutForPrompt(shopper) && guard < cap + 4) {
      guard++;
      if ((shopper.cart || []).length >= cap) break;
      var sh = pickTargetShelf(shopper);
      if (!sh) {
        var empty = shelves.filter(function (s) {
          return !s.edition || s.edition.empty || s.edition.stock <= 0;
        });
        if (empty.length) restockShelf(pick(empty), null);
        sh = pickTargetShelf(shopper);
      }
      if (!sh || !canFitAnother(shopper, sh.edition)) {
        if (visionFillLen(shopper.cart) < PROMPT_MAX * 0.4) {
          var any = shelves.find(function (s) {
            return s.edition && s.edition.stock > 0 && canFitAnother(shopper, s.edition);
          });
          if (any && forceTakeEdition(shopper, any.edition)) continue;
        }
        break;
      }
      if (!tryTakeFromShelf(shopper, sh)) {
        if (!forceTakeEdition(shopper, sh.edition)) break;
      }
    }
    ensureMinimumCart(shopper);
  }

  function centerOf(z) {
    return { x: z.x + z.w / 2, y: z.y + z.h / 2 };
  }

  function moveToward(entity, tx, ty, dt) {
    var dx = tx - entity.x;
    var dy = ty - entity.y;
    var dist = Math.sqrt(dx * dx + dy * dy) || 1;
    var sp = entitySpeed(entity, dx, dy) * dt;
    if (dist <= sp + 2) {
      tryMoveEntity(entity, tx, ty);
      return Math.hypot(entity.x - tx, entity.y - ty) < 6;
    }
    var nx = entity.x + (dx / dist) * sp;
    var ny = entity.y + (dy / dist) * sp;
    tryMoveEntity(entity, nx, ny);
    if (Math.hypot(entity.x - nx, entity.y - ny) < 0.1) {
      var sh = (entity.speedH || paceH) * dt;
      var sv = (entity.speedV || paceV) * dt;
      tryMoveEntity(entity, entity.x + (dx > 0 ? sh : dx < 0 ? -sh : 0), entity.y);
      tryMoveEntity(entity, entity.x, entity.y + (dy > 0 ? sv : dy < 0 ? -sv : 0));
    }
    return Math.hypot(entity.x - tx, entity.y - ty) < 8;
  }

  function pickTargetShelf(shopper) {
    var ranked = shelves
      .map(function (sh) {
        return { sh: sh, score: scoreShelf(shopper, sh) };
      })
      .filter(function (x) {
        return x.score > 0.2;
      })
      .sort(function (a, b) {
        return b.score - a.score;
      });
    if (!ranked.length) return null;
    var top = ranked.slice(0, Math.min(6, ranked.length));
    return pick(top).sh;
  }

  function checkoutShopper(shopper) {
    // Guaranteed cart + high char fill under 8000 (NPCs only for pad/force)
    ensureMinimumCart(shopper);
    if (!shopper.isPlayer) {
      padCartTowardHighChars(shopper);
      ensureMinimumCart(shopper);
    }
    if (!shopper.isPlayer && (!shopper.cart || !shopper.cart.length)) {
      pushPlaceholderEdition(shopper);
    }
    var items = (shopper.cart || []).slice();
    // Player may leave empty; NPCs never do.
    if (!shopper.isPlayer && !items.length) {
      pushPlaceholderEdition(shopper);
      items = (shopper.cart || []).slice();
    }
    var prompt = cartPrompt(items, shopper);
    if (!items.length) {
      prompt =
        "An empty frame — the shopper left without fusing an aisle vision into a single image.";
    } else if (!prompt || !String(prompt).trim()) {
      prompt = cartPrompt(items, shopper);
    }
    prompt = stripCatalogSpeak(String(prompt)).slice(0, PROMPT_MAX);
    if (prompt.length < 1) {
      prompt =
        "A single continuous gallery tableau fused from aisle finds — one image for still and video.";
    }
    var fillPct = Math.round((prompt.length / PROMPT_MAX) * 100);
    shopper.pendingReceipt = {
      id: shopper.id + "-" + Date.now(),
      shopperId: shopper.id,
      name: shopper.name,
      items: items,
      prompt: prompt,
      chars: prompt.length,
      fillPct: fillPct,
      day: simDay,
      total: items.length * UNIT_PRICE,
      aspect:
        shopper.preferredAspect ||
        (shopper.taste && shopper.taste.preferredAspect) ||
        "16:9",
      generatedUrl: shopper.generatedUrl || "",
      at: null,
      isPlayer: !!shopper.isPlayer,
    };
    // Keep items on pending for social influence; cart cleared for new shopping later
    shopper.cart = [];
    shopper.state = "exit";
    shopper.target = centerOf(zones.exit);
    if (shopper.isPlayer) {
      syncPlayerPrompt();
      setStatus(
        "Checked out (" +
          (shopper.pendingReceipt.chars || 0) +
          " chars). Walk to EXIT to log receipt.",
        "ok"
      );
    }
    renderLiveCarts();
  }

  function finalizeReceiptOnExit(shopper) {
    if (!shopper.pendingReceipt) return;
    var rec = shopper.pendingReceipt;
    // Last defense: never log an NPC receipt with zero art pieces.
    if (!shopper.isPlayer && (!rec.items || !rec.items.length)) {
      var ph = pushPlaceholderEdition(shopper);
      rec.items = [Object.assign({}, ph)];
      shopper.cart = [];
      rec.prompt = cartPrompt(rec.items, shopper);
      rec.chars = rec.prompt.length;
      rec.total = rec.items.length * UNIT_PRICE;
      rec.fillPct = Math.round((rec.chars / PROMPT_MAX) * 100);
    }
    if (!rec.prompt || !String(rec.prompt).trim()) {
      rec.prompt = cartPrompt(rec.items || [], shopper);
    }
    rec.chars = String(rec.prompt).length;
    rec.fillPct = Math.round((rec.chars / PROMPT_MAX) * 100);
    rec.at = new Date().toISOString();
    rec.exited = true;
    receipts.unshift(rec);
    if (receipts.length > 120) receipts = receipts.slice(0, 120);
    shopper.pendingReceipt = null;
    // Keep top-char sort visible; auto-select newest if nothing selected
    if (!selectedReceiptId) selectedReceiptId = rec.id;
    renderReceipts();
    renderLiveCarts();
  }

  /** Nudge a stuck body into the nearest open walkway (not inside an aisle solid). */
  function snapToOpenWalkway(entity) {
    if (!entity) return;
    var r = (entity.r || 5) + 1;
    var candidates = [];
    solids.forEach(function (s) {
      var y = clamp(entity.y, s.y + 12, s.y + s.h - 12);
      candidates.push({ x: s.x - 16, y: y });
      candidates.push({ x: s.x + s.w + 16, y: y });
      candidates.push({ x: s.x + s.w * 0.5, y: s.y - 14 });
      candidates.push({ x: s.x + s.w * 0.5, y: s.y + s.h + 14 });
    });
    if (zones.midLane) {
      candidates.push({
        x: zones.midLane.x + zones.midLane.w * (0.2 + Math.random() * 0.6),
        y: zones.midLane.y + zones.midLane.h * 0.5,
      });
    }
    if (zones.aisles) {
      candidates.push({
        x: zones.aisles.x + 20,
        y: zones.aisles.y + zones.aisles.h * 0.5,
      });
      candidates.push({
        x: zones.aisles.x + zones.aisles.w - 20,
        y: zones.aisles.y + zones.aisles.h * 0.5,
      });
    }
    var best = null;
    var bestD = 1e9;
    candidates.forEach(function (c) {
      if (circleHitsSolid(c.x, c.y, r)) return;
      var d = Math.hypot(entity.x - c.x, entity.y - c.y);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    });
    if (best) {
      entity.x = best.x;
      entity.y = best.y;
    } else if (zones.midLane) {
      entity.x = zones.midLane.x + zones.midLane.w * 0.5;
      entity.y = zones.midLane.y + zones.midLane.h * 0.5;
    }
  }

  function hardBailToExit(shopper) {
    ensureMinimumCart(shopper);
    if (!shopper.pendingReceipt) {
      if (!shopper.cart || !shopper.cart.length) ensureMinimumCart(shopper);
      checkoutShopper(shopper);
    }
    // Warp into mid checkout lane so aisle corners cannot trap them again
    if (zones.midLane) {
      shopper.x = zones.midLane.x + 40 + Math.random() * Math.max(20, zones.midLane.w - 80);
      shopper.y = zones.midLane.y + zones.midLane.h * (0.35 + Math.random() * 0.3);
    }
    if (circleHitsSolid(shopper.x, shopper.y, (shopper.r || 5) + 1)) {
      snapToOpenWalkway(shopper);
    }
    shopper.state = "exit";
    shopper.target = centerOf(zones.exit);
    shopper.stuckT = 0;
    shopper.stuckStrikes = 0;
    shopper.dwell = 0;
    shopper.kioskDwell = 0;
    if (Math.random() < 0.5) pushBubble(shopper, "Clear path — exiting!");
    rememberCrowd(shopper, "They shook free of an aisle corner and headed straight for exit with one fused cart vision.");
  }

  function grabFromNearestAisleWhileStuck(shopper) {
    // Prompt count goes up using nearby aisle stock, then they bail to register → exit
    snapToOpenWalkway(shopper);
    ensureMinimumCart(shopper);
    var nearby = shelves
      .map(function (sh) {
        var ax = sh.approachX != null ? sh.approachX : sh.x + sh.w / 2;
        var ay = sh.approachY != null ? sh.approachY : sh.y + sh.h / 2;
        return { sh: sh, d: Math.hypot(shopper.x - ax, shopper.y - ay) };
      })
      .filter(function (x) {
        return x.d < 140 && x.sh.edition && x.sh.edition.stock > 0;
      })
      .sort(function (a, b) {
        return a.d - b.d;
      });
    var grabs = 0;
    for (var i = 0; i < nearby.length && grabs < 4; i++) {
      if (canFitAnother(shopper, nearby[i].sh.edition)) {
        if (tryTakeFromShelf(shopper, nearby[i].sh) || forceTakeEdition(shopper, nearby[i].sh.edition)) {
          grabs++;
        }
      } else if (promptLen(shopper.cart, shopper) < 40) {
        if (forceTakeEdition(shopper, nearby[i].sh.edition)) grabs++;
      }
    }
    padCartTowardHighChars(shopper);
    ensureMinimumCart(shopper);
    goToRegister(shopper);
    // Point register path through mid-lane so they leave the aisle block
    if (shopper.target && zones.midLane) {
      var reg = shopper.target;
      shopper.target = {
        x: reg.x,
        y: reg.y,
        registerId: reg.registerId,
        viaMid: true,
      };
    }
    if (Math.random() < 0.45) pushBubble(shopper, "Unstuck — to register!");
    rememberCrowd(shopper, "Stuck on an aisle corner; nearby shelf vision padded the cart before register.");
    return true;
  }

  function unstickIfNeeded(shopper, dt) {
    if (!shopper || shopper.isPlayer) return false;
    if (shopper.state === "waiting" || shopper.state === "done" || shopper.state === "at_exit") return false;
    var moved = Math.hypot(shopper.x - (shopper.lastX || 0), shopper.y - (shopper.lastY || 0));
    if (moved < 1.0) shopper.stuckT = (shopper.stuckT || 0) + dt;
    else shopper.stuckT = 0;
    shopper.lastX = shopper.x;
    shopper.lastY = shopper.y;
    if ((shopper.stuckT || 0) < STUCK_TIMEOUT) return false;

    shopper.stuckT = 0;
    shopper.dwell = 0;
    shopper.target = null;
    shopper.stuckStrikes = (shopper.stuckStrikes || 0) + 1;
    snapToOpenWalkway(shopper);

    // Second strike (or already leaving): force checkout path + warp free
    if (
      shopper.stuckStrikes >= STUCK_HARD_BAIL ||
      shopper.state === "exit" ||
      shopper.state === "checkout" ||
      shopper.state === "kiosk"
    ) {
      hardBailToExit(shopper);
      return true;
    }

    // Entry kiosk jam: snap free and release into store
    if (shopper.state === "entry_kiosk" || shopper.state === "enter") {
      snapToOpenWalkway(shopper);
      shopper.state = "browse";
      shopper.kioskPhase = null;
      shopper.aisleIdx = 0;
      shopper.target = releaseFromKioskIntoStore(shopper);
      return true;
    }
    // First strike while browsing / bathroom: pad cart, go register → exit
    if (shopper.state === "browse" || shopper.state === "bathroom") {
      grabFromNearestAisleWhileStuck(shopper);
      return true;
    }
    hardBailToExit(shopper);
    return true;
  }

  function updateNpc(shopper, dt) {
    if (shopper.isPlayer) return;
    if (shopper.state === "waiting" || shopper.state === "done" || shopper.state === "at_exit") return;

    if (shopper.bubbleT > 0) {
      shopper.bubbleT -= dt;
      if (shopper.bubbleT <= 0) shopper.bubble = "";
    }

    // Always run stuck recovery first (bathroom used to return before unstick)
    unstickIfNeeded(shopper, dt);
    if (shopper.state === "done" || shopper.state === "at_exit") return;

    // Bathroom relief path
    if (shopper.state === "bathroom") {
      if (!shopper.target) shopper.target = bathroomPoint();
      var arrivedBath = moveToward(shopper, shopper.target.x, shopper.target.y, dt);
      if (arrivedBath) {
        shopper.bathroomDwell = (shopper.bathroomDwell || BATHROOM_DWELL) - dt;
        if (shopper.bathroomDwell <= 0) {
          shopper.state = "browse";
          shopper.target = null;
          shopper.bathroomCd = 10 + rand(0, 8);
          if (Math.random() < 0.35) pushBubble(shopper, "Better — back to shopping.");
        }
      }
      // If still frozen after a long bathroom attempt, hard bail next unstick tick
      return;
    }

    var social = applySocialForces(shopper, dt);
    if (social.crowded && shopper.state === "browse") {
      if (Math.random() < 0.12) shopper.target = null;
    }

    if (shopper.dwell > 0) {
      shopper.dwell -= dt;
      return;
    }

    // Entrance → 6 entry kiosks (split 99) → release into aisles → exit kiosk → register
    if (shopper.state === "enter") {
      if (!shopper.entryKioskId) assignEntryDispatch(shopper, (shopper.id || 1) - 1);
      goToEntryKiosk(shopper);
    }

    // Always secure at least one item once they're a few aisles in
    if (
      shopper.state === "browse" &&
      (!shopper.cart || !shopper.cart.length) &&
      (shopper.aisleIdx || 0) >= 1 &&
      Math.random() < 0.15
    ) {
      ensureMinimumCart(shopper);
    }

    if (shopper.state === "browse") {
      if ((shopper.aisleIdx || 0) >= AISLE_COUNT) {
        goToKiosk(shopper);
      } else if (!shopper.target) {
        if (!shopper.aisleOrder || !shopper.aisleOrder.length) {
          shopper.aisleOrder = makeAisleOrderForShopper(shopper);
        }
        var aisleNum = shopper.aisleOrder[shopper.aisleIdx || 0];
        if (aisleNum == null) aisleNum = shopper.startAisle != null ? shopper.startAisle : 0;
        var promptFull = shouldCheckoutForPrompt(shopper);
        var mustGetOne = !shopper.cart || !shopper.cart.length;
        var sh = promptFull && !mustGetOne ? null : pickShelfOnAisle(shopper, aisleNum);
        if (mustGetOne && !sh) {
          var any = shelves
            .filter(function (s) {
              return s.edition && s.edition.stock > 0 && !s.edition.empty;
            })
            .sort(function (a, b) {
              return scoreShelf(shopper, b) - scoreShelf(shopper, a);
            });
          sh = any[0] || null;
          if (!sh) ensureMinimumCart(shopper);
        }
        var maxOnAisle = 1 + Math.floor(shopper.taste.greed * 2);
        // Walk full depth of aisle sometimes (visit) so they don't only clip the front
        var wantDeepWalk =
          (shopper.aisleGrabs || 0) === 0 && Math.random() < 0.35 && !mustGetOne;
        if (wantDeepWalk && !sh) {
          var vpDeep = aisleVisitPoint(aisleNum, shopper);
          shopper.target = {
            x: vpDeep.x,
            y: vpDeep.y,
            visitOnly: true,
          };
        } else if ((!mustGetOne && promptFull) || (shopper.aisleGrabs || 0) >= maxOnAisle || !sh) {
          if (!sh && (shopper.aisleGrabs || 0) === 0 && !mustGetOne) {
            var vp = aisleVisitPoint(aisleNum, shopper);
            shopper.target = { x: vp.x, y: vp.y, shelf: null, visitOnly: true };
          } else if (mustGetOne && sh) {
            var ax0 = sh.approachX != null ? sh.approachX : sh.x + sh.w / 2;
            var ay0 = sh.approachY != null ? sh.approachY : sh.y + sh.h / 2;
            shopper.target = { x: ax0, y: ay0, shelf: sh };
          } else {
            advanceAisleOrCheckout(shopper);
          }
        } else {
          var ax = sh.approachX != null ? sh.approachX : sh.x + sh.w / 2;
          var ay = sh.approachY != null ? sh.approachY : sh.y + sh.h / 2;
          shopper.target = { x: ax, y: ay, shelf: sh };
        }
      }
    }

    if (shopper.state === "entry_kiosk" && !shopper.target) {
      shopper.target = entryKioskPoint(shopper);
    }

    if (shopper.target) {
      var arrived = moveToward(shopper, shopper.target.x, shopper.target.y, dt);
      if (arrived) {
        if (shopper.state === "entry_kiosk") {
          if (shopper.kioskDwell == null) shopper.kioskDwell = 0.9;
          shopper.kioskDwell -= dt;
          if (shopper.kioskDwell <= 0) {
            shopper.state = "browse";
            shopper.kioskPhase = null;
            shopper.aisleIdx = 0;
            shopper.aisleGrabs = 0;
            if (!shopper.aisleOrder || !shopper.aisleOrder.length) {
              shopper.aisleOrder = makeAisleOrderForShopper(shopper);
            }
            shopper.target = releaseFromKioskIntoStore(shopper);
            if (Math.random() < 0.12) {
              pushBubble(
                shopper,
                "K" + (shopper.entryKioskId || "") + " → aisles"
              );
            }
          }
        } else if (shopper.state === "browse" && shopper.target.wander) {
          shopper.dwell = rand(0.04, 0.12);
          shopper.target = null;
        } else if (shopper.state === "browse" && shopper.target.releaseWalk) {
          // Stepped into mid-lane — continue toward first aisle visit
          var nextA = shopper.target.nextAisle;
          if (nextA == null && shopper.aisleOrder) nextA = shopper.aisleOrder[0];
          var vpR = aisleVisitPoint(nextA != null ? nextA : 0, shopper);
          shopper.target = { x: vpR.x, y: vpR.y, visitOnly: true };
          shopper.dwell = rand(0.02, 0.08);
        } else if (shopper.state === "browse" && shopper.target.visitOnly) {
          shopper.dwell = rand(0.04, 0.12);
          shopper.target = null;
          // Sometimes walk the other side of the same aisle before advancing
          if (Math.random() < 0.3 && (shopper.aisleGrabs || 0) < 1) {
            shopper.aisleSidePrefer = shopper.aisleSidePrefer === 1 ? 0 : 1;
            var aisleHere = (shopper.aisleOrder || [])[shopper.aisleIdx || 0];
            if (aisleHere != null) {
              var vp2 = aisleVisitPoint(aisleHere, shopper);
              shopper.target = { x: vp2.x, y: vp2.y, visitOnly: true };
            } else {
              advanceAisleOrCheckout(shopper);
            }
          } else {
            advanceAisleOrCheckout(shopper);
          }
        } else if (shopper.state === "browse" && shopper.target.shelf) {
          var took = tryTakeFromShelf(shopper, shopper.target.shelf);
          if (took) {
            shopper.aisleGrabs = (shopper.aisleGrabs || 0) + 1;
            renderLiveCarts();
          }
          shopper.dwell = rand(0.05, 0.14) * shopper.taste.patience;
          shopper.target = null;
          var maxOn = 1 + Math.floor(shopper.taste.greed * 2);
          if ((shopper.aisleGrabs || 0) >= maxOn || !took || shouldCheckoutForPrompt(shopper)) {
            advanceAisleOrCheckout(shopper);
          }
        } else if (shopper.state === "kiosk") {
          // Exit kiosk (scan / bag), then registers
          if (shopper.kioskDwell == null) shopper.kioskDwell = 0.45;
          shopper.kioskDwell -= dt;
          if (shopper.kioskDwell <= 0) {
            ensureMinimumCart(shopper);
            goToRegister(shopper);
            if (Math.random() < 0.2) {
              pushBubble(
                shopper,
                "Kiosk done → R" + ((shopper.target && shopper.target.registerId) || "")
              );
            }
          }
        } else if (shopper.state === "checkout") {
          checkoutShopper(shopper);
        } else if (shopper.state === "exit") {
          finalizeReceiptOnExit(shopper);
          shopper.state = "at_exit";
          shopper.target = null;
          shopper.x = zones.exit.x + 10 + Math.random() * Math.max(10, zones.exit.w - 20);
          shopper.y = zones.exit.y + 8 + Math.random() * Math.max(8, zones.exit.h - 16);
          finishWaveIfReady();
        }
      }
    } else if (
      shopper.state === "browse" ||
      shopper.state === "entry_kiosk" ||
      shopper.state === "kiosk" ||
      shopper.state === "checkout" ||
      shopper.state === "exit"
    ) {
      if (shopper.state === "browse") {
        // Don't skip aisles — pick next aisle target
        shopper.target = null;
      } else if (shopper.state === "entry_kiosk") shopper.target = entryKioskPoint(shopper);
      else if (shopper.state === "kiosk") shopper.target = pickKiosk(shopper);
      else if (shopper.state === "checkout") goToRegister(shopper);
      else shopper.target = centerOf(zones.exit);
    }
  }

  function updatePlayer(dt) {
    if (!player) return;
    applySocialForces(player, dt);
    // While inspect is open, WASD only steers the 5-cell panel (not walking)
    var inspectNav = isInspectModalOpen();
    var mx = 0;
    var my = 0;
    if (!inspectNav) {
      if (keys.w) my -= 1;
      if (keys.s) my += 1;
      if (keys.a) mx -= 1;
      if (keys.d) mx += 1;
      // Arrow keys are panel-only (never walk)
    }
    if (mx || my) {
      var len = Math.sqrt(mx * mx + my * my);
      var sp = entitySpeed(player, mx, my) * dt;
      var nx = player.x + (mx / len) * sp;
      var ny = player.y + (my / len) * sp;
      tryMoveEntity(player, nx, ny);
      player.x = clamp(player.x, 8, W - 8);
      player.y = clamp(player.y, 10, H - 10);
    }
    updateNearShelf();
    // Finalize player receipt when leaving through EXIT with pending checkout
    if (
      player.pendingReceipt &&
      Math.hypot(
        player.x - (zones.exit.x + zones.exit.w / 2),
        player.y - (zones.exit.y + zones.exit.h / 2)
      ) < 55
    ) {
      finalizeReceiptOnExit(player);
      setStatus("Your receipt logged at exit (" + (receipts[0] && receipts[0].chars) + " chars).", "ok");
    }
    syncPlayerPrompt();
  }

  function syncPlayerPrompt() {
    var ta = $("sm-player-prompt");
    var count = $("sm-char-count");
    if (!player) return;
    var auto = cartPrompt(player.cart, player);
    if (ta && document.activeElement !== ta) {
      // Keep player edits if they diverged; merge cart lines when cart changes
      if (!ta.dataset.locked || ta.dataset.cartSig !== String(player.cart.length)) {
        ta.value = auto;
        ta.dataset.cartSig = String(player.cart.length);
        ta.dataset.locked = "";
      }
    }
    var text = ta ? ta.value : auto;
    var n = text.length;
    if (count) {
      count.textContent = n + " / " + PROMPT_MAX + " characters (checkout before overflow)";
      count.className = "sm-char-count" + (n > PROMPT_MAX ? " over" : n > PROMPT_MAX * 0.85 ? " warn" : "");
    }
  }

  function playerPickupNearest() {
    if (!player) return;
    // Prefer the gold-selected cell when it's still in reach
    if (nearShelf && shelfAccessScore(player.x, player.y, nearShelf) < NEAR_SHELF_DIST + 28) {
      var sel = nearShelf;
      if (sel.edition && !sel.edition.empty && sel.edition.stock > 0) {
        var nextSel = cartPrompt(player.cart.concat([sel.edition]), player);
        if (nextSel.length > PROMPT_MAX) {
          setStatus("Prompt would exceed " + PROMPT_MAX + " — go to REGISTER and check out (near green counter).", "err");
          return;
        }
        tryTakeFromShelf(player, sel);
        var ta0 = $("sm-player-prompt");
        if (ta0) {
          ta0.dataset.locked = "";
          ta0.dataset.cartSig = "";
        }
        syncPlayerPrompt();
        setStatus("Picked 1× " + (sel.edition.title || "art") + " ($1). Stock left: " + sel.edition.stock, "ok");
        return;
      }
    }
    var best = null;
    var bestD = NEAR_SHELF_DIST + 18;
    shelves.forEach(function (sh) {
      var d = shelfAccessScore(player.x, player.y, sh);
      if (d < bestD) {
        bestD = d;
        best = sh;
      }
    });
    if (!best) {
      setStatus("Walk closer to a stocked shelf (E to grab).", "");
      return;
    }
    if (best.edition.empty || best.edition.stock <= 0) {
      selectedShelf = best;
      setStatus("Shelf empty (gray). Click it or use Restock random / deliberate.", "err");
      return;
    }
    var next = cartPrompt(player.cart.concat([best.edition]), player);
    if (next.length > PROMPT_MAX) {
      setStatus("Prompt would exceed " + PROMPT_MAX + " — go to REGISTER and check out (near green counter).", "err");
      return;
    }
    tryTakeFromShelf(player, best);
    var ta = $("sm-player-prompt");
    if (ta) {
      ta.dataset.locked = "";
      ta.dataset.cartSig = "";
    }
    syncPlayerPrompt();
    setStatus("Picked 1× " + (best.edition.title || "art") + " ($1). Stock left: " + best.edition.stock, "ok");
  }

  function playerCheckout() {
    if (!player) return;
    var nr = nearestRegisterPoint(player.x, player.y);
    var near = nr.dist < 55;
    if (!near) {
      setStatus("Walk to one of the 11 REGISTERS (bottom) to check out.", "");
      return;
    }
    if (!player.cart.length) {
      setStatus("Cart empty — grab art from shelves first (E).", "");
      return;
    }
    var ta = $("sm-player-prompt");
    if (ta && ta.value.length > PROMPT_MAX) {
      setStatus("Trim your prompt under " + PROMPT_MAX + " before checkout.", "err");
      return;
    }
    checkoutShopper(player);
  }

  function restockShelf(shelf, item) {
    if (!shelf) return;
    shelf.edition = item ? editionFromItem(item) : randomEdition();
    shelf.edition.empty = false;
    selectedShelf = shelf;
    setStatus(
      "Restocked shelf with " +
        shelf.edition.title +
        " — stock " +
        shelf.edition.stock +
        " (gallery price count), sell $1 each.",
      "ok"
    );
  }

  function hitShelf(mx, my) {
    for (var i = 0; i < shelves.length; i++) {
      var sh = shelves[i];
      if (mx >= sh.x && mx <= sh.x + sh.w && my >= sh.y && my <= sh.y + sh.h) return sh;
    }
    return null;
  }

  function hitShopper(mx, my) {
    var list = shoppers.concat(player ? [player] : []);
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      if (Math.hypot(mx - s.x, my - s.y) < s.r + 6) return s;
    }
    return null;
  }

  function canvasCoords(ev) {
    var rect = canvas.getBoundingClientRect();
    var sx = canvas.width / rect.width;
    var sy = canvas.height / rect.height;
    return {
      x: (ev.clientX - rect.left) * sx,
      y: (ev.clientY - rect.top) * sy,
    };
  }

  function onCanvasClick(ev) {
    var p = canvasCoords(ev);
    var sh = hitShelf(p.x, p.y);
    if (sh) {
      selectedShelf = sh;
      nearShelf = sh;
      // Sync vicinity to the clicked face/row so gold highlight matches the click
      vicinityGroup = shelves
        .filter(function (s) {
          return s.aisle === sh.aisle && s.side === sh.side && s.row === sh.row;
        })
        .sort(function (a, b) {
          return a.col - b.col;
        });
      vicinityIndex = 0;
      for (var ci = 0; ci < vicinityGroup.length; ci++) {
        if (vicinityGroup[ci].id === sh.id) {
          vicinityIndex = ci;
          break;
        }
      }
      if (sh.edition.empty || sh.edition.stock <= 0) {
        restockShelf(sh, null);
      } else {
        setStatus(
          "Shelf: " +
            sh.edition.title +
            " · " +
            (sh.side === 0 ? "left" : "right") +
            " face · cell " +
            (vicinityIndex + 1) +
            "/5 · stock " +
            sh.edition.stock +
            "/" +
            sh.edition.maxStock +
            " · $1 each. ←/→ cycle · E grab.",
          "ok"
        );
      }
      return;
    }
    var s = hitShopper(p.x, p.y);
    if (s) {
      selectedShopper = s;
      var sel = $("sm-name-select");
      var input = $("sm-name-input");
      if (sel) sel.value = String(s.id);
      if (input) input.value = s.name;
      setStatus("Selected " + s.name + " (#" + s.id + ") — edit name tag on the right.", "ok");
    }
  }

  function draw() {
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    // floor
    ctx.fillStyle = "#101816";
    ctx.fillRect(0, 0, W, H);
    // tile grid
    ctx.strokeStyle = "rgba(255,255,255,0.03)";
    ctx.lineWidth = 1;
    for (var gx = 0; gx < W; gx += 28) {
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, H);
      ctx.stroke();
    }
    for (var gy = 0; gy < H; gy += 28) {
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(W, gy);
      ctx.stroke();
    }

    function zone(z, fill, stroke) {
      ctx.fillStyle = fill;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 2;
      ctx.fillRect(z.x, z.y, z.w, z.h);
      ctx.strokeRect(z.x, z.y, z.w, z.h);
      ctx.fillStyle = "rgba(220,240,230,0.75)";
      ctx.font = "bold 11px system-ui,sans-serif";
      ctx.fillText(z.label, z.x + 8, z.y + 16);
    }
    // Bottom strip floor
    if (zones.bottomStrip) {
      ctx.fillStyle = "rgba(12, 18, 16, 0.95)";
      ctx.fillRect(zones.bottomStrip.x, zones.bottomStrip.y, zones.bottomStrip.w, zones.bottomStrip.h);
      ctx.strokeStyle = "rgba(100, 160, 120, 0.35)";
      ctx.beginPath();
      ctx.moveTo(0, zones.bottomStrip.y);
      ctx.lineTo(W, zones.bottomStrip.y);
      ctx.stroke();
    }
    // Back-room bathroom lane (stress relief)
    if (zones.bathroom) {
      ctx.fillStyle = "rgba(28, 36, 48, 0.95)";
      ctx.strokeStyle = "rgba(120, 150, 200, 0.45)";
      ctx.lineWidth = 2;
      ctx.fillRect(zones.bathroom.x, zones.bathroom.y, zones.bathroom.w, zones.bathroom.h);
      ctx.strokeRect(zones.bathroom.x, zones.bathroom.y, zones.bathroom.w, zones.bathroom.h);
      ctx.fillStyle = "rgba(160, 190, 230, 0.75)";
      ctx.font = "bold 11px system-ui,sans-serif";
      ctx.fillText(zones.bathroom.label, zones.bathroom.x + 10, zones.bathroom.y + 20);
      ctx.fillStyle = "rgba(140, 170, 210, 0.45)";
      ctx.font = "9px system-ui,sans-serif";
      ctx.fillText("cool-off when 4+ clustered", zones.bathroom.x + 10, zones.bathroom.y + 36);
    }
    // Mid-lane between aisles and registers (wide checkout approach)
    if (zones.midLane) {
      ctx.fillStyle = "rgba(22, 32, 28, 0.92)";
      ctx.fillRect(zones.midLane.x, zones.midLane.y, zones.midLane.w, zones.midLane.h);
      ctx.strokeStyle = "rgba(100, 160, 120, 0.25)";
      ctx.strokeRect(zones.midLane.x, zones.midLane.y, zones.midLane.w, zones.midLane.h);
      ctx.fillStyle = "rgba(160, 200, 170, 0.35)";
      ctx.font = "10px system-ui,sans-serif";
      ctx.fillText(zones.midLane.label || "CHECKOUT LANE", zones.midLane.x + 8, zones.midLane.y + 14);
    }
    // 6 front kiosks
    (zones.kiosks || []).forEach(function (k) {
      ctx.fillStyle = "rgba(55, 48, 30, 0.9)";
      ctx.strokeStyle = "rgba(230, 190, 90, 0.75)";
      ctx.lineWidth = 1.5;
      ctx.fillRect(k.x, k.y, k.w, k.h);
      ctx.strokeRect(k.x, k.y, k.w, k.h);
      ctx.fillStyle = "rgba(40, 36, 22, 0.95)";
      ctx.fillRect(k.x + 3, k.y + 3, k.w - 6, 10);
      ctx.fillStyle = "rgba(255, 230, 160, 0.9)";
      ctx.font = "bold 10px system-ui,sans-serif";
      var kt = ctx.measureText(k.label).width;
      ctx.fillText(k.label, k.x + (k.w - kt) / 2, k.y + k.h * 0.68);
    });
    zone(zones.entrance, "rgba(40,90,60,0.4)", "rgba(100,200,140,0.55)");
    zone(zones.exit, "rgba(90,50,40,0.4)", "rgba(220,120,100,0.55)");
    // 11 individual registers (well below aisles)
    (zones.registers || []).forEach(function (r) {
      ctx.fillStyle = "rgba(45, 85, 55, 0.55)";
      ctx.strokeStyle = "rgba(120, 220, 140, 0.75)";
      ctx.lineWidth = 1.5;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      // counter top
      ctx.fillStyle = "rgba(30, 50, 36, 0.9)";
      ctx.fillRect(r.x + 2, r.y + 2, r.w - 4, Math.min(14, r.h * 0.28));
      ctx.fillStyle = "rgba(200, 255, 210, 0.85)";
      ctx.font = "bold 9px system-ui,sans-serif";
      var tw = ctx.measureText(r.label).width;
      ctx.fillText(r.label, r.x + (r.w - tw) / 2, r.y + r.h * 0.62);
    });

    // Aisle hall floor (walkable corridors)
    ctx.fillStyle = "rgba(18,28,24,0.9)";
    ctx.fillRect(zones.aisles.x, zones.aisles.y, zones.aisles.w, zones.aisles.h);

    // Double-sided aisle solids (spine down the middle)
    solids.forEach(function (s) {
      ctx.fillStyle = "rgba(26, 34, 30, 0.98)";
      ctx.strokeStyle = "rgba(90, 120, 100, 0.5)";
      ctx.lineWidth = 1;
      ctx.fillRect(s.x, s.y, s.w, s.h);
      ctx.strokeRect(s.x, s.y, s.w, s.h);
      ctx.fillStyle = "rgba(48, 52, 50, 0.95)";
      ctx.fillRect(s.x + s.w * 0.5 - 2.5, s.y, 5, s.h);
      ctx.fillStyle = "rgba(160, 200, 170, 0.4)";
      ctx.font = "9px system-ui,sans-serif";
      ctx.fillText("A" + (s.aisle + 1), s.x + 3, s.y + 11);
    });

    // Face cells: flatter elongated rects (5 across × 8 up/down per face)
    shelves.forEach(function (sh) {
      var ed = sh.edition;
      var empty = !ed || ed.empty || ed.stock <= 0;
      var inVicinity = false;
      for (var vi = 0; vi < vicinityGroup.length; vi++) {
        if (vicinityGroup[vi].id === sh.id) {
          inVicinity = true;
          break;
        }
      }
      var isNear = nearShelf && nearShelf.id === sh.id;
      var isSel = selectedShelf && selectedShelf.id === sh.id;
      ctx.fillStyle = empty
        ? "#3a3a3a"
        : isNear
          ? "#4a4020"
          : inVicinity
            ? "#3a3420"
            : "#24382c";
      ctx.strokeStyle = isNear
        ? "#ffd700"
        : inVicinity
          ? "rgba(255, 215, 0, 0.65)"
          : isSel
            ? "#7dffb3"
            : empty
              ? "#555"
              : "rgba(200,160,60,0.45)";
      ctx.lineWidth = isNear ? 2.4 : inVicinity ? 1.6 : isSel ? 1.4 : 0.5;
      ctx.fillRect(sh.x, sh.y, sh.w, sh.h);
      ctx.strokeRect(sh.x, sh.y, sh.w, sh.h);
      if (isNear) {
        ctx.strokeStyle = "rgba(255,215,0,0.5)";
        ctx.lineWidth = 3;
        ctx.strokeRect(sh.x - 1.5, sh.y - 1.5, sh.w + 3, sh.h + 3);
      }
      ctx.fillStyle = empty ? "#777" : "#e8d48a";
      ctx.font = "7px system-ui,sans-serif";
      var label = empty ? "" : String(ed.stock);
      if (label && sh.w >= 10 && sh.h >= 8) {
        ctx.fillText(label, sh.x + 2, sh.y + Math.min(10, sh.h - 1));
      }
    });

    function drawDot(s) {
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = s.color;
      ctx.fill();
      if (selectedShopper && selectedShopper.id === s.id) {
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.font = "9px system-ui,sans-serif";
      ctx.fillText(s.name.slice(0, 12), s.x - 16, s.y - s.r - 3);
    }
    shoppers.forEach(function (s) {
      if (s.state === "bathroom") {
        ctx.globalAlpha = 0.9;
        var old = s.color;
        s.color = "hsl(210,55%,70%)";
        drawDot(s);
        s.color = old;
        ctx.globalAlpha = 1;
      } else if (s.state !== "waiting" && s.state !== "done" && s.state !== "at_exit") drawDot(s);
      else if (s.state === "at_exit" || s.state === "done") {
        ctx.globalAlpha = 0.55;
        drawDot(s);
        ctx.globalAlpha = 1;
      }
    });
    if (player) drawDot(player);

    // Chat bubbles
    chatBubbles = chatBubbles.filter(function (b) {
      b.t -= 0.016;
      return b.t > 0;
    });
    activePeople().forEach(function (s) {
      if (!s.bubble || s.bubbleT <= 0) return;
      var text = s.bubble;
      ctx.font = "9px system-ui,sans-serif";
      var tw = ctx.measureText(text).width;
      var bx = s.x - tw / 2 - 4;
      var by = s.y - s.r - 18;
      ctx.fillStyle = "rgba(12,16,14,0.88)";
      ctx.strokeStyle = "rgba(180,220,200,0.45)";
      ctx.lineWidth = 1;
      ctx.fillRect(bx, by - 10, tw + 8, 14);
      ctx.strokeRect(bx, by - 10, tw + 8, 14);
      ctx.fillStyle = "#d8f0e4";
      ctx.fillText(text, bx + 4, by);
    });
  }

  function tick(ts) {
    if (!running) return;
    var dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 0.016;
    lastTs = ts;
    shoppers.forEach(function (s) {
      updateNpc(s, dt);
    });
    updatePlayer(dt);
    draw();
    updateHud();
    // Refresh live carts ~4×/sec
    if (!tick._cartAcc) tick._cartAcc = 0;
    tick._cartAcc += dt;
    if (tick._cartAcc > 0.25) {
      tick._cartAcc = 0;
      renderLiveCarts();
    }
    raf = requestAnimationFrame(tick);
  }

  function updateHud() {
    var set = function (id, t) {
      var el = $(id);
      if (el) el.textContent = t;
    };
    var active = shoppers.filter(function (s) {
      return (
        s.state !== "waiting" &&
        s.state !== "done" &&
        s.state !== "at_exit" &&
        s.state !== "bathroom"
      );
    }).length;
    var done = shoppers.filter(function (s) {
      return s.state === "done" || s.state === "at_exit";
    }).length;
    set("sm-hud-wave", waveActive ? "touring aisles" : "resetting");
    set("sm-hud-active", String(active));
    set("sm-hud-done", done + "/99 at exit");
    set(
      "sm-hud-day",
      "Day " + simDay + (dayClosed ? " · closed" : waveActive ? " · open" : "")
    );
    var bathN = shoppers.filter(function (s) {
      return s.state === "bathroom";
    }).length;
    set("sm-hud-bath", String(bathN));
    set("sm-hud-receipts", String(receipts.length));
    var stocked = shelves.filter(function (s) {
      return s.edition && !s.edition.empty && s.edition.stock > 0;
    }).length;
    set("sm-hud-shelves", stocked + "/" + shelves.length);
    if (player) set("sm-hud-cart", String(player.cart.length));
  }

  function sortedReceipts() {
    var list = receipts.slice();
    list.sort(function (a, b) {
      var ca = a.chars != null ? a.chars : String(a.prompt || "").length;
      var cb = b.chars != null ? b.chars : String(b.prompt || "").length;
      var na = String(a.name || "").toLowerCase();
      var nb = String(b.name || "").toLowerCase();
      if (receiptSort === "chars-asc") return ca - cb || na.localeCompare(nb);
      if (receiptSort === "name-asc") return na.localeCompare(nb) || cb - ca;
      if (receiptSort === "name-desc") return nb.localeCompare(na) || cb - ca;
      if (receiptSort === "aspect-asc") {
        // Portrait → square → landscape (smaller ratio first)
        return (
          aspectSortKey(a.aspect) - aspectSortKey(b.aspect) ||
          na.localeCompare(nb)
        );
      }
      if (receiptSort === "aspect-desc") {
        // Landscape → square → portrait (wider first)
        return (
          aspectSortKey(b.aspect) - aspectSortKey(a.aspect) ||
          na.localeCompare(nb)
        );
      }
      // default: highest character count first
      return cb - ca || na.localeCompare(nb);
    });
    return list;
  }

  function findReceiptById(id) {
    if (!id) return null;
    for (var i = 0; i < receipts.length; i++) {
      if (receipts[i].id === id) return receipts[i];
    }
    return null;
  }

  function renderReceiptDetail() {
    var panel = $("sm-receipt-detail");
    if (!panel) return;
    var rec = findReceiptById(selectedReceiptId);
    if (!rec) {
      panel.innerHTML =
        '<p class="sm-muted">Click a receipt for cart description (generate text), one inventory image with ‹ ›, and a separate moderation flags list — not a second copy of the prompt.</p>';
      return;
    }
    var chars = rec.chars != null ? rec.chars : String(rec.prompt || "").length;
    var pct = Math.round((chars / PROMPT_MAX) * 100);
    var items = rec.items || [];
    if (receiptInvIndex >= items.length) receiptInvIndex = 0;
    if (!rec.aspect) rec.aspect = "16:9";
    var aspectOpts = ASPECT_RATIOS.map(function (a) {
      return (
        '<option value="' +
        a +
        '"' +
        (a === rec.aspect ? " selected" : "") +
        ">" +
        a +
        "</option>"
      );
    }).join("");
    panel.innerHTML =
      "<h4>#" +
      escapeHtml(String(rec.shopperId)) +
      " " +
      escapeHtml(rec.name || "") +
      " · " +
      chars +
      " / " +
      PROMPT_MAX +
      " chars (" +
      pct +
      "%)</h4>" +
      '<div class="sm-char-bar" aria-hidden="true"><i style="width:' +
      Math.min(100, pct) +
      '%"></i></div>' +
      '<p class="sm-muted" style="margin:0.25rem 0">Inventory (images only · ‹ ›)</p>' +
      inventoryCarouselHtml("receipt", items, receiptInvIndex) +
      '<p class="sm-muted" style="margin:0.35rem 0 0.15rem">' +
      items.length +
      " pcs · $" +
      (rec.total != null ? rec.total : 0) +
      " · Day " +
      (rec.day != null ? rec.day : simDay) +
      " · preferred aspect <strong>" +
      escapeHtml(rec.aspect) +
      "</strong></p>" +
      '<label class="sm-sort-label" for="sm-receipt-aspect">Generate aspect ratio (this person)</label>' +
      '<select id="sm-receipt-aspect" class="sm-name-edit" aria-label="Aspect ratio">' +
      aspectOpts +
      "</select>" +
      '<label class="sm-sort-label" for="sm-receipt-prompt-edit">Cart description (editable · used for generate)</label>' +
      '<textarea id="sm-receipt-prompt-edit" class="sm-receipt-prompt-edit" spellcheck="true" aria-label="Edit cart description prompt">' +
      escapeHtml(rec.prompt || "") +
      "</textarea>" +
      '<p class="sm-muted" style="margin:0.4rem 0 0.15rem">Moderation flags (word list only — not the cart description)</p>' +
      '<div id="sm-receipt-mod-preview">' +
      moderationReportHtml(rec.prompt || "") +
      "</div>" +
      '<div class="sm-actions">' +
      '<button type="button" id="sm-receipt-save" class="accent">Save prompt edits</button>' +
      '<button type="button" id="sm-receipt-refresh-mod">Re-scan moderation</button>' +
      "</div>";

    var ta = $("sm-receipt-prompt-edit");
    var prev = $("sm-receipt-mod-preview");
    if (ta && prev) {
      ta.addEventListener("input", function () {
        prev.innerHTML = moderationReportHtml(ta.value);
      });
    }
    var asp = $("sm-receipt-aspect");
    if (asp) {
      asp.addEventListener("change", function () {
        rec.aspect = asp.value || "16:9";
        setStatus(
          "Aspect for #" + rec.shopperId + " " + rec.name + " → " + rec.aspect,
          "ok"
        );
      });
    }
    var saveBtn = $("sm-receipt-save");
    if (saveBtn) {
      saveBtn.addEventListener("click", function () {
        var edit = $("sm-receipt-prompt-edit");
        if (!edit) return;
        var next = String(edit.value || "").slice(0, PROMPT_MAX);
        rec.prompt = next;
        rec.chars = next.length;
        rec.fillPct = Math.round((rec.chars / PROMPT_MAX) * 100);
        if (asp) rec.aspect = asp.value || rec.aspect;
        rec.edited = true;
        setStatus(
          "Saved receipt for #" + rec.shopperId + " " + rec.name + " (" + rec.chars + " chars, " + rec.aspect + ").",
          "ok"
        );
        renderReceipts();
      });
    }
    var rescan = $("sm-receipt-refresh-mod");
    if (rescan && ta && prev) {
      rescan.addEventListener("click", function () {
        prev.innerHTML = moderationReportHtml(ta.value);
        var s2 = scanModeration(ta.value);
        setStatus(
          s2.hits && s2.hits.length
            ? "Flags only: " + s2.hits.length + " hit(s) — not regenerating the full prompt view."
            : "Moderation clean — no flagged words.",
          s2.hits && s2.hits.length ? "err" : "ok"
        );
      });
    }
  }

  function renderReceipts() {
    var ul = $("sm-receipt-list");
    if (!ul) return;
    var sortEl = $("sm-receipt-sort");
    if (sortEl && sortEl.value) receiptSort = sortEl.value;
    if (!receipts.length) {
      ul.innerHTML =
        '<li class="sm-muted">Receipts appear when shoppers reach EXIT (after register). Sorted by character count (highest first) by default.</li>';
      renderReceiptDetail();
      return;
    }
    var list = sortedReceipts().slice(0, 60);
    ul.innerHTML = list
      .map(function (r) {
        var chars = r.chars != null ? r.chars : String(r.prompt || "").length;
        var pct = Math.round((chars / PROMPT_MAX) * 100);
        var high = pct >= 90;
        var sel = r.id === selectedReceiptId;
        var preview = String(r.prompt || "").replace(/\s+/g, " ").slice(0, 140);
        return (
          '<li class="sm-receipt-clickable' +
          (high ? " sm-receipt-high" : "") +
          (sel ? " sm-receipt-selected" : "") +
          '" data-receipt-id="' +
          escapeHtml(r.id) +
          '" role="button" tabindex="0">' +
          '<span class="sm-who">#' +
          r.shopperId +
          " " +
          escapeHtml(r.name) +
          "</span> · Day " +
          (r.day != null ? r.day : simDay) +
          " · " +
          (r.items ? r.items.length : 0) +
          " pcs · $" +
          r.total +
          " · " +
          escapeHtml(r.aspect || "16:9") +
          (r.edited ? " · edited" : "") +
          (r.generatedUrl ? " · gen'd" : "") +
          '<br/><span class="sm-chars-high">' +
          chars +
          " / " +
          PROMPT_MAX +
          " chars</span> · " +
          pct +
          "% fill" +
          '<div class="sm-char-bar" aria-hidden="true"><i style="width:' +
          Math.min(100, pct) +
          '%"></i></div>' +
          '<span class="sm-muted">' +
          (r.items ? r.items.length : 0) +
          " pcs · " +
          escapeHtml(preview) +
          (String(r.prompt || "").length > 140 ? "…" : "") +
          "</span></li>"
        );
      })
      .join("");
    renderReceiptDetail();
  }

  function renderLiveCarts() {
    var ul = $("sm-live-carts");
    if (!ul) return;
    var rows = [];
    shoppers.forEach(function (s) {
      if (s.state === "waiting" || s.state === "done") return;
      var items = s.cart && s.cart.length ? s.cart : s.pendingReceipt ? s.pendingReceipt.items : [];
      var chars =
        s.pendingReceipt && s.pendingReceipt.chars != null
          ? s.pendingReceipt.chars
          : promptLen(s.cart, s);
      var phase =
        s.state === "at_exit"
          ? "at exit"
          : s.state === "exit"
            ? "to exit"
            : s.state === "entry_kiosk"
              ? "entry K" + (s.entryKioskId || "")
              : s.state === "kiosk"
                ? "exit K" + ((s.target && s.target.kioskId) || "")
                : s.state === "checkout"
                  ? "register"
                  : s.state === "enter"
                    ? "to kiosks"
                    : "aisle " +
                      Math.min(AISLE_COUNT, (s.aisleIdx || 0) + 1) +
                      "/" +
                      AISLE_COUNT +
                      (s.aisleOrder && s.aisleOrder[s.aisleIdx || 0] != null
                        ? " (A" + ((s.aisleOrder[s.aisleIdx || 0] || 0) + 1) + ")"
                        : "");
      rows.push({
        id: s.id,
        name: s.name,
        items: items,
        chars: chars,
        phase: phase,
        pending: !!s.pendingReceipt,
      });
    });
    if (player) {
      rows.push({
        id: 100,
        name: player.name,
        items: player.pendingReceipt ? player.pendingReceipt.items : player.cart || [],
        chars: player.pendingReceipt
          ? player.pendingReceipt.chars
          : promptLen(player.cart, player),
        phase: "you",
        pending: !!player.pendingReceipt,
      });
    }
    // Live list: highest char carts first so big prompts stay visible
    rows.sort(function (a, b) {
      return b.chars - a.chars || a.id - b.id;
    });
    if (!rows.length) {
      ul.innerHTML = '<li class="sm-muted">No active carts.</li>';
      return;
    }
    ul.innerHTML = rows
      .slice(0, 50)
      .map(function (r) {
        return (
          "<li><span class=\"sm-who\">#" +
          r.id +
          " " +
          escapeHtml(r.name) +
          "</span> · " +
          escapeHtml(r.phase) +
          (r.pending ? " · pending receipt" : "") +
          "<br/><strong>" +
          r.chars +
          "</strong>/" +
          PROMPT_MAX +
          " chars · " +
          (r.items ? r.items.length : 0) +
          " pcs" +
          thumbsHtml(r.items, 6) +
          '<span class="sm-muted">' +
          escapeHtml(cartDisplay(r.items)) +
          "</span></li>"
        );
      })
      .join("");
  }

  function escapeHtml(s) {
    var d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  }

  function apiUrl(path) {
    if (typeof window.galleryApiUrl === "function") return window.galleryApiUrl(path);
    var base = String(window.SPELLFORGE_API_BASE || "").replace(/\/$/, "");
    return base ? base + path : path;
  }

  /**
   * Exactly one generate job: selected receipt OR your cart.
   * Never batches all receipts / all 99 customers.
   */
  function resolveGenerateSource() {
    var srcEl = $("sm-gen-source");
    var src = srcEl && srcEl.value ? srcEl.value : "selected";
    if (src === "mine") {
      if (!player) return { error: "No player cart." };
      var ta = $("sm-player-prompt");
      var prompt =
        ta && ta.value && ta.value.trim()
          ? ta.value.trim()
          : cartPrompt(player.cart || [], player);
      if (!prompt || !String(prompt).trim()) {
        return { error: "Your cart description is empty — grab art (E) first." };
      }
      var aspectEl = $("sm-player-aspect");
      var aspect =
        (aspectEl && aspectEl.value) ||
        player.preferredAspect ||
        (player.taste && player.taste.preferredAspect) ||
        "16:9";
      player.preferredAspect = aspect;
      return {
        label: "your cart",
        prompt: String(prompt).slice(0, PROMPT_MAX),
        items: player.cart || [],
        aspect: aspect,
        receipt: null,
        shopperId: 100,
      };
    }
    var rec = findReceiptById(selectedReceiptId);
    if (!rec) {
      return {
        error:
          "Select one receipt in the ledger first (or switch source to My cart). This never runs all 99.",
      };
    }
    var p = rec.prompt;
    var edit = $("sm-receipt-prompt-edit");
    if (edit && edit.value) p = edit.value;
    if (!p || !String(p).trim()) {
      return { error: "Selected receipt has no cart description prompt." };
    }
    var aspectPick = $("sm-receipt-aspect");
    if (aspectPick && aspectPick.value) {
      rec.aspect = aspectPick.value;
    }
    return {
      label: "#" + rec.shopperId + " " + (rec.name || "shopper"),
      prompt: String(p).slice(0, PROMPT_MAX),
      items: rec.items || [],
      aspect: rec.aspect || "16:9",
      receipt: rec,
      shopperId: rec.shopperId,
    };
  }

  function delayMs(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function setOrbWorking(on) {
    var orb = $("sm-result-orb");
    if (!orb) return;
    if (on) orb.classList.add("working");
    else orb.classList.remove("working");
  }

  function showGeneratedResult(url, source) {
    if (!url) return;
    lastGenerated = {
      url: url,
      label: (source && source.label) || "generate",
      aspect: (source && source.aspect) || "16:9",
      sourceId: source && source.shopperId,
    };
    var orbImg = $("sm-result-orb-img");
    var orbPh = $("sm-result-orb-ph");
    var orb = $("sm-result-orb");
    if (orbImg) {
      orbImg.src = url;
      orbImg.hidden = false;
    }
    if (orbPh) orbPh.hidden = true;
    if (orb) {
      orb.classList.add("has-image");
      orb.classList.remove("working");
      orb.title =
        "Generated for " +
        lastGenerated.label +
        " · " +
        lastGenerated.aspect +
        " — click to enlarge";
    }
    var prev = $("sm-gen-preview");
    if (prev) {
      prev.src = url;
      prev.classList.add("show");
    }
    if (source && source.receipt) {
      source.receipt.generatedUrl = url;
    }
    if (source && source.shopperId === 100 && player) {
      player.generatedUrl = url;
    }
    setStatus(
      "Image ready for " +
        lastGenerated.label +
        " (" +
        lastGenerated.aspect +
        ") — shown in the left circle; click to enlarge.",
      "ok"
    );
  }

  function openGenLightbox() {
    if (!lastGenerated.url) {
      setStatus("No generated image yet — run Generate image (1 job) first.", "err");
      return;
    }
    var lb = $("sm-gen-lightbox");
    var img = $("sm-gen-lightbox-img");
    var lab = $("sm-gen-lightbox-label");
    if (img) img.src = lastGenerated.url;
    if (lab) {
      lab.textContent =
        lastGenerated.label +
        " · " +
        lastGenerated.aspect +
        " · cart vision still";
    }
    if (lb) lb.hidden = false;
  }

  function closeGenLightbox() {
    var lb = $("sm-gen-lightbox");
    if (lb) lb.hidden = true;
  }

  function absoluteUrl(url) {
    if (!url) return "";
    if (/^(https?:|data:|blob:)/i.test(url)) return url;
    try {
      return new URL(url, window.location.href).href;
    } catch (err) {
      return url;
    }
  }

  function extractImageUrl(payload) {
    if (!payload) return "";
    var img = payload.image || (payload.images && payload.images[0]);
    var raw =
      (img && (img.url || img.download_url || img.uri)) ||
      payload.image_url ||
      payload.output_url ||
      payload.result_url ||
      "";
    return absoluteUrl(raw);
  }

  /** Poll /api/jobs until still is ready (same pattern as Commercial). */
  function pollImageJob(jobId, left, source) {
    if (left == null) left = 90;
    if (left <= 0) {
      return Promise.reject(new Error("Timed out waiting for image job " + jobId));
    }
    return fetch(apiUrl("/api/jobs/" + jobId), { cache: "no-store" })
      .then(function (r) {
        return r.json().then(function (d) {
          return { ok: r.ok, d: d, status: r.status };
        });
      })
      .then(function (res) {
        var job = res.d || {};
        var st = String(job.status || "working").toLowerCase();
        setStatus(
          "Polling image for " +
            ((source && source.label) || "cart") +
            "… " +
            st +
            " (" +
            left +
            ")",
          ""
        );
        if (st === "done" || st === "completed" || st === "success") {
          var url = extractImageUrl(job);
          if (url) return url;
          throw new Error("Job finished but no image URL returned.");
        }
        if (st === "failed" || st === "error" || st === "expired") {
          throw new Error(
            (job.error && (job.error.message || job.error)) || "Image job failed"
          );
        }
        return delayMs(1500).then(function () {
          return pollImageJob(jobId, left - 1, source);
        });
      });
  }

  function generateFromLedger(mode) {
    var source = resolveGenerateSource();
    if (source.error) {
      setStatus(source.error, "err");
      return;
    }
    var prompt = stripCatalogSpeak(source.prompt);
    var aspect = source.aspect || "16:9";
    setOrbWorking(true);
    var ph = $("sm-result-orb-ph");
    if (ph) {
      ph.hidden = false;
      ph.textContent = "…";
    }
    setStatus(
      "Generating " +
        mode +
        " — 1 job for " +
        source.label +
        " @ " +
        aspect +
        " (polling until the still appears).",
      ""
    );
    var jobId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : "sm-" + Date.now() + "-" + Math.floor(Math.random() * 1e6);
    var body = {
      job_id: jobId,
      stasis: prompt.slice(0, 3200),
      prompt:
        "One continuous image from a single art-supermarket cart vision — not a collage of many receipts. Aspect " +
        aspect +
        ". " +
        prompt.slice(0, 1600),
      buzz_words: [
        "single scene",
        "no collage",
        "one cart vision",
        "fused composition",
        "gallery art mood",
        "aspect " + aspect,
      ],
      spells: [],
      aspect_ratio: aspect,
      mag_fresh: true,
      spell_cast: true,
      fresh_variation: true,
    };
    fetch(apiUrl("/api/generate-stasis-vision"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then(function (r) {
        return r.json().then(function (d) {
          return { ok: r.ok, d: d, status: r.status };
        });
      })
      .then(function (res) {
        var d = res.d || {};
        // 202 accepted or missing image → poll job
        if (res.status === 202 || (!extractImageUrl(d) && (d.job_id || jobId))) {
          var jid = d.job_id || jobId;
          setStatus("Image job queued for " + source.label + " — waiting for result…", "");
          return pollImageJob(jid, 90, source);
        }
        if (!res.ok) throw new Error((d && d.error) || "Generate failed");
        var url = extractImageUrl(d);
        if (!url && d.job_id) return pollImageJob(d.job_id, 90, source);
        if (!url) throw new Error("No image URL");
        return url;
      })
      .then(function (url) {
        showGeneratedResult(url, source);
        if (mode !== "video") return;
        setStatus("Still ready — starting 1 video job from that frame…", "");
        return fetch(apiUrl("/api/animate-cast"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            wait: false,
            wait_for_result: false,
            stasis: body.stasis.slice(0, 2000),
            prompt:
              "IMAGE-TO-LIFE motion of one fused cart vision, soft light, fixed camera loop — single subject scene.",
            duration: 10,
            resolution: "720p",
            aspect_ratio: aspect,
            image_url: url,
            reference_image: url,
          }),
        }).then(function (r) {
          return r.json().then(function (d) {
            if (!r.ok) throw new Error((d && d.error) || "Video failed");
            setStatus(
              "Video job started" +
                (d.job_id ? " " + d.job_id : "") +
                " — still is on the left orb for " +
                source.label +
                ".",
              "ok"
            );
          });
        });
      })
      .catch(function (err) {
        setOrbWorking(false);
        var ph2 = $("sm-result-orb-ph");
        if (ph2 && !lastGenerated.url) {
          ph2.hidden = false;
          ph2.textContent = "gen";
        }
        setStatus((err && err.message) || "Generate failed — is the gallery server running?", "err");
      });
  }

  function openDeliberateModal() {
    openInspectModal(selectedShelf || nearShelf);
  }

  function bind() {
    canvas = $("sm-canvas");
    if (!canvas) return;
    ctx = canvas.getContext("2d");
    canvas.width = W;
    canvas.height = H;
    canvas.addEventListener("click", onCanvasClick);

    window.addEventListener("keydown", function (e) {
      if (document.body.getAttribute("data-active-tab") !== "supermarket") return;
      var k = e.key.toLowerCase();
      if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT")) {
        return;
      }
      // Panel of 5: ←/→ cols, ↑/↓ rows (always panel, never walk)
      if (k === "arrowleft") {
        e.preventDefault();
        cycleVicinity(-1);
        return;
      }
      if (k === "arrowright") {
        e.preventDefault();
        cycleVicinity(1);
        return;
      }
      if (k === "arrowup") {
        e.preventDefault();
        cycleVicinityRow(-1);
        return;
      }
      if (k === "arrowdown") {
        e.preventDefault();
        cycleVicinityRow(1);
        return;
      }
      // WASD: when near a face or inspect is open, also drive the 5-cell panel
      // (A/D = cols, W/S = rows). Inspect open = panel only (no walk).
      if (k === "a" || k === "d" || k === "w" || k === "s") {
        var panelOpen = isInspectModalOpen();
        var nearPanel = canNavigateVicinityPanel();
        if (panelOpen || nearPanel) {
          e.preventDefault();
          if (k === "a") cycleVicinity(-1);
          else if (k === "d") cycleVicinity(1);
          else if (k === "w") cycleVicinityRow(-1);
          else if (k === "s") cycleVicinityRow(1);
          // While inspecting, do not hold walk keys
          if (panelOpen) return;
          // While walking near a face: still allow held WASD to move after the step
        }
      }
      if (["w", "a", "s", "d", "e", " ", "r", "c"].indexOf(k) >= 0) {
        if (isInspectModalOpen() && (k === "w" || k === "a" || k === "s" || k === "d")) {
          return;
        }
        keys[k] = true;
        if (k === "e") {
          e.preventDefault();
          // Grab currently selected cell among the 5, not just nearest
          if (selectedShelf && nearShelf) {
            var best = selectedShelf;
            if (best.edition && !best.edition.empty && best.edition.stock > 0) {
              var next = cartPrompt(player.cart.concat([best.edition]), player);
              if (next.length > PROMPT_MAX) {
                setStatus("Prompt would exceed " + PROMPT_MAX + " — checkout at REGISTERS.", "err");
              } else {
                tryTakeFromShelf(player, best);
                var ta = $("sm-player-prompt");
                if (ta) {
                  ta.dataset.locked = "";
                  ta.dataset.cartSig = "";
                }
                syncPlayerPrompt();
                setStatus(
                  "Picked 1× " + (best.edition.title || "art") + " · stock left " + best.edition.stock,
                  "ok"
                );
              }
              return;
            }
          }
          playerPickupNearest();
        }
        if (k === " ") {
          e.preventDefault();
          playerCheckout();
        }
        if (k === "r") {
          e.preventDefault();
          restockNearestOrSelected(true);
        }
        if (k === "c") {
          e.preventDefault();
          openInspectModal(nearShelf || selectedShelf);
        }
      }
    });
    window.addEventListener("keyup", function (e) {
      keys[e.key.toLowerCase()] = false;
    });

    $("sm-start-wave") &&
      $("sm-start-wave").addEventListener("click", function () {
        startWave();
      });
    function onStartNextDay() {
      beginNextDay();
    }
    $("sm-start-next-day") && $("sm-start-next-day").addEventListener("click", onStartNextDay);
    $("sm-start-next-day-top") &&
      $("sm-start-next-day-top").addEventListener("click", onStartNextDay);
    $("sm-day-select") &&
      $("sm-day-select").addEventListener("change", function () {
        var v = parseInt($("sm-day-select").value, 10);
        if (!isNaN(v)) {
          selectedDayView = v;
          renderDayLog();
        }
      });
    $("sm-restock-random") &&
      $("sm-restock-random").addEventListener("click", function () {
        if (!selectedShelf) {
          setStatus("Select a shelf on the floor first.", "err");
          return;
        }
        restockShelf(selectedShelf, null);
      });
    $("sm-restock-pick") &&
      $("sm-restock-pick").addEventListener("click", openDeliberateModal);
    $("sm-restock-all-empty") &&
      $("sm-restock-all-empty").addEventListener("click", function () {
        var n = 0;
        shelves.forEach(function (sh) {
          if (sh.edition.empty || sh.edition.stock <= 0) {
            restockShelf(sh, null);
            n++;
          }
        });
        setStatus("Random-restocked " + n + " empty shelves.", "ok");
      });
    $("sm-name-select") && $("sm-name-select").addEventListener("change", onNameSelectChange);
    $("sm-name-apply") && $("sm-name-apply").addEventListener("click", applyNameEdit);
    $("sm-player-grab") && $("sm-player-grab").addEventListener("click", playerPickupNearest);
    $("sm-player-checkout") && $("sm-player-checkout").addEventListener("click", playerCheckout);
    $("sm-gen-image") &&
      $("sm-gen-image").addEventListener("click", function () {
        generateFromLedger("image");
      });
    $("sm-gen-video") &&
      $("sm-gen-video").addEventListener("click", function () {
        generateFromLedger("video");
      });
    $("sm-result-orb") &&
      $("sm-result-orb").addEventListener("click", function () {
        openGenLightbox();
      });
    $("sm-gen-lightbox-close") &&
      $("sm-gen-lightbox-close").addEventListener("click", closeGenLightbox);
    $("sm-gen-lightbox") &&
      $("sm-gen-lightbox").addEventListener("click", function (e) {
        if (e.target && e.target.id === "sm-gen-lightbox") closeGenLightbox();
      });
    $("sm-player-aspect") &&
      $("sm-player-aspect").addEventListener("change", function () {
        if (player) player.preferredAspect = $("sm-player-aspect").value || "16:9";
      });
    // Inventory carousels (day table + receipt detail): one image, ‹ › only
    document.addEventListener("click", function (e) {
      var btn = e.target && e.target.closest ? e.target.closest("[data-inv-dir]") : null;
      if (!btn) return;
      var key = btn.getAttribute("data-inv-key");
      var dir = parseInt(btn.getAttribute("data-inv-dir"), 10) || 0;
      if (!key || !dir) return;
      e.preventDefault();
      e.stopPropagation();
      stepInventoryCarousel(key, dir);
    });
    $("sm-modal-close") &&
      $("sm-modal-close").addEventListener("click", function () {
        $("sm-modal").hidden = true;
      });
    var sortEl = $("sm-receipt-sort");
    if (sortEl) {
      sortEl.value = receiptSort;
      sortEl.addEventListener("change", function () {
        receiptSort = sortEl.value || "chars-desc";
        renderReceipts();
      });
    }
    var recList = $("sm-receipt-list");
    if (recList) {
      recList.addEventListener("click", function (e) {
        var li = e.target && e.target.closest ? e.target.closest("[data-receipt-id]") : null;
        if (!li) return;
        selectedReceiptId = li.getAttribute("data-receipt-id");
        receiptInvIndex = 0;
        renderReceipts();
      });
      recList.addEventListener("keydown", function (e) {
        if (e.key !== "Enter" && e.key !== " ") return;
        var li = e.target && e.target.closest ? e.target.closest("[data-receipt-id]") : null;
        if (!li) return;
        e.preventDefault();
        selectedReceiptId = li.getAttribute("data-receipt-id");
        receiptInvIndex = 0;
        renderReceipts();
      });
    }
    var ta = $("sm-player-prompt");
    if (ta) {
      ta.addEventListener("input", function () {
        ta.dataset.locked = "1";
        syncPlayerPrompt();
      });
    }

    window.addEventListener("tab-changed", function (e) {
      if (e.detail && e.detail.tab === "supermarket") {
        startLoop();
      } else {
        stopLoop();
      }
    });
  }

  function startLoop() {
    if (running) return;
    running = true;
    lastTs = 0;
    raf = requestAnimationFrame(tick);
  }

  function stopLoop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  function init() {
    if (!$("panel-supermarket")) return;
    buildZones();
    bind();
    loadPrices()
      .then(loadCatalog)
      .then(function () {
        buildShelves();
        buildShoppers();
        draw();
        updateHud();
        loadDayLogs();
        if (player && $("sm-player-aspect")) {
          $("sm-player-aspect").value = player.preferredAspect || "16:9";
        }
        renderReceipts();
        renderLiveCarts();
        renderDayLog();
        if (dayClosed) {
          // Resume after a closed day — do not auto-open next day or wipe the table
          waveActive = false;
          shoppers.forEach(function (s) {
            s.state = "at_exit";
            s.target = null;
          });
          selectedDayView = selectedDayView || simDay;
          renderDayLog();
          setStatus(
            "Day " +
              simDay +
              " is closed and archived. Review the day log table (Name · Inventory · Prompt), then press Start next day when ready.",
            "ok"
          );
        } else {
          // First open / mid-day: auto-start only if no closed day waiting
          startWave();
          setStatus(
            "Day " +
              simDay +
              " open. When all 99 exit, the day is archived to the table — next day is manual (Start next day).",
            "ok"
          );
        }
        updateHud();
        if (document.body.getAttribute("data-active-tab") === "supermarket") startLoop();
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.Supermarket = {
    startWave: startWave,
    beginNextDay: beginNextDay,
    restockRandom: function () {
      if (selectedShelf) restockShelf(selectedShelf, null);
    },
  };
})();
