/**
 * Tabloid print preparation — US 11×17 in @ 300 DPI for Gallery, Spellforge, Muralwalk, Fleeting Idea.
 */
(function () {
  "use strict";

  var DPI = 300;
  var TABLOID_W_IN = 11;
  var TABLOID_H_IN = 17;
  var TABLOID_PX_W = TABLOID_W_IN * DPI;
  var TABLOID_PX_H = TABLOID_H_IN * DPI;
  var MARGIN_IN = 0.75;
  var MARGIN_PX = Math.round(MARGIN_IN * DPI);
  var FOOTER_IN = 2.4;
  var FOOTER_PX = Math.round(FOOTER_IN * DPI);

  var EXPORT_ERR =
    "Could not export the print sheet. Open the gallery at http://localhost:8765 (not file://) and ensure images load from the same server.";

  var state = {
    opts: null,
    img: null,
    orientation: "auto",
    composed: null,
  };

  function $(id) {
    return document.getElementById(id);
  }

  function absoluteUrl(url) {
    try {
      return new URL(url, location.href).href;
    } catch (e) {
      return String(url || "");
    }
  }

  function isInlineUrl(url) {
    return /^data:/i.test(url) || /^blob:/i.test(url);
  }

  function loadViaImageElement(url, useCors) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      if (useCors) img.crossOrigin = "anonymous";
      img.onload = function () {
        if (!img.naturalWidth) {
          reject(new Error("Image failed to load."));
          return;
        }
        resolve(img);
      };
      img.onerror = function () {
        reject(new Error("Image failed to load."));
      };
      img.src = url;
    });
  }

  /** Fetch → blob URL keeps canvas exportable even when <img> lacked crossOrigin. */
  function loadImageFromUrl(url) {
    url = absoluteUrl(url);
    if (!url || url === "about:blank") {
      return Promise.reject(new Error("No image URL."));
    }
    if (isInlineUrl(url)) {
      return loadViaImageElement(url, false);
    }
    if (location.protocol === "file:") {
      return loadViaImageElement(url, true).catch(function () {
        return Promise.reject(new Error(EXPORT_ERR));
      });
    }
    return fetch(url, { mode: "cors", credentials: "omit", cache: "force-cache" })
      .then(function (res) {
        if (!res.ok) throw new Error("fetch " + res.status);
        return res.blob();
      })
      .then(function (blob) {
        var blobUrl = URL.createObjectURL(blob);
        return loadViaImageElement(blobUrl, false).finally(function () {
          URL.revokeObjectURL(blobUrl);
        });
      })
      .catch(function () {
        return loadViaImageElement(url, true);
      });
  }

  function loadImageSource(source) {
    if (!source) return Promise.reject(new Error("No image to print."));
    if (source instanceof HTMLCanvasElement) {
      var dataUrl;
      try {
        dataUrl = source.toDataURL("image/png");
      } catch (e) {
        return Promise.reject(new Error(EXPORT_ERR));
      }
      return loadImageFromUrl(dataUrl);
    }
    if (source instanceof HTMLImageElement) {
      var src = source.currentSrc || source.src || "";
      if (!src) return Promise.reject(new Error("No image URL."));
      return loadImageFromUrl(src);
    }
    return loadImageFromUrl(String(source));
  }

  function assertCanvasExportable(canvas) {
    try {
      canvas.toDataURL("image/png");
      return canvas;
    } catch (e) {
      throw new Error(EXPORT_ERR);
    }
  }

  function pickOrientation(img, mode) {
    if (mode === "portrait" || mode === "landscape") return mode;
    var ar = img.naturalWidth / img.naturalHeight;
    return ar >= 1.05 ? "landscape" : "portrait";
  }

  function wrapText(ctx, text, maxWidth) {
    var words = String(text || "").trim().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    var lines = [];
    var line = "";
    for (var i = 0; i < words.length; i++) {
      var word = words[i];
      var test = line ? line + " " + word : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  function truncate(str, max) {
    var s = String(str || "").trim();
    if (s.length <= max) return s;
    return s.slice(0, max - 1) + "…";
  }

  function composeTabloid(img, opts, orientation) {
    var pw = orientation === "landscape" ? TABLOID_PX_H : TABLOID_PX_W;
    var ph = orientation === "landscape" ? TABLOID_PX_W : TABLOID_PX_H;
    var canvas = document.createElement("canvas");
    canvas.width = pw;
    canvas.height = ph;
    var ctx = canvas.getContext("2d");

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, pw, ph);

    var hasText = !!(opts.title || opts.subtitle || opts.caption);
    var footerH = hasText ? FOOTER_PX : MARGIN_PX;
    var contentX = MARGIN_PX;
    var contentY = MARGIN_PX;
    var contentW = pw - MARGIN_PX * 2;
    var contentH = ph - MARGIN_PX - footerH;

    var scale = Math.min(contentW / img.naturalWidth, contentH / img.naturalHeight);
    var dw = img.naturalWidth * scale;
    var dh = img.naturalHeight * scale;
    var dx = contentX + (contentW - dw) / 2;
    var dy = contentY + (contentH - dh) / 2;
    ctx.drawImage(img, dx, dy, dw, dh);

    var textBlockTop = ph - footerH + Math.round(DPI * 0.15);
    var lineStep = Math.round(DPI * 0.2);
    var y = textBlockTop;

    ctx.textAlign = "center";
    ctx.textBaseline = "top";

    if (opts.title) {
      ctx.font = '600 ' + Math.round(DPI * 0.2) + 'px "DM Sans", system-ui, sans-serif';
      ctx.fillStyle = "#1a1a1a";
      ctx.fillText(truncate(opts.title, 72), pw / 2, y);
      y += lineStep + Math.round(DPI * 0.08);
    }
    if (opts.subtitle) {
      ctx.font = '500 ' + Math.round(DPI * 0.13) + 'px "DM Sans", system-ui, sans-serif';
      ctx.fillStyle = "#444444";
      ctx.fillText(truncate(opts.subtitle, 96), pw / 2, y);
      y += lineStep;
    }
    if (opts.caption) {
      ctx.font = '400 ' + Math.round(DPI * 0.1) + 'px "Cormorant Garamond", Georgia, serif';
      ctx.fillStyle = "#333333";
      var lines = wrapText(ctx, truncate(opts.caption, 900), contentW);
      var maxLines = opts.title && opts.subtitle ? 3 : 5;
      for (var li = 0; li < Math.min(lines.length, maxLines); li++) {
        ctx.fillText(lines[li], pw / 2, y);
        y += Math.round(DPI * 0.16);
      }
    }

    var credit =
      opts.credit ||
      (typeof window !== "undefined" && window.galleryAuthorCredit
        ? window.galleryAuthorCredit()
        : "Art by Logan Sevin");
    if (opts.source) credit = opts.source + " · " + credit;
    ctx.font = '400 ' + Math.round(DPI * 0.08) + 'px "DM Sans", system-ui, sans-serif';
    ctx.fillStyle = "#888888";
    ctx.fillText(credit, pw / 2, ph - Math.round(DPI * 0.35));

    return assertCanvasExportable(canvas);
  }

  function showExportError(err) {
    var preview = $("tabloid-print-preview");
    if (preview) {
      preview.removeAttribute("src");
      preview.alt = (err && err.message) || EXPORT_ERR;
    }
    alert((err && err.message) || EXPORT_ERR);
  }

  function updatePreview() {
    if (!state.img || !state.opts) return;
    try {
      var orient = pickOrientation(state.img, state.orientation);
      state.composed = composeTabloid(state.img, state.opts, orient);
      var preview = $("tabloid-print-preview");
      var orientEl = $("tabloid-print-orient");
      if (preview) {
        preview.src = state.composed.toDataURL("image/jpeg", 0.92);
        preview.alt =
          (state.opts.title || "Tabloid print") +
          " — " +
          (orient === "landscape" ? "17×11 in landscape" : "11×17 in portrait");
      }
      if (orientEl) {
        orientEl.textContent =
          (orient === "landscape" ? "Landscape 17×11 in" : "Portrait 11×17 in") +
          " · " +
          TABLOID_PX_W +
          "×" +
          TABLOID_PX_H +
          " px @ " +
          DPI +
          " DPI";
      }
      document.querySelectorAll(".tabloid-print-orient-btns .btn-secondary").forEach(function (btn) {
        var mode = btn.dataset.orient || "auto";
        btn.classList.toggle("active", mode === state.orientation);
      });
    } catch (err) {
      state.composed = null;
      showExportError(err);
    }
  }

  function openDialog() {
    var dlg = $("tabloid-print-dialog");
    if (!dlg) return;
    var titleEl = $("tabloid-print-title");
    if (titleEl && state.opts && state.opts.title) {
      titleEl.textContent = "Tabloid print — " + state.opts.title;
    }
    updatePreview();
    if (!state.composed) return;
    if (window.galleryDialog && window.galleryDialog.open) {
      window.galleryDialog.open(dlg);
    } else if (typeof dlg.showModal === "function") {
      dlg.showModal();
    } else {
      dlg.setAttribute("open", "");
    }
  }

  function closeDialog() {
    var dlg = $("tabloid-print-dialog");
    if (!dlg) return;
    if (window.galleryDialog && window.galleryDialog.close) {
      window.galleryDialog.close(dlg);
    } else if (typeof dlg.close === "function") {
      dlg.close();
    } else {
      dlg.removeAttribute("open");
    }
  }

  function printComposed() {
    if (!state.composed) return;
    try {
      var orient = pickOrientation(state.img, state.orientation);
      var pageSize = orient === "landscape" ? "17in 11in" : "11in 17in";
      var dataUrl = state.composed.toDataURL("image/png");
      var iframe = document.createElement("iframe");
      iframe.setAttribute("aria-hidden", "true");
      iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
      document.body.appendChild(iframe);
      var doc = iframe.contentDocument || iframe.contentWindow.document;
      doc.open();
      doc.write(
        "<!DOCTYPE html><html><head><title>Tabloid print</title><style>" +
          "@page { size: " +
          pageSize +
          "; margin: 0; }" +
          "html, body { margin: 0; padding: 0; width: 100%; height: 100%; }" +
          "img { display: block; width: 100%; height: 100%; object-fit: contain; }" +
          "</style></head><body><img src=\"" +
          dataUrl +
          "\" alt=\"Tabloid print\" /></body></html>"
      );
      doc.close();
      var win = iframe.contentWindow;
      function doPrint() {
        win.focus();
        win.print();
        setTimeout(function () {
          if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
        }, 1200);
      }
      if (win.document.readyState === "complete") doPrint();
      else win.addEventListener("load", doPrint, { once: true });
    } catch (err) {
      showExportError(err);
    }
  }

  function downloadComposed() {
    if (!state.composed || !state.opts) return;
    try {
      var base = (state.opts.filename || state.opts.title || "tabloid-print")
        .replace(/[^\w\-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 64) || "tabloid-print";
      var orient = pickOrientation(state.img, state.orientation);
      var name = base + "-tabloid-" + orient + ".png";
      state.composed.toBlob(function (blob) {
        if (!blob) {
          showExportError(new Error(EXPORT_ERR));
          return;
        }
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = name;
        a.click();
        setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      }, "image/png");
    } catch (err) {
      showExportError(err);
    }
  }

  function bindDialog() {
    var closeBtn = $("tabloid-print-close");
    var cancelBtn = $("tabloid-print-cancel");
    var printBtn = $("tabloid-print-print");
    var downloadBtn = $("tabloid-print-download");
    var dlg = $("tabloid-print-dialog");

    if (closeBtn && !closeBtn.dataset.bound) {
      closeBtn.dataset.bound = "1";
      closeBtn.addEventListener("click", closeDialog);
    }
    if (cancelBtn && !cancelBtn.dataset.bound) {
      cancelBtn.dataset.bound = "1";
      cancelBtn.addEventListener("click", closeDialog);
    }
    if (printBtn && !printBtn.dataset.bound) {
      printBtn.dataset.bound = "1";
      printBtn.addEventListener("click", printComposed);
    }
    if (downloadBtn && !downloadBtn.dataset.bound) {
      downloadBtn.dataset.bound = "1";
      downloadBtn.addEventListener("click", downloadComposed);
    }
    document.querySelectorAll(".tabloid-print-orient-btns [data-orient]").forEach(function (btn) {
      if (btn.dataset.bound) return;
      btn.dataset.bound = "1";
      btn.addEventListener("click", function () {
        state.orientation = btn.dataset.orient || "auto";
        updatePreview();
      });
    });
    if (dlg && !dlg.dataset.bound) {
      dlg.dataset.bound = "1";
      dlg.addEventListener("click", function (e) {
        if (e.target === dlg) closeDialog();
      });
    }
  }

  /**
   * @param {Object} opts
   * @param {string|HTMLImageElement|HTMLCanvasElement} opts.image
   * @param {string} [opts.title]
   * @param {string} [opts.subtitle]
   * @param {string} [opts.caption]
   * @param {string} [opts.credit]
   * @param {string} [opts.source] — Gallery, Spellforge, etc.
   * @param {string} [opts.filename]
   * @param {'auto'|'portrait'|'landscape'} [opts.orientation]
   */
  function prepare(opts) {
    opts = opts || {};
    state.orientation = opts.orientation || "auto";
    state.opts = {
      title: opts.title || "",
      subtitle: opts.subtitle || "",
      caption: opts.caption || "",
      credit:
        opts.credit ||
        (typeof window !== "undefined" && window.galleryAuthorCredit
          ? window.galleryAuthorCredit()
          : "Art by Logan Sevin"),
      source: opts.source || "",
      filename: opts.filename || "",
    };
    return loadImageSource(opts.image)
      .then(function (img) {
        state.img = img;
        openDialog();
      })
      .catch(function (err) {
        alert((err && err.message) || "Could not prepare tabloid print.");
      });
  }

  window.TabloidPrint = {
    prepare: prepare,
    TABLOID_IN: { w: TABLOID_W_IN, h: TABLOID_H_IN },
    DPI: DPI,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindDialog);
  } else {
    bindDialog();
  }
})();