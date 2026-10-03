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

  var SAY_AT = [0.45, 1.35, 2.25, 3.15, 4.05, 4.95];

  function smooth(u) {
    u = Math.max(0, Math.min(1, u));
    return u * u * (3 - 2 * u);
  }

  function lerp(a, b, u) {
    return a + (b - a) * u;
  }

  function yawAt(t) {
    if (t < 6.2) return 0;
    if (t < 8) return lerp(0, -1, smooth((t - 6.2) / 1.8));
    if (t < 10.2) return lerp(-1, 1, smooth((t - 8) / 2.2));
    if (t < 12.6) return lerp(1, -1, smooth((t - 10.2) / 2.4));
    if (t < 14.2) return lerp(-1, 0, smooth((t - 12.6) / 1.6));
    return 0;
  }

  function sayNumber(n) {
    if (!window.speechSynthesis) return;
    var u = new SpeechSynthesisUtterance(String(n));
    u.rate = 0.92;
    window.speechSynthesis.speak(u);
  }

  function paintPortrait(ctx, img, w, h, t) {
    var yaw = yawAt(t);
    ctx.fillStyle = "#100e0c";
    ctx.fillRect(0, 0, w, h);
    var iw = img.naturalWidth || img.width;
    var ih = img.naturalHeight || img.height;
    var fit = Math.min((w * 0.86) / iw, (h * 0.86) / ih);
    ctx.save();
    ctx.translate(w * 0.5 + yaw * w * 0.07, h * 0.5);
    ctx.rotate(yaw * 0.12);
    ctx.scale(1 - Math.abs(yaw) * 0.08, 1);
    ctx.drawImage(img, (-iw * fit) / 2, (-ih * fit) / 2, iw * fit, ih * fit);
    ctx.restore();
  }

  function armSpeech(video) {
    if (!video) return;
    video.ontimeupdate = null;
    if (!window.speechSynthesis) return;
    var said = {};
    video.ontimeupdate = function () {
      var t = video.currentTime || 0;
      var i;
      for (i = 0; i < SAY_AT.length; i++) {
        if (t >= SAY_AT[i] && t < SAY_AT[i] + 0.4 && !said[i]) {
          said[i] = true;
          sayNumber(i + 1);
        }
      }
    };
  }

  function localCameo(dataUrl) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        var stage = $("cameo-stage");
        var still = $("cameo-still");
        var canvas = document.createElement("canvas");
        canvas.className = "cameo-live";
        canvas.width = 720;
        canvas.height = 1280;
        var ctx = canvas.getContext("2d");
        if (still) still.hidden = true;
        var empty = $("cameo-empty");
        if (empty) empty.hidden = true;
        if (stage) stage.appendChild(canvas);
        var said = {};
        var rec = null;
        var chunks = [];
        var mime = "";
        try {
          var stream = canvas.captureStream(30);
          mime = window.MediaRecorder && MediaRecorder.isTypeSupported("video/webm;codecs=vp8")
            ? "video/webm;codecs=vp8"
            : "video/webm";
          rec = new MediaRecorder(stream, { mimeType: mime });
          rec.ondataavailable = function (e) {
            if (e.data && e.data.size) chunks.push(e.data);
          };
          rec.start();
        } catch (err) {
          rec = null;
        }
        if (window.speechSynthesis) window.speechSynthesis.cancel();
        var t0 = performance.now();
        function frame(now) {
          var t = (now - t0) / 1000;
          paintPortrait(ctx, img, canvas.width, canvas.height, t);
          var i;
          for (i = 0; i < SAY_AT.length; i++) {
            if (t >= SAY_AT[i] && !said[i]) {
              said[i] = true;
              sayNumber(i + 1);
            }
          }
          if (t < 15) {
            requestAnimationFrame(frame);
            return;
          }
          if (!rec) {
            resolve("");
            return;
          }
          rec.onstop = function () {
            if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
            var blob = new Blob(chunks, { type: rec.mimeType || "video/webm" });
            resolve(blob.size ? URL.createObjectURL(blob) : "");
          };
          try { rec.stop(); } catch (e2) { resolve(""); }
        }
        requestAnimationFrame(frame);
      };
      img.onerror = function () {
        reject(new Error("That image could not be shown."));
      };
      img.src = dataUrl;
    });
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
        setStatus("Ready. Make cameo runs the portrait short.");
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
        setStatus("Making the cameo… " + sec + "s");
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

  function present(url, local) {
    if (!url) {
      setStatus("Cameo ready.");
      return;
    }
    showVideo(url, local);
    if (local) {
      armSpeech($("cameo-video"));
      var download = $("cameo-download");
      if (download) download.download = "cameo.webm";
      setStatus("Cameo ready.");
      return;
    }
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
    setStatus("Starting the cameo…");
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
        return present(url, false);
      })
      .catch(function () {
        setStatus("Making the cameo…");
        return localCameo(state.dataUrl).then(function (url) {
          return present(url, true);
        });
      })
      .catch(function (err) {
        setStatus((err && err.message) || "Cameo failed.");
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
      if (window.speechSynthesis) window.speechSynthesis.cancel();
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
