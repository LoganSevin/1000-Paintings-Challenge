/**
 * Shared Spellforge-style stasis blend + vision generation for Muralwalk floor.
 */
(function () {
  function apiBase() {
    return String(window.SPELLFORGE_API_BASE || "").replace(/\/$/, "");
  }

  function apiUrl(path) {
    var base = apiBase();
    if (!base) return path;
    return base + path;
  }

  function isNetlifySite() {
    return (location.hostname || "").toLowerCase().indexOf("netlify.app") >= 0;
  }

  function parseApiResponse(res) {
    return res.text().then(function (text) {
      var trimmed = (text || "").trim();
      if (!trimmed || trimmed.charAt(0) === "<") {
        throw new Error("API returned HTML instead of JSON.");
      }
      try {
        return JSON.parse(trimmed);
      } catch (e) {
        throw new Error("Invalid API response.");
      }
    });
  }

  function isCreditsError(msg) {
    if (!msg) return false;
    var m = String(msg).toLowerCase();
    return (
      m.indexOf("credit") >= 0 ||
      m.indexOf("license") >= 0 ||
      m.indexOf("purchase") >= 0 ||
      m.indexOf("billing") >= 0
    );
  }

  var _blendInflight = null;
  var _healthCache = null;
  var _healthCacheAt = 0;
  var HEALTH_CACHE_MS = 60000;
  var POLL_START_MS = 500;
  var POLL_MAX_MS = 1800;

  function normalizeSpellNums(nums) {
    var out = [];
    for (var i = 0; i < (nums || []).length; i++) {
      var n = parseInt(nums[i], 10);
      if (n >= 1) out.push(n);
    }
    return out.slice(0, 3);
  }

  function uniqueStrings(arr) {
    var out = [];
    var seen = {};
    for (var i = 0; i < arr.length; i++) {
      var s = String(arr[i] || "").trim();
      if (!s || seen[s]) continue;
      seen[s] = true;
      out.push(s);
    }
    return out;
  }

  function fetchWithTimeout(url, opts, ms) {
    ms = ms == null ? 4500 : ms;
    opts = opts || {};
    if (typeof AbortController !== "undefined") {
      var ac = new AbortController();
      opts.signal = ac.signal;
      var timer = setTimeout(function () {
        ac.abort();
      }, ms);
      return fetch(url, opts).finally(function () {
        clearTimeout(timer);
      });
    }
    return Promise.race([
      fetch(url, opts),
      new Promise(function (_, reject) {
        setTimeout(function () {
          reject(new Error("timeout"));
        }, ms);
      }),
    ]);
  }

  function normalizeHealth(data) {
    var modern =
      data && (data.stasis_vision === true || (data.api_version || 0) >= 3);
    var online = !!(data && data.ok && modern);
    if (isNetlifySite() && data && data.ok && !modern) online = false;
    return {
      ok: online,
      api_configured: !!(data && data.api_configured !== false),
      raw: data,
    };
  }

  function checkHealth(force) {
    if (
      !force &&
      _healthCache &&
      Date.now() - _healthCacheAt < HEALTH_CACHE_MS
    ) {
      return Promise.resolve(_healthCache);
    }
    if (location.protocol === "file:") {
      _healthCache = { ok: false, api_configured: false };
      _healthCacheAt = Date.now();
      return Promise.resolve(_healthCache);
    }
    return fetchWithTimeout(apiUrl("/api/health"), {}, 3000)
      .then(function (r) {
        if (!r.ok) throw new Error("offline");
        return parseApiResponse(r);
      })
      .then(function (data) {
        _healthCache = normalizeHealth(data);
        _healthCacheAt = Date.now();
        return _healthCache;
      })
      .catch(function () {
        _healthCache = { ok: false, api_configured: false };
        _healthCacheAt = Date.now();
        return _healthCache;
      });
  }

  function useLocalGenerate(health) {
    if (window.SPELLFORGE_LOCAL_GENERATE === true) return true;
    if (health && health.ok && health.api_configured) return false;
    return typeof window.composeStasisVisionLocal === "function";
  }

  function blendSpells(nums) {
    nums = normalizeSpellNums(nums);
    if (nums.length < 2) {
      return Promise.reject(new Error("Equip at least 2 spells to blend."));
    }
    if (_blendInflight) return _blendInflight;
    _blendInflight = fetch(apiUrl("/api/blend-spells"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spells: nums }),
    })
      .then(function (r) {
        return parseApiResponse(r).then(function (data) {
          return { ok: r.ok, data: data };
        });
      })
      .then(function (res) {
        if (!res.ok) throw new Error((res.data && res.data.error) || "Blend failed");
        return res.data;
      })
      .finally(function () {
        _blendInflight = null;
      });
    return _blendInflight;
  }

  function collectBuzz(meta) {
    var list = (meta.tags || []).slice();
    var styles = meta.styles || [];
    for (var i = 0; i < styles.length; i++) list.push(styles[i]);
    if (meta.moods) {
      list = list.concat(String(meta.moods).split(/[\s·+,]+/));
    }
    return uniqueStrings(list).slice(0, 14);
  }

  function metaFromSpells(nums, getAnalysis) {
    var tags = [];
    var styles = [];
    var moods = [];
    nums.forEach(function (n) {
      var a = getAnalysis(n);
      if (!a) return;
      if (a.tags) tags = tags.concat(a.tags.slice(0, 6));
      if (a.style) styles.push(a.style);
      if (a.mood) moods.push(a.mood);
    });
    return {
      tags: uniqueStrings(tags),
      styles: uniqueStrings(styles),
      moods: moods.join(" · "),
    };
  }

  function pollImageJob(jobId, onStatus, attemptsLeft, pollMs) {
    if (attemptsLeft == null) attemptsLeft = 90;
    pollMs = pollMs == null ? POLL_START_MS : pollMs;
    return new Promise(function (resolve, reject) {
      if (attemptsLeft <= 0) {
        reject(new Error("Timed out waiting for stasis vision."));
        return;
      }
      fetch(apiUrl("/api/jobs/" + jobId))
        .then(function (r) {
          return r.json();
        })
        .then(function (job) {
          var status = job.status || "working";
          if (onStatus) {
            if (status === "queued" || status === "pending") {
              onStatus("AI painting from stasis… (queued)");
            } else if (status === "done") {
              onStatus("Stasis vision ready — loading floor…");
            } else {
              onStatus("AI painting from stasis… (" + status + ")");
            }
          }
          if (job.status === "done") {
            if (job.images && job.images.length) {
              var im = job.images[0];
              resolve(im.url || im);
              return;
            }
            if (job.image && job.image.url) {
              resolve(job.image.url);
              return;
            }
          }
          if (job.status === "failed") {
            var err = job.error;
            reject(
              new Error(
                (err && err.message) || (typeof err === "string" ? err : "Generate failed")
              )
            );
            return;
          }
          var nextPoll = Math.min(POLL_MAX_MS, pollMs + (pollMs < 1000 ? 120 : 80));
          setTimeout(function () {
            pollImageJob(jobId, onStatus, attemptsLeft - 1, nextPoll)
              .then(resolve)
              .catch(reject);
          }, pollMs);
        })
        .catch(reject);
    });
  }

  function generateCloud(nums, stasis, buzz, onStatus) {
    nums = normalizeSpellNums(nums);
    stasis = String(stasis || "").trim();
    if (nums.length < 2) {
      return Promise.reject(new Error("Equip at least 2 spells before generating."));
    }
    if (!stasis) {
      return Promise.reject(new Error("Stasis text is empty."));
    }
    var jobId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : "mw-" + Date.now();
    return fetch(apiUrl("/api/generate-stasis-vision"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        job_id: jobId,
        stasis: stasis,
        buzz_words: buzz,
        spells: nums,
      }),
    }).then(function (r) {
      if (r.status === 202) {
        return parseApiResponse(r).then(function (d) {
          return pollImageJob((d && d.job_id) || jobId, onStatus);
        });
      }
      return parseApiResponse(r).then(function (d) {
        if (!r.ok) throw new Error((d && d.error) || "Generate failed");
        var img = d.image || (d.images && d.images[0]);
        if (img && img.url) return img.url;
        throw new Error("No image returned");
      });
    });
  }

  function generateLocal(nums, stasis, buzz) {
    return window.composeStasisVisionLocal({
      spells: nums,
      stasis: stasis,
      buzz_words: buzz,
    });
  }

  function generateVision(nums, stasis, buzz, health, onStatus) {
    if (!stasis || !stasis.trim()) {
      return Promise.reject(new Error("Stasis text is empty."));
    }
    if (useLocalGenerate(health)) {
      if (onStatus) onStatus("Fusing paintings (stasis-guided)…");
      return generateLocal(nums, stasis, buzz);
    }
    if (onStatus) onStatus("AI painting from stasis… (starting)");
    return generateCloud(nums, stasis, buzz, onStatus).catch(function (err) {
      if (isCreditsError(err.message) && typeof window.composeStasisVisionLocal === "function") {
        if (onStatus) onStatus("Fusing paintings locally…");
        return generateLocal(nums, stasis, buzz);
      }
      throw err;
    });
  }

  function localRedefineDescription(current, variant, fallbackText) {
    variant = (variant || 0) | 0;
    var text = String(current || "").trim();
    if (text) {
      var parts = text.split(/(?<=[.!?])\s+/).filter(function (p) {
        return p.trim();
      });
      if (parts.length >= 2) {
        var rot = variant % parts.length;
        var reordered = parts.slice(rot).concat(parts.slice(0, rot));
        var openers = [
          "As one fused spell, ",
          "In singular stasis, ",
          "The merged apparition ",
          "Unified yet restless, ",
          "Held in one braided frame, ",
        ];
        var body = reordered[0].replace(/^[^a-zA-Z]+/, "").trim();
        if (body) {
          body = body.charAt(0).toLowerCase() + body.slice(1);
          reordered[0] = openers[variant % openers.length] + body;
        }
        return reordered.join(" ");
      }
    }
    return String(fallbackText || text || "").trim();
  }

  function redefineStasisCloud(nums, currentStasis, variant) {
    return fetch(apiUrl("/api/redefine-stasis"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        spells: nums,
        stasis: currentStasis,
        variant: variant,
      }),
    })
      .then(function (r) {
        return parseApiResponse(r).then(function (data) {
          return { ok: r.ok, data: data };
        });
      })
      .then(function (res) {
        if (!res.ok) throw new Error((res.data && res.data.error) || "Redefine failed");
        return res.data;
      });
  }

  function redefineStasis(nums, currentStasis, variant, health, localFallback) {
    nums = (nums || []).slice(0, 3);
    currentStasis = String(currentStasis || "").trim();
    variant = (variant || 1) | 0;
    if (!currentStasis) {
      return Promise.reject(new Error("Stasis text is empty."));
    }

    function localResult() {
      var fb =
        typeof localFallback === "function"
          ? localFallback(variant)
          : currentStasis;
      return Promise.resolve({
        mixed_description: localRedefineDescription(currentStasis, variant, fb),
      });
    }

    if (!health || !health.ok || window.SPELLFORGE_LOCAL_GENERATE === true) {
      return localResult();
    }

    return redefineStasisCloud(nums, currentStasis, variant)
      .catch(function (err) {
        if (isCreditsError(err && err.message)) return localResult();
        throw err;
      });
  }

  function buildFloor(opts) {
    opts = opts || {};
    var nums = normalizeSpellNums(opts.spells || []);
    var getAnalysis = opts.getAnalysis || function () {
      return null;
    };
    var localStasis = opts.localStasis || "";
    var localTitle = opts.localTitle || "";
    var onStatus = opts.onStatus;
    var skipBlend = opts.skipBlend === true;

    if (nums.length < 2) return Promise.resolve(null);

    return checkHealth().then(function (health) {
      var meta = metaFromSpells(nums, getAnalysis);

      function paintFromStasis(stasis, title) {
        var text = String(stasis || "").trim();
        if (!text) throw new Error("Could not build stasis text.");
        var buzz =
          opts.buzz_words && opts.buzz_words.length
            ? uniqueStrings(opts.buzz_words)
            : collectBuzz(meta);
        return generateVision(nums, text, buzz, health, onStatus).then(function (url) {
          return {
            url: url,
            stasis: text,
            title: title || localTitle || "",
            buzz: buzz,
            spells: nums,
            source: useLocalGenerate(health) ? "local" : "ai",
          };
        });
      }

      if (skipBlend && localStasis.trim()) {
        if (onStatus) onStatus("AI painting from stasis…");
        return paintFromStasis(localStasis, localTitle);
      }

      if (onStatus) onStatus("Blending stasis…");
      var blendWork =
        health.ok && window.SPELLFORGE_LOCAL_GENERATE !== true
          ? blendSpells(nums).catch(function () {
              return {
                mixed_description: localStasis,
                fused_title: localTitle,
              };
            })
          : Promise.resolve({
              mixed_description: localStasis,
              fused_title: localTitle,
            });

      return blendWork.then(function (blend) {
        var stasis = String((blend && blend.mixed_description) || localStasis || "").trim();
        var title = (blend && blend.fused_title) || localTitle || "";
        if (!stasis) {
          throw new Error("Could not build stasis text — check spell analyses loaded.");
        }
        return paintFromStasis(stasis, title);
      });
    });
  }

  window.StasisFloorGen = {
    checkHealth: checkHealth,
    normalizeSpellNums: normalizeSpellNums,
    blendSpells: blendSpells,
    collectBuzz: collectBuzz,
    generateVision: generateVision,
    redefineStasis: redefineStasis,
    buildFloor: buildFloor,
  };
})();