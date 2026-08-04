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
  };
  var pollTimer = 0;

  function $(id) {
    return document.getElementById(id);
  }

  function apiUrl(path) {
    if (typeof window.galleryApiUrl === "function") return window.galleryApiUrl(path);
    var base = String(window.SPELLFORGE_API_BASE || "").replace(/\/$/, "");
    return base ? base + path : path;
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
      qr.src =
        "https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=10&data=" +
        encodeURIComponent(full);
      qr.alt = "QR: " + full;
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

  function loadCatalog() {
    var coll = state.collection || "paintings";
    var grid = $("tf-gallery-grid");
    if (!grid) return Promise.resolve();
    grid.innerHTML = '<p class="tf-empty">Loading…</p>';
    setStatus("Loading " + coll + "…", "");
    return fetch(
      apiUrl("/api/transfer/catalog?collection=" + encodeURIComponent(coll) + "&t=" + Date.now()),
      { cache: "no-store" }
    )
      .then(function (r) {
        return r.json();
      })
      .then(function (d) {
        if (!d || !d.ok) throw new Error((d && d.error) || "Catalog failed");
        state.items = d.items || [];
        renderGalleryGrid();
        setStatus((state.items.length || 0) + " items · tap to select · Download zip", "ok");
      })
      .catch(function (err) {
        grid.innerHTML =
          '<p class="tf-empty">' +
          escapeHtml((err && err.message) || "Could not load gallery") +
          "</p>";
        setStatus((err && err.message) || "Catalog error — restart start_server.bat", "err");
      });
  }

  function renderGalleryGrid() {
    var grid = $("tf-gallery-grid");
    if (!grid) return;
    if (!state.items.length) {
      grid.innerHTML = '<p class="tf-empty">Nothing in this collection yet.</p>';
      updateSelectBar();
      return;
    }
    grid.innerHTML = state.items
      .map(function (it, idx) {
        var id = String(it.id || it.url || idx);
        var url = it.url || "";
        var sel = !!state.selected[id];
        var media = isVideoUrl(url)
          ? '<video src="' + escapeHtml(url) + '#t=0.1" muted playsinline preload="metadata"></video>'
          : '<img src="' + escapeHtml(url) + '" alt="" loading="lazy" />';
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
        if (!r.ok) {
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
        setStatus((err && err.message) || "Zip failed — opening files one by one…", "err");
        urls.slice(0, 12).forEach(function (u, i) {
          setTimeout(function () {
            var a = document.createElement("a");
            a.href = u;
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
        return fetch(apiUrl("/api/transfer/stage"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: url, box: "to-phone" }),
        }).then(function (r) {
          return r.json().then(function (d) {
            if (!r.ok || (d && d.ok === false)) throw new Error((d && d.error) || "Stage failed");
            ok++;
          });
        });
      });
    });
    chain
      .then(function () {
        setStatus("Staged " + ok + " file(s) into transfer-to-phone/.", "ok");
        if (state.collection === "to-phone") loadCatalog();
      })
      .catch(function (err) {
        setStatus((err && err.message) || "Stage failed", "err");
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

  /** Base64 JSON first — far more reliable on iOS Safari than multipart. */
  function uploadOneFile(file) {
    var name = file.name || "photo-" + Date.now() + ".jpg";
    return readFileAsDataUrl(file)
      .then(function (dataUrl) {
        return fetch(apiUrl("/api/transfer/upload"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            box: BOX_FROM_PHONE,
            name: name,
            image_base64: dataUrl,
          }),
        });
      })
      .then(function (r) {
        return r.json().then(function (d) {
          if (!r.ok || (d && d.ok === false)) {
            throw new Error((d && d.error) || "HTTP " + r.status);
          }
          return d;
        });
      })
      .catch(function (err) {
        // Fallback multipart
        var fd = new FormData();
        fd.append("file", file, name);
        fd.append("box", BOX_FROM_PHONE);
        return fetch(apiUrl("/api/transfer/upload"), { method: "POST", body: fd }).then(function (r) {
          return r.json().then(function (d) {
            if (!r.ok || (d && d.ok === false)) {
              throw new Error((d && d.error) || (err && err.message) || "Upload failed");
            }
            return d;
          });
        });
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
            " → phone-uploads/ + Generated mix · describing for prompt weights…",
          "ok"
        );
        return refreshUploadList();
      })
      .catch(function (err) {
        setUploadStatus(
          (err && err.message) || "Upload failed — use QR home Wi‑Fi IP, not VirtualBox",
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
    return fetch(apiUrl("/api/transfer/list?box=" + BOX_FROM_PHONE + "&t=" + Date.now()), {
      cache: "no-store",
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (d) {
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
              ? '<video src="' + escapeHtml(url) + '#t=0.1" muted playsinline></video>'
              : '<img src="' + escapeHtml(url) + '" alt="" loading="lazy" />';
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
            '<p class="tf-empty">' + escapeHtml((err && err.message) || "List failed") + "</p>";
      });
  }

  function loadStatus() {
    return fetch(apiUrl("/api/transfer/status") + "?t=" + Date.now(), { cache: "no-store" })
      .then(function (r) {
        return r.json();
      })
      .then(function (d) {
        if (!d || !d.ok) throw new Error((d && d.error) || "offline");
        updatePortalUi(d);
        return d;
      })
      .catch(function () {
        updatePortalUi({ lanUrls: state.lanUrls.length ? state.lanUrls : [window.location.origin] });
      });
  }

  function preferLan(url) {
    return fetch(apiUrl("/api/transfer/prefer-lan"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: url }),
    })
      .then(function (r) {
        return r.json();
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

    $("tf-refresh") &&
      $("tf-refresh").addEventListener("click", function () {
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
          if (state.subtab === "upload") refreshUploadList();
          // Don't stomp user's LAN pick on poll
          loadStatus();
        }, 8000);
      } else {
        document.body.classList.remove("tf-tab-active");
        if (pollTimer) {
          clearInterval(pollTimer);
          pollTimer = 0;
        }
      }
    });

    // Deep link #transfer
    if (/#transfer/i.test(window.location.hash || "")) {
      try {
        document.body.setAttribute("data-active-tab", "transfer");
      } catch (e) {}
    }

    loadStatus();
    setSubtab("browse");
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
