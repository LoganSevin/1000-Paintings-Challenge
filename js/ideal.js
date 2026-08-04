/**
 * Ideal — bare prompt → image/video. No spells, gallery, brands, or recipe padding.
 * Stills save to Generated; videos to saved-videos (gallery generator tabs).
 */
(function () {
  "use strict";

  var PROMPT_MAX = 8000;
  var ASPECTS = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"];

  var state = {
    imageUrl: "",
    videoUrl: "",
    aspect: "16:9",
    duration: 10,
    busy: false,
    savedImageNum: null,
    savedVideoNum: null,
  };

  function $(id) {
    return document.getElementById(id);
  }

  function apiUrl(path) {
    if (typeof window.galleryApiUrl === "function") return window.galleryApiUrl(path);
    var base = String(window.SPELLFORGE_API_BASE || "").replace(/\/$/, "");
    return base ? base + path : path;
  }

  function absoluteUrl(url) {
    if (!url) return "";
    if (/^(https?:|data:|blob:)/i.test(url)) return url;
    try {
      return new URL(url, window.location.href).href;
    } catch (err) {
      return url;
    }
  }

  function setStatus(msg, kind) {
    var el = $("id-status");
    if (!el) return;
    el.textContent = msg || "";
    el.className = "id-status" + (kind === "err" ? " err" : kind === "ok" ? " ok" : "");
  }

  function setBusy(on) {
    state.busy = !!on;
    ["id-gen-image", "id-gen-video", "id-save-image", "id-save-video"].forEach(function (id) {
      var b = $(id);
      if (b) b.disabled = !!on && (id.indexOf("gen") === 0 || !state.imageUrl);
    });
    var gi = $("id-gen-image");
    var gv = $("id-gen-video");
    if (gi) gi.disabled = !!on;
    if (gv) gv.disabled = !!on;
    updateSaveButtons();
  }

  function updateSaveButtons() {
    var si = $("id-save-image");
    var sv = $("id-save-video");
    if (si) si.disabled = state.busy || !state.imageUrl;
    if (sv) sv.disabled = state.busy || !state.videoUrl;
  }

  function syncCharCount() {
    var ta = $("id-prompt");
    var el = $("id-char-count");
    if (!ta || !el) return;
    var n = ta.value.length;
    el.textContent = n + " / " + PROMPT_MAX + " characters";
    el.className = "id-char" + (n > PROMPT_MAX ? " over" : n > PROMPT_MAX * 0.9 ? " warn" : "");
  }

  function rawPrompt() {
    var ta = $("id-prompt");
    return ta ? String(ta.value || "").trim() : "";
  }

  function currentAspect() {
    var sel = $("id-aspect");
    var a = sel && sel.value ? sel.value : state.aspect;
    state.aspect = a;
    return a;
  }

  function currentDuration() {
    var sel = $("id-duration");
    var d = sel ? parseInt(sel.value, 10) : 10;
    if ([6, 10, 15].indexOf(d) < 0) d = 10;
    state.duration = d;
    return d;
  }

  /**
   * Guess subject class from the user's words so framing stays natural:
   * location → postcard place, object → product showcase, living → hero subject.
   * Explicit override: start with "location:", "object:", "living:", or "scene:".
   */
  function detectSubjectFocus(text) {
    var t = String(text || "").trim();
    var lower = t.toLowerCase();
    var m = lower.match(/^\s*(location|place|postcard|object|prop|item|living|person|people|animal|creature|character|portrait|scene|general)\s*:\s*/i);
    if (m) {
      var tag = m[1].toLowerCase();
      if (tag === "place" || tag === "postcard") return "location";
      if (tag === "prop" || tag === "item") return "object";
      if (tag === "person" || tag === "people" || tag === "animal" || tag === "creature" || tag === "character" || tag === "portrait")
        return "living";
      if (tag === "general") return "scene";
      return tag;
    }

    function score(re) {
      var hits = lower.match(re);
      return hits ? hits.length : 0;
    }

    var livingScore =
      score(
        /\b(person|people|man|woman|boy|girl|child|human|portrait|face|someone|figure|crowd|family|couple|friend|stranger|soldier|dancer|singer|chef|pilot|astronaut|king|queen|wizard|witch|hero|villain)\b/g
      ) +
      score(
        /\b(animal|dog|cat|bird|horse|wolf|fox|bear|deer|lion|tiger|whale|fish|shark|eagle|owl|rabbit|mouse|snake|dragon|creature|pet|puppy|kitten|wildlife|beast)\b/g
      ) +
      score(/\b(he|she|they|him|her|his|hers|their|who|wearing|smiling|standing|sitting|walking|running)\b/g) * 0.35;

    var locationScore =
      score(
        /\b(location|place|city|town|village|country|island|beach|coast|mountain|desert|forest|jungle|valley|lake|river|ocean|sea|harbor|port|street|road|alley|park|garden|plaza|square|bridge|tower|castle|temple|church|cathedral|mosque|palace|museum|market|station|airport|hotel|cafe|café|restaurant|bar|school|library|stadium|arena|theater|theatre|cinema|skyline|horizon|landscape|scenery|destination|travel|vacation|abroad|hometown|neighborhood|district|region|province|state|capital)\b/g
      ) +
      score(/\b(in|at|near|outside|inside|overlooking|view of|visiting)\s+[A-Z][a-z]+/g) * 0.5 +
      score(/\b(postcard|souvenir|travel photo|scenic)\b/g) * 2;

    var objectScore =
      score(
        /\b(object|item|prop|product|tool|weapon|sword|gun|phone|camera|book|bottle|cup|mug|chair|table|lamp|clock|key|ring|necklace|watch|bag|box|vase|statue|sculpture|toy|ball|guitar|piano|car|bike|bicycle|ship|boat|plane|train|robot|machine|device|gadget|artifact|relic|gem|crystal|crown|helmet|shield|armor|coin|map|letter|envelope)\b/g
      ) + score(/\b(the\s+\w+\s+(on|of|with)\s+(a|the|his|her))\b/g) * 0.2;

    // Explicit place names / “in Paris” style often dominate
    if (/\b(postcard|souvenir from|visit to|trip to)\b/i.test(lower)) locationScore += 3;
    if (/\b(portrait of|photo of a (man|woman|person|dog|cat|bird))\b/i.test(lower)) livingScore += 3;
    if (/\b(product shot|catalog|showcase|still life of)\b/i.test(lower)) objectScore += 3;

    var best = "scene";
    var bestN = 0.9; // threshold so vague prompts stay general scene
    [
      ["living", livingScore],
      ["location", locationScore],
      ["object", objectScore],
    ].forEach(function (pair) {
      if (pair[1] > bestN) {
        bestN = pair[1];
        best = pair[0];
      }
    });
    return best;
  }

  var FOCUS_LABELS = {
    location: "Location · postcard place",
    object: "Object · clean showcase",
    living: "Living subject · hero focus",
    scene: "Scene · balanced frame",
  };

  /**
   * Framing directives only — never replaces the user's words.
   * Avoids floating junk objects and awkward collage placement.
   */
  function framingDirective(focus) {
    var anti =
      "Avoid floating random props, cluttered multi-object piles, impossible scale, cut-off limbs, " +
      "text watermarks, extra limbs, and objects glued into wrong places. " +
      "One clear subject hierarchy; natural gravity and grounded placement; clean composition.";
    if (focus === "location") {
      return (
        "Framing: treat this as a travel postcard to that place — iconic vista, inviting postcard composition, " +
        "readable landmark or atmosphere of the location as the hero. " +
        "Not a product catalog; not a random object still life. " +
        anti
      );
    }
    if (focus === "object") {
      return (
        "Framing: showcase that object as the clear hero — product / still-life presentation, " +
        "centered or elegant three-quarter view, simple supporting surface or soft studio/environmental light, " +
        "no competing clutter. The named object fills intent; background stays quiet. " +
        anti
      );
    }
    if (focus === "living") {
      return (
        "Framing: the living subject (person, animal, or creature) is the general focus — " +
        "portrait or character-forward, readable face/body language, natural pose, " +
        "environment supports them without stealing the frame. " +
        anti
      );
    }
    return (
      "Framing: coherent single scene with a clear primary focus; " +
      "avoid scattershot object placement and unnatural stacking. " +
      anti
    );
  }

  function stripFocusPrefix(text) {
    return String(text || "")
      .replace(
        /^\s*(location|place|postcard|object|prop|item|living|person|people|animal|creature|character|portrait|scene|general)\s*:\s*/i,
        ""
      )
      .trim();
  }

  /**
   * Build API fields: user intent first, then short Ideal framing.
   * No spells / gallery / brands.
   */
  function composeIdealPayload(userText, aspect) {
    var focus = detectSubjectFocus(userText);
    var core = stripFocusPrefix(userText) || userText;
    var frame = framingDirective(focus);
    // stasis = pure user vision; prompt = user + framing for the model
    var stasis = core.slice(0, PROMPT_MAX);
    var combined = (core + "\n\n" + frame).slice(0, PROMPT_MAX);
    return {
      focus: focus,
      focusLabel: FOCUS_LABELS[focus] || focus,
      stasis: stasis,
      prompt: combined,
      aspect_ratio: aspect || "16:9",
      buzz_words: ["single subject", "clean composition", "natural placement", focus],
    };
  }

  function updateFocusHint() {
    var el = $("id-focus-hint");
    if (!el) return;
    var t = rawPrompt();
    if (!t) {
      el.textContent =
        "Focus: type a prompt — Ideal will lean location (postcard), object (showcase), or living subject.";
      return;
    }
    var focus = detectSubjectFocus(t);
    el.textContent =
      "Focus: " +
      (FOCUS_LABELS[focus] || focus) +
      " · Tip: start with location: / object: / living: to force a mode.";
  }

  function delayMs(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function extractImageUrl(payload) {
    if (!payload) return "";
    var img = payload.image || (payload.images && payload.images[0]);
    var raw =
      (img && (img.url || img.download_url || img.uri)) ||
      payload.image_url ||
      payload.output_url ||
      payload.result_url ||
      "";
    return absoluteUrl(raw);
  }

  function extractVideoUrl(payload) {
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

  function pollImageJob(jobId, left) {
    if (left == null) left = 90;
    if (left <= 0) return Promise.reject(new Error("Timed out waiting for image."));
    return fetch(apiUrl("/api/jobs/" + jobId), { cache: "no-store" })
      .then(function (r) {
        return r.json().then(function (d) {
          return { ok: r.ok, d: d };
        });
      })
      .then(function (res) {
        var job = res.d || {};
        var st = String(job.status || "working").toLowerCase();
        setStatus("Ideal image… " + st + " (" + left + ")");
        if (st === "done" || st === "completed" || st === "success") {
          var url = extractImageUrl(job);
          if (url) return url;
          throw new Error("Job finished but no image URL.");
        }
        if (st === "failed" || st === "error" || st === "expired") {
          throw new Error((job.error && (job.error.message || job.error)) || "Image job failed");
        }
        return delayMs(1500).then(function () {
          return pollImageJob(jobId, left - 1);
        });
      });
  }

  function pollVideoJob(jobId, left) {
    if (left == null) left = 120;
    if (left <= 0) return Promise.reject(new Error("Timed out waiting for video."));
    return fetch(apiUrl("/api/jobs/" + jobId), { cache: "no-store" })
      .then(function (r) {
        return r.json().then(function (d) {
          return { ok: r.ok, d: d };
        });
      })
      .then(function (res) {
        var job = res.d || {};
        var st = String(job.status || "working").toLowerCase();
        setStatus("Ideal video… " + st + " (" + left + ")");
        if (st === "done" || st === "completed" || st === "success") {
          var url = extractVideoUrl(job);
          if (url) return url;
          throw new Error("Job finished but no video URL.");
        }
        if (st === "failed" || st === "error" || st === "expired") {
          throw new Error((job.error && (job.error.message || job.error)) || "Video job failed");
        }
        return delayMs(2000).then(function () {
          return pollVideoJob(jobId, left - 1);
        });
      });
  }

  function showImage(url) {
    state.imageUrl = url;
    state.savedImageNum = null;
    var img = $("id-preview-img");
    var vid = $("id-preview-video");
    if (img) {
      img.src = url;
      img.classList.add("show");
    }
    if (vid) {
      vid.removeAttribute("src");
      vid.classList.remove("show");
      try {
        vid.load();
      } catch (e) {}
    }
    updateSaveButtons();
  }

  function showVideo(url) {
    state.videoUrl = url;
    state.savedVideoNum = null;
    var vid = $("id-preview-video");
    var img = $("id-preview-img");
    if (vid) {
      vid.src = url;
      vid.classList.add("show");
      try {
        vid.play().catch(function () {});
      } catch (e) {}
    }
    if (img) img.classList.remove("show");
    updateSaveButtons();
  }

  function buildGenerateBody(userText, aspect, jobId) {
    var composed = composeIdealPayload(userText, aspect);
    return {
      job_id: jobId,
      stasis: composed.stasis,
      prompt: composed.prompt,
      buzz_words: composed.buzz_words,
      spells: [],
      aspect_ratio: composed.aspect_ratio,
      mag_fresh: true,
      spell_cast: false,
      fresh_variation: true,
      _focusLabel: composed.focusLabel,
      _focus: composed.focus,
    };
  }

  /**
   * User prompt + light subject framing only — no spells / gallery / brands.
   */
  function generateImage() {
    var prompt = rawPrompt();
    if (!prompt) {
      setStatus("Type a prompt first.", "err");
      return;
    }
    if (prompt.length > PROMPT_MAX) {
      setStatus("Trim the prompt under " + PROMPT_MAX + " characters.", "err");
      return;
    }
    var aspect = currentAspect();
    var jobId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : "ideal-" + Date.now();
    var body = buildGenerateBody(prompt, aspect, jobId);
    setBusy(true);
    setStatus(
      "Generating Ideal still @ " +
        aspect +
        " · " +
        body._focusLabel +
        "…"
    );
    fetch(apiUrl("/api/generate-stasis-vision"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        job_id: body.job_id,
        stasis: body.stasis,
        prompt: body.prompt,
        buzz_words: body.buzz_words,
        spells: [],
        aspect_ratio: body.aspect_ratio,
        mag_fresh: true,
        spell_cast: false,
        fresh_variation: true,
      }),
    })
      .then(function (r) {
        return r.json().then(function (d) {
          return { ok: r.ok, d: d, status: r.status };
        });
      })
      .then(function (res) {
        var d = res.d || {};
        if (res.status === 202 || (!extractImageUrl(d) && (d.job_id || jobId))) {
          return pollImageJob(d.job_id || jobId);
        }
        if (!res.ok) throw new Error((d && d.error) || "Generate failed");
        var url = extractImageUrl(d);
        if (!url && d.job_id) return pollImageJob(d.job_id);
        if (!url) throw new Error("No image URL");
        return url;
      })
      .then(function (url) {
        showImage(url);
        setStatus("Still ready — saving to Generated…", "");
        return saveImageToGallery(url, true).then(function () {
          setStatus(
            "Ideal still ready (" + body._focusLabel + ") · saved under Gallery → Generated.",
            "ok"
          );
        });
      })
      .catch(function (err) {
        setStatus((err && err.message) || "Generate failed — is the gallery server running?", "err");
      })
      .then(function () {
        setBusy(false);
      });
  }

  function generateVideo() {
    var prompt = rawPrompt();
    if (!prompt) {
      setStatus("Type a prompt first.", "err");
      return;
    }
    if (prompt.length > PROMPT_MAX) {
      setStatus("Trim the prompt under " + PROMPT_MAX + " characters.", "err");
      return;
    }
    var aspect = currentAspect();
    var duration = currentDuration();
    var jobId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : "ideal-" + Date.now();
    var body = buildGenerateBody(prompt, aspect, jobId);
    setBusy(true);
    setStatus(
      "Ideal video: still first @ " + aspect + " · " + body._focusLabel + "…"
    );
    fetch(apiUrl("/api/generate-stasis-vision"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        job_id: body.job_id,
        stasis: body.stasis,
        prompt: body.prompt,
        buzz_words: body.buzz_words,
        spells: [],
        aspect_ratio: body.aspect_ratio,
        mag_fresh: true,
        spell_cast: false,
        fresh_variation: true,
      }),
    })
      .then(function (r) {
        return r.json().then(function (d) {
          return { ok: r.ok, d: d, status: r.status };
        });
      })
      .then(function (res) {
        var d = res.d || {};
        if (res.status === 202 || (!extractImageUrl(d) && (d.job_id || jobId))) {
          return pollImageJob(d.job_id || jobId);
        }
        if (!res.ok) throw new Error((d && d.error) || "Still failed");
        var url = extractImageUrl(d);
        if (!url && d.job_id) return pollImageJob(d.job_id);
        if (!url) throw new Error("No still URL for video");
        return url;
      })
      .then(function (stillUrl) {
        showImage(stillUrl);
        setStatus("Animating Ideal video (" + duration + "s)…");
        return saveImageToGallery(stillUrl, true).then(function () {
          return fetch(apiUrl("/api/animate-cast"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              wait: false,
              wait_for_result: false,
              stasis: body.stasis.slice(0, 2000),
              prompt: body.prompt.slice(0, 2000),
              duration: duration,
              resolution: "720p",
              aspect_ratio: aspect,
              image_url: stillUrl,
              reference_image: stillUrl,
            }),
          });
        });
      })
      .then(function (r) {
        return r.json().then(function (d) {
          if (!r.ok) throw new Error((d && d.error) || "Video failed");
          var jid = d.job_id || d.id;
          if (jid) return pollVideoJob(jid);
          var url = extractVideoUrl(d);
          if (url) return url;
          throw new Error("No video job id");
        });
      })
      .then(function (url) {
        showVideo(url);
        setStatus("Video ready — saving to saved-videos…", "");
        return saveVideoToGallery(url, true).then(function () {
          setStatus(
            "Ideal video ready (" + body._focusLabel + ") · saved under Gallery → Videos.",
            "ok"
          );
        });
      })
      .catch(function (err) {
        setStatus((err && err.message) || "Video generate failed.", "err");
      })
      .then(function () {
        setBusy(false);
      });
  }

  function saveImageToGallery(url, quiet) {
    url = url || state.imageUrl;
    if (!url) return Promise.reject(new Error("No still to save."));
    var prompt = rawPrompt();
    var payload = {
      image_url: absoluteUrl(url),
      source: "ideal",
      collection: "generated",
      description: (prompt || "Ideal").slice(0, 160),
      meta: {
        source: "ideal",
        aspect: state.aspect,
        prompt: prompt.slice(0, 500),
        focus: detectSubjectFocus(prompt),
      },
    };
    if (String(url).indexOf("data:") === 0) {
      payload.image_base64 = url;
      delete payload.image_url;
    }
    return fetch(apiUrl("/api/save-generated-image"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(function (r) {
        return r.json().then(function (d) {
          if (!r.ok || (d && d.ok === false)) {
            throw new Error((d && d.error) || "Save image failed");
          }
          return d;
        });
      })
      .then(function (d) {
        if (d && d.url) {
          state.imageUrl = absoluteUrl(d.url);
          state.savedImageNum = d.num != null ? d.num : state.savedImageNum;
          var img = $("id-preview-img");
          if (img) img.src = state.imageUrl;
        }
        if (!quiet) setStatus("Saved to Gallery → Generated" + (d.num != null ? " #" + d.num : "") + ".", "ok");
        updateSaveButtons();
        return d;
      });
  }

  function saveVideoToGallery(url, quiet) {
    url = url || state.videoUrl;
    if (!url) return Promise.reject(new Error("No video to save."));
    var chain;
    if (window.GallerySaveVideo && window.GallerySaveVideo.save) {
      chain = window.GallerySaveVideo.save(url, { force: true, timeoutMs: 180000 });
    } else {
      chain = fetch(apiUrl("/api/save-video"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: absoluteUrl(url), force_mp4: true }),
      }).then(function (r) {
        return r.json().then(function (d) {
          if (!r.ok || (d && d.ok === false)) {
            throw new Error((d && d.error) || "Save video failed");
          }
          return d;
        });
      });
    }
    return chain.then(function (d) {
      if (!d || d.ok === false) {
        throw new Error((d && d.error) || "Video save failed — is start_server.bat running?");
      }
      if (d.url) {
        state.videoUrl = absoluteUrl(d.url);
        state.savedVideoNum = d.num != null ? d.num : state.savedVideoNum;
        var vid = $("id-preview-video");
        if (vid) vid.src = state.videoUrl;
      }
      if (!quiet) setStatus("Saved to Gallery → Videos" + (d.num != null ? " #" + d.num : "") + ".", "ok");
      updateSaveButtons();
      return d;
    });
  }

  function bind() {
    if (!$("panel-ideal")) return;
    var aspect = $("id-aspect");
    if (aspect) {
      aspect.innerHTML = ASPECTS.map(function (a) {
        return (
          '<option value="' + a + '"' + (a === "16:9" ? " selected" : "") + ">" + a + "</option>"
        );
      }).join("");
      aspect.addEventListener("change", function () {
        state.aspect = aspect.value || "16:9";
      });
    }
    var ta = $("id-prompt");
    if (ta) {
      ta.addEventListener("input", function () {
        syncCharCount();
        updateFocusHint();
      });
      syncCharCount();
      updateFocusHint();
    }
    $("id-gen-image") && $("id-gen-image").addEventListener("click", generateImage);
    $("id-gen-video") && $("id-gen-video").addEventListener("click", generateVideo);
    $("id-save-image") &&
      $("id-save-image").addEventListener("click", function () {
        saveImageToGallery(null, false).catch(function (err) {
          setStatus((err && err.message) || "Save failed", "err");
        });
      });
    $("id-save-video") &&
      $("id-save-video").addEventListener("click", function () {
        saveVideoToGallery(null, false).catch(function (err) {
          setStatus((err && err.message) || "Save failed", "err");
        });
      });
    $("id-clear") &&
      $("id-clear").addEventListener("click", function () {
        if (ta) ta.value = "";
        syncCharCount();
        setStatus("Prompt cleared.", "");
      });
    updateSaveButtons();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }

  window.Ideal = {
    generateImage: generateImage,
    generateVideo: generateVideo,
  };
})();
