/* Bible — King James Version (1769), complete canon, read in paragraph flow.
   Data lives in data/bible/: a small index plus one file per book, fetched on demand. */
(function () {
  "use strict";

  var DATA = "data/bible/";
  var KEY_POS = "bibleReader:pos";
  var KEY_SIZE = "bibleReader:size";
  var SIZES = [1.0, 1.16, 1.34, 1.54];

  var index = null; // { translation, edition, books: [...], totals }
  var cache = {}; // fileName -> { n, c: [[verse,...],...] }
  var allLoaded = false;
  var started = false;
  var cur = { b: 0, c: 1 }; // book position in index.books, 1-based chapter
  var sizeIdx = 1;
  var searching = false;

  var el = {};

  function $(id) {
    return document.getElementById(id);
  }

  function store(key, val) {
    try {
      localStorage.setItem(key, val);
    } catch (e) {}
  }

  function recall(key) {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  /* Source convention: a leading "#" marks a new paragraph, "[...]" marks words
     the translators supplied, shown in italics as printed editions do. */
  function verseHtml(raw) {
    var t = String(raw);
    if (t.charAt(0) === "#") t = t.slice(1);
    t = t.replace(/^\s+/, "");
    return esc(t).replace(/\[([^\]]*)\]/g, "<em>$1</em>");
  }

  function startsParagraph(raw) {
    return String(raw).charAt(0) === "#";
  }

  /* ---------- data ---------- */

  function loadIndex() {
    return fetch(DATA + "index.json")
      .then(function (r) {
        if (!r.ok) throw new Error("index " + r.status);
        return r.json();
      })
      .then(function (j) {
        index = j;
        return j;
      });
  }

  function loadBook(i) {
    var meta = index.books[i];
    if (cache[meta.f]) return Promise.resolve(cache[meta.f]);
    return fetch(DATA + meta.f)
      .then(function (r) {
        if (!r.ok) throw new Error(meta.n + " " + r.status);
        return r.json();
      })
      .then(function (j) {
        cache[meta.f] = j;
        return j;
      });
  }

  function loadAll(onProgress) {
    if (allLoaded) return Promise.resolve();
    var done = 0;
    var total = index.books.length;
    return Promise.all(
      index.books.map(function (b, i) {
        return loadBook(i).then(function (x) {
          done++;
          if (onProgress) onProgress(done, total);
          return x;
        });
      })
    ).then(function () {
      allLoaded = true;
    });
  }

  /* ---------- sidebar ---------- */

  function buildNav() {
    var host = el.navScroll;
    host.textContent = "";
    var lastT = null;
    var lastG = null;

    index.books.forEach(function (b, i) {
      if (b.t !== lastT) {
        lastT = b.t;
        lastG = null;
        var th = document.createElement("div");
        th.className = "bib-testament";
        th.textContent = b.t === "ot" ? "Old Testament" : "New Testament";
        host.appendChild(th);
      }
      if (b.g !== lastG) {
        lastG = b.g;
        var gh = document.createElement("div");
        gh.className = "bib-group";
        gh.textContent = b.g;
        host.appendChild(gh);
      }

      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "bib-book";
      btn.dataset.book = String(i);
      var nm = document.createElement("span");
      nm.textContent = b.n;
      var ct = document.createElement("span");
      ct.className = "bib-book-ch";
      ct.textContent = b.v.length + (b.v.length === 1 ? " ch" : " ch");
      btn.appendChild(nm);
      btn.appendChild(ct);
      btn.addEventListener("click", function () {
        toggleBook(i);
      });
      host.appendChild(btn);

      var grid = document.createElement("div");
      grid.className = "bib-chapters";
      grid.dataset.grid = String(i);
      host.appendChild(grid);
    });
  }

  function fillGrid(i) {
    var grid = el.navScroll.querySelector('[data-grid="' + i + '"]');
    if (!grid || grid.dataset.filled === "1") return grid;
    var b = index.books[i];
    for (var c = 1; c <= b.v.length; c++) {
      var cb = document.createElement("button");
      cb.type = "button";
      cb.className = "bib-ch";
      cb.textContent = String(c);
      cb.dataset.ch = String(c);
      (function (ch) {
        cb.addEventListener("click", function () {
          go(i, ch);
          closeNavOnMobile();
        });
      })(c);
      grid.appendChild(cb);
    }
    grid.dataset.filled = "1";
    return grid;
  }

  function toggleBook(i) {
    var grid = fillGrid(i);
    var isOpen = grid.classList.contains("open");
    el.navScroll.querySelectorAll(".bib-chapters.open").forEach(function (g) {
      g.classList.remove("open");
    });
    el.navScroll.querySelectorAll(".bib-book.open").forEach(function (b) {
      b.classList.remove("open");
    });
    if (!isOpen) {
      grid.classList.add("open");
      var btn = el.navScroll.querySelector('.bib-book[data-book="' + i + '"]');
      if (btn) btn.classList.add("open");
    }
  }

  function syncNav() {
    el.navScroll.querySelectorAll(".bib-book").forEach(function (b) {
      b.classList.toggle("open", Number(b.dataset.book) === cur.b);
    });
    el.navScroll.querySelectorAll(".bib-chapters").forEach(function (g) {
      g.classList.toggle("open", Number(g.dataset.grid) === cur.b);
    });
    var grid = fillGrid(cur.b);
    if (grid) {
      grid.classList.add("open");
      grid.querySelectorAll(".bib-ch").forEach(function (c) {
        c.classList.toggle("current", Number(c.dataset.ch) === cur.c);
      });
    }
    var active = el.navScroll.querySelector('.bib-book[data-book="' + cur.b + '"]');
    if (active && active.scrollIntoView) {
      active.scrollIntoView({ block: "nearest" });
    }
  }

  /* ---------- reading ---------- */

  function go(bookIdx, chapter) {
    if (!index) return;
    if (bookIdx < 0) bookIdx = 0;
    if (bookIdx > index.books.length - 1) bookIdx = index.books.length - 1;
    var meta = index.books[bookIdx];
    if (chapter < 1) chapter = 1;
    if (chapter > meta.v.length) chapter = meta.v.length;
    cur = { b: bookIdx, c: chapter };
    store(KEY_POS, bookIdx + ":" + chapter);
    searching = false;
    stopSpeech();
    render();
  }

  function step(delta) {
    var b = cur.b;
    var c = cur.c + delta;
    if (c < 1) {
      if (b === 0) return;
      b -= 1;
      c = index.books[b].v.length;
    } else if (c > index.books[b].v.length) {
      if (b === index.books.length - 1) return;
      b += 1;
      c = 1;
    }
    go(b, c);
  }

  function render() {
    var meta = index.books[cur.b];
    el.where.textContent = meta.n + " " + cur.c;
    el.prev.disabled = cur.b === 0 && cur.c === 1;
    el.next.disabled = cur.b === index.books.length - 1 && cur.c === meta.v.length;
    syncNav();

    el.read.innerHTML = '<div class="bib-status">Opening ' + esc(meta.n) + "…</div>";

    loadBook(cur.b)
      .then(function (book) {
        if (searching) return;
        var verses = book.c[cur.c - 1] || [];
        var html =
          '<div class="bib-page">' +
          '<header class="bib-chapter-head">' +
          '<span class="bib-bk">' +
          esc(meta.n) +
          "</span>" +
          '<span class="bib-cn">Chapter ' +
          cur.c +
          " · " +
          verses.length +
          " verses</span>" +
          "</header>" +
          '<div class="bib-text">';

        var open = false;
        verses.forEach(function (raw, i) {
          if (i === 0 || startsParagraph(raw)) {
            if (open) html += "</p>";
            html += "<p>";
            open = true;
          } else {
            html += " ";
          }
          html += '<span class="bib-v">' + (i + 1) + "</span>" + verseHtml(raw);
        });
        if (open) html += "</p>";

        html +=
          "</div>" +
          '<div class="bib-foot">' +
          '<button type="button" class="bib-btn" data-foot="prev">‹ Previous</button>' +
          '<button type="button" class="bib-btn" data-foot="next">Next ›</button>' +
          "</div>" +
          '<p class="bib-note">' +
          esc(index.translation) +
          " · " +
          esc(index.edition) +
          " · public domain.<br>Words in italics were supplied by the translators." +
          "</p>" +
          "</div>";

        el.read.innerHTML = html;
        el.read.scrollTop = 0;
        applyHighlights();
        wordifyChapter();
        ensureScan();
        injectTitleTransport();

        var fp = el.read.querySelector('[data-foot="prev"]');
        var fn = el.read.querySelector('[data-foot="next"]');
        if (fp) {
          fp.disabled = el.prev.disabled;
          fp.addEventListener("click", function () {
            step(-1);
          });
        }
        if (fn) {
          fn.disabled = el.next.disabled;
          fn.addEventListener("click", function () {
            step(1);
          });
        }
      })
      .catch(function (err) {
        el.read.innerHTML =
          '<div class="bib-status">Could not load ' +
          esc(meta.n) +
          ". " +
          esc(err && err.message ? err.message : "") +
          "</div>";
      });
  }

  /* ---------- reference lookup ---------- */

  function findBook(name) {
    var q = name.toLowerCase().replace(/\./g, "").replace(/\s+/g, " ").trim();
    if (!q) return -1;
    var exact = -1;
    var pref = -1;
    for (var i = 0; i < index.books.length; i++) {
      var b = index.books[i];
      var n = b.n.toLowerCase();
      var a = b.a.toLowerCase().replace(/\./g, "");
      if (n === q || a === q) {
        exact = i;
        break;
      }
      if (pref === -1 && (n.indexOf(q) === 0 || a.indexOf(q) === 0)) pref = i;
    }
    return exact !== -1 ? exact : pref;
  }

  /* "John 3:16", "1 john 2", "Ps 23" -> { b, c, v } or null */
  function parseRef(text) {
    var m = String(text)
      .trim()
      .match(/^([1-3]?\s*[A-Za-z][A-Za-z\s.]*?)\s*(\d+)?\s*(?::\s*(\d+))?\s*$/);
    if (!m) return null;
    var bi = findBook(m[1]);
    if (bi === -1) return null;
    var c = m[2] ? parseInt(m[2], 10) : 1;
    var v = m[3] ? parseInt(m[3], 10) : 0;
    var meta = index.books[bi];
    if (c > meta.v.length) c = meta.v.length;
    return { b: bi, c: c, v: v };
  }

  function highlightVerse(n) {
    var spans = el.read.querySelectorAll(".bib-v");
    for (var i = 0; i < spans.length; i++) {
      if (spans[i].textContent === String(n)) {
        var target = spans[i];
        if (target.scrollIntoView) target.scrollIntoView({ block: "center" });
        var old = target.style.cssText;
        target.style.cssText = old + ";background:rgba(201,162,39,.35);border-radius:3px;padding:0 .25em;";
        setTimeout(function () {
          target.style.cssText = old;
        }, 2200);
        break;
      }
    }
  }

  /* ---------- search ---------- */

  function runSearch(raw) {
    var q = String(raw).trim();
    if (!q) return;

    var ref = parseRef(q);
    if (ref) {
      go(ref.b, ref.c);
      if (ref.v) setTimeout(function () { highlightVerse(ref.v); }, 220);
      el.search.blur();
      return;
    }

    if (q.length < 2) return;
    searching = true;
    el.where.textContent = "Search";
    el.read.innerHTML = '<div class="bib-page"><div class="bib-status">Loading the full text…</div></div>';

    loadAll(function (done, total) {
      var s = el.read.querySelector(".bib-status");
      if (s && searching) {
        s.textContent = "Loading the full text… " + done + " of " + total + " books";
      }
    })
      .then(function () {
        if (!searching) return;
        showResults(q);
      })
      .catch(function (err) {
        el.read.innerHTML =
          '<div class="bib-page"><div class="bib-status">Search failed. ' +
          esc(err && err.message ? err.message : "") +
          "</div></div>";
      });
  }

  function wireCloseSearch() {
    var btn = el.read.querySelector("[data-close-search]");
    if (!btn) return;
    btn.addEventListener("click", function () {
      el.search.value = "";
      searching = false;
      render();
    });
  }

  function showResults(q) {
    var needle = q.toLowerCase();
    var hits = [];
    var LIMIT = 300;
    var total = 0;

    for (var i = 0; i < index.books.length; i++) {
      var meta = index.books[i];
      var book = cache[meta.f];
      if (!book) continue;
      for (var c = 0; c < book.c.length; c++) {
        var ch = book.c[c];
        for (var v = 0; v < ch.length; v++) {
          var plain = ch[v].replace(/[#\[\]]/g, "");
          if (plain.toLowerCase().indexOf(needle) === -1) continue;
          total++;
          if (hits.length < LIMIT) {
            hits.push({ b: i, c: c + 1, v: v + 1, t: plain, n: meta.n });
          }
        }
      }
    }

    var back = index.books[cur.b].n + " " + cur.c;
    var head =
      '<div class="bib-page">' +
      '<div class="bib-results-head"><h3>' +
      esc(q) +
      "</h3><span>" +
      (total === 0
        ? "no verses"
        : total + (total === 1 ? " verse" : " verses") + (total > LIMIT ? " · showing first " + LIMIT : "")) +
      ' &nbsp; <button type="button" class="bib-btn" data-close-search="1">Back to ' +
      esc(back) +
      "</button></span></div>";

    if (!hits.length) {
      el.read.innerHTML =
        head +
        '<div class="bib-status">Nothing found. Try another word, or type a reference like “John 3:16”.</div></div>';
      wireCloseSearch();
      return;
    }

    var rx = new RegExp("(" + q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "ig");
    var body = hits
      .map(function (h) {
        var text = esc(h.t).replace(rx, "<mark>$1</mark>");
        return (
          '<button type="button" class="bib-hit" data-b="' +
          h.b +
          '" data-c="' +
          h.c +
          '" data-v="' +
          h.v +
          '">' +
          '<span class="bib-hit-ref">' +
          esc(h.n) +
          " " +
          h.c +
          ":" +
          h.v +
          "</span>" +
          '<span class="bib-hit-text">' +
          text +
          "</span></button>"
        );
      })
      .join("");

    el.read.innerHTML = head + body + "</div>";
    el.read.scrollTop = 0;
    wireCloseSearch();

    el.read.querySelectorAll(".bib-hit").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var b = Number(btn.dataset.b);
        var c = Number(btn.dataset.c);
        var v = Number(btn.dataset.v);
        go(b, c);
        setTimeout(function () {
          highlightVerse(v);
        }, 220);
      });
    });
  }

  /* ---------- highlight + right-click ---------- */

  var KEY_HL = "bibleReader:hl";
  var KEY_VOICE = "bibleReader:voice";
  var lastPick = "";
  var speaking = false;
  var speakToken = 0;
  var scanIndex = 0;
  var listenLockUntil = 0;
  var userPaused = false;
  var keepAlive = 0;
  var heldUtterances = [];

  function hlMap() {
    try {
      return JSON.parse(recall(KEY_HL) || "{}") || {};
    } catch (e) {
      return {};
    }
  }

  function saveHl(map) {
    store(KEY_HL, JSON.stringify(map));
  }

  function passageRef() {
    if (!index) return "";
    return index.books[cur.b].n + " " + cur.c;
  }

  function selectionText() {
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return "";
    var node = sel.anchorNode;
    if (!el.read || !el.read.contains(node)) return "";
    return String(sel.toString() || "").replace(/\s+/g, " ").trim();
  }

  function wrapSelectionHighlight() {
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return "";
    var range = sel.getRangeAt(0);
    if (!el.read.contains(range.commonAncestorContainer)) return "";
    var text = String(sel.toString() || "").replace(/\s+/g, " ").trim();
    if (text.length < 2) return "";
    try {
      var mark = document.createElement("mark");
      mark.className = "bib-hl";
      mark.appendChild(range.extractContents());
      range.insertNode(mark);
    } catch (err) {
      return text;
    }
    sel.removeAllRanges();
    var map = hlMap();
    var key = cur.b + ":" + cur.c;
    var list = map[key] || [];
    if (list.indexOf(text) < 0) list.push(text);
    map[key] = list;
    saveHl(map);
    return text;
  }

  function applyHighlights() {
    var host = el.read && el.read.querySelector(".bib-text");
    if (!host) return;
    var list = hlMap()[cur.b + ":" + cur.c] || [];
    list.forEach(function (snip) {
      wrapFirstPlain(host, snip);
    });
  }

  function wrapFirstPlain(root, snip) {
    var needle = String(snip || "").replace(/\s+/g, " ").trim();
    if (needle.length < 2) return;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var node;
    while ((node = walker.nextNode())) {
      if (node.parentNode && node.parentNode.classList && node.parentNode.classList.contains("bib-hl")) {
        continue;
      }
      if (node.parentNode && node.parentNode.classList && node.parentNode.classList.contains("bib-v")) {
        continue;
      }
      var raw = node.nodeValue || "";
      var compact = raw.replace(/\s+/g, " ");
      var idx = compact.indexOf(needle);
      if (idx < 0) continue;
      var real = raw.indexOf(needle);
      if (real < 0) {
        var first = needle.slice(0, 12);
        real = raw.indexOf(first);
        if (real < 0) continue;
      }
      var range = document.createRange();
      range.setStart(node, real);
      range.setEnd(node, Math.min(raw.length, real + needle.length));
      var mark = document.createElement("mark");
      mark.className = "bib-hl";
      try {
        range.surroundContents(mark);
      } catch (err) {
        mark.appendChild(range.extractContents());
        range.insertNode(mark);
      }
      return;
    }
  }

  function hideCtx() {
    var menu = $("bib-ctx");
    if (menu) menu.hidden = true;
  }

  function showCtx(x, y) {
    var menu = $("bib-ctx");
    if (!menu) return;
    menu.hidden = false;
    var w = menu.offsetWidth || 180;
    var h = menu.offsetHeight || 120;
    var left = Math.min(x, window.innerWidth - w - 8);
    var top = Math.min(y, window.innerHeight - h - 8);
    menu.style.left = Math.max(8, left) + "px";
    menu.style.top = Math.max(8, top) + "px";
  }

  function persistBibleStill(url, note) {
    if (!url) return Promise.resolve(null);
    var payload = {
      source: "bible",
      collection: "generated",
      reveal: false,
      description: String(note || "").slice(0, 800),
      meta: { source: "bible", ref: passageRef() },
    };
    if (String(url).indexOf("data:") === 0) payload.image_base64 = url;
    else payload.image_url = url;
    var bases = [];
    var host = (location.hostname || "").toLowerCase();
    if (host === "localhost" || host === "127.0.0.1") bases.push("");
    bases.push("http://127.0.0.1:8765", "http://localhost:8765");
    function tryNext(i) {
      if (i >= bases.length) return Promise.resolve(null);
      var opts = {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        cache: "no-store",
        mode: bases[i] ? "cors" : "same-origin",
      };
      try {
        opts.targetAddressSpace = "loopback";
      } catch (eAddr) {}
      return fetch((bases[i] || "") + "/api/save-generated-image", opts)
        .then(function (r) {
          return r.json().then(function (d) {
            if (!r.ok || (d && d.ok === false)) throw new Error("save");
            return d;
          });
        })
        .catch(function () {
          return tryNext(i + 1);
        });
    }
    return tryNext(0);
  }

  function bibleApiUrl(path) {
    var base = String(window.SPELLFORGE_API_BASE || "").replace(/\/$/, "");
    return base ? base + path : path;
  }

  function pollJob(jobId, left) {
    if (left <= 0) return Promise.reject(new Error("timed out"));
    return fetch(bibleApiUrl("/api/jobs/" + encodeURIComponent(jobId)), { cache: "no-store" })
      .then(function (r) {
        return r.json();
      })
      .then(function (job) {
        if (job && job.status === "done") {
          var img = job.image || (job.images && job.images[0]);
          if (img && img.url) return img.url;
        }
        if (job && job.status === "failed") throw new Error((job.error && job.error.message) || "failed");
        return new Promise(function (resolve) {
          setTimeout(resolve, 1000);
        }).then(function () {
          return pollJob(jobId, left - 1);
        });
      });
  }

  function generateSelectionImage(text) {
    var vision = $("bib-vision");
    var status = $("bib-vision-status");
    var img = $("bib-vision-img");
    if (vision) vision.hidden = false;
    if (img) img.classList.remove("is-on");
    if (status) status.textContent = "Generating a still from the passage…";
    var stasis =
      "Museum-quality painting of this King James Scripture, not a photo of a page: " +
      passageRef() +
      " — «" +
      text +
      "». Luminous fine-art, clear figures, reverent and specific to the words.";
    return fetch(bibleApiUrl("/api/generate-stasis-vision"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stasis: stasis,
        buzz_words: ["scripture", "fine art", "biblical"],
        aspect_ratio: "16:9",
      }),
    })
      .then(function (r) {
        if (r.status === 202) {
          return r.json().then(function (d) {
            return pollJob(d.job_id, 90);
          });
        }
        return r.json().then(function (d) {
          if (!r.ok) throw new Error((d && d.error) || "generate failed");
          var im = d.image || (d.images && d.images[0]);
          if (im && im.url) return im.url;
          throw new Error("No image");
        });
      })
      .then(function (url) {
        if (status) status.textContent = passageRef();
        if (img) {
          img.src = url;
          img.classList.add("is-on");
        }
        persistBibleStill(url, passageRef() + " — " + text);
      })
      .catch(function (err) {
        if (status) status.textContent = "Could not generate: " + (err.message || err);
      });
  }

  function animateSelection(text) {
    var tab = document.querySelector('.tab[data-tab="animate"]');
    if (tab) tab.click();
    else location.hash = "animate";
    setTimeout(function () {
      if (window.Animate && typeof window.Animate.seedFromSpellforge === "function") {
        window.Animate.seedFromSpellforge({
          prompt: "Animate this King James passage: " + passageRef() + ". " + text,
          stasis: text,
          aspect: "16:9",
          autoCast: true,
        });
      }
    }, 80);
  }

  function syncListenBtn() {
    var playing = speaking && !userPaused;
    document.querySelectorAll(".bib-play").forEach(function (b) {
      b.classList.toggle("is-on", playing);
    });
    document.querySelectorAll(".bib-pause").forEach(function (b) {
      b.classList.toggle("is-on", speaking && userPaused);
    });
    if (el.scan && (speaking || el.scan.hidden === false)) el.scan.hidden = false;
  }

  function stopSpeech() {
    speakToken += 1;
    speaking = false;
    userPaused = false;
    if (keepAlive) {
      clearInterval(keepAlive);
      keepAlive = 0;
    }
    try {
      if (window.speechSynthesis) window.speechSynthesis.cancel();
    } catch (e) {}
    syncListenBtn();
  }

  function scoreVoice(v) {
    var n = v.name || "";
    var lang = v.lang || "";
    var s = 0;
    if (/^en/i.test(lang)) s += 20;
    if (/en-GB|en-IE|en-AU/i.test(lang)) s += 10;
    if (/Natural|Neural|Online|Premium|Studio|WaveNet/i.test(n)) s += 55;
    if (/Guy|Andrew|Brian|Steffan|Ryan|Christopher|Eric|Thomas|George|Daniel|Arthur/i.test(n)) s += 18;
    if (/Aria|Jenny|Sonia|Emma|Libby|Sonia/i.test(n)) s += 8;
    if (/Google UK English Male/i.test(n)) s += 6;
    if (/(Microsoft David|Microsoft Mark|Microsoft Zira|eSpeak)/i.test(n) && !/Natural|Online/i.test(n)) s -= 50;
    return s;
  }

  function pickVoice() {
    if (!window.speechSynthesis) return null;
    var voices = window.speechSynthesis.getVoices() || [];
    if (!voices.length) return null;
    var wanted = recall(KEY_VOICE);
    if (wanted) {
      var exact = voices.filter(function (v) {
        return v.name === wanted;
      })[0];
      if (exact) return exact;
    }
    var ranked = voices.slice().sort(function (a, b) {
      return scoreVoice(b) - scoreVoice(a);
    });
    return ranked[0] || null;
  }

  function fillVoiceSelect() {
    var sel = $("bib-voice");
    if (!sel || !window.speechSynthesis) return;
    var voices = (window.speechSynthesis.getVoices() || []).filter(function (v) {
      return /^en/i.test(v.lang || "") || !v.lang;
    });
    if (!voices.length) voices = window.speechSynthesis.getVoices() || [];
    var current = recall(KEY_VOICE) || (pickVoice() && pickVoice().name) || "";
    sel.innerHTML = "";
    var auto = document.createElement("option");
    auto.value = "";
    auto.textContent = "Soothing (auto)";
    sel.appendChild(auto);
    voices
      .slice()
      .sort(function (a, b) {
        return scoreVoice(b) - scoreVoice(a);
      })
      .forEach(function (v) {
        var opt = document.createElement("option");
        opt.value = v.name;
        opt.textContent = v.name.replace(/^Microsoft\s+/i, "").replace(/\s+Online \(Natural\)/i, " · natural");
        sel.appendChild(opt);
      });
    sel.value = current;
  }

  function chapterPlain() {
    var page = el.read && el.read.querySelector(".bib-text");
    if (!page) return "";
    return String(page.innerText || "").replace(/\s+/g, " ").trim();
  }

  function wordNodes() {
    if (!el.read) return [];
    return Array.prototype.slice.call(el.read.querySelectorAll(".bib-w"));
  }

  function wordifyChapter() {
    var host = el.read && el.read.querySelector(".bib-text");
    if (!host) return;
    var walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT, null);
    var nodes = [];
    var n;
    while ((n = walker.nextNode())) {
      if (n.parentNode && n.parentNode.classList && n.parentNode.classList.contains("bib-v")) continue;
      if (n.parentNode && n.parentNode.classList && n.parentNode.classList.contains("bib-w")) continue;
      nodes.push(n);
    }
    var idx = 0;
    nodes.forEach(function (node) {
      var parts = String(node.nodeValue || "").split(/(\s+)/);
      if (parts.length === 1 && !parts[0]) return;
      var frag = document.createDocumentFragment();
      parts.forEach(function (p) {
        if (!p) return;
        if (/^\s+$/.test(p)) {
          frag.appendChild(document.createTextNode(p));
          return;
        }
        var span = document.createElement("span");
        span.className = "bib-w";
        span.dataset.wi = String(idx++);
        span.textContent = p;
        frag.appendChild(span);
      });
      node.parentNode.replaceChild(frag, node);
    });
  }

  function ensureScan() {
    if (!el.read) return;
    var scan = $("bib-scan");
    if (!scan) {
      scan = document.createElement("div");
      scan.id = "bib-scan";
      scan.className = "bib-scan";
      scan.hidden = true;
      scan.innerHTML =
        '<span class="bib-scan-bar" aria-hidden="true"></span>' +
        '<button type="button" id="bib-stop" class="bib-stop" hidden>Stop</button>';
      el.read.appendChild(scan);
    } else if (scan.parentNode !== el.read) {
      el.read.appendChild(scan);
    }
    el.scan = scan;
    el.stop = $("bib-stop");
    bindScan();
    if (el.stop && !el.stop.dataset.bound) {
      el.stop.dataset.bound = "1";
      el.stop.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        stopSpeech();
      });
    }
  }

  function placeScanOnWord(i) {
    var nodes = wordNodes();
    if (!nodes.length || !el.scan) return;
    i = Math.max(0, Math.min(nodes.length - 1, i | 0));
    scanIndex = i;
    nodes.forEach(function (n, k) {
      n.classList.toggle("is-now", k === i);
    });
    var w = nodes[i];
    var host = el.read.getBoundingClientRect();
    var r = w.getBoundingClientRect();
    el.scan.style.left = r.left - host.left + el.read.scrollLeft - 1 + "px";
    el.scan.style.top = r.top - host.top + el.read.scrollTop + "px";
    el.scan.style.height = r.height + "px";
    el.scan.hidden = false;
    if (speaking) w.scrollIntoView({ block: "nearest" });
  }

  function wordIndexAtPoint(clientX, clientY) {
    var nodes = wordNodes();
    var best = 0;
    var bestD = Infinity;
    nodes.forEach(function (n, i) {
      var r = n.getBoundingClientRect();
      var cx = r.left + r.width / 2;
      var cy = r.top + r.height / 2;
      var d = Math.abs(clientX - cx) + Math.abs(clientY - cy);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  function bindScan() {
    if (!el.scan || el.scan.dataset.bound) return;
    el.scan.dataset.bound = "1";
    el.scan.addEventListener("pointerdown", function (e) {
      if (e.target && e.target.closest && e.target.closest(".bib-stop")) return;
      if (e.button !== 0) return;
      e.preventDefault();
      el.scan.classList.add("is-drag");
      el.scan.setPointerCapture(e.pointerId);
      var dragging = true;
      function move(ev) {
        if (!dragging) return;
        placeScanOnWord(wordIndexAtPoint(ev.clientX, ev.clientY));
      }
      function up(ev) {
        dragging = false;
        el.scan.classList.remove("is-drag");
        try {
          el.scan.releasePointerCapture(ev.pointerId);
        } catch (err) {}
        el.scan.removeEventListener("pointermove", move);
        el.scan.removeEventListener("pointerup", up);
        speakFromWord(scanIndex);
      }
      el.scan.addEventListener("pointermove", move);
      el.scan.addEventListener("pointerup", up);
    });
  }

  function speakFromWord(startI) {
    var nodes = wordNodes();
    if (!nodes.length) {
      speakText(selectionText() || lastPick || chapterPlain());
      return;
    }
    startI = Math.max(0, Math.min(nodes.length - 1, startI | 0));
    scanIndex = startI;
    placeScanOnWord(startI);
    var parts = [];
    var i;
    for (i = startI; i < nodes.length; i++) parts.push(nodes[i].textContent);
    speakText(parts.join(" "), startI);
  }

  function speakText(text, startWord) {
    if (!window.speechSynthesis) {
      window.alert("This browser cannot read aloud. Try Chrome or Edge.");
      return;
    }
    text = String(text || "").replace(/\s+/g, " ").trim();
    if (!text) return;
    var synth = window.speechSynthesis;
    var token = ++speakToken;
    heldUtterances = [];
    var origin = typeof startWord === "number" ? startWord : scanIndex;
    speaking = true;
    userPaused = false;
    syncListenBtn();
    placeScanOnWord(origin);
    function wordAt(charIndex) {
      var nodes = wordNodes();
      var acc = 0;
      var w;
      for (w = origin; w < nodes.length; w++) {
        var len = nodes[w].textContent.length;
        if (charIndex <= acc + len) return w;
        acc += len + 1;
      }
      return nodes.length ? nodes.length - 1 : 0;
    }
    function finished() {
      if (token !== speakToken) return;
      speaking = false;
      userPaused = false;
      if (keepAlive) {
        clearInterval(keepAlive);
        keepAlive = 0;
      }
      syncListenBtn();
    }
    var u = new SpeechSynthesisUtterance(text.length > 12000 ? text.slice(0, 12000) : text);
    var v = pickVoice();
    if (v) u.voice = v;
    u.lang = (v && v.lang) || "en-US";
    u.rate = 0.82;
    u.pitch = 0.88;
    u.volume = 1;
    u.onboundary = function (ev) {
      if (token !== speakToken) return;
      if ((ev.name || "") !== "word") return;
      placeScanOnWord(wordAt(ev.charIndex || 0));
    };
    u.onend = function () {
      if (token !== speakToken) return;
      finished();
    };
    u.onerror = function (ev) {
      if (token !== speakToken) return;
      var err = (ev && ev.error) || "";
      if (err === "interrupted" || err === "canceled") return;
      finished();
    };
    heldUtterances.push(u);
    try {
      if (synth.paused) synth.resume();
    } catch (eRes) {}
    synth.speak(u);
    if (keepAlive) clearInterval(keepAlive);
    keepAlive = setInterval(function () {
      if (token !== speakToken || !speaking || userPaused) return;
      try {
        if (synth.paused) synth.resume();
      } catch (eKeep) {}
    }, 4000);
  }

  function playSpeech() {
    var synth = window.speechSynthesis;
    if (synth && synth.paused) {
      userPaused = false;
      speaking = true;
      try {
        synth.resume();
      } catch (eRes) {}
      syncListenBtn();
      return;
    }
    if (speaking && synth && synth.speaking) return;
    var nodes = wordNodes();
    var from = scanIndex;
    var sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.anchorNode && el.read && el.read.contains(sel.anchorNode)) {
      var w =
        sel.anchorNode.parentElement && sel.anchorNode.parentElement.closest
          ? sel.anchorNode.parentElement.closest(".bib-w")
          : null;
      if (w && w.dataset.wi) from = Number(w.dataset.wi);
    }
    if (!nodes.length) {
      speakText(selectionText() || lastPick || chapterPlain(), 0);
      return;
    }
    speakFromWord(from);
  }

  function pauseSpeech() {
    userPaused = true;
    try {
      if (window.speechSynthesis) window.speechSynthesis.pause();
    } catch (eP) {}
    syncListenBtn();
  }

  function injectTitleTransport() {
    var head = el.read && el.read.querySelector(".bib-chapter-head");
    if (!head || head.querySelector(".bib-transport")) return;
    var row = document.createElement("div");
    row.className = "bib-transport bib-transport-title";
    row.innerHTML =
      '<button type="button" class="bib-icon-btn bib-play" title="Play">▶</button>' +
      '<button type="button" class="bib-icon-btn bib-pause" title="Pause">❚❚</button>';
    head.appendChild(row);
    syncListenBtn();
  }

  function startListen() {
    playSpeech();
  }

  function onBibleContext(e) {
    if (!el.read || !el.read.contains(e.target)) return;
    var text = selectionText();
    if (!text) text = lastPick;
    if (!text) return;
    e.preventDefault();
    lastPick = text;
    showCtx(e.clientX, e.clientY);
  }

  /* ---------- chrome ---------- */

  function applySize() {
    var shell = el.shell;
    if (shell) shell.style.setProperty("--bib-size", SIZES[sizeIdx] + "rem");
    store(KEY_SIZE, String(sizeIdx));
  }

  function closeNavOnMobile() {
    if (el.shell && window.matchMedia("(max-width: 760px)").matches) {
      el.shell.classList.remove("nav-open");
    }
  }

  function wire() {
    el.prev.addEventListener("click", function () {
      step(-1);
    });
    el.next.addEventListener("click", function () {
      step(1);
    });
    el.smaller.addEventListener("click", function () {
      sizeIdx = Math.max(0, sizeIdx - 1);
      applySize();
    });
    el.bigger.addEventListener("click", function () {
      sizeIdx = Math.min(SIZES.length - 1, sizeIdx + 1);
      applySize();
    });
    el.menu.addEventListener("click", function () {
      el.shell.classList.toggle("nav-open");
    });
    fillVoiceSelect();
    if (window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = fillVoiceSelect;
    }
    var voiceSel = $("bib-voice");
    if (voiceSel && !voiceSel.dataset.bound) {
      voiceSel.dataset.bound = "1";
      voiceSel.addEventListener("change", function () {
        store(KEY_VOICE, voiceSel.value || "");
      });
    }
    if (el.shell && !el.shell.dataset.transportBound) {
      el.shell.dataset.transportBound = "1";
      el.shell.addEventListener(
        "pointerdown",
        function (e) {
          var t = e.target;
          if (t && t.nodeType === 3) t = t.parentElement;
          if (!t || !t.closest) return;
          if (t.closest(".bib-play")) {
            e.preventDefault();
            e.stopPropagation();
            playSpeech();
          } else if (t.closest(".bib-pause")) {
            e.preventDefault();
            e.stopPropagation();
            pauseSpeech();
          }
        },
        true
      );
    }
    el.read.addEventListener("scroll", function () {
      if (el.scan && !el.scan.hidden) placeScanOnWord(scanIndex);
    });
    el.read.addEventListener("click", function (e) {
      var w = e.target && e.target.closest && e.target.closest(".bib-w");
      if (!w || w.dataset.wi == null) return;
      placeScanOnWord(Number(w.dataset.wi));
    });
    window.addEventListener("bible-hide", stopSpeech);
    el.search.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        runSearch(el.search.value);
      } else if (e.key === "Escape") {
        el.search.value = "";
        if (searching) {
          searching = false;
          render();
        }
      }
    });

    el.read.addEventListener("mouseup", function () {
      var t = selectionText();
      if (t) lastPick = t;
    });
    el.read.addEventListener("contextmenu", onBibleContext);
    var ctx = $("bib-ctx");
    if (ctx) {
      ctx.addEventListener("click", function (e) {
        e.stopPropagation();
        var act = e.target && e.target.getAttribute("data-bib-ctx");
        hideCtx();
        var text = selectionText() || lastPick;
        if (!text) return;
        if (act === "highlight") wrapSelectionHighlight();
        else if (act === "listen") {
          var w = el.read.querySelector(".bib-w");
          if (w) speakFromWord(scanIndex || 0);
          else speakText(text, 0);
        }
        else if (act === "animate") animateSelection(text);
        else if (act === "image") generateSelectionImage(text);
      });
    }
    document.addEventListener("mousedown", function (e) {
      var menu = $("bib-ctx");
      if (menu && !menu.hidden && !menu.contains(e.target)) hideCtx();
    });
    var visClose = $("bib-vision-close");
    if (visClose) {
      visClose.addEventListener("click", function () {
        var vis = $("bib-vision");
        if (vis) vis.hidden = true;
      });
    }

    document.addEventListener("keydown", function (e) {
      if (document.body.getAttribute("data-active-tab") !== "bible") return;
      var t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowLeft") {
        step(-1);
      } else if (e.key === "ArrowRight") {
        step(1);
      } else if (e.key === "/") {
        e.preventDefault();
        el.search.focus();
      }
    });
  }

  /* ---------- boot ---------- */

  function collect() {
    el.shell = document.querySelector("#panel-bible .bib-shell");
    el.navScroll = $("bib-nav-scroll");
    el.read = $("bib-read");
    el.where = $("bib-where");
    el.prev = $("bib-prev");
    el.next = $("bib-next");
    el.search = $("bib-search");
    el.smaller = $("bib-smaller");
    el.bigger = $("bib-bigger");
    el.menu = $("bib-menu");
    return el.shell && el.navScroll && el.read && el.where && el.prev && el.next && el.search;
  }

  function start() {
    if (started) return;
    if (!collect()) return;
    started = true;
    try {
      if (window.speechSynthesis) window.speechSynthesis.getVoices();
    } catch (eV) {}

    var savedSize = parseInt(recall(KEY_SIZE), 10);
    if (!isNaN(savedSize) && savedSize >= 0 && savedSize < SIZES.length) sizeIdx = savedSize;
    applySize();

    el.read.innerHTML = '<div class="bib-page"><div class="bib-status">Opening the Bible…</div></div>';

    loadIndex()
      .then(function () {
        buildNav();
        wire();
        var saved = (recall(KEY_POS) || "").split(":");
        var b = parseInt(saved[0], 10);
        var c = parseInt(saved[1], 10);
        if (isNaN(b) || b < 0 || b >= index.books.length) b = 0;
        if (isNaN(c) || c < 1) c = 1;
        go(b, c);
      })
      .catch(function (err) {
        started = false;
        el.read.innerHTML =
          '<div class="bib-page"><div class="bib-status">Could not load the Bible text. ' +
          esc(err && err.message ? err.message : "") +
          "</div></div>";
      });
  }

  window.addEventListener("bible-show", start);
  window.BibleReader = { onShow: start };

  if (document.readyState !== "loading") {
    if (document.body && document.body.getAttribute("data-active-tab") === "bible") start();
  } else {
    document.addEventListener("DOMContentLoaded", function () {
      if (document.body.getAttribute("data-active-tab") === "bible") start();
    });
  }
})();
