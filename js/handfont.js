(function () {
  "use strict";

  var LS_KEY = "logan-handfont-v1";
  var LS_SITE = "logan-handfont-site-v1";
  var EXPORT_VERSION = 1;
  var GLYPH_GROUPS = [
    { id: "upper", kind: "letters", label: "A–Z", chars: "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("") },
    { id: "lower", kind: "letters", label: "a–z", chars: "abcdefghijklmnopqrstuvwxyz".split("") },
    { id: "digits", kind: "numbers", label: "0–9", chars: "0123456789".split("") },
    { id: "punct", kind: "symbols", label: "Punctuation", chars: [".", ",", "!", "?", ";", ":", "'", '"', "-", "(", ")"] },
    {
      id: "symbols",
      kind: "symbols",
      label: "Symbols",
      chars: ["=", "@", "%", "^", "*", "_", "<", ">", "[", "]", "{", "}", "\\", "|", "/", "`", "~", "+", "#", "$", "&"],
    },
  ];
  var GLYPHS = GLYPH_GROUPS.reduce(function (all, group) {
    return all.concat(group.chars);
  }, []);
  var REQUIRED_GLYPHS = GLYPHS.slice();
  var GLYPH_NAMES = {
    " ": "Space",
    "=": "equals",
    "@": "at",
    "%": "percent",
    "^": "caret",
    "*": "asterisk",
    _: "underscore",
    "<": "less than",
    ">": "greater than",
    "[": "left bracket",
    "]": "right bracket",
    "{": "left brace",
    "}": "right brace",
    "\\": "backslash",
    "|": "pipe",
    "/": "slash",
    "`": "backtick",
    "~": "tilde",
    "+": "plus",
    "-": "hyphen",
    "#": "hash",
    $: "dollar",
    "&": "ampersand",
    ".": "period",
    ",": "comma",
    "!": "exclamation",
    "?": "question",
    ";": "semicolon",
    ":": "colon",
    "'": "apostrophe",
    '"': "quote",
    "(": "left paren",
    ")": "right paren",
  };
  var SITE_SKIP_SELECTOR =
    "#panel-handfont,.hf-site-text,.hf-site-original,script,style,noscript,canvas,svg,img,video,audio,input,textarea,select,option,[contenteditable='true'],[data-hf-skip]";
  var drawCanvas;
  var previewCanvas;
  var drawCtx;
  var previewCtx;
  var drawSize = { w: 720, h: 720, dpr: 1 };
  var previewSize = { w: 1100, h: 620, dpr: 1 };
  var activeStroke = null;
  var drawing = false;
  var eraseChanged = false;
  var animation = null;
  var lastLayout = null;
  var siteObserver = null;
  var siteRenderQueued = false;
  var siteRendering = false;

  var state = {
    current: "A",
    mode: "draw",
    ink: "#f7ead0",
    brush: 10,
    showGuide: true,
    showTrace: true,
    useGlyphColors: false,
    previewText: "Logan writes with hand motion.\n1000 Paintings Challenge",
    size: 72,
    tracking: 6,
    line: 116,
    speed: 220,
    weight: 1,
    highlight: false,
    highlightColor: "#ffe566",
    fitPage: true,
    glyphFilter: "all",
    siteActive: false,
    glyphs: {},
  };

  function $(id) {
    return document.getElementById(id);
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function currentGlyph() {
    if (!state.glyphs[state.current]) {
      state.glyphs[state.current] = { char: state.current, advance: 0.7, strokes: [] };
    }
    return state.glyphs[state.current];
  }

  function getGlyph(ch) {
    return state.glyphs[ch] || null;
  }

  function glyphIsDrawn(ch) {
    var glyph = getGlyph(ch);
    return !!(
      glyph &&
      Array.isArray(glyph.strokes) &&
      glyph.strokes.some(function (stroke) {
        return stroke && Array.isArray(stroke.points) && stroke.points.length > 0;
      })
    );
  }

  function missingGlyphs() {
    return REQUIRED_GLYPHS.filter(function (ch) {
      return !glyphIsDrawn(ch);
    });
  }

  function fontIsComplete() {
    return missingGlyphs().length === 0;
  }

  function updateSiteToggle() {
    var toggle = $("hf-site-toggle");
    var count = $("hf-completion-count");
    var missing = $("hf-missing-glyphs");
    var remaining = missingGlyphs();
    var complete = remaining.length === 0;
    if (toggle) {
      toggle.disabled = !complete;
      toggle.checked = state.siteActive && complete;
    }
    if (count) {
      count.textContent =
        complete
          ? "Ready: " + REQUIRED_GLYPHS.length + "/" + REQUIRED_GLYPHS.length + " glyphs drawn"
          : REQUIRED_GLYPHS.length - remaining.length + "/" + REQUIRED_GLYPHS.length + " glyphs drawn";
    }
    if (missing) {
      missing.textContent = complete
        ? "Whole-site handwriting is unlocked."
        : "Missing: " + remaining.slice(0, 18).map(printable).join(" ") + (remaining.length > 18 ? " +" + (remaining.length - 18) : "");
    }
    if (!complete && state.siteActive) {
      setSiteActive(false, true);
    }
  }

  function setStatus(text) {
    var el = $("hf-status");
    if (el) el.textContent = text;
  }

  var saveTimer = null;
  var IDB_NAME = "logan-handfont";
  var IDB_STORE = "font";

  function roundN(n, places) {
    var m = Math.pow(10, places);
    return Math.round(Number(n) * m) / m;
  }

  function compactPayload(payload) {
    var glyphs = {};
    Object.keys(payload.glyphs || {}).forEach(function (ch) {
      var g = payload.glyphs[ch] || {};
      glyphs[ch] = {
        char: ch,
        advance: g.advance,
        sourceAspect: g.sourceAspect,
        strokes: (g.strokes || []).map(function (stroke) {
          return {
            color: stroke.color,
            size: stroke.size,
            points: (stroke.points || []).map(function (p) {
              return {
                x: roundN(p.x, 4),
                y: roundN(p.y, 4),
                p: roundN(p.p == null ? 1 : p.p, 2),
              };
            }),
          };
        }),
      };
    });
    var out = {};
    Object.keys(payload).forEach(function (key) {
      out[key] = payload[key];
    });
    out.glyphs = glyphs;
    return out;
  }

  function idbOpen() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) {
        reject(new Error("no idb"));
        return;
      }
      var req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = function () {
        if (!req.result.objectStoreNames.contains(IDB_STORE)) {
          req.result.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = function () {
        resolve(req.result);
      };
      req.onerror = function () {
        reject(req.error);
      };
    });
  }

  function idbPut(payload) {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(IDB_STORE, "readwrite");
        tx.objectStore(IDB_STORE).put(payload, "current");
        tx.oncomplete = function () {
          resolve(true);
        };
        tx.onerror = function () {
          reject(tx.error);
        };
      });
    });
  }

  function idbGet() {
    return idbOpen()
      .then(function (db) {
        return new Promise(function (resolve, reject) {
          var tx = db.transaction(IDB_STORE, "readonly");
          var req = tx.objectStore(IDB_STORE).get("current");
          req.onsuccess = function () {
            resolve(req.result || null);
          };
          req.onerror = function () {
            reject(req.error);
          };
        });
      })
      .catch(function () {
        return null;
      });
  }

  function saveToServer(payload) {
    return fetch("/api/handfont", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(function (res) {
        return res.ok;
      })
      .catch(function () {
        return false;
      });
  }

  function readLocalStorageFont() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      return null;
    }
  }

  function pickNewestFont(candidates) {
    var best = null;
    candidates.forEach(function (payload) {
      if (!payload || !payload.glyphs || typeof payload.glyphs !== "object") return;
      if (!Object.keys(payload.glyphs).length && best) return;
      if (!best) {
        best = payload;
        return;
      }
      if (String(payload.savedAt || "") > String(best.savedAt || "")) best = payload;
    });
    return best;
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      saveLocal(true);
    }, 280);
  }

  function saveLocal(silent) {
    var payload = compactPayload(toPayload());
    var json = JSON.stringify(payload);
    var lsOk = false;
    try {
      localStorage.setItem(LS_KEY, json);
      lsOk = true;
    } catch (err) {
      try {
        localStorage.removeItem(LS_KEY);
        localStorage.setItem(LS_KEY, json);
        lsOk = true;
      } catch (err2) {
        lsOk = false;
      }
    }
    var idbP = idbPut(payload).then(
      function () {
        return true;
      },
      function () {
        return false;
      }
    );
    var serverP = saveToServer(payload);
    return Promise.all([idbP, serverP]).then(function (flags) {
      var idbOk = flags[0];
      var serverOk = flags[1];
      updateSiteToggle();
      if (state.siteActive) scheduleSiteRender();
      if (lsOk || idbOk || serverOk) {
        if (!silent) {
          setStatus(serverOk ? "Saved to this PC." : "Saved in the browser.");
        }
        return true;
      }
      setStatus("Save failed — click Export JSON so you do not lose the font.");
      return false;
    });
  }

  function loadLocal(silent) {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (!raw) {
        if (!silent) setStatus("No saved hand font yet.");
        return false;
      }
      applyPayload(JSON.parse(raw));
      if (!silent) setStatus("Loaded local hand font.");
      return true;
    } catch (err) {
      if (!silent) setStatus("Could not load saved hand font.");
      return false;
    }
  }

  function loadAll() {
    return Promise.all([
      Promise.resolve(readLocalStorageFont()),
      idbGet(),
      fetch("/api/handfont")
        .then(function (res) {
          return res.ok ? res.json() : { font: null };
        })
        .then(function (data) {
          return data && data.font ? data.font : null;
        })
        .catch(function () {
          return null;
        }),
    ]).then(function (found) {
      var best = pickNewestFont(found);
      if (!best) {
        setStatus("No saved hand font yet. It autosaves as you draw.");
        return false;
      }
      applyPayload(best);
      setStatus("Loaded saved hand font.");
      return true;
    });
  }

  function toPayload() {
    return {
      version: EXPORT_VERSION,
      type: "normalized-stroke-font",
      name: "Logan Hand Font",
      savedAt: new Date().toISOString(),
      units: "glyph box 0..1, stroke order preserved",
      requiredGlyphs: REQUIRED_GLYPHS,
      glyphs: state.glyphs,
      settings: {
        ink: state.ink,
        brush: state.brush,
        size: state.size,
        tracking: state.tracking,
        line: state.line,
        speed: state.speed,
        weight: state.weight,
        highlight: state.highlight,
        highlightColor: state.highlightColor,
        fitPage: state.fitPage,
        previewText: state.previewText,
      },
    };
  }

  function applyPayload(payload) {
    if (!payload || !payload.glyphs || typeof payload.glyphs !== "object") {
      throw new Error("Invalid hand font file");
    }
    state.glyphs = payload.glyphs;
    var settings = payload.settings || {};
    state.ink = settings.ink || state.ink;
    state.brush = Number(settings.brush || state.brush);
    state.size = Number(settings.size || state.size);
    state.tracking = Number(settings.tracking || state.tracking);
    state.line = Number(settings.line || state.line);
    state.speed = Number(settings.speed || state.speed);
    state.weight = Number(settings.weight != null ? settings.weight : state.weight);
    state.highlight = !!settings.highlight;
    state.highlightColor = settings.highlightColor || state.highlightColor;
    state.fitPage = settings.fitPage !== false;
    state.previewText = settings.previewText || state.previewText;
    normalizeGlyphs();
    syncControls();
    renderAll();
  }

  function normalizeGlyphs() {
    Object.keys(state.glyphs).forEach(function (ch) {
      var g = state.glyphs[ch] || {};
      if (!Array.isArray(g.strokes)) g.strokes = [];
      if (!Number.isFinite(Number(g.advance))) g.advance = 0.7;
      g.char = ch;
      g.strokes = g.strokes
        .filter(function (stroke) {
          return stroke && Array.isArray(stroke.points) && stroke.points.length;
        })
        .map(function (stroke) {
          return {
            color: stroke.color || state.ink,
            size: Number(stroke.size || state.brush),
            points: stroke.points
              .map(function (p) {
                return {
                  x: clamp(Number(p.x), 0, 1),
                  y: clamp(Number(p.y), 0, 1),
                  p: clamp(Number(p.p || 1), 0.15, 1),
                };
              })
              .filter(function (p) {
                return Number.isFinite(p.x) && Number.isFinite(p.y);
              }),
          };
        });
    });
  }

  function syncControls() {
    var charInput = $("hf-current-char");
    var ink = $("hf-ink");
    var brush = $("hf-brush");
    var width = $("hf-width");
    var guide = $("hf-show-guide");
    var trace = $("hf-show-trace");
    var text = $("hf-preview-text");
    var size = $("hf-size");
    var tracking = $("hf-tracking");
    var line = $("hf-line");
    var speed = $("hf-speed");
    var colors = $("hf-use-glyph-colors");
    var weight = $("hf-weight");
    var bold = $("hf-bold");
    var highlight = $("hf-highlight");
    var highlightColor = $("hf-highlight-color");
    var fit = $("hf-fit");
    if (charInput) charInput.value = state.current;
    if (ink) ink.value = state.ink;
    if (brush) brush.value = state.brush;
    if (width) width.value = Math.round(currentGlyph().advance * 100);
    if (guide) guide.checked = state.showGuide;
    if (trace) trace.checked = state.showTrace;
    if (text) text.value = state.previewText;
    if (size) size.value = state.size;
    if (tracking) tracking.value = state.tracking;
    if (line) line.value = state.line;
    if (speed) speed.value = state.speed;
    if (weight) weight.value = Math.round(state.weight * 100);
    if (bold) bold.checked = state.weight >= 1.55;
    if (highlight) highlight.checked = state.highlight;
    if (highlightColor) highlightColor.value = state.highlightColor;
    if (fit) fit.checked = state.fitPage;
    if (colors) colors.checked = state.useGlyphColors;
    updateLabels();
    updateSiteToggle();
  }

  function updateLabels() {
    var brush = $("hf-brush-label");
    var width = $("hf-width-label");
    var size = $("hf-size-label");
    var tracking = $("hf-tracking-label");
    var line = $("hf-line-label");
    var speed = $("hf-speed-label");
    var weight = $("hf-weight-label");
    var title = $("hf-board-title");
    var glyph = currentGlyph();
    if (brush) brush.textContent = String(state.brush);
    if (width) width.textContent = Math.round(glyph.advance * 100) + "%";
    if (size) size.textContent = String(state.size);
    if (tracking) tracking.textContent = Math.round(effectiveTrackingPct()) + "%";
    if (line) line.textContent = state.line + "%";
    if (speed) speed.textContent = String(state.speed);
    if (weight) weight.textContent = Math.round(state.weight * 100) + "%";
    if (title) title.textContent = "Glyph " + printable(state.current);
    var stateEl = $("hf-glyph-state");
    var countEl = $("hf-glyph-count");
    var count = glyph.strokes.length;
    if (stateEl) stateEl.textContent = count ? "Drawn" : "Empty";
    if (countEl) countEl.textContent = count + " stroke" + (count === 1 ? "" : "s");
  }

  function printable(ch) {
    if (ch === " ") return "Space";
    return ch;
  }

  function glyphName(ch) {
    return GLYPH_NAMES[ch] ? printable(ch) + " (" + GLYPH_NAMES[ch] + ")" : printable(ch);
  }

  function applyGlyphFilter() {
    var filter = state.glyphFilter || "all";
    document.querySelectorAll(".hf-glyph-filter").forEach(function (btn) {
      btn.classList.toggle("active", btn.dataset.hfGfilter === filter);
    });
    document.querySelectorAll(".hf-glyph-group").forEach(function (group) {
      var kind = group.dataset.kind || "letters";
      var show = filter === "all" || filter === kind;
      group.classList.toggle("is-hidden", !show);
    });
  }

  function buildGlyphGrid() {
    var grid = $("hf-glyph-grid");
    if (!grid) return;
    grid.innerHTML = "";
    GLYPH_GROUPS.forEach(function (group) {
      var section = document.createElement("div");
      section.className = "hf-glyph-group";
      section.dataset.kind = group.kind;
      section.dataset.group = group.id;
      var heading = document.createElement("h4");
      heading.textContent = group.label;
      var row = document.createElement("div");
      row.className = "hf-glyph-row";
      group.chars.forEach(function (ch) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "hf-glyph" + (group.kind === "symbols" ? " is-symbol" : "");
        btn.dataset.char = ch;
        btn.textContent = ch;
        btn.title = glyphName(ch);
        btn.setAttribute("aria-label", glyphName(ch));
        btn.addEventListener("click", function () {
          setCurrentChar(ch);
        });
        row.appendChild(btn);
      });
      section.appendChild(heading);
      section.appendChild(row);
      grid.appendChild(section);
    });
    applyGlyphFilter();
  }

  function updateGlyphGrid() {
    document.querySelectorAll(".hf-glyph").forEach(function (btn) {
      var ch = btn.dataset.char;
      var g = getGlyph(ch);
      btn.classList.toggle("active", ch === state.current);
      btn.classList.toggle("filled", !!(g && g.strokes && g.strokes.length));
    });
  }

  function setCurrentChar(ch) {
    if (!ch) return;
    state.current = String(ch).slice(0, 1);
    currentGlyph();
    syncControls();
    renderAll();
    scheduleSave();
  }

  function layoutDrawSquare() {
    if (!drawCanvas) return;
    var square = drawCanvas.parentElement;
    var wrap = square && square.classList.contains("hf-canvas-square") ? square.parentElement : square;
    if (!wrap) return;
    var rect = wrap.getBoundingClientRect();
    var side = Math.max(220, Math.floor(Math.min(rect.width, rect.height) - 4));
    if (square && square.classList.contains("hf-canvas-square")) {
      square.style.width = side + "px";
      square.style.height = side + "px";
      drawCanvas.style.width = "100%";
      drawCanvas.style.height = "100%";
    } else {
      drawCanvas.style.width = side + "px";
      drawCanvas.style.height = side + "px";
    }
  }

  function resizeCanvas(canvas, size) {
    var rect = canvas.getBoundingClientRect();
    var dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    var w = Math.max(240, Math.round(rect.width || canvas.clientWidth || canvas.width));
    var h = Math.max(180, Math.round(rect.height || canvas.clientHeight || canvas.height));
    if (canvas === drawCanvas) {
      w = h = Math.max(200, Math.min(w, h));
    }
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    size.w = w;
    size.h = h;
    size.dpr = dpr;
    var ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }

  function resizeAll() {
    layoutDrawSquare();
    if (drawCanvas) drawCtx = resizeCanvas(drawCanvas, drawSize);
    if (previewCanvas) previewCtx = resizeCanvas(previewCanvas, previewSize);
    renderAll();
  }

  function pointerPoint(e) {
    var rect = drawCanvas.getBoundingClientRect();
    var side = Math.max(1, Math.min(rect.width, rect.height));
    var left = rect.left + (rect.width - side) / 2;
    var top = rect.top + (rect.height - side) / 2;
    var x = clamp((e.clientX - left) / side, 0, 1);
    var y = clamp((e.clientY - top) / side, 0, 1);
    var pressure = Number(e.pressure || 0.7);
    return { x: x, y: y, p: clamp(pressure || 0.7, 0.2, 1) };
  }

  function pointDistance(a, b) {
    var dx = a.x - b.x;
    var dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function addPointToStroke(point) {
    if (!activeStroke) return;
    var pts = activeStroke.points;
    var last = pts[pts.length - 1];
    if (last && pointDistance(last, point) < 0.004) return;
    pts.push(point);
  }

  function beginPointer(e) {
    if (!drawCanvas) return;
    e.preventDefault();
    drawCanvas.setPointerCapture(e.pointerId);
    drawing = true;
    eraseChanged = false;
    var point = pointerPoint(e);
    if (state.mode === "erase") {
      eraseAt(point);
      renderAll();
      return;
    }
    activeStroke = {
      color: state.ink,
      size: state.brush,
      points: [point],
    };
    currentGlyph().sourceAspect = drawSize.w / Math.max(1, drawSize.h);
    currentGlyph().strokes.push(activeStroke);
    renderAll();
  }

  function movePointer(e) {
    if (!drawing) return;
    e.preventDefault();
    var point = pointerPoint(e);
    if (state.mode === "erase") {
      eraseAt(point);
      renderAll();
      return;
    }
    addPointToStroke(point);
    renderAll();
  }

  function endPointer(e) {
    if (!drawing) return;
    e.preventDefault();
    try {
      drawCanvas.releasePointerCapture(e.pointerId);
    } catch (err) {}
    drawing = false;
    if (activeStroke && activeStroke.points.length === 1) {
      var p = activeStroke.points[0];
      activeStroke.points.push({ x: clamp(p.x + 0.001, 0, 1), y: p.y, p: p.p });
    }
    activeStroke = null;
    if (state.mode === "draw" || eraseChanged) {
      scheduleSave();
    }
    renderAll();
  }

  function eraseAt(point) {
    var glyph = currentGlyph();
    var threshold = (state.brush / Math.min(drawSize.w, drawSize.h)) * 1.4;
    var before = glyph.strokes.length;
    glyph.strokes = glyph.strokes.filter(function (stroke) {
      return !stroke.points.some(function (p) {
        return pointDistance(p, point) <= threshold;
      });
    });
    if (glyph.strokes.length !== before) eraseChanged = true;
  }

  function drawGuides(ctx, size) {
    ctx.save();
    ctx.clearRect(0, 0, size.w, size.h);
    ctx.fillStyle = "#081012";
    ctx.fillRect(0, 0, size.w, size.h);
    if (state.showTrace) {
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = "#f7ead0";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = "700 " + Math.round(size.h * 0.74) + "px Georgia, serif";
      ctx.fillText(state.current, size.w * 0.5, size.h * 0.53);
      ctx.globalAlpha = 1;
    }
    if (state.showGuide) {
      var lines = [
        { y: 0.12, color: "rgba(127, 213, 204, 0.18)" },
        { y: 0.32, color: "rgba(127, 213, 204, 0.22)" },
        { y: 0.76, color: "rgba(250, 220, 142, 0.34)" },
        { y: 0.9, color: "rgba(127, 213, 204, 0.18)" },
      ];
      ctx.lineWidth = 1;
      lines.forEach(function (line) {
        ctx.strokeStyle = line.color;
        ctx.beginPath();
        ctx.moveTo(size.w * 0.08, size.h * line.y);
        ctx.lineTo(size.w * 0.92, size.h * line.y);
        ctx.stroke();
      });
      ctx.strokeStyle = "rgba(214, 180, 94, 0.24)";
      ctx.setLineDash([5, 8]);
      ctx.beginPath();
      ctx.moveTo(size.w * 0.15, size.h * 0.08);
      ctx.lineTo(size.w * 0.15, size.h * 0.92);
      ctx.moveTo(size.w * currentGlyph().advance, size.h * 0.08);
      ctx.lineTo(size.w * currentGlyph().advance, size.h * 0.92);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawStroke(ctx, stroke, box, options) {
    if (!stroke || !stroke.points || !stroke.points.length) return;
    var opts = options || {};
    var points = stroke.points;
    var limit = opts.limit == null ? points.length : clamp(opts.limit, 0, points.length);
    if (limit <= 0) return;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = opts.color || stroke.color || state.ink;
    var weight = opts.weight != null ? opts.weight : state.weight || 1;
    ctx.lineWidth =
      opts.lineWidth != null
        ? opts.lineWidth
        : Math.max(1, (opts.scale || 1) * (stroke.size || state.brush) * weight);
    ctx.beginPath();
    points.slice(0, Math.ceil(limit)).forEach(function (p, index) {
      var x = box.x + p.x * box.w;
      var y = box.y + p.y * box.h;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.restore();
  }

  function renderDrawBoard() {
    if (!drawCtx) return;
    drawGuides(drawCtx, drawSize);
    var glyph = currentGlyph();
    var box = { x: 0, y: 0, w: drawSize.w, h: drawSize.h };
    glyph.strokes.forEach(function (stroke) {
      drawStroke(drawCtx, stroke, box, { scale: drawSize.w / 720, weight: 1 });
    });
  }

  function glyphEmBox(item) {
    var em = item.h;
    return { x: item.x, y: item.y, w: em, h: em };
  }

  function pageStrokeWidth(stroke, fontPx) {
    var brush = Number(stroke && stroke.size != null ? stroke.size : state.brush) || 10;
    var weight = state.weight || 1;
    return Math.max(0.85, brush * (Math.max(12, fontPx) / 280) * weight);
  }

  function extraTrackingFromWeight(weight) {
    return Math.max(0, (Number(weight != null ? weight : state.weight) - 1) * 14);
  }

  function effectiveTrackingPct(base) {
    return Number(base != null ? base : state.tracking) + extraTrackingFromWeight(state.weight);
  }

  function charAdvance(ch, size) {
    var advance = ch === " " ? 0.42 : (getGlyph(ch) && getGlyph(ch).advance) || 0.7;
    return Math.max(size * 0.28, advance * size);
  }

  function wordWidth(word, size, tracking) {
    var w = 0;
    var i;
    for (i = 0; i < word.length; i += 1) {
      w += charAdvance(word[i], size);
      if (i < word.length - 1) w += tracking;
    }
    return w;
  }

  function tokenizeText(text) {
    var tokens = [];
    var str = String(text || "");
    var i = 0;
    while (i < str.length) {
      if (str[i] === "\n") {
        tokens.push({ type: "nl" });
        i += 1;
        continue;
      }
      if (/\s/.test(str[i])) {
        var j = i;
        while (j < str.length && str[j] !== "\n" && /\s/.test(str[j])) j += 1;
        tokens.push({ type: "space", text: str.slice(i, j) });
        i = j;
        continue;
      }
      var k = i;
      while (k < str.length && str[k] !== "\n" && !/\s/.test(str[k])) k += 1;
      tokens.push({ type: "word", text: str.slice(i, k) });
      i = k;
    }
    return tokens;
  }

  function layoutOverflows(layout, width) {
    var edge = width - (layout.margin || 12) + 0.5;
    return layout.placements.some(function (p) {
      return p.ch !== " " && p.x + p.w > edge;
    });
  }

  function layoutHandText(text, options) {
    var opts = options || {};
    var requested = Math.max(10, Number(opts.size || state.size));
    var canvasW = Number(opts.width);
    var canvasH = Number(opts.height || 0);
    var wrap = opts.wrap !== false && Number.isFinite(canvasW) && canvasW > 0;
    if (!Number.isFinite(canvasW) || canvasW <= 0) {
      canvasW = wrap ? previewSize.w || 800 : 80;
    }
    canvasW = Math.max(80, canvasW);
    var trackingPct = opts.trackingPct != null ? opts.trackingPct : effectiveTrackingPct();
    var linePct = opts.linePct != null ? opts.linePct : state.line;
    var tokens = tokenizeText(text);

    function layoutAt(fontSize) {
      var tracking = (Number(trackingPct) / 100) * fontSize;
      var lineHeight = fontSize * (Number(linePct) / 100);
      var margin = opts.margin != null ? opts.margin : Math.max(14, fontSize * 0.2);
      var limit = wrap ? canvasW - margin : Infinity;
      var x = margin;
      var y = margin;
      var usedX = x;
      var placements = [];
      var bands = [];

      function placeWord(word) {
        var w = wordWidth(word, fontSize, tracking);
        if (wrap && x > margin && x + w > limit) {
          x = margin;
          y += lineHeight;
        }
        var startX = x;
        var i;
        for (i = 0; i < word.length; i += 1) {
          var ch = word[i];
          var cw = charAdvance(ch, fontSize);
          placements.push({
            ch: ch,
            raw: ch,
            x: x,
            y: y,
            w: cw,
            h: fontSize,
            glyph: getGlyph(ch),
          });
          x += cw + tracking;
        }
        bands.push({ x: startX, y: y, w: Math.max(w, x - startX - tracking), h: fontSize });
        usedX = Math.max(usedX, x);
      }

      tokens.forEach(function (token) {
        if (token.type === "nl") {
          usedX = Math.max(usedX, x);
          x = margin;
          y += lineHeight;
          return;
        }
        if (token.type === "space") {
          if (x <= margin) return;
          var sw = charAdvance(" ", fontSize);
          if (wrap && x + sw > limit) {
            x = margin;
            y += lineHeight;
            return;
          }
          placements.push({ ch: " ", raw: " ", x: x, y: y, w: sw, h: fontSize, glyph: null });
          x += sw + tracking;
          usedX = Math.max(usedX, x);
          return;
        }
        placeWord(token.text);
      });

      return {
        placements: placements,
        bands: bands,
        margin: margin,
        lineHeight: lineHeight,
        size: fontSize,
        width: wrap ? canvasW : Math.ceil(usedX + margin),
        height: Math.ceil(y + fontSize + margin),
      };
    }

    var layout = layoutAt(requested);
    var shouldFit = !!(opts.fit != null ? opts.fit : state.fitPage) && canvasH > 40 && wrap;
    if (shouldFit && (layout.height > canvasH || layoutOverflows(layout, canvasW))) {
      var lo = 10;
      var hi = requested;
      var best = layoutAt(lo);
      var step;
      for (step = 0; step < 16; step += 1) {
        var mid = (lo + hi) / 2;
        var trial = layoutAt(mid);
        if (trial.height <= canvasH && !layoutOverflows(trial, canvasW)) {
          best = trial;
          lo = mid;
        } else {
          hi = mid;
        }
      }
      layout = best.height <= canvasH && !layoutOverflows(best, canvasW) ? best : layoutAt(lo);
    }
    layout.canvasWidth = canvasW;
    layout.canvasHeight = canvasH || layout.height;
    return layout;
  }

  function layoutText(text) {
    return layoutHandText(text, {
      size: state.size,
      width: previewSize.w,
      height: previewSize.h,
      fit: state.fitPage,
      trackingPct: effectiveTrackingPct(),
      linePct: state.line,
    });
  }

  function roundHighlight(ctx, x, y, w, h, r) {
    var rad = Math.min(r, w / 2, h / 2);
    if (ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, rad);
      ctx.fill();
      return;
    }
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
    ctx.fill();
  }

  function drawHighlightBands(ctx, layout) {
    if (!state.highlight || !layout || !layout.bands) return;
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = state.highlightColor || "#ffe566";
    layout.bands.forEach(function (band) {
      if (band.w < 2) return;
      var padX = band.h * 0.1;
      var top = band.y + band.h * 0.2;
      var h = band.h * 0.64;
      roundHighlight(ctx, band.x - padX, top, band.w + padX * 2, h, h * 0.28);
    });
    ctx.restore();
  }

  function renderPreview() {
    if (!previewCtx) return;
    previewCtx.save();
    previewCtx.clearRect(0, 0, previewSize.w, previewSize.h);
    previewCtx.fillStyle = "#081012";
    previewCtx.fillRect(0, 0, previewSize.w, previewSize.h);
    lastLayout = layoutText(state.previewText);
    drawHighlightBands(previewCtx, lastLayout);
    lastLayout.placements.forEach(function (item) {
      if (item.ch === " ") return;
      if (!item.glyph || !item.glyph.strokes.length) {
        previewCtx.save();
        previewCtx.globalAlpha = 0.22;
        previewCtx.fillStyle = "#f7ead0";
        previewCtx.font = Math.round(item.h * 0.86) + "px Georgia, serif";
        previewCtx.textBaseline = "top";
        previewCtx.fillText(item.ch, item.x, item.y + item.h * 0.06);
        previewCtx.restore();
        return;
      }
      item.glyph.strokes.forEach(function (stroke) {
        drawStroke(previewCtx, stroke, glyphEmBox(item), {
          lineWidth: pageStrokeWidth(stroke, item.h),
          color: state.useGlyphColors ? null : state.ink,
        });
      });
    });
    previewCtx.restore();
  }

  function buildMotionSegments() {
    var layout = layoutText(state.previewText);
    var segments = [];
    layout.placements.forEach(function (item) {
      if (!item.glyph || !item.glyph.strokes.length) return;
      var box = glyphEmBox(item);
      item.glyph.strokes.forEach(function (stroke) {
        for (var i = 1; i < stroke.points.length; i += 1) {
          var a = stroke.points[i - 1];
          var b = stroke.points[i];
          segments.push({
            x1: box.x + a.x * box.w,
            y1: box.y + a.y * box.h,
            x2: box.x + b.x * box.w,
            y2: box.y + b.y * box.h,
            color: state.useGlyphColors ? stroke.color || state.ink : state.ink,
            width: pageStrokeWidth(stroke, item.h),
          });
        }
      });
    });
    return { layout: layout, segments: segments };
  }

  function renderMotionFrame(plan, progress) {
    if (!previewCtx || !plan) return;
    previewCtx.save();
    previewCtx.clearRect(0, 0, previewSize.w, previewSize.h);
    previewCtx.fillStyle = "#081012";
    previewCtx.fillRect(0, 0, previewSize.w, previewSize.h);
    if (plan.layout) drawHighlightBands(previewCtx, plan.layout);
    var full = Math.floor(progress);
    var partial = progress - full;
    var cursor = null;
    for (var i = 0; i < plan.segments.length && i <= full; i += 1) {
      var seg = plan.segments[i];
      var endX = seg.x2;
      var endY = seg.y2;
      if (i === full && partial < 1) {
        endX = seg.x1 + (seg.x2 - seg.x1) * partial;
        endY = seg.y1 + (seg.y2 - seg.y1) * partial;
      }
      previewCtx.strokeStyle = seg.color;
      previewCtx.lineWidth = seg.width;
      previewCtx.lineCap = "round";
      previewCtx.lineJoin = "round";
      previewCtx.beginPath();
      previewCtx.moveTo(seg.x1, seg.y1);
      previewCtx.lineTo(endX, endY);
      previewCtx.stroke();
      cursor = { x: endX, y: endY };
    }
    if (cursor) {
      previewCtx.fillStyle = "#d9bb66";
      previewCtx.strokeStyle = "rgba(8, 16, 18, 0.75)";
      previewCtx.lineWidth = 2;
      previewCtx.beginPath();
      previewCtx.arc(cursor.x, cursor.y, 5, 0, Math.PI * 2);
      previewCtx.fill();
      previewCtx.stroke();
    }
    previewCtx.restore();
  }

  function mapSiteChar(ch) {
    var map = {
      " ": " ",
      "\u201c": '"',
      "\u201d": '"',
      "\u2018": "'",
      "\u2019": "'",
      "\u2013": "-",
      "\u2014": "-",
      "\u2212": "-",
      "\u2026": ".",
      "\u00b7": ".",
      "\u2022": "*",
    };
    return map[ch] || ch;
  }

  function collapseSiteText(raw) {
    var text = String(raw || "");
    if (!text.trim()) return "";
    var leading = /^\s/.test(text) ? " " : "";
    var trailing = /\s$/.test(text) ? " " : "";
    return leading + text.trim().replace(/\s+/g, " ") + trailing;
  }

  function handTextLayout(text, fontPx, maxWidth, trackingPct, linePct) {
    var mapped = String(text || "").split("").map(mapSiteChar).join("");
    return layoutHandText(mapped, {
      size: fontPx,
      width: maxWidth || 0,
      height: 0,
      wrap: !!maxWidth,
      fit: false,
      trackingPct: trackingPct,
      linePct: linePct,
      margin: Math.max(3, fontPx * 0.12),
    });
  }

  function drawHandText(ctx, layout, options) {
    var opts = options || {};
    ctx.save();
    ctx.clearRect(0, 0, layout.width, layout.height);
    if (opts.highlight) drawHighlightBands(ctx, layout);
    layout.placements.forEach(function (item) {
      if (item.ch === " ") return;
      if (item.glyph && item.glyph.strokes.length) {
        item.glyph.strokes.forEach(function (stroke) {
          drawStroke(ctx, stroke, glyphEmBox(item), {
            lineWidth: pageStrokeWidth(stroke, item.h),
            color: opts.useGlyphColors ? null : opts.color,
          });
        });
      } else {
        ctx.globalAlpha = 0.86;
        ctx.fillStyle = opts.color || state.ink;
        ctx.font = Math.round(item.h * 0.86) + "px Georgia, serif";
        ctx.textBaseline = "top";
        ctx.fillText(item.raw, item.x, item.y + item.h * 0.04);
        ctx.globalAlpha = 1;
      }
    });
    ctx.restore();
  }

  function renderHandTextCanvas(canvas, text, options) {
    var opts = options || {};
    var fontPx = Math.max(9, Number(opts.fontPx || 16));
    var maxWidth = opts.maxWidth || 0;
    var layout = handTextLayout(text, fontPx, maxWidth, opts.trackingPct ?? 5, opts.linePct ?? 118);
    var dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    canvas.width = Math.max(1, Math.round(layout.width * dpr));
    canvas.height = Math.max(1, Math.round(layout.height * dpr));
    canvas.style.width = opts.block ? "100%" : layout.width + "px";
    canvas.style.height = layout.height + "px";
    var ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawHandText(ctx, layout, { color: opts.color || state.ink, useGlyphColors: opts.useGlyphColors });
    return layout;
  }

  function isVisibleTextParent(parent) {
    if (!parent || parent.closest(SITE_SKIP_SELECTOR)) return false;
    if (parent.closest("[hidden]")) return false;
    var style = getComputedStyle(parent);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
    return true;
  }

  function shouldRenderBlock(parent, text) {
    if (!parent) return false;
    var tag = parent.tagName || "";
    var style = getComputedStyle(parent);
    var blockTags = /^(P|H1|H2|H3|H4|H5|H6|LI|DT|DD|FIGCAPTION|TH|TD)$/;
    var blockish = blockTags.test(tag) || style.display === "block" || style.display === "list-item";
    return blockish && parent.children.length === 0 && text.trim().length > 24;
  }

  function renderSiteWrapper(wrapper) {
    var parent = wrapper.parentElement;
    var canvas = wrapper.querySelector("canvas");
    var text = wrapper.dataset.hfText || "";
    if (!parent || !canvas || !text) return;
    var style = getComputedStyle(parent);
    var fontPx = parseFloat(style.fontSize) || 16;
    var block = wrapper.classList.contains("is-block");
    var maxWidth = block ? Math.max(80, parent.clientWidth || parent.getBoundingClientRect().width || 300) : 0;
    renderHandTextCanvas(canvas, text, {
      fontPx: fontPx,
      maxWidth: maxWidth,
      block: block,
      color: style.color || state.ink,
      trackingPct: effectiveTrackingPct(),
      linePct: Math.max(100, Math.min(150, state.line)),
    });
  }

  function replaceSiteTextNode(node) {
    var parent = node.parentElement;
    var text = collapseSiteText(node.nodeValue);
    if (!text || !isVisibleTextParent(parent)) return;
    var wrapper = document.createElement("span");
    var block = shouldRenderBlock(parent, text);
    wrapper.className = "hf-site-text" + (block ? " is-block" : "");
    wrapper.dataset.hfText = text;
    wrapper.setAttribute("aria-label", text);
    var original = document.createElement("span");
    original.className = "hf-site-original";
    original.textContent = text;
    var canvas = document.createElement("canvas");
    canvas.className = "hf-site-canvas";
    canvas.setAttribute("aria-hidden", "true");
    wrapper.appendChild(original);
    wrapper.appendChild(canvas);
    node.parentNode.replaceChild(wrapper, node);
    renderSiteWrapper(wrapper);
  }

  function restoreSiteFont() {
    siteRenderQueued = false;
    siteRendering = true;
    if (siteObserver) {
      siteObserver.disconnect();
      siteObserver = null;
    }
    document.querySelectorAll(".hf-site-text").forEach(function (wrapper) {
      var text = wrapper.dataset.hfText || wrapper.textContent || "";
      wrapper.replaceWith(document.createTextNode(text));
    });
    document.body.classList.remove("hf-site-active");
    siteRendering = false;
  }

  function renderSiteFont() {
    if (!state.siteActive || !fontIsComplete()) return;
    siteRenderQueued = false;
    siteRendering = true;
    if (siteObserver) siteObserver.disconnect();
    document.body.classList.add("hf-site-active");
    document.querySelectorAll(".hf-site-text").forEach(renderSiteWrapper);
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        if (!collapseSiteText(node.nodeValue)) return NodeFilter.FILTER_REJECT;
        return isVisibleTextParent(node.parentElement) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(replaceSiteTextNode);
    siteRendering = false;
    startSiteObserver();
  }

  function scheduleSiteRender() {
    if (!state.siteActive || !fontIsComplete() || siteRenderQueued) return;
    siteRenderQueued = true;
    requestAnimationFrame(renderSiteFont);
  }

  function startSiteObserver() {
    if (siteObserver || !state.siteActive) return;
    siteObserver = new MutationObserver(function () {
      if (siteRendering || !state.siteActive) return;
      scheduleSiteRender();
    });
    siteObserver.observe(document.body, { childList: true, characterData: true, subtree: true });
  }

  function loadSitePreference() {
    state.siteActive = localStorage.getItem(LS_SITE) === "1";
    if (state.siteActive && !fontIsComplete()) {
      state.siteActive = false;
      localStorage.setItem(LS_SITE, "0");
    }
    updateSiteToggle();
    if (state.siteActive) scheduleSiteRender();
  }

  function setSiteActive(on, silent) {
    if (on && !fontIsComplete()) {
      state.siteActive = false;
      localStorage.setItem(LS_SITE, "0");
      updateSiteToggle();
      if (!silent) setStatus("Finish every glyph before turning on whole-site handwriting.");
      return;
    }
    state.siteActive = !!on;
    localStorage.setItem(LS_SITE, state.siteActive ? "1" : "0");
    if (state.siteActive) {
      scheduleSiteRender();
      if (!silent) setStatus("Whole-site handwriting is on.");
    } else {
      restoreSiteFont();
      if (!silent) setStatus("Whole-site handwriting is off.");
    }
    updateSiteToggle();
  }

  function playMotion() {
    stopMotion(false);
    state.previewText = $("hf-preview-text") ? $("hf-preview-text").value : state.previewText;
    var plan = buildMotionSegments();
    if (!plan.segments.length) {
      renderPreview();
      setStatus("Draw at least one glyph used in the text.");
      return;
    }
    animation = {
      plan: plan,
      progress: 0,
      last: performance.now(),
      raf: 0,
    };
    function tick(now) {
      if (!animation) return;
      var dt = Math.min(80, now - animation.last);
      animation.last = now;
      animation.progress += (dt / 1000) * Number(state.speed);
      renderMotionFrame(animation.plan, animation.progress);
      if (animation.progress < animation.plan.segments.length) {
        animation.raf = requestAnimationFrame(tick);
      } else {
        animation = null;
        renderPreview();
      }
    }
    animation.raf = requestAnimationFrame(tick);
  }

  function stopMotion(redraw) {
    if (animation && animation.raf) cancelAnimationFrame(animation.raf);
    animation = null;
    if (redraw !== false) renderPreview();
  }

  function undoGlyph() {
    var glyph = currentGlyph();
    glyph.strokes.pop();
    scheduleSave();
    renderAll();
  }

  function clearGlyph() {
    currentGlyph().strokes = [];
    scheduleSave();
    renderAll();
  }

  function copyCase() {
    var ch = state.current;
    var target = ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase();
    if (!target || target === ch) return;
    var src = currentGlyph();
    state.glyphs[target] = JSON.parse(JSON.stringify(src));
    state.glyphs[target].char = target;
    scheduleSave();
    updateGlyphGrid();
    setStatus("Copied " + printable(ch) + " to " + printable(target) + ".");
  }

  function centerGlyph() {
    var glyph = currentGlyph();
    var points = [];
    glyph.strokes.forEach(function (stroke) {
      stroke.points.forEach(function (p) {
        points.push(p);
      });
    });
    if (!points.length) return;
    var minX = Math.min.apply(null, points.map(function (p) { return p.x; }));
    var maxX = Math.max.apply(null, points.map(function (p) { return p.x; }));
    var minY = Math.min.apply(null, points.map(function (p) { return p.y; }));
    var maxY = Math.max.apply(null, points.map(function (p) { return p.y; }));
    var cx = (minX + maxX) / 2;
    var cy = (minY + maxY) / 2;
    var dx = 0.5 - cx;
    var dy = 0.51 - cy;
    glyph.strokes.forEach(function (stroke) {
      stroke.points.forEach(function (p) {
        p.x = clamp(p.x + dx, 0, 1);
        p.y = clamp(p.y + dy, 0, 1);
      });
    });
    scheduleSave();
    renderAll();
  }

  function downloadText(filename, text, type) {
    var blob = new Blob([text], { type: type || "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
  }

  function exportJson() {
    downloadText("logan-hand-font.json", JSON.stringify(toPayload(), null, 2));
    setStatus("Exported hand font JSON.");
  }

  function exportMotionJson() {
    state.previewText = $("hf-preview-text") ? $("hf-preview-text").value : state.previewText;
    var plan = buildMotionSegments();
    var payload = {
      version: EXPORT_VERSION,
      type: "hand-motion-strokes",
      exportedAt: new Date().toISOString(),
      text: state.previewText,
      canvas: { width: previewSize.w, height: previewSize.h },
      settings: {
        size: state.size,
        tracking: state.tracking,
        line: state.line,
        speed: state.speed,
      },
      segments: plan.segments,
    };
    downloadText("logan-hand-motion.json", JSON.stringify(payload, null, 2));
    setStatus("Exported motion JSON.");
  }

  function downloadPng() {
    stopMotion(false);
    renderPreview();
    var a = document.createElement("a");
    a.href = previewCanvas.toDataURL("image/png");
    a.download = "logan-hand-font-preview.png";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setStatus("Downloaded preview PNG.");
  }

  function importJson(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        applyPayload(JSON.parse(String(reader.result || "")));
        saveLocal(true);
        setStatus("Imported hand font JSON.");
      } catch (err) {
        setStatus("Import failed.");
      }
    };
    reader.readAsText(file);
  }

  function resetAll() {
    if (!confirm("Reset the whole hand font?")) return;
    state.glyphs = {};
    currentGlyph();
    saveLocal(true);
    renderAll();
    setStatus("Reset hand font.");
  }

  function setMode(mode) {
    state.mode = mode;
    var draw = $("hf-mode-draw");
    var erase = $("hf-mode-erase");
    if (draw) draw.classList.toggle("active", mode === "draw");
    if (erase) erase.classList.toggle("active", mode === "erase");
  }

  function renderAll() {
    updateLabels();
    updateGlyphGrid();
    updateSiteToggle();
    renderDrawBoard();
    renderPreview();
  }

  function bindControls() {
    var charInput = $("hf-current-char");
    if (charInput) {
      charInput.addEventListener("input", function () {
        setCurrentChar(charInput.value || "A");
      });
    }
    document.querySelectorAll(".hf-glyph-filter").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.glyphFilter = btn.dataset.hfGfilter || "all";
        applyGlyphFilter();
      });
    });
    $("hf-mode-draw")?.addEventListener("click", function () { setMode("draw"); });
    $("hf-mode-erase")?.addEventListener("click", function () { setMode("erase"); });
    $("hf-ink")?.addEventListener("input", function (e) {
      state.ink = e.target.value;
      scheduleSave();
      renderPreview();
    });
    $("hf-brush")?.addEventListener("input", function (e) {
      state.brush = Number(e.target.value);
      updateLabels();
    });
    $("hf-width")?.addEventListener("input", function (e) {
      currentGlyph().advance = Number(e.target.value) / 100;
      scheduleSave();
      renderAll();
    });
    $("hf-show-guide")?.addEventListener("change", function (e) {
      state.showGuide = e.target.checked;
      renderDrawBoard();
    });
    $("hf-show-trace")?.addEventListener("change", function (e) {
      state.showTrace = e.target.checked;
      renderDrawBoard();
    });
    $("hf-use-glyph-colors")?.addEventListener("change", function (e) {
      state.useGlyphColors = e.target.checked;
      renderPreview();
    });
    $("hf-site-toggle")?.addEventListener("change", function (e) {
      setSiteActive(e.target.checked, false);
    });
    $("hf-preview-text")?.addEventListener("input", function (e) {
      state.previewText = e.target.value;
      scheduleSave();
      renderPreview();
    });
    $("hf-size")?.addEventListener("input", function (e) {
      state.size = Number(e.target.value);
      updateLabels();
      renderPreview();
    });
    $("hf-tracking")?.addEventListener("input", function (e) {
      state.tracking = Number(e.target.value);
      updateLabels();
      scheduleSave();
      renderPreview();
    });
    $("hf-line")?.addEventListener("input", function (e) {
      state.line = Number(e.target.value);
      updateLabels();
      renderPreview();
    });
    $("hf-speed")?.addEventListener("input", function (e) {
      state.speed = Number(e.target.value);
      updateLabels();
    });
    $("hf-weight")?.addEventListener("input", function (e) {
      state.weight = Math.max(0.6, Number(e.target.value) / 100);
      var bold = $("hf-bold");
      if (bold) bold.checked = state.weight >= 1.55;
      updateLabels();
      scheduleSave();
      renderPreview();
    });
    $("hf-bold")?.addEventListener("change", function (e) {
      state.weight = e.target.checked ? 1.85 : 1;
      var weight = $("hf-weight");
      if (weight) weight.value = Math.round(state.weight * 100);
      updateLabels();
      scheduleSave();
      renderPreview();
    });
    $("hf-highlight")?.addEventListener("change", function (e) {
      state.highlight = e.target.checked;
      scheduleSave();
      renderPreview();
    });
    $("hf-highlight-color")?.addEventListener("input", function (e) {
      state.highlightColor = e.target.value;
      scheduleSave();
      renderPreview();
    });
    $("hf-fit")?.addEventListener("change", function (e) {
      state.fitPage = e.target.checked;
      scheduleSave();
      renderPreview();
    });
    $("hf-undo")?.addEventListener("click", undoGlyph);
    $("hf-clear")?.addEventListener("click", clearGlyph);
    $("hf-copy-case")?.addEventListener("click", copyCase);
    $("hf-center-glyph")?.addEventListener("click", centerGlyph);
    $("hf-save")?.addEventListener("click", function () { saveLocal(false); });
    $("hf-load")?.addEventListener("click", function () { loadLocal(false); });
    $("hf-export")?.addEventListener("click", exportJson);
    $("hf-export-motion")?.addEventListener("click", exportMotionJson);
    $("hf-download-png")?.addEventListener("click", downloadPng);
    $("hf-render")?.addEventListener("click", function () {
      state.previewText = $("hf-preview-text") ? $("hf-preview-text").value : state.previewText;
      stopMotion(true);
      scheduleSave();
    });
    $("hf-play")?.addEventListener("click", playMotion);
    $("hf-stop")?.addEventListener("click", function () { stopMotion(true); });
    $("hf-reset")?.addEventListener("click", resetAll);
    $("hf-import")?.addEventListener("change", function (e) {
      importJson(e.target.files && e.target.files[0]);
      e.target.value = "";
    });
  }

  function bindCanvas() {
    drawCanvas = $("hf-draw-canvas");
    previewCanvas = $("hf-preview-canvas");
    if (!drawCanvas || !previewCanvas) return;
    drawCtx = drawCanvas.getContext("2d");
    previewCtx = previewCanvas.getContext("2d");
    drawCanvas.addEventListener("pointerdown", beginPointer);
    drawCanvas.addEventListener("pointermove", movePointer);
    drawCanvas.addEventListener("pointerup", endPointer);
    drawCanvas.addEventListener("pointercancel", endPointer);
    window.addEventListener("resize", function () {
      resizeAll();
      scheduleSiteRender();
    });
    window.addEventListener("tab-changed", function () {
      setTimeout(scheduleSiteRender, 0);
    });
    window.addEventListener("handfont-show", function () {
      setTimeout(resizeAll, 0);
      requestAnimationFrame(function () {
        resizeAll();
      });
    });
    window.addEventListener("handfont-hide", function () {
      stopMotion(true);
    });
  }

  function init() {
    if (!$("panel-handfont")) return;
    buildGlyphGrid();
    currentGlyph();
    bindCanvas();
    bindControls();
    loadSitePreference();
    loadAll().finally(function () {
      syncControls();
      resizeAll();
      window.dispatchEvent(new Event("handfont-ready"));
    });
    window.addEventListener("beforeunload", function () {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(compactPayload(toPayload())));
      } catch (err) {}
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.HandFont = {
    onShow: resizeAll,
    exportFont: toPayload,
    renderPreview: renderPreview,
  };
})();
