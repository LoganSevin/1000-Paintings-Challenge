/**
 * Citations tab — inventory of studio tools and external services.
 * Art author remains Logan Sevin (see author-config.js).
 */
(function () {
  "use strict";

  function $(id) {
    return document.getElementById(id);
  }

  function apiUrl(path) {
    if (typeof window.galleryApiUrl === "function") return window.galleryApiUrl(path);
    var base = String(window.SPELLFORGE_API_BASE || "").replace(/\/$/, "");
    var p = path.startsWith("/") ? path : "/" + path;
    return base ? base + p : p;
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function linkOrText(item) {
    var name = escapeHtml(item.name);
    if (item.url) {
      return (
        '<a class="cite-link" href="' +
        escapeHtml(item.url) +
        '" target="_blank" rel="noopener noreferrer">' +
        name +
        "</a>"
      );
    }
    return "<strong>" + name + "</strong>";
  }

  function badge(item) {
    var bits = [];
    if (item.kind) bits.push(item.kind);
    if (item.uses_api === true) bits.push("uses API");
    if (item.uses_api === false) bits.push("local UI");
    if (item.version_note) bits.push(item.version_note);
    if (!bits.length) return "";
    return (
      '<span class="cite-badges">' +
      bits
        .map(function (b) {
          return '<span class="cite-badge">' + escapeHtml(b) + "</span>";
        })
        .join("") +
      "</span>"
    );
  }

  function renderData(data) {
    var root = $("citations-root");
    if (!root || !data) return;

    var artist =
      (data.artist ||
        (window.GALLERY_AUTHOR && window.GALLERY_AUTHOR.author) ||
        "Logan Sevin");

    var html = "";
    html += '<header class="cite-hero">';
    html += "<h2>Citations &amp; studio inventory</h2>";
    html +=
      '<p class="cite-lead">Track every <strong>studio tool</strong> in this app and every <strong>external service</strong> it can call. ' +
      "Art authorship stays with <strong>" +
      escapeHtml(artist) +
      "</strong> — tools assist; they are not the author.</p>";
    if (data.updated) {
      html += '<p class="cite-updated">Inventory updated: ' + escapeHtml(data.updated) + "</p>";
    }
    html +=
      '<p class="cite-filter-row"><label class="cite-filter"><input type="search" id="cite-filter" placeholder="Filter tools…" autocomplete="off" /></label></p>';
    html += "</header>";

    var cats = data.categories || [];
    cats.forEach(function (cat) {
      html += '<section class="cite-category" data-cat="' + escapeHtml(cat.id || "") + '">';
      html += "<h3>" + escapeHtml(cat.title || cat.id) + "</h3>";
      if (cat.description) {
        html += '<p class="cite-cat-desc">' + escapeHtml(cat.description) + "</p>";
      }
      html += '<ul class="cite-list">';
      (cat.items || []).forEach(function (item) {
        var searchBlob = [
          item.name,
          item.role,
          item.kind,
          item.url,
          cat.title,
        ]
          .join(" ")
          .toLowerCase();
        html +=
          '<li class="cite-item" data-search="' +
          escapeHtml(searchBlob) +
          '">' +
          '<div class="cite-item-head">' +
          linkOrText(item) +
          badge(item) +
          "</div>";
        if (item.role) {
          html += '<p class="cite-role">' + escapeHtml(item.role) + "</p>";
        }
        if (item.billing) {
          html +=
            '<p class="cite-meta">Billing: <a href="' +
            escapeHtml(item.billing) +
            '" target="_blank" rel="noopener noreferrer">' +
            escapeHtml(item.billing) +
            "</a></p>";
        }
        if (item.example) {
          html +=
            '<p class="cite-meta">Example: <a href="' +
            escapeHtml(item.example) +
            '" target="_blank" rel="noopener noreferrer">' +
            escapeHtml(item.example) +
            "</a></p>";
        }
        html += "</li>";
      });
      html += "</ul></section>";
    });

    // Live runtime snapshot
    html += '<section class="cite-category cite-runtime">';
    html += "<h3>Runtime snapshot (this browser)</h3>";
    html += '<ul class="cite-list" id="cite-runtime-list"></ul>';
    html += "</section>";

    root.innerHTML = html;

    var filter = $("cite-filter");
    if (filter) {
      filter.addEventListener("input", function () {
        var q = String(filter.value || "")
          .trim()
          .toLowerCase();
        root.querySelectorAll(".cite-item").forEach(function (li) {
          var hay = li.getAttribute("data-search") || "";
          li.hidden = !!(q && hay.indexOf(q) < 0);
        });
        root.querySelectorAll(".cite-category").forEach(function (sec) {
          if (sec.classList.contains("cite-runtime")) return;
          var any = false;
          sec.querySelectorAll(".cite-item").forEach(function (li) {
            if (!li.hidden) any = true;
          });
          sec.hidden = !any;
        });
      });
    }

    fillRuntime();
  }

  function fillRuntime() {
    var ul = $("cite-runtime-list");
    if (!ul) return;
    var loc = window.location;
    var apiBase = String(window.SPELLFORGE_API_BASE || "").replace(/\/$/, "") || "(same origin)";
    var rows = [
      ["Page origin", loc.origin || loc.protocol + "//" + loc.host],
      ["API base", apiBase],
      ["Protocol", loc.protocol],
      ["User agent", navigator.userAgent || "—"],
      [
        "Author config",
        (window.GALLERY_AUTHOR && window.GALLERY_AUTHOR.author) || "Logan Sevin",
      ],
    ];
    ul.innerHTML = rows
      .map(function (r) {
        return (
          '<li class="cite-item"><div class="cite-item-head"><strong>' +
          escapeHtml(r[0]) +
          '</strong></div><p class="cite-role cite-mono">' +
          escapeHtml(r[1]) +
          "</p></li>"
        );
      })
      .join("");

    // Optional health probe
    fetch(apiUrl("/api/health"), { cache: "no-store" })
      .then(function (r) {
        return r.json().then(function (d) {
          return { ok: r.ok, d: d };
        });
      })
      .then(function (res) {
        var li = document.createElement("li");
        li.className = "cite-item";
        var ver =
          res.d && (res.d.api_version != null ? res.d.api_version : res.d.version);
        li.innerHTML =
          '<div class="cite-item-head"><strong>/api/health</strong>' +
          (res.ok
            ? '<span class="cite-badges"><span class="cite-badge cite-ok">online</span></span>'
            : '<span class="cite-badges"><span class="cite-badge cite-err">offline</span></span>') +
          "</div>" +
          '<p class="cite-role cite-mono">' +
          escapeHtml(
            res.ok
              ? "API reachable" + (ver != null ? " · version " + ver : "")
              : "No API (static host or server down)"
          ) +
          "</p>";
        ul.appendChild(li);
      })
      .catch(function () {
        var li = document.createElement("li");
        li.className = "cite-item";
        li.innerHTML =
          '<div class="cite-item-head"><strong>/api/health</strong>' +
          '<span class="cite-badges"><span class="cite-badge cite-err">unreachable</span></span></div>' +
          '<p class="cite-role">Server not running or static-only host — generation tools will not work until API is up.</p>';
        ul.appendChild(li);
      });
  }

  function load() {
    var root = $("citations-root");
    if (!root) return;
    root.innerHTML = '<p class="cite-loading">Loading inventory…</p>';
    var urls = [
      "data/studio-citations.json?t=" + Date.now(),
      apiUrl("/data/studio-citations.json?t=" + Date.now()),
    ];
    function tryFetch(i) {
      if (i >= urls.length) {
        root.innerHTML =
          '<p class="cite-err">Could not load <code>data/studio-citations.json</code>. Keep the file next to the gallery and hard-refresh.</p>';
        return;
      }
      fetch(urls[i], { cache: "no-store" })
        .then(function (r) {
          if (!r.ok) throw new Error("bad status");
          return r.json();
        })
        .then(renderData)
        .catch(function () {
          tryFetch(i + 1);
        });
    }
    tryFetch(0);
  }

  window.addEventListener("tab-changed", function (e) {
    if (e.detail && e.detail.tab === "citations") load();
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      if (location.hash.replace("#", "") === "citations") load();
    });
  } else if (location.hash.replace("#", "") === "citations") {
    load();
  }

  window.Citations = { reload: load };
})();
