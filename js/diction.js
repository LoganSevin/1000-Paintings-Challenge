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
  var STORE = "l7in_diction_inventory_v1";
  var inventory = {};
  var picked = {};

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

  function loadInventory() {
    try {
      var raw = JSON.parse(localStorage.getItem(STORE) || "{}");
      inventory = raw && typeof raw === "object" ? raw : {};
    } catch (e) {
      inventory = {};
    }
  }

  function saveInventory() {
    var keys = Object.keys(inventory);
    if (keys.length > 80) {
      keys.sort(function (a, b) {
        var aa = inventory[a][0] && inventory[a][0].at;
        var bb = inventory[b][0] && inventory[b][0].at;
        return (aa || 0) - (bb || 0);
      });
      keys.slice(0, keys.length - 80).forEach(function (key) {
        delete inventory[key];
      });
    }
    var stored = {};
    Object.keys(inventory).forEach(function (key) {
      var list = paintingsFor(key).filter(function (item) {
        return !(String(item.url).indexOf("data:") === 0 && String(item.url).length > 120000);
      });
      if (list.length) stored[key] = list;
    });
    try {
      localStorage.setItem(STORE, JSON.stringify(stored));
    } catch (e) {
      keys = Object.keys(stored);
      keys.slice(0, Math.ceil(keys.length / 2)).forEach(function (key) {
        delete stored[key];
        delete inventory[key];
      });
      try {
        localStorage.setItem(STORE, JSON.stringify(stored));
      } catch (e2) {}
    }
  }

  function paintingsFor(word) {
    var list = inventory[word];
    return Array.isArray(list) ? list : [];
  }

  function rememberPainting(word, phrase, url) {
    word = String(word || "").toLowerCase();
    url = String(url || "");
    if (!word || !url) return;
    var list = paintingsFor(word).slice();
    list.unshift({
      phrase: String(phrase || word).replace(/\s+/g, " ").trim().slice(0, 180),
      url: url,
      at: Date.now(),
    });
    if (list.length > 24) list.length = 24;
    inventory[word] = list;
    picked[word] = 0;
    saveInventory();
  }

  function chosenPainting(word) {
    var list = paintingsFor(word);
    if (!list.length) return null;
    var idx = picked[word];
    if (idx == null || idx < 0 || idx >= list.length) idx = 0;
    picked[word] = idx;
    return list[idx];
  }

  function inventoryMarkup(word) {
    var list = paintingsFor(word);
    if (!list.length) return "";
    var chosen = chosenPainting(word);
    var rows = list
      .map(function (item, i) {
        var on = item === chosen;
        return (
          '<button type="button" class="dict-inventory-item' +
          (on ? " is-on" : "") +
          '" data-inv="' +
          i +
          '" role="option" aria-selected="' +
          (on ? "true" : "false") +
          '"><img alt="" src="' +
          escapeHtml(item.url) +
          '"><span>' +
          escapeHtml(item.phrase || word) +
          "</span></button>"
        );
      })
      .join("");
    return (
      '<div class="dict-inventory">' +
      '<p class="dict-inventory-label">Image inventory</p>' +
      '<button type="button" id="dict-inventory-toggle" class="dict-inventory-toggle" aria-expanded="false" aria-haspopup="listbox" aria-label="Image inventory">' +
      '<img alt="" src="' +
      escapeHtml(chosen.url) +
      '"><span>' +
      escapeHtml(chosen.phrase || word) +
      '</span><em>' +
      list.length +
      "</em></button>" +
      '<div id="dict-inventory-menu" class="dict-inventory-menu" hidden role="listbox" aria-label="Image inventory">' +
      rows +
      "</div></div>"
    );
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
        var ex = sense.examples && sense.examples[0] && sense.examples[0].text;
        if (ex) {
          if (!/[.!?]$/.test(ex)) ex += ".";
          line += " In a sentence: " + ex;
        }
        return line;
      })
      .filter(Boolean)
      .join(" ");
  }

  function markUses(sentence, forms) {
    var list = [];
    (forms || []).forEach(function (form) {
      form = String(form || "").trim();
      if (!form) return;
      var key = form.toLowerCase();
      if (list.some(function (item) { return item.toLowerCase() === key; })) return;
      list.push(form);
    });
    list.sort(function (a, b) { return b.length - a.length; });
    var safe = escapeHtml(sentence);
    if (!list.length) return safe;
    var re = new RegExp(
      "\\b(" +
        list
          .map(function (form) {
            return form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          })
          .join("|") +
        ")\\b",
      "gi"
    );
    return safe.replace(re, "<mark>$1</mark>");
  }

  function takeExamples(def) {
    var raw = [];
    var parsed = (def && def.parsedExamples) || [];
    var i;
    for (i = 0; i < parsed.length; i++) {
      var html = parsed[i] && (parsed[i].example || parsed[i]);
      if (html) raw.push(String(html));
    }
    if (!raw.length && def && def.examples) {
      for (i = 0; i < def.examples.length; i++) raw.push(String(def.examples[i]));
    }
    var out = [];
    for (i = 0; i < raw.length && out.length < 2; i++) {
      var forms = [];
      raw[i].replace(/<b>([^<]+)<\/b>/gi, function (_, used) {
        forms.push(plainDefinition(used));
        return _;
      });
      var text = plainDefinition(raw[i]);
      if (!text || text.length < 2) continue;
      if (out.some(function (item) { return item.text === text; })) continue;
      out.push({ text: text, forms: forms });
    }
    return out;
  }

  function blocksFrom(data) {
    var meanings = (data && data.en) || [];
    var english = meanings.filter(function (meaning) {
      return (meaning.language || "English") === "English";
    });
    if (english.length) meanings = english;
    var blocks = [];
    meanings.forEach(function (meaning) {
      var pos = meaning.partOfSpeech || "definition";
      var senses = [];
      (meaning.definitions || []).forEach(function (def) {
        var html = (def && def.definition) || "";
        if (/<ol\b/i.test(html)) return;
        var text = plainDefinition(html);
        if (!text) return;
        senses.push({
          pos: pos,
          def: text,
          examples: takeExamples(def),
        });
      });
      var picked = [];
      var spare = null;
      senses.forEach(function (sense) {
        if (picked.length < 3) picked.push(sense);
        else if (!spare && sense.examples.length) spare = sense;
      });
      if (spare) picked.push(spare);
      if (!picked.length) return;
      var existing = null;
      blocks.forEach(function (block) {
        if (block.pos.toLowerCase() === pos.toLowerCase()) existing = block;
      });
      if (!existing) {
        blocks.push({ pos: pos, senses: picked });
        return;
      }
      picked.forEach(function (sense) {
        if (existing.senses.length >= 3) return;
        var already = existing.senses.some(function (item) {
          return item.examples.length;
        });
        if (!sense.examples.length && already) return;
        existing.senses.push(sense);
      });
    });
    return blocks.slice(0, 6);
  }

  function renderSenses(entry) {
    var blocks = entry.blocks || [];
    if (!blocks.length) {
      return '<p class="dict-empty">No published definition for this headword. Highlight the word and right-click to generate it.</p>';
    }
    return blocks
      .map(function (block) {
        var any = block.senses.some(function (sense) {
          return sense.examples && sense.examples.length;
        });
        var body = block.senses
          .map(function (sense) {
            var sentences = (sense.examples || [])
              .map(function (ex) {
                return (
                  '<p class="dict-sentence"><span class="dict-sentence-label">In a sentence</span> ' +
                  markUses(ex.text, (ex.forms || []).concat([entry.word])) +
                  "</p>"
                );
              })
              .join("");
            return '<div class="dict-sense"><p class="dict-def">' + escapeHtml(sense.def) + "</p>" + sentences + "</div>";
          })
          .join("");
        var missing = any
          ? ""
          : '<p class="dict-sentence dict-sentence-missing"><span class="dict-sentence-label">In a sentence</span> No published sentence for this part of speech.</p>';
        return (
          '<section class="dict-pos-block"><h4>' +
          escapeHtml(block.pos) +
          "</h4>" +
          body +
          missing +
          "</section>"
        );
      })
      .join("");
  }

  function renderEntry(entry) {
    var root = $("dict-entry");
    if (!root) return;
    currentEntry = entry;
    if (!entry) {
      root.innerHTML = '<p class="dict-empty">Pick a word.</p>';
      return;
    }
    var body = renderSenses(entry);
    var painting = chosenPainting(entry.word);
    var figure = painting
      ? '<figure class="dict-result"><img id="dict-result-img" alt="' +
        escapeHtml(painting.phrase || entry.word) +
        '" src="' +
        escapeHtml(painting.url) +
        '"></figure>'
      : "";
    root.innerHTML =
      "<h3>" +
      escapeHtml(entry.word) +
      "</h3>" +
      (entry.phonetic ? '<p class="dict-phonetic">' + escapeHtml(entry.phonetic) + "</p>" : "") +
      body +
      inventoryMarkup(entry.word) +
      figure;
  }

  function showImage(word, phrase, url) {
    rememberPainting(word, phrase, url);
    if (activeWord === word && currentEntry && currentEntry.word === word) renderEntry(currentEntry);
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
        "<h3>" +
        escapeHtml(word) +
        '</h3><p class="dict-empty">Opening the definition…</p>' +
        inventoryMarkup(word);
    }
    fetch("https://en.wiktionary.org/api/rest_v1/page/definition/" + encodeURIComponent(word))
      .then(function (r) {
        if (r.status === 404) return null;
        if (!r.ok) throw new Error("definition");
        return r.json();
      })
      .then(function (data) {
        var entry = { word: word, phonetic: "", senses: [], blocks: [] };
        entry.blocks = data ? blocksFrom(data) : [];
        entry.blocks.forEach(function (block) {
          block.senses.forEach(function (sense) {
            entry.senses.push(sense);
          });
        });
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
    var word = activeWord || (currentEntry && currentEntry.word) || "";
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
        showImage(word, phrase, url);
        setStatus(
          "Painted “" +
            phrase.slice(0, 80) +
            "”." +
            (word ? " It is in the image inventory for " + word + "." : "")
        );
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
    if (e.target.closest && e.target.closest(".dict-result, .dict-inventory")) return;
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
      entry.addEventListener("click", function (e) {
        var toggle = e.target.closest(".dict-inventory-toggle");
        if (toggle) {
          var menu = $("dict-inventory-menu");
          if (!menu) return;
          var willOpen = menu.hidden;
          menu.hidden = !willOpen;
          toggle.setAttribute("aria-expanded", willOpen ? "true" : "false");
          return;
        }
        var opt = e.target.closest("[data-inv]");
        if (!opt || !activeWord) return;
        picked[activeWord] = parseInt(opt.getAttribute("data-inv"), 10) || 0;
        if (currentEntry && currentEntry.word === activeWord) renderEntry(currentEntry);
      });
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
        if (menu && !menu.hidden && !menu.contains(e.target)) hideMenu();
        if (e.target.closest && e.target.closest(".dict-inventory")) return;
        var inventoryMenu = $("dict-inventory-menu");
        var toggle = $("dict-inventory-toggle");
        if (inventoryMenu && !inventoryMenu.hidden) {
          inventoryMenu.hidden = true;
          if (toggle) toggle.setAttribute("aria-expanded", "false");
        }
      });
      document.addEventListener("keydown", function (e) {
        if (e.key !== "Escape") return;
        hideMenu();
        var inventoryMenu = $("dict-inventory-menu");
        var toggle = $("dict-inventory-toggle");
        if (inventoryMenu) inventoryMenu.hidden = true;
        if (toggle) toggle.setAttribute("aria-expanded", "false");
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

  loadInventory();
  window.Diction = { onShow: onShow };
  document.addEventListener("diction-show", onShow);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();
