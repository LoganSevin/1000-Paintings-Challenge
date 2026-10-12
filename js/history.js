/* History — a searchable shelf. Documents are public texts. The rest are short accounts. */
(function () {
  "use strict";

  var DATA = "data/history/library.json";
  var KEY_POS = "historyReader:pos";
  var library = null;
  var flat = [];
  var started = false;
  var searching = false;
  var searchTimer = 0;
  var searchGen = 0;
  var wordIndex = null;
  var wordKeys = null;
  var cur = 0;
  var el = {};

  function $(id) {
    return document.getElementById(id);
  }

  function store(key, val) {
    try { localStorage.setItem(key, val); } catch (e) {}
  }

  function recall(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function attr(s) {
    return esc(s).replace(/"/g, "&quot;");
  }

  function plain(s) {
    return String(s || "").replace(/\s+/g, " ").trim();
  }

  /* ---------- data ---------- */

  function loadLibrary() {
    return fetch(DATA)
      .then(function (r) {
        if (!r.ok) throw new Error("library " + r.status);
        return r.json();
      })
      .then(function (j) {
        library = j;
        flat = [];
        (j.shelves || []).forEach(function (shelf, s) {
          (shelf.entries || []).forEach(function (entry, i) {
            flat.push({
              s: s,
              i: i,
              id: entry.id,
              shelf: shelf.title,
              title: entry.title,
              when: entry.when || "",
              note: entry.note || "",
              paras: entry.paras || []
            });
          });
        });
        return j;
      });
  }

  function findFlat(id) {
    for (var n = 0; n < flat.length; n++) if (flat[n].id === id) return n;
    return -1;
  }

  /* ---------- index, same rules as the Bible shelf ---------- */

  function buildWordIndex() {
    var map = {};
    for (var n = 0; n < flat.length; n++) {
      var entry = flat[n];
      for (var p = 0; p < entry.paras.length; p++) {
        var blob = entry.paras[p];
        if (p === 0) blob += " " + entry.title + " " + entry.when;
        var words = plain(blob).toLowerCase().match(/[a-z0-9']+/g);
        if (!words) continue;
        var seen = {};
        var id = entry.s * 1000000 + entry.i * 1000 + p;
        for (var w = 0; w < words.length; w++) {
          var word = words[w];
          if (seen[word]) continue;
          if (word.length < 3 && /^[0-9]+$/.test(word)) continue;
          seen[word] = 1;
          if (!map[word]) map[word] = [];
          map[word].push(id);
        }
      }
    }
    wordIndex = map;
    wordKeys = Object.keys(map).sort();
  }

  function lowerBound(keys, word) {
    var lo = 0;
    var hi = keys.length;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (keys[mid] < word) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  function unionSorted(lists) {
    var tagged = [];
    for (var i = 0; i < lists.length; i++) {
      var list = lists[i];
      for (var j = 0; j < list.length; j++) tagged.push(list[j]);
    }
    tagged.sort(function (a, b) { return a - b; });
    var out = [];
    for (var k = 0; k < tagged.length; k++) {
      if (!out.length || out[out.length - 1] !== tagged[k]) out.push(tagged[k]);
    }
    return out;
  }

  function intersectSorted(a, b) {
    var out = [];
    var i = 0;
    var j = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { out.push(a[i]); i++; j++; }
      else if (a[i] < b[j]) i++;
      else j++;
    }
    return out;
  }

  function postingsFor(word) {
    if (!wordIndex) return [];
    if (/^[0-9]+$/.test(word) || word.length < 4) return wordIndex[word] || [];
    var lo = lowerBound(wordKeys, word);
    var lists = [];
    for (var i = lo; i < wordKeys.length; i++) {
      if (wordKeys[i].indexOf(word) !== 0) break;
      lists.push(wordIndex[wordKeys[i]]);
    }
    if (!lists.length) return [];
    if (lists.length === 1) return lists[0];
    return unionSorted(lists);
  }

  function unpackId(id) {
    var s = Math.floor(id / 1000000);
    var rest = id % 1000000;
    var i = Math.floor(rest / 1000);
    var p = rest % 1000;
    var shelf = library.shelves[s];
    var entry = shelf && shelf.entries[i];
    return {
      s: s,
      i: i,
      p: p,
      id: entry ? entry.id : "",
      title: entry ? entry.title : "",
      when: entry && entry.when ? entry.when : "",
      t: entry && entry.paras[p] ? plain(entry.paras[p]) : ""
    };
  }

  function queryWords(q) {
    var found = String(q).toLowerCase().match(/[a-z0-9][a-z0-9']*/g) || [];
    var out = [];
    var seen = {};
    for (var i = 0; i < found.length; i++) {
      var w = found[i];
      if (w.length < 3 && /^[0-9]+$/.test(w)) continue;
      if (w.length < 2) continue;
      if (seen[w]) continue;
      seen[w] = 1;
      out.push(w);
    }
    return out;
  }

  function findHits(q) {
    var LIMIT = 80;
    var quoted = String(q).match(/^["“](.+)["”]$/);
    var phrase = quoted ? quoted[1].toLowerCase().replace(/\s+/g, " ").trim() : "";
    var words = queryWords(phrase || q);
    if (!words.length) return { total: 0, hits: [], words: [] };
    var lists = [];
    for (var i = 0; i < words.length; i++) {
      var list = postingsFor(words[i]);
      if (!list.length) return { total: 0, hits: [], words: words };
      lists.push(list);
    }
    lists.sort(function (a, b) { return a.length - b.length; });
    var acc = lists[0];
    for (var n = 1; n < lists.length; n++) {
      acc = intersectSorted(acc, lists[n]);
      if (!acc.length) break;
    }
    var hits = [];
    var total = 0;
    for (var h = 0; h < acc.length; h++) {
      var hit = unpackId(acc[h]);
      if (!hit.t) continue;
      if (phrase && hit.t.toLowerCase().indexOf(phrase) === -1) continue;
      total++;
      if (hits.length < LIMIT) hits.push(hit);
    }
    return { total: total, hits: hits, words: words };
  }

  function titleMatches(q) {
    var n = String(q || "").toLowerCase().trim();
    if (n.length < 3) return [];
    var out = [];
    for (var i = 0; i < flat.length; i++) {
      if (flat[i].title.toLowerCase().indexOf(n) !== -1) out.push(flat[i]);
    }
    return out.slice(0, 6);
  }

  function uniqueTitle(q) {
    var n = String(q || "").toLowerCase().trim();
    if (n.length < 3) return null;
    var exact = [];
    var starts = [];
    for (var i = 0; i < flat.length; i++) {
      var t = flat[i].title.toLowerCase();
      if (t === n) exact.push(i);
      if (t.indexOf(n) === 0) starts.push(i);
    }
    if (exact.length === 1) return exact[0];
    if (starts.length === 1) return starts[0];
    return null;
  }

  /* ---------- render ---------- */

  function buildNav() {
    var host = el.nav;
    host.innerHTML = "";
    var last = "";
    flat.forEach(function (entry, n) {
      if (entry.shelf !== last) {
        last = entry.shelf;
        var g = document.createElement("div");
        g.className = "hist-group";
        g.textContent = entry.shelf;
        host.appendChild(g);
      }
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "hist-book";
      btn.setAttribute("data-n", String(n));
      btn.textContent = entry.title;
      host.appendChild(btn);
    });
  }

  function syncNav() {
    var buttons = el.nav.querySelectorAll(".hist-book");
    for (var i = 0; i < buttons.length; i++) {
      var on = Number(buttons[i].getAttribute("data-n")) === cur;
      buttons[i].classList.toggle("is-on", on);
      if (on && buttons[i].scrollIntoView) {
        buttons[i].scrollIntoView({ block: "nearest" });
      }
    }
  }

  function goIndex(n, para) {
    if (n < 0) n = 0;
    if (n > flat.length - 1) n = flat.length - 1;
    cur = n;
    searching = false;
    store(KEY_POS, flat[cur].id);
    render();
    if (para) {
      setTimeout(function () { highlightPara(para); }, 30);
    }
  }

  function render() {
    var entry = flat[cur];
    el.where.textContent = entry.title;
    el.prev.disabled = cur === 0;
    el.next.disabled = cur === flat.length - 1;
    syncNav();
    var html = '<article class="hist-entry"><h2>' + esc(entry.title) + "</h2>";
    if (entry.when) html += '<p class="hist-when">' + esc(entry.when) + "</p>";
    if (entry.note) html += '<p class="hist-note">' + esc(entry.note) + "</p>";
    html += '<p class="hist-kicker">' + esc(entry.shelf) + "</p>";
    for (var p = 0; p < entry.paras.length; p++) {
      html += '<p class="hist-p" id="hist-p-' + p + '">' + esc(entry.paras[p]) + "</p>";
    }
    html += '<p class="hist-hint">Select any passage and right-click it to generate a painting.</p></article>';
    el.read.innerHTML = html;
    el.read.scrollTop = 0;
  }

  function highlightPara(n) {
    var node = $("hist-p-" + n);
    if (!node) return;
    if (node.scrollIntoView) node.scrollIntoView({ block: "center" });
    node.classList.add("is-hit");
    setTimeout(function () { node.classList.remove("is-hit"); }, 2200);
  }

  function markWords(text, words) {
    var parts = String(text).split(/([A-Za-z0-9][A-Za-z0-9']*)/);
    return parts.map(function (part) {
      var low = part.toLowerCase();
      for (var i = 0; i < words.length; i++) {
        var w = words[i];
        var hit = /^[0-9]+$/.test(w) || w.length < 4 ? low === w : low.indexOf(w) === 0;
        if (hit) return "<mark>" + esc(part) + "</mark>";
      }
      return esc(part);
    }).join("");
  }

  function quoteLine(hit) {
    var when = hit.when ? " (" + hit.when + ")" : "";
    return hit.t + " — " + hit.title + when;
  }

  function openHit(node) {
    clearTimeout(searchTimer);
    var id = node.getAttribute("data-id");
    var p = Number(node.getAttribute("data-p"));
    var n = findFlat(id);
    if (n < 0) return;
    goIndex(n, p);
  }

  function copyQuote(btn) {
    var text = btn.getAttribute("data-quote") || "";
    function done() {
      btn.textContent = "Copied";
      btn.classList.add("is-copied");
      setTimeout(function () {
        if (!btn.isConnected) return;
        btn.textContent = "Copy";
        btn.classList.remove("is-copied");
      }, 1200);
    }
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      if (ok) done();
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else fallback();
  }

  function showResults(q) {
    var found = findHits(q);
    var titles = titleMatches(q);
    var back = flat[cur].title;
    var total = found.total;
    var count = total === 0
      ? "no passages"
      : total + (total === 1 ? " passage" : " passages") + (total > found.hits.length ? " · showing first " + found.hits.length : "");
    var head = '<div class="hist-page"><div class="hist-results-head"><h3>' + esc(q) + "</h3><span>" + count +
      ' &nbsp; <button type="button" class="hist-btn" data-close-search="1">Back to ' + esc(back) + "</button></span></div>";
    var body = "";
    titles.forEach(function (entry) {
      body += '<article class="hist-hit hist-hit-goto"><div class="hist-hit-top"><button type="button" class="hist-hit-ref" data-id="' +
        attr(entry.id) + '" data-p="0">Open ' + esc(entry.title) + "</button></div>" +
        '<button type="button" class="hist-hit-text" data-id="' + attr(entry.id) + '" data-p="0">' + esc(entry.shelf) +
        (entry.when ? " · " + esc(entry.when) : "") + "</button></article>";
    });
    body += found.hits.map(function (h) {
      var quote = quoteLine(h);
      return '<article class="hist-hit"><div class="hist-hit-top"><button type="button" class="hist-hit-ref" data-id="' +
        attr(h.id) + '" data-p="' + h.p + '">' + esc(h.title) + "</button>" +
        '<button type="button" class="hist-hit-copy" data-quote="' + attr(quote) + '">Copy</button></div>' +
        '<button type="button" class="hist-hit-text" data-id="' + attr(h.id) + '" data-p="' + h.p + '">' +
        markWords(h.t, found.words) + "</button></article>";
    }).join("");
    if (!found.hits.length && !titles.length) {
      body += '<div class="hist-status">Nothing found. Try another word, or a title such as Magna Carta.</div>';
    }
    el.read.innerHTML = head + body + "</div>";
    el.read.scrollTop = 0;
    var close = el.read.querySelector("[data-close-search]");
    if (close) close.addEventListener("click", function () {
      clearTimeout(searchTimer);
      el.search.value = "";
      searching = false;
      render();
    });
    el.read.querySelectorAll(".hist-hit-ref, .hist-hit-text").forEach(function (btn) {
      btn.addEventListener("click", function () { openHit(btn); });
    });
    el.read.querySelectorAll(".hist-hit-copy").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        copyQuote(btn);
      });
    });
  }

  function runSearch(raw, jumpIfTitle) {
    clearTimeout(searchTimer);
    var q = String(raw || "").trim();
    var gen = ++searchGen;
    if (!q || q.length < 2) {
      if (searching) { searching = false; render(); }
      return;
    }
    if (!wordIndex) buildWordIndex();
    if (jumpIfTitle) {
      var hit = uniqueTitle(q);
      if (hit != null) {
        searching = false;
        goIndex(hit, 0);
        el.search.blur();
        return;
      }
    }
    searching = true;
    el.where.textContent = "Index";
    if (gen !== searchGen) return;
    showResults(q);
  }

  /* ---------- right-click generate ---------- */

  function apiUrl(path) {
    var base = String(window.SPELLFORGE_API_BASE || "").replace(/\/$/, "");
    return base ? base + path : path;
  }

  function selectionText() {
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed) return "";
    var node = sel.anchorNode;
    if (!node || !el.read || !el.read.contains(node.nodeType === 3 ? node.parentNode : node)) return "";
    return plain(sel.toString());
  }

  function hideMenu() {
    if (el.menu) el.menu.hidden = true;
  }

  function showMenu(x, y) {
    if (!el.menu) return;
    el.menu.hidden = false;
    var w = el.menu.offsetWidth || 160;
    var h = el.menu.offsetHeight || 48;
    el.menu.style.left = Math.max(8, Math.min(x, window.innerWidth - w - 8)) + "px";
    el.menu.style.top = Math.max(8, Math.min(y, window.innerHeight - h - 8)) + "px";
  }

  function imageUrl(payload) {
    if (!payload) return "";
    var img = payload.image || (payload.images && payload.images[0]);
    return (img && (img.url || img.download_url || img.uri)) || payload.image_url || payload.output_url || "";
  }

  function pollJob(jobId, left) {
    if (left <= 0) return Promise.reject(new Error("The painting did not finish."));
    return fetch(apiUrl("/api/jobs/" + encodeURIComponent(jobId)), { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (job) {
        var st = String((job && job.status) || "").toLowerCase();
        if (st === "done" || st === "completed" || st === "success") {
          var url = imageUrl(job);
          if (url) return url;
          throw new Error("The painting finished without an image.");
        }
        if (st === "failed" || st === "error" || st === "expired") {
          throw new Error((job && (job.error && job.error.message || job.error)) || "The painting did not finish.");
        }
        return new Promise(function (resolve) { setTimeout(resolve, 1200); }).then(function () {
          return pollJob(jobId, left - 1);
        });
      });
  }

  function generate(text) {
    var entry = flat[cur];
    var vision = $("hist-vision");
    var status = $("hist-vision-status");
    var img = $("hist-vision-img");
    if (vision) vision.hidden = false;
    if (img) { img.removeAttribute("src"); img.classList.remove("is-on"); }
    if (status) status.textContent = "Painting the passage…";
    hideMenu();
    var clip = text.length > 900 ? text.slice(0, 900) : text;
    var stasis = "Museum-quality history painting, not a photograph of a printed page. The scene is specific to this passage from " +
      entry.title + (entry.when ? " (" + entry.when + ")" : "") + ": «" + clip +
      "». Period dress, objects, and setting a viewer could place, clear figures, fine art.";
    var jobId = (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : "history-" + Date.now();
    fetch(apiUrl("/api/generate-stasis-vision"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        job_id: jobId,
        stasis: stasis,
        prompt: stasis,
        buzz_words: ["history", "fine art", entry.title],
        spells: [],
        aspect_ratio: "16:9",
        mag_fresh: true,
        spell_cast: false,
        fresh_variation: true,
        source: "history"
      })
    })
      .then(function (r) {
        return r.json().then(function (d) { return { status: r.status, d: d }; });
      })
      .then(function (res) {
        var d = res.d || {};
        var url = imageUrl(d);
        if (url) return url;
        if (res.status === 202 || d.job_id) return pollJob(d.job_id || jobId, 40);
        throw new Error((d && d.error) || "The painting did not start.");
      })
      .then(function (url) {
        if (status) status.textContent = entry.title;
        if (img) { img.src = url; img.classList.add("is-on"); }
      })
      .catch(function (err) {
        var msg = String((err && err.message) || err || "");
        if (/api key|capacity|pollinations|cloudflare|insufficient/i.test(msg)) msg = "The painting did not start. Try the passage again.";
        if (status) status.textContent = msg.slice(0, 180) || "The painting did not start.";
      });
  }

  /* ---------- wire ---------- */

  function wire() {
    el.prev.addEventListener("click", function () { if (cur > 0) goIndex(cur - 1); });
    el.next.addEventListener("click", function () { if (cur < flat.length - 1) goIndex(cur + 1); });
    el.menuBtn.addEventListener("click", function () { el.shell.classList.toggle("nav-open"); });
    el.nav.addEventListener("click", function (e) {
      var btn = e.target.closest && e.target.closest(".hist-book");
      if (!btn) return;
      el.search.value = "";
      searching = false;
      goIndex(Number(btn.getAttribute("data-n")));
      if (window.matchMedia("(max-width: 760px)").matches) el.shell.classList.remove("nav-open");
    });
    el.search.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        clearTimeout(searchTimer);
        runSearch(el.search.value, true);
      } else if (e.key === "Escape") {
        clearTimeout(searchTimer);
        el.search.value = "";
        if (searching) { searching = false; render(); }
      }
    });
    el.search.addEventListener("input", function () {
      clearTimeout(searchTimer);
      var q = el.search.value;
      searchTimer = setTimeout(function () { runSearch(q, false); }, 180);
    });
    el.read.addEventListener("contextmenu", function (e) {
      if (!el.read.contains(e.target)) return;
      var text = selectionText();
      if (!text) return;
      e.preventDefault();
      el.menu.dataset.phrase = text;
      showMenu(e.clientX, e.clientY);
    });
    el.menu.addEventListener("click", function (e) {
      var act = e.target && e.target.getAttribute("data-hist-ctx");
      var text = el.menu.dataset.phrase || selectionText();
      hideMenu();
      if (act === "generate" && text) generate(text);
    });
    document.addEventListener("mousedown", function (e) {
      if (el.menu && !el.menu.hidden && !el.menu.contains(e.target)) hideMenu();
    });
    var close = $("hist-vision-close");
    if (close) close.addEventListener("click", function () { $("hist-vision").hidden = true; });
    document.addEventListener("keydown", function (e) {
      if (document.body.getAttribute("data-active-tab") !== "history") return;
      var t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowLeft") { if (cur > 0) goIndex(cur - 1); }
      else if (e.key === "ArrowRight") { if (cur < flat.length - 1) goIndex(cur + 1); }
      else if (e.key === "/") { e.preventDefault(); el.search.focus(); }
    });
  }

  function collect() {
    el.shell = document.querySelector("#panel-history .hist-shell");
    el.nav = $("hist-nav");
    el.read = $("hist-read");
    el.where = $("hist-where");
    el.prev = $("hist-prev");
    el.next = $("hist-next");
    el.search = $("hist-search");
    el.menuBtn = $("hist-menu");
    el.menu = $("hist-ctx");
    return el.shell && el.nav && el.read && el.where && el.search;
  }

  function start() {
    if (started) return;
    if (!collect()) return;
    started = true;
    el.read.innerHTML = '<div class="hist-page"><div class="hist-status">Opening the shelf…</div></div>';
    loadLibrary()
      .then(function () {
        var paras = 0;
        flat.forEach(function (entry) { paras += entry.paras.length; });
        var count = $("hist-count");
        if (count) count.textContent = flat.length + " articles · " + paras + " passages";
        buildNav();
        wire();
        var saved = findFlat(recall(KEY_POS) || "");
        goIndex(saved >= 0 ? saved : 0);
        setTimeout(buildWordIndex, 0);
      })
      .catch(function (err) {
        started = false;
        el.read.innerHTML = '<div class="hist-page"><div class="hist-status">Could not open the shelf. ' +
          esc(err && err.message ? err.message : "") + "</div></div>";
      });
  }

  window.addEventListener("history-show", start);
  window.HistoryShelf = { onShow: start };

  if (document.readyState !== "loading") {
    if (document.body && document.body.getAttribute("data-active-tab") === "history") start();
  } else {
    document.addEventListener("DOMContentLoaded", function () {
      if (document.body.getAttribute("data-active-tab") === "history") start();
    });
  }
})();
