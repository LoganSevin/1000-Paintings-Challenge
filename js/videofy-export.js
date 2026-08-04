/**
 * Videofy → MP4 export for TikTok (9:16), YouTube (16:9), and direct download.
 */
(function () {
  var CORE_VER = "0.12.6";
  var FFMPEG_VER = "0.12.10";
  var UTIL_VER = "0.12.1";

  var PRESETS = {
    tiktok: {
      outfile: "muralwalk-tiktok.mp4",
      uploadUrl: "https://www.tiktok.com/upload",
      label: "TikTok",
      vf:
        "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black",
    },
    youtube: {
      outfile: "muralwalk-youtube.mp4",
      uploadUrl: "https://www.youtube.com/upload",
      label: "YouTube",
      vf:
        "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black",
    },
    download: {
      outfile: "muralwalk-stasis.mp4",
      label: "MP4",
      vf: null,
    },
  };

  var SCRIPT_SOURCES = {
    util: [
      "js/vendor/ffmpeg/util.js",
      "https://cdn.jsdelivr.net/npm/@ffmpeg/util@" + UTIL_VER + "/dist/umd/index.js",
      "https://unpkg.com/@ffmpeg/util@" + UTIL_VER + "/dist/umd/index.js",
    ],
    ffmpeg: [
      "js/vendor/ffmpeg/ffmpeg.js",
      "https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@" + FFMPEG_VER + "/dist/umd/ffmpeg.js",
      "https://unpkg.com/@ffmpeg/ffmpeg@" + FFMPEG_VER + "/dist/umd/ffmpeg.js",
    ],
  };

  var CORE_BASES = [
    "js/vendor/ffmpeg/core",
    "https://cdn.jsdelivr.net/npm/@ffmpeg/core@" + CORE_VER + "/dist/umd",
    "https://unpkg.com/@ffmpeg/core@" + CORE_VER + "/dist/umd",
  ];

  var CODEC_TRIES = [
    { v: "libx264", extra: ["-preset", "fast", "-crf", "23", "-pix_fmt", "yuv420p"] },
    { v: "mpeg4", extra: ["-q:v", "5", "-pix_fmt", "yuv420p"] },
  ];

  var ffmpeg = null;
  var loadPromise = null;

  function resolveUrl(src) {
    if (/^https?:\/\//i.test(src)) return src;
    try {
      return new URL(src, document.baseURI || window.location.href).href;
    } catch (err) {
      return src;
    }
  }

  function loadScriptOne(src) {
    var url = resolveUrl(src);
    return new Promise(function (resolve, reject) {
      if (document.querySelector('script[src="' + url + '"]')) {
        resolve(url);
        return;
      }
      var s = document.createElement("script");
      s.src = url;
      s.async = true;
      s.onload = function () {
        resolve(url);
      };
      s.onerror = function () {
        reject(new Error("Could not load " + url));
      };
      document.head.appendChild(s);
    });
  }

  function loadScriptFromList(name, sources) {
    var list = sources.slice();
    function tryNext(err) {
      if (!list.length) {
        return Promise.reject(
          err ||
            new Error(
              "Could not load video encoder (" +
                name +
                "). Check your connection and try again."
            )
        );
      }
      return loadScriptOne(list.shift()).catch(function (nextErr) {
        return tryNext(nextErr);
      });
    }
    return tryNext();
  }

  function loadCoreBlobUrls(onStatus) {
    var idx = 0;
    function tryBase() {
      if (idx >= CORE_BASES.length) {
        return Promise.reject(new Error("Could not load video encoder core."));
      }
      var base = resolveUrl(CORE_BASES[idx++]);
      if (onStatus) onStatus("Loading video encoder core…", true);
      return FFmpegUtil.toBlobURL(base + "/ffmpeg-core.js", "text/javascript")
        .then(function (coreURL) {
          return FFmpegUtil.toBlobURL(base + "/ffmpeg-core.wasm", "application/wasm").then(function (wasmURL) {
            return { coreURL: coreURL, wasmURL: wasmURL };
          });
        })
        .catch(function () {
          return tryBase();
        });
    }
    return tryBase();
  }

  function ensureFfmpeg(onStatus) {
    if (ffmpeg && ffmpeg.loaded) return Promise.resolve(ffmpeg);
    if (loadPromise) return loadPromise;
    loadPromise = loadScriptFromList("util", SCRIPT_SOURCES.util)
      .then(function () {
        return loadScriptFromList("ffmpeg", SCRIPT_SOURCES.ffmpeg);
      })
      .then(function () {
        if (!window.FFmpegWASM || !window.FFmpegUtil) {
          throw new Error("Video encoder failed to initialize.");
        }
        if (onStatus) onStatus("Loading video encoder (first export may take a moment)…", true);
        ffmpeg = new FFmpegWASM.FFmpeg();
        ffmpeg.on("progress", function (ev) {
          var p = ev && ev.progress != null ? ev.progress : 0;
          if (onStatus && p > 0) {
            onStatus("Encoding MP4… " + Math.round(p * 100) + "%", true);
          }
        });
        return loadCoreBlobUrls(onStatus).then(function (urls) {
          return ffmpeg.load(urls);
        });
      })
      .then(function () {
        return ffmpeg;
      })
      .catch(function (err) {
        loadPromise = null;
        throw err;
      });
    return loadPromise;
  }

  function blobFromFfmpegData(data) {
    if (data instanceof Uint8Array) {
      return new Blob([data], { type: "video/mp4" });
    }
    if (data && data.buffer) {
      return new Blob([data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)], {
        type: "video/mp4",
      });
    }
    return new Blob([data], { type: "video/mp4" });
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 8000);
  }

  function tryNativeShare(file, title) {
    if (!navigator.share || !navigator.canShare) return Promise.resolve(false);
    try {
      if (!navigator.canShare({ files: [file] })) return Promise.resolve(false);
      return navigator
        .share({
          files: [file],
          title: title || "Muralwalk stasis",
          text: "Muralwalk stasis video",
        })
        .then(function () {
          return true;
        })
        .catch(function () {
          return false;
        });
    } catch (err) {
      return Promise.resolve(false);
    }
  }

  function buildEncodeArgs(preset, codecTry) {
    var args = ["-y", "-i", "input.webm"];
    if (preset.vf) {
      args.push("-vf", preset.vf);
    }
    args.push("-c:v", codecTry.v);
    args = args.concat(codecTry.extra);
    args.push("-movflags", "+faststart", "-an", preset.outfile);
    return args;
  }

  function runEncode(preset, onStatus) {
    var codecIdx = 0;
    function tryCodec(err) {
      if (codecIdx >= CODEC_TRIES.length) {
        return Promise.reject(err || new Error("MP4 encoding failed."));
      }
      var codecTry = CODEC_TRIES[codecIdx++];
      if (onStatus && codecIdx > 1) {
        onStatus("Retrying MP4 encode…", true);
      }
      return ffmpeg
        .exec(buildEncodeArgs(preset, codecTry))
        .then(function () {
          return ffmpeg.readFile(preset.outfile);
        })
        .catch(function (nextErr) {
          return tryCodec(nextErr);
        });
    }
    return tryCodec();
  }

  function convertWebmToMp4(blob, presetKey, opts) {
    opts = opts || {};
    var preset = PRESETS[presetKey] || PRESETS.download;
    if (!blob) return Promise.reject(new Error("Nothing to convert."));
    var onStatus = opts.onStatus || function () {};

    return ensureFfmpeg(onStatus)
      .then(function () {
        onStatus("Converting to " + preset.label + "…", true);
        return FFmpegUtil.fetchFile(blob);
      })
      .then(function (data) {
        return ffmpeg.writeFile("input.webm", data).then(function () {
          return runEncode(preset, onStatus);
        });
      })
      .then(function (data) {
        return blobFromFfmpegData(data);
      });
  }

  function exportPlatform(platform, blob, opts) {
    opts = opts || {};
    var preset = PRESETS[platform];
    if (!preset || !blob) return Promise.reject(new Error("Nothing to export."));
    var onStatus = opts.onStatus || function () {};

    return convertWebmToMp4(blob, platform, opts)
      .then(function (mp4) {
        var file = new File([mp4], preset.outfile, { type: "video/mp4" });
        return tryNativeShare(file, opts.title).then(function (shared) {
          if (!shared) downloadBlob(mp4, preset.outfile);
          window.open(preset.uploadUrl, "_blank", "noopener,noreferrer");
          onStatus(
            shared
              ? preset.label + " share opened — pick " + preset.label + " if it appears."
              : "MP4 saved — upload it on the " + preset.label + " page that just opened.",
            true
          );
        });
      });
  }

  function toMp4(blob, opts) {
    return convertWebmToMp4(blob, "download", opts || {});
  }

  function prefetch(onStatus) {
    return ensureFfmpeg(onStatus || function () {}).catch(function () {});
  }

  window.VideofyExport = {
    export: exportPlatform,
    toMp4: toMp4,
    prefetch: prefetch,
    presets: PRESETS,
  };
})();