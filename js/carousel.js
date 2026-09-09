/**
 * Carousel — Logan's Run city-shelter on Fallout Shelter bones.
 * Banker 100 as citizens. 30-year Carousel = tier up. Time controller
 * (pause / faster-than-realtime / reverse) against an atomic UTC break.
 */
(function () {
  "use strict";

  var YEAR_MS = 31557600000; // 365.25d
  var DAY_MS = 86400000;
  var HOUR_MS = 3600000;
  var STORAGE = "gallery.carousel.clock.v1";
  var MAX_FEED = 24;
  var KID_CAP_PER_HOME = 2;

  var canvas, ctx;
  var W = 1180;
  var H = 680;
  var running = false;
  var raf = 0;
  var lastTs = 0;
  var roster = [];
  var selectedId = null;
  var homePage = 0;
  var HOMES_PER_PAGE = 5;
  var hoverId = null;
  var feed = [];
  var lastCarouselSeen = {};
  var lastKidSeen = {};
  var artPool = [];
  var imgCache = {};
  var bgUrls = [];
  var anim = {};
  var realNow = 0;
  var realDt = 0.016;

  var clock = {
    sealed: false,
    atomicOffsetMs: 0,
    breakUtc: null,
    breakGameMs: 0,
    playInstance: "",
    segments: [],
    log: [],
  };

  var JOBS = [
    { id: "bank", label: "Private Bank", zone: "labor" },
    { id: "hydro", label: "Hydroponics", zone: "labor" },
    { id: "circuit", label: "Circuit", zone: "labor" },
    { id: "nursery", label: "Nursery", zone: "labor" },
    { id: "sandman", label: "Sandman", zone: "labor" },
    { id: "artist", label: "Studio", zone: "labor" },
    { id: "market", label: "Market runner", zone: "concourse" },
    { id: "carousel", label: "Carousel usher", zone: "carousel" },
  ];

  var GIRL = [
    "Aurelia", "Briar", "Cleo", "Dahlia", "Elodie", "Fern", "Gemma", "Hadley",
    "Iris", "Juno", "Kira", "Lila", "Maren", "Nia", "Opal", "Pearl",
  ];
  var BOY = [
    "Arlo", "Bram", "Cedric", "Dorian", "Ellis", "Flint", "Gideon", "Harlan",
    "Idris", "Jasper", "Kieran", "Luca", "Magnus", "Nash", "Otto", "Penn",
  ];

  function $(id) {
    return document.getElementById(id);
  }

  function esc(s) {
    var d = document.createElement("div");
    d.textContent = String(s == null ? "" : s);
    return d.innerHTML;
  }

  function money(n) {
    return (
      "$" +
      (Number(n) || 0).toLocaleString(undefined, {
        maximumFractionDigits: 0,
      })
    );
  }

  function hash32(s) {
    var h = 2166136261;
    s = String(s);
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function nowLocal() {
    return Date.now();
  }

  function nowAtomic() {
    return nowLocal() + (clock.atomicOffsetMs || 0);
  }

  function speedNow() {
    if (!clock.segments.length) return 0;
    return clock.segments[clock.segments.length - 1].speed;
  }

  function gameNowMs() {
    if (!clock.sealed || !clock.segments.length) return clock.breakGameMs || 0;
    var s = clock.segments[clock.segments.length - 1];
    return s.gameMs + (nowAtomic() - s.tUtc) * s.speed;
  }

  function pushSegment(speed, note) {
    var g = gameNowMs();
    var t = nowAtomic();
    clock.segments.push({ tUtc: t, gameMs: g, speed: speed });
    if (clock.segments.length > 80) clock.segments = clock.segments.slice(-80);
    clock.log.push({
      utc: new Date(t).toISOString(),
      gameMs: g,
      speed: speed,
      note: note || "",
    });
    if (clock.log.length > 40) clock.log = clock.log.slice(-40);
    persistClock();
  }

  var MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];

  function pad2(n) {
    n = Math.floor(Math.abs(Number(n) || 0));
    return n < 10 ? "0" + n : String(n);
  }

  function partsFromDate(d) {
    return {
      month: MONTHS[d.getUTCMonth()] || "—",
      day: String(d.getUTCDate()),
      year: String(d.getUTCFullYear()),
      h: pad2(d.getUTCHours()),
      m: pad2(d.getUTCMinutes()),
      s: pad2(d.getUTCSeconds()),
    };
  }

  function cityParts(gameMs) {
    // City epoch: 1 January 2274, 00:00:00 — calendar month / day / year + h:m:s
    var t = Date.UTC(2274, 0, 1, 0, 0, 0) + gameMs;
    return partsFromDate(new Date(t));
  }

  function utcParts(ms) {
    return partsFromDate(new Date(ms));
  }

  function fillCal(prefix, parts) {
    var map = { month: "month", day: "day", year: "year", h: "h", m: "m", s: "s" };
    Object.keys(map).forEach(function (k) {
      var el = $(prefix + map[k]);
      if (el) el.textContent = parts[k];
    });
  }

  function fmtUtc(ms) {
    var p = utcParts(ms);
    return p.month + " " + p.day + ", " + p.year + "  " + p.h + ":" + p.m + ":" + p.s;
  }

  function hourOfDay(ms) {
    var h = Math.floor((ms % DAY_MS) / HOUR_MS);
    if (h < 0) h += 24;
    return h;
  }

  function syncAtomicClock() {
    var urls = [
      "https://worldtimeapi.org/api/timezone/Etc/UTC",
      "https://timeapi.io/api/Time/current/zone?timeZone=UTC",
    ];
    var tryOne = function (i) {
      if (i >= urls.length) {
        clock.atomicOffsetMs = 0;
        return Promise.resolve();
      }
      return fetch(urls[i], { cache: "no-store" })
        .then(function (r) {
          return r.ok ? r.json() : Promise.reject();
        })
        .then(function (d) {
          var iso = d.utc_datetime || d.dateTime || d.utc_offset;
          var parsed = Date.parse(d.utc_datetime || d.dateTime || "");
          if (!isFinite(parsed)) throw new Error("no time");
          clock.atomicOffsetMs = parsed - nowLocal();
        })
        .catch(function () {
          return tryOne(i + 1);
        });
    };
    return tryOne(0);
  }

  function persistClock() {
    var payload = {
      clock: {
        sealed: clock.sealed,
        atomicOffsetMs: clock.atomicOffsetMs,
        breakUtc: clock.breakUtc,
        breakGameMs: clock.breakGameMs,
        playInstance: clock.playInstance,
        segments: clock.segments,
        log: clock.log,
      },
    };
    try {
      localStorage.setItem(STORAGE, JSON.stringify(payload));
    } catch (e) {}
    fetch("/api/carousel/time", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(function () {});
  }

  function loadClock() {
    var local = null;
    try {
      local = JSON.parse(localStorage.getItem(STORAGE) || "null");
    } catch (e) {}
    return fetch("/api/carousel/time?t=" + Date.now(), { cache: "no-store" })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (remote) {
        var src =
          remote && remote.clock && remote.sealed
            ? remote.clock
            : local && local.clock
              ? local.clock
              : null;
        if (src) {
          clock.sealed = !!src.sealed;
          clock.breakUtc = src.breakUtc;
          clock.breakGameMs = src.breakGameMs || 0;
          clock.playInstance = src.playInstance || "";
          clock.segments = Array.isArray(src.segments) ? src.segments : [];
          clock.log = Array.isArray(src.log) ? src.log : [];
        }
      })
      .catch(function () {});
  }

  function sealBreak() {
    var t = nowAtomic();
    clock.sealed = true;
    clock.breakUtc = t;
    clock.breakGameMs = 0;
    clock.playInstance =
      "break-" + t + "-" + Math.floor(Math.random() * 1e6);
    clock.segments = [{ tUtc: t, gameMs: 0, speed: 1 }];
    clock.log = [
      {
        utc: new Date(t).toISOString(),
        gameMs: 0,
        speed: 1,
        note: "Time break sealed to atomic UTC. City epoch 0.",
      },
    ];
    persistClock();
    pushFeed("Time break sealed. The City clock is live at 1× (1000ms = 1s).");
    renderHud();
  }

  function setSpeed(sp) {
    if (!clock.sealed) sealBreak();
    pushSegment(sp, sp === 0 ? "pause" : sp < 0 ? "reverse ×" + Math.abs(sp) : "forward ×" + sp);
    renderHud();
    markSpeedButtons();
  }

  function markSpeedButtons() {
    var sp = speedNow();
    document.querySelectorAll("[data-lr-speed]").forEach(function (btn) {
      var v = Number(btn.getAttribute("data-lr-speed"));
      btn.classList.toggle("lr-on", v === sp);
    });
  }

  function loadRoster() {
    return fetch("/api/banker/roster?t=" + Date.now(), { cache: "no-store" })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (data) {
        roster = (data && (data.roster || data.people)) || [];
        return roster;
      })
      .catch(function () {
        roster = [];
        return roster;
      });
  }

  function preloadImg(url) {
    if (!url) return null;
    if (imgCache[url]) return imgCache[url];
    var im = new Image();
    im.decoding = "async";
    im.src = url;
    imgCache[url] = im;
    return im;
  }

  function loadArt() {
    var paints = [];
    for (var n = 1; n <= 80; n++) {
      paints.push(
        window.getPaintingUrl ? window.getPaintingUrl(n) : "paintings/" + n + ".jpg"
      );
    }
    return Promise.all([
      fetch("/api/dream-pool?t=" + Date.now(), { cache: "default" })
        .then(function (r) {
          return r.ok ? r.json() : null;
        })
        .catch(function () {
          return null;
        }),
      fetch("/api/gallery-assets?collection=characters&t=" + Date.now(), { cache: "default" })
        .then(function (r) {
          return r.ok ? r.json() : null;
        })
        .catch(function () {
          return null;
        }),
    ]).then(function (pair) {
      var urls = [];
      var pool = pair[0] || {};
      var nums = pool.generated_nums || [];
      var files = pool.generated_files || {};
      for (var i = 0; i < nums.length; i++) {
        var num = nums[i];
        var name = files[String(num)] || num + ".jpg";
        urls.push("/generated/" + name);
      }
      var chars = (pair[1] && pair[1].items) || [];
      chars.forEach(function (it) {
        if (it && it.url) urls.push(it.url);
      });
      artPool = urls.concat(paints);
      if (!artPool.length) artPool = paints;
      bgUrls = artPool.slice();
      for (var k = bgUrls.length - 1; k > 0; k--) {
        var j = Math.floor(Math.random() * (k + 1));
        var tmp = bgUrls[k];
        bgUrls[k] = bgUrls[j];
        bgUrls[j] = tmp;
      }
      if (bgUrls[0]) preloadImg(bgUrls[0]);
      if (bgUrls[1]) preloadImg(bgUrls[1]);
      return artPool;
    });
  }

  function portraitFor(p) {
    if (!artPool.length) return null;
    var i = hash32("face:" + p.id + ":" + (p.name || "")) % artPool.length;
    return preloadImg(artPool[i]);
  }

  function imgReady(im) {
    return im && im.complete && im.naturalWidth > 8;
  }

  function drawCover(img, dx, dy, dw, dh, zoom, ox, oy) {
    if (!imgReady(img) || dw < 2 || dh < 2) return false;
    zoom = zoom || 1.05;
    var iw = img.naturalWidth;
    var ih = img.naturalHeight;
    var scale = Math.max(dw / iw, dh / ih) * zoom;
    var sw = dw / scale;
    var sh = dh / scale;
    var sx = (iw - sw) * Math.max(0, Math.min(1, 0.5 + (ox || 0)));
    var sy = (ih - sh) * Math.max(0, Math.min(1, 0.5 + (oy || 0)));
    ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
    return true;
  }

  function founders() {
    return roster.map(function (p) {
      var h = hash32(p.id + ":" + (p.full_name || ""));
      var startAge = 18 + (h % 10); // 18–27
      var birth = -startAge * YEAR_MS;
      var job = JOBS[p.id % JOBS.length];
      var home = 0;
      if (p.id >= 1 && p.id <= 49) home = p.id - 1;
      else if (p.id >= 50 && p.id <= 99) home = p.id - 50;
      else home = 49; // Logan with Zora in HAB 50
      return {
        id: p.id,
        first: p.first,
        last: p.last,
        name: p.full_name,
        gender: p.gender,
        isPlayer: !!p.is_player,
        partnerId: p.partner_id,
        partnerName: p.partner_name,
        motherId: null,
        fatherId: null,
        blood: [p.id],
        home: home,
        job: job,
        possession: p.possession_usd || 0,
        last4: "",
        birthGameMs: birth,
        gen: 0,
      };
    });
  }

  function related(a, b) {
    if (!a || !b) return true;
    if (a.id === b.id) return true;
    var sa = {};
    (a.blood || []).forEach(function (x) {
      sa[x] = 1;
    });
    for (var i = 0; i < (b.blood || []).length; i++) {
      if (sa[b.blood[i]]) return true;
    }
    if (a.motherId && (a.motherId === b.id || a.motherId === b.motherId || a.motherId === b.fatherId))
      return true;
    if (a.fatherId && (a.fatherId === b.id || a.fatherId === b.motherId || a.fatherId === b.fatherId))
      return true;
    return false;
  }

  function plannedKids(adults, homes) {
    var kids = [];
    var usedFirst = {};
    adults.forEach(function (p) {
      usedFirst[String(p.first).toLowerCase()] = 1;
    });
    homes.forEach(function (home) {
      var a = adults.filter(function (p) {
        return p.home === home && !p.motherId;
      });
      if (a.length < 2) return;
      var f = a.filter(function (p) {
        return p.gender === "female";
      })[0];
      var m = a.filter(function (p) {
        return p.gender === "male";
      })[0];
      if (!f || !m || related(f, m)) return;
      var hid = Math.min(f.id, m.id);
      for (var k = 0; k < KID_CAP_PER_HOME; k++) {
        var seed = hash32(hid + ":kid:" + k);
        var birthOff = (1.6 + k * 2.4 + (seed % 80) / 100) * YEAR_MS;
        var girl = seed % 2 === 0;
        var pool = girl ? GIRL : BOY;
        var first = pool[seed % pool.length];
        var n = 0;
        while (usedFirst[first.toLowerCase()] && n < pool.length) {
          first = pool[(seed + n + 1) % pool.length];
          n++;
        }
        usedFirst[first.toLowerCase()] = 1;
        var last =
          (m.last || "City") + (f.last && f.last !== m.last ? "-" + f.last.split("-")[0] : "");
        if (last.length > 22) last = m.last || "City";
        var id = 1000 + hid * 10 + k;
        kids.push({
          id: id,
          first: first,
          last: last,
          name: first + " " + last,
          gender: girl ? "female" : "male",
          isPlayer: false,
          partnerId: null,
          partnerName: "",
          motherId: f.id,
          fatherId: m.id,
          blood: (f.blood || [f.id]).concat(m.blood || [m.id]).concat([id]),
          home: f.home,
          job: JOBS[(id + 3) % JOBS.length],
          possession: Math.round(((f.possession || 0) + (m.possession || 0)) * 0.08),
          birthGameMs: birthOff,
          gen: 1,
        });
      }
    });
    return kids;
  }

  function pairGrownKids(people, now) {
    var grown = people.filter(function (p) {
      return p.gen === 1 && lifeAge(p, now) >= 18 && lifeAge(p, now) < 30 && !p.partnerId;
    });
    var women = grown.filter(function (p) {
      return p.gender === "female";
    });
    var men = grown.filter(function (p) {
      return p.gender === "male";
    });
    women.sort(function (a, b) {
      return a.id - b.id;
    });
    men.sort(function (a, b) {
      return a.id - b.id;
    });
    var used = {};
    women.forEach(function (w) {
      if (used[w.id]) return;
      for (var i = 0; i < men.length; i++) {
        var m = men[i];
        if (used[m.id]) continue;
        if (related(w, m)) continue;
        if (w.home === m.home) continue;
        w.partnerId = m.id;
        w.partnerName = m.name;
        m.partnerId = w.id;
        m.partnerName = w.name;
        used[w.id] = 1;
        used[m.id] = 1;
        break;
      }
    });
  }

  function lifeAge(p, now) {
    var years = (now - p.birthGameMs) / YEAR_MS;
    return years;
  }

  function ageInLife(p, now) {
    var y = lifeAge(p, now);
    if (y < 0) return y;
    return y - Math.floor(y / 30) * 30;
  }

  function tierOf(p, now) {
    var y = lifeAge(p, now);
    if (y < 0) return 0;
    return 1 + Math.floor(y / 30);
  }

  function crystalColor(ageLife) {
    if (ageLife < 0) return "#667";
    if (ageLife < 8) return "#e8f0ff";
    if (ageLife < 16) return "#8cffb4";
    if (ageLife < 24) return "#ffe066";
    if (ageLife < 29) return "#ff8a4a";
    return "#ff3b6b";
  }

  function allPeople(now) {
    var adults = founders();
    var homes = [];
    for (var i = 0; i < 50; i++) homes.push(i);
    var kids = plannedKids(adults, homes);
    var born = kids.filter(function (k) {
      return now >= k.birthGameMs && lifeAge(k, now) >= 0;
    });
    var people = adults.concat(born);
    pairGrownKids(people, now);
    return people;
  }

  function scheduleZone(p, now) {
    var hour = hourOfDay(now);
    var age = ageInLife(p, now);
    if (age < 5) return "home";
    if (age < 16) {
      if (hour >= 8 && hour < 16) return "nursery";
      return "home";
    }
    if (age >= 29.15) return "carousel";
    if (hour >= 8 && hour < 17) return p.job && p.job.id === "market" ? "market" : "work";
    if (hour >= 17 && hour < 20) return "market";
    return "home";
  }

  function workIndex(jobId) {
    var map = { bank: 0, hydro: 1, circuit: 2, nursery: 3, sandman: 3, artist: 1, carousel: 0, market: 0 };
    return map[jobId] != null ? map[jobId] : 0;
  }

  function roomRect(kind, homeIndex) {
    if (kind === "carousel") return { x: 250, y: 36, w: 680, h: 118, label: "CAROUSEL CHAMBER" };
    if (kind === "work") {
      var slots = [
        { x: 20, y: 176, w: 275, h: 128, label: "PRIVATE BANK", sub: "debit / credit lines" },
        { x: 308, y: 176, w: 275, h: 128, label: "HYDROPONICS", sub: "food & air" },
        { x: 596, y: 176, w: 275, h: 128, label: "CIRCUIT", sub: "power & clocks" },
        { x: 884, y: 176, w: 276, h: 128, label: "NURSERY", sub: "kids + sandmen" },
      ];
      return slots[homeIndex % 4];
    }
    if (kind === "nursery") return roomRect("work", 3);
    if (kind === "market") {
      return { x: 20, y: 518, w: 1140, h: 142, label: "ART SUPERMARKET", sub: "click to enter the real supermarket" };
    }
    var page = homePage || 0;
    var local = homeIndex - page * HOMES_PER_PAGE;
    return {
      x: 20 + local * 228,
      y: 328,
      w: 216,
      h: 164,
      label: "HAB " + (homeIndex + 1),
      sub: "residence",
    };
  }

  function slotInRoom(rect, index, count) {
    var cols = Math.max(3, Math.ceil(Math.sqrt(Math.max(1, count))));
    var col = index % cols;
    var row = Math.floor(index / cols);
    var padX = 18;
    var padTop = 44;
    var usableW = rect.w - padX * 2;
    var usableH = rect.h - padTop - 16;
    var cw = usableW / cols;
    var rh = Math.max(22, usableH / Math.max(1, Math.ceil(count / cols)));
    return {
      x: rect.x + padX + col * cw + cw * 0.5,
      y: rect.y + padTop + row * rh + 18,
    };
  }

  function personTarget(p, now, people) {
    var z = scheduleZone(p, now);
    var job = p.job || JOBS[0];
    var nearCarousel = ageInLife(p, now) >= 29.15 && ageInLife(p, now) < 30;
    if (z === "carousel" || nearCarousel) {
      var c = roomRect("carousel");
      var riders = (people || []).filter(function (q) {
        return ageInLife(q, now) >= 29.15 && ageInLife(q, now) < 30;
      });
      var idx = Math.max(0, riders.indexOf(p));
      var ang = (idx / Math.max(1, riders.length)) * Math.PI * 2 + now / 400;
      return {
        x: c.x + c.w * 0.5 + Math.cos(ang) * 78,
        y: c.y + c.h * 0.58 + Math.sin(ang) * 22,
        z: "carousel",
      };
    }
    function crowd(kind, hi, pred) {
      var rect = roomRect(kind, hi);
      var group = (people || []).filter(pred);
      var idx = Math.max(0, group.indexOf(p));
      var pt = slotInRoom(rect, idx, Math.max(1, group.length));
      return { x: pt.x, y: pt.y, z: kind };
    }
    if (z === "market") {
      return crowd("market", 0, function (q) {
        return scheduleZone(q, now) === "market";
      });
    }
    if (z === "nursery") {
      return crowd("work", 3, function (q) {
        return scheduleZone(q, now) === "nursery" || (q.job && q.job.id === "nursery");
      });
    }
    if (z === "work") {
      var wi = workIndex(job.id);
      return crowd("work", wi, function (q) {
        if (scheduleZone(q, now) !== "work") return false;
        return workIndex((q.job || JOBS[0]).id) === wi;
      });
    }
    var vis0 = homePage * HOMES_PER_PAGE;
    var vis1 = vis0 + HOMES_PER_PAGE;
    if ((p.home || 0) < vis0 || (p.home || 0) >= vis1) {
      // off-page home: stand in the elevator strip
      return { x: 14, y: 400 + ((p.id * 13) % 90), z: "home" };
    }
    return crowd("home", p.home || 0, function (q) {
      return scheduleZone(q, now) === "home" && q.home === p.home;
    });
  }

  function pushFeed(msg) {
    feed.unshift({ t: gameNowMs(), msg: msg });
    if (feed.length > MAX_FEED) feed.pop();
    renderFeed();
  }

  function detectEvents(people, now) {
    people.forEach(function (p) {
      var age = ageInLife(p, now);
      var tier = tierOf(p, now);
      var prev = lastCarouselSeen[p.id] || 0;
      if (tier > prev) {
        lastCarouselSeen[p.id] = tier;
        if (tier > 1) {
          pushFeed(
            p.name + " rides Carousel — tier " + tier + " (lifeclock renewed, not ended)."
          );
        }
      }
      if (p.gen === 1) {
        var seen = lastKidSeen[p.id];
        if (!seen && now >= p.birthGameMs && now < p.birthGameMs + YEAR_MS * 0.05) {
          lastKidSeen[p.id] = true;
          pushFeed("Birth in HAB " + ((p.home || 0) + 1) + ": " + p.name + " (bloodlines checked).");
        }
      }
    });
  }

  function drawVault(people, now) {
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    var hour = hourOfDay(now);
    var night = hour < 6 || hour >= 20;
    var sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, night ? "#120818" : "#2a1038");
    sky.addColorStop(0.22, night ? "#0c0814" : "#1a1028");
    sky.addColorStop(1, "#08060e");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // Generated stills as 3s Ken Burns slideshow through the full pool
    var t = realNow / 1000;
    if (bgUrls.length) {
      var slideMs = 3000;
      var tick = Math.floor(realNow / slideMs);
      var local = (realNow % slideMs) / slideMs;
      var ken = local * local * (3 - 2 * local);
      var idx = tick % bgUrls.length;
      var nxt = (idx + 1) % bgUrls.length;
      preloadImg(bgUrls[idx]);
      preloadImg(bgUrls[nxt]);
      var ox = Math.sin(idx * 1.7) * 0.1 * (1 - ken) + Math.cos(idx) * 0.08 * ken;
      var oy = Math.cos(idx * 1.3) * 0.08 * (1 - ken);
      drawCover(preloadImg(bgUrls[idx]), 0, 0, W, H, 1.08 + ken * 0.12, ox, oy);
      if (local > 0.86) {
        ctx.globalAlpha = (local - 0.86) / 0.14;
        drawCover(preloadImg(bgUrls[nxt]), 0, 0, W, H, 1.08, 0, 0);
        ctx.globalAlpha = 1;
      }
    }
    ctx.fillStyle = night ? "rgba(8,4,16,0.42)" : "rgba(18,8,28,0.28)";
    ctx.fillRect(0, 0, W, H);

    function rr(x, y, w, h, r) {
      r = Math.min(r || 8, w / 2, h / 2);
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    function floorBand(y, h, title, tint) {
      ctx.fillStyle = tint;
      ctx.fillRect(0, y, W, h);
      ctx.fillStyle = "rgba(255,220,255,0.12)";
      ctx.fillRect(0, y, W, 22);
      ctx.fillStyle = "#f2d8ff";
      ctx.font = "bold 12px sans-serif";
      ctx.fillText(title, 16, y + 16);
    }

    floorBand(0, 162, "FLOOR 3  ·  CAROUSEL  ·  lifeclocks hit 30 here and tier up", "rgba(70,16,50,0.45)");
    floorBand(162, 156, "FLOOR 2  ·  WORK  ·  bank / food / power / nursery", "rgba(24,32,64,0.38)");
    floorBand(318, 190, "FLOOR 1  ·  HOMES  ·  five apartments at a time (use arrows)", "rgba(36,24,58,0.4)");
    floorBand(508, 172, "FLOOR 0  ·  SUPERMARKET  ·  same shoppers, same Banker cards", "rgba(16,40,28,0.42)");

    // dome
    ctx.strokeStyle = "rgba(240,140,210,0.55)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(W / 2, 8, 540, 34, 0, Math.PI, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fill();
    ctx.fillStyle = "#ffd0f0";
    ctx.font = "bold 15px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("THE CITY  ·  Logan’s Run shelter", W / 2, 28);
    ctx.font = "11px sans-serif";
    ctx.fillStyle = "rgba(255,230,255,0.7)";
    var cal = cityParts(now);
    ctx.fillText(
      cal.month +
        " " +
        cal.day +
        ", " +
        cal.year +
        "   " +
        cal.h +
        ":" +
        cal.m +
        ":" +
        cal.s +
        (night ? "  ·  night" : "  ·  day") +
        "  ·  click any person",
      W / 2,
      44
    );
    ctx.textAlign = "left";

    if (!people.length) {
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(80, 220, W - 160, 140);
      ctx.fillStyle = "#ffe0f4";
      ctx.font = "bold 20px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Waiting on Banker citizens…", W / 2, 280);
      ctx.font = "14px sans-serif";
      ctx.fillStyle = "#d8c8e8";
      ctx.fillText("Start the gallery server, then click Seal break.", W / 2, 312);
      ctx.textAlign = "left";
      return;
    }

    function countIn(pred) {
      var n = 0;
      for (var i = 0; i < people.length; i++) if (pred(people[i])) n++;
      return n;
    }

    function drawRoom(r, fill, extra, artIndex) {
      ctx.save();
      rr(r.x, r.y, r.w, r.h, 12);
      ctx.clip();
      var art = bgUrls[artIndex != null ? artIndex % bgUrls.length : 0];
      if (art) {
        drawCover(
          preloadImg(art),
          r.x,
          r.y,
          r.w,
          r.h,
          1.2,
          Math.sin(t * 0.05 + r.x) * 0.08,
          Math.cos(t * 0.04 + r.y) * 0.06
        );
      }
      ctx.fillStyle = fill;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.restore();
      ctx.strokeStyle = "rgba(255,220,255,0.55)";
      ctx.lineWidth = 1.6;
      rr(r.x, r.y, r.w, r.h, 12);
      ctx.stroke();
      ctx.fillStyle = "rgba(0,0,0,0.22)";
      ctx.fillRect(r.x + 8, r.y + r.h - 18, r.w - 16, 10);
      ctx.fillStyle = "#fff";
      ctx.font = "bold 13px sans-serif";
      ctx.fillText(r.label, r.x + 12, r.y + 20);
      if (r.sub) {
        ctx.fillStyle = "rgba(255,236,255,0.78)";
        ctx.font = "11px sans-serif";
        ctx.fillText(r.sub, r.x + 12, r.y + 36);
      }
      if (extra) {
        ctx.fillStyle = "#ffe08a";
        ctx.font = "bold 11px sans-serif";
        ctx.fillText(extra, r.x + 12, r.y + r.h - 8);
      }
    }

    // Carousel disc
    var c = roomRect("carousel");
    drawRoom(c, "rgba(110,24,80,0.55)", "", 2);
    ctx.save();
    ctx.translate(c.x + c.w / 2, c.y + 72);
    ctx.strokeStyle = "rgba(255,180,80,0.85)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, 48, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,120,200,0.5)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 34, now / 180, now / 180 + Math.PI * 1.4);
    ctx.stroke();
    ctx.fillStyle = "#ffd27a";
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(7, 0);
    ctx.lineTo(0, 8);
    ctx.lineTo(-7, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    var riding = countIn(function (p) {
      return ageInLife(p, now) >= 29.15 && ageInLife(p, now) < 30;
    });
    ctx.fillStyle = "#ffc2e8";
    ctx.font = "11px sans-serif";
    ctx.fillText(riding ? riding + " riding Carousel now" : "Empty — nobody is 29–30 yet (speed up time)", c.x + 14, c.y + c.h - 8);

    var workSubs = [
      countIn(function (p) { return scheduleZone(p, now) === "work" && workIndex((p.job || {}).id) === 0; }),
      countIn(function (p) { return scheduleZone(p, now) === "work" && workIndex((p.job || {}).id) === 1; }),
      countIn(function (p) { return scheduleZone(p, now) === "work" && workIndex((p.job || {}).id) === 2; }),
      countIn(function (p) {
        var z = scheduleZone(p, now);
        return z === "nursery" || (z === "work" && workIndex((p.job || {}).id) === 3);
      }),
    ];
    for (var wi = 0; wi < 4; wi++) {
      var wr = roomRect("work", wi);
      drawRoom(wr, "rgba(32,48,88,0.5)", workSubs[wi] + " people here", wi + 1);
      // furniture blocks
      ctx.fillStyle = "rgba(180,200,255,0.12)";
      ctx.fillRect(wr.x + wr.w - 46, wr.y + 44, 28, 52);
    }

    var vis0 = homePage * HOMES_PER_PAGE;
    for (var hi = vis0; hi < vis0 + HOMES_PER_PAGE && hi < 50; hi++) {
      var hr = roomRect("home", hi);
      var here = people.filter(function (p) {
        return p.home === hi && lifeAge(p, now) >= 0;
      });
      var atHome = here.filter(function (p) {
        return scheduleZone(p, now) === "home";
      }).length;
      var couple = here.filter(function (p) {
        return !p.gen;
      });
      var names = couple
        .map(function (p) {
          return p.first;
        })
        .slice(0, 2)
        .join(" + ");
      drawRoom(
        hr,
        "rgba(48,32,72,0.48)",
        (names || "empty") + " · " + atHome + " home now",
        (hi % 5) + 1
      );
      // bed + window
      ctx.fillStyle = "rgba(120,90,160,0.45)";
      ctx.fillRect(hr.x + 12, hr.y + hr.h - 36, 54, 16);
      ctx.fillStyle = "rgba(160,220,255,0.25)";
      ctx.fillRect(hr.x + hr.w - 40, hr.y + 44, 22, 18);
    }

    var mr = roomRect("market");
    var shopN = countIn(function (p) {
      return scheduleZone(p, now) === "market";
    });
    drawRoom(
      mr,
      "rgba(22,58,40,0.42)",
      shopN + " shopping with Banker debit · click this floor to enter",
      3
    );
    for (var a = 0; a < 8; a++) {
      ctx.fillStyle = "rgba(80,140,100,0.35)";
      ctx.fillRect(mr.x + 24 + a * 138, mr.y + 48, 18, 70);
      ctx.fillStyle = "rgba(180,255,200,0.15)";
      ctx.fillRect(mr.x + 46 + a * 138, mr.y + 52, 70, 14);
    }

    function bodyColor(p) {
      if (p.isPlayer) return "#5cf0a0";
      if (p.gen === 1) return "#e8d080";
      return p.gender === "female" ? "#f0a0c8" : "#7eb4f0";
    }

    function stepToward(p, tgt) {
      var st = anim[p.id];
      if (!st) {
        st = anim[p.id] = { x: tgt.x, y: tgt.y, facing: 1, phase: hash32(p.id) % 100 / 30, walking: false };
      }
      var dx = tgt.x - st.x;
      var dy = tgt.y - st.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      var maxStep = (dist > 180 ? 420 : 150) * realDt;
      if (dist > 1.2) {
        st.x += (dx / dist) * Math.min(dist, maxStep);
        st.y += (dy / dist) * Math.min(dist, maxStep);
        st.walking = dist > 6;
        if (Math.abs(dx) > 1) st.facing = dx < 0 ? -1 : 1;
      } else {
        st.walking = false;
        st.x = tgt.x;
        st.y = tgt.y;
      }
      st.phase += (st.walking ? 11 : 2.2) * realDt;
      return st;
    }

    function drawDweller(p, st) {
      var age = ageInLife(p, now);
      var kid = age < 16;
      var sel = p.id === selectedId;
      var walk = st.walking;
      var bob = Math.sin(st.phase * (walk ? 2 : 1)) * (walk ? 3.2 : 1.1);
      var sway = Math.sin(st.phase * (walk ? 2 : 1) + 0.4) * (walk ? 4 : 1.2);
      var x = st.x + sway * 0.15;
      var y = st.y + bob;
      var scale = kid ? 0.72 : p.isPlayer ? 1.18 : 1;
      var bw = 16 * scale;
      var bh = 22 * scale;
      var headR = (kid ? 9 : 13) * scale;
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(st.facing, 1);
      // shadow
      ctx.fillStyle = "rgba(0,0,0,0.4)";
      ctx.beginPath();
      ctx.ellipse(0, bh * 0.62, bw * 0.85, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      // legs
      var leg = walk ? Math.sin(st.phase * 2) * 5 : 0;
      ctx.strokeStyle = bodyColor(p);
      ctx.lineWidth = 3.2 * scale;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(-3 * scale, bh * 0.15);
      ctx.lineTo(-3 * scale + leg, bh * 0.58);
      ctx.moveTo(3 * scale, bh * 0.15);
      ctx.lineTo(3 * scale - leg, bh * 0.58);
      ctx.stroke();
      // body
      ctx.fillStyle = bodyColor(p);
      rr(-bw / 2, -4, bw, bh * 0.62, 6);
      ctx.fill();
      if (sel) {
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      // arms
      var arm = walk ? Math.cos(st.phase * 2) * 7 : Math.sin(st.phase) * 2;
      ctx.strokeStyle = bodyColor(p);
      ctx.lineWidth = 2.6 * scale;
      ctx.beginPath();
      ctx.moveTo(-bw * 0.42, 2);
      ctx.lineTo(-bw * 0.55, 10 + arm);
      ctx.moveTo(bw * 0.42, 2);
      ctx.lineTo(bw * 0.55, 10 - arm);
      ctx.stroke();
      // portrait head
      var face = portraitFor(p);
      ctx.save();
      ctx.beginPath();
      ctx.arc(0, -headR * 0.15 - 8, headR, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      if (imgReady(face)) {
        drawCover(face, -headR, -headR * 1.35 - 8, headR * 2, headR * 2, 1.08, 0, -0.08);
      } else {
        ctx.fillStyle = "#f3d7c4";
        ctx.fill();
      }
      ctx.restore();
      ctx.beginPath();
      ctx.arc(0, -headR * 0.15 - 8, headR, 0, Math.PI * 2);
      ctx.strokeStyle = sel ? "#fff" : crystalColor(age);
      ctx.lineWidth = sel ? 2.4 : 1.6;
      ctx.stroke();
      // lifeclock
      ctx.save();
      ctx.translate(0, 6 * scale);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = crystalColor(age);
      var cs = 4.4 * scale;
      ctx.fillRect(-cs, -cs, cs * 2, cs * 2);
      ctx.restore();
      ctx.restore();
      ctx.fillStyle = sel || p.isPlayer ? "#fff" : "rgba(255,255,255,0.9)";
      ctx.font = (sel ? "bold " : "") + "11px sans-serif";
      ctx.textAlign = "center";
      ctx.shadowColor = "rgba(0,0,0,0.8)";
      ctx.shadowBlur = 4;
      ctx.fillText(p.first, st.x, y + bh * 0.62 + 14);
      ctx.shadowBlur = 0;
      ctx.textAlign = "left";
    }

    people.forEach(function (p) {
      if (lifeAge(p, now) < 0) return;
      var tgt = personTarget(p, now, people);
      var st = stepToward(p, tgt);
      p._sx = st.x;
      p._sy = st.y;
      var vis0b = homePage * HOMES_PER_PAGE;
      var vis1b = vis0b + HOMES_PER_PAGE;
      if (tgt.z === "home" && ((p.home || 0) < vis0b || (p.home || 0) >= vis1b)) return;
      drawDweller(p, st);
    });

    var pg = $("lr-home-page");
    if (pg) {
      pg.textContent = "HAB " + (vis0 + 1) + "–" + Math.min(50, vis0 + HOMES_PER_PAGE) + " of 50";
    }
  }

  function pickPerson(x, y, people) {
    var best = null;
    var bestD = 28;
    people.forEach(function (p) {
      if (p._sx == null) return;
      var dx = p._sx - x;
      var dy = p._sy - y;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    });
    return best;
  }

  function renderInspect(p, now) {
    var el = $("lr-inspect");
    if (!el) return;
    if (!p) {
      el.innerHTML = "<h3>Citizen</h3><p class=\"lr-muted\">Click a lifeclock in the vault.</p>";
      return;
    }
    var age = ageInLife(p, now);
    var tier = tierOf(p, now);
    var col = crystalColor(age);
    el.innerHTML =
      "<h3>" +
      esc(p.name) +
      (p.isPlayer ? " <span class=\"lr-muted\">(you)</span>" : "") +
      "</h3><dl>" +
      "<dt>Gender</dt><dd>" +
      esc(p.gender) +
      "</dd>" +
      "<dt>Lifeclock</dt><dd><i class=\"lr-crystal\" style=\"background:" +
      col +
      "\"></i>" +
      age.toFixed(2) +
      " / 30 · tier " +
      tier +
      "</dd>" +
      "<dt>Household</dt><dd>HAB " +
      ((p.home || 0) + 1) +
      (p.partnerName ? " · paired with " + esc(p.partnerName) : "") +
      "</dd>" +
      "<dt>Kin</dt><dd>" +
      (p.motherId || p.fatherId
        ? "child of #" + (p.motherId || "?") + " & #" + (p.fatherId || "?")
        : "founder (no blood overlap with spouse)") +
      "</dd>" +
      "<dt>Work</dt><dd>" +
      esc((p.job && p.job.label) || "unassigned") +
      " · now " +
      esc(scheduleZone(p, now)) +
      "</dd>" +
      "<dt>Cards</dt><dd>" +
      money(p.possession) +
      " debit possession (Banker split)</dd>" +
      "</dl>" +
      (scheduleZone(p, now) === "market"
        ? "<p class=\"lr-muted\" style=\"margin-top:0.45rem\">Shopping the art supermarket on Banker debit.</p>"
        : "");
  }

  function renderFeed() {
    var ul = $("lr-feed");
    if (!ul) return;
    ul.innerHTML = feed
      .map(function (f) {
        return "<li>" + esc(f.msg) + "</li>";
      })
      .join("");
  }

  function renderHud() {
    var atomic = nowAtomic();
    fillCal("lr-city-", cityParts(gameNowMs()));
    fillCal("lr-utc-", utcParts(atomic));
    var sp = speedNow();
    if ($("lr-speed")) {
      $("lr-speed").textContent = !clock.sealed
        ? "unsealed"
        : sp === 0
          ? "paused"
          : (sp < 0 ? "◀ " : "") + Math.abs(sp) + "×";
    }
    if ($("lr-break")) {
      if (!clock.sealed) {
        $("lr-break").textContent = "not sealed";
      } else {
        var b = utcParts(clock.breakUtc);
        $("lr-break").textContent =
          b.month + " " + b.day + ", " + b.year + "  " + b.h + ":" + b.m + ":" + b.s + " UTC";
      }
    }
    var meta = $("lr-break-meta");
    if (meta) {
      if (!clock.sealed) {
        meta.textContent = "Seal a time break to stamp atomic UTC. From that instant you can run, pause, or reverse the City.";
      } else {
        var delta = nowAtomic() - clock.breakUtc;
        var g = gameNowMs();
        meta.textContent =
          "Break " +
          clock.playInstance +
          " · atomic elapsed " +
          (delta / 1000).toFixed(1) +
          "s · city elapsed " +
          (g / 1000).toFixed(1) +
          "s · offset city−atomic×speed tracked in segments (" +
          clock.log.length +
          " direction changes).";
      }
    }
    markSpeedButtons();
  }

  function renderKpis(people, now) {
    var live = people.filter(function (p) {
      return lifeAge(p, now) >= 0;
    });
    var homes = {};
    live.forEach(function (p) {
      homes[p.home] = 1;
    });
    var kids = live.filter(function (p) {
      return p.gen === 1;
    }).length;
    var tiers = 0;
    live.forEach(function (p) {
      tiers += Math.max(0, tierOf(p, now) - 1);
    });
    if ($("lr-pop")) $("lr-pop").textContent = String(live.length);
    if ($("lr-homes")) $("lr-homes").textContent = String(Object.keys(homes).length);
    if ($("lr-kids")) $("lr-kids").textContent = String(kids);
    if ($("lr-tiers")) $("lr-tiers").textContent = String(tiers);
  }

  function tick(ts) {
    if (!running) return;
    if (lastTs) realDt = Math.min(0.05, (ts - lastTs) / 1000);
    lastTs = ts;
    realNow = ts;
    var now = gameNowMs();
    var people = allPeople(now);
    detectEvents(people, now);
    drawVault(people, now);
    renderKpis(people, now);
    renderHud();
    if (selectedId) {
      var sel = people.filter(function (p) {
        return p.id === selectedId;
      })[0];
      renderInspect(sel, now);
    }
    raf = requestAnimationFrame(tick);
  }

  function startLoop() {
    if (running) return;
    running = true;
    raf = requestAnimationFrame(tick);
  }

  function stopLoop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  function canvasPos(ev) {
    var r = canvas.getBoundingClientRect();
    return {
      x: ((ev.clientX - r.left) / r.width) * W,
      y: ((ev.clientY - r.top) / r.height) * H,
    };
  }

  function bind() {
    document.querySelectorAll("[data-lr-speed]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setSpeed(Number(btn.getAttribute("data-lr-speed")));
        startLoop();
      });
    });
    $("lr-seal") &&
      $("lr-seal").addEventListener("click", function () {
        sealBreak();
        startLoop();
      });
    $("lr-supermarket") &&
      $("lr-supermarket").addEventListener("click", function () {
        location.hash = "supermarket";
        var tab = document.querySelector('.site-tabs .tab[data-tab="supermarket"]');
        if (tab) tab.click();
      });
    $("lr-home-prev") &&
      $("lr-home-prev").addEventListener("click", function () {
        homePage = Math.max(0, homePage - 1);
      });
    $("lr-home-next") &&
      $("lr-home-next").addEventListener("click", function () {
        homePage = Math.min(9, homePage + 1);
      });
    if (canvas) {
      canvas.addEventListener("click", function (ev) {
        var pt = canvasPos(ev);
        var market = roomRect("market");
        if (
          pt.x >= market.x &&
          pt.x <= market.x + market.w &&
          pt.y >= market.y &&
          pt.y <= market.y + market.h &&
          !pickPerson(pt.x, pt.y, allPeople(gameNowMs()))
        ) {
          location.hash = "supermarket";
          var tab = document.querySelector('.site-tabs .tab[data-tab="supermarket"]');
          if (tab) tab.click();
          return;
        }
        var p = pickPerson(pt.x, pt.y, allPeople(gameNowMs()));
        selectedId = p ? p.id : null;
        renderInspect(p, gameNowMs());
      });
      canvas.addEventListener("wheel", function (ev) {
        ev.preventDefault();
        if (ev.deltaY > 0) homePage = Math.min(9, homePage + 1);
        else homePage = Math.max(0, homePage - 1);
      }, { passive: false });
    }
    window.addEventListener("tab-changed", function (e) {
      if (e.detail && e.detail.tab === "carousel") {
        boot(true);
      } else {
        stopLoop();
      }
    });
    window.addEventListener("carousel-hide", stopLoop);
  }

  function boot(fromTab) {
    Promise.all([syncAtomicClock(), loadClock(), loadRoster(), loadArt()]).then(function () {
      renderHud();
      var now = gameNowMs();
      var people = allPeople(now);
      drawVault(people, now);
      renderKpis(people, now);
      if (clock.sealed) startLoop();
      else if (fromTab) startLoop();
    });
  }

  function init() {
    canvas = $("lr-canvas");
    if (!canvas) return;
    ctx = canvas.getContext("2d");
    bind();
    boot(false);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
