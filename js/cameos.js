/**
 * Cameos — a portrait short from any uploaded image.
 * The subject says 1 through 6, then looks left, right, and left again.
 */
(function () {
  "use strict";

  var state = {
    dataUrl: "",
    busy: false,
    job: "",
  };

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
    var el = $("cameo-status");
    if (el) el.textContent = text || "";
  }

  function setBusy(on) {
    state.busy = !!on;
    var btn = $("cameo-make");
    if (btn) btn.disabled = state.busy || !state.dataUrl;
  }

  function showStill(url) {
    var img = $("cameo-still");
    var empty = $("cameo-empty");
    var video = $("cameo-video");
    var download = $("cameo-download");
    if (video) {
      video.pause();
      video.removeAttribute("src");
      video.hidden = true;
    }
    if (download) download.hidden = true;
    if (img) {
      img.src = url;
      img.hidden = false;
      img.alt = "Cameo reference";
    }
    if (empty) empty.hidden = true;
  }

  function showVideo(url, stayPaused) {
    var video = $("cameo-video");
    var download = $("cameo-download");
    url = absoluteUrl(url);
    var img = $("cameo-still");
    if (img) img.hidden = true;
    if (video) {
      video.src = url;
      video.hidden = false;
      if (!stayPaused) video.play().catch(function () {});
    }
    if (download) {
      download.href = url;
      download.hidden = false;
    }
  }

  function fileToDataUrl(file) {
    return new Promise(function (resolve, reject) {
      if (!file || !/^image\//.test(file.type || "")) {
        reject(new Error("Choose an image file."));
        return;
      }
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () {
        var maxSide = 1280;
        var w = img.naturalWidth || img.width;
        var h = img.naturalHeight || img.height;
        var scale = Math.min(1, maxSide / Math.max(w, h, 1));
        var canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(w * scale));
        canvas.height = Math.max(1, Math.round(h * scale));
        var ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL("image/jpeg", 0.86));
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error("That file could not be read as an image."));
      };
      img.src = url;
    });
  }

  function takeFile(file) {
    if (!file || state.busy) return;
    setStatus("Reading image…");
    fileToDataUrl(file)
      .then(function (url) {
        state.dataUrl = url;
        showStill(url);
        setBusy(false);
        setStatus("Ready. Make cameo asks Grok for a new short.");
      })
      .catch(function (err) {
        setStatus((err && err.message) || "Could not read that image.");
      });
  }

  function videoUrlFrom(payload) {
    if (!payload) return "";
    var vid = payload.video;
    var raw =
      (vid && (vid.url || vid.download_url || vid.uri)) ||
      payload.video_url ||
      payload.output_url ||
      payload.result_url ||
      "";
    if (window.GallerySaveVideo && window.GallerySaveVideo.preferSavedUrl) {
      raw = window.GallerySaveVideo.preferSavedUrl(payload, raw) || raw;
    }
    return absoluteUrl(raw);
  }

  function readBody(r) {
    return r.text().then(function (text) {
      try {
        return JSON.parse(text);
      } catch (e) {
        return { error: (text || "").slice(0, 180) || "HTTP " + r.status };
      }
    });
  }

  function poll(jobId, started) {
    return fetch(apiUrl("/api/cameo-video?id=" + encodeURIComponent(jobId)), { cache: "no-store" })
      .then(function (r) {
        return readBody(r).then(function (d) {
          return { ok: r.ok, d: d || {} };
        });
      })
      .then(function (res) {
        var job = res.d;
        if (!res.ok) {
          var why = job.error;
          throw new Error((why && (why.message || why)) || "Cameo could not be checked.");
        }
        var st = String(job.status || "working").toLowerCase();
        var sec = Math.round((Date.now() - started) / 1000);
        setStatus("Grok is generating the cameo… " + sec + "s");
        if (st === "done" || st === "completed" || st === "success") {
          var url = videoUrlFrom(job);
          if (!url) throw new Error("The cameo finished without a video.");
          return url;
        }
        if (st === "failed" || st === "error" || st === "expired") {
          var err = job.error;
          throw new Error((err && (err.message || err)) || "Cameo failed.");
        }
        if (Date.now() - started > 12 * 60 * 1000) {
          throw new Error("The cameo timed out. Try the same image again.");
        }
        return new Promise(function (resolve) {
          setTimeout(resolve, 2000);
        }).then(function () {
          return poll(jobId, started);
        });
      });
  }

  function saveVideo(url) {
    if (window.GallerySaveVideo && window.GallerySaveVideo.save) {
      return window.GallerySaveVideo.save(url, { force: true, timeoutMs: 180000 });
    }
    return fetch(apiUrl("/api/save-video"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: absoluteUrl(url), force_mp4: true }),
    }).then(function (r) {
      return r.json().then(function (d) {
        if (!r.ok || (d && d.ok === false)) {
          throw new Error((d && d.error) || "Save failed");
        }
        return d;
      });
    });
  }

  function present(url) {
    if (!url) {
      setStatus("Cameo ready.");
      return;
    }
    showVideo(url, false);
    var download = $("cameo-download");
    if (download) download.download = "cameo.mp4";
    setStatus("Cameo ready. Saving a copy…");
    return saveVideo(url)
      .then(function (saved) {
        var localUrl = saved && (saved.url || saved.path);
        if (localUrl) showVideo(localUrl);
        var name = saved && (saved.name || (saved.num != null ? saved.num + ".mp4" : ""));
        setStatus(name ? "Cameo saved as saved-videos/" + name + "." : "Cameo ready.");
      })
      .catch(function () {
        setStatus("Cameo ready.");
      });
  }

  function makeCameo() {
    if (state.busy || !state.dataUrl) return;
    state.job = "";
    setBusy(true);
    setStatus("Asking Grok for a new cameo…");
    var started = Date.now();
    fetch(apiUrl("/api/cameo-video"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reference_image: state.dataUrl }),
    })
      .then(function (r) {
        return readBody(r).then(function (d) {
          return { ok: r.ok, status: r.status, d: d || {} };
        });
      })
      .then(function (res) {
        if (!res.ok && res.status !== 202) {
          throw new Error((res.d && (res.d.error || res.d.message)) || "Cameo could not start.");
        }
        var immediate = videoUrlFrom(res.d);
        if (immediate) return immediate;
        var jid = res.d.job_id || res.d.id;
        if (!jid) throw new Error("Cameo did not start.");
        state.job = jid;
        return poll(jid, started);
      })
      .then(function (url) {
        return present(url);
      })
      .catch(function (err) {
        setStatus((err && err.message) || "Grok could not generate the cameo.");
      })
      .then(function () {
        setBusy(false);
      });
  }

  function bind() {
    var file = $("cameo-file");
    var make = $("cameo-make");
    var stage = $("cameo-stage");
    if (!file || file.dataset.bound) return;
    file.dataset.bound = "1";
    file.addEventListener("change", function () {
      var picked = file.files && file.files[0];
      file.value = "";
      if (picked) takeFile(picked);
    });
    if (make) make.addEventListener("click", makeCameo);
    if (stage) {
      stage.addEventListener("dragover", function (e) {
        e.preventDefault();
        stage.classList.add("is-over");
      });
      stage.addEventListener("dragleave", function () {
        stage.classList.remove("is-over");
      });
      stage.addEventListener("drop", function (e) {
        e.preventDefault();
        stage.classList.remove("is-over");
        var dropped = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (dropped) takeFile(dropped);
      });
    }
  }

  function onShow() {
    bind();
  }

  window.addEventListener("cameos-show", onShow);
  window.addEventListener("tab-changed", function (e) {
    if (e.detail && e.detail.tab === "cameos") onShow();
    else {
      var video = $("cameo-video");
      if (video && !video.hidden) video.pause();
    }
  });
  window.Cameos = { onShow: onShow };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      if (document.body.getAttribute("data-active-tab") === "cameos") onShow();
    });
  } else if (document.body.getAttribute("data-active-tab") === "cameos") {
    onShow();
  }
})();
