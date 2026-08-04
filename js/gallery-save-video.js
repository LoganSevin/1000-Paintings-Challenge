/**
 * Shared helper: save any generated video into gallery/saved-videos/N.mp4
 * (same sequential folder used by Movie / Conceptualizer / Book).
 */
(function () {
  "use strict";

  function apiUrl(path) {
    if (typeof window.galleryApiUrl === "function") return window.galleryApiUrl(path);
    var base = String(window.SPELLFORGE_API_BASE || "").replace(/\/$/, "");
    return base ? base + path : path;
  }

  function absoluteUrl(url) {
    if (!url) return "";
    if (
      url.indexOf("data:") === 0 ||
      url.indexOf("blob:") === 0 ||
      /^https?:\/\//i.test(url)
    ) {
      return url;
    }
    try {
      return new URL(url, window.location.href).href;
    } catch (_) {
      return url;
    }
  }

  function isAlreadySaved(url) {
    return /\/saved-videos\/\d+\.[a-z0-9]+/i.test(String(url || ""));
  }

  function extractVideoUrl(payload) {
    if (!payload) return "";
    if (typeof payload === "string") return payload;
    if (payload.url || payload.download_url || payload.uri) {
      return payload.url || payload.download_url || payload.uri;
    }
    var vid = payload.video;
    if (vid) {
      if (typeof vid === "string") return vid;
      return vid.url || vid.download_url || vid.uri || "";
    }
    return payload.video_url || payload.output_url || payload.result_url || "";
  }

  /**
   * @param {string|object} urlOrPayload
   * @param {{ force?: boolean, timeoutMs?: number }} opts
   * @returns {Promise<object|null>} saved metadata or null
   */
  function saveGeneratedVideoToGallery(urlOrPayload, opts) {
    opts = opts || {};
    var url = extractVideoUrl(urlOrPayload);
    if (!url) return Promise.resolve(null);
    if (!opts.force && isAlreadySaved(url)) {
      var m = String(url).match(/\/saved-videos\/(\d+)\.([a-z0-9]+)/i);
      return Promise.resolve({
        ok: true,
        already_saved: true,
        num: m ? parseInt(m[1], 10) : null,
        name: m ? m[1] + "." + m[2] : null,
        url: url.indexOf("http") === 0 ? url : absoluteUrl(url),
        path: m ? "saved-videos/" + m[1] + "." + m[2] : null,
      });
    }
    if (String(url).indexOf("data:") === 0) return Promise.resolve(null);

    var timeoutMs = opts.timeoutMs || 180000;

    function parseRes(r) {
      return r.json().then(function (d) {
        if (!r.ok || (d && d.ok === false)) {
          throw new Error((d && d.error) || "Save video failed (" + r.status + ")");
        }
        return d;
      });
    }

    if (String(url).indexOf("blob:") === 0) {
      return fetch(url)
        .then(function (r) {
          return r.blob();
        })
        .then(function (blob) {
          var form = new FormData();
          form.append(
            "file",
            blob,
            blob.type && blob.type.indexOf("mp4") >= 0 ? "clip.mp4" : "clip.webm"
          );
          form.append("force_mp4", "1");
          return fetch(apiUrl("/api/save-video"), { method: "POST", body: form });
        })
        .then(parseRes)
        .catch(function (err) {
          console.warn("[gallery-save-video] blob save failed", err);
          return null;
        });
    }

    return fetch(apiUrl("/api/save-video"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: absoluteUrl(url), force_mp4: true }),
    })
      .then(parseRes)
      .catch(function (err) {
        console.warn("[gallery-save-video] save failed", err);
        return null;
      });
  }

  /**
   * Prefer local saved URL from job payload / save result.
   */
  function preferSavedVideoUrl(payload, fallbackUrl) {
    if (payload && typeof payload === "object") {
      if (payload.saved && payload.saved.url) return absoluteUrl(payload.saved.url);
      if (payload.saved_video && payload.saved_video.url) {
        return absoluteUrl(payload.saved_video.url);
      }
      var vid = payload.video;
      if (vid && typeof vid === "object") {
        if (vid.saved && vid.saved.url) return absoluteUrl(vid.saved.url);
        if (vid.url && isAlreadySaved(vid.url)) return absoluteUrl(vid.url);
      }
      if (payload.url && isAlreadySaved(payload.url)) return absoluteUrl(payload.url);
    }
    var extracted = extractVideoUrl(payload);
    if (extracted && isAlreadySaved(extracted)) return absoluteUrl(extracted);
    return absoluteUrl(fallbackUrl || extracted || "");
  }

  window.GallerySaveVideo = {
    save: saveGeneratedVideoToGallery,
    preferSavedUrl: preferSavedVideoUrl,
    isAlreadySaved: isAlreadySaved,
    extractUrl: extractVideoUrl,
    absoluteUrl: absoluteUrl,
  };
})();
