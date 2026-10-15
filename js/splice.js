/* Splice — CRISPR-style linear word descrambler. Punctuation stays locked,
 * every space is a "?" (the start of a new idea), letters are a shared pool. */
(function () {
  "use strict";
  var E = window.SpliceEngine;
  var HIST_KEY = "splice_history_v1";
  var DIAL_KEY = "splice_dial_v1";
  var SRC_KEY = "splice_source_v1";
  var SLOT_TEXT_KEY = "spellforge_slot_text_v1";
  var ROMAN = ["I", "II", "III"];

  var st = {
    text: "",
    strand: null,
    index: null,
    indexFor: "",
    fill: [],
    dial: 0.35,
    sel: -1,
    log: [],
    history: [],
    busy: false,
    gen: false,
  };
  var wordCache = {}; // letter -> Promise<string[]>

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function apiUrl(path) {
    var base = String(window.SPELLFORGE_API_BASE || "").replace(/\/$/, "");
    return base ? base + path : path;
  }
  function setStatus(msg, err) {
    var el = $("sp-status");
    if (!el) return;
    el.textContent = msg || "";
    el.classList.toggle("is-error", !!err);
  }

  /* ---------- source text ---------- */
  function spellforgeSources() {
    var out = [];
    var api = window.SpellforgeAPI;
    var slotTexts = [];
    try {
      if (api && typeof api.getSlotTexts === "function") slotTexts = api.getSlotTexts() || [];
    } catch (e) {}
    if (!slotTexts.some(Boolean)) {
      try {
        var saved = JSON.parse(localStorage.getItem(SLOT_TEXT_KEY) || "[]");
        if (Array.isArray(saved)) slotTexts = saved.map(function (r) { return (r && r.text) || ""; });
      } catch (e2) {}
    }
    for (var i = 0; i < 3; i++) {
      var t = String(slotTexts[i] || "").trim();
      if (t) out.push({ id: "slot" + i, label: "Spell " + ROMAN[i], text: t });
    }
    var fusion = window.spellforgeFusion || (api && api.getFusion && api.getFusion()) || null;
    var stasis = String((fusion && fusion.stasis) || "").trim();
    if (stasis) out.unshift({ id: "vision", label: "Latest generated description", text: stasis });
    return out;
  }

  function fillSourcePicker() {
    var sel = $("sp-source");
    if (!sel) return;
    var srcs = spellforgeSources();
    var cur = sel.value;
    sel.innerHTML =
      srcs.map(function (s) { return '<option value="' + s.id + '">' + esc(s.label) + "</option>"; }).join("") +
      '<option value="paste">Paste my own text</option>';
    sel._srcs = srcs;
    if (cur && sel.querySelector('option[value="' + cur + '"]')) sel.value = cur;
  }

  function pickSource(id) {
    var sel = $("sp-source");
    var srcs = (sel && sel._srcs) || [];
    var hit = srcs.filter(function (s) { return s.id === id; })[0];
    var ta = $("sp-text");
    if (hit && ta) ta.value = hit.text;
    if (id === "paste" && ta) { ta.focus(); ta.select(); }
    loadStrand();
  }

  /* ---------- dictionary (lazy, only the letters in the pool) ---------- */
  function loadLetter(ch) {
    if (!wordCache[ch]) {
      wordCache[ch] = fetch("data/diction/" + ch + ".txt", { cache: "force-cache" })
        .then(function (r) { if (!r.ok) throw new Error("dict"); return r.text(); })
        .then(function (t) { return t.split(/\r?\n/); })
        .catch(function () { delete wordCache[ch]; return []; });
    }
    return wordCache[ch];
  }
  function ensureIndex() {
    var strand = st.strand;
    if (!strand) return Promise.resolve(null);
    var sig = strand.pool.join(",");
    if (st.index && st.indexFor === sig) return Promise.resolve(st.index);
    var letters = [];
    for (var i = 0; i < 26; i++) if (strand.pool[i]) letters.push(String.fromCharCode(97 + i));
    setStatus("Loading the dictionary for " + letters.length + " letters…");
    return Promise.all(letters.map(loadLetter)).then(function (lists) {
      var raw = [];
      lists.forEach(function (l) { Array.prototype.push.apply(raw, l); });
      st.index = E.buildIndex(E.cleanWords(raw), strand.pool);
      st.indexFor = sig;
      return st.index;
    });
  }

  /* ---------- strand ---------- */
  function loadStrand() {
    var ta = $("sp-text");
    st.text = String((ta && ta.value) || "").trim();
    try { localStorage.setItem(SRC_KEY, st.text); } catch (e) {}
    st.strand = st.text ? E.parseStrand(st.text) : null;
    st.fill = [];
    st.sel = -1;
    st.log = [];
    renderStrand();
    renderResult();
    renderLog();
  }

  function renderStrand() {
    var host = $("sp-strand");
    if (!host) return;
    if (!st.strand || !st.strand.tokens.length) {
      host.innerHTML = '<span class="sp-empty">Pick a Spellforge description or paste text.</span>';
      return;
    }
    var html = "";
    st.strand.tokens.forEach(function (t) {
      if (t.type === "gap") html += '<span class="sp-gap" title="New idea">?</span>';
      else if (t.type === "anchor") html += '<span class="sp-anchor" title="Locked punctuation">' + esc(t.ch) + "</span>";
      else {
        html += '<span class="sp-gene">';
        for (var i = 0; i < t.src.length; i++) html += '<i class="sp-base">' + esc(t.src[i]) + "</i>";
        html += "</span>";
      }
    });
    host.innerHTML = html;
  }

  /* ---------- splice / cut / guide ---------- */
  function run(only) {
    if (!st.strand || !st.strand.slots.length) {
      setStatus("There are no letters to splice yet.", true);
      return Promise.resolve();
    }
    if (st.busy) return Promise.resolve();
    st.busy = true;
    return ensureIndex()
      .then(function (index) {
        var before = st.fill.map(function (f) { return f && f.word; });
        var t0 = performance.now();
        var r = E.splice(st.strand, index, { fill: st.fill }, { dial: st.dial, only: only == null ? undefined : only });
        var ms = Math.round(performance.now() - t0);
        st.fill = r.fill;
        if (only != null) {
          st.log.unshift({ kind: "Cut", slot: only, from: before[only] || "?", to: st.fill[only].word || "?" });
        } else {
          var changed = st.fill.filter(function (f, i) { return f && f.word !== before[i]; }).length;
          st.log.unshift({ kind: "Splice", slot: -1, from: "", to: changed + " slot" + (changed === 1 ? "" : "s") + " re-cut" });
        }
        if (st.log.length > 40) st.log.length = 40;
        var sentence = E.render(st.strand, st.fill);
        pushHistory(sentence);
        renderResult();
        renderLog();
        setStatus("Spliced in " + ms + " ms.");
      })
      .catch(function () { setStatus("The dictionary did not load. Try again.", true); })
      .then(function () { st.busy = false; });
  }

  function toggleGuide() {
    var f = st.fill[st.sel];
    if (!f || !f.word) { setStatus("Tap a word first, then press Guide.", true); return; }
    f.locked = !f.locked;
    st.log.unshift({ kind: f.locked ? "Guide" : "Unguide", slot: st.sel, from: "", to: f.word });
    renderResult();
    renderLog();
  }

  function cutSelected() {
    if (st.sel < 0 || !st.fill[st.sel]) { setStatus("Tap a word first, then press Cut.", true); return; }
    if (st.fill[st.sel].locked) { setStatus("That word is guided (locked). Unlock it to cut it.", true); return; }
    run(st.sel);
  }

  function currentSentence() {
    return st.strand && st.fill.length ? E.render(st.strand, st.fill) : "";
  }

  function renderResult() {
    var host = $("sp-result");
    if (!host) return;
    if (!st.strand || !st.fill.length) {
      host.innerHTML = '<span class="sp-empty">Press Splice to cut a new sentence from these letters.</span>';
    } else {
      var html = "";
      st.strand.tokens.forEach(function (t) {
        if (t.type === "gap") html += '<span class="sp-space"> </span>';
        else if (t.type === "anchor") html += '<span class="sp-anchor">' + esc(t.ch) + "</span>";
        else {
          var f = st.fill[t.slot];
          var cls = "sp-word" + (f && f.locked ? " is-locked" : "") + (st.sel === t.slot ? " is-sel" : "") + (f && f.word ? "" : " is-open");
          var shown = f && f.word ? (/[A-Z]/.test(t.src.charAt(0)) ? f.word.charAt(0).toUpperCase() + f.word.slice(1) : f.word) : "?";
          html += '<button type="button" class="' + cls + '" data-slot="' + t.slot + '">' + esc(shown) + "</button>";
        }
      });
      host.innerHTML = html;
    }
    renderMeter();
    var g = $("sp-guide");
    var f2 = st.fill[st.sel];
    if (g) g.textContent = f2 && f2.locked ? "Unguide" : "Guide";
  }

  function renderMeter() {
    var bar = $("sp-meter-fill"), lab = $("sp-meter-label"), left = $("sp-left");
    if (!st.strand) {
      if (lab) lab.textContent = "";
      if (bar) bar.style.width = "0%";
      if (left) left.textContent = "";
      return;
    }
    var total = st.strand.pool.reduce(function (a, b) { return a + b; }, 0);
    var pool = st.strand.pool.slice();
    st.fill.forEach(function (f) { if (f && f.word) for (var i = 0; i < 26; i++) pool[i] -= f.counts[i]; });
    var leftN = pool.reduce(function (a, b) { return a + b; }, 0);
    var used = total - leftN;
    if (bar) bar.style.width = (total ? Math.round((used / total) * 100) : 0) + "%";
    if (lab) lab.textContent = "Letters used " + used + " / " + total + " · left " + leftN;
    if (left) {
      var s = "";
      for (var k = 0; k < 26; k++) if (pool[k] > 0) s += String.fromCharCode(97 + k) + (pool[k] > 1 ? "×" + pool[k] : "") + " ";
      left.textContent = s ? "Left in pool: " + s.trim() : "Pool is empty.";
    }
  }

  function renderLog() {
    var host = $("sp-log");
    if (!host) return;
    host.innerHTML = st.log.length
      ? st.log
          .map(function (e) {
            var where = e.slot >= 0 ? " slot " + (e.slot + 1) : "";
            var what = e.kind === "Cut" ? esc(e.from) + " → " + esc(e.to) : esc(e.to);
            return "<li><b>" + e.kind + "</b>" + where + ": " + what + "</li>";
          })
          .join("")
      : '<li class="sp-empty">No cuts yet.</li>';
  }

  /* ---------- history ---------- */
  function loadHistory() {
    try {
      var h = JSON.parse(localStorage.getItem(HIST_KEY) || "[]");
      st.history = Array.isArray(h) ? h.slice(0, 30) : [];
    } catch (e) { st.history = []; }
  }
  function pushHistory(s) {
    if (!s || st.history[0] === s) return;
    st.history.unshift(s);
    if (st.history.length > 30) st.history.length = 30;
    try { localStorage.setItem(HIST_KEY, JSON.stringify(st.history)); } catch (e) {}
    renderHistory();
  }
  function renderHistory() {
    var host = $("sp-history");
    if (!host) return;
    host.innerHTML = st.history.length
      ? st.history
          .map(function (s, i) {
            return '<li><span class="sp-hist-text">' + esc(s) + '</span><button type="button" class="sp-mini" data-copy-hist="' + i + '">Copy</button></li>';
          })
          .join("")
      : '<li class="sp-empty">Spliced sentences show up here.</li>';
  }

  function copyText(s) {
    if (!s) return;
    var done = function () { setStatus("Copied."); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(s).then(done, function () { fallbackCopy(s); done(); });
    } else { fallbackCopy(s); done(); }
  }
  function fallbackCopy(s) {
    var ta = document.createElement("textarea");
    ta.value = s;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch (e) {}
    document.body.removeChild(ta);
  }

  /* ---------- Spellforge ---------- */
  function sendToSpell(slot) {
    var s = currentSentence();
    if (!s) { setStatus("Splice a sentence first.", true); return; }
    var api = window.SpellforgeAPI;
    if (!api || typeof api.equipNote !== "function") { setStatus("Spellforge is still loading. Try again in a moment.", true); return; }
    var res = api.equipNote(slot, s);
    if (res && res.ok) setStatus("Sent to Spellforge as Spell " + ROMAN[slot] + ".");
    else setStatus((res && res.error) || "Spellforge did not take it.", true);
  }

  /* ---------- Generate (same /api/generate-stasis-vision + job polling) ---------- */
  function extractImageUrl(p) {
    if (!p) return "";
    var img = p.image || (p.images && p.images[0]);
    return (img && (img.url || img.download_url || img.uri)) || p.image_url || p.output_url || p.result_url || "";
  }
  function pollJob(jobId, left) {
    if (left == null) left = 150;
    if (left <= 0) return Promise.reject(new Error("The painting took too long."));
    return fetch(apiUrl("/api/jobs/" + encodeURIComponent(jobId)), { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (job) {
        var s = String((job && job.status) || "").toLowerCase();
        if (s === "done" || s === "completed" || s === "success") {
          if (job.moderated) return { moderated: true, dropped: job.dropped || [] };
          var url = extractImageUrl(job);
          if (url) return url;
          var e0 = job && job.error;
          throw new Error((e0 && (e0.message || (typeof e0 === "string" ? e0 : ""))) || "The painting finished without an image.");
        }
        if (s === "failed" || s === "error" || s === "expired") {
          var e = job && job.error;
          throw new Error((e && (e.message || (typeof e === "string" ? e : ""))) || "The painting did not finish.");
        }
        return new Promise(function (res) { setTimeout(res, 1500); }).then(function () { return pollJob(jobId, left - 1); });
      });
  }
  function newJobId() {
    return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : "splice-" + Date.now() + "-" + Math.floor(Math.random() * 1e6);
  }
  function requestImage(prompt) {
    var jobId = newJobId();
    return fetch(apiUrl("/api/generate-stasis-vision"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        job_id: jobId,
        stasis: prompt,
        prompt: prompt,
        fused_prompt: prompt,
        buzz_words: ["spliced sentence", "original painting"],
        spells: [],
        aspect_ratio: "16:9",
        mag_fresh: true,
        fresh_variation: true,
        spell_cast: false,
        attach_references: false,
        source: "splice",
      }),
    })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, status: r.status, d: d || {} }; });
      })
      .then(function (res) {
        var d = res.d;
        if (d.moderated) return { moderated: true, dropped: d.dropped || [] };
        var url = extractImageUrl(d);
        if (url) return url;
        if (!res.ok && res.status !== 202) {
          var e = d.error;
          throw new Error((e && (e.message || (typeof e === "string" ? e : ""))) || "The painting did not start (HTTP " + res.status + ").");
        }
        return pollJob(d.job_id || jobId);
      });
  }
  function quietError(err) {
    var msg = String((err && err.message) || err || "");
    if (/combination-still-painting|quota|neuron|credits|capacity|rate limit|too many requests|insufficient balance|daily|4006|429/i.test(msg)) {
      return "Today's free image quota is used up. It resets at 6 PM (UTC-6). Try again after that.";
    }
    if (/api key|pollinations|cloudflare|incorrect api|failed to fetch|networkerror|load failed/i.test(msg)) {
      return "The painting did not start. Press Generate again.";
    }
    return msg.slice(0, 180) || "The painting did not start.";
  }
  function soften(prompt, dropped) {
    var out = String(prompt || "");
    (dropped || []).forEach(function (w) {
      w = String(w || "").trim();
      if (!w) return;
      out = out.replace(new RegExp("\\b" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "gi"), " ");
    });
    var api = window.SpellforgeAPI;
    if (api && api.autoSoftenEnabled && api.autoSoftenEnabled() && api.softenPromptForModeration) {
      out = api.softenPromptForModeration(out);
    }
    out = out.replace(/\s{2,}/g, " ").trim().slice(0, 900);
    return "Tasteful, non-graphic, symbolic painting. Fully clothed figures, no violence or gore. " + out;
  }
  function generate() {
    var s = currentSentence();
    if (!s) { setStatus("Splice a sentence first.", true); return; }
    if (st.gen) return;
    st.gen = true;
    var btn = $("sp-generate");
    if (btn) btn.disabled = true;
    var prompt = ("Original painting of this spliced sentence: " + s).slice(0, 1800);
    setStatus("Painting “" + s.slice(0, 70) + "”…");
    requestImage(prompt)
      .then(function (out) {
        if (out && out.moderated) {
          setStatus("The image filter declined that wording. Trying a gentler version…");
          prompt = soften(prompt, out.dropped);
          return requestImage(prompt);
        }
        return out;
      })
      .then(function (out) {
        if (out && out.moderated) throw new Error("The image filter declined this sentence. Cut a few words, then press Generate again.");
        if (!out || typeof out !== "string") throw new Error("The painting did not finish.");
        var img = $("sp-image");
        if (img) { img.src = out; img.hidden = false; }
        var api = window.SpellforgeAPI;
        if (api && typeof api.saveGenerated === "function") {
          return api.saveGenerated({ title: "Splice", url: out, prompt: prompt, tags: ["splice"] }).then(function (rec) {
            setStatus(rec ? "Saved “" + rec.title + " #" + rec.n + "” to Generated." : "Painted.");
          });
        }
        setStatus("Painted.");
      })
      .catch(function (err) { setStatus(quietError(err), true); })
      .then(function () {
        st.gen = false;
        if (btn) btn.disabled = false;
      });
  }

  /* ---------- thought dial (Engrams-style radial) ---------- */
  function dialName(v) { return v < 0.34 ? "Literal" : v < 0.67 ? "Shifted" : "Wild"; }
  function renderDial() {
    var d = $("sp-dial");
    if (!d) return;
    var angle = Math.round(st.dial * 330 + 15);
    d.style.setProperty("--radial-angle", angle + "deg");
    d.setAttribute("aria-valuenow", String(Math.round(st.dial * 100)));
    d.setAttribute("aria-valuetext", dialName(st.dial));
    var lab = $("sp-dial-label");
    if (lab) lab.textContent = dialName(st.dial) + " · " + Math.round(st.dial * 100);
    var val = d.querySelector(".engrams-radial-value");
    if (val) val.textContent = dialName(st.dial).charAt(0);
    Array.prototype.forEach.call(document.querySelectorAll("#panel-splice [data-dial]"), function (b) {
      b.classList.toggle("is-on", dialName(st.dial).toLowerCase() === b.getAttribute("data-dial"));
    });
  }
  function setDial(v, resplice) {
    st.dial = Math.max(0, Math.min(1, v));
    try { localStorage.setItem(DIAL_KEY, String(st.dial)); } catch (e) {}
    renderDial();
    if (resplice && st.fill.length) run();
  }
  function dialFromEvent(d, ev) {
    var rect = d.getBoundingClientRect();
    var p = ev.touches && ev.touches[0] ? ev.touches[0] : ev.changedTouches && ev.changedTouches[0] ? ev.changedTouches[0] : ev;
    var dx = p.clientX - (rect.left + rect.width / 2);
    var dy = p.clientY - (rect.top + rect.height / 2);
    var a = Math.atan2(dx, -dy) * (180 / Math.PI);
    if (a < 0) a += 360;
    return Math.max(0, Math.min(1, (a - 15) / 330));
  }
  function bindDial() {
    var d = $("sp-dial");
    if (!d) return;
    var dragging = false;
    function move(ev) { if (!dragging) return; ev.preventDefault(); setDial(dialFromEvent(d, ev), false); }
    function end() {
      if (!dragging) return;
      dragging = false;
      d.classList.remove("is-dragging");
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", end);
      document.removeEventListener("touchmove", move);
      document.removeEventListener("touchend", end);
      if (st.fill.length) run();
    }
    function start(ev) {
      ev.preventDefault();
      dragging = true;
      d.classList.add("is-dragging");
      setDial(dialFromEvent(d, ev), false);
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", end);
      document.addEventListener("touchmove", move, { passive: false });
      document.addEventListener("touchend", end);
    }
    d.addEventListener("mousedown", start);
    d.addEventListener("touchstart", start, { passive: false });
    d.addEventListener("keydown", function (ev) {
      if (ev.key === "ArrowRight" || ev.key === "ArrowUp") { ev.preventDefault(); setDial(st.dial + 0.05, true); }
      else if (ev.key === "ArrowLeft" || ev.key === "ArrowDown") { ev.preventDefault(); setDial(st.dial - 0.05, true); }
    });
  }

  /* ---------- wiring ---------- */
  function init() {
    var panel = $("panel-splice");
    if (!panel || !E) return;
    loadHistory();
    try {
      var dv = parseFloat(localStorage.getItem(DIAL_KEY));
      if (!isNaN(dv)) st.dial = dv;
    } catch (e) {}
    bindDial();
    renderDial();
    renderHistory();
    renderLog();
    fillSourcePicker();
    var ta = $("sp-text");
    var saved = "";
    try { saved = localStorage.getItem(SRC_KEY) || ""; } catch (e2) {}
    var sel = $("sp-source");
    if (ta) {
      if (saved) { ta.value = saved; if (sel) sel.value = "paste"; }
      else if (sel && sel._srcs && sel._srcs[0]) ta.value = sel._srcs[0].text;
      ta.addEventListener("change", function () { if (sel) sel.value = "paste"; loadStrand(); });
    }
    loadStrand();

    if (sel) {
      sel.addEventListener("focus", fillSourcePicker);
      sel.addEventListener("change", function () { pickSource(sel.value); });
    }
    $("sp-reload").addEventListener("click", function () {
      fillSourcePicker();
      if (sel && sel.value !== "paste") pickSource(sel.value); else loadStrand();
      setStatus(sel && sel._srcs && sel._srcs.length ? "Loaded from Spellforge." : "No Spellforge description yet. Paste text instead.");
    });
    $("sp-splice").addEventListener("click", function () { run(); });
    $("sp-cut").addEventListener("click", cutSelected);
    $("sp-guide").addEventListener("click", toggleGuide);
    $("sp-copy").addEventListener("click", function () { copyText(currentSentence()); });
    $("sp-generate").addEventListener("click", generate);
    $("sp-result").addEventListener("click", function (e) {
      var b = e.target.closest("[data-slot]");
      if (!b) return;
      var i = +b.getAttribute("data-slot");
      st.sel = st.sel === i ? -1 : i;
      renderResult();
    });
    $("sp-history").addEventListener("click", function (e) {
      var b = e.target.closest("[data-copy-hist]");
      if (b) copyText(st.history[+b.getAttribute("data-copy-hist")]);
    });
    Array.prototype.forEach.call(panel.querySelectorAll("[data-send]"), function (b) {
      b.addEventListener("click", function () { sendToSpell(+b.getAttribute("data-send")); });
    });
    Array.prototype.forEach.call(panel.querySelectorAll("[data-dial]"), function (b) {
      b.addEventListener("click", function () {
        setDial({ literal: 0.1, shifted: 0.5, wild: 0.9 }[b.getAttribute("data-dial")], true);
      });
    });
    window.addEventListener("tab-changed", function (e) {
      if (e.detail && e.detail.tab === "splice") {
        fillSourcePicker();
        if (st.strand) ensureIndex().then(function () { setStatus("Ready. Press Splice."); }).catch(function () {});
      }
    });
    window.SpliceTab = { state: st, run: run, setDial: setDial, sentence: currentSentence };
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
