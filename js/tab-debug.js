/**
 * Tab Debug — secondary Work/Debug sub-tabs + API payload inspector.
 * Shows string/number field lengths so base64 image blobs are visible as size, not "encrypted" mystery.
 */
(function () {
  "use strict";

  var MAX_PER_TAB = 40;
  var MAX_GLOBAL = 200;
  var BASE64_PREVIEW = 96;
  var LONG_STRING = 200;
  /** Keep full base64 for the ASCII wall viewer (cap avoids runaway memory) */
  var MAX_RAW_CHARS = 12 * 1024 * 1024;

  var state = {
    activeTab: "gallery",
    mode: "work", // work | debug
    logsByTab: {},
    globalLogs: [],
    selectedId: "",
    interceptOn: true,
    /** payloads = POST/PUT/PATCH with body; all = include non-noise GET traffic */
    listFilter: "payloads",
    /** all = every top-level tab; current = only the active site tab */
    tabScope: "all",
  };

  /** Always skip — high-frequency folder/list polls that drown the log.
   *  Note: /api/jobs/ is NOT skipped — completed jobs carry the generated image URL. */
  var ALWAYS_SKIP_URL =
    /\/api\/acquired-images|\/api\/aquired-images|\/api\/health|proxy-media/i;
  var JOB_URL_RE = /\/api\/jobs\//i;
  var MAX_RESPONSE_STORE = 512 * 1024;

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatBytes(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    return (n / (1024 * 1024)).toFixed(2) + " MB";
  }

  function looksLikeDataUrl(s) {
    return /^data:[^;]+;base64,/i.test(s);
  }

  function looksLikeBase64Blob(s) {
    if (typeof s !== "string" || s.length < LONG_STRING) return false;
    if (looksLikeDataUrl(s)) return true;
    var sample = s.slice(0, 400).replace(/\s/g, "");
    return sample.length > 80 && /^[A-Za-z0-9+/=]+$/.test(sample);
  }

  function truncateMiddle(s, keep) {
    keep = keep || BASE64_PREVIEW;
    s = String(s || "");
    if (s.length <= keep * 2 + 20) return s;
    return s.slice(0, keep) + " …[" + (s.length - keep * 2) + " chars omitted]… " + s.slice(-keep);
  }

  function classifyValue(value) {
    if (value == null) return { kind: "null", chars: 0, preview: "null" };
    if (typeof value === "number") {
      return { kind: "number", chars: String(value).length, preview: String(value) };
    }
    if (typeof value === "boolean") {
      return { kind: "boolean", chars: value ? 4 : 5, preview: String(value) };
    }
    if (typeof value === "string") {
      var chars = value.length;
      if (looksLikeDataUrl(value)) {
        var mime = (value.match(/^data:([^;]+)/) || [])[1] || "image";
        return {
          kind: "base64-image",
          chars: chars,
          preview: truncateMiddle(value, 48),
          raw: chars > MAX_RAW_CHARS ? value.slice(0, MAX_RAW_CHARS) : value,
          rawTruncated: chars > MAX_RAW_CHARS,
          note:
            "Not encryption — base64-encoded image (" +
            mime +
            "). ~" +
            formatBytes(Math.floor(chars * 0.75)) +
            " binary after decode. Dominates request size. Decoded as colored 2×3 ASCII above.",
        };
      }
      if (looksLikeBase64Blob(value)) {
        return {
          kind: "base64-blob",
          chars: chars,
          preview: truncateMiddle(value, 48),
          raw: chars > MAX_RAW_CHARS ? value.slice(0, MAX_RAW_CHARS) : value,
          rawTruncated: chars > MAX_RAW_CHARS,
          note: "Long base64-like string — usually an image payload. Decoded as colored 2×3 ASCII above when possible.",
        };
      }
      return {
        kind: "text",
        chars: chars,
        preview: chars > 400 ? value.slice(0, 400) + "…" : value,
        note: chars > 2000 ? "Long text field — counts fully toward prompt/API limits." : "",
      };
    }
    if (Array.isArray(value)) {
      var jsonA = "";
      try {
        jsonA = JSON.stringify(value);
      } catch (eA) {
        jsonA = String(value);
      }
      return {
        kind: "array",
        chars: jsonA.length,
        preview: "Array(" + value.length + ") · " + formatBytes(jsonA.length),
        note: value.length ? "Array of " + value.length + " item(s)" : "Empty array",
      };
    }
    if (typeof value === "object") {
      var jsonO = "";
      try {
        jsonO = JSON.stringify(value);
      } catch (eO) {
        jsonO = "{}";
      }
      return {
        kind: "object",
        chars: jsonO.length,
        preview: "Object · " + formatBytes(jsonO.length),
        note: "",
      };
    }
    return { kind: typeof value, chars: String(value).length, preview: String(value) };
  }

  function walkFields(obj, prefix, out, depth) {
    depth = depth || 0;
    if (depth > 6 || obj == null) return;
    if (typeof obj !== "object") {
      var leaf = classifyValue(obj);
      leaf.path = prefix || "(root)";
      out.push(leaf);
      return;
    }
    if (Array.isArray(obj)) {
      var arrMeta = classifyValue(obj);
      arrMeta.path = prefix || "(root)";
      out.push(arrMeta);
      if (obj.length && obj.length <= 12) {
        obj.forEach(function (item, i) {
          if (item != null && typeof item === "object") {
            walkFields(item, prefix + "[" + i + "]", out, depth + 1);
          } else {
            var itemMeta = classifyValue(item);
            itemMeta.path = prefix + "[" + i + "]";
            out.push(itemMeta);
          }
        });
      }
      return;
    }
    Object.keys(obj).forEach(function (key) {
      var path = prefix ? prefix + "." + key : key;
      var val = obj[key];
      if (val != null && typeof val === "object" && !Array.isArray(val) && !looksLikeBase64Blob(String(val))) {
        var nest = classifyValue(val);
        nest.path = path;
        out.push(nest);
        walkFields(val, path, out, depth + 1);
      } else {
        var meta = classifyValue(val);
        meta.path = path;
        out.push(meta);
      }
    });
  }

  function analyzeBody(rawBody, meta) {
    meta = meta || {};
    var result = {
      rawChars: 0,
      parseOk: false,
      fields: [],
      topHeavy: [],
      summary: "",
      emptyReason: "",
    };
    if (rawBody == null || rawBody === "") {
      if (meta.method === "GET" || meta.method === "HEAD") {
        result.summary = "No request body (normal for " + meta.method + " / job polling)";
        result.emptyReason =
          "GET/HEAD calls do not send JSON. Open a POST like /api/generate-stasis-vision or /api/animate-cast to inspect prompts and images.";
      } else if (meta.method === "POST" || meta.method === "PUT" || meta.method === "PATCH") {
        result.summary = "Empty body — capture missed the payload";
        result.emptyReason =
          "This method should have a body. Try Clear, stay on Work while forging, then re-check Debug. Prefer “Payloads only” filter.";
      } else {
        result.summary = "Empty body";
        result.emptyReason = "No body was attached to this request.";
      }
      return result;
    }
    var text = typeof rawBody === "string" ? rawBody : "";
    if (!text && rawBody && typeof rawBody === "object") {
      try {
        text = JSON.stringify(rawBody);
      } catch (e) {
        text = String(rawBody);
      }
    }
    result.rawChars = text.length;
    var parsed = null;
    try {
      parsed = JSON.parse(text);
      result.parseOk = true;
    } catch (eParse) {
      result.parseOk = false;
      var blob = classifyValue(text);
      blob.path = "(raw body)";
      result.fields = [blob];
      result.summary = "Non-JSON body · " + formatBytes(text.length);
      return result;
    }
    walkFields(parsed, "", result.fields, 0);
    result.fields.sort(function (a, b) {
      return (b.chars || 0) - (a.chars || 0);
    });
    result.topHeavy = result.fields.slice(0, 8);
    var heavy = result.topHeavy
      .filter(function (f) {
        return f.chars > 500;
      })
      .map(function (f) {
        return f.path + " (" + formatBytes(f.chars) + ", " + f.kind + ")";
      });
    result.summary =
      formatBytes(result.rawChars) +
      " total · " +
      result.fields.length +
      " field path(s)" +
      (heavy.length ? " · heaviest: " + heavy.slice(0, 3).join(", ") : "");
    return result;
  }

  function currentTab() {
    return (
      document.body.getAttribute("data-active-tab") ||
      state.activeTab ||
      "gallery"
    );
  }

  function ensureTabLog(tab) {
    if (!state.logsByTab[tab]) state.logsByTab[tab] = [];
    return state.logsByTab[tab];
  }

  function pushLog(entry) {
    entry.id = "dbg-" + Date.now() + "-" + Math.floor(Math.random() * 1e6);
    entry.at = Date.now();
    entry.tab = entry.tab || currentTab();
    var list = ensureTabLog(entry.tab);
    list.unshift(entry);
    if (list.length > MAX_PER_TAB) list.length = MAX_PER_TAB;
    state.globalLogs.unshift(entry);
    if (state.globalLogs.length > MAX_GLOBAL) state.globalLogs.length = MAX_GLOBAL;
    if (!state.selectedId) state.selectedId = entry.id;
    if (state.mode === "debug" && shouldRefreshForEntry(entry)) renderDebug();
    return entry;
  }

  function shouldRefreshForEntry(entry) {
    if (!entry) return false;
    if (state.tabScope === "all") return true;
    return entry.tab === currentTab();
  }

  function cloneRequestBody(body) {
    if (body == null || body === "") return Promise.resolve("");
    if (typeof body === "string") return Promise.resolve(body);
    if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) {
      return Promise.resolve(body.toString());
    }
    if (typeof ArrayBuffer !== "undefined" && body instanceof ArrayBuffer) {
      try {
        return Promise.resolve(new TextDecoder().decode(body));
      } catch (eAb) {
        return Promise.resolve("[ArrayBuffer " + body.byteLength + " bytes]");
      }
    }
    if (typeof Uint8Array !== "undefined" && body instanceof Uint8Array) {
      try {
        return Promise.resolve(new TextDecoder().decode(body));
      } catch (eU8) {
        return Promise.resolve("[Uint8Array " + body.byteLength + " bytes]");
      }
    }
    if (typeof Blob !== "undefined" && body instanceof Blob) {
      return body.text().catch(function () {
        return "[Blob " + (body.size || 0) + " bytes]";
      });
    }
    if (typeof FormData !== "undefined" && body instanceof FormData) {
      var parts = [];
      body.forEach(function (v, k) {
        if (typeof v === "string") {
          parts.push(k + "=" + (v.length > 400 ? v.slice(0, 400) + "…" : v));
        } else {
          parts.push(k + "=[file/blob]");
        }
      });
      return Promise.resolve(JSON.stringify({ _formData: parts }));
    }
    if (typeof ReadableStream !== "undefined" && body instanceof ReadableStream) {
      return Promise.resolve("[ReadableStream body — not inspectable without consuming]");
    }
    try {
      return Promise.resolve(JSON.stringify(body));
    } catch (e) {
      return Promise.resolve(String(body));
    }
  }

  function extractBodyText(input, init) {
    init = init || {};
    if (init.body != null && init.body !== "") {
      return cloneRequestBody(init.body);
    }
    if (typeof Request !== "undefined" && input instanceof Request) {
      try {
        return input
          .clone()
          .text()
          .catch(function () {
            return "";
          });
      } catch (eReq) {
        return Promise.resolve("");
      }
    }
    return Promise.resolve("");
  }

  function isAlwaysSkipUrl(url) {
    return ALWAYS_SKIP_URL.test(String(url || ""));
  }

  function isJobUrl(url) {
    return JOB_URL_RE.test(String(url || ""));
  }

  function shouldCapture(url, method) {
    var u = String(url || "");
    if (!u) return false;
    if (isAlwaysSkipUrl(u)) return false;
    var m = String(method || "GET").toUpperCase();
    // Job polls: always watch when capture is on (only *log* completed ones with images)
    if (isJobUrl(u)) return true;
    var isApi =
      u.indexOf("/api/") >= 0 || /generate-stasis|animate-cast/i.test(u);
    if (!isApi) return false;
    // Default: only store payload methods so folder polls never spam the log
    if (state.listFilter === "payloads") {
      if (m === "GET" || m === "HEAD") return false;
    }
    return true;
  }

  function isNoiseCall(entry) {
    if (!entry) return false;
    if (isAlwaysSkipUrl(entry.url)) return true;
    if (entry.isGeneratedResult) return false;
    if (entry.responseImages && entry.responseImages.length) return false;
    if (entry.method === "GET" || entry.method === "HEAD") return true;
    return false;
  }

  function isPayloadCall(entry) {
    if (!entry) return false;
    if (entry.method === "LOG") return true;
    if (entry.isGeneratedResult) return true;
    if (entry.responseImages && entry.responseImages.length) return true;
    if (entry.method === "POST" || entry.method === "PUT" || entry.method === "PATCH") {
      return true;
    }
    return false;
  }

  function looksLikeImageUrl(s) {
    if (typeof s !== "string" || s.length < 4 || s.length > 4000) return false;
    if (looksLikeDataUrl(s)) return true;
    if (/^https?:\/\//i.test(s) && /\.(png|jpe?g|webp|gif|bmp)(\?|#|$)/i.test(s)) return true;
    if (/^\/(generated|paintings|api|static|media|uploads|proxy)/i.test(s)) return true;
    if (/\/generated\/\d+/i.test(s)) return true;
    if (/\.(png|jpe?g|webp|gif)(\?|#|$)/i.test(s) && (s.indexOf("/") >= 0 || s.indexOf("http") === 0))
      return true;
    return false;
  }

  function resolveMediaUrl(u) {
    if (!u) return "";
    if (looksLikeDataUrl(u)) return u;
    if (/^https?:\/\//i.test(u) || u.indexOf("//") === 0) {
      if (u.indexOf("//") === 0) return window.location.protocol + u;
      return u;
    }
    if (u.charAt(0) === "/") {
      return window.location.origin + u;
    }
    try {
      return new URL(u, window.location.href).href;
    } catch (e) {
      return u;
    }
  }

  /**
   * Walk JSON for image.url / images[].url / string fields that look like media paths.
   */
  function walkImageRefs(obj, prefix, out, depth, seen) {
    depth = depth || 0;
    seen = seen || {};
    if (obj == null || depth > 8) return;
    if (typeof obj === "string") {
      if (!looksLikeImageUrl(obj) && !looksLikeDataUrl(obj) && !looksLikeBase64Blob(obj)) return;
      var key = obj.slice(0, 120);
      if (seen[key]) return;
      seen[key] = true;
      out.push({
        path: prefix || "(url)",
        url: looksLikeDataUrl(obj)
          ? obj
          : looksLikeBase64Blob(obj) && !looksLikeImageUrl(obj)
            ? "data:image/jpeg;base64," + obj.replace(/\s+/g, "")
            : obj,
        kind: looksLikeDataUrl(obj) || looksLikeBase64Blob(obj) ? "base64-image" : "image-url",
        role: "unknown",
      });
      return;
    }
    if (Array.isArray(obj)) {
      obj.forEach(function (item, i) {
        walkImageRefs(item, prefix + "[" + i + "]", out, depth + 1, seen);
      });
      return;
    }
    if (typeof obj !== "object") return;
    Object.keys(obj).forEach(function (k) {
      var path = prefix ? prefix + "." + k : k;
      var val = obj[k];
      var kl = k.toLowerCase();
      if (
        (kl === "url" || kl === "image_url" || kl === "src" || kl === "href" || kl.indexOf("image") >= 0) &&
        typeof val === "string" &&
        (looksLikeImageUrl(val) || looksLikeDataUrl(val) || looksLikeBase64Blob(val))
      ) {
        walkImageRefs(val, path, out, depth + 1, seen);
      } else if (val != null && typeof val === "object") {
        walkImageRefs(val, path, out, depth + 1, seen);
      } else if (typeof val === "string" && (looksLikeDataUrl(val) || (looksLikeImageUrl(val) && val.length > 12))) {
        walkImageRefs(val, path, out, depth + 1, seen);
      }
    });
  }

  function extractImagesFromResponseText(respText) {
    var out = [];
    if (!respText || typeof respText !== "string") return out;
    var dataUrls = extractDataUrlsFromText(respText);
    dataUrls.forEach(function (d) {
      out.push({
        path: d.path,
        url: d.raw,
        kind: "base64-image",
        role: "generated",
        chars: d.chars,
      });
    });
    try {
      var parsed = JSON.parse(respText);
      var refs = [];
      walkImageRefs(parsed, "", refs, 0, {});
      refs.forEach(function (r) {
        var already = out.some(function (x) {
          return x.url === r.url || (x.url && r.url && x.url.slice(0, 80) === r.url.slice(0, 80));
        });
        if (already) return;
        out.push({
          path: r.path,
          url: r.url,
          kind: r.kind,
          role: "generated",
          chars: (r.url && r.url.length) || 0,
        });
      });
    } catch (eParse) {
      /* non-JSON */
    }
    return out.slice(0, 8);
  }

  function extractJobIdFromText(text) {
    if (!text) return "";
    try {
      var j = JSON.parse(text);
      if (j && j.job_id) return String(j.job_id);
      if (j && j.id && isJobUrl(String(j.id))) return String(j.id);
    } catch (e) {}
    var m = String(text).match(/"job_id"\s*:\s*"([^"]+)"/);
    return m ? m[1] : "";
  }

  function applyResponseImages(entry, respText) {
    if (!entry) return;
    var text = respText || "";
    entry.responseChars = text.length;
    entry.responsePreview = truncateMiddle(text, 160);
    if (text.length <= MAX_RESPONSE_STORE) {
      entry.responseBody = text;
    } else {
      entry.responseBody = text.slice(0, MAX_RESPONSE_STORE);
    }
    var imgs = extractImagesFromResponseText(text);
    if (imgs.length) {
      entry.responseImages = imgs;
      entry.hasGeneratedImage = true;
    }
    var jobId = extractJobIdFromText(text) || extractJobIdFromText(entry.requestBody);
    if (jobId) entry.jobId = jobId;
  }

  /** When a job finishes, also stamp the generated image onto the original POST that started it. */
  function attachGeneratedToRelatedPosts(images, jobId, respText, tab) {
    if (!images || !images.length) return;
    var id = jobId || extractJobIdFromText(respText);
    if (!id) return;
    var changed = false;
    state.globalLogs.forEach(function (e) {
      if (!e || e.isGeneratedResult) return;
      var match = false;
      if (e.jobId && e.jobId === id) match = true;
      if (e.requestBody && e.requestBody.indexOf(id) >= 0) match = true;
      if (e.responseBody && e.responseBody.indexOf(id) >= 0) match = true;
      if (!match) return;
      e.responseImages = images.slice();
      e.hasGeneratedImage = true;
      e.jobId = id;
      if (respText) {
        e.responseBody =
          respText.length <= MAX_RESPONSE_STORE ? respText : respText.slice(0, MAX_RESPONSE_STORE);
        e.responsePreview = truncateMiddle(respText, 160);
        e.responseChars = respText.length;
      }
      changed = true;
    });
    if (changed && state.mode === "debug") renderDebug();
  }

  function installFetchHook() {
    if (window.__tabDebugFetchHooked || typeof window.fetch !== "function") return;
    window.__tabDebugFetchHooked = true;
    var nativeFetch = window.fetch.bind(window);

    window.fetch = function (input, init) {
      var opts = init;
      if (opts == null) opts = undefined;
      var url = "";
      var method = "GET";
      try {
        if (typeof input === "string") url = input;
        else if (input && input.url) url = input.url;
      } catch (eUrl) {
        url = String(input || "");
      }
      try {
        method = String((opts && opts.method) || (input && input.method) || "GET").toUpperCase();
      } catch (eMethod) {
        method = "GET";
      }

      var started = Date.now();
      var tab = currentTab();
      var intercept = state.interceptOn && !isAlwaysSkipUrl(url);

      // Job polls: never spam — only log when status=done and an image URL is present
      if (intercept && isJobUrl(url)) {
        var jobFetch = opts === undefined ? nativeFetch(input) : nativeFetch(input, opts);
        return jobFetch.then(function (res) {
          if (!state.interceptOn) return res;
          var clone = res.clone();
          return clone
            .text()
            .then(function (respText) {
              var imgs = extractImagesFromResponseText(respText);
              var status = "";
              var jobId = "";
              try {
                var j = JSON.parse(respText);
                status = String((j && j.status) || "");
                jobId = j && (j.job_id || j.id) ? String(j.job_id || j.id) : "";
              } catch (eJ) {}
              var done = /^(done|completed|success|succeeded)$/i.test(status);
              if (done && imgs.length) {
                imgs.forEach(function (im) {
                  im.role = "generated";
                });
                var mJob = String(url).match(/\/api\/jobs\/([^/?#]+)/i);
                if (mJob && !jobId) jobId = decodeURIComponent(mJob[1]);
                attachGeneratedToRelatedPosts(imgs, jobId, respText, tab);
                var entry = {
                  tab: tab,
                  method: "GET",
                  url: url,
                  status: res.status,
                  ok: res.ok,
                  ms: Date.now() - started,
                  requestChars: 0,
                  requestBody: "",
                  requestAnalysis: analyzeBody("", { method: "GET" }),
                  responseChars: (respText || "").length,
                  responseBody:
                    (respText || "").length <= MAX_RESPONSE_STORE
                      ? respText
                      : (respText || "").slice(0, MAX_RESPONSE_STORE),
                  responsePreview: truncateMiddle(respText || "", 160),
                  responseImages: imgs,
                  hasGeneratedImage: true,
                  isGeneratedResult: true,
                  jobId: jobId,
                  error: "",
                  hasBody: false,
                  noise: false,
                };
                pushLog(entry);
              }
              return res;
            })
            .catch(function () {
              return res;
            });
        });
      }

      var capture = intercept && shouldCapture(url, method);
      if (!capture) {
        return opts === undefined ? nativeFetch(input) : nativeFetch(input, opts);
      }

      return extractBodyText(input, opts || {}).then(function (bodyText) {
        var analysis = analyzeBody(bodyText, { method: method });
        var entry = {
          tab: tab,
          method: method,
          url: url,
          status: 0,
          ok: false,
          ms: 0,
          requestChars: analysis.rawChars,
          requestBody: typeof bodyText === "string" ? bodyText : "",
          requestAnalysis: analysis,
          responseChars: 0,
          responsePreview: "",
          responseBody: "",
          responseImages: [],
          error: "",
          hasBody: !!(bodyText && bodyText.length),
          noise: false,
          jobId: extractJobIdFromText(bodyText),
        };
        entry.noise = isNoiseCall(entry) && !entry.hasBody;
        pushLog(entry);

        var fetchPromise =
          opts === undefined ? nativeFetch(input) : nativeFetch(input, opts);

        return fetchPromise
          .then(function (res) {
            entry.status = res.status;
            entry.ok = res.ok;
            entry.ms = Date.now() - started;
            var clone = res.clone();
            return clone
              .text()
              .then(function (respText) {
                applyResponseImages(entry, respText);
                if (entry.responseImages && entry.responseImages.length) {
                  entry.responseImages.forEach(function (im) {
                    im.role = "generated";
                  });
                }
                if (state.mode === "debug" && shouldRefreshForEntry(entry)) renderDebug();
                return res;
              })
              .catch(function () {
                if (state.mode === "debug" && shouldRefreshForEntry(entry)) renderDebug();
                return res;
              });
          })
          .catch(function (err) {
            entry.error = (err && err.message) || String(err);
            entry.ms = Date.now() - started;
            if (state.mode === "debug" && shouldRefreshForEntry(entry)) renderDebug();
            throw err;
          });
      });
    };
  }

  function logsForActiveTab() {
    return ensureTabLog(currentTab());
  }

  function logsForScope() {
    purgeAlwaysSkipLogs();
    if (state.tabScope === "current") return logsForActiveTab().slice();
    return state.globalLogs.slice();
  }

  function tabsWithCaptures() {
    var seen = {};
    var names = [];
    state.globalLogs.forEach(function (e) {
      if (!e || !e.tab || seen[e.tab]) return;
      seen[e.tab] = true;
      names.push(e.tab);
    });
    return names.sort();
  }

  function purgeAlwaysSkipLogs() {
    Object.keys(state.logsByTab).forEach(function (tab) {
      state.logsByTab[tab] = (state.logsByTab[tab] || []).filter(function (e) {
        return e && !isAlwaysSkipUrl(e.url);
      });
    });
    state.globalLogs = state.globalLogs.filter(function (e) {
      return e && !isAlwaysSkipUrl(e.url);
    });
  }

  function filteredLogsForScope() {
    var logs = logsForScope();
    if (state.listFilter === "all") return logs;
    var payloads = logs.filter(isPayloadCall);
    if (payloads.length) return payloads;
    // Fall back so the user still sees something if only polls exist
    return logs;
  }

  function findLog(id) {
    var i;
    for (i = 0; i < state.globalLogs.length; i++) {
      if (state.globalLogs[i].id === id) return state.globalLogs[i];
    }
    return null;
  }

  function setMode(mode) {
    state.mode = mode === "debug" ? "debug" : "work";
    document.body.classList.toggle("tab-debug-mode", state.mode === "debug");
    var workBtn = $("site-subtab-work");
    var debugBtn = $("site-subtab-debug");
    if (workBtn) workBtn.classList.toggle("active", state.mode === "work");
    if (debugBtn) debugBtn.classList.toggle("active", state.mode === "debug");
    var host = $("tab-debug-host");
    if (host) host.hidden = state.mode !== "debug";
    updateSubtabLabel();
    if (state.mode === "debug") renderDebug();
  }

  function updateSubtabLabel() {
    var label = $("site-subtabs-label");
    if (!label) return;
    var tab = currentTab();
    var n =
      state.tabScope === "all" || state.mode === "debug"
        ? state.globalLogs.length
        : ensureTabLog(tab).length;
    var scopeBit =
      state.mode === "debug"
        ? state.tabScope === "all"
          ? "all tabs"
          : tab
        : tab;
    label.textContent =
      scopeBit +
      (state.mode === "debug" ? " · Debug" : " · Work") +
      " · " +
      n +
      " API call" +
      (n === 1 ? "" : "s") +
      " captured";
  }

  function setActiveTab(tab) {
    state.activeTab = tab || "gallery";
    updateSubtabLabel();
    // Stay on the same debug view when switching site tabs (scope=all keeps full list)
    if (state.mode === "debug") renderDebug();
  }

  function clearScopedLogs() {
    if (state.tabScope === "all") {
      state.logsByTab = {};
      state.globalLogs = [];
    } else {
      var tab = currentTab();
      var keep = [];
      state.globalLogs.forEach(function (e) {
        if (e && e.tab !== tab) keep.push(e);
      });
      state.globalLogs = keep;
      state.logsByTab[tab] = [];
    }
    state.selectedId = "";
    renderDebug();
    updateSubtabLabel();
  }

  function kindBadge(kind) {
    return '<span class="tab-debug-kind tab-debug-kind-' + escapeHtml(kind) + '">' + escapeHtml(kind) + "</span>";
  }

  function renderFieldRows(fields, totalChars) {
    if (!fields || !fields.length) {
      return '<tr><td colspan="4">No fields</td></tr>';
    }
    return fields
      .map(function (f) {
        var pct = totalChars > 0 ? ((f.chars / totalChars) * 100).toFixed(1) : "0.0";
        return (
          "<tr>" +
          "<td><code>" +
          escapeHtml(f.path) +
          "</code></td>" +
          "<td>" +
          kindBadge(f.kind) +
          "</td>" +
          "<td class=\"tab-debug-num\">" +
          escapeHtml(String(f.chars)) +
          " <span class=\"tab-debug-muted\">(" +
          escapeHtml(formatBytes(f.chars)) +
          " · " +
          pct +
          "%)</span></td>" +
          "<td class=\"tab-debug-preview\">" +
          escapeHtml(f.preview || "") +
          (f.note ? '<div class="tab-debug-note">' + escapeHtml(f.note) + "</div>" : "") +
          "</td>" +
          "</tr>"
        );
      })
      .join("");
  }

  function asciiFieldsFrom(fields) {
    return (fields || []).filter(function (f) {
      return f && (f.kind === "base64-image" || f.kind === "base64-blob");
    });
  }

  /**
   * Classic sparse density ramp (dark bg → more ink as pixels get brighter).
   * Stays in the ". : " family — not dense @#% walls.
   */
  var ASCII_RAMP = " .':;-+=";
  var PARCEL_W = 2;
  var PARCEL_H = 3;
  var ASCII_MAX_COLS = 120;
  var ASCII_CHAR_PX_W = 8;
  var ASCII_CHAR_PX_H = 12;

  /**
   * Pull data:image…;base64,… out of raw JSON text when field walk missed them.
   */
  function extractDataUrlsFromText(text) {
    var out = [];
    if (!text || typeof text !== "string") return out;
    var re = /data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\r\n]+/g;
    var m;
    var seen = {};
    while ((m = re.exec(text)) !== null) {
      var s = m[0].replace(/\s+/g, "");
      if (s.length < 80 || seen[s.slice(0, 64)]) continue;
      seen[s.slice(0, 64)] = true;
      out.push({
        path: "(extracted data URL #" + (out.length + 1) + ")",
        kind: "base64-image",
        chars: s.length,
        raw: s.length > MAX_RAW_CHARS ? s.slice(0, MAX_RAW_CHARS) : s,
        rawTruncated: s.length > MAX_RAW_CHARS,
        note: "Found inside request body text.",
      });
      if (out.length >= 6) break;
    }
    return out;
  }

  /**
   * Images for ASCII art — prefer GENERATED (response / job) over input stock base64.
   * Returns { src, path, role, kind, chars } with src loadable by <img>.
   */
  function resolveImagePayloads(entry) {
    if (!entry) return [];
    var out = [];
    var seen = {};

    function pushItem(item) {
      if (!item || !item.src) return;
      var key = item.src.slice(0, 160);
      if (seen[key]) return;
      seen[key] = true;
      out.push(item);
    }

    // 1) Generated results from response / completed job (what the user wants)
    var respImgs = entry.responseImages || [];
    if (!respImgs.length && entry.responseBody) {
      respImgs = extractImagesFromResponseText(entry.responseBody);
    }
    respImgs.forEach(function (im) {
      var src = resolveMediaUrl(im.url || im.raw || "");
      if (!src) return;
      pushItem({
        path: "generated · " + (im.path || "image"),
        src: src,
        role: "generated",
        kind: im.kind || "image-url",
        chars: im.chars || (im.url && im.url.length) || 0,
        raw: looksLikeDataUrl(src) ? src : "",
      });
    });

    // 2) Request input images (stock / reference) — secondary
    var fields = (entry.requestAnalysis && entry.requestAnalysis.fields) || [];
    asciiFieldsFrom(fields).forEach(function (f) {
      if (!f.raw || f.raw.length < 40) return;
      var src = toLoadableSrc(f.raw);
      if (!src) return;
      pushItem({
        path: "input · " + (f.path || "reference"),
        src: src,
        role: "input",
        kind: f.kind || "base64-image",
        chars: f.chars || f.raw.length,
        raw: f.raw,
      });
    });
    var body = entry.requestBody || "";
    if (body) {
      extractDataUrlsFromText(body).forEach(function (d) {
        pushItem({
          path: "input · " + (d.path || "data URL"),
          src: d.raw,
          role: "input",
          kind: "base64-image",
          chars: d.chars,
          raw: d.raw,
        });
      });
      try {
        var parsed = JSON.parse(body);
        var refs = [];
        walkImageRefs(parsed, "", refs, 0, {});
        refs.forEach(function (r) {
          if (looksLikeDataUrl(r.url) || looksLikeBase64Blob(r.url)) {
            // already covered by data urls / base64 fields mostly
            var srcIn = toLoadableSrc(r.url);
            if (srcIn)
              pushItem({
                path: "input · " + r.path,
                src: srcIn,
                role: "input",
                kind: r.kind,
                chars: (r.url && r.url.length) || 0,
                raw: looksLikeDataUrl(srcIn) ? srcIn : "",
              });
          } else if (looksLikeImageUrl(r.url)) {
            // request-side URL (rare)
            pushItem({
              path: "input · " + r.path,
              src: resolveMediaUrl(r.url),
              role: "input",
              kind: "image-url",
              chars: r.url.length,
              raw: "",
            });
          }
        });
      } catch (eReq) {}
    }

    // Prefer generated-only when both exist (user asked for the generated image)
    var generated = out.filter(function (x) {
      return x.role === "generated";
    });
    if (generated.length) return generated;
    return out;
  }

  function toLoadableSrc(raw) {
    if (!raw) return "";
    if (looksLikeDataUrl(raw)) return raw;
    if (looksLikeBase64Blob(raw)) return "data:image/jpeg;base64," + raw.replace(/\s+/g, "");
    if (looksLikeImageUrl(raw)) return resolveMediaUrl(raw);
    return "";
  }

  function toDataUrlMaybe(raw) {
    return toLoadableSrc(raw);
  }

  /** Small colorful demo bitmap so empty requests still show the technique */
  function makeDemoImageDataUrl() {
    var c = document.createElement("canvas");
    c.width = 96;
    c.height = 72;
    var ctx = c.getContext("2d");
    var g = ctx.createLinearGradient(0, 0, 96, 72);
    g.addColorStop(0, "#ff4466");
    g.addColorStop(0.35, "#ffcc33");
    g.addColorStop(0.65, "#33cc88");
    g.addColorStop(1, "#4488ff");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 96, 72);
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.beginPath();
    ctx.arc(48, 34, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#222";
    ctx.font = "bold 14px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("ASCII", 48, 39);
    return c.toDataURL("image/png");
  }

  function loadImageFromUrl(url) {
    return new Promise(function (resolve, reject) {
      if (!url) {
        reject(new Error("No image URL"));
        return;
      }
      var img = new Image();
      // Same-origin generated assets; anonymous helps if CDN sends CORS headers
      try {
        img.crossOrigin = "anonymous";
      } catch (eCo) {}
      img.onload = function () {
        resolve(img);
      };
      img.onerror = function () {
        // Retry without CORS flag (some local paths fail with crossOrigin set)
        var img2 = new Image();
        img2.onload = function () {
          resolve(img2);
        };
        img2.onerror = function () {
          reject(new Error("Could not decode image"));
        };
        img2.src = url;
      };
      img.src = url;
    });
  }

  /**
   * Analyze image: each 2×3 pixel parcel → one font character colored to that parcel's average RGB.
   * Renders to canvas (fast) and also builds plain ASCII for copy.
   */
  function imageToColoredAsciiArt(img, opts) {
    opts = opts || {};
    var maxCols = opts.maxCols || ASCII_MAX_COLS;
    var srcW = img.naturalWidth || img.width;
    var srcH = img.naturalHeight || img.height;
    if (!srcW || !srcH) throw new Error("Empty image");

    var cols = Math.max(8, Math.min(maxCols, Math.floor(srcW / PARCEL_W)));
    var sampleW = cols * PARCEL_W;
    var sampleH = Math.max(PARCEL_H, Math.round((srcH / srcW) * sampleW));
    sampleH = Math.floor(sampleH / PARCEL_H) * PARCEL_H;
    if (sampleH < PARCEL_H) sampleH = PARCEL_H;
    var rows = sampleH / PARCEL_H;

    var sample = document.createElement("canvas");
    sample.width = sampleW;
    sample.height = sampleH;
    var sctx = sample.getContext("2d", { willReadFrequently: true });
    sctx.imageSmoothingEnabled = true;
    sctx.drawImage(img, 0, 0, sampleW, sampleH);
    var data = sctx.getImageData(0, 0, sampleW, sampleH).data;

    var ramp = ASCII_RAMP;
    var rampMax = ramp.length - 1;
    var lines = [];
    var out = document.createElement("canvas");
    out.width = Math.max(1, Math.ceil(cols * ASCII_CHAR_PX_W));
    out.height = Math.max(1, Math.ceil(rows * ASCII_CHAR_PX_H));
    var octx = out.getContext("2d");
    octx.fillStyle = "#0a0a0c";
    octx.fillRect(0, 0, out.width, out.height);
    octx.font =
      "600 " + ASCII_CHAR_PX_H + "px Consolas, 'Courier New', ui-monospace, monospace";
    octx.textBaseline = "top";
    octx.textAlign = "left";

    var r, c, py, px, i, pr, pg, pb, pa, lum, ch, idx;
    for (r = 0; r < rows; r++) {
      var line = "";
      for (c = 0; c < cols; c++) {
        pr = 0;
        pg = 0;
        pb = 0;
        pa = 0;
        for (py = 0; py < PARCEL_H; py++) {
          for (px = 0; px < PARCEL_W; px++) {
            i = ((r * PARCEL_H + py) * sampleW + (c * PARCEL_W + px)) * 4;
            var a = data[i + 3] / 255;
            if (a < 0.08) continue;
            pr += data[i] * a;
            pg += data[i + 1] * a;
            pb += data[i + 2] * a;
            pa += a;
          }
        }
        if (pa < 0.05) {
          ch = " ";
        } else {
          pr = Math.round(pr / pa);
          pg = Math.round(pg / pa);
          pb = Math.round(pb / pa);
          // perceived luminance 0–1 → pick from " .':;-+="
          lum = (0.2126 * pr + 0.7152 * pg + 0.0722 * pb) / 255;
          idx = Math.max(0, Math.min(rampMax, Math.floor(lum * (rampMax + 0.999))));
          ch = ramp.charAt(idx);
          octx.fillStyle = "rgb(" + pr + "," + pg + "," + pb + ")";
          octx.fillText(ch, c * ASCII_CHAR_PX_W, r * ASCII_CHAR_PX_H + 0.5);
        }
        line += ch;
      }
      lines.push(line);
    }

    return {
      canvas: out,
      plainText: lines.join("\n"),
      cols: cols,
      rows: rows,
      sampleW: sampleW,
      sampleH: sampleH,
      sourceW: srcW,
      sourceH: srcH,
    };
  }

  function renderAsciiArtSectionHtml(entry) {
    var blobs = resolveImagePayloads(entry || {});
    var html =
      '<div class="debug-ascii-section" id="debug-ascii-section">' +
      '<h4 class="debug-ascii-title">Generated image → colored ASCII (2×3 · . : style)</h4>' +
      '<p class="tab-debug-summary">Prefers the <strong>generated</strong> result (response / completed job), not just stock input. ' +
      "Each glyph is a <strong>2×3 pixel</strong> parcel; ramp <code> .\' :; -+=</code>; color = parcel average RGB.</p>";

    if (blobs.length) {
      var genN = blobs.filter(function (b) {
        return b.role === "generated";
      }).length;
      html +=
        '<p class="debug-ascii-banner debug-ascii-banner-ok">' +
        (genN
          ? "Rendering " + genN + " generated image(s) as colored ASCII."
          : "Rendering " + blobs.length + " input image(s) (no generated URL on this call yet).") +
        "</p>";
      blobs.forEach(function (f, i) {
        html +=
          '<div class="debug-ascii-wall' +
          (f.role === "generated" ? " debug-ascii-wall-generated" : "") +
          '" data-ascii-art-idx="' +
          i +
          '">' +
          '<div class="debug-ascii-wall-head">' +
          "<div><strong>" +
          escapeHtml(f.path || "image") +
          "</strong>" +
          '<span class="debug-ascii-wall-meta">' +
          escapeHtml(f.role || "") +
          " · " +
          escapeHtml(f.kind || "") +
          (f.chars ? " · " + formatBytes(f.chars) : "") +
          " · 2×3 parcels</span></div>" +
          '<button type="button" class="tab-debug-btn debug-ascii-copy" data-ascii-art-idx="' +
          i +
          '">Copy plain ASCII</button>' +
          "</div>" +
          '<div class="debug-ascii-art-layout">' +
          '<div class="debug-ascii-src-wrap">' +
          '<span class="debug-ascii-img-label">Source</span>' +
          '<img class="debug-ascii-src" data-ascii-src="' +
          i +
          '" alt="Source" />' +
          "</div>" +
          '<div class="debug-ascii-art-wrap">' +
          '<span class="debug-ascii-img-label">ASCII art</span>' +
          '<div class="debug-ascii-art-host" data-ascii-host="' +
          i +
          '"><p class="debug-ascii-pending">Analyzing pixels…</p></div>' +
          "</div></div></div>";
      });
    } else {
      html +=
        '<p class="debug-ascii-banner debug-ascii-banner-warn">No generated (or input) image on this call yet. ' +
        "Wait until generation <strong>finishes</strong>, then open the POST or the <strong>job done</strong> line in the list. " +
        "Demo below only fills empty state.</p>" +
        '<div class="debug-ascii-wall debug-ascii-wall-demo" data-ascii-art-idx="demo">' +
        '<div class="debug-ascii-wall-head">' +
        "<div><strong>(demo) not your generation</strong>" +
        '<span class="debug-ascii-wall-meta">Placeholder until a real image URL is captured</span></div>' +
        "</div>" +
        '<div class="debug-ascii-art-layout">' +
        '<div class="debug-ascii-src-wrap">' +
        '<span class="debug-ascii-img-label">Source</span>' +
        '<img class="debug-ascii-src" data-ascii-src="demo" alt="Demo source" />' +
        "</div>" +
        '<div class="debug-ascii-art-wrap">' +
        '<span class="debug-ascii-img-label">ASCII art</span>' +
        '<div class="debug-ascii-art-host" data-ascii-host="demo"><p class="debug-ascii-pending">Analyzing pixels…</p></div>' +
        "</div></div></div>";
    }

    html += "</div>";
    return html;
  }

  function paintAsciiArtIntoHost(hostEl, art) {
    if (!hostEl || !art || !art.canvas) return;
    hostEl.innerHTML = "";
    art.canvas.className = "debug-ascii-art-canvas";
    art.canvas.setAttribute(
      "aria-label",
      "Colored ASCII " + art.cols + "×" + art.rows + " characters from 2×3 pixel parcels"
    );
    hostEl.appendChild(art.canvas);
    var meta = document.createElement("p");
    meta.className = "debug-ascii-art-meta";
    meta.textContent =
      art.cols +
      "×" +
      art.rows +
      " chars · source " +
      art.sourceW +
      "×" +
      art.sourceH +
      " → sampled " +
      art.sampleW +
      "×" +
      art.sampleH +
      " (2×3 parcels)";
    hostEl.appendChild(meta);
  }

  function fillAsciiArtWalls(host, entry) {
    if (!host) return;
    var blobs = resolveImagePayloads(entry || {});
    var plainByKey = {};

    function renderOne(key, srcUrl, srcImgEl, hostEl) {
      if (srcImgEl && srcUrl) srcImgEl.src = srcUrl;
      if (!hostEl) return Promise.resolve();
      if (!srcUrl) {
        hostEl.innerHTML = '<p class="debug-ascii-empty">No image source.</p>';
        return Promise.resolve();
      }
      return loadImageFromUrl(srcUrl)
        .then(function (img) {
          var art = imageToColoredAsciiArt(img, { maxCols: ASCII_MAX_COLS });
          plainByKey[key] = art.plainText;
          paintAsciiArtIntoHost(hostEl, art);
        })
        .catch(function (err) {
          hostEl.innerHTML =
            '<p class="debug-ascii-empty">' +
            escapeHtml((err && err.message) || "Could not load image for ASCII") +
            " — " +
            escapeHtml(String(srcUrl).slice(0, 80)) +
            "</p>";
        });
    }

    var jobs = [];
    if (blobs.length) {
      blobs.forEach(function (f, i) {
        var key = String(i);
        var url = f.src || toLoadableSrc(f.raw);
        var srcImg = host.querySelector('.debug-ascii-src[data-ascii-src="' + i + '"]');
        var artHost = host.querySelector('.debug-ascii-art-host[data-ascii-host="' + i + '"]');
        jobs.push(renderOne(key, url, srcImg, artHost));
      });
    } else {
      var demoUrl = makeDemoImageDataUrl();
      jobs.push(
        renderOne(
          "demo",
          demoUrl,
          host.querySelector('.debug-ascii-src[data-ascii-src="demo"]'),
          host.querySelector('.debug-ascii-art-host[data-ascii-host="demo"]')
        )
      );
    }

    host.querySelectorAll(".debug-ascii-copy[data-ascii-art-idx]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var key = btn.getAttribute("data-ascii-art-idx");
        var text = plainByKey[key] || "";
        if (!text) return;
        var done = function () {
          var prev = btn.textContent;
          btn.textContent = "Copied";
          setTimeout(function () {
            btn.textContent = prev;
          }, 1200);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done).catch(function () {
            fallbackCopy(text, done);
          });
        } else {
          fallbackCopy(text, done);
        }
      });
    });

    return Promise.all(jobs);
  }

  function fallbackCopy(text, done) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      if (done) done();
    } catch (e) {
      /* ignore */
    }
  }

  function processGuideHtml() {
    return (
      '<details class="tab-debug-guide">' +
      "<summary>How to use Debug (any tab)</summary>" +
      "<ol>" +
      "<li><strong>Work</strong> on any tab and run a generation to completion.</li>" +
      "<li><strong>Debug</strong> → open a line tagged <strong>generated</strong> (or the POST after the job finishes). ASCII uses the <em>output</em> image, not only stock input.</li>" +
      "<li>Pending POSTs without a finished job still show the demo placeholder — wait for the job to complete.</li>" +
      "</ol>" +
      "<p class=\"tab-debug-guide-note\">Scope defaults to <strong>All tabs</strong>. Stock reference base64 is only used when no generated image is available.</p>" +
      "</details>"
    );
  }

  function renderDebug() {
    var host = $("tab-debug-host");
    if (!host) return;
    var tab = currentTab();
    var scopeLogs = logsForScope();
    var logs = filteredLogsForScope();
    var payloadCount = scopeLogs.filter(isPayloadCall).length;
    var tabNames = tabsWithCaptures();
    var selected = findLog(state.selectedId);
    var selectedVisible =
      selected &&
      logs.some(function (l) {
        return l.id === selected.id;
      });
    if (!selectedVisible) {
      selected = logs[0] || null;
      state.selectedId = selected ? selected.id : "";
    }

    var listHtml = logs.length
      ? logs
          .map(function (log) {
            var path = "";
            try {
              path = new URL(log.url, window.location.href).pathname;
            } catch (e) {
              path = log.url;
            }
            var sizeLabel = log.hasBody
              ? formatBytes(log.requestChars)
              : log.method === "GET" || log.method === "HEAD"
                ? "no body"
                : "0 B";
            var genBadge =
              log.isGeneratedResult || log.hasGeneratedImage
                ? '<span class="tab-debug-log-gen">generated</span>'
                : "";
            return (
              '<button type="button" class="tab-debug-log' +
              (log.id === state.selectedId ? " active" : "") +
              (log.hasBody || log.hasGeneratedImage ? " tab-debug-log-payload" : " tab-debug-log-empty") +
              (log.isGeneratedResult || log.hasGeneratedImage ? " tab-debug-log-generated" : "") +
              '" data-log-id="' +
              escapeHtml(log.id) +
              '">' +
              '<span class="tab-debug-log-tab">' +
              escapeHtml(log.tab || "?") +
              "</span>" +
              genBadge +
              '<span class="tab-debug-log-method">' +
              escapeHtml(log.method) +
              "</span>" +
              '<span class="tab-debug-log-path">' +
              escapeHtml(path) +
              "</span>" +
              '<span class="tab-debug-log-meta">' +
              escapeHtml(String(log.status || "…")) +
              " · " +
              escapeHtml(sizeLabel) +
              (log.ms ? " · " + log.ms + "ms" : "") +
              "</span></button>"
            );
          })
          .join("")
      : '<p class="tab-debug-empty">No API calls captured yet.<br/>Go to <strong>Work</strong> on <em>any</em> tab, run an action, then open Debug. Scope is <strong>All tabs</strong> by default.</p>';

    var detailHtml = "";
    if (!selected) {
      detailHtml =
        '<div class="tab-debug-detail-empty">' +
        renderAsciiArtSectionHtml(null) +
        processGuideHtml() +
        "<h3>What fields mean (once you open a POST)</h3>" +
        "<p><strong>base64-image</strong> = photo in the payload (decoded above as colored ASCII). <strong>Text</strong> = prompt/stasis. <strong>Numbers</strong> = tiny.</p>" +
        "</div>";
    } else {
      var a = selected.requestAnalysis || analyzeBody(selected.requestBody || "", { method: selected.method });
      var fieldBlock = "";
      if (a.fields && a.fields.length) {
        fieldBlock =
          "<h4>Request fields by size</h4>" +
          '<div class="tab-debug-table-wrap"><table class="tab-debug-table">' +
          "<thead><tr><th>Path</th><th>Kind</th><th>Length</th><th>Preview / note</th></tr></thead>" +
          "<tbody>" +
          renderFieldRows(a.fields, a.rawChars || 1) +
          "</tbody></table></div>";
      } else {
        fieldBlock =
          '<div class="tab-debug-empty-body">' +
          "<h4>No request fields</h4>" +
          "<p>" +
          escapeHtml(a.emptyReason || a.summary || "Empty body") +
          "</p>" +
          (selected.method === "GET" || selected.method === "HEAD"
            ? "<p>This is almost certainly a <strong>job poll</strong> or health check. Click a <strong>POST</strong> in the list (or re-run an action on Work).</p>"
            : "") +
          "</div>";
      }
      detailHtml =
        '<div class="tab-debug-detail">' +
        renderAsciiArtSectionHtml(selected) +
        processGuideHtml() +
        "<h3>" +
        '<span class="tab-debug-log-tab tab-debug-inline-tab">' +
        escapeHtml(selected.tab || "?") +
        "</span> " +
        escapeHtml(selected.method) +
        " " +
        escapeHtml(selected.url) +
        "</h3>" +
        '<p class="tab-debug-summary">' +
        escapeHtml(a.summary || "") +
        (selected.error ? " · error: " + escapeHtml(selected.error) : "") +
        "</p>" +
        '<div class="tab-debug-stats">' +
        "<span>tab " +
        escapeHtml(selected.tab || "?") +
        "</span>" +
        "<span>HTTP " +
        escapeHtml(String(selected.status || "pending")) +
        "</span>" +
        "<span>Request " +
        escapeHtml(formatBytes(selected.requestChars)) +
        " (" +
        escapeHtml(String(selected.requestChars)) +
        " chars)</span>" +
        "<span>Response " +
        escapeHtml(formatBytes(selected.responseChars)) +
        "</span>" +
        "<span>" +
        escapeHtml(String(selected.ms || 0)) +
        " ms</span>" +
        "</div>" +
        fieldBlock +
        "<h4>Response preview</h4>" +
        '<pre class="tab-debug-pre">' +
        escapeHtml(selected.responsePreview || "(empty)") +
        "</pre>" +
        "</div>";
    }

    var scopeTitle = state.tabScope === "all" ? "all tabs" : tab;
    var tabsNote =
      tabNames.length > 0
        ? " · tabs seen: " + tabNames.join(", ")
        : "";

    host.innerHTML =
      '<div class="tab-debug-shell">' +
      '<header class="tab-debug-header">' +
      "<div><h2>Debug · " +
      escapeHtml(scopeTitle) +
      "</h2>" +
      '<p class="tab-debug-lead">Inspect <strong>POST payloads</strong> from <strong>every site tab</strong> (or filter to this tab). ' +
      "Each capture is tagged with the tab that was active when it fired.</p></div>" +
      '<div class="tab-debug-header-actions">' +
      '<label class="tab-debug-toggle"><input type="checkbox" id="tab-debug-intercept"' +
      (state.interceptOn ? " checked" : "") +
      "/> Capture</label>" +
      '<div class="tab-debug-filter" role="group" aria-label="Tab scope">' +
      '<button type="button" class="tab-debug-btn' +
      (state.tabScope === "all" ? " active" : "") +
      '" id="tab-debug-scope-all">All tabs</button>' +
      '<button type="button" class="tab-debug-btn' +
      (state.tabScope === "current" ? " active" : "") +
      '" id="tab-debug-scope-current">This tab (' +
      escapeHtml(tab) +
      ")</button>" +
      "</div>" +
      '<div class="tab-debug-filter" role="group" aria-label="Traffic filter">' +
      '<button type="button" class="tab-debug-btn' +
      (state.listFilter === "payloads" ? " active" : "") +
      '" id="tab-debug-filter-payloads">Payloads only</button>' +
      '<button type="button" class="tab-debug-btn' +
      (state.listFilter === "all" ? " active" : "") +
      '" id="tab-debug-filter-all">All traffic</button>' +
      "</div>" +
      '<button type="button" class="tab-debug-btn" id="tab-debug-clear">Clear</button>' +
      '<button type="button" class="tab-debug-btn" id="tab-debug-back">Back to Work</button>' +
      "</div></header>" +
      '<p class="tab-debug-counts">' +
      escapeHtml(String(payloadCount)) +
      " payload POST(s) · " +
      escapeHtml(String(scopeLogs.length)) +
      " total call(s) in scope" +
      escapeHtml(tabsNote) +
      "</p>" +
      '<div class="tab-debug-body">' +
      '<aside class="tab-debug-list" aria-label="API calls">' +
      listHtml +
      "</aside>" +
      '<section class="tab-debug-main">' +
      detailHtml +
      "</section></div></div>";

    var intercept = $("tab-debug-intercept");
    if (intercept) {
      intercept.addEventListener("change", function () {
        state.interceptOn = !!intercept.checked;
      });
    }
    var scopeAll = $("tab-debug-scope-all");
    if (scopeAll) {
      scopeAll.addEventListener("click", function () {
        state.tabScope = "all";
        state.selectedId = "";
        renderDebug();
        updateSubtabLabel();
      });
    }
    var scopeCurrent = $("tab-debug-scope-current");
    if (scopeCurrent) {
      scopeCurrent.addEventListener("click", function () {
        state.tabScope = "current";
        state.selectedId = "";
        renderDebug();
        updateSubtabLabel();
      });
    }
    var filterPayloads = $("tab-debug-filter-payloads");
    if (filterPayloads) {
      filterPayloads.addEventListener("click", function () {
        state.listFilter = "payloads";
        state.selectedId = "";
        renderDebug();
      });
    }
    var filterAll = $("tab-debug-filter-all");
    if (filterAll) {
      filterAll.addEventListener("click", function () {
        state.listFilter = "all";
        renderDebug();
      });
    }
    var clearBtn = $("tab-debug-clear");
    if (clearBtn) clearBtn.addEventListener("click", clearScopedLogs);
    var backBtn = $("tab-debug-back");
    if (backBtn) {
      backBtn.addEventListener("click", function () {
        setMode("work");
      });
    }
    host.querySelectorAll("[data-log-id]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.selectedId = btn.getAttribute("data-log-id") || "";
        renderDebug();
      });
    });
    fillAsciiArtWalls(host, selected || null);
  }

  function injectUi() {
    if ($("site-subtabs")) return;
    var headerInner = document.querySelector(".site-header .header-inner");
    var header = document.querySelector(".site-header");
    if (!header && !headerInner) return;

    var sub = document.createElement("nav");
    sub.id = "site-subtabs";
    sub.className = "site-subtabs";
    sub.setAttribute("aria-label", "Work or Debug (Debug shows all tabs by default)");
    sub.innerHTML =
      '<button type="button" class="site-subtab active" id="site-subtab-work" data-sub="work">Work</button>' +
      '<button type="button" class="site-subtab" id="site-subtab-debug" data-sub="debug">Debug</button>' +
      '<span class="site-subtabs-label" id="site-subtabs-label">all tabs · Work</span>';

    if (headerInner && headerInner.parentNode) {
      headerInner.insertAdjacentElement("afterend", sub);
    } else if (header) {
      header.appendChild(sub);
    }

    var host = document.createElement("div");
    host.id = "tab-debug-host";
    host.className = "tab-debug-host";
    host.hidden = true;
    document.body.appendChild(host);

    sub.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-sub]");
      if (!btn) return;
      setMode(btn.getAttribute("data-sub"));
    });
  }

  function onTabChanged(ev) {
    var tab = (ev && ev.detail && ev.detail.tab) || currentTab();
    setActiveTab(tab);
  }

  function boot() {
    injectUi();
    installFetchHook();
    var initial =
      document.body.getAttribute("data-active-tab") ||
      (document.querySelector(".site-tabs .tab.active") &&
        document.querySelector(".site-tabs .tab.active").getAttribute("data-tab")) ||
      "gallery";
    setActiveTab(initial);
    document.body.setAttribute("data-active-tab", initial);
    window.addEventListener("tab-changed", onTabChanged);
    updateSubtabLabel();
  }

  window.TabDebug = {
    setActiveTab: setActiveTab,
    setMode: setMode,
    log: function (tab, label, payload) {
      var body = payload;
      if (typeof payload !== "string") {
        try {
          body = JSON.stringify(payload);
        } catch (e) {
          body = String(payload);
        }
      }
      var analysis = analyzeBody(body, { method: "LOG" });
      return pushLog({
        tab: tab || currentTab(),
        method: "LOG",
        url: label || "manual",
        status: 200,
        ok: true,
        ms: 0,
        requestChars: analysis.rawChars,
        requestBody: typeof body === "string" ? body : "",
        requestAnalysis: analysis,
        responseChars: 0,
        responsePreview: "",
        error: "",
        hasBody: analysis.rawChars > 0,
        noise: false,
      });
    },
    analyzeBody: analyzeBody,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
