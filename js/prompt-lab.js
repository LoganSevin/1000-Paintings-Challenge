/**
 * Prompt tab — drop images, generate ready-to-paste image prompts.
 */
(function () {
  "use strict";

  var FETCH_TIMEOUT_MS = 90000;
  var MAX_IMAGES = 12;
  var MAX_SIDE = 768;

  var state = {
    items: [], // { id, name, dataUrl, thumbUrl }
    generating: false,
    lastMeta: null,
  };

  function $(id) {
    return document.getElementById(id);
  }

  function apiUrl(path) {
    if (typeof window.galleryApiUrl === "function") return window.galleryApiUrl(path);
    var base = String(window.SPELLFORGE_API_BASE || "").replace(/\/$/, "");
    return base ? base + path : path;
  }

  function parseApiResponse(res) {
    if (window.parseGalleryApiResponse) return window.parseGalleryApiResponse(res);
    return res.json();
  }

  function fetchWithTimeout(url, options, ms) {
    ms = ms || FETCH_TIMEOUT_MS;
    if (typeof AbortSignal !== "undefined" && AbortSignal.timeout) {
      options = options || {};
      options.signal = AbortSignal.timeout(ms);
      return fetch(url, options);
    }
    return fetch(url, options || {});
  }

  function setStatus(msg, kind) {
    var el = $("pr-status");
    if (!el) return;
    el.textContent = msg || "";
    el.className = "pr-status" + (kind ? " " + kind : "");
  }

  function uid() {
    return "pr-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
  }

  function compressDataUrl(dataUrl, maxSide, quality) {
    return new Promise(function (resolve) {
      if (!dataUrl || dataUrl.indexOf("data:image") !== 0) return resolve(dataUrl || "");
      var img = new Image();
      img.onload = function () {
        var w = img.width;
        var h = img.height;
        var scale = Math.min(1, maxSide / Math.max(w, h, 1));
        var canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(w * scale));
        canvas.height = Math.max(1, Math.round(h * scale));
        var ctx = canvas.getContext("2d");
        if (!ctx) return resolve(dataUrl);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality || 0.82));
      };
      img.onerror = function () {
        resolve(dataUrl);
      };
      img.src = dataUrl;
    });
  }

  function fileToDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve(reader.result);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function renderTray() {
    var tray = $("pr-tray");
    if (!tray) return;
    tray.innerHTML = "";
    state.items.forEach(function (item, i) {
      var div = document.createElement("div");
      div.className = "pr-thumb";
      div.title = item.name || "Image " + (i + 1);
      var img = document.createElement("img");
      img.src = item.thumbUrl || item.dataUrl;
      img.alt = item.name || "";
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pr-thumb-remove";
      btn.setAttribute("aria-label", "Remove image");
      btn.textContent = "×";
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        state.items = state.items.filter(function (x) {
          return x.id !== item.id;
        });
        renderTray();
        updateButtons();
      });
      var lab = document.createElement("span");
      lab.className = "pr-thumb-label";
      lab.textContent = item.name || "#" + (i + 1);
      div.appendChild(img);
      div.appendChild(btn);
      div.appendChild(lab);
      tray.appendChild(div);
    });
    updateButtons();
  }

  function updateButtons() {
    var gen = $("pr-generate");
    var clear = $("pr-clear-images");
    var n = state.items.length;
    if (gen) {
      gen.disabled = state.generating || n === 0;
      gen.textContent = state.generating
        ? "Generating…"
        : n > 1
          ? "Generate from " + n + " images"
          : "Generate prompt";
    }
    if (clear) clear.disabled = state.generating || n === 0;
    var copy = $("pr-copy");
    var out = $("pr-output");
    if (copy) copy.disabled = !(out && out.value.trim());
  }

  function addDataUrl(dataUrl, name) {
    if (!dataUrl || dataUrl.indexOf("data:image") !== 0) return Promise.resolve();
    if (state.items.length >= MAX_IMAGES) {
      setStatus("Max " + MAX_IMAGES + " images — remove one first.", "error");
      return Promise.resolve();
    }
    return compressDataUrl(dataUrl, MAX_SIDE, 0.85).then(function (compressed) {
      state.items.push({
        id: uid(),
        name: name || "image",
        dataUrl: compressed,
        thumbUrl: compressed,
      });
      renderTray();
      setStatus(state.items.length + " image" + (state.items.length === 1 ? "" : "s") + " ready.", "ok");
    });
  }

  function addFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []).filter(function (f) {
      return f && f.type && f.type.indexOf("image/") === 0;
    });
    if (!files.length) {
      setStatus("Drop image files (png, jpg, webp…).", "error");
      return Promise.resolve();
    }
    var chain = Promise.resolve();
    files.forEach(function (file) {
      chain = chain.then(function () {
        if (state.items.length >= MAX_IMAGES) return;
        return fileToDataUrl(file).then(function (url) {
          return addDataUrl(url, file.name || "image");
        });
      });
    });
    return chain;
  }

  function analysisToPrompt(a) {
    a = a || {};
    if (a.prompt && String(a.prompt).trim()) return String(a.prompt).trim();
    var parts = [];
    if (a.title) parts.push(a.title);
    if (a.description) parts.push(a.description);
    var meta = [];
    if (a.style) meta.push(a.style + " style");
    if (a.mood) meta.push(a.mood + " mood");
    if (a.medium) meta.push(a.medium);
    if (meta.length) parts.push(meta.join(", "));
    if (a.tags && a.tags.length) parts.push(a.tags.join(", "));
    if (a.colors && a.colors.length) parts.push("palette: " + a.colors.join(", "));
    return parts.join(". ").replace(/\.\s*\./g, ".").trim();
  }

  function fusePrompts(prompts, emphasis) {
    prompts = (prompts || []).filter(Boolean);
    if (!prompts.length) return "";
    if (prompts.length === 1) {
      var one = prompts[0];
      if (emphasis) {
        if (one.toLowerCase().indexOf(emphasis.toLowerCase()) < 0) {
          one = one.replace(/\s+$/, "") + " " + emphasis.trim();
        }
      }
      return one;
    }
    var fused =
      "Unified scene fusing " +
      prompts.length +
      " references: " +
      prompts
        .map(function (p, i) {
          return "(" + (i + 1) + ") " + p;
        })
        .join(" · ") +
      ". Merge into one coherent composition — shared lighting, consistent palette, single camera angle; not a collage grid.";
    if (emphasis) fused += " Emphasis: " + emphasis.trim() + ".";
    return fused;
  }

  function analyzeOne(dataUrl, emphasis) {
    return compressDataUrl(dataUrl, MAX_SIDE, 0.8).then(function (compressed) {
      return fetchWithTimeout(
        apiUrl("/api/analyze-image"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            image: compressed,
            mode: "generation_prompt",
            emphasis: emphasis || "",
          }),
        },
        FETCH_TIMEOUT_MS
      );
    }).then(function (r) {
      return parseApiResponse(r).then(function (d) {
        if (!r.ok) throw new Error((d && d.error) || "Analyze failed (" + r.status + ")");
        return d;
      });
    });
  }

  function generate() {
    if (state.generating || !state.items.length) return;
    var emphasis = ($("pr-emphasis") && $("pr-emphasis").value.trim()) || "";
    var out = $("pr-output");
    state.generating = true;
    updateButtons();
    setStatus("Reading image" + (state.items.length > 1 ? "s" : "") + "…", "pending");
    if (window.XaiCreditsHud && window.XaiCreditsHud.refresh) {
      /* credits refresh after */
    }

    var prompts = [];
    var metas = [];
    var i = 0;

    function next() {
      if (i >= state.items.length) {
        var fused = fusePrompts(prompts, emphasis);
        if (out) out.value = fused;
        state.lastMeta = { count: prompts.length, analyses: metas };
        var metaEl = $("pr-meta");
        if (metaEl) {
          var tags = [];
          metas.forEach(function (m) {
            if (m && m.style) tags.push(m.style);
            if (m && m.mood) tags.push(m.mood);
          });
          metaEl.textContent =
            prompts.length +
            " image" +
            (prompts.length === 1 ? "" : "s") +
            (tags.length ? " · " + tags.slice(0, 6).join(" · ") : "");
        }
        setStatus("Prompt ready — edit or copy.", "ok");
        state.generating = false;
        updateButtons();
        if (window.dispatchEvent) {
          window.dispatchEvent(new Event("xai-usage-refresh"));
        }
        return;
      }
      var item = state.items[i];
      setStatus(
        "Prompt " + (i + 1) + " / " + state.items.length + " — " + (item.name || "image") + "…",
        "pending"
      );
      return analyzeOne(item.dataUrl, emphasis)
        .then(function (d) {
          var a = (d && d.analysis) || {};
          metas.push(a);
          prompts.push(analysisToPrompt(a));
          i += 1;
          return next();
        })
        .catch(function (err) {
          state.generating = false;
          updateButtons();
          setStatus((err && err.message) || "Could not generate prompt.", "error");
        });
    }

    next();
  }

  function wireDropzone() {
    var zone = $("pr-dropzone");
    var input = $("pr-file");
    if (!zone) return;

    zone.addEventListener("click", function () {
      if (input) input.click();
    });
    if (input) {
      input.addEventListener("change", function () {
        addFiles(input.files).then(function () {
          input.value = "";
        });
      });
    }

    ["dragenter", "dragover"].forEach(function (ev) {
      zone.addEventListener(ev, function (e) {
        e.preventDefault();
        e.stopPropagation();
        zone.classList.add("is-drag");
      });
    });
    ["dragleave", "drop"].forEach(function (ev) {
      zone.addEventListener(ev, function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (ev === "dragleave") zone.classList.remove("is-drag");
      });
    });
    zone.addEventListener("drop", function (e) {
      zone.classList.remove("is-drag");
      var dt = e.dataTransfer;
      if (!dt) return;
      if (dt.files && dt.files.length) {
        addFiles(dt.files);
        return;
      }
      // URL drops (e.g. browser image)
      var uri = dt.getData("text/uri-list") || dt.getData("text/plain");
      if (uri && /^https?:\/\//i.test(uri.trim().split("\n")[0])) {
        setStatus("Remote URLs: download/save the image, then drop the file.", "error");
      }
    });

    // Paste image from clipboard while on this tab
    document.addEventListener("paste", function (e) {
      if (document.body.getAttribute("data-active-tab") !== "prompt") return;
      var items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      var files = [];
      for (var i = 0; i < items.length; i++) {
        if (items[i].type.indexOf("image/") === 0) {
          var f = items[i].getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length) {
        e.preventDefault();
        addFiles(files);
      }
    });
  }

  function wireActions() {
    var gen = $("pr-generate");
    if (gen) gen.addEventListener("click", generate);

    var clear = $("pr-clear-images");
    if (clear) {
      clear.addEventListener("click", function () {
        state.items = [];
        renderTray();
        setStatus("Images cleared.", "ok");
      });
    }

    var clearOut = $("pr-clear-output");
    if (clearOut) {
      clearOut.addEventListener("click", function () {
        var out = $("pr-output");
        if (out) out.value = "";
        var meta = $("pr-meta");
        if (meta) meta.textContent = "";
        updateButtons();
        setStatus("Prompt cleared.", "ok");
      });
    }

    var copy = $("pr-copy");
    if (copy) {
      copy.addEventListener("click", function () {
        var out = $("pr-output");
        var text = out && out.value.trim();
        if (!text) return;
        var done = function () {
          setStatus("Copied to clipboard.", "ok");
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done).catch(function () {
            if (out) {
              out.select();
              try {
                document.execCommand("copy");
                done();
              } catch (_) {}
            }
          });
        } else if (out) {
          out.select();
          try {
            document.execCommand("copy");
            done();
          } catch (_) {}
        }
      });
    }

    var out = $("pr-output");
    if (out) {
      out.addEventListener("input", updateButtons);
    }
  }

  function onShow() {
    updateButtons();
  }

  function boot() {
    if (!$("panel-prompt")) return;
    wireDropzone();
    wireActions();
    renderTray();
    setStatus("Drop or paste images, then generate.", "");
    window.PromptLab = { onShow: onShow };
    window.dispatchEvent(new Event("prompt-ready"));
  }

  window.addEventListener("prompt-show", onShow);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
