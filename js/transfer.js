/**
 * Transfer — gallery-style browse + bulk download for phone,
 * and a separate Upload tab for phone → phone-uploads/.
 */
(function () {
  "use strict";

  var BOX_FROM_PHONE = "phone-uploads";
  var state = {
    subtab: "browse",
    collection: "paintings",
    items: [],
    selected: {},
    bestLan: "",
    lanUrls: [],
    userPickedLan: false,
    visible: 0,
  };
  var pollTimer = 0;
  var catalogCache = {};
  var PAGE = 24;

  function $(id) {
    return document.getElementById(id);
  }

  function apiUrl(path) {
    if (typeof window.galleryApiUrl === "function") return window.galleryApiUrl(path);
    var base = String(window.SPELLFORGE_API_BASE || "").replace(/\/$/, "");
    return base ? base + path : path;
  }

  var IS_LOCAL =
    location.hostname === "localhost" ||
    location.hostname === "127.0.0.1" ||
    /^192\.168\.|^10\.|^172\.(1[6-9]|2\d|3[0-1])\./.test(location.hostname);
  var PUBLIC_GENERATED_ORIGIN = IS_LOCAL ? "" : "https://l7in-generated.netlify.app";
  var PC_ONLY =
    "Could not reach phone uploads. Refresh logan7in.art and try again.";
  var PC_ONLY_TRAY =
    "Phone tray zip/stage still needs the gallery running on your PC";
  var PC_ONLY_VIDEOS =
    "Saved videos work when the gallery is running on your PC";
  var PC_ONLY_GENERIC =
    "This Transfer action needs the gallery running on your PC (start_server.bat)";

  function isHtmlContentType(ct) {
    return /text\/html/i.test(String(ct || ""));
  }

  /** Parse JSON only when the response looks like JSON — never throw on SPA HTML. */
  function fetchJson(url, opts) {
    return fetch(url, opts).then(function (r) {
      var ct = r.headers.get("content-type") || "";
      if (!r.ok || isHtmlContentType(ct)) {
        var err = new Error(
          isHtmlContentType(ct) || r.status === 404 ? "pc-only" : "Request failed (" + r.status + ")"
        );
        err.status = r.status;
        err.pcOnly = isHtmlContentType(ct) || r.status === 404;
        throw err;
      }
      return r.text().then(function (raw) {
        var t = String(raw || "").trim();
        if (!t || t.charAt(0) === "<") {
          var e2 = new Error("pc-only");
          e2.pcOnly = true;
          e2.status = r.status;
          throw e2;
        }
        try {
          return { res: r, data: JSON.parse(t) };
        } catch (parseErr) {
          var e3 = new Error("pc-only");
          e3.pcOnly = true;
          e3.status = r.status;
          throw e3;
        }
      });
    });
  }

  function resolveMediaUrl(url) {
    var raw = String(url || "").trim();
    if (!raw) return "";
    if (/^https?:\/\//i.test(raw)) return raw;
    if (raw.startsWith("/generated/") && PUBLIC_GENERATED_ORIGIN) {
      return PUBLIC_GENERATED_ORIGIN + raw.slice("/generated".length);
    }
    return raw;
  }

  function pcOnlyMessageForCollection(coll) {
    coll = String(coll || "").toLowerCase();
    if (coll === "to-phone" || coll === "transfer-to-phone") return PC_ONLY_TRAY;
    if (coll === "phone-uploads") return PC_ONLY;
    if (coll === "videos" || coll === "saved-videos") return PC_ONLY_VIDEOS;
    return PC_ONLY_GENERIC;
  }

  function setStatus(msg, kind) {
    var el = $("tf-status");
    if (!el) return;
    el.textContent = msg || "";
    el.className = "tf-status" + (kind === "ok" ? " ok" : kind === "err" ? " err" : "");
  }

  function setUploadStatus(msg, kind) {
    var el = $("tf-upload-status");
    if (el) {
      el.textContent = msg || "";
      el.className = "tf-upload-status" + (kind === "err" ? " error" : "");
    }
    setStatus(msg, kind === "err" ? "err" : kind === "ok" ? "ok" : "");
  }

  function escapeHtml(s) {
    var d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  }

  function isVideoUrl(url) {
    return /\.(mp4|webm|mov|m4v)(\?|$)/i.test(url || "");
  }

  function isPhoneViewport() {
    try {
      return window.matchMedia && window.matchMedia("(max-width: 720px)").matches;
    } catch (e) {
      return false;
    }
  }

  function hostScore(host) {
    host = String(host || "");
    if (/^(localhost|127\.|::1)/i.test(host)) return -1000;
    if (/^192\.168\.56\./.test(host) || /^192\.168\.57\./.test(host)) return -80;
    if (/^192\.168\.(0|1)\./.test(host)) return 100;
    if (/^192\.168\./.test(host)) return 80;
    if (/^10\.(0|1)\./.test(host)) return 55;
    if (/^10\./.test(host)) return 10;
    return 5;
  }

  /** Prefer real home Wi‑Fi over VirtualBox / VPN adapters. */
  function pickBestLan(urls) {
    urls = urls || [];
    var best = "";
    var bestS = -9999;
    urls.forEach(function (u) {
      try {
        var host = new URL(u).hostname;
        var s = hostScore(host);
        if (s > bestS) {
          bestS = s;
          best = u;
        }
      } catch (e) {}
    });
    // If page already opened via a good host, trust that first
    try {
      var cur = window.location.hostname;
      if (cur && hostScore(cur) >= 80) {
        return window.location.origin;
      }
    } catch (e) {}
    return best || (urls[0] || window.location.origin);
  }

  function portalFullUrl() {
    var base = (state.bestLan || window.location.origin).replace(/\/$/, "");
    return base + "/#transfer";
  }

  function updatePortalUi(info) {
    var urls = (info && info.lanUrls) || state.lanUrls || [];
    if (urls.length) state.lanUrls = urls.slice();

    if (!state.userPickedLan) {
      if (info && info.bestLanUrl) state.bestLan = info.bestLanUrl;
      else state.bestLan = pickBestLan(urls);
    }

    var full = portalFullUrl();
    var urlEl = $("tf-portal-url");
    var qr = $("tf-portal-qr");
    var select = $("tf-lan-select");
    var portal = document.querySelector(".tf-portal");

    // On phone (already LAN), collapse the QR block — show gallery first
    if (portal) {
      var onGoodLan = hostScore(window.location.hostname) >= 80;
      portal.classList.toggle("tf-portal-compact", onGoodLan || isPhoneViewport());
    }

    if (urlEl) {
      urlEl.textContent = full;
      urlEl.href = full;
    }
    if (select) {
      var opts = (urls.length ? urls : [window.location.origin]).slice();
      opts.sort(function (a, b) {
        try {
          return hostScore(new URL(b).hostname) - hostScore(new URL(a).hostname);
        } catch (e) {
          return 0;
        }
      });
      var seen = {};
      opts = opts.filter(function (u) {
        var k = String(u).replace(/\/$/, "");
        if (seen[k]) return false;
        seen[k] = true;
        return true;
      });
      var curBest = (state.bestLan || "").replace(/\/$/, "");
      select.innerHTML = opts
        .map(function (u) {
          var label = u.replace(/^https?:\/\//, "");
          var sel = u.replace(/\/$/, "") === curBest ? " selected" : "";
          var note = "";
          try {
            var h = new URL(u).hostname;
            if (hostScore(h) >= 100) note = " ← home Wi‑Fi";
            else if (hostScore(h) < 0) note = " (skip — VirtualBox)";
            else if (hostScore(h) <= 10) note = " (VPN)";
          } catch (e) {}
          return (
            '<option value="' +
            escapeHtml(u) +
            '"' +
            sel +
            ">" +
            escapeHtml(label + note) +
            "</option>"
          );
        })
        .join("");
    }
    if (qr) {
      if (isPhoneViewport()) {
        qr.removeAttribute("src");
        qr.hidden = true;
      } else {
        qr.hidden = false;
        qr.src =
          "https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=10&data=" +
          encodeURIComponent(full);
        qr.alt = "QR: " + full;
      }
    }
  }

  function setSubtab(name) {
    state.subtab = name;
    document.querySelectorAll(".tf-subtab").forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-tf-sub") === name);
    });
    document.querySelectorAll(".tf-pane").forEach(function (p) {
      p.hidden = p.getAttribute("data-tf-pane") !== name;
    });
    if (name === "browse") loadCatalog();
    if (name === "upload") refreshUploadList();
  }

  function selectedCount() {
    return Object.keys(state.selected).length;
  }

  function updateSelectBar() {
    var n = selectedCount();
    var el = $("tf-sel-count");
    if (el) el.textContent = String(n);
    var dl = $("tf-download-sel");
    var st = $("tf-stage-sel");
    if (dl) dl.disabled = n < 1;
    if (st) st.disabled = n < 1;
  }

  function pageSize() {
    return isPhoneViewport() ? 24 : 48;
  }

  function thumbUrl(it) {
    var src = it && it.url ? String(it.url) : "";
    var url = resolveMediaUrl(src);
    if (!url || isVideoUrl(url) || (it && it.kind === "video")) return url;
    // Thumb resize API is PC-only; on Netlify use the real image URL.
    if (!IS_LOCAL) return url;
    var w = isPhoneViewport() ? 180 : 240;
    return apiUrl("/api/transfer/thumb?src=" + encodeURIComponent(src) + "&w=" + w);
  }

  function applyCatalogItems(items, statusNote) {
    state.items = items || [];
    catalogCache[state.collection || "paintings"] = state.items;
    state.visible = Math.min(pageSize(), state.items.length);
    renderGalleryGrid();
    setStatus(
      statusNote ||
        (state.items.length || 0) + " items · tap to select · Download zip",
      "ok"
    );
  }

  /** Static indexes shipped with the Netlify site (paintings + generated). */
  function loadStaticCatalog(coll) {
    coll = String(coll || "").toLowerCase();
    var lim = isPhoneViewport() ? 72 : 400;
    if (coll === "paintings" || coll === "painting" || coll === "main") {
      return Promise.all([
        fetchJson("data/manifest.json", { cache: "default" }),
        fetchJson("data/analyses.json", { cache: "default" }).catch(function () {
          return { data: {} };
        }),
      ]).then(function (pair) {
        var man = pair[0].data;
        var analyses = pair[1].data || {};
        var list = Array.isArray(man) ? man : [];
        return list.slice(0, lim || 600).map(function (row) {
          var n = row.number != null ? row.number : row.num;
          var name = row.filename || n + ".jpg";
          var a = analyses[String(n)] || {};
          return {
            id: "paintings/" + n,
            title: a.title || "#" + n,
            url: "/paintings/" + name,
            collection: "paintings",
            name: name,
            kind: "image",
          };
        });
      });
    }
    if (coll === "generated" || coll === "lod1") {
      return fetchJson("data/lod1-manifest.json", { cache: "default" }).then(function (pack) {
        var d = pack.data || {};
        var items = Array.isArray(d.items) ? d.items : [];
        return items.slice(0, lim || 400).map(function (it) {
          var name = it.name || (it.num != null ? it.num + ".jpg" : "");
          var url = it.url || (name ? "/generated/" + name : "");
          return {
            id: String(it.num != null ? it.num : url),
            title: it.num != null ? "#" + it.num : name || url,
            url: url,
            collection: "generated",
            name: name,
            kind: "image",
          };
        });
      });
    }
    return Promise.resolve(null);
  }

  function loadCatalog() {
    var coll = state.collection || "paintings";
    var grid = $("tf-gallery-grid");
    if (!grid) return Promise.resolve();
    if (catalogCache[coll]) {
      state.items = catalogCache[coll];
      if (!state.visible) state.visible = Math.min(pageSize(), state.items.length);
      else
        state.visible =
          Math.min(state.visible, state.items.length) ||
          Math.min(pageSize(), state.items.length);
      renderGalleryGrid();
      setStatus((state.items.length || 0) + " items · tap to select · Download zip", "ok");
      return Promise.resolve();
    }
    grid.innerHTML = '<p class="tf-empty">Loading…</p>';
    setStatus("Loading " + coll + "…", "");
    var lim = isPhoneViewport() ? 72 : 400;

    function showPcOnly() {
      var msg = pcOnlyMessageForCollection(coll);
      state.items = [];
      state.visible = 0;
      grid.innerHTML = '<p class="tf-empty">' + escapeHtml(msg) + "</p>";
      setStatus(msg, "err");
      var more = $("tf-load-more");
      if (more) more.hidden = true;
      updateSelectBar();
    }

    function tryStatic() {
      return loadStaticCatalog(coll)
        .then(function (items) {
          if (items && items.length) {
            applyCatalogItems(
              items,
              items.length + " items · browse on this site (zip / phone tray need your PC)"
            );
            return;
          }
          showPcOnly();
        })
        .catch(function () {
          showPcOnly();
        });
    }

    return fetchJson(
      apiUrl(
        "/api/transfer/catalog?collection=" +
          encodeURIComponent(coll) +
          "&limit=" +
          lim
      ),
      { cache: "default" }
    )
      .then(function (pack) {
        var d = pack.data;
        if (!d || !d.ok) throw new Error((d && d.error) || "Catalog failed");
        applyCatalogItems(d.items || []);
      })
      .catch(function (err) {
        if (err && err.pcOnly) return tryStatic();
        // Unexpected API error — still try static for paintings/generated
        return tryStatic();
      });
  }

  function renderGalleryGrid() {
    var grid = $("tf-gallery-grid");
    if (!grid) return;
    var more = $("tf-load-more");
    if (!state.items.length) {
      grid.innerHTML = '<p class="tf-empty">Nothing in this collection yet.</p>';
      if (more) more.hidden = true;
      updateSelectBar();
      return;
    }
    var vis = state.visible || pageSize();
    if (vis < 1) vis = pageSize();
    state.visible = Math.min(vis, state.items.length);
    grid.innerHTML = state.items
      .slice(0, state.visible)
      .map(function (it, idx) {
        var id = String(it.id || it.url || idx);
        var url = it.url || "";
        var sel = !!state.selected[id];
        var media =
          isVideoUrl(url) || it.kind === "video"
            ? '<span class="tf-vid-ph">▶</span>'
            : '<img src="' +
              escapeHtml(thumbUrl(it)) +
              '" alt="" loading="lazy" decoding="async" width="240" height="240" />';
        return (
          '<button type="button" class="tf-gitem' +
          (sel ? " selected" : "") +
          '" data-id="' +
          escapeHtml(id) +
          '" data-url="' +
          escapeHtml(url) +
          '" data-name="' +
          escapeHtml(it.name || it.title || "") +
          '" aria-pressed="' +
          (sel ? "true" : "false") +
          '">' +
          media +
          '<span class="tf-gcheck" aria-hidden="true">' +
          (sel ? "✓" : "") +
          "</span>" +
          '<span class="tf-gtitle">' +
          escapeHtml(it.title || it.name || "") +
          "</span>" +
          "</button>"
        );
      })
      .join("");
    if (more) {
      more.hidden = state.visible >= state.items.length;
      more.textContent =
        "Load more (" + state.visible + " / " + state.items.length + ")";
    }
    updateSelectBar();
  }

  function toggleSelect(id, url, name) {
    if (state.selected[id]) delete state.selected[id];
    else state.selected[id] = { url: url, name: name };
    // Update one tile without full re-render for snappier mobile
    var btn = null;
    document.querySelectorAll(".tf-gitem").forEach(function (el) {
      if (el.getAttribute("data-id") === id) btn = el;
    });
    if (btn) {
      var on = !!state.selected[id];
      btn.classList.toggle("selected", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      var ck = btn.querySelector(".tf-gcheck");
      if (ck) ck.textContent = on ? "✓" : "";
    } else {
      renderGalleryGrid();
    }
    updateSelectBar();
  }

  function selectAll(on) {
    state.selected = {};
    if (on) {
      state.items.forEach(function (it, idx) {
        var id = String(it.id || it.url || idx);
        state.selected[id] = { url: it.url, name: it.name || it.title };
      });
    }
    renderGalleryGrid();
  }

  function selectedUrls() {
    return Object.keys(state.selected).map(function (k) {
      return state.selected[k].url;
    });
  }

  function downloadSelectedZip() {
    var urls = selectedUrls().filter(Boolean);
    if (!urls.length) {
      setStatus("Select one or more images first.", "err");
      return;
    }
    setStatus("Building zip of " + urls.length + " file(s)…", "");
    fetch(apiUrl("/api/transfer/zip"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urls: urls }),
    })
      .then(function (r) {
        var ct = r.headers.get("content-type") || "";
        if (!r.ok || isHtmlContentType(ct)) {
          var err = new Error("pc-only");
          err.pcOnly = true;
          throw err;
        }
        if (/application\/json/i.test(ct)) {
          return r.json().then(function (d) {
            throw new Error((d && d.error) || "Zip failed (" + r.status + ")");
          });
        }
        return r.blob();
      })
      .then(function (blob) {
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "gallery-transfer.zip";
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () {
          URL.revokeObjectURL(a.href);
        }, 2000);
        setStatus("Download started (" + urls.length + " files).", "ok");
      })
      .catch(function (err) {
        var note =
          err && err.pcOnly
            ? "Zip needs the PC gallery server — opening selected files one by one…"
            : (err && err.message) || "Zip failed — opening files one by one…";
        setStatus(note, "err");
        urls.slice(0, 12).forEach(function (u, i) {
          setTimeout(function () {
            var a = document.createElement("a");
            a.href = resolveMediaUrl(u);
            a.download = "";
            a.target = "_blank";
            a.rel = "noopener";
            document.body.appendChild(a);
            a.click();
            a.remove();
          }, i * 350);
        });
      });
  }

  function stageSelectedToPhone() {
    var urls = selectedUrls().filter(Boolean);
    if (!urls.length) {
      setStatus("Select images to put in the phone tray.", "err");
      return;
    }
    setStatus("Staging " + urls.length + " for phone tray…", "");
    var chain = Promise.resolve();
    var ok = 0;
    urls.forEach(function (url) {
      chain = chain.then(function () {
        return fetchJson(apiUrl("/api/transfer/stage"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: url, box: "to-phone" }),
        }).then(function (pack) {
          var d = pack.data;
          if (!d || d.ok === false) throw new Error((d && d.error) || "Stage failed");
          ok++;
        });
      });
    });
    chain
      .then(function () {
        setStatus("Staged " + ok + " file(s) into transfer-to-phone/.", "ok");
        if (state.collection === "to-phone") loadCatalog();
      })
      .catch(function (err) {
        setStatus(
          err && err.pcOnly ? PC_ONLY_TRAY : (err && err.message) || "Stage failed",
          "err"
        );
      });
  }

  function readFileAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve(reader.result);
      };
      reader.onerror = function () {
        reject(new Error("Could not read " + (file.name || "file")));
      };
      reader.readAsDataURL(file);
    });
  }

  function prepareImageForUpload(file) {
    var fallbackName = file.name || "photo-" + Date.now() + ".jpg";
    return readFileAsDataUrl(file).then(function (dataUrl) {
      return new Promise(function (resolve) {
        var img = new Image();
        img.onload = function () {
          var max = 1600;
          var w = img.naturalWidth || img.width || 1;
          var h = img.naturalHeight || img.height || 1;
          var scale = Math.min(1, max / Math.max(w, h));
          var canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(w * scale));
          canvas.height = Math.max(1, Math.round(h * scale));
          var ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          var out = canvas.toDataURL("image/jpeg", 0.84);
          var stem = String(fallbackName).replace(/\.[^.]+$/, "") || "photo";
          resolve({ name: stem + ".jpg", dataUrl: out });
        };
        img.onerror = function () {
          resolve({ name: fallbackName, dataUrl: dataUrl });
        };
        img.src = dataUrl;
      });
    });
  }

  /** Base64 JSON first — far more reliable on iOS Safari than multipart. */
  function uploadOneFile(file) {
    return prepareImageForUpload(file)
      .then(function (prepared) {
        return fetchJson(apiUrl("/api/transfer/upload"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            box: BOX_FROM_PHONE,
            name: prepared.name,
            image_base64: prepared.dataUrl,
          }),
        }).then(function (pack) {
          var d = pack.data;
          if (!d || d.ok === false) throw new Error((d && d.error) || "Upload failed");
          return d;
        });
      })
      .catch(function (err) {
        if (err && err.pcOnly) throw err;
        // Fallback multipart (still PC-only on Netlify)
        var fd = new FormData();
        fd.append("file", file, file.name || "photo.jpg");
        fd.append("box", BOX_FROM_PHONE);
        return fetchJson(apiUrl("/api/transfer/upload"), { method: "POST", body: fd }).then(
          function (pack) {
            var d = pack.data;
            if (!d || d.ok === false) {
              throw new Error((d && d.error) || (err && err.message) || "Upload failed");
            }
            return d;
          }
        );
      });
  }

  function uploadFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return Promise.resolve();
    setUploadStatus("Uploading 0 / " + files.length + "…", "");
    var ok = 0;
    var chain = Promise.resolve();
    files.forEach(function (file, i) {
      chain = chain.then(function () {
        setUploadStatus("Uploading " + (i + 1) + " / " + files.length + "…", "");
        return uploadOneFile(file).then(function () {
          ok++;
        });
      });
    });
    return chain
      .then(function () {
        setUploadStatus(
          "Uploaded " +
            ok +
            " photo(s). They are in Phone uploads and ready for Gallery, Spellforge, and other tabs.",
          "ok"
        );
        return refreshUploadList();
      })
      .catch(function (err) {
        setUploadStatus(
          err && err.pcOnly
            ? PC_ONLY
            : (err && err.message) || "Upload failed",
          "err"
        );
        return refreshUploadList();
      });
  }

  function analysisBadge(it) {
    var st = (it && it.analysisStatus) || "none";
    if (st === "analyzing") return '<span class="tf-abdg analyzing">describing…</span>';
    if (st === "ready") return '<span class="tf-abdg ready">prompt ready</span>';
    if (st === "failed") return '<span class="tf-abdg failed">describe failed</span>';
    if (st === "skipped-video") return '<span class="tf-abdg">video</span>';
    return "";
  }

  function refreshUploadList() {
    var grid = $("tf-upload-grid");
    if (!grid) return Promise.resolve();
    return fetchJson(apiUrl("/api/transfer/list?box=" + BOX_FROM_PHONE + "&t=" + Date.now()), {
      cache: "no-store",
    })
      .then(function (pack) {
        var d = pack.data;
        var items = (d && d.items) || [];
        var c = $("tf-upload-count");
        if (c) c.textContent = String(items.length);
        if (!items.length) {
          grid.innerHTML =
            '<p class="tf-empty">No phone uploads yet. Use Choose / take photos above.</p>';
          return;
        }
        var analyzing = items.filter(function (it) {
          return it.analysisStatus === "analyzing";
        }).length;
        var ready = items.filter(function (it) {
          return it.analysisStatus === "ready";
        }).length;
        if (analyzing) {
          setUploadStatus(
            "Describing " + analyzing + " image(s) for prompt weights… (" + ready + " ready)",
            ""
          );
        } else if (ready) {
          setUploadStatus(ready + " upload(s) have description + prompt weights.", "ok");
        }
        grid.innerHTML = items
          .map(function (it) {
            var url = it.url || "";
            var a = it.analysis || {};
            var title = a.title || it.title || it.name || "";
            var desc = a.description || it.description || "";
            var prompt = a.prompt || it.prompt || "";
            var media = isVideoUrl(url)
              ? '<span class="tf-vid-ph">▶</span>'
              : '<img src="' +
                escapeHtml(thumbUrl(it)) +
                '" alt="" loading="lazy" decoding="async" width="240" height="240" />';
            var genNum = it.generatedNum || (a && a.generated_num) || null;
            var genUrl = it.generatedUrl || (a && a.generated_url) || "";
            var mixLine = genNum
              ? '<p class="tf-amix">In generator mix as <a href="' +
                escapeHtml(genUrl || "/generated/" + genNum + ".jpg") +
                '" target="_blank" rel="noopener">Generated #' +
                escapeHtml(String(genNum)) +
                "</a> · Gallery → Generated / Phone</p>"
              : it.inGeneratorMix
                ? '<p class="tf-amix">In generator mix (Generated)</p>'
                : "";
            return (
              '<div class="tf-upload-card">' +
              '<div class="tf-gitem static">' +
              media +
              analysisBadge(it) +
              '<span class="tf-gtitle">' +
              escapeHtml(title) +
              "</span>" +
              '<a class="tf-open" href="' +
              escapeHtml(url) +
              '" target="_blank" rel="noopener">Open</a>' +
              "</div>" +
              mixLine +
              (desc || prompt
                ? '<div class="tf-analysis-meta">' +
                  (desc
                    ? '<p class="tf-adesc">' + escapeHtml(desc) + "</p>"
                    : "") +
                  (prompt
                    ? '<p class="tf-aprompt"><strong>Prompt weight:</strong> ' +
                      escapeHtml(prompt) +
                      "</p>"
                    : "") +
                  "</div>"
                : it.analysisStatus === "analyzing"
                  ? '<p class="tf-muted">AI is writing description + prompt…</p>'
                  : "") +
              "</div>"
            );
          })
          .join("");
      })
      .catch(function (err) {
        if (grid)
          grid.innerHTML =
            '<p class="tf-empty">' +
            escapeHtml(err && err.pcOnly ? PC_ONLY : (err && err.message) || "List failed") +
            "</p>";
        if (err && err.pcOnly) setUploadStatus(PC_ONLY, "err");
      });
  }

  function loadStatus() {
    return fetchJson(apiUrl("/api/transfer/status") + "?t=" + Date.now(), { cache: "no-store" })
      .then(function (pack) {
        var d = pack.data;
        if (!d || !d.ok) throw new Error((d && d.error) || "offline");
        updatePortalUi(d);
        return d;
      })
      .catch(function () {
        updatePortalUi({ lanUrls: state.lanUrls.length ? state.lanUrls : [window.location.origin] });
      });
  }

  function preferLan(url) {
    return fetchJson(apiUrl("/api/transfer/prefer-lan"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: url }),
    })
      .then(function (pack) {
        return pack.data;
      })
      .catch(function () {
        return null;
      });
  }

  function bind() {
    if (!$("panel-transfer")) return;

    document.querySelectorAll(".tf-subtab").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setSubtab(btn.getAttribute("data-tf-sub") || "browse");
      });
    });

    document.querySelectorAll(".tf-coll").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.collection = btn.getAttribute("data-coll") || "paintings";
        state.selected = {};
        state.visible = 0;
        document.querySelectorAll(".tf-coll").forEach(function (b) {
          b.classList.toggle("active", b === btn);
        });
        loadCatalog();
      });
    });

    $("tf-gallery-grid") &&
      $("tf-gallery-grid").addEventListener("click", function (e) {
        var item = e.target && e.target.closest ? e.target.closest(".tf-gitem") : null;
        if (!item || item.classList.contains("static")) return;
        toggleSelect(item.getAttribute("data-id"), item.getAttribute("data-url"), item.getAttribute("data-name"));
      });

    $("tf-select-all") &&
      $("tf-select-all").addEventListener("click", function () {
        selectAll(true);
      });
    $("tf-select-none") &&
      $("tf-select-none").addEventListener("click", function () {
        selectAll(false);
      });
    $("tf-download-sel") &&
      $("tf-download-sel").addEventListener("click", downloadSelectedZip);
    $("tf-stage-sel") &&
      $("tf-stage-sel").addEventListener("click", stageSelectedToPhone);

    $("tf-upload-btn") &&
      $("tf-upload-btn").addEventListener("click", function () {
        var inp = $("tf-upload-input");
        if (inp) inp.click();
      });
    $("tf-upload-input") &&
      $("tf-upload-input").addEventListener("change", function () {
        uploadFiles($("tf-upload-input").files).then(function () {
          $("tf-upload-input").value = "";
        });
      });

    var drop = $("tf-upload-drop");
    if (drop) {
      ["dragenter", "dragover"].forEach(function (ev) {
        drop.addEventListener(ev, function (e) {
          e.preventDefault();
          drop.classList.add("drag");
        });
      });
      ["dragleave", "drop"].forEach(function (ev) {
        drop.addEventListener(ev, function (e) {
          e.preventDefault();
          drop.classList.remove("drag");
        });
      });
      drop.addEventListener("drop", function (e) {
        if (e.dataTransfer && e.dataTransfer.files) uploadFiles(e.dataTransfer.files);
      });
    }

    $("tf-copy-url") &&
      $("tf-copy-url").addEventListener("click", function () {
        var u = portalFullUrl();
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(u).then(
            function () {
              setStatus("Copied: " + u, "ok");
            },
            function () {
              setStatus(u, "");
            }
          );
        } else setStatus(u, "");
      });

    $("tf-lan-select") &&
      $("tf-lan-select").addEventListener("change", function () {
        var v = $("tf-lan-select").value;
        if (!v) return;
        state.userPickedLan = true;
        state.bestLan = v;
        updatePortalUi({ lanUrls: state.lanUrls });
        preferLan(v).then(function () {
          setStatus("QR set to " + v.replace(/^https?:\/\//, "") + " (saved)", "ok");
        });
      });

    $("tf-load-more") &&
      $("tf-load-more").addEventListener("click", function () {
        state.visible = Math.min(
          state.items.length,
          (state.visible || 0) + pageSize()
        );
        renderGalleryGrid();
      });

    $("tf-refresh") &&
      $("tf-refresh").addEventListener("click", function () {
        catalogCache = {};
        loadStatus();
        if (state.subtab === "browse") loadCatalog();
        else refreshUploadList();
      });

    window.addEventListener("tab-changed", function (e) {
      if (e.detail && e.detail.tab === "transfer") {
        document.body.classList.add("tf-tab-active");
        loadStatus();
        setSubtab(state.subtab || "browse");
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = setInterval(function () {
          if (document.body.getAttribute("data-active-tab") !== "transfer") return;
          loadStatus();
        }, 20000);
      } else {
        document.body.classList.remove("tf-tab-active");
        if (pollTimer) {
          clearInterval(pollTimer);
          pollTimer = 0;
        }
      }
    });

    var onTransfer =
      /#transfer/i.test(window.location.hash || "") ||
      document.body.getAttribute("data-active-tab") === "transfer";
    if (onTransfer) {
      try {
        document.body.setAttribute("data-active-tab", "transfer");
      } catch (e) {}
      loadStatus();
      setSubtab("browse");
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }

  window.Transfer = {
    refresh: function () {
      loadStatus();
      if (state.subtab === "browse") return loadCatalog();
      return refreshUploadList();
    },
  };
})();
