(function () {
  "use strict";

  var cache = {};

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

    function openItem(item) {
      current = item;
      paintList(search && search.value);
      title.textContent = item.name;
      pre.textContent = "Loading…";
      loadItem(item)
        .then(function (text) {
          pre.textContent = text;
          var lines = text.split(/\r?\n/).length;
          meta.textContent = lines + " lines · " + text.length + " chars";
        })
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
