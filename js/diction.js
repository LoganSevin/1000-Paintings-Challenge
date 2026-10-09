/**
 * Dictionary — every A–Z headword.
 * Highlight a phrase in the definition and right-click to generate that meaning.
 */
(function () {
  "use strict";

  var ROW = 32;
  var letters = "abcdefghijklmnopqrstuvwxyz".split("");
  var lists = {};
  var defs = {};
  var letter = "a";
  var words = [];
  var filtered = [];
  var activeWord = "";
  var currentEntry = null;
  var menuPhrase = "";
  var busy = false;
  var paintRaf = 0;

  function $(id) {
    return document.getElementById(id);
  }

  function apiUrl(path) {
    var base = String(window.SPELLFORGE_API_BASE || "").replace(/\/$/, "");
    return base ? base + path : path;
  }

  function absoluteUrl(url) {
    url = String(url || "");
    if (!url || url.indexOf("data:") === 0 || url.indexOf("blob:") === 0) return url;
    if (/^https?:\/\//i.test(url)) return url;
    if (url.charAt(0) === "/") return location.origin + url;
    return url;
  }

  function setStatus(text) {
    var el = $("dict-status");
    if (el) el.textContent = text || "";
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function loadLetter(ch) {
    ch = String(ch || "a").charAt(0).toLowerCase();
    if (lists[ch]) return Promise.resolve(lists[ch]);
    return fetch("data/diction/" + ch + ".txt", { cache: "force-cache" })
      .then(function (r) {
        if (!r.ok) throw new Error("list");
        return r.text();
      })
      .then(function (text) {
        var rows = text.split(/\r?\n/).filter(Boolean);
        lists[ch] = rows;
        return rows;
      });
  }

  function applyFilter() {
    var q = "";
    var input = $("dict-search");
    if (input) q = String(input.value || "").trim().toLowerCase();
    if (!q) {
      filtered = words;
      return;
    }
    filtered = [];
    for (var i = 0; i < words.length; i++) {
      if (words[i].indexOf(q) !== -1) filtered.push(words[i]);
    }
  }

  function paintList() {
    var host = $("dict-words");
    var inner = $("dict-words-inner");
    var count = $("dict-count");
    if (!host || !inner) return;
    var total = filtered.length;
    if (count) {
      count.textContent = total.toLocaleString() + " words in " + letter.toUpperCase();
    }
    inner.style.height = total * ROW + "px";
    var top = host.scrollTop || 0;
    var height = host.clientHeight || 480;
    var start = Math.max(0, Math.floor(top / ROW) - 8);
    var end = Math.min(total, Math.ceil((top + height) / ROW) + 10);
    var html = [];
    for (var i = start; i < end; i++) {
      var w = filtered[i];
      html.push(
        '<button type="button" class="dict-word' +
          (w === activeWord ? " is-on" : "") +
          '" data-word="' +
          w +
          '" style="top:' +
          i * ROW +
          'px">' +
          w +
          "</button>"
      );
    }
    inner.innerHTML = html.join("");
  }

  function schedulePaint() {
    if (paintRaf) return;
    paintRaf = requestAnimationFrame(function () {
      paintRaf = 0;
      paintList();
    });
  }

  function showLetter(ch) {
    letter = ch;
    var bar = $("dict-letters");
    if (bar) {
      var buttons = bar.querySelectorAll("button");
      for (var i = 0; i < buttons.length; i++) {
        buttons[i].classList.toggle("is-on", buttons[i].getAttribute("data-letter") === ch);
      }
    }
    return loadLetter(ch).then(function (rows) {
      words = rows;
      applyFilter();
      var host = $("dict-words");
      if (host) host.scrollTop = 0;
      paintList();
    });
  }

  function plainDefinition(html) {
    return String(html || "")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/\.mw-parser-output\b[^{}]*\{[^{}]*\}/g, " ")
      .replace(/\s+([,.;:!?])/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
  }

  function entryText(entry) {
    if (!entry || !entry.senses) return "";
    return entry.senses
      .map(function (sense) {
        var line = sense.def || "";
        if (sense.example) {
          var ex = sense.example;
          if (!/[.!?]$/.test(ex)) ex += ".";
          line += " Example: " + ex;
        }
        return line;
      })
      .filter(Boolean)
      .join(" ");
  }

  function renderEntry(entry) {
    var root = $("dict-entry");
    if (!root) return;
    currentEntry = entry;
    if (!entry) {
      root.innerHTML = '<p class="dict-empty">Pick a word.</p>';
      return;
    }
    var senses = entry.senses || [];
    var body = senses.length
      ? senses
          .map(function (sense) {
            return (
              '<p class="dict-sense"><span class="dict-pos">' +
              escapeHtml(sense.pos || "definition") +
              "</span> " +
              escapeHtml(sense.def) +
              (sense.example
                ? '<span class="dict-example">“' + escapeHtml(sense.example) + "”</span>"
                : "") +
              "</p>"
            );
          })
          .join("")
      : '<p class="dict-empty">No published definition for this headword. Highlight the word and right-click to generate it.</p>';
    var figure = "";
    var img = $("dict-result-img");
    if (img && img.getAttribute("src")) {
      figure =
        '<figure class="dict-result"><img id="dict-result-img" alt="Generated from the highlighted phrase" src="' +
        escapeHtml(img.getAttribute("src")) +
        '"></figure>';
    } else {
      figure =
        '<figure class="dict-result" hidden><img id="dict-result-img" alt="Generated from the highlighted phrase"></figure>';
    }
    root.innerHTML =
      "<h3>" +
      escapeHtml(entry.word) +
      "</h3>" +
      (entry.phonetic ? '<p class="dict-phonetic">' + escapeHtml(entry.phonetic) + "</p>" : "") +
      body +
      figure;
  }

  function showImage(url) {
    renderEntry(currentEntry);
    var img = $("dict-result-img");
    var fig = img && img.parentElement;
    if (!img) return;
    img.src = url;
    img.alt = "Generated from the highlighted phrase";
    if (fig) fig.hidden = false;
  }

  function openWord(word) {
    word = String(word || "").toLowerCase();
    if (!word) return;
    activeWord = word;
    paintList();
    if (defs[word]) {
      renderEntry(defs[word]);
      return;
    }
    var root = $("dict-entry");
    if (root) {
      root.innerHTML =
        "<h3>" + escapeHtml(word) + '</h3><p class="dict-empty">Opening the definition…</p>';
    }
    fetch("https://en.wiktionary.org/api/rest_v1/page/definition/" + encodeURIComponent(word))
      .then(function (r) {
        if (r.status === 404) return null;
        if (!r.ok) throw new Error("definition");
        return r.json();
      })
      .then(function (data) {
        var entry = { word: word, phonetic: "", senses: [] };
        var meanings = (data && data.en) || [];
        meanings.forEach(function (meaning) {
          (meaning.definitions || []).slice(0, 3).forEach(function (def) {
            var text = plainDefinition(def && def.definition);
            if (!text) return;
            var example = "";
            if (def.parsedExamples && def.parsedExamples[0]) {
              example = plainDefinition(def.parsedExamples[0].example);
            }
            entry.senses.push({
              pos: meaning.partOfSpeech || "",
              def: text,
              example: example,
            });
          });
        });
        entry.senses = entry.senses.slice(0, 8);
        defs[word] = entry;
        if (activeWord === word) renderEntry(entry);
      })
      .catch(function () {
        if (activeWord !== word) return;
        defs[word] = { word: word, phonetic: "", senses: [] };
        renderEntry(defs[word]);
        setStatus("The definition did not open. You can still highlight the headword and right-click.");
      });
  }

  function selectionPhrase() {
    var root = $("dict-entry");
    var sel = window.getSelection();
    if (!root || !sel || sel.isCollapsed || !sel.rangeCount) return "";
    if (!root.contains(sel.anchorNode)) return "";
    return String(sel.toString() || "").replace(/\s+/g, " ").trim();
  }

  function wordAtPoint(x, y) {
    var root = $("dict-entry");
    if (!root || !document.caretRangeFromPoint) return "";
    var range = document.caretRangeFromPoint(x, y);
    if (!range || !root.contains(range.startContainer)) return "";
    var node = range.startContainer;
    if (!node || node.nodeType !== 3) return "";
    var text = node.nodeValue || "";
    var i = range.startOffset;
    var a = i;
    var b = i;
    while (a > 0 && /[A-Za-z'’-]/.test(text.charAt(a - 1))) a -= 1;
    while (b < text.length && /[A-Za-z'’-]/.test(text.charAt(b))) b += 1;
    return text.slice(a, b).replace(/\s+/g, " ").trim();
  }

  function hideMenu() {
    var menu = $("dict-menu");
    if (menu) menu.hidden = true;
    menuPhrase = "";
  }

  function openMenu(x, y, phrase) {
    var menu = $("dict-menu");
    var btn = $("dict-menu-go");
    if (!menu || !btn) return;
    menuPhrase = phrase;
    var label = phrase.length > 42 ? phrase.slice(0, 40) + "…" : phrase;
    btn.textContent = "Generate “" + label + "”";
    menu.hidden = false;
    menu.style.left = "0px";
    menu.style.top = "0px";
    var rect = menu.getBoundingClientRect();
    var left = Math.min(x, window.innerWidth - rect.width - 8);
    var top = Math.min(y, window.innerHeight - rect.height - 8);
    menu.style.left = Math.max(8, left) + "px";
    menu.style.top = Math.max(8, top) + "px";
  }

  function buildPrompt(phrase, entry) {
    var parts = [
      "Paint one original image of this dictionary meaning.",
      "Phrase: " + phrase + ".",
    ];
    if (entry && entry.word) parts.push("Headword: " + entry.word + ".");
    var gloss = entryText(entry);
    if (gloss) parts.push(gloss);
    var out = parts.join(" ");
    if (out.length > 7000) out = out.slice(0, 7000);
    return out;
  }

  function extractImageUrl(payload) {
    if (!payload) return "";
    var img = payload.image || (payload.images && payload.images[0]);
    var raw =
      (img && (img.url || img.download_url || img.uri)) ||
      payload.image_url ||
      payload.output_url ||
      payload.result_url ||
      "";
    return absoluteUrl(raw);
  }

  function pollImageJob(jobId, left) {
    if (left == null) left = 40;
    if (left <= 0) return Promise.reject(new Error("The painting did not finish."));
    return fetch(apiUrl("/api/jobs/" + encodeURIComponent(jobId)), { cache: "no-store" })
      .then(function (r) {
        return r.json();
      })
      .then(function (job) {
        var st = String((job && job.status) || "").toLowerCase();
        if (st === "done" || st === "completed" || st === "success") {
          var url = extractImageUrl(job);
          if (url) return url;
          throw new Error("The painting finished without an image.");
        }
        if (st === "failed" || st === "error" || st === "expired") {
          throw new Error((job && job.error) || "The painting did not finish.");
        }
        return new Promise(function (resolve) {
          setTimeout(resolve, 1500);
        }).then(function () {
          return pollImageJob(jobId, left - 1);
        });
      });
  }

  function quietError(err) {
    var msg = String((err && err.message) || err || "");
    if (/api key|capacity|pollinations|cloudflare|incorrect api|insufficient balance/i.test(msg)) {
      return "The painting did not start. Try the phrase again.";
    }
    return msg.slice(0, 180) || "The painting did not start.";
  }

  function generate(phrase) {
    if (busy || !phrase) return;
    busy = true;
    hideMenu();
    var prompt = buildPrompt(phrase, currentEntry);
    var jobId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : "diction-" + Date.now();
    setStatus("Painting the meaning of “" + phrase.slice(0, 80) + "”…");
    fetch(apiUrl("/api/generate-stasis-vision"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        job_id: jobId,
        stasis: prompt,
        prompt: prompt,
        buzz_words: ["dictionary meaning", "single subject"],
        spells: [],
        aspect_ratio: "16:9",
        mag_fresh: true,
        spell_cast: false,
        fresh_variation: true,
        source: "diction",
      }),
    })
      .then(function (r) {
        return r.json().then(function (d) {
          return { ok: r.ok, status: r.status, d: d };
        });
      })
      .then(function (res) {
        var d = res.d || {};
        var url = extractImageUrl(d);
        if (url) return url;
        if (res.status === 202 || d.job_id || jobId) return pollImageJob(d.job_id || jobId);
        throw new Error((d && d.error) || "The painting did not start.");
      })
      .then(function (url) {
        showImage(url);
        setStatus("Painted “" + phrase.slice(0, 80) + "”.");
      })
      .catch(function (err) {
        setStatus(quietError(err));
      })
      .then(function () {
        busy = false;
      });
  }

  function onEntryContext(e) {
    var root = $("dict-entry");
    if (!root || !root.contains(e.target)) return;
    if (e.target.closest && e.target.closest(".dict-result")) return;
    var phrase = selectionPhrase() || wordAtPoint(e.clientX, e.clientY);
    e.preventDefault();
    if (!phrase) {
      setStatus("Highlight a phrase in the definition, then right-click it.");
      hideMenu();
      return;
    }
    openMenu(e.clientX, e.clientY, phrase);
  }

  function bind() {
    var bar = $("dict-letters");
    if (bar && !bar.dataset.bound) {
      bar.dataset.bound = "1";
      bar.innerHTML = letters
        .map(function (ch) {
          return (
            '<button type="button" data-letter="' +
            ch +
            '">' +
            ch.toUpperCase() +
            "</button>"
          );
        })
        .join("");
      bar.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-letter]");
        if (!btn) return;
        var input = $("dict-search");
        if (input) input.value = "";
        showLetter(btn.getAttribute("data-letter")).catch(function () {
          setStatus("That letter did not load.");
        });
      });
    }

    var host = $("dict-words");
    if (host && !host.dataset.bound) {
      host.dataset.bound = "1";
      host.addEventListener("scroll", schedulePaint);
      host.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-word]");
        if (!btn) return;
        openWord(btn.getAttribute("data-word"));
      });
    }

    var search = $("dict-search");
    if (search && !search.dataset.bound) {
      search.dataset.bound = "1";
      search.addEventListener("input", function () {
        var q = String(search.value || "").trim().toLowerCase();
        var next = q && /[a-z]/.test(q.charAt(0)) ? q.charAt(0) : letter;
        var run = function () {
          applyFilter();
          var scroller = $("dict-words");
          if (scroller) scroller.scrollTop = 0;
          paintList();
        };
        if (next !== letter) {
          showLetter(next).then(run).catch(function () {
            setStatus("That letter did not load.");
          });
          return;
        }
        run();
      });
      search.addEventListener("keydown", function (e) {
        if (e.key === "Enter" && filtered[0]) {
          e.preventDefault();
          openWord(filtered[0]);
        }
      });
    }

    var entry = $("dict-entry");
    if (entry && !entry.dataset.bound) {
      entry.dataset.bound = "1";
      entry.addEventListener("contextmenu", onEntryContext);
    }

    var go = $("dict-menu-go");
    if (go && !go.dataset.bound) {
      go.dataset.bound = "1";
      go.addEventListener("click", function () {
        generate(menuPhrase);
      });
    }

    if (!bind.done) {
      bind.done = true;
      document.addEventListener("click", function (e) {
        var menu = $("dict-menu");
        if (!menu || menu.hidden) return;
        if (menu.contains(e.target)) return;
        hideMenu();
      });
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape") hideMenu();
      });
      window.addEventListener("resize", hideMenu);
    }
  }

  function onShow() {
    bind();
    if (!words.length) {
      showLetter("a").catch(function () {
        setStatus("The dictionary did not load.");
      });
    } else {
      paintList();
    }
  }

  window.Diction = { onShow: onShow };
  document.addEventListener("diction-show", onShow);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();
