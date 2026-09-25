(function () {
  "use strict";

  var PAGE = 48;
  var state = { filter: "ideas", items: [], shown: 0, loaded: {} };

  var IDEA_TILES = [
    { id: "invoice", title: "Invoice", url: "assets/api-logic/invoice.jpg", collection: "ideas" },
    { id: "vendor-meter", title: "Vendor meter", url: "assets/api-logic/vendor-meter.jpg", collection: "ideas" },
    { id: "api-key", title: "API key", url: "assets/api-logic/api-key.jpg", collection: "ideas" },
    { id: "on-device-fuse", title: "On-device fuse", url: "assets/api-logic/on-device-fuse.jpg", collection: "ideas" },
    { id: "unlimited", title: "Logan7in unlimited", url: "assets/api-logic/unlimited.jpg", collection: "ideas" },
    { id: "spell-chains", title: "Spell chains", url: "assets/api-logic/spell-chains.jpg", collection: "ideas" },
    { id: "cloud-calls", title: "Cloud calls", url: "assets/api-logic/cloud-calls.jpg", collection: "ideas" },
    { id: "wallets", title: "Wallets", url: "assets/api-logic/wallets.jpg", collection: "ideas" },
  ];

  function $(id) {
    return document.getElementById(id);
  }

  function isLocal() {
    var h = location.hostname;
    return h === "localhost" || h === "127.0.0.1" || /^192\.168\./.test(h) || /^10\./.test(h);
  }

  function resolveUrl(raw) {
    raw = String(raw || "");
    if (!raw) return "";
    if (typeof window.resolveGalleryUrl === "function") return window.resolveGalleryUrl(raw);
    if (!isLocal() && raw.indexOf("/generated/") === 0) {
      return "https://l7in-generated.netlify.app" + raw.slice("/generated".length);
    }
    return raw;
  }

  function setStatus(msg) {
    var el = $("as-status");
    if (el) el.textContent = msg || "";
  }

  function fetchJson(url) {
    return fetch(url, { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  function loadFilter(name) {
    if (state.loaded[name]) return Promise.resolve(state.loaded[name]);
    var work;
    if (name === "ideas") {
      work = Promise.resolve(IDEA_TILES.slice());
    } else if (name === "phone") {
      work = fetchJson("/api/transfer/list?box=phone-uploads&t=" + Date.now())
        .then(function (d) {
          return ((d && d.items) || []).map(function (it) {
            return {
              id: it.id || it.name,
              title: it.title || it.name || "Phone",
              url: it.url,
              collection: "phone",
            };
          });
        })
        .catch(function () {
          return [];
        });
    } else if (name === "objects") {
      work = fetchJson("data/objects-index.json")
        .then(function (d) {
          return ((d && d.objects) || []).map(function (it) {
            return {
              id: it.id,
              title: it.name || it.id,
              url: resolveUrl(it.preview_url || it.image_url),
              collection: "objects",
            };
          });
        })
        .catch(function () {
          return [];
        });
    } else if (name === "maps") {
      work = fetchJson("data/maps-catalog.json")
        .then(function (d) {
          var rows = (d && (d.maps || d.items || d)) || [];
          if (!Array.isArray(rows)) rows = [];
          return rows.map(function (it, i) {
            return {
              id: it.id || it.name || "map-" + i,
              title: it.name || it.title || "Map",
              url: resolveUrl(it.preview_url || it.image_url || it.url),
              collection: "maps",
            };
          });
        })
        .catch(function () {
          return [];
        });
    } else {
      work = fetchJson("data/lod1-manifest.json")
        .then(function (d) {
          return ((d && d.items) || []).map(function (it) {
            return {
              id: "p" + it.num,
              title: "#" + it.num,
              url: resolveUrl(it.url || "/generated/" + it.num + ".jpg"),
              collection: "paintings",
            };
          });
        })
        .catch(function () {
          return [];
        });
    }
    return work.then(function (items) {
      state.loaded[name] = items.filter(function (it) {
        return it && it.url;
      });
      return state.loaded[name];
    });
  }

  function paint() {
    var grid = $("as-grid");
    var more = $("as-more");
    if (!grid) return;
    var slice = state.items.slice(0, state.shown);
    grid.innerHTML = "";
    slice.forEach(function (it) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "as-tile";
      var img = document.createElement("img");
      img.src = it.url;
      img.alt = it.title || "";
      img.loading = "lazy";
      img.draggable = true;
      var cap = document.createElement("span");
      cap.textContent = it.title || it.id;
      btn.appendChild(img);
      btn.appendChild(cap);
      btn.addEventListener("click", function () {
        openLightbox(it);
      });
      grid.appendChild(btn);
    });
    if (more) more.hidden = state.shown >= state.items.length;
    setStatus(state.items.length ? state.shown + " / " + state.items.length : "Nothing in this shelf yet.");
  }

  function openLightbox(it) {
    var box = $("as-lightbox");
    var img = $("as-lightbox-img");
    var cap = $("as-lightbox-cap");
    if (!box || !img) return;
    img.src = it.url;
    img.alt = it.title || "";
    if (cap) cap.textContent = (it.title || "") + (it.collection ? " · " + it.collection : "");
    box.hidden = false;
  }

  function closeLightbox() {
    var box = $("as-lightbox");
    if (box) box.hidden = true;
  }

  function showFilter(name) {
    state.filter = name;
    document.querySelectorAll(".as-filter").forEach(function (btn) {
      btn.classList.toggle("active", btn.getAttribute("data-as-filter") === name);
    });
    setStatus("Loading…");
    loadFilter(name).then(function (items) {
      state.items = items;
      state.shown = Math.min(PAGE, items.length);
      paint();
    });
  }

  function boot() {
    if (!$("panel-assets")) return;
    document.querySelectorAll(".as-filter").forEach(function (btn) {
      btn.addEventListener("click", function () {
        showFilter(btn.getAttribute("data-as-filter"));
      });
    });
    var more = $("as-more");
    if (more) {
      more.addEventListener("click", function () {
        state.shown = Math.min(state.items.length, state.shown + PAGE);
        paint();
      });
    }
    var box = $("as-lightbox");
    if (box) {
      box.addEventListener("click", closeLightbox);
    }
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeLightbox();
    });
    window.addEventListener("tab-changed", function (e) {
      if (e.detail && e.detail.tab === "assets") showFilter(state.filter || "ideas");
    });
    window.addEventListener("assets-show", function () {
      showFilter(state.filter || "ideas");
    });
  }

  window.AssetsTab = { onShow: function () { showFilter(state.filter || "ideas"); } };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
