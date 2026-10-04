/**
 * Codes — look up an 8-character reference.
 * The space runs 00000000 to zzzzzzzz. A code inside 0-f is also a color with alpha.
 */
(function () {
  "use strict";

  var BOOK = {
    "1b9cfd4f": {
      outcome: "Cameos opens with no key wall.",
      href: "#cameos",
    },
    "3c87f1e7": {
      outcome: "Grok generates a new Cameos short from the uploaded reference, in the Eve voice.",
      href: "#cameos",
    },
  };

  function clearStills() {
    var old = $("codes-stills");
    if (old) old.remove();
  }

  function renderStills(stills) {
    clearStills();
    if (!stills || !stills.length) return;
    var list = document.createElement("ol");
    list.id = "codes-stills";
    list.className = "codes-stills";
    stills.forEach(function (still) {
      var item = document.createElement("li");
      var title = document.createElement("strong");
      var number = still && still.number != null ? "#" + still.number : "#";
      title.textContent = number + (still && still.title ? " " + still.title : "");
      var desc = document.createElement("span");
      desc.textContent = (still && still.description) || "";
      item.appendChild(title);
      item.appendChild(desc);
      list.appendChild(item);
    });
    var stage = document.querySelector("#panel-codes .codes-stage");
    if (stage) stage.appendChild(list);
  }

  function applyBook(extra) {
    if (!extra || typeof extra !== "object") return;
    Object.keys(extra).forEach(function (code) {
      if (!/^[0-9a-z]{8}$/.test(code)) return;
      var row = extra[code];
      if (!row || typeof row !== "object") return;
      BOOK[code] = {
        outcome: String(row.outcome || ""),
        href: String(row.href || "#codes"),
        stills: Array.isArray(row.stills) ? row.stills : null,
      };
    });
  }

  function loadBook() {
    return fetch("data/codes.json", { cache: "no-store" })
      .then(function (response) {
        return response.ok ? response.json() : null;
      })
      .then(function (data) {
        applyBook(data);
        var input = $("codes-input");
        show(clean(input && input.value));
      })
      .catch(function () {});
  }

  function $(id) {
    return document.getElementById(id);
  }

  function clean(raw) {
    return String(raw || "").toLowerCase().replace(/[^0-9a-z]/g, "").slice(0, 8);
  }

  function isHex(code) {
    return /^[0-9a-f]{8}$/.test(code);
  }

  function swatchStyle(code) {
    if (!isHex(code)) return "";
    var rgb = "#" + code.slice(0, 6);
    var alpha = parseInt(code.slice(6), 16) / 255;
    return "background:" + rgb + ";opacity:" + alpha.toFixed(4) + ";";
  }

  function renderBook(current) {
    var list = $("codes-book");
    if (!list) return;
    list.innerHTML = "";
    Object.keys(BOOK).forEach(function (code) {
      var item = document.createElement("li");
      var btn = document.createElement("button");
      btn.type = "button";
      if (code === current) btn.className = "is-on";
      var chip = document.createElement("i");
      chip.style.cssText = swatchStyle(code);
      var text = document.createElement("div");
      var name = document.createElement("code");
      name.textContent = code;
      var note = document.createElement("span");
      note.textContent = BOOK[code].outcome;
      text.appendChild(name);
      text.appendChild(note);
      btn.appendChild(chip);
      btn.appendChild(text);
      btn.addEventListener("click", function () {
        var input = $("codes-input");
        if (input) input.value = code;
        show(code);
      });
      item.appendChild(btn);
      list.appendChild(item);
    });
  }

  function show(code) {
    var swatch = $("codes-swatch");
    var read = $("codes-read");
    if (!swatch || !read) return;
    var ink = swatch.querySelector("i");
    if (!ink) {
      ink = document.createElement("i");
      swatch.appendChild(ink);
    }
    renderBook(code);
    clearStills();
    if (code.length !== 8) {
      ink.style.cssText = "";
      read.textContent = "Eight characters, from 0–9 through a–z.";
      return;
    }
    var filed = BOOK[code];
    if (isHex(code)) {
      var rgb = "#" + code.slice(0, 6);
      var alpha = code.slice(6);
      var pct = Math.round((parseInt(alpha, 16) / 255) * 1000) / 10;
      ink.style.cssText = swatchStyle(code);
      read.textContent = "";
      var line = document.createElement("p");
      line.textContent = rgb + " at alpha " + alpha + " (" + pct + "%).";
      read.appendChild(line);
      if (filed) {
        var out = document.createElement("p");
        if (filed.href && filed.href !== "#codes") {
          var link = document.createElement("a");
          link.href = filed.href;
          link.textContent = filed.outcome;
          out.appendChild(link);
        } else {
          out.textContent = filed.outcome;
        }
        read.appendChild(out);
        renderStills(filed.stills);
      } else {
        var open = document.createElement("p");
        open.textContent = "Open. No statement filed.";
        read.appendChild(open);
      }
      return;
    }
    ink.style.cssText = "background:#14302a;";
    read.textContent = "";
    var data = document.createElement("p");
    data.textContent = "Data reference. This code uses a letter past f, so it is not a color.";
    read.appendChild(data);
    if (filed) {
      var filedLine = document.createElement("p");
      filedLine.textContent = filed.outcome;
      read.appendChild(filedLine);
      renderStills(filed.stills);
    } else {
      var empty = document.createElement("p");
      empty.textContent = "Open. No statement filed.";
      read.appendChild(empty);
    }
  }

  function bind() {
    var input = $("codes-input");
    if (!input || input.dataset.bound) return;
    input.dataset.bound = "1";
    input.addEventListener("input", function () {
      var next = clean(input.value);
      if (next !== input.value) input.value = next;
      show(next);
    });
    var form = input.form;
    if (form) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        show(clean(input.value));
      });
    }
    show(clean(input.value));
    loadBook();
  }

  function onShow() {
    bind();
  }

  window.addEventListener("codes-show", onShow);
  window.addEventListener("tab-changed", function (e) {
    if (e.detail && e.detail.tab === "codes") onShow();
  });
  window.Codes = { onShow: onShow };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      if (document.body.getAttribute("data-active-tab") === "codes") onShow();
    });
  } else if (document.body.getAttribute("data-active-tab") === "codes") {
    onShow();
  }
})();
