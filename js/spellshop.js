/**
 * Spell Shop — conveyor of 35 Spellforge-quality visions from paintings + generated.
 * Prompts, color locks, animate-all; out-of-credits keeps retrying with $ floats.
 */
(function () {
  "use strict";

  var CAST_SIZE = 35;
  var PARALLEL = 1;
  var PROMPT_BODY_MAX = 2600;
  var TOTAL_PAINTINGS = 1000;
  var CREDITS_RETRY_MS = 12000;

  var state = {
    active: false,
    casting: false,
    animating: false,
    done: 0,
    failed: 0,
    castId: "",
    items: [],
    usedUrls: {},
    usedSpellKeys: {},
    ringEl: null,
    analyses: {},
    lod1: {}, // generated analyses by number (lazy, only for picked sources)
    pool: [], // lightweight { id, kind, num?, url, title? }
    poolById: {},
    poolReady: false,
    poolLoading: null,
    lightboxIndex: -1,
    centerIndex: 0,
    colors: [
      { name: "Gold", hex: "#EAB308" },
      { name: "Violet", hex: "#A855F7" },
      { name: "Cyan", hex: "#06B6D4" },
      { name: "Scarlet", hex: "#FF2400" },
      { name: "Emerald", hex: "#059669" },
      { name: "Ivory", hex: "#F8FAFC" },
    ],
  };

  var COLOR_NAME_HEX = {
    pink: "#FF4FA3",
    magenta: "#FF00AA",
    purple: "#A855F7",
    violet: "#7C3AED",
    indigo: "#4338CA",
    blue: "#2563EB",
    cyan: "#06B6D4",
    teal: "#0D9488",
    green: "#16A34A",
    emerald: "#059669",
    lime: "#84CC16",
    yellow: "#FACC15",
    gold: "#EAB308",
    amber: "#F59E0B",
    orange: "#F97316",
    coral: "#FF6B4A",
    red: "#EF4444",
    scarlet: "#FF2400",
    crimson: "#DC143C",
    rose: "#F43F5E",
    brown: "#92400E",
    white: "#F8FAFC",
    ivory: "#FFFFF0",
    cream: "#FFF5E0",
    black: "#0A0A0C",
    gray: "#6B7280",
    navy: "#1E3A5F",
    lavender: "#C084FC",
    sky: "#38BDF8",
  };

  var VARIATION_HOOKS = [
    "wide establishing shot",
    "intimate close crop",
    "dramatic low angle",
    "soft overcast light",
    "golden hour rim light",
    "moonlit cool palette",
    "busy layered depth",
    "sparse quiet negative space",
    "strong silhouette",
    "rich texture study",
    "stormy atmosphere",
    "still-life tabletop energy",
    "landscape horizon focus",
    "portrait-style framing",
    "aerial bird's-eye",
    "through-a-doorway reveal",
    "reflection motif",
    "smoke and particulate air",
    "crystalline clarity",
    "dream haze",
    "graphic bold shapes",
    "painterly loose brush",
    "ink-line precision",
    "saturated jewel tones",
    "muted earth tones",
    "nocturnal city glow",
    "forest understory",
    "coastal spray light",
    "interior candle warmth",
    "abstract field of color",
    "narrative multi-figure",
    "single iconic object hero",
    "weathered material study",
    "festive celebration mood",
    "solemn monumental scale",
  ];

  function $(id) {
    return document.getElementById(id);
  }

  function apiUrl(path) {
    if (typeof window.galleryApiUrl === "function") return window.galleryApiUrl(path);
    var base = String(window.SPELLFORGE_API_BASE || "").replace(/\/$/, "");
    var p = path.charAt(0) === "/" ? path : "/" + path;
    return base ? base + p : p;
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function clipText(s, max) {
    s = String(s || "").trim();
    if (s.length <= max) return s;
    var cut = s.slice(0, max - 1);
    var sp = cut.lastIndexOf(" ");
    if (sp > max * 0.7) cut = cut.slice(0, sp);
    return cut + "…";
  }

  function sleep(ms) {
    return new Promise(function (r) {
      setTimeout(r, ms);
    });
  }

  function randInt(a, b) {
    return a + Math.floor(Math.random() * (b - a + 1));
  }

  function setStatus(msg, kind) {
    var el = $("ss-status");
    if (!el) return;
    el.textContent = msg || "";
    el.className =
      "ss-status" + (kind === "err" ? " is-err" : kind === "ok" ? " is-ok" : "");
  }

  function setProgress(done, total, label) {
    var wrap = $("ss-progress");
    var fill = $("ss-progress-fill");
    var meta = $("ss-progress-meta");
    if (!wrap || !fill) return;
    wrap.classList.toggle("is-on", total > 0 && (state.casting || state.animating));
    fill.style.width = total ? Math.round((done / total) * 100) + "%" : "0%";
    if (meta) {
      meta.textContent =
        (label || "Cast") +
        ": " +
        done +
        " / " +
        total +
        (state.failed ? " · " + state.failed + " failed" : "");
    }
  }

  function normalizeHex(raw) {
    var s = String(raw || "")
      .trim()
      .replace(/^#/, "");
    if (/^[0-9a-fA-F]{3}$/.test(s)) {
      s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    }
    if (!/^[0-9a-fA-F]{6}$/.test(s)) return "";
    return ("#" + s).toUpperCase();
  }

  function hexToRgb(hex) {
    var h = normalizeHex(hex);
    if (!h) return null;
    return {
      r: parseInt(h.slice(1, 3), 16),
      g: parseInt(h.slice(3, 5), 16),
      b: parseInt(h.slice(5, 7), 16),
    };
  }

  function titleCaseColorName(name) {
    return String(name || "color")
      .split(/[\s\-_]+/)
      .filter(Boolean)
      .map(function (w) {
        return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
      })
      .join(" ");
  }

  function hexToNearestName(hex) {
    var h = normalizeHex(hex);
    if (!h) return "color";
    var rgb = hexToRgb(h);
    if (!rgb) return "color";
    var best = "color";
    var bestD = Infinity;
    Object.keys(COLOR_NAME_HEX).forEach(function (name) {
      if (COLOR_NAME_HEX[name] === h) {
        best = name;
        bestD = -1;
        return;
      }
      if (bestD < 0) return;
      var ref = hexToRgb(COLOR_NAME_HEX[name]);
      if (!ref) return;
      var d =
        (rgb.r - ref.r) * (rgb.r - ref.r) +
        (rgb.g - ref.g) * (rgb.g - ref.g) +
        (rgb.b - ref.b) * (rgb.b - ref.b);
      if (d < bestD) {
        bestD = d;
        best = name;
      }
    });
    return best;
  }

  function colorLocksLine() {
    return state.colors
      .map(function (c) {
        return c.name + " (" + c.hex + ")";
      })
      .join("; ");
  }

  function userPromptText() {
    var el = $("ss-prompt");
    return el ? String(el.value || "").trim() : "";
  }

  function getAspectRatio() {
    var sel = $("ss-aspect");
    var v = sel && sel.value ? String(sel.value) : "3:4";
    return /^\d+:\d+$/.test(v) ? v : "3:4";
  }

  function isCreditsError(msg) {
    if (!msg) return false;
    var m = String(msg).toLowerCase();
    return (
      m.indexOf("credit") >= 0 ||
      m.indexOf("billing") >= 0 ||
      m.indexOf("quota") >= 0 ||
      m.indexOf("payment") >= 0 ||
      m.indexOf("insufficient") >= 0 ||
      m.indexOf("balance") >= 0 ||
      m.indexOf("purchase") >= 0 ||
      m.indexOf("out of") >= 0
    );
  }

  function getAnalysis(n) {
    if (window.getGalleryAnalyses) {
      var all = window.getGalleryAnalyses() || {};
      var hit = all[String(n)] || all[n];
      if (hit) return hit;
    }
    return state.analyses[String(n)] || state.analyses[n] || null;
  }

  function getLod1(n) {
    if (n == null || n === "") return null;
    return state.lod1[String(n)] || state.lod1[n] || null;
  }

  /** Gallery assets use version / entity_name — not always number. */
  function extractAssetNum(item) {
    if (!item) return null;
    var candidates = [
      item.number,
      item.num,
      item.version,
      item.generated_num,
    ];
    for (var i = 0; i < candidates.length; i++) {
      var n = parseInt(candidates[i], 10);
      if (!isNaN(n) && n > 0) return n;
    }
    var en = String(item.entity_name || item.title || item.subtitle || "");
    var m = en.match(/G?#\s*(\d+)/i) || en.match(/(\d{3,})/);
    if (m) return parseInt(m[1], 10);
    var id = String(item.id || item.url || "");
    var m2 = id.match(/(?:generated\/|G#?)(\d+)/i) || id.match(/(\d+)\.(?:jpg|jpeg|png|webp)/i);
    if (m2) return parseInt(m2[1], 10);
    return null;
  }

  function analysisTextBundle(a, fallbackTitle) {
    a = a || {};
    var title = String(a.title || fallbackTitle || "").trim();
    var description = String(a.description || "").trim();
    var prompt = String(a.prompt || "").trim();
    var style = String(a.style || "").trim();
    var mood = String(a.mood || "").trim();
    var tags = Array.isArray(a.tags) ? a.tags.filter(Boolean).join(", ") : "";
    var bits = [];
    if (description) bits.push(description);
    if (prompt) bits.push("Prompt weight: " + prompt);
    if (style) bits.push("Style: " + style);
    if (mood) bits.push("Mood: " + mood);
    if (tags) bits.push("Tags: " + tags);
    return {
      title: title,
      description: description,
      prompt: prompt,
      body: bits.join("\n"),
    };
  }

  function sourceLabel(s) {
    if (!s) return "Unknown source";
    if (s.kind === "generated") {
      return s.num != null ? "Generated #" + s.num : "Generated spell";
    }
    return s.num != null ? "Painting #" + s.num : "Painting spell";
  }

  function rebuildPoolIndex() {
    state.poolById = {};
    for (var i = 0; i < state.pool.length; i++) {
      var p = state.pool[i];
      if (p && p.id) state.poolById[p.id] = p;
    }
  }

  function updatePoolMeta() {
    var meta = $("ss-pool-meta");
    if (!meta) return;
    var g = 0;
    for (var i = 0; i < state.pool.length; i++) {
      if (state.pool[i].kind === "generated") g++;
    }
    var p = state.pool.length - g;
    meta.textContent =
      "Spell pool ready: " +
      p +
      " paintings + " +
      g +
      " generated = " +
      state.pool.length +
      " (text loads per cast)";
  }

  /** Always re-hydrate from pool + analyses so prompts never ship empty “?”. */
  function hydrateSource(src) {
    if (!src) return null;
    var found =
      (src.id && state.poolById[src.id]) ||
      null;
    if (!found && src.kind && src.num != null) {
      found =
        state.poolById[
          (src.kind === "generated" ? "g-" : "p-") + src.num
        ] || null;
    }
    var base = found ? Object.assign({}, found) : Object.assign({}, src);
    if (base.kind === "painting" && base.num != null) {
      var pa = getAnalysis(base.num);
      var pb = analysisTextBundle(pa, "Painting #" + base.num);
      base.title = pb.title || base.title || "Painting #" + base.num;
      base.description = pb.description || base.description || "";
      base.prompt = pb.prompt || base.prompt || "";
      base.body = pb.body || base.body || "";
      if (!base.url) base.url = "paintings/" + base.num + ".jpg";
    } else if (base.kind === "generated") {
      var gn = base.num != null ? base.num : extractAssetNum(base);
      base.num = gn;
      var ga = (gn != null ? getLod1(gn) : null) || {};
      var gb = analysisTextBundle(
        ga,
        gn != null ? "Generated #" + gn : "Generated spell"
      );
      base.title =
        gb.title ||
        base.title ||
        (gn != null ? "Generated #" + gn : "Generated spell");
      base.description = gb.description || base.description || "";
      base.prompt = gb.prompt || base.prompt || "";
      base.body = gb.body || base.body || "";
      if (!base.url && gn != null) base.url = "/generated/" + gn + ".jpg";
    }
    if (!base.body) {
      base.body = clipText(
        [base.description, base.prompt, base.title].filter(Boolean).join("\n"),
        600
      );
    }
    return base;
  }

  /** Fetch only the generated analyses we need for this cast (not the whole LOD1 dump). */
  function prefetchGeneratedTexts(items) {
    var need = {};
    (items || []).forEach(function (it) {
      (it.sources || []).forEach(function (s) {
        if (!s || s.kind !== "generated" || s.num == null) return;
        if (getLod1(s.num)) return;
        need[s.num] = true;
      });
    });
    var nums = Object.keys(need).map(function (k) {
      return parseInt(k, 10);
    });
    if (!nums.length) return Promise.resolve();

    var i = 0;
    var workers = 6;
    function worker() {
      if (i >= nums.length) return Promise.resolve();
      var n = nums[i++];
      var urls = [
        "generated/" + n + ".json",
        "/generated/" + n + ".json",
      ];
      return fetch(urls[0], { cache: "force-cache" })
        .catch(function () {
          return fetch(urls[1], { cache: "force-cache" });
        })
        .then(function (r) {
          return r && r.ok ? r.json() : null;
        })
        .then(function (a) {
          if (a && typeof a === "object") {
            state.lod1[String(n)] = a;
            state.lod1[n] = a;
          }
        })
        .catch(function () {})
        .then(worker);
    }
    var jobs = [];
    for (var w = 0; w < workers; w++) jobs.push(worker());
    return Promise.all(jobs);
  }

  function loadGeneratedSlim() {
    var CACHE_KEY = "spellshop_gen_ids_v2";
    try {
      var cached = sessionStorage.getItem(CACHE_KEY);
      if (cached) {
        var parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 50) {
          return Promise.resolve(parsed);
        }
      }
    } catch (e) {}

    return fetch(apiUrl("/api/gallery-assets?collection=generated&t=" + Date.now()), {
      cache: "default",
    })
      .then(function (r) {
        return r.ok ? r.json() : { items: [] };
      })
      .then(function (data) {
        var items = data.items || [];
        if (!Array.isArray(items)) items = [];
        var slim = [];
        for (var i = 0; i < items.length; i++) {
          var it = items[i];
          if (!it) continue;
          var num = extractAssetNum(it);
          var url =
            it.url ||
            it.image_url ||
            (num != null ? "/generated/" + num + ".jpg" : "");
          if (!url) continue;
          slim.push({
            num: num,
            url: url,
            title: it.title || (num != null ? "Generated #" + num : "Generated"),
          });
        }
        try {
          sessionStorage.setItem(CACHE_KEY, JSON.stringify(slim));
        } catch (err) {}
        return slim;
      })
      .catch(function () {
        return [];
      });
  }

  /**
   * Fast pool build: lightweight refs only.
   * Does NOT download the multi‑MB lod1-analyses dump.
   * Text is filled per-cast via painting analyses + generated/N.json.
   */
  function loadPool() {
    if (state.poolReady && state.pool.length) {
      updatePoolMeta();
      return Promise.resolve(state.pool);
    }
    if (state.poolLoading) return state.poolLoading;

    var meta = $("ss-pool-meta");
    if (meta) meta.textContent = "Loading spell pool…";

    state.poolLoading = Promise.resolve()
      .then(function () {
        // Paintings: numbers only; text from analyses on demand
        if (window.loadGalleryData) {
          return window.loadGalleryData().then(function (data) {
            state.analyses = (data && data.analyses) || {};
            if (window.getGalleryAnalyses) {
              state.analyses = window.getGalleryAnalyses() || state.analyses;
            }
          });
        }
        return fetch("data/analyses.json", { cache: "force-cache" })
          .then(function (r) {
            return r.ok ? r.json() : {};
          })
          .then(function (a) {
            state.analyses = a || {};
          })
          .catch(function () {
            state.analyses = {};
          });
      })
      .then(function () {
        var pool = [];
        for (var n = 1; n <= TOTAL_PAINTINGS; n++) {
          pool.push({
            id: "p-" + n,
            kind: "painting",
            num: n,
            url: "paintings/" + n + ".jpg",
            title: "Painting #" + n,
          });
        }
        return loadGeneratedSlim().then(function (slim) {
          for (var i = 0; i < slim.length; i++) {
            var g = slim[i];
            if (!g || !g.url) continue;
            pool.push({
              id: "g-" + (g.num != null ? g.num : g.url),
              kind: "generated",
              num: g.num,
              url: g.url,
              title: g.title || (g.num != null ? "Generated #" + g.num : "Generated"),
            });
          }
          // de-dupe urls
          var seen = {};
          state.pool = pool.filter(function (p) {
            if (!p.url || seen[p.url]) return false;
            seen[p.url] = true;
            return true;
          });
          rebuildPoolIndex();
          state.poolReady = true;
          state.poolLoading = null;
          updatePoolMeta();
          return state.pool;
        });
      })
      .catch(function (err) {
        state.poolLoading = null;
        throw err;
      });

    return state.poolLoading;
  }

  function pickSourcesForIndex(index) {
    var tries = 0;
    var count = 2 + (index % 2);
    var len = state.pool.length;
    if (len < 2) return [];
    while (tries++ < 80) {
      var picks = [];
      var keys = [];
      var guard = 0;
      while (picks.length < count && guard++ < 60) {
        var src = state.pool[randInt(0, len - 1)];
        if (!src || !src.id || keys.indexOf(src.id) >= 0) continue;
        keys.push(src.id);
        picks.push({
          id: src.id,
          kind: src.kind,
          num: src.num,
          url: src.url,
          title: src.title,
        });
      }
      keys.sort();
      var key = keys.join("|");
      if (!state.usedSpellKeys[key] && picks.length >= 2) {
        state.usedSpellKeys[key] = true;
        return picks;
      }
    }
    var a = state.pool[index % len];
    var b = state.pool[(index * 7 + 3) % len];
    return [
      a && {
        id: a.id,
        kind: a.kind,
        num: a.num,
        url: a.url,
        title: a.title,
      },
      b && {
        id: b.id,
        kind: b.kind,
        num: b.num,
        url: b.url,
        title: b.title,
      },
    ].filter(Boolean);
  }

  function buildShopPrompt(item) {
    var artist =
      (window.GALLERY_AUTHOR && window.GALLERY_AUTHOR.author) || "Logan Sevin";
    var sources = (item.sources || []).map(hydrateSource).filter(Boolean);
    item.sources = sources;
    var hook =
      VARIATION_HOOKS[(item.index || 0) % VARIATION_HOOKS.length] ||
      "unique composition";
    var aspect = getAspectRatio();
    var lines = [];
    lines.push(
      "SPELL SHOP VISION — one original fine-art image for a magical spell marketplace. " +
        "Cohesive finished artwork (not a UI mockup unless asked). Aspect " +
        aspect +
        "."
    );
    lines.push("Studio author: " + artist + ".");
    lines.push(
      "UNIQUE SLOT #" +
        ((item.index || 0) + 1) +
        " of " +
        CAST_SIZE +
        " · cast " +
        (state.castId || "preview") +
        " · seed " +
        (item.seed || 0) +
        " · variation: " +
        hook +
        "."
    );
    lines.push(
      "Must be visually distinct from every other shop slot — different camera, subject emphasis, and palette."
    );
    lines.push("");
    lines.push("SOURCE SPELLS (paintings and/or generated — honor each fully):");
    if (!sources.length) {
      lines.push("(no sources resolved — use artist direction only)");
    }
    for (var i = 0; i < sources.length; i++) {
      var s = sources[i];
      var tag = sourceLabel(s);
      var title = s.title || tag;
      lines.push("── " + tag + " · " + title + " ──");
      var body = clipText(
        s.body ||
          [s.description, s.prompt ? "Prompt weight: " + s.prompt : ""]
            .filter(Boolean)
            .join("\n") ||
          "",
        520
      );
      if (body) {
        lines.push(body);
      } else {
        lines.push(
          "Visual reference: " +
            tag +
            (s.url ? " at " + s.url : "") +
            " — invent concrete forms, palette, and motifs consistent with that source image."
        );
      }
    }
    lines.push("");
    lines.push(
      "MERGE: Interweave forms, atmosphere, and motifs from every source into ONE image."
    );
    lines.push(
      "BOLD COLOR LOCKS (saturated, exact pigments): " + colorLocksLine() + "."
    );
    var extra = userPromptText();
    if (extra) {
      lines.push("");
      lines.push("SHOPKEEPER DIRECTION: " + extra);
    }
    lines.push(
      "Output: one full-frame finished artwork, museum-quality, aspect " + aspect + "."
    );
    if (item.retryNote) lines.push("RETRY: " + item.retryNote);
    return clipText(lines.join("\n"), PROMPT_BODY_MAX);
  }

  function pollJob(jobId, attemptsLeft) {
    if (attemptsLeft == null) attemptsLeft = 90;
    return new Promise(function (resolve, reject) {
      if (attemptsLeft <= 0) {
        reject(new Error("Timed out waiting for image"));
        return;
      }
      fetch(apiUrl("/api/jobs/" + encodeURIComponent(jobId)), { cache: "no-store" })
        .then(function (r) {
          if (!r.ok) throw new Error("Job HTTP " + r.status);
          return r.json();
        })
        .then(function (job) {
          var st = String((job && job.status) || "");
          if (st === "done") {
            var img = job.image || (job.images && job.images[0]);
            if (img && img.url) {
              resolve(String(img.url));
              return;
            }
            if (job.video && job.video.url) {
              resolve(String(job.video.url));
              return;
            }
            reject(new Error("No media URL"));
            return;
          }
          if (st === "failed" || st === "error") {
            var err = job.error;
            reject(
              new Error(
                (err && err.message) ||
                  (typeof err === "string" ? err : "Generate failed")
              )
            );
            return;
          }
          setTimeout(function () {
            pollJob(jobId, attemptsLeft - 1).then(resolve).catch(reject);
          }, 2000);
        })
        .catch(function (e) {
          if (attemptsLeft > 5) {
            setTimeout(function () {
              pollJob(jobId, attemptsLeft - 1).then(resolve).catch(reject);
            }, 2500);
          } else reject(e);
        });
    });
  }

  function floatDollar(item) {
    if (!item || !item.el) return;
    var d = document.createElement("span");
    d.className = "ss-dollar";
    d.textContent = "$";
    d.setAttribute("aria-hidden", "true");
    item.el.appendChild(d);
    setTimeout(function () {
      if (d.parentNode) d.parentNode.removeChild(d);
    }, 1500);
  }

  function requestImage(item) {
    var stasis = buildShopPrompt(item);
    item.promptSent = stasis;
    var jobId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : "ss-" + Date.now() + "-" + item.index + "-" + Math.random().toString(36).slice(2, 8);
    var buzz = state.colors.map(function (c) {
      return c.name;
    });
    buzz = buzz.concat(["spell shop", "gallery fusion", "slot-" + (item.index + 1)]);
    state.colors.forEach(function (c) {
      buzz.push(c.hex);
    });
    var spellNums = (item.sources || [])
      .map(hydrateSource)
      .filter(function (s) {
        return s && s.kind === "painting" && s.num;
      })
      .map(function (s) {
        return s.num;
      });

    return fetch(apiUrl("/api/generate-stasis-vision"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        job_id: jobId,
        stasis: stasis,
        fused_prompt: stasis,
        buzz_words: buzz.slice(0, 16),
        palette_hex: state.colors.map(function (c) {
          return c.hex;
        }),
        spells: spellNums,
        mag_fresh: true,
        fresh_variation: true,
        cast_number: item.index + 1,
        aspect_ratio: getAspectRatio(),
      }),
      cache: "no-store",
    })
      .then(function (r) {
        return r.text().then(function (text) {
          var d = {};
          try {
            d = text ? JSON.parse(text) : {};
          } catch (e) {
            throw new Error("Bad server response — is start_server.bat running?");
          }
          return { ok: r.ok, status: r.status, d: d };
        });
      })
      .then(function (res) {
        var d = res.d || {};
        var errMsg =
          (d.error && d.error.message) ||
          (typeof d.error === "string" ? d.error : "") ||
          "";
        if (!res.ok && isCreditsError(errMsg)) {
          throw new Error(errMsg || "Out of credits");
        }
        if (res.status === 202 || d.job_id) {
          return pollJob(d.job_id || jobId);
        }
        if (!res.ok) throw new Error(errMsg || "Generate failed");
        var img = d.image || (d.images && d.images[0]);
        if (img && img.url) return String(img.url);
        if (d.job_id) return pollJob(d.job_id);
        throw new Error(errMsg || "No image returned");
      });
  }

  function generateOne(item) {
    function tryOnce() {
      return requestImage(item).then(function (url) {
        var key = String(url).split("?")[0];
        if (key && state.usedUrls[key]) {
          item.retryNote = "duplicate URL — invent a completely new composition";
          item.seed = randInt(10000, 99999);
          item.sources = pickSourcesForIndex(item.index * 17 + randInt(1, 50));
          return sleep(400).then(tryOnce);
        }
        if (key) state.usedUrls[key] = true;
        item.url = url;
        item.status = "done";
        item.waitingCredits = false;
        updateCell(item);
        return url;
      });
    }

    function loop() {
      return tryOnce().catch(function (err) {
        var msg = (err && err.message) || String(err);
        if (isCreditsError(msg)) {
          item.status = "credits";
          item.waitingCredits = true;
          item.error = msg;
          updateCell(item);
          floatDollar(item);
          setStatus(
            "Out of credits on slot " +
              (item.index + 1) +
              " — waiting and retrying (add credits anytime)…",
            "err"
          );
          return sleep(CREDITS_RETRY_MS).then(function () {
            item.retryNote = "resume after credits; keep unique shop vision";
            item.seed = randInt(10000, 99999);
            return loop();
          });
        }
        // soft retry once for non-credit errors, then fail slot
        if (!item._softRetry) {
          item._softRetry = true;
          item.retryNote = "recover: " + clipText(msg, 60);
          item.seed = randInt(10000, 99999);
          return sleep(1000).then(tryOnce).catch(function (e2) {
            item.status = "err";
            item.error = (e2 && e2.message) || msg;
            state.failed++;
            updateCell(item);
            throw e2;
          });
        }
        item.status = "err";
        item.error = msg;
        state.failed++;
        updateCell(item);
        throw err;
      });
    }

    return loop().finally(function () {
      if ((item.status === "done" || item.status === "err") && !item._counted) {
        item._counted = true;
        state.done++;
        setProgress(state.done, CAST_SIZE, "Cast");
        setStatus(
          "Spell Shop casting… " +
            state.done +
            "/" +
            CAST_SIZE +
            (state.failed ? " (" + state.failed + " failed)" : "")
        );
      }
    });
  }

  function runPool(items) {
    var i = 0;
    var active = 0;
    return new Promise(function (resolve) {
      function next() {
        if (i >= items.length && active === 0) {
          resolve();
          return;
        }
        while (active < PARALLEL && i < items.length) {
          (function (item) {
            active++;
            sleep(item.index === 0 ? 0 : 120)
              .then(function () {
                return generateOne(item);
              })
              .catch(function () {})
              .then(function () {
                active--;
                next();
              });
          })(items[i++]);
        }
      }
      next();
    });
  }

  function ensureRing() {
    var conveyor = $("ss-conveyor");
    if (!conveyor) return null;
    var ring = document.createElement("div");
    ring.className = "ss-ring is-entering";
    ring.setAttribute("role", "list");
    conveyor.appendChild(ring);
    state.ringEl = ring;
    bindRingScroll(ring);
    return ring;
  }

  function conveyorOutOld() {
    var conveyor = $("ss-conveyor");
    if (!conveyor) return;
    var old = conveyor.querySelectorAll(".ss-ring");
    for (var i = 0; i < old.length; i++) {
      (function (el) {
        el.classList.remove("is-entering");
        el.classList.add("is-leaving");
        setTimeout(function () {
          if (el.parentNode) el.parentNode.removeChild(el);
        }, 900);
      })(old[i]);
    }
  }

  function padRingForCenter(ring) {
    if (!ring) return;
    var pad = Math.max(24, Math.floor(ring.clientWidth / 2 - 36));
    ring.style.paddingLeft = pad + "px";
    ring.style.paddingRight = pad + "px";
  }

  function setCenterIndex(index, opts) {
    opts = opts || {};
    if (!state.items.length) return;
    var i = Math.max(0, Math.min(state.items.length - 1, index | 0));
    state.centerIndex = i;
    state.items.forEach(function (it, j) {
      if (it.el) it.el.classList.toggle("is-center", j === i);
    });
    var item = state.items[i];
    var label = $("ss-current-label");
    if (label) {
      if (!item) label.textContent = "Scroll the belt — center is current";
      else if (item.status === "done") {
        var srcBits = (item.sources || [])
          .map(hydrateSource)
          .filter(Boolean)
          .map(function (s) {
            return sourceLabel(s);
          });
        label.textContent =
          "Current: " +
          (i + 1) +
          "/" +
          state.items.length +
          (srcBits.length ? " · " + srcBits.join(" + ") : "");
      } else if (item.waitingCredits) {
        label.textContent =
          "Current: " + (i + 1) + " waiting on credits $…";
      } else if (item.status === "err") {
        label.textContent = "Current: " + (i + 1) + " failed — " + (item.error || "");
      } else {
        label.textContent =
          "Current: " + (i + 1) + "/" + state.items.length + " (loading…)";
      }
    }
    if (opts.scroll && state.ringEl && item && item.el) {
      scrollCellToCenter(item.el, opts.instant);
    }
  }

  function scrollCellToCenter(el, instant) {
    var ring = state.ringEl;
    if (!ring || !el) return;
    var ringRect = ring.getBoundingClientRect();
    var elRect = el.getBoundingClientRect();
    var delta =
      elRect.left + elRect.width / 2 - (ringRect.left + ringRect.width / 2);
    var next = ring.scrollLeft + delta;
    if (instant) ring.scrollLeft = next;
    else ring.scrollTo({ left: next, behavior: "smooth" });
  }

  function nearestCenterIndex() {
    var ring = state.ringEl;
    if (!ring || !state.items.length) return 0;
    var ringRect = ring.getBoundingClientRect();
    var mid = ringRect.left + ringRect.width / 2;
    var best = 0;
    var bestD = Infinity;
    for (var i = 0; i < state.items.length; i++) {
      var el = state.items[i].el;
      if (!el) continue;
      var r = el.getBoundingClientRect();
      var d = Math.abs(r.left + r.width / 2 - mid);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  function bindRingScroll(ring) {
    if (!ring || ring._ssScrollBound) return;
    ring._ssScrollBound = true;
    var ticking = false;
    ring.addEventListener(
      "scroll",
      function () {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(function () {
          ticking = false;
          setCenterIndex(nearestCenterIndex(), { scroll: false });
        });
      },
      { passive: true }
    );
  }

  function renderCells(items) {
    var ring = ensureRing();
    if (!ring) return;
    ring.innerHTML = "";
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ss-cell is-pending";
      btn.setAttribute("role", "listitem");
      btn.dataset.index = String(i);
      btn.innerHTML =
        '<div class="ss-cell-inner"></div><span class="ss-cell-label">' +
        (i + 1) +
        "</span>";
      item.el = btn;
      (function (it) {
        btn.addEventListener("click", function () {
          setCenterIndex(it.index, { scroll: true });
          openLightboxAt(it.index);
        });
      })(item);
      ring.appendChild(btn);
    }
    padRingForCenter(ring);
    requestAnimationFrame(function () {
      padRingForCenter(ring);
      setCenterIndex(0, { scroll: true, instant: true });
    });
  }

  function updateCell(item) {
    if (!item.el) return;
    item.el.classList.remove("is-pending", "is-err", "is-credits");
    var inner = item.el.querySelector(".ss-cell-inner");
    if (!inner) return;
    if (item.status === "credits" || item.waitingCredits) {
      item.el.classList.add("is-credits", "is-pending");
      item.el.title = item.error || "Waiting for credits…";
      return;
    }
    if (item.status === "err") {
      item.el.classList.add("is-err");
      item.el.title = item.error || "Failed";
      return;
    }
    if (item.url) {
      inner.innerHTML =
        '<img src="' +
        escapeHtml(item.url) +
        '" alt="Shop vision ' +
        (item.index + 1) +
        '" loading="lazy" />';
      item.el.title = "Click · ←→ · " + (item.promptSent ? "has prompt" : "");
    }
  }

  function openLightboxAt(index) {
    if (!state.items.length) return;
    var i = Math.max(0, Math.min(state.items.length - 1, index | 0));
    state.lightboxIndex = i;
    setCenterIndex(i, { scroll: true });
    var item = state.items[i];
    var lb = $("ss-lightbox");
    var img = $("ss-lightbox-img");
    var idxEl = $("ss-lightbox-index");
    var promptEl = $("ss-lightbox-prompt");
    if (!lb || !img) return;
    if (item.url) {
      img.src = item.url;
      img.hidden = false;
    } else {
      img.removeAttribute("src");
      img.hidden = true;
    }
    if (idxEl) {
      idxEl.textContent =
        "Image " +
        (i + 1) +
        " / " +
        state.items.length +
        " · " +
        (item.status || "…");
    }
    if (promptEl) {
      promptEl.value =
        item.promptSent ||
        (item.status === "pending" ? buildShopPrompt(item) : "") ||
        (item.error ? "Error: " + item.error : "(no prompt yet)");
    }
    lb.hidden = false;
    updateNavButtons();
  }

  function updateNavButtons() {
    var prev = $("ss-lightbox-prev");
    var next = $("ss-lightbox-next");
    var i = state.lightboxIndex;
    var n = state.items.length;
    if (prev) prev.disabled = i <= 0;
    if (next) next.disabled = i < 0 || i >= n - 1;
  }

  function lightboxStep(delta) {
    if (!state.items.length) return;
    var base =
      state.lightboxIndex >= 0 ? state.lightboxIndex : state.centerIndex;
    var next = base + delta;
    if (next < 0 || next >= state.items.length) return;
    var lb = $("ss-lightbox");
    if (lb && !lb.hidden) openLightboxAt(next);
    else setCenterIndex(next, { scroll: true });
  }

  function closeLightbox() {
    var lb = $("ss-lightbox");
    if (lb) lb.hidden = true;
    state.lightboxIndex = -1;
  }

  function copyLightboxPrompt() {
    var promptEl = $("ss-lightbox-prompt");
    var t = promptEl ? promptEl.value : "";
    if (!t) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(t).then(function () {
        setStatus("Prompt copied.", "ok");
      });
    }
  }

  function previewSample() {
    loadPool().then(function () {
      var sample = {
        index: 0,
        sources: pickSourcesForIndex(0),
        seed: randInt(1000, 99999),
      };
      var text = buildShopPrompt(sample);
      var promptEl = $("ss-lightbox-prompt");
      var idxEl = $("ss-lightbox-index");
      var img = $("ss-lightbox-img");
      var lb = $("ss-lightbox");
      if (img) {
        img.removeAttribute("src");
        img.hidden = true;
      }
      if (idxEl) idxEl.textContent = "Sample shop prompt (not generated)";
      if (promptEl) promptEl.value = text;
      if (lb) {
        lb.hidden = false;
        state.lightboxIndex = -1;
        updateNavButtons();
      }
      setStatus("Sample prompt ready.", "ok");
    });
  }

  function renderChips() {
    var host = $("ss-chips");
    if (!host) return;
    host.innerHTML = "";
    state.colors.forEach(function (c, colorIndex) {
      c._pendingHex = c._pendingHex || c.hex;
      var wrap = document.createElement("div");
      wrap.className = "ss-chip-wrap";
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ss-chip";
      var swatch = document.createElement("span");
      swatch.className = "ss-chip-swatch";
      var labelSpan = document.createElement("span");
      labelSpan.className = "ss-chip-label";
      var input = document.createElement("input");
      input.type = "color";
      input.value = c.hex;
      var applyBtn = document.createElement("button");
      applyBtn.type = "button";
      applyBtn.className = "ss-chip-apply btn-secondary";
      applyBtn.textContent = "Apply";
      applyBtn.disabled = true;

      function paint(hex, name) {
        var h = normalizeHex(hex) || "#888888";
        var n = name || titleCaseColorName(hexToNearestName(h));
        swatch.style.backgroundColor = h;
        labelSpan.textContent = n + " (" + h + ")";
        btn.style.borderColor = h;
        input.value = h;
      }

      function syncPending() {
        var h = normalizeHex(input.value);
        if (!h) return;
        c._pendingHex = h;
        paint(h, titleCaseColorName(hexToNearestName(h)));
        wrap.classList.add("is-dirty");
        applyBtn.disabled = false;
        applyBtn.textContent =
          "Apply " + titleCaseColorName(hexToNearestName(h));
      }

      function apply() {
        var h = normalizeHex(c._pendingHex || input.value || c.hex);
        if (!h) return;
        var n = titleCaseColorName(hexToNearestName(h));
        c.hex = h;
        c.name = n;
        c._pendingHex = h;
        paint(h, n);
        wrap.classList.remove("is-dirty");
        applyBtn.textContent = "Applied";
        applyBtn.disabled = true;
        setStatus("Color lock: " + n + " (" + h + ")", "ok");
        setTimeout(function () {
          if (applyBtn.textContent === "Applied") applyBtn.textContent = "Apply";
        }, 1000);
      }

      paint(c.hex, c.name);
      btn.appendChild(swatch);
      btn.appendChild(labelSpan);
      btn.appendChild(input);
      wrap.appendChild(btn);
      wrap.appendChild(applyBtn);
      btn.addEventListener("click", function () {
        input.click();
      });
      input.addEventListener("input", syncPending);
      input.addEventListener("change", syncPending);
      input.addEventListener("click", function (e) {
        e.stopPropagation();
      });
      applyBtn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        apply();
      });
      host.appendChild(wrap);
      void colorIndex;
    });
  }

  function startCast() {
    if (state.casting) {
      setStatus("Already casting — wait or scroll the belt.", "err");
      return;
    }
    if (state.animating) {
      setStatus("Animate-all is running — wait for it to finish.", "err");
      return;
    }
    var castBtn = $("ss-cast");
    var animBtn = $("ss-animate-all");
    state.casting = true;
    state.done = 0;
    state.failed = 0;
    state.usedUrls = {};
    state.usedSpellKeys = {};
    state.castId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID().slice(0, 8)
        : String(Date.now()).slice(-8);
    if (castBtn) castBtn.disabled = true;
    if (animBtn) animBtn.disabled = true;

    setStatus("Loading paintings + generated pool…");
    setProgress(0, CAST_SIZE, "Cast");

    loadPool()
      .then(function () {
        if (state.pool.length < 2) {
          throw new Error("Need at least 2 spell sources (paintings or generated).");
        }
        conveyorOutOld();
        var items = [];
        for (var i = 0; i < CAST_SIZE; i++) {
          items.push({
            index: i,
            sources: pickSourcesForIndex(i),
            seed: randInt(1000, 99999),
            url: "",
            status: "pending",
            error: "",
            el: null,
            waitingCredits: false,
            _counted: false,
            _softRetry: false,
            videoUrl: "",
          });
        }
        state.items = items;
        setStatus("Loading text for picked sources…");
        return prefetchGeneratedTexts(items).then(function () {
          // hydrate sources now that generated/N.json may be cached
          items.forEach(function (it) {
            it.sources = (it.sources || []).map(hydrateSource).filter(Boolean);
          });
          renderCells(items);
          setStatus("Casting 35 shop visions (paintings + generated)…");
          return runPool(items);
        });
      })
      .then(function () {
        var ok = state.items.filter(function (it) {
          return it.status === "done";
        }).length;
        setStatus(
          "Shop stocked — " +
            ok +
            "/" +
            CAST_SIZE +
            " ready" +
            (state.failed ? " · " + state.failed + " failed" : "") +
            ". Animate all when ready.",
          ok ? "ok" : "err"
        );
      })
      .catch(function (err) {
        setStatus((err && err.message) || String(err), "err");
      })
      .finally(function () {
        state.casting = false;
        if (castBtn) castBtn.disabled = false;
        if (animBtn) animBtn.disabled = false;
        var wrap = $("ss-progress");
        if (wrap) {
          setTimeout(function () {
            wrap.classList.remove("is-on");
          }, 2000);
        }
      });
  }

  function animateOne(item) {
    if (!item.url) return Promise.reject(new Error("No still"));
    var stasis = clipText(item.promptSent || buildShopPrompt(item), 2000);
    function attempt() {
      return fetch(apiUrl("/api/animate-cast"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wait: false,
          wait_for_result: false,
          stasis: stasis,
          prompt: stasis,
          duration: 10,
          resolution: "720p",
          aspect_ratio: getAspectRatio(),
          image_url: item.url,
          reference_image: item.url,
        }),
        cache: "no-store",
      })
        .then(function (r) {
          return r.json().then(function (d) {
            return { ok: r.ok, d: d };
          });
        })
        .then(function (res) {
          var d = res.d || {};
          var errMsg =
            (d.error && d.error.message) ||
            (typeof d.error === "string" ? d.error : "") ||
            "";
          if (!res.ok && isCreditsError(errMsg)) {
            throw Object.assign(new Error(errMsg || "Out of credits"), {
              credits: true,
            });
          }
          if (!res.ok) throw new Error(errMsg || "Animate failed");
          var jid = d.job_id || d.id;
          if (jid) return pollJob(jid);
          if (d.video && d.video.url) return d.video.url;
          throw new Error("No video job");
        });
    }

    function loop() {
      return attempt().catch(function (err) {
        if (err && (err.credits || isCreditsError(err.message))) {
          floatDollar(item);
          setStatus(
            "Credits low on animate slot " +
              (item.index + 1) +
              " — retrying…",
            "err"
          );
          return sleep(CREDITS_RETRY_MS).then(loop);
        }
        throw err;
      });
    }

    return loop().then(function (url) {
      item.videoUrl = url;
      return url;
    });
  }

  function animateAll() {
    if (state.animating || state.casting) {
      setStatus("Busy — wait for the current job.", "err");
      return;
    }
    var ready = state.items.filter(function (it) {
      return it.status === "done" && it.url;
    });
    if (!ready.length) {
      setStatus("Cast 35 images first, then animate all.", "err");
      return;
    }
    state.animating = true;
    var animBtn = $("ss-animate-all");
    var castBtn = $("ss-cast");
    if (animBtn) animBtn.disabled = true;
    if (castBtn) castBtn.disabled = true;
    var done = 0;
    setProgress(0, ready.length, "Animate");
    setStatus("Animating " + ready.length + " shop stills…");

    var chain = Promise.resolve();
    ready.forEach(function (item) {
      chain = chain.then(function () {
        return animateOne(item)
          .catch(function (err) {
            item.videoError = (err && err.message) || String(err);
          })
          .then(function () {
            done++;
            setProgress(done, ready.length, "Animate");
            setStatus("Animate-all… " + done + "/" + ready.length);
          });
      });
    });

    chain
      .then(function () {
        var ok = ready.filter(function (it) {
          return it.videoUrl;
        }).length;
        setStatus(
          "Animate-all done — " + ok + "/" + ready.length + " videos.",
          ok ? "ok" : "err"
        );
      })
      .finally(function () {
        state.animating = false;
        if (animBtn) animBtn.disabled = false;
        if (castBtn) castBtn.disabled = false;
        var wrap = $("ss-progress");
        if (wrap) {
          setTimeout(function () {
            wrap.classList.remove("is-on");
          }, 2500);
        }
      });
  }

  function onShow() {
    state.active = true;
    setStatus("Spell Shop — cast 35 from paintings + generated, then animate all.");
    var meta = $("ss-pool-meta");
    if (meta && !state.poolReady) meta.textContent = "Loading spell pool…";
    loadPool().catch(function (err) {
      setStatus((err && err.message) || "Pool load failed", "err");
    });
  }

  function onHide() {
    state.active = false;
    closeLightbox();
  }

  function bind() {
    if (!$("panel-spellshop")) return;
    renderChips();

    var castBtn = $("ss-cast");
    if (castBtn) castBtn.addEventListener("click", startCast);
    var animBtn = $("ss-animate-all");
    if (animBtn) animBtn.addEventListener("click", animateAll);
    var rebuild = $("ss-prompt-rebuild");
    if (rebuild) rebuild.addEventListener("click", previewSample);
    var copyBtn = $("ss-lightbox-copy");
    if (copyBtn) copyBtn.addEventListener("click", copyLightboxPrompt);
    var prevBtn = $("ss-lightbox-prev");
    var nextBtn = $("ss-lightbox-next");
    if (prevBtn) {
      prevBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        lightboxStep(-1);
      });
    }
    if (nextBtn) {
      nextBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        lightboxStep(1);
      });
    }
    var lb = $("ss-lightbox");
    var close = $("ss-lightbox-close");
    if (close) close.addEventListener("click", closeLightbox);
    if (lb) {
      lb.addEventListener("click", function (e) {
        if (e.target === lb) closeLightbox();
      });
    }
    document.addEventListener("keydown", function (e) {
      if (!state.active) return;
      var open = lb && !lb.hidden;
      if (e.key === "Escape" && open) {
        e.preventDefault();
        closeLightbox();
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        lightboxStep(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        lightboxStep(1);
      }
    });
    window.addEventListener("resize", function () {
      if (state.ringEl) {
        padRingForCenter(state.ringEl);
        setCenterIndex(state.centerIndex, { scroll: true, instant: true });
      }
    });
    window.addEventListener("tab-changed", function (e) {
      if (e.detail && e.detail.tab === "spellshop") onShow();
      else onHide();
    });
    if (location.hash.replace("#", "") === "spellshop") onShow();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }

  window.SpellShop = {
    cast: startCast,
    animateAll: animateAll,
    onShow: onShow,
    onHide: onHide,
  };
})();
