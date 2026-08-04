/**
 * Stasis lure screen — the page becomes a hypnotic display driven by the
 * current vision and prompt, not browser chrome.
 */
(function () {
  var DEBOUNCE_MS = 80;
  var _timer = 0;
  var _lastKey = "";
  var _lureRoot = null;
  var _grainCache = "";

  var COLOR_MAP = {
    violet: [140, 90, 200],
    purple: [155, 126, 217],
    pink: [232, 121, 169],
    red: [200, 90, 90],
    orange: [230, 150, 80],
    gold: [210, 170, 60],
    green: [90, 180, 120],
    teal: [70, 160, 150],
    cyan: [80, 190, 210],
    blue: [90, 140, 220],
    cosmic: [100, 70, 160],
    nebula: [150, 90, 180],
    crystal: [180, 210, 240],
    ember: [240, 120, 50],
    lava: [220, 80, 30],
    ocean: [50, 110, 150],
    midnight: [40, 45, 90],
    neon: [120, 255, 200],
    hologram: [100, 220, 255],
    iridescent: [180, 200, 255],
    glow: [255, 220, 140],
    haze: [150, 145, 165],
    mist: [175, 180, 195],
    void: [45, 35, 65],
    dream: [160, 140, 220],
    sunset: [240, 140, 90],
    dawn: [255, 190, 140],
    dusk: [120, 80, 130],
    alien: [120, 220, 180],
    prism: [255, 120, 180],
    swirl: [160, 100, 200],
    glitch: [180, 60, 220],
  };

  function hashStr(s) {
    var h = 2166136261;
    s = String(s || "");
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function mixRgb(a, b, t) {
    return [
      Math.round(a[0] + (b[0] - a[0]) * t),
      Math.round(a[1] + (b[1] - a[1]) * t),
      Math.round(a[2] + (b[2] - a[2]) * t),
    ];
  }

  function lighten(rgb, n) {
    return [
      clamp(rgb[0] + n, 0, 255),
      clamp(rgb[1] + n, 0, 255),
      clamp(rgb[2] + n, 0, 255),
    ];
  }

  function darken(rgb, n) {
    return lighten(rgb, -n);
  }

  function rgbCss(rgb, alpha) {
    if (alpha == null) return "rgb(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ")";
    return "rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + "," + alpha + ")";
  }

  function seededRand(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function paletteFromBuzz(buzz, stasis) {
    if (window.StasisWalkFloor && window.StasisWalkFloor.paletteFromBuzz) {
      return window.StasisWalkFloor.paletteFromBuzz(buzz, stasis);
    }
    var text = (buzz || []).join(" ") + " " + (stasis || "");
    var lower = text.toLowerCase();
    var out = [];
    Object.keys(COLOR_MAP).forEach(function (k) {
      if (lower.indexOf(k) >= 0) out.push(COLOR_MAP[k].slice());
    });
    if (!out.length) {
      var h = hashStr(text || "stasis");
      out.push([(h % 80) + 50, ((h >> 8) % 70) + 40, ((h >> 16) % 90) + 60]);
    }
    return out;
  }

  function sampleVisionPalette(img) {
    if (!img || !img.complete || !img.naturalWidth) return [];
    if (!window.StasisWalkFloor || !window.StasisWalkFloor.sampleImageColor) return [];
    var pts = [
      [0.5, 0.5],
      [0.28, 0.32],
      [0.72, 0.28],
      [0.22, 0.68],
      [0.78, 0.72],
      [0.5, 0.14],
      [0.5, 0.86],
    ];
    var out = [];
    for (var i = 0; i < pts.length; i++) {
      out.push(window.StasisWalkFloor.sampleImageColor(img, pts[i][0], pts[i][1]).slice());
    }
    return out;
  }

  function buildPalette(opts) {
    var text = (opts.stasisText || "") + " " + (opts.extraPrompt || "");
    var buzzPalette = paletteFromBuzz(opts.buzz, opts.stasisText);
    var visionPalette = sampleVisionPalette(opts.visionImg);
    var keywordPalette = [];
    var lower = text.toLowerCase();
    Object.keys(COLOR_MAP).forEach(function (k) {
      if (lower.indexOf(k) >= 0) keywordPalette.push(COLOR_MAP[k].slice());
    });

    var accent =
      (visionPalette[0] && visionPalette[0].slice()) ||
      (keywordPalette[0] && keywordPalette[0].slice()) ||
      (buzzPalette[0] && buzzPalette[0].slice()) ||
      [120, 100, 160];
    var accent2 =
      (visionPalette[3] && visionPalette[3].slice()) ||
      (keywordPalette[1] && keywordPalette[1].slice()) ||
      (buzzPalette[1] && buzzPalette[1].slice()) ||
      lighten(accent, 45);
    var glow = mixRgb(accent, accent2, 0.5);
    var deep = darken(mixRgb(accent, [8, 6, 14], 0.88), 62);
    var bg = darken(mixRgb(deep, [4, 3, 8], 0.5), 8);
    var muted = mixRgb(lighten(deep, 85), lighten(accent, 60), 0.35);

    return { accent: accent, accent2: accent2, glow: glow, deep: deep, bg: bg, muted: muted };
  }

  function modeFromText(text) {
    var lower = String(text || "").toLowerCase();
    if (/crystal|ice|glass|facet|quartz/.test(lower)) return "crystal";
    if (/swirl|spiral|vortex|whirl|helix/.test(lower)) return "swirl";
    if (/glitch|digital|pixel|cyber|static/.test(lower)) return "glitch";
    if (/cosmic|star|nebula|space|galaxy|aurora|void/.test(lower)) return "cosmic";
    if (/ember|fire|flame|lava|magma|burn/.test(lower)) return "ember";
    if (/ocean|wave|water|aqua|rain/.test(lower)) return "ocean";
    if (/haze|fog|mist|cloud|dream|soft/.test(lower)) return "haze";
    if (/neon|synth|hologram|alien|pulse/.test(lower)) return "neon";
    return "lure";
  }

  function lureMotionFromText(text) {
    var h = hashStr(text);
    var lower = String(text || "").toLowerCase();
    var breathe = 7 + (h % 6);
    var drift = 36 + (h % 48);
    var bloom = 0.58 + (h % 20) / 100;
    if (/slow|gentle|dream|haze|mist|drift/.test(lower)) {
      breathe += 5;
      drift += 28;
      bloom -= 0.08;
    }
    if (/fast|rush|glitch|pulse|storm/.test(lower)) {
      breathe -= 2;
      drift -= 12;
      bloom += 0.12;
    }
    return {
      breathe: breathe + "s",
      drift: drift + "s",
      bloom: bloom.toFixed(2),
      driftX: ((h % 5) - 2) + "%",
      driftY: (((h >> 3) % 5) - 2) + "%",
    };
  }

  function buildVisionBackdrop(img) {
    if (!img || !img.complete || !img.naturalWidth) return "";
    try {
      var size = 640;
      var iw = img.naturalWidth;
      var ih = img.naturalHeight;
      var cover = Math.max(size / iw, size / ih) * 1.15;
      var dw = iw * cover;
      var dh = ih * cover;
      var sharp = document.createElement("canvas");
      sharp.width = size;
      sharp.height = size;
      var sctx = sharp.getContext("2d");
      sctx.drawImage(img, (size - dw) / 2, (size - dh) / 2, dw, dh);
      var soft = document.createElement("canvas");
      soft.width = 160;
      soft.height = 160;
      var softCtx = soft.getContext("2d");
      softCtx.drawImage(sharp, 0, 0, 160, 160);
      var out = document.createElement("canvas");
      out.width = size;
      out.height = size;
      var octx = out.getContext("2d");
      octx.drawImage(soft, 0, 0, size, size);
      octx.globalAlpha = 0.42;
      octx.drawImage(sharp, 0, 0, size, size);
      octx.globalAlpha = 1;
      return out.toDataURL("image/jpeg", 0.82);
    } catch (err) {
      return "";
    }
  }

  function buildFilmGrain(seed) {
    if (_grainCache) return _grainCache;
    var c = document.createElement("canvas");
    c.width = 200;
    c.height = 200;
    var ctx = c.getContext("2d");
    var id = ctx.createImageData(200, 200);
    var rand = seededRand(seed || 99);
    for (var i = 0; i < id.data.length; i += 4) {
      var v = (rand() * 255) | 0;
      id.data[i] = id.data[i + 1] = id.data[i + 2] = v;
      id.data[i + 3] = (10 + rand() * 22) | 0;
    }
    ctx.putImageData(id, 0, 0);
    _grainCache = c.toDataURL("image/png");
    return _grainCache;
  }

  function ensureLureRoot() {
    if (_lureRoot && _lureRoot.isConnected) return _lureRoot;
    _lureRoot = document.getElementById("stasis-lure-root");
    if (!_lureRoot) {
      _lureRoot = document.createElement("div");
      _lureRoot.id = "stasis-lure-root";
      _lureRoot.setAttribute("aria-hidden", "true");
      _lureRoot.innerHTML =
        '<div class="stasis-lure-vision"></div>' +
        '<div class="stasis-lure-bloom"></div>' +
        '<div class="stasis-lure-vignette"></div>' +
        '<div class="stasis-lure-grain"></div>' +
        '<div class="stasis-lure-chroma"></div>' +
        '<div class="stasis-lure-iris"></div>';
      document.body.insertBefore(_lureRoot, document.body.firstChild);
    }
    return _lureRoot;
  }

  function hideLureRoot() {
    if (_lureRoot) _lureRoot.hidden = true;
  }

  function updateLureLayers(assets, palette, motion, mode) {
    var root = ensureLureRoot();
    root.hidden = false;
    root.setAttribute("data-lure-mode", mode);
    var vision = root.querySelector(".stasis-lure-vision");
    var grain = root.querySelector(".stasis-lure-grain");
    if (vision) {
      if (assets.backdrop) {
        vision.style.backgroundImage = "url(" + assets.backdrop + ")";
        vision.classList.add("has-vision");
      } else {
        vision.style.backgroundImage = "";
        vision.classList.remove("has-vision");
      }
    }
    if (grain && assets.grain) {
      grain.style.backgroundImage = "url(" + assets.grain + ")";
    }
    var html = document.documentElement;
    html.style.setProperty("--sis-lure-breathe", motion.breathe);
    html.style.setProperty("--sis-lure-drift", motion.drift);
    html.style.setProperty("--sis-lure-bloom", motion.bloom);
    html.style.setProperty("--sis-lure-drift-x", motion.driftX);
    html.style.setProperty("--sis-lure-drift-y", motion.driftY);
    html.style.setProperty("--sis-lure-accent", rgbCss(palette.accent));
    html.style.setProperty("--sis-lure-glow", rgbCss(palette.glow));
    html.style.setProperty("--sis-lure-deep", rgbCss(palette.deep));
  }

  function applyVars(palette, mode, tab) {
    var root = document.documentElement;
    var body = document.body;
    var sets = [
      ["--sis-accent-rgb", palette.accent.join(", ")],
      ["--sis-accent2-rgb", palette.accent2.join(", ")],
      ["--sis-glow-rgb", palette.glow.join(", ")],
      ["--sis-deep-rgb", palette.deep.join(", ")],
      ["--sis-bg-rgb", palette.bg.join(", ")],
      ["--sis-muted-rgb", palette.muted.join(", ")],
      ["--sis-accent", rgbCss(palette.accent)],
      ["--sis-glow", rgbCss(palette.glow)],
      ["--accent", rgbCss(lighten(palette.accent, 18))],
      ["--accent-soft", rgbCss(palette.accent, 0.14)],
      ["--text-muted", rgbCss(palette.muted, 0.88)],
      ["--border", rgbCss(palette.glow, 0.14)],
    ];
    for (var i = 0; i < sets.length; i++) {
      root.style.setProperty(sets[i][0], sets[i][1]);
    }
    body.setAttribute("data-stasis-skin", mode);
    body.setAttribute("data-stasis-skin-active", "1");
    body.setAttribute("data-sis-tab", tab || "");
  }

  function clearSkin() {
    var root = document.documentElement;
    var props = [
      "--sis-accent-rgb",
      "--sis-accent2-rgb",
      "--sis-glow-rgb",
      "--sis-deep-rgb",
      "--sis-bg-rgb",
      "--sis-muted-rgb",
      "--sis-accent",
      "--sis-glow",
      "--sis-lure-breathe",
      "--sis-lure-drift",
      "--sis-lure-bloom",
      "--sis-lure-drift-x",
      "--sis-lure-drift-y",
      "--sis-lure-accent",
      "--sis-lure-glow",
      "--sis-lure-deep",
    ];
    for (var i = 0; i < props.length; i++) root.style.removeProperty(props[i]);
    document.body.removeAttribute("data-stasis-skin");
    document.body.removeAttribute("data-stasis-skin-active");
    document.body.removeAttribute("data-sis-tab");
    hideLureRoot();
    _lastKey = "";
  }

  function applyNow(opts) {
    opts = opts || {};
    var text = (opts.stasisText || "") + " " + (opts.extraPrompt || "");
    if (!text.trim() && !(opts.buzz && opts.buzz.length) && !opts.visionImg) {
      clearSkin();
      return;
    }
    var mode = modeFromText(text);
    var palette = buildPalette(opts);
    var motion = lureMotionFromText(text);
    var visionKey =
      opts.visionImg && opts.visionImg.src ? opts.visionImg.src.slice(-48) : "none";
    var key = mode + "|" + palette.accent.join(",") + "|" + visionKey;
    var tab = opts.activeTab || "";

    if (key !== _lastKey) {
      _lastKey = key;
      var assets = {
        backdrop: buildVisionBackdrop(opts.visionImg),
        grain: buildFilmGrain(hashStr(text)),
      };
      updateLureLayers(assets, palette, motion, mode);
      applyVars(palette, mode, tab);
    } else {
      applyVars(palette, mode, tab);
      ensureLureRoot().hidden = false;
    }
  }

  function apply(opts) {
    clearTimeout(_timer);
    _timer = setTimeout(function () {
      _timer = 0;
      applyNow(opts);
    }, DEBOUNCE_MS);
  }

  function activeTabFromHash() {
    var hash = (location.hash || "").replace("#", "");
    if (hash === "muralwalk" || hash === "spellforge") return hash;
    return "";
  }

  window.StasisInterfaceSkin = {
    apply: apply,
    applyNow: applyNow,
    clear: clearSkin,
    modeFromText: modeFromText,
  };

  window.addEventListener("spellforge-show", function () {
    document.body.setAttribute("data-sis-tab", "spellforge");
  });
  window.addEventListener("muralwalk-show", function () {
    document.body.setAttribute("data-sis-tab", "muralwalk");
  });
  window.addEventListener("spellforge-hide", function () {
    if (activeTabFromHash() !== "spellforge") document.body.removeAttribute("data-sis-tab");
  });
  window.addEventListener("muralwalk-hide", function () {
    if (activeTabFromHash() !== "muralwalk" && activeTabFromHash() !== "spellforge") {
      clearSkin();
    }
  });
})();