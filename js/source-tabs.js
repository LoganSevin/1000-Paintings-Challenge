(function () {
  "use strict";

  var cache = {};

  var GLOSSARY = {
    function: "A named block of JavaScript. Call it to run those lines.",
    var: "Older way to declare a name. Function-scoped.",
    let: "Declare a name you can reassign. Block-scoped.",
    const: "Declare a name you should not reassign. Block-scoped.",
    fetch: "Browser call to load a URL. Returns a Promise.",
    localstorage: "Data saved in this browser, survives refresh.",
    addeventlistener: "Hook a function to an event (click, tab-changed, …).",
    queryselector: "Find one element with a CSS selector.",
    classlist: "Add/remove/toggle CSS classes on an element.",
    promise: "A value that arrives later (then / catch).",
    async: "Function that can await Promises.",
    window: "The global page object. window.Foo is a public hook.",
    document: "The HTML document tree.",
    display: "CSS: how a box is shown (block, flex, none, …).",
    flex: "CSS layout that lines children in a row or column.",
    grid: "CSS layout on a 2D grid.",
    color: "CSS text color.",
    background: "CSS fill behind content.",
    "z-index": "CSS stacking order. Higher paints on top.",
    "font-family": "CSS typeface list.",
    selector: "CSS pattern that picks elements (.class, #id, tag).",
    "cache stamp": "The ?v= number so browsers fetch a new file after a change.",
    "v=": "Cache stamp, per file. Not a product edition.",
    spellforge: "The generate tab. Cloud Grok still or on-device fuse.",
    logan7in: "This studio. Logan7in unlimited is the uncapped license.",
    vendor: "xAI. They meter tokens and image gens. Not a studio door.",
    token: "Vendor text unit Grok bills. Not a studio budget.",
    key: "Secret string that tells xAI who to charge.",
  };

  function escapeRe(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function selectedIn(pre) {
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed) return "";
    var t = String(sel).replace(/\s+/g, " ").trim();
    if (!t || t.length > 80) return "";
    if (pre && sel.anchorNode && !pre.contains(sel.anchorNode)) return "";
    return t;
  }

  function identOf(raw) {
    var m = String(raw || "").match(/[A-Za-z_$#-][A-Za-z0-9_$#-]*/);
    return m ? m[0] : String(raw || "").trim();
  }

  function findDecls(kind, text, token) {
    var lines = text.split(/\n/);
    var out = [];
    var t = escapeRe(token);
    var tests =
      kind === "css"
        ? [
            new RegExp("(^|[,{\\s])\\." + t + "\\b"),
            new RegExp("#" + t + "\\b"),
            new RegExp("^\\s*" + t + "\\s*:"),
            new RegExp("--" + t + "\\b"),
          ]
        : [
            new RegExp("function\\s+" + t + "\\s*\\("),
            new RegExp("(?:var|let|const)\\s+" + t + "\\b"),
            new RegExp("\\b" + t + "\\s*=\\s*function"),
            new RegExp("window\\." + t + "\\s*="),
            new RegExp("\\b" + t + "\\s*:\\s*function"),
            new RegExp("class\\s+" + t + "\\b"),
          ];
    for (var i = 0; i < lines.length && out.length < 8; i++) {
      var line = lines[i];
      for (var j = 0; j < tests.length; j++) {
        if (tests[j].test(line)) {
          out.push("L" + (i + 1) + "  " + line.trim().slice(0, 140));
          break;
        }
      }
    }
    return out;
  }

  function defineCode(kind, text, raw) {
    var token = identOf(raw);
    var gloss = GLOSSARY[String(raw).toLowerCase()] || GLOSSARY[token.toLowerCase()];
    var decls = text ? findDecls(kind, text, token) : [];
    var bits = [];
    if (gloss) bits.push(gloss);
    else {
      bits.push(
        kind === "css"
          ? "A CSS name — class, id, property, or custom property in this studio’s styles."
          : "A JavaScript name in this studio. Seek lists every place it is written."
      );
    }
    if (decls.length) {
      bits.push("Declared or assigned here:\n" + decls.join("\n"));
    } else {
      bits.push("No declaration found in this file. Seek still finds every use.");
    }
    bits.push("Affects: every file Seek lists. Changing this name there changes that behavior.");
    return { term: token || raw, text: bits.join("\n\n") };
  }

  function cssEsc(t) {
    if (window.CSS && CSS.escape) return CSS.escape(t);
    return String(t).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  function findAffected(token) {
    var t = identOf(token).replace(/^[#.]/, "");
    if (!t) return [];
    var seen = [];
    function add(el) {
      if (!el || seen.indexOf(el) >= 0) return;
      if (el === document.body || el === document.documentElement) return;
      seen.push(el);
    }
    add(document.getElementById(t));
    add(document.getElementById("panel-" + t));
    try {
      document.querySelectorAll("." + cssEsc(t)).forEach(add);
      document.querySelectorAll("#" + cssEsc(t)).forEach(add);
      document.querySelectorAll('[data-tab="' + t + '"]').forEach(add);
    } catch (e) {}
    return seen.slice(0, 10);
  }

  function clearViewHits() {
    document.querySelectorAll(".src-view-hit").forEach(function (el) {
      el.classList.remove("src-view-hit");
    });
  }

  function fillPipDoc(doc, token, els) {
    doc.title = "View “" + token + "”";
    doc.body.style.margin = "0";
    doc.body.style.background = "#0c0d10";
    doc.body.style.color = "#e8eee6";
    doc.body.style.fontFamily = "Georgia, serif";
    var bar = doc.createElement("div");
    bar.style.cssText = "padding:8px 10px;font-size:12px;color:#e8c547;border-bottom:1px solid #3a3420";
    bar.textContent =
      els.length
        ? "“" + token + "” affects " + els.length + " object" + (els.length === 1 ? "" : "s") + " on the live site."
        : "No live object found for “" + token + "”.";
    doc.body.appendChild(bar);
    var map = doc.createElement("div");
    map.style.cssText =
      "position:relative;height:88px;margin:8px;border:1px solid #c9a227;background:#16140e;overflow:hidden";
    var pageW = Math.max(document.documentElement.scrollWidth, window.innerWidth, 1);
    var pageH = Math.max(document.documentElement.scrollHeight, window.innerHeight, 1);
    els.forEach(function (el) {
      var r = el.getBoundingClientRect();
      var pin = doc.createElement("div");
      var w = Math.max(r.width, 8);
      var h = Math.max(r.height, 8);
      pin.style.cssText =
        "position:absolute;background:rgba(232,197,71,0.55);outline:1px solid #e8c547;left:" +
        ((r.left + window.scrollX) / pageW) * 100 +
        "%;top:" +
        ((r.top + window.scrollY) / pageH) * 100 +
        "%;width:" +
        (w / pageW) * 100 +
        "%;height:" +
        (h / pageH) * 100 +
        "%";
      map.appendChild(pin);
    });
    var you = doc.createElement("div");
    you.style.cssText =
      "position:absolute;border:1px dashed rgba(255,255,255,0.35);left:" +
      (window.scrollX / pageW) * 100 +
      "%;top:" +
      (window.scrollY / pageH) * 100 +
      "%;width:" +
      (window.innerWidth / pageW) * 100 +
      "%;height:" +
      (window.innerHeight / pageH) * 100 +
      "%";
    map.appendChild(you);
    doc.body.appendChild(map);
    var stage = doc.createElement("div");
    stage.style.cssText = "padding:8px;overflow:auto;max-height:220px";
    if (els[0]) {
      try {
        var clone = els[0].cloneNode(true);
        clone.style.maxWidth = "100%";
        clone.style.maxHeight = "200px";
        clone.style.transformOrigin = "top left";
        stage.appendChild(clone);
      } catch (e) {}
    }
    doc.body.appendChild(stage);
    document.querySelectorAll('link[rel="stylesheet"]').forEach(function (link) {
      try {
        doc.head.appendChild(link.cloneNode(true));
      } catch (e2) {}
    });
  }

  function openPipFallback(token, els) {
    var box = document.getElementById("src-pip");
    if (!box) {
      box = document.createElement("div");
      box.id = "src-pip";
      box.className = "src-pip";
      box.innerHTML =
        '<div class="src-pip-bar"><span class="src-pip-title"></span><button type="button" class="src-pip-close">×</button></div><div class="src-pip-body"></div>';
      document.body.appendChild(box);
      box.querySelector(".src-pip-close").addEventListener("click", function () {
        box.hidden = true;
        clearViewHits();
      });
    }
    box.hidden = false;
    box.querySelector(".src-pip-title").textContent = "View “" + token + "”";
    var body = box.querySelector(".src-pip-body");
    body.innerHTML = "";
    fillPipDoc(
      {
        title: "",
        body: body,
        createElement: function (n) {
          return document.createElement(n);
        },
        head: { appendChild: function () {} },
      },
      token,
      els
    );
  }

  function viewAffected(token) {
    clearViewHits();
    var t = identOf(token);
    var els = findAffected(t);
    els.forEach(function (el) {
      el.classList.add("src-view-hit");
    });
    if (window.documentPictureInPicture && documentPictureInPicture.requestWindow) {
      documentPictureInPicture
        .requestWindow({ width: 420, height: 320 })
        .then(function (win) {
          fillPipDoc(win.document, t, els);
          win.addEventListener("pagehide", clearViewHits);
        })
        .catch(function () {
          openPipFallback(t, els);
        });
    } else {
      openPipFallback(t, els);
    }
  }

  function fileName(url) {
    try {
      var u = new URL(url, location.href);
      var path = u.pathname.replace(/^.*\//, "") || u.pathname;
      var v = u.searchParams.get("v");
      return v ? path + "?v=" + v : path;
    } catch (e) {
      return String(url || "").split("/").pop() || url;
    }
  }

  function sameOrigin(url) {
    try {
      return new URL(url, location.href).origin === location.origin;
    } catch (e) {
      return false;
    }
  }

  function listJs() {
    return Array.prototype.map
      .call(document.scripts, function (s) {
        return s.src;
      })
      .filter(function (src) {
        return src && sameOrigin(src);
      })
      .map(function (src) {
        return { name: fileName(src), url: src, kind: "js" };
      });
  }

  function listCss() {
    return Array.prototype.map
      .call(document.querySelectorAll('link[rel="stylesheet"]'), function (l) {
        return l.href;
      })
      .filter(function (href) {
        return href && sameOrigin(href);
      })
      .map(function (href) {
        return { name: fileName(href), url: href, kind: "css" };
      });
  }

  function listHtml() {
    var rows = [
      { name: "index.html (source file)", url: "index.html", kind: "html" },
      {
        name: "live document (DOM)",
        kind: "html",
        live: true,
        get: function () {
          return "<!DOCTYPE html>\n" + document.documentElement.outerHTML;
        },
      },
    ];
    document.querySelectorAll("section.panel[id]").forEach(function (panel) {
      rows.push({
        name: panel.id.replace(/^panel-/, "") + " (" + panel.id + ")",
        kind: "html",
        live: true,
        get: function () {
          return panel.outerHTML;
        },
      });
    });
    return rows;
  }

  function loadItem(item) {
    if (item.live && item.get) return Promise.resolve(item.get());
    if (cache[item.url]) return Promise.resolve(cache[item.url]);
    return fetch(item.url, { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("Could not load " + item.name + " (" + r.status + ")");
      return r.text();
    }).then(function (text) {
      cache[item.url] = text;
      return text;
    });
  }

  function bindPanel(kind) {
    var panel = document.getElementById("panel-" + kind);
    if (!panel) return;
    var search = panel.querySelector(".src-search");
    var files = panel.querySelector(".src-files");
    var pre = panel.querySelector(".src-readout");
    var title = panel.querySelector(".src-current");
    var meta = panel.querySelector(".src-meta");
    var copy = panel.querySelector(".src-copy");
    var seekBtn = panel.querySelector(".src-seek-btn");
    var seekBox = panel.querySelector(".src-seek");
    var seekTitle = panel.querySelector(".src-seek-title");
    var seekList = panel.querySelector(".src-seek-list");
    var items = [];
    var current = null;
    if (files.dataset.bound === "1") {
      return;
    }
    files.dataset.bound = "1";

    function collect() {
      if (kind === "js") items = listJs();
      else if (kind === "css") items = listCss();
      else items = listHtml();
    }

    function paintList(q) {
      q = String(q || "").toLowerCase();
      files.innerHTML = "";
      items.forEach(function (item) {
        if (q && item.name.toLowerCase().indexOf(q) < 0) return;
        var btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = item.name;
        if (current && current.name === item.name) btn.className = "active";
        btn.addEventListener("click", function () {
          openItem(item);
        });
        files.appendChild(btn);
      });
    }

    function showTextWithHit(text, line, token) {
      var lines = text.split(/\n/);
      var i = (line || 0) - 1;
      if (i < 0 || i >= lines.length) {
        pre.textContent = text;
        return;
      }
      pre.textContent = "";
      if (i > 0) pre.appendChild(document.createTextNode(lines.slice(0, i).join("\n") + "\n"));
      var mark = document.createElement("mark");
      mark.className = "src-hit-line";
      mark.id = "src-hit-" + kind;
      var lineText = lines[i];
      if (token && lineText.indexOf(token) >= 0) {
        var parts = lineText.split(token);
        parts.forEach(function (part, idx) {
          if (idx) {
            var tok = document.createElement("mark");
            tok.className = "src-hit-token";
            tok.textContent = token;
            mark.appendChild(tok);
          }
          mark.appendChild(document.createTextNode(part));
        });
      } else {
        mark.textContent = lineText || " ";
      }
      pre.appendChild(mark);
      if (i < lines.length - 1) {
        pre.appendChild(document.createTextNode("\n" + lines.slice(i + 1).join("\n")));
      }
      requestAnimationFrame(function () {
        mark.scrollIntoView({ block: "center", inline: "nearest" });
      });
    }

    function openItem(item, line, token) {
      current = item;
      paintList(search && search.value);
      title.textContent = item.name;
      function apply(text) {
        item.content = text;
        current.content = text;
        var lines = text.split(/\r?\n/).length;
        meta.textContent = lines + " lines · " + text.length + " chars";
        if (line) showTextWithHit(text, line, token);
        else pre.textContent = text;
      }
      if (item.content && !line) {
        apply(item.content);
        return;
      }
      if (item.content && line) {
        apply(item.content);
        return;
      }
      pre.textContent = "Loading…";
      loadItem(item)
        .then(apply)
        .catch(function (err) {
          pre.textContent = String((err && err.message) || err);
          meta.textContent = "error";
        });
    }

    if (copy) {
      copy.addEventListener("click", function () {
        if (!pre.textContent) return;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(pre.textContent);
        }
      });
    }
    if (search) {
      search.addEventListener("input", function () {
        paintList(search.value);
      });
    }
    function runSeek(token) {
      token = identOf(token);
      if (!token || !seekBox || !seekList) return;
      seekBox.hidden = false;
      seekTitle.textContent = "Seek “" + token + "”…";
      seekList.innerHTML = "";
      var hits = [];
      Promise.all(
        items.map(function (item) {
          return loadItem(item).then(function (text) {
            var lines = text.split(/\n/);
            for (var i = 0; i < lines.length; i++) {
              if (lines[i].indexOf(token) === -1) continue;
              hits.push({
                item: item,
                line: i + 1,
                preview: lines[i].trim().slice(0, 110),
              });
              if (hits.length >= 250) break;
            }
          });
        })
      ).then(function () {
        seekTitle.textContent =
          "Seek “" + token + "” — " + hits.length + " place" + (hits.length === 1 ? "" : "s") +
          " (this name is used here; those lines are what it affects)";
        seekList.innerHTML = "";
        if (!hits.length) {
          var li = document.createElement("li");
          li.textContent = "No uses in loaded " + kind + " files.";
          seekList.appendChild(li);
          return;
        }
        hits.forEach(function (hit) {
          var li = document.createElement("li");
          var btn = document.createElement("button");
          btn.type = "button";
          btn.textContent = hit.item.name + ":" + hit.line + "  " + hit.preview;
          btn.addEventListener("click", function () {
            openItem(hit.item, hit.line, token);
          });
          li.appendChild(btn);
          seekList.appendChild(li);
        });
      });
    }

    function showDefine(token, x, y) {
      var hit = defineCode(kind, (current && current.content) || pre.textContent || "", token);
      var card = document.getElementById("src-define-card");
      if (!card) {
        card = document.createElement("div");
        card.id = "src-define-card";
        card.className = "src-define-card";
        document.body.appendChild(card);
      }
      card.innerHTML = "<h4></h4><pre></pre><p class=\"src-define-hint\">Seek lists every file and line that uses this name.</p>";
      card.querySelector("h4").textContent = hit.term;
      card.querySelector("pre").textContent = hit.text;
      card.hidden = false;
      card.style.left = Math.min(x, window.innerWidth - 280) + "px";
      card.style.top = Math.min(y, window.innerHeight - 160) + "px";
    }

    var menu = document.getElementById("src-define-menu");
    if (!menu) {
      menu = document.createElement("div");
      menu.id = "src-define-menu";
      menu.className = "src-define-menu";
      menu.hidden = true;
      menu.innerHTML =
        '<button type="button" data-src-define>Define</button>' +
        '<button type="button" data-src-seek>Seek</button>' +
        '<button type="button" data-src-view>View</button>';
      document.body.appendChild(menu);
    }
    var pending = "";
    pre.addEventListener("contextmenu", function (e) {
      var token = selectedIn(pre);
      if (!token) return;
      e.preventDefault();
      pending = token;
      menu._ctx = { token: token, showDefine: showDefine, runSeek: runSeek, viewAffected: viewAffected };
      menu.hidden = false;
      menu.style.left = e.clientX + 10 + "px";
      menu.style.top = e.clientY + 10 + "px";
      menu.querySelector("[data-src-define]").textContent =
        "Define “" + (token.length > 24 ? token.slice(0, 22) + "…" : token) + "”";
      menu.querySelector("[data-src-seek]").textContent = "Seek “" + identOf(token) + "”";
      menu.querySelector("[data-src-view]").textContent = "View “" + identOf(token) + "”";
    });
    if (!menu.dataset.bound) {
      menu.dataset.bound = "1";
      menu.addEventListener("click", function (e) {
        var def = e.target && e.target.closest("[data-src-define]");
        var sk = e.target && e.target.closest("[data-src-seek]");
        var vw = e.target && e.target.closest("[data-src-view]");
        var rect = menu.getBoundingClientRect();
        var ctx = menu._ctx || {};
        menu.hidden = true;
        if (def && ctx.showDefine) ctx.showDefine(ctx.token, rect.left, rect.bottom + 6);
        if (sk && ctx.runSeek) ctx.runSeek(ctx.token);
        if (vw) viewAffected(ctx.token);
      });
      document.addEventListener("click", function (e) {
        var card = document.getElementById("src-define-card");
        if (menu.contains(e.target) || (card && card.contains(e.target))) return;
        menu.hidden = true;
        if (card && !String(window.getSelection() || "").trim()) card.hidden = true;
      });
    }
    if (seekBtn) {
      seekBtn.addEventListener("click", function () {
        var token = selectedIn(pre) || identOf(window.prompt("Seek which name?") || "");
        if (token) runSeek(token);
      });
    }

    collect();
    paintList("");
    if (items[0]) openItem(items[0]);
  }

  function boot() {
    bindPanel("js");
    bindPanel("css");
    bindPanel("html");
  }

  window.SourceTabs = {
    onShow: function (kind) {
      bindPanel(kind);
    },
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
