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
