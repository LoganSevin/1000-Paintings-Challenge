/**
 * Plasma — interactive plasma ball on a stand + horizontal 35-image conveyor.
 * Spellforge-quality casts; unique per slot (no duplicate URLs).
 */
(function () {
  "use strict";

  var CAST_SIZE = 35;
  /** Sequential avoids twin images from concurrent identical API races */
  var PARALLEL = 1;
  var PROMPT_BODY_MAX = 2600;
  var TOTAL_PAINTINGS = 1000;
  var MAX_RETRIES = 2;

  var state = {
    active: false,
    casting: false,
    done: 0,
    failed: 0,
    castId: "",
    items: [],
    usedUrls: {},
    usedSpellKeys: {},
    ringEl: null,
    analyses: {},
    lightboxIndex: -1,
    centerIndex: 0,
    colors: [
      { name: "Violet", hex: "#A855F7" },
      { name: "Cyan", hex: "#06B6D4" },
      { name: "Magenta", hex: "#FF00AA" },
      { name: "Blue", hex: "#3B82F6" },
      { name: "White", hex: "#E0F2FE" },
      { name: "Lavender", hex: "#C084FC" },
    ],
    raf: 0,
    mouse: { x: 0.5, y: 0.42, inside: false },
    t: 0,
  };

  /** Saturated name→hex dictionary for nearest-name after picker changes */
  var COLOR_NAME_HEX = {
    pink: "#FF4FA3",
    magenta: "#FF00AA",
    fuchsia: "#FF00CC",
    purple: "#A855F7",
    violet: "#7C3AED",
    plum: "#9B2D8A",
    indigo: "#4338CA",
    blue: "#2563EB",
    sapphire: "#0B5FFF",
    cobalt: "#0047AB",
    electric: "#3B82F6",
    cyan: "#06B6D4",
    turquoise: "#14B8A6",
    teal: "#0D9488",
    green: "#16A34A",
    emerald: "#059669",
    lime: "#84CC16",
    mint: "#34D399",
    yellow: "#FACC15",
    gold: "#EAB308",
    amber: "#F59E0B",
    orange: "#F97316",
    coral: "#FF6B4A",
    peach: "#FFAB70",
    red: "#EF4444",
    scarlet: "#FF2400",
    crimson: "#DC143C",
    rose: "#F43F5E",
    burgundy: "#7F1D1D",
    maroon: "#9F1239",
    brown: "#92400E",
    tan: "#D2B48C",
    cream: "#FFF5E0",
    white: "#F8FAFC",
    plasma: "#E0F2FE",
    silver: "#C0C0C0",
    gray: "#6B7280",
    grey: "#6B7280",
    charcoal: "#374151",
    black: "#0A0A0C",
    navy: "#1E3A5F",
    lavender: "#C084FC",
    sky: "#38BDF8",
    azure: "#0080FF",
    arc: "#C084FC",
  };

  var VARIATION_HOOKS = [
    "camera tight on the glass sphere only",
    "wide shot of the desk orb in a dark room",
    "extreme macro of a single filament branch",
    "low angle looking up through the glass",
    "side profile of the sphere with base in frame",
    "top-down view into the electrode core",
    "filaments reaching toward a fingertip outside the glass",
    "purple-dominant arc storm inside the sphere",
    "cyan lightning web filling half the globe",
    "soft long-exposure glow trails of plasma",
    "dramatic chiaroscuro with one bright streamer",
    "misty room atmosphere around the glass ball",
    "reflections of neon on polished wood table",
    "filaments coiled like a magnetic cage",
    "broken-mirror refraction through thick glass",
    "silent storm — few thick violet bolts",
    "busy storm — dozens of hair-thin arcs",
    "warm electrode core with cool outer filaments",
    "almost black void with one white-hot streamer",
    "painterly oil-study of a plasma novelty lamp",
    "engraved-line illustration of electric tendrils",
    "impressionist dabs of light in a glass orb",
    "hyper-real product photo of a working plasma ball",
    "dreamlike surreal plasma fruit on a stem",
    "gothic candlelight mood with plasma instead of flame",
    "sci-fi lab specimen under a glass dome",
    "children's-room nightlight glow, soft edges",
    "museum display case, dramatic spot lighting",
    "rainy window reflections on the glass sphere",
    "sparks dancing to the beat of invisible music",
    "single filament like a lightning tree",
    "orb overflowing with color — glass barely contains it",
    "monochrome blue plasma study",
    "gold and magenta festival of arcs",
    "quiet idle mode — faint inner glow only",
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

  function setStatus(msg, kind) {
    var el = $("plasma-status");
    if (!el) return;
    el.textContent = msg || "";
    el.className =
      "plasma-status" +
      (kind === "err" ? " is-err" : kind === "ok" ? " is-ok" : "");
  }

  function setProgress(done, total) {
    var wrap = $("plasma-progress");
    var fill = $("plasma-progress-fill");
    var meta = $("plasma-progress-meta");
    if (!wrap || !fill) return;
    wrap.classList.toggle("is-on", total > 0 && state.casting);
    var pct = total ? Math.round((done / total) * 100) : 0;
    fill.style.width = pct + "%";
    if (meta) {
      meta.textContent =
        done +
        " / " +
        total +
        " images" +
        (state.failed ? " · " + state.failed + " failed" : "");
    }
  }

  function getAnalysis(n) {
    if (window.getGalleryAnalyses) {
      var all = window.getGalleryAnalyses() || {};
      return all[String(n)] || all[n] || state.analyses[String(n)] || null;
    }
    return state.analyses[String(n)] || state.analyses[n] || null;
  }

  function ensureAnalyses() {
    if (window.loadGalleryData) {
      return window
        .loadGalleryData()
        .then(function (data) {
          state.analyses = (data && data.analyses) || {};
          if (window.getGalleryAnalyses) {
            state.analyses = window.getGalleryAnalyses() || state.analyses;
          }
          return state.analyses;
        })
        .catch(function () {
          return fetchAnalysesFallback();
        });
    }
    if (window.getGalleryAnalyses) {
      state.analyses = window.getGalleryAnalyses() || {};
      if (Object.keys(state.analyses).length) {
        return Promise.resolve(state.analyses);
      }
    }
    return fetchAnalysesFallback();
  }

  function fetchAnalysesFallback() {
    return fetch("data/analyses.json", { cache: "no-store" })
      .then(function (r) {
        return r.ok ? r.json() : {};
      })
      .then(function (a) {
        state.analyses = a || {};
        return state.analyses;
      })
      .catch(function () {
        return {};
      });
  }

  function randInt(a, b) {
    return a + Math.floor(Math.random() * (b - a + 1));
  }

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  /** Unique spell combo per slot for this cast */
  function pickSpellsForIndex(index) {
    var tries = 0;
    while (tries++ < 80) {
      var count = 2 + (index % 2);
      var out = [];
      var set = {};
      while (out.length < count) {
        var n = randInt(1, TOTAL_PAINTINGS);
        if (set[n]) continue;
        set[n] = true;
        out.push(n);
      }
      out.sort(function (a, b) {
        return a - b;
      });
      var key = out.join("-");
      if (!state.usedSpellKeys[key]) {
        state.usedSpellKeys[key] = true;
        return out;
      }
    }
    // fallback: force unique with index offset
    var base = ((index * 37) % TOTAL_PAINTINGS) + 1;
    return [base, ((base + 113) % TOTAL_PAINTINGS) + 1];
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
    var keys = Object.keys(COLOR_NAME_HEX);
    for (var i = 0; i < keys.length; i++) {
      var name = keys[i];
      if (name === "grey") continue;
      if (COLOR_NAME_HEX[name] === h) return name;
      var ref = hexToRgb(COLOR_NAME_HEX[name]);
      if (!ref) continue;
      var dr = rgb.r - ref.r;
      var dg = rgb.g - ref.g;
      var db = rgb.b - ref.b;
      var d = dr * dr * 1.1 + dg * dg + db * db * 1.05;
      if (d < bestD) {
        bestD = d;
        best = name;
      }
    }
    return best;
  }

  function formatColorLabel(hex) {
    var h = normalizeHex(hex);
    if (!h) return "";
    return titleCaseColorName(hexToNearestName(h)) + " (" + h + ")";
  }

  function colorLocksLine() {
    return state.colors
      .map(function (c) {
        return c.name + " (" + c.hex + ")";
      })
      .join("; ");
  }

  function userPromptText() {
    var el = $("plasma-prompt");
    return el ? String(el.value || "").trim() : "";
  }

  function getAspectRatio() {
    var sel = $("plasma-aspect");
    var v = sel && sel.value ? String(sel.value) : "3:4";
    if (!/^\d+:\d+$/.test(v)) return "3:4";
    return v;
  }

  function rgbToHue(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    var max = Math.max(r, g, b);
    var min = Math.min(r, g, b);
    var d = max - min;
    if (d < 1e-6) return 210;
    var h = 0;
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
    return h;
  }

  function huesFromColorChips() {
    var hues = [];
    for (var i = 0; i < state.colors.length; i++) {
      var rgb = hexToRgb(state.colors[i].hex);
      if (!rgb) continue;
      hues.push(rgbToHue(rgb.r, rgb.g, rgb.b));
    }
    if (!hues.length) hues.push(210, 280, 190);
    return hues;
  }

  /**
   * Detect circular plasma rim in a generated image (center + radius in natural pixels).
   * Used so the photo's orb aligns with the animated glass circle — one orb, not inception.
   */
  function detectOrbRim(imageUrl) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.decoding = "async";
      img.onload = function () {
        try {
          var natW = img.naturalWidth || img.width;
          var natH = img.naturalHeight || img.height;
          if (!natW || !natH) {
            resolve(null);
            return;
          }
          var maxSide = 140;
          var scale = Math.min(1, maxSide / Math.max(natW, natH));
          var W = Math.max(40, Math.floor(natW * scale));
          var H = Math.max(40, Math.floor(natH * scale));
          var c = document.createElement("canvas");
          c.width = W;
          c.height = H;
          var ctx = c.getContext("2d", { willReadFrequently: true });
          ctx.drawImage(img, 0, 0, W, H);
          var data = ctx.getImageData(0, 0, W, H).data;
          var gray = new Float32Array(W * H);
          for (var i = 0; i < W * H; i++) {
            var o = i * 4;
            gray[i] = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
          }
          var edge = new Float32Array(W * H);
          for (var y = 1; y < H - 1; y++) {
            for (var x = 1; x < W - 1; x++) {
              var ix = y * W + x;
              var gx = gray[ix + 1] - gray[ix - 1];
              var gy = gray[ix + W] - gray[ix - W];
              edge[ix] = Math.sqrt(gx * gx + gy * gy);
            }
          }
          var minR = Math.min(W, H) * 0.16;
          var maxR = Math.min(W, H) * 0.49;
          var best = {
            score: -1,
            cx: W / 2,
            cy: H / 2,
            r: Math.min(W, H) * 0.38,
          };
          var stepC = 3;
          var stepR = 2;
          for (var cy = Math.floor(H * 0.18); cy < H * 0.82; cy += stepC) {
            for (var cx = Math.floor(W * 0.18); cx < W * 0.82; cx += stepC) {
              for (var r = minR; r <= maxR; r += stepR) {
                var sum = 0;
                var n = 0;
                var steps = Math.max(28, Math.floor(r * 2.2));
                for (var a = 0; a < steps; a++) {
                  var ang = (a / steps) * Math.PI * 2;
                  var px = Math.round(cx + Math.cos(ang) * r);
                  var py = Math.round(cy + Math.sin(ang) * r);
                  if (px < 1 || py < 1 || px >= W - 1 || py >= H - 1) continue;
                  sum += edge[py * W + px];
                  n++;
                }
                if (n < steps * 0.65) continue;
                var score = sum / n;
                score *= 1 + 0.2 * (r / maxR);
                var distC =
                  Math.hypot(cx - W / 2, cy - H / 2) / (Math.min(W, H) * 0.5);
                score *= 1 - 0.3 * Math.min(1, distC);
                if (score > best.score) {
                  best = { score: score, cx: cx, cy: cy, r: r };
                }
              }
            }
          }
          var inv = 1 / scale;
          resolve({
            cx: best.cx * inv,
            cy: best.cy * inv,
            r: Math.max(8, best.r * inv),
            w: natW,
            h: natH,
            score: best.score,
          });
        } catch (err) {
          resolve(null);
        }
      };
      img.onerror = function () {
        resolve(null);
      };
      // same-origin gallery paths work; data URLs work
      img.src = imageUrl;
    });
  }

  /** Position backdrop so detected glass rim matches the animated sphere (same size, same center). */
  function applyRimFitToBackdrop(imgEl, rim) {
    if (!imgEl) return;
    var wrap = imgEl.parentElement;
    if (!wrap) return;
    var D = wrap.clientWidth || wrap.offsetWidth || 168;
    if (!rim || !rim.r || rim.r < 4) {
      imgEl.classList.remove("is-rim-fit");
      imgEl.style.left = "0";
      imgEl.style.top = "0";
      imgEl.style.width = "100%";
      imgEl.style.height = "100%";
      imgEl.style.objectFit = "cover";
      imgEl.style.objectPosition = "center center";
      return;
    }
    // Map 2r in image → D display diameter (slight overscale so rim kisses glass edge)
    var s = (D / (2 * rim.r)) * 1.015;
    var w = rim.w * s;
    var h = rim.h * s;
    var left = D / 2 - rim.cx * s;
    var top = D / 2 - rim.cy * s;
    imgEl.classList.add("is-rim-fit");
    imgEl.style.objectFit = "fill";
    imgEl.style.objectPosition = "0 0";
    imgEl.style.width = w + "px";
    imgEl.style.height = h + "px";
    imgEl.style.left = left + "px";
    imgEl.style.top = top + "px";
  }

  function fitBackdropFromItem(item) {
    var img = $("plasma-orb-backdrop");
    if (!img || !item || !item.url) return;
    if (item.rim) {
      applyRimFitToBackdrop(img, item.rim);
      return;
    }
    detectOrbRim(item.url).then(function (rim) {
      item.rim = rim;
      // Only apply if still the center item
      if (state.items[state.centerIndex] === item) {
        applyRimFitToBackdrop(img, rim);
      }
    });
  }

  function buildPlasmaPrompt(item) {
    var artist =
      (window.GALLERY_AUTHOR && window.GALLERY_AUTHOR.author) || "Logan Sevin";
    var spells = item.spells || [];
    var hook =
      VARIATION_HOOKS[(item.index || 0) % VARIATION_HOOKS.length] ||
      "unique composition";
    var lines = [];
    var aspect = getAspectRatio();
    lines.push(
      "SINGLE PLASMA GLOBE — exactly ONE glass plasma ball (novelty desk lamp). " +
        "Not two orbs, not an orb inside another orb, not inception. " +
        "Inside: branching electric filaments from one central electrode only."
    );
    lines.push("Studio author: " + artist + ".");
    lines.push(
      "FRAMING (critical for overlay alignment): The glass sphere is LARGE and clearly " +
        "circular. Place the CENTER of the glass sphere at the CENTER of the image. " +
        "The sphere should fill most of the shorter image edge (rim nearly edge-to-edge). " +
        "Optional short stem + base may appear below but must not hide the full circular rim. " +
        "Aspect ratio " +
        aspect +
        "."
    );
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
      "Visually distinct filament pattern / lighting from other slots — still the same single-orb product."
    );
    lines.push("");
    lines.push("SOURCE SPELL DNA (mood / texture / motifs to fuse into filament colors & room):");
    for (var i = 0; i < spells.length; i++) {
      var n = spells[i];
      var a = getAnalysis(n) || {};
      var title = a.title || "Painting #" + n;
      var body = clipText(a.description || a.prompt || "", 380);
      lines.push("── SPELL " + (i + 1) + " (#" + n + " · " + title + ") ──");
      lines.push(body || "(visual DNA from painting #" + n + ")");
    }
    lines.push("");
    lines.push(
      "MERGE: Spell DNA recolors atmosphere and filament glow — subject remains one plasma globe."
    );
    lines.push(
      "FILAMENT / PLASMA COLORS (mandatory — paint arcs and glows with these exact pigments, not muddy greys): " +
        colorLocksLine() +
        "."
    );
    var extra = userPromptText();
    if (extra) {
      lines.push("");
      lines.push("ARTIST DIRECTION (follow closely): " + extra);
    }
    lines.push(
      "Output: one finished artwork at aspect " +
        aspect +
        ", cohesive, museum-quality brushwork."
    );
    if (item.retryNote) {
      lines.push("RETRY: " + item.retryNote);
    }
    return clipText(lines.join("\n"), PROMPT_BODY_MAX);
  }

  function pollJob(jobId, attemptsLeft) {
    if (attemptsLeft == null) attemptsLeft = 90;
    return new Promise(function (resolve, reject) {
      if (attemptsLeft <= 0) {
        reject(new Error("Timed out waiting for image"));
        return;
      }
      fetch(apiUrl("/api/jobs/" + encodeURIComponent(jobId)), {
        cache: "no-store",
      })
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
            reject(new Error("No image URL"));
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

  function normalizeUrl(url) {
    if (!url) return "";
    // strip query for dedupe; keep path
    return String(url).split("?")[0];
  }

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function requestImage(item) {
    var stasis = buildPlasmaPrompt(item);
    item.promptSent = stasis;
    var jobId =
      (typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : "plasma-" + Date.now() + "-" + item.index + "-" + Math.random().toString(36).slice(2, 9));
    var buzz = state.colors.map(function (c) {
      return c.name;
    });
    buzz = buzz.concat([
      "plasma ball",
      "glass globe",
      "electric filaments",
      "desk lamp stand",
      "slot-" + (item.index + 1),
      "seed-" + item.seed,
    ]);
    state.colors.forEach(function (c) {
      buzz.push(c.hex);
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
        spells: item.spells,
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
            throw new Error(
              "Bad server response (HTTP " + r.status + ") — is start_server.bat running?"
            );
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
        if (res.status === 202 || d.job_id) {
          return pollJob(d.job_id || jobId);
        }
        if (!res.ok) {
          throw new Error(errMsg || "Generate failed (HTTP " + res.status + ")");
        }
        var img = d.image || (d.images && d.images[0]);
        if (img && img.url) return String(img.url);
        if (d.job_id) return pollJob(d.job_id);
        throw new Error(errMsg || "No image returned");
      });
  }

  function generateOne(item) {
    var attempt = 0;

    function tryOnce() {
      attempt++;
      return requestImage(item).then(function (url) {
        var key = normalizeUrl(url);
        if (key && state.usedUrls[key]) {
          // Exact same file as another slot — force a unique retry
          if (attempt <= MAX_RETRIES) {
            item.retryNote =
              "previous result was a duplicate of another slot; invent a completely new camera and filament pattern";
            item.seed = randInt(10000, 99999);
            item.spells = pickSpellsForIndex(item.index * 100 + attempt);
            return sleep(400).then(tryOnce);
          }
        }
        if (key) state.usedUrls[key] = true;
        item.url = url;
        item.rim = null; // re-detect for this frame
        item.status = "done";
        updateCell(item);
        return url;
      });
    }

    return tryOnce()
      .catch(function (err) {
        if (attempt <= MAX_RETRIES) {
          item.retryNote =
            "recover from error: " +
            clipText((err && err.message) || "fail", 80) +
            "; new composition";
          item.seed = randInt(10000, 99999);
          item.spells = pickSpellsForIndex(item.index * 50 + attempt + 7);
          return sleep(800 + attempt * 400).then(tryOnce);
        }
        item.status = "err";
        item.error = (err && err.message) || String(err);
        state.failed++;
        updateCell(item);
        throw err;
      })
      .finally(function () {
        if (item.status === "done" || item.status === "err") {
          // only count once (retries shouldn't double-count)
          if (!item._counted) {
            item._counted = true;
            state.done++;
            setProgress(state.done, CAST_SIZE);
            setStatus(
              "Casting plasma visions… " +
                state.done +
                "/" +
                CAST_SIZE +
                (state.failed ? " (" + state.failed + " failed)" : "")
            );
          }
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
            // Stagger even sequential starts slightly after failures
            var delay = item.index === 0 ? 0 : 150;
            sleep(delay)
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
    var conveyor = $("plasma-conveyor");
    if (!conveyor) return null;
    var ring = document.createElement("div");
    ring.className = "plasma-ring is-entering";
    ring.setAttribute("role", "list");
    conveyor.appendChild(ring);
    state.ringEl = ring;
    bindRingScroll(ring);
    return ring;
  }

  function conveyorOutOld() {
    var conveyor = $("plasma-conveyor");
    if (!conveyor) return;
    var old = conveyor.querySelectorAll(".plasma-ring");
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

  function updateOrbBackdrop(item) {
    var img = $("plasma-orb-backdrop");
    if (!img) return;
    if (item && item.url && item.status === "done") {
      var cur = img.getAttribute("data-plasma-url") || "";
      if (cur !== item.url) {
        img.setAttribute("data-plasma-url", item.url);
        img.onload = function () {
          fitBackdropFromItem(item);
        };
        img.src = item.url;
      } else {
        fitBackdropFromItem(item);
      }
      img.hidden = false;
      img.alt =
        "Current vision " +
        ((item.index || 0) + 1) +
        " — rim-aligned to plasma glass";
    } else {
      img.onload = null;
      img.removeAttribute("src");
      img.removeAttribute("data-plasma-url");
      img.hidden = true;
      img.alt = "";
      img.classList.remove("is-rim-fit");
    }
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
    updateOrbBackdrop(item);
    var label = $("plasma-current-label");
    if (label) {
      if (!item) {
        label.textContent = "Scroll the belt — current image shows behind the orb";
      } else if (item.status === "done" && item.url) {
        label.textContent =
          "Behind orb: image " +
          (i + 1) +
          " / " +
          state.items.length +
          " · spells " +
          (item.spells || []).join(", ");
      } else if (item.status === "err") {
        label.textContent =
          "Behind orb: image " + (i + 1) + " failed — " + (item.error || "error");
      } else {
        label.textContent =
          "Behind orb: image " + (i + 1) + " / " + state.items.length + " (loading…)";
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
      elRect.left +
      elRect.width / 2 -
      (ringRect.left + ringRect.width / 2);
    var next = ring.scrollLeft + delta;
    if (instant) {
      ring.scrollLeft = next;
    } else {
      ring.scrollTo({ left: next, behavior: "smooth" });
    }
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
      var c = r.left + r.width / 2;
      var d = Math.abs(c - mid);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  function bindRingScroll(ring) {
    if (!ring || ring._plasmaScrollBound) return;
    ring._plasmaScrollBound = true;
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
      btn.className = "plasma-cell is-pending";
      btn.setAttribute("role", "listitem");
      btn.dataset.index = String(i);
      btn.setAttribute(
        "aria-label",
        "Plasma vision " + (i + 1) + " from spells " + item.spells.join(", ")
      );
      btn.innerHTML =
        '<span class="plasma-cell-label">' + (i + 1) + "</span>";
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
    item.el.classList.remove("is-pending", "is-err");
    if (item.status === "err") {
      item.el.classList.add("is-err");
      item.el.title = item.error || "Failed";
      item.el.innerHTML =
        '<span class="plasma-cell-label">' + (item.index + 1) + "</span>";
      return;
    }
    if (item.url) {
      item.el.innerHTML =
        '<img src="' +
        escapeHtml(item.url) +
        '" alt="Plasma vision ' +
        (item.index + 1) +
        '" loading="lazy" />' +
        '<span class="plasma-cell-label">' +
        (item.index + 1) +
        "</span>";
      item.el.title =
        "Spells " +
        item.spells.join(", ") +
        " · seed " +
        item.seed +
        " · click · ←→ in viewer";
      // If this is the centered slot, show it behind the plasma glass
      if (item.index === state.centerIndex) {
        updateOrbBackdrop(item);
      }
    }
  }

  function openLightboxAt(index) {
    if (!state.items.length) return;
    var i = Math.max(0, Math.min(state.items.length - 1, index | 0));
    state.lightboxIndex = i;
    setCenterIndex(i, { scroll: true });
    var item = state.items[i];
    var lb = $("plasma-lightbox");
    var img = $("plasma-lightbox-img");
    var idxEl = $("plasma-lightbox-index");
    var promptEl = $("plasma-lightbox-prompt");
    if (!lb || !img) return;

    if (item.url) {
      img.src = item.url;
      img.alt = "Plasma vision " + (i + 1);
      img.hidden = false;
    } else {
      img.removeAttribute("src");
      img.alt = item.error || "Not ready";
      img.hidden = true;
    }

    if (idxEl) {
      var st =
        item.status === "done"
          ? "ready"
          : item.status === "err"
            ? "failed"
            : "pending";
      idxEl.textContent =
        "Image " +
        (i + 1) +
        " / " +
        state.items.length +
        " · " +
        st +
        (item.spells && item.spells.length
          ? " · spells " + item.spells.join(", ")
          : "");
    }
    if (promptEl) {
      var p =
        item.promptSent ||
        (item.status === "pending" ? buildPlasmaPrompt(item) : "") ||
        (item.error ? "Error: " + item.error : "(no prompt yet)");
      promptEl.value = p;
    }
    lb.hidden = false;
    updateNavButtons();
  }

  function updateNavButtons() {
    var prev = $("plasma-lightbox-prev");
    var next = $("plasma-lightbox-next");
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
    var lb = $("plasma-lightbox");
    if (lb && !lb.hidden) {
      openLightboxAt(next);
    } else {
      setCenterIndex(next, { scroll: true });
    }
  }

  function closeLightbox() {
    var lb = $("plasma-lightbox");
    if (lb) lb.hidden = true;
    state.lightboxIndex = -1;
  }

  function copyLightboxPrompt() {
    var promptEl = $("plasma-lightbox-prompt");
    var t = promptEl ? promptEl.value : "";
    if (!t) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(t).then(
        function () {
          setStatus("Prompt copied.", "ok");
        },
        function () {
          promptEl.select();
        }
      );
    } else {
      promptEl.select();
    }
  }

  function previewSamplePrompt() {
    ensureAnalyses().then(function () {
      var sample = {
        index: 0,
        spells: pickSpellsForIndex(0),
        seed: randInt(1000, 99999),
        retryNote: "",
      };
      var text = buildPlasmaPrompt(sample);
      var promptEl = $("plasma-lightbox-prompt");
      var idxEl = $("plasma-lightbox-index");
      var img = $("plasma-lightbox-img");
      var lb = $("plasma-lightbox");
      if (img) {
        img.removeAttribute("src");
        img.hidden = true;
      }
      if (idxEl) {
        idxEl.textContent =
          "Sample prompt (not generated) · spells " + sample.spells.join(", ");
      }
      if (promptEl) promptEl.value = text;
      if (lb) {
        lb.hidden = false;
        state.lightboxIndex = -1;
        updateNavButtons();
      }
      setStatus("Sample slot prompt ready — edit cast prompt above, then cast.", "ok");
    });
  }

  function renderChips() {
    var host = $("plasma-chips");
    if (!host) return;
    host.innerHTML = "";
    state.colors.forEach(function (c, colorIndex) {
      // Pending pick before Apply (so name can rename to match hex)
      c._pendingHex = c._pendingHex || c.hex;

      var wrap = document.createElement("div");
      wrap.className = "plasma-chip-wrap";

      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "plasma-chip";
      btn.title = "Pick a color, then Apply to rename to Name (#HEX)";

      var swatch = document.createElement("span");
      swatch.className = "plasma-chip-swatch";
      swatch.setAttribute("aria-hidden", "true");

      var labelSpan = document.createElement("span");
      labelSpan.className = "plasma-chip-label";

      var input = document.createElement("input");
      input.type = "color";
      input.value = c.hex;
      input.setAttribute("aria-label", "Pick color for slot " + (colorIndex + 1));

      var applyBtn = document.createElement("button");
      applyBtn.type = "button";
      applyBtn.className = "plasma-chip-apply btn-secondary";
      applyBtn.textContent = "Apply";
      applyBtn.title =
        "Rename this chip to the nearest color name + hex (e.g. Scarlet (#FF2400))";

      function paintChip(hex, name) {
        var h = normalizeHex(hex) || "#888888";
        var n = name || titleCaseColorName(hexToNearestName(h));
        swatch.style.backgroundColor = h;
        labelSpan.textContent = n + " (" + h + ")";
        btn.style.borderColor = h;
        btn.style.boxShadow = "inset 0 0 0 1px " + h + "55";
        input.value = h;
      }

      function syncPendingFromPicker() {
        var h = normalizeHex(input.value);
        if (!h) return;
        c._pendingHex = h;
        // Preview: swatch + proposed name, mark dirty until Apply
        var proposed = titleCaseColorName(hexToNearestName(h));
        paintChip(h, proposed);
        wrap.classList.add("is-dirty");
        applyBtn.disabled = false;
        applyBtn.textContent = "Apply " + proposed;
      }

      function applyNameAndHex() {
        var h = normalizeHex(c._pendingHex || input.value || c.hex);
        if (!h) return;
        var n = titleCaseColorName(hexToNearestName(h));
        c.hex = h;
        c.name = n;
        c._pendingHex = h;
        paintChip(h, n);
        wrap.classList.remove("is-dirty");
        applyBtn.textContent = "Applied";
        applyBtn.disabled = true;
        if (typeof state._reseedFilamentColors === "function") {
          state._reseedFilamentColors();
        }
        setStatus(
          "Color lock set: " +
            n +
            " (" +
            h +
            ") — filaments + prompts use this pigment.",
          "ok"
        );
        setTimeout(function () {
          if (applyBtn.textContent === "Applied") {
            applyBtn.textContent = "Apply";
          }
        }, 1200);
      }

      paintChip(c.hex, c.name);
      applyBtn.disabled = true;

      btn.appendChild(swatch);
      btn.appendChild(labelSpan);
      btn.appendChild(input);
      wrap.appendChild(btn);
      wrap.appendChild(applyBtn);

      btn.addEventListener("click", function (e) {
        if (e.target === applyBtn) return;
        input.click();
      });
      input.addEventListener("input", function () {
        syncPendingFromPicker();
      });
      input.addEventListener("change", function () {
        // Native picker closed — still require Apply so name is intentional
        syncPendingFromPicker();
      });
      input.addEventListener("click", function (e) {
        e.stopPropagation();
      });
      applyBtn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        applyNameAndHex();
      });

      host.appendChild(wrap);
    });
  }

  function startCast() {
    if (state.casting) {
      setStatus("Already casting — play with the plasma ball below while it finishes.", "err");
      return;
    }
    var castBtn = $("plasma-cast");
    state.casting = true;
    state.done = 0;
    state.failed = 0;
    state.usedUrls = {};
    state.usedSpellKeys = {};
    state.castId =
      (typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID().slice(0, 8)
        : String(Date.now()).slice(-8));
    if (castBtn) castBtn.disabled = true;

    setStatus("Loading spellbook… preparing " + CAST_SIZE + " unique plasma visions…");
    setProgress(0, CAST_SIZE);

    ensureAnalyses()
      .then(function () {
        conveyorOutOld();
        var items = [];
        for (var i = 0; i < CAST_SIZE; i++) {
          items.push({
            index: i,
            spells: pickSpellsForIndex(i),
            seed: randInt(1000, 99999),
            url: "",
            status: "pending",
            error: "",
            el: null,
            retryNote: "",
            _counted: false,
          });
        }
        state.items = items;
        return sleep(100).then(function () {
          renderCells(items);
          setStatus(
            "Casting " +
              CAST_SIZE +
              " unique plasma visions — click any circle · ← → in viewer for prompts"
          );
          return runPool(items);
        });
      })
      .then(function () {
        var ok = state.items.filter(function (it) {
          return it.status === "done";
        }).length;
        setStatus(
          "Cast complete — " +
            ok +
            "/" +
            CAST_SIZE +
            " lit" +
            (state.failed ? " · " + state.failed + " failed" : "") +
            ". Click an image · ← → without closing · cast again for a new belt.",
          ok ? "ok" : "err"
        );
      })
      .catch(function (err) {
        setStatus((err && err.message) || String(err), "err");
      })
      .finally(function () {
        state.casting = false;
        if (castBtn) castBtn.disabled = false;
        var wrap = $("plasma-progress");
        if (wrap && state.done >= CAST_SIZE) {
          setTimeout(function () {
            wrap.classList.remove("is-on");
          }, 2000);
        }
      });
  }

  /* ---------- Accurate plasma ball on stand (canvas = glass sphere only) ---------- */
  function initOrb() {
    var canvas = $("plasma-canvas");
    if (!canvas) return;
    var ctx = canvas.getContext("2d");
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var filaments = [];
    var N = 36;

    function resize() {
      var rect = canvas.getBoundingClientRect();
      var w = Math.max(160, Math.floor(rect.width));
      var h = Math.max(160, Math.floor(rect.height));
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function seedFilaments() {
      filaments = [];
      var hues = huesFromColorChips();
      for (var i = 0; i < N; i++) {
        var baseHue = hues[i % hues.length];
        filaments.push({
          a0: (i / N) * Math.PI * 2 + Math.random() * 0.2,
          speed: 0.25 + Math.random() * 0.9,
          thick: 0.6 + Math.random() * 2.4,
          hue: baseHue + (Math.random() - 0.5) * 14,
          phase: Math.random() * Math.PI * 2,
          len: 0.55 + Math.random() * 0.4,
          branch: Math.random() > 0.55,
        });
      }
    }

    function reseedFilamentColors() {
      var hues = huesFromColorChips();
      if (!filaments.length) {
        seedFilaments();
        return;
      }
      for (var i = 0; i < filaments.length; i++) {
        var baseHue = hues[i % hues.length];
        filaments[i].hue = baseHue + (Math.random() - 0.5) * 10;
      }
    }
    state._reseedFilamentColors = reseedFilamentColors;

    function pointer(e) {
      var rect = canvas.getBoundingClientRect();
      var x = (e.clientX - rect.left) / rect.width;
      var y = (e.clientY - rect.top) / rect.height;
      state.mouse.x = Math.max(0, Math.min(1, x));
      state.mouse.y = Math.max(0, Math.min(1, y));
      state.mouse.inside = true;
    }

    canvas.addEventListener("pointermove", pointer);
    canvas.addEventListener("pointerdown", pointer);
    canvas.addEventListener("pointerenter", pointer);
    canvas.addEventListener("pointerleave", function () {
      state.mouse.inside = false;
    });
    canvas.addEventListener(
      "touchmove",
      function (e) {
        if (!e.touches || !e.touches[0]) return;
        pointer(e.touches[0]);
        e.preventDefault();
      },
      { passive: false }
    );

    function nse(t, s) {
      return (
        Math.sin(t * 1.3 + s) * 0.45 +
        Math.sin(t * 2.7 + s * 1.7) * 0.3 +
        Math.sin(t * 5.1 + s * 0.4) * 0.15
      );
    }

    function drawFilament(cx, cy, R, f, mx, my, pull, t) {
      var baseAng = f.a0 + t * 0.15 * f.speed + nse(t, f.phase) * 0.35;
      var reach = R * f.len * (0.85 + pull * 0.2);
      var tipX = cx + Math.cos(baseAng) * reach;
      var tipY = cy + Math.sin(baseAng) * reach;
      tipX = tipX * (1 - 0.62 * pull) + mx * (0.62 * pull);
      tipY = tipY * (1 - 0.62 * pull) + my * (0.62 * pull);
      // clamp tip inside sphere
      var dx = tipX - cx;
      var dy = tipY - cy;
      var d = Math.sqrt(dx * dx + dy * dy) || 1;
      if (d > R * 0.94) {
        tipX = cx + (dx / d) * R * 0.94;
        tipY = cy + (dy / d) * R * 0.94;
      }

      var steps = 18;
      var pts = [{ x: cx, y: cy }];
      for (var s = 1; s <= steps; s++) {
        var u = s / steps;
        var j =
          nse(t * 2.2 + f.phase, s * 0.55) * R * 0.07 * Math.sin(u * Math.PI);
        var px = cx + (tipX - cx) * u;
        var py = cy + (tipY - cy) * u;
        var nx = -(tipY - cy) / d;
        var ny = (tipX - cx) / d;
        pts.push({ x: px + nx * j, y: py + ny * j });
      }

      function strokePass(width, color, blur) {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.shadowColor = color;
        ctx.shadowBlur = blur;
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      var hue = f.hue + Math.sin(t + f.phase) * 18;
      var alpha = 0.28 + pull * 0.4;
      strokePass(
        f.thick * (1.1 + pull * 0.6),
        "hsla(" + hue + ", 100%, 62%, " + alpha + ")",
        14 + pull * 12
      );
      strokePass(
        Math.max(0.6, f.thick * 0.35),
        "rgba(240, 250, 255, " + (0.35 + pull * 0.4) + ")",
        0
      );

      // optional branch
      if (f.branch && pull > 0.2) {
        var mid = pts[Math.floor(pts.length * 0.55)];
        var bx = mid.x + nse(t, f.phase + 3) * R * 0.2;
        var by = mid.y + nse(t, f.phase + 5) * R * 0.2;
        ctx.beginPath();
        ctx.moveTo(mid.x, mid.y);
        ctx.quadraticCurveTo(
          mid.x + (bx - mid.x) * 0.5,
          mid.y + (by - mid.y) * 0.5 + 6,
          bx,
          by
        );
        ctx.strokeStyle = "hsla(" + (hue + 30) + ", 100%, 70%, " + alpha * 0.7 + ")";
        ctx.lineWidth = f.thick * 0.55;
        ctx.shadowBlur = 10;
        ctx.shadowColor = ctx.strokeStyle;
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
    }

    function draw() {
      if (!state.active) {
        state.raf = 0;
        return;
      }
      var w = canvas.clientWidth;
      var h = canvas.clientHeight;
      if (!w || !h) {
        state.raf = requestAnimationFrame(draw);
        return;
      }
      state.t += 0.016;
      var t = state.t;
      var cx = w / 2;
      var cy = h / 2;
      var R = Math.min(w, h) * 0.46;

      // Transparent clear so the center image under the canvas shows through the glass
      ctx.clearRect(0, 0, w, h);

      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.clip();

      // Light tinted glass gas — photo remains readable behind filaments
      var gas = ctx.createRadialGradient(cx, cy, R * 0.08, cx, cy, R);
      gas.addColorStop(0, "rgba(40, 90, 160, 0.18)");
      gas.addColorStop(0.45, "rgba(15, 35, 80, 0.28)");
      gas.addColorStop(0.82, "rgba(6, 14, 35, 0.42)");
      gas.addColorStop(1, "rgba(2, 6, 18, 0.55)");
      ctx.fillStyle = gas;
      ctx.fillRect(cx - R, cy - R, R * 2, R * 2);

      // Central electrode
      var core = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.16);
      core.addColorStop(0, "rgba(255, 255, 255, 0.98)");
      core.addColorStop(0.25, "rgba(180, 230, 255, 0.9)");
      core.addColorStop(0.55, "rgba(80, 140, 255, 0.45)");
      core.addColorStop(1, "rgba(20, 40, 100, 0)");
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.16, 0, Math.PI * 2);
      ctx.fill();
      // metal electrode nub
      ctx.fillStyle = "rgba(200, 210, 220, 0.9)";
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.045, 0, Math.PI * 2);
      ctx.fill();

      var mx = cx + (state.mouse.x - 0.5) * R * 1.85;
      var my = cy + (state.mouse.y - 0.5) * R * 1.85;
      var mdx = mx - cx;
      var mdy = my - cy;
      var md = Math.sqrt(mdx * mdx + mdy * mdy) || 1;
      if (md > R * 0.9) {
        mx = cx + (mdx / md) * R * 0.9;
        my = cy + (mdy / md) * R * 0.9;
      }
      var pull = state.mouse.inside ? 1 : 0.28;

      for (var i = 0; i < filaments.length; i++) {
        drawFilament(cx, cy, R, filaments[i], mx, my, pull, t);
      }

      // Touch hotspot
      if (state.mouse.inside) {
        var hot = ctx.createRadialGradient(mx, my, 0, mx, my, R * 0.2);
        hot.addColorStop(0, "rgba(255, 255, 255, 0.85)");
        hot.addColorStop(0.25, "rgba(180, 230, 255, 0.5)");
        hot.addColorStop(1, "rgba(80, 120, 255, 0)");
        ctx.fillStyle = hot;
        ctx.beginPath();
        ctx.arc(mx, my, R * 0.2, 0, Math.PI * 2);
        ctx.fill();
      }

      // Glass fresnel / thickness at edge
      var edge = ctx.createRadialGradient(cx, cy, R * 0.72, cx, cy, R);
      edge.addColorStop(0, "rgba(255,255,255,0)");
      edge.addColorStop(0.7, "rgba(140, 190, 255, 0.06)");
      edge.addColorStop(1, "rgba(200, 230, 255, 0.22)");
      ctx.fillStyle = edge;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();

      // Glass sphere outline + specular
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(200, 230, 255, 0.55)";
      ctx.lineWidth = 2.5;
      ctx.shadowColor = "rgba(100, 180, 255, 0.45)";
      ctx.shadowBlur = 12;
      ctx.stroke();
      ctx.shadowBlur = 0;

      ctx.beginPath();
      ctx.ellipse(
        cx - R * 0.28,
        cy - R * 0.32,
        R * 0.32,
        R * 0.14,
        -0.55,
        0,
        Math.PI * 2
      );
      ctx.fillStyle = "rgba(255, 255, 255, 0.12)";
      ctx.fill();

      // lower glass reflection
      ctx.beginPath();
      ctx.ellipse(
        cx + R * 0.15,
        cy + R * 0.45,
        R * 0.35,
        R * 0.1,
        0.2,
        0,
        Math.PI * 2
      );
      ctx.fillStyle = "rgba(120, 180, 255, 0.06)";
      ctx.fill();

      state.raf = requestAnimationFrame(draw);
    }

    resize();
    seedFilaments();
    window.addEventListener("resize", function () {
      if (state.active) resize();
    });

    state._orbStart = function () {
      resize();
      if (!state.raf) state.raf = requestAnimationFrame(draw);
    };
    state._orbStop = function () {
      if (state.raf) cancelAnimationFrame(state.raf);
      state.raf = 0;
    };
  }

  function onShow() {
    state.active = true;
    if (state._orbStart) state._orbStart();
    setStatus("Edit prompt & color chips, then cast 35. Open images with ← → for full prompts.");
  }

  function onHide() {
    state.active = false;
    if (state._orbStop) state._orbStop();
    closeLightbox();
  }

  function bind() {
    if (!$("panel-plasma")) return;
    initOrb();
    renderChips();

    var castBtn = $("plasma-cast");
    if (castBtn) castBtn.addEventListener("click", startCast);

    var rebuild = $("plasma-prompt-rebuild");
    if (rebuild) rebuild.addEventListener("click", previewSamplePrompt);

    var copyBtn = $("plasma-lightbox-copy");
    if (copyBtn) copyBtn.addEventListener("click", copyLightboxPrompt);

    var prevBtn = $("plasma-lightbox-prev");
    var nextBtn = $("plasma-lightbox-next");
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

    var lb = $("plasma-lightbox");
    var close = $("plasma-lightbox-close");
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
      var item = state.items[state.centerIndex];
      if (item && item.url) {
        fitBackdropFromItem(item);
      }
    });

    window.addEventListener("tab-changed", function (e) {
      if (e.detail && e.detail.tab === "plasma") onShow();
      else onHide();
    });
    window.addEventListener("plasma-hide", onHide);

    if (location.hash.replace("#", "") === "plasma") onShow();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }

  window.Plasma = {
    cast: startCast,
    onShow: onShow,
    onHide: onHide,
  };
})();
