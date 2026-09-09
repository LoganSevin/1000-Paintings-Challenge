/**
 * Grand Exchange — RuneScape-style 8-slot offer UI + Banker 100 SIM market.
 */
(function () {
  "use strict";

  // Stable key — do not bump (legacy keys are still read once and rewritten here).
  var STORAGE = "gallery.grand-exchange";
  var STORAGE_LEGACY_KEYS = [
    "gallery.grand-exchange.v6",
    "gallery.grand-exchange.v5",
    "gallery.grand-exchange.v4",
    "gallery.grand-exchange.v3",
    "gallery.grand-exchange.v2",
    "gallery.grand-exchange.v1",
  ];
  var PLAYER_ID = 100;
  var MAX_SLOTS = 8;
  var NPC_TICK_MS = 1200;
  var GUIDE_BASE = 89;
  var PAINTING_TOTAL = 1000;
  /** Match Spellforge ID spaces */
  var GEN_BASE = 100000;
  var SKETCH_BASE = 200000;
  var INV_SKETCH_BASE = 300000;
  var NOTE_BASE = 400000;
  var COLOR_BASE = 500000;
  var NOTE_THUMB =
    "data:image/svg+xml," +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">' +
        '<rect width="64" height="64" rx="8" fill="#1e293b"/>' +
        '<rect x="14" y="12" width="36" height="40" rx="3" fill="#334155" stroke="#94a3b8" stroke-width="2"/>' +
        '<path d="M20 22h24M20 30h24M20 38h16" stroke="#e2e8f0" stroke-width="2.5" stroke-linecap="round"/>' +
      "</svg>"
    );

  var state = null;
  // NPC packs stay in memory only — never persist (was blowing localStorage).
  var npcRuntime = { inventory: {}, bank: {} };
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
  /** Live working thumbs (often data URLs) after Force load — memory only. */
  var thumbOverrides = {};
  var exchangeOpen = false;
  var worldKeys = Object.create(null);
  var worldRaf = 0;
  var worldLastTs = 0;
  var walkAcc = 0;
  var playerPos = { x: 48, y: 78 };
  var npcStates = [];
  var WORLD_W = 100;
  var WORLD_H = 100;
  var PLAYER_SPEED = 18; // % per second
  var WALK_XP_PER_LEVEL_CAP = 80;
  var COLLECT_XP = 25;
  var FORGE_XP = 80;
  var WALK_XP_STEP = 1;
  var WALK_DIST_PER_XP = 28; // percent-units walked per walk XP

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

  function noteOf(n) {
    n = Number(n);
    if (!state || !state.notes) return null;
    return state.notes[String(n)] || state.notes[n] || null;
  }

  function isNoteId(n) {
    n = Number(n);
    return !!noteOf(n) || (n > NOTE_BASE && n < NOTE_BASE + 100000);
  }

  var GE_COLOR_NAME_HEX = {
    pink: "#FF4FA3", magenta: "#FF00AA", purple: "#A855F7", violet: "#7C3AED",
    indigo: "#4338CA", blue: "#2563EB", cyan: "#06B6D4", teal: "#0D9488",
    green: "#16A34A", emerald: "#059669", lime: "#84CC16", yellow: "#FACC15",
    gold: "#EAB308", amber: "#F59E0B", orange: "#F97316", coral: "#FF6B4A",
    red: "#EF4444", scarlet: "#FF2400", crimson: "#DC143C", rose: "#F43F5E",
    brown: "#92400E", cream: "#FFF5E0", white: "#F8FAFC", silver: "#C0C0C0",
    gray: "#6B7280", black: "#0A0A0C", navy: "#1E3A5F", lavender: "#C084FC",
    sky: "#38BDF8",
  };

  function normalizeGeHex(raw) {
    var s = String(raw || "").trim();
    if (!s) return "";
    if (s.charAt(0) !== "#") s = "#" + s;
    if (/^#[0-9a-fA-F]{3}$/.test(s)) {
      s = "#" + s.charAt(1) + s.charAt(1) + s.charAt(2) + s.charAt(2) + s.charAt(3) + s.charAt(3);
    }
    if (!/^#[0-9a-fA-F]{6}$/.test(s)) return "";
    return s.toUpperCase();
  }

  function geHexToRgb(hex) {
    var h = normalizeGeHex(hex);
    if (!h) return null;
    return {
      r: parseInt(h.slice(1, 3), 16),
      g: parseInt(h.slice(3, 5), 16),
      b: parseInt(h.slice(5, 7), 16),
    };
  }

  function geHexToNearestName(hex) {
    var rgb = geHexToRgb(hex);
    if (!rgb) return "Color";
    var best = "color";
    var bestD = Infinity;
    Object.keys(GE_COLOR_NAME_HEX).forEach(function (name) {
      var o = geHexToRgb(GE_COLOR_NAME_HEX[name]);
      if (!o) return;
      var d =
        (rgb.r - o.r) * (rgb.r - o.r) +
        (rgb.g - o.g) * (rgb.g - o.g) +
        (rgb.b - o.b) * (rgb.b - o.b);
      if (d < bestD) {
        bestD = d;
        best = name;
      }
    });
    return best.charAt(0).toUpperCase() + best.slice(1);
  }

  function colorChipLabel(name, hex) {
    var h = normalizeGeHex(hex) || "#888888";
    var n = String(name || geHexToNearestName(h)).trim() || geHexToNearestName(h);
    return n + " (" + h + ")";
  }

  function colorChipThumb(hex) {
    var h = normalizeGeHex(hex) || "#888888";
    return (
      "data:image/svg+xml," +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">' +
          '<rect width="64" height="64" rx="10" fill="' +
          h +
          '"/>' +
          '<rect x="3" y="3" width="58" height="58" rx="8" fill="none" stroke="#000" stroke-opacity=".35" stroke-width="2"/>' +
          "</svg>"
      )
    );
  }

  function colorChipOf(n) {
    n = Number(n);
    if (!state || !state.colorChips) return null;
    return state.colorChips[String(n)] || state.colorChips[n] || null;
  }

  function isColorChipId(n) {
    n = Number(n);
    return !!colorChipOf(n) || (n > COLOR_BASE && n < COLOR_BASE + 100000);
  }


  function scanGeColorSpans(text) {
    text = String(text || "");
    var occupied = new Array(text.length);
    var spans = [];
    var m;
    function mark(from, to) {
      for (var i = from; i < to; i++) occupied[i] = true;
    }
    function free(from, to) {
      for (var j = from; j < to; j++) {
        if (occupied[j]) return false;
      }
      return true;
    }
    var labeledRe =
      /\b((?:vivid\s+)?[A-Za-z][A-Za-z\s\-]{0,28}?)\s*\(#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})\)/g;
    while ((m = labeledRe.exec(text))) {
      var hxL = normalizeGeHex("#" + m[2]);
      if (!hxL) continue;
      if (!free(m.index, m.index + m[0].length)) continue;
      mark(m.index, m.index + m[0].length);
      spans.push({
        start: m.index,
        end: m.index + m[0].length,
        kind: "labeled",
        value: m[0],
        hex: hxL,
        name: String(m[1] || "").replace(/^vivid\s+/i, "").trim(),
      });
    }
    var hexRe = /#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/g;
    while ((m = hexRe.exec(text))) {
      var hx = normalizeGeHex(m[0]);
      if (!hx) continue;
      if (!free(m.index, m.index + m[0].length)) continue;
      mark(m.index, m.index + m[0].length);
      spans.push({
        start: m.index,
        end: m.index + m[0].length,
        kind: "hex",
        value: m[0],
        hex: hx,
        name: geHexToNearestName(hx),
      });
    }
    var names = Object.keys(GE_COLOR_NAME_HEX).sort(function (a, b) {
      return b.length - a.length;
    });
    for (var n = 0; n < names.length; n++) {
      var name = names[n];
      if (name === "grey") continue;
      var re = new RegExp("\\b" + name + "\\b", "gi");
      var mm;
      while ((mm = re.exec(text))) {
        if (!free(mm.index, mm.index + mm[0].length)) continue;
        mark(mm.index, mm.index + mm[0].length);
        spans.push({
          start: mm.index,
          end: mm.index + mm[0].length,
          kind: "name",
          value: mm[0],
          hex: GE_COLOR_NAME_HEX[name],
          name: name.charAt(0).toUpperCase() + name.slice(1),
        });
      }
    }
    spans.sort(function (a, b) {
      return a.start - b.start;
    });
    return spans;
  }

  function buildGeColorHitHtml(text, opts) {
    opts = opts || {};
    var source = opts.source || "note";
    var itemId = opts.itemId != null ? String(opts.itemId) : "";
    var spans = scanGeColorSpans(text);
    if (!spans.length) return esc(text);
    var html = "";
    var pos = 0;
    spans.forEach(function (sp, idx) {
      if (sp.start > pos) html += esc(text.slice(pos, sp.start));
      var title =
        "Click to set pigment → Apply writes “" + colorChipLabel(sp.name, sp.hex) + "”";
      html +=
        '<button type="button" class="ge-color-hit" data-ge-color-source="' +
        esc(source) +
        '" data-item-id="' +
        esc(itemId) +
        '" data-start="' +
        sp.start +
        '" data-end="' +
        sp.end +
        '" data-kind="' +
        sp.kind +
        '" data-hex="' +
        esc(sp.hex) +
        '" data-name="' +
        esc(sp.name || "") +
        '" data-value="' +
        esc(sp.value) +
        '" data-index="' +
        idx +
        '" title="' +
        esc(title) +
        '" style="--swatch:' +
        esc(sp.hex) +
        '">' +
        '<i class="ge-color-hit-swatch" aria-hidden="true"></i>' +
        "<span>" +
        esc(sp.value) +
        "</span>" +
        (sp.kind === "name"
          ? '<em class="ge-color-hit-hex">' + esc(sp.hex) + "</em>"
          : sp.kind === "hex"
            ? '<em class="ge-color-hit-hex">' + esc(sp.name || "") + "</em>"
            : "") +
        "</button>";
      pos = sp.end;
    });
    if (pos < text.length) html += esc(text.slice(pos));
    return html;
  }

  function renderNoteColorHits() {
    var host = $("ge-note-color-hits");
    var ta = $("ge-note-text");
    if (!host) return;
    var text = ta ? ta.value : "";
    var spans = scanGeColorSpans(text);
    if (!spans.length) {
      host.innerHTML = "";
      return;
    }
    host.innerHTML = spans
      .map(function (sp, idx) {
        return (
          '<button type="button" class="ge-color-hit" data-ge-color-source="note" data-start="' +
          sp.start +
          '" data-end="' +
          sp.end +
          '" data-kind="' +
          sp.kind +
          '" data-hex="' +
          esc(sp.hex) +
          '" data-name="' +
          esc(sp.name || "") +
          '" data-value="' +
          esc(sp.value) +
          '" data-index="' +
          idx +
          '" title="Lock ' +
          esc(colorChipLabel(sp.name, sp.hex)) +
          '" style="--swatch:' +
          esc(sp.hex) +
          '">' +
          '<i class="ge-color-hit-swatch" aria-hidden="true"></i>' +
          "<span>" +
          esc(sp.value) +
          "</span>" +
          (sp.kind === "name"
            ? '<em class="ge-color-hit-hex">' + esc(sp.hex) + "</em>"
            : "") +
          "</button>"
        );
      })
      .join("");
  }

  function closeGeColorPopover() {
    var old = document.getElementById("ge-color-popover");
    if (old) old.remove();
  }

  function applyGeColorRewrite(source, start, end, hex, name, itemId) {
    hex = normalizeGeHex(hex);
    if (!hex) return { ok: false, error: "Invalid hex." };
    var label = colorChipLabel(name || geHexToNearestName(hex), hex);

    function rewriteInString(text, s, e) {
      s = Number(s);
      e = Number(e);
      text = String(text || "");
      if (s >= 0 && e > s && e <= text.length) {
        return text.slice(0, s) + label + text.slice(e);
      }
      return null;
    }

    if (source === "note") {
      var ta = $("ge-note-text");
      if (!ta) return { ok: false, error: "Note missing." };
      var next = rewriteInString(ta.value || "", start, end);
      if (next == null) {
        // Fallback: replace first matching old value token
        return { ok: false, error: "Color span moved — click the chip again." };
      }
      ta.value = next;
      ta.focus();
      try {
        var caret = Number(start) + label.length;
        ta.setSelectionRange(caret, caret);
      } catch (e2) {}
      renderNoteColorHits();
      return { ok: true, label: label };
    }

    if (source === "desc") {
      itemId = Number(itemId);
      if (!itemId) return { ok: false, error: "No item." };
      if (!state.descOverrides) state.descOverrides = {};
      var body = fullDescFor(itemId);
      var nextDesc = rewriteInString(body, start, end);
      if (nextDesc == null) {
        return { ok: false, error: "Color span moved — reopen Description." };
      }
      state.descOverrides[String(itemId)] = nextDesc;
      var f = forgedOf(itemId);
      if (f) {
        if (f._originalDescription == null) f._originalDescription = String(f.description || body || "");
        f.description = nextDesc;
      }
      saveState();
      openItemDescription(itemId);
      return { ok: true, label: label };
    }
    return { ok: false, error: "Unknown source." };
  }

  function openGeColorPopover(anchorBtn) {
    closeGeColorPopover();
    if (!anchorBtn) return;
    var startHex = normalizeGeHex(anchorBtn.getAttribute("data-hex")) || "#888888";
    var startName = anchorBtn.getAttribute("data-name") || geHexToNearestName(startHex);
    var source = anchorBtn.getAttribute("data-ge-color-source") || "note";
    var start = anchorBtn.getAttribute("data-start");
    var end = anchorBtn.getAttribute("data-end");
    var itemId = anchorBtn.getAttribute("data-item-id") || "";
    var pop = document.createElement("div");
    pop.id = "ge-color-popover";
    pop.className = "ge-color-popover";
    pop.innerHTML =
      '<div class="ge-color-popover-title">Color chip</div>' +
      '<div class="ge-color-popover-row">' +
      '<input type="color" class="ge-color-pop-swatch" value="' +
      startHex +
      '" />' +
      '<input type="text" class="ge-color-pop-hex" value="' +
      startHex +
      '" maxlength="7" spellcheck="false" />' +
      "</div>" +
      '<div class="ge-color-popover-preview">Writes: <strong class="ge-color-pop-label">' +
      esc(colorChipLabel(startName, startHex)) +
      "</strong></div>" +
      '<p class="ge-color-chips-hint" style="margin:0 0 8px">' +
      (source === "desc"
        ? "Apply rewrites this color in the item description."
        : "Apply rewrites this color in the note as Name (#HEX).") +
      "</p>" +
      '<div class="ge-color-popover-actions">' +
      '<button type="button" class="ge-color-popover-cancel">Cancel</button>' +
      '<button type="button" class="ge-color-popover-apply">Apply</button>' +
      "</div>";
    document.body.appendChild(pop);

    // Do NOT capture-stop on the whole popover — that blocked Apply/Cancel.
    // Outside-dismiss is handled by the document click (ignores pop.contains).

    var rect = anchorBtn.getBoundingClientRect();
    var left = Math.min(rect.left, window.innerWidth - (pop.offsetWidth || 280) - 12);
    var top = Math.min(rect.bottom + 6, window.innerHeight - (pop.offsetHeight || 180) - 12);
    pop.style.left = Math.max(8, left) + "px";
    pop.style.top = Math.max(8, top) + "px";

    var sw = pop.querySelector(".ge-color-pop-swatch");
    var hx = pop.querySelector(".ge-color-pop-hex");
    var lab = pop.querySelector(".ge-color-pop-label");
    var suppressOutsideUntil = 0;

    function syncPreview() {
      var h = normalizeGeHex(hx.value) || normalizeGeHex(sw.value) || startHex;
      if (!h) return;
      try {
        sw.value = h;
      } catch (eSw) {}
      hx.value = h;
      var n = geHexToNearestName(h);
      if (lab) lab.textContent = colorChipLabel(n, h);
    }

    function doApply() {
      var h = normalizeGeHex(hx.value) || normalizeGeHex(sw.value);
      if (!h) {
        setForgeStatus("Pick a valid hex color.", true);
        return;
      }
      var n = geHexToNearestName(h);
      var res = applyGeColorRewrite(source, start, end, h, n, itemId);
      closeGeColorPopover();
      if (!res.ok) setForgeStatus(res.error, true);
      else setForgeStatus("Locked " + res.label + (source === "desc" ? " in description." : " in note."));
    }

    sw.addEventListener("input", function () {
      hx.value = sw.value;
      syncPreview();
    });
    sw.addEventListener("change", function () {
      // Native picker closes with a document click — ignore that dismiss briefly
      suppressOutsideUntil = Date.now() + 500;
      hx.value = sw.value;
      syncPreview();
      pop.dataset.suppressOutsideUntil = String(suppressOutsideUntil);
    });
    sw.addEventListener("click", function (e) {
      e.stopPropagation();
      suppressOutsideUntil = Date.now() + 800;
      pop.dataset.suppressOutsideUntil = String(suppressOutsideUntil);
    });
    hx.addEventListener("input", syncPreview);
    hx.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        doApply();
      }
    });
    function onCancel(e) {
      e.preventDefault();
      e.stopPropagation();
      closeGeColorPopover();
    }
    function onApply(e) {
      e.preventDefault();
      e.stopPropagation();
      doApply();
    }
    var cancelEl = pop.querySelector(".ge-color-popover-cancel");
    var applyEl = pop.querySelector(".ge-color-popover-apply");
    cancelEl.addEventListener("pointerdown", onCancel);
    cancelEl.addEventListener("click", onCancel);
    applyEl.addEventListener("pointerdown", onApply);
    applyEl.addEventListener("click", onApply);
  }

  var geDescEditItemId = null;

  function renderDescToolbar(itemId, dirty) {
    return (
      '<div class="ge-desc-toolbar">' +
      '<button type="button" class="ge-desc-edit-btn" data-item-id="' +
      itemId +
      '">Edit text</button>' +
      '<button type="button" class="ge-desc-default-btn" data-item-id="' +
      itemId +
      '"' +
      (dirty ? "" : " disabled") +
      ">Default text</button>" +
      "</div>"
    );
  }

  function openItemDescription(itemId) {
    itemId = Number(itemId);
    if (!itemId) return { ok: false, error: "No item." };
    if (noteOf(itemId)) {
      return openItemFullscreen(itemId);
    }
    closeGeColorPopover();
    geDescEditItemId = itemId;
    var lb = $("ge-lightbox");
    if (!lb) return { ok: false, error: "Viewer missing." };
    var img = $("ge-lightbox-img");
    var noteEl = $("ge-lightbox-note");
    var plain = $("ge-lightbox-desc");
    var rich = $("ge-lightbox-desc-rich");
    if (noteEl) {
      noteEl.hidden = true;
      noteEl.textContent = "";
    }
    if (img) {
      img.hidden = false;
      img.src = thumb(itemId);
      img.alt = titleFor(itemId);
    }
    var body = String(fullDescFor(itemId) || "").trim();
    var dirty = !!(state.descOverrides && state.descOverrides[String(itemId)] != null);
    if ($("ge-lightbox-title")) {
      $("ge-lightbox-title").textContent = kindLabel(itemId) + " · " + titleFor(itemId);
    }
    if (plain) {
      plain.hidden = true;
      plain.textContent = "";
    }
    if (rich) {
      rich.hidden = false;
      rich.innerHTML =
        renderDescToolbar(itemId, dirty) +
        '<div class="ge-desc-rich-body" data-item-id="' +
        itemId +
        '">' +
        (body
          ? buildGeColorHitHtml(body, { source: "desc", itemId: itemId })
          : "<em>No description text.</em>") +
        "</div>" +
        '<p class="ge-color-chips-hint" style="margin-top:10px">Click a color chip to change its pigment. Edit text / Default text work like Spellforge.</p>';
    }
    lb.hidden = false;
    return { ok: true };
  }

  function startGeDescTextEdit(itemId) {
    itemId = Number(itemId);
    var rich = $("ge-lightbox-desc-rich");
    if (!rich || !itemId) return;
    var body = String(fullDescFor(itemId) || "");
    var dirty = !!(state.descOverrides && state.descOverrides[String(itemId)] != null);
    rich.innerHTML =
      renderDescToolbar(itemId, dirty) +
      '<textarea class="ge-desc-edit" id="ge-desc-edit-ta"></textarea>' +
      '<div class="ge-desc-edit-actions">' +
      '<button type="button" class="ge-desc-edit-cancel" data-item-id="' +
      itemId +
      '">Cancel</button>' +
      '<button type="button" class="ge-desc-edit-save" data-item-id="' +
      itemId +
      '">Save text</button>' +
      "</div>";
    var ta = $("ge-desc-edit-ta");
    if (ta) {
      ta.value = body;
      ta.focus();
    }
  }

  function saveGeDescTextEdit(itemId) {
    itemId = Number(itemId);
    var ta = $("ge-desc-edit-ta");
    if (!ta || !itemId) return;
    if (!state.descOverrides) state.descOverrides = {};
    var text = String(ta.value || "");
    var orig = originalDescFor(itemId);
    if (text === orig) {
      delete state.descOverrides[String(itemId)];
    } else {
      state.descOverrides[String(itemId)] = text;
      var f = forgedOf(itemId);
      if (f) {
        if (f._originalDescription == null) f._originalDescription = String(f.description || orig || "");
        f.description = text;
      }
    }
    saveState();
    openItemDescription(itemId);
    setStatus("Description saved for " + kindLabel(itemId) + ".");
  }

  function revertGeDescText(itemId) {
    itemId = Number(itemId);
    if (!itemId) return;
    if (state.descOverrides) delete state.descOverrides[String(itemId)];
    var f = forgedOf(itemId);
    if (f && f._originalDescription) f.description = f._originalDescription;
    saveState();
    openItemDescription(itemId);
    setStatus("Reverted to default description.");
  }

    /** One-time: remove old preset color-chip items from pack/bank. */
  function purgePresetColorChips() {
    if (state._purgedPresetColorChips) return;
    var pid = String(PLAYER_ID);
    var inv = (state.inventory && state.inventory[pid]) || {};
    var bank = (state.bank && state.bank[pid]) || {};
    // Defaults were COLOR_BASE+1 .. +6
    for (var i = 1; i <= 6; i++) {
      var k = String(COLOR_BASE + i);
      delete inv[k];
      delete bank[k];
      if (state.colorChips) delete state.colorChips[k];
    }
    state._purgedPresetColorChips = true;
    state._colorChipsSeeded = true; // never re-seed
    state._colorChipCatalogReady = true;
  }


  function syncNoteToSpellforgeStore(note) {
    if (!note || note.id == null) return;
    try {
      var raw = localStorage.getItem("spellforge_notes_v1");
      var store = raw ? JSON.parse(raw) : { notes: {}, nextNoteId: NOTE_BASE + 1 };
      if (!store.notes) store.notes = {};
      store.notes[String(note.id)] = {
        id: note.id,
        title: note.title || "Note",
        text: note.text || "",
        createdAt: note.createdAt || Date.now(),
      };
      var next = Math.max(
        Number(store.nextNoteId) || NOTE_BASE + 1,
        Number(note.id) + 1,
        Number(state && state.nextNoteId) || NOTE_BASE + 1
      );
      store.nextNoteId = next;
      localStorage.setItem("spellforge_notes_v1", JSON.stringify(store));
    } catch (e) {}
  }

  function extraOf(n) {
    n = Number(n);
    return extraItems[n] || extraItems[String(n)] || null;
  }

  function kindLabel(n) {
    n = Number(n);
    if (colorChipOf(n)) return "Color " + colorChipLabel(colorChipOf(n).name, colorChipOf(n).hex);
    if (noteOf(n)) return "Note #" + n;
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
    if (colorChipOf(n)) return colorChipThumb(colorChipOf(n).hex);
    if (noteOf(n)) return NOTE_THUMB;
    if (thumbOverrides[String(n)]) return thumbOverrides[String(n)];
    var f = forgedOf(n);
    if (f && f.imageUrl) return assetUrl(f.imageUrl);
    if (f && f.thumb && !isParentPaintingUrl(f.thumb, f.parents)) return assetUrl(f.thumb);
    var ex = extraOf(n);
    if (ex && ex.url) return assetUrl(ex.url);
    if (n >= GEN_BASE && n < SKETCH_BASE) {
      var g = n - GEN_BASE;
      return assetUrl("/generated/" + g + ".jpg");
    }
    // Last resort for forged: parent stand-in (display only — Force load will regenerate)
    if (f && f.parents && f.parents[0]) return thumb(f.parents[0]);
    if (f && f.thumb) return assetUrl(f.thumb);
    if (n >= 1 && n <= PAINTING_TOTAL) return "paintings/" + n + ".jpg";
    return "paintings/1.jpg";
  }

  function paintingPathFor(id) {
    id = Number(id);
    if (id >= 1 && id <= PAINTING_TOTAL) return "paintings/" + id + ".jpg";
    return "";
  }

  /** True if url is clearly one of this forged item's parent paintings (wrong for Force load). */
  function isParentPaintingUrl(url, parents) {
    if (!url || !parents || !parents.length) return false;
    var s = String(url).split("?")[0].replace(/^.*\//, "");
    // paintings/123.jpg or .../paintings/123.jpg
    var m = String(url).match(/paintings\/(\d+)\.(?:jpg|jpeg|png|webp)/i);
    if (!m) return false;
    var pid = Number(m[1]);
    for (var i = 0; i < parents.length; i++) {
      if (Number(parents[i]) === pid) return true;
    }
    return false;
  }

  function rawThumbCandidates(itemId) {
    itemId = Number(itemId);
    var out = [];
    function add(u) {
      if (!u) return;
      u = String(u);
      if (out.indexOf(u) >= 0) return;
      out.push(u);
    }
    var f = forgedOf(itemId);

    // Own image only — never parent fillers (those caused Force load to show the wrong art).
    if (f) {
      if (f.imageUrl) {
        add(f.imageUrl);
        add(assetUrl(f.imageUrl));
      }
      if (f.thumb && !isParentPaintingUrl(f.thumb, f.parents)) {
        add(f.thumb);
        add(assetUrl(f.thumb));
      }
      if (thumbOverrides[String(itemId)]) add(thumbOverrides[String(itemId)]);
    } else {
      var ex = extraOf(itemId);
      if (ex && ex.url) {
        add(ex.url);
        add(assetUrl(ex.url));
      }
      if (itemId >= 1 && itemId <= PAINTING_TOTAL) {
        add(paintingPathFor(itemId));
        add(assetUrl(paintingPathFor(itemId)));
      }
      if (itemId >= GEN_BASE && itemId < SKETCH_BASE) {
        var g = itemId - GEN_BASE;
        add("/generated/" + g + ".jpg");
        add("generated/" + g + ".jpg");
        add(assetUrl("/generated/" + g + ".jpg"));
      }
      if (itemId >= SKETCH_BASE && itemId < INV_SKETCH_BASE) {
        var s = itemId - SKETCH_BASE;
        add("/sketches/" + s + ".jpg");
        add(assetUrl("/sketches/" + s + ".jpg"));
      }
      if (itemId >= INV_SKETCH_BASE && itemId < NOTE_BASE) {
        var invs = itemId - INV_SKETCH_BASE;
        add("/inverted/" + invs + ".jpg");
        add(assetUrl("/inverted/" + invs + ".jpg"));
      }
      if (thumbOverrides[String(itemId)]) add(thumbOverrides[String(itemId)]);
    }

    var busted = [];
    out.slice(0, 6).forEach(function (u) {
      if (u.indexOf("data:") === 0) return;
      var sep = u.indexOf("?") >= 0 ? "&" : "?";
      busted.push(u + sep + "geforce=" + Date.now());
    });
    return busted.concat(out);
  }

  function bindBagThumbErrors(wrap) {
    if (!wrap) return;
    var imgs = wrap.querySelectorAll("img");
    for (var i = 0; i < imgs.length; i++) {
      (function (img) {
        img.addEventListener("error", function () {
          img.classList.add("broken");
          img.title = "Broken thumb — right-click → Force load image";
        });
      })(imgs[i]);
    }
  }

  function applyThumbToDom(itemId, url) {
    itemId = Number(itemId);
    url = String(url || "");
    if (!url) return;
    var sel =
      '[data-ge-inv="' +
      itemId +
      '"] img, [data-ge-bank="' +
      itemId +
      '"] img, [data-forge-item="' +
      itemId +
      '"] img';
    try {
      document.querySelectorAll(sel).forEach(function (img) {
        img.classList.remove("broken");
        img.src = url;
      });
    } catch (e) {}
    if (lastForgeResult === itemId && $("ge-forge-result-img")) {
      $("ge-forge-result-img").src = url;
      $("ge-forge-result-img").classList.remove("broken");
    }
    var lb = $("ge-lightbox");
    if (lb && !lb.hidden && $("ge-lightbox-img") && !$("ge-lightbox-img").hidden) {
      $("ge-lightbox-img").src = url;
    }
    if ($("ge-setup-img") && Number(selected) === itemId) {
      $("ge-setup-img").src = url;
    }
  }

  function acceptForcedImage(itemId, dataUrl, src) {
    itemId = Number(itemId);
    thumbOverrides[String(itemId)] = dataUrl;
    var f = forgedOf(itemId);
    if (f) {
      // Keep the real forge URL — never write a parent painting path as imageUrl
      if (src && !isParentPaintingUrl(src, f.parents) && String(src).indexOf("data:") !== 0) {
        var persist = persistableThumbUrl(src, null);
        if (persist) {
          f.imageUrl = persist;
          f.thumb = persist;
        } else if (/^https:\/\//i.test(src)) {
          f.imageUrl = src;
          f.thumb = src;
        }
      }
      // data URL: keep in thumbOverrides for display; leave imageUrl if already set
    }
    applyThumbToDom(itemId, dataUrl);
    try {
      saveState();
    } catch (eSave) {}
    renderBags();
    renderForgeSlots();
    if (lastForgeResult === itemId) showForgeResult(itemId);
    return { ok: true, from: src };
  }

  function regenerateForgedImage(itemId) {
    var f = forgedOf(itemId);
    if (!f || !f.parents || f.parents.length < 3) {
      return Promise.resolve({
        ok: false,
        error: "No forge parents saved — cannot regenerate. Re-Combine from Spellforge slots.",
      });
    }
    setStatus("Regenerating forged image for #" + itemId + " (not a parent stand-in)…");
    setForgeStatus("Regenerating #" + itemId + "…");
    var prompt = buildForgePrompt(f.parents.map(Number));
    return generateForgeImage(f.parents.map(Number), prompt).then(function (url) {
      if (!url) throw new Error("Generate returned no URL.");
      f.imageUrl = url;
      f.thumb = url;
      return geInlineImage(url).then(function (dataUrl) {
        if (dataUrl && String(dataUrl).indexOf("data:image") === 0) {
          return acceptForcedImage(itemId, dataUrl, url);
        }
        // Still apply remote URL even if inline failed
        thumbOverrides[String(itemId)] = assetUrl(url);
        applyThumbToDom(itemId, assetUrl(url));
        saveState();
        renderBags();
        renderForgeSlots();
        return { ok: true, from: url, regenerated: true };
      });
    });
  }

  function forceLoadItemImage(itemId) {
    itemId = Number(itemId);
    if (!itemId) return Promise.resolve({ ok: false, error: "No item." });
    if (noteOf(itemId)) {
      return Promise.resolve({ ok: false, error: "Notes are text — nothing to load." });
    }
    if (colorChipOf(itemId)) {
      return Promise.resolve({ ok: false, error: "Color chips are solid swatches — nothing to force-load." });
    }
    setStatus("Force loading correct image for " + kindLabel(itemId) + "…");
    setForgeStatus("Force loading #" + itemId + "…");
    var f = forgedOf(itemId);
    var candidates = rawThumbCandidates(itemId);

    function tryAt(i) {
      if (i >= candidates.length) {
        // Forged piece with no own URL left — regenerate the real image (do not use parent art)
        if (f) return regenerateForgedImage(itemId);
        return Promise.resolve({
          ok: false,
          error: "Could not load this item's own image.",
        });
      }
      var src = candidates[i];
      if (f && isParentPaintingUrl(src, f.parents)) {
        return tryAt(i + 1);
      }
      return geInlineImage(src)
        .then(function (dataUrl) {
          if (!dataUrl || String(dataUrl).indexOf("data:image") !== 0) {
            return tryAt(i + 1);
          }
          return new Promise(function (resolve) {
            var probe = new Image();
            probe.onload = function () {
              if (!probe.naturalWidth || probe.naturalWidth < 2 || probe.naturalHeight < 2) {
                tryAt(i + 1).then(resolve);
                return;
              }
              resolve(acceptForcedImage(itemId, dataUrl, src));
            };
            probe.onerror = function () {
              tryAt(i + 1).then(resolve);
            };
            probe.src = dataUrl;
          });
        })
        .catch(function () {
          return tryAt(i + 1);
        });
    }

    // If forged thumb is only a parent stand-in, skip straight to regenerate when no imageUrl
    var start =
      f && !f.imageUrl && (!f.thumb || isParentPaintingUrl(f.thumb, f.parents)) && !thumbOverrides[String(itemId)]
        ? regenerateForgedImage(itemId)
        : tryAt(0);

    return start
      .then(function (res) {
        if (res && res.ok) {
          var msg = res.regenerated
            ? "Regenerated correct image for #" + itemId + "."
            : "Force loaded correct image for " + kindLabel(itemId) + ".";
          setStatus(msg);
          setForgeStatus(msg);
        } else {
          setStatus((res && res.error) || "Force load failed.", true);
          setForgeStatus((res && res.error) || "Force load failed.", true);
        }
        return res;
      })
      .catch(function (err) {
        var msg = (err && err.message) || String(err || "Force load failed");
        setStatus(msg, true);
        setForgeStatus(msg, true);
        return { ok: false, error: msg };
      });
  }

  function titleFor(n) {
    n = Number(n);
    var chip = colorChipOf(n);
    if (chip) return colorChipLabel(chip.name, chip.hex);
    var note = noteOf(n);
    if (note) return note.title || "Note";
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

  function originalDescFor(n) {
    n = Number(n);
    var note = noteOf(n);
    if (note) return String(note.text || "");
    var f = forgedOf(n);
    if (f) {
      if (f._originalDescription != null) return String(f._originalDescription);
      if (f.description) return String(f.description);
    }
    var ex = extraOf(n);
    if (ex && ex.analysis && ex.analysis.description) return String(ex.analysis.description);
    var a = analyses[String(n)];
    if (a && a.description) return String(a.description);
    if (ex) return "A " + kindLabel(n) + " from the Spellforge arsenal.";
    return "A painting from the 1000 Paintings Challenge.";
  }

  function fullDescFor(n) {
    n = Number(n);
    var chip = colorChipOf(n);
    if (chip) {
      return (
        "MANDATORY BOLD COLOR LOCK — use pigment " +
        colorChipLabel(chip.name, chip.hex) +
        " exactly. Repaint conflicting source colors into this lock."
      );
    }
    if (state && state.descOverrides && state.descOverrides[String(n)] != null) {
      return String(state.descOverrides[String(n)] || "");
    }
    var note = noteOf(n);
    if (note) return String(note.text || "");
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
    if (colorChipOf(n)) g *= 0.4;
    else if (noteOf(n)) g *= 0.55;
    else if (forgedOf(n)) g *= 1.45;
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
      version: 6,
      cashDelta: {},
      inventory: {},
      bank: {},
      offers: [],
      history: [],
      guideOverrides: {},
      guideMult: 1,
      itemStats: {},
      forged: {},
      notes: {},
      descOverrides: {},
      colorChips: {},
      nextForgeId: 10001,
      nextNoteId: NOTE_BASE + 1,
      nextColorId: COLOR_BASE + 1,
      _colorChipCatalogReady: false,
      _colorChipsSeeded: false,
      npcSeededOffers: false,
      _npcSeeded: false,
      packReady: true, // do not auto-fill inventory with gallery art
      clearedAutoSeed: true, // never wipe a real pack again
      _starterCash: false,
      level: 1,
      xp: 0,
      walkXpThisLevel: 0,
      createdAt: Date.now(),
    };
  }

  function looksLikeAutoSeedPack(inv) {
    if (!inv || typeof inv !== "object") return false;
    var keys = Object.keys(inv);
    if (keys.length < 20 || keys.length > 28) return false;
    for (var i = 0; i < keys.length; i++) {
      var n = Number(keys[i]);
      var q = Number(inv[keys[i]]) || 0;
      if (!(n >= 1 && n <= 28) || q !== 1) return false;
    }
    return true;
  }

  function migrate(s) {
    if (!s || typeof s !== "object") return defaultState();
    s.version = Math.max(6, Number(s.version) || 6);
    s.cashDelta = s.cashDelta || {};
    s.inventory = s.inventory || {};
    s.bank = s.bank || {};
    // Drop NPC packs from older saves (they filled localStorage).
    (function stripNpcBags() {
      var pid = String(100);
      var invKeep = {};
      if (s.inventory[pid]) invKeep[pid] = s.inventory[pid];
      s.inventory = invKeep;
      var bankKeep = {};
      if (s.bank[pid]) bankKeep[pid] = s.bank[pid];
      s.bank = bankKeep;
      var cashKeep = {};
      if (s.cashDelta[pid] != null) cashKeep[pid] = s.cashDelta[pid];
      s.cashDelta = cashKeep;
      s._npcSeeded = false;
    })();
    s.offers = Array.isArray(s.offers) ? s.offers : [];
    s.history = Array.isArray(s.history) ? s.history : [];
    s.guideOverrides = s.guideOverrides || {};
    s.guideMult = Number(s.guideMult) || 1;
    s.itemStats = s.itemStats || {};
    s.forged = s.forged || {};
    s.notes = s.notes || {};
    s.descOverrides = s.descOverrides || {};
    s.colorChips = s.colorChips || {};
    s.nextColorId = Math.max(COLOR_BASE + 1, Number(s.nextColorId) || COLOR_BASE + 1);
    s._colorChipCatalogReady = !!s._colorChipCatalogReady;
    s._colorChipsSeeded = !!s._colorChipsSeeded;
    s.nextForgeId = Math.max(10001, Number(s.nextForgeId) || 10001);
    s.nextNoteId = Math.max(NOTE_BASE + 1, Number(s.nextNoteId) || NOTE_BASE + 1);
    s.level = Math.max(1, Number(s.level) || 1);
    s.xp = Math.max(0, Number(s.xp) || 0);
    s.walkXpThisLevel = Math.max(0, Number(s.walkXpThisLevel) || 0);
    s.packReady = true;
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
    // One-time only: strip the ancient auto-seed pack (#1–28). Never touch bank or XP.
    // Never wipe a real pack just because packReady was missing.
    if (!s.clearedAutoSeed) {
      var pid = String(100);
      if (looksLikeAutoSeedPack(s.inventory[pid])) {
        s.inventory[pid] = {};
      }
      s.clearedAutoSeed = true;
    }
    return s;
  }

  function scrubLegacyStorage() {
    try {
      var drop = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (!k) continue;
        if (k === STORAGE) continue;
        if (k.indexOf("gallery.grand-exchange") === 0 || k.indexOf("gallery.ge") === 0) {
          drop.push(k);
        }
      }
      drop.forEach(function (k) {
        try {
          localStorage.removeItem(k);
        } catch (e2) {}
      });
    } catch (e) {}
  }

  function loadState() {
    try {
      scrubLegacyStorage();
      var raw = localStorage.getItem(STORAGE);
      var fromLegacy = false;
      if (!raw) {
        for (var i = 0; i < STORAGE_LEGACY_KEYS.length; i++) {
          raw = localStorage.getItem(STORAGE_LEGACY_KEYS[i]);
          if (raw) {
            fromLegacy = true;
            break;
          }
        }
      }
      if (!raw) return defaultState();
      var migrated = migrate(JSON.parse(raw));
      // Rewrite a slim player-only save so NPC packs never stay on disk.
      try {
        state = migrated;
        npcRuntime = { inventory: {}, bank: {} };
        var slim = slimForPersist();
        localStorage.setItem(STORAGE, JSON.stringify(slim));
        if (fromLegacy) scrubLegacyStorage();
        state = null;
        return slim;
      } catch (eSave) {
        state = null;
        try {
          localStorage.removeItem(STORAGE);
        } catch (eRm) {}
        // Fall back to in-memory migrated (still stripped of NPC bags)
        return migrated;
      }
    } catch (e) {
      return defaultState();
    }
  }

  function enforcePlayerInvCap() {
    var pid = String(PLAYER_ID);
    var inv = (state.inventory && state.inventory[pid]) || {};
    var keys = Object.keys(inv).filter(function (k) {
      return (Number(inv[k]) || 0) > 0;
    });
    if (keys.length <= INV_SLOTS) return 0;
    // Move overflow kinds to bank (keep lowest ids in pack)
    keys.sort(function (a, b) {
      return Number(a) - Number(b);
    });
    var moved = 0;
    for (var i = INV_SLOTS; i < keys.length; i++) {
      var k = keys[i];
      var q = Number(inv[k]) || 0;
      if (q > 0) {
        addBank(PLAYER_ID, Number(k), q);
        delete inv[k];
        moved++;
      }
    }
    return moved;
  }

  function slimForPersist() {
    var pid = String(PLAYER_ID);
    enforcePlayerInvCap();
    var inv = {};
    inv[pid] = Object.assign({}, (state.inventory && state.inventory[pid]) || {});
    var bank = {};
    bank[pid] = Object.assign({}, (state.bank && state.bank[pid]) || {});
    var cash = {};
    if (state.cashDelta && state.cashDelta[pid] != null) cash[pid] = state.cashDelta[pid];

    var forged = {};
    Object.keys(state.forged || {}).forEach(function (k) {
      var f = state.forged[k];
      if (!f || typeof f !== "object") return;
      var imageUrl = persistableThumbUrl(f.imageUrl || "", null);
      // Prefer real imageUrl; never persist a parent painting path as the forged image
      var thumbRaw = f.thumb || "";
      var thumb = persistableThumbUrl(thumbRaw, null);
      if (thumb && isParentPaintingUrl(thumb, f.parents)) thumb = imageUrl || "";
      if (!thumb && imageUrl) thumb = imageUrl;
      forged[k] = {
        id: f.id,
        parents: Array.isArray(f.parents) ? f.parents.slice(0, 3) : [],
        title: String(f.title || "").slice(0, 160),
        description: String(f.description || "").slice(0, 1200),
        imageUrl: imageUrl || "",
        thumb: thumb || "",
        guide: f.guide,
        createdAt: f.createdAt,
      };
    });

    var notes = {};
    Object.keys(state.notes || {}).forEach(function (k) {
      var n = state.notes[k];
      if (!n) return;
      notes[k] = {
        id: n.id,
        title: String(n.title || "").slice(0, 80),
        text: String(n.text || "").slice(0, 4000),
        createdAt: n.createdAt,
      };
    });

    var descOverridesSlim = {};
    Object.keys(state.descOverrides || {}).forEach(function (k) {
      var v = state.descOverrides[k];
      if (v == null) return;
      descOverridesSlim[k] = String(v).slice(0, 8000);
    });

    var colorChips = {};
    Object.keys(state.colorChips || {}).forEach(function (k) {
      var c = state.colorChips[k];
      if (!c) return;
      colorChips[k] = {
        id: c.id,
        name: String(c.name || "").slice(0, 40),
        hex: normalizeGeHex(c.hex) || "#888888",
        createdAt: c.createdAt,
      };
    });

    // Keep player offers + a small NPC book sample so the market isn't empty on reload
    var offers = (state.offers || [])
      .filter(function (o) {
        return o && !o.cancelled;
      })
      .slice(0, 60);

    return {
      version: Math.max(6, Number(state.version) || 6),
      cashDelta: cash,
      inventory: inv,
      bank: bank,
      offers: offers,
      history: Array.isArray(state.history) ? state.history.slice(0, 50) : [],
      guideOverrides: state.guideOverrides || {},
      guideMult: Number(state.guideMult) || 1,
      itemStats: state.itemStats || {},
      forged: forged,
      notes: notes,
      descOverrides: descOverridesSlim,
      colorChips: colorChips,
      nextForgeId: state.nextForgeId,
      nextNoteId: state.nextNoteId,
      nextColorId: state.nextColorId || COLOR_BASE + 1,
      _colorChipCatalogReady: !!state._colorChipCatalogReady,
      _colorChipsSeeded: !!state._colorChipsSeeded,
      npcSeededOffers: !!state.npcSeededOffers,
      // Force NPC packs to reseed in memory each session (not persisted)
      _npcSeeded: false,
      packReady: true,
      clearedAutoSeed: true,
      _starterCash: !!state._starterCash,
      level: Math.max(1, Number(state.level) || 1),
      xp: Math.max(0, Number(state.xp) || 0),
      walkXpThisLevel: Math.max(0, Number(state.walkXpThisLevel) || 0),
      createdAt: state.createdAt || Date.now(),
    };
  }

  function saveState() {
    if (!state) return false;
    try {
      var slim = slimForPersist();
      // Keep live bags/level aligned — but do NOT replace forged thumbs in memory
      // (slim drops data: and oversize URLs; wiping them here made forge images vanish).
      state.inventory = slim.inventory;
      state.bank = slim.bank;
      state.cashDelta = Object.assign({}, state.cashDelta || {}, slim.cashDelta);
      state.history = slim.history;
      state.level = slim.level;
      state.xp = slim.xp;
      localStorage.setItem(STORAGE, JSON.stringify(slim));
      return true;
    } catch (e) {
      // Last resort: drop history/offers/stats and retry
      try {
        var emergency = slimForPersist();
        emergency.history = [];
        emergency.offers = (emergency.offers || []).filter(function (o) {
          return o && o.isPlayer;
        });
        emergency.itemStats = {};
        localStorage.setItem(STORAGE, JSON.stringify(emergency));
        state.history = [];
        setStatus("Saved pack/bank/level (cleared market history to free storage).", false);
        return true;
      } catch (e2) {
        try {
          setStatus("Could not save GE progress — storage still full after cleanup.", true);
        } catch (e3) {}
        return false;
      }
    }
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
    if (Number(id) === PLAYER_ID) {
      if (!state.inventory) state.inventory = {};
      if (!state.inventory[id]) state.inventory[id] = {};
      return state.inventory[id];
    }
    if (!npcRuntime.inventory[id]) npcRuntime.inventory[id] = {};
    return npcRuntime.inventory[id];
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
    if (Number(id) === PLAYER_ID) {
      if (!state.bank) state.bank = {};
      if (!state.bank[id]) state.bank[id] = {};
      return state.bank[id];
    }
    if (!npcRuntime.bank[id]) npcRuntime.bank[id] = {};
    return npcRuntime.bank[id];
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
      return (
        o &&
        o.isPlayer &&
        !o.cancelled &&
        (o.complete ||
          (Number(o.qtyLeft) || 0) > 0 ||
          (Number(o.readyItems) || 0) > 0 ||
          (Number(o.readyCash) || 0) > 0)
      );
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

  /** XP needed to go from `level` → level+1 (simple quadratic curve). */
  function xpForLevel(level) {
    level = Math.max(1, Number(level) || 1);
    return Math.floor(40 + level * 35 + level * level * 8);
  }

  function grantXp(amount, opts) {
    opts = opts || {};
    amount = Math.max(0, Math.floor(Number(amount) || 0));
    if (!amount || !state) return;
    if (opts.walk) {
      var cap = WALK_XP_PER_LEVEL_CAP;
      var already = Number(state.walkXpThisLevel) || 0;
      if (already >= cap) return;
      amount = Math.min(amount, cap - already);
      state.walkXpThisLevel = already + amount;
    }
    state.xp = (Number(state.xp) || 0) + amount;
    state.level = Math.max(1, Number(state.level) || 1);
    var guard = 0;
    while (state.xp >= xpForLevel(state.level) && guard < 50) {
      state.xp -= xpForLevel(state.level);
      state.level += 1;
      state.walkXpThisLevel = 0;
      guard++;
    }
    saveState();
    updateLevelHud();
  }

  function updateLevelHud() {
    if (!state) return;
    var lv = Math.max(1, Number(state.level) || 1);
    var xp = Math.max(0, Number(state.xp) || 0);
    var need = xpForLevel(lv);
    var pct = need > 0 ? Math.min(100, Math.round((xp / need) * 100)) : 0;
    ["ge-world-lv", "ge-ui-lv"].forEach(function (id) {
      if ($(id)) $(id).textContent = String(lv);
    });
    ["ge-world-xp-fill", "ge-ui-xp-fill"].forEach(function (id) {
      if ($(id)) $(id).style.width = pct + "%";
    });
    if ($("ge-world-cash")) $("ge-world-cash").textContent = money(cashOf(PLAYER_ID));
  }

  function tagsFor(n) {
    n = Number(n);
    var out = [];
    var seen = Object.create(null);
    function add(t) {
      t = String(t || "").trim();
      if (!t) return;
      var key = t.toLowerCase();
      if (seen[key]) return;
      seen[key] = 1;
      out.push(t);
    }
    var a = analyses[String(n)] || analyses[n];
    if (a && Array.isArray(a.tags)) a.tags.forEach(add);
    var ex = extraOf(n);
    if (ex) {
      if (ex.analysis && Array.isArray(ex.analysis.tags)) ex.analysis.tags.forEach(add);
      if (ex.source === "phone-upload") add("phone");
      else if (ex.source === "sketch") add("sketch");
      else if (ex.source === "sketch-inverted") {
        add("sketch");
        add("inverted");
      } else if (ex.source === "generated") add("generated");
    }
    if (noteOf(n)) add("note");
    if (forgedOf(n)) add("forged");
    if (n >= 1 && n <= PAINTING_TOTAL) add("painting");
    return out;
  }

  function collectAllTags() {
    var map = Object.create(null);
    function add(t) {
      t = String(t || "").trim();
      if (!t) return;
      var k = t.toLowerCase();
      if (!map[k]) map[k] = t;
    }
    Object.keys(analyses || {}).forEach(function (k) {
      var a = analyses[k];
      if (a && Array.isArray(a.tags)) a.tags.forEach(add);
    });
    Object.keys(extraItems || {}).forEach(function (k) {
      if (String(Number(k)) !== String(k) && Number(k) !== Number(k)) return;
      tagsFor(Number(k)).forEach(add);
    });
    forgedIds().forEach(function (id) {
      tagsFor(id).forEach(add);
    });
    ["painting", "generated", "phone", "sketch", "inverted", "forged"].forEach(add);
    return Object.keys(map)
      .sort()
      .map(function (k) {
        return map[k];
      });
  }

  function populateTagFilter() {
    var sel = $("ge-tag-filter");
    if (!sel) return;
    var prev = sel.value || "";
    var tags = collectAllTags();
    var html = ['<option value="">All tags</option>'];
    tags.forEach(function (t) {
      html.push('<option value="' + esc(t) + '">' + esc(t) + "</option>");
    });
    sel.innerHTML = html.join("");
    if (prev) {
      sel.value = prev;
      if (sel.value !== prev) sel.value = "";
    }
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
          // RuneScape-style: player goods/cash sit on the offer until Collect.
          // NPCs settle immediately.
          if (buy.isPlayer) {
            buy.readyItems = (Number(buy.readyItems) || 0) + qty;
            if (refund) buy.readyCash = (Number(buy.readyCash) || 0) + refund;
          } else {
            if (refund) addCash(buy.traderId, refund);
            addInv(buy.traderId, buy.itemId, qty);
          }
          if (sell.isPlayer) {
            sell.readyCash = (Number(sell.readyCash) || 0) + total;
          } else {
            addCash(sell.traderId, total);
          }
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
      if (o.isPlayer && ((Number(o.readyItems) || 0) > 0 || (Number(o.readyCash) || 0) > 0)) return true;
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
      readyItems: 0,
      readyCash: 0,
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
      // Return only the unfilled reservation; filled portion stays for Collect.
      if (o.side === "buy") addCash(o.traderId, left * o.price);
      else addInv(o.traderId, o.itemId, left);
    }
    o.qtyLeft = 0;
    var pending = (Number(o.readyItems) || 0) > 0 || (Number(o.readyCash) || 0) > 0;
    if (o.isPlayer && pending) {
      o.complete = true;
      saveState();
      return;
    }
    o.cancelled = true;
    o.complete = false;
    state.offers = state.offers.filter(function (x) {
      return x && !x.cancelled && ((x.isPlayer && x.complete) || (Number(x.qtyLeft) || 0) > 0 || (Number(x.readyItems) || 0) > 0 || (Number(x.readyCash) || 0) > 0);
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
    var readyItems = Number(o.readyItems) || 0;
    var readyCash = Number(o.readyCash) || 0;
    if (readyItems < 1 && readyCash < 1 && !o.complete) return;
    if (readyItems > 0) {
      var already = qtyOf(PLAYER_ID, o.itemId) > 0;
      var free = INV_SLOTS - inventoryCount(PLAYER_ID);
      if (!already && free < 1) {
        addBank(PLAYER_ID, o.itemId, readyItems);
        setStatus("Pack full — collected #" + o.itemId + " went to bank.");
      } else {
        addInv(PLAYER_ID, o.itemId, readyItems);
      }
    }
    if (readyCash > 0) addCash(PLAYER_ID, readyCash);
    o.readyItems = 0;
    o.readyCash = 0;
    // Free the slot only when the offer is fully filled (or was marked complete).
    if (o.complete || (Number(o.qtyLeft) || 0) <= 0) {
      o.cancelled = true;
      o.complete = false;
      o.qtyLeft = 0;
      state.offers = state.offers.filter(function (x) {
        return x && !x.cancelled && ((x.isPlayer && x.complete) || (Number(x.qtyLeft) || 0) > 0 || (Number(x.readyItems) || 0) > 0 || (Number(x.readyCash) || 0) > 0);
      });
    }
    grantXp(COLLECT_XP);
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
          '" alt="" loading="eager" decoding="async" /><span class="qty">' +
          it.qty +
          "</span></button>"
      );
    }
    wrap.innerHTML = html.join("");
    bindBagThumbErrors(wrap);
    if ($("ge-inv-meta")) {
      $("ge-inv-meta").textContent =
        list.length +
        " / " +
        INV_SLOTS +
        " used · right-click → Force load if thumb is blank";
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
          '" alt="" loading="eager" decoding="async" /><span class="qty">' +
          it.qty +
          "</span></button>"
      );
    }
    wrap.innerHTML = html.join("");
    bindBagThumbErrors(wrap);
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
          (o.complete || (Number(o.readyItems) || 0) > 0 || (Number(o.readyCash) || 0) > 0
            ? "Collect — "
            : "") +
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
          ((Number(o.readyItems) || 0) > 0 || (Number(o.readyCash) || 0) > 0 || o.complete
            ? '<button type="button" data-ge-collect="' + esc(o.id) + '">Collect</button>'
            : '') +
          ((Number(o.qtyLeft) || 0) > 0 && !o.complete
            ? '<button type="button" data-ge-abort="' + esc(o.id) + '">Abort</button>'
            : '') +
          "</div></div>"
      );
    }
    wrap.innerHTML = html.join("");
  }


  function catalogFilterList() {
    var q = (($("ge-search") && $("ge-search").value) || "").trim().toLowerCase();
    var tagSel = (($("ge-tag-filter") && $("ge-tag-filter").value) || "").trim().toLowerCase();
    var out = [];
    var list = arsenalList();
    for (var i = 0; i < list.length; i++) {
      var n = list[i];
      var title = titleFor(n);
      var label = kindLabel(n);
      var hay = (title + " " + label + " #" + n).toLowerCase();
      if (tagSel) {
        var itemTags = tagsFor(n).map(function (t) {
          return String(t).toLowerCase();
        });
        if (itemTags.indexOf(tagSel) === -1) continue;
      }
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
      out.push(n);
    }
    return out;
  }

  function pickRandomTradeItem() {
    var pool;
    if (setupSide === "sell") {
      pool = invList(PLAYER_ID).map(function (it) {
        return it.id;
      });
      if (!pool.length) {
        // Fall back to bank for sell random
        pool = bankList(PLAYER_ID).map(function (it) {
          return it.id;
        });
      }
    } else {
      pool = catalogFilterList();
      if (!pool.length) pool = arsenalList();
    }
    if (!pool.length) return null;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function applyRandomItem() {
    var n = pickRandomTradeItem();
    if (n == null) {
      setStatus(
        setupSide === "sell"
          ? "Nothing in inventory/bank to randomize."
          : "No items match the current filters.",
        true
      );
      return false;
    }
    selected = Number(n);
    if ($("ge-price")) $("ge-price").value = String(guidePrice(selected));
    renderSetup();
    setStatus("Random: " + kindLabel(selected) + " · " + titleFor(selected) + " @ " + money(guidePrice(selected)));
    return true;
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
    var tagSel = (($("ge-tag-filter") && $("ge-tag-filter").value) || "").trim().toLowerCase();
    if (!wrap) return;
    var html = [];
    var shown = 0;
    var list = arsenalList();
    for (var i = 0; i < list.length && shown < 200; i++) {
      var n = list[i];
      var title = titleFor(n);
      var label = kindLabel(n);
      var hay = (title + " " + label + " #" + n).toLowerCase();
      if (tagSel) {
        var itemTags = tagsFor(n).map(function (t) {
          return String(t).toLowerCase();
        });
        if (itemTags.indexOf(tagSel) === -1) continue;
      }
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
    updateLevelHud();
    if (view === "home") renderSlots();
    if (view === "setup") renderSetup();
    if (view === "pick") renderCatalog();
    if (view === "history") renderHistory();
    renderBags();
    renderForgeSlots();
    renderNoteColorHits();
  }


  function syncForgeToSpellforge() {
    try {
      if (!window.SpellforgeAPI) return;
      var panel = document.getElementById("panel-spellforge");
      var visible = panel && !panel.hidden;
      if (typeof window.SpellforgeAPI.equipSlots === "function") {
        window.SpellforgeAPI.equipSlots(forgeSlots.slice(), {
          skipAutoVision: true,
          skipRender: !visible,
        });
        return;
      }
      if (visible && typeof window.SpellforgeAPI.equipToSlot === "function") {
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
      btn.classList.toggle("note-slot", !!(id && noteOf(id)));
      btn.classList.toggle("color-slot", !!(id && colorChipOf(id)));
      btn.title = id ? "Clear slot · " + kindLabel(id) : "Clear slot";
      var num = btn.querySelector(".ge-forge-num");
      var img = btn.querySelector("img:not(.ge-note-icon)");
      var badge = btn.querySelector(".ge-note-badge");
      if (id && (noteOf(id) || colorChipOf(id))) {
        if (img) img.remove();
        if (!badge) {
          badge = document.createElement("span");
          badge.className = "ge-note-badge";
          btn.appendChild(badge);
        }
        var chip = colorChipOf(id);
        if (chip) {
          badge.innerHTML =
            '<img class="ge-note-icon" src="' +
            colorChipThumb(chip.hex) +
            '" alt="" /><span>' +
            esc(String(titleFor(id)).slice(0, 28)) +
            "</span>";
        } else {
          badge.innerHTML =
            '<img class="ge-note-icon" src="' +
            NOTE_THUMB +
            '" alt="" /><span>' +
            esc(String(titleFor(id)).slice(0, 28)) +
            "</span>";
        }
        if (num) num.style.display = "none";
      } else if (id) {
        if (badge) badge.remove();
        if (!img) {
          img = document.createElement("img");
          img.alt = "";
          btn.appendChild(img);
        }
        img.src = thumb(id);
        if (num) num.style.display = "none";
      } else {
        if (img) img.remove();
        if (badge) badge.remove();
        if (num) {
          num.style.display = "";
          num.textContent = String(i + 1);
        }
      }
    }
  }

  function placeInForge(itemId, slotIndex) {
    itemId = Number(itemId);
    if (!itemId) return { ok: false, error: "No item." };
    if (!noteOf(itemId) && ownedQty(itemId) < 1) {
      return { ok: false, error: "You do not own that item." };
    }
    var slot = slotIndex == null || slotIndex === "" ? -1 : Number(slotIndex);
    if (slot < 0 || slot > 2 || isNaN(slot)) {
      slot = -1;
      for (var i = 0; i < 3; i++) {
        if (forgeSlots[i] == null) {
          slot = i;
          break;
        }
      }
      if (slot < 0) return { ok: false, error: "Spellforge slots are full — clear one first." };
    }
    forgeSlots[slot] = itemId;
    // Do NOT call SpellforgeAPI here — live equip re-renders Spellforge and can blank its UI
    // while you're still on Grand Exchange. Sync happens on Open Spellforge / Combine.
    return { ok: true, slot: slot, itemId: itemId };
  }

  function hideForgeContextMenu() {
    var menu = $("ge-forge-menu");
    if (menu) menu.hidden = true;
  }

  function showForgeContextMenu(clientX, clientY, itemId, source) {
    var menu = $("ge-forge-menu");
    if (!menu) return;
    source = source === "bank" ? "bank" : "inv";
    menu.dataset.itemId = String(itemId);
    menu.dataset.source = source;
    for (var i = 0; i < 3; i++) {
      var btn = menu.querySelector('[data-forge-pick="' + i + '"]');
      if (!btn) continue;
      var cur = forgeSlots[i];
      btn.textContent =
        "Slot " +
        (i + 1) +
        (cur != null ? " · " + kindLabel(cur) : " · empty");
      btn.classList.toggle("occupied", cur != null);
    }
    var dep = menu.querySelector('[data-ge-action="deposit"]');
    var wd = menu.querySelector('[data-ge-action="withdraw"]');
    var descBtn = menu.querySelector('[data-ge-action="description"]');
    var forceLoad = menu.querySelector('[data-ge-action="force-load"]');
    var animateBtn = menu.querySelector('[data-ge-action="animate"]');
    var isChip = !!colorChipOf(itemId);
    var isNote = !!noteOf(itemId);
    if (dep) dep.hidden = source !== "inv";
    if (wd) wd.hidden = source !== "bank";
    if (descBtn) descBtn.hidden = isNote; // notes already text
    if (forceLoad) forceLoad.hidden = isChip || isNote;
    if (animateBtn) animateBtn.hidden = isChip || isNote;
    menu.hidden = false;
    // Position inside viewport
    var pad = 8;
    var w = menu.offsetWidth || 180;
    var h = menu.offsetHeight || 180;
    var x = Math.min(clientX, window.innerWidth - w - pad);
    var y = Math.min(clientY, window.innerHeight - h - pad);
    x = Math.max(pad, x);
    y = Math.max(pad, y);
    menu.style.left = x + "px";
    menu.style.top = y + "px";
    menu.dataset.openedAt = String(Date.now());
  }

  function placeNoteInForge(slot, text) {
    text = String(text || "").trim();
    if (!text) return { ok: false, error: "Write a note first." };
    slot = Number(slot);
    if (slot < 0 || slot > 2 || isNaN(slot)) {
      return { ok: false, error: "Pick slot 1–3." };
    }
    if (!state.notes) state.notes = {};
    var id = Number(state.nextNoteId) || NOTE_BASE + 1;
    try {
      var rawShared = localStorage.getItem("spellforge_notes_v1");
      if (rawShared) {
        var shared = JSON.parse(rawShared);
        id = Math.max(id, Number(shared && shared.nextNoteId) || NOTE_BASE + 1);
      }
    } catch (eShared) {}
    state.nextNoteId = id + 1;
    var title = text.replace(/\s+/g, " ").slice(0, 40);
    if (text.length > 40) title += "…";
    var entry = {
      id: id,
      title: title || "Note",
      text: text,
      createdAt: Date.now(),
    };
    state.notes[String(id)] = entry;
    forgeSlots[slot] = id;
    syncNoteToSpellforgeStore(entry);
    saveState();
    return { ok: true, slot: slot, itemId: id };
  }

  function selectedForgeAspect() {
    var sel = $("ge-forge-aspect");
    var v = sel && sel.value ? String(sel.value) : "1:1";
    var ok = { "1:1": 1, "4:3": 1, "3:4": 1, "16:9": 1, "9:16": 1, "3:2": 1, "2:3": 1 };
    return ok[v] ? v : "1:1";
  }


  function hideGeLightbox() {
    var lb = $("ge-lightbox");
    if (lb) lb.hidden = true;
    closeGeColorPopover();
    var rich = $("ge-lightbox-desc-rich");
    if (rich) {
      rich.hidden = true;
      rich.innerHTML = "";
    }
    var plain = $("ge-lightbox-desc");
    if (plain) plain.hidden = false;
  }

  function openItemFullscreen(itemId) {
    itemId = Number(itemId);
    if (!itemId) return { ok: false, error: "No item." };
    // Color chips: show swatch + lock text in GE lightbox
    if (colorChipOf(itemId)) {
      var lbC = $("ge-lightbox");
      if (!lbC) return { ok: false, error: "Viewer missing." };
      var imgC = $("ge-lightbox-img");
      var noteC = $("ge-lightbox-note");
      if (noteC) {
        noteC.hidden = false;
        noteC.textContent = fullDescFor(itemId);
      }
      if (imgC) {
        imgC.hidden = false;
        imgC.src = thumb(itemId);
        imgC.alt = titleFor(itemId);
      }
      if ($("ge-lightbox-title")) $("ge-lightbox-title").textContent = kindLabel(itemId);
      if ($("ge-lightbox-desc")) $("ge-lightbox-desc").textContent = titleFor(itemId);
      lbC.hidden = false;
      return { ok: true };
    }
    // Paintings 1–1000: reuse gallery lightbox when available
    if (itemId >= 1 && itemId <= 1000 && typeof window.openLightbox === "function") {
      try {
        window.openLightbox(itemId);
        return { ok: true };
      } catch (e) {}
    }
    var lb = $("ge-lightbox");
    if (!lb) return { ok: false, error: "Viewer missing." };
    var img = $("ge-lightbox-img");
    var noteEl = $("ge-lightbox-note");
    var isNote = !!noteOf(itemId);
    if (isNote) {
      if (img) {
        img.hidden = true;
        img.removeAttribute("src");
      }
      if (noteEl) {
        noteEl.hidden = false;
        noteEl.textContent = fullDescFor(itemId) || titleFor(itemId);
      }
    } else {
      if (noteEl) {
        noteEl.hidden = true;
        noteEl.textContent = "";
      }
      if (img) {
        img.hidden = false;
        img.src = thumb(itemId);
        img.alt = titleFor(itemId);
      }
    }
    if ($("ge-lightbox-title")) $("ge-lightbox-title").textContent = kindLabel(itemId) + " · " + titleFor(itemId);
    if ($("ge-lightbox-desc")) $("ge-lightbox-desc").textContent = isNote ? "" : descFor(itemId);
    lb.hidden = false;
    return { ok: true };
  }

  var geAnimate = {
    busy: false,
    cancel: false,
    jobId: null,
  };

  function setGeAnimateStatus(msg, kind) {
    var el = $("ge-animate-status");
    if (!el) {
      setStatus(msg, kind === "err");
      return;
    }
    el.textContent = msg || "";
    el.className = "ge-animate-status" + (kind === "err" ? " err" : kind === "ok" ? " ok" : "");
  }

  function setGeAnimateProgress(pct) {
    var wrap = $("ge-animate-progress");
    var fill = $("ge-animate-progress-fill");
    if (!wrap || !fill) return;
    if (pct == null) {
      wrap.hidden = true;
      return;
    }
    wrap.hidden = false;
    fill.style.width = Math.max(4, Math.min(100, Number(pct) || 4)) + "%";
  }

  function geAnimateDuration() {
    var sel = $("ge-animate-dur");
    var n = sel ? Number(sel.value) : 15;
    if (n === 6 || n === 10 || n === 15) return n;
    return 15;
  }

  function persistableThumbUrl(url, parentFallback) {
    var thumb = String(url || "");
    var fallback = parentFallback ? "paintings/" + parentFallback + ".jpg" : "";
    if (!thumb) return fallback;
    // data URLs blow localStorage — never persist them
    if (thumb.indexOf("data:") === 0) return fallback;
    try {
      var u = new URL(thumb, location.href);
      // Same origin (incl. localhost/LAN): store path so reload still works
      if (typeof location !== "undefined" && u.origin === location.origin) {
        return u.pathname + u.search;
      }
    } catch (e) {}
    // Public https CDN urls are fine (up to a sane length)
    if (/^https:\/\//i.test(thumb) && thumb.length <= 1800) return thumb;
    if (thumb.length <= 400 && thumb.indexOf("http://") !== 0) return thumb;
    return fallback;
  }

  function geCompressDataUrl(dataUrl, maxSide, quality) {
    return new Promise(function (resolve) {
      if (!dataUrl || dataUrl.indexOf("data:image") !== 0) return resolve(dataUrl || "");
      var img = new Image();
      img.onload = function () {
        var w = img.width;
        var h = img.height;
        var scale = Math.min(1, maxSide / Math.max(w, h, 1));
        var canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(w * scale));
        canvas.height = Math.max(1, Math.round(h * scale));
        var ctx = canvas.getContext("2d");
        if (!ctx) return resolve(dataUrl);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = function () {
        resolve(dataUrl);
      };
      img.src = dataUrl;
    });
  }

  /** Inline a gallery/LAN image as a data URL so the cloud API does not need to fetch http://localhost. */
  function geInlineImage(path) {
    return new Promise(function (resolve, reject) {
      var url = String(path || "");
      if (!url) return reject(new Error("No image to inline."));
      if (url.indexOf("data:image") === 0) {
        return geCompressDataUrl(url, 1280, 0.85).then(resolve);
      }
      var fetchUrl = url;
      try {
        var u = new URL(url, location.href);
        if (u.origin === location.origin) fetchUrl = u.pathname + u.search;
      } catch (e) {}
      fetch(fetchUrl, { cache: "force-cache", credentials: "same-origin" })
        .then(function (r) {
          if (!r.ok) throw new Error("Could not load image (" + r.status + ").");
          return r.blob();
        })
        .then(function (blob) {
          return new Promise(function (res, rej) {
            var reader = new FileReader();
            reader.onload = function () {
              res(reader.result);
            };
            reader.onerror = function () {
              rej(new Error("Could not read image bytes."));
            };
            reader.readAsDataURL(blob);
          });
        })
        .then(function (dataUrl) {
          return geCompressDataUrl(dataUrl, 1280, 0.85);
        })
        .then(resolve)
        .catch(function (err) {
          reject(err || new Error("Could not inline reference image."));
        });
    });
  }

  function absoluteAssetUrl(path) {
    if (!path) return "";
    if (/^https?:\/\//i.test(path) || path.indexOf("data:") === 0) return path;
    try {
      return new URL(path, location.href).href;
    } catch (e) {
      return path;
    }
  }

  function pollGeAnimateJob(jobId, startedAt) {
    startedAt = startedAt || Date.now();
    if (geAnimate.cancel) return Promise.reject(new Error("Cancelled."));
    if (Date.now() - startedAt > 12 * 60 * 1000) {
      return Promise.reject(new Error("Timed out after 12 minutes."));
    }
    return fetch(geApiUrl("/api/jobs/" + encodeURIComponent(jobId)), { cache: "no-store" })
      .then(function (r) {
        return r.json().then(function (d) {
          return { ok: r.ok, status: r.status, d: d };
        });
      })
      .then(function (res) {
        if (geAnimate.cancel) return Promise.reject(new Error("Cancelled."));
        if (res.status === 404) throw new Error("Job lost — try again.");
        var d = res.d || {};
        var st = String(d.status || "").toLowerCase();
        var pct = d.progress_pct != null ? d.progress_pct : d.progress != null ? Number(d.progress) * 100 : null;
        if (pct == null) {
          var elapsed = Math.round((Date.now() - startedAt) / 1000);
          pct = Math.min(92, 8 + elapsed / 2);
        }
        setGeAnimateProgress(pct);
        setGeAnimateStatus("Animating… " + st + (d.elapsed_sec != null ? " · " + d.elapsed_sec + "s" : ""));
        if (st === "done" || st === "completed" || st === "success") {
          var vid = d.video || {};
          var url = vid.url || vid.download_url || vid.uri || d.url || "";
          if (url) return url;
          throw new Error("Job finished but no video URL.");
        }
        if (st === "failed" || st === "error" || st === "expired") {
          throw new Error((d.error && (d.error.message || d.error)) || "Video generation failed.");
        }
        var wait = st === "queued" ? 800 : 1500;
        return new Promise(function (resolve) {
          setTimeout(resolve, wait);
        }).then(function () {
          return pollGeAnimateJob(jobId, startedAt);
        });
      });
  }

  function showGeAnimateVideo(url) {
    var video = $("ge-animate-video");
    var still = $("ge-animate-still");
    if (still) still.hidden = true;
    if (!video) return;
    video.hidden = false;
    video.src = absoluteAssetUrl(url);
    video.controls = true;
    try {
      video.play();
    } catch (e) {}
  }

  function endGeAnimateBusy() {
    geAnimate.busy = false;
    geAnimate.jobId = null;
    var cancel = $("ge-animate-cancel");
    if (cancel) cancel.hidden = true;
  }

  function startGeAnimateForItem(itemId, directionOpt) {
    itemId = Number(itemId);
    if (!itemId) return { ok: false, error: "No item." };
    if (geAnimate.busy) return { ok: false, error: "Already animating — wait or Cancel." };
    if (noteOf(itemId)) {
      return { ok: false, error: "Notes are text fillers — pick an image item to animate." };
    }
    if (colorChipOf(itemId)) {
      return { ok: false, error: "Color chips are pigments — insert into note or forge slots." };
    }
    if (!exchangeOpen) openExchangeUi();

    var direction = String(directionOpt || "").trim();
    var prompt = geSoftenPrompt(
      "Cinematic subtle motion of this artwork. Keep composition and subject identity. " +
        String(titleFor(itemId) || "") +
        (direction ? " Animation direction: " + direction : "")
    );
    var stasis = geSoftenPrompt(
      (
        String(fullDescFor(itemId) || descFor(itemId) || titleFor(itemId) || "").trim() +
        (direction ? "\n\nAnimation direction (optional user notes): " + direction : "")
      ).trim()
    );
    if (stasis.length > 3500) stasis = stasis.slice(0, 3500);
    var aspect = selectedForgeAspect();
    var duration = geAnimateDuration();
    var spells = itemId >= 1 && itemId <= 1000 ? [itemId] : [];
    var stillUrl = thumb(itemId);

    var still = $("ge-animate-still");
    var video = $("ge-animate-video");
    if (video) {
      video.hidden = true;
      video.removeAttribute("src");
    }
    if (still) {
      still.hidden = false;
      still.src = stillUrl;
      still.alt = titleFor(itemId);
    }

    geAnimate.busy = true;
    geAnimate.cancel = false;
    var cancelBtn = $("ge-animate-cancel");
    if (cancelBtn) cancelBtn.hidden = false;
    setGeAnimateProgress(4);
    setGeAnimateStatus("Inlining reference image…");
    setStatus("Animating in Grand Exchange — stay here while it processes.");

    geInlineImage(stillUrl)
      .then(function (dataUrl) {
        if (geAnimate.cancel) throw new Error("Cancelled.");
        if (!dataUrl || String(dataUrl).indexOf("data:image") !== 0) {
          throw new Error(
            "Reference image could not be inlined — reload the page and try again (keep start_server.bat running)."
          );
        }
        setGeAnimateProgress(8);
        setGeAnimateStatus("Starting animation of " + kindLabel(itemId) + " (" + duration + "s)…");
        var body = {
          stasis: stasis || prompt,
          prompt: prompt,
          duration: duration,
          spells: spells,
          resolution: "720p",
          morph_chain: false,
          video_url: "",
          aspect_ratio: aspect === "1:1" ? "16:9" : aspect,
          source: "grand-exchange",
          // data URL — cloud API must not try to fetch localhost/LAN http URLs
          reference_image: dataUrl,
        };
        return fetch(geApiUrl("/api/animate-cast"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          cache: "no-store",
        });
      })
      .then(function (r) {
        return r.json().then(function (d) {
          return { ok: r.ok, status: r.status, d: d };
        });
      })
      .then(function (res) {
        if (geAnimate.cancel) throw new Error("Cancelled.");
        var d = res.d || {};
        if (!res.ok) {
          throw new Error((d.error && (d.error.message || d.error)) || "Animate cast failed.");
        }
        if (res.status === 202 && d.job_id) {
          geAnimate.jobId = d.job_id;
          return pollGeAnimateJob(d.job_id);
        }
        var vid = d.video || {};
        var url = vid.url || vid.download_url || vid.uri || "";
        if (url) return url;
        if (d.job_id) {
          geAnimate.jobId = d.job_id;
          return pollGeAnimateJob(d.job_id);
        }
        throw new Error("No job id returned.");
      })
      .then(function (url) {
        endGeAnimateBusy();
        setGeAnimateProgress(100);
        showGeAnimateVideo(url);
        setGeAnimateStatus("Done — playing clip in Grand Exchange.", "ok");
        setStatus("Animation ready in GE.");
        try {
          grantXp(Math.max(10, Math.round(FORGE_XP / 2)));
        } catch (eXp) {}
      })
      .catch(function (err) {
        endGeAnimateBusy();
        setGeAnimateProgress(null);
        var msg = (err && err.message) || String(err || "failed");
        setGeAnimateStatus(msg, "err");
        setStatus("GE animate failed: " + msg, true);
      });

    return { ok: true };
  }

  function cancelGeAnimate() {
    geAnimate.cancel = true;
    setGeAnimateStatus("Cancelling…");
    endGeAnimateBusy();
    setGeAnimateProgress(null);
    setGeAnimateStatus("Cancelled.", "err");
  }

  var geAnimatePromptPending = null;

  function hideGeAnimatePrompt() {
    var modal = $("ge-animate-prompt");
    if (modal) modal.hidden = true;
    geAnimatePromptPending = null;
  }

  function openGeAnimatePrompt(itemId) {
    itemId = Number(itemId);
    if (!itemId) return Promise.resolve({ ok: false, cancelled: true, error: "No item." });
    if (geAnimate.busy) {
      return Promise.resolve({ ok: false, error: "Already animating — wait or Cancel." });
    }
    if (noteOf(itemId)) {
      return Promise.resolve({
        ok: false,
        error: "Notes are text fillers — pick an image item to animate.",
      });
    }
    var modal = $("ge-animate-prompt");
    var ta = $("ge-animate-direction");
    var lead = $("ge-animate-prompt-lead");
    if (!modal || !ta) {
      // Fallback if HTML missing — start with no direction
      return Promise.resolve({ ok: true, direction: "", itemId: itemId });
    }
    if (lead) {
      lead.textContent =
        "Optional direction for " +
        kindLabel(itemId) +
        " — leave blank for default motion.";
    }
    // Keep last typed direction as convenience; still optional
    modal.hidden = false;
    ta.focus();
    try {
      ta.setSelectionRange(ta.value.length, ta.value.length);
    } catch (e) {}

    return new Promise(function (resolve) {
      geAnimatePromptPending = {
        itemId: itemId,
        resolve: resolve,
      };
    });
  }

  function confirmGeAnimatePrompt() {
    if (!geAnimatePromptPending) return;
    var pending = geAnimatePromptPending;
    var ta = $("ge-animate-direction");
    var direction = ta ? String(ta.value || "").trim() : "";
    hideGeAnimatePrompt();
    pending.resolve({ ok: true, direction: direction, itemId: pending.itemId });
  }

  function cancelGeAnimatePrompt() {
    if (!geAnimatePromptPending) {
      hideGeAnimatePrompt();
      return;
    }
    var pending = geAnimatePromptPending;
    hideGeAnimatePrompt();
    pending.resolve({ ok: false, cancelled: true, error: "Cancelled." });
  }

  function sendItemToAnimate(itemId) {
    return openGeAnimatePrompt(itemId).then(function (res) {
      if (!res || !res.ok) {
        if (res && res.cancelled) return { ok: false, error: "Cancelled." };
        return { ok: false, error: (res && res.error) || "Cancelled." };
      }
      return startGeAnimateForItem(res.itemId, res.direction);
    });
  }

  function openSellForItem(itemId) {
    itemId = Number(itemId);
    if (!itemId) return { ok: false, error: "No item." };
    if (noteOf(itemId)) return { ok: false, error: "Notes are forge fillers — not sellable on GE." };
    var invHave = qtyOf(PLAYER_ID, itemId);
    var bankHave = bankQty(PLAYER_ID, itemId);
    if (invHave < 1 && bankHave < 1) {
      return { ok: false, error: "You do not own that item." };
    }
    if (invHave < 1 && bankHave > 0) {
      var wd = withdrawItem(itemId, 1);
      if (!wd.ok) {
        // Inventory full — still open sell UI with selection; user can free a slot.
        selected = itemId;
        openSetup("sell", 0);
        return {
          ok: false,
          error: wd.error + " Selected for sell — free inventory space or sell after withdrawing.",
        };
      }
    }
    selected = itemId;
    openSetup("sell", 0);
    return { ok: true };
  }

  function openAnimateTab() {
    var tab = document.querySelector('.tab[data-tab="animate"]');
    if (tab) {
      tab.click();
      return true;
    }
    try {
      window.dispatchEvent(new Event("animate-show"));
    } catch (e) {}
    return false;
  }

  function sendForgeResultToAnimate() {
    if (!lastForgeResult) {
      setForgeStatus("No forged result to animate.", true);
      return;
    }
    sendItemToAnimate(lastForgeResult).then(function (res) {
      if (!res) return;
      if (!res.ok) {
        if (res.error && res.error !== "Cancelled.") setForgeStatus(res.error, true);
        return;
      }
      setForgeStatus("Animating forged #" + lastForgeResult + " in Grand Exchange…");
    });
  }

  function clearForgeSlot(slotIndex) {
    slotIndex = Number(slotIndex);
    if (slotIndex < 0 || slotIndex > 2) return;
    forgeSlots[slotIndex] = null;
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
    try {
      var geAspect = selectedForgeAspect();
      var spellAspect = document.getElementById("spell-aspect");
      if (spellAspect && geAspect) spellAspect.value = geAspect;
    } catch (eAsp) {}
    var tab = document.querySelector('.tab[data-tab="spellforge"]');
    if (tab) {
      tab.click();
      // Sync after the Spellforge tab is visible so renderSlots paints into a live panel.
      setTimeout(function () {
        try {
          syncForgeToSpellforge();
          if (window.SpellforgeAPI && typeof window.SpellforgeAPI.refresh === "function") {
            window.SpellforgeAPI.refresh();
          }
        } catch (e) {}
      }, 50);
      return;
    }
    try {
      syncForgeToSpellforge();
      window.dispatchEvent(new Event("spellforge-show"));
    } catch (e) {}
  }

  var forgeBusy = false;

  function geApiUrl(path) {
    try {
      if (window.SpellforgeAPI && typeof window.SpellforgeAPI.apiUrl === "function") {
        return window.SpellforgeAPI.apiUrl(path);
      }
    } catch (e) {}
    return path;
  }


  function geAutoSoftenOn() {
    var el = $("ge-auto-soften");
    if (el) return !!el.checked;
    try {
      var v = localStorage.getItem("spellforge_auto_soften_v1");
      if (v == null) return true;
      return v !== "0" && v !== "false";
    } catch (e) {
      return true;
    }
  }

  function geSoftenPrompt(text) {
    if (!geAutoSoftenOn()) return String(text || "");
    try {
      if (window.SpellforgeAPI && typeof window.SpellforgeAPI.softenPromptForModeration === "function") {
        return window.SpellforgeAPI.softenPromptForModeration(text);
      }
    } catch (e) {}
    // Lightweight fallback if Spellforge not loaded
    var s = String(text || "");
    s = s.replace(/\b(porn|nude|naked|nsfw|gore|rape|underage|lolita)\b/gi, "art study");
    s = s.replace(/\b(batman|superman|spiderman|marvel|disney|pokemon)\b/gi, "heroic figure");
    return s;
  }

  function buildForgePrompt(parents) {
    var lines = [
      "Create a brand-new original painting that fuses these three influences into one fresh composition.",
      "This is NOT a remake, collage, or near-copy of any source.",
    ];
    parents.forEach(function (id, idx) {
      if (colorChipOf(id)) {
        lines.push(
          "COLOR LOCK " +
            (idx + 1) +
            ": " +
            String(fullDescFor(id) || "").trim()
        );
        return;
      }
      lines.push(
        "Influence " +
          (idx + 1) +
          " (" +
          kindLabel(id) +
          " — " +
          titleFor(id) +
          "): " +
          String(fullDescFor(id) || descFor(id) || "").trim()
      );
    });
    lines.push("Invented scene · original painting · cohesive style.");
    var prompt = lines.filter(Boolean).join("\n\n");
    prompt = geSoftenPrompt(prompt);
    if (prompt.length > 7000) prompt = prompt.slice(0, 7000);
    return prompt;
  }

  function pollForgeJob(jobId, attemptsLeft) {
    attemptsLeft = attemptsLeft == null ? 120 : attemptsLeft;
    if (attemptsLeft <= 0) return Promise.reject(new Error("Timed out waiting for generated image."));
    return fetch(geApiUrl("/api/jobs/" + encodeURIComponent(jobId)), { cache: "no-store" })
      .then(function (r) {
        return r.json().then(function (d) {
          return { ok: r.ok, d: d };
        });
      })
      .then(function (res) {
        var d = res.d || {};
        var st = String(d.status || "").toLowerCase();
        if (st === "done" || st === "completed" || st === "success") {
          var img = d.image || (d.images && d.images[0]);
          var url = (img && img.url) || d.url || d.image_url || "";
          if (url) return url;
          throw new Error("Job finished but no image URL.");
        }
        if (st === "failed" || st === "error") {
          throw new Error((d.error && d.error.message) || d.error || "Generate job failed.");
        }
        setForgeStatus("Generating image… (" + (121 - attemptsLeft) + "s)");
        return new Promise(function (resolve) {
          setTimeout(resolve, 1000);
        }).then(function () {
          return pollForgeJob(jobId, attemptsLeft - 1);
        });
      });
  }

  function generateForgeImage(parents, prompt) {
    var spellIds = parents.filter(function (id) {
      return id >= 1 && id <= 1000;
    });
    var spellDetails = parents.map(function (n, s) {
      return {
        number: n,
        title: titleFor(n),
        description: String(fullDescFor(n) || "").slice(0, 1800),
        prompt: String(descFor(n) || "").slice(0, 800),
        source: "influence-text",
        slot: s,
      };
    });
    var jobId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : "ge-forge-" + Date.now();
    return fetch(geApiUrl("/api/generate-stasis-vision"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        job_id: jobId,
        stasis: prompt,
        prompt: prompt,
        fused_prompt: prompt,
        buzz_words: ["original painting", "brand new composition", "invented scene"],
        spells: spellIds,
        spell_details: spellDetails,
        aspect_ratio: selectedForgeAspect(),
        mag_fresh: true,
        fresh_variation: true,
        spell_cast: false,
        attach_references: false,
        reference_image: "",
        spell_reference_image: "",
        source: "grand-exchange-forge",
        product_mode: "original_fusion",
      }),
      cache: "no-store",
    }).then(function (r) {
      return r.json().then(function (d) {
        if (r.status === 202 || (d && (d.status === "queued" || d.status === "pending") && d.job_id)) {
          return pollForgeJob(d.job_id || jobId);
        }
        if (!r.ok) {
          var errMsg =
            (d && d.error && d.error.message) || (d && d.error) || "Generate failed (HTTP " + r.status + ")";
          throw new Error(typeof errMsg === "string" ? errMsg : JSON.stringify(errMsg));
        }
        var img = d && (d.image || (d.images && d.images[0]));
        if (img && img.url) return img.url;
        if (d && d.job_id) return pollForgeJob(d.job_id);
        throw new Error("No image returned from generate.");
      });
    });
  }

  function combineForge() {
    if (forgeBusy) {
      setForgeStatus("Already combining — wait for the image…", true);
      return;
    }
    var a = forgeSlots[0];
    var b = forgeSlots[1];
    var c = forgeSlots[2];
    if (a == null || b == null || c == null) {
      setForgeStatus("Fill all 3 Spellforge slots before combining.", true);
      return;
    }
    var parents = [Number(a), Number(b), Number(c)];
    for (var i = 0; i < 3; i++) {
      if (noteOf(parents[i]) || colorChipOf(parents[i])) continue;
      if (ownedQty(parents[i]) < 1) {
        setForgeStatus("Missing stock for " + kindLabel(parents[i]) + " (need 1 in inv or bank).", true);
        return;
      }
    }

    // Stay on the open Grand Exchange UI — never hand off to Spellforge tab mid-combine.
    if (!exchangeOpen) openExchangeUi();

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
    var prompt = buildForgePrompt(parents);

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

    function finish(visionUrl, genErr) {
      forgeBusy = false;
      var combineBtn = $("ge-forge-combine");
      if (combineBtn) combineBtn.disabled = false;
      if (visionUrl) {
        entry.imageUrl = visionUrl;
        entry.thumb = visionUrl;
        thumbOverrides[String(id)] = assetUrl(visionUrl);
      }
      for (var j = 0; j < 3; j++) {
        // Notes + color chips are reusable influences — do not consume from pack
        if (noteOf(parents[j]) || colorChipOf(parents[j])) continue;
        if (!consumeOwned(parents[j], 1)) {
          setForgeStatus("Could not consume materials after forge.", true);
          return;
        }
      }
      addInv(PLAYER_ID, id, 1);
      forgeSlots = [null, null, null];
      lastForgeResult = id;
      grantXp(FORGE_XP);
      if (!exchangeOpen) openExchangeUi();
      // Show the new image immediately (before save — save must not wipe live thumb)
      showForgeResult(id);
      render();
      saveState();
      if (visionUrl) {
        setForgeStatus("Forged " + titleFor(id) + " (#" + id + ") with new image — in inventory. +" + FORGE_XP + " XP");
      } else {
        setForgeStatus(
          "Forged #" +
            id +
            " into inventory, but image gen failed" +
            (genErr ? ": " + genErr : ".") +
            " Using parent thumb. Keep start_server.bat running for new images. +" +
            FORGE_XP +
            " XP",
          true
        );
      }
    }

    forgeBusy = true;
    var btn = $("ge-forge-combine");
    if (btn) btn.disabled = true;
    setForgeStatus("Combining — generating a new image (stay on Grand Exchange)…");
    generateForgeImage(parents, prompt)
      .then(function (url) {
        finish(url || null, null);
      })
      .catch(function (err) {
        var msg = (err && err.message) || String(err || "generate failed");
        finish(null, msg);
      });
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

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function boothRect() {
    return { x: 42, y: 18, w: 16, h: 18 };
  }

  function nearBooth() {
    var b = boothRect();
    var cx = b.x + b.w / 2;
    var cy = b.y + b.h / 2;
    var dx = playerPos.x - cx;
    var dy = playerPos.y - cy;
    return Math.sqrt(dx * dx + dy * dy) < 14;
  }

  function applyPlayerDom() {
    var el = $("ge-player");
    if (!el) return;
    el.style.left = playerPos.x + "%";
    el.style.top = playerPos.y + "%";
  }

  function initNpcs() {
    var nodes = document.querySelectorAll("#ge-world-stage .ge-world-npc");
    npcStates = [];
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var x = parseFloat(el.style.left) || 20 + i * 15;
      var y = parseFloat(el.style.top) || 40 + (i % 3) * 10;
      npcStates.push({
        el: el,
        x: x,
        y: y,
        vx: (Math.random() - 0.5) * 6,
        vy: (Math.random() - 0.5) * 6,
        idle: Math.random() * 2,
      });
    }
  }

  function collidesBooth(x, y) {
    var b = boothRect();
    return x > b.x + 1 && x < b.x + b.w - 1 && y > b.y + 2 && y < b.y + b.h - 1;
  }

  function worldStep(dt) {
    if (exchangeOpen) return;
    var mx = 0;
    var my = 0;
    if (worldKeys.ArrowLeft || worldKeys.a || worldKeys.A) mx -= 1;
    if (worldKeys.ArrowRight || worldKeys.d || worldKeys.D) mx += 1;
    if (worldKeys.ArrowUp || worldKeys.w || worldKeys.W) my -= 1;
    if (worldKeys.ArrowDown || worldKeys.s || worldKeys.S) my += 1;
    if (mx || my) {
      var len = Math.sqrt(mx * mx + my * my) || 1;
      var sp = PLAYER_SPEED * dt;
      var nx = playerPos.x + (mx / len) * sp;
      var ny = playerPos.y + (my / len) * sp;
      nx = clamp(nx, 4, WORLD_W - 4);
      ny = clamp(ny, 8, WORLD_H - 4);
      if (!collidesBooth(nx, playerPos.y)) playerPos.x = nx;
      if (!collidesBooth(playerPos.x, ny)) playerPos.y = ny;
      walkAcc += sp;
      while (walkAcc >= WALK_DIST_PER_XP) {
        walkAcc -= WALK_DIST_PER_XP;
        grantXp(WALK_XP_STEP, { walk: true });
      }
      applyPlayerDom();
    }
    // Idle / wandering bankers
    for (var i = 0; i < npcStates.length; i++) {
      var n = npcStates[i];
      n.idle -= dt;
      if (n.idle <= 0) {
        if (Math.random() < 0.45) {
          n.vx = 0;
          n.vy = 0;
          n.idle = 0.8 + Math.random() * 2.2;
        } else {
          var ang = Math.random() * Math.PI * 2;
          var spd = 3 + Math.random() * 5;
          n.vx = Math.cos(ang) * spd;
          n.vy = Math.sin(ang) * spd;
          n.idle = 1.2 + Math.random() * 2.5;
        }
      }
      var nxx = clamp(n.x + n.vx * dt, 6, 94);
      var nyy = clamp(n.y + n.vy * dt, 12, 92);
      if (collidesBooth(nxx, nyy)) {
        n.vx *= -1;
        n.vy *= -1;
      } else {
        n.x = nxx;
        n.y = nyy;
      }
      if (n.el) {
        n.el.style.left = n.x + "%";
        n.el.style.top = n.y + "%";
      }
    }
  }

  function worldLoop(ts) {
    if (exchangeOpen) {
      worldRaf = 0;
      return;
    }
    if (!worldLastTs) worldLastTs = ts;
    var dt = Math.min(0.05, (ts - worldLastTs) / 1000);
    worldLastTs = ts;
    worldStep(dt);
    worldRaf = requestAnimationFrame(worldLoop);
  }

  function startWorldLoop() {
    if (worldRaf) return;
    worldLastTs = 0;
    worldRaf = requestAnimationFrame(worldLoop);
  }

  function stopWorldLoop() {
    if (worldRaf) cancelAnimationFrame(worldRaf);
    worldRaf = 0;
    worldLastTs = 0;
    worldKeys = Object.create(null);
  }

  function bindWorldKeys() {
    if (bindWorldKeys._on) return;
    bindWorldKeys._on = true;
    window.addEventListener("keydown", onWorldKeyDown, true);
    window.addEventListener("keyup", onWorldKeyUp, true);
  }

  function unbindWorldKeys() {
    if (!bindWorldKeys._on) return;
    bindWorldKeys._on = false;
    window.removeEventListener("keydown", onWorldKeyDown, true);
    window.removeEventListener("keyup", onWorldKeyUp, true);
    worldKeys = Object.create(null);
  }

  function onWorldKeyDown(e) {
    if (exchangeOpen) return;
    var panel = $("panel-exchange");
    if (panel && panel.hidden) return;
    var tag = (e.target && e.target.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    var k = e.key;
    if (
      k === "ArrowUp" ||
      k === "ArrowDown" ||
      k === "ArrowLeft" ||
      k === "ArrowRight" ||
      k === "w" ||
      k === "a" ||
      k === "s" ||
      k === "d" ||
      k === "W" ||
      k === "A" ||
      k === "S" ||
      k === "D"
    ) {
      worldKeys[k] = true;
      e.preventDefault();
    } else if (k === "e" || k === "E") {
      if (nearBooth()) {
        e.preventDefault();
        openExchangeUi();
      }
    }
  }

  function onWorldKeyUp(e) {
    var k = e.key;
    if (k in worldKeys) delete worldKeys[k];
  }

  function openExchangeUi() {
    exchangeOpen = true;
    stopWorldLoop();
    unbindWorldKeys();
    var world = $("ge-world");
    var ui = $("ge-exchange-ui");
    if (world) world.hidden = true;
    if (ui) ui.hidden = false;
    showView("home");
    render();
    startTicks();
    setStatus("Grand Exchange open — ✕ or Close returns to the courtyard.");
  }

  function closeExchangeUi() {
    exchangeOpen = false;
    stopTicks();
    var world = $("ge-world");
    var ui = $("ge-exchange-ui");
    if (ui) ui.hidden = true;
    if (world) world.hidden = false;
    applyPlayerDom();
    updateLevelHud();
    bindWorldKeys();
    startWorldLoop();
    if ($("ge-world-stage")) {
      try {
        $("ge-world-stage").focus();
      } catch (err) {}
    }
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
          setStatus("Collected. +" + COLLECT_XP + " XP");
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
    if ($("ge-random-item") && !$("ge-random-item").dataset.bound) {
      $("ge-random-item").dataset.bound = "1";
      $("ge-random-item").addEventListener("click", function () {
        applyRandomItem();
      });
    }
    if ($("ge-random-pick") && !$("ge-random-pick").dataset.bound) {
      $("ge-random-pick").dataset.bound = "1";
      $("ge-random-pick").addEventListener("click", function () {
        if (applyRandomItem()) {
          showView("setup");
          renderSetup();
        }
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
    if ($("ge-tag-filter") && !$("ge-tag-filter").dataset.bound) {
      $("ge-tag-filter").dataset.bound = "1";
      $("ge-tag-filter").addEventListener("change", renderCatalog);
    }
    if ($("ge-open-exchange") && !$("ge-open-exchange").dataset.bound) {
      $("ge-open-exchange").dataset.bound = "1";
      $("ge-open-exchange").addEventListener("click", openExchangeUi);
    }
    if ($("ge-close-exchange") && !$("ge-close-exchange").dataset.bound) {
      $("ge-close-exchange").dataset.bound = "1";
      $("ge-close-exchange").addEventListener("click", closeExchangeUi);
    }
    if ($("ge-booth") && !$("ge-booth").dataset.bound) {
      $("ge-booth").dataset.bound = "1";
      $("ge-booth").addEventListener("click", function () {
        if (!exchangeOpen) openExchangeUi();
      });
    }
    if (!window.__geWorldKeysBound) {
      window.__geWorldKeysBound = true;
      bindWorldKeys();
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
        setStatus("Collected completed offers. +" + COLLECT_XP + " XP each");
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
        if (!confirm("Reset Grand Exchange? This clears inventory, bank, offers, and level XP.")) return;
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
        e.stopPropagation();
        var id = Number(btn.getAttribute("data-ge-inv"));
        selectedInvItem = id;
        selected = id;
        showForgeContextMenu(e.clientX, e.clientY, id, "inv");
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
        e.stopPropagation();
        var id = Number(btn.getAttribute("data-ge-bank"));
        selectedBankItem = id;
        selected = id;
        showForgeContextMenu(e.clientX, e.clientY, id, "bank");
      });
    }
    var forgeMenu = $("ge-forge-menu");
    if (forgeMenu && !forgeMenu.dataset.bound) {
      forgeMenu.dataset.bound = "1";
      forgeMenu.addEventListener("click", function (e) {
        var actionBtn = e.target.closest("[data-ge-action]");
        var pick = e.target.closest("[data-forge-pick]");
        if (!actionBtn && !pick) return;
        e.preventDefault();
        e.stopPropagation();
        var id = Number(forgeMenu.dataset.itemId);
        var source = forgeMenu.dataset.source || "inv";
        hideForgeContextMenu();
        if (actionBtn) {
          var action = actionBtn.getAttribute("data-ge-action");
          if (action === "view") {
            var viewRes = openItemFullscreen(id);
            if (!viewRes.ok) setStatus(viewRes.error, true);
            return;
          }
          if (action === "description") {
            var dRes = openItemDescription(id);
            if (!dRes.ok) setStatus(dRes.error, true);
            return;
          }
          if (action === "force-load") {
            forceLoadItemImage(id);
            return;
          }
          if (action === "animate") {
            sendItemToAnimate(id).then(function (anRes) {
              if (!anRes) return;
              if (!anRes.ok) {
                if (anRes.error && anRes.error !== "Cancelled.") setStatus(anRes.error, true);
                return;
              }
              setStatus("Animating in Grand Exchange…");
            });
            return;
          }
          if (action === "sell") {
            var sellRes = openSellForItem(id);
            if (!sellRes.ok) setStatus(sellRes.error, true);
            else setStatus("Sell offer setup for " + kindLabel(id) + ".");
            render();
            return;
          }
          if (action === "deposit") {
            var depRes = depositItem(id, 1);
            setStatus(depRes.ok ? "Deposited " + kindLabel(id) : depRes.error, !depRes.ok);
            render();
            return;
          }
          if (action === "withdraw") {
            var wdRes = withdrawItem(id, 1);
            setStatus(wdRes.ok ? "Withdrew " + kindLabel(id) : wdRes.error, !wdRes.ok);
            render();
            return;
          }
          return;
        }
        var slot = Number(pick.getAttribute("data-forge-pick"));
        var res = placeInForge(id, slot);
        renderForgeSlots();
        if (!res.ok) setForgeStatus(res.error, true);
        else setForgeStatus("Placed " + kindLabel(id) + " in Spellforge slot " + (res.slot + 1) + ".");
        renderBags();
      });
      document.addEventListener(
        "pointerdown",
        function (e) {
          var menu = $("ge-forge-menu");
          if (!menu || menu.hidden) return;
          if (menu.contains(e.target)) return;
          var opened = Number(menu.dataset.openedAt) || 0;
          if (Date.now() - opened < 300) return;
          hideForgeContextMenu();
        },
        true
      );
      document.addEventListener(
        "keydown",
        function (e) {
          if (e.key === "Escape") {
            hideForgeContextMenu();
            hideGeLightbox();
            if ($("ge-animate-prompt") && !$("ge-animate-prompt").hidden) {
              cancelGeAnimatePrompt();
            }
            closeGeColorPopover();
          }
        },
        true
      );
    }
    if ($("ge-auto-soften") && !$("ge-auto-soften").dataset.bound) {
      $("ge-auto-soften").dataset.bound = "1";
      try {
        var softV = localStorage.getItem("spellforge_auto_soften_v1");
        $("ge-auto-soften").checked = softV == null ? true : softV !== "0" && softV !== "false";
      } catch (eSoft) {
        $("ge-auto-soften").checked = true;
      }
      $("ge-auto-soften").addEventListener("change", function () {
        try {
          localStorage.setItem(
            "spellforge_auto_soften_v1",
            $("ge-auto-soften").checked ? "1" : "0"
          );
        } catch (eSet) {}
        var sf = document.getElementById("spell-auto-soften");
        if (sf) sf.checked = $("ge-auto-soften").checked;
      });
    }
    if ($("ge-animate-cancel") && !$("ge-animate-cancel").dataset.bound) {
      $("ge-animate-cancel").dataset.bound = "1";
      $("ge-animate-cancel").addEventListener("click", cancelGeAnimate);
    }
    if ($("ge-animate-prompt-go") && !$("ge-animate-prompt-go").dataset.bound) {
      $("ge-animate-prompt-go").dataset.bound = "1";
      $("ge-animate-prompt-go").addEventListener("click", confirmGeAnimatePrompt);
    }
    if ($("ge-animate-prompt-cancel") && !$("ge-animate-prompt-cancel").dataset.bound) {
      $("ge-animate-prompt-cancel").dataset.bound = "1";
      $("ge-animate-prompt-cancel").addEventListener("click", cancelGeAnimatePrompt);
    }
    if ($("ge-animate-prompt") && !$("ge-animate-prompt").dataset.boundBackdrop) {
      $("ge-animate-prompt").dataset.boundBackdrop = "1";
      $("ge-animate-prompt").addEventListener("click", function (e) {
        if (e.target === $("ge-animate-prompt")) cancelGeAnimatePrompt();
      });
    }
    if ($("ge-animate-direction") && !$("ge-animate-direction").dataset.boundKeys) {
      $("ge-animate-direction").dataset.boundKeys = "1";
      $("ge-animate-direction").addEventListener("keydown", function (e) {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          confirmGeAnimatePrompt();
        }
      });
    }
    if ($("ge-lightbox-close") && !$("ge-lightbox-close").dataset.bound) {
      $("ge-lightbox-close").dataset.bound = "1";
      $("ge-lightbox-close").addEventListener("click", hideGeLightbox);
    }
    if ($("ge-lightbox") && !$("ge-lightbox").dataset.boundBg) {
      $("ge-lightbox").dataset.boundBg = "1";
      $("ge-lightbox").addEventListener("click", function (e) {
        if (e.target === $("ge-lightbox")) hideGeLightbox();
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
    if ($("ge-forge-to-animate") && !$("ge-forge-to-animate").dataset.bound) {
      $("ge-forge-to-animate").dataset.bound = "1";
      $("ge-forge-to-animate").addEventListener("click", sendForgeResultToAnimate);
    }
    for (var ni = 0; ni < 3; ni++) {
      (function (slot) {
        var noteBtn = $("ge-note-slot-" + slot);
        if (noteBtn && !noteBtn.dataset.bound) {
          noteBtn.dataset.bound = "1";
          noteBtn.addEventListener("click", function () {
            var ta = $("ge-note-text");
            var res = placeNoteInForge(slot, ta && ta.value);
            renderForgeSlots();
            if (!res.ok) setForgeStatus(res.error, true);
            else {
              setForgeStatus("Note placed in Spellforge slot " + (slot + 1) + ".");
              if (ta) ta.value = "";
            }
          });
        }
      })(ni);
    }
    if ($("ge-note-text") && !$("ge-note-text").dataset.colorBound) {
      $("ge-note-text").dataset.colorBound = "1";
      $("ge-note-text").addEventListener("input", function () {
        renderNoteColorHits();
      });
      renderNoteColorHits();
    }
    if (!document.documentElement.dataset.geColorHitBound) {
      document.documentElement.dataset.geColorHitBound = "1";
      document.addEventListener("click", function (e) {
        // Toolbar / edit actions in description
        var editBtn = e.target.closest(".ge-desc-edit-btn");
        if (editBtn) {
          e.preventDefault();
          startGeDescTextEdit(Number(editBtn.getAttribute("data-item-id")));
          return;
        }
        var defBtn = e.target.closest(".ge-desc-default-btn");
        if (defBtn) {
          e.preventDefault();
          revertGeDescText(Number(defBtn.getAttribute("data-item-id")));
          return;
        }
        var saveBtn = e.target.closest(".ge-desc-edit-save");
        if (saveBtn) {
          e.preventDefault();
          saveGeDescTextEdit(Number(saveBtn.getAttribute("data-item-id")));
          return;
        }
        var cancelBtn = e.target.closest(".ge-desc-edit-cancel");
        if (cancelBtn) {
          e.preventDefault();
          openItemDescription(Number(cancelBtn.getAttribute("data-item-id")));
          return;
        }

        var hit = e.target.closest(".ge-color-hit");
        if (hit) {
          e.preventDefault();
          e.stopPropagation();
          openGeColorPopover(hit);
          return;
        }

        var pop = document.getElementById("ge-color-popover");
        if (!pop) return;
        if (pop.contains(e.target)) return;
        // Also ignore if the event path includes the popover (shadow/native quirks)
        var path = typeof e.composedPath === "function" ? e.composedPath() : [];
        for (var pi = 0; pi < path.length; pi++) {
          if (path[pi] === pop) return;
        }
        var until = Number(pop.dataset.suppressOutsideUntil || 0);
        if (Date.now() < until) return;
        closeGeColorPopover();
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
    initNpcs();
    applyPlayerDom();
    Promise.all([loadAnalyses(), loadRoster(), loadArsenal()]).then(function () {
      ensurePlayerStock();
      ensureNpcSeedStock();
      seedNpcOffers();
      saveState();
      populateTagFilter();
      updateLevelHud();
      if (exchangeOpen) {
        var world = $("ge-world");
        var ui = $("ge-exchange-ui");
        if (world) world.hidden = true;
        if (ui) ui.hidden = false;
        showView("home");
        render();
        startTicks();
      } else {
        closeExchangeUi();
      }
      var extras = arsenalExtraNums.length;
      setStatus(
        "Welcome · arsenal " +
          arsenalList().length +
          " (paintings + gen/phone/sketches" +
          (extras ? " · " + extras + " extras" : "") +
          "). Walk the courtyard or Open Grand Exchange."
      );
    });
  }

  function onHide() {
    stopTicks();
    stopWorldLoop();
    unbindWorldKeys();
    saveState();
  }

  function init() {
    state = loadState();
    npcRuntime = { inventory: {}, bank: {} };
    try {
      purgePresetColorChips();
    } catch (eChip) {}
    try {
      var moved = enforcePlayerInvCap();
      if (moved > 0) {
        saveState();
      } else {
        saveState();
      }
    } catch (eCap) {}
    window.addEventListener("pagehide", function () {
      saveState();
    });
    window.addEventListener("beforeunload", function () {
      saveState();
    });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") saveState();
    });
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
